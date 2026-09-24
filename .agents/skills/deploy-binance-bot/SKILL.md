---
name: deploy-binance-bot
description: >-
  Guía y flujo estandarizado para compilar, realizar commit, push y desplegar (deploy)
  el Bot de Binance en el servidor VPS remoto (178.105.192.140) a través de PowerShell.
  Usar siempre que el usuario solicite desplegar, actualizar, subir cambios a GitHub,
  o reiniciar el bot en el VPS.
---

# Flujo de Despliegue y Actualización en VPS (PowerShell)

Este skill define el procedimiento profesional para validar, empaquetar, subir cambios y desplegar la aplicación en el servidor de producción (VPS) utilizando PowerShell.

## Datos del Entorno de Producción (VPS)

- **IP del Servidor:** `178.105.192.140`
- **Usuario SSH:** `root`
- **Directorio de la Aplicación:** `/opt/bot-binance`
- **Servicio Systemd:** `binance-bot`
- **Rama Git:** `main`

---

## 1. Validación Local Previa (Evitar romper producción)

Antes de hacer commit y push, verificar localmente que no existan errores de sintaxis ni fallos de compilación:

### A. Verificar sintaxis Python:
```powershell
python -m py_compile src/bot.py src/binance_client.py src/api_server.py
```

### B. Si hubo cambios en el Frontend:
```powershell
cd frontend; npm run build; cd ..
```
*Si `npm run build` falla, corregir los errores de JSX/TypeScript antes de subir.*

---

## 2. Commit y Push Local (PowerShell)

> [!WARNING]
> En Windows PowerShell 5.1 el operador `&&` genera error sintáctico. Utilizar siempre `;` para separar instrucciones o ejecutarlas línea por línea.

### Comandos de Git:
```powershell
git status
git add .
git commit -m "Descripción clara de los cambios realizados"
git push origin main
```

---

## 3. Despliegue en el VPS Remoto (SSH desde PowerShell)

### Opción A: Despliegue Completo (Backend + Frontend)
Usar cuando se hayan modificado componentes de la interfaz web (`frontend/`) o archivos del bot:

```powershell
ssh root@178.105.192.140 "cd /opt/bot-binance && git pull origin main && cd frontend && npm run build && cd .. && systemctl restart binance-bot"
```

### Opción B: Despliegue Rápido (Solo Backend / Python)
Usar cuando únicamente se hayan modificado archivos `.py` o parámetros de configuración, sin cambios en frontend:

```powershell
ssh root@178.105.192.140 "cd /opt/bot-binance && git pull origin main && systemctl restart binance-bot"
```

### Opción C: Resolución de Conflictos en el VPS
Si en el VPS se modificaron archivos locales (como `config.ini` o bases de datos) y `git pull` es rechazado:

```powershell
ssh root@178.105.192.140 "cd /opt/bot-binance && git stash && git pull origin main && git stash pop && cd frontend && npm run build && cd .. && systemctl restart binance-bot"
```

---

## 4. Verificación del Estado en Producción

### A. Verificar que el servicio esté corriendo (`active (running)`):
```powershell
ssh root@178.105.192.140 "systemctl status binance-bot --no-pager"
```

### B. Revisar los últimos logs en vivo:
```powershell
ssh root@178.105.192.140 "journalctl -u binance-bot -n 40 --no-pager"
```

### C. Reiniciar manualmente el servicio si es necesario:
```powershell
ssh root@178.105.192.140 "systemctl restart binance-bot"
```
