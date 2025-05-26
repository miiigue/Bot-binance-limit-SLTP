import sqlite3
import os
import pandas as pd

# Definir la ruta a la base de datos (igual que en tu database.py)
# Asumiendo que este script está en el directorio raíz del proyecto, y 'trades_limit.db' también.
DATABASE_FILE = os.path.join(os.path.dirname(os.path.abspath(__file__)), 'trades_limit.db')

def print_query_results(query_description, query, params=None):
    print(f"\n--- {query_description} ---")
    conn = None
    try:
        if not os.path.exists(DATABASE_FILE):
            print(f"Error: El archivo de base de datos no se encuentra en: {DATABASE_FILE}")
            # Intentar una ruta alternativa si BASE_DIR no es el directorio raíz como se espera
            alt_db_file = 'trades_limit.db' # Asumir que está en el mismo dir que el script
            if not os.path.exists(alt_db_file):
                 print(f"Error: Tampoco se encuentra en: {alt_db_file}")
                 return
            else:
                print(f"Usando ruta alternativa para DB: {alt_db_file}")
                conn = sqlite3.connect(alt_db_file)
        else:
            conn = sqlite3.connect(DATABASE_FILE)
            
        # Usar pandas para leer la consulta y mostrarla en un formato más legible
        df = pd.read_sql_query(query, conn, params=params)
        if df.empty:
            print("No se encontraron resultados para esta consulta.")
        else:
            # Para asegurar que se muestren todas las columnas en la salida de terminal
            pd.set_option('display.max_columns', None)
            pd.set_option('display.width', 2000) # Ancho generoso para la salida
            print(df.to_string())
    except sqlite3.Error as e:
        print(f"Error de SQLite al ejecutar '{query_description}': {e}")
    except Exception as e:
        print(f"Error inesperado al ejecutar '{query_description}': {e}")
    finally:
        if conn:
            conn.close()

if __name__ == "__main__":
    print(f"Intentando leer desde la base de datos: {DATABASE_FILE}")
    if not os.path.exists(DATABASE_FILE):
        # Intento adicional para localizar la DB si la primera ruta falla (ej. si el script no está exactamente donde pensamos)
        # Asumiendo que 'trades_limit.db' está en el mismo directorio que 'run_bot.py'
        # y que este script se ejecuta desde el directorio raíz del proyecto.
        script_dir = os.path.dirname(os.path.abspath(__file__))
        db_path_check = os.path.join(script_dir, 'trades_limit.db') 
        print(f"Verificando también en: {db_path_check}")
        if not os.path.exists(db_path_check):
            print(f"CRÍTICO: Archivo de base de datos 'trades_limit.db' NO ENCONTRADO en {DATABASE_FILE} ni en {db_path_check}.")
            print("Asegúrate de que 'trades_limit.db' existe en el directorio raíz del proyecto.")

    # 1. Trades con mayor PNL
    query_highest_pnl = "SELECT id, symbol, open_timestamp, close_timestamp, open_price, close_price, quantity, pnl_usdt, close_reason FROM trades WHERE pnl_usdt IS NOT NULL ORDER BY pnl_usdt DESC LIMIT 5"
    print_query_results("Trades con Mayor PNL (Positivo)", query_highest_pnl)

    # 2. Trades con menor PNL
    query_lowest_pnl = "SELECT id, symbol, open_timestamp, close_timestamp, open_price, close_price, quantity, pnl_usdt, close_reason FROM trades WHERE pnl_usdt IS NOT NULL ORDER BY pnl_usdt ASC LIMIT 5"
    print_query_results("Trades con Menor PNL (Negativo)", query_lowest_pnl)

    # 3. Trades más recientes
    query_recent_trades = "SELECT id, symbol, open_timestamp, close_timestamp, open_price, close_price, quantity, pnl_usdt, close_reason FROM trades WHERE close_timestamp IS NOT NULL ORDER BY close_timestamp DESC LIMIT 5"
    print_query_results("Trades Cerrados Más Recientes", query_recent_trades)

    # 4. Suma total de PNL directamente desde la DB
    query_total_pnl = "SELECT SUM(IFNULL(pnl_usdt, 0)) as total_pnl FROM trades"
    print_query_results("PNL Total Acumulado (desde DB)", query_total_pnl)

    # 5. Número total de trades
    query_count_trades = "SELECT COUNT(*) as num_trades FROM trades"
    print_query_results("Número Total de Trades Registrados", query_count_trades)

    # 6. Símbolos con PNL acumulado NULL (o cero después de IFNULL si todos son NULL para un símbolo)
    query_pnl_by_symbol_for_null_check = "SELECT symbol, SUM(pnl_usdt) as symbol_total_pnl FROM trades GROUP BY symbol ORDER BY symbol_total_pnl ASC"
    print_query_results("PNL Acumulado por Símbolo (para verificar NULLs, ordenado por PNL asc)", query_pnl_by_symbol_for_null_check)

    #7. Trades con PNL NULL
    query_null_pnl_trades = "SELECT id, symbol, open_timestamp, close_timestamp, open_price, close_price, quantity, pnl_usdt, close_reason FROM trades WHERE pnl_usdt IS NULL LIMIT 10"
    print_query_results("Trades con PNL IS NULL (primeros 10)", query_null_pnl_trades) 