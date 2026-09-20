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

def get_db_connection(timeout=10):
    """Establece una conexión con la base de datos SQLite con timeout y modo WAL habilitado."""
    logger = get_logger()
    try:
        conn = sqlite3.connect(DATABASE_FILE, timeout=timeout)
        conn.row_factory = sqlite3.Row
        conn.execute("PRAGMA journal_mode=WAL;")
        conn.execute("PRAGMA foreign_keys=ON;")
        return conn
    except sqlite3.Error as e:
        logger.critical(f"Error CRÍTICO al conectar/crear SQLite DB '{DATABASE_FILE}': {e}")
        return None
    except Exception as e:
        logger.critical(f"Error inesperado al conectar con SQLite: {e}")
        return None

def purge_duplicate_trades() -> int:
    """
    Purga definitiva y robusta de operaciones duplicadas en SQLite.
    Identifica colisiones entre trades registrados por el bot y sincronizaciones de Binance Testnet Sync.
    Elimina los registros duplicados de Binance Testnet Sync conservando el trade original del bot con su motivo.
    """
    logger = get_logger()
    conn = None
    try:
        conn = sqlite3.connect(DATABASE_FILE, timeout=10)
        conn.row_factory = sqlite3.Row
        cursor = conn.cursor()

        cursor.execute("SELECT id, symbol, close_reason, close_timestamp, pnl_usdt, binance_trade_id FROM trades ORDER BY id ASC")
        rows = [dict(r) for r in cursor.fetchall()]
        if not rows:
            return 0

        # Separar trades del bot y trades de sincronización
        bot_trades = [r for r in rows if str(r.get('close_reason', '')).strip() != 'Binance Testnet Sync' and r.get('close_timestamp')]
        sync_trades = [r for r in rows if str(r.get('close_reason', '')).strip() == 'Binance Testnet Sync' and r.get('close_timestamp')]

        ids_to_delete = set()

        for bt in bot_trades:
            bt_sym = str(bt.get('symbol', '')).upper().strip()
            try:
                bt_dt = pd.to_datetime(bt['close_timestamp'])
            except Exception:
                continue

            for st in sync_trades:
                if st['id'] in ids_to_delete:
                    continue
                st_sym = str(st.get('symbol', '')).upper().strip()
                if bt_sym != st_sym:
                    continue

                try:
                    st_dt = pd.to_datetime(st['close_timestamp'])
                    diff_sec = abs((bt_dt - st_dt).total_seconds())
                    if diff_sec <= 180: # Ventana de hasta 3 minutos entre bot y sync
                        ids_to_delete.add(st['id'])
                        logger.info(f"Purge duplicate: Trade sync ID={st['id']} ({st_sym}) eliminado por duplicidad con trade bot ID={bt['id']} (diff: {diff_sec:.1f}s)")
                except Exception:
                    pass

        # Purga de posibles registros con el mismo binance_trade_id repetido
        seen_b_ids = {}
        for r in rows:
            b_id = r.get('binance_trade_id')
            if b_id:
                sym = str(r.get('symbol', '')).upper().strip()
                k = (sym, int(b_id))
                if k in seen_b_ids:
                    ids_to_delete.add(r['id'])
                else:
                    seen_b_ids[k] = r['id']

        # Limpiar trades dummy con PnL = 0 de Binance Testnet Sync
        for r in sync_trades:
            pnl_val = float(r.get('pnl_usdt') or 0.0)
            if abs(pnl_val) < 1e-6:
                ids_to_delete.add(r['id'])

        if ids_to_delete:
            placeholders = ','.join('?' for _ in ids_to_delete)
            cursor.execute(f"DELETE FROM trades WHERE id IN ({placeholders})", list(ids_to_delete))
            conn.commit()
            logger.info(f"Purga exitosa: {len(ids_to_delete)} trades duplicados/inválidos eliminados de la base de datos.")

        return len(ids_to_delete)
    except Exception as e:
        logger.warning(f"Aviso en purge_duplicate_trades: {e}")
        return 0
    finally:
        if conn:
            conn.close()

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
            binance_trade_id INTEGER UNIQUE, -- Para evitar duplicados de Binance
            strategy_name TEXT -- Estrategia que ejecutó el trade
        )
        """)
        conn.commit()

        # Asegurar columnas gross_pnl_usdt y commission_usdt
        cursor.execute("PRAGMA table_info(trades)")
        columns = [col[1] for col in cursor.fetchall()]
        if 'gross_pnl_usdt' not in columns:
            cursor.execute("ALTER TABLE trades ADD COLUMN gross_pnl_usdt REAL DEFAULT 0.0")
            conn.commit()
        if 'commission_usdt' not in columns:
            cursor.execute("ALTER TABLE trades ADD COLUMN commission_usdt REAL DEFAULT 0.0")
            conn.commit()
        if 'strategy_name' not in columns:
            cursor.execute("ALTER TABLE trades ADD COLUMN strategy_name TEXT")
            conn.commit()

        cursor.execute("""
        CREATE TABLE IF NOT EXISTS bot_settings (
            key TEXT PRIMARY KEY,
            value TEXT
        )
        """)
        conn.commit()

        cursor.execute("""
        CREATE TABLE IF NOT EXISTS users (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            username TEXT UNIQUE NOT NULL,
            email TEXT UNIQUE,
            password_hash TEXT NOT NULL,
            role TEXT NOT NULL DEFAULT 'investor',
            status TEXT NOT NULL DEFAULT 'pending',
            created_at DATETIME NOT NULL,
            last_login DATETIME,
            requested_capital REAL DEFAULT 0.0
        )
        """)
        conn.commit()

        # Migración automática si la tabla users ya existía sin la columna requested_capital
        try:
            cursor.execute("ALTER TABLE users ADD COLUMN requested_capital REAL DEFAULT 0.0")
            conn.commit()
        except Exception:
            pass

        cursor.execute("""
        CREATE TABLE IF NOT EXISTS investor_transactions (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            user_id INTEGER NOT NULL,
            amount_usdt REAL NOT NULL,
            transaction_type TEXT NOT NULL,
            notes TEXT,
            created_at DATETIME NOT NULL,
            FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
        )
        """)
        conn.commit()

        # 1. Limpieza y purga automática robusta de trades duplicados
        purge_duplicate_trades()

        # 2. Asegurar que TODAS las operaciones existentes tengan su comisión y PnL neto/bruto calculados
        try:
            cursor.execute("""
                SELECT id, symbol, open_price, close_price, quantity, position_size_usdt, pnl_usdt, gross_pnl_usdt, parameters 
                FROM trades 
                WHERE commission_usdt IS NULL OR commission_usdt <= 0.00001
            """)
            need_comm = cursor.fetchall()
            if need_comm:
                logger.info(f"Calculando comisiones Binance para {len(need_comm)} trades sin comisión...")
                for row in need_comm:
                    t_id, sym, op, cp, qty, pos_size, cur_pnl, g_pnl, p_str = row
                    cur_pnl = float(cur_pnl or 0.0)
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
                    gross = float(g_pnl) if (g_pnl is not None and float(g_pnl) != 0.0) else cur_pnl
                    net = round(gross - comm, 4)

                    cursor.execute("UPDATE trades SET gross_pnl_usdt = ?, commission_usdt = ?, pnl_usdt = ? WHERE id = ?", (gross, comm, net, t_id))
                conn.commit()
                logger.info("Recálculo y actualización de comisiones Binance finalizado con éxito.")
        except Exception as e_comm:
            logger.warning(f"Aviso durante cálculo de comisiones en trades: {e_comm}")

        # 3. Limpiar trades dummy con PnL = 0 originados por sincronizaciones erróneas de órdenes de entrada
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

        # Si este trade es registrado por el bot (no Binance Sync) y ya existe un trade reciente de 'Binance Testnet Sync' en los últimos 60s,
        # enriquecerlo y actualizarlo en vez de crear un duplicado
        if close_reason != 'Binance Testnet Sync' and close_timestamp:
            try:
                close_epoch = int(close_timestamp.timestamp()) if hasattr(close_timestamp, 'timestamp') else int(datetime.now().timestamp())
                cursor.execute("""
                    SELECT id FROM trades 
                    WHERE symbol = ? 
                      AND close_reason = 'Binance Testnet Sync'
                      AND abs(strftime('%s', close_timestamp) - ?) <= 60
                    ORDER BY id DESC LIMIT 1
                """, (symbol, close_epoch))
                existing_sync = cursor.fetchone()
                if existing_sync:
                    cursor.execute("""
                        UPDATE trades 
                        SET close_reason = ?, strategy_name = ?, parameters = ?, pnl_usdt = ?, gross_pnl_usdt = ?, commission_usdt = ?
                        WHERE id = ?
                    """, (close_reason, strategy_name, parameters_json, pnl_usdt, gross_pnl_usdt, commission_usdt, existing_sync[0]))
                    conn.commit()
                    logger.info(f"Trade {existing_sync[0]} para {symbol} enriquecido con motivo del bot: '{close_reason}' (duplicado prevenido).")
                    return existing_sync[0]
            except Exception as e_enrich:
                logger.debug(f"Aviso al verificar duplicado en record_trade: {e_enrich}")

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
    try:
        purge_duplicate_trades()
    except Exception:
        pass
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
    try:
        purge_duplicate_trades()
    except Exception:
        pass
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
def _enrich_trade_commission_fields(t: dict) -> dict:
    """Garantiza que el trade devuelto tenga campos válidos de comisión y PnL bruto/neto calculados."""
    c = float(t.get('commission_usdt') or 0.0)
    op = float(t.get('open_price') or 0.0)
    cp = float(t.get('close_price') or op or 0.0)
    qty = float(t.get('quantity') or 0.0)
    pos_sz = float(t.get('position_size_usdt') or (op * qty) or 1500.0)
    ent = (op * qty) if (op > 0 and qty > 0) else pos_sz
    ext = (cp * qty) if (cp > 0 and qty > 0) else ent

    if c <= 0.00001 and (ent > 0 or ext > 0):
        c = round((ent * 0.0002) + (ext * 0.0005), 4)
        t['commission_usdt'] = c
    else:
        t['commission_usdt'] = round(c, 4)

    cur_pnl = float(t.get('pnl_usdt') or 0.0)
    cur_gross = t.get('gross_pnl_usdt')
    if cur_gross is None or float(cur_gross) == 0.0:
        t['gross_pnl_usdt'] = cur_pnl
        t['pnl_usdt'] = round(cur_pnl - c, 4)
    else:
        t['gross_pnl_usdt'] = round(float(cur_gross), 4)
        t['pnl_usdt'] = round(cur_pnl, 4)
    return t

# --- NUEVA FUNCIÓN ---
def get_last_n_trades_for_symbol(symbol: str, n: int = 10) -> list[dict]:
    """
    Recupera los últimos N trades cerrados para un símbolo específico desde la base de datos.
    """
    logger = get_logger()
    try:
        purge_duplicate_trades()
    except Exception:
        pass
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
        FROM trades
        WHERE symbol = ?
        ORDER BY close_timestamp DESC
        LIMIT ?
        """
        cursor.execute(query, (symbol.upper(), n))
        rows = cursor.fetchall()
        trades = [_enrich_trade_commission_fields(dict(row)) for row in rows]
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
    try:
        purge_duplicate_trades()
    except Exception:
        pass
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
        trades = [_enrich_trade_commission_fields(dict(row)) for row in rows]
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

                # Verificar si ya existe una operación registrada para este cierre en SQLite
                # (evita duplicar trades que el bot ya registró al cerrar la posición)
                trade_epoch = int(time_ms / 1000) if time_ms > 0 else int(datetime.now().timestamp())
                existing_trade_id = None
                try:
                    conn_chk = sqlite3.connect(DATABASE_FILE, timeout=5)
                    cur_chk = conn_chk.cursor()
                    cur_chk.execute("""
                        SELECT id, binance_trade_id FROM trades 
                        WHERE symbol = ? 
                          AND abs(strftime('%s', close_timestamp) - ?) <= 180
                        ORDER BY id DESC LIMIT 1
                    """, (sym, trade_epoch))
                    ex_row = cur_chk.fetchone()
                    if ex_row:
                        existing_trade_id = ex_row[0]
                        if not ex_row[1]:
                            cur_chk.execute("UPDATE trades SET binance_trade_id = ? WHERE id = ?", (int(trade_id), existing_trade_id))
                            conn_chk.commit()
                    conn_chk.close()
                except Exception as e_chk:
                    logger.debug(f"Aviso al verificar duplicado en sync: {e_chk}")

                if existing_trade_id:
                    # El trade ya fue registrado por el bot, no duplicar
                    continue

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

    try:
        purge_duplicate_trades()
    except Exception:
        pass

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

