"""
Módulo para funciones de utilidad compartidas por diferentes partes del bot.
"""

from src.logger_setup import get_logger

def calculate_sleep_from_interval(interval_str: str) -> int:
    """Calcula segundos de espera basados en el string del intervalo (e.g., '1m', '5m', '1h'). Mínimo 5s."""
    logger = get_logger()
    unit = interval_str[-1].lower()
    try:
        value = int(interval_str[:-1])
        if unit == 'm':
            return max(60 * value, 5) 
        elif unit == 'h':
            return max(3600 * value, 5)
        else:
            logger.warning(f"Unidad de intervalo no reconocida '{unit}' en '{interval_str}'. Usando 60s por defecto.")
            return 60
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