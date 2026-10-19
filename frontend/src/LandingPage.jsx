import React, { useState, useRef } from 'react';
import Trading3DScene from './Trading3DScene';
import { LogoHexNexus, LogoDeltaRay, LogoDualOrbit, LogoCyberWTN, LOGO_OPTIONS } from './LogoOptions';

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
  // Selector dinámico de logo para que el usuario elija su favorito
  const [selectedLogoId, setSelectedLogoId] = useState('hex'); // 'hex', 'delta', 'orbit', 'wtn'
  const [showLogoModal, setShowLogoModal] = useState(false);

  // Simulador interactivo de inversión
  const [simCapital, setSimCapital] = useState(5000);
  const [simProfile, setSimProfile] = useState('v21');

  // Menú móvil
  const [mobileMenuOpen, setMobileMenuOpen] = useState(false);

  // Obtener componente de logo actual
  const currentLogoOption = LOGO_OPTIONS.find((l) => l.id === selectedLogoId) || LOGO_OPTIONS[0];
  const CurrentLogoComponent = currentLogoOption.Component;

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
      label: 'V21 Soberana (Recomendado)',
      leverage: '5x - 7x',
      minPct: 8,
      maxPct: 16,
      drawdown: '< 7.5%',
      pairs: 10,
    },
    aggressive: {
      label: 'Cuantitativo Agresivo',
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

  const tickerItems = [
    { pair: 'BTC/USDT', price: '68,450', change: '+3.2%', signal: 'LONG' },
    { pair: 'ETH/USDT', price: '2,645', change: '+2.9%', signal: 'LONG' },
    { pair: 'SOL/USDT', price: '184.8', change: '+6.5%', signal: 'ACTIVO' },
    { pair: 'BNB/USDT', price: '593.0', change: '+1.8%', signal: 'LONG' },
    { pair: 'AVAX/USDT', price: '28.9', change: '+5.4%', signal: 'DCA' },
    { pair: 'XRP/USDT', price: '0.549', change: '+4.1%', signal: 'LONG' },
  ];

  return (
    <div className="min-h-screen bg-slate-950 text-slate-100 selection:bg-cyan-400 selection:text-slate-950 font-sans overflow-x-hidden">
      
      {/* =========================================================================
          1. HEADER / BARRA DE NAVEGACIÓN (SIN MENCIÓN A WTN SOLUTIONS)
         ========================================================================= */}
      <header className="fixed top-0 left-0 right-0 z-50 bg-slate-950/85 backdrop-blur-xl border-b border-cyan-500/20 shadow-lg shadow-cyan-950/30">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 h-20 flex items-center justify-between">
          
          {/* LOGO OFICIAL DEL PROYECTO */}
          <div className="flex items-center gap-3">
            <button
              type="button"
              onClick={() => setShowLogoModal(true)}
              className="relative group p-1 rounded-2xl bg-slate-900 border border-cyan-500/30 hover:border-cyan-400 shadow-md transition-all hover:scale-105 active:scale-95"
              title="Haz clic para ver y elegir entre las 4 opciones de logo"
            >
              <CurrentLogoComponent size={42} />
              <span className="absolute -bottom-1 -right-1 px-1 py-0.2 bg-cyan-400 text-[8px] font-black text-slate-950 rounded">
                LOGO
              </span>
            </button>

            <div>
              <div className="flex items-center gap-2">
                <span className="text-xl sm:text-2xl font-black tracking-tight text-white">
                  WTN <span className="bg-gradient-to-r from-cyan-400 via-sky-300 to-blue-400 bg-clip-text text-transparent">ALGO-TRADING</span>
                </span>
                <span className="hidden sm:inline-block px-2 py-0.5 text-[10px] font-mono font-bold uppercase rounded-md bg-cyan-500/10 text-cyan-400 border border-cyan-500/30">
                  BINANCE FUTURES
                </span>
              </div>
              <div className="text-[10px] font-mono font-semibold text-slate-400 tracking-wider">
                SISTEMA CUANTITATIVO 24/7
              </div>
            </div>
          </div>

          {/* MENÚ DE ENLACES VISUALES */}
          <nav className="hidden lg:flex items-center gap-7 text-xs font-semibold text-slate-300">
            <a href="#productos" className="hover:text-cyan-400 transition-colors flex items-center gap-1.5">
              <span>💼</span> Productos de Inversión
            </a>
            <a href="#algoritmos" className="hover:text-cyan-400 transition-colors flex items-center gap-1.5">
              <span>🧠</span> Motores
            </a>
            <a href="#simulador" className="hover:text-cyan-400 transition-colors flex items-center gap-1.5">
              <span>📊</span> Calculadora
            </a>
            <a href="#seguridad" className="hover:text-cyan-400 transition-colors flex items-center gap-1.5">
              <span>🛡️</span> Seguridad
            </a>
            <button
              type="button"
              onClick={() => setShowLogoModal(true)}
              className="px-2.5 py-1 text-[11px] font-mono text-cyan-300 hover:text-white bg-cyan-950/60 hover:bg-cyan-900/60 border border-cyan-500/30 rounded-lg transition"
            >
              🎨 Elegir Logo
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
              💼 Productos de Inversión
            </a>
            <a
              href="#algoritmos"
              onClick={() => setMobileMenuOpen(false)}
              className="block text-sm font-semibold text-slate-300 py-2 border-b border-slate-800"
            >
              🧠 Motores Algorítmicos
            </a>
            <a
              href="#simulador"
              onClick={() => setMobileMenuOpen(false)}
              className="block text-sm font-semibold text-slate-300 py-2 border-b border-slate-800"
            >
              📊 Calculadora de Inversión
            </a>
            <button
              type="button"
              onClick={() => { setMobileMenuOpen(false); setShowLogoModal(true); }}
              className="block w-full text-left text-sm font-semibold text-cyan-400 py-2 border-b border-slate-800"
            >
              🎨 Cambiar Diseño de Logo
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
      <section className="relative min-h-[88vh] pt-28 pb-16 flex flex-col justify-center overflow-hidden">
        
        {/* ESCENA 3D DE FONDO */}
        <div className="absolute inset-0 z-0 opacity-80 sm:opacity-95">
          <Trading3DScene />
        </div>

        <div className="relative z-10 max-w-6xl mx-auto px-4 sm:px-6 lg:px-8 text-center flex flex-col items-center">
          
          {/* BADGE DE ESTADO */}
          <div className="inline-flex items-center gap-2 px-3.5 py-1.5 rounded-full bg-cyan-950/70 border border-cyan-400/40 text-cyan-300 text-xs font-mono font-bold tracking-wide shadow-lg shadow-cyan-500/10 mb-6 backdrop-blur-md">
            <span className="w-2 h-2 rounded-full bg-cyan-400 animate-pulse" />
            <span>ALGORITMO 24/7 ACTIVO</span>
            <span className="text-slate-400">•</span>
            <span className="text-slate-200">BINANCE FUTURES</span>
          </div>

          {/* TITULAR PRINCIPAL RESUMIDO Y DE IMPACTO */}
          <h1 className="text-4xl sm:text-6xl lg:text-7xl font-black tracking-tight text-white max-w-4xl leading-[1.08] mb-5">
            TRADING CUANTITATIVO{' '}
            <span className="bg-gradient-to-r from-cyan-400 via-sky-300 to-blue-500 bg-clip-text text-transparent">
              AUTOMATIZADO
            </span>
          </h1>

          <p className="text-base sm:text-xl text-slate-300 max-w-2xl font-normal leading-relaxed mb-8">
            Ejecución matemática 24/7 sin sesgos emocionales. Algoritmos de <strong className="text-cyan-400">RSI Dinámico</strong> y <strong className="text-cyan-400">DCA Inteligente</strong> con gestión de riesgo institucional.
          </p>

          {/* BOTONES DE LLAMADA A LA ACCIÓN */}
          <div className="flex flex-col sm:flex-row items-center gap-3.5 w-full sm:w-auto mb-12">
            <button
              type="button"
              onClick={() => onOpenRegister && onOpenRegister(simCapital)}
              className="w-full sm:w-auto px-8 py-3.5 bg-gradient-to-r from-cyan-400 via-sky-400 to-blue-500 hover:from-cyan-300 hover:to-blue-400 text-slate-950 font-black text-sm rounded-2xl shadow-xl shadow-cyan-500/30 transition hover:scale-105 active:scale-95 flex items-center justify-center gap-2"
            >
              <span>🚀 Enviar Solicitud de Inversión</span>
            </button>

            <button
              type="button"
              onClick={() => onOpenLogin && onOpenLogin()}
              className="w-full sm:w-auto px-7 py-3.5 bg-slate-900/90 hover:bg-slate-800 text-white font-bold text-sm rounded-2xl border border-slate-700 hover:border-cyan-400/60 shadow-lg transition hover:scale-105 active:scale-95 flex items-center justify-center gap-2 backdrop-blur-md"
            >
              <span>🔐 Iniciar Sesión</span>
            </button>
          </div>

          {/* MÉTRICAS CLAVE (4 CARDS VISUALES) */}
          <div className="grid grid-cols-2 md:grid-cols-4 gap-3 sm:gap-4 w-full max-w-3xl">
            <div className="p-3.5 rounded-2xl bg-slate-900/70 border border-slate-800 backdrop-blur-md text-center">
              <div className="text-2xl font-black text-cyan-400 font-mono">99.98%</div>
              <div className="text-[11px] text-slate-400 font-semibold mt-0.5">Uptime Cloud</div>
            </div>
            <div className="p-3.5 rounded-2xl bg-slate-900/70 border border-slate-800 backdrop-blur-md text-center">
              <div className="text-2xl font-black text-sky-400 font-mono">&lt; 12ms</div>
              <div className="text-[11px] text-slate-400 font-semibold mt-0.5">Latencia Binance</div>
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

        {/* CINTA DE TICKERS */}
        <div className="mt-12 w-full overflow-hidden border-y border-slate-800/80 bg-slate-950/70 backdrop-blur-md py-2.5">
          <div className="flex gap-8 whitespace-nowrap animate-marquee">
            {tickerItems.concat(tickerItems).map((item, index) => (
              <div key={index} className="inline-flex items-center gap-2 text-xs font-mono">
                <span className="font-bold text-slate-200">{item.pair}</span>
                <span className="text-slate-400">${item.price}</span>
                <span className="text-emerald-400 font-bold">{item.change}</span>
                <span className="px-1.5 py-0.5 rounded text-[9px] bg-cyan-950 text-cyan-300 border border-cyan-800">
                  {item.signal}
                </span>
              </div>
            ))}
          </div>
        </div>

      </section>

      {/* =========================================================================
          3. SECCIÓN FUNDAMENTAL: LOS 2 PRODUCTOS DE INVERSIÓN
         ========================================================================= */}
      <section id="productos" className="py-20 relative z-10 border-t border-slate-900 bg-slate-900/40">
        <div className="max-w-6xl mx-auto px-4 sm:px-6 lg:px-8">
          
          <div className="text-center max-w-2xl mx-auto mb-12">
            <span className="px-3 py-1 rounded-full bg-cyan-500/10 border border-cyan-500/30 text-cyan-400 text-xs font-mono font-bold uppercase">
              💼 MODELOS DISPONIBLES
            </span>
            <h2 className="text-3xl sm:text-4xl font-black text-white tracking-tight mt-3 mb-2">
              Elige Tu Forma de Invertir
            </h2>
            <p className="text-xs sm:text-sm text-slate-400">
              Dos productos independientes adaptados a tus objetivos de custodia y gestión.
            </p>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-2 gap-8">
            
            {/* PRODUCTO 1: FONDO MANCOMUNADO DE INVERSIÓN */}
            <Tilt3DCard className="bg-gradient-to-b from-slate-900 to-slate-950 border border-cyan-500/30 p-7 sm:p-8 shadow-xl shadow-cyan-950/20 flex flex-col justify-between">
              <div>
                <div className="flex items-center justify-between mb-4">
                  <div className="w-12 h-12 rounded-2xl bg-cyan-500/15 border border-cyan-500/30 flex items-center justify-center text-2xl text-cyan-400">
                    🏦
                  </div>
                  <span className="px-2.5 py-1 rounded-full bg-cyan-400/15 text-cyan-300 font-mono text-[10px] font-bold border border-cyan-400/30">
                    PRODUCTO 01 • GESTIÓN PASIVA
                  </span>
                </div>

                <h3 className="text-xl sm:text-2xl font-black text-white mb-2">
                  Fondo Mancomunado de Inversión
                </h3>
                <p className="text-xs text-slate-300 mb-5 leading-relaxed">
                  Aportas capital a un pool de liquidez institucional operado de forma centralizada por los algoritmos soberanos. Ideal para quienes buscan rendimientos pasivos sin gestionar claves API.
                </p>

                <div className="space-y-2.5 mb-6 text-xs text-slate-300">
                  <div className="flex items-center gap-2">
                    <span className="text-cyan-400 font-bold">✓</span>
                    <span><strong>Cero configuración técnica:</strong> Nuestro equipo opera y audita el fondo.</span>
                  </div>
                  <div className="flex items-center gap-2">
                    <span className="text-cyan-400 font-bold">✓</span>
                    <span><strong>Diversificación total:</strong> Operativa concurrente en más de 10 pares.</span>
                  </div>
                  <div className="flex items-center gap-2">
                    <span className="text-cyan-400 font-bold">✓</span>
                    <span><strong>Estado de Cuenta Oficial (PDF):</strong> Auditoría periódica y transparente.</span>
                  </div>
                  <div className="flex items-center gap-2">
                    <span className="text-cyan-400 font-bold">✓</span>
                    <span><strong>Distribución Proporcional:</strong> Beneficios repartidos según tu participación.</span>
                  </div>
                </div>
              </div>

              <div className="pt-4 border-t border-slate-800">
                <button
                  type="button"
                  onClick={() => onOpenRegister && onOpenRegister(simCapital)}
                  className="w-full py-3 bg-cyan-500/15 hover:bg-cyan-500/25 border border-cyan-400/50 text-cyan-300 hover:text-white font-bold text-xs rounded-xl transition flex items-center justify-center gap-2"
                >
                  <span>Solicitar Ingreso al Fondo</span>
                  <span>→</span>
                </button>
              </div>
            </Tilt3DCard>

            {/* PRODUCTO 2: COPY-TRADING SOBERANO NON-CUSTODIAL */}
            <Tilt3DCard className="bg-gradient-to-b from-slate-900 to-slate-950 border border-sky-500/30 p-7 sm:p-8 shadow-xl shadow-sky-950/20 flex flex-col justify-between">
              <div>
                <div className="flex items-center justify-between mb-4">
                  <div className="w-12 h-12 rounded-2xl bg-sky-500/15 border border-sky-500/30 flex items-center justify-center text-2xl text-sky-400">
                    ⚡
                  </div>
                  <span className="px-2.5 py-1 rounded-full bg-sky-400/15 text-sky-300 font-mono text-[10px] font-bold border border-sky-400/30">
                    PRODUCTO 02 • 100% NON-CUSTODIAL
                  </span>
                </div>

                <h3 className="text-xl sm:text-2xl font-black text-white mb-2">
                  Copy-Trading Soberano (Binance API)
                </h3>
                <p className="text-xs text-slate-300 mb-5 leading-relaxed">
                  Tus fondos permanecen 100% en tu propia cuenta de Binance. Conectas tus credenciales API y el bot replica cada señal del algoritmo maestro en tu cuenta privada a milisegundos.
                </p>

                <div className="space-y-2.5 mb-6 text-xs text-slate-300">
                  <div className="flex items-center gap-2">
                    <span className="text-sky-400 font-bold">✓</span>
                    <span><strong>Custodia absoluta:</strong> Tu capital nunca sale de tu billetera de Binance.</span>
                  </div>
                  <div className="flex items-center gap-2">
                    <span className="text-sky-400 font-bold">✓</span>
                    <span><strong>Retiros 100% libres:</strong> Retira tu capital o ganancias cuando lo desees.</span>
                  </div>
                  <div className="flex items-center gap-2">
                    <span className="text-sky-400 font-bold">✓</span>
                    <span><strong>Permisos seguros:</strong> Solo lectura y trading; retiros bloqueados por API.</span>
                  </div>
                  <div className="flex items-center gap-2">
                    <span className="text-sky-400 font-bold">✓</span>
                    <span><strong>Monitoreo en vivo:</strong> Visualiza tus trades desde tu PC o teléfono.</span>
                  </div>
                </div>
              </div>

              <div className="pt-4 border-t border-slate-800">
                <button
                  type="button"
                  onClick={() => onOpenRegister && onOpenRegister(simCapital)}
                  className="w-full py-3 bg-gradient-to-r from-sky-400 to-blue-500 hover:from-sky-300 hover:to-blue-400 text-slate-950 font-black text-xs rounded-xl shadow-lg shadow-sky-500/20 transition flex items-center justify-center gap-2"
                >
                  <span>Conectar Cuenta de Copy-Trading</span>
                  <span>→</span>
                </button>
              </div>
            </Tilt3DCard>

          </div>

        </div>
      </section>

      {/* =========================================================================
          4. MOTORES ALGORÍTMICOS (VISUAL Y ULTRA CONCISO)
         ========================================================================= */}
      <section id="algoritmos" className="py-20 relative z-10 border-t border-slate-900">
        <div className="max-w-6xl mx-auto px-4 sm:px-6 lg:px-8">
          
          <div className="text-center max-w-2xl mx-auto mb-12">
            <span className="px-3 py-1 rounded-full bg-blue-500/10 border border-blue-500/30 text-blue-400 text-xs font-mono font-bold uppercase">
              🧠 TECNOLOGÍA EN PRODUCCIÓN
            </span>
            <h2 className="text-3xl sm:text-4xl font-black text-white tracking-tight mt-3 mb-2">
              4 Motores Cuantitativos de Alta Precisión
            </h2>
            <p className="text-xs sm:text-sm text-slate-400">
              Reglas matemáticas comprobadas que sustituyen la intuición y el azar.
            </p>
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
            
            <div className="p-5 rounded-2xl bg-slate-900/70 border border-slate-800 hover:border-cyan-500/40 transition">
              <div className="text-2xl mb-2">📈</div>
              <h4 className="text-sm font-bold text-white mb-1">RSI Multi-Marco & Divergencias</h4>
              <p className="text-[11px] text-slate-400 leading-relaxed">
                Escaneo sincronizado en 1m, 5m y 15m. Entradas de alta probabilidad en zonas extremas de agotamiento.
              </p>
            </div>

            <div className="p-5 rounded-2xl bg-slate-900/70 border border-slate-800 hover:border-sky-500/40 transition">
              <div className="text-2xl mb-2">🔄</div>
              <h4 className="text-sm font-bold text-white mb-1">DCA Geométrico de 3 Niveles</h4>
              <p className="text-[11px] text-slate-400 leading-relaxed">
                Rebaja el precio promedio en retrocesos para salir en ganancia rápida sin sobreexponer el balance.
              </p>
            </div>

            <div className="p-5 rounded-2xl bg-slate-900/70 border border-slate-800 hover:border-blue-500/40 transition">
              <div className="text-2xl mb-2">🛡️</div>
              <h4 className="text-sm font-bold text-white mb-1">Trailing Stop Blindado</h4>
              <p className="text-[11px] text-slate-400 leading-relaxed">
                Doble protección: órdenes condicionales nativas en Binance + guardián VPS para cierres por mercado en milisegundos.
              </p>
            </div>

            <div className="p-5 rounded-2xl bg-slate-900/70 border border-slate-800 hover:border-indigo-500/40 transition">
              <div className="text-2xl mb-2">⚡</div>
              <h4 className="text-sm font-bold text-white mb-1">Escudo Anti-Crash de BTC</h4>
              <p className="text-[11px] text-slate-400 leading-relaxed">
                Congela automáticamente nuevas compras si Bitcoin sufre un colapso brusco, preservando saldo en USDT.
              </p>
            </div>

          </div>

        </div>
      </section>

      {/* =========================================================================
          5. SIMULADOR INTERACTIVO CONCISO Y VISUAL
         ========================================================================= */}
      <section id="simulador" className="py-20 relative z-10 border-t border-slate-900 bg-slate-900/30">
        <div className="max-w-5xl mx-auto px-4 sm:px-6 lg:px-8">
          
          <div className="text-center max-w-2xl mx-auto mb-10">
            <span className="px-3 py-1 rounded-full bg-cyan-500/10 border border-cyan-500/30 text-cyan-400 text-xs font-mono font-bold uppercase">
              📊 CALCULADORA
            </span>
            <h2 className="text-3xl sm:text-4xl font-black text-white tracking-tight mt-3 mb-2">
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
                  <div className="flex justify-between gap-1.5 mt-2">
                    {[1000, 2500, 5000, 10000, 25000].map((amt) => (
                      <button
                        key={amt}
                        type="button"
                        onClick={() => setSimCapital(amt)}
                        className={`px-2 py-0.5 text-[10px] font-mono rounded border transition ${
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
          6. SEGURIDAD Y INFRAESTRUCTURA (3 PILARES CONCISOS)
         ========================================================================= */}
      <section id="seguridad" className="py-20 relative z-10 border-t border-slate-900">
        <div className="max-w-6xl mx-auto px-4 sm:px-6 lg:px-8">
          
          <div className="text-center max-w-2xl mx-auto mb-12">
            <span className="px-3 py-1 rounded-full bg-blue-500/10 border border-blue-500/30 text-blue-400 text-xs font-mono font-bold uppercase">
              🛡️ GARANTÍA DE SEGURIDAD
            </span>
            <h2 className="text-3xl sm:text-4xl font-black text-white tracking-tight mt-3 mb-2">
              Infraestructura y Soberanía
            </h2>
            <p className="text-xs sm:text-sm text-slate-400">
              Protección de datos y arquitectura sin custodia de fondos.
            </p>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
            <div className="p-6 rounded-2xl bg-slate-900/60 border border-slate-800">
              <div className="text-2xl text-cyan-400 mb-2">🔒</div>
              <h4 className="text-sm font-bold text-white mb-1">Cero Custodia de Criptomonedas</h4>
              <p className="text-xs text-slate-400 leading-relaxed">
                Tus activos nunca salen de Binance. Las claves API operan con retiros estrictamente deshabilitados.
              </p>
            </div>

            <div className="p-6 rounded-2xl bg-slate-900/60 border border-slate-800">
              <div className="text-2xl text-sky-400 mb-2">🗄️</div>
              <h4 className="text-sm font-bold text-white mb-1">Base de Datos PostgreSQL 16</h4>
              <p className="text-xs text-slate-400 leading-relaxed">
                Reconciliación matemática en cada ciclo para evitar discrepancias de balance y trades duplicados.
              </p>
            </div>

            <div className="p-6 rounded-2xl bg-slate-900/60 border border-slate-800">
              <div className="text-2xl text-blue-400 mb-2">☁️</div>
              <h4 className="text-sm font-bold text-white mb-1">Hetzner Cloud Dedicado</h4>
              <p className="text-xs text-slate-400 leading-relaxed">
                Servidor privado en Europa con latencia inferior a 12 ms directa a los centros de datos de Binance.
              </p>
            </div>
          </div>

        </div>
      </section>

      {/* =========================================================================
          7. BANNER CTA FINAL
         ========================================================================= */}
      <section className="py-16 relative z-10">
        <div className="max-w-4xl mx-auto px-4 sm:px-6 lg:px-8">
          <div className="rounded-3xl p-8 sm:p-12 bg-gradient-to-r from-blue-950/80 via-slate-900 to-cyan-950/80 border border-cyan-500/40 text-center shadow-2xl">
            <h2 className="text-2xl sm:text-4xl font-black text-white tracking-tight mb-3">
              ¿Listo para Automatizar Tus Inversiones?
            </h2>
            <p className="text-xs sm:text-sm text-slate-300 max-w-xl mx-auto mb-6">
              Solicita tu acceso al Fondo Mancomunado o conecta tu cuenta privada de Copy-Trading.
            </p>
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
          8. MODAL INTERACTIVO PARA ELEGIR EL LOGO
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
                Elige el Logo Oficial para el Proyecto
              </h3>
              <p className="text-xs text-slate-400 mt-1">
                Haz clic en la opción que más te guste para aplicarla inmediatamente en toda la página.
              </p>
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              {LOGO_OPTIONS.map((opt) => {
                const Icon = opt.Component;
                const isSelected = selectedLogoId === opt.id;
                return (
                  <button
                    key={opt.id}
                    type="button"
                    onClick={() => {
                      setSelectedLogoId(opt.id);
                      setShowLogoModal(false);
                    }}
                    className={`p-4 rounded-2xl border text-left transition flex items-start gap-4 ${
                      isSelected
                        ? 'bg-cyan-950/60 border-cyan-400 ring-2 ring-cyan-400/30 shadow-lg'
                        : 'bg-slate-950/60 border-slate-800 hover:border-slate-700'
                    }`}
                  >
                    <div className="shrink-0 p-2 rounded-xl bg-slate-900 border border-slate-800">
                      <Icon size={46} />
                    </div>
                    <div className="min-w-0">
                      <div className="flex items-center gap-1.5">
                        <span className="text-xs font-extrabold text-white truncate">{opt.name}</span>
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
          9. FOOTER OFICIAL CON WTN SOLUTIONS LLC (DESCARGO REGULATORIO Y LEGAL)
         ========================================================================= */}
      <footer className="bg-slate-950 border-t border-slate-900 pt-14 pb-10 relative z-10 text-xs text-slate-400">
        <div className="max-w-6xl mx-auto px-4 sm:px-6 lg:px-8">
          
          <div className="grid grid-cols-1 md:grid-cols-4 gap-8 mb-10">
            
            {/* EMPRESA LEGAL */}
            <div className="md:col-span-2 space-y-3">
              <div className="flex items-center gap-2">
                <CurrentLogoComponent size={28} />
                <span className="text-base font-black text-white">
                  WTN SOLUTIONS LLC
                </span>
              </div>
              <p className="text-xs text-slate-400 leading-relaxed max-w-sm">
                Empresa especializada en software financiero cuantitativo y tecnología algorítmica para mercados de derivados.
              </p>
              <div className="text-[11px] text-slate-500">
                División Tecnológica: <span className="text-slate-300 font-semibold">WTN ALGO-TRADING</span>
              </div>
            </div>

            {/* PRODUCTOS */}
            <div className="space-y-1.5">
              <div className="text-xs font-bold text-white uppercase tracking-wider mb-2">Productos</div>
              <div><a href="#productos" className="hover:text-cyan-400 transition">Fondo Mancomunado</a></div>
              <div><a href="#productos" className="hover:text-cyan-400 transition">Copy-Trading Binance</a></div>
              <div><a href="#simulador" className="hover:text-cyan-400 transition">Simulador de Inversión</a></div>
              <div><a href="#seguridad" className="hover:text-cyan-400 transition">Garantía Non-Custodial</a></div>
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
              <strong className="text-slate-400 uppercase">Descargo de Responsabilidad de Riesgo:</strong> El trading de futuros de criptomonedas implica un riesgo financiero sustancial y no es adecuado para todos los perfiles de inversor. Rendimientos pasados o simulados no garantizan resultados futuros.
            </p>
            <p>
              <strong className="text-slate-400">WTN Solutions LLC</strong> provee soluciones de automatización tecnológica y algoritmos de trading. No constituye asesoramiento financiero ni gestión directa de fondos de terceros. La custodia de fondos en Copy-Trading permanece siempre en la cuenta individual de Binance del cliente.
            </p>
          </div>

          {/* COPYRIGHT */}
          <div className="mt-6 pt-4 border-t border-slate-900 flex flex-col sm:flex-row items-center justify-between gap-3 text-[11px] text-slate-400">
            <div>
              &copy; {new Date().getFullYear()} <strong className="text-slate-400">WTN Solutions LLC</strong>. Todos los derechos reservados.
            </div>
            <div>
              WTN ALGO-TRADING™ • Binance Futures
            </div>
          </div>

        </div>
      </footer>

    </div>
  );
}