# =====================================================================
# --- GESTIÓN DE USUARIOS, AUTENTICACIÓN Y CAPITAL DE INVERSIONISTAS ---
# =====================================================================

def count_users() -> int:
    """Retorna la cantidad total de usuarios registrados en el sistema."""
    conn = get_db_connection()
    if not conn:
        return 0
    try:
        cursor = conn.cursor()
        cursor.execute("SELECT COUNT(*) FROM users")
        row = cursor.fetchone()
        return row[0] if row else 0
    except Exception as e:
        get_logger().error(f"Error al contar usuarios: {e}")
        return 0
    finally:
        conn.close()

def create_user(username: str, email: str, password_hash: str, role: str = 'investor', status: str = 'pending', requested_capital: float = 0.0) -> int:
    """Crea un nuevo usuario en la base de datos y retorna su ID."""
    conn = get_db_connection()
    if not conn:
        return None
    try:
        cursor = conn.cursor()
        now_str = datetime.now().strftime('%Y-%m-%d %H:%M:%S')
        cursor.execute("""
            INSERT INTO users (username, email, password_hash, role, status, created_at, requested_capital)
            VALUES (?, ?, ?, ?, ?, ?, ?)
        """, (username.strip(), email.strip().lower() if email else None, password_hash, role, status, now_str, float(requested_capital or 0.0)))
        conn.commit()
        return cursor.lastrowid
    except sqlite3.IntegrityError as ie:
        get_logger().warning(f"IntegrityError al crear usuario '{username}': {ie}")
        return None
    except Exception as e:
        get_logger().error(f"Error al crear usuario: {e}", exc_info=True)
        return None
    finally:
        conn.close()

