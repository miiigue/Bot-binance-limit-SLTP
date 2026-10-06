#!/usr/bin/env python
# -*- coding: utf-8 -*-

import os
import sys
import configparser
import json # <--- AÑADIR IMPORT JSON
from flask import Flask, jsonify, request, send_file
from flask_cors import CORS
import threading
import time # Necesario para sleep
import logging # Necesario para get_logger y calculate_sleep
from decimal import Decimal
from threading import Lock # Necesario para el Lock del RiskManager
from datetime import datetime

# --- Quitar Workaround sys.path --- 
# current_dir = os.path.dirname(os.path.abspath(__file__))
# project_root = os.path.dirname(current_dir) 
# if project_root not in sys.path:
#     sys.path.insert(0, project_root)

# Importar funciones y variables usando importaciones ABSOLUTAS (desde src)
from src.config_loader import load_config, reload_config, get_trading_symbols, CONFIG_FILE_PATH
from src.logger_setup import setup_logging, get_logger
from src.database import (
    get_cumulative_pnl_by_symbol, get_last_n_trades_for_symbol, clear_trade_history, get_all_recent_trades,
    count_users, create_user, get_user_by_id, get_user_by_identifier, update_last_login,
    approve_user, reject_user, add_investor_transaction, get_all_investors_summary, clear_requested_capital,
    get_investor_portfolio, get_investor_transactions, toggle_user_status,
    get_admin_investor_dossier, DATABASE_FILE,
    save_user_api_keys, get_user_api_keys, delete_user_api_keys,
    get_user_bot_settings, update_user_bot_settings,
    get_user_trades, get_user_trading_metrics, format_account_number, init_db_schema,
    get_strategies_catalog, upsert_strategy_catalog, toggle_strategy_public_status, delete_strategy_catalog
)
from src.auth import (
    hash_password, verify_password, generate_jwt, decode_jwt,
    token_required, admin_required, is_login_rate_limited,
    record_failed_login, clear_failed_logins, get_token_from_request
)
from src.bot import TradingBot, BotState 
from src.binance_client import (
    get_account_balance_usdt, reset_futures_client, get_futures_client,
    verify_user_binance_credentials, get_user_futures_client
)
from src.backtester import get_historical_klines_paginated, run_strategy_backtest, run_portfolio_backtest

# Timestamp until which sync is paused after a reset (prevents re-importing trades)
_sync_paused_until = 0

# --- NUEVO: Gestor de Estadísticas de Sesión ---
class SessionStateManager:
    def __init__(self, logger):
        self.logger = logger
        self.lock = Lock()
        self.session_realized_pnl = Decimal('0')
        self.session_unrealized_pnl = Decimal('0')
        self.session_pnl_high = Decimal('0')
        self.session_pnl_low = Decimal('0')
        self.active_session = False
        self.session_start_time = None

    def start_session(self):
        with self.lock:
            self.logger.info("Iniciando nueva sesión de estadísticas.")
            self.session_realized_pnl = Decimal('0')
            self.session_unrealized_pnl = Decimal('0')
            self.session_pnl_high = Decimal('0')
            self.session_pnl_low = Decimal('0')
            self.active_session = True
            self.session_start_time = time.time()

    def stop_session(self):
        with self.lock:
            self.logger.info("Deteniendo sesión de estadísticas.")
            self.active_session = False
            self.session_start_time = None

    def reset_stats(self):
        with self.lock:
            self.logger.info("Reiniciando estadísticas de sesión a cero.")
            self.session_realized_pnl = Decimal('0')
            self.session_unrealized_pnl = Decimal('0')
            self.session_pnl_high = Decimal('0')
            self.session_pnl_low = Decimal('0')
            if self.active_session:
                self.session_start_time = time.time()

    def update_stats(self, realized_pnl: Decimal, unrealized_pnl: Decimal):
        with self.lock:
            if not self.active_session:
                return

            self.session_realized_pnl = realized_pnl
            self.session_unrealized_pnl = unrealized_pnl
            
            current_total_pnl = self.session_realized_pnl + self.session_unrealized_pnl

            if current_total_pnl > self.session_pnl_high:
                self.session_pnl_high = current_total_pnl
            
            if current_total_pnl < self.session_pnl_low:
                self.session_pnl_low = current_total_pnl

    def get_stats(self):
        with self.lock:
            elapsed = int(time.time() - self.session_start_time) if (self.active_session and self.session_start_time) else 0
            return {
                "session_pnl": float(self.session_realized_pnl + self.session_unrealized_pnl),
                "session_realized_pnl": float(self.session_realized_pnl),
                "session_unrealized_pnl": float(self.session_unrealized_pnl),
                "session_high": float(self.session_pnl_high) if self.session_pnl_high != Decimal('-Infinity') else 0.0,
                "session_low": float(self.session_pnl_low) if self.session_pnl_low != Decimal('Infinity') else 0.0,
                "elapsed_seconds": elapsed,
                "active_session": self.active_session
            }

# --- Definición de variables compartidas para la gestión de workers ---
worker_statuses = {} # Ej: {'BTCUSDT': {'state': 'IN_POSITION', 'pnl': 5.2}, 'ETHUSDT': ...}
paused_symbols = set() # Monedas pausadas individualmente por el usuario
status_lock = threading.Lock() 
stop_event = threading.Event() # Evento global para detener todos los hilos
threads = [] # Lista para guardar las instancias de los hilos de los workers
workers_started = False # Flag para saber si los workers están activos
# Variables para almacenar la configuración cargada al inicio
loaded_trading_params = {}
loaded_symbols_to_trade = []
# --------------------------------------------------------------------

# --- Directorio para Estrategias Guardadas ---
STRATEGIES_DIR_NAME = "strategies"
# Construir la ruta al directorio de estrategias relativa a la raíz del proyecto
# Asumiendo que api_server.py está en src/ y la raíz del proyecto es un nivel arriba
PROJECT_ROOT_DIR = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
STRATEGIES_PATH = os.path.join(PROJECT_ROOT_DIR, STRATEGIES_DIR_NAME)

# Crear el directorio si no existe
if not os.path.exists(STRATEGIES_PATH):
    try:
        os.makedirs(STRATEGIES_PATH)
        print(f"Directorio de estrategias creado en: {STRATEGIES_PATH}") # Usar print si el logger no está listo
    except OSError as e:
        print(f"Error al crear el directorio de estrategias {STRATEGIES_PATH}: {e}")
# -------------------------------------------

# --- Instancia del Gestor de Sesión ---
session_manager = None # Se inicializará después del logger

# --- Funciones para calcular sleep (Movidas desde run_bot.py) ---
def calculate_sleep_from_interval(interval_str: str) -> int:
    """Calcula segundos de espera basados en el string del intervalo (e.g., '1m', '5m', '1h'). Mínimo 5s."""
    # Ajustado mínimo a 5 segundos como estaba en run_bot antes
    logger = get_logger()
    unit = interval_str[-1].lower()
    try:
        value = int(interval_str[:-1])
        if unit == 'm':
            # Esperar la duración del intervalo, pero mínimo 5 segundos
            return max(60 * value, 5) 
        elif unit == 'h':
            return max(3600 * value, 5)
        else:
            logger.warning(f"Unidad de intervalo no reconocida '{unit}' en '{interval_str}'. Usando 60s por defecto.")
            return 60 # Mantener default de 60 si es inválido
    except (ValueError, IndexError):
        logger.warning(f"Formato de intervalo inválido '{interval_str}'. Usando 60s por defecto.")
        return 60

def get_sleep_seconds(trading_params: dict) -> int:
    """Obtiene el tiempo de espera en segundos desde los parámetros o lo calcula."""
    logger = get_logger()
    try:
        sleep_override = trading_params.get('cycle_sleep_seconds') 
        if sleep_override is not None:
            try:
                sleep_override = int(sleep_override)
            except (ValueError, TypeError):
                 logger.warning(f"Valor no numérico para cycle_sleep_seconds ({sleep_override}). Calculando desde RSI_INTERVAL.")
                 sleep_override = None
        
        if sleep_override is not None and sleep_override > 0:
            # Usar mínimo 5 segundos incluso si se configura menos explícitamente
            final_sleep = max(sleep_override, 5)
            logger.info(f"Usando tiempo de espera explícito: {final_sleep} segundos (desde cycle_sleep_seconds, min 5s).")
            return final_sleep
        else:
            if sleep_override is not None:
                 logger.warning(f"CYCLE_SLEEP_SECONDS ({sleep_override}) inválido. Calculando desde RSI_INTERVAL.")
            rsi_interval = str(trading_params.get('rsi_interval', '5m'))
            calculated_sleep = calculate_sleep_from_interval(rsi_interval)
            logger.info(f"Calculando tiempo de espera desde RSI_INTERVAL ({rsi_interval}): {calculated_sleep} segundos.")
            return calculated_sleep
    except Exception as e:
        logger.error(f"Error inesperado al obtener tiempo de espera: {e}. Usando 60s por defecto.", exc_info=True)
        return 60
# --- Fin Funciones sleep ---

# --- Configuración Inicial ---
api_logger = setup_logging(log_filename='api.log')
session_manager = SessionStateManager(logger=api_logger) # Inicializar el gestor de sesión

app = Flask(__name__) # Crear la aplicación Flask
# Habilitar CORS para permitir peticiones desde el frontend (que corre en otro puerto)
CORS(app)

# Garantizar que el esquema relacional e índices existan en la BD (PostgreSQL / SQLite)
try:
    init_db_schema()
except Exception as _e_db_init:
    api_logger.warning(f"Aviso al asegurar esquema de base de datos: {_e_db_init}") 

def config_to_dict(config: configparser.ConfigParser) -> dict:
    """Convierte un objeto ConfigParser a un diccionario anidado."""
    the_dict = {}
    for section in config.sections():
        the_dict[section] = {}
        for key, val in config.items(section):
            # Intentar convertir tipos
            try:
                if section == 'SYMBOLS' and key == 'symbols_to_trade': # Mantener la lista como string
                    processed_val = val
                # --- NUEVO: Manejo explícito de booleanos para la nueva estrategia ---
                elif key in ['auto_mirror_short', 'evaluate_support_strategy', 'evaluate_ma_filter', 'evaluate_open_interest_increase', 'enable_take_profit_pnl', 'enable_stop_loss_pnl', 'enable_trailing_rsi_stop', 'enable_price_trailing_stop', 'enable_pnl_trailing_stop', 'evaluate_rsi_delta', 'evaluate_volume_filter', 'evaluate_rsi_range', 'evaluate_downtrend_candles_block', 'evaluate_downtrend_levels_block', 'evaluate_required_uptrend']:
                    processed_val = config.getboolean(section, key)
                elif '.' in val:
                    processed_val = config.getfloat(section, key)
                else:
                    processed_val = config.getint(section, key)
            except (ValueError, AttributeError): # Añadido AttributeError para manejar casos como 'None'
                processed_val = val # Mantener como string si no se puede convertir
            the_dict[section][key] = processed_val
    return the_dict

def map_frontend_trading_binance(frontend_data: dict) -> dict:
    """Mapea los datos del frontend a la estructura esperada por configparser para [TRADING] y [BINANCE]."""
    import re
    def _val(key, default):
        val = frontend_data.get(key)
        if val is not None and str(val).strip() != '':
            return str(val).strip().replace(',', '.')
        snake_key = re.sub(r'(?<!^)(?=[A-Z])', '_', key).lower()
        val = frontend_data.get(snake_key)
        if val is not None and str(val).strip() != '':
            return str(val).strip().replace(',', '.')
        parts = key.split('_')
        camel_key = parts[0] + ''.join(x.title() for x in parts[1:])
        val = frontend_data.get(camel_key)
        if val is not None and str(val).strip() != '':
            return str(val).strip().replace(',', '.')
        return str(default)

    raw_order_type = frontend_data.get('entry_order_type') or frontend_data.get('entryOrderType') or 'MARKET'
    entry_order_type_clean = str(raw_order_type).upper().strip()
    if entry_order_type_clean not in ('LIMIT', 'MARKET'):
        entry_order_type_clean = 'MARKET'

    config_output = {
        'BINANCE': {
            'mode': 'paper',
        },
        'TRADING': {
            'leverage': _val('leverage', 20),
            'rsi_type': str(_val('rsiType', 'WILDER')).upper().strip(),
            'rsi_interval': _val('rsiInterval', '5m'),
            'rsi_period': _val('rsiPeriod', 14),
            'rsi_threshold_up': _val('rsiThresholdUp', 8),
            'rsi_candles_window': _val('rsiCandlesWindow', _val('rsi_candles_window', 3)),
            'rsi_positive_candles_required': _val('rsiPositiveCandlesRequired', _val('rsi_positive_candles_required', 2)),
            'rsi_positive_delta_min': _val('rsiPositiveDeltaMin', _val('rsi_positive_delta_min', 0.0)),
            'rsi_threshold_down': _val('rsiThresholdDown', -8),
            'rsi_entry_level_low': _val('rsiEntryLevelLow', 25),
            'rsi_entry_level_high': _val('rsiEntryLevelHigh', 75),
            'rsi_target': _val('rsiTarget', 50),
            'volume_sma_period': _val('volumeSmaPeriod', 20),
            'volume_factor': _val('volumeFactor', 1.5),
            'downtrend_check_candles': _val('downtrendCheckCandles', 3),
            'downtrend_candles_window': _val('downtrendCandlesWindow', 5),
            'downtrend_level_check': _val('downtrend_level_check', _val('downtrendLevelCheck', 5)),
            'required_uptrend_candles': _val('requiredUptrendCandles', 0),
            'position_size_usdt': _val('positionSizeUSDT', 50),
            'stop_loss_usdt': _val('stopLossUSDT', 20),
            'take_profit_usdt': _val('takeProfitUSDT', 30),
            'cycle_sleep_seconds': _val('cycleSleepSeconds', 5),
            'order_timeout_seconds': _val('orderTimeoutSeconds', 10),
            'entry_order_type': entry_order_type_clean,
            'evaluate_rsi_delta': str(frontend_data.get('evaluateRsiDelta', True)).lower(),
            'evaluate_volume_filter': str(frontend_data.get('evaluateVolumeFilter', True)).lower(),
            'evaluate_rsi_range': str(frontend_data.get('evaluateRsiRange', True)).lower(),
            'evaluate_downtrend_candles_block': str(frontend_data.get('evaluateDowntrendCandlesBlock', True)).lower(),
            'evaluate_downtrend_levels_block': str(frontend_data.get('evaluateDowntrendLevelsBlock', True)).lower(),
            'evaluate_required_uptrend': str(frontend_data.get('evaluateRequiredUptrend', True)).lower(),
            'enable_take_profit_pnl': str(frontend_data.get('enableTakeProfitPnl', True)).lower(),
            'enable_stop_loss_pnl': str(frontend_data.get('enableStopLossPnl', True)).lower(),
            'stop_loss_order_type': _val('stopLossOrderType', 'STOP_MARKET'),
            'stop_loss_trigger_type': _val('stopLossTriggerType', 'MARK_PRICE'),
            'enable_emergency_software_sl': str(frontend_data.get('enableEmergencySoftwareSl', True)).lower(),
            'stop_loss_execution_mode': _val('stopLossExecutionMode', 'TOTAL_100'),
            'enable_trailing_rsi_stop': str(frontend_data.get('enableTrailingRsiStop', True)).lower(),
            'enable_price_trailing_stop': str(frontend_data.get('enablePriceTrailingStop', True)).lower(),
            'price_trailing_stop_distance_usdt': _val('priceTrailingStopDistanceUSDT', 0.05),
            'price_trailing_stop_activation_pnl_usdt': _val('priceTrailingStopActivationPnlUSDT', 0.02),
            'enable_pnl_trailing_stop': str(frontend_data.get('enablePnlTrailingStop', True)).lower(),
            'pnl_trailing_stop_activation_usdt': _val('pnlTrailingStopActivationUSDT', 0.1),
            'pnl_trailing_stop_drop_usdt': _val('pnlTrailingStopDropUSDT', 0.05),
            'evaluate_open_interest_increase': str(frontend_data.get('evaluateOpenInterestIncrease', True)).lower(),
            'open_interest_period': _val('openInterestPeriod', '5m'),
            'evaluate_ma_filter': str(frontend_data.get('evaluateMaFilter', False)).lower(),
            'ma_period': _val('maPeriod', 200),

            # --- NUEVO: Mapeo para la Estrategia de Soportes ---
            'evaluate_support_strategy': str(frontend_data.get('evaluateSupportStrategy', False)).lower(),
            'support_history_candles': _val('supportHistoryCandles', 200),
            'support_pivot_window': _val('supportPivotWindow', 5),
            'support_confirmations': _val('supportConfirmations', 2),
            'support_level_tolerance_percent': _val('supportLevelTolerancePercent', 0.5),
            'support_order_stop_loss_percent': _val('supportOrderStopLossPercent', 2.0),
            'support_order_take_profit_percent': _val('supportOrderTakeProfitPercent', 4.0),

            # --- NUEVO: Mapeo para Re-entradas DCA ---
            'enable_dca_reentry': str(frontend_data.get('enableDcaReentry', False)).lower(),
            'dca_reentry_mode': _val('dcaReentryMode', 'fixed_percent'),
            'dca_price_drop_percent': _val('dcaPriceDropPercent', 1.5),
            'dca_trigger_loss_usdt': _val('dcaTriggerLossUsdt', 15.0),
            'dca_max_reentries': _val('dcaMaxReentries', 2),
            'dca_volume_multiplier': _val('dcaVolumeMultiplier', 1.0),
            'risk_percentage': _val('riskPercentage', _val('risk_percentage', 50)),

            # --- NUEVO: Mapeo para los 4 Circuit Breakers de Riesgo ---
            'enable_max_loss_per_symbol': str(frontend_data.get('enableMaxLossPerSymbol', True)).lower(),
            'max_loss_per_symbol_usdt': _val('maxLossPerSymbolUSDT', 20.0),
            'enable_consecutive_losses_cooldown': str(frontend_data.get('enableConsecutiveLossesCooldown', True)).lower(),
            'max_consecutive_losses': _val('maxConsecutiveLosses', 2),
            'consecutive_losses_cooldown_minutes': _val('consecutiveLossesCooldownMinutes', 60),
            'enable_rolling_performance_filter': str(frontend_data.get('enableRollingPerformanceFilter', True)).lower(),
            'rolling_trades_window': _val('rollingTradesWindow', 5),
            'rolling_max_losses': _val('rollingMaxLosses', 4),
            'rolling_filter_cooldown_minutes': _val('rollingFilterCooldownMinutes', 120),
            'enable_btc_crash_shield': str(frontend_data.get('enableBtcCrashShield', True)).lower(),
            'btc_crash_timeframe': _val('btcCrashTimeframe', '15m'),
            'btc_crash_drop_percent': _val('btcCrashDropPercent', 2.0),
            'btc_crash_shield_cooldown_minutes': _val('btcCrashShieldCooldownMinutes', 30),

            # --- NUEVO: Mapeo para Filtro de Régimen de Mercado (Tendencia Macro) ---
            'enable_market_regime_filter': str(frontend_data.get('enableMarketRegimeFilter', False)).lower(),
            'market_regime_mode': _val('marketRegimeMode', 'symbol'),
            'market_regime_indicator': _val('marketRegimeIndicator', 'supertrend'),
            'market_regime_timeframe': _val('marketRegimeTimeframe', '1h'),
            'market_regime_ema_period': _val('marketRegimeEmaPeriod', 50),
            'market_regime_supertrend_period': _val('marketRegimeSupertrendPeriod', 10),
            'market_regime_supertrend_multiplier': _val('marketRegimeSupertrendMultiplier', 3.0),

            # --- SALIDA DE EMERGENCIA POR CRASH ---
            'enable_emergency_crash_exit': str(frontend_data.get('enableEmergencyCrashExit', False)).lower(),
            'enable_crash_rsi_drop': str(frontend_data.get('enableCrashRsiDrop', True)).lower(),
            'crash_rsi_drop_threshold': _val('crashRsiDropThreshold', 8.0),
            'enable_crash_price_drop': str(frontend_data.get('enableCrashPriceDrop', True)).lower(),
            'crash_price_drop_percent': _val('crashPriceDropPercent', 1.5),
            'enable_crash_pnl_drop': str(frontend_data.get('enableCrashPnlDrop', True)).lower(),
            'crash_pnl_drop_threshold_usdt': _val('crashPnlDropThresholdUSDT', 5.0),

            # --- OPERATIVA BIDIRECCIONAL Y ESPEJO SHORT ---
            'trade_direction': str(_val('tradeDirection', 'BIDIRECTIONAL')).upper(),
            'auto_mirror_short': str(frontend_data.get('autoMirrorShort', True)).lower(),
            'rsi_short_entry_level_low': _val('rsiShortEntryLevelLow', 55.0),
            'rsi_short_entry_level_high': _val('rsiShortEntryLevelHigh', 70.0),
            'rsi_threshold_down': _val('rsiThresholdDown', 2.0),

            # --- SMART HEDGE & RESGUARDO DINÁMICO ---
            'enable_hedge_protection': str(frontend_data.get('enableHedgeProtection', False)).lower(),
            'hedge_trigger_type': str(_val('hedgeTriggerType', 'PERCENT')).upper(),
            'hedge_trigger_value': _val('hedgeTriggerValue', 1.5),
            'hedge_size_multiplier': _val('hedgeSizeMultiplier', 1.0),
            'enable_hedge_trailing_stop': str(frontend_data.get('enableHedgeTrailingStop', True)).lower(),
            'hedge_trailing_activation_usdt': _val('hedgeTrailingActivationUSDT', 0.20),
            'hedge_trailing_drop_usdt': _val('hedgeTrailingDropUSDT', 0.30),
            'enable_hedge_basket_exit': str(frontend_data.get('enableHedgeBasketExit', True)).lower(),
            'hedge_basket_target_usdt': _val('hedgeBasketTargetUSDT', 0.50),
            'hedge_reentry_cooldown_seconds': _val('hedgeReentryCooldownSeconds', 60),
            'enable_hedge_recovery_protection': str(frontend_data.get('enableHedgeRecoveryProtection', True)).lower(),
            'hedge_max_bounce_percent': _val('hedgeMaxBouncePercent', 0.35),
            'hedge_recovery_candles_window': _val('hedgeRecoveryCandlesWindow', 4),
            'hedge_recovery_candles_threshold': _val('hedgeRecoveryCandlesThreshold', 3),
            'enable_hedge_breakout_requirement': str(frontend_data.get('enableHedgeBreakoutRequirement', True)).lower(),
        },
        'SYMBOLS': {
            'symbols_to_trade': ",".join([s.strip().upper() for s in frontend_data.get('symbolsToTrade', '').split(',') if s.strip()])
        }
    }
    return config_output

