import React, { useState, useEffect, useCallback, useMemo, useRef } from 'react';
import { useAuth } from './AuthContext';
import ConfirmModal from './ConfirmModal';
import UserBotMonitorTable from './UserBotMonitorTable';

import { formatShortDate, formatFullDateTime, getCountryTimezone } from './dateUtils';

export default function UserBotPanel({ 
  activeStrategyName, 
  initialSubTab = 'my_bot',
  readOnly = false,
  inspectionUser = null,
  onBackToUsersList = null
}) {
  const { authFetch, user } = useAuth();
  const inspectionUserId = inspectionUser?.id || null;
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

  // Estado para la interacción y Zoom de la Curva de Capital
  const [equityZoomRange, setEquityZoomRange] = useState('ALL'); // 'ALL' | '50' | '20' | '10'
  const [selectedEquityPointIndex, setSelectedEquityPointIndex] = useState(null);

  // Helper robusto para parsear fechas
  const parseSafeDate = useCallback((val) => {
    if (!val) return null;
    if (val instanceof Date) return isNaN(val.getTime()) ? null : val;
    if (typeof val === 'number') {
      const d = new Date(val);
      return isNaN(d.getTime()) ? null : d;
    }
    const s = String(val).trim();
    if (!s) return null;
    if (/^\d{10,13}$/.test(s)) {
      const d = new Date(Number(s.length === 10 ? s + '000' : s));
      if (!isNaN(d.getTime())) return d;
    }
    const iso = s.includes('T') ? (s.endsWith('Z') || s.includes('+') ? s : s + 'Z') : s.replace(' ', 'T') + 'Z';
    let d = new Date(iso);
    if (!isNaN(d.getTime())) return d;
    d = new Date(s);
    return isNaN(d.getTime()) ? null : d;
  }, []);

  // Formateador de duración (ej: 2d 5h 14m, 3h 22m, 45m 12s, 30s)
  const formatDurationStr = useCallback((ms) => {
    if (!ms || ms < 0 || isNaN(ms)) return '0s';
    const totalSeconds = Math.floor(ms / 1000);
    const days = Math.floor(totalSeconds / 86400);
    const hours = Math.floor((totalSeconds % 86400) / 3600);
    const minutes = Math.floor((totalSeconds % 3600) / 60);
    const seconds = totalSeconds % 60;
    if (days > 0) return `${days}d ${hours}h ${minutes}m`;
    if (hours > 0) return `${hours}h ${minutes}m`;
    if (minutes > 0) return `${minutes}m ${seconds}s`;
    return `${seconds}s`;
  }, []);

  // Curva de Capital Personal Completa con Punto Cero, Lapso Total y Métricas
  const userEquityData = useMemo(() => {
    const closedTrades = (tradesData || []).filter(t => Boolean(t.close_timestamp));
    if (closedTrades.length === 0) {
      return {
        allPoints: [],
        totalElapsedStr: '0s',
        puntoCeroDate: null,
        lastCloseDate: null,
        totalNetPnL: 0,
        maxDDUSDT: 0
      };
    }

    const sorted = [...closedTrades].sort((a, b) => {
      const da = parseSafeDate(a.close_timestamp || a.open_timestamp)?.getTime() || (a.id || 0);
      const db = parseSafeDate(b.close_timestamp || b.open_timestamp)?.getTime() || (b.id || 0);
      return da - db;
    });

    const pCeroDate = parseSafeDate(sorted[0].open_timestamp) || parseSafeDate(sorted[0].close_timestamp) || new Date();
    const lCloseDate = parseSafeDate(sorted[sorted.length - 1].close_timestamp) || parseSafeDate(sorted[sorted.length - 1].open_timestamp) || pCeroDate;
    const sessionElapsedMs = Math.max(0, lCloseDate.getTime() - pCeroDate.getTime());
    const totalElapsedStr = formatDurationStr(sessionElapsedMs);

    let running = 0;
    let peak = 0;
    let maxDD = 0;

    const allPts = [
      {
        idx: 0,
        isPuntoCero: true,
        label: 'Punto Cero (Inicio)',
        id: 0,
        symbol: sorted[0].symbol || 'INICIO',
        type: sorted[0].trade_type || 'LONG',
        pnl: 0,
        cumulative: 0,
        date: pCeroDate,
        time: pCeroDate ? `${String(pCeroDate.getHours()).padStart(2, '0')}:${String(pCeroDate.getMinutes()).padStart(2, '0')}` : '00:00',
        shortDate: formatShortDate(pCeroDate),
        fullDateTime: formatFullDateTime(pCeroDate),
        elapsedStr: '0s (Inicio)',
        diffPercent: 0,
        tradeObj: null
      }
    ];

    sorted.forEach((t, i) => {
      const pnl = Number(t.pnl_usdt || 0);
      const prevCum = running;
      running += pnl;

      if (running > peak) peak = running;
      const curDD = peak - running;
      if (curDD > maxDD) maxDD = curDD;

      const cDate = parseSafeDate(t.close_timestamp) || parseSafeDate(t.open_timestamp) || pCeroDate;
      const tradeElapsedMs = Math.max(0, cDate.getTime() - pCeroDate.getTime());
      const tradeElapsedFormatted = formatDurationStr(tradeElapsedMs);

      let diffPct = 0;
      if (prevCum === 0) {
        diffPct = pnl !== 0 ? (pnl > 0 ? 100 : -100) : 0;
      } else {
        diffPct = (pnl / Math.abs(prevCum)) * 100;
      }

      const timeHHmm = cDate ? `${String(cDate.getHours()).padStart(2, '0')}:${String(cDate.getMinutes()).padStart(2, '0')}` : '--:--';

      allPts.push({
        idx: i + 1,
        isPuntoCero: false,
        label: `Cierre #${i + 1}`,
        id: t.id || t.binance_trade_id || (i + 1),
        symbol: t.symbol || 'USDT',
        type: t.trade_type || 'LONG',
        pnl,
        cumulative: running,
        date: cDate,
        time: timeHHmm,
        shortDate: t.close_time_short || formatShortDate(cDate),
        fullDateTime: formatFullDateTime(cDate),
        elapsedStr: `+${tradeElapsedFormatted} desde inicio`,
        diffPercent: diffPct,
        tradeObj: t
      });
    });

    return {
      allPoints: allPts,
      totalElapsedStr,
      puntoCeroDate: pCeroDate,
      lastCloseDate: lCloseDate,
      totalNetPnL: running,
      maxDDUSDT: maxDD
    };
  }, [tradesData, parseSafeDate, formatDurationStr]);

  // Puntos visibles según el Zoom seleccionado
  const visibleEquityPoints = useMemo(() => {
    const pts = userEquityData.allPoints;
    if (pts.length <= 1) return pts;
    if (equityZoomRange === 'ALL') return pts;
    const count = Number(equityZoomRange) || 50;
    // Siempre mantener el punto cero o los últimos N puntos
    const sliceCount = Math.min(pts.length, count + 1);
    return pts.slice(pts.length - sliceCount);
  }, [userEquityData.allPoints, equityZoomRange]);

  // Mantener compatibilidad con referencias anteriores a userEquityPoints
  const userEquityPoints = userEquityData.allPoints;

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
      if (pnl > 0.00001) map[sym].wins += 1;
      else if (pnl < -0.00001) map[sym].losses += 1;
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
      const url = inspectionUserId ? `/api/user/bot?user_id=${inspectionUserId}` : '/api/user/bot';
      const resp = await authFetch(url);
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
  }, [authFetch, inspectionUserId]);

  // Cargar trades personales del usuario
  const fetchUserTrades = useCallback(async () => {
    try {
      const modeParam = currentSubTab === 'my_bot' ? 'PERSONAL_BOT' : 'COPY_TRADING';
      const userParam = inspectionUserId ? `&user_id=${inspectionUserId}` : '';
      const resp = await authFetch(`/api/user/trades?limit=1000&mode=${modeParam}${userParam}`);
      if (!resp.ok) return;
      const data = await resp.json();
      setTradesData(data.trades || []);
      setMetricsData(data.metrics || null);
    } catch (err) {
      console.error("Error al obtener operaciones del usuario:", err);
    }
  }, [authFetch, currentSubTab, inspectionUserId]);

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
  }, [fetchStrategiesCatalog, fetchUserBotStatus, fetchUserTrades, inspectionUserId]);

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
  const rawStratLev = currentStrategyObj?.parameters?.leverage ??
                      currentStrategyObj?.parameters?.leverage_str ??
                      currentStrategyObj?.config?.leverage ??
                      currentStrategyObj?.leverage ??
                      botData?.active_strategy_details?.leverage ??
                      botData?.active_strategy_details?.parameters?.leverage;
  const strategyDefaultLeverage = (rawStratLev !== undefined && rawStratLev !== null && !isNaN(Number(rawStratLev)) && Number(rawStratLev) > 0)
    ? Number(rawStratLev)
    : 5;
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

      {/* Barra de Supervisión de Administrador (Modo Solo Lectura) */}
      {readOnly && (
        <div className="bg-slate-900 border-2 border-indigo-500/60 rounded-3xl p-5 sm:p-6 shadow-2xl flex flex-col md:flex-row items-start md:items-center justify-between gap-4 animate-fadeIn">
          <div className="flex items-center gap-3.5">
            <button
              type="button"
              onClick={onBackToUsersList}
              className="px-4 py-2.5 bg-amber-400 hover:bg-amber-300 text-slate-950 font-black rounded-xl text-xs sm:text-sm flex items-center gap-2 transition shadow-lg active:scale-95 cursor-pointer"
            >
              <span>⬅</span> Volver a Usuarios & Bots
            </button>
            <div>
              <div className="text-white font-black text-sm sm:text-base flex flex-wrap items-center gap-2">
                <span>👁️</span> 
                <span>Bot del usuario:</span>
                <span className="text-amber-300 underline font-mono text-base font-black">
                  {inspectionUser?.username || botData?.target_user?.username || 'Usuario'}
                </span>
                <span className="text-xs text-slate-400 font-mono">
                  ({inspectionUser?.account_number || botData?.target_user?.account_number || ''})
                </span>
                <span className="px-2.5 py-0.5 rounded-full text-[10px] bg-indigo-500/20 text-indigo-300 border border-indigo-500/40 uppercase font-black tracking-wider">
                  Modo Solo Ver
                </span>
              </div>
              <p className="text-[11px] text-slate-400 mt-1">
                Supervisión administrativa en vivo. Sin botones de configuración, activación, pausa ni borrado para proteger la operativa del usuario.
              </p>
            </div>
          </div>
        </div>
      )}

      {/* Banner Superior de Estado Institucional */}
      <div className="relative overflow-hidden bg-gradient-to-r from-slate-900 via-slate-950 to-slate-900 border border-slate-800 rounded-3xl p-6 sm:p-8 shadow-2xl">
        <div className="absolute top-0 right-0 -mt-10 -mr-10 w-64 h-64 bg-amber-500/10 rounded-full blur-3xl pointer-events-none"></div>

        <div className="flex flex-col lg:flex-row lg:items-center justify-between gap-6 relative z-10">
          <div>
            <h1 className="text-2xl sm:text-3xl font-black text-white tracking-tight">
              {readOnly 
                ? `🤖 Bot Personal de ${inspectionUser?.username || botData?.target_user?.username || 'Usuario'}` 
                : (currentSubTab === 'my_bot' ? '🤖 Mi Bot Personal' : '👥 Copy-Trading Binance')}
            </h1>
          </div>

          {/* Tarjeta de Saldo Binance y Estado */}
          <div className="flex flex-wrap sm:flex-nowrap items-center gap-4 bg-slate-950/80 border border-slate-800/80 rounded-2xl p-4 shadow-inner">
            <div className="pr-4 border-r border-slate-800">
              <span className="text-[10px] text-slate-500 block uppercase tracking-wider font-semibold">
                {readOnly ? 'Balance Binance del Usuario' : 'Tu Balance Binance'}
              </span>
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

            {/* Botón Acción: Reiniciar Demo Binance (Oculto en modo readOnly) */}
            {!readOnly && (
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
            )}
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

              {/* Consejo Amigable de Gestión Prudente de Capital */}
              <div className="p-3.5 bg-amber-500/10 border border-amber-500/30 rounded-2xl text-xs text-amber-200/90 flex items-start gap-2.5 mb-4 leading-relaxed">
                <span className="text-base select-none shrink-0 mt-0.5">🌱</span>
                <div>
                  <span className="font-bold text-amber-300 tracking-wide block uppercase text-[11px] mb-0.5">
                    Empieza con paso firme y cabeza fría:
                  </span>
                  <span>
                    <strong>Nunca uses dinero que necesites para vivir o para tus responsabilidades</strong>. Los mercados tienen riesgos y los buenos resultados pasados no garantizan ganancias futuras. Te sugerimos <strong>probar primero con una cantidad pequeña</strong> que no te cause ningún problema si llegas a perderla; tómate tu tiempo para ver los resultados y observar cómo trabaja el bot antes de plantearte una inversión mayor.
                  </span>
                </div>
              </div>

              {isCopyTradingActive && (
                <div className="p-3 bg-amber-500/10 border border-amber-500/30 rounded-2xl text-amber-300 text-xs mb-4">
                  ℹ️ Tu cuenta está actualmente en <strong>Modo Copy-Trading Espejo</strong>. Al presionar <strong>"INICIAR MI BOT CON ESTA ESTRATEGIA"</strong>, se pausará la replicación de Copy-Trading y tu cuenta operará de forma autónoma con tu estrategia seleccionada.
                </div>
              )}

            {!readOnly && (
              <button
                onClick={handleToggleSync}
                disabled={actionLoading}
                className={`w-full py-3.5 px-6 rounded-2xl font-black text-xs tracking-wider transition-all shadow-xl flex items-center justify-center gap-2 active:scale-[0.98] cursor-pointer ${
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
            )}
          </div>

          {/* Tarjeta de Conciliación Contable y Balance en Binance (Estándar Profesional Institucional) */}
          {/* Auditoría de Capital y Ecuación Financiera */}
          {(() => {
            const currentWalletBalance = Number(walletBreakdown?.wallet_balance ?? balance);
            const grossWin = Number(metricsData?.gross_win ?? walletBreakdown?.gross_win ?? 0);
            const grossLoss = Number(metricsData?.gross_loss ?? walletBreakdown?.gross_loss ?? 0);
            const tradingFees = Number(walletBreakdown?.total_commission ?? metricsData?.total_commission ?? 0);
            const fundingFees = Number(walletBreakdown?.total_funding ?? metricsData?.total_funding ?? 0);

            // Capital Inicial: Usar el valor real entregado por el backend o deducir por ecuación contable
            let initialCap = Number(walletBreakdown?.initial_capital ?? botData?.initial_capital ?? 0);
            if (initialCap <= 0 || (Math.abs(initialCap - currentWalletBalance) < 0.01 && (grossWin > 0 || grossLoss > 0))) {
              initialCap = Number((currentWalletBalance - (grossWin - grossLoss - tradingFees - fundingFees)).toFixed(2));
              if (initialCap <= 0) initialCap = 5000.0;
            }

            const committedMargin = Number(walletBreakdown?.margin_in_positions ?? 0);
            const freeAvailableBalance = Number(walletBreakdown?.available_balance ?? Math.max(0, currentWalletBalance - committedMargin));
            const marginPct = currentWalletBalance > 0 ? (committedMargin / currentWalletBalance * 100) : 0;
            const freePct = currentWalletBalance > 0 ? (freeAvailableBalance / currentWalletBalance * 100) : 100;
            const currentUnrealizedPnL = Number(walletBreakdown?.unrealized_pnl ?? 0);
            const currentEquity = currentWalletBalance + currentUnrealizedPnL;

            return (
              <div className="bg-slate-900/90 border border-slate-800 rounded-3xl p-5 sm:p-7 shadow-xl space-y-6 animate-fadeIn">
                
                {/* 1. Encabezado Principal Simplificado */}
                <div className="flex items-center justify-between border-b border-slate-800/80 pb-4">
                  <h4 className="text-sm font-extrabold text-white uppercase tracking-wider flex items-center gap-2">
                    <span>🏦</span> Auditoría de Capital
                  </h4>
                </div>

                {/* Ecuación Contable Desglosada - Sin contenedor anidado, sin iconos a la izquierda, sin subtítulos */}
                <div className="divide-y divide-slate-800/80 font-mono text-xs sm:text-sm">
                  
                  {/* Capital Inicial */}
                  <div className="flex items-center justify-between py-3 px-1 hover:bg-slate-800/20 transition">
                    <span className="text-white font-bold font-sans">
                      Capital Inicial
                    </span>
                    <div className="text-right">
                      <span className="font-bold text-white">${initialCap.toFixed(2)}</span>
                      <span className="text-[10px] text-slate-400 ml-1.5 font-sans">USDT</span>
                    </div>
                  </div>

                  {/* Profits */}
                  <div className="flex items-center justify-between py-3 px-1 hover:bg-slate-800/20 transition">
                    <div className="flex items-center gap-2">
                      <span className="text-emerald-400 font-bold font-sans">
                        Profits
                      </span>
                      {metricsData?.winning_trades > 0 && (
                        <span className="text-[10px] bg-emerald-500/20 text-emerald-300 px-2 py-0.5 rounded font-sans font-semibold">
                          {metricsData.winning_trades} wins
                        </span>
                      )}
                    </div>
                    <div className="text-right">
                      <span className="font-bold text-emerald-400">
                        +${grossWin.toFixed(2)}
                      </span>
                      <span className="text-[10px] text-emerald-500/80 ml-1.5 font-sans">USDT</span>
                    </div>
                  </div>

                  {/* Pérdidas */}
                  <div className="flex items-center justify-between py-3 px-1 hover:bg-slate-800/20 transition">
                    <div className="flex items-center gap-2">
                      <span className="text-rose-400 font-bold font-sans">
                        Pérdidas
                      </span>
                      {metricsData?.losing_trades > 0 && (
                        <span className="text-[10px] bg-rose-500/20 text-rose-300 px-2 py-0.5 rounded font-sans font-semibold">
                          {metricsData.losing_trades} losses
                        </span>
                      )}
                    </div>
                    <div className="text-right">
                      <span className="font-bold text-rose-400">
                        {grossLoss > 0 ? `-$${grossLoss.toFixed(2)}` : `$0.00`}
                      </span>
                      <span className="text-[10px] text-rose-500/80 ml-1.5 font-sans">USDT</span>
                    </div>
                  </div>

                  {/* Comisiones */}
                  <div className="flex items-center justify-between py-3 px-1 hover:bg-slate-800/20 transition">
                    <span className="text-rose-300 font-bold font-sans">
                      Comisiones
                    </span>
                    <div className="text-right">
                      <span className="font-bold text-rose-400">
                        {tradingFees > 0 ? `-$${tradingFees.toFixed(2)}` : `$0.00`}
                      </span>
                      <span className="text-[10px] text-rose-500/80 ml-1.5 font-sans">USDT</span>
                    </div>
                  </div>

                  {/* Financiamientos */}
                  <div className="flex items-center justify-between py-3 px-1 hover:bg-slate-800/20 transition">
                    <span className="text-amber-300 font-bold font-sans">
                      Financiamientos
                    </span>
                    <div className="text-right">
                      <span className="font-bold text-amber-300">
                        {fundingFees > 0 ? `-$${fundingFees.toFixed(2)}` : `$0.00`}
                      </span>
                      <span className="text-[10px] text-amber-500/80 ml-1.5 font-sans">USDT</span>
                    </div>
                  </div>

                  {/* Saldo en Billetera */}
                  <div className="flex items-center justify-between py-3.5 px-3 bg-slate-950/70 rounded-xl mt-1 border border-slate-800">
                    <span className="text-white font-extrabold font-sans uppercase tracking-wider">
                      Saldo en Billetera
                    </span>
                    <div className="text-right">
                      <span className="text-base sm:text-lg font-black text-emerald-400">
                        ${currentWalletBalance.toFixed(2)}
                      </span>
                      <span className="text-[10px] text-slate-400 ml-1.5 font-sans">USDT</span>
                    </div>
                  </div>

                </div>

                {/* ============================================================== */}
                {/* FÓRMULA 2: ¿DÓNDE ESTÁ TU DINERO EN ESTE SEGUNDO?             */}
                {/* ============================================================== */}
                <div className="bg-slate-950/80 border border-slate-800 rounded-2xl p-4 sm:p-5 space-y-3">
                  <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-1 border-b border-slate-800/60 pb-2.5">
                    <span className="text-xs font-extrabold text-white uppercase tracking-wider flex items-center gap-2">
                      <span className="w-5 h-5 rounded-full bg-sky-400 text-slate-950 text-[11px] font-black flex items-center justify-center">2</span>
                      Distribución en Vivo: ¿Dónde está tu dinero ahora mismo?
                    </span>
                    <span className="text-[11px] font-mono text-slate-400 font-semibold">
                      Saldo en Billetera (${currentWalletBalance.toFixed(2)}) = Margen Comprometido + Saldo Libre
                    </span>
                  </div>

                  <div className="grid grid-cols-1 md:grid-cols-2 gap-4 pt-1 font-mono text-xs">
                    
                    {/* Tarjeta 1: Margen Comprometido */}
                    <div className="p-4 bg-slate-900/90 rounded-2xl border border-amber-500/30 flex flex-col justify-between">
                      <div>
                        <div className="flex items-center justify-between mb-1">
                          <span className="text-xs font-bold text-amber-300 font-sans flex items-center gap-1.5">
                            <span>🔒</span> Margen en Operaciones (Garantía Retenida)
                          </span>
                          <span className="text-[10px] font-bold text-amber-400 bg-amber-400/10 px-2 py-0.5 rounded border border-amber-400/30">
                            {marginPct.toFixed(1)}% del saldo
                          </span>
                        </div>
                        <div className="mt-2 flex items-baseline gap-2">
                          <span className="text-2xl font-black text-amber-300">
                            ${committedMargin.toFixed(2)}
                          </span>
                          <span className="text-xs text-slate-400 font-sans">USDT</span>
                        </div>
                        <p className="text-[11px] text-slate-400 font-sans mt-1.5 leading-relaxed">
                          Capital reservado como garantía de margen que respalda las <strong>{walletBreakdown?.open_positions_count || 0} operaciones abiertas</strong> en Binance Futures.
                        </p>
                      </div>
                      <div className="w-full bg-slate-950 h-2 rounded-full overflow-hidden mt-3 border border-slate-800">
                        <div className="bg-amber-400 h-full rounded-full transition-all duration-500" style={{ width: `${Math.min(100, Math.max(0, marginPct))}%` }}></div>
                      </div>
                    </div>

                    {/* Tarjeta 2: Saldo Libre Disponible */}
                    <div className="p-4 bg-slate-900/90 rounded-2xl border border-emerald-500/30 flex flex-col justify-between">
                      <div>
                        <div className="flex items-center justify-between mb-1">
                          <span className="text-xs font-bold text-emerald-300 font-sans flex items-center gap-1.5">
                            <span>🟢</span> Saldo Libre Disponible (Liquidez Inmediata)
                          </span>
                          <span className="text-[10px] font-bold text-emerald-400 bg-emerald-400/10 px-2 py-0.5 rounded border border-emerald-400/30">
                            {freePct.toFixed(1)}% del saldo
                          </span>
                        </div>
                        <div className="mt-2 flex items-baseline gap-2">
                          <span className="text-2xl font-black text-emerald-400">
                            ${freeAvailableBalance.toFixed(2)}
                          </span>
                          <span className="text-xs text-slate-400 font-sans">USDT</span>
                        </div>
                        <p className="text-[11px] text-slate-400 font-sans mt-1.5 leading-relaxed">
                          Capital no comprometido y 100% líquido en tu cuenta, disponible inmediatamente para abrir nuevas oportunidades o retiros.
                        </p>
                      </div>
                      <div className="w-full bg-slate-950 h-2 rounded-full overflow-hidden mt-3 border border-slate-800">
                        <div className="bg-emerald-400 h-full rounded-full transition-all duration-500" style={{ width: `${Math.min(100, Math.max(0, freePct))}%` }}></div>
                      </div>
                    </div>

                  </div>
                </div>

                {/* ============================================================== */}
                {/* FÓRMULA 3: VALORACIÓN EN TIEMPO REAL (PATRIMONIO / EQUITY)     */}
                {/* ============================================================== */}
                <div className="bg-slate-950/80 border border-slate-800 rounded-2xl p-4 sm:p-5 space-y-3">
                  <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-1 border-b border-slate-800/60 pb-2.5">
                    <span className="text-xs font-extrabold text-white uppercase tracking-wider flex items-center gap-2">
                      <span className="w-5 h-5 rounded-full bg-emerald-400 text-slate-950 text-[11px] font-black flex items-center justify-center">3</span>
                      Valoración en Tiempo Real: ¿Cuánto vale tu cuenta hoy si cerraras todo?
                    </span>
                    <span className="text-[11px] font-mono text-slate-400 font-semibold">
                      Saldo en Billetera + PnL Flotante = Patrimonio Total (Equity)
                    </span>
                  </div>

                  <div className="grid grid-cols-1 sm:grid-cols-3 gap-3 pt-1 font-mono text-xs">
                    
                    {/* Billetera */}
                    <div className="p-4 bg-slate-900/90 rounded-2xl border border-slate-800 flex flex-col justify-between">
                      <div>
                        <div className="flex items-center justify-between mb-1">
                          <span className="text-xs font-bold text-slate-300 font-sans flex items-center gap-1.5">
                            <span>💼</span> Saldo en Billetera
                          </span>
                          <span className="text-[10px] font-bold text-slate-400 bg-slate-800 px-2 py-0.5 rounded border border-slate-700">
                            Base Consolidada
                          </span>
                        </div>
                        <div className="mt-2 flex items-baseline gap-2">
                          <span className="text-2xl font-black text-white">
                            ${currentWalletBalance.toFixed(2)}
                          </span>
                          <span className="text-xs text-slate-400 font-sans">USDT</span>
                        </div>
                        <p className="text-[11px] text-slate-400 font-sans mt-1.5 leading-relaxed">
                          Capital consolidado tras operaciones cerradas.
                        </p>
                      </div>
                    </div>

                    {/* Flotante */}
                    <div className={`p-4 bg-slate-900/90 rounded-2xl border flex flex-col justify-between ${currentUnrealizedPnL >= 0 ? 'border-emerald-500/30' : 'border-rose-500/30'}`}>
                      <div>
                        <div className="flex items-center justify-between mb-1">
                          <span className={`text-xs font-bold font-sans flex items-center gap-1.5 ${currentUnrealizedPnL >= 0 ? 'text-emerald-300' : 'text-rose-300'}`}>
                            <span>📈</span> PnL Flotante ({walletBreakdown?.open_positions_count || 0} pos.)
                          </span>
                          <span className={`text-[10px] font-bold px-2 py-0.5 rounded border ${currentUnrealizedPnL >= 0 ? 'text-emerald-400 bg-emerald-400/10 border-emerald-400/30' : 'text-rose-400 bg-rose-400/10 border-rose-400/30'}`}>
                            En curso
                          </span>
                        </div>
                        <div className="mt-2 flex items-baseline gap-2">
                          <span className={`text-2xl font-black ${currentUnrealizedPnL >= 0 ? 'text-emerald-400' : 'text-rose-400'}`}>
                            {currentUnrealizedPnL >= 0 ? '+' : ''}${currentUnrealizedPnL.toFixed(2)}
                          </span>
                          <span className="text-xs text-slate-400 font-sans">USDT</span>
                        </div>
                        <p className="text-[11px] text-slate-400 font-sans mt-1.5 leading-relaxed">
                          Ganancia o pérdida latente en posiciones abiertas.
                        </p>
                      </div>
                    </div>

                    {/* Patrimonio Total (Equity) */}
                    <div className="p-4 bg-gradient-to-br from-amber-500/15 via-slate-900 to-amber-500/10 rounded-2xl border-2 border-amber-400/60 flex flex-col justify-between shadow-xl">
                      <div>
                        <div className="flex items-center justify-between mb-1">
                          <span className="text-xs font-black text-amber-300 font-sans uppercase tracking-wider flex items-center gap-1.5">
                            <span>👑</span> PATRIMONIO TOTAL (EQUITY)
                          </span>
                          <span className="text-[10px] font-bold text-amber-400 bg-amber-400/20 px-2 py-0.5 rounded border border-amber-400/40">
                            Liquidación Total
                          </span>
                        </div>
                        <div className="mt-2 flex items-baseline gap-2">
                          <span className="text-2xl font-black text-amber-300">
                            ${currentEquity.toFixed(2)}
                          </span>
                          <span className="text-xs text-slate-400 font-sans">USDT</span>
                        </div>
                        <p className="text-[11px] text-slate-300 font-sans mt-1.5 leading-relaxed font-semibold">
                          Saldo Billetera (${currentWalletBalance.toFixed(2)}) {currentUnrealizedPnL >= 0 ? '+' : '−'} Flotante (${Math.abs(currentUnrealizedPnL).toFixed(2)})
                        </p>
                      </div>
                    </div>

                  </div>
                </div>

              </div>
            );
          })()}

          {/* Panel de Monitoreo en Vivo de tu Bot Personal (Posiciones Abiertas y Radar de Señales) */}
          <UserBotMonitorTable 
            authFetch={authFetch} 
            isRunning={isPersonalBotActive} 
            activeLeverage={effectiveLeverage} 
            targetUserId={inspectionUserId}
            readOnly={readOnly}
          />

          {/* Catálogo de Estrategias Públicas Curadas (Oculto en modo solo lectura) */}
          {!readOnly && (
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
                  <span>{isCatalogOpen ? '🔼 Ocultar Lista y Configuración' : '🔽 Desplegar Catálogo y Configuración'}</span>
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

                {/* Asignación de Capital y Apalancamiento (Se oculta/despliega junto al catálogo) */}
                <div className="bg-slate-950 border border-slate-800 rounded-2xl p-5 space-y-4 mt-6">
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

                    {/* Modo de Margen */}
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

                  {/* Tarjeta de Auto-Escalado y Equivalencia de Parámetros de la Estrategia */}
                  {(() => {
                    const stratBaseMargin = Number(
                      currentStrategyObj?.parameters?.positionSizeUSDT ??
                      currentStrategyObj?.parameters?.position_size_usdt ??
                      botData?.active_strategy_details?.parameters?.positionSizeUSDT ??
                      botData?.active_strategy_details?.parameters?.position_size_usdt ??
                      50.0
                    ) || 50.0;

                    const userVal = Number(allocatedUsdt) || stratBaseMargin;
                    const scaleFactor = userVal / stratBaseMargin;
                    const scalePercent = (scaleFactor * 100).toFixed(1);

                    const baseTp = Number(
                      currentStrategyObj?.parameters?.takeProfitUSDT ??
                      currentStrategyObj?.parameters?.take_profit_usdt ??
                      botData?.active_strategy_details?.parameters?.takeProfitUSDT ??
                      botData?.active_strategy_details?.parameters?.take_profit_usdt ??
                      50.0
                    ) || 50.0;

                    const baseSl = Number(
                      currentStrategyObj?.parameters?.stopLossUSDT ??
                      currentStrategyObj?.parameters?.stop_loss_usdt ??
                      botData?.active_strategy_details?.parameters?.stopLossUSDT ??
                      botData?.active_strategy_details?.parameters?.stop_loss_usdt ??
                      400.0
                    ) || 400.0;

                    const baseDcaLoss = Number(
                      currentStrategyObj?.parameters?.dcaTriggerLossUsdt ??
                      currentStrategyObj?.parameters?.dca_trigger_loss_usdt ??
                      botData?.active_strategy_details?.parameters?.dcaTriggerLossUsdt ??
                      botData?.active_strategy_details?.parameters?.dca_trigger_loss_usdt ??
                      15.0
                    ) || 15.0;

                    const baseTsAct = Number(
                      currentStrategyObj?.parameters?.pnlTrailingStopActivationUSDT ??
                      currentStrategyObj?.parameters?.pnl_trailing_stop_activation_usdt ??
                      botData?.active_strategy_details?.parameters?.pnlTrailingStopActivationUSDT ??
                      botData?.active_strategy_details?.parameters?.pnl_trailing_stop_activation_usdt ??
                      3.5
                    ) || 3.5;

                    const scaledTp = (baseTp * scaleFactor).toFixed(2);
                    const scaledSl = (baseSl * scaleFactor).toFixed(2);
                    const scaledDca = (baseDcaLoss * scaleFactor).toFixed(2);
                    const scaledTs = (baseTsAct * scaleFactor).toFixed(2);

                    const isScaled = Math.abs(scaleFactor - 1.0) > 0.001;

                    return (
                      <div className="p-3.5 bg-slate-900/80 rounded-xl border border-slate-700/80 space-y-2 text-xs">
                        <div className="flex flex-wrap items-center justify-between gap-2 border-b border-slate-800 pb-2">
                          <div className="flex items-center gap-2">
                            <span className="text-amber-400 font-bold">⚖️ Auto-Ajuste de Equivalencia (ROE Soberano):</span>
                            <span className="bg-amber-400/20 text-amber-300 font-mono font-bold px-2 py-0.5 rounded text-[11px] border border-amber-400/30">
                              {isScaled ? `${scalePercent}% del Capital Base ($${stratBaseMargin} USDT)` : '100% Capital Base (1:1)'}
                            </span>
                          </div>
                          <span className="text-[11px] text-slate-400 font-mono">
                            Nocional: <strong>${(userVal * effectiveLeverage).toFixed(2)} USDT</strong>
                          </span>
                        </div>

                        <p className="text-[11px] text-slate-300 leading-relaxed">
                          Para garantizar que la estrategia mantenga <strong>idéntico rendimiento porcentual (ROE %)</strong> y protección de riesgo con tu margen de <strong>${userVal.toFixed(2)} USDT</strong>, el motor calcula proporcionalmente todos los disparadores monetarios:
                        </p>

                        <div className="grid grid-cols-2 sm:grid-cols-4 gap-2 font-mono text-[11px]">
                          <div className="p-2 bg-slate-950/70 rounded-lg border border-slate-800">
                            <span className="text-[10px] text-slate-400 uppercase tracking-wider block font-sans">Take Profit Ajustado</span>
                            <span className="font-bold text-emerald-400 text-xs">+{scaledTp} USDT</span>
                            <span className="text-[9px] text-slate-500 block font-sans">(Base: ${baseTp})</span>
                          </div>

                          <div className="p-2 bg-slate-950/70 rounded-lg border border-slate-800">
                            <span className="text-[10px] text-slate-400 uppercase tracking-wider block font-sans">Stop Loss Ajustado</span>
                            <span className="font-bold text-rose-400 text-xs">-{scaledSl} USDT</span>
                            <span className="text-[9px] text-slate-500 block font-sans">(Base: ${baseSl})</span>
                          </div>

                          <div className="p-2 bg-slate-950/70 rounded-lg border border-slate-800">
                            <span className="text-[10px] text-slate-400 uppercase tracking-wider block font-sans">DCA Trigger Pérdida</span>
                            <span className="font-bold text-amber-300 text-xs">-{scaledDca} USDT</span>
                            <span className="text-[9px] text-slate-500 block font-sans">(Base: ${baseDcaLoss})</span>
                          </div>

                          <div className="p-2 bg-slate-950/70 rounded-lg border border-slate-800">
                            <span className="text-[10px] text-slate-400 uppercase tracking-wider block font-sans">Trailing Stop Act.</span>
                            <span className="font-bold text-sky-400 text-xs">+{scaledTs} USDT</span>
                            <span className="text-[9px] text-slate-500 block font-sans">(Base: ${baseTsAct})</span>
                          </div>
                        </div>
                      </div>
                    );
                  })()}
                </div>
              </>
            )}
          </div>
        )}
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

            {!readOnly && (
              <button
                onClick={handleToggleSync}
                disabled={actionLoading}
                className={`w-full py-3.5 px-6 rounded-2xl font-black text-xs tracking-wider transition-all shadow-xl flex items-center justify-center gap-2 active:scale-[0.98] cursor-pointer ${
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
            )}
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
              className="px-3 py-1.5 bg-slate-800 hover:bg-slate-700 text-slate-300 hover:text-white rounded-xl text-xs font-bold transition flex items-center gap-1 active:scale-95 cursor-pointer"
            >
              ↻ Actualizar Historial
            </button>
            {!readOnly && (
              <button
                onClick={handleResetUserTrades}
                disabled={actionLoading}
                className="px-3 py-1.5 bg-rose-950/80 hover:bg-rose-900 text-rose-300 hover:text-white border border-rose-800/60 rounded-xl text-xs font-bold transition flex items-center gap-1 active:scale-95 disabled:opacity-50 cursor-pointer"
                title="Reiniciar el historial de operaciones personales y poner el PnL a 0.00 USDT"
              >
                <span>🗑️</span> Vaciar Historial & PnL
              </button>
            )}
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

        {/* Gráfico de Crecimiento de Capital Personal Avanzado con Zoom, Tiempo Total e Inspección */}
        {userEquityData.allPoints.length > 1 && (() => {
          const points = visibleEquityPoints;
          const minE = Math.min(0, ...points.map(p => p.cumulative));
          const maxE = Math.max(0.1, ...points.map(p => p.cumulative));
          const range = (maxE - minE) || 1;
          const svgW = 750;
          const svgH = 200;
          const pad = { top: 20, right: 35, bottom: 45, left: 55 };

          const getX = (i) => {
            const chartW = svgW - pad.left - pad.right;
            if (points.length <= 1) return pad.left + chartW / 2;
            return pad.left + (i / (points.length - 1)) * chartW;
          };
          const getY = (val) => pad.top + (svgH - pad.top - pad.bottom) - ((val - minE) / range) * (svgH - pad.top - pad.bottom);
          const zeroY = getY(0);

          const lineD = points.reduce((acc, pt, i) => `${acc} ${i === 0 ? 'M' : 'L'} ${getX(i)} ${getY(pt.cumulative)}`, '');
          const areaD = `${lineD} L ${getX(points.length - 1)} ${zeroY} L ${getX(0)} ${zeroY} Z`;
          const lastPoint = points[points.length - 1];
          const totalNetPnL = userEquityData.totalNetPnL;

          // Punto inspeccionado actualmente (por defecto el último de los visibles)
          const activeIdx = (selectedEquityPointIndex !== null && selectedEquityPointIndex >= 0 && selectedEquityPointIndex < points.length)
            ? selectedEquityPointIndex
            : points.length - 1;
          const inspectedPt = points[activeIdx] || lastPoint;

          // Ticks del Eje X para horas y fechas
          const numTicks = Math.min(points.length, 6);
          const tickStep = (points.length - 1) / Math.max(1, numTicks - 1);
          const axisTicks = [];
          for (let k = 0; k < numTicks; k++) {
            const ptIdx = Math.round(k * tickStep);
            if (points[ptIdx] && !axisTicks.some(t => t.idx === ptIdx)) {
              axisTicks.push({ pt: points[ptIdx], idx: ptIdx });
            }
          }

          return (
            <div className="p-4 sm:p-5 bg-slate-950 rounded-2xl border border-slate-800 space-y-3 relative shadow-xl">
              {/* Encabezado Superior: Título, Lapso Total y Zoom Toolbar */}
              <div className="flex flex-col md:flex-row md:items-center justify-between gap-3 pb-3 border-b border-slate-800/80">
                <div className="flex flex-wrap items-center gap-2.5">
                  <span className="text-sm font-bold text-white flex items-center gap-2">
                    <span className="text-base">{totalNetPnL >= 0 ? '📈' : '📉'}</span>
                    <span>Curva de Capital ({currentSubTab === 'my_bot' ? 'Bot Personal' : 'Copy-Trading'})</span>
                  </span>
                  <span className="bg-slate-800/80 text-slate-300 text-[11px] px-2.5 py-0.5 rounded-full font-mono font-medium border border-slate-700/60">
                    {userEquityData.allPoints.length - 1} {(userEquityData.allPoints.length - 1) === 1 ? 'operación' : 'operaciones'}
                  </span>
                </div>

                {/* Métricas de Cabecera: Tiempo Transcurrido Total y PnL Acumulado */}
                <div className="flex flex-wrap items-center gap-2 text-xs font-mono">
                  <div className="flex items-center gap-1.5 bg-slate-900/90 border border-slate-700/80 px-2.5 py-1 rounded-lg">
                    <span className="text-amber-400 font-bold">⏱️ Tiempo Total:</span>
                    <span className="text-white font-black">{userEquityData.totalElapsedStr}</span>
                    <span className="text-slate-400 text-[10px] hidden sm:inline">(Punto Cero ➔ Último)</span>
                  </div>

                  <div className="flex items-center gap-1.5 bg-slate-900/90 border border-slate-700/80 px-2.5 py-1 rounded-lg">
                    <span className="text-slate-400">Total:</span>
                    <span className={`font-black ${totalNetPnL >= 0 ? 'text-emerald-400' : 'text-rose-400'}`}>
                      {totalNetPnL >= 0 ? '+' : ''}${totalNetPnL.toFixed(4)} USDT
                    </span>
                  </div>
                </div>
              </div>

              {/* Barra de Ajuste y Zoom Interactivo */}
              <div className="flex flex-wrap items-center justify-between gap-2 text-xs">
                <div className="flex items-center gap-1.5">
                  <span className="text-[11px] font-bold text-slate-400 uppercase tracking-wider flex items-center gap-1">
                    🔍 Zoom / Vista:
                  </span>
                  <div className="inline-flex rounded-lg bg-slate-900 p-0.5 border border-slate-800">
                    {[
                      { key: 'ALL', label: 'Todo' },
                      { key: '50', label: 'Últimos 50' },
                      { key: '20', label: 'Últimos 20' },
                      { key: '10', label: 'Últimos 10' }
                    ].map(opt => (
                      <button
                        key={opt.key}
                        type="button"
                        onClick={() => {
                          setEquityZoomRange(opt.key);
                          setSelectedEquityPointIndex(null);
                        }}
                        className={`px-2.5 py-1 text-xs font-mono font-bold rounded-md transition-all ${
                          equityZoomRange === opt.key
                            ? 'bg-blue-600 text-white shadow-sm'
                            : 'text-slate-400 hover:text-white hover:bg-slate-800/60'
                        }`}
                      >
                        {opt.label}
                      </button>
                    ))}
                  </div>
                </div>

                {equityZoomRange !== 'ALL' && (
                  <span className="text-[11px] text-sky-400 font-mono bg-sky-950/40 border border-sky-800/40 px-2 py-0.5 rounded">
                    Mostrando últimos {points.length - 1} trades del historial
                  </span>
                )}
              </div>

              {/* Tarjeta de Inspección Detallada del Punto / Trade Seleccionado */}
              {inspectedPt && (
                <div className="p-3 bg-slate-900/90 rounded-xl border border-slate-700/80 shadow-inner">
                  <div className="flex flex-wrap items-center justify-between gap-2 border-b border-slate-800/80 pb-2 mb-2">
                    <div className="flex items-center gap-2">
                      <span className={`px-2 py-0.5 rounded text-[11px] font-mono font-bold ${
                        inspectedPt.isPuntoCero
                          ? 'bg-amber-500/20 text-amber-300 border border-amber-500/40'
                          : 'bg-sky-500/20 text-sky-300 border border-sky-500/40'
                      }`}>
                        {inspectedPt.isPuntoCero ? '🎯 PUNTO CERO' : `📍 TRADE #${inspectedPt.id}`}
                      </span>
                      <span className="text-xs font-bold text-white font-mono">
                        {inspectedPt.isPuntoCero ? 'Inicio de Operaciones de la Cuenta' : `${inspectedPt.symbol} (${inspectedPt.type})`}
                      </span>
                    </div>

                    <div className="flex flex-wrap items-center gap-2 text-xs">
                      <span className="text-slate-300 font-mono text-[11px]">📅 {inspectedPt.fullDateTime}</span>
                      <span className="bg-slate-800 text-amber-300 px-2 py-0.5 rounded font-mono font-bold text-[11px] border border-slate-700">
                        ⏱️ {inspectedPt.elapsedStr}
                      </span>
                    </div>
                  </div>

                  <div className="grid grid-cols-2 sm:grid-cols-4 gap-2 text-xs font-mono">
                    <div className="p-2 bg-slate-950/70 rounded-lg border border-slate-800/80">
                      <span className="text-[10px] text-slate-400 uppercase tracking-wider block">PnL del Trade</span>
                      <span className={`text-sm font-black ${inspectedPt.isPuntoCero ? 'text-slate-400' : (inspectedPt.pnl >= 0 ? 'text-emerald-400' : 'text-rose-400')}`}>
                        {inspectedPt.isPuntoCero ? '0.0000 USDT' : `${inspectedPt.pnl >= 0 ? '+' : ''}${inspectedPt.pnl.toFixed(4)} USDT`}
                      </span>
                    </div>

                    <div className="p-2 bg-slate-950/70 rounded-lg border border-slate-800/80">
                      <span className="text-[10px] text-slate-400 uppercase tracking-wider block">Capital Acumulado</span>
                      <span className={`text-sm font-black ${inspectedPt.cumulative >= 0 ? 'text-emerald-400' : 'text-rose-400'}`}>
                        {inspectedPt.cumulative >= 0 ? '+' : ''}${inspectedPt.cumulative.toFixed(4)} USDT
                      </span>
                    </div>

                    <div className="p-2 bg-slate-950/70 rounded-lg border border-slate-800/80">
                      <span className="text-[10px] text-slate-400 uppercase tracking-wider block">Hora de Cierre</span>
                      <span className="text-sm font-bold text-slate-200">
                        {inspectedPt.time}
                      </span>
                    </div>

                    <div className="p-2 bg-slate-950/70 rounded-lg border border-slate-800/80">
                      <span className="text-[10px] text-slate-400 uppercase tracking-wider block">% Rendimiento vs Anterior</span>
                      {inspectedPt.isPuntoCero ? (
                        <span className="text-xs text-slate-400 font-bold">Punto 0.00%</span>
                      ) : (
                        <span className={`text-sm font-black ${inspectedPt.pnl >= 0 ? 'text-emerald-400' : 'text-rose-400'}`}>
                          {inspectedPt.pnl >= 0 ? '+' : ''}{inspectedPt.diffPercent.toFixed(2)}%
                        </span>
                      )}
                    </div>
                  </div>
                </div>
              )}

              {/* Contenedor del Gráfico SVG con Ejes X/Y */}
              <div className="w-full overflow-x-auto pt-1">
                <svg viewBox={`0 0 ${svgW} ${svgH}`} className="w-full h-auto max-h-56 select-none">
                  <defs>
                    <linearGradient id="userEquityGrad" x1="0" y1="0" x2="0" y2="1">
                      <stop offset="0%" stopColor={totalNetPnL >= 0 ? "#10b981" : "#f43f5e"} stopOpacity="0.38" />
                      <stop offset="100%" stopColor={totalNetPnL >= 0 ? "#10b981" : "#f43f5e"} stopOpacity="0.0" />
                    </linearGradient>
                  </defs>

                  {/* Línea horizontal en Y = 0 */}
                  <line x1={pad.left} y1={zeroY} x2={svgW - pad.right} y2={zeroY} stroke="#334155" strokeDasharray="3 3" strokeWidth="1.2" />

                  {/* Área bajo la curva */}
                  <path d={areaD} fill="url(#userEquityGrad)" />

                  {/* Línea de crecimiento */}
                  <path d={lineD} fill="none" stroke={totalNetPnL >= 0 ? "#10b981" : "#f43f5e"} strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" />

                  {/* Eje horizontal base */}
                  <line x1={pad.left} y1={svgH - pad.bottom} x2={svgW - pad.right} y2={svgH - pad.bottom} stroke="#334155" strokeWidth="1" />

                  {/* Ticks y Horas / Fechas en el Eje X */}
                  {axisTicks.map(({ pt, idx }) => (
                    <g key={`tick-${idx}`}>
                      <line
                        x1={getX(idx)}
                        y1={svgH - pad.bottom}
                        x2={getX(idx)}
                        y2={svgH - pad.bottom + 5}
                        stroke="#475569"
                        strokeWidth="1"
                      />
                      <text
                        x={getX(idx)}
                        y={svgH - pad.bottom + 17}
                        fill="#94a3b8"
                        fontSize="10"
                        textAnchor="middle"
                        fontFamily="monospace"
                      >
                        {pt.time}
                      </text>
                      {pt.shortDate && (
                        <text
                          x={getX(idx)}
                          y={svgH - pad.bottom + 28}
                          fill="#64748b"
                          fontSize="9"
                          textAnchor="middle"
                          fontFamily="monospace"
                        >
                          {pt.shortDate.split(' ')[0]}
                        </text>
                      )}
                    </g>
                  ))}

                  {/* Guía vertical interactiva para el punto activo */}
                  {inspectedPt && (
                    <g>
                      <line
                        x1={getX(activeIdx)}
                        y1={pad.top}
                        x2={getX(activeIdx)}
                        y2={svgH - pad.bottom}
                        stroke="#38bdf8"
                        strokeWidth="1.5"
                        strokeDasharray="3 3"
                        opacity="0.85"
                      />
                      <rect
                        x={getX(activeIdx) - 24}
                        y={svgH - pad.bottom + 20}
                        width="48"
                        height="16"
                        rx="4"
                        fill="#0284c7"
                        opacity="0.95"
                      />
                      <text
                        x={getX(activeIdx)}
                        y={svgH - pad.bottom + 32}
                        fill="#ffffff"
                        fontSize="9"
                        fontWeight="bold"
                        textAnchor="middle"
                        fontFamily="monospace"
                      >
                        {inspectedPt.time}
                      </text>
                    </g>
                  )}

                  {/* Puntos interactivos clickeables / hover */}
                  {points.map((pt, i) => {
                    const isSelected = i === activeIdx;
                    return (
                      <g
                        key={`pt-${i}`}
                        className="cursor-pointer"
                        onClick={() => setSelectedEquityPointIndex(i)}
                        onTouchStart={() => setSelectedEquityPointIndex(i)}
                        onMouseEnter={() => setSelectedEquityPointIndex(i)}
                      >
                        {/* Target táctil invisible */}
                        <circle cx={getX(i)} cy={getY(pt.cumulative)} r={14} fill="transparent" />

                        {isSelected && (
                          <circle cx={getX(i)} cy={getY(pt.cumulative)} r={7} fill="none" stroke="#38bdf8" strokeWidth="2.5" opacity="0.85" />
                        )}

                        <circle
                          cx={getX(i)}
                          cy={getY(pt.cumulative)}
                          r={isSelected ? 5.5 : (i === 0 ? 3.5 : (points.length > 50 ? 2.5 : 3.5))}
                          fill={i === 0 ? '#fbbf24' : (pt.pnl >= 0 ? '#10b981' : '#f43f5e')}
                          stroke={isSelected ? '#38bdf8' : '#0f172a'}
                          strokeWidth={isSelected ? 2 : 1.2}
                        >
                          <title>{pt.idx === 0 ? 'Inicio 0.00' : `Trade #${pt.id} (${pt.symbol}): ${pt.pnl >= 0 ? '+' : ''}${pt.pnl.toFixed(4)} USDT | ${pt.time}`}</title>
                        </circle>
                      </g>
                    );
                  })}

                  {/* Etiquetas de valores de escala Y */}
                  <text x={pad.left - 8} y={getY(maxE) + 4} fill="#94a3b8" fontSize="10" textAnchor="end" fontFamily="monospace">
                    +{maxE.toFixed(2)}
                  </text>
                  <text x={pad.left - 8} y={zeroY + 4} fill="#cbd5e1" fontSize="10" textAnchor="end" fontFamily="monospace">
                    0.00
                  </text>
                  {minE < 0 && (
                    <text x={pad.left - 8} y={getY(minE) + 4} fill="#f87171" fontSize="10" textAnchor="end" fontFamily="monospace">
                      {minE.toFixed(2)}
                    </text>
                  )}
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
                  const lev = Number(t.leverage) || Number(botData?.bot_settings?.leverage) || 5;
                  const rawMargin = Number(t.margin_usdt || 0);
                  const marginVal = (rawMargin > 0 && Math.abs(rawMargin - (posVal / 10.0)) > 1.0) ? rawMargin : (posVal > 0 && lev > 0 ? (posVal / lev) : 0);
                  const qtyDisplay = (t.quantity && Number(t.quantity) > 0) ? t.quantity : (posVal > 0 && Number(t.open_price) > 0 ? (posVal / Number(t.open_price)).toFixed(4) : '-');

                  return (
                    <tr key={t.id || tradeId} className="hover:bg-slate-900/50 transition font-sans">
                      {/* 1. ID Trade */}
                      <td className="p-3.5 sm:px-4 font-bold font-mono text-amber-400 whitespace-nowrap">#{tradeId}</td>

                      {/* 2. Fecha / Hora */}
                      <td className="p-3.5 text-slate-300 font-mono text-[11px] whitespace-nowrap">
                        <div className="flex flex-col">
                          <span className="text-white font-medium">{formatShortDate(t.open_timestamp, user?.country) || t.open_time_short}</span>
                          {isClosed && (
                            <span className="text-[10px] text-slate-500">
                              Fin: {formatShortDate(t.close_timestamp, user?.country) || t.close_time_short}
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

                      {/* 5. PnL Realizado / Flotante */}
                      <td className={`p-3.5 font-bold font-mono text-xs whitespace-nowrap ${isClosed ? (isWin ? 'text-emerald-400' : 'text-rose-400') : 'text-slate-400'}`}>
                        {isClosed ? (
                          `${isWin ? '+' : ''}$${pnl.toFixed(4)} USDT`
                        ) : t.unrealized_pnl !== undefined && t.unrealized_pnl !== null ? (
                          <div className="flex flex-col">
                            <span className={`font-bold font-mono text-xs ${Number(t.unrealized_pnl) >= 0 ? 'text-emerald-400' : 'text-rose-400'}`}>
                              {Number(t.unrealized_pnl) >= 0 ? '+' : ''}${Number(t.unrealized_pnl).toFixed(4)} USDT
                            </span>
                            <span className="text-[9px] text-amber-400/90 font-mono font-semibold uppercase tracking-tight">Flotante</span>
                          </div>
                        ) : (
                          <span className="text-amber-400/90 text-xs font-sans">En curso</span>
                        )}
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
