import React from 'react';

/**
 * LOGOTIPOS TIPOGRÁFICOS (WORDMARKS) PARA WTN ALGO-TRADING
 * Diseñados según los estándares institucionales de firmas globales de trading.
 * Responsive fluido: escala matemáticamente en teléfonos móviles sin romperse ni desbordarse.
 * Mantiene la palabra TRADING en el mismo estilo, tamaño y color, con velas japonesas alcistas verdes.
 */

// ============================================================================
// MICRO-COMPONENTES SVG: VELAS ALCISTAS VERDES (CANDLESTICKS) PARA 'I' Y 'N'
// Escalan automáticamente con unidades em para adaptarse al tamaño de fuente exacto
// ============================================================================

/**
 * CandlestickLetterI: Vela japonesa verde sólida con mecha superior e inferior
 */
export function CandlestickLetterI({ size, className = "" }) {
  return (
    <svg
      viewBox="0 0 10 24"
      style={size ? { height: `${size}px`, width: `${Math.round(size * 0.42)}px` } : undefined}
      className={`inline-block align-middle mx-[0.5px] shrink-0 ${
        size ? '' : 'h-[1.12em] w-[0.46em]'
      } drop-shadow-[0_0_6px_rgba(16,185,129,0.7)] ${className}`}
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
export function CandlestickLetterN({ size, className = "" }) {
  return (
    <svg
      viewBox="0 0 20 24"
      style={size ? { height: `${size}px`, width: `${Math.round(size * 0.83)}px` } : undefined}
      className={`inline-block align-middle mx-[0.5px] shrink-0 ${
        size ? '' : 'h-[1.12em] w-[0.92em]'
      } drop-shadow-[0_0_6px_rgba(16,185,129,0.7)] ${className}`}
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
    <div className={`inline-flex items-center gap-1 sm:gap-1.5 select-none font-black text-sm xs:text-base sm:text-2xl md:text-3xl tracking-tighter whitespace-nowrap leading-none ${className}`}>
      <span className="text-white italic shrink-0">
        WTN
      </span>
      <span className="bg-gradient-to-r from-cyan-400 via-sky-300 to-blue-500 bg-clip-text text-transparent transform -skew-x-6 italic inline-flex items-center leading-none">
        <span>ALGO-TRAD</span>
        <CandlestickLetterI className="not-italic" />
        <CandlestickLetterN className="not-italic" />
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
    <div className={`inline-flex items-center gap-1 sm:gap-1.5 select-none font-black text-sm xs:text-base sm:text-2xl md:text-3xl tracking-tighter whitespace-nowrap leading-none ${className}`}>
      <span className="text-white italic shrink-0">
        WTN
      </span>
      <span className="text-white transform -skew-x-6 italic inline-flex items-center leading-none">
        <span>ALGO-TRAD</span>
        <CandlestickLetterI className="not-italic" />
        <CandlestickLetterN className="not-italic" />
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
    <div className={`inline-flex items-center gap-1 sm:gap-1.5 select-none font-black text-sm xs:text-base sm:text-2xl md:text-3xl tracking-tight whitespace-nowrap leading-none ${className}`}>
      <span className="text-white italic shrink-0">
        WTN
      </span>
      <span className="not-italic text-xs sm:text-xl text-cyan-400 font-mono font-light select-none transform -skew-x-12 opacity-80 shrink-0">
        //
      </span>
      <span className="bg-gradient-to-r from-cyan-300 via-sky-200 to-blue-400 bg-clip-text text-transparent transform -skew-x-6 italic inline-flex items-center leading-none">
        <span>ALGO TRAD</span>
        <CandlestickLetterI className="not-italic" />
        <CandlestickLetterN className="not-italic" />
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
    <div className={`inline-flex flex-col select-none whitespace-nowrap leading-none ${className}`}>
      <div className="inline-flex items-center gap-1 sm:gap-1.5 font-black text-sm xs:text-base sm:text-2xl md:text-3xl tracking-tighter">
        <span className="text-white italic shrink-0">
          WTN
        </span>
        <span className="bg-gradient-to-r from-cyan-400 to-sky-300 bg-clip-text text-transparent italic inline-flex items-center leading-none">
          <span>ALGO-TRAD</span>
          <CandlestickLetterI className="not-italic" />
          <CandlestickLetterN className="not-italic" />
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
    <div className={`inline-flex items-center gap-1.5 sm:gap-2 px-2.5 sm:px-3 py-1 sm:py-1.5 rounded-xl bg-slate-900/90 border border-cyan-500/30 shadow-inner select-none font-black text-xs xs:text-sm sm:text-xl md:text-2xl whitespace-nowrap leading-none ${className}`}>
      <span className="text-white tracking-tight italic shrink-0">
        WTN
      </span>
      <div className="h-3 sm:h-4 w-[1px] bg-cyan-500/40 not-italic shrink-0" />
      <span className="bg-gradient-to-r from-cyan-400 to-sky-300 bg-clip-text text-transparent transform -skew-x-3 italic inline-flex items-center leading-none">
        <span>ALGO-TRAD</span>
        <CandlestickLetterI className="not-italic" />
        <CandlestickLetterN className="not-italic" />
        <span>G</span>
      </span>
      <span className="inline-block w-1.5 h-1.5 sm:w-2 sm:h-2 rounded-full bg-emerald-400 shadow-sm shadow-emerald-400 animate-pulse ml-0.5 not-italic shrink-0" />
    </div>
  );
}

// ============================================================================
// VARIANTE 6: NEO-QUANT CANDLESTICK (Terminal con pulso)
// ============================================================================
export function WordmarkNeoQuant({ className = "" }) {
  return (
    <div className={`inline-flex items-center gap-1 sm:gap-2 select-none text-xs xs:text-sm sm:text-2xl md:text-3xl font-black font-mono tracking-tighter whitespace-nowrap leading-none ${className}`}>
      <span className="text-white shrink-0">
        WTN
      </span>
      <span className="ml-0.5 sm:ml-1 bg-gradient-to-r from-cyan-400 via-sky-300 to-blue-500 bg-clip-text text-transparent inline-flex items-center leading-none">
        <span>ALGO-TRAD</span>
        <CandlestickLetterI className="not-italic" />
        <CandlestickLetterN className="not-italic" />
        <span>G</span>
      </span>
      <span className="inline-block w-1.5 h-1.5 sm:w-2 sm:h-2 rounded-full bg-emerald-400 shadow-md shadow-emerald-400 animate-pulse ml-0.5 shrink-0" />
    </div>
  );
}

export const WordmarkVelocityTitanium = WordmarkPureWhiteCandlestick;

// ============================================================================
// CATÁLOGO COMPLETO DE OPCIONES PARA LA GALERÍA PROFESIONAL DE IDENTIDAD
// Incluye especificaciones de tamaños para Desktop, Móvil, Favicon y Casos de Uso
// ============================================================================
export const LOGO_OPTIONS = [
  {
    id: 'velocity-apex',
    name: 'Opción 1: Velocity Candlestick (Flagship)',
    subtitle: 'Gradiente Cian-Zafiro con Velas Esmeralda Integradas',
    Component: WordmarkVelocityApex,
    desc: 'La palabra TRADING tiene exactamente el mismo tamaño, tipografía y gradiente que ALGO, integrando las velas alcistas en I y N de manera fluida y matemática.',
    sizes: {
      desktop: 'Grande (32px / 2.0rem) — Cabecera Web & Pantallas 4K',
      tablet: 'Mediano (24px / 1.5rem) — Tablet & Laptop',
      mobile: 'Móvil (16px / 1.0rem) — Smartphones & PWA',
      favicon: 'Token (14px) — Favicon & App Icon'
    },
    useCases: ['Cabecera Web Principal', 'App Móvil iOS/Android', 'Informes Financieros PDF', 'Prensa y Medios'],
    colors: ['#FFFFFF', '#22D3EE', '#38BDF8', '#3B82F6', '#10B981']
  },
  {
    id: 'velocity-white',
    name: 'Opción 2: Pure White Candlestick',
    subtitle: 'Blanco Platino Uniforme con Velas Esmeralda',
    Component: WordmarkPureWhiteCandlestick,
    desc: 'Todo el nombre en tipografía blanca pura de máxima legibilidad institucional, donde únicamente destacan las dos velas verdes alcistas.',
    sizes: {
      desktop: 'Grande (32px / 2.0rem) — Fondos Oscuros de Alto Contraste',
      tablet: 'Mediano (24px / 1.5rem) — Dashboards Institucionales',
      mobile: 'Móvil (16px / 1.0rem) — Pantallas OLED',
      favicon: 'Token (14px) — Documentos Ejecutivos'
    },
    useCases: ['Fondos Ultra-Dark', 'Dossier de Inversores', 'Tarjetas Ejecutivas', 'Presentaciones Institucionales'],
    colors: ['#FFFFFF', '#10B981', '#34D399']
  },
  {
    id: 'velocity-cyber',
    name: 'Opción 3: Cyber Slash Candlestick',
    subtitle: 'Estilo Fintech con Separador Cuántico // y Velas',
    Component: WordmarkVelocityCyberSlash,
    desc: 'Separador técnico // con tipografía continua de gran impacto y velas en I y N que evocan terminales de alta frecuencia.',
    sizes: {
      desktop: 'Grande (32px / 2.0rem) — Interfaces de Trading en Tiempo Real',
      tablet: 'Mediano (24px / 1.5rem) — Monitores Financieros',
      mobile: 'Móvil (16px / 1.0rem) — Widgets de Estado',
      favicon: 'Token (14px) — Notificaciones Push'
    },
    useCases: ['Terminales de Trading', 'Gráficos en Vivo', 'Canales de Telegram/Discord', 'Comunidad de Traders'],
    colors: ['#FFFFFF', '#22D3EE', '#38BDF8', '#10B981']
  },
  {
    id: 'velocity-laser',
    name: 'Opción 4: Laser Horizon Candlestick',
    subtitle: 'Estilo Bloomberg Terminal con Estela Láser Continua',
    Component: WordmarkVelocityLaser,
    desc: 'Tipografía fluida en una sola línea continua subrayada por una estela láser de baja latencia con gradiente esmeralda.',
    sizes: {
      desktop: 'Grande (32px / 2.0rem) — Pantalla Completa & Hero Banners',
      tablet: 'Mediano (24px / 1.5rem) — Módulos de Rendimiento',
      mobile: 'Móvil (16px / 1.0rem) — Banners Promocionales',
      favicon: 'Token (14px) — Firmas de Correo Corporativas'
    },
    useCases: ['Hero Banners', 'Stands y Eventos Fintech', 'Publicidad Digital', 'Firmas Oficiales'],
    colors: ['#FFFFFF', '#22D3EE', '#34D399', '#10B981']
  },
  {
    id: 'velocity-monolith',
    name: 'Opción 5: Monolith Capsule Candlestick',
    subtitle: 'Cápsula Integrada con Borde Reflectivo y LED Activo',
    Component: WordmarkVelocityMonolith,
    desc: 'Cápsula institucional con borde reflectivo, separador vertical y pulso LED verde que indica ejecución en vivo 24/7.',
    sizes: {
      desktop: 'Grande (28px / 1.75rem) — Cabeceras Flotantes',
      tablet: 'Mediano (20px / 1.25rem) — Barras de Navegación fijas',
      mobile: 'Móvil (14px / 0.9rem) — Menús compactos',
      favicon: 'Token (12px) — Badges de Seguridad'
    },
    useCases: ['Cabecera Flotante Fija', 'Insignia de Confianza', 'Footers de Contratos', 'Sello de Software'],
    colors: ['#0F172A', '#FFFFFF', '#22D3EE', '#10B981']
  },
  {
    id: 'neoquant',
    name: 'Opción 6: Neo-Quant Candlestick',
    subtitle: 'Estilo Terminal Monoespaciada con Pulso Algorítmico',
    Component: WordmarkNeoQuant,
    desc: 'Tipografía monoespaciada de código fuente con velas verdes en TRADING y pulso esmeralda activo.',
    sizes: {
      desktop: 'Grande (32px / 2.0rem) — Consolas de API y Desarrolladores',
      tablet: 'Mediano (24px / 1.5rem) — Registros y Logs en Vivo',
      mobile: 'Móvil (16px / 1.0rem) — Dashboards Técnicos',
      favicon: 'Token (14px) — Documentación API'
    },
    useCases: ['Consolas de Código / API', 'Paneles de Desarrollador', 'Documentación Técnica', 'Informes de Auditoría'],
    colors: ['#FFFFFF', '#22D3EE', '#3B82F6', '#10B981']
  }
];
