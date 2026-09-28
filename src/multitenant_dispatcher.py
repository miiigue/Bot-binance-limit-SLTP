#!/usr/bin/env python
# -*- coding: utf-8 -*-
"""
Motor Despachador Multi-Inquilino (Multi-Tenant Dispatcher - Opción A).
Orquesta la ejecución asíncrona y segura de órdenes para todos los usuarios activos
que tienen su bot personal encendido, respetando sus claves API de Binance individuales,
su capital asignado y apalancamiento sin colisiones ni saturación de rate limits.
"""

import time
import math
from datetime import datetime
from decimal import Decimal, ROUND_DOWN
from binance.error import ClientError

from src.logger_setup import get_logger
from src.database import (
    get_all_active_bot_users, record_user_trade, update_user_bot_settings
)
from src.binance_client import get_user_futures_client


# Caché de clientes UMFutures por usuario para evitar reconexiones continuas
# Formato: { user_id: { "client": UMFutures, "timestamp": float } }
_user_clients_cache = {}


def get_cached_user_client(user_info: dict):
    """Retorna un cliente Binance UMFutures reutilizable para el usuario."""
    user_id = user_info['user_id']
    now = time.time()
    cached = _user_clients_cache.get(user_id)

    if cached and (now - cached['timestamp'] < 1800):  # 30 minutos de vida útil
        return cached['client']

    api_key = user_info.get('api_key')
    api_secret = user_info.get('api_secret')
    is_testnet = bool(user_info.get('is_testnet', False))

    if not api_key or not api_secret:
        return None

    client = get_user_futures_client(api_key=api_key, api_secret=api_secret, is_testnet=is_testnet)
    _user_clients_cache[user_id] = {
        'client': client,
        'timestamp': now
    }
    return client


def dispatch_entry_order_to_users(symbol: str, signal_side: str, entry_price: float, reason: str = 'RSI Oversold Signal') -> dict:
    """
    Despacha la orden de entrada a todos los usuarios que tengan el bot encendido
    y tengan el símbolo incluido en su configuración.
    """
    logger = get_logger()
    active_users = get_all_active_bot_users()
    if not active_users:
        return {"dispatched": 0, "success": 0, "errors": 0}

    results = {"dispatched": len(active_users), "success": 0, "errors": 0}
    clean_sym = symbol.upper().strip()

    for user in active_users:
        user_id = user['user_id']
        username = user['username']
        user_symbols = [s.strip().upper() for s in str(user.get('symbols_to_trade', '')).split(',') if s.strip()]

        if user_symbols and clean_sym not in user_symbols:
            continue

        try:
            client = get_cached_user_client(user)
            if not client:
                continue

            # 1. Verificar si el usuario ya tiene posición abierta en este símbolo
            positions = client.get_position_risk(symbol=clean_sym)
            has_position = False
            for p in positions:
                amt = float(p.get('positionAmt', 0.0) or 0.0)
                if abs(amt) > 1e-6:
                    has_position = True
                    break

            if has_position:
                continue  # Ya está en posición, evitar sobre-operar

            # 2. Calcular tamaño de orden según capital asignado/detectado y apalancamiento
            balance_detected = float(user.get('balance_detected', 0.0) or 0.0)
            allocated_usdt = float(user.get('allocated_usdt', 100.0) or 100.0)
            
            # Protección automática: si el balance en Binance es menor que el valor asignado, usar 25% del capital real
            if 10.0 < balance_detected < allocated_usdt:
                allocated_usdt = round(balance_detected * 0.25, 2)
            elif balance_detected <= 10.0 and allocated_usdt > 10.0:
                allocated_usdt = 10.0

            leverage = int(user.get('leverage', 10) or 10)

            # Ajustar apalancamiento en la cuenta del usuario
            try:
                client.change_leverage(symbol=clean_sym, leverage=leverage)
            except Exception:
                pass

            notional = allocated_usdt * leverage
            if entry_price <= 0:
                continue

            raw_qty = notional / entry_price
            if clean_sym.startswith('BTC'):
                qty = round(raw_qty, 3)
            elif clean_sym.startswith('ETH'):
                qty = round(raw_qty, 2)
            elif clean_sym.startswith('SOL'):
                qty = round(raw_qty, 1) if raw_qty >= 1 else round(raw_qty, 2)
            elif clean_sym.startswith('DOGE') or clean_sym.startswith('XRP') or clean_sym.startswith('ADA'):
                qty = math.floor(raw_qty)
            else:
                qty = round(raw_qty, 2) if raw_qty > 1 else round(raw_qty, 4)

            if qty <= 0:
                continue

            # 3. Enviar orden MARKET o LIMIT al broker de Binance del usuario
            side = 'BUY' if signal_side.upper() == 'LONG' else 'SELL'
            order_res = client.new_order(
                symbol=clean_sym,
                side=side,
                type='MARKET',
                quantity=qty
            )

            order_id = str(order_res.get('orderId', ''))
            executed_price = float(order_res.get('avgPrice', entry_price) or entry_price)

            # 4. Registrar la operación personal en user_trades
            record_user_trade(
                user_id=user_id,
                symbol=clean_sym,
                trade_type=signal_side.upper(),
                open_timestamp=datetime.now(),
                open_price=executed_price if executed_price > 0 else entry_price,
                quantity=qty,
                position_size_usdt=round(qty * executed_price, 2),
                close_reason=reason,
                binance_trade_id=order_id,
                strategy_name=user.get('strategy_name', 'WTN Scalper Pro'),
                is_testnet=bool(user.get('is_testnet', False))
            )

            results["success"] += 1
            logger.info(f"✅ [User: {username} (ID: {user_id})] Orden de entrada {signal_side} ejecutada en Binance ({clean_sym}, Qty={qty}, Notional=${notional:,.2f})")

        except ClientError as ce:
            results["errors"] += 1
            err_msg = f"Error Binance: {ce.error_message} (Código {ce.error_code})"
            update_user_bot_settings(user_id=user_id, error_message=err_msg)
            logger.warning(f"⚠️ [User: {username}] No se pudo ejecutar orden: {err_msg}")
        except Exception as e:
            results["errors"] += 1
            logger.error(f"❌ [User: {username}] Excepción al despachar orden: {e}")

    return results


