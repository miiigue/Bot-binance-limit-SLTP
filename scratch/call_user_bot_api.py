import paramiko

ssh = paramiko.SSHClient()
ssh.set_missing_host_key_policy(paramiko.AutoAddPolicy())
ssh.connect('178.105.192.140', username='root', password='Botbinance1253', timeout=20)

cmd = """cd /opt/bot-binance && ./venv/bin/python3 -c "
from src.api_server import app
from src.auth import generate_jwt
import json

token = generate_jwt(user_id=1, username='admin', role='admin')
with app.test_client() as c:
    resp = c.get('/api/user/bot?user_id=9', headers={'Authorization': f'Bearer {token}'})
    data = resp.get_json()
    print('USER BOT 9 DATA:')
    print(json.dumps(data, indent=2))
"
"""

stdin, stdout, stderr = ssh.exec_command(cmd, timeout=30)
out = stdout.read().decode('utf-8', errors='replace')
print("OUTPUT:\n", out.encode('ascii', errors='replace').decode('ascii'))
ssh.close()
