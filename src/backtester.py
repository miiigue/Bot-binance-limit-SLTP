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

    start_dt_str = str(df['open_time'].iloc[0]).split(' ')[0]
    end_dt_str = str(df['open_time'].iloc[-1]).split(' ')[0]

    return {
        'symbol': symbol,
        'days_tested': max(1, int((df['open_time'].iloc[-1] - df['open_time'].iloc[0]).total_seconds() / 86400)),
        'start_date': start_dt_str,
        'end_date': end_dt_str,
        'period_label': f"{start_dt_str} al {end_dt_str}",
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


def run_portfolio_backtest(symbols: list, interval: str = '5m', days: int = 14, start_date: str = None, end_date: str = None, config: dict = None, initial_balance_per_coin: float = 1000.0) -> dict:
    """
    Ejecuta el backtest sobre todo un portafolio de múltiples monedas de forma simultánea.
    Consolida PnL global, Win Rate del portafolio, curva de capital combinada y ranking ordenado por rentabilidad.
    """
    if not symbols:
        return {"error": "No se especificaron monedas para el backtest de portafolio."}
    if config is None:
        config = {}

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

