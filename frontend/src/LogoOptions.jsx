import React from 'react';

/**
 * LOGOS DE ÚLTIMA GENERACIÓN PARA WTN ALGO-TRADING
 * 4 Opciones de diseño vectorial SVG de alto nivel institucional con gradientes cian y azul eléctrico.
 */

// OPCIÓN 1: NEXUS HEXAGONAL CUÁNTICO (Geometría Institucional de Precisión)
export function LogoHexNexus({ className = "w-10 h-10", size = 44 }) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 100 100"
      fill="none"
      xmlns="http://www.w3.org/2000/svg"
      className={className}
    >
      <defs>
        <linearGradient id="hexGrad" x1="0%" y1="0%" x2="100%" y2="100%">
          <stop offset="0%" stopColor="#00f0ff" />
          <stop offset="50%" stopColor="#38bdf8" />
          <stop offset="100%" stopColor="#2563eb" />
        </linearGradient>
        <linearGradient id="coreGrad" x1="0%" y1="100%" x2="100%" y2="0%">
          <stop offset="0%" stopColor="#1e3a8a" />
          <stop offset="100%" stopColor="#00f0ff" />
        </linearGradient>
        <filter id="neonGlowHex" x="-20%" y="-20%" width="140%" height="140%">
          <feGaussianBlur stdDeviation="3" result="blur" />
          <feComposite in="SourceGraphic" in2="blur" operator="over" />
        </filter>
      </defs>

      {/* Hexágono Exterior */}
      <polygon
        points="50,6 88,28 88,72 50,94 12,72 12,28"
        stroke="url(#hexGrad)"
        strokeWidth="3.5"
        fill="rgba(2, 6, 23, 0.7)"
        filter="url(#neonGlowHex)"
      />

      {/* Triángulos Internos de Flujo Cuantitativo (3 Marcos Temporales) */}
      <polygon points="50,18 78,70 22,70" stroke="#38bdf8" strokeWidth="1.8" strokeOpacity="0.6" fill="none" />
      <polygon points="50,82 22,30 78,30" stroke="#00f0ff" strokeWidth="1.8" strokeOpacity="0.4" fill="none" />

      {/* Núcleo Central de Algoritmo */}
      <circle cx="50" cy="50" r="8" fill="url(#coreGrad)" />
      <circle cx="50" cy="50" r="3.5" fill="#ffffff" filter="url(#neonGlowHex)" />

      {/* Rayo de Ejecución Instantánea */}
      <path d="M48 24 L56 46 L44 54 L52 76" stroke="#00f0ff" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

// OPCIÓN 2: DELTA VECTORIAL / HYPER-RAY (Velocidad de Ejecución & Crecimiento)
export function LogoDeltaRay({ className = "w-10 h-10", size = 44 }) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 100 100"
      fill="none"
      xmlns="http://www.w3.org/2000/svg"
      className={className}
    >
      <defs>
        <linearGradient id="deltaGrad1" x1="0%" y1="0%" x2="100%" y2="100%">
          <stop offset="0%" stopColor="#00f0ff" />
          <stop offset="100%" stopColor="#1d4ed8" />
        </linearGradient>
        <linearGradient id="deltaGrad2" x1="100%" y1="0%" x2="0%" y2="100%">
          <stop offset="0%" stopColor="#60a5fa" />
          <stop offset="100%" stopColor="#0284c7" />
        </linearGradient>
      </defs>

      {/* Prisma 3D Faceta Izquierda */}
      <polygon points="50,8 14,84 50,68" fill="url(#deltaGrad1)" fillOpacity="0.85" />
      
      {/* Prisma 3D Faceta Derecha */}
      <polygon points="50,8 86,84 50,68" fill="url(#deltaGrad2)" fillOpacity="0.95" />

      {/* Líneas de Escaneo Algorítmico */}
      <line x1="30" y1="52" x2="70" y2="52" stroke="#00f0ff" strokeWidth="2" strokeOpacity="0.8" />
      <line x1="38" y1="36" x2="62" y2="36" stroke="#ffffff" strokeWidth="2" strokeOpacity="0.9" />

      {/* Vértice Superior Pulsante */}
      <circle cx="50" cy="8" r="4.5" fill="#00f0ff" />
      <circle cx="50" cy="8" r="2" fill="#ffffff" />
    </svg>
  );
}

