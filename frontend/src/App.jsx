import React, { useState, useEffect, useCallback, useRef } from 'react';
import { AuthProvider, useAuth } from './AuthContext';
import AuthModal from './AuthModal';
import InvestorPortfolio from './InvestorPortfolio';
import AdminInvestors from './AdminInvestors';
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

function MainDashboard() {
  const { user, isAdmin, isInvestor, isAuthenticated, isLoading, logout, authFetch } = useAuth();

  const [config, setConfig] = useState(null);
  const [botsRunning, setBotsRunning] = useState(null);
  const [initialLoadingError, setInitialLoadingError] = useState(null);

  const [headerPnlData, setHeaderPnlData] = useState({ 
    totalPnl: 0, 
    historicalPnl: 0,
    unrealizedPnl: 0,
    coinCount: 0, 
    coinsInPosition: 0,
    poolBalance: 5000,
    initialCapital: 5000,
    walletPnl: 0,
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

  // Pestañas dinámicas según el rol:
  // Admin: 'monitor', 'config', 'chart', 'performance', 'radar', 'backtest', 'investors'
  // Investor: 'my_investment', 'performance', 'chart'
  const [activeTab, setActiveTab] = useState(isInvestor ? 'my_investment' : 'monitor');
  const [chartSelectedSymbol, setChartSelectedSymbol] = useState('SOLUSDT');

  // Asegurar que si el rol es Inversionista, nunca esté en una pestaña de Admin
  useEffect(() => {
    if (isInvestor && !['my_investment', 'performance', 'chart'].includes(activeTab)) {
      setActiveTab('my_investment');
    }
  }, [isInvestor, activeTab]);

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

    const currentClosedPnl = data?.historicalPnl !== undefined 
      ? Number(data.historicalPnl)
      : (data?.sessionStats?.session_realized_pnl !== undefined ? Number(data.sessionStats.session_realized_pnl) : null);

    const currentCoins = data?.coinsInPosition !== undefined ? data.coinsInPosition : null;
    const coinsDecreased = (lastInPosCoinsRef.current !== null && currentCoins !== null && currentCoins < lastInPosCoinsRef.current);

    if (lastClosedPnlRef.current !== null && currentClosedPnl !== null && coinsDecreased) {
      const diff = currentClosedPnl - lastClosedPnlRef.current;
      if (diff > 0.0001) {
        playProfitSound();
        addToast(
          '🟢 ¡Operación Ganadora Cerrada!',
          `Ganancia neta: +$${diff.toFixed(2)} USDT. ¡Excelente trade!`,
          'success'
        );
      } else if (diff < -0.0001) {
        playLossSound();
        addToast(
          '🔴 Operación con Stop Loss Cerrada',
          `Resultado: -$${Math.abs(diff).toFixed(2)} USDT. Capital protegido.`,
          'warning'
        );
      }
    }

    if (currentClosedPnl !== null) {
      lastClosedPnlRef.current = currentClosedPnl;
    }
    if (currentCoins !== null) {
      lastInPosCoinsRef.current = currentCoins;
    }
  }, [addToast]);

  // --- SONDEO GLOBAL DEL ESTADO (Garantiza datos de flotante y pool en cualquier pestaña y rol) ---
  useEffect(() => {
    if (!isAuthenticated) return;
    let isMounted = true;

    const fetchGlobalStatus = async () => {
      try {
        const resp = await authFetch('/api/status');
        if (!resp.ok) return;
        const data = await resp.json();
        if (!isMounted) return;

        const sorted = data.statuses || [];
        const coinsInPos = sorted.filter(s => s.in_position).length;
        const authoritativeTotalPnl = (data?.global_db_metrics && data.global_db_metrics.total_pnl !== undefined)
          ? parseFloat(data.global_db_metrics.total_pnl)
          : sorted.reduce((acc, s) => acc + (parseFloat(s.historical_pnl) || 0), 0);
        const authoritativeUnrealizedPnl = parseFloat(data.total_unrealized_pnl || 0);
        const bal = (data.account_balance !== undefined && data.account_balance !== null) ? parseFloat(data.account_balance) : 5000;
        const initCap = (data.initial_capital !== undefined && data.initial_capital !== null) ? parseFloat(data.initial_capital) : 5000;
        const wPnl = (data.wallet_pnl !== undefined && data.wallet_pnl !== null) ? parseFloat(data.wallet_pnl) : (bal - initCap);

        handleStatusUpdate({
          totalPnl: authoritativeTotalPnl,
          historicalPnl: authoritativeTotalPnl,
          unrealizedPnl: authoritativeUnrealizedPnl,
          coinCount: sorted.length,
          coinsInPosition: coinsInPos,
          poolBalance: bal,
          initialCapital: initCap,
          walletPnl: wPnl,
          sessionStats: data.session_stats,
          globalDbMetrics: data.global_db_metrics,
          bots_running: data.bots_running
        });
      } catch (err) {
        console.debug("Error polling global status:", err);
      }
    };

    fetchGlobalStatus();
    const intervalId = setInterval(fetchGlobalStatus, 3500);
    return () => {
      isMounted = false;
      clearInterval(intervalId);
    };
  }, [isAuthenticated, authFetch, handleStatusUpdate]);

  const fetchAvailableStrategies = useCallback(async () => {
    setIsLoadingStrategies(true);
    setStrategyError(null);
    try {
      const response = await authFetch('/api/strategies');
      if (!response.ok) {
        throw new Error(`Error HTTP: ${response.status}`);
      }
      const data = await response.json();
      const list = Array.isArray(data) ? data : (data?.strategies || []);
      setAvailableStrategies(list);
    } catch (err) {
      console.error("Error al cargar estrategias:", err);
      setStrategyError(err.message);
    } finally {
      setIsLoadingStrategies(false);
    }
  }, [authFetch]);

  useEffect(() => {
    let isMounted = true;
    const fetchInitialConfig = async () => {
      try {
        const response = await authFetch('/api/config');
        if (!response.ok) {
          throw new Error(`HTTP error ${response.status}`);
        }
        const data = await response.json();
        if (isMounted) {
          setConfig(data);
          setInitialLoadingError(null);
          fetchAvailableStrategies();
        }
      } catch (error) {
        console.error("Error fetching initial config:", error);
        if (isMounted) {
          setInitialLoadingError(`Error al cargar la configuración: ${error.message}`);
        }
      }
    };

    fetchInitialConfig();
    return () => { isMounted = false; };
  }, [authFetch, fetchAvailableStrategies]);

  useEffect(() => {
    let timer = null;
    if (botsRunning && config?.cycleSleepSeconds) {
      setCountdown(config.cycleSleepSeconds);
      timer = setInterval(() => {
        setCountdown((prev) => {
          if (prev <= 1) {
            return config.cycleSleepSeconds;
          }
          return prev - 1;
        });
      }, 1000);
    } else {
      setCountdown(0);
    }

    return () => {
      if (timer) clearInterval(timer);
    };
  }, [botsRunning, config]);

  const handleSave = async (newConfig) => {
    try {
      const response = await authFetch('/api/config', {
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
      fetchAvailableStrategies();
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
      const response = await authFetch('/api/start_bots', { method: 'POST' });
      if (!response.ok) {
        const errorData = await response.json().catch(() => ({ error: "Error desconocido" }));
        throw new Error(errorData.error || `HTTP error ${response.status}`);
      }
      setBotsRunning(true);
      playEntrySound();
      return { success: true };
    } catch (error) {
      console.error("Error starting bots:", error);
      addToast('Error al Iniciar Bots', error.message, 'error');
      return { error: error.message };
    }
  };

  const handleShutdown = async () => {
    try {
      const response = await authFetch('/api/shutdown', { method: 'POST' });
      if (!response.ok) {
        const errorData = await response.json().catch(() => ({ error: "Error desconocido" }));
        throw new Error(errorData.error || `HTTP error ${response.status}`);
      }
      setBotsRunning(false);
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

  // 1. PANTALLA DE CARGA INICIAL DE AUTENTICACIÓN
  if (isLoading) {
    return (
      <div className="min-h-screen bg-slate-950 flex flex-col items-center justify-center text-white">
        <div className="w-12 h-12 border-4 border-amber-400 border-t-transparent rounded-full animate-spin mb-4"></div>
        <div className="text-sm font-bold text-slate-400 font-mono">Verificando sesión segura...</div>
      </div>
    );
  }

  // 2. SI NO ESTÁ AUTENTICADO: MOSTRAR MODAL DE LOGIN / REGISTRO / SETUP
  if (!isAuthenticated) {
    return <AuthModal />;
  }

  // 3. DASHBOARD AUTENTICADO
  return (
    <div className="min-h-screen bg-slate-950 text-slate-100">
      {/* HEADER UNIFICADO FIJO */}
      <header className="sticky top-0 z-50 shadow-md">
        {/* 1. Barra Amarilla Principal */}
        <div className="bg-amber-400 text-slate-950 px-3 sm:px-4 py-2 sm:py-2.5 border-b border-amber-500/60 font-medium">
          
          {/* Vista Móvil (< md) */}
          <div className="flex flex-col gap-1.5 md:hidden">
            <div className="flex items-center justify-between gap-1 min-w-0">
              <div className="flex items-center gap-1.5 min-w-0">
                <span className="text-sm font-black tracking-tight text-slate-950 truncate">WTN ALGO-TRADING</span>
                <span className="bg-slate-950 text-amber-300 text-[9px] px-1 py-0.2 rounded font-mono font-bold">
                  {isAdmin ? '👑 ADMIN' : '💼 INVERSOR'}
                </span>
                <button
                  type="button"
                  onClick={handleToggleSound}
                  className={`px-1.5 py-0.2 rounded text-[10px] font-bold ${
                    soundOn ? 'bg-slate-950 text-emerald-300' : 'bg-slate-800 text-slate-300'
                  }`}
                >
                  {soundOn ? '🔊' : '🔇'}
                </button>
              </div>

              {/* Usuario & Logout Móvil */}
              <div className="flex items-center gap-1">
                <span className="text-[11px] font-bold text-slate-900 max-w-[80px] truncate">{user?.username}</span>
                <button
                  type="button"
                  onClick={logout}
                  title="Cerrar Sesión"
                  className="px-2 py-0.5 bg-slate-950 text-rose-300 rounded font-bold text-[10px]"
                >
                  Salir
                </button>
              </div>
            </div>

            {/* Fila 2 Móvil: PnL y Flotante */}
            <div className="flex flex-wrap items-center justify-between gap-1.5 pt-1 border-t border-amber-500/30 text-xs">
              <div className="flex items-center gap-1 font-bold text-slate-950 truncate">
                <span className="text-[10px]">Flotante ({headerPnlData?.coinsInPosition || 0}p):</span>
                <span className={`text-xs font-mono font-black ${(Number(headerPnlData?.unrealizedPnl) || 0) < 0 ? 'text-rose-900' : (Number(headerPnlData?.unrealizedPnl) || 0) > 0 ? 'text-emerald-950' : 'text-slate-950'}`}>
                  {(Number(headerPnlData?.unrealizedPnl) || 0) >= 0 ? `+${(Number(headerPnlData?.unrealizedPnl) || 0).toFixed(2)}` : (Number(headerPnlData?.unrealizedPnl) || 0).toFixed(2)} USDT
                </span>
              </div>

              <div className="flex items-center gap-1 bg-amber-600/30 border border-amber-700/30 px-1.5 py-0.5 rounded font-mono text-[10px] text-slate-950 font-bold">
                <span>Total Pool:</span>
                <span className="font-mono font-black">
                  ${(Number(headerPnlData?.poolBalance) || 5000).toFixed(2)}
                </span>
                <span className={`font-black ${(Number(headerPnlData?.walletPnl) || 0) < 0 ? 'text-rose-900' : 'text-emerald-950'}`}>
                  ({(Number(headerPnlData?.walletPnl) || 0) >= 0 ? `+${(Number(headerPnlData?.walletPnl) || 0).toFixed(2)}` : (Number(headerPnlData?.walletPnl) || 0).toFixed(2)})
                </span>
              </div>
            </div>
          </div>

          {/* Vista Desktop (md:) */}
          <div className="hidden md:flex items-center justify-between">
            <div className="flex-1 min-w-0 flex items-center gap-3">
              <div className="flex flex-col min-w-0">
                <div className="flex items-center gap-1.5">
                  <span className="text-base font-black tracking-tight text-slate-950 truncate">WTN ALGO-TRADING</span>
                  <span className="bg-slate-950 text-amber-300 text-[9px] px-1.5 py-0.5 rounded font-mono font-bold shadow">
                    BINANCE
                  </span>
                </div>
                <span className="text-[10px] font-bold text-slate-900 tracking-wider">WTN Solutions LLC</span>
              </div>

              <button
                type="button"
                onClick={handleToggleSound}
                className={`ml-1 px-2 py-0.5 rounded text-[11px] font-bold transition flex items-center gap-1 shadow-sm ${
                  soundOn ? 'bg-slate-950 text-emerald-300 border border-emerald-500/50' : 'bg-slate-800 text-slate-300 border border-slate-700'
                }`}
                title={soundOn ? 'Silenciar sonidos' : 'Activar alertas sonoras'}
              >
                <span>{soundOn ? '🔊 ON' : '🔇 OFF'}</span>
              </button>
            </div>
            
            {/* PNL Info Central */}
            <div className="flex-initial px-2">
              <div className="flex items-center gap-2 text-slate-950 font-bold">
                {/* Flotante en vivo */}
                <div className="flex items-center gap-1.5 bg-slate-950/90 text-white border border-slate-800 px-3 py-1 rounded-xl shadow-sm">
                  <span className="text-xs text-slate-400">Flotante ({headerPnlData?.coinsInPosition || 0} pos):</span>
                  <span className={`text-base font-mono font-black ${(Number(headerPnlData?.unrealizedPnl) || 0) < 0 ? 'text-rose-400' : (Number(headerPnlData?.unrealizedPnl) || 0) > 0 ? 'text-emerald-400' : 'text-slate-300'}`}>
                    {(Number(headerPnlData?.unrealizedPnl) || 0) >= 0 ? `+${(Number(headerPnlData?.unrealizedPnl) || 0).toFixed(2)}` : (Number(headerPnlData?.unrealizedPnl) || 0).toFixed(2)}
                  </span>
                  <span className="text-[10px] text-slate-400">USDT</span>
                </div>

                {/* Total Pool */}
                <div className="flex items-center gap-1.5 bg-slate-950/10 border border-slate-900/20 px-2.5 py-1 rounded-xl shadow-sm text-slate-950">
                  <span className="text-xs font-bold text-slate-900">Total Pool:</span>
                  <span className="text-sm font-mono font-black text-slate-950">
                    ${(Number(headerPnlData?.poolBalance) || 5000).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })} USDT
                  </span>
                  <span className={`text-xs font-mono font-black px-1.5 py-0.2 rounded border ${(Number(headerPnlData?.walletPnl) || 0) < 0 ? 'bg-rose-500/20 border-rose-600/40 text-rose-950' : 'bg-emerald-500/20 border-emerald-600/40 text-emerald-950'}`} title="Rendimiento neto de cartera (Balance Binance - Capital Inicial)">
                    {(Number(headerPnlData?.walletPnl) || 0) >= 0 ? `+${(Number(headerPnlData?.walletPnl) || 0).toFixed(2)}` : (Number(headerPnlData?.walletPnl) || 0).toFixed(2)} USDT
                  </span>
                </div>

                {/* PnL Cerrado */}
                {isAdmin && (
                  <div className="hidden xl:flex items-center gap-1 bg-slate-950/90 text-white border border-slate-800 px-2.5 py-1 rounded-xl shadow-sm text-xs" title="PnL neto de operaciones cerradas">
                    <span className="text-slate-400 text-[11px]">Cerrado:</span>
                    <span className={`font-mono font-black ${(Number(headerPnlData?.totalPnl) || 0) < 0 ? 'text-rose-400' : 'text-emerald-400'}`}>
                      {(Number(headerPnlData?.totalPnl) || 0) >= 0 ? `+${(Number(headerPnlData?.totalPnl) || 0).toFixed(2)}` : (Number(headerPnlData?.totalPnl) || 0).toFixed(2)}
                    </span>
                  </div>
                )}
              </div>
            </div>
            
            {/* Usuario, Rol y Logout a la Derecha */}
            <div className="flex-1 flex items-center justify-end space-x-3 min-w-0">
              {botsRunning && (
                <div className="text-xs flex items-center gap-1 whitespace-nowrap">
                  <span className="font-bold text-slate-900">Activo:</span>
                  <span className="font-mono font-black bg-slate-950 text-amber-300 px-2 py-0.5 rounded text-xs">
                    {formatElapsedTime(elapsedTime)}
                  </span>
                </div>
              )}

              {/* Perfil & Logout */}
              <div className="flex items-center gap-2 bg-slate-950 px-3 py-1 rounded-xl border border-slate-800 shadow">
                <span className="text-sm">{isAdmin ? '👑' : '💼'}</span>
                <div className="flex flex-col min-w-0">
                  <span className="text-xs font-bold text-white max-w-[110px] truncate">{user?.username}</span>
                  {user?.account_number && (
                    <span className="text-[9px] font-mono font-bold text-amber-400 -mt-0.5">{user.account_number}</span>
                  )}
                </div>
                <span className={`text-[10px] font-extrabold px-1.5 py-0.2 rounded-full ${
                  isAdmin ? 'bg-amber-400 text-slate-950' : 'bg-cyan-500/20 text-cyan-300 border border-cyan-500/40'
                }`}>
                  {isAdmin ? 'Admin' : 'Inversor'}
                </span>
                <button
                  type="button"
                  onClick={logout}
                  title="Cerrar Sesión"
                  className="ml-1 text-slate-400 hover:text-rose-400 text-xs font-bold p-1 transition"
                >
                  🚪
                </button>
              </div>
            </div>
          </div>
        </div>

        {/* 2. Barra de Navegación por Pestañas */}
        <div className="bg-slate-900 border-b border-slate-800 px-2 sm:px-4 md:px-8 py-2 flex flex-col md:flex-row md:items-center md:justify-between gap-2 shadow-sm">
          <div className="flex items-center gap-1.5 sm:gap-2 overflow-x-auto no-scrollbar py-0.5 w-full md:w-auto -mx-1 px-1">
            
            {/* === PESTAÑAS DE SUPER ADMINISTRADOR === */}
            {isAdmin && (
              <>
                <button
                  type="button"
                  onClick={() => setActiveTab('monitor')}
                  className={`flex-shrink-0 whitespace-nowrap px-3 py-1.5 text-xs sm:text-sm font-extrabold rounded-xl transition-all flex items-center gap-1.5 ${
                    activeTab === 'monitor'
                      ? 'bg-amber-400 text-slate-950 shadow-md ring-2 ring-amber-400/50'
                      : 'text-slate-200 hover:text-white hover:bg-slate-800 border border-slate-700/70'
                  }`}
                >
                  <span>🖥️</span> Monitor
                  {headerPnlData.coinsInPosition > 0 && (
                    <span className="text-[10px] bg-emerald-500 text-white font-mono font-bold px-1.5 py-0.2 rounded-full shadow">
                      {headerPnlData.coinsInPosition}
                    </span>
                  )}
                </button>

                <button
                  type="button"
                  onClick={() => setActiveTab('config')}
                  className={`flex-shrink-0 whitespace-nowrap px-3 py-1.5 text-xs sm:text-sm font-extrabold rounded-xl transition-all flex items-center gap-1.5 ${
                    activeTab === 'config'
                      ? 'bg-amber-400 text-slate-950 shadow-md ring-2 ring-amber-400/50'
                      : 'text-slate-200 hover:text-white hover:bg-slate-800 border border-slate-700/70'
                  }`}
                >
                  <span>⚙️</span> Configuración
                </button>

                <button
                  type="button"
                  onClick={() => setActiveTab('performance')}
                  className={`flex-shrink-0 whitespace-nowrap px-3 py-1.5 text-xs sm:text-sm font-extrabold rounded-xl transition-all flex items-center gap-1.5 ${
                    activeTab === 'performance'
                      ? 'bg-amber-400 text-slate-950 shadow-md ring-2 ring-amber-400/50'
                      : 'text-slate-200 hover:text-white hover:bg-slate-800 border border-slate-700/70'
                  }`}
                >
                  <span>📈</span> Rendimiento
                </button>

                <button
                  type="button"
                  onClick={() => setActiveTab('investors')}
                  className={`flex-shrink-0 whitespace-nowrap px-3 py-1.5 text-xs sm:text-sm font-extrabold rounded-xl transition-all flex items-center gap-1.5 ${
                    activeTab === 'investors'
                      ? 'bg-amber-400 text-slate-950 shadow-md ring-2 ring-amber-400/50'
                      : 'text-slate-200 hover:text-white hover:bg-slate-800 border border-slate-700/70'
                  }`}
                >
                  <span>👥</span> Inversionistas & Fondos
                </button>

                <button
                  type="button"
                  onClick={() => setActiveTab('chart')}
                  className={`flex-shrink-0 whitespace-nowrap px-3 py-1.5 text-xs sm:text-sm font-extrabold rounded-xl transition-all flex items-center gap-1.5 ${
                    activeTab === 'chart'
                      ? 'bg-amber-400 text-slate-950 shadow-md ring-2 ring-amber-400/50'
                      : 'text-slate-200 hover:text-white hover:bg-slate-800 border border-slate-700/70'
                  }`}
                >
                  <span>📊</span> Gráficos
                </button>

                <button
                  type="button"
                  onClick={() => setActiveTab('radar')}
                  className={`flex-shrink-0 whitespace-nowrap px-3 py-1.5 text-xs sm:text-sm font-extrabold rounded-xl transition-all flex items-center gap-1.5 ${
                    activeTab === 'radar'
                      ? 'bg-amber-400 text-slate-950 shadow-md ring-2 ring-amber-400/50'
                      : 'text-slate-200 hover:text-white hover:bg-slate-800 border border-slate-700/70'
                  }`}
                >
                  <span>📡</span> Mercado
                </button>

                <button
                  type="button"
                  onClick={() => setActiveTab('backtest')}
                  className={`flex-shrink-0 whitespace-nowrap px-3 py-1.5 text-xs sm:text-sm font-extrabold rounded-xl transition-all flex items-center gap-1.5 ${
                    activeTab === 'backtest'
                      ? 'bg-amber-400 text-slate-950 shadow-md ring-2 ring-amber-400/50'
                      : 'text-slate-200 hover:text-white hover:bg-slate-800 border border-slate-700/70'
                  }`}
                >
                  <span>🧪</span> Backtesting
                </button>
              </>
            )}

            {/* === PESTAÑAS EXCLUSIVAS DE INVERSIONISTA (SOLO LECTURA) === */}
            {isInvestor && (
              <>
                <button
                  type="button"
                  onClick={() => setActiveTab('my_investment')}
                  className={`flex-shrink-0 whitespace-nowrap px-3 py-1.5 text-xs sm:text-sm font-extrabold rounded-xl transition-all flex items-center gap-1.5 ${
                    activeTab === 'my_investment'
                      ? 'bg-amber-400 text-slate-950 shadow-md ring-2 ring-amber-400/50'
                      : 'text-slate-200 hover:text-white hover:bg-slate-800 border border-slate-700/70'
                  }`}
                >
                  <span>🥧</span> Mi Inversión (Mi Torta)
                </button>

                <button
                  type="button"
                  onClick={() => setActiveTab('performance')}
                  className={`flex-shrink-0 whitespace-nowrap px-3 py-1.5 text-xs sm:text-sm font-extrabold rounded-xl transition-all flex items-center gap-1.5 ${
                    activeTab === 'performance'
                      ? 'bg-amber-400 text-slate-950 shadow-md ring-2 ring-amber-400/50'
                      : 'text-slate-200 hover:text-white hover:bg-slate-800 border border-slate-700/70'
                  }`}
                >
                  <span>📈</span> Resumen del Fondo
                </button>

                <button
                  type="button"
                  onClick={() => setActiveTab('chart')}
                  className={`flex-shrink-0 whitespace-nowrap px-3 py-1.5 text-xs sm:text-sm font-extrabold rounded-xl transition-all flex items-center gap-1.5 ${
                    activeTab === 'chart'
                      ? 'bg-amber-400 text-slate-950 shadow-md ring-2 ring-amber-400/50'
                      : 'text-slate-200 hover:text-white hover:bg-slate-800 border border-slate-700/70'
                  }`}
                >
                  <span>📊</span> Gráficos en Vivo
                </button>
              </>
            )}

          </div>

          {/* CONTROLES GLOBALES DE OPERACIÓN (SOLO ADMIN) */}
          {isAdmin && (
            <div className="flex items-center justify-between md:justify-end gap-2 w-full md:w-auto pt-1 md:pt-0 border-t border-slate-800 md:border-t-0 overflow-x-auto no-scrollbar">
              <BotControls 
                botsRunning={botsRunning}
                onStart={handleStartBots}
                onShutdown={handleShutdown}
                addToast={addToast}
              />

              {config?.symbolsToTrade && (
                <div className="text-xs text-slate-300 items-center gap-1 hidden xl:flex pl-2 border-l border-slate-700 flex-shrink-0">
                  <span>🪙</span>
                  <span className="font-bold text-slate-200 font-mono">
                    {config.symbolsToTrade.split(',').filter(Boolean).length} pares
                  </span>
                </div>
              )}
            </div>
          )}
        </div>
      </header>

      {/* CONTENIDO PRINCIPAL */}
      <main className="w-full px-2 sm:px-4 md:px-8 py-3 sm:py-6 max-w-full overflow-x-hidden">
        {initialLoadingError && (
          <div className="mb-6 p-4 bg-red-100 dark:bg-red-900 border border-red-400 dark:border-red-700 text-red-700 dark:text-red-200 rounded-lg">
             <p className="font-semibold text-center">Error de Carga</p>
             <p className="text-center">{initialLoadingError}</p>
           </div>
        )}

        {!initialLoadingError && (
          <>
            {/* PESTAÑA: Mi Inversión (Inversionista) */}
            {activeTab === 'my_investment' && isInvestor && (
              <InvestorPortfolio />
            )}

            {/* PESTAÑA: Gestión de Inversionistas & Fondos (Super Admin) */}
            {activeTab === 'investors' && isAdmin && (
              <AdminInvestors addToast={addToast} />
            )}

            {/* PESTAÑA: Monitor en Vivo (Solo Admin) */}
            {activeTab === 'monitor' && isAdmin && (
              <div className="block">
                <StatusDisplay 
                  config={config} 
                  onStatusUpdate={handleStatusUpdate}
                  onSelectSymbolForChart={handleSelectSymbolForChart}
                  availableStrategies={availableStrategies}
                  onStrategyNameChange={handleStrategyNameChange}
                  addToast={addToast}
                />
              </div>
            )}

            {/* PESTAÑA: Configuración de Parámetros (Solo Admin) */}
            {activeTab === 'config' && isAdmin && (
              <ConfigForm 
                initialConfig={config} 
                onSave={handleSave} 
                availableStrategies={availableStrategies}
                isLoadingStrategies={isLoadingStrategies}
                strategyError={strategyError}
                onRefreshStrategies={fetchAvailableStrategies}
                addToast={addToast}
              />
            )}

            {/* PESTAÑA: Gráficos de Velas (Admin & Inversionista) */}
            {activeTab === 'chart' && (
              <TradingViewChart
                selectedSymbol={chartSelectedSymbol}
                symbolsList={config?.symbolsToTrade ? config.symbolsToTrade.split(',').map(s => s.trim().toUpperCase()).filter(Boolean) : []}
                onSelectSymbol={(sym) => setChartSelectedSymbol(sym)}
              />
            )}

            {/* PESTAÑA: Rendimiento (Admin = completo con edición de riesgo, Inversor = solo lectura) */}
            {activeTab === 'performance' && (
              <PnLPerformanceChart
                symbolsList={config?.symbolsToTrade ? config.symbolsToTrade.split(',').map(s => s.trim().toUpperCase()).filter(Boolean) : []}
                readOnly={isInvestor}
              />
            )}

            {/* PESTAÑA: Radar y Escáner de Mercado (Solo Admin) */}
            {activeTab === 'radar' && isAdmin && (
              <MarketExplorer
                config={config}
                onSaveConfig={handleSave}
                onSelectSymbolForChart={handleSelectSymbolForChart}
              />
            )}

            {/* PESTAÑA: Laboratorio de Backtesting (Solo Admin) */}
            {activeTab === 'backtest' && isAdmin && (
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

export default function App() {
  return (
    <AuthProvider>
      <MainDashboard />
    </AuthProvider>
  );
}
