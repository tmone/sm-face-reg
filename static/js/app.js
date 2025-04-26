/**
 * Ứng dụng nhận diện khuôn mặt qua web
 * Sử dụng camera để phân tích và nhận diện khuôn mặt
 */

// Biến toàn cục
const video = document.getElementById('webcam');
const overlay = document.getElementById('overlay');
const startBtn = document.getElementById('start-btn');
const stopBtn = document.getElementById('stop-btn');
const screenshotBtn = document.getElementById('screenshot-btn');
const loadingIndicator = document.getElementById('loading-indicator');
const noCameraMsg = document.getElementById('no-camera');
const detectionStatus = document.getElementById('detection-status');
const realFaceScore = document.getElementById('real-face-score');
const realFaceProgress = document.getElementById('real-face-progress');
const rollValue = document.getElementById('roll-value');
const pitchValue = document.getElementById('pitch-value');
const yawValue = document.getElementById('yaw-value');
const rollText = document.getElementById('roll-text');
const pitchText = document.getElementById('pitch-text');
const yawText = document.getElementById('yaw-text');
const processingTime = document.getElementById('processing-time');
const fpsElement = document.getElementById('fps');

// Cấu hình
const PROCESSING_INTERVAL = 100; // Khoảng thời gian giữa các lần xử lý (ms)
const FPS_UPDATE_INTERVAL = 1000; // Khoảng thời gian cập nhật FPS (ms)
const SERVER_RATE_LIMIT = 1000; // Rate limit gửi đến server: 1 khung hình/giây (ms)
const CAPTURED_IMAGES_CHECK_INTERVAL = 3000; // Khoảng thời gian kiểm tra ảnh đã chụp (ms)

// Cấu hình hiển thị
const CONFIG = {
    showProcessedVideo: false,   // Không hiển thị video đã xử lý để giảm lag
    autoCapture: true,           // Tự động chụp ảnh
    notifyOnCapture: true,       // Hiển thị thông báo khi chụp
    autoPause: true,             // Tự động dừng camera khi đã chụp đủ các hướng
    autoStopDelay: 1500,         // Độ trễ trước khi tự động dừng camera (ms)
    // Thêm cấu hình để luôn dừng camera khi đủ các hướng
    alwaysStopWhenComplete: true, // Luôn dừng camera khi đã chụp đủ 5 hướng
};

// Các biến trạng thái
let stream = null;
let isProcessing = false;
let processingInterval = null;
let capturedImagesInterval = null;
let framesSent = 0;
let lastFpsUpdateTime = 0;
let ctx = null;
let lastProcessingTime = 0;
let lastServerRequestTime = 0; // Thời điểm gửi yêu cầu cuối cùng đến server
let pendingImageData = null;   // Lưu trữ khung hình mới nhất đang chờ gửi
let allDirectionsCaptured = false; // Đã chụp đủ các hướng hay chưa

// Biến trạng thái cho tính năng tự động chụp
let capturedDirections = {
    straight: false,
    left: false,
    right: false,
    up: false,
    down: false
};
let lastCaptureTime = 0;
let wasInCenter = true; // Ban đầu cho phép chụp ảnh ngay khi phát hiện hướng

// Biến để lưu trữ danh sách ảnh đã chụp
let capturedImages = [];
const MAX_CAPTURED_IMAGES = 30; // Số lượng ảnh tối đa hiển thị trong danh sách

// Biến lưu trữ thông tin người dùng
let userInfo = {
    fullname: '',
    employeeId: '',
    email: '',
    department: ''
};

// Khởi tạo ứng dụng
function init() {
    // Thiết lập canvas overlay
    ctx = overlay.getContext('2d');
    
    // Thiết lập sự kiện
    startBtn.addEventListener('click', startProcessing);
    stopBtn.addEventListener('click', stopProcessing);
    screenshotBtn.addEventListener('click', takeScreenshot);
    
    // Thiết lập kích thước video và canvas
    window.addEventListener('resize', updateCanvasSize);
    
    // Thiết lập sự kiện cho toggle tự động chụp
    const autoCaptureToggle = document.getElementById('auto-capture-toggle');
    if (autoCaptureToggle) {
        autoCaptureToggle.addEventListener('change', function() {
            CONFIG.autoCapture = this.checked;
            console.log(`Tính năng tự động chụp: ${this.checked ? 'Bật' : 'Tắt'}`);
            
            if (this.checked && isProcessing) {
                showNotification('Đã bật tính năng tự động chụp');
            }
        });
    }
    
    // Khởi tạo trạng thái các chỉ báo hướng
    updateDirectionIndicators();
    
    console.log('Ứng dụng đã được khởi tạo.');
}

// Cập nhật kích thước canvas
function updateCanvasSize() {
    if (video.videoWidth && video.videoHeight) {
        const containerWidth = video.offsetWidth;
        const containerHeight = video.offsetHeight;
        
        const videoRatio = video.videoWidth / video.videoHeight;
        const containerRatio = containerWidth / containerHeight;
        
        if (containerRatio > videoRatio) {
            overlay.width = containerHeight * videoRatio;
            overlay.height = containerHeight;
        } else {
            overlay.width = containerWidth;
            overlay.height = containerWidth / videoRatio;
        }
    }
}

