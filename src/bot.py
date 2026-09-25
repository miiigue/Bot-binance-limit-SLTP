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
    create_futures_market_order,
    get_order_status,
    cancel_futures_order,
    create_futures_take_profit_order, # <-- NUEVA IMPORTACIÓN
    create_futures_stop_loss_order,    # <-- NUEVA IMPORTACIÓN
    get_user_trade_history, # <-- NUEVA IMPORTACIÓN
    get_open_interest_history, # <-- NUEVA IMPORTACIÓN
    get_last_account_trade,
    get_futures_position_information,
    set_futures_leverage
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
    PAUSED = "Paused" # <-- Estado de pausa individual
# ------------------------------------

# Caché global para el Escudo de Desplome de Bitcoin (BTC Crash Shield)
_btc_crash_cache = {
    'timestamp': 0.0,
    'timeframe': '15m',
    'drop_detected': False,
    'drop_percent': 0.0,
}

# Caché global para el Filtro de Régimen de Mercado / Tendencia Macro (HTF SuperTrend / EMA)
# Formato: {cache_key: {'timestamp': float, 'is_bullish': bool, 'detail': str, 'value': float}}
_market_regime_cache = {}

class SingleSideTradingBot:
    """
    Clase que encapsula la lógica de trading para UN símbolo y UN lado específico ('LONG' o 'SHORT').
    Interactúa con Binance Futures (Testnet/Live) respetando Hedge Mode.
    """
    def __init__(self, symbol: str, trading_params: dict, risk_manager, trade_side: str = 'LONG'):
        """
        Inicializa el bot para un símbolo y lado específico.
        """
        self.symbol = symbol.upper()
        self.trade_side = str(trade_side).upper() # 'LONG' o 'SHORT'
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
        self.price_trough_since_entry = None # Para Trailing Stop / seguimiento de SHORT
        self.price_peak_since_entry = None # Para Trailing Stop / seguimiento de LONG
        self.current_market_price = None # Precio actual de mercado en vivo
        s_init = trading_params.get('strategy_name') or trading_params.get('active_strategy_name')
        if not s_init or str(s_init).strip().lower() == 'global':
            try:
                from src.config_loader import get_strategy_for_symbol
                s_init = get_strategy_for_symbol(self.symbol)
            except Exception:
                s_init = 'v3_RSI-SNIPER-MOMENTUM_v3'
        self.strategy_name = str(s_init)
        
        # --- Variables de control de la estrategia (IDs de órdenes) ---
        self.active_order_id = None
        self.active_order_type = None
        self.pending_entry_order_id = None
        self.pending_exit_order_id = None
        self.pending_tp_order_id = None
        self.pending_sl_order_id = None
        self.entry_diagnostics = {}
        self.position_diagnostics = {}

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
        def _safe_int(val, default):
            if val is None or str(val).strip() == '':
                return default
            try:
                return int(val)
            except (ValueError, TypeError):
                return default

        def _safe_float(val, default):
            if val is None or str(val).strip() == '':
                return default
            try:
                return float(val)
            except (ValueError, TypeError):
                return default

        def _safe_decimal(val, default_str):
            if val is None or str(val).strip() == '':
                return Decimal(default_str)
            try:
                return Decimal(str(val))
            except Exception:
                return Decimal(default_str)

        self.downtrend_check_candles = _safe_int(trading_params.get('downtrend_check_candles'), 0)
        self.downtrend_candles_window = _safe_int(trading_params.get('downtrend_candles_window'), 5)
        self.downtrend_level_check = _safe_int(trading_params.get('downtrend_level_check'), 0)
        self.required_uptrend_candles = _safe_int(trading_params.get('required_uptrend_candles'), 0)
        self.rsi_at_entry = None
        self.rsi_target = _safe_float(self.params.get('rsi_target'), 50.0)
        self.rsi_objetivo_activado = False
        self.rsi_objetivo_alcanzado_en = None
        self.rsi_peak_since_target = None
        self.previous_rsi_value = None
        self.last_rsi_value = None
        # --- NUEVO: IDs para órdenes TP/SL ---
        self.pending_tp_order_id = None
        self.pending_sl_order_id = None
        self.evaluate_rsi_delta = str(trading_params.get('evaluate_rsi_delta', 'True')).lower() == 'true' if isinstance(trading_params.get('evaluate_rsi_delta'), str) else bool(trading_params.get('evaluate_rsi_delta', True))
        self.evaluate_volume_filter = str(trading_params.get('evaluate_volume_filter', 'True')).lower() == 'true' if isinstance(trading_params.get('evaluate_volume_filter'), str) else bool(trading_params.get('evaluate_volume_filter', True))
        # --- Cargar todos los nuevos parámetros de control ---
        self.evaluate_rsi_range = str(trading_params.get('evaluate_rsi_range', 'True')).lower() == 'true' if isinstance(trading_params.get('evaluate_rsi_range'), str) else bool(trading_params.get('evaluate_rsi_range', True))
        self.evaluate_downtrend_candles_block = str(trading_params.get('evaluate_downtrend_candles_block', 'True')).lower() == 'true' if isinstance(trading_params.get('evaluate_downtrend_candles_block'), str) else bool(trading_params.get('evaluate_downtrend_candles_block', True))
        self.evaluate_downtrend_levels_block = str(trading_params.get('evaluate_downtrend_levels_block', 'True')).lower() == 'true' if isinstance(trading_params.get('evaluate_downtrend_levels_block'), str) else bool(trading_params.get('evaluate_downtrend_levels_block', True))
        self.evaluate_required_uptrend = str(trading_params.get('evaluate_required_uptrend', 'True')).lower() == 'true' if isinstance(trading_params.get('evaluate_required_uptrend'), str) else bool(trading_params.get('evaluate_required_uptrend', True))
        self.enable_take_profit_pnl = str(trading_params.get('enable_take_profit_pnl', 'True')).lower() == 'true' if isinstance(trading_params.get('enable_take_profit_pnl'), str) else bool(trading_params.get('enable_take_profit_pnl', True))
        self.enable_stop_loss_pnl = str(trading_params.get('enable_stop_loss_pnl', 'True')).lower() == 'true' if isinstance(trading_params.get('enable_stop_loss_pnl'), str) else bool(trading_params.get('enable_stop_loss_pnl', True))
        self.enable_trailing_rsi_stop = str(trading_params.get('enable_trailing_rsi_stop', 'True')).lower() == 'true' if isinstance(trading_params.get('enable_trailing_rsi_stop'), str) else bool(trading_params.get('enable_trailing_rsi_stop', True))
        # --- AÑADIDO: Parámetros para Filtro de Media Móvil ---
        self.evaluate_ma_filter = str(trading_params.get('evaluate_ma_filter', 'False')).lower() == 'true'
        self.ma_type = 'EMA' # Hardcodeado a EMA como default
        self.ma_period = _safe_int(trading_params.get('ma_period'), 200)
        # ----------------------------------------------------
        # --- NUEVOS PARÁMETROS Y ESTADO PARA TRAILING STOP DE PRECIO ---
        self.enable_price_trailing_stop = str(trading_params.get('enable_price_trailing_stop', 'True')).lower() == 'true' if isinstance(trading_params.get('enable_price_trailing_stop'), str) else bool(trading_params.get('enable_price_trailing_stop', True))
        self.price_trailing_stop_distance_usdt = _safe_decimal(trading_params.get('price_trailing_stop_distance_usdt'), '0.05')
        self.price_trailing_stop_activation_pnl_usdt = _safe_decimal(trading_params.get('price_trailing_stop_activation_pnl_usdt'), '0.02')
        self.price_peak_since_entry = None # Precio más alto desde la entrada
        self.price_trailing_stop_armed = False # Si el PNL de activación se ha alcanzado
        # --- NUEVOS PARÁMETROS Y ESTADO PARA TRAILING STOP DE PNL ---
        self.enable_pnl_trailing_stop = str(trading_params.get('enable_pnl_trailing_stop', 'True')).lower() == 'true' if isinstance(trading_params.get('enable_pnl_trailing_stop'), str) else bool(trading_params.get('enable_pnl_trailing_stop', True))
        self.pnl_trailing_stop_activation_usdt = _safe_decimal(trading_params.get('pnl_trailing_stop_activation_usdt'), '0.1')
        self.pnl_trailing_stop_drop_usdt = _safe_decimal(trading_params.get('pnl_trailing_stop_drop_usdt'), '0.05')
        self.pnl_peak_since_activation = None # PNL más alto desde que el PNL trailing stop se armó
        self.pnl_trailing_stop_armed = False # Si el PNL trailing stop está armado
        # --- NUEVO: Para Open Interest ---
        self.evaluate_open_interest_increase = str(trading_params.get('evaluate_open_interest_increase', 'True')).lower() == 'true'
        self.open_interest_period = trading_params.get('open_interest_period', '5m') or '5m'
        # -------------------------------------------------------------
        
        # --- NUEVO: PARÁMETROS PARA ESTRATEGIA DE SOPORTES ---
        self.evaluate_support_strategy = str(trading_params.get('evaluate_support_strategy', 'False')).lower() == 'true'
        self.support_history_candles = _safe_int(trading_params.get('support_history_candles'), 200)
        self.support_pivot_window = _safe_int(trading_params.get('support_pivot_window'), 5)
        self.support_confirmations = _safe_int(trading_params.get('support_confirmations'), 2)
        self.support_level_tolerance_percent = _safe_float(trading_params.get('support_level_tolerance_percent'), 0.5)
        self.support_order_stop_loss_percent = _safe_float(trading_params.get('support_order_stop_loss_percent'), 2.0)
        self.support_order_take_profit_percent = _safe_float(trading_params.get('support_order_take_profit_percent'), 4.0)
        # --- FIN PARÁMETROS DE SOPORTES ---
        
        # --- NUEVO: PARÁMETROS Y ESTADO PARA RE-ENTRADAS Y ÓRDENES DE SEGURIDAD (DCA) ---
        self.enable_dca_reentry = str(trading_params.get('enable_dca_reentry', 'False')).lower() == 'true'
        self.dca_reentry_mode = str(trading_params.get('dca_reentry_mode', 'fixed_percent')).lower()
        self.dca_price_drop_percent = _safe_float(trading_params.get('dca_price_drop_percent'), 1.5)
        self.dca_max_reentries = _safe_int(trading_params.get('dca_max_reentries'), 2)
        self.dca_volume_multiplier = _safe_float(trading_params.get('dca_volume_multiplier'), 1.0)
        
        self.reentries_done = 0
        self.pending_reentry_order_id = None
        self.pending_reentry_price = None
        self.pending_reentry_qty = None
        # --- FIN PARÁMETROS DCA ---
        
        # --- NUEVO: ESTADO PARA ÓRDENES DE SOPORTE ---
        self.active_support_orders = {} # {price_level: order_id}
        # ---------------------------------------------

        # --- CIRCUIT BREAKERS Y PROTECCIÓN DE RIESGO (4 MECANISMOS) ---
        self.enable_max_loss_per_symbol = str(trading_params.get('enable_max_loss_per_symbol', 'True')).lower() == 'true' if isinstance(trading_params.get('enable_max_loss_per_symbol'), str) else bool(trading_params.get('enable_max_loss_per_symbol', True))
        self.max_loss_per_symbol_usdt = _safe_decimal(trading_params.get('max_loss_per_symbol_usdt'), '20.0')

        self.enable_consecutive_losses_cooldown = str(trading_params.get('enable_consecutive_losses_cooldown', 'True')).lower() == 'true' if isinstance(trading_params.get('enable_consecutive_losses_cooldown'), str) else bool(trading_params.get('enable_consecutive_losses_cooldown', True))
        self.max_consecutive_losses = _safe_int(trading_params.get('max_consecutive_losses'), 2)
        self.consecutive_losses_cooldown_minutes = _safe_int(trading_params.get('consecutive_losses_cooldown_minutes'), 60)

        self.enable_rolling_performance_filter = str(trading_params.get('enable_rolling_performance_filter', 'True')).lower() == 'true' if isinstance(trading_params.get('enable_rolling_performance_filter'), str) else bool(trading_params.get('enable_rolling_performance_filter', True))
        self.rolling_trades_window = _safe_int(trading_params.get('rolling_trades_window'), 5)
        self.rolling_max_losses = _safe_int(trading_params.get('rolling_max_losses'), 4)
        self.rolling_filter_cooldown_minutes = _safe_int(trading_params.get('rolling_filter_cooldown_minutes'), 120)

        self.enable_btc_crash_shield = str(trading_params.get('enable_btc_crash_shield', 'True')).lower() == 'true' if isinstance(trading_params.get('enable_btc_crash_shield'), str) else bool(trading_params.get('enable_btc_crash_shield', True))
        self.btc_crash_timeframe = str(trading_params.get('btc_crash_timeframe') or '15m')
        self.btc_crash_drop_percent = _safe_float(trading_params.get('btc_crash_drop_percent'), 2.0)
        self.btc_crash_shield_cooldown_minutes = _safe_int(trading_params.get('btc_crash_shield_cooldown_minutes'), 30)

        # --- FILTRO DE RÉGIMEN DE MERCADO (TENDENCIA MACRO) ---
        self.enable_market_regime_filter = str(trading_params.get('enable_market_regime_filter', 'False')).lower() == 'true' if isinstance(trading_params.get('enable_market_regime_filter'), str) else bool(trading_params.get('enable_market_regime_filter', False))
        self.market_regime_mode = str(trading_params.get('market_regime_mode', 'symbol')).lower()
        self.market_regime_indicator = str(trading_params.get('market_regime_indicator', 'supertrend')).lower()
        self.market_regime_timeframe = str(trading_params.get('market_regime_timeframe') or '1h')
        self.market_regime_ema_period = _safe_int(trading_params.get('market_regime_ema_period'), 50)
        self.market_regime_supertrend_period = _safe_int(trading_params.get('market_regime_supertrend_period'), 10)
        self.market_regime_supertrend_multiplier = _safe_float(trading_params.get('market_regime_supertrend_multiplier'), 3.0)

        # --- SALIDA DE EMERGENCIA POR CRASH (ANTI-DESPLOME: 3 TRIGGERS) ---
        self.enable_emergency_crash_exit = str(trading_params.get('enable_emergency_crash_exit', 'false')).lower() == 'true' if isinstance(trading_params.get('enable_emergency_crash_exit'), str) else bool(trading_params.get('enable_emergency_crash_exit', False))
        self.enable_crash_rsi_drop = str(trading_params.get('enable_crash_rsi_drop', 'true')).lower() == 'true' if isinstance(trading_params.get('enable_crash_rsi_drop'), str) else bool(trading_params.get('enable_crash_rsi_drop', True))
        self.crash_rsi_drop_threshold = _safe_float(trading_params.get('crash_rsi_drop_threshold'), 8.0)
        self.enable_crash_price_drop = str(trading_params.get('enable_crash_price_drop', 'true')).lower() == 'true' if isinstance(trading_params.get('enable_crash_price_drop'), str) else bool(trading_params.get('enable_crash_price_drop', True))
        self.crash_price_drop_percent = _safe_float(trading_params.get('crash_price_drop_percent'), 1.5)
        self.enable_crash_pnl_drop = str(trading_params.get('enable_crash_pnl_drop', 'true')).lower() == 'true' if isinstance(trading_params.get('enable_crash_pnl_drop'), str) else bool(trading_params.get('enable_crash_pnl_drop', True))
        self.crash_pnl_drop_threshold_usdt = _safe_float(trading_params.get('crash_pnl_drop_threshold_usdt'), 5.0)
        # ------------------------------------------------------------------

        # Estado dinámico de protecciones
        self.cooldown_until_ts = 0.0
        self.pause_reason = ""
        self.consecutive_losses_count = 0
        # -----------------------------------------------------------------

        # Cliente Binance (se inicializa una vez por bot)
        self.client = get_futures_client()
        if not self.client:
            # Error crítico si no se puede inicializar el cliente
            self._set_error_state("Failed to initialize Binance client.")
            # Lanzar una excepción para detener la inicialización de este worker
            raise ConnectionError("Failed to initialize Binance client for worker.")

        # Extraer parámetros necesarios de self.params (usando .get con defaults)
        try:
            self.rsi_interval = str(self.params.get('rsi_interval') or '5m')
            self.rsi_period = _safe_int(self.params.get('rsi_period'), 14)
            self.rsi_type = str(self.params.get('rsi_type', 'WILDER')).upper().strip()
            self.rsi_threshold_up = _safe_float(self.params.get('rsi_threshold_up'), 1.5)
            self.rsi_candles_window = _safe_int(self.params.get('rsi_candles_window'), 3)
            self.rsi_positive_candles_required = _safe_int(self.params.get('rsi_positive_candles_required'), 2)
            self.rsi_positive_delta_min = _safe_float(self.params.get('rsi_positive_delta_min'), 0.0)
            self.rsi_threshold_down = _safe_float(self.params.get('rsi_threshold_down'), -1.0)
            self.rsi_entry_level_low = _safe_float(self.params.get('rsi_entry_level_low'), 25.0)
            self.rsi_entry_level_high = _safe_float(self.params.get('rsi_entry_level_high'), 75.0)
            # --- Leer parámetros de volumen --- 
            self.volume_sma_period = _safe_int(self.params.get('volume_sma_period'), 20)
            self.volume_factor = _safe_float(self.params.get('volume_factor'), 1.5)
            # ----------------------------------
            self.position_size_usdt = _safe_decimal(self.params.get('position_size_usdt'), '50')
            self.take_profit_usdt = _safe_decimal(self.params.get('take_profit_usdt'), '0')
            self.stop_loss_usdt = _safe_decimal(self.params.get('stop_loss_usdt'), '0')
            self.stop_loss_order_type = str(self.params.get('stop_loss_order_type', 'STOP_MARKET')).upper()
            self.stop_loss_trigger_type = str(self.params.get('stop_loss_trigger_type', 'MARK_PRICE')).upper()
            self.enable_emergency_software_sl = str(self.params.get('enable_emergency_software_sl', 'true')).lower() in ('true', '1')
            self.stop_loss_execution_mode = str(self.params.get('stop_loss_execution_mode', 'TOTAL_100')).upper()
            self.leverage = _safe_int(self.params.get('leverage'), 20)
            
            # --- Nuevo parámetro para timeout de órdenes LIMIT ---
            self.order_timeout_seconds = _safe_int(self.params.get('order_timeout_seconds'), 60)
            if self.order_timeout_seconds < 0:
                self.logger.warning(f"[{self.symbol}] ORDER_TIMEOUT_SECONDS ({self.order_timeout_seconds}) debe ser >= 0. Usando 60.")
                self.order_timeout_seconds = 60
            # ---------------------------------------------------

            # --- Tipo de orden de entrada y salida: LIMIT o MARKET ---
            self.entry_order_type = str(self.params.get('entry_order_type', 'LIMIT')).upper()
            if self.entry_order_type not in ('LIMIT', 'MARKET'):
                self.entry_order_type = 'LIMIT'
            self.logger.info(f"[{self.symbol}] Tipo de orden configurado: {self.entry_order_type}")

            # Validaciones básicas de parámetros
            if self.leverage < 1:
                self.logger.warning(f"[{self.symbol}] LEVERAGE ({self.leverage}) debe ser >= 1. Usando 20.")
                self.leverage = 20
            if self.volume_sma_period <= 0:
                 self.logger.warning(f"[{self.symbol}] VOLUME_SMA_PERIOD ({self.volume_sma_period}) debe ser positivo. Usando 20.")
                 self.volume_sma_period = 20
            if self.take_profit_usdt < 0:
                 self.logger.warning(f"[{self.symbol}] TAKE_PROFIT_USDT ({self.take_profit_usdt}) debe ser positivo o cero. Usando 0.")
                 self.take_profit_usdt = Decimal('0')

        except (ValueError, TypeError) as e:
            self.logger.critical(f"[{self.symbol}] Error al procesar parámetros de trading recibidos: {e}", exc_info=True)
            raise ValueError(f"Parámetros de trading inválidos para {self.symbol}")

        # Configurar apalancamiento en Binance Futures para este símbolo
        try:
            set_futures_leverage(self.symbol, self.leverage)
        except Exception as e_lev:
            self.logger.warning(f"[{self.symbol}] No se pudo configurar apalancamiento en Binance: {e_lev}")

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

        self.is_paused = False
        try:
            self.entry_diagnostics = self._build_default_entry_diagnostics()
        except Exception as e_diag_init:
            self.logger.debug(f"[{self.symbol}] Aviso construyendo entry_diagnostics iniciales: {e_diag_init}")
        self.logger.info(f"[{self.symbol}] Worker inicializado exitosamente (Tipo Orden: {self.entry_order_type}, Timeout Órdenes: {self.order_timeout_seconds}s).")

    def update_trading_params(self, new_params: dict):
        """Actualiza los parámetros de trading en caliente para el bot en ejecución."""
        self.logger.info(f"[{self.symbol}] Recibida solicitud de actualización de parámetros en caliente.")
        if not new_params:
            return

        self.params = {**self.params, **new_params}
        if 'strategy_name' in new_params and new_params['strategy_name']:
            self.strategy_name = str(new_params['strategy_name'])
        
        def _safe_int(val, default):
            if val is None or str(val).strip() == '': return default
            try: return int(val)
            except (ValueError, TypeError): return default

        def _safe_float(val, default):
            if val is None or str(val).strip() == '': return default
            try: return float(val)
            except (ValueError, TypeError): return default

        def _safe_decimal(val, default_str):
            if val is None or str(val).strip() == '': return Decimal(default_str)
            try: return Decimal(str(val))
            except Exception: return Decimal(default_str)

        self.downtrend_check_candles = _safe_int(new_params.get('downtrend_check_candles'), self.downtrend_check_candles)
        self.downtrend_candles_window = _safe_int(new_params.get('downtrend_candles_window'), self.downtrend_candles_window)
        self.downtrend_level_check = _safe_int(new_params.get('downtrend_level_check'), self.downtrend_level_check)
        self.required_uptrend_candles = _safe_int(new_params.get('required_uptrend_candles'), self.required_uptrend_candles)
        self.rsi_target = _safe_float(new_params.get('rsi_target'), self.rsi_target)
        self.evaluate_rsi_delta = str(new_params.get('evaluate_rsi_delta', self.evaluate_rsi_delta)).lower() == 'true' if isinstance(new_params.get('evaluate_rsi_delta'), str) else bool(new_params.get('evaluate_rsi_delta', self.evaluate_rsi_delta))
        self.evaluate_volume_filter = str(new_params.get('evaluate_volume_filter', self.evaluate_volume_filter)).lower() == 'true' if isinstance(new_params.get('evaluate_volume_filter'), str) else bool(new_params.get('evaluate_volume_filter', self.evaluate_volume_filter))
        self.evaluate_rsi_range = str(new_params.get('evaluate_rsi_range', self.evaluate_rsi_range)).lower() == 'true' if isinstance(new_params.get('evaluate_rsi_range'), str) else bool(new_params.get('evaluate_rsi_range', self.evaluate_rsi_range))
        self.evaluate_downtrend_candles_block = str(new_params.get('evaluate_downtrend_candles_block', self.evaluate_downtrend_candles_block)).lower() == 'true' if isinstance(new_params.get('evaluate_downtrend_candles_block'), str) else bool(new_params.get('evaluate_downtrend_candles_block', self.evaluate_downtrend_candles_block))
        self.evaluate_downtrend_levels_block = str(new_params.get('evaluate_downtrend_levels_block', self.evaluate_downtrend_levels_block)).lower() == 'true' if isinstance(new_params.get('evaluate_downtrend_levels_block'), str) else bool(new_params.get('evaluate_downtrend_levels_block', self.evaluate_downtrend_levels_block))
        self.evaluate_required_uptrend = str(new_params.get('evaluate_required_uptrend', self.evaluate_required_uptrend)).lower() == 'true' if isinstance(new_params.get('evaluate_required_uptrend'), str) else bool(new_params.get('evaluate_required_uptrend', self.evaluate_required_uptrend))
        self.enable_take_profit_pnl = str(new_params.get('enable_take_profit_pnl', self.enable_take_profit_pnl)).lower() == 'true' if isinstance(new_params.get('enable_take_profit_pnl'), str) else bool(new_params.get('enable_take_profit_pnl', self.enable_take_profit_pnl))
        self.enable_stop_loss_pnl = str(new_params.get('enable_stop_loss_pnl', self.enable_stop_loss_pnl)).lower() == 'true' if isinstance(new_params.get('enable_stop_loss_pnl'), str) else bool(new_params.get('enable_stop_loss_pnl', self.enable_stop_loss_pnl))
        self.enable_trailing_rsi_stop = str(new_params.get('enable_trailing_rsi_stop', self.enable_trailing_rsi_stop)).lower() == 'true' if isinstance(new_params.get('enable_trailing_rsi_stop'), str) else bool(new_params.get('enable_trailing_rsi_stop', self.enable_trailing_rsi_stop))
        self.evaluate_ma_filter = str(new_params.get('evaluate_ma_filter', self.evaluate_ma_filter)).lower() == 'true'
        self.ma_period = _safe_int(new_params.get('ma_period'), self.ma_period)
        self.enable_price_trailing_stop = str(new_params.get('enable_price_trailing_stop', self.enable_price_trailing_stop)).lower() == 'true' if isinstance(new_params.get('enable_price_trailing_stop'), str) else bool(new_params.get('enable_price_trailing_stop', self.enable_price_trailing_stop))
        self.price_trailing_stop_distance_usdt = _safe_decimal(new_params.get('price_trailing_stop_distance_usdt'), str(self.price_trailing_stop_distance_usdt))
        self.price_trailing_stop_activation_pnl_usdt = _safe_decimal(new_params.get('price_trailing_stop_activation_pnl_usdt'), str(self.price_trailing_stop_activation_pnl_usdt))
        self.enable_pnl_trailing_stop = str(new_params.get('enable_pnl_trailing_stop', self.enable_pnl_trailing_stop)).lower() == 'true' if isinstance(new_params.get('enable_pnl_trailing_stop'), str) else bool(new_params.get('enable_pnl_trailing_stop', self.enable_pnl_trailing_stop))
        self.pnl_trailing_stop_activation_usdt = _safe_decimal(new_params.get('pnl_trailing_stop_activation_usdt'), str(self.pnl_trailing_stop_activation_usdt))
        self.pnl_trailing_stop_drop_usdt = _safe_decimal(new_params.get('pnl_trailing_stop_drop_usdt'), str(self.pnl_trailing_stop_drop_usdt))
        self.evaluate_open_interest_increase = str(new_params.get('evaluate_open_interest_increase', self.evaluate_open_interest_increase)).lower() == 'true'
        self.open_interest_period = new_params.get('open_interest_period', self.open_interest_period) or '5m'
        
        self.evaluate_support_strategy = str(new_params.get('evaluate_support_strategy', self.evaluate_support_strategy)).lower() == 'true'
        self.support_history_candles = _safe_int(new_params.get('support_history_candles'), self.support_history_candles)
        self.support_pivot_window = _safe_int(new_params.get('support_pivot_window'), self.support_pivot_window)
        self.support_confirmations = _safe_int(new_params.get('support_confirmations'), self.support_confirmations)
        self.support_level_tolerance_percent = _safe_float(new_params.get('support_level_tolerance_percent'), self.support_level_tolerance_percent)
        self.support_order_stop_loss_percent = _safe_float(new_params.get('support_order_stop_loss_percent'), self.support_order_stop_loss_percent)
        self.support_order_take_profit_percent = _safe_float(new_params.get('support_order_take_profit_percent'), self.support_order_take_profit_percent)

        self.enable_dca_reentry = str(new_params.get('enable_dca_reentry', self.enable_dca_reentry)).lower() == 'true'
        self.dca_reentry_mode = str(new_params.get('dca_reentry_mode', self.dca_reentry_mode)).lower()
        self.dca_price_drop_percent = _safe_float(new_params.get('dca_price_drop_percent'), self.dca_price_drop_percent)
        self.dca_max_reentries = _safe_int(new_params.get('dca_max_reentries'), self.dca_max_reentries)
        self.dca_volume_multiplier = _safe_float(new_params.get('dca_volume_multiplier'), self.dca_volume_multiplier)

        self.rsi_interval = str(new_params.get('rsi_interval') or self.rsi_interval)
        self.rsi_period = _safe_int(new_params.get('rsi_period'), self.rsi_period)
        if 'rsi_type' in new_params:
            self.rsi_type = str(new_params['rsi_type']).upper().strip()
        self.rsi_threshold_up = _safe_float(new_params.get('rsi_threshold_up'), self.rsi_threshold_up)
        self.rsi_candles_window = _safe_int(new_params.get('rsi_candles_window'), getattr(self, 'rsi_candles_window', 3))
        self.rsi_positive_candles_required = _safe_int(new_params.get('rsi_positive_candles_required'), getattr(self, 'rsi_positive_candles_required', 2))
        self.rsi_positive_delta_min = _safe_float(new_params.get('rsi_positive_delta_min'), getattr(self, 'rsi_positive_delta_min', 0.0))
        self.rsi_threshold_down = _safe_float(new_params.get('rsi_threshold_down'), self.rsi_threshold_down)
        self.rsi_entry_level_low = _safe_float(new_params.get('rsi_entry_level_low'), self.rsi_entry_level_low)
        self.rsi_entry_level_high = _safe_float(new_params.get('rsi_entry_level_high'), self.rsi_entry_level_high)
        self.volume_sma_period = _safe_int(new_params.get('volume_sma_period'), self.volume_sma_period)
        self.volume_factor = _safe_float(new_params.get('volume_factor'), self.volume_factor)

        self.position_size_usdt = _safe_decimal(new_params.get('position_size_usdt'), str(self.position_size_usdt))
        self.take_profit_usdt = _safe_decimal(new_params.get('take_profit_usdt'), str(self.take_profit_usdt))
        self.stop_loss_usdt = _safe_decimal(new_params.get('stop_loss_usdt'), str(self.stop_loss_usdt))
        if 'stop_loss_order_type' in new_params:
            self.stop_loss_order_type = str(new_params['stop_loss_order_type']).upper()
        if 'stop_loss_trigger_type' in new_params:
            self.stop_loss_trigger_type = str(new_params['stop_loss_trigger_type']).upper()
        if 'enable_emergency_software_sl' in new_params:
            self.enable_emergency_software_sl = str(new_params['enable_emergency_software_sl']).lower() in ('true', '1')
        if 'stop_loss_execution_mode' in new_params:
            self.stop_loss_execution_mode = str(new_params['stop_loss_execution_mode']).upper()
        
        # Solo configurar apalancamiento en Binance si no estamos en posición activa
        new_leverage = _safe_int(new_params.get('leverage'), self.leverage)
        if new_leverage != self.leverage:
            self.leverage = new_leverage
            if not self.in_position:
                try:
                    set_futures_leverage(self.symbol, self.leverage)
                except Exception as e_lev:
                    self.logger.warning(f"[{self.symbol}] Hot-reload: No se pudo configurar apalancamiento: {e_lev}")

        self.order_timeout_seconds = _safe_int(new_params.get('order_timeout_seconds'), self.order_timeout_seconds)
        if 'entry_order_type' in new_params:
            new_order_type = str(new_params['entry_order_type']).upper()
            if new_order_type in ('LIMIT', 'MARKET'):
                self.entry_order_type = new_order_type
                self.logger.info(f"[{self.symbol}] Hot-reload: entry_order_type actualizado a {self.entry_order_type}")

        # --- HOT-RELOAD CIRCUIT BREAKERS ---
        if 'enable_max_loss_per_symbol' in new_params:
            self.enable_max_loss_per_symbol = str(new_params['enable_max_loss_per_symbol']).lower() == 'true' if isinstance(new_params['enable_max_loss_per_symbol'], str) else bool(new_params['enable_max_loss_per_symbol'])
        self.max_loss_per_symbol_usdt = _safe_decimal(new_params.get('max_loss_per_symbol_usdt'), str(self.max_loss_per_symbol_usdt))

        if 'enable_consecutive_losses_cooldown' in new_params:
            self.enable_consecutive_losses_cooldown = str(new_params['enable_consecutive_losses_cooldown']).lower() == 'true' if isinstance(new_params['enable_consecutive_losses_cooldown'], str) else bool(new_params['enable_consecutive_losses_cooldown'])
        self.max_consecutive_losses = _safe_int(new_params.get('max_consecutive_losses'), self.max_consecutive_losses)
        self.consecutive_losses_cooldown_minutes = _safe_int(new_params.get('consecutive_losses_cooldown_minutes'), self.consecutive_losses_cooldown_minutes)

        if 'enable_rolling_performance_filter' in new_params:
            self.enable_rolling_performance_filter = str(new_params['enable_rolling_performance_filter']).lower() == 'true' if isinstance(new_params['enable_rolling_performance_filter'], str) else bool(new_params['enable_rolling_performance_filter'])
        self.rolling_trades_window = _safe_int(new_params.get('rolling_trades_window'), self.rolling_trades_window)
        self.rolling_max_losses = _safe_int(new_params.get('rolling_max_losses'), self.rolling_max_losses)
        self.rolling_filter_cooldown_minutes = _safe_int(new_params.get('rolling_filter_cooldown_minutes'), self.rolling_filter_cooldown_minutes)

        if 'enable_btc_crash_shield' in new_params:
            self.enable_btc_crash_shield = str(new_params['enable_btc_crash_shield']).lower() == 'true' if isinstance(new_params['enable_btc_crash_shield'], str) else bool(new_params['enable_btc_crash_shield'])
        if 'btc_crash_timeframe' in new_params and new_params['btc_crash_timeframe']:
            self.btc_crash_timeframe = str(new_params['btc_crash_timeframe'])
        self.btc_crash_drop_percent = _safe_float(new_params.get('btc_crash_drop_percent'), self.btc_crash_drop_percent)
        self.btc_crash_shield_cooldown_minutes = _safe_int(new_params.get('btc_crash_shield_cooldown_minutes'), self.btc_crash_shield_cooldown_minutes)

        # --- HOT-RELOAD RÉGIMEN DE MERCADO ---
        if 'enable_market_regime_filter' in new_params:
            self.enable_market_regime_filter = str(new_params['enable_market_regime_filter']).lower() == 'true' if isinstance(new_params['enable_market_regime_filter'], str) else bool(new_params['enable_market_regime_filter'])
        if 'market_regime_mode' in new_params and new_params['market_regime_mode']:
            self.market_regime_mode = str(new_params['market_regime_mode']).lower()
        if 'market_regime_indicator' in new_params and new_params['market_regime_indicator']:
            self.market_regime_indicator = str(new_params['market_regime_indicator']).lower()
        if 'market_regime_timeframe' in new_params and new_params['market_regime_timeframe']:
            self.market_regime_timeframe = str(new_params['market_regime_timeframe'])
        self.market_regime_ema_period = _safe_int(new_params.get('market_regime_ema_period'), self.market_regime_ema_period)
        self.market_regime_supertrend_period = _safe_int(new_params.get('market_regime_supertrend_period'), self.market_regime_supertrend_period)
        self.market_regime_supertrend_multiplier = _safe_float(new_params.get('market_regime_supertrend_multiplier'), self.market_regime_supertrend_multiplier)
        # -----------------------------------

        # --- HOT-RELOAD SALIDA DE EMERGENCIA POR CRASH ---
        if 'enable_emergency_crash_exit' in new_params:
            self.enable_emergency_crash_exit = str(new_params['enable_emergency_crash_exit']).lower() == 'true' if isinstance(new_params['enable_emergency_crash_exit'], str) else bool(new_params['enable_emergency_crash_exit'])
        if 'enable_crash_rsi_drop' in new_params:
            self.enable_crash_rsi_drop = str(new_params['enable_crash_rsi_drop']).lower() == 'true' if isinstance(new_params['enable_crash_rsi_drop'], str) else bool(new_params['enable_crash_rsi_drop'])
        self.crash_rsi_drop_threshold = _safe_float(new_params.get('crash_rsi_drop_threshold'), getattr(self, 'crash_rsi_drop_threshold', 8.0))
        if 'enable_crash_price_drop' in new_params:
            self.enable_crash_price_drop = str(new_params['enable_crash_price_drop']).lower() == 'true' if isinstance(new_params['enable_crash_price_drop'], str) else bool(new_params['enable_crash_price_drop'])
        self.crash_price_drop_percent = _safe_float(new_params.get('crash_price_drop_percent'), getattr(self, 'crash_price_drop_percent', 1.5))
        if 'enable_crash_pnl_drop' in new_params:
            self.enable_crash_pnl_drop = str(new_params['enable_crash_pnl_drop']).lower() == 'true' if isinstance(new_params['enable_crash_pnl_drop'], str) else bool(new_params['enable_crash_pnl_drop'])
        self.crash_pnl_drop_threshold_usdt = _safe_float(new_params.get('crash_pnl_drop_threshold_usdt'), getattr(self, 'crash_pnl_drop_threshold_usdt', 5.0))
        # ------------------------------------------------

        self.logger.info(f"[{self.symbol}] Parámetros de trading actualizados en caliente exitosamente.")

    def _check_initial_position(self):
        """
        Verifica si ya existe una posición para el símbolo y lado en Binance al iniciar el bot.
        Soporta Hedge Mode ('LONG' o 'SHORT') y modo One-Way.
        """
        self.logger.info(f"[{self.symbol}][{self.trade_side}] Comprobando posición inicial en Binance...")
        position_info = get_futures_position_information()

        if position_info is None:
            self.logger.error(f"[{self.symbol}][{self.trade_side}] No se pudo obtener la información de posiciones de Binance.")
            self._set_error_state("Failed to get position info on startup")
            return

        matching_positions = [p for p in position_info if p.get('symbol') == self.symbol]
        position_data = None

        # 1. Buscar coincidencia exacta por positionSide en Hedge Mode
        for p in matching_positions:
            try:
                amt = Decimal(str(p.get('positionAmt', '0')))
                if p.get('positionSide') == self.trade_side and abs(amt) > Decimal('1e-9'):
                    position_data = p
                    break
            except Exception:
                continue

        # 2. Si no hubo coincidencia en Hedge Mode, buscar en modo One-Way (positionSide == 'BOTH' o no especificado)
        if not position_data:
            for p in matching_positions:
                try:
                    amt = Decimal(str(p.get('positionAmt', '0')))
                    if abs(amt) > Decimal('1e-9'):
                        if self.trade_side == 'SHORT' and amt < Decimal('0'):
                            position_data = p
                            break
                        elif self.trade_side == 'LONG' and amt > Decimal('0'):
                            position_data = p
                            break
                except Exception:
                    continue

        pos_amt_binance = Decimal(str(position_data.get('positionAmt', '0'))) if position_data else Decimal('0')

        if abs(pos_amt_binance) > Decimal('1e-9'):
            entry_price_binance = Decimal(str(position_data.get('entryPrice', '0')))
            unrealized_pnl_binance = Decimal(str(position_data.get('unRealizedProfit', '0')))
            pos_side = position_data.get('positionSide', self.trade_side)
            actual_qty = abs(pos_amt_binance)

            self.logger.info(f"[{self.symbol}][{self.trade_side}] Se encontró posición {pos_side} existente: Cantidad={actual_qty}, Entrada={entry_price_binance}, PnL={unrealized_pnl_binance}. Sincronizando estado.")
            self.in_position = True
            self.current_state = BotState.IN_POSITION
            self.state = BotState.IN_POSITION
            self.last_known_entry_price = entry_price_binance
            self.last_known_position_size = actual_qty
            self.last_known_pnl = unrealized_pnl_binance
            self.current_position = {
                'entry_price': entry_price_binance,
                'quantity': actual_qty,
                'entry_time': pd.Timestamp.now(tz='UTC'),
                'position_size_usdt': abs(entry_price_binance * actual_qty),
                'positionAmt': pos_amt_binance,
                'side': self.trade_side
            }
            initial_margin = Decimal(str(position_data.get('initialMargin', '0')))
            self.margin_for_current_position = initial_margin
            mark_p = float(position_data.get('markPrice', '0') or 0.0)
            if mark_p <= 0 and abs(pos_amt_binance) > Decimal('1e-9'):
                mark_p = float(entry_price_binance + (unrealized_pnl_binance / pos_amt_binance))
            self.current_market_price = mark_p if mark_p > 0 else float(entry_price_binance)
            self.price_peak_since_entry = max(float(entry_price_binance), self.current_market_price)
            self.price_trough_since_entry = min(float(entry_price_binance), self.current_market_price)
            if initial_margin > 0 and self.risk_manager:
                self.risk_manager.add_exposure(initial_margin)
        else:
            self.logger.info(f"[{self.symbol}][{self.trade_side}] No se encontró posición existente.")
            self.in_position = False
            self.current_state = BotState.IDLE
            self.state = BotState.IDLE

    def _update_open_position_pnl(self) -> bool:
        """
        Actualiza el PNL de una posición abierta y verifica si todavía existe en Binance.
        Devuelve True si la posición sigue abierta, False si se ha cerrado.
        """
        if not self.in_position or not self.current_position: # self.current_position es clave
            self.logger.debug(f"[{self.symbol}] _update_open_position_pnl llamado pero no se está en posición o current_position es None. Saltando.")
            return True

        self.logger.info(f"[{self.symbol}][{self.trade_side}] _update_open_position_pnl: Verificando posición abierta en Binance...")
        position_data = get_futures_position(self.symbol, position_side=self.trade_side)

        # CRITICAL FIX: Si la API retorna None (timeout/error de red), NO asumir cierre.
        # Mantener la posición y reintentar en el próximo ciclo.
        if position_data is None:
            self.logger.warning(f"[{self.symbol}] _update_open_position_pnl: API retornó None (posible timeout/error de red). "
                                f"NO se asumirá cierre. Manteniendo posición actual y reintentando en próximo ciclo.")
            return True

        pos_amt_binance = Decimal('0')
        entry_price_binance = Decimal('0')
        unrealized_pnl_binance = Decimal('0')

        try:
            raw_amt = Decimal(str(position_data.get('positionAmt', '0')))
            is_short = (getattr(self, 'trade_side', 'LONG') == 'SHORT')
            # Validar signo: SHORT solo acepta montos negativos, LONG solo montos positivos
            if is_short:
                pos_amt_binance = raw_amt if raw_amt < Decimal('-1e-9') else Decimal('0')
            else:
                pos_amt_binance = raw_amt if raw_amt > Decimal('1e-9') else Decimal('0')
            entry_price_binance = Decimal(str(position_data.get('entryPrice', '0')))
            unrealized_pnl_binance = Decimal(str(position_data.get('unRealizedProfit', '0')))
            mark_p_raw = position_data.get('markPrice')
            mark_p = float(mark_p_raw) if (mark_p_raw and float(mark_p_raw) > 0) else 0.0
            if mark_p <= 0 and abs(pos_amt_binance) > Decimal('1e-9'):
                mark_p = float(entry_price_binance + (unrealized_pnl_binance / pos_amt_binance))

            if mark_p > 0:
                self.current_market_price = mark_p
                is_short = (getattr(self, 'trade_side', 'LONG') == 'SHORT')
                if not is_short:
                    if self.price_peak_since_entry is None or mark_p > float(self.price_peak_since_entry):
                        self.price_peak_since_entry = mark_p
                    if self.price_trough_since_entry is None or mark_p < float(self.price_trough_since_entry):
                        self.price_trough_since_entry = mark_p
                else:
                    if self.price_trough_since_entry is None or mark_p < float(self.price_trough_since_entry):
                        self.price_trough_since_entry = mark_p
                    if self.price_peak_since_entry is None or mark_p > float(self.price_peak_since_entry):
                        self.price_peak_since_entry = mark_p
        except Exception as e:
            self.logger.error(f"[{self.symbol}] _update_open_position_pnl: Error al convertir datos de posición de Binance a Decimal: {e}. Datos: {position_data}")
            return True

        # El bot pensaba que estaba en posición (self.in_position == True)
        if abs(pos_amt_binance) < Decimal('1e-9'): # Posición cerrada en Binance
            self.logger.info(f"[{self.symbol}] _update_open_position_pnl: Posición para {self.symbol} CERRADA en Binance (Cantidad: {pos_amt_binance}). Procesando cierre y registrando PNL...")
            
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
            final_pnl = None
            final_close_price = None
            final_close_timestamp = datetime.now()

            # Calcular start_time a partir del tiempo de entrada para no tomar trades viejos de días anteriores
            start_query_time = None
            if old_entry_time:
                try:
                    if hasattr(old_entry_time, 'timestamp'):
                        start_query_time = int(old_entry_time.timestamp() * 1000) - 5000
                    elif isinstance(old_entry_time, (int, float)):
                        start_query_time = int(old_entry_time) - 5000
                except Exception:
                    pass

            last_trade = get_last_account_trade(self.symbol, start_time=start_query_time)

            if last_trade:
                trade_time_ms = int(last_trade.get('time', 0))
                # Validar que el trade de Binance no sea de una operación antigua de días pasados
                if start_query_time and trade_time_ms < start_query_time:
                    self.logger.warning(f"[{self.symbol}] Trade de Binance ignorado por ser anterior a la entrada actual.")
                    last_trade = None

            if last_trade:
                self.logger.info(f"[{self.symbol}] Se encontró trade en historial de Binance: {last_trade}")
                try:
                    trade_pnl = Decimal(str(last_trade.get('realizedPnl', '0')))
                    if trade_pnl != Decimal('0'):
                        final_pnl = trade_pnl
                        final_close_price = Decimal(str(last_trade.get('price', '0')))
                        time_val = last_trade.get('time')
                        if time_val:
                            final_close_timestamp = datetime.fromtimestamp(time_val / 1000)
                        self.logger.info(f"[{self.symbol}] PnL detectado de trade Binance: {final_pnl:.4f}, Precio: {final_close_price}")
                        if close_reason == "Cierre Externo":
                            close_reason = f"Cierre Externo (PnL Detectado: {final_pnl:.4f})"
                except Exception as e:
                    self.logger.error(f"[{self.symbol}] Error al procesar datos del último trade: {e}")

            # Fallback 1: Si Binance no devolvió PnL no-cero, usar last_known_pnl registrado en tiempo real
            if (final_pnl is None or final_pnl == Decimal('0')) and self.last_known_pnl is not None and abs(self.last_known_pnl) > Decimal('0'):
                final_pnl = self.last_known_pnl
                self.logger.info(f"[{self.symbol}] PnL obtenido de last_known_pnl en vivo: {final_pnl:.4f}")

            # Fallback 2: Consultar precio de mercado actual y calcular PnL exacto
            if final_close_price is None or final_close_price <= Decimal('0'):
                try:
                    ticker = get_order_book_ticker(self.symbol)
                    if ticker:
                        price_key = 'askPrice' if self.trade_side == 'SHORT' else 'bidPrice'
                        if price_key in ticker:
                            final_close_price = Decimal(str(ticker[price_key]))
                except Exception:
                    pass
                if not final_close_price or final_close_price <= Decimal('0'):
                    final_close_price = old_entry_price or Decimal('0')

            if final_pnl is None:
                if old_entry_price and old_quantity and final_close_price and final_close_price > Decimal('0'):
                    if self.trade_side == 'SHORT':
                        final_pnl = (old_entry_price - final_close_price) * abs(old_quantity)
                    else:
                        final_pnl = (final_close_price - old_entry_price) * abs(old_quantity)
                else:
                    final_pnl = Decimal('0')
            
            # 3. Guardar en la base de datos con comisiones oficiales deducidas
            open_ts_for_db = old_entry_time.to_pydatetime() if isinstance(old_entry_time, (pd.Timestamp, datetime)) and hasattr(old_entry_time, 'to_pydatetime') else (old_entry_time if isinstance(old_entry_time, datetime) else datetime.utcnow())
            close_ts_for_db = final_close_timestamp.to_pydatetime() if isinstance(final_close_timestamp, (pd.Timestamp, datetime)) and hasattr(final_close_timestamp, 'to_pydatetime') else (final_close_timestamp if isinstance(final_close_timestamp, datetime) else datetime.utcnow())
            pos_size_calc = float(old_entry_price * abs(old_quantity)) if (old_entry_price and old_quantity) else 0.0
            close_size_calc = float(final_close_price * abs(old_quantity)) if (final_close_price and old_quantity) else pos_size_calc

            entry_rate = 0.0002 if str(self.entry_order_type).upper() == 'LIMIT' else 0.0005
            exit_rate = 0.0005
            comm_calc = round((pos_size_calc * entry_rate) + (close_size_calc * exit_rate), 4)
            gross_pnl_val = round(float(final_pnl), 4)
            net_pnl_val = round(gross_pnl_val - comm_calc, 4)

            record_trade(
                symbol=self.symbol,
                trade_type=self.trade_side,
                open_timestamp=open_ts_for_db,
                close_timestamp=close_ts_for_db,
                open_price=float(old_entry_price) if old_entry_price else 0.0,
                close_price=float(final_close_price) if final_close_price else 0.0,
                quantity=float(abs(old_quantity)) if old_quantity else 0.0,
                position_size_usdt=pos_size_calc,
                pnl_usdt=net_pnl_val,
                gross_pnl_usdt=gross_pnl_val,
                commission_usdt=comm_calc,
                close_reason=close_reason
            )
            self.logger.info(f"[{self.symbol}][{self.trade_side}] Trade CERRADO y guardado en DB. Razón: {close_reason}, PNL Neto: {net_pnl_val:.4f}, PNL Bruto: {gross_pnl_val:.4f}, Comisión: {comm_calc:.4f}")
            
            # 4. Limpiar y actualizar estado (usando PnL Neto)
            net_pnl_dec = Decimal(str(net_pnl_val))
            self.historical_pnl += net_pnl_dec
            now_epoch_ms = int(time.time() * 1000)
            trade_epoch_ms = int(final_close_timestamp.timestamp() * 1000) if hasattr(final_close_timestamp, 'timestamp') else now_epoch_ms
            # Solo acumular en sesión si el trade realmente ocurrió en la sesión activa (menos de 2 horas)
            if (now_epoch_ms - trade_epoch_ms) < 7200000:
                self.session_pnl += net_pnl_dec
            self._on_trade_closed(net_pnl_dec, close_reason)
            if self.margin_for_current_position > 0 and self.risk_manager:
                self.risk_manager.remove_exposure(self.margin_for_current_position)
                self.logger.info(f"[{self.symbol}][{self.trade_side}] Exposición de MARGEN {self.margin_for_current_position} USDT eliminada.")
            
            self._reset_state() # Esto resetea in_position, current_position, current_exit_reason, etc.
            self._update_state(BotState.IDLE)
            return False # Indicar que la posición se cerró

        else:
            # Comprobar si la posición activa corresponde al lado del bot
            is_expected_pos = False
            if self.trade_side == 'SHORT':
                is_expected_pos = (pos_amt_binance < Decimal('-1e-9')) or (abs(pos_amt_binance) > Decimal('1e-9') and position_data.get('positionSide') == 'SHORT')
            else:
                is_expected_pos = (pos_amt_binance > Decimal('1e-9')) or (abs(pos_amt_binance) > Decimal('1e-9') and position_data.get('positionSide') == 'LONG')

            if is_expected_pos:
                actual_qty = abs(pos_amt_binance)
                self.current_position = {
                    'entry_price': entry_price_binance,
                    'quantity': actual_qty,
                    'entry_time': self.current_position.get('entry_time') if self.current_position and self.current_position.get('entry_price') == entry_price_binance else pd.Timestamp.now(tz='UTC'),
                    'position_size_usdt': abs(entry_price_binance * actual_qty),
                    'positionAmt': pos_amt_binance,
                    'side': self.trade_side
                }
                self.last_known_pnl = unrealized_pnl_binance
                self.last_known_entry_price = entry_price_binance
                self.last_known_position_size = actual_qty
                if self.price_peak_since_entry is None:
                    self.price_peak_since_entry = float(entry_price_binance)
                if self.price_trough_since_entry is None:
                    self.price_trough_since_entry = float(entry_price_binance)
                self._update_state(BotState.IN_POSITION)

                # --- ACTUALIZAR DIAGNÓSTICO DE SALIDA & PROTECCIÓN EN TIEMPO REAL ---
                self.position_diagnostics = self._calculate_position_diagnostics()
                return True
            else:
                self.logger.warning(f"[{self.symbol}][{self.trade_side}] _update_open_position_pnl: Posición inesperada en Binance: {pos_amt_binance}")
                discrepancy_reason = "pnl_update_unexpected_long" if self.trade_side == 'SHORT' else "pnl_update_unexpected_short"
                self._handle_external_closure_or_discrepancy(discrepancy_reason)
                return False

        return True # Por defecto, si no se cerró, la posición sigue "abierta" para el bot.

    def _calculate_position_diagnostics(self, current_market_price: Decimal | float | None = None) -> dict:
        """
        Calcula las métricas de telemetría en tiempo real para la posición abierta:
        - Take Profit (meta, avance %, USDT restantes)
        - Stop Loss (corte, colchón en USDT, % de colchón de seguridad restante, estado)
        - Trailing Stop (tipo, activación %, piso garantizado, pico alcanzado, tolerancia restante)
        """
        try:
            if not self.in_position or not self.current_position:
                return {}

            entry_p_val = float(self.current_position.get('entry_price', 0) or 0)
            qty_val = float(self.current_position.get('quantity', 0) or 0)
            pnl_usdt_val = float(self.last_known_pnl if self.last_known_pnl is not None else 0)
            pos_val_usdt = abs(entry_p_val * qty_val)
            lev_val = int(getattr(self, 'leverage', 20) or 20)
            margin_val = (pos_val_usdt / lev_val) if lev_val > 0 else 0.0
            pnl_pct_val = (pnl_usdt_val / margin_val * 100.0) if margin_val > 0 else 0.0

            # 1. TAKE PROFIT (TP)
            target_tp_usdt = None
            if getattr(self, 'take_profit_usdt', None) and self.take_profit_usdt > Decimal('0'):
                target_tp_usdt = float(self.take_profit_usdt)
            elif getattr(self, 'support_order_take_profit_percent', 0) > 0:
                target_tp_usdt = round(pos_val_usdt * (float(self.support_order_take_profit_percent) / 100.0), 4)

            tp_progress = None
            tp_remaining = None
            if target_tp_usdt and target_tp_usdt > 0:
                tp_progress = max(0.0, min(100.0, (pnl_usdt_val / target_tp_usdt) * 100.0))
                tp_remaining = max(0.0, target_tp_usdt - pnl_usdt_val)

            # 2. STOP LOSS (SL)
            target_sl_usdt = None
            if getattr(self, 'stop_loss_usdt', None) and abs(self.stop_loss_usdt) > Decimal('0'):
                target_sl_usdt = -abs(float(self.stop_loss_usdt))
            elif getattr(self, 'support_order_stop_loss_percent', 0) > 0:
                target_sl_usdt = -round(pos_val_usdt * (float(self.support_order_stop_loss_percent) / 100.0), 4)

            sl_distance = None
            safety_pct = 100.0
            sl_status = "safe"
            if target_sl_usdt is not None:
                sl_amount = abs(target_sl_usdt)
                sl_distance = pnl_usdt_val - target_sl_usdt
                if pnl_usdt_val >= 0:
                    safety_pct = 100.0
                    sl_status = "safe"
                else:
                    safety_pct = max(0.0, min(100.0, (sl_distance / sl_amount) * 100.0)) if sl_amount > 0 else 0.0
                    if safety_pct >= 50.0:
                        sl_status = "caution"
                    elif safety_pct >= 25.0:
                        sl_status = "warning"
                    else:
                        sl_status = "critical"

            # 3. TRAILING STOP (TS)
            enable_pnl_ts = bool(getattr(self, 'enable_pnl_trailing_stop', False))
            enable_price_ts = bool(getattr(self, 'enable_price_trailing_stop', False))
            enable_rsi_ts = bool(getattr(self, 'enable_trailing_rsi_stop', False))
            ts_enabled = enable_pnl_ts or enable_price_ts or enable_rsi_ts

            # CRÍTICO: Un Trailing Stop NUNCA puede estar armado si el PnL no es estrictamente positivo (> 0)
            pnl_ts_armed = bool(getattr(self, 'pnl_trailing_stop_armed', False)) and (pnl_usdt_val > 0)
            price_ts_armed = bool(getattr(self, 'price_trailing_stop_armed', False)) and (pnl_usdt_val > 0)
            rsi_ts_armed = bool(getattr(self, 'rsi_objetivo_activado', False)) and enable_rsi_ts and (pnl_usdt_val > 0)
            any_armed = pnl_ts_armed or price_ts_armed or rsi_ts_armed

            ts_diag = {
                "enabled": ts_enabled,
                "armed": any_armed,
                "type": "none",
                "label": "Inactivo",
                "activation_threshold": None,
                "arm_progress_pct": None,
                "peak_value": None,
                "floor_value": None,
                "tolerance_value": None,
                "tolerance_pct": None,
            }

            if ts_enabled:
                # Prioridad 1: PnL Trailing Stop (en USDT, compatible directo con TP)
                if enable_pnl_ts or pnl_ts_armed:
                    ts_diag["type"] = "pnl"
                    act_val = float(getattr(self, 'pnl_trailing_stop_activation_usdt', 0) or 0)
                    if act_val <= 0 and target_tp_usdt and target_tp_usdt > 0:
                        act_val = round(target_tp_usdt * 0.7, 2)
                    drop_val = float(getattr(self, 'pnl_trailing_stop_drop_usdt', 0) or 0)
                    if drop_val <= 0 and act_val > 0:
                        drop_val = round(act_val * 0.2, 2)

                    ts_diag["activation_threshold"] = act_val
                    ts_diag["armed"] = pnl_ts_armed

                    if pnl_ts_armed:
                        peak_pnl = float(self.pnl_peak_since_activation) if getattr(self, 'pnl_peak_since_activation', None) is not None else pnl_usdt_val
                        if pnl_usdt_val > peak_pnl:
                            peak_pnl = pnl_usdt_val
                        floor_pnl = max(0.0, peak_pnl - drop_val)
                        tolerance_val = max(0.0, pnl_usdt_val - floor_pnl)
                        tolerance_pct = max(0.0, min(100.0, (tolerance_val / drop_val * 100.0))) if drop_val > 0 else 100.0

                        ts_diag["peak_value"] = round(peak_pnl, 2)
                        ts_diag["floor_value"] = round(floor_pnl, 2)
                        ts_diag["tolerance_value"] = round(tolerance_val, 2)
                        ts_diag["tolerance_pct"] = round(tolerance_pct, 1)
                        ts_diag["label"] = f"Piso: +{floor_pnl:.2f} USDT"
                    else:
                        arm_prog = max(0.0, min(100.0, (pnl_usdt_val / act_val * 100.0))) if (act_val > 0 and pnl_usdt_val > 0) else 0.0
                        ts_diag["arm_progress_pct"] = round(arm_prog, 1)
                        ts_diag["label"] = f"Arma en: +{act_val:.2f} USDT"

                elif enable_price_ts or price_ts_armed:
                    ts_diag["type"] = "price"
                    act_pnl = float(getattr(self, 'price_trailing_stop_activation_pnl_usdt', 0.05) or 0.05)
                    dist_pr = float(getattr(self, 'price_trailing_stop_distance_usdt', 0.05) or 0.05)
                    ts_diag["activation_threshold"] = act_pnl
                    ts_diag["armed"] = price_ts_armed

                    if price_ts_armed:
                        is_short = (self.trade_side == 'SHORT')
                        curr_pr = float(current_market_price) if current_market_price else entry_p_val
                        if is_short:
                            trough_pr = float(self.price_trough_since_entry) if getattr(self, 'price_trough_since_entry', None) is not None else entry_p_val
                            if curr_pr < trough_pr:
                                trough_pr = curr_pr
                            ceiling_pr = trough_pr + dist_pr
                            tolerance_val = max(0.0, ceiling_pr - curr_pr)
                            tolerance_pct = max(0.0, min(100.0, (tolerance_val / dist_pr * 100.0))) if dist_pr > 0 else 100.0

                            ts_diag["peak_value"] = round(trough_pr, 4)
                            ts_diag["floor_value"] = round(ceiling_pr, 4)
                            ts_diag["tolerance_value"] = round(tolerance_val, 4)
                            ts_diag["tolerance_pct"] = round(tolerance_pct, 1)
                            ts_diag["label"] = f"Techo: ${ceiling_pr:.4f}"
                        else:
                            peak_pr = float(self.price_peak_since_entry) if getattr(self, 'price_peak_since_entry', None) is not None else entry_p_val
                            if curr_pr > peak_pr:
                                peak_pr = curr_pr
                            floor_pr = peak_pr - dist_pr
                            tolerance_val = max(0.0, curr_pr - floor_pr)
                            tolerance_pct = max(0.0, min(100.0, (tolerance_val / dist_pr * 100.0))) if dist_pr > 0 else 100.0

                            ts_diag["peak_value"] = round(peak_pr, 4)
                            ts_diag["floor_value"] = round(floor_pr, 4)
                            ts_diag["tolerance_value"] = round(tolerance_val, 4)
                            ts_diag["tolerance_pct"] = round(tolerance_pct, 1)
                            ts_diag["label"] = f"Piso: ${floor_pr:.4f}"
                    else:
                        arm_prog = max(0.0, min(100.0, (pnl_usdt_val / act_pnl * 100.0))) if (act_pnl > 0 and pnl_usdt_val > 0) else 0.0
                        ts_diag["arm_progress_pct"] = round(arm_prog, 1)
                        ts_diag["label"] = f"Arma en: +{act_pnl:.2f} USDT"

                elif enable_rsi_ts:
                    ts_diag["type"] = "rsi"
                    ts_diag["armed"] = rsi_ts_armed
                    act_rsi = float(getattr(self, 'rsi_target', 70))
                    ts_diag["activation_threshold"] = act_rsi
                    is_short = (self.trade_side == 'SHORT')
                    if rsi_ts_armed:
                        curr_rsi = float(self.last_rsi_value) if getattr(self, 'last_rsi_value', None) is not None else act_rsi
                        drop_rsi = abs(float(getattr(self, 'rsi_threshold_down', -5)))
                        if is_short:
                            trough_rsi = float(self.rsi_trough_since_target) if getattr(self, 'rsi_trough_since_target', None) is not None else act_rsi
                            ceiling_rsi = trough_rsi + drop_rsi
                            tolerance_val = max(0.0, ceiling_rsi - curr_rsi)
                            tolerance_pct = max(0.0, min(100.0, (tolerance_val / drop_rsi * 100.0))) if drop_rsi > 0 else 100.0
                            ts_diag["peak_value"] = round(trough_rsi, 1)
                            ts_diag["floor_value"] = round(ceiling_rsi, 1)
                            ts_diag["tolerance_value"] = round(tolerance_val, 1)
                            ts_diag["tolerance_pct"] = round(tolerance_pct, 1)
                            ts_diag["label"] = f"Corte RSI: {ceiling_rsi:.1f}"
                        else:
                            peak_rsi = float(self.rsi_peak_since_target) if getattr(self, 'rsi_peak_since_target', None) is not None else act_rsi
                            floor_rsi = peak_rsi - drop_rsi
                            tolerance_val = max(0.0, curr_rsi - floor_rsi)
                            tolerance_pct = max(0.0, min(100.0, (tolerance_val / drop_rsi * 100.0))) if drop_rsi > 0 else 100.0
                            ts_diag["peak_value"] = round(peak_rsi, 1)
                            ts_diag["floor_value"] = round(floor_rsi, 1)
                            ts_diag["tolerance_value"] = round(tolerance_val, 1)
                            ts_diag["tolerance_pct"] = round(tolerance_pct, 1)
                            ts_diag["label"] = f"Corte RSI: {floor_rsi:.1f}"
                    else:
                        curr_rsi = float(self.last_rsi_value) if getattr(self, 'last_rsi_value', None) is not None else 0.0
                        if is_short:
                            arm_prog = max(0.0, min(100.0, ((100.0 - curr_rsi) / (100.0 - act_rsi) * 100.0))) if act_rsi < 100 else 0.0
                        else:
                            arm_prog = max(0.0, min(100.0, (curr_rsi / act_rsi * 100.0))) if act_rsi > 0 else 0.0
                        ts_diag["arm_progress_pct"] = round(arm_prog, 1)
                        ts_diag["label"] = f"Arma RSI: {act_rsi:.0f}"

            diag = {
                "in_position": True,
                "pnl_usdt": round(pnl_usdt_val, 4),
                "pnl_pct": round(pnl_pct_val, 2),
                "entry_price": entry_p_val,
                "position_value_usdt": round(pos_val_usdt, 2),
                "margin_usdt": round(margin_val, 2),
                "tp": {
                    "target_usdt": round(target_tp_usdt, 4) if target_tp_usdt is not None else None,
                    "progress_pct": round(tp_progress, 1) if tp_progress is not None else None,
                    "remaining_usdt": round(tp_remaining, 4) if tp_remaining is not None else None,
                    "hit": bool(target_tp_usdt and pnl_usdt_val >= target_tp_usdt)
                },
                "sl": {
                    "target_usdt": round(target_sl_usdt, 4) if target_sl_usdt is not None else None,
                    "distance_usdt": round(sl_distance, 4) if sl_distance is not None else None,
                    "safety_pct": round(safety_pct, 1),
                    "status": sl_status
                },
                "ts": ts_diag,
                # Claves retrocompatibles
                "tp_target_usdt": round(target_tp_usdt, 4) if target_tp_usdt is not None else None,
                "tp_progress_pct": round(tp_progress, 1) if tp_progress is not None else None,
                "sl_target_usdt": round(target_sl_usdt, 4) if target_sl_usdt is not None else None,
                "sl_distance_usdt": round(sl_distance, 4) if sl_distance is not None else None,
                "trailing_active": ts_diag["enabled"],
                "trailing_armed": ts_diag["armed"],
                "timestamp": int(time.time() * 1000)
            }
            return diag
        except Exception as e:
            self.logger.warning(f"[{self.symbol}] Error en _calculate_position_diagnostics: {e}")
            return {}


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

    def _check_downtrend_candles(self, klines_df: pd.DataFrame) -> tuple[bool, int, int]:
        """
        Verifica si en la ventana de W velas recientes hay R o más velas rojas (close < open).
        Retorna (is_blocked, red_count, window_size).
        is_blocked = True significa que DEBE BLOQUEAR la compra.
        """
        window_size = max(1, getattr(self, 'downtrend_candles_window', 5))
        threshold_red = getattr(self, 'downtrend_check_candles', 3)

        if not getattr(self, 'evaluate_downtrend_candles_block', True):
            return False, 0, window_size

        if threshold_red <= 0:
            return False, 0, window_size

        if klines_df is None or len(klines_df) < window_size + 1:
            self.logger.warning(f"[{self.symbol}] No hay suficientes klines ({len(klines_df) if klines_df is not None else 0}) para ventana de {window_size} velas.")
            return False, 0, window_size

        # Analizar las últimas 'window_size' velas cerradas (excluyendo la vela actual en curso iloc[-1])
        recent_closed = klines_df.iloc[-(window_size + 1):-1]
        
        adverse_count = 0
        is_short = (getattr(self, 'trade_side', 'LONG') == 'SHORT')
        for _, row in recent_closed.iterrows():
            try:
                c_open = float(row['open'])
                c_close = float(row['close'])
                if is_short:
                    if c_close > c_open: # Vela verde (alcista, adversa para entrar en SHORT)
                        adverse_count += 1
                else:
                    if c_close < c_open: # Vela roja (bajista, adversa para entrar en LONG)
                        adverse_count += 1
            except Exception:
                pass

        is_blocked = (adverse_count >= threshold_red)
        candle_type_str = "verdes" if is_short else "rojas"
        filter_name = "ANTI-PUMP" if is_short else "ANTI-CASCADA"
        if is_blocked:
            self.logger.info(f"[{self.symbol}][{self.trade_side}] BLOQUEO {filter_name}: {adverse_count}/{window_size} velas {candle_type_str} en la ventana (umbral para bloquear: {threshold_red}). Entrada bloqueada.")
        else:
            self.logger.debug(f"[{self.symbol}][{self.trade_side}] Filtro velas {candle_type_str} OK: {adverse_count}/{window_size} velas {candle_type_str} (límite bloqueo: {threshold_red}).")

        return is_blocked, adverse_count, window_size

    def _is_recent_downtrend(self, klines_df: pd.DataFrame) -> bool:
        """Compatibilidad hacia atrás: True si está bloqueado por velas rojas."""
        is_blocked, _, _ = self._check_downtrend_candles(klines_df)
        return is_blocked

    def _calculate_tp_sl_prices(self) -> tuple[Decimal | None, Decimal | None]:
        """
        Calcula los precios de Take Profit y Stop Loss basados en la configuración y el precio de entrada.
        Maneja tanto posiciones LONG como SHORT de manera simétrica.
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

        is_short = (getattr(self, 'trade_side', 'LONG') == 'SHORT')

        tp_price = None
        # 1. Take Profit por PnL en USDT
        if self.take_profit_usdt > Decimal('0'):
            profit_per_unit = self.take_profit_usdt / quantity
            if is_short:
                tp_price_calculated = entry_price - profit_per_unit
            else:
                tp_price_calculated = entry_price + profit_per_unit
            tp_price = self._adjust_price(tp_price_calculated)
            self.logger.info(f"[{self.symbol}] Precio TP calculado ({'SHORT' if is_short else 'LONG'}, USDT): {tp_price_calculated:.8f} -> Ajustado: {tp_price:.8f} (Base: Entrada={entry_price}, TP_USDT={self.take_profit_usdt})")
        # 2. Take Profit por Porcentaje (ej: Estrategia de Soportes)
        elif self.support_order_take_profit_percent > 0:
            tp_pct = Decimal(str(self.support_order_take_profit_percent)) / Decimal('100')
            if is_short:
                tp_price_calculated = entry_price * (Decimal('1') - tp_pct)
            else:
                tp_price_calculated = entry_price * (Decimal('1') + tp_pct)
            tp_price = self._adjust_price(tp_price_calculated)
            self.logger.info(f"[{self.symbol}] Precio TP calculado ({'SHORT' if is_short else 'LONG'}, {self.support_order_take_profit_percent}%): {tp_price_calculated:.8f} -> Ajustado: {tp_price:.8f}")

        sl_price = None
        # 1. Stop Loss por PnL en USDT
        if self.stop_loss_usdt != Decimal('0'):
            sl_amount_usdt = abs(self.stop_loss_usdt)
            loss_per_unit = sl_amount_usdt / quantity
            if is_short:
                sl_price_calculated = entry_price + loss_per_unit
            else:
                sl_price_calculated = entry_price - loss_per_unit
            sl_price = self._adjust_price(sl_price_calculated)
            self.logger.info(f"[{self.symbol}] Precio SL calculado ({'SHORT' if is_short else 'LONG'}, USDT): {sl_price_calculated:.8f} -> Ajustado: {sl_price:.8f} (Base: Entrada={entry_price}, SL_USDT={sl_amount_usdt})")
        # 2. Stop Loss por Porcentaje (ej: Estrategia de Soportes)
        elif self.support_order_stop_loss_percent > 0:
            sl_pct = Decimal(str(self.support_order_stop_loss_percent)) / Decimal('100')
            if is_short:
                sl_price_calculated = entry_price * (Decimal('1') + sl_pct)
            else:
                sl_price_calculated = entry_price * (Decimal('1') - sl_pct)
            sl_price = self._adjust_price(sl_price_calculated)
            self.logger.info(f"[{self.symbol}] Precio SL calculado ({'SHORT' if is_short else 'LONG'}, {self.support_order_stop_loss_percent}%): {sl_price_calculated:.8f} -> Ajustado: {sl_price:.8f}")

        if is_short:
            if sl_price and sl_price <= entry_price:
                self.logger.warning(f"[{self.symbol}] Precio SL calculado ({sl_price}) es <= precio de entrada SHORT ({entry_price}). SL no se colocará.")
                sl_price = None
        else:
            if sl_price and sl_price >= entry_price:
                self.logger.warning(f"[{self.symbol}] Precio SL calculado ({sl_price}) es >= precio de entrada LONG ({entry_price}). SL no se colocará.")
                sl_price = None

        return tp_price, sl_price

    def _place_tp_sl_orders(self):
        """
        Coloca órdenes Take Profit y Stop Loss después de que una entrada se haya llenado.
        Usa TAKE_PROFIT_MARKET y STOP_MARKET respetando el trade_side ('LONG' o 'SHORT').
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
        is_short = (getattr(self, 'trade_side', 'LONG') == 'SHORT')
        close_side = 'BUY' if is_short else 'SELL'
        pos_side = 'SHORT' if is_short else 'LONG'

        # Colocar orden Take Profit
        tp_enabled = self.enable_take_profit_pnl or (self.support_order_take_profit_percent > 0)
        if tp_enabled and tp_price_dec and (self.take_profit_usdt > Decimal('0') or self.support_order_take_profit_percent > 0):
            tp_price_str = f"{tp_price_dec:.{self.price_tick_size.as_tuple().exponent * -1}f}"
            self.logger.info(f"[{self.symbol}] Intentando colocar orden TAKE_PROFIT_MARKET @ {tp_price_str} para cantidad {quantity_float} (Side={close_side}, PosSide={pos_side})")
            tp_order_result = create_futures_take_profit_order(
                symbol=self.symbol,
                side=close_side,
                quantity=quantity_float,
                take_profit_price=tp_price_str,
                close_position=True,
                position_side=pos_side
            )
            if tp_order_result and tp_order_result.get('orderId'):
                self.pending_tp_order_id = tp_order_result['orderId']
                self.logger.info(f"[{self.symbol}] Orden TAKE_PROFIT_MARKET {self.pending_tp_order_id} colocada @ {tp_price_str}.")
            else:
                self.logger.error(f"[{self.symbol}] Fallo al colocar la orden TAKE_PROFIT_MARKET @ {tp_price_str}. Respuesta: {tp_order_result}")
        elif not tp_enabled:
            self.logger.info(f"[{self.symbol}] Colocación de orden Take Profit DESHABILITADA por configuración.")

        # Colocar orden Stop Loss
        sl_enabled = self.enable_stop_loss_pnl or (self.support_order_stop_loss_percent > 0)
        if sl_enabled and sl_price_dec and (self.stop_loss_usdt != Decimal('0') or self.support_order_stop_loss_percent > 0):
            sl_price_str = f"{sl_price_dec:.{self.price_tick_size.as_tuple().exponent * -1}f}"
            order_type = getattr(self, 'stop_loss_order_type', 'STOP_MARKET')
            trigger_type = getattr(self, 'stop_loss_trigger_type', 'MARK_PRICE')
            self.logger.info(f"[{self.symbol}] Intentando colocar orden {order_type} ({trigger_type}) @ {sl_price_str} para cantidad {quantity_float} (Side={close_side}, PosSide={pos_side})")
            sl_order_result = create_futures_stop_loss_order(
                symbol=self.symbol,
                side=close_side,
                quantity=quantity_float,
                stop_loss_price=sl_price_str,
                close_position=True,
                order_type=order_type,
                trigger_type=trigger_type,
                position_side=pos_side
            )
            if sl_order_result and sl_order_result.get('orderId'):
                self.pending_sl_order_id = sl_order_result['orderId']
                self.logger.info(f"[{self.symbol}] Orden {order_type} {self.pending_sl_order_id} colocada @ {sl_price_str} ({trigger_type}).")
            else:
                self.logger.error(f"[{self.symbol}] Fallo al colocar la orden {order_type} @ {sl_price_str}. Respuesta: {sl_order_result}")
        elif not sl_enabled:
            self.logger.info(f"[{self.symbol}] Colocación de orden Stop Loss DESHABILITADA por configuración.")

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

    def _check_btc_market_crash(self) -> tuple[bool, float]:
        """
        Verifica si BTCUSDT ha experimentado una caída brusca en el marco temporal configurado.
        Utiliza una caché con TTL de 20 segundos para evitar llamadas excesivas a la API entre workers.
        """
        global _btc_crash_cache
        now = time.time()
        timeframe = getattr(self, 'btc_crash_timeframe', '15m') or '15m'
        drop_threshold = float(getattr(self, 'btc_crash_drop_percent', 2.0) or 2.0)

        if (now - _btc_crash_cache['timestamp'] < 20.0) and (_btc_crash_cache['timeframe'] == timeframe):
            return _btc_crash_cache['drop_detected'], _btc_crash_cache['drop_percent']

        try:
            from src.binance_client import get_historical_klines
            btc_klines = get_historical_klines('BTCUSDT', timeframe, limit=3)
            if btc_klines is None or btc_klines.empty:
                return False, 0.0

            drop_pct = 0.0
            for idx in [-1, -2]:
                if len(btc_klines) >= abs(idx):
                    candle = btc_klines.iloc[idx]
                    c_open = float(candle['open'])
                    c_close = float(candle['close'])
                    c_low = float(candle.get('low', c_close))
                    if c_open > 0:
                        c_drop = max(0.0, (c_open - min(c_close, c_low)) / c_open * 100.0)
                        if c_drop > drop_pct:
                            drop_pct = c_drop

            is_crash = drop_pct >= drop_threshold
            _btc_crash_cache['timestamp'] = now
            _btc_crash_cache['timeframe'] = timeframe
            _btc_crash_cache['drop_detected'] = is_crash
            _btc_crash_cache['drop_percent'] = drop_pct
            return is_crash, drop_pct
        except Exception as e:
            self.logger.warning(f"[{self.symbol}] Error al verificar desplome de BTC: {e}")
            return False, 0.0

    def _evaluate_htf_trend_for_symbol(self, target_symbol: str) -> tuple[bool, str, float]:
        """
        Evalúa si target_symbol está en tendencia alcista en su marco temporal mayor (HTF).
        Utiliza _market_regime_cache con TTL de 45 segundos para no saturar la API de Binance.
        Retorna (is_bullish, detail_text, indicator_value).
        """
        global _market_regime_cache
        now = time.time()
        tf = getattr(self, 'market_regime_timeframe', '1h') or '1h'
        ind = getattr(self, 'market_regime_indicator', 'supertrend') or 'supertrend'
        ema_p = int(getattr(self, 'market_regime_ema_period', 50) or 50)
        st_p = int(getattr(self, 'market_regime_supertrend_period', 10) or 10)
        st_m = float(getattr(self, 'market_regime_supertrend_multiplier', 3.0) or 3.0)

        cache_key = f"{target_symbol}_{tf}_{ind}_{ema_p if ind == 'ema' else f'{st_p}_{st_m}'}"
        cached = _market_regime_cache.get(cache_key)
        if cached and (now - cached['timestamp'] < 45.0):
            return cached['is_bullish'], cached['detail'], cached['value']

        try:
            from src.binance_client import get_historical_klines
            limit_needed = max(ema_p + 15, st_p + 25, 60)
            klines = get_historical_klines(target_symbol, tf, limit=limit_needed)
            if klines is None or klines.empty or len(klines) < 15:
                if cached:
                    return cached['is_bullish'], cached['detail'], cached['value']
                return True, f"{target_symbol}: Sin datos HTF", 0.0

            if ind == 'ema':
                from src.rsi_calculator import calculate_ema
                ema_series = calculate_ema(klines['close'], period=ema_p)
                if ema_series is None or ema_series.empty or pd.isna(ema_series.iloc[-1]):
                    return True, f"{target_symbol}: Error EMA", 0.0
                last_close = float(klines['close'].iloc[-1])
                ema_val = float(ema_series.iloc[-1])
                is_bull = (last_close >= ema_val)
                detail = f"{target_symbol} {tf}: {'🟢' if is_bull else '🔴'} ({last_close:.4f} vs EMA{ema_p}: {ema_val:.4f})"
                val = ema_val
            else:
                from src.rsi_calculator import calculate_supertrend
                st_df = calculate_supertrend(klines, period=st_p, multiplier=st_m)
                if st_df is None or st_df.empty:
                    return True, f"{target_symbol}: Error SuperTrend", 0.0
                is_bull = bool(st_df['is_bullish'].iloc[-1])
                st_val = float(st_df['supertrend'].iloc[-1])
                detail = f"{target_symbol} {tf}: {'🟢 Alcista' if is_bull else '🔴 Bajista'} (SuperTrend: {st_val:.4f})"
                val = st_val

            _market_regime_cache[cache_key] = {
                'timestamp': now,
                'is_bullish': is_bull,
                'detail': detail,
                'value': val
            }
            return is_bull, detail, val
        except Exception as e:
            self.logger.warning(f"[{self.symbol}] Error al evaluar tendencia HTF para {target_symbol}: {e}")
            if cached:
                return cached['is_bullish'], cached['detail'], cached['value']
            return True, f"{target_symbol}: Error", 0.0

    def _check_market_regime(self) -> tuple[bool, str, dict]:
        """
        Evalúa el régimen de mercado general según el modo configurado:
        - 'symbol': Evalúa la tendencia HTF de la propia moneda.
        - 'btc': Evalúa la tendencia HTF de BTCUSDT.
        - 'both': Exige que AMBOS (BTC y la propia moneda) estén alcistas.
        Retorna (is_passed, summary_text, details_dict).
        """
        if not getattr(self, 'enable_market_regime_filter', False):
            return True, "Filtro desactivado", {}

        mode = str(getattr(self, 'market_regime_mode', 'symbol')).lower()
        eval_symbol = (mode in ['symbol', 'both'])
        eval_btc = (mode in ['btc', 'both'])

        sym_bull, sym_detail, sym_val = (True, "", 0.0)
        btc_bull, btc_detail, btc_val = (True, "", 0.0)

        if eval_symbol:
            sym_bull, sym_detail, sym_val = self._evaluate_htf_trend_for_symbol(self.symbol)
        if eval_btc:
            btc_bull, btc_detail, btc_val = self._evaluate_htf_trend_for_symbol('BTCUSDT')

        is_short = (getattr(self, 'trade_side', 'LONG') == 'SHORT')
        if is_short:
            is_passed = ((not sym_bull if eval_symbol else True) and (not btc_bull if eval_btc else True))
            if mode == 'both':
                summary = f"BTC: {'🔴 Bajista' if not btc_bull else '🟢 Alcista'} | {self.symbol}: {'🔴 Bajista' if not sym_bull else '🟢 Alcista'}"
            elif mode == 'btc':
                summary = f"BTC: {'🔴 Bajista' if not btc_bull else '🟢 Alcista'}"
            else:
                summary = f"{self.symbol}: {'🔴 Bajista' if not sym_bull else '🟢 Alcista'}"
        else:
            is_passed = ((sym_bull if eval_symbol else True) and (btc_bull if eval_btc else True))
            if mode == 'both':
                summary = f"BTC: {'🟢 Alcista' if btc_bull else '🔴 Bajista'} | {self.symbol}: {'🟢 Alcista' if sym_bull else '🔴 Bajista'}"
            elif mode == 'btc':
                summary = f"BTC: {'🟢 Alcista' if btc_bull else '🔴 Bajista'}"
            else:
                summary = f"{self.symbol}: {'🟢 Alcista' if sym_bull else '🔴 Bajista'}"

        details = {
            'mode': mode,
            'passed': is_passed,
            'sym_bullish': sym_bull,
            'btc_bullish': btc_bull,
            'sym_detail': sym_detail,
            'btc_detail': btc_detail,
            'summary': summary
        }

        if not is_passed:
            self.logger.info(f"[{self.symbol}][{self.trade_side}] BLOQUEO RÉGIMEN DE MERCADO: {summary}. Nueva entrada {self.trade_side} bloqueada.")
        else:
            self.logger.debug(f"[{self.symbol}][{self.trade_side}] Régimen de mercado OK: {summary}.")

        return is_passed, summary, details

    def _check_risk_circuit_breakers(self) -> bool:
        """
        Evalúa los 4 mecanismos de protección de riesgo antes de permitir una nueva entrada.
        Retorna True si el bot debe permanecer o entrar en PAUSA, impidiendo nuevas órdenes.
        Garantiza que entry_diagnostics refleje de inmediato el estado de pausa/cooldown para no emitir señales falsas.
        """
        now = time.time()

        def _set_paused_diagnostics(reason: str, cooldown_secs: int = 0):
            self.entry_diagnostics = {
                "strategy": getattr(self, 'strategy_name', 'RSI Momentum') or 'RSI Momentum',
                "trade_side": getattr(self, 'trade_side', 'LONG'),
                "passed_count": 0,
                "total_active": 0,
                "ratio_text": "0/0",
                "all_met": False,
                "summary": reason,
                "conditions": [],
                "is_paused": True,
                "pause_reason": reason,
                "cooldown_remaining_seconds": max(0, int(cooldown_secs)),
                "timestamp": int(time.time() * 1000)
            }

        # 0. Si está en Cooldown activo, verificar si ya expiró
        if getattr(self, 'cooldown_until_ts', 0.0) > 0.0:
            if now < self.cooldown_until_ts:
                remaining_m = max(1, int((self.cooldown_until_ts - now) / 60))
                remaining_s = max(0, int(self.cooldown_until_ts - now))
                self.logger.info(f"[{self.symbol}][{self.trade_side}] ⏳ Bot en periodo de enfriamiento ({remaining_m}m restantes). Motivo: {self.pause_reason}")
                self.is_paused = True
                self._update_state(BotState.PAUSED)
                _set_paused_diagnostics(self.pause_reason, remaining_s)
                return True
            else:
                self.logger.info(f"[{self.symbol}][{self.trade_side}] 🟢 Periodo de enfriamiento finalizado. Reanudando operaciones normales.")
                self.cooldown_until_ts = 0.0
                self.pause_reason = ""
                self.is_paused = False
                self._update_state(BotState.IDLE)
                self.entry_diagnostics = self._build_default_entry_diagnostics()

        # 1. MECANISMO 1: Hard Stop por Pérdida Máxima de la Sesión
        if getattr(self, 'enable_max_loss_per_symbol', False) and getattr(self, 'max_loss_per_symbol_usdt', Decimal('0')) > Decimal('0'):
            limit_neg = -abs(self.max_loss_per_symbol_usdt)
            if getattr(self, 'session_pnl', Decimal('0')) <= limit_neg:
                self.pause_reason = f"🛑 Hard Stop: Pérdida en sesión ({float(self.session_pnl):.2f} USDT <= -{float(self.max_loss_per_symbol_usdt):.2f} USDT). Requiere reactivación manual."
                self.logger.warning(f"[{self.symbol}][{self.trade_side}] {self.pause_reason}")
                self.is_paused = True
                self._update_state(BotState.PAUSED)
                _set_paused_diagnostics(self.pause_reason, 0)
                return True

        # 2. MECANISMO 2: Racha de pérdidas consecutivas
        if getattr(self, 'enable_consecutive_losses_cooldown', False) and getattr(self, 'max_consecutive_losses', 0) > 0:
            if getattr(self, 'consecutive_losses_count', 0) >= self.max_consecutive_losses:
                cooldown_secs = self.consecutive_losses_cooldown_minutes * 60
                self.cooldown_until_ts = now + cooldown_secs
                self.pause_reason = f"⏳ Enfriamiento por {self.consecutive_losses_count} pérdidas consecutivas (pausa {self.consecutive_losses_cooldown_minutes}m)"
                self.logger.warning(f"[{self.symbol}][{self.trade_side}] {self.pause_reason}")
                self.is_paused = True
                self._update_state(BotState.PAUSED)
                _set_paused_diagnostics(self.pause_reason, cooldown_secs)
                return True

        # 3. MECANISMO 3: Filtro de Rendimiento Reciente (Rolling Window)
        if getattr(self, 'enable_rolling_performance_filter', False) and getattr(self, 'rolling_trades_window', 0) > 0 and getattr(self, 'rolling_max_losses', 0) > 0:
            try:
                from src.database import get_last_n_trades_for_symbol
                recent_trades = get_last_n_trades_for_symbol(self.symbol, n=self.rolling_trades_window)
                if len(recent_trades) >= self.rolling_trades_window:
                    losses_in_window = sum(1 for t in recent_trades if float(t.get('pnl_usdt') or 0.0) < 0.0)
                    if losses_in_window >= self.rolling_max_losses:
                        cooldown_secs = self.rolling_filter_cooldown_minutes * 60
                        self.cooldown_until_ts = now + cooldown_secs
                        self.pause_reason = f"⏳ Filtro de Rendimiento: {losses_in_window}/{len(recent_trades)} pérdidas en últimos trades (pausa {self.rolling_filter_cooldown_minutes}m)"
                        self.logger.warning(f"[{self.symbol}][{self.trade_side}] {self.pause_reason}")
                        self.is_paused = True
                        self._update_state(BotState.PAUSED)
                        _set_paused_diagnostics(self.pause_reason, cooldown_secs)
                        return True
            except Exception as e_rf:
                self.logger.warning(f"[{self.symbol}][{self.trade_side}] Error al evaluar filtro de rendimiento reciente: {e_rf}")

        # 4. MECANISMO 4: Escudo de Desplome de Bitcoin (BTC Crash Shield)
        if getattr(self, 'enable_btc_crash_shield', False):
            is_btc_crashing, btc_drop_pct = self._check_btc_market_crash()
            if is_btc_crashing:
                cooldown_secs = self.btc_crash_shield_cooldown_minutes * 60
                self.cooldown_until_ts = now + cooldown_secs
                self.pause_reason = f"🛡️ Escudo BTC: Desplome de -{btc_drop_pct:.2f}% en BTCUSDT ({self.btc_crash_timeframe}) (pausa {self.btc_crash_shield_cooldown_minutes}m)"
                self.logger.warning(f"[{self.symbol}][{self.trade_side}] {self.pause_reason}")
                self.is_paused = True
                self._update_state(BotState.PAUSED)
                _set_paused_diagnostics(self.pause_reason, cooldown_secs)
                return True

        return False

    def _on_trade_closed(self, final_pnl: Decimal | float, close_reason: str):
        """Actualiza contadores de racha de pérdidas y evalúa disparadores inmediatos de protección."""
        try:
            pnl_float = float(final_pnl)
            if pnl_float < -0.0001:
                self.consecutive_losses_count = getattr(self, 'consecutive_losses_count', 0) + 1
                self.logger.warning(f"[{self.symbol}][{self.trade_side}] Trade cerrado con pérdida ({pnl_float:.4f} USDT). Racha consecutiva: {self.consecutive_losses_count}")
                # Si se superó el límite de racha, activar cooldown de inmediato
                if getattr(self, 'enable_consecutive_losses_cooldown', False) and self.consecutive_losses_count >= getattr(self, 'max_consecutive_losses', 2):
                    cooldown_secs = self.consecutive_losses_cooldown_minutes * 60
                    self.cooldown_until_ts = time.time() + cooldown_secs
                    self.pause_reason = f"⏳ Enfriamiento por {self.consecutive_losses_count} pérdidas consecutivas (pausa {self.consecutive_losses_cooldown_minutes}m)"
                    self.is_paused = True
                    self._update_state(BotState.PAUSED)
                    self.entry_diagnostics = {
                        "strategy": getattr(self, 'strategy_name', 'RSI Momentum') or 'RSI Momentum',
                        "trade_side": getattr(self, 'trade_side', 'LONG'),
                        "passed_count": 0,
                        "total_active": 0,
                        "ratio_text": "0/0",
                        "all_met": False,
                        "summary": self.pause_reason,
                        "conditions": [],
                        "is_paused": True,
                        "pause_reason": self.pause_reason,
                        "cooldown_remaining_seconds": max(0, int(cooldown_secs)),
                        "timestamp": int(time.time() * 1000)
                    }
                    self.logger.warning(f"[{self.symbol}][{self.trade_side}] ACTIVADO: {self.pause_reason}")
            else:
                if getattr(self, 'consecutive_losses_count', 0) > 0:
                    self.logger.info(f"[{self.symbol}][{self.trade_side}] Trade positivo ({pnl_float:.4f} USDT). Racha de pérdidas consecutivas reseteada a 0.")
                self.consecutive_losses_count = 0

            # Evaluar Hard Stop inmediato por pérdida máxima en sesión
            if getattr(self, 'enable_max_loss_per_symbol', False) and getattr(self, 'max_loss_per_symbol_usdt', Decimal('0')) > Decimal('0'):
                if getattr(self, 'session_pnl', Decimal('0')) <= -abs(self.max_loss_per_symbol_usdt):
                    self.pause_reason = f"🛑 Hard Stop: Pérdida en sesión ({float(self.session_pnl):.2f} USDT) superó el límite (-{float(self.max_loss_per_symbol_usdt):.2f} USDT)."
                    self.is_paused = True
                    self._update_state(BotState.PAUSED)
                    self.entry_diagnostics = {
                        "strategy": getattr(self, 'strategy_name', 'RSI Momentum') or 'RSI Momentum',
                        "trade_side": getattr(self, 'trade_side', 'LONG'),
                        "passed_count": 0,
                        "total_active": 0,
                        "ratio_text": "0/0",
                        "all_met": False,
                        "summary": self.pause_reason,
                        "conditions": [],
                        "is_paused": True,
                        "pause_reason": self.pause_reason,
                        "cooldown_remaining_seconds": 0,
                        "timestamp": int(time.time() * 1000)
                    }
                    self.logger.warning(f"[{self.symbol}][{self.trade_side}] ACTIVADO: {self.pause_reason}")
        except Exception as e:
            self.logger.error(f"[{self.symbol}] Error en _on_trade_closed: {e}")

    def run_once(self):
        """
        Ejecuta un ciclo de la lógica del bot.
        """
        self.logger.info(f"[{self.symbol}] --- Inicio run_once. Estado: {self.current_state.value} (in_position={self.in_position}, pending_entry={self.pending_entry_order_id}) ---")
        
        try:
            # 0. Auto-recuperación si el bot quedó en estado ERROR
            if self.current_state == BotState.ERROR:
                self.logger.info(f"[{self.symbol}][{self.trade_side}] Bot en estado ERROR. Verificando estado en Binance para auto-recuperación...")
                self._verify_position_status()
                if not self.in_position and not self.pending_entry_order_id and not self.pending_exit_order_id:
                    self.logger.info(f"[{self.symbol}][{self.trade_side}] Sin posición ni órdenes pendientes en Binance. Auto-recuperando estado a IDLE.")
                    self.current_state = BotState.IDLE
                    self.state = BotState.IDLE
                    self.last_error_message = None

            # 1. Si hay una orden de entrada pendiente, verificar de inmediato si fue FILLED o CANCELED
            if self.pending_entry_order_id:
                self._check_pending_entry_order()

            # 2. Sincronización proactiva con Binance: si el bot cree no estar en posición ni tener orden pendiente,
            # verificar si existe una posición abierta real en Binance para sincronizarla automáticamente
            if not self.in_position and not self.pending_entry_order_id:
                self._verify_position_status()

            # 3. Si estamos en posición activa:
            if self.in_position:
                # 3a. Chequear si se ejecutó alguna orden TP o SL en Binance
                tp_sl_handled = self._check_tp_sl_order_status()
                if tp_sl_handled:
                    self.logger.info(f"[{self.symbol}] Orden TP/SL procesada en este ciclo.")
                    return

                # 3b. Actualizar el PNL en vivo y verificar si la posición continúa abierta
                is_still_open = self._update_open_position_pnl()
                if not is_still_open:
                    self.logger.info(f"[{self.symbol}] Posición cerrada en Binance. Pasando a IDLE.")
                    return

                # 3c. Si hay una orden de salida manual o de mercado pendiente, verificarla
                if self.pending_exit_order_id:
                    self._check_pending_exit_order()
                    return

                # 3d. Obtener velas para evaluar Trailing Stop o condiciones de salida técnicas
                klines_df = self._get_market_data()
                if klines_df is not None and not klines_df.empty:
                    c_price = float(klines_df.iloc[-1]['close'])
                    self.current_market_price = c_price
                    if self.price_peak_since_entry is None or c_price > float(self.price_peak_since_entry):
                        self.price_peak_since_entry = c_price
                    if self.price_trough_since_entry is None or c_price < float(self.price_trough_since_entry):
                        self.price_trough_since_entry = c_price
                    # Evaluar re-entradas DCA si el precio cae
                    self._evaluate_dca_reentry(klines_df)
                    # Evaluar condiciones de salida
                    self._check_exit_conditions(klines_df)
                return

            # 4. Si no hay posición ni orden pendiente, buscar nueva entrada
            if not self.in_position and not self.pending_entry_order_id:
                # Evaluar Circuit Breakers de Riesgo (Hard Stop, Cooldown, Filtro Rendimiento, Escudo BTC)
                if self._check_risk_circuit_breakers():
                    if self.active_support_orders:
                        for price, order_id in list(self.active_support_orders.items()):
                            cancel_futures_order(self.symbol, order_id)
                        self.active_support_orders.clear()
                    return

                if getattr(self, 'is_paused', False):
                    # Si el bot está pausado por el usuario, cancelar cualquier orden de soporte activa y omitir entradas
                    if self.active_support_orders:
                        for price, order_id in list(self.active_support_orders.items()):
                            cancel_futures_order(self.symbol, order_id)
                        self.active_support_orders.clear()
                    self._update_state(BotState.PAUSED)
                    self.entry_diagnostics = {
                        "strategy": getattr(self, 'strategy_name', 'RSI Momentum') or 'RSI Momentum',
                        "trade_side": getattr(self, 'trade_side', 'LONG'),
                        "passed_count": 0,
                        "total_active": 0,
                        "ratio_text": "0/0",
                        "all_met": False,
                        "summary": getattr(self, 'pause_reason', '') or '⏸️ Bot en pausa individual',
                        "conditions": [],
                        "is_paused": True,
                        "pause_reason": getattr(self, 'pause_reason', '') or 'Pausa manual',
                        "cooldown_remaining_seconds": 0,
                        "timestamp": int(time.time() * 1000)
                    }
                    self.logger.info(f"[{self.symbol}][{self.trade_side}] ⏸️ Bot en pausa individual. Omitiendo búsqueda de nuevas entradas.")
                    return

                klines_df = self._get_market_data()
                if klines_df is None or klines_df.empty:
                    return
                self.current_market_price = float(klines_df.iloc[-1]['close'])

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
        """Función auxiliar para obtener y validar los datos de klines con caché compartido."""
        if self.current_state == BotState.ERROR:
            self.logger.debug(f"[{self.symbol}] Saltando obtención de datos en estado ERROR")
            return None

        limit_needed = max(self.rsi_period + 15, self.volume_sma_period + 10, 50)
        if self.evaluate_ma_filter:
            limit_needed = max(limit_needed, self.ma_period + 10)
        if self.evaluate_support_strategy:
            limit_needed = max(limit_needed, self.support_history_candles + 10)
        
        final_limit = limit_needed
        self.logger.debug(f"[{self.symbol}] Límite de velas calculado: {final_limit}")
        
        now_ts = time.time()
        cache_key = (self.symbol, self.rsi_interval, final_limit)
        cached_entry = getattr(SingleSideTradingBot, '_klines_cache', {}).get(cache_key)
        if cached_entry and (now_ts - cached_entry['timestamp'] < 2.5):
            return cached_entry['data'].copy()

        klines_df = get_historical_klines(self.symbol, self.rsi_interval, limit=final_limit)

        if klines_df is None or klines_df.empty:
            self.logger.warning(f"[{self.symbol}] No se pudieron obtener klines. Saltando ciclo.")
            return None
        
        if not hasattr(SingleSideTradingBot, '_klines_cache'):
            SingleSideTradingBot._klines_cache = {}
        SingleSideTradingBot._klines_cache[cache_key] = {'timestamp': now_ts, 'data': klines_df}
        
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
                    if self.pending_entry_order_id == order_id:
                        self.pending_entry_order_id = None
                        self.pending_order_timestamp = None
                        self._update_state(BotState.IDLE)

            # 2. Obtener y confirmar nuevos niveles de soporte
            confirmed_supports = self._find_support_levels(klines_df)

            # Actualizar diagnóstico de entrada para la interfaz
            has_sup = bool(confirmed_supports)
            sup_str = f"{float(max(confirmed_supports)):.4f}" if has_sup else "Buscando..."
            self.entry_diagnostics = {
                "strategy": "Soportes",
                "passed_count": 1 if has_sup else 0,
                "total_active": 1,
                "ratio_text": "1/1" if has_sup else "0/1",
                "all_met": has_sup,
                "summary": f"🎯 Soporte: {sup_str}" if has_sup else "Buscando soportes",
                "conditions": [
                    {
                        "id": "support_level",
                        "name": "Nivel Soporte",
                        "short_name": "Soporte",
                        "active": True,
                        "passed": has_sup,
                        "value": sup_str,
                        "target": "Soporte Detectado",
                        "detail": f"Nivel soporte confirmado: {sup_str}" if has_sup else "Sin pivotes bajos suficientes"
                    }
                ],
                "timestamp": int(time.time() * 1000)
            }

            # 3. Decidir sobre la acción a tomar
            if confirmed_supports:
                best_support = max(confirmed_supports)
                
                # 3a. Cancelar órdenes activas que no estén en el mejor soporte
                for price_level in list(self.active_support_orders.keys()):
                    if price_level != best_support:
                        order_id = self.active_support_orders.pop(price_level)
                        self.logger.info(f"[{self.symbol}] Cancelando orden {order_id} en {price_level} porque no es el mejor soporte ({best_support}).")
                        cancel_futures_order(self.symbol, order_id)
                        if self.pending_entry_order_id == order_id:
                            self.pending_entry_order_id = None
                            self.pending_order_timestamp = None
                            self._update_state(BotState.IDLE)

                # 3b. Si no hay una orden ya en el mejor soporte, intentar colocar una
                if best_support not in self.active_support_orders:
                    notional_order_usdt = Decimal(str(self.position_size_usdt)) * Decimal(str(self.leverage))
                    if self.risk_manager.can_open_position(Decimal(str(self.position_size_usdt))):
                        quantity = notional_order_usdt / best_support
                        adj_qty = self._adjust_quantity(quantity)
                        if adj_qty and adj_qty > 0:
                            result = create_futures_limit_order(self.symbol, 'BUY', adj_qty, best_support)
                            if result and 'orderId' in result:
                                self.active_support_orders[best_support] = result['orderId']
                                self.pending_entry_order_id = result['orderId']
                                self.pending_order_timestamp = time.time()
                                self._update_state(BotState.WAITING_ENTRY_FILL)
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
                        if self.pending_entry_order_id == order_id:
                            self.pending_entry_order_id = None
                            self.pending_order_timestamp = None
                    self.active_support_orders.clear()
                    self._update_state(BotState.IDLE)

        except Exception as e:
            self.logger.error(f"[{self.symbol}] Error en _execute_support_strategy: {e}", exc_info=True)
            self._set_error_state(f"Error in support strategy: {e}")

    def _handle_successful_closure(self, close_price, quantity_closed, reason, close_timestamp=None, binance_order_id_of_closure: str | None = None):
        """
        Registra el trade completado en la DB y resetea el estado interno del bot para este símbolo.
        Intenta obtener PNL realizado de Binance; si falla, lo calcula manualmente.
        """
        if not self.current_position:
            self.logger.warning(f"[{self.symbol}] Posición interna no estaba en memoria al registrar cierre. Creando registro de respaldo.")
            self.current_position = {
                'entry_price': getattr(self, 'last_known_entry_price', Decimal('0')) or Decimal(str(close_price)),
                'quantity': Decimal(str(quantity_closed)),
                'entry_time': datetime.now()
            }

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

                        closing_side_api = 'BUY' if self.trade_side == 'SHORT' else 'SELL'
                        # Comparar orderId y lado (soporta ejecuciones divididas en múltiples fills)
                        if trade_order_id == str(binance_order_id_of_closure) and trade_side_api == closing_side_api:

                            pnl_from_api_str = trade_detail.get('realizedPnl')
                            if pnl_from_api_str is not None:
                                final_pnl = Decimal(pnl_from_api_str)
                                actual_binance_trade_id_for_db = int(trade_id_from_api)
                                self.logger.info(f"[{self.symbol}][{self.trade_side}] PNL de Binance OBTENIDO para orderId {binance_order_id_of_closure} (TradeID: {actual_binance_trade_id_for_db}): {final_pnl:.4f} USDT")
                                
                                # Actualizar close_price y close_timestamp con los datos del trade de Binance si son más precisos
                                api_close_price_str = trade_detail.get('price')
                                api_time_ms = trade_detail.get('time')
                                if api_close_price_str:
                                    close_price_dec = Decimal(api_close_price_str)
                                if api_time_ms and close_timestamp is None: # Solo actualizar si no teníamos uno más específico
                                    close_timestamp = pd.Timestamp.fromtimestamp(int(api_time_ms) / 1000, tz='UTC')
                                    self.logger.info(f"[{self.symbol}][{self.trade_side}] Precio/tiempo de cierre actualizados desde trade de Binance: Precio={close_price_dec}, Tiempo={close_timestamp}")
                                found_closing_trade_in_history = True
                                break # Encontramos el trade
                    if not found_closing_trade_in_history:
                         self.logger.warning(f"[{self.symbol}][{self.trade_side}] No se encontró un trade {closing_side_api} coincidente en el historial reciente de Binance para orderId {binance_order_id_of_closure}. Se usará PNL calculado.")
                else:
                    self.logger.warning(f"[{self.symbol}][{self.trade_side}] No se pudo obtener el historial de trades de Binance para buscar PNL para orderId {binance_order_id_of_closure}. Se usará PNL calculado.")
            except Exception as e_api_pnl:
                self.logger.error(f"[{self.symbol}][{self.trade_side}] Error intentando obtener PNL de Binance para orderId {binance_order_id_of_closure}: {e_api_pnl}. Se usará PNL calculado.", exc_info=True)
        else:
            self.logger.info(f"[{self.symbol}][{self.trade_side}] No se proporcionó binance_order_id_of_closure. Se intentará cálculo manual de PNL o búsqueda genérica si es un cierre externo.")

        # Fallback a cálculo manual si no se obtuvo PNL de Binance
        if final_pnl is None:
            if self.trade_side == 'SHORT':
                final_pnl = (entry_price - close_price_dec) * abs(quantity_dec)
            else:
                final_pnl = (close_price_dec - entry_price) * abs(quantity_dec)
            self.logger.info(f"[{self.symbol}][{self.trade_side}] PNL CALCULADO MANUALMENTE: {final_pnl:.4f} (Close: {close_price_dec}, Entry: {entry_price}, Qty: {quantity_dec})")
        else:
            self.logger.info(f"[{self.symbol}][{self.trade_side}] PNL FINAL (usando valor de Binance si se obtuvo): {final_pnl:.4f}")

        simplified_reason = reason
        if pd.isna(entry_time):
             entry_time = pd.Timestamp.now(tz='UTC') - pd.Timedelta(minutes=1)
             self.logger.warning(f"[{self.symbol}] Timestamp de entrada no era válido, usando valor estimado.")
             
        actual_close_timestamp = close_timestamp if close_timestamp else pd.Timestamp.now(tz='UTC')

        open_ts_for_db = entry_time.to_pydatetime() if pd.notna(entry_time) else None
        close_ts_for_db = actual_close_timestamp.to_pydatetime() if pd.notna(actual_close_timestamp) else None

        try:
            strat_to_record = getattr(self, 'strategy_name', '')
            if not strat_to_record or str(strat_to_record).strip().lower() == 'global':
                try:
                    from src.config_loader import get_strategy_for_symbol
                    strat_to_record = get_strategy_for_symbol(self.symbol)
                except Exception:
                    strat_to_record = 'v3_RSI-SNIPER-MOMENTUM_v3'
            db_trade_params = {
                'strategy_name': strat_to_record,
                'rsi_type': getattr(self, 'rsi_type', 'WILDER'),
                'rsi_interval': self.rsi_interval,
                'rsi_period': self.rsi_period,
                'rsi_threshold_up': self.rsi_threshold_up,
                'rsi_candles_window': getattr(self, 'rsi_candles_window', 3),
                'rsi_positive_candles_required': getattr(self, 'rsi_positive_candles_required', 2),
                'rsi_positive_delta_min': getattr(self, 'rsi_positive_delta_min', 0.0),
                'rsi_threshold_down': self.rsi_threshold_down,
                'rsi_entry_level_low': self.rsi_entry_level_low,
                'rsi_entry_level_high': self.rsi_entry_level_high,
                'position_size_usdt': float(self.position_size_usdt),
                'take_profit_usdt': float(self.take_profit_usdt),
                'stop_loss_usdt': float(self.stop_loss_usdt),
                'downtrend_check_candles': self.downtrend_check_candles,
                'downtrend_candles_window': self.downtrend_candles_window,
                'order_timeout_seconds': self.order_timeout_seconds,
                'entry_order_type': self.entry_order_type,
                'rsi_target': self.rsi_target,
                'enable_price_trailing_stop': self.enable_price_trailing_stop,
                'price_trailing_stop_distance_usdt': float(self.price_trailing_stop_distance_usdt),
                'price_trailing_stop_activation_pnl_usdt': float(self.price_trailing_stop_activation_pnl_usdt),
                'enable_pnl_trailing_stop': self.enable_pnl_trailing_stop,
                'pnl_trailing_stop_activation_usdt': float(self.pnl_trailing_stop_activation_usdt),
                'pnl_trailing_stop_drop_usdt': float(self.pnl_trailing_stop_drop_usdt)
            }

            entry_rate_dec = Decimal('0.0002') if str(self.entry_order_type).upper() == 'LIMIT' else Decimal('0.0005')
            exit_rate_dec = Decimal('0.0005')
            entry_notional_dec = entry_price * quantity_dec
            exit_notional_dec = close_price_dec * quantity_dec
            comm_dec = (entry_notional_dec * entry_rate_dec) + (exit_notional_dec * exit_rate_dec)
            gross_pnl_dec = final_pnl if final_pnl is not None else Decimal('0')
            net_pnl_dec = gross_pnl_dec - comm_dec

            self.logger.info(f"[{self.symbol}][{self.trade_side}] _handle_successful_closure: Intentando registrar con los siguientes datos -> "
                             f"Symbol: {self.symbol}, Strategy: {strat_to_record}, Type: {self.trade_side}, OpenTS: {open_ts_for_db}, CloseTS: {close_ts_for_db}, "
                             f"OpenPrice: {float(entry_price)}, ClosePrice: {float(close_price_dec)}, Qty: {float(quantity_dec)}, "
                             f"PosSizeUSDT: {float(position_size_usdt_est)}, PNL_Neto: {float(net_pnl_dec)}, PNL_Bruto: {float(gross_pnl_dec)}, "
                             f"Comision: {float(comm_dec)}, Reason: '{simplified_reason}', "
                             f"Params: {db_trade_params}, BinanceTradeID: {actual_binance_trade_id_for_db}")

            record_trade(
                symbol=self.symbol,
                trade_type=self.trade_side,
                open_timestamp=open_ts_for_db,
                close_timestamp=close_ts_for_db,
                open_price=float(entry_price),
                close_price=float(close_price_dec),
                quantity=float(abs(quantity_dec)),
                position_size_usdt=float(position_size_usdt_est),
                pnl_usdt=float(net_pnl_dec),
                gross_pnl_usdt=float(gross_pnl_dec),
                commission_usdt=float(comm_dec),
                close_reason=simplified_reason,
                parameters=db_trade_params,
                binance_trade_id=actual_binance_trade_id_for_db,
                strategy_name=strat_to_record
            )
            self.logger.info(f"[{self.symbol}][{self.trade_side}] _handle_successful_closure: Trade registrado exitosamente en DB (Neto: {net_pnl_dec:.4f}, Comisión: {comm_dec:.4f}).")
            if net_pnl_dec is not None:
                self.historical_pnl += net_pnl_dec
                self.session_pnl += net_pnl_dec
                self._on_trade_closed(net_pnl_dec, simplified_reason)
                self.logger.info(f"[{self.symbol}][{self.trade_side}] PnL neto acumulado tras cierre: Histórico={self.historical_pnl:.4f}, Sesión={self.session_pnl:.4f}")
        except Exception as e:
            self.logger.error(f"[{self.symbol}][{self.trade_side}] ERROR CRÍTICO en _handle_successful_closure al registrar el trade en la DB: {e}", exc_info=True)
            self.logger.error(f"[{self.symbol}][{self.trade_side}] Datos que se intentaron registrar: Symbol: {self.symbol}, Type: {self.trade_side}, OpenTS: {open_ts_for_db}, CloseTS: {close_ts_for_db}, "
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
        # --- NUEVO: Cancelar y limpiar órdenes de re-entrada DCA pendientes ---
        if self.pending_reentry_order_id:
            self.logger.info(f"[{self.symbol}] ResetState: Cancelando orden de re-entrada DCA pendiente {self.pending_reentry_order_id}.")
            try:
                cancel_futures_order(self.symbol, self.pending_reentry_order_id)
            except Exception as e:
                self.logger.warning(f"[{self.symbol}] Error cancelando orden DCA en reset_state: {e}")
            self.pending_reentry_order_id = None
            self.pending_reentry_price = None
            self.pending_reentry_qty = None
        self.reentries_done = 0
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
        # --- Limpiar diagnóstico de posición activa ---
        self.position_diagnostics = {}
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
             self.state = new_state
        if new_state == BotState.ERROR and error_message:
             self.last_error_message = error_message
             self.logger.error(f"[{self.symbol}] Error detail: {error_message}")
        elif new_state != BotState.ERROR:
             self.last_error_message = None # Limpiar mensaje de error si salimos del estado ERROR

    def get_current_status(self):
        """Devuelve un diccionario con el estado actual del bot para la API."""
        st = self.current_state.value if hasattr(self, 'current_state') and self.current_state else (self.state.value if hasattr(self, 'state') and self.state else "UNKNOWN")
        return {
            'symbol': self.symbol,
            'trade_side': getattr(self, 'trade_side', 'LONG'),
            'state': st,
            'is_running': self.is_running if hasattr(self, 'is_running') else True,
            'in_position': self.in_position,
            'current_pnl': float(self.last_known_pnl) if self.last_known_pnl is not None else 0.0,
            'hist_pnl': float(self.historical_pnl) if self.historical_pnl is not None else 0.0,
            'session_pnl': float(self.session_pnl) if hasattr(self, 'session_pnl') and self.session_pnl is not None else 0.0,
            'entry_price': float(self.last_known_entry_price) if self.last_known_entry_price is not None else None,
            'position_size': float(self.last_known_position_size) if self.last_known_position_size is not None else None,
            'pending_entry_order_id': self.pending_entry_order_id,
            'pending_exit_order_id': self.pending_exit_order_id,
            'pending_tp_order_id': self.pending_tp_order_id,
            'pending_sl_order_id': self.pending_sl_order_id,
            'last_error': self.last_error_message,
            'entry_reason': self.entry_reason,
            'exit_reason': self.exit_reason,
            'entry_diagnostics': getattr(self, 'entry_diagnostics', {}),
            'position_diagnostics': getattr(self, 'position_diagnostics', {}),
            'pause_reason': getattr(self, 'pause_reason', ''),
            'cooldown_until_ts': getattr(self, 'cooldown_until_ts', 0.0),
            'cooldown_remaining_seconds': max(0, int(getattr(self, 'cooldown_until_ts', 0.0) - time.time())) if getattr(self, 'cooldown_until_ts', 0.0) > 0 else 0,
            'consecutive_losses': getattr(self, 'consecutive_losses_count', 0),
        }

    def get_status(self):
        return self.get_current_status()

    def close_position_now(self, reason: str = "Cierre Manual") -> bool:
        """
        Cierra de inmediato la posición activa a precio de mercado en Binance,
        cancela órdenes pendientes y actualiza el estado a IDLE.
        """
        self.logger.info(f"[{self.symbol}] Solicitud de cierre manual de posición. Razón: '{reason}'")
        
        # 1. Cancelar cualquier TP / SL u orden de salida pendiente
        self._cancel_active_tp_sl_orders()
        if self.pending_exit_order_id:
            try:
                from src.binance_client import cancel_futures_order
                cancel_futures_order(self.symbol, self.pending_exit_order_id)
                self.pending_exit_order_id = None
            except Exception as e:
                self.logger.warning(f"[{self.symbol}] Error al cancelar orden de salida pendiente {self.pending_exit_order_id}: {e}")

        # 2. Consultar posición real en Binance
        pos_data = get_futures_position(self.symbol, position_side=self.trade_side)
        pos_amt = Decimal('0')
        pos_side = self.trade_side
        if pos_data:
            pos_amt = Decimal(str(pos_data.get('positionAmt', '0')))
            pos_side = pos_data.get('positionSide', self.trade_side)
        elif self.in_position and self.current_position:
            pos_amt = Decimal(str(self.current_position.get('quantity', '0')))
        
        if abs(pos_amt) < Decimal('1e-9'):
            self.logger.info(f"[{self.symbol}][{self.trade_side}] No hay posición activa para cerrar en Binance.")
            self._reset_state()
            self._update_state(BotState.IDLE)
            return True

        # 3. Determinar lado de la orden de mercado de cierre
        is_short = (self.trade_side == 'SHORT')
        close_side = 'BUY' if is_short or (pos_amt < Decimal('0')) else 'SELL'
        adjusted_qty = self._adjust_quantity(abs(pos_amt))
        if adjusted_qty is None or adjusted_qty <= 0:
            self.logger.error(f"[{self.symbol}][{self.trade_side}] Cantidad no válida para cerrar posición: {pos_amt}")
            return False

        # 4. Enviar orden a mercado a Binance
        self.logger.info(f"[{self.symbol}][{self.trade_side}] Enviando orden MARKET {close_side} {adjusted_qty} (PositionSide={pos_side}) para cerrar posición...")
        order_resp = create_futures_market_order(
            symbol=self.symbol,
            side=close_side,
            quantity=adjusted_qty,
            reduce_only=True,
            position_side=pos_side
        )

        if not order_resp:
            self.logger.error(f"[{self.symbol}] Falló la orden de mercado para cerrar la posición.")
            return False

        self.logger.info(f"[{self.symbol}] Posición cerrada a mercado exitosamente en Binance: {order_resp.get('orderId')}")
        
        # 5. Registrar cierre y resetear
        close_price = Decimal(str(order_resp.get('avgPrice', order_resp.get('price', '0'))))
        if close_price <= Decimal('0'):
            try:
                ticker = get_order_book_ticker(self.symbol)
                if ticker:
                    ticker_p = ticker.get('bidPrice' if close_side == 'SELL' else 'askPrice')
                    if ticker_p:
                        close_price = Decimal(str(ticker_p))
            except Exception as e_tick:
                self.logger.warning(f"[{self.symbol}] No se pudo obtener precio del order book para cierre: {e_tick}")

        if close_price <= Decimal('0') and self.last_known_entry_price:
            close_price = self.last_known_entry_price
        
        self.current_exit_reason = reason
        self._handle_successful_closure(
            close_price=close_price,
            quantity_closed=abs(pos_amt),
            reason=reason,
            close_timestamp=datetime.now(),
            binance_order_id_of_closure=str(order_resp.get('orderId', ''))
        )
        return True

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
        elif side == 'SELL': # Abriendo un SHORT
            price_str = ticker.get('bidPrice')
            price_type = "Bid"
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

        is_short = (getattr(self, 'trade_side', 'LONG') == 'SHORT')
        close_side = 'BUY' if is_short else 'SELL'
        pos_side = self.trade_side

        if self.entry_order_type == 'MARKET':
            self.logger.warning(f"[{self.symbol}][{self.trade_side}] Intentando cerrar posición con orden MARKET {close_side} (Razón: {reason})...")
            self.current_exit_reason = reason
            order_result = create_futures_market_order(self.symbol, close_side, quantity_to_sell, reduce_only=True, position_side=pos_side)
            if order_result and order_result.get('orderId'):
                status_val = order_result.get('status')
                avg_price_str = order_result.get('avgPrice', '0')
                executed_qty_str = order_result.get('executedQty', '0')
                try:
                    has_price = Decimal(str(avg_price_str)) > Decimal('0')
                    has_qty = Decimal(str(executed_qty_str)) > Decimal('0')
                except Exception:
                    has_price, has_qty = False, False

                if status_val == 'FILLED' and has_price and has_qty:
                    self.logger.info(f"[{self.symbol}][{self.trade_side}] Orden MARKET {close_side} {order_result.get('orderId')} ejecutada y FILLED de inmediato.")
                    self._handle_filled_exit_order(order_result)
                else:
                    self.pending_exit_order_id = order_result['orderId']
                    self.pending_order_timestamp = time.time()
                    self.logger.warning(f"[{self.symbol}][{self.trade_side}] Orden MARKET {close_side} {self.pending_exit_order_id} colocada (Status={status_val}). Esperando confirmación...")
                    self._update_state(BotState.WAITING_EXIT_FILL)
            else:
                self.logger.error(f"[{self.symbol}][{self.trade_side}] Fallo al colocar la orden MARKET {close_side} para cerrar posición (Razón: {reason}).")
                self.last_error_message = f"Failed to place market exit order (reason: {reason})."
                self._update_state(BotState.IN_POSITION)
        elif reason and any(kw in reason.lower() for kw in ['stop_loss', 'emergency', 'trailing', 'crash']):
            # Para salidas de emergencia (SL, trailing stops), usar MARKET para garantizar ejecución
            self.logger.warning(f"[{self.symbol}][{self.trade_side}] Salida de emergencia ({reason}): usando orden MARKET {close_side} para garantizar cierre.")
            self.current_exit_reason = reason
            order_result = create_futures_market_order(self.symbol, close_side, quantity_to_sell, reduce_only=True, position_side=pos_side)
            if order_result and order_result.get('orderId'):
                status_val = order_result.get('status')
                avg_price_str = order_result.get('avgPrice', '0')
                executed_qty_str = order_result.get('executedQty', '0')
                try:
                    has_price = Decimal(str(avg_price_str)) > Decimal('0')
                    has_qty = Decimal(str(executed_qty_str)) > Decimal('0')
                except Exception:
                    has_price, has_qty = False, False

                if status_val == 'FILLED' and has_price and has_qty:
                    self.logger.info(f"[{self.symbol}][{self.trade_side}] Orden MARKET {close_side} de emergencia {order_result.get('orderId')} FILLED de inmediato.")
                    self._handle_filled_exit_order(order_result)
                else:
                    self.pending_exit_order_id = order_result['orderId']
                    self.pending_order_timestamp = time.time()
                    self.logger.warning(f"[{self.symbol}][{self.trade_side}] Orden MARKET {close_side} de emergencia {self.pending_exit_order_id} colocada (Status={status_val}). Esperando confirmación...")
                    self._update_state(BotState.WAITING_EXIT_FILL)
            else:
                self.logger.error(f"[{self.symbol}][{self.trade_side}] Fallo al colocar la orden MARKET {close_side} de emergencia (Razón: {reason}).")
                self.last_error_message = f"Failed to place emergency market exit order (reason: {reason})."
                self._update_state(BotState.IN_POSITION)
        else:
            order_result = create_futures_limit_order(self.symbol, close_side, quantity_to_sell, limit_sell_price_adjusted, position_side=pos_side)

            if order_result and order_result.get('orderId'):
                self.pending_exit_order_id = order_result['orderId']
                self.pending_order_timestamp = time.time()
                # Guardar la razón de la salida para usarla al registrar en DB si se llena
                self.current_exit_reason = reason 
                self.logger.warning(f"[{self.symbol}][{self.trade_side}] Orden LIMIT {close_side} {self.pending_exit_order_id} colocada @ {limit_sell_price_adjusted:.{price_precision_log}f}. Esperando ejecución...")
                self._update_state(BotState.WAITING_EXIT_FILL)
            else:
                self.logger.error(f"[{self.symbol}][{self.trade_side}] Fallo al colocar la orden LIMIT {close_side} para cerrar posición (Razón: {reason}).")
                self.last_error_message = f"Failed to place exit order (reason: {reason})."
                self._update_state(BotState.IN_POSITION)
    # --- Fin del nuevo método ---

    def _build_default_entry_diagnostics(self) -> dict:
        """Construye un diagnóstico de entrada inicial con los filtros activos según la configuración."""
        is_short = (getattr(self, 'trade_side', 'LONG') == 'SHORT')
        n_trend = getattr(self, 'required_downtrend_candles', 0) if is_short else getattr(self, 'required_uptrend_candles', 0)
        eff_thresh = -abs(float(getattr(self, 'rsi_threshold_up', 2.0))) if is_short else float(getattr(self, 'rsi_threshold_up', 2.0))
        op = "<=" if is_short else ">="
        rsi_req_cnt = getattr(self, 'rsi_positive_candles_required', 2)

        cond_list = [
            {
                "id": "rsi_range",
                "name": "RSI Rango",
                "short_name": "RSI",
                "active": bool(getattr(self, 'evaluate_rsi_range', True)),
                "passed": False,
                "value": "...",
                "target": f"[{getattr(self, 'rsi_entry_level_low', 30)}, {getattr(self, 'rsi_entry_level_high', 70)}]",
                "detail": "Esperando lectura RSI inicial"
            },
            {
                "id": "rsi_delta",
                "name": "Delta RSI",
                "short_name": "ΔRSI",
                "active": bool(getattr(self, 'evaluate_rsi_delta', True)),
                "passed": False,
                "value": "...",
                "target": f"{op} {eff_thresh:+.2f} ({rsi_req_cnt}v)",
                "detail": "Esperando cálculo delta"
            },
            {
                "id": "volume",
                "name": "Filtro Volumen",
                "short_name": "Vol",
                "active": bool(getattr(self, 'evaluate_volume_filter', True)),
                "passed": not bool(getattr(self, 'evaluate_volume_filter', True)),
                "value": "...",
                "target": f"≥ {float(getattr(self, 'volume_factor', 1.0)):.1f}x SMA",
                "detail": "Filtro volumen"
            },
            {
                "id": "uptrend",
                "name": f"Velas {'Bajistas' if is_short else 'Alcistas'}",
                "short_name": "Velas",
                "active": bool(getattr(self, 'evaluate_required_uptrend', True)),
                "passed": not bool(getattr(self, 'evaluate_required_uptrend', True)),
                "value": f"{n_trend}v" if getattr(self, 'evaluate_required_uptrend', True) else "OFF",
                "target": f"{n_trend} velas" if getattr(self, 'evaluate_required_uptrend', True) else "Desactivado",
                "detail": f"Requiere {n_trend} velas {'bajistas' if is_short else 'alcistas'} consecutivas" if getattr(self, 'evaluate_required_uptrend', True) else "Filtro desactivado"
            },
            {
                "id": "open_interest",
                "name": "Open Interest",
                "short_name": "OI",
                "active": bool(getattr(self, 'evaluate_open_interest_increase', False)),
                "passed": not bool(getattr(self, 'evaluate_open_interest_increase', False)),
                "value": "N/A",
                "target": "Aumento (+)",
                "detail": "Filtro Open Interest"
            },
            {
                "id": "ma_filter",
                "name": "Filtro MA",
                "short_name": "MA",
                "active": bool(getattr(self, 'evaluate_ma_filter', True)),
                "passed": not bool(getattr(self, 'evaluate_ma_filter', True)),
                "value": "...",
                "target": f"{'<' if is_short else '>'} MA({getattr(self, 'ma_period', 50)})",
                "detail": "Filtro Media Móvil"
            },
            {
                "id": "downtrend_candles",
                "name": "Anti-Pump Velas" if is_short else "Anti-Cascada Velas",
                "short_name": "Verdes" if is_short else "Rojas",
                "active": bool(getattr(self, 'evaluate_downtrend_candles_block', True)),
                "passed": True,
                "value": "...",
                "target": f"< {getattr(self, 'downtrend_check_candles', 3)} {'verdes' if is_short else 'rojas'}",
                "detail": "Filtro velas adversas"
            },
            {
                "id": "downtrend_levels",
                "name": "Nivel Caída",
                "short_name": "Caída",
                "active": bool(not is_short and getattr(self, 'evaluate_downtrend_levels_block', True)),
                "passed": True,
                "value": "Normal",
                "target": f"Sin cascada ({getattr(self, 'downtrend_level_check', 0)}v)",
                "detail": "Filtro niveles de caída"
            },
            {
                "id": "market_regime",
                "name": "Régimen Macro",
                "short_name": "Macro",
                "active": bool(getattr(self, 'enable_market_regime_filter', False)),
                "passed": not bool(getattr(self, 'enable_market_regime_filter', False)),
                "value": "...",
                "target": f"{'Bajista' if is_short else 'Alcista'} ({getattr(self, 'market_regime_timeframe', '1h')})",
                "detail": "Filtro macro"
            }
        ]
        active_conds = [c for c in cond_list if c["active"]]
        total_active = len(active_conds)
        passed_cnt = sum(1 for c in active_conds if c["passed"])
        return {
            "strategy": "RSI Momentum",
            "trade_side": getattr(self, 'trade_side', 'LONG'),
            "passed_count": passed_cnt,
            "total_active": total_active,
            "ratio_text": f"{passed_cnt}/{total_active}",
            "all_met": False,
            "summary": f"🔍 Evaluando ({passed_cnt}/{total_active})",
            "conditions": cond_list,
            "timestamp": int(time.time() * 1000)
        }

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

            rsi_values = calculate_rsi(klines_df['close'], period=self.rsi_period, rsi_type=getattr(self, 'rsi_type', 'WILDER'))
            
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

            # --- EVALUACIÓN DE VENTANA DE VELAS RSI Y MAGNITUD ---
            is_short = (getattr(self, 'trade_side', 'LONG') == 'SHORT')
            rsi_window = getattr(self, 'rsi_candles_window', 3)
            rsi_req_cnt = getattr(self, 'rsi_positive_candles_required', 2)
            rsi_min_delta = float(getattr(self, 'rsi_positive_delta_min', 0.0))
            
            rsi_window_passed = True
            matching_rsi_candles_count = 0
            evaluated_window_size = 0

            if self.evaluate_rsi_delta and rsi_req_cnt > 0 and rsi_values is not None and len(rsi_values) > 1:
                rsi_diffs = rsi_values.diff().dropna()
                if not rsi_diffs.empty:
                    actual_window = min(rsi_window, len(rsi_diffs))
                    recent_diffs = rsi_diffs.tail(actual_window)
                    evaluated_window_size = len(recent_diffs)
                    
                    for diff_val in recent_diffs:
                        val = float(diff_val)
                        if is_short:
                            # Para SHORT: buscamos caídas de RSI (momentum bajista)
                            if rsi_min_delta > 0.0:
                                if val <= -rsi_min_delta:
                                    matching_rsi_candles_count += 1
                            else:
                                if val < 0.0:
                                    matching_rsi_candles_count += 1
                        else:
                            # Para LONG: buscamos subidas de RSI (momentum alcista)
                            if rsi_min_delta > 0.0:
                                if val >= rsi_min_delta:
                                    matching_rsi_candles_count += 1
                            else:
                                if val > 0.0:
                                    matching_rsi_candles_count += 1
                    
                    if matching_rsi_candles_count < rsi_req_cnt:
                        rsi_window_passed = False
                        self.logger.info(f"[{self.symbol}][{self.trade_side}] Chequeo Ventana RSI NO CUMPLIDO: {matching_rsi_candles_count}/{rsi_req_cnt} velas {'bajistas' if is_short else 'positivas'} en ventana de {actual_window} (mín delta: {rsi_min_delta:.2f})")
                    else:
                        self.logger.info(f"[{self.symbol}][{self.trade_side}] Chequeo Ventana RSI CUMPLIDO: {matching_rsi_candles_count}/{rsi_req_cnt} velas {'bajistas' if is_short else 'positivas'} en ventana de {actual_window} (mín delta: {rsi_min_delta:.2f})")

            # --- Definir condition_rsi_change_meets_thresh_up y rsi_delta_str ---
            condition_rsi_change_meets_thresh_up = False
            rsi_delta_str = "N/A" # Valor por defecto para el log
            op_str = "<=" if is_short else ">="
            eff_thresh_val = -abs(float(self.rsi_threshold_up)) if is_short else float(self.rsi_threshold_up)

            if not self.evaluate_rsi_delta: # Si la evaluación de delta RSI está DESACTIVADA
                condition_rsi_change_meets_thresh_up = True
                self.logger.info(f"[{self.symbol}][{self.trade_side}] Chequeo Delta RSI: Evaluación DESACTIVADA (evaluate_rsi_delta=False). Condición de delta cumplida por defecto.")
            else:
                single_delta_ok = False
                if rsi_delta is not None:
                    rsi_delta_str = f"{rsi_delta:.2f}"
                    if is_short:
                        effective_thresh = -abs(float(self.rsi_threshold_up)) if self.rsi_threshold_up != 0 else 0.0
                        if rsi_delta <= effective_thresh:
                            single_delta_ok = True
                    else:
                        effective_thresh = float(self.rsi_threshold_up)
                        if rsi_delta >= effective_thresh:
                            single_delta_ok = True
                condition_rsi_change_meets_thresh_up = single_delta_ok and rsi_window_passed
                op_str = "<=" if is_short else ">="
                eff_thresh_val = -abs(float(self.rsi_threshold_up)) if is_short else float(self.rsi_threshold_up)
                self.logger.info(f"[{self.symbol}][{self.trade_side}] Chequeo Delta RSI (Activado): Inmediato={single_delta_ok} (Delta={rsi_delta_str} {op_str} {eff_thresh_val:+.2f}), "
                                 f"Ventana={rsi_window_passed} ({matching_rsi_candles_count}/{rsi_req_cnt} en {evaluated_window_size} velas). "
                                 f"Resultado={'Sí' if condition_rsi_change_meets_thresh_up else 'No'}")
            # --------------------------------------------------------------------

            # Condición 1: Cambio (Delta) en RSI cumple el umbral correspondiente
            # condition_rsi_change_meets_thresh_up se calcula antes y usa self.evaluate_rsi_delta

            # Condición 2: Filtro de Volumen (Lógica ya modificada previamente)
            # volume_check_passed se calcula antes y usa self.evaluate_volume_filter
            
            # Condición 3: Requisito de tendencia reciente (Alcista para LONG, Bajista para SHORT)
            condition_required_uptrend_met = False
            n_trend_candles = getattr(self, 'required_downtrend_candles', 0) if is_short else getattr(self, 'required_uptrend_candles', 0)
            trend_type_str = "Bajistas" if is_short else "Alcistas"

            if not self.evaluate_required_uptrend: # Si la evaluación está DESACTIVADA
                condition_required_uptrend_met = True
                self.logger.info(f"[{self.symbol}][{self.trade_side}] Chequeo Requisito Velas Tendencia: Evaluación DESACTIVADA. Condición cumplida por defecto.")
            else: # Si está ACTIVADA, evaluar normalmente
                if is_short:
                    condition_required_uptrend_met = self._check_required_downtrend(klines_df)
                else:
                    condition_required_uptrend_met = self._check_required_uptrend(klines_df)
                self.logger.info(f"[{self.symbol}][{self.trade_side}] Chequeo Entrada (Activado): Requisito Velas {trend_type_str} ({n_trend_candles} velas)? {'Sí' if condition_required_uptrend_met else 'No'}")

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
                    if is_short:
                        if current_price < ma_value:
                            condition_ma_filter_passed = True
                    else:
                        if current_price > ma_value:
                            condition_ma_filter_passed = True
                else:
                    self.logger.warning(f"[{self.symbol}][{self.trade_side}] No se pudo calcular el valor de la MA para el chequeo de entrada.")

            self.logger.info(f"[{self.symbol}][{self.trade_side}] Resumen Chequeo Entrada: RSI en rango? {'Sí' if condition_rsi_in_range else 'No'}, "
                             f"Delta RSI OK? {'Sí' if condition_rsi_change_meets_thresh_up else 'No'}, "
                             f"Volumen OK? {'Sí' if volume_check_passed else 'No'}, "
                             f"Req Velas Tendencia OK? {'Sí' if condition_required_uptrend_met else 'No'}, "
                             f"Incremento OI OK? {'Sí' if condition_oi_increase_met else 'No'}, "
                             f"Filtro MA OK? {'Sí' if condition_ma_filter_passed else 'No'}")

            # --- AÑADIDO: Lógica de Filtro Anti-Cascada / Anti-Pump ---
            dt_is_blocked, dt_adverse_cnt, dt_win = self._check_downtrend_candles(klines_df)
            condition_downtrend_candles_passed = not dt_is_blocked

            # --- AÑADIDO: Lógica de Filtro Niveles de Caída (solo relevante para LONG) ---
            condition_downtrend_levels_passed = True
            dt_levels_detected = False
            if not is_short and getattr(self, 'evaluate_downtrend_levels_block', True) and getattr(self, 'downtrend_level_check', 0) > 0:
                dt_levels_detected = self._check_downtrend_levels(klines_df)
                condition_downtrend_levels_passed = not dt_levels_detected

            # --- AÑADIDO: Lógica de Filtro Régimen de Mercado (Tendencia Macro HTF) ---
            regime_passed, regime_summary, regime_details = self._check_market_regime()
            condition_market_regime_passed = regime_passed

            # --- CONSTRUCCIÓN DE DIAGNÓSTICO DE ENTRADA EN TIEMPO REAL ---
            try:
                cond_list = []

                # 1. RSI en Rango
                rsi_val_float = round(float(self.last_rsi_value), 2) if self.last_rsi_value is not None else None
                cond_list.append({
                    "id": "rsi_range",
                    "name": "RSI Rango",
                    "short_name": "RSI",
                    "active": bool(self.evaluate_rsi_range),
                    "passed": bool(condition_rsi_in_range),
                    "value": f"{rsi_val_float:.1f}" if rsi_val_float is not None else "N/A",
                    "target": f"[{self.rsi_entry_level_low}, {self.rsi_entry_level_high}]",
                    "detail": f"{rsi_val_float:.1f} en [{self.rsi_entry_level_low}, {self.rsi_entry_level_high}]" if rsi_val_float is not None else "Sin lectura RSI"
                })

                # 2. Delta RSI y Ventana
                delta_val_float = round(float(rsi_delta), 2) if (rsi_delta is not None and isinstance(rsi_delta, (int, float, Decimal))) else None
                detail_parts = []
                if delta_val_float is not None:
                    detail_parts.append(f"Δ {delta_val_float:+.2f} ({'máx' if is_short else 'mín'} {eff_thresh_val:+.2f})")
                if rsi_req_cnt > 0:
                    delta_desc = f"≤-{rsi_min_delta:.1f}" if is_short else (f"≥{rsi_min_delta:.1f}" if rsi_min_delta > 0 else ">0")
                    detail_parts.append(f"{matching_rsi_candles_count}/{evaluated_window_size} vel{'↓' if is_short else '↑'} ({delta_desc}, req {rsi_req_cnt})")

                cond_list.append({
                    "id": "rsi_delta",
                    "name": "Delta RSI",
                    "short_name": "ΔRSI",
                    "active": bool(self.evaluate_rsi_delta),
                    "passed": bool(condition_rsi_change_meets_thresh_up),
                    "value": f"{delta_val_float:+.2f} ({matching_rsi_candles_count}/{evaluated_window_size}v)" if delta_val_float is not None else "N/A",
                    "target": f"{op_str} {eff_thresh_val:+.2f} ({rsi_req_cnt}v)",
                    "detail": " | ".join(detail_parts) if detail_parts else "Sin RSI anterior"
                })

                # 3. Filtro de Volumen
                vol_passed = bool(volume_check_passed)
                vol_active = bool(self.evaluate_volume_filter)
                vol_data = locals().get('volume_data')
                if vol_data and len(vol_data) >= 3:
                    c_vol, a_vol, f_vol = vol_data
                    vol_ratio = (c_vol / a_vol) if a_vol > 0 else 0
                    vol_val_str = f"{vol_ratio:.1f}x"
                    vol_detail = f"Vol actual: {c_vol:.0f} vs SMA: {a_vol:.0f} (Ratio {vol_ratio:.2f}x >= {f_vol}x)"
                else:
                    vol_val_str = "OK" if vol_passed else "N/A"
                    vol_detail = "Filtro activo sin datos SMA" if vol_active else "Filtro desactivado"

                cond_list.append({
                    "id": "volume",
                    "name": "Filtro Volumen",
                    "short_name": "Vol",
                    "active": vol_active,
                    "passed": vol_passed,
                    "value": vol_val_str,
                    "target": f"≥ {float(getattr(self, 'volume_factor', 1.0)):.1f}x SMA",
                    "detail": vol_detail
                })

                # 4. Requisito Velas Tendencia
                cond_list.append({
                    "id": "uptrend",
                    "name": f"Velas {'Bajistas' if is_short else 'Alcistas'}",
                    "short_name": "Velas",
                    "active": bool(self.evaluate_required_uptrend),
                    "passed": bool(condition_required_uptrend_met),
                    "value": f"{n_trend_candles}v" if bool(self.evaluate_required_uptrend) else "OFF",
                    "target": f"{n_trend_candles} velas" if bool(self.evaluate_required_uptrend) else "Desactivado",
                    "detail": f"Requiere {n_trend_candles} velas {'bajistas' if is_short else 'alcistas'} consecutivas" if bool(self.evaluate_required_uptrend) else "Filtro desactivado"
                })

                # 5. Open Interest
                cond_list.append({
                    "id": "open_interest",
                    "name": "Open Interest",
                    "short_name": "OI",
                    "active": bool(self.evaluate_open_interest_increase),
                    "passed": bool(condition_oi_increase_met),
                    "value": str(open_interest_delta_str),
                    "target": "Aumento (+)",
                    "detail": f"Δ OI: {open_interest_delta_str} USDT (Actual: {current_oi_value_for_log}, Prev: {previous_oi_value_for_log})"
                })

                # 6. Filtro Media Móvil
                cond_list.append({
                    "id": "ma_filter",
                    "name": "Filtro MA",
                    "short_name": "MA",
                    "active": bool(self.evaluate_ma_filter),
                    "passed": bool(condition_ma_filter_passed),
                    "value": f"{price_for_log}",
                    "target": f"{'<' if is_short else '>'} {ma_value_for_log}",
                    "detail": f"Precio: {price_for_log} {'<' if is_short else '>'} MA: {ma_value_for_log}"
                })

                # 7. Filtro Anti-Cascada / Anti-Pump
                cond_list.append({
                    "id": "downtrend_candles",
                    "name": "Anti-Pump Velas" if is_short else "Anti-Cascada Velas",
                    "short_name": "Verdes" if is_short else "Rojas",
                    "active": bool(getattr(self, 'evaluate_downtrend_candles_block', True)),
                    "passed": bool(condition_downtrend_candles_passed),
                    "value": f"{dt_adverse_cnt}/{dt_win}v",
                    "target": f"< {getattr(self, 'downtrend_check_candles', 3)} {'verdes' if is_short else 'rojas'}",
                    "detail": f"{dt_adverse_cnt} {'verdes' if is_short else 'rojas'} de {dt_win} velas (bloquea si ≥ {getattr(self, 'downtrend_check_candles', 3)})"
                })

                # 8. Filtro Niveles Caída
                cond_list.append({
                    "id": "downtrend_levels",
                    "name": "Nivel Caída",
                    "short_name": "Caída",
                    "active": bool(not is_short and getattr(self, 'evaluate_downtrend_levels_block', True)),
                    "passed": bool(condition_downtrend_levels_passed),
                    "value": "Cascada" if dt_levels_detected else "Normal",
                    "target": f"Sin cascada ({getattr(self, 'downtrend_level_check', 0)}v)",
                    "detail": f"Caída escalonada detectada en {getattr(self, 'downtrend_level_check', 0)} velas" if dt_levels_detected else "Sin caída escalonada"
                })

                # 9. Filtro Régimen de Mercado (Tendencia Macro HTF)
                cond_list.append({
                    "id": "market_regime",
                    "name": "Régimen Macro",
                    "short_name": "Macro",
                    "active": bool(getattr(self, 'enable_market_regime_filter', False)),
                    "passed": bool(condition_market_regime_passed),
                    "value": "Bajista" if (is_short and condition_market_regime_passed) else ("Alcista" if condition_market_regime_passed else "No apto"),
                    "target": f"{'Bajista' if is_short else 'Alcista'} ({getattr(self, 'market_regime_timeframe', '1h')})",
                    "detail": regime_summary
                })

                active_conds = [c for c in cond_list if c["active"]]
                total_active = len(active_conds)
                passed_cnt = sum(1 for c in active_conds if c["passed"])
                all_passed = (passed_cnt == total_active) if total_active > 0 else False

                self.entry_diagnostics = {
                    "strategy": "RSI Momentum",
                    "trade_side": getattr(self, 'trade_side', 'LONG'),
                    "passed_count": passed_cnt,
                    "total_active": total_active,
                    "ratio_text": f"{passed_cnt}/{total_active}",
                    "all_met": all_passed,
                    "summary": "⚡ SEÑAL COMPLETA" if all_passed else (f"🟡 Casi lista ({passed_cnt}/{total_active})" if (total_active > 0 and passed_cnt >= total_active - 1) else f"🔍 Evaluando ({passed_cnt}/{total_active})"),
                    "conditions": cond_list,
                    "timestamp": int(time.time() * 1000)
                }
            except Exception as e_entry_diag:
                self.logger.warning(f"[{self.symbol}] Error calculando entry_diagnostics: {e_entry_diag}")

            # Evaluar todas las condiciones para la señal de entrada
            if all([condition_rsi_in_range, condition_rsi_change_meets_thresh_up, volume_check_passed, 
                    condition_required_uptrend_met, condition_oi_increase_met, condition_ma_filter_passed,
                    condition_downtrend_candles_passed, condition_downtrend_levels_passed,
                    condition_market_regime_passed]):
                self.logger.info(f"[{self.symbol}] CONDICIÓN DE ENTRADA COMBINADA DETECTADA.")
                entry_signal = True
                self.entry_reason = (f"RSI_range/delta/vol/uptrend/oi/MA_Filter/anti_cascada/market_regime")
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
                if self.risk_manager and not self.risk_manager.can_open_position(Decimal(str(self.position_size_usdt))):
                    self.logger.warning(f"[{self.symbol}] SEÑAL DE ENTRADA ({self.entry_reason}) detectada pero BLOQUEADA por el Gestor de Riesgo (Exposición máxima alcanzada).")
                    self._update_state(BotState.IDLE)
                    return

                is_short = (getattr(self, 'trade_side', 'LONG') == 'SHORT')
                entry_order_side = 'SELL' if is_short else 'BUY'
                best_entry_price = self._get_best_entry_price(entry_order_side)
                if not best_entry_price:
                    self.logger.error(f"[{self.symbol}][{self.trade_side}] No se pudo obtener el mejor precio para la entrada ({entry_order_side}). No se colocará orden.")
                    self._update_state(BotState.IDLE)
                    return
                
                limit_entry_price = self._adjust_price(best_entry_price)
                notional_order_usdt = Decimal(str(self.position_size_usdt)) * Decimal(str(self.leverage))
                quantity = self._adjust_quantity(notional_order_usdt / limit_entry_price)
                
                # CORRECCIÓN: La comprobación debe ser si es None
                if quantity is None or quantity <= 0:
                    self.logger.warning(f"[{self.symbol}][{self.trade_side}] Cantidad calculada para la orden es inválida ({quantity}) después del ajuste. No se puede entrar.")
                    self._update_state(BotState.IDLE)
                    return

                # Calcular la precisión del precio para el log de forma segura
                price_precision_log = self.price_tick_size.as_tuple().exponent * -1 if self.price_tick_size and self.price_tick_size.is_finite() and self.price_tick_size > Decimal('0') else 2

                if self.entry_order_type == 'MARKET':
                    self.logger.warning(f"[{self.symbol}][{self.trade_side}] SEÑAL DE ENTRADA ({self.entry_reason}). Intentando colocar orden MARKET {entry_order_side}, Cantidad={quantity} (Ref Price: {limit_entry_price:.{price_precision_log}f})")
                    self._update_state(BotState.PLACING_ENTRY)
                    order_result = create_futures_market_order(self.symbol, entry_order_side, quantity, position_side=self.trade_side)

                    if order_result and order_result.get('orderId'):
                        status_val = order_result.get('status')
                        avg_price_str = order_result.get('avgPrice', '0')
                        executed_qty_str = order_result.get('executedQty', '0')
                        try:
                            has_price = Decimal(str(avg_price_str)) > Decimal('0')
                            has_qty = Decimal(str(executed_qty_str)) > Decimal('0')
                        except Exception:
                            has_price, has_qty = False, False

                        if status_val == 'FILLED' and has_price and has_qty:
                            self.logger.info(f"[{self.symbol}][{self.trade_side}] Orden MARKET {entry_order_side} {order_result.get('orderId')} ejecutada y FILLED de inmediato.")
                            self._handle_filled_entry_order(order_result)
                        else:
                            self.pending_entry_order_id = order_result['orderId']
                            self.pending_order_timestamp = time.time()
                            self.logger.warning(f"[{self.symbol}][{self.trade_side}] Orden MARKET {entry_order_side} {self.pending_entry_order_id} colocada (Status={status_val}). Esperando confirmación...")
                            self._update_state(BotState.WAITING_ENTRY_FILL)
                    else:
                        self.logger.error(f"[{self.symbol}][{self.trade_side}] Fallo al colocar la orden MARKET {entry_order_side}.")
                        self.last_error_message = f"Failed to place market entry order ({entry_order_side})."
                        self._update_state(BotState.IDLE)
                else:
                    self.logger.warning(f"[{self.symbol}][{self.trade_side}] SEÑAL DE ENTRADA ({self.entry_reason}). Intentando colocar orden LIMIT {entry_order_side} @ {limit_entry_price:.{price_precision_log}f}, Cantidad={quantity}")
                    self._update_state(BotState.PLACING_ENTRY)
                    order_result = create_futures_limit_order(self.symbol, entry_order_side, quantity, limit_entry_price, position_side=self.trade_side)

                    if order_result and order_result.get('orderId'):
                        self.pending_entry_order_id = order_result['orderId']
                        self.pending_order_timestamp = time.time()
                        # NO guardamos rsi_at_entry aquí, sino cuando la orden se LLENA.
                        self.logger.warning(f"[{self.symbol}][{self.trade_side}] Orden LIMIT {entry_order_side} {self.pending_entry_order_id} colocada @ {limit_entry_price:.{price_precision_log}f}. Esperando ejecución...")
                        self._update_state(BotState.WAITING_ENTRY_FILL)
                    else:
                        self.logger.error(f"[{self.symbol}][{self.trade_side}] Fallo al colocar la orden LIMIT {entry_order_side}.")
                        self.last_error_message = f"Failed to place entry order ({entry_order_side})."
                        self._update_state(BotState.IDLE) 
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

        self._update_state(BotState.IN_POSITION)

    def _check_exit_conditions(self, klines_df: pd.DataFrame):
        """
        Verifica si se cumplen las condiciones para cerrar una posición LONG.
        """
        if self.in_position and self.current_position:
            rsi_values_exit = calculate_rsi(klines_df['close'], period=self.rsi_period, rsi_type=getattr(self, 'rsi_type', 'WILDER'))
            current_rsi_str = "N/A"
            if rsi_values_exit is not None and not rsi_values_exit.empty:
                self.last_rsi_value = rsi_values_exit.iloc[-1]
                current_rsi_str = f"{self.last_rsi_value:.2f}"
            else:
                prev_rsi_str = f"{self.last_rsi_value:.2f}" if self.last_rsi_value is not None else "None"
                self.logger.warning(f"[{self.symbol}] No se pudo calcular el RSI para _check_exit_conditions. Usando valor anterior: {prev_rsi_str}")
                if self.last_rsi_value is not None:
                    current_rsi_str = f"{self.last_rsi_value:.2f}"

            price_precision_log = self.price_tick_size.as_tuple().exponent * -1 if self.price_tick_size and self.price_tick_size.is_finite() and self.price_tick_size > Decimal('0') else 2
            self.logger.info(f"[{self.symbol}] Chequeo Salida: Precio actual={klines_df.iloc[-1]['close']:.{price_precision_log}f}, RSI Actual={current_rsi_str}")
            rsi_at_entry_str = f"{self.rsi_at_entry:.2f}" if self.rsi_at_entry is not None else "N/A"
            self.logger.info(f"[{self.symbol}] EN POSICIÓN: Entrada @ {self.current_position['entry_price']:.{price_precision_log}f}, Cant: {self.current_position['quantity']}, PnL actual: {self.last_known_pnl:.4f} USDT, RSI Entrada: {rsi_at_entry_str}")

            exit_signal = False

            # 1. Take Profit (por USDT o por Porcentaje)
            tp_enabled = self.enable_take_profit_pnl or (self.support_order_take_profit_percent > 0)
            if tp_enabled:
                if self.take_profit_usdt > 0 and self.last_known_pnl is not None and self.last_known_pnl >= self.take_profit_usdt:
                    self.logger.warning(f"[{self.symbol}] CONDICIÓN DE TAKE PROFIT (PnL USDT) ALCANZADA. PnL={self.last_known_pnl:.4f} >= TP={self.take_profit_usdt}")
                    exit_signal = True
                    self.exit_reason = f"take_profit_pnl_reached ({self.last_known_pnl:.4f})"
                elif self.support_order_take_profit_percent > 0 and self.current_position:
                    entry_p = self.current_position.get('entry_price', Decimal('0'))
                    current_p = Decimal(str(klines_df['close'].iloc[-1]))
                    is_short = (getattr(self, 'trade_side', 'LONG') == 'SHORT')
                    if is_short:
                        target_tp = entry_p * (Decimal('1') - Decimal(str(self.support_order_take_profit_percent)) / Decimal('100'))
                        if current_p <= target_tp:
                            self.logger.warning(f"[{self.symbol}][{self.trade_side}] CONDICIÓN DE TAKE PROFIT (-{self.support_order_take_profit_percent}%) ALCANZADA. Precio Actual={current_p} <= Objetivo={target_tp}")
                            exit_signal = True
                            self.exit_reason = f"take_profit_percent_reached (-{self.support_order_take_profit_percent}%)"
                    else:
                        target_tp = entry_p * (Decimal('1') + Decimal(str(self.support_order_take_profit_percent)) / Decimal('100'))
                        if current_p >= target_tp:
                            self.logger.warning(f"[{self.symbol}][{self.trade_side}] CONDICIÓN DE TAKE PROFIT (+{self.support_order_take_profit_percent}%) ALCANZADA. Precio Actual={current_p} >= Objetivo={target_tp}")
                            exit_signal = True
                            self.exit_reason = f"take_profit_percent_reached (+{self.support_order_take_profit_percent}%)"
            else:
                self.logger.info(f"[{self.symbol}] Salida por Take Profit DESHABILITADA.")

            # 2. Stop Loss (por USDT o por Porcentaje)
            sl_enabled = self.enable_stop_loss_pnl or (self.support_order_stop_loss_percent > 0)
            allow_software_sl = getattr(self, 'enable_emergency_software_sl', True)
            if not exit_signal and sl_enabled and allow_software_sl:
                if self.stop_loss_usdt != 0 and self.last_known_pnl is not None:
                    max_allowed_loss = -abs(Decimal(str(self.stop_loss_usdt)))
                    if self.last_known_pnl <= max_allowed_loss:
                        self.logger.warning(f"[{self.symbol}][{self.trade_side}] 🛡️ GUARDIÁN DE SOFTWARE ACTIVADO: Stop Loss de Emergencia alcanzado. PnL={self.last_known_pnl:.4f} <= SL={max_allowed_loss}")
                        exit_signal = True
                        self.exit_reason = f"emergency_software_sl_reached ({self.last_known_pnl:.4f})"
                elif self.support_order_stop_loss_percent > 0 and self.current_position:
                    entry_p = self.current_position.get('entry_price', Decimal('0'))
                    current_p = Decimal(str(klines_df['close'].iloc[-1]))
                    is_short = (getattr(self, 'trade_side', 'LONG') == 'SHORT')
                    if is_short:
                        target_sl = entry_p * (Decimal('1') + Decimal(str(self.support_order_stop_loss_percent)) / Decimal('100'))
                        if current_p >= target_sl:
                            self.logger.warning(f"[{self.symbol}][{self.trade_side}] CONDICIÓN DE STOP LOSS (+{self.support_order_stop_loss_percent}%) ALCANZADA. Precio Actual={current_p} >= Objetivo={target_sl}")
                            exit_signal = True
                            self.exit_reason = f"stop_loss_percent_reached (+{self.support_order_stop_loss_percent}%)"
                    else:
                        target_sl = entry_p * (Decimal('1') - Decimal(str(self.support_order_stop_loss_percent)) / Decimal('100'))
                        if current_p <= target_sl:
                            self.logger.warning(f"[{self.symbol}][{self.trade_side}] CONDICIÓN DE STOP LOSS (-{self.support_order_stop_loss_percent}%) ALCANZADA. Precio Actual={current_p} <= Objetivo={target_sl}")
                            exit_signal = True
                            self.exit_reason = f"stop_loss_percent_reached (-{self.support_order_stop_loss_percent}%)"
            elif not exit_signal: 
                self.logger.info(f"[{self.symbol}] Salida por Stop Loss DESHABILITADA.")

            # --- SALIDA DE EMERGENCIA POR CRASH (ANTI-DESPLOME / ANTI-PUMP: 3 TRIGGERS) ---
            if not exit_signal and getattr(self, 'enable_emergency_crash_exit', False):
                is_short = (getattr(self, 'trade_side', 'LONG') == 'SHORT')
                # Trigger 1: Colapso Súbito de RSI en la vela actual respecto a la previa (Delta RSI)
                if getattr(self, 'enable_crash_rsi_drop', True) and self.last_rsi_value is not None and self.previous_rsi_value is not None:
                    rsi_delta_now = float(self.last_rsi_value) - float(self.previous_rsi_value)
                    crash_threshold = float(getattr(self, 'crash_rsi_drop_threshold', 8.0))
                    if is_short and rsi_delta_now >= crash_threshold:
                        self.logger.warning(f"[{self.symbol}][{self.trade_side}] 🚨 CRASH TRIGGER 1 DISPARADO (Pump RSI en SHORT): "
                                            f"ΔRSI=+{rsi_delta_now:.2f} >= +{crash_threshold:.2f} "
                                            f"(RSI: {self.previous_rsi_value:.2f} -> {self.last_rsi_value:.2f}). "
                                            f"Eyectando posición a mercado de inmediato.")
                        exit_signal = True
                        self.exit_reason = f"emergency_crash_exit_rsi (ΔRSI=+{rsi_delta_now:.2f} >= +{crash_threshold:.2f})"
                    elif not is_short and rsi_delta_now <= -crash_threshold:
                        self.logger.warning(f"[{self.symbol}][{self.trade_side}] 🚨 CRASH TRIGGER 1 DISPARADO (Colapso RSI en LONG): "
                                            f"ΔRSI={rsi_delta_now:.2f} <= -{crash_threshold:.2f} "
                                            f"(RSI: {self.previous_rsi_value:.2f} -> {self.last_rsi_value:.2f}). "
                                            f"Eyectando posición a mercado de inmediato.")
                        exit_signal = True
                        self.exit_reason = f"emergency_crash_exit_rsi (ΔRSI={rsi_delta_now:.2f} <= -{crash_threshold:.2f})"

                # Trigger 2: Movimiento Porcentual Adverso Rápido del Precio desde Entrada (% Move)
                if not exit_signal and getattr(self, 'enable_crash_price_drop', True) and self.current_position:
                    entry_p = self.current_position.get('entry_price', Decimal('0'))
                    if entry_p > Decimal('0'):
                        curr_p = Decimal(str(klines_df['close'].iloc[-1]))
                        if is_short:
                            price_adverse_pct = float((curr_p - entry_p) / entry_p * Decimal('100'))
                        else:
                            price_adverse_pct = float((entry_p - curr_p) / entry_p * Decimal('100'))
                        max_drop_pct = float(getattr(self, 'crash_price_drop_percent', 1.5))
                        if price_adverse_pct >= max_drop_pct:
                            label_dir = "Subida Inversa" if is_short else "Caída Porcentual"
                            self.logger.warning(f"[{self.symbol}][{self.trade_side}] 🚨 CRASH TRIGGER 2 DISPARADO ({label_dir}): "
                                                f"Movimiento Adverso={price_adverse_pct:.2f}% >= Umbral={max_drop_pct:.2f}% "
                                                f"(Entrada: {entry_p}, Actual: {curr_p}). "
                                                f"Eyectando posición a mercado de inmediato.")
                            exit_signal = True
                            self.exit_reason = f"emergency_crash_exit_price_move ({price_adverse_pct:.2f}% >= {max_drop_pct:.2f}%)"

                # Trigger 3: Desplome Rápido de PnL Flotante (Flash PnL Drop)
                if not exit_signal and getattr(self, 'enable_crash_pnl_drop', True) and self.last_known_pnl is not None:
                    pnl_loss_threshold = float(getattr(self, 'crash_pnl_drop_threshold_usdt', 5.0))
                    if float(self.last_known_pnl) <= -pnl_loss_threshold:
                        self.logger.warning(f"[{self.symbol}][{self.trade_side}] 🚨 CRASH TRIGGER 3 DISPARADO (Pérdida PnL Anticipada): "
                                            f"PnL actual={self.last_known_pnl:.4f} <= -{pnl_loss_threshold:.2f} USDT. "
                                            f"Eyectando posición a mercado antes de Stop Loss total.")
                        exit_signal = True
                        self.exit_reason = f"emergency_crash_exit_pnl_drop (PnL={self.last_known_pnl:.4f} <= -{pnl_loss_threshold:.2f} USDT)"
            # --- FIN SALIDA DE EMERGENCIA POR CRASH ---

            # --- INICIO NUEVA LÓGICA: TRAILING STOP POR PRECIO ---
            if not exit_signal and self.enable_price_trailing_stop:
                if self.price_trailing_stop_distance_usdt > Decimal('0') and self.current_position:
                    current_market_price = Decimal(str(klines_df.iloc[-1]['close']))
                    is_short = (getattr(self, 'trade_side', 'LONG') == 'SHORT')

                    if is_short:
                        # Para SHORT: registrar el mínimo (suelo)
                        if self.price_trough_since_entry is None or current_market_price < Decimal(str(self.price_trough_since_entry)):
                            self.price_trough_since_entry = float(current_market_price)
                            self.logger.info(f"[{self.symbol}][{self.trade_side}] Nuevo precio suelo para Trailing Stop de Precio: {float(self.price_trough_since_entry):.{price_precision_log}f}")

                        # Armar si PnL alcanza activación
                        if not self.price_trailing_stop_armed and self.last_known_pnl is not None and \
                           self.last_known_pnl >= self.price_trailing_stop_activation_pnl_usdt:
                            self.price_trailing_stop_armed = True
                            self.logger.info(f"[{self.symbol}][{self.trade_side}] Trailing Stop de Precio SHORT ARMADO. PnL actual ({self.last_known_pnl:.4f}) >= Activación ({self.price_trailing_stop_activation_pnl_usdt:.4f})")

                        # Salida: si el precio sube desde el suelo por más de la distancia (techo stop)
                        if self.price_trailing_stop_armed and self.price_trough_since_entry is not None:
                            trailing_stop_price_level = Decimal(str(self.price_trough_since_entry)) + self.price_trailing_stop_distance_usdt
                            self.logger.info(f"[{self.symbol}][{self.trade_side}] Chequeo Salida Trailing Precio SHORT (Habilitado, Armado): "
                                             f"Actual Precio ({current_market_price:.{price_precision_log}f}) vs "
                                             f"Umbral Salida Techo ({trailing_stop_price_level:.{price_precision_log}f} = "
                                             f"Suelo {float(self.price_trough_since_entry):.{price_precision_log}f} + Dist {self.price_trailing_stop_distance_usdt})")
                            if current_market_price >= trailing_stop_price_level:
                                self.logger.warning(f"[{self.symbol}][{self.trade_side}] CONDICIÓN DE SALIDA (TRAILING STOP DE PRECIO SHORT) DETECTADA: "
                                                    f"Precio Actual ({current_market_price:.{price_precision_log}f}) >= Umbral ({trailing_stop_price_level:.{price_precision_log}f})")
                                exit_signal = True
                                self.exit_reason = (f"Price_Trailing_Stop_SHORT (Precio={current_market_price:.{price_precision_log}f}, "
                                                    f"Suelo={float(self.price_trough_since_entry):.{price_precision_log}f}, "
                                                    f"Dist={self.price_trailing_stop_distance_usdt})")
                    else:
                        # Para LONG: registrar el pico máximo
                        if self.price_peak_since_entry is None or current_market_price > Decimal(str(self.price_peak_since_entry)):
                            self.price_peak_since_entry = float(current_market_price)
                            self.logger.info(f"[{self.symbol}] Nuevo precio pico para Trailing Stop de Precio: {float(self.price_peak_since_entry):.{price_precision_log}f}")

                        # Armar el trailing stop si el PNL alcanza el umbral de activación
                        if not self.price_trailing_stop_armed and self.last_known_pnl is not None and \
                           self.last_known_pnl >= self.price_trailing_stop_activation_pnl_usdt:
                            self.price_trailing_stop_armed = True
                            self.logger.info(f"[{self.symbol}] Trailing Stop de Precio ARMADO. PnL actual ({self.last_known_pnl:.4f}) >= Activación ({self.price_trailing_stop_activation_pnl_usdt:.4f})")

                        # Si está armado, verificar condición de salida
                        if self.price_trailing_stop_armed and self.price_peak_since_entry is not None:
                            trailing_stop_price_level = Decimal(str(self.price_peak_since_entry)) - self.price_trailing_stop_distance_usdt
                            self.logger.info(f"[{self.symbol}] Chequeo Salida Trailing Precio (Habilitado, Armado): "
                                             f"Actual Precio ({current_market_price:.{price_precision_log}f}) vs "
                                             f"Umbral Salida ({trailing_stop_price_level:.{price_precision_log}f} = "
                                             f"Pico {float(self.price_peak_since_entry):.{price_precision_log}f} - Dist {self.price_trailing_stop_distance_usdt})")
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
            elif not exit_signal:
                 self.logger.info(f"[{self.symbol}] Salida por Trailing Stop de Precio DESHABILITADA.")
            # --- FIN NUEVA LÓGICA: TRAILING STOP POR PRECIO ---

            # --- INICIO NUEVA LÓGICA: TRAILING STOP POR PNL ---
            if not exit_signal and self.enable_pnl_trailing_stop:
                if self.pnl_trailing_stop_drop_usdt > Decimal('0') and self.last_known_pnl is not None:
                    # Armar el PNL trailing stop si el PNL alcanza el umbral de activación de PNL Trailing
                    if not self.pnl_trailing_stop_armed and self.last_known_pnl >= self.pnl_trailing_stop_activation_usdt:
                        self.pnl_trailing_stop_armed = True
                        self.pnl_peak_since_activation = self.last_known_pnl # El PNL actual es el primer pico
                        self.logger.info(f"[{self.symbol}][{self.trade_side}] Trailing Stop por PNL ARMADO. "
                                         f"PNL actual ({self.last_known_pnl:.4f}) >= Activación PNL TS ({self.pnl_trailing_stop_activation_usdt:.4f}). "
                                         f"Pico PNL inicial: {self.pnl_peak_since_activation:.4f}")

                    # Si está armado, actualizar el pico de PNL y verificar condición de salida
                    if self.pnl_trailing_stop_armed:
                        if self.last_known_pnl > self.pnl_peak_since_activation:
                            self.pnl_peak_since_activation = self.last_known_pnl
                            self.logger.info(f"[{self.symbol}][{self.trade_side}] Nuevo pico de PNL para Trailing Stop por PNL: {self.pnl_peak_since_activation:.4f}")

                        # Calcular el nivel de PNL de salida
                        pnl_trailing_exit_level = self.pnl_peak_since_activation - self.pnl_trailing_stop_drop_usdt
                        self.logger.info(f"[{self.symbol}][{self.trade_side}] Chequeo Salida Trailing PNL (Habilitado, Armado): "
                                         f"Actual PNL ({self.last_known_pnl:.4f}) vs "
                                         f"Umbral Salida PNL ({pnl_trailing_exit_level:.4f} = "
                                         f"Pico PNL {self.pnl_peak_since_activation:.4f} - Caída {self.pnl_trailing_stop_drop_usdt})")

                        if self.last_known_pnl <= pnl_trailing_exit_level:
                            self.logger.warning(f"[{self.symbol}][{self.trade_side}] CONDICIÓN DE SALIDA (TRAILING STOP POR PNL) DETECTADA (Habilitado): "
                                                f"PNL Actual ({self.last_known_pnl:.4f}) <= Umbral PNL ({pnl_trailing_exit_level:.4f})")
                            exit_signal = True
                            self.exit_reason = (f"PNL_Trailing_Stop (PNL={self.last_known_pnl:.4f}, "
                                                f"PicoPNL={self.pnl_peak_since_activation:.4f}, "
                                                f"DropPNL={self.pnl_trailing_stop_drop_usdt})")
                else:
                    if self.pnl_trailing_stop_drop_usdt <= Decimal('0'):
                        self.logger.info(f"[{self.symbol}] Trailing Stop por PNL (Habilitado) pero la distancia de caída no es positiva ({self.pnl_trailing_stop_drop_usdt}). No se evaluará.")
            elif not exit_signal:
                 self.logger.info(f"[{self.symbol}] Salida por Trailing Stop por PNL DESHABILITADA.")
            # --- FIN NUEVA LÓGICA: TRAILING STOP POR PNL ---

            # 3. Activación de RSI objetivo y seguimiento del pico/suelo para Trailing Stop RSI
            if self.last_rsi_value is not None and self.enable_trailing_rsi_stop:
                is_short = (getattr(self, 'trade_side', 'LONG') == 'SHORT')
                pnl_is_pos = (self.last_known_pnl is not None and self.last_known_pnl > Decimal('0'))
                
                if is_short:
                    # En SHORT: el objetivo es que el RSI caiga por debajo de rsi_target (e.g. <= 35)
                    if not self.rsi_objetivo_activado and pnl_is_pos:
                        if self.last_rsi_value <= self.rsi_target:
                            self.rsi_objetivo_activado = True
                            self.rsi_trough_since_target = self.last_rsi_value
                            self.rsi_objetivo_alcanzado_en = pd.Timestamp.now(tz='UTC')
                            self.logger.info(f"[{self.symbol}][{self.trade_side}] RSI objetivo SHORT ({self.rsi_target}) alcanzado con PnL positivo ({self.last_known_pnl:.4f}). Se activa TRAILING RSI STOP. Suelo inicial: {self.rsi_trough_since_target:.2f}")
                    elif self.rsi_objetivo_activado:
                        if getattr(self, 'rsi_trough_since_target', None) is None or self.last_rsi_value < self.rsi_trough_since_target:
                            self.logger.info(f"[{self.symbol}][{self.trade_side}] Nuevo suelo RSI para TRAILING STOP SHORT: {self.last_rsi_value:.2f} (anterior: {getattr(self, 'rsi_trough_since_target', None)})")
                            self.rsi_trough_since_target = self.last_rsi_value
                else:
                    # En LONG: el objetivo es que el RSI suba por encima de rsi_target (e.g. >= 65)
                    if not self.rsi_objetivo_activado and pnl_is_pos:
                        if self.last_rsi_value >= self.rsi_target:
                            self.rsi_objetivo_activado = True
                            self.rsi_peak_since_target = self.last_rsi_value # Inicializar el pico RSI
                            self.rsi_objetivo_alcanzado_en = pd.Timestamp.now(tz='UTC')
                            self.logger.info(f"[{self.symbol}] RSI objetivo ({self.rsi_target}) alcanzado con PnL positivo ({self.last_known_pnl:.4f}). Se activa TRAILING RSI STOP. Pico inicial: {self.rsi_peak_since_target:.2f}")
                    elif self.rsi_objetivo_activado:
                        if self.last_rsi_value > self.rsi_peak_since_target:
                            self.logger.info(f"[{self.symbol}] Nuevo pico RSI para TRAILING STOP: {self.last_rsi_value:.2f} (anterior: {self.rsi_peak_since_target:.2f})")
                            self.rsi_peak_since_target = self.last_rsi_value

            # 4. Salida por TRAILING RSI STOP
            if not exit_signal and self.enable_trailing_rsi_stop:
                is_short = (getattr(self, 'trade_side', 'LONG') == 'SHORT')
                if is_short:
                    if self.rsi_objetivo_activado and getattr(self, 'rsi_trough_since_target', None) is not None and self.last_rsi_value is not None:
                        # Salida cuando el RSI rebota hacia arriba desde el suelo
                        rsi_rebound_threshold = abs(self.rsi_threshold_down)
                        trailing_rsi_exit_level = self.rsi_trough_since_target + rsi_rebound_threshold
                        self.logger.info(f"[{self.symbol}][{self.trade_side}] Chequeo Salida TRAILING RSI SHORT: Actual RSI ({self.last_rsi_value:.2f}) vs Umbral Rebote ({trailing_rsi_exit_level:.2f} = Suelo {self.rsi_trough_since_target:.2f} + Rebote {rsi_rebound_threshold})")
                        if self.last_rsi_value >= trailing_rsi_exit_level:
                            self.logger.warning(f"[{self.symbol}][{self.trade_side}] CONDICIÓN DE SALIDA (TRAILING RSI STOP SHORT) DETECTADA: RSI Actual ({self.last_rsi_value:.2f}) >= Umbral ({trailing_rsi_exit_level:.2f})")
                            exit_signal = True
                            self.exit_reason = f"Trailing_RSI_Stop_SHORT (Actual={self.last_rsi_value:.2f}, Suelo={self.rsi_trough_since_target:.2f}, Rebote={rsi_rebound_threshold})"
                else:
                    if self.rsi_objetivo_activado and self.rsi_peak_since_target is not None and self.last_rsi_value is not None:
                        trailing_rsi_exit_level = self.rsi_peak_since_target + self.rsi_threshold_down
                        self.logger.info(f"[{self.symbol}] Chequeo Salida TRAILING RSI (Habilitado): Actual RSI ({self.last_rsi_value:.2f}) vs Umbral Salida Dinámico ({trailing_rsi_exit_level:.2f} = Pico {self.rsi_peak_since_target:.2f} + Drop {self.rsi_threshold_down})")
                        if self.last_rsi_value <= trailing_rsi_exit_level:
                            self.logger.warning(f"[{self.symbol}] CONDICIÓN DE SALIDA (TRAILING RSI STOP) DETECTADA (Habilitado): RSI Actual ({self.last_rsi_value:.2f}) <= Umbral ({trailing_rsi_exit_level:.2f})")
                            exit_signal = True
                            self.exit_reason = f"Trailing_RSI_Stop (Actual={self.last_rsi_value:.2f}, Pico={self.rsi_peak_since_target:.2f}, Drop={self.rsi_threshold_down})"
            elif not exit_signal:
                 self.logger.info(f"[{self.symbol}] Salida por Trailing RSI Stop DESHABILITADA.")

            # Actualizar telemetría de posición con los últimos picos evaluados
            self.position_diagnostics = self._calculate_position_diagnostics(
                current_market_price=current_market_price if 'current_market_price' in locals() else None
            )

            if exit_signal:
                is_short = (getattr(self, 'trade_side', 'LONG') == 'SHORT')
                close_order_side = 'BUY' if is_short else 'SELL'
                best_exit_price = self._get_best_exit_price(close_order_side)
                if not best_exit_price:
                    self.logger.error(f"[{self.symbol}][{self.trade_side}] No se pudo obtener el mejor precio ({close_order_side}) para la salida. No se colocará orden de salida.")
                    self._update_state(BotState.IN_POSITION) # Mantener en posición
                    return
                
                self.logger.warning(f"[{self.symbol}][{self.trade_side}] SEÑAL DE SALIDA ({self.exit_reason}). Cancelando TP/SL existentes y colocando nueva orden LIMIT {close_order_side} @ {best_exit_price}")
                
                # --- CANCELAR ÓRDENES TP/SL EXISTENTES ANTES DE COLOCAR LA NUEVA ---
                self._cancel_active_tp_sl_orders()
                # --------------------------------------------------------------------
                
                self._place_exit_order(price=best_exit_price, reason=self.exit_reason)
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
            
            # Quitar el margen de la exposición
            self.risk_manager.remove_exposure(self.margin_for_current_position)
            self.logger.info(f"[{self.symbol}] Posición cerrada. Eliminando MARGEN {self.margin_for_current_position} USDT de la exposición.")
            self.margin_for_current_position = Decimal('0')

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
        Respeta estrictamente el trade_side del bot (LONG o SHORT).
        """
        self.logger.info(f"[{self.symbol}][{self.trade_side}] Verificando estado de posición...")
        position_data = get_futures_position(self.symbol, position_side=self.trade_side)

        if position_data:
            pos_amt = Decimal(str(position_data.get('positionAmt', '0')))
            entry_price = Decimal(str(position_data.get('entryPrice', '0')))
            unrealized_pnl = Decimal(str(position_data.get('unRealizedProfit', '0')))

            is_short = (getattr(self, 'trade_side', 'LONG') == 'SHORT')
            is_matching_position = (is_short and pos_amt < Decimal('-1e-9')) or (not is_short and pos_amt > Decimal('1e-9'))

            if is_matching_position:
                actual_qty = abs(pos_amt)
                self.logger.info(f"[{self.symbol}][{self.trade_side}] Verificación: Posición activa confirmada. Cant: {actual_qty}, Entrada: {entry_price}, PnL: {unrealized_pnl}")
                self.in_position = True
                # Actualizar current_position solo si es diferente o no existe
                if not self.current_position or \
                   self.current_position.get('entry_price') != entry_price or \
                   self.current_position.get('quantity') != actual_qty:
                    self.current_position = {
                        'entry_price': entry_price,
                        'quantity': actual_qty,
                        'entry_time': self.current_position.get('entry_time') if self.current_position and self.current_position.get('entry_price') == entry_price else pd.Timestamp.now(tz='UTC'),
                        'position_size_usdt': abs(entry_price * actual_qty),
                        'positionAmt': pos_amt,
                        'side': self.trade_side
                    }
                self.last_known_pnl = unrealized_pnl
                self.last_known_entry_price = entry_price
                self.last_known_position_size = actual_qty
                mark_p = float(position_data.get('markPrice', '0') or 0.0)
                if mark_p <= 0 and abs(pos_amt) > Decimal('1e-9'):
                    mark_p = float(entry_price + (unrealized_pnl / pos_amt))
                if mark_p > 0:
                    self.current_market_price = mark_p
                    if not is_short:
                        if self.price_peak_since_entry is None or mark_p > float(self.price_peak_since_entry):
                            self.price_peak_since_entry = mark_p
                        if self.price_trough_since_entry is None or mark_p < float(self.price_trough_since_entry):
                            self.price_trough_since_entry = mark_p
                    else:
                        if self.price_trough_since_entry is None or mark_p < float(self.price_trough_since_entry):
                            self.price_trough_since_entry = mark_p
                        if self.price_peak_since_entry is None or mark_p > float(self.price_peak_since_entry):
                            self.price_peak_since_entry = mark_p
                self._update_state(BotState.IN_POSITION)
                if self.pending_entry_order_id or self.pending_exit_order_id:
                    self.logger.warning(f"[{self.symbol}][{self.trade_side}] Posición activa encontrada durante _verify_position_status, pero había órdenes pendientes. Limpiando IDs de órdenes pendientes.")
                    self.pending_entry_order_id = None
                    self.pending_exit_order_id = None
                    self.pending_order_timestamp = None
                    self.current_exit_reason = None

                # Asegurar que la posición abierta tenga órdenes protectoras de TP/SL en Binance
                if not self.pending_tp_order_id and not self.pending_sl_order_id:
                    self.logger.info(f"[{self.symbol}][{self.trade_side}] Posición activa verificada sin órdenes TP/SL pendientes. Colocando órdenes de protección...")
                    self._place_tp_sl_orders()

            else: # No hay posición correspondiente a este bot (pos_amt ~ 0 o lado opuesto)
                self.logger.debug(f"[{self.symbol}][{self.trade_side}] Verificación: No hay posición {self.trade_side} abierta en Binance (Cantidad={pos_amt}).")
                if self.in_position: # Si el bot pensaba que estaba en posición
                    self.logger.info(f"[{self.symbol}][{self.trade_side}] El bot pensaba estar en posición pero no existe en Binance. Cerrando...")
                    self._handle_external_closure_or_discrepancy(reason="verify_pos_now_closed")
                else: # Bot no pensaba estar en posición y no hay
                    if self.current_state != BotState.IDLE and self.current_state != BotState.STOPPED:
                        self._reset_state()
                        self._update_state(BotState.IDLE)
        else: # No se pudo obtener info de la posición (API error/timeout)
            self.logger.warning(f"[{self.symbol}][{self.trade_side}] Verificación: No se pudo obtener información de posición de Binance. "
                                f"NO se asumirá cierre. Manteniendo estado actual hasta obtener datos reales.")
            # CRITICAL FIX: NO llamar a _handle_external_closure_or_discrepancy.
            # Mantener el estado actual del bot y reintentar en el próximo ciclo.
            # Esto evita registrar trades falsos cuando hay problemas de red/API.

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
                string_params = ['rsi_type', 'rsi_interval', 'rsi_period', 'rsi_threshold_up', 'rsi_threshold_down', 
                                 'rsi_candles_window', 'rsi_positive_candles_required',
                                 'rsi_entry_level_low', 'rsi_entry_level_high', 'volume_sma_period', 
                                 'volume_factor', 'downtrend_check_candles', 'downtrend_candles_window', 'order_timeout_seconds', 'entry_order_type']
                float_params = ['position_size_usdt', 'take_profit_usdt', 'stop_loss_usdt', 'rsi_target', 'rsi_positive_delta_min',
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
                        gross_pnl_usdt=0.0,
                        commission_usdt=0.0,
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

    def _check_required_downtrend(self, klines_df: pd.DataFrame) -> bool:
        """
        Verifica si las 'N' velas cerradas más recientes muestran una tendencia BAJISTA consecutiva REQUERIDA (para SHORT).
        El valor de 'N' se toma de self.required_downtrend_candles (o required_uptrend_candles si está en modo auto-mirror).
        Devuelve True si se detecta tendencia bajista requerida (o si el chequeo está desactivado N < 2),
        False si no se detecta tendencia bajista y el chequeo está activo (N >= 2).
        """
        n_req = getattr(self, 'required_downtrend_candles', 0)
        if n_req < 2:
            n_req = getattr(self, 'required_uptrend_candles', 0)

        if n_req < 2:
            self.logger.debug(f"[{self.symbol}][{self.trade_side}] Requisito de tendencia bajista reciente (N_req={n_req}) desactivado o no aplicable. Condición cumplida por defecto.")
            return True

        if len(klines_df) < n_req + 1:
            self.logger.warning(f"[{self.symbol}][{self.trade_side}] No hay suficientes klines ({len(klines_df)}) para REQUERIR tendencia bajista de {n_req} velas. Condición NO cumplida.")
            return False

        closes = klines_df['close']
        for i in range(n_req - 1):
            current_candle_in_sequence_close = closes.iloc[-(2 + i)]
            previous_to_current_close = closes.iloc[-(3 + i)]

            if current_candle_in_sequence_close >= previous_to_current_close:
                self.logger.info(f"[{self.symbol}][{self.trade_side}] REQUISITO de tendencia bajista ({n_req} velas) NO CUMPLIDO. "
                                 f"Vela {-(2+i)} ({current_candle_in_sequence_close:.8f}) no fue < vela {-(3+i)} ({previous_to_current_close:.8f}).")
                return False

        self.logger.info(f"[{self.symbol}][{self.trade_side}] REQUISITO de tendencia bajista ({n_req} velas) CUMPLIDO.")
        return True

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
        lev = int(getattr(self, 'leverage', 20) or 20)
        entry_p = float(self.last_known_entry_price or 0)
        pos_s = float(self.last_known_position_size or 0)
        pos_val = abs(entry_p * pos_s) if self.in_position else 0.0
        marg_usdt = (pos_val / lev) if (self.in_position and lev > 0) else 0.0

        curr_p = float(getattr(self, 'current_market_price', 0) or 0)
        peak_p = float(getattr(self, 'price_peak_since_entry', 0) or 0)
        trough_p = float(getattr(self, 'price_trough_since_entry', 0) or 0)

        # Si estamos en posición, asegurar que curr_p refleje el precio en tiempo real
        if self.in_position and entry_p > 0 and abs(pos_s) > 1e-9:
            last_pnl = float(self.last_known_pnl or 0)
            derived_curr = entry_p + (last_pnl / pos_s)
            if derived_curr > 0:
                if curr_p <= 0 or (abs(curr_p - entry_p) < 1e-6 and abs(last_pnl) > 0.0001):
                    curr_p = derived_curr
                    self.current_market_price = curr_p

            is_short = (getattr(self, 'trade_side', 'LONG') == 'SHORT')
            if not is_short:
                if peak_p <= 0 or curr_p > peak_p:
                    peak_p = max(entry_p, curr_p)
                    self.price_peak_since_entry = peak_p
                if trough_p <= 0 or (curr_p > 0 and curr_p < trough_p):
                    trough_p = min(entry_p, curr_p)
                    self.price_trough_since_entry = trough_p
            else:
                if trough_p <= 0 or (curr_p > 0 and curr_p < trough_p):
                    trough_p = min(entry_p, curr_p)
                    self.price_trough_since_entry = trough_p
                if peak_p <= 0 or curr_p > peak_p:
                    peak_p = max(entry_p, curr_p)
                    self.price_peak_since_entry = peak_p
        elif self.in_position and curr_p <= 0 and entry_p > 0:
            curr_p = entry_p

        price_change_pct = 0.0
        if self.in_position and entry_p > 0 and curr_p > 0:
            if getattr(self, 'trade_side', 'LONG') == 'SHORT':
                price_change_pct = round(((entry_p - curr_p) / entry_p) * 100.0, 2)
            else:
                price_change_pct = round(((curr_p - entry_p) / entry_p) * 100.0, 2)

        drop_from_peak_pct = 0.0
        rise_from_trough_pct = 0.0
        if self.in_position and curr_p > 0:
            if getattr(self, 'trade_side', 'LONG') == 'SHORT':
                eff_trough = min(trough_p, curr_p, entry_p) if (trough_p > 0 and entry_p > 0) else curr_p
                if eff_trough > 0:
                    rise_from_trough_pct = round(((curr_p - eff_trough) / eff_trough) * 100.0, 2)
            else:
                eff_peak = max(peak_p, curr_p, entry_p) if (peak_p > 0 and entry_p > 0) else curr_p
                if eff_peak > 0:
                    drop_from_peak_pct = round(((eff_peak - curr_p) / eff_peak) * 100.0, 2)

        return {
            "symbol": self.symbol,
            "trade_side": getattr(self, 'trade_side', 'LONG'),
            "strategy_name": getattr(self, 'strategy_name', '') or 'v3_RSI-SNIPER-MOMENTUM_v3',
            "state": self.state.value if self.state else "N/A",
            "is_running": self.is_running,
            "is_paused": getattr(self, 'is_paused', False),
            "in_position": self.in_position,
            "current_pnl": self.last_known_pnl if self.in_position else 0.0,
            "historical_pnl": float(self.historical_pnl),
            "session_pnl": float(self.session_pnl), # <-- NUEVO: Reportar PNL de sesión
            "entry_price": self.last_known_entry_price,
            "current_price": curr_p if curr_p > 0 else None,
            "price_peak": peak_p if peak_p > 0 else (curr_p if curr_p > 0 else None),
            "price_trough": trough_p if trough_p > 0 else (curr_p if curr_p > 0 else None),
            "price_change_pct": price_change_pct if self.in_position else None,
            "drop_from_peak_pct": drop_from_peak_pct if (self.in_position and getattr(self, 'trade_side', 'LONG') == 'LONG') else None,
            "rise_from_trough_pct": rise_from_trough_pct if (self.in_position and getattr(self, 'trade_side', 'LONG') == 'SHORT') else None,
            "position_size": self.last_known_position_size,
            "leverage": lev,
            "position_value_usdt": round(pos_val, 2),
            "margin_usdt": round(marg_usdt, 2),
            "pending_entry_order_id": self.pending_entry_order_id,
            "pending_exit_order_id": self.pending_exit_order_id,
            "pending_tp_order_id": self.pending_tp_order_id,
            "pending_sl_order_id": self.pending_sl_order_id,
            "last_error": self.last_error_message,
            "entry_reason": self.entry_reason,
            "exit_reason": self.exit_reason,
            "entry_diagnostics": getattr(self, "entry_diagnostics", {}),
            "position_diagnostics": getattr(self, "position_diagnostics", {}),
            "pause_reason": getattr(self, "pause_reason", ""),
            "cooldown_until_ts": getattr(self, "cooldown_until_ts", 0.0),
            "cooldown_remaining_seconds": max(0, int(getattr(self, "cooldown_until_ts", 0.0) - time.time())) if getattr(self, "cooldown_until_ts", 0.0) > 0 else 0,
            "consecutive_losses": getattr(self, "consecutive_losses_count", 0),
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
        self._check_entry_conditions(klines_df)

    # --- Lógica del Sistema de Re-entradas y Órdenes de Seguridad (DCA) ---
    def _check_pending_reentry_order(self):
        """
        Verifica el estado de una orden de re-entrada DCA colocada en Binance.
        """
        if not self.pending_reentry_order_id:
            return

        try:
            order_info = get_futures_order(self.symbol, self.pending_reentry_order_id)
            if not order_info:
                return

            status = order_info.get('status')
            if status == 'FILLED':
                self.reentries_done += 1
                self.logger.info(f"[{self.symbol}] 🎉 RE-ENTRADA DCA #{self.reentries_done} EJECUTADA exitosamente @ {self.pending_reentry_price}. Posición promediada.")
                self.pending_reentry_order_id = None
                self.pending_reentry_price = None
                self.pending_reentry_qty = None

                # Actualizar datos de la posición promediada desde Binance
                pos_data = get_futures_position(self.symbol, position_side=self.trade_side)
                if pos_data and self.current_position:
                    pos_amt = Decimal(str(pos_data.get('positionAmt', '0')))
                    entry_p = Decimal(str(pos_data.get('entryPrice', '0')))
                    if abs(pos_amt) > Decimal('1e-9'):
                        self.current_position['entry_price'] = entry_p
                        self.current_position['quantity'] = abs(pos_amt)
                        self.current_position['position_size_usdt'] = abs(entry_p * pos_amt)
                        self.last_known_entry_price = entry_p
                        self.last_known_position_size = abs(pos_amt)
                        self.logger.info(f"[{self.symbol}][{self.trade_side}] Posición promediada actualizada: Nuevo Precio Promedio={entry_p}, Cantidad Total={abs(pos_amt)}")

                        # Cancelar órdenes anteriores de TP y SL en Binance para actualizar al nuevo promedio
                        if self.pending_tp_order_id:
                            self.logger.info(f"[{self.symbol}][{self.trade_side}] Cancelando orden TP anterior {self.pending_tp_order_id} tras DCA.")
                            try:
                                cancel_futures_order(self.symbol, self.pending_tp_order_id)
                            except Exception as cancel_err:
                                self.logger.warning(f"[{self.symbol}] Error al cancelar TP anterior: {cancel_err}")
                            self.pending_tp_order_id = None

                        if self.pending_sl_order_id:
                            self.logger.info(f"[{self.symbol}][{self.trade_side}] Cancelando orden SL anterior {self.pending_sl_order_id} tras DCA.")
                            try:
                                cancel_futures_order(self.symbol, self.pending_sl_order_id)
                            except Exception as cancel_err:
                                self.logger.warning(f"[{self.symbol}] Error al cancelar SL anterior: {cancel_err}")
                            self.pending_sl_order_id = None

                        # Colocar nuevas órdenes TP/SL ajustadas al nuevo precio promedio y cantidad
                        self.logger.info(f"[{self.symbol}][{self.trade_side}] Re-colocando órdenes TP/SL para la posición promediada.")
                        self._place_tp_sl_orders()
            elif status in ['CANCELED', 'EXPIRED', 'REJECTED']:
                self.logger.info(f"[{self.symbol}][{self.trade_side}] Orden de Re-entrada DCA cancelada o expirada ({status}). Limpiando ID pendiente.")
                self.pending_reentry_order_id = None
                self.pending_reentry_price = None
                self.pending_reentry_qty = None
        except Exception as e:
            self.logger.error(f"[{self.symbol}][{self.trade_side}] Error verificando orden de re-entrada DCA {self.pending_reentry_order_id}: {e}", exc_info=True)

    def _evaluate_dca_reentry(self, klines_df: pd.DataFrame):
        """
        Evalúa si el precio se ha movido desfavorablemente lo suficiente para colocar una orden de re-entrada (DCA).
        Para LONG: si el precio cae.
        Para SHORT: si el precio sube.
        """
        if not self.enable_dca_reentry:
            return

        if not self.in_position or not self.current_position:
            return

        if self.reentries_done >= self.dca_max_reentries:
            self.logger.debug(f"[{self.symbol}][{self.trade_side}] Re-entradas DCA máximas alcanzadas ({self.reentries_done}/{self.dca_max_reentries}).")
            return

        # Si ya hay una orden colocada esperando ejecución, verificar su estado
        if self.pending_reentry_order_id:
            self._check_pending_reentry_order()
            return

        entry_price = self.current_position.get('entry_price', Decimal('0'))
        if entry_price <= Decimal('0'):
            return

        current_market_price = Decimal(str(klines_df['close'].iloc[-1]))
        target_reentry_price = None
        is_short = (getattr(self, 'trade_side', 'LONG') == 'SHORT')
        reentry_side = 'SELL' if is_short else 'BUY'

        if self.dca_reentry_mode == 'next_support' and not is_short:
            # Modo: Siguiente Soporte Confirmado (solo LONG)
            confirmed_supports = self._find_support_levels(klines_df)
            lower_supports = [s for s in confirmed_supports if s < (entry_price * Decimal('0.998'))]
            if lower_supports:
                target_reentry_price = max(lower_supports)
                self.logger.info(f"[{self.symbol}][{self.trade_side}] Re-entrada DCA por Soporte: detectado soporte en {target_reentry_price}")
        else:
            # Modo: Porcentaje Fijo (Caída para LONG, Subida para SHORT)
            if is_short:
                rise_factor = Decimal('1') + (Decimal(str(self.dca_price_drop_percent)) / Decimal('100'))
                target_reentry_price = entry_price * rise_factor
            else:
                drop_factor = Decimal('1') - (Decimal(str(self.dca_price_drop_percent)) / Decimal('100'))
                target_reentry_price = entry_price * drop_factor

        if target_reentry_price and target_reentry_price > Decimal('0'):
            if is_short:
                # En SHORT, la orden LIMIT SELL de re-entrada debe estar por encima del precio de mercado actual
                if target_reentry_price <= current_market_price:
                    target_reentry_price = current_market_price * Decimal('1.001')
            else:
                # En LONG, la orden LIMIT BUY de re-entrada debe estar por debajo del precio de mercado actual
                if target_reentry_price >= current_market_price:
                    target_reentry_price = current_market_price * Decimal('0.999')

            # Calcular tamaño de la orden con el multiplicador de volumen
            base_size = Decimal(str(self.position_size_usdt))
            multiplier = Decimal(str(self.dca_volume_multiplier)) if Decimal(str(self.dca_volume_multiplier)) > Decimal('0') else Decimal('1.0')
            order_margin_usdt = base_size * (multiplier ** Decimal(str(self.reentries_done + 1)))

            # Validar con el RiskManager global
            if self.risk_manager and not self.risk_manager.can_open_position(order_margin_usdt):
                self.logger.warning(f"[{self.symbol}][{self.trade_side}] Re-entrada DCA denegada por RiskManager (Margen requerido: {order_margin_usdt:.2f} USDT).")
                return

            notional_order_usdt = order_margin_usdt * Decimal(str(self.leverage))
            adj_price = self._adjust_price(target_reentry_price)
            if not adj_price or adj_price <= Decimal('0'):
                return

            quantity = notional_order_usdt / adj_price
            adj_qty = self._adjust_quantity(quantity)

            if adj_qty and adj_qty > Decimal('0'):
                self.logger.info(f"[{self.symbol}][{self.trade_side}] Colocando Orden de Re-entrada DCA #{self.reentries_done + 1} ({reentry_side}) en {adj_price} (Margen: {order_margin_usdt:.2f} USDT, Cantidad: {adj_qty}).")
                result = create_futures_limit_order(self.symbol, reentry_side, adj_qty, adj_price, position_side=self.trade_side)
                if result and 'orderId' in result:
                    self.pending_reentry_order_id = result['orderId']
                    self.pending_reentry_price = adj_price
                    self.pending_reentry_qty = adj_qty
                    self.logger.info(f"[{self.symbol}][{self.trade_side}] 🛡️ Orden de Re-entrada DCA #{self.reentries_done + 1} colocada con ID {result['orderId']}.")
                else:
                    self.logger.error(f"[{self.symbol}][{self.trade_side}] Fallo al colocar orden de re-entrada DCA en {adj_price}.")
    # ---------------------------------------------------------------------

class TradingBot:
    """
    Coordinador de trading que soporta ejecución Bidireccional (LONG y SHORT simultáneos en Hedge Mode).
    Instancia y gestiona SingleSideTradingBot para LONG y/o SHORT según la configuración.
    """
    def __init__(self, symbol: str = None, trading_params: dict = None, risk_manager = None):
        self.logger = get_logger()
        if trading_params is None:
            from src.config_loader import load_trading_params
            trading_params = load_trading_params()
        if symbol is None:
            symbol = trading_params.get('symbol', 'ADAUSDT')
            
        self.symbol = symbol
        self.params = trading_params
        self.risk_manager = risk_manager
        self.trade_direction = str(self.params.get('trade_direction', 'BIDIRECTIONAL')).upper().strip()
        self.auto_mirror_short = str(self.params.get('auto_mirror_short', 'true')).lower() == 'true'
        self._is_paused = False
        self._state = BotState.INITIALIZING
        
        self.long_bot: SingleSideTradingBot | None = None
        self.short_bot: SingleSideTradingBot | None = None
        
        # Inicializar bot LONG
        if self.trade_direction in ('LONG', 'BIDIRECTIONAL'):
            self.long_bot = SingleSideTradingBot(
                symbol=self.symbol,
                trading_params=self.params,
                risk_manager=self.risk_manager,
                trade_side='LONG'
            )
            
        # Inicializar bot SHORT
        if self.trade_direction in ('SHORT', 'BIDIRECTIONAL'):
            if self.auto_mirror_short:
                from src.config_loader import derive_short_params
                short_params = derive_short_params(self.params)
            else:
                short_params = self.params.copy()
                short_params['trade_side'] = 'SHORT'
            self.short_bot = SingleSideTradingBot(
                symbol=self.symbol,
                trading_params=short_params,
                risk_manager=self.risk_manager,
                trade_side='SHORT'
            )

        self.logger.info(f"[{self.symbol}] TradingBot coordinador inicializado (Dirección: {self.trade_direction}, Auto-Mirror: {self.auto_mirror_short}). LONG activo: {self.long_bot is not None}, SHORT activo: {self.short_bot is not None}")

    def run_once(self):
        if self.long_bot:
            try:
                self.long_bot.run_once()
            except Exception as e:
                self.logger.error(f"[{self.symbol}][LONG] Error en run_once: {e}", exc_info=True)
        if self.short_bot:
            try:
                self.short_bot.run_once()
            except Exception as e:
                self.logger.error(f"[{self.symbol}][SHORT] Error en run_once: {e}", exc_info=True)

    def _check_initial_position(self):
        if self.long_bot:
            self.long_bot._check_initial_position()
        if self.short_bot:
            self.short_bot._check_initial_position()

    def reset_session_pnl(self):
        if self.long_bot:
            self.long_bot.reset_session_pnl()
        if self.short_bot:
            self.short_bot.reset_session_pnl()

    def _set_error_state(self, error_message: str):
        self._state = BotState.ERROR
        if self.long_bot:
            self.long_bot._set_error_state(error_message)
        if self.short_bot:
            self.short_bot._set_error_state(error_message)

    def close_position_now(self, reason: str = "Cierre Manual", side: str | None = None) -> bool:
        target_side = (side or '').upper().strip()
        if target_side == 'LONG':
            return self.long_bot.close_position_now(reason) if self.long_bot else False
        elif target_side == 'SHORT':
            return self.short_bot.close_position_now(reason) if self.short_bot else False
        else:
            res = True
            if self.long_bot and self.long_bot.in_position:
                res = self.long_bot.close_position_now(reason) and res
            if self.short_bot and self.short_bot.in_position:
                res = self.short_bot.close_position_now(reason) and res
            return res

    def update_trading_params(self, new_params: dict):
        if not new_params:
            return
        self.params = {**self.params, **new_params}
        if 'trade_direction' in new_params:
            self.trade_direction = str(new_params['trade_direction']).upper().strip()
        if 'auto_mirror_short' in new_params:
            self.auto_mirror_short = str(new_params['auto_mirror_short']).lower() == 'true'

        if self.trade_direction in ('LONG', 'BIDIRECTIONAL'):
            if self.long_bot is None:
                self.long_bot = SingleSideTradingBot(self.symbol, self.params, self.risk_manager, trade_side='LONG')
            else:
                self.long_bot.update_trading_params(self.params)

        if self.trade_direction in ('SHORT', 'BIDIRECTIONAL'):
            if self.auto_mirror_short:
                from src.config_loader import derive_short_params
                short_p = derive_short_params(self.params)
            else:
                short_p = self.params.copy()
                short_p['trade_side'] = 'SHORT'
            if self.short_bot is None:
                self.short_bot = SingleSideTradingBot(self.symbol, short_p, self.risk_manager, trade_side='SHORT')
            else:
                self.short_bot.update_trading_params(short_p)

    @property
    def is_paused(self) -> bool:
        if self._is_paused:
            return True
        active_bots = [b for b in [self.long_bot, self.short_bot] if b is not None]
        if active_bots and all(getattr(b, 'is_paused', False) for b in active_bots):
            return True
        return False

    @is_paused.setter
    def is_paused(self, val: bool):
        self._is_paused = bool(val)
        if self.long_bot:
            self.long_bot.is_paused = self._is_paused
        if self.short_bot:
            self.short_bot.is_paused = self._is_paused

    @property
    def state(self) -> BotState:
        if (self.long_bot and self.long_bot.state == BotState.ERROR) or (self.short_bot and self.short_bot.state == BotState.ERROR):
            return BotState.ERROR
        if (self.long_bot and self.long_bot.in_position) or (self.short_bot and self.short_bot.in_position):
            return BotState.IN_POSITION
        if self.long_bot:
            return self.long_bot.state
        if self.short_bot:
            return self.short_bot.state
        return self._state

    @state.setter
    def state(self, val: BotState):
        self._state = val
        if self.long_bot:
            self.long_bot.state = val
        if self.short_bot:
            self.short_bot.state = val

    @property
    def in_position(self) -> bool:
        return bool((self.long_bot and self.long_bot.in_position) or (self.short_bot and self.short_bot.in_position))

    @property
    def margin_for_current_position(self) -> Decimal:
        m = Decimal('0')
        if self.long_bot and hasattr(self.long_bot, 'margin_for_current_position'):
            m += self.long_bot.margin_for_current_position
        if self.short_bot and hasattr(self.short_bot, 'margin_for_current_position'):
            m += self.short_bot.margin_for_current_position
        return m

    @property
    def current_position(self) -> dict | None:
        if self.long_bot and self.long_bot.current_position:
            return self.long_bot.current_position
        if self.short_bot and self.short_bot.current_position:
            return self.short_bot.current_position
        return None

    @property
    def position_size_usdt(self) -> Decimal:
        s = Decimal('0')
        if self.long_bot and hasattr(self.long_bot, 'position_size_usdt'):
            s += Decimal(str(self.long_bot.position_size_usdt))
        if self.short_bot and hasattr(self.short_bot, 'position_size_usdt'):
            s += Decimal(str(self.short_bot.position_size_usdt))
        return s

    @property
    def is_running(self) -> bool:
        return bool((self.long_bot and self.long_bot.is_running) or (self.short_bot and self.short_bot.is_running))

    def get_status(self) -> dict:
        positions = []
        tot_current_pnl = 0.0
        tot_hist_pnl = 0.0
        tot_session_pnl = 0.0
        tot_margin = 0.0
        tot_pos_val = 0.0

        long_st = self.long_bot.get_status() if self.long_bot else None
        short_st = self.short_bot.get_status() if self.short_bot else None

        if long_st:
            long_st['trade_side'] = 'LONG'
            positions.append(long_st)
            if long_st.get('in_position'):
                tot_current_pnl += float(long_st.get('current_pnl') or 0.0)
                tot_margin += float(long_st.get('margin_usdt') or 0.0)
                tot_pos_val += float(long_st.get('position_value_usdt') or 0.0)
            tot_hist_pnl += float(long_st.get('historical_pnl') or 0.0)
            tot_session_pnl += float(long_st.get('session_pnl') or 0.0)

        if short_st:
            short_st['trade_side'] = 'SHORT'
            positions.append(short_st)
            if short_st.get('in_position'):
                tot_current_pnl += float(short_st.get('current_pnl') or 0.0)
                tot_margin += float(short_st.get('margin_usdt') or 0.0)
                tot_pos_val += float(short_st.get('position_value_usdt') or 0.0)
            tot_hist_pnl += float(short_st.get('historical_pnl') or 0.0)
            tot_session_pnl += float(short_st.get('session_pnl') or 0.0)

        primary = long_st or short_st or {}
        st_copy = primary.copy()

        # Cooldown y pausas agregadas
        long_cd = long_st.get('cooldown_remaining_seconds', 0) if long_st else 0
        short_cd = short_st.get('cooldown_remaining_seconds', 0) if short_st else 0
        max_cd = max(long_cd, short_cd)

        pause_reasons = []
        if long_st and long_st.get('is_paused') and long_st.get('pause_reason'):
            pause_reasons.append(f"LONG: {long_st.get('pause_reason')}")
        if short_st and short_st.get('is_paused') and short_st.get('pause_reason'):
            pause_reasons.append(f"SHORT: {short_st.get('pause_reason')}")
        combined_pause_reason = " | ".join(pause_reasons) if pause_reasons else (getattr(self, 'pause_reason', '') or '')

        # Consolidar diagnóstico de entrada eligiendo el bot con señal activa o mayor avance
        long_diag = (long_st and long_st.get('entry_diagnostics')) or {}
        short_diag = (short_st and short_st.get('entry_diagnostics')) or {}

        # Ignorar señales de bots pausados o que ya están en posición
        long_eligible = bool(long_st and not long_st.get('is_paused') and not long_st.get('in_position'))
        short_eligible = bool(short_st and not short_st.get('is_paused') and not short_st.get('in_position'))

        chosen_diag = {}
        if short_eligible and short_diag.get('all_met'):
            chosen_diag = short_diag
        elif long_eligible and long_diag.get('all_met'):
            chosen_diag = long_diag
        elif long_eligible and short_eligible:
            l_passed = long_diag.get('passed_count', 0)
            s_passed = short_diag.get('passed_count', 0)
            chosen_diag = short_diag if s_passed > l_passed else long_diag
        elif long_eligible:
            chosen_diag = long_diag
        elif short_eligible:
            chosen_diag = short_diag
        else:
            chosen_diag = long_diag or short_diag or {}

        # Agregar IDs de órdenes pendientes de cualquiera de los bots activos
        pending_entry = (long_st and long_st.get('pending_entry_order_id')) or (short_st and short_st.get('pending_entry_order_id'))
        pending_exit = (long_st and long_st.get('pending_exit_order_id')) or (short_st and short_st.get('pending_exit_order_id'))
        pending_tp = (long_st and long_st.get('pending_tp_order_id')) or (short_st and short_st.get('pending_tp_order_id'))
        pending_sl = (long_st and long_st.get('pending_sl_order_id')) or (short_st and short_st.get('pending_sl_order_id'))

        curr_p = (long_st and long_st.get('current_price')) or (short_st and short_st.get('current_price'))
        active_positions = [p for p in positions if p.get('in_position')]
        unified_state = self.state.value if hasattr(self.state, 'value') else str(self.state)

        st_copy.update({
            "symbol": self.symbol,
            "trade_direction": self.trade_direction,
            "auto_mirror_short": self.auto_mirror_short,
            "state": unified_state,
            "in_position": self.in_position,
            "current_pnl": round(tot_current_pnl, 4),
            "historical_pnl": round(tot_hist_pnl, 4),
            "session_pnl": round(tot_session_pnl, 4),
            "margin_usdt": round(tot_margin, 2),
            "position_value_usdt": round(tot_pos_val, 2),
            "positions": positions,
            "long_status": long_st,
            "short_status": short_st,
            "is_paused": self.is_paused,
            "cooldown_remaining_seconds": max_cd,
            "pause_reason": combined_pause_reason,
            "current_price": curr_p,
            "pending_entry_order_id": pending_entry,
            "pending_exit_order_id": pending_exit,
            "pending_tp_order_id": pending_tp,
            "pending_sl_order_id": pending_sl,
            "entry_diagnostics": chosen_diag,
            "long_entry_diagnostics": long_diag,
            "short_entry_diagnostics": short_diag,
        })
        if len(active_positions) == 1:
            sp = active_positions[0]
            st_copy['entry_price'] = sp.get('entry_price')
            st_copy['current_price'] = sp.get('current_price')
            st_copy['price_change_pct'] = sp.get('price_change_pct')
            st_copy['price_peak'] = sp.get('price_peak')
            st_copy['price_trough'] = sp.get('price_trough')
            st_copy['drop_from_peak_pct'] = sp.get('drop_from_peak_pct')
            st_copy['rise_from_trough_pct'] = sp.get('rise_from_trough_pct')

        return st_copy

    def get_current_status(self) -> dict:
        return self.get_status()

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