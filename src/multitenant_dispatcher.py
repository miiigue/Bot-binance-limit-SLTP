#!/usr/bin/env python
# -*- coding: utf-8 -*-
"""
Motor Despachador y Ejecutor Autónomo Multi-Inquilino (Multi-Tenant Engine).
Proporciona:
1. Motor Autónomo 24/7 (PersonalBotEngine) que evalúa y opera de forma independiente
   el Bot Personal de cada usuario con su estrategia seleccionada, capital y apalancamiento,
   sin depender de si el bot master tiene margen o posiciones abiertas.
2. Despachador en vivo (dispatch_entry_order_to_users / dispatch_exit_order_to_users)
   para sincronización en tiempo real de señales tanto en Copy-Trading como Bot Personal.
"""

import os
import json
import time
import math
import threading
from datetime import datetime
from decimal import Decimal, ROUND_DOWN
import pandas as pd
from binance.error import ClientError

from src.logger_setup import get_logger
from src.database import (
    get_all_active_bot_users, record_user_trade, update_user_bot_settings,
    get_strategies_catalog
)
from src.binance_client import (
    get_user_futures_client, adjust_quantity_for_symbol, get_historical_klines
)
from src.rsi_calculator import calculate_rsi


# --- ESTRUCTURAS DE CACHÉ EN MEMORIA ---
_user_clients_cache = {}      # { user_id: { "client": UMFutures, "timestamp": float } }
_klines_cache = {}            # { (symbol, interval): { "data": DataFrame, "timestamp": float } }
_user_peak_pnl = {}           # { (user_id, symbol): float } -> Para Trailing Stop PnL
_user_symbol_cooldown = {}    # { (user_id, symbol): float } -> Evitar re-entradas en ráfaga
_engine_started = False
_engine_lock = threading.Lock()

STRATEGIES_DIR = os.path.join(os.path.dirname(os.path.dirname(os.path.abspath(__file__))), 'strategies')

# Símbolos estándar de alta liquidez para trading automático si el usuario no especificó lista personalizada
DEFAULT_MARKET_SYMBOLS = [
    'BTCUSDT', 'ETHUSDT', 'SOLUSDT', 'DOGEUSDT', 'XRPUSDT',
    'BNBUSDT', 'TRXUSDT', 'ADAUSDT', 'XMRUSDT', 'HIPEUSDT'
]


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


def get_cached_klines(symbol: str, interval: str = '1m', limit: int = 100) -> pd.DataFrame | None:
    """Obtiene velas klines con caché compartida de 3 segundos para no saturar Binance API."""
    key = (symbol.upper(), interval)
    now = time.time()
    cached = _klines_cache.get(key)
    if cached and (now - cached['timestamp'] < 3.0):
        return cached['data'].copy()

    try:
        df = get_historical_klines(symbol.upper(), interval, limit=limit)
        if df is not None and not df.empty:
            _klines_cache[key] = {'data': df, 'timestamp': now}
            return df.copy()
    except Exception as e:
        get_logger().debug(f"Aviso al obtener klines para {symbol} ({interval}): {e}")
    return None


def load_strategy_params(strategy_name: str) -> dict:
    """Carga los parámetros completos de una estrategia desde BD o archivo JSON."""
    clean_name = str(strategy_name or '').strip()
    if not clean_name:
        clean_name = 'BOT_PARAPRUEBAS'

    # 1. Intentar desde catálogo de BD
    try:
        catalog = get_strategies_catalog(only_public=False)
        for item in catalog:
            if item.get('name') == clean_name and item.get('parameters'):
                return item['parameters']
    except Exception:
        pass

    # 2. Intentar desde archivo JSON
    strat_file = os.path.join(STRATEGIES_DIR, f"{clean_name}.json")
    if os.path.exists(strat_file):
        try:
            with open(strat_file, 'r', encoding='utf-8') as f:
                return json.load(f)
        except Exception:
            pass

    # 3. Parámetros por defecto defensivos
    return {
        'strategy_name': clean_name,
        'trade_direction': 'BIDIRECTIONAL',
        'rsi_interval': '1m',
        'rsi_period': 7,
        'rsi_type': 'CUTLER',
        'rsi_entry_level_low': 22,
        'rsi_entry_level_high': 45,
        'rsi_short_entry_level_low': 55,
        'rsi_short_entry_level_high': 70,
        'rsi_threshold_up': 2.0,
        'rsi_threshold_down': 2.5,
        'evaluate_rsi_range': True,
        'evaluate_rsi_delta': True,
        'evaluate_volume_filter': False,
        'take_profit_usdt': 50.0,
        'stop_loss_usdt': 400.0,
        'enable_take_profit_pnl': True,
        'enable_stop_loss_pnl': True,
        'enable_pnl_trailing_stop': True,
        'pnl_trailing_stop_activation_usdt': 3.5,
        'pnl_trailing_stop_drop_usdt': 1.5
    }


