# Este módulo gestionará la conexión y las operaciones con la API de Binance Futures
# usando la librería oficial binance-futures-connector-python.

# Importar UMFutures para USDT-Margined Futures
from binance.um_futures import UMFutures
# Importar excepciones específicas si las usamos, o un error general
from binance.error import ClientError
import pandas as pd
import time
import os # Import the os module
from decimal import Decimal

# Importamos nuestra configuración y logger
from .config_loader import load_config
from .logger_setup import get_logger

# Variable global para el cliente de Binance Futures (para reutilizar la instancia)
futures_client_instance = None

def get_futures_client():
    """
    Crea y retorna una instancia del cliente UMFutures de Binance Futures,
    configurada según el archivo config.ini (modo live o paper/testnet).
    Reutiliza la instancia si ya fue creada.

    Returns:
        binance.um_futures.UMFutures: Instancia del cliente UMFutures.
                                      Retorna None si la configuración falla o la conexión inicial falla.
    """
    global futures_client_instance
    if futures_client_instance:
        return futures_client_instance

    logger = get_logger()
    config = load_config()
    if not config:
        logger.critical("No se pudo cargar la configuración para inicializar UMFutures Client.")
        return None

    try:
        # Leer API keys desde variables de entorno
        api_key = os.getenv('BINANCE_API_KEY')
        api_secret = os.getenv('BINANCE_API_SECRET')
        
        mode = config.get('BINANCE', 'MODE', fallback='paper').lower()
        futures_base_url = config.get('BINANCE', 'FUTURES_BASE_URL') # Live URL: https://fapi.binance.com
        futures_testnet_url = config.get('BINANCE', 'FUTURES_TESTNET_BASE_URL') # Testnet URL: https://testnet.binancefuture.com

        if not api_key or not api_secret:
            logger.critical("BINANCE_API_KEY o BINANCE_API_SECRET no están definidas como variables de entorno. Por favor, configúralas.")
            return None

        base_url_to_use = ""
        if mode == 'paper' or mode == 'testnet':
            logger.warning("Inicializando cliente UMFutures en modo TESTNET.")
            base_url_to_use = futures_testnet_url
        else:
            logger.info("Inicializando cliente UMFutures en modo LIVE.")
            # FORZADO: Usar un endpoint alternativo para evitar geobloqueos en plataformas como Render.
            base_url_to_use = "https://fapi.binance.me"
            logger.info(f"URL base de Futuros (Live) forzada a: {base_url_to_use}")

        # Crear instancia del cliente UMFutures
        client = UMFutures(key=api_key, secret=api_secret, base_url=base_url_to_use)

        # Intentar hacer una llamada simple para verificar la conexión y las claves API
        try:
            logger.info(f"Verificando conexión con Futures API ({base_url_to_use}) usando time()...")
            server_time = client.time()
            logger.info(f"Conexión con Binance Futures {('Testnet' if mode != 'live' else 'Live')} exitosa. Hora del servidor: {server_time}")
            futures_client_instance = client
            return futures_client_instance

        except ClientError as e:
            # Capturar errores específicos de la librería
            logger.critical(f"Error de API al conectar con Binance Futures ({('Testnet' if mode != 'live' else 'Live')}): Status={e.status_code}, Code={e.error_code}, Msg={e.error_message}")
            logger.critical("Verifica tus API keys, permisos, si la URL base es correcta y si Binance está operativo.")
            return None
        except Exception as e:
            logger.critical(f"Error inesperado al verificar conexión con Binance Futures: {e}")
            return None

    except Exception as e:
        logger.critical(f"Error inesperado durante la inicialización de UMFutures Client: {e}")
        return None

