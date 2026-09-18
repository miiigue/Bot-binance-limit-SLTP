# Este módulo interactuará con la base de datos SQLite.

import sqlite3
import json
from datetime import datetime # Asegurar importación directa de datetime
import os
from decimal import Decimal # Mantener para posible conversión
import pandas as pd
from typing import Union # <-- NUEVA IMPORTACIÓN

# Importamos la configuración y el logger (Logger sí, Config no es necesaria aquí)
# from .config_loader import load_config # Ya no necesitamos leer config de DB
from .logger_setup import get_logger

# Definir el nombre del archivo de la base de datos
# Lo ubicaremos en el directorio raíz del proyecto (un nivel arriba de 'src')
BASE_DIR = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
DATABASE_FILE = os.path.join(BASE_DIR, 'trades_limit.db')

def get_db_connection():
    """Establece una conexión con la base de datos SQLite."""
    logger = get_logger()
    conn = None
    try:
        # connect() creará el archivo si no existe
        conn = sqlite3.connect(DATABASE_FILE)
        # logger.debug(f"Conexión a SQLite DB '{DATABASE_FILE}' establecida.")
        return conn
    except sqlite3.Error as e:
        logger.critical(f"Error CRÍTICO al conectar/crear SQLite DB '{DATABASE_FILE}': {e}")
        return None
    except Exception as e:
        logger.critical(f"Error inesperado al conectar con SQLite: {e}")
        return None

