#!/usr/bin/env python3
"""
Script để chạy ứng dụng web nhận diện khuôn mặt.
Cung cấp một giao diện dòng lệnh để chạy ứng dụng web với các tùy chọn khác nhau.
"""

import argparse
import os
import sys
from main import app

def parse_args():
    """Phân tích các đối số dòng lệnh."""
    parser = argparse.ArgumentParser(description='Chạy ứng dụng web nhận diện khuôn mặt')
    parser.add_argument('--host', default='0.0.0.0', help='Host để lắng nghe (mặc định: 0.0.0.0)')
    parser.add_argument('--port', type=int, default=5000, help='Port để lắng nghe (mặc định: 5000)')
    parser.add_argument('--debug', action='store_true', help='Chạy trong chế độ debug')
    return parser.parse_args()

def main():
    """Hàm main để chạy ứng dụng."""
    args = parse_args()
    
    print("=== Ứng Dụng Web Nhận Diện Khuôn Mặt ===")
    print(f"Khởi động server tại http://{args.host}:{args.port}/")
    
    if args.debug:
        print("Chạy trong chế độ DEBUG")
    
    try:
        app.run(host=args.host, port=args.port, debug=args.debug, threaded=True)
    except KeyboardInterrupt:
        print("\nĐã nhận lệnh thoát từ người dùng.")
    except Exception as e:
        print(f"\nLỗi: {e}")
    finally:
        print("\nĐã đóng ứng dụng.")
        sys.exit(0)

if __name__ == "__main__":
    main()