# --- Función run_bot_worker (Movida desde run_bot.py) ---
# Adaptada para usar las variables globales definidas aquí
def run_bot_worker(symbol, trading_params, stop_event_ref):
    """Función ejecutada por cada hilo para manejar un bot de símbolo único."""
    logger = get_logger()
    
    bot_instance = None
    try:
        if not trading_params:
             logger.error(f"[{symbol}] No se proporcionaron parámetros de trading válidos al worker. Terminando.")
             # No se puede actualizar worker_statuses aquí porque no hay instancia de bot
             return
        
        sleep_duration = get_sleep_seconds(trading_params)
        
        bot_instance = TradingBot(symbol=symbol, trading_params=trading_params, risk_manager=risk_manager)
        bot_instance.is_paused = (symbol in paused_symbols)
        bot_instance.reset_session_pnl() # <-- NUEVO: Resetear PNL de sesión al crear el bot
        
        # --- CORRECCIÓN CRÍTICA: Comprobar posición inicial ANTES del bucle ---
        try:
            bot_instance._check_initial_position()
            logger.info(f"[{symbol}] Comprobación de posición inicial finalizada.")
        except Exception as e_init_pos:
            logger.error(f"[{symbol}] Error crítico durante la comprobación de posición inicial: {e_init_pos}. El worker para este símbolo no continuará.", exc_info=True)
            bot_instance._set_error_state(f"Initial position check failed: {e_init_pos}")
            # Actualizar el estado una última vez antes de salir
            with status_lock:
                worker_statuses[symbol] = bot_instance
            return # Detener la ejecución de este worker
        # --- FIN DE LA CORRECCIÓN ---

        with status_lock:
             worker_statuses[symbol] = bot_instance
        logger.info(f"[{symbol}] Worker thread iniciado. Instancia de TradingBot creada. Tiempo de espera: {sleep_duration}s")
    except (ValueError, ConnectionError) as init_error:
         logger.error(f"No se pudo inicializar la instancia de TradingBot para {symbol}: {init_error}. Terminando worker.", exc_info=True)
         # No se puede actualizar worker_statuses aquí porque no hay instancia de bot
         return
    except Exception as thread_error:
         logger.error(f"Error inesperado al crear instancia de TradingBot para {symbol}: {thread_error}. Terminando worker.", exc_info=True)
         # No se puede actualizar worker_statuses aquí porque no hay instancia de bot
         return

    while not stop_event_ref.is_set():
        try:
            if bot_instance:
                bot_instance.run_once()
            # La actualización de estado ahora se hace en el endpoint /api/status
        except Exception as cycle_error:
            logger.error(f"[{symbol}] Error inesperado en el ciclo principal del worker: {cycle_error}", exc_info=True)
            if bot_instance:
                bot_instance._set_error_state(f"Unhandled exception in worker loop: {cycle_error}")
            pass 

        curr_sleep = get_sleep_seconds(bot_instance.params) if (bot_instance and hasattr(bot_instance, 'params')) else sleep_duration
        interrupted = stop_event_ref.wait(timeout=curr_sleep)
        if interrupted:
            logger.info(f"[{symbol}] Señal de parada recibida durante la espera.")
            break

    logger.info(f"[{symbol}] Worker thread terminado.")
    if bot_instance:
        bot_instance.state = BotState.STOPPED
    # La limpieza final del worker_statuses se hará en la función de apagado.


# --- Función para iniciar los workers (Movida y Adaptada) ---
def start_bot_workers():
    global workers_started, threads, loaded_trading_params, loaded_symbols_to_trade
    logger = get_logger()
    
    with status_lock: # Proteger acceso a workers_started y threads
        if workers_started:
            logger.warning("start_bot_workers fue llamado pero los workers ya están iniciados.")
            return False, "Los workers ya están corriendo." # Indicar que no se hizo nada

        worker_statuses.clear() # Clear previous statuses before starting new ones
        threads.clear() # Limpiar lista de hilos anterior
        stop_event.clear() # Asegurarse que el evento de parada no esté activo

        if not loaded_symbols_to_trade:
            logger.error("No hay símbolos configurados para iniciar los workers.")
            return False, "No hay símbolos configurados para iniciar los workers."
            
        if not loaded_trading_params:
            logger.error("No hay parámetros de trading configurados para iniciar los workers.")
            return False, "No hay parámetros de trading configurados para iniciar los workers."

        # --- PRE-FLIGHT SANITY CHECK: Seguridad Estricta de Testnet ---
        client = get_futures_client()
        if not client or "testnet" not in str(getattr(client, 'base_url', '')).lower():
            logger.critical("BLOQUEO DE SEGURIDAD: Conexión con Binance Testnet no verificada. Inicio abortado.")
            return False, "Bloqueo de seguridad: No se pudo verificar la conexión exclusiva con Binance Testnet."

        # Asegurar Modo Cobertura (Hedge Mode) para permitir LONG y SHORT simultáneos
        try:
            from src.binance_client import ensure_hedge_mode
            ensure_hedge_mode()
        except Exception as e_hm:
            logger.warning(f"Aviso al verificar/activar Modo Cobertura (Hedge Mode): {e_hm}")

        from src.config_loader import is_multi_strategy_enabled, get_symbol_strategy_assignments
        is_multi = is_multi_strategy_enabled()
        assignments = get_symbol_strategy_assignments()
        global_strat_name = ''

        # Prioridad soberana: Base de Datos (inmune a Git)
        try:
            from src.database import get_active_strategy_from_db
            db_strat = get_active_strategy_from_db()
            if db_strat and db_strat.lower() != 'global':
                global_strat_name = db_strat
                logger.info(f"✅ Estrategia activa cargada con SOBERANÍA desde Base de Datos: {global_strat_name}")
        except Exception as e_db:
            logger.warning(f"Aviso al consultar estrategia soberana desde DB: {e_db}")

        if not global_strat_name:
            try:
                cfg_temp = configparser.ConfigParser()
                if os.path.exists(CONFIG_FILE_PATH):
                    cfg_temp.read(CONFIG_FILE_PATH, encoding='utf-8')
                    global_strat_name = cfg_temp.get('STRATEGY_INFO', 'active_strategy_name', fallback='').strip()
            except Exception:
                global_strat_name = ''

        from src.config_loader import get_strategy_for_symbol
        if not global_strat_name or global_strat_name.lower() == 'global':
            global_strat_name = get_strategy_for_symbol(loaded_symbols_to_trade[0] if loaded_symbols_to_trade else 'BTCUSDT')

        logger.info(f"Iniciando workers de bot... (Modo Multi-Estrategia: {is_multi}, Estrategia base: {global_strat_name})")
        for symbol_idx, symbol in enumerate(loaded_symbols_to_trade):
            worker_params = loaded_trading_params.copy()
            strat_name = assignments.get(symbol.upper(), global_strat_name) if is_multi else global_strat_name
            if not strat_name or strat_name.lower() == 'global':
                strat_name = get_strategy_for_symbol(symbol)
            
            strat_loaded = False
            # Cargar parámetros de la estrategia (prioridad: Catálogo DB primero, luego disco)
            if strat_name and strat_name.lower() != 'global':
                strat_json = None
                try:
                    from src.database import get_strategies_catalog
                    catalog = get_strategies_catalog(only_public=False)
                    for item in catalog:
                        if item.get('name') == strat_name:
                            strat_json = item.get('parameters', {})
                            break
                except Exception as e_cat_ld:
                    logger.debug(f"Aviso consultando catálogo para {strat_name}: {e_cat_ld}")

                if not strat_json:
                    strat_file = os.path.join(STRATEGIES_PATH, f"{strat_name}.json")
                    if os.path.exists(strat_file):
                        try:
                            with open(strat_file, 'r', encoding='utf-8') as f_sf:
                                strat_json = json.load(f_sf)
                        except Exception as e_s:
                            logger.warning(f"Error cargando archivo de estrategia '{strat_name}' para {symbol}: {e_s}")

                if strat_json and isinstance(strat_json, dict):
                    mapped = map_frontend_trading_binance(strat_json)
                    if 'TRADING' in mapped:
                        worker_params.update(mapped['TRADING'])
                        strat_loaded = True
                    logger.info(f"-> Parámetros de estrategia '{strat_name}' aplicados soberanamente para {symbol}")

            # Solo si NO se cargó ninguna estrategia específica, aplicar parámetros generales guardados en DB
            if not strat_loaded:
                try:
                    from src.database import get_saved_trading_params_from_db
                    db_p = get_saved_trading_params_from_db()
                    if db_p and isinstance(db_p, dict):
                        mapped_db = map_frontend_trading_binance(db_p)
                        if 'TRADING' in mapped_db:
                            worker_params.update(mapped_db['TRADING'])
                except Exception:
                    pass
            
            worker_params['strategy_name'] = strat_name or global_strat_name
            logger.info(f"-> Preparando worker para {symbol} (Estrategia: {worker_params['strategy_name']})...")
            thread = threading.Thread(target=run_bot_worker, args=(symbol, worker_params, stop_event), name=f"Worker-{symbol}")
            threads.append(thread)
            thread.start()
            if (symbol_idx + 1) < len(loaded_symbols_to_trade):
                 time.sleep(1) 
        
        num_bot_threads = len(threads)
        workers_started = True # Marcar como iniciados
        logger.info(f"Todos los {num_bot_threads} workers de bot iniciados.")
        return True, "Todos los workers de bot iniciados." # Indicar éxito
# --- Fin de start_bot_workers ---


# --- Endpoints de la API ---

def _build_frontend_config_dict():
    """Lee config.ini y retorna el diccionario completo mapeado para el frontend."""
    config = configparser.ConfigParser(allow_no_value=True)
    if not os.path.exists(CONFIG_FILE_PATH):
        return {}
    config.read(CONFIG_FILE_PATH, encoding='utf-8')
    config_dict = config_to_dict(config)
    frontend_config = {}
    if 'BINANCE' in config_dict:
        frontend_config['mode'] = config_dict['BINANCE'].get('mode', 'paper')
    if 'TRADING' in config_dict:
        for key_ini, key_frontend in [
            ('leverage', 'leverage'),
            ('rsi_type', 'rsiType'),
            ('rsi_interval', 'rsiInterval'),
            ('rsi_period', 'rsiPeriod'),
            ('rsi_threshold_up', 'rsiThresholdUp'),
            ('rsi_candles_window', 'rsiCandlesWindow'),
            ('rsi_positive_candles_required', 'rsiPositiveCandlesRequired'),
            ('rsi_positive_delta_min', 'rsiPositiveDeltaMin'),
            ('rsi_threshold_down', 'rsiThresholdDown'),
            ('rsi_entry_level_low', 'rsiEntryLevelLow'),
            ('rsi_entry_level_high', 'rsiEntryLevelHigh'),
            ('rsi_target', 'rsiTarget'),
            ('volume_sma_period', 'volumeSmaPeriod'),
            ('volume_factor', 'volumeFactor'),
            ('downtrend_check_candles', 'downtrendCheckCandles'),
            ('downtrend_candles_window', 'downtrendCandlesWindow'),
            ('downtrend_level_check', 'downtrendLevelCheck'),
            ('required_uptrend_candles', 'requiredUptrendCandles'),
            ('position_size_usdt', 'positionSizeUSDT'),
            ('stop_loss_usdt', 'stopLossUSDT'),
            ('take_profit_usdt', 'takeProfitUSDT'),
            ('cycle_sleep_seconds', 'cycleSleepSeconds'),
            ('order_timeout_seconds', 'orderTimeoutSeconds'),
            ('entry_order_type', 'entryOrderType'),
            ('evaluate_rsi_delta', 'evaluateRsiDelta'),
            ('evaluate_volume_filter', 'evaluateVolumeFilter'),
            ('evaluate_rsi_range', 'evaluateRsiRange'),
            ('evaluate_downtrend_candles_block', 'evaluateDowntrendCandlesBlock'),
            ('evaluate_downtrend_levels_block', 'evaluateDowntrendLevelsBlock'),
            ('evaluate_required_uptrend', 'evaluateRequiredUptrend'),
            ('enable_take_profit_pnl', 'enableTakeProfitPnl'),
            ('enable_stop_loss_pnl', 'enableStopLossPnl'),
            ('stop_loss_order_type', 'stopLossOrderType'),
            ('stop_loss_trigger_type', 'stopLossTriggerType'),
            ('enable_emergency_software_sl', 'enableEmergencySoftwareSl'),
            ('stop_loss_execution_mode', 'stopLossExecutionMode'),
            ('enable_trailing_rsi_stop', 'enableTrailingRsiStop'),
            ('enable_price_trailing_stop', 'enablePriceTrailingStop'),
            ('price_trailing_stop_distance_usdt', 'priceTrailingStopDistanceUSDT'),
            ('price_trailing_stop_activation_pnl_usdt', 'priceTrailingStopActivationPnlUSDT'),
            ('enable_pnl_trailing_stop', 'enablePnlTrailingStop'),
            ('pnl_trailing_stop_activation_usdt', 'pnlTrailingStopActivationUSDT'),
            ('pnl_trailing_stop_drop_usdt', 'pnlTrailingStopDropUSDT'),
            ('evaluate_open_interest_increase', 'evaluateOpenInterestIncrease'),
            ('open_interest_period', 'openInterestPeriod'),
            ('evaluate_ma_filter', 'evaluateMaFilter'),
            ('ma_period', 'maPeriod'),
            ('evaluate_support_strategy', 'evaluateSupportStrategy'),
            ('support_history_candles', 'supportHistoryCandles'),
            ('support_pivot_window', 'supportPivotWindow'),
            ('support_confirmations', 'supportConfirmations'),
            ('support_level_tolerance_percent', 'supportLevelTolerancePercent'),
            ('support_order_stop_loss_percent', 'supportOrderStopLossPercent'),
            ('support_order_take_profit_percent', 'supportOrderTakeProfitPercent'),
            ('enable_dca_reentry', 'enableDcaReentry'),
            ('dca_reentry_mode', 'dcaReentryMode'),
            ('dca_price_drop_percent', 'dcaPriceDropPercent'),
            ('dca_trigger_loss_usdt', 'dcaTriggerLossUsdt'),
            ('dca_max_reentries', 'dcaMaxReentries'),
            ('dca_volume_multiplier', 'dcaVolumeMultiplier'),
            ('risk_percentage', 'riskPercentage'),

            # --- CIRCUIT BREAKERS Y PROTECCIÓN DE RIESGO ---
            ('enable_max_loss_per_symbol', 'enableMaxLossPerSymbol'),
            ('max_loss_per_symbol_usdt', 'maxLossPerSymbolUSDT'),
            ('enable_consecutive_losses_cooldown', 'enableConsecutiveLossesCooldown'),
            ('max_consecutive_losses', 'maxConsecutiveLosses'),
            ('consecutive_losses_cooldown_minutes', 'consecutiveLossesCooldownMinutes'),
            ('enable_rolling_performance_filter', 'enableRollingPerformanceFilter'),
            ('rolling_trades_window', 'rollingTradesWindow'),
            ('rolling_max_losses', 'rollingMaxLosses'),
            ('rolling_filter_cooldown_minutes', 'rollingFilterCooldownMinutes'),
            ('enable_btc_crash_shield', 'enableBtcCrashShield'),
            ('btc_crash_timeframe', 'btcCrashTimeframe'),
            ('btc_crash_drop_percent', 'btcCrashDropPercent'),
            ('btc_crash_shield_cooldown_minutes', 'btcCrashShieldCooldownMinutes'),

            # --- FILTRO DE RÉGIMEN DE MERCADO (TENDENCIA MACRO) ---
            ('enable_market_regime_filter', 'enableMarketRegimeFilter'),
            ('market_regime_mode', 'marketRegimeMode'),
            ('market_regime_indicator', 'marketRegimeIndicator'),
            ('market_regime_timeframe', 'marketRegimeTimeframe'),
            ('market_regime_ema_period', 'marketRegimeEmaPeriod'),
            ('market_regime_supertrend_period', 'marketRegimeSupertrendPeriod'),
            ('market_regime_supertrend_multiplier', 'marketRegimeSupertrendMultiplier'),

            # --- SALIDA DE EMERGENCIA POR CRASH ---
            ('enable_emergency_crash_exit', 'enableEmergencyCrashExit'),
            ('enable_crash_rsi_drop', 'enableCrashRsiDrop'),
            ('crash_rsi_drop_threshold', 'crashRsiDropThreshold'),
            ('enable_crash_price_drop', 'enableCrashPriceDrop'),
            ('crash_price_drop_percent', 'crashPriceDropPercent'),
            ('enable_crash_pnl_drop', 'enableCrashPnlDrop'),
            ('crash_pnl_drop_threshold_usdt', 'crashPnlDropThresholdUSDT'),

            # --- OPERATIVA BIDIRECCIONAL Y ESPEJO SHORT ---
            ('trade_direction', 'tradeDirection'),
            ('auto_mirror_short', 'autoMirrorShort'),
            ('rsi_short_entry_level_low', 'rsiShortEntryLevelLow'),
            ('rsi_short_entry_level_high', 'rsiShortEntryLevelHigh'),
            ('rsi_threshold_down', 'rsiThresholdDown'),

            # --- SMART HEDGE & RESGUARDO DINÁMICO ---
            ('enable_hedge_protection', 'enableHedgeProtection'),
            ('hedge_trigger_type', 'hedgeTriggerType'),
            ('hedge_trigger_value', 'hedgeTriggerValue'),
            ('hedge_size_multiplier', 'hedgeSizeMultiplier'),
            ('enable_hedge_trailing_stop', 'enableHedgeTrailingStop'),
            ('hedge_trailing_activation_usdt', 'hedgeTrailingActivationUSDT'),
            ('hedge_trailing_drop_usdt', 'hedgeTrailingDropUSDT'),
            ('enable_hedge_basket_exit', 'enableHedgeBasketExit'),
            ('hedge_basket_target_usdt', 'hedgeBasketTargetUSDT'),
            ('hedge_reentry_cooldown_seconds', 'hedgeReentryCooldownSeconds'),
            ('enable_hedge_recovery_protection', 'enableHedgeRecoveryProtection'),
            ('hedge_max_bounce_percent', 'hedgeMaxBouncePercent'),
            ('hedge_recovery_candles_window', 'hedgeRecoveryCandlesWindow'),
            ('hedge_recovery_candles_threshold', 'hedgeRecoveryCandlesThreshold'),
            ('enable_hedge_breakout_requirement', 'enableHedgeBreakoutRequirement'),
        ]:
            if key_ini in config_dict['TRADING']:
                raw_v = config_dict['TRADING'][key_ini]
                if key_ini.startswith('enable_') or key_ini.startswith('evaluate_') or key_ini in ('auto_mirror_short',):
                    val = str(raw_v).lower() == 'true'
                else:
                    val = raw_v
                frontend_config[key_frontend] = val
                frontend_config[key_ini] = val

    # Garantizar que entryOrderType y entry_order_type estén siempre sincronizados y no sean None
    ot = str(frontend_config.get('entryOrderType') or frontend_config.get('entry_order_type') or 'MARKET').upper().strip()
    if ot not in ('LIMIT', 'MARKET'):
        ot = 'MARKET'
    frontend_config['entryOrderType'] = ot
    frontend_config['entry_order_type'] = ot
    if 'riskPercentage' not in frontend_config:
        try:
            frontend_config['riskPercentage'] = float(risk_manager.risk_percentage * Decimal('100'))
        except Exception:
            frontend_config['riskPercentage'] = 50
    if 'SYMBOLS' in config_dict:
        frontend_config['symbolsToTrade'] = config_dict['SYMBOLS'].get('symbols_to_trade', '')
    if 'STRATEGY_INFO' in config_dict:
        frontend_config['activeStrategyName'] = config_dict['STRATEGY_INFO'].get('active_strategy_name', '')
    else:
        frontend_config['activeStrategyName'] = ''

    from src.config_loader import is_multi_strategy_enabled, get_symbol_strategy_assignments
    frontend_config['multiStrategyEnabled'] = is_multi_strategy_enabled()
    frontend_config['strategyAssignments'] = get_symbol_strategy_assignments()

    # SOBERANÍA ABSOLUTA DE BASE DE DATOS (Inmune a Git y reinicios)
    try:
        from src.database import get_active_strategy_from_db, get_saved_trading_params_from_db, get_bot_setting
        db_strat = get_active_strategy_from_db()
        if db_strat:
            frontend_config['activeStrategyName'] = db_strat

        db_syms = get_bot_setting('symbols_to_trade')
        if db_syms:
            frontend_config['symbolsToTrade'] = db_syms

        db_params = get_saved_trading_params_from_db()
        if db_params and isinstance(db_params, dict):
            for k, v in db_params.items():
                if k not in ('activeStrategyName', 'symbolsToTrade') or not frontend_config.get(k):
                    frontend_config[k] = v
    except Exception as e_db_f:
        api_logger.warning(f"Error cargando ajustes soberanos desde DB en frontend_config: {e_db_f}")

    return frontend_config


