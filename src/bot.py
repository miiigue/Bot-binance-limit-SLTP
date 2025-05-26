# Este módulo contendrá la lógica principal del bot y coordinará los demás módulos.
# Por ahora, lo dejamos vacío. 

import time
import pandas as pd
from decimal import Decimal, ROUND_DOWN, ROUND_UP
import math
from enum import Enum # <-- Importar Enum
import os

# Importamos los módulos que hemos creado
# from .config_loader import load_config # No se usa directamente aquí ahora
from .logger_setup import get_logger
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
    get_user_trade_history # <-- NUEVA IMPORTACIÓN
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
    def __init__(self, symbol: str, trading_params: dict):
        """
        Inicializa el bot para un símbolo específico.
        Lee parámetros, inicializa el cliente, obtiene información del símbolo y estado inicial.
        """
        self.symbol = symbol.upper()
        self.logger = get_logger()
        self.params = trading_params # <-- STORE the params dictionary
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
        # -------------------------------------------------------------
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

        # Obtener información del símbolo (precisión, tick size) - usa self.symbol
        self.symbol_info = get_futures_symbol_info(self.symbol)
        if not self.symbol_info:
            self.logger.critical(f"[{self.symbol}] No se pudo obtener información para el símbolo. Abortando worker.")
            raise ValueError(f"Información de símbolo {self.symbol} no disponible")

        self.qty_precision = int(self.symbol_info.get('quantityPrecision', 0))
        self.price_tick_size = None
        for f in self.symbol_info.get('filters', []):
            if f.get('filterType') == 'PRICE_FILTER':
                self.price_tick_size = Decimal(f.get('tickSize', '0.00000001'))
                break
        if self.price_tick_size is None:
             self.logger.warning(f"[{self.symbol}] No se encontró PRICE_FILTER tickSize, redondeo de precio puede ser impreciso.")

        # La inicialización de DB y esquema es global, no se hace aquí

        # Estado inicial del bot para ESTE símbolo
        self.in_position = False
        self.current_position = None
        self.last_rsi_value = None
        
        # --- Nuevo estado para órdenes LIMIT pendientes ---
        self.pending_entry_order_id = None  # Guarda el ID de la orden LIMIT BUY pendiente
        self.pending_exit_order_id = None   # Guarda el ID de la orden LIMIT SELL pendiente
        self.pending_order_timestamp = None # Guarda el time.time() cuando se creó la orden pendiente
        # self.current_exit_reason = None # Movido arriba con otros estados internos
        # --------------------------------------------------
        
        # self.last_known_pnl = None # Ya inicializado arriba
        
        self._check_initial_position() # Llama a get_futures_position con self.symbol

        # --- LÓGICA DE ESTADO FINAL MODIFICADA ---
        # Si no estamos en un estado de error después de las verificaciones iniciales...
        if self.current_state == BotState.INITIALIZING:
            # ...decidir el estado basado en si se encontró una posición.
            if self.in_position:
                 self._update_state(BotState.IN_POSITION) # Estado correcto si hay posición
                 self.logger.info(f"[{self.symbol}] Inicialización completa. Posición existente detectada. Transicionando a estado IN_POSITION.")
            else:
                 self._update_state(BotState.IDLE) # Estado correcto si no hay posición
                 self.logger.info(f"[{self.symbol}] Inicialización completa. No hay posición. Transicionando a estado IDLE.")
        # Si hubo un error antes, el estado ya será BotState.ERROR y no se cambia aquí.
        # --- FIN DE LÓGICA MODIFICADA ---

        self.logger.info(f"[{self.symbol}] Worker inicializado exitosamente (Timeout Órdenes: {self.order_timeout_seconds}s).")

        # --- NUEVA VARIABLE PARA TRAILING RSI STOP ---
        self.rsi_peak_since_target = None # Almacenará el RSI más alto desde que rsi_target fue alcanzado
        # --------------------------------------------

        # --- Limpiar también estado de trailing de precio ---
        self.price_peak_since_entry = None
        self.price_trailing_stop_armed = False
        # --- Limpiar también estado de trailing de PNL ---
        self.pnl_peak_since_activation = None
        self.pnl_trailing_stop_armed = False
        # ----------------------------------------------------

    def _check_initial_position(self):
        """Consulta a Binance si ya existe una posición para self.symbol."""
        self.logger.info(f"[{self.symbol}] Verificando posición inicial...")
        position_data = get_futures_position(self.symbol) # Usa self.symbol
        if position_data:
            pos_amt = Decimal(position_data.get('positionAmt', '0'))
            entry_price = Decimal(position_data.get('entryPrice', '0'))
            unrealized_pnl = Decimal(position_data.get('unRealizedProfit', '0'))
            if abs(pos_amt) > Decimal('1e-9'):
                 if pos_amt > 0: # Solo LONG
                     self.logger.warning(f"[{self.symbol}] ¡Posición LONG existente encontrada! Cantidad: {pos_amt}, Precio Entrada: {entry_price}, PnL Inicial: {unrealized_pnl}")
                     self.in_position = True
                     self.current_position = {
                         'entry_price': entry_price,
                         'quantity': pos_amt,
                         'entry_time': pd.Timestamp.now(tz='UTC'), # Placeholder time
                         'position_size_usdt': abs(pos_amt * entry_price),
                         'positionAmt': pos_amt
                     }
                     self.last_known_pnl = unrealized_pnl
                 else:
                      self.logger.warning(f"[{self.symbol}] ¡Posición SHORT existente encontrada! Cantidad: {pos_amt}. Este bot no maneja SHORTs.")
                      # Even if SHORT, reset PnL state if bot thought it was LONG
                      if self.in_position:
                          self._reset_state() # Reset state if found SHORT but thought LONG
            else:
                self.logger.info(f"[{self.symbol}] No hay posición abierta inicialmente (PosAmt ~ 0).")
                # Ensure state consistency if bot thought it was in position
                if self.in_position: 
                     self._reset_state()
                else:
                    # Ensure these are None if no position
                    self.in_position = False
                    self.current_position = None
                    self.last_known_pnl = None
        else:
            # Could not get position info or no position exists
            self.logger.info(f"[{self.symbol}] No se pudo obtener información de posición inicial o no existe.")
            # Ensure state consistency
            if self.in_position:
                self._reset_state()
            else:
                self.in_position = False
                self.current_position = None
                self.last_known_pnl = None

        # Asegurarse de que no hay órdenes pendientes si encontramos una posición inicial
        if self.in_position:
             self.pending_entry_order_id = None
             self.pending_exit_order_id = None
             self.pending_order_timestamp = None
             self.current_exit_reason = None # <-- Resetear razón de salida
             # Si estamos en posición, es posible que TP/SL ya existan si el bot se reinició.
             # Por ahora, el bot no tiene lógica para recuperar TP/SL existentes al inicio.
             # Se asumirá que si se reinicia en posición, se manejará manualmente o por lógica de PnL si TP/SL no se colocan.
             self.pending_tp_order_id = None # Limpiar al inicio por ahora
             self.pending_sl_order_id = None # Limpiar al inicio por ahora

    def _adjust_quantity(self, quantity: Decimal) -> float:
        """Ajusta la cantidad a la precisión requerida por self.symbol."""
        adjusted_qty = quantity.quantize(Decimal('1e-' + str(self.qty_precision)), rounding=ROUND_DOWN)
        self.logger.debug(f"[{self.symbol}] Cantidad original: {quantity:.8f}, Precisión: {self.qty_precision}, Cantidad ajustada: {adjusted_qty:.8f}")
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

                if filled_price > Decimal('0') and filled_qty > Decimal('0'):
                    self._handle_successful_closure(
                        close_price=filled_price,
                        quantity_closed=filled_qty,
                        reason=f"take_profit_order_filled ({self.pending_tp_order_id})",
                        close_timestamp=close_timestamp
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

                if filled_price > Decimal('0') and filled_qty > Decimal('0'):
                     self._handle_successful_closure(
                        close_price=filled_price,
                        quantity_closed=filled_qty,
                        reason=f"stop_loss_order_filled ({self.pending_sl_order_id})",
                        close_timestamp=close_timestamp
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
        Ejecuta un ciclo de la lógica del bot para self.symbol.
        Ahora maneja órdenes LIMIT, su estado pendiente/timeout y actualiza self.current_state.
        """
        try:
            # LOG AÑADIDO AQUÍ
            self.logger.info(f"[{self.symbol}] --- Inicio run_once. Estado: {self.current_state.value}, En Posición: {self.in_position}, Orden Entrada Pendiente: {self.pending_entry_order_id}, Orden Salida Pendiente: {self.pending_exit_order_id} ---")
            self.logger.debug(f"[{self.symbol}] Running cycle. Current state: {self.current_state.value}")

            # Obtener datos de klines (velas)
            try:
                # Determinar el límite de klines necesario
                limit_needed = max(
                    self.rsi_period + 10, 
                    self.volume_sma_period + 10 if hasattr(self, 'volume_sma_period') else 0,
                    self.downtrend_check_candles + 5 if hasattr(self, 'downtrend_check_candles') else 0,
                    3 * self.downtrend_level_check + 5 if hasattr(self, 'downtrend_level_check') else 0  # <-- NUEVO: Asegurar suficientes velas para el check de niveles
                )
                if limit_needed == 0:
                    limit_needed = 20

                # get_historical_klines ahora sabemos que devuelve un DataFrame
                klines_df = get_historical_klines(
                    symbol=self.symbol,
                    interval=self.rsi_interval,
                    limit=limit_needed
                )

                # Comprobar si klines_df (que es un DataFrame) está vacío o es None
                if klines_df is None or klines_df.empty:
                    self.logger.warning(f"[{self.symbol}] No klines data (DataFrame) received or DataFrame is empty for run_once cycle (limit: {limit_needed}).")
                    return

                # La conversión a DataFrame y el procesamiento de columnas ya se hacen en get_historical_klines.
                if 'timestamp' in klines_df.columns and not isinstance(klines_df.index, pd.DatetimeIndex):
                    klines_df.set_index('timestamp', inplace=True)
                
                if klines_df.empty:
                    self.logger.warning(f"[{self.symbol}] Kline DataFrame is empty after ensuring index. Skipping cycle.")
                    return

            except Exception as e:
                self.logger.error(f"[{self.symbol}] Error al obtener o procesar klines: {e}", exc_info=True)
                self._set_error_state(f"Failed to get current price: {e}")
                return

            # Si el bot está en estado de error, intentar recuperarse o esperar
            if self.current_state == BotState.ERROR:
                self.logger.warning(f"[{self.symbol}] Intentando recuperarse del estado de ERROR. Reseteando...")
                self._reset_state()
                return

            # --- Gestión de Órdenes Pendientes ---
            if self.current_state == BotState.WAITING_ENTRY_FILL:
                if self.pending_entry_order_id:
                    self._check_pending_entry_order(klines_df.iloc[-1]['close'] if not klines_df.empty else self.last_known_pnl)
                else:
                    self.logger.warning(f"[{self.symbol}] En estado WAITING_ENTRY_FILL sin pending_entry_order_id. Volviendo a IDLE.")
                    self._update_state(BotState.IDLE)

            elif self.current_state == BotState.WAITING_EXIT_FILL:
                if self.pending_exit_order_id:
                    self._check_pending_exit_order(klines_df.iloc[-1]['close'] if not klines_df.empty else self.last_known_pnl)
                else:
                    self.logger.warning(f"[{self.symbol}] En WAITING_EXIT_FILL sin pending_exit_order_id. Reevaluando posición.")
                    self._verify_position_status()

            # LOG AÑADIDO AQUÍ
            self.logger.info(f"[{self.symbol}] --- Antes de evaluar lógica principal de estados. Estado actual: {self.current_state.value} ---")

            # --- Lógica Principal de Estados ---
            if self.current_state == BotState.IDLE:
                temp_rsi_values_for_downtrend_check = None
                if hasattr(self, 'downtrend_check_candles') and self.downtrend_check_candles >= 2 and self.evaluate_downtrend_candles_block:
                    if klines_df is not None and not klines_df.empty and 'close' in klines_df.columns:
                        temp_rsi_values_for_downtrend_check = calculate_rsi(klines_df['close'], period=self.rsi_period)
                    else:
                        self.logger.warning(f"[{self.symbol}] No se pudo calcular RSI para chequeo de downtrend debido a klines_df inválido.")

                # --- NUEVO: Primero verificar tendencia bajista por niveles --- (MODIFICADO)
                block_due_to_downtrend_levels = False
                if self.evaluate_downtrend_levels_block: # Solo evaluar si el control está activado
                    if hasattr(self, 'downtrend_level_check') and self.downtrend_level_check > 0:
                        if self._check_downtrend_levels(klines_df):
                            self.logger.info(f"[{self.symbol}] CONDICIÓN DE NO ENTRADA (PRE-CHECK): Se detectó tendencia bajista por niveles (evaluación activada). No se evaluarán otras condiciones de entrada.")
                            block_due_to_downtrend_levels = True
                else:
                    self.logger.info(f"[{self.symbol}] PRE-CHECK: Evaluación de tendencia bajista por niveles DESACTIVADA.")
                
                if block_due_to_downtrend_levels:
                    # Actualizar previous_rsi_value si tenemos datos (similar a como estaba)
                    if temp_rsi_values_for_downtrend_check is not None and not temp_rsi_values_for_downtrend_check.empty:
                        current_rsi_val = temp_rsi_values_for_downtrend_check.iloc[-1]
                        if isinstance(current_rsi_val, (int, float)):
                            self.previous_rsi_value = current_rsi_val
                    return

                # --- Luego verificar tendencia bajista por velas consecutivas --- (MODIFICADO)
                block_due_to_downtrend_candles = False
                if self.evaluate_downtrend_candles_block: # Solo evaluar si el control está activado
                    if hasattr(self, 'downtrend_check_candles') and self.downtrend_check_candles >= 2:
                        if self._is_recent_downtrend(klines_df):
                            self.logger.info(f"[{self.symbol}] CONDICIÓN DE NO ENTRADA (PRE-CHECK): Se detectó tendencia bajista reciente ({self.downtrend_check_candles} velas) (evaluación activada). No se evaluarán otras condiciones de entrada.")
                            block_due_to_downtrend_candles = True
                else:
                    self.logger.info(f"[{self.symbol}] PRE-CHECK: Evaluación de tendencia bajista por velas consecutivas DESACTIVADA.")
                
                if block_due_to_downtrend_candles:
                    if temp_rsi_values_for_downtrend_check is not None and not temp_rsi_values_for_downtrend_check.empty:
                        current_rsi_val = temp_rsi_values_for_downtrend_check.iloc[-1]
                        if isinstance(current_rsi_val, (int, float)):
                            self.previous_rsi_value = current_rsi_val
                    return

                # Si no hay tendencia bajista o los chequeos están desactivados, evaluar condiciones de entrada.
                self._check_entry_conditions(klines_df)

            elif self.current_state == BotState.IN_POSITION:
                # --- CAMBIO DE ORDEN DE OPERACIONES ---
                # 1. PRIMERO, chequear si nuestras órdenes TP/SL (las que el bot conoce) se han llenado.
                if self.pending_tp_order_id or self.pending_sl_order_id:
                    if self._check_tp_sl_order_status(): # Devuelve True si una orden se llenó y el estado cambió a IDLE
                        self.logger.info(f"[{self.symbol}] Orden TP/SL llenada y manejada. El bot está ahora en estado IDLE.")
                        return # La posición se cerró, ciclo completado para esta posición.
                    # Si _check_tp_sl_order_status devolvió False, las órdenes TP/SL siguen pendientes o una fue cancelada y la otra sigue activa.
                    # Continuamos para actualizar PnL y verificar si no hay órdenes TP/SL que colocar.

                # 2. SI NINGUNA ORDEN TP/SL SE LLENÓ, actualizar PnL de la posición abierta y verificar si sigue abierta.
                position_still_open = self._update_open_position_pnl()
                if not position_still_open:
                    self.logger.info(f"[{self.symbol}] Posición ya no está abierta después de _update_open_position_pnl (y TP/SL no se detectaron como llenas). El estado debería haber sido manejado por _handle_external_closure.")
                    # _update_open_position_pnl llama a _handle_external_closure_or_discrepancy si detecta cierre.
                    # Esa función resetea el estado a IDLE.
                    return 

                # 3. Defensa: Si después de todo, estamos en posición pero current_position es None (no debería pasar).
                if not self.current_position: 
                    self.logger.error(f"[{self.symbol}] IN_POSITION state pero self.current_position es None. Re-verificando posición.")
                    self._verify_position_status() # Esto podría cambiar el estado
                    return 

                # --- NUEVA INTEGRACIÓN: Verificar condiciones de salida dinámica (como RSI Drop) ---
                # Esto se hace ANTES de intentar colocar nuevas órdenes TP/SL estándar,
                # porque si una condición dinámica se cumple, podría querer usar su propia lógica de salida.
                if klines_df is not None and not klines_df.empty:
                    self.logger.info(f"[{self.symbol}] IN_POSITION: Evaluando condiciones de salida dinámica (ej. RSI drop)...")
                    # _check_exit_conditions ahora cancelará TP/SL si activa una salida propia
                    self._check_exit_conditions(klines_df) # Esta línea y las siguientes deben estar indentadas aquí

                    # Si _check_exit_conditions activó una salida y colocó una orden,
                    # el estado del bot habrá cambiado (ej. a WAITING_EXIT_FILL).
                    # Si es así, terminamos este ciclo de run_once; el próximo manejará el nuevo estado.
                    if self.current_state != BotState.IN_POSITION: # Esta es la línea 649 del traceback
                        self.logger.info(f"[{self.symbol}] Condición de salida dinámica activada. Nuevo estado: {self.current_state.value}. Terminando ciclo run_once.")
                        return
                # --- FIN NUEVA INTEGRACIÓN ---

                # 4. SI AÚN ESTAMOS EN POSICIÓN (es decir, ni TP/SL ni salida dinámica se activaron)
                #    Y no tenemos órdenes TP/SL activas (ej. reinicio, fallo previo al colocar, o fueron canceladas y la salida dinámica no procedió).
                if self.current_state == BotState.IN_POSITION: # Re-chequear estado por si acaso
                    if not self.pending_tp_order_id and not self.pending_sl_order_id:
                        self.logger.warning(f"[{self.symbol}] EN POSICIÓN (y sin salida dinámica activada), pero el bot no tiene órdenes TP/SL activas registradas. Intentando colocar TP/SL estándar ahora.")
                        self._place_tp_sl_orders()
                        # El próximo ciclo de run_once verificará el estado de estas nuevas órdenes.
                    else:
                        # Si llegamos aquí, las órdenes TP/SL están puestas y pendientes (y la salida dinámica no se activó).
                        price_precision_log = self.price_tick_size.as_tuple().exponent * -1 if self.price_tick_size and self.price_tick_size.is_finite() and self.price_tick_size > Decimal('0') else 2
                        pnl_display = f"{self.last_known_pnl:.4f}" if self.last_known_pnl is not None else "N/A"
                        self.logger.info(f"[{self.symbol}] EN POSICIÓN. PnL: {pnl_display}. Esperando TP ({self.pending_tp_order_id}) o SL ({self.pending_sl_order_id}). Salida dinámica no activada.")
                # --- FIN DEL CAMBIO DE ORDEN ---

            elif self.current_state == BotState.PLACING_ENTRY or \
                 self.current_state == BotState.PLACING_EXIT or \
                 self.current_state == BotState.CANCELING_ORDER:
                self.logger.info(f"[{self.symbol}] En estado {self.current_state.value}, esperando resolución de operación. Saltando lógica principal este ciclo.")
                # No hacer nada más en este ciclo si estamos activamente colocando/cancelando.
                # La gestión de WAITING_ENTRY_FILL o WAITING_EXIT_FILL se encargará en el próximo ciclo si la operación resulta en espera.

            elif self.current_state == BotState.STOPPED:
                pass

        except Exception as e:
            self.logger.error(f"[{self.symbol}] Error al obtener el precio actual: {e}", exc_info=True)
            self._set_error_state(f"Failed to get current price: {e}")
            return

    def _handle_successful_closure(self, close_price, quantity_closed, reason, close_timestamp=None):
        """
        Registra el trade completado en la DB y resetea el estado interno del bot para este símbolo.
        Ahora acepta más detalles de la orden completada y simplifica la razón del cierre.
        """
        if not self.current_position:
            self.logger.error(f"[{self.symbol}] Se intentó registrar cierre, pero no había datos de posición interna guardada.")
            self._reset_state() # Aún reseteamos por si acaso
            return

        # Usar datos guardados en self.current_position como base
        entry_price = self.current_position.get('entry_price', Decimal('0'))
        entry_time = self.current_position.get('entry_time')
        # Usar la cantidad real cerrada y el precio real de cierre
        quantity_dec = Decimal(str(quantity_closed))
        close_price_dec = Decimal(str(close_price))
        position_size_usdt_est = abs(entry_price * quantity_dec) # Estimar basado en cantidad cerrada

        final_pnl = (close_price_dec - entry_price) * quantity_dec
        self.logger.info(f"[{self.symbol}] _handle_successful_closure: Calculated final_pnl = {final_pnl:.4f} (Close: {close_price_dec}, Entry: {entry_price}, Qty: {quantity_dec})") # DETAILED LOG FOR PNL
        
        # --- Simplificar la razón del cierre ---
        simplified_reason = reason # Por defecto, usar la razón original
        if reason.startswith("take_profit_order_filled"):
            simplified_reason = "Take Profit"
        elif reason.startswith("stop_loss_order_filled"):
            simplified_reason = "Stop Loss"
        elif reason.startswith("take_profit_pnl_reached"):
            simplified_reason = "Take Profit (Objetivo PnL)"
        elif reason.startswith("stop_loss_pnl_reached"):
            simplified_reason = "Stop Loss (Objetivo PnL)"
        elif reason.startswith("RSI_target_and_threshold_down"):
            simplified_reason = "Salida por RSI"
        elif reason.startswith("Trailing_RSI_Stop"): # Modificado para coincidir con la razón dada
            simplified_reason = "Salida por Trailing RSI"
        elif reason.startswith("Price_Trailing_Stop"): # <-- NUEVA RAZÓN
            simplified_reason = "Salida por Trailing Precio"
        elif reason.startswith("PNL_Trailing_Stop"): # <-- NUEVA RAZÓN PARA TRAILING PNL
            simplified_reason = "Salida por Trailing PNL"
        # Para otras razones que puedan venir de self.current_exit_reason,
        # si no coinciden con las anteriores, se usará la razón original (que podría ser más detallada).
        # Considerar añadir un mapeo más exhaustivo si es necesario o un default más genérico.

        self.logger.info(f"[{self.symbol}] Registrando cierre de posición: Razón Original='{reason}', Razón Simplificada='{simplified_reason}', PnL Final={final_pnl:.4f} USDT")

        if pd.isna(entry_time):
             entry_time = pd.Timestamp.now(tz='UTC') - pd.Timedelta(minutes=1)
             self.logger.warning(f"[{self.symbol}] Timestamp de entrada no era válido, usando valor estimado.")
             
        # Usar timestamp de cierre si se proporciona, si no, usar ahora
        actual_close_timestamp = close_timestamp if close_timestamp else pd.Timestamp.now(tz='UTC')

        # Convertir pd.Timestamp a datetime.datetime para la DB
        open_ts_for_db = entry_time.to_pydatetime() if pd.notna(entry_time) else None # Asegurar conversión correcta incluso si entry_time pudo ser None
        close_ts_for_db = actual_close_timestamp.to_pydatetime() if pd.notna(actual_close_timestamp) else None

        try:
            # Preparar parámetros para la DB (estos son los compartidos)
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
                # --- AÑADIR NUEVOS PARAMS A DB ---
                'enable_price_trailing_stop': self.enable_price_trailing_stop,
                'price_trailing_stop_distance_usdt': float(self.price_trailing_stop_distance_usdt),
                'price_trailing_stop_activation_pnl_usdt': float(self.price_trailing_stop_activation_pnl_usdt),
                # --- AÑADIR PARAMS DE TRAILING PNL A DB ---
                'enable_pnl_trailing_stop': self.enable_pnl_trailing_stop,
                'pnl_trailing_stop_activation_usdt': float(self.pnl_trailing_stop_activation_usdt),
                'pnl_trailing_stop_drop_usdt': float(self.pnl_trailing_stop_drop_usdt)
                # ------------------------------------
            } # Alineada con db_trade_params

            # <<< LOG DETALLADO ANTES DE record_trade >>>
            self.logger.info(f"[{self.symbol}] _handle_successful_closure: Intentando registrar con los siguientes datos -> "
                             f"Symbol: {self.symbol}, Type: LONG, OpenTS: {open_ts_for_db}, CloseTS: {close_ts_for_db}, "
                             f"OpenPrice: {float(entry_price)}, ClosePrice: {float(close_price_dec)}, Qty: {float(quantity_dec)}, "
                             f"PosSizeUSDT: {float(position_size_usdt_est)}, PNL: {float(final_pnl)}, Reason: '{simplified_reason}', "
                             f"Params: {db_trade_params}, BinanceTradeID: [No aplicable directamente aquí, se busca en _update_open_position_pnl]")

            record_trade(
                symbol=self.symbol,
                trade_type='LONG',
                open_timestamp=open_ts_for_db, # Usar convertido
                close_timestamp=close_ts_for_db, # Usar convertido
                open_price=float(entry_price),
                close_price=float(close_price_dec),
                quantity=float(quantity_dec),
                position_size_usdt=float(position_size_usdt_est),
                pnl_usdt=float(final_pnl),
                close_reason=simplified_reason, # <-- USAR RAZÓN SIMPLIFICADA
                parameters=db_trade_params # Guardar los parámetros usados
            )
            self.logger.info(f"[{self.symbol}] _handle_successful_closure: Trade registrado exitosamente en DB.")
        except Exception as e:
            # <<< LOG MEJORADO EN LA EXCEPCIÓN >>>
            self.logger.error(f"[{self.symbol}] ERROR CRÍTICO en _handle_successful_closure al registrar el trade en la DB: {e}", exc_info=True)
            self.logger.error(f"[{self.symbol}] Datos que se intentaron registrar: Symbol: {self.symbol}, Type: LONG, OpenTS: {open_ts_for_db}, CloseTS: {close_ts_for_db}, "
                             f"OpenPrice: {float(entry_price)}, ClosePrice: {float(close_price_dec)}, Qty: {float(quantity_dec)}, "
                             f"PosSizeUSDT: {float(position_size_usdt_est)}, PNL: {float(final_pnl)}, Reason: '{simplified_reason}', "
                             f"Params: {db_trade_params}")


        # Resetear estado interno del bot DESPUÉS de intentar registrar
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

    def get_current_status(self) -> dict:
         """Devuelve el estado actual del bot y datos relevantes."""
         status_data = {
             'symbol': self.symbol,
             'state': self.current_state.value,
             'in_position': self.in_position,
             'entry_price': float(self.current_position['entry_price']) if self.in_position and self.current_position else None,
             'quantity': float(self.current_position['quantity']) if self.in_position and self.current_position else None,
             'pnl': float(self.last_known_pnl) if self.in_position and self.last_known_pnl is not None else None,
             'pending_entry_order_id': self.pending_entry_order_id,
             'pending_exit_order_id': self.pending_exit_order_id, # Este es el ID de la orden de salida general (si se usara la lógica antigua)
             'pending_tp_order_id': self.pending_tp_order_id,    # <-- NUEVO
             'pending_sl_order_id': self.pending_sl_order_id,    # <-- NUEVO
             'last_error': self.last_error_message
         }
         return status_data

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


            self.logger.info(f"[{self.symbol}] Resumen Chequeo Entrada: RSI en rango? {'Sí' if condition_rsi_in_range else 'No'} (Eval Activa: {self.evaluate_rsi_range}), "
                             f"Incremento RSI OK? {'Sí' if condition_rsi_change_meets_thresh_up else 'No'} (Eval Activa: {self.evaluate_rsi_delta}), "
                             f"Volumen OK? {'Sí' if volume_check_passed else 'No'} (Eval Activa: {self.evaluate_volume_filter}), "
                             f"Req Velas Alcistas OK? {'Sí' if condition_required_uptrend_met else 'No'} (Eval Activa: {self.evaluate_required_uptrend})")

            # Evaluar todas las condiciones para la señal de entrada
            if condition_rsi_in_range and condition_rsi_change_meets_thresh_up and volume_check_passed and condition_required_uptrend_met: # Añadir la nueva condición
                self.logger.info(f"[{self.symbol}] CONDICIÓN DE ENTRADA COMBINADA DETECTADA: RSI en rango, Incremento RSI OK, Volumen OK, Requisito Velas Alcistas OK.")
                entry_signal = True
                self.entry_reason = (f"RSI_range ({self.rsi_entry_level_low}<={self.last_rsi_value:.2f}<={self.rsi_entry_level_high}) "
                                   f"AND RSI_delta (Delta={rsi_delta_str}>={self.rsi_threshold_up}) "
                                   f"AND Vol_OK AND Req_Uptrend_OK({self.required_uptrend_candles} velas)") # Actualizar razón
            else:
                # Construir un mensaje detallado de por qué no se cumplió la entrada
                fail_reasons = []
                if not condition_rsi_in_range: fail_reasons.append(f"RSI_rango (actual {self.last_rsi_value:.2f}, esperado [{self.rsi_entry_level_low}-{self.rsi_entry_level_high}])")
                if not condition_rsi_change_meets_thresh_up: fail_reasons.append(f"Delta_RSI (actual {rsi_delta_str}, esperado >={self.rsi_threshold_up})")
                if not volume_check_passed: fail_reasons.append("Volumen")
                if not condition_required_uptrend_met: fail_reasons.append(f"Req_Velas_Alcistas({self.required_uptrend_candles} velas)") # Actualizar mensaje de fallo
                self.logger.info(f"[{self.symbol}] CONDICIÓN DE ENTRADA COMBINADA NO CUMPLIDA. Fallos: {' | '.join(fail_reasons) if fail_reasons else 'Ninguno específico (revisar lógica)'}")

            # --- Actualizar el RSI anterior para el próximo ciclo ---
            # Es importante hacer esto aquí, después de todos los cálculos y logs que usan self.last_rsi_value y self.previous_rsi_value de ESTE ciclo.
            # Solo actualizar si self.last_rsi_value es un número válido.
            if isinstance(self.last_rsi_value, (int, float)):
                self.previous_rsi_value = self.last_rsi_value
            elif self.last_rsi_value is None: # Si el cálculo de RSI falló y es None
                # No actualizamos previous_rsi_value para no perder el último valor válido si lo teníamos.
                # O podríamos decidir ponerlo a None también. Por ahora, no lo actualizamos.
                self.logger.debug(f"[{self.symbol}] No se actualiza previous_rsi_value porque last_rsi_value es None.")
            # ----------------------------------------------------

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
                
                if quantity <= 0:
                    self.logger.error(f"[{self.symbol}] Cantidad calculada para la orden es cero o negativa ({quantity}). No se puede entrar.")
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
            close_timestamp=close_timestamp
        )
        
        # _handle_successful_closure ya llama a _reset_state(), que limpia in_position y current_position.
        # El estado después de un cierre exitoso debe ser IDLE.
        self._update_state(BotState.IDLE)

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

    def _update_open_position_pnl(self):
        """
        Actualiza el PnL no realizado, precio de entrada y cantidad de la posición abierta actual
        consultando directamente a Binance. También maneja si la posición ya no existe.
        Si la posición existía para el bot y ya no existe en Binance, intenta encontrar el trade de cierre
        en el historial de Binance y registrarlo. Si no, registra un cierre con PNL 0.
        Devuelve True si la posición sigue abierta y se actualizó, False si la posición se cerró
        o hubo un error al obtener los datos.
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
            
            old_pos_data_original = self.current_position.copy() # self.current_position no debería ser None aquí debido al check inicial
            # <<< DETAILED LOGGING FOR OLD POSITION DATA >>>
            self.logger.info(f"[{self.symbol}] _update_open_position_pnl: old_pos_data_original: {old_pos_data_original}")

            old_entry_price_from_bot = old_pos_data_original.get('entry_price')
            old_quantity_from_bot = old_pos_data_original.get('quantity')
            old_entry_time_from_bot = old_pos_data_original.get('entry_time')

            self.logger.info(f"[{self.symbol}] _update_open_position_pnl: Datos de posición (current_position) que el bot TENÍA: {old_pos_data_original}")
            self.logger.info(f"[{self.symbol}] _update_open_position_pnl: Extracted: old_entry_price={old_entry_price_from_bot}, old_quantity={old_quantity_from_bot}, old_entry_time={old_entry_time_from_bot}")

            # Fallbacks iniciales
            actual_close_price = old_entry_price_from_bot if old_entry_price_from_bot else Decimal('0')
            actual_pnl_usdt = Decimal('0.0')
            actual_close_timestamp = pd.Timestamp.now(tz='UTC')
            associated_binance_trade_id = None
            db_reason_for_closure = "Cierre Externo (Detectado PnL Update)"

            # Preparar parámetros del bot para la DB (hacerlo una vez)
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


            data_is_sufficient_for_detailed_search = \
                old_entry_price_from_bot is not None and old_entry_price_from_bot > Decimal('0') and \
                old_quantity_from_bot is not None and old_quantity_from_bot > Decimal('0')

            # <<< DETAILED LOGGING FOR SEARCH SUFFICIENCY >>>
            self.logger.info(f"[{self.symbol}] _update_open_position_pnl: data_is_sufficient_for_detailed_search: {data_is_sufficient_for_detailed_search}")

            if data_is_sufficient_for_detailed_search:
                self.logger.info(f"[{self.symbol}] _update_open_position_pnl: Datos suficientes. Se intentará búsqueda en historial.")
                
                effective_entry_time_for_search = old_entry_time_from_bot
                if effective_entry_time_for_search is None:
                    self.logger.warning(f"[{self.symbol}] _update_open_position_pnl: 'old_entry_time_from_bot' era None. Estimando para búsqueda.")
                    effective_entry_time_for_search = actual_close_timestamp - pd.Timedelta(minutes=2)
                
                # <<< DETAILED LOGGING FOR SEARCH TIME >>>
                self.logger.info(f"[{self.symbol}] _update_open_position_pnl: effective_entry_time_for_search: {effective_entry_time_for_search}")

                try:
                    user_trades = get_user_trade_history(symbol=self.symbol, limit=15)
                    # <<< DETAILED LOGGING FOR USER TRADES FETCHED >>>
                    if user_trades:
                        self.logger.info(f"[{self.symbol}] _update_open_position_pnl: Fetched {len(user_trades)} user_trades from Binance history: {user_trades}")
                    else:
                        self.logger.info(f"[{self.symbol}] _update_open_position_pnl: No user_trades fetched from Binance history.")
                    
                    found_match = False
                    if user_trades:
                        for trade_idx, trade in enumerate(user_trades):
                            # <<< DETAILED LOGGING FOR EACH TRADE IN HISTORY >>>
                            self.logger.info(f"[{self.symbol}] _update_open_position_pnl: Checking Binance trade history item {trade_idx}: {trade}")
                            binance_trade_id_from_api = trade.get('id')
                            trade_time_dt = pd.Timestamp(trade['time'], unit='ms', tz='UTC')
                            trade_qty = Decimal(trade.get('qty', '0'))
                            trade_price = Decimal(trade.get('price', '0'))
                            trade_side = trade.get('side', '').upper()
                            trade_realized_pnl = Decimal(trade.get('realizedPnl', '0'))

                            if trade_side == 'SELL' and trade_time_dt >= effective_entry_time_for_search:
                                quantity_diff_percent = (abs(trade_qty - old_quantity_from_bot) / old_quantity_from_bot) * 100 if old_quantity_from_bot else float('inf') # Handle old_quantity_from_bot being zero
                                self.logger.info(f"[{self.symbol}] _update_open_position_pnl: Binance trade {binance_trade_id_from_api} (SELL, Time: {trade_time_dt}, Qty: {trade_qty}, Price: {trade_price}, PnL: {trade_realized_pnl}) vs Bot Qty: {old_quantity_from_bot}. Qty Diff %: {quantity_diff_percent:.2f}%")
                                
                                if quantity_diff_percent < 5.0: # Original: 5.0
                                    binance_trade_id_int = int(binance_trade_id_from_api) if binance_trade_id_from_api else None
                                    db_trade_exists = check_if_binance_trade_exists(binance_trade_id=binance_trade_id_int)
                                    self.logger.info(f"[{self.symbol}] _update_open_position_pnl: Binance trade {binance_trade_id_int} meets qty diff. DB exists check: {db_trade_exists}")

                                    if not db_trade_exists:
                                        self.logger.info(f"[{self.symbol}] _update_open_position_pnl: Trade de cierre ENCONTRADO y NO REGISTRADO: BinanceID={binance_trade_id_int}, PnL={trade_realized_pnl}")
                                        actual_close_price = trade_price
                                        actual_pnl_usdt = trade_realized_pnl
                                        actual_close_timestamp = trade_time_dt
                                        associated_binance_trade_id = int(binance_trade_id_from_api)
                                        db_reason_for_closure = f"Cierre Externo (Historial BinanceID {associated_binance_trade_id})"
                                        found_match = True
                                        break
                                    else:
                                        self.logger.info(f"[{self.symbol}] _update_open_position_pnl: Trade de cierre {binance_trade_id_from_api} ya estaba registrado. Ignorando.")
                    if not found_match:
                        self.logger.warning(f"[{self.symbol}] _update_open_position_pnl: No se encontró trade de cierre no registrado en historial. Razón actual: '{db_reason_for_closure}' (se actualizará si era el default).")
                        if db_reason_for_closure == "Cierre Externo (Detectado PnL Update)": # Si no se actualizó por un match
                           db_reason_for_closure = "Cierre Externo (No hallado en historial reciente)"
                except Exception as e_hist:
                    self.logger.error(f"[{self.symbol}] _update_open_position_pnl: Error buscando historial: {e_hist}", exc_info=True)
                    db_reason_for_closure = "Cierre Externo (Error en búsqueda historial)"
                
                # Registro con datos de búsqueda (o fallbacks si búsqueda falló)
                try:
                    # <<< DETAILED LOGGING BEFORE record_trade CALL (HISTORY SEARCH PATH) >>>
                    self.logger.info(f"[{self.symbol}] _update_open_position_pnl (history search path): PRE-record_trade. Symbol: {self.symbol}, OpenTS: {effective_entry_time_for_search.to_pydatetime() if pd.notna(effective_entry_time_for_search) else None}, CloseTS: {actual_close_timestamp.to_pydatetime() if pd.notna(actual_close_timestamp) else None}, OpenPrice: {float(old_entry_price_from_bot)}, ClosePrice: {float(actual_close_price)}, Qty: {float(old_quantity_from_bot)}, PNL: {float(actual_pnl_usdt)}, Reason: '{db_reason_for_closure}', BinanceID: {associated_binance_trade_id}")
                    record_trade(
                        symbol=self.symbol, trade_type='LONG',
                        open_timestamp=effective_entry_time_for_search.to_pydatetime() if pd.notna(effective_entry_time_for_search) else None,
                        close_timestamp=actual_close_timestamp.to_pydatetime() if pd.notna(actual_close_timestamp) else None,
                        open_price=float(old_entry_price_from_bot),
                        close_price=float(actual_close_price), # Puede ser de Binance o fallback
                        quantity=float(old_quantity_from_bot),
                        position_size_usdt=float(abs(old_entry_price_from_bot * old_quantity_from_bot)),
                        pnl_usdt=float(actual_pnl_usdt), # Puede ser de Binance o fallback 0.0
                        close_reason=db_reason_for_closure,
                        parameters=db_trade_params,
                        binance_trade_id=associated_binance_trade_id
                    )
                    self.logger.info(f"[{self.symbol}] _update_open_position_pnl: Cierre (después de intento de búsqueda) registrado. PNL: {actual_pnl_usdt:.4f}, Razón: '{db_reason_for_closure}'")
                except Exception as e_rec:
                    self.logger.error(f"[{self.symbol}] _update_open_position_pnl: Error al registrar cierre (después de intento de búsqueda): {e_rec}", exc_info=True)
            
            else: # Datos NO eran suficientes para búsqueda detallada, pero el bot creía estar en posición.
                self.logger.warning(f"[{self.symbol}] _update_open_position_pnl: Datos insuficientes para búsqueda en historial ({old_pos_data_original}). Intentando registro de FALLBACK BÁSICO.")
                
                # Usar los datos que teníamos, aunque sean None, y la función record_trade debería manejar Nones o defaults.
                # Si old_entry_price_from_bot o old_quantity_from_bot son None, el PNL será 0, y position_size_usdt también.
                # Los precios y cantidad en DB serán 0.0 si eran None.
                final_open_price = old_entry_price_from_bot if old_entry_price_from_bot else Decimal('0')
                final_quantity = old_quantity_from_bot if old_quantity_from_bot else Decimal('0')
                final_open_time = old_entry_time_from_bot if old_entry_time_from_bot else actual_close_timestamp - pd.Timedelta(minutes=1)

                db_reason_for_closure = "Cierre Externo (Datos Bot Insuficientes para Búsqueda)"
                try:
                    # <<< DETAILED LOGGING BEFORE record_trade CALL (FALLBACK PATH) >>>
                    self.logger.info(f"[{self.symbol}] _update_open_position_pnl (fallback path): PRE-record_trade. Symbol: {self.symbol}, OpenTS: {final_open_time.to_pydatetime() if pd.notna(final_open_time) else None}, CloseTS: {actual_close_timestamp.to_pydatetime() if pd.notna(actual_close_timestamp) else None}, OpenPrice: {float(final_open_price)}, ClosePrice: {float(final_open_price)}, Qty: {float(final_quantity)}, PNL: 0.0, Reason: '{db_reason_for_closure}', BinanceID: None")
                    record_trade(
                        symbol=self.symbol, trade_type='LONG',
                        open_timestamp=final_open_time.to_pydatetime() if pd.notna(final_open_time) else None,
                        close_timestamp=actual_close_timestamp.to_pydatetime() if pd.notna(actual_close_timestamp) else None, # Tiempo actual
                        open_price=float(final_open_price),
                        close_price=float(final_open_price), # Para PNL 0
                        quantity=float(final_quantity),
                        position_size_usdt=float(abs(final_open_price * final_quantity)),
                        pnl_usdt=0.0, # PNL Cero
                        close_reason=db_reason_for_closure,
                        parameters=db_trade_params,
                        binance_trade_id=None
                    )
                    self.logger.info(f"[{self.symbol}] _update_open_position_pnl: Cierre (FALLBACK BÁSICO) registrado. Razón: '{db_reason_for_closure}'")
                except Exception as e_rec_fallback:
                    self.logger.error(f"[{self.symbol}] _update_open_position_pnl: Error al registrar cierre (FALLBACK BÁSICO): {e_rec_fallback}", exc_info=True)
            
            self._reset_state() # Limpia self.in_position, self.current_position, etc.
            self._update_state(BotState.IDLE)
            return False # Indica que la posición se cerró

        elif pos_amt_binance < 0: # Posición SHORT inesperada
            self.logger.warning(f"[{self.symbol}] _update_open_position_pnl: Posición SHORT inesperada detectada ({pos_amt_binance}).")
            self._handle_external_closure_or_discrepancy(reason="pnl_update_unexpected_short", short_position_data=position_data)
            return False

        # Si llegamos aquí, la posición sigue abierta y es LONG. Actualizar datos.
        self.last_known_pnl = unrealized_pnl_binance
        
        if self.current_position['entry_price'] != entry_price_binance or self.current_position['quantity'] != pos_amt_binance:
            self.logger.info(f"[{self.symbol}] _update_open_position_pnl: Datos de posición actualizados desde Binance: "
                             f"Viejo EntryP: {self.current_position['entry_price']}, Nuevo: {entry_price_binance}. "
                             f"Vieja Cant: {self.current_position['quantity']}, Nueva: {pos_amt_binance}.")
            self.current_position['entry_price'] = entry_price_binance
            self.current_position['quantity'] = pos_amt_binance
            self.current_position['positionAmt'] = pos_amt_binance # Asegurar que actualizamos esto también
            self.current_position['position_size_usdt'] = abs(entry_price_binance * pos_amt_binance)
        
        price_precision_log = self.price_tick_size.as_tuple().exponent * -1 if self.price_tick_size and self.price_tick_size.is_finite() and self.price_tick_size > Decimal('0') else 2
        self.logger.debug(f"[{self.symbol}] _update_open_position_pnl: PnL actualizado: {self.last_known_pnl:.4f} USDT, Entrada: {entry_price_binance:.{price_precision_log}f}, Cant: {pos_amt_binance}")
        return True

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
                self.logger.info(f"[{self.symbol}] _handle_external_closure_or_discrepancy: Intentando registrar (último recurso) con los siguientes datos -> "
                                 f"Symbol: {self.symbol}, Type: LONG, OpenTS: {final_open_timestamp}, CloseTS: {final_close_timestamp}, "
                                 f"OpenPrice: {float(old_entry_price)}, ClosePrice: {float(old_entry_price)}, Qty: {float(old_quantity)}, "
                                 f"PosSizeUSDT: {float(abs(old_entry_price * old_quantity))}, PNL: 0.0, Reason: '{db_reason}', "
                                 f"Params: {db_trade_params}, BinanceTradeID: None")
                try:
                    record_trade(
                        symbol=self.symbol, trade_type='LONG',
                        open_timestamp=final_open_timestamp,
                        close_timestamp=final_close_timestamp,
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