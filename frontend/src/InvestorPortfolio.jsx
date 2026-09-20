import React, { useState, useEffect, useCallback } from 'react';
import { useAuth } from './AuthContext';

export default function InvestorPortfolio() {
  const { authFetch, user } = useAuth();
  const [portfolio, setPortfolio] = useState(null);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState(null);

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

  // CÁLCULOS PARA LA TORTA DINÁMICA MULTI-INGREDIENTE
  // 1. Aro Exterior: Cuota en el Fondo Total Binance (Radio 80)
  const outerRadius = 80;
  const outerCircumference = 2 * Math.PI * outerRadius;
  const outerOffset = outerCircumference - (Math.min(100, Math.max(0, share)) / 100) * outerCircumference;

  // 2. Aro Interior: Ingrediente Ganancia Neta Recuperada / Retorno sobre Capital (Radio 62)
  const innerRadius = 62;
  const innerCircumference = 2 * Math.PI * innerRadius;
  // Representación visual atractiva del rendimiento generado sobre el capital
  const profitPercentage = cap > 0 ? (Math.max(0, netPnl) / cap) * 100 : 0;
  const visualYieldPct = isProfit && netPnl > 0 
    ? Math.min(100, Math.max(8, Math.min(100, profitPercentage * 3))) 
    : 0;
  const innerOffset = innerCircumference - (visualYieldPct / 100) * innerCircumference;

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

        {/* Indicador de Estado Activo: GESTIONANDO (Ubicado en el encabezado principal) */}
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

      {/* Gráfico Dinámico de Torta con Ingredientes vs Historial */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        
        {/* Tarjeta de Torta Dinámica Neón: Ingredientes de Capital & Ganancias */}
        <div className="bg-slate-900 border border-slate-800 rounded-3xl p-5 sm:p-6 shadow-xl flex flex-col items-center justify-between text-center relative overflow-hidden">
          <div className="absolute top-0 right-0 w-36 h-36 bg-amber-500/10 rounded-full blur-3xl pointer-events-none"></div>
          <div className="absolute bottom-0 left-0 w-36 h-36 bg-emerald-500/10 rounded-full blur-3xl pointer-events-none"></div>

          <div className="w-full flex items-center justify-between mb-2 z-10">
            <h3 className="text-sm font-extrabold uppercase tracking-wider text-slate-200 flex items-center gap-2">
              <span>🥧</span> Composición de tu Inversión
            </h3>
            <span className="px-2 py-0.5 rounded-full text-[10px] font-mono font-bold bg-amber-400/10 text-amber-300 border border-amber-400/30">
              {share.toFixed(1)}% Pool
            </span>
          </div>

          {/* Gráfico SVG Dual Ring con Efectos Neón */}
          <div className="relative flex items-center justify-center my-2 z-10">
            <svg className="w-56 h-56 transform -rotate-90">
              <defs>
                {/* Gradiente Ámbar para Cuota en Pool Binance */}
                <linearGradient id="userShareGrad" x1="0%" y1="0%" x2="100%" y2="100%">
                  <stop offset="0%" stopColor="#f59e0b" />
                  <stop offset="50%" stopColor="#fbbf24" />
                  <stop offset="100%" stopColor="#d97706" />
                </linearGradient>

                {/* Gradiente Esmeralda Neón para el Ingrediente de Ganancia */}
                <linearGradient id="profitYieldGrad" x1="0%" y1="0%" x2="100%" y2="100%">
                  <stop offset="0%" stopColor="#10b981" />
                  <stop offset="50%" stopColor="#34d399" />
                  <stop offset="100%" stopColor="#059669" />
                </linearGradient>

                <linearGradient id="trackGrad" x1="0%" y1="0%" x2="100%" y2="100%">
                  <stop offset="0%" stopColor="#1e293b" />
                  <stop offset="100%" stopColor="#0f172a" />
                </linearGradient>

                <filter id="neonGlowGold" x="-20%" y="-20%" width="140%" height="140%">
                  <feGaussianBlur stdDeviation="3" result="blur" />
                  <feMerge>
                    <feMergeNode in="blur" />
                    <feMergeNode in="SourceGraphic" />
                  </feMerge>
                </filter>

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
                cx="112"
                cy="112"
                r={outerRadius}
                stroke="url(#trackGrad)"
                strokeWidth="14"
                fill="transparent"
              />
              {/* 1. Aro Exterior: Cuota del Pool Binance */}
              {share > 0 && (
                <circle
                  cx="112"
                  cy="112"
                  r={outerRadius}
                  stroke="url(#userShareGrad)"
                  strokeWidth="14"
                  strokeDasharray={outerCircumference}
                  strokeDashoffset={outerOffset}
                  strokeLinecap="round"
                  fill="transparent"
                  filter="url(#neonGlowGold)"
                  className="transition-all duration-1000 ease-out"
                />
              )}

              {/* 2. Aro Interior: Pista Base */}
              <circle
                cx="112"
                cy="112"
                r={innerRadius}
                stroke="#0f172a"
                strokeWidth="11"
                fill="transparent"
              />
              {/* 2. Aro Interior: Ingrediente Ganancia Neta Recuperada */}
              {isProfit && netPnl > 0 && (
                <circle
                  cx="112"
                  cy="112"
                  r={innerRadius}
                  stroke="url(#profitYieldGrad)"
                  strokeWidth="11"
                  strokeDasharray={innerCircumference}
                  strokeDashoffset={innerOffset}
                  strokeLinecap="round"
                  fill="transparent"
                  filter="url(#neonGlowGreen)"
                  className="transition-all duration-1000 ease-out animate-pulse"
                />
              )}
            </svg>

            {/* Núcleo Central de la Torta */}
            <div className="absolute flex flex-col items-center justify-center pointer-events-none">
              <div className="w-28 h-28 rounded-full bg-slate-950/95 border border-slate-700/80 flex flex-col items-center justify-center shadow-2xl p-2">
                <span className="text-xs">⚡</span>
                <span className="text-base sm:text-lg font-black font-mono text-white tracking-tight mt-0.5">
                  ${curVal.toFixed(2)}
                </span>
                <span className={`text-[10px] font-mono font-black ${isProfit ? 'text-emerald-400' : 'text-rose-400'}`}>
                  {isProfit ? '+' : ''}${netPnl.toFixed(2)}
                </span>
                <span className="text-[8px] font-bold text-slate-400 uppercase tracking-widest mt-0.5">
                  Valor Liquidable
                </span>
              </div>
            </div>
          </div>

          {/* Desglose de los 2 Ingredientes de la Torta */}
          <div className="w-full mt-3 pt-3 border-t border-slate-800 space-y-2 text-left z-10">
            {/* Ingrediente 1: Capital Base Depositado */}
            <div className="p-2.5 bg-slate-950/70 border border-amber-500/20 rounded-xl flex items-center justify-between">
              <div className="flex items-center gap-2">
                <div className="w-6 h-6 rounded-lg bg-amber-400/10 border border-amber-400/30 flex items-center justify-center text-amber-400 text-xs">
                  🪙
                </div>
                <div>
                  <div className="text-[11px] font-bold text-slate-200">Capital Base Depositado</div>
                  <div className="text-[9px] text-slate-400">Tu dinero aportado original</div>
                </div>
              </div>
              <div className="text-right">
                <div className="font-mono font-black text-amber-300 text-xs">
                  ${cap.toFixed(2)} <span className="text-[9px] text-slate-400 font-normal">USDT</span>
                </div>
                <span className="text-[9px] font-bold text-slate-500">Base</span>
              </div>
            </div>

            {/* Ingrediente 2: Ganancia Producida por el Bot */}
            <div className="p-2.5 bg-emerald-950/20 border border-emerald-500/30 rounded-xl flex items-center justify-between relative overflow-hidden">
              <div className="absolute right-0 top-0 bottom-0 w-1 bg-emerald-400"></div>
              <div className="flex items-center gap-2">
                <div className="w-6 h-6 rounded-lg bg-emerald-400/10 border border-emerald-400/30 flex items-center justify-center text-emerald-400 text-xs">
                  ✨
                </div>
                <div>
                  <div className="text-[11px] font-bold text-emerald-300 flex items-center gap-1">
                    <span>Ganancia del Bot</span>
                    <span className="w-1.5 h-1.5 rounded-full bg-emerald-400 animate-ping"></span>
                  </div>
                  <div className="text-[9px] text-slate-400">Recuperando & sumando a tu torta</div>
                </div>
              </div>
              <div className="text-right">
                <div className="font-mono font-black text-emerald-400 text-xs">
                  {isProfit ? '+' : ''}${netPnl.toFixed(2)} <span className="text-[9px] text-slate-400 font-normal">USDT</span>
                </div>
                <div className="text-[9px] font-mono font-black text-emerald-300">
                  {isProfit ? '+' : ''}{roi.toFixed(2)}% ROI
                </div>
              </div>
            </div>

            {/* Cuota Total en Binance */}
            <div className="flex items-center justify-between pt-1 px-1 text-[10px] text-slate-400">
              <span className="flex items-center gap-1">
                <span className="w-2.5 h-2.5 rounded-full bg-amber-400"></span>
                Participación en el Pool Binance:
              </span>
              <span className="font-mono font-bold text-slate-200">
                {share.toFixed(2)}% de ${totalPool.toFixed(2)} USDT
              </span>
            </div>
          </div>
        </div>

        {/* Historial de Movimientos de Capital */}
        <div className="lg:col-span-2 bg-slate-900 border border-slate-800 rounded-3xl p-6 shadow-xl flex flex-col justify-between">
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
    </div>
  );
}
