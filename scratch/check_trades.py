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
cur.execute("SELECT id, user_id, symbol, trade_type, open_price, close_price, pnl_usdt, open_timestamp, close_timestamp, close_reason FROM user_trades WHERE user_id = 5 ORDER BY id DESC;")
rows = cur.fetchall()
print('USER 5 TRADES COUNT:', len(rows))
for r in rows:
    print(dict(r))
conn.close()
"""

sftp = ssh.open_sftp()
with sftp.file('/tmp/check_trades.py', 'w') as f:
    f.write(py_code)
sftp.close()

stdin, stdout, stderr = ssh.exec_command('cd /opt/bot-binance && ./venv/bin/python3 /tmp/check_trades.py')
print(stdout.read().decode())
print(stderr.read().decode())
ssh.close()
