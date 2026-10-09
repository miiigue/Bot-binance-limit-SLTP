import paramiko

ssh = paramiko.SSHClient()
ssh.set_missing_host_key_policy(paramiko.AutoAddPolicy())
ssh.connect('178.105.192.140', username='root', password='Botbinance1253', timeout=10)

cmd = """cd /opt/bot-binance && ./venv/bin/python3 -c "
from src.database import get_user_bot_settings
from src.multitenant_dispatcher import load_strategy_params
settings = get_user_bot_settings(5)
sname = settings.get('strategy_name')
print('sname:', sname)
params = load_strategy_params(sname)
print('leverage in params:', params.get('leverage'))
print('allocated_usdt:', settings.get('allocated_usdt'))
print('user leverage in settings:', settings.get('leverage'))
" """

stdin, stdout, stderr = ssh.exec_command(cmd)
out = stdout.read().decode('utf-8', errors='replace')
err = stderr.read().decode('utf-8', errors='replace')
print("OUT:", out)
if err:
    print("ERR:", err)
ssh.close()
