# Ứng Dụng Nhận Diện Khuôn Mặt Qua Mạng

Ứng dụng web này sử dụng MediaPipe để nhận diện khuôn mặt người thật và phân tích các góc xoay của khuôn mặt theo thời gian thực từ webcam. Được thiết kế để hoạt động như một Pinokio app, cho phép truy cập và sử dụng từ xa qua mạng.

## Tính Năng

- Nhận diện khuôn mặt người thật với độ tin cậy
- Phân tích góc xoay của khuôn mặt theo 3 trục:
  - **Roll**: Nghiêng sang trái/phải (xoay theo trục Z)
  - **Pitch**: Ngẩng lên/cúi xuống (xoay theo trục X)
  - **Yaw**: Quay sang trái/phải (xoay theo trục Y)
- Hiển thị lưới điểm mốc khuôn mặt (facial mesh)
- Hiển thị FPS và thời gian xử lý
- Giao diện web thân thiện với người dùng
- Tính năng chụp ảnh khuôn mặt đã phân tích

## Yêu Cầu Hệ Thống

- Python 3.7+
- Webcam hoạt động
- Trình duyệt web hiện đại hỗ trợ MediaDevices API

## Cài Đặt

1. Clone repository hoặc tải xuống mã nguồn
2. Cài đặt các thư viện phụ thuộc:

```bash
pip install -r requirements.txt
```

## Cách Sử Dụng

### Chạy Ứng Dụng Web

Chạy ứng dụng bằng lệnh:

```bash
python run.py
```

Hoặc với các tùy chọn:

```bash
python run.py --host 127.0.0.1 --port 8000 --debug
```

Sau đó, mở trình duyệt và truy cập vào địa chỉ:

```
http://localhost:5000
```

### Sử Dụng Giao Diện Web

1. Nhấn nút **Bắt đầu** để kích hoạt camera và bắt đầu nhận diện
2. Khuôn mặt được phát hiện sẽ hiển thị với các điểm mốc và đường viền
3. Thông tin về góc xoay và độ tin cậy hiển thị ở bảng điều khiển bên dưới
4. Nhấn nút **Chụp ảnh** để lưu lại khuôn mặt hiện tại
5. Nhấn nút **Dừng** để dừng quá trình nhận diện

### Triển Khai Trên Server

Để triển khai ứng dụng trên server hoặc dịch vụ đám mây, bạn có thể sử dụng Gunicorn:

```bash
gunicorn -w 4 -b 0.0.0.0:5000 main:app
```

## Cấu Trúc Dự Án

```
/
├── main.py           - Mã nguồn chính và server Flask
├── run.py            - Script để chạy ứng dụng
├── requirements.txt  - Danh sách các thư viện phụ thuộc
├── README.md         - Tài liệu hướng dẫn
├── static/           - Tài nguyên tĩnh
│   ├── css/          
│   │   └── style.css - File CSS cho giao diện
│   └── js/
│       └── app.js    - JavaScript xử lý phía client
└── templates/
    └── index.html    - Template HTML cho trang web
```

## Nguyên Lý Hoạt Động

1. **Web Client**: Sử dụng JavaScript để truy cập camera của người dùng và gửi hình ảnh đến server
2. **Server Flask**: Nhận hình ảnh, xử lý bằng MediaPipe, và trả về kết quả phân tích
3. **MediaPipe**: Phát hiện khuôn mặt, các điểm mốc và phân tích đặc điểm
4. **Hiển Thị Kết Quả**: Client nhận kết quả và hiển thị thông tin trên giao diện

## Bảo Mật

- Dữ liệu hình ảnh được xử lý tại server và không được lưu trữ
- Khuyến nghị sử dụng HTTPS khi triển khai trên môi trường công cộng
- Không nên mở port server ra internet công cộng nếu không có biện pháp bảo mật phù hợp

## Nâng Cấp Trong Tương Lai

- Cải thiện phát hiện khuôn mặt thật/giả bằng cách kết hợp phát hiện chuyển động
- Thêm tính năng nhận diện người cụ thể
- Thêm tính năng xác thực đa yếu tố sử dụng nhận diện khuôn mặt
- Tối ưu hóa hiệu suất xử lý hình ảnh

## Giấy Phép

MIT License