// Bắt đầu xử lý
async function startProcessing() {
    if (isProcessing) return;
    
    try {
        // Hiển thị thông báo đang tải
        loadingIndicator.classList.remove('hidden');
        detectionStatus.textContent = 'Đang kết nối camera...';
        noCameraMsg.classList.add('hidden'); // Ẩn thông báo lỗi nếu có
        
        // Đặt lại trạng thái chụp ảnh trên server
        await fetch('/reset_capture', {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json'
            }
        });
        
        // Kiểm tra xem trình duyệt có hỗ trợ getUserMedia không
        if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) {
            throw new Error('Trình duyệt không hỗ trợ truy cập camera. Vui lòng sử dụng Chrome, Firefox hoặc trình duyệt hiện đại khác.');
        }
        
        // Cấu hình constraints cho camera với tỷ lệ 1:1
        const constraints = {
            video: {
                facingMode: 'user',
                width: { ideal: 720 },
                height: { ideal: 720 },
                aspectRatio: { exact: 1 }
            }
        };
        
        // Yêu cầu quyền truy cập camera với thêm xử lý lỗi
        stream = await navigator.mediaDevices.getUserMedia(constraints)
            .catch(async (err) => {
                console.warn('Không thể truy cập camera với cấu hình cao:', err);
                
                // Thử lại với cấu hình thấp hơn và vẫn giữ tỷ lệ 1:1
                return await navigator.mediaDevices.getUserMedia({
                    video: {
                        facingMode: 'user',
                        width: { ideal: 480 },
                        height: { ideal: 480 },
                        aspectRatio: { exact: 1 }
                    }
                }).catch(async (err2) => {
                    console.warn('Không thể truy cập camera với cấu hình trung bình:', err2);
                    
                    // Thử lần cuối với cấu hình tối thiểu
                    return await navigator.mediaDevices.getUserMedia({
                        video: {
                            facingMode: 'user',
                            aspectRatio: { ideal: 1 }
                        }
                    });
                });
            });
        
        // Kiểm tra xem stream có tồn tại không
        if (!stream) {
            throw new Error('Không thể kết nối với camera sau nhiều lần thử lại');
        }
        
        // Gán stream cho video element
        video.srcObject = stream;
        
        // Xử lý sự kiện lỗi video
        video.onerror = (e) => {
            console.error('Lỗi phát video:', e);
            handleCameraError(new Error('Không thể phát video từ camera'));
        };
        
        // Thiết lập sự kiện metadata để cập nhật kích thước canvas
        video.onloadedmetadata = () => {
            updateCanvasSize();
            loadingIndicator.classList.add('hidden');
            isProcessing = true;
            
            // Kiểm tra xem video có thực sự đang chạy không
            if (video.readyState < 2) {
                video.play()
                    .catch(err => {
                        console.error('Không thể phát video:', err);
                        handleCameraError(err);
                        return;
                    });
            }
            
            // Bắt đầu xử lý frame
            processingInterval = setInterval(processFrame, PROCESSING_INTERVAL);
            
            // Bắt đầu kiểm tra ảnh đã chụp
            capturedImagesInterval = setInterval(checkCapturedImages, CAPTURED_IMAGES_CHECK_INTERVAL);
            
            // Cập nhật UI
            startBtn.disabled = true;
            stopBtn.disabled = false;
            screenshotBtn.disabled = false;
            detectionStatus.textContent = 'Đã kết nối';
            
            console.log('Đã bắt đầu xử lý video.');
        };
        
        // Thêm thời gian chờ để phát hiện nếu camera không khởi động được
        setTimeout(() => {
            if (!isProcessing && video.readyState < 2) {
                handleCameraError(new Error('Camera không phản hồi sau thời gian chờ'));
            }
        }, 10000); // 10 giây
        
    } catch (error) {
        handleCameraError(error);
    }
}

// Xử lý lỗi camera
function handleCameraError(error) {
    console.error('Lỗi camera:', error);
    
    // Dừng luồng nếu đã được tạo
    if (stream) {
        stream.getTracks().forEach(track => track.stop());
        video.srcObject = null;
        stream = null;
    }
    
    // Hiển thị thông báo lỗi
    loadingIndicator.classList.add('hidden');
    noCameraMsg.classList.remove('hidden');
    
    // Hiển thị thông báo lỗi cụ thể
    const errorMessageElement = document.querySelector('#no-camera p');
    if (errorMessageElement) {
        if (error.name === 'NotAllowedError' || error.name === 'PermissionDeniedError') {
            errorMessageElement.textContent = 'Bạn đã từ chối quyền truy cập camera. Vui lòng cấp quyền và thử lại.';
        } else if (error.name === 'NotFoundError' || error.name === 'DevicesNotFoundError') {
            errorMessageElement.textContent = 'Không tìm thấy camera. Vui lòng kết nối camera và thử lại.';
        } else if (error.name === 'NotReadableError' || error.name === 'TrackStartError') {
            errorMessageElement.textContent = 'Camera đang được sử dụng bởi ứng dụng khác. Vui lòng đóng ứng dụng đó và thử lại.';
        } else {
            errorMessageElement.textContent = `Không thể kết nối với camera: ${error.message || 'Lỗi không xác định'}`;
        }
    }
    
    detectionStatus.textContent = 'Lỗi: Không thể kết nối camera';
    detectionStatus.style.color = 'red';
    
    // Tạo nút thử lại
    createRetryButton();
}