def init_db_schema():
    """Inicializa el esquema de la base de datos si no existe."""
    logger = get_logger()
    conn = None
    try:
        conn = sqlite3.connect(DATABASE_FILE, timeout=10) # Timeout de 10 segundos
        cursor = conn.cursor()
        # La sentencia CREATE TABLE IF NOT EXISTS creará la tabla con todas las columnas
        # si no existe. Si ya existe, no la modificará.
        cursor.execute("""
        CREATE TABLE IF NOT EXISTS trades (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            symbol TEXT NOT NULL,
            trade_type TEXT NOT NULL, -- 'LONG' o 'SHORT'
            open_timestamp DATETIME NOT NULL,
            close_timestamp DATETIME,
            open_price REAL NOT NULL,
            close_price REAL,
            quantity REAL NOT NULL,
            position_size_usdt REAL, 
            pnl_usdt REAL,
            gross_pnl_usdt REAL DEFAULT 0.0,
            commission_usdt REAL DEFAULT 0.0,
            close_reason TEXT,
            parameters TEXT, -- JSON string para guardar los parámetros de trading usados
            binance_trade_id INTEGER UNIQUE -- Esta columna se creará con la restricción UNIQUE si la tabla se crea nueva.
        )
        """)
        conn.commit() # Commit después de CREATE TABLE

        # Intentar añadir columnas si la tabla ya existía (migración de esquema)
        try:
            cursor.execute("PRAGMA table_info(trades)")
            columns = [info[1] for info in cursor.fetchall()]
            if 'binance_trade_id' not in columns:
                cursor.execute("ALTER TABLE trades ADD COLUMN binance_trade_id INTEGER")
                conn.commit()
                logger.info("Columna 'binance_trade_id' añadida a la tabla 'trades'.")
            if 'strategy_name' not in columns:
                cursor.execute("ALTER TABLE trades ADD COLUMN strategy_name TEXT")
                conn.commit()
                logger.info("Columna 'strategy_name' añadida a la tabla 'trades'.")
            if 'commission_usdt' not in columns:
                cursor.execute("ALTER TABLE trades ADD COLUMN commission_usdt REAL DEFAULT 0.0")
                conn.commit()
                logger.info("Columna 'commission_usdt' añadida a la tabla 'trades'.")
            if 'gross_pnl_usdt' not in columns:
                cursor.execute("ALTER TABLE trades ADD COLUMN gross_pnl_usdt REAL DEFAULT 0.0")
                conn.commit()
                logger.info("Columna 'gross_pnl_usdt' añadida a la tabla 'trades'.")
        except sqlite3.Error as e_alter:
            logger.warning(f"Advertencia durante chequeo de columnas en trades: {e_alter}")

        # Intentar crear el índice para binance_trade_id
        cursor.execute("CREATE INDEX IF NOT EXISTS idx_binance_trade_id ON trades (binance_trade_id)")
        conn.commit()

        # Tabla para configuraciones persistentes (ej. corte de sincronización al resetear historial)
        cursor.execute("""
        CREATE TABLE IF NOT EXISTS bot_settings (
            key TEXT PRIMARY KEY,
            value TEXT
        )
        """)
        conn.commit()

        # Migración automática de comisiones para operaciones históricas existentes
        try:
            cursor.execute("SELECT value FROM bot_settings WHERE key = 'trades_commission_migrated_v2'")
            migrated_row = cursor.fetchone()
            if not migrated_row:
                cursor.execute("SELECT id, symbol, open_price, close_price, quantity, position_size_usdt, pnl_usdt, parameters FROM trades WHERE commission_usdt IS NULL OR commission_usdt = 0.0")
                unmigrated = cursor.fetchall()
                if unmigrated:
                    logger.info(f"Aplicando migración de comisiones Binance a {len(unmigrated)} trades existentes...")
                    for r_tr in unmigrated:
                        t_id, sym, op, cp, qty, pos_size, old_pnl, p_str = r_tr
                        old_pnl = float(old_pnl or 0.0)
                        op = float(op or 0.0)
                        cp = float(cp or 0.0)
                        qty = float(qty or 0.0)
                        pos_size = float(pos_size or 0.0)

                        entry_notional = (op * qty) if (op > 0 and qty > 0) else pos_size
                        if entry_notional <= 0:
                            entry_notional = 1500.0 # Nocional estimado $125 * 12x
                        exit_notional = (cp * qty) if (cp > 0 and qty > 0) else entry_notional

                        entry_rate = 0.0002
                        if p_str:
                            try:
                                p_dict = json.loads(p_str)
                                if str(p_dict.get('entry_order_type', '')).upper() == 'MARKET':
                                    entry_rate = 0.0005
                            except Exception:
                                pass
                        exit_rate = 0.0005

                        comm = round((entry_notional * entry_rate) + (exit_notional * exit_rate), 4)
                        gross = old_pnl
                        net = round(gross - comm, 4)

                        cursor.execute("UPDATE trades SET gross_pnl_usdt = ?, commission_usdt = ?, pnl_usdt = ? WHERE id = ?", (gross, comm, net, t_id))
                    conn.commit()
                    logger.info("Migración de comisiones de Binance finalizada con éxito.")
                cursor.execute("INSERT INTO bot_settings (key, value) VALUES ('trades_commission_migrated_v2', '1') ON CONFLICT(key) DO UPDATE SET value = '1'")
                conn.commit()
        except Exception as e_mig:
            logger.warning(f"Aviso durante migración de comisiones históricas: {e_mig}")

        # Limpiar trades dummy con PnL = 0 originados por sincronizaciones erróneas de órdenes de entrada
        try:
            cursor.execute("DELETE FROM trades WHERE close_reason = 'Binance Testnet Sync' AND abs(ifnull(pnl_usdt, 0)) < 1e-6")
            conn.commit()
            logger.info("Purga automática de trades dummy con PnL 0 completada en DB.")
        except Exception as e_clean:
            logger.debug(f"Aviso en limpieza automática de trades dummy: {e_clean}")

        logger.info("Esquema de la base de datos inicializado/verificado.")
        return True
    except sqlite3.Error as e:
        logger.error(f"Error al inicializar/verificar el esquema de la DB: {e}", exc_info=True)
        return False
    finally:
        if conn:
            conn.close()

