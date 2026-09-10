import logging

def get_sleep_seconds(cycle_sleep_seconds: int, logger: logging.Logger, min_sleep_seconds: int = 5) -> int:
    """
    Calcula el tiempo de espera para el ciclo del bot, asegurando un mínimo.
    """
    sleep_time = max(int(cycle_sleep_seconds), min_sleep_seconds)
    logger.info(f"Usando tiempo de espera explícito: {sleep_time} segundos (desde cycle_sleep_seconds, min {min_sleep_seconds}s).")
    return sleep_time 