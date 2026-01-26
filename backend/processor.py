import cv2
from ultralytics import YOLO
import easyocr
import numpy as np
import re

model = YOLO('best3.pt') 
reader = easyocr.Reader(['en'], gpu=False)

# Khởi tạo biến global
last_ocr_text = ""

def preprocess_for_ocr(img):
    gray = cv2.cvtColor(img, cv2.COLOR_BGR2GRAY)
    gray = cv2.resize(gray, None, fx=2.0, fy=2.0, interpolation=cv2.INTER_CUBIC)
    
    # Sử dụng Threshold Otsu để tách biệt hẳn nét chữ và nền
    clahe = cv2.createCLAHE(clipLimit=3.0, tileGridSize=(8,8))
    gray = clahe.apply(gray)
    
    _, thresh = cv2.threshold(gray, 0, 255, cv2.THRESH_BINARY + cv2.THRESH_OTSU)
    return thresh

def final_correction(text):
    text = re.sub(r'[^A-Z0-9]', '', text.upper())
    if len(text) < 5:
        return text

    chars = list(text)

    # === 1. Hai ký tự đầu: PHẢI LÀ SỐ ===
    to_num = {
        'I': '1', 'J': '1', 'L': '1',
        'O': '0', 'D': '0', 'Q': '0',
        'B': '8', 'S': '5'
    }

    for i in [0, 1]:
        if i < len(chars) and chars[i] in to_num:
            chars[i] = to_num[chars[i]]

    # === 2. Ký tự thứ 3: PHẢI LÀ CHỮ ===
    to_char = {
        '0': 'D',
        '1': 'I',
        '2': 'Z',
        '4': 'A',
        '5': 'S',
        '8': 'B'
    }

    if len(chars) > 2 and chars[2].isdigit() and chars[2] in to_char:
        chars[2] = to_char[chars[2]]

    # === 3. Các ký tự sau: PHẢI LÀ SỐ ===
    for i in range(3, len(chars)):
        if chars[i] in to_num:
            chars[i] = to_num[chars[i]]

    return "".join(chars)

def process_frame(frame):
    global last_ocr_text
    
    results = model(frame, conf=0.5, verbose=False) 
    plate_data = []
    plates = []

    for res in results:
        for box in res.boxes:
            x1, y1, x2, y2 = map(int, box.xyxy[0])
            pad = 5
            plate_img = frame[max(0, y1-pad):y2+pad, max(0, x1-pad):x2+pad]
            
            if plate_img.size == 0: 
                continue
                
            h, w = plate_img.shape[:2]
            if h < 40 or w < 120:
                continue
                
            aspect_ratio = h / w
            is_square = aspect_ratio > 0.55

            try:
                processed = preprocess_for_ocr(plate_img)
                ocr_results = reader.readtext(processed, detail=1)
                
                if not ocr_results: 
                    continue

                # Sắp xếp: Hàng trên (Y nhỏ) trước, Hàng dưới (Y lớn) sau
                ocr_results.sort(key=lambda x: (x[0][0][1], x[0][0][0]))
                
                combined_text = "".join([r[1] for r in ocr_results])

                if len(combined_text) < 6:
                    continue
                
                # Áp dụng bộ lọc sửa lỗi thông minh
                fixed_text = final_correction(combined_text)

                # Bỏ kiểm tra duplicate để backend xử lý
                # if fixed_text == last_ocr_text:
                #     continue

                last_ocr_text = fixed_text
                
                area = (x2 - x1) * (y2 - y1)
                
                rows = len(ocr_results)
                char_count = len(fixed_text)
                
                if rows == 1:
                    vehicle_type = "Car"  # Typically long plate for cars
                elif rows == 2:
                    if is_square:
                        if char_count >= 9:
                            vehicle_type = "Motorcycle"
                        else:
                            vehicle_type = "Car"
                    else:
                        vehicle_type = "Car"  # Fallback
                else:
                    continue  # Invalid number of rows

                plates.append({
                    "area": area,
                    "text": fixed_text,
                    "type": vehicle_type,
                    "box": [x1, y1, x2, y2]
                })

            except Exception as e:
                print(f"Lỗi OCR: {e}")

    if not plates:
        return []

    # Chỉ lấy plate có diện tích lớn nhất
    plates.sort(key=lambda x: x["area"], reverse=True)
    best_plate = plates[0]

    return [best_plate]