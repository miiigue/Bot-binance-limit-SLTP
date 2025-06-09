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

# --- Quitar Workaround sys.path --- 
# current_dir = os.path.dirname(os.path.abspath(__file__))
# project_root = os.path.dirname(current_dir) 
# if project_root not in sys.path:
#     sys.path.insert(0, project_root)

# Importar funciones y variables usando importaciones ABSOLUTAS (desde src)
from src.config_loader import load_config, get_trading_symbols, CONFIG_FILE_PATH
from src.logger_setup import setup_logging, get_logger
from src.database import get_cumulative_pnl_by_symbol, get_last_n_trades_for_symbol
# Importar TradingBot y BotState para run_bot_worker
from src.bot import TradingBot, BotState 

# --- Definición de variables compartidas para la gestión de workers ---
worker_statuses = {} # Ej: {'BTCUSDT': {'state': 'IN_POSITION', 'pnl': 5.2}, 'ETHUSDT': ...}
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
                elif val.lower() in ['true', 'false']:
                    processed_val = config.getboolean(section, key)
                elif '.' in val:
                    processed_val = config.getfloat(section, key)
                else:
                    processed_val = config.getint(section, key)
            except ValueError:
                processed_val = val # Mantener como string si no
            the_dict[section][key] = processed_val
    return the_dict

def map_frontend_trading_binance(frontend_data: dict) -> dict:
    """Mapea los datos del frontend a la estructura esperada por configparser para [TRADING] y [BINANCE]."""
    config_output = {
        'BINANCE': {
            'mode': frontend_data.get('mode', 'paper'),
        },
        'TRADING': {
            'rsi_interval': frontend_data.get('rsiInterval', '5m'),
            'rsi_period': str(frontend_data.get('rsiPeriod', 14)),
            'rsi_threshold_up': str(frontend_data.get('rsiThresholdUp', 8)),
            'rsi_threshold_down': str(frontend_data.get('rsiThresholdDown', -8)),
            'rsi_entry_level_low': str(frontend_data.get('rsiEntryLevelLow', 25)),
            'rsi_entry_level_high': str(frontend_data.get('rsiEntryLevelHigh', 75)),
            'rsi_target': str(frontend_data.get('rsiTarget', 50)),
            'volume_sma_period': str(frontend_data.get('volumeSmaPeriod', 20)),
            'volume_factor': str(frontend_data.get('volumeFactor', 1.5)),
            'downtrend_check_candles': str(frontend_data.get('downtrendCheckCandles', 3)),
            'downtrend_level_check': str(frontend_data.get('downtrend_level_check', 5)),
            'required_uptrend_candles': str(frontend_data.get('requiredUptrendCandles', 0)),
            'position_size_usdt': str(frontend_data.get('positionSizeUSDT', 50)),
            'stop_loss_usdt': str(frontend_data.get('stopLossUSDT', 20)),
            'take_profit_usdt': str(frontend_data.get('takeProfitUSDT', 30)),
            'cycle_sleep_seconds': str(frontend_data.get('cycleSleepSeconds', 5)),
            'order_timeout_seconds': str(frontend_data.get('orderTimeoutSeconds', 10)),
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
            'price_trailing_stop_distance_usdt': str(frontend_data.get('priceTrailingStopDistanceUSDT', 0.05)),
            'price_trailing_stop_activation_pnl_usdt': str(frontend_data.get('priceTrailingStopActivationPnlUSDT', 0.02)),
            'enable_pnl_trailing_stop': str(frontend_data.get('enablePnlTrailingStop', True)).lower(),
            'pnl_trailing_stop_activation_usdt': str(frontend_data.get('pnlTrailingStopActivationUSDT', 0.1)),
            'pnl_trailing_stop_drop_usdt': str(frontend_data.get('pnlTrailingStopDropUSDT', 0.05)),
            'evaluate_open_interest_increase': str(frontend_data.get('evaluateOpenInterestIncrease', True)).lower(),
            'open_interest_period': frontend_data.get('openInterestPeriod', '5m')
        },
        'SYMBOLS': {
            'symbols_to_trade': ",".join([s.strip().upper() for s in frontend_data.get('symbolsToTrade', '').split(',') if s.strip()])
        }
    }
    if 'TRADING' in config_output and 'rsi_period' in config_output['TRADING']:
        try:
            config_output['TRADING']['rsi_period'] = int(config_output['TRADING']['rsi_period'])
        except ValueError:
            pass 
    return config_output

