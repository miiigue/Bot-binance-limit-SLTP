import React from 'react';

/**
 * LOGOTIPOS TIPOGRÁFICOS (WORDMARKS) PARA WTN ALGO-TRADING
 * Diseñados según los estándares institucionales de firmas globales de trading.
 * Incorpora la letra 'I' como una vela alcista verde japonesa y la 'N' con estructura de velas alcistas en breakout.
 */

// ============================================================================
// MICRO-COMPONENTES SVG: VELAS ALCISTAS VERDES (CANDLESTICKS) PARA 'I' Y 'N'
// ============================================================================

/**
 * CandlestickLetterI: Vela japonesa verde sólida con mecha superior e inferior
 */
export function CandlestickLetterI({ size = 18, className = "" }) {
  const width = Math.max(6, Math.round(size * 0.38));
  return (
    <svg
      width={width}
      height={size}
      viewBox="0 0 10 24"
      className={`inline-block align-middle mx-[1px] shrink-0 drop-shadow-[0_0_6px_rgba(16,185,129,0.6)] ${className}`}
      fill="none"
      xmlns="http://www.w3.org/2000/svg"
    >
      {/* Mecha superior */}
      <line x1="5" y1="1" x2="5" y2="5" stroke="#10b981" strokeWidth="1.8" strokeLinecap="round" />
      {/* Cuerpo sólido de la vela verde alcista */}
      <rect x="2" y="5" width="6" height="14" rx="1.2" fill="#10b981" />
      {/* Mecha inferior */}
      <line x1="5" y1="19" x2="5" y2="23" stroke="#10b981" strokeWidth="1.8" strokeLinecap="round" />
    </svg>
  );
}

/**
 * CandlestickLetterN: Letra 'N' formada por velas alcistas verdes en escalada conectadas por la diagonal técnica
 */
export function CandlestickLetterN({ size = 18, className = "" }) {
  const width = Math.max(12, Math.round(size * 0.78));
  return (
    <svg
      width={width}
      height={size}
      viewBox="0 0 20 24"
      className={`inline-block align-middle mx-[1px] shrink-0 drop-shadow-[0_0_6px_rgba(16,185,129,0.6)] ${className}`}
      fill="none"
      xmlns="http://www.w3.org/2000/svg"
    >
      {/* Vela 1 (Tallo izquierdo) */}
      <line x1="3.5" y1="3.5" x2="3.5" y2="7" stroke="#10b981" strokeWidth="1.8" strokeLinecap="round" />
      <rect x="1.5" y="7" width="4" height="12" rx="1" fill="#10b981" />
      <line x1="3.5" y1="19" x2="3.5" y2="22.5" stroke="#10b981" strokeWidth="1.8" strokeLinecap="round" />

      {/* Trazo diagonal de la N (trazo alcista conector) */}
      <path d="M 4 8 L 16 18" stroke="#10b981" strokeWidth="3" strokeLinecap="round" />

      {/* Vela 2 (Tallo derecho en breakout ascendente más alto) */}
      <line x1="16.5" y1="1" x2="16.5" y2="4.5" stroke="#34d399" strokeWidth="1.8" strokeLinecap="round" />
      <rect x="14.5" y="4.5" width="4" height="14" rx="1" fill="#34d399" />
      <line x1="16.5" y1="18.5" x2="16.5" y2="22" stroke="#34d399" strokeWidth="1.8" strokeLinecap="round" />
    </svg>
  );
}

/**
 * Palabra TRADING completa con la 'I' y la 'N' estilizadas como velas verdes japonesas
 */
export function CandlestickTradingWord({ textSize = "text-xs sm:text-sm", candleSize = 16, className = "" }) {
  return (
    <span className={`inline-flex items-center font-black tracking-wider text-cyan-200 uppercase ${textSize} ${className}`}>
      <span>TRAD</span>
      <CandlestickLetterI size={candleSize} />
      <CandlestickLetterN size={candleSize} />
      <span>G</span>
    </span>
  );
}

