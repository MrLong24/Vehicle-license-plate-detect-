from fastapi import FastAPI, File, UploadFile, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel, validator
from sqlalchemy import create_engine, text
from datetime import datetime
import cv2
import numpy as np
from processor import process_frame
import io
from typing import Optional
import uvicorn
import os
from collections import defaultdict
import time
import re


app = FastAPI()

# Enable CORS for React frontend
app.add_middleware(
    CORSMiddleware,
    allow_origins=["http://localhost:3000", "http://localhost:5173"], 
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

DATABASE_URL = os.getenv(
    "DATABASE_URL",
    "mysql+mysqlconnector://root:long12345@db:3306/smart_parking_its"
)

engine = create_engine(DATABASE_URL, pool_pre_ping=True)

plate_buffer = defaultdict(int)
last_confirmed_plate = None
last_confirmed_time = 0

PLATE_CONFIRM_THRESHOLD = 3   
PLATE_COOLDOWN = 3            

FRAME_SKIP = 1
frame_counter = 0

# Pydantic models
class VehicleEntry(BaseModel):
    plate_number: str
    vehicle_type: str

class VehicleExit(BaseModel):
    plate_number: str

class SystemConfig(BaseModel):
    parking_fee: int
    total_capacity: int
    auto_detection: bool
    sound_alert: bool

    @validator('parking_fee', pre=True)
    def validate_parking_fee(cls, value):
        try:
            fee = int(value)
        except (TypeError, ValueError):
            return 5000
        return fee if fee > 0 else 5000

    @validator('total_capacity', pre=True)
    def validate_total_capacity(cls, value):
        try:
            capacity = int(value)
        except (TypeError, ValueError):
            return 1
        return capacity if capacity > 0 else 1


def confirm_plate(plate_text: str):
    global last_confirmed_plate, last_confirmed_time

    now = time.time()

    if (
        plate_text == last_confirmed_plate
        and now - last_confirmed_time < PLATE_COOLDOWN
    ):
        return None

    plate_buffer[plate_text] += 1

    if plate_buffer[plate_text] >= PLATE_CONFIRM_THRESHOLD:
        last_confirmed_plate = plate_text
        last_confirmed_time = now
        plate_buffer.clear()
        return plate_text

    return None

def normalize_plate(plate: str) -> str:
    if not plate:
        return ""
    return re.sub(r'[\s.-]+', '', str(plate)).upper()

def is_valid_vietnam_plate(plate: str) -> bool:
    cleaned = normalize_plate(plate)
    if len(cleaned) < 7 or len(cleaned) > 10:
        return False
    
    pattern = r'^[0-9]{2}[A-Z]{1,2}[0-9]{4,6}$'
    return bool(re.match(pattern, cleaned))

# API Endpoints

# ==================== CONFIG ENDPOINTS ====================

@app.get("/api/config")
async def get_system_config():
    """Get current system configuration"""
    try:
        with engine.connect() as conn:
            result = conn.execute(
                text("""
                    SELECT parking_fee, total_capacity, auto_detection, sound_alert 
                    FROM system_config 
                    ORDER BY id DESC 
                    LIMIT 1
                """)
            ).fetchone()
            
            if result:
                return {
                    "parking_fee": result[0],
                    "total_capacity": result[1],
                    "auto_detection": bool(result[2]),
                    "sound_alert": bool(result[3])
                }
            else:
                # Return defaults if no config exists
                return {
                    "parking_fee": 5000,
                    "total_capacity": 100,
                    "auto_detection": True,
                    "sound_alert": True
                }
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))

@app.post("/api/config")
async def update_system_config(config: SystemConfig):
    """Update system configuration"""
    # Validate and normalize config values in case API is called directly
    if config.parking_fee <= 0:
        config.parking_fee = 5000
    if config.total_capacity <= 0:
        config.total_capacity = 1

    try:
        with engine.begin() as conn:
            # Check if config exists
            exists = conn.execute(
                text("SELECT id FROM system_config LIMIT 1")
            ).fetchone()
            
            if exists:
                # Update existing config
                conn.execute(
                    text("""
                        UPDATE system_config 
                        SET parking_fee = :fee, 
                            total_capacity = :capacity, 
                            auto_detection = :auto_detect, 
                            sound_alert = :sound,
                            updated_at = NOW()
                        WHERE id = :id
                    """),
                    {
                        "fee": config.parking_fee,
                        "capacity": config.total_capacity,
                        "auto_detect": config.auto_detection,
                        "sound": config.sound_alert,
                        "id": exists[0]
                    }
                )
            else:
                # Insert new config
                conn.execute(
                    text("""
                        INSERT INTO system_config (parking_fee, total_capacity, auto_detection, sound_alert) 
                        VALUES (:fee, :capacity, :auto_detect, :sound)
                    """),
                    {
                        "fee": config.parking_fee,
                        "capacity": config.total_capacity,
                        "auto_detect": config.auto_detection,
                        "sound": config.sound_alert
                    }
                )
        
        return {
            "success": True,
            "message": "Configuration updated successfully"
        }
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))