# --- Función run_bot_worker (Movida desde run_bot.py) ---
# Adaptada para usar las variables globales definidas aquí
def run_bot_worker(symbol, trading_params, stop_event_ref):
    """Función ejecutada por cada hilo para manejar un bot de símbolo único."""
    logger = get_logger()
    
    bot_instance = None
    try:
        # Asegurarse de que trading_params no esté vacío
        if not trading_params:
             logger.error(f"[{symbol}] No se proporcionaron parámetros de trading válidos al worker. Terminando.")
             # Actualizar estado a Error
             with status_lock:
                  worker_statuses[symbol] = {
                      'symbol': symbol, 'state': BotState.ERROR.value, 'last_error': "Missing trading parameters.",
                      'in_position': False, 'entry_price': None, 'quantity': None, 'pnl': None,
                      'pending_entry_order_id': None, 'pending_exit_order_id': None
                  }
             return
             
        # Obtener sleep_duration aquí usando la función movida
        sleep_duration = get_sleep_seconds(trading_params)
        
        bot_instance = TradingBot(symbol=symbol, trading_params=trading_params)
        with status_lock:
             worker_statuses[symbol] = bot_instance.get_current_status() 
        logger.info(f"[{symbol}] Worker thread iniciado. Instancia de TradingBot creada. Tiempo de espera: {sleep_duration}s") # Usar sleep_duration
    except (ValueError, ConnectionError) as init_error:
         logger.error(f"No se pudo inicializar la instancia de TradingBot para {symbol}: {init_error}. Terminando worker.", exc_info=True)
         with status_lock:
              worker_statuses[symbol] = {
                  'symbol': symbol, 'state': BotState.ERROR.value, 'last_error': str(init_error),
                  'in_position': False, 'entry_price': None, 'quantity': None, 'pnl': None,
                  'pending_entry_order_id': None, 'pending_exit_order_id': None
              }
         return
    except Exception as thread_error:
         logger.error(f"Error inesperado al crear instancia de TradingBot para {symbol}: {thread_error}. Terminando worker.", exc_info=True)
         with status_lock:
              worker_statuses[symbol] = {
                  'symbol': symbol, 'state': BotState.ERROR.value, 
                  'last_error': f"Unexpected init error: {thread_error}",
                  'in_position': False, 'entry_price': None, 'quantity': None, 'pnl': None,
                  'pending_entry_order_id': None, 'pending_exit_order_id': None
              }
         return

    # Ya no necesitamos get_sleep_seconds aquí si lo calculamos antes

    while not stop_event_ref.is_set():
        try:
            if bot_instance:
                bot_instance.run_once()
            if bot_instance:
                with status_lock:
                     worker_statuses[symbol] = bot_instance.get_current_status()
        except Exception as cycle_error:
            logger.error(f"[{symbol}] Error inesperado en el ciclo principal del worker: {cycle_error}", exc_info=True)
            if bot_instance:
                bot_instance._set_error_state(f"Unhandled exception in worker loop: {cycle_error}")
                with status_lock:
                     worker_statuses[symbol] = bot_instance.get_current_status()
            else:
                 # Si bot_instance es None aquí, hubo un error muy temprano
                 with status_lock:
                      if symbol not in worker_statuses or not isinstance(worker_statuses.get(symbol), dict):
                           worker_statuses[symbol] = {} # Asegurar que existe como dict
                           
                      worker_statuses[symbol].update({
                          'symbol': symbol, 'state': BotState.ERROR.value, 
                          'last_error': f"Critical worker loop error before bot ready: {cycle_error}",
                          'in_position': False, 'entry_price': None, 'quantity': None, 'pnl': None,
                          'pending_entry_order_id': None, 'pending_exit_order_id': None
                      })
            # Continuar el bucle para permitir posible recuperación o apagado
            pass 

        # Usar el sleep_duration calculado
        interrupted = stop_event_ref.wait(timeout=sleep_duration)
        if interrupted:
            logger.info(f"[{symbol}] Señal de parada recibida durante la espera.")
            break

    logger.info(f"[{symbol}] Worker thread terminado.")
    # Actualizar estado final al detenerse
    with status_lock:
         # Asegurarse que la entrada existe y es un diccionario
         if symbol not in worker_statuses or not isinstance(worker_statuses.get(symbol), dict):
             worker_statuses[symbol] = {'symbol': symbol} # Crear entrada mínima
         worker_statuses[symbol]['state'] = BotState.STOPPED.value
