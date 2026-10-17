import requests
import json
import sys

sys.path.insert(0, '/opt/bot-binance')
from src.database import get_bot_setting
key = get_bot_setting('admin_ai_api_key', '')

candidates = [
    'gemini-3.8-flash',
    'gemini-3.7-flash',
    'gemini-3.5-flash',
    'gemini-3.5-flash-lite',
    'gemini-3.1-flash-lite',
    'gemini-flash-latest',
    'gemini-pro-latest'
]

for m in candidates:
    url = f"https://generativelanguage.googleapis.com/v1beta/models/{m}:generateContent?key={key}"
    try:
        res = requests.post(url, json={"contents": [{"parts": [{"text": "Di OK"}]}]}, timeout=10)
        print(f"[{m}] -> Status: {res.status_code}")
        if res.ok:
            print("   SUCCESS:", res.json().get('candidates', [{}])[0].get('content', {}).get('parts', [{}])[0].get('text', ''))
        else:
            print("   ERR:", res.text[:120])
    except Exception as e:
        print(f"[{m}] Exception: {e}")
