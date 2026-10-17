import paramiko

ssh = paramiko.SSHClient()
ssh.set_missing_host_key_policy(paramiko.AutoAddPolicy())
ssh.connect('178.105.192.140', username='root', password='Botbinance1253', timeout=20)

cmd = """cd /opt/bot-binance && ./venv/bin/python3 -c "
from src.multitenant_dispatcher import get_user_monitor_status
data = get_user_monitor_status(9)
syms = [s['symbol'] for s in data.get('symbols', [])]
print('Total symbols returned:', len(syms))
print('Symbols list:', syms)
"
"""

stdin, stdout, stderr = ssh.exec_command(cmd, timeout=30)
print("OUTPUT:\n", stdout.read().decode('utf-8', errors='replace'))
print("STDERR:\n", stderr.read().decode('utf-8', errors='replace'))
ssh.close()
