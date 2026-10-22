#!/usr/bin/env python
# -*- coding: utf-8 -*-
"""
Módulo de Gestión Centralizada de Mercado por WebSockets (Binance Futures).
Mantiene un búfer en memoria en tiempo real de las velas (klines) y precios
para todos los pares activos de la plataforma, eliminando el consumo de peso REST
por polling y compartiendo los datos instantáneamente entre todos los usuarios.
"""

import json
import time
import threading
from decimal import Decimal
import pandas as pd
import websocket

from src.logger_setup import get_logger

# Caché en memoria: { (symbol.upper(), interval): { "df": pd.DataFrame, "last_updated": float } }
_market_data_cache = {}
_cache_lock = threading.Lock()

# Control del cliente WebSocket
_ws_app = None
_ws_thread = None
_subscribed_streams = set()
_is_running = False
_active_environment = "mainnet" # "mainnet" o "testnet"

# URLs oficiales de Binance Futures WebSockets
MAINNET_WS_STREAM = "wss://fstream.binance.com/stream?streams="
TESTNET_WS_STREAM = "wss://stream.binancefuture.com/stream?streams="


def _on_message(ws, message):
    """Procesa los eventos entrantes del stream combinado de Binance Futures."""
    try:
        raw = json.loads(message) if isinstance(message, str) else message
        data = raw.get('data', raw)
        
        # Verificar si es un evento de vela (kline)
        if 'k' in data:
            k = data['k']
            symbol = str(data.get('s') or k.get('s', '')).upper()
            interval = str(k.get('i', '1m')).lower()
            
            candle_dict = {
                'open_time': pd.to_datetime(k['t'], unit='ms'),
                'open': Decimal(str(k['o'])),
                'high': Decimal(str(k['h'])),
                'low': Decimal(str(k['l'])),
                'close': Decimal(str(k['c'])),
                'volume': Decimal(str(k['v'])),
                'close_time': pd.to_datetime(k['T'], unit='ms'),
                'quote_volume': Decimal(str(k.get('q', 0))),
                'trades': int(k.get('n', 0)),
                'taker_buy_base_volume': Decimal(str(k.get('V', 0))),
                'taker_buy_quote_volume': Decimal(str(k.get('Q', 0))),
                'ignore': 0,
                'open_interest_usdt': Decimal('0'),
                'is_closed': bool(k.get('x', False))
            }
            
            cache_key = (symbol, interval)
            with _cache_lock:
                entry = _market_data_cache.get(cache_key)
                if entry is not None and 'df' in entry and not entry['df'].empty:
                    df = entry['df']
                    # Si el open_time coincide con la última vela, actualizar vela en formación
                    if len(df) > 0 and df.iloc[-1]['open_time'] == candle_dict['open_time']:
                        for col, val in candle_dict.items():
                            if col in df.columns:
                                df.at[df.index[-1], col] = val
                        df.at[df.index[-1], 'previous_close_price'] = df.iloc[-2]['close'] if len(df) >= 2 else df.iloc[-1]['open']
                    else:
                        # Nueva vela iniciada: append y recortar al tamaño deseado (máx 150)
                        candle_dict['previous_close_price'] = df.iloc[-1]['close'] if len(df) > 0 else candle_dict['open']
                        new_row_df = pd.DataFrame([candle_dict])
                        df = pd.concat([df, new_row_df], ignore_index=True)
                        if len(df) > 150:
                            df = df.iloc[-150:].reset_index(drop=True)
                        entry['df'] = df
                    entry['last_updated'] = time.time()
                else:
                    # Inicializar con esta primera vela
                    candle_dict['previous_close_price'] = candle_dict['open']
                    _market_data_cache[cache_key] = {
                        'df': pd.DataFrame([candle_dict]),
                        'last_updated': time.time()
                    }
    except Exception as e:
        get_logger().debug(f"[MarketFeed] Error procesando mensaje de WebSocket: {e}")


