import paramiko
import json

ssh = paramiko.SSHClient()
ssh.set_missing_host_key_policy(paramiko.AutoAddPolicy())
ssh.connect('178.105.192.140', username='root', key_filename=r'C:\Users\Nenas bellas\.ssh\id_rsa')

remote_script = """
import urllib.request, json
login_data = json.dumps({'email':'test8@test.com','password':'test8123'}).encode()
req = urllib.request.Request('http://127.0.0.1:8000/api/login', data=login_data, headers={'Content-Type':'application/json'})
token = json.loads(urllib.request.urlopen(req).read().decode())['access_token']

req_bot = urllib.request.Request('http://127.0.0.1:8000/api/user/bot', headers={'Authorization': 'Bearer ' + token})
bot_data = json.loads(urllib.request.urlopen(req_bot).read().decode())
print('=== WALLET BREAKDOWN ===')
print(json.dumps(bot_data.get('wallet_breakdown', {}), indent=2))

req_t = urllib.request.Request('http://127.0.0.1:8000/api/user/trades', headers={'Authorization': 'Bearer ' + token})
trades = json.loads(urllib.request.urlopen(req_t).read().decode())
print('=== OPEN TRADES COUNT:', len(trades.get('open_trades', [])), '===')
for o in trades.get('open_trades', []):
    print(f"  ID:{o['id']} | {o['symbol']} | {o['side']} | Entry:{o['entry_price']} | Qty:{o['quantity']} | Status:{o['status']}")

print('=== RECENT CLOSED TRADES COUNT:', len(trades.get('closed_trades', [])), '===')
for c in trades.get('closed_trades', [])[:5]:
    print(f"  ID:{c['id']} | {c['symbol']} | {c['side']} | Entry:{c['entry_price']} | Close:{c['close_price']} | PnL:{c.get('pnl_usdt')} USDT")
"""

stdin, stdout, stderr = ssh.exec_command(f"python3 -c {json.dumps(remote_script)}")
print(stdout.read().decode())
err = stderr.read().decode()
if err:
    print('ERR:', err)
ssh.close()
