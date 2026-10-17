import requests
import json
import os
import sys

sys.path.insert(0, '/opt/bot-binance')
try:
    from src.database import get_bot_setting
    key = get_bot_setting('admin_ai_api_key', '')
    saved_model = get_bot_setting('admin_ai_model', 'NO_MODEL')
except Exception as e:
    print("Error cargando setting:", e)
    key = ""
    saved_model = "ERROR"

print(f"Key en BD: {key[:6]}...{key[-4:] if len(key)>10 else ''} (len: {len(key)})")
print(f"Modelo guardado en BD: {saved_model}")

if not key:
    print("No hay key configurada")
    sys.exit(0)

# Probar exactamente lo que hace el endpoint /api/notes/ai_test
req_model = saved_model if saved_model != 'NO_MODEL' else 'gemini-3.8-flash'
models_to_try = [req_model]
for fallback in ['gemini-3.8-flash', 'gemini-2.0-flash', 'gemini-1.5-flash']:
    if fallback not in models_to_try:
        models_to_try.append(fallback)

print("Models to try en orden:", models_to_try)
for mod in models_to_try:
    url = f"https://generativelanguage.googleapis.com/v1beta/models/{mod}:generateContent?key={key}"
    try:
        res = requests.post(url, json={"contents": [{"parts": [{"text": "Responde únicamente: 'CONEXION_OK'"}]}]}, timeout=10)
        print(f"[{mod}] -> Status {res.status_code} -> Resp: {res.text[:120]}")
    except Exception as ex:
        print(f"[{mod}] -> Exception: {ex}")
