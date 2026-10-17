import paramiko, json

ssh = paramiko.SSHClient()
ssh.set_missing_host_key_policy(paramiko.AutoAddPolicy())
ssh.connect('178.105.192.140', username='root', password='Botbinance1253', timeout=20)

cmd = """cd /opt/bot-binance && ./venv/bin/python3 -c "
import urllib.request, json
req = urllib.request.Request('http://127.0.0.1:5002/api/status')
try:
    with urllib.request.urlopen(req) as resp:
        data = json.loads(resp.read().decode('utf-8'))
        print('STATUS API keys:', {k: data.get(k) for k in ['account_balance', 'initial_capital', 'wallet_pnl', 'total_unrealized_pnl', 'global_db_metrics']})
except Exception as e:
    print('Error status:', e)
"
"""

stdin, stdout, stderr = ssh.exec_command(cmd, timeout=30)
out = stdout.read().decode('utf-8', errors='replace')
print("OUTPUT:\n", out)
ssh.close()