def get_historical_klines(symbol: str, interval: str, limit: int = 500):
    """
    Obtiene datos históricos de velas (klines) para un símbolo y un intervalo dados.
    Intenta obtener Open Interest de markPriceKlines si es posible, aunque para 1m no es estándar.
    El volumen se toma de las klines estándar.
    """
    logger = get_logger()
    client = get_futures_client()
    if not client:
        logger.error("No se pudo obtener el cliente UMFutures para buscar klines.")
        return None

    logger.info(f"Obteniendo {limit} klines históricos para {symbol} en intervalo {interval}...")
    klines_data = None
    klines_df = pd.DataFrame()

    try:
        # Obtener klines estándar PRIMERO para asegurar datos OHLCV correctos
        standard_klines_raw = client.klines(symbol=symbol, interval=interval, limit=limit)
        if not standard_klines_raw:
            logger.warning(f"[{symbol}] No se recibieron datos de klines estándar.")
            return None

        # Columnas para klines estándar
        standard_columns = ['open_time', 'open', 'high', 'low', 'close', 'volume', 
                            'close_time', 'quote_volume', 'trades', 
                            'taker_buy_base_volume', 'taker_buy_quote_volume', 'ignore']
        
        klines_df = pd.DataFrame(standard_klines_raw, columns=standard_columns)
        
        # Convertir columnas relevantes a tipos numéricos adecuados
        numeric_cols = ['open', 'high', 'low', 'close', 'volume', 'quote_volume', 
                        'taker_buy_base_volume', 'taker_buy_quote_volume']
        for col in numeric_cols:
            klines_df[col] = pd.to_numeric(klines_df[col], errors='coerce').fillna(Decimal(0))

        klines_df['open_time'] = pd.to_datetime(klines_df['open_time'], unit='ms')
        klines_df['close_time'] = pd.to_datetime(klines_df['close_time'], unit='ms')
        
        # Intentar obtener Open Interest (aunque para 1m no es estándar y probablemente no funcionará bien)
        # Por ahora, vamos a registrar que OI en 1m no es fiable.
        # La API de Binance no ofrece OI Histórico en velas de 1m. Mínimo 5m.
        # La llamada a mark_price_klines NO devuelve OI.
        logger.warning(f"[{symbol}] Open Interest para velas de 1 minuto no está disponible de forma fiable a través de la API de Binance. El chequeo de OI podría no funcionar como se espera.")
        klines_df['open_interest_usdt'] = Decimal('0') # Default a 0 ya que no lo podemos obtener fiablemente en 1m

        # Mantener el cálculo de previous_close_price si se usa en otro lado
        klines_df['previous_close_price'] = klines_df['close'].shift(1)


    except ClientError as e:
        logger.error(f"Excepción de API de Binance al obtener klines para {symbol}: {e}")
        return None
    except Exception as e:
        logger.error(f"Error inesperado al obtener/procesar klines para {symbol}: {e}")
        return None

    if klines_df.empty:
        logger.warning(f"No se pudieron obtener datos de klines para {symbol} después del procesamiento.")
        return None

    logger.info(f"Se obtuvieron y procesaron {len(klines_df)} klines para {symbol}. Última vela cierra a: {klines_df['close_time'].iloc[-1] if not klines_df.empty else 'N/A'}")
    return klines_df

def get_futures_symbol_info(symbol: str):
    """
    Obtiene la información de un símbolo específico de futuros.
    (Adaptado para binance-futures-connector)
    """
    logger = get_logger()
    client = get_futures_client()
    if not client:
        logger.error("No se pudo obtener el cliente UMFutures para buscar info del símbolo.")
        return None

    try:
        # La función se llama 'exchange_info'
        logger.debug(f"Obteniendo información de exchange para futuros desde: {client.base_url}...")
        exchange_info = client.exchange_info()

        # El acceso a la información del símbolo puede ser igual
        for item in exchange_info['symbols']:
            if item['symbol'] == symbol:
                logger.info(f"Información encontrada para {symbol}: Precision Cantidad={item['quantityPrecision']}, Precision Precio={item['pricePrecision']}")
                logger.debug(f"Filtros para {symbol}: {item['filters']}")
                return item

        logger.error(f"No se encontró información para el símbolo {symbol} en exchange_info.")
        return None

    except ClientError as e:
        logger.error(f"Error de API al obtener exchange_info: Status={e.status_code}, Code={e.error_code}, Msg={e.error_message}")
        # ¡Aquí es donde ocurría el 403! Esperemos que ahora funcione.
        return None
    except Exception as e:
        logger.error(f"Error inesperado al obtener exchange_info: {e}", exc_info=True)
        return None