# =====================================================================
# --- ENDPOINTS DE AUTENTICACIÓN Y ROLES (JWT & ESQUEMA A + C) ---
# =====================================================================

@app.route('/api/auth/setup_status', methods=['GET'])
def auth_setup_status_endpoint():
    """Verifica si el sistema requiere el registro del Super Administrador inicial."""
    try:
        total = count_users()
        return jsonify({
            "status": "success",
            "needs_initial_admin": (total == 0),
            "total_users": total
        })
    except Exception as e:
        api_logger.error(f"Error en setup_status: {e}", exc_info=True)
        return jsonify({"status": "error", "message": str(e)}), 500


@app.route('/api/auth/register', methods=['POST'])
def auth_register_endpoint():
    """
    Registro de usuarios:
    - Esquema A: Si es el primer usuario, se crea como 'admin' activo automáticamente.
    - Esquema C: Si ya existe un admin, se crea como 'investor' en estado 'pending' (requiere aprobación).
    """
    try:
        data = request.get_json(force=True, silent=True) or {}
        username = str(data.get('username', '')).strip()
        password = str(data.get('password', '')).strip()
        email = str(data.get('email', '')).strip().lower()

        if not username or not password:
            return jsonify({"status": "error", "message": "Nombre de usuario y contraseña son obligatorios."}), 400

        if len(password) < 6:
            return jsonify({"status": "error", "message": "La contraseña debe tener al menos 6 caracteres."}), 400

        # Validar si ya existe el usuario o correo
        if get_user_by_identifier(username):
            return jsonify({"status": "error", "message": "El nombre de usuario ya está registrado."}), 400

        if email and get_user_by_identifier(email):
            return jsonify({"status": "error", "message": "El correo electrónico ya está registrado."}), 400

        total_users = count_users()
        pwd_hash = hash_password(password)

        investment_amount = data.get('investment_amount', data.get('requested_capital', data.get('initial_capital', 0.0)))
        try:
            investment_amount = max(0.0, float(investment_amount or 0.0))
        except (ValueError, TypeError):
            investment_amount = 0.0

        if total_users == 0:
            # Esquema A: Primer usuario se convierte en Super Admin activo
            user_id = create_user(username=username, email=email, password_hash=pwd_hash, role='admin', status='active', requested_capital=investment_amount)
            if not user_id:
                return jsonify({"status": "error", "message": "Error al registrar el Super Administrador."}), 500

            # Registrar aceptación de términos para admin
            try:
                from src.database import record_terms_acceptance
                record_terms_acceptance(user_id, 'v1.0-2026', ip_address=request.remote_addr, user_agent=request.headers.get('User-Agent'))
            except Exception:
                pass

            token = generate_jwt(user_id=user_id, username=username, role='admin')
            user_data = {
                "id": user_id,
                "username": username,
                "email": email,
                "role": "admin",
                "status": "active",
                "requested_capital": investment_amount,
                "terms_accepted": 1,
                "terms_accepted_version": "v1.0-2026"
            }
            api_logger.info(f"Super Administrador inicial registrado exitosamente: {username}")
            return jsonify({
                "status": "success",
                "message": "¡Super Administrador inicial creado con éxito! Tienes acceso total.",
                "token": token,
                "user": user_data,
                "is_first_user": True
            })
        else:
            # Usuarios quedan activos para acceder de inmediato, configurar sus claves API de Binance y operar su bot
            user_id = create_user(username=username, email=email, password_hash=pwd_hash, role='investor', status='active', requested_capital=investment_amount)
            if not user_id:
                return jsonify({"status": "error", "message": "Error al registrar la cuenta."}), 500

            # Registrar la aceptación de términos firmada en el modal de registro
            try:
                from src.database import record_terms_acceptance
                record_terms_acceptance(user_id, 'v1.0-2026', ip_address=request.remote_addr, user_agent=request.headers.get('User-Agent'))
            except Exception:
                pass

            # Inicializar configuración de bot por defecto
            get_user_bot_settings(user_id)

            token = generate_jwt(user_id=user_id, username=username, role='investor')
            user_data = {
                "id": user_id,
                "username": username,
                "email": email,
                "role": 'investor',
                "status": 'active',
                "account_number": format_account_number(user_id),
                "terms_accepted": 1,
                "terms_accepted_version": "v1.0-2026"
            }
            api_logger.info(f"Nuevo usuario SaaS registrado y activo: {username} (ID: {user_id})")
            return jsonify({
                "status": "success",
                "message": "¡Cuenta creada exitosamente! Ya puedes ingresar tus claves API de Binance y activar tu bot.",
                "token": token,
                "user": user_data,
                "pending_approval": False,
                "requested_capital": investment_amount
            })
    except Exception as e:
        api_logger.error(f"Error en endpoint de registro: {e}", exc_info=True)
        return jsonify({"status": "error", "message": str(e)}), 500


@app.route('/api/auth/login', methods=['POST'])
def auth_login_endpoint():
    """Inicio de sesión para Administradores e Inversionistas."""
    try:
        data = request.get_json(force=True, silent=True) or {}
        identifier = str(data.get('identifier', data.get('username', ''))).strip()
        password = str(data.get('password', '')).strip()

        if not identifier or not password:
            return jsonify({"status": "error", "message": "Por favor ingresa usuario/correo y contraseña."}), 400

        # Verificación anti-fuerza bruta
        is_limited, wait_secs = is_login_rate_limited(identifier)
        if is_limited:
            api_logger.warning(f"Intento de login bloqueado por exceso de intentos fallidos: {identifier}")
            return jsonify({
                "status": "error",
                "message": f"Demasiados intentos fallidos. Por seguridad institucional, el acceso ha sido pausado temporalmente. Intenta nuevamente en {wait_secs} segundos.",
                "code": "RATE_LIMITED"
            }), 429

        user = get_user_by_identifier(identifier)
        if not user:
            record_failed_login(identifier)
            return jsonify({"status": "error", "message": "Credenciales inválidas o usuario no existe."}), 401

        if not verify_password(password, user['password_hash']):
            record_failed_login(identifier)
            return jsonify({"status": "error", "message": "Credenciales inválidas."}), 401

        if user['status'] == 'blocked':
            api_logger.warning(f"Intento de login denegado: usuario {user['username']} se encuentra bloqueado.")
            return jsonify({
                "status": "error",
                "message": "Tu cuenta ha sido suspendida o bloqueada por la administración de WTN Solutions LLC. Contacta a soporte para más detalles.",
                "code": "ACCOUNT_BLOCKED"
            }), 403

        if user['status'] == 'pending':
            return jsonify({
                "status": "error",
                "message": "Tu cuenta está pendiente de aprobación por el Administrador. Te notificaremos cuando esté activa.",
                "code": "ACCOUNT_PENDING"
            }), 403

        if user['status'] == 'rejected':
            return jsonify({
                "status": "error",
                "message": "Tu solicitud de acceso ha sido rechazada por el Administrador.",
                "code": "ACCOUNT_REJECTED"
            }), 403

        # Login exitoso: limpiar historial de intentos fallidos
        clear_failed_logins(identifier)

        # Actualizar último acceso y emitir token
        update_last_login(user['id'])
        token = generate_jwt(user_id=user['id'], username=user['username'], role=user['role'])
        is_adm = (user['role'] == 'admin')
        user_data = {
            "id": user['id'],
            "username": user['username'],
            "email": user['email'],
            "role": user['role'],
            "status": user['status'],
            "account_number": user.get('account_number'),
            "requested_capital": float(user.get('requested_capital') or 0.0),
            "terms_accepted": 1 if is_adm else user.get('terms_accepted', 0),
            "terms_accepted_version": 'v1.0-2026' if is_adm else user.get('terms_accepted_version')
        }
        api_logger.info(f"Sesión iniciada exitosamente: {user['username']} (Rol: {user['role']}, Cuenta: {user.get('account_number')})")
        return jsonify({
            "status": "success",
            "message": "Inicio de sesión exitoso.",
            "token": token,
            "user": user_data
        })
    except Exception as e:
        api_logger.error(f"Error en login: {e}", exc_info=True)
        return jsonify({"status": "error", "message": str(e)}), 500


@app.route('/api/auth/me', methods=['GET'])
@token_required
def auth_me_endpoint():
    """Obtiene el perfil y rol del usuario autenticado actual."""
    user = get_user_by_id(request.current_user['user_id'])
    if not user:
        return jsonify({"status": "error", "message": "Usuario no encontrado."}), 404
    if user.get('role') == 'admin':
        user['terms_accepted'] = 1
        user['terms_accepted_version'] = 'v1.0-2026'
    return jsonify({"status": "success", "user": user})


@app.route('/api/user/accept_terms', methods=['POST'])
@token_required
def accept_terms_endpoint():
    """Registra la firma digital de aceptación de términos y disclaimer legal."""
    try:
        user_id = request.current_user['user_id']
        data = request.get_json() or {}
        terms_version = data.get('version', 'v1.0-2026')
        ip_address = request.remote_addr or request.headers.get('X-Forwarded-For') or '0.0.0.0'
        user_agent = request.headers.get('User-Agent', '')

        try:
            from src.database import record_terms_acceptance
        except ImportError:
            from database import record_terms_acceptance

        success = record_terms_acceptance(user_id, terms_version, ip_address, user_agent)
        if success:
            updated_user = get_user_by_id(user_id)
            return jsonify({
                "status": "success", 
                "message": f"Términos {terms_version} aceptados con firma digital.",
                "user": updated_user
            })
        else:
            return jsonify({"status": "error", "message": "No se pudo registrar la aceptación de términos."}), 500
    except Exception as e:
        api_logger.error(f"Error en accept_terms_endpoint: {e}", exc_info=True)
        return jsonify({"status": "error", "message": str(e)}), 500


@app.route('/api/investor/request_capital', methods=['POST'])
@token_required
def request_capital_endpoint():
    """Registra una solicitud formal de inclusión / depósito de capital en el fondo."""
    try:
        user_id = request.current_user['user_id']
        data = request.get_json() or {}
        amount = float(data.get('amount') or 0.0)

        if amount <= 0:
            return jsonify({"status": "error", "message": "El monto solicitado debe ser mayor a 0 USDT."}), 400

        from .database import request_investor_capital
        success = request_investor_capital(user_id, amount)
        if success:
            return jsonify({
                "status": "success",
                "message": f"Solicitud de inclusión por ${amount:.2f} USDT enviada a revisión por la Administración."
            })
        else:
            return jsonify({"status": "error", "message": "No se pudo registrar la solicitud."}), 500
    except Exception as e:
        api_logger.error(f"Error en request_capital_endpoint: {e}", exc_info=True)
        return jsonify({"status": "error", "message": str(e)}), 500


# =====================================================================
# --- ENDPOINTS EXCLUSIVOS PARA EL INVERSIONISTA (SOLO LECTURA / MI TORTA) ---
# =====================================================================

@app.route('/api/investor/portfolio', methods=['GET'])
@token_required
def investor_portfolio_endpoint():
    """Retorna los datos del portafolio personal del inversionista autenticado."""
    try:
        user_id = request.current_user['user_id']
        live_balance = None
        try:
            live_balance = get_account_balance_usdt()
        except Exception:
            pass

        portfolio = get_investor_portfolio(user_id, live_pool_balance=live_balance)
        if not portfolio:
            return jsonify({"status": "error", "message": "No se encontraron datos para este inversionista."}), 404

        return jsonify({"status": "success", "portfolio": portfolio})
    except Exception as e:
        api_logger.error(f"Error en investor_portfolio: {e}", exc_info=True)
        return jsonify({"status": "error", "message": str(e)}), 500


@app.route('/api/investor/statement', methods=['GET'])
@token_required
def investor_statement_endpoint():
    """Retorna los datos completos para generar el Estado de Cuenta Oficial en PDF."""
    try:
        user_id = request.current_user['user_id']
        live_balance = None
        try:
            live_balance = get_account_balance_usdt()
        except Exception:
            pass

        portfolio = get_investor_portfolio(user_id, live_pool_balance=live_balance)
        if not portfolio:
            return jsonify({"status": "error", "message": "No se encontraron datos para este inversionista."}), 404

        recent_trades = get_all_recent_trades(limit=50)
        return jsonify({
            "status": "success",
            "statement": {
                "generated_at": datetime.now().strftime('%Y-%m-%d %H:%M:%S'),
                "portfolio": portfolio,
                "recent_trades": recent_trades
            }
        })
    except Exception as e:
        api_logger.error(f"Error en investor_statement: {e}", exc_info=True)

# =====================================================================
# --- ENDPOINTS MULTI-TENANT (SaaS): GESTIÓN DE CLAVES API Y BOT PERSONAL ---
# =====================================================================

@app.route('/api/user/keys', methods=['GET'])
@token_required
def user_keys_get_endpoint():
    """Consulta las claves API de Binance asociadas al usuario actual (enmascaradas)."""
    try:
        user_id = request.current_user['user_id']
        keys = get_user_api_keys(user_id=user_id, decrypt=False)
        return jsonify({
            "status": "success",
            "has_keys": bool(keys and keys.get('api_key_masked')),
            "keys": keys or {}
        })
    except Exception as e:
        api_logger.error(f"Error al consultar claves de usuario {request.current_user.get('user_id')}: {e}")
        return jsonify({"status": "error", "message": str(e)}), 500


@app.route('/api/user/keys', methods=['POST'])
@token_required
def user_keys_save_endpoint():
    """Valida contra Binance y guarda las credenciales cifradas con AES-256."""
    try:
        user_id = request.current_user['user_id']
        data = request.get_json(force=True, silent=True) or {}
        api_key = "".join(str(data.get('api_key', '')).split()).strip('"\'')
        api_secret = "".join(str(data.get('api_secret', '')).split()).strip('"\'')
        is_testnet = bool(data.get('is_testnet', False))

        if not api_key or not api_secret:
            return jsonify({"status": "error", "message": "Debes ingresar tu API Key y tu API Secret de Binance."}), 400

        # Verificación activa en tiempo real contra Binance
        verify_result = verify_user_binance_credentials(api_key=api_key, api_secret=api_secret, is_testnet=is_testnet)
        if not verify_result.get('valid'):
            return jsonify({
                "status": "error",
                "message": verify_result.get('error', 'No se pudo verificar la API Key en Binance.'),
                "details": verify_result
            }), 400

        balance_usdt = verify_result.get('balance_usdt', 0.0)
        detected_base_url = verify_result.get('api_base_url')
        network_name = verify_result.get('network', 'Binance')
        saved = save_user_api_keys(
            user_id=user_id,
            api_key=api_key,
            api_secret=api_secret,
            is_testnet=is_testnet,
            is_valid=True,
            balance_detected=balance_usdt,
            api_base_url=detected_base_url
        )

        if not saved:
            return jsonify({"status": "error", "message": "Error al persistir las credenciales en la base de datos."}), 500

        api_logger.info(f"Usuario {user_id} ({request.current_user['username']}) conectó con éxito sus claves de {network_name} (Testnet={is_testnet}, Saldo=${balance_usdt:,.2f})")
        return jsonify({
            "status": "success",
            "message": f"¡Conexión exitosa con {network_name}! Balance detectado: ${balance_usdt:,.2f} USDT.",
            "verification": verify_result
        })
    except Exception as e:
        api_logger.error(f"Error al guardar claves API: {e}", exc_info=True)
        return jsonify({"status": "error", "message": str(e)}), 500


@app.route('/api/user/keys', methods=['DELETE'])
@token_required
def user_keys_delete_endpoint():
    """Elimina las credenciales de API del usuario y apaga su bot por seguridad."""
    try:
        user_id = request.current_user['user_id']
        update_user_bot_settings(user_id=user_id, is_running=False)
        deleted = delete_user_api_keys(user_id=user_id)
        if deleted:
            api_logger.info(f"Usuario {user_id} eliminó sus claves API.")
            return jsonify({"status": "success", "message": "Claves API eliminadas de forma segura."})
        return jsonify({"status": "error", "message": "No se encontraron claves registradas para eliminar."}), 404
    except Exception as e:
        api_logger.error(f"Error al eliminar claves: {e}")
        return jsonify({"status": "error", "message": str(e)}), 500


@app.route('/api/user/bot', methods=['GET'])
@token_required
def user_bot_status_endpoint():
    """Retorna el estado operativo, parámetros de trading y métricas del bot del usuario con balance en vivo de Binance."""
    try:
        user_id = request.current_user['user_id']
        settings = get_user_bot_settings(user_id=user_id)
        keys = get_user_api_keys(user_id=user_id, decrypt=True)
        metrics = get_user_trading_metrics(user_id=user_id)

        live_balance = float(keys.get('balance_detected', 0.0)) if keys else 0.0

        # Si el usuario tiene credenciales válidas, consultar balance en tiempo real en Binance
        if keys and keys.get('is_valid') and keys.get('api_key') and keys.get('api_secret'):
            try:
                from src.binance_client import get_user_futures_client
                u_client = get_user_futures_client(
                    api_key=keys['api_key'],
                    api_secret=keys['api_secret'],
                    is_testnet=bool(keys.get('is_testnet', False)),
                    base_url=keys.get('api_base_url')
                )
                balances = u_client.balance()
                if isinstance(balances, list):
                    for b in balances:
                        if str(b.get('asset', '')).upper() == 'USDT':
                            live_balance = round(float(b.get('balance', 0.0) or b.get('availableBalance', 0.0) or 0.0), 2)
                            break
                    # Sincronizar en DB de forma silenciosa
                    from src.database import update_user_api_keys_balance
                    update_user_api_keys_balance(user_id=user_id, balance_usdt=live_balance)
            except Exception as e_live:
                api_logger.debug(f"Aviso al consultar balance en vivo para usuario {user_id}: {e_live}")

        cfg_temp = load_config()
        active_strategy = cfg_temp.get('STRATEGY_INFO', 'active_strategy_name', fallback='').strip() or 'v18_v17_RSI-SNIPER-MOMENTUM_con12xyTS5c3_sinSL_3DCA0c8_ReDi5c5'

        return jsonify({
            "status": "success",
            "bot_settings": settings,
            "has_valid_keys": bool(keys and keys.get('is_valid')),
            "is_testnet": bool(keys.get('is_testnet', False)) if keys else False,
            "api_key_masked": keys.get('api_key_masked') if keys else None,
            "balance_usdt": live_balance,
            "active_strategy": active_strategy,
            "metrics": metrics
        })
    except Exception as e:
        api_logger.error(f"Error al consultar estado de bot de usuario: {e}")
        return jsonify({"status": "error", "message": str(e)}), 500


@app.route('/api/user/bot/toggle', methods=['POST'])
@token_required
def user_bot_toggle_endpoint():
    """Activa o pausa el bot personal del usuario."""
    try:
        user_id = request.current_user['user_id']
        keys = get_user_api_keys(user_id=user_id, decrypt=False)
        if not keys or not keys.get('is_valid'):
            return jsonify({
                "status": "error",
                "message": "Antes de activar el bot debes conectar y verificar tus claves API de Binance."
            }), 400

        data = request.get_json(force=True, silent=True) or {}
        settings = get_user_bot_settings(user_id=user_id)
        current_state = bool(settings.get('is_running', False))
        target_state = bool(data.get('is_running', not current_state))
        target_mode = str(data.get('operating_mode', '')).upper().strip()

        now_str = datetime.now().strftime('%Y-%m-%d %H:%M:%S')
        toggle_kwargs = {'is_running': target_state, 'error_message': None}
        if target_mode in ['COPY_TRADING', 'PERSONAL_BOT']:
            toggle_kwargs['operating_mode'] = target_mode

        if target_state:
            toggle_kwargs['last_started_at'] = now_str
            ok = update_user_bot_settings(user_id=user_id, **toggle_kwargs)
            if not ok:
                return jsonify({"status": "error", "message": "No se pudo actualizar el estado del bot en la base de datos."}), 500
            mode_label = "Copy-Trading Espejo" if target_mode == 'COPY_TRADING' else "Bot Personal Autónomo"
            api_logger.info(f"Usuario {user_id} ({request.current_user['username']}) ENCENDIÓ su bot en modo {mode_label}.")
            msg = f"¡Bot activado en modo {mode_label}! El sistema operará según tus preferencias."
        else:
            toggle_kwargs['last_stopped_at'] = now_str
            ok = update_user_bot_settings(user_id=user_id, **toggle_kwargs)
            if not ok:
                return jsonify({"status": "error", "message": "No se pudo pausar el bot en la base de datos."}), 500
            api_logger.info(f"Usuario {user_id} ({request.current_user['username']}) PAUSÓ su bot.")
            msg = "Bot pausado. No se abrirán nuevas operaciones."

        new_settings = get_user_bot_settings(user_id=user_id)
        return jsonify({
            "status": "success",
            "message": msg,
            "is_running": bool(new_settings.get('is_running', target_state)),
            "bot_settings": new_settings
        })
    except Exception as e:
        api_logger.error(f"Error en toggle de bot de usuario: {e}")
        return jsonify({"status": "error", "message": str(e)}), 500


