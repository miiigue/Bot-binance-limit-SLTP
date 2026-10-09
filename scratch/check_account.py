import paramiko

ssh = paramiko.SSHClient()
ssh.set_missing_host_key_policy(paramiko.AutoAddPolicy())
ssh.connect('178.105.192.140', username='root', password='Botbinance1253', timeout=15)

py_code = """
import sys
sys.path.insert(0, '/opt/bot-binance')
from src.database import get_user_api_keys, get_user_bot_settings
from binance.um_futures import UMFutures

keys = get_user_api_keys(5)
settings = get_user_bot_settings(5)

client = UMFutures(
    key=keys['api_key'],
    secret=keys['api_secret'],
    base_url=keys.get('api_base_url') or 'https://demo-fapi.binance.com'
)

acc = client.account()
print('=== BINANCE FUTURES ACCOUNT INFO FOR USER 5 ===')
print('totalWalletBalance:', acc.get('totalWalletBalance'))
print('totalMarginBalance:', acc.get('totalMarginBalance'))
print('totalUnrealizedProfit:', acc.get('totalUnrealizedProfit'))
print('availableBalance:', acc.get('availableBalance'))
print('totalInitialMargin:', acc.get('totalInitialMargin'))
print('totalMaintMargin:', acc.get('totalMaintMargin'))
print('totalPositionInitialMargin:', acc.get('totalPositionInitialMargin'))
print('totalOpenOrderInitialMargin:', acc.get('totalOpenOrderInitialMargin'))

print('\\n=== ASSETS ===')
for a in acc.get('assets', []):
    if float(a.get('walletBalance', 0)) > 0 or float(a.get('marginBalance', 0)) > 0:
        print(a['asset'], 'wallet:', a.get('walletBalance'), 'avail:', a.get('availableBalance'), 'margin:', a.get('initialMargin'), 'unPnl:', a.get('unrealizedProfit'))

print('\\n=== POSITIONS (non-zero) ===')
for p in acc.get('positions', []):
    amt = float(p.get('positionAmt', 0))
    if abs(amt) > 0:
        print(p['symbol'], 'amt:', amt, 'entry:', p.get('entryPrice'), 'initialMargin:', p.get('initialMargin'), 'unPnl:', p.get('unrealizedProfit'), 'leverage:', p.get('leverage'))
"""

sftp = ssh.open_sftp()
with sftp.file('/tmp/check_account.py', 'w') as f:
    f.write(py_code)
sftp.close()

stdin, stdout, stderr = ssh.exec_command('cd /opt/bot-binance && ./venv/bin/python3 /tmp/check_account.py')
print(stdout.read().decode())
print(stderr.read().decode())
ssh.close()