// Tạo nút thử lại khi gặp lỗi camera
function createRetryButton() {
    // Kiểm tra xem đã có nút thử lại chưa
    const existingButton = document.querySelector('#camera-retry-btn');
    if (existingButton) {
        return;
    }
    
    // Tạo nút thử lại
    const retryBtn = document.createElement('button');
    retryBtn.id = 'camera-retry-btn';
    retryBtn.className = 'btn primary';
    retryBtn.innerHTML = '<i class="fas fa-sync"></i> Thử lại kết nối';
    retryBtn.onclick = startProcessing;
    
    // Thêm vào container no-camera
    const container = document.querySelector('#no-camera');
    if (container) {
        container.appendChild(retryBtn);
    }
}

// Dừng xử lý
function stopProcessing() {
    if (!isProcessing) return;
    
    // Dừng interval
    if (processingInterval) {
        clearInterval(processingInterval);
        processingInterval = null;
    }
    
    // Dừng stream từ camera
    if (stream) {
        stream.getTracks().forEach(track => track.stop());
        video.srcObject = null;
        stream = null;
    }
    
    // Xóa canvas
    if (ctx) {
        ctx.clearRect(0, 0, overlay.width, overlay.height);
    }
    
    // Cập nhật UI
    isProcessing = false;
    startBtn.disabled = false;
    stopBtn.disabled = true;
    screenshotBtn.disabled = true;
    detectionStatus.textContent = 'Đã dừng';
    detectionStatus.style.color = '';
    
    // Đặt lại các giá trị phân tích
    resetAnalysisValues();
    
    // Đặt lại trạng thái chụp các hướng
    resetCaptureDirections();
    
    console.log('Đã dừng xử lý video.');
}

// Đặt lại các giá trị phân tích
function resetAnalysisValues() {
    realFaceScore.textContent = '--';
    realFaceProgress.style.width = '0%';
    rollValue.textContent = '0°';
    pitchValue.textContent = '0°';
    yawValue.textContent = '0°';
    rollText.textContent = 'Thẳng';
    pitchText.textContent = 'Thẳng';
    yawText.textContent = 'Thẳng';
    processingTime.textContent = '0';
    fpsElement.textContent = '0';
}

// Chụp ảnh hiện tại
function takeScreenshot() {
    if (!isProcessing) return;
    
    // Tạo canvas mới để chụp ảnh
    const canvas = document.createElement('canvas');
    canvas.width = video.videoWidth;
    canvas.height = video.videoHeight;
    
    // Vẽ video và overlay vào canvas
    const context = canvas.getContext('2d');
    context.drawImage(video, 0, 0, canvas.width, canvas.height);
    
    // Tạo URL để tải xuống
    const dataURL = canvas.toDataURL('image/png');
    const link = document.createElement('a');
    link.href = dataURL;
    link.download = `face-detection-${new Date().toISOString().slice(0, 19)}.png`;
    link.click();
    
    console.log('Đã chụp ảnh.');
}

// Xử lý frame từ video
async function processFrame() {
    if (!isProcessing || !video.videoWidth) return;
    
    const currentTime = performance.now();
    
    try {
        // Lấy khung hình từ video
        const canvas = document.createElement('canvas');
        canvas.width = video.videoWidth;
        canvas.height = video.videoHeight;
        
        const context = canvas.getContext('2d');
        context.drawImage(video, 0, 0, canvas.width, canvas.height);
        
        // Chuyển khung hình thành base64
        const imageData = canvas.toDataURL('image/jpeg', 0.8);
        
        // Lưu khung hình mới nhất
        pendingImageData = imageData;
        
        // Kiểm tra xem đã đến thời gian gửi yêu cầu tiếp theo chưa (rate limiting)
        if (currentTime - lastServerRequestTime < SERVER_RATE_LIMIT) {
            // Chưa đến thời gian gửi tiếp, bỏ qua frame này
            return;
        }
        
        // Đã đến thời gian gửi yêu cầu mới
        lastServerRequestTime = currentTime;
        
        // Hiển thị chỉ báo đang gửi
        const sendingIndicator = document.getElementById('sending-indicator');
        if (sendingIndicator) {
            sendingIndicator.style.display = 'block';
        }
        
        // Gửi đến server để xử lý
        const response = await fetch('/process_frame', {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
            },
            body: JSON.stringify({
                image: pendingImageData
            })
        });
        
        // Đếm số frame đã gửi để tính FPS
        framesSent++;
        const now = performance.now();
        if (now - lastFpsUpdateTime >= FPS_UPDATE_INTERVAL) {
            const fps = Math.round(framesSent * 1000 / (now - lastFpsUpdateTime));
            fpsElement.textContent = fps;
            framesSent = 0;
            lastFpsUpdateTime = now;
        }
        
        const data = await response.json();
        
        // Ẩn chỉ báo đang gửi
        if (sendingIndicator) {
            sendingIndicator.style.display = 'none';
        }
        
        // Tính thời gian xử lý
        const endTime = performance.now();
        lastProcessingTime = Math.round(endTime - currentTime);
        processingTime.textContent = lastProcessingTime;
        
        // Kiểm tra lỗi
        if (data.error) {
            console.error('Lỗi từ server:', data.error);
            return;
        }
        
        // Hiển thị kết quả phân tích (không hiển thị hình ảnh đã xử lý)
        updateAnalysisResults(data);
        
        // Kiểm tra kết quả chụp ảnh từ server
        if (data.capture_result && data.capture_result.captured) {
            const captureInfo = data.capture_result;
            
            // Hiển thị thông báo nếu chụp thành công
            showNotification(`Đã chụp hướng: ${captureInfo.direction}`, 2000);
            
            // Cập nhật trạng thái chụp theo thông tin từ server
            if (captureInfo.direction_key && capturedDirections[captureInfo.direction_key] !== undefined) {
                capturedDirections[captureInfo.direction_key] = true;
                // Cập nhật chỉ báo hướng trong UI
                updateDirectionIndicators();
            }
            
            // Kiểm tra nếu đã chụp đủ các hướng
            if (captureInfo.all_directions_captured) {
                showNotification('Đã thu thập đủ tất cả các hướng khuôn mặt!', 5000);
                allDirectionsCaptured = true;
                
                // Tự động dừng camera ngay khi nhận được thông báo đã chụp đủ các hướng
                if (CONFIG.autoPause || CONFIG.alwaysStopWhenComplete) {
                    console.log('Đã chụp đủ các hướng, chuẩn bị dừng camera...');
                    
                    // Thêm độ trễ ngắn để người dùng thấy hình ảnh cuối cùng
                    setTimeout(() => {
                        // Dừng và ngắt camera
                        stopProcessing();
                        showNotification('Đã tự động dừng camera khi thu thập đủ ảnh', 4000);
                        
                        // Hiển thị thông báo hoàn thành rõ ràng cho người dùng
                        const completionMessage = document.createElement('div');
                        completionMessage.id = 'capture-completion-message';
                        completionMessage.className = 'alert alert-success';
                        completionMessage.innerHTML = '<strong>Hoàn thành!</strong> Đã thu thập đủ 5 hướng khuôn mặt. Bạn có thể nhấn "Bắt đầu lại" để chụp bộ mới.';
                        
                        // Chèn thông báo vào trang
                        const controlsContainer = document.querySelector('.controls-container');
                        if (controlsContainer) {
                            // Xóa thông báo cũ nếu có
                            const oldMessage = document.getElementById('capture-completion-message');
                            if (oldMessage) {
                                oldMessage.remove();
                            }
                            
                            controlsContainer.insertBefore(completionMessage, controlsContainer.firstChild);
                        }
                        
                        // Thay đổi nút "Bắt đầu" để hiển thị "Bắt đầu lại"
                        const startBtn = document.getElementById('start-btn');
                        if (startBtn) {
                            startBtn.innerHTML = '<i class="fas fa-redo"></i> Bắt đầu lại';
                            startBtn.classList.add('restart-btn');
                        }
                    }, CONFIG.autoStopDelay);
                }
            }
        }
        
    } catch (error) {
        console.error('Lỗi xử lý frame:', error);
    }
}