@app.route('/api/user/bot/settings', methods=['POST'])
@token_required
def user_bot_update_settings_endpoint():
    """Actualiza capital asignado, apalancamiento y pares para el bot personal del usuario."""
    try:
        user_id = request.current_user['user_id']
        data = request.get_json(force=True, silent=True) or {}

        updates = {}
        if 'allocated_usdt' in data:
            try:
                updates['allocated_usdt'] = max(10.0, float(data['allocated_usdt']))
            except (ValueError, TypeError):
                pass
        if 'leverage' in data:
            try:
                updates['leverage'] = min(50, max(1, int(data['leverage'])))
            except (ValueError, TypeError):
                pass
        if 'margin_type' in data:
            m_type = str(data['margin_type']).upper().strip()
            if m_type in ['ISOLATED', 'CROSSED']:
                updates['margin_type'] = m_type
        if 'symbols_to_trade' in data:
            syms = [s.strip().upper() for s in str(data['symbols_to_trade']).split(',') if s.strip()]
            if syms:
                updates['symbols_to_trade'] = ','.join(syms)
        if 'strategy_name' in data:
            strat_name = str(data['strategy_name']).strip()
            if strat_name:
                updates['strategy_name'] = strat_name
        if 'operating_mode' in data:
            mode = str(data['operating_mode']).upper().strip()
            if mode in ['COPY_TRADING', 'PERSONAL_BOT']:
                updates['operating_mode'] = mode

        if updates:
            update_user_bot_settings(user_id=user_id, **updates)

        new_settings = get_user_bot_settings(user_id=user_id)
        return jsonify({
            "status": "success",
            "message": "Configuración de tu bot actualizada con éxito.",
            "bot_settings": new_settings
        })
    except Exception as e:
        api_logger.error(f"Error al actualizar settings de bot de usuario: {e}")
        return jsonify({"status": "error", "message": str(e)}), 500


@app.route('/api/user/trades', methods=['GET'])
@token_required
def user_trades_endpoint():
    """Retorna las operaciones personales y métricas de rendimiento del usuario."""
    try:
        user_id = request.current_user['user_id']
        limit = min(200, int(request.args.get('limit', 50)))
        trades = get_user_trades(user_id=user_id, limit=limit)
        metrics = get_user_trading_metrics(user_id=user_id)
        return jsonify({
            "status": "success",
            "trades": trades,
            "metrics": metrics
        })
    except Exception as e:
        api_logger.error(f"Error al obtener trades de usuario: {e}")
        return jsonify({"status": "error", "message": str(e)}), 500


# =====================================================================
# --- ENDPOINTS EXCLUSIVOS DEL SUPER ADMINISTRADOR (GESTIÓN & BACKUP) ---
# =====================================================================

@app.route('/api/admin/investors', methods=['GET'])
@admin_required
def admin_investors_endpoint():
    """Retorna la lista completa de inversionistas, solicitudes y resumen del pool."""
    try:
        live_balance = None
        try:
            live_balance = get_account_balance_usdt()
        except Exception:
            pass

        summary = get_all_investors_summary(live_pool_balance=live_balance)
        return jsonify({"status": "success", "data": summary})
    except Exception as e:
        api_logger.error(f"Error en admin_investors: {e}", exc_info=True)
        return jsonify({"status": "error", "message": str(e)}), 500


@app.route('/api/admin/approve_user', methods=['POST'])
@admin_required
def admin_approve_user_endpoint():
    """Aprueba la cuenta de un inversionista y le asigna su capital inicial."""
    try:
        data = request.get_json(force=True, silent=True) or {}
        user_id = data.get('user_id')
        initial_capital = float(data.get('initial_capital', 0.0) or 0.0)

        if not user_id:
            return jsonify({"status": "error", "message": "El campo user_id es requerido."}), 400

        success = approve_user(user_id=int(user_id), initial_capital=initial_capital)
        if success:
            api_logger.info(f"Usuario {user_id} aprobado por el Admin con capital inicial de ${initial_capital} USDT")
            return jsonify({"status": "success", "message": "Usuario aprobado correctamente y capital registrado."})
        return jsonify({"status": "error", "message": "No se pudo aprobar al usuario."}), 500
    except Exception as e:
        api_logger.error(f"Error en admin_approve_user: {e}", exc_info=True)
        return jsonify({"status": "error", "message": str(e)}), 500


@app.route('/api/admin/reject_user', methods=['POST'])
@admin_required
def admin_reject_user_endpoint():
    """Rechaza la solicitud de un usuario."""
    try:
        data = request.get_json(force=True, silent=True) or {}
        user_id = data.get('user_id')

        if not user_id:
            return jsonify({"status": "error", "message": "El campo user_id es requerido."}), 400

        success = reject_user(user_id=int(user_id))
        if success:
            api_logger.info(f"Usuario {user_id} rechazado por el Admin.")
            return jsonify({"status": "success", "message": "Solicitud rechazada."})
        return jsonify({"status": "error", "message": "No se pudo rechazar al usuario."}), 500
    except Exception as e:
        api_logger.error(f"Error en admin_reject_user: {e}", exc_info=True)
        return jsonify({"status": "error", "message": str(e)}), 500


@app.route('/api/admin/modify_capital', methods=['POST'])
@admin_required
def admin_modify_capital_endpoint():
    """Registra una nueva inyección o retiro de capital para un inversionista."""
    try:
        data = request.get_json(force=True, silent=True) or {}
        user_id = data.get('user_id')
        amount = float(data.get('amount', 0.0) or 0.0)
        tx_type = str(data.get('type', 'DEPOSIT')).upper()
        notes = str(data.get('notes', '')).strip()

        if not user_id or amount <= 0 or tx_type not in ('DEPOSIT', 'WITHDRAWAL'):
            return jsonify({"status": "error", "message": "Datos de movimiento de capital inválidos."}), 400

        success = add_investor_transaction(user_id=int(user_id), amount_usdt=amount, transaction_type=tx_type, notes=notes)
        if success:
            clear_requested_capital(int(user_id))
            api_logger.info(f"Movimiento {tx_type} de ${amount} USDT registrado para usuario {user_id}")
            return jsonify({"status": "success", "message": f"Movimiento de {tx_type} registrado exitosamente."})
        return jsonify({"status": "error", "message": "Error al registrar el movimiento."}), 500
    except Exception as e:
        api_logger.error(f"Error en admin_modify_capital: {e}", exc_info=True)
        return jsonify({"status": "error", "message": str(e)}), 500


@app.route('/api/admin/clear_requested_capital', methods=['POST'])
@admin_required
def admin_clear_requested_capital_endpoint():
    """Limpia o descarta la solicitud de aporte de capital de un usuario."""
    try:
        data = request.get_json(force=True, silent=True) or {}
        user_id = data.get('user_id')
        if not user_id:
            return jsonify({"status": "error", "message": "El campo user_id es requerido."}), 400

        success = clear_requested_capital(int(user_id))
        if success:
            return jsonify({"status": "success", "message": "Solicitud de capital despejada correctamente."})
        return jsonify({"status": "error", "message": "No se pudo descartar la solicitud."}), 500
    except Exception as e:
        api_logger.error(f"Error en admin_clear_requested_capital: {e}", exc_info=True)
        return jsonify({"status": "error", "message": str(e)}), 500


@app.route('/api/admin/backup_db', methods=['GET'])
@admin_required
def admin_backup_db_endpoint():
    """Descarga directa de backup institucional en formato JSON desde PostgreSQL."""
    try:
        from src.database import get_db_connection
        conn = get_db_connection()
        if not conn:
            return jsonify({"status": "error", "message": "No se pudo conectar a la base de datos PostgreSQL."}), 500

        cursor = conn.cursor()
        backup_data = {
            "timestamp": datetime.now().isoformat(),
            "engine": "PostgreSQL",
            "trades": [],
            "bot_settings": {}
        }

        try:
            cursor.execute("SELECT * FROM trades ORDER BY id ASC")
            rows = cursor.fetchall()
            backup_data["trades"] = [dict(r) for r in rows]
        except Exception:
            pass

        try:
            cursor.execute("SELECT key, value FROM bot_settings")
            for r in cursor.fetchall():
                k = r['key'] if (isinstance(r, dict) or hasattr(r, '__getitem__')) else r[0]
                v = r['value'] if (isinstance(r, dict) or hasattr(r, '__getitem__')) else r[1]
                backup_data["bot_settings"][k] = v
        except Exception:
            pass

        conn.close()

        timestamp_str = datetime.now().strftime('%Y%m%d_%H%M%S')
        download_filename = f"backup_postgres_{timestamp_str}.json"

        response = make_response(json.dumps(backup_data, indent=2, default=str))
        response.headers['Content-Disposition'] = f'attachment; filename={download_filename}'
        response.mimetype = 'application/json'
        return response
    except Exception as e:
        api_logger.error(f"Error al generar backup de DB: {e}", exc_info=True)
        return jsonify({"status": "error", "message": str(e)}), 500


@app.route('/api/admin/toggle_user_status', methods=['POST'])
@admin_required
def admin_toggle_user_status_endpoint():
    """Bloquea o reactiva inmediatamente la cuenta de un usuario."""
    try:
        data = request.get_json(force=True, silent=True) or {}
        user_id = data.get('user_id')
        new_status = data.get('status')

        if not user_id or new_status not in ('active', 'blocked'):
            return jsonify({"status": "error", "message": "Parámetros inválidos. Se requiere user_id y status ('active' o 'blocked')."}), 400

        success = toggle_user_status(int(user_id), new_status)
        if success:
            action_desc = "bloqueado" if new_status == 'blocked' else "reactivado"
            api_logger.warning(f"Super Admin cambió estado de usuario {user_id} a '{new_status}' ({action_desc})")
            return jsonify({
                "status": "success",
                "message": f"Usuario {action_desc} exitosamente.",
                "new_status": new_status,
                "user_id": int(user_id)
            })
        return jsonify({"status": "error", "message": "No se pudo actualizar el estado del usuario."}), 500
    except Exception as e:
        api_logger.error(f"Error en admin_toggle_user_status: {e}", exc_info=True)
        return jsonify({"status": "error", "message": str(e)}), 500


@app.route('/api/admin/investor_dossier/<int:user_id>', methods=['GET'])
@admin_required
def admin_investor_dossier_endpoint(user_id):
    """Retorna la Ficha Técnica 360° de un inversionista para el Administrador."""
    try:
        live_balance = None
        try:
            live_balance = get_account_balance_usdt()
        except Exception:
            pass

        dossier = get_admin_investor_dossier(int(user_id), live_pool_balance=live_balance)
        if not dossier:
            return jsonify({"status": "error", "message": "Inversionista no encontrado o no tiene perfil asignado."}), 404

        return jsonify({"status": "success", "dossier": dossier})
    except Exception as e:
        api_logger.error(f"Error en admin_investor_dossier: {e}", exc_info=True)
        return jsonify({"status": "error", "message": str(e)}), 500



@app.route('/api/config', methods=['GET'])
def get_config_endpoint():
    """Endpoint para obtener la configuración actual."""
    global loaded_trading_params, loaded_symbols_to_trade
    api_logger.info("Solicitud GET /api/config recibida.")
    try:
        frontend_config = _build_frontend_config_dict()
        if not frontend_config:
            return jsonify({"error": "Config not available"}), 404
        return jsonify(frontend_config), 200
    except Exception as e:
        api_logger.error(f"Error al procesar la configuración: {e}", exc_info=True)
        return jsonify({"error": f"Error processing config: {e}"}), 500


@app.route('/api/config', methods=['POST'])
def update_config_endpoint():
    """Endpoint para recibir y guardar la configuración, incluyendo símbolos y sincronización de estrategia."""
    logger = get_logger()
    logger.info("Recibida petición POST /api/config")
    
    if not request.is_json:
        logger.error("Petición POST no contenía JSON.")
        return jsonify({"error": "Request must be JSON"}), 400

    frontend_data = request.get_json()
    if not frontend_data:
        logger.error("JSON recibido estaba vacío.")
        return jsonify({"error": "No data received"}), 400

    logger.debug(f"Datos recibidos del frontend: {frontend_data}")

    # Extraer activeStrategyName del payload
    active_strategy_name_from_frontend = frontend_data.get('activeStrategyName') or frontend_data.get('strategy_name') or ''
    actual_name_to_save_in_ini = '' if active_strategy_name_from_frontend == 'Configuración Modificada' else active_strategy_name_from_frontend

    # 1. Extraer y limpiar la lista de símbolos
    symbols_string_raw = frontend_data.get('symbolsToTrade', '')
    symbols_list = [s.strip().upper() for s in symbols_string_raw.split(',') if s.strip()]
    symbols_to_save = ",".join(symbols_list)
    logger.debug(f"Símbolos procesados para guardar: {symbols_to_save}")

    # 2. Mapear los otros parámetros (BINANCE, TRADING)
    ini_other_data = map_frontend_trading_binance(frontend_data)

    config = configparser.ConfigParser(interpolation=None, inline_comment_prefixes=(';', '#'))
    try:
        if os.path.exists(CONFIG_FILE_PATH):
             config.read(CONFIG_FILE_PATH, encoding='utf-8')
        else:
             logger.warning(f"El archivo {CONFIG_FILE_PATH} no existía, se creará uno nuevo.")

        # 3. Actualizar BINANCE y TRADING
        for section, keys in ini_other_data.items():
            if not config.has_section(section):
                config.add_section(section)
            for key, value in keys.items():
                config.set(section, key, str(value))
                
        # 4. Actualizar [SYMBOLS]
        if not config.has_section('SYMBOLS'):
            config.add_section('SYMBOLS')
        config.set('SYMBOLS', 'symbols_to_trade', symbols_to_save)

        # 5. Guardar active_strategy_name en [STRATEGY_INFO]
        if not config.has_section('STRATEGY_INFO'):
            config.add_section('STRATEGY_INFO')
        config.set('STRATEGY_INFO', 'active_strategy_name', actual_name_to_save_in_ini)

        # 5.1 Guardar configuración MULTI_STRATEGY en config.ini
        if not config.has_section('MULTI_STRATEGY'):
            config.add_section('MULTI_STRATEGY')
        if 'multiStrategyEnabled' in frontend_data:
            config.set('MULTI_STRATEGY', 'enabled', str(frontend_data['multiStrategyEnabled']).lower())
        if 'strategyAssignments' in frontend_data and isinstance(frontend_data['strategyAssignments'], dict):
            for opt in list(config.options('MULTI_STRATEGY')):
                if opt.lower() != 'enabled':
                    config.remove_option('MULTI_STRATEGY', opt)
            for sym, s_name in frontend_data['strategyAssignments'].items():
                if sym and s_name and str(s_name).strip().lower() != 'global':
                    config.set('MULTI_STRATEGY', sym.strip().lower(), str(s_name).strip())

            # Garantizar que todos los símbolos en symbols_list tengan su asignación explícita
            from src.config_loader import get_strategy_for_symbol
            fallback_strat = actual_name_to_save_in_ini or config.get('STRATEGY_INFO', 'active_strategy_name', fallback='').strip()
            if not fallback_strat or fallback_strat.lower() == 'global':
                fallback_strat = get_strategy_for_symbol(symbols_list[0] if symbols_list else 'BTCUSDT')
            for sym in symbols_list:
                sym_lower = sym.lower()
                if not config.has_option('MULTI_STRATEGY', sym_lower) or config.get('MULTI_STRATEGY', sym_lower).strip().lower() == 'global':
                    config.set('MULTI_STRATEGY', sym_lower, fallback_strat)

        # 6. Escribir cambios a config.ini
        with open(CONFIG_FILE_PATH, 'w', encoding='utf-8') as configfile:
            config.write(configfile)

        # 7. Sincronizar automáticamente en strategies/<name>.json si hay un nombre de estrategia válido
        if actual_name_to_save_in_ini and not any(c in actual_name_to_save_in_ini for c in ('.', '/', '\\')):
            try:
                os.makedirs(STRATEGIES_PATH, exist_ok=True)
                strat_file_path = os.path.join(STRATEGIES_PATH, f"{actual_name_to_save_in_ini}.json")
                strat_clean_data = {
                    **frontend_data,
                    "symbolsToTrade": symbols_to_save,
                    "activeStrategyName": actual_name_to_save_in_ini,
                    "entryOrderType": ini_other_data['TRADING']['entry_order_type'],
                    "entry_order_type": ini_other_data['TRADING']['entry_order_type'],
                }
                with open(strat_file_path, 'w', encoding='utf-8') as sf:
                    json.dump(strat_clean_data, sf, indent=4)
                logger.info(f"Estrategia '{actual_name_to_save_in_ini}' sincronizada en {strat_file_path}")
            except Exception as e_strat:
                logger.warning(f"No se pudo escribir archivo de estrategia '{actual_name_to_save_in_ini}': {e_strat}")

        # 8. SOBERANÍA ABSOLUTA EN BASE DE DATOS (Inmune a Git y reinicios)
        try:
            from src.database import set_active_strategy_in_db, set_saved_trading_params_in_db, set_bot_setting, upsert_strategy_catalog
            if actual_name_to_save_in_ini:
                set_active_strategy_in_db(actual_name_to_save_in_ini)
                is_pub = bool(frontend_data.get('is_public') or frontend_data.get('isPublic', False))
                r_lvl = str(frontend_data.get('risk_level') or frontend_data.get('riskLevel') or 'MODERADO').upper()
                min_cap = float(frontend_data.get('min_capital_usdt') or frontend_data.get('minCapitalUsdt') or 50.0)
                d_name = str(frontend_data.get('display_name') or frontend_data.get('displayName') or actual_name_to_save_in_ini)
                desc = str(frontend_data.get('description') or '')
                upsert_strategy_catalog(
                    name=actual_name_to_save_in_ini,
                    display_name=d_name,
                    description=desc,
                    risk_level=r_lvl,
                    is_public=is_pub,
                    min_capital_usdt=min_cap,
                    parameters=frontend_data
                )
            if symbols_to_save:
                set_bot_setting('symbols_to_trade', symbols_to_save)
            if 'multiStrategyEnabled' in frontend_data:
                set_bot_setting('multi_strategy_enabled', str(frontend_data['multiStrategyEnabled']).lower())
            if 'strategyAssignments' in frontend_data and isinstance(frontend_data['strategyAssignments'], dict):
                set_bot_setting('strategy_assignments', json.dumps(frontend_data['strategyAssignments']))
            set_saved_trading_params_in_db(frontend_data)
            logger.info(f"✅ SOBERANÍA DB: Configuración, Estrategia '{actual_name_to_save_in_ini}' y Catálogo blindados en Base de Datos.")
        except Exception as e_db_sv:
            logger.error(f"Error al blindar configuración en DB: {e_db_sv}")

        # Recargar caché de configuración y clientes
        reload_config()
        load_initial_config()

        # Sincronizar explícitamente porcentaje de riesgo con RiskManager
        risk_val = frontend_data.get('riskPercentage') or frontend_data.get('risk_percentage')
        if risk_val is not None:
            try:
                r_pct = Decimal(str(risk_val)) / Decimal('100')
                if Decimal('0') <= r_pct <= Decimal('1'):
                    risk_manager.set_risk_percentage(r_pct)
                    logger.info(f"RiskManager sincronizado en update_config_endpoint: {r_pct:.2%}")
            except Exception as e_r:
                logger.warning(f"Error sincronizando RiskManager: {e_r}")

        # --- HOT-RELOAD EN VIVO: Si los workers están corriendo, actualizar parámetros inmediatamente ---
        if workers_started:
            logger.info("Workers activos detectados. Aplicando parámetros actualizados en caliente a cada bot...")
            from src.config_loader import is_multi_strategy_enabled, get_symbol_strategy_assignments, get_strategy_for_symbol
            is_multi = is_multi_strategy_enabled()
            assignments = get_symbol_strategy_assignments()
            with status_lock:
                for sym, bot_inst in worker_statuses.items():
                    if bot_inst and hasattr(bot_inst, 'update_trading_params'):
                        try:
                            if is_multi and sym.upper() in assignments:
                                s_name = assignments[sym.upper()]
                                s_file = os.path.join(STRATEGIES_PATH, f"{s_name}.json")
                                if os.path.exists(s_file):
                                    with open(s_file, 'r', encoding='utf-8') as f_s:
                                        s_data = json.load(f_s)
                                    s_params = map_frontend_trading_binance(s_data).get('TRADING', loaded_trading_params.copy())
                                    s_params['strategy_name'] = s_name
                                    bot_inst.update_trading_params(s_params)
                                    logger.info(f"-> Hot-reload multi-estrategia exitoso para {sym} con '{s_name}'")
                                    continue
                            params_to_use = loaded_trading_params.copy()
                            params_to_use['entry_order_type'] = ini_other_data['TRADING']['entry_order_type']
                            params_to_use['entryOrderType'] = ini_other_data['TRADING']['entry_order_type']
                            params_to_use['strategy_name'] = actual_name_to_save_in_ini or get_strategy_for_symbol(sym)
                            bot_inst.update_trading_params(params_to_use)
                            logger.info(f"-> Hot-reload exitoso para bot {sym}")
                        except Exception as e_hot:
                            logger.error(f"Error al actualizar parámetros en caliente para {sym}: {e_hot}")

        logger.info(f"Configuración guardada exitosamente. Retornando objeto completo.")
        updated_frontend_config = _build_frontend_config_dict()
        return jsonify(updated_frontend_config), 200

    except Exception as e:
        logger.error(f"Error al escribir la configuración: {e}", exc_info=True) # Log de error
        return jsonify({"error": "Failed to write configuration"}), 500

