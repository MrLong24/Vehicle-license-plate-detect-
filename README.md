# 🚗 SmartPark AI

AI-powered parking management system with automatic license plate recognition.

## ✨ Features

- 🎯 **Auto License Plate Detection** - AI recognizes plates automatically
- 📊 **Real-time Dashboard** - Monitor parking status live
- 💰 **Automatic Billing** - Calculate fees on vehicle exit
- 🔍 **Vehicle Search** - Find any vehicle by plate number
- ⚙️ **Easy Configuration** - Manage settings from web interface

---

## 🚀 Quick Start

### Option 1: Docker (Recommended - Easiest!)

**Requirements:** Docker & Docker Compose installed

```bash
# 1. Clone the project
git clone https://github.com/yourusername/smartpark-ai.git
cd smartpark-ai

# 2. Start everything with one command!
docker-compose up -d

# 3. Wait ~30 seconds for services to start
# Check status
docker-compose ps

# 4. Open browser
# Frontend: http://localhost:3000
# Backend:  http://localhost:8000
```

**That's it! Everything is running.** ✅

**Useful Docker Commands:**
```bash
docker-compose down          # Stop all services
docker-compose logs -f       # View logs
docker-compose restart       # Restart services
docker-compose down -v       # Stop and remove data
```

---

### Option 2: Manual Installation

**Requirements:** Python 3.8+, Node.js 16+, MySQL 8.0+

#### Step 1: Install Dependencies

```bash
# Backend
cd backend
pip install fastapi uvicorn opencv-python ultralytics easyocr sqlalchemy mysql-connector-python

# Frontend
cd frontend
npm install
```

#### Step 2: Setup Database

```bash
mysql -u root -p < database/schema.sql
```

Or manually:
```sql
CREATE DATABASE smart_parking_its;
USE smart_parking_its;

CREATE TABLE vehicle_records (
    id INT AUTO_INCREMENT PRIMARY KEY,
    plate_number VARCHAR(20) NOT NULL,
    vehicle_type VARCHAR(50) DEFAULT 'Car',
    time_in TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    time_out TIMESTAMP NULL,
    status ENUM('IN', 'OUT') DEFAULT 'IN',
    total_price DECIMAL(10, 2) DEFAULT 0
);

CREATE TABLE system_config (
    id INT PRIMARY KEY AUTO_INCREMENT,
    parking_fee INT NOT NULL DEFAULT 5000,
    total_capacity INT NOT NULL DEFAULT 100,
    auto_detection BOOLEAN DEFAULT TRUE,
    sound_alert BOOLEAN DEFAULT TRUE
);

INSERT INTO system_config (parking_fee, total_capacity) VALUES (5000, 100);
```

#### Step 3: Configure & Run

Edit `backend/backend.py`:
```python
DATABASE_URL = "mysql+mysqlconnector://root:your_password@localhost:3306/smart_parking_its" # Change "localhost" to "db" if you are running Docker.
```

Start servers:
```bash
# Terminal 1 - Backend
cd backend
python backend.py

# Terminal 2 - Frontend
cd frontend
npm start
```

Open `http://localhost:3000`

---

## 📖 How to Use

### Vehicle Entry
1. Click **"Vehicle Entry"**
2. Click **"Start Feed"** for camera
3. Show license plate to camera
4. Click **"Authorize Entry"** when detected

### Vehicle Exit
1. Click **"Vehicle Exit"**
2. Scan license plate
3. System shows parking fee
4. Click **"Authorize Entry"** to complete exit

### Configuration
1. Go to **"Configuration"**
2. Change parking fee, capacity, settings
3. Click **"Save Changes"**

---

## 🔧 Configuration

Edit settings in `backend.py`:

```python
PLATE_CONFIRM_THRESHOLD = 2   # Detections needed to confirm
PLATE_COOLDOWN = 1.5          # Seconds between same plate
FRAME_SKIP = 2                # Process every 2nd frame
```

---

## 📁 Project Files

```
smartpark-ai/
├── backend/
│   ├── backend.py         # API server
│   ├── processor.py       # AI detection
│   └── best3.pt          # YOLO model
├── frontend/
│   └── src/
│       └── App.js        # React app
└── schema.sql            # Database setup
```

---

## 🐛 Troubleshooting

**Camera not working?**
- Allow camera permissions in browser
- Use Chrome or Edge browser

**Database error?**
- Check MySQL is running: `sudo systemctl status mysql`
- Verify password in `DATABASE_URL`

**Slow detection?**
- Close other apps
- Reduce `FRAME_SKIP` to 1

**Wrong plate detected?**
- Better lighting needed
- Adjust camera angle

---

## 🔌 API Endpoints

```http
POST /api/vehicle-entry      # Register entry
POST /api/vehicle-exit       # Register exit
GET  /api/dashboard          # Get stats
GET  /api/vehicles           # Get all vehicles
POST /api/process-frame      # Process camera frame
GET  /api/config             # Get settings
POST /api/config             # Save settings
```

---

## 📊 Tech Stack

- **Backend**: Python, FastAPI, YOLO, EasyOCR
- **Frontend**: React, Tailwind CSS
- **Database**: MySQL
- **AI**: Ultralytics YOLO + EasyOCR

---

## 📄 License

MIT License - feel free to use and modify