// Cập nhật kết quả phân tích từ dữ liệu server
function updateAnalysisResults(data) {
    // Hiển thị kết quả phân tích
    const result = data.analysis_result;
    if (result) {
        // Cập nhật trạng thái nhận diện
        detectionStatus.textContent = result.face_detected ? 'Đã phát hiện khuôn mặt' : 'Không phát hiện khuôn mặt';
        detectionStatus.style.color = result.face_detected ? 'green' : 'red';
        
        // Cập nhật thông tin khuôn mặt thật/giả
        if (result.face_detected) {
            const score = Math.round(result.real_face_score * 100);
            realFaceScore.textContent = `${score}%`;
            realFaceProgress.style.width = `${score}%`;
            realFaceProgress.style.backgroundColor = score > 70 ? 'var(--secondary-color)' : 'var(--danger-color)';
            
            // Cập nhật thông tin góc xoay
            const rotation = result.rotation;
            rollValue.textContent = `${rotation.roll.toFixed(1)}°`;
            pitchValue.textContent = `${rotation.pitch.toFixed(1)}°`;
            yawValue.textContent = `${rotation.yaw.toFixed(1)}°`;
            
            // Cập nhật thông tin hướng xoay
            rollText.textContent = result.rotation_text.roll;
            pitchText.textContent = result.rotation_text.pitch;
            yawText.textContent = result.rotation_text.yaw;
        }
    }
}

// Kiểm tra hướng nhìn và tự động chụp ảnh
function handleAutoCaptureCheck(rotation, rotationText) {
    const now = Date.now();
    // Kiểm tra thời gian cooldown giữa các lần chụp
    if (now - lastCaptureTime < AUTO_CAPTURE_CONFIG.cooldown) {
        return;
    }
    
    // Xác định khuôn mặt có đang ở vị trí trung tâm không
    const isStraight = Math.abs(rotation.roll) <= AUTO_CAPTURE_CONFIG.rotationThreshold && 
                       Math.abs(rotation.pitch) <= AUTO_CAPTURE_CONFIG.rotationThreshold && 
                       Math.abs(rotation.yaw) <= AUTO_CAPTURE_CONFIG.rotationThreshold;

    // Kiểm tra hướng nhìn hiện tại
    if (isStraight) {
        // Đánh dấu đã trở về vị trí trung tâm, cho phép chụp tiếp các hướng mới
        wasInCenter = true;
        
        // Nếu chưa chụp ảnh trung tâm, chụp ngay
        if (!capturedDirections.straight) {
            autoCapture('straight', 'Nhìn thẳng');
        }
    } 
    else if (wasInCenter || !AUTO_CAPTURE_CONFIG.requireCenterBefore) {
        // Chỉ xét các hướng khi đã trở về trung tâm trước đó hoặc không yêu cầu

        // Kiểm tra các hướng quay đầu
        if (rotationText.yaw === "Quay trái" && !capturedDirections.left) {
            // Quay trái
            if (Math.abs(rotation.yaw) > AUTO_CAPTURE_CONFIG.rotationThreshold) {
                autoCapture('left', 'Quay trái');
            }
        }
        else if (rotationText.yaw === "Quay phải" && !capturedDirections.right) {
            // Quay phải
            if (Math.abs(rotation.yaw) > AUTO_CAPTURE_CONFIG.rotationThreshold) {
                autoCapture('right', 'Quay phải');
            }
        }
        else if (rotationText.pitch === "Ngẩng lên" && !capturedDirections.up) {
            // Ngẩng lên
            if (Math.abs(rotation.pitch) > AUTO_CAPTURE_CONFIG.rotationThreshold) {
                autoCapture('up', 'Ngẩng lên');
            }
        }
        else if (rotationText.pitch === "Cúi xuống" && !capturedDirections.down) {
            // Cúi xuống
            if (Math.abs(rotation.pitch) > AUTO_CAPTURE_CONFIG.rotationThreshold) {
                autoCapture('down', 'Cúi xuống');
            }
        }
    }
}

