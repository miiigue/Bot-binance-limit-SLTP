import React from 'react';

/**
 * LOGOTIPOS TIPOGRÁFICOS (WORDMARKS) PARA WTN ALGO-TRADING
 * Diseñados según los estándares institucionales de firmas globales de trading (Citadel, Two Sigma, Jane Street, Jump Trading).
 * Inspirados principalmente en la estética 'Velocity Breakout' (Opción 4):
 * Tipografía en cursiva aerodinámica, contrastes extremos, gradientes cian-eléctricos y precisión micro-vectorial.
 */

// ============================================================================
// VARIANTE 4.1: VELOCITY APEX (Cursiva aerodinámica con vector ascendente)
// ============================================================================
export function WordmarkVelocityApex({ className = "" }) {
  return (
    <div className={`inline-flex items-center gap-1.5 select-none italic font-black ${className}`}>
      <span className="text-2xl sm:text-3xl text-white tracking-tighter">
        WTN
      </span>
      <span className="text-2xl sm:text-3xl bg-gradient-to-r from-cyan-400 via-sky-300 to-blue-500 bg-clip-text text-transparent transform -skew-x-6">
        ALGO
      </span>
      <div className="not-italic flex items-center gap-1 bg-gradient-to-r from-cyan-950/90 to-blue-950/80 border border-cyan-400/50 px-2 py-0.5 rounded-lg shadow-sm shadow-cyan-500/20 ml-1">
        <span className="text-[11px] font-sans font-black text-cyan-200 tracking-wider">
          TRADING
        </span>
        <span className="text-[9px] text-emerald-400 font-mono font-bold animate-pulse">
          ▲
        </span>
      </div>
    </div>
  );
}

// ============================================================================
// VARIANTE 4.2: VELOCITY CYBER SLASH (Cursiva de alta frecuencia con separador cuántico)
// ============================================================================
export function WordmarkVelocityCyberSlash({ className = "" }) {
  return (
    <div className={`inline-flex items-center gap-1.5 select-none italic font-black ${className}`}>
      <span className="text-2xl sm:text-3xl text-white tracking-tight drop-shadow-sm">
        WTN
      </span>
      <span className="not-italic text-xl text-cyan-400 font-mono font-light select-none transform -skew-x-12 opacity-80">
        //
      </span>
      <span className="text-2xl sm:text-3xl bg-gradient-to-r from-cyan-300 via-sky-200 to-blue-400 bg-clip-text text-transparent transform -skew-x-6">
        ALGO
      </span>
      <span className="text-lg sm:text-xl text-cyan-300 not-italic font-sans font-bold tracking-normal ml-0.5">
        TRADING
      </span>
      <span className="inline-block w-1.5 h-1.5 rounded-full bg-cyan-400 shadow-md shadow-cyan-400 animate-ping ml-1" />
    </div>
  );
}

// ============================================================================
// VARIANTE 4.3: VELOCITY LASER HORIZON (Cursiva con estela láser de baja latencia)
// ============================================================================
export function WordmarkVelocityLaser({ className = "" }) {
  return (
    <div className={`inline-flex flex-col select-none ${className}`}>
      <div className="inline-flex items-center gap-1.5 italic font-black">
        <span className="text-2xl sm:text-3xl text-white tracking-tighter">
          WTN
        </span>
        <span className="text-2xl sm:text-3xl bg-gradient-to-r from-cyan-400 to-sky-300 bg-clip-text text-transparent">
          ALGO-TRADING
        </span>
      </div>
      {/* Estela láser de ejecución continua */}
      <div className="h-[2px] w-full bg-gradient-to-r from-cyan-400 via-blue-500 to-transparent rounded-full mt-0.5" />
    </div>
  );
}

