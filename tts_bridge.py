import sys
import os
import argparse
import logging

# Tắt các log không cần thiết để giữ stdout sạch cho Node.js đọc đường dẫn file
logging.basicConfig(level=logging.ERROR)

def main():
    parser = argparse.ArgumentParser(description="VieNeu-TTS Bridge nâng cao")
    parser.add_argument("text", help="Văn bản cần chuyển thành giọng nói")
    parser.add_argument("--output", default="public/tts_output.wav", help="Đường dẫn file đầu ra")
    parser.add_argument("--voice", default="Bích Ngọc (Nữ - Miền Bắc)", help="Tên giọng đọc (preset)")
    
    args = parser.parse_args()

    try:
        from vieneu import Vieneu
        
        # Khởi tạo Vieneu (Mặc định ở chế độ Turbo để tối ưu tốc độ)
        tts = Vieneu()
        
        # Lấy dữ liệu giọng đọc từ preset
        voice_data = tts.get_preset_voice(args.voice)
        if not voice_data:
            # Nếu không tìm thấy giọng yêu cầu, sử dụng giọng mặc định
            voice_data = tts.get_preset_voice("Bích Ngọc (Nữ - Miền Bắc)")

        # Thực hiện chuyển đổi văn bản thành âm thanh
        audio = tts.infer(text=args.text, voice=voice_data)
        
        # Lưu file âm thanh
        tts.save(audio, args.output)
        
        # In ra dấu hiệu thành công và đường dẫn file để Node.js nhận diện
        print(f"TTS_SUCCESS:{args.output}")
        sys.exit(0)
    except Exception as e:
        print(f"TTS_ERROR:{str(e)}", file=sys.stderr)
        sys.exit(1)

if __name__ == "__main__":
    main()
