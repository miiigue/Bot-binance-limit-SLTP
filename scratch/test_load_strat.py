import paramiko
import io

ssh = paramiko.SSHClient()
ssh.set_missing_host_key_policy(paramiko.AutoAddPolicy())
ssh.connect('178.105.192.140', username='root', password='Botbinance1253', timeout=15)

script = '''
import sys
sys.path.insert(0, '/opt/bot-binance')
import json
from src.multitenant_dispatcher import load_strategy_params

params = load_strategy_params('22_AGRESIVA_TOLERANTE_30S')
print("LOADED PARAMS FOR 22:")
for k, v in sorted(params.items()):
    print(f"  {k} = {v}")
'''

sftp = ssh.open_sftp()
sftp.putfo(io.BytesIO(script.encode('utf-8')), '/tmp/test_load.py')
sftp.close()

cmd = "cd /opt/bot-binance && ./venv/bin/python3 /tmp/test_load.py"
stdin, stdout, stderr = ssh.exec_command(cmd, timeout=30)
out = stdout.read().decode('utf-8', errors='replace')
err = stderr.read().decode('utf-8', errors='replace')
print("STDOUT:\n", out)
if err:
    print("STDERR:\n", err)
ssh.close()