def evaluate_strategy_signal(symbol: str, klines_df: pd.DataFrame, params: dict) -> str | None:
    """
    Evalúa las condiciones cuantitativas de la estrategia sobre el DataFrame de velas.
    Retorna 'LONG', 'SHORT', o None si no hay señal.
    """
    if klines_df is None or len(klines_df) < 15:
        return None

    try:
        rsi_period = int(params.get('rsi_period', params.get('rsiPeriod', 7)) or 7)
        rsi_type = str(params.get('rsi_type', params.get('rsiType', 'CUTLER'))).upper()
        rsi_series = calculate_rsi(klines_df['close'], period=rsi_period, rsi_type=rsi_type)
        if rsi_series is None or len(rsi_series) < 3:
            return None

        curr_rsi = float(rsi_series.iloc[-1])
        prev_rsi = float(rsi_series.iloc[-2])
        delta_rsi = curr_rsi - prev_rsi

        trade_direction = str(params.get('trade_direction', 'BIDIRECTIONAL')).upper()

        # Parámetros LONG
        eval_range = str(params.get('evaluate_rsi_range', params.get('evaluateRsiRange', True))).lower() == 'true'
        low_long = float(params.get('rsi_entry_level_low', params.get('rsiEntryLevelLow', 22)) or 22)
        high_long = float(params.get('rsi_entry_level_high', params.get('rsiEntryLevelHigh', 45)) or 45)

        eval_delta = str(params.get('evaluate_rsi_delta', params.get('evaluateRsiDelta', True))).lower() == 'true'
        thresh_up = float(params.get('rsi_threshold_up', params.get('rsiThresholdUp', 2.0)) or 2.0)

        # 1. EVALUAR ENTRADA LONG
        if trade_direction in ('LONG', 'BIDIRECTIONAL'):
            long_ok = True
            if eval_range and not (low_long <= curr_rsi <= high_long):
                long_ok = False
            if eval_delta and delta_rsi < thresh_up:
                long_ok = False

            # Filtro de volumen opcional
            eval_vol = str(params.get('evaluate_volume_filter', params.get('evaluateVolumeFilter', False))).lower() == 'true'
            if long_ok and eval_vol:
                v_period = int(params.get('volume_sma_period', 20) or 20)
                v_factor = float(params.get('volume_factor', 1.0) or 1.0)
                if len(klines_df['volume']) >= v_period:
                    v_sma = float(klines_df['volume'].rolling(v_period).mean().iloc[-1])
                    c_vol = float(klines_df['volume'].iloc[-1])
                    if c_vol < v_factor * v_sma:
                        long_ok = False

            # Filtro de vela alcista
            eval_uptrend = str(params.get('evaluate_required_uptrend', params.get('evaluateRequiredUptrend', False))).lower() == 'true'
            if long_ok and eval_uptrend:
                last_c = float(klines_df['close'].iloc[-1])
                last_o = float(klines_df['open'].iloc[-1])
                if last_c < last_o:  # Vela roja
                    long_ok = False

            if long_ok:
                return 'LONG'

        # 2. EVALUAR ENTRADA SHORT
        if trade_direction in ('SHORT', 'BIDIRECTIONAL'):
            short_ok = True
            low_short = float(params.get('rsi_short_entry_level_low', params.get('rsiShortEntryLevelLow', 55)) or 55)
            high_short = float(params.get('rsi_short_entry_level_high', params.get('rsiShortEntryLevelHigh', 70)) or 70)
            thresh_down = float(params.get('rsi_threshold_down', params.get('rsiThresholdDown', 2.5)) or 2.5)

            if eval_range and not (low_short <= curr_rsi <= high_short):
                short_ok = False
            if eval_delta and delta_rsi > -abs(thresh_down):
                short_ok = False

            # Filtro de vela bajista
            eval_trend = str(params.get('evaluate_required_uptrend', False)).lower() == 'true'
            if short_ok and eval_trend:
                last_c = float(klines_df['close'].iloc[-1])
                last_o = float(klines_df['open'].iloc[-1])
                if last_c > last_o:  # Vela verde
                    short_ok = False

            if short_ok:
                return 'SHORT'

    except Exception as e:
        get_logger().debug(f"[{symbol}] Error evaluando señal de estrategia: {e}")

    return None