def format_account_number(user_id: int) -> str:
    """Genera el número de cuenta institucional único para WTN Solutions LLC."""
    if not user_id:
        return "WTN-2026-0000"
    return f"WTN-2026-{int(user_id):04d}"

def toggle_user_status(user_id: int, new_status: str) -> bool:
    """Modifica el estado de acceso de un usuario ('active' o 'blocked')."""
    if new_status not in ('active', 'blocked', 'rejected', 'pending'):
        return False
    conn = get_db_connection()
    if not conn:
        return False
    try:
        cursor = conn.cursor()
        cursor.execute("UPDATE users SET status = ? WHERE id = ?", (new_status, user_id))
        conn.commit()
        get_logger().info(f"Estado de usuario {user_id} actualizado a '{new_status}' en WTN Solutions LLC.")
        return True
    except Exception as e:
        get_logger().error(f"Error al cambiar estado de usuario {user_id}: {e}")
        return False
    finally:
        conn.close()

def get_user_by_id(user_id: int) -> dict:
    """Obtiene un usuario por su ID (sin devolver el password_hash)."""
    conn = get_db_connection()
    if not conn:
        return None
    try:
        cursor = conn.cursor()
        cursor.execute("SELECT id, username, email, role, status, created_at, last_login, requested_capital FROM users WHERE id = ?", (user_id,))
        row = cursor.fetchone()
        if not row:
            return None
        res = dict(row)
        res['account_number'] = format_account_number(res['id'])
        res['requested_capital'] = float(res.get('requested_capital') or 0.0)
        return res
    except Exception as e:
        get_logger().error(f"Error al obtener usuario por ID {user_id}: {e}")
        return None
    finally:
        conn.close()