@app.route('/api/status', methods=['GET'])
def get_worker_status():
    global workers_started
    logger = get_logger()
    logger.debug("API call received for /api/status")
    
    try:
        all_symbols_status = []
        configured_symbols = loaded_symbols_to_trade
        historical_pnl_data = get_cumulative_pnl_by_symbol()

        # --- NUEVO: Variables para agregados de sesión ---
        total_session_pnl = Decimal('0')
        total_unrealized_pnl = Decimal('0')

        with status_lock:
            # Hacemos una copia para evitar problemas de concurrencia y protegemos cada worker
            active_worker_instances = {}
            for symbol, worker in worker_statuses.items():
                if hasattr(worker, 'get_status'):
                    try:
                        active_worker_instances[symbol] = worker.get_status()
                    except Exception as e_w:
                        logger.error(f"[{symbol}] Error al obtener estado del worker: {e_w}", exc_info=True)
                        active_worker_instances[symbol] = {
                            "symbol": symbol,
                            "state": "Error",
                            "last_error": str(e_w),
                            "in_position": False
                        }

        for symbol in configured_symbols:
            # Estado base si el worker no se ha reportado o no está corriendo
            is_symbol_paused = (symbol in paused_symbols)
            status_entry = {
                'symbol': symbol,
                'state': BotState.STOPPED.value if not workers_started else ('Paused' if is_symbol_paused else 'Initializing'),
                'is_paused': is_symbol_paused,
                'historical_pnl': historical_pnl_data.get(symbol, 0.0),
                'session_pnl': 0.0, # Valor por defecto
            }

            if symbol in active_worker_instances and workers_started:
                # Si el worker está activo, usamos su estado completo
                worker_data = active_worker_instances[symbol]
                # Sobrescribimos el estado base con los datos reales
                status_entry.update(worker_data)
                status_entry['is_paused'] = is_symbol_paused or worker_data.get('is_paused', False)
                # Nos aseguramos de que el PNL histórico de la DB (más fiable) prevalezca
                status_entry['historical_pnl'] = historical_pnl_data.get(symbol, 0.0)

                # --- NUEVO: Acumular PNLs para estadísticas de sesión ---
                total_session_pnl += Decimal(str(worker_data.get('session_pnl', 0.0)))
                if worker_data.get('in_position', False):
                    total_unrealized_pnl += Decimal(str(worker_data.get('current_pnl', 0.0)))
            
            # Asegurar que el nombre de la estrategia esté siempre disponible y nunca 'Global'
            if 'strategy_name' not in status_entry or not status_entry.get('strategy_name') or str(status_entry.get('strategy_name')).lower() == 'global':
                from src.config_loader import get_strategy_for_symbol
                status_entry['strategy_name'] = get_strategy_for_symbol(symbol)

            all_symbols_status.append(status_entry)

        # --- NUEVO: Actualizar y obtener estadísticas de sesión ---
        session_manager.update_stats(total_session_pnl, total_unrealized_pnl)
        session_stats = session_manager.get_stats()
        
        # Métricas consolidadas directas de la base de datos
        from src.database import get_total_database_metrics
        db_metrics = get_total_database_metrics()

        # Balance total en vivo de Binance y base de capital inicial del pool
        live_balance = None
        try:
            live_bal_dec = get_account_balance_usdt()
            if live_bal_dec is not None:
                live_balance = float(live_bal_dec)
        except Exception as e_bal:
            logger.debug(f"Error consultando balance de futuros en /api/status: {e_bal}")

        total_pool_deposited = 5000.0  # Base estándar por defecto
        try:
            from src.database import get_db_connection
            conn_pool = get_db_connection()
            if conn_pool:
                cur_p = conn_pool.cursor()
                cur_p.execute("""
                    SELECT 
                        SUM(CASE WHEN it.transaction_type IN ('INITIAL', 'DEPOSIT') THEN it.amount_usdt ELSE 0 END) as total_dep,
                        SUM(CASE WHEN it.transaction_type = 'WITHDRAWAL' THEN it.amount_usdt ELSE 0 END) as total_wd
                    FROM investor_transactions it
                    JOIN users u ON u.id = it.user_id
                    WHERE u.status = 'active'
                """)
                row_p = cur_p.fetchone()
                if row_p and row_p['total_dep'] is not None and float(row_p['total_dep']) > 0:
                    net_dep = float(row_p['total_dep']) - float(row_p['total_wd'] or 0.0)
                    if net_dep > 0:
                        total_pool_deposited = net_dep
                conn_pool.close()
        except Exception:
            pass

        account_balance = live_balance if live_balance is not None else total_pool_deposited
        wallet_pnl = round(account_balance - total_pool_deposited, 4)

        # Telemetría de uso y límites de API de Binance
        api_usage = None
        try:
            from src.binance_client import get_api_usage_stats
            api_usage = get_api_usage_stats(loaded_trading_params, len(loaded_symbols_to_trade))
        except Exception as e_api:
            logger.debug(f"Error obteniendo telemetría de API: {e_api}")

        response_data = {
            "bots_running": workers_started,
            "statuses": all_symbols_status,
            "total_unrealized_pnl": float(total_unrealized_pnl),
            "session_stats": session_stats,
            "global_db_metrics": db_metrics,
            "account_balance": account_balance,
            "initial_capital": total_pool_deposited,
            "wallet_pnl": wallet_pnl,
            "api_usage": api_usage
        }
        
        logger.debug(f"Returning combined statuses. Bots running: {workers_started}")
        return jsonify(response_data)

    except Exception as e:
        logger.error(f"CRITICAL ERROR in /api/status endpoint: {e}", exc_info=True)
        return jsonify({"error": "Internal server error processing status.", "details": str(e)}), 500

@app.route('/api/api_usage', methods=['GET'])
def get_api_usage_endpoint():
    """Retorna las métricas en tiempo real y el análisis predictivo del consumo de la API de Binance."""
    try:
        from src.binance_client import get_api_usage_stats
        data = get_api_usage_stats(loaded_trading_params, len(loaded_symbols_to_trade))
        return jsonify(data), 200
    except Exception as e:
        logger.error(f"Error en /api/api_usage: {e}", exc_info=True)
        return jsonify({"error": str(e)}), 500

@app.route('/api/shutdown', methods=['POST'])
def shutdown_bot():
    global workers_started, threads
    api_logger.warning("Solicitud de apagado recibida a través de la API.")
    
    if not workers_started:
         api_logger.warning("Señal de apagado recibida, pero los workers no estaban iniciados.")
         return jsonify({"message": "Workers no estaban corriendo."}), 200 # O un 4xx?

    session_manager.stop_session() # <-- NUEVO: Detener la sesión
    stop_event.set() 
    api_logger.info("Esperando que los hilos de los workers terminen (join)...")
    
    # Esperar un tiempo razonable para que los hilos terminen
    join_timeout = 10 # segundos
    start_join_time = time.time()
    active_threads = []
    for t in threads:
        t.join(timeout=max(0.1, join_timeout - (time.time() - start_join_time)))
        if t.is_alive():
            active_threads.append(t.name)
            
    if active_threads:
         api_logger.warning(f"Los siguientes hilos no terminaron después de {join_timeout}s: {active_threads}")
    else:
         api_logger.info("Todos los hilos de workers han terminado.")

    workers_started = False # Marcar como detenidos
    threads.clear() # Limpiar la lista de hilos
    # Limpiar estados individuales
    with status_lock:
        worker_statuses.clear()

    return jsonify({"message": "Señal de apagado enviada y workers detenidos."}), 200

# --- NUEVO ENDPOINT PARA INICIAR LOS BOTS ---
@app.route('/api/start_bots', methods=['POST'])
def start_bots_endpoint():
    global workers_started
    logger = get_logger()
    logger.info("Recibida petición POST /api/start_bots")
    
    if workers_started:
        logger.warning("Intento de iniciar workers cuando ya estaban corriendo.")
        return jsonify({"error": "Los bots ya están corriendo."}), 409 # 409 Conflict

    # --- NUEVO: Iniciar una nueva sesión de estadísticas ---
    session_manager.start_session()
    # ----------------------------------------------------

    # Asegurar que se cargue la configuración más reciente desde config.ini
    load_initial_config()

    # Llamar a la función que realmente inicia los hilos, que ahora puede devolver un mensaje de error
    success, message = start_bot_workers() 

    if success:
        return jsonify({"message": message or "Bots iniciados exitosamente."}), 200
    else:
        logger.error(f"Fallo al iniciar los workers: {message}")
        # Devolver el mensaje de error específico al frontend
        return jsonify({"error": message or "Fallo al iniciar los bots (verificar configuración o logs)."}), 500
# ------------------------------------------

# --- NUEVOS ENDPOINTS: CIERRE MANUAL INDIVIDUAL Y GLOBAL DE POSICIONES ---
@app.route('/api/close_position/<symbol>', methods=['POST'])
def close_position_endpoint(symbol):
    symbol = symbol.upper().strip()
    logger = get_logger()
    
    side = request.args.get('side')
    if not side and request.is_json:
        try:
            side = request.json.get('side')
        except Exception:
            side = None
    side = side.upper() if side else None

    logger.warning(f"Solicitud para cerrar posición de {symbol} (lado: {side or 'TODAS'}) recibida en la API.")
    
    worker = None
    with status_lock:
        worker = worker_statuses.get(symbol)
    
    if worker and hasattr(worker, 'close_position_now'):
        try:
            import inspect
            sig = inspect.signature(worker.close_position_now)
            if 'side' in sig.parameters:
                success = worker.close_position_now(reason="Cierre Manual Panel Web", side=side)
            else:
                success = worker.close_position_now(reason="Cierre Manual Panel Web")
            if success:
                return jsonify({"message": f"Posición {side or ''} de {symbol} cerrada exitosamente."}), 200
            else:
                return jsonify({"error": f"No se pudo cerrar la posición de {symbol}."}), 500
        except Exception as e:
            logger.error(f"Error al cerrar posición de {symbol}: {e}", exc_info=True)
            return jsonify({"error": str(e)}), 500
    else:
        try:
            from src.binance_client import get_futures_position, create_futures_market_order
            sides_to_close = [side] if side in ('LONG', 'SHORT') else ['LONG', 'SHORT', None]
            closed_any = False
            for target_side in sides_to_close:
                pos = get_futures_position(symbol, position_side=target_side)
                if pos:
                    amt = float(pos.get('positionAmt', '0'))
                    if abs(amt) > 1e-9:
                        order_side = 'SELL' if (target_side == 'LONG' or amt > 0) else 'BUY'
                        pos_side = pos.get('positionSide', target_side or 'BOTH')
                        order = create_futures_market_order(symbol, side=order_side, quantity=abs(amt), position_side=pos_side, reduce_only=True)
                        if order:
                            closed_any = True
            
            return jsonify({"message": f"Proceso de cierre para {symbol} completado."}), 200
        except Exception as e:
            logger.error(f"Error al cerrar posición externa de {symbol}: {e}", exc_info=True)
            return jsonify({"error": str(e)}), 500

@app.route('/api/bot/<symbol>/toggle_pause', methods=['POST'])
def toggle_bot_pause(symbol):
    global paused_symbols
    symbol = symbol.upper().strip()
    logger = get_logger()
    
    with status_lock:
        worker = worker_statuses.get(symbol)
        current_paused = (symbol in paused_symbols)
        if worker and hasattr(worker, 'is_paused'):
            current_paused = worker.is_paused

        new_paused = not current_paused
        if new_paused:
            paused_symbols.add(symbol)
        else:
            paused_symbols.discard(symbol)

        if worker:
            worker.is_paused = new_paused
            if not new_paused:
                if getattr(worker, 'state', None) == BotState.PAUSED:
                    worker.state = BotState.IDLE
                if hasattr(worker, 'cooldown_until_ts'):
                    worker.cooldown_until_ts = 0.0
                if hasattr(worker, 'pause_reason'):
                    worker.pause_reason = ""
                if hasattr(worker, 'consecutive_losses_count'):
                    worker.consecutive_losses_count = 0

        action_msg = "pausado" if new_paused else "reanudado"
        logger.info(f"Bot {symbol} ha sido {action_msg} individualmente.")
        return jsonify({
            "symbol": symbol,
            "is_paused": new_paused,
            "message": f"Bot {symbol} {action_msg} correctamente."
        }), 200

@app.route('/api/close_all_positions', methods=['POST'])
def close_all_positions_endpoint():
    logger = get_logger()
    logger.warning("🚨 Solicitud GLOBAL para CERRAR TODAS LAS POSICIONES recibida en la API.")
    
    results = {}
    
    # 1. Cerrar a través de los workers activos
    active_workers = {}
    with status_lock:
        active_workers = dict(worker_statuses)
    
    for symbol, worker in active_workers.items():
        if worker and hasattr(worker, 'close_position_now'):
            try:
                # Cancelar órdenes de salida o TP/SL pendientes primero
                if hasattr(worker, '_cancel_active_tp_sl_orders'):
                    worker._cancel_active_tp_sl_orders()
                # Cancelar también orden de entrada límite pendiente si la hubiera
                if getattr(worker, 'pending_entry_order_id', None):
                    try:
                        from src.binance_client import cancel_futures_order
                        cancel_futures_order(symbol, worker.pending_entry_order_id)
                        worker.pending_entry_order_id = None
                        worker.current_state = BotState.IDLE
                    except Exception as e_ce:
                        logger.warning(f"[{symbol}] Aviso al cancelar entrada pendiente: {e_ce}")
                if getattr(worker, 'in_position', False):
                    ok = worker.close_position_now(reason="Cierre Manual Global")
                    results[symbol] = "Cerrada por Worker" if ok else "Fallo en Worker"
            except Exception as e:
                logger.error(f"Error cerrando {symbol} en worker: {e}")
                results[symbol] = f"Error Worker: {e}"
    
    # 2. Consultar y cerrar directamente TODAS las posiciones reales activas en Binance Testnet
    try:
        from src.binance_client import get_futures_client, get_futures_position_information, create_futures_market_order
        from src.database import record_trade, sync_binance_trades_to_db
        
        client = get_futures_client()
        all_positions = get_futures_position_information() or []
        for p in all_positions:
            sym = p.get('symbol')
            if sym in results and "Cerrada" in results[sym]:
                logger.info(f"[{sym}] Posición ya fue cerrada por el worker respectivo. Omitiendo segundo cierre directo.")
                continue

            try:
                amt = float(p.get('positionAmt', '0'))
                if abs(amt) > 1e-9:
                    # Cancelar órdenes abiertas de este símbolo para liberar margen
                    try:
                        if client:
                            client.cancel_open_orders(symbol=sym)
                    except Exception as e_co:
                        logger.warning(f"[{sym}] Aviso al cancelar órdenes abiertas antes del cierre: {e_co}")
                    
                    side = 'SELL' if amt > 0 else 'BUY'
                    raw_ps = p.get('positionSide', 'BOTH')
                    order = create_futures_market_order(sym, side=side, quantity=abs(amt), reduce_only=True, position_side=raw_ps)
                    if order:
                        results[sym] = f"Cerrada en Binance (Orden ID: {order.get('orderId')})"
                        # Sincronizar worker si existe
                        if sym in active_workers and active_workers[sym]:
                            try:
                                active_workers[sym]._reset_state()
                                active_workers[sym].in_position = False
                                active_workers[sym].current_state = BotState.IDLE
                            except Exception as e_res:
                                logger.warning(f"Aviso al resetear worker {sym}: {e_res}")

                        try:
                            entry_price = float(p.get('entryPrice', 0))
                            close_price = float(order.get('avgPrice', order.get('price', 0)))
                            if close_price <= 0:
                                try:
                                    from src.binance_client import get_order_book_ticker
                                    ticker = get_order_book_ticker(sym)
                                    if ticker:
                                        close_price = float(ticker.get('bidPrice' if side == 'SELL' else 'askPrice', entry_price))
                                except Exception:
                                    pass
                            if close_price <= 0:
                                close_price = entry_price
                            gross_pnl = (close_price - entry_price) * abs(amt) if side == 'SELL' else (entry_price - close_price) * abs(amt)
                            comm = round((entry_price * abs(amt) * 0.0002) + (close_price * abs(amt) * 0.0005), 4)
                            net_pnl = round(gross_pnl - comm, 4)
                            record_trade(
                                symbol=sym,
                                trade_type="LONG" if side == 'SELL' else "SHORT",
                                open_timestamp=datetime.now(),
                                open_price=entry_price,
                                quantity=abs(amt),
                                position_size_usdt=entry_price * abs(amt),
                                close_timestamp=datetime.now(),
                                close_price=close_price,
                                pnl_usdt=net_pnl,
                                gross_pnl_usdt=gross_pnl,
                                commission_usdt=comm,
                                close_reason="Cierre Manual Global Testnet",
                                binance_trade_id=order.get('orderId')
                            )
                        except Exception as e_rec:
                            logger.warning(f"Aviso al registrar trade en DB para {sym}: {e_rec}")
                    else:
                        results[sym] = "Fallo al enviar orden a Binance"
            except Exception as e:
                logger.error(f"Error cerrando posición Binance {sym}: {e}")
                results[sym] = f"Error: {e}"
        
        # 3. Limpiar cualquier worker fantasma cuya posición ya esté en 0 en Binance
        open_syms = {p.get('symbol') for p in all_positions if abs(float(p.get('positionAmt', 0))) > 1e-9}
        for symbol, worker in active_workers.items():
            if symbol not in open_syms and getattr(worker, 'in_position', False):
                try:
                    worker._reset_state()
                    worker.in_position = False
                    worker.current_state = BotState.IDLE
                    logger.info(f"[{symbol}] Worker sincronizado a 0 (sin posición real en Binance).")
                except Exception:
                    pass

    except Exception as e:
        logger.error(f"Error consultando posiciones generales de Binance: {e}")
    
    # Sincronizar historial con Binance para que se refleje al instante en Rendimiento
    try:
        from src.database import sync_binance_trades_to_db
        sync_binance_trades_to_db(limit_per_symbol=20)
    except Exception:
        pass
    
    return jsonify({
        "success": True,
        "results": results,
        "details": results,
        "closed_count": len(results),
        "message": f"Se procesaron {len(results)} posiciones." if results else "No se encontraron posiciones activas en Binance Testnet."
    }), 200
# ------------------------------------------------------------------------

