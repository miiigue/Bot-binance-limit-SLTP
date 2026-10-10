import React, { useState, useEffect, useCallback, useMemo, useRef } from 'react';
import { useAuth } from './AuthContext';
import ConfirmModal from './ConfirmModal';
import UserBotMonitorTable from './UserBotMonitorTable';

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

export default function UserBotPanel({ activeStrategyName, initialSubTab = 'my_bot' }) {
  const { authFetch, user } = useAuth();
  const hasLoadedInitialSettings = useRef(false);

  // Sub-pestaña activa dentro del panel (Mi Bot Personal vs Copy-Trading Espejo)
  const [currentSubTab, setCurrentSubTab] = useState(initialSubTab || 'my_bot');

  useEffect(() => {
    if (initialSubTab) {
      setCurrentSubTab(initialSubTab);
    }
  }, [initialSubTab]);

  // Estados de datos
  const [botData, setBotData] = useState(null);
  const [tradesData, setTradesData] = useState([]);
  const [metricsData, setMetricsData] = useState(null);
  const [isLoading, setIsLoading] = useState(true);
  const [actionLoading, setActionLoading] = useState(false);
  const [feedback, setFeedback] = useState(null);

  // Estados del Catálogo de Estrategias y Personalización
  const [catalogStrategies, setCatalogStrategies] = useState([]);
  const [isLoadingCatalog, setIsLoadingCatalog] = useState(false);
  const [selectedStrategy, setSelectedStrategy] = useState('');
  const [isCatalogOpen, setIsCatalogOpen] = useState(false);
  const [allocatedUsdt, setAllocatedUsdt] = useState(100);
  const [leverage, setLeverage] = useState('default');
  const [marginType, setMarginType] = useState('ISOLATED');
  const [isSavingSettings, setIsSavingSettings] = useState(false);
  const [activeTradeInspector, setActiveTradeInspector] = useState(null);
  const [userCoinSortOrder, setUserCoinSortOrder] = useState('PNL_DESC');

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

  // Rendimiento desglosado por criptomoneda con historial cronológico de trades
  const userCoinPerformance = useMemo(() => {
    const closedTrades = (tradesData || []).filter(t => Boolean(t.close_timestamp));
    if (closedTrades.length === 0) return [];
    const map = {};
    closedTrades.forEach(t => {
      const sym = (t.symbol || 'DESCONOCIDO').toUpperCase();
      const pnl = Number(t.pnl_usdt || 0);
      if (!map[sym]) {
        map[sym] = { 
          symbol: sym, 
          totalPnL: 0, 
          count: 0, 
          wins: 0, 
          losses: 0, 
          bestTrade: -Infinity, 
          worstTrade: Infinity, 
          trades: [] 
        };
      }
      map[sym].totalPnL += pnl;
      map[sym].count += 1;
      map[sym].trades.push(t);
      if (pnl > 0) map[sym].wins += 1;
      if (pnl < 0) map[sym].losses += 1;
      if (pnl > map[sym].bestTrade) map[sym].bestTrade = pnl;
      if (pnl < map[sym].worstTrade) map[sym].worstTrade = pnl;
    });

    return Object.values(map).map(c => {
      const sortedTrades = [...c.trades].sort((a, b) => {
        const timeA = new Date(a.close_timestamp || a.open_timestamp || 0).getTime() || (a.id || 0);
        const timeB = new Date(b.close_timestamp || b.open_timestamp || 0).getTime() || (b.id || 0);
        return timeA - timeB;
      });
      return {
        ...c,
        trades: sortedTrades,
        winRate: c.count > 0 ? ((c.wins / c.count) * 100).toFixed(1) : '0.0',
        bestTrade: c.bestTrade === -Infinity ? 0 : c.bestTrade,
        worstTrade: c.worstTrade === Infinity ? 0 : c.worstTrade
      };
    });
  }, [tradesData]);

  const sortedUserCoinPerformance = useMemo(() => {
    const list = [...userCoinPerformance];
    list.sort((a, b) => {
      if (userCoinSortOrder === 'PNL_DESC') return b.totalPnL - a.totalPnL;
      if (userCoinSortOrder === 'PNL_ASC') return a.totalPnL - b.totalPnL;
      if (userCoinSortOrder === 'WINRATE_DESC') return parseFloat(b.winRate) - parseFloat(a.winRate);
      if (userCoinSortOrder === 'TRADES_DESC') return b.count - a.count;
      return b.totalPnL - a.totalPnL;
    });
    return list;
  }, [userCoinPerformance, userCoinSortOrder]);

  // Renderizador del Gráfico de Barras por Posición/Trade Cerrado (Eje Cero con Ganancias Arriba y Pérdidas Abajo)
  const renderCoinTradeSequenceChart = (tradesList, symbol) => {
    if (!tradesList || tradesList.length === 0) {
      return (
        <div className="py-2.5 text-center text-[11px] text-slate-500 font-mono italic">
          Sin operaciones cerradas registradas
        </div>
      );
    }

    const maxAbs = Math.max(0.05, ...tradesList.map(t => Math.abs(Number(t.pnl_usdt || 0))));
    const barWidth = 12;
    const colSpacing = 20;
    const leftMargin = 45;
    const rightMargin = 20;
    const totalSvgWidth = Math.max(400, leftMargin + tradesList.length * colSpacing + rightMargin);
    const svgHeight = 180;
    const centerY = 90;
    const maxBarHeight = 65;

    const isThisCoinInspected = activeTradeInspector && activeTradeInspector.coin === symbol;

    return (
      <div className="mt-2.5 pt-2 border-t border-slate-800/80">
        <div className="flex flex-wrap items-center justify-end gap-2 text-[11px] text-slate-400 mb-1.5 px-1 font-mono">
          <span className="text-[10px] text-slate-400 font-semibold">
            {tradesList.length} {tradesList.length === 1 ? 'trade cerrado' : 'trades cerrados'} (cronológico ➔)
          </span>
        </div>

        <div className="relative w-full bg-slate-950/90 rounded-xl p-2 border border-slate-800 shadow-inner min-h-[160px]">
          <div className="relative w-full overflow-x-auto no-scrollbar">
            {isThisCoinInspected && activeTradeInspector && (
              <div
                className="absolute z-30 pointer-events-none transition-all duration-150 -translate-x-1/2 bg-slate-900/95 backdrop-blur-md border border-amber-400/80 shadow-2xl rounded-xl px-3 py-2 text-left font-mono whitespace-nowrap"
                style={{
                  left: `${Math.max(75, Math.min(totalSvgWidth - 75, activeTradeInspector.x + barWidth / 2))}px`,
                  top: `${Math.max(4, centerY - 68)}px`
                }}
              >
                <div className="flex items-center gap-1.5 text-xs font-black">
                  <span className="text-white">Trade #{activeTradeInspector.index}</span>
                  <span className={activeTradeInspector.isWin ? 'text-emerald-400' : 'text-rose-400'}>
                    {activeTradeInspector.isWin ? 'WIN 🎯' : 'LOSS 🛑'}
                  </span>
                </div>
                <div className={`text-xs font-black mt-0.5 ${activeTradeInspector.isWin ? 'text-emerald-400' : 'text-rose-400'}`}>
                  {activeTradeInspector.isWin ? '+' : ''}${activeTradeInspector.pnl.toFixed(4)} USDT
                </div>
                {(() => {
                  const insSide = (String(activeTradeInspector.trade?.trade_type || '').toUpperCase() === 'SHORT' || String(activeTradeInspector.trade?.close_reason || '').toUpperCase().includes('SHORT')) ? 'SHORT' : 'LONG';
                  return (
                    <div className="text-[11px] text-slate-300 mt-0.5">
                      Tipo: <strong className={insSide === 'LONG' ? 'text-emerald-400' : 'text-rose-400'}>{insSide}</strong>
                    </div>
                  );
                })()}
                {activeTradeInspector.timeStr && (
                  <div className="text-[10px] text-slate-400 mt-0.5">
                    🕒 {activeTradeInspector.timeStr}
                  </div>
                )}
              </div>
            )}

            <svg
              width={totalSvgWidth}
              height={svgHeight}
              viewBox={`0 0 ${totalSvgWidth} ${svgHeight}`}
              className="select-none block"
              onMouseLeave={() => setActiveTradeInspector(null)}
            >
              <defs>
                <linearGradient id={`winGrad_${symbol}`} x1="0%" y1="0%" x2="0%" y2="100%">
                  <stop offset="0%" stopColor="#34d399" />
                  <stop offset="100%" stopColor="#10b981" />
                </linearGradient>
                <linearGradient id={`lossGrad_${symbol}`} x1="0%" y1="0%" x2="0%" y2="100%">
                  <stop offset="0%" stopColor="#f43f5e" />
                  <stop offset="100%" stopColor="#e11d48" />
                </linearGradient>
                <filter id={`activeGlow_${symbol}`} x="-20%" y="-20%" width="140%" height="140%">
                  <feDropShadow dx="0" dy="0" stdDeviation="3" floodColor="#fbbf24" />
                </filter>
              </defs>

              {/* 1. Línea Base Horizontal Eje Cero */}
              <line
                x1={leftMargin - 6}
                y1={centerY}
                x2={totalSvgWidth - rightMargin}
                y2={centerY}
                stroke="#64748b"
                strokeWidth="1.5"
                strokeDasharray="4 3"
              />

              {/* 2. Etiqueta 0.00 en el Eje a la Izquierda */}
              <rect
                x="6"
                y={centerY - 9}
                width="36"
                height="18"
                rx="4"
                fill="#0f172a"
                stroke="#475569"
                strokeWidth="1"
              />
              <text
                x="24"
                y={centerY + 4}
                textAnchor="middle"
                fill="#94a3b8"
                fontSize="10"
                fontWeight="bold"
                fontFamily="monospace"
              >
                0.00
              </text>

              {/* 3. Barras de cada Trade Cerrado */}
              {tradesList.map((t, idx) => {
                const pnl = Number(t.pnl_usdt || 0);
                const isWin = pnl > 0.00001;
                const isLoss = pnl < -0.00001;
                const absPnl = Math.abs(pnl);
                const barHeight = Math.max(8, Math.min(maxBarHeight, Math.round((absPnl / maxAbs) * maxBarHeight)));
                const x = leftMargin + idx * colSpacing;

                const isSelected = activeTradeInspector && 
                  activeTradeInspector.coin === symbol && 
                  activeTradeInspector.index === (idx + 1);

                const timeStr = formatShortDate(t.close_timestamp);

                const handleSelect = () => {
                  setActiveTradeInspector({
                    coin: symbol,
                    trade: t,
                    index: idx + 1,
                    pnl,
                    isWin,
                    isLoss,
                    timeStr,
                    x
                  });
                };

                return (
                  <g key={t.id || idx} className="cursor-pointer">
                    <rect
                      x={x - 4}
                      y="4"
                      width={barWidth + 8}
                      height={svgHeight - 8}
                      fill="transparent"
                      onClick={handleSelect}
                      onMouseEnter={handleSelect}
                    />

                    {isWin && (
                      <rect
                        x={x}
                        y={centerY - barHeight}
                        width={barWidth}
                        height={barHeight}
                        rx="3"
                        fill={`url(#winGrad_${symbol})`}
                        stroke={isSelected ? "#fbbf24" : "#34d399"}
                        strokeWidth={isSelected ? 2.5 : 1}
                        filter={isSelected ? `url(#activeGlow_${symbol})` : undefined}
                        onClick={handleSelect}
                        onMouseEnter={handleSelect}
                        className="transition-all hover:brightness-125"
                      />
                    )}

                    {isLoss && (
                      <rect
                        x={x}
                        y={centerY}
                        width={barWidth}
                        height={barHeight}
                        rx="3"
                        fill={`url(#lossGrad_${symbol})`}
                        stroke={isSelected ? "#fbbf24" : "#fb7185"}
                        strokeWidth={isSelected ? 2.5 : 1}
                        filter={isSelected ? `url(#activeGlow_${symbol})` : undefined}
                        onClick={handleSelect}
                        onMouseEnter={handleSelect}
                        className="transition-all hover:brightness-125"
                      />
                    )}

                    {!isWin && !isLoss && (
                      <circle
                        cx={x + barWidth / 2}
                        cy={centerY}
                        r="3"
                        fill="#94a3b8"
                        onClick={handleSelect}
                        onMouseEnter={handleSelect}
                      />
                    )}

                    <text
                      x={x + barWidth / 2}
                      y={centerY + 34}
                      textAnchor="middle"
                      fill={isSelected ? "#fbbf24" : "#94a3b8"}
                      fontSize="10"
                      fontWeight={isSelected ? "bold" : "normal"}
                      fontFamily="monospace"
                      onClick={handleSelect}
                      onMouseEnter={handleSelect}
                    >
                      #{idx + 1}
                    </text>
                  </g>
                );
              })}
            </svg>
          </div>
          <div className="mt-1 text-center text-[10px] text-slate-500 font-sans">
            Pasa el cursor o toca cualquier barra para ver el detalle del trade.
          </div>
        </div>
      </div>
    );
  };

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

  // Reiniciar Cuenta Demo / Testnet de Binance (con confirmación obligatoria)
  const handleResetDemoAccount = () => {
    openConfirm({
      title: '🔄 ¿Reiniciar Cuenta Demo / Testnet de Binance?',
      message: '⚠️ Esta acción cancelará todas las órdenes en Binance Testnet, cerrará las posiciones abiertas y restablecerá el historial de trades y PnL acumulado a $0.00 USDT.',
      confirmText: 'Sí, Reiniciar Demo',
      type: 'danger',
      onConfirm: async () => {
        setActionLoading(true);
        setFeedback(null);
        try {
          const resp = await authFetch('/api/demo/reset', { method: 'POST' });
          const resJson = await resp.json();
          if (!resp.ok) throw new Error(resJson.message || resJson.error);
          setFeedback({ type: 'success', text: `✅ ${resJson.message}` });
          localStorage.removeItem('botStatusesCache');
          fetchUserBotStatus();
          fetchUserTrades();
          setTimeout(() => window.location.reload(), 1500);
        } catch (err) {
          setFeedback({ type: 'error', text: `Error al reiniciar cuenta demo: ${err.message}` });
        } finally {
          setActionLoading(false);
        }
      }
    });
  };

  // Reiniciar solo Historial de Trades y PnL del Usuario (sin tocar posiciones de Binance)
  const handleResetUserTrades = () => {
    openConfirm({
      title: '🗑️ ¿Reiniciar Historial de Trades & PnL?',
      message: '⚠️ Esta acción vaciará el historial de operaciones de tu sesión y pondrá tu PnL acumulado en $0.00 USDT. Tu bot y posiciones activas seguirán operando con total normalidad.',
      confirmText: 'Sí, Vaciar Historial',
      type: 'danger',
      onConfirm: async () => {
        setActionLoading(true);
        setFeedback(null);
        try {
          const resp = await authFetch('/api/user/trades/reset', { method: 'POST' });
          const resJson = await resp.json();
          if (!resp.ok) throw new Error(resJson.message || resJson.error);
          setFeedback({ type: 'success', text: `✅ ${resJson.message}` });
          fetchUserTrades();
          fetchUserBotStatus();
        } catch (err) {
          setFeedback({ type: 'error', text: `Error al reiniciar trades: ${err.message}` });
        } finally {
          setActionLoading(false);
        }
      }
    });
  };

  // Cargar catálogo de estrategias curadas
  const fetchStrategiesCatalog = useCallback(async () => {
    setIsLoadingCatalog(true);
    try {
      const resp = await authFetch('/api/strategies/catalog');
      if (resp.ok) {
        const data = await resp.json();
        const strats = data.strategies || [];
        setCatalogStrategies(strats);
        setSelectedStrategy(prev => prev || (strats.length > 0 ? strats[0].name : ''));
      }
    } catch (err) {
      console.error("Error al obtener catálogo de estrategias:", err);
    } finally {
      setIsLoadingCatalog(false);
    }
  }, [authFetch]);

  // Cargar estado del bot y balance del usuario
  const fetchUserBotStatus = useCallback(async () => {
    try {
      const resp = await authFetch('/api/user/bot');
      if (!resp.ok) return;
      const data = await resp.json();
      setBotData(data);
      if (!hasLoadedInitialSettings.current && data?.bot_settings) {
        hasLoadedInitialSettings.current = true;
        if (data.bot_settings.strategy_name) {
          setSelectedStrategy(data.bot_settings.strategy_name);
        }
        if (data.bot_settings.allocated_usdt !== undefined) {
          setAllocatedUsdt(Number(data.bot_settings.allocated_usdt));
        }
        if (data.bot_settings.leverage !== undefined && data.bot_settings.leverage !== null) {
          setLeverage(String(data.bot_settings.leverage));
        } else {
          setLeverage('default');
        }
        if (data.bot_settings.margin_type) {
          setMarginType(data.bot_settings.margin_type);
        }
      }
    } catch (err) {
      console.error("Error al obtener estado de bot de usuario:", err);
    } finally {
      setIsLoading(false);
    }
  }, [authFetch]);

  // Cargar trades personales del usuario
  const fetchUserTrades = useCallback(async () => {
    try {
      const modeParam = currentSubTab === 'my_bot' ? 'PERSONAL_BOT' : 'COPY_TRADING';
      const resp = await authFetch(`/api/user/trades?limit=50&mode=${modeParam}`);
      if (!resp.ok) return;
      const data = await resp.json();
      setTradesData(data.trades || []);
      setMetricsData(data.metrics || null);
    } catch (err) {
      console.error("Error al obtener operaciones del usuario:", err);
    }
  }, [authFetch, currentSubTab]);

  useEffect(() => {
    fetchStrategiesCatalog();
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
  }, [fetchStrategiesCatalog, fetchUserBotStatus, fetchUserTrades]);

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

  // Estrategia actualmente seleccionada y apalancamiento efectivo
  const currentStrategyObj = catalogStrategies.find(s => s.name === selectedStrategy);
  const strategyDefaultLeverage = Number(
    currentStrategyObj?.parameters?.leverage ||
    currentStrategyObj?.parameters?.leverage_str ||
    10
  );
  const effectiveLeverage = (leverage === 'default' || !leverage) 
    ? strategyDefaultLeverage 
    : Number(leverage);

  // Guardar configuración de estrategia, margen por orden y apalancamiento
  const handleSaveBotSettings = async () => {
    if (!selectedStrategy) {
      setFeedback({ type: 'error', text: 'Por favor selecciona una estrategia del catálogo.' });
      return;
    }
    const cap = Number(allocatedUsdt);
    if (isNaN(cap) || cap < 5) {
      setFeedback({ type: 'error', text: 'El margen por orden debe ser de al menos 5 USDT.' });
      return;
    }
    setIsSavingSettings(true);
    setFeedback(null);
    try {
      const resp = await authFetch('/api/user/bot/settings', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          strategy_name: selectedStrategy,
          allocated_usdt: cap,
          leverage: (leverage === 'default' || !leverage) ? 'default' : Number(leverage),
          margin_type: marginType,
          operating_mode: 'PERSONAL_BOT'
        })
      });
      const data = await resp.json();
      if (!resp.ok) throw new Error(data.message || 'Error al guardar parámetros.');
      const levLabel = (leverage === 'default' || !leverage)
        ? `${strategyDefaultLeverage}x (por defecto de la estrategia)`
        : `${leverage}x (personalizado)`;
      setFeedback({ type: 'success', text: `✅ Estrategia "${selectedStrategy}" guardada con Margen de $${cap} USDT por orden (${levLabel}).` });
      fetchUserBotStatus();
    } catch (err) {
      setFeedback({ type: 'error', text: err.message });
    } finally {
      setIsSavingSettings(false);
    }
  };

  const rawIsRunning = Boolean(botData?.bot_settings?.is_running);
  const operatingMode = botData?.bot_settings?.operating_mode || 'COPY_TRADING';

  const isCopyTradingActive = rawIsRunning && operatingMode === 'COPY_TRADING';
  const isPersonalBotActive = rawIsRunning && operatingMode === 'PERSONAL_BOT';

  const hasKeys = Boolean(botData?.has_valid_keys);
  const balance = Number(botData?.balance_usdt || 0);
  const walletBreakdown = botData?.wallet_breakdown || null;

  // Activar / Pausar Operación Automática según la pestaña activa
  const handleToggleSync = () => {
    if (!botData?.has_valid_keys) {
      setFeedback({ type: 'error', text: 'Primero debes conectar tus claves API de Binance para operar.' });
      setShowApiModal(true);
      return;
    }

    const isMarketplaceMode = (currentSubTab === 'my_bot');
    const targetMode = isMarketplaceMode ? 'PERSONAL_BOT' : 'COPY_TRADING';

    // Determinar si la modalidad de la pestaña actual está activa
    const currentlyActive = isMarketplaceMode ? isPersonalBotActive : isCopyTradingActive;
    const nextState = !currentlyActive;

    const stratTitle = isMarketplaceMode 
      ? (selectedStrategy || botData?.bot_settings?.strategy_name || 'Estrategia seleccionada')
      : (botData?.active_strategy || activeStrategyName || 'Estrategia Maestra');

    openConfirm({
      title: nextState 
        ? (isMarketplaceMode ? '¿Iniciar tu Bot Personal con esta Estrategia?' : '¿Activar Replicación Copy-Trading?') 
        : (isMarketplaceMode ? '¿Pausar tu Bot Personal?' : '¿Pausar Replicación de Trades?'),
      message: nextState 
        ? (isMarketplaceMode 
            ? `Tu bot personal comenzará a operar en Binance Futures con la estrategia "${stratTitle}", con un margen de $${allocatedUsdt} USDT por orden y ${effectiveLeverage}x de apalancamiento (${leverage === 'default' || !leverage ? 'por defecto de la estrategia' : 'personalizado'}, Nocional: $${(Number(allocatedUsdt) * effectiveLeverage).toFixed(2)} USDT por posición).`
            : 'El algoritmo cuantitativo comenzará a copiar en tiempo real cada orden de compra y venta en tu cuenta de Binance Futures (Modo Copy-Trading Espejo).')
        : 'Se pausará la operativa en tu cuenta de Binance. Las órdenes abiertas mantendrán sus Stop Loss en el exchange.',
      confirmText: nextState 
        ? (isMarketplaceMode ? 'Sí, Iniciar Mi Bot' : 'Sí, Activar Replicación') 
        : (isMarketplaceMode ? 'Sí, Pausar Mi Bot' : 'Sí, Pausar Replicación'),
      type: nextState ? 'success' : 'warning',
      onConfirm: async () => {
        setActionLoading(true);
        setFeedback(null);
        try {
          if (nextState && isMarketplaceMode && selectedStrategy) {
            await authFetch('/api/user/bot/settings', {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({
                strategy_name: selectedStrategy,
                allocated_usdt: Number(allocatedUsdt),
                leverage: (leverage === 'default' || !leverage) ? 'default' : Number(leverage),
                margin_type: marginType,
                operating_mode: 'PERSONAL_BOT'
              })
            });
          }

          const resp = await authFetch('/api/user/bot/toggle', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ 
              is_running: nextState,
              operating_mode: targetMode
            })
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

  if (isLoading && !botData) {
    return (
      <div className="flex flex-col items-center justify-center p-16 text-slate-400">
        <div className="w-12 h-12 border-4 border-amber-400 border-t-transparent rounded-full animate-spin mb-4"></div>
        <p className="text-sm font-semibold tracking-wide">Cargando tu cuenta personal de Binance...</p>
      </div>
    );
  }

  return (
    <div className="w-full max-w-[1920px] mx-auto px-2 sm:px-4 lg:px-6 py-4 sm:py-6 space-y-6">

      {/* Banner Superior de Estado Institucional */}
      <div className="relative overflow-hidden bg-gradient-to-r from-slate-900 via-slate-950 to-slate-900 border border-slate-800 rounded-3xl p-6 sm:p-8 shadow-2xl">
        <div className="absolute top-0 right-0 -mt-10 -mr-10 w-64 h-64 bg-amber-500/10 rounded-full blur-3xl pointer-events-none"></div>

        <div className="flex flex-col lg:flex-row lg:items-center justify-between gap-6 relative z-10">
          <div>
            <h1 className="text-2xl sm:text-3xl font-black text-white tracking-tight">
              {currentSubTab === 'my_bot' ? '🤖 Mi Bot Personal' : '👥 Copy-Trading Binance'}
            </h1>
          </div>

          {/* Tarjeta de Saldo Binance y Estado */}
          <div className="flex flex-wrap sm:flex-nowrap items-center gap-4 bg-slate-950/80 border border-slate-800/80 rounded-2xl p-4 shadow-inner">
            <div className="pr-4 border-r border-slate-800">
              <span className="text-[10px] text-slate-500 block uppercase tracking-wider font-semibold">Tu Balance Binance</span>
              <span className="text-xl font-black font-mono text-emerald-400">${balance.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })} <span className="text-xs text-slate-400 font-sans">USDT</span></span>
            </div>
            <div>
              <span className="text-[10px] text-slate-500 block uppercase tracking-wider font-semibold">
                {currentSubTab === 'my_bot' ? 'Estado Mi Bot Personal' : 'Replicación Copy-Trading'}
              </span>
              <div className="flex items-center gap-2 mt-0.5">
                {currentSubTab === 'my_bot' ? (
                  <>
                    <span className={`w-3 h-3 rounded-full ${isPersonalBotActive ? 'bg-emerald-400 animate-ping' : 'bg-slate-600'}`}></span>
                    <span className={`text-xs font-bold ${isPersonalBotActive ? 'text-emerald-400' : 'text-slate-400'}`}>
                      {isPersonalBotActive ? 'OPERACIÓN EN VIVO' : (isCopyTradingActive ? 'PAUSADO (Copy-Trading Activo)' : 'PAUSADO')}
                    </span>
                  </>
                ) : (
                  <>
                    <span className={`w-3 h-3 rounded-full ${isCopyTradingActive ? 'bg-emerald-400 animate-ping' : 'bg-slate-600'}`}></span>
                    <span className={`text-xs font-bold ${isCopyTradingActive ? 'text-emerald-400' : 'text-slate-400'}`}>
                      {isCopyTradingActive ? 'COPIANDO TRADES EN VIVO' : (isPersonalBotActive ? 'PAUSADO (Bot Personal Activo)' : 'PAUSADO')}
                    </span>
                  </>
                )}
              </div>
            </div>

            {/* Botón Acción: Reiniciar Demo Binance */}
            <div className="pl-4 border-l border-slate-800 flex items-center">
              <button
                type="button"
                onClick={handleResetDemoAccount}
                disabled={actionLoading}
                className="px-3.5 py-2 bg-rose-950/80 hover:bg-rose-900 text-rose-300 border border-rose-700/60 rounded-xl text-xs font-black transition flex items-center gap-1.5 shadow active:scale-95 disabled:opacity-50"
                title="Cierra posiciones, cancela órdenes en Testnet y restablece el PnL a $0.00 USDT (con confirmación previa)"
              >
                <span>🔄</span>
                <span>Reiniciar Demo Binance</span>
              </button>
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



      {/* ============================================================== */}
      {/* VISTA 1: MARKETPLACE DE ESTRATEGIAS (MODO MI BOT PERSONAL)     */}
      {/* ============================================================== */}
      {currentSubTab === 'my_bot' && (
        <div className="space-y-6 animate-fadeIn">
          
          {/* Tarjeta de Control Principal del Bot Personal */}
          <div className={`border rounded-3xl p-6 sm:p-8 shadow-xl flex flex-col justify-between transition-all duration-300 ${
            isPersonalBotActive 
              ? 'bg-gradient-to-b from-emerald-950/40 via-slate-900 to-slate-950 border-emerald-500/50 shadow-emerald-500/10' 
              : 'bg-slate-900/90 border-slate-800'
          }`}>
              <div className="grid grid-cols-1 sm:grid-cols-3 gap-3 p-4 bg-slate-950/80 rounded-2xl border border-slate-800 mb-4">
                <div className="text-xs">
                  <span className="text-slate-500 block uppercase font-semibold">Estrategia Asignada:</span>
                  <span className="font-extrabold text-amber-300 font-mono text-sm truncate block mt-0.5" title={selectedStrategy}>
                    {selectedStrategy || 'Ninguna seleccionada'}
                  </span>
                </div>
                <div className="text-xs">
                  <span className="text-slate-500 block uppercase font-semibold">Capital Asignado:</span>
                  <span className="font-extrabold text-emerald-400 font-mono text-sm block mt-0.5">
                    ${allocatedUsdt} USDT
                  </span>
                </div>
                <div className="text-xs">
                  <span className="text-slate-500 block uppercase font-semibold">Apalancamiento & Margen:</span>
                  <span className="font-extrabold text-sky-400 font-mono text-sm block mt-0.5">
                    {effectiveLeverage}x {leverage === 'default' || !leverage ? '(Por Defecto)' : '(Personalizado)'} • {marginType}
                  </span>
                </div>
              </div>

              {isCopyTradingActive && (
                <div className="p-3 bg-amber-500/10 border border-amber-500/30 rounded-2xl text-amber-300 text-xs mb-4">
                  ℹ️ Tu cuenta está actualmente en <strong>Modo Copy-Trading Espejo</strong>. Al presionar <strong>"INICIAR MI BOT CON ESTA ESTRATEGIA"</strong>, se pausará la replicación de Copy-Trading y tu cuenta operará de forma autónoma con tu estrategia seleccionada.
                </div>
              )}

            <button
              onClick={handleToggleSync}
              disabled={actionLoading}
              className={`w-full py-3.5 px-6 rounded-2xl font-black text-xs tracking-wider transition-all shadow-xl flex items-center justify-center gap-2 active:scale-[0.98] ${
                isPersonalBotActive
                  ? 'bg-rose-600 hover:bg-rose-500 text-white shadow-rose-600/30'
                  : 'bg-gradient-to-r from-emerald-500 to-teal-500 hover:from-emerald-400 hover:to-teal-400 text-slate-950 shadow-emerald-500/25'
              }`}
            >
              {actionLoading ? (
                <div className="w-4 h-4 border-2 border-current border-t-transparent rounded-full animate-spin"></div>
              ) : isPersonalBotActive ? (
                <><span>⏸️</span> PAUSAR MI BOT PERSONAL</>
              ) : (
                <><span>⚡</span> INICIAR MI BOT CON ESTA ESTRATEGIA</>
              )}
            </button>
          </div>

          {/* Tarjeta de Conciliación Contable y Balance en Binance (¿Dónde está tu dinero?) */}
          <div className="bg-slate-900/90 border border-slate-800 rounded-3xl p-5 sm:p-6 shadow-xl space-y-4">
            <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2 border-b border-slate-800/80 pb-3">
              <div>
                <h4 className="text-xs sm:text-sm font-bold text-white uppercase tracking-wider flex items-center gap-2">
                  <span>💰</span> Estado Contable y Conciliación de Dinero en Binance
                </h4>
                <p className="text-[11px] text-slate-400 mt-0.5">
                  Desglose transparente: Muestra exactamente cómo se calcula tu dinero en Binance (Depósito + Ganancias + Flotante = Total Binance).
                </p>
              </div>
              <div className="flex items-center gap-2">
                <span className="text-[11px] font-mono px-3 py-1.5 rounded-xl bg-amber-500/10 border border-amber-500/30 text-amber-300 font-bold">
                  Total Binance: ${((walletBreakdown?.wallet_balance ?? balance) + (walletBreakdown?.unrealized_pnl || 0)).toFixed(2)} USDT
                </span>
              </div>
            </div>

            {/* Fila con la fórmula suma contable visual */}
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3 text-xs font-mono">
              {/* 1. Saldo de Billetera Base */}
              <div className="p-3.5 bg-slate-950/90 rounded-2xl border border-slate-800 flex flex-col justify-between">
                <span className="text-[10px] text-slate-400 uppercase font-sans font-bold flex items-center gap-1">
                  <span>🏦</span> Saldo en Billetera Binance
                </span>
                <span className="text-base sm:text-xl font-black font-mono text-white mt-1.5">
                  ${(walletBreakdown?.wallet_balance ?? balance).toFixed(2)} <span className="text-[10px] text-slate-400 font-sans">USDT</span>
                </span>
                <span className="text-[10px] text-slate-500 font-sans mt-1">
                  Fondos depositados + Ganancias realizadas
                </span>
              </div>

              {/* 2. PnL Flotante de Operaciones Abiertas */}
              <div className="p-3.5 bg-slate-950/90 rounded-2xl border border-slate-800 flex flex-col justify-between">
                <span className="text-[10px] text-slate-400 uppercase font-sans font-bold flex items-center gap-1">
                  <span>📈</span> PnL Flotante (En Posición)
                </span>
                <span className={`text-base sm:text-xl font-black font-mono mt-1.5 ${
                  (walletBreakdown?.unrealized_pnl || 0) >= 0 ? 'text-emerald-400' : 'text-rose-400'
                }`}>
                  {(walletBreakdown?.unrealized_pnl || 0) >= 0 ? '+' : ''}${(walletBreakdown?.unrealized_pnl || 0).toFixed(2)} <span className="text-[10px] text-slate-400 font-sans">USDT</span>
                </span>
                <span className="text-[10px] text-slate-500 font-sans mt-1">
                  Resultado de {walletBreakdown?.open_positions_count || 0} operaciones activas
                </span>
              </div>

              {/* 3. Margen Retenido / En Juego */}
              <div className="p-3.5 bg-slate-950/90 rounded-2xl border border-slate-800 flex flex-col justify-between">
                <span className="text-[10px] text-slate-400 uppercase font-sans font-bold flex items-center gap-1">
                  <span>🔒</span> Margen en Operaciones
                </span>
                <span className="text-base sm:text-xl font-black font-mono text-amber-400 mt-1.5">
                  ${(walletBreakdown?.margin_in_positions || 0).toFixed(2)} <span className="text-[10px] text-slate-400 font-sans">USDT</span>
                </span>
                <span className="text-[10px] text-slate-500 font-sans mt-1">
                  Garantía retenida por Binance
                </span>
              </div>

              {/* 4. Saldo Libre Disponible para Operar o Retirar */}
              <div className="p-3.5 bg-gradient-to-br from-emerald-950/40 to-slate-950 rounded-2xl border border-emerald-500/40 flex flex-col justify-between shadow-lg">
                <span className="text-[10px] text-emerald-300 uppercase font-sans font-bold flex items-center gap-1">
                  <span>🟢</span> Saldo Libre Disponible
                </span>
                <span className="text-base sm:text-xl font-black font-mono text-emerald-400 mt-1.5">
                  ${(walletBreakdown?.available_balance ?? (balance - (walletBreakdown?.margin_in_positions || 0))).toFixed(2)} <span className="text-[10px] text-emerald-500 font-sans">USDT</span>
                </span>
                <span className="text-[10px] text-emerald-300/70 font-sans mt-1">
                  Disponible sin riesgo asignado
                </span>
              </div>
            </div>

            {/* Fórmula explicativa integrada */}
            <div className="p-3 bg-slate-950/80 rounded-2xl border border-slate-800/80 text-[11px] text-slate-300 flex flex-wrap items-center justify-between gap-2">
              <span className="font-mono">
                🧮 <strong>Fórmula Total Binance:</strong> ${(walletBreakdown?.wallet_balance ?? balance).toFixed(2)} (Billetera) {(walletBreakdown?.unrealized_pnl || 0) >= 0 ? `+ $${(walletBreakdown?.unrealized_pnl || 0).toFixed(2)}` : `- $${Math.abs(walletBreakdown?.unrealized_pnl || 0).toFixed(2)}`} (Flotante) = <strong className="text-amber-300">${((walletBreakdown?.wallet_balance ?? balance) + (walletBreakdown?.unrealized_pnl || 0)).toFixed(2)} USDT</strong> Patrimonio Total
              </span>
            </div>
          </div>

          {/* Panel de Monitoreo en Vivo de tu Bot Personal (Posiciones Abiertas y Radar de Señales) */}
          <UserBotMonitorTable 
            authFetch={authFetch} 
            isRunning={isPersonalBotActive} 
            activeLeverage={effectiveLeverage} 
          />

          {/* Catálogo de Estrategias Públicas Curadas */}
          <div className="bg-slate-900/90 border border-slate-800 rounded-3xl p-6 sm:p-8 shadow-xl space-y-6">
            <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 border-b border-slate-800 pb-4">
              <div>
                <div className="inline-flex items-center gap-1.5 px-3 py-1 rounded-full bg-indigo-500/10 border border-indigo-500/30 text-indigo-400 text-xs font-bold mb-1">
                  <span>🛒</span> MARKETPLACE DE ESTRATEGIAS CUANTITATIVAS
                </div>
              </div>
              <div className="flex items-center gap-2 self-start sm:self-auto">
                <button
                  type="button"
                  onClick={() => setIsCatalogOpen(prev => !prev)}
                  className="px-3 py-1.5 bg-slate-800 hover:bg-slate-700 text-indigo-300 hover:text-white border border-indigo-500/40 rounded-xl text-xs font-bold transition flex items-center gap-1 active:scale-95"
                >
                  <span>{isCatalogOpen ? '🔼 Ocultar Lista' : '🔽 Desplegar Lista Completa'}</span>
                </button>
                <button
                  onClick={fetchStrategiesCatalog}
                  className="px-3 py-1.5 bg-slate-800 hover:bg-slate-700 text-slate-300 hover:text-white rounded-xl text-xs font-bold transition"
                >
                  ↻ Actualizar Catálogo
                </button>
              </div>
            </div>

            {isCatalogOpen && (
              <>
                {isLoadingCatalog && catalogStrategies.length === 0 ? (
                  <div className="py-12 text-center text-slate-400 text-xs flex flex-col items-center gap-2">
                    <div className="w-6 h-6 border-2 border-amber-400 border-t-transparent rounded-full animate-spin"></div>
                    <span>Cargando catálogo de estrategias autorizadas...</span>
                  </div>
                ) : catalogStrategies.length === 0 ? (
                  <div className="p-8 bg-slate-950/60 border border-slate-800 rounded-2xl text-center text-slate-400 text-xs">
                    No hay estrategias marcadas como públicas en este momento. El administrador activará opciones en breve.
                  </div>
                ) : (
                  <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
                    {catalogStrategies.map((strat) => {
                      const isSelected = (selectedStrategy === strat.name);
                      const riskColor = 
                        strat.risk_level === 'BAJO' ? 'text-emerald-400 bg-emerald-500/15 border-emerald-500/30' :
                        strat.risk_level === 'ALTO' ? 'text-rose-400 bg-rose-500/15 border-rose-500/30' :
                        'text-amber-400 bg-amber-500/15 border-amber-500/30';

                      return (
                        <div
                          key={strat.id || strat.name}
                          onClick={() => setSelectedStrategy(strat.name)}
                          className={`cursor-pointer rounded-2xl p-5 border transition-all relative flex flex-col justify-between overflow-hidden ${
                            isSelected
                              ? 'bg-gradient-to-b from-indigo-950/60 via-slate-900 to-slate-950 border-indigo-500 shadow-xl shadow-indigo-500/10 ring-2 ring-indigo-500/50'
                              : 'bg-slate-950/80 border-slate-800 hover:border-slate-700 hover:bg-slate-900/60'
                          }`}
                        >
                          <div>
                            <div className="flex items-center justify-between gap-2 mb-2 flex-wrap">
                              <span className={`text-[10px] font-black uppercase px-2.5 py-0.5 rounded-full border ${riskColor}`}>
                                RIESGO {strat.risk_level || 'MODERADO'}
                              </span>
                              {isSelected && (
                                <span className="text-[10px] font-black text-indigo-400 bg-indigo-500/20 px-2 py-0.5 rounded-md border border-indigo-500/40">
                                  SELECCIONADA
                                </span>
                              )}
                            </div>

                            {/* Título sanitizado con break-words para evitar desbordamientos visuales */}
                            <h4 
                              className="text-sm font-black text-white mb-2 leading-snug break-all tracking-tight"
                              title={strat.display_name || strat.name}
                            >
                              {strat.display_name || strat.name}
                            </h4>

                            <p className="text-xs text-slate-400 mb-4 leading-relaxed line-clamp-3">
                              {strat.description || 'Estrategia cuantitativa con gestión dinámica de riesgo y toma de ganancias inteligente.'}
                            </p>
                          </div>
                        </div>
                      );
                    })}
                  </div>
                )}
              </>
            )}

            {/* Asignación de Capital y Apalancamiento */}
            <div className="bg-slate-950 border border-slate-800 rounded-2xl p-5 space-y-4">
              <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 border-b border-slate-800/80 pb-3">
                <div className="flex items-center gap-2 flex-wrap">
                  <h4 className="text-sm font-bold text-white uppercase tracking-wider flex items-center gap-2">
                    <span>⚙️</span> Personaliza tu Capital y Apalancamiento
                  </h4>
                  <span className="text-xs text-slate-400">
                    ({selectedStrategy || 'Ninguna'})
                  </span>
                </div>
                <button
                  type="button"
                  onClick={handleSaveBotSettings}
                  disabled={isSavingSettings}
                  className="px-4 py-2 bg-amber-400 hover:bg-amber-300 text-slate-950 font-black text-xs rounded-xl shadow-lg transition active:scale-95 flex items-center gap-1.5 self-start sm:self-auto"
                >
                  <span>💾</span>
                  <span>{isSavingSettings ? 'Guardando...' : 'Guardar Parámetros de Mi Bot'}</span>
                </button>
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
                {/* Margen por Orden (USDT) */}
                <div>
                  <label className="block text-xs font-bold text-slate-300 uppercase mb-1">
                    Margen por Orden (USDT):
                  </label>
                  <div className="relative">
                    <input
                      type="number"
                      min="5"
                      step="5"
                      value={allocatedUsdt}
                      onChange={(e) => setAllocatedUsdt(e.target.value)}
                      placeholder="Ej: 50"
                      className="w-full py-2.5 px-3 bg-slate-900 border border-slate-700 rounded-xl text-sm font-mono font-bold text-white outline-none focus:border-amber-400"
                    />
                    <span className="absolute right-3 top-2.5 text-xs text-slate-400 font-bold">USDT</span>
                  </div>
                  <div className="text-[11px] text-slate-400 mt-1.5 font-light leading-tight space-y-0.5">
                    <div>💼 Margen: <strong className="text-cyan-300 font-mono font-medium">${Number(allocatedUsdt || 0).toFixed(2)} USDT</strong></div>
                    <div>⚡ Valor Nominal (Nocional): <strong className="text-amber-300 font-mono font-medium">${(Number(allocatedUsdt || 0) * effectiveLeverage).toFixed(2)} USDT</strong> <span className="text-slate-400">({effectiveLeverage}x {leverage === 'default' || !leverage ? 'por defecto' : 'personalizado'})</span></div>
                    <div className="text-[10px] text-slate-500 pt-0.5">Saldo libre en Binance: ${balance.toFixed(2)} USDT</div>
                  </div>
                </div>

                {/* Apalancamiento */}
                <div>
                  <label className="block text-xs font-bold text-slate-400 uppercase mb-1">
                    Apalancamiento (Leverage):
                  </label>
                  <select
                    value={leverage || 'default'}
                    onChange={(e) => setLeverage(e.target.value)}
                    className="w-full py-2.5 px-3 bg-slate-900 border border-slate-700 rounded-xl text-sm font-bold text-white outline-none focus:border-amber-400"
                  >
                    <option value="default">Por Defecto ({strategyDefaultLeverage}x de la Estrategia)</option>
                    <option value="1">1x (Sin Apalancamiento - Spot)</option>
                    <option value="2">2x (Muy Conservador)</option>
                    <option value="3">3x (Recomendado Institucional)</option>
                    <option value="5">5x (Moderado)</option>
                    <option value="10">10x (Estándar)</option>
                    <option value="20">20x (Dinámico)</option>
                  </select>
                  <span className="text-[10px] text-slate-500 mt-1 block">
                    {leverage === 'default' || !leverage 
                      ? `Tomando ${strategyDefaultLeverage}x establecido en la estrategia "${selectedStrategy || 'activa'}"`
                      : `Apalancamiento manual seleccionado: ${leverage}x`}
                  </span>
                </div>

                {/* Margen */}
                <div>
                  <label className="block text-xs font-bold text-slate-400 uppercase mb-1">
                    Modo de Margen:
                  </label>
                  <select
                    value={marginType}
                    onChange={(e) => setMarginType(e.target.value)}
                    className="w-full py-2.5 px-3 bg-slate-900 border border-slate-700 rounded-xl text-sm font-bold text-white outline-none focus:border-amber-400"
                  >
                    <option value="ISOLATED">ISOLATED (Margen Aislado - Recomendado)</option>
                    <option value="CROSSED">CROSSED (Margen Cruzado)</option>
                  </select>
                  <span className="text-[10px] text-slate-500 mt-1 block">
                    Aislado limita el riesgo exclusivamente a la orden.
                  </span>
                </div>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* ============================================================== */}
      {/* VISTA 2: COPY-TRADING ESPEJO (MODO 1:1 REPLICACIÓN MAESTRA)    */}
      {/* ============================================================== */}
      {currentSubTab === 'copy_trading' && (
        <div className="space-y-6 animate-fadeIn">
          <div className={`border rounded-3xl p-6 sm:p-8 shadow-xl flex flex-col justify-between transition-all duration-300 ${
            isCopyTradingActive 
              ? 'bg-gradient-to-b from-emerald-950/40 via-slate-900 to-slate-950 border-emerald-500/50 shadow-emerald-500/10' 
              : 'bg-slate-900/90 border-slate-800'
          }`}>
            <div>
              <div className="flex items-center justify-between mb-3">
                <h3 className="text-sm font-bold text-white uppercase tracking-wider flex items-center gap-2">
                  <span>⚡</span> Control de Sincronización Copy-Trading
                </h3>
                <span className="text-[10px] text-amber-400 bg-amber-400/10 px-2.5 py-0.5 rounded-lg border border-amber-400/30 font-bold">
                  Estrategia Maestra
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
                  <span className={`font-bold ${isCopyTradingActive ? 'text-emerald-400 flex items-center gap-1.5' : 'text-slate-400'}`}>
                    {isCopyTradingActive ? (
                      <>
                        <span className="w-2 h-2 rounded-full bg-emerald-400 animate-pulse"></span>
                        COPIANDO TRADES EN VIVO
                      </>
                    ) : isPersonalBotActive ? (
                      '⏸️ PAUSADO (Modo Bot Personal Activo)'
                    ) : (
                      '⏸️ PAUSADO'
                    )}
                  </span>
                </div>
              </div>

              {isPersonalBotActive && (
                <div className="p-3 bg-amber-500/10 border border-amber-500/30 rounded-2xl text-amber-300 text-xs mb-4">
                  ℹ️ Tu cuenta está actualmente operando en <strong>Modo Bot Personal</strong>. Al presionar <strong>"ACTIVAR REPLICACIÓN AUTOMÁTICA"</strong>, se pausará tu bot personal y pasarás a copiar al algoritmo institucional en tiempo real.
                </div>
              )}

              <p className="text-xs text-slate-400 mb-4 leading-relaxed">
                {isCopyTradingActive 
                  ? '🟢 Tu cuenta de Binance está vinculada y ejecutará cada orden de compra y venta del algoritmo institucional en tiempo real.'
                  : '⏸️ La replicación está en pausa. Presiona el botón verde para activar el copiado automático de trades.'}
              </p>
            </div>

            <button
              onClick={handleToggleSync}
              disabled={actionLoading}
              className={`w-full py-3.5 px-6 rounded-2xl font-black text-xs tracking-wider transition-all shadow-xl flex items-center justify-center gap-2 active:scale-[0.98] ${
                isCopyTradingActive
                  ? 'bg-rose-600 hover:bg-rose-500 text-white shadow-rose-600/30'
                  : 'bg-gradient-to-r from-emerald-500 to-teal-500 hover:from-emerald-400 hover:to-teal-400 text-slate-950 shadow-emerald-500/25'
              }`}
            >
              {actionLoading ? (
                <div className="w-4 h-4 border-2 border-current border-t-transparent rounded-full animate-spin"></div>
              ) : isCopyTradingActive ? (
                <><span>⏸️</span> PAUSAR REPLICACIÓN DE TRADES</>
              ) : (
                <><span>⚡</span> ACTIVAR REPLICACIÓN AUTOMÁTICA</>
              )}
            </button>
          </div>
        </div>
      )}

      {/* Sección 3: Historial y Métricas de Operaciones Replicadas / Personales */}
      <div className="bg-slate-900/90 border border-slate-800 rounded-3xl p-6 sm:p-8 shadow-xl space-y-6">
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 border-b border-slate-800 pb-4">
          <div>
            <h3 className="text-base font-bold text-white uppercase tracking-wider flex items-center gap-2">
              <span>📊</span> {currentSubTab === 'my_bot' ? 'Historial de Operaciones de tu Bot Personal' : 'Historial de Operaciones Replicadas (Copy-Trading)'}
            </h3>
            <p className="text-xs text-slate-400 mt-0.5 leading-relaxed">
              {currentSubTab === 'my_bot'
                ? 'Compras y ventas ejecutadas de forma autónoma por la estrategia asignada a tu bot personal.'
                : 'Compras y ventas ejecutadas exclusivamente sobre tu cuenta de Binance Futures por el bot maestro.'}
            </p>
          </div>
          <div className="flex items-center gap-2 self-start sm:self-auto flex-wrap">
            <button
              onClick={fetchUserTrades}
              className="px-3 py-1.5 bg-slate-800 hover:bg-slate-700 text-slate-300 hover:text-white rounded-xl text-xs font-bold transition flex items-center gap-1 active:scale-95"
            >
              ↻ Actualizar Historial
            </button>
            <button
              onClick={handleResetUserTrades}
              disabled={actionLoading}
              className="px-3 py-1.5 bg-rose-950/80 hover:bg-rose-900 text-rose-300 hover:text-white border border-rose-800/60 rounded-xl text-xs font-bold transition flex items-center gap-1 active:scale-95 disabled:opacity-50"
              title="Reiniciar el historial de operaciones personales y poner el PnL a 0.00 USDT"
            >
              <span>🗑️</span> Vaciar Historial & PnL
            </button>
          </div>
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
            <span className="text-[10px] text-slate-500 uppercase block tracking-wider font-semibold">
              {currentSubTab === 'my_bot' ? 'Trades Ejecutados' : 'Trades Replicados'}
            </span>
            <span className="text-lg font-black font-mono text-white">
              {metricsData?.total_trades || 0}
            </span>
          </div>
        </div>

        {/* Gráfico de Crecimiento de Capital Personal */}
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
                  <span>📈 Curva de Capital ({currentSubTab === 'my_bot' ? 'Bot Personal' : 'Copy-Trading'})</span>
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

        {/* Rendimiento por Criptomoneda (Ranking de Pares con Gráfico de Barras por Posición) */}
        {sortedUserCoinPerformance.length > 0 && (
          <div className="p-4 sm:p-6 bg-slate-950 rounded-2xl border border-slate-800 space-y-4">
            <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 pb-3 border-b border-slate-800">
              <div className="flex items-center gap-3">
                <div className="p-2.5 rounded-xl bg-blue-500/20 text-blue-400">
                  <span className="text-xl">📊</span>
                </div>
                <div>
                  <h3 className="text-base font-bold text-white flex items-center gap-2">
                    <span>Ranking de Rendimiento por Criptomoneda</span>
                    <span className="text-xs font-normal text-slate-400">
                      ({sortedUserCoinPerformance.length} pares)
                    </span>
                  </h3>
                  <p className="text-xs text-slate-400 mt-0.5">
                    Compara qué monedas son las más rentables y cuáles generan pérdidas para optimizar tu cesta de trading.
                  </p>
                </div>
              </div>

              {/* Botones de Ordenamiento */}
              <div className="flex flex-wrap items-center gap-1 bg-slate-900 p-1 rounded-xl border border-slate-800 self-start sm:self-auto">
                <span className="text-[11px] font-bold text-slate-400 px-1.5">Orden:</span>
                <button
                  type="button"
                  onClick={() => setUserCoinSortOrder('PNL_DESC')}
                  className={`px-2 py-1 rounded-lg text-xs font-bold transition flex items-center gap-1 ${
                    userCoinSortOrder === 'PNL_DESC'
                      ? 'bg-emerald-600 text-white shadow'
                      : 'text-slate-400 hover:text-white hover:bg-slate-800'
                  }`}
                  title="Mayor ganancia primero"
                >
                  <span>⬇️</span> Mayor PnL
                </button>
                <button
                  type="button"
                  onClick={() => setUserCoinSortOrder('PNL_ASC')}
                  className={`px-2 py-1 rounded-lg text-xs font-bold transition flex items-center gap-1 ${
                    userCoinSortOrder === 'PNL_ASC'
                      ? 'bg-rose-600 text-white shadow'
                      : 'text-slate-400 hover:text-white hover:bg-slate-800'
                  }`}
                  title="Menor ganancia primero"
                >
                  <span>⬆️</span> Menor PnL
                </button>
                <button
                  type="button"
                  onClick={() => setUserCoinSortOrder('WINRATE_DESC')}
                  className={`px-2 py-1 rounded-lg text-xs font-bold transition ${
                    userCoinSortOrder === 'WINRATE_DESC'
                      ? 'bg-blue-600 text-white shadow'
                      : 'text-slate-400 hover:text-white hover:bg-slate-800'
                  }`}
                  title="Mayor Win Rate"
                >
                  🎯 Win Rate
                </button>
                <button
                  type="button"
                  onClick={() => setUserCoinSortOrder('TRADES_DESC')}
                  className={`px-2 py-1 rounded-lg text-xs font-bold transition ${
                    userCoinSortOrder === 'TRADES_DESC'
                      ? 'bg-purple-600 text-white shadow'
                      : 'text-slate-400 hover:text-white hover:bg-slate-800'
                  }`}
                  title="Mayor cantidad de trades"
                >
                  🔢 Trades
                </button>
              </div>
            </div>

            {/* Lista de Monedas con Gráfico de Barras de Cada Posición */}
            <div className="space-y-3">
              {sortedUserCoinPerformance.map((coin, index) => {
                const isProfit = coin.totalPnL >= 0;
                return (
                  <div
                    key={coin.symbol}
                    className="p-3.5 rounded-xl border bg-slate-900/60 border-slate-800 transition-all hover:border-slate-700 shadow-sm"
                  >
                    <div className="flex flex-wrap items-center justify-between gap-2 mb-2">
                      {/* Identificación de la moneda */}
                      <div className="flex items-center space-x-2.5 flex-wrap gap-1">
                        <span className="w-6 h-6 rounded-lg bg-slate-800 text-slate-200 font-bold text-xs flex items-center justify-center font-mono">
                          #{index + 1}
                        </span>
                        <span className="text-sm font-bold text-white font-mono">
                          {coin.symbol}
                        </span>
                        <span className="text-[11px] px-2 py-0.5 rounded-full font-bold bg-slate-800 text-slate-300">
                          {coin.count} {coin.count === 1 ? 'operación' : 'operaciones'}
                        </span>
                        <span className={`text-[11px] px-2 py-0.5 rounded-full font-bold ${
                          parseFloat(coin.winRate) >= 50
                            ? 'bg-emerald-950 text-emerald-300 border border-emerald-800/60'
                            : 'bg-amber-950 text-amber-300 border border-amber-800/60'
                        }`}>
                          Win Rate: {coin.winRate}% ({coin.wins}W / {coin.losses}L)
                        </span>
                      </div>

                      {/* Ganancia acumulada */}
                      <div className="text-right font-mono">
                        <span className={`text-base font-extrabold ${isProfit ? 'text-emerald-400' : 'text-rose-400'}`}>
                          {isProfit ? `+${coin.totalPnL.toFixed(4)}` : coin.totalPnL.toFixed(4)} <span className="text-xs">USDT</span>
                        </span>
                        <div className="text-[10px] text-slate-400 flex items-center justify-end gap-1">
                          <span>Max: +{coin.bestTrade.toFixed(2)}</span>
                          <span>•</span>
                          <span>Min: {coin.worstTrade.toFixed(2)}</span>
                        </div>
                      </div>
                    </div>

                    {/* Gráfico de Barras por Trade Cerrado (Eje Cero con Ganancias Arriba y Pérdidas Abajo) */}
                    {renderCoinTradeSequenceChart(coin.trades, coin.symbol)}
                  </div>
                );
              })}
            </div>
          </div>
        )}

        {/* Tabla de Operaciones */}
        <div className="overflow-x-auto rounded-2xl border border-slate-800 bg-slate-950 shadow-inner">
          <table className="w-full text-left text-xs">
            <thead className="bg-slate-900/90 text-slate-400 text-[10px] font-semibold uppercase tracking-wider border-b border-slate-800">
              <tr>
                <th className="p-3.5 sm:px-4">ID Trade</th>
                <th className="p-3.5">Fecha / Hora</th>
                <th className="p-3.5">Moneda / Par</th>
                <th className="p-3.5">Lado</th>
                <th className="p-3.5">PnL Realizado</th>
                <th className="p-3.5">Precio Entrada</th>
                <th className="p-3.5">Precio Salida</th>
                <th className="p-3.5">Cantidad</th>
                <th className="p-3.5">Margen</th>
                <th className="p-3.5">Valor Posición</th>
                <th className="p-3.5 sm:pr-4">Estado</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-800/60">
              {tradesData.length > 0 ? (
                tradesData.map((t) => {
                  const pnl = Number(t.pnl_usdt || 0);
                  const isWin = pnl >= 0;
                  const tradeId = t.id || t.binance_trade_id || '-';
                  const isClosed = Boolean(t.close_timestamp);

                  // Sanitizar lado: estrictamente 'LONG' o 'SHORT', jamás 'TRADE'
                  const rawSide = String(t.trade_type || '').toUpperCase().trim();
                  const side = (rawSide === 'SHORT' || String(t.close_reason || '').toUpperCase().includes('SHORT')) ? 'SHORT' : 'LONG';

                  const posVal = Number(t.position_value_usdt) || Number(t.position_size_usdt) || (Number(t.open_price || 0) * Number(t.quantity || 0)) || (Number(t.open_price || 0) > 0 ? 1000 : 0);
                  const lev = Number(t.leverage || (botData?.bot_settings?.leverage) || 10);
                  const marginVal = Number(t.margin_usdt) || (posVal > 0 && lev > 0 ? (posVal / lev) : 0);
                  const qtyDisplay = (t.quantity && Number(t.quantity) > 0) ? t.quantity : (posVal > 0 && Number(t.open_price) > 0 ? (posVal / Number(t.open_price)).toFixed(4) : '-');

                  return (
                    <tr key={t.id || tradeId} className="hover:bg-slate-900/50 transition font-sans">
                      {/* 1. ID Trade */}
                      <td className="p-3.5 sm:px-4 font-bold font-mono text-amber-400 whitespace-nowrap">#{tradeId}</td>

                      {/* 2. Fecha / Hora */}
                      <td className="p-3.5 text-slate-300 font-mono text-[11px] whitespace-nowrap">
                        <div className="flex flex-col">
                          <span className="text-white font-medium">{t.open_time_short || formatShortDate(t.open_timestamp)}</span>
                          {isClosed && (
                            <span className="text-[10px] text-slate-500">
                              Fin: {t.close_time_short || formatShortDate(t.close_timestamp)}
                            </span>
                          )}
                        </div>
                      </td>

                      {/* 3. Moneda / Par */}
                      <td className="p-3.5 font-bold font-mono text-white">
                        <div className="flex items-center gap-1.5">
                          <span>{t.symbol}</span>
                          <span className="text-[9px] px-1 py-0.2 rounded bg-slate-800 text-cyan-300 border border-slate-700/80 font-mono">Perp</span>
                        </div>
                      </td>

                      {/* 4. Lado */}
                      <td className="p-3.5">
                        <span className={`px-2 py-0.5 rounded text-[10px] font-black uppercase ${
                          side === 'LONG' ? 'bg-emerald-500/15 text-emerald-400 border border-emerald-500/30' : 'bg-rose-500/15 text-rose-400 border border-rose-500/30'
                        }`}>
                          {side}
                        </span>
                      </td>

                      {/* 5. PnL Realizado */}
                      <td className={`p-3.5 font-bold font-mono text-xs whitespace-nowrap ${isClosed ? (isWin ? 'text-emerald-400' : 'text-rose-400') : 'text-slate-400'}`}>
                        {isClosed ? `${isWin ? '+' : ''}$${pnl.toFixed(4)} USDT` : <span className="text-amber-400/90 text-xs font-sans">En curso</span>}
                      </td>

                      {/* 6. Precio Entrada */}
                      <td className="p-3.5 font-mono text-slate-200 font-semibold">${Number(t.open_price).toFixed(2)}</td>

                      {/* 7. Precio Salida */}
                      <td className="p-3.5 font-mono text-slate-300">
                        {isClosed ? `$${Number(t.close_price).toFixed(2)}` : <span className="text-slate-500 italic">Abierta</span>}
                      </td>

                      {/* 8. Cantidad */}
                      <td className="p-3.5 font-mono text-slate-400">{qtyDisplay}</td>

                      {/* 9. Margen */}
                      <td className="p-3.5 font-mono text-cyan-300 font-semibold whitespace-nowrap">
                        ${marginVal.toFixed(2)} <span className="text-[10px] text-slate-500 font-sans">USDT</span>
                      </td>

                      {/* 10. Valor Posición */}
                      <td className="p-3.5 font-mono text-amber-300 font-semibold whitespace-nowrap">
                        ${posVal.toFixed(2)} <span className="text-[10px] text-slate-500 font-sans">USDT</span>
                      </td>

                      {/* 11. Estado */}
                      <td className="p-3.5 sm:pr-4">
                        {isClosed ? (
                          <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded text-[10px] font-bold bg-slate-800 text-slate-300 border border-slate-700">
                            <span>✅</span> Cerrada
                          </span>
                        ) : (
                          <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded text-[10px] font-black uppercase bg-emerald-500/20 text-emerald-300 border border-emerald-500/40 animate-pulse">
                            <span className="w-1.5 h-1.5 rounded-full bg-emerald-400"></span> En curso
                          </span>
                        )}
                      </td>
                    </tr>
                  );
                })
              ) : (
                <tr>
                  <td colSpan={11} className="p-8 text-center text-slate-500 text-xs">
                    {currentSubTab === 'my_bot'
                      ? 'No hay operaciones cerradas registradas para esta sesión de tu bot personal. Las nuevas posiciones ejecutadas por tu estrategia quedarán registradas aquí.'
                      : 'No hay operaciones cerradas registradas para esta sesión de copytrading. Las nuevas posiciones de la estrategia cuantitativa activa quedarán registradas aquí.'}
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
