
import json
try:
    from vieneu import Vieneu
    tts = Vieneu()
    
    results = {
        "presets": tts.list_preset_voices(),
        "all_voices": []
    }
    
    try:
        voices = tts.get_voices()
        for v in voices:
            results["all_voices"].append({"id": v.id, "name": getattr(v, "name", "N/A")})
    except Exception as e:
        results["get_voices_error"] = str(e)
        
    with open("voices_final.json", "w", encoding="utf-8") as f:
        json.dump(results, f, ensure_ascii=False, indent=2)
    print("SUCCESS: voices_final.json created")
except Exception as e:
    print(f"Error: {e}")