# Función para cargar configuración inicial (llamada desde run_bot.py)
def load_initial_config():
    global loaded_trading_params, loaded_symbols_to_trade
    logger = get_logger()
    logger.info("Cargando configuración inicial para API y Workers...")
    config = load_config()
    if not config:
        logger.error("No se pudo cargar la configuración global.")
        return False
        
    loaded_symbols_to_trade = get_trading_symbols() # No necesita argumento
    if not loaded_symbols_to_trade:
        logger.error("No se especificaron símbolos para operar.")
        # Considerar si esto es un error fatal o no
        
    if 'TRADING' not in config:
         logger.error("Sección [TRADING] no encontrada en config.ini.")
         return False
         
    # Cargar todos los parámetros de TRADING como strings inicialmente
    temp_trading_params = dict(config['TRADING'])
    
    # Convertir explícitamente los parámetros a sus tipos correctos
    loaded_trading_params = {}
    for key, value_str in temp_trading_params.items():
        original_value = value_str
        clean_str = str(value_str).strip().replace(',', '.') if value_str is not None else ''
        try:
            if key in ['rsi_period', 'rsi_candles_window', 'rsi_positive_candles_required', 'volume_sma_period', 'cycle_sleep_seconds', 'order_timeout_seconds', 'downtrend_check_candles', 'downtrend_candles_window', 'downtrend_level_check', 'required_uptrend_candles', 'ma_period', 'support_history_candles', 'support_pivot_window', 'support_confirmations', 'max_consecutive_losses', 'consecutive_losses_cooldown_minutes', 'rolling_trades_window', 'rolling_max_losses', 'rolling_filter_cooldown_minutes', 'btc_crash_shield_cooldown_minutes', 'market_regime_ema_period', 'market_regime_supertrend_period', 'hedge_reentry_cooldown_seconds']:
                if not clean_str:
                    loaded_trading_params[key] = 20 if 'period' in key else (60 if 'cooldown' in key else 0)
                else:
                    loaded_trading_params[key] = int(float(clean_str))
            elif key in ['rsi_threshold_up', 'rsi_positive_delta_min', 'rsi_threshold_down', 'rsi_entry_level_low', 'rsi_entry_level_high',
                         'rsi_target',
                         'volume_factor', 'position_size_usdt', 'stop_loss_usdt', 'take_profit_usdt',
                         'price_trailing_stop_distance_usdt',
                         'price_trailing_stop_activation_pnl_usdt',
                         'pnl_trailing_stop_activation_usdt', 'pnl_trailing_stop_drop_usdt',
                         'support_level_tolerance_percent', 'support_order_stop_loss_percent', 'support_order_take_profit_percent',
                         'risk_percentage', 'max_loss_per_symbol_usdt', 'btc_crash_drop_percent', 'market_regime_supertrend_multiplier',
                         'crash_rsi_drop_threshold', 'crash_price_drop_percent', 'crash_pnl_drop_threshold_usdt',
                         'hedge_trigger_value', 'hedge_size_multiplier', 'hedge_trailing_activation_usdt',
                         'hedge_trailing_drop_usdt', 'hedge_basket_target_usdt']:
                if not clean_str:
                    loaded_trading_params[key] = 0.0
                else:
                    loaded_trading_params[key] = float(clean_str)
            elif key in ['evaluate_rsi_delta', 'evaluate_volume_filter', 'evaluate_rsi_range',
                         'evaluate_downtrend_candles_block', 'evaluate_downtrend_levels_block',
                         'evaluate_required_uptrend', 'enable_take_profit_pnl', 'enable_stop_loss_pnl',
                         'enable_trailing_rsi_stop', 'enable_price_trailing_stop', 'enable_pnl_trailing_stop',
                         'evaluate_open_interest_increase', 'evaluate_ma_filter', 'evaluate_support_strategy',
                         'enable_max_loss_per_symbol', 'enable_consecutive_losses_cooldown',
                         'enable_rolling_performance_filter', 'enable_btc_crash_shield', 'enable_market_regime_filter',
                         'enable_emergency_crash_exit', 'enable_crash_rsi_drop', 'enable_crash_price_drop', 'enable_crash_pnl_drop',
                         'enable_hedge_protection', 'enable_hedge_trailing_stop', 'enable_hedge_basket_exit', 'enable_hedge_recovery_protection', 'enable_hedge_breakout_requirement']:
                loaded_trading_params[key] = clean_str.lower() == 'true'
            else:
                loaded_trading_params[key] = clean_str if clean_str != '' else value_str
        except (ValueError, TypeError):
            logger.warning(f"Aviso al convertir parámetro de TRADING '{key}' con valor '{original_value}'. Usando fallback.")
            if key in ['rsi_period', 'volume_sma_period']:
                loaded_trading_params[key] = 20
            elif key in ['cycle_sleep_seconds']:
                loaded_trading_params[key] = 5
            elif key in ['order_timeout_seconds']:
                loaded_trading_params[key] = 10
            else:
                loaded_trading_params[key] = original_value

    if 'risk_percentage' in loaded_trading_params:
        try:
            r_pct = Decimal(str(loaded_trading_params['risk_percentage'])) / Decimal('100')
            if Decimal('0') <= r_pct <= Decimal('1'):
                risk_manager.set_risk_percentage(r_pct)
                logger.info(f"RiskManager sincronizado con porcentaje de riesgo: {r_pct:.2%}")
        except Exception as e_r:
            logger.warning(f"No se pudo sincronizar porcentaje de riesgo con RiskManager: {e_r}")

    # SOBERANÍA ABSOLUTA DE BASE DE DATOS (Inmune a Git y reinicios)
    try:
        from src.database import get_saved_trading_params_from_db, get_bot_setting
        db_symbols = get_bot_setting('symbols_to_trade')
        if db_symbols:
            loaded_symbols_to_trade = [s.strip().upper() for s in db_symbols.split(',') if s.strip()]
        
        db_p = get_saved_trading_params_from_db()
        if db_p and isinstance(db_p, dict):
            mapped_db = map_frontend_trading_binance(db_p)
            if 'TRADING' in mapped_db:
                loaded_trading_params.update(mapped_db['TRADING'])
                logger.info("✅ SOBERANÍA DB: Configuración de TRADING inicial sobreescrita con soberanía desde Base de Datos.")
    except Exception as e_init_db:
        logger.warning(f"Aviso al cargar configuración soberana desde DB al iniciar: {e_init_db}")

    logger.info(f"Configuración inicial cargada: {len(loaded_symbols_to_trade)} símbolos, Params procesados: {loaded_trading_params}")
    return True

# --- NUEVO ENDPOINT PARA HISTORIAL DE TRADES POR SÍMBOLO ---
@app.route('/api/trades/<symbol>', methods=['GET'])
def get_symbol_trade_history(symbol: str):
    """Endpoint para obtener los últimos N trades para un símbolo específico."""
    logger = get_logger()
    logger.info(f"Recibida petición GET /api/trades/{symbol}")
    
    # --- LEER Y VALIDAR EL PARÁMETRO 'limit' --- 
    limit_param = request.args.get('limit', default=20, type=int)
    if limit_param < 1:
        limit_param = 20
    elif limit_param > 1000:
        limit_param = 1000
    # -------------------------------------------
    
    if not symbol:
        logger.error("Petición a /api/trades sin especificar símbolo.")
        return jsonify({"error": "Symbol parameter is required."}), 400
        
    try:
        # --- PASAR limit_param A LA FUNCIÓN DE LA BASE DE DATOS ---
        trades = get_last_n_trades_for_symbol(symbol, n=limit_param)
        logger.info(f"Devolviendo {len(trades)} trades para {symbol} (límite solicitado: {limit_param})")
        # Flask jsonify manejará la conversión de la lista de dicts
        return jsonify(trades)
    except Exception as e:
        logger.error(f"Error inesperado al obtener historial de trades para {symbol}: {e}", exc_info=True)
        return jsonify({"error": f"Failed to retrieve trade history for {symbol}"}), 500
# --- FIN NUEVO ENDPOINT ---

@app.route('/api/all_trades', methods=['GET'])
def get_all_trades_endpoint():
    """Endpoint para obtener los últimos trades de todos los símbolos para gráficos de rendimiento y curvas de capital."""
    logger = get_logger()
    limit_param = request.args.get('limit', default=2000, type=int)
    if limit_param < 1:
        limit_param = 2000
    try:
        # Sincronización automática en vivo con Binance Testnet
        try:
            if time.time() >= _sync_paused_until:
                from src.database import sync_binance_trades_to_db
                sync_binance_trades_to_db(limit_per_symbol=20)
            else:
                logger.debug("Sync pausado post-reset. Reanudará en unos segundos.")
        except Exception as e_sync:
            logger.debug(f"Aviso durante sincronización de trades con Binance: {e_sync}")

        from src.database import get_all_recent_trades, get_total_database_metrics
        trades = get_all_recent_trades(limit=limit_param)
        summary = get_total_database_metrics()
        return jsonify({"trades": trades, "summary": summary})
    except Exception as e:
        logger.error(f"Error al obtener historial general de trades: {e}", exc_info=True)
        return jsonify({"error": str(e), "trades": [], "summary": {}}), 500

@app.route('/api/trades/sync', methods=['POST'])
def sync_trades_endpoint():
    """Sincroniza explícitamente el historial de Binance Testnet a la base de datos."""
    try:
        from src.database import sync_binance_trades_to_db
        count = sync_binance_trades_to_db(limit_per_symbol=50)
        return jsonify({"success": True, "synced_count": count, "message": f"Se sincronizaron {count} trades de Binance Testnet."}), 200
    except Exception as e:
        return jsonify({"success": False, "error": str(e)}), 500

@app.route('/api/trades/reset', methods=['POST'])
def reset_trades_endpoint():
    """Borra el historial de operaciones de la base de datos y establece punto de inicio limpio desde cero."""
    logger = get_logger()
    logger.warning("Solicitud POST /api/trades/reset recibida. Reiniciando historial y PnL.")
    try:
        from src.database import clear_trade_history
        success = clear_trade_history()
        if success:
            global _sync_paused_until
            _sync_paused_until = time.time() + 15  # Pausar sync por 15 segundos post-reset
            session_manager.reset_stats()
            with status_lock:
                for sym, worker in worker_statuses.items():
                    if hasattr(worker, 'session_pnl'):
                        worker.session_pnl = Decimal('0')
                    if hasattr(worker, 'historical_pnl'):
                        worker.historical_pnl = Decimal('0')
            return jsonify({"success": True, "message": "Historial de trades y PnL reiniciado a 0.00 USDT."}), 200
        else:
            return jsonify({"success": False, "error": "No se pudo limpiar la base de datos."}), 500
    except Exception as e:
        logger.error(f"Error al reiniciar historial de trades: {e}", exc_info=True)
        return jsonify({"success": False, "error": str(e)}), 500

# --- ENDPOINT PARA EXPLORADOR Y RADAR DE MERCADO CON CACHÉ ---
_market_data_cache = {
    'timestamp': 0,
    'data': []
}
_market_data_lock = Lock()

@app.route('/api/market_data', methods=['GET'])
def get_market_data_endpoint():
    """Devuelve los tickers 24h de Binance Futures para el explorador y radar de mercado con caché de 30s."""
    global _market_data_cache
    now = time.time()
    with _market_data_lock:
        if now - _market_data_cache['timestamp'] < 30 and _market_data_cache['data']:
            return jsonify(_market_data_cache['data'])
    
    try:
        client = get_futures_client()
        if not client:
            return jsonify(_market_data_cache.get('data', [])), 200
        
        tickers = client.ticker_24hr_price_change()
        formatted = []
        if isinstance(tickers, list):
            for t in tickers:
                sym = t.get('symbol', '')
                if sym.endswith('USDT'):
                    try:
                        formatted.append({
                            'symbol': sym,
                            'price': float(t.get('lastPrice', 0)),
                            'priceChangePercent': float(t.get('priceChangePercent', 0)),
                            'quoteVolume': float(t.get('quoteVolume', 0)),
                            'highPrice': float(t.get('highPrice', 0)),
                            'lowPrice': float(t.get('lowPrice', 0))
                        })
                    except (ValueError, TypeError):
                        continue
        
        # Ordenar por volumen descendente por defecto
        formatted.sort(key=lambda x: x['quoteVolume'], reverse=True)
        
        with _market_data_lock:
            _market_data_cache['timestamp'] = now
            _market_data_cache['data'] = formatted
            
        return jsonify(formatted)
    except Exception as e:
        logger = get_logger()
        logger.error(f"Error al obtener datos de mercado en /api/market_data: {e}")
        return jsonify(_market_data_cache.get('data', [])), 200

# --------------------------------------------------------

# --- NUEVOS ENDPOINTS PARA ESTRATEGIAS ---

def _seed_strategies_catalog_from_files():
    """Siembra el catálogo soberano de la DB con las estrategias iniciales si el catálogo está vacío."""
    logger = get_logger()
    try:
        from src.database import get_strategies_catalog, upsert_strategy_catalog, get_deleted_strategies
        deleted_set = get_deleted_strategies()

        # Limpiar del disco cualquier archivo huérfano que el usuario haya eliminado
        if os.path.exists(STRATEGIES_PATH):
            for f in os.listdir(STRATEGIES_PATH):
                if f.endswith('.json'):
                    s_name = os.path.splitext(f)[0]
                    if s_name in deleted_set:
                        try:
                            os.remove(os.path.join(STRATEGIES_PATH, f))
                            logger.info(f"Archivo huérfano de estrategia eliminada '{s_name}' eliminado de disco.")
                        except Exception:
                            pass

        existing = get_strategies_catalog(only_public=False)
        # SOBERANÍA ABSOLUTA: Si ya existen estrategias en la DB, no auto-sembrar de disco
        if existing:
            return

        if not os.path.exists(STRATEGIES_PATH):
            return
            
        strategy_files = [f for f in os.listdir(STRATEGIES_PATH) if f.endswith('.json')]
        for f in strategy_files:
            s_name = os.path.splitext(f)[0]
            if s_name not in deleted_set:
                full_path = os.path.join(STRATEGIES_PATH, f)
                try:
                    with open(full_path, 'r', encoding='utf-8') as sf:
                        data = json.load(sf)
                    is_pub = bool(data.get('is_public') or data.get('isPublic', False))
                    # Estrategias insignia activas por defecto como públicas
                    if 'v18' in s_name or 'v17' in s_name:
                        is_pub = True
                    r_lvl = str(data.get('risk_level') or data.get('riskLevel') or 'MODERADO').upper()
                    min_cap = float(data.get('min_capital_usdt') or data.get('minCapitalUsdt') or 50.0)
                    d_name = str(data.get('display_name') or data.get('displayName') or s_name)
                    desc = str(data.get('description') or '')
                    if not desc and ('v18' in s_name or 'v17' in s_name):
                        desc = 'Estrategia insignia institucional optimizada con RSI dinámico, Take Profit inteligente y red de seguridad.'
                    upsert_strategy_catalog(
                        name=s_name,
                        display_name=d_name,
                        description=desc,
                        risk_level=r_lvl,
                        is_public=is_pub,
                        min_capital_usdt=min_cap,
                        parameters=data
                    )
                    logger.info(f"Estrategia inicial '{s_name}' sembrada en catálogo soberano de la DB.")
                except Exception as e_seed:
                    logger.warning(f"No se pudo sembrar '{s_name}' en catálogo: {e_seed}")
    except Exception as e:
        logger.error(f"Error en _seed_strategies_catalog_from_files: {e}")

# Funciones auxiliares refactorizadas para manejar la lógica de cada método
def _save_strategy_logic(strategy_name: str, data: dict):
    logger = get_logger()
    strategy_file_path = os.path.join(STRATEGIES_PATH, f"{strategy_name}.json")
    try:
        ot = str(data.get('entryOrderType') or data.get('entry_order_type') or 'MARKET').upper().strip()
        if ot not in ('LIMIT', 'MARKET'):
            ot = 'MARKET'
        data['entryOrderType'] = ot
        data['entry_order_type'] = ot

        with open(strategy_file_path, 'w', encoding='utf-8') as f:
            json.dump(data, f, indent=4)
        logger.info(f"Estrategia '{strategy_name}' guardada exitosamente en {strategy_file_path}")

        # Sincronizar con Catálogo Soberano en DB (Inmune a operaciones Git)
        try:
            from src.database import upsert_strategy_catalog
            is_pub = bool(data.get('is_public') or data.get('isPublic', False))
            r_lvl = str(data.get('risk_level') or data.get('riskLevel') or 'MODERADO').upper().strip()
            min_cap = float(data.get('min_capital_usdt') or data.get('minCapitalUsdt') or 50.0)
            d_name = str(data.get('display_name') or data.get('displayName') or strategy_name).strip()
            desc = str(data.get('description') or '').strip()
            upsert_strategy_catalog(
                name=strategy_name,
                display_name=d_name,
                description=desc,
                risk_level=r_lvl,
                is_public=is_pub,
                min_capital_usdt=min_cap,
                parameters=data
            )
            logger.info(f"Estrategia '{strategy_name}' sincronizada en catálogo DB (is_public={is_pub}).")
        except Exception as e_cat:
            logger.warning(f"Aviso al sincronizar estrategia '{strategy_name}' con el catálogo de DB: {e_cat}")

        # Sincronizar porcentaje de riesgo si viene en los datos de la estrategia
        risk_val = data.get('riskPercentage') or data.get('risk_percentage')
        if risk_val is not None:
            try:
                r_pct = Decimal(str(risk_val)) / Decimal('100')
                if Decimal('0') <= r_pct <= Decimal('1'):
                    risk_manager.set_risk_percentage(r_pct)
                    logger.info(f"RiskManager actualizado con porcentaje de estrategia '{strategy_name}': {r_pct:.2%}")
            except Exception:
                pass

        return jsonify({"message": f"Estrategia '{strategy_name}' guardada exitosamente."}), 201
    except Exception as e:
        logger.error(f"Error al guardar la estrategia '{strategy_name}': {e}", exc_info=True)
        return jsonify({"error": f"Error interno al guardar la estrategia: {str(e)}"}), 500

def _load_strategy_logic(strategy_name: str):
    logger = get_logger()
    strategy_data = None

    # 1. Prioridad Soberana: Base de Datos catálogo primero
    try:
        from src.database import get_strategies_catalog
        catalog = get_strategies_catalog(only_public=False)
        for item in catalog:
            if item.get('name') == strategy_name and item.get('parameters'):
                strategy_data = item.get('parameters', {})
                logger.info(f"Estrategia '{strategy_name}' cargada desde el catálogo soberano de DB.")
                break
    except Exception as e_db:
        logger.warning(f"Error consultando DB para estrategia '{strategy_name}': {e_db}")

    # 2. Respaldo en disco si no existía en DB
    if not strategy_data:
        strategy_file_path = os.path.join(STRATEGIES_PATH, f"{strategy_name}.json")
        if os.path.exists(strategy_file_path):
            try:
                with open(strategy_file_path, 'r', encoding='utf-8') as f:
                    strategy_data = json.load(f)
            except Exception as e_f:
                logger.warning(f"Error al leer archivo JSON para '{strategy_name}': {e_f}")

    if not strategy_data:
        logger.error(f"No se encontró la estrategia: {strategy_name}")
        return jsonify({"error": f"Estrategia '{strategy_name}' no encontrada."}), 404

    try:
        ot = str(strategy_data.get('entryOrderType') or strategy_data.get('entry_order_type') or 'MARKET').upper().strip()
        if ot not in ('LIMIT', 'MARKET'):
            ot = 'MARKET'
        strategy_data['entryOrderType'] = ot
        strategy_data['entry_order_type'] = ot

        logger.info(f"Estrategia '{strategy_name}' cargada exitosamente.")

        # Sincronizar porcentaje de riesgo en caliente al cargar la estrategia
        risk_val = strategy_data.get('riskPercentage') or strategy_data.get('risk_percentage')
        if risk_val is not None:
            try:
                r_pct = Decimal(str(risk_val)) / Decimal('100')
                if Decimal('0') <= r_pct <= Decimal('1'):
                    risk_manager.set_risk_percentage(r_pct)
                    logger.info(f"RiskManager actualizado al cargar estrategia '{strategy_name}': {r_pct:.2%}")
            except Exception:
                pass

        return jsonify(strategy_data), 200
    except Exception as e:
        logger.error(f"Error al procesar la estrategia '{strategy_name}': {e}", exc_info=True)
        return jsonify({"error": f"Error interno al cargar la estrategia: {str(e)}"}), 500

def _delete_strategy_logic(strategy_name: str):
    logger = get_logger()
    strategy_file_path = os.path.join(STRATEGIES_PATH, f"{strategy_name}.json")
    if os.path.exists(strategy_file_path):
        try:
            os.remove(strategy_file_path)
            logger.info(f"Estrategia '{strategy_name}' eliminada exitosamente de {strategy_file_path}")
        except OSError as e_os:
            logger.error(f"Error de OS al eliminar la estrategia '{strategy_name}' desde {strategy_file_path}: {e_os}", exc_info=True)

    # Eliminar permanentemente de la base de datos soberana y registrar en lista negra
    try:
        from src.database import delete_strategy_catalog, mark_strategy_as_deleted
        delete_strategy_catalog(strategy_name)
        mark_strategy_as_deleted(strategy_name)
        logger.info(f"Estrategia '{strategy_name}' eliminada de strategies_catalog y marcada como eliminada en DB.")
    except Exception as e_del:
        logger.warning(f"Error eliminando de strategies_catalog en DB: {e_del}")

    return jsonify({"message": f"Estrategia '{strategy_name}' eliminada exitosamente."}), 200

@app.route('/api/strategies/<strategy_name>', methods=['GET', 'POST', 'DELETE'])
def handle_specific_strategy(strategy_name: str):
    logger = get_logger()
    logger.info(f"Solicitud {request.method} para estrategia: {strategy_name}")

    if not strategy_name or any(c in strategy_name for c in ('.', '/', '\\')):
        logger.error(f"Nombre de estrategia inválido: {strategy_name}. No debe contener '.', '/', o '\\'.")
        return jsonify({"error": "Nombre de estrategia inválido. No debe contener '.', '/', o '\\'."}), 400

    if request.method == 'POST':
        data = request.get_json()
        if not data:
            logger.error("No se recibieron datos JSON para guardar la estrategia.")
            return jsonify({"error": "No se recibieron datos JSON."}), 400
        return _save_strategy_logic(strategy_name, data)
    elif request.method == 'GET':
        return _load_strategy_logic(strategy_name)
    elif request.method == 'DELETE':
        return _delete_strategy_logic(strategy_name)
    else:
        logger.error(f"Método {request.method} no permitido para esta ruta.")
        return jsonify({"error": "Método no permitido"}), 405

