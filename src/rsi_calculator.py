# Este módulo contendrá la lógica para calcular el RSI.
# Por ahora, lo dejamos vacío. 

import pandas as pd
import numpy as np
import pandas_ta as ta # Importamos la librería pandas-ta

# Importamos el logger
from .logger_setup import get_logger

def calculate_rsi(close_prices: pd.Series, period: int = 14, rsi_type: str = 'WILDER'):
    """
    Calcula el Índice de Fuerza Relativa (RSI) con soporte unificado para:
    - 'WILDER': Suavizado exponencial oficial de Welles Wilder (estándar Binance y TradingView).
    - 'CUTLER': Media móvil simple directa (SMA) de ganancias/pérdidas (fórmula reactiva del backtester).

    Args:
        close_prices (pd.Series): Una Serie de Pandas que contiene los precios de cierre.
        period (int): El período a usar para el cálculo del RSI (ej: 14).
        rsi_type (str): 'WILDER' (default) o 'CUTLER'.

    Returns:
        pd.Series: Serie de Pandas con los valores de RSI calculados.
    """
    logger = get_logger()

    # Validar la entrada
    if not isinstance(close_prices, pd.Series):
        logger.error("Error en calculate_rsi: close_prices debe ser una Serie de Pandas.")
        return None
    if not isinstance(period, int) or period <= 0:
        logger.error(f"Error en calculate_rsi: el período debe ser un entero positivo, se recibió {period}.")
        return None

    min_required_data = period + 2
    if len(close_prices) < min_required_data:
        logger.warning(f"Datos insuficientes para calcular RSI con período {period}. "
                       f"Se necesitan {min_required_data} puntos, se tienen {len(close_prices)}.")
        return None

    try:
        close = close_prices.astype(float)
        mode = str(rsi_type or 'WILDER').upper().strip()

        if mode in ('CUTLER', 'SMA', 'SIMPLE'):
            # Cálculo tipo Cutler's RSI usando media móvil simple directa (SMA)
            delta = close.diff()
            gain = (delta.where(delta > 0, 0.0)).rolling(window=period).mean()
            loss = (-delta.where(delta < 0, 0.0)).rolling(window=period).mean()
            rs = gain / loss.replace(0, np.nan)
            rsi_series = 100.0 - (100.0 / (1.0 + rs))
            return rsi_series.fillna(50.0)

        # Por defecto: WILDER (Suavizado exponencial estándar Binance / TradingView)
        delta = close.diff()
        gain = delta.where(delta > 0, 0.0)
        loss = -delta.where(delta < 0, 0.0)

        avg_gain = gain.ewm(alpha=1.0 / period, min_periods=period, adjust=False).mean()
        avg_loss = loss.ewm(alpha=1.0 / period, min_periods=period, adjust=False).mean()

        rs = avg_gain / avg_loss.replace(0, 1e-10)
        rsi_series = 100.0 - (100.0 / (1.0 + rs))
        return rsi_series.fillna(50.0)

    except Exception as e:
        logger.error(f"Error inesperado al calcular RSI: {e}", exc_info=True)
        return None

def calculate_ema(close_prices: pd.Series, period: int = 50) -> pd.Series | None:
    """Calcula la Media Móvil Exponencial (EMA)."""
    logger = get_logger()
    if not isinstance(close_prices, pd.Series) or len(close_prices) < period:
        logger.warning(f"Datos insuficientes para EMA de período {period} (datos: {len(close_prices) if isinstance(close_prices, pd.Series) else 0})")
        return None
    try:
        close = close_prices.astype(float)
        return close.ewm(span=period, adjust=False).mean()
    except Exception as e:
        logger.error(f"Error al calcular EMA({period}): {e}")
        return None

def calculate_supertrend(df: pd.DataFrame, period: int = 10, multiplier: float = 3.0) -> pd.DataFrame | None:
    """
    Calcula el indicador SuperTrend estándar según la fórmula oficial (TradingView / ATR).
    
    Args:
        df: DataFrame con columnas 'high', 'low', 'close'.
        period: Período del ATR (default 10).
        multiplier: Multiplicador de volatilidad (default 3.0).
        
    Returns:
        pd.DataFrame con columnas:
          - 'supertrend': Valor numérico de la línea SuperTrend.
          - 'trend': 1 si es ALCISTA (Verde / Bullish), -1 si es BAJISTA (Rojo / Bearish).
          - 'is_bullish': Booleano (True = Alcista, False = Bajista).
        O None si faltan datos.
    """
    logger = get_logger()
    if df is None or len(df) < period + 2:
        logger.warning(f"Datos insuficientes para SuperTrend({period}, {multiplier}) (filas: {len(df) if df is not None else 0})")
        return None

    try:
        high = df['high'].astype(float).values
        low = df['low'].astype(float).values
        close = df['close'].astype(float).values
        n = len(df)

        # 1. True Range (TR)
        tr = np.zeros(n)
        tr[0] = high[0] - low[0]
        for i in range(1, n):
            tr[i] = max(
                high[i] - low[i],
                abs(high[i] - close[i - 1]),
                abs(low[i] - close[i - 1])
            )

        # 2. Average True Range (ATR) usando suavizado de Wilder
        atr = np.zeros(n)
        atr[period - 1] = np.mean(tr[:period])
        for i in range(period, n):
            atr[i] = (atr[i - 1] * (period - 1) + tr[i]) / period

        # 3. Bandas Básicas
        hl2 = (high + low) / 2.0
        basic_upper = hl2 + (multiplier * atr)
        basic_lower = hl2 - (multiplier * atr)

        # 4. Bandas Finales y Dirección de Tendencia
        final_upper = np.zeros(n)
        final_lower = np.zeros(n)
        trend = np.zeros(n, dtype=int)
        supertrend = np.zeros(n)

        # Iteración secuencial
        for i in range(period, n):
            # Final Upper Band
            if (basic_upper[i] < final_upper[i - 1]) or (close[i - 1] > final_upper[i - 1]):
                final_upper[i] = basic_upper[i]
            else:
                final_upper[i] = final_upper[i - 1]

            # Final Lower Band
            if (basic_lower[i] > final_lower[i - 1]) or (close[i - 1] < final_lower[i - 1]):
                final_lower[i] = basic_lower[i]
            else:
                final_lower[i] = final_lower[i - 1]

            # Dirección de Tendencia
            prev_trend = trend[i - 1] if i > period else 1
            if prev_trend == 1:
                if close[i] < final_lower[i]:
                    trend[i] = -1
                    supertrend[i] = final_upper[i]
                else:
                    trend[i] = 1
                    supertrend[i] = final_lower[i]
            else:
                if close[i] > final_upper[i]:
                    trend[i] = 1
                    supertrend[i] = final_lower[i]
                else:
                    trend[i] = -1
                    supertrend[i] = final_upper[i]

        result = pd.DataFrame(index=df.index)
        result['supertrend'] = supertrend
        result['trend'] = trend
        result['is_bullish'] = (trend == 1)
        return result
    except Exception as e:
        logger.error(f"Error al calcular SuperTrend({period}, {multiplier}): {e}", exc_info=True)
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