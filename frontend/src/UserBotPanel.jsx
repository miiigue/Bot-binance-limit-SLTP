import React, { useState, useEffect, useCallback, useMemo } from 'react';
import { useAuth } from './AuthContext';
import ConfirmModal from './ConfirmModal';

const formatShortDate = (dateStr) => {
  if (!dateStr) return 'N/A';
  try {
    const d = new Date(dateStr.includes('T') ? dateStr : dateStr.replace(' ', 'T'));
    if (isNaN(d.getTime())) return dateStr;
    const day = String(d.getDate()).padStart(2, '0');
    const month = String(d.getMonth() + 1).padStart(2, '0');
    const hours = String(d.getHours()).padStart(2, '0');
    const mins = String(d.getMinutes()).padStart(2, '0');
    return `${day}/${month} ${hours}:${mins}`;
  } catch (e) {
    return dateStr;
  }
};

export default function UserBotPanel({ activeStrategyName }) {
  const { authFetch, user } = useAuth();

  // Estados de datos
  const [botData, setBotData] = useState(null);
  const [tradesData, setTradesData] = useState([]);
  const [metricsData, setMetricsData] = useState(null);
  const [isLoading, setIsLoading] = useState(true);
  const [actionLoading, setActionLoading] = useState(false);
  const [feedback, setFeedback] = useState(null);

  // Estados del Formulario de API Keys
  const [apiKey, setApiKey] = useState('');
  const [apiSecret, setApiSecret] = useState('');
  const [isTestnet, setIsTestnet] = useState(false);
  const [showSecret, setShowSecret] = useState(false);
  const [showApiModal, setShowApiModal] = useState(false);

  // Estado del Modal de Confirmación Generico
  const [confirmModal, setConfirmModal] = useState({
    isOpen: false,
    title: '',
    message: '',
    confirmText: 'Confirmar',
    cancelText: 'Cancelar',
    type: 'warning',
    onConfirm: () => {}
  });

  // Curva de Capital Personal de la Cuenta Copy-Trading (Solo Operaciones Cerradas)
  const userEquityPoints = useMemo(() => {
    const closedTrades = (tradesData || []).filter(t => Boolean(t.close_timestamp));
    if (closedTrades.length === 0) return [];
    const sorted = [...closedTrades].sort((a, b) => {
      const da = new Date(a.close_timestamp || 0).getTime();
      const db = new Date(b.close_timestamp || 0).getTime();
      return da - db;
    });

    let running = 0;
    const pts = [{ idx: 0, pnl: 0, cumulative: 0, time: 'Inicio' }];
    sorted.forEach((t, i) => {
      const pnl = Number(t.pnl_usdt || 0);
      running += pnl;
      pts.push({
        idx: i + 1,
        id: t.id || t.binance_trade_id || (i + 1),
        symbol: t.symbol,
        type: t.trade_type,
        pnl,
        cumulative: running,
        time: t.close_time_short || formatShortDate(t.close_timestamp)
      });
    });
    return pts;
  }, [tradesData]);

  const openConfirm = (opts) => {
    setConfirmModal({
      isOpen: true,
      title: opts.title || '¿Confirmar Acción?',
      message: opts.message || '¿Está seguro de realizar esta acción?',
      confirmText: opts.confirmText || 'Sí, Confirmar',
      cancelText: opts.cancelText || 'Cancelar',
      type: opts.type || 'warning',
      onConfirm: opts.onConfirm || (() => {})
    });
  };

  const closeConfirm = () => {
    setConfirmModal(prev => ({ ...prev, isOpen: false }));
  };

  // Cargar estado del bot y balance del usuario
  const fetchUserBotStatus = useCallback(async () => {
    try {
      const resp = await authFetch('/api/user/bot');
      if (!resp.ok) return;
      const data = await resp.json();
      setBotData(data);
    } catch (err) {
      console.error("Error al obtener estado de bot de usuario:", err);
    } finally {
      setIsLoading(false);
    }
  }, [authFetch]);

  // Cargar trades personales del usuario
  const fetchUserTrades = useCallback(async () => {
    try {
      const resp = await authFetch('/api/user/trades?limit=30');
      if (!resp.ok) return;
      const data = await resp.json();
      setTradesData(data.trades || []);
      setMetricsData(data.metrics || null);
    } catch (err) {
      console.error("Error al obtener operaciones del usuario:", err);
    }
  }, [authFetch]);

  useEffect(() => {
    fetchUserBotStatus();
    fetchUserTrades();
    const interval = setInterval(() => {
      fetchUserBotStatus();
      fetchUserTrades();
    }, 8000);

    const handleOpenApiModal = () => {
      setShowApiModal(true);
    };
    window.addEventListener('open-api-modal', handleOpenApiModal);

    return () => {
      clearInterval(interval);
      window.removeEventListener('open-api-modal', handleOpenApiModal);
    };
  }, [fetchUserBotStatus, fetchUserTrades]);

  // Guardar / Conectar API Keys
  const handleSaveApiKeys = async (e) => {
    e.preventDefault();
    // Sanitización agresiva: eliminar caracteres Unicode invisibles (ZWSP, BOM, NBSP), espacios, comillas
    // y conservar solo alfanuméricos — Binance introduce chars invisibles al copiar desde su web
    const cleanKey = apiKey.replace(/[\u200B\u200C\u200D\u200E\u200F\uFEFF\u00A0\u2028\u2029\s'"]+/g, '').replace(/[^a-zA-Z0-9]/g, '');
    const cleanSecret = apiSecret.replace(/[\u200B\u200C\u200D\u200E\u200F\uFEFF\u00A0\u2028\u2029\s'"]+/g, '').replace(/[^a-zA-Z0-9]/g, '');

    if (!cleanKey || !cleanSecret) {
      setFeedback({ type: 'error', text: 'Por favor ingresa tanto tu API Key como tu API Secret de Binance.' });
      return;
    }

    if (cleanKey === cleanSecret) {
      setFeedback({ type: 'error', text: 'El API Key y el Secret Key son idénticos. Asegúrate de copiar cada uno en su campo correspondiente.' });
      return;
    }

    if (cleanKey.includes('BEGIN') || cleanSecret.includes('BEGIN')) {
      setFeedback({ 
        type: 'error', 
        text: 'Detectamos una clave asimétrica RSA/Ed25519. Binance Futures requiere una clave de tipo HMAC ("Generada por el sistema") de 64 caracteres alfanuméricos.' 
      });
      return;
    }

    if (cleanKey.length < 30 || cleanSecret.length < 30) {
      setFeedback({ 
        type: 'error', 
        text: 'La clave ingresada es demasiado corta. Las claves estándar de Binance tienen 64 caracteres. Verifica que no haya quedado incompleta al copiar.' 
      });
      return;
    }

    setActionLoading(true);
    setFeedback(null);

    try {
      const resp = await authFetch('/api/user/keys', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          api_key: cleanKey,
          api_secret: cleanSecret,
          is_testnet: isTestnet
        })
      });

      const resJson = await resp.json();
      if (!resp.ok) {
        throw new Error(resJson.message || 'Error al validar las claves con Binance.');
      }

      setFeedback({ type: 'success', text: resJson.message });
      setApiKey('');
      setApiSecret('');
      setShowApiModal(false);
      fetchUserBotStatus();
    } catch (err) {
      setFeedback({ type: 'error', text: err.message });
    } finally {
      setActionLoading(false);
    }
  };

  // Eliminar API Keys
  const handleDeleteApiKeys = () => {
    openConfirm({
      title: '¿Desconectar Claves API de Binance?',
      message: 'Tus credenciales se eliminarán de forma segura. La replicación automática de órdenes se detendrá inmediatamente.',
      confirmText: 'Sí, Desconectar',
      type: 'danger',
      onConfirm: async () => {
        setActionLoading(true);
        try {
          const resp = await authFetch('/api/user/keys', { method: 'DELETE' });
          const resJson = await resp.json();
          if (resp.ok) {
            setFeedback({ type: 'info', text: 'Claves API desconectadas y eliminadas de forma segura.' });
            fetchUserBotStatus();
          } else {
            throw new Error(resJson.message);
          }
        } catch (err) {
          setFeedback({ type: 'error', text: err.message });
        } finally {
          setActionLoading(false);
        }
      }
    });
  };

  // Activar / Pausar Sincronización Automática
  const handleToggleSync = () => {
    if (!botData?.has_valid_keys) {
      setFeedback({ type: 'error', text: 'Primero debes conectar tus claves API de Binance para activar la replicación de trades.' });
      setShowApiModal(true);
      return;
    }

    const nextState = !isBotRunning;
    openConfirm({
      title: nextState ? '¿Activar Replicación Automática?' : '¿Pausar Replicación de Trades?',
      message: nextState 
        ? 'El algoritmo cuantitativo comenzará a copiar en tiempo real cada orden de compra y venta en tu cuenta de Binance Futures.' 
        : 'Se pausará el copiado de posiciones en tu cuenta. Las órdenes abiertas mantendrán sus Stop Loss en Binance.',
      confirmText: nextState ? 'Sí, Activar Replicación' : 'Sí, Pausar Replicación',
      type: nextState ? 'success' : 'warning',
      onConfirm: async () => {
        setActionLoading(true);
        setFeedback(null);
        try {
          const resp = await authFetch('/api/user/bot/toggle', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ is_running: nextState })
          });
          const resJson = await resp.json();
          if (!resp.ok) throw new Error(resJson.message);

          setFeedback({ type: 'success', text: resJson.message });
          if (resJson.bot_settings) {
            setBotData(prev => ({
              ...prev,
              bot_settings: resJson.bot_settings
            }));
          }
          fetchUserBotStatus();
        } catch (err) {
          setFeedback({ type: 'error', text: err.message });
        } finally {
          setActionLoading(false);
        }
      }
    });
  };

  const isBotRunning = Boolean(botData?.bot_settings?.is_running);
  const hasKeys = Boolean(botData?.has_valid_keys);
  const balance = Number(botData?.balance_usdt || 0);

  if (isLoading && !botData) {
    return (
      <div className="flex flex-col items-center justify-center p-16 text-slate-400">
        <div className="w-12 h-12 border-4 border-amber-400 border-t-transparent rounded-full animate-spin mb-4"></div>
        <p className="text-sm font-semibold tracking-wide">Cargando tu cuenta personal de Binance...</p>
      </div>
    );
  }

  return (
    <div className="max-w-6xl mx-auto px-4 py-6 space-y-6">

      {/* Banner Superior de Estado Institucional */}
      <div className="relative overflow-hidden bg-gradient-to-r from-slate-900 via-slate-950 to-slate-900 border border-slate-800 rounded-3xl p-6 sm:p-8 shadow-2xl">
        <div className="absolute top-0 right-0 -mt-10 -mr-10 w-64 h-64 bg-amber-500/10 rounded-full blur-3xl pointer-events-none"></div>

        <div className="flex flex-col lg:flex-row lg:items-center justify-between gap-6 relative z-10">
          <div>
            <div className="inline-flex items-center gap-2 px-3 py-1 rounded-full bg-amber-400/10 border border-amber-400/30 text-amber-400 text-xs font-bold mb-3">
              <span className="w-2 h-2 rounded-full bg-amber-400 animate-pulse"></span>
              MODALIDAD: CUENTA PROPIA BINANCE (COPY-TRADING)
            </div>
            <h1 className="text-2xl sm:text-3xl font-black text-white tracking-tight">
              Copy-Trading Binance
            </h1>
            <p className="text-slate-400 text-xs sm:text-sm mt-1 max-w-2xl leading-relaxed">
              Mantén el control y custodia total de tus fondos en tu propio Binance. Las compras y ventas del algoritmo institucional gestionado por el Administrador se replican automáticamente en tu cuenta.
            </p>
          </div>

          {/* Tarjeta de Saldo Binance y Replicación */}
          <div className="flex flex-wrap sm:flex-nowrap items-center gap-4 bg-slate-950/80 border border-slate-800/80 rounded-2xl p-4 shadow-inner">
            <div className="pr-4 border-r border-slate-800">
              <span className="text-[10px] text-slate-500 block uppercase tracking-wider font-semibold">Tu Balance Binance</span>
              <span className="text-xl font-black font-mono text-emerald-400">${balance.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })} <span className="text-xs text-slate-400 font-sans">USDT</span></span>
            </div>
            <div>
              <span className="text-[10px] text-slate-500 block uppercase tracking-wider font-semibold">Replicación Algorítmica</span>
              <div className="flex items-center gap-2 mt-0.5">
                <span className={`w-3 h-3 rounded-full ${isBotRunning ? 'bg-emerald-400 animate-ping' : 'bg-slate-600'}`}></span>
                <span className={`text-xs font-bold ${isBotRunning ? 'text-emerald-400' : 'text-slate-400'}`}>
                  {isBotRunning ? 'SINCRONIZACIÓN ACTIVA' : 'SINCRONIZACIÓN PAUSADA'}
                </span>
              </div>
            </div>
          </div>
        </div>

        {/* Mensaje de Alerta / Feedback */}
        {feedback && (
          <div className={`mt-4 p-3.5 rounded-xl border text-xs flex items-center justify-between animate-fadeIn ${
            feedback.type === 'success' ? 'bg-emerald-500/15 border-emerald-500/30 text-emerald-300' :
            feedback.type === 'error' ? 'bg-rose-500/15 border-rose-500/30 text-rose-300' :
            'bg-sky-500/15 border-sky-500/30 text-sky-300'
          }`}>
            <span>{feedback.text}</span>
            <button onClick={() => setFeedback(null)} className="text-slate-400 hover:text-white ml-2 text-sm">✕</button>
          </div>
        )}
      </div>

      {/* Tarjeta de Control de Replicación Automática */}
      <div className={`border rounded-3xl p-6 sm:p-8 shadow-xl flex flex-col justify-between transition-all duration-300 ${
        isBotRunning 
          ? 'bg-gradient-to-b from-emerald-950/40 via-slate-900 to-slate-950 border-emerald-500/50 shadow-emerald-500/10' 
          : 'bg-slate-900/90 border-slate-800'
      }`}>
        <div>
          <div className="flex items-center justify-between mb-3">
            <h3 className="text-sm font-bold text-white uppercase tracking-wider flex items-center gap-2">
              <span>⚡</span> Control de Sincronización
            </h3>
            <span className="text-[10px] text-amber-400 bg-amber-400/10 px-2.5 py-0.5 rounded-lg border border-amber-400/30 font-bold">
              Estrategia Activa
            </span>
          </div>

          <div className="p-4 bg-slate-950/80 rounded-2xl border border-slate-800 mb-4 space-y-2">
            <div className="flex items-center justify-between text-xs">
              <span className="text-slate-400 font-medium">Estrategia que replica:</span>
              <span className="font-bold text-amber-300 font-mono truncate max-w-[260px]" title={botData?.active_strategy || activeStrategyName}>
                {botData?.active_strategy || activeStrategyName || 'v18_v17_RSI-SNIPER-MOMENTUM'}
              </span>
            </div>
            <div className="flex items-center justify-between text-xs">
              <span className="text-slate-400 font-medium">Estado de Replicación:</span>
              <span className={`font-bold ${isBotRunning ? 'text-emerald-400 flex items-center gap-1.5' : 'text-slate-400'}`}>
                {isBotRunning ? (
                  <>
                    <span className="w-2 h-2 rounded-full bg-emerald-400 animate-pulse"></span>
                    COPIANDO TRADES EN VIVO
                  </>
                ) : (
                  '⏸️ PAUSADO'
                )}
              </span>
            </div>
          </div>

          <p className="text-xs text-slate-400 mb-4 leading-relaxed">
            {isBotRunning 
              ? '🟢 Tu cuenta de Binance está vinculada y ejecutará cada orden de compra y venta del algoritmo institucional en tiempo real.'
              : '⏸️ La replicación está en pausa. Presiona el botón verde para activar el copiado automático de trades.'}
          </p>
        </div>

        <button
          onClick={handleToggleSync}
          disabled={actionLoading}
          className={`w-full py-3.5 px-6 rounded-2xl font-black text-xs tracking-wider transition-all shadow-xl flex items-center justify-center gap-2 active:scale-[0.98] ${
            isBotRunning
              ? 'bg-rose-600 hover:bg-rose-500 text-white shadow-rose-600/30'
              : 'bg-gradient-to-r from-emerald-500 to-teal-500 hover:from-emerald-400 hover:to-teal-400 text-slate-950 shadow-emerald-500/25'
          }`}
        >
          {actionLoading ? (
            <div className="w-4 h-4 border-2 border-current border-t-transparent rounded-full animate-spin"></div>
          ) : isBotRunning ? (
            <><span>⏸️</span> PAUSAR REPLICACIÓN DE TRADES</>
          ) : (
            <><span>⚡</span> ACTIVAR REPLICACIÓN AUTOMÁTICA</>
          )}
        </button>
      </div>

      {/* Sección 3: Historial y Métricas de Operaciones Replicadas */}
      <div className="bg-slate-900/90 border border-slate-800 rounded-3xl p-6 sm:p-8 shadow-xl space-y-6">
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 border-b border-slate-800 pb-4">
          <div>
            <h3 className="text-base font-bold text-white uppercase tracking-wider flex items-center gap-2">
              <span>📊</span> Historial de Operaciones Replicadas en tu Binance
            </h3>
            <p className="text-xs text-slate-400 mt-0.5 leading-relaxed">
              Compras y ventas ejecutadas exclusivamente sobre tu cuenta de Binance Futures por el bot maestro.
            </p>
          </div>
          <button
            onClick={fetchUserTrades}
            className="px-3 py-1.5 bg-slate-800 hover:bg-slate-700 text-slate-300 hover:text-white rounded-xl text-xs font-bold transition self-start sm:self-auto"
          >
            ↻ Actualizar Historial
          </button>
        </div>

        {/* Métricas Personales */}
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-4">
          <div className="bg-slate-950 p-4 rounded-2xl border border-slate-800 text-center">
            <span className="text-[10px] text-slate-500 uppercase block tracking-wider font-semibold">PnL Neto Generado</span>
            <span className={`text-lg font-black font-mono ${(metricsData?.total_pnl || 0) >= 0 ? 'text-emerald-400' : 'text-rose-400'}`}>
              {(metricsData?.total_pnl || 0) >= 0 ? '+' : ''}${(metricsData?.total_pnl || 0).toFixed(2)} <span className="text-xs font-sans text-slate-400">USDT</span>
            </span>
          </div>

          <div className="bg-slate-950 p-4 rounded-2xl border border-slate-800 text-center">
            <span className="text-[10px] text-slate-500 uppercase block tracking-wider font-semibold">Tasa de Acierto (Win Rate)</span>
            <span className="text-lg font-black font-mono text-amber-400">
              {(metricsData?.win_rate || 0).toFixed(1)}%
            </span>
          </div>

          <div className="bg-slate-950 p-4 rounded-2xl border border-slate-800 text-center">
            <span className="text-[10px] text-slate-500 uppercase block tracking-wider font-semibold">Trades Replicados</span>
            <span className="text-lg font-black font-mono text-white">
              {metricsData?.total_trades || 0}
            </span>
          </div>

          <div className="bg-slate-950 p-4 rounded-2xl border border-slate-800 text-center">
            <span className="text-[10px] text-slate-500 uppercase block tracking-wider font-semibold">Profit Factor</span>
            <span className="text-lg font-black font-mono text-teal-400">
              {(metricsData?.profit_factor || 1.0).toFixed(2)}
            </span>
          </div>
        </div>

        {/* Gráfico de Crecimiento de Capital Personal (Copy-Trading) */}
        {userEquityPoints.length > 1 && (() => {
          const minE = Math.min(0, ...userEquityPoints.map(p => p.cumulative));
          const maxE = Math.max(0.1, ...userEquityPoints.map(p => p.cumulative));
          const range = (maxE - minE) || 1;
          const svgW = 650;
          const svgH = 140;
          const pad = { top: 15, right: 30, bottom: 25, left: 45 };

          const getX = (i) => pad.left + (i / (userEquityPoints.length - 1)) * (svgW - pad.left - pad.right);
          const getY = (val) => pad.top + (svgH - pad.top - pad.bottom) - ((val - minE) / range) * (svgH - pad.top - pad.bottom);
          const zeroY = getY(0);

          const lineD = userEquityPoints.reduce((acc, pt, i) => `${acc} ${i === 0 ? 'M' : 'L'} ${getX(i)} ${getY(pt.cumulative)}`, '');
          const areaD = `${lineD} L ${getX(userEquityPoints.length - 1)} ${zeroY} L ${getX(0)} ${zeroY} Z`;
          const lastPnl = userEquityPoints[userEquityPoints.length - 1].cumulative;

          return (
            <div className="p-4 bg-slate-950 rounded-2xl border border-slate-800 space-y-2">
              <div className="flex items-center justify-between text-xs">
                <span className="font-bold text-white flex items-center gap-1.5">
                  <span>📈 Curva de Capital de tu Cuenta (Copy-Trading)</span>
                </span>
                <span className={`font-mono font-black ${lastPnl >= 0 ? 'text-emerald-400' : 'text-rose-400'}`}>
                  {lastPnl >= 0 ? '+' : ''}${lastPnl.toFixed(4)} USDT Acumulados
                </span>
              </div>
              <div className="w-full overflow-x-auto">
                <svg viewBox={`0 0 ${svgW} ${svgH}`} className="w-full h-auto max-h-40 select-none">
                  <defs>
                    <linearGradient id="userEquityGrad" x1="0" y1="0" x2="0" y2="1">
                      <stop offset="0%" stopColor="#10b981" stopOpacity="0.35" />
                      <stop offset="100%" stopColor="#10b981" stopOpacity="0.0" />
                    </linearGradient>
                  </defs>
                  <line x1={pad.left} y1={zeroY} x2={svgW - pad.right} y2={zeroY} stroke="#334155" strokeDasharray="3 3" strokeWidth="1" />
                  <path d={areaD} fill="url(#userEquityGrad)" />
                  <path d={lineD} fill="none" stroke={lastPnl >= 0 ? "#10b981" : "#f43f5e"} strokeWidth="2" />
                  {userEquityPoints.map((pt, i) => (
                    <circle key={i} cx={getX(i)} cy={getY(pt.cumulative)} r={i === 0 ? 3 : 3.5} fill={i === 0 ? '#fbbf24' : (pt.pnl >= 0 ? '#10b981' : '#f43f5e')} stroke="#0f172a" strokeWidth="1">
                      <title>{pt.idx === 0 ? 'Inicio 0.00' : `Trade #${pt.id} (${pt.symbol}): ${pt.pnl >= 0 ? '+' : ''}${pt.pnl.toFixed(4)} USDT`}</title>
                    </circle>
                  ))}
                </svg>
              </div>
            </div>
          );
        })()}

        {/* Tabla de Operaciones Replicadas */}
        <div className="overflow-x-auto rounded-2xl border border-slate-800 bg-slate-950">
          <table className="w-full text-left text-xs">
            <thead className="bg-slate-900/90 text-slate-400 text-[10px] font-semibold uppercase tracking-wider border-b border-slate-800">
              <tr>
                <th className="p-3">ID Trade</th>
                <th className="p-3">Símbolo</th>
                <th className="p-3">Tipo</th>
                <th className="p-3">Precio Entrada</th>
                <th className="p-3">Precio Salida</th>
                <th className="p-3">Cantidad</th>
                <th className="p-3">PnL Neto</th>
                <th className="p-3">Apertura</th>
                <th className="p-3">Cierre</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-800/60">
              {tradesData.length > 0 ? (
                tradesData.map((t) => {
                  const pnl = Number(t.pnl_usdt || 0);
                  const isWin = pnl >= 0;
                  const tradeId = t.id || t.binance_trade_id || '-';
                  return (
                    <tr key={t.id || tradeId} className="hover:bg-slate-900/50 transition">
                      <td className="p-3 font-bold font-mono text-amber-400">#{tradeId}</td>
                      <td className="p-3 font-bold font-mono text-white">{t.symbol}</td>
                      <td className="p-3">
                        <span className={`px-2 py-0.5 rounded text-[10px] font-bold ${
                          t.trade_type === 'LONG' ? 'bg-emerald-500/15 text-emerald-400' : 'bg-rose-500/15 text-rose-400'
                        }`}>
                          {t.trade_type}
                        </span>
                      </td>
                      <td className="p-3 font-mono text-slate-300">${Number(t.open_price).toFixed(2)}</td>
                      <td className="p-3 font-mono text-slate-300">{t.close_price ? `$${Number(t.close_price).toFixed(2)}` : 'Abierta'}</td>
                      <td className="p-3 font-mono text-slate-400">{t.quantity}</td>
                      <td className={`p-3 font-bold font-mono ${isWin ? 'text-emerald-400' : 'text-rose-400'}`}>
                        {t.close_timestamp ? `${isWin ? '+' : ''}$${pnl.toFixed(4)} USDT` : 'En curso'}
                      </td>
                      <td className="p-3 text-slate-300 font-mono text-[11px] whitespace-nowrap">
                        {t.open_time_short || formatShortDate(t.open_timestamp)}
                      </td>
                      <td className="p-3 text-slate-400 font-mono text-[11px] whitespace-nowrap">
                        {t.close_time_short || (t.close_timestamp ? formatShortDate(t.close_timestamp) : 'En curso')}
                      </td>
                    </tr>
                  );
                })
              ) : (
                <tr>
                  <td colSpan={8} className="p-8 text-center text-slate-500 text-xs">
                    No hay operaciones cerradas registradas para esta sesión de copytrading. Las nuevas posiciones de la estrategia cuantitativa activa quedarán registradas aquí.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </div>

      {/* Modal de Conexión de Claves API de Binance */}
      {showApiModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-950/80 backdrop-blur-md animate-fadeIn">
          <div className="bg-slate-900 border border-slate-800 rounded-3xl max-w-lg w-full p-6 sm:p-8 shadow-2xl space-y-6 relative">
            <button
              onClick={() => setShowApiModal(false)}
              className="absolute top-5 right-5 text-slate-400 hover:text-white text-lg font-bold"
            >
              ✕
            </button>

            <div>
              <div className="w-10 h-10 rounded-2xl bg-amber-400/10 border border-amber-400/30 flex items-center justify-center text-xl mb-3">
                🔑
              </div>
              <h3 className="text-xl font-black text-white tracking-tight">
                Vincular Cuenta de Binance Futures
              </h3>
              <p className="text-xs text-slate-400 mt-1">
                Tus credenciales se cifran con grado militar (AES-256-GCM). Solo se usarán para enviar las órdenes de trading a tu exchange.
              </p>
            </div>

            {/* Banner de Advertencia de Retiros */}
            <div className="p-3.5 bg-amber-500/10 border border-amber-500/25 rounded-2xl text-[11px] text-amber-300 space-y-1">
              <strong className="block font-bold text-amber-200">🛡️ Regla de Oro de Seguridad:</strong>
              <span>
                En Binance, al crear tu API Key, <strong>NUNCA habilites la casilla "Retiros" (Enable Withdrawals)</strong>. El bot únicamente necesita permisos de <strong>Lectura (Reading)</strong> y <strong>Trading de Futuros (Enable Futures)</strong>. De este modo, nadie puede extraer fondos de tu cuenta.
              </span>
            </div>

            <form onSubmit={handleSaveApiKeys} className="space-y-4">
              <div>
                <label className="text-xs font-bold text-slate-300 block mb-1">
                  Binance API Key:
                </label>
                <input
                  type="text"
                  required
                  value={apiKey}
                  onChange={(e) => setApiKey(e.target.value)}
                  placeholder="Pega aquí tu API Key de Binance..."
                  className="w-full bg-slate-950 border border-slate-700 rounded-xl px-3.5 py-2.5 text-xs text-white placeholder-slate-600 focus:border-amber-400 focus:outline-none font-mono"
                />
              </div>

              <div>
                <div className="flex justify-between items-center mb-1">
                  <label className="text-xs font-bold text-slate-300">
                    Binance Secret Key:
                  </label>
                  <button
                    type="button"
                    onClick={() => setShowSecret(!showSecret)}
                    className="text-[10px] text-slate-400 hover:text-white"
                  >
                    {showSecret ? 'Ocultar' : 'Mostrar'}
                  </button>
                </div>
                <input
                  type={showSecret ? "text" : "password"}
                  required
                  value={apiSecret}
                  onChange={(e) => setApiSecret(e.target.value)}
                  placeholder="Pega aquí tu Secret Key..."
                  className="w-full bg-slate-950 border border-slate-700 rounded-xl px-3.5 py-2.5 text-xs text-white placeholder-slate-600 focus:border-amber-400 focus:outline-none font-mono"
                />
              </div>

              <div className="p-3.5 bg-slate-950 rounded-2xl border border-slate-800 space-y-2.5">
                <div className="flex items-center justify-between">
                  <span className="text-xs text-slate-300 font-bold flex items-center gap-1.5">
                    <span>🌐</span> ¿Dónde creaste tu API Key?
                  </span>
                  <span className="text-[10px] text-amber-400 font-bold tracking-wide">
                    {isTestnet ? 'MODO DEMO / TESTNET' : 'MODO FONDOS REALES'}
                  </span>
                </div>
                <div className="grid grid-cols-2 gap-2">
                  <button
                    type="button"
                    onClick={() => setIsTestnet(false)}
                    className={`py-2 px-3 rounded-xl text-xs font-bold border transition text-center flex flex-col items-center justify-center gap-0.5 ${
                      !isTestnet 
                        ? 'bg-amber-400 text-slate-950 border-amber-400 font-black shadow-lg shadow-amber-400/20' 
                        : 'bg-slate-900 text-slate-400 border-slate-800 hover:text-white'
                    }`}
                  >
                    <span>🟡 Binance Real (Mainnet)</span>
                    <span className="text-[9px] opacity-80 font-normal">www.binance.com</span>
                  </button>
                  <button
                    type="button"
                    onClick={() => setIsTestnet(true)}
                    className={`py-2 px-3 rounded-xl text-xs font-bold border transition text-center flex flex-col items-center justify-center gap-0.5 ${
                      isTestnet 
                        ? 'bg-amber-400 text-slate-950 border-amber-400 font-black shadow-lg shadow-amber-400/20' 
                        : 'bg-slate-900 text-slate-400 border-slate-800 hover:text-white'
                    }`}
                  >
                    <span>🧪 Demo / Testnet</span>
                    <span className="text-[9px] opacity-80 font-normal">demo.binance.com</span>
                  </button>
                </div>
                <p className="text-[10px] text-slate-400 leading-relaxed">
                  {isTestnet 
                    ? '⚠️ Compatible con Demo Trading (demo.binance.com) y Testnet oficial. Recuerda crear la clave como "System generated (HMAC)".' 
                    : 'ℹ️ Claves de tu cuenta real de Binance con permisos "Enable Reading" y "Enable Futures". Tipo: "System generated (HMAC)".'}
                </p>
              </div>

              <div className="flex gap-3 pt-2">
                <button
                  type="button"
                  onClick={() => setShowApiModal(false)}
                  className="flex-1 py-3 px-4 bg-slate-800 hover:bg-slate-700 text-slate-300 font-bold rounded-xl text-xs transition"
                >
                  Cancelar
                </button>
                <button
                  type="submit"
                  disabled={actionLoading}
                  className="flex-1 py-3 px-4 bg-gradient-to-r from-amber-500 to-amber-600 hover:from-amber-400 hover:to-amber-500 text-slate-950 font-black rounded-xl text-xs uppercase tracking-wider transition shadow-lg shadow-amber-500/25 flex items-center justify-center gap-2"
                >
                  {actionLoading ? (
                    <div className="w-4 h-4 border-2 border-slate-950 border-t-transparent rounded-full animate-spin"></div>
                  ) : (
                    'Verificar y Guardar'
                  )}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* Modal de Confirmación Global de Acciones */}
      <ConfirmModal
        isOpen={confirmModal.isOpen}
        title={confirmModal.title}
        message={confirmModal.message}
        confirmText={confirmModal.confirmText}
        cancelText={confirmModal.cancelText}
        type={confirmModal.type}
        onConfirm={confirmModal.onConfirm}
        onClose={closeConfirm}
      />

    </div>
  );
}
