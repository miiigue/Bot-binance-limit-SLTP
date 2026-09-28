#!/usr/bin/env python
# -*- coding: utf-8 -*-
"""
Script de Configuración, Migración e Inicialización de PostgreSQL.
Crea la base de datos, extensiones y tablas relacionales con índices optimizados
para trading multi-inquilino de alta velocidad y concurrencia.
"""

import os
import sys
import sqlite3
from urllib.parse import urlparse
from dotenv import load_dotenv

load_dotenv()

# Intentar importar psycopg2
try:
    import psycopg2
    from psycopg2.extensions import ISOLATION_LEVEL_AUTOCOMMIT
except ImportError:
    print("❌ Error: psycopg2-binary no está instalado. Ejecuta: pip install psycopg2-binary")
    sys.exit(1)

DEFAULT_PG_URL = os.environ.get('DATABASE_URL', 'postgresql://postgres:postgres@localhost:5432/bot_database')

POSTGRES_SCHEMA_SQL = """
-- Tabla de Usuarios
CREATE TABLE IF NOT EXISTS users (
    id SERIAL PRIMARY KEY,
    username VARCHAR(64) UNIQUE NOT NULL,
    email VARCHAR(128) UNIQUE,
    password_hash VARCHAR(256) NOT NULL,
    role VARCHAR(32) NOT NULL DEFAULT 'investor',
    status VARCHAR(32) NOT NULL DEFAULT 'active',
    created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
    last_login TIMESTAMP,
    requested_capital DOUBLE PRECISION DEFAULT 0.0
);

-- Tabla de Claves API de Binance Cifradas (AES-256)
CREATE TABLE IF NOT EXISTS user_api_keys (
    id SERIAL PRIMARY KEY,
    user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    exchange VARCHAR(32) DEFAULT 'binance',
    api_key_encrypted TEXT NOT NULL,
    api_secret_encrypted TEXT NOT NULL,
    api_key_masked VARCHAR(64),
    is_testnet BOOLEAN DEFAULT FALSE,
    is_valid BOOLEAN DEFAULT FALSE,
    last_verified_at TIMESTAMP,
    balance_detected DOUBLE PRECISION DEFAULT 0.0,
    created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    UNIQUE(user_id, exchange, is_testnet)
);

-- Tabla de Configuración de Bot por Usuario
CREATE TABLE IF NOT EXISTS user_bot_settings (
    id SERIAL PRIMARY KEY,
    user_id INTEGER NOT NULL UNIQUE REFERENCES users(id) ON DELETE CASCADE,
    is_running BOOLEAN DEFAULT FALSE,
    allocated_usdt DOUBLE PRECISION DEFAULT 100.0,
    leverage INTEGER DEFAULT 10,
    margin_type VARCHAR(16) DEFAULT 'ISOLATED',
    symbols_to_trade TEXT DEFAULT 'BTCUSDT,ETHUSDT,SOLUSDT',
    strategy_name VARCHAR(64) DEFAULT 'WTN Scalper Pro',
    max_open_positions INTEGER DEFAULT 3,
    last_started_at TIMESTAMP,
    last_stopped_at TIMESTAMP,
    error_message TEXT,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- Tabla de Operaciones de Usuarios (Multi-tenant Trades)
CREATE TABLE IF NOT EXISTS user_trades (
    id SERIAL PRIMARY KEY,
    user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    symbol VARCHAR(32) NOT NULL,
    trade_type VARCHAR(16) NOT NULL,
    open_timestamp TIMESTAMP NOT NULL,
    close_timestamp TIMESTAMP,
    open_price DOUBLE PRECISION NOT NULL,
    close_price DOUBLE PRECISION,
    quantity DOUBLE PRECISION NOT NULL,
    position_size_usdt DOUBLE PRECISION,
    pnl_usdt DOUBLE PRECISION,
    gross_pnl_usdt DOUBLE PRECISION DEFAULT 0.0,
    commission_usdt DOUBLE PRECISION DEFAULT 0.0,
    close_reason TEXT,
    binance_trade_id VARCHAR(64),
    strategy_name VARCHAR(64),
    is_testnet BOOLEAN DEFAULT FALSE
);

-- Tabla de Operaciones del Pool Central
CREATE TABLE IF NOT EXISTS trades (
    id SERIAL PRIMARY KEY,
    symbol VARCHAR(32) NOT NULL,
    trade_type VARCHAR(16) NOT NULL,
    open_timestamp TIMESTAMP NOT NULL,
    close_timestamp TIMESTAMP,
    open_price DOUBLE PRECISION NOT NULL,
    close_price DOUBLE PRECISION,
    quantity DOUBLE PRECISION NOT NULL,
    position_size_usdt DOUBLE PRECISION,
    pnl_usdt DOUBLE PRECISION,
    gross_pnl_usdt DOUBLE PRECISION DEFAULT 0.0,
    commission_usdt DOUBLE PRECISION DEFAULT 0.0,
    close_reason TEXT,
    parameters TEXT,
    binance_trade_id VARCHAR(64) UNIQUE,
    strategy_name VARCHAR(64)
);

-- Tabla de Transacciones de Inversionistas
CREATE TABLE IF NOT EXISTS investor_transactions (
    id SERIAL PRIMARY KEY,
    user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    amount_usdt DOUBLE PRECISION NOT NULL,
    transaction_type VARCHAR(32) NOT NULL,
    notes TEXT,
    created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP
);

-- Tabla de Ajustes Globales del Bot
CREATE TABLE IF NOT EXISTS bot_settings (
    key VARCHAR(64) PRIMARY KEY,
    value TEXT
);

-- Índices de Alto Rendimiento para Búsquedas Frecuentes
CREATE INDEX IF NOT EXISTS idx_user_trades_user_id ON user_trades(user_id);
CREATE INDEX IF NOT EXISTS idx_user_trades_symbol ON user_trades(symbol);
CREATE INDEX IF NOT EXISTS idx_user_trades_close_ts ON user_trades(close_timestamp);
CREATE INDEX IF NOT EXISTS idx_trades_symbol ON trades(symbol);
CREATE INDEX IF NOT EXISTS idx_trades_close_ts ON trades(close_timestamp);
CREATE INDEX IF NOT EXISTS idx_user_api_keys_user ON user_api_keys(user_id, is_valid);
CREATE INDEX IF NOT EXISTS idx_user_bot_settings_running ON user_bot_settings(is_running);
"""


