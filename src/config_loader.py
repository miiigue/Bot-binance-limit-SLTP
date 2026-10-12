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
            return files[0]

    return 'Estrategia_Base'


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

def load_trading_params() -> dict:
    """
    Carga los parámetros de trading activos combinando config.ini y la estrategia activa.
    Garantiza que TradingBot pueda instanciarse directamente sin error de importación.
    """
    params = {}
    config = load_config()
    if config and config.has_section('TRADING'):
        params = dict(config.items('TRADING'))

    try:
        from src.database import get_saved_trading_params_from_db
        saved_db = get_saved_trading_params_from_db()
        if saved_db and isinstance(saved_db, dict):
            from src.api_server import map_frontend_trading_binance
            mapped = map_frontend_trading_binance(saved_db)
            if 'TRADING' in mapped:
                params.update(mapped['TRADING'])
    except Exception:
        pass

    return params
 
 
def normalize_strategy_dict(data: dict) -> dict:
    """
    Normaliza exhaustivamente un diccionario de configuración o estrategia
    asegurando que todos los parámetros existan simultáneamente en formato
    snake_case y camelCase con sus tipos numéricos/booleanos correctos.
    """
    if not isinstance(data, dict):
        return {}

    normalized = dict(data)

    def _get_val(k_camel, k_snake, default=None):
        v = data.get(k_camel)
        if v is not None and str(v).strip() != '':
            return v
        v = data.get(k_snake)
        if v is not None and str(v).strip() != '':
            return v
        return default

    def _parse_bool(val, default=False):
        if val is None:
            return default
        if isinstance(val, bool):
            return val
        s = str(val).strip().lower()
        return s in ('true', '1', 'yes', 't')

    def _parse_float(val, default=0.0):
        if val is None:
            return default
        try:
            return float(str(val).strip().replace(',', '.'))
        except Exception:
            return default

    def _parse_int(val, default=0):
        if val is None:
            return default
        try:
            return int(float(str(val).strip().replace(',', '.')))
        except Exception:
            return default

    def _parse_str(val, default=''):
        if val is None:
            return default
        return str(val).strip()

    param_definitions = [
        ('position_size_usdt', 'positionSizeUSDT', _parse_float, 50.0),
        ('take_profit_usdt', 'takeProfitUSDT', _parse_float, 30.0),
        ('stop_loss_usdt', 'stopLossUSDT', _parse_float, 20.0),
        ('leverage', 'leverage', _parse_int, 20),
        ('rsi_type', 'rsiType', lambda v, d: _parse_str(v, d).upper() or d, 'WILDER'),
        ('rsi_interval', 'rsiInterval', _parse_str, '5m'),
        ('rsi_period', 'rsiPeriod', _parse_int, 14),
        ('rsi_threshold_up', 'rsiThresholdUp', _parse_float, 8.0),
        ('rsi_threshold_down', 'rsiThresholdDown', _parse_float, -8.0),
        ('rsi_entry_level_low', 'rsiEntryLevelLow', _parse_float, 25.0),
        ('rsi_entry_level_high', 'rsiEntryLevelHigh', _parse_float, 75.0),
        ('rsi_target', 'rsiTarget', _parse_float, 50.0),
        ('rsi_candles_window', 'rsiCandlesWindow', _parse_int, 3),
        ('rsi_positive_candles_required', 'rsiPositiveCandlesRequired', _parse_int, 2),
        ('rsi_positive_delta_min', 'rsiPositiveDeltaMin', _parse_float, 0.0),
        ('volume_sma_period', 'volumeSmaPeriod', _parse_int, 20),
        ('volume_factor', 'volumeFactor', _parse_float, 1.5),
        ('downtrend_check_candles', 'downtrendCheckCandles', _parse_int, 3),
        ('downtrend_candles_window', 'downtrendCandlesWindow', _parse_int, 5),
        ('downtrend_level_check', 'downtrendLevelCheck', _parse_int, 5),
        ('required_uptrend_candles', 'requiredUptrendCandles', _parse_int, 0),
        ('cycle_sleep_seconds', 'cycleSleepSeconds', _parse_int, 5),
        ('order_timeout_seconds', 'orderTimeoutSeconds', _parse_int, 10),
        ('entry_order_type', 'entryOrderType', lambda v, d: _parse_str(v, d).upper() if _parse_str(v, d).upper() in ('LIMIT', 'MARKET') else 'MARKET', 'MARKET'),
        ('evaluate_rsi_delta', 'evaluateRsiDelta', _parse_bool, True),
        ('evaluate_volume_filter', 'evaluateVolumeFilter', _parse_bool, True),
        ('evaluate_rsi_range', 'evaluateRsiRange', _parse_bool, True),
        ('evaluate_downtrend_candles_block', 'evaluateDowntrendCandlesBlock', _parse_bool, True),
        ('evaluate_downtrend_levels_block', 'evaluateDowntrendLevelsBlock', _parse_bool, True),
        ('evaluate_required_uptrend', 'evaluateRequiredUptrend', _parse_bool, True),
        ('enable_take_profit_pnl', 'enableTakeProfitPnl', _parse_bool, True),
        ('enable_stop_loss_pnl', 'enableStopLossPnl', _parse_bool, True),
        ('stop_loss_order_type', 'stopLossOrderType', lambda v, d: _parse_str(v, d).upper() or d, 'STOP_MARKET'),
        ('stop_loss_trigger_type', 'stopLossTriggerType', lambda v, d: _parse_str(v, d).upper() or d, 'MARK_PRICE'),
        ('stop_loss_execution_mode', 'stopLossExecutionMode', lambda v, d: _parse_str(v, d).upper() or d, 'TOTAL_100'),
        ('enable_emergency_software_sl', 'enableEmergencySoftwareSl', _parse_bool, True),
        ('enable_trailing_rsi_stop', 'enableTrailingRsiStop', _parse_bool, True),
        ('enable_price_trailing_stop', 'enablePriceTrailingStop', _parse_bool, True),
        ('price_trailing_stop_distance_usdt', 'priceTrailingStopDistanceUSDT', _parse_float, 0.05),
        ('price_trailing_stop_activation_pnl_usdt', 'priceTrailingStopActivationPnlUSDT', _parse_float, 0.02),
        ('enable_pnl_trailing_stop', 'enablePnlTrailingStop', _parse_bool, True),
        ('pnl_trailing_stop_activation_usdt', 'pnlTrailingStopActivationUSDT', _parse_float, 0.1),
        ('pnl_trailing_stop_drop_usdt', 'pnlTrailingStopDropUSDT', _parse_float, 0.05),
        ('evaluate_open_interest_increase', 'evaluateOpenInterestIncrease', _parse_bool, True),
        ('open_interest_period', 'openInterestPeriod', _parse_str, '5m'),
        ('evaluate_ma_filter', 'evaluateMaFilter', _parse_bool, False),
        ('ma_period', 'maPeriod', _parse_int, 200),
        ('ma_type', 'maType', lambda v, d: _parse_str(v, d).upper() or d, 'EMA'),
        ('evaluate_support_strategy', 'evaluateSupportStrategy', _parse_bool, False),
        ('support_history_candles', 'supportHistoryCandles', _parse_int, 200),
        ('support_pivot_window', 'supportPivotWindow', _parse_int, 5),
        ('support_confirmations', 'supportConfirmations', _parse_int, 2),
        ('support_level_tolerance_percent', 'supportLevelTolerancePercent', _parse_float, 0.5),
        ('support_order_stop_loss_percent', 'supportOrderStopLossPercent', _parse_float, 2.0),
        ('support_order_take_profit_percent', 'supportOrderTakeProfitPercent', _parse_float, 4.0),
        ('enable_dca_reentry', 'enableDcaReentry', _parse_bool, False),
        ('dca_reentry_mode', 'dcaReentryMode', _parse_str, 'fixed_percent'),
        ('dca_price_drop_percent', 'dcaPriceDropPercent', _parse_float, 1.5),
        ('dca_trigger_loss_usdt', 'dcaTriggerLossUsdt', _parse_float, 15.0),
        ('dca_max_reentries', 'dcaMaxReentries', _parse_int, 2),
        ('dca_volume_multiplier', 'dcaVolumeMultiplier', _parse_float, 1.0),
        ('risk_percentage', 'riskPercentage', _parse_float, 50.0),
        ('enable_max_loss_per_symbol', 'enableMaxLossPerSymbol', _parse_bool, True),
        ('max_loss_per_symbol_usdt', 'maxLossPerSymbolUSDT', _parse_float, 20.0),
        ('enable_consecutive_losses_cooldown', 'enableConsecutiveLossesCooldown', _parse_bool, True),
        ('max_consecutive_losses', 'maxConsecutiveLosses', _parse_int, 2),
        ('consecutive_losses_cooldown_minutes', 'consecutiveLossesCooldownMinutes', _parse_int, 60),
        ('enable_rolling_performance_filter', 'enableRollingPerformanceFilter', _parse_bool, True),
        ('rolling_trades_window', 'rollingTradesWindow', _parse_int, 5),
        ('rolling_max_losses', 'rollingMaxLosses', _parse_int, 4),
        ('rolling_filter_cooldown_minutes', 'rollingFilterCooldownMinutes', _parse_int, 120),
        ('enable_btc_crash_shield', 'enableBtcCrashShield', _parse_bool, True),
        ('btc_crash_timeframe', 'btcCrashTimeframe', _parse_str, '15m'),
        ('btc_crash_drop_percent', 'btcCrashDropPercent', _parse_float, 2.0),
        ('btc_crash_shield_cooldown_minutes', 'btcCrashShieldCooldownMinutes', _parse_int, 30),
        ('enable_market_regime_filter', 'enableMarketRegimeFilter', _parse_bool, False),
        ('market_regime_mode', 'marketRegimeMode', _parse_str, 'symbol'),
        ('market_regime_indicator', 'marketRegimeIndicator', _parse_str, 'supertrend'),
        ('market_regime_timeframe', 'marketRegimeTimeframe', _parse_str, '1h'),
        ('market_regime_ema_period', 'marketRegimeEmaPeriod', _parse_int, 50),
        ('market_regime_supertrend_period', 'marketRegimeSupertrendPeriod', _parse_int, 10),
        ('market_regime_supertrend_multiplier', 'marketRegimeSupertrendMultiplier', _parse_float, 3.0),
        ('enable_emergency_crash_exit', 'enableEmergencyCrashExit', _parse_bool, False),
        ('enable_crash_rsi_drop', 'enableCrashRsiDrop', _parse_bool, True),
        ('crash_rsi_drop_threshold', 'crashRsiDropThreshold', _parse_float, 8.0),
        ('enable_crash_price_drop', 'enableCrashPriceDrop', _parse_bool, True),
        ('crash_price_drop_percent', 'crashPriceDropPercent', _parse_float, 1.5),
        ('enable_crash_pnl_drop', 'enableCrashPnlDrop', _parse_bool, True),
        ('crash_pnl_drop_threshold_usdt', 'crashPnlDropThresholdUSDT', _parse_float, 5.0),
        ('trade_direction', 'tradeDirection', lambda v, d: _parse_str(v, d).upper() or d, 'BIDIRECTIONAL'),
        ('auto_mirror_short', 'autoMirrorShort', _parse_bool, True),
        ('rsi_short_entry_level_low', 'rsiShortEntryLevelLow', _parse_float, 55.0),
        ('rsi_short_entry_level_high', 'rsiShortEntryLevelHigh', _parse_float, 70.0),
        ('enable_hedge_protection', 'enableHedgeProtection', _parse_bool, False),
        ('hedge_trigger_type', 'hedgeTriggerType', lambda v, d: _parse_str(v, d).upper() or d, 'PERCENT'),
        ('hedge_trigger_value', 'hedgeTriggerValue', _parse_float, 1.5),
        ('hedge_size_multiplier', 'hedgeSizeMultiplier', _parse_float, 1.0),
        ('enable_hedge_trailing_stop', 'enableHedgeTrailingStop', _parse_bool, True),
        ('hedge_trailing_activation_usdt', 'hedgeTrailingActivationUSDT', _parse_float, 0.20),
        ('hedge_trailing_drop_usdt', 'hedgeTrailingDropUSDT', _parse_float, 0.30),
        ('enable_hedge_basket_exit', 'enableHedgeBasketExit', _parse_bool, True),
        ('hedge_basket_target_usdt', 'hedgeBasketTargetUSDT', _parse_float, 0.50),
        ('hedge_reentry_cooldown_seconds', 'hedgeReentryCooldownSeconds', _parse_int, 60),
        ('enable_hedge_recovery_protection', 'enableHedgeRecoveryProtection', _parse_bool, True),
        ('hedge_max_bounce_percent', 'hedgeMaxBouncePercent', _parse_float, 0.35),
        ('hedge_recovery_candles_window', 'hedgeRecoveryCandlesWindow', _parse_int, 4),
        ('hedge_recovery_candles_threshold', 'hedgeRecoveryCandlesThreshold', _parse_int, 3),
        ('enable_hedge_breakout_requirement', 'enableHedgeBreakoutRequirement', _parse_bool, True),
        ('symbols_to_trade', 'symbolsToTrade', _parse_str, ''),
        ('active_strategy_name', 'activeStrategyName', _parse_str, ''),
    ]

    for snake, camel, parser, default_val in param_definitions:
        raw_val = _get_val(camel, snake, default_val)
        parsed = parser(raw_val, default_val)
        normalized[snake] = parsed
        normalized[camel] = parsed

    # Preservar metadatos del catálogo
    for meta_key in ('is_public', 'isPublic', 'risk_level', 'riskLevel', 'min_capital_usdt', 'minCapitalUsdt', 'description', 'display_name', 'displayName'):
        if meta_key in data:
            normalized[meta_key] = data[meta_key]

    return normalized

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