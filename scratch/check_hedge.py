import paramiko

ssh = paramiko.SSHClient()
ssh.set_missing_host_key_policy(paramiko.AutoAddPolicy())
ssh.connect('178.105.192.140', username='root', password='Botbinance1253', timeout=20)

cmd = """
cd /opt/bot-binance && ./venv/bin/python3 -c "
from src.database import get_all_active_bot_users
from src.multitenant_dispatcher import get_cached_user_client
from binance.error import ClientError

users = get_all_active_bot_users('PERSONAL_BOT')
for u in users:
    print('USER:', u['user_id'], u['username'])
    client = get_cached_user_client(u)
    try:
        res = client.change_position_mode(dualSidePosition='true')
        print('CHANGE TO HEDGE RES:', res)
    except ClientError as ce:
        print('CLIENT ERROR:', ce.error_code, ce.error_message)
    except Exception as e:
        print('ERROR:', e)
"
"""
stdin, stdout, stderr = ssh.exec_command(cmd)
print(stdout.read().decode('utf-8'))
print(stderr.read().decode('utf-8'))
ssh.close()