// Thực hiện tự động chụp ảnh
function autoCapture(direction, directionText) {
    // Cập nhật trạng thái đã chụp
    capturedDirections[direction] = true;
    lastCaptureTime = Date.now();
    wasInCenter = false; // Yêu cầu quay về trung tâm sau khi chụp
    
    // Tạo tên file với phương hướng
    const timestamp = new Date().toISOString().slice(0, 19).replace(/:/g, '-');
    const filename = `face-${directionText}-${timestamp}.png`;
    
    // Chụp ảnh với tên file tương ứng
    takeCustomScreenshot(filename);
    
    // Cập nhật chỉ báo hướng trong UI
    updateDirectionIndicators();
    
    // Hiển thị thông báo
    if (CONFIG.notifyOnCapture) {
        showNotification(`Đã chụp ảnh: ${directionText}`);
    }
    
    // Kiểm tra nếu đã chụp đủ 5 hướng
    checkAllDirectionsCaptured();
}

// Chụp ảnh với tên tùy chỉnh
function takeCustomScreenshot(filename) {
    if (!isProcessing) return;
    
    const canvas = document.createElement('canvas');
    canvas.width = video.videoWidth;
    canvas.height = video.videoHeight;
    
    // Vẽ video và overlay vào canvas
    const context = canvas.getContext('2d');
    context.drawImage(video, 0, 0, canvas.width, canvas.height);
    
    // Tạo URL để tải xuống
    const dataURL = canvas.toDataURL('image/png');
    const link = document.createElement('a');
    link.href = dataURL;
    link.download = filename;
    link.click();
    
    // Thêm ảnh vào danh sách ảnh đã chụp
    addImageToList(dataURL, filename);
    
    console.log(`Đã tự động chụp ảnh: ${filename}`);
}

// Thêm ảnh vào danh sách đã chụp
function addImageToList(dataURL, filename) {
    // Tạo đối tượng ảnh mới
    const imageObj = {
        id: Date.now(), // ID duy nhất dựa trên thời gian
        dataURL: dataURL,
        filename: filename,
        timestamp: new Date()
    };
    
    // Thêm vào đầu mảng
    capturedImages.unshift(imageObj);
    
    // Giới hạn số lượng ảnh trong danh sách
    if (capturedImages.length > MAX_CAPTURED_IMAGES) {
        capturedImages.pop();
    }
    
    // Cập nhật giao diện danh sách ảnh
    updateImagesList();
}

// Cập nhật giao diện danh sách ảnh đã chụp
function updateImagesList() {
    const container = document.getElementById('captured-images-container');
    const noImagesMessage = document.getElementById('no-images-message');
    
    if (!container) return;
    
    // Xóa tất cả ảnh hiện tại
    container.innerHTML = '';
    
    // Hiển thị thông báo nếu không có ảnh nào
    if (capturedImages.length === 0) {
        if (noImagesMessage) noImagesMessage.style.display = 'block';
        return;
    }
    
    // Ẩn thông báo không có ảnh
    if (noImagesMessage) noImagesMessage.style.display = 'none';
    
    // Tạo và thêm các phần tử ảnh vào container
    capturedImages.forEach(img => {
        // Tạo phần tử ảnh
        const imageItem = document.createElement('div');
        imageItem.className = 'captured-image-item';
        imageItem.dataset.imageId = img.id;
        
        // Tạo ảnh thumbnail
        const thumbnail = document.createElement('img');
        thumbnail.src = img.dataURL;
        thumbnail.alt = img.filename;
        thumbnail.loading = 'lazy'; // Lazy loading
        
        // Tạo thông tin ảnh
        const imageInfo = document.createElement('div');
        imageInfo.className = 'captured-image-info';
        
        // Lấy tên hướng từ filename (vd: face-Quay trái-...)
        let directionName = 'Ảnh chụp';
        const directionMatch = img.filename.match(/face-(.*?)-/);
        if (directionMatch && directionMatch.length > 1) {
            directionName = directionMatch[1];
        }
        
        imageInfo.textContent = directionName;
        
        // Tạo nút xóa
        const deleteBtn = document.createElement('button');
        deleteBtn.className = 'delete-btn';
        deleteBtn.innerHTML = '<i class="fas fa-times"></i>';
        deleteBtn.title = 'Xóa ảnh này';
        deleteBtn.onclick = (e) => {
            e.stopPropagation(); // Ngăn việc mở modal khi nhấn nút xóa
            deleteImage(img.id);
        };
        
        // Thêm sự kiện click để xem trước
        imageItem.onclick = () => {
            showImagePreview(img);
        };
        
        // Thêm các phần tử vào phần tử container
        imageItem.appendChild(thumbnail);
        imageItem.appendChild(imageInfo);
        imageItem.appendChild(deleteBtn);
        
        // Thêm phần tử ảnh vào container
        container.appendChild(imageItem);
    });
}

