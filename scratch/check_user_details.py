import paramiko

ssh = paramiko.SSHClient()
ssh.set_missing_host_key_policy(paramiko.AutoAddPolicy())
ssh.connect('178.105.192.140', username='root', password='Botbinance1253', timeout=20)

cmd = """cd /opt/bot-binance && ./venv/bin/python3 -c "
from src.database import get_db_connection
conn = get_db_connection()
cur = conn.cursor()
cur.execute('SELECT * FROM users WHERE id = 9')
user_row = cur.fetchone()
print('USER ROW:', dict(user_row) if hasattr(user_row, 'keys') else user_row)
cur.execute('SELECT * FROM user_api_keys WHERE user_id = 9')
keys_row = cur.fetchone()
print('KEYS ROW:', dict(keys_row) if hasattr(keys_row, 'keys') else keys_row)
cur.execute('SELECT * FROM user_bot_settings WHERE user_id = 9')
bot_row = cur.fetchone()
print('BOT ROW:', dict(bot_row) if hasattr(bot_row, 'keys') else bot_row)
conn.close()
"
"""

stdin, stdout, stderr = ssh.exec_command(cmd, timeout=30)
out = stdout.read().decode('utf-8', errors='replace')
print("OUTPUT:\n", out)
ssh.close()
