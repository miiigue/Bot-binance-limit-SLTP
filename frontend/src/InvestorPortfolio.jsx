import React, { useState, useEffect, useCallback } from 'react';
import { useAuth } from './AuthContext';

export default function InvestorPortfolio() {
  const { authFetch, user } = useAuth();
  const [portfolio, setPortfolio] = useState(null);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState(null);
  const [isDownloadingPdf, setIsDownloadingPdf] = useState(false);

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

  // Generación y descarga del Estado de Cuenta Oficial (PDF imprimible)
  const handleDownloadStatement = async () => {
    setIsDownloadingPdf(true);
    try {
      const resp = await authFetch('/api/investor/statement');
      if (!resp.ok) {
        throw new Error('Error al obtener datos del extracto.');
      }
      const { statement } = await resp.json();
      const p = statement.portfolio;
      const trades = statement.recent_trades || [];

      // Crear ventana para documento imprimible / guardar como PDF
      const printWindow = window.open('', '_blank');
      if (!printWindow) {
        alert('Por favor permite ventanas emergentes para generar el documento PDF.');
        setIsDownloadingPdf(false);
        return;
      }

      const isProfit = (p.net_pnl || 0) >= 0;
      const rowsHtml = (p.transactions || []).map(t => `
        <tr style="border-bottom: 1px solid #e2e8f0;">
          <td style="padding: 8px 12px; font-size: 12px;">${t.created_at || '-'}</td>
          <td style="padding: 8px 12px; font-size: 12px; font-weight: bold; color: ${t.transaction_type === 'WITHDRAWAL' ? '#e11d48' : '#059669'};">
            ${t.transaction_type === 'INITIAL' ? 'Aporte Inicial' : (t.transaction_type === 'DEPOSIT' ? 'Depósito Adicional' : 'Retiro')}
          </td>
          <td style="padding: 8px 12px; font-size: 12px; font-family: monospace; font-weight: bold; text-align: right;">
            $${Number(t.amount_usdt).toFixed(2)} USDT
          </td>
          <td style="padding: 8px 12px; font-size: 12px; color: #64748b;">${t.notes || '-'}</td>
        </tr>
      `).join('');

      const tradesHtml = trades.slice(0, 15).map(tr => `
        <tr style="border-bottom: 1px solid #f1f5f9;">
          <td style="padding: 6px 10px; font-size: 11px;">${tr.close_timestamp || tr.open_timestamp || '-'}</td>
          <td style="padding: 6px 10px; font-size: 11px; font-weight: bold;">${tr.symbol}</td>
          <td style="padding: 6px 10px; font-size: 11px;">${tr.trade_type}</td>
          <td style="padding: 6px 10px; font-size: 11px; font-family: monospace; text-align: right; font-weight: bold; color: ${(tr.pnl_usdt || 0) >= 0 ? '#059669' : '#e11d48'};">
            ${(tr.pnl_usdt || 0) >= 0 ? '+' : ''}${Number(tr.pnl_usdt || 0).toFixed(2)} USDT
          </td>
        </tr>
      `).join('');

      const accNum = p.account_number || user?.account_number || 'WTN-2026-0000';

      printWindow.document.write(`
        <!DOCTYPE html>
        <html>
        <head>
          <title>Estado de Cuenta - ${user?.username || 'Inversionista'} - ${accNum}</title>
          <style>
            @media print {
              body { -webkit-print-color-adjust: exact; print-color-adjust: exact; }
              .no-print { display: none !important; }
            }
            body { font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif; color: #0f172a; margin: 0; padding: 40px; background: #fff; }
            .header { display: flex; justify-content: space-between; align-items: flex-start; border-bottom: 2px solid #f59e0b; padding-bottom: 20px; margin-bottom: 25px; }
            .logo { font-size: 22px; font-weight: 900; color: #0f172a; }
            .logo span { color: #f59e0b; }
            .sub-brand { font-size: 12px; font-weight: 700; color: #64748b; margin-top: 4px; }
            .badge { background: #fef3c7; color: #92400e; padding: 4px 10px; border-radius: 6px; font-size: 11px; font-weight: bold; text-transform: uppercase; }
            .acc-tag { display: inline-block; background: #0f172a; color: #fbbf24; font-family: monospace; font-weight: bold; font-size: 12px; padding: 3px 8px; border-radius: 4px; margin-top: 6px; }
            .grid { display: grid; grid-template-columns: repeat(4, 1fr); gap: 15px; margin-bottom: 30px; }
            .card { background: #f8fafc; border: 1px solid #e2e8f0; border-radius: 10px; padding: 15px; }
            .card-title { font-size: 11px; color: #64748b; font-weight: bold; text-transform: uppercase; margin-bottom: 6px; }
            .card-val { font-size: 20px; font-weight: 900; font-family: monospace; }
            table { width: 100%; border-collapse: collapse; margin-top: 10px; }
            th { background: #f1f5f9; text-align: left; padding: 8px 12px; font-size: 11px; text-transform: uppercase; color: #475569; }
            .footer { margin-top: 40px; border-top: 1px solid #e2e8f0; padding-top: 15px; font-size: 11px; color: #94a3b8; text-align: center; line-height: 1.5; }
            .btn-print { background: #0f172a; color: #fff; padding: 10px 20px; border-radius: 8px; font-weight: bold; cursor: pointer; border: none; font-size: 13px; }
          </style>
        </head>
        <body>
          <div class="no-print" style="margin-bottom: 20px; display: flex; justify-content: flex-end; gap: 10px;">
            <button class="btn-print" onclick="window.print()">🖨️ Imprimir / Guardar como PDF</button>
          </div>

          <div class="header">
            <div>
              <div class="logo">⚡ WTN <span>ALGO-TRADING</span> (Binance)</div>
              <div class="sub-brand">WTN Solutions LLC • Quantitative Asset Management & Pool</div>
              <div class="acc-tag">N° CUENTA: ${accNum}</div>
            </div>
            <div style="text-align: right;">
              <div class="badge">Extracto Oficial Institucional</div>
              <div style="font-size: 12px; color: #64748b; margin-top: 6px;">Fecha de Emisión: ${statement.generated_at}</div>
              <div style="font-size: 13px; font-weight: bold; color: #0f172a; margin-top: 2px;">Titular: ${user?.username}</div>
              <div style="font-size: 11px; color: #64748b;">${user?.email || ''}</div>
            </div>
          </div>

          <div class="grid">
            <div class="card">
              <div class="card-title">Capital Depositado</div>
              <div class="card-val" style="color: #0f172a;">$${Number(p.capital_invested).toFixed(2)} <span style="font-size: 12px;">USDT</span></div>
            </div>
            <div class="card">
              <div class="card-title">Valor Actual Estimado</div>
              <div class="card-val" style="color: #0284c7;">$${Number(p.current_value).toFixed(2)} <span style="font-size: 12px;">USDT</span></div>
            </div>
            <div class="card">
              <div class="card-title">Ganancia Neta ($)</div>
              <div class="card-val" style="color: ${isProfit ? '#059669' : '#e11d48'};">
                ${isProfit ? '+' : ''}$${Number(p.net_pnl).toFixed(2)}
              </div>
            </div>
            <div class="card">
              <div class="card-title">Retorno (ROI) / Cuota</div>
              <div class="card-val" style="color: ${isProfit ? '#059669' : '#e11d48'};">
                ${isProfit ? '+' : ''}${Number(p.roi_percentage).toFixed(2)}%
                <div style="font-size: 11px; color: #64748b; font-weight: normal; margin-top: 4px;">Participación: ${p.share_percentage}%</div>
              </div>
            </div>
          </div>

          <div style="margin-bottom: 30px;">
            <h3 style="font-size: 14px; text-transform: uppercase; color: #0f172a; margin-bottom: 10px; border-left: 3px solid #f59e0b; padding-left: 8px;">
              Historial de Movimientos de Capital
            </h3>
            <table>
              <thead>
                <tr>
                  <th>Fecha</th>
                  <th>Tipo</th>
                  <th style="text-align: right;">Monto</th>
                  <th>Notas</th>
                </tr>
              </thead>
              <tbody>
                ${rowsHtml || '<tr><td colspan="4" style="text-align: center; padding: 15px; color: #94a3b8;">Sin movimientos registrados</td></tr>'}
              </tbody>
            </table>
          </div>

          <div style="margin-bottom: 30px;">
            <h3 style="font-size: 14px; text-transform: uppercase; color: #0f172a; margin-bottom: 10px; border-left: 3px solid #0284c7; padding-left: 8px;">
              Muestra de Últimas Operaciones Ejecutadas por el Bot (Pool)
            </h3>
            <table>
              <thead>
                <tr>
                  <th>Fecha Cierre</th>
                  <th>Par</th>
                  <th>Tipo</th>
                  <th style="text-align: right;">Resultado</th>
                </tr>
              </thead>
              <tbody>
                ${tradesHtml || '<tr><td colspan="4" style="text-align: center; padding: 15px; color: #94a3b8;">Sin operaciones recientes</td></tr>'}
              </tbody>
            </table>
          </div>

          <div class="footer">
            Documento emitido electrónicamente por <strong>WTN Solutions LLC</strong> — División WTN ALGO-TRADING (Binance).<br>
            Cifrado institucional de cuenta ${accNum} verificado en servidor central.<br>
            Los rendimientos pasados no garantizan rendimientos futuros. Operaciones de futuros sujetas a volatilidad de mercado.
          </div>
        </body>
        </html>
      `);
      printWindow.document.close();
    } catch (err) {
      alert(`Error al descargar estado de cuenta: ${err.message}`);
    } finally {
      setIsDownloadingPdf(false);
    }
  };

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
  const otherShare = Math.max(0, 100 - share);
  const isProfit = netPnl >= 0;

  // Render SVG Donut Chart
  const radius = 60;
  const circumference = 2 * Math.PI * radius;
  const strokeDashoffset = circumference - (share / 100) * circumference;

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

        {/* Botón Descargar PDF */}
        <button
          type="button"
          onClick={handleDownloadStatement}
          disabled={isDownloadingPdf}
          className="w-full md:w-auto px-5 py-2.5 bg-gradient-to-r from-amber-400 to-amber-500 hover:from-amber-300 hover:to-amber-400 text-slate-950 font-black text-xs sm:text-sm rounded-xl shadow-lg shadow-amber-500/20 transition-all flex items-center justify-center gap-2 disabled:opacity-50"
        >
          {isDownloadingPdf ? (
            <>
              <span className="w-4 h-4 border-2 border-slate-950 border-t-transparent rounded-full animate-spin"></span>
              Generando Documento...
            </>
          ) : (
            <>
              <span>📄</span> Descargar Estado de Cuenta (PDF)
            </>
          )}
        </button>
      </div>

      {/* WIDGET DE ACTIVIDAD CUANTITATIVA EN VIVO (Alta Frecuencia 24/7) */}
      <div className="bg-gradient-to-r from-slate-900 via-slate-900 to-amber-950/20 border border-amber-500/30 rounded-2xl p-4 shadow-xl relative overflow-hidden flex flex-col sm:flex-row items-center justify-between gap-4">
        <div className="absolute -right-12 -bottom-12 w-48 h-48 bg-amber-500/10 rounded-full blur-3xl pointer-events-none"></div>

        <div className="flex items-center gap-4 z-10">
          {/* Radar de escaneo dinámico */}
          <div className="relative flex items-center justify-center w-12 h-12 rounded-xl bg-amber-400/10 border border-amber-400/30 text-amber-400 shadow-inner">
            <span className="absolute w-10 h-10 rounded-full bg-emerald-400/20 animate-ping"></span>
            <span className="relative text-2xl animate-pulse">⚡</span>
            <span className="absolute -top-1 -right-1 flex h-3 w-3">
              <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-emerald-400 opacity-75"></span>
              <span className="relative inline-flex rounded-full h-3 w-3 bg-emerald-500"></span>
            </span>
          </div>

          <div>
            <div className="flex flex-wrap items-center gap-2">
              <h4 className="text-sm font-black text-white uppercase tracking-wider">
                Algoritmo Cuantitativo de Alta Frecuencia Activo
              </h4>
              <span className="px-2 py-0.5 rounded-full text-[10px] font-black uppercase tracking-widest bg-emerald-500/20 text-emerald-300 border border-emerald-500/30 flex items-center gap-1.5">
                <span className="w-1.5 h-1.5 rounded-full bg-emerald-400 animate-pulse"></span>
                EN VIVO 24/7
              </span>
            </div>
            <p className="text-xs text-slate-400 mt-0.5">
              Supervisión y gestión algorítmica institucional en tiempo real
            </p>
          </div>
        </div>

        <div className="flex items-center gap-3 z-10 self-stretch sm:self-auto justify-between sm:justify-end">
          <div className="text-right">
            <div className="text-[10px] uppercase font-bold text-slate-400 tracking-wider">Motor Institucional</div>
            <div className="text-xs font-mono font-bold text-amber-400">WTN ALGO-TRADING v2.6</div>
          </div>
          <div className="h-8 w-px bg-slate-800"></div>
          <div className="flex items-center gap-1.5 px-3 py-1.5 rounded-xl bg-slate-950 border border-slate-800 text-xs font-mono text-emerald-400 font-bold shadow-inner">
            <span className="w-2 h-2 rounded-full bg-emerald-400 animate-ping"></span>
            <span>GESTIONANDO</span>
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

      {/* Gráfico de Dona: Tu Pedazo de la Torta vs Resto del Pool */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        
        {/* Gráfico de Dona Dinámico Neón */}
        <div className="bg-slate-900 border border-slate-800 rounded-3xl p-6 shadow-xl flex flex-col items-center justify-center text-center relative overflow-hidden">
          <div className="absolute top-0 right-0 w-32 h-32 bg-amber-500/5 rounded-full blur-2xl pointer-events-none"></div>

          <h3 className="text-sm font-bold uppercase tracking-wider text-slate-300 mb-3 flex items-center gap-2">
            <span>🥧</span> Tu Participación en el Fondo
          </h3>

          <div className="relative flex items-center justify-center my-3">
            <svg className="w-52 h-52 transform -rotate-90">
              <defs>
                <linearGradient id="userShareGrad" x1="0%" y1="0%" x2="100%" y2="100%">
                  <stop offset="0%" stopColor="#f59e0b" />
                  <stop offset="50%" stopColor="#fbbf24" />
                  <stop offset="100%" stopColor="#d97706" />
                </linearGradient>
                <linearGradient id="poolTrackGrad" x1="0%" y1="0%" x2="100%" y2="100%">
                  <stop offset="0%" stopColor="#1e293b" />
                  <stop offset="100%" stopColor="#0f172a" />
                </linearGradient>
                <filter id="neonGlow" x="-20%" y="-20%" width="140%" height="140%">
                  <feGaussianBlur stdDeviation="3" result="blur" />
                  <feMerge>
                    <feMergeNode in="blur" />
                    <feMergeNode in="SourceGraphic" />
                  </feMerge>
                </filter>
              </defs>

              {/* Círculo base (Resto del fondo) */}
              <circle
                cx="104"
                cy="104"
                r={radius}
                stroke="url(#poolTrackGrad)"
                strokeWidth="20"
                fill="transparent"
              />
              {/* Glow pulsante de fondo */}
              {share > 0 && (
                <circle
                  cx="104"
                  cy="104"
                  r={radius}
                  stroke="url(#userShareGrad)"
                  strokeWidth="20"
                  strokeDasharray={circumference}
                  strokeDashoffset={strokeDashoffset}
                  strokeLinecap="round"
                  fill="transparent"
                  filter="url(#neonGlow)"
                  opacity="0.5"
                  className="transition-all duration-1000 ease-out animate-pulse"
                />
              )}
              {/* Círculo de participación del usuario */}
              <circle
                cx="104"
                cy="104"
                r={radius}
                stroke="url(#userShareGrad)"
                strokeWidth="20"
                strokeDasharray={circumference}
                strokeDashoffset={strokeDashoffset}
                strokeLinecap="round"
                fill="transparent"
                className="transition-all duration-1000 ease-out drop-shadow-md"
              />
            </svg>
            <div className="absolute flex flex-col items-center justify-center">
              <div className="w-24 h-24 rounded-full bg-slate-950/90 border border-amber-400/20 flex flex-col items-center justify-center shadow-inner">
                <span className="text-2xl font-black font-mono text-amber-300">
                  {share.toFixed(1)}%
                </span>
                <span className="text-[9px] text-slate-400 font-bold uppercase tracking-wider">
                  Tu Cuota
                </span>
              </div>
            </div>
          </div>

          <div className="w-full mt-2 pt-4 border-t border-slate-800 space-y-2 text-xs">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-2">
                <span className="w-3 h-3 rounded-full bg-amber-400 shadow"></span>
                <span className="text-slate-300">Tu Capital:</span>
              </div>
              <span className="font-mono font-bold text-white">${curVal.toFixed(2)} USDT</span>
            </div>

            <div className="flex items-center justify-between">
              <div className="flex items-center gap-2">
                <span className="w-3 h-3 rounded-full bg-slate-700"></span>
                <span className="text-slate-400">Total Fondo Binance:</span>
              </div>
              <span className="font-mono font-bold text-slate-300">${totalPool.toFixed(2)} USDT</span>
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
