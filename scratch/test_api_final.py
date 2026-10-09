import paramiko

ssh = paramiko.SSHClient()
ssh.set_missing_host_key_policy(paramiko.AutoAddPolicy())
ssh.connect('178.105.192.140', username='root', password='Botbinance1253', timeout=15)

py_code = """
import sys, json, urllib.request
sys.path.insert(0, '/opt/bot-binance')
from src.database import get_user_by_id
from src.auth import generate_jwt

user = get_user_by_id(5)
token = generate_jwt(user_id=user['id'], username=user['username'], role=user['role'])

req = urllib.request.Request('http://127.0.0.1:5002/api/user/bot', headers={'Authorization': f'Bearer {token}'})
with urllib.request.urlopen(req) as resp:
    data = json.loads(resp.read().decode())
    print('=== API /api/user/bot RESPONSE ===')
    print('balance_usdt:', data.get('balance_usdt'))
    print('wallet_breakdown:', json.dumps(data.get('wallet_breakdown'), indent=2))

req2 = urllib.request.Request('http://127.0.0.1:5002/api/user/trades?mode=PERSONAL_BOT', headers={'Authorization': f'Bearer {token}'})
with urllib.request.urlopen(req2) as resp:
    t_data = json.loads(resp.read().decode())
    print('\\n=== API /api/user/trades RESPONSE ===')
    trades = t_data.get('trades', [])
    print('Total trades:', len(trades))
    open_t = [t for t in trades if not t.get('close_timestamp')]
    closed_t = [t for t in trades if t.get('close_timestamp')]
    print(f'En curso ({len(open_t)}):', [(t['id'], t['symbol'], t['trade_type']) for t in open_t])
    print(f'Cerrados ({len(closed_t)}):', [(t['id'], t['symbol'], round(float(t['pnl_usdt'] or 0), 4)) for t in closed_t])
"""

sftp = ssh.open_sftp()
with sftp.file('/tmp/test_api_final.py', 'w') as f:
    f.write(py_code)
sftp.close()

stdin, stdout, stderr = ssh.exec_command('cd /opt/bot-binance && ./venv/bin/python3 /tmp/test_api_final.py')
print(stdout.read().decode())
print(stderr.read().decode())
ssh.close()
