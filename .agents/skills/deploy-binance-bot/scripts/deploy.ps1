<#
.SYNOPSIS
    Script automatizado de validación, commit, push y despliegue a VPS.
.DESCRIPTION
    Compila Python, construye el frontend (si aplica), sube los cambios a Git y
    despliega en el servidor VPS 178.105.192.140 reiniciando el servicio binance-bot.
.PARAMETER Message
    Mensaje descriptivo para el commit de Git.
.PARAMETER Fast
    Si se especifica, omite el build del frontend en el VPS (solo actualiza backend).
#>
param(
    [Parameter(Position=0, Mandatory=$false)]
    [string]$Message = "Actualización y mejoras del bot",
    
    [switch]$Fast
)

Write-Host "========================================" -ForegroundColor Cyan
Write-Host "🚀 Iniciando Despliegue de Binance Bot" -ForegroundColor Cyan
Write-Host "========================================" -ForegroundColor Cyan

# 1. Validación de sintaxis Python
Write-Host "`n[1/4] 🔍 Verificando sintaxis Python..." -ForegroundColor Yellow
python -m py_compile src/bot.py src/binance_client.py src/api_server.py
if ($LASTEXITCODE -ne 0) {
    Write-Host "❌ Error en la sintaxis Python. Despliegue cancelado." -ForegroundColor Red
    exit 1
}
Write-Host "✅ Sintaxis Python correcta." -ForegroundColor Green

# 2. Build local del frontend (si no es Fast)
if (-not $Fast) {
    Write-Host "`n[2/4] 📦 Compilando Frontend localmente..." -ForegroundColor Yellow
    Push-Location frontend
    npm run build
    $buildSuccess = ($LASTEXITCODE -eq 0)
    Pop-Location
    if (-not $buildSuccess) {
        Write-Host "❌ Error al compilar el Frontend. Despliegue cancelado." -ForegroundColor Red
        exit 1
    }
    Write-Host "✅ Frontend compilado con éxito." -ForegroundColor Green
} else {
    Write-Host "`n[2/4] ⏩ Modo rápido: Omitiendo build local de frontend." -ForegroundColor DarkGray
}

# 3. Git commit y push
Write-Host "`n[3/4] 📤 Guardando y subiendo cambios a GitHub..." -ForegroundColor Yellow
git add .
$statusOutput = git status --porcelain
if ($statusOutput) {
    git commit -m "$Message"
    git push origin main
    if ($LASTEXITCODE -ne 0) {
        Write-Host "❌ Error al hacer git push a origin main." -ForegroundColor Red
        exit 1
    }
    Write-Host "✅ Cambios subidos a GitHub (origin/main)." -ForegroundColor Green
} else {
    Write-Host "ℹ️ No hay cambios pendientes por commitear. Continuando al deploy..." -ForegroundColor Cyan
}

# 4. Despliegue en VPS
Write-Host "`n[4/4] 🌐 Conectando al VPS y actualizando servicio..." -ForegroundColor Yellow
$vpsCommand = if ($Fast) {
    "cd /opt/bot-binance && git pull origin main && systemctl restart binance-bot"
} else {
    "cd /opt/bot-binance && git pull origin main && cd frontend && npm run build && cd .. && systemctl restart binance-bot"
}

ssh root@178.105.192.140 "$vpsCommand"
if ($LASTEXITCODE -eq 0) {
    Write-Host "`n========================================" -ForegroundColor Green
    Write-Host "🎉 ¡Despliegue completado con éxito!" -ForegroundColor Green
    Write-Host "Servicio binance-bot reiniciado en 178.105.192.140" -ForegroundColor Green
    Write-Host "========================================" -ForegroundColor Green
} else {
    Write-Host "`n❌ Error durante la ejecución del comando en el VPS." -ForegroundColor Red
}
