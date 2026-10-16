"""
Script de mantenimiento y normalización de catálogo de estrategias.
Pasa todos los registros de 'strategies_catalog' por normalize_strategy_dict()
para garantizar que no existan discrepancias entre snake_case y camelCase.
"""
import json
import logging
from src.database import get_db_connection
from src.config_loader import normalize_strategy_dict

logging.basicConfig(level=logging.INFO)
logger = logging.getLogger("normalize_db_catalog")

def run_migration():
    conn = get_db_connection()
    cursor = conn.cursor()
    cursor.execute("SELECT id, name, parameters_json FROM strategies_catalog")
    rows = cursor.fetchall()
    logger.info(f"Procesando {len(rows)} estrategias en base de datos...")
    
    for r in rows:
        sid, name, p_json = r[0], r[1], r[2]
        if not p_json:
            continue
        try:
            data = json.loads(p_json)
            norm = normalize_strategy_dict(data)
            cursor.execute("UPDATE strategies_catalog SET parameters_json = ? WHERE id = ?", (json.dumps(norm), sid))
            logger.info(f"OK [id={sid} {name}]: posSizeUSDT={norm.get('positionSizeUSDT')}, pos_size_usdt={norm.get('position_size_usdt')}")
        except Exception as e:
            logger.error(f"Error procesando id={sid}: {e}")

    conn.commit()
    conn.close()
    logger.info("Normalización de catálogo finalizada exitosamente.")

if __name__ == "__main__":
    run_migration()
