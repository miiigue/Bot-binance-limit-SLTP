import React, { useState, useEffect, useMemo } from 'react';
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
// ---------------------------------------------

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
    state: s => s.is_paused ? 'Paused' : (s.state || ''),
    margin: s => s.in_position ? (Number(s.margin_usdt) || ((Number(s.position_value_usdt) || 50) / (Number(s.leverage) || 20))) : 0,
    current_pnl: s => s.in_position ? (parseFloat(s.current_pnl) || 0) : -9999999,
    historical_pnl: s => parseFloat(s.historical_pnl) || 0,
    pending_entry_order_id: s => s.pending_entry_order_id ? 1 : 0,
    pending_exit_order_id: s => s.pending_exit_order_id ? 1 : 0,
    pending_tp_order_id: s => s.pending_tp_order_id ? 1 : 0,
    pending_sl_order_id: s => s.pending_sl_order_id ? 1 : 0,
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

                onStatusUpdate({ 
                    totalPnl: totalHistoricalPnl, 
                    historicalPnl: totalHistoricalPnl,
                    unrealizedPnl: totalCurrentUnrealizedPnl,
                    coinCount: sortedStatuses.length,
                    coinsInPosition: coinsInPos,
                    sessionStats: data.session_stats,
                    bots_running: data.bots_running
                });
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
    return () => clearInterval(intervalId); // Limpiar intervalo al desmontar
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

  // --- CALCULAR EL TOTAL PNL HISTÓRICO ---
  const totalCumulativePnl = statuses.reduce((acc, status) => {
    const pnlValue = parseFloat(status.historical_pnl); // Usar historical_pnl
    if (!isNaN(pnlValue)) {
      return acc + pnlValue;
    }
    return acc;
  }, 0);
  // -------------------------------------

  // --- LLAMAR A onStatusUpdate SI statuses CAMBIA (TAMBIÉN PARA DATOS INICIALES DE CACHÉ) ---
  useEffect(() => {
    if (onStatusUpdate) {
        // NUEVO: CALCULAR MONEDAS EN POSICIÓN TAMBIÉN AQUÍ
        const coinsInPos = statuses.filter(s => s.in_position).length;
        onStatusUpdate({ 
            totalPnl: totalCumulativePnl, 
            coinCount: statuses.length,
            coinsInPosition: coinsInPos // Pasar nuevo dato
            // No pasamos sessionStats aquí porque este useEffect es solo para la caché local
        });
    }
  }, [totalCumulativePnl, statuses, onStatusUpdate]); // Añadir statuses a la dependencia
  // -------------------------------------------------------------------------------------

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
                  alert("✅ Historial de trades reiniciado con éxito.");
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
              <th scope="col" className="px-3 py-3 text-center text-xs font-extrabold text-slate-100 uppercase tracking-wider">Control</th>
              <BinanceSortHeader label="Estado" sortKey="state" currentSort={statusSort} onSort={handleStatusSort} />
              <BinanceSortHeader label="Posición & Margen" sortKey="margin" currentSort={statusSort} onSort={handleStatusSort} />
              <BinanceSortHeader label="Current PnL" sortKey="current_pnl" currentSort={statusSort} onSort={handleStatusSort} />
              <BinanceSortHeader label="Hist. PnL" sortKey="historical_pnl" currentSort={statusSort} onSort={handleStatusSort} />
              <BinanceSortHeader label="Pending Entry" sortKey="pending_entry_order_id" currentSort={statusSort} onSort={handleStatusSort} align="center" />
              <BinanceSortHeader label="Pending Exit" sortKey="pending_exit_order_id" currentSort={statusSort} onSort={handleStatusSort} align="center" />
              <BinanceSortHeader label="Pending TP" sortKey="pending_tp_order_id" currentSort={statusSort} onSort={handleStatusSort} align="center" />
              <BinanceSortHeader label="Pending SL" sortKey="pending_sl_order_id" currentSort={statusSort} onSort={handleStatusSort} align="center" />
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

                    {/* --- BOTÓN DE PAUSA RÁPIDA --- */}
                    <td className="px-3 py-3 whitespace-nowrap text-center" onClick={(e) => e.stopPropagation()}>
                      <button
                        type="button"
                        onClick={(e) => handleTogglePause(e, status.symbol)}
                        disabled={pausingSymbols[status.symbol]}
                        className={`px-2.5 py-1 text-[11px] font-bold rounded-xl border transition-all active:scale-95 shadow-sm flex items-center justify-center gap-1 mx-auto ${
                          status.is_paused
                            ? 'bg-amber-950/80 hover:bg-amber-900 text-amber-200 border-amber-500/50'
                            : 'bg-emerald-950/80 hover:bg-emerald-900 text-emerald-200 border-emerald-500/50'
                        }`}
                        title={status.is_paused ? 'Bot pausado para este par. Clic para reactivar.' : 'Bot activo para este par. Clic para pausar.'}
                      >
                        {pausingSymbols[status.symbol] ? (
                          <span className="animate-spin text-xs">⏳</span>
                        ) : status.is_paused ? (
                          <><span>⏸️</span><span>Pausado</span></>
                        ) : (
                          <><span>🟢</span><span>Activo</span></>
                        )}
                      </button>
                    </td>

                    {/* --- ESTADO --- */}
                    <td className="px-3 py-3 whitespace-nowrap text-xs">
                     <span className={`px-2.5 py-0.5 inline-flex text-xs leading-5 font-bold rounded-full border ${
                         status.state === 'IN_POSITION' ? 'bg-emerald-950/80 text-emerald-200 border-emerald-500/50' :
                         status.state === 'Paused' || status.is_paused ? 'bg-amber-950/80 text-amber-200 border-amber-500/50' :
                         status.state === 'ERROR' ? 'bg-red-950/80 text-red-200 border-red-500/50' :
                         status.state?.includes('WAITING') ? 'bg-indigo-950/80 text-indigo-200 border-indigo-500/50' :
                         status.state === 'Inactive' ? 'bg-slate-800 text-slate-300 border-slate-700' :
                         'bg-slate-800 text-slate-200 border-slate-700'
                     }`}>
                       {status.is_paused && status.state !== 'IN_POSITION' ? '⏸️ Pausado' : (status.state || 'N/A')}
                     </span>
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
                     <td className="px-2 py-3 whitespace-nowrap text-xs text-center font-mono">
                      {status.pending_entry_order_id ? <span className="text-emerald-400 font-bold">SÍ</span> : <span className="text-slate-500">-</span>}
                    </td>
                     <td className="px-2 py-3 whitespace-nowrap text-xs text-center font-mono">
                      {status.pending_exit_order_id ? <span className="text-emerald-400 font-bold">SÍ</span> : <span className="text-slate-500">-</span>}
                    </td>
                    <td className="px-2 py-3 whitespace-nowrap text-xs text-center font-mono">
                      {status.pending_tp_order_id ? <span className="text-emerald-400 font-bold">SÍ</span> : <span className="text-slate-500">-</span>}
                    </td>
                    <td className="px-2 py-3 whitespace-nowrap text-xs text-center font-mono">
                      {status.pending_sl_order_id ? <span className="text-emerald-400 font-bold">SÍ</span> : <span className="text-slate-500">-</span>}
                    </td>
                    <td className="px-3 py-3 text-xs text-rose-400 font-bold truncate max-w-[120px]">
                      {status.last_error ? 'ERROR' : ''}
                    </td>
                  </tr>
                  {/* --- FILA DESPLEGABLE CONDICIONAL --- */}
                  {expandedRows[status.symbol] && (
                    <tr id={`history-${status.symbol}`}>
                      <td colSpan="12" className="px-3 py-3 bg-slate-950 border-t border-b border-slate-800">
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
                <td colSpan="12" className="px-6 py-10 text-center text-sm text-slate-300 font-semibold">
                  {isLoading ? 'Cargando estados...' : (error ? `Error: ${error}` : 'No hay datos de bots disponibles.')}
                </td>
              </tr>
            )}
          </tbody>{/* <--- CIERRE DE TBODY */}
        </table>
      </div>
    </div>
  );
}

export default StatusDisplay; 