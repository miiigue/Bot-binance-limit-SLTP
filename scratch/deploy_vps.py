import paramiko

ssh = paramiko.SSHClient()
ssh.set_missing_host_key_policy(paramiko.AutoAddPolicy())
ssh.connect('178.105.192.140', username='root', password='Botbinance1253', timeout=20)

commands = [
    "cd /opt/bot-binance && git pull origin main",
    "cd /opt/bot-binance && ./venv/bin/python3 restore_and_lock_strategy.py",
    "cd /opt/bot-binance/frontend && npm run build",
    "systemctl restart binance-bot",
    "sleep 2",
    "systemctl status binance-bot --no-pager"
]

full_cmd = " && ".join(commands)
print("Executing remote deploy...")
stdin, stdout, stderr = ssh.exec_command(full_cmd, timeout=120)

out = stdout.read().decode('utf-8', errors='replace')
err = stderr.read().decode('utf-8', errors='replace')

print("=== DEPLOY OUTPUT ===")
print(out.encode('ascii', errors='replace').decode('ascii'))
if err:
    print("=== DEPLOY STDERR ===")
    print(err.encode('ascii', errors='replace').decode('ascii'))

ssh.close()
