import React, { useState, useEffect, useCallback } from 'react';
import ConfigForm from './ConfigForm'; // Importa el componente del formulario
import StatusDisplay from './StatusDisplay'; // <-- Importar el nuevo componente
import './index.css'; // Importar el archivo CSS principal existente

function App() {
  const [config, setConfig] = useState(null); // Estado para la configuración
  const [botsRunning, setBotsRunning] = useState(null); // null: desconocido, true: corriendo, false: detenidos
  const [initialLoadingError, setInitialLoadingError] = useState(null); // Para errores de carga inicial
  // --- NUEVO ESTADO PARA DATOS DE LA CABECERA ---
  const [headerPnlData, setHeaderPnlData] = useState({ totalPnl: 0, coinCount: 0 });
  // ---------------------------------------------

  // Efecto para la carga inicial de configuración y estado
  useEffect(() => {
    const fetchInitialData = async () => {
        setInitialLoadingError(null); // Resetear error
        try {
            // Intentar obtener la configuración primero
            const configResponse = await fetch('/api/config');
            if (!configResponse.ok) {
                throw new Error(`Error al cargar configuración: ${configResponse.status}`);
            }
            const configData = await configResponse.json();
            // Aplanar configuración como antes...
            const flatConfig = {
                 apiKey: configData.apiKey || '',
                 apiSecret: configData.apiSecret || '',
                 mode: configData.mode || 'paper',
                 rsiInterval: configData.rsiInterval || '1m',
                 rsiPeriod: configData.rsiPeriod || 14,
                 rsiThresholdUp: configData.rsiThresholdUp || 1.5,
                 rsiThresholdDown: configData.rsiThresholdDown || -1.0,
                 rsiEntryLevelLow: configData.rsiEntryLevelLow || 30,
                 rsiEntryLevelHigh: configData.rsiEntryLevelHigh || 75,
                 rsiTarget: configData.rsiTarget || 50,
                 positionSizeUSDT: configData.positionSizeUSDT || 50,
                 stopLossUSDT: configData.stopLossUSDT || 0,
                 takeProfitUSDT: configData.takeProfitUSDT || 0,
                 cycleSleepSeconds: configData.cycleSleepSeconds || 60,
                 volumeSmaPeriod: configData.volumeSmaPeriod || 20,
                 volumeFactor: configData.volumeFactor || 1.5,
                 orderTimeoutSeconds: configData.orderTimeoutSeconds || 60,
                 requiredUptrendCandles: configData.requiredUptrendCandles || 0,
                 symbolsToTrade: configData.symbolsToTrade || '',
                 evaluateRsiDelta: configData.evaluateRsiDelta !== undefined ? configData.evaluateRsiDelta : true,
                 evaluateVolumeFilter: configData.evaluateVolumeFilter !== undefined ? configData.evaluateVolumeFilter : true,
                 evaluateRsiRange: configData.evaluateRsiRange !== undefined ? configData.evaluateRsiRange : true,
                 evaluateDowntrendCandlesBlock: configData.evaluateDowntrendCandlesBlock !== undefined ? configData.evaluateDowntrendCandlesBlock : true,
                 evaluateDowntrendLevelsBlock: configData.evaluateDowntrendLevelsBlock !== undefined ? configData.evaluateDowntrendLevelsBlock : true,
                 evaluateRequiredUptrend: configData.evaluateRequiredUptrend !== undefined ? configData.evaluateRequiredUptrend : true,
                 enableTakeProfitPnl: configData.enableTakeProfitPnl !== undefined ? configData.enableTakeProfitPnl : true,
                 enableStopLossPnl: configData.enableStopLossPnl !== undefined ? configData.enableStopLossPnl : true,
                 enableTrailingRsiStop: configData.enableTrailingRsiStop !== undefined ? configData.enableTrailingRsiStop : true,
                 enablePriceTrailingStop: configData.enablePriceTrailingStop !== undefined ? configData.enablePriceTrailingStop : true,
                 priceTrailingStopDistanceUSDT: configData.priceTrailingStopDistanceUSDT !== undefined ? parseFloat(configData.priceTrailingStopDistanceUSDT) : 0.05,
                 priceTrailingStopActivationPnlUSDT: configData.priceTrailingStopActivationPnlUSDT !== undefined ? parseFloat(configData.priceTrailingStopActivationPnlUSDT) : 0.02,
                 enablePnlTrailingStop: configData.enablePnlTrailingStop !== undefined ? configData.enablePnlTrailingStop : true,
                 pnlTrailingStopActivationUSDT: configData.pnlTrailingStopActivationUSDT !== undefined ? parseFloat(configData.pnlTrailingStopActivationUSDT) : 0.1,
                 pnlTrailingStopDropUSDT: configData.pnlTrailingStopDropUSDT !== undefined ? parseFloat(configData.pnlTrailingStopDropUSDT) : 0.05,
                 evaluateOpenInterestIncrease: configData.evaluateOpenInterestIncrease !== undefined ? configData.evaluateOpenInterestIncrease : true,
                 openInterestPeriod: configData.openInterestPeriod || '5m'
            };
            setConfig(flatConfig);
            console.log("Configuración inicial cargada.", flatConfig);

            // Ahora, obtener el estado general (que incluye si los bots están corriendo)
            const statusResponse = await fetch('/api/status');
            if (!statusResponse.ok) {
                 // Si la config cargó pero el estado falla, aún podemos mostrar config
                 console.warn("Configuración cargada, pero falló la carga inicial del estado de los bots.");
                 setBotsRunning(false); // Asumir que no corren si el estado falla
                 // No lanzar error aquí para permitir que ConfigForm se muestre
            } else {
                const statusData = await statusResponse.json();
                setBotsRunning(statusData.bots_running); // Establecer estado basado en la respuesta
                console.log("Estado inicial de bots cargado. Corriendo:", statusData.bots_running);
            }
            
        } catch (error) {
            console.error("Error crítico durante la carga inicial:", error);
            setInitialLoadingError(`Error al cargar datos iniciales: ${error.message}. Intenta recargar o revisa el servidor.`);
            setConfig(null); // No mostrar config si hay error crítico
            setBotsRunning(false); // Asumir que no corren
        }
    };

    fetchInitialData();
}, []);

  const handleSave = (newConfig) => {
    console.log('Sending updated config to API:', newConfig);

    // Devolver una promesa para que se pueda esperar si es necesario
    return fetch('/api/config', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(newConfig),
    })
    .then(response => {
        if (!response.ok) {
          return response.json().then(errData => {
              throw new Error(errData.error || `HTTP error! status: ${response.status}`);
          });
        }
        return response.json();
    })
    .then(data => {
        console.log('API response after save:', data);
        alert(data.message || 'Configuration saved! Podría requerir reiniciar los bots para aplicar todos los cambios.');
        // Recargar la config después de guardar para asegurar consistencia?
        // Podría ser buena idea, o simplemente informar al usuario.
        // fetchInitialData(); // Opcional: Recargar todo
        return true; // Indicar éxito
    })
    .catch(error => {
        console.error('Error saving configuration:', error);
        alert(`Error saving configuration: ${error.message}`);
        return false; // Indicar fallo
    });
  };
  
  // --- Funciones para INICIAR y DETENER bots --- 
  const handleStartBots = async () => {
    try {
      const response = await fetch('/api/start_bots', { method: 'POST' });
      const data = await response.json(); // Intentar leer JSON siempre
      if (!response.ok) {
        throw new Error(data.error || `Error HTTP ${response.status}`);
      }
      console.log("Start bots response:", data);
      setBotsRunning(true); // Actualizar estado local
      return true; // Éxito
    } catch (error) {
      console.error('Error starting bots:', error);
      // El mensaje de error se maneja en BotControls
      setBotsRunning(false); // Asegurarse de que el estado refleje el fallo
      return false; // Fallo
    }
  };

  const handleShutdown = async () => {
    try {
      const response = await fetch('/api/shutdown', { method: 'POST' });
      const data = await response.json(); // Intentar leer JSON siempre
       if (!response.ok) {
        // Incluso si falla, asumimos que el intento de apagar significa que ya no corren
        console.warn("Respuesta no OK de shutdown, pero actualizando UI a no corriendo.");
        // throw new Error(data.message || `Error HTTP ${response.status}`); // Opcional: lanzar error
      }
      console.log('Shutdown API response:', data);
      setBotsRunning(false); // Actualizar estado local
      // --- RESETEAR PNL EN CABECERA AL DETENER BOTS ---
      // setHeaderPnlData({ totalPnl: headerPnlData.totalPnl, coinCount: 0 }); // Mantener PNL histórico, pero 0 monedas activas si así se decide.
      // O resetear completamente si se prefiere:
      // setHeaderPnlData({ totalPnl: 0, coinCount: 0 }); // Esto resetearía el PNL histórico en cabecera
      // Por ahora, dejaremos que StatusDisplay siga actualizando el PnL histórico incluso si los bots se detienen.
      // El coinCount se actualizará desde StatusDisplay según los workers que realmente estén listados.
      // ---------------------------------------------
      return true; // Considerar éxito para la UI incluso si hubo error leve
    } catch (error) {
      console.error('Error sending shutdown signal:', error);
      // El mensaje de error se maneja en BotControls
       setBotsRunning(false); // Asegurarse de que el estado refleje el fallo
      return false; // Fallo
    }
  };
  // ------------------------------------------

  // --- FUNCIÓN CALLBACK PARA ACTUALIZAR DATOS DE CABECERA ---
  const handleStatusUpdateForHeader = useCallback((data) => {
    setHeaderPnlData({
      totalPnl: data.totalPnl,
      coinCount: data.coinCount
    });
  }, []);
  // ----------------------------------------------------

  return (
    <div className="min-h-screen bg-primary-50 dark:bg-primary-950 text-gray-900 dark:text-gray-100">
      <div className="sticky top-0 z-50 bg-primary-600 text-white p-3 shadow-md flex items-center">
        {/* Título a la izquierda */}
        <span className="text-xl font-bold">BOT BINANCE LIMIT-SLTP</span>
        
        {/* PnL Info con margen a la izquierda aumentado y estilo de texto modificado */}
        <div className="text-lg font-semibold ml-[30ch]">
            <span>PNL {headerPnlData.coinCount} monedas = </span>
            <span className="text-xl"> 
              {headerPnlData.totalPnl.toFixed(5)} USDT
            </span>
        </div>
        
        {/* Este div ocupará el espacio restante, empujando cualquier contenido futuro a la derecha */}
        <div className="flex-grow"></div>
      </div>
      <div className="container mx-auto p-4 md:p-8 max-w-5xl">
        {/* Mostrar error de carga inicial si existe */} 
        {initialLoadingError && (
          <div className="mb-6 p-4 bg-red-100 dark:bg-red-900 border border-red-400 dark:border-red-700 text-red-700 dark:text-red-200 rounded-lg">
             <p className="font-semibold text-center">Error de Carga</p>
             <p className="text-center">{initialLoadingError}</p>
           </div>
        )}

        {/* Solo mostrar controles y status si no hubo error crítico inicial */} 
        {!initialLoadingError && (
          <>
             {/* La sección BotControls fue movida a StatusDisplay */}
             {/* Asegurarse que no queden restos aquí */}

            {/* -- Sección de Configuración -- */}
            {config ? (
                <ConfigForm initialConfig={config} onSave={handleSave} />
            ) : (
                <p className="text-center">(Loading configuration...)</p>
            )}

            {/* -- Sección de Estado (sin cambios, ya pasa props) -- */}
            <StatusDisplay 
                botsRunning={botsRunning} 
                onStart={handleStartBots} 
                onShutdown={handleShutdown} 
                onStatusUpdate={handleStatusUpdateForHeader}
            /> 
          </>
        )}
      </div>
    </div>
  );
}

export default App; 