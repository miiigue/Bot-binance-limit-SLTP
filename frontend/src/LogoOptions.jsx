import React from 'react';

/**
 * LOGOTIPOS TIPOGRÁFICOS (WORDMARKS) PARA WTN ALGO-TRADING
 * Diseñados según los estándares institucionales de firmas globales de trading.
 * La palabra TRADING tiene exactamente el mismo tamaño, estilo y color que el resto de las letras,
 * manteniendo la 'I' y la 'N' estilizadas como velas japonesas alcistas verdes.
 */

// ============================================================================
// MICRO-COMPONENTES SVG: VELAS ALCISTAS VERDES (CANDLESTICKS) PARA 'I' Y 'N'
// ============================================================================

/**
 * CandlestickLetterI: Vela japonesa verde sólida con mecha superior e inferior
 */
export function CandlestickLetterI({ size = 22, className = "" }) {
  const width = Math.max(7, Math.round(size * 0.36));
  return (
    <svg
      width={width}
      height={size}
      viewBox="0 0 10 24"
      className={`inline-block align-middle mx-[1px] shrink-0 drop-shadow-[0_0_6px_rgba(16,185,129,0.7)] ${className}`}
      fill="none"
      xmlns="http://www.w3.org/2000/svg"
    >
      {/* Mecha superior */}
      <line x1="5" y1="1" x2="5" y2="5" stroke="#10b981" strokeWidth="1.8" strokeLinecap="round" />
      {/* Cuerpo sólido de la vela verde alcista */}
      <rect x="1.5" y="5" width="7" height="14" rx="1.2" fill="#10b981" />
      {/* Mecha inferior */}
      <line x1="5" y1="19" x2="5" y2="23" stroke="#10b981" strokeWidth="1.8" strokeLinecap="round" />
    </svg>
  );
}

/**
 * CandlestickLetterN: Letra 'N' formada por velas alcistas verdes en escalada conectadas por la diagonal técnica
 */
export function CandlestickLetterN({ size = 22, className = "" }) {
  const width = Math.max(15, Math.round(size * 0.76));
  return (
    <svg
      width={width}
      height={size}
      viewBox="0 0 20 24"
      className={`inline-block align-middle mx-[1px] shrink-0 drop-shadow-[0_0_6px_rgba(16,185,129,0.7)] ${className}`}
      fill="none"
      xmlns="http://www.w3.org/2000/svg"
    >
      {/* Vela 1 (Tallo izquierdo) */}
      <line x1="3.5" y1="3.5" x2="3.5" y2="7" stroke="#10b981" strokeWidth="1.8" strokeLinecap="round" />
      <rect x="1.5" y="7" width="4.5" height="12" rx="1" fill="#10b981" />
      <line x1="3.5" y1="19" x2="3.5" y2="22.5" stroke="#10b981" strokeWidth="1.8" strokeLinecap="round" />

      {/* Trazo diagonal de la N (trazo alcista conector) */}
      <path d="M 4 8 L 16 18" stroke="#10b981" strokeWidth="3.2" strokeLinecap="round" />

      {/* Vela 2 (Tallo derecho en breakout ascendente más alto) */}
      <line x1="16.5" y1="1" x2="16.5" y2="4.5" stroke="#34d399" strokeWidth="1.8" strokeLinecap="round" />
      <rect x="14" y="4.5" width="4.5" height="14" rx="1" fill="#34d399" />
      <line x1="16.5" y1="18.5" x2="16.5" y2="22" stroke="#34d399" strokeWidth="1.8" strokeLinecap="round" />
    </svg>
  );
}

