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


def token_required(f):
    """
    Decorador que exige un token JWT válido. Inyecta `current_user` en la función.
    """
    @wraps(f)
    def decorated(*args, **kwargs):
        token = get_token_from_request()
        if not token:
            return jsonify({"status": "error", "message": "Autenticación requerida. Token no proporcionado."}), 401

        payload = decode_jwt(token)
        if not payload:
            return jsonify({"status": "error", "message": "Sesión inválida o expirada. Inicie sesión nuevamente."}), 401

        request.current_user = payload
        return f(*args, **kwargs)
    return decorated


def admin_required(f):
    """
    Decorador que exige que el usuario sea Super Administrador ('admin').
    """
    @wraps(f)
    def decorated(*args, **kwargs):
        token = get_token_from_request()
        if not token:
            return jsonify({"status": "error", "message": "Autenticación requerida."}), 401

        payload = decode_jwt(token)
        if not payload:
            return jsonify({"status": "error", "message": "Sesión inválida o expirada."}), 401

        if payload.get('role') != 'admin':
            return jsonify({
                "status": "error",
                "message": "Acceso denegado. Se requieren permisos de Administrador."
            }), 403

        request.current_user = payload
        return f(*args, **kwargs)
    return decorated
