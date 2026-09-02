import React, { useState } from 'react';

function BotControls({ botsRunning, onStart, onShutdown, addToast }) {
  const [isActionPending, setIsActionPending] = useState(false);

  const notify = (title, message, type = 'info') => {
    if (addToast) {
      addToast(title, message, type);
    } else {
      alert(`${title}: ${message}`);
    }
  };

  const handleStartClick = async () => {
    setIsActionPending(true);
    try {
      const result = await onStart();
      if (result && result.error) {
        notify('Error al Iniciar', result.error, 'error');
      } else {
        notify('🚀 Bots Iniciados', 'Todos los workers están analizando el mercado.', 'success');
      }
    } catch (e) {
      notify('Error al Iniciar', e.message, 'error');
    } finally {
      setIsActionPending(false);
    }
  };

  const handleShutdownClick = async () => {
    if (!window.confirm("¿Estás seguro de que deseas apagar todos los bots?")) return;
    setIsActionPending(true);
    try {
      const result = await onShutdown();
      if (result && result.error) {
        notify('Error al Apagar', result.error, 'error');
      } else {
        notify('⏹️ Bots Apagados', 'Se envió la señal de detención a los workers.', 'info');
      }
    } catch (e) {
      notify('Error al Apagar', e.message, 'error');
    } finally {
      setIsActionPending(false);
    }
  };

  const handleCloseAllClick = async () => {
    if (!window.confirm("⚠️ ¿Estás seguro de que deseas CERRAR TODAS LAS POSICIONES ABIERTAS a precio de mercado en Binance?")) return;
    setIsActionPending(true);
    try {
      const resp = await fetch('/api/close_all_positions', { method: 'POST' });
      const data = await resp.json();
      if (resp.ok) {
        notify('🚨 Posiciones Cerradas', 'Todas las posiciones abiertas se cerraron a mercado.', 'warning');
      } else {
        notify('Error al Cerrar Posiciones', data.error || 'No se pudieron cerrar.', 'error');
      }
    } catch (err) {
      notify('Error de Conexión', err.message, 'error');
    } finally {
      setIsActionPending(false);
    }
  };

  const handleResetTradesClick = async () => {
    if (!window.confirm("⚠️ ¿Estás seguro de que deseas REINICIAR TODO EL HISTORIAL DE GANANCIAS Y TRADES?\n\nEsto pondrá el PnL acumulado a 0.00 USDT y borrará los registros antiguos para empezar una nueva etapa limpia.")) return;
    setIsActionPending(true);
    try {
      const resp = await fetch('/api/trades/reset', { method: 'POST' });
      const data = await resp.json();
      if (resp.ok) {
        notify('🔄 Historial Reiniciado', 'El historial de trades y PnL se restableció a 0.00 USDT.', 'success');
      } else {
        notify('Error al Reiniciar', data.error || 'No se pudo reiniciar el historial.', 'error');
      }
    } catch (err) {
      notify('Error de Conexión', err.message, 'error');
    } finally {
      setIsActionPending(false);
    }
  };

  const startDisabled = botsRunning === null || botsRunning === true || isActionPending;
  const shutdownDisabled = botsRunning === null || botsRunning === false || isActionPending;

  return (
    <div className="flex flex-wrap items-center gap-1.5 sm:gap-2">
      {/* Botón 1: Iniciar */}
      <button
        type="button"
        onClick={handleStartClick}
        disabled={startDisabled}
        className={`px-3 py-1.5 text-xs font-bold rounded-xl transition-all flex items-center gap-1.5 shadow-sm active:scale-95 ${
          startDisabled
            ? 'bg-gray-800 text-gray-500 cursor-not-allowed opacity-50 border border-gray-700'
            : 'bg-emerald-600 hover:bg-emerald-500 text-white shadow-emerald-900/30'
        }`}
        title="Iniciar todos los workers de trading configurados"
      >
        <span className="text-sm">▶</span>
        <span className="hidden sm:inline">Iniciar Bots</span>
      </button>

      {/* Botón 2: Apagar */}
      <button
        type="button"
        onClick={handleShutdownClick}
        disabled={shutdownDisabled}
        className={`px-3 py-1.5 text-xs font-bold rounded-xl transition-all flex items-center gap-1.5 shadow-sm active:scale-95 ${
          shutdownDisabled
            ? 'bg-gray-800 text-gray-500 cursor-not-allowed opacity-50 border border-gray-700'
            : 'bg-rose-600 hover:bg-rose-500 text-white shadow-rose-900/30'
        }`}
        title="Pausar o apagar todos los bots"
      >
        <span className="text-sm">⏹</span>
        <span className="hidden sm:inline">Apagar Bots</span>
      </button>

      {/* Botón 3: Cerrar Todas las Posiciones */}
      <button
        type="button"
        onClick={handleCloseAllClick}
        disabled={isActionPending}
        className="px-3 py-1.5 text-xs font-bold rounded-xl bg-amber-600/90 hover:bg-amber-500 text-white shadow-sm border border-amber-500/40 transition-all flex items-center gap-1.5 active:scale-95 disabled:opacity-50 disabled:cursor-not-allowed"
        title="EMERGENCIA: Cierra inmediatamente todas las posiciones abiertas en Binance a precio de mercado"
      >
        <span className="text-sm">🚨</span>
        <span className="hidden md:inline">Cerrar Todo</span>
      </button>

      {/* Botón 4: Reiniciar Historial PnL */}
      <button
        type="button"
        onClick={handleResetTradesClick}
        disabled={isActionPending}
        className="px-2.5 py-1.5 text-xs font-semibold rounded-xl bg-gray-800 hover:bg-gray-700 text-gray-300 border border-gray-700 transition-all flex items-center gap-1.5 active:scale-95 disabled:opacity-50 disabled:cursor-not-allowed"
        title="Reinicia el registro histórico de operaciones y PnL acumulado a cero"
      >
        <span className="text-xs">🔄</span>
        <span className="hidden xl:inline">Reset PnL</span>
      </button>
    </div>
  );
}

export default BotControls;