def record_trade(symbol: str, trade_type: str, open_timestamp: datetime, 
                 open_price: float, quantity: float, position_size_usdt: float,
                 close_timestamp: Union[datetime, None] = None,  # <-- CAMBIO AQUÍ
                 close_price: Union[float, None] = None, # Unificar estilo para None
                 pnl_usdt: Union[float, None] = None,    # Unificar estilo para None
                 close_reason: Union[str, None] = None, # Unificar estilo para None
                 parameters: Union[dict, None] = None,   # Unificar estilo para None
                 binance_trade_id: Union[int, None] = None, # <-- CAMBIO AQUÍ y Unificar
                 strategy_name: Union[str, None] = None,
                 commission_usdt: Union[float, None] = None,
                 gross_pnl_usdt: Union[float, None] = None):
    """
    Registra un trade completado o una posición abierta en la base de datos, incluyendo comisiones oficiales Binance y PnL neto.
    """
    logger = get_logger()
    # Si no se pasó explícito, intentar inferir de parameters o de la configuración del símbolo
    if not strategy_name and parameters:
        strategy_name = parameters.get('strategy_name') or parameters.get('active_strategy_name') or parameters.get('activeStrategyName')
    if not strategy_name:
        try:
            from src.config_loader import get_strategy_for_symbol
            strategy_name = get_strategy_for_symbol(symbol, fallback_strategy='')
        except Exception:
            strategy_name = ''

    # Deducción y cálculo automático de comisiones Binance
    open_price_f = float(open_price or 0.0)
    close_price_f = float(close_price or open_price or 0.0)
    qty_f = float(quantity or 0.0)
    pos_size_f = float(position_size_usdt or 0.0)

    if commission_usdt is None:
        entry_rate = 0.0002
        if parameters and str(parameters.get('entry_order_type', '')).upper() == 'MARKET':
            entry_rate = 0.0005
        exit_rate = 0.0005

        entry_notional = (open_price_f * qty_f) if (open_price_f > 0 and qty_f > 0) else pos_size_f
        if entry_notional <= 0:
            entry_notional = 1500.0
        exit_notional = (close_price_f * qty_f) if (close_price_f > 0 and qty_f > 0) else entry_notional
        commission_usdt = round((entry_notional * entry_rate) + (exit_notional * exit_rate), 4)
    else:
        commission_usdt = round(float(commission_usdt), 4)

    if gross_pnl_usdt is None:
        gross_pnl_usdt = round(float(pnl_usdt or 0.0), 4)
        pnl_usdt = round(gross_pnl_usdt - commission_usdt, 4)
    else:
        gross_pnl_usdt = round(float(gross_pnl_usdt), 4)
        if pnl_usdt is not None:
            pnl_usdt = round(float(pnl_usdt), 4)
        else:
            pnl_usdt = round(gross_pnl_usdt - commission_usdt, 4)

    # Convertir el diccionario de parámetros a JSON string si se proporciona
    parameters_json = json.dumps(parameters) if parameters else None

    # <<< DETAILED LOGGING OF PARAMETERS RECEIVED BY record_trade >>>
    logger.info(f"record_trade (database.py): symbol='{symbol}', type='{trade_type}', strategy='{strategy_name}', open_ts={open_timestamp}, close_ts={close_timestamp}, open_p={open_price}, close_p={close_price}, qty={quantity}, pos_size_usdt={position_size_usdt}, PNL_NETO={pnl_usdt}, PNL_BRUTO={gross_pnl_usdt}, COMISION={commission_usdt}, reason='{close_reason}', binance_id={binance_trade_id}")

    conn = None
    try:
        conn = sqlite3.connect(DATABASE_FILE, timeout=10)
        cursor = conn.cursor()
        cursor.execute("""
        INSERT INTO trades (symbol, trade_type, open_timestamp, close_timestamp, 
                          open_price, close_price, quantity, position_size_usdt, 
                          pnl_usdt, gross_pnl_usdt, commission_usdt, close_reason, parameters, binance_trade_id, strategy_name)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        """, (symbol, trade_type, open_timestamp, close_timestamp, 
              open_price, close_price, quantity, position_size_usdt, 
              pnl_usdt, gross_pnl_usdt, commission_usdt, close_reason, parameters_json, binance_trade_id, strategy_name))
        conn.commit()
        trade_id = cursor.lastrowid
        logger.info(f"Trade registrado con éxito en SQLite DB (ID: {trade_id}, Símbolo: {symbol}, Estrategia: {strategy_name}, PnL Neto: {pnl_usdt}, Comisión: {commission_usdt}). Binance Trade ID: {binance_trade_id if binance_trade_id else 'N/A'}")
        return trade_id
    except sqlite3.IntegrityError as ie:
        # Esto podría ocurrir si intentamos insertar un binance_trade_id que ya existe (debido a la restricción UNIQUE)
        logger.error(f"Error de integridad al registrar trade para {symbol} (Binance ID: {binance_trade_id}): {ie}. Es posible que este trade ya exista.", exc_info=True)
        # <<< LOGGING DETAILS OF THE TRADE CAUSING INTEGRITY ERROR >>>
        logger.error(f"Failed trade details: symbol='{symbol}', type='{trade_type}', open_ts={open_timestamp}, close_ts={close_timestamp}, open_p={open_price}, close_p={close_price}, qty={quantity}, PNL_USDT={pnl_usdt}, reason='{close_reason}', binance_id={binance_trade_id}")
    except sqlite3.Error as e:
        logger.error(f"Error al registrar trade para {symbol} en la DB: {e}", exc_info=True)
    finally:
        if conn:
            conn.close()

