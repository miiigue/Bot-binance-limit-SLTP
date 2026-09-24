import React, { useState, useEffect, useMemo, useRef } from 'react';
import BinanceSortHeader, { sortTableData } from './BinanceSortHeader';

// Clave para guardar/leer en localStorage
const STATUS_CACHE_KEY = 'botStatusesCache';

// Helper para formatear fechas (interpreta strings UTC de SQLite correctamente para mostrar la hora local)
const formatDate = (dateString) => {
  if (!dateString) return 'N/A';
  try {
    const raw = String(dateString).trim();
    const isoString = (raw.includes('T') || raw.includes('Z') || raw.includes('+')) 
      ? (raw.endsWith('Z') || raw.includes('+') ? raw : raw + 'Z')
      : raw.replace(' ', 'T') + 'Z';
    const parsed = new Date(isoString);
    return isNaN(parsed.getTime()) ? dateString : parsed.toLocaleString();
  } catch (e) {
    return dateString;
  }
};

// Helper para formatear PnL
const formatPnl = (pnl) => {
  if (pnl === null || pnl === undefined) return 'N/A';
  const value = parseFloat(pnl);
  return isNaN(value) ? 'N/A' : `${value.toFixed(4)} USDT`;
};

// --- NUEVA FUNCIÓN HELPER PARA COLOR DE PNL ---
const getPnlColorClass = (pnl) => {
  if (pnl === null || pnl === undefined) return 'text-slate-300';
  const value = parseFloat(pnl);
  if (isNaN(value)) return 'text-slate-300';
  if (value > 0) return 'text-emerald-400 font-bold';
  if (value < 0) return 'text-rose-400 font-bold';
  return 'text-slate-300 font-bold';
};
// --- SUBCOMPONENTE DE DIAGNÓSTICO EN TIEMPO REAL (RADAR & PROTECCIÓN) ---
function renderSinglePositionDiag(pos, tradeSide, pnlVal) {
  const pnlUsdt = pos?.pnl_usdt !== undefined ? Number(pos.pnl_usdt) : (parseFloat(pnlVal) || 0);
  const isShort = tradeSide === 'SHORT';

  // 1. Métricas de TP
  const tp = pos?.tp || {
    target_usdt: pos?.tp_target_usdt,
    progress_pct: pos?.tp_progress_pct,
    remaining_usdt: (pos?.tp_target_usdt && pnlUsdt !== undefined) ? Math.max(0, Number(pos.tp_target_usdt) - pnlUsdt) : null,
    hit: pos?.tp_target_usdt ? pnlUsdt >= Number(pos.tp_target_usdt) : false
  };
  const hasTp = tp.target_usdt !== null && tp.target_usdt !== undefined && Number(tp.target_usdt) > 0;
  const tpProgress = Math.min(100, Math.max(0, tp.progress_pct || 0));

  // 2. Métricas de Trailing Stop
  const ts = pos?.ts || {
    enabled: Boolean(pos?.trailing_active),
    armed: Boolean(pos?.trailing_armed),
    label: pos?.trailing_armed ? 'ARMADO' : 'Inactivo',
    tolerance_pct: 100,
    arm_progress_pct: 0
  };
  const hasTs = Boolean(ts.enabled);
  const tsArmThreshold = (ts.activation_threshold && Number(ts.activation_threshold) > 0)
    ? Number(ts.activation_threshold)
    : (hasTp ? Number(tp.target_usdt) * 0.7 : null);
  const tsArmPosPct = (hasTp && tsArmThreshold && tsArmThreshold > 0)
    ? Math.min(95, Math.max(5, (tsArmThreshold / Number(tp.target_usdt)) * 100))
    : null;

  // 3. Métricas de Stop Loss
  const slTarget = pos?.sl?.target_usdt !== undefined ? pos.sl.target_usdt : pos?.sl_target_usdt;
  const slDist = pos?.sl?.distance_usdt !== undefined ? pos.sl.distance_usdt : pos?.sl_distance_usdt;
  const hasSl = slTarget !== null && slTarget !== undefined;
  
  let slFillPct = 0;
  if (pnlUsdt < 0 && slTarget && Number(slTarget) < 0) {
    slFillPct = Math.min(100, Math.max(0, (Math.abs(pnlUsdt) / Math.abs(Number(slTarget))) * 100));
  }

  return (
    <div key={tradeSide || 'default'} className="flex flex-col gap-1 min-w-[230px] max-w-[380px] py-0.5">
      {tradeSide && (
        <div className="flex items-center justify-between text-[10px] font-mono mb-0.5">
          <span className={`px-1.5 py-0.2 rounded font-bold ${
            isShort ? 'bg-rose-950 text-rose-300 border border-rose-600/50' : 'bg-emerald-950 text-emerald-300 border border-emerald-600/50'
          }`}>
            {isShort ? '🔴 SHORT' : '🟢 LONG'}
          </span>
          <span className={`font-bold ${pnlUsdt >= 0 ? 'text-emerald-400' : 'text-rose-400'}`}>
            PnL: {pnlUsdt >= 0 ? '+' : ''}{pnlUsdt.toFixed(2)} USDT
          </span>
        </div>
      )}
      {/* --- FILA 1: TAKE PROFIT --- */}
      {hasTp ? (
        <div className="flex flex-col gap-0.5">
          <div className="flex items-center justify-between text-[11px] font-mono leading-tight">
            <div className="flex items-center gap-1.5 flex-wrap">
              <span className="font-extrabold text-emerald-300 flex items-center gap-1">
                <span>🎯 TP:</span>
                <span>+{Number(tp.target_usdt).toFixed(2)} USDT</span>
              </span>
              {hasTs && (
                ts.armed ? (
                  <span className="text-[10px] font-bold text-sky-300 flex items-center gap-1 animate-pulse">
                    <span>🔵 TS Protegiendo</span>
                  </span>
                ) : tsArmThreshold ? (
                  <span className="text-[10px] text-sky-400 font-mono hidden sm:inline" title={`Trailing Stop se armará al alcanzar +${tsArmThreshold.toFixed(2)} USDT`}>
                    ⚡ TS: +{tsArmThreshold.toFixed(2)}
                  </span>
                ) : null
              )}
            </div>
            <div className="flex items-center gap-1.5 text-[10px]">
              {tp.remaining_usdt !== null && tp.remaining_usdt > 0 && (
                <span className="text-slate-400 font-sans hidden sm:inline">
                  (Faltan: +{Number(tp.remaining_usdt).toFixed(2)})
                </span>
              )}
              <span className={`font-black font-mono ${pnlUsdt >= 0 ? (ts.armed ? 'text-sky-400' : 'text-emerald-400') : 'text-slate-400'}`}>
                {Math.round(tpProgress)}%
              </span>
            </div>
          </div>
          <div className="relative w-full bg-slate-900/90 rounded-full h-2 overflow-hidden border border-slate-700/80">
            {hasTs && tsArmPosPct && !ts.armed && (
              <div
                className="absolute top-0 bottom-0 w-1 bg-sky-400 z-20 shadow-sm shadow-sky-400"
                style={{ left: `${tsArmPosPct}%` }}
                title={`Umbral de activación Trailing Stop: +${tsArmThreshold} USDT`}
              />
            )}
            <div
              className={`h-full rounded-full transition-all duration-500 ${
                tpProgress >= 100 
                  ? 'bg-emerald-400 animate-pulse' 
                  : ts.armed
                    ? 'bg-gradient-to-r from-teal-500 via-sky-500 to-blue-500 shadow-sm shadow-sky-500/50'
                    : pnlUsdt >= 0 
                      ? 'bg-gradient-to-r from-teal-500 to-emerald-400' 
                      : 'bg-slate-700'
              }`}
              style={{ width: `${tpProgress}%` }}
            />
          </div>
        </div>
      ) : (
        <div className="flex items-center gap-1.5 text-[11px] font-mono text-emerald-400 font-bold">
          <span>🎯 TP:</span>
          <span>Dinámico por Señal / Trailing</span>
        </div>
      )}

      {/* --- FILA 2: TRAILING STOP O STOP LOSS --- */}
      {ts.armed ? (
        <div className="flex flex-col gap-0.5">
          <div className="flex items-center justify-between text-[11px] font-mono leading-tight">
            <div className="flex items-center gap-1.5 flex-wrap">
              <span className="font-extrabold text-sky-300 flex items-center gap-1 animate-pulse">
                <span>🔵 TS ACTIVO:</span>
                <span>{ts.floor_value !== null && ts.floor_value !== undefined ? `Piso +${ts.floor_value} USDT` : (ts.label || 'Protegiendo')}</span>
              </span>
              {ts.peak_value !== null && ts.peak_value !== undefined && (
                <span className="text-[10px] text-slate-400 font-sans hidden sm:inline">
                  (Pico: +{ts.peak_value})
                </span>
              )}
            </div>
            <div className="flex items-center gap-1.5 text-[10px]">
              <span className="text-slate-300 font-sans">
                Tolerancia:
              </span>
              <span className="font-black font-mono text-sky-400">
                {Math.round(ts.tolerance_pct !== null && ts.tolerance_pct !== undefined ? ts.tolerance_pct : 100)}%
              </span>
            </div>
          </div>
          <div className="w-full bg-slate-900/90 rounded-full h-2 overflow-hidden border border-sky-900/80">
            <div
              className="h-full rounded-full transition-all duration-500 bg-gradient-to-r from-blue-600 via-sky-500 to-cyan-400 shadow-sm shadow-sky-500/50"
              style={{ width: `${Math.min(100, Math.max(5, ts.tolerance_pct !== null && ts.tolerance_pct !== undefined ? ts.tolerance_pct : 100))}%` }}
            />
          </div>
        </div>
      ) : hasSl ? (
        <div className="flex flex-col gap-0.5">
          <div className="flex items-center justify-between text-[11px] font-mono leading-tight">
            <span className="font-extrabold text-rose-300 flex items-center gap-1">
              <span>🛑 SL:</span>
              <span>{Number(slTarget).toFixed(2)} USDT</span>
            </span>
            <div className="flex items-center gap-1.5 text-[10px]">
              <span className="text-slate-300 font-sans">
                Colchón: <span className="font-bold font-mono text-slate-200">+{slDist !== null && slDist !== undefined ? Number(slDist).toFixed(2) : '0.00'}</span>
              </span>
              {pnlUsdt >= 0 ? (
                <span className="font-black font-mono text-emerald-400">
                  🛡️ Seguro
                </span>
              ) : (
                <span className="font-black font-mono text-rose-400 animate-pulse">
                  {Math.round(slFillPct)}% riesgo
                </span>
              )}
            </div>
          </div>
          <div className="w-full bg-slate-900/90 rounded-full h-2 overflow-hidden border border-slate-700/80">
            <div
              className={`h-full rounded-full transition-all duration-500 ${
                slFillPct >= 80
                  ? 'bg-gradient-to-r from-red-600 to-rose-500 animate-pulse'
                  : 'bg-gradient-to-r from-rose-600 to-red-500'
              }`}
              style={{ width: `${slFillPct}%` }}
            />
          </div>
        </div>
      ) : null}
    </div>
  );
}

