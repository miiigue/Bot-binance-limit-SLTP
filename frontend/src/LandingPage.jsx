import React, { useState, useRef } from 'react';
import Trading3DScene from './Trading3DScene';
import EquityCurvesShowcase from './EquityCurvesShowcase';
import {
  WordmarkVelocityApex,
  WordmarkVelocityCyberSlash,
  WordmarkVelocityLaser,
  WordmarkVelocityMonolith,
  WordmarkVelocityTitanium,
  WordmarkNeoQuant,
  LOGO_OPTIONS
} from './LogoOptions';

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
  // Selector dinámico de estilo de logo (Opción 4 Velocity como predeterminado)
  const [selectedLogoId, setSelectedLogoId] = useState('velocity-apex');
  const [showLogoModal, setShowLogoModal] = useState(false);

  // Simulador interactivo de inversión
  const [simCapital, setSimCapital] = useState(5000);
  const [simProfile, setSimProfile] = useState('v21');

  // Menú móvil
  const [mobileMenuOpen, setMobileMenuOpen] = useState(false);

  // Componente del logotipo activo
  const currentLogoOption = LOGO_OPTIONS.find((l) => l.id === selectedLogoId) || LOGO_OPTIONS[0];
  const CurrentWordmarkComponent = currentLogoOption.Component;

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
          1. HEADER / BARRA DE NAVEGACIÓN (SIN MENCIÓN A WTN SOLUTIONS)
         ========================================================================= */}
      <header className="fixed top-0 left-0 right-0 z-50 bg-slate-950/85 backdrop-blur-xl border-b border-cyan-500/20 shadow-lg shadow-cyan-950/30">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 h-20 flex items-center justify-between">
          
          {/* LOGOTIPO TIPOGRÁFICO OFICIAL CON NOMBRE COMPLETO */}
          <div className="flex items-center gap-3">
            <button
              type="button"
              onClick={() => setShowLogoModal(true)}
              className="text-left group transition-transform hover:scale-[1.02] active:scale-[0.98] focus:outline-none"
              title="Haz clic para ver y elegir entre los estilos de logo oficiales"
            >
              <CurrentWordmarkComponent />
            </button>
          </div>

          {/* MENÚ DE ENLACES VISUALES */}
          <nav className="hidden lg:flex items-center gap-6 text-xs font-semibold text-slate-300">
            <a href="#productos" className="hover:text-cyan-400 transition-colors flex items-center gap-1.5">
              <span>💼</span> Soluciones
            </a>
            <a href="#activos" className="hover:text-cyan-400 transition-colors flex items-center gap-1.5">
              <span>💎</span> Monedas Seguras
            </a>
            <a href="#rendimiento" className="hover:text-cyan-400 transition-colors flex items-center gap-1.5">
              <span>📈</span> Curvas de Capital
            </a>
            <a href="#comisiones" className="hover:text-cyan-400 transition-colors flex items-center gap-1.5">
              <span>🏷️</span> Comisiones & Beneficios
            </a>
            <a href="#simulador" className="hover:text-cyan-400 transition-colors flex items-center gap-1.5">
              <span>📊</span> Simulador
            </a>
            <button
              type="button"
              onClick={() => setShowLogoModal(true)}
              className="px-2.5 py-1 text-[11px] font-mono text-cyan-300 hover:text-white bg-cyan-950/60 hover:bg-cyan-900/60 border border-cyan-500/30 rounded-lg transition flex items-center gap-1.5"
            >
              <span>🎨</span> Elegir Estilo de Logo
            </button>
          </nav>

          {/* BOTONES DE ACCIÓN: INICIAR SESIÓN / SOLICITAR INVERSIÓN */}
          <div className="hidden sm:flex items-center gap-3">
            <button
              type="button"
              onClick={() => onOpenLogin && onOpenLogin()}
              className="px-4 py-2 text-xs font-bold text-slate-200 hover:text-white bg-slate-900 hover:bg-slate-800 border border-slate-700 hover:border-cyan-500/50 rounded-xl transition"
            >
              Iniciar Sesión
            </button>

            <button
              type="button"
              onClick={() => onOpenRegister && onOpenRegister(simCapital)}
              className="px-5 py-2.5 text-xs font-extrabold text-slate-950 bg-gradient-to-r from-cyan-400 via-sky-300 to-cyan-300 hover:from-cyan-300 hover:to-sky-200 rounded-xl shadow-lg shadow-cyan-500/25 transition hover:scale-105 active:scale-95 flex items-center gap-2"
            >
              <span>Solicitar Inversión</span>
              <span>→</span>
            </button>
          </div>

          {/* BOTÓN MÓVIL */}
          <div className="flex sm:hidden items-center gap-2">
            <button
              type="button"
              onClick={() => onOpenLogin && onOpenLogin()}
              className="px-3 py-1.5 text-[11px] font-bold bg-slate-800 rounded-lg text-slate-200"
            >
              Acceso
            </button>
            <button
              type="button"
              onClick={() => setMobileMenuOpen(!mobileMenuOpen)}
              className="p-2 text-slate-400 hover:text-white"
            >
              {mobileMenuOpen ? '✕' : '☰'}
            </button>
          </div>

        </div>

        {/* MENÚ MÓVIL DESPLEGABLE */}
        {mobileMenuOpen && (
          <div className="sm:hidden px-4 pt-3 pb-6 bg-slate-950/95 border-b border-cyan-500/20 backdrop-blur-2xl space-y-3 animate-fadeIn">
            <a
              href="#productos"
              onClick={() => setMobileMenuOpen(false)}
              className="block text-sm font-semibold text-slate-300 py-2 border-b border-slate-800"
            >
              💼 Soluciones de Inversión
            </a>
            <a
              href="#activos"
              onClick={() => setMobileMenuOpen(false)}
              className="block text-sm font-semibold text-slate-300 py-2 border-b border-slate-800"
            >
              💎 Monedas de Mayor Capitalización
            </a>
            <a
              href="#rendimiento"
              onClick={() => setMobileMenuOpen(false)}
              className="block text-sm font-semibold text-slate-300 py-2 border-b border-slate-800"
            >
              📈 Curvas de Capital Verificadas
            </a>
            <a
              href="#comisiones"
              onClick={() => setMobileMenuOpen(false)}
              className="block text-sm font-semibold text-slate-300 py-2 border-b border-slate-800"
            >
              🏷️ Niveles de Comisiones & Beneficios
            </a>
            <a
              href="#simulador"
              onClick={() => setMobileMenuOpen(false)}
              className="block text-sm font-semibold text-slate-300 py-2 border-b border-slate-800"
            >
              📊 Simulador de Rendimiento
            </a>
            <button
              type="button"
              onClick={() => { setMobileMenuOpen(false); setShowLogoModal(true); }}
              className="block w-full text-left text-sm font-semibold text-cyan-400 py-2 border-b border-slate-800"
            >
              🎨 Cambiar Estilo de Logo
            </button>
            <div className="pt-2 flex flex-col gap-2">
              <button
                type="button"
                onClick={() => { setMobileMenuOpen(false); onOpenRegister && onOpenRegister(simCapital); }}
                className="w-full py-3 bg-gradient-to-r from-cyan-400 to-blue-500 text-slate-950 font-black text-xs rounded-xl shadow-lg shadow-cyan-500/20"
              >
                Solicitar Inversión
              </button>
            </div>
          </div>
        )}
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
              AUTOMATIZADO
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
              <div className="text-[11px] text-slate-400 font-semibold mt-0.5">Non-Custodial</div>
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
          3. SECCIÓN FUNDAMENTAL: SOLUCIONES DE INVERSIÓN
         ========================================================================= */}
      <section id="productos" className="py-16 sm:py-20 relative z-10 border-t border-slate-900 bg-slate-900/40">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
          
          <div className="text-center max-w-2xl mx-auto mb-10 sm:mb-14">
            <h2 className="text-2xl sm:text-4xl lg:text-5xl font-black text-white tracking-tight">
              Inversión Automatizada
            </h2>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
            
            {/* PRODUCTO 1: FONDO MANCOMUNADO DE INVERSIÓN */}
            <Tilt3DCard className="bg-gradient-to-b from-slate-900 to-slate-950 border border-cyan-500/40 p-7 shadow-xl shadow-cyan-950/20 flex flex-col justify-between">
              <div>
                <div className="flex items-center justify-between mb-4">
                  <div className="w-12 h-12 rounded-2xl bg-cyan-500/15 border border-cyan-500/30 flex items-center justify-center text-2xl text-cyan-400">
                    🏦
                  </div>
                  <span className="px-2.5 py-1 rounded-full bg-cyan-400/15 text-cyan-300 font-mono text-[10px] font-bold border border-cyan-400/30">
                    PRODUCTO 01 • GESTIÓN PASIVA
                  </span>
                </div>

                <h3 className="text-xl font-black text-white mb-2">
                  Fondo Mancomunado
                </h3>
                
                {/* EXCLUSIVIDAD DE ESTRATEGIAS DESTACADA */}
                <div className="p-2.5 rounded-xl bg-cyan-950/60 border border-cyan-500/30 mb-4">
                  <div className="text-[10px] font-mono font-bold text-cyan-300 flex items-center gap-1">
                    <span>⭐</span> ESTRATEGIAS MÁS RENTABLES
                  </div>
                  <p className="text-[11px] text-slate-300 mt-1 leading-relaxed">
                    Acceso a las estrategias automáticas de mayor rendimiento para multiplicar tu dinero sin complicaciones.
                  </p>
                </div>

                <div className="space-y-2 text-xs text-slate-300 mb-6">
                  <div className="flex items-center gap-2">
                    <span className="text-cyan-400 font-bold">✓</span>
                    <span>Cero conocimientos técnicos necesarios.</span>
                  </div>
                  <div className="flex items-center gap-2">
                    <span className="text-cyan-400 font-bold">✓</span>
                    <span>Operación 100% automática y transparente.</span>
                  </div>
                  <div className="flex items-center gap-2">
                    <span className="text-cyan-400 font-bold">✓</span>
                    <span><strong>Estado de Cuenta Oficial (PDF)</strong> con auditoría clara.</span>
                  </div>
                  <div className="flex items-center gap-2">
                    <span className="text-cyan-400 font-bold">✓</span>
                    <span>Mayor ganancia neta directa a tu bolsillo.</span>
                  </div>
                </div>
              </div>

              <div className="pt-4 border-t border-slate-800">
                <button
                  type="button"
                  onClick={() => onOpenRegister && onOpenRegister(simCapital)}
                  className="w-full py-3 bg-cyan-500/20 hover:bg-cyan-500/30 border border-cyan-400/50 text-cyan-300 hover:text-white font-bold text-xs rounded-xl transition flex items-center justify-center gap-2"
                >
                  <span>Ingresar al Fondo Exclusivo</span>
                  <span>→</span>
                </button>
              </div>
            </Tilt3DCard>

            {/* PRODUCTO 2: COPY-TRADING NON-CUSTODIAL */}
            <Tilt3DCard className="bg-gradient-to-b from-slate-900 to-slate-950 border border-sky-500/40 p-7 shadow-xl shadow-sky-950/20 flex flex-col justify-between">
              <div>
                <div className="flex items-center justify-between mb-4">
                  <div className="w-12 h-12 rounded-2xl bg-sky-500/15 border border-sky-500/30 flex items-center justify-center text-2xl text-sky-400">
                    ⚡
                  </div>
                  <span className="px-2.5 py-1 rounded-full bg-sky-400/15 text-sky-300 font-mono text-[10px] font-bold border border-sky-400/30">
                    PRODUCTO 02 • 100% NON-CUSTODIAL
                  </span>
                </div>

                <h3 className="text-xl font-black text-white mb-2">
                  Copy-Trading Privado
                </h3>
                
                <p className="text-xs text-slate-300 mb-4 leading-relaxed">
                  Tu dinero se queda en tu propia cuenta. Conectas tus credenciales de forma segura con retiros bloqueados y el sistema replica cada operación exitosa al instante.
                </p>

                <div className="space-y-2 text-xs text-slate-300 mb-6">
                  <div className="flex items-center gap-2">
                    <span className="text-sky-400 font-bold">✓</span>
                    <span><strong>Tu dinero es tuyo:</strong> Nunca sale de tu wallet o cuenta.</span>
                  </div>
                  <div className="flex items-center gap-2">
                    <span className="text-sky-400 font-bold">✓</span>
                    <span><strong>Retiros libres 24/7</strong> sin pedir permiso a nadie.</span>
                  </div>
                  <div className="flex items-center gap-2">
                    <span className="text-sky-400 font-bold">✓</span>
                    <span>Retiros estrictamente deshabilitados en las credenciales API.</span>
                  </div>
                  <div className="flex items-center gap-2">
                    <span className="text-sky-400 font-bold">✓</span>
                    <span>Copia automática de operaciones en segundos.</span>
                  </div>
                </div>
              </div>

              <div className="pt-4 border-t border-slate-800">
                <button
                  type="button"
                  onClick={() => onOpenRegister && onOpenRegister(simCapital)}
                  className="w-full py-3 bg-gradient-to-r from-sky-400 to-blue-500 hover:from-sky-300 hover:to-blue-400 text-slate-950 font-black text-xs rounded-xl shadow-lg shadow-sky-500/20 transition flex items-center justify-center gap-2"
                >
                  <span>Conectar Copy-Trading</span>
                  <span>→</span>
                </button>
              </div>
            </Tilt3DCard>

            {/* PRODUCTO 3: BOT PERSONAL AUTÓNOMO (CONTROL TOTAL & APALANCAMIENTO A MEDIDA) */}
            <Tilt3DCard className="bg-gradient-to-b from-slate-900 to-slate-950 border border-blue-500/40 p-7 shadow-xl shadow-blue-950/20 flex flex-col justify-between">
              <div>
                <div className="flex items-center justify-between mb-4">
                  <div className="w-12 h-12 rounded-2xl bg-blue-500/15 border border-blue-500/30 flex items-center justify-center text-2xl text-blue-400">
                    🤖
                  </div>
                  <span className="px-2.5 py-1 rounded-full bg-blue-400/15 text-blue-300 font-mono text-[10px] font-bold border border-blue-400/30">
                    PRODUCTO 03 • CONTROL TOTAL
                  </span>
                </div>

                <h3 className="text-xl font-black text-white mb-2">
                  Bot Personal Autónomo
                </h3>
                
                <p className="text-xs text-slate-300 mb-4 leading-relaxed">
                  Para quienes quieren control total: tú decides con qué monedas operar, tu nivel de apalancamiento y cuánto arriesgar en cada operación.
                </p>

                <div className="space-y-2 text-xs text-slate-300 mb-6">
                  <div className="flex items-center gap-2">
                    <span className="text-blue-400 font-bold">✓</span>
                    <span><strong>Apalancamiento a tu medida:</strong> Desde 1x hasta 10x según tu perfil.</span>
                  </div>
                  <div className="flex items-center gap-2">
                    <span className="text-blue-400 font-bold">✓</span>
                    <span><strong>Selección de monedas:</strong> Activa solo las que tú elijas.</span>
                  </div>
                  <div className="flex items-center gap-2">
                    <span className="text-blue-400 font-bold">✓</span>
                    <span>Tus propios límites de riesgo y ganancias.</span>
                  </div>
                  <div className="flex items-center gap-2">
                    <span className="text-blue-400 font-bold">✓</span>
                    <span>El bot opera las 24 horas siguiendo exactamente tus reglas.</span>
                  </div>
                </div>
              </div>

              <div className="pt-4 border-t border-slate-800">
                <button
                  type="button"
                  onClick={() => onOpenRegister && onOpenRegister(simCapital)}
                  className="w-full py-3 bg-blue-500/20 hover:bg-blue-500/30 border border-blue-400/50 text-blue-300 hover:text-white font-bold text-xs rounded-xl transition flex items-center justify-center gap-2"
                >
                  <span>Configurar Bot Personal</span>
                  <span>→</span>
                </button>
              </div>
            </Tilt3DCard>

          </div>

        </div>
      </section>

      {/* =========================================================================
          4. SECCIÓN: MONEDAS DE MAYOR CAPITALIZACIÓN SEGURAS
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
          5. PASARELA DE CURVAS DE CAPITAL DE USUARIOS ANÓNIMOS
         ========================================================================= */}
      <section id="rendimiento" className="py-16 sm:py-20 relative z-10 border-t border-slate-900 bg-slate-900/30">
        <div className="max-w-6xl mx-auto px-4 sm:px-6 lg:px-8">
          
          {/* COMPONENTE INTERACTIVO DE PASARELA */}
          <EquityCurvesShowcase />

        </div>
      </section>

      {/* =========================================================================
          6. NIVELES DE RENDIMIENTO & RETORNO DE INVERSIÓN (COMPARACIÓN SENCILLA)
         ========================================================================= */}
      <section id="comisiones" className="py-16 sm:py-20 relative z-10 border-t border-slate-900 bg-slate-950">
        <div className="max-w-6xl mx-auto px-4 sm:px-6 lg:px-8">

          {/* CUADRO COMPARATIVO SENCILLO: ¿QUÉ PREFIERES EN TU BOLSILLO? */}
          <div className="mb-10 sm:mb-14 p-5 sm:p-8 rounded-3xl bg-gradient-to-br from-slate-900 via-cyan-950/30 to-slate-900 border border-cyan-500/40 shadow-2xl shadow-cyan-950/40 relative overflow-hidden">
            <div className="absolute top-0 right-0 w-80 h-80 bg-cyan-500/10 rounded-full blur-3xl pointer-events-none" />

            <div className="relative z-10 text-center max-w-2xl mx-auto mb-6 sm:mb-8">
              <span className="text-[11px] font-mono font-bold px-3 py-1 rounded-full bg-amber-400/15 border border-amber-400/30 text-amber-300 uppercase">
                💡 COMPARACIÓN SENCILLA
              </span>
              <h3 className="text-xl sm:text-2xl lg:text-3xl font-black text-white mt-3">
                ¿Qué prefieres tener en tu bolsillo?
              </h3>
              <p className="text-xs sm:text-sm text-cyan-300 mt-2 font-medium">
                Ejemplo real con la misma inversión de <strong className="text-white font-mono">$10,000 USDT</strong>:
              </p>
            </div>

            <div className="grid grid-cols-1 md:grid-cols-2 gap-4 sm:gap-6 relative z-10">
              
              {/* CASO A: ESTRATEGIA COMÚN */}
              <div className="p-4 sm:p-6 rounded-2xl bg-slate-950/80 border border-slate-800 flex flex-col justify-between">
                <div>
                  <div className="flex items-center justify-between mb-3">
                    <span className="text-xs font-mono font-bold text-slate-400 uppercase">Opción 1 • Estrategia Común</span>
                    <span className="px-2 py-0.5 rounded bg-slate-800 text-slate-300 font-mono text-[10px] font-bold">15% Comisión</span>
                  </div>
                  <div className="text-slate-400 text-xs mb-1">Tu inversión: <strong>$10,000 USDT</strong></div>
                  <div className="text-slate-400 text-xs mb-1">Ganancia obtenida:</div>
                  <div className="text-2xl sm:text-3xl font-black text-slate-200 font-mono mb-4">
                    +$1,000 <span className="text-xs text-slate-400 font-normal">USDT</span>
                  </div>
                  <div className="p-3 rounded-xl bg-slate-900/90 border border-slate-800 space-y-2 text-xs text-slate-300 font-mono">
                    <div className="flex justify-between">
                      <span className="text-slate-400">Comisión del 15%:</span>
                      <span className="text-rose-400">-$150 USDT</span>
                    </div>
                    <div className="pt-2 border-t border-slate-800 flex justify-between font-bold text-sm">
                      <span className="text-white">Te quedan en mano:</span>
                      <span className="text-slate-200">+$850 USDT</span>
                    </div>
                  </div>
                </div>
                <div className="mt-4 text-[11px] text-slate-400 italic">
                  * Pagas poca comisión, pero te llevas poco dinero a casa.
                </div>
              </div>

              {/* CASO B: FONDO CON MEJORES ESTRATEGIAS */}
              <div className="p-4 sm:p-6 rounded-2xl bg-gradient-to-b from-cyan-950/80 to-slate-950 border border-cyan-400/80 shadow-xl shadow-cyan-500/20 flex flex-col justify-between relative">
                <div className="absolute -top-3 right-6 px-3 py-0.5 rounded-full bg-cyan-400 text-slate-950 font-mono text-[9px] font-black uppercase tracking-wider">
                  MÁS DINERO LIMPIO
                </div>
                <div>
                  <div className="flex items-center justify-between mb-3">
                    <span className="text-xs font-mono font-bold text-cyan-300 uppercase">Opción 2 • Fondo de Inversión</span>
                    <span className="px-2 py-0.5 rounded bg-cyan-400/20 text-cyan-300 font-mono text-[10px] font-bold border border-cyan-400/40">Mejores Estrategias</span>
                  </div>
                  <div className="text-slate-400 text-xs mb-1">Misma inversión: <strong>$10,000 USDT</strong></div>
                  <div className="text-cyan-300/80 text-xs mb-1">Ganancia obtenida:</div>
                  <div className="text-2xl sm:text-3xl font-black text-emerald-400 font-mono mb-4">
                    +$4,000 <span className="text-xs text-emerald-300 font-normal">USDT</span>
                  </div>
                  <div className="p-3 rounded-xl bg-slate-900/90 border border-cyan-500/30 space-y-2 text-xs text-slate-200 font-mono">
                    <div className="flex justify-between">
                      <span className="text-slate-300">Comisión del 40%:</span>
                      <span className="text-rose-400">-$1,600 USDT</span>
                    </div>
                    <div className="pt-2 border-t border-cyan-500/30 flex justify-between font-bold text-sm">
                      <span className="text-white">Te quedan limpios:</span>
                      <span className="text-emerald-400 text-base">+$2,400 USDT</span>
                    </div>
                  </div>
                </div>
                <div className="mt-4 text-[11px] text-cyan-200 font-semibold">
                  ✓ ¡Te llevas <strong className="text-white">$2,400 limpios</strong> a tu bolsillo! Es casi el triple de dinero que los $850.
                </div>
              </div>

            </div>

            <div className="mt-6 pt-5 border-t border-cyan-500/20 text-center text-xs text-slate-300 leading-relaxed max-w-2xl mx-auto px-2">
              <em>"No importa el porcentaje de la comisión: lo único que importa es cuánto dinero real te queda al final en el bolsillo."</em>
            </div>
          </div>

          {/* LAS 3 MODALIDADES EXPLICADAS DE FORMA FÁCIL Y DIRECTA */}
          <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
            
            {/* PRODUCTO 1: BOT PERSONAL */}
            <div className="p-6 rounded-3xl bg-slate-900/70 border border-slate-800 flex flex-col justify-between">
              <div>
                <div className="flex items-center justify-between mb-2">
                  <span className="px-2.5 py-0.5 rounded-full bg-slate-800 text-slate-300 font-mono text-[10px] font-bold">
                    MODALIDAD 01
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

            {/* PRODUCTO 3: FONDO MANCOMUNADO (DESTACADO / ESTRATEGIAS EXCLUSIVAS) */}
            <div className="p-6 rounded-3xl bg-gradient-to-b from-slate-900 to-cyan-950/50 border border-cyan-400/70 shadow-xl shadow-cyan-950/30 flex flex-col justify-between relative">
              <div className="absolute -top-3 left-1/2 -translate-x-1/2 px-3 py-0.5 rounded-full bg-cyan-400 text-slate-950 font-mono text-[9px] font-black uppercase tracking-wider">
                MÁS POPULAR • MÁXIMA GANANCIA
              </div>
              <div>
                <div className="flex items-center justify-between mb-2">
                  <span className="px-2.5 py-0.5 rounded-full bg-cyan-500/20 text-cyan-300 font-mono text-[10px] font-bold border border-cyan-500/30">
                    MODALIDAD 03
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
                  Convierte tus conocidos en una fuente ingresos pasivos. Al incorporarlos a la plataforma, recibes beneficios generados por cada amigo activo
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
          10. MODAL INTERACTIVO PARA ELEGIR EL LOGO TIPOGRÁFICO
         ========================================================================= */}
      {showLogoModal && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-950/85 backdrop-blur-md"
          onClick={() => setShowLogoModal(false)}
        >
          <div
            className="relative w-full max-w-2xl bg-slate-900 border border-cyan-500/40 rounded-3xl p-6 sm:p-8 text-white shadow-2xl"
            onClick={(e) => e.stopPropagation()}
          >
            <button
              type="button"
              onClick={() => setShowLogoModal(false)}
              className="absolute top-5 right-5 w-8 h-8 rounded-full bg-slate-800 hover:bg-slate-700 text-slate-400 hover:text-white flex items-center justify-center text-sm font-bold"
            >
              ✕
            </button>

            <div className="text-center mb-6">
              <span className="text-xs font-mono font-bold text-cyan-400 uppercase tracking-widest">
                🎨 IDENTIDAD VISUAL WTN ALGO-TRADING
              </span>
              <h3 className="text-2xl font-black text-white mt-1">
                Elige el Estilo Oficial de Logo para el Proyecto
              </h3>
              <p className="text-xs text-slate-400 mt-1">
                Como las grandes firmas financieras, el logo es el mismo nombre con identidad tipográfica única. Elige tu favorito:
              </p>
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              {LOGO_OPTIONS.map((opt) => {
                const Wordmark = opt.Component;
                const isSelected = selectedLogoId === opt.id;
                return (
                  <button
                    key={opt.id}
                    type="button"
                    onClick={() => {
                      setSelectedLogoId(opt.id);
                      setShowLogoModal(false);
                    }}
                    className={`p-4 rounded-2xl border text-left transition flex flex-col justify-between ${
                      isSelected
                        ? 'bg-cyan-950/60 border-cyan-400 ring-2 ring-cyan-400/30 shadow-lg'
                        : 'bg-slate-950/60 border-slate-800 hover:border-slate-700'
                    }`}
                  >
                    <div className="p-3 rounded-xl bg-slate-900 border border-slate-800 flex items-center justify-center mb-3 min-h-[56px]">
                      <Wordmark />
                    </div>
                    <div>
                      <div className="flex items-center justify-between">
                        <span className="text-xs font-extrabold text-white">{opt.name}</span>
                        {isSelected && <span className="text-[10px] text-cyan-400 font-bold">✓ Activo</span>}
                      </div>
                      <div className="text-[10px] text-cyan-300 font-medium mt-0.5">{opt.subtitle}</div>
                      <p className="text-[10px] text-slate-400 mt-1.5 leading-relaxed">{opt.desc}</p>
                    </div>
                  </button>
                );
              })}
            </div>

            <div className="mt-6 text-center">
              <button
                type="button"
                onClick={() => setShowLogoModal(false)}
                className="px-6 py-2 bg-slate-800 hover:bg-slate-700 text-white text-xs font-bold rounded-xl transition"
              >
                Cerrar Ventana
              </button>
            </div>
          </div>
        </div>
      )}

      {/* =========================================================================
          11. FOOTER OFICIAL CON WTN SOLUTIONS LLC (DESCARGO REGULATORIO Y LEGAL)
         ========================================================================= */}
      <footer className="bg-slate-950 border-t border-slate-900 pt-14 pb-10 relative z-10 text-xs text-slate-400">
        <div className="max-w-6xl mx-auto px-4 sm:px-6 lg:px-8">
          
          <div className="grid grid-cols-1 md:grid-cols-4 gap-8 mb-10">
            
            {/* EMPRESA LEGAL */}
            <div className="md:col-span-2 space-y-3">
              <div className="flex items-center gap-2">
                <CurrentWordmarkComponent />
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
              <div><a href="#productos" className="hover:text-cyan-400 transition">Fondo Mancomunado</a></div>
              <div><a href="#productos" className="hover:text-cyan-400 transition">Copy-Trading Privado</a></div>
              <div><a href="#productos" className="hover:text-cyan-400 transition">Bot Personal Autónomo</a></div>
              <div><a href="#comisiones" className="hover:text-cyan-400 transition">Niveles de Comisiones</a></div>
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
              <strong className="text-slate-400">WTN Solutions LLC</strong> provee soluciones de automatización tecnológica y algoritmos de trading. No constituye asesoramiento financiero ni gestión directa de fondos de terceros. La custodia de fondos en Copy-Trading permanece siempre en la cuenta individual de exchange del cliente.
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

    </div>
  );
}
