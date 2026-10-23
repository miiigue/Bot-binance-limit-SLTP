"""
Módulo de Análisis Cuantitativo de Caídas, Rebotes y Optimización de Stop Loss (Dip & Bounce Lab).
Calcula las distribuciones de caídas y recuperaciones a partir de velas históricas reales de Binance,
determinando el Stop Loss Antirruido (Percentil 95) para evitar liquidaciones por volatilidad normal.
"""

import math
from datetime import datetime
import pandas as pd
from src.logger_setup import get_logger
from src.binance_client import get_historical_klines

def _calculate_percentile(sorted_data: list, p: float) -> float:
    """Calcula el percentil p (0..100) en una lista ordenada usando interpolación lineal."""
    if not sorted_data:
        return 0.0
    if len(sorted_data) == 1:
        return float(sorted_data[0])
    k = (len(sorted_data) - 1) * (p / 100.0)
    f = math.floor(k)
    c = math.ceil(k)
    if f == c:
        return float(sorted_data[int(k)])
    d0 = sorted_data[int(f)] * (c - k)
    d1 = sorted_data[int(c)] * (k - f)
    return float(d0 + d1)

def analyze_single_symbol_swings(
    symbol: str,
    interval: str = '15m',
    limit: int = 500,
    start_time=None,
    end_time=None,
    min_swing_pct: float = 1.0,
    margin_usdt: float = 50.0,
    leverage: int = 10
) -> dict:
    """
    Analiza una moneda individual detectando picos (peaks) y valles (troughs)
    para medir caídas, rebotes y parámetros óptimos de Stop Loss y Take Profit.
    """
    logger = get_logger()
    clean_sym = symbol.upper().strip()

    try:
        df = get_historical_klines(clean_sym, interval, limit=limit, start_time=start_time, end_time=end_time)
        if df is None or len(df) < 15:
            return {
                "symbol": clean_sym,
                "error": f"Datos insuficientes para {clean_sym} ({len(df) if df is not None else 0} velas)."
            }

        highs = [float(x) for x in df['high']]
        lows = [float(x) for x in df['low']]
        closes = [float(x) for x in df['close']]
        times = [str(x) for x in df['open_time']]
        n = len(df)

        # ---------------------------------------------------------------------
        # Algoritmo Cuantitativo ZigZag (Peak & Trough Detection)
        # ---------------------------------------------------------------------
        swings = []
        trend = 0  # 1: alcista (buscando pico), -1: bajista (buscando fondo)
        cur_extreme = closes[0]
        cur_extreme_idx = 0

        for i in range(1, n):
            h = highs[i]
            l = lows[i]

            if trend == 0:
                if h >= cur_extreme * (1.0 + min_swing_pct / 100.0):
                    trend = 1
                    cur_extreme = h
                    cur_extreme_idx = i
                elif l <= cur_extreme * (1.0 - min_swing_pct / 100.0):
                    trend = -1
                    cur_extreme = l
                    cur_extreme_idx = i
            elif trend == 1:
                if h > cur_extreme:
                    cur_extreme = h
                    cur_extreme_idx = i
                elif l <= cur_extreme * (1.0 - min_swing_pct / 100.0):
                    swings.append({
                        'type': 'PEAK',
                        'idx': cur_extreme_idx,
                        'price': cur_extreme,
                        'time': times[cur_extreme_idx]
                    })
                    trend = -1
                    cur_extreme = l
                    cur_extreme_idx = i
            elif trend == -1:
                if l < cur_extreme:
                    cur_extreme = l
                    cur_extreme_idx = i
                elif h >= cur_extreme * (1.0 + min_swing_pct / 100.0):
                    swings.append({
                        'type': 'TROUGH',
                        'idx': cur_extreme_idx,
                        'price': cur_extreme,
                        'time': times[cur_extreme_idx]
                    })
                    trend = 1
                    cur_extreme = h
                    cur_extreme_idx = i

        # Registrar último extremo confirmado
        if trend == 1 and cur_extreme > 0:
            swings.append({'type': 'PEAK', 'idx': cur_extreme_idx, 'price': cur_extreme, 'time': times[cur_extreme_idx]})
        elif trend == -1 and cur_extreme > 0:
            swings.append({'type': 'TROUGH', 'idx': cur_extreme_idx, 'price': cur_extreme, 'time': times[cur_extreme_idx]})

        drops = []
        bounces = []

        for i in range(len(swings) - 1):
            s1 = swings[i]
            s2 = swings[i + 1]
            if s1['type'] == 'PEAK' and s2['type'] == 'TROUGH':
                d_pct = (s1['price'] - s2['price']) / s1['price'] * 100.0
                d_candles = s2['idx'] - s1['idx']
                drops.append({
                    'drop_pct': round(d_pct, 2),
                    'candles': d_candles,
                    'peak_price': s1['price'],
                    'trough_price': s2['price'],
                    'start_time': s1['time'],
                    'end_time': s2['time']
                })
            elif s1['type'] == 'TROUGH' and s2['type'] == 'PEAK':
                b_pct = (s2['price'] - s1['price']) / s1['price'] * 100.0
                b_candles = s2['idx'] - s1['idx']
                bounces.append({
                    'bounce_pct': round(b_pct, 2),
                    'candles': b_candles,
                    'trough_price': s1['price'],
                    'peak_price': s2['price'],
                    'start_time': s1['time'],
                    'end_time': s2['time']
                })

        drop_pcts = sorted([d['drop_pct'] for d in drops]) if drops else [0.0]
        bounce_pcts = sorted([b['bounce_pct'] for b in bounces]) if bounces else [0.0]

        # Estadísticas de Caída
        avg_drop = sum(drop_pcts) / len(drop_pcts) if drop_pcts else 0.0
        p50_drop = _calculate_percentile(drop_pcts, 50)
        p70_drop = _calculate_percentile(drop_pcts, 70)
        p85_drop = _calculate_percentile(drop_pcts, 85)
        p95_drop = _calculate_percentile(drop_pcts, 95)
        max_drop = drop_pcts[-1] if drop_pcts else 0.0
        avg_drop_candles = round(sum([d['candles'] for d in drops]) / len(drops), 1) if drops else 0.0

        # Estadísticas de Rebote
        avg_bounce = sum(bounce_pcts) / len(bounce_pcts) if bounce_pcts else 0.0
        p50_bounce = _calculate_percentile(bounce_pcts, 50)
        p80_bounce = _calculate_percentile(bounce_pcts, 80)
        max_bounce = bounce_pcts[-1] if bounce_pcts else 0.0
        avg_bounce_candles = round(sum([b['candles'] for b in bounces]) / len(bounces), 1) if bounces else 0.0

        # Ratio de Elasticidad (Rebote / Caída)
        elasticity_ratio = round(avg_bounce / avg_drop, 2) if avg_drop > 0 else 1.0

        # Simulación de Capital
        eff_margin = float(margin_usdt) if float(margin_usdt) > 0 else 50.0
        eff_leverage = int(leverage) if int(leverage) > 0 else 10
        notional_position = eff_margin * eff_leverage

        # ---------------------------------------------------------------------
        # RECOMENDACIONES DE STOP LOSS (Matemáticas Antirruido)
        # ---------------------------------------------------------------------
        # 1. Antirruido (P95 + margen de seguridad): El 95% de los retrocesos normales no lo tocarán
        sl_anti_noise_pct = round(p95_drop * 1.05 + 0.15, 2)
        sl_anti_noise_usdt = round(notional_position * (sl_anti_noise_pct / 100.0), 2)

        # 2. Moderado (P85): Buen balance de protección
        sl_balanced_pct = round(p85_drop * 1.05 + 0.10, 2)
        sl_balanced_usdt = round(notional_position * (sl_balanced_pct / 100.0), 2)

        # 3. Ceñido / Scalping (P70)
        sl_tight_pct = round(p70_drop + 0.10, 2)
        sl_tight_usdt = round(notional_position * (sl_tight_pct / 100.0), 2)

        # ---------------------------------------------------------------------
        # RECOMENDACIONES DE TAKE PROFIT & TRAILING STOP
        # ---------------------------------------------------------------------
        # Take Profit Óptimo: 85% de la mediana de rebotes para asegurar toma de beneficios antes de agotarse
        tp_rec_pct = round(max(0.6, p50_bounce * 0.85), 2)
        tp_rec_usdt = round(notional_position * (tp_rec_pct / 100.0), 2)

        # Trailing Stop: Se activa al 50% del TP objetivo con un drop de 40% del tramo recorrido
        trail_act_pct = round(tp_rec_pct * 0.50, 2)
        trail_act_usdt = round(notional_position * (trail_act_pct / 100.0), 2)
        trail_drop_usdt = round(max(0.20, trail_act_usdt * 0.40), 2)

        # Ratio Riesgo / Beneficio proyectado
        risk_reward_ratio = round(tp_rec_pct / sl_anti_noise_pct, 2) if sl_anti_noise_pct > 0 else 1.0

        # Calificación del Activo
        if elasticity_ratio >= 0.95 and max_drop <= 6.5:
            verdict = "EXCELLENT"
            verdict_badge = "🟢 Alta Elasticidad"
            verdict_desc = "Rebotes fuertes y consistentes. Excelente candidata para estrategias RSI y scalping."
        elif elasticity_ratio >= 0.70 and max_drop <= 8.5:
            verdict = "BALANCED"
            verdict_badge = "🟡 Comportamiento Estándar"
            verdict_desc = "Oscilaciones moderadas. Requiere respetar el Stop Loss Antirruido recomendado."
        else:
            verdict = "RISKY"
            verdict_badge = "🔴 Alta Volatilidad / Riesgo"
            verdict_desc = "Caídas profundas con rebotes lentos. Conviene operar con menor apalancamiento."

        # Muestra de caídas y rebotes más recientes para el gráfico visual (últimos 15)
        recent_swings = []
        for s in swings[-16:]:
            recent_swings.append({
                'type': s['type'],
                'price': round(s['price'], 4),
                'time': s['time']
            })

        return {
            "symbol": clean_sym,
            "interval": interval,
            "candles_analyzed": len(df),
            "start_time": times[0] if times else None,
            "end_time": times[-1] if times else None,
            "swings_count": len(swings),
            "dips_count": len(drops),
            "bounces_count": len(bounces),
            "current_price": closes[-1] if closes else 0.0,
            # Métricas de Caída
            "avg_drop_pct": round(avg_drop, 2),
            "median_drop_pct": round(p50_drop, 2),
            "p85_drop_pct": round(p85_drop, 2),
            "p95_drop_pct": round(p95_drop, 2),
            "max_drop_pct": round(max_drop, 2),
            "avg_drop_candles": avg_drop_candles,
            # Métricas de Rebote
            "avg_bounce_pct": round(avg_bounce, 2),
            "median_bounce_pct": round(p50_bounce, 2),
            "p80_bounce_pct": round(p80_bounce, 2),
            "max_bounce_pct": round(max_bounce, 2),
            "avg_bounce_candles": avg_bounce_candles,
            "elasticity_ratio": elasticity_ratio,
            "risk_reward_ratio": risk_reward_ratio,
            # Veredicto
            "verdict": verdict,
            "verdict_badge": verdict_badge,
            "verdict_desc": verdict_desc,
            # Recomendaciones de Parámetros
            "recommended_sl": {
                "anti_noise": {
                    "pct": sl_anti_noise_pct,
                    "usdt": sl_anti_noise_usdt,
                    "survival_rate": 95.2,
                    "label": "Antirruido Recomendado (Percentil 95)"
                },
                "balanced": {
                    "pct": sl_balanced_pct,
                    "usdt": sl_balanced_usdt,
                    "survival_rate": 85.0,
                    "label": "Moderado (Percentil 85)"
                },
                "tight": {
                    "pct": sl_tight_pct,
                    "usdt": sl_tight_usdt,
                    "survival_rate": 70.0,
                    "label": "Ceñido / Scalping Rápido (Percentil 70)"
                }
            },
            "recommended_tp": {
                "pct": tp_rec_pct,
                "usdt": tp_rec_usdt
            },
            "recommended_trailing": {
                "activation_usdt": trail_act_usdt,
                "drop_usdt": trail_drop_usdt
            },
            "recent_swings": recent_swings
        }

    except Exception as e:
        logger.error(f"Error analizando swings para {clean_sym}: {e}", exc_info=True)
        return {
            "symbol": clean_sym,
            "error": str(e)
        }


