import React, { useState, useRef, useEffect } from 'react';
import { Camera, Pause, StopCircle, Filter, FileText, BarChart3, Car, LogOut, LogIn, Search, Settings, RefreshCw } from 'lucide-react';

const SmartParkApp = () => {
  const [currentPage, setCurrentPage] = useState('entry');
  const [cameraActive, setCameraActive] = useState(false);
  const [isScanning, setIsScanning] = useState(false);
  const isScanningRef = useRef(false);
  const [detectedPlate, setDetectedPlate] = useState('');
  const [vehicleType, setVehicleType] = useState('');
  const [confidence, setConfidence] = useState(0);
  const [statusMessage, setStatusMessage] = useState('');
  const lastPlateRef = useRef('');
  const lastPlateTimeRef = useRef(0);
  const PLATE_COOLDOWN = 1500; // 3 giây
  const videoRef = useRef(null);
  const canvasRef = useRef(null);
  const streamRef = useRef(null);
  const detectionIntervalRef = useRef(null);
  const bufferResults = useRef([]);
  
  const [searchQuery, setSearchQuery] = useState('');
  const [vehicles, setVehicles] = useState([]);
  const [dashboardStats, setDashboardStats] = useState({
    vehiclesIn: 0,
    vehiclesOut: 0,
    totalRevenue: 0
  });
  const [recentHistory, setRecentHistory] = useState([]);
  const [loading, setLoading] = useState(false);

  // API base URL
  const API_BASE = 'http://localhost:8000/api';

  // Fetch dashboard data
  const fetchDashboard = async () => {
    try {
      const response = await fetch(`${API_BASE}/dashboard`);
      const data = await response.json();
      setDashboardStats(data);
    } catch (error) {
      console.error('Error fetching dashboard:', error);
    }
  };

  // Fetch all vehicles
  const fetchVehicles = async () => {
    try {
      const response = await fetch(`${API_BASE}/vehicles`);
      const data = await response.json();
      setVehicles(data);
    } catch (error) {
      console.error('Error fetching vehicles:', error);
    }
  };

  // Fetch recent history
  const fetchRecentHistory = async () => {
    try {
      const response = await fetch(`${API_BASE}/recent-history`);
      const data = await response.json();
      setRecentHistory(data);
    } catch (error) {
      console.error('Error fetching history:', error);
    }
  };

  const isValidVietnamPlate = (plate) => {
    if (!plate) return false;
    
    const cleaned = plate
    .toString()
    .trim()
    .toUpperCase()
    .replace(/[\s.-]+/g, '');

    if (cleaned.length < 7 || cleaned.length > 10) return false;

    const regex = /^[0-9]{2}[A-Z]{1,2}[0-9]{4,6}$/;
    return regex.test(cleaned);
  };

  // Check vehicle status
  const checkVehicleStatus = async (plate) => {
    try {
      const response = await fetch(`${API_BASE}/check-vehicle/${plate}`);
      const data = await response.json();
      return data;
    } catch (error) {
      console.error('Error checking vehicle:', error);
      return null;
    }
  };

  // Register vehicle entry
  const registerEntry = async (plate, type) => {
    try {
      setLoading(true);
      const response = await fetch(`${API_BASE}/vehicle-entry`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ plate_number: plate, vehicle_type: type })
      });
      const data = await response.json();
      
      if (data.success) {
        setStatusMessage('✅ Vehicle entry authorized!');
        setDetectedPlate('');
        setVehicleType('');
        bufferResults.current = [];

        lastPlateRef.current = '';

        await fetchDashboard();
        await fetchVehicles();
        await fetchRecentHistory();
      } else {
        setStatusMessage('❌ ' + data.message);
      }
    } catch (error) {
      console.error('Error registering entry:', error);
      setStatusMessage('❌ Error registering entry');
    } finally {
      setLoading(false);
    }
  };

  // Register vehicle exit
  const registerExit = async (plate) => {
    try {
      setLoading(true);
      const response = await fetch(`${API_BASE}/vehicle-exit`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ plate_number: plate })
      });
      const data = await response.json();
      
      if (data.success) {
        setStatusMessage(`✅ Vehicle exit authorized! Fee: ${data.fee} VND`);
        setDetectedPlate('');
        setVehicleType('');
        bufferResults.current = [];

        lastPlateRef.current = '';

        await fetchDashboard();
        await fetchVehicles();
        await fetchRecentHistory();
      } else {
        setStatusMessage('❌ ' + data.message);
      }
    } catch (error) {
      console.error('Error registering exit:', error);
      setStatusMessage('❌ Error registering exit');
    } finally {
      setLoading(false);
    }
  };

  // Process frame with AI detection - FIX: Không làm ảnh hưởng đến video stream
  const processFrame = async () => {
    if (!videoRef.current || !canvasRef.current) return;
    if (!isScanningRef.current) return;

    const video = videoRef.current;
    const canvas = canvasRef.current;
    
    // Kiểm tra video đã sẵn sàng
    if (video.readyState !== video.HAVE_ENOUGH_DATA) return;
    if (video.videoWidth === 0 || video.videoHeight === 0) return;

    const ctx = canvas.getContext('2d');

    // Set canvas size ONLY if changed
    if (canvas.width !== video.videoWidth || canvas.height !== video.videoHeight) {
      canvas.width = video.videoWidth;
      canvas.height = video.videoHeight;
    }

    try {
      // Draw frame to canvas - không clear, chỉ draw
      ctx.drawImage(video, 0, 0, canvas.width, canvas.height);

      // Convert to blob
      canvas.toBlob(async (blob) => {
        if (!blob || !isScanningRef.current) return;

        const formData = new FormData();
        formData.append('frame', blob, 'frame.jpg');

        try {
          const response = await fetch(`${API_BASE}/process-frame`, {
            method: 'POST',
            body: formData
          });

          if (!response.ok) return;

          const data = await response.json();

          if (data.detected && data.plate_text && isScanningRef.current) {
            const now = Date.now();
            const rawText = data.plate_text.toUpperCase();

            // Fix ký tự 1 dư ở cuối
            let fixedText = rawText;
            if (rawText.length > 8 && rawText.endsWith('1')) {
              fixedText = rawText.slice(0, -1);
            }

            // 🚫 BỎ QUA nếu cùng biển số và chưa hết cooldown
            if (
              fixedText === lastPlateRef.current &&
              now - lastPlateTimeRef.current < PLATE_COOLDOWN
            ) {
              requestAnimationFrame(processFrame);
              return;
            }

            setStatusMessage(`🔍 Scanning: ${fixedText}`);
            bufferResults.current.push(fixedText);

            // Buffer xác nhận
            if (bufferResults.current.length >= 3) {
              const counts = {};
              bufferResults.current.forEach(text => {
                counts[text] = (counts[text] || 0) + 1;
              });

              let mostCommon = '';
              let maxCount = 0;
              for (const [text, count] of Object.entries(counts)) {
                if (count > maxCount) {
                  maxCount = count;
                  mostCommon = text;
                }
              }

              // ✅ CONFIRM DETECT
              if (maxCount >= 2 && mostCommon !== lastPlateRef.current) {
                lastPlateRef.current = mostCommon;
                lastPlateTimeRef.current = now;

                setDetectedPlate(mostCommon);
                setVehicleType(data.vehicle_type || 'Car');
                setConfidence(data.confidence || 85);
                setStatusMessage(`✅ Detected: ${mostCommon}`);

                bufferResults.current = [];
              }

              bufferResults.current.shift();
            }
          }
        } catch (error) {
          console.error('Error processing frame:', error);
        }
      }, 'image/jpeg', 0.85);
    } catch (error) {
      console.error('Error in processFrame:', error);
    }
  };

  // Start camera - FIX: Đảm bảo video element ready
  const startCamera = async () => {
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ 
        video: { 
          width: { ideal: 640 },
          height: { ideal: 480 },
          facingMode: 'environment'
        } 
      });
      
      streamRef.current = stream;
      setCameraActive(true);
      setIsScanning(true);
      isScanningRef.current = true;
      setStatusMessage('📹 Camera active - Ready to scan');

      // Đợi video element ready
      setTimeout(() => {
        if (videoRef.current && streamRef.current) {
          videoRef.current.srcObject = streamRef.current;
          
          // Đợi metadata load xong
          videoRef.current.onloadedmetadata = () => {
            videoRef.current.play()
              .then(() => {
                console.log('Video playing successfully');
                // Start detection sau khi video chắc chắn đã play
                setTimeout(() => {
                  if (detectionIntervalRef.current) {
                    clearInterval(detectionIntervalRef.current);
                  }
                  detectionIntervalRef.current = setInterval(() => {
                    processFrame();
                  }, 250);
                }, 200);
              })
              .catch(e => console.error("Play error:", e));
          };
        }
      }, 100);

    } catch (error) {
      console.error('Error accessing camera:', error);
      setStatusMessage('❌ Camera access denied or not available');
      setCameraActive(false);
      setIsScanning(false);
      isScanningRef.current = false;
    }
  };

  // Stop camera
  const stopCamera = () => {
    isScanningRef.current = false;
    
    if (detectionIntervalRef.current) {
      clearInterval(detectionIntervalRef.current);
      detectionIntervalRef.current = null;
    }

    if (streamRef.current) {
      streamRef.current.getTracks().forEach(track => track.stop());
      streamRef.current = null;
    }

    if (videoRef.current) {
      videoRef.current.srcObject = null;
    }

    setCameraActive(false);
    setIsScanning(false);
    setStatusMessage('');
    bufferResults.current = [];
  };

  // Reset detection
  const resetDetection = () => {
    setDetectedPlate('');
    setVehicleType('');
    setConfidence(0);
    setStatusMessage('');
    bufferResults.current = [];
    if (cameraActive) {
      setIsScanning(true);
      isScanningRef.current = true;
    }
  };

  // Handle authorization
  const handleAuthorize = async () => {
    if (!detectedPlate) {
      setStatusMessage('❌ Vui lòng nhập biển số xe');
      return;
    }

    if (!isValidVietnamPlate(detectedPlate)) {
      setStatusMessage('❌ Biển số xe không hợp lệ!\nVí dụ đúng: 51F97022 hoặc 29A12345');
      return;
    }

    const vehicleStatus = await checkVehicleStatus(detectedPlate);
    
    if (vehicleStatus && vehicleStatus.status === 'IN') {
      await registerExit(detectedPlate);
    } else {
      await registerEntry(detectedPlate, vehicleType || 'Car');
    }
  };

  // Sync ref with state
  useEffect(() => {
    isScanningRef.current = isScanning;
  }, [isScanning]);

  // Load data on mount and page change
  useEffect(() => {
    fetchDashboard();
    fetchVehicles();
    fetchRecentHistory();
  }, [currentPage]);

  // Cleanup on unmount
  useEffect(() => {
    return () => {
      stopCamera();
    };
  }, []);

  const Sidebar = () => (
    <div className="w-64 bg-slate-900 h-screen flex flex-col">
      <div className="p-6 flex items-center gap-3">
        <div className="w-10 h-10 bg-blue-600 rounded-lg flex items-center justify-center">
          <Car className="w-6 h-6 text-white" />
        </div>
        <div>
          <h1 className="text-white font-bold text-lg">SmartPark</h1>
          <p className="text-slate-400 text-xs">AI Management</p>
        </div>
      </div>
      
      <div className="px-4 mt-4">
        <p className="text-slate-500 text-xs font-semibold mb-2 px-2">MAIN OPERATIONS</p>
        <button
          onClick={() => setCurrentPage('entry')}
          className={`w-full flex items-center gap-3 px-4 py-3 rounded-lg mb-1 ${
            currentPage === 'entry' ? 'bg-blue-600 text-white' : 'text-slate-300 hover:bg-slate-800'
          }`}
        >
          <LogIn className="w-5 h-5" />
          <span>Vehicle Entry</span>
        </button>
        
        <button
          onClick={() => setCurrentPage('exit')}
          className={`w-full flex items-center gap-3 px-4 py-3 rounded-lg mb-1 ${
            currentPage === 'exit' ? 'bg-blue-600 text-white' : 'text-slate-300 hover:bg-slate-800'
          }`}
        >
          <LogOut className="w-5 h-5" />
          <span>Vehicle Exit</span>
        </button>
      </div>
      
      <div className="px-4 mt-6">
        <p className="text-slate-500 text-xs font-semibold mb-2 px-2">MANAGEMENT</p>
        <button
          onClick={() => setCurrentPage('dashboard')}
          className={`w-full flex items-center gap-3 px-4 py-3 rounded-lg mb-1 ${
            currentPage === 'dashboard' ? 'bg-blue-600 text-white' : 'text-slate-300 hover:bg-slate-800'
          }`}
        >
          <BarChart3 className="w-5 h-5" />
          <span>Dashboard</span>
        </button>
        
        <button
          onClick={() => setCurrentPage('current')}
          className={`w-full flex items-center gap-3 px-4 py-3 rounded-lg mb-1 ${
            currentPage === 'current' ? 'bg-blue-600 text-white' : 'text-slate-300 hover:bg-slate-800'
          }`}
        >
          <Car className="w-5 h-5" />
          <span>Current Vehicles</span>
        </button>
        
        <button
          onClick={() => setCurrentPage('search')}
          className={`w-full flex items-center gap-3 px-4 py-3 rounded-lg mb-1 ${
            currentPage === 'search' ? 'bg-blue-600 text-white' : 'text-slate-300 hover:bg-slate-800'
          }`}
        >
          <Search className="w-5 h-5" />
          <span>Search Vehicle</span>
        </button>
        
        <button 
          onClick={() => setCurrentPage('config')}
          className={`w-full flex items-center gap-3 px-4 py-3 rounded-lg text-slate-300 hover:bg-slate-800 ${
            currentPage === 'config' ? 'bg-blue-600 text-white' : ''
          }`}
        >
          <Settings className="w-5 h-5" />
          <span>Configuration</span>
        </button>
      </div>
      
      <div className="mt-auto p-4">
        <div className="bg-slate-800 rounded-lg p-3 flex items-center gap-2">
          <div className="w-2 h-2 bg-green-500 rounded-full"></div>
          <div>
            <p className="text-slate-400 text-xs">System Status</p>
            <p className="text-white text-sm font-semibold">Operational</p>
          </div>
        </div>
      </div>
    </div>
  );

  const VehicleEntryPage = ({ detectedPlate }) => {
    const [vehicleInside, setVehicleInside] = useState(null);

    useEffect(() => {
      const checkStatus = async () => {
        if (detectedPlate) {
          const status = await checkVehicleStatus(detectedPlate);
          setVehicleInside(status);
        } else {
          setVehicleInside(null);
        }
      };
      checkStatus();
    }, [detectedPlate]);

    return (
      <div className="flex-1 bg-slate-950 text-white p-8 overflow-y-auto">
        <h2 className="text-3xl font-bold mb-2">Vehicle {currentPage === 'entry' ? 'Entry' : 'Exit'}</h2>
        <p className="text-slate-400 mb-8">Scan license plate to register {currentPage === 'entry' ? 'new arrival' : 'departure'}.</p>
        
        <div className="grid grid-cols-3 gap-6">
          <div className="col-span-2">
            <div className="bg-slate-900 rounded-xl p-6 mb-4">
              <div className="flex justify-between items-center mb-4">
                <div className="flex items-center gap-2">
                  <div className={`w-2 h-2 rounded-full ${cameraActive ? 'bg-red-500 animate-pulse' : 'bg-slate-600'}`}></div>
                  <span className="text-sm text-slate-400">{cameraActive ? 'LIVE REC' : 'OFFLINE'}</span>
                </div>
                <span className="text-sm text-slate-400">{currentPage === 'entry' ? 'ENTRY' : 'EXIT'} CAMERA</span>
              </div>
              
              <div className="bg-slate-800 rounded-lg aspect-video relative overflow-hidden">
                {/* Video luôn render, không bao giờ unmount */}
                <video
                  ref={videoRef}
                  autoPlay
                  playsInline
                  muted
                  style={{
                    width: '100%',
                    height: '100%',
                    objectFit: 'cover',
                    display: cameraActive ? 'block' : 'none'
                  }}
                />
                
                {/* Canvas ẩn để xử lý AI */}
                <canvas ref={canvasRef} style={{ display: 'none' }} />

                {/* Overlay khi camera offline - chỉ hiện khi camera TẮT */}
                {!cameraActive && (
                  <div className="absolute inset-0 flex items-center justify-center bg-slate-800">
                    <div className="text-center">
                      <Camera className="w-16 h-16 text-slate-600 mx-auto mb-4" />
                      <p className="text-slate-400 font-semibold">Camera Offline</p>
                      <p className="text-slate-500 text-sm">Start the camera stream to begin detection</p>
                    </div>
                  </div>
                )}

                {/* Overlays khi camera BẬT - LUÔN Ở TRÊN video */}
                {cameraActive && isScanning && !detectedPlate && (
                  <div className="absolute bottom-8 left-1/2 transform -translate-x-1/2 bg-blue-600 text-white px-6 py-2 rounded-full text-sm font-semibold animate-pulse z-10">
                    SCANNING FOR PLATES...
                  </div>
                )}
                
                {cameraActive && detectedPlate && (
                  <div className="absolute top-1/2 left-1/2 transform -translate-x-1/2 -translate-y-1/2 border-4 border-green-500 w-64 h-32 rounded-lg z-10">
                    <div className="absolute -top-8 left-1/2 transform -translate-x-1/2 bg-green-500 text-white px-4 py-1 rounded-full text-sm font-bold whitespace-nowrap">
                      ✓ Detected: {detectedPlate}
                    </div>
                  </div>
                )}
              </div>
              
              <div className="flex gap-3 mt-4">
                <button 
                  onClick={() => {
                    const newState = !isScanning;
                    setIsScanning(newState);
                    isScanningRef.current = newState;
                  }}
                  disabled={!cameraActive}
                  className="flex-1 bg-amber-600 hover:bg-amber-700 disabled:bg-slate-700 disabled:cursor-not-allowed text-white py-3 rounded-lg font-semibold flex items-center justify-center gap-2"
                >
                  <Pause className="w-5 h-5" />
                  {isScanning ? 'Pause Auto' : 'Resume Auto'}
                </button>
                <button
                  onClick={cameraActive ? stopCamera : startCamera}
                  className="flex-1 bg-blue-600 hover:bg-blue-700 text-white py-3 rounded-lg font-semibold flex items-center justify-center gap-2"
                >
                  <Camera className="w-5 h-5" />
                  {cameraActive ? 'Stop Feed' : 'Start Feed'}
                </button>
                <button
                  onClick={stopCamera}
                  disabled={!cameraActive}
                  className="flex-1 bg-slate-700 hover:bg-slate-600 disabled:bg-slate-800 disabled:cursor-not-allowed text-white py-3 rounded-lg font-semibold flex items-center justify-center gap-2"
                >
                  <StopCircle className="w-5 h-5" />
                  Stop
                </button>
              </div>
              
              {statusMessage && (
                <div className="mt-4 bg-slate-800 border border-slate-700 rounded-lg p-3 text-sm">
                  {statusMessage}
                </div>
              )}
            </div>
            
            {detectedPlate && (
              <div className="bg-slate-900 rounded-xl p-4">
                <p className="text-slate-400 text-sm mb-2">AI DETECTION</p>
                <div className="flex items-center gap-4">
                  <div className="w-16 h-16 bg-slate-800 rounded-lg flex items-center justify-center">
                    <Car className="w-8 h-8 text-blue-400" />
                  </div>
                  <div className="flex-1">
                    <p className="font-bold text-2xl">{detectedPlate}</p>
                    <p className="text-slate-400 text-sm">Confidence: {confidence.toFixed(1)}%</p>
                  </div>
                </div>
              </div>
            )}

            <div className="bg-slate-900 rounded-xl p-4 mt-4">
              <div className="flex justify-between items-center mb-3">
                <p className="text-slate-400 text-sm font-semibold">📊 Recent History</p>
                <button onClick={fetchRecentHistory} className="text-blue-400 hover:text-blue-300">
                  <RefreshCw className="w-4 h-4" />
                </button>
              </div>
              <div className="space-y-2">
                {recentHistory.slice(0, 5).map((record, idx) => (
                  <div key={idx} className="bg-slate-800 rounded p-2 text-xs flex justify-between">
                    <span className="font-semibold">{record.plate_number}</span>
                    <span className="text-slate-400">{new Date(record.time_in).toLocaleTimeString()}</span>
                    <span className={`px-2 py-0.5 rounded ${record.status === 'IN' ? 'bg-green-900 text-green-300' : 'bg-slate-700 text-slate-300'}`}>
                      {record.status}
                    </span>
                  </div>
                ))}
              </div>
            </div>
          </div>
          
          <div>
            <div className="bg-slate-900 rounded-xl p-6">
              <h3 className="text-xl font-bold mb-6">Details</h3>
              
              <div className="mb-4">
                <label className="text-slate-400 text-sm mb-2 block">License Plate</label>
                <input
                  type="text"
                  value={detectedPlate}
                  onChange={(e) => {
                    const value = e.target.value.toUpperCase();
                    setDetectedPlate(value);
                    // Optional: xóa message lỗi khi user gõ lại
                    if (statusMessage.includes('không hợp lệ')) setStatusMessage('');
                  }}
                  className={`w-full bg-slate-800 border rounded-lg px-4 py-3 text-white focus:outline-none ${
                    detectedPlate && !isValidVietnamPlate(detectedPlate)
                      ? 'border-red-500 focus:border-red-500'
                      : 'border-slate-700 focus:border-blue-500'
                  }`}
                  placeholder="51F-97022"
                />
                
                {/* Hiển thị lỗi ngay dưới input */}
                {detectedPlate && !isValidVietnamPlate(detectedPlate) && (
                  <p className="text-red-400 text-xs mt-1 flex items-center gap-1">
                    <span>⚠️</span> Biển số không đúng định dạng
                  </p>
                )}
              </div>
              
              <div className="mb-6">
                <label className="text-slate-400 text-sm mb-2 block">Vehicle Type</label>
                <input
                  type="text"
                  value={vehicleType}
                  onChange={(e) => setVehicleType(e.target.value)}
                  className="w-full bg-slate-800 border border-slate-700 rounded-lg px-4 py-3 text-white"
                  placeholder="Car"
                />
              </div>
              
              {vehicleInside && vehicleInside.status === 'IN' ? (
                <div className="bg-amber-900/30 border border-amber-700 rounded-lg p-4 mb-4">
                  <p className="text-amber-400 text-sm font-semibold">🔒 Vehicle Currently Inside</p>
                  <p className="text-slate-300 text-sm mt-1">
                    Entry: {new Date(vehicleInside.time_in).toLocaleTimeString()}
                  </p>
                </div>
              ) : detectedPlate ? (
                <div className="bg-blue-900/30 border border-blue-700 rounded-lg p-4 mb-4">
                  <p className="text-blue-400 text-sm font-semibold">✨ New Vehicle Ready</p>
                  <p className="text-slate-300 text-sm mt-1">Ready to authorize entry</p>
                </div>
              ) : null}
              
              <button
                onClick={handleAuthorize}
                disabled={!detectedPlate || loading}
                className="w-full bg-blue-600 hover:bg-blue-700 disabled:bg-slate-700 disabled:cursor-not-allowed text-white py-4 rounded-lg font-bold text-lg mb-3"
              >
                {loading ? 'Processing...' : 'Authorize Entry'}
              </button>

              <button
                onClick={resetDetection}
                className="w-full bg-slate-700 hover:bg-slate-600 text-white py-3 rounded-lg font-semibold flex items-center justify-center gap-2"
              >
                <RefreshCw className="w-4 h-4" />
                Reset
              </button>
            </div>
          </div>
        </div>
      </div>
    );
  };

  const DashboardPage = () => (
    <div className="flex-1 bg-slate-950 text-white p-8 overflow-y-auto">
      <div className="flex justify-between items-center mb-8">
        <div>
          <h2 className="text-3xl font-bold mb-2">Dashboard Overview</h2>
          <p className="text-slate-400">Real-time insights and parking analytics</p>
        </div>
        <div className="flex items-center gap-3">
          <button onClick={fetchDashboard} className="text-blue-400 hover:text-blue-300">
            <RefreshCw className="w-5 h-5" />
          </button>
          <div className="text-slate-400">Today: {new Date().toLocaleDateString()}</div>
        </div>
      </div>
      
      <div className="grid grid-cols-4 gap-4 mb-8">
        <div className="bg-slate-900 rounded-xl p-6">
          <div className="flex justify-between items-start mb-4">
            <div>
              <p className="text-slate-400 text-sm mb-1">Total Capacity</p>
              <p className="text-4xl font-bold">{dashboardStats.totalCapacity}</p>
            </div>
            <div className="w-12 h-12 bg-blue-900/30 rounded-lg flex items-center justify-center">
              <Car className="w-6 h-6 text-blue-400" />
            </div>
          </div>
          <p className="text-slate-500 text-sm">Total parking spaces configured</p>
        </div>
        
        <div className="bg-slate-900 rounded-xl p-6">
          <div className="flex justify-between items-start mb-4">
            <div>
              <p className="text-slate-400 text-sm mb-1">Current Occupancy</p>
              <p className="text-4xl font-bold">{dashboardStats.vehiclesIn}</p>
            </div>
            <div className="w-12 h-12 bg-purple-900/30 rounded-lg flex items-center justify-center">
              <BarChart3 className="w-6 h-6 text-purple-400" />
            </div>
          </div>
          <p className="text-slate-500 text-sm">{((dashboardStats.vehiclesIn / 100) * 100).toFixed(1)}% full</p>
        </div>
        
        <div className="bg-slate-900 rounded-xl p-6">
          <div className="flex justify-between items-start mb-4">
            <div>
              <p className="text-slate-400 text-sm mb-1">Vehicles Exited</p>
              <p className="text-4xl font-bold">{dashboardStats.vehiclesOut}</p>
            </div>
            <div className="w-12 h-12 bg-green-900/30 rounded-lg flex items-center justify-center">
              <LogOut className="w-6 h-6 text-green-400" />
            </div>
          </div>
          <p className="text-slate-500 text-sm">Total exits processed</p>
        </div>
        
        <div className="bg-slate-900 rounded-xl p-6">
          <div className="flex justify-between items-start mb-4">
            <div>
              <p className="text-slate-400 text-sm mb-1">Total Revenue</p>
              <p className="text-4xl font-bold">{dashboardStats.totalRevenue.toLocaleString()}</p>
            </div>
            <div className="w-12 h-12 bg-amber-900/30 rounded-lg flex items-center justify-center">
              <span className="text-2xl">₫</span>
            </div>
          </div>
          <p className="text-slate-500 text-sm">VND collected today</p>
        </div>
      </div>
      
      <div className="grid grid-cols-3 gap-6">
        <div className="col-span-2 bg-slate-900 rounded-xl p-6">
          <h3 className="text-xl font-bold mb-6">Occupancy Distribution</h3>
          <div className="h-64 flex items-end gap-8 px-8">
            <div className="flex-1 flex flex-col items-center">
              <div 
                className="w-full bg-blue-600 rounded-t-lg transition-all duration-500" 
                style={{height: `${Math.max((dashboardStats.vehiclesIn / (dashboardStats.totalCapacity || 1)) * 100, 5)}%`}}
              ></div>
              <p className="text-slate-400 text-sm mt-3">Occupied</p>
              <p className="text-white font-bold">{dashboardStats.vehiclesIn}</p>
            </div>
            <div className="flex-1 flex flex-col items-center">
              <div 
                className="w-full bg-slate-700 rounded-t-lg transition-all duration-500" 
                style={{height: `${Math.max(((dashboardStats.totalCapacity - dashboardStats.vehiclesIn) / (dashboardStats.totalCapacity || 1)) * 100, 5)}%`}}
              ></div>
              <p className="text-slate-400 text-sm mt-3">Available</p>
              <p className="text-white font-bold">{dashboardStats.totalCapacity - dashboardStats.vehiclesIn}</p>
            </div>
          </div>
        </div>
        
        <div className="bg-slate-900 rounded-xl p-6 flex flex-col items-center justify-center">
          <h3 className="text-xl font-bold mb-6">Live Capacity</h3>
          <div className="relative w-48 h-48">
            <svg className="w-full h-full transform -rotate-90">
              <circle
                cx="96"
                cy="96"
                r="80"
                stroke="#1e293b"
                strokeWidth="16"
                fill="none"
              />
              <circle
                cx="96"
                cy="96"
                r="80"
                stroke="#3b82f6"
                strokeWidth="16"
                fill="none"
                strokeDasharray={`${(((dashboardStats.totalCapacity || 100) - dashboardStats.vehiclesIn) / (dashboardStats.totalCapacity || 100)) * 502.4} 502.4`}
                className="transition-all duration-500"
              />
            </svg>
            <div className="absolute inset-0 flex flex-col items-center justify-center">
              <p className="text-5xl font-bold">{dashboardStats.totalCapacity - dashboardStats.vehiclesIn}</p>
              <p className="text-slate-400 text-sm">AVAILABLE</p>
            </div>
          </div>
        </div>
      </div>
      
      <div className="bg-slate-900 rounded-xl p-6 mt-6">
        <h3 className="text-xl font-bold mb-4">Recent Activity</h3>
        <table className="w-full">
          <thead>
            <tr className="text-left text-slate-400 text-sm border-b border-slate-800">
              <th className="pb-3">Vehicle ID</th>
              <th className="pb-3">License Plate</th>
              <th className="pb-3">Type</th>
              <th className="pb-3">Entry Time</th>
              <th className="pb-3">Status</th>
            </tr>
          </thead>
          <tbody>
            {recentHistory.slice(0, 10).map((v, idx) => (
              <tr key={idx} className="border-b border-slate-800 text-sm">
                <td className="py-3">{v.id}</td>
                <td className="py-3 font-semibold">{v.plate_number}</td>
                <td className="py-3">{v.vehicle_type}</td>
                <td className="py-3">{new Date(v.time_in).toLocaleString()}</td>
                <td className="py-3">
                  <span className={`px-3 py-1 rounded-full text-xs ${
                    v.status === 'IN' ? 'bg-green-900/30 text-green-400' : 'bg-slate-800 text-slate-400'
                  }`}>
                    {v.status}
                  </span>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );

  const CurrentVehiclesPage = () => {
    const currentVehicles = vehicles.filter(v => v.status === 'IN');
    const filteredVehicles = currentVehicles.filter(v => 
      v.plate_number.toLowerCase().includes(searchQuery.toLowerCase()) ||
      v.id.toString().includes(searchQuery)
    );
    const inputRef = useRef(null);

    useEffect(() => {
      if (inputRef.current) {
        const len = searchQuery.length;
        inputRef.current.focus();
        inputRef.current.setSelectionRange(len, len);
      }
    // eslint-disable-next-line react-hooks/exhaustive-deps 
    }, [searchQuery]);

    return (
      <div className="flex-1 bg-slate-950 text-white p-8 overflow-y-auto">
        <div className="flex justify-between items-center mb-8">
          <div>
            <h2 className="text-3xl font-bold mb-2">Current Vehicles</h2>
            <p className="text-slate-400">Real-time inventory of parked vehicles</p>
          </div>
          <div className="flex gap-3">
            <button onClick={fetchVehicles} className="bg-slate-800 hover:bg-slate-700 p-3 rounded-lg">
              <RefreshCw className="w-5 h-5" />
            </button>
            <button className="bg-slate-800 hover:bg-slate-700 p-3 rounded-lg">
              <Filter className="w-5 h-5" />
            </button>
            <button className="bg-slate-800 hover:bg-slate-700 p-3 rounded-lg">
              <FileText className="w-5 h-5" />
            </button>
          </div>
        </div>
        
        <div className="bg-slate-900 rounded-xl p-6">
          <div className="mb-6">
            <div className="relative">
              <Search className="absolute left-4 top-1/2 transform -translate-y-1/2 w-5 h-5 text-slate-400" />
              <input
                ref={inputRef}
                type="text"
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                placeholder="Search by plate number or ID..."
                className="w-full bg-slate-800 border border-slate-700 rounded-lg pl-12 pr-4 py-3 text-white focus:outline-none focus:border-blue-500"
              />
            </div>
          </div>
          
          {filteredVehicles.length === 0 ? (
            <div className="text-center py-16">
              <Car className="w-16 h-16 text-slate-700 mx-auto mb-4" />
              <p className="text-slate-400">No vehicles found matching your search.</p>
            </div>
          ) : (
            <table className="w-full">
              <thead>
                <tr className="text-left text-slate-400 text-sm border-b border-slate-800">
                  <th className="pb-3">VEHICLE ID</th>
                  <th className="pb-3">LICENSE PLATE</th>
                  <th className="pb-3">TYPE</th>
                  <th className="pb-3">ENTRY TIME</th>
                  <th className="pb-3">DURATION</th>
                  <th className="pb-3">STATUS</th>
                </tr>
              </thead>
              <tbody>
                {filteredVehicles.map(v => {
                  const entryDate = new Date(v.time_in);
                  const duration = Math.floor((new Date() - entryDate) / 60000);
                  return (
                    <tr key={v.id} className="border-b border-slate-800">
                      <td className="py-4">{v.id}</td>
                      <td className="py-4 font-semibold text-lg">{v.plate_number}</td>
                      <td className="py-4">{v.vehicle_type}</td>
                      <td className="py-4">{entryDate.toLocaleString()}</td>
                      <td className="py-4">{duration} min</td>
                      <td className="py-4">
                        <span className="px-3 py-1 rounded-full text-xs bg-green-900/30 text-green-400">
                          {v.status}
                        </span>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          )}
          
          <div className="mt-6 flex justify-between items-center text-sm text-slate-400">
            <p>Showing {filteredVehicles.length} vehicles</p>
            <p>Last updated: {new Date().toLocaleTimeString()}</p>
          </div>
        </div>
      </div>
    );
  };

  // Search Vehicle Page
  const SearchVehiclePage = () => {
    const [searchPlate, setSearchPlate] = useState('');
    const [searchResult, setSearchResult] = useState(null);
    const [searching, setSearching] = useState(false);

    const handleSearch = async () => {
      if (!searchPlate.trim()) return;
      
      setSearching(true);
      try {
        const allVehicles = await fetch(`${API_BASE}/vehicles`).then(r => r.json());
        const found = allVehicles.filter(v => 
          v.plate_number.toLowerCase().includes(searchPlate.toLowerCase())
        );
        setSearchResult(found);
      } catch (error) {
        console.error('Search error:', error);
        setSearchResult([]);
      } finally {
        setSearching(false);
      }
    };

    return (
      <div className="flex-1 bg-slate-950 text-white p-8 overflow-y-auto">
        <h2 className="text-3xl font-bold mb-2">Search Vehicle</h2>
        <p className="text-slate-400 mb-8">Find vehicle records by license plate number</p>
        
        <div className="bg-slate-900 rounded-xl p-6 mb-6">
          <div className="flex gap-3">
            <div className="relative flex-1">
              <Search className="absolute left-4 top-1/2 transform -translate-y-1/2 w-5 h-5 text-slate-400" />
              <input
                type="text"
                value={searchPlate}
                onChange={(e) => setSearchPlate(e.target.value.toUpperCase())}
                onKeyPress={(e) => e.key === 'Enter' && handleSearch()}
                placeholder="Enter license plate number (e.g., 51F-97022)"
                className="w-full bg-slate-800 border border-slate-700 rounded-lg pl-12 pr-4 py-4 text-white text-lg focus:outline-none focus:border-blue-500"
              />
            </div>
            <button
              onClick={handleSearch}
              disabled={!searchPlate.trim() || searching}
              className="bg-blue-600 hover:bg-blue-700 disabled:bg-slate-700 disabled:cursor-not-allowed px-8 py-4 rounded-lg font-semibold flex items-center gap-2"
            >
              <Search className="w-5 h-5" />
              {searching ? 'Searching...' : 'Search'}
            </button>
          </div>
        </div>

        {searchResult !== null && (
          <div className="bg-slate-900 rounded-xl p-6">
            <h3 className="text-xl font-bold mb-4">Search Results ({searchResult.length})</h3>
            
            {searchResult.length === 0 ? (
              <div className="text-center py-16">
                <Car className="w-16 h-16 text-slate-700 mx-auto mb-4" />
                <p className="text-slate-400">No vehicles found with plate: <span className="font-bold">{searchPlate}</span></p>
              </div>
            ) : (
              <div className="space-y-4">
                {searchResult.map(v => {
                  const entryDate = new Date(v.time_in);
                  const exitDate = v.time_out ? new Date(v.time_out) : null;
                  const duration = exitDate 
                    ? Math.floor((exitDate - entryDate) / 60000)
                    : Math.floor((new Date() - entryDate) / 60000);
                  
                  return (
                    <div key={v.id} className="bg-slate-800 rounded-lg p-6">
                      <div className="grid grid-cols-2 gap-6">
                        <div>
                          <p className="text-slate-400 text-sm mb-1">License Plate</p>
                          <p className="text-2xl font-bold text-blue-400">{v.plate_number}</p>
                        </div>
                        <div>
                          <p className="text-slate-400 text-sm mb-1">Vehicle Type</p>
                          <p className="text-xl font-semibold">{v.vehicle_type}</p>
                        </div>
                        <div>
                          <p className="text-slate-400 text-sm mb-1">Entry Time</p>
                          <p className="font-semibold">{entryDate.toLocaleString()}</p>
                        </div>
                        <div>
                          <p className="text-slate-400 text-sm mb-1">Exit Time</p>
                          <p className="font-semibold">{exitDate ? exitDate.toLocaleString() : '-'}</p>
                        </div>
                        <div>
                          <p className="text-slate-400 text-sm mb-1">Duration</p>
                          <p className="font-semibold">{Math.floor(duration / 60)}h {duration % 60}m</p>
                        </div>
                        <div>
                          <p className="text-slate-400 text-sm mb-1">Status</p>
                          <span className={`inline-block px-4 py-1 rounded-full text-sm font-semibold ${
                            v.status === 'IN' 
                              ? 'bg-green-900/30 text-green-400 border border-green-700' 
                              : 'bg-slate-700 text-slate-300 border border-slate-600'
                          }`}>
                            {v.status === 'IN' ? '🔒 Currently Inside' : '✅ Exited'}
                          </span>
                        </div>
                        {v.total_price > 0 && (
                          <div className="col-span-2">
                            <p className="text-slate-400 text-sm mb-1">Fee Paid</p>
                            <p className="text-xl font-bold text-amber-400">{v.total_price.toLocaleString()} VND</p>
                          </div>
                        )}
                      </div>
                    </div>
                  );
                })}
              </div>
            )}
          </div>
        )}
      </div>
    );
  };

  // Configuration Page - NEW
  // Replace the ConfigurationPage component in your App.js with this updated version:

  const ConfigurationPage = () => {
    const [settings, setSettings] = useState({
      parkingFee: 5000,
      capacity: 100,
      autoDetect: true,
      soundAlert: true
    });
    
    const [dbStats, setDbStats] = useState({
      total_records: 0,
      records_in: 0,
      records_out: 0
    });
    
    const [saving, setSaving] = useState(false);
    const [clearing, setClearing] = useState(false);
    const [exporting, setExporting] = useState(false);
    const [message, setMessage] = useState({ type: '', text: '' });

    // Load configuration on mount
    useEffect(() => {
      fetchConfiguration();
      fetchDatabaseStats();
    // eslint-disable-next-line react-hooks/exhaustive-deps
    }, []);

    const fetchConfiguration = async () => {
      try {
        const response = await fetch(`${API_BASE}/config`);
        const data = await response.json();
        setSettings({
          parkingFee: data.parking_fee,
          capacity: data.total_capacity,
          autoDetect: data.auto_detection,
          soundAlert: data.sound_alert
        });
      } catch (error) {
        console.error('Error fetching config:', error);
        showMessage('error', 'Failed to load configuration');
      }
    };

    const fetchDatabaseStats = async () => {
      try {
        const response = await fetch(`${API_BASE}/stats`);
        const data = await response.json();
        setDbStats(data);
      } catch (error) {
        console.error('Error fetching stats:', error);
      }
    };

    const showMessage = (type, text) => {
      setMessage({ type, text });
      setTimeout(() => setMessage({ type: '', text: '' }), 3000);
    };

    const normalizeSettings = (currentSettings) => {
      const normalizedParkingFee = currentSettings.parkingFee > 0 ? currentSettings.parkingFee : 5000;
      const normalizedCapacity = currentSettings.capacity > 0 ? currentSettings.capacity : 1;

      return {
        ...currentSettings,
        parkingFee: normalizedParkingFee,
        capacity: normalizedCapacity
      };
    };

    const handleSave = async () => {
      setSaving(true);
      try {
        const finalSettings = normalizeSettings(settings);

        if (
          finalSettings.parkingFee !== settings.parkingFee ||
          finalSettings.capacity !== settings.capacity
        ) {
          setSettings(finalSettings);
        }

        const response = await fetch(`${API_BASE}/config`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            parking_fee: finalSettings.parkingFee,
            total_capacity: finalSettings.capacity,
            auto_detection: finalSettings.autoDetect,
            sound_alert: finalSettings.soundAlert
          })
        });
        
        const data = await response.json();
        
        if (data.success) {
          showMessage('success', 'Settings saved successfully!');
          await fetchConfiguration();
        } else {
          showMessage('error', 'Failed to save settings');
        }
      } catch (error) {
        console.error('Error saving config:', error);
        showMessage('error', 'Error saving settings');
      } finally {
        setSaving(false);
      }
    };

    const handleClearRecords = async () => {
      if (!window.confirm('⚠️ WARNING: This will permanently delete ALL vehicle records. Are you sure?')) {
        return;
      }
      
      setClearing(true);
      try {
        const response = await fetch(`${API_BASE}/clear-records`, {
          method: 'DELETE'
        });
        
        const data = await response.json();
        
        if (data.success) {
          showMessage('success', 'All records cleared successfully');
          await fetchDatabaseStats();
          await fetchVehicles();
          await fetchDashboard();
        } else {
          showMessage('error', 'Failed to clear records');
        }
      } catch (error) {
        console.error('Error clearing records:', error);
        showMessage('error', 'Error clearing records');
      } finally {
        setClearing(false);
      }
    };

    const handleExportData = async () => {
      setExporting(true);
      try {
        const response = await fetch(`${API_BASE}/export-data`);
        const data = await response.json();
        
        if (data.success) {
          // Create downloadable JSON file
          const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' });
          const url = URL.createObjectURL(blob);
          const a = document.createElement('a');
          a.href = url;
          a.download = `smartpark_export_${new Date().toISOString().split('T')[0]}.json`;
          document.body.appendChild(a);
          a.click();
          document.body.removeChild(a);
          URL.revokeObjectURL(url);
          
          showMessage('success', `Exported ${data.total_records} records successfully`);
        } else {
          showMessage('error', 'Failed to export data');
        }
      } catch (error) {
        console.error('Error exporting data:', error);
        showMessage('error', 'Error exporting data');
      } finally {
        setExporting(false);
      }
    };

    return (
      <div className="flex-1 bg-slate-950 text-white p-8 overflow-y-auto">
        <h2 className="text-3xl font-bold mb-2">System Configuration</h2>
        <p className="text-slate-400 mb-8">Configure parking system settings and preferences</p>
        
        {/* Success/Error Message */}
        {message.text && (
          <div className={`mb-6 p-4 rounded-lg border ${
            message.type === 'success' 
              ? 'bg-green-900/30 border-green-700 text-green-400' 
              : 'bg-red-900/30 border-red-700 text-red-400'
          }`}>
            {message.text}
          </div>
        )}
        
        <div className="grid grid-cols-2 gap-6">
          {/* Parking Settings */}
          <div className="bg-slate-900 rounded-xl p-6">
            <h3 className="text-xl font-bold mb-6 flex items-center gap-2">
              <Car className="w-6 h-6 text-blue-400" />
              Parking Settings
            </h3>
            
            <div className="space-y-4">
              <div>
                <label className="text-slate-400 text-sm mb-2 block">Parking Fee (VND)</label>
                <input
                  type="number"
                  value={settings.parkingFee}
                  onChange={(e) => setSettings({...settings, parkingFee: parseInt(e.target.value) || 0})}
                  className="w-full bg-slate-800 border border-slate-700 rounded-lg px-4 py-3 text-white focus:outline-none focus:border-blue-500"
                />
                <p className="text-slate-500 text-xs mt-1">Base fee charged per vehicle exit</p>
              </div>
              
              <div>
                <label className="text-slate-400 text-sm mb-2 block">Total Capacity</label>
                <input
                  type="number"
                  value={settings.capacity}
                  onChange={(e) => setSettings({...settings, capacity: parseInt(e.target.value) || 0})}
                  className="w-full bg-slate-800 border border-slate-700 rounded-lg px-4 py-3 text-white focus:outline-none focus:border-blue-500"
                />
                <p className="text-slate-500 text-xs mt-1">Maximum number of parking spaces</p>
              </div>
            </div>
          </div>

          {/* AI Detection Settings */}
          <div className="bg-slate-900 rounded-xl p-6">
            <h3 className="text-xl font-bold mb-6 flex items-center gap-2">
              <Camera className="w-6 h-6 text-purple-400" />
              AI Detection
            </h3>
            
            <div className="space-y-4">
              <div className="flex items-center justify-between p-4 bg-slate-800 rounded-lg">
                <div>
                  <p className="font-semibold">Auto Detection</p>
                  <p className="text-slate-400 text-sm">Automatically detect license plates</p>
                </div>
                <button
                  onClick={() => setSettings({...settings, autoDetect: !settings.autoDetect})}
                  className={`relative w-14 h-7 rounded-full transition-colors ${
                    settings.autoDetect ? 'bg-blue-600' : 'bg-slate-700'
                  }`}
                >
                  <div className={`absolute top-1 w-5 h-5 bg-white rounded-full transform transition-transform ${
                    settings.autoDetect ? 'translate-x-8' : 'translate-x-1'
                  }`}></div>
                </button>
              </div>

              <div className="flex items-center justify-between p-4 bg-slate-800 rounded-lg">
                <div>
                  <p className="font-semibold">Sound Alert</p>
                  <p className="text-slate-400 text-sm">Play sound on detection</p>
                </div>
                <button
                  onClick={() => setSettings({...settings, soundAlert: !settings.soundAlert})}
                  className={`relative w-14 h-7 rounded-full transition-colors ${
                    settings.soundAlert ? 'bg-blue-600' : 'bg-slate-700'
                  }`}
                >
                  <div className={`absolute top-1 w-5 h-5 bg-white rounded-full transform transition-transform ${
                    settings.soundAlert ? 'translate-x-8' : 'translate-x-1'
                  }`}></div>
                </button>
              </div>
            </div>
          </div>

          {/* Database Settings */}
          <div className="bg-slate-900 rounded-xl p-6">
            <h3 className="text-xl font-bold mb-6 flex items-center gap-2">
              <BarChart3 className="w-6 h-6 text-amber-400" />
              Database Statistics
            </h3>
            
            <div className="space-y-4">
              <div className="p-4 bg-slate-800 rounded-lg">
                <div className="flex justify-between items-center mb-2">
                  <p className="font-semibold">Total Records</p>
                  <p className="text-2xl font-bold text-blue-400">{dbStats.total_records}</p>
                </div>
                <p className="text-slate-400 text-sm">All vehicle records in database</p>
              </div>

              <div className="grid grid-cols-2 gap-3">
                <div className="p-3 bg-slate-800 rounded-lg">
                  <p className="text-slate-400 text-xs mb-1">Currently IN</p>
                  <p className="text-xl font-bold text-green-400">{dbStats.records_in}</p>
                </div>
                <div className="p-3 bg-slate-800 rounded-lg">
                  <p className="text-slate-400 text-xs mb-1">Exited</p>
                  <p className="text-xl font-bold text-slate-400">{dbStats.records_out}</p>
                </div>
              </div>

              <button 
                onClick={fetchDatabaseStats}
                className="w-full bg-slate-700 hover:bg-slate-600 text-white py-2 rounded-lg font-semibold flex items-center justify-center gap-2"
              >
                <RefreshCw className="w-4 h-4" />
                Refresh Stats
              </button>
            </div>
          </div>

          {/* Data Management */}
          <div className="bg-slate-900 rounded-xl p-6">
            <h3 className="text-xl font-bold mb-6 flex items-center gap-2">
              <Settings className="w-6 h-6 text-green-400" />
              Data Management
            </h3>
            
            <div className="space-y-3">
              <button 
                onClick={handleExportData}
                disabled={exporting}
                className="w-full bg-blue-900/30 hover:bg-blue-900/50 disabled:bg-slate-800 disabled:cursor-not-allowed border border-blue-700 text-blue-400 py-3 rounded-lg font-semibold flex items-center justify-center gap-2"
              >
                <FileText className="w-4 h-4" />
                {exporting ? 'Exporting...' : 'Export Data (JSON)'}
              </button>

              <button 
                onClick={handleClearRecords}
                disabled={clearing || dbStats.total_records === 0}
                className="w-full bg-red-900/30 hover:bg-red-900/50 disabled:bg-slate-800 disabled:cursor-not-allowed border border-red-700 text-red-400 py-3 rounded-lg font-semibold flex items-center justify-center gap-2"
              >
                <StopCircle className="w-4 h-4" />
                {clearing ? 'Clearing...' : 'Clear All Records'}
              </button>

              <div className="mt-4 p-3 bg-amber-900/20 border border-amber-700 rounded-lg">
                <p className="text-amber-400 text-xs font-semibold mb-1">⚠️ Warning</p>
                <p className="text-slate-300 text-xs">Clearing records is permanent and cannot be undone</p>
              </div>
            </div>
          </div>
        </div>

        {/* Save/Cancel Buttons */}
        <div className="mt-6 flex justify-end gap-3">
          <button 
            onClick={fetchConfiguration}
            className="bg-slate-700 hover:bg-slate-600 px-6 py-3 rounded-lg font-semibold"
          >
            Reset Changes
          </button>
          <button
            onClick={handleSave}
            disabled={saving}
            className="bg-blue-600 hover:bg-blue-700 disabled:bg-slate-700 disabled:cursor-not-allowed px-6 py-3 rounded-lg font-semibold flex items-center gap-2"
          >
            {saving ? (
              <>
                <RefreshCw className="w-4 h-4 animate-spin" />
                Saving...
              </>
            ) : (
              'Save Changes'
            )}
          </button>
        </div>
      </div>
    );
  };

  return (
    <div className="flex h-screen bg-slate-950">
      <Sidebar />
      {(currentPage === 'entry' || currentPage === 'exit') && <VehicleEntryPage detectedPlate={detectedPlate}/>}
      {currentPage === 'dashboard' && <DashboardPage />}
      {currentPage === 'current' && <CurrentVehiclesPage />}
      {currentPage === 'search' && <SearchVehiclePage />}
      {currentPage === 'config' && <ConfigurationPage />}
    </div>
  );
};

export default SmartParkApp;