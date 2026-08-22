import sys
import os

BASE_DIR = os.path.dirname(os.path.abspath(__file__))
if BASE_DIR not in sys.path:
    sys.path.insert(0, BASE_DIR)

from src.logger_setup import setup_logging
from src.database import init_db_schema
from src.api_server import app, load_initial_config

def main():
    setup_logging(log_filename='server.log')
    print("==================================================")
    print("   INICIANDO SERVIDOR BACKEND BINANCE BOT (5002)  ")
    print("==================================================")
    try:
        init_db_schema()
        print("[OK] Base de datos inicializada.")
    except Exception as e:
        print(f"[AVISO] DB: {e}")

    try:
        load_initial_config()
        print("[OK] Configuracion cargada.")
    except Exception as e:
        print(f"[AVISO] Config: {e}")

    print("[INFO] Servidor corriendo en http://127.0.0.1:5002")
    app.run(host='127.0.0.1', port=5002, debug=False, use_reloader=False)

if __name__ == '__main__':
    main()