def execute_user_entry(client, user: dict, symbol: str, signal_side: str, entry_price: float, params: dict) -> bool:
    """Ejecuta una orden MARKET de entrada directamente en la cuenta Binance del usuario."""
    logger = get_logger()
    user_id = user['user_id']
    username = user['username']
    clean_sym = symbol.upper().strip()

    try:
        # 1. Obtener balance real en Binance
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
        if balance_detected > 10.0 and allocated_usdt > balance_detected:
            allocated_usdt = round(balance_detected * 0.90, 2)
        elif balance_detected <= 10.0 and allocated_usdt > 10.0:
            allocated_usdt = 10.0

        leverage = int(user.get('leverage', 10) or 10)
        margin_type = str(user.get('margin_type', 'ISOLATED')).upper().strip()

        # 2. Configurar margen y apalancamiento
        try:
            client.change_margin_type(symbol=clean_sym, marginType=margin_type)
        except Exception:
            pass
        try:
            client.change_leverage(symbol=clean_sym, leverage=leverage)
        except Exception:
            pass

        # 3. Calcular tamaño y ajustar a LOT_SIZE
        notional = allocated_usdt * leverage
        if entry_price <= 0:
            return False

        raw_qty = notional / entry_price
        qty = adjust_quantity_for_symbol(clean_sym, raw_qty)
        if not qty or qty <= 0:
            logger.warning(f"[{clean_sym}] Cantidad calculada ({qty}) no válida tras ajuste por LOT_SIZE.")
            return False

        # 4. Detectar modo de cobertura (Hedge Mode)
        is_hedge = False
        try:
            pos_mode = client.get_position_mode()
            if isinstance(pos_mode, dict):
                is_hedge = bool(pos_mode.get('dualSidePosition', False))
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
            strat_name = str(user.get('strategy_name') or params.get('strategy_name') or 'BOT_PARAPRUEBAS')

            record_user_trade(
                user_id=user_id,
                symbol=clean_sym,
                trade_type=signal_side.upper(),
                open_timestamp=datetime.now(),
                open_price=executed_price if executed_price > 0 else entry_price,
                quantity=qty,
                position_size_usdt=round(qty * (executed_price if executed_price > 0 else entry_price), 2),
                close_reason=f"Estrategia {strat_name} (Bot Personal)",
                binance_trade_id=order_id,
                strategy_name=strat_name,
                is_testnet=bool(user.get('is_testnet', False))
            )
            logger.info(f"🚀 [PersonalBot - {username} (ID: {user_id})] ORDEN ENTRADA {signal_side} EJECUTADA en {clean_sym} (Qty={qty}, Ref=${executed_price:.4f}, Notional=${notional:,.2f})")
            return True

    except ClientError as ce:
        err_msg = f"Binance: {ce.error_message} ({ce.error_code})"
        logger.warning(f"⚠️ [PersonalBot - {username}] Error de orden en {clean_sym}: {err_msg}")
    except Exception as e:
        logger.error(f"❌ [PersonalBot - {username}] Excepción en orden {clean_sym}: {e}")

    return False


