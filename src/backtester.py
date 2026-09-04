import os
import json
import time
import urllib.request
from datetime import datetime, timedelta
import pandas as pd
import numpy as np

# Directorio de caché local para velas históricas
CACHE_DIR = os.path.join(os.path.dirname(os.path.dirname(os.path.abspath(__file__))), 'src', 'data_cache')
os.makedirs(CACHE_DIR, exist_ok=True)

# Endpoint público de Binance Futures (no requiere API keys)
BINANCE_FUTURES_PUBLIC_KLINES = "https://fapi.binance.com/fapi/v1/klines"


def get_historical_klines_paginated(symbol: str, interval: str = '5m', days: int = 14, start_date: str = None, end_date: str = None, use_cache: bool = True) -> pd.DataFrame:
    """
    Descarga datos históricos de velas de Binance Futures paginando hasta cubrir el período solicitado.
    Soporta:
    - Modo relativo: por cantidad de días (ej: days=14, 30, 60, etc.)
    - Modo fechas específicas: start_date='2024-01-01', end_date='2024-03-18' (formato YYYY-MM-DD)
    """
    symbol = symbol.upper().strip()

    is_custom_range = bool(start_date and end_date)
    if is_custom_range:
        try:
            dt_start = datetime.strptime(start_date.strip(), "%Y-%m-%d")
            dt_end = datetime.strptime(end_date.strip(), "%Y-%m-%d") + timedelta(days=1) - timedelta(milliseconds=1)
            start_time = int(dt_start.timestamp() * 1000)
            end_time = int(dt_end.timestamp() * 1000)
            cache_tag = f"{start_date.strip()}_{end_date.strip()}"
        except Exception:
            is_custom_range = False
            end_time = int(time.time() * 1000)
            start_time = int((datetime.utcnow() - timedelta(days=days)).timestamp() * 1000)
            cache_tag = f"{days}d"
    else:
        end_time = int(time.time() * 1000)
        start_time = int((datetime.utcnow() - timedelta(days=days)).timestamp() * 1000)
        cache_tag = f"{days}d"

    cache_file = os.path.join(CACHE_DIR, f"{symbol}_{interval}_{cache_tag}.json")

    # 1. Verificar si la caché existe
    if use_cache and os.path.exists(cache_file):
        file_age = time.time() - os.path.getmtime(cache_file)
        # Si es un rango cerrado del pasado, la caché es inmutable y no expira
        is_past_closed = is_custom_range and (end_time < int(time.time() * 1000) - 86400000)
        if is_past_closed or file_age < 3 * 3600:
            try:
                with open(cache_file, 'r', encoding='utf-8') as f:
                    cached_raw = json.load(f)
                if cached_raw and len(cached_raw) > 50:
                    return _raw_klines_to_dataframe(cached_raw)
            except Exception:
                pass

    # 2. Descarga paginada desde Binance Futures
    all_klines = []
    current_start = start_time
    max_retries = 3

    while current_start < end_time:
        url = f"{BINANCE_FUTURES_PUBLIC_KLINES}?symbol={symbol}&interval={interval}&startTime={current_start}&endTime={end_time}&limit=1500"
        chunk = None
        for _ in range(max_retries):
            try:
                req = urllib.request.Request(url, headers={'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64)'})
                with urllib.request.urlopen(req, timeout=10) as resp:
                    chunk = json.loads(resp.read().decode('utf-8'))
                    break
            except Exception:
                time.sleep(0.5)

        if not chunk:
            break
        all_klines.extend(chunk)
        last_close_time = chunk[-1][6]
        if last_close_time <= current_start:
            current_start += 1500 * _interval_to_seconds(interval) * 1000
        else:
            current_start = last_close_time + 1

        if len(chunk) < 1500:
            break

    if not all_klines:
        url_fallback = f"{BINANCE_FUTURES_PUBLIC_KLINES}?symbol={symbol}&interval={interval}&limit=1500"
        req = urllib.request.Request(url_fallback, headers={'User-Agent': 'Mozilla/5.0'})
        with urllib.request.urlopen(req, timeout=10) as resp:
            all_klines = json.loads(resp.read().decode('utf-8'))

    # Guardar en caché local
    try:
        with open(cache_file, 'w', encoding='utf-8') as f:
            json.dump(all_klines, f)
    except Exception:
        pass

    return _raw_klines_to_dataframe(all_klines)