def get_user_by_identifier(identifier: str) -> dict:
    """Busca un usuario por username o email (incluye password_hash para verificación)."""
    conn = get_db_connection()
    if not conn:
        return None
    try:
        cursor = conn.cursor()
        cursor.execute("""
            SELECT id, username, email, password_hash, role, status, created_at, last_login, requested_capital 
            FROM users 
            WHERE LOWER(username) = LOWER(?) OR (email IS NOT NULL AND LOWER(email) = LOWER(?))
        """, (identifier.strip(), identifier.strip()))
        row = cursor.fetchone()
        if not row:
            return None
        res = dict(row)
        res['account_number'] = format_account_number(res['id'])
        res['requested_capital'] = float(res.get('requested_capital') or 0.0)
        return res
    except Exception as e:
        get_logger().error(f"Error al buscar usuario por identificador '{identifier}': {e}")
        return None
    finally:
        conn.close()

def update_last_login(user_id: int):
    """Actualiza la fecha y hora del último inicio de sesión."""
    conn = get_db_connection()
    if not conn:
        return
    try:
        cursor = conn.cursor()
        now_str = datetime.now().strftime('%Y-%m-%d %H:%M:%S')
        cursor.execute("UPDATE users SET last_login = ? WHERE id = ?", (now_str, user_id))
        conn.commit()
    except Exception as e:
        get_logger().error(f"Error al actualizar last_login para usuario {user_id}: {e}")
    finally:
        conn.close()

