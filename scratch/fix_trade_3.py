import paramiko

ssh = paramiko.SSHClient()
ssh.set_missing_host_key_policy(paramiko.AutoAddPolicy())
ssh.connect('178.105.192.140', username='root', password='Botbinance1253', timeout=15)

py_code = """
import sys
sys.path.insert(0, '/opt/bot-binance')
from src.database import get_db_connection

conn = get_db_connection()
cur = conn.cursor()

# 1. Actualizar trade #3 con el cierre real de XMRUSDT
cur.execute('''
    UPDATE user_trades 
    SET close_price = 552.68,
        close_timestamp = '2026-10-07 19:28:31',
        pnl_usdt = -0.36094,
        close_reason = 'Trailing Stop Asegurado (-0.36 USDT) (Bot Personal)'
    WHERE id = 3;
''')

# 2. Eliminar el trade duplicado #4
cur.execute('DELETE FROM user_trades WHERE id = 4;')

conn.commit()

# 3. Verificar estado actual de user_trades para usuario 5
cur.execute('''
    SELECT id, symbol, trade_type, open_price, close_price, pnl_usdt, 
           open_timestamp, close_timestamp, 
           CASE WHEN close_timestamp IS NULL THEN 'EN CURSO' ELSE 'CERRADO' END as estado
    FROM user_trades 
    WHERE user_id = 5 
    ORDER BY id DESC;
''')
rows = cur.fetchall()
print('=== TRADES ACTUALIZADOS PARA USUARIO 5 ===')
for r in rows:
    print(dict(r))

conn.close()
"""

sftp = ssh.open_sftp()
with sftp.file('/tmp/fix_trades.py', 'w') as f:
    f.write(py_code)
sftp.close()

stdin, stdout, stderr = ssh.exec_command('cd /opt/bot-binance && ./venv/bin/python3 /tmp/fix_trades.py')
print(stdout.read().decode())
print(stderr.read().decode())
ssh.close()
