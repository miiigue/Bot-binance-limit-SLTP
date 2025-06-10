# Este módulo interactuará con la base de datos PostgreSQL.

import psycopg2
import json
from datetime import datetime
import os
from typing import Union, List, Dict

# Importamos el logger
from .logger_setup import get_logger

# La URL de la base de datos se leerá desde las variables de entorno
DATABASE_URL = os.environ.get('DATABASE_URL')

def get_db_connection():
    """Establece una conexión con la base de datos PostgreSQL."""
    logger = get_logger()
    if not DATABASE_URL:
        logger.critical("Error CRÍTICO: La variable de entorno 'DATABASE_URL' no está definida.")
        raise ValueError("DATABASE_URL no está configurada.")

    conn = None
    try:
        conn = psycopg2.connect(DATABASE_URL)
        # logger.debug("Conexión a PostgreSQL DB establecida.")
        return conn
    except psycopg2.Error as e:
        logger.critical(f"Error CRÍTICO al conectar a PostgreSQL: {e}")
        return None
    except Exception as e:
        logger.critical(f"Error inesperado al conectar con PostgreSQL: {e}")
        return None

def init_db_schema():
    """Inicializa el esquema de la base de datos si la tabla 'trades' no existe."""
    logger = get_logger()
    conn = None
    try:
        conn = get_db_connection()
        if conn is None:
            raise ConnectionError("No se pudo obtener conexión a la base de datos.")
        
        with conn.cursor() as cursor:
            # PostgreSQL usa tipos de datos ligeramente diferentes.
            # NUMERIC para precisión, TIMESTAMP para fechas.
            cursor.execute("""
            CREATE TABLE IF NOT EXISTS trades (
                id SERIAL PRIMARY KEY,
                symbol TEXT NOT NULL,
                trade_type TEXT NOT NULL,
                open_timestamp TIMESTAMP NOT NULL,
                close_timestamp TIMESTAMP,
                open_price NUMERIC(20, 10) NOT NULL,
                close_price NUMERIC(20, 10),
                quantity NUMERIC(20, 10) NOT NULL,
                position_size_usdt NUMERIC(20, 10),
                pnl_usdt NUMERIC(20, 10),
                close_reason TEXT,
                parameters TEXT,
                binance_trade_id BIGINT UNIQUE
            )
            """)
            conn.commit()
            
            # Crear índice si no existe para búsquedas rápidas
            cursor.execute("CREATE INDEX IF NOT EXISTS idx_binance_trade_id ON trades (binance_trade_id)")
            conn.commit()
            
        logger.info("Esquema de la base de datos PostgreSQL inicializado/verificado.")
        return True
    except psycopg2.Error as e:
        logger.error(f"Error al inicializar/verificar el esquema de la DB en PostgreSQL: {e}", exc_info=True)
        return False
    finally:
        if conn:
            conn.close()

def record_trade(symbol: str, trade_type: str, open_timestamp: datetime, 
                 open_price: float, quantity: float, position_size_usdt: float,
                 close_timestamp: Union[datetime, None] = None,
                 close_price: Union[float, None] = None,
                 pnl_usdt: Union[float, None] = None,
                 close_reason: Union[str, None] = None,
                 parameters: Union[dict, None] = None,
                 binance_trade_id: Union[int, None] = None):
    """Registra un trade en la base de datos PostgreSQL."""
    logger = get_logger()
    parameters_json = json.dumps(parameters) if parameters else None

    conn = None
    try:
        conn = get_db_connection()
        if conn is None:
            raise ConnectionError("No se pudo obtener conexión para registrar el trade.")
            
        with conn.cursor() as cursor:
            # psycopg2 usa %s como placeholder
            sql = """
            INSERT INTO trades (symbol, trade_type, open_timestamp, close_timestamp, 
                              open_price, close_price, quantity, position_size_usdt, 
                              pnl_usdt, close_reason, parameters, binance_trade_id)
            VALUES (%s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s)
            """
            cursor.execute(sql, (symbol, trade_type, open_timestamp, close_timestamp, 
                                 open_price, close_price, quantity, position_size_usdt, 
                                 pnl_usdt, close_reason, parameters_json, binance_trade_id))
            conn.commit()
        logger.info(f"Trade para {symbol} registrado en la DB PostgreSQL. Binance Trade ID: {binance_trade_id if binance_trade_id else 'N/A'}")
    except psycopg2.IntegrityError as ie:
        logger.error(f"Error de integridad al registrar trade para {symbol} (Binance ID: {binance_trade_id}): {ie}. Es posible que este trade ya exista.", exc_info=True)
    except psycopg2.Error as e:
        logger.error(f"Error de PostgreSQL al registrar trade para {symbol}: {e}", exc_info=True)
    finally:
        if conn:
            conn.close()