// Xóa một ảnh khỏi danh sách
function deleteImage(imageId) {
    // Tìm và xóa ảnh khỏi mảng
    const index = capturedImages.findIndex(img => img.id === imageId);
    if (index !== -1) {
        capturedImages.splice(index, 1);
        updateImagesList();
    }
}

// Hiển thị modal xem trước ảnh
function showImagePreview(imageObj) {
    const modal = document.getElementById('image-preview-modal');
    const previewImage = document.getElementById('preview-image');
    const previewCaption = document.getElementById('preview-caption');
    
    if (!modal || !previewImage) return;
    
    // Thiết lập modal
    previewImage.src = imageObj.dataURL;
    
    // Định dạng thời gian
    const options = { 
        year: 'numeric', month: '2-digit', day: '2-digit',
        hour: '2-digit', minute: '2-digit', second: '2-digit'
    };
    const timestampStr = imageObj.timestamp.toLocaleString('vi-VN', options);
    
    // Tạo caption từ filename
    let directionName = 'Ảnh chụp';
    const directionMatch = imageObj.filename.match(/face-(.*?)-/);
    if (directionMatch && directionMatch.length > 1) {
        directionName = directionMatch[1];
    }
    
    if (previewCaption) {
        previewCaption.textContent = `${directionName} - ${timestampStr}`;
    }
    
    // Hiển thị modal
    modal.style.display = 'flex';
    
    // Thiết lập sự kiện đóng modal
    const closeBtn = modal.querySelector('.image-preview-close');
    if (closeBtn) {
        closeBtn.onclick = () => {
            modal.style.display = 'none';
        };
    }
    
    // Đóng modal khi nhấp vào bên ngoài ảnh
    modal.onclick = (event) => {
        if (event.target === modal) {
            modal.style.display = 'none';
        }
    };
}

// Kiểm tra đã chụp đủ 5 hướng chưa
function checkAllDirectionsCaptured() {
    const allCaptured = capturedDirections.straight && 
                        capturedDirections.left && 
                        capturedDirections.right && 
                        capturedDirections.up && 
                        capturedDirections.down;
    
    if (allCaptured) {
        showNotification('Đã chụp đủ 5 hướng! Bạn có thể reset để chụp lại.');
        console.log('Đã chụp đủ 5 hướng.');
        
        // Tùy chọn: Đặt lại trạng thái sau một khoảng thời gian
        setTimeout(resetCaptureDirections, CONFIG.autoStopDelay);
    }
}

// Đặt lại trạng thái chụp các hướng
function resetCaptureDirections() {
    capturedDirections = {
        straight: false,
        left: false,
        right: false,
        up: false,
        down: false
    };
    wasInCenter = true;
    console.log('Đã đặt lại trạng thái chụp ảnh các hướng.');
}

// Cập nhật chỉ báo hướng trong UI
function updateDirectionIndicators() {
    // Tìm tất cả các chỉ báo hướng trong UI
    const indicators = document.querySelectorAll('.direction-indicator');
    
    // Cập nhật trạng thái cho từng chỉ báo
    indicators.forEach(indicator => {
        const direction = indicator.getAttribute('data-direction');
        if (direction && capturedDirections[direction]) {
            indicator.classList.add('captured');
        } else {
            indicator.classList.remove('captured');
        }
    });

    // Cập nhật trạng thái viền webcam theo từng hướng đã chụp
    const appContainer = document.getElementById('app-container');
    if (!appContainer) return;

    // Cập nhật class cho từng hướng đã chụp
    appContainer.classList.toggle('border-captured-up', capturedDirections.up);
    appContainer.classList.toggle('border-captured-down', capturedDirections.down);
    appContainer.classList.toggle('border-captured-left', capturedDirections.left);
    appContainer.classList.toggle('border-captured-right', capturedDirections.right);
    
    // Hiển thị hiệu ứng flash khi mới chụp thành công
    if (capturedDirections.up || capturedDirections.down || 
        capturedDirections.left || capturedDirections.right || 
        capturedDirections.straight) {
        const videoWrapper = document.querySelector('.video-wrapper');
        if (videoWrapper) {
            videoWrapper.classList.add('flash');
            setTimeout(() => {
                videoWrapper.classList.remove('flash');
            }, 500);
        }
    }
}