def close_user_position(client, user: dict, symbol: str, pos_amt: float, current_price: float, unrealized_pnl: float, exit_reason: str, entry_price: float = 0.0) -> bool:
    """Cierra una posición abierta en la cuenta de Binance del usuario y registra el resultado."""
    logger = get_logger()
    user_id = user['user_id']
    username = user['username']
    clean_sym = symbol.upper().strip()

    try:
        side = 'SELL' if pos_amt > 0 else 'BUY'
        raw_qty = abs(pos_amt)
        qty = adjust_quantity_for_symbol(clean_sym, raw_qty) or raw_qty

        is_hedge = False
        try:
            pos_mode = client.get_position_mode()
            if isinstance(pos_mode, dict):
                is_hedge = bool(pos_mode.get('dualSidePosition', False))
        except Exception:
            is_hedge = False

        pos_side = ('LONG' if pos_amt > 0 else 'SHORT') if is_hedge else 'BOTH'

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
        order_id = str(order_res.get('orderId', '')) if isinstance(order_res, dict) else ''
        strat_name = str(user.get('strategy_name') or 'BOT_PARAPRUEBAS')

        record_user_trade(
            user_id=user_id,
            symbol=clean_sym,
            trade_type='LONG' if pos_amt > 0 else 'SHORT',
            open_timestamp=datetime.now(),
            open_price=entry_price if entry_price > 0 else current_price,
            quantity=qty,
            position_size_usdt=round(qty * current_price, 2),
            close_timestamp=datetime.now(),
            close_price=current_price,
            pnl_usdt=unrealized_pnl,
            close_reason=f"{exit_reason} (Bot Personal)",
            binance_trade_id=order_id,
            strategy_name=strat_name,
            is_testnet=bool(user.get('is_testnet', False))
        )
        logger.info(f"🛑 [PersonalBot - {username} (ID: {user_id})] POSICIÓN CERRADA en {clean_sym} ({side} {qty}, PnL: ${unrealized_pnl:+.2f} USDT). Razón: {exit_reason}")
        # Limpiar peak de trailing stop
        _user_peak_pnl.pop((user_id, clean_sym), None)
        return True

    except Exception as e:
        logger.warning(f"Aviso al cerrar posición en {clean_sym} para {username}: {e}")
        return False


