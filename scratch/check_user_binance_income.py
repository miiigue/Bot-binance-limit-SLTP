import paramiko

ssh = paramiko.SSHClient()
ssh.set_missing_host_key_policy(paramiko.AutoAddPolicy())
ssh.connect('178.105.192.140', username='root', password='Botbinance1253', timeout=20)

cmd = """cd /opt/bot-binance && ./venv/bin/python3 -c "
from src.database import get_user_api_keys
from src.binance_client import get_user_futures_client
import json

keys = get_user_api_keys(9, decrypt=True)
client = get_user_futures_client(keys['api_key'], keys['api_secret'], is_testnet=True, base_url=keys['api_base_url'])
acc = client.account()
print('ACCOUNT:')
print('totalWalletBalance:', acc.get('totalWalletBalance'))
print('totalUnrealizedProfit:', acc.get('totalUnrealizedProfit'))
print('totalInitialMargin:', acc.get('totalInitialMargin'))
print('availableBalance:', acc.get('availableBalance'))

try:
    income = client.get_income_history(limit=50)
    print('\\nINCOME COUNT:', len(income))
    types = {}
    for item in income:
        t = item.get('incomeType')
        types[t] = types.get(t, 0) + float(item.get('income', 0))
    print('INCOME BY TYPE:', types)
except Exception as e:
    print('Error income:', e)
"
"""

stdin, stdout, stderr = ssh.exec_command(cmd, timeout=30)
out = stdout.read().decode('utf-8', errors='replace')
print("OUTPUT:\n", out.encode('ascii', errors='replace').decode('ascii'))
ssh.close()
