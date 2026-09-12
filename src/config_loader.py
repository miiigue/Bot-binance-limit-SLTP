# Este módulo cargará la configuración desde un archivo.
# Por ahora, lo dejamos vacío.

import configparser
import os
import sys

# Determinar la ruta al archivo config.ini relativa al directorio del script
# Esto hace que funcione independientemente desde dónde se ejecute el script principal
# Siempre y cuando config.ini esté en el directorio raíz del proyecto.
SCRIPT_DIR = os.path.dirname(os.path.abspath(__file__))
PROJECT_ROOT = os.path.dirname(SCRIPT_DIR)
CONFIG_FILE_PATH = os.path.join(PROJECT_ROOT, 'config.ini')

# Variable global para almacenar la configuración cargada
# Evita leer el archivo múltiples veces
_config_cache = None

def load_config(force_reload: bool = False):
    """
    Carga la configuración desde el archivo config.ini definido en CONFIG_FILE_PATH.
    Utiliza un caché para evitar lecturas repetidas del archivo, salvo si force_reload=True.

    Returns:
        configparser.ConfigParser or None: El objeto ConfigParser cargado o None si ocurre un error.
    """
    global _config_cache
    if _config_cache and not force_reload:
        return _config_cache

    if not os.path.exists(CONFIG_FILE_PATH):
        print(f"ERROR CRÍTICO: El archivo de configuración '{CONFIG_FILE_PATH}' no existe.", file=sys.stderr)
        return None

    config = configparser.ConfigParser(
        interpolation=None,
        inline_comment_prefixes=(';', '#')
    )
    try:
        config.read(CONFIG_FILE_PATH, encoding='utf-8')
        _config_cache = config
        return _config_cache
    except configparser.Error as e:
        print(f"ERROR CRÍTICO: Error al parsear el archivo de configuración '{CONFIG_FILE_PATH}': {e}", file=sys.stderr)
        return None
    except Exception as e:
        print(f"ERROR CRÍTICO: Error inesperado al leer '{CONFIG_FILE_PATH}': {e}", file=sys.stderr)
        return None

def reload_config():
    """Fuerza la recarga de la configuración desde config.ini."""
    return load_config(force_reload=True)

def get_trading_symbols() -> list[str]:
    """
    Lee la lista de símbolos a operar desde la sección [SYMBOLS] del config.ini.
    
    Returns:
        list[str]: Una lista de símbolos (strings). Lista vacía si hay error o no se define.
    """
    config = load_config()
    if not config:
        print("ERROR: No se pudo cargar la configuración para obtener símbolos.", file=sys.stderr)
        return []

    try:
        symbols_str = config.get('SYMBOLS', 'symbols_to_trade', fallback='')
        if not symbols_str:
            print("WARNING: No se encontraron símbolos en [SYMBOLS]/symbols_to_trade en config.ini.", file=sys.stderr)
            return []
        
        # Limpiar espacios y dividir por coma
        symbols_list = [symbol.strip().upper() for symbol in symbols_str.split(',') if symbol.strip()]
        
        if not symbols_list:
             print("WARNING: La lista de símbolos en config.ini está vacía o mal formada.", file=sys.stderr)
             return []
             
        return symbols_list

    except (configparser.NoSectionError, configparser.NoOptionError):
         print("ERROR: Sección [SYMBOLS] o clave 'symbols_to_trade' no encontrada en config.ini.", file=sys.stderr)
         return []
    except Exception as e:
        print(f"ERROR: Error inesperado al leer símbolos de config.ini: {e}", file=sys.stderr)
        return []

def is_multi_strategy_enabled() -> bool:
    """Verifica si el modo multi-estrategia por moneda está habilitado en config.ini."""
    config = load_config()
    if not config:
        return False
    try:
        return config.getboolean('MULTI_STRATEGY', 'enabled', fallback=False)
    except Exception:
        return False

def get_symbol_strategy_assignments() -> dict[str, str]:
    """
    Lee las asignaciones símbolo -> nombre_estrategia desde la sección [MULTI_STRATEGY].
    Retorna un diccionario en mayúsculas: {'SOLUSDT': 'v5_RSI...', 'BTCUSDT': 'v4_EMA...'}
    """
    config = load_config()
    if not config:
        return {}
    if not config.has_section('MULTI_STRATEGY'):
        return {}
    
    assignments = {}
    for key, val in config.items('MULTI_STRATEGY'):
        if key.lower() == 'enabled':
            continue
        sym = key.strip().upper()
        strat = val.strip()
        if sym and strat:
            assignments[sym] = strat
    return assignments

def get_strategy_for_symbol(symbol: str, fallback_strategy: str = '') -> str:
    """Obtiene la estrategia asignada a un símbolo específico, o la estrategia por defecto."""
    assignments = get_symbol_strategy_assignments()
    return assignments.get(symbol.strip().upper(), fallback_strategy)

# Ejemplo de uso (no se ejecuta al importar)
if __name__ == '__main__':
    print(f"Buscando config en: {CONFIG_FILE_PATH}")
    cfg = load_config()
    if cfg:
        print("Configuración cargada exitosamente.")
        print("Secciones:", cfg.sections())

        # Ejemplo de cómo acceder a un valor
        mode = cfg.get('BINANCE', 'MODE', fallback='No definido')
        print(f"Modo Binance: {mode}")
        
        # Probar la nueva función
        symbols = get_trading_symbols()
        if symbols:
            print(f"Símbolos a operar: {symbols}")
        else:
            print("No se pudieron obtener los símbolos a operar.")
            
    else:
        print("Fallo al cargar la configuración.") 