def ensure_postgres_database(pg_url: str):
    """Verifica si la base de datos existe en PostgreSQL; si no, la crea conectando a la BD 'postgres'."""
    parsed = urlparse(pg_url)
    db_name = parsed.path.lstrip('/') or 'bot_database'

    # Conectar a la base de datos administrativa 'postgres' para crear la BD si hace falta
    admin_url = pg_url.replace(f"/{db_name}", "/postgres")
    try:
        conn = psycopg2.connect(admin_url)
        conn.set_isolation_level(ISOLATION_LEVEL_AUTOCOMMIT)
        cur = conn.cursor()

        cur.execute("SELECT 1 FROM pg_database WHERE datname = %s", (db_name,))
        exists = cur.fetchone()
        if not exists:
            print(f"📦 Creando base de datos PostgreSQL '{db_name}'...")
            cur.execute(f'CREATE DATABASE "{db_name}"')
            print(f"✅ Base de datos '{db_name}' creada con éxito.")
        else:
            print(f"ℹ️ La base de datos '{db_name}' ya existe.")
        cur.close()
        conn.close()
    except Exception as e:
        print(f"⚠️ Aviso al verificar base de datos administrativa: {e}. Intentando conectar directamente a '{db_name}'...")


def init_postgres_schema(pg_url: str):
    """Ejecuta el esquema DDL en PostgreSQL."""
    try:
        conn = psycopg2.connect(pg_url)
        cur = conn.cursor()
        print("🚀 Aplicando esquema DDL en PostgreSQL...")
        cur.execute(POSTGRES_SCHEMA_SQL)
        conn.commit()
        print("✅ Esquema de tablas e índices aplicado con éxito en PostgreSQL.")
        cur.close()
        conn.close()
        return True
    except Exception as e:
        print(f"❌ Error al aplicar esquema en PostgreSQL: {e}")
        return False


