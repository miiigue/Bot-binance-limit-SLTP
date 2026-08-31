import React, { useEffect, useState, useMemo } from 'react';

function PnLPerformanceChart({ symbolsList = [] }) {
  const [trades, setTrades] = useState([]);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState(null);
  const [filterSymbol, setFilterSymbol] = useState('ALL');
  const [accountStatus, setAccountStatus] = useState(null);

  const fetchTradesAndStatus = async () => {
    setIsLoading(true);
    setError(null);
    try {
      const [tradesResp, statusResp] = await Promise.all([
        fetch('/api/all_trades?limit=200'),
        fetch('/api/status')
      ]);

      if (tradesResp.ok) {
        const data = await tradesResp.json();
        setTrades(Array.isArray(data.trades) ? data.trades : []);
      }

      if (statusResp.ok) {
        const statusData = await statusResp.json();
        setAccountStatus(statusData);
      }
    } catch (err) {
      console.error('Error al cargar datos de rendimiento:', err);
      setError(err.message);
    } finally {
      setIsLoading(false);
    }
  };

  useEffect(() => {
    fetchTradesAndStatus();
  }, []);

  // Filtrar trades por símbolo si no es 'ALL'
  const filteredTrades = useMemo(() => {
    return filterSymbol === 'ALL'
      ? trades
      : trades.filter(t => t.symbol && t.symbol.toUpperCase() === filterSymbol.toUpperCase());
  }, [trades, filterSymbol]);

  // Métricas financieras calculadas
  const totalTrades = filteredTrades.length;
  const winningTrades = filteredTrades.filter(t => (t.pnl_usdt || 0) > 0);
  const losingTrades = filteredTrades.filter(t => (t.pnl_usdt || 0) < 0);
  const winRate = totalTrades > 0 ? ((winningTrades.length / totalTrades) * 100).toFixed(1) : '0.0';

  const grossProfit = winningTrades.reduce((acc, t) => acc + (parseFloat(t.pnl_usdt) || 0), 0);
  const grossLoss = Math.abs(losingTrades.reduce((acc, t) => acc + (parseFloat(t.pnl_usdt) || 0), 0));
  const netPnL = grossProfit - grossLoss;
  const profitFactor = grossLoss > 0 ? (grossProfit / grossLoss).toFixed(2) : (grossProfit > 0 ? '∞' : '1.00');

  const bestTrade = filteredTrades.length > 0
    ? Math.max(...filteredTrades.map(t => parseFloat(t.pnl_usdt) || 0))
    : 0;
  const worstTrade = filteredTrades.length > 0
    ? Math.min(...filteredTrades.map(t => parseFloat(t.pnl_usdt) || 0))
    : 0;

  // Construir puntos para la Curva de Capital (Cumulative Equity Curve)
  let runningTotal = 0;
  const equityPoints = filteredTrades.map((t, idx) => {
    runningTotal += parseFloat(t.pnl_usdt) || 0;
    return {
      index: idx + 1,
      symbol: t.symbol,
      pnl: parseFloat(t.pnl_usdt) || 0,
      cumulative: runningTotal,
      time: t.close_timestamp ? new Date(t.close_timestamp).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }) : `#${idx + 1}`
    };
  });

  // Cálculo de coordenadas SVG para el gráfico de curva
  const svgWidth = 800;
  const svgHeight = 220;
  const padding = { top: 20, right: 30, bottom: 30, left: 60 };

  const minEquity = equityPoints.length > 0 ? Math.min(0, ...equityPoints.map(p => p.cumulative)) : 0;
  const maxEquity = equityPoints.length > 0 ? Math.max(1, ...equityPoints.map(p => p.cumulative)) : 1;
  const equityRange = (maxEquity - minEquity) || 1;

  const getY = (val) => {
    const chartHeight = svgHeight - padding.top - padding.bottom;
    return padding.top + chartHeight - ((val - minEquity) / equityRange) * chartHeight;
  };

  const getX = (idx) => {
    const chartWidth = svgWidth - padding.left - padding.right;
    if (equityPoints.length <= 1) return padding.left + chartWidth / 2;
    return padding.left + (idx / (equityPoints.length - 1)) * chartWidth;
  };

  const zeroY = getY(0);

  // Path SVG de la curva
  const linePath = equityPoints.length > 0
    ? equityPoints.reduce((acc, pt, i) => `${acc} ${i === 0 ? 'M' : 'L'} ${getX(i)} ${getY(pt.cumulative)}`, '')
    : '';

  // Path SVG de área sombreada
  const areaPath = equityPoints.length > 0
    ? `${linePath} L ${getX(equityPoints.length - 1)} ${zeroY} L ${getX(0)} ${zeroY} Z`
    : '';

  // Exportar reporte a CSV
  const handleExportCSV = () => {
    if (filteredTrades.length === 0) {
      alert('No hay operaciones para exportar.');
      return;
    }

    const headers = [
      'ID',
      'Símbolo',
      'Tipo',
      'Fecha Apertura',
      'Fecha Cierre',
      'Precio Entrada',
      'Precio Salida',
      'Cantidad',
      'Tamaño USDT',
      'PnL Realizado USDT',
      'Razón Cierre'
    ];

    const rows = filteredTrades.map(t => [
      t.id || '',
      t.symbol || '',
      t.trade_type || 'LONG',
      t.open_timestamp ? `"${t.open_timestamp}"` : '',
      t.close_timestamp ? `"${t.close_timestamp}"` : '',
      t.open_price || 0,
      t.close_price || 0,
      t.quantity || 0,
      t.position_size_usdt || 0,
      t.pnl_usdt || 0,
      `"${t.close_reason || ''}"`
    ]);

    const csvContent = [headers.join(','), ...rows.map(e => e.join(','))].join('\n');
    const blob = new Blob([csvContent], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    const today = new Date().toISOString().split('T')[0];
    link.setAttribute('href', url);
    link.setAttribute('download', `reporte_trading_bot_${filterSymbol}_${today}.csv`);
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
  };

  // Cálculo de Exposición de Margen para el Donut Chart
  const portfolioDonutData = useMemo(() => {
    const activePositions = accountStatus?.statuses?.filter(s => s.in_position) || [];
    const colors = ['#10b981', '#3b82f6', '#f59e0b', '#8b5cf6', '#ec4899', '#06b6d4', '#14b8a6', '#f97316'];
    
    let allocatedMargin = 0;
    const slices = activePositions.map((pos, idx) => {
      // Estimar margen usado
      const entryPrice = parseFloat(pos.entry_price || pos.current_price || 1);
      const qty = parseFloat(pos.current_position || pos.position_size || 0);
      const margin = entryPrice > 0 && qty > 0 ? (entryPrice * qty) / 5 : 20; // default estimado
      allocatedMargin += margin;
      return {
        symbol: pos.symbol,
        margin: Math.max(1, margin),
        color: colors[idx % colors.length]
      };
    });

    const totalBalance = 1000; // Referencia base
    const freeMargin = Math.max(0, totalBalance - allocatedMargin);

    return {
      slices,
      allocatedMargin,
      freeMargin,
      totalPositions: activePositions.length
    };
  }, [accountStatus]);

  // Símbolos disponibles para filtrar
  const availableSymbols = Array.from(new Set(trades.map(t => t.symbol && t.symbol.toUpperCase()).filter(Boolean)));

  return (
    <div className="space-y-6">
      <div className="bg-white dark:bg-gray-900 border border-gray-200 dark:border-gray-800 rounded-2xl shadow-lg p-5 transition-all">
        {/* Cabecera */}
        <div className="flex flex-wrap items-center justify-between gap-3 pb-4 border-b border-gray-200 dark:border-gray-800">
          <div className="flex items-center space-x-2.5">
            <div className="p-2 bg-emerald-500/20 text-emerald-500 rounded-lg">
              <span className="text-xl">📈</span>
            </div>
            <div>
              <h2 className="text-base font-bold text-gray-900 dark:text-white flex items-center gap-2">
                Rendimiento Financiero y Curva de Capital (PnL)
                <span className={`text-xs px-2.5 py-0.5 rounded-full font-bold border ${
                  netPnL >= 0 
                    ? 'bg-emerald-500/20 text-emerald-400 border-emerald-500/30' 
                    : 'bg-rose-500/20 text-rose-400 border-rose-500/30'
                }`}>
                  {netPnL >= 0 ? `+${netPnL.toFixed(4)} USDT` : `${netPnL.toFixed(4)} USDT`}
                </span>
              </h2>
              <p className="text-xs text-gray-500 dark:text-gray-400">
                Evolución acumulada de ganancias trade por trade, tasa de acierto y estadísticas avanzadas.
              </p>
            </div>
          </div>

          {/* Filtro, Exportar CSV y Botón de Recarga */}
          <div className="flex flex-wrap items-center gap-2">
            {availableSymbols.length > 0 && (
              <select
                value={filterSymbol}
                onChange={(e) => setFilterSymbol(e.target.value)}
                className="text-xs py-1.5 px-3 bg-gray-100 dark:bg-gray-800 border border-gray-200 dark:border-gray-700 rounded-lg font-semibold text-gray-800 dark:text-gray-200 focus:ring-2 focus:ring-primary-500"
              >
                <option value="ALL">🪙 Todas las Monedas ({trades.length})</option>
                {availableSymbols.map(sym => (
                  <option key={sym} value={sym}>{sym}</option>
                ))}
              </select>
            )}

            <button
              type="button"
              onClick={handleExportCSV}
              className="px-3 py-1.5 bg-emerald-600 hover:bg-emerald-500 text-white text-xs font-bold rounded-lg shadow transition flex items-center gap-1.5 active:scale-95"
              title="Descargar historial completo en formato CSV para Excel"
            >
              <span>📥</span> Exportar CSV
            </button>

            <button
              type="button"
              onClick={fetchTradesAndStatus}
              disabled={isLoading}
              className="p-1.5 bg-gray-100 dark:bg-gray-800 hover:bg-gray-200 dark:hover:bg-gray-700 text-gray-700 dark:text-gray-300 rounded-lg border border-gray-200 dark:border-gray-700 transition"
              title="Actualizar datos"
            >
              🔄
            </button>
          </div>
        </div>

        {/* Tarjetas de Métricas Clave (KPIs) */}
        <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-3 my-4">
          <div className="p-3 bg-gray-50 dark:bg-gray-800/60 rounded-xl border border-gray-200 dark:border-gray-700/80">
            <span className="text-[11px] font-semibold text-gray-500 dark:text-gray-400 uppercase tracking-wider block">
              🎯 Tasa de Acierto
            </span>
            <span className={`text-xl font-bold font-mono ${parseFloat(winRate) >= 50 ? 'text-emerald-500' : 'text-amber-500'}`}>
              {winRate}%
            </span>
            <span className="text-[10px] text-gray-400 block mt-0.5">
              {winningTrades.length}W / {losingTrades.length}L
            </span>
          </div>

          <div className="p-3 bg-gray-50 dark:bg-gray-800/60 rounded-xl border border-gray-200 dark:border-gray-700/80">
            <span className="text-[11px] font-semibold text-gray-500 dark:text-gray-400 uppercase tracking-wider block">
              💰 PnL Realizado
            </span>
            <span className={`text-xl font-bold font-mono ${netPnL >= 0 ? 'text-emerald-500' : 'text-rose-500'}`}>
              {netPnL >= 0 ? `+${netPnL.toFixed(2)}` : netPnL.toFixed(2)} <span className="text-xs">USDT</span>
            </span>
            <span className="text-[10px] text-gray-400 block mt-0.5">
              {totalTrades} trades cerrados
            </span>
          </div>

          <div className="p-3 bg-gray-50 dark:bg-gray-800/60 rounded-xl border border-gray-200 dark:border-gray-700/80">
            <span className="text-[11px] font-semibold text-gray-500 dark:text-gray-400 uppercase tracking-wider block">
              ⚖️ Profit Factor
            </span>
            <span className="text-xl font-bold font-mono text-blue-500">
              {profitFactor}
            </span>
            <span className="text-[10px] text-gray-400 block mt-0.5">
              Ganancia / Pérdida
            </span>
          </div>

          <div className="p-3 bg-gray-50 dark:bg-gray-800/60 rounded-xl border border-gray-200 dark:border-gray-700/80">
            <span className="text-[11px] font-semibold text-gray-500 dark:text-gray-400 uppercase tracking-wider block">
              🟢 Ganancia Bruta
            </span>
            <span className="text-xl font-bold font-mono text-emerald-500">
              +{grossProfit.toFixed(2)} <span className="text-xs">USDT</span>
            </span>
            <span className="text-[10px] text-gray-400 block mt-0.5">
              en trades ganadores
            </span>
          </div>

          <div className="p-3 bg-gray-50 dark:bg-gray-800/60 rounded-xl border border-gray-200 dark:border-gray-700/80">
            <span className="text-[11px] font-semibold text-gray-500 dark:text-gray-400 uppercase tracking-wider block">
              🏆 Mejor Ganancia
            </span>
            <span className="text-xl font-bold font-mono text-emerald-500">
              +{bestTrade.toFixed(2)} <span className="text-xs">USDT</span>
            </span>
            <span className="text-[10px] text-gray-400 block mt-0.5">
              Mejor trade individual
            </span>
          </div>

          <div className="p-3 bg-gray-50 dark:bg-gray-800/60 rounded-xl border border-gray-200 dark:border-gray-700/80">
            <span className="text-[11px] font-semibold text-gray-500 dark:text-gray-400 uppercase tracking-wider block">
              🛑 Mayor Pérdida
            </span>
            <span className="text-xl font-bold font-mono text-rose-500">
              {worstTrade.toFixed(2)} <span className="text-xs">USDT</span>
            </span>
            <span className="text-[10px] text-gray-400 block mt-0.5">
              Stop Loss máximo
            </span>
          </div>
        </div>

        {/* Gráfico SVG de la Curva de Capital (Equity Curve) */}
        {equityPoints.length > 1 ? (
          <div className="mt-4 p-4 bg-gray-950 rounded-xl border border-gray-800 relative">
            <div className="flex items-center justify-between px-2 mb-2">
              <span className="text-xs font-bold text-gray-300">
                📈 Curva de Capital Acumulado ({equityPoints.length} operaciones)
              </span>
              <span className="text-xs font-mono text-emerald-400">
                Balance Inicial: 0.00 USDT → Final: {runningTotal.toFixed(4)} USDT
              </span>
            </div>

            <div className="w-full overflow-x-auto">
              <svg viewBox={`0 0 ${svgWidth} ${svgHeight}`} className="w-full h-auto max-h-56">
                <defs>
                  <linearGradient id="equityGradient" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="0%" stopColor="#10b981" stopOpacity="0.45" />
                    <stop offset="100%" stopColor="#10b981" stopOpacity="0.0" />
                  </linearGradient>
                </defs>

                <line
                  x1={padding.left}
                  y1={zeroY}
                  x2={svgWidth - padding.right}
                  y2={zeroY}
                  stroke="#475569"
                  strokeDasharray="4 4"
                  strokeWidth="1.5"
                />

                {areaPath && (
                  <path d={areaPath} fill="url(#equityGradient)" />
                )}

                {linePath && (
                  <path
                    d={linePath}
                    fill="none"
                    stroke={netPnL >= 0 ? '#10b981' : '#f43f5e'}
                    strokeWidth="2.5"
                    strokeLinecap="round"
                    strokeLinejoin="round"
                  />
                )}

                {equityPoints.map((pt, i) => (
                  <g key={i} className="group cursor-pointer">
                    <circle
                      cx={getX(i)}
                      cy={getY(pt.cumulative)}
                      r={equityPoints.length > 50 ? 2 : 3.5}
                      fill={pt.pnl >= 0 ? '#10b981' : '#f43f5e'}
                      stroke="#0f172a"
                      strokeWidth="1.5"
                    />
                    <title>{`${pt.symbol} (Trade #${pt.index}): ${pt.pnl >= 0 ? '+' : ''}${pt.pnl.toFixed(4)} USDT | Acumulado: ${pt.cumulative.toFixed(4)} USDT`}</title>
                  </g>
                ))}

                <text x={padding.left - 8} y={getY(maxEquity) + 4} fill="#94a3b8" fontSize="10" textAnchor="end">
                  +{maxEquity.toFixed(2)}
                </text>
                <text x={padding.left - 8} y={zeroY + 4} fill="#cbd5e1" fontSize="10" textAnchor="end">
                  0.00
                </text>
                {minEquity < 0 && (
                  <text x={padding.left - 8} y={getY(minEquity) + 4} fill="#f87171" fontSize="10" textAnchor="end">
                    {minEquity.toFixed(2)}
                  </text>
                )}
              </svg>
            </div>

            {/* Histograma de Barras de Cada Trade */}
            <div className="mt-3 pt-3 border-t border-gray-800">
              <span className="text-[11px] font-semibold text-gray-400 block mb-1">
                📊 Distribución de PnL por Operación Individual:
              </span>
              <div className="flex items-end gap-1 h-16 w-full px-2">
                {filteredTrades.slice(-40).map((t, idx) => {
                  const pnl = parseFloat(t.pnl_usdt) || 0;
                  const isWin = pnl >= 0;
                  const maxAbs = Math.max(0.1, ...filteredTrades.map(tr => Math.abs(parseFloat(tr.pnl_usdt) || 0)));
                  const heightPct = Math.min(100, Math.max(12, (Math.abs(pnl) / maxAbs) * 100));

                  return (
                    <div
                      key={idx}
                      className="flex-1 flex flex-col justify-end items-center group relative h-full"
                    >
                      <div
                        style={{ height: `${heightPct}%` }}
                        className={`w-full rounded-t transition-all ${
                          isWin ? 'bg-emerald-500 hover:bg-emerald-400' : 'bg-rose-500 hover:bg-rose-400'
                        }`}
                      />
                      <div className="hidden group-hover:block absolute bottom-full mb-1 z-30 bg-gray-900 text-white text-[10px] rounded px-2 py-1 shadow-lg whitespace-nowrap border border-gray-700 pointer-events-none">
                        <span className="font-bold">{t.symbol}</span>: {isWin ? `+${pnl.toFixed(4)}` : pnl.toFixed(4)} USDT
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>
          </div>
        ) : (
          <div className="py-8 text-center bg-gray-50 dark:bg-gray-800/40 rounded-xl border border-dashed border-gray-300 dark:border-gray-700">
            <p className="text-sm font-semibold text-gray-600 dark:text-gray-300">
              {totalTrades === 0 ? 'No hay operaciones cerradas registradas todavía.' : 'Se necesita al menos 2 operaciones para graficar la curva.'}
            </p>
            <p className="text-xs text-gray-400 mt-1">
              En cuanto el bot cierre sus primeros trades, la curva de capital y el histograma se dibujarán aquí en tiempo real.
            </p>
          </div>
        )}
      </div>

      {/* 🍩 Gráfico Donut de Exposición de Margen y Riesgo de Cartera */}
      <div className="bg-white dark:bg-gray-900 border border-gray-200 dark:border-gray-800 rounded-2xl shadow-lg p-5 transition-all">
        <div className="flex items-center space-x-2.5 pb-3 border-b border-gray-200 dark:border-gray-800">
          <div className="p-2 bg-yellow-400/20 text-yellow-500 rounded-lg">
            <span className="text-xl">🍩</span>
          </div>
          <div>
            <h3 className="text-base font-bold text-gray-900 dark:text-white">
              Distribución de Margen y Exposición de Cartera
            </h3>
            <p className="text-xs text-gray-500 dark:text-gray-400">
              Visualiza en tiempo real qué porcentaje de tu capital está colocado en cada moneda activa.
            </p>
          </div>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-2 gap-6 items-center mt-4">
          {/* Anillo SVG */}
          <div className="flex justify-center items-center relative">
            <svg viewBox="0 0 160 160" className="w-44 h-44 transform -rotate-90">
              {/* Círculo base de fondo */}
              <circle cx="80" cy="80" r="60" fill="transparent" stroke="#1e293b" strokeWidth="24" />
              
              {/* Segmentos de monedas */}
              {portfolioDonutData.slices.length > 0 ? (
                (() => {
                  let accumulatedPercent = 0;
                  const total = portfolioDonutData.slices.reduce((a, b) => a + b.margin, 0);
                  const circumference = 2 * Math.PI * 60; // ~376.99
                  
                  return portfolioDonutData.slices.map((slice, idx) => {
                    const pct = total > 0 ? (slice.margin / total) : 0;
                    const strokeDasharray = `${pct * circumference} ${circumference}`;
                    const strokeDashoffset = -accumulatedPercent * circumference;
                    accumulatedPercent += pct;

                    return (
                      <circle
                        key={idx}
                        cx="80"
                        cy="80"
                        r="60"
                        fill="transparent"
                        stroke={slice.color}
                        strokeWidth="24"
                        strokeDasharray={strokeDasharray}
                        strokeDashoffset={strokeDashoffset}
                        className="transition-all duration-500"
                      />
                    );
                  });
                })()
              ) : (
                <circle cx="80" cy="80" r="60" fill="transparent" stroke="#10b981" strokeWidth="24" opacity="0.4" />
              )}
            </svg>

            {/* Texto en el centro del Donut */}
            <div className="absolute flex flex-col items-center justify-center text-center pointer-events-none">
              <span className="text-xs text-gray-400 font-semibold uppercase">Posiciones</span>
              <span className="text-xl font-extrabold text-white font-mono">
                {portfolioDonutData.totalPositions}
              </span>
              <span className="text-[10px] text-emerald-400 font-mono">
                {portfolioDonutData.totalPositions > 0 ? 'Activas' : 'Esperando'}
              </span>
            </div>
          </div>

          {/* Leyenda y Desglose */}
          <div className="space-y-2.5">
            <h4 className="text-xs font-bold text-gray-400 uppercase tracking-wider mb-2">
              Desglose de Monedas en Posición:
            </h4>
            {portfolioDonutData.slices.length > 0 ? (
              <div className="grid grid-cols-2 gap-2">
                {portfolioDonutData.slices.map((slice, i) => (
                  <div key={i} className="flex items-center space-x-2 bg-gray-50 dark:bg-gray-800/60 p-2 rounded-lg border border-gray-200 dark:border-gray-700/60">
                    <span className="w-3 h-3 rounded-full flex-shrink-0" style={{ backgroundColor: slice.color }} />
                    <div className="min-w-0">
                      <span className="text-xs font-bold text-gray-900 dark:text-white truncate block font-mono">{slice.symbol}</span>
                      <span className="text-[10px] text-gray-400 block font-mono">Margen: ~{slice.margin.toFixed(0)} USDT</span>
                    </div>
                  </div>
                ))}
              </div>
            ) : (
              <p className="text-xs text-gray-500 py-4">
                Actualmente no hay posiciones abiertas. El 100% de tu saldo está libre en USDT.
              </p>
            )}

            <div className="pt-3 border-t border-gray-200 dark:border-gray-800 flex items-center justify-between text-xs">
              <span className="text-gray-500 dark:text-gray-400">🛡️ Estado del Gestor de Riesgo:</span>
              <span className="font-bold text-emerald-500 font-mono">NORMAL (Protección Activa)</span>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

export default PnLPerformanceChart;
