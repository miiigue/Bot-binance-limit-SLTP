import paramiko

ssh = paramiko.SSHClient()
ssh.set_missing_host_key_policy(paramiko.AutoAddPolicy())
ssh.connect('178.105.192.140', username='root', password='Botbinance1253', timeout=10)

cmd = """cd /opt/bot-binance && ./venv/bin/python3 -c "
from src.database import get_user_trades
trades = get_user_trades(5, limit=5)
for t in trades:
    print(t['id'], t['symbol'], t['trade_type'], t['quantity'], t['position_value_usdt'], t['margin_usdt'], t['pnl_usdt'])
" """

stdin, stdout, stderr = ssh.exec_command(cmd)
out = stdout.read().decode('utf-8', errors='replace')
print(out.encode('ascii', errors='replace').decode('ascii'))
ssh.close()
