#!/bin/bash
set -e

echo "=========================================================="
echo "    ACTUALIZANDO BOT BINANCE EN EL SERVIDOR VPS (24/7)    "
echo "=========================================================="

cd /opt/bot-binance

echo "1. Descargando últimos cambios desde GitHub..."
git stash || true
git pull origin main
git stash pop || true

echo "1.1. Actualizando librerías de Python..."
if [ -d "venv" ]; then
    venv/bin/pip install -r requirements.txt --quiet
fi

echo "1.2. Asegurando base de datos PostgreSQL en el VPS..."
if ! command -v psql &> /dev/null; then
    echo "Instalando paquetes de PostgreSQL..."
    apt-get update -qq && apt-get install -y postgresql postgresql-contrib -qq
fi

systemctl start postgresql
systemctl enable postgresql

# Crear usuario y base de datos bot_database si no existen
su - postgres -c "psql -tc \"SELECT 1 FROM pg_roles WHERE rolname='bot_user'\" | grep -q 1 || psql -c \"CREATE USER bot_user WITH PASSWORD 'bot_secure_password_2026';\""
su - postgres -c "psql -tc \"SELECT 1 FROM pg_database WHERE datname='bot_database'\" | grep -q 1 || psql -c \"CREATE DATABASE bot_database OWNER bot_user;\""
su - postgres -c "psql -c \"GRANT ALL PRIVILEGES ON DATABASE bot_database TO bot_user;\""

# Asegurar DATABASE_URL en el archivo .env sin alterar las demás variables
if [ -f ".env" ]; then
    if ! grep -q "DATABASE_URL" .env; then
        echo "DATABASE_URL=postgresql://bot_user:bot_secure_password_2026@localhost:5432/bot_database" >> .env
    fi
fi

# Asegurar que el servicio systemd lea .env
if [ -f "/etc/systemd/system/binance-bot.service" ]; then
    if ! grep -q "EnvironmentFile" /etc/systemd/system/binance-bot.service; then
        sed -i '/Environment=PYTHONUNBUFFERED=1/a EnvironmentFile=/opt/bot-binance/.env' /etc/systemd/system/binance-bot.service
    fi
fi

echo "1.3. Aplicando esquemas y migrando datos de SQLite a PostgreSQL..."
if [ -d "venv" ]; then
    venv/bin/python3 src/setup_postgres.py
fi

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
