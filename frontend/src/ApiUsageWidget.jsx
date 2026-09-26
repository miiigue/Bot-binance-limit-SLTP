import React, { useState } from 'react';
import ApiUsageModal from './ApiUsageModal';

export default function ApiUsageWidget({ apiUsage = null }) {
  const [isModalOpen, setIsModalOpen] = useState(false);

  const usedPct = apiUsage?.used_percent ?? 0;
  const usedWeight = apiUsage?.used_weight_1m ?? 0;
  const maxWeight = apiUsage?.max_weight_1m ?? 2400;
  const projPct = apiUsage?.projected_percent ?? 0;

  const isCritical = usedPct >= 85 || projPct >= 85;
  const isWarning = !isCritical && (usedPct >= 60 || projPct >= 60);

  const colorClasses = isCritical
    ? 'bg-rose-950/80 border-rose-600/70 text-rose-300 hover:bg-rose-900/80 ring-rose-500/30'
    : isWarning
    ? 'bg-amber-950/80 border-amber-600/70 text-amber-300 hover:bg-amber-900/80 ring-amber-500/30'
    : 'bg-emerald-950/80 border-emerald-600/70 text-emerald-300 hover:bg-emerald-900/80 ring-emerald-500/30';

  const dotClasses = isCritical
    ? 'bg-rose-500 animate-ping'
    : isWarning
    ? 'bg-amber-400'
    : 'bg-emerald-400';

  const label = isCritical ? 'Alerta API' : isWarning ? 'Atención API' : 'API';

  return (
    <>
      <button
        type="button"
        onClick={() => setIsModalOpen(true)}
        className={`flex items-center gap-1.5 px-2.5 py-1 rounded-xl text-xs font-mono font-bold border shadow-sm transition-all active:scale-95 cursor-pointer select-none ${colorClasses}`}
        title="Ver telemetría detallada de la API de Binance, límites de rate limit y análisis predictivo"
      >
        <span className="relative flex h-2 w-2">
          <span className={`absolute inline-flex h-full w-full rounded-full opacity-75 ${dotClasses}`} />
          <span className={`relative inline-flex rounded-full h-2 w-2 ${isCritical ? 'bg-rose-500' : isWarning ? 'bg-amber-400' : 'bg-emerald-400'}`} />
        </span>
        <span className="text-[11px] uppercase tracking-tight">⚡ {label}:</span>
        <span className="font-extrabold text-white">
          {usedPct}%
        </span>
        <span className="text-[10px] opacity-80 hidden sm:inline">
          ({usedWeight}/{maxWeight})
        </span>
      </button>

      <ApiUsageModal
        isOpen={isModalOpen}
        onClose={() => setIsModalOpen(false)}
        initialData={apiUsage}
      />
    </>
  );
}
