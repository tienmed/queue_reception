import wave
import struct
import math
import os

def generate_airport_chime(output_path):
    sample_rate = 44100
    
    # 4-note airport chime (F4, A4, C5, F5)
    frequencies = [349.23, 440.00, 523.25, 698.46]
    note_duration = 0.5
    gap = 0.05
    
    samples = []
    
    for i, freq in enumerate(frequencies):
        num_samples = int(sample_rate * note_duration)
        for j in range(num_samples):
            t = j / sample_rate
            # Sine wave with exponential decay for a bell-like sound
            # Added a second overtone for richness
            val = (math.sin(2 * math.pi * freq * t) * 0.6 + 
                   math.sin(2 * math.pi * freq * 2 * t) * 0.3)
            
            # Envelope
            envelope = math.exp(-4 * t)
            samples.append(val * envelope * 0.5)
            
        # Add small silence gap between notes
        for _ in range(int(sample_rate * gap)):
            samples.append(0)

    with wave.open(output_path, 'w') as wav_file:
        wav_file.setnchannels(1)
        wav_file.setsampwidth(2)
        wav_file.setframerate(sample_rate)
        
        for s in samples:
            val = int(max(-1, min(1, s)) * 32767)
            wav_file.writeframesraw(struct.pack('<h', val))

output_dir = r"c:\Users\Thinkpad X280\OneDrive\CodexSkillRepos\QUERE_PK\public\assets\sounds"
if not os.path.exists(output_dir):
    os.makedirs(output_dir, exist_ok=True)

output_path = os.path.join(output_dir, "notification.wav")
generate_airport_chime(output_path)
print(f"Professional Airport Chime generated at: {output_path}")
