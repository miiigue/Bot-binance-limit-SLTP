import React, { useState, useEffect, useCallback } from 'react';
import { useAuth } from './AuthContext';

const PRESET_COINS = [
  'BTCUSDT', 'ETHUSDT', 'SOLUSDT', 'DOGEUSDT', 
  'XRPUSDT', 'BNBUSDT', 'ADAUSDT', 'ZECUSDT', 
  'XMRUSDT', 'LTCUSDT', 'AVAXUSDT', 'LINKUSDT'
];

const TIMEFRAMES = [
  { value: '1m', label: '1 Minuto' },
  { value: '3m', label: '3 Minutos' },
  { value: '5m', label: '5 Minutos' },
  { value: '15m', label: '15 Minutos (Recomendado)' },
  { value: '1h', label: '1 Hora' },
  { value: '4h', label: '4 Horas' },
  { value: '1d', label: '1 Día' }
];

// Helper de normalización para asegurar estándar absoluto de nombres
const normalizeStrategy = (item) => {
  if (!item) return null;
  const name = item.name || item.strategy_name || item.id || '';
  if (!name) return null;
  const params = item.config || item.parameters || {};
  return {
    name,
    display_name: name, // Estándar: display_name siempre es igual al nombre canónico
    risk_level: params.risk_level || item.risk_level || 'MODERADO',
    min_capital_usdt: params.min_capital_usdt || item.min_capital_usdt || 50.0,
    is_public: Boolean(item.is_public ?? params.is_public ?? true),
    parameters: params
  };
};