def _on_error(ws, error):
    get_logger().warning(f"[MarketFeed] Error en WebSocket de mercado: {error}")


def _on_close(ws, close_status_code, close_msg):
    global _is_running
    get_logger().info(f"[MarketFeed] Conexión WebSocket cerrada ({close_status_code}: {close_msg}).")
    _is_running = False


def _on_open(ws):
    global _is_running
    _is_running = True
    get_logger().info("🚀 [MarketFeed] Conexión WebSocket con Binance Futures establecida con éxito.")


def get_live_klines(symbol: str, interval: str = '1m', min_len: int = 15) -> pd.DataFrame | None:
    """
    Retorna el DataFrame de velas en memoria para el símbolo e intervalo solicitados.
    Si la memoria contiene al menos 'min_len' velas frescas (<30s), retorna una copia rápida.
    Retorna None si la caché aún no está lista o no contiene suficientes datos históricos.
    """
    key = (symbol.upper().strip(), interval.lower().strip())
    now = time.time()
    with _cache_lock:
        entry = _market_data_cache.get(key)
        if entry and 'df' in entry:
            df = entry['df']
            if len(df) >= min_len and (now - entry.get('last_updated', 0)) < 30.0:
                return df.copy()
    return None


def preload_symbol_klines(symbol: str, interval: str = '1m', limit: int = 100):
    """
    Carga el historial inicial de velas vía REST (una sola vez) para que el búfer
    tenga de inmediato el historial necesario para el cálculo preciso del RSI y SMA.
    """
    from src.binance_client import get_historical_klines
    try:
        clean_sym = symbol.upper().strip()
        clean_inv = interval.lower().strip()
        df = get_historical_klines(clean_sym, clean_inv, limit=limit)
        if df is not None and not df.empty:
            with _cache_lock:
                _market_data_cache[(clean_sym, clean_inv)] = {
                    'df': df,
                    'last_updated': time.time()
                }
            get_logger().info(f"📊 [MarketFeed] Historial inicial de {clean_sym} ({clean_inv}) precargado ({len(df)} velas).")
            return True
    except Exception as e:
        get_logger().warning(f"Aviso precargando historial inicial para {symbol}: {e}")
    return False


def start_market_feed(symbols: list, intervals: list = None, environment: str = "mainnet"):
    """
    Inicia la conexión WebSocket centralizada para los símbolos e intervalos especificados.
    """
    global _ws_app, _ws_thread, _subscribed_streams, _is_running, _active_environment
    logger = get_logger()
    
    if intervals is None:
        intervals = ['1m', '3m', '5m']
    
    _active_environment = environment.lower()
    base_url = TESTNET_WS_STREAM if _active_environment == "testnet" else MAINNET_WS_STREAM
    
    streams = []
    for s in symbols:
        sym_clean = s.strip().lower()
        if not sym_clean:
            continue
        for inv in intervals:
            inv_clean = inv.strip().lower()
            streams.append(f"{sym_clean}@kline_{inv_clean}")
            # Precargar historial inicial en segundo plano
            threading.Thread(target=preload_symbol_klines, args=(s, inv, 100), daemon=True).start()
    
    if not streams:
        return
        
    full_url = base_url + "/".join(streams)
    _subscribed_streams = set(streams)
    
    logger.info(f"🌐 [MarketFeed] Iniciando WebSocket combinado para {len(symbols)} símbolos ({len(streams)} streams)...")
    
    def _run_socket():
        global _is_running
        while True:
            try:
                _ws_app = websocket.WebSocketApp(
                    full_url,
                    on_open=_on_open,
                    on_message=_on_message,
                    on_error=_on_error,
                    on_close=_on_close
                )
                _ws_app.run_forever(ping_interval=20, ping_timeout=10)
            except Exception as e:
                logger.warning(f"[MarketFeed] Reconectando WebSocket de mercado tras error: {e}")
            time.sleep(3.0)

    _ws_thread = threading.Thread(target=_run_socket, name="CentralMarketFeedThread", daemon=True)
    _ws_thread.start()