def create_futures_market_order(symbol: str, side: str, quantity: float):
    """
    Crea una orden de mercado de futuros (MARKET).
    (Adaptado para binance-futures-connector)
    """
    logger = get_logger()
    client = get_futures_client()
    if not client:
        logger.error("No se pudo obtener el cliente UMFutures para crear orden.")
        return None

    if side not in ['BUY', 'SELL']:
        logger.error(f"Lado de orden inválido: {side}. Debe ser 'BUY' o 'SELL'.")
        return None
    if quantity <= 0:
        logger.error(f"Cantidad inválida para la orden: {quantity}. Debe ser positiva.")
        return None

    # La nueva librería podría preferir pasar parámetros como un diccionario
    # --- INICIO MODIFICACIÓN HEDGE MODE ---
    position_side_to_use = 'LONG' # Como el bot solo maneja LONGs, siempre será LONG
    # --- FIN MODIFICACIÓN HEDGE MODE ---
    params = {
        'symbol': symbol,
        'side': side,
        'type': 'MARKET', # Usar string 'MARKET'
        'quantity': quantity, # La librería debería manejar el formato
        'positionSide': position_side_to_use # Obligatorio para Hedge Mode
    }

    logger.warning(f"Intentando crear orden de mercado: {side} {quantity} {symbol} (PositionSide={position_side_to_use}) con params: {params}")

    try:
        # La función se llama 'new_order'
        order = client.new_order(**params) # Usar ** para desempaquetar el diccionario
        logger.info(f"Orden de mercado creada exitosamente: ID={order.get('orderId', 'N/A')}, Symbol={order.get('symbol')}, Side={order.get('side')}, Qty={order.get('origQty')}, Status={order.get('status')}")
        logger.debug(f"Respuesta completa de la orden: {order}")
        return order

    except ClientError as e:
        logger.error(f"Error de API al crear orden {side} {quantity} {symbol}: Status={e.status_code}, Code={e.error_code}, Msg={e.error_message}")
        return None
    except Exception as e:
        logger.error(f"Error inesperado al crear orden {side} {quantity} {symbol}: {e}", exc_info=True)
        return None

def get_futures_position(symbol: str):
    """
    Obtiene la información de la posición actual para un símbolo de futuros específico.
    (Adaptado para binance-futures-connector usando position_risk)
    """
    logger = get_logger()
    client = get_futures_client()
    if not client:
        logger.error("No se pudo obtener el cliente UMFutures para buscar posición.")
        return None

    try:
        # Usamos 'get_position_risk' que devuelve info por símbolo
        logger.debug(f"Consultando información de riesgo/posición para {symbol}...")
        positions = client.get_position_risk(symbol=symbol)

        if not positions:
            logger.info(f"No se encontró información de posición/riesgo para {symbol} (respuesta vacía).")
            return None

        # position_risk devuelve una lista incluso para un símbolo
        position_info = positions[0]

        position_amt_str = position_info.get('positionAmt', '0')
        try:
            position_amt = float(position_amt_str)
        except ValueError:
            logger.error(f"Valor inválido para positionAmt: {position_amt_str} para {symbol}.")
            return None

        # La lógica para verificar si la posición está abierta es la misma
        if abs(position_amt) > 1e-9:
            entry_price = float(position_info.get('entryPrice', '0'))
            leverage = int(position_info.get('leverage', '0')) # Leverage viene como string
            pnl = float(position_info.get('unRealizedProfit', '0'))

            logger.info(f"Posición encontrada para {symbol}: Cantidad={position_amt:.8f}, Precio Entrada={entry_price:.4f}, PnL no realizado={pnl:.4f}, Leverage={leverage}x")
            # Devolvemos el diccionario para mantener compatibilidad con el bot
            # Puede que necesitemos ajustar las claves si TradingBot accede a algo específico no presente aquí
            return position_info
        else:
            logger.debug(f"No hay posición abierta para {symbol} (Cantidad = {position_amt:.8f}).")
            return None

    except ClientError as e:
        logger.error(f"Error de API al obtener información de posición/riesgo para {symbol}: Status={e.status_code}, Code={e.error_code}, Msg={e.error_message}")
        return None
    except Exception as e:
        logger.error(f"Error inesperado al obtener información de posición/riesgo para {symbol}: {e}", exc_info=True)
        return None

# --- Funciones existentes ---
# get_historical_klines(...)
# get_futures_symbol_info(...)
# create_futures_market_order(...)
# get_futures_position(...)

# --- NUEVAS FUNCIONES PARA ÓRDENES LIMIT ---

