import React, { useState } from 'react';
import ApiUsageModal from './ApiUsageModal';

export default function ApiConsumptionCalculator({
  cycleSleepSeconds = 3,
  symbolsCount = 6,
  enableBtcShield = true,
  enableRegime = false,
  orderType = 'LIMIT'
}) {
  const [isModalOpen, setIsModalOpen] = useState(false);

  const sleepSec = Math.max(0.5, parseFloat(cycleSleepSeconds) || 3.0);
  const pairs = Math.max(1, parseInt(symbolsCount) || 1);

  const cyclesPerMinPerPair = Math.round((60.0 / sleepSec) * 10) / 10;
  const totalCyclesPerMin = Math.round(cyclesPerMinPerPair * pairs);

  // Cada ciclo por par ejecuta klines (weight 1-2) + position risk (weight 5) + control
  const weightPerCycle = 6.0;
  let projectedWeight = Math.round(totalCyclesPerMin * weightPerCycle);
  if (enableBtcShield) projectedWeight += 8;
  if (enableRegime) projectedWeight += 10;

  const maxWeight = 2400;
  const percent = Math.min(100, Math.round((projectedWeight / maxWeight) * 100));

  const isCritical = percent >= 85;
  const isWarning = !isCritical && percent >= 60;

  const badgeColor = isCritical
    ? 'text-rose-400 bg-rose-950/80 border-rose-600/60'
    : isWarning
    ? 'text-amber-400 bg-amber-950/80 border-amber-600/60'
    : 'text-emerald-400 bg-emerald-950/80 border-emerald-600/60';

  const barColor = isCritical
    ? 'from-rose-500 to-red-600'
    : isWarning
    ? 'from-amber-500 to-amber-600'
    : 'from-emerald-500 to-teal-500';

  return (
    <div className="p-4 rounded-xl border border-slate-700/80 bg-slate-950/80 shadow-inner mt-4 font-mono text-xs">
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2 pb-2.5 border-b border-slate-800">
        <div className="flex items-center gap-2">
          <span className="text-base">📡</span>
          <div>
            <h4 className="font-extrabold text-white text-xs flex items-center gap-1.5">
              Impacto y Consumo de API Binance según esta Configuración
            </h4>
            <p className="text-[11px] text-slate-400 font-sans">
              Calculador preventivo para asegurar que tus parámetros no superen los límites de Binance.
            </p>
          </div>
        </div>

        <div className="flex items-center gap-2">
          <span className={`px-2.5 py-1 rounded-lg border font-bold text-[11px] ${badgeColor}`}>
            {isCritical ? '⚠️ RIESGO ALTO' : isWarning ? '⚡ MODERADO' : '✅ 100% SEGURO'} ({percent}%)
          </span>
          <button
            type="button"
            onClick={() => setIsModalOpen(true)}
            className="px-2.5 py-1 rounded-lg bg-indigo-600/80 hover:bg-indigo-600 text-white font-bold text-[11px] transition shadow-sm"
          >
            Ver Telemetría en Vivo ➔
          </button>
        </div>
      </div>

      {/* Barra de Consumo Proyectado */}
      <div className="mt-3">
        <div className="flex justify-between items-center text-[11px] text-slate-300 mb-1">
          <span>Consumo Proyectado: <strong className="text-white">{projectedWeight} / {maxWeight} weight/min</strong></span>
          <span>Holgura Disponible: <strong className="text-emerald-400">{Math.max(0, 100 - percent)}%</strong></span>
        </div>
        <div className="w-full h-2.5 bg-slate-800 rounded-full overflow-hidden border border-slate-700/60">
          <div
            className={`h-full bg-gradient-to-r ${barColor} transition-all duration-300 rounded-full`}
            style={{ width: `${Math.min(100, Math.max(4, percent))}%` }}
          />
        </div>
      </div>

      {/* Desglose de parámetros influyentes */}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-2 mt-3 text-[11px]">
        <div className="p-2 rounded-lg bg-slate-900/90 border border-slate-800">
          <span className="text-slate-400 block text-[10px]">Tiempos de Ciclo:</span>
          <strong className="text-amber-300 font-bold">{sleepSec}s</strong> ({cyclesPerMinPerPair} loops/min)
        </div>
        <div className="p-2 rounded-lg bg-slate-900/90 border border-slate-800">
          <span className="text-slate-400 block text-[10px]">Pares Operando:</span>
          <strong className="text-indigo-300 font-bold">{pairs} pares</strong> ({totalCyclesPerMin} ciclos/min)
        </div>
        <div className="p-2 rounded-lg bg-slate-900/90 border border-slate-800">
          <span className="text-slate-400 block text-[10px]">Escudo BTC / Filtros:</span>
          <strong className="text-slate-200 font-bold">{enableBtcShield ? 'Activo (8w)' : 'Inactivo'}</strong>
        </div>
        <div className="p-2 rounded-lg bg-slate-900/90 border border-slate-800">
          <span className="text-slate-400 block text-[10px]">Tipo Orden:</span>
          <strong className={orderType === 'MARKET' ? 'text-amber-400 font-bold' : 'text-emerald-400 font-bold'}>
            {orderType}
          </strong>
        </div>
      </div>

      {sleepSec < 2 && pairs >= 6 && (
        <div className="mt-2.5 p-2 rounded-lg bg-rose-950/60 border border-rose-700/50 text-[11px] text-rose-300 leading-snug font-sans">
          ⚠️ <strong>Advertencia:</strong> Estás usando un tiempo de ciclo muy bajo ({sleepSec}s) con {pairs} pares activos. Binance podría emitir errores 429 si el volumen de solicitudes por minuto supera las 2,400 unidades de peso. Se recomienda usar al menos <strong>2.5s - 3s</strong>.
        </div>
      )}

      <ApiUsageModal
        isOpen={isModalOpen}
        onClose={() => setIsModalOpen(false)}
      />
    </div>
  );
}