// ============================================================================
// VARIANTE 1: VELOCITY CANDLESTICK UNIFICADO (FLAGSHIP RECOMENDADA)
// Todo el nombre en mismo tamaño y estilo fluido, con I y N de vela verde
// ============================================================================
export function WordmarkVelocityApex({ className = "" }) {
  return (
    <div className={`inline-flex items-center gap-1.5 select-none font-black text-2xl sm:text-3xl tracking-tighter ${className}`}>
      <span className="text-white italic">
        WTN
      </span>
      <span className="bg-gradient-to-r from-cyan-400 via-sky-300 to-blue-500 bg-clip-text text-transparent transform -skew-x-6 italic flex items-center">
        <span>ALGO-TRAD</span>
        <CandlestickLetterI size={23} className="not-italic" />
        <CandlestickLetterN size={23} className="not-italic" />
        <span>G</span>
      </span>
    </div>
  );
}

export const WordmarkCandlestickApex = WordmarkVelocityApex;

// ============================================================================
// VARIANTE 2: PURE WHITE CANDLESTICK
// Todas las letras en blanco puro con el mismo tamaño y las velas verdes resaltando
// ============================================================================
export function WordmarkPureWhiteCandlestick({ className = "" }) {
  return (
    <div className={`inline-flex items-center gap-1.5 select-none font-black text-2xl sm:text-3xl tracking-tighter ${className}`}>
      <span className="text-white italic">
        WTN
      </span>
      <span className="text-white transform -skew-x-6 italic flex items-center">
        <span>ALGO-TRAD</span>
        <CandlestickLetterI size={23} className="not-italic" />
        <CandlestickLetterN size={23} className="not-italic" />
        <span>G</span>
      </span>
    </div>
  );
}

// ============================================================================
// VARIANTE 3: VELOCITY CYBER SLASH (Con separador cuántico //)
// ============================================================================
export function WordmarkVelocityCyberSlash({ className = "" }) {
  return (
    <div className={`inline-flex items-center gap-1.5 select-none font-black text-2xl sm:text-3xl tracking-tight ${className}`}>
      <span className="text-white italic">
        WTN
      </span>
      <span className="not-italic text-xl text-cyan-400 font-mono font-light select-none transform -skew-x-12 opacity-80">
        //
      </span>
      <span className="bg-gradient-to-r from-cyan-300 via-sky-200 to-blue-400 bg-clip-text text-transparent transform -skew-x-6 italic flex items-center">
        <span>ALGO TRAD</span>
        <CandlestickLetterI size={23} className="not-italic" />
        <CandlestickLetterN size={23} className="not-italic" />
        <span>G</span>
      </span>
    </div>
  );
}

// ============================================================================
// VARIANTE 4: VELOCITY LASER HORIZON (Con estela láser continua)
// ============================================================================
export function WordmarkVelocityLaser({ className = "" }) {
  return (
    <div className={`inline-flex flex-col select-none ${className}`}>
      <div className="inline-flex items-center gap-1.5 font-black text-2xl sm:text-3xl tracking-tighter">
        <span className="text-white italic">
          WTN
        </span>
        <span className="bg-gradient-to-r from-cyan-400 to-sky-300 bg-clip-text text-transparent italic flex items-center">
          <span>ALGO-TRAD</span>
          <CandlestickLetterI size={23} className="not-italic" />
          <CandlestickLetterN size={23} className="not-italic" />
          <span>G</span>
        </span>
      </div>
      {/* Estela láser de ejecución continua */}
      <div className="h-[2px] w-full bg-gradient-to-r from-cyan-400 via-emerald-400 to-transparent rounded-full mt-0.5" />
    </div>
  );
}

