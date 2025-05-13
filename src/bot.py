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
    cancel_futures_order
)
from .rsi_calculator import calculate_rsi
from .database import init_db_schema, record_trade # Importamos solo las necesarias

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
        self.rsi_at_entry = None # <-- NUEVO: Para guardar el RSI al momento de la entrada
        self.rsi_target = float(self.params.get('rsi_target', 50.0)) # Nuevo campo para RSI objetivo
        self.rsi_objetivo_activado = False  # <-- MOVIDO AQUÍ: Indica si el objetivo ya fue alcanzado
        self.rsi_objetivo_alcanzado_en = None  # <-- MOVIDO AQUÍ: Guarda el valor de RSI cuando se alcanzó el objetivo
        # ---------------------

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
            if self.volume_factor <= 0:
                 self.logger.warning(f"[{self.symbol}] VOLUME_FACTOR ({self.volume_factor}) debe ser positivo. Usando 1.5.")
                 self.volume_factor = 1.5
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
        # Las inicializaciones de rsi_objetivo_activado/alcanzado_en se quitaron de aquí porque se movieron arriba.

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
        n = self.downtrend_check_candles
        
        if n < 2: 
            return False 

        if len(klines_df) < n + 1: 
            self.logger.warning(f"[{self.symbol}] No hay suficientes klines ({len(klines_df)}) para chequear tendencia bajista de {n} velas. Se necesitan al menos {n+1}. Saltando chequeo.")
            return False 

        closes = klines_df['close']
        
        for i in range(n - 1): 
            current_candle_close = closes.iloc[-(2 + i)]
            previous_candle_close = closes.iloc[-(3 + i)]

            if current_candle_close >= previous_candle_close:
                return False 
        
        self.logger.info(f"[{self.symbol}] Condición de tendencia bajista reciente DETECTADA para las últimas {n} velas. Entrada bloqueada.")
        return True

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
            # Aseguramos pedir suficientes datos para todos los indicadores, incluyendo el chequeo de tendencia.
            try:
                # Determinar el límite de klines necesario
                limit_needed = max(
                    self.rsi_period + 10, 
                    self.volume_sma_period + 10 if hasattr(self, 'volume_sma_period') else 0,
                    self.downtrend_check_candles + 5 if hasattr(self, 'downtrend_check_candles') else 0
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
                # No es necesario convertir klines_df a klines_df ni procesar columnas aquí de nuevo,
                # a menos que queramos asegurar que el índice es 'timestamp'.
                # get_historical_klines no pone el índice, así que lo hacemos aquí si es necesario para el resto del código.
                if 'timestamp' in klines_df.columns and not isinstance(klines_df.index, pd.DatetimeIndex):
                    klines_df.set_index('timestamp', inplace=True)
                
                # Validar que después de asegurar el índice, el DataFrame no esté vacío (doble chequeo, puede ser redundante si el anterior es suficiente)
                if klines_df.empty: # Esta comprobación podría ser redundante si la de arriba es suficiente
                    self.logger.warning(f"[{self.symbol}] Kline DataFrame is empty after ensuring index. Skipping cycle.")
                    return

            except Exception as e:
                self.logger.error(f"[{self.symbol}] Error al obtener o procesar klines: {e}", exc_info=True)
                self._set_error_state(f"Failed to get current price: {e}")
                return

            # Si el bot está en estado de error, intentar recuperarse o esperar
            if self.current_state == BotState.ERROR:
                self.logger.warning(f"[{self.symbol}] Intentando recuperarse del estado de ERROR. Reseteando...")
                self._reset_state() # Intenta resetear y quizá reintentar en el próximo ciclo.
                return # For this cycle

            # --- Gestión de Órdenes Pendientes ---
            # (Este bloque debe ir ANTES de la lógica principal de entrada/salida para no interferir
            # con una orden que ya está siendo gestionada, a menos que la lógica de downtrend deba cancelar órdenes activas)
            # Por ahora, la lógica de downtrend previene NUEVAS entradas.
            if self.current_state == BotState.WAITING_ENTRY_FILL:
                if self.pending_entry_order_id:
                    self._check_pending_entry_order(klines_df.iloc[-1]['close'] if not klines_df.empty else self.last_known_pnl) # Pasa el último precio de cierre
                else:
                    self.logger.warning(f"[{self.symbol}] En estado WAITING_ENTRY_FILL sin pending_entry_order_id. Volviendo a IDLE.")
                    self._update_state(BotState.IDLE)

            elif self.current_state == BotState.WAITING_EXIT_FILL:
                if self.pending_exit_order_id:
                    self._check_pending_exit_order(klines_df.iloc[-1]['close'] if not klines_df.empty else self.last_known_pnl)
                else:
                    # Esto podría pasar si se canceló manualmente o por un error no manejado
                    self.logger.warning(f"[{self.symbol}] En WAITING_EXIT_FILL sin pending_exit_order_id. Reevaluando posición.")
                    self._verify_position_status() # Re-chequear si aún estamos en posición.
                    # Si _verify_position_status cambia el estado (ej. a IDLE si ya no hay posición),
                    # la lógica de abajo se encargará. Si sigue IN_POSITION, también.

            # LOG AÑADIDO AQUÍ
            self.logger.info(f"[{self.symbol}] --- Antes de evaluar lógica principal de estados. Estado actual: {self.current_state.value} ---")

            # --- Lógica Principal de Estados ---
            if self.current_state == BotState.IDLE:
                # Primero, verificar si hay una tendencia bajista reciente que impida entrar.
                if hasattr(self, 'downtrend_check_candles') and self.downtrend_check_candles >= 2: # Asegurarse que el chequeo está activo
                    if self._is_recent_downtrend(klines_df): # _is_recent_downtrend ya loguea si confirma tendencia
                        self.logger.info(f"[{self.symbol}] CONDICIÓN DE NO ENTRADA (PRE-CHECK): Se detectó tendencia bajista reciente ({self.downtrend_check_candles} velas). No se evaluarán otras condiciones de entrada.")
                        return # Salir de run_once para este ciclo
                
                # Si no hay tendencia bajista o el chequeo está desactivado, evaluar condiciones de entrada.
                self._check_entry_conditions(klines_df)

            elif self.current_state == BotState.IN_POSITION:
                # --- NUEVO: Actualizar PnL de la posición abierta ANTES de chequear salida ---
                position_still_open = self._update_open_position_pnl()
                if not position_still_open:
                    # Si _update_open_position_pnl detectó que la posición se cerró,
                    # ya habrá llamado a _handle_external_closure y reseteado el estado (probablemente a IDLE).
                    self.logger.info(f"[{self.symbol}] Posición ya no está abierta después de _update_open_position_pnl. Saltando _check_exit_conditions.")
                    return # Salir de run_once para este ciclo, el estado ya fue actualizado.
                
                self._check_exit_conditions(klines_df)
                # Podríamos añadir una verificación de PnL aquí también si es necesario fuera de _check_exit_conditions
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
        Ahora acepta más detalles de la orden completada.
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
        self.logger.info(f"[{self.symbol}] Registrando cierre de posición: Razón={reason}, PnL Final={final_pnl:.4f} USDT")

        if pd.isna(entry_time):
             entry_time = pd.Timestamp.now(tz='UTC') - pd.Timedelta(minutes=1)
             self.logger.warning(f"[{self.symbol}] Timestamp de entrada no era válido, usando valor estimado.")
             
        # Usar timestamp de cierre si se proporciona, si no, usar ahora
        actual_close_timestamp = close_timestamp if close_timestamp else pd.Timestamp.now(tz='UTC')

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
                'stop_loss_usdt': float(self.stop_loss_usdt)
            }
            record_trade(
                symbol=self.symbol,
                trade_type='LONG',
                open_timestamp=entry_time,
                close_timestamp=actual_close_timestamp, # Usar timestamp real/proporcionado
                open_price=float(entry_price),
                close_price=float(close_price_dec),
                quantity=float(quantity_dec),
                position_size_usdt=float(position_size_usdt_est),
                pnl_usdt=float(final_pnl),
                close_reason=reason,
                parameters=db_trade_params # Guardar los parámetros usados
            )
        except Exception as e:
            self.logger.error(f"[{self.symbol}] Error al registrar el trade en la DB: {e}", exc_info=True)

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
        # ---------------------------------------------------
        # self.last_rsi_value = None # Podríamos mantenerlo o resetearlo
        self.rsi_objetivo_activado = False
        self.rsi_objetivo_alcanzado_en = None

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
             'entry_price': float(self.current_position['entry_price']) if self.in_position else None,
             'quantity': float(self.current_position['quantity']) if self.in_position else None,
             'pnl': float(self.last_known_pnl) if self.in_position else None,
             'pending_entry_order_id': self.pending_entry_order_id,
             'pending_exit_order_id': self.pending_exit_order_id,
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
                self._update_state(BotState.IDLE) 
                return
            self.last_rsi_value = rsi_values.iloc[-1]
            # Calcular la precisión del precio para el log de forma segura
            price_precision_log = self.price_tick_size.as_tuple().exponent * -1 if self.price_tick_size and self.price_tick_size.is_finite() and self.price_tick_size > Decimal('0') else 2
            self.logger.info(f"[{self.symbol}] Precio actual: {current_price:.{price_precision_log}f}, RSI({self.rsi_period}, {self.rsi_interval}): {self.last_rsi_value:.2f}")

            # --- Lógica de Volumen ---
            volume_check_passed = False
            if self.volume_sma_period > 0 and self.volume_factor > 0:
                volume_data = self._calculate_volume_sma(klines_df)
                if volume_data:
                    current_volume, average_volume, factor = volume_data
                    if current_volume > (average_volume * factor):
                        volume_check_passed = True
                        self.logger.info(f"[{self.symbol}] CONDICIÓN DE VOLUMEN CUMPLIDA: Actual={current_volume:.2f} > Promedio({self.volume_sma_period})={average_volume:.2f} * Factor={factor}")
                    else:
                        self.logger.info(f"[{self.symbol}] CONDICIÓN DE VOLUMEN NO CUMPLIDA: Actual={current_volume:.2f} <= Promedio({self.volume_sma_period})={average_volume:.2f} * Factor={factor}")
                else:
                    self.logger.warning(f"[{self.symbol}] No se pudieron obtener datos de volumen SMA. Saltando chequeo de volumen.")
                    volume_check_passed = False 
            else:
                 self.logger.info(f"[{self.symbol}] Chequeo de volumen desactivado (SMA Period o Factor no positivos).")
                 volume_check_passed = True 
            # --- Fin Lógica de Volumen ---

            # --- Lógica de Entrada MODIFICADA ---
            entry_signal = False
            self.entry_reason = ""

            condition_rsi_in_range = (self.rsi_entry_level_low <= self.last_rsi_value <= self.rsi_entry_level_high)
            condition_rsi_above_thresh_up = (self.last_rsi_value >= self.rsi_threshold_up)

            self.logger.info(f"[{self.symbol}] Chequeo Entrada: RSI en rango [{self.rsi_entry_level_low}, {self.rsi_entry_level_high}]? {'Sí' if condition_rsi_in_range else 'No'} (RSI={self.last_rsi_value:.2f})")
            self.logger.info(f"[{self.symbol}] Chequeo Entrada: RSI >= umbral_up ({self.rsi_threshold_up})? {'Sí' if condition_rsi_above_thresh_up else 'No'} (RSI={self.last_rsi_value:.2f})")
            self.logger.info(f"[{self.symbol}] Chequeo Entrada: Volumen OK? {'Sí' if volume_check_passed else 'No'}")

            if condition_rsi_in_range and condition_rsi_above_thresh_up and volume_check_passed:
                self.logger.info(f"[{self.symbol}] CONDICIÓN DE ENTRADA COMBINADA DETECTADA: RSI en rango y >= umbral_up. Volumen OK.")
                entry_signal = True
                self.entry_reason = f"RSI_range ({self.rsi_entry_level_low}<={self.last_rsi_value:.2f}<={self.rsi_entry_level_high}) AND RSI_thresh_up (RSI={self.last_rsi_value:.2f}>={self.rsi_threshold_up}) & Vol_OK"
            else:
                self.logger.info(f"[{self.symbol}] CONDICIÓN DE ENTRADA COMBINADA NO CUMPLIDA.")


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

            # 1. Take Profit
            if self.take_profit_usdt > 0 and self.last_known_pnl is not None and self.last_known_pnl >= self.take_profit_usdt:
                self.logger.warning(f"[{self.symbol}] CONDICIÓN DE TAKE PROFIT (PnL) ALCANZADA. PnL={self.last_known_pnl:.4f} >= TP={self.take_profit_usdt}")
                exit_signal = True
                self.exit_reason = f"take_profit_pnl_reached ({self.last_known_pnl:.4f})"

            # 2. Stop Loss
            if not exit_signal and self.stop_loss_usdt < 0 and self.last_known_pnl is not None:
                if self.last_known_pnl <= self.stop_loss_usdt:
                    self.logger.warning(f"[{self.symbol}] CONDICIÓN DE STOP LOSS (PnL) ALCANZADA. PnL={self.last_known_pnl:.4f} <= SL={self.stop_loss_usdt}")
                    exit_signal = True
                    self.exit_reason = f"stop_loss_pnl_reached ({self.last_known_pnl:.4f})"

            # 3. Activación de RSI objetivo
            if not self.rsi_objetivo_activado and self.last_rsi_value is not None:
                if self.last_rsi_value >= self.rsi_target:
                    self.rsi_objetivo_activado = True
                    self.logger.info(f"[{self.symbol}] RSI objetivo alcanzado: {self.rsi_target}. Se activa vigilancia de salida por threshold_down.")

            # 4. Salida por threshold_down solo si el objetivo fue activado
            if not exit_signal and self.rsi_objetivo_activado and self.last_rsi_value is not None:
                rsi_salida = self.rsi_target + self.rsi_threshold_down
                self.logger.info(f"[{self.symbol}] Chequeo Salida RSI: Actual RSI ({self.last_rsi_value:.2f}) vs RSI de salida ({rsi_salida:.2f})")
                if self.last_rsi_value <= rsi_salida:
                    self.logger.warning(f"[{self.symbol}] CONDICIÓN DE SALIDA (RSI OBJETIVO + threshold_down) DETECTADA: RSI Actual ({self.last_rsi_value:.2f}) <= {rsi_salida:.2f}")
                    exit_signal = True
                    self.exit_reason = f"RSI_target_and_threshold_down (Actual={self.last_rsi_value:.2f}, Target={self.rsi_target:.2f}, Down={self.rsi_threshold_down})"

            if exit_signal:
                best_bid_price = self._get_best_exit_price('SELL')
                if not best_bid_price:
                    self.logger.error(f"[{self.symbol}] No se pudo obtener el mejor precio Bid para la salida. No se colocará orden de salida.")
                    self._update_state(BotState.IN_POSITION)
                    return
                self.logger.warning(f"[{self.symbol}] SEÑAL DE SALIDA ({self.exit_reason}). Intentando colocar orden LIMIT SELL @ {best_bid_price}")
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
        Devuelve True si la posición sigue abierta y se actualizó, False si la posición se cerró
        o hubo un error al obtener los datos.
        """
        if not self.in_position or not self.current_position:
            self.logger.debug(f"[{self.symbol}] _update_open_position_pnl llamado pero no se está en posición según el estado interno. Saltando.")
            return True # No es un cierre, simplemente no hay nada que actualizar.

        self.logger.debug(f"[{self.symbol}] Actualizando PnL para posición abierta...")
        position_data = get_futures_position(self.symbol)

        if not position_data:
            self.logger.warning(f"[{self.symbol}] No se pudo obtener información de posición de Binance para actualizar PnL. La posición podría estar cerrada.")
            self._handle_external_closure_or_discrepancy(reason="pnl_update_no_pos_data")
            return False

        pos_amt_str = position_data.get('positionAmt', '0')
        entry_price_str = position_data.get('entryPrice', '0')
        unrealized_pnl_str = position_data.get('unRealizedProfit', '0')

        try:
            pos_amt = Decimal(pos_amt_str)
            entry_price = Decimal(entry_price_str)
            unrealized_pnl = Decimal(unrealized_pnl_str)
        except Exception as e:
            self.logger.error(f"[{self.symbol}] Error al convertir datos de posición de Binance a Decimal: {e}. Datos: {position_data}")
            return True # No se pudo actualizar, pero no asumimos cierre aún.

        if abs(pos_amt) < Decimal('1e-9'):
            self.logger.info(f"[{self.symbol}] Posición para {self.symbol} parece cerrada externamente (Cantidad: {pos_amt}).")
            self._handle_external_closure_or_discrepancy(reason="pnl_update_pos_closed_externally")
            return False

        if pos_amt < 0:
            self.logger.warning(f"[{self.symbol}] Posición SHORT inesperada detectada ({pos_amt}) durante actualización de PnL. Manejando cierre.")
            self._handle_external_closure_or_discrepancy(reason="pnl_update_unexpected_short", short_position_data=position_data)
            return False

        self.last_known_pnl = unrealized_pnl
        
        if self.current_position['entry_price'] != entry_price or self.current_position['quantity'] != pos_amt:
            self.logger.info(f"[{self.symbol}] Datos de posición actualizados desde Binance: "
                             f"Viejo EntryP: {self.current_position['entry_price']}, Nuevo: {entry_price}. "
                             f"Vieja Cant: {self.current_position['quantity']}, Nueva: {pos_amt}.")
            self.current_position['entry_price'] = entry_price
            self.current_position['quantity'] = pos_amt
            self.current_position['positionAmt'] = pos_amt
            self.current_position['position_size_usdt'] = abs(entry_price * pos_amt)
        
        price_precision_log = self.price_tick_size.as_tuple().exponent * -1 if self.price_tick_size and self.price_tick_size.is_finite() and self.price_tick_size > Decimal('0') else 2
        self.logger.debug(f"[{self.symbol}] PnL actualizado: {self.last_known_pnl:.4f} USDT, Entrada: {entry_price:.{price_precision_log}f}, Cant: {pos_amt}")
        return True

    def _handle_external_closure_or_discrepancy(self, reason: str, short_position_data: dict | None = None):
        """
        Maneja el caso donde una posición que el bot creía abierta ya no lo está según Binance,
        o se detecta una posición SHORT inesperada.
        Intenta registrar el cierre si había una posición activa.
        """
        self.logger.warning(f"[{self.symbol}] Manejando cierre externo o discrepancia: {reason}")

        old_entry_price = self.current_position.get('entry_price') if self.current_position else None
        old_quantity = self.current_position.get('quantity') if self.current_position else None
        old_entry_time = self.current_position.get('entry_time') if self.current_position else None

        self._reset_state()
        self._update_state(BotState.IDLE)

        if short_position_data:
            pos_amt_short = Decimal(short_position_data.get('positionAmt', '0'))
            entry_price_short = Decimal(short_position_data.get('entryPrice', '0'))
            self.logger.error(f"[{self.symbol}] Se detectó una posición SHORT ({pos_amt_short} @ {entry_price_short}). "
                              f"El bot solo maneja LONGs. Se ha reseteado el estado. No se registra trade 'LONG' cerrado.")
            return

        if old_entry_price is not None and old_quantity is not None and old_entry_price > Decimal('0') and old_quantity > Decimal('0'):
            self.logger.info(f"[{self.symbol}] Intentando registrar cierre externo para posición anterior: "
                             f"Entrada @ {old_entry_price}, Cant: {old_quantity}, Razón: {reason}")
            
            if old_entry_time is None:
                old_entry_time = pd.Timestamp.now(tz='UTC') - pd.Timedelta(minutes=5)
                self.logger.warning(f"[{self.symbol}] Usando timestamp de entrada estimado para cierre externo.")

            try:
                db_trade_params = {
                    'rsi_interval': self.rsi_interval,
                    'rsi_period': self.rsi_period,
                    'rsi_threshold_up': self.rsi_threshold_up,
                    'rsi_threshold_down': self.rsi_threshold_down,
                    'rsi_entry_level_low': self.rsi_entry_level_low,
                    'rsi_entry_level_high': self.rsi_entry_level_high,
                    'volume_sma_period': self.volume_sma_period,
                    'volume_factor': self.volume_factor,
                    'position_size_usdt': float(self.position_size_usdt),
                    'take_profit_usdt': float(self.take_profit_usdt),
                    'stop_loss_usdt': float(self.stop_loss_usdt),
                    'downtrend_check_candles': self.downtrend_check_candles,
                    'order_timeout_seconds': self.order_timeout_seconds
                }
                record_trade(
                    symbol=self.symbol,
                    trade_type='LONG',
                    open_timestamp=old_entry_time,
                    close_timestamp=pd.Timestamp.now(tz='UTC'),
                    open_price=float(old_entry_price),
                    close_price=float(old_entry_price), 
                    quantity=float(old_quantity),
                    position_size_usdt=float(abs(old_entry_price * old_quantity)),
                    pnl_usdt=0.0, 
                    close_reason=f"external_closure_{reason}",
                    parameters=db_trade_params
                )
                self.logger.info(f"[{self.symbol}] Cierre externo registrado en DB (PnL asumido 0).")
            except Exception as e:
                self.logger.error(f"[{self.symbol}] Error al intentar registrar cierre externo en DB: {e}", exc_info=True)
        else:
            self.logger.info(f"[{self.symbol}] Cierre externo detectado, pero no había datos de posición previa para registrar.")


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