#!/bin/bash
set -e

echo "=========================================================="
echo "   CONFIGURACION DE HTTPS Y ACCESO TOTAL (HETZNER VPS)    "
echo "=========================================================="

DOMAIN="178.105.192.140.sslip.io"

echo "1. Instalando Certbot y plugin de Nginx..."
apt-get update -y
apt-get install -y certbot python3-certbot-nginx

echo "2. Abriendo puerto 443 (HTTPS) y 80 (HTTP) en firewall UFW..."
ufw allow 80/tcp
ufw allow 443/tcp
ufw reload

echo "3. Generando o renovando certificado SSL con Certbot..."
if [ ! -f "/etc/letsencrypt/live/$DOMAIN/fullchain.pem" ]; then
    certbot certonly --nginx -d "$DOMAIN" --non-interactive --agree-tos --register-unsafely-without-email
fi

echo "4. Escribiendo configuracion hibrida en Nginx (HTTP + HTTPS)..."
cat << 'EOF' > /etc/nginx/sites-available/bot-binance
server {
    listen 80 default_server;
    listen [::]:80 default_server;
    server_name 178.105.192.140.sslip.io 178.105.192.140.nip.io 178.105.192.140 _;

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

server {
    listen 443 ssl default_server;
    listen [::]:443 ssl default_server;
    server_name 178.105.192.140.sslip.io 178.105.192.140.nip.io 178.105.192.140 _;

    ssl_certificate /etc/letsencrypt/live/178.105.192.140.sslip.io/fullchain.pem;
    ssl_certificate_key /etc/letsencrypt/live/178.105.192.140.sslip.io/privkey.pem;

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

ln -sf /etc/nginx/sites-available/bot-binance /etc/nginx/sites-enabled/
nginx -t
systemctl reload nginx

echo "=========================================================="
echo "   ¡CONFIGURACION COMPLETADA CON EXITO!                  "
echo "=========================================================="
echo "Acceso HTTP directo (Siempre activo): http://178.105.192.140"
echo "Acceso HTTPS seguro (Candado verde):  https://178.105.192.140.sslip.io"
echo "=========================================================="
