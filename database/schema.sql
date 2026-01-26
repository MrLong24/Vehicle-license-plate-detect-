-- Create database
CREATE DATABASE IF NOT EXISTS smart_parking_its;
USE smart_parking_its;

-- Create vehicle records table
CREATE TABLE IF NOT EXISTS vehicle_records (
    id INT AUTO_INCREMENT PRIMARY KEY,
    plate_number VARCHAR(20) NOT NULL,
    vehicle_type VARCHAR(50) DEFAULT 'Car',
    time_in TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    time_out TIMESTAMP NULL,
    status ENUM('IN', 'OUT') DEFAULT 'IN',
    total_price DECIMAL(10, 2) DEFAULT 0,
    INDEX idx_plate (plate_number),
    INDEX idx_status (status),
    INDEX idx_time_in (time_in)
);

-- Optional: Create user activity log
CREATE TABLE IF NOT EXISTS activity_log (
    id INT AUTO_INCREMENT PRIMARY KEY,
    action_type ENUM('ENTRY', 'EXIT', 'SCAN'),
    plate_number VARCHAR(20),
    timestamp TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    details TEXT
);

CREATE TABLE IF NOT EXISTS system_config (
    id INT PRIMARY KEY AUTO_INCREMENT,

    parking_fee INT NOT NULL DEFAULT 5000,
    total_capacity INT NOT NULL DEFAULT 100,

    auto_detection BOOLEAN DEFAULT TRUE,
    sound_alert BOOLEAN DEFAULT TRUE,

    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP
);

-- Add some test data
INSERT INTO vehicle_records (plate_number, vehicle_type, status, time_in) VALUES
('51F 97022', 'Car', 'IN', NOW() - INTERVAL 30 MINUTE),
('29A 12345', 'Car', 'IN', NOW() - INTERVAL 1 HOUR),
('30B 67890', 'Motorcycle', 'IN', NOW() - INTERVAL 15 MINUTE);

-- Add some completed records
INSERT INTO vehicle_records (plate_number, vehicle_type, status, time_in, time_out, total_price) VALUES
('59C 11111', 'Car', 'OUT', NOW() - INTERVAL 3 HOUR, NOW() - INTERVAL 1 HOUR, 5000),
('77D 22222', 'Car', 'OUT', NOW() - INTERVAL 5 HOUR, NOW() - INTERVAL 2 HOUR, 5000);