# --- NUEVA FUNCIÓN PARA PNL ACUMULADO ---
def get_cumulative_pnl_by_symbol() -> dict: # Cambiado para devolver dict directamente
    """Calcula el PnL acumulado para cada símbolo desde la tabla 'trades'."""
    logger = get_logger()
    conn = None
    cumulative_pnl = {} # Diccionario para guardar {symbol: total_pnl}

    try:
        conn = get_db_connection()
        if conn is None:
            logger.error("No se pudo obtener conexión a SQLite DB para calcular PnL acumulado.")
            return cumulative_pnl # Devuelve vacío si no hay conexión

        # Usar 'with conn:' para manejo automático de la transacción y cierre
        with conn:
            cursor = conn.cursor()
            # Consulta para sumar pnl_usdt agrupado por symbol.
            # Nos aseguramos de que pnl_usdt no sea NULL para la suma.
            sql = "SELECT symbol, SUM(IFNULL(pnl_usdt, 0)) FROM trades GROUP BY symbol"
            cursor.execute(sql)
            rows = cursor.fetchall()

            for row in rows:
                symbol, total_pnl = row
                if symbol and total_pnl is not None:
                    cumulative_pnl[symbol] = float(total_pnl) # Convertir a float
            
            logger.debug(f"PnL acumulado por símbolo obtenido: {cumulative_pnl}")
            
    except sqlite3.Error as e:
        logger.error(f"Error SQLite al calcular PnL acumulado: {e}", exc_info=True)
    except Exception as e:
        logger.error(f"Error inesperado al calcular PnL acumulado: {e}", exc_info=True)
    finally:
        # 'with conn:' debería cerrar la conexión, pero por si acaso.
        if conn:
            conn.close()
            logger.debug("Conexión SQLite cerrada después de calcular PnL acumulado.")
            
    return cumulative_pnl
# ----------------------------------------

def get_total_database_metrics() -> dict:
    """Calcula las métricas financieras globales consolidadas directamente desde SQLite."""
    conn = None
    default_res = {
        "total_pnl": 0.0,
        "total_commission_usdt": 0.0,
        "total_gross_pnl": 0.0,
        "total_trades": 0,
        "winning_trades": 0,
        "losing_trades": 0,
        "gross_profit": 0.0,
        "gross_loss": 0.0,
        "profit_factor": "1.00",
        "win_rate": 0.0,
        "winning_strategies_pnl": 0.0,
        "losing_strategies_pnl": 0.0,
        "strategies_breakdown": []
    }
    try:
        conn = sqlite3.connect(DATABASE_FILE, timeout=10)
        conn.row_factory = sqlite3.Row
        cur = conn.cursor()
        
        # 1. Agregado general
        cur.execute("""
            SELECT 
                COUNT(*) as total_trades,
                SUM(IFNULL(pnl_usdt, 0)) as total_pnl,
                SUM(IFNULL(commission_usdt, 0)) as total_commission_usdt,
                SUM(IFNULL(gross_pnl_usdt, IFNULL(pnl_usdt, 0))) as total_gross_pnl,
                SUM(CASE WHEN pnl_usdt > 0.00001 THEN 1 ELSE 0 END) as wins,
                SUM(CASE WHEN pnl_usdt < -0.00001 THEN 1 ELSE 0 END) as losses,
                SUM(CASE WHEN pnl_usdt > 0.00001 THEN pnl_usdt ELSE 0 END) as gross_profit,
                SUM(CASE WHEN pnl_usdt < -0.00001 THEN ABS(pnl_usdt) ELSE 0 END) as gross_loss
            FROM trades
        """)
        row = cur.fetchone()
        if row and row['total_trades'] > 0:
            tot = int(row['total_trades'] or 0)
            wins = int(row['wins'] or 0)
            losses = int(row['losses'] or 0)
            pnl = float(row['total_pnl'] or 0.0)
            comm = float(row['total_commission_usdt'] or 0.0)
            gross = float(row['total_gross_pnl'] or 0.0)
            gp = float(row['gross_profit'] or 0.0)
            gl = float(row['gross_loss'] or 0.0)
            pf = f"{(gp / gl):.2f}" if gl > 0 else ("∞" if gp > 0 else "1.00")
            wr = round((wins / tot) * 100, 1) if tot > 0 else 0.0
            
            default_res.update({
                "total_pnl": pnl,
                "total_commission_usdt": comm,
                "total_gross_pnl": gross,
                "total_trades": tot,
                "winning_trades": wins,
                "losing_trades": losses,
                "gross_profit": gp,
                "gross_loss": gl,
                "profit_factor": pf,
                "win_rate": wr
            })
            
        # 2. Desglose por estrategia para el resumen del torneo
        cur.execute("""
            SELECT 
                IFNULL(strategy_name, 'Global') as strat,
                COUNT(*) as count,
                SUM(IFNULL(pnl_usdt, 0)) as strat_pnl,
                SUM(CASE WHEN pnl_usdt > 0.00001 THEN 1 ELSE 0 END) as wins,
                SUM(CASE WHEN pnl_usdt < -0.00001 THEN 1 ELSE 0 END) as losses
            FROM trades
            GROUP BY strat
            ORDER BY strat_pnl DESC
        """)
        strat_rows = cur.fetchall()
        pos_strat_pnl = 0.0
        neg_strat_pnl = 0.0
        breakdown = []
        for sr in strat_rows:
            s_name = sr['strat'] or 'Global'
            s_pnl = float(sr['strat_pnl'] or 0.0)
            s_cnt = int(sr['count'] or 0)
            s_wins = int(sr['wins'] or 0)
            s_losses = int(sr['losses'] or 0)
            if s_pnl > 0:
                pos_strat_pnl += s_pnl
            else:
                neg_strat_pnl += s_pnl
            breakdown.append({
                "strategy": s_name,
                "pnl": s_pnl,
                "trades": s_cnt,
                "wins": s_wins,
                "losses": s_losses,
                "win_rate": round((s_wins / s_cnt) * 100, 1) if s_cnt > 0 else 0.0
            })
        default_res["winning_strategies_pnl"] = pos_strat_pnl
        default_res["losing_strategies_pnl"] = neg_strat_pnl
        default_res["strategies_breakdown"] = breakdown
        
        return default_res
    except Exception as e:
        get_logger().error(f"Error al calcular métricas globales de base de datos: {e}")
        return default_res
    finally:
        if conn:
            conn.close()
