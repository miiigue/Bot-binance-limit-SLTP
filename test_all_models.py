import requests
import json
import sys

sys.path.insert(0, '/opt/bot-binance')
from src.database import get_bot_setting
key = get_bot_setting('admin_ai_api_key', '')

candidates = [
    'gemini-3.8-flash',
    'gemini-3.7-flash',
    'gemini-3.6-flash',
    'gemini-3.5-flash',
    'gemini-3.5-flash-lite',
    'gemini-flash-latest',
    'gemini-flash-lite-latest',
    'gemini-pro-latest',
    'gemini-3-flash-preview',
    'gemini-3.1-flash-lite',
    'gemma-4-26b-a4b-it'
]

for m in candidates:
    url = f"https://generativelanguage.googleapis.com/v1beta/models/{m}:generateContent?key={key}"
    res = requests.post(url, json={"contents": [{"parts": [{"text": "Ping"}]}]}, timeout=10)
    print(f"[{m}] -> Status: {res.status_code} | Body: {res.text[:100]}")
