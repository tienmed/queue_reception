
import requests
import json

url = "http://localhost:3000/api/increment-and-announce"
payload = {
    "streamKey": "bhyt",
    "counterKey": "quay1",
    "voice": "bich_ngoc"
}

try:
    print(f"Sending request to {url}...")
    response = requests.post(url, json=payload, timeout=10)
    print(f"Status Code: {response.status_code}")
    if response.status_code == 200:
        print("Success! Audio received.")
        print(f"Content-Type: {response.headers.get('Content-Type')}")
        print(f"Length: {len(response.content)}")
    else:
        print(f"Error Body: {response.text}")
except Exception as e:
    print(f"Exception: {e}")
