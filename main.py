import cv2
import mediapipe as mp
import numpy as np
import math
import time
import base64
from flask import Flask, render_template, Response, request, jsonify, send_from_directory
import threading
import json
from io import BytesIO
import logging
import os
import socket
import uuid
from datetime import datetime

# Cấu hình logging
logging.basicConfig(level=logging.INFO)
logger = logging.getLogger(__name__)

# Thư mục để lưu ảnh đã chụp
TEMP_DIR = os.path.join(os.path.dirname(os.path.abspath(__file__)), 'temp_captures')
if not os.path.exists(TEMP_DIR):
    os.makedirs(TEMP_DIR)

class FaceDetectionApp:
    def __init__(self):
        # Khởi tạo các module MediaPipe
        self.mp_face_detection = mp.solutions.face_detection
        self.mp_face_mesh = mp.solutions.face_mesh
        self.mp_drawing = mp.solutions.drawing_utils
        self.mp_drawing_styles = mp.solutions.drawing_styles

        # Khởi tạo các biến cần thiết
        self.face_detection = None
        self.face_mesh = None
        self.is_running = False
        self.frame_count = 0
        self.start_time = 0
        self.fps = 0
        self.real_face_score = 0
        
        # Biến lưu trữ thông tin người dùng
        self.user_info = {
            "fullname": "",
            "employeeId": "",
            "email": "",
            "department": ""
        }
        
        # Biến để theo dõi hướng đã chụp
        self.captured_directions = {
            "straight": False,
            "left": False,
            "right": False,
            "up": False,
            "down": False
        }
        self.captured_images = []  # Danh sách lưu thông tin ảnh đã chụp
        self.session_id = str(uuid.uuid4())[:8]  # ID phiên làm việc để nhóm ảnh
        
        # Biến để lưu kết quả phân tích mới nhất
        self.latest_result = {
            "face_detected": False,
            "real_face_score": 0,
            "rotation": {
                "roll": 0,
                "pitch": 0,
                "yaw": 0
            },
            "rotation_text": {
                "roll": "Thẳng",
                "pitch": "Thẳng",
                "yaw": "Thẳng"
            }
        }
        
        # Khởi tạo Face Detection với các tùy chọn
        self.face_detection = self.mp_face_detection.FaceDetection(
            model_selection=1, 
            min_detection_confidence=0.5
        )
        
        # Khởi tạo Face Mesh với các tùy chọn
        self.face_mesh = self.mp_face_mesh.FaceMesh(
            max_num_faces=1,
            refine_landmarks=True,
            min_detection_confidence=0.5,
            min_tracking_confidence=0.5
        )
        
        logger.info("Đã thiết lập thành công các module nhận diện khuôn mặt.")

    def process_image(self, image):
        """Xử lý hình ảnh để nhận diện khuôn mặt và phân tích góc xoay"""
        try:
            # Kiểm tra khung hình đầu vào
            if image is None or image.size == 0 or image.shape[0] == 0 or image.shape[1] == 0:
                logger.warning("Nhận được khung hình rỗng hoặc không hợp lệ")
                return np.zeros((480, 640, 3), dtype=np.uint8)  # Trả về khung hình đen
            
            # Đảm bảo hình ảnh có định dạng hợp lệ (có thể xử lý bằng MediaPipe)
            if len(image.shape) != 3 or image.shape[2] != 3:
                logger.warning("Khung hình không đúng định dạng, cần khung hình BGR 3 kênh")
                return np.zeros((480, 640, 3), dtype=np.uint8)
                
            # Tạo bản sao của hình ảnh để tránh sửa đổi gốc
            image = image.copy()
                
            # Lật hình ảnh theo chiều ngang để hiển thị như gương
            image = cv2.flip(image, 1)
            
            # Chuyển không gian màu từ BGR sang RGB cho MediaPipe
            image_rgb = cv2.cvtColor(image, cv2.COLOR_BGR2RGB)
            
            # Xử lý hình ảnh với Face Detection một cách an toàn
            detection_results = None
            try:
                detection_results = self.face_detection.process(image_rgb)
            except Exception as e:
                logger.error(f"Lỗi khi xử lý face detection: {e}")
                detection_results = None
            
            # Xử lý hình ảnh với Face Mesh một cách an toàn
            mesh_results = None
            try:
                mesh_results = self.face_mesh.process(image_rgb)
            except Exception as e:
                logger.error(f"Lỗi khi xử lý face mesh: {e}")
                mesh_results = None
            
            # Cập nhật trạng thái mặc định
            self.latest_result = {
                "face_detected": False,
                "real_face_score": 0,
                "rotation": {
                    "roll": 0,
                    "pitch": 0,
                    "yaw": 0
                },
                "rotation_text": {
                    "roll": "Thẳng",
                    "pitch": "Thẳng",
                    "yaw": "Thẳng"
                }
            }
            
            # Vẽ kết quả nếu phát hiện được khuôn mặt
            if detection_results and detection_results.detections:
                for detection in detection_results.detections:
                    # Vẽ khung nhận diện khuôn mặt
                    self.mp_drawing.draw_detection(image, detection)
                    
                    # Lấy điểm tin cậy
                    score = detection.score[0]
                    
                    # Kiểm tra khuôn mặt thật/giả
                    self.real_face_score = self.analyze_real_face(image, detection, score)
                    
                    # Hiển thị thông tin khuôn mặt thật/giả
                    cv2.putText(
                        image,
                        f"Khuôn mặt thật: {self.real_face_score:.0%}",
                        (10, 70),
                        cv2.FONT_HERSHEY_SIMPLEX,
                        0.7,
                        (0, 255, 0) if self.real_face_score > 0.7 else (0, 0, 255),
                        2
                    )
                    
                    # Cập nhật trạng thái
                    self.latest_result["face_detected"] = True
                    self.latest_result["real_face_score"] = float(self.real_face_score)
            
            # Phân tích và hiển thị thông tin về góc xoay khuôn mặt nếu có landmark
            if mesh_results and mesh_results.multi_face_landmarks:
                for face_landmarks in mesh_results.multi_face_landmarks:
                    # TẮT việc vẽ lưới điểm mốc khuôn mặt để giảm lag
                    
                    try:
                        # Phân tích góc xoay một cách an toàn
                        roll, pitch, yaw = self.calculate_face_rotation(face_landmarks, image)
                        
                        # Hiển thị thông tin góc xoay
                        cv2.putText(
                            image,
                            f"Nghiêng (Roll): {roll:.1f}°",
                            (10, 110),
                            cv2.FONT_HERSHEY_SIMPLEX,
                            0.7,
                            (255, 0, 0),
                            2
                        )
                        cv2.putText(
                            image,
                            f"Ngẩng/Cúi (Pitch): {pitch:.1f}°",
                            (10, 150),
                            cv2.FONT_HERSHEY_SIMPLEX,
                            0.7,
                            (255, 0, 0),
                            2
                        )
                        cv2.putText(
                            image,
                            f"Quay (Yaw): {yaw:.1f}°",
                            (10, 190),
                            cv2.FONT_HERSHEY_SIMPLEX,
                            0.7,
                            (255, 0, 0),
                            2
                        )
                        
                        # Phân tích hướng xoay khuôn mặt
                        roll_text, pitch_text, yaw_text = self.analyze_rotation_direction(roll, pitch, yaw)
                        
                        # Hiển thị thông tin góc xoay bằng chữ
                        cv2.putText(
                            image,
                            f"Hướng: {roll_text}, {pitch_text}, {yaw_text}",
                            (10, 230),
                            cv2.FONT_HERSHEY_SIMPLEX,
                            0.7,
                            (0, 128, 255),
                            2
                        )
                        
                        # Cập nhật kết quả
                        self.latest_result["rotation"] = {
                            "roll": float(roll),
                            "pitch": float(pitch),
                            "yaw": float(yaw)
                        }
                        self.latest_result["rotation_text"] = {
                            "roll": roll_text,
                            "pitch": pitch_text,
                            "yaw": yaw_text
                        }
                    except Exception as e:
                        logger.error(f"Lỗi khi tính toán góc xoay: {e}")
            
            return image
            
        except Exception as e:
            logger.error(f"Lỗi trong process_image: {e}")
            # Trả về khung hình trống nếu xảy ra lỗi
            return np.zeros((480, 640, 3), dtype=np.uint8)

    def analyze_real_face(self, image, detection, score):
        """Phân tích xem có phải khuôn mặt thật không dựa trên nhiều yếu tố"""
        # Giá trị cơ bản từ độ tin cậy của face detection
        base_score = score
        
        # Có thể bổ sung thêm các phép phân tích khác ở đây
        # như phân tích cấu trúc ảnh, đánh giá kết cấu da, phát hiện mắt nháy, v.v.
        
        return base_score

    def calculate_face_rotation(self, face_landmarks, image):
        """Tính toán góc xoay của khuôn mặt theo 3 trục"""
        h, w, _ = image.shape
        
        # Lấy các điểm mốc quan trọng
        # Điểm mốc cho mắt trái, mắt phải, mũi, cằm và trán
        left_eye = self.get_landmark_position(face_landmarks.landmark[33], w, h)           # Mắt trái
        right_eye = self.get_landmark_position(face_landmarks.landmark[263], w, h)         # Mắt phải
        nose_tip = self.get_landmark_position(face_landmarks.landmark[1], w, h)            # Đỉnh mũi
        chin = self.get_landmark_position(face_landmarks.landmark[152], w, h)              # Cằm
        forehead = self.get_landmark_position(face_landmarks.landmark[10], w, h)           # Điểm trên trán
        mouth_left = self.get_landmark_position(face_landmarks.landmark[61], w, h)         # Miệng trái
        mouth_right = self.get_landmark_position(face_landmarks.landmark[291], w, h)       # Miệng phải
        
        # Điểm trung tâm giữa hai mắt
        eye_center = ((left_eye[0] + right_eye[0]) // 2, (left_eye[1] + right_eye[1]) // 2)
        
        # Tính Roll - góc nghiêng của mặt (xoay theo trục z)
        # Dựa vào góc của đường thẳng nối hai mắt so với phương ngang
        dY = right_eye[1] - left_eye[1]
        dX = right_eye[0] - left_eye[0]
        roll = math.degrees(math.atan2(dY, dX))
        
        # Tính Pitch - góc ngẩng/cúi của mặt (xoay theo trục x) - CẢI TIẾN MỚI
        # Sử dụng tỷ lệ của khoảng cách giữa mũi và tâm mắt so với khoảng cách giữa trán và cằm
        
        # Tính khoảng cách từ mũi đến tâm mắt
        nose_to_eye_distance = nose_tip[1] - eye_center[1]
        
        # Tính khoảng cách từ trán đến cằm
        forehead_to_chin_distance = chin[1] - forehead[1]
        
        # Tính tỷ lệ
        nose_eye_ratio = nose_to_eye_distance / forehead_to_chin_distance if forehead_to_chin_distance > 0 else 0
        
        # Giá trị tham chiếu khi nhìn thẳng (có thể điều chỉnh dựa trên dữ liệu thực nghiệm)
        reference_ratio = 0.12  # Khi nhìn thẳng, tỷ lệ này khoảng 0.12
        
        # Tính góc pitch dựa trên sai lệch từ tỷ lệ tham chiếu
        # Nhân với một hệ số để có được góc phù hợp
        pitch_factor = 90.0  # Hệ số tỷ lệ (có thể điều chỉnh)
        pitch = (nose_eye_ratio - reference_ratio) * pitch_factor
        
        # Điều chỉnh thêm dựa trên vector từ trán đến cằm
        forehead_to_chin_x = chin[0] - forehead[0]
        forehead_to_chin_y = chin[1] - forehead[1]
        
        # Tính góc hiện tại của vector từ trán đến cằm so với trục y
        current_angle = math.degrees(math.atan2(forehead_to_chin_x, forehead_to_chin_y))
        
        # Kết hợp hai phương pháp tính pitch để có kết quả chính xác hơn
        pitch -= current_angle * 0.3  # Trọng số cho phương pháp vector
        
        # Giới hạn góc pitch trong phạm vi hợp lý
        pitch = max(min(pitch, 90), -90)
        
        # Tính Yaw - góc quay của mặt (xoay theo trục y)
        # Dựa vào tỷ lệ khoảng cách giữa mắt trái/phải với mũi
        left_eye_to_nose = math.sqrt((nose_tip[0] - left_eye[0])**2 + (nose_tip[1] - left_eye[1])**2)
        right_eye_to_nose = math.sqrt((nose_tip[0] - right_eye[0])**2 + (nose_tip[1] - right_eye[1])**2)
        
        # Chuẩn hóa góc yaw dựa trên tỷ lệ khoảng cách
        eye_nose_diff = left_eye_to_nose - right_eye_to_nose
        eye_distance = math.sqrt((right_eye[0] - left_eye[0])**2 + (right_eye[1] - left_eye[1])**2)
        yaw = math.degrees(math.atan2(eye_nose_diff, eye_distance))
        
        return roll, pitch, yaw

    def get_landmark_position(self, landmark, width, height):
        """Chuyển đổi tọa độ tương đối của landmark sang tọa độ pixel"""
        x = int(landmark.x * width)
        y = int(landmark.y * height)
        return (x, y)

    def analyze_rotation_direction(self, roll, pitch, yaw):
        """Phân tích hướng xoay của khuôn mặt"""
        roll_text = "Thẳng"
        if abs(roll) > 10:
            roll_text = "Nghiêng phải" if roll > 0 else "Nghiêng trái"
            
        pitch_text = "Thẳng"
        # Sửa đổi logic - đảo ngược các điều kiện của Up và Down
        if pitch < -7:  # Ngẩng lên (Up) khi pitch âm
            pitch_text = "Ngẩng lên"
        elif pitch > 10:  # Cúi xuống (Down) khi pitch dương
            pitch_text = "Cúi xuống"
            
        yaw_text = "Thẳng"
        if abs(yaw) > 10:
            yaw_text = "Quay phải" if yaw > 0 else "Quay trái"
        
        return roll_text, pitch_text, yaw_text

    def process_frame_from_client(self, frame_data):
        """Xử lý khung hình được gửi từ client"""
        try:
            # Kiểm tra dữ liệu khung hình đầu vào
            if not frame_data or len(frame_data) < 100:  # Kiểm tra nếu frame rỗng hoặc quá nhỏ
                logger.warning("Dữ liệu khung hình không hợp lệ hoặc quá nhỏ")
                return {
                    "processed_image": None,
                    "analysis_result": self.latest_result,
                    "error": "Dữ liệu khung hình không hợp lệ"
                }
            
            # Decode khung hình từ base64
            try:
                frame_data = frame_data.split(',')[1] if ',' in frame_data else frame_data
                frame_bytes = base64.b64decode(frame_data)
            except Exception as e:
                logger.error(f"Lỗi khi decode base64: {e}")
                return {
                    "processed_image": None,
                    "analysis_result": self.latest_result,
                    "error": "Không thể decode dữ liệu hình ảnh"
                }
            
            # Chuyển đổi thành mảng NumPy để xử lý với OpenCV
            nparr = np.frombuffer(frame_bytes, np.uint8)
            frame = cv2.imdecode(nparr, cv2.IMREAD_COLOR)
            
            if frame is None or frame.size == 0:
                logger.warning("Không thể decode khung hình hoặc khung hình rỗng")
                # Tạo khung hình rỗng để tránh lỗi
                empty_frame = np.zeros((480, 640, 3), dtype=np.uint8)
                _, buffer = cv2.imencode('.jpg', empty_frame, [cv2.IMWRITE_JPEG_QUALITY, 85])
                empty_frame_base64 = base64.b64encode(buffer).decode('utf-8')
                
                return {
                    "processed_image": f"data:image/jpeg;base64,{empty_frame_base64}",
                    "analysis_result": self.latest_result,
                    "error": "Khung hình không hợp lệ"
                }
            
            # Xử lý khung hình
            processed_frame = self.process_image(frame)
            
            # Encode khung hình đã xử lý thành base64
            _, buffer = cv2.imencode('.jpg', processed_frame, [cv2.IMWRITE_JPEG_QUALITY, 85])
            frame_base64 = base64.b64encode(buffer).decode('utf-8')
            
            # Trả về kết quả
            result = {
                "processed_image": f"data:image/jpeg;base64,{frame_base64}",
                "analysis_result": self.latest_result
            }
            
            return result
        except Exception as e:
            logger.error(f"Lỗi xử lý khung hình: {e}")
            # Tạo khung hình lỗi để trả về
            try:
                error_frame = np.zeros((480, 640, 3), dtype=np.uint8)
                cv2.putText(error_frame, "Lỗi xử lý hình ảnh", (50, 240), cv2.FONT_HERSHEY_SIMPLEX, 1, (0, 0, 255), 2)
                _, buffer = cv2.imencode('.jpg', error_frame, [cv2.IMWRITE_JPEG_QUALITY, 85])
                error_frame_base64 = base64.b64encode(buffer).decode('utf-8')
                
                return {
                    "processed_image": f"data:image/jpeg;base64,{error_frame_base64}",
                    "analysis_result": self.latest_result,
                    "error": str(e)
                }
            except:
                return {
                    "processed_image": None,
                    "analysis_result": None,
                    "error": f"Lỗi xử lý khung hình: {str(e)}"
                }
    
    def save_image_to_temp(self, image, direction_text):
        """Lưu hình ảnh vào thư mục tạm và cập nhật danh sách ảnh đã chụp"""
        try:
            # Đổi tên hướng từ tiếng Việt sang tiếng Anh
            english_direction = direction_text
            if direction_text == "Ngẩng lên":
                english_direction = "up"
            elif direction_text == "Nhìn thẳng":
                english_direction = "straight"
            elif direction_text == "Quay trái":
                english_direction = "left"
            elif direction_text == "Quay phải":
                english_direction = "right"
            elif direction_text == "Cúi xuống":
                english_direction = "down"

            # Tạo tên file dựa trên thời gian và hướng
            timestamp = datetime.now().strftime("%Y%m%d_%H%M%S")
            base_filename = f"face-{english_direction}-{timestamp}"
            filepath = os.path.join(TEMP_DIR, f"{base_filename}.jpg")
            
            # Đảm bảo khuôn mặt xuất hiện đầy đủ trong hình ảnh
            face_image = self.crop_face_from_image(image)
            
            # Nén hình và đổi kích thước về 128x128 pixel
            resized_face = cv2.resize(face_image, (128, 128), interpolation=cv2.INTER_AREA)
            
            # Lấy IP của người dùng
            try:
                client_ip = request.remote_addr
            except:
                client_ip = "unknown"
                
            # Thu thập metadata
            metadata = {
                "timestamp": timestamp,
                "direction": english_direction,  # Lưu hướng tiếng Anh trong metadata
                "original_direction": direction_text,  # Lưu thêm hướng tiếng Việt gốc
                "real_face_score": float(self.real_face_score),
                "rotation": {
                    "roll": float(self.latest_result["rotation"]["roll"]),
                    "pitch": float(self.latest_result["rotation"]["pitch"]),
                    "yaw": float(self.latest_result["rotation"]["yaw"])
                },
                "client_ip": client_ip,
                "session_id": self.session_id,
                "image_size": "128x128",
                # Thêm thông tin người dùng vào metadata
                "user_info": {
                    "fullname": self.user_info["fullname"],
                    "employeeId": self.user_info["employeeId"],
                    "email": self.user_info["email"],
                    "department": self.user_info["department"]
                }
            }
            
            # Lưu ảnh đã resize với chất lượng nén 80%
            cv2.imwrite(filepath, resized_face, [cv2.IMWRITE_JPEG_QUALITY, 80])
            
            # Lưu metadata vào file JSON
            metadata_filepath = os.path.join(TEMP_DIR, f"{base_filename}.json")
            with open(metadata_filepath, 'w', encoding='utf-8') as f:
                json.dump(metadata, f, ensure_ascii=False, indent=2)
            
            # Thêm thông tin ảnh vào danh sách đã chụp
            image_info = {
                "id": len(self.captured_images) + 1,
                "path": filepath,
                "filename": f"{base_filename}.jpg",
                "metadata_path": metadata_filepath,
                "direction": english_direction,
                "original_direction": direction_text,
                "timestamp": timestamp,
                "url": f"/temp_captures/{base_filename}.jpg",
                "real_face_score": f"{self.real_face_score:.0%}",
                "rotation": f"Roll: {self.latest_result['rotation']['roll']:.1f}°, "
                           f"Pitch: {self.latest_result['rotation']['pitch']:.1f}°, "
                           f"Yaw: {self.latest_result['rotation']['yaw']:.1f}°",
                "user": self.user_info["fullname"]
            }
            self.captured_images.append(image_info)
            
            # Cập nhật trạng thái đã chụp
            if direction_text == "Nhìn thẳng":
                self.captured_directions["straight"] = True
            elif direction_text == "Quay trái":
                self.captured_directions["left"] = True
            elif direction_text == "Quay phải":
                self.captured_directions["right"] = True
            elif direction_text == "Ngẩng lên":
                self.captured_directions["up"] = True
            elif direction_text == "Cúi xuống":
                self.captured_directions["down"] = True
                
            logger.info(f"Đã lưu ảnh {direction_text} ({english_direction}) của {self.user_info['fullname']} vào: {filepath}")
            
            # Kiểm tra nếu đã chụp đủ các hướng
            all_captured = all(self.captured_directions.values())
            
            return {
                "success": True, 
                "image_info": image_info,
                "all_directions_captured": all_captured
            }
        except Exception as e:
            logger.error(f"Lỗi khi lưu ảnh: {e}")
            return {"success": False, "error": str(e)}
    
    def check_and_capture_face(self, frame, rotation, rotation_text):
        """Kiểm tra và chụp ảnh khuôn mặt nếu đạt tiêu chí"""
        # Nếu đã chụp đủ 5 hướng thì không cần chụp thêm
        if all(self.captured_directions.values()):
            return {"captured": False, "message": "Đã chụp đủ các hướng"}
            
        # Kiểm tra độ tin cậy
        if self.real_face_score < 0.7:
            return {"captured": False, "message": "Độ tin cậy nhận diện thấp"}
            
        # Xử lý các hướng nhìn - Sử dụng YAW cho quay trái/phải và PITCH cho ngẩng lên/cúi xuống
        captured = False
        direction = None
        
        # Yaw (Quay trái/phải)
        if rotation_text["yaw"] == "Quay trái" and not self.captured_directions["left"] and abs(rotation["yaw"]) > 15:
            direction = "Quay trái"
            captured = True
            
        elif rotation_text["yaw"] == "Quay phải" and not self.captured_directions["right"] and abs(rotation["yaw"]) > 15:
            direction = "Quay phải"
            captured = True
            
        # Pitch (Ngẩng lên/Cúi xuống) - với điều kiện mới đã đảo ngược
        elif rotation_text["pitch"] == "Ngẩng lên" and not self.captured_directions["up"] and rotation["pitch"] < -7:
            direction = "Ngẩng lên"
            captured = True
            
        elif rotation_text["pitch"] == "Cúi xuống" and not self.captured_directions["down"] and rotation["pitch"] > 10:
            direction = "Cúi xuống"
            captured = True
            
        # Nhìn thẳng: chỉ khi cả yaw và pitch đều gần 0 (không quay, không ngẩng/cúi)
        elif (abs(rotation["yaw"]) <= 10 and abs(rotation["pitch"]) <= 10) and not self.captured_directions["straight"]:
            direction = "Nhìn thẳng"
            captured = True
        
        # Nếu có hướng cần chụp và chưa chụp hướng này
        if captured and direction:
            result = self.save_image_to_temp(frame, direction)
            return {
                "captured": True, 
                "direction": direction, 
                "all_directions_captured": result.get("all_directions_captured", False)
            }
        
        return {"captured": False}
    
    def get_captured_images(self):
        """Lấy danh sách các ảnh đã chụp"""
        return {
            "images": self.captured_images, 
            "directions": self.captured_directions,
            "all_captured": all(self.captured_directions.values())
        }
    
    def reset_captured_directions(self):
        """Đặt lại trạng thái chụp ảnh"""
        self.captured_directions = {
            "straight": False,
            "left": False,
            "right": False,
            "up": False,
            "down": False
        }
        self.captured_images = []
        self.session_id = str(uuid.uuid4())[:8]
        return {"success": True, "message": "Đã đặt lại trạng thái chụp ảnh"}
    
    def crop_face_from_image(self, image):
        """Cắt khuôn mặt từ hình ảnh để đảm bảo khuôn mặt hiển thị đầy đủ"""
        try:
            # Chuyển sang RGB để xử lý với MediaPipe
            image_rgb = cv2.cvtColor(image, cv2.COLOR_BGR2RGB)
            
            # Phát hiện khuôn mặt sử dụng Face Mesh
            results = self.mp_face_mesh.process(image_rgb)
            
            # Nếu không phát hiện được khuôn mặt, trả về hình ảnh gốc
            if not results.multi_face_landmarks:
                # Đảm bảo hình ảnh là vuông
                h, w = image.shape[:2]
                size = min(h, w)
                top = (h - size) // 2
                left = (w - size) // 2
                return image[top:top+size, left:left+size]
            
            h, w = image.shape[:2]
            landmarks = results.multi_face_landmarks[0].landmark
            
            # Tìm tọa độ khuôn mặt
            face_coords = [(int(landmark.x * w), int(landmark.y * h)) for landmark in landmarks]
            
            # Tìm các điểm biên của khuôn mặt
            x_min = min([coord[0] for coord in face_coords])
            y_min = min([coord[1] for coord in face_coords])
            x_max = max([coord[0] for coord in face_coords])
            y_max = max([coord[1] for coord in face_coords])
            
            # Mở rộng vùng cắt để đảm bảo khuôn mặt hiển thị đầy đủ
            face_width = x_max - x_min
            face_height = y_max - y_min
            
            # Tính toán trung tâm khuôn mặt
            center_x = (x_min + x_max) // 2
            center_y = (y_min + y_max) // 2
            
            # Mở rộng hơn để lấy đầy đủ khuôn mặt và đảm bảo tỷ lệ vuông
            # Lấy kích thước dài nhất và thêm lề
            face_size = max(face_width, face_height)
            padding = int(face_size * 0.5)  # Thêm 50% padding để đảm bảo khuôn mặt hiển thị đầy đủ
            size = face_size + 2 * padding
            
            # Tính toán tọa độ vùng cắt, đảm bảo không vượt quá kích thước ảnh
            left = max(0, center_x - size // 2)
            top = max(0, center_y - size // 2)
            right = min(w, center_x + size // 2)
            bottom = min(h, center_y + size // 2)
            
            # Đảm bảo vùng cắt là vuông
            crop_width = right - left
            crop_height = bottom - top
            
            if crop_width > crop_height:
                # Nếu chiều rộng lớn hơn, điều chỉnh top và bottom
                diff = crop_width - crop_height
                top = max(0, top - diff // 2)
                bottom = min(h, bottom + diff // 2)
            elif crop_height > crop_width:
                # Nếu chiều cao lớn hơn, điều chỉnh left và right
                diff = crop_height - crop_width
                left = max(0, left - diff // 2)
                right = min(w, right + diff // 2)
            
            # Cắt ảnh
            cropped_image = image[top:bottom, left:right]
            
            # Kiểm tra nếu ảnh cắt thành công
            if cropped_image.size == 0:
                logger.warning("Ảnh cắt không hợp lệ, trả về ảnh gốc")
                return image
                
            return cropped_image
            
        except Exception as e:
            logger.error(f"Lỗi khi cắt ảnh khuôn mặt: {e}")
            # Trả về hình ảnh gốc nếu có lỗi
            return image

# Hàm để lấy địa chỉ IP của máy chủ
def get_local_ip():
    try:
        # Lấy hostname
        hostname = socket.gethostname()
        # Lấy địa chỉ IP từ hostname
        ip_address = socket.gethostbyname(hostname)
        return ip_address
    except Exception as e:
        logger.error(f"Lỗi khi lấy địa chỉ IP: {e}")
        return "127.0.0.1"

# Khởi tạo Flask app
app = Flask(__name__)
face_detector = FaceDetectionApp()

@app.route('/')
def index():
    """Trang chủ của ứng dụng"""
    return render_template('index.html')

@app.route('/process_frame', methods=['POST'])
def process_frame():
    """Endpoint xử lý khung hình từ client"""
    if 'image' not in request.json:
        return jsonify({"error": "Không tìm thấy dữ liệu hình ảnh"}), 400
    
    frame_data = request.json['image']
    result = face_detector.process_frame_from_client(frame_data)
    
    # Kiểm tra và chụp ảnh nếu thỏa các điều kiện
    if "analysis_result" in result and result["analysis_result"]["face_detected"]:
        # Lưu khung hình gốc (không phải khung hình đã xử lý)
        try:
            frame_data = frame_data.split(',')[1] if ',' in frame_data else frame_data
            frame_bytes = base64.b64decode(frame_data)
            nparr = np.frombuffer(frame_bytes, np.uint8)
            frame = cv2.imdecode(nparr, cv2.IMREAD_COLOR)
            
            if frame is not None:
                # Kiểm tra và chụp ảnh theo các góc xoay
                capture_result = face_detector.check_and_capture_face(
                    frame,
                    result["analysis_result"]["rotation"],
                    result["analysis_result"]["rotation_text"]
                )
                
                # Thêm thông tin chụp ảnh vào kết quả
                result["capture_result"] = capture_result
        except Exception as e:
            logger.error(f"Lỗi khi chụp ảnh tự động: {e}")
    
    if "error" in result and result["processed_image"] is None:
        return jsonify(result), 500
        
    return jsonify(result)

@app.route('/temp_captures/<path:filename>')
def serve_temp_image(filename):
    """Phục vụ hình ảnh từ thư mục tạm"""
    return send_from_directory(TEMP_DIR, filename)

@app.route('/captured_images', methods=['GET'])
def get_captured_images():
    """Lấy danh sách ảnh đã chụp"""
    return jsonify(face_detector.get_captured_images())

@app.route('/reset_capture', methods=['POST'])
def reset_capture():
    """Đặt lại trạng thái chụp ảnh"""
    return jsonify(face_detector.reset_captured_directions())

@app.route('/register_user', methods=['POST'])
def register_user():
    """Endpoint nhận thông tin người dùng từ client"""
    try:
        user_data = request.json
        if not user_data:
            return jsonify({"success": False, "error": "Không tìm thấy dữ liệu người dùng"}), 400

        # Yêu cầu phải có đủ thông tin cần thiết
        required_fields = ["fullname", "employeeId", "email", "department"]
        for field in required_fields:
            if field not in user_data or not user_data[field]:
                return jsonify({
                    "success": False, 
                    "error": f"Thiếu thông tin bắt buộc: {field}"
                }), 400

        # Kiểm tra phòng ban hợp lệ
        valid_departments = ["StepMedia", "MediaStep"]
        if user_data["department"] not in valid_departments:
            return jsonify({
                "success": False, 
                "error": f"Phòng ban không hợp lệ. Phải là một trong {', '.join(valid_departments)}"
            }), 400

        # Lưu thông tin người dùng vào biến của class FaceDetectionApp
        face_detector.user_info = {
            "fullname": user_data["fullname"],
            "employeeId": user_data["employeeId"],
            "email": user_data["email"],
            "department": user_data["department"]
        }

        # Log thông tin đăng ký
        logger.info(f"Đã đăng ký thông tin người dùng mới: {user_data['fullname']} - {user_data['employeeId']} - {user_data['department']}")

        return jsonify({
            "success": True,
            "message": f"Đã đăng ký thành công thông tin của {user_data['fullname']}",
            "user_info": face_detector.user_info
        })

    except Exception as e:
        logger.error(f"Lỗi khi đăng ký thông tin người dùng: {e}")
        return jsonify({
            "success": False,
            "error": f"Lỗi khi xử lý thông tin đăng ký: {str(e)}"
        }), 500

# Thực thi server khi chạy trực tiếp
if __name__ == "__main__":
    # Hiển thị thông tin truy cập
    ip_address = get_local_ip()
    port = int(os.environ.get("PORT", 5000))
    logger.info(f"Server có thể truy cập từ: http://{ip_address}:{port}/")
    logger.info(f"Để sử dụng từ thiết bị khác, hãy truy cập URL trên hoặc quét mã QR tại: http://{ip_address}:{port}/qr")
    
    # Chạy ứng dụng Flask
    app.run(host='0.0.0.0', port=port, debug=False, threaded=True)