@app.route('/api/strategies', methods=['GET'])
def list_strategies():
    logger = get_logger()
    logger.info("Solicitud para listar estrategias guardadas con resumen.")
    try:
        # Asegurar catálogo sembrado si la base de datos está vacía
        _seed_strategies_catalog_from_files()
        from src.database import get_strategies_catalog, get_deleted_strategies
        deleted_set = get_deleted_strategies()
        catalog_items = {s['name']: s for s in get_strategies_catalog(only_public=False) if s['name'] not in deleted_set}

        if not os.path.exists(STRATEGIES_PATH):
            logger.warning(f"El directorio de estrategias {STRATEGIES_PATH} no existe.")
            file_names = []
        else:
            file_names = [os.path.splitext(f)[0] for f in os.listdir(STRATEGIES_PATH) if f.endswith('.json') and os.path.splitext(f)[0] not in deleted_set]

        # Unir nombres de disco y de catálogo DB excluyendo eliminadas
        all_strategy_names = list(set(file_names) | set(catalog_items.keys()))
        all_strategy_names.sort()

        results = []
        for strategy_name in all_strategy_names:
            config_data = {}
            # PRIORIDAD SOBERANA: Catálogo DB primero
            db_meta = catalog_items.get(strategy_name, {})
            if db_meta and db_meta.get('parameters'):
                config_data = dict(db_meta.get('parameters', {}))

            # Respaldo en disco si no existía en catálogo DB
            if not config_data:
                full_path = os.path.join(STRATEGIES_PATH, f"{strategy_name}.json")
                if os.path.exists(full_path):
                    try:
                        with open(full_path, 'r', encoding='utf-8') as sf:
                            config_data = json.load(sf)
                    except Exception as e:
                        logger.warning(f"No se pudo leer config para {strategy_name}: {e}")

            # Enriquecer con metadatos del catálogo DB
            if db_meta:
                config_data['is_public'] = db_meta.get('is_public', False)
                config_data['risk_level'] = db_meta.get('risk_level', 'MODERADO')
                config_data['min_capital_usdt'] = db_meta.get('min_capital_usdt', 50.0)
                config_data['display_name'] = db_meta.get('display_name', strategy_name)
                config_data['description'] = db_meta.get('description', '')

            ot = str(config_data.get('entryOrderType') or config_data.get('entry_order_type') or 'MARKET').upper().strip()
            if ot not in ('LIMIT', 'MARKET'):
                ot = 'MARKET'
            config_data['entryOrderType'] = ot
            config_data['entry_order_type'] = ot

            results.append({
                "name": strategy_name,
                "config": config_data
            })
            
        return jsonify(results), 200
    except Exception as e:
        logger.error(f"Error al listar estrategias: {e}", exc_info=True)
        return jsonify({"error": f"Error interno al listar estrategias: {str(e)}"}), 500

# =====================================================================
# --- ENDPOINTS PARA EL CATÁLOGO DE ESTRATEGIAS (MARKETPLACE/ADMIN) ---
# =====================================================================

@app.route('/api/strategies/catalog', methods=['GET'])
@token_required
def get_strategies_catalog_endpoint():
    """Retorna las estrategias curadas. Si es inversionista, SOLO retorna las públicas."""
    user = getattr(request, 'current_user', {})
    is_admin = user.get('role') == 'admin'
    only_public = not is_admin

    catalog = get_strategies_catalog(only_public=only_public)
    if not catalog:
        _seed_strategies_catalog_from_files()
        catalog = get_strategies_catalog(only_public=only_public)

    return jsonify({
        "success": True,
        "is_admin": is_admin,
        "strategies": catalog
    }), 200

@app.route('/api/strategies/catalog/toggle_public', methods=['POST'])
def toggle_strategy_catalog_public():
    """Activa o desactiva la visibilidad pública para inversionistas de una estrategia."""
    try:
        token = get_token_from_request()
        if token:
            payload = decode_jwt(token)
            if payload and payload.get('role') == 'investor':
                return jsonify({"error": "Permiso denegado: solo el administrador puede cambiar visibilidad."}), 403

        data = request.get_json(force=True, silent=True) or {}
        name = str(data.get('name') or '').strip()
        is_public = bool(data.get('is_public', False))
        if not name:
            return jsonify({"error": "Nombre de estrategia requerido"}), 400

        ok = toggle_strategy_public_status(name, is_public)

        # Actualizar archivo JSON en disco si existe
        file_updated = False
        strat_file = os.path.join(STRATEGIES_PATH, f"{name}.json")
        if os.path.exists(strat_file):
            try:
                with open(strat_file, 'r', encoding='utf-8') as f:
                    f_data = json.load(f)
                f_data['is_public'] = is_public
                f_data['isPublic'] = is_public
                with open(strat_file, 'w', encoding='utf-8') as f:
                    json.dump(f_data, f, indent=4)
                file_updated = True
            except Exception as e_f:
                get_logger().warning(f"No se pudo actualizar is_public en archivo '{strat_file}': {e_f}")

        if ok or file_updated:
            status_txt = "🟢 PÚBLICA (Visible para inversionistas)" if is_public else "🔒 PRIVADA (Solo Administrador)"
            return jsonify({
                "success": True,
                "name": name,
                "is_public": is_public,
                "message": f"Estrategia '{name}' configurada como {status_txt}."
            }), 200
        return jsonify({"error": "No se pudo actualizar la visibilidad en base de datos ni en disco."}), 500
    except Exception as e_main:
        get_logger().error(f"Error en toggle_strategy_catalog_public: {e_main}", exc_info=True)
        return jsonify({"error": f"Error interno: {str(e_main)}"}), 500

@app.route('/api/strategies/catalog/upsert', methods=['POST'])
def upsert_strategy_catalog_endpoint():
    """Crea o actualiza una estrategia en el catálogo soberano."""
    try:
        token = get_token_from_request()
        if token:
            payload = decode_jwt(token)
            if payload and payload.get('role') == 'investor':
                return jsonify({"error": "Permiso denegado: solo el administrador puede editar el catálogo."}), 403

        data = request.get_json(force=True, silent=True) or {}
        name = str(data.get('name') or '').strip()
        if not name:
            return jsonify({"error": "Nombre de estrategia requerido"}), 400

        display_name = str(data.get('display_name') or name).strip()
        description = str(data.get('description') or '').strip()
        risk_level = str(data.get('risk_level') or 'MODERADO').upper().strip()
        is_public = bool(data.get('is_public', False))
        min_capital = float(data.get('min_capital_usdt') or 50.0)
        parameters = data.get('parameters') or {}

        ok = upsert_strategy_catalog(
            name=name,
            display_name=display_name,
            description=description,
            risk_level=risk_level,
            is_public=is_public,
            min_capital_usdt=min_capital,
            parameters=parameters
        )
        if ok:
            return jsonify({
                "success": True,
                "message": f"Estrategia '{name}' guardada exitosamente en el catálogo soberano."
            }), 200
        return jsonify({"error": "Error al guardar en el catálogo de base de datos."}), 500
    except Exception as e_main:
        get_logger().error(f"Error en upsert_strategy_catalog_endpoint: {e_main}", exc_info=True)
        return jsonify({"error": f"Error interno: {str(e_main)}"}), 500

@app.route('/api/strategies/catalog/<strategy_name>', methods=['DELETE'])
@token_required
@admin_required
def delete_strategy_catalog_endpoint(strategy_name: str):
    """Elimina permanentemente una estrategia tanto del disco como del catálogo de base de datos."""
    return _delete_strategy_logic(strategy_name)

BACKTEST_HISTORY_FILE = os.path.join(os.path.dirname(os.path.abspath(__file__)), 'backtest_history.json')
BACKTEST_HISTORY_BACKUP_FILE = os.path.join(os.path.dirname(os.path.abspath(__file__)), 'backtest_history.backup.json')

def load_backtest_history():
    if os.path.exists(BACKTEST_HISTORY_FILE):
        try:
            with open(BACKTEST_HISTORY_FILE, 'r', encoding='utf-8') as f:
                data = json.load(f)
                if isinstance(data, list):
                    return data
        except Exception as e:
            get_logger().warning(f"Error leyendo {BACKTEST_HISTORY_FILE}, intentando backup: {e}")

    if os.path.exists(BACKTEST_HISTORY_BACKUP_FILE):
        try:
            with open(BACKTEST_HISTORY_BACKUP_FILE, 'r', encoding='utf-8') as f:
                data = json.load(f)
                if isinstance(data, list):
                    return data
        except Exception:
            pass
    return []

def save_backtest_history_item(result_data: dict, payload: dict):
    try:
        history = load_backtest_history()
        run_id = f"bt_{int(time.time() * 1000)}"
        run_time = datetime.now().strftime("%Y-%m-%d %H:%M:%S")
        
        result_data['id'] = run_id
        result_data['executed_at'] = run_time
        result_data['timestamp'] = run_time
        
        cfg = payload.get('config') or {}
        strat_name = cfg.get('activeStrategyName') or cfg.get('strategy_name') or 'Configuración Actual'
        
        summary = {
            'id': run_id,
            'timestamp': run_time,
            'strategy_name': strat_name,
            'is_portfolio': result_data.get('is_portfolio', False),
            'symbol': result_data.get('symbol', 'PORTFOLIO'),
            'symbols_count': result_data.get('symbols_count', 1),
            'interval': payload.get('interval', '5m'),
            'period_label': result_data.get('period_label', ''),
            'days_tested': result_data.get('days_tested', 0),
            'initial_balance': result_data.get('initial_balance', 0.0),
            'final_balance': result_data.get('final_balance', 0.0),
            'final_equity': result_data.get('final_equity', 0.0),
            'total_volume_traded_usdt': result_data.get('total_volume_traded_usdt', 0.0),
            'total_fees_usdt': result_data.get('total_fees_usdt', 0.0),
            'total_margin_used_usdt': result_data.get('total_margin_used_usdt', 0.0),
            'total_trades': result_data.get('total_trades', 0),
            'winning_trades': result_data.get('winning_trades', 0),
            'losing_trades': result_data.get('losing_trades', 0),
            'win_rate_pct': result_data.get('win_rate_pct', 0.0),
            'net_pnl': result_data.get('net_pnl', 0.0),
            'unrealized_pnl': result_data.get('total_unrealized_pnl' if result_data.get('is_portfolio') else 'unrealized_pnl', 0.0),
            'net_equity_pnl': result_data.get('net_equity_pnl', result_data.get('net_pnl', 0.0)),
            'net_return_pct': result_data.get('net_return_pct', 0.0),
            'trapped_coins_count': result_data.get('trapped_coins_count', 0),
            'has_open_positions': bool(result_data.get('open_positions') or result_data.get('open_position')),
            'health_status': result_data.get('smart_analysis', {}).get('health_status', 'NEUTRAL')
        }

        full_entry = {
            'summary': summary,
            'result': result_data,
            'payload': payload
        }

        history.insert(0, full_entry)
        history = history[:50]

        with open(BACKTEST_HISTORY_FILE, 'w', encoding='utf-8') as f:
            json.dump(history, f, indent=2, ensure_ascii=False)
        try:
            with open(BACKTEST_HISTORY_BACKUP_FILE, 'w', encoding='utf-8') as f_bak:
                json.dump(history, f_bak, indent=2, ensure_ascii=False)
        except Exception:
            pass
        return run_id
    except Exception as e:
        get_logger().error(f"Error guardando historial de backtest: {e}")
        return None

@app.route('/api/backtest', methods=['POST'])
def run_backtest_endpoint():
    logger = get_logger()
    try:
        data = request.get_json() or {}
        symbol = data.get('symbol', 'SOLUSDT').upper().strip()
        interval = data.get('interval', '5m')
        days = int(data.get('days', 14))
        initial_balance = float(data.get('initial_balance', 1000.0))
        strategy_config = data.get('config')
        
        if not strategy_config:
            # Si no se pasó config específico, cargar de los parámetros cargados
            strategy_config = loaded_trading_params or {}

        start_date = data.get('startDate') or data.get('start_date')
        end_date = data.get('endDate') or data.get('end_date')
        if start_date: start_date = str(start_date).strip()
        if end_date: end_date = str(end_date).strip()

        # Modo Portafolio Multimoneda (Todas las monedas a la vez)
        if symbol in ('PORTFOLIO', 'ALL', 'ALL_CONFIGURED') or data.get('is_portfolio'):
            symbols_to_test = data.get('symbols')
            if not symbols_to_test and strategy_config:
                st_syms = strategy_config.get('symbolsToTrade') or strategy_config.get('symbols_to_trade')
                if st_syms:
                    symbols_to_test = [s.strip().upper() for s in st_syms.split(',') if s.strip()]
            if not symbols_to_test:
                symbols_to_test = (list(loaded_symbols_to_trade) if loaded_symbols_to_trade else ["SOLUSDT", "DOGEUSDT", "OPUSDT", "SUIUSDT", "NEARUSDT", "ADAUSDT", "ONDOUSDT", "ARBUSDT"])
            r_tag = f"desde {start_date} hasta {end_date}" if (start_date and end_date) else f"{days} días"
            
            # El Saldo Cartera ingresado representa el capital total de la cuenta, distribuido entre los pares
            n_coins = len(symbols_to_test) if symbols_to_test else 1
            balance_per_coin = initial_balance / n_coins if n_coins > 0 else initial_balance
            results = run_portfolio_backtest(symbols=symbols_to_test, interval=interval, days=days, start_date=start_date, end_date=end_date, config=strategy_config, initial_balance_per_coin=balance_per_coin)
            results['config'] = strategy_config
            save_backtest_history_item(results, data)
            return jsonify(results), 200

        r_tag = f"desde {start_date} hasta {end_date}" if (start_date and end_date) else f"{days} días"
        logger.info(f"Iniciando backtest histórico para {symbol} ({r_tag}, intervalo {interval})...")
        df = get_historical_klines_paginated(symbol=symbol, interval=interval, days=days, start_date=start_date, end_date=end_date, use_cache=True)
        if df is None or df.empty:
            return jsonify({"error": f"No se pudieron descargar velas históricas para {symbol} en el período solicitado."}), 400

        results = run_strategy_backtest(symbol=symbol, df=df, config=strategy_config, initial_balance=initial_balance)
        results['config'] = strategy_config
        save_backtest_history_item(results, data)
        return jsonify(results), 200
    except Exception as e:
        logger.error(f"Error al ejecutar backtest: {e}", exc_info=True)
        return jsonify({"error": str(e)}), 500

@app.route('/api/backtest/history', methods=['GET'])
def get_backtest_history_endpoint():
    try:
        history = load_backtest_history()
        summaries = [item.get('summary', {}) for item in history if 'summary' in item]
        resp = jsonify(summaries)
        resp.headers['Cache-Control'] = 'no-cache, no-store, must-revalidate'
        resp.headers['Pragma'] = 'no-cache'
        return resp, 200
    except Exception as e:
        return jsonify({"error": str(e)}), 500

@app.route('/api/backtest/history/<run_id>', methods=['GET'])
def get_backtest_history_item_endpoint(run_id):
    try:
        history = load_backtest_history()
        for item in history:
            if item.get('summary', {}).get('id') == run_id:
                res = dict(item.get('result', {}))
                if 'config' not in res or not res['config']:
                    res['config'] = item.get('payload', {}).get('config', {})
                if 'summary' not in res:
                    res['summary'] = item.get('summary', {})
                sum_ts = item.get('summary', {}).get('timestamp')
                res['executed_at'] = res.get('executed_at') or res.get('timestamp') or sum_ts
                res['timestamp'] = res.get('timestamp') or sum_ts or res['executed_at']
                resp = jsonify(res)
                resp.headers['Cache-Control'] = 'no-cache, no-store, must-revalidate'
                return resp, 200
        return jsonify({"error": "Simulación no encontrada en el historial"}), 404
    except Exception as e:
        return jsonify({"error": str(e)}), 500

@app.route('/api/backtest/history/<run_id>', methods=['DELETE'])
def delete_backtest_history_item_endpoint(run_id):
    try:
        history = load_backtest_history()
        new_history = [item for item in history if item.get('summary', {}).get('id') != run_id]
        for fpath in [BACKTEST_HISTORY_FILE, BACKTEST_HISTORY_BACKUP_FILE]:
            try:
                with open(fpath, 'w', encoding='utf-8') as f:
                    json.dump(new_history, f, indent=2, ensure_ascii=False)
            except Exception as fe:
                get_logger().warning(f"Error actualizando {fpath}: {fe}")
        return jsonify({"success": True, "deleted_id": run_id}), 200
    except Exception as e:
        return jsonify({"error": str(e)}), 500

@app.route('/api/backtest/history', methods=['DELETE'])
def clear_backtest_history_endpoint():
    try:
        for fpath in [BACKTEST_HISTORY_FILE, BACKTEST_HISTORY_BACKUP_FILE]:
            try:
                with open(fpath, 'w', encoding='utf-8') as f:
                    json.dump([], f)
            except Exception as fe:
                get_logger().warning(f"Error vaciando {fpath}: {fe}")
        return jsonify({"success": True, "message": "Historial vaciado con éxito"}), 200
    except Exception as e:
        return jsonify({"error": str(e)}), 500

@app.route('/api/strategies/ranked_performance', methods=['GET'])
def get_strategies_ranked_performance():
    """
    Devuelve las pruebas de simulación registradas en el historial de backtest,
    ordenadas de mayor a menor según su rendimiento (net_equity_pnl o net_pnl),
    para la vista previa de depuración del historial.
    """
    logger = get_logger()
    try:
        metric = request.args.get('metric', 'net_equity_pnl') # 'net_equity_pnl' o 'net_pnl'
        history = load_backtest_history()
        
        ranked_list = []
        for item in history:
            s = item.get('summary', item) if isinstance(item, dict) else {}
            run_id = s.get('id') or item.get('id') or ''
            name = s.get('strategy_name') or 'Configuración Actual'
            equity = float(s.get('net_equity_pnl', s.get('net_pnl', 0.0)) or 0.0)
            pnl = float(s.get('net_pnl', 0.0) or 0.0)
            win_rate = float(s.get('win_rate_pct', 0.0) or 0.0)
            trades = int(s.get('total_trades', 0) or 0)
            trapped = int(s.get('trapped_coins_count', 0) or 0)
            period = s.get('period_label') or f"{s.get('days_tested', 0)} días"
            is_portfolio = bool(s.get('is_portfolio', False))
            ts = s.get('timestamp') or item.get('timestamp') or ''
            
            curr_val = equity if metric == 'net_equity_pnl' else pnl
            
            ranked_list.append({
                'id': run_id,
                'name': name,
                'net_equity_pnl': round(equity, 2),
                'net_pnl': round(pnl, 2),
                'win_rate_pct': round(win_rate, 1),
                'total_trades': trades,
                'trapped_coins_count': trapped,
                'period_label': period,
                'is_portfolio': is_portfolio,
                'timestamp': ts,
                'sort_value': curr_val,
                'has_backtest': True
            })
        
        ranked_list.sort(key=lambda x: (x['sort_value'], x['win_rate_pct'], x['total_trades']), reverse=True)
        
        for idx, item in enumerate(ranked_list):
            item['rank'] = idx + 1
        
        return jsonify({
            "strategies": ranked_list,
            "total_count": len(ranked_list),
            "tested_count": len(ranked_list),
            "metric_used": metric
        }), 200
    except Exception as e:
        logger.error(f"Error al calcular ranking de historial de pruebas: {e}", exc_info=True)
        return jsonify({"error": str(e)}), 500

@app.route('/api/strategies/prune_least_profitable', methods=['POST'])
def prune_least_profitable_strategies():
    """
    Conserva las Top N pruebas de simulación con mejor rendimiento en el historial de backtest
    y descarta las pruebas obsoletas o menos rentables del historial.
    IMPORTANTE: NUNCA borra archivos de estrategias guardadas en el disco.
    """
    logger = get_logger()
    try:
        data = request.get_json() or {}
        keep_count = int(data.get('keep_count', 10))
        metric = data.get('metric', 'net_equity_pnl')
        
        if keep_count < 1:
            return jsonify({"error": "La cantidad de pruebas a mantener debe ser al menos 1."}), 400

        history = load_backtest_history()
        if not history:
            return jsonify({
                "message": "El historial de pruebas de backtest está vacío.",
                "kept_count": 0,
                "pruned_count": 0
            }), 200

        if len(history) <= keep_count:
            return jsonify({
                "message": f"Solo hay {len(history)} pruebas en el historial. No hay ninguna prueba que eliminar para conservar {keep_count}.",
                "kept_count": len(history),
                "pruned_count": 0
            }), 200

        def get_sort_metric(item):
            s = item.get('summary', item) if isinstance(item, dict) else {}
            equity = float(s.get('net_equity_pnl', s.get('net_pnl', 0.0)) or 0.0)
            pnl = float(s.get('net_pnl', 0.0) or 0.0)
            wr = float(s.get('win_rate_pct', 0.0) or 0.0)
            trades = int(s.get('total_trades', 0) or 0)
            val = equity if metric == 'net_equity_pnl' else pnl
            return (val, wr, trades)

        sorted_history = sorted(history, key=get_sort_metric, reverse=True)
        kept_history = sorted_history[:keep_count]
        pruned_history = sorted_history[keep_count:]
        pruned_count = len(pruned_history)

        for fpath in [BACKTEST_HISTORY_FILE, BACKTEST_HISTORY_BACKUP_FILE]:
            try:
                with open(fpath, 'w', encoding='utf-8') as f:
                    json.dump(kept_history, f, indent=2, ensure_ascii=False)
            except Exception as he:
                logger.warning(f"Error actualizando historial de backtests en {fpath}: {he}")

        logger.info(f"Historial de backtests depurado: conservadas {len(kept_history)} mejores pruebas, descartadas {pruned_count} pruebas del historial. Las estrategias guardadas en disco no fueron modificadas.")

        return jsonify({
            "success": True,
            "message": f"Historial depurado exitosamente: se conservaron las {len(kept_history)} mejores simulaciones y se eliminaron {pruned_count} pruebas anteriores del historial. Tus estrategias guardadas están 100% preservadas.",
            "kept_count": len(kept_history),
            "pruned_count": pruned_count
        }), 200

    except Exception as e:
        logger.error(f"Error al depurar historial de pruebas de backtest: {e}", exc_info=True)
        return jsonify({"error": str(e)}), 500

