@echo off
title Binance Bot Launcher & Auto-Start
echo ====================================================
echo     INICIANDO BOT DE BINANCE (CON AUTO-START)
echo ====================================================
cd /d "%~dp0"

echo [1/3] Iniciando Servidor Backend (Python Flask)...
start "Backend Flask (Puerto 5002)" cmd /k "venv\Scripts\python.exe run_server.py"

echo [2/3] Iniciando Panel Web Frontend (Vite React)...
cd frontend
start "Frontend Vite (Puerto 5174)" cmd /k "npm run dev"
cd ..

echo [3/3] Esperando 4 segundos a que los servidores respondan...
timeout /t 4 >nul

echo Activando bots en Binance automaticamente...
powershell -Command "try { $r = Invoke-RestMethod -Uri 'http://127.0.0.1:5002/api/start_bots' -Method Post; Write-Host '>>> BOTS INICIADOS AUTOMATICAMENTE <<<' -ForegroundColor Green } catch { Write-Host 'El servidor se abrira en el navegador para iniciar manualmente.' -ForegroundColor Yellow }"

echo.
echo ====================================================
echo  Abriendo panel de control en tu navegador...
echo  Panel Web: http://localhost:5174
echo ====================================================
start http://localhost:5174