// Kiểm tra ảnh đã chụp từ server
async function checkCapturedImages() {
    if (!isProcessing) return;
    
    try {
        const response = await fetch('/captured_images');
        const data = await response.json();
        
        if (data.all_captured && !allDirectionsCaptured) {
            // Đã chụp đủ các hướng, thông báo cho người dùng
            allDirectionsCaptured = true;
            showNotification('Đã thu thập đủ 5 hướng khuôn mặt!', 6000);
            
            // Cập nhật UI với danh sách ảnh từ server
            updateServerCapturedImages(data);
            
            // Tự động dừng camera sau khi đã chụp đủ các hướng
            if (CONFIG.autoPause || CONFIG.alwaysStopWhenComplete) {
                console.log('Đã chụp đủ các hướng, đang dừng camera...');
                
                setTimeout(() => {
                    stopProcessing();
                    showNotification('Đã tự động dừng camera khi thu thập đủ ảnh', 4000);
                    
                    // Thay đổi nút "Bắt đầu" để hiển thị "Bắt đầu lại"
                    const startBtn = document.getElementById('start-btn');
                    if (startBtn) {
                        startBtn.innerHTML = '<i class="fas fa-redo"></i> Bắt đầu lại';
                        startBtn.classList.add('restart-btn');
                    }
                    
                    // Hiển thị thông báo hoàn thành rõ ràng cho người dùng
                    const completionMessage = document.createElement('div');
                    completionMessage.id = 'capture-completion-message';
                    completionMessage.className = 'alert alert-success';
                    completionMessage.innerHTML = '<strong>Hoàn thành!</strong> Đã thu thập đủ 5 hướng khuôn mặt. Bạn có thể nhấn "Bắt đầu lại" để chụp bộ mới.';
                    
                    // Chèn thông báo vào trang
                    const controlsContainer = document.querySelector('.controls-container');
                    if (controlsContainer) {
                        // Xóa thông báo cũ nếu có
                        const oldMessage = document.getElementById('capture-completion-message');
                        if (oldMessage) {
                            oldMessage.remove();
                        }
                        
                        controlsContainer.insertBefore(completionMessage, controlsContainer.firstChild);
                    }
                }, CONFIG.autoStopDelay);
            }
        } else if (data.images && data.images.length > 0) {
            // Chỉ cập nhật UI với danh sách ảnh từ server
            updateServerCapturedImages(data);
            
            // Kiểm tra nếu tất cả các hướng đã được chụp qua dữ liệu trong UI
            const allCaptured = 
                capturedDirections.straight && 
                capturedDirections.left && 
                capturedDirections.right && 
                capturedDirections.up && 
                capturedDirections.down;
            
            // Nếu tất cả các hướng đã chụp, đánh dấu và tự động dừng camera
            if (allCaptured && !allDirectionsCaptured) {
                allDirectionsCaptured = true;
                console.log('Phát hiện đã chụp đủ 5 hướng từ UI');
                
                showNotification('Đã thu thập đủ 5 hướng khuôn mặt!', 6000);
                
                // Tự động dừng camera sau khi đã chụp đủ các hướng
                if (CONFIG.autoPause || CONFIG.alwaysStopWhenComplete) {
                    console.log('Đã chụp đủ các hướng, đang dừng camera...');
                    
                    setTimeout(() => {
                        stopProcessing();
                        showNotification('Đã tự động dừng camera khi thu thập đủ ảnh', 4000);
                    }, CONFIG.autoStopDelay);
                }
            }
        }
    } catch (error) {
        console.error('Lỗi khi kiểm tra ảnh đã chụp:', error);
    }
}

// Cập nhật UI với danh sách ảnh từ server
function updateServerCapturedImages(data) {
    const container = document.getElementById('captured-images-container');
    const noImagesMessage = document.getElementById('no-images-message');
    
    if (!container) return;
    
    // Xóa tất cả ảnh hiện tại
    container.innerHTML = '';
    
    // Cập nhật trạng thái hướng đã chụp
    capturedDirections = data.directions;
    
    // Cập nhật chỉ báo hướng
    updateDirectionIndicators();
    
    // Hiển thị thông báo nếu không có ảnh nào
    if (!data.images || data.images.length === 0) {
        if (noImagesMessage) noImagesMessage.style.display = 'block';
        return;
    }
    
    // Ẩn thông báo không có ảnh
    if (noImagesMessage) noImagesMessage.style.display = 'none';
    
    // Tạo và thêm các phần tử ảnh vào container
    data.images.forEach(img => {
        // Tạo phần tử ảnh
        const imageItem = document.createElement('div');
        imageItem.className = 'captured-image-item';
        imageItem.dataset.imageId = img.id;
        
        // Tạo ảnh thumbnail
        const thumbnail = document.createElement('img');
        thumbnail.src = img.url;  // Sử dụng URL từ server
        thumbnail.alt = img.filename;
        thumbnail.loading = 'lazy'; // Lazy loading
        
        // Tạo thông tin ảnh
        const imageInfo = document.createElement('div');
        imageInfo.className = 'captured-image-info';
        imageInfo.textContent = img.direction;
        
        // Thêm các phần tử vào phần tử container
        imageItem.appendChild(thumbnail);
        imageItem.appendChild(imageInfo);
        
        // Thêm sự kiện click để xem trước
        imageItem.onclick = () => {
            showServerImagePreview(img);
        };
        
        // Thêm phần tử ảnh vào container
        container.appendChild(imageItem);
    });
}

// Hiển thị modal xem trước ảnh từ server
function showServerImagePreview(imageObj) {
    const modal = document.getElementById('image-preview-modal');
    const previewImage = document.getElementById('preview-image');
    const previewCaption = document.getElementById('preview-caption');
    
    if (!modal || !previewImage) return;
    
    // Thiết lập modal
    previewImage.src = imageObj.url;
    
    if (previewCaption) {
        previewCaption.textContent = `${imageObj.direction} - ${imageObj.timestamp}`;
    }
    
    // Hiển thị modal
    modal.style.display = 'flex';
    
    // Thiết lập sự kiện đóng modal
    const closeBtn = modal.querySelector('.image-preview-close');
    if (closeBtn) {
        closeBtn.onclick = () => {
            modal.style.display = 'none';
        };
    }
    
    // Đóng modal khi nhấp vào bên ngoài ảnh
    modal.onclick = (event) => {
        if (event.target === modal) {
            modal.style.display = 'none';
        }
    };
}

