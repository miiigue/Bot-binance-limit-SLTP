import React, { useState, useEffect } from 'react';
import Trading3DScene from './Trading3DScene';
import EquityCurvesShowcase from './EquityCurvesShowcase';
import { WordmarkVelocityApex } from './LogoOptions';

/**
 * Tilt3DCard
 * Tarjeta interactiva 3D con perspectiva física y resplandor dinámico al mover el cursor.
 */
function Tilt3DCard({ children, className = '' }) {
  const cardRef = useRef(null);
  const [transformStyle, setTransformStyle] = useState('');
  const [glareStyle, setGlareStyle] = useState({ opacity: 0, x: '50%', y: '50%' });

  const handleMouseMove = (e) => {
    const card = cardRef.current;
    if (!card) return;
    const rect = card.getBoundingClientRect();
    const x = e.clientX - rect.left;
    const y = e.clientY - rect.top;
    const centerX = rect.width / 2;
    const centerY = rect.height / 2;

    const rotateX = ((y - centerY) / centerY) * -9;
    const rotateY = ((x - centerX) / centerX) * 9;

    setTransformStyle(`perspective(1000px) rotateX(${rotateX.toFixed(2)}deg) rotateY(${rotateY.toFixed(2)}deg) scale3d(1.02, 1.02, 1.02)`);
    setGlareStyle({
      opacity: 1,
      x: `${(x / rect.width) * 100}%`,
      y: `${(y / rect.height) * 100}%`,
    });
  };

  const handleMouseLeave = () => {
    setTransformStyle('perspective(1000px) rotateX(0deg) rotateY(0deg) scale3d(1, 1, 1)');
    setGlareStyle((prev) => ({ ...prev, opacity: 0 }));
  };

  return (
    <div
      ref={cardRef}
      onMouseMove={handleMouseMove}
      onMouseLeave={handleMouseLeave}
      style={{
        transform: transformStyle,
        transition: 'transform 0.18s cubic-bezier(0.2, 0, 0, 1), box-shadow 0.2s ease',
        transformStyle: 'preserve-3d',
      }}
      className={`relative rounded-3xl overflow-hidden transition-all duration-300 ${className}`}
    >
      <div
        className="pointer-events-none absolute inset-0 z-10 transition-opacity duration-300"
        style={{
          opacity: glareStyle.opacity,
          background: `radial-gradient(circle 260px at ${glareStyle.x} ${glareStyle.y}, rgba(0, 240, 255, 0.14), transparent 70%)`,
        }}
      />
      {children}
    </div>
  );
}