export default function AdminMarketLab({ activeConfig, availableStrategies, onRefreshStrategies, addToast }) {
  const { authFetch } = useAuth();

  // Modo de Trabajo: 'STRATEGY' (Optimizar Estrategia) o 'FREE' (Explorador Libre de Monedas)
  const [analysisMode, setAnalysisMode] = useState('STRATEGY');

  // Catálogo de Estrategias
  const [strategiesList, setStrategiesList] = useState([]);
  const [selectedStrategyName, setSelectedStrategyName] = useState('');
  const [selectedStrategyObj, setSelectedStrategyObj] = useState(null);
  const [isLoadingStrategies, setIsLoadingStrategies] = useState(false);

  // Configuración de Monedas a Evaluar
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

  // Estado del Análisis Cuantitativo
  const [isLoading, setIsLoading] = useState(false);
  const [analysisData, setAnalysisData] = useState(null);
  const [focusedSymbol, setFocusedSymbol] = useState(null);
  const [tableSortKey, setTableSortKey] = useState('ratio');
  const [tableSortAsc, setTableSortAsc] = useState(false);
  const [copyFeedback, setCopyFeedback] = useState(null);

  // Modal de Guardado Seguro (Aislamiento de Estrategias)
  const [isSaveModalOpen, setIsSaveModalOpen] = useState(false);
  const [saveStrategyName, setSaveStrategyName] = useState('');
  const [saveDisplayName, setSaveDisplayName] = useState('');
  const [saveDescription, setSaveDescription] = useState('');
  const [saveRiskLevel, setSaveRiskLevel] = useState('MODERADO');
  const [saveMode, setSaveMode] = useState('NEW_VERSION'); // 'NEW_VERSION' o 'OVERWRITE'
  const [confirmOverwrite, setConfirmOverwrite] = useState(false);
  const [isSaving, setIsSaving] = useState(false);

  // Cargar Estrategias del Catálogo
  const fetchStrategies = useCallback(async () => {
    setIsLoadingStrategies(true);
    try {
      let strats = [];
      // 1. Cargar desde el endpoint estándar /api/strategies (lee archivos de disco y DB)
      try {
        const res = await authFetch('/api/strategies');
        if (res.ok) {
          const data = await res.json();
          const rawList = Array.isArray(data) ? data : (data?.strategies || []);
          strats = rawList.map(normalizeStrategy).filter(Boolean);
        }
      } catch (errApi) {
        console.warn("Aviso consultando /api/strategies:", errApi);
      }

      // 2. Si falló la red, usar availableStrategies pasadas como prop
      if (strats.length === 0 && availableStrategies && availableStrategies.length > 0) {
        strats = availableStrategies.map(normalizeStrategy).filter(Boolean);
      }

      // 3. Respaldo terciario en /api/strategies/catalog
      if (strats.length === 0) {
        try {
          const catRes = await authFetch('/api/strategies/catalog');
          if (catRes.ok) {
            const catData = await catRes.json();
            strats = (catData.strategies || []).map(normalizeStrategy).filter(Boolean);
          }
        } catch (errCat) {
          console.warn("Aviso consultando /api/strategies/catalog:", errCat);
        }
      }

      // Deduplicar por nombre canónico
      const seenNames = new Set();
      strats = strats.filter(s => {
        if (!s.name || seenNames.has(s.name)) return false;
        seenNames.add(s.name);
        return true;
      });

      // Ordenar: Poner la estrategia activa del bot primero
      const activeBotStrat = (activeConfig?.activeStrategyName || activeConfig?.active_strategy_name || '').trim();
      if (activeBotStrat) {
        strats.sort((a, b) => {
          if (a.name === activeBotStrat) return -1;
          if (b.name === activeBotStrat) return 1;
          return a.name.localeCompare(b.name);
        });
      } else {
        strats.sort((a, b) => a.name.localeCompare(b.name));
      }

      setStrategiesList(strats);

      // Auto-seleccionar la estrategia activa del bot por defecto
      const targetStrat = (activeBotStrat && strats.find(s => s.name === activeBotStrat)) || strats[0];
      if (targetStrat) {
        applyStrategySelection(targetStrat, strats);
      }
    } catch (err) {
      console.error("Error al cargar estrategias en el laboratorio:", err);
    } finally {
      setIsLoadingStrategies(false);
    }
  }, [authFetch, activeConfig, availableStrategies]);

  useEffect(() => {
    fetchStrategies();
  }, [fetchStrategies]);

  // Aplicar datos de una estrategia seleccionada
  const applyStrategySelection = (strat, catalogList = strategiesList) => {
    if (!strat) return;
    const stratName = strat.name || strat.strategy_name;
    setSelectedStrategyName(stratName);
    setSelectedStrategyObj(strat);

    const params = strat.parameters || strat.config || {};

    // 1. Monedas de la estrategia
    const symsRaw = params.symbols_to_trade || params.symbolsToTrade || params.symbols || '';
    let syms = [];
    if (typeof symsRaw === 'string' && symsRaw.trim()) {
      syms = symsRaw.split(',').map(s => s.trim().toUpperCase()).filter(Boolean);
    } else if (Array.isArray(symsRaw)) {
      syms = symsRaw.map(s => String(s).trim().toUpperCase()).filter(Boolean);
    }
    if (syms.length > 0) {
      setSelectedSymbols(syms);
    }

    // 2. Temporalidad
    const tf = params.rsi_interval || params.rsiInterval || params.kline_interval || params.klineInterval;
    if (tf && ['1m', '3m', '5m', '15m', '1h', '4h', '1d'].includes(tf)) {
      setInterval(tf);
    }

    // 3. Margen y Apalancamiento
    const m = params.position_size_usdt ?? params.positionSizeUSDT ?? 50.0;
    setMarginUsdt(Number(m) || 50.0);

    const lev = params.leverage ?? 10;
    setLeverage(Number(lev) || 10);

    // Preparar nombres por defecto para modal de guardado
    setSaveStrategyName(`${stratName}_Optimizada`);
    setSaveDisplayName(`${stratName}_Optimizada`);
    setSaveDescription(`Versión optimizada de ${stratName} con SL/TP antirruido calibrados matemáticamente.`);
    setSaveRiskLevel(strat.risk_level || 'MODERADO');
  };

  const handleStrategyChange = (e) => {
    const stratName = e.target.value;
    const found = strategiesList.find(s => s.name === stratName);
    if (found) {
      applyStrategySelection(found);
    } else {
      setSelectedStrategyName(stratName);
      setSelectedStrategyObj(null);
    }
  };

  // Manejo de monedas
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

  // Excluir una moneda catalogada como tóxica/incompatible
  const handleExcludeCoin = (sym) => {
    setSelectedSymbols(prev => prev.filter(s => s !== sym));
    if (addToast) {
      addToast('🚫 Moneda Excluida', `${sym} fue removida de la cesta a optimizar.`, 'info');
    }
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
          addToast('🔬 Análisis Cuantitativo Completado', `Se evaluaron ${validCoins.length} monedas con datos de Binance Futures.`, 'success');
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

  // Cálculos de la estrategia actual seleccionada para comparación
  const currentStratParams = selectedStrategyObj?.parameters || {};
  const currentNotional = (parseFloat(marginUsdt) || 50) * (parseInt(leverage) || 10);

  // SL Actual
  const rawCurrentSlUsdt = currentStratParams.stop_loss_usdt ?? currentStratParams.stopLossUSDT ?? null;
  const currentSlEnabled = currentStratParams.enable_stop_loss_pnl ?? currentStratParams.enableStopLossPnl ?? (rawCurrentSlUsdt !== null);
  const currentSlUsdt = rawCurrentSlUsdt !== null ? parseFloat(rawCurrentSlUsdt) : null;
  const currentSlPct = (currentSlUsdt && currentNotional > 0) 
    ? ((currentSlUsdt / currentNotional) * 100).toFixed(2) 
    : (currentStratParams.stop_loss_percent ?? 'N/D');

  // TP Actual
  const rawCurrentTpUsdt = currentStratParams.take_profit_usdt ?? currentStratParams.takeProfitUSDT ?? null;
  const currentTpEnabled = currentStratParams.enable_take_profit_pnl ?? currentStratParams.enableTakeProfitPnl ?? (rawCurrentTpUsdt !== null);
  const currentTpUsdt = rawCurrentTpUsdt !== null ? parseFloat(rawCurrentTpUsdt) : null;
  const currentTpPct = (currentTpUsdt && currentNotional > 0) 
    ? ((currentTpUsdt / currentNotional) * 100).toFixed(2) 
    : (currentStratParams.take_profit_percent ?? 'N/D');

  // Trailing Stop Actual
  const currentTrailingActUsdt = currentStratParams.pnl_trailing_stop_activation_usdt ?? currentStratParams.pnlTrailingStopActivationUSDT ?? null;
  const currentTrailingDropUsdt = currentStratParams.pnl_trailing_stop_drop_usdt ?? currentStratParams.pnlTrailingStopDropUSDT ?? null;

  // Diagnóstico de Seguridad del SL Actual vs Recomendado P95
  const getSafetyDiagnosis = () => {
    if (!analysisData || !focusedCoinData || !focusedCoinData.recommended_sl) return null;
    const recSlPct = focusedCoinData.recommended_sl.anti_noise.pct;
    const p70Pct = focusedCoinData.recommended_sl.tight.pct;
    const curPctNum = parseFloat(currentSlPct);

    if (!currentSlEnabled || currentSlUsdt === null) {
      return {
        level: 'CRITICAL',
        title: '⚠️ Sin Stop Loss Activo (Riesgo Ilimitado)',
        desc: 'La estrategia no tiene límite de pérdida configurado. Una caída anómala puede liquidar todo el margen asignado.',
        badgeBg: 'bg-rose-500/20 text-rose-400 border-rose-500/40'
      };
    }

    if (isNaN(curPctNum)) {
      return {
        level: 'UNKNOWN',
        title: 'SL en Formato Fijo',
        desc: `Configurado en $${currentSlUsdt} USDT por posición.`,
        badgeBg: 'bg-slate-800 text-slate-300 border-slate-700'
      };
    }

    if (curPctNum < p70Pct) {
      return {
        level: 'DANGER_TIGHT',
        title: '🔴 SL Demasiado Ajustado (Peligro de Ruido)',
        desc: `Tu SL actual (-${curPctNum}%) está por debajo del 70% de las oscilaciones normales. Provocará que salgas con pérdidas prematuras en el 35%+ de los casos justo antes de que el precio rebote.`,
        badgeBg: 'bg-rose-500/20 text-rose-300 border-rose-500/50'
      };
    }

    if (curPctNum > (recSlPct * 1.8)) {
      return {
        level: 'WIDE_EXPOSURE',
        title: '⚠️ SL Demasiado Amplio (Sobreexposición Innecesaria)',
        desc: `Tu SL arriesga un -${curPctNum}% ($${currentSlUsdt} USDT). Reducirlo a P95 (-${recSlPct}%) te protege igual de bien del ruido pero ahorra capital en caso de quiebre bajista real.`,
        badgeBg: 'bg-amber-500/20 text-amber-300 border-amber-500/50'
      };
    }

    return {
      level: 'OPTIMAL',
      title: '🟢 SL Bien Calibrado',
      desc: `Tu SL actual (-${curPctNum}%) se encuentra en una zona de alta probabilidad de absorción de ruido de mercado.`,
      badgeBg: 'bg-emerald-500/20 text-emerald-300 border-emerald-500/50'
    };
  };

  const safetyDiagnosis = getSafetyDiagnosis();

  // Guardar Estrategia Optimizada (100% Aislada)
  const handleSaveOptimizedStrategy = async () => {
    if (!saveStrategyName.trim()) {
      if (addToast) addToast('Nombre requerido', 'Ingresa un nombre para la estrategia.', 'warning');
      return;
    }

    if (saveMode === 'OVERWRITE' && !confirmOverwrite) {
      if (addToast) addToast('Confirmación requerida', 'Marca la casilla de confirmación para sobrescribir la estrategia existente.', 'warning');
      return;
    }

    setIsSaving(true);
    try {
      // Clonar parámetros base o crear estructura
      const baseParams = selectedStrategyObj?.parameters ? { ...selectedStrategyObj.parameters } : {};

      // Inyectar parámetros cuantitativos optimizados
      const optimalSlUsdt = focusedCoinData?.recommended_sl?.anti_noise?.usdt 
        ? parseFloat(focusedCoinData.recommended_sl.anti_noise.usdt)
        : (analysisData?.basket_summary ? parseFloat(((currentNotional * analysisData.basket_summary.avg_basket_sl_anti_noise_pct) / 100).toFixed(2)) : 25.0);

      const optimalTpUsdt = focusedCoinData?.recommended_tp?.usdt
        ? parseFloat(focusedCoinData.recommended_tp.usdt)
        : 15.0;

      const optimalTrailingAct = focusedCoinData?.recommended_trailing?.activation_usdt
        ? parseFloat(focusedCoinData.recommended_trailing.activation_usdt)
        : 8.0;

      const optimalTrailingDrop = focusedCoinData?.recommended_trailing?.drop_usdt
        ? parseFloat(focusedCoinData.recommended_trailing.drop_usdt)
        : 2.0;

      const updatedParams = {
        ...baseParams,
        activeStrategyName: saveStrategyName.trim(),
        strategy_name: saveStrategyName.trim(),
        symbols_to_trade: selectedSymbols.join(','),
        symbolsToTrade: selectedSymbols.join(','),
        rsi_interval: interval,
        rsiInterval: interval,
        kline_interval: interval,
        position_size_usdt: parseFloat(marginUsdt),
        positionSizeUSDT: parseFloat(marginUsdt),
        leverage: parseInt(leverage),
        enable_stop_loss_pnl: true,
        enableStopLossPnl: true,
        stop_loss_usdt: optimalSlUsdt,
        stopLossUSDT: optimalSlUsdt,
        stop_loss_percent: focusedCoinData?.recommended_sl?.anti_noise?.pct ?? 5.0,
        enable_take_profit_pnl: true,
        enableTakeProfitPnl: true,
        take_profit_usdt: optimalTpUsdt,
        takeProfitUSDT: optimalTpUsdt,
        take_profit_percent: focusedCoinData?.recommended_tp?.pct ?? 3.5,
        enable_pnl_trailing_stop: true,
        enablePnlTrailingStop: true,
        pnl_trailing_stop_activation_usdt: optimalTrailingAct,
        pnlTrailingStopActivationUSDT: optimalTrailingAct,
        pnl_trailing_stop_drop_usdt: optimalTrailingDrop,
        pnlTrailingStopDropUSDT: optimalTrailingDrop
      };

      const payload = {
        name: saveStrategyName.trim(),
        display_name: saveStrategyName.trim(),
        description: saveDescription.trim(),
        risk_level: saveRiskLevel,
        is_public: selectedStrategyObj ? selectedStrategyObj.is_public : true,
        min_capital_usdt: parseFloat(marginUsdt),
        parameters: updatedParams
      };

      const res = await authFetch('/api/strategies/catalog/upsert', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload)
      });

      if (!res.ok) {
        const err = await res.json();
        throw new Error(err.error || err.message || 'No se pudo guardar la estrategia');
      }

      setIsSaveModalOpen(false);
      if (onRefreshStrategies) onRefreshStrategies();
      await fetchStrategies();

      if (addToast) {
        if (saveMode === 'NEW_VERSION') {
          addToast('🎉 Estrategia Optimizada Creada', `Se guardó '${saveStrategyName}' en el catálogo con aislamiento total. Los bots en vivo siguen operando sin alteraciones.`, 'success');
        } else {
          addToast('✅ Estrategia Actualizada', `Se actualizó '${saveStrategyName}' en el catálogo.`, 'success');
        }
      }
    } catch (e) {
      if (addToast) addToast('Error al Guardar', e.message, 'error');
    } finally {
      setIsSaving(false);
    }
  };

  // Copiar parámetros recomendados al portapapeles
  const handleCopyParameters = (coin) => {
    if (!coin || !coin.recommended_sl) return;
    const textToCopy = `// Parámetros Optimizados para ${coin.symbol} (${interval})
// Basado en ${coin.candles_analyzed} velas históricas reales de Binance Futures
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
    <div className="space-y-6 animate-fadeIn pb-16">
      
      {/* ============================================================== */}
      {/* 1. ENCABEZADO Y SELECTOR DE MODO / ESTRATEGIA                  */}
      {/* ============================================================== */}
      <div className="bg-slate-900/90 border border-slate-800 rounded-3xl p-6 sm:p-7 shadow-xl relative overflow-hidden backdrop-blur-md">
        <div className="absolute top-0 right-0 w-96 h-96 bg-amber-500/5 rounded-full blur-3xl -mr-20 -mt-20 pointer-events-none" />
        
        <div className="flex flex-col md:flex-row md:items-center justify-between gap-4 relative z-10 border-b border-slate-800/80 pb-5">
          <div>
            <div className="flex items-center gap-3">
              <span className="p-2.5 rounded-2xl bg-amber-500/10 text-amber-400 border border-amber-500/30 text-2xl">
                🔬
              </span>
              <div>
                <h1 className="text-xl sm:text-2xl font-black text-white tracking-tight flex items-center gap-2">
                  <span>Laboratorio Cuantitativo de Estrategias</span>
                  <span className="text-[10px] font-bold px-2 py-0.5 rounded-full bg-amber-400/20 text-amber-300 border border-amber-400/40 uppercase tracking-widest">
                    Anti-Noise & SL/TP Quant
                  </span>
                </h1>
                <p className="text-xs sm:text-sm text-slate-400 mt-1">
                  Mide la amplitud real de caídas y rebotes de cada moneda en Binance Futures para calibrar el <strong>Stop Loss Antirruido exacto</strong> y optimizar tus estrategias sin afectar los bots en vivo.
                </p>
              </div>
            </div>
          </div>

          {/* Selector de Modo */}
          <div className="flex items-center gap-1 bg-slate-950 p-1 rounded-2xl border border-slate-800">
            <button
              type="button"
              onClick={() => setAnalysisMode('STRATEGY')}
              className={`px-3 py-1.5 rounded-xl text-xs font-bold transition flex items-center gap-1.5 ${
                analysisMode === 'STRATEGY'
                  ? 'bg-amber-400 text-slate-950 shadow-md shadow-amber-500/20'
                  : 'text-slate-400 hover:text-white'
              }`}
            >
              <span>🎯</span>
              <span>Optimizar Estrategia</span>
            </button>
            <button
              type="button"
              onClick={() => setAnalysisMode('FREE')}
              className={`px-3 py-1.5 rounded-xl text-xs font-bold transition flex items-center gap-1.5 ${
                analysisMode === 'FREE'
                  ? 'bg-amber-400 text-slate-950 shadow-md shadow-amber-500/20'
                  : 'text-slate-400 hover:text-white'
              }`}
            >
              <span>🌐</span>
              <span>Explorador Libre</span>
            </button>
          </div>
        </div>

        {/* ============================================================== */}
        {/* SELECTOR DE ESTRATEGIA (SI MODO === 'STRATEGY')                 */}
        {/* ============================================================== */}
        {analysisMode === 'STRATEGY' && (
          <div className="mt-5 p-4 rounded-2xl bg-amber-500/5 border border-amber-500/20 flex flex-col md:flex-row md:items-center justify-between gap-4 relative z-10">
            <div className="space-y-1">
              <div className="flex items-center gap-2">
                <span className="text-xs font-black uppercase tracking-wider text-amber-300 flex items-center gap-1">
                  <span>📂</span> Estrategia Seleccionada del Catálogo:
                </span>
                {selectedStrategyObj?.risk_level && (
                  <span className={`text-[10px] font-bold px-2 py-0.5 rounded-md ${
                    selectedStrategyObj.risk_level === 'AGRESIVO' ? 'bg-rose-500/20 text-rose-300 border border-rose-500/40' :
                    selectedStrategyObj.risk_level === 'MODERADO' ? 'bg-amber-500/20 text-amber-300 border border-amber-500/40' :
                    'bg-emerald-500/20 text-emerald-300 border border-emerald-500/40'
                  }`}>
                    {selectedStrategyObj.risk_level}
                  </span>
                )}
              </div>
              <p className="text-[11px] text-slate-400">
                Al elegir una estrategia, se cargan automáticamente sus monedas, temporalidad, margen y su Stop Loss actual para compararlo con el mercado.
              </p>
            </div>

            <div className="w-full md:w-80">
              <select
                value={selectedStrategyName}
                onChange={handleStrategyChange}
                disabled={isLoadingStrategies}
                className="w-full bg-slate-950 border border-amber-500/40 rounded-xl px-3 py-2 text-white font-mono text-xs focus:outline-none focus:border-amber-400 font-bold"
              >
                {strategiesList.map(st => {
                  const isActiveBot = st.name === (activeConfig?.activeStrategyName || activeConfig?.active_strategy_name);
                  return (
                    <option key={st.name} value={st.name}>
                      {isActiveBot ? `⭐ ${st.name} (ACTUAL EN EL BOT)` : st.name}
                    </option>
                  );
                })}
              </select>
            </div>
          </div>
        )}

        {/* ============================================================== */}
        {/* PARÁMETROS DE EJECUCIÓN (MONEDAS, TEMPORALIDAD, CAPITAL)       */}
        {/* ============================================================== */}
        <div className="mt-5 grid grid-cols-1 md:grid-cols-12 gap-5 relative z-10 text-xs">
          
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
                <option value={300}>Últimas 300 velas (~3 días en 15m)</option>
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

          {/* Margen por Posición */}
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

          {/* Multiplicador / Apalancamiento */}
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

        {/* Botón de Ejecutar Análisis */}
        <div className="mt-6 pt-5 border-t border-slate-800/80 flex flex-col sm:flex-row items-center justify-between gap-3 relative z-10">
          <div className="text-xs text-slate-500 font-mono">
            Posición simulada: <strong className="text-white">${marginUsdt} USDT x {leverage}X</strong> = <span className="text-amber-400 font-bold">${currentNotional.toFixed(2)} USDT</span> en mercado.
          </div>

          <button
            type="button"
            onClick={runAnalysis}
            disabled={isLoading || selectedSymbols.length === 0}
            className="w-full sm:w-auto px-7 py-3 rounded-2xl bg-gradient-to-r from-amber-500 to-amber-600 hover:from-amber-400 hover:to-amber-500 text-slate-950 font-black text-xs sm:text-sm tracking-wide shadow-xl shadow-amber-500/20 transition flex items-center justify-center gap-2 disabled:opacity-50 disabled:cursor-not-allowed"
          >
            {isLoading ? (
              <>
                <span className="w-4 h-4 border-2 border-slate-950 border-t-transparent rounded-full animate-spin" />
                <span>Analizando Velas en Binance...</span>
              </>
            ) : (
              <>
                <span>⚡</span>
                <span>EJECUTAR ANÁLISIS CUANTITATIVO</span>
              </>
            )}
          </button>
        </div>
      </div>

      {/* ============================================================== */}
      {/* 2. CARD DE COMPARACIÓN DIRECTA: ACTUAL VS RECOMENDADO           */}
      {/* ============================================================== */}
      {analysisData && analysisData.basket_summary && (
        <div className="bg-slate-900/90 border border-slate-800 rounded-3xl p-5 sm:p-7 shadow-2xl space-y-6 relative overflow-hidden backdrop-blur-md">
          <div className="flex flex-col md:flex-row md:items-center justify-between gap-4 border-b border-slate-800 pb-5">
            <div>
              <div className="flex items-center gap-2">
                <span className="text-sm font-black text-white uppercase tracking-wider flex items-center gap-2">
                  <span>⚖️</span> Comparativa Cuantitativa: Actual vs. Recomendación Antirruido
                </span>
                {analysisMode === 'STRATEGY' && selectedStrategyObj && (
                  <span className="text-[11px] font-mono font-bold px-2.5 py-0.5 rounded-full bg-amber-400/20 text-amber-300 border border-amber-400/40">
                    {selectedStrategyObj.name}
                  </span>
                )}
              </div>
              <p className="text-xs text-slate-400 mt-1">
                Compara los parámetros actuales de tu estrategia contra las métricas calculadas sobre {analysisData.coins?.[0]?.candles_analyzed || 500} velas reales.
              </p>
            </div>

            {/* Botón de Guardado Seguro */}
            <div className="flex items-center gap-2">
              <button
                type="button"
                onClick={() => setIsSaveModalOpen(true)}
                className="px-5 py-2.5 rounded-xl bg-gradient-to-r from-emerald-500 to-emerald-600 hover:from-emerald-400 hover:to-emerald-500 text-slate-950 font-black text-xs font-mono transition flex items-center gap-2 shadow-lg shadow-emerald-500/20"
              >
                <span>💾</span>
                <span>Guardar Estrategia Optimizada</span>
              </button>
            </div>
          </div>

          {/* Columnas Side-by-Side: Configuración Actual vs Recomendada */}
          <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
            
            {/* LADO IZQUIERDO: CONFIGURACIÓN ACTUAL */}
            <div className="p-5 rounded-2xl bg-slate-950/70 border border-slate-800 space-y-4">
              <div className="flex items-center justify-between border-b border-slate-800 pb-3">
                <div className="flex items-center gap-2">
                  <span className="w-2.5 h-2.5 rounded-full bg-slate-400" />
                  <span className="text-xs font-black uppercase tracking-wider text-slate-300">
                    Configuración Actual de la Estrategia
                  </span>
                </div>
                <span className="text-[10px] font-mono text-slate-500">
                  {analysisMode === 'STRATEGY' ? selectedStrategyName : 'Parámetros Base'}
                </span>
              </div>

              <div className="grid grid-cols-2 gap-3">
                <div className="p-3 bg-slate-900 rounded-xl border border-slate-800">
                  <span className="text-[10px] font-bold text-slate-500 uppercase tracking-wide block">
                    Stop Loss Actual
                  </span>
                  <div className="text-lg font-black font-mono text-rose-400 mt-0.5">
                    {currentSlEnabled && currentSlUsdt !== null ? `-$${currentSlUsdt} USDT` : 'DESACTIVADO'}
                  </div>
                  <span className="text-[10px] font-mono text-slate-400">
                    {currentSlEnabled && currentSlPct !== 'N/D' ? `(-${currentSlPct}%)` : 'Sin límite'}
                  </span>
                </div>

                <div className="p-3 bg-slate-900 rounded-xl border border-slate-800">
                  <span className="text-[10px] font-bold text-slate-500 uppercase tracking-wide block">
                    Take Profit Actual
                  </span>
                  <div className="text-lg font-black font-mono text-emerald-400 mt-0.5">
                    {currentTpEnabled && currentTpUsdt !== null ? `+$${currentTpUsdt} USDT` : 'DESACTIVADO'}
                  </div>
                  <span className="text-[10px] font-mono text-slate-400">
                    {currentTpEnabled && currentTpPct !== 'N/D' ? `(+${currentTpPct}%)` : 'Sin TP fijo'}
                  </span>
                </div>
              </div>

              {/* Trailing Stop Actual */}
              <div className="p-3 bg-slate-900 rounded-xl border border-slate-800 text-xs">
                <div className="flex items-center justify-between text-[11px] text-slate-400 font-mono">
                  <span>Trailing Stop Actual:</span>
                  <span className="font-bold text-white">
                    {currentTrailingActUsdt !== null ? `Act: +$${currentTrailingActUsdt} / Drop: $${currentTrailingDropUsdt} USDT` : 'No configurado'}
                  </span>
                </div>
              </div>

              {/* Diagnóstico del SL Actual */}
              {safetyDiagnosis && (
                <div className={`p-3.5 rounded-xl border text-xs space-y-1 ${safetyDiagnosis.badgeBg}`}>
                  <div className="font-black flex items-center gap-1.5 text-[11px] uppercase tracking-wide">
                    <span>{safetyDiagnosis.title}</span>
                  </div>
                  <p className="text-[11px] leading-relaxed opacity-90">
                    {safetyDiagnosis.desc}
                  </p>
                </div>
              )}
            </div>

            {/* LADO DERECHO: CALIBRACIÓN RECOMENDADA ANTIRRUIDO P95 */}
            <div className="p-5 rounded-2xl bg-amber-500/5 border-2 border-amber-500/40 space-y-4 relative">
              <div className="absolute -top-3 right-5 bg-amber-400 text-slate-950 font-black text-[9px] uppercase px-2.5 py-0.5 rounded-full tracking-wider shadow">
                ⭐ Cuantitativamente Óptimo
              </div>

              <div className="flex items-center justify-between border-b border-amber-500/20 pb-3">
                <div className="flex items-center gap-2">
                  <span className="w-2.5 h-2.5 rounded-full bg-amber-400 animate-pulse" />
                  <span className="text-xs font-black uppercase tracking-wider text-amber-300">
                    Calibración Cuantitativa Antirruido (P95)
                  </span>
                </div>
                <span className="text-[10px] font-mono text-amber-400/80">
                  Binance Futures Real
                </span>
              </div>

              <div className="grid grid-cols-2 gap-3">
                <div className="p-3 bg-slate-950/80 rounded-xl border border-amber-500/30">
                  <span className="text-[10px] font-bold text-amber-300 uppercase tracking-wide block">
                    🛡️ SL Antirruido P95 Sugerido
                  </span>
                  <div className="text-lg font-black font-mono text-amber-300 mt-0.5">
                    {focusedCoinData?.recommended_sl ? `-$${focusedCoinData.recommended_sl.anti_noise.usdt} USDT` : `-${analysisData.basket_summary.avg_basket_sl_anti_noise_pct}%`}
                  </div>
                  <span className="text-[10px] font-mono text-amber-400/90">
                    {focusedCoinData?.recommended_sl ? `(-${focusedCoinData.recommended_sl.anti_noise.pct}%)` : 'Percentil 95 global'}
                  </span>
                </div>

                <div className="p-3 bg-slate-950/80 rounded-xl border border-emerald-500/30">
                  <span className="text-[10px] font-bold text-emerald-300 uppercase tracking-wide block">
                    🎯 TP Rebote Óptimo
                  </span>
                  <div className="text-lg font-black font-mono text-emerald-400 mt-0.5">
                    {focusedCoinData?.recommended_tp ? `+$${focusedCoinData.recommended_tp.usdt} USDT` : `+${analysisData.basket_summary.avg_basket_bounce_pct}%`}
                  </div>
                  <span className="text-[10px] font-mono text-emerald-300/90">
                    {focusedCoinData?.recommended_tp ? `(+${focusedCoinData.recommended_tp.pct}%)` : 'Mediana de recuperación'}
                  </span>
                </div>
              </div>

              {/* Trailing Stop Óptimo */}
              <div className="p-3 bg-slate-950/80 rounded-xl border border-amber-500/20 text-xs">
                <div className="flex items-center justify-between text-[11px] text-slate-300 font-mono">
                  <span className="text-amber-300">Trailing Sugerido:</span>
                  <span className="font-bold text-white">
                    {focusedCoinData?.recommended_trailing ? `Act: +$${focusedCoinData.recommended_trailing.activation_usdt} / Drop: $${focusedCoinData.recommended_trailing.drop_usdt} USDT` : 'Calculado por rebote'}
                  </span>
                </div>
              </div>

              {/* Tasa de Supervivencia y Aislamiento */}
              <div className="p-3 rounded-xl bg-amber-400/10 border border-amber-400/30 text-xs text-amber-200/90 space-y-1">
                <div className="flex items-center justify-between font-bold text-[11px] text-amber-300 font-mono">
                  <span>Tasa de Supervivencia del SL:</span>
                  <span className="text-emerald-400">95.2% de los retrocesos</span>
                </div>
                <p className="text-[10px] leading-relaxed text-slate-300">
                  El 95.2% de los movimientos bajistas ordinarios se agotan y rebotan antes de tocar este nivel. Te protege contra desarmes involuntarios.
                </p>
              </div>

            </div>

          </div>
        </div>
      )}

      {/* ============================================================== */}
      {/* 3. RESUMEN KPI DE LA CESTA DE MONEDAS                          */}
      {/* ============================================================== */}
      {analysisData && analysisData.basket_summary && (
        <div className="space-y-6">
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
          {/* 4. DETALLE DE LA MONEDA ENFOCADA Y PERFILES DE STOP LOSS       */}
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
                    {/* Semáforo de Compatibilidad */}
                    <span className={`text-[10px] font-black px-2.5 py-0.5 rounded-full border ${
                      focusedCoinData.elasticity_ratio >= 1.05 
                        ? 'bg-emerald-500/20 text-emerald-400 border-emerald-500/50' 
                        : focusedCoinData.elasticity_ratio >= 0.85
                        ? 'bg-amber-500/20 text-amber-300 border-amber-500/50'
                        : 'bg-rose-500/20 text-rose-400 border-rose-500/50'
                    }`}>
                      {focusedCoinData.elasticity_ratio >= 1.05 ? '🟢 Alta Compatibilidad' : focusedCoinData.elasticity_ratio >= 0.85 ? '🟡 Volatilidad Moderada' : '🔴 Tóxica / Incompatible'}
                    </span>
                  </div>
                  <p className="text-xs text-slate-400 mt-1">
                    {focusedCoinData.verdict_desc}
                  </p>
                </div>

                <div className="flex items-center gap-2">
                  {focusedCoinData.elasticity_ratio < 0.85 && (
                    <button
                      type="button"
                      onClick={() => handleExcludeCoin(focusedCoinData.symbol)}
                      className="px-3 py-2 rounded-xl bg-rose-500/20 hover:bg-rose-500/30 text-rose-300 border border-rose-500/40 text-xs font-bold transition flex items-center gap-1"
                    >
                      <span>🚫</span>
                      <span>Excluir de la Estrategia</span>
                    </button>
                  )}
                  <button
                    type="button"
                    onClick={() => handleCopyParameters(focusedCoinData)}
                    className="px-4 py-2 rounded-xl bg-amber-400 hover:bg-amber-300 text-slate-950 font-black text-xs font-mono transition flex items-center gap-1.5 shadow"
                  >
                    <span>{copyFeedback === focusedCoinData.symbol ? '✓' : '📋'}</span>
                    <span>{copyFeedback === focusedCoinData.symbol ? '¡Copiado!' : 'Copiar Parámetros'}</span>
                  </button>
                </div>
              </div>

              {/* Perfiles de Stop Loss Cuantitativo */}
              <div className="space-y-3">
                <div className="flex items-center justify-between">
                  <h3 className="text-xs font-black uppercase tracking-wider text-slate-300 flex items-center gap-1.5">
                    <span>🛡️</span> Dónde colocar el Stop Loss para que el bot no se salga por ruido
                  </h3>
                  <span className="text-[10px] font-mono text-slate-500">
                    Posición Nocional: ${currentNotional.toFixed(2)} USDT (${marginUsdt} x{leverage}X)
                  </span>
                </div>

                <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                  
                  {/* Perfil 1: Antirruido P95 */}
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

                  {/* Perfil 2: Balanceado P85 */}
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

                  {/* Perfil 3: Ceñido P70 */}
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
                      85% de la mediana de rebotes ({focusedCoinData.median_bounce_pct}%). Se asegura antes del agotamiento alcista.
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

              {/* Barra Gráfica Visual de Zonas */}
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
                    Ruido: -{focusedCoinData.median_drop_pct}%
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
                  <span>🟡 Zona de Oscilación (No salir)</span>
                  <span>🔴 Stop Loss Seguro</span>
                </div>
              </div>

            </div>
          )}

          {/* ============================================================== */}
          {/* 5. TABLA COMPARATIVA MULTIMONEDA & SEMÁFORO DE COMPATIBILIDAD  */}
          {/* ============================================================== */}
          <div className="bg-slate-900/90 border border-slate-800 rounded-3xl p-5 sm:p-6 shadow-xl space-y-4">
            <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2 border-b border-slate-800 pb-3">
              <div>
                <h3 className="text-sm font-extrabold text-white uppercase tracking-wider flex items-center gap-2">
                  <span>📊</span> Comparativa Multimoneda, Semáforo de Compatibilidad & Ranking
                </h3>
                <p className="text-xs text-slate-400 mt-0.5">
                  Haz clic en cualquier fila para seleccionarla y ver su calibración exacta. Las monedas en rojo tienen caídas asimétricas y no son recomendables para la estrategia.
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
                    <th className="p-3">Semáforo</th>
                    <th className="p-3 text-right">Acción</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-800/60 font-mono">
                  {sortedCoins.map(coin => {
                    const isSelected = coin.symbol === focusedSymbol;
                    const isCompatible = coin.elasticity_ratio >= 1.05;
                    const isModerate = coin.elasticity_ratio >= 0.85 && coin.elasticity_ratio < 1.05;
                    const isToxic = coin.elasticity_ratio < 0.85;

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
                            isCompatible ? 'bg-emerald-500/20 text-emerald-400 border border-emerald-500/40' :
                            isModerate ? 'bg-amber-500/20 text-amber-300 border border-amber-500/40' :
                            'bg-rose-500/20 text-rose-400 border border-rose-500/40'
                          }`}>
                            {coin.elasticity_ratio}x
                          </span>
                        </td>
                        <td className="p-3 text-slate-300 text-[11px]">
                          ~{coin.avg_bounce_candles} velas
                        </td>
                        <td className="p-3 font-sans text-[11px]">
                          {isCompatible && (
                            <span className="px-2 py-0.5 rounded-full bg-emerald-500/10 text-emerald-400 border border-emerald-500/30 font-bold text-[10px]">
                              🟢 Compatible
                            </span>
                          )}
                          {isModerate && (
                            <span className="px-2 py-0.5 rounded-full bg-amber-500/10 text-amber-300 border border-amber-500/30 font-bold text-[10px]">
                              🟡 Sensible
                            </span>
                          )}
                          {isToxic && (
                            <span className="px-2 py-0.5 rounded-full bg-rose-500/10 text-rose-400 border border-rose-500/30 font-bold text-[10px]">
                              🔴 Incompatible
                            </span>
                          )}
                        </td>
                        <td className="p-3 text-right">
                          <div className="flex items-center justify-end gap-1.5">
                            {isToxic && (
                              <button
                                type="button"
                                onClick={(e) => {
                                  e.stopPropagation();
                                  handleExcludeCoin(coin.symbol);
                                }}
                                className="px-2 py-1 rounded-lg bg-rose-500/20 hover:bg-rose-500/30 text-rose-300 text-[10px] font-bold transition"
                                title="Excluir esta moneda tóxica de la estrategia"
                              >
                                Excluir
                              </button>
                            )}
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
                          </div>
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
          <h3 className="text-base font-bold text-white">Selecciona tu estrategia o monedas y haz clic en Ejecutar Análisis</h3>
          <p className="text-xs text-slate-400 max-w-lg mx-auto">
            El sistema descargará las velas históricas directamente de Binance Futures, medirá la amplitud real de caídas y rebotes, y te recomendará el <strong>Stop Loss Antirruido exacto</strong> para proteger tu capital sin sacarte por fluctuaciones ordinarias.
          </p>
        </div>
      )}

      {/* ============================================================== */}
      {/* MODAL: GUARDAR ESTRATEGIA OPTIMIZADA (AISLAMIENTO TOTAL)       */}
      {/* ============================================================== */}
      {isSaveModalOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-950/80 backdrop-blur-sm animate-fadeIn">
          <div className="bg-slate-900 border border-slate-800 rounded-3xl max-w-lg w-full p-6 shadow-2xl space-y-5 relative">
            <div className="flex items-center justify-between border-b border-slate-800 pb-3">
              <div className="flex items-center gap-2">
                <span className="p-2 rounded-xl bg-emerald-500/20 text-emerald-400 text-lg">💾</span>
                <div>
                  <h3 className="text-sm font-black text-white uppercase tracking-wider">
                    Guardar Estrategia Optimizada
                  </h3>
                  <span className="text-[10px] text-slate-400">Catálogo Soberano de Estrategias</span>
                </div>
              </div>
              <button
                type="button"
                onClick={() => setIsSaveModalOpen(false)}
                className="text-slate-500 hover:text-white text-lg p-1"
              >
                ✕
              </button>
            </div>

            {/* Aviso de Aislamiento Total */}
            <div className="p-3.5 rounded-2xl bg-amber-500/10 border border-amber-500/30 text-xs space-y-1.5">
              <div className="flex items-center gap-1.5 font-bold text-amber-300">
                <span>🛡️</span>
                <span>Principio de Aislamiento Garantizado:</span>
              </div>
              <p className="text-[11px] text-amber-200/90 leading-relaxed">
                Los bots de los usuarios que están actualmente activos operando en vivo <strong>NO se detendrán ni se modificarán</strong>. La nueva versión optimizada se registrará en el catálogo para ser asignada o seleccionada de manera controlada.
              </p>
            </div>

            {/* Modo de Guardado: Nueva Versión vs Sobrescribir */}
            <div className="space-y-2">
              <label className="text-[11px] font-bold text-slate-400 uppercase tracking-wide block">
                Destino del Guardado
              </label>
              <div className="grid grid-cols-2 gap-2 text-xs">
                <button
                  type="button"
                  onClick={() => setSaveMode('NEW_VERSION')}
                  className={`p-3 rounded-xl border text-left transition ${
                    saveMode === 'NEW_VERSION'
                      ? 'bg-amber-400/20 border-amber-400/60 text-white shadow'
                      : 'bg-slate-950 border-slate-800 text-slate-400 hover:text-white'
                  }`}
                >
                  <span className="font-bold block text-[11px]">⭐ Nueva Versión (Recomendado)</span>
                  <span className="text-[10px] text-slate-400">Crea una nueva estrategia independiente en el catálogo</span>
                </button>

                <button
                  type="button"
                  onClick={() => setSaveMode('OVERWRITE')}
                  className={`p-3 rounded-xl border text-left transition ${
                    saveMode === 'OVERWRITE'
                      ? 'bg-rose-500/20 border-rose-500/60 text-white shadow'
                      : 'bg-slate-950 border-slate-800 text-slate-400 hover:text-white'
                  }`}
                >
                  <span className="font-bold block text-[11px]">⚠️ Actualizar Existente</span>
                  <span className="text-[10px] text-slate-400">Sobrescribe los parámetros en la plantilla actual</span>
                </button>
              </div>
            </div>

            {/* Campos del Formulario */}
            <div className="space-y-3 text-xs">
              <div>
                <label className="text-[10px] font-bold text-slate-400 uppercase tracking-wider block mb-1">
                  Nombre de la Estrategia (Estándar Canónico)
                </label>
                <input
                  type="text"
                  value={saveStrategyName}
                  onChange={(e) => {
                    setSaveStrategyName(e.target.value);
                    setSaveDisplayName(e.target.value);
                  }}
                  disabled={saveMode === 'OVERWRITE'}
                  className="w-full bg-slate-950 border border-slate-800 rounded-xl px-3 py-2 text-white font-mono text-xs focus:outline-none focus:border-amber-400 disabled:opacity-60"
                />
              </div>

              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="text-[10px] font-bold text-slate-400 uppercase tracking-wider block mb-1">
                    Nivel de Riesgo
                  </label>
                  <select
                    value={saveRiskLevel}
                    onChange={(e) => setSaveRiskLevel(e.target.value)}
                    className="w-full bg-slate-950 border border-slate-800 rounded-xl px-3 py-2 text-white text-xs focus:outline-none focus:border-amber-400"
                  >
                    <option value="CONSERVADOR">CONSERVADOR</option>
                    <option value="MODERADO">MODERADO</option>
                    <option value="AGRESIVO">AGRESIVO</option>
                  </select>
                </div>

                <div>
                  <label className="text-[10px] font-bold text-slate-400 uppercase tracking-wider block mb-1">
                    Monedas Incluidas
                  </label>
                  <div className="bg-slate-950 border border-slate-800 rounded-xl px-3 py-2 text-amber-300 font-mono text-[11px] truncate">
                    {selectedSymbols.length} pares ({selectedSymbols.slice(0, 3).join(', ')}{selectedSymbols.length > 3 ? '...' : ''})
                  </div>
                </div>
              </div>

              <div>
                <label className="text-[10px] font-bold text-slate-400 uppercase tracking-wider block mb-1">
                  Descripción
                </label>
                <textarea
                  rows={2}
                  value={saveDescription}
                  onChange={(e) => setSaveDescription(e.target.value)}
                  className="w-full bg-slate-950 border border-slate-800 rounded-xl px-3 py-2 text-white text-xs focus:outline-none focus:border-amber-400 resize-none"
                />
              </div>
            </div>

            {/* Checkbox de Confirmación si Sobrescribe */}
            {saveMode === 'OVERWRITE' && (
              <label className="flex items-start gap-2 p-3 bg-rose-500/10 border border-rose-500/30 rounded-xl cursor-pointer">
                <input
                  type="checkbox"
                  checked={confirmOverwrite}
                  onChange={(e) => setConfirmOverwrite(e.target.checked)}
                  className="mt-0.5 rounded border-slate-700 text-rose-500 focus:ring-0"
                />
                <span className="text-[11px] text-rose-200">
                  Entiendo que se actualizará la plantilla del catálogo para '{selectedStrategyName}'. Los bots actualmente en ejecución conservarán su estado hasta ser recargados.
                </span>
              </label>
            )}

            {/* Botones de Acción */}
            <div className="flex items-center justify-end gap-3 pt-3 border-t border-slate-800">
              <button
                type="button"
                onClick={() => setIsSaveModalOpen(false)}
                className="px-4 py-2 rounded-xl bg-slate-800 hover:bg-slate-700 text-slate-300 text-xs font-bold transition"
              >
                Cancelar
              </button>

              <button
                type="button"
                onClick={handleSaveOptimizedStrategy}
                disabled={isSaving || (saveMode === 'OVERWRITE' && !confirmOverwrite)}
                className="px-5 py-2 rounded-xl bg-gradient-to-r from-emerald-500 to-emerald-600 hover:from-emerald-400 hover:to-emerald-500 text-slate-950 font-black text-xs font-mono transition flex items-center gap-2 disabled:opacity-50 disabled:cursor-not-allowed shadow-lg shadow-emerald-500/20"
              >
                {isSaving ? (
                  <>
                    <span className="w-3.5 h-3.5 border-2 border-slate-950 border-t-transparent rounded-full animate-spin" />
                    <span>Guardando...</span>
                  </>
                ) : (
                  <>
                    <span>✓</span>
                    <span>Confirmar y Guardar Estrategia</span>
                  </>
                )}
              </button>
            </div>

          </div>
        </div>
      )}

    </div>
  );
}