def _interval_to_seconds(interval: str) -> int:
    unit = interval[-1]
    num = int(interval[:-1]) if len(interval) > 1 else 1
    if unit == 'm': return num * 60
    if unit == 'h': return num * 3600
    if unit == 'd': return num * 86400
    return 300


def _raw_klines_to_dataframe(raw_klines: list) -> pd.DataFrame:
    cols = ['open_time', 'open', 'high', 'low', 'close', 'volume', 
            'close_time', 'quote_volume', 'trades', 'taker_buy_base_volume', 
            'taker_buy_quote_volume', 'ignore']
    df = pd.DataFrame(raw_klines, columns=cols)
    for c in ['open', 'high', 'low', 'close', 'volume']:
        df[c] = pd.to_numeric(df[c], errors='coerce')
    df['open_time'] = pd.to_datetime(df['open_time'], unit='ms')
    df['close_time'] = pd.to_datetime(df['close_time'], unit='ms')
    df.sort_values('open_time', inplace=True)
    df.drop_duplicates('open_time', inplace=True)
    df.reset_index(drop=True, inplace=True)
    return df


def calculate_rsi(series: pd.Series, period: int = 14) -> pd.Series:
    delta = series.diff()
    gain = (delta.where(delta > 0, 0)).rolling(window=period).mean()
    loss = (-delta.where(delta < 0, 0)).rolling(window=period).mean()
    rs = gain / loss.replace(0, np.nan)
    rsi = 100 - (100 / (1 + rs))
    return rsi.fillna(50.0)


def _find_supports(df_window: pd.DataFrame, pivot_window: int = 5, confirmations: int = 2, tolerance_percent: float = 0.5) -> list:
    """Calcula soportes confirmados idéntico a la función en TradingBot."""
    if len(df_window) < (2 * pivot_window + 1):
        return []
    
    window_size = 2 * pivot_window + 1
    rolling_min = df_window['low'].rolling(window=window_size, center=True).min()
    pivot_lows = df_window[df_window['low'] == rolling_min]['low'].values

    if len(pivot_lows) < confirmations:
        return []

    groups = []
    for p in pivot_lows:
        found_group = False
        for grp in groups:
            avg_p = sum(grp) / len(grp)
            if avg_p > 0 and abs(p - avg_p) / avg_p <= (tolerance_percent / 100.0):
                grp.append(p)
                found_group = True
                break
        if not found_group:
            groups.append([p])

    confirmed = []
    for grp in groups:
        if len(grp) >= confirmations:
            confirmed.append(float(np.mean(grp)))

    return sorted(confirmed, reverse=True)


