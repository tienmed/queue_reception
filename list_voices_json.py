import json
try:
    from vieneu import Vieneu
    tts = Vieneu()
    
    # Lấy danh sách presets
    presets = tts.list_preset_voices()
    
    # Thử lấy thêm thông tin từ các phương thức khác nếu có
    all_voices = []
    
    # 1. Từ presets
    for description, v_id in presets:
        all_voices.append({"id": v_id, "name": description, "source": "preset"})
        
    # 2. Thử gọi get_voices nếu tồn tại
    try:
        if hasattr(tts, "get_voices"):
            voices = tts.get_voices()
            for v in voices:
                # Tránh trùng lặp
                if not any(item["id"] == v.id for item in all_voices):
                    all_voices.append({"id": v.id, "name": getattr(v, "name", v.id), "source": "all_voices"})
    except:
        pass

    with open("voices.json", "w", encoding="utf-8") as f:
        json.dump(all_voices, f, ensure_ascii=False, indent=2)
    print("SUCCESS: voices.json created with thorough search")
except Exception as e:
    print(f"Error: {e}")