# --- Fin de run_bot_worker ---


# --- Función para iniciar los workers (Movida y Adaptada) ---
def start_bot_workers():
    global workers_started, threads, loaded_trading_params, loaded_symbols_to_trade
    logger = get_logger()
    
    with status_lock: # Proteger acceso a workers_started y threads
        if workers_started:
            logger.warning("start_bot_workers fue llamado pero los workers ya están iniciados.")
            return False # Indicar que no se hizo nada

        worker_statuses.clear() # Clear previous statuses before starting new ones
        threads.clear() # Limpiar lista de hilos anterior
        stop_event.clear() # Asegurarse que el evento de parada no esté activo

        if not loaded_symbols_to_trade:
            logger.error("No hay símbolos configurados para iniciar los workers.")
            return False
            
        if not loaded_trading_params:
            logger.error("No hay parámetros de trading configurados para iniciar los workers.")
            return False

        logger.info("Iniciando workers de bot...")
        for symbol_idx, symbol in enumerate(loaded_symbols_to_trade):
            logger.info(f"-> Preparando worker para {symbol}...")
            # Usar loaded_trading_params
            thread = threading.Thread(target=run_bot_worker, args=(symbol, loaded_trading_params, stop_event), name=f"Worker-{symbol}")
            threads.append(thread)
            thread.start()
            if (symbol_idx + 1) < len(loaded_symbols_to_trade):
                 # Espera corta entre inicios de hilos para evitar sobrecarga inicial
                 time.sleep(1) 
        
        num_bot_threads = len(threads)
        workers_started = True # Marcar como iniciados
        logger.info(f"Todos los {num_bot_threads} workers de bot iniciados.")
        return True # Indicar éxito
# --- Fin de start_bot_workers ---


# --- Endpoints de la API ---

@app.route('/api/config', methods=['GET'])
def get_config_endpoint():
    """Endpoint para obtener la configuración actual."""
    global loaded_trading_params, loaded_symbols_to_trade # Usar las globales cargadas
    api_logger.info("Solicitud GET /api/config recibida.")

    config = configparser.ConfigParser(allow_no_value=True)
    try:
        if not os.path.exists(CONFIG_FILE_PATH):
            api_logger.warning(f"El archivo de configuración {CONFIG_FILE_PATH} no existe. Devolviendo configuración por defecto.")
            # Devolver los valores por defecto que el frontend podría esperar
            # Esta es una simplificación; idealmente, los valores por defecto estarían centralizados
            default_frontend_config = {
                "mode": "paper",
                "rsiInterval": "5m",
                "rsiPeriod": 14,
                "rsiThresholdUp": 8,
                "rsiThresholdDown": -8,
                "rsiEntryLevelLow": 25,
                "rsiEntryLevelHigh": 75,
                "rsiTarget": 50,
                "volumeSmaPeriod": 20,
                "volumeFactor": 1.5,
                "downtrendCheckCandles": 3,
                "downtrend_level_check": 5, # Mantener consistencia con config.ini
                "requiredUptrendCandles": 0,
                "positionSizeUSDT": 50,
                "stopLossUSDT": 20,
                "takeProfitUSDT": 30,
                "cycleSleepSeconds": 5,
                "orderTimeoutSeconds": 10,
                "evaluateRsiDelta": True,
                "evaluateVolumeFilter": True,
                "evaluateRsiRange": True,
                "evaluateDowntrendCandlesBlock": True,
                "evaluateDowntrendLevelsBlock": True,
                "evaluateRequiredUptrend": True,
                "enableTakeProfitPnl": True,
                "enableStopLossPnl": True,
                "enableTrailingRsiStop": True,
                "enablePriceTrailingStop": True,
                "priceTrailingStopDistanceUSDT": 0.05,
                "priceTrailingStopActivationPnlUSDT": 0.02,
                "enablePnlTrailingStop": True,
                "pnlTrailingStopActivationUSDT": 0.1,
                "pnlTrailingStopDropUSDT": 0.05,
                "evaluateOpenInterestIncrease": True, # Cambio de clave aquí
                "openInterestPeriod": "5m", # <-- Clave para el frontend
                "symbolsToTrade": ""
            }
            return jsonify(default_frontend_config)
        
        config.read(CONFIG_FILE_PATH)
        config_dict = config_to_dict(config)
        
        # Mapear para el frontend
        frontend_config = {}
        if 'BINANCE' in config_dict:
            frontend_config['mode'] = config_dict['BINANCE'].get('mode', 'paper')
        
        if 'TRADING' in config_dict:
            # Mapear claves de config.ini a las esperadas por el frontend
            for key_ini, key_frontend in [
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
                ('downtrend_level_check', 'downtrend_level_check'), # Ya es la correcta
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
                ('evaluate_open_interest_increase', 'evaluateOpenInterestIncrease'), # Cambio de clave aquí
                ('open_interest_period', 'openInterestPeriod') # <-- CAMBIO DE CLAVE AQUÍ para el frontend
            ]:
                if key_ini in config_dict['TRADING']:
                    frontend_config[key_frontend] = config_dict['TRADING'][key_ini]
        
        if 'SYMBOLS' in config_dict:
            frontend_config['symbolsToTrade'] = config_dict['SYMBOLS'].get('symbols_to_trade', '')

        # Asegurar que las globales también se actualizan si es la primera carga o si el archivo cambió
        loaded_trading_params = config_dict.get('TRADING', {})
        loaded_symbols_to_trade = frontend_config.get('symbolsToTrade', '').split(',') if frontend_config.get('symbolsToTrade') else []

        api_logger.info(f"Configuración FINAL que se enviará al frontend vía /api/config GET: {frontend_config}")
        api_logger.info(f"Específicamente, symbolsToTrade que se enviará: {frontend_config.get('symbolsToTrade')}")
        api_logger.info(f"Específicamente, rsiPeriod que se enviará: {frontend_config.get('rsiPeriod')}")
        return jsonify(frontend_config)
    
    except FileNotFoundError:
        api_logger.error(f"El archivo de configuración {CONFIG_FILE_PATH} no fue encontrado.")
        return jsonify({"error": "Config file not found"}), 404
    except Exception as e:
        api_logger.error(f"Error al procesar la configuración: {e}", exc_info=True)
        return jsonify({"error": f"Error processing config: {e}"}), 500

