import React from 'react';

/**
 * LOGOTIPOS TIPOGRÁFICOS (WORDMARKS) PARA WTN ALGO-TRADING
 * Diseñados según la convención de grandes firmas globales (Citadel, Two Sigma, Jane Street, Stripe).
 * El logo ES el mismo nombre del proyecto, con variantes tipográficas y detalles vectoriales de alta precisión.
 */

// OPCIÓN 1: NEO-QUANT PRO (Estilo Citadel / Bloomberg Terminal)
export function WordmarkNeoQuant({ className = "" }) {
  return (
    <div className={`inline-flex items-center gap-2 select-none ${className}`}>
      <div className="flex items-baseline tracking-tight">
        <span className="text-2xl sm:text-3xl font-black text-white font-mono tracking-tighter">
          WTN
        </span>
        <span className="ml-1.5 text-xl sm:text-2xl font-black bg-gradient-to-r from-cyan-400 via-sky-300 to-blue-500 bg-clip-text text-transparent">
          ALGO
        </span>
        <span className="text-xl sm:text-2xl font-light text-slate-300">
          -
        </span>
        <span className="text-xl sm:text-2xl font-extrabold text-cyan-300 tracking-wide">
          TRADING
        </span>
      </div>
      <span className="inline-block w-2 h-2 rounded-full bg-cyan-400 shadow-md shadow-cyan-400 animate-pulse ml-0.5" />
    </div>
  );
}

// OPCIÓN 2: CYBER-FINTECH MONOLITH (Estilo Stripe / Two Sigma)
export function WordmarkCyberFintech({ className = "" }) {
  return (
    <div className={`inline-flex items-center gap-2 px-3 py-1.5 rounded-xl bg-slate-900/90 border border-cyan-500/30 shadow-inner select-none ${className}`}>
      <span className="px-1.5 py-0.5 rounded bg-gradient-to-r from-cyan-400 to-blue-600 text-slate-950 font-black text-sm font-mono tracking-tighter">
        WTN
      </span>
      <span className="text-lg sm:text-xl font-black tracking-wider text-white">
        ALGO<span className="text-cyan-400">TRADING</span>
      </span>
    </div>
  );
}

// OPCIÓN 3: INSTITUTIONAL EXECUTIVE (Estilo Bridgewater / BlackRock / Goldman Sachs)
export function WordmarkInstitutional({ className = "" }) {
  return (
    <div className={`inline-flex flex-col select-none ${className}`}>
      <div className="flex items-center gap-2">
        <span className="text-2xl sm:text-3xl font-black tracking-widest text-white">
          WTN
        </span>
        <span className="h-4 w-[2px] bg-cyan-400/80" />
        <span className="text-lg sm:text-xl font-bold tracking-tight bg-gradient-to-r from-cyan-300 via-sky-200 to-white bg-clip-text text-transparent">
          ALGO-TRADING
        </span>
      </div>
      <div className="h-[2px] w-full bg-gradient-to-r from-cyan-400 via-blue-500 to-transparent mt-0.5" />
    </div>
  );
}

// OPCIÓN 4: VELOCITY BREAKOUT (Estilo Jane Street / Jump Trading)
export function WordmarkVelocity({ className = "" }) {
  return (
    <div className={`inline-flex items-center gap-1.5 select-none italic font-black ${className}`}>
      <span className="text-2xl sm:text-3xl text-white tracking-tighter">
        WTN
      </span>
      <span className="text-2xl sm:text-3xl bg-gradient-to-r from-cyan-400 via-sky-300 to-blue-400 bg-clip-text text-transparent transform -skew-x-6">
        ALGO
      </span>
      <span className="text-lg sm:text-xl text-sky-200 tracking-normal font-sans not-italic font-bold bg-cyan-950/80 border border-cyan-400/40 px-1.5 py-0.2 rounded text-[11px] ml-1">
        TRADING
      </span>
    </div>
  );
}

export const LOGO_OPTIONS = [
  {
    id: 'neoquant',
    name: 'Opción 1: Neo-Quant Pro',
    subtitle: 'Recomendada • Estilo Citadel / Bloomberg Terminal',
    Component: WordmarkNeoQuant,
    desc: 'El nombre WTN ALGO-TRADING con corte de alta tecnología, gradiente cian eléctrico y pulso cuántico activo.'
  },
  {
    id: 'fintech',
    name: 'Opción 2: Cyber-Fintech Monolith',
    subtitle: 'Estilo Stripe / Two Sigma',
    Component: WordmarkCyberFintech,
    desc: 'El nombre dentro de una cápsula oscura con insignia WTN integrada y tipografía de precisión financiera.'
  },
  {
    id: 'institutional',
    name: 'Opción 3: Institutional Executive',
    subtitle: 'Estilo Bridgewater / BlackRock',
    Component: WordmarkInstitutional,
    desc: 'Diseño sobrio y elegante con tipografía imponente, barra divisoria y vector de liquidez cian.'
  },
  {
    id: 'velocity',
    name: 'Opción 4: Velocity Breakout',
    subtitle: 'Estilo Jane Street / Jump Trading',
    Component: WordmarkVelocity,
    desc: 'Wordmark en cursiva de alta frecuencia con inclinación aerodinámica y etiqueta de trading de baja latencia.'
  }
];
