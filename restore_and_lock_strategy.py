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

# Cargar .env de forma manual y robusta si dotenv no estuviera presente
env_file = os.path.join(PROJECT_ROOT, ".env")
if os.path.exists(env_file):
    try:
        with open(env_file, 'r', encoding='utf-8') as f_env:
            for line in f_env:
                line = line.strip()
                if line and not line.startswith('#') and '=' in line:
                    k, v = line.split('=', 1)
                    k = k.strip()
                    v = v.strip().strip('"').strip("'")
                    if k and k not in os.environ:
                        os.environ[k] = v
    except Exception:
        pass

# Auto-detectar y usar el entorno virtual si se ejecutó con el python global del sistema
if os.environ.get('_RESTORE_LOCK_VENV_ACTIVATED') != '1':
    in_venv = (sys.prefix != getattr(sys, 'base_prefix', sys.prefix)) or hasattr(sys, 'real_prefix')
    if not in_venv:
        candidates = [
            os.path.join(PROJECT_ROOT, "venv", "bin", "python3"),
            os.path.join(PROJECT_ROOT, "venv", "bin", "python"),
            os.path.join(PROJECT_ROOT, ".venv", "bin", "python3"),
            os.path.join(PROJECT_ROOT, ".venv", "bin", "python"),
            os.path.join(PROJECT_ROOT, "venv", "Scripts", "python.exe"),
            os.path.join(PROJECT_ROOT, ".venv", "Scripts", "python.exe"),
        ]
        for cand in candidates:
            if os.path.exists(cand):
                print(f"🔄 Activando entorno virtual de producción: {cand}")
                os.environ['_RESTORE_LOCK_VENV_ACTIVATED'] = '1'
                try:
                    os.execv(cand, [cand] + sys.argv)
                except Exception as e_reexec:
                    print(f"ℹ️ Aviso al ejecutar venv: {e_reexec}")
                break


def main():
    print("=" * 60)
    print("🛡️ INICIANDO RESTAURACIÓN Y BLINDAJE SOBERANO DE ESTRATEGIA...")
    print("=" * 60)

    # 1. Inicializar esquema de Base de Datos
    try:
        from src.database import get_active_strategy_from_db, set_active_strategy_in_db, set_bot_setting, init_db_schema
        init_db_schema()
    except Exception as e_init:
        print(f"❌ Error al inicializar esquema de base de datos: {e_init}")
        sys.exit(1)

    # 2. Respetar la estrategia soberana activa que el usuario configuró en DB o config.ini
    strat_name = get_active_strategy_from_db()

    config_file = os.path.join(PROJECT_ROOT, "config.ini")
    tmp_file = os.path.join(PROJECT_ROOT, "config.ini.tmp")
    cp = None
    if os.path.exists(config_file):
        try:
            import configparser
            cp = configparser.ConfigParser(allow_no_value=True)
            if os.path.exists(tmp_file):
                cp.read([config_file, tmp_file], encoding='utf-8')
            else:
                cp.read(config_file, encoding='utf-8')
            if not strat_name or strat_name.lower() == 'global':
                strat_name = cp.get('STRATEGY_INFO', 'active_strategy_name', fallback='').strip()
        except Exception as e_cfg_rd:
            print(f"ℹ️ Aviso al leer config.ini: {e_cfg_rd}")

    if not strat_name or strat_name.lower() == 'global':
        try:
            from src.config_loader import get_strategy_for_symbol
            strat_name = get_strategy_for_symbol('BTCUSDT')
        except Exception:
            strat_name = 'v18_v17_RSI-SNIPER-MOMENTUM_con12xyTS5c3_SL500_3DCA2_ReDi5c5'

    print(f"✅ Estrategia activa soberana preservada: '{strat_name}'")

    # 3. Sincronizar active_strategy_name en config.ini SIN tocar los parámetros del usuario (SL, TP, etc.)
    if cp is not None and os.path.exists(config_file):
        try:
            if not cp.has_section('STRATEGY_INFO'):
                cp.add_section('STRATEGY_INFO')
            cp.set('STRATEGY_INFO', 'active_strategy_name', strat_name)

            if not cp.has_section('TRADING'):
                cp.add_section('TRADING')
            cp.set('TRADING', 'active_strategy_name', strat_name)

            with open(config_file, 'w', encoding='utf-8') as f:
                cp.write(f)
            print(f"✅ config.ini sincronizado con la estrategia activa: '{strat_name}'.")
        except Exception as e_cfg:
            print(f"ℹ️ Aviso al actualizar config.ini: {e_cfg}")

    # 4. Aplicar skip-worktree para que Git NUNCA MÁS sobreescriba config.ini
    res_skip = os.system("git update-index --skip-worktree config.ini 2>/dev/null")
    if res_skip == 0:
        print("✅ Protección skip-worktree activada: Git ignorará config.ini para siempre.")
    else:
        print("ℹ️ Aviso al aplicar skip-worktree.")

    # 5. Blindar en Base de Datos preservando soberanía
    try:
        set_active_strategy_in_db(strat_name)
        set_bot_setting("active_strategy_name", strat_name)

        try:
            from src.api_server import _seed_strategies_catalog_from_files
            _seed_strategies_catalog_from_files()
            print("✅ Catálogo soberano de estrategias sincronizado y blindado en base de datos.")
        except Exception as e_seed:
            print(f"ℹ️ Aviso al sembrar catálogo: {e_seed}")

        print("✅ BASE DE DATOS SOBERANA ASEGURADA:")
        print(f"   -> Estrategia Activa: {strat_name}")
        print("   -> Parámetros de Trading: 100% Preservados del panel de usuario")
    except Exception as e:
        print(f"❌ Error guardando en base de datos: {e}")
        sys.exit(1)

    print("=" * 60)
    print("🎉 BLINDAJE SOBERANO COMPLETADO EXITOSAMENTE")
    print("=" * 60)


if __name__ == '__main__':
    main()