// ============================================================================
// VARIANTE FLAGSHIP: CANDLESTICK APEX (La opción principal con I y N de vela verde)
// ============================================================================
export function WordmarkCandlestickApex({ className = "" }) {
  return (
    <div className={`inline-flex items-center gap-1.5 select-none font-black ${className}`}>
      <span className="text-2xl sm:text-3xl text-white tracking-tighter italic">
        WTN
      </span>
      <span className="text-2xl sm:text-3xl bg-gradient-to-r from-cyan-400 via-sky-300 to-blue-500 bg-clip-text text-transparent transform -skew-x-6 italic">
        ALGO
      </span>
      <div className="not-italic flex items-center gap-1 bg-gradient-to-r from-cyan-950/90 to-blue-950/80 border border-cyan-400/50 px-2 py-0.5 rounded-lg shadow-sm shadow-cyan-500/20 ml-1">
        <CandlestickTradingWord textSize="text-[11px] sm:text-xs" candleSize={14} />
      </div>
    </div>
  );
}

// Alias para compatibilidad con código existente
export const WordmarkVelocityApex = WordmarkCandlestickApex;

// ============================================================================
// VARIANTE 2: VELOCITY CYBER SLASH (Con velas japonesas en TRADING)
// ============================================================================
export function WordmarkVelocityCyberSlash({ className = "" }) {
  return (
    <div className={`inline-flex items-center gap-1.5 select-none font-black ${className}`}>
      <span className="text-2xl sm:text-3xl text-white tracking-tight drop-shadow-sm italic">
        WTN
      </span>
      <span className="not-italic text-xl text-cyan-400 font-mono font-light select-none transform -skew-x-12 opacity-80">
        //
      </span>
      <span className="text-2xl sm:text-3xl bg-gradient-to-r from-cyan-300 via-sky-200 to-blue-400 bg-clip-text text-transparent transform -skew-x-6 italic">
        ALGO
      </span>
      <div className="not-italic ml-0.5 flex items-center">
        <CandlestickTradingWord textSize="text-base sm:text-lg" candleSize={18} />
      </div>
      <span className="inline-block w-1.5 h-1.5 rounded-full bg-cyan-400 shadow-md shadow-cyan-400 animate-ping ml-1" />
    </div>
  );
}

// ============================================================================
// VARIANTE 3: VELOCITY LASER HORIZON (Con estela láser continua)
// ============================================================================
export function WordmarkVelocityLaser({ className = "" }) {
  return (
    <div className={`inline-flex flex-col select-none ${className}`}>
      <div className="inline-flex items-center gap-1.5 font-black">
        <span className="text-2xl sm:text-3xl text-white tracking-tighter italic">
          WTN
        </span>
        <span className="text-2xl sm:text-3xl bg-gradient-to-r from-cyan-400 to-sky-300 bg-clip-text text-transparent italic">
          ALGO-
        </span>
        <CandlestickTradingWord textSize="text-xl sm:text-2xl" candleSize={20} />
      </div>
      {/* Estela láser de ejecución continua */}
      <div className="h-[2px] w-full bg-gradient-to-r from-cyan-400 via-emerald-400 to-transparent rounded-full mt-0.5" />
    </div>
  );
}

// ============================================================================
// VARIANTE 4: VELOCITY MONOLITH CAPSULE (Cápsula con velas y LED activo)
// ============================================================================
export function WordmarkVelocityMonolith({ className = "" }) {
  return (
    <div className={`inline-flex items-center gap-2 px-3 py-1.5 rounded-xl bg-slate-900/90 border border-cyan-500/30 shadow-inner select-none font-black ${className}`}>
      <span className="text-xl sm:text-2xl text-white tracking-tight italic">
        WTN
      </span>
      <div className="h-4 w-[1px] bg-cyan-500/40 not-italic" />
      <span className="text-xl sm:text-2xl bg-gradient-to-r from-cyan-400 to-sky-300 bg-clip-text text-transparent transform -skew-x-3 italic">
        ALGO
      </span>
      <div className="not-italic px-1.5 py-0.5 rounded bg-cyan-950/80 border border-cyan-400/40">
        <CandlestickTradingWord textSize="text-[11px]" candleSize={13} />
      </div>
      <span className="inline-block w-2 h-2 rounded-full bg-emerald-400 shadow-sm shadow-emerald-400 animate-pulse ml-0.5 not-italic" />
    </div>
  );
}