def get_order_book_ticker(symbol: str) -> dict | None:
    """
    Obtiene el mejor precio de compra (Bid) y venta (Ask) actual para un símbolo.
    Utiliza el endpoint futures_book_ticker.

    Args:
        symbol: El símbolo del par de futuros (ej: 'BTCUSDT').

    Returns:
        Un diccionario con 'bidPrice', 'askPrice' y otros datos si tiene éxito, None si hay error.
    """
    client = get_futures_client()
    logger = get_logger()
    if not client:
        logger.error("Cliente Binance no disponible para get_order_book_ticker.")
        return None
    try:
        # ticker = client.ticker_bookTicker(symbol=symbol.upper()) # Incorrecto 7

        # --- Octavo intento: Volvemos a book_ticker, que DEBERÍA ser el correcto ---
        ticker = client.book_ticker(symbol=symbol.upper()) 
        
        # Verificar si la respuesta contiene Bid y Ask
        bid_price = ticker.get('bidPrice')
        ask_price = ticker.get('askPrice')

        if bid_price is None or ask_price is None:
            logger.error(f"La respuesta de 'book_ticker' para {symbol} no contiene 'bidPrice' o 'askPrice'. Respuesta: {ticker}")
            return None
            
        logger.debug(f"Ticker book_ticker obtenido para {symbol}: Bid={bid_price}, Ask={ask_price}")
        return ticker # Devolver el ticker completo si Bid/Ask están presentes

    except AttributeError:
        logger.error(f"El método 'book_ticker' sigue sin existir en UMFutures. ¡Muy extraño!")
        return None
    except Exception as e:
        logger.error(f"Error al obtener el book ticker para {symbol} con 'book_ticker': {e}")
        return None

def create_futures_limit_order(symbol: str, side: str, quantity: float, price: float) -> dict | None:
    """
    Crea una orden LIMIT en Binance Futures.
    Utiliza timeInForce='GTC' (Good 'Til Canceled).

    Args:
        symbol: Símbolo del par (ej: 'BTCUSDT').
        side: 'BUY' o 'SELL'.
        quantity: La cantidad a comprar/vender.
        price: El precio límite para la orden.

    Returns:
        El diccionario de respuesta de la API si la orden se creó exitosamente, None si falló.
    """
    client = get_futures_client()
    logger = get_logger()
    if not client:
        logger.error("Cliente Binance no disponible para create_futures_limit_order.")
        return None

    side = side.upper()
    if side not in ['BUY', 'SELL']:
        logger.error(f"Lado inválido '{side}' para crear orden LIMIT.")
        return None

    try:
        logger.info(f"Intentando crear orden LIMIT {side} para {quantity} {symbol} @ {price}")
        order = client.new_order(
            symbol=symbol.upper(),
            side=side,
            type='LIMIT',
            timeInForce='GTC',
            quantity=quantity,
            price=price,
            positionSide='LONG'
        )
        logger.info(f"Orden LIMIT {side} creada para {symbol}. Respuesta API: {order}")
        # La respuesta contendrá el orderId, status ('NEW'), etc.
        return order
    except Exception as e:
        logger.error(f"Error al crear orden LIMIT {side} para {symbol} @ {price}: {e}", exc_info=True)
        return None

def get_order_status(symbol: str, order_id: int) -> dict | None:
    """
    Consulta el estado de una orden específica en Binance Futures.

    Args:
        symbol: Símbolo del par (ej: 'BTCUSDT').
        order_id: El ID de la orden a consultar.

    Returns:
        Un diccionario con la información de la orden si tiene éxito, None si hay error.
        El estado importante está en la clave 'status'.
    """
    client = get_futures_client()
    logger = get_logger()
    if not client:
        logger.error("Cliente Binance no disponible para get_order_status.")
        return None
    try:
        order_info = client.query_order(symbol=symbol.upper(), orderId=order_id)
        logger.debug(f"Estado obtenido para orden {order_id} ({symbol}): Status={order_info.get('status')}")
        return order_info
    except Exception as e:
        # Un error común aquí es "Order does not exist", que puede pasar si ya fue purgada
        # Lo manejaremos en la lógica del bot
        logger.warning(f"Error al obtener estado de la orden {order_id} ({symbol}): {e}")
        return None