export default function LandingPage({ onOpenLogin, onOpenRegister }) {
  // Estado para el botón flotante "Volver Arriba"
  const [showScrollTop, setShowScrollTop] = useState(false);

  useEffect(() => {
    const handleScroll = () => {
      if (window.scrollY > 300) {
        setShowScrollTop(true);
      } else {
        setShowScrollTop(false);
      }
    };
    window.addEventListener('scroll', handleScroll, { passive: true });
    return () => window.removeEventListener('scroll', handleScroll);
  }, []);

  const scrollToTop = () => {
    window.scrollTo({ top: 0, behavior: 'smooth' });
  };

  // Simulador interactivo de inversión
  const [simCapital, setSimCapital] = useState(5000);
  const [simProfile, setSimProfile] = useState('v21');

  // Parámetros dinámicos del simulador
  const profileMultipliers = {
    conservative: {
      label: 'Conservador (Preservación)',
      leverage: '3x - 5x',
      minPct: 5,
      maxPct: 9,
      drawdown: '< 4.5%',
      pairs: 6,
    },
    v21: {
      label: 'V21 Alpha (Estándar)',
      leverage: '5x - 7x',
      minPct: 8,
      maxPct: 16,
      drawdown: '< 7.5%',
      pairs: 10,
    },
    aggressive: {
      label: 'Rendimiento Agresivo',
      leverage: '7x - 10x',
      minPct: 15,
      maxPct: 28,
      drawdown: '< 12%',
      pairs: 12,
    },
  };

  const sim = profileMultipliers[simProfile];
  const estMin = Math.round(simCapital * (sim.minPct / 100));
  const estMax = Math.round(simCapital * (sim.maxPct / 100));

  // Datos financieros estilo Bolsa de Valores (Wall Street / Bloomberg Ticker Tape)
  const exchangeTape = [
    { symbol: 'BTC/USDT', price: '68,485.20', change: '+3.42%', isUp: true, high: '69,120.00', low: '66,190.50', vol: '$1.84B' },
    { symbol: 'ETH/USDT', price: '2,648.75', change: '+2.88%', isUp: true, high: '2,680.10', low: '2,560.00', vol: '$920M' },
    { symbol: 'SOL/USDT', price: '185.10', change: '+6.74%', isUp: true, high: '187.50', low: '172.30', vol: '$640M' },
    { symbol: 'BNB/USDT', price: '594.30', change: '+1.92%', isUp: true, high: '598.00', low: '582.40', vol: '$210M' },
    { symbol: 'XRP/USDT', price: '0.5512', change: '+4.20%', isUp: true, high: '0.5590', low: '0.5280', vol: '$185M' },
    { symbol: 'AVAX/USDT', price: '29.15', change: '+5.60%', isUp: true, high: '29.80', low: '27.40', vol: '$140M' },
    { symbol: 'LINK/USDT', price: '12.65', change: '+3.85%', isUp: true, high: '12.90', low: '12.10', vol: '$98M' },
  ];

  return (
    <div className="min-h-screen bg-slate-950 text-slate-100 selection:bg-cyan-400 selection:text-slate-950 font-sans overflow-x-hidden">
      
      {/* =========================================================================
          1. HEADER / BARRA DE NAVEGACIÓN RESPONSIVE
         ========================================================================= */}
      <header className="fixed top-0 left-0 right-0 z-50 bg-slate-950/90 backdrop-blur-xl border-b border-cyan-500/20 shadow-lg shadow-cyan-950/30">
        <div className="max-w-7xl mx-auto px-2.5 sm:px-6 lg:px-8 h-16 sm:h-20 flex items-center justify-between gap-2">
          
          {/* LOGOTIPO TIPOGRÁFICO OFICIAL CON NOMBRE COMPLETO (ESCALA RESPONSIVE PARA MÓVILES) */}
          <div className="flex items-center shrink-0">
            <div className="text-left flex items-center select-none">
              <WordmarkVelocityApex />
            </div>
          </div>

          {/* BOTONES DE ACCIÓN: INICIAR SESIÓN / SOLICITAR INVERSIÓN */}
          <div className="flex items-center gap-1.5 sm:gap-3 shrink-0">
            <button
              type="button"
              onClick={() => onOpenLogin && onOpenLogin()}
              className="px-3 sm:px-4 py-1.5 sm:py-2 text-[11px] sm:text-xs font-bold text-slate-200 hover:text-white bg-slate-900 hover:bg-slate-800 border border-slate-700 hover:border-cyan-500/50 rounded-xl transition shadow-sm whitespace-nowrap"
            >
              Iniciar Sesión
            </button>

            <button
              type="button"
              onClick={() => onOpenRegister && onOpenRegister(simCapital)}
              className="px-2.5 sm:px-5 py-1.5 sm:py-2.5 text-[11px] sm:text-xs font-extrabold text-slate-950 bg-gradient-to-r from-cyan-400 via-sky-300 to-cyan-300 hover:from-cyan-300 hover:to-sky-200 rounded-xl shadow-lg shadow-cyan-500/25 transition hover:scale-105 active:scale-95 flex items-center gap-1 sm:gap-2 whitespace-nowrap"
            >
              <span className="hidden sm:inline">Solicitar </span><span>Inversión</span>
              <span>→</span>
            </button>
          </div>

        </div>
      </header>

      {/* =========================================================================
          2. HERO SECTION CON MOTOR 3D INTERACTIVO
         ========================================================================= */}
      <section className="relative min-h-[88vh] pt-28 pb-12 flex flex-col justify-center overflow-hidden">
        
        {/* ESCENA 3D DE FONDO */}
        <div className="absolute inset-0 z-0 opacity-80 sm:opacity-95">
          <Trading3DScene />
        </div>

        <div className="relative z-10 max-w-6xl mx-auto px-4 sm:px-6 lg:px-8 text-center flex flex-col items-center">
          
          {/* BADGE DE LANZAMIENTO INTERNACIONAL & BENEFICIOS EXCLUSIVOS */}
          <div className="inline-flex items-center gap-2 px-3 sm:px-4 py-1.5 rounded-full bg-gradient-to-r from-cyan-950/90 via-blue-950/80 to-slate-950/90 border border-cyan-400/50 text-cyan-300 text-[10px] sm:text-xs font-mono font-bold tracking-wide shadow-xl shadow-cyan-500/10 mb-6 backdrop-blur-md flex-wrap justify-center text-center max-w-full">
            <span className="w-2 h-2 sm:w-2.5 sm:h-2.5 rounded-full bg-cyan-400 animate-pulse flex-shrink-0" />
            <span>🌍 LANZAMIENTO INTERNACIONAL OFICIAL</span>
            <span className="hidden sm:inline text-slate-500">•</span>
            <span className="text-amber-300">BENEFICIOS PREFERENCIALES</span>
          </div>

          {/* TITULAR PRINCIPAL RESUMIDO Y DE IMPACTO */}
          <h1 className="text-3xl sm:text-5xl md:text-6xl lg:text-7xl font-black tracking-tight text-white max-w-4xl leading-[1.12] mb-5 px-2 break-words">
            TRADING{' '}
            <span className="bg-gradient-to-r from-cyan-400 via-sky-300 to-blue-500 bg-clip-text text-transparent">
              AUTOMÁTICO
            </span>
          </h1>

          <p className="text-sm sm:text-lg md:text-xl text-slate-300 max-w-2xl font-normal leading-relaxed mb-8 px-2">
            Ejecución matemática 24/7 sin sesgos emocionales. Algoritmos de alta precisión con gestión institucional.
          </p>

          {/* BOTONES DE LLAMADA A LA ACCIÓN */}
          <div className="flex flex-col sm:flex-row items-center gap-3.5 w-full sm:w-auto mb-10">
            <button
              type="button"
              onClick={() => onOpenRegister && onOpenRegister(simCapital)}
              className="w-full sm:w-auto px-8 py-3.5 bg-gradient-to-r from-cyan-400 via-sky-400 to-blue-500 hover:from-cyan-300 hover:to-blue-400 text-slate-950 font-black text-sm rounded-2xl shadow-xl shadow-cyan-500/30 transition hover:scale-105 active:scale-95 flex items-center justify-center gap-2"
            >
              <span>🚀 Acceder al Lanzamiento Internacional</span>
            </button>

            <button
              type="button"
              onClick={() => onOpenLogin && onOpenLogin()}
              className="w-full sm:w-auto px-7 py-3.5 bg-slate-900/90 hover:bg-slate-800 text-white font-bold text-sm rounded-2xl border border-slate-700 hover:border-cyan-400/60 shadow-lg transition hover:scale-105 active:scale-95 flex items-center justify-center gap-2 backdrop-blur-md"
            >
              <span>🔐 Iniciar Sesión</span>
            </button>
          </div>

          {/* MÉTRICAS CLAVE (3 CARDS VISUALES) */}
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-3 sm:gap-4 w-full max-w-2xl">
            <div className="p-3.5 rounded-2xl bg-slate-900/70 border border-slate-800 backdrop-blur-md text-center">
              <div className="text-2xl font-black text-sky-400 font-mono">&lt; 12ms</div>
              <div className="text-[11px] text-slate-400 font-semibold mt-0.5">Latencia de Ejecución</div>
            </div>
            <div className="p-3.5 rounded-2xl bg-slate-900/70 border border-slate-800 backdrop-blur-md text-center">
              <div className="text-2xl font-black text-emerald-400 font-mono">100%</div>
              <div className="text-[11px] text-slate-400 font-semibold mt-0.5">Autocustodia</div>
            </div>
            <div className="p-3.5 rounded-2xl bg-slate-900/70 border border-slate-800 backdrop-blur-md text-center">
              <div className="text-2xl font-black text-blue-400 font-mono">24/7</div>
              <div className="text-[11px] text-slate-400 font-semibold mt-0.5">Ejecución Activa</div>
            </div>
          </div>

        </div>

        {/* =========================================================================
            TICKER TAPE CONTINUO ESTILO BOLSA DE VALORES (WALL STREET / BLOOMBERG)
           ========================================================================= */}
        <div className="mt-10 w-full bg-slate-950/95 border-y border-cyan-500/30 overflow-hidden py-2.5 font-mono text-xs shadow-xl backdrop-blur-xl">
          <div className="flex gap-10 whitespace-nowrap animate-marquee">
            {[...exchangeTape, ...exchangeTape, ...exchangeTape, ...exchangeTape].map((t, idx) => (
              <div key={idx} className="inline-flex items-center gap-2.5 flex-shrink-0">
                <span className="font-black text-white">{t.symbol}</span>
                <span className="text-slate-200 font-bold">${t.price}</span>
                <span className={`font-bold flex items-center gap-0.5 ${t.isUp ? 'text-emerald-400' : 'text-rose-400'}`}>
                  {t.isUp ? '▲' : '▼'} {t.change}
                </span>
                <span className="text-slate-400 text-[10px]">H: ${t.high}</span>
                <span className="text-slate-400 text-[10px]">L: ${t.low}</span>
                <span className="text-cyan-400 text-[10px] font-semibold">VOL: {t.vol}</span>
              </div>
            ))}
          </div>
        </div>

      </section>

      {/* =========================================================================
          2. SECCIÓN: AUTOMATIZACIÓN TOTAL & MODO STREAMING 3D
         ========================================================================= */}
      <section className="py-16 sm:py-24 relative z-10 border-t border-slate-900 bg-gradient-to-b from-slate-950 via-[#030914] to-slate-950 overflow-hidden">
        
        {/* Luces y resplandores de fondo (Sin color rojo, tonos cyan, sky y violeta premium) */}
        <div className="absolute top-1/3 -left-20 w-96 h-96 bg-cyan-500/10 rounded-full blur-3xl pointer-events-none" />
        <div className="absolute top-1/3 -right-20 w-96 h-96 bg-blue-500/10 rounded-full blur-3xl pointer-events-none" />

        <div className="max-w-6xl mx-auto px-4 sm:px-6 lg:px-8 relative z-10">
          
          {/* HEADER CON ESCENA REALISTA EN EL HOGAR Y TELEVISOR CON CARRUSEL 3D */}
          <div className="flex flex-col items-center text-center max-w-4xl mx-auto mb-14 sm:mb-16">
            
            {/* ESCENA FOTOGRÁFICA Y TELEVISOR EN MUEBLE DE HOGAR CON CARRUSEL 3D */}
            <div className="relative w-full max-w-[620px] mb-8 group [perspective:1200px]">
              
              {/* Resplandor ambiental de cine en casa */}
              <div className="absolute -inset-3 bg-gradient-to-r from-cyan-500/20 via-sky-500/15 to-emerald-500/20 rounded-[32px] blur-2xl opacity-70 group-hover:opacity-100 transition duration-700 pointer-events-none" />

              {/* MARCO EXTERIOR DEL CONJUNTO LIVING & TV */}
              <div className="relative rounded-3xl bg-slate-900/90 border-2 border-slate-800 shadow-2xl overflow-hidden backdrop-blur-xl">
                
                {/* 1. IMAGEN FOTOGRÁFICA DE LA FAMILIA RELAJADA EN EL HOGAR */}
                <div className="relative w-full h-48 sm:h-64 overflow-hidden">
                  <img
                    src="/assets/family-watching-tv.jpg"
                    alt="Familia disfrutando de su tiempo mientras el bot opera"
                    className="w-full h-full object-cover object-center filter brightness-[0.88] contrast-[1.05] group-hover:scale-105 transition-transform duration-700"
                  />
                  {/* Gradiente de integración cinematográfica */}
                  <div className="absolute inset-0 bg-gradient-to-t from-slate-950 via-slate-950/40 to-transparent" />
                  
                  {/* Badge en vivo flotante sobre la foto del living */}
                  <div className="absolute top-3 left-3 sm:top-4 sm:left-4 inline-flex items-center gap-2 px-3 py-1 rounded-full bg-slate-950/80 border border-emerald-400/50 backdrop-blur-md shadow-lg">
                    <span className="w-2 h-2 rounded-full bg-emerald-400 animate-ping" />
                    <span className="text-[10px] font-mono font-bold text-emerald-300">BOT OPERANDO 24/7 EN SEGUNDO PLANO</span>
                  </div>

                  <div className="absolute top-3 right-3 sm:top-4 sm:right-4 inline-flex items-center gap-1.5 px-3 py-1 rounded-full bg-slate-950/80 border border-cyan-400/50 backdrop-blur-md shadow-lg">
                    <span className="text-[10px] font-mono font-bold text-cyan-300">+$2,400 GANANCIA GENERADA</span>
                  </div>
                </div>

                {/* 2. CARRUSEL LIMPIO DE STREAMING EN LA PARTE BAJA DE LA IMAGEN */}
                <div className="py-3 px-3 sm:px-4 bg-slate-950/95 border-t border-slate-800 relative overflow-hidden">
                  
                  {/* CARRUSEL DE LOGOS GIRATORIO CONTINUO */}
                  <div className="relative w-full overflow-hidden mask-[linear-gradient(to_right,transparent,black_10%,black_90%,transparent)]">
                    <div className="flex gap-4 sm:gap-6 animate-marquee whitespace-nowrap items-center py-1">
                      
                      {/* ITERACIONES PARA BUCLE INFINITO */}
                      {[1, 2, 3].map((loop) => (
                        <React.Fragment key={loop}>
                          {/* NETFLIX */}
                          <div className="inline-flex items-center gap-2 px-3.5 py-1.5 rounded-xl bg-slate-900/90 border border-slate-800 shadow-md hover:border-cyan-400/50 transition-all">
                            <svg className="w-6 h-4.5" viewBox="0 0 111 30" fill="none" xmlns="http://www.w3.org/2000/svg">
                              <path d="M105.062 14.28L111 30c-1.794-.277-3.593-.526-5.408-.748l-3.32-8.914-3.321 8.444c-1.72-.194-3.442-.36-5.176-.499L99.5 14.53 94.135 0h5.176l3.32 8.914L105.952 0h5.048l-5.938 14.28zM90.468 0v30h-4.945V0h4.945zm-14.802 0v4.75h-5.464V30h-4.946V4.75h-5.463V0h15.873zm-24.37 0v30h-4.946V17.375h-6.242V30H35.16V0h4.947v12.625h6.242V0h4.946zM26.262 0v4.75h-8.835v7.875h7.616v4.75h-7.616v7.875h8.835V30H12.48V0h13.782zM0 0h4.946l7.474 19.375V0h4.946v30h-4.708L5.184 10.625V30H0V0z" fill="#E50914"/>
                            </svg>
                            <span className="text-[11px] font-bold text-white">Netflix</span>
                          </div>

                          {/* DISNEY+ */}
                          <div className="inline-flex items-center gap-1.5 px-3.5 py-1.5 rounded-xl bg-slate-900/90 border border-slate-800 shadow-md hover:border-cyan-400/50 transition-all">
                            <span className="font-black text-sky-400 text-xs tracking-tight font-sans">Disney<span className="text-white">+</span></span>
                          </div>

                          {/* HBO MAX */}
                          <div className="inline-flex items-center gap-1.5 px-3.5 py-1.5 rounded-xl bg-slate-900/90 border border-slate-800 shadow-md hover:border-cyan-400/50 transition-all">
                            <span className="font-black text-white text-xs tracking-wider font-sans"><span className="text-blue-500 font-black">M</span>AX</span>
                          </div>

                          {/* YOUTUBE */}
                          <div className="inline-flex items-center gap-2 px-3.5 py-1.5 rounded-xl bg-slate-900/90 border border-slate-800 shadow-md hover:border-cyan-400/50 transition-all">
                            <svg className="w-4.5 h-3.5" viewBox="0 0 24 17" fill="none" xmlns="http://www.w3.org/2000/svg">
                              <path d="M23.5 2.6c-.3-1-1-1.8-2-2.1C19.7 0 12 0 12 0S4.3 0 2.5.5c-1 .3-1.7 1.1-2 2.1C0 4.4 0 8.5 0 8.5s0 4.1.5 5.9c.3 1 1 1.8 2 2.1 1.8.5 9.5.5 9.5.5s7.7 0 9.5-.5c1-.3 1.7-1.1 2-2.1.5-1.8.5-5.9.5-5.9s0-4.1-.5-5.9z" fill="#FF0000"/>
                              <path d="M9.6 12.1L15.8 8.5 9.6 4.9v7.2z" fill="#FFFFFF"/>
                            </svg>
                            <span className="text-[11px] font-bold text-white">YouTube</span>
                          </div>
                        </React.Fragment>
                      ))}

                    </div>
                  </div>

                </div>

              </div>

            </div>

            <h2 className="text-3xl sm:text-5xl font-black text-white tracking-tight leading-tight mb-3">
              Tú Eliges tu Serie Favorita.{' '}
              <span className="bg-gradient-to-r from-cyan-400 via-sky-300 to-emerald-400 bg-clip-text text-transparent block mt-1">
                La IA Hace el Trabajo Real.
              </span>
            </h2>

            <p className="text-sm sm:text-base text-slate-300 max-w-xl font-normal leading-relaxed">
              Disfruta de tu tiempo mientras el bot opera en el mercado de forma automática las 24 horas del día.
            </p>
          </div>

          {/* LOS 3 PASOS EN FORMATO COMPACTO, ELEGANTE Y ESTILIZADO */}
          <div className="grid grid-cols-1 md:grid-cols-3 gap-3.5 sm:gap-4 max-w-5xl mx-auto">
            
            {/* PASO 1 */}
            <div className="p-4 sm:p-5 rounded-2xl bg-slate-900/70 hover:bg-slate-900 border border-slate-800 hover:border-cyan-500/40 transition-all flex flex-col justify-between shadow-lg backdrop-blur-md">
              <div>
                <div className="flex items-center justify-between mb-3">
                  <div className="flex items-center gap-2">
                    <span className="w-7 h-7 rounded-lg bg-cyan-500/10 border border-cyan-500/30 flex items-center justify-center font-mono font-bold text-xs text-cyan-400">
                      01
                    </span>
                    <span className="text-base">📝</span>
                  </div>
                  <span className="text-[10px] font-mono font-semibold text-slate-500">
                    2 min
                  </span>
                </div>
                <h3 className="text-sm sm:text-base font-bold text-white mb-1">
                  Regístrate
                </h3>
                <p className="text-xs text-slate-400 leading-snug">
                  Apertura con invitación privada.
                </p>
              </div>
              <div className="mt-3 pt-2.5 border-t border-slate-800/80 text-[11px] font-mono text-cyan-400/90 font-medium flex items-center gap-1.5">
                <span>✓</span> Proceso simple y guiado
              </div>
            </div>

            {/* PASO 2 */}
            <div className="p-4 sm:p-5 rounded-2xl bg-slate-900/70 hover:bg-slate-900 border border-slate-800 hover:border-sky-500/40 transition-all flex flex-col justify-between shadow-lg backdrop-blur-md">
              <div>
                <div className="flex items-center justify-between mb-3">
                  <div className="flex items-center gap-2">
                    <span className="w-7 h-7 rounded-lg bg-sky-500/10 border border-sky-500/30 flex items-center justify-center font-mono font-bold text-xs text-sky-400">
                      02
                    </span>
                    <span className="text-base">🎯</span>
                  </div>
                  <span className="text-[10px] font-mono font-semibold text-slate-500">
                    Modalidad
                  </span>
                </div>
                <h3 className="text-sm sm:text-base font-bold text-white mb-1">
                  Elige tu Modalidad
                </h3>
                <p className="text-xs text-slate-400 leading-snug">
                  Fondo, Copy-Trading o Bot Personal.
                </p>
              </div>
              <div className="mt-3 pt-2.5 border-t border-slate-800/80 text-[11px] font-mono text-sky-400/90 font-medium flex items-center gap-1.5">
                <span>✓</span> Autocustodia o Gestión Pasiva
              </div>
            </div>

            {/* PASO 3 */}
            <div className="p-4 sm:p-5 rounded-2xl bg-gradient-to-b from-slate-900/80 to-cyan-950/20 border border-cyan-500/30 hover:border-cyan-400/60 transition-all flex flex-col justify-between shadow-lg backdrop-blur-md">
              <div>
                <div className="flex items-center justify-between mb-3">
                  <div className="flex items-center gap-2">
                    <span className="w-7 h-7 rounded-lg bg-emerald-500/15 border border-emerald-500/30 flex items-center justify-center font-mono font-bold text-xs text-emerald-400">
                      03
                    </span>
                    <span className="text-base">⚡</span>
                  </div>
                  <span className="text-[10px] font-mono font-semibold text-emerald-400/80">
                    Automático
                  </span>
                </div>
                <h3 className="text-sm sm:text-base font-bold text-white mb-1">
                  Enciende y Relájate
                </h3>
                <p className="text-xs text-slate-400 leading-snug">
                  La IA opera en el mercado 24/7.
                </p>
              </div>
              <div className="mt-3 pt-2.5 border-t border-slate-800/80 text-[11px] font-mono text-emerald-400/90 font-medium flex items-center gap-1.5">
                <span>✓</span> Ganancias automáticas 24/7
              </div>
            </div>

          </div>

        </div>
      </section>

      {/* =========================================================================
          3. SECCIÓN: MONEDAS DE MAYOR CAPITALIZACIÓN SEGURAS
         ========================================================================= */}
      <section id="activos" className="py-16 relative z-10 border-t border-slate-900">
        <div className="max-w-6xl mx-auto px-4 sm:px-6 lg:px-8">
          
          <div className="bg-slate-900/60 border border-cyan-500/30 rounded-3xl p-6 sm:p-10 backdrop-blur-xl">
            <div className="flex flex-col lg:flex-row items-center justify-between gap-8">
              
              <div className="max-w-xl">
                <span className="px-3 py-1 rounded-full bg-cyan-500/10 border border-cyan-500/30 text-cyan-400 text-xs font-mono font-bold uppercase">
                  💎 FILTRO ESTRICTO DE LIQUIDEZ
                </span>
                <h3 className="text-2xl sm:text-3xl font-black text-white mt-3 mb-2">
                  Solo Monedas Seguras de Mayor Capitalización
                </h3>
              </div>

              {/* LISTA VISUAL DE ACTIVOS BLUE-CHIP */}
              <div className="grid grid-cols-2 sm:grid-cols-3 gap-3 w-full lg:w-auto">
                {[
                  { name: 'Bitcoin', ticker: 'BTC/USDT', rank: '#1 Mercado' },
                  { name: 'Ethereum', ticker: 'ETH/USDT', rank: '#2 Mercado' },
                  { name: 'Solana', ticker: 'SOL/USDT', rank: 'Alta Liquidez' },
                  { name: 'BNB', ticker: 'BNB/USDT', rank: 'Top Capitalización' },
                  { name: 'Ripple', ticker: 'XRP/USDT', rank: 'Volumen Global' },
                  { name: 'Avalanche', ticker: 'AVAX/USDT', rank: 'Bajo Slippage' },
                ].map((coin, idx) => (
                  <div key={idx} className="p-3 rounded-xl bg-slate-950 border border-slate-800 text-center">
                    <div className="font-mono text-xs font-bold text-white">{coin.ticker}</div>
                    <div className="text-[10px] text-cyan-400 mt-0.5">{coin.name}</div>
                    <div className="text-[9px] text-slate-500 mt-1">{coin.rank}</div>
                  </div>
                ))}
              </div>

            </div>
          </div>

        </div>
      </section>

      {/* =========================================================================
          4. CURVAS DE CAPITAL DE USUARIOS ANÓNIMOS
         ========================================================================= */}
      <section id="rendimiento" className="py-16 sm:py-20 relative z-10 border-t border-slate-900 bg-slate-900/30">
        <div className="max-w-6xl mx-auto px-4 sm:px-6 lg:px-8">
          
          {/* COMPONENTE INTERACTIVO DE PASARELA */}
          <EquityCurvesShowcase />

        </div>
      </section>

      {/* =========================================================================
          5. NIVELES DE RENDIMIENTO & RETORNO DE INVERSIÓN (COMPARACIÓN SENCILLA)
         ========================================================================= */}
      <section id="comisiones" className="py-16 sm:py-20 relative z-10 border-t border-slate-900 bg-slate-950">
        <div className="max-w-6xl mx-auto px-4 sm:px-6 lg:px-8">

          {/* CUADRO COMPARATIVO SENCILLO: ¿QUÉ PREFIERES EN TU BOLSILLO? */}
          <div className="mb-10 sm:mb-14 p-5 sm:p-8 rounded-3xl bg-gradient-to-br from-slate-900 via-cyan-950/30 to-slate-900 border border-cyan-500/40 shadow-2xl shadow-cyan-950/40 relative overflow-hidden">
            <div className="absolute top-0 right-0 w-80 h-80 bg-cyan-500/10 rounded-full blur-3xl pointer-events-none" />

            <div className="relative z-10 text-center max-w-2xl mx-auto mb-6 sm:mb-8">
              <h3 className="text-xl sm:text-2xl lg:text-3xl font-black text-white mt-3">
                ¿Qué prefieres tener en tu bolsillo?
              </h3>
            </div>

            <div className="grid grid-cols-1 md:grid-cols-2 gap-4 sm:gap-6 relative z-10 items-stretch">
              
              {/* CASO A: ESTRATEGIA COMÚN */}
              <div className="p-5 sm:p-6 rounded-2xl bg-slate-950/90 border border-slate-800 flex flex-col justify-between shadow-xl">
                <div>
                  <div className="flex items-center justify-between mb-3 min-h-[28px]">
                    <span className="text-xs font-mono font-bold text-slate-400 uppercase">Opción 1 • Estrategia Común</span>
                    <span className="px-2.5 py-1 rounded-full bg-slate-800 text-slate-300 font-mono text-[10px] font-bold border border-slate-700">
                      15% Comisión
                    </span>
                  </div>

                  <div className="text-slate-400 text-xs mb-1">Tu inversión: <strong className="text-white font-mono">$10,000 USDT</strong></div>
                  <div className="text-slate-400 text-xs mb-1">Ganancia obtenida:</div>
                  <div className="text-2xl sm:text-3xl font-black text-slate-200 font-mono mb-4">
                    +$1,000 <span className="text-xs text-slate-400 font-normal">USDT</span>
                  </div>

                  <div className="p-3.5 rounded-xl bg-slate-900/90 border border-slate-800 space-y-2.5 text-xs font-mono">
                    <div className="flex justify-between items-center text-slate-300">
                      <span className="text-slate-400">Comisión del 15%:</span>
                      <span className="text-rose-400 font-bold">-$150 USDT</span>
                    </div>
                    <div className="pt-2.5 border-t border-slate-800 flex justify-between items-center font-bold text-sm">
                      <span className="text-white">Te quedan en mano:</span>
                      <span className="text-slate-200 text-base">+$850 USDT</span>
                    </div>
                  </div>
                </div>

                <div className="mt-4 pt-3 border-t border-slate-800/60 text-[11px] text-slate-500 font-mono">
                  Ganancia neta en 75 Días
                </div>
              </div>

              {/* CASO B: FONDO CON MEJORES ESTRATEGIAS */}
              <div className="p-5 sm:p-6 rounded-2xl bg-gradient-to-b from-cyan-950/80 to-slate-950 border border-cyan-400/80 shadow-2xl shadow-cyan-500/20 flex flex-col justify-between relative">
                <div>
                  <div className="flex items-center justify-between mb-3 min-h-[28px]">
                    <span className="text-xs font-mono font-bold text-cyan-300 uppercase">Opción 2 • Fondo de Inversión</span>
                    <div className="flex items-center gap-1.5">
                      <span className="px-2.5 py-0.5 rounded-full bg-cyan-400 text-slate-950 font-mono text-[9px] font-black uppercase tracking-wider">
                        MÁS DINERO LIMPIO
                      </span>
                      <span className="px-2.5 py-1 rounded-full bg-cyan-400/20 text-cyan-300 font-mono text-[10px] font-bold border border-cyan-400/40">
                        Mejores Estrategias
                      </span>
                    </div>
                  </div>

                  <div className="text-slate-400 text-xs mb-1">Misma inversión: <strong className="text-white font-mono">$10,000 USDT</strong></div>
                  <div className="text-cyan-300/80 text-xs mb-1">Ganancia obtenida:</div>
                  <div className="text-2xl sm:text-3xl font-black text-emerald-400 font-mono mb-4">
                    +$4,000 <span className="text-xs text-emerald-300 font-normal">USDT</span>
                  </div>

                  <div className="p-3.5 rounded-xl bg-slate-900/90 border border-cyan-500/30 space-y-2.5 text-xs font-mono">
                    <div className="flex justify-between items-center text-slate-200">
                      <span className="text-slate-300">Comisión del 40%:</span>
                      <span className="text-rose-400 font-bold">-$1,600 USDT</span>
                    </div>
                    <div className="pt-2.5 border-t border-cyan-500/30 flex justify-between items-center font-bold text-sm">
                      <span className="text-white">Te quedan limpios:</span>
                      <span className="text-emerald-400 text-base font-extrabold">+$2,400 USDT</span>
                    </div>
                  </div>
                </div>

                <div className="mt-4 pt-3 border-t border-cyan-500/20 text-[11px] text-cyan-300 font-mono font-semibold">
                  Ganancia neta en 75 Días
                </div>
              </div>

            </div>

            <div className="mt-6 pt-5 border-t border-cyan-500/20 text-center text-xs text-slate-300 leading-relaxed max-w-2xl mx-auto px-2">
              <em>"No importa el porcentaje de la comisión: lo único que importa es cuánto dinero real te queda al final en el bolsillo."</em>
            </div>
          </div>

          {/* LAS 3 MODALIDADES EXPLICADAS DE FORMA FÁCIL Y DIRECTA */}
          <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
            
            {/* PRODUCTO 1: FONDO MANCOMUNADO (DESTACADO / ESTRATEGIAS EXCLUSIVAS) */}
            <div className="p-6 rounded-3xl bg-gradient-to-b from-slate-900 to-cyan-950/50 border border-cyan-400/70 shadow-xl shadow-cyan-950/30 flex flex-col justify-between relative">
              <div className="absolute -top-3 left-1/2 -translate-x-1/2 px-3 py-0.5 rounded-full bg-cyan-400 text-slate-950 font-mono text-[9px] font-black uppercase tracking-wider">
                MÁS POPULAR • MÁXIMA GANANCIA
              </div>
              <div>
                <div className="flex items-center justify-between mb-2">
                  <span className="px-2.5 py-0.5 rounded-full bg-cyan-500/20 text-cyan-300 font-mono text-[10px] font-bold border border-cyan-500/30">
                    MODALIDAD 01
                  </span>
                  <span className="text-xs font-mono font-bold text-amber-300">EXCLUSIVO</span>
                </div>
                <h4 className="text-xl font-bold text-white mt-1">Fondo de Inversión</h4>
                <div className="text-sm font-semibold text-amber-300 my-2">
                  Las estrategias más rentables
                </div>
                <div className="space-y-2.5 text-xs text-slate-200 pt-3 border-t border-slate-800">
                  <div className="flex items-center gap-2"><span className="text-emerald-400 font-bold">✓</span> Acceso a las estrategias más rentables</div>
                  <div className="flex items-center gap-2"><span className="text-emerald-400 font-bold">✓</span> Cero configuración técnica para ti</div>
                  <div className="flex items-center gap-2"><span className="text-emerald-400 font-bold">✓</span> Estado de cuenta claro de tus ganancias</div>
                  <div className="flex items-center gap-2"><span className="text-emerald-400 font-bold">✓</span> Mayor dinero neto directo a tu cuenta</div>
                </div>
              </div>
              <button
                type="button"
                onClick={() => onOpenRegister && onOpenRegister(simCapital)}
                className="w-full mt-6 py-2.5 rounded-xl bg-gradient-to-r from-cyan-400 to-blue-500 text-slate-950 font-black text-xs shadow-lg transition hover:scale-105 active:scale-95"
              >
                Invertir en el Fondo
              </button>
            </div>

            {/* PRODUCTO 2: COPY TRADING */}
            <div className="p-6 rounded-3xl bg-slate-900/70 border border-slate-800 flex flex-col justify-between">
              <div>
                <div className="flex items-center justify-between mb-2">
                  <span className="px-2.5 py-0.5 rounded-full bg-slate-800 text-slate-300 font-mono text-[10px] font-bold">
                    MODALIDAD 02
                  </span>
                  <span className="text-xs font-mono font-bold text-sky-400">COPIA DIRECTA</span>
                </div>
                <h4 className="text-xl font-bold text-white mt-1">Copy-Trading</h4>
                <div className="text-sm font-semibold text-cyan-300 my-2">
                  Tu dinero en tu propia cuenta
                </div>
                <div className="space-y-2.5 text-xs text-slate-300 pt-3 border-t border-slate-800">
                  <div className="flex items-center gap-2"><span className="text-sky-400 font-bold">✓</span> Tu dinero siempre bajo tu control</div>
                  <div className="flex items-center gap-2"><span className="text-sky-400 font-bold">✓</span> Retiros libres en cualquier momento</div>
                  <div className="flex items-center gap-2"><span className="text-sky-400 font-bold">✓</span> Copia automática sin que hagas nada</div>
                </div>
              </div>
              <button
                type="button"
                onClick={() => onOpenRegister && onOpenRegister(simCapital)}
                className="w-full mt-6 py-2.5 rounded-xl bg-slate-800 hover:bg-slate-700 text-white font-bold text-xs transition"
              >
                Elegir Copy-Trading
              </button>
            </div>

            {/* PRODUCTO 3: BOT PERSONAL */}
            <div className="p-6 rounded-3xl bg-slate-900/70 border border-slate-800 flex flex-col justify-between">
              <div>
                <div className="flex items-center justify-between mb-2">
                  <span className="px-2.5 py-0.5 rounded-full bg-slate-800 text-slate-300 font-mono text-[10px] font-bold">
                    MODALIDAD 03
                  </span>
                  <span className="text-xs font-mono font-bold text-cyan-400">TÚ CONTROLAS</span>
                </div>
                <h4 className="text-xl font-bold text-white mt-1">Bot Personal</h4>
                <div className="text-sm font-semibold text-cyan-300 my-2">
                  Configuración a tu medida
                </div>
                <div className="space-y-2.5 text-xs text-slate-300 pt-3 border-t border-slate-800">
                  <div className="flex items-center gap-2"><span className="text-cyan-400 font-bold">✓</span> Tú decides el apalancamiento (1x a 10x)</div>
                  <div className="flex items-center gap-2"><span className="text-cyan-400 font-bold">✓</span> Eliges tus monedas preferidas</div>
                  <div className="flex items-center gap-2"><span className="text-cyan-400 font-bold">✓</span> Trabaja en automático 24/7 con tus reglas</div>
                </div>
              </div>
              <button
                type="button"
                onClick={() => onOpenRegister && onOpenRegister(simCapital)}
                className="w-full mt-6 py-2.5 rounded-xl bg-slate-800 hover:bg-slate-700 text-white font-bold text-xs transition"
              >
                Elegir Bot Personal
              </button>
            </div>

          </div>

        </div>
      </section>

      {/* =========================================================================
          6. SECCIÓN PATRIMONIO GENERACIONAL: EL MODELO TRUMP & EL FONDO PARA TUS HIJOS
         ========================================================================= */}
      <section id="patrimonio-hijos" className="py-16 sm:py-20 relative z-10 border-t border-slate-900 bg-gradient-to-b from-slate-950 via-[#070b16] to-slate-950 overflow-hidden">
        
        {/* Luces ambientales en dorado institucional y azul naval */}
        <div className="absolute top-1/4 left-0 w-96 h-96 bg-amber-500/10 rounded-full blur-3xl pointer-events-none" />
        <div className="absolute bottom-1/4 right-0 w-96 h-96 bg-blue-600/10 rounded-full blur-3xl pointer-events-none" />

        <div className="max-w-6xl mx-auto px-4 sm:px-6 lg:px-8 relative z-10">
          
          <div className="grid grid-cols-1 lg:grid-cols-12 gap-8 lg:gap-12 items-center">
            
            {/* COLUMNA IZQUIERDA: IMAGEN LIMPIA SIN ETIQUETAS QUE OBSTRUYAN */}
            <div className="lg:col-span-5 flex flex-col items-center">
              <div className="w-full max-w-md rounded-3xl p-2.5 bg-gradient-to-b from-amber-400/40 via-slate-800 to-amber-500/30 border border-amber-400/50 shadow-2xl shadow-amber-500/20 backdrop-blur-xl group">
                <div className="relative rounded-2xl overflow-hidden bg-slate-950 border border-amber-500/30">
                  <img
                    src="/trump-heritage-fund.jpg"
                    alt="Donald Trump Heritage Fund - Cuentas de Inversión para Hijos en Autocustodia"
                    className="w-full h-auto object-cover object-center transform group-hover:scale-105 transition-transform duration-700"
                    loading="lazy"
                  />

                  {/* Badge flotante superior discreto */}
                  <div className="absolute top-3 left-3 right-3 flex items-center justify-between pointer-events-none">
                    <span className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full bg-slate-950/85 border border-amber-400/60 text-amber-300 font-mono text-[10px] font-bold backdrop-blur-md shadow-lg">
                      <span className="text-xs">🇺🇸</span> Modelo Trump Accounts
                    </span>
                    <span className="inline-flex items-center gap-1 px-2.5 py-1 rounded-full bg-emerald-950/85 border border-emerald-400/60 text-emerald-300 font-mono text-[10px] font-black backdrop-blur-md">
                      100% Autocustodia
                    </span>
                  </div>
                </div>
              </div>

              {/* Estadísticas clave */}
              <div className="grid grid-cols-2 gap-3 w-full max-w-md mt-4">
                <div className="p-3 rounded-2xl bg-slate-900/80 border border-amber-400/30 text-center">
                  <div className="text-base sm:text-lg font-black font-mono text-amber-300">+18 Años</div>
                  <div className="text-[10px] text-slate-400">Interés Compuesto</div>
                </div>
                <div className="p-3 rounded-2xl bg-slate-900/80 border border-cyan-400/30 text-center">
                  <div className="text-base sm:text-lg font-black font-mono text-cyan-300">$0 Deudas</div>
                  <div className="text-[10px] text-slate-400">Patrimonio en su Mayoría de Edad</div>
                </div>
              </div>
            </div>

            {/* COLUMNA DERECHA: TEXTO RESUMIDO AL 70% + FRASE MOTIVADORA CON FOMO */}
            <div className="lg:col-span-7 space-y-4">
              
              <div className="inline-flex items-center gap-1.5 px-3 py-1 rounded-full bg-amber-400/15 border border-amber-400/40 text-amber-300 text-[11px] font-mono font-black uppercase tracking-wider">
                <span className="text-xs">🇺🇸</span>
                <span>MODELO GENERACIONAL • TRUMP ACCOUNTS (530A)</span>
              </div>

              <h3 className="text-2xl sm:text-3xl lg:text-4xl font-black text-white tracking-tight leading-tight">
                En EE.UU. Invierten en sus Hijos al Nacer...{' '}
                <span className="block mt-1 bg-gradient-to-r from-amber-300 via-yellow-200 to-amber-400 bg-clip-text text-transparent">
                  ¿Qué Estás Haciendo Tú por los Tuyos?
                </span>
              </h3>

              <p className="text-xs sm:text-sm text-slate-300 leading-relaxed font-normal">
                Donald Trump propuso crear cuentas de inversión para recién nacidos con 18 años de interés compuesto. Fuera de EE.UU., ningún gobierno lo hará por tus hijos: tú eres quien debe construir su respaldo financiero hoy en <strong className="text-white">autocustodia total</strong>.
              </p>

              {/* 3 PILARES ESENCIALES (SÚPER RESUMIDOS) */}
              <div className="grid grid-cols-1 sm:grid-cols-3 gap-2.5 pt-1">
                <div className="p-3 rounded-xl bg-slate-900/80 border border-slate-800">
                  <div className="font-bold text-white text-xs flex items-center gap-1 mb-1">
                    <span>🌱</span> Capital Semilla
                  </div>
                  <p className="text-[10px] text-slate-400 leading-tight">
                    Inicia con lo que tengas en USDT. El tiempo multiplica.
                  </p>
                </div>
                <div className="p-3 rounded-xl bg-slate-900/80 border border-slate-800">
                  <div className="font-bold text-white text-xs flex items-center gap-1 mb-1">
                    <span>🤖</span> Algoritmos 24/7
                  </div>
                  <p className="text-[10px] text-slate-400 leading-tight">
                    Operación matemática en Bitcoin, Ethereum y Solana.
                  </p>
                </div>
                <div className="p-3 rounded-xl bg-slate-900/80 border border-slate-800">
                  <div className="font-bold text-white text-xs flex items-center gap-1 mb-1">
                    <span>🎓</span> Mayoría de Edad
                  </div>
                  <p className="text-[10px] text-slate-400 leading-tight">
                    Tu hijo reclama su saldo para universidad o empresa sin deudas.
                  </p>
                </div>
              </div>

              {/* FRASE DE ALTO FOMO Y URGENCIA */}
              <div className="p-3.5 sm:p-4 rounded-2xl bg-gradient-to-r from-amber-950/60 via-slate-900 to-rose-950/40 border border-amber-400/50 shadow-lg">
                <div className="flex items-start gap-2.5">
                  <span className="text-lg text-amber-400 shrink-0 mt-0.5">⚡</span>
                  <div>
                    <div className="text-[11px] font-mono font-bold text-amber-300 uppercase tracking-wide">
                      URGENCIA FINANCIERA • EL TIEMPO NO SE RECUPERA
                    </div>
                    <p className="text-xs text-amber-100 font-semibold leading-relaxed mt-1">
                      «Cada día que dejas pasar sin un fondo multiplicándose en autocustodia es dinero que la inflación le arrebata a tus hijos. El tiempo es el único activo irreemplazable: asegura su patrimonio hoy con los beneficios preferenciales de lanzamiento antes de que se agoten los cupos asignados.»
                    </p>
                  </div>
                </div>
              </div>

              <div className="pt-1">
                <button
                  type="button"
                  onClick={() => onOpenRegister && onOpenRegister(simCapital)}
                  className="w-full sm:w-auto px-7 py-3 bg-gradient-to-r from-amber-400 via-yellow-300 to-amber-500 hover:from-amber-300 hover:to-yellow-200 text-slate-950 font-black text-xs uppercase tracking-wider rounded-xl shadow-xl shadow-amber-500/25 transition hover:scale-105 active:scale-95 flex items-center justify-center gap-2"
                >
                  <span>👶 Asegurar el Futuro de mis Hijos Ahora</span>
                  <span>→</span>
                </button>
              </div>

            </div>

          </div>

        </div>
      </section>

      {/* =========================================================================
          7. PROGRAMA DE SOCIOS & EMBAJADORES (ALTO INCENTIVO PARA ATRAER CAPITAL)
         ========================================================================= */}
      <section id="referidos" className="py-20 relative z-10 border-t border-slate-900 bg-gradient-to-b from-slate-950 via-cyan-950/20 to-slate-950">
        <div className="max-w-6xl mx-auto px-4 sm:px-6 lg:px-8">
          <div className="p-8 sm:p-12 rounded-3xl bg-gradient-to-br from-slate-900 via-cyan-950/40 to-slate-900 border-2 border-cyan-400/50 shadow-2xl shadow-cyan-950/50 relative overflow-hidden backdrop-blur-xl">
            
            {/* Resplandor ambiental de fondo */}
            <div className="absolute top-0 right-0 w-96 h-96 bg-cyan-400/10 rounded-full blur-3xl pointer-events-none" />
            <div className="absolute bottom-0 left-0 w-80 h-80 bg-blue-500/10 rounded-full blur-3xl pointer-events-none" />

            <div className="relative z-10 flex flex-col lg:flex-row items-center justify-between gap-10">
              
              <div className="space-y-4 max-w-2xl">
                <div className="inline-flex items-center gap-2 px-3.5 py-1 rounded-full bg-cyan-400/15 border border-cyan-400/40 text-cyan-300 text-xs font-mono font-black uppercase tracking-wider">
                  <span className="w-2 h-2 rounded-full bg-cyan-400 animate-ping" />
                  <span>💎 SOCIOS Y EMBAJADORES</span>
                </div>
                
                <h3 className="text-3xl sm:text-4xl lg:text-5xl font-black text-white tracking-tight leading-tight">
                  Genera Ingresos Pasivos <span className="bg-gradient-to-r from-cyan-400 via-sky-300 to-blue-400 bg-clip-text text-transparent">Recurrentes en USDT</span>
                </h3>
                
                <p className="text-sm sm:text-base text-slate-200 leading-relaxed font-normal">
                  Convierte a tus conocidos en una fuente de ingresos pasivos. Al incorporarlos a la plataforma, recibes beneficios directos y comisiones recurrentes generadas por cada amigo activo en el sistema.
                </p>
              </div>

              {/* BOTÓN DE ACCIÓN */}
              <div className="w-full lg:w-auto flex flex-col items-center shrink-0">
                <button
                  type="button"
                  onClick={() => onOpenRegister && onOpenRegister(simCapital)}
                  className="w-full sm:w-auto px-8 py-4 bg-gradient-to-r from-cyan-400 via-sky-300 to-blue-500 text-slate-950 font-black text-xs uppercase tracking-wider rounded-2xl shadow-xl shadow-cyan-500/30 hover:scale-105 active:scale-95 transition flex items-center justify-center gap-2"
                >
                  <span>Activar Mi Enlace de Socio</span>
                  <span>→</span>
                </button>
              </div>

            </div>
          </div>
        </div>
      </section>

      {/* =========================================================================
          8. SIMULADOR INTERACTIVO CONCISO Y VISUAL
         ========================================================================= */}
      <section id="simulador" className="py-20 relative z-10 border-t border-slate-900">
        <div className="max-w-5xl mx-auto px-4 sm:px-6 lg:px-8">
          
          <div className="text-center max-w-2xl mx-auto mb-10">
            <h2 className="text-2xl sm:text-4xl font-black text-white tracking-tight mb-2">
              Simulador de Rendimiento
            </h2>
            <p className="text-xs sm:text-sm text-slate-400">
              Ajusta tu capital y perfil para calcular la proyección matemática estimada.
            </p>
          </div>

          <div className="bg-slate-900/80 border border-cyan-500/30 rounded-3xl p-6 sm:p-8 backdrop-blur-xl shadow-xl">
            <div className="grid grid-cols-1 lg:grid-cols-12 gap-8 items-center">
              
              {/* CONTROLES */}
              <div className="lg:col-span-7 space-y-6">
                <div>
                  <div className="flex items-center justify-between mb-2">
                    <span className="text-xs font-bold text-slate-300">Capital a Invertir:</span>
                    <span className="text-2xl font-black text-cyan-400 font-mono">${simCapital.toLocaleString()} USDT</span>
                  </div>
                  <input
                    type="range"
                    min="1000"
                    max="50000"
                    step="500"
                    value={simCapital}
                    onChange={(e) => setSimCapital(Number(e.target.value))}
                    className="w-full h-2 bg-slate-800 rounded-lg appearance-none cursor-pointer accent-cyan-400"
                  />
                  <div className="flex flex-wrap justify-between gap-1 sm:gap-1.5 mt-2">
                    {[1000, 2500, 5000, 10000, 25000].map((amt) => (
                      <button
                        key={amt}
                        type="button"
                        onClick={() => setSimCapital(amt)}
                        className={`px-2 py-0.5 text-[10px] font-mono rounded border transition flex-1 sm:flex-none text-center ${
                          simCapital === amt
                            ? 'bg-cyan-500/20 border-cyan-400 text-cyan-300 font-bold'
                            : 'bg-slate-800/60 border-slate-700 text-slate-400'
                        }`}
                      >
                        ${amt.toLocaleString()}
                      </button>
                    ))}
                  </div>
                </div>

                <div>
                  <span className="block text-xs font-bold text-slate-300 mb-2">Perfil de Estrategia:</span>
                  <div className="grid grid-cols-3 gap-2">
                    {[
                      { id: 'conservative', label: 'Conservador' },
                      { id: 'v21', label: 'V21 (Estándar)' },
                      { id: 'aggressive', label: 'Agresivo' },
                    ].map((p) => (
                      <button
                        key={p.id}
                        type="button"
                        onClick={() => setSimProfile(p.id)}
                        className={`p-2 rounded-xl border text-center text-xs font-bold transition ${
                          simProfile === p.id
                            ? 'bg-cyan-950 border-cyan-400 text-cyan-300 shadow'
                            : 'bg-slate-950 border-slate-800 text-slate-400'
                        }`}
                      >
                        {p.label}
                      </button>
                    ))}
                  </div>
                </div>
              </div>

              {/* RESULTADO PROYECTADO */}
              <div className="lg:col-span-5 p-6 rounded-2xl bg-gradient-to-br from-slate-950 to-slate-900 border border-cyan-500/40 text-center">
                <div className="text-[11px] font-mono text-cyan-400 font-bold uppercase">Rango Mensual Estimado</div>
                <div className="text-3xl font-black text-white font-mono my-2">
                  +${estMin} <span className="text-slate-400 text-sm">a</span> +${estMax} USDT
                </div>
                <div className="text-xs text-emerald-400 font-bold mb-4">
                  ({sim.minPct}% - {sim.maxPct}% mensual aprox.)
                </div>

                <div className="grid grid-cols-2 gap-2 text-[11px] text-slate-300 border-t border-slate-800 pt-3 text-left">
                  <div>Drawdown Máx: <strong className="text-emerald-400">{sim.drawdown}</strong></div>
                  <div>Pares Activos: <strong className="text-white">{sim.pairs}</strong></div>
                  <div>Apalancamiento: <strong className="text-amber-400">{sim.leverage}</strong></div>
                  <div>Monitoreo: <strong className="text-sky-400">24/7</strong></div>
                </div>

                <button
                  type="button"
                  onClick={() => onOpenRegister && onOpenRegister(simCapital)}
                  className="w-full mt-5 py-3 bg-gradient-to-r from-cyan-400 to-blue-500 text-slate-950 font-black text-xs rounded-xl shadow-lg shadow-cyan-500/20 hover:scale-105 active:scale-95 transition"
                >
                  Solicitar con ${simCapital.toLocaleString()} USDT
                </button>
              </div>

            </div>
          </div>

        </div>
      </section>

      {/* =========================================================================
          9. BANNER CTA FINAL
         ========================================================================= */}
      <section className="py-16 relative z-10 border-t border-slate-900">
        <div className="max-w-4xl mx-auto px-4 sm:px-6 lg:px-8">
          <div className="rounded-3xl p-8 sm:p-12 bg-gradient-to-r from-blue-950/80 via-slate-900 to-cyan-950/80 border border-cyan-500/40 text-center shadow-2xl">
            <span className="px-3 py-1 rounded-full bg-cyan-400/20 text-cyan-300 font-mono text-[10px] font-bold border border-cyan-400/40 uppercase">
              CUPOS LIMITADOS DE APERTURA INTERNACIONAL
            </span>
            <h2 className="text-2xl sm:text-4xl font-black text-white tracking-tight mt-3 mb-6">
              ¿Listo para Automatizar Tus Inversiones?
            </h2>
            <div className="flex flex-col sm:flex-row items-center justify-center gap-3">
              <button
                type="button"
                onClick={() => onOpenRegister && onOpenRegister(simCapital)}
                className="w-full sm:w-auto px-7 py-3.5 bg-gradient-to-r from-cyan-400 to-blue-500 text-slate-950 font-black text-xs rounded-xl shadow-lg transition hover:scale-105 active:scale-95"
              >
                🚀 Solicitar Cuenta de Inversión
              </button>
              <button
                type="button"
                onClick={() => onOpenLogin && onOpenLogin()}
                className="w-full sm:w-auto px-6 py-3.5 bg-slate-900 text-white font-bold text-xs rounded-xl border border-slate-700 hover:border-cyan-400 transition"
              >
                Acceso a Clientes Registrados
              </button>
            </div>
          </div>
        </div>
      </section>

      {/* =========================================================================
          10. FOOTER OFICIAL CON WTN SOLUTIONS LLC (DESCARGO REGULATORIO Y LEGAL)
         ========================================================================= */}
      <footer className="bg-slate-950 border-t border-slate-900 pt-14 pb-10 relative z-10 text-xs text-slate-400">
        <div className="max-w-6xl mx-auto px-4 sm:px-6 lg:px-8">
          
          <div className="grid grid-cols-1 md:grid-cols-4 gap-8 mb-10">
            
            {/* EMPRESA LEGAL */}
            <div className="md:col-span-2 space-y-3">
              <div className="flex items-center gap-2 select-none">
                <WordmarkVelocityApex />
              </div>
              <p className="text-xs text-slate-400 leading-relaxed max-w-sm">
                Empresa especializada en software financiero y tecnología algorítmica para mercados de derivados.
              </p>
              <div className="text-[11px] text-slate-500">
                División Tecnológica: <span className="text-slate-300 font-semibold">WTN ALGO-TRADING</span>
              </div>
            </div>

            {/* PRODUCTOS */}
            <div className="space-y-1.5">
              <div className="text-xs font-bold text-white uppercase tracking-wider mb-2">Productos</div>
              <div><a href="#comisiones" className="hover:text-cyan-400 transition">Fondo Mancomunado</a></div>
              <div><a href="#comisiones" className="hover:text-cyan-400 transition">Copy-Trading Privado</a></div>
              <div><a href="#comisiones" className="hover:text-cyan-400 transition">Bot Personal Autónomo</a></div>
              <div><a href="#comisiones" className="hover:text-cyan-400 transition">Niveles de Rendimiento</a></div>
            </div>

            {/* CONTACTO */}
            <div className="space-y-1.5">
              <div className="text-xs font-bold text-white uppercase tracking-wider mb-2">Contacto & Soporte</div>
              <div><button type="button" onClick={() => onOpenLogin && onOpenLogin()} className="hover:text-cyan-400 transition">Iniciar Sesión</button></div>
              <div><button type="button" onClick={() => onOpenRegister && onOpenRegister(simCapital)} className="hover:text-cyan-400 transition text-cyan-400 font-semibold">Solicitar Inversión</button></div>
              <div className="text-[11px] text-slate-500 pt-1">
                Email: <span className="text-slate-300">support@wtnsolutions.com</span>
              </div>
            </div>

          </div>

          {/* DESCARGO REGULATORIO */}
          <div className="pt-6 border-t border-slate-900 text-[10px] text-slate-400 leading-relaxed space-y-2">
            <p>
              <strong className="text-slate-400 uppercase">Descargo de Responsabilidad de Riesgo:</strong> El trading de contratos de futuros y derivados de criptomonedas implica un riesgo financiero sustancial y no es adecuado para todos los perfiles de inversor. Rendimientos pasados o simulados no garantizan resultados futuros.
            </p>
            <p>
              <strong className="text-slate-400">WTN Solutions LLC</strong> provee soluciones de automatización tecnológica y algoritmos de trading. No constituye asesoramiento financiero ni gestión directa de fondos de terceros. La autocustodia de fondos en Copy-Trading permanece siempre en la cuenta individual de exchange del cliente.
            </p>
          </div>

          {/* COPYRIGHT */}
          <div className="mt-6 pt-4 border-t border-slate-900 flex flex-col sm:flex-row items-center justify-between gap-3 text-[11px] text-slate-400">
            <div>
              &copy; {new Date().getFullYear()} <strong className="text-slate-400">WTN Solutions LLC</strong>. Todos los derechos reservados.
            </div>
            <div>
              WTN ALGO-TRADING™ • Mercados de Derivados
            </div>
          </div>

        </div>
      </footer>

      {/* =========================================================================
          BOTÓN FLOTANTE "IR ARRIBA" (SCROLL TO TOP) PROFESIONAL
         ========================================================================= */}
      <button
        type="button"
        onClick={scrollToTop}
        aria-label="Volver arriba"
        className={`fixed bottom-6 right-6 z-50 p-3 sm:p-3.5 rounded-2xl bg-slate-900/95 hover:bg-cyan-950 border border-cyan-400/50 text-cyan-300 hover:text-white shadow-2xl shadow-cyan-500/25 backdrop-blur-xl transition-all duration-300 transform hover:scale-110 active:scale-95 group ${
          showScrollTop ? 'opacity-100 translate-y-0 pointer-events-auto' : 'opacity-0 translate-y-8 pointer-events-none'
        }`}
        title="Volver arriba"
      >
        <div className="flex items-center gap-1.5 font-mono text-xs font-bold">
          <svg className="w-4 h-4 transition-transform group-hover:-translate-y-1 text-cyan-400 group-hover:text-white" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth="3">
            <path strokeLinecap="round" strokeLinejoin="round" d="M5 10l7-7m0 0l7 7m-7-7v18" />
          </svg>
          <span className="hidden sm:inline text-[11px] uppercase tracking-wider font-extrabold">Arriba</span>
        </div>
      </button>

    </div>
  );
}
