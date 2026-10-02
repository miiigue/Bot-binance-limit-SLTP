import React, { useState, useEffect, useCallback } from 'react';
import Tooltip from './Tooltip';

/**
 * Componente: WalletMarginHealth
 * Ubicación: Pestaña "Monitor" (StatusDisplay)
 * 
 * Ecuación contable exacta:
 * [1. Margen en Posiciones] + [2. Retenido por Flotante] + [3. Órdenes Límite] + [4. Margen Libre Real] = [5. Límite Autorizado]
 */
export default function WalletMarginHealth({ readOnly = false }) {
  const [riskData, setRiskData] = useState(null);
  const [riskPercentageInput, setRiskPercentageInput] = useState('100');
  const [isSavingRisk, setIsSavingRisk] = useState(false);
  const [riskFeedback, setRiskFeedback] = useState(null);
  const [isCancellingOrders, setIsCancellingOrders] = useState(false);
  const [cancelOrdersFeedback, setCancelOrdersFeedback] = useState(null);

  // Consulta periódica del estado del margen y billetera
  const fetchRiskData = useCallback(async () => {
    try {
      const resp = await fetch('/api/risk_config');
      if (resp.ok) {
        const data = await resp.json();
        setRiskData(data);
        if (data.risk_percentage_raw !== undefined) {
          setRiskPercentageInput(String(data.risk_percentage_raw));
        } else if (data.risk_percentage) {
          setRiskPercentageInput(data.risk_percentage.replace('%', '').trim());
        }
      }
    } catch (err) {
      console.debug("Error consultando /api/risk_config:", err);
    }
  }, []);

  useEffect(() => {
    fetchRiskData();
    const interval = setInterval(fetchRiskData, 4000);
    return () => clearInterval(interval);
  }, [fetchRiskData]);

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
        fetchRiskData();
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

  // Cancelar órdenes límite huérfanas en Binance para liberar margen retenido
  const handleCancelStaleOrders = async () => {
    if (!window.confirm("¿Deseas cancelar todas las órdenes de entrada huérfanas en Binance?\n\nEsto liberará inmediatamente el margen en USDT retenido en órdenes pendientes sin tocar tus posiciones abiertas ni sus Stop Loss / Take Profit.")) {
      return;
    }
    setIsCancellingOrders(true);
    setCancelOrdersFeedback(null);
    try {
      const resp = await fetch('/api/wallet/cancel_stale_orders', { method: 'POST' });
      const data = await resp.json();
      if (resp.ok) {
        setCancelOrdersFeedback({ 
          type: 'success', 
          msg: data.message || `Órdenes huérfanas canceladas. Margen libre restaurado.` 
        });
        fetchRiskData();
        setTimeout(() => setCancelOrdersFeedback(null), 6000);
      } else {
        setCancelOrdersFeedback({ type: 'error', msg: data.error || 'Error al cancelar órdenes.' });
      }
    } catch (err) {
      setCancelOrdersFeedback({ type: 'error', msg: err.message });
    } finally {
      setIsCancellingOrders(false);
    }
  };

  // Variables numéricas de base
  const totalBalance = riskData ? (parseFloat(riskData.total_balance) || 0) : 0;
  const marginBalance = riskData && riskData.margin_balance ? (parseFloat(riskData.margin_balance) || totalBalance) : totalBalance;
  const currentExp = riskData ? (parseFloat(riskData.current_exposure) || 0) : 0;
  const openOrdersMargin = riskData && riskData.open_orders_margin ? (parseFloat(riskData.open_orders_margin) || 0) : 0;
  const unrealizedPnL = riskData && riskData.unrealized_pnl ? (parseFloat(riskData.unrealized_pnl) || 0) : 0;
  const maxExp = riskData ? (parseFloat(riskData.max_exposure) || totalBalance) : totalBalance;
  const riskPct = riskData && riskData.risk_percentage_raw !== undefined ? riskData.risk_percentage_raw : 100;

  // 1. Margen libre antes del flotante
  const unallocatedWallet = Math.max(0, totalBalance - currentExp - openOrdersMargin);

  // 2. Pérdida flotante negativa retenida por Binance
  const floatingLossConsumed = riskData?.floating_loss_consumed_raw !== undefined
    ? riskData.floating_loss_consumed_raw
    : (unrealizedPnL < 0 ? Math.min(Math.abs(unrealizedPnL), unallocatedWallet) : 0);

  // 3. Margen Libre Real disponible respetando el límite autorizado
  const rawFreeMargin = riskData && riskData.free_margin_raw !== undefined 
    ? riskData.free_margin_raw 
    : (parseFloat(riskData?.free_margin) || 0);

  const freeMarginReal = riskData?.free_margin_real_raw !== undefined
    ? riskData.free_margin_real_raw
    : Math.max(0, Math.min(rawFreeMargin, maxExp - (currentExp + openOrdersMargin + floatingLossConsumed)));

  // 4. Margen total utilizado del límite
  const totalUsedOfLimit = riskData?.total_used_of_limit_raw !== undefined
    ? riskData.total_used_of_limit_raw
    : (currentExp + openOrdersMargin + floatingLossConsumed);

  // 5. Nivel de Utilización Real
  const realUtilizationPct = maxExp > 0
    ? Math.min(100, (totalUsedOfLimit / maxExp) * 100)
    : 0;

  // Colores y badges según el estrés real
  const isExhausted = freeMarginReal <= 0.01;
  const stressColor = realUtilizationPct > 85 ? 'bg-rose-500' : realUtilizationPct > 55 ? 'bg-amber-500' : 'bg-emerald-500';
  const stressBorder = realUtilizationPct > 85 ? 'border-rose-500/50 text-rose-400 bg-rose-950/60' : realUtilizationPct > 55 ? 'border-amber-500/50 text-amber-400 bg-amber-950/60' : 'border-emerald-500/50 text-emerald-400 bg-emerald-950/60';
  const stressLabel = realUtilizationPct > 85 ? (isExhausted ? 'AGOTADO' : 'ALTO RIESGO') : realUtilizationPct > 55 ? 'MODERADO' : 'SEGURO';

  return (
    <div className="bg-gradient-to-br from-slate-900 via-gray-900 to-slate-950 border border-indigo-900/60 rounded-2xl shadow-2xl p-5 relative overflow-hidden mb-6">
      {/* Glow decorativo de fondo */}
      <div className="absolute -top-24 -right-24 w-80 h-80 bg-indigo-600/10 rounded-full blur-3xl pointer-events-none" />

      {/* Cabecera del Panel */}
      <div className="flex flex-wrap items-center justify-between gap-3 pb-3 border-b border-gray-800 relative z-10">
        <div className="flex items-center gap-2.5">
          <div className="w-8 h-8 rounded-xl bg-indigo-600/20 border border-indigo-500/40 flex items-center justify-center text-lg shadow-inner">
            💼
          </div>
          <div>
            <div className="flex items-center gap-2">
              <h2 className="text-base font-bold text-white tracking-wide">
                Billetera Binance & Salud de Margen
              </h2>
              <Tooltip 
                title="Auditoría Contable de Margen" 
                text="Desglose matemático transparente de cada centavo de tu cuenta de Binance Futures: [En Posiciones] + [Retenido por Flotante] + [Órdenes Límite] + [Margen Libre] = [Límite Autorizado]." 
              />
              <span className="text-[10px] px-2 py-0.5 rounded-full font-bold bg-emerald-950 text-emerald-300 border border-emerald-800 flex items-center gap-1">
                <span className="w-1.5 h-1.5 rounded-full bg-emerald-400 animate-pulse"></span>
                Futures Testnet Live
              </span>
            </div>
            <p className="text-[11px] text-slate-400">
              Conciliación contable exacta del capital y estado del margen en tiempo real.
            </p>
          </div>
        </div>

        {/* Resumen rápido de Saldo Total vs Margen Balance */}
        <div className="flex items-center gap-3 bg-gray-950/80 px-3 py-1.5 rounded-xl border border-gray-800 text-xs font-mono">
          <div className="flex items-center gap-1.5">
            <span className="text-slate-400 font-sans text-[11px]">Saldo Billetera:</span>
            <span className="text-white font-bold">${totalBalance.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</span>
          </div>
          <span className="text-gray-700">|</span>
          <div className="flex items-center gap-1.5">
            <span className="text-slate-400 font-sans text-[11px]">Equity (Margen):</span>
            <span className={`font-bold ${marginBalance >= totalBalance ? 'text-emerald-400' : 'text-amber-400'}`}>
              ${marginBalance.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
            </span>
          </div>
        </div>
      </div>

      {/* ======================================================== */}
      {/* 5 TARJETAS CONTABLES INTERCONECTADAS MATEMÁTICAMENTE */}
      {/* [1. Posiciones] + [2. Retenido Flotante] + [3. Órdenes] + [4. Margen Libre] = [5. Límite] */}
      {/* ======================================================== */}
      <div className="my-4 relative z-10">
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-5 gap-3">
          
          {/* TARJETA 1: Margen en Posiciones */}
          <div className="bg-slate-800/80 border border-slate-700/80 rounded-xl p-3.5 flex flex-col justify-between shadow-md relative">
            <div className="flex items-center justify-between text-gray-400 text-xs mb-1">
              <span className="font-bold uppercase tracking-wider text-[11px] flex items-center gap-1 text-slate-300">
                <span>[1] 🔒 En Posiciones</span>
                <Tooltip title="Margen Comprometido en Posiciones" text="Garantía real en USDT retenida por Binance para sostener tus operaciones abiertas en el mercado." />
              </span>
              <span className="text-[10px] font-mono text-amber-400 font-semibold">
                {maxExp > 0 ? ((currentExp / maxExp) * 100).toFixed(1) : 0}%
              </span>
            </div>
            <div className="text-2xl font-black font-mono text-amber-400 tracking-tight my-1">
              ${currentExp.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
            </div>
            <div className="text-[10px] text-gray-400 border-t border-slate-700/60 pt-1.5 flex items-center justify-between">
              <span>Flotante:</span>
              <span className={`font-semibold font-mono ${unrealizedPnL >= 0 ? 'text-emerald-400' : 'text-rose-400'}`}>
                {unrealizedPnL >= 0 ? `+${unrealizedPnL.toFixed(2)}` : unrealizedPnL.toFixed(2)} USDT
              </span>
            </div>
          </div>

          {/* TARJETA 2: Retenido por Flotante Negativo */}
          <div className={`bg-slate-800/80 border rounded-xl p-3.5 flex flex-col justify-between shadow-md relative ${
            floatingLossConsumed > 0 ? 'border-rose-500/50 bg-rose-950/20' : 'border-slate-700/80'
          }`}>
            <div className="flex items-center justify-between text-gray-400 text-xs mb-1">
              <span className="font-bold uppercase tracking-wider text-[11px] flex items-center gap-1 text-slate-300">
                <span>[2] 🔻 Retenido Flotante</span>
                <Tooltip 
                  title="Margen Retenido por Pérdida Flotante" 
                  text="En Binance Futures Cross Margin, las pérdidas flotantes no realizadas restan directamente del margen disponible. Este monto representa el capital bloqueado por el drawdown actual que Binance retiene como respaldo." 
                />
              </span>
              <span className={`text-[9px] px-1.5 py-0.5 rounded font-bold uppercase tracking-wider border whitespace-nowrap ${
                floatingLossConsumed > 0 ? 'bg-rose-950 border-rose-600 text-rose-300' : 'bg-slate-900 border-slate-700 text-slate-400'
              }`}>
                {floatingLossConsumed > 0 ? 'ABSORBIDO' : '0.00 LIBRE'}
              </span>
            </div>
            <div className={`text-2xl font-black font-mono tracking-tight my-1 ${
              floatingLossConsumed > 0 ? 'text-rose-400' : 'text-slate-400'
            }`}>
              ${floatingLossConsumed.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
            </div>
            <div className="text-[10px] text-gray-400 border-t border-slate-700/60 pt-1.5 flex items-center justify-between">
              <span>Impacto:</span>
              <span className="font-mono text-rose-300">
                {floatingLossConsumed > 0 ? 'Bloquea margen' : 'Sin pérdida'}
              </span>
            </div>
          </div>

          {/* TARJETA 3: Órdenes Límite Pendientes */}
          <div className={`bg-slate-800/80 border rounded-xl p-3.5 flex flex-col justify-between shadow-md relative ${
            openOrdersMargin > 0 ? 'border-amber-500/50 bg-amber-950/20' : 'border-slate-700/80'
          }`}>
            <div className="flex items-center justify-between text-gray-400 text-xs mb-1">
              <span className="font-bold uppercase tracking-wider text-[11px] flex items-center gap-1 text-slate-300">
                <span>[3] ⏳ Órdenes Límite</span>
                <Tooltip 
                  title="Margen Retenido en Órdenes Pendientes" 
                  text="Capital retenido por órdenes límite de entrada pendientes que aún no se han ejecutado. Si quedan órdenes huérfanas de ciclos previos, consumen margen disponible." 
                />
              </span>
              <span className={`text-[9px] px-1.5 py-0.5 rounded font-bold uppercase tracking-wider border whitespace-nowrap ${
                openOrdersMargin > 0 ? 'bg-amber-950 border-amber-600 text-amber-300' : 'bg-slate-900 border-slate-700 text-slate-400'
              }`}>
                {openOrdersMargin > 0 ? 'RETENIDO' : 'LIBRE'}
              </span>
            </div>
            <div className={`text-2xl font-black font-mono tracking-tight my-1 ${
              openOrdersMargin > 0 ? 'text-amber-400' : 'text-slate-400'
            }`}>
              ${openOrdersMargin.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
            </div>
            <div className="text-[10px] text-gray-400 border-t border-slate-700/60 pt-1.5">
              {!readOnly && openOrdersMargin > 0 ? (
                <button
                  type="button"
                  onClick={handleCancelStaleOrders}
                  disabled={isCancellingOrders}
                  className="w-full px-2 py-0.5 bg-rose-600/30 hover:bg-rose-600 text-rose-200 hover:text-white border border-rose-500/50 rounded font-semibold transition active:scale-95 flex items-center justify-center gap-1"
                >
                  {isCancellingOrders ? 'Liberando...' : '🧹 Liberar Margen'}
                </button>
              ) : (
                <div className="flex items-center justify-between">
                  <span>Estado:</span>
                  <span className="text-slate-400 font-mono">0 retenido</span>
                </div>
              )}
            </div>
          </div>

          {/* TARJETA 4: Margen Libre Real */}
          <div className={`bg-slate-800/80 border rounded-xl p-3.5 flex flex-col justify-between shadow-md relative ${
            isExhausted ? 'border-rose-700/60 bg-rose-950/20' : 'border-emerald-700/60 bg-emerald-950/10'
          }`}>
            <div className="flex items-center justify-between text-gray-400 text-xs mb-1">
              <span className="font-bold uppercase tracking-wider text-[11px] flex items-center gap-1 text-slate-300">
                <span>[4] 🟢 Margen Libre Real</span>
                <Tooltip 
                  title="Margen Disponible para Operar" 
                  text="Monto en USDT 100% libre e inmediatamente disponible en Binance para abrir nuevas posiciones, coberturas (Hedge) o recompras. Es el saldo restante tras descontar Posiciones, Pérdida Flotante y Órdenes." 
                />
              </span>
              <span className={`text-[9px] px-1.5 py-0.5 rounded font-bold uppercase tracking-wider border whitespace-nowrap ${
                isExhausted 
                  ? 'bg-rose-950 border-rose-600 text-rose-300' 
                  : 'bg-emerald-950 border-emerald-600 text-emerald-300'
              }`}>
                {isExhausted ? 'AGOTADO' : 'DISPONIBLE'}
              </span>
            </div>
            <div className={`text-2xl font-black font-mono tracking-tight my-1 ${
              isExhausted ? 'text-rose-400' : 'text-emerald-400'
            }`}>
              ${freeMarginReal.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
            </div>
            <div className="text-[10px] text-gray-400 border-t border-slate-700/60 pt-1.5 flex items-center justify-between">
              <span>Para operar:</span>
              <span className={`font-semibold font-mono ${isExhausted ? 'text-rose-400' : 'text-emerald-300'}`}>
                {maxExp > 0 ? ((freeMarginReal / maxExp) * 100).toFixed(1) : 0}% libre
              </span>
            </div>
          </div>

          {/* TARJETA 5: Límite Autorizado (Resultado de la Ecuación) */}
          <div className="bg-slate-800/80 border border-purple-600/50 rounded-xl p-3.5 flex flex-col justify-between shadow-md relative bg-gradient-to-b from-purple-950/30 to-slate-900">
            <div className="flex items-center justify-between text-gray-400 text-xs mb-1">
              <span className="font-bold uppercase tracking-wider text-[11px] flex items-center gap-1 text-purple-300">
                <span>[5] 🛡️ (=) Límite Autorizado</span>
                <Tooltip 
                  title="Límite Máximo Autorizado" 
                  text="Tope máximo de capital en USDT que el bot tiene autorizado comprometer simultáneamente. Es el resultado exacto de la suma de las 4 tarjetas anteriores: [En Posiciones] + [Retenido Flotante] + [Órdenes Límite] + [Margen Libre] = Límite Autorizado." 
                />
              </span>
              <span className="text-purple-300 text-[9px] px-1.5 py-0.5 rounded font-mono font-bold uppercase tracking-wider border border-purple-500/40 bg-purple-950/70 whitespace-nowrap">
                {riskPct.toFixed(0)}%
              </span>
            </div>
            <div className="text-2xl font-black font-mono text-purple-300 tracking-tight my-1">
              ${maxExp.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
            </div>
            <div className="text-[10px] text-gray-400 border-t border-purple-800/40 pt-1.5 flex items-center justify-between">
              <span>Saldo Billetera:</span>
              <span className="text-purple-300 font-mono font-semibold">
                ${totalBalance.toFixed(2)}
              </span>
            </div>
          </div>

        </div>

        {/* ======================================================== */}
        {/* BANNER DE AUDITORÍA: ECUACIÓN ARITMÉTICA EXACTA */}
        {/* ======================================================== */}
        <div className="mt-3 px-3.5 py-2 rounded-xl bg-gray-950/90 border border-indigo-900/40 flex flex-wrap items-center justify-between gap-2 text-xs font-mono">
          <div className="flex flex-wrap items-center gap-1.5 text-slate-300">
            <span className="text-amber-400 font-bold">📐 Conciliación Matemática:</span>
            <span>${currentExp.toFixed(2)}</span>
            <span className="text-slate-500 font-bold">+</span>
            <span className={floatingLossConsumed > 0 ? 'text-rose-400 font-semibold' : 'text-slate-400'}>
              ${floatingLossConsumed.toFixed(2)}
            </span>
            <span className="text-slate-500 font-bold">+</span>
            <span className={openOrdersMargin > 0 ? 'text-amber-400 font-semibold' : 'text-slate-400'}>
              ${openOrdersMargin.toFixed(2)}
            </span>
            <span className="text-slate-500 font-bold">+</span>
            <span className={freeMarginReal > 0 ? 'text-emerald-400 font-bold' : 'text-slate-400'}>
              ${freeMarginReal.toFixed(2)}
            </span>
            <span className="text-purple-400 font-bold">=</span>
            <span className="text-purple-300 font-black">${maxExp.toFixed(2)} USDT</span>
            <span className="text-[11px] text-slate-400 font-sans">(100% verificado)</span>
          </div>

          <div className="flex items-center gap-2">
            <span className={`text-[10px] px-2 py-0.5 rounded font-bold uppercase tracking-wider border ${stressBorder}`}>
              {stressLabel}
            </span>
          </div>
        </div>

        {/* ALERTA EXPLICATIVA: Cuando el flotante negativo agota el margen libre */}
        {isExhausted && floatingLossConsumed > 0 && (
          <div className="mt-3 bg-rose-950/40 border border-rose-600/50 rounded-xl p-3 text-xs text-rose-200 flex items-start gap-2.5 shadow-inner">
            <span className="text-base leading-none">⚠️</span>
            <div className="flex-1 space-y-0.5">
              <div className="font-bold text-rose-300 flex items-center gap-2">
                <span>Margen Libre Agotado: La pérdida flotante retiene ${floatingLossConsumed.toFixed(2)} USDT</span>
                <span className="text-[10px] bg-rose-900/80 px-2 py-0.2 rounded border border-rose-700 font-mono">
                  Flotante: {unrealizedPnL.toFixed(2)} USDT
                </span>
              </div>
              <p className="text-[11px] text-rose-200/90 leading-relaxed">
                Aunque las posiciones abiertas utilizan <strong>${currentExp.toFixed(2)} USDT</strong>, la pérdida flotante de tus operaciones en Binance Futures consume <strong>${floatingLossConsumed.toFixed(2)} USDT</strong> adicionales de garantía. Por esta razón contable de Binance, el Margen Libre queda en <strong>$0.00 USDT</strong>. El bot protegerá las operaciones existentes y reanudará nuevas aperturas cuando los trades se recuperen o cierren en TP/SL.
              </p>
            </div>
          </div>
        )}
      </div>

      {/* ======================================================== */}
      {/* BARRA DE UTILIZACIÓN REAL & AJUSTE RÁPIDO DE RIESGO */}
      {/* ======================================================== */}
      <div className="pt-3 border-t border-gray-800/80 flex flex-col md:flex-row items-stretch md:items-center justify-between gap-4 relative z-10">
        
        {/* Barra de Progreso de Utilización Real */}
        <div className="flex-1 space-y-1.5">
          <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-1 text-xs text-gray-300">
            <div className="flex flex-wrap items-center gap-1.5 min-w-0">
              <span className="font-semibold text-slate-300 text-[11px]">Nivel de Utilización Real de Margen:</span>
              <Tooltip 
                title="Nivel de Utilización Real" 
                text="Porcentaje real del límite autorizado que está comprometido entre posiciones abiertas, pérdida flotante y órdenes pendientes. Verde = Seguro (<55%), Amarillo = Moderado (55-85%), Rojo = Alto Riesgo / Agotado (>85%)." 
              />
              <span className="font-mono text-white font-bold bg-gray-950 px-2 py-0.5 rounded border border-gray-700 text-[11px]">
                {realUtilizationPct.toFixed(1)}% del límite
              </span>
            </div>
            <span className="text-gray-400 text-[10px] sm:text-[11px] font-mono whitespace-nowrap">
              ${totalUsedOfLimit.toFixed(2)} de ${maxExp.toFixed(2)} USDT max
            </span>
          </div>
          <div className="w-full bg-gray-950 rounded-full h-3.5 p-0.5 border border-gray-800 relative overflow-hidden">
            <div
              className={`h-full rounded-full transition-all duration-700 ${stressColor}`}
              style={{ width: `${Math.min(100, realUtilizationPct)}%` }}
            />
          </div>
        </div>

        {/* Formulario de Ajuste de Límite (Solo Admin) */}
        {!readOnly && (
          <form onSubmit={handleSaveRiskLimit} className="flex items-center gap-2 flex-shrink-0 bg-gray-950/80 p-2 rounded-xl border border-gray-800">
            <label htmlFor="riskInput" className="text-xs text-gray-300 font-medium whitespace-nowrap pl-1 flex items-center gap-1">
              <span>Ajustar Límite:</span>
              <Tooltip 
                title="Ajuste de Riesgo Máximo" 
                text="Guarda el porcentaje máximo de riesgo permitido para el bot tanto en Binance como en la configuración del servidor." 
              />
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
        )}

      </div>

      {/* Feedback Alert (Riesgo y Liberación de Órdenes) */}
      {(riskFeedback || cancelOrdersFeedback) && (
        <div className={`mt-3 p-2.5 rounded-lg text-xs font-semibold flex items-center justify-between gap-2 ${
          (riskFeedback?.type === 'success' || cancelOrdersFeedback?.type === 'success') 
            ? 'bg-emerald-950/80 text-emerald-300 border border-emerald-800' 
            : 'bg-rose-950/80 text-rose-300 border border-rose-800'
        }`}>
          <div className="flex items-center gap-2">
            <span>{(riskFeedback?.type === 'success' || cancelOrdersFeedback?.type === 'success') ? '✅' : '⚠️'}</span>
            <span>{riskFeedback ? riskFeedback.msg : cancelOrdersFeedback.msg}</span>
          </div>
          <button 
            onClick={() => { setRiskFeedback(null); setCancelOrdersFeedback(null); }}
            className="text-gray-400 hover:text-white text-xs px-2 py-0.5 rounded bg-gray-900 border border-gray-700"
          >
            ✕
          </button>
        </div>
      )}

    </div>
  );
}