@app.route('/api/config', methods=['POST'])
def update_config_endpoint():
    """Endpoint para recibir y guardar la configuración, incluyendo símbolos."""
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

    # 1. Extraer la lista de símbolos del frontend_data
    symbols_string_raw = frontend_data.get('symbolsToTrade', '') # Usar la clave del estado de React
    # Limpiar y validar la lista de símbolos
    symbols_list = [s.strip().upper() for s in symbols_string_raw.split(',') if s.strip()]
    symbols_to_save = ",".join(symbols_list) # Guardar como string separado por comas
    logger.debug(f"Símbolos procesados para guardar: {symbols_to_save}")

    # 2. Mapear los otros parámetros (BINANCE, TRADING)
    #    apiKey y apiSecret ya no serán procesados por map_frontend_trading_binance
    ini_other_data = map_frontend_trading_binance(frontend_data)

    config = configparser.ConfigParser(interpolation=None, inline_comment_prefixes=(';', '#'))
    try:
        # Leer el archivo existente para mantener secciones no modificadas (ej: LOGGING)
        if os.path.exists(CONFIG_FILE_PATH):
             config.read(CONFIG_FILE_PATH, encoding='utf-8')
        else:
             logger.warning(f"El archivo {CONFIG_FILE_PATH} no existía, se creará uno nuevo.")

        # 3. Actualizar el objeto config con los datos mapeados (BINANCE, TRADING)
        for section, keys in ini_other_data.items():
            if not config.has_section(section):
                config.add_section(section)
            for key, value in keys.items():
                config.set(section, key, str(value))
                logger.debug(f"Actualizando [{section}] {key} = {str(value)}")
                
        # 4. Actualizar/Crear la sección [SYMBOLS]
        if not config.has_section('SYMBOLS'):
            config.add_section('SYMBOLS')
        config.set('SYMBOLS', 'symbols_to_trade', symbols_to_save)
        logger.debug(f"Actualizando [SYMBOLS] symbols_to_trade = {symbols_to_save}")

        # 5. Escribir los cambios de vuelta al archivo config.ini
        with open(CONFIG_FILE_PATH, 'w', encoding='utf-8') as configfile:
            config.write(configfile)
        
        logger.info(f"Archivo de configuración {CONFIG_FILE_PATH} actualizado exitosamente.")
        return jsonify({"message": "Configuration updated successfully"}), 200

    except Exception as e:
        logger.error(f"Error al escribir la configuración: {e}", exc_info=True)
        return jsonify({"error": "Failed to write configuration"}), 500

