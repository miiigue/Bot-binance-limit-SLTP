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
    get_strategies_catalog, close_user_trade_record
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
_last_heartbeat_time = 0

STRATEGIES_DIR = os.path.join(os.path.dirname(os.path.dirname(os.path.abspath(__file__))), 'strategies')

# Símbolos estándar de alta liquidez para trading automático si el usuario no especificó lista personalizada
DEFAULT_MARKET_SYMBOLS = [
    'BTCUSDT', 'ETHUSDT', 'SOLUSDT', 'DOGEUSDT', 'XRPUSDT',
    'BNBUSDT', 'TRXUSDT', 'ADAUSDT', 'AVAXUSDT', 'LINKUSDT', 'SUIUSDT'
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
                if len(klines_df['volume']) >= v_period + 1:
                    vol_series = pd.to_numeric(klines_df['volume'], errors='coerce')
                    v_sma = float(vol_series.rolling(v_period).mean().iloc[-2])
                    vol_completed = float(vol_series.iloc[-2])
                    vol_forming = float(vol_series.iloc[-1])
                    c_vol = max(vol_completed, vol_forming)
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

        # 1. Obtener balance disponible real en Binance
        available_balance = 0.0
        try:
            balances = client.balance()
            if isinstance(balances, list):
                for b in balances:
                    if str(b.get('asset', '')).upper() == 'USDT':
                        available_balance = float(b.get('availableBalance', 0.0) or b.get('balance', 0.0) or 0.0)
                        break
        except Exception:
            pass

        # Margen por orden (USDT) configurado por el usuario o de la estrategia
        order_margin = float(user.get('allocated_usdt') or params.get('position_size_usdt') or params.get('positionSizeUSDT') or 50.0)
        if order_margin < 5.0:
            order_margin = 5.0

        # Verificar saldo libre disponible en Binance para cubrir el margen
        if available_balance > 0 and available_balance < order_margin:
            logger.warning(f"⚠️ [{clean_sym}] Saldo libre en Binance ({available_balance:.2f} USDT) insuficiente para cubrir margen de orden ({order_margin:.2f} USDT).")
            return False

        # Multiplicador / Apalancamiento:
        # Si el usuario seleccionó un apalancamiento específico en su interfaz (> 0), usar ese número.
        # Si seleccionó "Por Defecto" (None, 0 o 'default'), usar el apalancamiento establecido en la estrategia.
        user_custom_lev = user.get('leverage')
        if user_custom_lev is not None and str(user_custom_lev).strip() not in ('', '0', 'default', 'None'):
            try:
                leverage = int(user_custom_lev)
            except (ValueError, TypeError):
                strat_lev = params.get('leverage')
                leverage = int(strat_lev) if strat_lev is not None else 10
        else:
            strat_lev = params.get('leverage')
            try:
                leverage = int(strat_lev) if strat_lev is not None else 10
            except (ValueError, TypeError):
                leverage = 10

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

        # 3. Valor nominal de la posición: Margen * Multiplicador
        notional = order_margin * leverage
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

        close_user_trade_record(
            user_id=user_id,
            symbol=clean_sym,
            close_price=current_price,
            pnl_usdt=unrealized_pnl,
            close_reason=f"{exit_reason} (Bot Personal)",
            exit_order_id=order_id
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

    global _last_heartbeat_time
    now_ts = time.time()
    do_heartbeat = (now_ts - _last_heartbeat_time >= 30.0)
    if do_heartbeat:
        _last_heartbeat_time = now_ts
        logger.info(f"⚡ [PersonalBotEngine] Ciclo activo - monitoreando {len(active_users)} usuario(s) en Binance Futures.")

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

        # CRITICAL FIX: En Binance Demo/Testnet, si NO hay posiciones abiertas, get_position_risk() retorna [].
        # 'if not positions_data' evalúa True en lista vacía y provocaba 'continue', bloqueando la apertura del primer trade.
        if positions_data is None or not isinstance(positions_data, list):
            continue

        # Mapear posiciones abiertas actualmente en Binance para este usuario
        open_positions = {}
        for p in positions_data:
            amt = float(p.get('positionAmt', 0.0) or 0.0)
            if abs(amt) > 1e-6:
                open_positions[p.get('symbol')] = p

        if do_heartbeat:
            logger.info(f"🔍 [PersonalBotEngine - {username}] Posiciones abiertas: {len(open_positions)}. Estrategia: '{strat_name}'")

        # RECONCILIACIÓN AUTOMÁTICA SOBERANA CON user_trades:
        # Si hay una fila en user_trades marcada como abierta (close_timestamp IS NULL)
        # pero el símbolo YA NO está abierto en Binance, cerrarla en la base de datos
        # para que nunca muestre trades "En curso" huérfanos.
        try:
            from src.database import get_db_connection
            conn_recon = get_db_connection()
            if conn_recon:
                cur_recon = conn_recon.cursor()
                cur_recon.execute("""
                    SELECT id, symbol, open_price, position_size_usdt 
                    FROM user_trades 
                    WHERE user_id = ? AND close_timestamp IS NULL
                """, (user_id,))
                ghost_trades = cur_recon.fetchall()
                for gt in ghost_trades:
                    gt_sym = str(gt['symbol']).upper()
                    if gt_sym not in open_positions:
                        now_str = datetime.now().strftime('%Y-%m-%d %H:%M:%S')
                        cur_recon.execute("""
                            UPDATE user_trades 
                            SET close_timestamp = ?, 
                                close_price = open_price, 
                                pnl_usdt = 0.0, 
                                close_reason = 'Cierre confirmado en Binance'
                            WHERE id = ?
                        """, (now_str, gt['id']))
                        conn_recon.commit()
                        logger.info(f"🔄 [PersonalBotEngine] Trade huérfano #{gt['id']} ({gt_sym}) reconciliado y cerrado en base de datos.")
                conn_recon.close()
        except Exception as e_recon:
            logger.debug(f"Aviso en reconciliación de trades huérfanos: {e_recon}")

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
        # PASO B: EVALUAR ENTRADAS EN SÍMBOLOS CANDIDATOS (PARIDAD CON ADMINISTRADOR)
        # -------------------------------------------------------------
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
                logger.info(f"🎯 [PersonalBot - {username}] Señal {signal} detectada en {sym} (Precio: {curr_price}) para estrategia '{strat_name}'. Ejecutando orden...")
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


def get_user_monitor_status(user_id: int) -> dict:
    """
    Retorna el estado en vivo de todas las posiciones abiertas y el radar cuantitativo
    de cada símbolo para el usuario específico.
    """
    from src.database import get_user_bot_settings, get_user_api_keys, get_db_connection
    settings = get_user_bot_settings(user_id) or {}
    keys = get_user_api_keys(user_id, decrypt=True) or {}
    
    strat_name = str(settings.get('strategy_name') or 'BOT_PARAPRUEBAS').strip()
    params = load_strategy_params(strat_name)
    
    # 1. Obtener cliente y posiciones reales en Binance
    user_dict = {
        'user_id': user_id,
        'username': settings.get('username', f'user_{user_id}'),
        'api_key': keys.get('api_key'),
        'api_secret': keys.get('api_secret'),
        'is_testnet': bool(keys.get('is_testnet', False)),
        'api_base_url': keys.get('api_base_url')
    }
    
    open_positions = {}
    if user_dict['api_key'] and user_dict['api_secret']:
        try:
            client = get_cached_user_client(user_dict)
            if client:
                pos_risk = client.get_position_risk()
                if pos_risk and isinstance(pos_risk, list):
                    for p in pos_risk:
                        amt = float(p.get('positionAmt', 0.0) or 0.0)
                        if abs(amt) > 1e-6:
                            open_positions[p.get('symbol')] = p
        except Exception as e_pos:
            get_logger().debug(f"Aviso consultando posiciones de monitor para user {user_id}: {e_pos}")

    # 2. PnL Histórico por símbolo desde user_trades
    historical_pnls = {}
    try:
        conn = get_db_connection()
        if conn:
            cur = conn.cursor()
            cur.execute("""
                SELECT symbol, SUM(COALESCE(pnl_usdt, 0.0)) as total_pnl
                FROM user_trades
                WHERE user_id = ? AND close_timestamp IS NOT NULL
                GROUP BY symbol
            """, (user_id,))
            for r in cur.fetchall():
                historical_pnls[r['symbol']] = round(float(r['total_pnl'] or 0.0), 4)
            conn.close()
    except Exception:
        pass

    # 3. Lista de símbolos a monitorear: posiciones abiertas + símbolos candidatos
    raw_user_syms = str(settings.get('symbols_to_trade', '')).strip()
    if not raw_user_syms or raw_user_syms in ('BTCUSDT,ETHUSDT,SOLUSDT', 'BTCUSDT'):
        strat_syms = params.get('symbols_to_trade') or params.get('symbolsToTrade')
        if strat_syms:
            symbols_list = [s.strip().upper() for s in str(strat_syms).split(',') if s.strip()]
        else:
            symbols_list = DEFAULT_MARKET_SYMBOLS.copy()
    else:
        symbols_list = [s.strip().upper() for s in raw_user_syms.split(',') if s.strip()]

    # Asegurar que todas las posiciones abiertas estén en la lista
    for sym in open_positions.keys():
        if sym not in symbols_list:
            symbols_list.append(sym)

    # Parámetros de la estrategia para TP, SL, Trailing
    tp_usdt = float(params.get('take_profit_usdt', params.get('takeProfitUSDT', 50.0)) or 50.0)
    sl_usdt = float(params.get('stop_loss_usdt', params.get('stopLossUSDT', 400.0)) or 400.0)
    ts_act = float(params.get('pnl_trailing_stop_activation_usdt', 3.5) or 3.5)
    ts_drop = float(params.get('pnl_trailing_stop_drop_usdt', 1.5) or 1.5)
    enable_ts = str(params.get('enable_pnl_trailing_stop', True)).lower() == 'true'

    # Parámetros de indicadores para el radar
    rsi_interval = str(params.get('rsi_interval', '1m') or '1m')
    rsi_period = int(params.get('rsi_period', 7) or 7)
    rsi_type = str(params.get('rsi_type', 'CUTLER')).upper()
    trade_dir = str(params.get('trade_direction', 'BIDIRECTIONAL')).upper()

    low_long = float(params.get('rsi_entry_level_low', 22) or 22)
    high_long = float(params.get('rsi_entry_level_high', 45) or 45)
    thresh_up = float(params.get('rsi_threshold_up', 2.0) or 2.0)

    low_short = float(params.get('rsi_short_entry_level_low', 55) or 55)
    high_short = float(params.get('rsi_short_entry_level_high', 70) or 70)
    thresh_down = float(params.get('rsi_threshold_down', 2.5) or 2.5)

    v_period = int(params.get('volume_sma_period', 20) or 20)
    v_factor = float(params.get('volume_factor', 1.0) or 1.0)
    eval_vol = str(params.get('evaluate_volume_filter', False)).lower() == 'true'

    symbols_data = []

    for sym in symbols_list:
        pos_raw = open_positions.get(sym)
        in_pos = pos_raw is not None
        trade_side = None
        unrealized_pnl = 0.0
        pos_info = None

        if in_pos:
            amt = float(pos_raw.get('positionAmt', 0.0) or 0.0)
            trade_side = 'LONG' if amt > 0 else 'SHORT'
            unrealized_pnl = round(float(pos_raw.get('unRealizedProfit', 0.0) or 0.0), 2)
            entry_p = float(pos_raw.get('entryPrice', 0.0) or 0.0)
            mark_p = float(pos_raw.get('markPrice', entry_p) or entry_p)

            # Cálculo de TP
            tp_progress = min(100.0, max(0.0, (unrealized_pnl / tp_usdt) * 100.0)) if tp_usdt > 0 else 0.0
            tp_remaining = max(0.0, tp_usdt - unrealized_pnl)

            # Trailing stop
            peak_val = _user_peak_pnl.get((user_id, sym), 0.0)
            if unrealized_pnl > peak_val:
                peak_val = unrealized_pnl
            ts_armed = enable_ts and (peak_val >= ts_act)

            # Cálculo de SL
            sl_dist = round(abs(sl_usdt) - abs(min(0.0, unrealized_pnl)), 2)
            sl_fill = min(100.0, max(0.0, (abs(min(0.0, unrealized_pnl)) / abs(sl_usdt)) * 100.0)) if sl_usdt > 0 else 0.0

            pos_info = {
                'side': trade_side,
                'amt': amt,
                'entry_price': entry_p,
                'mark_price': mark_p,
                'unrealized_pnl': unrealized_pnl,
                'tp': {
                    'target_usdt': tp_usdt,
                    'progress_pct': round(tp_progress, 1),
                    'remaining_usdt': round(tp_remaining, 2)
                },
                'sl': {
                    'target_usdt': -abs(sl_usdt),
                    'distance_usdt': sl_dist,
                    'fill_pct': round(sl_fill, 1)
                },
                'ts': {
                    'enabled': enable_ts,
                    'armed': ts_armed,
                    'act_threshold': ts_act,
                    'drop_usdt': ts_drop,
                    'peak_value': round(peak_val, 2)
                }
            }

        # 4. Calcular condiciones del radar (LONG y SHORT)
        klines = get_cached_klines(sym, interval=rsi_interval, limit=100)
        curr_rsi = 50.0
        delta_rsi = 0.0
        is_green = True
        vol_ok = True
        c_vol = 1.0
        v_sma = 1.0

        if klines is not None and len(klines) >= 15:
            rsi_series = calculate_rsi(klines['close'], period=rsi_period, rsi_type=rsi_type)
            if rsi_series is not None and len(rsi_series) >= 2:
                curr_rsi = round(float(rsi_series.iloc[-1]), 1)
                delta_rsi = round(float(rsi_series.iloc[-1] - rsi_series.iloc[-2]), 1)
            last_c = float(klines['close'].iloc[-1])
            last_o = float(klines['open'].iloc[-1])
            is_green = (last_c >= last_o)

            if eval_vol and len(klines['volume']) >= v_period + 1:
                vol_s = pd.to_numeric(klines['volume'], errors='coerce')
                v_sma = float(vol_s.rolling(v_period).mean().iloc[-2]) or 1.0
                vol_c = float(vol_s.iloc[-2])
                vol_f = float(vol_s.iloc[-1])
                c_vol = max(vol_c, vol_f)
                vol_ok = (c_vol >= v_factor * v_sma)

        last_entry_ts = _user_symbol_cooldown.get((user_id, sym), 0)
        cooldown_active = (time.time() - last_entry_ts < 60)
        dir_allows_long = trade_dir in ('LONG', 'BIDIRECTIONAL')
        dir_allows_short = trade_dir in ('SHORT', 'BIDIRECTIONAL')

        long_cond1 = (low_long <= curr_rsi <= high_long)
        long_cond2 = (delta_rsi >= thresh_up)
        long_cond3 = is_green
        long_cond4 = vol_ok
        long_cond5 = dir_allows_long and not cooldown_active

        long_conditions = [
            {'id': 'rsi_range', 'name': 'RSI en Rango', 'desc': f'RSI [{low_long}-{high_long}]', 'value': f'{curr_rsi}', 'passed': bool(long_cond1)},
            {'id': 'rsi_delta', 'name': 'Delta RSI', 'desc': f'Delta >= +{thresh_up}', 'value': f'{delta_rsi:+}', 'passed': bool(long_cond2)},
            {'id': 'candle_trend', 'name': 'Vela Alcista', 'desc': 'Cierre >= Apertura', 'value': 'Verde' if is_green else 'Roja', 'passed': bool(long_cond3)},
            {'id': 'volume_filter', 'name': 'Filtro Volumen', 'desc': f'Vol >= {v_factor}x SMA', 'value': 'OK' if vol_ok else 'Bajo', 'passed': bool(long_cond4)},
            {'id': 'direction', 'name': 'Dirección & Cooldown', 'desc': 'Permitido y sin cooldown', 'value': 'OK' if long_cond5 else 'Bloqueado', 'passed': bool(long_cond5)}
        ]
        long_met_count = sum(1 for c in long_conditions if c['passed'])

        short_cond1 = (low_short <= curr_rsi <= high_short)
        short_cond2 = (delta_rsi <= -abs(thresh_down))
        short_cond3 = not is_green
        short_cond4 = vol_ok
        short_cond5 = dir_allows_short and not cooldown_active

        short_conditions = [
            {'id': 'rsi_range', 'name': 'RSI en Rango', 'desc': f'RSI [{low_short}-{high_short}]', 'value': f'{curr_rsi}', 'passed': bool(short_cond1)},
            {'id': 'rsi_delta', 'name': 'Delta RSI', 'desc': f'Delta <= -{thresh_down}', 'value': f'{delta_rsi:+}', 'passed': bool(short_cond2)},
            {'id': 'candle_trend', 'name': 'Vela Bajista', 'desc': 'Cierre <= Apertura', 'value': 'Roja' if not is_green else 'Verde', 'passed': bool(short_cond3)},
            {'id': 'volume_filter', 'name': 'Filtro Volumen', 'desc': f'Vol >= {v_factor}x SMA', 'value': 'OK' if vol_ok else 'Bajo', 'passed': bool(short_cond4)},
            {'id': 'direction', 'name': 'Dirección & Cooldown', 'desc': 'Permitido y sin cooldown', 'value': 'OK' if short_cond5 else 'Bloqueado', 'passed': bool(short_cond5)}
        ]
        short_met_count = sum(1 for c in short_conditions if c['passed'])

        state_label = 'In Position' if in_pos else ('Cooldown' if cooldown_active else 'Buscando Entrada')

        symbols_data.append({
            'symbol': sym,
            'strategy_name': strat_name,
            'state': state_label,
            'in_position': in_pos,
            'trade_side': trade_side,
            'unrealized_pnl': unrealized_pnl,
            'historical_pnl': historical_pnls.get(sym, 0.0),
            'cooldown_active': cooldown_active,
            'position': pos_info,
            'long_radar': {
                'conditions': long_conditions,
                'met_count': long_met_count,
                'total_count': len(long_conditions),
                'all_met': (long_met_count == len(long_conditions))
            },
            'short_radar': {
                'conditions': short_conditions,
                'met_count': short_met_count,
                'total_count': len(short_conditions),
                'all_met': (short_met_count == len(short_conditions))
            }
        })

    return {
        'status': 'success',
        'strategy_name': strat_name,
        'operating_mode': str(settings.get('operating_mode') or 'PERSONAL_BOT'),
        'is_running': bool(settings.get('is_running', False)),
        'symbols': symbols_data
    }
