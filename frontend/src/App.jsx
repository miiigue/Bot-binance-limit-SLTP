import React, { useState, useEffect, useCallback, useRef } from 'react';
import ConfigForm from './ConfigForm';
import StatusDisplay from './StatusDisplay';
import TradingViewChart from './TradingViewChart';
import PnLPerformanceChart from './PnLPerformanceChart';
import MarketExplorer from './MarketExplorer';
import BotControls from './BotControls';
import ToastContainer from './ToastContainer';
import BacktestLab from './BacktestLab';
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
  const [countdown, setCountdown] = useState(0);

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
  const lastClosedPnlRef = useRef(null);
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
    if (data?.bots_running !== undefined) {
      setBotsRunning(data.bots_running);
    }

    if (data?.sessionStats) {
      if (data.sessionStats.elapsed_seconds !== undefined) {
        setElapsedTime(data.sessionStats.elapsed_seconds);
      }
    }

    // Detección de eventos: SOLO disparar cuando un trade REALMENTE se cierra (PnL realizado definitivo)
    const currentClosedPnl = data?.historicalPnl !== undefined 
      ? Number(data.historicalPnl)
      : (data?.sessionStats?.session_realized_pnl !== undefined ? Number(data.sessionStats.session_realized_pnl) : null);

    if (lastClosedPnlRef.current !== null && currentClosedPnl !== null) {
      const diff = currentClosedPnl - lastClosedPnlRef.current;
      if (diff > 0.005) {
        playProfitSound();
        addToast('🎉 Take Profit Confirmado!', `+${diff.toFixed(4)} USDT asegurados en balance.`, 'success');
      } else if (diff < -0.005) {
        playLossSound();
        addToast('🛑 Stop Loss Ejecutado', `${diff.toFixed(4)} USDT.`, 'error');
      }
    }
    if (currentClosedPnl !== null) {
      lastClosedPnlRef.current = currentClosedPnl;
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

  const handleStrategyNameChange = useCallback((displayName) => {
    setActiveStrategyDisplayName(displayName || '');
  }, []);

  const handleSelectSymbolForChart = (sym) => {
    setChartSelectedSymbol(sym);
    setActiveTab('chart');
    window.scrollTo({ top: 0, behavior: 'smooth' });
  };

  const handleApplyStrategyToConfig = async (newConfig) => {
    const res = await handleSave(newConfig);
    if (res?.success) {
      addToast('🚀 Estrategia Aplicada', 'Los parámetros de la simulación ahora están activos en el bot en vivo.', 'success');
      setActiveTab('config');
    }
  };

  return (
    <div className="min-h-screen bg-primary-50 dark:bg-primary-950 text-gray-900 dark:text-gray-100">
      {/* HEADER UNIFICADO FIJO (Elimina vibraciones y saltos de pantalla) */}
      <header className="sticky top-0 z-50 shadow-md">
        {/* 1. Barra Amarilla Principal */}
        <div className="bg-yellow-400 text-black px-4 py-2.5 flex items-center justify-between border-b border-yellow-500/40">
          <div className="flex-1 min-w-0">
            <div className="flex items-center gap-2">
              <span className="text-lg font-bold truncate">BOT BINANCE LIMIT-SLTP</span>
              <span className="bg-green-800 text-white text-[10px] px-2 py-0.5 rounded font-mono font-semibold shadow">
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
            <div className="text-xs font-semibold text-blue-900 truncate min-h-[16px]">
              {activeStrategyDisplayName ? `(${activeStrategyDisplayName})` : ''}
            </div>
          </div>
          
          {/* PNL Info Central */}
          <div className="flex-initial px-3">
            <div className="text-base font-semibold text-center flex items-center gap-2">
              <span>PNL {headerPnlData?.coinCount || 0} monedas ({headerPnlData?.coinsInPosition || 0}) = </span>
              <span className={`text-2xl font-mono font-bold ${(Number(headerPnlData?.totalPnl) || 0) < 0 ? 'text-red-600' : (Number(headerPnlData?.totalPnl) || 0) > 0 ? 'text-green-700' : 'text-black'}`}>
                {(Number(headerPnlData?.totalPnl) || 0).toFixed(5)}
              </span>
              <span className="text-xs font-semibold">USDT</span>
              
              {botsRunning && headerPnlData?.sessionStats && (
                <span className="ml-2 text-xs flex items-center gap-2 bg-yellow-500/50 px-2 py-0.5 rounded font-mono">
                  <span>Sesión:</span>
                  <span className={`font-bold ${(Number(headerPnlData.sessionStats.session_pnl) || 0) < 0 ? 'text-red-700' : (Number(headerPnlData.sessionStats.session_pnl) || 0) > 0 ? 'text-green-800' : 'text-black'}`}>
                    {`${(Number(headerPnlData.sessionStats.session_pnl) || 0).toFixed(4)}`} USDT
                  </span>
                </span>
              )}
            </div>
          </div>
          
          {/* Temporizadores a la Derecha */}
          <div className="flex-1 flex items-center justify-end space-x-3 min-w-0">
            {botsRunning && (
              <div className="text-xs flex items-center gap-1.5 whitespace-nowrap">
                <span className="font-semibold text-gray-800">Activo:</span>
                <span className="font-mono font-bold bg-yellow-500 text-black px-2 py-0.5 rounded text-xs shadow-sm">
                  {formatElapsedTime(elapsedTime)}
                </span>
              </div>
            )}
            {botsRunning && config && (
              <div className="text-xs flex items-center gap-1.5 whitespace-nowrap">
                <span className="font-semibold text-gray-800">Ciclo:</span>
                <span className="font-mono font-bold bg-yellow-500 text-black px-2 py-0.5 rounded text-xs shadow-sm">
                  {formatElapsedTime(countdown)}
                </span>
              </div>
            )}
          </div>
        </div>

        {/* 2. Barra de Navegación por Pestañas */}
        <div className="bg-white dark:bg-gray-900 border-b border-gray-200 dark:border-gray-800 px-4 md:px-8 py-2 flex flex-wrap items-center justify-between gap-2">
          <div className="flex flex-wrap items-center gap-1.5 sm:gap-2">
            {/* Pestaña 1: Monitor en Vivo */}
            <button
              type="button"
              onClick={() => setActiveTab('monitor')}
              className={`px-3 py-1.5 text-xs sm:text-sm font-bold rounded-xl transition-all flex items-center gap-1.5 ${
                activeTab === 'monitor'
                  ? 'bg-yellow-500 text-black shadow-md ring-2 ring-yellow-400/40'
                  : 'text-gray-600 dark:text-gray-300 hover:bg-gray-100 dark:hover:bg-gray-800 border border-transparent'
              }`}
            >
              <span>🖥️</span> Monitor en Vivo
              {headerPnlData.coinsInPosition > 0 && (
                <span className="text-[10px] bg-emerald-500 text-white font-mono px-1.5 py-0.2 rounded-full shadow">
                  {headerPnlData.coinsInPosition} en pos
                </span>
              )}
            </button>

            {/* Pestaña 2: Configuración y Estrategias */}
            <button
              type="button"
              onClick={() => setActiveTab('config')}
              className={`px-3 py-1.5 text-xs sm:text-sm font-bold rounded-xl transition-all flex items-center gap-1.5 ${
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
              className={`px-3 py-1.5 text-xs sm:text-sm font-bold rounded-xl transition-all flex items-center gap-1.5 ${
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
              className={`px-3 py-1.5 text-xs sm:text-sm font-bold rounded-xl transition-all flex items-center gap-1.5 ${
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
              className={`px-3 py-1.5 text-xs sm:text-sm font-bold rounded-xl transition-all flex items-center gap-1.5 ${
                activeTab === 'radar'
                  ? 'bg-yellow-500 text-black shadow-md ring-2 ring-yellow-400/40'
                  : 'text-gray-600 dark:text-gray-300 hover:bg-gray-100 dark:hover:bg-gray-800 border border-transparent'
              }`}
            >
              <span>📡</span> Radar de Mercado
            </button>

            {/* Pestaña 6: Laboratorio de Backtesting */}
            <button
              type="button"
              onClick={() => setActiveTab('backtest')}
              className={`px-3 py-1.5 text-xs sm:text-sm font-bold rounded-xl transition-all flex items-center gap-1.5 ${
                activeTab === 'backtest'
                  ? 'bg-yellow-500 text-black shadow-md ring-2 ring-yellow-400/40'
                  : 'text-gray-600 dark:text-gray-300 hover:bg-gray-100 dark:hover:bg-gray-800 border border-transparent'
              }`}
            >
              <span>🧪</span> Backtesting & Laboratorio
            </button>
          </div>

          {/* CONTROLES GLOBALES DE OPERACIÓN (SIEMPRE DISPONIBLES EN TODAS LAS PESTAÑAS) */}
          <div className="flex items-center gap-2">
            <BotControls 
              botsRunning={botsRunning}
              onStart={handleStartBots}
              onShutdown={handleShutdown}
              addToast={addToast}
            />

            {/* Indicador de Monedas configuradas */}
            {config?.symbolsToTrade && (
              <div className="text-xs text-gray-500 dark:text-gray-400 items-center gap-1 hidden xl:flex pl-2 border-l border-gray-200 dark:border-gray-800">
                <span>🪙</span>
                <span className="font-semibold text-gray-700 dark:text-gray-300 font-mono">
                  {config.symbolsToTrade.split(',').filter(Boolean).length} pares
                </span>
              </div>
            )}
          </div>
        </div>
      </header>

      {/* CONTENIDO PRINCIPAL */}
      <main className="w-full px-4 md:px-8 py-6 max-w-full">
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

            {/* PESTAÑA 6: Laboratorio de Backtesting */}
            {activeTab === 'backtest' && (
              <BacktestLab
                activeConfig={config}
                addToast={addToast}
                onApplyStrategyToConfig={handleApplyStrategyToConfig}
              />
            )}
          </>
        )}
      </main>

      {/* Contenedor de Notificaciones Toast Flotantes */}
      <ToastContainer toasts={toasts} onDismiss={removeToast} />
    </div>
  );
}

export default App;
