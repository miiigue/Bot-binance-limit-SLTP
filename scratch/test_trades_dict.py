import paramiko
import json

ssh = paramiko.SSHClient()
ssh.set_missing_host_key_policy(paramiko.AutoAddPolicy())
ssh.connect('178.105.192.140', username='root', password='Botbinance1253', timeout=15)

py_code = """
import sys, json
sys.path.insert(0, '/opt/bot-binance')
from src.database import get_user_trades
trades = get_user_trades(5, limit=3)
for t in trades:
    print('TRADE:', json.dumps(t, default=str))
"""

sftp = ssh.open_sftp()
with sftp.file('/tmp/test_trades_dict.py', 'w') as f:
    f.write(py_code)
sftp.close()

stdin, stdout, stderr = ssh.exec_command('cd /opt/bot-binance && ./venv/bin/python3 /tmp/test_trades_dict.py')
print(stdout.read().decode('ascii', errors='replace'))
print(stderr.read().decode('ascii', errors='replace'))
ssh.close()