function LiveDiagnosticsCell({ status }) {
  if (!status) return null;

  // CASO 1: EN POSICIÓN ABIERTA -> Telemetría Visual (Soporta Dual Position Hedge Mode)
  if (status.in_position) {
    const activeSubPositions = (status.positions || []).filter(p => p.in_position);
    if (activeSubPositions.length > 0) {
      return (
        <div className="flex flex-col gap-2">
          {activeSubPositions.map(sp => renderSinglePositionDiag(sp.position_diagnostics || {}, sp.trade_side, sp.current_pnl))}
        </div>
      );
    }
    return (
      <div className="flex flex-col gap-1.5 min-w-[240px] max-w-[380px] py-0.5">
        {renderSinglePositionDiag(status.position_diagnostics || {}, status.trade_side, status.current_pnl)}
      </div>
    );
  }

  // CASO 2: BOT PAUSADO (Manual, Cooldown, Hard Stop o Escudo BTC)
  if (status.is_paused) {
    const isHardStop = status.pause_reason && status.pause_reason.includes('Hard Stop');
    const isCooldown = status.cooldown_remaining_seconds > 0;
    const isBtcShield = status.pause_reason && status.pause_reason.includes('Escudo BTC');

    let badgeClass = 'text-amber-300/90 border-amber-500/40 bg-amber-950/40';
    let icon = '⏸️';
    let text = status.pause_reason || 'Búsqueda de entradas en pausa';

    if (isHardStop) {
      badgeClass = 'text-red-300 border-red-500/50 bg-red-950/60 font-bold';
      icon = '🛑';
    } else if (isCooldown) {
      const mins = Math.max(1, Math.ceil(status.cooldown_remaining_seconds / 60));
      badgeClass = 'text-amber-300 border-amber-500/50 bg-amber-950/60 font-bold animate-pulse';
      icon = '⏳';
      text = `Enfriamiento: ${mins}m restantes (${status.pause_reason || 'Pausa por racha'})`;
    } else if (isBtcShield) {
      badgeClass = 'text-sky-300 border-sky-500/50 bg-sky-950/60 font-bold';
      icon = '🛡️';
    }

    return (
      <div className={`inline-flex items-center gap-1.5 px-2 py-1 rounded-lg text-xs font-mono border ${badgeClass}`}>
        <span>{icon}</span>
        <span>{text}</span>
      </div>
    );
  }

  // CASO 3: SIN POSICIÓN -> Radar de Condiciones de Entrada (Sin badge redundante de Filtros 0/2)
  const diag = status.entry_diagnostics;
  if (!diag || !Array.isArray(diag.conditions) || diag.conditions.length === 0) {
    return (
      <div className="flex items-center gap-1.5 text-xs text-slate-400 font-mono">
        <span className="animate-spin text-[11px]">🌀</span>
        <span>Analizando mercado...</span>
      </div>
    );
  }

  const { conditions, all_met, ratio_text } = diag;

  return (
    <div className="flex items-center gap-1 flex-wrap py-0.5 max-w-[420px]">
      {all_met && (
        <span className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded text-[10px] font-black tracking-wide bg-emerald-500 text-slate-950 border border-emerald-400 animate-pulse shadow-sm shadow-emerald-500/50">
          <span>⚡ SEÑAL ({ratio_text})</span>
        </span>
      )}

      {/* Badges de filtros individuales directamente sin badge redundante 0/2 */}
      {conditions.map((c) => {
        if (!c.active) {
          return (
            <span
              key={c.id}
              className="inline-flex items-center gap-0.5 px-1.5 py-0.5 rounded text-[10px] font-mono text-slate-500 bg-slate-900/60 border border-slate-800"
              title={`${c.name}: Desactivado en configuración`}
            >
              <span>⚪</span>
              <span>{c.short_name || c.name}</span>
            </span>
          );
        }

        if (c.passed) {
          return (
            <span
              key={c.id}
              className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded text-[10px] font-mono font-semibold bg-emerald-950/80 text-emerald-300 border border-emerald-600/60 shadow-sm hover:bg-emerald-900 transition-colors cursor-help"
              title={`${c.name}: ${c.detail} (Requerido: ${c.target})`}
            >
              <span className="text-[10px]">✅</span>
              <span>{c.short_name || c.name}:</span>
              <span className="font-bold">{c.value}</span>
            </span>
          );
        }

        return (
          <span
            key={c.id}
            className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded text-[10px] font-mono font-medium bg-rose-950/60 text-rose-300/90 border border-rose-800/50 shadow-sm hover:bg-rose-950 transition-colors cursor-help"
            title={`${c.name}: ${c.detail} (Requerido: ${c.target})`}
          >
            <span className="text-[10px]">❌</span>
            <span>{c.short_name || c.name}:</span>
            <span>{c.value}</span>
          </span>
        );
      })}
    </div>
  );
}