def approve_user(user_id: int, initial_capital: float = 0.0) -> bool:
    """Aprueba una cuenta pendiente y registra su capital inicial si es mayor que 0."""
    conn = get_db_connection()
    if not conn:
        return False
    try:
        cursor = conn.cursor()
        cursor.execute("UPDATE users SET status = 'active' WHERE id = ?", (user_id,))
        now_str = datetime.now().strftime('%Y-%m-%d %H:%M:%S')
        if initial_capital > 0:
            cursor.execute("""
                INSERT INTO investor_transactions (user_id, amount_usdt, transaction_type, notes, created_at)
                VALUES (?, ?, 'INITIAL', 'Aporte inicial al aprobar cuenta', ?)
            """, (user_id, float(initial_capital), now_str))
        conn.commit()
        return True
    except Exception as e:
        get_logger().error(f"Error al aprobar usuario {user_id}: {e}", exc_info=True)
        return False
    finally:
        conn.close()

def reject_user(user_id: int) -> bool:
    """Rechaza una cuenta de usuario."""
    conn = get_db_connection()
    if not conn:
        return False
    try:
        cursor = conn.cursor()
        cursor.execute("UPDATE users SET status = 'rejected' WHERE id = ?", (user_id,))
        conn.commit()
        return True
    except Exception as e:
        get_logger().error(f"Error al rechazar usuario {user_id}: {e}")
        return False
    finally:
        conn.close()

