import React, { useState, useEffect, useCallback } from 'react';

/**
 * Componente: UserBotMonitorTable
 * Tabla de Monitoreo en Vivo para la sesión del usuario en "Mi Bot".
 * 
 * Columnas:
 * 1. Símbolo
 * 2. Estrategia y Estado
 * 3. PnL Flotante / Histórico
 * 4. Radar y Posición LONG (cuadritos tipo volumen en rojo/verde si no hay posición; barra TP/SL si está en posición)
 * 5. Radar y Posición SHORT (cuadritos tipo volumen en rojo/verde si no hay posición; barra TP/SL si está en posición)
 */
export default function UserBotMonitorTable({ authFetch, isRunning = true }) {
  const [monitorData, setMonitorData] = useState(null);
  const [isLoading, setIsLoading] = useState(true);
  const [lastUpdated, setLastUpdated] = useState(null);
  const [fetchError, setFetchError] = useState(null);
  const [isResettingTrades, setIsResettingTrades] = useState(false);

  const fetchMonitor = useCallback(async () => {
    try {
      const resp = await authFetch('/api/user/bot/monitor');
      if (!resp.ok) {
        throw new Error(`HTTP ${resp.status}`);
      }
      const data = await resp.json();
      if (data && data.status === 'success') {
        setMonitorData(data);
        setLastUpdated(new Date());
        setFetchError(null);
      }
    } catch (err) {
      console.warn("Aviso al consultar monitor de bot de usuario:", err);
      setFetchError(err.message);
    } finally {
      setIsLoading(false);
    }
  }, [authFetch]);

  useEffect(() => {
    fetchMonitor();
    const interval = setInterval(() => {
      fetchMonitor();
    }, 3000); // Polling cada 3 segundos en vivo

    return () => clearInterval(interval);
  }, [fetchMonitor]);

  const handleResetTrades = async () => {
    if (!window.confirm("⚠️ ¿Deseas reiniciar tu historial de trades y poner el PnL histórico a 0.00 USDT? Tu bot y posiciones activas seguirán operando con normalidad.")) {
      return;
    }
    setIsResettingTrades(true);
    try {
      const resp = await authFetch('/api/user/trades/reset', { method: 'POST' });
      const data = await resp.json();
      if (resp.ok && data.status === 'success') {
        alert("✅ Historial de trades y PnL reiniciados con éxito a 0.00 USDT.");
        fetchMonitor();
      } else {
        alert(`Error al reiniciar trades: ${data.message || 'Error desconocido'}`);
      }
    } catch (err) {
      alert(`Error al reiniciar trades: ${err.message}`);
    } finally {
      setIsResettingTrades(false);
    }
  };

  const symbols = monitorData?.symbols || [];
  const openPositionsCount = symbols.reduce((acc, s) => acc + (s.in_long ? 1 : 0) + (s.in_short ? 1 : (s.in_position ? 1 : 0)), 0);

  const totalUnrealizedPnl = monitorData?.summary?.total_unrealized_pnl ?? symbols.reduce((acc, s) => acc + Number(s.unrealized_pnl || 0), 0);
  const totalHistoricalPnl = monitorData?.summary?.total_historical_pnl ?? symbols.reduce((acc, s) => acc + Number(s.historical_pnl || 0), 0);
  const totalMarginCommitted = monitorData?.summary?.total_margin_usdt ?? symbols.reduce((acc, s) => acc + Number(s.margin_usdt || 0), 0);

  return (
    <div className="bg-slate-900/90 border border-slate-800 rounded-3xl p-5 sm:p-7 shadow-xl space-y-4 animate-fadeIn">
      {/* Encabezado del Monitor */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 border-b border-slate-800/80 pb-4">
        <div>
          <div className="inline-flex items-center gap-1.5 px-3 py-1 rounded-full bg-cyan-500/10 border border-cyan-500/30 text-cyan-400 text-xs font-bold mb-2">
            <span>📡</span> RADAR Y POSICIONES EN VIVO
          </div>
          <h3 className="text-lg sm:text-xl font-black text-white tracking-tight flex items-center gap-2">
            Monitoreo en Tiempo Real de tu Bot Personal
          </h3>
          <p className="text-xs text-slate-400 mt-0.5 leading-relaxed">
            Supervisa tus posiciones abiertas en Binance Futures y el radar cuantitativo de condiciones para cada par.
          </p>
        </div>

        <div className="flex items-center gap-2 self-start sm:self-auto flex-wrap">
          <span className={`text-[11px] px-2.5 py-1 rounded-xl border font-mono ${
            monitorData?.is_hedge 
              ? "bg-purple-950/40 border-purple-800 text-purple-300"
              : "bg-slate-950 border-slate-800 text-slate-400"
          }`}>
            Modo: <strong className={monitorData?.is_hedge ? "text-purple-300 font-bold" : "text-slate-300 font-bold"}>
              {monitorData?.is_hedge ? 'Hedge (Bidireccional)' : 'One-Way'}
            </strong>
          </span>
          <span className="text-[11px] px-2.5 py-1 rounded-xl bg-slate-950 border border-slate-800 font-mono text-slate-300">
            Posiciones: <strong className={openPositionsCount > 0 ? "text-emerald-400 font-extrabold" : "text-slate-400"}>{openPositionsCount} activas</strong>
          </span>
          <button
            onClick={fetchMonitor}
            className="px-3 py-1 bg-slate-800 hover:bg-slate-700 text-slate-300 hover:text-white rounded-xl text-xs font-bold transition flex items-center gap-1 active:scale-95"
            title="Actualizar datos en vivo"
          >
            <span>↻</span> Refrescar
          </button>
          <button
            onClick={handleResetTrades}
            disabled={isResettingTrades}
            className="px-3 py-1 bg-rose-950/80 hover:bg-rose-900 text-rose-300 hover:text-white border border-rose-800/60 rounded-xl text-xs font-bold transition flex items-center gap-1 active:scale-95 disabled:opacity-50"
            title="Reiniciar el historial de operaciones personales y poner el PnL histórico a 0.00 USDT"
          >
            <span>🗑️</span> {isResettingTrades ? 'Reiniciando...' : 'Vaciar Historial & PnL'}
          </button>
        </div>
      </div>

      {/* Tabla de Monitoreo */}
      {isLoading && !monitorData ? (
        <div className="py-12 text-center text-slate-400 text-xs flex flex-col items-center gap-2">
          <div className="w-6 h-6 border-2 border-cyan-400 border-t-transparent rounded-full animate-spin"></div>
          <span>Conectando con Binance Futures y escaneando radar cuantitativo...</span>
        </div>
      ) : symbols.length === 0 ? (
        <div className="p-8 bg-slate-950/60 border border-slate-800 rounded-2xl text-center text-slate-400 text-xs">
          No hay símbolos activos configurados en este momento.
        </div>
      ) : (
        <div className="overflow-x-auto rounded-2xl border border-slate-800/80 bg-slate-950/60 shadow-inner">
          <table className="w-full text-left border-collapse min-w-[900px]">
            <thead>
              <tr className="border-b border-slate-800 bg-slate-900/60 text-[11px] font-black uppercase tracking-wider text-slate-400">
                <th className="py-3.5 px-4 sm:px-6 w-[13%]">Símbolo</th>
                <th className="py-3.5 px-4 sm:px-6 w-[18%]">Estrategia y Estado</th>
                <th className="py-3.5 px-4 sm:px-6 w-[17%]">PnL Flotante / Hist</th>
                <th className="py-3.5 px-4 sm:px-6 w-[26%]">Radar & Posición LONG</th>
                <th className="py-3.5 px-4 sm:px-6 w-[26%]">Radar & Posición SHORT</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-800/60 text-xs font-sans">
              {symbols.map((item) => {
                const inPos = item.in_position;
                const isHedge = Boolean(monitorData?.is_hedge);
                const inLong = Boolean(item.in_long || (inPos && item.trade_side === 'LONG'));
                const inShort = Boolean(item.in_short || (inPos && item.trade_side === 'SHORT'));
                const longPos = item.long_position || (inLong ? item.position : null);
                const shortPos = item.short_position || (inShort ? item.position : null);

                // Colores para PnL Flotante
                const unPnl = Number(item.unrealized_pnl || 0);
                const histPnl = Number(item.historical_pnl || 0);

                const unPnlColor = unPnl > 0.005 ? 'text-emerald-400' : (unPnl < -0.005 ? 'text-rose-400' : 'text-slate-400');
                const histPnlColor = histPnl > 0.005 ? 'text-emerald-400' : (histPnl < -0.005 ? 'text-rose-400' : 'text-slate-400');

                // Etiqueta de posición
                const posBadgeText = inLong && inShort 
                  ? 'In Position (LONG + SHORT)' 
                  : (inLong ? 'In Position (LONG)' : (inShort ? 'In Position (SHORT)' : `In Position (${item.trade_side || 'ACTIVA'})`));

                return (
                  <tr 
                    key={item.symbol} 
                    className={`transition-colors hover:bg-slate-900/40 ${
                      inPos ? 'bg-indigo-950/15' : ''
                    }`}
                  >
                    {/* 1. SÍMBOLO */}
                    <td className="py-4 px-4 sm:px-6 font-mono font-black text-sm text-white">
                      <div className="flex items-center gap-2">
                        <span className="tracking-tight">{item.symbol}</span>
                        <span className="text-[10px] font-mono px-1.5 py-0.5 rounded bg-slate-800 text-cyan-300 border border-slate-700/80 font-bold">
                          BIDI
                        </span>
                      </div>
                    </td>

                    {/* 2. ESTRATEGIA Y ESTADO */}
                    <td className="py-4 px-4 sm:px-6">
                      <div className="flex flex-col gap-1 items-start">
                        <span className="font-mono text-[11px] font-bold text-amber-300 truncate max-w-[240px]">
                          {item.strategy_name}
                        </span>
                        {inPos ? (
                          <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-lg text-[10px] font-black uppercase bg-emerald-500/20 text-emerald-300 border border-emerald-500/40 animate-pulse shadow-sm shadow-emerald-500/10">
                            <span className="w-1.5 h-1.5 rounded-full bg-emerald-400"></span>
                            {posBadgeText}
                          </span>
                        ) : item.cooldown_active ? (
                          <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-lg text-[10px] font-bold uppercase bg-amber-500/15 text-amber-300 border border-amber-500/30">
                            <span>⏳</span> Cooldown (60s)
                          </span>
                        ) : (
                          <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-lg text-[10px] font-semibold text-slate-400 bg-slate-900 border border-slate-800">
                            <span>📡</span> Buscando Entrada
                          </span>
                        )}
                      </div>
                    </td>

                    {/* 3. PNL FLOTANTE / HIST */}
                    <td className="py-4 px-4 sm:px-6 font-mono">
                      <div className="flex flex-col gap-1 text-xs">
                        {/* Flotante global del par */}
                        <div className="flex items-center justify-between gap-1">
                          <span className="text-[10px] font-sans text-slate-400 font-semibold uppercase">Flotante:</span>
                          <span className={`font-black text-sm ${unPnlColor}`}>
                            {inPos ? `${unPnl >= 0 ? '+' : ''}${unPnl.toFixed(2)} USDT` : '0.00 USDT'}
                          </span>
                        </div>

                        {/* Desglose por lado (L: / S:) cuando hay posición activa, tal como en Admin */}
                        {inPos && (item.in_long || item.in_short) && (
                          <div className="flex flex-col gap-0.5 pt-0.5 border-t border-slate-800/80 text-[10px]">
                            {item.in_long && (
                              <div className="flex items-center justify-between">
                                <span className="text-slate-400 font-sans font-bold flex items-center gap-1">
                                  <span className="w-1.5 h-1.5 rounded-full bg-emerald-400"></span> L (Long):
                                </span>
                                <span className={`font-bold ${Number(item.long_pnl || 0) >= 0 ? 'text-emerald-400' : 'text-rose-400'}`}>
                                  {Number(item.long_pnl || 0) >= 0 ? '+' : ''}{Number(item.long_pnl || 0).toFixed(2)} USDT
                                </span>
                              </div>
                            )}
                            {item.in_short && (
                              <div className="flex items-center justify-between">
                                <span className="text-slate-400 font-sans font-bold flex items-center gap-1">
                                  <span className="w-1.5 h-1.5 rounded-full bg-rose-400"></span> S (Short):
                                </span>
                                <span className={`font-bold ${Number(item.short_pnl || 0) >= 0 ? 'text-emerald-400' : 'text-rose-400'}`}>
                                  {Number(item.short_pnl || 0) >= 0 ? '+' : ''}{Number(item.short_pnl || 0).toFixed(2)} USDT
                                </span>
                              </div>
                            )}
                          </div>
                        )}

                        {/* Histórico acumulado */}
                        <div className="flex items-center justify-between gap-1 text-[11px] pt-0.5 border-t border-slate-800/60">
                          <span className="text-[10px] font-sans text-slate-500 uppercase font-semibold">Histórico:</span>
                          <span className={`font-bold ${histPnlColor}`}>
                            {histPnl >= 0 ? '+' : ''}{histPnl.toFixed(2)} USDT
                          </span>
                        </div>
                      </div>
                    </td>

                    {/* 4. RADAR Y POSICIÓN LONG */}
                    <td className="py-4 px-4 sm:px-6">
                      {inLong && longPos ? (
                        /* CUANDO ABRE LA POSICIÓN LONG: BARRA CON INFORMACIÓN DE TP Y SL */
                        <PositionTpSlBar position={longPos} />
                      ) : (
                        /* CUANDO NO ESTÁ EN POSICIÓN LONG: CUADROS TIPO VOLUMEN */
                        <VolumeRadarBlocks radar={item.long_radar} side="LONG" inOtherPos={inShort && !isHedge} />
                      )}
                    </td>

                    {/* 5. RADAR Y POSICIÓN SHORT */}
                    <td className="py-4 px-4 sm:px-6">
                      {inShort && shortPos ? (
                        /* CUANDO ABRE LA POSICIÓN SHORT: BARRA CON INFORMACIÓN DE TP Y SL */
                        <PositionTpSlBar position={shortPos} />
                      ) : (
                        /* CUANDO NO ESTÁ EN POSICIÓN SHORT: CUADROS TIPO VOLUMEN */
                        <VolumeRadarBlocks radar={item.short_radar} side="SHORT" inOtherPos={inLong && !isHedge} />
                      )}
                    </td>
                  </tr>
                );
              })}
            </tbody>

            {/* TOTALES CONSOLIDADOS (TAL COMO SE VE EN ADMIN) */}
            {symbols.length > 0 && (
              <tfoot className="bg-slate-950 border-t-2 border-slate-700 font-mono text-xs">
                <tr className="divide-x divide-slate-800/80">
                  {/* 1 y 2: Símbolo, Estrategia & Estado */}
                  <td colSpan="2" className="py-3.5 px-4 sm:px-6 text-left font-sans font-bold text-slate-200">
                    <div className="flex items-center gap-2">
                      <span className="text-base">📊</span>
                      <span>TOTALES CONSOLIDADOS ({symbols.length} pares)</span>
                    </div>
                  </td>

                  {/* 3: PnL Flotante neto e Histórico consolidado */}
                  <td className="py-3.5 px-4 sm:px-6 text-xs font-mono">
                    <div className="flex flex-col gap-1">
                      <div className="flex items-center justify-between gap-1.5">
                        <span className="text-[10px] text-slate-400 font-sans font-semibold">Flotante neto:</span>
                        <span className={`font-black ${totalUnrealizedPnl < 0 ? 'text-rose-400' : totalUnrealizedPnl > 0 ? 'text-emerald-400' : 'text-slate-300'}`}>
                          {totalUnrealizedPnl >= 0 ? `+${totalUnrealizedPnl.toFixed(4)}` : totalUnrealizedPnl.toFixed(4)} USDT
                        </span>
                      </div>
                      <div className="flex items-center justify-between gap-1.5 pt-0.5 border-t border-slate-800">
                        <span className="text-[10px] text-slate-400 font-sans font-semibold">Histórico pares:</span>
                        <span className={`font-bold ${totalHistoricalPnl < 0 ? 'text-rose-400' : totalHistoricalPnl > 0 ? 'text-emerald-400' : 'text-slate-300'}`}>
                          {totalHistoricalPnl >= 0 ? `+${totalHistoricalPnl.toFixed(4)}` : totalHistoricalPnl.toFixed(4)} USDT
                        </span>
                      </div>
                    </div>
                  </td>

                  {/* 4: Métricas en vivo (Dual Hedge) & Margen total */}
                  <td className="py-3.5 px-4 sm:px-6 text-center text-[11px] text-slate-400 font-sans">
                    <div className="flex flex-col items-center justify-center gap-1">
                      <span className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-md bg-slate-900 border border-slate-700/60 text-slate-300">
                        <span className="w-2 h-2 rounded-full bg-emerald-400 animate-pulse"></span>
                        Métricas en vivo (Dual Hedge)
                      </span>
                      <span className="text-[10px] text-slate-400 font-mono">
                        Margen total: <strong className="text-white">${totalMarginCommitted.toFixed(2)} USDT</strong>
                      </span>
                    </div>
                  </td>

                  {/* 5: Posiciones activas */}
                  <td className="py-3.5 px-4 sm:px-6 font-mono text-xs">
                    <div className="flex flex-col items-end sm:items-start justify-center gap-1">
                      <span className="text-[10px] text-slate-400 font-sans font-semibold">En posición:</span>
                      <span className="font-black text-amber-300">
                        {openPositionsCount} {openPositionsCount === 1 ? 'posición activa' : 'posiciones activas'}
                      </span>
                    </div>
                  </td>
                </tr>
              </tfoot>
            )}
          </table>
        </div>
      )}

      {/* Leyenda explicativa de los cuadros tipo volumen */}
      <div className="pt-2 border-t border-slate-800/80 flex flex-col sm:flex-row sm:items-center justify-between gap-2 text-[11px] text-slate-400">
        <div className="flex items-center gap-4 flex-wrap">
          <span className="font-bold text-slate-300 flex items-center gap-1">
            <span>ℹ️</span> Cuadros tipo volumen:
          </span>
          <span className="flex items-center gap-1.5">
            <span className="w-3.5 h-3.5 rounded bg-emerald-500 border border-emerald-300 shadow-sm shadow-emerald-500/50 inline-block"></span>
            <span>Verde = Condición Cumplida</span>
          </span>
          <span className="flex items-center gap-1.5">
            <span className="w-3.5 h-3.5 rounded bg-rose-950/80 border border-rose-600/70 inline-block"></span>
            <span>Rojo = Condición Pendiente</span>
          </span>
        </div>

        {lastUpdated && (
          <span className="text-slate-500 font-mono text-[10px]">
            Actualizado: {lastUpdated.toLocaleTimeString()}
          </span>
        )}
      </div>
    </div>
  );
}

/**
 * Subcomponente: PositionTpSlBar
 * Muestra ÚNICAMENTE la barra con la información de Take Profit (TP) y Stop Loss (SL)
 * cuando la posición está abierta.
 */
function PositionTpSlBar({ position }) {
  if (!position) return null;

  const { tp, sl, ts, unrealized_pnl, margin_usdt, notional_usdt, leverage, side } = position;
  const pnlUsdt = Number(unrealized_pnl || 0);
  const isProfit = pnlUsdt >= 0;
  const tpProgress = Math.min(100, Math.max(0, Number(tp?.progress_pct || 0)));

  const lossUsdt = Math.abs(Math.min(0, pnlUsdt));
  const slTargetUsdt = Math.abs(Number(sl?.target_usdt || 400));
  const slFillPct = slTargetUsdt > 0 ? (lossUsdt / slTargetUsdt) * 100 : 0;

  // Rango de riesgo dinámico según pérdida consumida del Stop Loss
  let riskBadge = null;
  if (pnlUsdt >= 0) {
    riskBadge = <span className="font-medium text-emerald-400">🛡️ Seguro</span>;
  } else if (slFillPct < 5) {
    const pctStr = slFillPct < 1 ? slFillPct.toFixed(1) : Math.round(slFillPct);
    riskBadge = <span className="font-mono font-bold text-amber-400 animate-pulse">⚠️ Riesgo Inicial ({pctStr}%)</span>;
  } else if (slFillPct < 25) {
    riskBadge = <span className="font-mono font-bold text-amber-400 animate-pulse">⚠️ Riesgo Bajo ({Math.round(slFillPct)}%)</span>;
  } else if (slFillPct < 60) {
    riskBadge = <span className="font-mono font-bold text-orange-400 animate-pulse">⚡ Riesgo Medio ({Math.round(slFillPct)}%)</span>;
  } else {
    riskBadge = <span className="font-mono font-bold text-rose-400 animate-pulse">🚨 Riesgo Alto ({Math.round(slFillPct)}%)</span>;
  }

  return (
    <div className="flex flex-col gap-1.5 w-full max-w-sm xl:max-w-md py-1.5 bg-slate-950/85 p-3 rounded-xl border border-slate-800/80 shadow-inner">
      {/* CABECERA DE LA POSICIÓN: Lado, PnL en vivo y Margen (tal como en Admin) */}
      <div className="flex items-center justify-between text-[11px] pb-1 border-b border-slate-800/80">
        <div className="flex items-center gap-1.5">
          <span className={`w-2 h-2 rounded-full ${isProfit ? 'bg-emerald-400' : 'bg-rose-400'} animate-pulse`}></span>
          <span className="font-bold text-white font-mono">{side ? `POSICIÓN ${side}` : 'EN POSICIÓN'}</span>
          {leverage && (
            <span className="text-[10px] px-1 py-0.2 rounded bg-slate-900 border border-slate-700 font-mono text-cyan-300 font-bold">
              {leverage}x
            </span>
          )}
        </div>
        <div className="flex items-center gap-1">
          <span className="text-[10px] text-slate-400 font-sans font-semibold">PnL:</span>
          <span className={`font-mono font-black text-xs ${isProfit ? 'text-emerald-400' : 'text-rose-400'}`}>
            {isProfit ? `+${pnlUsdt.toFixed(2)}` : pnlUsdt.toFixed(2)} USDT
          </span>
        </div>
      </div>

      {/* FILA 1: TAKE PROFIT (Muestra profit obtenido) */}
      <div className="flex flex-col gap-0.5">
        <div className="flex items-center justify-between text-[11px] leading-tight flex-wrap gap-1">
          <div className="flex items-center gap-1.5 flex-wrap">
            <span className="font-bold text-emerald-300 flex items-center gap-1">
              <span>🎯 TP:</span>
              <span className="font-mono text-emerald-200">+{Number(tp?.target_usdt || 50).toFixed(2)} USDT</span>
            </span>
            {pnlUsdt > 0 && (
              <span className="text-[10px] font-mono font-black text-emerald-300 bg-emerald-500/20 px-1.5 py-0.5 rounded border border-emerald-500/40">
                Profit: +{pnlUsdt.toFixed(2)} USDT
              </span>
            )}
          </div>
          <div className="flex items-center gap-1.5 text-[10px]">
            {tp?.remaining_usdt !== undefined && tp.remaining_usdt > 0 && (
              <span className="text-slate-400 font-sans hidden sm:inline">
                (Falta: +{Number(tp.remaining_usdt).toFixed(2)})
              </span>
            )}
            <span className={`font-mono font-black ${isProfit ? 'text-emerald-400' : 'text-slate-500'}`}>
              {Math.round(tpProgress)}%
            </span>
          </div>
        </div>
        <div className="w-full bg-slate-900 rounded-full h-2 overflow-hidden border border-slate-700/80">
          <div
            className={`h-full rounded-full transition-all duration-500 ${
              tpProgress >= 100 
                ? 'bg-emerald-400 animate-pulse' 
                : ts?.armed
                  ? 'bg-gradient-to-r from-teal-500 via-sky-500 to-blue-500 shadow-sm shadow-sky-500/50'
                  : isProfit 
                    ? 'bg-gradient-to-r from-teal-500 to-emerald-400' 
                    : 'bg-slate-700'
            }`}
            style={{ width: `${tpProgress}%` }}
          />
        </div>
      </div>

      {/* FILA 2: STOP LOSS O TRAILING STOP (Muestra loss actual y rango de riesgo) */}
      {ts?.armed ? (
        <div className="flex flex-col gap-0.5">
          <div className="flex items-center justify-between text-[11px] leading-tight">
            <span className="font-bold text-sky-300 flex items-center gap-1 animate-pulse">
              <span>🔵 TS ACTIVO:</span>
              <span className="font-mono text-sky-200">Pico +{ts.peak_value} USDT</span>
            </span>
            <span className="text-[10px] text-sky-400 font-semibold font-sans">
              Protegiendo Ganancia 🛡️
            </span>
          </div>
          <div className="w-full bg-slate-900 rounded-full h-2 overflow-hidden border border-sky-800">
            <div
              className="h-full rounded-full bg-gradient-to-r from-blue-600 via-sky-500 to-cyan-400 animate-pulse shadow-sm shadow-sky-500/50"
              style={{ width: '100%' }}
            />
          </div>
        </div>
      ) : (
        <div className="flex flex-col gap-0.5">
          <div className="flex items-center justify-between text-[11px] leading-tight flex-wrap gap-1">
            <div className="flex items-center gap-1.5 flex-wrap">
              <span className="font-bold text-rose-300 flex items-center gap-1">
                <span>🛑 SL:</span>
                <span className="font-mono text-rose-200">{Number(sl?.target_usdt || -400).toFixed(2)} USDT</span>
              </span>
              {pnlUsdt < 0 && (
                <span className="text-[10px] font-mono font-black text-rose-300 bg-rose-500/20 px-1.5 py-0.5 rounded border border-rose-500/40">
                  Loss: {pnlUsdt.toFixed(2)} USDT
                </span>
              )}
            </div>
            <div className="flex items-center gap-1.5 text-[10px]">
              <span className="text-slate-400 font-sans">
                Colchón: <span className="font-mono font-medium text-slate-200">+{Number(sl?.distance_usdt || 0).toFixed(2)}</span>
              </span>
              {riskBadge}
            </div>
          </div>
          <div className="w-full bg-slate-900 rounded-full h-2 overflow-hidden border border-slate-700/80">
            <div
              className={`h-full rounded-full transition-all duration-500 ${
                slFillPct >= 75
                  ? 'bg-gradient-to-r from-red-600 to-rose-500 animate-pulse'
                  : 'bg-gradient-to-r from-rose-600 to-red-500'
              }`}
              style={{ width: `${Math.min(100, Math.max(slFillPct > 0 ? 3 : 0, slFillPct))}%` }}
            />
          </div>
        </div>
      )}

      {/* PIE DE TARJETA: Valor Nominal y Margen Asignado */}
      {(margin_usdt !== undefined || notional_usdt !== undefined) && (
        <div className="flex items-center justify-between text-[10px] pt-1 border-t border-slate-900 text-slate-400 font-mono">
          <span>Valor: <strong className="text-slate-200">${notional_usdt || '0.00'} USDT</strong></span>
          <span>Margen: <strong className="text-amber-300">${margin_usdt || '0.00'} USDT</strong></span>
        </div>
      )}
    </div>
  );
}

/**
 * Subcomponente: VolumeRadarBlocks
 * Muestra cuadros tipo volumen que se llenan de izquierda a derecha.
 * Los cuadros verdes se ubican del lado izquierdo según la cantidad de condiciones cumplidas.
 * Sin información ni detalles técnicos en hover para la sesión del usuario.
 */
function VolumeRadarBlocks({ radar, side = 'LONG', inOtherPos = false }) {
  if (!radar) {
    return (
      <div className="text-slate-500 text-[11px] font-sans italic py-1">
        <span>Escaneando...</span>
      </div>
    );
  }

  const { met_count = 0, total_count = 5, all_met = false } = radar;
  const total = total_count || 5;

  return (
    <div className="flex items-center gap-3 py-1 flex-wrap">
      {/* Serie de Cuadros Tipo Volumen que se llenan progresivamente de izquierda a derecha */}
      <div className="flex items-center gap-1.5 p-1.5 rounded-xl bg-slate-950/90 border border-slate-800/90 shadow-inner">
        {Array.from({ length: total }).map((_, idx) => {
          // Llenado de izquierda a derecha:
          // Si met_count es 3, los primeros 3 cuadros (idx 0, 1, 2) son verdes; los restantes rojos.
          const isLitGreen = idx < met_count;

          return (
            <div
              key={idx}
              className={`w-6 h-7 sm:w-7 sm:h-8 rounded-lg transition-all duration-300 border flex items-center justify-center select-none ${
                isLitGreen
                  ? 'bg-gradient-to-t from-emerald-600 to-emerald-400 border-emerald-300 shadow-[0_0_12px_rgba(16,185,129,0.7)]'
                  : 'bg-rose-950/50 border-rose-900/60 opacity-60'
              }`}
            >
              <div 
                className={`w-2.5 h-1 rounded-full ${
                  isLitGreen ? 'bg-white/90 shadow-sm' : 'bg-rose-800/40'
                }`} 
              />
            </div>
          );
        })}
      </div>

      {/* Insignia cuando todas las condiciones se cumplen o estado alternativo */}
      {all_met ? (
        <span className={`inline-flex items-center gap-1 px-2.5 py-1 rounded-xl text-[10px] font-black uppercase tracking-wider animate-pulse border shadow ${
          side === 'LONG'
            ? 'bg-emerald-500 text-slate-950 border-emerald-300 shadow-emerald-500/40'
            : 'bg-rose-500 text-slate-950 border-rose-300 shadow-rose-500/40'
        }`}>
          <span>⚡</span> LISTO ({met_count}/{total})
        </span>
      ) : inOtherPos ? (
        <span className="text-[10px] text-slate-500 font-sans italic">
          (Posición opuesta activa)
        </span>
      ) : null}
    </div>
  );
}
