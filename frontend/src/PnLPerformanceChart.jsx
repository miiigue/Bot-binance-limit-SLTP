import React, { useEffect, useState, useMemo } from 'react';

function PnLPerformanceChart({ symbolsList = [] }) {
  const [trades, setTrades] = useState([]);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState(null);
  const [filterSymbol, setFilterSymbol] = useState('ALL');
  const [accountStatus, setAccountStatus] = useState(null);

  // Estado del Monitor de Riesgo y Billetera Binance
  const [riskData, setRiskData] = useState(null);
  const [riskPercentageInput, setRiskPercentageInput] = useState('50');
  const [isSavingRisk, setIsSavingRisk] = useState(false);
  const [riskFeedback, setRiskFeedback] = useState(null);

  // Ordenamiento para el Gráfico de Rendimiento por Moneda
  // 'PNL_DESC' (Mayor a menor), 'PNL_ASC' (Menor a mayor), 'WINRATE_DESC', 'TRADES_DESC', 'ALPHA'
  const [coinSortOrder, setCoinSortOrder] = useState('PNL_DESC');

  // Cargar datos financieros y de billetera
  const fetchAllData = async () => {
    setIsLoading(true);
    setError(null);
    try {
      const [tradesResp, statusResp, riskResp] = await Promise.all([
        fetch('/api/all_trades?limit=500'),
        fetch('/api/status'),
        fetch('/api/risk_config')
      ]);

      if (tradesResp.ok) {
        const data = await tradesResp.json();
        setTrades(Array.isArray(data.trades) ? data.trades : []);
      }

      if (statusResp.ok) {
        const statusData = await statusResp.json();
        setAccountStatus(statusData);
      }

      if (riskResp.ok) {
        const riskJson = await riskResp.json();
        setRiskData(riskJson);
        if (riskJson.risk_percentage_raw !== undefined) {
          setRiskPercentageInput(String(riskJson.risk_percentage_raw));
        } else if (riskJson.risk_percentage) {
          setRiskPercentageInput(riskJson.risk_percentage.replace('%', '').trim());
        }
      }
    } catch (err) {
      console.error('Error al cargar datos financieros:', err);
      setError(err.message);
    } finally {
      setIsLoading(false);
    }
  };

  useEffect(() => {
    fetchAllData();
    // Refresco periódico del monitor de riesgo y saldo cada 5 segundos
    const intervalId = setInterval(async () => {
      try {
        const riskResp = await fetch('/api/risk_config');
        if (riskResp.ok) {
          const riskJson = await riskResp.json();
          setRiskData(riskJson);
        }
      } catch (e) {
        // silencioso en polling
      }
    }, 5000);

    return () => clearInterval(intervalId);
  }, []);

  // Guardar nuevo % máximo de riesgo
  const handleSaveRiskLimit = async (e) => {
    e?.preventDefault();
    const val = parseFloat(riskPercentageInput);
    if (isNaN(val) || val < 1 || val > 100) {
      setRiskFeedback({ type: 'error', msg: 'El porcentaje debe estar entre 1% y 100%.' });
      return;
    }

    setIsSavingRisk(true);
    setRiskFeedback(null);
    try {
      const resp = await fetch('/api/risk_config', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ risk_percentage: val })
      });

      if (resp.ok) {
        setRiskFeedback({ type: 'success', msg: `Límite actualizado al ${val}% con éxito.` });
        fetchAllData();
        setTimeout(() => setRiskFeedback(null), 4000);
      } else {
        const errJson = await resp.json();
        setRiskFeedback({ type: 'error', msg: errJson.error || 'Error al guardar.' });
      }
    } catch (err) {
      setRiskFeedback({ type: 'error', msg: err.message });
    } finally {
      setIsSavingRisk(false);
    }
  };

  // Filtrar trades por símbolo
  const filteredTrades = useMemo(() => {
    return filterSymbol === 'ALL'
      ? trades
      : trades.filter(t => t.symbol && t.symbol.toUpperCase() === filterSymbol.toUpperCase());
  }, [trades, filterSymbol]);

  // Métricas financieras calculadas
  const totalTrades = filteredTrades.length;
  const winningTrades = filteredTrades.filter(t => (parseFloat(t.pnl_usdt) || 0) > 0);
  const losingTrades = filteredTrades.filter(t => (parseFloat(t.pnl_usdt) || 0) < 0);
  const winRate = totalTrades > 0 ? ((winningTrades.length / totalTrades) * 100).toFixed(1) : '0.0';

  const grossProfit = winningTrades.reduce((acc, t) => acc + (parseFloat(t.pnl_usdt) || 0), 0);
  const grossLoss = Math.abs(losingTrades.reduce((acc, t) => acc + (parseFloat(t.pnl_usdt) || 0), 0));
  const netPnL = grossProfit - grossLoss;
  const profitFactor = grossLoss > 0 ? (grossProfit / grossLoss).toFixed(2) : (grossProfit > 0 ? '∞' : '1.00');

  const avgWin = winningTrades.length > 0 ? grossProfit / winningTrades.length : 0;
  const avgLoss = losingTrades.length > 0 ? grossLoss / losingTrades.length : 0;
  const realizedRiskReward = avgLoss > 0 ? (avgWin / avgLoss).toFixed(2) : (avgWin > 0 ? '∞' : '1.00');

  const bestTrade = filteredTrades.length > 0
    ? Math.max(...filteredTrades.map(t => parseFloat(t.pnl_usdt) || 0))
    : 0;
  const worstTrade = filteredTrades.length > 0
    ? Math.min(...filteredTrades.map(t => parseFloat(t.pnl_usdt) || 0))
    : 0;

  // Curva de Capital (Cumulative Equity) y Maximum Drawdown (MDD)
  const { equityPoints, maxDrawdownUSDT, maxDrawdownPercent } = useMemo(() => {
    let runningTotal = 0;
    let peak = 0;
    let maxDD = 0;

    const points = filteredTrades.map((t, idx) => {
      const pnl = parseFloat(t.pnl_usdt) || 0;
      runningTotal += pnl;
      if (runningTotal > peak) peak = runningTotal;
      const currentDD = peak - runningTotal;
      if (currentDD > maxDD) maxDD = currentDD;

      return {
        index: idx + 1,
        symbol: t.symbol,
        pnl,
        cumulative: runningTotal,
        time: t.close_timestamp ? new Date(t.close_timestamp).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }) : `#${idx + 1}`
      };
    });

    const totalBalanceRef = riskData ? parseFloat(riskData.total_balance) || 1000 : 1000;
    const maxDDPct = totalBalanceRef > 0 ? ((maxDD / totalBalanceRef) * 100).toFixed(2) : '0.00';

    return {
      equityPoints: points,
      maxDrawdownUSDT: maxDD,
      maxDrawdownPercent: maxDDPct
    };
  }, [filteredTrades, riskData]);

  // SVG Dimensiones y Escalas
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

  const linePath = equityPoints.length > 0
    ? equityPoints.reduce((acc, pt, i) => `${acc} ${i === 0 ? 'M' : 'L'} ${getX(i)} ${getY(pt.cumulative)}`, '')
    : '';

  const areaPath = equityPoints.length > 0
    ? `${linePath} L ${getX(equityPoints.length - 1)} ${zeroY} L ${getX(0)} ${zeroY} Z`
    : '';

  // ========================================================
  // DESGLOSE Y RANKING POR CRIPTOMONEDA (CON ORDENAMIENTO)
  // ========================================================
  const coinPerformanceList = useMemo(() => {
    const map = {};

    trades.forEach(t => {
      const sym = (t.symbol || 'DESCONOCIDO').toUpperCase();
      const pnl = parseFloat(t.pnl_usdt) || 0;

      if (!map[sym]) {
        map[sym] = {
          symbol: sym,
          totalPnL: 0,
          tradesCount: 0,
          wins: 0,
          losses: 0,
          bestTrade: -Infinity,
          worstTrade: Infinity
        };
      }

      map[sym].totalPnL += pnl;
      map[sym].tradesCount += 1;
      if (pnl > 0) map[sym].wins += 1;
      if (pnl < 0) map[sym].losses += 1;
      if (pnl > map[sym].bestTrade) map[sym].bestTrade = pnl;
      if (pnl < map[sym].worstTrade) map[sym].worstTrade = pnl;
    });

    const list = Object.values(map).map(c => ({
      ...c,
      winRate: c.tradesCount > 0 ? ((c.wins / c.tradesCount) * 100).toFixed(1) : '0.0',
      bestTrade: c.bestTrade === -Infinity ? 0 : c.bestTrade,
      worstTrade: c.worstTrade === Infinity ? 0 : c.worstTrade
    }));

    // Aplicar ordenamiento interactivo
    list.sort((a, b) => {
      if (coinSortOrder === 'PNL_DESC') return b.totalPnL - a.totalPnL; // Mayor a menor
      if (coinSortOrder === 'PNL_ASC') return a.totalPnL - b.totalPnL;  // Menor a mayor
      if (coinSortOrder === 'WINRATE_DESC') return parseFloat(b.winRate) - parseFloat(a.winRate);
      if (coinSortOrder === 'TRADES_DESC') return b.tradesCount - a.tradesCount;
      if (coinSortOrder === 'ALPHA') return a.symbol.localeCompare(b.symbol);
      return b.totalPnL - a.totalPnL;
    });

    return list;
  }, [trades, coinSortOrder]);

  const maxAbsCoinPnL = useMemo(() => {
    if (coinPerformanceList.length === 0) return 1;
    return Math.max(0.1, ...coinPerformanceList.map(c => Math.abs(c.totalPnL)));
  }, [coinPerformanceList]);

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

  // Donut de margen de cartera
  const portfolioDonutData = useMemo(() => {
    const activePositions = accountStatus?.statuses?.filter(s => s.in_position) || [];
    const colors = ['#10b981', '#3b82f6', '#f59e0b', '#8b5cf6', '#ec4899', '#06b6d4', '#14b8a6', '#f97316'];
    
    let allocatedMargin = 0;
    const slices = activePositions.map((pos, idx) => {
      const entryPrice = parseFloat(pos.entry_price || pos.current_price || 1);
      const qty = parseFloat(pos.current_position || pos.position_size || 0);
      const margin = entryPrice > 0 && qty > 0 ? (entryPrice * qty) / 10 : 25;
      allocatedMargin += margin;
      return {
        symbol: pos.symbol,
        margin: Math.max(1, margin),
        color: colors[idx % colors.length]
      };
    });

    const totalBalance = riskData ? parseFloat(riskData.total_balance) || 1000 : 1000;
    const freeMargin = Math.max(0, totalBalance - allocatedMargin);

    return {
      slices,
      allocatedMargin,
      freeMargin,
      totalPositions: activePositions.length
    };
  }, [accountStatus, riskData]);

  // Lista única de símbolos
  const availableSymbols = Array.from(new Set(trades.map(t => t.symbol && t.symbol.toUpperCase()).filter(Boolean)));

  // Cálculos de la barra de estrés de riesgo
  const totalBalanceNum = riskData ? parseFloat(riskData.total_balance) || 0 : 0;
  const currentExpNum = riskData ? parseFloat(riskData.current_exposure) || 0 : 0;
  const maxExpNum = riskData ? parseFloat(riskData.max_exposure) || 0 : 0;
  const freeMarginNum = riskData && riskData.free_margin ? parseFloat(riskData.free_margin) : Math.max(0, totalBalanceNum - currentExpNum);

  // Porcentaje de la exposición actual respecto al límite máximo autorizado
  const stressRatio = maxExpNum > 0 ? Math.min(100, (currentExpNum / maxExpNum) * 100) : 0;
  const stressColor = stressRatio > 80 ? 'bg-rose-500' : stressRatio > 50 ? 'bg-amber-500' : 'bg-emerald-500';
  const stressBorder = stressRatio > 80 ? 'border-rose-500/50 text-rose-400' : stressRatio > 50 ? 'border-amber-500/50 text-amber-400' : 'border-emerald-500/50 text-emerald-400';
  const stressLabel = stressRatio > 80 ? 'ALTO RIESGO' : stressRatio > 50 ? 'MODERADO' : 'SEGURO';

  return (
    <div className="space-y-6">

      {/* ======================================================== */}
      {/* 1. MONITOR DE BILLETERA & GESTIÓN DE RIESGO BINANCE (MOVIDO Y MEJORADO) */}
      {/* ======================================================== */}
      <div className="bg-gradient-to-br from-gray-900 via-gray-900 to-slate-900 border border-indigo-900/50 rounded-2xl shadow-2xl p-5 relative overflow-hidden">
        {/* Glow de fondo decorativo */}
        <div className="absolute -top-24 -right-24 w-72 h-72 bg-indigo-600/10 rounded-full blur-3xl pointer-events-none" />
        
        <div className="flex flex-wrap items-center justify-between gap-3 pb-4 border-b border-gray-800 relative z-10">
          <div className="flex items-center space-x-3">
            <div className="p-2.5 bg-indigo-500/20 text-indigo-400 rounded-xl border border-indigo-500/30 shadow-inner">
              <span className="text-2xl">🛡️</span>
            </div>
            <div>
              <div className="flex items-center gap-2">
                <h2 className="text-base font-bold text-white tracking-wide">
                  Monitor de Billetera Binance & Salud de Margen
                </h2>
                <span className="text-[10px] px-2 py-0.5 rounded-full font-bold bg-emerald-950 text-emerald-300 border border-emerald-800 flex items-center gap-1">
                  <span className="w-1.5 h-1.5 rounded-full bg-emerald-400 animate-pulse"></span>
                  Futures Testnet Live
                </span>
              </div>
              <p className="text-xs text-gray-400 mt-0.5">
                Datos en tiempo real de tu cuenta: balance disponible, capital comprometido y protección contra liquidación.
              </p>
            </div>
          </div>

          <button
            type="button"
            onClick={fetchAllData}
            disabled={isLoading}
            className="px-3 py-1.5 bg-gray-800 hover:bg-gray-700 text-gray-200 text-xs font-semibold rounded-lg border border-gray-700 transition flex items-center gap-1.5 active:scale-95"
          >
            <span>🔄</span> Actualizar Datos
          </button>
        </div>

        {/* 4 Tarjetas Financieras Principales */}
        <div className="grid grid-cols-2 lg:grid-cols-4 gap-3.5 my-4 relative z-10">
          
          {/* Balance Total */}
          <div className="bg-gray-800/80 border border-gray-700/80 rounded-xl p-3.5 flex flex-col justify-between shadow-md">
            <div className="flex items-center justify-between text-gray-400 text-xs mb-1">
              <span className="font-semibold uppercase tracking-wider text-[11px]">💰 Balance Total</span>
              <span className="text-gray-500">USDT</span>
            </div>
            <div className="text-2xl font-black font-mono text-white tracking-tight">
              ${totalBalanceNum.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
            </div>
            <div className="text-[11px] text-gray-400 mt-1 flex items-center justify-between">
              <span>Saldo Cuenta</span>
              <span className="text-indigo-400 font-semibold font-mono">100% Capital</span>
            </div>
          </div>

          {/* Margen Ocupado / Exposición Actual */}
          <div className="bg-gray-800/80 border border-gray-700/80 rounded-xl p-3.5 flex flex-col justify-between shadow-md">
            <div className="flex items-center justify-between text-gray-400 text-xs mb-1">
              <span className="font-semibold uppercase tracking-wider text-[11px]">🔒 Margen en Uso</span>
              <span className={`text-[10px] px-1.5 py-0.2 rounded font-bold border ${stressBorder}`}>
                {stressLabel}
              </span>
            </div>
            <div className="text-2xl font-black font-mono text-amber-400 tracking-tight">
              ${currentExpNum.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
            </div>
            <div className="text-[11px] text-gray-400 mt-1 flex items-center justify-between">
              <span>Ocupado en trades</span>
              <span className="text-amber-300 font-semibold font-mono">
                {totalBalanceNum > 0 ? ((currentExpNum / totalBalanceNum) * 100).toFixed(1) : 0}% del saldo
              </span>
            </div>
          </div>

          {/* Margen Libre / Disponible */}
          <div className="bg-gray-800/80 border border-gray-700/80 rounded-xl p-3.5 flex flex-col justify-between shadow-md">
            <div className="flex items-center justify-between text-gray-400 text-xs mb-1">
              <span className="font-semibold uppercase tracking-wider text-[11px]">🟢 Margen Libre</span>
              <span className="text-emerald-400 text-[10px] font-bold">Disponible</span>
            </div>
            <div className="text-2xl font-black font-mono text-emerald-400 tracking-tight">
              ${freeMarginNum.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
            </div>
            <div className="text-[11px] text-gray-400 mt-1 flex items-center justify-between">
              <span>Listo para operar</span>
              <span className="text-emerald-300 font-semibold font-mono">
                {totalBalanceNum > 0 ? ((freeMarginNum / totalBalanceNum) * 100).toFixed(1) : 100}% libre
              </span>
            </div>
          </div>

          {/* Límite Máximo Autorizado */}
          <div className="bg-gray-800/80 border border-gray-700/80 rounded-xl p-3.5 flex flex-col justify-between shadow-md">
            <div className="flex items-center justify-between text-gray-400 text-xs mb-1">
              <span className="font-semibold uppercase tracking-wider text-[11px]">🛡️ Límite Autorizado</span>
              <span className="text-purple-300 text-[10px] font-mono font-bold">
                {riskData?.risk_percentage || `${riskPercentageInput}%`}
              </span>
            </div>
            <div className="text-2xl font-black font-mono text-purple-300 tracking-tight">
              ${maxExpNum.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
            </div>
            <div className="text-[11px] text-gray-400 mt-1 flex items-center justify-between">
              <span>Tope de seguridad</span>
              <span className="text-purple-400 font-semibold font-mono">Bloqueo automático</span>
            </div>
          </div>

        </div>

        {/* Barra de Estrés y Ajuste Rápido de Riesgo */}
        <div className="mt-4 pt-3 border-t border-gray-800/80 flex flex-col md:flex-row items-stretch md:items-center justify-between gap-4 relative z-10">
          
          {/* Barra de Progreso */}
          <div className="flex-1 space-y-1.5">
            <div className="flex items-center justify-between text-xs text-gray-300">
              <span className="font-semibold flex items-center gap-1.5">
                <span>Nivel de Utilización de Margen:</span>
                <span className="font-mono text-white font-bold">{stressRatio.toFixed(1)}% del límite</span>
              </span>
              <span className="text-gray-400 text-[11px] font-mono">
                ${currentExpNum.toFixed(2)} de ${maxExpNum.toFixed(2)} USDT max
              </span>
            </div>
            <div className="w-full bg-gray-950 rounded-full h-3.5 p-0.5 border border-gray-800 relative overflow-hidden">
              <div
                className={`h-full rounded-full transition-all duration-700 ${stressColor}`}
                style={{ width: `${stressRatio}%` }}
              />
            </div>
          </div>

          {/* Formulario de Ajuste de Límite */}
          <form onSubmit={handleSaveRiskLimit} className="flex items-center gap-2 flex-shrink-0 bg-gray-950/70 p-2 rounded-xl border border-gray-800">
            <label htmlFor="riskInput" className="text-xs text-gray-300 font-medium whitespace-nowrap pl-1">
              Ajustar Límite:
            </label>
            <div className="relative w-20">
              <input
                id="riskInput"
                type="number"
                min="1"
                max="100"
                value={riskPercentageInput}
                onChange={(e) => setRiskPercentageInput(e.target.value)}
                className="w-full text-xs font-bold font-mono bg-gray-900 border border-gray-700 rounded-lg py-1.5 pl-2.5 pr-6 text-white text-center focus:ring-2 focus:ring-indigo-500 focus:border-transparent outline-none"
              />
              <span className="absolute inset-y-0 right-2 flex items-center text-xs text-gray-400 pointer-events-none font-bold">%</span>
            </div>
            <button
              type="submit"
              disabled={isSavingRisk}
              className="px-3 py-1.5 bg-indigo-600 hover:bg-indigo-500 disabled:bg-gray-700 text-white text-xs font-bold rounded-lg shadow transition active:scale-95 whitespace-nowrap"
            >
              {isSavingRisk ? 'Guardando...' : '💾 Guardar'}
            </button>
          </form>

        </div>

        {/* Feedback Alert */}
        {riskFeedback && (
          <div className={`mt-3 p-2.5 rounded-lg text-xs font-semibold flex items-center gap-2 ${
            riskFeedback.type === 'success' 
              ? 'bg-emerald-950/80 text-emerald-300 border border-emerald-800' 
              : 'bg-rose-950/80 text-rose-300 border border-rose-800'
          }`}>
            <span>{riskFeedback.type === 'success' ? '✅' : '⚠️'}</span>
            <span>{riskFeedback.msg}</span>
          </div>
        )}

      </div>

      {/* ======================================================== */}
      {/* 2. KPIs FINANCIEROS Y GESTIÓN INSTITUCIONAL */}
      {/* ======================================================== */}
      <div className="bg-white dark:bg-gray-900 border border-gray-200 dark:border-gray-800 rounded-2xl shadow-lg p-5 transition-all">
        
        {/* Cabecera de KPIs */}
        <div className="flex flex-wrap items-center justify-between gap-3 pb-4 border-b border-gray-200 dark:border-gray-800">
          <div className="flex items-center space-x-2.5">
            <div className="p-2 bg-emerald-500/20 text-emerald-500 rounded-lg">
              <span className="text-xl">📈</span>
            </div>
            <div>
              <h2 className="text-base font-bold text-gray-900 dark:text-white flex items-center gap-2">
                Rendimiento Financiero y Estadísticas de Trading
                <span className={`text-xs px-2.5 py-0.5 rounded-full font-bold border ${
                  netPnL >= 0 
                    ? 'bg-emerald-500/20 text-emerald-400 border-emerald-500/30' 
                    : 'bg-rose-500/20 text-rose-400 border-rose-500/30'
                }`}>
                  {netPnL >= 0 ? `+${netPnL.toFixed(2)} USDT` : `${netPnL.toFixed(2)} USDT`}
                </span>
              </h2>
              <p className="text-xs text-gray-500 dark:text-gray-400">
                Historial completo de trades cerrados, ratio de acierto y control de Drawdown.
              </p>
            </div>
          </div>

          {/* Filtro por moneda y Exportar CSV */}
          <div className="flex flex-wrap items-center gap-2">
            {availableSymbols.length > 0 && (
              <select
                value={filterSymbol}
                onChange={(e) => setFilterSymbol(e.target.value)}
                className="text-xs py-1.5 px-3 bg-gray-100 dark:bg-gray-800 border border-gray-200 dark:border-gray-700 rounded-lg font-semibold text-gray-800 dark:text-gray-200 focus:ring-2 focus:ring-primary-500"
              >
                <option value="ALL">🪙 Todas las Monedas ({trades.length} ops)</option>
                {availableSymbols.map(sym => (
                  <option key={sym} value={sym}>{sym}</option>
                ))}
              </select>
            )}

            <button
              type="button"
              onClick={handleExportCSV}
              className="px-3 py-1.5 bg-emerald-600 hover:bg-emerald-500 text-white text-xs font-bold rounded-lg shadow transition flex items-center gap-1.5 active:scale-95"
              title="Descargar reporte detallado en Excel CSV"
            >
              <span>📥</span> Exportar CSV
            </button>
          </div>
        </div>

        {/* 6 Tarjetas de Métricas Clave */}
        <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-3 my-4">
          
          <div className="p-3 bg-gray-50 dark:bg-gray-800/60 rounded-xl border border-gray-200 dark:border-gray-700/80">
            <span className="text-[11px] font-semibold text-gray-500 dark:text-gray-400 uppercase tracking-wider block">
              🎯 Tasa de Acierto
            </span>
            <span className={`text-xl font-bold font-mono ${parseFloat(winRate) >= 50 ? 'text-emerald-500' : 'text-amber-500'}`}>
              {winRate}%
            </span>
            <span className="text-[10px] text-gray-400 block mt-0.5">
              {winningTrades.length} Ganados / {losingTrades.length} Perdidos
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
              {totalTrades} operaciones cerradas
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
              Bruto: +${grossProfit.toFixed(1)} / -${grossLoss.toFixed(1)}
            </span>
          </div>

          <div className="p-3 bg-gray-50 dark:bg-gray-800/60 rounded-xl border border-gray-200 dark:border-gray-700/80">
            <span className="text-[11px] font-semibold text-gray-500 dark:text-gray-400 uppercase tracking-wider block">
              📉 Max Drawdown
            </span>
            <span className="text-xl font-bold font-mono text-amber-500">
              -${maxDrawdownUSDT.toFixed(2)}
            </span>
            <span className="text-[10px] text-gray-400 block mt-0.5">
              -{maxDrawdownPercent}% desde pico
            </span>
          </div>

          <div className="p-3 bg-gray-50 dark:bg-gray-800/60 rounded-xl border border-gray-200 dark:border-gray-700/80">
            <span className="text-[11px] font-semibold text-gray-500 dark:text-gray-400 uppercase tracking-wider block">
              📐 Ratio Win/Loss
            </span>
            <span className="text-xl font-bold font-mono text-purple-400">
              {realizedRiskReward}:1
            </span>
            <span className="text-[10px] text-gray-400 block mt-0.5">
              +${avgWin.toFixed(2)} vs -${avgLoss.toFixed(2)}
            </span>
          </div>

          <div className="p-3 bg-gray-50 dark:bg-gray-800/60 rounded-xl border border-gray-200 dark:border-gray-700/80">
            <span className="text-[11px] font-semibold text-gray-500 dark:text-gray-400 uppercase tracking-wider block">
              🏆 Mejor / Peor
            </span>
            <div className="flex items-center justify-between text-xs font-mono font-bold mt-1">
              <span className="text-emerald-400">+{bestTrade.toFixed(2)}</span>
              <span className="text-gray-500">/</span>
              <span className="text-rose-400">{worstTrade.toFixed(2)}</span>
            </div>
            <span className="text-[10px] text-gray-400 block mt-0.5">
              Mejor TP vs Peor SL
            </span>
          </div>

        </div>

        {/* Curva de Capital Acumulado SVG */}
        {equityPoints.length > 1 ? (
          <div className="mt-4 p-4 bg-gray-950 rounded-xl border border-gray-800 relative">
            <div className="flex items-center justify-between px-2 mb-2">
              <span className="text-xs font-bold text-gray-300">
                📈 Curva de Crecimiento de Capital ({equityPoints.length} operaciones)
              </span>
              <span className="text-xs font-mono text-emerald-400">
                Total Acumulado: {netPnL >= 0 ? `+${netPnL.toFixed(4)}` : netPnL.toFixed(4)} USDT
              </span>
            </div>

            <div className="w-full overflow-x-auto">
              <svg viewBox={`0 0 ${svgWidth} ${svgHeight}`} className="w-full h-auto max-h-56">
                <defs>
                  <linearGradient id="equityGradient" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="0%" stopColor="#10b981" stopOpacity="0.40" />
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
          </div>
        ) : (
          <div className="py-8 text-center bg-gray-50 dark:bg-gray-800/40 rounded-xl border border-dashed border-gray-300 dark:border-gray-700">
            <p className="text-sm font-semibold text-gray-600 dark:text-gray-300">
              {totalTrades === 0 ? 'No hay operaciones cerradas registradas todavía.' : 'Se necesita al menos 2 operaciones para graficar la curva.'}
            </p>
            <p className="text-xs text-gray-400 mt-1">
              En cuanto el bot cierre sus primeros trades, la curva de capital y el ranking por moneda se actualizarán en tiempo real.
            </p>
          </div>
        )}

      </div>

      {/* ======================================================== */}
      {/* 3. NUEVO GRÁFICO: RANKING Y RENDIMIENTO POR CRIPTOMONEDA */}
      {/* ======================================================== */}
      <div className="bg-white dark:bg-gray-900 border border-gray-200 dark:border-gray-800 rounded-2xl shadow-lg p-5 transition-all">
        
        {/* Cabecera del Ranking con Selector de Ordenamiento */}
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 pb-3 border-b border-gray-200 dark:border-gray-800">
          <div className="flex items-center space-x-2.5">
            <div className="p-2 bg-blue-500/20 text-blue-400 rounded-lg">
              <span className="text-xl">📊</span>
            </div>
            <div>
              <h3 className="text-base font-bold text-gray-900 dark:text-white flex items-center gap-2">
                Ranking de Rendimiento por Criptomoneda
                <span className="text-xs font-normal text-gray-400">({coinPerformanceList.length} pares operados)</span>
              </h3>
              <p className="text-xs text-gray-500 dark:text-gray-400">
                Compara qué monedas son las más rentables y cuáles generan pérdidas para optimizar tu cesta de trading.
              </p>
            </div>
          </div>

          {/* Botones de Ordenamiento */}
          <div className="flex flex-wrap items-center gap-1.5 bg-gray-100 dark:bg-gray-800 p-1 rounded-xl border border-gray-200 dark:border-gray-700">
            <span className="text-[11px] font-bold text-gray-400 px-2">Ordenar:</span>
            
            <button
              type="button"
              onClick={() => setCoinSortOrder('PNL_DESC')}
              className={`px-2.5 py-1 rounded-lg text-xs font-bold transition flex items-center gap-1 ${
                coinSortOrder === 'PNL_DESC'
                  ? 'bg-emerald-600 text-white shadow'
                  : 'text-gray-400 hover:text-white hover:bg-gray-700/50'
              }`}
              title="Ordenar de mayor a menor ganancia (Top Ganadoras primero)"
            >
              <span>⬇️</span> Mayor a Menor
            </button>

            <button
              type="button"
              onClick={() => setCoinSortOrder('PNL_ASC')}
              className={`px-2.5 py-1 rounded-lg text-xs font-bold transition flex items-center gap-1 ${
                coinSortOrder === 'PNL_ASC'
                  ? 'bg-rose-600 text-white shadow'
                  : 'text-gray-400 hover:text-white hover:bg-gray-700/50'
              }`}
              title="Ordenar de menor a mayor ganancia (Mayores Pérdidas primero)"
            >
              <span>⬆️</span> Menor a Mayor
            </button>

            <button
              type="button"
              onClick={() => setCoinSortOrder('WINRATE_DESC')}
              className={`px-2.5 py-1 rounded-lg text-xs font-bold transition ${
                coinSortOrder === 'WINRATE_DESC'
                  ? 'bg-blue-600 text-white shadow'
                  : 'text-gray-400 hover:text-white hover:bg-gray-700/50'
              }`}
              title="Ordenar por mayor tasa de acierto (%)"
            >
              🎯 Win Rate
            </button>

            <button
              type="button"
              onClick={() => setCoinSortOrder('TRADES_DESC')}
              className={`px-2.5 py-1 rounded-lg text-xs font-bold transition ${
                coinSortOrder === 'TRADES_DESC'
                  ? 'bg-purple-600 text-white shadow'
                  : 'text-gray-400 hover:text-white hover:bg-gray-700/50'
              }`}
              title="Ordenar por cantidad de operaciones"
            >
              🔢 Volumen
            </button>
          </div>
        </div>

        {/* Lista de Barras de Rendimiento por Moneda */}
        {coinPerformanceList.length > 0 ? (
          <div className="mt-4 space-y-3">
            {coinPerformanceList.map((coin, index) => {
              const isProfit = coin.totalPnL >= 0;
              const barWidthPercent = Math.min(100, Math.max(8, (Math.abs(coin.totalPnL) / maxAbsCoinPnL) * 100));

              return (
                <div
                  key={coin.symbol}
                  className={`p-3 rounded-xl border transition-all hover:border-gray-600 ${
                    filterSymbol === coin.symbol 
                      ? 'bg-indigo-950/40 border-indigo-500/60 shadow-md' 
                      : 'bg-gray-50 dark:bg-gray-800/40 border-gray-200 dark:border-gray-800'
                  }`}
                >
                  <div className="flex flex-wrap items-center justify-between gap-2 mb-2">
                    
                    {/* Identificación de la moneda */}
                    <div className="flex items-center space-x-2.5">
                      <span className="w-6 h-6 rounded-lg bg-gray-200 dark:bg-gray-700 text-gray-700 dark:text-gray-200 font-bold text-xs flex items-center justify-center font-mono">
                        #{index + 1}
                      </span>
                      <span className="text-sm font-bold text-gray-900 dark:text-white font-mono">
                        {coin.symbol}
                      </span>
                      <span className="text-[11px] px-2 py-0.5 rounded-full font-bold bg-gray-200 dark:bg-gray-700/60 text-gray-600 dark:text-gray-300">
                        {coin.tradesCount} {coin.tradesCount === 1 ? 'operación' : 'operaciones'}
                      </span>
                      <span className={`text-[11px] px-2 py-0.5 rounded-full font-bold ${
                        parseFloat(coin.winRate) >= 50 ? 'bg-emerald-950 text-emerald-300 border border-emerald-800/60' : 'bg-amber-950 text-amber-300 border border-amber-800/60'
                      }`}>
                        Win Rate: {coin.winRate}% ({coin.wins}W / {coin.losses}L)
                      </span>
                    </div>

                    {/* Ganancia y Botón de Filtro */}
                    <div className="flex items-center space-x-3">
                      <div className="text-right">
                        <span className={`text-base font-extrabold font-mono ${isProfit ? 'text-emerald-400' : 'text-rose-400'}`}>
                          {isProfit ? `+${coin.totalPnL.toFixed(4)}` : coin.totalPnL.toFixed(4)} <span className="text-xs">USDT</span>
                        </span>
                        <div className="text-[10px] text-gray-400 flex items-center justify-end gap-1 font-mono">
                          <span>Max: +{coin.bestTrade.toFixed(2)}</span>
                          <span>•</span>
                          <span>Min: {coin.worstTrade.toFixed(2)}</span>
                        </div>
                      </div>

                      <button
                        type="button"
                        onClick={() => setFilterSymbol(filterSymbol === coin.symbol ? 'ALL' : coin.symbol)}
                        className={`text-[11px] px-2.5 py-1 rounded-lg font-semibold transition ${
                          filterSymbol === coin.symbol
                            ? 'bg-indigo-600 text-white shadow'
                            : 'bg-gray-200 dark:bg-gray-700 hover:bg-gray-300 dark:hover:bg-gray-600 text-gray-700 dark:text-gray-300'
                        }`}
                        title={filterSymbol === coin.symbol ? 'Quitar filtro' : `Filtrar solo trades de ${coin.symbol}`}
                      >
                        {filterSymbol === coin.symbol ? '✓ Filtrado' : '🔍 Filtrar'}
                      </button>
                    </div>

                  </div>

                  {/* Barra Visual Proporcional de Ganancia/Pérdida */}
                  <div className="w-full bg-gray-200 dark:bg-gray-900 rounded-full h-2.5 overflow-hidden p-0.5">
                    <div
                      className={`h-full rounded-full transition-all duration-500 ${
                        isProfit ? 'bg-emerald-500' : 'bg-rose-500'
                      }`}
                      style={{ width: `${barWidthPercent}%` }}
                    />
                  </div>

                </div>
              );
            })}
          </div>
        ) : (
          <div className="py-6 text-center text-gray-400 text-xs">
            No hay operaciones para generar el ranking por moneda.
          </div>
        )}

      </div>

      {/* ======================================================== */}
      {/* 4. DONUT DE ASIGNACIÓN DE CARTERA */}
      {/* ======================================================== */}
      <div className="bg-white dark:bg-gray-900 border border-gray-200 dark:border-gray-800 rounded-2xl shadow-lg p-5 transition-all">
        <div className="flex items-center space-x-2.5 pb-3 border-b border-gray-200 dark:border-gray-800">
          <div className="p-2 bg-yellow-400/20 text-yellow-500 rounded-lg">
            <span className="text-xl">🍩</span>
          </div>
          <div>
            <h3 className="text-base font-bold text-gray-900 dark:text-white">
              Distribución de Margen y Exposición de Cartera en Posición
            </h3>
            <p className="text-xs text-gray-500 dark:text-gray-400">
              Visualiza en tiempo real qué porcentaje de tu capital está colocado en cada moneda abierta.
            </p>
          </div>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-2 gap-6 items-center mt-4">
          <div className="flex justify-center items-center relative">
            <svg viewBox="0 0 160 160" className="w-44 h-44 transform -rotate-90">
              <circle cx="80" cy="80" r="60" fill="transparent" stroke="#1e293b" strokeWidth="24" />
              
              {portfolioDonutData.slices.length > 0 ? (
                (() => {
                  let accumulatedPercent = 0;
                  const total = portfolioDonutData.slices.reduce((a, b) => a + b.margin, 0);
                  const circumference = 2 * Math.PI * 60;
                  
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
              <span className="text-gray-500 dark:text-gray-400">🛡️ Estado de Billetera:</span>
              <span className="font-bold text-emerald-500 font-mono">
                ${freeMarginNum.toFixed(2)} USDT LIBRE
              </span>
            </div>
          </div>
        </div>
      </div>

    </div>
  );
}

export default PnLPerformanceChart;