# ----------------------------------------

# --- NUEVA FUNCIÓN ---
def get_last_n_trades_for_symbol(symbol: str, n: int = 10) -> list[dict]:
    """
    Recupera los últimos N trades cerrados para un símbolo específico desde la base de datos.
    """
    logger = get_logger()
    conn = None
    trades = []
    try:
        conn = sqlite3.connect(DATABASE_FILE)
        # Asegurar que devolvemos las columnas como diccionarios
        conn.row_factory = sqlite3.Row 
        cursor = conn.cursor()

        # Consulta SQL para obtener los últimos N trades ordenados por fecha de cierre
        query = """
        SELECT id, symbol, trade_type, open_timestamp, close_timestamp,
               open_price, close_price, quantity, position_size_usdt,
               pnl_usdt, gross_pnl_usdt, commission_usdt, close_reason, parameters, strategy_name
        FROM trades
        WHERE symbol = ?
        ORDER BY close_timestamp DESC
        LIMIT ?
        """
        cursor.execute(query, (symbol.upper(), n))
        rows = cursor.fetchall()
        trades = [dict(row) for row in rows]
    except sqlite3.Error as e:
        logger.error(f"Error al acceder a la base de datos para obtener trades de {symbol}: {e}", exc_info=True)
    finally:
        if conn:
            conn.close()
            
    return trades
# --- FIN NUEVA FUNCIÓN ---

def get_all_recent_trades(limit: int = 2000) -> list[dict]:
    """
    Recupera los últimos N trades cerrados en orden cronológico ascendente (del más antiguo al más reciente)
    para alimentar gráficos de rendimiento y curvas de capital (Equity Curve).
    """
    logger = get_logger()
    conn = None
    trades = []
    try:
        conn = sqlite3.connect(DATABASE_FILE)
        conn.row_factory = sqlite3.Row
        cursor = conn.cursor()

        query = """
        SELECT id, symbol, trade_type, open_timestamp, close_timestamp,
               open_price, close_price, quantity, position_size_usdt,
               pnl_usdt, gross_pnl_usdt, commission_usdt, close_reason, parameters, strategy_name
        FROM (
            SELECT * FROM trades
            ORDER BY id DESC
            LIMIT ?
        )
        ORDER BY id ASC
        """
        cursor.execute(query, (limit,))
        rows = cursor.fetchall()
        trades = [dict(row) for row in rows]
    except sqlite3.Error as e:
        logger.error(f"Error al obtener todos los trades recientes en DB: {e}", exc_info=True)
    finally:
        if conn:
            conn.close()
    return trades