def analyze_market_basket(
    symbols: list,
    interval: str = '15m',
    limit: int = 500,
    start_time=None,
    end_time=None,
    min_swing_pct: float = 1.0,
    margin_usdt: float = 50.0,
    leverage: int = 10
) -> dict:
    """
    Analiza una cesta de monedas, computa los resultados individuales
    y genera un resumen consolidado con ranking de elasticidad.
    """
    results = []
    for sym in symbols:
        if not sym:
            continue
        res = analyze_single_symbol_swings(
            symbol=sym,
            interval=interval,
            limit=limit,
            start_time=start_time,
            end_time=end_time,
            min_swing_pct=min_swing_pct,
            margin_usdt=margin_usdt,
            leverage=leverage
        )
        results.append(res)

    valid_coins = [r for r in results if 'error' not in r]

    if not valid_coins:
        return {
            "basket_summary": None,
            "coins": results,
            "timestamp": datetime.now().strftime('%Y-%m-%d %H:%M:%S')
        }

    # Resumen global de la cesta
    avg_basket_drop = round(sum(c['avg_drop_pct'] for c in valid_coins) / len(valid_coins), 2)
    avg_basket_bounce = round(sum(c['avg_bounce_pct'] for c in valid_coins) / len(valid_coins), 2)
    avg_basket_sl_anti_noise = round(sum(c['recommended_sl']['anti_noise']['pct'] for c in valid_coins) / len(valid_coins), 2)
    avg_basket_tp = round(sum(c['recommended_tp']['pct'] for c in valid_coins) / len(valid_coins), 2)

    # Moneda más elástica (mejor ratio rebote/caída)
    top_elastic = max(valid_coins, key=lambda c: c['elasticity_ratio'])
    # Moneda con caída más profunda (mayor riesgo de volatilidad)
    highest_risk = max(valid_coins, key=lambda c: c['max_drop_pct'])

    basket_summary = {
        "coins_analyzed": len(valid_coins),
        "interval": interval,
        "avg_basket_drop_pct": avg_basket_drop,
        "avg_basket_bounce_pct": avg_basket_bounce,
        "avg_basket_sl_anti_noise_pct": avg_basket_sl_anti_noise,
        "avg_basket_tp_pct": avg_basket_tp,
        "top_elastic_coin": {
            "symbol": top_elastic['symbol'],
            "ratio": top_elastic['elasticity_ratio'],
            "avg_bounce": top_elastic['avg_bounce_pct']
        },
        "highest_risk_coin": {
            "symbol": highest_risk['symbol'],
            "max_drop": highest_risk['max_drop_pct']
        }
    }

    return {
        "basket_summary": basket_summary,
        "coins": results,
        "timestamp": datetime.now().strftime('%Y-%m-%d %H:%M:%S')
    }
