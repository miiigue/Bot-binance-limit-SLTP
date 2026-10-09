import paramiko

ssh = paramiko.SSHClient()
ssh.set_missing_host_key_policy(paramiko.AutoAddPolicy())
ssh.connect('178.105.192.140', username='root', password='Botbinance1253', timeout=10)

cmd = """cd /opt/bot-binance && ./venv/bin/python3 -c "
from src.database import get_db_connection
conn = get_db_connection()
cur = conn.cursor()

# 1. Reparar trade_type
cur.execute('''
    UPDATE user_trades
    SET trade_type = CASE WHEN close_reason LIKE '%SHORT%' THEN 'SHORT' ELSE 'LONG' END
    WHERE trade_type = 'TRADE' OR trade_type IS NULL OR trade_type = ''
''')

# 2. Reparar quantity y position_size_usdt en filas con 0
cur.execute('''
    UPDATE user_trades
    SET position_size_usdt = 995.0,
        quantity = CASE WHEN open_price > 0 THEN ROUND(CAST(995.0 / open_price AS numeric), 4) ELSE 1.0 END
    WHERE quantity <= 0 OR position_size_usdt <= 0
''')

conn.commit()

# 3. Mostrar filas reparadas
cur.execute('SELECT id, user_id, symbol, trade_type, quantity, position_size_usdt, pnl_usdt, close_reason FROM user_trades ORDER BY id DESC LIMIT 10')
for row in cur.fetchall():
    print(dict(row))

conn.close()
" """

stdin, stdout, stderr = ssh.exec_command(cmd)
out = stdout.read().decode('utf-8', errors='replace')
print("=== OUTPUT ===")
print(out.encode('ascii', errors='replace').decode('ascii'))
err = stderr.read().decode('utf-8', errors='replace')
if err:
    print("=== ERR ===")
    print(err.encode('ascii', errors='replace').decode('ascii'))
ssh.close()