def normalize_config(cfg: dict) -> dict:
    """Normaliza claves de configuración aceptando tanto camelCase como snake_case."""
    if not cfg:
        return {}
    c = dict(cfg)
    
    def get_val(camel, snake, default=None):
        if camel in c and c[camel] is not None:
            return c[camel]
        if snake in c and c[snake] is not None:
            return c[snake]
        return default

    def to_bool(val, default=False):
        if val is None: return default
        if isinstance(val, bool): return val
        return str(val).strip().lower() in ('true', '1', 'yes')

    def to_float(val, default=0.0):
        try: return float(val)
        except (ValueError, TypeError): return default

    def to_int(val, default=0):
        try: return int(val)
        except (ValueError, TypeError): return default

    return {
        'leverage': to_int(get_val('leverage', 'leverage', 20), 20),
        'position_size_usdt': to_float(get_val('positionSizeUSDT', 'position_size_usdt', 50.0), 50.0),
        
        # Soportes
        'evaluate_support_strategy': to_bool(get_val('evaluateSupportStrategy', 'evaluate_support_strategy', False), False),
        'support_history_candles': to_int(get_val('supportHistoryCandles', 'support_history_candles', 60), 60),
        'support_pivot_window': to_int(get_val('supportPivotWindow', 'support_pivot_window', 5), 5),
        'support_confirmations': to_int(get_val('supportConfirmations', 'support_confirmations', 2), 2),
        'support_level_tolerance_percent': to_float(get_val('supportLevelTolerancePercent', 'support_level_tolerance_percent', 0.5), 0.5),
        'support_order_take_profit_percent': to_float(get_val('supportOrderTakeProfitPercent', 'support_order_take_profit_percent', 2.0), 2.0),
        'support_order_stop_loss_percent': to_float(get_val('supportOrderStopLossPercent', 'support_order_stop_loss_percent', 2.0), 2.0),

        # RSI
        'rsi_interval': str(get_val('rsiInterval', 'rsi_interval', '1m')),
        'rsi_period': to_int(get_val('rsiPeriod', 'rsi_period', 14), 14),
        'evaluate_rsi_delta': to_bool(get_val('evaluateRsiDelta', 'evaluate_rsi_delta', True), True),
        'rsi_threshold_up': to_float(get_val('rsiThresholdUp', 'rsi_threshold_up', 1.0), 1.0),
        'evaluate_rsi_range': to_bool(get_val('evaluateRsiRange', 'evaluate_rsi_range', True), True),
        'rsi_entry_level_low': to_float(get_val('rsiEntryLevelLow', 'rsi_entry_level_low', 30.0), 30.0),
        'rsi_entry_level_high': to_float(get_val('rsiEntryLevelHigh', 'rsi_entry_level_high', 75.0), 75.0),

        # Filtro Volumen
        'evaluate_volume_filter': to_bool(get_val('evaluateVolumeFilter', 'evaluate_volume_filter', False), False),
        'volume_factor': to_float(get_val('volumeFactor', 'volume_factor', 1.0), 1.0),
        'volume_sma_period': to_int(get_val('volumeSmaPeriod', 'volume_sma_period', 20), 20),

        # Filtro MA
        'evaluate_ma_filter': to_bool(get_val('evaluateMaFilter', 'evaluate_ma_filter', False), False),
        'ma_period': to_int(get_val('maPeriod', 'ma_period', 25), 25),
        'ma_type': str(get_val('maType', 'ma_type', 'EMA')).upper(),

        # Filtro Velas Alcistas
        'evaluate_required_uptrend': to_bool(get_val('evaluateRequiredUptrend', 'evaluate_required_uptrend', False), False),
        'required_uptrend_candles': to_int(get_val('requiredUptrendCandles', 'required_uptrend_candles', 0), 0),

        # Salidas Fijas
        'enable_take_profit_pnl': to_bool(get_val('enableTakeProfitPnl', 'enable_take_profit_pnl', True), True),
        'take_profit_usdt': to_float(get_val('takeProfitUSDT', 'take_profit_usdt', 2.0), 2.0),
        'enable_stop_loss_pnl': to_bool(get_val('enableStopLossPnl', 'enable_stop_loss_pnl', False), False),
        'stop_loss_usdt': to_float(get_val('stopLossUSDT', 'stop_loss_usdt', 0.5), 0.5),

        # Trailing RSI
        'enable_trailing_rsi_stop': to_bool(get_val('enableTrailingRsiStop', 'enable_trailing_rsi_stop', False), False),
        'rsi_target': to_float(get_val('rsiTarget', 'rsi_target', 50.0), 50.0),
        'rsi_threshold_down': to_float(get_val('rsiThresholdDown', 'rsi_threshold_down', 1.0), 1.0),

        # Trailing PnL
        'enable_pnl_trailing_stop': to_bool(get_val('enablePnlTrailingStop', 'enable_pnl_trailing_stop', False), False),
        'pnl_trailing_stop_activation_usdt': to_float(get_val('pnlTrailingStopActivationUSDT', 'pnl_trailing_stop_activation_usdt', 1.0), 1.0),
        'pnl_trailing_stop_drop_usdt': to_float(get_val('pnlTrailingStopDropUSDT', 'pnl_trailing_stop_drop_usdt', 0.3), 0.3),

        # Trailing Precio
        'enable_price_trailing_stop': to_bool(get_val('enablePriceTrailingStop', 'enable_price_trailing_stop', False), False),
        'price_trailing_stop_distance_usdt': to_float(get_val('priceTrailingStopDistanceUSDT', 'price_trailing_stop_distance_usdt', 0.05), 0.05),
        'price_trailing_stop_activation_pnl_usdt': to_float(get_val('priceTrailingStopActivationPnlUSDT', 'price_trailing_stop_activation_pnl_usdt', 0.0), 0.0),

        # DCA Re-entradas
        'enable_dca_reentry': to_bool(get_val('enableDcaReentry', 'enable_dca_reentry', False), False),
        'dca_reentry_mode': str(get_val('dcaReentryMode', 'dca_reentry_mode', 'fixed_percent')),
        'dca_price_drop_percent': to_float(get_val('dcaPriceDropPercent', 'dca_price_drop_percent', 1.5), 1.5),
        'dca_max_reentries': to_int(get_val('dcaMaxReentries', 'dca_max_reentries', 2), 2),
        'dca_volume_multiplier': to_float(get_val('dcaVolumeMultiplier', 'dca_volume_multiplier', 1.0), 1.0),

        'symbols_to_trade': str(get_val('symbolsToTrade', 'symbols_to_trade', ''))
    }


