import React, { useState, useEffect, useCallback } from 'react';
import { useAuth } from './AuthContext';

export default function InvestorPortfolio() {
  const { authFetch, user } = useAuth();
  const [portfolio, setPortfolio] = useState(null);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState(null);
  const [selectedSliceIndex, setSelectedSliceIndex] = useState(null);

  const fetchPortfolio = useCallback(async () => {
    try {
      setError(null);
      const resp = await authFetch('/api/investor/portfolio');
      if (!resp.ok) {
        throw new Error('No se pudieron obtener los datos de tu inversión.');
      }
      const data = await resp.json();
      setPortfolio(data.portfolio);
    } catch (err) {
      setError(err.message);
    } finally {
      setIsLoading(false);
    }
  }, [authFetch]);

  useEffect(() => {
    fetchPortfolio();
    const interval = setInterval(fetchPortfolio, 10000); // Actualizar cada 10 segundos
    return () => clearInterval(interval);
  }, [fetchPortfolio]);

  if (isLoading && !portfolio) {
    return (
      <div className="flex flex-col items-center justify-center p-12 text-slate-400">
        <div className="w-10 h-10 border-4 border-amber-400 border-t-transparent rounded-full animate-spin mb-4"></div>
        <p className="text-sm font-bold">Cargando portafolio del inversionista...</p>
      </div>
    );
  }

  if (error && !portfolio) {
    return (
      <div className="p-6 bg-rose-500/10 border border-rose-500/30 rounded-2xl text-rose-300 text-center max-w-lg mx-auto my-8">
        <span className="text-3xl block mb-2">⚠️</span>
        <h4 className="font-bold text-base mb-1">Error al cargar datos</h4>
        <p className="text-xs">{error}</p>
        <button
          onClick={fetchPortfolio}
          className="mt-4 px-4 py-2 bg-rose-600 hover:bg-rose-500 text-white rounded-xl text-xs font-bold transition"
        >
          Reintentar
        </button>
      </div>
    );
  }

  const cap = Number(portfolio?.capital_invested || 0);
  const curVal = Number(portfolio?.current_value || 0);
  const netPnl = Number(portfolio?.net_pnl || 0);
  const roi = Number(portfolio?.roi_percentage || 0);
  const share = Number(portfolio?.share_percentage || 0);
  const totalPool = Number(portfolio?.total_pool_balance || 0);
  const isProfit = netPnl >= 0;

  // Paletas de color premium fintech para cada porción del pool
  const SLICE_PALETTES = [
    {
      key: 'gold',
      stroke: '#f59e0b',
      gradId: 'sliceGradGold',
      stops: ['#fbbf24', '#f59e0b', '#d97706'],
      glowFilter: 'neonGlowGold',
      text: 'text-amber-400',
      border: 'border-amber-400/50',
      bg: 'bg-amber-400/15',
      dotBg: 'bg-amber-400',
      badge: 'bg-amber-400/20 text-amber-300 border-amber-400/40'
    },
    {
      key: 'cyan',
      stroke: '#06b6d4',
      gradId: 'sliceGradCyan',
      stops: ['#22d3ee', '#06b6d4', '#0891b2'],
      glowFilter: 'neonGlowCyan',
      text: 'text-cyan-400',
      border: 'border-cyan-400/50',
      bg: 'bg-cyan-400/15',
      dotBg: 'bg-cyan-400',
      badge: 'bg-cyan-400/20 text-cyan-300 border-cyan-400/40'
    },
    {
      key: 'indigo',
      stroke: '#6366f1',
      gradId: 'sliceGradIndigo',
      stops: ['#818cf8', '#6366f1', '#4f46e5'],
      glowFilter: 'neonGlowIndigo',
      text: 'text-indigo-400',
      border: 'border-indigo-400/50',
      bg: 'bg-indigo-400/15',
      dotBg: 'bg-indigo-400',
      badge: 'bg-indigo-400/20 text-indigo-300 border-indigo-400/40'
    },
    {
      key: 'purple',
      stroke: '#a855f7',
      gradId: 'sliceGradPurple',
      stops: ['#c084fc', '#a855f7', '#9333ea'],
      glowFilter: 'neonGlowPurple',
      text: 'text-purple-400',
      border: 'border-purple-400/50',
      bg: 'bg-purple-400/15',
      dotBg: 'bg-purple-400',
      badge: 'bg-purple-400/20 text-purple-300 border-purple-400/40'
    },
    {
      key: 'emerald',
      stroke: '#10b981',
      gradId: 'sliceGradEmerald',
      stops: ['#34d399', '#10b981', '#059669'],
      glowFilter: 'neonGlowEmerald',
      text: 'text-emerald-400',
      border: 'border-emerald-400/50',
      bg: 'bg-emerald-400/15',
      dotBg: 'bg-emerald-400',
      badge: 'bg-emerald-400/20 text-emerald-300 border-emerald-500/40'
    },
    {
      key: 'rose',
      stroke: '#f43f5e',
      gradId: 'sliceGradRose',
      stops: ['#fb7185', '#f43f5e', '#e11d48'],
      glowFilter: 'neonGlowRose',
      text: 'text-rose-400',
      border: 'border-rose-400/50',
      bg: 'bg-rose-400/15',
      dotBg: 'bg-rose-400',
      badge: 'bg-rose-400/20 text-rose-300 border-rose-400/40'
    },
  ];

  // Obtener porciones de la torta del backend (o fallback a la inversión propia)
  const rawSlices = portfolio?.pool_slices && portfolio.pool_slices.length > 0
    ? portfolio.pool_slices
    : [
        {
          label: "Tu Inversión",
          capital: cap,
          current_value: curVal,
          share_percentage: share > 0 ? share : 100,
          net_pnl: netPnl,
          roi_percentage: roi,
          is_self: true
        }
      ];

  // Asignar colores: la inversión propia siempre tiene Oro/Ámbar, las demás rotan colores fintech
  let otherColorCounter = 1;
  const processedSlices = rawSlices.map((s, idx) => {
    let palette;
    if (s.is_self) {
      palette = SLICE_PALETTES[0]; // Oro para el usuario
    } else {
      palette = SLICE_PALETTES[1 + ((otherColorCounter - 1) % (SLICE_PALETTES.length - 1))];
      otherColorCounter++;
    }
    return {
      ...s,
      palette,
      originalIndex: idx
    };
  });

  const selfIndex = processedSlices.findIndex(s => s.is_self);
  const activeIndex = selectedSliceIndex !== null && selectedSliceIndex >= 0 && selectedSliceIndex < processedSlices.length
    ? selectedSliceIndex
    : (selfIndex >= 0 ? selfIndex : 0);

  const activeSlice = processedSlices[activeIndex] || processedSlices[0];

  // Geometría SVG para Donut Multi-Porciones
  const outerRadius = 80;
  const outerCircumference = 2 * Math.PI * outerRadius; // ~502.65
  const totalShareSum = processedSlices.reduce((sum, s) => sum + (Number(s.share_percentage) || 0), 0) || 100;

  let accumulatedFrac = 0;
  const svgSlices = processedSlices.map((s) => {
    const frac = (Number(s.share_percentage) || 0) / totalShareSum;
    const arcLength = frac * outerCircumference;
    const gap = processedSlices.length > 1 ? Math.min(2.5, arcLength * 0.1) : 0;
    const visibleLength = Math.max(0.5, arcLength - gap);
    const strokeDasharray = `${visibleLength} ${outerCircumference - visibleLength}`;
    const strokeDashoffset = -(accumulatedFrac * outerCircumference);
    accumulatedFrac += frac;

    return {
      ...s,
      strokeDasharray,
      strokeDashoffset,
      visibleLength
    };
  });

  // Aro Interior: Ingrediente de Rendimiento del slice seleccionado
  const innerRadius = 60;
  const innerCircumference = 2 * Math.PI * innerRadius;
  const activeCap = Number(activeSlice.capital || 0);
  const activeCurVal = Number(activeSlice.current_value || 0);
  const activePnl = Number(activeSlice.net_pnl || 0);
  const activeRoi = Number(activeSlice.roi_percentage || 0);
  const activeIsProfit = activePnl >= 0;
  const activeYieldPct = activeCap > 0 
    ? (activeIsProfit ? Math.min(100, Math.max(8, (activePnl / activeCap) * 300)) : 0)
    : 0;
  const innerOffset = innerCircumference - (activeYieldPct / 100) * innerCircumference;

  return (
    <div className="space-y-6 max-w-7xl mx-auto">
      
      {/* Encabezado del Inversionista */}
      <div className="bg-slate-900 border border-slate-800 rounded-3xl p-5 sm:p-6 shadow-xl flex flex-col md:flex-row items-start md:items-center justify-between gap-4">
        <div>
          <div className="flex flex-wrap items-center gap-2.5 mb-1.5">
            <span className="text-2xl">🥧</span>
            <h2 className="text-xl sm:text-2xl font-black text-white tracking-tight">
              Mi Inversión & Rendimiento
            </h2>
            <span className="px-2.5 py-0.5 rounded-full text-[11px] font-black bg-amber-400/10 text-amber-300 border border-amber-400/30 uppercase tracking-wider">
              Solo Lectura
            </span>
            <span className="px-2.5 py-0.5 rounded-md text-xs font-mono font-bold bg-slate-950 text-amber-400 border border-slate-700 shadow-inner">
              Cuenta: {portfolio?.account_number || user?.account_number || 'WTN-2026-0000'}
            </span>
          </div>
          <p className="text-xs text-slate-400">
            Inversionista: <strong className="text-white">{user?.username}</strong> {user?.email ? `(${user.email})` : ''} • Fondo gestionado por <strong className="text-slate-300">WTN Solutions LLC</strong> sincronizado en vivo con Binance Futures.
          </p>
        </div>

        {/* Indicador de Estado Activo: GESTIONANDO */}
        <div className="flex items-center gap-3 self-start md:self-auto bg-slate-950/90 border border-emerald-500/40 px-4 py-2.5 rounded-2xl shadow-xl shadow-emerald-500/10">
          <div className="relative flex items-center justify-center w-3.5 h-3.5">
            <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-emerald-400 opacity-75"></span>
            <span className="relative inline-flex rounded-full h-2.5 w-2.5 bg-emerald-500"></span>
          </div>
          <div className="flex flex-col text-left">
            <div className="flex items-center gap-2">
              <span className="text-xs font-mono font-black text-emerald-400 tracking-wider">
                GESTIONANDO
              </span>
              <span className="px-1.5 py-0.5 bg-emerald-500/20 text-emerald-300 rounded text-[9px] font-black uppercase tracking-wider border border-emerald-500/30">
                En Vivo 24/7
              </span>
            </div>
            <span className="text-[10px] text-slate-400 font-medium">
              Supervisión Cuantitativa Institucional
            </span>
          </div>
        </div>
      </div>

      {/* Tarjetas KPI de Rendimiento */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3 sm:gap-4">
        {/* KPI 1: Capital Invertido */}
        <div className="bg-slate-900 border border-slate-800 rounded-2xl p-4 sm:p-5 shadow-lg">
          <div className="flex items-center justify-between text-slate-400 text-xs font-bold uppercase tracking-wider mb-2">
            <span>Capital Depositado</span>
            <span className="text-amber-400">💰</span>
          </div>
          <div className="text-xl sm:text-2xl font-black font-mono text-white">
            ${cap.toFixed(2)} <span className="text-xs text-slate-400 font-normal">USDT</span>
          </div>
          <div className="text-[11px] text-slate-400 mt-1 font-medium">
            Total neto de tus aportes
          </div>
        </div>

        {/* KPI 2: Valor Actual */}
        <div className="bg-slate-900 border border-slate-800 rounded-2xl p-4 sm:p-5 shadow-lg">
          <div className="flex items-center justify-between text-slate-400 text-xs font-bold uppercase tracking-wider mb-2">
            <span>Valor Actual Estimado</span>
            <span className="text-cyan-400">📈</span>
          </div>
          <div className="text-xl sm:text-2xl font-black font-mono text-cyan-400">
            ${curVal.toFixed(2)} <span className="text-xs text-slate-400 font-normal">USDT</span>
          </div>
          <div className="text-[11px] text-slate-400 mt-1 font-medium">
            Tu valor liquidable hoy
          </div>
        </div>

        {/* KPI 3: Ganancia Neta */}
        <div className="bg-slate-900 border border-slate-800 rounded-2xl p-4 sm:p-5 shadow-lg">
          <div className="flex items-center justify-between text-slate-400 text-xs font-bold uppercase tracking-wider mb-2">
            <span>Ganancia Neta ($)</span>
            <span>{isProfit ? '🟢' : '🔴'}</span>
          </div>
          <div className={`text-xl sm:text-2xl font-black font-mono ${isProfit ? 'text-emerald-400' : 'text-rose-400'}`}>
            {isProfit ? '+' : ''}${netPnl.toFixed(2)} <span className="text-xs text-slate-400 font-normal">USDT</span>
          </div>
          <div className="text-[11px] text-slate-400 mt-1 font-medium">
            {isProfit ? 'Ganancia generada por el bot' : 'Drawdown de mercado'}
          </div>
        </div>

        {/* KPI 4: Rentabilidad ROI % */}
        <div className="bg-slate-900 border border-slate-800 rounded-2xl p-4 sm:p-5 shadow-lg">
          <div className="flex items-center justify-between text-slate-400 text-xs font-bold uppercase tracking-wider mb-2">
            <span>Retorno de Inversión</span>
            <span>🚀</span>
          </div>
          <div className={`text-xl sm:text-2xl font-black font-mono ${isProfit ? 'text-emerald-400' : 'text-rose-400'}`}>
            {isProfit ? '+' : ''}{roi.toFixed(2)}%
          </div>
          <div className="text-[11px] text-slate-400 mt-1 font-medium">
            Cuota del fondo: <strong className="text-amber-300">{share.toFixed(2)}%</strong>
          </div>
        </div>
      </div>

      {/* Gráfico Dinámico de Torta Multi-Porciones & Comparativa Anónima */}
      <div className="grid grid-cols-1 lg:grid-cols-12 gap-6">
        
        {/* Tarjeta de Torta Dinámica Neón con Todas las Porciones del Pool */}
        <div className="lg:col-span-5 bg-slate-900 border border-slate-800 rounded-3xl p-5 sm:p-6 shadow-xl flex flex-col items-center justify-between text-center relative overflow-hidden">
          <div className="absolute top-0 right-0 w-36 h-36 bg-amber-500/10 rounded-full blur-3xl pointer-events-none"></div>
          <div className="absolute bottom-0 left-0 w-36 h-36 bg-cyan-500/10 rounded-full blur-3xl pointer-events-none"></div>

          <div className="w-full flex items-center justify-between mb-2 z-10">
            <h3 className="text-sm font-extrabold uppercase tracking-wider text-slate-200 flex items-center gap-2">
              <span>🥧</span> Torta de Inversiones del Pool
            </h3>
            <span className="px-2 py-0.5 rounded-full text-[10px] font-mono font-bold bg-amber-400/10 text-amber-300 border border-amber-400/30">
              {processedSlices.length} {processedSlices.length === 1 ? 'cuenta' : 'cuentas'}
            </span>
          </div>

          {/* Gráfico SVG Multi-Slice con Efectos Neón y Pistas Interactivas */}
          <div className="relative flex items-center justify-center my-3 z-10">
            <svg className="w-60 h-60 transform -rotate-90">
              <defs>
                {/* Gradientes y filtros para cada paleta de porciones */}
                {SLICE_PALETTES.map((pal) => (
                  <React.Fragment key={pal.key}>
                    <linearGradient id={pal.gradId} x1="0%" y1="0%" x2="100%" y2="100%">
                      <stop offset="0%" stopColor={pal.stops[0]} />
                      <stop offset="50%" stopColor={pal.stops[1]} />
                      <stop offset="100%" stopColor={pal.stops[2]} />
                    </linearGradient>
                    <filter id={pal.glowFilter} x="-20%" y="-20%" width="140%" height="140%">
                      <feGaussianBlur stdDeviation="3.5" result="blur" />
                      <feMerge>
                        <feMergeNode in="blur" />
                        <feMergeNode in="SourceGraphic" />
                      </feMerge>
                    </filter>
                  </React.Fragment>
                ))}

                <linearGradient id="profitYieldGrad" x1="0%" y1="0%" x2="100%" y2="100%">
                  <stop offset="0%" stopColor="#10b981" />
                  <stop offset="50%" stopColor="#34d399" />
                  <stop offset="100%" stopColor="#059669" />
                </linearGradient>

                <linearGradient id="trackGrad" x1="0%" y1="0%" x2="100%" y2="100%">
                  <stop offset="0%" stopColor="#1e293b" />
                  <stop offset="100%" stopColor="#0f172a" />
                </linearGradient>

                <filter id="neonGlowGreen" x="-20%" y="-20%" width="140%" height="140%">
                  <feGaussianBlur stdDeviation="4" result="blur" />
                  <feMerge>
                    <feMergeNode in="blur" />
                    <feMergeNode in="SourceGraphic" />
                  </feMerge>
                </filter>
              </defs>

              {/* 1. Aro Exterior: Pista Base */}
              <circle
                cx="120"
                cy="120"
                r={outerRadius}
                stroke="url(#trackGrad)"
                strokeWidth="14"
                fill="transparent"
              />

              {/* 1. Aro Exterior: Porciones de cada Inversión del Pool */}
              {svgSlices.map((s) => {
                const isSelected = activeIndex === s.originalIndex;
                return (
                  <circle
                    key={s.originalIndex}
                    cx="120"
                    cy="120"
                    r={outerRadius}
                    stroke={`url(#${s.palette.gradId})`}
                    strokeWidth={isSelected ? 18 : 13}
                    strokeDasharray={s.strokeDasharray}
                    strokeDashoffset={s.strokeDashoffset}
                    fill="transparent"
                    filter={isSelected ? `url(#${s.palette.glowFilter})` : undefined}
                    onClick={() => setSelectedSliceIndex(s.originalIndex)}
                    onMouseEnter={() => setSelectedSliceIndex(s.originalIndex)}
                    className="cursor-pointer transition-all duration-300 ease-out hover:opacity-90"
                  />
                );
              })}

              {/* 2. Aro Interior: Pista Base del Rendimiento */}
              <circle
                cx="120"
                cy="120"
                r={innerRadius}
                stroke="#0f172a"
                strokeWidth="9"
                fill="transparent"
              />

              {/* 2. Aro Interior: Ingrediente de Rendimiento del slice seleccionado */}
              {activeIsProfit && activePnl > 0 && (
                <circle
                  cx="120"
                  cy="120"
                  r={innerRadius}
                  stroke="url(#profitYieldGrad)"
                  strokeWidth="9"
                  strokeDasharray={innerCircumference}
                  strokeDashoffset={innerOffset}
                  strokeLinecap="round"
                  fill="transparent"
                  filter="url(#neonGlowGreen)"
                  className="transition-all duration-1000 ease-out animate-pulse"
                />
              )}
            </svg>

            {/* Núcleo Central de la Torta con Inspección Dinámica */}
            <div className="absolute flex flex-col items-center justify-center pointer-events-none">
              <div className="w-32 h-32 rounded-full bg-slate-950/95 border border-slate-700/80 flex flex-col items-center justify-center shadow-2xl p-2 text-center">
                <span className={`text-[9px] font-black uppercase tracking-wider px-2 py-0.5 rounded-full border ${activeSlice.palette.badge}`}>
                  {activeSlice.is_self ? '⭐ Tu Inversión' : activeSlice.label}
                </span>
                <span className="text-sm sm:text-base font-black font-mono text-white tracking-tight mt-1">
                  ${activeCurVal.toFixed(2)}
                </span>
                <span className={`text-[10px] font-mono font-black ${activeIsProfit ? 'text-emerald-400' : 'text-rose-400'}`}>
                  {activeIsProfit ? '+' : ''}${activePnl.toFixed(2)} ({activeIsProfit ? '+' : ''}{activeRoi.toFixed(2)}%)
                </span>
                <span className="text-[8px] font-mono font-bold text-slate-400 uppercase tracking-wider mt-0.5">
                  {Number(activeSlice.share_percentage).toFixed(1)}% del Fondo
                </span>
              </div>
            </div>
          </div>

          {/* Selector / Leyenda Rápida de Porciones */}
          <div className="w-full mt-3 pt-3 border-t border-slate-800 z-10">
            <div className="flex items-center justify-between text-[11px] font-bold text-slate-400 mb-2">
              <span>Porciones del Pool:</span>
              {activeIndex !== selfIndex && (
                <button
                  onClick={() => setSelectedSliceIndex(selfIndex)}
                  className="text-[10px] font-bold text-amber-400 hover:text-amber-300 underline transition"
                >
                  Volver a Mi Inversión
                </button>
              )}
            </div>
            <div className="flex flex-wrap gap-1.5 justify-center">
              {svgSlices.map((s) => (
                <button
                  key={s.originalIndex}
                  onClick={() => setSelectedSliceIndex(s.originalIndex)}
                  className={`px-2 py-1 rounded-lg text-[10px] font-bold font-mono transition-all flex items-center gap-1.5 border ${
                    activeIndex === s.originalIndex
                      ? `${s.palette.bg} ${s.palette.text} ${s.palette.border} ring-1 ring-amber-400/30 scale-105`
                      : 'bg-slate-950/70 text-slate-400 border-slate-800 hover:border-slate-700'
                  }`}
                >
                  <span className={`w-2 h-2 rounded-full ${s.palette.dotBg}`}></span>
                  <span>{s.is_self ? '⭐ Tú' : s.label}</span>
                  <span className="text-slate-500 font-normal">({Number(s.share_percentage).toFixed(1)}%)</span>
                </button>
              ))}
            </div>
          </div>
        </div>

        {/* Comparativa de Inversiones en el Fondo (100% Anónimo) */}
        <div className="lg:col-span-7 bg-slate-900 border border-slate-800 rounded-3xl p-5 sm:p-6 shadow-xl flex flex-col justify-between">
          <div>
            <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2 mb-4 pb-3 border-b border-slate-800">
              <div>
                <h3 className="text-sm font-black uppercase tracking-wider text-slate-200 flex items-center gap-2">
                  <span>📊</span> Comparativa de Inversiones en el Pool
                </h3>
                <p className="text-[11px] text-slate-400 mt-0.5">
                  Compara el rendimiento y cuota de tu inversión con las demás carteras del fondo institucional (100% anónimo).
                </p>
              </div>
              <span className="px-2.5 py-1 rounded-full text-[10px] font-mono font-bold bg-slate-950 text-slate-300 border border-slate-800 self-start sm:self-auto">
                Total Fondo: ${totalPool.toFixed(2)} USDT
              </span>
            </div>

            {/* Lista/Grid de Tarjetas Comparativas */}
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 max-h-[380px] overflow-y-auto pr-1 no-scrollbar">
              {processedSlices.map((s) => {
                const isSelected = activeIndex === s.originalIndex;
                const sCap = Number(s.capital || 0);
                const sCurVal = Number(s.current_value || 0);
                const sPnl = Number(s.net_pnl || 0);
                const sRoi = Number(s.roi_percentage || 0);
                const sProfit = sPnl >= 0;
                const sShare = Number(s.share_percentage || 0);

                return (
                  <div
                    key={s.originalIndex}
                    onClick={() => setSelectedSliceIndex(s.originalIndex)}
                    className={`cursor-pointer rounded-2xl p-3.5 transition-all duration-200 border relative overflow-hidden flex flex-col justify-between ${
                      s.is_self
                        ? (isSelected 
                            ? 'bg-amber-500/15 border-amber-400 shadow-lg shadow-amber-500/20 ring-1 ring-amber-400/40' 
                            : 'bg-amber-500/5 border-amber-500/40 hover:border-amber-400/70')
                        : (isSelected
                            ? 'bg-slate-800/90 border-cyan-400 shadow-lg shadow-cyan-500/15 ring-1 ring-cyan-400/30'
                            : 'bg-slate-950/70 border-slate-800/90 hover:border-slate-700 hover:bg-slate-800/30')
                    }`}
                  >
                    {/* Header del slice */}
                    <div className="flex items-center justify-between mb-2">
                      <div className="flex items-center gap-1.5">
                        <span className={`w-2.5 h-2.5 rounded-full ${s.palette.dotBg} shadow-sm`}></span>
                        <span className={`text-xs font-black tracking-wide ${s.is_self ? 'text-amber-300' : 'text-slate-200'}`}>
                          {s.is_self ? '⭐ Tu Inversión' : s.label}
                        </span>
                        {s.is_self && (
                          <span className="px-1.5 py-0.2 rounded-full text-[9px] font-black bg-amber-400/20 text-amber-300 border border-amber-400/40 uppercase tracking-wider">
                            Tú
                          </span>
                        )}
                      </div>
                      <span className="text-xs font-mono font-black text-slate-300">
                        {sShare.toFixed(2)}%
                      </span>
                    </div>

                    {/* Números: Capital vs Valor Actual */}
                    <div className="grid grid-cols-2 gap-2 my-2 py-2 border-y border-slate-800/60 text-left">
                      <div>
                        <div className="text-[9px] uppercase font-bold text-slate-500 tracking-wider">Capital Invertido</div>
                        <div className="text-xs font-mono font-bold text-slate-300">
                          ${sCap.toFixed(2)} <span className="text-[8px] text-slate-500 font-normal">USDT</span>
                        </div>
                      </div>
                      <div className="text-right">
                        <div className="text-[9px] uppercase font-bold text-slate-500 tracking-wider">Valor Actual</div>
                        <div className="text-xs font-mono font-bold text-white">
                          ${sCurVal.toFixed(2)} <span className="text-[8px] text-slate-500 font-normal">USDT</span>
                        </div>
                      </div>
                    </div>

                    {/* Fila Rendimiento PnL & ROI */}
                    <div className="flex items-center justify-between pt-1">
                      <div className="flex items-center gap-1 text-[10px] text-slate-400">
                        <span>P&L:</span>
                        <span className={`font-mono font-bold ${sProfit ? 'text-emerald-400' : 'text-rose-400'}`}>
                          {sProfit ? '+' : ''}${sPnl.toFixed(2)}
                        </span>
                      </div>
                      <span className={`text-[10px] font-mono font-black px-1.5 py-0.5 rounded ${
                        sProfit ? 'bg-emerald-500/15 text-emerald-300 border border-emerald-500/20' : 'bg-rose-500/15 text-rose-300 border border-rose-500/20'
                      }`}>
                        {sProfit ? '+' : ''}{sRoi.toFixed(2)}% ROI
                      </span>
                    </div>

                    {/* Barra de cuota relativa */}
                    <div className="w-full bg-slate-900 rounded-full h-1 mt-2.5 overflow-hidden">
                      <div
                        className={`h-full rounded-full transition-all duration-500 ${s.palette.dotBg}`}
                        style={{ width: `${Math.max(4, Math.min(100, sShare))}%` }}
                      ></div>
                    </div>
                  </div>
                );
              })}
            </div>
          </div>

          <div className="mt-4 pt-3 border-t border-slate-800 text-[11px] text-slate-500 flex flex-wrap items-center justify-between gap-2">
            <span>🔒 Cumplimiento estricto: identidades 100% anonimizadas para resguardo de capital.</span>
            <span className="text-amber-400/80 font-medium">Toca cualquier tarjeta para resaltarla en la torta</span>
          </div>
        </div>
      </div>

      {/* Historial de Movimientos de Capital */}
      <div className="bg-slate-900 border border-slate-800 rounded-3xl p-6 shadow-xl flex flex-col justify-between">
        <div>
          <div className="flex items-center justify-between mb-4">
            <h3 className="text-sm font-bold uppercase tracking-wider text-slate-300 flex items-center gap-2">
              <span>📋</span> Historial de Movimientos de Capital
            </h3>
            <span className="text-xs text-slate-500 font-mono">
              {portfolio?.transactions?.length || 0} movimientos
            </span>
          </div>

          <div className="overflow-x-auto max-h-72 no-scrollbar">
            <table className="w-full text-left border-collapse">
              <thead>
                <tr className="border-b border-slate-800 text-[11px] font-bold uppercase text-slate-400">
                  <th className="py-2.5 px-3">Fecha</th>
                  <th className="py-2.5 px-3">Tipo</th>
                  <th className="py-2.5 px-3 text-right">Monto</th>
                  <th className="py-2.5 px-3">Notas</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-800/60 text-xs">
                {(portfolio?.transactions || []).length === 0 ? (
                  <tr>
                    <td colSpan="4" className="py-8 text-center text-slate-500">
                      No hay movimientos de capital registrados para esta cuenta.
                    </td>
                  </tr>
                ) : (
                  portfolio.transactions.map((tx) => {
                    const isWd = tx.transaction_type === 'WITHDRAWAL';
                    return (
                      <tr key={tx.id} className="hover:bg-slate-800/40 transition">
                        <td className="py-2.5 px-3 text-slate-400 font-mono text-[11px]">
                          {tx.created_at || '-'}
                        </td>
                        <td className="py-2.5 px-3">
                          <span className={`px-2 py-0.5 rounded-full text-[10px] font-extrabold ${
                            isWd ? 'bg-rose-500/10 text-rose-300 border border-rose-500/30' : 'bg-emerald-500/10 text-emerald-300 border border-emerald-500/30'
                          }`}>
                            {tx.transaction_type === 'INITIAL' ? 'Aporte Inicial' : (isWd ? 'Retiro' : 'Depósito')}
                          </span>
                        </td>
                        <td className="py-2.5 px-3 text-right font-mono font-bold text-white">
                          {isWd ? '-' : '+'}${Number(tx.amount_usdt).toFixed(2)}
                        </td>
                        <td className="py-2.5 px-3 text-slate-400 text-xs">
                          {tx.notes || '-'}
                        </td>
                      </tr>
                    );
                  })
                )}
              </tbody>
            </table>
          </div>
        </div>

        <div className="mt-4 pt-3 border-t border-slate-800 text-[11px] text-slate-500 flex items-center justify-between">
          <span>🔒 Tus datos están aislados y protegidos por privacidad institucional.</span>
          <span>Refresco cada 10s</span>
        </div>
      </div>
    </div>
  );
}