def migrate_from_sqlite(sqlite_path: str, pg_url: str):
    """Copia los datos existentes de SQLite a PostgreSQL para no perder usuarios ni trades."""
    if not os.path.exists(sqlite_path):
        print(f"ℹ️ No se encontró archivo SQLite en '{sqlite_path}', omitiendo migración de datos.")
        return

    print(f"🔄 Migrando datos desde SQLite ({sqlite_path}) a PostgreSQL...")
    try:
        s_conn = sqlite3.connect(sqlite_path)
        s_conn.row_factory = sqlite3.Row
        s_cur = s_conn.cursor()

        pg_conn = psycopg2.connect(pg_url)
        pg_cur = pg_conn.cursor()

        # 1. Migrar Usuarios
        try:
            s_cur.execute("SELECT * FROM users")
            users = s_cur.fetchall()
            for u in users:
                pg_cur.execute("""
                    INSERT INTO users (id, username, email, password_hash, role, status, created_at, last_login, requested_capital)
                    VALUES (%s, %s, %s, %s, %s, %s, %s, %s, %s)
                    ON CONFLICT (id) DO UPDATE SET 
                        username = EXCLUDED.username,
                        email = EXCLUDED.email,
                        status = EXCLUDED.status,
                        last_login = EXCLUDED.last_login
                """, (
                    u['id'], u['username'], u['email'], u['password_hash'],
                    u['role'], u['status'], u['created_at'], u['last_login'],
                    u['requested_capital'] if 'requested_capital' in u.keys() else 0.0
                ))
            print(f"  ✓ {len(users)} usuarios migrados.")
            # Ajustar la secuencia de IDs de usuarios
            pg_cur.execute("SELECT setval('users_id_seq', (SELECT COALESCE(MAX(id), 1) FROM users));")
        except Exception as e:
            print(f"  ⚠️ Error migrando usuarios: {e}")

        # 2. Migrar Trades del Pool
        try:
            s_cur.execute("SELECT * FROM trades")
            trades = s_cur.fetchall()
            for t in trades:
                t_dict = dict(t)
                pg_cur.execute("""
                    INSERT INTO trades (
                        id, symbol, trade_type, open_timestamp, close_timestamp,
                        open_price, close_price, quantity, position_size_usdt,
                        pnl_usdt, gross_pnl_usdt, commission_usdt, close_reason,
                        parameters, binance_trade_id, strategy_name
                    ) VALUES (%s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s)
                    ON CONFLICT (id) DO NOTHING
                """, (
                    t_dict.get('id'), t_dict.get('symbol'), t_dict.get('trade_type'),
                    t_dict.get('open_timestamp'), t_dict.get('close_timestamp'),
                    t_dict.get('open_price'), t_dict.get('close_price'),
                    t_dict.get('quantity'), t_dict.get('position_size_usdt'),
                    t_dict.get('pnl_usdt'), t_dict.get('gross_pnl_usdt', 0.0),
                    t_dict.get('commission_usdt', 0.0), t_dict.get('close_reason'),
                    t_dict.get('parameters'), str(t_dict.get('binance_trade_id')) if t_dict.get('binance_trade_id') else None,
                    t_dict.get('strategy_name')
                ))
            print(f"  ✓ {len(trades)} trades migrados.")
            pg_cur.execute("SELECT setval('trades_id_seq', (SELECT COALESCE(MAX(id), 1) FROM trades));")
        except Exception as e:
            print(f"  ⚠️ Error migrando trades: {e}")

        pg_conn.commit()
        s_conn.close()
        pg_cur.close()
        pg_conn.close()
        print("🎉 ¡Migración de datos completada exitosamente!")
    except Exception as e:
        print(f"❌ Error durante la migración desde SQLite: {e}")


if __name__ == '__main__':
    pg_url = os.environ.get('DATABASE_URL', DEFAULT_PG_URL)
    print(f"🔧 Iniciando configuración de PostgreSQL: {pg_url.split('@')[-1] if '@' in pg_url else pg_url}")
    ensure_postgres_database(pg_url)
    if init_postgres_schema(pg_url):
        base_dir = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
        sqlite_file = os.path.join(base_dir, 'trades_limit.db')
        migrate_from_sqlite(sqlite_file, pg_url)
        print("\n✨ Base de datos PostgreSQL lista y operativa para WTN Multi-Tenant SaaS.")
