import React, { useState, useEffect } from 'react';
import BotControls from './BotControls';

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
  if (pnl === null || pnl === undefined) return 'text-gray-500 dark:text-gray-400';
  const value = parseFloat(pnl);
  if (isNaN(value)) return 'text-gray-500 dark:text-gray-400';
  if (value > 0) return 'text-green-500';
  if (value < 0) return 'text-red-500';
  return 'text-gray-500 dark:text-gray-400';
};
// ---------------------------------------------

function StatusDisplay({ botsRunning, onStart, onShutdown, onStatusUpdate }) {
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
                    sessionStats: data.session_stats
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
    <div className="bg-white dark:bg-gray-800 shadow-md rounded-lg p-6 mt-6">
      <h2 className="text-xl font-semibold mb-4 text-gray-900 dark:text-white">Bot Status</h2>
      
      <BotControls 
        botsRunning={botsRunning} 
        onStart={handleStart} // Usar el nuevo manejador
        onShutdown={onShutdown} 
      />
      
      {/* Mostrar el mensaje de error de inicio */}
      {startError && (
        <div className="my-4 p-3 bg-red-100 dark:bg-red-900/40 border border-red-400 dark:border-red-600 text-red-700 dark:text-red-300 rounded-md">
          <p className="font-semibold">Error al iniciar los bots:</p>
          <p className="text-sm">{startError}</p>
        </div>
      )}

      {/* Mostrar el mensaje de error de conexión/API */}
      {error && <p className="text-yellow-600 dark:text-yellow-400 mb-4 font-medium">{error}</p>}
      <div className="overflow-x-auto">
        {/* --- NUEVO INPUT PARA NÚMERO DE TRADES --- */}
        <div className="my-4 flex items-center">
          <label htmlFor="numTradesToShowInput" className="mr-2 text-sm font-medium text-gray-700 dark:text-gray-300">
            Mostrar últimos trades:
          </label>
          <input
            type="number"
            id="numTradesToShowInput"
            value={numTradesToShow}
            onChange={(e) => {
              const val = parseInt(e.target.value, 10);
              if (val > 0) { // Solo actualizar si es un número positivo
                setNumTradesToShow(val);
                // Opcional: Recargar historiales visibles si el número cambia
                // Object.keys(expandedRows).forEach(symbol => {
                //   if (expandedRows[symbol]) fetchTradeHistory(symbol);
                // });
              } else if (e.target.value === '') { // Permitir borrar para escribir nuevo número
                setNumTradesToShow('');
              }
            }}
            onBlur={(e) => { // Si el input queda vacío o inválido al perder foco, resetear a 2
              if (e.target.value === '' || parseInt(e.target.value, 10) <= 0) {
                setNumTradesToShow(2);
              }
            }}
            className="w-20 px-2 py-1 border border-gray-300 dark:border-gray-600 rounded-md shadow-sm focus:outline-none focus:ring-indigo-500 focus:border-indigo-500 sm:text-sm bg-white dark:bg-gray-700 text-gray-900 dark:text-gray-100 [appearance:textfield] [&::-webkit-outer-spin-button]:appearance-none [&::-webkit-inner-spin-button]:appearance-none"
            min="1"
          />
        </div>
        {/* ----------------------------------------- */}
        <table className="min-w-full divide-y divide-gray-200 dark:divide-gray-700">
          <thead className="bg-gray-50 dark:bg-gray-700">
            <tr>
              {/* --- NUEVA COLUMNA VACÍA PARA EL BOTÓN DE EXPANDIR --- */}
              <th scope="col" className="px-2 py-3 text-left text-xs font-medium text-gray-500 dark:text-gray-300 uppercase tracking-wider w-10"></th>
              <th scope="col" className="px-3 py-3 text-left text-xs font-medium text-gray-500 dark:text-gray-300 uppercase tracking-wider">Symbol</th>
              <th scope="col" className="px-3 py-3 text-left text-xs font-medium text-gray-500 dark:text-gray-300 uppercase tracking-wider">State</th>
              <th scope="col" className="px-3 py-3 text-left text-xs font-medium text-gray-500 dark:text-gray-300 uppercase tracking-wider">Current PnL</th>
              <th scope="col" className="px-3 py-3 text-left text-xs font-medium text-gray-500 dark:text-gray-300 uppercase tracking-wider">Hist. PnL</th>
               <th scope="col" className="px-2 py-3 text-left text-xs font-medium text-gray-500 dark:text-gray-300 uppercase tracking-wider">
                Pending Entry ID
              </th>
               <th scope="col" className="px-2 py-3 text-left text-xs font-medium text-gray-500 dark:text-gray-300 uppercase tracking-wider">
                Pending Exit ID
              </th>
              <th scope="col" className="px-2 py-3 text-left text-xs font-medium text-gray-500 dark:text-gray-300 uppercase tracking-wider">
                Pending TP ID
              </th>
              <th scope="col" className="px-2 py-3 text-left text-xs font-medium text-gray-500 dark:text-gray-300 uppercase tracking-wider">
                Pending SL ID
              </th>
              <th scope="col" className="px-3 py-3 text-left text-xs font-medium text-gray-500 dark:text-gray-300 uppercase tracking-wider">
                Last Error
              </th>
            </tr>
          </thead>
          <tbody>{/* <--- APERTURA DE TBODY */}
            {statuses.length > 0 ? (
              statuses.map((status) => (
                <React.Fragment key={status.symbol}>
                  <tr 
                    className={`border-b dark:border-gray-700 ${status.in_position ? 'bg-green-50 dark:bg-green-900/50 hover:bg-green-100 dark:hover:bg-green-800/60' : 'hover:bg-gray-50 dark:hover:bg-gray-700/50'} transition-colors duration-150`}
                    onClick={() => toggleRow(status.symbol)}
                  >
                    {/* --- CELDA CON BOTÓN DE EXPANDIR --- */}
                    <td className="px-2 py-3 whitespace-nowrap text-sm text-gray-500 dark:text-gray-400">
                      <button 
                        className="p-1 rounded hover:bg-gray-200 dark:hover:bg-gray-600 focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-indigo-500"
                        aria-expanded={!!expandedRows[status.symbol]}
                        aria-controls={`history-${status.symbol}`}
                      >
                        {expandedRows[status.symbol] ? '▼' : '▶'} {/* Flecha abajo/derecha */}
                      </button>
                    </td>
                    {/* --- Símbolo con botón de cierre X compacto a la izquierda si está en posición --- */}
                    <td className="px-3 py-3 whitespace-nowrap text-sm font-medium text-gray-900 dark:text-white">
                      <div className="flex items-center space-x-2">
                        {status.in_position && (
                          <button
                            onClick={(e) => handleCloseSinglePosition(e, status.symbol)}
                            disabled={closingSymbols[status.symbol]}
                            className="w-5 h-5 flex-shrink-0 flex items-center justify-center text-xs font-extrabold text-white bg-red-600 hover:bg-red-700 active:bg-red-800 rounded-full shadow transition-transform transform active:scale-95 disabled:bg-gray-400"
                            title={`Cerrar posición de ${status.symbol} a mercado en Binance`}
                          >
                            {closingSymbols[status.symbol] ? '..' : '✕'}
                          </button>
                        )}
                        <span>{status.symbol}</span>
                      </div>
                    </td>
                    <td className="px-3 py-3 whitespace-nowrap text-sm text-gray-500 dark:text-gray-300">
                     <span className={`px-2 inline-flex text-xs leading-5 font-semibold rounded-full ${
                         status.state === 'IN_POSITION' ? 'bg-green-100 text-green-800 dark:bg-green-900 dark:text-green-200' :
                         status.state === 'ERROR' ? 'bg-red-100 text-red-800 dark:bg-red-900 dark:text-red-200' :
                         status.state?.includes('WAITING') ? 'bg-yellow-100 text-yellow-800 dark:bg-yellow-900 dark:text-yellow-200' :
                         status.state === 'Inactive' ? 'bg-gray-100 text-gray-800 dark:bg-gray-600 dark:text-gray-300' : /* Estilo para Inactivo */
                         'bg-gray-100 text-gray-800 dark:bg-gray-700 dark:text-gray-200'
                     }`}>
                       {status.state || 'N/A'}
                     </span>
                    </td>
                    <td className="px-3 py-3 whitespace-nowrap text-sm">
                      <span className={`font-semibold ${getPnlColorClass(status.current_pnl)}`}>
                      {status.in_position ? formatPnl(status.current_pnl) : 'N/A'}
                      </span>
                    </td>
                    <td className="px-3 py-3 whitespace-nowrap text-sm">
                      <span className={`font-semibold ${getPnlColorClass(status.historical_pnl)}`}>
                      {formatPnl(status.historical_pnl)}
                      </span>
                    </td>
                     <td className="px-2 py-3 whitespace-nowrap text-sm text-gray-500 dark:text-gray-300">
                      {status.pending_entry_order_id ? 'SI' : ''}
                    </td>
                     <td className="px-2 py-3 whitespace-nowrap text-sm text-gray-500 dark:text-gray-300">
                      {status.pending_exit_order_id ? 'SI' : ''}
                    </td>
                    <td className="px-2 py-3 whitespace-nowrap text-sm text-gray-500 dark:text-gray-300">
                      {status.pending_tp_order_id ? 'SI' : ''}
                    </td>
                    <td className="px-2 py-3 whitespace-nowrap text-sm text-gray-500 dark:text-gray-300">
                      {status.pending_sl_order_id ? 'SI' : ''}
                    </td>
                    <td className="px-3 py-3 text-sm text-red-600 dark:text-red-400 truncate">
                      {status.last_error ? 'ERROR' : ''}
                    </td>
                  </tr>
                  {/* --- FILA DESPLEGABLE CONDICIONAL --- */}
                  {expandedRows[status.symbol] && (
                    <tr id={`history-${status.symbol}`}>
                      {/* Celda que ocupa todo el ancho */}
                      <td colSpan="10" className="px-2 py-2 bg-gray-50 dark:bg-gray-750">
                        {loadingHistories[status.symbol] && (
                          <p className="text-sm text-center text-gray-500 dark:text-gray-400">Loading history...</p>
                        )}
                        {historyErrors[status.symbol] && (
                          <p className="text-sm text-center text-red-600 dark:text-red-400">{historyErrors[status.symbol]}</p>
                        )}
                        {!loadingHistories[status.symbol] && !historyErrors[status.symbol] && (
                          tradeHistories[status.symbol]?.length > 0 ? (
                            <div className="overflow-x-auto">
                               <h4 className="text-sm font-semibold mb-2 text-gray-700 dark:text-gray-300">Last {tradeHistories[status.symbol].length} Trades for {status.symbol}:</h4>
                              <table className="min-w-full divide-y divide-gray-300 dark:divide-gray-600 text-xs">
                                <thead className="bg-gray-100 dark:bg-gray-700">
                                  <tr>
                                    <th className="px-2 py-1 text-left font-medium text-gray-600 dark:text-gray-300">Close Time</th>
                                    <th className="px-2 py-1 text-left font-medium text-gray-600 dark:text-gray-300">Reason</th>
                                    <th className="px-2 py-1 text-right font-medium text-gray-600 dark:text-gray-300">Entry Price</th>
                                    <th className="px-2 py-1 text-right font-medium text-gray-600 dark:text-gray-300">Close Price</th>
                                    <th className="px-2 py-1 text-right font-medium text-gray-600 dark:text-gray-300">Quantity</th>
                                    <th className="px-2 py-1 text-right font-medium text-gray-600 dark:text-gray-300">PnL</th>
                                    <th className="px-2 py-1 text-left font-medium text-gray-600 dark:text-gray-300">ID</th> 
                                  </tr>
                                </thead>
                                <tbody className="bg-white dark:bg-gray-800 divide-y divide-gray-200 dark:divide-gray-700">
                                  {tradeHistories[status.symbol].map(trade => (
                                    <tr key={trade.id} className="hover:bg-gray-50 dark:hover:bg-gray-600">
                                      <td className="px-2 py-1 whitespace-nowrap text-gray-700 dark:text-gray-300">{formatDate(trade.close_timestamp)}</td>
                                      <td className="px-2 py-1 whitespace-nowrap text-gray-700 dark:text-gray-300">{trade.close_reason || 'N/A'}</td>
                                      <td className="px-2 py-1 text-right whitespace-nowrap text-gray-700 dark:text-gray-300">{trade.open_price?.toFixed(4) ?? 'N/A'}</td>
                                      <td className="px-2 py-1 text-right whitespace-nowrap text-gray-700 dark:text-gray-300">{trade.close_price?.toFixed(4) ?? 'N/A'}</td>
                                      <td className="px-2 py-1 text-right whitespace-nowrap text-gray-700 dark:text-gray-300">{trade.quantity?.toFixed(4) ?? 'N/A'}</td>
                                      <td className={`px-2 py-1 text-right whitespace-nowrap ${getPnlColorClass(trade.pnl_usdt)}`}>
                                        {formatPnl(trade.pnl_usdt)}
                                      </td>
                                      <td className="px-2 py-1 whitespace-nowrap text-gray-700 dark:text-gray-300">{trade.id}</td>
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
                                     <span className="font-bold text-sm text-gray-700 dark:text-gray-300">
                                       Total PNL de la lista: 
                                       <span className={`ml-2 ${getPnlColorClass(totalHistoryPnl)}`}>
                                         {formatPnl(totalHistoryPnl)}
                                       </span>
                                     </span>
                                   </div>
                                 );
                               })()}
                            </div>
                          ) : (
                            <p className="text-sm text-center text-gray-500 dark:text-gray-400">No trade history found for {status.symbol}.</p>
                          )
                        )}
                      </td>
                    </tr>
                  )}
                </React.Fragment>
              ))
            ) : (
              <tr>
                <td colSpan="10" className="px-6 py-10 text-center text-sm text-gray-500 dark:text-gray-400">
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