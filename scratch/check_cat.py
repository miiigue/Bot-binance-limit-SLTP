import paramiko

ssh = paramiko.SSHClient()
ssh.set_missing_host_key_policy(paramiko.AutoAddPolicy())
ssh.connect('178.105.192.140', username='root', password='Botbinance1253', timeout=10)

cmd = """cd /opt/bot-binance && ./venv/bin/python3 -c "
from src.database import get_db_connection
import json
conn = get_db_connection()
cur = conn.cursor()
cur.execute('SELECT name, parameters FROM strategies_catalog')
for row in cur.fetchall():
    if 'v18' in row['name']:
        params = row['parameters']
        if isinstance(params, str):
            params = json.loads(params)
        print('FOUND:', row['name'], 'leverage:', params.get('leverage'))
conn.close()
" """

stdin, stdout, stderr = ssh.exec_command(cmd)
print("OUT:", stdout.read().decode('utf-8', errors='replace'))
print("ERR:", stderr.read().decode('utf-8', errors='replace'))
ssh.close()
