import React, { useState, useEffect, useRef } from 'react';
import Trading3DScene from './Trading3DScene';

/**
 * Tilt3DCard
 * Tarjeta interactiva con efecto de inclinación 3D (3D Tilt) y resplandor de cursor dinámico.
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

    const rotateX = ((y - centerY) / centerY) * -10;
    const rotateY = ((x - centerX) / centerX) * 10;

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
      {/* Reflejo / Glare que sigue al cursor */}
      <div
        className="pointer-events-none absolute inset-0 z-10 transition-opacity duration-300"
        style={{
          opacity: glareStyle.opacity,
          background: `radial-gradient(circle 280px at ${glareStyle.x} ${glareStyle.y}, rgba(0, 240, 255, 0.15), transparent 70%)`,
        }}
      />
      {children}
    </div>
  );
}

export default function LandingPage({ onOpenLogin, onOpenRegister }) {
  // Simulador interactivo de inversión
  const [simCapital, setSimCapital] = useState(5000);
  const [simProfile, setSimProfile] = useState('v21'); // 'conservative', 'v21', 'aggressive'

  // FAQ Accordion
  const [openFaq, setOpenFaq] = useState(0);

  // Menú móvil
  const [mobileMenuOpen, setMobileMenuOpen] = useState(false);

  // Cálculos dinámicos del simulador
  const profileMultipliers = {
    conservative: {
      label: 'Estrategia de Preservación (DCA Suave)',
      leverage: '3x - 5x',
      targetMonthlyMin: 4.5,
      targetMonthlyMax: 8.5,
      maxDrawdown: '< 4.5%',
      maxCoins: 6,
      dcaOrders: '2 Niveles',
      riskDesc: 'Prioridad absoluta en contención de riesgo y drawdown mínimo.',
    },
    v21: {
      label: 'Estrategia V21 Soberana (Institucional)',
      leverage: '5x - 7x',
      targetMonthlyMin: 8.0,
      targetMonthlyMax: 16.0,
      maxDrawdown: '< 7.5%',
      maxCoins: 10,
      dcaOrders: '3 Niveles',
      riskDesc: 'Equilibrio matemático óptimo con RSI multidimensional y rebote dinámico.',
    },
    aggressive: {
      label: 'Cuantitativa Agresiva Tolerante',
      leverage: '7x - 10x',
      targetMonthlyMin: 14.0,
      targetMonthlyMax: 26.0,
      maxDrawdown: '< 12.0%',
      maxCoins: 12,
      dcaOrders: '4 Niveles',
      riskDesc: 'Mayor rotación de capital y captura acelerada de volatilidad.',
    },
  };

  const activeMultiplier = profileMultipliers[simProfile];
  const estMonthlyMinUSDT = (simCapital * (activeMultiplier.targetMonthlyMin / 100)).toFixed(0);
  const estMonthlyMaxUSDT = (simCapital * (activeMultiplier.targetMonthlyMax / 100)).toFixed(0);

  // Tickers simulados en vivo
  const tickerItems = [
    { pair: 'BTC/USDT', price: '68,420.50', change: '+3.14%', status: 'LONG' },
    { pair: 'ETH/USDT', price: '2,640.80', change: '+2.85%', status: 'LONG' },
    { pair: 'SOL/USDT', price: '184.25', change: '+6.42%', status: 'MONITOREO' },
    { pair: 'BNB/USDT', price: '592.10', change: '+1.90%', status: 'LONG' },
    { pair: 'XRP/USDT', price: '0.5482', change: '+4.12%', status: 'LONG' },
    { pair: 'AVAX/USDT', price: '28.65', change: '+5.30%', status: 'DCA ACTIVO' },
    { pair: 'DOGE/USDT', price: '0.1420', change: '+8.10%', status: 'MONITOREO' },
    { pair: 'LINK/USDT', price: '12.45', change: '+3.70%', status: 'LONG' },
  ];

  return (
    <div className="min-h-screen bg-slate-950 text-slate-100 selection:bg-cyan-500 selection:text-slate-950 font-sans overflow-x-hidden">
      
      {/* =========================================================================
          1. HEADER / NAVEGACIÓN PRINCIPAL
         ========================================================================= */}
      <header className="fixed top-0 left-0 right-0 z-50 bg-slate-950/80 backdrop-blur-xl border-b border-cyan-500/20 shadow-lg shadow-cyan-950/30">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 h-20 flex items-center justify-between">
          
          {/* LOGO OFICIAL WTN ALGO-TRADING */}
          <div className="flex items-center gap-3">
            <div className="relative flex items-center justify-center w-11 h-11 rounded-2xl bg-gradient-to-br from-cyan-400 via-sky-500 to-blue-600 p-[1px] shadow-lg shadow-cyan-500/20">
              <div className="w-full h-full bg-slate-950 rounded-2xl flex items-center justify-center">
                <span className="text-xl">⚡</span>
              </div>
              <span className="absolute -top-1 -right-1 w-3 h-3 bg-cyan-400 rounded-full animate-ping opacity-75" />
              <span className="absolute -top-1 -right-1 w-3 h-3 bg-cyan-400 rounded-full" />
            </div>

            <div>
              <div className="flex items-center gap-2">
                <span className="text-lg sm:text-xl font-black tracking-tight text-white">
                  WTN <span className="bg-gradient-to-r from-cyan-400 via-sky-300 to-blue-400 bg-clip-text text-transparent">ALGO-TRADING</span>
                </span>
                <span className="hidden sm:inline-block px-2 py-0.5 text-[10px] font-mono font-bold uppercase rounded-md bg-cyan-500/10 text-cyan-400 border border-cyan-500/30">
                  BINANCE FUTURES
                </span>
              </div>
              <div className="text-[10px] font-semibold text-slate-400 uppercase tracking-widest">
                WTN SOLUTIONS LLC • QUANT DIVISION
              </div>
            </div>
          </div>

          {/* ENLACES DE ESCRITORIO */}
          <nav className="hidden lg:flex items-center gap-7 text-xs font-semibold text-slate-300">
            <a href="#algoritmos" className="hover:text-cyan-400 transition-colors">Algoritmos Cuantitativos</a>
            <a href="#estrategias" className="hover:text-cyan-400 transition-colors">Estrategias & Rendimiento</a>
            <a href="#simulador" className="hover:text-cyan-400 transition-colors">Calculadora de Inversión</a>
            <a href="#seguridad" className="hover:text-cyan-400 transition-colors">Seguridad Non-Custodial</a>
            <a href="#faq" className="hover:text-cyan-400 transition-colors">Preguntas Frecuentes</a>
          </nav>

          {/* BOTONES DE ACCIÓN (INICIAR SESIÓN / SOLICITAR INVERSIÓN) */}
          <div className="hidden sm:flex items-center gap-3">
            <button
              type="button"
              onClick={() => onOpenLogin && onOpenLogin()}
              className="px-4 py-2 text-xs font-bold text-slate-200 hover:text-white bg-slate-900/90 hover:bg-slate-800 border border-slate-700 hover:border-cyan-500/50 rounded-xl transition-all shadow-sm"
            >
              Iniciar Sesión
            </button>

            <button
              type="button"
              onClick={() => onOpenRegister && onOpenRegister(simCapital)}
              className="relative group px-5 py-2.5 text-xs font-extrabold text-slate-950 bg-gradient-to-r from-cyan-400 via-sky-300 to-cyan-300 hover:from-cyan-300 hover:to-sky-200 rounded-xl shadow-lg shadow-cyan-500/25 transition-all hover:scale-105 active:scale-95 flex items-center gap-2"
            >
              <span>Solicitar Inversión</span>
              <span className="group-hover:translate-x-0.5 transition-transform">→</span>
            </button>
          </div>

          {/* BOTÓN HAMBURGUESA MÓVIL */}
          <div className="flex sm:hidden items-center gap-2">
            <button
              type="button"
              onClick={() => onOpenLogin && onOpenLogin()}
              className="px-3 py-1.5 text-[11px] font-bold bg-slate-800 border border-slate-700 rounded-lg text-slate-200"
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
              href="#algoritmos"
              onClick={() => setMobileMenuOpen(false)}
              className="block text-sm font-semibold text-slate-300 py-2 border-b border-slate-800"
            >
              Algoritmos Cuantitativos
            </a>
            <a
              href="#estrategias"
              onClick={() => setMobileMenuOpen(false)}
              className="block text-sm font-semibold text-slate-300 py-2 border-b border-slate-800"
            >
              Estrategias & Rendimiento
            </a>
            <a
              href="#simulador"
              onClick={() => setMobileMenuOpen(false)}
              className="block text-sm font-semibold text-slate-300 py-2 border-b border-slate-800"
            >
              Calculadora de Inversión
            </a>
            <a
              href="#seguridad"
              onClick={() => setMobileMenuOpen(false)}
              className="block text-sm font-semibold text-slate-300 py-2 border-b border-slate-800"
            >
              Seguridad Non-Custodial
            </a>
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
      <section className="relative min-h-[92vh] pt-32 pb-20 flex flex-col justify-center overflow-hidden">
        
        {/* ESCENA 3D DE FONDO */}
        <div className="absolute inset-0 z-0 opacity-80 sm:opacity-95">
          <Trading3DScene />
        </div>

        {/* CONTENIDO SUPERPUESTO HERO */}
        <div className="relative z-10 max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 text-center flex flex-col items-center">
          
          {/* BADGE DE ESTADO INSTITUCIONAL */}
          <div className="inline-flex items-center gap-2 px-3.5 py-1.5 rounded-full bg-cyan-950/70 border border-cyan-400/40 text-cyan-300 text-xs font-mono font-bold tracking-wide shadow-lg shadow-cyan-500/10 mb-8 backdrop-blur-md">
            <span className="w-2 h-2 rounded-full bg-cyan-400 animate-pulse" />
            <span>ALGORITMOS 24/7 EN VIVO • LATENCIA DIRECTA &lt; 12MS</span>
            <span className="text-slate-400">|</span>
            <span className="text-slate-200">BINANCE FUTURES U-MARGINED</span>
          </div>

          {/* TITULAR PRINCIPAL DE ALTO IMPACTO */}
          <h1 className="text-4xl sm:text-6xl lg:text-7xl font-black tracking-tight text-white max-w-5xl leading-[1.08] mb-6">
            PRECISIÓN CUANTITATIVA{' '}
            <span className="bg-gradient-to-r from-cyan-400 via-sky-300 to-blue-500 bg-clip-text text-transparent">
              ALGORÍTMICA 24/7
            </span>{' '}
            EN DERIVADOS
          </h1>

          {/* DESCRIPCIÓN INSTITUCIONAL */}
          <p className="text-base sm:text-lg lg:text-xl text-slate-300 max-w-3xl font-normal leading-relaxed mb-10">
            Diseñado por <strong className="text-white font-semibold">WTN Solutions LLC</strong> para operar los mercados de futuros sin emociones ni fatiga humana. Combinamos reversión a la media mediante <strong className="text-cyan-400 font-semibold">RSI Multidimensional</strong>, escalado geométrico <strong className="text-cyan-400 font-semibold">DCA Inteligente</strong> y gestión matemática de riesgo en tiempo real.
          </p>

          {/* BOTONES CTA PRINCIPALES */}
          <div className="flex flex-col sm:flex-row items-center gap-4 w-full sm:w-auto mb-16">
            <button
              type="button"
              onClick={() => onOpenRegister && onOpenRegister(simCapital)}
              className="w-full sm:w-auto px-8 py-4 bg-gradient-to-r from-cyan-400 via-sky-400 to-blue-500 hover:from-cyan-300 hover:to-blue-400 text-slate-950 font-black text-sm rounded-2xl shadow-xl shadow-cyan-500/30 transition-all hover:scale-105 active:scale-95 flex items-center justify-center gap-3"
            >
              <span>🚀 Enviar Solicitud de Inversión</span>
            </button>

            <button
              type="button"
              onClick={() => onOpenLogin && onOpenLogin()}
              className="w-full sm:w-auto px-7 py-4 bg-slate-900/90 hover:bg-slate-800 text-white font-bold text-sm rounded-2xl border border-slate-700 hover:border-cyan-400/60 shadow-lg shadow-black/40 transition-all hover:scale-105 active:scale-95 flex items-center justify-center gap-2.5 backdrop-blur-md"
            >
              <span>🔐 Acceso Clientes / Iniciar Sesión</span>
            </button>
          </div>

          {/* METRICAS CLAVE INSTITUCIONALES (KPI RIBBON) */}
          <div className="grid grid-cols-2 md:grid-cols-4 gap-3 sm:gap-6 w-full max-w-4xl">
            <div className="p-4 sm:p-5 rounded-2xl bg-slate-900/60 border border-slate-800/80 backdrop-blur-md hover:border-cyan-500/40 transition-all text-center">
              <div className="text-2xl sm:text-3xl font-black text-cyan-400 font-mono">99.98%</div>
              <div className="text-xs text-slate-400 font-medium mt-1">Uptime Servidor Hetzner</div>
            </div>

            <div className="p-4 sm:p-5 rounded-2xl bg-slate-900/60 border border-slate-800/80 backdrop-blur-md hover:border-cyan-500/40 transition-all text-center">
              <div className="text-2xl sm:text-3xl font-black text-sky-400 font-mono">&lt; 12ms</div>
              <div className="text-xs text-slate-400 font-medium mt-1">Latencia a Binance Futures</div>
            </div>

            <div className="p-4 sm:p-5 rounded-2xl bg-slate-900/60 border border-slate-800/80 backdrop-blur-md hover:border-cyan-500/40 transition-all text-center">
              <div className="text-2xl sm:text-3xl font-black text-emerald-400 font-mono">100%</div>
              <div className="text-xs text-slate-400 font-medium mt-1">Seguridad Non-Custodial</div>
            </div>

            <div className="p-4 sm:p-5 rounded-2xl bg-slate-900/60 border border-slate-800/80 backdrop-blur-md hover:border-cyan-500/40 transition-all text-center">
              <div className="text-2xl sm:text-3xl font-black text-blue-400 font-mono">24/7/365</div>
              <div className="text-xs text-slate-400 font-medium mt-1">Ejecución Automatizada</div>
            </div>
          </div>

        </div>

        {/* CINTA DE TICKERS EN TIEMPO REAL */}
        <div className="mt-16 w-full overflow-hidden border-y border-slate-800/80 bg-slate-950/70 backdrop-blur-md py-3">
          <div className="flex gap-8 whitespace-nowrap animate-marquee">
            {tickerItems.concat(tickerItems).map((item, index) => (
              <div key={index} className="inline-flex items-center gap-2.5 text-xs font-mono">
                <span className="font-bold text-slate-200">{item.pair}</span>
                <span className="text-slate-400">${item.price}</span>
                <span className="text-emerald-400 font-bold">{item.change}</span>
                <span className="px-1.5 py-0.5 rounded text-[10px] bg-cyan-950 text-cyan-300 border border-cyan-800">
                  {item.status}
                </span>
              </div>
            ))}
          </div>
        </div>

      </section>

      {/* =========================================================================
          3. MOTORES ALGORÍTMICOS CUANTITATIVOS (3D TILT CARDS)
         ========================================================================= */}
      <section id="algoritmos" className="py-24 relative z-10 border-t border-slate-900">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
          
          <div className="text-center max-w-3xl mx-auto mb-16">
            <div className="inline-flex items-center gap-2 px-3 py-1 rounded-full bg-blue-500/10 border border-blue-500/30 text-blue-400 text-xs font-mono font-bold uppercase tracking-wider mb-4">
              <span>🧠 ARQUITECTURA DEL SISTEMA</span>
            </div>
            <h2 className="text-3xl sm:text-5xl font-black text-white tracking-tight mb-4">
              Ingeniería Cuantitativa de Grado Institucional
            </h2>
            <p className="text-sm sm:text-base text-slate-400 leading-relaxed">
              En lugar de predicciones especulativas, WTN ALGO-TRADING opera con probabilidades matemáticas respaldadas por microestructura de mercado, control de liquidez y gestión estricta de apalancamiento.
            </p>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-6">
            
            {/* MOTOR 01 */}
            <Tilt3DCard className="bg-gradient-to-b from-slate-900/90 to-slate-950/90 border border-cyan-500/30 p-7 shadow-xl shadow-cyan-950/20">
              <div className="w-14 h-14 rounded-2xl bg-cyan-500/10 border border-cyan-500/30 flex items-center justify-center text-2xl text-cyan-400 mb-6">
                📈
              </div>
              <div className="text-[11px] font-mono font-bold text-cyan-400 uppercase tracking-widest mb-1">
                Motor 01 • Reversión Dinámica
              </div>
              <h3 className="text-lg font-black text-white mb-3">
                RSI Multi-Marco & Divergencias
              </h3>
              <p className="text-xs text-slate-300 leading-relaxed mb-4">
                Escaneo concurrente en velas de 1m, 5m y 15m. Identifica zonas extremas de agotamiento de oferta y demanda con confirmación de volumen y divergencias ocultas.
              </p>
              <div className="text-[11px] font-mono text-slate-400 pt-4 border-t border-slate-800/80 flex items-center justify-between">
                <span>Precisión de Entrada:</span>
                <span className="text-cyan-300 font-bold">Filtro de Ruido 9x</span>
              </div>
            </Tilt3DCard>

            {/* MOTOR 02 */}
            <Tilt3DCard className="bg-gradient-to-b from-slate-900/90 to-slate-950/90 border border-sky-500/30 p-7 shadow-xl shadow-sky-950/20">
              <div className="w-14 h-14 rounded-2xl bg-sky-500/10 border border-sky-500/30 flex items-center justify-center text-2xl text-sky-400 mb-6">
                🔄
              </div>
              <div className="text-[11px] font-mono font-bold text-sky-400 uppercase tracking-widest mb-1">
                Motor 02 • Escalado Seguro
              </div>
              <h3 className="text-lg font-black text-white mb-3">
                DCA Geométrico Inteligente
              </h3>
              <p className="text-xs text-slate-300 leading-relaxed mb-4">
                Hasta 3 niveles de Dollar Cost Averaging programado. Distribuye compras a intervalos matemáticos con multiplicador progresivo para reducir el precio promedio y salir en ganancia rápida.
              </p>
              <div className="text-[11px] font-mono text-slate-400 pt-4 border-t border-slate-800/80 flex items-center justify-between">
                <span>Reducción de Drawdown:</span>
                <span className="text-sky-300 font-bold">Hasta -65%</span>
              </div>
            </Tilt3DCard>

            {/* MOTOR 03 */}
            <Tilt3DCard className="bg-gradient-to-b from-slate-900/90 to-slate-950/90 border border-blue-500/30 p-7 shadow-xl shadow-blue-950/20">
              <div className="w-14 h-14 rounded-2xl bg-blue-500/10 border border-blue-500/30 flex items-center justify-center text-2xl text-blue-400 mb-6">
                🛡️
              </div>
              <div className="text-[11px] font-mono font-bold text-blue-400 uppercase tracking-widest mb-1">
                Motor 03 • Salidas Blindadas
              </div>
              <h3 className="text-lg font-black text-white mb-3">
                Trailing Stop & TP/SL Doble
              </h3>
              <p className="text-xs text-slate-300 leading-relaxed mb-4">
                Protección dual: órdenes condicionales nativas en Binance Futures respaldadas por un guardián de software en el servidor que cierra por mercado en milisegundos si se alcanza el objetivo.
              </p>
              <div className="text-[11px] font-mono text-slate-400 pt-4 border-t border-slate-800/80 flex items-center justify-between">
                <span>Nivel de Protección:</span>
                <span className="text-blue-300 font-bold">Doble Capa Exchange + VPS</span>
              </div>
            </Tilt3DCard>

            {/* MOTOR 04 */}
            <Tilt3DCard className="bg-gradient-to-b from-slate-900/90 to-slate-950/90 border border-indigo-500/30 p-7 shadow-xl shadow-indigo-950/20">
              <div className="w-14 h-14 rounded-2xl bg-indigo-500/10 border border-indigo-500/30 flex items-center justify-center text-2xl text-indigo-400 mb-6">
                ⚡
              </div>
              <div className="text-[11px] font-mono font-bold text-indigo-400 uppercase tracking-widest mb-1">
                Motor 04 • Resguardo Macro
              </div>
              <h3 className="text-lg font-black text-white mb-3">
                Escudo Anti-Crash de BTC
              </h3>
              <p className="text-xs text-slate-300 leading-relaxed mb-4">
                Monitorea en tiempo real las caídas sistémicas en Bitcoin y la volatilidad macro. Si detecta un colapso súbito del mercado, suspende inmediatamente nuevas entradas para preservar capital en USDT.
              </p>
              <div className="text-[11px] font-mono text-slate-400 pt-4 border-t border-slate-800/80 flex items-center justify-between">
                <span>Activación Automática:</span>
                <span className="text-indigo-300 font-bold">Tiempo Real 24/7</span>
              </div>
            </Tilt3DCard>

          </div>

        </div>
      </section>

      {/* =========================================================================
          4. FLUJO DE INVERSIÓN NON-CUSTODIAL (CÓMO FUNCIONA PARA CLIENTES)
         ========================================================================= */}
      <section id="estrategias" className="py-24 bg-slate-900/40 relative z-10 border-t border-slate-900">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
          
          <div className="text-center max-w-3xl mx-auto mb-16">
            <div className="inline-flex items-center gap-2 px-3 py-1 rounded-full bg-cyan-500/10 border border-cyan-500/30 text-cyan-400 text-xs font-mono font-bold uppercase tracking-wider mb-4">
              <span>💼 MODELO INSTITUCIONAL NON-CUSTODIAL</span>
            </div>
            <h2 className="text-3xl sm:text-5xl font-black text-white tracking-tight mb-4">
              Tus Fondos Siempre en Tu Poder
            </h2>
            <p className="text-sm sm:text-base text-slate-400 leading-relaxed">
              En <strong className="text-white">WTN Solutions LLC</strong> la transparencia es innegociable. No custodiamos tus criptomonedas ni tenemos acceso a tus fondos. El bot opera en tu propia cuenta de Binance mediante API restringida.
            </p>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-4 gap-8 relative">
            
            {/* PASO 1 */}
            <div className="relative p-6 rounded-3xl bg-slate-900/80 border border-slate-800 hover:border-cyan-500/40 transition-all flex flex-col justify-between">
              <div>
                <div className="text-3xl font-black text-cyan-400 font-mono mb-4">01</div>
                <h3 className="text-base font-bold text-white mb-2">Solicitud de Inversión</h3>
                <p className="text-xs text-slate-400 leading-relaxed">
                  Completas el formulario de registro con tus datos de contacto, monto inicial proyectado y tu código de invitación verificado.
                </p>
              </div>
              <div className="mt-6 pt-4 border-t border-slate-800 text-[11px] font-mono text-cyan-400">
                Fase de Admisión Privada
              </div>
            </div>

            {/* PASO 2 */}
            <div className="relative p-6 rounded-3xl bg-slate-900/80 border border-slate-800 hover:border-cyan-500/40 transition-all flex flex-col justify-between">
              <div>
                <div className="text-3xl font-black text-sky-400 font-mono mb-4">02</div>
                <h3 className="text-base font-bold text-white mb-2">Aprobación Institucional</h3>
                <p className="text-xs text-slate-400 leading-relaxed">
                  Nuestro comité de administración evalúa y autoriza tu cuenta en el servidor de trading soberano, activando tu perfil de inversor.
                </p>
              </div>
              <div className="mt-6 pt-4 border-t border-slate-800 text-[11px] font-mono text-sky-400">
                Verificación Soberana
              </div>
            </div>

            {/* PASO 3 */}
            <div className="relative p-6 rounded-3xl bg-slate-900/80 border border-slate-800 hover:border-cyan-500/40 transition-all flex flex-col justify-between">
              <div>
                <div className="text-3xl font-black text-blue-400 font-mono mb-4">03</div>
                <h3 className="text-base font-bold text-white mb-2">Conexión API Segura</h3>
                <p className="text-xs text-slate-400 leading-relaxed">
                  Ingresas tus llaves API de Binance Futures con permisos únicos de lectura y órdenes. <span className="text-emerald-400 font-bold">Retiros 100% bloqueados</span>.
                </p>
              </div>
              <div className="mt-6 pt-4 border-t border-slate-800 text-[11px] font-mono text-blue-400">
                Cifrado Militar AES-256
              </div>
            </div>

            {/* PASO 4 */}
            <div className="relative p-6 rounded-3xl bg-slate-900/80 border border-slate-800 hover:border-cyan-500/40 transition-all flex flex-col justify-between">
              <div>
                <div className="text-3xl font-black text-emerald-400 font-mono mb-4">04</div>
                <h3 className="text-base font-bold text-white mb-2">Auditoría en Tiempo Real</h3>
                <p className="text-xs text-slate-400 leading-relaxed">
                  Accedes a tu panel interactivo desde cualquier PC o smartphone. Monitorea trades cerrados, PnL diario y retira tus ganancias cuando desees.
                </p>
              </div>
              <div className="mt-6 pt-4 border-t border-slate-800 text-[11px] font-mono text-emerald-400">
                Control Total & Retiros Libres
              </div>
            </div>

          </div>

          {/* BANNER INFORMATIVO DE CUSTODIA */}
          <div className="mt-12 p-6 rounded-3xl bg-cyan-950/30 border border-cyan-500/30 flex flex-col sm:flex-row items-center justify-between gap-6 backdrop-blur-md">
            <div className="flex items-center gap-4">
              <div className="w-12 h-12 rounded-2xl bg-cyan-500/20 text-cyan-300 flex items-center justify-center text-2xl font-bold shrink-0">
                🔒
              </div>
              <div>
                <h4 className="text-sm font-bold text-white">Garantía de Soberanía Financiera</h4>
                <p className="text-xs text-slate-400 mt-0.5">
                  WTN ALGO-TRADING nunca tiene acceso a retirar fondos ni transferirlos. Tus USDT permanecen 100% resguardados en tu wallet de Binance.
                </p>
              </div>
            </div>

            <button
              type="button"
              onClick={() => onOpenRegister && onOpenRegister(simCapital)}
              className="px-6 py-2.5 rounded-xl bg-cyan-400 hover:bg-cyan-300 text-slate-950 text-xs font-black shrink-0 transition shadow-lg shadow-cyan-500/20"
            >
              Comenzar Ahora
            </button>
          </div>

        </div>
      </section>

      {/* =========================================================================
          5. SIMULADOR CUANTITATIVO INTERACTIVO DE INVERSIÓN
         ========================================================================= */}
      <section id="simulador" className="py-24 relative z-10 border-t border-slate-900">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
          
          <div className="text-center max-w-3xl mx-auto mb-16">
            <div className="inline-flex items-center gap-2 px-3 py-1 rounded-full bg-cyan-500/10 border border-cyan-500/30 text-cyan-400 text-xs font-mono font-bold uppercase tracking-wider mb-4">
              <span>📊 PROYECCIÓN CUANTITATIVA</span>
            </div>
            <h2 className="text-3xl sm:text-5xl font-black text-white tracking-tight mb-4">
              Calculadora de Inversión & Desempeño
            </h2>
            <p className="text-sm sm:text-base text-slate-400 leading-relaxed">
              Explora cómo responde el motor de trading algorítmico según tu capital asignado y el perfil de riesgo seleccionado.
            </p>
          </div>

          <div className="max-w-5xl mx-auto bg-slate-900/80 border border-cyan-500/30 rounded-3xl p-6 sm:p-10 shadow-2xl shadow-cyan-950/30 backdrop-blur-xl">
            
            <div className="grid grid-cols-1 lg:grid-cols-12 gap-8 items-center">
              
              {/* LADO IZQUIERDO: CONTROLES DEL SIMULADOR */}
              <div className="lg:col-span-7 space-y-8">
                
                {/* CONTROL DE CAPITAL CON SLIDER */}
                <div>
                  <div className="flex items-center justify-between mb-3">
                    <label className="text-xs font-bold text-slate-300 uppercase tracking-wider">
                      Capital Inicial a Asignar (USDT)
                    </label>
                    <span className="text-2xl font-black text-cyan-400 font-mono">
                      ${simCapital.toLocaleString('en-US')} <span className="text-xs text-slate-400 font-normal">USDT</span>
                    </span>
                  </div>

                  <input
                    type="range"
                    min="1000"
                    max="50000"
                    step="500"
                    value={simCapital}
                    onChange={(e) => setSimCapital(Number(e.target.value))}
                    className="w-full h-2.5 bg-slate-800 rounded-lg appearance-none cursor-pointer accent-cyan-400"
                  />

                  {/* PRESETS RÁPIDOS */}
                  <div className="flex items-center justify-between gap-2 mt-3">
                    {[1000, 2500, 5000, 10000, 25000].map((amount) => (
                      <button
                        key={amount}
                        type="button"
                        onClick={() => setSimCapital(amount)}
                        className={`px-2.5 py-1 text-[11px] font-mono rounded-lg border transition ${
                          simCapital === amount
                            ? 'bg-cyan-500/20 border-cyan-400 text-cyan-300 font-bold'
                            : 'bg-slate-800/80 border-slate-700 text-slate-400 hover:text-white'
                        }`}
                      >
                        ${amount.toLocaleString()}
                      </button>
                    ))}
                  </div>
                </div>

                {/* SELECTOR DE PERFIL DE ESTRATEGIA */}
                <div>
                  <label className="block text-xs font-bold text-slate-300 uppercase tracking-wider mb-3">
                    Perfil de Estrategia Cuantitativa
                  </label>

                  <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
                    {[
                      { id: 'conservative', title: 'Conservador', badge: '3x - 5x' },
                      { id: 'v21', title: 'V21 Soberana', badge: '5x - 7x (Recomendado)' },
                      { id: 'aggressive', title: 'Agresivo', badge: '7x - 10x' },
                    ].map((p) => (
                      <button
                        key={p.id}
                        type="button"
                        onClick={() => setSimProfile(p.id)}
                        className={`p-3.5 rounded-2xl border text-left transition flex flex-col justify-between ${
                          simProfile === p.id
                            ? 'bg-cyan-950/50 border-cyan-400 text-white shadow-lg shadow-cyan-500/10'
                            : 'bg-slate-950/60 border-slate-800 text-slate-400 hover:border-slate-700'
                        }`}
                      >
                        <span className="text-xs font-bold text-white">{p.title}</span>
                        <span className="text-[10px] font-mono text-cyan-400 mt-1">{p.badge}</span>
                      </button>
                    ))}
                  </div>

                  <p className="text-xs text-slate-400 mt-3 italic">
                    ℹ️ {activeMultiplier.riskDesc}
                  </p>
                </div>

              </div>

              {/* LADO DERECHO: TARJETA DE RESULTADOS PROYECTADOS */}
              <div className="lg:col-span-5 bg-gradient-to-br from-slate-950 to-slate-900 border border-cyan-500/40 rounded-3xl p-6 sm:p-7 shadow-xl">
                
                <div className="text-[11px] font-mono text-cyan-400 font-bold uppercase tracking-wider mb-1">
                  Proyección Estimada Mensual
                </div>
                
                <div className="text-3xl sm:text-4xl font-black text-white font-mono mt-1 mb-2">
                  +${estMonthlyMinUSDT} <span className="text-slate-400 text-lg font-normal">a</span> +${estMonthlyMaxUSDT}
                  <span className="text-xs text-emerald-400 font-normal block mt-0.5">
                    ({activeMultiplier.targetMonthlyMin}% - {activeMultiplier.targetMonthlyMax}% Estimado / mes)
                  </span>
                </div>

                <div className="space-y-3 pt-4 border-t border-slate-800/80 text-xs">
                  <div className="flex items-center justify-between text-slate-300">
                    <span>Drawdown Máx. Estimado:</span>
                    <span className="font-mono font-bold text-emerald-400">{activeMultiplier.maxDrawdown}</span>
                  </div>
                  <div className="flex items-center justify-between text-slate-300">
                    <span>Pares Cripto en Simultáneo:</span>
                    <span className="font-mono font-bold text-white">Hasta {activeMultiplier.maxCoins} pares</span>
                  </div>
                  <div className="flex items-center justify-between text-slate-300">
                    <span>Niveles de DCA:</span>
                    <span className="font-mono font-bold text-sky-400">{activeMultiplier.dcaOrders}</span>
                  </div>
                  <div className="flex items-center justify-between text-slate-300">
                    <span>Apalancamiento Dinámico:</span>
                    <span className="font-mono font-bold text-amber-400">{activeMultiplier.leverage}</span>
                  </div>
                </div>

                <button
                  type="button"
                  onClick={() => onOpenRegister && onOpenRegister(simCapital)}
                  className="w-full mt-6 py-3.5 bg-gradient-to-r from-cyan-400 via-sky-400 to-blue-500 hover:from-cyan-300 hover:to-blue-400 text-slate-950 font-black text-xs rounded-xl shadow-lg shadow-cyan-500/20 transition-all hover:scale-105 active:scale-95 flex items-center justify-center gap-2"
                >
                  <span>🚀 Solicitar Inversión con ${simCapital.toLocaleString()} USDT</span>
                </button>

                <div className="text-[10px] text-slate-400 text-center mt-3">
                  * Las proyecciones matemáticas son estimaciones basadas en backtesting y rendimiento histórico.
                </div>

              </div>

            </div>

          </div>

        </div>
      </section>

      {/* =========================================================================
          6. INFRAESTRUCTURA Y SEGURIDAD INSTITUCIONAL
         ========================================================================= */}
      <section id="seguridad" className="py-24 bg-slate-900/30 relative z-10 border-t border-slate-900">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
          
          <div className="text-center max-w-3xl mx-auto mb-16">
            <div className="inline-flex items-center gap-2 px-3 py-1 rounded-full bg-blue-500/10 border border-blue-500/30 text-blue-400 text-xs font-mono font-bold uppercase tracking-wider mb-4">
              <span>🛡️ SEGURIDAD & BLINDAJE TECNOLÓGICO</span>
            </div>
            <h2 className="text-3xl sm:text-5xl font-black text-white tracking-tight mb-4">
              Protección de Datos & Soberanía de Capital
            </h2>
            <p className="text-sm sm:text-base text-slate-400 leading-relaxed">
              Infraestructura construida bajo estándares bancarios y criptográficos para salvaguardar la privacidad y la integridad de cada transacción.
            </p>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-3 gap-8">
            
            <div className="p-8 rounded-3xl bg-slate-900/70 border border-slate-800 hover:border-cyan-500/30 transition-all">
              <div className="w-12 h-12 rounded-2xl bg-cyan-500/10 border border-cyan-500/20 text-cyan-400 flex items-center justify-center text-2xl mb-6">
                🗄️
              </div>
              <h3 className="text-lg font-bold text-white mb-2">Base de Datos PostgreSQL 16</h3>
              <p className="text-xs text-slate-300 leading-relaxed">
                Persistencia soberana de órdenes, balances, históricos y usuarios. Reconciliación de auditoría en cada ciclo para evitar cualquier desincronización con Binance.
              </p>
            </div>

            <div className="p-8 rounded-3xl bg-slate-900/70 border border-slate-800 hover:border-sky-500/30 transition-all">
              <div className="w-12 h-12 rounded-2xl bg-sky-500/10 border border-sky-500/20 text-sky-400 flex items-center justify-center text-2xl mb-6">
                🔐
              </div>
              <h3 className="text-lg font-bold text-white mb-2">Cifrado Militar AES-256</h3>
              <p className="text-xs text-slate-300 leading-relaxed">
                Todas las credenciales API y secretos se almacenan cifrados con algoritmos criptográficos robustos. Sesiones protegidas por tokens JWT con expiración automática.
              </p>
            </div>

            <div className="p-8 rounded-3xl bg-slate-900/70 border border-slate-800 hover:border-blue-500/30 transition-all">
              <div className="w-12 h-12 rounded-2xl bg-blue-500/10 border border-blue-500/20 text-blue-400 flex items-center justify-center text-2xl mb-6">
                ☁️
              </div>
              <h3 className="text-lg font-bold text-white mb-2">Hetzner Cloud Dedicado</h3>
              <p className="text-xs text-slate-300 leading-relaxed">
                Nube dedicada en centro de datos de alta velocidad en Europa. Conexión de fibra de ultra-baja latencia hacia los puntos de intercambio de Binance Futures.
              </p>
            </div>

          </div>

        </div>
      </section>

      {/* =========================================================================
          7. PREGUNTAS FRECUENTES (FAQ INSTITUCIONAL)
         ========================================================================= */}
      <section id="faq" className="py-24 relative z-10 border-t border-slate-900">
        <div className="max-w-4xl mx-auto px-4 sm:px-6 lg:px-8">
          
          <div className="text-center mb-16">
            <div className="inline-flex items-center gap-2 px-3 py-1 rounded-full bg-cyan-500/10 border border-cyan-500/30 text-cyan-400 text-xs font-mono font-bold uppercase tracking-wider mb-4">
              <span>❓ DUDAS RESUELTAS</span>
            </div>
            <h2 className="text-3xl sm:text-5xl font-black text-white tracking-tight mb-4">
              Preguntas Frecuentes
            </h2>
            <p className="text-sm sm:text-base text-slate-400 leading-relaxed">
              Todo lo que necesitas saber antes de solicitar tu cuenta de inversión en WTN ALGO-TRADING.
            </p>
          </div>

          <div className="space-y-4">
            {[
              {
                q: '¿WTN Solutions LLC tiene acceso a retirar mis fondos de Binance?',
                a: 'Rotundamente NO. La integración se realiza mediante API Keys con permisos estrictos de lectura y ejecución de futuros. El permiso de retiro se encuentra desactivado obligatoriamente por diseño de seguridad. Tu capital permanece en tu propia custodia.',
              },
              {
                q: '¿Cómo funciona el proceso de admisión y solicitud de inversión?',
                a: 'Al hacer clic en "Solicitar Inversión", completas tu registro ingresando tu capital estimado y código de invitación verificado. Nuestro equipo revisa tu perfil y aprueba tu acceso al portal de inversionistas.',
              },
              {
                q: '¿Qué mercado opera el bot algorítmico?',
                a: 'Opera contratos de futuros perpetuos en Binance Futures (USDT-Margined), beneficiándose de alta liquidez, bajas comisiones y la capacidad de obtener rendimientos tanto en tendencias alcistas como de rebote.',
              },
              {
                q: '¿Puedo retirar mis ganancias o capital cuando lo decida?',
                a: 'Sí, totalmente. Como tus fondos residen en tu cuenta de Binance, puedes transferir, retirar o convertir tu saldo en cualquier momento según tu propio criterio sin pedir permiso a nadie.',
              },
              {
                q: '¿Qué ocurre si el mercado sufre un colapso repentino (flash crash)?',
                a: 'El algoritmo incorpora el Escudo Anti-Crash de BTC y detectores de régimen de mercado anormal. Ante caídas bruscas del mercado, se suspenden nuevas entradas automáticamente y se mantienen órdenes condicionales de protección activas.',
              },
            ].map((faq, index) => (
              <div
                key={index}
                className="rounded-2xl bg-slate-900/60 border border-slate-800/80 overflow-hidden transition"
              >
                <button
                  type="button"
                  onClick={() => setOpenFaq(openFaq === index ? -1 : index)}
                  className="w-full p-5 text-left flex items-center justify-between text-sm sm:text-base font-bold text-white hover:text-cyan-400 transition"
                >
                  <span>{faq.q}</span>
                  <span className="text-cyan-400 text-lg ml-4">
                    {openFaq === index ? '−' : '+'}
                  </span>
                </button>
                {openFaq === index && (
                  <div className="px-5 pb-5 text-xs sm:text-sm text-slate-300 leading-relaxed border-t border-slate-800/50 pt-3">
                    {faq.a}
                  </div>
                )}
              </div>
            ))}
          </div>

        </div>
      </section>

      {/* =========================================================================
          8. CALL TO ACTION FUTURISTA FINAL
         ========================================================================= */}
      <section className="py-20 relative z-10">
        <div className="max-w-5xl mx-auto px-4 sm:px-6 lg:px-8">
          <div className="relative rounded-3xl p-8 sm:p-14 bg-gradient-to-r from-blue-950/80 via-slate-900 to-cyan-950/80 border border-cyan-500/40 shadow-2xl shadow-cyan-900/30 text-center overflow-hidden">
            
            <div className="relative z-10">
              <span className="px-3 py-1 rounded-full bg-cyan-400/10 text-cyan-400 text-xs font-mono font-bold uppercase tracking-wider border border-cyan-400/30">
                ADMISIONES LIMITADAS POR CUPOS
              </span>
              <h2 className="text-3xl sm:text-5xl font-black text-white tracking-tight mt-4 mb-4">
                El Futuro de la Gestión de Activos es Cuantitativo
              </h2>
              <p className="text-sm sm:text-base text-slate-300 max-w-2xl mx-auto mb-8">
                Empieza a operar con el rigor de las grandes instituciones financieras. Solicita tu cuenta de inversión hoy mismo y conéctate al algoritmo.
              </p>

              <div className="flex flex-col sm:flex-row items-center justify-center gap-4">
                <button
                  type="button"
                  onClick={() => onOpenRegister && onOpenRegister(simCapital)}
                  className="w-full sm:w-auto px-8 py-4 bg-gradient-to-r from-cyan-400 via-sky-400 to-blue-500 hover:from-cyan-300 hover:to-blue-400 text-slate-950 font-black text-sm rounded-2xl shadow-xl shadow-cyan-500/30 transition-all hover:scale-105 active:scale-95 flex items-center justify-center gap-2"
                >
                  <span>🚀 Solicitar Cuenta de Inversión</span>
                </button>

                <button
                  type="button"
                  onClick={() => onOpenLogin && onOpenLogin()}
                  className="w-full sm:w-auto px-7 py-4 bg-slate-900 hover:bg-slate-800 text-white font-bold text-sm rounded-2xl border border-slate-700 hover:border-cyan-400 transition"
                >
                  Acceso a Clientes Registrados
                </button>
              </div>
            </div>

          </div>
        </div>
      </section>

      {/* =========================================================================
          9. FOOTER OFICIAL INSTITUCIONAL WTN SOLUTIONS LLC
         ========================================================================= */}
      <footer className="bg-slate-950 border-t border-slate-800/80 pt-16 pb-12 relative z-10 text-xs text-slate-400">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
          
          <div className="grid grid-cols-1 md:grid-cols-4 gap-10 mb-12">
            
            {/* COLUMNA 1: IDENTIDAD DE EMPRESA */}
            <div className="md:col-span-2 space-y-4">
              <div className="flex items-center gap-2.5">
                <div className="w-8 h-8 rounded-xl bg-cyan-500/20 border border-cyan-500/30 flex items-center justify-center text-lg">
                  ⚡
                </div>
                <span className="text-base font-black text-white tracking-tight">
                  WTN SOLUTIONS LLC
                </span>
              </div>
              <p className="text-xs text-slate-400 leading-relaxed max-w-sm">
                Empresa especializada en software financiero, infraestructura de trading algorítmico y modelos matemáticos de alta disponibilidad para mercados de derivados.
              </p>
              <div className="text-[11px] text-slate-500">
                División Tecnológica: <span className="text-slate-300 font-semibold">WTN ALGO-TRADING</span>
              </div>
            </div>

            {/* COLUMNA 2: PLATAFORMA */}
            <div className="space-y-2">
              <div className="text-xs font-bold text-white uppercase tracking-wider mb-2">
                Plataforma
              </div>
              <div><a href="#algoritmos" className="hover:text-cyan-400 transition">Algoritmos Cuantitativos</a></div>
              <div><a href="#estrategias" className="hover:text-cyan-400 transition">Modelo Non-Custodial</a></div>
              <div><a href="#simulador" className="hover:text-cyan-400 transition">Calculadora de Inversión</a></div>
              <div><a href="#seguridad" className="hover:text-cyan-400 transition">Infraestructura Hetzner</a></div>
            </div>

            {/* COLUMNA 3: ACCESO & SOPORTE */}
            <div className="space-y-2">
              <div className="text-xs font-bold text-white uppercase tracking-wider mb-2">
                Acceso & Soporte
              </div>
              <div>
                <button
                  type="button"
                  onClick={() => onOpenLogin && onOpenLogin()}
                  className="hover:text-cyan-400 transition text-left"
                >
                  Iniciar Sesión
                </button>
              </div>
              <div>
                <button
                  type="button"
                  onClick={() => onOpenRegister && onOpenRegister(simCapital)}
                  className="hover:text-cyan-400 transition text-left text-cyan-400 font-semibold"
                >
                  Enviar Solicitud de Inversión
                </button>
              </div>
              <div className="text-[11px] text-slate-500 pt-2">
                Soporte Oficial: <span className="text-slate-300">support@wtnsolutions.com</span>
              </div>
            </div>

          </div>

          {/* DESCARGO DE RESPONSABILIDAD REGULATORIA (RISK DISCLAIMER) */}
          <div className="pt-8 border-t border-slate-900 text-[11px] text-slate-400 leading-relaxed space-y-3">
            <p>
              <strong className="text-slate-400 uppercase">Aviso Legal y Descargo de Responsabilidad de Riesgo:</strong> El trading de contratos de futuros y derivados de criptomonedas implica un nivel sustancial de riesgo financiero y no es apropiado para todos los perfiles de inversor. El apalancamiento puede amplificar tanto los beneficios como las pérdidas potenciales. El desempeño y resultados históricos simulados no representan ninguna garantía ni promesa de rendimientos futuros.
            </p>
            <p>
              <strong className="text-slate-400">WTN Solutions LLC</strong> proporciona soluciones tecnológicas de automatización y software de trading algorítmico. Ninguna información, métrica o proyección contenida en este sitio web debe interpretarse como asesoramiento financiero, recomendación de inversión o gestión directa de fondos de terceros. La custodia de los activos permanece en todo momento bajo el control exclusivo del usuario en su cuenta de Binance.
            </p>
          </div>

          {/* COPYRIGHT Y SELLO FINAL */}
          <div className="mt-8 pt-6 border-t border-slate-900 flex flex-col sm:flex-row items-center justify-between gap-4 text-center sm:text-left text-[11px] text-slate-400">
            <div>
              &copy; {new Date().getFullYear()} <strong className="text-slate-400">WTN Solutions LLC</strong>. Todos los derechos reservados.
            </div>
            <div className="flex items-center gap-4 text-slate-400">
              <span>WTN ALGO-TRADING™</span>
              <span>•</span>
              <span>Cifrado TLS 1.3 / AES-256</span>
              <span>•</span>
              <span>Hetzner Cloud VPS</span>
            </div>
          </div>

        </div>
      </footer>

    </div>
  );
}