def get_bot_setting(key: str, default: str | None = None) -> str | None:
    """Obtiene una configuración persistente de la base de datos. Reintenta en caso de bloqueo SQLite."""
    logger = get_logger()
    conn = None
    for attempt in range(3):
        try:
            conn = sqlite3.connect(DATABASE_FILE, timeout=10)
            cursor = conn.cursor()
            cursor.execute("SELECT value FROM bot_settings WHERE key = ?", (key,))
            row = cursor.fetchone()
            return row[0] if row else default
        except sqlite3.OperationalError as e:
            logger.warning(f"get_bot_setting('{key}') intento {attempt+1}/3 falló (SQLite bloqueado): {e}")
            import time as _time
            _time.sleep(0.15 * (attempt + 1))
        except Exception as e:
            logger.error(f"get_bot_setting('{key}') error inesperado: {e}")
            return default
        finally:
            if conn:
                conn.close()
                conn = None
    logger.error(f"get_bot_setting('{key}') falló tras 3 reintentos. Retornando default: {default}")
    return default

def set_bot_setting(key: str, value: str) -> bool:
    """Guarda o actualiza una configuración persistente en la base de datos."""
    conn = None
    try:
        conn = sqlite3.connect(DATABASE_FILE, timeout=10)
        cursor = conn.cursor()
        cursor.execute("""
            CREATE TABLE IF NOT EXISTS bot_settings (
                key TEXT PRIMARY KEY,
                value TEXT
            )
        """)
        cursor.execute("INSERT INTO bot_settings (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value", (key, str(value)))
        conn.commit()
        return True
    except Exception as e:
        logger = get_logger()
        logger.error(f"Error guardando bot_setting {key}: {e}")
        return False
    finally:
        if conn:
            conn.close()

def sync_binance_trades_to_db(symbols: list[str] | None = None, limit_per_symbol: int = 50) -> int:
    """
    Sincroniza en tiempo real los trades completados desde Binance Testnet a la base de datos local SQLite.
    Garantiza que la sección de Rendimiento refleje fielmente cada operación ejecutada en Binance.
    Respeta el punto de corte establecido tras un reinicio de historial (Reset PnL).
    """
    from src.binance_client import get_user_trade_history
    from src.config_loader import get_trading_symbols
    logger = get_logger()

    if not symbols:
        symbols = get_trading_symbols() or []

    cutoff_ms_str = get_bot_setting('trades_sync_cutoff_time_ms')
    cutoff_ms = int(cutoff_ms_str) if (cutoff_ms_str and cutoff_ms_str.isdigit()) else 0

    synced_count = 0
    for sym in symbols:
        try:
            trades = get_user_trade_history(
                symbol=sym,
                start_time_ms=cutoff_ms if cutoff_ms > 0 else None,
                limit=limit_per_symbol
            )
            if not trades:
                continue

            for t in trades:
                trade_id = t.get('id')
                if not trade_id:
                    continue
                time_ms = int(t.get('time', 0))
                if cutoff_ms > 0 and time_ms <= cutoff_ms:
                    continue
                if check_if_binance_trade_exists(int(trade_id)):
                    continue

                realized_pnl = float(t.get('realizedPnl', '0'))
                # ¡CRÍTICO! Solo registrar si realmente hubo PnL realizado (es decir, una operación de salida/cierre)
                # Las órdenes de entrada (BUY) siempre tienen realizedPnl = 0 y no son trades cerrados.
                if abs(realized_pnl) < 1e-6:
                    continue

                qty = float(t.get('qty', '0'))
                price = float(t.get('price', '0'))
                side = str(t.get('side', 'BUY')).upper()
                trade_time = datetime.fromtimestamp(time_ms / 1000) if time_ms > 0 else datetime.now()

                # Para un trade de salida SELL (cierre de LONG), el precio de entrada se calcula:
                entry_price_est = price - (realized_pnl / qty) if (qty > 0 and side == 'SELL') else (price + (realized_pnl / qty) if qty > 0 else price)
                if entry_price_est <= 0:
                    entry_price_est = price

                strat_for_sym = 'Global'
                try:
                    from src.config_loader import get_strategy_for_symbol
                    strat_for_sym = get_strategy_for_symbol(sym, fallback_strategy='Global') or 'Global'
                except Exception:
                    strat_for_sym = 'Global'

                # Calcular comisión Binance (ida maker 0.02% + vuelta taker 0.05% o comisión directa si está presente)
                raw_comm = abs(float(t.get('commission', '0')))
                if raw_comm > 0:
                    entry_comm_est = entry_price_est * qty * 0.0002
                    total_comm = round(raw_comm + entry_comm_est, 4)
                else:
                    total_comm = round((entry_price_est * qty * 0.0002) + (price * qty * 0.0005), 4)

                gross_pnl = realized_pnl
                net_pnl = round(gross_pnl - total_comm, 4)

                record_trade(
                    symbol=sym,
                    trade_type="LONG" if side == 'SELL' else "SHORT",
                    open_timestamp=trade_time,
                    open_price=entry_price_est,
                    quantity=qty,
                    position_size_usdt=entry_price_est * qty,
                    close_timestamp=trade_time,
                    close_price=price,
                    pnl_usdt=net_pnl,
                    gross_pnl_usdt=gross_pnl,
                    commission_usdt=total_comm,
                    close_reason="Binance Testnet Sync",
                    binance_trade_id=int(trade_id),
                    strategy_name=strat_for_sym
                )
                synced_count += 1
        except Exception as e_sym:
            logger.warning(f"Error sincronizando trades de Binance para {sym}: {e_sym}")

    if synced_count > 0:
        logger.info(f"Sincronización en vivo con Binance: {synced_count} nuevos trades guardados en DB.")
    return synced_count

