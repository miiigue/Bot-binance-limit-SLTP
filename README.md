# Bot de Trading Binance Futures (RSI + Limit + SL/TP)

Este proyecto cuenta con un backend en Python (Flask) y un frontend en React (Vite + Tailwind CSS).

## 🚀 Inicio Rápido

1. Configura tus claves de Binance en el archivo `.env`:
   ```ini
   BINANCE_API_KEY=tu_api_key
   BINANCE_API_SECRET=tu_api_secret
   ```
2. Ejecuta el archivo **`INICIAR_BOT.bat`** (haciendo doble clic).
3. Abre tu navegador en **`http://localhost:5174`** para usar el panel de control.

## 🛠 Estructura del Proyecto

- `src/`: Lógica del bot en Python, cliente de Binance Futures, base de datos SQLite y servidor API Flask (puerto 5002).
- `frontend/`: Interfaz de usuario interactiva en React + Vite (puerto 5174).
- `strategies/`: Archivos JSON con estrategias guardadas.
- `venv/`: Entorno virtual de Python con todas las dependencias instaladas.
- `run_server.py`: Script lanzador del servidor backend.
- `config.ini`: Configuración activa de trading y del sistema.
- `trades_limit.db`: Base de datos SQLite donde se registran las operaciones.