def add_investor_transaction(user_id: int, amount_usdt: float, transaction_type: str, notes: str = '') -> bool:
    """Registra una transacción de capital (DEPOSIT, WITHDRAWAL, INITIAL)."""
    conn = get_db_connection()
    if not conn:
        return False
    try:
        cursor = conn.cursor()
        now_str = datetime.now().strftime('%Y-%m-%d %H:%M:%S')
        cursor.execute("""
            INSERT INTO investor_transactions (user_id, amount_usdt, transaction_type, notes, created_at)
            VALUES (?, ?, ?, ?, ?)
        """, (user_id, float(amount_usdt), transaction_type.upper(), notes, now_str))
        conn.commit()
        return True
    except Exception as e:
        get_logger().error(f"Error al registrar transacción para usuario {user_id}: {e}")
        return False
    finally:
        conn.close()

def get_investor_transactions(user_id: int) -> list:
    """Retorna el historial de movimientos de capital de un inversionista."""
    conn = get_db_connection()
    if not conn:
        return []
    try:
        cursor = conn.cursor()
        cursor.execute("""
            SELECT id, amount_usdt, transaction_type, notes, created_at 
            FROM investor_transactions 
            WHERE user_id = ? 
            ORDER BY id DESC
        """, (user_id,))
        return [dict(r) for r in cursor.fetchall()]
    except Exception as e:
        get_logger().error(f"Error al obtener transacciones de usuario {user_id}: {e}")
        return []
    finally:
        conn.close()

def get_all_investors_summary(live_pool_balance: float = None) -> dict:
    """
    Retorna el resumen maestro para el Super Administrador de WTN Solutions LLC:
    - Lista de usuarios con capital aportado, participación %, valor actual, PnL, ROI y N° Cuenta.
    - Totales de capital acumulado (AUM).
    - Solicitudes pendientes de aprobación.
    - Desglose del capital perteneciente a la casa matriz (WTN Solutions LLC).
    """
    conn = get_db_connection()
    if not conn:
        return {"investors": [], "pending_users": [], "pool_stats": {}}
    try:
        cursor = conn.cursor()
        cursor.execute("SELECT id, username, email, role, status, created_at, last_login, requested_capital FROM users ORDER BY id ASC")
        all_users = [dict(r) for r in cursor.fetchall()]

        cursor.execute("""
            SELECT user_id, 
                   SUM(CASE WHEN transaction_type IN ('INITIAL', 'DEPOSIT') THEN amount_usdt ELSE 0 END) as total_deposits,
                   SUM(CASE WHEN transaction_type = 'WITHDRAWAL' THEN amount_usdt ELSE 0 END) as total_withdrawals
            FROM investor_transactions
            GROUP BY user_id
        """)
        capital_by_user = {}
        for row in cursor.fetchall():
            net_cap = float(row['total_deposits'] or 0.0) - float(row['total_withdrawals'] or 0.0)
            capital_by_user[row['user_id']] = max(0.0, net_cap)

        active_investors = []
        pending_users = []
        total_deposited_pool = 0.0

        for u in all_users:
            u_id = u['id']
            net_cap = capital_by_user.get(u_id, 0.0)
            u['net_capital'] = round(net_cap, 2)
            u['account_number'] = format_account_number(u_id)
            u['requested_capital'] = float(u.get('requested_capital') or 0.0)
            
            if u['status'] == 'pending':
                pending_users.append(u)
            else:
                # Tanto active como blocked aparecen en la lista de gestión
                if u['status'] == 'active':
                    total_deposited_pool += net_cap
                active_investors.append(u)

        pool_balance = float(live_pool_balance) if live_pool_balance is not None and live_pool_balance > 0 else total_deposited_pool

        for inv in active_investors:
            cap = inv['net_capital']
            share_pct = (cap / total_deposited_pool * 100.0) if total_deposited_pool > 0 else 0.0
            current_value = (pool_balance * (share_pct / 100.0)) if total_deposited_pool > 0 else cap
            net_pnl = current_value - cap
            roi_pct = (net_pnl / cap * 100.0) if cap > 0 else 0.0

            inv['share_percentage'] = round(share_pct, 2)
            inv['current_value'] = round(current_value, 2)
            inv['net_pnl'] = round(net_pnl, 2)
            inv['roi_percentage'] = round(roi_pct, 2)

        # Cuota y Capital perteneciente a WTN Solutions LLC (Admin)
        admin_inv = next((inv for inv in active_investors if inv['role'] == 'admin'), None)
        wtn_capital = admin_inv['current_value'] if admin_inv else 0.0
        wtn_share = admin_inv['share_percentage'] if admin_inv else 0.0

        pool_stats = {
            "total_deposited_pool": round(total_deposited_pool, 2),
            "live_pool_balance": round(pool_balance, 2),
            "total_pool_pnl": round(pool_balance - total_deposited_pool, 2),
            "total_pool_roi": round(((pool_balance - total_deposited_pool) / total_deposited_pool * 100.0) if total_deposited_pool > 0 else 0.0, 2),
            "active_investors_count": len([i for i in active_investors if i['status'] == 'active']),
            "blocked_investors_count": len([i for i in active_investors if i['status'] == 'blocked']),
            "pending_users_count": len(pending_users),
            "wtn_house_capital": round(wtn_capital, 2),
            "wtn_house_share": round(wtn_share, 2)
        }

        return {
            "investors": active_investors,
            "pending_users": pending_users,
            "pool_stats": pool_stats
        }
    except Exception as e:
        get_logger().error(f"Error al obtener resumen de inversionistas: {e}", exc_info=True)
        return {"investors": [], "pending_users": [], "pool_stats": {}}
    finally:
        conn.close()