# --- NUEVAS FUNCIONES ---
def check_if_binance_trade_exists(binance_trade_id: Union[int, None]) -> bool: # <-- CAMBIO AQUÍ
    """Verifica si un trade con el binance_trade_id especificado ya existe en la base de datos."""
    logger = get_logger()
    conn = None
    if binance_trade_id is None: # No podemos buscar un ID nulo de esta forma
        return False
    try:
        conn = sqlite3.connect(DATABASE_FILE, timeout=10)
        cursor = conn.cursor()
        cursor.execute("SELECT 1 FROM trades WHERE binance_trade_id = ?", (binance_trade_id,))
        exists = cursor.fetchone() is not None
        logger.debug(f"Chequeo existencia Binance Trade ID {binance_trade_id}: {'Existe' if exists else 'No existe'}")
        return exists
    except sqlite3.Error as e:
        logger.error(f"Error al chequear existencia de Binance Trade ID {binance_trade_id}: {e}", exc_info=True)
        return False # Asumir que no existe en caso de error para evitar problemas mayores
    finally:
        if conn:
            conn.close()

def get_trade_by_binance_id(binance_trade_id: Union[int, None]) -> Union[dict, None]: # <-- CAMBIOS AQUÍ
    """Obtiene los detalles de un trade de la base de datos usando su binance_trade_id."""
    logger = get_logger()
    conn = None
    if binance_trade_id is None:
        return None
    try:
        conn = sqlite3.connect(DATABASE_FILE, timeout=10)
        conn.row_factory = sqlite3.Row # Para acceder a columnas por nombre
        cursor = conn.cursor()
        cursor.execute("SELECT * FROM trades WHERE binance_trade_id = ?", (binance_trade_id,))
        row = cursor.fetchone()
        if row:
            logger.debug(f"Trade encontrado en DB por Binance ID {binance_trade_id}: {dict(row)}")
            return dict(row)
        else:
            logger.debug(f"Ningún trade encontrado en DB con Binance ID {binance_trade_id}")
            return None
    except sqlite3.Error as e:
        logger.error(f"Error al obtener trade por Binance ID {binance_trade_id}: {e}", exc_info=True)
        return None

