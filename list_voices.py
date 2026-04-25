import sys
import io

# Đặt mã hóa đầu ra là utf-8 để hỗ trợ ký tự tiếng Việt
sys.stdout = io.TextIOWrapper(sys.stdout.buffer, encoding='utf-8')

try:
    from vieneu import Vieneu
    tts = Vieneu()
    voices = tts.list_preset_voices()
    print("--- VOICE LIST ---")
    for description, v_id in voices:
        print(f"ID: {v_id} | Name: {description}")
    print("--- END OF LIST ---")
except Exception as e:
    print(f"Error: {e}")
