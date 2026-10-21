import React, { useState, useEffect } from 'react';

/**
 * EquityCurvesShowcase
 * Pasarela visual interactiva de curvas de capital de cuentas activas en la plataforma.
 * Muestra el crecimiento real y consistente del balance de usuarios anónimos
 * con animación dinámica que va creciendo punto a punto, cierre a cierre de trade.
 */

const ACCOUNTS_DATA = [
  {
    id: 'Cuenta #118',
    mode: 'Copy-Trading',
    modeBadge: 'COPY-TRADING VERIFICADO',
    profitDiff: '+$2,105',
    badgeColor: 'sky',
    capital: '$5,000',
    currentBalance: '$7,105',
    gain: '+42.1%',
    duration: '75 Días',
    winRate: '89.6%',
    maxDrawdown: '6.2%',
    description: 'Replicación en cuenta privada con retiros libres en cualquier momento.',
    points: [88, 86, 82, 79, 81, 75, 71, 68, 64, 66, 59, 54, 50, 47, 49, 41, 36, 31, 27, 20, 15],
  },
  {
    id: 'Cuenta #073',
    mode: 'Bot Personal Autónomo',
    modeBadge: 'PARÁMETROS PERSONALIZADOS',
    profitDiff: '+$8,505',
    badgeColor: 'blue',
    capital: '$15,000',
    currentBalance: '$23,505',
    gain: '+56.7%',
    duration: '110 Días',
    winRate: '87.4%',
    maxDrawdown: '9.4%',
    description: 'Apalancamiento calibrado por el usuario en monedas de alta capitalización.',
    points: [90, 84, 86, 80, 72, 75, 68, 62, 65, 55, 48, 52, 43, 38, 41, 32, 26, 28, 19, 14, 8],
  },
  {
    id: 'Cuenta #205',
    mode: 'Fondo Mancomunado',
    modeBadge: 'PERFIL DE PRESERVACIÓN',
    profitDiff: '+$7,875',
    badgeColor: 'emerald',
    capital: '$25,000',
    currentBalance: '$32,875',
    gain: '+31.5%',
    duration: '80 Días',
    winRate: '94.8%',
    maxDrawdown: '3.6%',
    description: 'Estrategia de alta precisión con drawdowns mínimos.',
    points: [86, 84, 82, 80, 78, 75, 73, 71, 68, 66, 63, 61, 58, 55, 53, 50, 46, 43, 40, 36, 32],
  },
];