def clear_trade_history() -> bool:
    """Elimina todos los trades de la base de datos y guarda timestamp de corte para no re-descargar historial antiguo de Binance."""
    logger = get_logger()
    conn = None
    try:
        conn = sqlite3.connect(DATABASE_FILE, timeout=10)
        cursor = conn.cursor()
        cursor.execute("DELETE FROM trades")
        try:
            cursor.execute("DELETE FROM sqlite_sequence WHERE name='trades'")
        except sqlite3.Error:
            pass
        try:
            from src.binance_client import get_server_time
            server_time_ms = get_server_time()
            if server_time_ms and server_time_ms > 0:
                now_ms = server_time_ms + 2000  # Buffer de 2 segundos para trades in-flight
            else:
                from datetime import timezone as dt_timezone
                now_ms = int(datetime.now(dt_timezone.utc).timestamp() * 1000) + 2000
        except Exception:
            from datetime import timezone as dt_timezone
            try:
                now_ms = int(datetime.now(dt_timezone.utc).timestamp() * 1000) + 2000
            except Exception:
                now_ms = int(datetime.now().timestamp() * 1000) + 2000
        cursor.execute("""
            CREATE TABLE IF NOT EXISTS bot_settings (
                key TEXT PRIMARY KEY,
                value TEXT
            )
        """)
        cursor.execute("INSERT INTO bot_settings (key, value) VALUES ('trades_sync_cutoff_time_ms', ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value", (str(now_ms),))
        conn.commit()
        logger.info(f"Historial de trades eliminado exitosamente de la base de datos. Nuevo corte de sincronización: {now_ms}")
        return True
    except sqlite3.Error as e:
        logger.error(f"Error al limpiar historial de trades en DB: {e}", exc_info=True)
        return False
    finally:
        if conn:
            conn.close()

# --- FIN NUEVAS FUNCIONES ---

# Ejemplo de uso (actualizado para SQLite)
if __name__ == '__main__':
    # Es importante llamar a setup_logging antes que a cualquier función que use get_logger
    from .logger_setup import setup_logging
    main_logger = setup_logging() # Configura el logger

    if main_logger:
        # 1. Crear/verificar la tabla (ya no necesitamos pool)
        schema_ok = init_db_schema()

        if schema_ok:
            # 2. Intentar registrar un trade de ejemplo
            # (Los tipos Decimal se convertirán a float dentro de record_trade)
            params_ejemplo = {
                'rsi_interval': '1m',
                'rsi_period': 7,
                'rsi_threshold_up': 2,
                'rsi_threshold_down': -10,
                'stop_loss_usdt': -0.01
            }
            # Usar datetime.now() y timedelta de forma consistente
            now_utc = datetime.now(datetime.timezone.utc)
            trade_id_ejemplo = record_trade(
                symbol='TESTUSDT',
                trade_type='LONG',
                open_timestamp=now_utc - datetime.timedelta(hours=1),
                close_timestamp=now_utc,
                open_price=100.50,
                close_price=101.25,
                quantity=10.0,
                position_size_usdt=1005.0,
                pnl_usdt=7.50,
                close_reason='take_profit_test',
                parameters=params_ejemplo
            )

            if trade_id_ejemplo:
                 main_logger.info(f"Trade de ejemplo registrado con ID: {trade_id_ejemplo}")

                 # 3. Leer los trades para verificar (ejemplo)
                 conn_read = get_db_connection()
                 if conn_read:
                     try:
                         with conn_read:
                             cur = conn_read.cursor()
                             cur.execute("SELECT * FROM trades WHERE symbol = ? ORDER BY id DESC LIMIT 5", ('TESTUSDT',))
                             rows = cur.fetchall()
                             main_logger.info(f"Últimos 5 trades de TESTUSDT encontrados: {len(rows)}")
                             for row in rows:
                                 main_logger.info(f"  - {row}")
                     except sqlite3.Error as e:
                         main_logger.error(f"Error al leer trades de ejemplo: {e}")
                     finally:
                        conn_read.close()

            else:
                 main_logger.error("Fallo al registrar el trade de ejemplo.")
        else:
            main_logger.error("Fallo al inicializar el esquema de la base de datos SQLite.")

    # Diagnóstico: imprimir los primeros 5 registros y el esquema de la tabla 'trades'
    import sqlite3
    print('--- Esquema de la tabla trades ---')
    conn = sqlite3.connect(DATABASE_FILE)
    cur = conn.cursor()
    cur.execute("SELECT sql FROM sqlite_master WHERE type='table' AND name='trades'")
    print(cur.fetchone()[0])
    print('\n--- Primeros 5 registros de trades ---')
    cur.execute("SELECT * FROM trades LIMIT 5")
    rows = cur.fetchall()
    for row in rows:
        print(row)
    conn.close()

# --- FIN DE MODIFICACIONES ---
# El código original de PostgreSQL ha sido completamente reemplazado. 