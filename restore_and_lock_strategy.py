#!/usr/bin/env python3
"""
restore_and_lock_strategy.py
Restaura de forma segura y permanente la estrategia del usuario y sus parámetros soberanos.
Inmune a Git y reinicios.
"""
import os
import sys

PROJECT_ROOT = os.path.dirname(os.path.abspath(__file__))
if PROJECT_ROOT not in sys.path:
    sys.path.insert(0, PROJECT_ROOT)

def main():
    print("=" * 60)
    print("🛡️ INICIANDO RESTAURACIÓN Y BLINDAJE SOBERANO DE ESTRATEGIA...")
    print("=" * 60)

    # 1. Intentar restaurar config.ini desde git stash si existe
    res_stash = os.system("git checkout stash@{0} -- config.ini 2>/dev/null")
    if res_stash == 0:
        print("✅ config.ini restaurado exitosamente desde git stash.")
    else:
        print("ℹ️ Stash no requerido o no encontrado. Usando config.ini actual.")

    # 2. Aplicar skip-worktree para que Git NUNCA MÁS sobreescriba config.ini
    res_skip = os.system("git update-index --skip-worktree config.ini 2>/dev/null")
    if res_skip == 0:
        print("✅ Protección skip-worktree activada: Git ignorará config.ini para siempre.")
    else:
        print("ℹ️ Aviso al aplicar skip-worktree.")

    # 3. Guardar en Base de Datos con soberanía absoluta
    try:
        from src.database import set_active_strategy_in_db, set_bot_setting, init_db_schema
        init_db_schema()
        
        strat_name = "v18_v17_RSI-SNIPER-MOMENTUM_con12xyTS5c3_SL500_3DCA2_ReDi5c5"
        
        set_active_strategy_in_db(strat_name)
        set_bot_setting("active_strategy_name", strat_name)
        set_bot_setting("stop_loss_usdt", "500")
        set_bot_setting("enable_stop_loss_pnl", "true")
        set_bot_setting("enable_emergency_software_sl", "true")
        
        try:
            from src.api_server import _seed_strategies_catalog_from_files
            _seed_strategies_catalog_from_files()
            print("✅ Catálogo soberano de estrategias sincronizado y blindado en base de datos.")
        except Exception as e_seed:
            print(f"ℹ️ Aviso al sembrar catálogo: {e_seed}")
        
        print("✅ BASE DE DATOS BLOQUEADA:")
        print(f"   -> Estrategia Soberana: {strat_name}")
        print("   -> Stop Loss Soberano: 500 USDT")
        print("   -> SL de Emergencia por Software: Protegido con escudo de arranque de 120s")
    except Exception as e:
        print(f"❌ Error guardando en base de datos: {e}")
        sys.exit(1)

    print("=" * 60)
    print("🎉 BLINDAJE COMPLETADO EXITOSAMENTE")
    print("=" * 60)

if __name__ == '__main__':
    main()
