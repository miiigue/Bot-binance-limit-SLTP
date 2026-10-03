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
    """Verifica si el modo multi-estrategia por moneda está habilitado. Consulta DB primero."""
    try:
        from src.database import get_bot_setting
        db_multi = get_bot_setting('multi_strategy_enabled')
        if db_multi is not None and str(db_multi).strip() != '':
            return str(db_multi).strip().lower() == 'true'
    except Exception:
        pass

    config = load_config()
    if not config:
        return False
    try:
        return config.getboolean('MULTI_STRATEGY', 'enabled', fallback=False)
    except Exception:
        return False

def get_symbol_strategy_assignments() -> dict[str, str]:
    """
    Lee las asignaciones símbolo -> nombre_estrategia. Consulta DB primero.
    """
    try:
        from src.database import get_bot_setting
        import json as _json
        db_assign_raw = get_bot_setting('strategy_assignments')
        if db_assign_raw:
            parsed = _json.loads(db_assign_raw)
            if isinstance(parsed, dict) and parsed:
                return {k.strip().upper(): v.strip() for k, v in parsed.items() if k and v}
    except Exception:
        pass

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
    """
    Obtiene la estrategia asignada a un símbolo específico, o la estrategia activa real.
    PRIORIDAD SOBERANA:
    0. Base de datos (inmune a Git pull, stash o reset).
    1. Asignaciones multi-estrategia.
    2. config.ini [STRATEGY_INFO] active_strategy_name.
    3. Archivos en strategies/
    """
    # 0. PRIORIDAD ABSOLUTA: Consultar base de datos
    try:
        from src.database import get_active_strategy_from_db, get_bot_setting
        import json as _json

        # Si multi-estrategia está activa
        if is_multi_strategy_enabled():
            db_assign_raw = get_bot_setting('strategy_assignments')
            if db_assign_raw:
                db_map = _json.loads(db_assign_raw)
                sym_strat = db_map.get(symbol.strip().upper(), '').strip()
                if sym_strat and sym_strat.lower() != 'global':
                    return sym_strat

        # Estrategia global soberana en DB
        db_active = get_active_strategy_from_db()
        if db_active and db_active.lower() != 'global':
            return db_active
    except Exception:
        pass

    # 1. Asignaciones de archivo
    assignments = get_symbol_strategy_assignments()
    strat = assignments.get(symbol.strip().upper(), '').strip()
    if strat and strat.lower() != 'global':
        return strat

    if fallback_strategy and fallback_strategy.strip().lower() != 'global':
        return fallback_strategy.strip()

    # 2. Buscar en [STRATEGY_INFO] active_strategy_name
    config = load_config()
    if config and config.has_section('STRATEGY_INFO'):
        act = config.get('STRATEGY_INFO', 'active_strategy_name', fallback='').strip()
        if act and act.lower() != 'global':
            return act

    # 3. Buscar en la carpeta strategies/ el archivo más reciente o que coincida
    strat_dir = os.path.join(PROJECT_ROOT, 'strategies')
    if os.path.exists(strat_dir):
        files = [f[:-5] for f in os.listdir(strat_dir) if f.endswith('.json') and f[:-5].lower() != 'global']
        if files:
            v18_match = [f for f in files if 'v18' in f.lower()]
            if v18_match:
                return v18_match[0]
            v17_match = [f for f in files if 'v17' in f.lower()]
            if v17_match:
                return v17_match[0]
            v3_match = [f for f in files if 'v3' in f.lower() or 'rsi' in f.lower()]
            return v3_match[0] if v3_match else files[0]

    return 'v18_v17_RSI-SNIPER-MOMENTUM_con12xyTS5c3_SL500_3DCA2_ReDi5c5'


def derive_short_params(long_params: dict) -> dict:
    """
    Deriva de forma matemática exacta los parámetros de SHORT a partir de los de LONG (Auto-Mirror).
    Garantiza simetría perfecta en osciladores (RSI respecto a 50), deltas y velas requeridas.
    """
    short_params = dict(long_params)
    short_params['trade_side'] = 'SHORT'

    def _to_float(v, default):
        try:
            return float(v) if v is not None and str(v).strip() != '' else default
        except Exception:
            return default

    # 1. Rango RSI simétrico respecto al centro 50: [100 - high, 100 - low]
    long_rsi_low = _to_float(long_params.get('rsi_entry_level_low'), 30.0)
    long_rsi_high = _to_float(long_params.get('rsi_entry_level_high'), 45.0)
    short_params['rsi_entry_level_low'] = round(100.0 - long_rsi_high, 2)
    short_params['rsi_entry_level_high'] = round(100.0 - long_rsi_low, 2)

    # 2. Delta RSI simétrico (giro a la baja)
    thresh_up = _to_float(long_params.get('rsi_threshold_up'), 1.5)
    short_params['rsi_threshold_down'] = -abs(thresh_up)
    short_params['rsi_threshold_up'] = short_params['rsi_threshold_down']

    # 3. Objetivo RSI simétrico
    target = _to_float(long_params.get('rsi_target'), 50.0)
    short_params['rsi_target'] = round(100.0 - target, 2)

    # 4. Velas requeridas (en short son velas rojas)
    short_params['required_downtrend_candles'] = int(long_params.get('required_uptrend_candles', 0) or 0)

    # 5. DCA en short: el precio sube en contra
    short_params['dca_price_rise_percent'] = _to_float(long_params.get('dca_price_drop_percent'), 1.5)

    return short_params

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