#!/usr/bin/env python
# -*- coding: utf-8 -*-
"""
Módulo de Cifrado y Bóveda Criptográfica (Crypto Vault).
Provee cifrado y descifrado de grado militar autenticado (AES-256-GCM)
para el almacenamiento ultraseguro de Claves API de Binance y credenciales sensibles.
"""

import os
import base64
import hashlib
from Crypto.Cipher import AES
from Crypto.Random import get_random_bytes

# Clave maestra de cifrado obtenida del entorno (.env)
_RAW_MASTER_KEY = os.environ.get('ENCRYPTION_MASTER_KEY') or os.environ.get('JWT_SECRET_KEY', 'wtn_algo_master_encryption_vault_key_2026_98z')

# Derivación a 256 bits (32 bytes) usando SHA-256
_DERIVED_KEY = hashlib.sha256(_RAW_MASTER_KEY.encode('utf-8')).digest()


def encrypt_secret(plain_text: str) -> str:
    """
    Cifra una cadena de texto en claro usando AES-256 en modo GCM (autenticado).
    Retorna un string codificado en Base64 que contiene: nonce (12 bytes) + tag (16 bytes) + ciphertext.
    """
    if not plain_text or not isinstance(plain_text, str):
        return ""

    data_bytes = plain_text.strip().encode('utf-8')
    nonce = get_random_bytes(12)  # 96-bit nonce estándar para GCM
    cipher = AES.new(_DERIVED_KEY, AES.MODE_GCM, nonce=nonce)
    ciphertext, tag = cipher.encrypt_and_digest(data_bytes)

    # Estructura del paquete binario: [12 bytes nonce] + [16 bytes tag] + [ciphertext variable]
    packed = nonce + tag + ciphertext
    return base64.b64encode(packed).decode('utf-8')


def decrypt_secret(encrypted_b64: str) -> str:
    """
    Descifra un string Base64 generado por encrypt_secret verificando la integridad del tag GCM.
    Retorna el texto en claro original, o "" si el paquete fue alterado o no es válido.
    """
    if not encrypted_b64 or not isinstance(encrypted_b64, str):
        return ""

    try:
        raw_bytes = base64.b64decode(encrypted_b64.encode('utf-8'))
        if len(raw_bytes) < (12 + 16):
            return ""

        nonce = raw_bytes[:12]
        tag = raw_bytes[12:28]
        ciphertext = raw_bytes[28:]

        cipher = AES.new(_DERIVED_KEY, AES.MODE_GCM, nonce=nonce)
        decrypted_bytes = cipher.decrypt_and_verify(ciphertext, tag)
        return decrypted_bytes.decode('utf-8')
    except (ValueError, KeyError, Exception):
        # Fallo de autenticación o manipulación de datos
        return ""


def mask_api_key(key: str) -> str:
    """
    Enmascara una clave API para mostrarla con seguridad en la interfaz gráfica (ej: 4xF9...k8L0).
    """
    if not key or not isinstance(key, str):
        return ""
    clean = key.strip()
    if len(clean) <= 10:
        return "****"
    return f"{clean[:5]}...{clean[-4:]}"
