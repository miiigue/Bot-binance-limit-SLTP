import React, { useState, useEffect, useCallback, useRef } from 'react';
import ConfigForm from './ConfigForm';
import StatusDisplay from './StatusDisplay';
import TradingViewChart from './TradingViewChart';
import PnLPerformanceChart from './PnLPerformanceChart';
import MarketExplorer from './MarketExplorer';
import ToastContainer from './ToastContainer';
import { isSoundEnabled, setSoundEnabled, playProfitSound, playEntrySound, playLossSound } from './soundEffects';
import './index.css';

const formatElapsedTime = (totalSeconds) => {
  const hours = Math.floor(totalSeconds / 3600);
  const minutes = Math.floor((totalSeconds % 3600) / 60);
  const seconds = totalSeconds % 60;
  const pad = (num) => String(num).padStart(2, '0');
  return `${pad(hours)}:${pad(minutes)}:${pad(seconds)}`;
};

function App() {
  const [config, setConfig] = useState(null);
  const [botsRunning, setBotsRunning] = useState(null);
  const [initialLoadingError, setInitialLoadingError] = useState(null);

  const [headerPnlData, setHeaderPnlData] = useState({ 
    totalPnl: 0, 
    coinCount: 0, 
    coinsInPosition: 0,
    sessionStats: {
      session_pnl: 0,
      session_high: 0,
      session_low: 0
    }
  });

  const [elapsedTime, setElapsedTime] = useState(0);
  const [timerActive, setTimerActive] = useState(false);
  const intervalRef = useRef(null);

  const [countdown, setCountdown] = useState(0);
  const [isCountdownActive, setIsCountdownActive] = useState(false);
  const countdownIntervalRef = useRef(null);

  const [availableStrategies, setAvailableStrategies] = useState([]);
  const [isLoadingStrategies, setIsLoadingStrategies] = useState(false);
  const [strategyError, setStrategyError] = useState(null);
  const [activeStrategyDisplayName, setActiveStrategyDisplayName] = useState('');

  // Pestañas: 'monitor', 'config', 'chart', 'performance', 'radar'
  const [activeTab, setActiveTab] = useState('monitor');
  const [chartSelectedSymbol, setChartSelectedSymbol] = useState('SOLUSDT');

  // Sistema de Audio y Notificaciones Toast
  const [soundOn, setSoundOn] = useState(() => isSoundEnabled());
  const [toasts, setToasts] = useState([]);
  const lastPnlRef = useRef(null);
  const lastInPosCoinsRef = useRef(null);

  const addToast = useCallback((title, message, type = 'info') => {
    const id = 'toast_' + Date.now() + '_' + Math.random().toString(36).substring(2, 5);
    const time = new Date().toLocaleTimeString();
    setToasts(prev => [...prev.slice(-4), { id, title, message, type, time }]);
    setTimeout(() => {
      setToasts(prev => prev.filter(t => t.id !== id));
    }, 6000);
  }, []);

  const removeToast = useCallback((id) => {
    setToasts(prev => prev.filter(t => t.id !== id));
  }, []);

  const handleToggleSound = () => {
    const next = !soundOn;
    setSoundOn(next);
    setSoundEnabled(next);
    if (next) {
      playEntrySound();
      addToast('🔊 Sonido Activado', 'Efectos sonoros de trading habilitados.', 'info');
    }
  };

  const handleStatusUpdate = useCallback((data) => {
    setHeaderPnlData(prevData => ({ ...prevData, ...data }));

    if (data?.sessionStats) {
      if (data.sessionStats.active_session) {
        setTimerActive(true);
        if (data.sessionStats.elapsed_seconds !== undefined) {
          setElapsedTime(data.sessionStats.elapsed_seconds);
        }
      } else {
        setTimerActive(false);
      }

      // Detección de eventos para alertas sonoras y notificaciones
      if (lastPnlRef.current !== null && data.sessionStats.session_pnl !== undefined) {
        const diff = data.sessionStats.session_pnl - lastPnlRef.current;
        if (diff > 0.05) {
          playProfitSound();
          addToast('🎉 Take Profit Alcanzado!', `+${diff.toFixed(4)} USDT ganados en la sesión.`, 'success');
        } else if (diff < -0.30) {
          playLossSound();
          addToast('🛑 Stop Loss Ejecutado', `${diff.toFixed(4)} USDT en la sesión.`, 'error');
        }
      }
      if (data.sessionStats.session_pnl !== undefined) {
        lastPnlRef.current = data.sessionStats.session_pnl;
      }
    }

    if (lastInPosCoinsRef.current !== null && data?.coinsInPosition !== undefined) {
      if (data.coinsInPosition > lastInPosCoinsRef.current) {
        playEntrySound();
        addToast('🔵 Nueva Posición Abierta', `El bot abrió una operación (${data.coinsInPosition} en curso).`, 'info');
      }
    }
    if (data?.coinsInPosition !== undefined) {
      lastInPosCoinsRef.current = data.coinsInPosition;
    }
  }, [addToast]);

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
      setAvailableStrategies([]);
    } finally {
      setIsLoadingStrategies(false);
    }
  }, []);

  useEffect(() => {
    const fetchConfig = async () => {
      try {
        const response = await fetch('/api/config');
        if (!response.ok) {
          throw new Error(`HTTP error! status: ${response.status}`);
        }
        const data = await response.json();
        setConfig(data);
        if (data && data.cycleSleepSeconds) {
          setCountdown(parseInt(data.cycleSleepSeconds, 10));
        }
      } catch (error) {
        console.error("Error fetching initial configuration:", error);
        setInitialLoadingError("No se pudo cargar la configuración inicial. Asegúrate de que el servidor backend esté corriendo.");
      }
    };

    fetchConfig();
    fetchAvailableStrategies();
  }, [fetchAvailableStrategies]);

  const handleSave = async (newConfig) => {
    try {
      const response = await fetch('/api/config', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(newConfig),
      });
      if (!response.ok) {
        const errorData = await response.json().catch(() => ({ error: "Error desconocido del servidor" }));
        throw new Error(errorData.error || `HTTP error ${response.status}`);
      }
      const savedConfig = await response.json();
      setConfig(savedConfig);
      addToast('✓ Configuración Guardada', 'Los parámetros se han actualizado exitosamente.', 'success');
      return { success: true };
    } catch (error) {
      console.error("Error saving configuration:", error);
      addToast('Error al Guardar', error.message, 'error');
      return { error: error.message };
    }
  };

  const handleStartBots = async () => {
    try {
      const response = await fetch('/api/start_bots', { method: 'POST' });
      if (!response.ok) {
        const errorData = await response.json().catch(() => ({ error: "Error desconocido" }));
        throw new Error(errorData.error || `HTTP error ${response.status}`);
      }
      setBotsRunning(true);
      playEntrySound();
      addToast('🚀 Bots Iniciados', 'Todos los workers están analizando el mercado.', 'success');
      return { success: true };
    } catch (error) {
      console.error("Error starting bots:", error);
      addToast('Error al Iniciar Bots', error.message, 'error');
      return { error: error.message };
    }
  };

  const handleShutdown = async () => {
    try {
      const response = await fetch('/api/shutdown', { method: 'POST' });
      if (!response.ok) {
        const errorData = await response.json().catch(() => ({ error: "Error desconocido" }));
        throw new Error(errorData.error || `HTTP error ${response.status}`);
      }
      setBotsRunning(false);
      addToast('🛑 Bots Detenidos', 'Todos los procesos han sido pausados.', 'info');
      return { success: true };
    } catch (error) {
      console.error("Error stopping bots:", error);
      addToast('Error al Detener Bots', error.message, 'error');
      return { error: error.message };
    }
  };

  const handleStrategyNameChange = (displayName) => {
    setActiveStrategyDisplayName(displayName);
  };

  const handleSelectSymbolForChart = (sym) => {
    setChartSelectedSymbol(sym);
    setActiveTab('chart');
    window.scrollTo({ top: 0, behavior: 'smooth' });
  };

  return (
    <div className="min-h-screen bg-primary-50 dark:bg-primary-950 text-gray-900 dark:text-gray-100">
      {/* Cabecera Amarilla Sticky */}
      <div className="sticky top-0 z-50 bg-yellow-400 text-black p-3 shadow-md flex items-center justify-between">
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2">
            <span className="text-xl font-bold truncate">BOT BINANCE LIMIT-SLTP</span>
            <span className="bg-green-800 text-white text-xs px-2 py-0.5 rounded font-mono font-semibold shadow">
              🛡️ TESTNET DEMO
            </span>
            <button
              type="button"
              onClick={handleToggleSound}
              className={`ml-2 px-2 py-0.5 rounded text-[11px] font-bold transition flex items-center gap-1 shadow-sm ${
                soundOn ? 'bg-emerald-950 text-emerald-300' : 'bg-gray-800 text-gray-400'
              }`}
              title={soundOn ? 'Silenciar sonidos' : 'Activar alertas sonoras'}
            >
              <span>{soundOn ? '🔊 ON' : '🔇 OFF'}</span>
            </button>
          </div>
          {activeStrategyDisplayName && (
            <div className="text-sm font-semibold text-blue-800 truncate">
              ({activeStrategyDisplayName})
            </div>
          )}
        </div>
        
        {/* PNL Info Central */}
        <div className="flex-initial px-4">
          <div className="text-lg font-semibold text-center">
            <span>PNL {headerPnlData.coinCount} monedas ({headerPnlData.coinsInPosition || 0}) = </span>
            <span className={`text-4xl ${headerPnlData.totalPnl < 0 ? 'text-red-600' : headerPnlData.totalPnl > 0 ? 'text-green-600' : 'text-black'}`}>
              {headerPnlData.totalPnl.toFixed(5)}
            </span>
            <span className="text-lg"> USDT</span>
            
            {botsRunning && headerPnlData.sessionStats && (
              <span className="ml-3 align-baseline" style={{ display: 'inline-block' }}>
                <span className="text-lg mr-4">
                  <span>Sesión: </span>
                  <span className={`font-semibold ${(headerPnlData.sessionStats.session_pnl) < 0 ? 'text-red-700 dark:text-red-500' : (headerPnlData.sessionStats.session_pnl) > 0 ? 'text-green-700 dark:text-green-500' : 'text-black dark:text-white'}`}>
                    {`${(headerPnlData.sessionStats.session_pnl).toFixed(5)}`}
                  </span>
                  <span> USDT</span>
                </span>

                <span className="text-xs leading-tight" style={{ display: 'inline-block', verticalAlign: 'middle'}}>
                  <div>
                    <span className="mr-1">Alto:</span>
                    <span className={`font-semibold ${headerPnlData.sessionStats.session_high < 0 ? 'text-red-600 dark:text-red-400' : headerPnlData.sessionStats.session_high > 0 ? 'text-green-600 dark:text-green-400' : 'text-black dark:text-white'}`}>
                      {`${headerPnlData.sessionStats.session_high.toFixed(5)}`}
                    </span>
                    <span> USDT</span>
                  </div>
                  <div>
                    <span className="mr-1">Bajo:</span>
                    <span className={`font-semibold ${headerPnlData.sessionStats.session_low < 0 ? 'text-red-600 dark:text-red-400' : headerPnlData.sessionStats.session_low > 0 ? 'text-green-600 dark:text-green-400' : 'text-black dark:text-white'}`}>
                      {`${headerPnlData.sessionStats.session_low.toFixed(5)}`}
                    </span>
                    <span> USDT</span>
                  </div>
                </span>
              </span>
            )}
          </div>
        </div>
        
        {/* Temporizadores */}
        <div className="flex-1 flex items-center justify-end space-x-6 min-w-0">
          {(botsRunning !== null) && (
            <div className="text-lg">
              <span className="font-semibold">Tiempo Activo: </span>
              <span className="text-xl font-mono bg-yellow-500 text-black px-2 py-1 rounded">
                {formatElapsedTime(elapsedTime)}
              </span>
            </div>
          )}
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

      {/* --- BARRA DE NAVEGACIÓN POR PESTAÑAS (5 Pestañas) --- */}
      <div className="bg-white dark:bg-gray-900 border-b border-gray-200 dark:border-gray-800 px-4 md:px-8 py-2.5 flex flex-wrap items-center justify-between gap-3 shadow-sm sticky top-[62px] z-40">
        <div className="flex flex-wrap items-center gap-2">
          {/* Pestaña 1: Monitor en Vivo */}
          <button
            type="button"
            onClick={() => setActiveTab('monitor')}
            className={`px-3.5 py-1.5 text-xs sm:text-sm font-bold rounded-xl transition-all flex items-center gap-2 ${
              activeTab === 'monitor'
                ? 'bg-yellow-500 text-black shadow-md ring-2 ring-yellow-400/40'
                : 'text-gray-600 dark:text-gray-300 hover:bg-gray-100 dark:hover:bg-gray-800 border border-transparent'
            }`}
          >
            <span>🖥️</span> Monitor en Vivo
            {headerPnlData.coinsInPosition > 0 && (
              <span className="text-xs bg-emerald-500 text-white font-mono px-1.5 py-0.2 rounded-full shadow">
                {headerPnlData.coinsInPosition} en posición
              </span>
            )}
          </button>

          {/* Pestaña 2: Configuración y Estrategias */}
          <button
            type="button"
            onClick={() => setActiveTab('config')}
            className={`px-3.5 py-1.5 text-xs sm:text-sm font-bold rounded-xl transition-all flex items-center gap-2 ${
              activeTab === 'config'
                ? 'bg-yellow-500 text-black shadow-md ring-2 ring-yellow-400/40'
                : 'text-gray-600 dark:text-gray-300 hover:bg-gray-100 dark:hover:bg-gray-800 border border-transparent'
            }`}
          >
            <span>⚙️</span> Configuración y Estrategias
          </button>

          {/* Pestaña 3: Mosaico de Gráficos TradingView */}
          <button
            type="button"
            onClick={() => setActiveTab('chart')}
            className={`px-3.5 py-1.5 text-xs sm:text-sm font-bold rounded-xl transition-all flex items-center gap-2 ${
              activeTab === 'chart'
                ? 'bg-yellow-500 text-black shadow-md ring-2 ring-yellow-400/40'
                : 'text-gray-600 dark:text-gray-300 hover:bg-gray-100 dark:hover:bg-gray-800 border border-transparent'
            }`}
          >
            <span>📊</span> Mosaico de Gráficos (TradingView)
          </button>

          {/* Pestaña 4: Rendimiento & PnL */}
          <button
            type="button"
            onClick={() => setActiveTab('performance')}
            className={`px-3.5 py-1.5 text-xs sm:text-sm font-bold rounded-xl transition-all flex items-center gap-2 ${
              activeTab === 'performance'
                ? 'bg-yellow-500 text-black shadow-md ring-2 ring-yellow-400/40'
                : 'text-gray-600 dark:text-gray-300 hover:bg-gray-100 dark:hover:bg-gray-800 border border-transparent'
            }`}
          >
            <span>📈</span> Rendimiento & PnL
          </button>

          {/* Pestaña 5: Radar y Escáner de Mercado */}
          <button
            type="button"
            onClick={() => setActiveTab('radar')}
            className={`px-3.5 py-1.5 text-xs sm:text-sm font-bold rounded-xl transition-all flex items-center gap-2 ${
              activeTab === 'radar'
                ? 'bg-yellow-500 text-black shadow-md ring-2 ring-yellow-400/40'
                : 'text-gray-600 dark:text-gray-300 hover:bg-gray-100 dark:hover:bg-gray-800 border border-transparent'
            }`}
          >
            <span>📡</span> Radar de Mercado
          </button>
        </div>

        {/* Indicador de Monedas configuradas */}
        {config?.symbolsToTrade && (
          <div className="text-xs text-gray-500 dark:text-gray-400 flex items-center gap-1 hidden md:flex">
            <span>🪙 Monedas:</span>
            <span className="font-semibold text-gray-700 dark:text-gray-300 font-mono">
              {config.symbolsToTrade.split(',').filter(Boolean).length} pares
            </span>
          </div>
        )}
      </div>

      <div className="w-full px-4 md:px-8 py-6 max-w-full">
        {initialLoadingError && (
          <div className="mb-6 p-4 bg-red-100 dark:bg-red-900 border border-red-400 dark:border-red-700 text-red-700 dark:text-red-200 rounded-lg">
             <p className="font-semibold text-center">Error de Carga</p>
             <p className="text-center">{initialLoadingError}</p>
           </div>
        )}

        {!initialLoadingError && (
          <>
            {/* PESTAÑA 1: Monitor en Vivo */}
            <div className={activeTab === 'monitor' ? 'block' : 'hidden'}>
              <StatusDisplay 
                  botsRunning={botsRunning} 
                  onStart={handleStartBots} 
                  onShutdown={handleShutdown} 
                  onStatusUpdate={handleStatusUpdate}
                  onSelectSymbolForChart={handleSelectSymbolForChart}
              /> 
            </div>

            {/* PESTAÑA 2: Configuración y Estrategias */}
            <div className={activeTab === 'config' ? 'block' : 'hidden'}>
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
            </div>

            {/* PESTAÑA 3: Mosaico de Gráficos TradingView */}
            {activeTab === 'chart' && (
              <TradingViewChart
                selectedSymbol={chartSelectedSymbol}
                symbolsList={config?.symbolsToTrade ? config.symbolsToTrade.split(',').map(s => s.trim().toUpperCase()).filter(Boolean) : []}
                onSelectSymbol={(sym) => setChartSelectedSymbol(sym)}
              />
            )}

            {/* PESTAÑA 4: Rendimiento Financiero y Curva de PnL */}
            {activeTab === 'performance' && (
              <PnLPerformanceChart
                symbolsList={config?.symbolsToTrade ? config.symbolsToTrade.split(',').map(s => s.trim().toUpperCase()).filter(Boolean) : []}
              />
            )}

            {/* PESTAÑA 5: Radar y Escáner de Mercado */}
            {activeTab === 'radar' && (
              <MarketExplorer
                config={config}
                onSaveConfig={handleSave}
                onSelectSymbolForChart={handleSelectSymbolForChart}
              />
            )}
          </>
        )}
      </div>

      {/* Contenedor de Notificaciones Toast Flotantes */}
      <ToastContainer toasts={toasts} onDismiss={removeToast} />
    </div>
  );
}

export default App;
