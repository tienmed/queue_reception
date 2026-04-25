import sys
import os
import subprocess

bridge_path = r"c:\Users\Thinkpad X280\OneDrive\CodexSkillRepos\QUERE_PK\tts_bridge.py"
output_dir = r"c:\Users\Thinkpad X280\OneDrive\CodexSkillRepos\QUERE_PK\data\tts-cache"
python_path = "python"

announcement = "Phòng khám đa khoa Trường Đại học y khoa phạm ngọc thạch kính chào quí khách hàng. Hiện tại đang vào đầu ca, số lượng lấy số chờ khá đông, quí khách hàng vui lòng hãy giữ trật tự, ngồi ghế chờ và nghe thông báo gọi số thứ tự để đến quầy tiếp nhận. Rất cám ơn quí khách hàng hưởng ứng và tuân thủ để đảm bảo trật tự tại nơi tiếp nhận. Xin cám ơn"

voices = {
    "bich_ngoc": "Bích Ngọc (Nữ - Miền Bắc)",
    "pham_tuyen": "Phạm Tuyên (Nam - Miền Bắc)",
    "thuc_doan": "Thục Đoan (Nữ - Miền Nam)",
    "xuan_vinh": "Xuân Vĩnh (Nam - Miền Nam)"
}

if not os.path.exists(output_dir):
    os.makedirs(output_dir, exist_ok=True)

for voice_id, voice_name in voices.items():
    output_path = os.path.join(output_dir, f"{voice_id}_start.wav")
    print(f"Generating for {voice_name}...")
    subprocess.run([
        python_path, bridge_path, 
        announcement, 
        "--output", output_path, 
        "--voice", voice_name
    ], check=True)
    print(f"Done: {output_path}")