def run_personal_bot_cycle():
    """
    Ciclo autónomo de ejecución para todos los usuarios con Bot Personal Activo (is_running = True).
    1. Revisa posiciones abiertas del usuario y evalúa salidas (TP, SL, Trailing, RSI Target).
    2. Si tiene cupo para nuevas posiciones, evalúa entradas de su estrategia en los símbolos configurados.
    """
    logger = get_logger()
    try:
        active_users = get_all_active_bot_users(operating_mode='PERSONAL_BOT')
    except Exception as e_q:
        logger.debug(f"Aviso consultando usuarios activos: {e_q}")
        return

    if not active_users:
        return

    for user in active_users:
        user_id = user['user_id']
        username = user['username']
        strat_name = str(user.get('strategy_name') or 'BOT_PARAPRUEBAS').strip()
        params = load_strategy_params(strat_name)

        client = get_cached_user_client(user)
        if not client:
            continue

        try:
            positions_data = client.get_position_risk()
        except Exception as e_pos:
            logger.debug(f"Aviso al consultar posiciones para {username}: {e_pos}")
            continue

        if not positions_data or not isinstance(positions_data, list):
            continue

        # Mapear posiciones abiertas actualmente en Binance para este usuario
        open_positions = {}
        for p in positions_data:
            amt = float(p.get('positionAmt', 0.0) or 0.0)
            if abs(amt) > 1e-6:
                open_positions[p.get('symbol')] = p

        # -------------------------------------------------------------
        # PASO A: EVALUAR SALIDAS EN POSICIONES ABIERTAS DEL USUARIO
        # -------------------------------------------------------------
        for sym, p in list(open_positions.items()):
            pos_amt = float(p.get('positionAmt', 0.0) or 0.0)
            entry_p = float(p.get('entryPrice', 0.0) or 0.0)
            mark_p = float(p.get('markPrice', 0.0) or entry_p)
            unrealized_pnl = float(p.get('unRealizedProfit', 0.0) or 0.0)

            # 1. Take Profit por PnL
            tp_usdt = float(params.get('take_profit_usdt', params.get('takeProfitUSDT', 50.0)) or 50.0)
            enable_tp = str(params.get('enable_take_profit_pnl', params.get('enableTakeProfitPnl', True))).lower() == 'true'
            if enable_tp and unrealized_pnl >= tp_usdt:
                close_user_position(client, user, sym, pos_amt, mark_p, unrealized_pnl, f"Take Profit (+{unrealized_pnl:.2f} USDT)", entry_price=entry_p)
                continue

            # 2. Stop Loss por PnL
            sl_usdt = float(params.get('stop_loss_usdt', params.get('stopLossUSDT', 400.0)) or 400.0)
            enable_sl = str(params.get('enable_stop_loss_pnl', params.get('enableStopLossPnl', True))).lower() == 'true'
            if enable_sl and unrealized_pnl <= -abs(sl_usdt):
                close_user_position(client, user, sym, pos_amt, mark_p, unrealized_pnl, f"Stop Loss ({unrealized_pnl:.2f} USDT)", entry_price=entry_p)
                continue

            # 3. Trailing Stop PnL
            enable_trail = str(params.get('enable_pnl_trailing_stop', params.get('enablePnlTrailingStop', True))).lower() == 'true'
            if enable_trail:
                act_usdt = float(params.get('pnl_trailing_stop_activation_usdt', params.get('pnlTrailingStopActivationUSDT', 3.5)) or 3.5)
                drop_usdt = float(params.get('pnl_trailing_stop_drop_usdt', params.get('pnlTrailingStopDropUSDT', 1.5)) or 1.5)
                peak_key = (user_id, sym)
                curr_peak = _user_peak_pnl.get(peak_key, 0.0)
                if unrealized_pnl > curr_peak:
                    _user_peak_pnl[peak_key] = unrealized_pnl
                    curr_peak = unrealized_pnl
                if curr_peak >= act_usdt and (curr_peak - unrealized_pnl) >= drop_usdt:
                    close_user_position(client, user, sym, pos_amt, mark_p, unrealized_pnl, f"Trailing Stop Asegurado (+{unrealized_pnl:.2f} USDT)", entry_price=entry_p)
                    continue

        # -------------------------------------------------------------
        # PASO B: EVALUAR ENTRADAS EN SÍMBOLOS CANDIDATOS
        # -------------------------------------------------------------
        max_open = int(user.get('max_open_positions', 3) or 3)
        current_open_count = len(open_positions)
        if current_open_count >= max_open:
            continue  # Cupo máximo de posiciones alcanzado

        # Determinar lista de símbolos a evaluar
        raw_user_syms = str(user.get('symbols_to_trade', '')).strip()
        # Si tiene el valor por defecto restringido de 3 símbolos o está vacío, expandir a lista de mercado de alta liquidez
        if not raw_user_syms or raw_user_syms in ('BTCUSDT,ETHUSDT,SOLUSDT', 'BTCUSDT'):
            strat_syms = params.get('symbols_to_trade') or params.get('symbolsToTrade')
            if strat_syms:
                candidate_symbols = [s.strip().upper() for s in str(strat_syms).split(',') if s.strip()]
            else:
                candidate_symbols = DEFAULT_MARKET_SYMBOLS
        else:
            candidate_symbols = [s.strip().upper() for s in raw_user_syms.split(',') if s.strip()]

        interval = str(params.get('rsi_interval', params.get('rsiInterval', '1m')) or '1m')

        for sym in candidate_symbols:
            if sym in open_positions:
                continue
            if current_open_count >= max_open:
                break

            # Cooldown de 60 segundos por símbolo para el usuario
            last_entry = _user_symbol_cooldown.get((user_id, sym), 0)
            if time.time() - last_entry < 60:
                continue

            # Obtener velas históricas
            klines = get_cached_klines(sym, interval=interval, limit=100)
            if klines is None or len(klines) < 15:
                continue

            # Evaluar señal según la estrategia
            signal = evaluate_strategy_signal(sym, klines, params)
            if signal in ('LONG', 'SHORT'):
                curr_price = float(klines['close'].iloc[-1])
                success = execute_user_entry(client, user, sym, signal, curr_price, params)
                if success:
                    _user_symbol_cooldown[(user_id, sym)] = time.time()
                    current_open_count += 1
                    open_positions[sym] = True


