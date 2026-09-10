#!/bin/bash
set -e

echo "=========================================================="
echo "   INSTALACION AUTOMATICA DEL BOT BINANCE 24/7 (HETZNER)  "
echo "=========================================================="

APP_DIR="/opt/bot-binance"

echo "1. Actualizando paquetes del sistema..."
apt-get update -y
apt-get install -y python3 python3-pip python3-venv git nginx curl ufw

echo "2. Instalando Node.js v20 LTS..."
if ! command -v node &> /dev/null; then
    curl -fsSL https://deb.nodesource.com/setup_20.x | bash -
    apt-get install -y nodejs
fi

echo "3. Preparando repositorio en $APP_DIR..."
if [ -d "$APP_DIR/.git" ]; then
    echo "Actualizando repositorio existente..."
    cd "$APP_DIR"
    git pull origin main
else
    mkdir -p /opt
    git clone https://github.com/miiigue/Bot-binance-limit-SLTP.git "$APP_DIR"
    cd "$APP_DIR"
fi

echo "4. Creando archivo .env con credenciales..."
if [ ! -f "$APP_DIR/.env" ]; then
cat << 'EOF' > "$APP_DIR/.env"
# === Claves de Binance Modo Real (binance.com) ===
BINANCE_REAL_API_KEY=lBKBdj72n0obx80xD9ViyYwm0V4zanlBKrwi9zjd3BvJwmoms75mC3S7ggCJDz5V
BINANCE_REAL_API_SECRET=ax27ClulwO7paKcCztQH6dF3QDw8wN7xi76UAAhAqqhhjiydfRrmfjh670bkDIjl

# === Claves de Binance Modo Testnet / Demo (testnet.binancefuture.com) ===
BINANCE_TESTNET_API_KEY=xsaHLed6e3Bg5y8hmY7j56MSzw4ntNbBktIBee0TgSofSTqnZgw93xrpA0GF1MwR
BINANCE_TESTNET_API_SECRET=nEBWFJkptIW9X0vdMuVv15pQO9mnta7mpCjIryuFjpzKfFg70NYTqUwEES33Vmjy
EOF
    echo ".env configurado correctamente."
fi

echo "5. Creando entorno virtual de Python e instalando dependencias..."
cd "$APP_DIR"
python3 -m venv venv
"$APP_DIR/venv/bin/pip" install --upgrade pip
"$APP_DIR/venv/bin/pip" install -r requirements.txt

echo "6. Compilando Frontend React/Vite para produccion..."
cd "$APP_DIR/frontend"
npm install
npm run build
cd "$APP_DIR"

echo "7. Configurando permisos de lectura para Nginx..."
chmod -R 755 "$APP_DIR"

echo "8. Configurando Nginx (Puerto 80)..."
cat << 'EOF' > /etc/nginx/sites-available/bot-binance
server {
    listen 80 default_server;
    listen [::]:80 default_server;

    server_name _;

    root /opt/bot-binance/frontend/dist;
    index index.html;

    location / {
        try_files $uri $uri/ /index.html;
    }

    location /api/ {
        proxy_pass http://127.0.0.1:5002/api/;
        proxy_http_version 1.1;
        proxy_set_header Upgrade $http_upgrade;
        proxy_set_header Connection 'upgrade';
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_read_timeout 300s;
        proxy_connect_timeout 75s;
    }
}
EOF

rm -f /etc/nginx/sites-enabled/default
ln -sf /etc/nginx/sites-available/bot-binance /etc/nginx/sites-enabled/
nginx -t
systemctl restart nginx

echo "9. Creando Servicio Systemd 24/7 (binance-bot)..."
cat << 'EOF' > /etc/systemd/system/binance-bot.service
[Unit]
Description=Binance Bot Trading 24/7 Service
After=network.target

[Service]
Type=simple
User=root
WorkingDirectory=/opt/bot-binance
ExecStart=/opt/bot-binance/venv/bin/python /opt/bot-binance/run_server.py
Restart=always
RestartSec=5
Environment=PYTHONUNBUFFERED=1

[Install]
WantedBy=multi-user.target
EOF

systemctl daemon-reload
systemctl enable binance-bot
systemctl restart binance-bot

echo "10. Configurando Firewall UFW (Permitir SSH y Web)..."
ufw allow 22/tcp
ufw allow 80/tcp
ufw --force enable

echo "=========================================================="
echo "   INSTALACION COMPLETADA EXITOSAMENTE           "
echo "=========================================================="
echo "Estado del Bot:"
systemctl status binance-bot --no-pager
echo ""
echo "Tu bot ya esta corriendo 24/7!"
echo "Abre en tu navegador: http://178.105.192.140"
echo "=========================================================="
