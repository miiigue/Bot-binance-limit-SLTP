import React, { useState, useEffect, useCallback, useRef } from 'react';
import ConfigForm from './ConfigForm'; // Importa el componente del formulario
import StatusDisplay from './StatusDisplay'; // <-- Importar el nuevo componente
import './index.css'; // Importar el archivo CSS principal existente

// --- FUNCIÓN PARA FORMATEAR EL TIEMPO TRANSCURRIDO (movida o copiada aquí) ---
const formatElapsedTime = (totalSeconds) => {
  const hours = Math.floor(totalSeconds / 3600);
  const minutes = Math.floor((totalSeconds % 3600) / 60);
  const seconds = totalSeconds % 60;

  const pad = (num) => String(num).padStart(2, '0');

  return `${pad(hours)}:${pad(minutes)}:${pad(seconds)}`;
};
// -----------------------------------------------------------------------------

function App() {
  const [config, setConfig] = useState(null); // Estado para la configuración
  const [botsRunning, setBotsRunning] = useState(null); // null: desconocido, true: corriendo, false: detenidos
  const [initialLoadingError, setInitialLoadingError] = useState(null); // Para errores de carga inicial
  // --- NUEVO ESTADO PARA DATOS DE LA CABECERA ---
  const [headerPnlData, setHeaderPnlData] = useState({ totalPnl: 0, coinCount: 0 });
  // ---------------------------------------------

  // --- NUEVO ESTADO PARA EL PNL AL INICIO DE LA SESIÓN ---
  const [pnlAtSessionStart, setPnlAtSessionStart] = useState(null);
  // ----------------------------------------------------

  // --- NUEVOS ESTADOS PARA ALTO Y BAJO PNL DE SESIÓN ---
  const [sessionPnlHigh, setSessionPnlHigh] = useState(null);
  const [sessionPnlLow, setSessionPnlLow] = useState(null);
  // -----------------------------------------------------

  const [elapsedTime, setElapsedTime] = useState(0);
  const [timerActive, setTimerActive] = useState(false);
  const intervalRef = useRef(null);

  // --- NUEVOS ESTADOS PARA LA CUENTA REGRESIVA ---
  const [countdown, setCountdown] = useState(0);
  const [isCountdownActive, setIsCountdownActive] = useState(false);
  const countdownIntervalRef = useRef(null);
  // ---------------------------------------------

  // --- NUEVOS ESTADOS PARA GESTIÓN DE ESTRATEGIAS ---
  const [availableStrategies, setAvailableStrategies] = useState([]);
  const [isLoadingStrategies, setIsLoadingStrategies] = useState(false);
  const [strategyError, setStrategyError] = useState(null);
  // ---------------------------------------------------

  // --- NUEVO ESTADO PARA EL NOMBRE DE LA ESTRATEGIA ACTIVA EN EL FORMULARIO ---
  const [activeStrategyDisplayName, setActiveStrategyDisplayName] = useState('');
  // ------------------------------------------------------------------------

  // --- FUNCIÓN PARA CARGAR ESTRATEGIAS DISPONIBLES ---
  const fetchAvailableStrategies = useCallback(async () => {
    setIsLoadingStrategies(true);
    setStrategyError(null);
    try {
      const response = await fetch('/api/strategies');
      if (!response.ok) {
        const errorData = await response.json().catch(() => ({ error: "Error al obtener estrategias" }));
        throw new Error(errorData.error || `HTTP error ${response.status}`);
      }
      const strategies = await response.json();
      setAvailableStrategies(strategies || []);
    } catch (error) {
      console.error("Error fetching strategies:", error);
      setStrategyError(error.message);
      setAvailableStrategies([]); // Limpiar en caso de error
    }
    setIsLoadingStrategies(false);
  }, []);
  // ---------------------------------------------------

  // --- NUEVA FUNCIÓN CALLBACK PARA ACTUALIZAR EL NOMBRE DE LA ESTRATEGIA --- 
  const handleStrategyNameChange = useCallback((name) => {
    setActiveStrategyDisplayName(name || ''); // Si name es null/undefined, usar ''
  }, []);
  // --------------------------------------------------------------------

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
            // --- NUEVO: Establecer nombre de estrategia activa desde config.ini ---
            setActiveStrategyDisplayName(configData.activeStrategyName || '');
            // ------------------------------------------------------------------
            console.log("Configuración inicial cargada.", flatConfig);
            if (configData.activeStrategyName) {
                console.log("Nombre de estrategia activa cargado desde config.ini:", configData.activeStrategyName);
            }

            // --- INICIALIZAR COUNTDOWN CON VALOR DE CONFIGURACIÓN ---
            if (flatConfig.cycleSleepSeconds) {
              setCountdown(parseInt(flatConfig.cycleSleepSeconds, 10));
            }
            // ----------------------------------------------------

            // Cargar estrategias disponibles después de la config
            await fetchAvailableStrategies(); // <--- LLAMAR AQUÍ

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

  const handleSave = (newConfigFromForm) => {
    // --- NUEVO: Añadir activeStrategyDisplayName al payload para la API ---
    const configToSendToApi = {
      ...newConfigFromForm,
      activeStrategyName: activeStrategyDisplayName 
    };
    console.log('Sending updated config to API (with activeStrategyName):', configToSendToApi);
    // -----------------------------------------------------------------

    // Devolver una promesa para que se pueda esperar si es necesario
    return fetch('/api/config', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(configToSendToApi), // <--- USAR EL OBJETO COMBINADO
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
      setElapsedTime(0); // <--- REINICIAR TIEMPO A 0
      setTimerActive(true); // <--- ACTIVAR TEMPORIZADOR

      // --- GUARDAR PNL AL INICIO DE LA SESIÓN ---
      setPnlAtSessionStart(headerPnlData.totalPnl);
      // --- INICIALIZAR ALTO Y BAJO DE SESIÓN ---
      setSessionPnlHigh(0);
      setSessionPnlLow(0);
      // ----------------------------------------

      // --- INICIAR CUENTA REGRESIVA ---
      if (config && config.cycleSleepSeconds) {
        setCountdown(parseInt(config.cycleSleepSeconds, 10));
        setIsCountdownActive(true);
      }
      // -----------------------------
      return true; // Éxito
    } catch (error) {
      console.error('Error starting bots:', error);
      // El mensaje de error se maneja en BotControls
      setBotsRunning(false); // Asegurarse de que el estado refleje el fallo
      setTimerActive(false);
      setIsCountdownActive(false); // <--- DETENER CUENTA REGRESIVA EN ERROR
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
      setTimerActive(false); // <--- DETENER TEMPORIZADOR

      // --- DETENER Y RESETEAR CUENTA REGRESIVA ---
      setIsCountdownActive(false);
      if (config && config.cycleSleepSeconds) {
        setCountdown(parseInt(config.cycleSleepSeconds, 10));
      }
      // ----------------------------------------
      // --- RESETEAR PNL EN CABECERA AL DETENER BOTS ---
      // setHeaderPnlData({ totalPnl: headerPnlData.totalPnl, coinCount: 0 }); // Mantener PNL histórico, pero 0 monedas activas si así se decide.
      // O resetear completamente si se prefiere:
      // setHeaderPnlData({ totalPnl: 0, coinCount: 0 }); // Esto resetearía el PNL histórico en cabecera
      // Por ahora, dejaremos que StatusDisplay siga actualizando el PnL histórico incluso si los bots se detienen.
      // El coinCount se actualizará desde StatusDisplay según los workers que realmente estén listados.
      // --- NO RESETEAR PNL AL INICIO DE SESIÓN AL DETENER ---
      // No se toca pnlAtSessionStart aquí para que persista.
      // ---------------------------------------------
      return true; // Considerar éxito para la UI incluso si hubo error leve
    } catch (error) {
      console.error('Error sending shutdown signal:', error);
      // El mensaje de error se maneja en BotControls
       setBotsRunning(false); // Asegurarse de que el estado refleje el fallo
      setTimerActive(false);
      setIsCountdownActive(false); // <--- DETENER CUENTA REGRESIVA EN ERROR
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

  useEffect(() => {
    if (timerActive) {
      intervalRef.current = setInterval(() => {
        setElapsedTime(prevTime => prevTime + 1);
      }, 1000);
    } else {
      clearInterval(intervalRef.current);
    }
    return () => {
      clearInterval(intervalRef.current);
    };
  }, [timerActive]);

  // --- USEEFFECT PARA LA LÓGICA DE LA CUENTA REGRESIVA ---
  useEffect(() => {
    if (isCountdownActive && config && config.cycleSleepSeconds) {
      const cycleDuration = parseInt(config.cycleSleepSeconds, 10);
      if (countdown <= 0) { // Si llega a 0 (o es negativo por alguna razón)
        setCountdown(cycleDuration); // Reiniciar al valor de la config
      }
      
      countdownIntervalRef.current = setInterval(() => {
        setCountdown(prevCountdown => {
          if (prevCountdown <= 1) { // Si está en 1, el próximo será 0, así que reinicia
            return cycleDuration;
          }
          return prevCountdown - 1;
        });
      }, 1000);
    } else {
      clearInterval(countdownIntervalRef.current);
      // Si se detiene, pero tenemos config, resetear countdown a su valor base
      if (config && config.cycleSleepSeconds) {
        setCountdown(parseInt(config.cycleSleepSeconds, 10));
      }
    }
    return () => {
      clearInterval(countdownIntervalRef.current);
    };
  }, [isCountdownActive, config, countdown]); // Incluir countdown como dependencia para re-evaluar si se reinicia.
  // --------------------------------------------------------

  // --- USEEFFECT PARA ACTUALIZAR ALTO Y BAJO PNL DE SESIÓN ---
  useEffect(() => {
    if (pnlAtSessionStart !== null) {
      const currentSessionPnl = headerPnlData.totalPnl - pnlAtSessionStart;

      setSessionPnlHigh(prevHigh => {
        // prevHigh es 0 justo después de handleStartBots.
        // Si prevHigh fuera null (caso inicial antes de cualquier sesión), lo trataríamos.
        // Pero como lo seteamos a 0 en handleStartBots, esta comparación es segura.
        return Math.max(prevHigh === null ? currentSessionPnl : prevHigh, currentSessionPnl);
      });

      setSessionPnlLow(prevLow => {
        // prevLow es 0 justo después de handleStartBots.
        return Math.min(prevLow === null ? currentSessionPnl : prevLow, currentSessionPnl);
      });
    }
    // pnlAtSessionStart en las dependencias asegura que esto se re-evalúe si una nueva sesión comienza
    // (aunque los valores de high/low se resetean en handleStartBots).
    // headerPnlData.totalPnl asegura que se actualiza cuando el PNL total cambia.
  }, [headerPnlData.totalPnl, pnlAtSessionStart]);
  // -----------------------------------------------------------

  return (
    <div className="min-h-screen bg-primary-50 dark:bg-primary-950 text-gray-900 dark:text-gray-100">
      <div className="sticky top-0 z-50 bg-yellow-400 text-black p-3 shadow-md flex items-center justify-between">
        {/* Título a la izquierda */}
        <div className="flex-1 min-w-0"> {/* Contenedor para el título y nombre de estrategia */}
          <div className="text-xl font-bold truncate">
            BOT BINANCE LIMIT-SLTP
          </div>
          {activeStrategyDisplayName && (
            <div className="text-sm font-semibold text-blue-800 truncate"> {/* Nombre de la estrategia en nueva línea */}
              ({activeStrategyDisplayName})
            </div>
          )}
        </div>
        
        {/* PNL Info en el CENTRO */}
        <div className="flex-initial px-4"> {/* Volvemos al contenedor original no-flex para el PNL */}
          <div className="text-lg font-semibold text-center"> {/* Contenedor que centra todo el texto de PNL */}
            <span>PNL {headerPnlData.coinCount} monedas = </span>
            <span
              className={`text-4xl ${headerPnlData.totalPnl < 0 ? 'text-red-600' : headerPnlData.totalPnl > 0 ? 'text-green-600' : 'text-black'}`}
            >
              {headerPnlData.totalPnl.toFixed(5)}
            </span>
            <span className="text-lg"> USDT</span>
            
            {/* PNL de Sesión (Actual, y luego Alto/Bajo) */}
            {pnlAtSessionStart !== null && (
              <span className="ml-3 align-baseline" style={{ display: 'inline-block' }}> {/* Contenedor principal para Sesión y Alto/Bajo */}
                {/* PNL de Sesión Actual - en línea */}
                <span className="text-lg mr-4">
                  <span>Sesión: </span>
                  <span
                    className={`font-semibold ${ (headerPnlData.totalPnl - pnlAtSessionStart) < 0 ? 'text-red-700 dark:text-red-500' : (headerPnlData.totalPnl - pnlAtSessionStart) > 0 ? 'text-green-700 dark:text-green-500' : 'text-black dark:text-white' }`}
                  >
                    {`${(headerPnlData.totalPnl - pnlAtSessionStart).toFixed(5)}`}
                  </span>
                  <span> USDT</span>
                </span>

                {/* Bloque para Alto y Bajo - en línea, pero con divs internos para apilar Alto/Bajo */}
                <span className="text-xs leading-tight" style={{ display: 'inline-block', verticalAlign: 'middle'}}>
                  {/* Alto de Sesión */}
                  <div>
                    <span className="mr-1">Alto:</span>
                    <span
                      className={`font-semibold ${sessionPnlHigh < 0 ? 'text-red-600 dark:text-red-400' : sessionPnlHigh > 0 ? 'text-green-600 dark:text-green-400' : 'text-black dark:text-white'}`}
                    >
                      {`${sessionPnlHigh !== null ? sessionPnlHigh.toFixed(5) : '0.00000'}`}
                    </span>
                    <span> USDT</span>
                  </div>
                  
                  {/* Bajo de Sesión */}
                  <div>
                    <span className="mr-1">Bajo:</span>
                    <span
                      className={`font-semibold ${sessionPnlLow < 0 ? 'text-red-600 dark:text-red-400' : sessionPnlLow > 0 ? 'text-green-600 dark:text-green-400' : 'text-black dark:text-white'}`}
                    >
                      {`${sessionPnlLow !== null ? sessionPnlLow.toFixed(5) : '0.00000'}`}
                    </span>
                    <span> USDT</span>
                  </div>
                </span>
              </span>
            )}
          </div>
        </div>
        
        {/* Temporizadores a la derecha */}
        <div className="flex-1 flex items-center justify-end space-x-6 min-w-0"> {/* Contenedor para temporizadores, empujados a la derecha */} 
          {/* --- TIEMPO ACTIVO --- */}
          {(botsRunning !== null) && (
            <div className="text-lg">
              <span className="font-semibold">Tiempo Activo: </span>
              <span className="text-xl font-mono bg-yellow-500 text-black px-2 py-1 rounded">
                {formatElapsedTime(elapsedTime)}
              </span>
            </div>
          )}

          {/* --- TEMPORIZADOR DE CUENTA REGRESIVA (SIGUIENTE CICLO) --- */}
          {botsRunning && config && (
            <div className="text-lg">
              <span className="font-semibold">Siguiente Ciclo: </span>
              <span className="text-xl font-mono bg-yellow-500 text-black px-2 py-1 rounded">
                {formatElapsedTime(countdown)}
              </span>
            </div>
          )}
        </div>
        
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
                <ConfigForm 
                  initialConfig={config} 
                  onSave={handleSave} 
                  availableStrategies={availableStrategies}
                  onRefreshStrategies={fetchAvailableStrategies}
                  isLoadingStrategies={isLoadingStrategies}
                  strategyError={strategyError}
                  onStrategyNameChange={handleStrategyNameChange}
                />
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