// ============================================================================
// VARIANTE 4.4: VELOCITY MONOLITH CAPSULE (Cápsula de carbono con LED activo)
// ============================================================================
export function WordmarkVelocityMonolith({ className = "" }) {
  return (
    <div className={`inline-flex items-center gap-2 px-3 py-1.5 rounded-xl bg-slate-900/90 border border-cyan-500/30 shadow-inner select-none italic font-black ${className}`}>
      <span className="text-xl sm:text-2xl text-white tracking-tight">
        WTN
      </span>
      <div className="h-4 w-[1px] bg-cyan-500/40 not-italic" />
      <span className="text-xl sm:text-2xl bg-gradient-to-r from-cyan-400 to-sky-300 bg-clip-text text-transparent transform -skew-x-3">
        ALGO
      </span>
      <span className="not-italic text-xs font-mono font-bold px-1.5 py-0.5 rounded bg-cyan-950/80 border border-cyan-400/40 text-cyan-200">
        TRADING
      </span>
      <span className="inline-block w-2 h-2 rounded-full bg-emerald-400 shadow-sm shadow-emerald-400 animate-pulse ml-0.5 not-italic" />
    </div>
  );
}

// ============================================================================
// VARIANTE 4.5: VELOCITY PURE TITANIUM (Minimalismo oblicuo puro institucional)
// ============================================================================
export function WordmarkVelocityTitanium({ className = "" }) {
  return (
    <div className={`inline-flex items-baseline gap-2 select-none italic ${className}`}>
      <span className="text-2xl sm:text-3xl font-black text-slate-100 tracking-tighter">
        WTN
      </span>
      <span className="text-2xl sm:text-3xl font-black bg-gradient-to-r from-cyan-400 via-sky-300 to-blue-400 bg-clip-text text-transparent transform -skew-x-6">
        ALGO
      </span>
      <span className="not-italic text-xs sm:text-sm font-sans font-extrabold text-cyan-300 uppercase tracking-widest ml-0.5">
        TRADING
      </span>
    </div>
  );
}

// ============================================================================
// ESTILOS ANTERIORES PARA REFERENCIA Y SELECCIÓN TOTAL
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

// CATÁLOGO COMPLETO DE OPCIONES PARA EL MODAL SELECTOR
export const LOGO_OPTIONS = [
  {
    id: 'velocity-apex',
    name: 'Opción 4A: Velocity Apex (Recomendada)',
    subtitle: 'Estilo Jane Street / Jump Trading con Vector Ascendente',
    Component: WordmarkVelocityApex,
    desc: 'Tipografía cursiva de alta frecuencia con inclinación aerodinámica, micro-badge TRADING y vector dinámico de breakout cuántico.'
  },
  {
    id: 'velocity-cyber',
    name: 'Opción 4B: Velocity Cyber Slash',
    subtitle: 'Estilo Fintech de Ultra Baja Latencia',
    Component: WordmarkVelocityCyberSlash,
    desc: 'Doble barra cuántica inclinada en cian eléctrico con ping de red activa y contraste radical sobre fondo oscuro.'
  },
  {
    id: 'velocity-laser',
    name: 'Opción 4C: Velocity Laser Horizon',
    subtitle: 'Estilo Bloomberg Terminal / Cuántico Continuo',
    Component: WordmarkVelocityLaser,
    desc: 'Cursiva fluida con estela láser inferior degradada que simboliza flujo perpetuo de liquidez y ejecución instantánea.'
  },
  {
    id: 'velocity-titanium',
    name: 'Opción 4D: Velocity Pure Titanium',
    subtitle: 'Estilo Institucional Minimalista Aerodinámico',
    Component: WordmarkVelocityTitanium,
    desc: 'Sin cajas ni marcos: pureza tipográfica inclinada con acabado plata titanio y TRADING en espaciado amplio.'
  },
  {
    id: 'velocity-monolith',
    name: 'Opción 4E: Velocity Monolith Capsule',
    subtitle: 'Estilo Citadel Micro-Cápsula con LED Activo',
    Component: WordmarkVelocityMonolith,
    desc: 'Cápsula integrada con borde reflectivo cian, insignia de estado LED esmeralda y tipografía de máxima potencia.'
  },
  {
    id: 'neoquant',
    name: 'Opción 1: Neo-Quant Pro',
    subtitle: 'Estilo Monospace Clásico / Terminal',
    Component: WordmarkNeoQuant,
    desc: 'Tipografía monoespaciada estructurada con pulso cuántico central.'
  }
];