def get_cumulative_pnl_by_symbol() -> Dict[str, float]:
    """Calcula el PnL acumulado para cada símbolo desde PostgreSQL."""
    logger = get_logger()
    conn = None
    cumulative_pnl = {}

    try:
        conn = get_db_connection()
        if conn is None:
            return cumulative_pnl

        with conn.cursor() as cursor:
            # COALESCE es el equivalente a IFNULL en PostgreSQL
            sql = "SELECT symbol, SUM(COALESCE(pnl_usdt, 0)) FROM trades GROUP BY symbol"
            cursor.execute(sql)
            rows = cursor.fetchall()

            for row in rows:
                symbol, total_pnl = row
                if symbol and total_pnl is not None:
                    cumulative_pnl[symbol] = float(total_pnl)
        
    except psycopg2.Error as e:
        logger.error(f"Error de PostgreSQL al calcular PnL acumulado: {e}", exc_info=True)
    finally:
        if conn:
            conn.close()
            
    return cumulative_pnl

def get_last_n_trades_for_symbol(symbol: str, n: int = 10) -> List[Dict]:
    """Recupera los últimos N trades cerrados para un símbolo desde PostgreSQL."""
    logger = get_logger()
    conn = None
    trades = []
    try:
        conn = get_db_connection()
        if conn is None:
            return trades

        with conn.cursor(cursor_factory=psycopg2.extras.RealDictCursor) as cursor:
            query = """
            SELECT id, symbol, trade_type, open_timestamp, close_timestamp,
                   open_price, close_price, quantity, position_size_usdt,
                   pnl_usdt, close_reason, parameters
            FROM trades
            WHERE symbol = %s
            ORDER BY close_timestamp DESC
            LIMIT %s
            """
            cursor.execute(query, (symbol.upper(), n))
            rows = cursor.fetchall()
            trades = [dict(row) for row in rows]

    except psycopg2.Error as e:
        logger.error(f"Error de PostgreSQL al obtener trades para {symbol}: {e}", exc_info=True)
    finally:
        if conn:
            conn.close()
            
    return trades

def check_if_binance_trade_exists(binance_trade_id: Union[int, None]) -> bool:
    """Verifica si un trade con el binance_trade_id ya existe en PostgreSQL."""
    if binance_trade_id is None:
        return False
        
    logger = get_logger()
    conn = None
    exists = False
    try:
        conn = get_db_connection()
        if conn is None:
            return False

        with conn.cursor() as cursor:
            cursor.execute("SELECT EXISTS(SELECT 1 FROM trades WHERE binance_trade_id = %s)", (binance_trade_id,))
            exists = cursor.fetchone()[0]
    except psycopg2.Error as e:
        logger.error(f"Error de PostgreSQL al verificar trade ID {binance_trade_id}: {e}", exc_info=True)
    finally:
        if conn:
            conn.close()
            
    return exists

def get_trade_by_binance_id(binance_trade_id: Union[int, None]) -> Union[Dict, None]:
    """Recupera un trade por su binance_trade_id desde PostgreSQL."""
    if binance_trade_id is None:
        return None

    logger = get_logger()
    conn = None
    trade = None
    try:
        conn = get_db_connection()
        if conn is None:
            return None

        with conn.cursor(cursor_factory=psycopg2.extras.RealDictCursor) as cursor:
            cursor.execute("SELECT * FROM trades WHERE binance_trade_id = %s", (binance_trade_id,))
            row = cursor.fetchone()
            if row:
                trade = dict(row)
    except psycopg2.Error as e:
        logger.error(f"Error de PostgreSQL al obtener trade por ID {binance_trade_id}: {e}", exc_info=True)
    finally:
        if conn:
            conn.close()

    return trade

# Ejemplo de uso (actualizado para PostgreSQL)
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
                             cur.execute("SELECT * FROM trades WHERE symbol = %s ORDER BY id DESC LIMIT 5", ('TESTUSDT',))
                             rows = cur.fetchall()
                             main_logger.info(f"Últimos 5 trades de TESTUSDT encontrados: {len(rows)}")
                             for row in rows:
                                 main_logger.info(f"  - {row}")
                     except psycopg2.Error as e:
                         main_logger.error(f"Error al leer trades de ejemplo: {e}")
                     finally:
                        conn_read.close()

            else:
                 main_logger.error("Fallo al registrar el trade de ejemplo.")
        else:
            main_logger.error("Fallo al inicializar el esquema de la base de datos PostgreSQL.")

    # Diagnóstico: imprimir los primeros 5 registros y el esquema de la tabla 'trades'
    print('--- Esquema de la tabla trades ---')
    conn = get_db_connection()
    cur = conn.cursor()
    cur.execute("SELECT * FROM trades LIMIT 5")
    rows = cur.fetchall()
    for row in rows:
        print(row)
    conn.close()

# --- FIN DE MODIFICACIONES ---
# El código original de PostgreSQL ha sido completamente reemplazado. 