@app.get("/api/stats")
async def get_database_stats():
    """Get database statistics for configuration page"""
    try:
        with engine.connect() as conn:
            total_records = conn.execute(
                text("SELECT COUNT(*) FROM vehicle_records")
            ).scalar()
            
            records_in = conn.execute(
                text("SELECT COUNT(*) FROM vehicle_records WHERE status = 'IN'")
            ).scalar()
            
            records_out = conn.execute(
                text("SELECT COUNT(*) FROM vehicle_records WHERE status = 'OUT'")
            ).scalar()
            
            return {
                "total_records": total_records,
                "records_in": records_in,
                "records_out": records_out
            }
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))

@app.delete("/api/clear-records")
async def clear_all_records():
    """Clear all vehicle records (WARNING: Destructive operation)"""
    try:
        with engine.begin() as conn:
            conn.execute(text("DELETE FROM vehicle_records"))
        
        return {
            "success": True,
            "message": "All records cleared successfully"
        }
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))

@app.get("/api/export-data")
async def export_data():
    """Export all vehicle records as JSON"""
    try:
        with engine.connect() as conn:
            result = conn.execute(
                text("""
                    SELECT id, plate_number, vehicle_type, time_in, time_out, status, total_price 
                    FROM vehicle_records 
                    ORDER BY id DESC
                """)
            )
            records = []
            for row in result:
                records.append({
                    "id": row[0],
                    "plate_number": row[1],
                    "vehicle_type": row[2],
                    "time_in": row[3].isoformat() if row[3] else None,
                    "time_out": row[4].isoformat() if row[4] else None,
                    "status": row[5],
                    "total_price": float(row[6]) if row[6] else 0
                })
            
            return {
                "success": True,
                "total_records": len(records),
                "export_date": datetime.now().isoformat(),
                "data": records
            }
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))

@app.get("/api/dashboard")
async def get_dashboard():
    """Get dashboard statistics"""
    try:
        with engine.connect() as conn:
            # Count vehicles IN
            vehicles_in = conn.execute(
                text("SELECT COUNT(*) FROM vehicle_records WHERE status = 'IN'")
            ).scalar()
            
            # Count vehicles OUT
            vehicles_out = conn.execute(
                text("SELECT COUNT(*) FROM vehicle_records WHERE status = 'OUT'")
            ).scalar()
            
            # Total revenue
            total_revenue = conn.execute(
                text("SELECT COALESCE(SUM(total_price), 0) FROM vehicle_records")
            ).scalar()
            
            config = conn.execute(
                text("""
                    SELECT total_capacity 
                    FROM system_config 
                    ORDER BY id DESC 
                    LIMIT 1
                """)
            ).fetchone()
            
            total_capacity = config[0] if config else 100

            return {
                "vehiclesIn": vehicles_in,
                "vehiclesOut": vehicles_out,
                "totalRevenue": int(total_revenue),
                "totalCapacity": total_capacity
            }
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))

@app.get("/api/vehicles")
async def get_all_vehicles():
    """Get all vehicle records"""
    try:
        with engine.connect() as conn:
            result = conn.execute(
                text("""
                    SELECT id, plate_number, vehicle_type, time_in, time_out, status, total_price 
                    FROM vehicle_records 
                    ORDER BY id DESC
                """)
            )
            vehicles = []
            for row in result:
                vehicles.append({
                    "id": row[0],
                    "plate_number": row[1],
                    "vehicle_type": row[2],
                    "time_in": row[3].isoformat() if row[3] else None,
                    "time_out": row[4].isoformat() if row[4] else None,
                    "status": row[5],
                    "total_price": float(row[6]) if row[6] else 0
                })
            return vehicles
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))

@app.get("/api/recent-history")
async def get_recent_history():
    """Get recent 10 vehicle records"""
    try:
        with engine.connect() as conn:
            result = conn.execute(
                text("""
                    SELECT id, plate_number, vehicle_type, time_in, status 
                    FROM vehicle_records 
                    ORDER BY id DESC 
                    LIMIT 10
                """)
            )
            history = []
            for row in result:
                history.append({
                    "id": row[0],
                    "plate_number": row[1],
                    "vehicle_type": row[2],
                    "time_in": row[3].isoformat() if row[3] else None,
                    "status": row[4]
                })
            return history
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))

@app.get("/api/check-vehicle/{plate_number}")
async def check_vehicle(plate_number: str):
    """Check if a vehicle is currently in the parking lot"""
    try:
        with engine.connect() as conn:
            result = conn.execute(
                text("""
                    SELECT id, plate_number, time_in, status 
                    FROM vehicle_records 
                    WHERE plate_number = :plate AND status = 'IN'
                    ORDER BY id DESC 
                    LIMIT 1
                """),
                {"plate": plate_number}
            ).fetchone()
            
            if result:
                return {
                    "exists": True,
                    "id": result[0],
                    "plate_number": result[1],
                    "time_in": result[2].isoformat() if result[2] else None,
                    "status": result[3]
                }
            else:
                return {"exists": False}
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))

