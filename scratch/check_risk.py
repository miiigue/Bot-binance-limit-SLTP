import paramiko

ssh = paramiko.SSHClient()
ssh.set_missing_host_key_policy(paramiko.AutoAddPolicy())
ssh.connect('178.105.192.140', username='root', password='Botbinance1253', timeout=10)

cmd = """cd /opt/bot-binance && ./venv/bin/python3 -c "
from src.database import get_user_bot_settings, get_user_api_keys
from src.multitenant_dispatcher import get_cached_user_client
settings = get_user_bot_settings(5)
keys = get_user_api_keys(5, decrypt=True)
user_dict = {'user_id': 5, 'api_key': keys['api_key'], 'api_secret': keys['api_secret'], 'is_testnet': bool(keys.get('is_testnet', False))}
client = get_cached_user_client(user_dict)
positions = client.get_position_risk()
for p in positions:
    amt = float(p.get('positionAmt', 0))
    if abs(amt) > 1e-6:
        print(p.get('symbol'), 'amt:', amt, 'leverage in p:', p.get('leverage'), 'keys in p:', list(p.keys()))
        break
print('user settings leverage:', settings.get('leverage'), 'strategy_name:', settings.get('strategy_name'))
" """

stdin, stdout, stderr = ssh.exec_command(cmd)
out = stdout.read().decode('utf-8', errors='replace')
print("=== OUTPUT ===")
print(out.encode('ascii', errors='replace').decode('ascii'))
err = stderr.read().decode('utf-8', errors='replace')
if err:
    print("=== ERR ===")
    print(err.encode('ascii', errors='replace').decode('ascii'))
ssh.close()
