#!/usr/bin/env python
# -*- coding: utf-8 -*-

import os
import sys
import configparser
import json # <--- AÑADIR IMPORT JSON
from flask import Flask, jsonify, request
from flask_cors import CORS
import threading
import time # Necesario para sleep
import logging # Necesario para get_logger y calculate_sleep
from decimal import Decimal
from threading import Lock # Necesario para el Lock del RiskManager

# --- Quitar Workaround sys.path --- 
# current_dir = os.path.dirname(os.path.abspath(__file__))
# project_root = os.path.dirname(current_dir) 
# if project_root not in sys.path:
#     sys.path.insert(0, project_root)

# Importar funciones y variables usando importaciones ABSOLUTAS (desde src)
from src.config_loader import load_config, reload_config, get_trading_symbols, CONFIG_FILE_PATH
from src.logger_setup import setup_logging, get_logger
from src.database import get_cumulative_pnl_by_symbol, get_last_n_trades_for_symbol, clear_trade_history, get_all_recent_trades
from src.bot import TradingBot, BotState 
from src.binance_client import get_account_balance_usdt, reset_futures_client, get_futures_client
from src.backtester import get_historical_klines_paginated, run_strategy_backtest, run_portfolio_backtest

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
                elif key in ['evaluate_support_strategy', 'evaluate_ma_filter', 'evaluate_open_interest_increase', 'enable_take_profit_pnl', 'enable_stop_loss_pnl', 'enable_trailing_rsi_stop', 'enable_price_trailing_stop', 'enable_pnl_trailing_stop', 'evaluate_rsi_delta', 'evaluate_volume_filter', 'evaluate_rsi_range', 'evaluate_downtrend_candles_block', 'evaluate_downtrend_levels_block', 'evaluate_required_uptrend']:
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
    def _val(key, default):
        val = frontend_data.get(key)
        if val is None or str(val).strip() == '':
            return str(default)
        return str(val)

    config_output = {
        'BINANCE': {
            'mode': 'paper',
        },
        'TRADING': {
            'leverage': _val('leverage', 20),
            'rsi_interval': _val('rsiInterval', '5m'),
            'rsi_period': _val('rsiPeriod', 14),
            'rsi_threshold_up': _val('rsiThresholdUp', 8),
            'rsi_threshold_down': _val('rsiThresholdDown', -8),
            'rsi_entry_level_low': _val('rsiEntryLevelLow', 25),
            'rsi_entry_level_high': _val('rsiEntryLevelHigh', 75),
            'rsi_target': _val('rsiTarget', 50),
            'volume_sma_period': _val('volumeSmaPeriod', 20),
            'volume_factor': _val('volumeFactor', 1.5),
            'downtrend_check_candles': _val('downtrendCheckCandles', 3),
            'downtrend_level_check': _val('downtrend_level_check', 5),
            'required_uptrend_candles': _val('requiredUptrendCandles', 0),
            'position_size_usdt': _val('positionSizeUSDT', 50),
            'stop_loss_usdt': _val('stopLossUSDT', 20),
            'take_profit_usdt': _val('takeProfitUSDT', 30),
            'cycle_sleep_seconds': _val('cycleSleepSeconds', 5),
            'order_timeout_seconds': _val('orderTimeoutSeconds', 10),
            'evaluate_rsi_delta': str(frontend_data.get('evaluateRsiDelta', True)).lower(),
            'evaluate_volume_filter': str(frontend_data.get('evaluateVolumeFilter', True)).lower(),
            'evaluate_rsi_range': str(frontend_data.get('evaluateRsiRange', True)).lower(),
            'evaluate_downtrend_candles_block': str(frontend_data.get('evaluateDowntrendCandlesBlock', True)).lower(),
            'evaluate_downtrend_levels_block': str(frontend_data.get('evaluateDowntrendLevelsBlock', True)).lower(),
            'evaluate_required_uptrend': str(frontend_data.get('evaluateRequiredUptrend', True)).lower(),
            'enable_take_profit_pnl': str(frontend_data.get('enableTakeProfitPnl', True)).lower(),
            'enable_stop_loss_pnl': str(frontend_data.get('enableStopLossPnl', True)).lower(),
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
            'dca_max_reentries': _val('dcaMaxReentries', 2),
            'dca_volume_multiplier': _val('dcaVolumeMultiplier', 1.0),
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

        logger.info("Iniciando workers de bot...")
        for symbol_idx, symbol in enumerate(loaded_symbols_to_trade):
            logger.info(f"-> Preparando worker para {symbol}...")
            # Usar una COPIA de loaded_trading_params para cada hilo
            thread = threading.Thread(target=run_bot_worker, args=(symbol, loaded_trading_params.copy(), stop_event), name=f"Worker-{symbol}")
            threads.append(thread)
            thread.start()
            if (symbol_idx + 1) < len(loaded_symbols_to_trade):
                 # Espera corta entre inicios de hilos para evitar sobrecarga inicial
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
            ('rsi_interval', 'rsiInterval'),
            ('rsi_period', 'rsiPeriod'),
            ('rsi_threshold_up', 'rsiThresholdUp'),
            ('rsi_threshold_down', 'rsiThresholdDown'),
            ('rsi_entry_level_low', 'rsiEntryLevelLow'),
            ('rsi_entry_level_high', 'rsiEntryLevelHigh'),
            ('rsi_target', 'rsiTarget'),
            ('volume_sma_period', 'volumeSmaPeriod'),
            ('volume_factor', 'volumeFactor'),
            ('downtrend_check_candles', 'downtrendCheckCandles'),
            ('downtrend_level_check', 'downtrendLevelCheck'),
            ('required_uptrend_candles', 'requiredUptrendCandles'),
            ('position_size_usdt', 'positionSizeUSDT'),
            ('stop_loss_usdt', 'stopLossUSDT'),
            ('take_profit_usdt', 'takeProfitUSDT'),
            ('cycle_sleep_seconds', 'cycleSleepSeconds'),
            ('order_timeout_seconds', 'orderTimeoutSeconds'),
            ('evaluate_rsi_delta', 'evaluateRsiDelta'),
            ('evaluate_volume_filter', 'evaluateVolumeFilter'),
            ('evaluate_rsi_range', 'evaluateRsiRange'),
            ('evaluate_downtrend_candles_block', 'evaluateDowntrendCandlesBlock'),
            ('evaluate_downtrend_levels_block', 'evaluateDowntrendLevelsBlock'),
            ('evaluate_required_uptrend', 'evaluateRequiredUptrend'),
            ('enable_take_profit_pnl', 'enableTakeProfitPnl'),
            ('enable_stop_loss_pnl', 'enableStopLossPnl'),
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
            ('dca_max_reentries', 'dcaMaxReentries'),
            ('dca_volume_multiplier', 'dcaVolumeMultiplier')
        ]:
            if key_ini in config_dict['TRADING']:
                frontend_config[key_frontend] = config_dict['TRADING'][key_ini]
    if 'SYMBOLS' in config_dict:
        frontend_config['symbolsToTrade'] = config_dict['SYMBOLS'].get('symbols_to_trade', '')
    if 'STRATEGY_INFO' in config_dict:
        frontend_config['activeStrategyName'] = config_dict['STRATEGY_INFO'].get('active_strategy_name', '')
    else:
        frontend_config['activeStrategyName'] = ''
    return frontend_config


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

        # 6. Escribir cambios a config.ini
        with open(CONFIG_FILE_PATH, 'w', encoding='utf-8') as configfile:
            config.write(configfile)

        # 7. Sincronizar automáticamente en strategies/<name>.json si hay un nombre de estrategia válido
        if actual_name_to_save_in_ini and not any(c in actual_name_to_save_in_ini for c in ('.', '/', '\\')):
            try:
                os.makedirs(STRATEGIES_PATH, exist_ok=True)
                strat_file_path = os.path.join(STRATEGIES_PATH, f"{actual_name_to_save_in_ini}.json")
                strat_clean_data = {**frontend_data, "symbolsToTrade": symbols_to_save, "activeStrategyName": actual_name_to_save_in_ini}
                with open(strat_file_path, 'w', encoding='utf-8') as sf:
                    json.dump(strat_clean_data, sf, indent=4)
                logger.info(f"Estrategia '{actual_name_to_save_in_ini}' sincronizada en {strat_file_path}")
            except Exception as e_strat:
                logger.warning(f"No se pudo escribir archivo de estrategia '{actual_name_to_save_in_ini}': {e_strat}")

        # Recargar caché de configuración y clientes
        reload_config()
        reset_futures_client()
        load_initial_config()

        # --- HOT-RELOAD EN VIVO: Si los workers están corriendo, actualizar parámetros inmediatamente ---
        if workers_started:
            logger.info("Workers activos detectados. Aplicando parámetros actualizados en caliente a cada bot...")
            with status_lock:
                for sym, bot_inst in worker_statuses.items():
                    if bot_inst and hasattr(bot_inst, 'update_trading_params'):
                        try:
                            bot_inst.update_trading_params(loaded_trading_params)
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
            # Hacemos una copia para evitar problemas de concurrencia
            active_worker_instances = {symbol: worker.get_status() for symbol, worker in worker_statuses.items() if hasattr(worker, 'get_status')}

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
            
            all_symbols_status.append(status_entry)

        # --- NUEVO: Actualizar y obtener estadísticas de sesión ---
        session_manager.update_stats(total_session_pnl, total_unrealized_pnl)
        session_stats = session_manager.get_stats()
        
        response_data = {
            "bots_running": workers_started,
            "statuses": all_symbols_status,
            "session_stats": session_stats # <-- NUEVO: Añadir estadísticas al response
        }
        
        logger.debug(f"Returning combined statuses. Bots running: {workers_started}")
        return jsonify(response_data)

    except Exception as e:
        logger.error(f"CRITICAL ERROR in /api/status endpoint: {e}", exc_info=True)
        return jsonify({"error": "Internal server error processing status.", "details": str(e)}), 500

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
    logger.warning(f"Solicitud para cerrar posición de {symbol} recibida en la API.")
    
    worker = None
    with status_lock:
        worker = worker_statuses.get(symbol)
    
    if worker and hasattr(worker, 'close_position_now'):
        try:
            success = worker.close_position_now(reason="Cierre Manual Panel Web")
            if success:
                return jsonify({"message": f"Posición de {symbol} cerrada exitosamente."}), 200
            else:
                return jsonify({"error": f"No se pudo cerrar la posición de {symbol}."}), 500
        except Exception as e:
            logger.error(f"Error al cerrar posición de {symbol}: {e}", exc_info=True)
            return jsonify({"error": str(e)}), 500
    else:
        try:
            from src.binance_client import get_futures_position, create_futures_market_order
            pos = get_futures_position(symbol)
            if not pos:
                return jsonify({"message": f"No hay posición abierta para {symbol}."}), 200
            
            amt = float(pos.get('positionAmt', '0'))
            if abs(amt) < 1e-9:
                return jsonify({"message": f"No hay posición abierta para {symbol}."}), 200
            
            side = 'SELL' if amt > 0 else 'BUY'
            pos_side = pos.get('positionSide', 'LONG')
            order = create_futures_market_order(symbol, side=side, quantity=abs(amt), position_side=pos_side)
            if order:
                return jsonify({"message": f"Posición de {symbol} cerrada exitosamente a mercado en Binance."}), 200
            else:
                return jsonify({"error": f"Error al ejecutar orden de cierre para {symbol}."}), 500
        except Exception as e:
            logger.error(f"Error al cerrar posición externa de {symbol}: {e}", exc_info=True)
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
            if not new_paused and getattr(worker, 'state', None) == BotState.PAUSED:
                worker.state = BotState.IDLE

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
        if hasattr(worker, 'close_position_now') and getattr(worker, 'in_position', False):
            try:
                ok = worker.close_position_now(reason="Cierre Manual Global")
                results[symbol] = "Cerrada" if ok else "Fallo"
            except Exception as e:
                logger.error(f"Error cerrando {symbol} en worker: {e}")
                results[symbol] = f"Error: {e}"
    
    # 2. Verificar si quedó alguna posición huérfana en Binance
    try:
        from src.binance_client import get_futures_position_information, create_futures_market_order
        all_positions = get_futures_position_information() or []
        for p in all_positions:
            sym = p.get('symbol')
            try:
                amt = float(p.get('positionAmt', '0'))
                if abs(amt) > 1e-9:
                    side = 'SELL' if amt > 0 else 'BUY'
                    pos_side = p.get('positionSide', 'LONG')
                    order = create_futures_market_order(sym, side=side, quantity=abs(amt), position_side=pos_side)
                    results[sym] = "Cerrada (Binance)" if order else "Fallo (Binance)"
            except Exception as e:
                logger.error(f"Error cerrando posición Binance {sym}: {e}")
                results[sym] = f"Error: {e}"
    except Exception as e:
        logger.error(f"Error consultando posiciones generales de Binance: {e}")
    
    return jsonify({
        "message": "Operación de cierre masivo ejecutada.",
        "results": results
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
        try:
            if key in ['rsi_period', 'volume_sma_period', 'cycle_sleep_seconds', 'order_timeout_seconds', 'downtrend_check_candles', 'downtrend_level_check', 'required_uptrend_candles', 'ma_period', 'support_history_candles', 'support_pivot_window', 'support_confirmations']:
                if value_str is None or str(value_str).strip() == '':
                    loaded_trading_params[key] = 20 if 'period' in key else 0
                else:
                    loaded_trading_params[key] = int(value_str)
            elif key in ['rsi_threshold_up', 'rsi_threshold_down', 'rsi_entry_level_low', 'rsi_entry_level_high',
                         'rsi_target',
                         'volume_factor', 'position_size_usdt', 'stop_loss_usdt', 'take_profit_usdt',
                         'price_trailing_stop_distance_usdt',
                         'price_trailing_stop_activation_pnl_usdt',
                         'pnl_trailing_stop_activation_usdt', 'pnl_trailing_stop_drop_usdt',
                         'support_level_tolerance_percent', 'support_order_stop_loss_percent', 'support_order_take_profit_percent']:
                if value_str is None or str(value_str).strip() == '':
                    loaded_trading_params[key] = 0.0
                else:
                    loaded_trading_params[key] = float(value_str)
            elif key in ['evaluate_rsi_delta', 'evaluate_volume_filter', 'evaluate_rsi_range',
                         'evaluate_downtrend_candles_block', 'evaluate_downtrend_levels_block',
                         'evaluate_required_uptrend', 'enable_take_profit_pnl', 'enable_stop_loss_pnl',
                         'enable_trailing_rsi_stop', 'enable_price_trailing_stop', 'enable_pnl_trailing_stop',
                         'evaluate_open_interest_increase', 'evaluate_ma_filter', 'evaluate_support_strategy']:
                loaded_trading_params[key] = str(value_str).lower() == 'true'
            else:
                loaded_trading_params[key] = value_str
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

    logger.info(f"Configuración inicial cargada: {len(loaded_symbols_to_trade)} símbolos, Params procesados: {loaded_trading_params}")
    return True

# --- NUEVO ENDPOINT PARA HISTORIAL DE TRADES POR SÍMBOLO ---
@app.route('/api/trades/<symbol>', methods=['GET'])
def get_symbol_trade_history(symbol: str):
    """Endpoint para obtener los últimos N trades para un símbolo específico."""
    logger = get_logger()
    logger.info(f"Recibida petición GET /api/trades/{symbol}")
    
    # --- LEER Y VALIDAR EL PARÁMETRO 'limit' --- 
    limit_param = request.args.get('limit', default=2, type=int) # Default 2 como en el frontend
    if not 1 <= limit_param <= 50: # Poner límites razonables (ej. 1 a 50)
        logger.warning(f"Parámetro 'limit' ({limit_param}) fuera de rango [1-50]. Usando 2.")
        limit_param = 2 # Volver al default si está fuera de rango
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
    limit_param = request.args.get('limit', default=200, type=int)
    if limit_param < 1:
        limit_param = 200
    try:
        trades = get_all_recent_trades(limit=limit_param)
        return jsonify({"trades": trades})
    except Exception as e:
        logger.error(f"Error al obtener historial general de trades: {e}", exc_info=True)
        return jsonify({"error": str(e), "trades": []}), 500

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

# --- ENDPOINT PARA REINICIAR HISTORIAL DE TRADES Y PNL ---
@app.route('/api/trades/reset', methods=['POST'])
def reset_trade_history():
    """Endpoint para reiniciar el historial de trades y el PnL acumulado."""
    logger = get_logger()
    logger.info("Recibida petición POST /api/trades/reset para limpiar historial de operaciones...")
    try:
        # 1. Limpiar base de datos SQLite
        success = clear_trade_history()
        if not success:
            return jsonify({"error": "No se pudo limpiar la base de datos de trades."}), 500

        # 2. Resetear variables de PnL en workers activos
        with status_lock:
            for symbol, bot_instance in list(worker_statuses.items()):
                try:
                    if hasattr(bot_instance, 'historical_pnl'):
                        bot_instance.historical_pnl = Decimal('0')
                    if hasattr(bot_instance, 'session_pnl'):
                        bot_instance.session_pnl = Decimal('0')
                    if hasattr(bot_instance, 'reset_session_pnl'):
                        bot_instance.reset_session_pnl()
                except Exception as e:
                    logger.warning(f"No se pudo resetear PnL en bot_instance de {symbol}: {e}")

        # 3. Resetear estadísticas de sesión global
        if session_manager:
            session_manager.reset_stats()

        logger.info("Historial de trades y PnL reiniciados exitosamente a 0.00.")
        return jsonify({"success": True, "message": "Historial de PnL y operaciones reiniciado correctamente."}), 200

    except Exception as e:
        logger.error(f"Error inesperado al reiniciar historial de trades: {e}", exc_info=True)
        return jsonify({"error": f"Error interno: {str(e)}"}), 500
# --------------------------------------------------------

# --- NUEVOS ENDPOINTS PARA ESTRATEGIAS ---

# Funciones auxiliares refactorizadas para manejar la lógica de cada método
def _save_strategy_logic(strategy_name: str, data: dict):
    logger = get_logger()
    strategy_file_path = os.path.join(STRATEGIES_PATH, f"{strategy_name}.json")
    try:
        with open(strategy_file_path, 'w', encoding='utf-8') as f:
            json.dump(data, f, indent=4)
        logger.info(f"Estrategia '{strategy_name}' guardada exitosamente en {strategy_file_path}")
        return jsonify({"message": f"Estrategia '{strategy_name}' guardada exitosamente."}), 201
    except Exception as e:
        logger.error(f"Error al guardar la estrategia '{strategy_name}': {e}", exc_info=True)
        return jsonify({"error": f"Error interno al guardar la estrategia: {str(e)}"}), 500

def _load_strategy_logic(strategy_name: str):
    logger = get_logger()
    strategy_file_path = os.path.join(STRATEGIES_PATH, f"{strategy_name}.json")
    if not os.path.exists(strategy_file_path):
        logger.error(f"No se encontró el archivo de estrategia: {strategy_file_path}")
        return jsonify({"error": f"Estrategia '{strategy_name}' no encontrada."}), 404
    try:
        with open(strategy_file_path, 'r', encoding='utf-8') as f:
            strategy_data = json.load(f)
        logger.info(f"Estrategia '{strategy_name}' cargada exitosamente.")
        return jsonify(strategy_data), 200
    except json.JSONDecodeError as e_json:
        logger.error(f"Error al decodificar JSON para la estrategia '{strategy_name}' desde {strategy_file_path}: {e_json}", exc_info=True)
        return jsonify({"error": f"Error al leer el archivo de la estrategia '{strategy_name}'. Formato JSON inválido."}), 500
    except Exception as e:
        logger.error(f"Error al cargar la estrategia '{strategy_name}' desde {strategy_file_path}: {e}", exc_info=True)
        return jsonify({"error": f"Error interno al cargar la estrategia: {str(e)}"}), 500

def _delete_strategy_logic(strategy_name: str):
    logger = get_logger()
    strategy_file_path = os.path.join(STRATEGIES_PATH, f"{strategy_name}.json")
    if not os.path.exists(strategy_file_path):
        logger.error(f"No se encontró el archivo de estrategia para eliminar: {strategy_file_path}")
        return jsonify({"error": f"Estrategia '{strategy_name}' no encontrada."}), 404
    try:
        os.remove(strategy_file_path)
        logger.info(f"Estrategia '{strategy_name}' eliminada exitosamente de {strategy_file_path}")
        return jsonify({"message": f"Estrategia '{strategy_name}' eliminada exitosamente."}), 200
    except OSError as e_os:
        logger.error(f"Error de OS al eliminar la estrategia '{strategy_name}' desde {strategy_file_path}: {e_os}", exc_info=True)
        return jsonify({"error": f"Error del sistema al eliminar la estrategia '{strategy_name}'."}), 500
    except Exception as e:
        logger.error(f"Error inesperado al eliminar la estrategia '{strategy_name}' desde {strategy_file_path}: {e}", exc_info=True)
        return jsonify({"error": f"Error interno inesperado al eliminar la estrategia: {str(e)}"}), 500

@app.route('/api/strategies/<strategy_name>', methods=['GET', 'POST', 'DELETE'])
def handle_specific_strategy(strategy_name: str):
    logger = get_logger()
    logger.info(f"Solicitud {request.method} para estrategia: {strategy_name}")

    # Validación común del nombre de la estrategia
    # Permitir la mayoría de los caracteres, excepto los que son problemáticos para nombres de archivo/URLs.
    # Prohibido: '.', '/', '\\'
    # Permitidos implícitamente: espacios (manejados por encodeURIComponent), guiones, guiones bajos, etc.
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
        # Esto no debería ocurrir si los methods están bien definidos en la ruta
        logger.error(f"Método {request.method} no permitido para esta ruta.")
        return jsonify({"error": "Método no permitido"}), 405

@app.route('/api/strategies', methods=['GET'])
def list_strategies():
    logger = get_logger()
    logger.info("Solicitud para listar estrategias guardadas con resumen.")
    try:
        if not os.path.exists(STRATEGIES_PATH):
            logger.warning(f"El directorio de estrategias {STRATEGIES_PATH} no existe. Devolviendo lista vacía.")
            return jsonify([]), 200
            
        strategy_files = [f for f in os.listdir(STRATEGIES_PATH) if f.endswith('.json')]
        results = []
        for f in strategy_files:
            strategy_name = os.path.splitext(f)[0]
            full_path = os.path.join(STRATEGIES_PATH, f)
            config_data = {}
            try:
                with open(full_path, 'r', encoding='utf-8') as sf:
                    config_data = json.load(sf)
            except Exception as e:
                logger.warning(f"No se pudo leer config para {strategy_name}: {e}")
            results.append({
                "name": strategy_name,
                "config": config_data
            })
            
        return jsonify(results), 200
    except Exception as e:
        logger.error(f"Error al listar estrategias: {e}", exc_info=True)
        return jsonify({"error": f"Error interno al listar estrategias: {str(e)}"}), 500

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
            symbols_to_test = data.get('symbols') or (list(loaded_symbols_to_trade) if loaded_symbols_to_trade else ["SOLUSDT", "DOGEUSDT", "OPUSDT", "SUIUSDT", "NEARUSDT", "ADAUSDT", "ONDOUSDT", "ARBUSDT"])
            r_tag = f"desde {start_date} hasta {end_date}" if (start_date and end_date) else f"{days} días"
            logger.info(f"Iniciando backtest de PORTAFOLIO COMPLETO ({len(symbols_to_test)} pares, {r_tag}, intervalo {interval})...")
            results = run_portfolio_backtest(symbols=symbols_to_test, interval=interval, days=days, start_date=start_date, end_date=end_date, config=strategy_config, initial_balance_per_coin=initial_balance)
            return jsonify(results), 200

        r_tag = f"desde {start_date} hasta {end_date}" if (start_date and end_date) else f"{days} días"
        logger.info(f"Iniciando backtest histórico para {symbol} ({r_tag}, intervalo {interval})...")
        df = get_historical_klines_paginated(symbol=symbol, interval=interval, days=days, start_date=start_date, end_date=end_date, use_cache=True)
        if df is None or df.empty:
            return jsonify({"error": f"No se pudieron descargar velas históricas para {symbol} en el período solicitado."}), 400

        results = run_strategy_backtest(symbol=symbol, df=df, config=strategy_config, initial_balance=initial_balance)
        return jsonify(results), 200
    except Exception as e:
        logger.error(f"Error al ejecutar backtest: {e}", exc_info=True)
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
        """Calcula en tiempo real la suma exacta del margen en riesgo en todas las posiciones abiertas activas."""
        total_exp = Decimal('0')
        try:
            with status_lock:
                for symbol, bot_instance in list(worker_statuses.items()):
                    if hasattr(bot_instance, 'in_position') and bot_instance.in_position:
                        margin = getattr(bot_instance, 'margin_for_current_position', None)
                        if margin is not None and margin > Decimal('0'):
                            total_exp += Decimal(str(margin))
                        elif hasattr(bot_instance, 'current_position') and bot_instance.current_position:
                            entry_p = Decimal(str(bot_instance.current_position.get('entry_price', 0)))
                            qty = Decimal(str(bot_instance.current_position.get('quantity', 0)))
                            lev = Decimal(str(getattr(bot_instance, 'leverage', 1)))
                            if lev > 0:
                                total_exp += (entry_p * qty) / lev
                            else:
                                total_exp += entry_p * qty
                        elif hasattr(bot_instance, 'position_size_usdt'):
                            total_exp += Decimal(str(bot_instance.position_size_usdt))
        except Exception as e:
            self.logger.warning(f"Error calculando exposición actual en RiskManager: {e}")
        return total_exp

    def can_open_position(self, position_size_usdt: Decimal) -> bool:
        with self.lock:
            current_exp = self.get_current_exposure()
            if current_exp + position_size_usdt <= self.max_exposure:
                return True
            else:
                self.logger.warning(f"Apertura de posición rechazada. Exposición actual ({current_exp:.2f} USDT) + nueva ({position_size_usdt:.2f} USDT) excede el máximo permitido ({self.max_exposure:.2f} USDT).")
                return False

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
            try:
                new_bal = get_account_balance_usdt()
                if new_bal is not None:
                    self.total_balance = new_bal
                    self.max_exposure = self.total_balance * self.risk_percentage
            except Exception:
                pass

            real_exp = self.get_current_exposure()
            self.current_exposure = real_exp
            free_margin = max(Decimal('0'), self.total_balance - real_exp)
            exp_pct = (real_exp / self.total_balance * Decimal('100')) if self.total_balance > Decimal('0') else Decimal('0')

            return {
                'total_balance': f"{self.total_balance:.2f}",
                'risk_percentage': f"{self.risk_percentage:.2%}",
                'risk_percentage_raw': float(self.risk_percentage * Decimal('100')),
                'max_exposure': f"{self.max_exposure:.2f}",
                'current_exposure': f"{real_exp:.2f}",
                'free_margin': f"{free_margin:.2f}",
                'exposure_percentage': f"{exp_pct:.1f}%",
                'exposure_percentage_raw': float(exp_pct)
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
                percentage = Decimal(data['risk_percentage']) / Decimal('100')
                risk_manager.set_risk_percentage(percentage)
                return jsonify({'message': 'Risk percentage updated successfully.'}), 200
            except Exception as e:
                return jsonify({'error': f'Invalid value for risk_percentage: {e}'}), 400
        return jsonify({'error': 'Missing or invalid risk_percentage in request body.'}), 400
    
    # GET request
    return jsonify(risk_manager.get_status()), 200 