// ============================================================================
// VARIANTE 5: VELOCITY PURE TITANIUM (Minimalismo puro oblicuo)
// ============================================================================
export function WordmarkVelocityTitanium({ className = "" }) {
  return (
    <div className={`inline-flex items-baseline gap-2 select-none ${className}`}>
      <span className="text-2xl sm:text-3xl font-black text-slate-100 tracking-tighter italic">
        WTN
      </span>
      <span className="text-2xl sm:text-3xl font-black bg-gradient-to-r from-cyan-400 via-sky-300 to-blue-400 bg-clip-text text-transparent transform -skew-x-6 italic">
        ALGO
      </span>
      <div className="not-italic ml-0.5">
        <CandlestickTradingWord textSize="text-xs sm:text-sm" candleSize={15} />
      </div>
    </div>
  );
}

// ============================================================================
// VARIANTE 6: NEO-QUANT CANDLESTICK (Terminal con pulso)
// ============================================================================
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
        <span className="text-xl sm:text-2xl font-light text-slate-300 mx-0.5">
          -
        </span>
        <CandlestickTradingWord textSize="text-lg sm:text-xl" candleSize={17} />
      </div>
      <span className="inline-block w-2 h-2 rounded-full bg-emerald-400 shadow-md shadow-emerald-400 animate-pulse ml-0.5" />
    </div>
  );
}

// CATÁLOGO COMPLETO DE OPCIONES PARA EL MODAL SELECTOR
export const LOGO_OPTIONS = [
  {
    id: 'velocity-apex',
    name: 'Opción 1: Velocity Candlestick (Recomendada)',
    subtitle: 'Velas Verdes Japonesas en I y N + Insignia Aero',
    Component: WordmarkCandlestickApex,
    desc: 'La letra I es una vela alcista japonesa verde sólida con mechas superior e inferior, y la N está formada por dos velas verdes consecutivas en breakout.'
  },
  {
    id: 'velocity-cyber',
    name: 'Opción 2: Cyber Slash Candlestick',
    subtitle: 'Estilo Fintech con Velas Verdes y Separador',
    Component: WordmarkVelocityCyberSlash,
    desc: 'Doble barra inclinada en cian eléctrico con la palabra TRADING integrando las velas alcistas verdes en I y N.'
  },
  {
    id: 'velocity-laser',
    name: 'Opción 3: Laser Horizon Candlestick',
    subtitle: 'Estilo Bloomberg Terminal con Estela Continua',
    Component: WordmarkVelocityLaser,
    desc: 'Tipografía fluida con velas japonesas en I y N, subrayadas por una estela láser de ejecución continua.'
  },
  {
    id: 'velocity-monolith',
    name: 'Opción 4: Monolith Capsule Candlestick',
    subtitle: 'Cápsula de Carbono con Velas y LED Verde',
    Component: WordmarkVelocityMonolith,
    desc: 'Cápsula integrada con borde reflectivo cian, insignia de estado LED esmeralda y velas verdes en I y N.'
  },
  {
    id: 'velocity-titanium',
    name: 'Opción 5: Pure Titanium Candlestick',
    subtitle: 'Minimalismo Oblicuo Puro Institucional',
    Component: WordmarkVelocityTitanium,
    desc: 'Pureza tipográfica oblicua con velas verdes alcistas discretas de alta precisión institucional.'
  },
  {
    id: 'neoquant',
    name: 'Opción 6: Neo-Quant Candlestick',
    subtitle: 'Estilo Terminal Monoespaciada',
    Component: WordmarkNeoQuant,
    desc: 'Tipografía de terminal algorítmica con velas verdes en TRADING y pulso esmeralda activo.'
  }
];
