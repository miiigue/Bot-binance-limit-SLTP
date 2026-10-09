import paramiko

ssh = paramiko.SSHClient()
ssh.set_missing_host_key_policy(paramiko.AutoAddPolicy())
ssh.connect('178.105.192.140', username='root', password='Botbinance1253', timeout=20)

commands = [
    "systemctl status binance-bot --no-pager"
]

full_cmd = " && ".join(commands)
stdin, stdout, stderr = ssh.exec_command(full_cmd, timeout=30)

out = stdout.read().decode('utf-8', errors='replace')
err = stderr.read().decode('utf-8', errors='replace')

print("=== STATUS ===")
print(out.encode('ascii', errors='replace').decode('ascii'))
if err:
    print("=== ERR ===")
    print(err.encode('ascii', errors='replace').decode('ascii'))

ssh.close()