def _personal_bot_engine_loop():
    """Hilo demonio en segundo plano que corre el motor autónomo 24/7."""
    logger = get_logger()
    logger.info("⚡ [PersonalBotEngine] Motor Autónomo de Bots de Usuario iniciado y activo 24/7.")
    while True:
        try:
            run_personal_bot_cycle()
        except Exception as e:
            logger.error(f"[PersonalBotEngine] Excepción en ciclo: {e}", exc_info=True)
        time.sleep(3.0)  # Ciclo de evaluación cada 3 segundos


def start_personal_bot_engine():
    """Inicia el hilo en segundo plano del motor autónomo de usuarios si no está activo."""
    global _engine_started
    with _engine_lock:
        if not _engine_started:
            t = threading.Thread(target=_personal_bot_engine_loop, name="PersonalBotEngineThread", daemon=True)
            t.start()
            _engine_started = True


# --- MÉTODOS DE BROADCAST EN VIVO PARA SEÑALES INMEDIATAS ---

def dispatch_entry_order_to_users(symbol: str, signal_side: str, entry_price: float, reason: str = 'RSI Oversold Signal', strategy_name: str = '') -> dict:
    """
    Despacha la orden de entrada a todos los usuarios activos (COPY_TRADING y PERSONAL_BOT).
    Se llama inmediatamente cuando se detecta una señal técnica en el bot central.
    """
    logger = get_logger()
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

        # Si el usuario es PERSONAL_BOT y eligió una estrategia distinta a la de la señal, omitir
        if op_mode in ['PERSONAL_BOT', 'MY_BOT'] and user_strategy and strategy_name:
            if user_strategy.lower() != strategy_name.lower() and user_strategy != 'WTN Scalper Pro':
                continue

        try:
            client = get_cached_user_client(user)
            if not client:
                continue

            # Verificar si ya está en posición
            positions = client.get_position_risk(symbol=clean_sym)
            if positions and isinstance(positions, list):
                if any(abs(float(p.get('positionAmt', 0.0) or 0.0)) > 1e-6 for p in positions):
                    continue

            params = load_strategy_params(strategy_name or user_strategy)
            ok = execute_user_entry(client, user, clean_sym, signal_side, entry_price, params)
            if ok:
                results["success"] += 1

        except Exception as e:
            results["errors"] += 1
            logger.error(f"❌ [Dispatch Entry - {username}] Error: {e}")

    return results


def dispatch_exit_order_to_users(symbol: str, exit_reason: str, exit_price: float) -> dict:
    """Cierra las posiciones de los usuarios activos cuando el bot central cierra una posición."""
    logger = get_logger()
    active_users = get_all_active_bot_users(operating_mode=None)
    if not active_users:
        return {"dispatched": 0, "closed": 0}

    results = {"dispatched": len(active_users), "closed": 0}
    clean_sym = symbol.upper().strip()

    for user in active_users:
        username = user['username']
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
                unrealized_pnl = float(p.get('unRealizedProfit', 0.0) or 0.0)
                entry_p = float(p.get('entryPrice', exit_price) or exit_price)
                close_user_position(client, user, clean_sym, amt, exit_price, unrealized_pnl, exit_reason, entry_price=entry_p)
                results["closed"] += 1

        except Exception as e:
            logger.warning(f"Aviso al cerrar posición para {username}: {e}")

    return results
