import React, { useState } from 'react';

// --- Componente para los botones de control (sin título) ---
function BotControls({ botsRunning, onStart, onShutdown }) {
  const [isActionPending, setIsActionPending] = useState(false);
  const [actionMessage, setActionMessage] = useState('');

  const handleStartClick = async () => {
    setIsActionPending(true);
    setActionMessage('Iniciando bots...');
    const success = await onStart(); // Llama a la función pasada por props
    if (!success) {
      setActionMessage('Error al iniciar bots. Revisa los logs del servidor.');
      // Mantener el mensaje de error por un tiempo
      setTimeout(() => setActionMessage(''), 5000);
    } else {
       setActionMessage(''); // Limpiar mensaje en éxito
    }
    setIsActionPending(false);
  };

  const handleShutdownClick = async () => {
    if (!window.confirm("¿Estás seguro de que deseas apagar todos los bots?")) return;
    setIsActionPending(true);
    setActionMessage('Enviando señal de apagado...');
    const success = await onShutdown(); // Llama a la función pasada por props
    if (!success) {
      setActionMessage('Error al enviar señal de apagado. Revisa los logs.');
       setTimeout(() => setActionMessage(''), 5000);
    } else {
      setActionMessage('Apagado solicitado.'); // Mensaje temporal
      setTimeout(() => setActionMessage(''), 3000);
    }
    setIsActionPending(false);
  };

  const handleCloseAllClick = async () => {
    if (!window.confirm("⚠️ ¿Estás seguro de que deseas CERRAR TODAS LAS POSICIONES ABIERTAS a precio de mercado en Binance?")) return;
    setIsActionPending(true);
    setActionMessage('Cerrando todas las posiciones a mercado en Binance...');
    try {
      const resp = await fetch('/api/close_all_positions', { method: 'POST' });
      const data = await resp.json();
      if (resp.ok) {
        setActionMessage('✅ Todas las posiciones fueron cerradas exitosamente.');
        setTimeout(() => setActionMessage(''), 5000);
      } else {
        setActionMessage(`Error: ${data.error || 'No se pudieron cerrar todas las posiciones'}`);
        setTimeout(() => setActionMessage(''), 5000);
      }
    } catch (err) {
      setActionMessage(`Error de conexión: ${err.message}`);
      setTimeout(() => setActionMessage(''), 5000);
    }
    setIsActionPending(false);
  };

  // Determinar el estado de los botones
  const startDisabled = botsRunning === null || botsRunning === true || isActionPending;
  const shutdownDisabled = botsRunning === null || botsRunning === false || isActionPending;

  return (
    <div className="mb-4">
      <div className="flex flex-wrap justify-center gap-4">
        <button
          onClick={handleStartClick}
          disabled={startDisabled}
          className={`px-5 py-2 font-semibold rounded-md text-white transition-colors duration-150 ease-in-out 
            ${startDisabled 
              ? 'bg-gray-400 dark:bg-gray-600 cursor-not-allowed' 
              : 'bg-green-600 hover:bg-green-700 focus:outline-none focus:ring-2 focus:ring-green-500 focus:ring-offset-2'}
          `}
        >
          {isActionPending && !botsRunning ? 'Iniciando...' : '▶ Iniciar Todos los Bots'}
        </button>
        <button
          onClick={handleShutdownClick}
          disabled={shutdownDisabled}
          className={`px-5 py-2 font-semibold rounded-md text-white transition-colors duration-150 ease-in-out 
            ${shutdownDisabled 
              ? 'bg-gray-400 dark:bg-gray-600 cursor-not-allowed' 
              : 'bg-gray-600 hover:bg-gray-700 focus:outline-none focus:ring-2 focus:ring-gray-500 focus:ring-offset-2'}
          `}
        >
          {isActionPending && botsRunning ? 'Apagando...' : '⏹ Apagar Todos los Bots'}
        </button>
        <button
          onClick={handleCloseAllClick}
          disabled={isActionPending}
          className={`px-5 py-2 font-semibold rounded-md text-white transition-colors duration-150 ease-in-out shadow-md
            ${isActionPending 
              ? 'bg-gray-400 cursor-not-allowed' 
              : 'bg-red-600 hover:bg-red-700 active:bg-red-800 focus:outline-none focus:ring-2 focus:ring-red-500 focus:ring-offset-2'}
          `}
        >
          🚨 Cerrar Todas las Posiciones
        </button>
      </div>
      {actionMessage && (
         <p className={`text-sm font-medium text-center mt-3 ${actionMessage.includes('Error') ? 'text-red-600 dark:text-red-400' : 'text-green-600 dark:text-green-400'}`}>
           {actionMessage}
         </p>
      )}
    </div>
  );
}

export default BotControls; 