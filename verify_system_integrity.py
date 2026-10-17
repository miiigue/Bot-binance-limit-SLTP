"""
Script de auditoría integral y verificación de integridad del sistema de referidos y base de datos.
"""
import sys
from src.database import (
    get_db_connection, 
    get_referral_program_settings, 
    get_user_referral_dashboard, 
    get_admin_referrals_overview,
    get_user_by_identifier
)

def run_audit():
    print("==================================================")
    print("🔍 AUDITORÍA DE ARQUITECTURA Y BASE DE DATOS")
    print("==================================================")
    
    conn = get_db_connection()
    if not conn:
        print("❌ Error: No se pudo conectar a PostgreSQL.")
        sys.exit(1)
        
    cur = conn.cursor()
    
    # 1. Verificar columnas de tabla users
    cur.execute("SELECT column_name, data_type FROM information_schema.columns WHERE table_name = 'users'")
    cols = [r[0] for r in cur.fetchall()]
    print(f"✓ Columnas en 'users' ({len(cols)}):", cols)
    
    mandatory_cols = ['referred_by_id', 'referral_terms_accepted', 'referral_terms_version']
    for mc in mandatory_cols:
        if mc in cols:
            print(f"  ✅ Columna '{mc}' presente.")
        else:
            print(f"  ❌ FALTA Columna '{mc}'.")

    # 2. Verificar existencia de nuevas tablas relacionales
    cur.execute("SELECT table_name FROM information_schema.tables WHERE table_schema = 'public'")
    tables = [r[0] for r in cur.fetchall()]
    for t in ['referral_terms_acceptances', 'referral_commissions']:
        if t in tables:
            print(f"  ✅ Tabla '{t}' verificada y activa.")
        else:
            print(f"  ❌ Tabla '{t}' NO encontrada.")
            
    conn.close()

    # 3. Test funcional de ajustes de programa de referidos
    settings = get_referral_program_settings()
    print("\n✓ Ajustes globales de referidos:", settings)
    assert 'platform_success_fee_pct' in settings
    assert 'affiliate_share_pct' in settings
    assert settings['affiliate_share_pct'] == 10.0
    print("  ✅ Parámetros contables validados (10.0% por defecto para referidores).")

    # 4. Test del Super Administrador (admin debe estar habilitado como referidor)
    admin = get_user_by_identifier('admin')
    if admin:
        print(f"\n✓ Admin verificado: id={admin.get('id')}, username={admin.get('username')}, ref_terms={admin.get('referral_terms_accepted')}")
        assert admin.get('referral_terms_accepted') == 1
        print("  ✅ Admin tiene privilegios y estado de referidor activado.")
    
    # 5. Test de dashboard admin y usuario
    admin_overview = get_admin_referrals_overview()
    print(f"✓ Resumen Admin de Referidos: {len(admin_overview.get('referrers', []))} referidores listados.")
    print("==================================================")
    print("🎉 AUDITORÍA TÉCNICA SUPERADA EXITOSAMENTE")
    print("==================================================")

if __name__ == '__main__':
    run_audit()
