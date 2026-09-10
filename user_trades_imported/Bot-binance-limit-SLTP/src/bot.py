# Este módulo contendrá la lógica principal del bot y coordinará los demás módulos.
# Por ahora, lo dejamos vacío. 

import time
import pandas as pd
from decimal import Decimal, ROUND_DOWN, ROUND_UP
import math
from enum import Enum # <-- Importar Enum
import os
import threading
from datetime import datetime

# Importamos los módulos que hemos creado
# from .config_loader import load_config # No se usa directamente aquí ahora
from .logger_setup import get_logger
from .utils import get_sleep_seconds
from .binance_client import (
    get_futures_client,
    get_historical_klines,
    get_futures_symbol_info,
    get_futures_position,
    get_order_book_ticker,
    create_futures_limit_order,
    get_order_status,
    cancel_futures_order,
    create_futures_take_profit_order, # <-- NUEVA IMPORTACIÓN
    create_futures_stop_loss_order,    # <-- NUEVA IMPORTACIÓN
    get_user_trade_history, # <-- NUEVA IMPORTACIÓN
    get_open_interest_history, # <-- NUEVA IMPORTACIÓN
    get_last_account_trade,
    get_futures_position_information
)
from .rsi_calculator import calculate_rsi
from .database import init_db_schema, record_trade # Importamos solo las necesarias
# --- NUEVA IMPORTACIÓN DE DB ---
from .database import check_if_binance_trade_exists 
# -----------------------------

# --- Definición de Estados del Bot ---
class BotState(Enum):
    INITIALIZING = "Initializing"
    IDLE = "Idle (Waiting Cycle)"
    FETCHING_DATA = "Fetching Market Data"
    CHECKING_CONDITIONS = "Checking Entry/Exit Conditions"
    PLACING_ENTRY = "Placing Entry Order"
    WAITING_ENTRY_FILL = "Waiting Entry Order Fill"
    IN_POSITION = "In Position"
    PLACING_EXIT = "Placing Exit Order"
    WAITING_EXIT_FILL = "Waiting Exit Order Fill"
    CANCELING_ORDER = "Canceling Order"
    ERROR = "Error State"
    STOPPED = "Stopped" # <-- Nuevo estado
# ------------------------------------

