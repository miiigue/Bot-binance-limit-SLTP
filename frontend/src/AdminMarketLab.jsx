import React, { useState, useEffect } from 'react';
import { useAuth } from './AuthContext';

const PRESET_COINS = [
  'BTCUSDT', 'ETHUSDT', 'SOLUSDT', 'DOGEUSDT', 
  'XRPUSDT', 'BNBUSDT', 'ADAUSDT', 'ZECUSDT', 
  'XMRUSDT', 'LTCUSDT', 'AVAXUSDT', 'LINKUSDT'
];

const TIMEFRAMES = [
  { value: '1m', label: '1 Minuto' },
  { value: '5m', label: '5 Minutos' },
  { value: '15m', label: '15 Minutos (Recomendado)' },
  { value: '1h', label: '1 Hora' },
  { value: '4h', label: '4 Horas' },
  { value: '1d', label: '1 Día' }
];

export default function AdminMarketLab({ activeConfig, addToast }) {
  const { authFetch } = useAuth();

  // Configuración de Monedas
  const [selectedSymbols, setSelectedSymbols] = useState(['ETHUSDT', 'SOLUSDT', 'DOGEUSDT']);
  const [customSymbolInput, setCustomSymbolInput] = useState('');

  // Parámetros de Análisis
  const [interval, setInterval] = useState('15m');
  const [periodMode, setPeriodMode] = useState('CANDLES'); // 'CANDLES' o 'DATE_RANGE'
  const [candleLimit, setCandleLimit] = useState(500);
  const [startDate, setStartDate] = useState(() => {
    const d = new Date();
    d.setDate(d.getDate() - 7);
    return d.toISOString().slice(0, 16);
  });
  const [endDate, setEndDate] = useState(() => new Date().toISOString().slice(0, 16));
  const [minSwingPct, setMinSwingPct] = useState(1.2);

  // Parámetros de Simulación de Capital
  const [marginUsdt, setMarginUsdt] = useState(50.0);
  const [leverage, setLeverage] = useState(10);

  // Estado del Análisis
  const [isLoading, setIsLoading] = useState(false);
  const [analysisData, setAnalysisData] = useState(null);
  const [focusedSymbol, setFocusedSymbol] = useState(null);
  const [tableSortKey, setTableSortKey] = useState('ratio');
  const [tableSortAsc, setTableSortAsc] = useState(false);
  const [copyFeedback, setCopyFeedback] = useState(null);

  // Sincronizar monedas configuradas en el bot si están disponibles
  useEffect(() => {
    if (activeConfig?.symbolsToTrade) {
      const activeList = activeConfig.symbolsToTrade
        .split(',')
        .map(s => s.trim().toUpperCase())
        .filter(Boolean);
      if (activeList.length > 0) {
        setSelectedSymbols(prev => Array.from(new Set([...prev, ...activeList.slice(0, 4)])));
      }
    }
  }, [activeConfig]);

  // Manejador de agregar/quitar moneda
  const toggleSymbol = (sym) => {
    setSelectedSymbols(prev => 
      prev.includes(sym) ? prev.filter(s => s !== sym) : [...prev, sym]
    );
  };

  const handleAddCustomSymbol = (e) => {
    e.preventDefault();
    const clean = customSymbolInput.trim().toUpperCase();
    if (!clean) return;
    const finalSym = clean.endsWith('USDT') ? clean : `${clean}USDT`;
    if (!selectedSymbols.includes(finalSym)) {
      setSelectedSymbols(prev => [...prev, finalSym]);
    }
    setCustomSymbolInput('');
  };

  const handleSelectAllPresets = () => {
    setSelectedSymbols(PRESET_COINS);
  };

  const handleClearSymbols = () => {
    setSelectedSymbols([]);
  };

  // Ejecutar Análisis Cuantitativo
  const runAnalysis = async () => {
    if (selectedSymbols.length === 0) {
      if (addToast) addToast('Selecciona al menos una moneda', 'Elige o escribe un par para analizar.', 'warning');
      return;
    }

    setIsLoading(true);
    setCopyFeedback(null);

    try {
      const payload = {
        symbols: selectedSymbols,
        interval,
        min_swing_pct: parseFloat(minSwingPct) || 1.2,
        margin_usdt: parseFloat(marginUsdt) || 50.0,
        leverage: parseInt(leverage) || 10
      };

      if (periodMode === 'CANDLES') {
        payload.limit = parseInt(candleLimit) || 500;
      } else {
        payload.start_time = startDate;
        payload.end_time = endDate;
        payload.limit = 1500;
      }

      const res = await authFetch('/api/admin/analysis/dip-bounce', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload)
      });

      if (!res.ok) {
        const err = await res.json();
        throw new Error(err.message || 'Error en el cálculo');
      }

      const data = await res.json();
      if (data?.data) {
        setAnalysisData(data.data);
        const validCoins = (data.data.coins || []).filter(c => !c.error);
        if (validCoins.length > 0) {
          setFocusedSymbol(validCoins[0].symbol);
        }
        if (addToast) {
          addToast('🔬 Análisis Completado', `Se evaluaron ${validCoins.length} monedas con velas de Binance.`, 'success');
        }
      }
    } catch (e) {
      if (addToast) addToast('Error de Análisis', e.message, 'error');
    } finally {
      setIsLoading(false);
    }
  };

  // Moneda enfocada para ver detalle
  const focusedCoinData = (analysisData?.coins || []).find(c => c.symbol === focusedSymbol) || (analysisData?.coins || [])[0];

  // Copiar parámetros recomendados al portapapeles
  const handleCopyParameters = (coin) => {
    if (!coin || !coin.recommended_sl) return;
    const textToCopy = `// Parámetros Optimizados para ${coin.symbol} (${interval})
// Basado en ${coin.candles_analyzed} velas históricas reales de Binance
stop_loss_percent = ${coin.recommended_sl.anti_noise.pct}  // SL Antirruido P95
stop_loss_usdt = ${coin.recommended_sl.anti_noise.usdt}  // Pérdida máxima en $ (${marginUsdt} USDT x${leverage})
take_profit_percent = ${coin.recommended_tp.pct}  // TP Óptimo de Rebote
take_profit_usdt = ${coin.recommended_tp.usdt}
pnl_trailing_stop_activation_usdt = ${coin.recommended_trailing.activation_usdt}
pnl_trailing_stop_drop_usdt = ${coin.recommended_trailing.drop_usdt}`;

    navigator.clipboard.writeText(textToCopy);
    setCopyFeedback(coin.symbol);
    setTimeout(() => setCopyFeedback(null), 3500);
    if (addToast) {
      addToast('📋 Parámetros Copiados', `Valores de SL (-${coin.recommended_sl.anti_noise.pct}%) y TP (+${coin.recommended_tp.pct}%) para ${coin.symbol} copiados al portapapeles.`, 'success');
    }
  };

  // Ordenar tabla multimoneda
  const sortedCoins = [...(analysisData?.coins || [])].filter(c => !c.error).sort((a, b) => {
    let valA = 0;
    let valB = 0;
    if (tableSortKey === 'symbol') {
      valA = a.symbol;
      valB = b.symbol;
      return tableSortAsc ? valA.localeCompare(valB) : valB.localeCompare(valA);
    }
    if (tableSortKey === 'drop') { valA = a.avg_drop_pct; valB = b.avg_drop_pct; }
    if (tableSortKey === 'sl') { valA = a.recommended_sl?.anti_noise?.pct || 0; valB = b.recommended_sl?.anti_noise?.pct || 0; }
    if (tableSortKey === 'bounce') { valA = a.avg_bounce_pct; valB = b.avg_bounce_pct; }
    if (tableSortKey === 'tp') { valA = a.recommended_tp?.pct || 0; valB = b.recommended_tp?.pct || 0; }
    if (tableSortKey === 'ratio') { valA = a.elasticity_ratio; valB = b.elasticity_ratio; }
    if (tableSortKey === 'candles') { valA = a.avg_bounce_candles; valB = b.avg_bounce_candles; }

    return tableSortAsc ? (valA - valB) : (valB - valA);
  });

  const handleSort = (key) => {
    if (tableSortKey === key) {
      setTableSortAsc(!tableSortAsc);
    } else {
      setTableSortKey(key);
      setTableSortAsc(false);
    }
  };

  return (
    <div className="space-y-6 animate-fadeIn pb-12">
      {/* ============================================================== */}
      {/* 1. ENCABEZADO Y EXPLICACIÓN CUANTITATIVA                       */}
      {/* ============================================================== */}
      <div className="bg-slate-900/90 border border-slate-800 rounded-3xl p-6 sm:p-7 shadow-xl relative overflow-hidden backdrop-blur-md">
        <div className="absolute top-0 right-0 w-96 h-96 bg-amber-500/5 rounded-full blur-3xl -mr-20 -mt-20 pointer-events-none" />
        <div className="flex flex-col md:flex-row md:items-center justify-between gap-4 relative z-10">
          <div>
            <div className="flex items-center gap-3">
              <span className="p-2.5 rounded-2xl bg-amber-500/10 text-amber-400 border border-amber-500/30 text-2xl">
                🔬
              </span>
              <div>
                <h1 className="text-xl sm:text-2xl font-black text-white tracking-tight flex items-center gap-2">
                  <span>Laboratorio de Pruebas Cuantitativas</span>
                  <span className="text-[10px] font-bold px-2 py-0.5 rounded-full bg-amber-400/20 text-amber-300 border border-amber-400/40 uppercase tracking-widest">
                    Optimización Antirruido
                  </span>
                </h1>
                <p className="text-xs sm:text-sm text-slate-400 mt-1">
                  Mide el porcentaje real de caídas y rebotes de cada moneda para determinar el <strong>Stop Loss exacto</strong> que evita liquidaciones por volatilidad normal.
                </p>
              </div>
            </div>
          </div>

          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={runAnalysis}
              disabled={isLoading || selectedSymbols.length === 0}
              className="px-6 py-3 rounded-2xl bg-gradient-to-r from-amber-500 to-amber-600 hover:from-amber-400 hover:to-amber-500 text-slate-950 font-black text-xs sm:text-sm tracking-wide shadow-lg shadow-amber-500/25 transition flex items-center justify-center gap-2 disabled:opacity-50 disabled:cursor-not-allowed"
            >
              {isLoading ? (
                <>
                  <span className="w-4 h-4 border-2 border-slate-950 border-t-transparent rounded-full animate-spin" />
                  <span>Analizando Velas...</span>
                </>
              ) : (
                <>
                  <span>⚡</span>
                  <span>EJECUTAR ANÁLISIS DE MERCADO</span>
                </>
              )}
            </button>
          </div>
        </div>

        {/* ============================================================== */}
        {/* PANEL DE CONFIGURACIÓN DE PARÁMETROS                          */}
        {/* ============================================================== */}
        <div className="mt-6 pt-5 border-t border-slate-800/80 grid grid-cols-1 md:grid-cols-12 gap-5 relative z-10 text-xs">
          
          {/* Monedas Seleccionadas */}
          <div className="md:col-span-12 space-y-2">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <span className="font-extrabold text-slate-300 uppercase tracking-wider text-[11px] flex items-center gap-1.5">
                <span>🪙</span> Monedas a Evaluar ({selectedSymbols.length} seleccionadas)
              </span>
              <div className="flex items-center gap-2">
                <button
                  type="button"
                  onClick={handleSelectAllPresets}
                  className="text-[10px] text-amber-400 hover:text-amber-300 font-semibold transition"
                >
                  + Todas las del Bot
                </button>
                <span className="text-slate-600">•</span>
                <button
                  type="button"
                  onClick={handleClearSymbols}
                  className="text-[10px] text-slate-500 hover:text-slate-400 transition"
                >
                  Limpiar
                </button>
              </div>
            </div>

            {/* Tags de monedas */}
            <div className="flex flex-wrap gap-1.5">
              {PRESET_COINS.map(coin => {
                const isSelected = selectedSymbols.includes(coin);
                return (
                  <button
                    key={coin}
                    type="button"
                    onClick={() => toggleSymbol(coin)}
                    className={`px-3 py-1.5 rounded-xl font-mono text-[11px] font-bold transition flex items-center gap-1.5 border ${
                      isSelected
                        ? 'bg-amber-400/20 text-amber-300 border-amber-400/50 shadow-sm shadow-amber-500/10'
                        : 'bg-slate-950/60 text-slate-400 border-slate-800 hover:border-slate-700'
                    }`}
                  >
                    <span>{isSelected ? '✓' : '+'}</span>
                    <span>{coin}</span>
                  </button>
                );
              })}

              {/* Agregar otra moneda */}
              <form onSubmit={handleAddCustomSymbol} className="flex items-center gap-1">
                <input
                  type="text"
                  placeholder="Otra moneda (ej: NEAR)"
                  value={customSymbolInput}
                  onChange={(e) => setCustomSymbolInput(e.target.value)}
                  className="bg-slate-950 border border-slate-800 rounded-xl px-2.5 py-1 text-[11px] text-white font-mono placeholder:text-slate-600 focus:outline-none focus:border-amber-500/50 w-32"
                />
                <button
                  type="submit"
                  className="px-2 py-1 bg-slate-800 hover:bg-slate-700 text-slate-200 rounded-xl text-[10px] font-bold transition"
                >
                  +
                </button>
              </form>
            </div>
          </div>

          {/* Temporalidad */}
          <div className="md:col-span-3 space-y-1.5">
            <label className="text-[11px] font-bold text-slate-400 uppercase tracking-wide block">
              ⏱️ Temporalidad de Velas
            </label>
            <select
              value={interval}
              onChange={(e) => setInterval(e.target.value)}
              className="w-full bg-slate-950 border border-slate-800 rounded-xl px-3 py-2 text-white font-mono text-xs focus:outline-none focus:border-amber-500/50"
            >
              {TIMEFRAMES.map(tf => (
                <option key={tf.value} value={tf.value}>{tf.label}</option>
              ))}
            </select>
          </div>

          {/* Modo de Período */}
          <div className="md:col-span-3 space-y-1.5">
            <div className="flex items-center justify-between">
              <label className="text-[11px] font-bold text-slate-400 uppercase tracking-wide">
                📅 Rango a Analizar
              </label>
              <div className="flex items-center gap-1 text-[10px] bg-slate-950 p-0.5 rounded-lg border border-slate-800">
                <button
                  type="button"
                  onClick={() => setPeriodMode('CANDLES')}
                  className={`px-1.5 py-0.5 rounded font-bold transition ${periodMode === 'CANDLES' ? 'bg-amber-400 text-slate-950' : 'text-slate-400'}`}
                >
                  Velas
                </button>
                <button
                  type="button"
                  onClick={() => setPeriodMode('DATE_RANGE')}
                  className={`px-1.5 py-0.5 rounded font-bold transition ${periodMode === 'DATE_RANGE' ? 'bg-amber-400 text-slate-950' : 'text-slate-400'}`}
                >
                  Fechas
                </button>
              </div>
            </div>

            {periodMode === 'CANDLES' ? (
              <select
                value={candleLimit}
                onChange={(e) => setCandleLimit(Number(e.target.value))}
                className="w-full bg-slate-950 border border-slate-800 rounded-xl px-3 py-2 text-white font-mono text-xs focus:outline-none focus:border-amber-500/50"
              >
                <option value={100}>Últimas 100 velas</option>
                <option value={300}>Últimas 300 velas (~3 días)</option>
                <option value={500}>Últimas 500 velas (~5.2 días)</option>
                <option value={1000}>Últimas 1000 velas (~10.4 días)</option>
                <option value={1500}>Últimas 1500 velas (~15.6 días)</option>
              </select>
            ) : (
              <div className="grid grid-cols-2 gap-1.5">
                <input
                  type="datetime-local"
                  value={startDate}
                  onChange={(e) => setStartDate(e.target.value)}
                  className="bg-slate-950 border border-slate-800 rounded-xl px-2 py-1.5 text-[10px] text-white font-mono focus:outline-none focus:border-amber-500/50"
                />
                <input
                  type="datetime-local"
                  value={endDate}
                  onChange={(e) => setEndDate(e.target.value)}
                  className="bg-slate-950 border border-slate-800 rounded-xl px-2 py-1.5 text-[10px] text-white font-mono focus:outline-none focus:border-amber-500/50"
                />
              </div>
            )}
          </div>

          {/* Simulador de Capital (Margen y Apalancamiento) */}
          <div className="md:col-span-3 space-y-1.5">
            <label className="text-[11px] font-bold text-slate-400 uppercase tracking-wide block">
              💵 Margen por Posición
            </label>
            <div className="relative">
              <input
                type="number"
                min="5"
                step="5"
                value={marginUsdt}
                onChange={(e) => setMarginUsdt(e.target.value)}
                className="w-full bg-slate-950 border border-slate-800 rounded-xl px-3 py-2 text-white font-mono text-xs focus:outline-none focus:border-amber-500/50 pr-14"
              />
              <span className="absolute right-3 top-2 text-slate-500 text-[10px] font-mono">USDT</span>
            </div>
          </div>

          <div className="md:col-span-3 space-y-1.5">
            <label className="text-[11px] font-bold text-slate-400 uppercase tracking-wide block">
              ⚡ Multiplicador (Apalancamiento)
            </label>
            <div className="relative">
              <input
                type="number"
                min="1"
                max="125"
                value={leverage}
                onChange={(e) => setLeverage(e.target.value)}
                className="w-full bg-slate-950 border border-slate-800 rounded-xl px-3 py-2 text-white font-mono text-xs focus:outline-none focus:border-amber-500/50 pr-8"
              />
              <span className="absolute right-3 top-2 text-slate-500 text-[10px] font-mono">X</span>
            </div>
          </div>

        </div>
      </div>

      {/* ============================================================== */}
      {/* 2. RESULTADOS DEL ANÁLISIS CUANTITATIVO                         */}
      {/* ============================================================== */}
      {analysisData && analysisData.basket_summary && (
        <div className="space-y-6">

          {/* Tarjetas KPI de la Cesta */}
          <div className="grid grid-cols-2 md:grid-cols-4 gap-3 sm:gap-4">
            
            <div className="p-4 sm:p-5 rounded-2xl bg-slate-900/90 border border-slate-800 shadow-md">
              <div className="flex items-center justify-between text-slate-400 text-xs mb-1">
                <span className="font-semibold uppercase tracking-wider text-[10px]">Caída Promedio</span>
                <span>📉</span>
              </div>
              <div className="text-xl sm:text-2xl font-black font-mono text-rose-400">
                -{analysisData.basket_summary.avg_basket_drop_pct}%
              </div>
              <p className="text-[10px] text-slate-500 mt-1">
                Magnitud media de los retrocesos analizados
              </p>
            </div>

            <div className="p-4 sm:p-5 rounded-2xl bg-slate-900/90 border border-slate-800 shadow-md">
              <div className="flex items-center justify-between text-slate-400 text-xs mb-1">
                <span className="font-semibold uppercase tracking-wider text-[10px]">Rebote Promedio</span>
                <span>📈</span>
              </div>
              <div className="text-xl sm:text-2xl font-black font-mono text-emerald-400">
                +{analysisData.basket_summary.avg_basket_bounce_pct}%
              </div>
              <p className="text-[10px] text-slate-500 mt-1">
                Fuerza media de recuperación tras tocar fondo
              </p>
            </div>

            <div className="p-4 sm:p-5 rounded-2xl bg-slate-900/90 border border-amber-500/30 shadow-md bg-amber-500/5">
              <div className="flex items-center justify-between text-amber-400 text-xs mb-1">
                <span className="font-semibold uppercase tracking-wider text-[10px]">🛡️ SL Antirruido Global</span>
                <span>🛡️</span>
              </div>
              <div className="text-xl sm:text-2xl font-black font-mono text-amber-300">
                -{analysisData.basket_summary.avg_basket_sl_anti_noise_pct}%
              </div>
              <p className="text-[10px] text-amber-400/80 mt-1">
                Percentil 95 sugerido para no ser sacado
              </p>
            </div>

            <div className="p-4 sm:p-5 rounded-2xl bg-slate-900/90 border border-slate-800 shadow-md">
              <div className="flex items-center justify-between text-slate-400 text-xs mb-1">
                <span className="font-semibold uppercase tracking-wider text-[10px]">Moneda Más Elástica</span>
                <span>🏆</span>
              </div>
              <div className="text-lg sm:text-xl font-black font-mono text-white flex items-center gap-1.5">
                <span>{analysisData.basket_summary.top_elastic_coin.symbol}</span>
                <span className="text-xs text-emerald-400 font-bold">({analysisData.basket_summary.top_elastic_coin.ratio}x)</span>
              </div>
              <p className="text-[10px] text-slate-500 mt-1">
                Mayor ratio de rebote vs caída
              </p>
            </div>

          </div>

          {/* ============================================================== */}
          {/* 3. DETALLE Y RECOMENDACIÓN EXACTA DE STOP LOSS                */}
          {/* ============================================================== */}
          {focusedCoinData && !focusedCoinData.error && (
            <div className="bg-slate-900/95 border border-amber-500/40 rounded-3xl p-5 sm:p-7 shadow-2xl space-y-6 relative overflow-hidden">
              <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 border-b border-slate-800 pb-4">
                <div>
                  <div className="flex items-center gap-2">
                    <span className="text-lg font-black text-white font-mono">{focusedCoinData.symbol}</span>
                    <span className="text-[11px] font-bold px-2 py-0.5 rounded-full bg-slate-800 text-slate-300 border border-slate-700">
                      {focusedCoinData.candles_analyzed} velas ({interval})
                    </span>
                    <span className="text-[11px] font-bold">{focusedCoinData.verdict_badge}</span>
                  </div>
                  <p className="text-xs text-slate-400 mt-1">
                    {focusedCoinData.verdict_desc}
                  </p>
                </div>

                <div className="flex items-center gap-2">
                  <button
                    type="button"
                    onClick={() => handleCopyParameters(focusedCoinData)}
                    className="px-4 py-2 rounded-xl bg-amber-400 hover:bg-amber-300 text-slate-950 font-black text-xs font-mono transition flex items-center gap-1.5 shadow"
                  >
                    <span>{copyFeedback === focusedCoinData.symbol ? '✓' : '📋'}</span>
                    <span>{copyFeedback === focusedCoinData.symbol ? '¡Copiado al Portapapeles!' : 'Copiar Parámetros de Estrategia'}</span>
                  </button>
                </div>
              </div>

              {/* Comparador de Perfiles de Stop Loss */}
              <div className="space-y-3">
                <div className="flex items-center justify-between">
                  <h3 className="text-xs font-black uppercase tracking-wider text-slate-300 flex items-center gap-1.5">
                    <span>🛡️</span> Dónde colocar el Stop Loss para que el bot no se salga por ruido
                  </h3>
                  <span className="text-[10px] font-mono text-slate-500">
                    Posición Nocional: ${(parseFloat(marginUsdt) * parseInt(leverage)).toFixed(2)} USDT (${marginUsdt} x{leverage})
                  </span>
                </div>

                <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                  
                  {/* Perfil 1: Antirruido (Percentil 95) */}
                  <div className="p-4 rounded-2xl bg-amber-500/10 border-2 border-amber-400/60 shadow-lg relative flex flex-col justify-between">
                    <div className="absolute -top-2.5 right-4 bg-amber-400 text-slate-950 font-black text-[9px] uppercase px-2 py-0.5 rounded-full tracking-wider shadow">
                      ⭐ Recomendado
                    </div>
                    <div>
                      <span className="text-[11px] font-extrabold text-amber-300 uppercase tracking-wide block">
                        🛡️ Stop Loss Antirruido (P95)
                      </span>
                      <div className="flex items-baseline gap-2 mt-1">
                        <span className="text-2xl font-black font-mono text-amber-300">
                          -{focusedCoinData.recommended_sl.anti_noise.pct}%
                        </span>
                        <span className="text-xs font-bold font-mono text-amber-400">
                          (-${focusedCoinData.recommended_sl.anti_noise.usdt} USDT)
                        </span>
                      </div>
                      <p className="text-[11px] text-amber-200/90 mt-2 leading-relaxed">
                        El <strong>95.2% de los retrocesos normales</strong> de {focusedCoinData.symbol} frenaron antes de este punto. Salirse antes es un error por ruido de mercado.
                      </p>
                    </div>
                    <div className="mt-3 pt-2.5 border-t border-amber-500/20 text-[10px] font-mono text-amber-300 flex items-center justify-between font-bold">
                      <span>Tasa de Supervivencia:</span>
                      <span>95.2%</span>
                    </div>
                  </div>

                  {/* Perfil 2: Moderado (Percentil 85) */}
                  <div className="p-4 rounded-2xl bg-slate-950/80 border border-slate-800 flex flex-col justify-between">
                    <div>
                      <span className="text-[11px] font-extrabold text-slate-300 uppercase tracking-wide block">
                        ⚖️ Stop Loss Balanceado (P85)
                      </span>
                      <div className="flex items-baseline gap-2 mt-1">
                        <span className="text-2xl font-black font-mono text-slate-200">
                          -{focusedCoinData.recommended_sl.balanced.pct}%
                        </span>
                        <span className="text-xs font-bold font-mono text-slate-400">
                          (-${focusedCoinData.recommended_sl.balanced.usdt} USDT)
                        </span>
                      </div>
                      <p className="text-[11px] text-slate-400 mt-2 leading-relaxed">
                        Cubre el <strong>85% de las oscilaciones</strong>. Acepta que un 15% de retrocesos algo profundos te saquen a cambio de limitar pérdidas.
                      </p>
                    </div>
                    <div className="mt-3 pt-2.5 border-t border-slate-800 text-[10px] font-mono text-slate-400 flex items-center justify-between font-bold">
                      <span>Tasa de Supervivencia:</span>
                      <span>85.0%</span>
                    </div>
                  </div>

                  {/* Perfil 3: Ceñido / Scalping (Percentil 70) */}
                  <div className="p-4 rounded-2xl bg-slate-950/80 border border-slate-800 flex flex-col justify-between">
                    <div>
                      <span className="text-[11px] font-extrabold text-slate-400 uppercase tracking-wide block">
                        ⚡ Stop Loss Ceñido (P70)
                      </span>
                      <div className="flex items-baseline gap-2 mt-1">
                        <span className="text-2xl font-black font-mono text-slate-400">
                          -{focusedCoinData.recommended_sl.tight.pct}%
                        </span>
                        <span className="text-xs font-bold font-mono text-slate-500">
                          (-${focusedCoinData.recommended_sl.tight.usdt} USDT)
                        </span>
                      </div>
                      <p className="text-[11px] text-slate-500 mt-2 leading-relaxed">
                        Para scalping ultrarrápido con alto apalancamiento. Salidas rápidas con pérdidas mínimas, pero <strong>te sacará en 3 de cada 10 operaciones</strong>.
                      </p>
                    </div>
                    <div className="mt-3 pt-2.5 border-t border-slate-800 text-[10px] font-mono text-slate-500 flex items-center justify-between font-bold">
                      <span>Tasa de Supervivencia:</span>
                      <span>70.0%</span>
                    </div>
                  </div>

                </div>
              </div>

              {/* Take Profit y Trailing Stop Óptimos */}
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4 pt-2">
                
                <div className="p-4 bg-emerald-500/10 border border-emerald-500/30 rounded-2xl flex items-center justify-between">
                  <div>
                    <span className="text-[11px] font-extrabold text-emerald-300 uppercase tracking-wide flex items-center gap-1.5">
                      <span>🎯</span> Take Profit Sugerido (Rebote Óptimo)
                    </span>
                    <div className="flex items-baseline gap-2 mt-1">
                      <span className="text-2xl font-black font-mono text-emerald-400">
                        +{focusedCoinData.recommended_tp.pct}%
                      </span>
                      <span className="text-xs font-bold font-mono text-emerald-300">
                        (+${focusedCoinData.recommended_tp.usdt} USDT)
                      </span>
                    </div>
                    <p className="text-[10px] text-emerald-200/80 mt-1">
                      85% de la mediana de rebotes ({focusedCoinData.median_bounce_pct}%). Se asegura antes del agotamiento.
                    </p>
                  </div>
                  <span className="text-3xl select-none">🏆</span>
                </div>

                <div className="p-4 bg-sky-500/10 border border-sky-500/30 rounded-2xl flex items-center justify-between">
                  <div>
                    <span className="text-[11px] font-extrabold text-sky-300 uppercase tracking-wide flex items-center gap-1.5">
                      <span>📈</span> Trailing Stop Sugerido
                    </span>
                    <div className="flex items-baseline gap-2 mt-1">
                      <span className="text-sm font-bold font-mono text-sky-300">
                        Activar en: +${focusedCoinData.recommended_trailing.activation_usdt} USDT
                      </span>
                      <span className="text-xs font-mono text-slate-400">
                        (Drop: ${focusedCoinData.recommended_trailing.drop_usdt} USDT)
                      </span>
                    </div>
                    <p className="text-[10px] text-sky-200/80 mt-1">
                      Asegura ganancias si el precio sube la mitad del recorrido y comienza a retroceder.
                    </p>
                  </div>
                  <span className="text-3xl select-none">🛡️</span>
                </div>

              </div>

              {/* Barra Gráfica de Zonas (Visualización de Seguridad) */}
              <div className="bg-slate-950 p-4 rounded-2xl border border-slate-800 space-y-2 font-mono text-[11px]">
                <span className="text-[10px] font-bold text-slate-400 uppercase tracking-wider block font-sans">
                  📏 Mapa Visual de Volatilidad para {focusedCoinData.symbol}:
                </span>
                
                <div className="w-full h-7 rounded-xl bg-slate-900 border border-slate-800 flex overflow-hidden font-mono text-[10px] font-black text-slate-950 text-center leading-7">
                  <div 
                    style={{ width: '40%' }} 
                    className="bg-emerald-400/80 text-emerald-950"
                    title={`Zona de Rebote Promedio: +${focusedCoinData.avg_bounce_pct}%`}
                  >
                    TP: +{focusedCoinData.recommended_tp.pct}%
                  </div>
                  <div 
                    style={{ width: '20%' }} 
                    className="bg-amber-400 text-slate-950"
                    title="Punto de Entrada en Operación"
                  >
                    ENTRADA
                  </div>
                  <div 
                    style={{ width: '25%' }} 
                    className="bg-rose-500/30 text-rose-300 font-bold"
                    title={`Ruido Habitual de Mercado: hasta -${focusedCoinData.median_drop_pct}%`}
                  >
                    Ruido Normal: -{focusedCoinData.median_drop_pct}%
                  </div>
                  <div 
                    style={{ width: '15%' }} 
                    className="bg-rose-600 text-white"
                    title={`SL Antirruido Seguro: -${focusedCoinData.recommended_sl.anti_noise.pct}%`}
                  >
                    SL: -{focusedCoinData.recommended_sl.anti_noise.pct}%
                  </div>
                </div>

                <div className="flex items-center justify-between text-[10px] text-slate-500 pt-1">
                  <span>🟢 Zona de Beneficio</span>
                  <span>⚪ Precio de Compra</span>
                  <span>🟡 Zona Segura de Oscilación (No salir)</span>
                  <span>🔴 Stop Loss (Salida de Emergencia)</span>
                </div>
              </div>

            </div>
          )}

          {/* ============================================================== */}
          {/* 4. TABLA COMPARATIVA MULTIMONEDA                               */}
          {/* ============================================================== */}
          <div className="bg-slate-900/90 border border-slate-800 rounded-3xl p-5 sm:p-6 shadow-xl space-y-4">
            <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2 border-b border-slate-800 pb-3">
              <div>
                <h3 className="text-sm font-extrabold text-white uppercase tracking-wider flex items-center gap-2">
                  <span>📊</span> Comparativa Multimoneda & Ranking de Elasticidad
                </h3>
                <p className="text-xs text-slate-400 mt-0.5">
                  Haz clic en cualquier fila para cargar sus parámetros y gráfico detallado arriba.
                </p>
              </div>
              <span className="text-xs font-mono text-slate-500">
                {sortedCoins.length} monedas analizadas
              </span>
            </div>

            <div className="overflow-x-auto no-scrollbar">
              <table className="w-full text-left text-xs border-collapse">
                <thead>
                  <tr className="border-b border-slate-800 text-[11px] font-bold text-slate-400 uppercase tracking-wider bg-slate-950/50">
                    <th className="p-3 cursor-pointer hover:text-white" onClick={() => handleSort('symbol')}>
                      Moneda {tableSortKey === 'symbol' && (tableSortAsc ? '▲' : '▼')}
                    </th>
                    <th className="p-3 cursor-pointer hover:text-white" onClick={() => handleSort('drop')}>
                      Caída Media {tableSortKey === 'drop' && (tableSortAsc ? '▲' : '▼')}
                    </th>
                    <th className="p-3 cursor-pointer hover:text-white text-amber-300" onClick={() => handleSort('sl')}>
                      🛡️ SL Antirruido (%) {tableSortKey === 'sl' && (tableSortAsc ? '▲' : '▼')}
                    </th>
                    <th className="p-3 text-amber-300">
                      🛡️ SL (USDT)
                    </th>
                    <th className="p-3 cursor-pointer hover:text-white text-emerald-400" onClick={() => handleSort('bounce')}>
                      Rebote Medio {tableSortKey === 'bounce' && (tableSortAsc ? '▲' : '▼')}
                    </th>
                    <th className="p-3 cursor-pointer hover:text-white text-emerald-400" onClick={() => handleSort('tp')}>
                      🎯 TP Sugerido (%) {tableSortKey === 'tp' && (tableSortAsc ? '▲' : '▼')}
                    </th>
                    <th className="p-3 text-emerald-400">
                      🎯 TP (USDT)
                    </th>
                    <th className="p-3 cursor-pointer hover:text-white" onClick={() => handleSort('ratio')}>
                      Ratio Rebote/Caída {tableSortKey === 'ratio' && (tableSortAsc ? '▲' : '▼')}
                    </th>
                    <th className="p-3 cursor-pointer hover:text-white" onClick={() => handleSort('candles')}>
                      Recuperación {tableSortKey === 'candles' && (tableSortAsc ? '▲' : '▼')}
                    </th>
                    <th className="p-3">Diagnóstico</th>
                    <th className="p-3 text-right">Acción</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-800/60 font-mono">
                  {sortedCoins.map(coin => {
                    const isSelected = coin.symbol === focusedSymbol;
                    return (
                      <tr
                        key={coin.symbol}
                        onClick={() => setFocusedSymbol(coin.symbol)}
                        className={`cursor-pointer transition hover:bg-slate-800/40 ${
                          isSelected ? 'bg-amber-500/10 border-l-4 border-amber-400' : ''
                        }`}
                      >
                        <td className="p-3 font-bold text-white flex items-center gap-1.5">
                          <span>{coin.symbol}</span>
                          {isSelected && <span className="text-[10px] text-amber-400">●</span>}
                        </td>
                        <td className="p-3 text-rose-400">
                          -{coin.avg_drop_pct}%
                          <span className="text-[10px] text-slate-500 block">P50: -{coin.median_drop_pct}%</span>
                        </td>
                        <td className="p-3 font-extrabold text-amber-300">
                          -{coin.recommended_sl.anti_noise.pct}%
                        </td>
                        <td className="p-3 font-bold text-amber-400">
                          -${coin.recommended_sl.anti_noise.usdt}
                        </td>
                        <td className="p-3 text-emerald-400 font-bold">
                          +{coin.avg_bounce_pct}%
                          <span className="text-[10px] text-slate-500 block">P50: +{coin.median_bounce_pct}%</span>
                        </td>
                        <td className="p-3 font-extrabold text-emerald-400">
                          +{coin.recommended_tp.pct}%
                        </td>
                        <td className="p-3 font-bold text-emerald-300">
                          +${coin.recommended_tp.usdt}
                        </td>
                        <td className="p-3">
                          <span className={`px-2 py-0.5 rounded text-[11px] font-black ${
                            coin.elasticity_ratio >= 1.0 ? 'bg-emerald-500/20 text-emerald-400 border border-emerald-500/40' :
                            coin.elasticity_ratio >= 0.7 ? 'bg-amber-500/20 text-amber-300 border border-amber-500/40' :
                            'bg-rose-500/20 text-rose-400 border border-rose-500/40'
                          }`}>
                            {coin.elasticity_ratio}x
                          </span>
                        </td>
                        <td className="p-3 text-slate-300 text-[11px]">
                          ~{coin.avg_bounce_candles} velas
                        </td>
                        <td className="p-3 font-sans text-[11px]">
                          {coin.verdict_badge}
                        </td>
                        <td className="p-3 text-right">
                          <button
                            type="button"
                            onClick={(e) => {
                              e.stopPropagation();
                              handleCopyParameters(coin);
                            }}
                            className="px-2.5 py-1 rounded-lg bg-slate-800 hover:bg-amber-400 hover:text-slate-950 text-slate-300 text-[10px] font-bold transition"
                            title="Copiar configuración para esta moneda"
                          >
                            Copiar
                          </button>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          </div>

        </div>
      )}

      {/* Estado Inicial vacío (si aún no se ha ejecutado) */}
      {!analysisData && !isLoading && (
        <div className="p-12 text-center bg-slate-900/40 border border-dashed border-slate-800 rounded-3xl space-y-3">
          <span className="text-4xl block">📊</span>
          <h3 className="text-base font-bold text-white">Selecciona tus monedas y haz clic en Ejecutar Análisis</h3>
          <p className="text-xs text-slate-400 max-w-md mx-auto">
            El sistema descargará las velas históricas directamente de Binance Futures, medirá la amplitud de cada caída y rebote, y te devolverá el <strong>Stop Loss Antirruido exacto</strong> para configurar tu bot.
          </p>
        </div>
      )}
    </div>
  );
}
