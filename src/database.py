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
            close_reason TEXT,
            parameters TEXT, -- JSON string para guardar los parámetros de trading usados
            binance_trade_id INTEGER UNIQUE -- Esta columna se creará con la restricción UNIQUE si la tabla se crea nueva.
        )
        """)
        conn.commit() # Commit después de CREATE TABLE

        # Intentar añadir la columna explícitamente SOLO si la tabla ya existía 
        # y la columna podría faltar. Esto es para migraciones.
        # Sin embargo, para evitar el error "Cannot add a UNIQUE column", 
        # la mejor práctica si esta columna es nueva es recrear la tabla 
        # (borrando el .db) o manejar la migración de datos de forma más compleja.
        # Por ahora, simplificaremos asumiendo que si la tabla existe, 
        # y este código se ejecuta, el usuario debe asegurarse de que el esquema es compatible 
        # o borrar el .db para una nueva creación.

        # Solo intentar añadir la columna si no existe, SIN la restricción UNIQUE aquí,
        # ya que ALTER TABLE no puede añadir UNIQUE a una tabla con datos.
        # La restricción UNIQUE se aplica si la tabla se crea desde cero con la columna.
        # Si la tabla ya existe y la columna se añade, NO tendrá la restricción UNIQUE con este ALTER.
        # ESTO ES UNA LIMITACIÓN DE SQLITE con ALTER TABLE.
        # LA SOLUCIÓN REAL ES BORRAR EL DB SI SE AÑADE UNA COLUMNA CON UNIQUE.
        try:
            # Primero verificar si la columna existe
            cursor.execute("PRAGMA table_info(trades)")
            columns = [info[1] for info in cursor.fetchall()]
            if 'binance_trade_id' not in columns:
                cursor.execute("ALTER TABLE trades ADD COLUMN binance_trade_id INTEGER") # Sin UNIQUE aquí
                conn.commit()
                logger.info("Columna 'binance_trade_id' (sin UNIQUE) añadida a la tabla 'trades' existente.")
            else:
                logger.info("Columna 'binance_trade_id' ya existe.")
        except sqlite3.Error as e_alter:
            logger.warning(f"Advertencia durante el intento de ALTER TABLE para binance_trade_id: {e_alter}")

        # Intentar crear el índice. Esto funcionará si la columna existe.
        cursor.execute("CREATE INDEX IF NOT EXISTS idx_binance_trade_id ON trades (binance_trade_id)")
        conn.commit() # Commit después de CREATE INDEX

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
                 binance_trade_id: Union[int, None] = None): # <-- CAMBIO AQUÍ y Unificar
    """
    Registra un trade completado o una posición abierta en la base de datos.
    """
    logger = get_logger()
    # Convertir el diccionario de parámetros a JSON string si se proporciona
    parameters_json = json.dumps(parameters) if parameters else None

    # <<< DETAILED LOGGING OF PARAMETERS RECEIVED BY record_trade >>>
    logger.info(f"record_trade (database.py) called with: symbol='{symbol}', type='{trade_type}', open_ts={open_timestamp}, close_ts={close_timestamp}, open_p={open_price}, close_p={close_price}, qty={quantity}, pos_size_usdt={position_size_usdt}, PNL_USDT={pnl_usdt}, reason='{close_reason}', binance_id={binance_trade_id}, params_json_len={len(parameters_json) if parameters_json else 0}")

    conn = None
    try:
        conn = sqlite3.connect(DATABASE_FILE, timeout=10)
        cursor = conn.cursor()
        cursor.execute("""
        INSERT INTO trades (symbol, trade_type, open_timestamp, close_timestamp, 
                          open_price, close_price, quantity, position_size_usdt, 
                          pnl_usdt, close_reason, parameters, binance_trade_id)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        """, (symbol, trade_type, open_timestamp, close_timestamp, 
              open_price, close_price, quantity, position_size_usdt, 
              pnl_usdt, close_reason, parameters_json, binance_trade_id)) # <-- AÑADIR binance_trade_id
        conn.commit()
        logger.info(f"Trade para {symbol} registrado en la DB. Binance Trade ID: {binance_trade_id if binance_trade_id else 'N/A'}")
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

# --- NUEVA FUNCIÓN ---
def get_last_n_trades_for_symbol(symbol: str, n: int = 10) -> list[dict]:
    """
    Recupera los últimos N trades cerrados para un símbolo específico desde la base de datos.

    Args:
        symbol (str): El símbolo a buscar (ej. 'BTCUSDT').
        n (int): El número máximo de trades a devolver. Por defecto 10.

    Returns:
        list[dict]: Una lista de diccionarios, donde cada diccionario representa un trade
                    con claves correspondientes a las columnas de la tabla 'trades'.
                    La lista estará vacía si no hay trades para el símbolo.
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
               pnl_usdt, close_reason, parameters
        FROM trades
        WHERE symbol = ?
        ORDER BY close_timestamp DESC
        LIMIT ?
        """
        cursor.execute(query, (symbol.upper(), n))
        rows = cursor.fetchall()

        # Convertir las filas (sqlite3.Row) a diccionarios estándar
        trades = [dict(row) for row in rows]
        
        # Opcional: Convertir parámetros JSON string de vuelta a dict si es necesario
        # for trade in trades:
        #     if 'parameters' in trade and isinstance(trade['parameters'], str):
        #         try:
        #             trade['parameters'] = json.loads(trade['parameters'])
        #         except json.JSONDecodeError:
        #             get_logger().warning(f"Could not decode parameters JSON for trade {trade.get('id')}")
        #             trade['parameters'] = {} # O dejar como string?

    except sqlite3.Error as e:
        logger.error(f"Error al acceder a la base de datos para obtener trades de {symbol}: {e}", exc_info=True)
    finally:
        if conn:
            conn.close()
            
    return trades
# --- FIN NUEVA FUNCIÓN ---

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