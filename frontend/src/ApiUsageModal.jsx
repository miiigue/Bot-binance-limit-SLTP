import React, { useEffect, useState } from 'react';

export default function ApiUsageModal({ isOpen, onClose, initialData = null }) {
  const [data, setData] = useState(initialData);
  const [isLoading, setIsLoading] = useState(!initialData);

  const fetchApiUsage = async () => {
    try {
      const res = await fetch('/api/api_usage');
      if (res.ok) {
        const json = await res.json();
        setData(json);
      }
    } catch (e) {
      console.debug('Error consultando /api/api_usage:', e);
    } finally {
      setIsLoading(false);
    }
  };

  useEffect(() => {
    if (isOpen) {
      fetchApiUsage();
      const interval = setInterval(fetchApiUsage, 3000);
      return () => clearInterval(interval);
    }
  }, [isOpen]);

  if (!isOpen) return null;

  const usedWeight = data?.used_weight_1m ?? 0;
  const maxWeight = data?.max_weight_1m ?? 2400;
  const usedPct = data?.used_percent ?? 0;
  const projWeight = data?.projected_weight_1m ?? 0;
  const projPct = data?.projected_percent ?? 0;
  const orders10s = data?.order_count_10s ?? 0;
  const maxOrders10s = data?.max_orders_10s ?? 300;
  const orders1m = data?.order_count_1m ?? 0;
  const maxOrders1m = data?.max_orders_1m ?? 1200;
  const factors = data?.factors ?? {};

  const isCritical = usedPct >= 85 || projPct >= 85;
  const isWarning = !isCritical && (usedPct >= 60 || projPct >= 60);

  const statusBadge = isCritical ? {
    bg: 'bg-rose-950/80 text-rose-300 border-rose-600/60',
    dot: 'bg-rose-500',
    title: 'CRÍTICO - RIESGO DE RATE LIMIT (429)',
    desc: 'El consumo supera el 85% permitido. Aumenta el tiempo de ciclo (cycle_sleep_seconds) o reduce la cantidad de pares.'
  } : isWarning ? {
    bg: 'bg-amber-950/80 text-amber-300 border-amber-600/60',
    dot: 'bg-amber-400',
    title: 'PRECAUCIÓN - CONSUMO MODERADO',
    desc: 'El bot consume entre el 60% y 85% del cupo. Operativa estable pero con margen ajustado.'
  } : {
    bg: 'bg-emerald-950/80 text-emerald-300 border-emerald-600/60',
    dot: 'bg-emerald-400',
    title: 'SEGURO Y EQUILIBRADO',
    desc: 'Operativa 100% holgada. Consumo óptimo de la API sin ningún riesgo de saturación ni baneo IP.'
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/80 backdrop-blur-sm p-4 animate-fade-in">
      <div className="bg-slate-900 border border-slate-700 rounded-2xl w-full max-w-2xl max-h-[90vh] overflow-y-auto shadow-2xl p-5 md:p-6 text-slate-100">
        
        {/* Cabecera */}
        <div className="flex items-center justify-between pb-4 border-b border-slate-800">
          <div className="flex items-center gap-2.5">
            <div className="w-10 h-10 rounded-xl bg-amber-400/10 border border-amber-400/30 flex items-center justify-center text-xl">
              ⚡
            </div>
            <div>
              <h2 className="text-base md:text-lg font-black text-white flex items-center gap-2">
                Telemetría y Límites de API Binance
                <span className="text-[11px] px-2 py-0.5 rounded-full bg-slate-800 text-amber-300 border border-slate-700 font-mono">
                  Futures USDT-M
                </span>
              </h2>
              <p className="text-xs text-slate-400">
                Monitoreo en tiempo real del peso utilizado y análisis predictivo según tus estrategias.
              </p>
            </div>
          </div>
          <button
            onClick={onClose}
            className="w-8 h-8 rounded-lg bg-slate-800 hover:bg-slate-700 text-slate-400 hover:text-white flex items-center justify-center transition text-sm font-bold"
          >
            ✕
          </button>
        </div>

        {/* Estado Global (Semáforo) */}
        <div className={`mt-4 p-3.5 rounded-xl border flex items-start gap-3 ${statusBadge.bg}`}>
          <span className={`w-3 h-3 rounded-full mt-1 flex-shrink-0 animate-pulse ${statusBadge.dot}`} />
          <div className="flex-1">
            <div className="text-xs font-extrabold uppercase tracking-wide">
              {statusBadge.title}
            </div>
            <div className="text-xs text-slate-300 mt-0.5 font-light">
              {statusBadge.desc}
            </div>
          </div>
        </div>

        {/* Cuadrícula de Medidores */}
        <div className="grid grid-cols-1 md:grid-cols-2 gap-3.5 mt-4">
          
          {/* Tarjeta 1: Consumo Real Oficial (Binance Headers) */}
          <div className="p-4 bg-slate-950/70 rounded-xl border border-slate-800">
            <div className="flex items-center justify-between text-xs text-slate-400 font-bold mb-1">
              <span>📡 Consumo Real en Vivo</span>
              <span className="font-mono text-white font-extrabold">{usedWeight} / {maxWeight} w/m</span>
            </div>
            
            {/* Barra de progreso */}
            <div className="w-full h-3 bg-slate-800 rounded-full overflow-hidden my-2 border border-slate-700/60">
              <div
                className={`h-full transition-all duration-500 rounded-full ${
                  usedPct > 80 ? 'bg-gradient-to-r from-rose-500 to-red-600' :
                  usedPct > 50 ? 'bg-gradient-to-r from-amber-500 to-amber-600' :
                  'bg-gradient-to-r from-emerald-500 to-teal-500'
                }`}
                style={{ width: `${Math.min(100, Math.max(3, usedPct))}%` }}
              />
            </div>

            <div className="flex justify-between items-center text-[11px] text-slate-400 font-mono">
              <span>Uso Actual: <strong className="text-white">{usedPct}%</strong></span>
              <span>Límite IP: <strong>2,400 w/min</strong></span>
            </div>
            <p className="text-[10px] text-slate-500 mt-2 italic">
              * Datos directos de la cabecera oficial <code>x-mbx-used-weight-1m</code> emitida por Binance.
            </p>
          </div>

          {/* Tarjeta 2: Consumo Proyectado de las Estrategias */}
          <div className="p-4 bg-slate-950/70 rounded-xl border border-slate-800">
            <div className="flex items-center justify-between text-xs text-slate-400 font-bold mb-1">
              <span>🎯 Proyección según Configuración</span>
              <span className="font-mono text-cyan-300 font-extrabold">~{projWeight} / {maxWeight} w/m</span>
            </div>

            {/* Barra de progreso */}
            <div className="w-full h-3 bg-slate-800 rounded-full overflow-hidden my-2 border border-slate-700/60">
              <div
                className={`h-full transition-all duration-500 rounded-full ${
                  projPct > 80 ? 'bg-gradient-to-r from-rose-500 to-red-600' :
                  projPct > 50 ? 'bg-gradient-to-r from-amber-500 to-amber-600' :
                  'bg-gradient-to-r from-cyan-500 to-blue-500'
                }`}
                style={{ width: `${Math.min(100, Math.max(3, projPct))}%` }}
              />
            </div>

            <div className="flex justify-between items-center text-[11px] text-slate-400 font-mono">
              <span>Carga Estimada: <strong className="text-white">{projPct}%</strong></span>
              <span>Holgura Libre: <strong className="text-emerald-400">{(100 - projPct).toFixed(1)}%</strong></span>
            </div>
            <p className="text-[10px] text-slate-500 mt-2 italic">
              * Cálculo matemático de ciclos continuos de todos los pares operando a la vez.
            </p>
          </div>

        </div>

        {/* Límites de Órdenes de Binance */}
        <div className="mt-4 p-3.5 bg-slate-950/50 rounded-xl border border-slate-800">
          <h4 className="text-xs font-bold text-white mb-2 flex items-center gap-1.5">
            <span>🛡️</span> Límites de Creación de Órdenes (Matching Engine)
          </h4>
          <div className="grid grid-cols-2 gap-3 text-xs font-mono">
            <div className="p-2.5 bg-slate-900/80 rounded-lg border border-slate-800 flex items-center justify-between">
              <span className="text-slate-400">Órdenes / 10s:</span>
              <span className="font-bold text-emerald-400">{orders10s} / {maxOrders10s}</span>
            </div>
            <div className="p-2.5 bg-slate-900/80 rounded-lg border border-slate-800 flex items-center justify-between">
              <span className="text-slate-400">Órdenes / 1 min:</span>
              <span className="font-bold text-emerald-400">{orders1m} / {maxOrders1m}</span>
            </div>
          </div>
        </div>

        {/* Desglose de Factores que Influyen en el Consumo */}
        <div className="mt-4 p-3.5 bg-slate-950/50 rounded-xl border border-slate-800">
          <h4 className="text-xs font-bold text-white mb-2.5 flex items-center gap-1.5">
            <span>⚙️</span> Factores de tu Configuración que Determinan el Consumo
          </h4>

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-2 text-xs">
            <div className="flex items-center justify-between p-2 rounded-lg bg-slate-900/60 border border-slate-800/80">
              <span className="text-slate-400 flex items-center gap-1">
                <span>⏱️</span> Ciclo de Espera (Sleep):
              </span>
              <span className="font-mono font-bold text-amber-300">
                {factors.cycle_sleep_seconds ?? 3}s ({factors.cycles_per_minute_per_pair ?? 20} loops/min por par)
              </span>
            </div>

            <div className="flex items-center justify-between p-2 rounded-lg bg-slate-900/60 border border-slate-800/80">
              <span className="text-slate-400 flex items-center gap-1">
                <span>🪙</span> Pares Activos en Simultáneo:
              </span>
              <span className="font-mono font-bold text-indigo-300">
                {factors.active_symbols_count ?? 6} pares ({factors.total_cycles_per_minute ?? 120} ciclos/min tot.)
              </span>
            </div>

            <div className="flex items-center justify-between p-2 rounded-lg bg-slate-900/60 border border-slate-800/80">
              <span className="text-slate-400 flex items-center gap-1">
                <span>📊</span> Intervalo de Velas RSI:
              </span>
              <span className="font-mono font-bold text-slate-200">
                {factors.rsi_interval ?? '3m'} (1 klines/loop)
              </span>
            </div>

            <div className="flex items-center justify-between p-2 rounded-lg bg-slate-900/60 border border-slate-800/80">
              <span className="text-slate-400 flex items-center gap-1">
                <span>🛡️</span> Escudo BTC & Filtros:
              </span>
              <span className="font-mono font-bold text-emerald-400">
                {factors.btc_crash_shield ? 'Activo (Caché 15s)' : 'Desactivado'}
              </span>
            </div>
          </div>

          <div className="mt-3 p-2.5 rounded-lg bg-indigo-950/30 border border-indigo-700/40 text-[11px] text-indigo-200 leading-relaxed">
            💡 <strong>Regla de Oro de Binance:</strong> Para operar con 6 a 12 pares de forma continua, se recomienda mantener <code>cycle_sleep_seconds</code> en <strong>2 a 5 segundos</strong>. Bajarlo a menos de 1 segundo multiplicará las peticiones exponencialmente y podría acarrear un bloqueo temporal de IP (código HTTP 429).
          </div>
        </div>

        {/* Botón de Cierre */}
        <div className="mt-5 flex justify-end">
          <button
            type="button"
            onClick={onClose}
            className="px-5 py-2 bg-slate-800 hover:bg-slate-700 text-white font-bold rounded-xl text-xs transition border border-slate-700"
          >
            Cerrar Telemetría
          </button>
        </div>

      </div>
    </div>
  );
}