@app.route('/api/backtest/symbols', methods=['GET'])
def get_backtest_symbols():
    try:
        configured = list(loaded_symbols_to_trade) if loaded_symbols_to_trade else []
        popular = ["SOLUSDT", "BTCUSDT", "ETHUSDT", "BNBUSDT", "ADAUSDT", "XRPUSDT", "DOGEUSDT", "NEARUSDT", "AVAXUSDT", "LINKUSDT", "SUIUSDT", "ARBUSDT", "OPUSDT"]
        all_symbols = list(dict.fromkeys(configured + popular))
        return jsonify({"symbols": all_symbols, "configured": configured}), 200
    except Exception as e:
        return jsonify({"symbols": ["SOLUSDT", "BTCUSDT", "ETHUSDT"], "configured": []}), 200

# La función para correr Flask en un hilo (start_flask_app) 
# y el if __name__ == '__main__' no se necesitan aquí 
# si api_server.py es solo para definir la app y sus rutas,
# y es importado por run_bot.py 

# --- NUEVO: Gestor de Riesgo ---
class RiskManager:
    def __init__(self, logger, initial_risk_percentage=Decimal('0.50')): # 50% por defecto
        self.lock = Lock()
        self.logger = logger
        self.total_balance = get_account_balance_usdt() or Decimal('0')
        self.risk_percentage = initial_risk_percentage
        self.max_exposure = self.total_balance * self.risk_percentage
        self.current_exposure = Decimal('0')
        self.logger.info(f"RiskManager inicializado. Saldo: {self.total_balance} USDT, % Riesgo: {self.risk_percentage:.2%}, Exposición Máxima: {self.max_exposure} USDT")

    def update_balance(self):
        with self.lock:
            self.total_balance = get_account_balance_usdt() or self.total_balance
            self.max_exposure = self.total_balance * self.risk_percentage
            self.logger.info(f"Balance actualizado. Nuevo Saldo: {self.total_balance} USDT, Exposición Máxima: {self.max_exposure} USDT")

    def get_current_exposure(self) -> Decimal:
        """Calcula la suma del margen real en riesgo de las posiciones abiertas, descartando valores corruptos."""
        total_exp = Decimal('0')
        # Un margen individual válido nunca supera unas pocas veces el balance de la cuenta
        sane_limit = max(self.total_balance, Decimal('1')) * Decimal('10')

        def _lev(bot):
            try:
                lv = Decimal(str(getattr(bot, 'leverage', 12) or 12))
                return lv if lv > 0 else Decimal('12')
            except Exception:
                return Decimal('12')

        try:
            with status_lock:
                for symbol, bot_instance in list(worker_statuses.items()):
                    if not (hasattr(bot_instance, 'in_position') and bot_instance.in_position):
                        continue
                    contribution = None
                    try:
                        margin = getattr(bot_instance, 'margin_for_current_position', None)
                        if margin is not None:
                            margin = Decimal(str(margin))
                            if Decimal('0') < margin <= sane_limit:
                                contribution = margin
                    except Exception:
                        contribution = None
                    if contribution is None:
                        try:
                            cp = getattr(bot_instance, 'current_position', None)
                            if cp:
                                entry_p = abs(Decimal(str(cp.get('entry_price', 0))))
                                qty = abs(Decimal(str(cp.get('quantity', 0))))
                                est = (entry_p * qty) / _lev(bot_instance)
                                if Decimal('0') < est <= sane_limit:
                                    contribution = est
                            if contribution is None and hasattr(bot_instance, 'position_size_usdt'):
                                est = abs(Decimal(str(bot_instance.position_size_usdt))) / _lev(bot_instance)
                                if Decimal('0') < est <= sane_limit:
                                    contribution = est
                        except Exception:
                            contribution = None
                    if contribution is not None:
                        total_exp += contribution
        except Exception as e:
            self.logger.warning(f"Error calculando exposición actual en RiskManager: {e}")
        return total_exp

    def can_open_position_detailed(self, position_size_usdt: Decimal) -> tuple[bool, str]:
        with self.lock:
            current_exp = self.get_current_exposure()
            if current_exp + position_size_usdt <= self.max_exposure:
                return True, ""
            else:
                msg = f"Exposición máx alcanzada: margen actual ({current_exp:.2f}$) + orden ({position_size_usdt:.2f}$) > tope permitido ({self.max_exposure:.2f}$ [Riesgo {self.risk_percentage:.0%}])"
                self.logger.warning(f"Apertura de posición rechazada: {msg}")
                return False, msg

    def can_open_position(self, position_size_usdt: Decimal) -> bool:
        allowed, _ = self.can_open_position_detailed(position_size_usdt)
        return allowed

    def add_exposure(self, size_usdt: Decimal):
        pass # Se calcula dinámicamente en tiempo real para evitar desincronización y fugas de memoria

    def remove_exposure(self, size_usdt: Decimal):
        pass # Se calcula dinámicamente en tiempo real para evitar desincronización y fugas de memoria

    def set_risk_percentage(self, new_percentage: Decimal):
        with self.lock:
            if Decimal('0') <= new_percentage <= Decimal('1'):
                self.risk_percentage = new_percentage
                self.max_exposure = self.total_balance * self.risk_percentage
                self.logger.info(f"Porcentaje de riesgo actualizado a {self.risk_percentage:.2%}. Nueva exposición máxima: {self.max_exposure} USDT")
            else:
                self.logger.error(f"Intento de establecer un porcentaje de riesgo inválido: {new_percentage}")

    def get_status(self):
        with self.lock:
            real_margin = None
            free_margin = None
            open_orders_margin = Decimal('0')
            margin_balance = self.total_balance
            unrealized_pnl = Decimal('0')
            try:
                from src.binance_client import get_futures_account_details
                acc = get_futures_account_details()
                if acc:
                    if acc.get('total_wallet_balance') and acc['total_wallet_balance'] > Decimal('0'):
                        self.total_balance = acc['total_wallet_balance']
                        self.max_exposure = self.total_balance * self.risk_percentage
                    if acc.get('total_position_initial_margin') is not None:
                        real_margin = acc['total_position_initial_margin']
                    if acc.get('available_balance') is not None:
                        free_margin = acc['available_balance']
                    if acc.get('total_open_order_initial_margin') is not None:
                        open_orders_margin = acc['total_open_order_initial_margin']
                    if acc.get('total_margin_balance') is not None:
                        margin_balance = acc['total_margin_balance']
                    if acc.get('total_unrealized_profit') is not None:
                        unrealized_pnl = acc['total_unrealized_profit']
            except Exception as e_acc:
                self.logger.warning(f"Error consultando detalles oficiales de cuenta en Binance: {e_acc}")

            if real_margin is None:
                real_margin = self.get_current_exposure()
            self.current_exposure = real_margin

            if free_margin is None:
                free_margin = max(Decimal('0'), self.total_balance - real_margin - open_orders_margin)

            # --- CONCILIACIÓN MATEMÁTICA EXACTA DE MARGEN ---
            # 1. Margen comprometido en posiciones abiertas
            pos_margin = real_margin

            # 2. Margen no asignado en la billetera antes del impacto del flotante
            unallocated_wallet = max(Decimal('0'), self.total_balance - pos_margin - open_orders_margin)

            # 3. Flotante negativo retenido / absorbido por Binance
            # Cuando el PnL no realizado es negativo, Binance reduce el Available Balance directamente.
            if unrealized_pnl < Decimal('0'):
                floating_loss_consumed = min(abs(unrealized_pnl), unallocated_wallet)
            else:
                floating_loss_consumed = Decimal('0')

            # 4. Margen libre autorizado respetando el límite de riesgo
            total_used_of_limit = pos_margin + open_orders_margin + floating_loss_consumed
            free_margin_authorized = max(Decimal('0'), self.max_exposure - total_used_of_limit)
            # No puede superar el disponible real de Binance
            free_margin_real = min(free_margin_authorized, free_margin)

            # 5. Porcentaje de utilización real del límite autorizado
            real_utilization_pct = (total_used_of_limit / self.max_exposure * Decimal('100')) if self.max_exposure > Decimal('0') else Decimal('0')
            real_utilization_pct = max(Decimal('0'), min(Decimal('100'), real_utilization_pct))

            exp_pct = (real_margin / self.total_balance * Decimal('100')) if self.total_balance > Decimal('0') else Decimal('0')

            # Conciliación REAL: las 4 tarjetas deben sumar el límite autorizado.
            # limit_gap > 0 => parte del límite sin asignar (p.ej. ganancia flotante / límite de Binance)
            # limit_gap < 0 => las posiciones ya exceden el límite autorizado
            reconciled_sum = pos_margin + floating_loss_consumed + open_orders_margin + free_margin_real
            limit_gap = self.max_exposure - reconciled_sum
            is_reconciled = abs(limit_gap) <= Decimal('0.05')

            return {
                'total_balance': f"{self.total_balance:.2f}",
                'total_balance_raw': float(self.total_balance),
                'margin_balance': f"{margin_balance:.2f}",
                'margin_balance_raw': float(margin_balance),
                'risk_percentage': f"{self.risk_percentage:.2%}",
                'risk_percentage_raw': float(self.risk_percentage * Decimal('100')),
                'max_exposure': f"{self.max_exposure:.2f}",
                'max_exposure_raw': float(self.max_exposure),
                'current_exposure': f"{real_margin:.2f}",
                'current_exposure_raw': float(real_margin),
                'open_orders_margin': f"{open_orders_margin:.2f}",
                'open_orders_margin_raw': float(open_orders_margin),
                'free_margin': f"{free_margin:.2f}",
                'free_margin_raw': float(free_margin),
                'unrealized_pnl': f"{unrealized_pnl:.2f}",
                'unrealized_pnl_raw': float(unrealized_pnl),
                'floating_loss_consumed': f"{floating_loss_consumed:.2f}",
                'floating_loss_consumed_raw': float(floating_loss_consumed),
                'free_margin_real': f"{free_margin_real:.2f}",
                'free_margin_real_raw': float(free_margin_real),
                'total_used_of_limit': f"{total_used_of_limit:.2f}",
                'total_used_of_limit_raw': float(total_used_of_limit),
                'real_utilization_pct': f"{real_utilization_pct:.1f}%",
                'real_utilization_pct_raw': float(real_utilization_pct),
                'exposure_percentage': f"{exp_pct:.1f}%",
                'exposure_percentage_raw': float(exp_pct),
                'limit_gap_raw': float(limit_gap),
                'is_reconciled': bool(is_reconciled)
            }

risk_manager = RiskManager(logger=api_logger) # <-- CORRECCIÓN: Usar el nombre de variable correcto 'api_logger'
# --------------------------------- 

# --- Rutas de la API ---

@app.route('/api/risk_config', methods=['GET', 'POST'])
def handle_risk_config():
    if request.method == 'POST':
        data = request.get_json()
        if data and 'risk_percentage' in data:
            try:
                # El frontend enviará un número (ej. 50), lo convertimos a Decimal (0.50)
                raw_pct = Decimal(str(data['risk_percentage']))
                percentage = raw_pct / Decimal('100')
                risk_manager.set_risk_percentage(percentage)
                # Persistir en config.ini para que no se pierda al reiniciar
                try:
                    config = configparser.ConfigParser(allow_no_value=True)
                    if os.path.exists(CONFIG_FILE_PATH):
                        config.read(CONFIG_FILE_PATH, encoding='utf-8')
                        if not config.has_section('TRADING'):
                            config.add_section('TRADING')
                        config.set('TRADING', 'risk_percentage', str(raw_pct))
                        with open(CONFIG_FILE_PATH, 'w', encoding='utf-8') as cf:
                            config.write(cf)
                        reload_config()
                except Exception as e_cfg:
                    api_logger.warning(f"No se pudo persistir risk_percentage en config.ini: {e_cfg}")
                return jsonify({'message': 'Risk percentage updated successfully.'}), 200
            except Exception as e:
                return jsonify({'error': f'Invalid value for risk_percentage: {e}'}), 400
        return jsonify({'error': 'Missing or invalid risk_percentage in request body.'}), 400
    
    # GET request
    return jsonify(risk_manager.get_status()), 200 


@app.route('/api/wallet/cancel_stale_orders', methods=['POST'])
def cancel_stale_orders_endpoint():
    """Cancela proactivamente todas las órdenes límite de entrada huérfanas en Binance para liberar margen retenido."""
    try:
        from src.binance_client import get_futures_client
        client = get_futures_client()
        if not client:
            return jsonify({"status": "error", "message": "Cliente Binance no disponible"}), 500

        orders = client.get_orders()
        cancelled = 0
        for o in orders:
            if not o.get('reduceOnly'):
                try:
                    client.cancel_order(symbol=o.get('symbol'), orderId=o.get('orderId'))
                    cancelled += 1
                except Exception:
                    pass

        # Resetear el estado de seguimiento de órdenes pendientes en los workers en ejecución
        try:
            with status_lock:
                for sym, worker in worker_statuses.items():
                    if hasattr(worker, 'long_bot') and worker.long_bot:
                        worker.long_bot.pending_entry_order_id = None
                        worker.long_bot.pending_reentry_order_id = None
                        worker.long_bot.active_support_orders = {}
                    if hasattr(worker, 'short_bot') and worker.short_bot:
                        worker.short_bot.pending_entry_order_id = None
                        worker.short_bot.pending_reentry_order_id = None
                        worker.short_bot.active_support_orders = {}
        except Exception as _w_err:
            api_logger.warning(f"Aviso al limpiar estados de workers tras cancelar órdenes: {_w_err}")

        api_logger.info(f"Limpieza manual de órdenes huérfanas: {cancelled} órdenes de entrada canceladas.")
        return jsonify({
            "status": "success",
            "message": f"Se cancelaron {cancelled} órdenes de entrada pendientes y se liberó el margen retenido.",
            "cancelled_count": cancelled
        }), 200
    except Exception as e:
        api_logger.error(f"Error cancelando órdenes huérfanas: {e}")
        return jsonify({"status": "error", "message": str(e)}), 500 

# --- Rutas de Notas / Bitácora y Asistente ---

@app.route('/api/notes', methods=['GET', 'POST'])
def handle_user_notes():
    from src.database import get_bot_setting, set_bot_setting
    if request.method == 'POST':
        data = request.get_json(silent=True) or {}
        notes = data.get('notes', '')
        chat_history = data.get('chat_history')
        set_bot_setting('user_scratchpad_notes', notes)
        if chat_history is not None:
            import json as _json
            set_bot_setting('user_scratchpad_chat', _json.dumps(chat_history))
        return jsonify({'status': 'success', 'notes': notes}), 200
    
    # GET
    notes = get_bot_setting('user_scratchpad_notes', '') or ''
    chat_raw = get_bot_setting('user_scratchpad_chat', '[]') or '[]'
    try:
        import json as _json
        chat_history = _json.loads(chat_raw)
    except Exception:
        chat_history = []
    return jsonify({'notes': notes, 'chat_history': chat_history, 'status': 'success'}), 200

@app.route('/api/notes/chat', methods=['POST'])
def handle_assistant_chat():
    from src.database import get_bot_setting, set_bot_setting
    data = request.get_json(silent=True) or {}
    user_msg = (data.get('message') or '').strip()
    notes = data.get('notes', '')
    
    if not user_msg:
        return jsonify({'error': 'Mensaje vacío'}), 400

    # Auto-guardar notas si se enviaron
    if notes:
        set_bot_setting('user_scratchpad_notes', notes)

    # 1. Obtener telemetría en vivo del bot
    risk_info = risk_manager.get_status() if risk_manager else {}
    open_positions = []
    with status_lock:
        for sym, w in list(worker_statuses.items()):
            if hasattr(w, 'in_position') and w.in_position:
                st = w.get_status() if hasattr(w, 'get_status') else {}
                side = st.get('trade_side', 'LONG')
                entry_p = st.get('entry_price', 0)
                curr_p = st.get('current_price', 0)
                pnl = st.get('current_pnl', 0)
                open_positions.append(f"{sym} ({side}) @ {entry_p}, PnL: {pnl:+.2f} USDT")

    positions_str = ", ".join(open_positions) if open_positions else "Ninguna posición abierta en este momento"
    
    # 2. Verificar si hay clave de Gemini API en config.ini o entorno
    gemini_key = None
    try:
        cfg = load_config()
        if cfg:
            if cfg.has_section('AI') and cfg.has_option('AI', 'gemini_api_key'):
                gemini_key = cfg.get('AI', 'gemini_api_key').strip()
            elif cfg.has_section('BINANCE') and cfg.has_option('BINANCE', 'gemini_api_key'):
                gemini_key = cfg.get('BINANCE', 'gemini_api_key').strip()
    except Exception:
        pass
    if not gemini_key:
        gemini_key = os.environ.get('GEMINI_API_KEY')

    assistant_reply = ""

    # 3. Si hay API key de Gemini, llamar al modelo Gemini 2.5 Flash
    if gemini_key:
        try:
            import requests as _requests
            prompt_context = f"""Eres el Copiloto de Inteligencia Artificial integrado en el Dashboard de WTN Algo-Trading (Binance Futures Bot).
Estado en vivo del bot:
- Saldo Cartera: {risk_info.get('total_balance', 'N/A')} USDT
- Margen en Uso: {risk_info.get('current_exposure', 'N/A')} USDT ({risk_info.get('exposure_percentage', '0%')})
- Margen Disponible: {risk_info.get('free_margin', 'N/A')} USDT
- Posiciones Activas: {positions_str}
- Notas de la bitácora del usuario: {notes[:500]}

Pregunta o instrucción del usuario:
\"{user_msg}\"

Responde en español, de forma concisa, analítica, profesional y con formato markdown legible."""

            gemini_url = f"https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent?key={gemini_key}"
            payload = {
                "contents": [{"parts": [{"text": prompt_context}]}]
            }
            res = _requests.post(gemini_url, json=payload, timeout=15)
            if res.ok:
                resp_json = res.json()
                assistant_reply = resp_json.get('candidates', [{}])[0].get('content', {}).get('parts', [{}])[0].get('text', '')
            else:
                api_logger.warning(f"Error Gemini API ({res.status_code}): {res.text}")
        except Exception as e_gem:
            api_logger.warning(f"Excepción llamando a Gemini API: {e_gem}")

    # 4. Si no hay Gemini API o falló, respuesta contextual inteligente de trading
    if not assistant_reply:
        lower_msg = user_msg.lower()
        if any(w in lower_msg for w in ['posicion', 'posiciones', 'abierta', 'abiertas']):
            assistant_reply = f"📊 **Posiciones Actuales:**\n{positions_str}\n\n*Margen comprometido:* {risk_info.get('current_exposure', '0')} USDT."
        elif any(w in lower_msg for w in ['balance', 'saldo', 'cuenta', 'dinero', 'pool']):
            assistant_reply = f"💰 **Estado Financiero:**\n- Saldo Total: **{risk_info.get('total_balance', '0')} USDT**\n- Margen Libre: **{risk_info.get('free_margin', '0')} USDT**\n- Exposición: **{risk_info.get('exposure_percentage', '0%')}**"
        elif any(w in lower_msg for w in ['trailing', 'stop', 'tp', 'sl', 'ganancia', 'cierre']):
            assistant_reply = "📈 **Consejo de Trailing Stop:**\nEl análisis de 102 trades mostró que una activación a **5.5 USDT** y caída de **2.5 USDT** captura un 144% más de recorrido evitando salidas falsas por ruido de 1m."
        else:
            assistant_reply = f"📝 **Mensaje registrado en bitácora:**\n\"{user_msg}\"\n\n🤖 *Estado en vivo:* Saldo {risk_info.get('total_balance', '0')} USDT | {len(open_positions)} pos abiertas.\n\n*(Tip: Puedes agregar tu `gemini_api_key` en `config.ini` [AI] para activar respuestas de IA generativa completa).* "

    # Guardar en historial de chat
    import json as _json
    chat_raw = get_bot_setting('user_scratchpad_chat', '[]') or '[]'
    try:
        hist = _json.loads(chat_raw)
    except Exception:
        hist = []
    hist.append({"role": "user", "text": user_msg, "time": datetime.now().strftime("%H:%M")})
    hist.append({"role": "assistant", "text": assistant_reply, "time": datetime.now().strftime("%H:%M")})
    set_bot_setting('user_scratchpad_chat', _json.dumps(hist[-20:]))

    return jsonify({
        'reply': assistant_reply,
        'chat_history': hist[-20:],
        'status': 'success'
    }), 200 