def get_admin_investor_dossier(user_id: int, live_pool_balance: float = None) -> dict:
    """
    Retorna el dossier 360° ampliado de un inversionista para el Super Administrador:
    - Portafolio idéntico al que ve el cliente
    - Número de cuenta WTN-2026-XXXX
    - Muestra de operaciones recientes del bot
    - Historial de depósitos y retiros
    """
    portfolio = get_investor_portfolio(user_id, live_pool_balance=live_pool_balance)
    if not portfolio:
        return None
    recent_trades = get_all_recent_trades(limit=50)
    return {
        "portfolio": portfolio,
        "recent_trades": recent_trades,
        "company": "WTN Solutions LLC",
        "platform": "WTN ALGO-TRADING (Binance)",
        "generated_at": datetime.now().strftime('%Y-%m-%d %H:%M:%S')
    }

def get_investor_portfolio(user_id: int, live_pool_balance: float = None) -> dict:
    """
    Retorna la información financiera exclusiva del inversionista:
    - Su capital aportado
    - Su pedazo de la torta (% del fondo)
    - Su balance actual estimado
    - Su ganancia neta ($) y ROI (%)
    - Historial de sus transacciones
    """
    conn = get_db_connection()
    if not conn:
        return None
    try:
        cursor = conn.cursor()
        cursor.execute("SELECT id, username, email, role, status, created_at FROM users WHERE id = ?", (user_id,))
        user_row = cursor.fetchone()
        if not user_row:
            return None
        user_info = dict(user_row)
        user_info['account_number'] = format_account_number(user_info['id'])

        cursor.execute("""
            SELECT id, amount_usdt, transaction_type, notes, created_at 
            FROM investor_transactions 
            WHERE user_id = ? 
            ORDER BY id DESC
        """, (user_id,))
        user_txs = [dict(r) for r in cursor.fetchall()]

        user_deposits = sum(r['amount_usdt'] for r in user_txs if r['transaction_type'] in ('INITIAL', 'DEPOSIT'))
        user_withdrawals = sum(r['amount_usdt'] for r in user_txs if r['transaction_type'] == 'WITHDRAWAL')
        user_net_capital = max(0.0, user_deposits - user_withdrawals)

        cursor.execute("""
            SELECT it.user_id,
                   SUM(CASE WHEN it.transaction_type IN ('INITIAL', 'DEPOSIT') THEN it.amount_usdt ELSE 0 END) as total_dep,
                   SUM(CASE WHEN it.transaction_type = 'WITHDRAWAL' THEN it.amount_usdt ELSE 0 END) as total_wd
            FROM investor_transactions it
            JOIN users u ON u.id = it.user_id
            WHERE u.status = 'active'
            GROUP BY it.user_id
        """)
        active_cap_rows = cursor.fetchall()

        active_caps = {}
        for r in active_cap_rows:
            net_c = float(r['total_dep'] or 0.0) - float(r['total_wd'] or 0.0)
            if net_c > 0:
                active_caps[r['user_id']] = net_c

        total_pool_dep = sum(active_caps.values())
        total_pool_dep = max(0.0, total_pool_dep)

        pool_balance = float(live_pool_balance) if live_pool_balance is not None and live_pool_balance > 0 else total_pool_dep

        share_pct = (user_net_capital / total_pool_dep * 100.0) if total_pool_dep > 0 else 0.0
        current_value = (pool_balance * (share_pct / 100.0)) if total_pool_dep > 0 else user_net_capital
        net_pnl = current_value - user_net_capital
        roi_pct = (net_pnl / user_net_capital * 100.0) if user_net_capital > 0 else 0.0

        # Construcción de porciones anónimas de la torta para que el inversionista compare
        pool_slices = []
        anon_index = 1
        sorted_caps = sorted(active_caps.items(), key=lambda x: x[1], reverse=True)

        for uid, u_cap in sorted_caps:
            is_self = (uid == user_id)
            s_pct = (u_cap / total_pool_dep * 100.0) if total_pool_dep > 0 else 0.0
            c_val = (pool_balance * (s_pct / 100.0)) if total_pool_dep > 0 else u_cap
            u_pnl = c_val - u_cap
            u_roi = (u_pnl / u_cap * 100.0) if u_cap > 0 else 0.0

            if is_self:
                label = "Tu Inversión"
            else:
                label = f"Inversión #{anon_index}"
                anon_index += 1

            pool_slices.append({
                "label": label,
                "capital": round(u_cap, 2),
                "current_value": round(c_val, 2),
                "share_percentage": round(s_pct, 2),
                "net_pnl": round(u_pnl, 2),
                "roi_percentage": round(u_roi, 2),
                "is_self": is_self
            })

        # Si el balance del pool total supera a la suma de depósitos registrados (por ejemplo la reserva base o casa matriz):
        if len(pool_slices) == 1 and pool_slices[0]["share_percentage"] < 99.9:
            self_s = pool_slices[0]
            rem_share = round(100.0 - self_s["share_percentage"], 2)
            rem_val = round(pool_balance - self_s["current_value"], 2)
            rem_cap = round(total_pool_dep * (rem_share / (self_s["share_percentage"] or 1)), 2)
            rem_pnl = round(rem_val - rem_cap, 2)
            rem_roi = round((rem_pnl / rem_cap * 100.0), 2) if rem_cap > 0 else round(self_s["roi_percentage"], 2)

            pool_slices.insert(0, {
                "label": "Inversión #1 (Pool Institucional)",
                "capital": rem_cap,
                "current_value": rem_val,
                "share_percentage": rem_share,
                "net_pnl": rem_pnl,
                "roi_percentage": rem_roi,
                "is_self": False
            })

        return {
            "user": user_info,
            "account_number": format_account_number(user_info['id']),
            "capital_invested": round(user_net_capital, 2),
            "share_percentage": round(share_pct, 2),
            "current_value": round(current_value, 2),
            "net_pnl": round(net_pnl, 2),
            "roi_percentage": round(roi_pct, 2),
            "total_pool_balance": round(pool_balance, 2),
            "transactions": user_txs,
            "pool_slices": pool_slices
        }
    except Exception as e:
        get_logger().error(f"Error al obtener portafolio del inversionista {user_id}: {e}", exc_info=True)
        return None
    finally:
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