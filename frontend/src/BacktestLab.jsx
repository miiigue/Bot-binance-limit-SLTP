import React, { useState, useEffect, useMemo } from 'react';

export default function BacktestLab({ activeConfig, addToast, onApplyStrategyToConfig }) {
  // Estado de configuración de la simulación
  const [symbol, setSymbol] = useState('SOLUSDT');
  const [availableSymbols, setAvailableSymbols] = useState(['SOLUSDT', 'BTCUSDT', 'ETHUSDT', 'BNBUSDT', 'ARBUSDT', 'DOGEUSDT']);
  const [days, setDays] = useState(14);
  const [interval, setInterval] = useState('5m');
  const [initialBalance, setInitialBalance] = useState(1000);
  
  // Selector de Estrategia (Actual o Guardadas)
  const [strategySource, setStrategySource] = useState('current'); // 'current' o nombre de estrategia guardada
  const [savedStrategies, setSavedStrategies] = useState([]);
  
  // Estado de ejecución y resultados
  const [isRunning, setIsRunning] = useState(false);
  const [results, setResults] = useState(null);
  const [tradeFilter, setTradeFilter] = useState('all'); // 'all', 'wins', 'losses'
  const [hoveredPoint, setHoveredPoint] = useState(null);

  // Cargar símbolos y estrategias guardadas al montar
  useEffect(() => {
    const fetchSymbols = async () => {
      try {
        const res = await fetch('/api/backtest/symbols');
        if (res.ok) {
          const data = await res.json();
          if (data?.symbols?.length) {
            setAvailableSymbols(data.symbols);
            if (data.configured?.length) {
              setSymbol(data.configured[0]);
            }
          }
        }
      } catch (err) {
        console.error("Error cargando símbolos para backtest:", err);
      }
    };

    const fetchStrategies = async () => {
      try {
        const res = await fetch('/api/strategies');
        if (res.ok) {
          const data = await res.json();
          if (Array.isArray(data)) {
            setSavedStrategies(data);
          }
        }
      } catch (err) {
        console.error("Error cargando estrategias:", err);
      }
    };

    fetchSymbols();
    fetchStrategies();
  }, []);

  // Determinar la configuración exacta que se enviará al backtest
  const configToTest = useMemo(() => {
    if (strategySource === 'current') {
      return activeConfig || {};
    }
    const found = savedStrategies.find(s => s.name === strategySource);
    return found?.config || activeConfig || {};
  }, [strategySource, savedStrategies, activeConfig]);

  // Ejecutar el Backtest
  const handleRunBacktest = async () => {
    setIsRunning(true);
    setResults(null);
    try {
      const payload = {
        symbol: symbol.toUpperCase().trim(),
        interval,
        days: Number(days),
        initial_balance: Number(initialBalance),
        config: configToTest
      };

      const res = await fetch('/api/backtest', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload)
      });

      if (!res.ok) {
        const errData = await res.json().catch(() => ({ error: `Error ${res.status}` }));
        throw new Error(errData.error || 'Error al ejecutar la simulación.');
      }

      const data = await res.json();
      setResults(data);
      if (addToast) {
        addToast(
          '⚡ Backtest Completado',
          `${symbol} (${days} días): PnL ${data.net_pnl >= 0 ? '+' : ''}${data.net_pnl} USDT (${data.win_rate_pct}% acierto).`,
          data.net_pnl >= 0 ? 'success' : 'warning'
        );
      }
    } catch (err) {
      console.error("Error en backtest:", err);
      if (addToast) {
        addToast('Error de Simulación', err.message, 'error');
      } else {
        alert(err.message);
      }
    } finally {
      setIsRunning(false);
    }
  };

  // Filtrado de operaciones
  const filteredTrades = useMemo(() => {
    if (!results?.trades) return [];
    if (tradeFilter === 'wins') return results.trades.filter(t => t.net_pnl > 0);
    if (tradeFilter === 'losses') return results.trades.filter(t => t.net_pnl <= 0);
    return results.trades;
  }, [results, tradeFilter]);

  // Aplicar configuración probada al bot en vivo
  const handleApplyToLiveBot = () => {
    if (!configToTest) return;
    if (window.confirm(`¿Confirmas que deseas aplicar los parámetros de esta prueba como la nueva configuración activa de tu Bot en vivo?`)) {
      if (onApplyStrategyToConfig) {
        onApplyStrategyToConfig(configToTest);
      }
    }
  };

  // Renderizado del gráfico vectorial de la Curva de Capital (SVG)
  const renderEquitySvg = () => {
    if (!results?.equity_curve || results.equity_curve.length < 2) return null;
    const curve = results.equity_curve;
    const width = 800;
    const height = 220;
    const padX = 50;
    const padY = 30;

    const equities = curve.map(c => c.equity);
    const minEq = Math.min(...equities, results.initial_balance * 0.98);
    const maxEq = Math.max(...equities, results.initial_balance * 1.02);
    const range = (maxEq - minEq) || 1;

    const getX = (index) => padX + (index / (curve.length - 1)) * (width - padX * 2);
    const getY = (val) => height - padY - ((val - minEq) / range) * (height - padY * 2);

    const points = curve.map((c, i) => `${getX(i)},${getY(c.equity)}`).join(' ');
    const initialLineY = getY(results.initial_balance);
    const isProfit = (results.net_pnl || 0) >= 0;
    const strokeColor = isProfit ? '#10b981' : '#ef4444';
    const gradientId = isProfit ? 'profitGrad' : 'lossGrad';

    const areaPoints = `${points} ${getX(curve.length - 1)},${height - padY} ${getX(0)},${height - padY}`;

    return (
      <div className="relative w-full overflow-hidden">
        <svg viewBox={`0 0 ${width} ${height}`} className="w-full h-auto drop-shadow-md">
          <defs>
            <linearGradient id="profitGrad" x1="0" y1="0" x2="0" y2="1">
              <stop offset="0%" stopColor="#10b981" stopOpacity="0.35" />
              <stop offset="100%" stopColor="#10b981" stopOpacity="0.0" />
            </linearGradient>
            <linearGradient id="lossGrad" x1="0" y1="0" x2="0" y2="1">
              <stop offset="0%" stopColor="#ef4444" stopOpacity="0.35" />
              <stop offset="100%" stopColor="#ef4444" stopOpacity="0.0" />
            </linearGradient>
          </defs>

          {/* Línea de Base (Capital Inicial) */}
          <line
            x1={padX}
            y1={initialLineY}
            x2={width - padX}
            y2={initialLineY}
            stroke="#64748b"
            strokeDasharray="4 4"
            strokeWidth="1.2"
          />
          <text x={padX + 5} y={initialLineY - 6} fill="#94a3b8" fontSize="10" fontFamily="monospace">
            Base: ${results.initial_balance} USDT
          </text>

          {/* Área de fondo con gradiente */}
          <polygon points={areaPoints} fill={`url(#${gradientId})`} />

          {/* Línea principal de Equity */}
          <polyline
            fill="none"
            stroke={strokeColor}
            strokeWidth="2.5"
            strokeLinecap="round"
            strokeLinejoin="round"
            points={points}
          />

          {/* Puntos interactivos */}
          {curve.map((c, i) => (
            <circle
              key={i}
              cx={getX(i)}
              cy={getY(c.equity)}
              r="3.5"
              className="fill-gray-900 stroke-2 cursor-pointer transition-all hover:r-6"
              stroke={c.equity >= results.initial_balance ? '#10b981' : '#ef4444'}
              onMouseEnter={() => setHoveredPoint(c)}
              onMouseLeave={() => setHoveredPoint(null)}
            />
          ))}
        </svg>

        {/* Tooltip de punto hover */}
        {hoveredPoint && (
          <div className="absolute top-2 right-4 bg-gray-900/90 border border-gray-700 px-3 py-1.5 rounded-lg shadow-xl text-xs font-mono text-gray-200 pointer-events-none">
            <div><span className="text-gray-400">Fecha:</span> {hoveredPoint.time}</div>
            <div><span className="text-gray-400">Saldo:</span> <b className="text-white">${hoveredPoint.equity.toFixed(2)} USDT</b></div>
            <div><span className="text-gray-400">PnL:</span> <b className={hoveredPoint.pnl >= 0 ? 'text-emerald-400' : 'text-red-400'}>
              {hoveredPoint.pnl >= 0 ? '+' : ''}{hoveredPoint.pnl.toFixed(2)} USDT
            </b></div>
          </div>
        )}
      </div>
    );
  };

  return (
    <div className="space-y-6">
      
      {/* 1. Header y Banner Informativo */}
      <div className="bg-gradient-to-r from-indigo-900/40 via-purple-900/30 to-blue-900/40 border border-indigo-700/40 rounded-2xl p-6 shadow-xl relative overflow-hidden">
        <div className="flex flex-col md:flex-row md:items-center justify-between gap-4 relative z-10">
          <div>
            <div className="flex items-center gap-2 mb-1">
              <span className="text-2xl">🧪</span>
              <h2 className="text-xl font-bold text-white tracking-wide">
                Laboratorio de Backtesting Histórico Cuantitativo
              </h2>
              <span className="px-2 py-0.5 text-[11px] font-bold rounded-full bg-indigo-500/20 text-indigo-300 border border-indigo-500/40">
                Binance Futures Data
              </span>
            </div>
            <p className="text-sm text-gray-300 max-w-3xl">
              Simula y valida tus estrategias con datos reales del mercado de Binance vela por vela. Evalúa soportes, RSI, promediado DCA y trailing stops antes de arriesgar capital en vivo.
            </p>
          </div>

          {results && (
            <button
              type="button"
              onClick={handleApplyToLiveBot}
              className="px-4 py-2.5 bg-gradient-to-r from-emerald-600 to-teal-600 hover:from-emerald-500 hover:to-teal-500 text-white font-bold rounded-xl shadow-lg shadow-emerald-900/40 transition-all flex items-center gap-2 active:scale-95 text-xs whitespace-nowrap"
              title="Copiar estos parámetros exactos al bot activo"
            >
              <span>🚀</span>
              <span>Aplicar al Bot en Vivo</span>
            </button>
          )}
        </div>
      </div>

      {/* 2. Barra de Parámetros de Simulación */}
      <div className="bg-white dark:bg-gray-800 border border-gray-200 dark:border-gray-700 rounded-2xl p-5 shadow-sm">
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-6 gap-4 items-end">
          
          {/* Criptomoneda */}
          <div>
            <label className="block text-xs font-bold text-gray-700 dark:text-gray-300 mb-1">
              🪙 Par de Trading
            </label>
            <input
              type="text"
              list="symbols-list"
              value={symbol}
              onChange={(e) => setSymbol(e.target.value.toUpperCase())}
              className="w-full px-3 py-2 bg-gray-50 dark:bg-gray-900 border border-gray-300 dark:border-gray-700 rounded-xl text-sm font-mono font-bold text-gray-900 dark:text-white focus:ring-2 focus:ring-indigo-500 outline-none"
              placeholder="SOLUSDT"
            />
            <datalist id="symbols-list">
              {availableSymbols.map(s => <option key={s} value={s} />)}
            </datalist>
          </div>

          {/* Periodo de Días */}
          <div>
            <label className="block text-xs font-bold text-gray-700 dark:text-gray-300 mb-1">
              📅 Periodo Histórico
            </label>
            <select
              value={days}
              onChange={(e) => setDays(Number(e.target.value))}
              className="w-full px-3 py-2 bg-gray-50 dark:bg-gray-900 border border-gray-300 dark:border-gray-700 rounded-xl text-sm font-semibold text-gray-900 dark:text-white focus:ring-2 focus:ring-indigo-500 outline-none"
            >
              <option value="3">Últimos 3 días</option>
              <option value="7">Últimos 7 días (1 sem)</option>
              <option value="14">Últimos 14 días (2 sem)</option>
              <option value="30">Últimos 30 días (1 mes)</option>
            </select>
          </div>

          {/* Intervalo de Velas */}
          <div>
            <label className="block text-xs font-bold text-gray-700 dark:text-gray-300 mb-1">
              ⏱️ Temporalidad
            </label>
            <select
              value={interval}
              onChange={(e) => setInterval(e.target.value)}
              className="w-full px-3 py-2 bg-gray-50 dark:bg-gray-900 border border-gray-300 dark:border-gray-700 rounded-xl text-sm font-semibold text-gray-900 dark:text-white focus:ring-2 focus:ring-indigo-500 outline-none"
            >
              <option value="1m">1 Minuto (1m)</option>
              <option value="5m">5 Minutos (5m - Recomendado)</option>
              <option value="15m">15 Minutos (15m)</option>
              <option value="1h">1 Hora (1h)</option>
            </select>
          </div>

          {/* Capital Inicial */}
          <div>
            <label className="block text-xs font-bold text-gray-700 dark:text-gray-300 mb-1">
              💰 Capital Inicial (USDT)
            </label>
            <input
              type="number"
              value={initialBalance}
              onChange={(e) => setInitialBalance(Number(e.target.value))}
              min="10"
              step="50"
              className="w-full px-3 py-2 bg-gray-50 dark:bg-gray-900 border border-gray-300 dark:border-gray-700 rounded-xl text-sm font-mono font-bold text-gray-900 dark:text-white focus:ring-2 focus:ring-indigo-500 outline-none"
            />
          </div>

          {/* Selector de Estrategia */}
          <div>
            <label className="block text-xs font-bold text-gray-700 dark:text-gray-300 mb-1">
              🎯 Estrategia a Probar
            </label>
            <select
              value={strategySource}
              onChange={(e) => setStrategySource(e.target.value)}
              className="w-full px-3 py-2 bg-gray-50 dark:bg-gray-900 border border-gray-300 dark:border-gray-700 rounded-xl text-sm font-semibold text-gray-900 dark:text-white focus:ring-2 focus:ring-indigo-500 outline-none truncate"
            >
              <option value="current">⭐ Configuración Actual del Bot</option>
              {savedStrategies.map(s => (
                <option key={s.name} value={s.name}>📁 {s.name}</option>
              ))}
            </select>
          </div>

          {/* Botón Ejecutar */}
          <div>
            <button
              type="button"
              onClick={handleRunBacktest}
              disabled={isRunning}
              className={`w-full py-2.5 px-4 font-bold rounded-xl text-white shadow-lg transition-all flex items-center justify-center gap-2 active:scale-95 text-sm ${
                isRunning
                  ? 'bg-indigo-700 opacity-60 cursor-not-allowed'
                  : 'bg-indigo-600 hover:bg-indigo-500 shadow-indigo-900/40'
              }`}
            >
              {isRunning ? (
                <>
                  <span className="animate-spin text-sm">⏳</span>
                  <span>Simulando...</span>
                </>
              ) : (
                <>
                  <span>⚡</span>
                  <span>Ejecutar Backtest</span>
                </>
              )}
            </button>
          </div>
        </div>
      </div>

      {/* 3. Panel de Resultados (Si se ha ejecutado) */}
      {results && !results.error && (
        <div className="space-y-6 animate-fadeIn">
          
          {/* Métricas Principales (KPI Cards) */}
          <div className="grid grid-cols-2 md:grid-cols-4 lg:grid-cols-6 gap-3 sm:gap-4">
            
            {/* PnL Neto */}
            <div className={`p-4 rounded-2xl border shadow-sm ${
              results.net_pnl >= 0
                ? 'bg-emerald-500/10 border-emerald-500/30'
                : 'bg-red-500/10 border-red-500/30'
            }`}>
              <div className="text-[11px] font-bold uppercase tracking-wider text-gray-500 dark:text-gray-400">
                PnL Neto Total
              </div>
              <div className={`text-xl font-extrabold font-mono mt-1 ${
                results.net_pnl >= 0 ? 'text-emerald-500 dark:text-emerald-400' : 'text-red-500 dark:text-red-400'
              }`}>
                {results.net_pnl >= 0 ? '+' : ''}{results.net_pnl} <span className="text-xs font-semibold">USDT</span>
              </div>
              <div className="text-[11px] text-gray-500 dark:text-gray-400 font-mono mt-0.5">
                Retorno: <b className={results.net_return_pct >= 0 ? 'text-emerald-400' : 'text-red-400'}>
                  {results.net_return_pct >= 0 ? '+' : ''}{results.net_return_pct}%
                </b>
              </div>
            </div>

            {/* Win Rate */}
            <div className="p-4 rounded-2xl border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-800 shadow-sm">
              <div className="text-[11px] font-bold uppercase tracking-wider text-gray-500 dark:text-gray-400">
                Win Rate (% Acierto)
              </div>
              <div className="text-xl font-extrabold font-mono mt-1 text-gray-900 dark:text-white">
                {results.win_rate_pct}%
              </div>
              <div className="text-[11px] text-gray-500 dark:text-gray-400 mt-0.5">
                {results.winning_trades}G / {results.losing_trades}P de {results.total_trades}
              </div>
            </div>

            {/* Profit Factor */}
            <div className="p-4 rounded-2xl border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-800 shadow-sm">
              <div className="text-[11px] font-bold uppercase tracking-wider text-gray-500 dark:text-gray-400">
                Profit Factor
              </div>
              <div className={`text-xl font-extrabold font-mono mt-1 ${
                results.profit_factor >= 1.5 ? 'text-emerald-400' : results.profit_factor >= 1.0 ? 'text-amber-400' : 'text-red-400'
              }`}>
                {results.profit_factor}
              </div>
              <div className="text-[11px] text-gray-500 dark:text-gray-400 mt-0.5">
                {results.profit_factor >= 2.0 ? '🌟 Excelente' : results.profit_factor >= 1.2 ? '✓ Sólido' : '⚠️ Ajustar'}
              </div>
            </div>

            {/* Máximo Drawdown */}
            <div className="p-4 rounded-2xl border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-800 shadow-sm">
              <div className="text-[11px] font-bold uppercase tracking-wider text-gray-500 dark:text-gray-400">
                Máximo Drawdown
              </div>
              <div className="text-xl font-extrabold font-mono mt-1 text-amber-500 dark:text-amber-400">
                -{results.max_drawdown_pct}%
              </div>
              <div className="text-[11px] text-gray-500 dark:text-gray-400 font-mono mt-0.5">
                -${results.max_drawdown_usdt} USDT
              </div>
            </div>

            {/* Ratio Riesgo/Beneficio */}
            <div className="p-4 rounded-2xl border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-800 shadow-sm">
              <div className="text-[11px] font-bold uppercase tracking-wider text-gray-500 dark:text-gray-400">
                Ratio R / B Real
              </div>
              <div className="text-xl font-extrabold font-mono mt-1 text-blue-500 dark:text-blue-400">
                1 : {results.risk_reward_ratio}
              </div>
              <div className="text-[11px] text-gray-500 dark:text-gray-400 mt-0.5">
                Avg trade: ${results.avg_trade_pnl}
              </div>
            </div>

            {/* Comisiones Binance */}
            <div className="p-4 rounded-2xl border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-800 shadow-sm">
              <div className="text-[11px] font-bold uppercase tracking-wider text-gray-500 dark:text-gray-400">
                Comisiones Est.
              </div>
              <div className="text-xl font-extrabold font-mono mt-1 text-gray-600 dark:text-gray-300">
                ${results.total_fees_usdt}
              </div>
              <div className="text-[11px] text-gray-500 dark:text-gray-400 mt-0.5">
                {results.total_candles} velas analizadas
              </div>
            </div>
          </div>

          {/* 4. Gráfico de Curva de Capital */}
          <div className="bg-white dark:bg-gray-800 border border-gray-200 dark:border-gray-700 rounded-2xl p-5 shadow-sm">
            <div className="flex items-center justify-between mb-4">
              <div className="flex items-center gap-2">
                <span className="text-lg">📈</span>
                <h3 className="font-bold text-gray-900 dark:text-white text-base">
                  Curva de Capital Histórica ({symbol} - {results.days_tested} días)
                </h3>
              </div>
              <div className="text-xs font-mono text-gray-500 dark:text-gray-400">
                Saldo Final: <b className="text-white">${results.final_balance} USDT</b>
              </div>
            </div>

            {renderEquitySvg()}
          </div>

          {/* 5. Tabla de Operaciones Simuladas */}
          <div className="bg-white dark:bg-gray-800 border border-gray-200 dark:border-gray-700 rounded-2xl p-5 shadow-sm">
            <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 mb-4">
              <div className="flex items-center gap-2">
                <span className="text-lg">📋</span>
                <h3 className="font-bold text-gray-900 dark:text-white text-base">
                  Historial de Operaciones Simuladas ({filteredTrades.length})
                </h3>
              </div>

              {/* Filtros Ganadas / Perdidas */}
              <div className="flex items-center gap-1 bg-gray-100 dark:bg-gray-900 p-1 rounded-xl">
                <button
                  type="button"
                  onClick={() => setTradeFilter('all')}
                  className={`px-3 py-1 text-xs font-bold rounded-lg transition ${
                    tradeFilter === 'all'
                      ? 'bg-white dark:bg-gray-800 text-gray-900 dark:text-white shadow-sm'
                      : 'text-gray-500 hover:text-gray-900 dark:hover:text-white'
                  }`}
                >
                  Todas ({results.total_trades})
                </button>
                <button
                  type="button"
                  onClick={() => setTradeFilter('wins')}
                  className={`px-3 py-1 text-xs font-bold rounded-lg transition ${
                    tradeFilter === 'wins'
                      ? 'bg-emerald-500/20 text-emerald-300 border border-emerald-500/40 shadow-sm'
                      : 'text-gray-500 hover:text-emerald-400'
                  }`}
                >
                  Ganadas ({results.winning_trades})
                </button>
                <button
                  type="button"
                  onClick={() => setTradeFilter('losses')}
                  className={`px-3 py-1 text-xs font-bold rounded-lg transition ${
                    tradeFilter === 'losses'
                      ? 'bg-red-500/20 text-red-300 border border-red-500/40 shadow-sm'
                      : 'text-gray-500 hover:text-red-400'
                  }`}
                >
                  Perdidas ({results.losing_trades})
                </button>
              </div>
            </div>

            {filteredTrades.length === 0 ? (
              <div className="text-center py-8 text-gray-500 dark:text-gray-400 text-sm">
                No hay operaciones para este filtro o el bot no encontró entradas en el periodo.
              </div>
            ) : (
              <div className="overflow-x-auto max-h-96 overflow-y-auto">
                <table className="min-w-full divide-y divide-gray-200 dark:divide-gray-700 text-left">
                  <thead className="bg-gray-50 dark:bg-gray-900 text-gray-500 dark:text-gray-400 text-[11px] uppercase tracking-wider sticky top-0">
                    <tr>
                      <th className="px-3 py-2.5">#</th>
                      <th className="px-3 py-2.5">Apertura</th>
                      <th className="px-3 py-2.5">Cierre</th>
                      <th className="px-3 py-2.5">Entrada</th>
                      <th className="px-3 py-2.5">Salida</th>
                      <th className="px-3 py-2.5">Margen</th>
                      <th className="px-3 py-2.5 text-center">DCA</th>
                      <th className="px-3 py-2.5">Motivo de Salida</th>
                      <th className="px-3 py-2.5 text-right">PnL Neto</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-gray-200 dark:divide-gray-700/60 font-mono text-xs">
                    {filteredTrades.map((t) => (
                      <tr key={t.id} className="hover:bg-gray-50 dark:hover:bg-gray-750 transition-colors">
                        <td className="px-3 py-2 text-gray-400">{t.id}</td>
                        <td className="px-3 py-2 text-gray-400 whitespace-nowrap">{t.open_time?.substring(5, 16)}</td>
                        <td className="px-3 py-2 text-gray-400 whitespace-nowrap">{t.close_time?.substring(5, 16)}</td>
                        <td className="px-3 py-2 text-gray-900 dark:text-white font-bold">${t.entry_price}</td>
                        <td className="px-3 py-2 text-gray-900 dark:text-white">${t.exit_price}</td>
                        <td className="px-3 py-2 text-gray-400">${t.margin_usdt}</td>
                        <td className="px-3 py-2 text-center">
                          {t.dca_reentries > 0 ? (
                            <span className="px-1.5 py-0.5 bg-blue-500/20 text-blue-300 rounded font-bold text-[10px]">
                              {t.dca_reentries} DCA
                            </span>
                          ) : '-'}
                        </td>
                        <td className="px-3 py-2 whitespace-nowrap">
                          <span className={`px-2 py-0.5 rounded-full text-[10px] font-bold ${
                            t.net_pnl > 0
                              ? 'bg-emerald-500/20 text-emerald-400 border border-emerald-500/30'
                              : 'bg-red-500/20 text-red-400 border border-red-500/30'
                          }`}>
                            {t.exit_reason}
                          </span>
                        </td>
                        <td className="px-3 py-2 text-right font-bold whitespace-nowrap">
                          <span className={t.net_pnl >= 0 ? 'text-emerald-500 dark:text-emerald-400' : 'text-red-500 dark:text-red-400'}>
                            {t.net_pnl >= 0 ? '+' : ''}{t.net_pnl} USDT
                          </span>
                          <span className="text-[10px] text-gray-400 block">
                            ({t.return_pct >= 0 ? '+' : ''}{t.return_pct}%)
                          </span>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
