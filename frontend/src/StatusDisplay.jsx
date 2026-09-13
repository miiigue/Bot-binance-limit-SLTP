import React, { useState, useEffect, useMemo, useRef } from 'react';
import BinanceSortHeader, { sortTableData } from './BinanceSortHeader';

// Clave para guardar/leer en localStorage
const STATUS_CACHE_KEY = 'botStatusesCache';

// Helper para formatear fechas (puedes ajustar el formato)
const formatDate = (dateString) => {
  if (!dateString) return 'N/A';
  try {
    return new Date(dateString).toLocaleString(); // Formato local
  } catch (e) {
    return dateString; // Devolver original si falla
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
function LiveDiagnosticsCell({ status }) {
  if (!status) return null;

  // CASO 1: EN POSICIÓN ABIERTA -> Telemetría Visual Unificada (TP con punto de TS, y SL o Trailing Stop)
  if (status.in_position) {
    const pos = status.position_diagnostics || {};
    const pnlUsdt = pos.pnl_usdt !== undefined ? Number(pos.pnl_usdt) : (parseFloat(status.current_pnl) || 0);

    // 1. Métricas de TP
    const tp = pos.tp || {
      target_usdt: pos.tp_target_usdt,
      progress_pct: pos.tp_progress_pct,
      remaining_usdt: (pos.tp_target_usdt && pnlUsdt !== undefined) ? Math.max(0, Number(pos.tp_target_usdt) - pnlUsdt) : null,
      hit: pos.tp_target_usdt ? pnlUsdt >= Number(pos.tp_target_usdt) : false
    };
    const hasTp = tp.target_usdt !== null && tp.target_usdt !== undefined && Number(tp.target_usdt) > 0;
    const tpProgress = Math.min(100, Math.max(0, tp.progress_pct || 0));

    // 2. Métricas de Trailing Stop
    const ts = pos.ts || {
      enabled: Boolean(pos.trailing_active),
      armed: Boolean(pos.trailing_armed),
      label: pos.trailing_armed ? 'ARMADO' : 'Inactivo',
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

    // 3. Métricas de Stop Loss (Se llena en ROJO únicamente desde saldo negativo, sin amarillo)
    const slTarget = pos.sl?.target_usdt !== undefined ? pos.sl.target_usdt : pos.sl_target_usdt;
    const slDist = pos.sl?.distance_usdt !== undefined ? pos.sl.distance_usdt : pos.sl_distance_usdt;
    const hasSl = slTarget !== null && slTarget !== undefined;
    
    // Si pnlUsdt >= 0: la barra está vacía (0%). Solo se llena al haber pérdida proporcionalmente al target
    let slFillPct = 0;
    if (pnlUsdt < 0 && slTarget && Number(slTarget) < 0) {
      slFillPct = Math.min(100, Math.max(0, (Math.abs(pnlUsdt) / Math.abs(Number(slTarget))) * 100));
    }

    return (
      <div className="flex flex-col gap-1.5 min-w-[240px] max-w-[380px] py-0.5">
        {/* --- FILA 1: TAKE PROFIT (con punto de activación de Trailing Stop visible) --- */}
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

            {/* Barra de progreso de TP con el punto/marcador de Trailing Stop visible */}
            <div className="relative w-full bg-slate-900/90 rounded-full h-2 overflow-hidden border border-slate-700/80">
              {/* Punto de activación de Trailing Stop en la barra de TP */}
              {hasTs && tsArmPosPct && !ts.armed && (
                <div
                  className="absolute top-0 bottom-0 w-1 bg-sky-400 z-20 shadow-sm shadow-sky-400"
                  style={{ left: `${tsArmPosPct}%` }}
                  title={`Umbral de activación Trailing Stop: +${tsArmThreshold} USDT`}
                />
              )}

              {/* Relleno de avance hacia TP */}
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

        {/* --- FILA 2: TRAILING STOP (Cuando está armado reemplaza al SL) O STOP LOSS (Si aún no se armó TS) --- */}
        {ts.armed ? (
          /* Al llegar al punto de TS, se QUITA el Stop Loss y APARECE el Trailing Stop en AZUL */
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
            {/* Barra de Trailing Stop en AZUL que muestra la tolerancia de retroceso restante */}
            <div className="w-full bg-slate-900/90 rounded-full h-2 overflow-hidden border border-sky-900/80">
              <div
                className="h-full rounded-full transition-all duration-500 bg-gradient-to-r from-blue-600 via-sky-500 to-cyan-400 shadow-sm shadow-sky-500/50"
                style={{ width: `${Math.min(100, Math.max(5, ts.tolerance_pct !== null && ts.tolerance_pct !== undefined ? ts.tolerance_pct : 100))}%` }}
              />
            </div>
          </div>
        ) : hasSl ? (
          /* Mientras no se alcance el punto de TS, se vigila el riesgo con el Stop Loss */
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
            {/* Barra de SL: 0% (vacía) con saldo positivo. Se llena en ROJO únicamente al haber saldo negativo */}
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

  // CASO 2: BOT PAUSADO
  if (status.is_paused) {
    return (
      <div className="flex items-center gap-1.5 text-xs text-amber-300/80 font-mono italic">
        <span>⏸️</span>
        <span>Búsqueda de entradas en pausa</span>
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
  // --- NUEVO ESTADO PARA EL NÚMERO DE TRADES A MOSTRAR ---
  const [numTradesToShow, setNumTradesToShow] = useState(2); // Por defecto 2 trades
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

  const sortedSubTrades = useMemo(() => {
    const map = {};
    for (const sym of Object.keys(tradeHistories)) {
      const list = tradeHistories[sym] || [];
      const sortConfig = subTradeSorts[sym] || { key: 'close_timestamp', direction: 'desc' };
      map[sym] = sortTableData(list, sortConfig, {
        close_timestamp: t => t.close_timestamp || '',
        close_reason: t => t.close_reason || '',
        open_price: t => t.open_price || 0,
        close_price: t => t.close_price || 0,
        quantity: t => t.quantity || 0,
        pnl_usdt: t => parseFloat(t.pnl_usdt) || 0,
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

  const handleCloseSinglePosition = async (e, symbol) => {
    e.stopPropagation();
    if (!window.confirm(`¿Cerrar posición de ${symbol} a precio de mercado en Binance?`)) return;
    
    setClosingSymbols(prev => ({ ...prev, [symbol]: true }));
    try {
      const resp = await fetch(`/api/close_position/${symbol}`, { method: 'POST' });
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
        alert(`Error al cerrar ${symbol}: ${data.error || 'Error desconocido'}`);
      }
    } catch (err) {
      alert(`Error de red al cerrar ${symbol}: ${err.message}`);
    } finally {
      setClosingSymbols(prev => ({ ...prev, [symbol]: false }));
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

                onStatusUpdate({ 
                    totalPnl: authoritativeTotalPnl, 
                    historicalPnl: authoritativeTotalPnl,
                    unrealizedPnl: authoritativeUnrealizedPnl,
                    coinCount: sortedStatuses.length,
                    coinsInPosition: coinsInPos,
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
        } else {
             console.warn("La respuesta de /api/status no contenía un array 'statuses' válido:", data);
             // ¿Qué hacer aquí? Podríamos mantener el estado anterior o limpiarlo.
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
        // NO HACEMOS setStatuses([]) para mantener los últimos datos visibles
      } finally {
        setIsLoading(false);
      }
    };

    fetchData(); // Llamar una vez al montar
    const intervalId = setInterval(fetchData, 5000); // Refrescar cada 5s
    window.addEventListener('bot-status-refresh', fetchData);
    return () => {
      clearInterval(intervalId);
      window.removeEventListener('bot-status-refresh', fetchData);
    };
  }, []);

  // --- NUEVA FUNCIÓN PARA CARGAR HISTORIAL DE TRADES ---
  const fetchTradeHistory = async (symbol) => {
    if (loadingHistories[symbol]) return; // Evitar cargas múltiples

    setLoadingHistories(prev => ({ ...prev, [symbol]: true }));
    setHistoryErrors(prev => ({ ...prev, [symbol]: null }));

    try {
      // --- USAR numTradesToShow EN LA URL ---
      const response = await fetch(`/api/trades/${symbol}?limit=${numTradesToShow}`);
      if (!response.ok) {
        const errData = await response.json();
        throw new Error(errData.error || `HTTP error! Status: ${response.status}`);
      }
      const historyData = await response.json();
      setTradeHistories(prev => ({ ...prev, [symbol]: historyData }));
    } catch (err) {
      console.error(`Error fetching trade history for ${symbol}:`, err);
      setHistoryErrors(prev => ({ ...prev, [symbol]: `Error: ${err.message}` }));
      setTradeHistories(prev => ({ ...prev, [symbol]: [] })); // Limpiar en caso de error
    } finally {
      setLoadingHistories(prev => ({ ...prev, [symbol]: false }));
    }
  };
  // -----------------------------------------------------

  // --- NUEVA FUNCIÓN PARA EXPANDIR/COLAPSAR FILA ---
  const toggleRow = (symbol) => {
    const isCurrentlyExpanded = expandedRows[symbol];
    setExpandedRows(prev => ({ ...prev, [symbol]: !isCurrentlyExpanded }));

    // Si se está expandiendo y no hay historial cargado (o hubo error), cargar
    if (!isCurrentlyExpanded && (!tradeHistories[symbol] || historyErrors[symbol])) {
       fetchTradeHistory(symbol);
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
        {/* --- BARRA DE OPCIONES DE TRADES & RESET --- */}
        <div className="my-4 flex flex-wrap items-center justify-between gap-3 bg-slate-950/90 p-3 rounded-xl border border-slate-700/80">
          <div className="flex items-center gap-2">
            <label htmlFor="numTradesToShowInput" className="text-xs font-bold text-slate-200">
              Mostrar últimos trades:
            </label>
            <input
              type="number"
              id="numTradesToShowInput"
              value={numTradesToShow}
              onChange={(e) => {
                const val = parseInt(e.target.value, 10);
                if (val > 0) {
                  setNumTradesToShow(val);
                } else if (e.target.value === '') {
                  setNumTradesToShow('');
                }
              }}
              onBlur={(e) => {
                if (e.target.value === '' || parseInt(e.target.value, 10) <= 0) {
                  setNumTradesToShow(2);
                }
              }}
              className="w-16 px-2 py-1 border border-slate-600 rounded-lg shadow-sm sm:text-xs bg-slate-900 text-white text-center font-mono font-bold"
              min="1"
            />
          </div>

          <button
            onClick={async () => {
              if (!window.confirm("⚠️ ¿Deseas reiniciar el historial de trades y poner el PnL a 0.00 USDT?")) return;
              try {
                const res = await fetch('/api/trades/reset', { method: 'POST' });
                if (res.ok) {
                  setTradeHistories({});
                  setStatuses([]);
                  localStorage.removeItem('botStatusesCache');
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
            }}
            className="text-xs font-bold px-3 py-1.5 rounded-xl bg-red-950/70 hover:bg-red-900 text-red-200 border border-red-700/60 transition-colors flex items-center shadow-sm"
            title="Borra el registro de trades pasados de la base de datos"
          >
            🗑️ Vaciar Historial de Trades & PnL
          </button>
        </div>
        {/* ----------------------------------------- */}
        <table className="min-w-full divide-y divide-slate-700">
          <thead className="bg-slate-950 border-b-2 border-slate-700">
            <tr>
              <th scope="col" className="px-2 py-3 text-left text-xs font-extrabold text-slate-100 uppercase tracking-wider w-10"></th>
              <BinanceSortHeader label="Symbol" sortKey="symbol" currentSort={statusSort} onSort={handleStatusSort} />
              <BinanceSortHeader label="Estrategia" sortKey="strategy_name" currentSort={statusSort} onSort={handleStatusSort} />
              <BinanceSortHeader label="Estado" sortKey="state" currentSort={statusSort} onSort={handleStatusSort} />
              <BinanceSortHeader label="Posición & Margen" sortKey="margin" currentSort={statusSort} onSort={handleStatusSort} />
              <BinanceSortHeader label="Current PnL" sortKey="current_pnl" currentSort={statusSort} onSort={handleStatusSort} />
              <BinanceSortHeader label="Hist. PnL" sortKey="historical_pnl" currentSort={statusSort} onSort={handleStatusSort} />
              <BinanceSortHeader label="Radar & Diagnóstico en Vivo" sortKey="diagnostics" currentSort={statusSort} onSort={handleStatusSort} />
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
                    {/* --- Símbolo con botón de cierre X compacto --- */}
                    <td className="px-3 py-3 whitespace-nowrap text-sm font-bold text-white">
                      <div className="flex items-center space-x-2">
                        {status.in_position && (
                          <button
                            onClick={(e) => handleCloseSinglePosition(e, status.symbol)}
                            disabled={closingSymbols[status.symbol]}
                            className="w-5 h-5 flex-shrink-0 flex items-center justify-center text-xs font-extrabold text-white bg-red-600 hover:bg-red-700 active:bg-red-800 rounded-full shadow transition-transform transform active:scale-95 disabled:bg-gray-600"
                            title={`Cerrar posición de ${status.symbol} a mercado en Binance`}
                          >
                            {closingSymbols[status.symbol] ? '..' : '✕'}
                          </button>
                        )}
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
                    </td>

                    {/* --- ESTRATEGIA ASIGNADA --- */}
                    <td className="px-3 py-3 whitespace-nowrap text-xs">
                      <span className="inline-flex items-center px-2 py-0.5 rounded-lg text-[11px] font-mono font-bold bg-indigo-950/80 text-indigo-300 border border-indigo-700/60 shadow-sm" title={`Estrategia: ${status.strategy_name || 'Global'}`}>
                        {status.strategy_name || 'Global'}
                      </span>
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
                          title={status.is_paused ? 'Bot pausado. Clic para reactivar.' : 'Bot activo. Clic para pausar.'}
                          className={`px-2.5 py-0.5 inline-flex items-center justify-center text-xs leading-5 font-bold rounded-full border transition-all active:scale-95 cursor-pointer ${
                            status.state === 'IN_POSITION' ? 'bg-emerald-950/80 text-emerald-200 border-emerald-500/50' :
                            status.state === 'Paused' || status.is_paused ? 'bg-amber-950/80 text-amber-200 border-amber-500/50 hover:bg-amber-900' :
                            status.state === 'ERROR' ? 'bg-red-950/80 text-red-200 border-red-500/50' :
                            status.state?.includes('WAITING') ? 'bg-indigo-950/80 text-indigo-200 border-indigo-500/50' :
                            status.state === 'Inactive' ? 'bg-slate-800 text-slate-300 border-slate-700' :
                            'bg-slate-800 text-slate-200 border-slate-700 hover:bg-slate-750'
                        }`}>
                          {pausingSymbols[status.symbol] ? '⏳ ...' : (status.is_paused && status.state !== 'IN_POSITION' ? '⏸️ Pausado' : (status.state || 'N/A'))}
                        </button>
                        {/* Chips de órdenes pendientes si existen */}
                        {status.pending_entry_order_id && (
                          <span className="inline-flex items-center gap-1 text-[10px] font-mono font-bold px-1.5 py-0.5 rounded bg-amber-950/90 text-amber-300 border border-amber-500/60 shadow-sm" title={`Orden de entrada pendiente ID: ${status.pending_entry_order_id}`}>
                            ⏳ Compra #{String(status.pending_entry_order_id).slice(-4)}
                          </span>
                        )}
                        {status.pending_exit_order_id && (
                          <span className="inline-flex items-center gap-1 text-[10px] font-mono font-bold px-1.5 py-0.5 rounded bg-rose-950/90 text-rose-300 border border-rose-500/60 shadow-sm" title={`Orden de salida pendiente ID: ${status.pending_exit_order_id}`}>
                            ⏳ Cierre #{String(status.pending_exit_order_id).slice(-4)}
                          </span>
                        )}
                        {status.pending_tp_order_id && (
                          <span className="inline-flex items-center gap-1 text-[10px] font-mono font-bold px-1.5 py-0.5 rounded bg-emerald-950/90 text-emerald-300 border border-emerald-500/60 shadow-sm" title={`TP activo ID: ${status.pending_tp_order_id}`}>
                            🎯 TP #{String(status.pending_tp_order_id).slice(-4)}
                          </span>
                        )}
                        {status.pending_sl_order_id && (
                          <span className="inline-flex items-center gap-1 text-[10px] font-mono font-bold px-1.5 py-0.5 rounded bg-red-950/90 text-red-300 border border-red-500/60 shadow-sm" title={`SL activo ID: ${status.pending_sl_order_id}`}>
                            🛑 SL #{String(status.pending_sl_order_id).slice(-4)}
                          </span>
                        )}
                      </div>
                    </td>

                    {/* --- POSICIÓN & MARGEN --- */}
                    <td className="px-3 py-3 whitespace-nowrap text-xs">
                      {status?.in_position ? (
                        <div className="flex flex-col space-y-0.5">
                          <div className="flex items-center gap-1">
                            <span className="font-extrabold text-white font-mono text-xs">
                              ${(Number(status?.position_value_usdt) || Math.abs((Number(status?.entry_price) || 0) * (Number(status?.position_size) || 0))).toFixed(2)} USDT
                            </span>
                            <span className="text-[11px] text-slate-300 font-mono">
                              ({status?.position_size || 0} {String(status?.symbol || '').replace('USDT', '')})
                            </span>
                          </div>
                          <div className="flex items-center gap-1">
                            <span className="text-[11px] font-bold text-emerald-400 font-mono">
                              Margen: ~${(Number(status?.margin_usdt) || ((Number(status?.position_value_usdt) || 50) / (Number(status?.leverage) || 20))).toFixed(2)} USDT
                            </span>
                            <span className="text-[10px] px-1.5 py-0.2 rounded bg-slate-800 text-amber-300 font-bold border border-slate-700 font-mono">
                              {status?.leverage || 20}x
                            </span>
                          </div>
                          {status?.entry_price && !isNaN(parseFloat(status.entry_price)) && (
                            <span className="text-[11px] text-slate-300 font-mono">
                              Entrada: ${parseFloat(status.entry_price).toFixed(4)}
                            </span>
                          )}
                        </div>
                      ) : (
                        <span className="text-slate-400 text-xs italic">
                          Sin posición
                        </span>
                      )}
                    </td>

                    <td className="px-3 py-3 whitespace-nowrap text-sm">
                      <span className={`font-mono ${getPnlColorClass(status.current_pnl)}`}>
                      {status.in_position ? formatPnl(status.current_pnl) : 'N/A'}
                      </span>
                    </td>
                    <td className="px-3 py-3 whitespace-nowrap text-sm">
                      <span className={`font-mono ${getPnlColorClass(status.historical_pnl)}`}>
                      {formatPnl(status.historical_pnl)}
                      </span>
                    </td>
                    {/* --- RADAR & DIAGNÓSTICO EN VIVO --- */}
                    <td className="px-3 py-3 text-xs">
                      <LiveDiagnosticsCell status={status} />
                    </td>
                    <td className="px-3 py-3 text-xs text-rose-400 font-bold truncate max-w-[120px]">
                      {status.last_error ? 'ERROR' : ''}
                    </td>
                  </tr>
                  {/* --- FILA DESPLEGABLE CONDICIONAL --- */}
                  {expandedRows[status.symbol] && (
                    <tr id={`history-${status.symbol}`}>
                      <td colSpan="9" className="px-3 py-3 bg-slate-950 border-t border-b border-slate-800">
                        {loadingHistories[status.symbol] && (
                          <p className="text-xs text-center text-slate-300 font-mono">Cargando historial...</p>
                        )}
                        {historyErrors[status.symbol] && (
                          <p className="text-xs text-center text-rose-400">{historyErrors[status.symbol]}</p>
                        )}
                        {!loadingHistories[status.symbol] && !historyErrors[status.symbol] && (
                          tradeHistories[status.symbol]?.length > 0 ? (
                            <div className="overflow-x-auto">
                              <h4 className="text-xs font-bold mb-2 text-slate-200">
                                Últimos {tradeHistories[status.symbol].length} trades cerrados para {status.symbol}:
                              </h4>
                              <table className="min-w-full divide-y divide-slate-800 text-xs font-mono">
                                <thead className="bg-slate-900 border-b border-slate-700">
                                  <tr>
                                    <BinanceSortHeader label="Fecha Cierre" sortKey="close_timestamp" currentSort={subTradeSorts[status.symbol] || { key: 'close_timestamp', direction: 'desc' }} onSort={(k) => handleSubTradeSort(status.symbol, k)} />
                                    <BinanceSortHeader label="Motivo" sortKey="close_reason" currentSort={subTradeSorts[status.symbol] || { key: 'close_timestamp', direction: 'desc' }} onSort={(k) => handleSubTradeSort(status.symbol, k)} />
                                    <BinanceSortHeader label="Entrada" sortKey="open_price" currentSort={subTradeSorts[status.symbol] || { key: 'close_timestamp', direction: 'desc' }} onSort={(k) => handleSubTradeSort(status.symbol, k)} align="right" />
                                    <BinanceSortHeader label="Salida" sortKey="close_price" currentSort={subTradeSorts[status.symbol] || { key: 'close_timestamp', direction: 'desc' }} onSort={(k) => handleSubTradeSort(status.symbol, k)} align="right" />
                                    <BinanceSortHeader label="Cantidad" sortKey="quantity" currentSort={subTradeSorts[status.symbol] || { key: 'close_timestamp', direction: 'desc' }} onSort={(k) => handleSubTradeSort(status.symbol, k)} align="right" />
                                    <BinanceSortHeader label="PnL" sortKey="pnl_usdt" currentSort={subTradeSorts[status.symbol] || { key: 'close_timestamp', direction: 'desc' }} onSort={(k) => handleSubTradeSort(status.symbol, k)} align="right" />
                                    <BinanceSortHeader label="ID" sortKey="id" currentSort={subTradeSorts[status.symbol] || { key: 'close_timestamp', direction: 'desc' }} onSort={(k) => handleSubTradeSort(status.symbol, k)} />
                                  </tr>
                                </thead>
                                <tbody className="divide-y divide-slate-800">
                                  {(sortedSubTrades[status.symbol] || tradeHistories[status.symbol]).map(trade => (
                                    <tr key={trade.id} className="hover:bg-slate-900/60">
                                      <td className="px-2 py-1 whitespace-nowrap text-slate-300">{formatDate(trade.close_timestamp)}</td>
                                      <td className="px-2 py-1 whitespace-nowrap text-slate-300">{trade.close_reason || 'N/A'}</td>
                                      <td className="px-2 py-1 text-right whitespace-nowrap text-white font-bold">{trade.open_price?.toFixed(4) ?? 'N/A'}</td>
                                      <td className="px-2 py-1 text-right whitespace-nowrap text-white font-bold">{trade.close_price?.toFixed(4) ?? 'N/A'}</td>
                                      <td className="px-2 py-1 text-right whitespace-nowrap text-slate-300">{trade.quantity?.toFixed(4) ?? 'N/A'}</td>
                                      <td className={`px-2 py-1 text-right whitespace-nowrap ${getPnlColorClass(trade.pnl_usdt)}`}>
                                        {formatPnl(trade.pnl_usdt)}
                                      </td>
                                      <td className="px-2 py-1 whitespace-nowrap text-slate-400">{trade.id}</td>
                                    </tr>
                                  ))}
                                </tbody>
                              </table>
                              {(() => {
                                 const totalHistoryPnl = tradeHistories[status.symbol].reduce((acc, trade) => {
                                   const pnl = parseFloat(trade.pnl_usdt);
                                   return isNaN(pnl) ? acc : acc + pnl;
                                 }, 0);
                                 return (
                                   <div className="mt-2 text-right pr-4">
                                     <span className="font-bold text-xs text-slate-200">
                                       Total PnL de la lista: 
                                       <span className={`ml-2 font-mono ${getPnlColorClass(totalHistoryPnl)}`}>
                                         {formatPnl(totalHistoryPnl)}
                                       </span>
                                     </span>
                                   </div>
                                 );
                               })()}
                            </div>
                          ) : (
                            <p className="text-xs text-center text-slate-400">No hay trades cerrados para {status.symbol}.</p>
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