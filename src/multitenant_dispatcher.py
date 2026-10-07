#!/usr/bin/env python
# -*- coding: utf-8 -*-
"""
Motor Despachador Multi-Inquilino (Multi-Tenant Dispatcher).
Orquesta la ejecución asíncrona y segura de órdenes para todos los usuarios activos
que tienen su bot encendido (tanto en modo Copy-Trading como Bot Personal),
respetando sus claves API de Binance individuales, su capital asignado,
apalancamiento y margen sin colisiones ni errores de precisión.
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
from src.binance_client import get_user_futures_client, adjust_quantity_for_symbol


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

    client = get_user_futures_client(
        api_key=api_key, 
        api_secret=api_secret, 
        is_testnet=is_testnet, 
        base_url=user_info.get('api_base_url')
    )
    _user_clients_cache[user_id] = {
        'client': client,
        'timestamp': now
    }
    return client


def dispatch_entry_order_to_users(symbol: str, signal_side: str, entry_price: float, reason: str = 'RSI Oversold Signal', strategy_name: str = '') -> dict:
    """
    Despacha la orden de entrada a todos los usuarios que tengan el bot encendido (is_running = True).
    Soporta usuarios tanto en modo COPY_TRADING como PERSONAL_BOT.
    """
    logger = get_logger()
    # Obtener TODOS los usuarios con bot activo (sin filtrar exclusivamente por COPY_TRADING)
    active_users = get_all_active_bot_users(operating_mode=None)
    if not active_users:
        return {"dispatched": 0, "success": 0, "errors": 0}

    results = {"dispatched": len(active_users), "success": 0, "errors": 0}
    clean_sym = symbol.upper().strip()

    for user in active_users:
        user_id = user['user_id']
        username = user['username']
        op_mode = str(user.get('operating_mode', 'COPY_TRADING')).upper().strip()
        user_strategy = str(user.get('strategy_name', '')).strip()

        # 1. Filtrado por lista de símbolos configurados por el usuario
        user_symbols = [s.strip().upper() for s in str(user.get('symbols_to_trade', '')).split(',') if s.strip()]
        if user_symbols and clean_sym not in user_symbols:
            continue

        # 2. En modo PERSONAL_BOT, verificar compatibilidad de estrategia si el usuario seleccionó una específica
        if op_mode in ['PERSONAL_BOT', 'MY_BOT'] and user_strategy and strategy_name:
            # Si el usuario eligió una estrategia distinta a la que genera la señal (y no es la plantilla genérica), omitir
            if user_strategy.lower() != strategy_name.lower() and user_strategy != 'WTN Scalper Pro':
                continue

        try:
            client = get_cached_user_client(user)
            if not client:
                continue

            # 3. Verificar si el usuario ya tiene posición abierta en este símbolo
            positions = client.get_position_risk(symbol=clean_sym)
            has_position = False
            if positions and isinstance(positions, list):
                for p in positions:
                    amt = float(p.get('positionAmt', 0.0) or 0.0)
                    if abs(amt) > 1e-6:
                        has_position = True
                        break

            if has_position:
                continue  # Ya está en posición, evitar sobre-operar

            # 4. Obtener balance real en tiempo real si está disponible
            balance_detected = float(user.get('balance_detected', 0.0) or 0.0)
            try:
                balances = client.balance()
                if isinstance(balances, list):
                    for b in balances:
                        if str(b.get('asset', '')).upper() == 'USDT':
                            balance_detected = float(b.get('balance', 0.0) or b.get('availableBalance', 0.0) or 0.0)
                            break
            except Exception:
                pass

            allocated_usdt = float(user.get('allocated_usdt', 100.0) or 100.0)
            
            # Protección de gestión de riesgo sobre balance real
            if balance_detected > 10.0 and allocated_usdt > balance_detected:
                allocated_usdt = round(balance_detected * 0.90, 2)
            elif balance_detected <= 10.0 and allocated_usdt > 10.0:
                allocated_usdt = 10.0

            leverage = int(user.get('leverage', 10) or 10)
            margin_type = str(user.get('margin_type', 'ISOLATED')).upper().strip()

            # Ajustar tipo de margen y apalancamiento en la cuenta del usuario
            try:
                client.change_margin_type(symbol=clean_sym, marginType=margin_type)
            except Exception:
                pass

            try:
                client.change_leverage(symbol=clean_sym, leverage=leverage)
            except Exception:
                pass

            notional = allocated_usdt * leverage
            if entry_price <= 0:
                continue

            raw_qty = notional / entry_price
            qty = adjust_quantity_for_symbol(clean_sym, raw_qty)

            if not qty or qty <= 0:
                continue

            # 5. Detectar si la cuenta del usuario usa Hedge Mode (Dual Side) o One-Way
            is_hedge = False
            try:
                pos_mode_info = client.get_position_mode()
                if isinstance(pos_mode_info, dict):
                    is_hedge = bool(pos_mode_info.get('dualSidePosition', False))
            except Exception:
                is_hedge = False

            side = 'BUY' if signal_side.upper() == 'LONG' else 'SELL'
            pos_side = ('LONG' if side == 'BUY' else 'SHORT') if is_hedge else 'BOTH'

            order_params = {
                'symbol': clean_sym,
                'side': side,
                'type': 'MARKET',
                'quantity': qty,
                'positionSide': pos_side
            }

            order_res = client.new_order(**order_params)

            if order_res and isinstance(order_res, dict) and order_res.get('orderId'):
                order_id = str(order_res.get('orderId', ''))
                executed_price = float(order_res.get('avgPrice', entry_price) or entry_price)

                reason_label = f"{reason} ({'Bot Personal' if op_mode in ['PERSONAL_BOT', 'MY_BOT'] else 'Copy-Trading'})"

                # 6. Registrar la operación personal en user_trades
                record_user_trade(
                    user_id=user_id,
                    symbol=clean_sym,
                    trade_type=signal_side.upper(),
                    open_timestamp=datetime.now(),
                    open_price=executed_price if executed_price > 0 else entry_price,
                    quantity=qty,
                    position_size_usdt=round(qty * (executed_price if executed_price > 0 else entry_price), 2),
                    close_reason=reason_label,
                    binance_trade_id=order_id,
                    strategy_name=strategy_name or user_strategy or 'WTN Scalper Pro',
                    is_testnet=bool(user.get('is_testnet', False))
                )

                results["success"] += 1
                logger.info(f"✅ [User: {username} (ID: {user_id}, Modo: {op_mode})] Orden de entrada {signal_side} ejecutada en Binance ({clean_sym}, Qty={qty}, Notional=${notional:,.2f})")

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
    Cierra las posiciones de los usuarios activos (is_running = True) para un símbolo cuando se alcanza
    un Take Profit, Stop Loss o señal de salida algorítmica.
    """
    logger = get_logger()
    active_users = get_all_active_bot_users(operating_mode=None)
    if not active_users:
        return {"dispatched": 0, "closed": 0}

    results = {"dispatched": len(active_users), "closed": 0}
    clean_sym = symbol.upper().strip()

    for user in active_users:
        user_id = user['user_id']
        username = user['username']
        op_mode = str(user.get('operating_mode', 'COPY_TRADING')).upper().strip()

        try:
            client = get_cached_user_client(user)
            if not client:
                continue

            positions = client.get_position_risk(symbol=clean_sym)
            if not positions or not isinstance(positions, list):
                continue

            for p in positions:
                amt = float(p.get('positionAmt', 0.0) or 0.0)
                if abs(amt) < 1e-6:
                    continue

                # Hay posición abierta: ejecutar orden contraria para cerrar
                side = 'SELL' if amt > 0 else 'BUY'
                raw_qty = abs(amt)
                qty = adjust_quantity_for_symbol(clean_sym, raw_qty) or raw_qty

                is_hedge = False
                try:
                    pos_mode_info = client.get_position_mode()
                    if isinstance(pos_mode_info, dict):
                        is_hedge = bool(pos_mode_info.get('dualSidePosition', False))
                except Exception:
                    is_hedge = False

                pos_side = ('LONG' if amt > 0 else 'SHORT') if is_hedge else 'BOTH'

                order_params = {
                    'symbol': clean_sym,
                    'side': side,
                    'type': 'MARKET',
                    'quantity': qty,
                    'positionSide': pos_side
                }
                if not is_hedge:
                    order_params['reduceOnly'] = True

                order_res = client.new_order(**order_params)

                unrealized_pnl = float(p.get('unRealizedProfit', 0.0) or 0.0)
                order_id = str(order_res.get('orderId', '')) if isinstance(order_res, dict) else ''

                reason_label = f"{exit_reason} ({'Bot Personal' if op_mode in ['PERSONAL_BOT', 'MY_BOT'] else 'Copy-Trading'})"

                # Actualizar o registrar la salida en user_trades
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
                    close_reason=reason_label,
                    binance_trade_id=order_id,
                    strategy_name=user.get('strategy_name', 'WTN Scalper Pro'),
                    is_testnet=bool(user.get('is_testnet', False))
                )

                results["closed"] += 1
                logger.info(f"🛑 [User: {username} (ID: {user_id}, Modo: {op_mode})] Posición cerrada en {clean_sym} ({side} {qty}, PnL estimado: ${unrealized_pnl:,.2f} USDT). Razón: {exit_reason}")

        except Exception as e:
            logger.warning(f"Aviso al cerrar posición para usuario {username}: {e}")

    return results
