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


def get_historical_klines_paginated(symbol: str, interval: str = '5m', days: int = 14, use_cache: bool = True) -> pd.DataFrame:
    """
    Descarga datos históricos de velas de Binance Futures paginando hasta cubrir los días solicitados.
    Utiliza caché local en disco para que las pruebas posteriores sean instantáneas (menos de 0.1s).
    """
    symbol = symbol.upper().strip()
    cache_file = os.path.join(CACHE_DIR, f"{symbol}_{interval}_{days}d.json")

    # 1. Verificar si la caché existe y no tiene más de 3 horas
    if use_cache and os.path.exists(cache_file):
        file_age = time.time() - os.path.getmtime(cache_file)
        if file_age < 3 * 3600:
            try:
                with open(cache_file, 'r', encoding='utf-8') as f:
                    cached_raw = json.load(f)
                if cached_raw and len(cached_raw) > 50:
                    return _raw_klines_to_dataframe(cached_raw)
            except Exception:
                pass

    # 2. Descarga paginada desde Binance Futures
    end_time = int(time.time() * 1000)
    start_time = int((datetime.utcnow() - timedelta(days=days)).timestamp() * 1000)
    
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


def run_strategy_backtest(symbol: str, df: pd.DataFrame, config: dict, initial_balance: float = 1000.0) -> dict:
    """
    Ejecuta una simulación completa vela por vela reproduciendo con exactitud:
    - Soportes / RSI
    - Entradas LIMIT BUY
    - Salidas Take Profit y Stop Loss
    - Re-entradas DCA y ajuste dinámico de precio promedio
    - Trailing Stop por PnL
    - Comisiones de Binance Futures (0.02% Maker, 0.04% Taker)
    """
    if df is None or len(df) < 50:
        return {"error": "Insuficientes datos de mercado para el backtest."}

    leverage = int(config.get('leverage', 20) or 20)
    position_size_usdt = float(config.get('positionSizeUSDT', config.get('position_size_usdt', 50)) or 50)
    
    evaluate_support = str(config.get('evaluate_support_strategy', 'true')).lower() in ('true', '1')
    support_history_candles = int(config.get('support_history_candles', 200) or 200)
    support_pivot_window = int(config.get('support_pivot_window', 5) or 5)
    support_confirmations = int(config.get('support_confirmations', 2) or 2)
    support_tolerance_pct = float(config.get('support_level_tolerance_percent', 0.5) or 0.5)
    support_tp_pct = float(config.get('support_order_take_profit_percent', 4.0) or 4.0)
    support_sl_pct = float(config.get('support_order_stop_loss_percent', 2.0) or 2.0)

    rsi_period = int(config.get('rsi_period', 14) or 14)
    rsi_threshold_up = float(config.get('rsi_threshold_up', 1.0) or 1.0)
    rsi_entry_low = float(config.get('rsi_entry_level_low', 30.0) or 30.0)

    enable_dca = str(config.get('enable_dca_reentry', 'true')).lower() in ('true', '1')
    dca_drop_pct = float(config.get('dca_price_drop_percent', 1.5) or 1.5)
    dca_max = int(config.get('dca_max_reentries', 2) or 2)
    dca_vol_mult = float(config.get('dca_volume_multiplier', 1.0) or 1.0)

    enable_trailing = str(config.get('enable_pnl_trailing_stop', 'false')).lower() in ('true', '1')
    trailing_activation_usdt = float(config.get('pnl_trailing_stop_activation_usdt', 1.0) or 1.0)
    trailing_drop_usdt = float(config.get('pnl_trailing_stop_drop_usdt', 0.3) or 0.3)

    # Precalcular RSI
    df['rsi'] = calculate_rsi(df['close'], period=rsi_period)

    balance = initial_balance
    peak_balance = initial_balance
    max_drawdown_usdt = 0.0
    max_drawdown_pct = 0.0

    in_position = False
    entry_price = 0.0
    quantity = 0.0
    entry_time = None
    dca_count = 0
    tp_price = 0.0
    sl_price = 0.0
    peak_unrealized_pnl = 0.0
    trailing_armed = False

    trades_list = []
    equity_curve = [{'time': str(df['open_time'].iloc[0]), 'equity': round(initial_balance, 2), 'pnl': 0.0}]

    start_idx = min(len(df) - 1, max(support_history_candles, 50))

    for i in range(start_idx, len(df)):
        candle = df.iloc[i]
        c_open = float(candle['open'])
        c_high = float(candle['high'])
        c_low = float(candle['low'])
        c_close = float(candle['close'])
        c_time = str(candle['open_time'])

        if not in_position:
            signal_entry_price = None

            if evaluate_support:
                window_df = df.iloc[max(0, i - support_history_candles): i]
                supports = _find_supports(window_df, support_pivot_window, support_confirmations, support_tolerance_pct)
                if supports:
                    best_support = supports[0]
                    if c_low <= best_support <= c_high or (c_open >= best_support >= c_low):
                        signal_entry_price = best_support
            else:
                prev_rsi = float(df['rsi'].iloc[i - 2]) if i >= 2 else 50.0
                curr_rsi = float(df['rsi'].iloc[i - 1])
                if curr_rsi <= rsi_entry_low and (curr_rsi - prev_rsi) >= rsi_threshold_up:
                    signal_entry_price = c_open

            if signal_entry_price and signal_entry_price > 0:
                in_position = True
                entry_price = signal_entry_price
                quantity = position_size_usdt / entry_price
                entry_time = c_time
                dca_count = 0
                peak_unrealized_pnl = 0.0
                trailing_armed = False

                if evaluate_support:
                    tp_price = entry_price * (1.0 + support_tp_pct / 100.0)
                    sl_price = entry_price * (1.0 - support_sl_pct / 100.0)
                else:
                    tp_usdt = float(config.get('takeProfitUSDT', config.get('take_profit_usdt', 2.0)) or 2.0)
                    sl_usdt = float(config.get('stopLossUSDT', config.get('stop_loss_usdt', 1.5)) or 1.5)
                    tp_price = entry_price + (tp_usdt / quantity) if quantity > 0 else entry_price * 1.02
                    sl_price = entry_price - (sl_usdt / quantity) if quantity > 0 else entry_price * 0.98

        else:
            high_pnl = (c_high - entry_price) * quantity
            if high_pnl > peak_unrealized_pnl:
                peak_unrealized_pnl = high_pnl

            if enable_trailing and high_pnl >= trailing_activation_usdt:
                trailing_armed = True

            exit_triggered = False
            exit_price = 0.0
            exit_reason = ''
            is_taker = False

            if c_high >= tp_price:
                exit_triggered = True
                exit_price = tp_price
                exit_reason = f'Take Profit (+{support_tp_pct if evaluate_support else "TP"}%)'
                is_taker = False
            elif c_low <= sl_price:
                exit_triggered = True
                exit_price = sl_price
                exit_reason = f'Stop Loss (-{support_sl_pct if evaluate_support else "SL"}%)'
                is_taker = True
            elif trailing_armed and (peak_unrealized_pnl - ((c_close - entry_price) * quantity)) >= trailing_drop_usdt:
                exit_triggered = True
                exit_price = c_close
                exit_reason = 'Trailing Stop PnL'
                is_taker = True
            elif enable_dca and dca_count < dca_max:
                target_dca_price = entry_price * (1.0 - dca_drop_pct / 100.0)
                if c_low <= target_dca_price:
                    dca_count += 1
                    added_qty = (position_size_usdt * (dca_vol_mult ** dca_count)) / target_dca_price
                    total_cost = (entry_price * quantity) + (target_dca_price * added_qty)
                    quantity += added_qty
                    entry_price = total_cost / quantity
                    if evaluate_support:
                        tp_price = entry_price * (1.0 + support_tp_pct / 100.0)
                        sl_price = entry_price * (1.0 - support_sl_pct / 100.0)

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
                    'entry_price': round(entry_price, 4),
                    'exit_price': round(exit_price, 4),
                    'quantity': round(quantity, 4),
                    'position_size_usdt': round(entry_price * quantity, 2),
                    'margin_usdt': round(margin_req, 2),
                    'gross_pnl': round(gross_pnl, 4),
                    'fees': round(total_fees, 4),
                    'net_pnl': round(net_pnl, 4),
                    'return_pct': round(ret_pct, 2),
                    'exit_reason': exit_reason,
                    'dca_reentries': dca_count
                })

                equity_curve.append({
                    'time': c_time,
                    'equity': round(balance, 2),
                    'pnl': round(balance - initial_balance, 2)
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

    return {
        'symbol': symbol,
        'days_tested': int((df['open_time'].iloc[-1] - df['open_time'].iloc[0]).total_seconds() / 86400),
        'total_candles': len(df),
        'initial_balance': round(initial_balance, 2),
        'final_balance': round(balance, 2),
        'net_pnl': round(net_pnl_total, 2),
        'net_return_pct': round(net_return_pct, 2),
        'total_trades': total_trades,
        'winning_trades': len(wins),
        'losing_trades': len(losses),
        'win_rate_pct': round(win_rate, 1),
        'profit_factor': round(profit_factor, 2),
        'max_drawdown_usdt': round(max_drawdown_usdt, 2),
        'max_drawdown_pct': round(max_drawdown_pct, 2),
        'avg_trade_pnl': round(net_pnl_total / total_trades, 2) if total_trades > 0 else 0.0,
        'risk_reward_ratio': round(rr_ratio, 2),
        'total_fees_usdt': round(total_fees_paid, 2),
        'equity_curve': equity_curve,
        'trades': trades_list
    }