@app.route('/api/status', methods=['GET'])
def get_worker_status():
    global workers_started # Necesitamos acceso al flag global
    logger = get_logger()
    logger.debug("API call received for /api/status")
    
    try: # <--- INICIO DEL BLOQUE TRY GENERAL
        all_symbols_status = []
        # Usar los símbolos cargados al inicio
        configured_symbols = loaded_symbols_to_trade 
        historical_pnl_data = get_cumulative_pnl_by_symbol()

        logger.debug(f"Símbolos configurados (cargados al inicio): {configured_symbols}")
        logger.debug(f"PnL histórico de DB: {historical_pnl_data}")

        with status_lock: 
            active_worker_details = dict(worker_statuses)

        for symbol in configured_symbols:
            status_entry = {
                'symbol': symbol,
                'state': BotState.STOPPED.value if not workers_started else 'Initializing', # Estado inicial antes de que el worker actualice
                'in_position': False,
                'entry_price': None,
                'quantity': None,
                'pnl': None,
                'pending_entry_order_id': None,
                'pending_exit_order_id': None,
                'last_error': None,
                'cumulative_pnl': historical_pnl_data.get(symbol, 0.0) # Only this key for historical PNL
            }

            if symbol in active_worker_details and workers_started:
                active_status = active_worker_details[symbol]
                if active_status.get('state') != BotState.STOPPED.value:
                    status_entry.update(active_status)
                    status_entry['symbol'] = symbol 
                    status_entry['cumulative_pnl'] = historical_pnl_data.get(symbol, 0.0)
                    for key_to_remove in ['hist_pnl', 'histPnl', 'historical_pnl', 'historicalPnl', 'cumulativePnl']:
                        if key_to_remove in status_entry:
                            del status_entry[key_to_remove]
                elif active_status.get('state') == BotState.STOPPED.value:
                    status_entry['state'] = BotState.STOPPED.value
                    status_entry['cumulative_pnl'] = historical_pnl_data.get(symbol, 0.0)
                    for key_to_remove in ['hist_pnl', 'histPnl', 'historical_pnl', 'historicalPnl', 'cumulativePnl']:
                        if key_to_remove in status_entry:
                            del status_entry[key_to_remove]
            
            all_symbols_status.append(status_entry)
        
        response_data = {
            "bots_running": workers_started,
            "statuses": all_symbols_status
        }
        
        logger.debug(f"Returning combined statuses. Bots running: {workers_started}")
        return jsonify(response_data)

    except Exception as e: # <--- BLOQUE CATCH GENERAL
        logger.error(f"CRITICAL ERROR in /api/status endpoint: {e}", exc_info=True)
        return jsonify({"error": "Internal server error processing status.", "details": str(e)}), 500

@app.route('/api/shutdown', methods=['POST'])
def shutdown_bot():
    global workers_started, threads
    api_logger.warning("Solicitud de apagado recibida a través de la API.")
    
    if not workers_started:
         api_logger.warning("Señal de apagado recibida, pero los workers no estaban iniciados.")
         return jsonify({"message": "Workers no estaban corriendo."}), 200 # O un 4xx?

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
        return jsonify({"error": "Bots ya están corriendo."}), 409 # 409 Conflict

    # Llamar a la función que realmente inicia los hilos
    success = start_bot_workers() 

    if success:
        return jsonify({"message": "Bots iniciados exitosamente."}), 200
    else:
        logger.error("Fallo al iniciar los workers (ver logs anteriores).")
        # Revisar si workers_started se quedó en False debido al fallo
        if not workers_started:
             return jsonify({"error": "Fallo al iniciar los bots (verificar configuración o logs)."}), 500 # Internal Server Error
        else:
             # Caso raro: la función falló pero el flag cambió? Devolver error igualmente.
              return jsonify({"error": "Estado inconsistente al iniciar los bots."}), 500
