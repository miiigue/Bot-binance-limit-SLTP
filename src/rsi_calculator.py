# Este módulo contendrá la lógica para calcular el RSI.
# Por ahora, lo dejamos vacío. 

import pandas as pd
import pandas_ta as ta # Importamos la librería pandas-ta

# Importamos el logger
from .logger_setup import get_logger

def calculate_rsi(close_prices: pd.Series, period: int):
    """
    Calcula el Índice de Fuerza Relativa (RSI) usando pandas_ta.

    Args:
        close_prices (pd.Series): Una Serie de Pandas que contiene los precios de cierre.
                                  Debe tener al menos 'period' + 1 valores.
        period (int): El período a usar para el cálculo del RSI (ej: 14).

    Returns:
        pd.Series: Una Serie de Pandas con los valores de RSI calculados.
                   Los primeros 'period' valores serán NaN (Not a Number) porque
                   se necesita ese historial mínimo para el cálculo.
                   Retorna None si hay un error o datos insuficientes.
    """
    logger = get_logger()

    # Validar la entrada
    if not isinstance(close_prices, pd.Series):
        logger.error("Error en calculate_rsi: close_prices debe ser una Serie de Pandas.")
        return None
    if not isinstance(period, int) or period <= 0:
        logger.error(f"Error en calculate_rsi: el período debe ser un entero positivo, se recibió {period}.")
        return None

    # Verificar si hay suficientes datos para el cálculo
    # pandas_ta necesita al menos 'period' puntos para empezar a calcular.
    # Pediremos un poco más para estar seguros (por si acaso la librería tiene requisitos internos)
    min_required_data = period + 2
    if len(close_prices) < min_required_data:
        logger.warning(f"Datos insuficientes para calcular RSI con período {period}. "
                       f"Se necesitan {min_required_data} puntos, se tienen {len(close_prices)}.")
        return None

    try:
        close = close_prices.astype(float)

        # 1. Intentar cálculo con pandas_ta si el método existe
        try:
            if hasattr(ta, 'rsi'):
                rsi_series = ta.rsi(close=close, length=period)
                if rsi_series is not None and not rsi_series.empty:
                    return rsi_series
            if hasattr(close, 'ta') and hasattr(close.ta, 'rsi'):
                rsi_series = close.ta.rsi(length=period)
                if rsi_series is not None and not rsi_series.empty:
                    return rsi_series
        except Exception:
            pass

        # 2. Cálculo nativo matemático de Wilder's RSI (Exactamente el estándar de Binance / TradingView)
        delta = close.diff()
        gain = delta.where(delta > 0, 0.0)
        loss = -delta.where(delta < 0, 0.0)

        avg_gain = gain.ewm(alpha=1.0 / period, min_periods=period, adjust=False).mean()
        avg_loss = loss.ewm(alpha=1.0 / period, min_periods=period, adjust=False).mean()

        rs = avg_gain / avg_loss.replace(0, 1e-10)
        rsi_series = 100.0 - (100.0 / (1.0 + rs))

        return rsi_series

    except Exception as e:
        logger.error(f"Error inesperado al calcular RSI: {e}", exc_info=True)
        return None

# --- Bloque de ejemplo para probar la función --- 
if __name__ == '__main__':
    # Configurar logger para poder ver los mensajes del ejemplo
    from .logger_setup import setup_logging
    setup_logging()
    main_logger = get_logger()

    if main_logger:
        # Crear datos de precios de cierre de ejemplo (simulando una subida y luego bajada)
        prices_data = [
            50000, 50100, 50050, 50200, 50300, 50250, 50400, 50500, 50600, 50700, # 10
            50800, 50900, 51000, 51100, 51200, 51150, 51050, 50900, 50850, 50700, # 20
            50600, 50500, 50400, 50300, 50200, 50100, 50000, 49900, 49800, 49700  # 30
        ]
        close_prices_series = pd.Series(prices_data)
        rsi_period_example = 14

        main_logger.info(f"Probando cálculo de RSI con {len(close_prices_series)} precios y período {rsi_period_example}")

        # Calcular RSI
        rsi_values = calculate_rsi(close_prices_series, period=rsi_period_example)

        if rsi_values is not None:
            main_logger.info("Cálculo de RSI exitoso.")
            # Imprimir los últimos 5 valores de RSI calculados
            # Usamos .iloc[-5:] para obtener las últimas 5 filas
            # Usamos .round(2) para redondear a 2 decimales
            main_logger.info(f"Últimos 5 valores de RSI:\n{rsi_values.iloc[-5:].round(2)}")

            # Ejemplo de cómo obtener solo el último valor
            latest_rsi = rsi_values.iloc[-1]
            if pd.notna(latest_rsi):
                 main_logger.info(f"Último valor de RSI calculado: {latest_rsi:.2f}")
            else:
                 main_logger.warning("El último valor de RSI es NaN.")
        else:
            main_logger.error("Fallo al calcular el RSI en el ejemplo.")

        # --- Prueba con datos insuficientes --- 
        main_logger.info("\nProbando con datos insuficientes...")
        short_prices = pd.Series(prices_data[:10]) # Solo los primeros 10 precios
        rsi_short = calculate_rsi(short_prices, period=rsi_period_example)
        if rsi_short is None:
             main_logger.info("Correcto: La función devolvió None por datos insuficientes.")
        else:
             main_logger.error("Incorrecto: La función debería haber devuelto None.")
    else:
        print("Fallo al configurar el logger, no se puede ejecutar el ejemplo de RSI.") 