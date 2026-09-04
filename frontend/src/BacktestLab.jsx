import React, { useState, useEffect, useMemo } from 'react';

export default function BacktestLab({ activeConfig, addToast, onApplyStrategyToConfig }) {
  // Estado de configuración de la simulación
  const [symbol, setSymbol] = useState('PORTFOLIO');
  const [configuredSymbols, setConfiguredSymbols] = useState([]);
  const [availableSymbols, setAvailableSymbols] = useState(['SOLUSDT', 'DOGEUSDT', 'OPUSDT', 'SUIUSDT', 'NEARUSDT', 'ADAUSDT', 'ONDOUSDT', 'ARBUSDT', 'BTCUSDT', 'ETHUSDT']);
  const [days, setDays] = useState(14);
  const [dateMode, setDateMode] = useState('relative'); // 'relative' o 'range'
  const [startDate, setStartDate] = useState('2024-01-01');
  const [endDate, setEndDate] = useState('2024-03-18');
  const [interval, setInterval] = useState('5m');
  const [initialBalance, setInitialBalance] = useState(1000);
  
  // Selector de Estrategia (Actual o Guardadas)
  const [strategySource, setStrategySource] = useState('current');
  const [savedStrategies, setSavedStrategies] = useState([]);
  
  // Estado de ejecución y resultados
  const [isRunning, setIsRunning] = useState(false);
  const [results, setResults] = useState(null);
  const [tradeFilter, setTradeFilter] = useState('all'); // 'all', 'wins', 'losses'
  const [symbolFilter, setSymbolFilter] = useState('all'); // Filtro por moneda específica en modo portafolio
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
          }
          if (data?.configured?.length) {
            setConfiguredSymbols(data.configured);
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

  // Símbolos dinámicos del portafolio según la estrategia seleccionada
  const activePortfolioSymbols = useMemo(() => {
    const symStr = configToTest?.symbolsToTrade || configToTest?.symbols_to_trade;
    if (symStr && typeof symStr === 'string') {
      const parsed = symStr.split(',').map(s => s.trim().toUpperCase()).filter(Boolean);
      if (parsed.length) return parsed;
    }
    return configuredSymbols.length ? configuredSymbols : ["SOLUSDT", "DOGEUSDT", "OPUSDT", "SUIUSDT", "NEARUSDT", "ADAUSDT", "ONDOUSDT", "ARBUSDT"];
  }, [configToTest, configuredSymbols]);

  // Ejecutar el Backtest (Individual o Portafolio Completo)
  const handleRunBacktest = async () => {
    setIsRunning(true);
    setResults(null);
    setSymbolFilter('all');
    try {
      const isPortfolio = symbol === 'PORTFOLIO';
      const isCustomRange = dateMode === 'range';
      const payload = {
        symbol: symbol.toUpperCase().trim(),
        is_portfolio: isPortfolio,
        symbols: isPortfolio ? activePortfolioSymbols : undefined,
        interval,
        days: Number(days),
        startDate: isCustomRange ? startDate : undefined,
        endDate: isCustomRange ? endDate : undefined,
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
        const title = isPortfolio 
          ? `🌐 Portafolio (${data.symbols_count} pares)` 
          : `${symbol}`;
        const periodStr = data.period_label || (isCustomRange ? `${startDate} al ${endDate}` : `${days} días`);
        addToast(
          '⚡ Backtest Completado',
          `${title} - ${periodStr}: PnL ${data.net_pnl >= 0 ? '+' : ''}${data.net_pnl} USDT (${data.win_rate_pct}% acierto).`,
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
    let list = results.trades;
    if (symbolFilter !== 'all') {
      list = list.filter(t => t.symbol === symbolFilter);
    }
    if (tradeFilter === 'wins') {
      list = list.filter(t => t.net_pnl > 0);
    } else if (tradeFilter === 'losses') {
      list = list.filter(t => t.net_pnl <= 0);
    }
    return list;
  }, [results, tradeFilter, symbolFilter]);

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
                Laboratorio de Backtesting Cuantitativo
              </h2>
              <span className="px-2 py-0.5 text-[11px] font-bold rounded-full bg-indigo-500/20 text-indigo-300 border border-indigo-500/40">
                Binance Futures Data
              </span>
              {results?.is_portfolio && (
                <span className="px-2 py-0.5 text-[11px] font-bold rounded-full bg-emerald-500/20 text-emerald-300 border border-emerald-500/40">
                  🌐 Portafolio ({results.symbols_count} pares)
                </span>
              )}
            </div>
            <p className="text-sm text-gray-300 max-w-3xl">
              Simula y valida tus estrategias con datos reales de Binance vela por vela. Evalúa una moneda individual o prueba **todo tu portafolio en simultáneo** para identificar las mejores monedas.
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
        
        {/* Acceso Rápido Portafolio vs Monedas */}
        <div className="mb-4 flex flex-wrap items-center gap-1.5">
          <span className="text-xs font-bold text-gray-500 dark:text-gray-400 mr-1">Alcance:</span>
          <button
            type="button"
            onClick={() => setSymbol('PORTFOLIO')}
            className={`px-3 py-1 text-xs font-bold rounded-xl border transition-all flex items-center gap-1 ${
              symbol === 'PORTFOLIO'
                ? 'bg-indigo-600 text-white border-indigo-500 shadow-md shadow-indigo-900/30 ring-2 ring-indigo-400/40'
                : 'bg-gray-100 dark:bg-gray-900 text-gray-700 dark:text-gray-300 border-gray-300 dark:border-gray-700 hover:bg-gray-200 dark:hover:bg-gray-800'
            }`}
          >
            <span>🌐</span>
            <span>Todo el Portafolio ({activePortfolioSymbols.length || 8} pares)</span>
          </button>

          {activePortfolioSymbols.map(sym => (
            <button
              key={sym}
              type="button"
              onClick={() => setSymbol(sym)}
              className={`px-2.5 py-1 text-xs font-mono font-bold rounded-xl border transition-all ${
                symbol === sym
                  ? 'bg-yellow-500 text-black border-yellow-400 shadow-md ring-2 ring-yellow-400/40'
                  : 'bg-gray-100 dark:bg-gray-900 text-gray-600 dark:text-gray-300 border-gray-300 dark:border-gray-700 hover:bg-gray-200 dark:hover:bg-gray-800'
              }`}
            >
              {sym.replace('USDT', '')}
            </button>
          ))}
        </div>

        {/* Selector de Modo de Tiempo: Días Recientes vs Rango de Fechas Calendario */}
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2.5 mb-4 border-b border-gray-200 dark:border-gray-700/60 pb-3">
          <div className="flex items-center gap-2">
            <span className="text-xs font-extrabold text-gray-500 dark:text-gray-400 uppercase tracking-wider">Período:</span>
            <div className="inline-flex rounded-xl bg-gray-100 dark:bg-gray-900 p-0.5 border border-gray-200 dark:border-gray-800">
              <button
                type="button"
                onClick={() => setDateMode('relative')}
                className={`px-3 py-1 text-xs font-bold rounded-lg transition-all ${
                  dateMode === 'relative'
                    ? 'bg-white dark:bg-gray-800 text-indigo-600 dark:text-indigo-400 shadow'
                    : 'text-gray-600 dark:text-gray-400 hover:text-gray-900 dark:hover:text-white'
                }`}
              >
                ⏱️ Días Recientes
              </button>
              <button
                type="button"
                onClick={() => setDateMode('range')}
                className={`px-3 py-1 text-xs font-bold rounded-lg transition-all ${
                  dateMode === 'range'
                    ? 'bg-white dark:bg-gray-800 text-indigo-600 dark:text-indigo-400 shadow'
                    : 'text-gray-600 dark:text-gray-400 hover:text-gray-900 dark:hover:text-white'
                }`}
              >
                📅 Rango de Fechas (Desde / Hasta)
              </button>
            </div>
          </div>

          {/* Atajos de fechas históricas interesantes */}
          {dateMode === 'range' && (
            <div className="flex items-center flex-wrap gap-1.5 text-xs">
              <span className="text-[11px] text-gray-400">Atajos rápidos:</span>
              <button
                type="button"
                onClick={() => { setStartDate('2024-01-01'); setEndDate('2024-03-18'); }}
                className="px-2 py-0.5 bg-indigo-950 hover:bg-indigo-900 text-indigo-300 border border-indigo-700/60 rounded-lg font-mono text-[11px] transition"
                title="Rango exacto de tu consulta"
              >
                Ene-Mar 2024
              </button>
              <button
                type="button"
                onClick={() => { setStartDate('2024-01-01'); setEndDate('2024-12-31'); }}
                className="px-2 py-0.5 bg-indigo-950 hover:bg-indigo-900 text-indigo-300 border border-indigo-700/60 rounded-lg font-mono text-[11px] transition"
              >
                Todo 2024
              </button>
              <button
                type="button"
                onClick={() => { setStartDate('2023-01-01'); setEndDate('2023-12-31'); }}
                className="px-2 py-0.5 bg-indigo-950 hover:bg-indigo-900 text-indigo-300 border border-indigo-700/60 rounded-lg font-mono text-[11px] transition"
              >
                Todo 2023
              </button>
              <button
                type="button"
                onClick={() => {
                  const now = new Date();
                  const end = now.toISOString().split('T')[0];
                  const dStart = new Date(now);
                  dStart.setDate(dStart.getDate() - 30);
                  setStartDate(dStart.toISOString().split('T')[0]);
                  setEndDate(end);
                }}
                className="px-2 py-0.5 bg-gray-800 hover:bg-gray-700 text-gray-300 border border-gray-600 rounded-lg font-mono text-[11px] transition"
              >
                Último Mes
              </button>
            </div>
          )}
        </div>

        <div className={`grid grid-cols-1 sm:grid-cols-2 ${dateMode === 'range' ? 'lg:grid-cols-7' : 'lg:grid-cols-6'} gap-4 items-end`}>
          
          {/* Criptomoneda / Modo */}
          <div>
            <label className="block text-xs font-bold text-gray-700 dark:text-gray-300 mb-1">
              🪙 Selección de Par
            </label>
            <select
              value={symbol}
              onChange={(e) => setSymbol(e.target.value)}
              className="w-full px-3 py-2 bg-gray-50 dark:bg-gray-900 border border-gray-300 dark:border-gray-700 rounded-xl text-sm font-semibold text-gray-900 dark:text-white focus:ring-2 focus:ring-indigo-500 outline-none"
            >
              <option value="PORTFOLIO">🌐 TODO EL PORTAFOLIO ({configuredSymbols.length || 8} Monedas)</option>
              <optgroup label="Monedas Configuradas">
                {configuredSymbols.map(s => <option key={s} value={s}>{s}</option>)}
              </optgroup>
              <optgroup label="Otras Monedas Populares">
                {availableSymbols.filter(s => !configuredSymbols.includes(s)).map(s => (
                  <option key={s} value={s}>{s}</option>
                ))}
              </optgroup>
            </select>
          </div>

          {/* Periodo de Tiempo: Modo Relativo vs Modo Rango Calendario */}
          {dateMode === 'relative' ? (
            <div>
              <div className="flex items-center justify-between mb-1">
                <label className="text-xs font-bold text-gray-700 dark:text-gray-300">
                  📅 Periodo ({days} días)
                </label>
              </div>
              <div className="flex items-center gap-1.5">
                <select
                  value={[3, 7, 14, 30, 45, 60, 90, 180, 365].includes(Number(days)) ? days : 'custom'}
                  onChange={(e) => {
                    if (e.target.value !== 'custom') {
                      setDays(Number(e.target.value));
                    }
                  }}
                  className="w-full px-2.5 py-2 bg-gray-50 dark:bg-gray-900 border border-gray-300 dark:border-gray-700 rounded-xl text-xs sm:text-sm font-semibold text-gray-900 dark:text-white focus:ring-2 focus:ring-indigo-500 outline-none"
                >
                  <option value="3">3 días</option>
                  <option value="7">7 días (1 sem)</option>
                  <option value="14">14 días (2 sem)</option>
                  <option value="30">30 días (1 mes)</option>
                  <option value="45">45 días (1.5 meses)</option>
                  <option value="60">60 días (2 meses)</option>
                  <option value="90">90 días (3 meses / Trimestre)</option>
                  <option value="180">180 días (6 meses / Semestre)</option>
                  <option value="365">365 días (1 año completo)</option>
                  <option value="custom">✏️ Personalizado...</option>
                </select>
                <input
                  type="number"
                  min="1"
                  max="730"
                  value={days}
                  onChange={(e) => setDays(Math.max(1, Number(e.target.value)))}
                  className="w-16 px-2 py-2 bg-gray-50 dark:bg-gray-900 border border-gray-300 dark:border-gray-700 rounded-xl text-xs sm:text-sm font-mono font-bold text-center text-gray-900 dark:text-white focus:ring-2 focus:ring-indigo-500 outline-none"
                  title="Escribe cualquier número exacto de días (ej. 45, 60, 90...)"
                />
              </div>
            </div>
          ) : (
            <>
              {/* Fecha Inicio (Desde) */}
              <div>
                <label className="block text-xs font-bold text-gray-700 dark:text-gray-300 mb-1">
                  📅 Fecha Inicio (Desde)
                </label>
                <input
                  type="date"
                  value={startDate}
                  onChange={(e) => setStartDate(e.target.value)}
                  max={endDate || new Date().toISOString().split('T')[0]}
                  className="w-full px-2.5 py-2 bg-gray-50 dark:bg-gray-900 border border-gray-300 dark:border-gray-700 rounded-xl text-xs sm:text-sm font-semibold text-gray-900 dark:text-white focus:ring-2 focus:ring-indigo-500 outline-none"
                />
              </div>

              {/* Fecha Fin (Hasta) */}
              <div>
                <label className="block text-xs font-bold text-gray-700 dark:text-gray-300 mb-1">
                  📅 Fecha Fin (Hasta)
                </label>
                <input
                  type="date"
                  value={endDate}
                  onChange={(e) => setEndDate(e.target.value)}
                  min={startDate}
                  max={new Date().toISOString().split('T')[0]}
                  className="w-full px-2.5 py-2 bg-gray-50 dark:bg-gray-900 border border-gray-300 dark:border-gray-700 rounded-xl text-xs sm:text-sm font-semibold text-gray-900 dark:text-white focus:ring-2 focus:ring-indigo-500 outline-none"
                />
              </div>
            </>
          )}

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
              💰 Capital {symbol === 'PORTFOLIO' ? 'por Moneda' : 'Inicial'} (USDT)
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
                  <span>{symbol === 'PORTFOLIO' ? 'Simulando Portafolio...' : 'Simulando...'}</span>
                </>
              ) : (
                <>
                  <span>⚡</span>
                  <span>{symbol === 'PORTFOLIO' ? 'Test Portafolio' : 'Testear Moneda'}</span>
                </>
              )}
            </button>
          </div>
        </div>
      </div>

      {/* 3. Panel de Resultados (Si se ha ejecutado) */}
      {results && !results.error && (
        <div className="space-y-6 animate-fadeIn">
          
          {/* Header de Resumen de la Simulación */}
          <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 bg-gray-900 border border-indigo-900/50 rounded-2xl p-4 shadow-md">
            <div className="flex items-center flex-wrap gap-2.5">
              <span className="text-base font-extrabold text-white flex items-center gap-1.5">
                <span>{results.is_portfolio ? '🌐 Portafolio Completo' : `🪙 ${results.symbol}`}</span>
              </span>
              <span className="px-2.5 py-0.5 rounded-full text-xs font-bold bg-indigo-950 text-indigo-300 border border-indigo-800">
                ⏱️ {interval}
              </span>
              <span className="px-2.5 py-0.5 rounded-full text-xs font-bold bg-amber-950 text-amber-300 border border-amber-800">
                📅 {results.period_label || `${results.days_tested} días`}
              </span>
              <span className="px-2.5 py-0.5 rounded-full text-xs font-mono font-medium bg-gray-800 text-gray-300 border border-gray-700">
                🕯️ {results.total_candles?.toLocaleString()} velas de Binance
              </span>
            </div>
            {results.is_portfolio && (
              <span className="text-xs text-indigo-300 font-semibold bg-indigo-950/60 px-3 py-1 rounded-xl border border-indigo-800/40">
                ⭐ {results.symbols_count} monedas evaluadas en simultáneo
              </span>
            )}
          </div>
          
          {/* Métricas Principales (KPI Cards) */}
          <div className="grid grid-cols-2 md:grid-cols-4 lg:grid-cols-6 gap-3 sm:gap-4">
            
            {/* PnL Neto */}
            <div className={`p-4 rounded-2xl border shadow-sm ${
              results.net_pnl >= 0
                ? 'bg-emerald-500/10 border-emerald-500/30'
                : 'bg-red-500/10 border-red-500/30'
            }`}>
              <div className="text-[11px] font-bold uppercase tracking-wider text-gray-500 dark:text-gray-400">
                {results.is_portfolio ? 'PnL Total Portafolio' : 'PnL Neto Total'}
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
                Win Rate {results.is_portfolio ? 'Global' : '(% Acierto)'}
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

          {/* 4. TABLA RANKING POR MONEDA (Solo en Modo Portafolio Multimoneda) */}
          {results.is_portfolio && results.symbols_ranking?.length > 0 && (
            <div className="bg-white dark:bg-gray-800 border border-gray-200 dark:border-gray-700 rounded-2xl p-5 shadow-sm">
              <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 mb-4">
                <div className="flex items-center gap-2">
                  <span className="text-lg">🏆</span>
                  <h3 className="font-bold text-gray-900 dark:text-white text-base">
                    Ranking de Rendimiento por Moneda (Mejor a Peor)
                  </h3>
                  <span className="text-xs text-gray-500 dark:text-gray-400">
                    ({results.symbols_ranking.length} pares evaluados)
                  </span>
                </div>
                {symbolFilter !== 'all' && (
                  <button
                    type="button"
                    onClick={() => setSymbolFilter('all')}
                    className="text-xs px-2.5 py-1 bg-indigo-500/20 text-indigo-300 border border-indigo-500/40 rounded-lg hover:bg-indigo-500/30 transition"
                  >
                    ✕ Quitar filtro ({symbolFilter})
                  </button>
                )}
              </div>

              <div className="overflow-x-auto">
                <table className="min-w-full divide-y divide-gray-200 dark:divide-gray-700 text-left">
                  <thead className="bg-gray-50 dark:bg-gray-900 text-gray-500 dark:text-gray-400 text-[11px] uppercase tracking-wider">
                    <tr>
                      <th className="px-3 py-2.5">Puesto</th>
                      <th className="px-3 py-2.5">Par</th>
                      <th className="px-3 py-2.5">PnL Neto</th>
                      <th className="px-3 py-2.5">Retorno %</th>
                      <th className="px-3 py-2.5">Win Rate</th>
                      <th className="px-3 py-2.5 text-center">Trades (G/P)</th>
                      <th className="px-3 py-2.5">Profit Factor</th>
                      <th className="px-3 py-2.5">Max Drawdown</th>
                      <th className="px-3 py-2.5 text-right">Acción</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-gray-200 dark:divide-gray-700/60 font-mono text-xs">
                    {results.symbols_ranking.map((row, idx) => {
                      const medal = idx === 0 ? '🥇' : idx === 1 ? '🥈' : idx === 2 ? '🥉' : `${idx + 1}º`;
                      const isSelected = symbolFilter === row.symbol;
                      return (
                        <tr 
                          key={row.symbol} 
                          className={`transition-colors ${
                            isSelected 
                              ? 'bg-indigo-500/15 dark:bg-indigo-900/30' 
                              : 'hover:bg-gray-50 dark:hover:bg-gray-750'
                          }`}
                        >
                          <td className="px-3 py-2.5 text-sm">{medal}</td>
                          <td className="px-3 py-2.5 font-bold text-gray-900 dark:text-white">
                            {row.symbol}
                          </td>
                          <td className={`px-3 py-2.5 font-bold ${row.net_pnl >= 0 ? 'text-emerald-500 dark:text-emerald-400' : 'text-red-500 dark:text-red-400'}`}>
                            {row.net_pnl >= 0 ? '+' : ''}{row.net_pnl} USDT
                          </td>
                          <td className={`px-3 py-2.5 font-semibold ${row.net_return_pct >= 0 ? 'text-emerald-400' : 'text-red-400'}`}>
                            {row.net_return_pct >= 0 ? '+' : ''}{row.net_return_pct}%
                          </td>
                          <td className="px-3 py-2.5">
                            <span className="font-bold text-gray-900 dark:text-white">{row.win_rate_pct}%</span>
                          </td>
                          <td className="px-3 py-2.5 text-center text-gray-400">
                            {row.total_trades} ({row.winning_trades}G / {row.losing_trades}P)
                          </td>
                          <td className={`px-3 py-2.5 font-bold ${row.profit_factor >= 1.5 ? 'text-emerald-400' : row.profit_factor >= 1.0 ? 'text-amber-400' : 'text-red-400'}`}>
                            {row.profit_factor}
                          </td>
                          <td className="px-3 py-2.5 text-amber-500">
                            -{row.max_drawdown_pct}%
                          </td>
                          <td className="px-3 py-2.5 text-right">
                            <button
                              type="button"
                              onClick={() => setSymbolFilter(isSelected ? 'all' : row.symbol)}
                              className={`px-2 py-0.5 rounded text-[11px] font-sans font-bold transition ${
                                isSelected
                                  ? 'bg-indigo-600 text-white'
                                  : 'bg-gray-200 dark:bg-gray-700 hover:bg-gray-300 dark:hover:bg-gray-600 text-gray-800 dark:text-gray-200'
                              }`}
                            >
                              {isSelected ? '✓ Viendo Trades' : 'Ver Trades'}
                            </button>
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            </div>
          )}

          {/* 5. Gráfico de Curva de Capital */}
          <div className="bg-white dark:bg-gray-800 border border-gray-200 dark:border-gray-700 rounded-2xl p-5 shadow-sm">
            <div className="flex items-center justify-between mb-4">
              <div className="flex items-center gap-2">
                <span className="text-lg">📈</span>
                <h3 className="font-bold text-gray-900 dark:text-white text-base">
                  {results.is_portfolio ? 'Curva de Capital del Portafolio Consolidado' : `Curva de Capital Histórica (${results.symbol})`} ({results.days_tested} días)
                </h3>
              </div>
              <div className="text-xs font-mono text-gray-500 dark:text-gray-400">
                Saldo Final: <b className="text-white">${results.final_balance} USDT</b>
              </div>
            </div>

            {renderEquitySvg()}
          </div>

          {/* 6. Tabla de Operaciones Simuladas */}
          <div className="bg-white dark:bg-gray-800 border border-gray-200 dark:border-gray-700 rounded-2xl p-5 shadow-sm">
            <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 mb-4">
              <div className="flex items-center gap-2">
                <span className="text-lg">📋</span>
                <h3 className="font-bold text-gray-900 dark:text-white text-base">
                  Historial de Operaciones {symbolFilter !== 'all' ? `(${symbolFilter})` : 'Simuladas'} ({filteredTrades.length})
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
                No hay operaciones para los filtros seleccionados o la estrategia no encontró entradas en este periodo.
              </div>
            ) : (
              <div className="overflow-x-auto max-h-96 overflow-y-auto">
                <table className="min-w-full divide-y divide-gray-200 dark:divide-gray-700 text-left">
                  <thead className="bg-gray-50 dark:bg-gray-900 text-gray-500 dark:text-gray-400 text-[11px] uppercase tracking-wider sticky top-0">
                    <tr>
                      <th className="px-3 py-2.5">#</th>
                      {results.is_portfolio && <th className="px-3 py-2.5">Par</th>}
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
                      <tr key={`${t.symbol}_${t.id}`} className="hover:bg-gray-50 dark:hover:bg-gray-750 transition-colors">
                        <td className="px-3 py-2 text-gray-400">{t.id}</td>
                        {results.is_portfolio && (
                          <td className="px-3 py-2">
                            <span className="px-1.5 py-0.5 bg-gray-200 dark:bg-gray-700 rounded font-bold text-[10px] text-gray-800 dark:text-gray-200">
                              {t.symbol?.replace('USDT', '')}
                            </span>
                          </td>
                        )}
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