@app.post("/api/vehicle-entry")
async def register_vehicle_entry(entry: VehicleEntry):
    """Register a new vehicle entry"""
    try:
        if not is_valid_vietnam_plate(entry.plate_number):
            raise HTTPException(
                status_code=400,
                detail="Invalid license plate format! Example: 51F-97022 or 29A12345"
            )
        
        # Check if vehicle is already inside
        with engine.connect() as conn:
            existing = conn.execute(
                text("SELECT id FROM vehicle_records WHERE plate_number = :plate AND status = 'IN'"),
                {"plate": entry.plate_number}
            ).fetchone()
            
            if existing:
                return {
                    "success": False,
                    "message": "Vehicle is already inside the parking lot"
                }
        
        # Insert new entry
        with engine.begin() as conn:
            conn.execute(
                text("""
                    INSERT INTO vehicle_records (plate_number, vehicle_type, status, time_in) 
                    VALUES (:plate, :type, 'IN', NOW())
                """),
                {"plate": entry.plate_number, "type": entry.vehicle_type}
            )
        
        return {
            "success": True,
            "message": "Vehicle entry registered successfully"
        }
    except HTTPException as e:
        raise e
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))

@app.post("/api/vehicle-exit")
async def register_vehicle_exit(exit_data: VehicleExit):
    """Register a vehicle exit and calculate fee"""
    try:
        if not is_valid_vietnam_plate(exit_data.plate_number):
            raise HTTPException(
                status_code=400,
                detail="Invalid license plate format! Example: 51F-97022 or 29A12345"
            )

        # Check if vehicle exists and is IN
        with engine.connect() as conn:
            vehicle = conn.execute(
                text("""
                    SELECT id, time_in 
                    FROM vehicle_records 
                    WHERE plate_number = :plate AND status = 'IN'
                    ORDER BY id DESC 
                    LIMIT 1
                """),
                {"plate": exit_data.plate_number}
            ).fetchone()
            
            if not vehicle:
                return {
                    "success": False,
                    "message": "Vehicle not found or already exited"
                }
        
        # Calculate fee (simple: 5000 VND flat rate, can be enhanced)
        fee = 5000
        
        # Update record
        with engine.begin() as conn:
            conn.execute(
                text("""
                    UPDATE vehicle_records 
                    SET status = 'OUT', time_out = NOW(), total_price = :fee 
                    WHERE id = :id
                """),
                {"id": vehicle[0], "fee": fee}
            )
        
        return {
            "success": True,
            "message": "Vehicle exit registered successfully",
            "fee": fee
        }
    except HTTPException as e:
        raise e
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))

@app.post("/api/process-frame")
async def process_video_frame(frame: UploadFile = File(...)):
    global frame_counter
    """Process a video frame for license plate detection using your processor.py"""
    try:
        # Read the uploaded image
        contents = await frame.read()
        nparr = np.frombuffer(contents, np.uint8)
        img = cv2.imdecode(nparr, cv2.IMREAD_COLOR)
        
        if img is None:
            raise HTTPException(status_code=400, detail="Invalid image")

        frame_counter += 1

        if frame_counter % FRAME_SKIP != 0:
            return {
                "detected": True,
                "status": "SKIPPED"
            }
        
        # Use your existing process_frame function from processor.py
        plate_data = process_frame(img)
        
        if plate_data and len(plate_data) > 0:
            detected = plate_data[0]
            plate_text = detected.get("text", "").strip()

            if len(plate_text) < 5:
                return {
                    "detected": True,
                    "status": "SCANNING",
                    "plate_text": plate_text,
                    "vehicle_type": detected.get("type", "Car"),
                    "confidence": 40
                }

            confirmed_plate = confirm_plate(plate_text)

            if confirmed_plate:
                return {
                    "detected": True,
                    "status": "CONFIRMED",
                    "plate_text": confirmed_plate,
                    "vehicle_type": detected.get("type", "Car"),
                    "confidence": 85.0,
                    "bounding_box": detected.get("box", [])
                }
            else:
                return {
                    "detected": True,
                    "status": "SCANNING",
                    "plate_text": plate_text,
                    "vehicle_type": detected.get("type", "Car"),
                    "confidence": 60
                }
        else:
            return {
                "detected": False,
                "plate_text": "",
                "vehicle_type": "",
                "confidence": 0,
                "bounding_box": []
            }
    except Exception as e:
        print(f"Error processing frame: {e}")
        raise HTTPException(status_code=500, detail=str(e))

@app.get("/")
async def root():
    return {"message": "SmartPark AI Backend is running"}

if __name__ == "__main__":
    uvicorn.run(app, host="0.0.0.0", port=8000)