def run_strategy_backtest(symbol: str, df: pd.DataFrame, config: dict, initial_balance: float = 1000.0) -> dict:
    """
    Ejecuta una simulación completa vela por vela reproduciendo con exactitud:
    - Soportes o Estrategia RSI con rango, delta, volumen, MA y tendencia
    - Salidas Take Profit y Stop Loss (respetando si SL está desactivado)
    - Trailing Stop por PnL, Trailing Stop por RSI y Trailing Stop por Precio
    - Re-entradas DCA con ajuste dinámico de precio promedio ponderado
    - Comisiones de Binance Futures (0.02% Maker, 0.04% Taker)
    """
    if df is None or len(df) < 50:
        return {"error": "Insuficientes datos de mercado para el backtest."}

    c = normalize_config(config)
    leverage = c['leverage']
    position_size_usdt = c['position_size_usdt']
    evaluate_support = c['evaluate_support_strategy']

    # Precalcular indicadores en vectores numpy para máxima velocidad
    df['rsi'] = calculate_rsi(df['close'], period=c['rsi_period'])
    
    if c['evaluate_volume_filter']:
        vol_sma = df['volume'].rolling(window=c['volume_sma_period']).mean().values
    else:
        vol_sma = None

    if c['evaluate_ma_filter']:
        if c['ma_type'] == 'EMA':
            ma = df['close'].ewm(span=c['ma_period'], adjust=False).mean().values
        else:
            ma = df['close'].rolling(window=c['ma_period']).mean().values
    else:
        ma = None

    is_green = (df['close'] > df['open']).values
    opens = df['open'].values
    highs = df['high'].values
    lows = df['low'].values
    closes = df['close'].values
    volumes = df['volume'].values
    rsis = df['rsi'].values
    times = df['open_time'].astype(str).values
    n_candles = len(df)

    balance = initial_balance
    peak_balance = initial_balance
    max_drawdown_usdt = 0.0
    max_drawdown_pct = 0.0

    in_position = False
    entry_price = 0.0
    quantity = 0.0
    entry_time = None
    dca_count = 0
    peak_unrealized_pnl = 0.0
    pnl_trailing_armed = False
    rsi_trailing_armed = False
    rsi_peak = 0.0
    peak_price = 0.0
    price_trailing_armed = False

    trades_list = []
    equity_curve = [{'time': times[0], 'equity': round(initial_balance, 2), 'pnl': 0.0}]

    start_idx = max(50, c['support_history_candles'] if evaluate_support else c['rsi_period'] + 15)

    for i in range(start_idx, n_candles):
        c_open = opens[i]
        c_high = highs[i]
        c_low = lows[i]
        c_close = closes[i]
        c_time = times[i]

        if not in_position:
            entry_signal = False
            signal_price = c_open

            if evaluate_support:
                window_df = df.iloc[max(0, i - c['support_history_candles']): i]
                supports = _find_supports(window_df, c['support_pivot_window'], c['support_confirmations'], c['support_level_tolerance_percent'])
                if supports:
                    best_support = supports[0]
                    if c_low <= best_support <= c_high or (c_open >= best_support >= c_low):
                        entry_signal = True
                        signal_price = best_support
            else:
                curr_rsi = rsis[i - 1]
                prev_rsi = rsis[i - 2] if i >= 2 else curr_rsi

                # 1. Rango RSI
                if c['evaluate_rsi_range'] and not (c['rsi_entry_level_low'] <= curr_rsi <= c['rsi_entry_level_high']):
                    continue

                # 2. Delta RSI
                if c['evaluate_rsi_delta'] and not ((curr_rsi - prev_rsi) >= c['rsi_threshold_up']):
                    continue

                # 3. Filtro Volumen
                if c['evaluate_volume_filter']:
                    vs = vol_sma[i - 1]
                    if np.isnan(vs) or volumes[i - 1] <= vs * c['volume_factor']:
                        continue

                # 4. Filtro MA
                if c['evaluate_ma_filter']:
                    mv = ma[i - 1]
                    if np.isnan(mv) or c_open <= mv:
                        continue

                # 5. Velas Verdes Requeridas
                if c['evaluate_required_uptrend'] and c['required_uptrend_candles'] > 0:
                    req_n = c['required_uptrend_candles']
                    if not np.all(is_green[max(0, i - req_n): i]):
                        continue

                entry_signal = True
                signal_price = c_open

            if entry_signal and signal_price > 0:
                in_position = True
                entry_price = signal_price
                quantity = position_size_usdt / entry_price
                entry_time = c_time
                dca_count = 0
                peak_unrealized_pnl = 0.0
                pnl_trailing_armed = False
                rsi_trailing_armed = False
                rsi_peak = rsis[i - 1]
                peak_price = entry_price
                price_trailing_armed = False

        else:
            # En posición: calcular PnL y chequear salidas
            unrealized_pnl = (c_close - entry_price) * quantity
            high_pnl = (c_high - entry_price) * quantity
            if high_pnl > peak_unrealized_pnl:
                peak_unrealized_pnl = high_pnl

            if c_high > peak_price:
                peak_price = c_high

            curr_rsi = rsis[i - 1]
            if curr_rsi > rsi_peak:
                rsi_peak = curr_rsi

            # Armar trailings
            if c['enable_pnl_trailing_stop'] and high_pnl >= c['pnl_trailing_stop_activation_usdt']:
                pnl_trailing_armed = True

            if c['enable_trailing_rsi_stop'] and curr_rsi >= c['rsi_target']:
                rsi_trailing_armed = True

            if c['enable_price_trailing_stop'] and (peak_price - entry_price) * quantity >= c['price_trailing_stop_activation_pnl_usdt']:
                price_trailing_armed = True

            # Precios objetivos
            if evaluate_support:
                tp_price = entry_price * (1.0 + c['support_order_take_profit_percent'] / 100.0)
                sl_price = entry_price * (1.0 - c['support_order_stop_loss_percent'] / 100.0)
            else:
                tp_price = (entry_price + (c['take_profit_usdt'] / quantity)) if (c['enable_take_profit_pnl'] and c['take_profit_usdt'] > 0) else None
                sl_price = (entry_price - (abs(c['stop_loss_usdt']) / quantity)) if (c['enable_stop_loss_pnl'] and c['stop_loss_usdt'] > 0) else None

            exit_triggered = False
            exit_price = 0.0
            exit_reason = ''
            is_taker = False

            # 1. Take Profit
            if tp_price and c_high >= tp_price:
                exit_triggered = True
                exit_price = tp_price
                exit_reason = f'Take Profit (+{c["support_order_take_profit_percent"]}%' if evaluate_support else f'Take Profit (+${c["take_profit_usdt"]})'
                is_taker = False
            
            # 2. Trailing PnL Exit
            elif pnl_trailing_armed and (peak_unrealized_pnl - unrealized_pnl) >= c['pnl_trailing_stop_drop_usdt']:
                exit_triggered = True
                exit_price = c_close
                exit_reason = 'Trailing Stop PnL'
                is_taker = True

            # 3. Trailing RSI Exit
            elif rsi_trailing_armed and curr_rsi <= (rsi_peak - abs(c['rsi_threshold_down'])):
                exit_triggered = True
                exit_price = c_close
                exit_reason = 'Trailing Stop RSI'
                is_taker = True

            # 4. Trailing Precio Exit
            elif price_trailing_armed and c_low <= (peak_price - c['price_trailing_stop_distance_usdt']):
                exit_triggered = True
                exit_price = peak_price - c['price_trailing_stop_distance_usdt']
                exit_reason = 'Trailing Stop Precio'
                is_taker = True

            # 5. DCA Re-entradas
            elif c['enable_dca_reentry'] and dca_count < c['dca_max_reentries']:
                target_dca_price = entry_price * (1.0 - c['dca_price_drop_percent'] / 100.0)
                if c_low <= target_dca_price:
                    dca_count += 1
                    added_qty = (position_size_usdt * (c['dca_volume_multiplier'] ** dca_count)) / target_dca_price
                    total_cost = (entry_price * quantity) + (target_dca_price * added_qty)
                    quantity += added_qty
                    entry_price = total_cost / quantity

            # 6. Stop Loss (solo si está activado)
            elif sl_price and c_low <= sl_price:
                exit_triggered = True
                exit_price = sl_price
                exit_reason = f'Stop Loss (-{c["support_order_stop_loss_percent"]}%)' if evaluate_support else f'Stop Loss (-${abs(c["stop_loss_usdt"])})'
                is_taker = True

            if exit_triggered:
                gross_pnl = (exit_price - entry_price) * quantity
                entry_fee = (entry_price * quantity) * 0.0002
                exit_fee = (exit_price * quantity) * (0.0004 if is_taker else 0.0002)
                total_fees = entry_fee + exit_fee
                net_pnl = gross_pnl - total_fees
                
                balance += net_pnl
                if balance > peak_balance:
                    peak_balance = balance
                
                dd = peak_balance - balance
                if dd > max_drawdown_usdt:
                    max_drawdown_usdt = dd
                dd_pct = (dd / peak_balance * 100.0) if peak_balance > 0 else 0.0
                if dd_pct > max_drawdown_pct:
                    max_drawdown_pct = dd_pct

                margin_req = (entry_price * quantity) / leverage if leverage > 0 else 1.0
                ret_pct = (net_pnl / margin_req) * 100.0

                trades_list.append({
                    'id': len(trades_list) + 1,
                    'symbol': symbol,
                    'open_time': entry_time,
                    'close_time': c_time,
                    'entry_price': round(float(entry_price), 4),
                    'exit_price': round(float(exit_price), 4),
                    'quantity': round(float(quantity), 4),
                    'position_size_usdt': round(float(entry_price * quantity), 2),
                    'margin_usdt': round(float(margin_req), 2),
                    'gross_pnl': round(float(gross_pnl), 4),
                    'fees': round(float(total_fees), 4),
                    'net_pnl': round(float(net_pnl), 4),
                    'return_pct': round(float(ret_pct), 2),
                    'exit_reason': exit_reason,
                    'dca_reentries': dca_count
                })

                equity_curve.append({
                    'time': c_time,
                    'equity': round(float(balance), 2),
                    'pnl': round(float(balance - initial_balance), 2)
                })

                in_position = False

    total_trades = len(trades_list)
    wins = [t for t in trades_list if t['net_pnl'] > 0]
    losses = [t for t in trades_list if t['net_pnl'] <= 0]
    
    win_rate = (len(wins) / total_trades * 100.0) if total_trades > 0 else 0.0
    gross_profit = sum(t['net_pnl'] for t in wins)
    gross_loss = abs(sum(t['net_pnl'] for t in losses))
    profit_factor = (gross_profit / gross_loss) if gross_loss > 0 else (gross_profit if gross_profit > 0 else 1.0)
    
    avg_win = (gross_profit / len(wins)) if wins else 0.0
    avg_loss = (gross_loss / len(losses)) if losses else 0.0
    rr_ratio = (avg_win / avg_loss) if avg_loss > 0 else (avg_win if avg_win > 0 else 1.0)

    total_fees_paid = sum(t['fees'] for t in trades_list)
    net_pnl_total = balance - initial_balance
    net_return_pct = (net_pnl_total / initial_balance) * 100.0

    if len(equity_curve) > 100:
        step = max(1, len(equity_curve) // 100)
        downsampled_curve = [equity_curve[idx] for idx in range(0, len(equity_curve), step)]
        if equity_curve[-1] not in downsampled_curve:
            downsampled_curve.append(equity_curve[-1])
        equity_curve = downsampled_curve

    start_dt_str = str(df['open_time'].iloc[0]).split(' ')[0]
    end_dt_str = str(df['open_time'].iloc[-1]).split(' ')[0]

    return {
        'symbol': symbol,
        'days_tested': max(1, int((df['open_time'].iloc[-1] - df['open_time'].iloc[0]).total_seconds() / 86400)),
        'start_date': start_dt_str,
        'end_date': end_dt_str,
        'period_label': f"{start_dt_str} al {end_dt_str}",
        'total_candles': len(df),
        'initial_balance': round(float(initial_balance), 2),
        'final_balance': round(float(balance), 2),
        'net_pnl': round(float(net_pnl_total), 2),
        'net_return_pct': round(float(net_return_pct), 2),
        'total_trades': total_trades,
        'winning_trades': len(wins),
        'losing_trades': len(losses),
        'win_rate_pct': round(float(win_rate), 1),
        'profit_factor': round(float(profit_factor), 2),
        'max_drawdown_usdt': round(float(max_drawdown_usdt), 2),
        'max_drawdown_pct': round(float(max_drawdown_pct), 2),
        'avg_trade_pnl': round(float(net_pnl_total / total_trades), 2) if total_trades > 0 else 0.0,
        'risk_reward_ratio': round(float(rr_ratio), 2),
        'total_fees_usdt': round(float(total_fees_paid), 2),
        'equity_curve': equity_curve,
        'trades': trades_list
    }


def run_portfolio_backtest(symbols: list, interval: str = '5m', days: int = 14, start_date: str = None, end_date: str = None, config: dict = None, initial_balance_per_coin: float = 1000.0) -> dict:
    """
    Ejecuta el backtest sobre todo un portafolio de múltiples monedas de forma simultánea.
    Consolida PnL global, Win Rate del portafolio, curva de capital combinada y ranking ordenado por rentabilidad.
    """
    if config is None:
        config = {}

    norm_cfg = normalize_config(config)

    # Si no se pasaron símbolos o se pasó PORTFOLIO, usar los símbolos configurados en la estrategia
    if not symbols or symbols == ['PORTFOLIO'] or symbols == ['ALL']:
        st_syms = norm_cfg.get('symbols_to_trade', '')
        if st_syms:
            symbols = [s.strip().upper() for s in st_syms.split(',') if s.strip()]
        else:
            symbols = ["SOLUSDT", "DOGEUSDT", "OPUSDT", "SUIUSDT", "NEARUSDT", "ADAUSDT", "ONDOUSDT", "ARBUSDT"]

    if not symbols:
        return {"error": "No se especificaron monedas para el backtest de portafolio."}

    individual_results = []
    all_trades = []
    total_candles = 0

    for sym in symbols:
        try:
            df = get_historical_klines_paginated(sym, interval=interval, days=days, start_date=start_date, end_date=end_date, use_cache=True)
            if df is not None and len(df) >= 50:
                res = run_strategy_backtest(sym, df, config, initial_balance=initial_balance_per_coin)
                if 'error' not in res:
                    individual_results.append(res)
                    total_candles += res.get('total_candles', 0)
                    for t in res.get('trades', []):
                        t['symbol'] = sym
                        all_trades.append(t)
        except Exception:
            continue

    if not individual_results:
        return {"error": "No se pudieron obtener datos válidos para ninguna de las monedas del portafolio."}

    total_initial_balance = initial_balance_per_coin * len(individual_results)
    total_net_pnl = sum(r['net_pnl'] for r in individual_results)
    total_final_balance = total_initial_balance + total_net_pnl
    total_return_pct = (total_net_pnl / total_initial_balance * 100.0) if total_initial_balance > 0 else 0.0

    total_trades = sum(r['total_trades'] for r in individual_results)
    total_wins = sum(r['winning_trades'] for r in individual_results)
    total_losses = sum(r['losing_trades'] for r in individual_results)
    global_win_rate = (total_wins / total_trades * 100.0) if total_trades > 0 else 0.0

    gross_profit = sum(t['net_pnl'] for t in all_trades if t['net_pnl'] > 0)
    gross_loss = abs(sum(t['net_pnl'] for t in all_trades if t['net_pnl'] <= 0))
    global_profit_factor = (gross_profit / gross_loss) if gross_loss > 0 else (gross_profit if gross_profit > 0 else 1.0)

    total_fees = sum(r['total_fees_usdt'] for r in individual_results)

    all_trades.sort(key=lambda x: str(x.get('close_time', '')))
    for idx, t in enumerate(all_trades, 1):
        t['id'] = idx

    equity_curve = [{"time": all_trades[0]['open_time'] if all_trades else "Inicio", "equity": round(total_initial_balance, 2), "pnl": 0.0}]
    curr_balance = total_initial_balance
    peak_balance = total_initial_balance
    max_dd_usdt = 0.0
    max_dd_pct = 0.0

    for t in all_trades:
        curr_balance += t['net_pnl']
        if curr_balance > peak_balance:
            peak_balance = curr_balance
        dd = peak_balance - curr_balance
        if dd > max_dd_usdt:
            max_dd_usdt = dd
        dd_p = (dd / peak_balance * 100.0) if peak_balance > 0 else 0.0
        if dd_p > max_dd_pct:
            max_dd_pct = dd_p
        equity_curve.append({
            "time": t['close_time'],
            "equity": round(curr_balance, 2),
            "pnl": round(curr_balance - total_initial_balance, 2)
        })

    if len(equity_curve) > 100:
        step = max(1, len(equity_curve) // 100)
        downsampled_curve = [equity_curve[i] for i in range(0, len(equity_curve), step)]
        if equity_curve[-1] not in downsampled_curve:
            downsampled_curve.append(equity_curve[-1])
        equity_curve = downsampled_curve

    ranking = []
    for r in individual_results:
        ranking.append({
            "symbol": r['symbol'],
            "net_pnl": r['net_pnl'],
            "net_return_pct": r['net_return_pct'],
            "win_rate_pct": r['win_rate_pct'],
            "total_trades": r['total_trades'],
            "winning_trades": r['winning_trades'],
            "losing_trades": r['losing_trades'],
            "profit_factor": r['profit_factor'],
            "max_drawdown_pct": r['max_drawdown_pct'],
            "total_fees_usdt": r['total_fees_usdt']
        })

    ranking.sort(key=lambda x: x['net_pnl'], reverse=True)

    return {
        "is_portfolio": True,
        "symbol": "PORTFOLIO",
        "symbols_count": len(individual_results),
        "symbols_list": [r['symbol'] for r in individual_results],
        "days_tested": individual_results[0].get('days_tested', days) if individual_results else days,
        "start_date": individual_results[0].get('start_date') if individual_results else start_date,
        "end_date": individual_results[0].get('end_date') if individual_results else end_date,
        "period_label": individual_results[0].get('period_label') if individual_results else (f"{start_date} al {end_date}" if start_date else f"{days} días"),
        "total_candles": total_candles,
        "initial_balance": round(total_initial_balance, 2),
        "final_balance": round(total_final_balance, 2),
        "net_pnl": round(total_net_pnl, 2),
        "net_return_pct": round(total_return_pct, 2),
        "total_trades": total_trades,
        "winning_trades": total_wins,
        "losing_trades": total_losses,
        "win_rate_pct": round(global_win_rate, 1),
        "profit_factor": round(global_profit_factor, 2),
        "max_drawdown_usdt": round(max_dd_usdt, 2),
        "max_drawdown_pct": round(max_dd_pct, 2),
        "avg_trade_pnl": round(total_net_pnl / total_trades, 2) if total_trades > 0 else 0.0,
        "risk_reward_ratio": round(gross_profit / max(1.0, gross_loss), 2),
        "total_fees_usdt": round(total_fees, 2),
        "symbols_ranking": ranking,
        "equity_curve": equity_curve,
        "trades": all_trades
    }