class TradingBot:
    """
    Clase que encapsula la lógica de trading RSI para UN símbolo específico.
    Interactúa con Binance Futures (Testnet/Live según cliente global).
    Diseñada para ser instanciada por cada símbolo a operar.
    Ahora usa órdenes LIMIT.
    """
    def __init__(self, symbol: str, trading_params: dict, risk_manager):
        """
        Inicializa el bot para un símbolo específico.
        Lee parámetros, inicializa el cliente, obtiene información del símbolo y estado inicial.
        """
        self.symbol = symbol.upper()
        self.risk_manager = risk_manager # <-- Guardar referencia al gestor de riesgo
        self.state = BotState.INITIALIZING
        self.in_position = False
        self.is_running = False
        self.last_known_pnl = 0.0
        self.last_known_entry_price = 0.0
        self.last_known_position_size = 0.0
        self.last_error_message = None
        self.entry_reason = ""
        self.exit_reason = ""
        self.current_position = None
        self.historical_pnl = Decimal('0') # Para PNL histórico total
        self.session_pnl = Decimal('0') # <-- NUEVO: Para PNL de la sesión actual
        self.margin_for_current_position = Decimal('0') # Para seguimiento de margen real
        
        # --- Variables de control de la estrategia (IDs de órdenes) ---
        self.active_order_id = None
        self.active_order_type = None
        self.pending_entry_order_id = None
        self.pending_exit_order_id = None
        self.pending_tp_order_id = None
        self.pending_sl_order_id = None

        self.logger = get_logger()
        self.params = trading_params
        self.logger.info(f"[{self.symbol}] Inicializando worker con parámetros RECIBIDOS: {self.params}")
        self.logger.info(f"[{self.symbol}] Inicializando worker con parámetros: {self.params}")

        # --- Estado Interno ---
        self.current_state = BotState.INITIALIZING # Estado inicial
        self.last_error_message = None # Para guardar el último error
        self.last_known_pnl = None # <-- Initialize PnL attribute
        self.current_exit_reason = None # <-- Razón de la salida pendiente actual
        self.tp_price = None
        self.entry_reason = ""
        self.exit_reason = ""
        self.downtrend_check_candles = trading_params.get('downtrend_check_candles', 0) # <-- Nuevo atributo
        self.downtrend_level_check = int(trading_params.get('downtrend_level_check', 0)) # <-- NUEVO: Para el check de niveles, asegurando tipo int
        self.required_uptrend_candles = int(trading_params.get('required_uptrend_candles', 0)) # <-- NUEVO PARÁMETRO
        self.rsi_at_entry = None # <-- NUEVO: Para guardar el RSI al momento de la entrada
        self.rsi_target = float(self.params.get('rsi_target', 50.0)) # Nuevo campo para RSI objetivo
        self.rsi_objetivo_activado = False  # <-- MOVIDO AQUÍ: Indica si el objetivo ya fue alcanzado
        self.rsi_objetivo_alcanzado_en = None  # <-- MOVIDO AQUÍ: Guarda el valor de RSI cuando se alcanzó el objetivo
        self.rsi_peak_since_target = None # Almacenará el RSI más alto desde que rsi_target fue alcanzado
        self.previous_rsi_value = None # <-- NUEVO: Para guardar el RSI de la vela anterior
        # --- NUEVO: IDs para órdenes TP/SL ---
        self.pending_tp_order_id = None
        self.pending_sl_order_id = None
        self.evaluate_rsi_delta = trading_params.get('evaluate_rsi_delta', True) # <-- NUEVO: Leer el parámetro
        self.evaluate_volume_filter = trading_params.get('evaluate_volume_filter', True) # <-- NUEVO: Leer parámetro de filtro de volumen
        # --- Cargar todos los nuevos parámetros de control ---
        self.evaluate_rsi_range = trading_params.get('evaluate_rsi_range', True)
        self.evaluate_downtrend_candles_block = trading_params.get('evaluate_downtrend_candles_block', True)
        self.evaluate_downtrend_levels_block = trading_params.get('evaluate_downtrend_levels_block', True)
        self.evaluate_required_uptrend = trading_params.get('evaluate_required_uptrend', True)
        self.enable_take_profit_pnl = trading_params.get('enable_take_profit_pnl', True)
        self.enable_stop_loss_pnl = trading_params.get('enable_stop_loss_pnl', True)
        self.enable_trailing_rsi_stop = trading_params.get('enable_trailing_rsi_stop', True)
        # --- AÑADIDO: Parámetros para Filtro de Media Móvil ---
        self.evaluate_ma_filter = str(trading_params.get('evaluate_ma_filter', 'False')).lower() == 'true'
        self.ma_type = 'EMA' # Hardcodeado a EMA como default
        self.ma_period = int(trading_params.get('ma_period', 200))
        # ----------------------------------------------------
        # --- NUEVOS PARÁMETROS Y ESTADO PARA TRAILING STOP DE PRECIO ---
        self.enable_price_trailing_stop = trading_params.get('enable_price_trailing_stop', True)
        self.price_trailing_stop_distance_usdt = Decimal(str(trading_params.get('price_trailing_stop_distance_usdt', '0.05')))
        self.price_trailing_stop_activation_pnl_usdt = Decimal(str(trading_params.get('price_trailing_stop_activation_pnl_usdt', '0.02')))
        self.price_peak_since_entry = None # Precio más alto desde la entrada
        self.price_trailing_stop_armed = False # Si el PNL de activación se ha alcanzado
        # --- NUEVOS PARÁMETROS Y ESTADO PARA TRAILING STOP DE PNL ---
        self.enable_pnl_trailing_stop = trading_params.get('enable_pnl_trailing_stop', True)
        self.pnl_trailing_stop_activation_usdt = Decimal(str(trading_params.get('pnl_trailing_stop_activation_usdt', '0.1')))
        self.pnl_trailing_stop_drop_usdt = Decimal(str(trading_params.get('pnl_trailing_stop_drop_usdt', '0.05')))
        self.pnl_peak_since_activation = None # PNL más alto desde que el PNL trailing stop se armó
        self.pnl_trailing_stop_armed = False # Si el PNL trailing stop está armado
        # --- NUEVO: Para Open Interest ---
        self.evaluate_open_interest_increase = str(trading_params.get('evaluate_open_interest_increase', 'True')).lower() == 'true'
        self.open_interest_period = trading_params.get('open_interest_period', '5m') # <-- NUEVO: Leer el período para OI
        # -------------------------------------------------------------
        
        # --- NUEVO: PARÁMETROS PARA ESTRATEGIA DE SOPORTES ---
        self.evaluate_support_strategy = str(trading_params.get('evaluate_support_strategy', 'False')).lower() == 'true'
        self.support_history_candles = int(trading_params.get('support_history_candles', 200))
        self.support_pivot_window = int(trading_params.get('support_pivot_window', 5))
        self.support_confirmations = int(trading_params.get('support_confirmations', 2))
        self.support_level_tolerance_percent = float(trading_params.get('support_level_tolerance_percent', 0.5))
        self.support_order_stop_loss_percent = float(trading_params.get('support_order_stop_loss_percent', 2.0))
        self.support_order_take_profit_percent = float(trading_params.get('support_order_take_profit_percent', 4.0))
        # --- FIN PARÁMETROS DE SOPORTES ---
        
        # --- NUEVO: ESTADO PARA ÓRDENES DE SOPORTE ---
        self.active_support_orders = {} # {price_level: order_id}
        # ---------------------------------------------
        
        # -------------------------------------------------------------
        # --------------------------------------------------

        # Cliente Binance (se inicializa una vez por bot)
        self.client = get_futures_client()
        if not self.client:
            # Error crítico si no se puede inicializar el cliente
            self._set_error_state("Failed to initialize Binance client.")
            # Lanzar una excepción para detener la inicialización de este worker
            raise ConnectionError("Failed to initialize Binance client for worker.")

        # Extraer parámetros necesarios de self.params (usando .get con defaults)
        try:
            self.rsi_interval = str(self.params.get('rsi_interval', '5m'))
            self.rsi_period = int(self.params.get('rsi_period', 14))
            self.rsi_threshold_up = float(self.params.get('rsi_threshold_up', 1.5))
            self.rsi_threshold_down = float(self.params.get('rsi_threshold_down', -1.0))
            self.rsi_entry_level_low = float(self.params.get('rsi_entry_level_low', 25.0))
            self.rsi_entry_level_high = float(self.params.get('rsi_entry_level_high', 75.0))
            # --- Leer parámetros de volumen --- 
            self.volume_sma_period = int(self.params.get('volume_sma_period', 20))
            self.volume_factor = float(self.params.get('volume_factor', 1.5))
            # ----------------------------------
            self.position_size_usdt = Decimal(str(self.params.get('position_size_usdt', '50')))
            self.take_profit_usdt = Decimal(str(self.params.get('take_profit_usdt', '0')))
            self.stop_loss_usdt = Decimal(str(self.params.get('stop_loss_usdt', '0')))
            
            # --- Nuevo parámetro para timeout de órdenes LIMIT ---
            self.order_timeout_seconds = int(self.params.get('order_timeout_seconds', 60))
            if self.order_timeout_seconds < 0:
                self.logger.warning(f"[{self.symbol}] ORDER_TIMEOUT_SECONDS ({self.order_timeout_seconds}) debe ser >= 0. Usando 60.")
                self.order_timeout_seconds = 60
            # ---------------------------------------------------

            # Validaciones básicas de parámetros
            if self.volume_sma_period <= 0:
                 self.logger.warning(f"[{self.symbol}] VOLUME_SMA_PERIOD ({self.volume_sma_period}) debe ser positivo. Usando 20.")
                 self.volume_sma_period = 20
            # if self.volume_factor <= 0: # Comentado para permitir volume_factor = 0 desde config
            #     self.logger.warning(f"[{self.symbol}] VOLUME_FACTOR ({self.volume_factor}) debe ser positivo. Usando 1.5.")
            #     self.volume_factor = 1.5
            if self.take_profit_usdt < 0:
                 self.logger.warning(f"[{self.symbol}] TAKE_PROFIT_USDT ({self.take_profit_usdt}) debe ser positivo o cero. Usando 0.")
                 self.take_profit_usdt = Decimal('0')

        except (ValueError, TypeError) as e:
            self.logger.critical(f"[{self.symbol}] Error al procesar parámetros de trading recibidos: {e}", exc_info=True)
            raise ValueError(f"Parámetros de trading inválidos para {self.symbol}")

        # Obtener información del símbolo (precisiones, filtros, etc.)
        self.symbol_info = get_futures_symbol_info(self.symbol)
        if not self.symbol_info:
            raise ValueError(f"No se pudo obtener la información del símbolo para {self.symbol}")

        self.price_precision = int(self.symbol_info.get('pricePrecision', 0))
        self.qty_precision = int(self.symbol_info.get('quantityPrecision', 0))

        # --- INICIO CORRECCIÓN: Extraer minQty, stepSize y tickSize de los filtros ---
        self.min_qty = None
        self.step_size = None
        self.price_tick_size = None

        filters = self.symbol_info.get('filters', [])
        for f in filters:
            if f.get('filterType') == 'LOT_SIZE':
                self.min_qty = Decimal(f.get('minQty', '0'))
                self.step_size = Decimal(f.get('stepSize', '0'))
                self.logger.info(f"[{self.symbol}] Filtros LOT_SIZE encontrados: minQty={self.min_qty}, stepSize={self.step_size}")
            elif f.get('filterType') == 'PRICE_FILTER':
                self.price_tick_size = Decimal(f.get('tickSize', '0'))
                self.logger.info(f"[{self.symbol}] Filtro PRICE_FILTER encontrado: tickSize={self.price_tick_size}")
        
        if self.min_qty is None or self.step_size is None or self.min_qty == Decimal('0') or self.step_size == Decimal('0'):
             self.logger.error(f"[{self.symbol}] No se encontraron los filtros LOT_SIZE válidos. El bot no podrá operar. minQty={self.min_qty}, stepSize={self.step_size}")
             # Considerar poner el bot en estado de error aquí si es crítico
        if self.price_tick_size is None:
            self.logger.warning(f"[{self.symbol}] No se encontró el filtro PRICE_FILTER. El ajuste de precio usará el default.")
        # --- FIN CORRECCIÓN ---
        
        self._check_initial_position()

        # Si no estamos en un estado de error después de las verificaciones iniciales...
        if self.state == BotState.INITIALIZING:
            # ...decidir el estado basado en si se encontró una posición.
            if self.in_position:
                 self.state = BotState.IN_POSITION
                 self.logger.info(f"[{self.symbol}] Inicialización completa. Posición existente detectada. Transicionando a estado IN_POSITION.")
            else:
                 self.state = BotState.IDLE
                 self.logger.info(f"[{self.symbol}] Inicialización completa. No hay posición. Transicionando a estado IDLE.")

        self.logger.info(f"[{self.symbol}] Worker inicializado exitosamente (Timeout Órdenes: {self.order_timeout_seconds}s).")

    def _reset_state(self):
        self.in_position = False
        self.current_position = None
        self.state = BotState.IDLE
        self.active_order_id = None
        self.active_order_type = None
        self.pending_entry_order_id = None
        self.pending_exit_order_id = None
        self.pending_order_timestamp = None
        self.pnl_peak_since_activation = None
        self.pnl_trailing_stop_armed = False
        self.last_known_pnl = 0.0

    def _check_initial_position(self):
        """
        Verifica si ya existe una posición para el símbolo en Binance al iniciar el bot.
        Esta función ha sido reescrita desde cero para garantizar una sintaxis perfecta.
        """
        self.logger.info(f"[{self.symbol}] Comprobando posición inicial en Binance...")
        position_info = get_futures_position_information()

        if position_info is None:
            self.logger.error(f"[{self.symbol}] No se pudo obtener la información de posiciones de Binance.")
            self._set_error_state("Failed to get position info on startup")
            return

        position_data = next((p for p in position_info if p['symbol'] == self.symbol), None)
        pos_amt_binance = Decimal(position_data.get('positionAmt', '0')) if position_data else Decimal('0')

        if pos_amt_binance != Decimal('0'):
            entry_price_binance = Decimal(position_data.get('entryPrice', '0'))
            unrealized_pnl_binance = Decimal(position_data.get('unRealizedProfit', '0'))

            if pos_amt_binance > Decimal('0'):
                self.logger.info(f"[{self.symbol}] Se encontró posición LONG existente. Sincronizando estado.")
                self.in_position = True
                self.state = BotState.IN_POSITION
                self.last_known_entry_price = entry_price_binance
                self.last_known_position_size = pos_amt_binance
                self.last_known_pnl = unrealized_pnl_binance
                self.current_position = {
                    'entry_price': entry_price_binance,
                    'quantity': pos_amt_binance,
                    'entry_time': pd.Timestamp.now(tz='UTC'),
                    'position_size_usdt': abs(entry_price_binance * pos_amt_binance)
                }
                initial_margin = Decimal(position_data.get('initialMargin', '0'))
                self.margin_for_current_position = initial_margin
                if initial_margin > 0:
                    self.risk_manager.add_exposure(initial_margin)
            else:
                self.logger.warning(f"[{self.symbol}] Se encontró posición CORTA existente. El bot no la gestionará.")
                self.in_position = False
                self.state = BotState.IDLE
        else:
            self.logger.info(f"[{self.symbol}] No se encontró posición existente.")
            self.in_position = False
            self.state = BotState.IDLE

    def _update_open_position_pnl(self) -> bool:
        """
        Actualiza el PNL de una posición abierta y verifica si todavía existe en Binance.
        Devuelve True si la posición sigue abierta, False si se ha cerrado.
        """
        if not self.in_position or not self.current_position: # self.current_position es clave
            self.logger.debug(f"[{self.symbol}] _update_open_position_pnl llamado pero no se está en posición o current_position es None. Saltando.")
            return True

        self.logger.info(f"[{self.symbol}] _update_open_position_pnl: Verificando posición abierta en Binance...")
        position_data = get_futures_position(self.symbol)

        if not position_data:
            self.logger.warning(f"[{self.symbol}] _update_open_position_pnl: No se pudo obtener información de posición de Binance.")
            # Si el bot pensaba que estaba en posición, se considera un cierre externo.
            # _handle_external_closure_or_discrepancy es llamado y se espera que registre algo si es posible.
            self._handle_external_closure_or_discrepancy(reason="pnl_update_no_pos_data_assumed_closed")
            return False

        pos_amt_str = position_data.get('positionAmt', '0')
        entry_price_str = position_data.get('entryPrice', '0')
        unrealized_pnl_str = position_data.get('unRealizedProfit', '0')

        try:
            pos_amt_binance = Decimal(pos_amt_str)
            entry_price_binance = Decimal(entry_price_str)
            unrealized_pnl_binance = Decimal(unrealized_pnl_str)
        except Exception as e:
            self.logger.error(f"[{self.symbol}] _update_open_position_pnl: Error al convertir datos de posición de Binance a Decimal: {e}. Datos: {position_data}")
            return True

        # El bot pensaba que estaba en posición (self.in_position == True)
        if abs(pos_amt_binance) < Decimal('1e-9'): # Posición cerrada en Binance
            self.logger.info(f"[{self.symbol}] _update_open_position_pnl: Posición para {self.symbol} CERRADA en Binance (Cantidad: {pos_amt_binance}). El bot la tenía como ABIERTA.")
            
            old_pos_data = self.current_position.copy() if self.current_position else {}
            old_entry_price = old_pos_data.get('entry_price')
            old_quantity = old_pos_data.get('quantity')
            old_entry_time = old_pos_data.get('entry_time')

            # --- LÓGICA DE CIERRE REESTRUCTURADA ---
            
            # 1. Determinar la razón de cierre. Priorizar la que ya tiene el bot.
            if self.current_exit_reason:
                close_reason = self.current_exit_reason
                self.logger.info(f"[{self.symbol}] Se usará la razón de cierre preexistente del bot: '{close_reason}'")
            else:
                close_reason = "Cierre Externo"
                self.logger.warning(f"[{self.symbol}] No se encontró una razón de cierre preexistente. Se asumirá como 'Cierre Externo'.")

            # 2. Intentar obtener los datos finales del último trade en Binance
            final_pnl = Decimal('0')
            final_close_price = old_entry_price or Decimal('0')
            final_close_timestamp = datetime.now()

            last_trade = get_last_account_trade(self.symbol, start_time=old_entry_time)

            if last_trade:
                self.logger.info(f"[{self.symbol}] Se encontró el último trade en el historial de Binance: {last_trade}")
                try:
                    trade_pnl = Decimal(last_trade.get('realizedPnl', '0'))
                    if trade_pnl != Decimal('0'):
                        final_pnl = trade_pnl
                        final_close_price = Decimal(last_trade.get('price', '0'))
                        final_close_timestamp = datetime.fromtimestamp(last_trade.get('time') / 1000)
                        self.logger.info(f"[{self.symbol}] Datos del trade extraídos -> PNL Final: {final_pnl}, Precio Cierre: {final_close_price}")
                        if close_reason == "Cierre Externo":
                            close_reason = f"Cierre Externo (PnL Detectado: {final_pnl:.4f})"
                    else:
                        self.logger.warning(f"[{self.symbol}] El PNL del último trade es 0. Se usará 0 como PNL final.")
                except Exception as e:
                    self.logger.error(f"[{self.symbol}] Error al procesar datos del último trade. Se usará PNL 0. Error: {e}")
                    if close_reason == "Cierre Externo":
                        close_reason = "Cierre Externo (Error procesando trade)"
            else:
                self.logger.warning(f"[{self.symbol}] No se encontró un trade de cierre en el historial de Binance. Se registrará con PNL 0.")
                if close_reason == "Cierre Externo":
                    close_reason = "Cierre Externo (Trade no encontrado)"
            
            # 3. Guardar en la base de datos
            save_trade_to_db(
                symbol=self.symbol,
                open_timestamp=old_entry_time,
                close_timestamp=final_close_timestamp,
                entry_reason=self.entry_reason,
                close_reason=close_reason,
                open_price=float(old_entry_price) if old_entry_price else 0.0,
                close_price=float(final_close_price),
                quantity=float(old_quantity) if old_quantity else 0.0,
                pnl_usdt=float(final_pnl),
                # Asegurarse de tener todos los parámetros necesarios
            )
            self.logger.info(f"[{self.symbol}] Trade CERRADO y guardado en DB. Razón: {close_reason}, PNL: {final_pnl:.4f}")
            
            # 4. Limpiar y actualizar estado
            self.historical_pnl += final_pnl
            self.session_pnl += final_pnl # <-- Acumular PNL de sesión aquí
            if self.margin_for_current_position > 0:
                self.risk_manager.remove_exposure(self.margin_for_current_position)
                self.logger.info(f"[{self.symbol}] Exposición de MARGEN {self.margin_for_current_position} USDT eliminada.")
            
            self._reset_state() # Esto resetea in_position, current_position, current_exit_reason, etc.
            self._update_state(BotState.IDLE)
            return False # Indicar que la posición se cerró

        elif pos_amt_binance > Decimal('1e-9'): # Posición LONG abierta
            # Actualizar el PNL y otros datos en memoria (lógica existente)
            self.current_position = {
                'entry_price': entry_price_binance,
                'quantity': pos_amt_binance,
                'entry_time': self.current_position.get('entry_time') if self.current_position and self.current_position.get('entry_price') == entry_price_binance else pd.Timestamp.now(tz='UTC'),
                'position_size_usdt': abs(entry_price_binance * pos_amt_binance),
                'positionAmt': pos_amt_binance
            }
            self.last_known_pnl = unrealized_pnl_binance
            self.last_known_entry_price = entry_price_binance
            self.last_known_position_size = pos_amt_binance
            self._update_state(BotState.IN_POSITION)
            return True

        elif pos_amt_binance < Decimal('-1e-9'): # Posición CORTA abierta
            self.logger.warning(f"[{self.symbol}] _update_open_position_pnl: Posición CORTA abierta en Binance: {pos_amt_binance}")
            # Si el bot pensaba que estaba en LONG, esto es una discrepancia
            self._handle_external_closure_or_discrepancy("pnl_update_unexpected_short")
            return False

        return True # Por defecto, si no se cerró, la posición sigue "abierta" para el bot.

    def _adjust_quantity(self, quantity: Decimal) -> float | None:
        """
        Ajusta la cantidad a la precisión y reglas (minQty, stepSize) requeridas por el símbolo.
        Devuelve None si la cantidad es demasiado pequeña para operar.
        """
        if self.min_qty is None or self.step_size is None:
            self.logger.error(f"[{self.symbol}] No se han definido min_qty o step_size. No se puede ajustar la cantidad.")
            return None

        # 1. Verificar si la cantidad es mayor que la mínima permitida
        if quantity < self.min_qty:
            self.logger.warning(f"[{self.symbol}] Cantidad calculada ({quantity:.8f}) es menor que la mínima permitida ({self.min_qty:.8f}). No se creará la orden.")
            return None

        # 2. Ajustar la cantidad al step_size (tamaño del paso)
        # La fórmula es: floor(quantity / stepSize) * stepSize
        # Usamos ROUND_DOWN que equivale a floor para números positivos.
        adjusted_qty = (quantity / self.step_size).quantize(Decimal('1'), rounding=ROUND_DOWN) * self.step_size
        
        # 3. Re-verificar que la cantidad ajustada no sea cero o menor que la mínima (caso borde)
        if adjusted_qty < self.min_qty:
            self.logger.warning(f"[{self.symbol}] Cantidad ajustada ({adjusted_qty:.8f}) es menor que la mínima permitida ({self.min_qty:.8f}). No se creará la orden.")
            return None

        self.logger.info(f"[{self.symbol}] Cantidad ajustada para la orden: {float(adjusted_qty):.8f} (Original: {float(quantity):.8f}, Min: {self.min_qty}, Step: {self.step_size})")
        return float(adjusted_qty)

    def _adjust_price(self, price: Decimal) -> Decimal:
        """Ajusta el precio al tick_size requerido por self.symbol (si se encontró)."""
        if self.price_tick_size is None or self.price_tick_size == Decimal('0'): # Comparar con Decimal('0')
            # Si no hay tick_size o es cero, devolver el precio original (que ya es Decimal)
            # No es necesario convertir a float y luego de vuelta a Decimal si ya es Decimal.
            # Solo aseguramos que sea Decimal.
            return price if isinstance(price, Decimal) else Decimal(str(price))
            
        # Asegurarse que price es Decimal para la operación //
        price_decimal = price if isinstance(price, Decimal) else Decimal(str(price))
        
        adjusted_price = (price_decimal // self.price_tick_size) * self.price_tick_size
        self.logger.debug(f"[{self.symbol}] Precio original: {price_decimal}, Tick Size: {self.price_tick_size}, Precio ajustado: {adjusted_price}")
        return adjusted_price # Devuelve Decimal directamente

    # --- Method to calculate Volume SMA --- ADDED
    def _calculate_volume_sma(self, klines: pd.DataFrame):
        """Calculates the Simple Moving Average (SMA) of the volume and returns relevant values."""
        if klines is None or klines.empty or 'volume' not in klines.columns:
            self.logger.warning(f"[{self.symbol}] Invalid klines DataFrame or missing 'volume' column for SMA calculation.")
            return None

        try:
            # Ensure volume is numeric, coercing errors to NaN
            klines['volume'] = pd.to_numeric(klines['volume'], errors='coerce')
            
            # Calculate Volume SMA using the period defined in parameters
            # min_periods=1 allows calculation even with fewer data points than the window at the start
            volume_sma = klines['volume'].rolling(window=self.volume_sma_period, min_periods=1).mean()

            if volume_sma.empty:
                 self.logger.warning(f"[{self.symbol}] Volume SMA calculation resulted in an empty Series.")
                 return None
                 
            # Get the latest volume and its corresponding SMA value
            # We compare the last volume bar with the SMA calculated up to that point
            current_volume = klines['volume'].iloc[-1]
            average_volume = volume_sma.iloc[-1] # Use the last calculated SMA

            # Check for NaN values resulting from coercion or calculation
            if pd.isna(current_volume) or pd.isna(average_volume):
                self.logger.warning(f"[{self.symbol}] Current volume ({current_volume}) or Volume SMA ({average_volume}) is NaN.")
                return None

            # Return the values needed for the entry condition check
            # The entry condition uses: current_volume > average_volume * volume_factor
            self.logger.debug(f"[{self.symbol}] Volume Check: Current={current_volume:.2f}, Avg({self.volume_sma_period})={average_volume:.2f}, Factor={self.volume_factor}")
            return current_volume, average_volume, self.volume_factor

        except Exception as e:
            self.logger.error(f"[{self.symbol}] Error calculating Volume SMA: {e}", exc_info=True)
            return None
    # --- End of added method ---

    def _is_recent_downtrend(self, klines_df: pd.DataFrame) -> bool:
        """Verifica si las 'N' velas cerradas más recientes muestran una tendencia bajista consecutiva."""
        n = self.downtrend_check_candles # Este 'N' es para el bloqueo por bajada
        
        if n < 2: 
            return False # Si el chequeo de bajada está desactivado, no bloquea

        if len(klines_df) < n + 1: 
            self.logger.warning(f"[{self.symbol}] No hay suficientes klines ({len(klines_df)}) para chequear tendencia bajista de {n} velas (para bloqueo). Se necesitan al menos {n+1}. Saltando chequeo de bloqueo.")
            return False # No se puede determinar, no bloquea por precaución

        closes = klines_df['close']
        
        for i in range(n - 1): 
            current_candle_close = closes.iloc[-(2 + i)]
            previous_candle_close = closes.iloc[-(3 + i)]

            if current_candle_close >= previous_candle_close:
                return False # No es una tendencia bajista consecutiva, no bloquea
        
        self.logger.info(f"[{self.symbol}] BLOQUEO DE ENTRADA: Condición de tendencia bajista reciente ({n} velas) DETECTADA. Entrada bloqueada.")
        return True # Es tendencia bajista, SÍ bloquea

    def _calculate_tp_sl_prices(self) -> tuple[Decimal | None, Decimal | None]:
        """
        Calcula los precios de Take Profit y Stop Loss basados en la configuración y el precio de entrada.
        Devuelve (tp_price, sl_price) como Decimales, o None si no aplican.
        """
        if not self.current_position or not self.in_position:
            self.logger.error(f"[{self.symbol}] No se puede calcular TP/SL sin una posición actual.")
            return None, None

        entry_price = self.current_position.get('entry_price')
        quantity = self.current_position.get('quantity')

        if not entry_price or not quantity or quantity == Decimal('0'):
            self.logger.error(f"[{self.symbol}] Precio de entrada o cantidad inválidos en current_position para calcular TP/SL.")
            return None, None

        tp_price = None
        if self.take_profit_usdt > Decimal('0'):
            # take_profit_usdt es el PNL deseado. Precio TP = Precio Entrada + (PNL Deseado / Cantidad)
            profit_per_unit = self.take_profit_usdt / quantity
            tp_price_calculated = entry_price + profit_per_unit
            tp_price = self._adjust_price(tp_price_calculated)
            self.logger.info(f"[{self.symbol}] Precio TP calculado: {tp_price_calculated:.8f} -> Ajustado: {tp_price:.8f} (Base: Entrada={entry_price}, TP_USDT={self.take_profit_usdt}, Cant={quantity})")

        sl_price = None
        if self.stop_loss_usdt < Decimal('0'): # stop_loss_usdt es un PNL negativo
            # stop_loss_usdt es la pérdida máxima. Precio SL = Precio Entrada + (Pérdida Máxima / Cantidad)
            loss_per_unit = self.stop_loss_usdt / quantity # Esto será negativo
            sl_price_calculated = entry_price + loss_per_unit
            sl_price = self._adjust_price(sl_price_calculated)
            self.logger.info(f"[{self.symbol}] Precio SL calculado: {sl_price_calculated:.8f} -> Ajustado: {sl_price:.8f} (Base: Entrada={entry_price}, SL_USDT={self.stop_loss_usdt}, Cant={quantity})")
            # Asegurarse que el SL no sea igual o mayor que el precio de entrada para un LONG
            if sl_price >= entry_price:
                self.logger.warning(f"[{self.symbol}] Precio SL calculado ({sl_price}) es >= precio de entrada ({entry_price}). SL no se colocará o será inefectivo. Revisar parámetros.")
                sl_price = None # No colocar SL si es inválido

        return tp_price, sl_price

    def _place_tp_sl_orders(self):
        """
        Coloca órdenes Take Profit y Stop Loss después de que una entrada se haya llenado.
        Usa TAKE_PROFIT_MARKET y STOP_MARKET.
        """
        if not self.in_position or not self.current_position:
            self.logger.warning(f"[{self.symbol}] Se intentó colocar TP/SL pero no se está en posición.")
            return

        quantity_to_close = self.current_position.get('quantity')
        if not quantity_to_close or quantity_to_close <= Decimal('0'):
            self.logger.error(f"[{self.symbol}] Cantidad inválida en la posición actual para colocar TP/SL: {quantity_to_close}")
            return

        # Convertir cantidad a float para la API de órdenes
        quantity_float = float(quantity_to_close)

        tp_price_dec, sl_price_dec = self._calculate_tp_sl_prices()

        # Colocar orden Take Profit
        if self.enable_take_profit_pnl and tp_price_dec and self.take_profit_usdt > Decimal('0'): # <-- MODIFICADO: Añadido self.enable_take_profit_pnl
            tp_price_str = f"{tp_price_dec:.{self.price_tick_size.as_tuple().exponent * -1}f}" # Formatear a la precisión correcta
            self.logger.info(f"[{self.symbol}] Intentando colocar orden TAKE_PROFIT_MARKET @ {tp_price_str} para cantidad {quantity_float} (Habilitado)")
            tp_order_result = create_futures_take_profit_order(
                symbol=self.symbol,
                side='SELL', # Para cerrar una posición LONG
                quantity=quantity_float,
                take_profit_price=tp_price_str,
                close_position=True
            )
            if tp_order_result and tp_order_result.get('orderId'):
                self.pending_tp_order_id = tp_order_result['orderId']
                self.logger.info(f"[{self.symbol}] Orden TAKE_PROFIT_MARKET {self.pending_tp_order_id} colocada @ {tp_price_str}.")
            else:
                self.logger.error(f"[{self.symbol}] Fallo al colocar la orden TAKE_PROFIT_MARKET @ {tp_price_str}. Respuesta: {tp_order_result}")
                # Considerar si se debe reintentar o entrar en estado de error
        elif not self.enable_take_profit_pnl:
            self.logger.info(f"[{self.symbol}] Colocación de orden Take Profit DESHABILITADA por configuración (enable_take_profit_pnl=False).")

        # Colocar orden Stop Loss
        if self.enable_stop_loss_pnl and sl_price_dec and self.stop_loss_usdt < Decimal('0'): # <-- MODIFICADO: Añadido self.enable_stop_loss_pnl
            sl_price_str = f"{sl_price_dec:.{self.price_tick_size.as_tuple().exponent * -1}f}"
            self.logger.info(f"[{self.symbol}] Intentando colocar orden STOP_MARKET @ {sl_price_str} para cantidad {quantity_float} (Habilitado)")
            sl_order_result = create_futures_stop_loss_order(
                symbol=self.symbol,
                side='SELL', # Para cerrar una posición LONG
                quantity=quantity_float,
                stop_loss_price=sl_price_str,
                close_position=True
            )
            if sl_order_result and sl_order_result.get('orderId'):
                self.pending_sl_order_id = sl_order_result['orderId']
                self.logger.info(f"[{self.symbol}] Orden STOP_MARKET {self.pending_sl_order_id} colocada @ {sl_price_str}.")
            else:
                self.logger.error(f"[{self.symbol}] Fallo al colocar la orden STOP_MARKET @ {sl_price_str}. Respuesta: {sl_order_result}")
                # Considerar si se debe reintentar o entrar en estado de error
        elif not self.enable_stop_loss_pnl:
            self.logger.info(f"[{self.symbol}] Colocación de orden Stop Loss DESHABILITADA por configuración (enable_stop_loss_pnl=False).")

    def _check_tp_sl_order_status(self):
        """
        Verifica el estado de las órdenes TP/SL pendientes.
        Si una se llena, registra el trade, cancela la otra y resetea el estado.
        Devuelve True si una orden TP/SL se llenó y manejó, False de lo contrario.
        """
        if not self.in_position: # No debería llamarse si no estamos en posición
                return False 
        
        order_filled_and_handled = False

        # Verificar Orden Take Profit
        if self.pending_tp_order_id:
            tp_status_response = get_order_status(self.symbol, self.pending_tp_order_id)
            if tp_status_response and tp_status_response.get('status') == 'FILLED':
                self.logger.info(f"[{self.symbol}] ¡TAKE PROFIT ORDEN {self.pending_tp_order_id} LLENADA! Detalles: {tp_status_response}")
                
                filled_price = Decimal(tp_status_response.get('avgPrice', '0'))
                filled_qty = Decimal(tp_status_response.get('executedQty', '0'))
                update_time_ms = tp_status_response.get('updateTime', time.time() * 1000)
                close_timestamp = pd.Timestamp.fromtimestamp(update_time_ms / 1000, tz='UTC')
                tp_order_id_filled = str(tp_status_response.get('orderId')) # <-- OBTENER ORDER ID DEL TP

                if filled_price > Decimal('0') and filled_qty > Decimal('0'):
                    self._handle_successful_closure(
                        close_price=filled_price,
                        quantity_closed=filled_qty,
                        reason=f"take_profit_order_filled ({self.pending_tp_order_id})",
                        close_timestamp=close_timestamp,
                        binance_order_id_of_closure=tp_order_id_filled # <-- PASAR ORDER ID
                    )
                else:
                    self.logger.error(f"[{self.symbol}] TP Orden {self.pending_tp_order_id} llena pero con datos inválidos. Realizando reseteo forzado.")
                    self._handle_external_closure_or_discrepancy(reason=f"tp_order_invalid_fill_data_{self.pending_tp_order_id}")

                # Intentar cancelar la orden SL hermana (Binance debería hacerlo si closePosition=True)
                if self.pending_sl_order_id:
                    self.logger.info(f"[{self.symbol}] Intentando cancelar orden SL hermana {self.pending_sl_order_id} después de llenado de TP.")
                    cancel_futures_order(self.symbol, self.pending_sl_order_id)
                    self.pending_sl_order_id = None # Limpiar ID
                
                self.pending_tp_order_id = None # Limpiar ID de TP
                self._reset_state() # Esto limpiará current_position, in_position y pondrá IDLE
                self._update_state(BotState.IDLE)
                order_filled_and_handled = True
            elif tp_status_response and tp_status_response.get('status') in ['CANCELED', 'REJECTED', 'EXPIRED', 'PENDING_CANCEL']:
                self.logger.warning(f"[{self.symbol}] Orden TP {self.pending_tp_order_id} encontrada como {tp_status_response.get('status')}. Limpiando ID.")
                self.pending_tp_order_id = None
                # No necesariamente reseteamos todo el estado del bot aquí, la posición podría seguir abierta si el SL aún está activo

        if order_filled_and_handled: # Si el TP se llenó, no necesitamos chequear SL
            return True # <--- INDENTAR ESTA LÍNEA

        # Verificar Orden Stop Loss
        if self.pending_sl_order_id:
            sl_status_response = get_order_status(self.symbol, self.pending_sl_order_id)
            if sl_status_response and sl_status_response.get('status') == 'FILLED':
                self.logger.info(f"[{self.symbol}] ¡STOP LOSS ORDEN {self.pending_sl_order_id} LLENADA! Detalles: {sl_status_response}")

                filled_price = Decimal(sl_status_response.get('avgPrice', '0'))
                filled_qty = Decimal(sl_status_response.get('executedQty', '0'))
                update_time_ms = sl_status_response.get('updateTime', time.time() * 1000)
                close_timestamp = pd.Timestamp.fromtimestamp(update_time_ms / 1000, tz='UTC')
                sl_order_id_filled = str(sl_status_response.get('orderId')) # <-- OBTENER ORDER ID DEL SL

                if filled_price > Decimal('0') and filled_qty > Decimal('0'):
                     self._handle_successful_closure(
                        close_price=filled_price,
                        quantity_closed=filled_qty,
                        reason=f"stop_loss_order_filled ({self.pending_sl_order_id})",
                        close_timestamp=close_timestamp,
                        binance_order_id_of_closure=sl_order_id_filled # <-- PASAR ORDER ID
                    )
                else:
                    self.logger.error(f"[{self.symbol}] SL Orden {self.pending_sl_order_id} llena pero con datos inválidos. Realizando reseteo forzado.")
                    self._handle_external_closure_or_discrepancy(reason=f"sl_order_invalid_fill_data_{self.pending_sl_order_id}")

                # Intentar cancelar la orden TP hermana
                if self.pending_tp_order_id:
                    self.logger.info(f"[{self.symbol}] Intentando cancelar orden TP hermana {self.pending_tp_order_id} después de llenado de SL.")
                    cancel_futures_order(self.symbol, self.pending_tp_order_id)
                    self.pending_tp_order_id = None
                
                self.pending_sl_order_id = None
                self._reset_state()
                self._update_state(BotState.IDLE)
                order_filled_and_handled = True
            elif sl_status_response and sl_status_response.get('status') in ['CANCELED', 'REJECTED', 'EXPIRED', 'PENDING_CANCEL']:
                self.logger.warning(f"[{self.symbol}] Orden SL {self.pending_sl_order_id} encontrada como {sl_status_response.get('status')}. Limpiando ID.")
                self.pending_sl_order_id = None

        return order_filled_and_handled

    def run_once(self):
        """
        Ejecuta un ciclo de la lógica del bot.
        """
        self.logger.info(f"[{self.symbol}] --- Inicio run_once. Estado: {self.state.value} ---")
        
        try:
            # 1. Obtener datos de mercado
            klines_df = self._get_market_data()
            if klines_df is None:
                return # Salir del ciclo si no hay datos

            # 2. Actualizar PNL si ya estamos en posición
            if self.in_position:
                self._update_open_position_pnl()

            # 3. Lógica de decisión principal
            
            # CASO A: Si estamos en posición, la única tarea es gestionar la salida.
            if self.in_position:
                self._check_pending_exit_order()
            
            # CASO B: Si hay una orden de entrada pendiente, la gestionamos.
            elif self.active_order_id and self.active_order_type == 'ENTRY':
                self._check_pending_entry_order()

            # CASO C: Si no hay posición ni orden, buscamos una nueva entrada.
            else:
                if self.evaluate_support_strategy:
                    # Usar estrategia de soportes si está activada
                    self._execute_support_strategy(klines_df)
                else:
                    # Usar estrategia principal de RSI
                    self._evaluate_entry_conditions(klines_df)

        except Exception as e:
            self.logger.error(f"[{self.symbol}] Excepción no controlada en run_once: {e}", exc_info=True)
            self._set_error_state(f"Unhandled exception in run_once: {e}")

    def _get_market_data(self):
        """Función auxiliar para obtener y validar los datos de klines."""
        if self.state in [BotState.ERROR, BotState.WAITING_ENTRY_FILL, BotState.WAITING_EXIT_FILL]:
            self.logger.debug(f"[{self.symbol}] Saltando obtención de datos en estado {self.state.value}")
            return None

        self.state = BotState.FETCHING_DATA
        
        limit_needed = self.rsi_period + 1
        if self.evaluate_ma_filter:
            limit_needed = max(limit_needed, self.ma_period)
        if self.evaluate_support_strategy:
            limit_needed = max(limit_needed, self.support_history_candles)
        
        final_limit = limit_needed + 10
        self.logger.debug(f"[{self.symbol}] Límite de velas calculado: {final_limit}")
        
        klines_df = get_historical_klines(self.symbol, self.rsi_interval, limit=final_limit)

        if klines_df is None or klines_df.empty:
            self.logger.warning(f"[{self.symbol}] No se pudieron obtener klines. Saltando ciclo.")
            self.state = BotState.IDLE
            return None
        
        return klines_df

    def _execute_support_strategy(self, klines_df):
        """
        Contiene toda la lógica para la estrategia de trading basada en soportes.
        """
        self.logger.info(f"[{self.symbol}] Ejecutando estrategia de soportes.")
        
        try:
            current_market_price = klines_df['close'].iloc[-1]
            
            # 1. Limpiar órdenes en soportes que ya no son válidos (precio por encima del mercado)
            for price_level in list(self.active_support_orders.keys()):
                if price_level >= current_market_price:
                    order_id = self.active_support_orders.pop(price_level)
                    self.logger.info(f"[{self.symbol}] Cancelando orden {order_id} en soporte ahora inválido de {price_level}.")
                    cancel_futures_order(self.symbol, order_id)

            # 2. Obtener y confirmar nuevos niveles de soporte
            confirmed_supports = self._find_support_levels(klines_df)

            # 3. Decidir sobre la acción a tomar
            if confirmed_supports:
                best_support = max(confirmed_supports)
                
                # 3a. Cancelar órdenes activas que no estén en el mejor soporte
                for price_level in list(self.active_support_orders.keys()):
                    if price_level != best_support:
                        order_id = self.active_support_orders.pop(price_level)
                        self.logger.info(f"[{self.symbol}] Cancelando orden {order_id} en {price_level} porque no es el mejor soporte ({best_support}).")
                        cancel_futures_order(self.symbol, order_id)

                # 3b. Si no hay una orden ya en el mejor soporte, intentar colocar una
                if best_support not in self.active_support_orders:
                    if self.risk_manager.can_open_position(Decimal(str(self.position_size_usdt))):
                        quantity = self.position_size_usdt / best_support
                        adj_qty = self._adjust_quantity(quantity)
                        if adj_qty and adj_qty > 0:
                            result = create_futures_limit_order(self.symbol, 'BUY', adj_qty, best_support)
                            if result and 'orderId' in result:
                                self.active_support_orders[best_support] = result['orderId']
                                self.logger.info(f"[{self.symbol}] Nueva orden de soporte colocada en {best_support} con ID {result['orderId']}.")
                            else:
                                self.logger.error(f"[{self.symbol}] Fallo al colocar orden en soporte {best_support}.")
                        else:
                            self.logger.warning(f"[{self.symbol}] Cantidad ajustada inválida para soporte {best_support}.")
                    else:
                        self.logger.warning(f"[{self.symbol}] RiskManager denegó apertura de posición en soporte {best_support}.")

            # 4. Si no hay ningún soporte confirmado, limpiar todas las órdenes de soporte activas
            else:
                if self.active_support_orders:
                    self.logger.info(f"[{self.symbol}] No hay soportes confirmados. Limpiando {len(self.active_support_orders)} órdenes activas.")
                    for price, order_id in list(self.active_support_orders.items()):
                        cancel_futures_order(self.symbol, order_id)
                    self.active_support_orders.clear()

        except Exception as e:
            self.logger.error(f"[{self.symbol}] Error en _execute_support_strategy: {e}", exc_info=True)
            self._set_error_state(f"Error in support strategy: {e}")

    def _handle_successful_closure(self, close_price, quantity_closed, reason, close_timestamp=None, binance_order_id_of_closure: str | None = None):
        """
        Registra el trade completado en la DB y resetea el estado interno del bot para este símbolo.
        Intenta obtener PNL realizado de Binance; si falla, lo calcula manualmente.
        """
        if not self.current_position:
            self.logger.error(f"[{self.symbol}] Se intentó registrar cierre, pero no había datos de posición interna guardada.")
            self._reset_state()
            return

        entry_price = self.current_position.get('entry_price', Decimal('0'))
        entry_time = self.current_position.get('entry_time')
        quantity_dec = Decimal(str(quantity_closed))
        close_price_dec = Decimal(str(close_price))
        position_size_usdt_est = abs(entry_price * quantity_dec)
        
        final_pnl = None
        actual_binance_trade_id_for_db = None # Este será el tradeId de Binance, no el orderId

        # Intentar obtener PNL de Binance
        if binance_order_id_of_closure: # Si tenemos el orderId del cierre
            self.logger.info(f"[{self.symbol}] Buscando detalles del trade de cierre en Binance para orderId: {binance_order_id_of_closure}...")
            # Necesitamos buscar en userTrades un trade que tenga este orderId
            # y que sea un 'SELL' (para cerrar nuestro LONG) y que coincida aproximadamente en tiempo y cantidad
            try:
                # Buscar hasta 5 trades recientes, usualmente el nuestro estará entre los primeros.
                # Aumentar límite si es necesario, pero ser cauteloso con los límites de API.
                user_trades = get_user_trade_history(symbol=self.symbol, limit=10) 
                
                found_closing_trade_in_history = False
                if user_trades:
                    for trade_detail in user_trades:
                        trade_order_id = str(trade_detail.get('orderId'))
                        trade_id_from_api = trade_detail.get('id') # Este es el binance_trade_id
                        trade_qty_api = Decimal(trade_detail.get('qty', '0'))
                        trade_side_api = trade_detail.get('side', '').upper()

                        # Comparar orderId, lado y cantidad (con una pequeña tolerancia)
                        if trade_order_id == binance_order_id_of_closure and \
                           trade_side_api == 'SELL' and \
                           abs(trade_qty_api - quantity_dec) < (quantity_dec * Decimal('0.01')): # Tolerancia del 1% en cantidad

                            pnl_from_api_str = trade_detail.get('realizedPnl')
                            if pnl_from_api_str is not None:
                                final_pnl = Decimal(pnl_from_api_str)
                                actual_binance_trade_id_for_db = int(trade_id_from_api)
                                self.logger.info(f"[{self.symbol}] PNL de Binance OBTENIDO para orderId {binance_order_id_of_closure} (TradeID: {actual_binance_trade_id_for_db}): {final_pnl:.4f} USDT")
                                
                                # Actualizar close_price y close_timestamp con los datos del trade de Binance si son más precisos
                                api_close_price_str = trade_detail.get('price')
                                api_time_ms = trade_detail.get('time')
                                if api_close_price_str:
                                    close_price_dec = Decimal(api_close_price_str)
                                if api_time_ms and close_timestamp is None: # Solo actualizar si no teníamos uno más específico
                                    close_timestamp = pd.Timestamp.fromtimestamp(int(api_time_ms) / 1000, tz='UTC')
                                    self.logger.info(f"[{self.symbol}] Precio/tiempo de cierre actualizados desde trade de Binance: Precio={close_price_dec}, Tiempo={close_timestamp}")
                                found_closing_trade_in_history = True
                                break # Encontramos el trade
                    if not found_closing_trade_in_history:
                         self.logger.warning(f"[{self.symbol}] No se encontró un trade SELL coincidente en el historial reciente de Binance para orderId {binance_order_id_of_closure}. Se usará PNL calculado.")
                else:
                    self.logger.warning(f"[{self.symbol}] No se pudo obtener el historial de trades de Binance para buscar PNL para orderId {binance_order_id_of_closure}. Se usará PNL calculado.")
            except Exception as e_api_pnl:
                self.logger.error(f"[{self.symbol}] Error intentando obtener PNL de Binance para orderId {binance_order_id_of_closure}: {e_api_pnl}. Se usará PNL calculado.", exc_info=True)
        else:
            self.logger.info(f"[{self.symbol}] No se proporcionó binance_order_id_of_closure. Se intentará cálculo manual de PNL o búsqueda genérica si es un cierre externo.")
            # En un futuro, aquí podría ir la lógica de búsqueda genérica si no hay orderId (más complejo)

        # Fallback a cálculo manual si no se obtuvo PNL de Binance
        if final_pnl is None:
            final_pnl = (close_price_dec - entry_price) * quantity_dec
            self.logger.info(f"[{self.symbol}] PNL CALCULADO MANUALMENTE: {final_pnl:.4f} (Close: {close_price_dec}, Entry: {entry_price}, Qty: {quantity_dec})")
        else:
            self.logger.info(f"[{self.symbol}] PNL FINAL (usando valor de Binance si se obtuvo): {final_pnl:.4f}")

        simplified_reason = reason
        if pd.isna(entry_time):
             entry_time = pd.Timestamp.now(tz='UTC') - pd.Timedelta(minutes=1)
             self.logger.warning(f"[{self.symbol}] Timestamp de entrada no era válido, usando valor estimado.")
             
        actual_close_timestamp = close_timestamp if close_timestamp else pd.Timestamp.now(tz='UTC')

        open_ts_for_db = entry_time.to_pydatetime() if pd.notna(entry_time) else None
        close_ts_for_db = actual_close_timestamp.to_pydatetime() if pd.notna(actual_close_timestamp) else None

        try:
            db_trade_params = {
                'rsi_interval': self.rsi_interval,
                'rsi_period': self.rsi_period,
                'rsi_threshold_up': self.rsi_threshold_up,
                'rsi_threshold_down': self.rsi_threshold_down,
                'rsi_entry_level_low': self.rsi_entry_level_low,
                'rsi_entry_level_high': self.rsi_entry_level_high,
                'position_size_usdt': float(self.position_size_usdt),
                'take_profit_usdt': float(self.take_profit_usdt),
                'stop_loss_usdt': float(self.stop_loss_usdt),
                'downtrend_check_candles': self.downtrend_check_candles,
                'order_timeout_seconds': self.order_timeout_seconds,
                'rsi_target': self.rsi_target,
                'enable_price_trailing_stop': self.enable_price_trailing_stop,
                'price_trailing_stop_distance_usdt': float(self.price_trailing_stop_distance_usdt),
                'price_trailing_stop_activation_pnl_usdt': float(self.price_trailing_stop_activation_pnl_usdt),
                'enable_pnl_trailing_stop': self.enable_pnl_trailing_stop,
                'pnl_trailing_stop_activation_usdt': float(self.pnl_trailing_stop_activation_usdt),
                'pnl_trailing_stop_drop_usdt': float(self.pnl_trailing_stop_drop_usdt)
            }

            self.logger.info(f"[{self.symbol}] _handle_successful_closure: Intentando registrar con los siguientes datos -> "
                             f"Symbol: {self.symbol}, Type: LONG, OpenTS: {open_ts_for_db}, CloseTS: {close_ts_for_db}, "
                             f"OpenPrice: {float(entry_price)}, ClosePrice: {float(close_price_dec)}, Qty: {float(quantity_dec)}, "
                             f"PosSizeUSDT: {float(position_size_usdt_est)}, PNL: {float(final_pnl)}, Reason: '{simplified_reason}', "
                             f"Params: {db_trade_params}, BinanceTradeID: {actual_binance_trade_id_for_db}")

            record_trade(
                symbol=self.symbol,
                trade_type='LONG',
                open_timestamp=open_ts_for_db,
                close_timestamp=close_ts_for_db,
                open_price=float(entry_price),
                close_price=float(close_price_dec),
                quantity=float(quantity_dec),
                position_size_usdt=float(position_size_usdt_est),
                pnl_usdt=float(final_pnl),
                close_reason=simplified_reason,
                parameters=db_trade_params,
                binance_trade_id=actual_binance_trade_id_for_db # <-- Usar el ID del trade de cierre
            )
            self.logger.info(f"[{self.symbol}] _handle_successful_closure: Trade registrado exitosamente en DB.")
        except Exception as e:
            self.logger.error(f"[{self.symbol}] ERROR CRÍTICO en _handle_successful_closure al registrar el trade en la DB: {e}", exc_info=True)
            self.logger.error(f"[{self.symbol}] Datos que se intentaron registrar: Symbol: {self.symbol}, Type: LONG, OpenTS: {open_ts_for_db}, CloseTS: {close_ts_for_db}, "
                             f"OpenPrice: {float(entry_price)}, ClosePrice: {float(close_price_dec)}, Qty: {float(quantity_dec)}, "
                             f"PosSizeUSDT: {float(position_size_usdt_est)}, PNL: {float(final_pnl)}, Reason: '{simplified_reason}', "
                             f"Params: {db_trade_params}, BinanceTradeID: {actual_binance_trade_id_for_db}")

        self._reset_state()

    def _reset_state(self):
        """Resetea el estado relacionado con órdenes pendientes y posición."""
        self.logger.debug(f"[{self.symbol}] Reseteando estado de orden pendiente/posición.")
        self.in_position = False
        self.current_position = None
        # --- Resetear también estado de órdenes pendientes ---
        self.pending_entry_order_id = None
        self.pending_exit_order_id = None
        self.pending_order_timestamp = None
        self.current_exit_reason = None # <-- Asegurar que se resetea aquí también
        self.rsi_at_entry = None # <-- NUEVO: Resetear RSI de entrada
        self.last_known_pnl = None # <-- ASEGURAR QUE EL PNL SE RESETEA
        self.previous_rsi_value = None # <-- NUEVO: Resetear el RSI anterior
        # --- NUEVO: Cancelar y limpiar órdenes TP/SL pendientes ---
        if self.pending_tp_order_id:
            self.logger.info(f"[{self.symbol}] ResetState: Intentando cancelar orden TP pendiente {self.pending_tp_order_id}.")
            cancel_futures_order(self.symbol, self.pending_tp_order_id)
            self.pending_tp_order_id = None
        if self.pending_sl_order_id:
            self.logger.info(f"[{self.symbol}] ResetState: Intentando cancelar orden SL pendiente {self.pending_sl_order_id}.")
            cancel_futures_order(self.symbol, self.pending_sl_order_id)
            self.pending_sl_order_id = None
        # ---------------------------------------------------
        # self.last_rsi_value = None # Podríamos mantenerlo o resetearlo
        self.rsi_objetivo_activado = False
        self.rsi_objetivo_alcanzado_en = None
        self.rsi_peak_since_target = None # Limpiar el pico de RSI para el trailing stop

        # --- Limpiar también estado de trailing de precio ---
        self.price_peak_since_entry = None
        self.price_trailing_stop_armed = False
        # --- Limpiar también estado de trailing de PNL ---
        self.pnl_peak_since_activation = None
        self.pnl_trailing_stop_armed = False
        # --- NUEVO: Limpiar estado de Open Interest ---
        # self.previous_open_interest_usdt = None # <-- YA NO SE NECESITA
        # ----------------------------------------------------

        # Limpiar el PnL conocido (aunque se recalculará si se entra en nueva posición)

    # --- Métodos para actualizar estado ---
    # (Estos se llamarán desde run_once)
    def _update_state(self, new_state: BotState, error_message: str | None = None):
        if self.current_state != new_state:
             self.logger.debug(f"[{self.symbol}] State changed from {self.current_state.value} to {new_state.value}")
             self.current_state = new_state
        if new_state == BotState.ERROR and error_message:
             self.last_error_message = error_message
             self.logger.error(f"[{self.symbol}] Error detail: {error_message}")
        elif new_state != BotState.ERROR:
             self.last_error_message = None # Limpiar mensaje de error si salimos del estado ERROR

    def get_current_status(self):
        """Devuelve un diccionario con el estado actual del bot para la API."""
        return {
             'symbol': self.symbol,
            'state': self.state.value if self.state else "UNKNOWN",
            'is_running': self.is_running,
             'in_position': self.in_position,
            'current_pnl': self.last_known_pnl,
            'hist_pnl': self.historical_pnl, # Usar la nueva variable
            'entry_price': self.last_known_entry_price,
            'position_size': self.last_known_position_size,
             'pending_entry_order_id': self.pending_entry_order_id,
            'pending_exit_order_id': self.pending_exit_order_id,
            'pending_tp_order_id': self.pending_tp_order_id,
            'pending_sl_order_id': self.pending_sl_order_id,
            'last_error': self.last_error_message,
            'entry_reason': self.entry_reason,
            'exit_reason': self.exit_reason,
        }

    def _set_error_state(self, message: str):
        """Establece el estado del bot a ERROR y guarda el mensaje."""
        self.current_state = BotState.ERROR
        self.last_error_message = message
        self.logger.error(f"[{self.symbol}] Entering ERROR state: {message}")

    def _get_best_entry_price(self, side: str) -> Decimal | None:
        """
        Obtiene el mejor precio disponible del order book para una orden de ENTRADA.
        Para entrar en un LONG (BUY), usamos el mejor Ask.
        Para entrar en un SHORT (SELL), usamos el mejor Bid (si se implementara).
        """
        ticker = get_order_book_ticker(self.symbol)
        if not ticker:
            self.logger.error(f"[{self.symbol}] No se pudo obtener el order book ticker para el precio de entrada.")
            return None

        price_str = None
        price_type = ""
        if side == 'BUY': # Abriendo un LONG
            price_str = ticker.get('askPrice')
            price_type = "Ask"
        elif side == 'SELL': # Abriendo un SHORT (no implementado actualmente para entrada)
            self.logger.error(f"[{self.symbol}] Lado de orden de entrada 'SELL' (SHORT) no implementado en _get_best_entry_price.")
            return None 
        else:
            self.logger.error(f"[{self.symbol}] Lado de orden desconocido '{side}' en _get_best_entry_price.")
            return None

        if price_str:
            price = Decimal(price_str)
            self.logger.info(f"[{self.symbol}] Mejor precio {price_type} obtenido para entrada ({side}): {price}")
            return price
        else:
            self.logger.error(f"[{self.symbol}] No se pudo obtener el precio {price_type} del ticker para entrada: {ticker}")
            return None

    # --- Nuevo método para obtener el mejor precio de salida ---
    def _get_best_exit_price(self, side: str) -> Decimal | None:
        """
        Obtiene el mejor precio disponible del order book para una orden de SALIDA.
        Para salir de un LONG (SELL), usamos el mejor Bid.
        Para salir de un SHORT (BUY), usamos el mejor Ask.
        """
        ticker = get_order_book_ticker(self.symbol)
        if not ticker:
            self.logger.error(f"[{self.symbol}] No se pudo obtener el order book ticker para el precio de salida.")
            return None

        price_str = None
        if side == 'SELL': # Cerrando un LONG
            price_str = ticker.get('bidPrice')
            price_type = "Bid"
        elif side == 'BUY': # Cerrando un SHORT (cuando se implemente)
            price_str = ticker.get('askPrice')
            price_type = "Ask"
        else:
            self.logger.error(f"[{self.symbol}] Lado de orden desconocido '{side}' en _get_best_exit_price.")
            return None

        if price_str:
            price = Decimal(price_str)
            self.logger.info(f"[{self.symbol}] Mejor precio {price_type} obtenido para salida ({side}): {price}")
            return price
        else:
            self.logger.error(f"[{self.symbol}] No se pudo obtener el precio {price_type} del ticker: {ticker}")
            return None
    # --- Fin del nuevo método ---

    # --- Nuevo método para colocar una orden de salida ---
    def _place_exit_order(self, price: Decimal, reason: str):
        """
        Coloca una orden LIMIT SELL para cerrar la posición actual.
        Args:
            price (Decimal): El precio al cual intentar vender.
            reason (str): La razón para el cierre (e.g., 'take_profit', 'stop_loss').
        """
        if not self.in_position or not self.current_position:
            self.logger.error(f"[{self.symbol}] Se intentó colocar orden de salida, pero no se está en posición.")
            return

        self.logger.warning(f"[{self.symbol}] Intentando colocar orden LIMIT SELL para cerrar posición (Razón: {reason})...")
        self._update_state(BotState.PLACING_EXIT)

        # Usar el precio proporcionado (ya debería ser el mejor bid o ask según el caso)
        limit_sell_price_adjusted = self._adjust_price(price)
        quantity_to_sell = self._adjust_quantity(self.current_position['quantity'])
        
        # CORRECCIÓN: Verificar si la cantidad es válida
        if quantity_to_sell is None or quantity_to_sell <= 0:
            self.logger.error(f"[{self.symbol}] Error crítico: la cantidad para cerrar la posición es inválida ({quantity_to_sell}). No se puede crear orden de salida.")
            self._set_error_state("Invalid quantity for exit order.")
            return
        
        # Calcular la precisión del precio para el log de forma segura
        price_precision_log = self.price_tick_size.as_tuple().exponent * -1 if self.price_tick_size and self.price_tick_size.is_finite() and self.price_tick_size > Decimal('0') else 2
        self.logger.info(f"[{self.symbol}] Calculado para salida: Precio LIMIT SELL={limit_sell_price_adjusted:.{price_precision_log}f}, Cantidad={quantity_to_sell}")

        order_result = create_futures_limit_order(self.symbol, 'SELL', quantity_to_sell, limit_sell_price_adjusted)

        if order_result and order_result.get('orderId'):
            self.pending_exit_order_id = order_result['orderId']
            self.pending_order_timestamp = time.time()
            # Guardar la razón de la salida para usarla al registrar en DB si se llena
            self.current_exit_reason = reason 
            self.logger.warning(f"[{self.symbol}] Orden LIMIT SELL {self.pending_exit_order_id} colocada @ {limit_sell_price_adjusted:.{price_precision_log}f}. Esperando ejecución...")
            self._update_state(BotState.WAITING_EXIT_FILL)
        else:
            self.logger.error(f"[{self.symbol}] Fallo al colocar la orden LIMIT SELL para cerrar posición (Razón: {reason}).")
            self._set_error_state(f"Failed to place exit order (reason: {reason}).")
    # --- Fin del nuevo método ---

    def _check_entry_conditions(self, klines_df: pd.DataFrame):
        """
        Verifica si se cumplen las condiciones para entrar en una posición LONG.
        Condición combinada: RSI en rango [low, high] Y RSI >= threshold_up.
        """
        if not self.in_position and not self.pending_entry_order_id: # Asegurar que no hay orden de entrada PENDIENTE
            self._update_state(BotState.CHECKING_CONDITIONS)
            current_price = Decimal(klines_df.iloc[-1]['close'])

            # --- LOGS DE DEPURACIÓN ADICIONALES ---
            self.logger.info(f"[{self.symbol}] Pasando a calculate_rsi - klines_df['close'] (primeros 5): {klines_df['close'].head().to_list() if not klines_df.empty else 'DataFrame vacío'}")
            self.logger.info(f"[{self.symbol}] Pasando a calculate_rsi - klines_df['close'] (últimos 5): {klines_df['close'].tail().to_list() if not klines_df.empty else 'DataFrame vacío'}")
            self.logger.info(f"[{self.symbol}] Pasando a calculate_rsi - klines_df['close'] contiene NaNs?: {klines_df['close'].isnull().any()}")
            self.logger.info(f"[{self.symbol}] Pasando a calculate_rsi - klines_df['close'] dtype: {klines_df['close'].dtype}")
            # --- FIN LOGS DE DEPURACIÓN ---

            rsi_values = calculate_rsi(klines_df['close'], period=self.rsi_period)
            
            self.logger.info(f"[{self.symbol}] Resultado de calculate_rsi: {'None o vacío' if rsi_values is None or rsi_values.empty else 'Serie OK, último valor: ' + str(rsi_values.iloc[-1])}") 

            if rsi_values is None or rsi_values.empty:
                self.logger.warning(f"[{self.symbol}] No se pudieron calcular los valores RSI.")
                # Asegurar que previous_rsi_value no se quede desactualizado si el cálculo actual falla
                # y antes sí teníamos un valor. No lo ponemos a None aquí directamente,
                # sino que no lo actualizamos con un valor inválido.
                self._update_state(BotState.IDLE) 
                return

            # self.last_rsi_value se actualiza aquí
            self.last_rsi_value = rsi_values.iloc[-1]
            # Calcular la precisión del precio para el log de forma segura
            price_precision_log = self.price_tick_size.as_tuple().exponent * -1 if self.price_tick_size and self.price_tick_size.is_finite() and self.price_tick_size > Decimal('0') else 2
            self.logger.info(f"[{self.symbol}] Precio actual: {current_price:.{price_precision_log}f}, RSI({self.rsi_period}, {self.rsi_interval}): {self.last_rsi_value:.2f}")

            # --- NUEVA LÓGICA PARA EL DELTA DEL RSI ---
            rsi_delta = None
            if self.previous_rsi_value is not None and self.last_rsi_value is not None:
                # Asegurarse que ambos son números antes de restar
                if isinstance(self.previous_rsi_value, (int, float)) and isinstance(self.last_rsi_value, (int, float)):
                    rsi_delta = self.last_rsi_value - self.previous_rsi_value
                    self.logger.info(f"[{self.symbol}] Chequeo Delta RSI: Actual={self.last_rsi_value:.2f}, Anterior={self.previous_rsi_value:.2f}, Delta={rsi_delta:.2f}")
                else:
                    self.logger.warning(f"[{self.symbol}] Chequeo Delta RSI: RSI actual o anterior no son numéricos (Actual: {self.last_rsi_value}, Anterior: {self.previous_rsi_value}).")
            else:
                self.logger.info(f"[{self.symbol}] Chequeo Delta RSI: No hay RSI anterior o actual para calcular delta (Actual={self.last_rsi_value}, Anterior={self.previous_rsi_value})")
            # --- FIN NUEVA LÓGICA DELTA RSI ---

            # --- Lógica de Volumen --- MODIFICADA
            volume_check_passed = False # Por defecto, no pasa
            if not self.evaluate_volume_filter: # Si la evaluación del filtro de volumen está DESACTIVADA
                volume_check_passed = True # Considerar esta condición como cumplida por defecto
                self.logger.info(f"[{self.symbol}] Filtro de Volumen: Evaluación DESACTIVADA (evaluate_volume_filter=False). Condición de volumen cumplida por defecto.")
            elif self.volume_sma_period > 0 and self.volume_factor > 0: # Si está ACTIVADA y los parámetros son válidos
                volume_data = self._calculate_volume_sma(klines_df)
                if volume_data:
                    current_volume, average_volume, factor = volume_data
                    if current_volume > (average_volume * factor):
                        volume_check_passed = True
                        self.logger.info(f"[{self.symbol}] CONDICIÓN DE VOLUMEN CUMPLIDA (Evaluación Activada): Actual={current_volume:.2f} > Promedio({self.volume_sma_period})={average_volume:.2f} * Factor={factor}")
                    else:
                        self.logger.info(f"[{self.symbol}] CONDICIÓN DE VOLUMEN NO CUMPLIDA (Evaluación Activada): Actual={current_volume:.2f} <= Promedio({self.volume_sma_period})={average_volume:.2f} * Factor={factor}")
                else:
                    self.logger.warning(f"[{self.symbol}] No se pudieron obtener datos de volumen SMA (Evaluación Activada). Condición de volumen NO cumplida.")
                    # volume_check_passed permanece False
            else: # Si está ACTIVADA pero los params (period/factor) no son positivos
                 self.logger.info(f"[{self.symbol}] Filtro de Volumen (Evaluación Activada): Chequeo desactivado por parámetros (SMA Period o Factor no positivos). Condición de volumen cumplida por defecto en este caso.")
                 volume_check_passed = True 
            # --- Fin Lógica de Volumen ---

            # --- Lógica de Entrada MODIFICADA ---
            entry_signal = False
            self.entry_reason = ""

            # Condición 0: RSI en el rango de entrada configurado (MODIFICADO)
            condition_rsi_in_range = False
            if not self.evaluate_rsi_range: # Si la evaluación de rango RSI está DESACTIVADA
                condition_rsi_in_range = True
                self.logger.info(f"[{self.symbol}] Chequeo RSI en Rango: Evaluación DESACTIVADA (evaluate_rsi_range=False). Condición cumplida por defecto.")
            elif self.last_rsi_value is not None and self.rsi_entry_level_low <= self.last_rsi_value <= self.rsi_entry_level_high:
                condition_rsi_in_range = True
                # MODIFICADO: Formateo del RSI para el log
                rsi_value_str = f"{self.last_rsi_value:.2f}" if self.last_rsi_value is not None else "N/A"
                self.logger.info(f"[{self.symbol}] Chequeo RSI en Rango (Activado) [{self.rsi_entry_level_low}, {self.rsi_entry_level_high}]? Sí (RSI={rsi_value_str})")
            else:
                condition_rsi_in_range = False
                # MODIFICADO: Formateo del RSI para el log
                rsi_value_str = f"{self.last_rsi_value:.2f}" if self.last_rsi_value is not None else "N/A"
                self.logger.info(f"[{self.symbol}] Chequeo RSI en Rango (Activado) [{self.rsi_entry_level_low}, {self.rsi_entry_level_high}]? No (RSI={rsi_value_str})")

            # --- Definir condition_rsi_change_meets_thresh_up y rsi_delta_str ---
            condition_rsi_change_meets_thresh_up = False
            rsi_delta_str = "N/A" # Valor por defecto para el log

            if rsi_delta is not None: # rsi_delta se calculó antes
                rsi_delta_str = f"{rsi_delta:.2f}" # Formatear para el log
                if not self.evaluate_rsi_delta: # Si la evaluación de delta RSI está DESACTIVADA
                    condition_rsi_change_meets_thresh_up = True # Considerar esta condición como cumplida
                    self.logger.info(f"[{self.symbol}] Chequeo Delta RSI: Evaluación DESACTIVADA (evaluate_rsi_delta=False). Condición de delta cumplida por defecto. (Delta real: {rsi_delta_str})")
                elif rsi_delta >= self.rsi_threshold_up: # Si está ACTIVADA, evaluar normalmente
                    condition_rsi_change_meets_thresh_up = True
            else: # rsi_delta es None
                if not self.evaluate_rsi_delta: # Si la evaluación está DESACTIVADA
                    condition_rsi_change_meets_thresh_up = True
                    self.logger.info(f"[{self.symbol}] Chequeo Delta RSI: Evaluación DESACTIVADA (evaluate_rsi_delta=False). Condición de delta cumplida por defecto. (Delta real: {rsi_delta_str})")
                # Si rsi_delta es None y la evaluación está activada, condition_rsi_change_meets_thresh_up permanece False.
            
            if self.evaluate_rsi_delta: # Log de la condición de delta solo si la evaluación está activa
                self.logger.info(f"[{self.symbol}] Chequeo Delta RSI (Activado) >= {self.rsi_threshold_up}? {'Sí' if condition_rsi_change_meets_thresh_up else 'No'} (Delta={rsi_delta_str})")
            # --------------------------------------------------------------------

            # Condición 1: Cambio (Delta) en RSI cumple el umbral positivo (Lógica ya modificada previamente)
            # condition_rsi_change_meets_thresh_up se calcula antes y usa self.evaluate_rsi_delta

            # Condición 2: Filtro de Volumen (Lógica ya modificada previamente)
            # volume_check_passed se calcula antes y usa self.evaluate_volume_filter
            
            # Condición 3: Requisito de tendencia alcista reciente (MODIFICADO)
            condition_required_uptrend_met = False
            if not self.evaluate_required_uptrend: # Si la evaluación está DESACTIVADA
                condition_required_uptrend_met = True
                self.logger.info(f"[{self.symbol}] Chequeo Requisito Velas Alcistas: Evaluación DESACTIVADA (evaluate_required_uptrend=False). Condición cumplida por defecto.")
            else: # Si está ACTIVADA, evaluar normalmente
                condition_required_uptrend_met = self._check_required_uptrend(klines_df)

            if self.evaluate_required_uptrend: # Log solo si la evaluación está activa
                self.logger.info(f"[{self.symbol}] Chequeo Entrada (Activado): Requisito Velas Alcistas ({self.required_uptrend_candles} velas)? {'Sí' if condition_required_uptrend_met else 'No'}")

            # --- NUEVO: Lógica de Open Interest ---
            condition_oi_increase_met = False # Por defecto, no pasa
            current_oi_value_for_log = "N/A"
            previous_oi_value_for_log = "N/A"
            open_interest_delta_str = "N/A"

            if not self.evaluate_open_interest_increase: # Si la evaluación de OI está DESACTIVADA
                condition_oi_increase_met = True
                self.logger.info(f"[{self.symbol}] Chequeo Open Interest: Evaluación DESACTIVADA (evaluate_open_interest_increase=False). Condición OI cumplida por defecto.")
            else:
                # Usar la nueva función para obtener los 2 últimos puntos de OI
                # La función get_open_interest_history ya está importada desde .binance_client
                oi_history = get_open_interest_history(symbol=self.symbol, period=self.open_interest_period, limit=2)
                
                if oi_history and len(oi_history) == 2:
                    latest_oi_data = oi_history[1] # El más reciente
                    previous_oi_data = oi_history[0] # El anterior al más reciente
                    
                    current_oi_usdt = latest_oi_data.get('sumOpenInterestValue', Decimal('0'))
                    previous_oi_usdt = previous_oi_data.get('sumOpenInterestValue', Decimal('0'))
                    
                    current_oi_value_for_log = f"{current_oi_usdt:.2f}"
                    previous_oi_value_for_log = f"{previous_oi_usdt:.2f}"
                    open_interest_delta_str = f"{current_oi_usdt - previous_oi_usdt:.2f}"

                    if current_oi_usdt > previous_oi_usdt:
                        condition_oi_increase_met = True
                    
                    self.logger.info(f"[{self.symbol}] Chequeo Open Interest (Activado, Período: {self.open_interest_period}): "
                                     f"Actual OI USDT ({latest_oi_data.get('timestamp')}): {current_oi_value_for_log}, "
                                     f"Anterior OI USDT ({previous_oi_data.get('timestamp')}): {previous_oi_value_for_log}, "
                                     f"Aumento? {'Sí' if condition_oi_increase_met else 'No'}. Delta: {open_interest_delta_str}")
                elif oi_history and len(oi_history) == 1:
                    latest_oi_data = oi_history[0]
                    current_oi_usdt = latest_oi_data.get('sumOpenInterestValue', Decimal('0'))
                    current_oi_value_for_log = f"{current_oi_usdt:.2f}"
                    self.logger.warning(f"[{self.symbol}] Chequeo Open Interest (Activado, Período: {self.open_interest_period}): Solo se obtuvo 1 punto de OI ({current_oi_value_for_log}). No se puede comparar. Condición NO cumplida.")
                    # condition_oi_increase_met permanece False
                else:
                    self.logger.warning(f"[{self.symbol}] Chequeo Open Interest (Activado, Período: {self.open_interest_period}): No se pudieron obtener suficientes datos de OI (recibidos: {len(oi_history) if oi_history else 'None'}). Condición NO cumplida.")
                    # condition_oi_increase_met permanece False
            # --- FIN Lógica de Open Interest ---

            # --- AÑADIDO: Lógica de Filtro de Media Móvil ---
            condition_ma_filter_passed = False
            ma_value_for_log = "N/A"
            price_for_log = f"{current_price:.{price_precision_log}f}" if current_price else "N/A"

            if not self.evaluate_ma_filter:
                condition_ma_filter_passed = True
            else:
                ma_value = self._calculate_moving_average(klines_df)
                if ma_value is not None:
                    ma_value_for_log = f"{ma_value:.{price_precision_log}f}"
                    if current_price < ma_value:
                        condition_ma_filter_passed = True
                else:
                    self.logger.warning(f"[{self.symbol}] No se pudo calcular el valor de la MA para el chequeo de entrada.")

            self.logger.info(f"[{self.symbol}] Resumen Chequeo Entrada: RSI en rango? {'Sí' if condition_rsi_in_range else 'No'}, "
                             f"Incremento RSI OK? {'Sí' if condition_rsi_change_meets_thresh_up else 'No'}, "
                             f"Volumen OK? {'Sí' if volume_check_passed else 'No'}, "
                             f"Req Velas Alcistas OK? {'Sí' if condition_required_uptrend_met else 'No'}, "
                             f"Incremento OI OK? {'Sí' if condition_oi_increase_met else 'No'}, "
                             f"Filtro MA OK? {'Sí' if condition_ma_filter_passed else 'No'}")

            # Evaluar todas las condiciones para la señal de entrada
            if all([condition_rsi_in_range, condition_rsi_change_meets_thresh_up, volume_check_passed, 
                    condition_required_uptrend_met, condition_oi_increase_met, condition_ma_filter_passed]):
                self.logger.info(f"[{self.symbol}] CONDICIÓN DE ENTRADA COMBINADA DETECTADA.")
                entry_signal = True
                self.entry_reason = (f"RSI_range/delta/vol/uptrend/oi/MA_Filter") # Razón simplificada
            else:
                # ... la lógica de log de fallos existente ...
                # (sin cambios, pero se podría añadir el fallo de MA si se quisiera)
                pass

            # --- Actualizar el RSI anterior para el próximo ciclo ---
            if self.last_rsi_value is not None:
                self.previous_rsi_value = self.last_rsi_value
            elif self.last_rsi_value is None: # Si el cálculo de RSI falló y es None
                # No actualizamos previous_rsi_value para no perder el último valor válido si lo teníamos.
                # O podríamos decidir ponerlo a None también. Por ahora, no lo actualizamos.
                self.logger.debug(f"[{self.symbol}] No se actualiza previous_rsi_value porque last_rsi_value es None.")
            # ----------------------------------------------------
            # --- NUEVO: Actualizar el Open Interest anterior para el próximo ciclo ---
            # if current_open_interest_usdt is not None and not pd.isna(current_open_interest_usdt):
            # self.previous_open_interest_usdt = current_open_interest_usdt
            # else:
            # self.logger.debug(f"[{self.symbol}] No se actualiza previous_open_interest_usdt porque el OI actual no es válido o no está disponible.")
            # ---------------------------------------------------------------------

            if entry_signal:
                 # Calcular precio y cantidad para la orden LIMIT BUY
                # Para precio LIMIT, podemos usar el precio actual o el mejor ASK del order book
                best_ask_price = self._get_best_entry_price('BUY') 
                if not best_ask_price:
                    self.logger.error(f"[{self.symbol}] No se pudo obtener el mejor precio Ask para la entrada. No se colocará orden.")
                    self._update_state(BotState.IDLE)
                    return
                
                limit_buy_price = self._adjust_price(best_ask_price)
                quantity = self._adjust_quantity(self.position_size_usdt / limit_buy_price)
                
                # CORRECCIÓN: La comprobación debe ser si es None
                if quantity is None or quantity <= 0:
                    self.logger.warning(f"[{self.symbol}] Cantidad calculada para la orden es inválida ({quantity}) después del ajuste. No se puede entrar.")
                    self._update_state(BotState.IDLE)
                    return

                # Calcular la precisión del precio para el log de forma segura
                price_precision_log = self.price_tick_size.as_tuple().exponent * -1 if self.price_tick_size and self.price_tick_size.is_finite() and self.price_tick_size > Decimal('0') else 2
                self.logger.warning(f"[{self.symbol}] SEÑAL DE ENTRADA ({self.entry_reason}). Intentando colocar orden LIMIT BUY @ {limit_buy_price:.{price_precision_log}f}, Cantidad={quantity}")
                self._update_state(BotState.PLACING_ENTRY)
                order_result = create_futures_limit_order(self.symbol, 'BUY', quantity, limit_buy_price)

                if order_result and order_result.get('orderId'):
                    self.pending_entry_order_id = order_result['orderId']
                    self.pending_order_timestamp = time.time()
                    # NO guardamos rsi_at_entry aquí, sino cuando la orden se LLENA.
                    self.logger.warning(f"[{self.symbol}] Orden LIMIT BUY {self.pending_entry_order_id} colocada @ {limit_buy_price:.{price_precision_log}f}. Esperando ejecución...")
                    self._update_state(BotState.WAITING_ENTRY_FILL)
                else:
                    self.logger.error(f"[{self.symbol}] Fallo al colocar la orden LIMIT BUY.")
                    self._set_error_state("Failed to place entry order.") 
            else:
                # self.logger.debug(f"[{self.symbol}] No hay señal de entrada en este ciclo.") # Ya logueado arriba
                self._update_state(BotState.IDLE) 
        else:
            if self.in_position:
                self.logger.debug(f"[{self.symbol}] Ya en posición. Saltando chequeo de entrada.")
                self._update_state(BotState.IN_POSITION) 
            elif self.pending_entry_order_id:
                self.logger.debug(f"[{self.symbol}] Ya hay una orden de entrada pendiente ({self.pending_entry_order_id}). Saltando nuevo chequeo de entrada.")
                self._update_state(BotState.WAITING_ENTRY_FILL)

    def _check_pending_entry_order(self, current_market_price: Decimal | None = None):
        """
        Verifica el estado de una orden de entrada pendiente y maneja el timeout.
        """
        if not self.pending_entry_order_id:
            # Esto no debería pasar si estamos en WAITING_ENTRY_FILL, pero por si acaso.
            self.logger.warning(f"[{self.symbol}] _check_pending_entry_order llamado sin pending_entry_order_id. Forzando a IDLE.")
            self._update_state(BotState.IDLE)
            return

        order_status_response = get_order_status(self.symbol, self.pending_entry_order_id)
        if not order_status_response:
            self.logger.error(f"[{self.symbol}] No se pudo obtener el estado de la orden de entrada {self.pending_entry_order_id}.")
            # Podríamos mantener el estado y reintentar, o ir a ERROR. Por ahora, reintentar en el próximo ciclo.
            return

        status_val = order_status_response.get('status')
        # No loguear cada chequeo de 'NEW' para no llenar los logs, solo estados terminales o cambios.
        # self.logger.info(f"[{self.symbol}] Estado de orden de entrada pendiente {self.pending_entry_order_id}: {status_val}")

        if status_val == 'FILLED':
            self.logger.info(f"[{self.symbol}] Orden de entrada {self.pending_entry_order_id} LLENADA. Procesando...")
            self._handle_filled_entry_order(order_status_response)
            return # Importante: Salir después de manejar la orden llena

        if status_val in ['CANCELED', 'REJECTED', 'EXPIRED', 'PENDING_CANCEL']:
            self.logger.warning(f"[{self.symbol}] Orden de entrada {self.pending_entry_order_id} ya no está activa (estado: {status_val}). Reseteando y volviendo a IDLE.")
            self._reset_pending_order_state() # Limpia pending_entry_order_id
            self._update_state(BotState.IDLE)
            return

        # Si sigue 'NEW' o 'PARTIALLY_FILLED', chequear timeout
        if self.order_timeout_seconds > 0 and self.pending_order_timestamp and \
           (time.time() - self.pending_order_timestamp) > self.order_timeout_seconds:
            self.logger.warning(f"[{self.symbol}] Orden de entrada {self.pending_entry_order_id} (estado {status_val}) ha excedido timeout de {self.order_timeout_seconds}s. Cancelando...")
            # Guardar el ID de la orden que se intenta cancelar ANTES de la llamada de cancelación
            order_id_to_cancel = self.pending_entry_order_id
            # self._update_state(BotState.CANCELING_ORDER) # Opcional: estado intermedio
            
            cancel_result = cancel_futures_order(self.symbol, order_id_to_cancel)
            
            # Re-chequear estado DESPUÉS del intento de cancelación usando el ID guardado
            current_status_after_cancel = get_order_status(self.symbol, order_id_to_cancel)
            final_status_val = current_status_after_cancel.get('status') if current_status_after_cancel else "UNKNOWN"

            if final_status_val == 'FILLED':
                self.logger.info(f"[{self.symbol}] Orden {order_id_to_cancel} se llenó durante/después del intento de cancelación por timeout.")
                self._handle_filled_entry_order(current_status_after_cancel) # Procesar la orden llena
            elif final_status_val == 'CANCELED':
                self.logger.warning(f"[{self.symbol}] Orden de entrada {order_id_to_cancel} cancelada exitosamente por timeout.")
                self._reset_pending_order_state() # Limpiar el ID de la orden cancelada
                self._update_state(BotState.IDLE) # Volver a IDLE para reevaluar condiciones
            else:
                # Si la cancelación falló (ej. unknown order) o el estado final es incierto.
                self.logger.error(f"[{self.symbol}] Fallo al cancelar la orden de entrada {order_id_to_cancel} por timeout o estado final ({final_status_val}) no es CANCELED/FILLED. Respuesta API de cancelación: {cancel_result}. Considerar revisión manual.")
                # Es importante resetear el pending_order_id para no quedar en un bucle de cancelación si la orden ya no existe.
                # Si la orden realmente aún existe pero no se pudo cancelar, esto podría ser un problema. Pero 'Unknown order' sugiere que ya no es manejable
                if "Unknown order sent" in str(cancel_result) or final_status_val == "UNKNOWN": # Asumir que ya no es manejable
                     self.logger.warning(f"[{self.symbol}] Asumiendo que la orden {order_id_to_cancel} ya no existe o es irrecuperable. Reseteando pending order y volviendo a IDLE.")
                     self._reset_pending_order_state()
                     self._update_state(BotState.IDLE)
                else: # La orden podría seguir ahí, pero la cancelación falló por otra razón.
                    self._set_error_state(f"Failed to cancel timed-out entry order {order_id_to_cancel}, API cancel response: {cancel_result}, final status: {final_status_val}")
            return
        elif status_val not in ['NEW', 'PARTIALLY_FILLED']:
            self.logger.info(f"[{self.symbol}] Estado de orden de entrada pendiente {self.pending_entry_order_id}: {status_val} (sin acción de timeout este ciclo).")

    def _handle_filled_entry_order(self, order_details: dict):
        """
        Maneja la lógica cuando una orden de entrada se completa correctamente.
        """
        self.logger.info(f"[{self.symbol}] Orden de ENTRADA {order_details.get('orderId')} COMPLETADA. Detalles: {order_details}")
        self.pending_entry_order_id = None
        self.pending_order_timestamp = None
        
        self.in_position = True 
        
        filled_price_str = order_details.get('avgPrice')
        filled_quantity_str = order_details.get('executedQty')
        update_time_ms = order_details.get('updateTime', time.time() * 1000)

        if not filled_price_str or not filled_quantity_str:
            self.logger.error(f"[{self.symbol}] Orden de entrada FILLED pero falta avgPrice o executedQty: {order_details}. Re-verificando posición.")
            self._verify_position_status() 
            return

        filled_price = Decimal(filled_price_str)
        filled_quantity = Decimal(filled_quantity_str)

        if filled_price <= Decimal('0') or filled_quantity <= Decimal('0'):
            self.logger.error(f"[{self.symbol}] Orden de entrada FILLED pero con precio/cantidad inválidos (<=0): {order_details}. Re-verificando posición.")
            self._verify_position_status() 
            return
        
        self.current_position = {
            'entry_price': filled_price,
            'quantity': filled_quantity,
            'entry_time': pd.Timestamp.fromtimestamp(update_time_ms / 1000, tz='UTC'),
            'position_size_usdt': abs(filled_price * filled_quantity),
            'positionAmt': filled_quantity 
        }
        
        # --- Guardar el RSI al momento de la entrada ---
        if self.last_rsi_value is not None: # Asegurarse que tenemos un valor de RSI del ciclo de entrada
            self.rsi_at_entry = self.last_rsi_value
            self.logger.info(f"[{self.symbol}] RSI en el momento de la entrada (o ciclo previo) guardado: {self.rsi_at_entry:.2f}")
        else:
            # Esto sería inusual si la lógica de entrada requirió un RSI válido.
            self.logger.warning(f"[{self.symbol}] No se pudo guardar el RSI en la entrada porque self.last_rsi_value es None.")
            self.rsi_at_entry = None # Asegurar que es None si no se pudo guardar
        # ----------------------------------------------

        self.logger.info(f"[{self.symbol}] Posición actualizada tras entrada: Precio={filled_price}, Cantidad={filled_quantity}, Tiempo={self.current_position['entry_time']}")

        self.last_known_pnl = Decimal('0')
        self._update_state(BotState.IN_POSITION)

        # --- NUEVO: Colocar órdenes TP y SL ---
        self.logger.info(f"[{self.symbol}] Orden de entrada llenada. Procediendo a colocar órdenes TP/SL.")
        self._place_tp_sl_orders()
        # ------------------------------------

        # --- INICIALIZAR PARA TRAILING STOP DE PRECIO ---
        self.price_peak_since_entry = filled_price # El precio de entrada es el primer pico
        self.price_trailing_stop_armed = False # Resetear al entrar en nueva posición
        # ----------------------------------------------

        # --- ¡NUEVO! Notificar al gestor de riesgo sobre la nueva exposición ---
        position_value_usdt = Decimal(str(filled_quantity)) * Decimal(str(filled_price))
        self.risk_manager.add_exposure(position_value_usdt)
        # -----------------------------------------------------------------

        self._update_state(BotState.MONITORING)

    def _check_exit_conditions(self, klines_df: pd.DataFrame):
        """
        Verifica si se cumplen las condiciones para cerrar una posición LONG.
        """
        if self.in_position and self.current_position:
            rsi_values_exit = calculate_rsi(klines_df['close'], period=self.rsi_period)
            current_rsi_str = "N/A"
            if rsi_values_exit is not None and not rsi_values_exit.empty:
                self.last_rsi_value = rsi_values_exit.iloc[-1]
                current_rsi_str = f"{self.last_rsi_value:.2f}"
            else:
                self.logger.warning(f"[{self.symbol}] No se pudo calcular el RSI para _check_exit_conditions. Usando valor anterior: {self.last_rsi_value:.2f if self.last_rsi_value else 'None'}")
                if self.last_rsi_value is not None:
                    current_rsi_str = f"{self.last_rsi_value:.2f}"

            price_precision_log = self.price_tick_size.as_tuple().exponent * -1 if self.price_tick_size and self.price_tick_size.is_finite() and self.price_tick_size > Decimal('0') else 2
            self.logger.info(f"[{self.symbol}] Chequeo Salida: Precio actual={klines_df.iloc[-1]['close']:.{price_precision_log}f}, RSI Actual={current_rsi_str}")
            rsi_at_entry_str = f"{self.rsi_at_entry:.2f}" if self.rsi_at_entry is not None else "N/A"
            self.logger.info(f"[{self.symbol}] EN POSICIÓN: Entrada @ {self.current_position['entry_price']:.{price_precision_log}f}, Cant: {self.current_position['quantity']}, PnL actual: {self.last_known_pnl:.4f} USDT, RSI Entrada: {rsi_at_entry_str}")

            exit_signal = False

            # 1. Take Profit (MODIFICADO)
            if self.enable_take_profit_pnl:
                if self.take_profit_usdt > 0 and self.last_known_pnl is not None and self.last_known_pnl >= self.take_profit_usdt:
                    self.logger.warning(f"[{self.symbol}] CONDICIÓN DE TAKE PROFIT (PnL) ALCANZADA (Habilitado). PnL={self.last_known_pnl:.4f} >= TP={self.take_profit_usdt}")
                    exit_signal = True
                    self.exit_reason = f"take_profit_pnl_reached ({self.last_known_pnl:.4f})"
            else:
                self.logger.info(f"[{self.symbol}] Salida por Take Profit (PnL) DESHABILITADA.")

            # 2. Stop Loss (MODIFICADO)
            if not exit_signal and self.enable_stop_loss_pnl:
                if self.stop_loss_usdt < 0 and self.last_known_pnl is not None: 
                    if self.last_known_pnl <= self.stop_loss_usdt:
                        self.logger.warning(f"[{self.symbol}] CONDICIÓN DE STOP LOSS (PnL) ALCANZADA (Habilitado). PnL={self.last_known_pnl:.4f} <= SL={self.stop_loss_usdt}")
                        exit_signal = True
                        self.exit_reason = f"stop_loss_pnl_reached ({self.last_known_pnl:.4f})"
            elif not exit_signal: 
                self.logger.info(f"[{self.symbol}] Salida por Stop Loss (PnL) DESHABILITADA.")

            # --- INICIO NUEVA LÓGICA: TRAILING STOP POR PRECIO ---
            if not exit_signal and self.enable_price_trailing_stop:
                if self.price_trailing_stop_distance_usdt > Decimal('0') and self.current_position:
                    # Usar el precio de cierre de la última vela como precio actual del mercado
                    # klines_df debería estar disponible y ser reciente
                    current_market_price = Decimal(str(klines_df.iloc[-1]['close']))

                    # Actualizar el precio pico si el precio actual es mayor
                    if self.price_peak_since_entry is None or current_market_price > self.price_peak_since_entry:
                        self.price_peak_since_entry = current_market_price
                        self.logger.info(f"[{self.symbol}] Nuevo precio pico para Trailing Stop de Precio: {self.price_peak_since_entry:.{price_precision_log}f}")

                    # Armar el trailing stop si el PNL alcanza el umbral de activación
                    if not self.price_trailing_stop_armed and self.last_known_pnl is not None and \
                       self.last_known_pnl >= self.price_trailing_stop_activation_pnl_usdt:
                        self.price_trailing_stop_armed = True
                        self.logger.info(f"[{self.symbol}] Trailing Stop de Precio ARMADO. PnL actual ({self.last_known_pnl:.4f}) >= Activación ({self.price_trailing_stop_activation_pnl_usdt:.4f})")

                    # Si está armado, verificar condición de salida
                    if self.price_trailing_stop_armed and self.price_peak_since_entry is not None:
                        trailing_stop_price_level = self.price_peak_since_entry - self.price_trailing_stop_distance_usdt
                        self.logger.info(f"[{self.symbol}] Chequeo Salida Trailing Precio (Habilitado, Armado): "
                                         f"Actual Precio ({current_market_price:.{price_precision_log}f}) vs "
                                         f"Umbral Salida ({trailing_stop_price_level:.{price_precision_log}f} = "
                                         f"Pico {self.price_peak_since_entry:.{price_precision_log}f} - Dist {self.price_trailing_stop_distance_usdt})")
                        if current_market_price <= trailing_stop_price_level:
                            self.logger.warning(f"[{self.symbol}] CONDICIÓN DE SALIDA (TRAILING STOP DE PRECIO) DETECTADA (Habilitado): "
                                                f"Precio Actual ({current_market_price:.{price_precision_log}f}) <= Umbral ({trailing_stop_price_level:.{price_precision_log}f})")
                            exit_signal = True
                            self.exit_reason = (f"Price_Trailing_Stop (Precio={current_market_price:.{price_precision_log}f}, "
                                                f"Pico={self.price_peak_since_entry:.{price_precision_log}f}, "
                                                f"Dist={self.price_trailing_stop_distance_usdt})")
                else:
                    if self.price_trailing_stop_distance_usdt <= Decimal('0'):
                        self.logger.info(f"[{self.symbol}] Trailing Stop de Precio (Habilitado) pero distancia no es positiva ({self.price_trailing_stop_distance_usdt}). No se evaluará.")
                    # No loguear si !self.current_position porque ya se loguea al inicio de la función
            elif not exit_signal: # Si no hay señal de salida aún y el Price Trailing está deshabilitado
                 self.logger.info(f"[{self.symbol}] Salida por Trailing Stop de Precio DESHABILITADA.")
            # --- FIN NUEVA LÓGICA: TRAILING STOP POR PRECIO ---

            # --- INICIO NUEVA LÓGICA: TRAILING STOP POR PNL ---
            if not exit_signal and self.enable_pnl_trailing_stop:
                if self.pnl_trailing_stop_drop_usdt > Decimal('0') and self.last_known_pnl is not None:
                    # Armar el PNL trailing stop si el PNL alcanza el umbral de activación de PNL Trailing
                    if not self.pnl_trailing_stop_armed and self.last_known_pnl >= self.pnl_trailing_stop_activation_usdt:
                        self.pnl_trailing_stop_armed = True
                        self.pnl_peak_since_activation = self.last_known_pnl # El PNL actual es el primer pico
                        self.logger.info(f"[{self.symbol}] Trailing Stop por PNL ARMADO. "
                                         f"PNL actual ({self.last_known_pnl:.4f}) >= Activación PNL TS ({self.pnl_trailing_stop_activation_usdt:.4f}). "
                                         f"Pico PNL inicial: {self.pnl_peak_since_activation:.4f}")

                    # Si está armado, actualizar el pico de PNL y verificar condición de salida
                    if self.pnl_trailing_stop_armed:
                        if self.last_known_pnl > self.pnl_peak_since_activation:
                            self.pnl_peak_since_activation = self.last_known_pnl
                            self.logger.info(f"[{self.symbol}] Nuevo pico de PNL para Trailing Stop por PNL: {self.pnl_peak_since_activation:.4f}")

                        # Calcular el nivel de PNL de salida
                        pnl_trailing_exit_level = self.pnl_peak_since_activation - self.pnl_trailing_stop_drop_usdt
                        self.logger.info(f"[{self.symbol}] Chequeo Salida Trailing PNL (Habilitado, Armado): "
                                         f"Actual PNL ({self.last_known_pnl:.4f}) vs "
                                         f"Umbral Salida PNL ({pnl_trailing_exit_level:.4f} = "
                                         f"Pico PNL {self.pnl_peak_since_activation:.4f} - Caída {self.pnl_trailing_stop_drop_usdt})")

                        if self.last_known_pnl <= pnl_trailing_exit_level:
                            self.logger.warning(f"[{self.symbol}] CONDICIÓN DE SALIDA (TRAILING STOP POR PNL) DETECTADA (Habilitado): "
                                                f"PNL Actual ({self.last_known_pnl:.4f}) <= Umbral PNL ({pnl_trailing_exit_level:.4f})")
                            exit_signal = True
                            self.exit_reason = (f"PNL_Trailing_Stop (PNL={self.last_known_pnl:.4f}, "
                                                f"PicoPNL={self.pnl_peak_since_activation:.4f}, "
                                                f"DropPNL={self.pnl_trailing_stop_drop_usdt})")
                else:
                    if self.pnl_trailing_stop_drop_usdt <= Decimal('0'):
                        self.logger.info(f"[{self.symbol}] Trailing Stop por PNL (Habilitado) pero la distancia de caída no es positiva ({self.pnl_trailing_stop_drop_usdt}). No se evaluará.")
            elif not exit_signal: # Si no hay señal de salida aún y el PNL Trailing está deshabilitado
                 self.logger.info(f"[{self.symbol}] Salida por Trailing Stop por PNL DESHABILITADA.")
            # --- FIN NUEVA LÓGICA: TRAILING STOP POR PNL ---

            # 3. Activación de RSI objetivo y seguimiento del pico para Trailing Stop RSI (MODIFICADO)
            # La activación del rsi_objetivo y el seguimiento del pico se hacen independientemente de si el Trailing Stop está habilitado,
            if self.last_rsi_value is not None:
                if not self.rsi_objetivo_activado:
                    if self.last_rsi_value >= self.rsi_target: # INDENTAR ESTE BLOQUE if
                        self.rsi_objetivo_activado = True
                        self.rsi_peak_since_target = self.last_rsi_value # Inicializar el pico RSI
                        self.rsi_objetivo_alcanzado_en = pd.Timestamp.now(tz='UTC') # Opcional: registrar cuándo se armó
                        self.logger.info(f"[{self.symbol}] RSI objetivo ({self.rsi_target}) alcanzado. RSI actual: {self.last_rsi_value:.2f}. Se activa TRAILING RSI STOP. Pico inicial: {self.rsi_peak_since_target:.2f}")
                elif self.rsi_objetivo_activado: # Si ya está activado, actualizar el pico
                    if self.last_rsi_value > self.rsi_peak_since_target:
                        self.logger.info(f"[{self.symbol}] Nuevo pico RSI para TRAILING STOP: {self.last_rsi_value:.2f} (anterior: {self.rsi_peak_since_target:.2f})")
                        self.rsi_peak_since_target = self.last_rsi_value

            # 4. Salida por TRAILING RSI STOP (MODIFICADO)
            if not exit_signal and self.enable_trailing_rsi_stop: # Solo si está habilitado y no hay otra señal
                if self.rsi_objetivo_activado and self.rsi_peak_since_target is not None and self.last_rsi_value is not None:
                    trailing_rsi_exit_level = self.rsi_peak_since_target + self.rsi_threshold_down
                    self.logger.info(f"[{self.symbol}] Chequeo Salida TRAILING RSI (Habilitado): Actual RSI ({self.last_rsi_value:.2f}) vs Umbral Salida Dinámico ({trailing_rsi_exit_level:.2f} = Pico {self.rsi_peak_since_target:.2f} + Drop {self.rsi_threshold_down})")
                    if self.last_rsi_value <= trailing_rsi_exit_level:
                        self.logger.warning(f"[{self.symbol}] CONDICIÓN DE SALIDA (TRAILING RSI STOP) DETECTADA (Habilitado): RSI Actual ({self.last_rsi_value:.2f}) <= Umbral ({trailing_rsi_exit_level:.2f})")
                    exit_signal = True
                    self.exit_reason = f"Trailing_RSI_Stop (Actual={self.last_rsi_value:.2f}, Pico={self.rsi_peak_since_target:.2f}, Drop={self.rsi_threshold_down})"
            elif not exit_signal: # Si no hay señal de salida aún y el Trailing RSI está deshabilitado
                 self.logger.info(f"[{self.symbol}] Salida por Trailing RSI Stop DESHABILITADA.")

            if exit_signal:
                best_bid_price = self._get_best_exit_price('SELL')
                if not best_bid_price:
                    self.logger.error(f"[{self.symbol}] No se pudo obtener el mejor precio Bid para la salida. No se colocará orden de salida.")
                    self._update_state(BotState.IN_POSITION) # Mantener en posición, podría no tener TP/SL si fueron cancelados
                    return
                
                self.logger.warning(f"[{self.symbol}] SEÑAL DE SALIDA ({self.exit_reason}). Cancelando TP/SL existentes y colocando nueva orden LIMIT SELL @ {best_bid_price}")
                
                # --- CANCELAR ÓRDENES TP/SL EXISTENTES ANTES DE COLOCAR LA NUEVA ---
                self._cancel_active_tp_sl_orders()
                # --------------------------------------------------------------------
                
                self._place_exit_order(price=best_bid_price, reason=self.exit_reason)
            else:
                self.logger.debug(f"[{self.symbol}] No hay señal de salida. Manteniendo posición.")
                self._update_state(BotState.IN_POSITION)
        elif self.in_position and not self.current_position:
            self.logger.error(f"[{self.symbol}] En estado IN_POSITION pero sin datos de self.current_position. Reevaluando.")
            self._verify_position_status()

    def _check_pending_exit_order(self, current_market_price: Decimal | None = None):
        """
        Verifica el estado de una orden de salida pendiente y maneja el timeout.
        """
        if not self.pending_exit_order_id:
            self.logger.warning(f"[{self.symbol}] _check_pending_exit_order llamado sin pending_exit_order_id. Verificando posición actual.")
            self._verify_position_status() # Podría haberse llenado o cancelado y no nos enteramos.
            return

        order_status_response = get_order_status(self.symbol, self.pending_exit_order_id)
        if not order_status_response:
            self.logger.error(f"[{self.symbol}] No se pudo obtener el estado de la orden de salida {self.pending_exit_order_id}.")
            return

        status_val = order_status_response.get('status')
        # self.logger.info(f"[{self.symbol}] Estado de orden de salida pendiente {self.pending_exit_order_id}: {status_val}")

        if status_val == 'FILLED':
            self.logger.info(f"[{self.symbol}] Orden de salida {self.pending_exit_order_id} LLENADA. Procesando...")
            
            # --- INICIO CORRECCIÓN PNL HISTÓRICO Y EXPOSICIÓN ---
            self._update_open_position_pnl()
            final_pnl_of_trade = self.last_known_pnl
            if final_pnl_of_trade is not None:
                self.historical_pnl += final_pnl_of_trade
                self.session_pnl += final_pnl_of_trade # <-- NUEVO: Acumular PNL de sesión
                self.logger.info(f"[{self.symbol}] PNL de la operación cerrada ({final_pnl_of_trade}) añadido al histórico y a la sesión. Total Histórico: {self.historical_pnl}, Total Sesión: {self.session_pnl}")
            
            # Quitar el margen de la exposición
            self.risk_manager.remove_exposure(self.margin_for_current_position)
            self.logger.info(f"[{self.symbol}] Posición cerrada. Eliminando MARGEN {self.margin_for_current_position} USDT de la exposición.")
            self.margin_for_current_position = Decimal('0') # Resetear
            # --- FIN CORRECCIÓN PNL HISTÓRICO Y EXPOSICIÓN ---

            self._handle_filled_exit_order(order_status_response)
            return

        if status_val in ['CANCELED', 'REJECTED', 'EXPIRED', 'PENDING_CANCEL']:
            self.logger.warning(f"[{self.symbol}] Orden de salida {self.pending_exit_order_id} ya no activa (estado: {status_val}). Verificando posición actual.")
            self._reset_pending_order_state() # Limpia pending_exit_order_id
            self._verify_position_status() # Re-evaluar si aún en posición y decidir próximo estado
            return
        
        # Si sigue 'NEW' o 'PARTIALLY_FILLED', chequear timeout
        if self.order_timeout_seconds > 0 and self.pending_order_timestamp and \
           (time.time() - self.pending_order_timestamp) > self.order_timeout_seconds:
            self.logger.warning(f"[{self.symbol}] Orden de salida {self.pending_exit_order_id} (estado {status_val}) ha excedido timeout de {self.order_timeout_seconds}s. Cancelando...")
            order_id_to_cancel = self.pending_exit_order_id
            # self._update_state(BotState.CANCELING_ORDER) # Opcional

            cancel_result = cancel_futures_order(self.symbol, order_id_to_cancel)
            current_status_after_cancel = get_order_status(self.symbol, order_id_to_cancel)
            final_status_val = current_status_after_cancel.get('status') if current_status_after_cancel else "UNKNOWN"

            if final_status_val == 'FILLED':
                self.logger.info(f"[{self.symbol}] Orden de salida {order_id_to_cancel} se llenó durante/después del intento de cancelación por timeout.")
                self._handle_filled_exit_order(current_status_after_cancel)
            elif final_status_val == 'CANCELED':
                self.logger.warning(f"[{self.symbol}] Orden de salida {order_id_to_cancel} cancelada exitosamente por timeout. Reevaluando condiciones de salida.")
                self._reset_pending_order_state()
                self._verify_position_status() # Chequear si aún en posición; si sí, el próximo ciclo intentará salir de nuevo.
            else:
                self.logger.error(f"[{self.symbol}] Fallo al cancelar la orden de salida {order_id_to_cancel} por timeout o estado final ({final_status_val}) no es CANCELED/FILLED. Respuesta API: {cancel_result}. Considerar revisión manual.")
                if "Unknown order sent" in str(cancel_result) or final_status_val == "UNKNOWN":
                     self.logger.warning(f"[{self.symbol}] Asumiendo que la orden de salida {order_id_to_cancel} ya no existe o es irrecuperable. Reseteando pending order y verificando posición.")
                     self._reset_pending_order_state()
                     self._verify_position_status() # Muy importante verificar si la posición sigue ahí o no.
                else:
                    self._set_error_state(f"Failed to cancel timed-out exit order {order_id_to_cancel}, API cancel response: {cancel_result}, final status: {final_status_val}")
            return
        elif status_val not in ['NEW', 'PARTIALLY_FILLED']:
            self.logger.info(f"[{self.symbol}] Estado de orden de salida pendiente {self.pending_exit_order_id}: {status_val} (sin acción de timeout este ciclo).")

    def _handle_filled_exit_order(self, order_details: dict):
        """
        Maneja la lógica cuando una orden de salida se completa correctamente.
        Registra el trade y resetea el estado.
        """
        self.logger.info(f"[{self.symbol}] Orden de SALIDA {order_details.get('orderId')} COMPLETADA. Razón: {self.current_exit_reason}. Detalles: {order_details}")
        
        # Backup de la razón, ya que _reset_state la limpiará si se llama desde _handle_successful_closure
        exit_reason_to_log = self.current_exit_reason if self.current_exit_reason else f"ExitOrderFill_{order_details.get('orderId')}"

        # Marcar la orden pendiente como manejada ANTES de cualquier lógica que pueda fallar
        original_pending_exit_order_id = self.pending_exit_order_id # Guardar para pasarlo
        self.pending_exit_order_id = None
        self.pending_order_timestamp = None
        # self.current_exit_reason se usará y luego se limpiará en _reset_state

        if not self.current_position:
            self.logger.error(f"[{self.symbol}] Orden de salida {order_details.get('orderId')} llena, pero no había datos de current_position. No se puede registrar trade. Verificando posición.")
            self._verify_position_status() # Esto actualizará self.in_position y self.current_state (probablemente a IDLE)
            return

        # Obtener detalles del cierre de la orden
        close_price_str = order_details.get('avgPrice')
        quantity_closed_str = order_details.get('executedQty')
        close_timestamp_ms = order_details.get('updateTime', time.time() * 1000)

        if not close_price_str or not quantity_closed_str:
            self.logger.error(f"[{self.symbol}] Orden de salida FILLED pero falta avgPrice o executedQty: {order_details}. No se registra trade. Verificando posición.")
            self._verify_position_status()
            return
            
        close_price = Decimal(close_price_str)
        quantity_closed = Decimal(quantity_closed_str)
        close_timestamp = pd.Timestamp.fromtimestamp(close_timestamp_ms / 1000, tz='UTC')

        if close_price <= Decimal('0') or quantity_closed <= Decimal('0'):
            self.logger.error(f"[{self.symbol}] Orden de salida FILLED pero con precio/cantidad inválidos (<=0): {order_details}. No se registra trade. Verificando posición.")
            self._verify_position_status()
            return

        # Usar _handle_successful_closure para consistencia en el registro y reseteo.
        # _handle_successful_closure internamente llama a self._reset_state().
        self._handle_successful_closure(
            close_price=close_price,
            quantity_closed=quantity_closed,
            reason=exit_reason_to_log,
            close_timestamp=close_timestamp,
            binance_order_id_of_closure=str(original_pending_exit_order_id) if original_pending_exit_order_id else None # <-- PASAR EL ORDER ID
        )
        
        # _handle_successful_closure ya llama a _reset_state(), que limpia in_position y current_position.
        # El estado después de un cierre exitoso debe ser IDLE.
        self._update_state(BotState.IDLE)

        # --- ¡NUEVO! Notificar al gestor de riesgo que la exposición ha terminado ---
        position_value_usdt = Decimal(str(self.last_known_position_size)) * Decimal(str(self.last_known_entry_price))
        self.risk_manager.remove_exposure(position_value_usdt)
        # -------------------------------------------------------------------

    def _verify_position_status(self):
        """
        Verifica si aún estamos en posición y actualiza self.in_position y self.current_state.
        """
        self.logger.info(f"[{self.symbol}] Verificando estado de posición...")
        position_data = get_futures_position(self.symbol)

        if position_data:
            pos_amt = Decimal(position_data.get('positionAmt', '0'))
            entry_price = Decimal(position_data.get('entryPrice', '0'))
            unrealized_pnl = Decimal(position_data.get('unRealizedProfit', '0'))

            if abs(pos_amt) > Decimal('1e-9'): # Hay una posición
                if pos_amt > 0: # Es LONG
                    self.logger.info(f"[{self.symbol}] Verificación: Posición LONG activa encontrada. Cant: {pos_amt}, Entrada: {entry_price}, PnL: {unrealized_pnl}")
                    self.in_position = True
                    # Actualizar current_position solo si es diferente o no existe
                    if not self.current_position or \
                       self.current_position.get('entry_price') != entry_price or \
                       self.current_position.get('quantity') != pos_amt:
                        self.current_position = {
                            'entry_price': entry_price,
                            'quantity': pos_amt,
                            'entry_time': self.current_position.get('entry_time') if self.current_position and self.current_position.get('entry_price') == entry_price else pd.Timestamp.now(tz='UTC'), # Conservar tiempo de entrada original si el precio no cambió
                            'position_size_usdt': abs(entry_price * pos_amt),
                            'positionAmt': pos_amt
                        }
                    self.last_known_pnl = unrealized_pnl
                    self._update_state(BotState.IN_POSITION)
                    # Limpiar órdenes pendientes si encontramos posición activa inesperadamente
                    if self.pending_entry_order_id or self.pending_exit_order_id:
                        self.logger.warning(f"[{self.symbol}] Posición activa encontrada durante _verify_position_status, pero había órdenes pendientes. Limpiando IDs de órdenes pendientes.")
                        self.pending_entry_order_id = None
                        self.pending_exit_order_id = None
                        self.pending_order_timestamp = None
                        self.current_exit_reason = None

                else: # Es SHORT
                    self.logger.warning(f"[{self.symbol}] Verificación: Posición SHORT inesperada encontrada ({pos_amt}).")
                    if self.in_position: # Si el bot pensaba que estaba en un LONG
                        self._handle_external_closure_or_discrepancy(reason="verify_pos_found_short", short_position_data=position_data)
                    else: # Si el bot no pensaba estar en posición y encuentra SHORT
                        self._reset_state()
                        self._update_state(BotState.IDLE)
            else: # No hay posición (pos_amt ~ 0)
                self.logger.info(f"[{self.symbol}] Verificación: No hay posición abierta (Cantidad ~ 0).")
                if self.in_position: # Si el bot pensaba que estaba en posición
                    self._handle_external_closure_or_discrepancy(reason="verify_pos_now_closed")
                else: # Bot no pensaba estar en posición y no hay
                    if self.current_state != BotState.IDLE and self.current_state != BotState.STOPPED : # Solo resetear si no está ya en un estado de reposo
                        self._reset_state()
                        self._update_state(BotState.IDLE)
        else: # No se pudo obtener info de la posición
            self.logger.warning(f"[{self.symbol}] Verificación: No se pudo obtener información de posición de Binance.")
            if self.in_position:
                 self.logger.warning(f"[{self.symbol}] Asumiendo cierre externo por no poder obtener datos de posición.")
                 self._handle_external_closure_or_discrepancy(reason="verify_pos_no_data")
            else:
                if self.current_state != BotState.IDLE and self.current_state != BotState.STOPPED:
                    self._reset_state()
                    self._update_state(BotState.IDLE)

    def _reset_pending_order_state(self):
        """
        Resetea el estado de una orden pendiente y posición.
        """
        self.logger.debug(f"[{self.symbol}] Reseteando estado de orden pendiente/posición.")
        self.pending_entry_order_id = None
        self.pending_exit_order_id = None
        self.pending_order_timestamp = None
        self.current_exit_reason = None # <-- Asegurar que se resetea aquí también
        # ---------------------------------------------------
        # self.last_rsi_value = None # Podríamos mantenerlo o resetearlo

    def _handle_external_closure_or_discrepancy(self, reason: str, short_position_data: dict | None = None):
        """
        Maneja casos de discrepancia donde la lógica de _update_open_position_pnl no pudo resolver completamente,
        o cuando se detecta una posición SHORT y el bot esperaba LONG (y _update_open_position_pnl ya intentó manejarlo).
        Esta función ahora es más un fallback o un manejador de errores específicos de discrepancia
        que un procesador primario de cierres externos (esa lógica se movió a _update_open_position_pnl).
        """
        self.logger.warning(f"[{self.symbol}] --- _handle_external_closure_or_discrepancy --- Reason: {reason}")

        # Tomar una copia de self.current_position ANTES de resetear estado, por si se necesita para un log de último recurso.
        # Es posible que _update_open_position_pnl ya haya reseteado el estado si el cierre se manejó ahí.
        # Esta función es un fallback.
        current_pos_at_call = self.current_position.copy() if self.current_position else {}
        old_entry_price = current_pos_at_call.get('entry_price')
        old_quantity = current_pos_at_call.get('quantity')
        old_entry_time = current_pos_at_call.get('entry_time')

        self.logger.info(f"[{self.symbol}] Data de posición al momento de llamar a _handle_external_closure_or_discrepancy: EntryP={old_entry_price}, Qty={old_quantity}, EntryT={old_entry_time}")

        # Mapeo de razones internas a razones simplificadas para el usuario 
        db_reason = f"Discrepancia ({reason})"
        if reason == "pnl_update_no_pos_data_assumed_closed": # Nueva razón desde _update_open_position_pnl
             db_reason = "Cierre Externo (Fallo al obtener datos de posición de Binance)"
        elif reason == "pnl_update_unexpected_short":
             db_reason = "Error: Posición Corta Detectada Inesperadamente"
        
        self.logger.info(f"[{self.symbol}] Razón de discrepancia mapeada para DB: '{db_reason}'")

        # Primero, resetear el estado del bot para este símbolo a un estado limpio.
        # Esto es crucial para evitar comportamientos erráticos.
        self.logger.info(f"[{self.symbol}] _handle_external_closure_or_discrepancy: Reseteando estado del bot AHORA.")
        self._reset_state() # Limpia self.in_position, self.current_position, órdenes pendientes, etc.
        self._update_state(BotState.IDLE)

        # Si el problema es una posición SHORT, solo loguear el error y asegurarse de que el estado está reseteado.
        # El registro de un posible cierre de LONG previo ya debería haber ocurrido en _update_open_position_pnl.
        if "pnl_update_unexpected_short" in reason:
            self.logger.error(f"[{self.symbol}] Discrepancia: Se detectó una posición SHORT. El bot solo maneja LONGs. Estado ya reseteado.")
            self.logger.info(f"[{self.symbol}] --- FIN _handle_external_closure_or_discrepancy (SHORT detectado) ---")
            return

        # Si la razón fue "pnl_update_no_pos_data_assumed_closed", _update_open_position_pnl
        # NO pudo obtener datos de Binance, así que la búsqueda de historial no se pudo hacer allí.
        # Intentamos un registro de último recurso aquí SI teníamos datos de la posición vieja del bot.
        if reason == "pnl_update_no_pos_data_assumed_closed":
            if old_entry_price is not None and old_quantity is not None and old_entry_price > Decimal('0') and old_quantity > Decimal('0'):
                self.logger.warning(f"[{self.symbol}] _handle_external_closure_or_discrepancy: Intentando registro de último recurso para '{reason}' porque los datos de Binance no estuvieron disponibles.")
                
                final_open_timestamp = old_entry_time if old_entry_time else pd.Timestamp.now(tz='UTC') - pd.Timedelta(minutes=1)
                final_close_timestamp = pd.Timestamp.now(tz='UTC')

                # Construcción de db_trade_params mejorada
                db_trade_params = {}
                string_params = ['rsi_interval', 'rsi_period', 'rsi_threshold_up', 'rsi_threshold_down', 
                                 'rsi_entry_level_low', 'rsi_entry_level_high', 'volume_sma_period', 
                                 'volume_factor', 'downtrend_check_candles', 'order_timeout_seconds']
                float_params = ['position_size_usdt', 'take_profit_usdt', 'stop_loss_usdt', 'rsi_target',
                                'price_trailing_stop_distance_usdt', 'price_trailing_stop_activation_pnl_usdt',
                                'pnl_trailing_stop_activation_usdt', 'pnl_trailing_stop_drop_usdt']
                bool_params = ['enable_price_trailing_stop', 'enable_pnl_trailing_stop', 'evaluate_rsi_delta', 
                               'evaluate_volume_filter', 'evaluate_rsi_range', 'evaluate_downtrend_candles_block',
                               'evaluate_downtrend_levels_block', 'evaluate_required_uptrend', 
                               'enable_take_profit_pnl', 'enable_stop_loss_pnl', 'enable_trailing_rsi_stop']

                for p_name in string_params:
                    if hasattr(self, p_name): db_trade_params[p_name] = str(getattr(self, p_name))
                for p_name in float_params:
                    if hasattr(self, p_name):
                        try: db_trade_params[p_name] = float(getattr(self, p_name))
                        except (ValueError, TypeError): self.logger.warning(f"[{self.symbol}] Param {p_name} ({getattr(self,p_name)}) to float failed."); db_trade_params[p_name] = 0.0
                for p_name in bool_params:
                     if hasattr(self, p_name): db_trade_params[p_name] = bool(getattr(self, p_name))

                # <<< LOG DETALLADO AÑADIDO AQUÍ >>>
                # Convertir a datetime.datetime ANTES de loguear y ANTES de pasar a record_trade
                final_open_timestamp_dt = final_open_timestamp.to_pydatetime() if pd.notna(final_open_timestamp) else None
                final_close_timestamp_dt = final_close_timestamp.to_pydatetime() if pd.notna(final_close_timestamp) else None

                self.logger.info(f"[{self.symbol}] _handle_external_closure_or_discrepancy: Intentando registrar (último recurso) con los siguientes datos -> "
                                 f"Symbol: {self.symbol}, Type: LONG, OpenTS: {final_open_timestamp_dt}, CloseTS: {final_close_timestamp_dt}, "
                                 f"OpenPrice: {float(old_entry_price)}, ClosePrice: {float(old_entry_price)}, Qty: {float(old_quantity)}, "
                                 f"PosSizeUSDT: {float(abs(old_entry_price * old_quantity))}, PNL: 0.0, Reason: '{db_reason}', "
                                 f"Params: {db_trade_params}, BinanceTradeID: None")
                try:
                    record_trade(
                        symbol=self.symbol, trade_type='LONG',
                        open_timestamp=final_open_timestamp_dt,
                        close_timestamp=final_close_timestamp_dt,
                        open_price=float(old_entry_price),
                        close_price=float(old_entry_price), # PNL Cero
                        quantity=float(old_quantity),
                        position_size_usdt=float(abs(old_entry_price * old_quantity)),
                        pnl_usdt=0.0, 
                        close_reason=db_reason,
                        parameters=db_trade_params,
                        binance_trade_id=None
                    )
                    self.logger.info(f"[{self.symbol}] _handle_external_closure_or_discrepancy: Registro de último recurso en DB. PNL: 0.0, Razón: {db_reason}")
                except Exception as e_rec_fallback:
                    self.logger.error(f"[{self.symbol}] _handle_external_closure_or_discrepancy: Error en registro de último recurso: {e_rec_fallback}", exc_info=True)
            else:
                self.logger.warning(f"[{self.symbol}] _handle_external_closure_or_discrepancy: No hay suficientes datos de posición previa para un registro de último recurso para '{reason}'. Estado ya reseteado.")
        
        self.logger.info(f"[{self.symbol}] --- FIN _handle_external_closure_or_discrepancy (Estado ya reseteado) ---")

    def _check_downtrend_levels(self, klines_df: pd.DataFrame) -> bool:
        """
        Verifica si hay una tendencia bajista comparando los cierres de velas en intervalos específicos.
        Compara: último_cierre < cierre_vela_N < cierre_vela_2N < cierre_vela_3N
        
        Args:
            klines_df (pd.DataFrame): DataFrame con los datos de las velas
            
        Returns:
            bool: True si se detecta tendencia bajista, False en caso contrario
        """
        n = self.downtrend_level_check
        
        if n < 1:
            return False
            
        # Necesitamos al menos 3N velas para hacer la comparación
        if len(klines_df) < 3 * n:
            self.logger.warning(f"[{self.symbol}] No hay suficientes velas ({len(klines_df)}) para verificar tendencia bajista de niveles. Se necesitan al menos {3*n}.")
            return False
            
        try:
            # Obtener los cierres de las velas relevantes
            last_close = klines_df['close'].iloc[-1]
            n_close = klines_df['close'].iloc[-n-1]
            n2_close = klines_df['close'].iloc[-(2*n)-1]
            n3_close = klines_df['close'].iloc[-(3*n)-1]
            
            # Verificar la tendencia bajista
            is_downtrend = (last_close < n_close < n2_close < n3_close)
            
            if is_downtrend:
                self.logger.info(f"[{self.symbol}] Tendencia bajista detectada en niveles: "
                               f"Último({last_close:.8f}) < N({n_close:.8f}) < 2N({n2_close:.8f}) < 3N({n3_close:.8f})")
            else:
                self.logger.debug(f"[{self.symbol}] No se detectó tendencia bajista en niveles. "
                                f"Último({last_close:.8f}), N({n_close:.8f}), 2N({n2_close:.8f}), 3N({n3_close:.8f})")
                
            return is_downtrend
            
        except Exception as e:
            self.logger.error(f"[{self.symbol}] Error al verificar tendencia bajista de niveles: {e}", exc_info=True)
            return False

    # --- NUEVA FUNCIÓN AUXILIAR ---
    def _cancel_active_tp_sl_orders(self):
        """Cancels any pending TP or SL orders the bot is tracking."""
        cancelled_any = False
        if self.pending_tp_order_id:
            self.logger.info(f"[{self.symbol}] Canceling pending TP order {self.pending_tp_order_id} due to alternative exit signal.")
            try:
                # Asegurarse de que la función de cancelación existe y se llama correctamente
                cancel_futures_order(self.symbol, self.pending_tp_order_id)
            except Exception as e:
                self.logger.error(f"[{self.symbol}] Failed to cancel TP order {self.pending_tp_order_id}: {e}", exc_info=True)
            self.pending_tp_order_id = None # Clear ID regardless of cancellation success
            cancelled_any = True

        if self.pending_sl_order_id:
            self.logger.info(f"[{self.symbol}] Canceling pending SL order {self.pending_sl_order_id} due to alternative exit signal.")
            try:
                cancel_futures_order(self.symbol, self.pending_sl_order_id)
            except Exception as e:
                self.logger.error(f"[{self.symbol}] Failed to cancel SL order {self.pending_sl_order_id}: {e}", exc_info=True)
            self.pending_sl_order_id = None # Clear ID
            cancelled_any = True
        
        if cancelled_any:
            self.logger.info(f"[{self.symbol}] Pending TP/SL orders cleared/attempted cancellation.")
        return cancelled_any # Devuelve True si se intentó cancelar algo
    # --- FIN NUEVA FUNCIÓN AUXILIAR ---

    # --- NUEVA FUNCIÓN para verificar velas alcistas REQUERIDAS ---
    def _check_required_uptrend(self, klines_df: pd.DataFrame) -> bool:
        """
        Verifica si las 'N' velas cerradas más recientes muestran una tendencia ALCISTA consecutiva REQUERIDA.
        Esta función es llamada por _check_entry_conditions como un REQUISITO ADICIONAL.
        El valor de 'N' se toma de self.required_uptrend_candles.
        Devuelve True si se detecta tendencia alcista requerida (o si el chequeo está desactivado N < 2),
        False si no se detecta tendencia alcista y el chequeo está activo (N >= 2).
        """
        n_req = self.required_uptrend_candles # Este 'N' es para el requisito de subida

        if n_req < 2:
            self.logger.debug(f"[{self.symbol}] Requisito de tendencia alcista reciente (N_req={n_req}) desactivado o no aplicable. Condición cumplida por defecto.")
            return True # Si el chequeo está desactivado (N_req=0 o N_req=1), no es un obstáculo.

        if len(klines_df) < n_req + 1:
            self.logger.warning(f"[{self.symbol}] No hay suficientes klines ({len(klines_df)}) para REQUERIR tendencia alcista de {n_req} velas. Se necesitan al menos {n_req+1}. Condición NO cumplida.")
            return False

        closes = klines_df['close']
        
        for i in range(n_req - 1):
            current_candle_in_sequence_close = closes.iloc[-(2 + i)]
            previous_to_current_close = closes.iloc[-(3 + i)]

            if current_candle_in_sequence_close <= previous_to_current_close:
                self.logger.info(f"[{self.symbol}] REQUISITO de tendencia alcista ({n_req} velas) NO CUMPLIDO. "
                                 f"Vela {-(2+i)} ({current_candle_in_sequence_close:.8f}) no fue > vela {-(3+i)} ({previous_to_current_close:.8f}).")
                return False
        
        self.logger.info(f"[{self.symbol}] REQUISITO de tendencia alcista ({n_req} velas) CUMPLIDO.")
        return True
    # --- FIN NUEVA FUNCIÓN ---

    def _calculate_moving_average(self, klines_df: pd.DataFrame) -> Decimal | None:
        """Calcula la media móvil (SMA o EMA) para los precios de cierre."""
        if klines_df is None or klines_df.empty or 'close' not in klines_df.columns:
            self.logger.warning(f"[{self.symbol}] No se puede calcular la media móvil, klines_df no es válido.")
            return None
        
        if len(klines_df) < self.ma_period:
            self.logger.warning(f"[{self.symbol}] No hay suficientes datos ({len(klines_df)}) para calcular la media móvil de período {self.ma_period}.")
            return None

        close_prices = klines_df['close']
        ma = None
        
        try:
            if self.ma_type == 'EMA': # Usando el valor hardcodeado
                ma = close_prices.ewm(span=self.ma_period, adjust=False).mean()
            else: # Fallback por si acaso
                 ma = close_prices.rolling(window=self.ma_period).mean()

            last_ma_value = Decimal(str(ma.iloc[-1]))
            return last_ma_value
        except Exception as e:
            self.logger.error(f"[{self.symbol}] Error al calcular la media móvil: {e}", exc_info=True)
            return None

    def _find_confirmed_supports(self, klines_df: pd.DataFrame) -> list[Decimal]:
        """
        Identifica niveles de soporte confirmados basados en puntos de pivote bajos.
        
        Un soporte se confirma si N o más puntos de pivote bajos han ocurrido
        dentro de un rango de precios porcentual de tolerancia.

        Args:
            klines_df: DataFrame con los datos de las velas (debe tener columna 'low').

        Returns:
            Una lista de precios (Decimal) que representan los niveles de soporte confirmados.
        """
        self.logger.info(f"[{self.symbol}] Buscando soportes. Ventana: {self.support_pivot_window}, Confirmaciones: {self.support_confirmations}, Tolerancia: {self.support_level_tolerance_percent}%")

        if len(klines_df) < self.support_history_candles:
             self.logger.warning(f"[{self.symbol}] No hay suficientes klines ({len(klines_df)}) para buscar soportes (se requieren {self.support_history_candles}).")
             return []

        # 1. Encontrar Valles (Pivots Bajos)
        # Un 'low' es un pivot si es el más bajo en una ventana a su alrededor.
        # Usamos rolling window para encontrar el mínimo en una ventana N a cada lado.
        # El +1 es porque la ventana incluye la propia vela.
        window_size = 2 * self.support_pivot_window + 1
        
        # El método rolling de pandas nos permite comparar cada punto con los de su 'vecindario'
        klines_df['pivot_low'] = klines_df['low'].rolling(window=window_size, center=True).min()
        
        # Un punto es un pivot bajo si su 'low' es igual al mínimo de su ventana
        pivot_lows_df = klines_df[klines_df['low'] == klines_df['pivot_low']]
        
        if pivot_lows_df.empty:
            self.logger.info(f"[{self.symbol}] No se encontraron puntos de pivote bajos en el histórico.")
            return []

        pivot_prices = sorted([Decimal(str(p)) for p in pivot_lows_df['low'].unique()], reverse=True)
        self.logger.debug(f"[{self.symbol}] Encontrados {len(pivot_prices)} pivotes únicos: {pivot_prices}")

        # 2. Agrupar Pivots Cercanos y 3. Confirmar Soportes
        confirmed_supports = []
        
        while pivot_prices:
            # Empezamos un nuevo grupo con el pivot más alto
            base_pivot = pivot_prices.pop(0)
            current_group = [base_pivot]
            
            # Calculamos el umbral de tolerancia
            tolerance = base_pivot * (Decimal(str(self.support_level_tolerance_percent)) / Decimal('100'))
            
            # Recogemos otros pivots que estén dentro de la tolerancia
            remaining_pivots = []
            for p in pivot_prices:
                if base_pivot - p <= tolerance:
                    current_group.append(p)
                else:
                    remaining_pivots.append(p)
            
            pivot_prices = remaining_pivots

            # 3. Confirmar si el grupo es un soporte válido
            if len(current_group) >= self.support_confirmations:
                # 4. Calcular el precio final del soporte (promedio del grupo)
                avg_price = sum(current_group) / len(current_group)
                
                # Ajustamos el precio al tick_size del símbolo
                support_price = self._adjust_price(avg_price)
                
                confirmed_supports.append(support_price)
                self.logger.info(f"[{self.symbol}] SOPORTE CONFIRMADO en {support_price} con {len(current_group)} toques. Grupo: {current_group}")

        if not confirmed_supports:
            self.logger.info(f"[{self.symbol}] No se encontraron soportes que cumplan el criterio de {self.support_confirmations} confirmaciones.")

        return sorted(confirmed_supports, reverse=True) # Devolverlos del más alto al más bajo
    # -----------------------------------------------

    def get_status(self):
        """
        Recopila y devuelve un diccionario con el estado actual del bot.
        """
        return {
            "symbol": self.symbol,
            "state": self.state.value if self.state else "N/A",
            "is_running": self.is_running,
            "in_position": self.in_position,
            "current_pnl": self.last_known_pnl if self.in_position else 0.0,
            "historical_pnl": float(self.historical_pnl),
            "session_pnl": float(self.session_pnl), # <-- NUEVO: Reportar PNL de sesión
            "entry_price": self.last_known_entry_price,
            "position_size": self.last_known_position_size,
            "pending_entry_order_id": self.pending_entry_order_id,
            "pending_exit_order_id": self.pending_exit_order_id,
            "pending_tp_order_id": self.pending_tp_order_id,
            "pending_sl_order_id": self.pending_sl_order_id,
            "last_error": self.last_error_message,
            "entry_reason": self.entry_reason,
            "exit_reason": self.exit_reason,
        }

    # --- Lógica de la Estrategia de Soportes ---
    def _find_support_levels(self, klines_df: pd.DataFrame) -> list:
        """
        Identifica niveles de soporte confirmados basados en puntos de pivote bajos.
        
        Un soporte se confirma si N o más puntos de pivote bajos han ocurrido
        dentro de un rango de precios porcentual de tolerancia.

        Args:
            klines_df: DataFrame con los datos de las velas (debe tener columna 'low').

        Returns:
            Una lista de precios (Decimal) que representan los niveles de soporte confirmados.
        """
        self.logger.info(f"[{self.symbol}] Buscando soportes. Ventana: {self.support_pivot_window}, Confirmaciones: {self.support_confirmations}, Tolerancia: {self.support_level_tolerance_percent}%")

        if len(klines_df) < self.support_history_candles:
             self.logger.warning(f"[{self.symbol}] No hay suficientes klines ({len(klines_df)}) para buscar soportes (se requieren {self.support_history_candles}).")
             return []

        # 1. Encontrar Valles (Pivots Bajos)
        # Un 'low' es un pivot si es el más bajo en una ventana a su alrededor.
        # Usamos rolling window para encontrar el mínimo en una ventana N a cada lado.
        # El +1 es porque la ventana incluye la propia vela.
        window_size = 2 * self.support_pivot_window + 1
        
        # El método rolling de pandas nos permite comparar cada punto con los de su 'vecindario'
        klines_df['pivot_low'] = klines_df['low'].rolling(window=window_size, center=True).min()
        
        # Un punto es un pivot bajo si su 'low' es igual al mínimo de su ventana
        pivot_lows_df = klines_df[klines_df['low'] == klines_df['pivot_low']]
        
        if pivot_lows_df.empty:
            self.logger.info(f"[{self.symbol}] No se encontraron puntos de pivote bajos en el histórico.")
            return []

        pivot_prices = sorted([Decimal(str(p)) for p in pivot_lows_df['low'].unique()], reverse=True)
        self.logger.debug(f"[{self.symbol}] Encontrados {len(pivot_prices)} pivotes únicos: {pivot_prices}")

        # 2. Agrupar Pivots Cercanos y 3. Confirmar Soportes
        confirmed_supports = []
        
        while pivot_prices:
            # Empezamos un nuevo grupo con el pivot más alto
            base_pivot = pivot_prices.pop(0)
            current_group = [base_pivot]
            
            # Calculamos el umbral de tolerancia
            tolerance = base_pivot * (Decimal(str(self.support_level_tolerance_percent)) / Decimal('100'))
            
            # Recogemos otros pivots que estén dentro de la tolerancia
            remaining_pivots = []
            for p in pivot_prices:
                if base_pivot - p <= tolerance:
                    current_group.append(p)
                else:
                    remaining_pivots.append(p)
            
            pivot_prices = remaining_pivots

            # 3. Confirmar si el grupo es un soporte válido
            if len(current_group) >= self.support_confirmations:
                # 4. Calcular el precio final del soporte (promedio del grupo)
                avg_price = sum(current_group) / len(current_group)
                
                # Ajustamos el precio al tick_size del símbolo
                support_price = self._adjust_price(avg_price)
                
                confirmed_supports.append(support_price)
                self.logger.info(f"[{self.symbol}] SOPORTE CONFIRMADO en {support_price} con {len(current_group)} toques. Grupo: {current_group}")

        if not confirmed_supports:
            self.logger.info(f"[{self.symbol}] No se encontraron soportes que cumplan el criterio de {self.support_confirmations} confirmaciones.")

        return sorted(confirmed_supports, reverse=True) # Devolverlos del más alto al más bajo
    # -----------------------------------------------

    def reset_session_pnl(self):
        """Resetea el contador de PNL para una nueva sesión."""
        self.session_pnl = Decimal('0')
        self.logger.info(f"[{self.symbol}] El PNL de sesión ha sido reseteado a 0.")

    def run(self):
        self.logger.info(f"Iniciando hilo para {self.symbol}")

    def _evaluate_entry_conditions(self, klines_df):
        """
        Evalúa las condiciones de entrada para la estrategia principal (RSI, etc.).
        """
        self.logger.info(f"[{self.symbol}] Evaluando condiciones de entrada para la estrategia principal...")
        # ... (resto de la lógica de evaluación de condiciones de entrada)

# --- Bloque de ejemplo (ya no se usa directamente así) ---
# if __name__ == '__main__':
    # ... Este bloque se moverá y adaptará en run_bot.py ...
    # pass

# --- Bloque de ejemplo (sin cambios significativos, pero ahora ejecutará lógica real) --- 
if __name__ == '__main__':
    # Configurar logger y DB primero
    from .logger_setup import setup_logging
    main_logger = setup_logging()

    if main_logger:
        try:
            bot = TradingBot()
            # Ejecutar unos pocos ciclos para ver cómo funciona
            # ¡ATENCIÓN! Esto ahora puede ejecutar órdenes reales en Testnet.
            main_logger.warning("*** INICIANDO EJECUCIÓN DE PRUEBA - PUEDE CREAR ÓRDENES EN BINANCE TESTNET ***")
            for i in range(5):
                main_logger.info(f"\n===== EJECUTANDO CICLO {i+1} =====")
                bot.run_once()
                # Usar el intervalo de sleep definido en main.py si se ejecuta desde ahí
                # Aquí usamos una pausa corta solo para el ejemplo
                time.sleep(5)
            main_logger.warning("*** FIN DE EJECUCIÓN DE PRUEBA ***")

        except (ValueError, ConnectionError) as e:
            main_logger.critical(f"No se pudo inicializar el bot para la prueba: {e}")
        except Exception as e:
             main_logger.critical(f"Error inesperado durante la prueba del bot: {e}", exc_info=True)
    else:
        print("Fallo al configurar el logger, no se puede ejecutar el ejemplo de Bot.") 