def cancel_futures_order(symbol: str, order_id: int) -> dict | None:
    """
    Cancela una orden abierta específica en Binance Futures.

    Args:
        symbol: Símbolo del par (ej: 'BTCUSDT').
        order_id: El ID de la orden a cancelar.

    Returns:
        Un diccionario con la respuesta de cancelación si tiene éxito, None si hay error.
    """
    client = get_futures_client()
    logger = get_logger()
    if not client:
        logger.error("Cliente Binance no disponible para cancel_futures_order.")
        return None
    try:
        logger.warning(f"Intentando cancelar orden {order_id} para {symbol}...")
        cancel_response = client.cancel_order(symbol=symbol.upper(), orderId=order_id)
        logger.info(f"Respuesta de cancelación para orden {order_id} ({symbol}): {cancel_response}")
        # La respuesta confirma los detalles de la orden cancelada.
        return cancel_response
    except Exception as e:
        # Un error común es si la orden ya no existe (fue llenada o cancelada justo antes)
        logger.error(f"Error al intentar cancelar orden {order_id} ({symbol}): {e}", exc_info=False) # No mostrar traceback completo para errores esperados
        return None

# --- Funciones para colocar órdenes TP/SL ---
def create_futures_take_profit_order(symbol: str, side: str, quantity: float, take_profit_price: str, close_position: bool = True) -> dict | None:
    """
    Coloca una orden TAKE_PROFIT_MARKET en Binance Futures.
    Para una posición LONG, side='SELL'.
    take_profit_price es el precio al que se activa la orden de mercado.
    """
    logger = get_logger()
    client = get_futures_client()
    if not client:
        logger.error("Cliente de Binance no inicializado al intentar crear orden Take Profit.")
        return None

    params = {
        'symbol': symbol,
        'side': side,                    # 'BUY' o 'SELL'
        'type': 'TAKE_PROFIT_MARKET',    # Tipo de orden
        'quantity': quantity,            # Cantidad a comprar/vender
        'stopPrice': take_profit_price,  # Precio de activación para TP
        'closePosition': str(close_position).lower(), # 'true' o 'false'
        'positionSide': 'LONG'           # Asumiendo que el bot solo opera LONG
        # 'timeInForce': 'GTC', # No usualmente necesario para TAKE_PROFIT_MARKET con closePosition=true
    }
    logger.info(f"Intentando colocar orden TAKE_PROFIT_MARKET para {symbol}: Side={side}, Qty={quantity}, TP Price={take_profit_price}, ClosePos={close_position}")
    try:
        # Usar client.new_order() que es el método estándar para crear órdenes
        order = client.new_order(**params)
        logger.info(f"Orden TAKE_PROFIT_MARKET creada: ID={order.get('orderId')}, Status={order.get('status')}")
        logger.debug(f"Respuesta completa de orden TP: {order}")
        return order
    except ClientError as e:
        logger.error(f"Error de API al colocar la orden TAKE_PROFIT_MARKET para {symbol} @ {take_profit_price}: Status={e.status_code}, Code={e.error_code}, Msg={e.error_message}", exc_info=True)
        return None
    except Exception as e:
        logger.error(f"Error al colocar la orden TAKE_PROFIT_MARKET para {symbol} @ {take_profit_price}: {e}", exc_info=True)
        return None

def create_futures_stop_loss_order(symbol: str, side: str, quantity: float, stop_loss_price: str, close_position: bool = True) -> dict | None:
    """
    Coloca una orden STOP_MARKET en Binance Futures.
    Para una posición LONG, side='SELL'.
    stop_loss_price es el precio al que se activa la orden de mercado.
    """
    logger = get_logger()
    client = get_futures_client()
    if not client:
        logger.error("Cliente de Binance no inicializado al intentar crear orden Stop Loss.")
        return None

    params = {
        'symbol': symbol,
        'side': side,                   # 'BUY' o 'SELL'
        'type': 'STOP_MARKET',          # Tipo de orden
        'quantity': quantity,           # Cantidad a comprar/vender
        'stopPrice': stop_loss_price,   # Precio de activación para SL
        'closePosition': str(close_position).lower(), # 'true' o 'false'
        'positionSide': 'LONG'          # Asumiendo que el bot solo opera LONG
        # 'timeInForce': 'GTC', # No usualmente necesario para STOP_MARKET con closePosition=true
    }
    logger.info(f"Intentando colocar orden STOP_MARKET para {symbol}: Side={side}, Qty={quantity}, SL Price={stop_loss_price}, ClosePos={close_position}")
    try:
        # Usar client.new_order()
        order = client.new_order(**params)
        logger.info(f"Orden STOP_MARKET creada: ID={order.get('orderId')}, Status={order.get('status')}")
        logger.debug(f"Respuesta completa de orden SL: {order}")
        return order
    except ClientError as e:
        logger.error(f"Error de API al colocar la orden STOP_MARKET para {symbol} @ {stop_loss_price}: Status={e.status_code}, Code={e.error_code}, Msg={e.error_message}", exc_info=True)
        return None
    except Exception as e:
        logger.error(f"Error al colocar la orden STOP_MARKET para {symbol} @ {stop_loss_price}: {e}", exc_info=True)
        return None

