import paramiko

ssh = paramiko.SSHClient()
ssh.set_missing_host_key_policy(paramiko.AutoAddPolicy())
ssh.connect('178.105.192.140', username='root', password='Botbinance1253', timeout=20)

cmd = "cd /opt/bot-binance && ./venv/bin/python3 -c \"from src.database import set_user_api_initial_balance; print('SUCCESS:', set_user_api_initial_balance(9, 5000.0))\""
stdin, stdout, stderr = ssh.exec_command(cmd, timeout=30)
out = stdout.read().decode('utf-8', errors='replace')
print("OUTPUT:\n", out)
ssh.close()
