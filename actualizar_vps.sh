#!/bin/bash
set -e

echo "=========================================================="
echo "    ACTUALIZANDO BOT BINANCE EN EL SERVIDOR VPS (24/7)    "
echo "=========================================================="

cd /opt/bot-binance

echo "1. Descargando últimos cambios desde GitHub..."
git pull origin main

echo "2. Compilando Frontend (React/Vite con Login & Inversionistas)..."
cd frontend
npm install
npm run build
cd ..

echo "3. Reiniciando servicio del Bot y Nginx..."
systemctl daemon-reload
systemctl restart binance-bot
systemctl restart nginx

echo "=========================================================="
echo "   ¡ACTUALIZACIÓN COMPLETADA CON ÉXITO EN EL VPS!        "
echo "=========================================================="
systemctl status binance-bot --no-pager