# --- FIN MODIFICACIONES ---

# --- Nueva función para obtener historial de trades del usuario ---
def get_user_trade_history(symbol: str, start_time_ms: int | None = None, limit: int = 10) -> list[dict] | None:
    """
    Fetches user's trade history for a specific symbol from Binance Futures.
    Filters by start_time_ms if provided. Returns newest trades first by default from API,
    but we sort explicitly to ensure.
    """
    logger = get_logger()
    client = get_futures_client()
    if not client:
        logger.error(f"[{symbol}] Binance client not initialized for get_user_trade_history.")
        return None

    try:
        params = {
            'symbol': symbol.upper(),
            'limit': limit
        }
        if start_time_ms is not None:
            params['startTime'] = start_time_ms
        
        # client.futures_account_trades() suele devolver los más recientes si no se especifica orderId o fromId.
        # La documentación indica que los trades se devuelven en orden ascendente por 'time'.
        # Para obtener los más recientes relacionados con un cierre, podríamos necesitar buscar desde el final.
        trades = client.futures_account_trades(**params)
        
        if trades:
            # Ordenar por 'time' descendente (más nuevo primero) para procesar cierres recientes primero.
            trades.sort(key=lambda x: x['time'], reverse=True)
            logger.info(f"[{symbol}] Fetched {len(trades)} user trades. Limit: {limit}, StartTime: {start_time_ms}. Newest first.")
            # logger.debug(f"[{symbol}] Last few trades: {trades[:min(3, len(trades))]}") # Log some for debugging
        else:
            logger.info(f"[{symbol}] No user trades found for the given parameters.")
        return trades
    except Exception as e:
        logger.error(f"[{symbol}] Error fetching user trade history: {e}", exc_info=True)
        return None
# --- Fin de la nueva función ---