export default function EquityCurvesShowcase() {
  const [selectedIdx, setSelectedIdx] = useState(0);
  const [visiblePoints, setVisiblePoints] = useState(2);
  const account = ACCOUNTS_DATA[selectedIdx];
  const totalSteps = account.points.length;

  // Reiniciar la animación punto a punto cuando el usuario cambia de cuenta
  useEffect(() => {
    setVisiblePoints(2);
  }, [selectedIdx]);

  // Animación progresiva: Crece punto a punto, cierre a cierre de trade
  useEffect(() => {
    if (visiblePoints < totalSteps) {
      const timer = setTimeout(() => {
        setVisiblePoints((prev) => Math.min(prev + 1, totalSteps));
      }, 110); // Crecimiento paso a paso (~110ms por trade)
      return () => clearTimeout(timer);
    } else {
      // Al llegar al balance final, mantiene 3.5s y vuelve a iniciar suavemente
      const loopTimer = setTimeout(() => {
        setVisiblePoints(2);
      }, 3500);
      return () => clearTimeout(loopTimer);
    }
  }, [visiblePoints, totalSteps, selectedIdx]);

  // Dimensiones del gráfico SVG
  const width = 600;
  const height = 220;
  const stepX = width / (totalSteps - 1);

  // Trazo de fondo guía (trayectoria completa tenue)
  const fullPathD = account.points.reduce((acc, y, i) => {
    const x = i * stepX;
    return i === 0 ? `M ${x} ${y * 1.8}` : `${acc} L ${x} ${y * 1.8}`;
  }, '');

  // Trazo animado que crece punto a punto (cierre a cierre)
  const currentPoints = account.points.slice(0, visiblePoints);
  const pathD = currentPoints.reduce((acc, y, i) => {
    const x = i * stepX;
    return i === 0 ? `M ${x} ${y * 1.8}` : `${acc} L ${x} ${y * 1.8}`;
  }, '');

  const headX = (visiblePoints - 1) * stepX;
  const headY = currentPoints[currentPoints.length - 1] * 1.8;
  const areaD = `${pathD} L ${headX} ${height} L 0 ${height} Z`;

  // Porcentaje de progreso de la curva animada
  const isFinished = visiblePoints >= totalSteps;

  return (
    <div className="w-full bg-slate-900/80 border border-cyan-500/30 rounded-3xl p-6 sm:p-8 backdrop-blur-xl shadow-2xl">
      
      {/* SELECTOR DE CUENTAS (PASARELA HORIZONTAL) */}
      <div className="flex items-center justify-between flex-wrap gap-2 pb-6 border-b border-slate-800">
        <div>
          <h3 className="text-xl sm:text-2xl font-black text-white mt-0.5">
            Curvas de Capital
          </h3>
        </div>

        {/* BOTONES DE LA PASARELA */}
        <div className="flex items-center gap-1.5 flex-wrap">
          {ACCOUNTS_DATA.map((acc, idx) => (
            <button
              key={acc.id}
              type="button"
              onClick={() => setSelectedIdx(idx)}
              className={`px-3 py-1.5 text-xs font-mono rounded-xl border transition-all ${
                selectedIdx === idx
                  ? 'bg-cyan-500/20 border-cyan-400 text-cyan-300 font-bold shadow-md shadow-cyan-500/10'
                  : 'bg-slate-950 border-slate-800 text-slate-400 hover:text-white hover:border-slate-700'
              }`}
            >
              {acc.id}
            </button>
          ))}
        </div>
      </div>

      {/* DETALLES DE LA CUENTA SELECCIONADA */}
      <div className="grid grid-cols-1 lg:grid-cols-12 gap-6 items-center pt-6">
        
        {/* GRÁFICO SVG DE LA CURVA DE CAPITAL ANIMADA */}
        <div className="lg:col-span-8 bg-slate-950 rounded-2xl border border-slate-800/80 p-4 relative overflow-hidden">
          <div className="flex items-center justify-between text-xs text-slate-400 mb-2">
            <div className="flex items-center gap-2">
              <span className="w-2.5 h-2.5 rounded-full bg-emerald-400 animate-pulse" />
              <span className="font-mono text-white font-bold">{account.id}</span>
              <span className="text-[10px] px-2 py-0.5 rounded-md bg-slate-800 text-slate-300 border border-slate-700">
                {account.mode}
              </span>
            </div>

            {/* INDICADOR DE MODO */}
            <div className="flex items-center gap-2">
            </div>
          </div>

          <div className="relative w-full h-[180px] sm:h-[220px]">
            <svg
              viewBox={`0 0 ${width} ${height}`}
              className="w-full h-full overflow-visible"
              preserveAspectRatio="none"
            >
              <defs>
                <linearGradient id={`gradArea-${selectedIdx}`} x1="0" y1="0" x2="0" y2="1">
                  <stop offset="0%" stopColor="#00f0ff" stopOpacity="0.35" />
                  <stop offset="70%" stopColor="#2563eb" stopOpacity="0.08" />
                  <stop offset="100%" stopColor="#020617" stopOpacity="0" />
                </linearGradient>
                <linearGradient id={`gradLine-${selectedIdx}`} x1="0" y1="0" x2="1" y2="0">
                  <stop offset="0%" stopColor="#38bdf8" />
                  <stop offset="50%" stopColor="#00f0ff" />
                  <stop offset="100%" stopColor="#10b981" />
                </linearGradient>
              </defs>

              {/* Líneas Guía de Fondo */}
              <line x1="0" y1="40" x2={width} y2="40" stroke="#1e293b" strokeDasharray="4 4" strokeWidth="1" />
              <line x1="0" y1="100" x2={width} y2="100" stroke="#1e293b" strokeDasharray="4 4" strokeWidth="1" />
              <line x1="0" y1="160" x2={width} y2="160" stroke="#1e293b" strokeDasharray="4 4" strokeWidth="1" />

              {/* Guía tenue del recorrido completo */}
              <path
                d={fullPathD}
                fill="none"
                stroke="#334155"
                strokeWidth="1.5"
                strokeDasharray="3 3"
                opacity="0.35"
              />

              {/* Área Sombreada Animada */}
              <path d={areaD} fill={`url(#gradArea-${selectedIdx})`} />

              {/* Línea de Crecimiento Dinámica (Crece punto a punto) */}
              <path
                d={pathD}
                fill="none"
                stroke={`url(#gradLine-${selectedIdx})`}
                strokeWidth="3.5"
                strokeLinecap="round"
                strokeLinejoin="round"
              />

              {/* Punto de Cierre Activo (Punto que avanza en cada cierre de trade) */}
              <circle
                cx={headX}
                cy={headY}
                r="7"
                fill="#00f0ff"
                className="animate-pulse"
                opacity="0.75"
              />
              <circle
                cx={headX}
                cy={headY}
                r="4"
                fill={isFinished ? "#10b981" : "#38bdf8"}
              />
              <circle
                cx={headX}
                cy={headY}
                r="2"
                fill="#ffffff"
              />
            </svg>
          </div>

          <div className="flex items-center justify-between text-[10px] font-mono text-slate-400 mt-2 pt-2 border-t border-slate-900">
            <span>Inicio: {account.capital}</span>
            <span className="text-cyan-400 font-semibold">
              {isFinished ? '✓ Curva completada' : `● Crecimiento en curso (Trade ${visiblePoints - 1}/${totalSteps - 1})`}
            </span>
            <span className="text-emerald-400 font-bold">Balance: {account.currentBalance}</span>
          </div>
        </div>

        {/* MÉTRICAS CLAVE DE LA CUENTA */}
        <div className="lg:col-span-4 space-y-4">
          <div className="p-4 rounded-2xl bg-slate-950 border border-slate-800">
            <div className="flex items-center flex-wrap gap-2 mb-3">
              <span className="text-[10px] font-mono font-bold text-cyan-400 uppercase tracking-wider px-2.5 py-1 rounded-lg bg-cyan-950/60 border border-cyan-500/30">
                {account.modeBadge}
              </span>
            </div>

            {/* DOS BLOQUES IDENTICOS: PORCENTAJE Y MONTO DE GANANCIA */}
            <div className="grid grid-cols-2 gap-2.5 mb-2">
              <div className="p-3 rounded-xl bg-slate-900/80 border border-slate-800/80">
                <span className="text-[10px] font-mono text-slate-400 block uppercase font-bold tracking-wider mb-0.5">
                  Rendimiento
                </span>
                <div className="text-2xl sm:text-3xl font-black text-emerald-400 font-mono tracking-tight">
                  {account.gain}
                </div>
              </div>
              <div className="p-3 rounded-xl bg-emerald-950/30 border border-emerald-500/40 shadow-inner">
                <span className="text-[10px] font-mono text-emerald-400 block uppercase font-bold tracking-wider mb-0.5">
                  Ganancia Neta
                </span>
                <div className="text-2xl sm:text-3xl font-black text-emerald-300 font-mono tracking-tight">
                  {account.profitDiff}
                </div>
              </div>
            </div>

            <div className="text-xs text-slate-400 font-medium">
              Ganancia neta en {account.duration}
            </div>
          </div>

          <div className="grid grid-cols-2 gap-2 text-xs">
            <div className="p-3 rounded-xl bg-slate-950/70 border border-slate-800/80">
              <span className="text-[10px] text-slate-400 block">% de acierto</span>
              <strong className="text-white font-mono text-sm">{account.winRate}</strong>
            </div>
            <div className="p-3 rounded-xl bg-slate-950/70 border border-slate-800/80">
              <span className="text-[10px] text-slate-400 block">Max Drawdown</span>
              <strong className="text-emerald-400 font-mono text-sm">&lt; {account.maxDrawdown}</strong>
            </div>
            <div className="p-3 rounded-xl bg-slate-950/70 border border-slate-800/80">
              <span className="text-[10px] text-slate-400 block">Capital Inicial</span>
              <strong className="text-slate-300 font-mono text-xs">{account.capital}</strong>
            </div>
            <div className="p-3 rounded-xl bg-slate-950/70 border border-slate-800/80">
              <span className="text-[10px] text-slate-400 block">Balance Actual</span>
              <strong className="text-cyan-300 font-mono text-xs">{account.currentBalance}</strong>
            </div>
          </div>

          <p className="text-[11px] text-slate-400 leading-relaxed italic">
            "{account.description}"
          </p>
        </div>

      </div>

    </div>
  );
}