// ============================================================================
// VARIANTE 5: VELOCITY MONOLITH CAPSULE
// ============================================================================
export function WordmarkVelocityMonolith({ className = "" }) {
  return (
    <div className={`inline-flex items-center gap-2 px-3 py-1.5 rounded-xl bg-slate-900/90 border border-cyan-500/30 shadow-inner select-none font-black text-xl sm:text-2xl ${className}`}>
      <span className="text-white tracking-tight italic">
        WTN
      </span>
      <div className="h-4 w-[1px] bg-cyan-500/40 not-italic" />
      <span className="bg-gradient-to-r from-cyan-400 to-sky-300 bg-clip-text text-transparent transform -skew-x-3 italic flex items-center">
        <span>ALGO-TRAD</span>
        <CandlestickLetterI size={20} className="not-italic" />
        <CandlestickLetterN size={20} className="not-italic" />
        <span>G</span>
      </span>
      <span className="inline-block w-2 h-2 rounded-full bg-emerald-400 shadow-sm shadow-emerald-400 animate-pulse ml-0.5 not-italic" />
    </div>
  );
}

// ============================================================================
// VARIANTE 6: NEO-QUANT CANDLESTICK (Terminal con pulso)
// ============================================================================
export function WordmarkNeoQuant({ className = "" }) {
  return (
    <div className={`inline-flex items-center gap-2 select-none text-2xl sm:text-3xl font-black font-mono tracking-tighter ${className}`}>
      <span className="text-white">
        WTN
      </span>
      <span className="ml-1 bg-gradient-to-r from-cyan-400 via-sky-300 to-blue-500 bg-clip-text text-transparent flex items-center">
        <span>ALGO-TRAD</span>
        <CandlestickLetterI size={22} className="not-italic" />
        <CandlestickLetterN size={22} className="not-italic" />
        <span>G</span>
      </span>
      <span className="inline-block w-2 h-2 rounded-full bg-emerald-400 shadow-md shadow-emerald-400 animate-pulse ml-0.5" />
    </div>
  );
}

export const WordmarkVelocityTitanium = WordmarkPureWhiteCandlestick;

// CATÁLOGO COMPLETO DE OPCIONES PARA EL MODAL SELECTOR
export const LOGO_OPTIONS = [
  {
    id: 'velocity-apex',
    name: 'Opción 1: Velocity Candlestick (Recomendada)',
    subtitle: 'Mismo Estilo y Tamaño con Velas Verdes Integradas',
    Component: WordmarkVelocityApex,
    desc: 'La palabra TRADING tiene exactamente el mismo tamaño, tipografía y gradiente que ALGO, integrando las velas alcistas en I y N de manera fluida y continua.'
  },
  {
    id: 'velocity-white',
    name: 'Opción 2: Pure White Candlestick',
    subtitle: 'Blanco Platino Uniforme con Velas Esmeralda',
    Component: WordmarkPureWhiteCandlestick,
    desc: 'Todo el nombre en tipografía blanca uniforme de máximo impacto visual, donde únicamente destacan las dos velas verdes alcistas.'
  },
  {
    id: 'velocity-cyber',
    name: 'Opción 3: Cyber Slash Candlestick',
    subtitle: 'Estilo Fintech con Separador y Velas',
    Component: WordmarkVelocityCyberSlash,
    desc: 'Separador técnico // con tipografía continua de gran tamaño y velas en I y N.'
  },
  {
    id: 'velocity-laser',
    name: 'Opción 4: Laser Horizon Candlestick',
    subtitle: 'Estilo Bloomberg Terminal con Estela Continua',
    Component: WordmarkVelocityLaser,
    desc: 'Tipografía fluida en una sola línea continua subrayada por una estela láser de baja latencia.'
  },
  {
    id: 'velocity-monolith',
    name: 'Opción 5: Monolith Capsule Candlestick',
    subtitle: 'Cápsula Integrada con LED Activo',
    Component: WordmarkVelocityMonolith,
    desc: 'Cápsula institucional con borde reflectivo y velas verdes uniformes.'
  },
  {
    id: 'neoquant',
    name: 'Opción 6: Neo-Quant Candlestick',
    subtitle: 'Estilo Terminal Monoespaciada',
    Component: WordmarkNeoQuant,
    desc: 'Tipografía de terminal algorítmica con velas verdes en TRADING y pulso esmeralda activo.'
  }
];