function StatusDisplay({ botsRunning, onStart, onShutdown, onStatusUpdate, onSelectSymbolForChart }) {
  // Intentar cargar el estado inicial desde localStorage, asegurando que sea un array válido
  const [statuses, setStatuses] = useState(() => {
    const cachedData = localStorage.getItem(STATUS_CACHE_KEY);
    let parsedData = [];
    if (cachedData) {
        try {
          const rawParsed = JSON.parse(cachedData);
          // Asegurarse de que sea un array y filtrar elementos no válidos/null
          if (Array.isArray(rawParsed)) {
              parsedData = rawParsed.filter(item => item !== null && typeof item === 'object');
          } else {
               console.warn("Cached status data was not an array:", rawParsed);
          }
        } catch (e) {
          console.error("Error parsing cached status data:", e);
          // Si hay error de parseo, localStorage se limpiará en el próximo guardado exitoso
        }
    }
    return parsedData; // Devuelve un array vacío o el array filtrado
  });
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState(null);
  const [startError, setStartError] = useState(null); // <-- NUEVO ESTADO PARA ERRORES DE INICIO
  // --- NUEVO ESTADO PARA FILAS EXPANDIDAS E HISTORIAL ---
  const [expandedRows, setExpandedRows] = useState({}); // { symbol: boolean }
  const [tradeHistories, setTradeHistories] = useState({}); // { symbol: [trade] }
  const [loadingHistories, setLoadingHistories] = useState({}); // { symbol: boolean }
  const [historyErrors, setHistoryErrors] = useState({}); // { symbol: string | null }
  // --- LÍMITE DE TRADES PERSONALIZADO POR MONEDA ---
  const [coinTradeLimits, setCoinTradeLimits] = useState({}); // { symbol: number }
  const expandedRowsRef = useRef({});
  const coinTradeLimitsRef = useRef({});
  const fetchTradeHistoryRef = useRef();
  expandedRowsRef.current = expandedRows;
  coinTradeLimitsRef.current = coinTradeLimits;
  const [closingSymbols, setClosingSymbols] = useState({}); // { symbol: boolean }
  const [pausingSymbols, setPausingSymbols] = useState({}); // { symbol: boolean }
  const initialCacheHydratedRef = useRef(false);

  // --- ORDENAMIENTO INTERACTIVO ESTILO BINANCE ---
  const [statusSort, setStatusSort] = useState({ key: 'symbol', direction: 'asc' });

  const handleStatusSort = (key) => {
    setStatusSort(prev => {
      if (prev.key === key) {
        return { key, direction: prev.direction === 'asc' ? 'desc' : 'asc' };
      }
      const defaultAscKeys = ['symbol', 'state', 'last_error'];
      return { key, direction: defaultAscKeys.includes(key) ? 'asc' : 'desc' };
    });
  };

  const statusExtractors = useMemo(() => ({
    symbol: s => s.symbol || '',
    strategy_name: s => s.strategy_name || '',
    state: s => s.is_paused ? 'Paused' : (s.state || ''),
    margin: s => s.in_position ? (Number(s.margin_usdt) || ((Number(s.position_value_usdt) || 50) / (Number(s.leverage) || 20))) : 0,
    price_tracking: s => s.in_position ? (s.price_change_pct || 0) : (parseFloat(s.current_price) || 0),
    current_pnl: s => s.in_position ? (parseFloat(s.current_pnl) || 0) : -9999999,
    historical_pnl: s => parseFloat(s.historical_pnl) || 0,
    diagnostics: s => s.in_position ? (s.position_diagnostics?.tp_progress_pct || 0) : (s.entry_diagnostics?.passed_count || 0),
    last_error: s => s.last_error || ''
  }), []);

  const sortedStatuses = useMemo(() => {
    return sortTableData(statuses, statusSort, statusExtractors);
  }, [statuses, statusSort, statusExtractors]);

  // Ordenamiento para trades del acordeón por símbolo
  const [subTradeSorts, setSubTradeSorts] = useState({}); // { [symbol]: { key, direction } }

  const handleSubTradeSort = (symbol, key) => {
    setSubTradeSorts(prev => {
      const cur = prev[symbol] || { key: 'close_timestamp', direction: 'desc' };
      if (cur.key === key) {
        return { ...prev, [symbol]: { key, direction: cur.direction === 'asc' ? 'desc' : 'asc' } };
      }
      const defaultAscKeys = ['close_timestamp', 'close_reason', 'id'];
      return { ...prev, [symbol]: { key, direction: defaultAscKeys.includes(key) ? 'asc' : 'desc' } };
    });
  };

  // Helper para comisiones Binance por trade
  const getTradeCommission = (t) => {
    const c = parseFloat(t.commission_usdt);
    if (!isNaN(c) && c > 0.00001) return c;
    const op = parseFloat(t.open_price) || 0;
    const cp = parseFloat(t.close_price) || op;
    const qty = parseFloat(t.quantity) || 0;
    const notional = (op > 0 && qty > 0) ? (op * qty) : (parseFloat(t.position_size_usdt) || 1500);
    const exitNotional = (cp > 0 && qty > 0) ? (cp * qty) : notional;
    return Number(((notional * 0.0002) + (exitNotional * 0.0005)).toFixed(4));
  };

  // Helper para PnL Bruto de mercado por trade
  const getTradeGrossPnL = (t) => {
    const g = parseFloat(t.gross_pnl_usdt);
    if (!isNaN(g) && g !== 0) return g;
    const net = parseFloat(t.pnl_usdt) || 0;
    const comm = getTradeCommission(t);
    return Number((net + comm).toFixed(4));
  };

  const sortedSubTrades = useMemo(() => {
    const map = {};
    for (const sym of Object.keys(tradeHistories)) {
      const list = tradeHistories[sym] || [];
      const sortConfig = subTradeSorts[sym] || { key: 'close_timestamp', direction: 'desc' };
      map[sym] = sortTableData(list, sortConfig, {
        close_timestamp: t => t.close_timestamp || '',
        close_reason: t => t.close_reason || '',
        trade_type: t => t.trade_type || '',
        open_price: t => t.open_price || 0,
        close_price: t => t.close_price || 0,
        quantity: t => t.quantity || 0,
        pnl_usdt: t => parseFloat(t.pnl_usdt) || 0,
        commission_usdt: t => getTradeCommission(t),
        gross_pnl_usdt: t => getTradeGrossPnL(t),
        id: t => t.id || ''
      });
    }
    return map;
  }, [tradeHistories, subTradeSorts]);

  const handleTogglePause = async (e, symbol) => {
    e.stopPropagation();
    setPausingSymbols(prev => ({ ...prev, [symbol]: true }));
    try {
      const resp = await fetch(`/api/bot/${symbol}/toggle_pause`, { method: 'POST' });
      const data = await resp.json();
      if (resp.ok) {
        setStatuses(prev => prev.map(s => s.symbol === symbol ? {
          ...s,
          is_paused: data.is_paused,
          state: data.is_paused ? (s.in_position ? s.state : 'Paused') : (s.state === 'Paused' ? 'Idle (Waiting Cycle)' : s.state)
        } : s));
      } else {
        alert(`Error al cambiar estado de ${symbol}: ${data.error || 'Error desconocido'}`);
      }
    } catch (err) {
      alert(`Error de red al pausar/reanudar ${symbol}: ${err.message}`);
    } finally {
      setPausingSymbols(prev => ({ ...prev, [symbol]: false }));
    }
  };

  const handleCloseSinglePosition = async (e, symbol, side = null) => {
    e.stopPropagation();
    const sideLabel = side ? ` (${side})` : '';
    if (!window.confirm(`¿Cerrar posición${sideLabel} de ${symbol} a precio de mercado en Binance?`)) return;
    
    const key = side ? `${symbol}_${side}` : symbol;
    setClosingSymbols(prev => ({ ...prev, [key]: true, [symbol]: true }));
    try {
      const resp = await fetch(`/api/close_position/${symbol}${side ? `?side=${side}` : ''}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ side: side || undefined })
      });
      const data = await resp.json();
      if (resp.ok) {
        // Refrescar inmediatamente
        const statusResp = await fetch('/api/status');
        if (statusResp.ok) {
          const statusData = await statusResp.json();
          if (statusData && Array.isArray(statusData.statuses)) {
            setStatuses(statusData.statuses);
          }
        }
      } else {
        alert(`Error al cerrar ${symbol}${sideLabel}: ${data.error || 'Error desconocido'}`);
      }
    } catch (err) {
      alert(`Error de red al cerrar ${symbol}${sideLabel}: ${err.message}`);
    } finally {
      setClosingSymbols(prev => ({ ...prev, [key]: false, [symbol]: false }));
    }
  };
  // ------------------------------------------------------

  // Modificamos onStart para que pueda manejar el error
  const handleStart = async () => {
    setStartError(null); // Limpiar error anterior al intentar iniciar de nuevo
    const result = await onStart();
    if (result && result.error) {
      setStartError(result.error);
    }
  };

  useEffect(() => {
    const fetchData = async () => {
      try {
        const response = await fetch('/api/status');
        if (!response.ok) {
          // Si la respuesta no es OK, lanzar un error para ir al catch
          // Podríamos intentar leer un mensaje de error específico si la API lo envía
          let errorMsg = `HTTP error! status: ${response.status}`;
          try {
             const errData = await response.json();
             errorMsg = errData.error || errorMsg;
          } catch (jsonError) { /* Ignorar si el cuerpo del error no es JSON */ }
          throw new Error(errorMsg); 
        }
        const data = await response.json(); // data ahora es { bots_running: ..., statuses: [...], session_stats: {...} }
        
        // --- EXTRAER el array 'statuses' de la respuesta --- 
        if (data && Array.isArray(data.statuses)) {
            // --- NUEVO: Ordenar los statuses ---
            const sortedStatuses = [...data.statuses].sort((a, b) => { // Usar spread para no mutar el original si se usa en otro lado
              // Si 'a' está en posición y 'b' no, 'a' va primero.
              if (a.in_position && !b.in_position) {
                return -1;
              }
              // Si 'b' está en posición y 'a' no, 'b' va primero.
              if (!a.in_position && b.in_position) {
                return 1;
              }
              // Si ambos están o no están en posición, ordenar alfabéticamente por símbolo.
              if (a.symbol < b.symbol) {
                return -1;
              }
              if (a.symbol > b.symbol) {
                return 1;
              }
              return 0;
            });
            // --- FIN NUEVO ORDENAMIENTO ---

            setStatuses(sortedStatuses); // Guardar el array ORDENADO
            // --- LLAMAR A onStatusUpdate CON LOS DATOS ACTUALIZADOS (ahora usa sortedStatuses) ---
                // CALCULO DE PNL TOTAL (Histórico cerrado + Flotante no realizado actual)
                const totalHistoricalPnl = sortedStatuses.reduce((acc, status) => {
                    const pnlValue = parseFloat(status.historical_pnl);
                    return !isNaN(pnlValue) ? acc + pnlValue : acc;
                }, 0);

                const totalCurrentUnrealizedPnl = sortedStatuses.reduce((acc, status) => {
                    if (status.in_position) {
                        const pnlValue = parseFloat(status.current_pnl);
                        return !isNaN(pnlValue) ? acc + pnlValue : acc;
                    }
                    return acc;
                }, 0);

                // Monedas en posición
                const coinsInPos = sortedStatuses.filter(s => s.in_position).length;

                // Fuente autorizada de la base de datos completa (no solo de los 6 pares activos)
                const authoritativeTotalPnl = (data?.global_db_metrics && data.global_db_metrics.total_pnl !== undefined)
                    ? parseFloat(data.global_db_metrics.total_pnl)
                    : totalHistoricalPnl;

                const authoritativeUnrealizedPnl = (data?.total_unrealized_pnl !== undefined)
                    ? parseFloat(data.total_unrealized_pnl)
                    : totalCurrentUnrealizedPnl;

                const bal = (data?.account_balance !== undefined && data?.account_balance !== null) ? parseFloat(data.account_balance) : 5000;
                const initCap = (data?.initial_capital !== undefined && data?.initial_capital !== null) ? parseFloat(data.initial_capital) : 5000;
                const wPnl = (data?.wallet_pnl !== undefined && data?.wallet_pnl !== null) ? parseFloat(data.wallet_pnl) : (bal - initCap);

                onStatusUpdate({ 
                    totalPnl: authoritativeTotalPnl, 
                    historicalPnl: authoritativeTotalPnl,
                    unrealizedPnl: authoritativeUnrealizedPnl,
                    coinCount: sortedStatuses.length,
                    coinsInPosition: coinsInPos,
                    poolBalance: bal,
                    initialCapital: initCap,
                    walletPnl: wPnl,
                    sessionStats: data.session_stats,
                    globalDbMetrics: data.global_db_metrics,
                    bots_running: data.bots_running
                });
                initialCacheHydratedRef.current = true;
            // ---------------------------------------------------------
             // Guardar los datos exitosos en localStorage (el array ORDENADO de statuses)
            try {
                localStorage.setItem(STATUS_CACHE_KEY, JSON.stringify(sortedStatuses));
            } catch (e) {
                console.error("Error saving status to localStorage:", e);
            }

            // Auto-actualizar en vivo los historiales de trades para las monedas actualmente expandidas
            const expandedSymbols = Object.keys(expandedRowsRef.current || {}).filter(sym => expandedRowsRef.current[sym]);
            if (expandedSymbols.length > 0 && fetchTradeHistoryRef.current) {
              expandedSymbols.forEach(sym => {
                const limit = coinTradeLimitsRef.current[sym] || 20;
                fetchTradeHistoryRef.current(sym, limit, true);
              });
            }
        } else {
             console.warn("La respuesta de /api/status no contenía un array 'statuses' válido:", data);
             // Mantener el estado anterior si ya teníamos algo es más seguro.
             if (statuses.length === 0) {
                 setStatuses([]); // Limpiar solo si no teníamos nada antes
             }
        }
        // -----------------------------------------------------
        setError(null); // Limpiar cualquier error anterior
        
      } catch (e) {
        // Error al hacer fetch (ej: red, API apagada)
        console.error("Error fetching bot status:", e);
        // Establecer mensaje de error específico sin borrar los datos
        setError("Bot apagado o API no disponible. Mostrando últimos datos conocidos.");
      } finally {
        setIsLoading(false);
      }
    };

    fetchData(); // Llamar una vez al montar
    const intervalId = setInterval(fetchData, 4000); // Refrescar cada 4s
    window.addEventListener('bot-status-refresh', fetchData);
    return () => {
      clearInterval(intervalId);
      window.removeEventListener('bot-status-refresh', fetchData);
    };
  }, []);

  // --- FUNCIÓN PARA CARGAR HISTORIAL DE TRADES (AUTO-ACTUALIZABLE POR MONEDA) ---
  const fetchTradeHistory = async (symbol, customLimit = null, silent = false) => {
    if (!silent && loadingHistories[symbol]) return;

    const limit = customLimit !== null ? customLimit : (coinTradeLimitsRef.current[symbol] ?? 20);
    if (!silent) {
      setLoadingHistories(prev => ({ ...prev, [symbol]: true }));
    }
    setHistoryErrors(prev => ({ ...prev, [symbol]: null }));

    try {
      const response = await fetch(`/api/trades/${symbol}?limit=${limit}`);
      if (!response.ok) {
        const errData = await response.json();
        throw new Error(errData.error || `HTTP error! Status: ${response.status}`);
      }
      const historyData = await response.json();
      setTradeHistories(prev => ({ ...prev, [symbol]: historyData }));
    } catch (err) {
      console.error(`Error fetching trade history for ${symbol}:`, err);
      if (!silent) {
        setHistoryErrors(prev => ({ ...prev, [symbol]: `Error: ${err.message}` }));
        setTradeHistories(prev => ({ ...prev, [symbol]: [] }));
      }
    } finally {
      if (!silent) {
        setLoadingHistories(prev => ({ ...prev, [symbol]: false }));
      }
    }
  };

  fetchTradeHistoryRef.current = fetchTradeHistory;

  const handleCoinTradeLimitChange = (symbol, valStr) => {
    setCoinTradeLimits(prev => ({ ...prev, [symbol]: valStr }));
    const parsed = parseInt(valStr, 10);
    if (!isNaN(parsed) && parsed > 0) {
      fetchTradeHistory(symbol, parsed, false);
    }
  };

  const handleCoinTradeLimitBlur = (symbol) => {
    const currentVal = coinTradeLimits[symbol];
    const parsed = parseInt(currentVal, 10);
    if (isNaN(parsed) || parsed <= 0) {
      setCoinTradeLimits(prev => ({ ...prev, [symbol]: 20 }));
      fetchTradeHistory(symbol, 20, false);
    }
  };

  // --- FUNCIÓN PARA EXPANDIR/COLAPSAR FILA ---
  const toggleRow = (symbol) => {
    const isCurrentlyExpanded = expandedRows[symbol];
    setExpandedRows(prev => ({ ...prev, [symbol]: !isCurrentlyExpanded }));

    // Si se está expandiendo, cargar historial con el límite actual de la moneda
    if (!isCurrentlyExpanded) {
       const limit = coinTradeLimits[symbol] ?? 20;
       fetchTradeHistory(symbol, limit, false);
    }
  };

  // --- MANEJADOR PARA VACIAR HISTORIAL Y PNL ---
  const handleResetTradesClick = async () => {
    if (!window.confirm("⚠️ ¿Deseas reiniciar el historial de trades y poner el PnL a 0.00 USDT?")) return;
    try {
      const res = await fetch('/api/trades/reset', { method: 'POST' });
      if (res.ok) {
        setTradeHistories({});
        setStatuses([]);
        localStorage.removeItem(STATUS_CACHE_KEY);
        if (onStatusUpdate) {
          onStatusUpdate({ totalPnl: 0, coinCount: 0, coinsInPosition: 0 });
        }
        alert("✅ Historial de trades reiniciado con éxito. La página se recargará.");
        setTimeout(() => window.location.reload(), 1000);
      } else {
        alert("Error al reiniciar trades.");
      }
    } catch (e) {
      alert(`Error: ${e.message}`);
    }
  };
  // -------------------------------------------------

  // statusArray ya no es necesario, statuses es el array directamente
  // const statusArray = Object.values(statuses);

  // --- TOTALES CONSOLIDADOS PARA LA TABLA Y CABECERA ---
  const totalCumulativePnl = statuses.reduce((acc, status) => {
    const pnlValue = parseFloat(status.historical_pnl);
    return !isNaN(pnlValue) ? acc + pnlValue : acc;
  }, 0);

  const totalMarginCommitted = statuses.reduce((acc, status) => {
    if (status.in_position) {
      const val = Number(status.margin_usdt) || ((Number(status.position_value_usdt) || 50) / (Number(status.leverage) || 20));
      return !isNaN(val) ? acc + val : acc;
    }
    return acc;
  }, 0);

  const totalCurrentUnrealizedPnl = statuses.reduce((acc, status) => {
    if (status.in_position) {
      const val = parseFloat(status.current_pnl);
      return !isNaN(val) ? acc + val : acc;
    }
    return acc;
  }, 0);
  // -----------------------------------------------------

  // --- HIDRATAR onStatusUpdate UNA SOLA VEZ CON LA CACHÉ LOCAL AL MONTAR ---
  useEffect(() => {
    if (onStatusUpdate && !initialCacheHydratedRef.current && statuses.length > 0) {
      const coinsInPos = statuses.filter(s => s.in_position).length;
      onStatusUpdate({ 
        totalPnl: totalCumulativePnl, 
        historicalPnl: totalCumulativePnl,
        unrealizedPnl: totalCurrentUnrealizedPnl,
        coinCount: statuses.length,
        coinsInPosition: coinsInPos
      });
    }
  }, []); // Solo al montar una vez para hidratación inicial
  // -------------------------------------------------------------------------

  return (
    <div className="bg-slate-900 border border-slate-700/80 shadow-xl rounded-2xl p-6 mt-6">
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 mb-4">
        <div>
          <h2 className="text-xl font-black text-white tracking-wide flex items-center gap-2">
            <span>⚡</span>
            <span>Estado y Monitoreo de Bots en Tiempo Real</span>
          </h2>
          <p className="text-xs text-slate-300 mt-0.5">
            Supervisa las posiciones abiertas, margen comprometido, órdenes activas y PnL acumulado por moneda.
          </p>
        </div>
        <div className="flex items-center gap-2 flex-shrink-0">
          <button
            onClick={handleResetTradesClick}
            className="text-xs font-bold px-3 py-1.5 rounded-xl bg-red-950/70 hover:bg-red-900 text-red-200 border border-red-700/60 transition-colors flex items-center gap-1.5 shadow-sm"
            title="Borra el registro de trades pasados de la base de datos y reinicia el PnL a 0.00"
          >
            <span>🗑️</span>
            <span>Vaciar Historial de Trades & PnL</span>
          </button>
        </div>
      </div>
      
      {/* Mostrar el mensaje de error de inicio */}
      {startError && (
        <div className="my-4 p-3 bg-red-950/80 border border-red-500/80 text-red-200 rounded-xl">
          <p className="font-bold">Error al iniciar los bots:</p>
          <p className="text-xs font-mono">{startError}</p>
        </div>
      )}

      {/* Mostrar el mensaje de error de conexión/API */}
      {error && (
        <div className="my-3 p-3 bg-amber-950/70 border border-amber-500/70 rounded-xl text-amber-200 text-xs font-semibold">
          ⚠️ {error}
        </div>
      )}

      <div className="overflow-x-auto">
        <table className="min-w-full divide-y divide-slate-700">
          <thead className="bg-slate-950 border-b-2 border-slate-700">
            <tr>
              <th scope="col" className="px-2 py-3 text-left text-xs font-extrabold text-slate-100 uppercase tracking-wider w-10"></th>
              <BinanceSortHeader label="Symbol" sortKey="symbol" currentSort={statusSort} onSort={handleStatusSort} />
              <BinanceSortHeader label="Estrategia" sortKey="strategy_name" currentSort={statusSort} onSort={handleStatusSort} className="max-w-[170px]" />
              <BinanceSortHeader label="Estado" sortKey="state" currentSort={statusSort} onSort={handleStatusSort} />
              <BinanceSortHeader label="Posición & Margen" sortKey="margin" currentSort={statusSort} onSort={handleStatusSort} />
              <BinanceSortHeader label="Precios & Recorrido" sortKey="price_tracking" currentSort={statusSort} onSort={handleStatusSort} tooltipInfo={{ title: "Precios & Recorrido", desc: "Precio de entrada vs actual, % rendimiento acumulado y retroceso desde el pico más alto (o suelo)." }} />
              <BinanceSortHeader label="Current PnL" sortKey="current_pnl" currentSort={statusSort} onSort={handleStatusSort} />
              <BinanceSortHeader label="Hist. PnL" sortKey="historical_pnl" currentSort={statusSort} onSort={handleStatusSort} />
              <BinanceSortHeader label="Radar & Diagnóstico en Vivo" sortKey="diagnostics" currentSort={statusSort} onSort={handleStatusSort} className="min-w-[280px]" />
              <BinanceSortHeader label="Last Error" sortKey="last_error" currentSort={statusSort} onSort={handleStatusSort} />
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-800">
            {sortedStatuses.length > 0 ? (
              sortedStatuses.map((status) => (
                <React.Fragment key={status.symbol}>
                  <tr 
                    className={`transition-colors duration-150 cursor-pointer ${
                      status.in_position 
                        ? 'bg-emerald-950/20 hover:bg-emerald-950/40 border-l-4 border-l-emerald-500' 
                        : 'hover:bg-slate-800/60'
                    }`}
                    onClick={() => toggleRow(status.symbol)}
                  >
                    {/* --- CELDA CON BOTÓN DE EXPANDIR --- */}
                    <td className="px-2 py-3 whitespace-nowrap text-sm text-slate-300">
                      <button 
                        className="p-1 rounded text-slate-300 hover:text-white hover:bg-slate-800 focus:outline-none"
                        aria-expanded={!!expandedRows[status.symbol]}
                        aria-controls={`history-${status.symbol}`}
                      >
                        {expandedRows[status.symbol] ? '▼' : '▶'}
                      </button>
                    </td>
                    {/* --- Símbolo con botones de cierre y badges de dirección --- */}
                    <td className="px-3 py-3 whitespace-nowrap text-sm font-bold text-white">
                      <div className="flex items-center space-x-2">
                        {status.in_position && (() => {
                          const activeSubPositions = (status.positions || []).filter(p => p.in_position);
                          if (activeSubPositions.length > 1) {
                            return (
                              <div className="flex items-center gap-1">
                                {activeSubPositions.map(sp => {
                                  const isShort = sp.trade_side === 'SHORT';
                                  const key = `${status.symbol}_${sp.trade_side}`;
                                  const isClosing = closingSymbols[key] || closingSymbols[status.symbol];
                                  return (
                                    <button
                                      key={sp.trade_side}
                                      onClick={(e) => handleCloseSinglePosition(e, status.symbol, sp.trade_side)}
                                      disabled={isClosing}
                                      className={`px-1.5 py-0.5 flex-shrink-0 flex items-center justify-center text-[10px] font-extrabold text-white rounded shadow transition-transform transform active:scale-95 disabled:bg-gray-600 ${
                                        isShort ? 'bg-rose-700 hover:bg-rose-800' : 'bg-emerald-700 hover:bg-emerald-800'
                                      }`}
                                      title={`Cerrar posición ${sp.trade_side} de ${status.symbol} a mercado`}
                                    >
                                      {isClosing ? '..' : `✕ ${isShort ? 'S' : 'L'}`}
                                    </button>
                                  );
                                })}
                              </div>
                            );
                          }
                          const singleSide = activeSubPositions[0]?.trade_side || status.trade_side || null;
                          const isShort = singleSide === 'SHORT';
                          const key = singleSide ? `${status.symbol}_${singleSide}` : status.symbol;
                          const isClosing = closingSymbols[key] || closingSymbols[status.symbol];
                          return (
                            <button
                              onClick={(e) => handleCloseSinglePosition(e, status.symbol, singleSide)}
                              disabled={isClosing}
                              className={`w-5 h-5 flex-shrink-0 flex items-center justify-center text-xs font-extrabold text-white rounded-full shadow transition-transform transform active:scale-95 disabled:bg-gray-600 ${
                                isShort ? 'bg-rose-600 hover:bg-rose-700' : 'bg-red-600 hover:bg-red-700'
                              }`}
                              title={`Cerrar posición ${singleSide || ''} de ${status.symbol} a mercado en Binance`}
                            >
                              {isClosing ? '..' : '✕'}
                            </button>
                          );
                        })()}
                        <div className="flex flex-col">
                          <div className="flex items-center gap-1.5">
                            <span className="font-mono text-sm">{status.symbol}</span>
                            <button
                              type="button"
                              onClick={(e) => {
                                e.stopPropagation();
                                if (onSelectSymbolForChart) onSelectSymbolForChart(status.symbol);
                              }}
                              className="px-1.5 py-0.5 text-[11px] bg-amber-500/20 hover:bg-amber-500/30 text-amber-300 border border-amber-500/40 rounded transition shadow-sm font-bold"
                              title={`Ver gráfico en vivo de ${status.symbol}`}
                            >
                              📊
                            </button>
                          </div>
                          {/* Badge de Modalidad Operativa */}
                          <div className="mt-0.5">
                            {(!status.trade_direction || status.trade_direction === 'BIDIRECTIONAL') ? (
                              <span className="text-[9px] px-1 py-0.2 rounded font-mono font-bold bg-purple-950/80 text-purple-300 border border-purple-500/40" title="Modo Cobertura Bidireccional (LONG y SHORT simultáneos)">
                                🔄 BIDI
                              </span>
                            ) : status.trade_direction === 'SHORT' ? (
                              <span className="text-[9px] px-1 py-0.2 rounded font-mono font-bold bg-rose-950/80 text-rose-300 border border-rose-500/40" title="Operando exclusivamente en SHORT">
                                🔴 SHORT
                              </span>
                            ) : (
                              <span className="text-[9px] px-1 py-0.2 rounded font-mono font-bold bg-emerald-950/80 text-emerald-300 border border-emerald-500/40" title="Operando exclusivamente en LONG">
                                🟢 LONG
                              </span>
                            )}
                          </div>
                        </div>
                      </div>
                    </td>

                    {/* --- ESTRATEGIA ASIGNADA --- */}
                    <td className="px-3 py-3 whitespace-nowrap text-xs max-w-[170px]">
                      {(() => {
                        const rawStrat = status.strategy_name && status.strategy_name.toLowerCase() !== 'global' ? status.strategy_name : 'v3_RSI-SNIPER-MOMENTUM_v3';
                        const shortStrat = rawStrat.length > 20 ? `${rawStrat.slice(0, 20)}…` : rawStrat;
                        return (
                          <span 
                            className="inline-flex items-center px-2 py-0.5 rounded-lg text-[11px] font-mono font-bold bg-indigo-950/80 text-indigo-300 border border-indigo-700/60 shadow-sm truncate max-w-full cursor-help" 
                            title={`Estrategia completa: ${rawStrat}`}
                          >
                            {shortStrat}
                          </span>
                        );
                      })()}
                    </td>

                    {/* --- ESTADO --- */}
                    <td className="px-3 py-3 whitespace-nowrap text-xs">
                      <div className="flex flex-col gap-1">
                        <button
                          type="button"
                          onClick={(e) => {
                            e.stopPropagation();
                            handleTogglePause(e, status.symbol);
                          }}
                          disabled={pausingSymbols[status.symbol]}
                          title={status.is_paused ? `Pausado: ${status.pause_reason || 'Pausa manual'}. Clic para reactivar.` : 'Bot activo. Clic para pausar.'}
                          className={`px-2.5 py-0.5 inline-flex items-center justify-center text-xs leading-5 font-bold rounded-full border transition-all active:scale-95 cursor-pointer ${
                            status.state === 'IN_POSITION' ? 'bg-emerald-950/80 text-emerald-200 border-emerald-500/50' :
                            status.pause_reason?.includes('Hard Stop') ? 'bg-red-950/90 text-red-200 border-red-500/60 hover:bg-red-900 shadow-sm shadow-red-900/40' :
                            status.cooldown_remaining_seconds > 0 ? 'bg-amber-950/90 text-amber-200 border-amber-500/60 hover:bg-amber-900 shadow-sm shadow-amber-900/40' :
                            status.pause_reason?.includes('Escudo BTC') ? 'bg-sky-950/90 text-sky-200 border-sky-500/60 hover:bg-sky-900 shadow-sm shadow-sky-900/40' :
                            status.state === 'Paused' || status.is_paused ? 'bg-amber-950/80 text-amber-200 border-amber-500/50 hover:bg-amber-900' :
                            status.state === 'ERROR' ? 'bg-red-950/80 text-red-200 border-red-500/50' :
                            status.state?.includes('WAITING') ? 'bg-indigo-950/80 text-indigo-200 border-indigo-500/50' :
                            status.state === 'Inactive' ? 'bg-slate-800 text-slate-300 border-slate-700' :
                            'bg-slate-800 text-slate-200 border-slate-700 hover:bg-slate-750'
                        }`}>
                          {pausingSymbols[status.symbol] ? '⏳ ...' : (
                            status.is_paused && status.state !== 'IN_POSITION' ? (
                              status.pause_reason?.includes('Hard Stop') ? '🛑 Hard Stop' :
                              status.cooldown_remaining_seconds > 0 ? `⏳ Cooldown (${Math.ceil(status.cooldown_remaining_seconds / 60)}m)` :
                              status.pause_reason?.includes('Escudo BTC') ? '🛡️ Escudo BTC' :
                              '⏸️ Pausado'
                            ) : (status.state || 'N/A')
                          )}
                        </button>
                        {/* Chips de órdenes pendientes (soporta sub-posiciones LONG/SHORT) */}
                        {(() => {
                          const orderChips = [];
                          const botsToCheck = (status.positions && status.positions.length > 0) ? status.positions : [status];
                          botsToCheck.forEach((sp, idx) => {
                            const sideTag = sp.trade_side ? ` (${sp.trade_side[0]})` : '';
                            if (sp.pending_entry_order_id) {
                              orderChips.push(
                                <span key={`entry-${idx}`} className="inline-flex items-center gap-1 text-[10px] font-mono font-bold px-1.5 py-0.5 rounded bg-amber-950/90 text-amber-300 border border-amber-500/60 shadow-sm" title={`Orden de entrada pendiente${sideTag} ID: ${sp.pending_entry_order_id}`}>
                                  ⏳ Entrada{sideTag} #{String(sp.pending_entry_order_id).slice(-4)}
                                </span>
                              );
                            }
                            if (sp.pending_exit_order_id) {
                              orderChips.push(
                                <span key={`exit-${idx}`} className="inline-flex items-center gap-1 text-[10px] font-mono font-bold px-1.5 py-0.5 rounded bg-rose-950/90 text-rose-300 border border-rose-500/60 shadow-sm" title={`Orden de salida pendiente${sideTag} ID: ${sp.pending_exit_order_id}`}>
                                  ⏳ Cierre{sideTag} #{String(sp.pending_exit_order_id).slice(-4)}
                                </span>
                              );
                            }
                            if (sp.pending_tp_order_id) {
                              orderChips.push(
                                <span key={`tp-${idx}`} className="inline-flex items-center gap-1 text-[10px] font-mono font-bold px-1.5 py-0.5 rounded bg-emerald-950/90 text-emerald-300 border border-emerald-500/60 shadow-sm" title={`TP activo${sideTag} ID: ${sp.pending_tp_order_id}`}>
                                  🎯 TP{sideTag} #{String(sp.pending_tp_order_id).slice(-4)}
                                </span>
                              );
                            }
                            if (sp.pending_sl_order_id) {
                              orderChips.push(
                                <span key={`sl-${idx}`} className="inline-flex items-center gap-1 text-[10px] font-mono font-bold px-1.5 py-0.5 rounded bg-red-950/90 text-red-300 border border-red-500/60 shadow-sm" title={`SL activo${sideTag} ID: ${sp.pending_sl_order_id}`}>
                                  🛑 SL{sideTag} #{String(sp.pending_sl_order_id).slice(-4)}
                                </span>
                              );
                            }
                          });
                          return orderChips;
                        })()}
                      </div>
                    </td>

                    {/* --- POSICIÓN & MARGEN --- */}
                    <td className="px-3 py-3 whitespace-nowrap text-xs">
                      {status?.in_position ? (() => {
                        const activeSubPositions = (status.positions || []).filter(p => p.in_position);
                        const positionsToRender = activeSubPositions.length > 0 ? activeSubPositions : [status];
                        return (
                          <div className="flex flex-col space-y-1.5">
                            {positionsToRender.map((pos, pIdx) => {
                              const side = pos.trade_side || (positionsToRender.length === 1 ? status.trade_side : null);
                              const isShort = side === 'SHORT';
                              const posVal = Number(pos.position_value_usdt) || Math.abs((Number(pos.entry_price) || 0) * (Number(pos.position_size) || 0));
                              const marginVal = Number(pos.margin_usdt) || (posVal / (Number(pos.leverage) || 20));
                              return (
                                <div key={pIdx} className={`p-1.5 rounded border ${isShort ? 'bg-rose-950/20 border-rose-600/30' : 'bg-emerald-950/20 border-emerald-600/30'}`}>
                                  <div className="flex items-center gap-1.5">
                                    <span className={`px-1 py-0.2 rounded text-[9px] font-bold font-mono ${isShort ? 'bg-rose-950 text-rose-300 border border-rose-600/50' : 'bg-emerald-950 text-emerald-300 border border-emerald-600/50'}`}>
                                      {isShort ? '🔴 SHORT' : '🟢 LONG'}
                                    </span>
                                    <span className="font-extrabold text-white font-mono text-xs">
                                      ${posVal.toFixed(2)} USDT
                                    </span>
                                    <span className="text-[10px] text-slate-300 font-mono">
                                      ({pos.position_size || 0} {String(status.symbol || '').replace('USDT', '')})
                                    </span>
                                  </div>
                                  <div className="flex items-center gap-1.5 mt-0.5">
                                    <span className="text-[11px] font-bold text-slate-300 font-mono">
                                      Margen: ~${marginVal.toFixed(2)} USDT
                                    </span>
                                    <span className="text-[10px] px-1 py-0.2 rounded bg-slate-800 text-amber-300 font-bold border border-slate-700 font-mono">
                                      {pos.leverage || status.leverage || 20}x
                                    </span>
                                  </div>
                                </div>
                              );
                            })}
                          </div>
                        );
                      })() : (
                        <span className="text-slate-400 text-xs italic">
                          Sin posición
                        </span>
                      )}
                    </td>

                    {/* --- PRECIOS & RECORRIDO (PICO & DRAWDOWN) --- */}
                    <td className="px-3 py-3 whitespace-nowrap text-xs">
                      {status?.in_position ? (() => {
                        const activeSubPositions = (status.positions || []).filter(p => p.in_position);
                        const positionsToRender = activeSubPositions.length > 0 ? activeSubPositions : [status];
                        return (
                          <div className="flex flex-col space-y-1.5 min-w-[220px]">
                            {positionsToRender.map((pos, pIdx) => {
                              const side = pos.trade_side || (positionsToRender.length === 1 ? status.trade_side : 'LONG');
                              const isShort = side === 'SHORT';
                              const entryPrice = parseFloat(pos.entry_price) || 0;
                              let currentPrice = parseFloat(pos.current_price || status.current_price) || 0;
                              
                              // Fallback dinámico inteligente: si currentPrice no viene o es igual a entryPrice con PnL no nulo
                              if (entryPrice > 0 && (currentPrice === 0 || (currentPrice === entryPrice && Math.abs(parseFloat(pos.current_pnl ?? status.current_pnl ?? 0)) > 0.0001))) {
                                const pnlVal = parseFloat(pos.current_pnl !== undefined ? pos.current_pnl : (status.current_pnl || 0)) || 0;
                                const qty = Math.abs(parseFloat(pos.position_size || status.position_size || 0));
                                if (qty > 0) {
                                  currentPrice = isShort ? (entryPrice - (pnlVal / qty)) : (entryPrice + (pnlVal / qty));
                                } else {
                                  currentPrice = entryPrice;
                                }
                              } else if (currentPrice === 0) {
                                currentPrice = entryPrice;
                              }

                              const precision = currentPrice < 1 ? 4 : (currentPrice < 10 ? 3 : 2);
                              
                              let changePct = pos.price_change_pct;
                              if (changePct === undefined || changePct === null || (Number(changePct) === 0 && Math.abs(parseFloat(pos.current_pnl ?? status.current_pnl ?? 0)) > 0.001)) {
                                if (entryPrice > 0 && currentPrice > 0) {
                                  changePct = isShort
                                    ? ((entryPrice - currentPrice) / entryPrice) * 100
                                    : ((currentPrice - entryPrice) / entryPrice) * 100;
                                } else {
                                  changePct = 0;
                                }
                              }
                              const isFavorable = Number(changePct) >= 0;

                              let peakVal = parseFloat(pos.price_peak);
                              if (!peakVal || (peakVal === entryPrice && currentPrice > entryPrice)) {
                                peakVal = Math.max(entryPrice, currentPrice);
                              }
                              let troughVal = parseFloat(pos.price_trough);
                              if (!troughVal || (troughVal === entryPrice && currentPrice < entryPrice)) {
                                troughVal = Math.min(entryPrice, currentPrice);
                              }

                              let dropFromPeak = pos.drop_from_peak_pct;
                              if (dropFromPeak === undefined || dropFromPeak === null || (Number(dropFromPeak) === 0 && peakVal > currentPrice)) {
                                dropFromPeak = peakVal > 0 ? ((peakVal - currentPrice) / peakVal) * 100 : 0;
                              }

                              let riseFromTrough = pos.rise_from_trough_pct;
                              if (riseFromTrough === undefined || riseFromTrough === null || (Number(riseFromTrough) === 0 && currentPrice > troughVal)) {
                                riseFromTrough = troughVal > 0 ? ((currentPrice - troughVal) / troughVal) * 100 : 0;
                              }

                              return (
                                <div key={pIdx} className={`p-1.5 rounded border ${isShort ? 'bg-rose-950/20 border-rose-600/30' : 'bg-emerald-950/20 border-emerald-600/30'}`}>
                                  {positionsToRender.length > 1 && (
                                    <div className="flex items-center justify-between mb-1">
                                      <span className={`px-1 py-0.2 rounded text-[9px] font-bold font-mono ${isShort ? 'bg-rose-950 text-rose-300 border border-rose-600/50' : 'bg-emerald-950 text-emerald-300 border border-emerald-600/50'}`}>
                                        {isShort ? '🔴 SHORT' : '🟢 LONG'}
                                      </span>
                                    </div>
                                  )}

                                  {/* Fila 1: Entrada ➔ Actual */}
                                  <div className="flex items-center gap-1.5 font-mono text-[11px]">
                                    <span className="text-slate-400">Entrada:</span>
                                    <span className="text-slate-200 font-bold">${entryPrice.toFixed(precision)}</span>
                                    <span className="text-slate-500">➔</span>
                                    <span className="text-white font-extrabold">${currentPrice.toFixed(precision)}</span>
                                  </div>

                                  {/* Fila 2: Rendimiento / Variación acumulada desde entrada */}
                                  <div className="flex items-center gap-1 mt-0.5 font-mono text-[11px]">
                                    <span className="text-slate-400 text-[10px]">Recorrido:</span>
                                    <span className={`font-black ${isFavorable ? 'text-emerald-400' : 'text-rose-400'}`}>
                                      {isFavorable ? '▲ +' : '▼ '}{Math.abs(Number(changePct)).toFixed(2)}%
                                    </span>
                                  </div>

                                  {/* Fila 3: Pico Máximo y Caída desde el pico (LONG) o Suelo y Rebote (SHORT) */}
                                  <div className="mt-1 pt-0.5 border-t border-slate-800/80 flex items-center justify-between text-[10px] font-mono">
                                    {!isShort ? (
                                      <>
                                        <span className="text-amber-300/90 font-medium" title="Precio pico más alto alcanzado desde la entrada">
                                          🏔️ Pico: ${peakVal.toFixed(precision)}
                                        </span>
                                        <span className={`font-bold ${(dropFromPeak || 0) > 1.5 ? 'text-amber-400' : 'text-slate-300'}`} title="Porcentaje de caída/retroceso desde el pico más alto">
                                          Caída: <span className="text-rose-300 font-black">▼ -{Math.abs(Number(dropFromPeak || 0)).toFixed(2)}%</span>
                                        </span>
                                      </>
                                    ) : (
                                      <>
                                        <span className="text-cyan-300/90 font-medium" title="Precio suelo más bajo alcanzado desde la entrada">
                                          🌊 Suelo: ${troughVal.toFixed(precision)}
                                        </span>
                                        <span className={`font-bold ${(riseFromTrough || 0) > 1.5 ? 'text-amber-400' : 'text-slate-300'}`} title="Porcentaje de rebote en contra desde el suelo más bajo">
                                          Rebote: <span className="text-rose-300 font-black">▲ +{Math.abs(Number(riseFromTrough || 0)).toFixed(2)}%</span>
                                        </span>
                                      </>
                                    )}
                                  </div>
                                </div>
                              );
                            })}
                          </div>
                        );
                      })() : (
                        <div className="flex flex-col font-mono text-xs">
                          {status.current_price ? (
                            <>
                              <span className="text-slate-300 font-bold">
                                ${parseFloat(status.current_price).toFixed(parseFloat(status.current_price) < 1 ? 4 : 2)}
                              </span>
                              <span className="text-[10px] text-slate-500 italic">📡 En radar</span>
                            </>
                          ) : (
                            <span className="text-slate-600 font-mono text-[11px]">—</span>
                          )}
                        </div>
                      )}
                    </td>

                    <td className="px-3 py-3 whitespace-nowrap text-sm">
                      {status.in_position ? (
                        <div className="flex flex-col">
                          <span className={`font-mono ${getPnlColorClass(status.current_pnl)}`}>
                            {formatPnl(status.current_pnl)}
                          </span>
                          {(() => {
                            const activeSubPositions = (status.positions || []).filter(p => p.in_position);
                            if (activeSubPositions.length > 1) {
                              return (
                                <div className="flex flex-col gap-0.5 mt-0.5 text-[10px] font-mono">
                                  {activeSubPositions.map((sp, pIdx) => {
                                    const isShort = sp.trade_side === 'SHORT';
                                    return (
                                      <span key={pIdx} className={getPnlColorClass(sp.current_pnl)}>
                                        {isShort ? '🔴 S: ' : '🟢 L: '}{formatPnl(sp.current_pnl)}
                                      </span>
                                    );
                                  })}
                                </div>
                              );
                            }
                            return null;
                          })()}
                        </div>
                      ) : (
                        <span className="text-slate-400 text-sm font-mono">N/A</span>
                      )}
                    </td>
                    <td className="px-3 py-3 whitespace-nowrap text-sm">
                      <span className={`font-mono ${getPnlColorClass(status.historical_pnl)}`}>
                      {formatPnl(status.historical_pnl)}
                      </span>
                    </td>
                    {/* --- RADAR & DIAGNÓSTICO EN VIVO --- */}
                    <td className="px-3 py-3 text-xs min-w-[280px]">
                      <LiveDiagnosticsCell status={status} />
                    </td>
                    <td className="px-3 py-3 text-xs">
                      {status.last_error ? (
                        <div 
                          className="inline-flex items-center gap-1.5 px-2 py-0.5 rounded bg-rose-950/90 border border-rose-600/70 text-rose-300 font-semibold text-[11px] cursor-help max-w-[200px]"
                          title={`Error en ${status.symbol}: ${status.last_error}`}
                        >
                          <span className="text-rose-400">⚠️</span>
                          <span className="truncate">{status.last_error}</span>
                        </div>
                      ) : (
                        <span className="text-slate-600 font-mono text-[11px]">—</span>
                      )}
                    </td>
                  </tr>
                  {/* --- FILA DESPLEGABLE CONDICIONAL --- */}
                  {expandedRows[status.symbol] && (
                    <tr id={`history-${status.symbol}`}>
                      <td colSpan="10" className="px-3 py-3 bg-slate-950 border-t border-b border-slate-800">
                        {loadingHistories[status.symbol] && (
                          <p className="text-xs text-center text-slate-300 font-mono">Cargando historial...</p>
                        )}
                        {historyErrors[status.symbol] && (
                          <p className="text-xs text-center text-rose-400">{historyErrors[status.symbol]}</p>
                        )}
                        {!loadingHistories[status.symbol] && !historyErrors[status.symbol] && (
                          tradeHistories[status.symbol]?.length > 0 ? (
                            <div className="overflow-x-auto">
                              <div className="flex flex-wrap items-center justify-between gap-2 mb-3 pb-2 border-b border-slate-800">
                                <div className="flex items-center gap-2 text-xs font-bold text-slate-200">
                                  <span>Últimos</span>
                                  <input
                                    type="number"
                                    min="1"
                                    max="1000"
                                    value={coinTradeLimits[status.symbol] !== undefined ? coinTradeLimits[status.symbol] : 20}
                                    onChange={(e) => handleCoinTradeLimitChange(status.symbol, e.target.value)}
                                    onBlur={() => handleCoinTradeLimitBlur(status.symbol)}
                                    onClick={(e) => e.stopPropagation()}
                                    className="w-16 px-2 py-0.5 text-center font-mono font-bold text-xs bg-slate-900 border border-slate-600 rounded text-amber-400 focus:outline-none focus:border-amber-400"
                                    title="Ingresa la cantidad de trades que deseas ver para esta moneda"
                                  />
                                  <span>trades cerrados para <span className="text-white font-extrabold">{status.symbol}</span>:</span>
                                  <span className="inline-flex items-center gap-1.5 px-2.5 py-0.5 rounded-md text-[11px] font-mono font-bold bg-indigo-950/90 text-indigo-200 border border-indigo-700/70 shadow-sm ml-1" title="Estrategia completa asignada a esta moneda">
                                    <span className="text-indigo-400 font-medium">Estrategia:</span>
                                    <span>{status.strategy_name && status.strategy_name.toLowerCase() !== 'global' ? status.strategy_name : 'v3_RSI-SNIPER-MOMENTUM_v3'}</span>
                                  </span>
                                </div>
                                <div className="text-[11px] text-slate-400 font-mono flex items-center gap-1.5">
                                  <span className="inline-block w-2 h-2 rounded-full bg-emerald-400 animate-pulse" title="Auto-actualización en vivo activa"></span>
                                  <span>{tradeHistories[status.symbol]?.length || 0} trades mostrados • Auto-actualizado</span>
                                </div>
                              </div>
                              <table className="min-w-full divide-y divide-slate-800 text-xs font-mono">
                                <thead className="bg-slate-900 border-b border-slate-700">
                                  <tr>
                                    <BinanceSortHeader label="Fecha Cierre" sortKey="close_timestamp" currentSort={subTradeSorts[status.symbol] || { key: 'close_timestamp', direction: 'desc' }} onSort={(k) => handleSubTradeSort(status.symbol, k)} />
                                    <BinanceSortHeader label="Lado" sortKey="trade_type" currentSort={subTradeSorts[status.symbol] || { key: 'close_timestamp', direction: 'desc' }} onSort={(k) => handleSubTradeSort(status.symbol, k)} />
                                    <BinanceSortHeader label="Motivo" sortKey="close_reason" currentSort={subTradeSorts[status.symbol] || { key: 'close_timestamp', direction: 'desc' }} onSort={(k) => handleSubTradeSort(status.symbol, k)} />
                                    <BinanceSortHeader label="Entrada" sortKey="open_price" currentSort={subTradeSorts[status.symbol] || { key: 'close_timestamp', direction: 'desc' }} onSort={(k) => handleSubTradeSort(status.symbol, k)} align="right" />
                                    <BinanceSortHeader label="Salida" sortKey="close_price" currentSort={subTradeSorts[status.symbol] || { key: 'close_timestamp', direction: 'desc' }} onSort={(k) => handleSubTradeSort(status.symbol, k)} align="right" />
                                    <BinanceSortHeader label="Cantidad" sortKey="quantity" currentSort={subTradeSorts[status.symbol] || { key: 'close_timestamp', direction: 'desc' }} onSort={(k) => handleSubTradeSort(status.symbol, k)} align="right" />
                                    <BinanceSortHeader label="Comisión" sortKey="commission_usdt" currentSort={subTradeSorts[status.symbol] || { key: 'close_timestamp', direction: 'desc' }} onSort={(k) => handleSubTradeSort(status.symbol, k)} align="right" tooltipInfo={{ title: "Comisión Binance", desc: "Comisión oficial descontada por Binance Futures en este trade (entrada + salida)." }} />
                                    <BinanceSortHeader label="PnL Neto" sortKey="pnl_usdt" currentSort={subTradeSorts[status.symbol] || { key: 'close_timestamp', direction: 'desc' }} onSort={(k) => handleSubTradeSort(status.symbol, k)} align="right" tooltipInfo={{ title: "PnL Neto", desc: "Ganancia o pérdida real acreditada/debitada de tu billetera de Binance." }} />
                                    <BinanceSortHeader label="ID" sortKey="id" currentSort={subTradeSorts[status.symbol] || { key: 'close_timestamp', direction: 'desc' }} onSort={(k) => handleSubTradeSort(status.symbol, k)} />
                                  </tr>
                                </thead>
                                <tbody className="divide-y divide-slate-800">
                                  {(sortedSubTrades[status.symbol] || tradeHistories[status.symbol]).map(trade => {
                                    const comm = getTradeCommission(trade);
                                    const gross = getTradeGrossPnL(trade);
                                    return (
                                      <tr key={trade.id} className="hover:bg-slate-900/60">
                                        <td className="px-2 py-1 whitespace-nowrap text-slate-300">{formatDate(trade.close_timestamp)}</td>
                                        <td className="px-2 py-1 whitespace-nowrap">
                                          <span className={`px-1.5 py-0.2 rounded text-[10px] font-bold ${trade.trade_type === 'SHORT' ? 'bg-rose-950 text-rose-300 border border-rose-600/50' : 'bg-emerald-950 text-emerald-300 border border-emerald-600/50'}`}>
                                            {trade.trade_type || 'LONG'}
                                          </span>
                                        </td>
                                        <td className="px-2 py-1 whitespace-nowrap text-slate-300">{trade.close_reason || 'N/A'}</td>
                                        <td className="px-2 py-1 text-right whitespace-nowrap text-white font-bold">{trade.open_price?.toFixed(4) ?? 'N/A'}</td>
                                        <td className="px-2 py-1 text-right whitespace-nowrap text-white font-bold">{trade.close_price?.toFixed(4) ?? 'N/A'}</td>
                                        <td className="px-2 py-1 text-right whitespace-nowrap text-slate-300">{trade.quantity?.toFixed(4) ?? 'N/A'}</td>
                                        <td className="px-2 py-1 text-right whitespace-nowrap text-amber-400 font-mono font-medium" title="Comisión Binance (entrada + salida)">
                                          -{comm.toFixed(4)}
                                        </td>
                                        <td className={`px-2 py-1 text-right whitespace-nowrap font-bold ${getPnlColorClass(trade.pnl_usdt)}`} title={`PnL Bruto de Mercado: ${gross >= 0 ? '+' : ''}${gross.toFixed(4)} USDT (Comisión: -${comm.toFixed(4)} USDT)`}>
                                          {formatPnl(trade.pnl_usdt)}
                                        </td>
                                        <td className="px-2 py-1 whitespace-nowrap text-slate-400">{trade.id}</td>
                                      </tr>
                                    );
                                  })}
                                </tbody>
                              </table>
                              {(() => {
                                 const list = tradeHistories[status.symbol] || [];
                                 let totalNet = 0;
                                 let totalComm = 0;
                                 let totalGross = 0;
                                 list.forEach(trade => {
                                   const net = parseFloat(trade.pnl_usdt);
                                   const c = getTradeCommission(trade);
                                   const g = getTradeGrossPnL(trade);
                                   if (!isNaN(net)) totalNet += net;
                                   totalComm += c;
                                   totalGross += g;
                                 });
                                 return (
                                   <div className="mt-2 flex flex-wrap items-center justify-end gap-3 text-xs pr-4 font-mono">
                                     <span className="text-slate-400">
                                       Comisiones: <span className="text-amber-400 font-bold">-${totalComm.toFixed(4)} USDT</span>
                                     </span>
                                     <span className="text-slate-400">
                                       PnL Bruto: <span className="text-slate-200 font-bold">{totalGross >= 0 ? `+${totalGross.toFixed(4)}` : totalGross.toFixed(4)} USDT</span>
                                     </span>
                                     <span className="font-bold text-slate-200">
                                       Total PnL Neto: 
                                       <span className={`ml-1.5 font-bold ${getPnlColorClass(totalNet)}`}>
                                         {formatPnl(totalNet)}
                                       </span>
                                     </span>
                                   </div>
                                 );
                               })()}
                            </div>
                          ) : (
                            <div className="py-3 text-center">
                              <div className="flex items-center justify-center gap-2 text-xs font-bold text-slate-200 mb-2">
                                <span>Últimos</span>
                                <input
                                  type="number"
                                  min="1"
                                  max="1000"
                                  value={coinTradeLimits[status.symbol] !== undefined ? coinTradeLimits[status.symbol] : 20}
                                  onChange={(e) => handleCoinTradeLimitChange(status.symbol, e.target.value)}
                                  onBlur={() => handleCoinTradeLimitBlur(status.symbol)}
                                  onClick={(e) => e.stopPropagation()}
                                  className="w-16 px-2 py-0.5 text-center font-mono font-bold text-xs bg-slate-900 border border-slate-600 rounded text-amber-400 focus:outline-none focus:border-amber-400"
                                  title="Ingresa la cantidad de trades que deseas ver para esta moneda"
                                />
                                <span>trades cerrados para <span className="text-white font-extrabold">{status.symbol}</span>:</span>
                                <span className="inline-flex items-center gap-1.5 px-2.5 py-0.5 rounded-md text-[11px] font-mono font-bold bg-indigo-950/90 text-indigo-200 border border-indigo-700/70 shadow-sm ml-1" title="Estrategia completa asignada a esta moneda">
                                  <span className="text-indigo-400 font-medium">Estrategia:</span>
                                  <span>{status.strategy_name && status.strategy_name.toLowerCase() !== 'global' ? status.strategy_name : 'v3_RSI-SNIPER-MOMENTUM_v3'}</span>
                                </span>
                              </div>
                              <p className="text-xs text-slate-400">No hay trades cerrados para {status.symbol}.</p>
                            </div>
                          )
                        )}
                      </td>
                    </tr>
                  )}
                </React.Fragment>
              ))
            ) : (
              <tr>
                <td colSpan="9" className="px-6 py-10 text-center text-sm text-slate-300 font-semibold">
                  {isLoading ? 'Cargando estados...' : (error ? `Error: ${error}` : 'No hay datos de bots disponibles.')}
                </td>
              </tr>
            )}
          </tbody>{/* <--- CIERRE DE TBODY */}
          {sortedStatuses.length > 0 && (
            <tfoot className="bg-slate-950 border-t-2 border-slate-700 font-mono text-xs">
              <tr className="divide-x divide-slate-800">
                <td colSpan="4" className="px-3 py-3 text-left font-sans font-extrabold text-slate-200">
                  <div className="flex items-center gap-2">
                    <span className="text-base">📊</span>
                    <span>TOTALES CONSOLIDADOS ({sortedStatuses.length} pares)</span>
                  </div>
                </td>
                {/* Posición & Margen */}
                <td className="px-3 py-3 font-bold text-slate-200">
                  <div className="flex flex-col">
                    <span className="text-[10px] text-slate-400 font-sans">Margen total:</span>
                    <span className="text-white">${totalMarginCommitted.toFixed(2)} USDT</span>
                  </div>
                </td>
                {/* Current PnL (Flotante) */}
                <td className="px-3 py-3 font-black text-xs">
                  <div className="flex flex-col">
                    <span className="text-[10px] text-slate-400 font-sans">Flotante neto:</span>
                    <span className={totalCurrentUnrealizedPnl < 0 ? 'text-rose-400' : totalCurrentUnrealizedPnl > 0 ? 'text-emerald-400' : 'text-slate-300'}>
                      {totalCurrentUnrealizedPnl >= 0 ? `+${totalCurrentUnrealizedPnl.toFixed(4)}` : totalCurrentUnrealizedPnl.toFixed(4)} USDT
                    </span>
                  </div>
                </td>
                {/* Hist. PnL (Realizado de pares) */}
                <td className="px-3 py-3 font-black text-xs">
                  <div className="flex flex-col">
                    <span className="text-[10px] text-slate-400 font-sans">Histórico pares:</span>
                    <span className={totalCumulativePnl < 0 ? 'text-rose-400' : totalCumulativePnl > 0 ? 'text-emerald-400' : 'text-slate-300'}>
                      {totalCumulativePnl >= 0 ? `+${totalCumulativePnl.toFixed(4)}` : totalCumulativePnl.toFixed(4)} USDT
                    </span>
                  </div>
                </td>
                {/* Diagnóstico & error columns */}
                <td colSpan="2" className="px-3 py-3 text-right text-[11px] text-slate-400 font-sans">
                  <span>Métricas consolidadas en vivo</span>
                </td>
              </tr>
            </tfoot>
          )}
        </table>
      </div>
    </div>
  );
}

export default StatusDisplay; 