#!/usr/bin/env python
# -*- coding: utf-8 -*-
"""
Módulo de Autenticación, Seguridad y Gestión de Tokens JWT.
Implementa firma criptográfica HMAC-SHA256 estándar (RFC 7519) sin dependencias
externas frágiles, hashing seguro con Werkzeug y decoradores de autorización.
"""

import os
import time
import json
import hmac
import hashlib
import base64
from functools import wraps
from flask import request, jsonify
from werkzeug.security import generate_password_hash, check_password_hash

# Obtener o generar clave secreta para JWT
JWT_SECRET_KEY = os.environ.get('JWT_SECRET_KEY', 'binance_algo_bot_super_secret_jwt_key_2026_x89f')
TOKEN_EXPIRATION_SECONDS = 7 * 24 * 3600  # 7 días de validez


def _base64url_encode(data: bytes) -> str:
    """Codifica bytes en formato Base64URL sin padding '='."""
    return base64.urlsafe_b64encode(data).decode('utf-8').rstrip('=')


def _base64url_decode(data_str: str) -> bytes:
    """Decodifica un string Base64URL agregando el padding necesario."""
    padding = '=' * (4 - (len(data_str) % 4)) if (len(data_str) % 4) != 0 else ''
    return base64.urlsafe_b64decode(data_str + padding)


def hash_password(password: str) -> str:
    """Genera un hash criptográfico seguro para la contraseña."""
    return generate_password_hash(password, method='scrypt')


def verify_password(password: str, password_hash: str) -> bool:
    """Verifica si la contraseña coincide con el hash almacenado."""
    if not password or not password_hash:
        return False
    try:
        return check_password_hash(password_hash, password)
    except Exception:
        return False


def generate_jwt(user_id: int, username: str, role: str, expires_in: int = TOKEN_EXPIRATION_SECONDS) -> str:
    """
    Genera un Token JWT firmado con HMAC-SHA256.
    """
    header = {"alg": "HS256", "typ": "JWT"}
    now = int(time.time())
    payload = {
        "user_id": user_id,
        "username": username,
        "role": role,
        "iat": now,
        "exp": now + expires_in
    }

    header_b64 = _base64url_encode(json.dumps(header, separators=(',', ':')).encode('utf-8'))
    payload_b64 = _base64url_encode(json.dumps(payload, separators=(',', ':')).encode('utf-8'))
    
    signing_input = f"{header_b64}.{payload_b64}".encode('utf-8')
    signature = hmac.new(JWT_SECRET_KEY.encode('utf-8'), signing_input, hashlib.sha256).digest()
    sig_b64 = _base64url_encode(signature)

    return f"{header_b64}.{payload_b64}.{sig_b64}"


def decode_jwt(token: str) -> dict:
    """
    Decodifica y valida la firma y expiración de un token JWT.
    Retorna el payload si es válido, o None si expiró o fue manipulado.
    """
    if not token or not isinstance(token, str):
        return None

    parts = token.strip().split('.')
    if len(parts) != 3:
        return None

    header_b64, payload_b64, sig_b64 = parts

    # Verificar firma HMAC-SHA256
    signing_input = f"{header_b64}.{payload_b64}".encode('utf-8')
    expected_sig = hmac.new(JWT_SECRET_KEY.encode('utf-8'), signing_input, hashlib.sha256).digest()
    expected_sig_b64 = _base64url_encode(expected_sig)

    if not hmac.compare_digest(sig_b64, expected_sig_b64):
        return None  # Firma inválida

    try:
        payload_bytes = _base64url_decode(payload_b64)
        payload = json.loads(payload_bytes.decode('utf-8'))
    except Exception:
        return None

    # Verificar tiempo de expiración
    now = int(time.time())
    if payload.get("exp", 0) < now:
        return None  # Token expirado

    return payload


