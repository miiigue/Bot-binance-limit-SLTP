import paramiko

ssh = paramiko.SSHClient()
ssh.set_missing_host_key_policy(paramiko.AutoAddPolicy())
ssh.connect('178.105.192.140', username='root', password='Botbinance1253', timeout=20)

cmd = """cd /opt/bot-binance && ./venv/bin/python3 -c "
from src.database import get_db_connection, get_user_api_keys, get_user_bot_settings, get_user_trading_metrics
conn = get_db_connection()
cur = conn.cursor()
cur.execute('SELECT id, username, role, email, status FROM users WHERE username ILIKE ?', ('%quiero%',))
users = cur.fetchall()
print('Users found:', users)
for u in users:
    uid = u['id'] if isinstance(u, dict) else u[0]
    print(f'\\n--- User {uid} ---')
    keys = get_user_api_keys(uid, decrypt=True)
    if keys:
        print('API Keys:', {k: v for k, v in keys.items() if k != 'api_secret'})
    settings = get_user_bot_settings(uid)
    print('Bot Settings:', settings)
    metrics = get_user_trading_metrics(uid)
    print('Trading Metrics:', metrics)
    cur.execute('SELECT * FROM investor_transactions WHERE user_id = ?', (uid,))
    txs = cur.fetchall()
    print('Transactions:', txs)
    cur.execute('SELECT COUNT(*), SUM(pnl_usdt) FROM user_trades WHERE user_id = ?', (uid,))
    trades_summary = cur.fetchall()
    print('User Trades Summary:', trades_summary)
conn.close()
"
"""

stdin, stdout, stderr = ssh.exec_command(cmd, timeout=30)
out = stdout.read().decode('utf-8', errors='replace')
err = stderr.read().decode('utf-8', errors='replace')
print("OUTPUT:\n", out)
if err:
    print("STDERR:\n", err)
ssh.close()