# --- NUEVA FUNCIÓN PARA OBTENER HISTORIAL DE OPEN INTEREST ---
def get_open_interest_history(symbol: str, period: str, limit: int = 2) -> list[dict] | None:
    """
    Obtiene el historial de estadísticas de Open Interest para un símbolo y período dados.
    Usa el endpoint /futures/data/openInterestHist.

    Args:
        symbol (str): El símbolo del par de trading (ej. "BTCUSDT").
        period (str): El período de las velas de OI ("5m", "15m", "30m", "1h", "2h", "4h", "6h", "12h", "1d").
        limit (int): Número de puntos de datos a obtener (default 2, max 500).

    Returns:
        list[dict] | None: Una lista de diccionarios con los datos de OI, o None si hay un error.
                           Cada diccionario contiene: 'symbol', 'sumOpenInterest', 'sumOpenInterestValue', 'timestamp'.
                           Los datos se devuelven en orden ascendente de tiempo (el más reciente al final).
    """
    logger = get_logger()
    client = get_futures_client()
    if not client:
        logger.error(f"[{symbol}] No se pudo obtener el cliente UMFutures para get_open_interest_history.")
        return None

    valid_periods = ["5m", "15m", "30m", "1h", "2h", "4h", "6h", "12h", "1d"]
    if period not in valid_periods:
        logger.error(f"[{symbol}] Período de Open Interest inválido: '{period}'. Válidos: {valid_periods}")
        return None
    
    if not 1 <= limit <= 500:
        logger.error(f"[{symbol}] Límite para Open Interest inválido: {limit}. Debe estar entre 1 y 500.")
        return None

    logger.info(f"[{symbol}] Obteniendo historial de Open Interest. Símbolo: {symbol}, Período: {period}, Límite: {limit}")

    try:
        # El método en la librería se llama open_interest_hist
        # Nota: La librería python-binance (si es la que está implícita) podría no tener este endpoint directamente.
        # Es posible que se necesite una llamada HTTP directa o una actualización de la librería si es antigua.
        # Asumiendo que el cliente UMFutures tiene un método genérico para llamadas GET o uno específico.
        # Si la librería 'binance-futures-connector' (o la que se esté usando) no tiene open_interest_hist,
        # este código necesitará adaptarse para hacer una llamada HTTP directa.
        # Por ahora, asumimos que la librería lo soporta o que este código es un placeholder para esa lógica.

        # Consultando la documentación de python-binance, no parece tener un método directo para /futures/data/openInterestHist.
        # Para una implementación robusta, se necesitaría una llamada HTTP directa si el SDK no lo soporta.
        # Sin embargo, para continuar con el flujo de desarrollo y si el SDK se actualiza o hay otro método,
        # lo dejaremos así conceptualmente.
        
        # UPDATE: La librería `binance-futures-connector` SÍ tiene `open_interest_hist`.
        oi_history = client.open_interest_hist(symbol=symbol, period=period, limit=limit)
        
        if oi_history:
            logger.info(f"[{symbol}] Se obtuvieron {len(oi_history)} puntos de Open Interest. El más reciente: {oi_history[-1] if oi_history else 'N/A'}")
            # Convertir 'sumOpenInterestValue' a Decimal para consistencia si es necesario
            for item in oi_history:
                if 'sumOpenInterestValue' in item:
                    try:
                        item['sumOpenInterestValue'] = Decimal(str(item['sumOpenInterestValue']))
                    except Exception as e_dec:
                        logger.warning(f"[{symbol}] No se pudo convertir sumOpenInterestValue a Decimal para el item: {item}. Error: {e_dec}")
                        item['sumOpenInterestValue'] = Decimal('0') # Fallback
                if 'sumOpenInterest' in item: # También el OI base
                     try:
                        item['sumOpenInterest'] = Decimal(str(item['sumOpenInterest']))
                     except Exception as e_dec:
                        logger.warning(f"[{symbol}] No se pudo convertir sumOpenInterest a Decimal para el item: {item}. Error: {e_dec}")
                        item['sumOpenInterest'] = Decimal('0') # Fallback
            return oi_history
        else:
            logger.warning(f"[{symbol}] No se recibió historial de Open Interest para {symbol}, período {period}.")
            return [] # Devolver lista vacía en lugar de None si la llamada fue exitosa pero no hay datos

    except ClientError as e:
        logger.error(f"[{symbol}] Error de API (ClientError) al obtener historial de Open Interest para {symbol} ({period}): Status={e.status_code}, Code={e.error_code}, Msg={e.error_message}")
        return None
    except Exception as e:
        logger.error(f"[{symbol}] Error inesperado al obtener historial de Open Interest para {symbol} ({period}): {e}", exc_info=True)
        return None
# --- FIN NUEVA FUNCIÓN ---

# Ejemplo de uso (no ejecutar directamente aquí)
# if __name__ == '__main__':
#     from logger_setup import setup_logging
#     main_logger = setup_logging(log_filename='binance_client_test.log')
#     if main_logger:
#         # Test get_futures_client
#         # ... (código de prueba existente) ...

#         # Para probar TP/SL (requiere una posición o configuración cuidadosa)
#         # Asegúrate de que el símbolo, cantidad y precios sean válidos.
#         test_symbol = "BTCUSDT" # Cambia a un símbolo de testnet si es necesario
#         current_price_info = get_order_book_ticker(test_symbol)
#         if current_price_info:
#             current_price = Decimal(current_price_info.get('askPrice', '0'))
#             if current_price > 0:
#                 tp_test_price = current_price * Decimal('1.01') # TP +1%
#                 sl_test_price = current_price * Decimal('0.99') # SL -1%
#                 test_quantity = 0.001

                # main_logger.info(f"Test: Precio actual {current_price}, TP: {tp_test_price}, SL: {sl_test_price}")

                # tp_order = create_futures_take_profit_order(test_symbol, "SELL", test_quantity, str(tp_test_price.quantize(Decimal('0.01'))))
                # if tp_order:
                #     main_logger.info(f"TP order test result: {tp_order}")
                
                # sl_order = create_futures_stop_loss_order(test_symbol, "SELL", test_quantity, str(sl_test_price.quantize(Decimal('0.01'))))
                # if sl_order:
                #     main_logger.info(f"SL order test result: {sl_order}")
# pass 