def get_token_from_request():
    """Extrae el token Bearer del header Authorization o de un query param."""
    auth_header = request.headers.get('Authorization')
    if auth_header:
        parts = auth_header.split()
        if len(parts) == 2 and parts[0].lower() == 'bearer':
            return parts[1]
    # Alternativa por query parameter (útil para descargas directas de archivos)
    return request.args.get('token')


# --- Control de Intentos Fallidos de Login (Protección Anti-Fuerza Bruta) ---
_login_attempts = {}  # { identifier: [timestamp1, timestamp2, ...] }
MAX_FAILED_ATTEMPTS = 5
LOCKOUT_SECONDS = 600  # 10 minutos de bloqueo temporal

def is_login_rate_limited(identifier: str) -> tuple:
    """Verifica si un usuario o IP ha excedido el límite de intentos fallidos."""
    now = time.time()
    key = str(identifier).strip().lower()
    attempts = _login_attempts.get(key, [])
    # Filtrar solo intentos dentro de la ventana de tiempo
    attempts = [t for t in attempts if now - t < LOCKOUT_SECONDS]
    _login_attempts[key] = attempts

    if len(attempts) >= MAX_FAILED_ATTEMPTS:
        remaining_wait = int(LOCKOUT_SECONDS - (now - attempts[0]))
        return True, max(1, remaining_wait)
    return False, 0

def record_failed_login(identifier: str):
    """Registra un intento fallido de inicio de sesión."""
    now = time.time()
    key = str(identifier).strip().lower()
    if key not in _login_attempts:
        _login_attempts[key] = []
    _login_attempts[key].append(now)

def clear_failed_logins(identifier: str):
    """Limpia los intentos fallidos tras un login exitoso."""
    key = str(identifier).strip().lower()
    if key in _login_attempts:
        del _login_attempts[key]


def token_required(f):
    """
    Decorador que exige un token JWT válido y verifica EN TIEMPO REAL
    que la cuenta no haya sido bloqueada o suspendida en la base de datos.
    """
    @wraps(f)
    def decorated(*args, **kwargs):
        token = get_token_from_request()
        if not token:
            return jsonify({"status": "error", "message": "Autenticación requerida. Token no proporcionado."}), 401

        payload = decode_jwt(token)
        if not payload:
            return jsonify({"status": "error", "message": "Sesión inválida o expirada. Inicie sesión nuevamente."}), 401

        # Verificación de Seguridad en Base de Datos en Tiempo Real
        from src.database import get_user_by_id
        user = get_user_by_id(payload.get('user_id'))
        if not user:
            return jsonify({"status": "error", "message": "Usuario no encontrado en el sistema."}), 401

        if user.get('status') == 'blocked':
            return jsonify({
                "status": "error",
                "message": "Tu cuenta ha sido suspendida. Comunícate con la administración de WTN Solutions LLC.",
                "code": "ACCOUNT_BLOCKED"
            }), 403

        if user.get('status') != 'active':
            return jsonify({
                "status": "error",
                "message": "Tu cuenta está inactiva o en revisión.",
                "code": "ACCOUNT_INACTIVE"
            }), 403

        request.current_user = {**payload, **user}
        return f(*args, **kwargs)
    return decorated


def admin_required(f):
    """
    Decorador que exige que el usuario sea Super Administrador activo de WTN Solutions LLC.
    """
    @wraps(f)
    def decorated(*args, **kwargs):
        token = get_token_from_request()
        if not token:
            return jsonify({"status": "error", "message": "Autenticación requerida."}), 401

        payload = decode_jwt(token)
        if not payload:
            return jsonify({"status": "error", "message": "Sesión inválida o expirada."}), 401

        from src.database import get_user_by_id
        user = get_user_by_id(payload.get('user_id'))
        if not user or user.get('role') != 'admin' or user.get('status') != 'active':
            return jsonify({
                "status": "error",
                "message": "Acceso denegado. Se requieren permisos de Super Administrador de WTN Solutions LLC."
            }), 403

        request.current_user = {**payload, **user}
        return f(*args, **kwargs)
    return decorated
