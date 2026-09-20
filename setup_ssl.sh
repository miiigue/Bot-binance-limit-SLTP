#!/bin/bash
set -e

echo "=========================================================="
echo "   CONFIGURACION DE HTTPS Y ACCESO TOTAL (HETZNER VPS)    "
echo "=========================================================="

DOMAIN="trading.wtnsolutions.com"

echo "1. Instalando Certbot y plugin de Nginx..."
apt-get update -y
apt-get install -y certbot python3-certbot-nginx

echo "2. Abriendo puerto 443 (HTTPS) y 80 (HTTP) en firewall UFW..."
ufw allow 80/tcp || true
ufw allow 443/tcp || true
ufw reload || true

echo "3. Generando o renovando certificado SSL con Certbot para $DOMAIN..."
if [ ! -f "/etc/letsencrypt/live/$DOMAIN/fullchain.pem" ]; then
    certbot certonly --nginx -d "$DOMAIN" --non-interactive --agree-tos --register-unsafely-without-email || \
    certbot certonly --webroot -w /var/www/html -d "$DOMAIN" --non-interactive --agree-tos --register-unsafely-without-email || true
fi

if [ -f "/etc/letsencrypt/live/$DOMAIN/fullchain.pem" ]; then
    SSL_CERT="/etc/letsencrypt/live/$DOMAIN/fullchain.pem"
    SSL_KEY="/etc/letsencrypt/live/$DOMAIN/privkey.pem"
    PRIMARY_DOMAIN="$DOMAIN"
    echo "Certificado SSL activo para: $PRIMARY_DOMAIN"
else
    SSL_CERT="/etc/letsencrypt/live/178.105.192.140.sslip.io/fullchain.pem"
    SSL_KEY="/etc/letsencrypt/live/178.105.192.140.sslip.io/privkey.pem"
    PRIMARY_DOMAIN="178.105.192.140.sslip.io"
    echo "Usando certificado fallback: $PRIMARY_DOMAIN"
fi

echo "4. Escribiendo configuracion en Nginx con redireccion automatica a HTTPS..."
cat << EOF > /etc/nginx/sites-available/bot-binance
server {
    listen 80 default_server;
    listen [::]:80 default_server;
    server_name $DOMAIN 178.105.192.140.sslip.io 178.105.192.140.nip.io 178.105.192.140 _;

    location /.well-known/acme-challenge/ {
        root /var/www/html;
    }

    location / {
        return 301 https://$PRIMARY_DOMAIN\$request_uri;
    }
}

server {
    listen 443 ssl default_server;
    listen [::]:443 ssl default_server;
    server_name $DOMAIN 178.105.192.140.sslip.io 178.105.192.140.nip.io 178.105.192.140 _;

    ssl_certificate $SSL_CERT;
    ssl_certificate_key $SSL_KEY;

    if (\$host != "$PRIMARY_DOMAIN") {
        return 301 https://$PRIMARY_DOMAIN\$request_uri;
    }

    root /opt/bot-binance/frontend/dist;
    index index.html;

    location /sw.js {
        add_header Cache-Control "no-cache";
        expires 0;
    }

    location /manifest.json {
        add_header Cache-Control "no-cache";
        add_header Content-Type "application/manifest+json";
    }

    location / {
        try_files \$uri \$uri/ /index.html;
    }

    location /api/ {
        proxy_pass http://127.0.0.1:5002/api/;
        proxy_http_version 1.1;
        proxy_set_header Upgrade \$http_upgrade;
        proxy_set_header Connection 'upgrade';
        proxy_set_header Host \$host;
        proxy_set_header X-Real-IP \$remote_addr;
        proxy_set_header X-Forwarded-For \$proxy_add_x_forwarded_for;
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
echo "Acceso HTTP directo:                  http://178.105.192.140"
echo "Acceso HTTPS Oficial WTN:            https://$PRIMARY_DOMAIN"
echo "=========================================================="
