import os
import subprocess
import sys

# Cấu hình
PYTHON_PATH = r"C:\Users\Thinkpad X280\AppData\Local\Programs\Python\Python311\python.exe"
BRIDGE_PATH = "tts_bridge.py"
OUTPUT_DIR = "data/tts-cache"
VOICE = "Bích Ngọc (Nữ - Miền Bắc)"
SPEED = 1.0
TEMPLATE = "Mời số thứ tự {number} tới quầy Tiếp Nhận bảo hiểm y tế."

def generate_tts():
    if not os.path.exists(OUTPUT_DIR):
        os.makedirs(OUTPUT_DIR)
        print(f"Created directory: {OUTPUT_DIR}")

    for i in range(1, 51):
        number_str = str(i).zfill(3)
        text = TEMPLATE.format(number=number_str)
        filename = f"bich_ngoc_bhyt_{number_str}.wav"
        output_path = os.path.join(OUTPUT_DIR, filename)

        print(f"Generating [{i}/50]: {filename}...")
        
        cmd = [
            PYTHON_PATH,
            BRIDGE_PATH,
            text,
            "--output", output_path,
            "--voice", VOICE,
            "--speed", str(SPEED)
        ]

        try:
            result = subprocess.run(cmd, capture_output=True, text=True, check=True)
            if "TTS_SUCCESS" in result.stdout:
                print(f"  Success: {output_path}")
            else:
                print(f"  Warning: {result.stdout}")
        except subprocess.CalledProcessError as e:
            print(f"  Error generating {filename}: {e.stderr}")

if __name__ == "__main__":
    generate_tts()
