#!/bin/bash
set -e

echo "=========================================================="
echo "   CONFIGURACION DE HTTPS GRATIS (SSL CON LET'S ENCRYPT)  "
echo "=========================================================="

DOMAIN="178.105.192.140.sslip.io"

echo "1. Instalando Certbot y plugin de Nginx..."
apt-get update -y
apt-get install -y certbot python3-certbot-nginx

echo "2. Abriendo puerto 443 (HTTPS) en el firewall UFW..."
ufw allow 443/tcp
ufw reload

echo "3. Configurando nombre de dominio en Nginx ($DOMAIN)..."
sed -i "s/server_name .*;/server_name $DOMAIN _;/g" /etc/nginx/sites-available/bot-binance
nginx -t
systemctl reload nginx

echo "4. Obteniendo e instalando certificado SSL gratuito con Certbot..."
certbot --nginx -d "$DOMAIN" --non-interactive --agree-tos --register-unsafely-without-email --redirect

echo "5. Verificando estado de Nginx..."
systemctl reload nginx

echo "=========================================================="
echo "   ¡HTTPS ACTIVADO EXITOSAMENTE CON CERTIFICADO VALIDO!   "
echo "=========================================================="
echo "Ya puedes ingresar de forma 100% segura con candado verde en:"
echo "https://$DOMAIN"
echo "=========================================================="
