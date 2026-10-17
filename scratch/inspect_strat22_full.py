import paramiko

ssh = paramiko.SSHClient()
ssh.set_missing_host_key_policy(paramiko.AutoAddPolicy())
ssh.connect('178.105.192.140', username='root', password='Botbinance1253', timeout=20)

cmd = """cd /opt/bot-binance && ./venv/bin/python3 -c "
import json
from src.database import get_db_connection
conn = get_db_connection()
cur = conn.cursor()
cur.execute('SELECT id, name, parameters_json FROM strategies_catalog WHERE name ILIKE ?', ('%22%',))
rows = cur.fetchall()
for r in rows:
    p_json = r['parameters_json'] if isinstance(r, dict) else r[2]
    name = r['name'] if isinstance(r, dict) else r[1]
    p = json.loads(p_json) if p_json else {}
    print('NAME:', name)
    print('KEYS WITH 125 OR 500:')
    for k, v in p.items():
        if v in (125, 500, '125', '500', 100, 150, 200, 300, 30, 55):
            print(f'  {k} = {v}')
conn.close()
"
"""

stdin, stdout, stderr = ssh.exec_command(cmd, timeout=30)
print("OUTPUT:\n", stdout.read().decode('utf-8', errors='replace'))
print("STDERR:\n", stderr.read().decode('utf-8', errors='replace'))
ssh.close()
