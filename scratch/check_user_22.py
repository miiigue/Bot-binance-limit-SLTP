import paramiko
import io

ssh = paramiko.SSHClient()
ssh.set_missing_host_key_policy(paramiko.AutoAddPolicy())
ssh.connect('178.105.192.140', username='root', password='Botbinance1253', timeout=15)

script = '''
import sys
sys.path.insert(0, '/opt/bot-binance')
import json
from src.database import get_db_connection

conn = get_db_connection()
cur = conn.cursor()

cur.execute("SELECT * FROM strategies_catalog WHERE name = '22_AGRESIVA_TOLERANTE_30S'")
cols = [desc[0] for desc in cur.description]
print("COLS:", cols)
row = cur.fetchone()
for c, v in zip(cols, row):
    if c == 'config_json' or c == 'parameters' or c == 'params' or 'json' in c or isinstance(v, (dict, str)) and '{' in str(v):
        print(f"COL {c}:")
        try:
            d = v if isinstance(v, dict) else json.loads(v)
            for k in ['stop_loss_usdt', 'take_profit_usdt', 'position_size_usdt', 'allocated_usdt', 'leverage', 'enable_dca_reentry', 'dca_reentry_mode', 'dca_max_reentries', 'dca_trigger_loss_usdt', 'dca_price_drop_percent', 'dca_volume_multiplier', 'enable_stop_loss_pnl']:
                print(f"   {k} = {d.get(k)}")
        except Exception as e:
            print(f"   error: {e}")
    else:
        print(f"{c}: {v}")
'''

sftp = ssh.open_sftp()
sftp.putfo(io.BytesIO(script.encode('utf-8')), '/tmp/check22.py')
sftp.close()

cmd = "cd /opt/bot-binance && ./venv/bin/python3 /tmp/check22.py"
stdin, stdout, stderr = ssh.exec_command(cmd, timeout=30)
out = stdout.read().decode('utf-8', errors='replace')
print(out)
ssh.close()