// OPCIÓN 3: DUAL ORBIT MATRIX (Representa Fondo Mancomunado + Copy-Trading)
export function LogoDualOrbit({ className = "w-10 h-10", size = 44 }) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 100 100"
      fill="none"
      xmlns="http://www.w3.org/2000/svg"
      className={className}
    >
      <defs>
        <linearGradient id="orbitGradA" x1="0%" y1="0%" x2="100%" y2="100%">
          <stop offset="0%" stopColor="#00f0ff" />
          <stop offset="100%" stopColor="#3b82f6" />
        </linearGradient>
        <linearGradient id="orbitGradB" x1="100%" y1="0%" x2="0%" y2="100%">
          <stop offset="0%" stopColor="#38bdf8" />
          <stop offset="100%" stopColor="#1e40af" />
        </linearGradient>
      </defs>

      {/* Órbita 1: Fondo Mancomunado */}
      <ellipse
        cx="50"
        cy="50"
        rx="40"
        ry="18"
        transform="rotate(-28 50 50)"
        stroke="url(#orbitGradA)"
        strokeWidth="3"
        strokeDasharray="6 3"
        fill="none"
      />

      {/* Órbita 2: Copy-Trading Soberano */}
      <ellipse
        cx="50"
        cy="50"
        rx="40"
        ry="18"
        transform="rotate(28 50 50)"
        stroke="url(#orbitGradB)"
        strokeWidth="3"
        fill="none"
      />

      {/* Esfera Central de Liquidez */}
      <circle cx="50" cy="50" r="14" fill="#0b1736" stroke="#00f0ff" strokeWidth="2" />
      <circle cx="50" cy="50" r="6" fill="#38bdf8" />
      <circle cx="50" cy="50" r="2.5" fill="#ffffff" />

      {/* Nodos Satélite en Órbitas */}
      <circle cx="78" cy="36" r="3.5" fill="#00f0ff" />
      <circle cx="22" cy="36" r="3.5" fill="#38bdf8" />
    </svg>
  );
}

// OPCIÓN 4: MONOGRAMA CYBER 'WTN' QUANT (Tipografía Angular de Alta Finanza)
export function LogoCyberWTN({ className = "w-10 h-10", size = 44 }) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 100 100"
      fill="none"
      xmlns="http://www.w3.org/2000/svg"
      className={className}
    >
      <defs>
        <linearGradient id="wtnGrad" x1="0%" y1="0%" x2="100%" y2="100%">
          <stop offset="0%" stopColor="#00f0ff" />
          <stop offset="50%" stopColor="#38bdf8" />
          <stop offset="100%" stopColor="#2563eb" />
        </linearGradient>
      </defs>

      {/* Marco de Terminal Cuántico */}
      <rect x="10" y="10" width="80" height="80" rx="18" stroke="url(#wtnGrad)" strokeWidth="2.5" fill="rgba(6, 13, 31, 0.85)" />

      {/* Letra W Estilizada como Ondas de Velas */}
      <path
        d="M26 36 L34 66 L44 46 L54 66 L62 36"
        stroke="url(#wtnGrad)"
        strokeWidth="4"
        strokeLinecap="round"
        strokeLinejoin="round"
      />

      {/* Flecha de Ruptura Alcista T */}
      <path d="M72 32 L82 32 L82 42" stroke="#00f0ff" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round" />
      <line x1="64" y1="50" x2="82" y2="32" stroke="#00f0ff" strokeWidth="2.5" strokeLinecap="round" />
    </svg>
  );
}

export const LOGO_OPTIONS = [
  {
    id: 'hex',
    name: 'Opción 1: Nexus Hexagonal Cuántico',
    subtitle: 'Recomendada • Precisión Matemática y 3 Marcos Temporales',
    Component: LogoHexNexus,
    desc: 'Hexágono geométrico con núcleo central de alta frecuencia y rayo de ejecución. Proyecta solidez institucional y rigor matemático.'
  },
  {
    id: 'delta',
    name: 'Opción 2: Delta Vectorial Hyper-Ray',
    subtitle: 'Velocidad de Ejecución y Rentabilidad Creciente',
    Component: LogoDeltaRay,
    desc: 'Prisma 3D en forma de delta con facetas en azul y cian. Simboliza aceleración algorítmica y avance continuo.'
  },
  {
    id: 'orbit',
    name: 'Opción 3: Dual Orbit Matrix',
    subtitle: 'Simbiosis: Fondo de Inversión + Copy-Trading',
    Component: LogoDualOrbit,
    desc: 'Dos anillos orbitales entrelazados alrededor del núcleo de liquidez. Representa la dualidad de los dos productos de inversión.'
  },
  {
    id: 'wtn',
    name: 'Opción 4: Monograma Cyber WTN',
    subtitle: 'Terminal Cuántica & Breakout Financiero',
    Component: LogoCyberWTN,
    desc: 'Monograma W estilizado como gráfico de mercado en expansión alcista dentro de un marco de terminal de derivados.'
  }
];
