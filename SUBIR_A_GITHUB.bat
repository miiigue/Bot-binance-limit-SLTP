@echo off
title Subir cambios a GitHub
echo ====================================================
echo      SUBIENDO CAMBIOS DEL BOT A GITHUB
echo ====================================================
cd /d "%~dp0"
echo Verificando estado de Git...
git status
echo.
echo Agregando y confirmando cambios...
git add .
git commit -m "Sistema de login, roles de inversionistas, pool de capital y backups" || echo "No hay cambios pendientes por confirmar."
echo.
echo Enviando cambios a https://github.com/miiigue/Bot-binance-limit-SLTP ...
git push origin main
echo.
if %ERRORLEVEL% EQU 0 (
    echo ====================================================
    echo   EXITO: El codigo ha sido subido a tu GitHub!
    echo ====================================================
) else (
    echo ====================================================
    echo   Hubo un problema de autenticacion con GitHub.
    echo ====================================================
)
pause