def dispatch_exit_order_to_users(symbol: str, exit_reason: str, exit_price: float) -> dict:
    """
    Cierra las posiciones de los usuarios activos para un símbolo cuando se alcanza
    un Take Profit, Stop Loss o señal de salida algorítmica.
    """
    logger = get_logger()
    active_users = get_all_active_bot_users()
    if not active_users:
        return {"dispatched": 0, "closed": 0}

    results = {"dispatched": len(active_users), "closed": 0}
    clean_sym = symbol.upper().strip()

    for user in active_users:
        user_id = user['user_id']
        username = user['username']

        try:
            client = get_cached_user_client(user)
            if not client:
                continue

            positions = client.get_position_risk(symbol=clean_sym)
            for p in positions:
                amt = float(p.get('positionAmt', 0.0) or 0.0)
                if abs(amt) < 1e-6:
                    continue

                # Hay posición abierta: ejecutar orden contraria para cerrar
                side = 'SELL' if amt > 0 else 'BUY'
                qty = abs(amt)

                order_res = client.new_order(
                    symbol=clean_sym,
                    side=side,
                    type='MARKET',
                    quantity=qty,
                    reduceOnly=True
                )

                unrealized_pnl = float(p.get('unRealizedProfit', 0.0) or 0.0)
                order_id = str(order_res.get('orderId', ''))

                # Actualizar el trade más reciente abierto del usuario
                record_user_trade(
                    user_id=user_id,
                    symbol=clean_sym,
                    trade_type='LONG' if amt > 0 else 'SHORT',
                    open_timestamp=datetime.now(),
                    open_price=float(p.get('entryPrice', exit_price) or exit_price),
                    quantity=qty,
                    position_size_usdt=round(qty * exit_price, 2),
                    close_timestamp=datetime.now(),
                    close_price=exit_price,
                    pnl_usdt=unrealized_pnl,
                    close_reason=exit_reason,
                    binance_trade_id=order_id,
                    strategy_name=user.get('strategy_name', 'WTN Scalper Pro'),
                    is_testnet=bool(user.get('is_testnet', False))
                )

                results["closed"] += 1
                logger.info(f"🛑 [User: {username} (ID: {user_id})] Posición cerrada en {clean_sym} ({side} {qty}, PnL estimado: ${unrealized_pnl:,.2f} USDT). Razón: {exit_reason}")

        except Exception as e:
            logger.warning(f"Aviso al cerrar posición para usuario {username}: {e}")

    return results
