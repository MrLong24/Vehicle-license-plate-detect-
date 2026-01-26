# Sử dụng Python 3.10 slim
FROM python:3.10-slim

# Cập nhật các thư viện hệ thống cho OpenCV, EasyOCR và xử lý ảnh
RUN apt-get update && apt-get install -y \
    libgl1 \
    libglib2.0-0 \
    libsm6 \
    libxext6 \
    libxrender-dev \
    && rm -rf /var/lib/apt/lists/*

WORKDIR /app

# Copy requirements và cài đặt thư viện
COPY requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt

# Copy toàn bộ code và model AI
COPY . .

# Mở port cho FastAPI
EXPOSE 8000

CMD ["uvicorn", "backend:app", "--host", "0.0.0.0", "--port", "8000"]