// Hiển thị thông báo
function showNotification(message, duration = 3000) {
    // Tạo phần tử thông báo
    const notification = document.createElement('div');
    notification.className = 'auto-capture-notification';
    notification.textContent = message;
    
    // Thêm vào trang
    document.body.appendChild(notification);
    
    // Hiệu ứng hiển thị
    setTimeout(() => {
        notification.classList.add('show');
    }, 10);
    
    // Tự động ẩn sau thời gian chỉ định
    setTimeout(() => {
        notification.classList.remove('show');
        setTimeout(() => {
            document.body.removeChild(notification);
        }, 500); // Đợi hiệu ứng fade out
    }, duration);
}

// Khởi tạo khi trang được tải
document.addEventListener('DOMContentLoaded', function() {
    console.log('DOM đã được tải, đang khởi tạo ứng dụng...');
    
    // Kiểm tra form thông tin người dùng
    const userInfoForm = document.getElementById('user-info-form');
    if (userInfoForm) {
        userInfoForm.addEventListener('submit', handleUserInfoSubmit);
    }
    
    // Kiểm tra các thành phần UI cần thiết có tồn tại không
    if (!document.getElementById('start-btn')) {
        console.error('Không tìm thấy nút Bắt đầu!');
        return;
    }
    
    try {
        // Khởi tạo ứng dụng
        init();
        
        // Log để debug
        console.log('Đã gắn sự kiện cho nút Bắt đầu:', document.getElementById('start-btn'));
        
        // Thêm trình xử lý sự kiện bổ sung để đảm bảo
        setTimeout(function() {
            const startBtnAgain = document.getElementById('start-btn');
            if (startBtnAgain && !startBtnAgain.onclick) {
                console.log('Đang gắn lại sự kiện cho nút Bắt đầu...');
                startBtnAgain.addEventListener('click', function(e) {
                    console.log('Nút Bắt đầu đã được nhấn');
                    e.preventDefault();
                    startProcessing();
                });
            }
        }, 1000);
    } catch (error) {
        console.error('Lỗi khi khởi tạo ứng dụng:', error);
    }
});

// Xử lý submit form thông tin người dùng
function handleUserInfoSubmit(event) {
    event.preventDefault();
    
    // Lấy giá trị từ form
    const fullname = document.getElementById('fullname').value;
    const employeeId = document.getElementById('employee-id').value;
    const email = document.getElementById('email').value;
    const department = document.getElementById('department').value;
    
    // Kiểm tra xem đã nhập đủ thông tin chưa
    if (!fullname || !employeeId || !email || !department) {
        showNotification('Vui lòng điền đầy đủ thông tin cá nhân', 3000);
        return;
    }
    
    // Lưu thông tin người dùng vào biến toàn cục
    userInfo = {
        fullname: fullname,
        employeeId: employeeId,
        email: email,
        department: department
    };
    
    // Hiển thị thông báo xác nhận
    showNotification(`Xin chào ${fullname}! Bạn có thể bắt đầu thu thập hình ảnh`, 3000);
    
    // Ẩn form và hiển thị ứng dụng chính
    document.getElementById('user-info-container').classList.add('hidden');
    document.getElementById('app-container').classList.remove('hidden');
    
    // Tạo và hiển thị tóm tắt thông tin người dùng
    createUserInfoSummary();
    
    console.log('Đã lưu thông tin người dùng:', userInfo);
    
    // Gửi thông tin người dùng đến server
    sendUserInfoToServer();
}

// Gửi thông tin người dùng đến server
function sendUserInfoToServer() {
    fetch('/register_user', {
        method: 'POST',
        headers: {
            'Content-Type': 'application/json',
        },
        body: JSON.stringify(userInfo)
    })
    .then(response => response.json())
    .then(data => {
        console.log('Server đã nhận thông tin người dùng:', data);
    })
    .catch(error => {
        console.error('Lỗi khi gửi thông tin người dùng:', error);
    });
}

// Tạo và hiển thị tóm tắt thông tin người dùng
function createUserInfoSummary() {
    // Tạo container thông tin người dùng
    const userSummary = document.createElement('div');
    userSummary.id = 'user-info-summary';
    userSummary.className = 'user-info-summary';
    
    // Thêm thông tin người dùng vào container
    userSummary.innerHTML = `
        <p><span>Họ và tên:</span> <span>${userInfo.fullname}</span></p>
        <p><span>Mã nhân viên:</span> <span>${userInfo.employeeId}</span></p>
        <p><span>Email:</span> <span>${userInfo.email}</span></p>
        <p><span>Phòng ban:</span> <span>${userInfo.department}</span></p>
        <button type="button" id="edit-user-info" class="edit-user-info-btn">
            <i class="fas fa-edit"></i> Sửa thông tin
        </button>
    `;
    
    // Thêm container vào trang
    const targetContainer = document.querySelector('.video-container');
    if (targetContainer) {
        targetContainer.insertBefore(userSummary, targetContainer.firstChild);
    }
    
    // Thêm sự kiện cho nút sửa thông tin
    const editBtn = document.getElementById('edit-user-info');
    if (editBtn) {
        editBtn.addEventListener('click', () => {
            // Hiển thị lại form thông tin người dùng và ẩn ứng dụng
            document.getElementById('user-info-container').classList.remove('hidden');
            document.getElementById('app-container').classList.add('hidden');
            
            // Điền lại giá trị vào form
            document.getElementById('fullname').value = userInfo.fullname;
            document.getElementById('employee-id').value = userInfo.employeeId;
            document.getElementById('email').value = userInfo.email;
            document.getElementById('department').value = userInfo.department;
        });
    }
}