# ------------------------------------------

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
        original_value = value_str # Guardar para logs en caso de error
        try:
            if key in ['rsi_period', 'volume_sma_period', 'cycle_sleep_seconds', 'order_timeout_seconds', 'downtrend_check_candles', 'downtrend_level_check', 'required_uptrend_candles']:
                loaded_trading_params[key] = int(value_str)
            elif key in ['rsi_threshold_up', 'rsi_threshold_down', 'rsi_entry_level_low', 'rsi_entry_level_high',
                         'rsi_target',
                         'volume_factor', 'position_size_usdt', 'stop_loss_usdt', 'take_profit_usdt',
                         'price_trailing_stop_distance_usdt',
                         'price_trailing_stop_activation_pnl_usdt']:
                loaded_trading_params[key] = float(value_str)
            elif key == 'evaluate_rsi_delta':
                loaded_trading_params[key] = value_str.lower() == 'true'
            elif key == 'evaluate_volume_filter':
                loaded_trading_params[key] = value_str.lower() == 'true'
            elif key == 'evaluate_rsi_range':
                loaded_trading_params[key] = value_str.lower() == 'true'
            elif key == 'evaluate_downtrend_candles_block':
                loaded_trading_params[key] = value_str.lower() == 'true'
            elif key == 'evaluate_downtrend_levels_block':
                loaded_trading_params[key] = value_str.lower() == 'true'
            elif key == 'evaluate_required_uptrend':
                loaded_trading_params[key] = value_str.lower() == 'true'
            elif key == 'enable_take_profit_pnl':
                loaded_trading_params[key] = value_str.lower() == 'true'
            elif key == 'enable_stop_loss_pnl':
                loaded_trading_params[key] = value_str.lower() == 'true'
            elif key == 'enable_trailing_rsi_stop':
                loaded_trading_params[key] = value_str.lower() == 'true'
            elif key == 'enable_price_trailing_stop':
                loaded_trading_params[key] = value_str.lower() == 'true'
            elif key == 'enable_pnl_trailing_stop':
                loaded_trading_params[key] = value_str.lower() == 'true'
            else:
                loaded_trading_params[key] = value_str # Mantener como string si no es uno de los conocidos numéricos
        except ValueError:
            logger.error(f"Error al convertir el parámetro de TRADING '{key}' con valor '{original_value}' a su tipo numérico esperado. Usando string o fallback si aplica.")
            loaded_trading_params[key] = original_value # Mantener el valor original como string si falla la conversión

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
    """Devuelve una lista de nombres de estrategias guardadas."""
    if not os.path.exists(STRATEGIES_PATH):
        return jsonify([]) # Devolver array vacío si el directorio no existe

    try:
        # Filtrar solo archivos .json y quitar la extensión
        strategy_files = [f.replace('.json', '') for f in os.listdir(STRATEGIES_PATH) if f.endswith('.json')]
        return jsonify(strategy_files)
    except Exception as e:
        api_logger.error(f"Error al listar estrategias: {e}", exc_info=True)
        return jsonify({"error": "No se pudieron listar las estrategias"}), 500

@app.route('/api/strategies/set-active/<strategy_name>', methods=['POST'])
def set_active_strategy(strategy_name: str):
    """Actualiza el config.ini para establecer la estrategia activa."""
    api_logger.info(f"Recibida solicitud para activar la estrategia: {strategy_name}")
    try:
        config = configparser.ConfigParser()
        # Leer con UTF-8 para asegurar compatibilidad
        config.read(CONFIG_FILE_PATH, encoding='utf-8')

        # Si la sección [STRATEGY_INFO] no existe, la creamos
        if not config.has_section('STRATEGY_INFO'):
            config.add_section('STRATEGY_INFO')
            api_logger.info("Sección [STRATEGY_INFO] no encontrada, creada en config.ini.")

        # Establecer el nombre de la estrategia activa
        config.set('STRATEGY_INFO', 'active_strategy_name', strategy_name)

        # Guardar los cambios en el archivo
        with open(CONFIG_FILE_PATH, 'w', encoding='utf-8') as configfile:
            config.write(configfile)
        
        api_logger.info(f"Estrategia activa actualizada a '{strategy_name}' en {CONFIG_FILE_PATH}")
        return jsonify({"message": f"Estrategia activa establecida a: {strategy_name}"}), 200

    except Exception as e:
        api_logger.error(f"Error al establecer la estrategia activa '{strategy_name}': {e}", exc_info=True)
        return jsonify({"error": f"No se pudo establecer la estrategia activa: {e}"}), 500

# La función para correr Flask en un hilo (start_flask_app) 
# y el if __name__ == '__main__' no se necesitan aquí 
# si api_server.py es solo para definir la app y sus rutas,
# y es importado por run_bot.py 