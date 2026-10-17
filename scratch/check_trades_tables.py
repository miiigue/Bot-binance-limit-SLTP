import paramiko

ssh = paramiko.SSHClient()
ssh.set_missing_host_key_policy(paramiko.AutoAddPolicy())
ssh.connect('178.105.192.140', username='root', password='Botbinance1253', timeout=20)

cmd = """cd /opt/bot-binance && ./venv/bin/python3 -c "
from src.database import get_db_connection
conn = get_db_connection()
cur = conn.cursor()

# All trades for user 9
cur.execute('''
    SELECT COUNT(*),
           SUM(CASE WHEN pnl_usdt > 0 THEN 1 ELSE 0 END) as wins,
           SUM(CASE WHEN pnl_usdt < 0 THEN 1 ELSE 0 END) as losses,
           SUM(pnl_usdt) as net_pnl,
           SUM(commission_usdt) as comm,
           SUM(CASE WHEN pnl_usdt > 0 THEN pnl_usdt ELSE 0 END) as win_sum,
           SUM(CASE WHEN pnl_usdt < 0 THEN abs(pnl_usdt) ELSE 0 END) as loss_sum
    FROM user_trades
    WHERE user_id = 9 AND close_timestamp IS NOT NULL
''')
print('ALL user_trades:', dict(cur.fetchone()))

# All trades in global trades table?
cur.execute('''
    SELECT COUNT(*),
           SUM(CASE WHEN pnl_usdt > 0 THEN 1 ELSE 0 END) as wins,
           SUM(CASE WHEN pnl_usdt < 0 THEN 1 ELSE 0 END) as losses,
           SUM(pnl_usdt) as net_pnl,
           SUM(commission_usdt) as comm,
           SUM(CASE WHEN pnl_usdt > 0 THEN pnl_usdt ELSE 0 END) as win_sum,
           SUM(CASE WHEN pnl_usdt < 0 THEN abs(pnl_usdt) ELSE 0 END) as loss_sum
    FROM trades
''')
print('ALL global trades:', dict(cur.fetchone()))

conn.close()
"
"""

stdin, stdout, stderr = ssh.exec_command(cmd, timeout=30)
out = stdout.read().decode('utf-8', errors='replace')
print("OUTPUT:\n", out)
ssh.close()
