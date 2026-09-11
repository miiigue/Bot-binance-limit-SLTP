import React, { useState, useEffect, useMemo } from 'react';
import BinanceSortHeader, { sortTableData } from './BinanceSortHeader';
import Tooltip from './Tooltip';

// Mapeador para asegurar que en la interfaz aparezcan nombres legibles y nunca variables técnicas crudas
const cleanUserFacingText = (text) => {
  if (!text || typeof text !== 'string') return text;
  return text
    .replace(/`?enableStopLossPnl`?(?::\s*false)?/gi, '"Stop Loss Fijo (USDT)"')
    .replace(/`?enableTakeProfitPnl`?(?::\s*false)?/gi, '"Take Profit Fijo (USDT)"')
    .replace(/`?stopLossUSDT`?/gi, '"Stop Loss (USDT)"')
    .replace(/`?takeProfitUSDT`?/gi, '"Take Profit (USDT)"')
    .replace(/`?enableDcaReentry`?/gi, '"Re-entradas y Órdenes de Seguridad (DCA)"')
    .replace(/`?dcaMaxReentries`?/gi, '"Límite de Recompras DCA"')
    .replace(/`?dcaPriceDropPercent`?/gi, '"Porcentaje de Caída para Recompra"')
    .replace(/`?dcaVolumeMultiplier`?/gi, '"Multiplicador de Volumen DCA"')
    .replace(/`?positionSizeUSDT`?/gi, '"Tamaño de Posición"')
    .replace(/`?leverage`?/gi, '"Apalancamiento"');
};

// Componente de Insignias / Píldoras Técnicas de Estrategia (igual a Configuración)
export function StrategyBadgesPills({ config }) {
  if (!config || Object.keys(config).length === 0) return null;
  const cfg = config;

  const symbolsStr = cfg.symbolsToTrade || cfg.symbols_to_trade || '';
  const symbolsCount = symbolsStr ? symbolsStr.split(',').map(s => s.trim()).filter(Boolean).length : 0;
  const leverage = cfg.leverage;
  const posSize = cfg.positionSizeUSDT ?? cfg.position_size_usdt;
  const interval = cfg.rsiInterval ?? cfg.rsi_interval ?? '1m';
  const rsiPeriod = cfg.rsiPeriod ?? cfg.rsi_period;
  const rsiType = String(cfg.rsiType ?? cfg.rsi_type ?? 'WILDER').toUpperCase();
  const evalDelta = cfg.evaluateRsiDelta ?? cfg.evaluate_rsi_delta;
  const thresholdUp = cfg.rsiThresholdUp ?? cfg.rsi_threshold_up;
  const evalRange = cfg.evaluateRsiRange ?? cfg.evaluate_rsi_range;
  const rsiLow = cfg.rsiEntryLevelLow ?? cfg.rsi_entry_level_low;
  const rsiHigh = cfg.rsiEntryLevelHigh ?? cfg.rsi_entry_level_high;
  
  const tpVal = cfg.takeProfitUSDT ?? cfg.take_profit_usdt;
  const isTpEnabled = cfg.enableTakeProfitPnl === true || String(cfg.enableTakeProfitPnl).toLowerCase() === 'true' || (tpVal !== undefined && Number(tpVal) > 0);
  
  const slVal = cfg.stopLossUSDT ?? cfg.stop_loss_usdt;
  const isSlEnabled = cfg.enableStopLossPnl === true || String(cfg.enableStopLossPnl).toLowerCase() === 'true';
  const numSl = Math.abs(Number(slVal));

  const isTrailingPnl = cfg.enablePnlTrailingStop === true || String(cfg.enablePnlTrailingStop).toLowerCase() === 'true';
  const pnlAct = cfg.pnlTrailingStopActivationUSDT ?? cfg.pnl_trailing_stop_activation_usdt;
  const pnlDrop = cfg.pnlTrailingStopDropUSDT ?? cfg.pnl_trailing_stop_drop_usdt;

  const isTrailingPrice = cfg.enablePriceTrailingStop === true || String(cfg.enablePriceTrailingStop).toLowerCase() === 'true';
  const priceDist = cfg.priceTrailingStopDistanceUSDT ?? cfg.price_trailing_stop_distance_usdt;

  const isTrailingRsi = cfg.enableTrailingRsiStop === true || String(cfg.enableTrailingRsiStop).toLowerCase() === 'true';
  const rsiTarget = cfg.rsiTarget ?? cfg.rsi_target;

  const isDca = cfg.enableDcaReentry === true || String(cfg.enableDcaReentry).toLowerCase() === 'true';
  const dcaMax = cfg.dcaMaxReentries ?? cfg.dca_max_reentries ?? 1;
  const dcaDrop = cfg.dcaPriceDropPercent ?? cfg.dca_price_drop_percent ?? 2.0;
  const dcaMult = cfg.dcaVolumeMultiplier ?? cfg.dca_volume_multiplier ?? 1.0;
  const dcaMode = cfg.dcaReentryMode ?? cfg.dca_reentry_mode;

  const evalMa = cfg.evaluateMaFilter ?? cfg.evaluate_ma_filter;
  const maType = cfg.maType ?? cfg.ma_type ?? 'EMA';
  const maPeriod = cfg.maPeriod ?? cfg.ma_period ?? 50;

  const evalVol = cfg.evaluateVolumeFilter ?? cfg.evaluate_volume_filter;
  const volFactor = cfg.volumeFactor ?? cfg.volume_factor ?? 1.1;

  const cycleSec = cfg.cycleSleepSeconds ?? cfg.cycle_sleep_seconds;
  const orderType = String(cfg.entryOrderType ?? cfg.entry_order_type ?? 'LIMIT').toUpperCase();

  return (
    <div className="flex flex-wrap items-center gap-1.5">
      {/* Tipo de Orden */}
      <span className={`inline-flex items-center px-2 py-0.5 rounded text-[11px] font-semibold shadow-sm ${
        orderType === 'MARKET' 
          ? 'bg-amber-950/80 text-amber-300 border border-amber-600/60' 
          : 'bg-teal-950/80 text-teal-300 border border-teal-700/60'
      }`} title={orderType === 'MARKET' ? 'Entrada y salida a mercado (instantánea, igual a backtesting)' : 'Entrada y salida límite al mejor precio (Maker 0.02%)'}>
        {orderType === 'MARKET' ? '⚡ MARKET' : '🎯 LIMIT'}
      </span>

      {/* Monedas */}
      {symbolsCount > 0 && (
        <span className="inline-flex items-center px-2 py-0.5 rounded text-[11px] font-semibold bg-amber-950/80 text-amber-300 border border-amber-700/60 shadow-sm" title={`Lista de ${symbolsCount} monedas guardadas`}>
          🪙 {symbolsCount} {symbolsCount === 1 ? 'moneda' : 'monedas'}
        </span>
      )}

      {/* Margen y Apalancamiento */}
      {posSize && (
        <span className="inline-flex items-center px-2 py-0.5 rounded text-[11px] font-semibold bg-emerald-950/80 text-emerald-300 border border-emerald-700/60 shadow-sm" title="Margen y Apalancamiento">
          💵 {leverage ? `${leverage}x • ` : ''}${posSize} USDT
        </span>
      )}

      {/* RSI Intervalo y Período */}
      {rsiPeriod !== undefined && (
        <span className="inline-flex items-center px-2 py-0.5 rounded text-[11px] font-semibold bg-blue-950/80 text-blue-300 border border-blue-800/60 shadow-sm">
          ⏱️ {interval} • RSI({rsiPeriod}, {rsiType}){evalDelta && thresholdUp ? ` Δ+${thresholdUp}` : ''}
        </span>
      )}

      {/* Rango RSI */}
      {(evalRange || rsiHigh) && (
        <span className="inline-flex items-center px-2 py-0.5 rounded text-[11px] font-semibold bg-purple-950/80 text-purple-300 border border-purple-800/60 shadow-sm">
          📊 {rsiLow || '0'} - {rsiHigh || '100'}
        </span>
      )}

      {/* Filtro EMA */}
      {evalMa && (
        <span className="inline-flex items-center px-2 py-0.5 rounded text-[11px] font-semibold bg-violet-950/80 text-violet-300 border border-violet-800/60 shadow-sm" title="Filtro de Media Móvil">
          📈 {maType} {maPeriod}
        </span>
      )}

      {/* Filtro Volumen */}
      {evalVol && (
        <span className="inline-flex items-center px-2 py-0.5 rounded text-[11px] font-semibold bg-sky-950/80 text-sky-300 border border-sky-800/60 shadow-sm" title="Filtro de Volumen">
          📊 Vol {volFactor}x
        </span>
      )}

      {/* Take Profit Fijo */}
      {isTpEnabled && tpVal && Number(tpVal) > 0 && (
        <span className="inline-flex items-center px-2 py-0.5 rounded text-[11px] font-semibold bg-emerald-950/80 text-emerald-300 border border-emerald-700/60 shadow-sm" title="Take Profit Fijo (USDT)">
          🎯 TP: +${String(tpVal).replace(/^\+/, '')}
        </span>
      )}

      {/* Stop Loss Fijo */}
      {isSlEnabled && !isNaN(numSl) && numSl > 0 && (
        <span className="inline-flex items-center px-2 py-0.5 rounded text-[11px] font-semibold bg-rose-950/80 text-rose-300 border border-rose-700/60 shadow-sm" title="Stop Loss Fijo (USDT)">
          🛑 SL: -${numSl}
        </span>
      )}

      {/* Trailing Stop */}
      {isTrailingPnl && (
        <span className="inline-flex items-center px-2 py-0.5 rounded text-[11px] font-semibold bg-amber-950/80 text-amber-300 border border-amber-800/60 shadow-sm" title="Trailing PnL">
          🏃 Tr.PnL ${pnlAct}/${pnlDrop}
        </span>
      )}
      {!isTrailingPnl && isTrailingPrice && (
        <span className="inline-flex items-center px-2 py-0.5 rounded text-[11px] font-semibold bg-amber-950/80 text-amber-300 border border-amber-800/60 shadow-sm" title="Trailing de Precio">
          🏃 Tr.Precio ${priceDist}
        </span>
      )}
      {isTrailingRsi && (
        <span className="inline-flex items-center px-2 py-0.5 rounded text-[11px] font-semibold bg-teal-950/80 text-teal-300 border border-teal-800/60 shadow-sm" title="Trailing Stop por RSI">
          🏃 Tr.RSI: {rsiTarget || 50}
        </span>
      )}

      {/* DCA */}
      {isDca && (
        <span className="inline-flex items-center px-2 py-0.5 rounded text-[11px] font-semibold bg-cyan-950/80 text-cyan-300 border border-cyan-800/60 shadow-sm" title="Re-entradas y Órdenes de Seguridad (DCA)">
          🔄 DCA: {dcaMax}x {dcaMode === 'next_support' ? 'Soportes' : `@ ${dcaDrop}%`} ({dcaMult}x)
        </span>
      )}

      {/* Ciclo */}
      {cycleSec && (
        <span className="inline-flex items-center px-1.5 py-0.5 rounded text-[10.5px] font-medium bg-gray-900 text-gray-400 border border-gray-700 shadow-sm">
          ⚡ {cycleSec}s
        </span>
      )}
    </div>
  );
}

export default function BacktestLab({ activeConfig, addToast, onApplyStrategyToConfig }) {
  // Estado de configuración de la simulación
  const [symbol, setSymbol] = useState('PORTFOLIO');
  const [configuredSymbols, setConfiguredSymbols] = useState([]);
  const [availableSymbols, setAvailableSymbols] = useState(['SOLUSDT', 'DOGEUSDT', 'OPUSDT', 'SUIUSDT', 'NEARUSDT', 'ADAUSDT', 'ONDOUSDT', 'ARBUSDT', 'BTCUSDT', 'ETHUSDT']);
  const [days, setDays] = useState(14);
  const [dateMode, setDateMode] = useState('relative'); // 'relative' o 'range'
  const [startDate, setStartDate] = useState('2024-01-01');
  const [endDate, setEndDate] = useState('2024-03-18');
  const [interval, setInterval] = useState('5m');
  const [initialBalance, setInitialBalance] = useState(1000);
  
  // Selector de Estrategia (Actual o Guardadas)
  const [strategySource, setStrategySource] = useState('current');
  const [savedStrategies, setSavedStrategies] = useState([]);
  
  // Estado de ejecución y resultados
  const [isRunning, setIsRunning] = useState(false);
  const [results, setResults] = useState(null);
  const [tradeFilter, setTradeFilter] = useState('all'); // 'all', 'wins', 'losses'
  const [symbolFilter, setSymbolFilter] = useState('all'); // Filtro por moneda específica en modo portafolio
  const [hoveredPoint, setHoveredPoint] = useState(null);
  const [equityChartMode, setEquityChartMode] = useState('equity'); // 'equity' ($ Saldo) o 'percent' (% Retorno)
  const [crosshairIdx, setCrosshairIdx] = useState(null);

  // Estado de Pestaña activa e Historial de Pruebas
  const [activeTab, setActiveTab] = useState('lab'); // 'lab' o 'history'
  const [historyList, setHistoryList] = useState([]);
  const [isLoadingHistory, setIsLoadingHistory] = useState(false);
  const [historyFilter, setHistoryFilter] = useState('all'); // 'all', 'portfolio', 'single'
  const [loadedHistoryItem, setLoadedHistoryItem] = useState(null);

  // Ordenamiento interactivo estilo Binance para Historial de Pruebas
  const [historySort, setHistorySort] = useState({ key: 'timestamp', direction: 'desc' });

  const handleHistorySort = (key) => {
    setHistorySort(prev => {
      if (prev.key === key) {
        return { key, direction: prev.direction === 'asc' ? 'desc' : 'asc' };
      }
      const defaultAscKeys = ['strategy_name', 'is_portfolio', 'period'];
      return { key, direction: defaultAscKeys.includes(key) ? 'asc' : 'desc' };
    });
  };

  const historyExtractors = useMemo(() => ({
    timestamp: item => item.timestamp || '',
    strategy_name: item => item.strategy_name || '',
    is_portfolio: item => item.is_portfolio ? (item.symbols_count || 10) : 1,
    period: item => item.days_tested !== undefined ? item.days_tested : (item.period_label || ''),
    final_equity: item => {
      const startBal = item.initial_balance || (item.is_portfolio ? (item.symbols_count || 8) * 1000 : 1000);
      return item.final_equity !== undefined ? item.final_equity : (item.final_balance !== undefined ? item.final_balance : (startBal + (item.net_equity_pnl !== undefined ? item.net_equity_pnl : (item.net_pnl || 0))));
    },
    total_volume_traded_usdt: item => item.total_volume_traded_usdt || (item.total_trades * 100),
    total_trades: item => item.total_trades || 0,
    net_pnl: item => item.net_pnl || 0,
    unrealized_pnl: item => item.unrealized_pnl || 0,
    net_equity_pnl: item => item.net_equity_pnl !== undefined ? item.net_equity_pnl : (item.net_pnl || 0),
    trapped_coins_count: item => item.trapped_coins_count || 0
  }), []);

  const filteredAndSortedHistory = useMemo(() => {
    const filtered = historyList.filter(item => {
      if (historyFilter === 'portfolio') return item.is_portfolio;
      if (historyFilter === 'single') return !item.is_portfolio;
      return true;
    });
    return sortTableData(filtered, historySort, historyExtractors);
  }, [historyList, historyFilter, historySort, historyExtractors]);

  // Modal y lógica para depurar y conservar Top N estrategias más rentables
  const [isPruneModalOpen, setIsPruneModalOpen] = useState(false);
  const [pruneKeepCount, setPruneKeepCount] = useState(10);
  const [pruneMetric, setPruneMetric] = useState('net_equity_pnl');
  const [pruneHistory, setPruneHistory] = useState(true);
  const [pruneRankings, setPruneRankings] = useState([]);
  const [isLoadingRankings, setIsLoadingRankings] = useState(false);
  const [isPruning, setIsPruning] = useState(false);

  const fetchRankedStrategies = async (metric = pruneMetric) => {
    setIsLoadingRankings(true);
    try {
      const res = await fetch(`/api/strategies/ranked_performance?metric=${metric}`);
      if (res.ok) {
        const data = await res.json();
        setPruneRankings(data.strategies || []);
      }
    } catch (err) {
      console.error("Error fetching ranked strategies:", err);
    } finally {
      setIsLoadingRankings(false);
    }
  };

  const handleOpenPruneModal = () => {
    fetchRankedStrategies(pruneMetric);
    setIsPruneModalOpen(true);
  };

  const handlePruneMetricChange = (newMetric) => {
    setPruneMetric(newMetric);
    fetchRankedStrategies(newMetric);
  };

  const handleExecutePrune = async () => {
    if (pruneKeepCount < 1) {
      alert("Por favor ingresa un número válido de estrategias a conservar (al menos 1).");
      return;
    }
    const toDeleteCount = Math.max(0, pruneRankings.length - pruneKeepCount);
    if (toDeleteCount === 0) {
      alert(`Solo hay ${pruneRankings.length} estrategias guardadas. No hay ninguna que eliminar para conservar ${pruneKeepCount}.`);
      return;
    }

    if (!window.confirm(`¿Confirmas eliminar ${toDeleteCount} estrategias menos rentables y conservar únicamente el Top ${pruneKeepCount}? Se borrarán los archivos .json de las estrategias descartadas.`)) {
      return;
    }

    setIsPruning(true);
    try {
      const res = await fetch('/api/strategies/prune_least_profitable', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          keep_count: pruneKeepCount,
          metric: pruneMetric,
          prune_history: pruneHistory
        })
      });
      const data = await res.json();
      if (res.ok) {
        if (addToast) {
          addToast('Depuración Completada', data.message || `Se conservaron las ${pruneKeepCount} mejores estrategias.`, 'success');
        }
        setIsPruneModalOpen(false);
        // Recargar estrategias guardadas
        const resStrat = await fetch('/api/strategies');
        if (resStrat.ok) {
          const strats = await resStrat.json();
          setSavedStrategies(strats);
        }
        fetchHistory();
      } else {
        throw new Error(data.error || "Error al depurar estrategias.");
      }
    } catch (err) {
      console.error("Error depurando estrategias:", err);
      if (addToast) addToast('Error', err.message, 'error');
    } finally {
      setIsPruning(false);
    }
  };

  const fetchHistory = async () => {
    setIsLoadingHistory(true);
    try {
      const res = await fetch('/api/backtest/history');
      if (res.ok) {
        const data = await res.json();
        if (Array.isArray(data)) {
          setHistoryList(data);
        }
      }
    } catch (err) {
      console.error("Error cargando historial de backtest:", err);
    } finally {
      setIsLoadingHistory(false);
    }
  };

  const handleLoadHistoryItem = async (runId) => {
    try {
      const res = await fetch(`/api/backtest/history/${runId}`);
      if (!res.ok) throw new Error("No se pudo cargar la simulación guardada.");
      const fullData = await res.json();
      const historyMatch = historyList.find(h => h.id === runId);
      const ts = fullData.executed_at || fullData.timestamp || historyMatch?.timestamp;
      fullData.executed_at = ts;
      setResults(fullData);
      setLoadedHistoryItem(historyMatch || { id: runId, timestamp: ts });
      setActiveTab('lab');
      if (addToast) {
        addToast('Simulación Cargada', 'Se cargaron los resultados completos del historial.', 'info');
      }
    } catch (err) {
      console.error("Error al cargar prueba del historial:", err);
      if (addToast) addToast('Error', err.message, 'error');
    }
  };

  const handleDeleteHistoryItem = async (e, runId) => {
    e.stopPropagation();
    if (!window.confirm("¿Estás seguro de eliminar esta prueba del historial?")) return;
    try {
      const res = await fetch(`/api/backtest/history/${runId}`, { method: 'DELETE' });
      if (res.ok) {
        setHistoryList(prev => prev.filter(item => item.id !== runId));
        if (loadedHistoryItem?.id === runId) {
          setLoadedHistoryItem(null);
        }
        if (addToast) addToast('Historial Actualizado', 'Prueba eliminada con éxito.', 'info');
      }
    } catch (err) {
      console.error("Error eliminando prueba:", err);
    }
  };

  const handleClearAllHistory = async () => {
    if (!window.confirm("¿Estás seguro de vaciar TODO el historial de pruebas guardadas?")) return;
    try {
      const res = await fetch('/api/backtest/history', { method: 'DELETE' });
      if (res.ok) {
        setHistoryList([]);
        setLoadedHistoryItem(null);
        if (addToast) addToast('Historial Vaciado', 'Se han borrado todas las pruebas registradas.', 'info');
      }
    } catch (err) {
      console.error("Error vaciando historial:", err);
    }
  };

  // Cargar símbolos, estrategias guardadas e historial al montar
  useEffect(() => {
    const fetchSymbols = async () => {
      try {
        const res = await fetch('/api/backtest/symbols');
        if (res.ok) {
          const data = await res.json();
          if (data?.symbols?.length) {
            setAvailableSymbols(data.symbols);
          }
          if (data?.configured?.length) {
            setConfiguredSymbols(data.configured);
          }
        }
      } catch (err) {
        console.error("Error cargando símbolos para backtest:", err);
      }
    };

    const fetchStrategies = async () => {
      try {
        const res = await fetch('/api/strategies');
        if (res.ok) {
          const data = await res.json();
          if (Array.isArray(data)) {
            setSavedStrategies(data);
          }
        }
      } catch (err) {
        console.error("Error cargando estrategias:", err);
      }
    };

    fetchSymbols();
    fetchStrategies();
    fetchHistory();
  }, []);

  // Determinar la configuración exacta que se enviará al backtest
  const configToTest = useMemo(() => {
    if (strategySource === 'current') {
      return activeConfig || {};
    }
    const found = savedStrategies.find(s => s.name === strategySource);
    return found?.config || activeConfig || {};
  }, [strategySource, savedStrategies, activeConfig]);

  // Símbolos dinámicos del portafolio según la estrategia seleccionada
  const activePortfolioSymbols = useMemo(() => {
    const symStr = configToTest?.symbolsToTrade || configToTest?.symbols_to_trade;
    if (symStr && typeof symStr === 'string') {
      const parsed = symStr.split(',').map(s => s.trim().toUpperCase()).filter(Boolean);
      if (parsed.length) return parsed;
    }
    return configuredSymbols.length ? configuredSymbols : ["SOLUSDT", "DOGEUSDT", "OPUSDT", "SUIUSDT", "NEARUSDT", "ADAUSDT", "ONDOUSDT", "ARBUSDT"];
  }, [configToTest, configuredSymbols]);

  // Ejecutar el Backtest (Individual o Portafolio Completo)
  const handleRunBacktest = async () => {
    setIsRunning(true);
    setResults(null);
    setSymbolFilter('all');
    try {
      const isPortfolio = symbol === 'PORTFOLIO';
      const isCustomRange = dateMode === 'range';
      const payload = {
        symbol: symbol.toUpperCase().trim(),
        is_portfolio: isPortfolio,
        symbols: isPortfolio ? activePortfolioSymbols : undefined,
        interval,
        days: Number(days),
        startDate: isCustomRange ? startDate : undefined,
        endDate: isCustomRange ? endDate : undefined,
        initial_balance: Number(initialBalance),
        config: configToTest
      };

      const res = await fetch('/api/backtest', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload)
      });

      if (!res.ok) {
        const errData = await res.json().catch(() => ({ error: `Error ${res.status}` }));
        throw new Error(errData.error || 'Error al ejecutar la simulación.');
      }

      const data = await res.json();
      const nowStr = new Date().toLocaleString();
      data.executed_at = data.executed_at || data.timestamp || nowStr;
      setResults(data);
      setLoadedHistoryItem({ timestamp: data.executed_at, summary: { timestamp: data.executed_at } });
      fetchHistory();
      if (addToast) {
        const title = isPortfolio 
          ? `🌐 Portafolio (${data.symbols_count} pares)` 
          : `${symbol}`;
        const periodStr = data.period_label || (isCustomRange ? `${startDate} al ${endDate}` : `${days} días`);
        addToast(
          '⚡ Backtest Completado',
          `${title} - ${periodStr}: PnL ${data.net_pnl >= 0 ? '+' : ''}${data.net_pnl} USDT (${data.win_rate_pct}% acierto).`,
          data.net_pnl >= 0 ? 'success' : 'warning'
        );
      }
    } catch (err) {
      console.error("Error en backtest:", err);
      if (addToast) {
        addToast('Error de Simulación', err.message, 'error');
      } else {
        alert(err.message);
      }
    } finally {
      setIsRunning(false);
    }
  };

  // Filtrado de operaciones
  const filteredTrades = useMemo(() => {
    if (!results?.trades) return [];
    let list = results.trades;
    if (symbolFilter !== 'all') {
      list = list.filter(t => t.symbol === symbolFilter);
    }
    if (tradeFilter === 'wins') {
      list = list.filter(t => t.net_pnl > 0);
    } else if (tradeFilter === 'losses') {
      list = list.filter(t => t.net_pnl <= 0);
    }
    return list;
  }, [results, tradeFilter, symbolFilter]);

  // 1. Ordenamiento estilo Binance para Ranking de Monedas
  const [rankingSort, setRankingSort] = useState({ key: 'net_equity_pnl', direction: 'desc' });
  const handleRankingSort = (key) => {
    setRankingSort(prev => {
      if (prev.key === key) {
        return { key, direction: prev.direction === 'asc' ? 'desc' : 'asc' };
      }
      const defaultAscKeys = ['symbol', 'rank'];
      return { key, direction: defaultAscKeys.includes(key) ? 'asc' : 'desc' };
    });
  };

  const rankingExtractors = useMemo(() => ({
    rank: row => row._originalIndex !== undefined ? row._originalIndex : 0,
    symbol: row => row.symbol || '',
    net_pnl: row => row.net_pnl || 0,
    unrealized_pnl: row => row.unrealized_pnl || 0,
    net_equity_pnl: row => row.net_equity_pnl !== undefined ? row.net_equity_pnl : (row.net_pnl || 0),
    total_volume_traded_usdt: row => row.total_volume_traded_usdt || 0,
    win_rate_pct: row => row.win_rate_pct || 0,
    total_trades: row => row.total_trades || 0,
    status: row => row.is_trapped ? 2 : row.has_open_position ? 1 : 0
  }), []);

  const sortedRanking = useMemo(() => {
    if (!results?.symbols_ranking) return [];
    const ranked = results.symbols_ranking.map((row, idx) => ({ ...row, _originalIndex: idx + 1 }));
    return sortTableData(ranked, rankingSort, rankingExtractors);
  }, [results?.symbols_ranking, rankingSort, rankingExtractors]);

  // 2. Ordenamiento estilo Binance para Posiciones Abiertas / Congeladas
  const [openPositionsSort, setOpenPositionsSort] = useState({ key: 'unrealized_pnl', direction: 'asc' });
  const handleOpenPositionsSort = (key) => {
    setOpenPositionsSort(prev => {
      if (prev.key === key) {
        return { key, direction: prev.direction === 'asc' ? 'desc' : 'asc' };
      }
      const defaultAscKeys = ['symbol', 'status'];
      return { key, direction: defaultAscKeys.includes(key) ? 'asc' : 'desc' };
    });
  };

  const openPositionsExtractors = useMemo(() => ({
    symbol: pos => pos.symbol || '',
    duration_days: pos => pos.duration_days || 0,
    entry_price: pos => pos.entry_price || 0,
    current_price: pos => pos.current_price || 0,
    dca_reentries: pos => pos.dca_reentries || 0,
    margin_usdt: pos => pos.margin_usdt || 0,
    unrealized_pnl: pos => pos.unrealized_pnl || 0,
    status: pos => pos.is_trapped ? 'Trapped' : (pos.status || 'Abierta')
  }), []);

  const sortedOpenPositions = useMemo(() => {
    const rawList = results?.open_positions || (results?.open_position ? [results.open_position] : []);
    return sortTableData(rawList.filter(Boolean), openPositionsSort, openPositionsExtractors);
  }, [results?.open_positions, results?.open_position, openPositionsSort, openPositionsExtractors]);

  // 3. Ordenamiento estilo Binance para Operaciones (Trades)
  const [tradesSort, setTradesSort] = useState({ key: 'id', direction: 'asc' });
  const handleTradesSort = (key) => {
    setTradesSort(prev => {
      if (prev.key === key) {
        return { key, direction: prev.direction === 'asc' ? 'desc' : 'asc' };
      }
      const defaultAscKeys = ['id', 'symbol', 'open_time', 'close_time', 'exit_reason'];
      return { key, direction: defaultAscKeys.includes(key) ? 'asc' : 'desc' };
    });
  };

  const tradesExtractors = useMemo(() => ({
    id: t => t.id || 0,
    symbol: t => t.symbol || '',
    open_time: t => t.open_time || '',
    close_time: t => t.close_time || '',
    entry_price: t => t.entry_price || 0,
    exit_price: t => t.exit_price || 0,
    margin_usdt: t => t.margin_usdt || 0,
    dca_reentries: t => t.dca_reentries || 0,
    fees: t => t.fees || 0,
    exit_reason: t => t.exit_reason || '',
    net_pnl: t => t.net_pnl || 0
  }), []);

  const filteredAndSortedTrades = useMemo(() => {
    return sortTableData(filteredTrades, tradesSort, tradesExtractors);
  }, [filteredTrades, tradesSort, tradesExtractors]);

  // Aplicar configuración probada al bot en vivo
  const handleApplyToLiveBot = () => {
    if (!configToTest) return;
    if (window.confirm(`¿Confirmas que deseas aplicar los parámetros de esta prueba como la nueva configuración activa de tu Bot en vivo?`)) {
      if (onApplyStrategyToConfig) {
        onApplyStrategyToConfig(configToTest);
      }
    }
  };

  // Renderizado del gráfico vectorial de la Curva de Capital (SVG Profesional Rediseñado)
  const renderEquitySvg = () => {
    if (!results?.equity_curve || results.equity_curve.length < 2) return null;
    const initialBal = Number(results.initial_balance) || (results.is_portfolio ? (results.symbols_count || 8) * 1000 : 1000);
    const isPercent = equityChartMode === 'percent';

    // Normalizar la curva soportando tanto 'equity' como 'balance', y 'time' como 'timestamp'
    const curve = results.equity_curve.map((c, idx) => {
      const rawVal = c.equity !== undefined ? c.equity : (c.balance !== undefined ? c.balance : initialBal);
      const numVal = Number(rawVal);
      const safeVal = isNaN(numVal) ? initialBal : numVal;
      const timeStr = c.time || c.timestamp || (c.trade_num !== undefined ? `Trade ${c.trade_num}` : `Punto ${idx + 1}`);
      const pnlVal = c.pnl !== undefined ? Number(c.pnl) : (safeVal - initialBal);
      return {
        ...c,
        equity: safeVal,
        time: String(timeStr),
        pnl: isNaN(pnlVal) ? 0 : pnlVal
      };
    });

    // 1. Métricas financieras fijas consolidadas
    const equities = curve.map(c => c.equity);
    const peakEquity = equities.length ? Math.max(...equities) : initialBal;
    const peakIdx = Math.max(0, equities.indexOf(peakEquity));
    const peakPoint = curve[peakIdx] || curve[0] || { equity: initialBal, time: '' };

    const minEquity = equities.length ? Math.min(...equities) : initialBal;
    const minIdx = Math.max(0, equities.indexOf(minEquity));
    const minPoint = curve[minIdx] || curve[0] || { equity: initialBal, time: '' };

    const finalPoint = curve[curve.length - 1] || { equity: initialBal, time: '' };
    const finalEquity = typeof finalPoint.equity === 'number' && !isNaN(finalPoint.equity) ? finalPoint.equity : initialBal;
    const netPnl = finalEquity - initialBal;
    const finalReturnPct = initialBal > 0 ? (netPnl / initialBal) * 100 : 0;
    const peakReturnPct = initialBal > 0 ? ((peakEquity - initialBal) / initialBal) * 100 : 0;

    // Drawdown Máximo pico-a-valle
    let runningMax = curve[0]?.equity || initialBal;
    let maxDdUsdt = 0;
    let maxDdPct = 0;
    curve.forEach(c => {
      if (c.equity > runningMax) runningMax = c.equity;
      const dd = runningMax - c.equity;
      if (dd > maxDdUsdt) {
        maxDdUsdt = dd;
        maxDdPct = runningMax > 0 ? (dd / runningMax) * 100 : 0;
      }
    });
    if (results.max_drawdown_pct && results.max_drawdown_pct > maxDdPct) {
      maxDdPct = results.max_drawdown_pct;
    }

    // 2. Coordenadas y Escala
    const plotValues = curve.map(c => isPercent ? ((c.equity - initialBal) / initialBal) * 100 : c.equity);
    const plotMin = Math.min(...plotValues);
    const plotMax = Math.max(...plotValues);
    const plotMargin = ((plotMax - plotMin) * 0.12) || (isPercent ? 3 : 15);
    const yMin = plotMin - plotMargin;
    const yMax = plotMax + plotMargin;
    const yRange = (yMax - yMin) || 1;

    const width = 1000;
    const height = 330;
    const padL = 70;
    const padR = 75;
    const padT = 38;
    const padB = 42;
    const graphW = width - padL - padR;
    const graphH = height - padT - padB;

    const getX = (idx) => padL + (idx / (curve.length - 1)) * graphW;
    const getY = (val) => padT + graphH - ((val - yMin) / yRange) * graphH;

    const points = curve.map((c, i) => `${getX(i).toFixed(1)},${getY(plotValues[i]).toFixed(1)}`).join(' ');
    const areaPoints = `${points} ${getX(curve.length - 1).toFixed(1)},${padT + graphH} ${getX(0).toFixed(1)},${padT + graphH}`;

    // Línea Base (Capital Inicial / 0%)
    const baseVal = isPercent ? 0 : initialBal;
    const baseY = getY(baseVal);

    // Línea ATH
    const athVal = isPercent ? peakReturnPct : peakEquity;
    const athY = getY(athVal);

    const isProfit = netPnl >= 0;
    const strokeColor = isProfit ? '#10b981' : '#ef4444';
    const gradientId = isProfit ? 'equityProfitGrad' : 'equityLossGrad';

    // Cuadrícula Horizontal (5 niveles)
    const gridLevels = [0.05, 0.28, 0.52, 0.76, 0.96].map(ratio => {
      const v = yMin + ratio * yRange;
      return {
        y: getY(v),
        label: isPercent ? `${v >= 0 ? '+' : ''}${v.toFixed(1)}%` : `$${v.toFixed(0)}`
      };
    });

    // Marcas de tiempo en Eje X (6 fechas espaciadas)
    const xStep = Math.max(1, Math.floor((curve.length - 1) / 5));
    const xTicks = [0, xStep, xStep * 2, xStep * 3, xStep * 4, curve.length - 1].filter((v, i, a) => a.indexOf(v) === i);

    // Punto enfocado por Crosshair (o el último por defecto)
    const activePoint = crosshairIdx !== null && curve[crosshairIdx] ? curve[crosshairIdx] : null;

    return (
      <div className="space-y-4">
        {/* CINTA SUPERIOR: ESTADÍSTICAS FINANCIERAS FIJAS (VISIBLES SIEMPRE SIN MOUSE) */}
        <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-5 gap-2.5">
          {/* Capital Base */}
          <div className="p-3 bg-slate-950/80 rounded-xl border border-slate-800 flex flex-col justify-between">
            <span className="text-[10.5px] font-medium text-slate-400 uppercase tracking-wider flex items-center gap-1">
              <span>💰</span> Saldo Inicial
            </span>
            <div className="text-base sm:text-lg font-medium font-mono text-white mt-0.5">
              ${initialBal.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })} <span className="text-[10px] text-slate-400 font-normal">USDT</span>
            </div>
          </div>

          {/* Pico Máximo Histórico (ATH) */}
          <div className="p-3 bg-amber-950/30 rounded-xl border border-amber-600/40 flex flex-col justify-between">
            <span className="text-[10.5px] font-medium text-amber-300 uppercase tracking-wider flex items-center gap-1">
              <span>👑</span> Máximo Histórico
            </span>
            <div>
              <div className="text-base sm:text-lg font-medium font-mono text-amber-300 mt-0.5">
                ${peakEquity.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
                <span className="text-xs font-normal text-emerald-400 ml-1.5">(+{peakReturnPct.toFixed(1)}%)</span>
              </div>
              <span className="text-[10px] text-amber-400/80 block truncate font-mono font-light">
                📅 {peakPoint.time ? String(peakPoint.time).slice(0, 16) : ''}
              </span>
            </div>
          </div>

          {/* Drawdown Máximo */}
          <div className="p-3 bg-rose-950/30 rounded-xl border border-rose-600/40 flex flex-col justify-between">
            <span className="text-[10.5px] font-medium text-rose-300 uppercase tracking-wider flex items-center gap-1">
              <span>🔻</span> Drawdown Máximo
            </span>
            <div>
              <div className="text-base sm:text-lg font-medium font-mono text-rose-300 mt-0.5">
                -{maxDdPct.toFixed(2)}%
              </div>
              <span className="text-[10px] text-rose-400/80 block font-mono font-light">
                Retroceso: -${maxDdUsdt.toFixed(2)} USDT
              </span>
            </div>
          </div>

          {/* Saldo Final */}
          <div className={`p-3 rounded-xl border flex flex-col justify-between ${isProfit ? 'bg-emerald-950/30 border-emerald-600/40' : 'bg-red-950/30 border-red-600/40'}`}>
            <span className={`text-[10.5px] font-medium uppercase tracking-wider flex items-center gap-1 ${isProfit ? 'text-emerald-300' : 'text-red-300'}`}>
              <span>🏁</span> Saldo Final
            </span>
            <div>
              <div className={`text-base sm:text-lg font-medium font-mono mt-0.5 ${isProfit ? 'text-emerald-300' : 'text-red-300'}`}>
                ${finalEquity.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
                <span className="text-xs font-normal ml-1.5">{finalReturnPct >= 0 ? '+' : ''}{finalReturnPct.toFixed(1)}%</span>
              </div>
              <span className="text-[10px] text-slate-300 block font-mono font-light">
                PnL: {netPnl >= 0 ? '+' : ''}${netPnl.toFixed(2)} USDT
              </span>
            </div>
          </div>

          {/* Eficiencia / Trades */}
          <div className="p-3 bg-indigo-950/30 rounded-xl border border-indigo-600/40 flex flex-col justify-between">
            <span className="text-[10.5px] font-medium text-indigo-300 uppercase tracking-wider flex items-center gap-1">
              <span>🎯</span> Tasa Acierto
            </span>
            <div>
              <div className="text-base sm:text-lg font-medium font-mono text-indigo-300 mt-0.5">
                {results.win_rate_pct ?? 0}%
              </div>
              <span className="text-[10px] text-indigo-300/80 block font-mono font-light">
                {results.winning_trades || 0}G / {results.losing_trades || 0}P ({results.total_trades || 0} ops)
              </span>
            </div>
          </div>
        </div>

        {/* BARRA DE CONTROLES DEL GRÁFICO (MODO $ VS %) */}
        <div className="flex flex-wrap items-center justify-between gap-2 px-1">
          <div className="flex items-center gap-2">
            <span className="text-xs text-slate-400 font-medium">Unidad Gráfico:</span>
            <div className="inline-flex rounded-lg bg-slate-950 p-1 border border-slate-800">
              <button
                type="button"
                onClick={() => setEquityChartMode('equity')}
                className={`px-3 py-1 text-xs font-medium rounded-md transition-all ${
                  !isPercent
                    ? 'bg-indigo-600 text-white shadow-sm'
                    : 'text-slate-400 hover:text-white'
                }`}
              >
                Saldo USDT
              </button>
              <button
                type="button"
                onClick={() => setEquityChartMode('percent')}
                className={`px-3 py-1 text-xs font-medium rounded-md transition-all ${
                  isPercent
                    ? 'bg-indigo-600 text-white shadow-sm'
                    : 'text-slate-400 hover:text-white'
                }`}
              >
                Retorno Porcentual
              </button>
            </div>
          </div>

          {/* HUD Dinámico en Hover (Si el usuario explora) */}
          {activePoint && (
            <div className="flex items-center gap-3 px-3 py-1.5 bg-slate-950/95 border border-indigo-500/50 rounded-xl text-xs font-mono shadow-lg animate-fadeIn">
              <span className="text-slate-400">⏱️ {activePoint.time}</span>
              <span className="text-slate-200">Saldo: <b className="text-white">${activePoint.equity?.toFixed(2)}</b></span>
              <span className={activePoint.pnl >= 0 ? 'text-emerald-400 font-bold' : 'text-rose-400 font-bold'}>
                {activePoint.pnl >= 0 ? '+' : ''}{activePoint.pnl?.toFixed(2)} USDT ({((activePoint.pnl / initialBal) * 100).toFixed(1)}%)
              </span>
            </div>
          )}
        </div>

        {/* GRÁFICO VECTORIAL SVG CON HITOS FIJOS */}
        <div className="relative w-full overflow-hidden bg-slate-950/90 rounded-xl border border-slate-800 p-2 shadow-inner">
          <svg
            viewBox={`0 0 ${width} ${height}`}
            className="w-full h-auto drop-shadow-md select-none"
            onMouseMove={(e) => {
              const svgRect = e.currentTarget.getBoundingClientRect();
              const clientX = e.clientX - svgRect.left;
              const ratio = Math.max(0, Math.min(1, (clientX - (padL / width) * svgRect.width) / ((graphW / width) * svgRect.width)));
              const idx = Math.round(ratio * (curve.length - 1));
              setCrosshairIdx(idx);
            }}
            onMouseLeave={() => setCrosshairIdx(null)}
          >
            <defs>
              <linearGradient id="equityProfitGrad" x1="0" y1="0" x2="0" y2="1">
                <stop offset="0%" stopColor="#10b981" stopOpacity="0.38" />
                <stop offset="60%" stopColor="#10b981" stopOpacity="0.08" />
                <stop offset="100%" stopColor="#10b981" stopOpacity="0.0" />
              </linearGradient>
              <linearGradient id="equityLossGrad" x1="0" y1="0" x2="0" y2="1">
                <stop offset="0%" stopColor="#ef4444" stopOpacity="0.38" />
                <stop offset="60%" stopColor="#ef4444" stopOpacity="0.08" />
                <stop offset="100%" stopColor="#ef4444" stopOpacity="0.0" />
              </linearGradient>
              <filter id="neonGlow" x="-20%" y="-20%" width="140%" height="140%">
                <feDropShadow dx="0" dy="0" stdDeviation="3" floodColor={strokeColor} floodOpacity="0.45" />
              </filter>
            </defs>

            {/* Cuadrícula Horizontal de Referencia */}
            {gridLevels.map((lvl, idx) => (
              <g key={idx}>
                <line
                  x1={padL}
                  y1={lvl.y}
                  x2={width - padR}
                  y2={lvl.y}
                  stroke="#334155"
                  strokeDasharray="3 3"
                  strokeWidth="0.8"
                  opacity="0.45"
                />
                <text
                  x={padL - 8}
                  y={lvl.y + 3.5}
                  textAnchor="end"
                  fill="#64748b"
                  fontSize="10"
                  fontFamily="monospace"
                  fontWeight="600"
                >
                  {lvl.label}
                </text>
                <text
                  x={width - padR + 8}
                  y={lvl.y + 3.5}
                  textAnchor="start"
                  fill="#64748b"
                  fontSize="10"
                  fontFamily="monospace"
                  fontWeight="600"
                >
                  {lvl.label}
                </text>
              </g>
            ))}

            {/* Línea Base de Capital Inicial (Break-Even) */}
            {baseY >= padT && baseY <= padT + graphH && (
              <g>
                <line
                  x1={padL}
                  y1={baseY}
                  x2={width - padR}
                  y2={baseY}
                  stroke="#3b82f6"
                  strokeDasharray="5 4"
                  strokeWidth="1.4"
                  opacity="0.85"
                />
                <rect x={padL + 6} y={baseY - 18} width="165" height="16" rx="4" fill="#1e3a8a" opacity="0.9" />
                <text x={padL + 12} y={baseY - 6} fill="#93c5fd" fontSize="10.5" fontFamily="monospace" fontWeight="bold">
                  🏁 Base: ${initialBal} USDT (0%)
                </text>
              </g>
            )}

            {/* Línea de Pico ATH (Máximo Histórico) */}
            {athY >= padT && athY <= padT + graphH && (
              <g>
                <line
                  x1={padL}
                  y1={athY}
                  x2={width - padR}
                  y2={athY}
                  stroke="#f59e0b"
                  strokeDasharray="4 4"
                  strokeWidth="1.2"
                  opacity="0.75"
                />
                <rect x={width - padR - 220} y={athY - 18} width="214" height="16" rx="4" fill="#78350f" opacity="0.9" />
                <text x={width - padR - 10} y={athY - 6} textAnchor="end" fill="#fef08a" fontSize="10.5" fontFamily="monospace" fontWeight="bold">
                  👑 Pico ATH: ${peakEquity.toFixed(2)} (+{peakReturnPct.toFixed(1)}%)
                </text>
              </g>
            )}

            {/* Área sombreada con gradiente */}
            <polygon points={areaPoints} fill={`url(#${gradientId})`} />

            {/* Línea Principal Vectorial Fluida */}
            <polyline
              fill="none"
              stroke={strokeColor}
              strokeWidth="3.2"
              strokeLinecap="round"
              strokeLinejoin="round"
              points={points}
              filter="url(#neonGlow)"
            />

            {/* HITOS PERMANENTES VISIBLES SIEMPRE (SIN MOUSE) */}
            {/* 1. Hito de Inicio */}
            <circle
              cx={getX(0)}
              cy={getY(plotValues[0])}
              r="4.5"
              fill="#3b82f6"
              stroke="#ffffff"
              strokeWidth="2"
            />

            {/* 2. Hito de Pico ATH */}
            <circle
              cx={getX(peakIdx)}
              cy={getY(plotValues[peakIdx])}
              r="6.5"
              fill="#f59e0b"
              stroke="#ffffff"
              strokeWidth="2.5"
              className="animate-pulse"
            />
            {/* Callout Badge de ATH sobre el pico */}
            <g transform={`translate(${getX(peakIdx)}, ${Math.max(padT + 12, getY(plotValues[peakIdx]) - 28)})`}>
              <rect x="-65" y="-12" width="130" height="20" rx="6" fill="#78350f" stroke="#fbbf24" strokeWidth="1.2" filter="drop-shadow(0 2px 4px rgba(0,0,0,0.5))" />
              <text x="0" y="2" textAnchor="middle" fill="#fef08a" fontSize="10" fontFamily="monospace" fontWeight="bold">
                👑 ATH ${peakEquity.toFixed(0)} (+{peakReturnPct.toFixed(1)}%)
              </text>
            </g>

            {/* 3. Hito de Cierre Final */}
            <circle
              cx={getX(curve.length - 1)}
              cy={getY(plotValues[curve.length - 1])}
              r="6"
              fill={strokeColor}
              stroke="#ffffff"
              strokeWidth="2.5"
            />
            {/* Callout Badge de Saldo Final */}
            <g transform={`translate(${Math.min(width - padR - 50, getX(curve.length - 1) - 45)}, ${Math.min(padT + graphH - 10, getY(plotValues[curve.length - 1]) + 20)})`}>
              <rect x="-45" y="-10" width="115" height="20" rx="6" fill={isProfit ? '#064e3b' : '#7f1d1d'} stroke={strokeColor} strokeWidth="1.2" filter="drop-shadow(0 2px 4px rgba(0,0,0,0.5))" />
              <text x="12" y="4" textAnchor="middle" fill="#ffffff" fontSize="10" fontFamily="monospace" fontWeight="bold">
                🏁 ${finalEquity.toFixed(0)} ({finalReturnPct >= 0 ? '+' : ''}{finalReturnPct.toFixed(1)}%)
              </text>
            </g>

            {/* Marcas de Fecha en el Eje X */}
            {xTicks.map((idx, i) => {
              const pt = curve[idx];
              if (!pt?.time) return null;
              const dateStr = String(pt.time).split(' ')[0] || String(pt.time);
              const parts = dateStr.split('-');
              const displayDate = parts.length === 3 ? `${parts[2]}/${parts[1]}` : dateStr;
              const xPos = getX(idx);
              return (
                <g key={i}>
                  <line
                    x1={xPos}
                    y1={padT + graphH}
                    x2={xPos}
                    y2={padT + graphH + 5}
                    stroke="#475569"
                    strokeWidth="1"
                  />
                  <text
                    x={xPos}
                    y={padT + graphH + 18}
                    textAnchor="middle"
                    fill="#94a3b8"
                    fontSize="10"
                    fontFamily="monospace"
                    fontWeight="600"
                  >
                    {displayDate}
                  </text>
                </g>
              );
            })}

            {/* Línea Vertical de Seguimiento Dinámico (Crosshair Opcional) */}
            {crosshairIdx !== null && curve[crosshairIdx] && (
              <g>
                <line
                  x1={getX(crosshairIdx)}
                  y1={padT}
                  x2={getX(crosshairIdx)}
                  y2={padT + graphH}
                  stroke="#94a3b8"
                  strokeWidth="1.2"
                  strokeDasharray="3 3"
                />
                <circle
                  cx={getX(crosshairIdx)}
                  cy={getY(plotValues[crosshairIdx])}
                  r="5.5"
                  fill="#ffffff"
                  stroke={strokeColor}
                  strokeWidth="3"
                />
              </g>
            )}
          </svg>
        </div>
      </div>
    );
  };

  return (
    <div className="space-y-6">
      
      {/* 1. Header y Banner Informativo */}
      <div className="bg-gradient-to-r from-indigo-900/40 via-purple-900/30 to-blue-900/40 border border-indigo-700/40 rounded-2xl p-6 shadow-xl relative overflow-hidden">
        <div className="flex flex-col md:flex-row md:items-center justify-between gap-4 relative z-10">
          <div>
            <div className="flex items-center gap-2 mb-1">
              <span className="text-2xl">🧪</span>
              <h2 className="text-xl font-bold text-white tracking-wide">
                Laboratorio de Backtesting Cuantitativo
              </h2>
              <span className="px-2 py-0.5 text-[11px] font-bold rounded-full bg-indigo-500/20 text-indigo-300 border border-indigo-500/40">
                Binance Futures Data
              </span>
              {results?.is_portfolio && (
                <span className="px-2 py-0.5 text-[11px] font-bold rounded-full bg-emerald-500/20 text-emerald-300 border border-emerald-500/40">
                  🌐 Portafolio ({results.symbols_count} pares)
                </span>
              )}
            </div>
            <p className="text-sm text-gray-300 max-w-3xl">
              Simula y valida tus estrategias con datos reales de Binance vela por vela. Evalúa una moneda individual o prueba **todo tu portafolio en simultáneo** para identificar las mejores monedas.
            </p>
          </div>

          {results && (
            <button
              type="button"
              onClick={handleApplyToLiveBot}
              className="px-4 py-2.5 bg-gradient-to-r from-emerald-600 to-teal-600 hover:from-emerald-500 hover:to-teal-500 text-white font-bold rounded-xl shadow-lg shadow-emerald-900/40 transition-all flex items-center gap-2 active:scale-95 text-xs whitespace-nowrap"
              title="Copiar estos parámetros exactos al bot activo"
            >
              <span>🚀</span>
              <span>Aplicar al Bot en Vivo</span>
            </button>
          )}
        </div>
      </div>

      {/* Selector de Pestañas: Laboratorio de Simulación vs Historial de Pruebas */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 border-b border-gray-200 dark:border-gray-700/80 pb-3">
        <div className="flex items-center gap-2">
          <button
            type="button"
            onClick={() => setActiveTab('lab')}
            className={`px-4 py-2 text-xs sm:text-sm font-medium rounded-xl transition-all flex items-center gap-2 ${
              activeTab === 'lab'
                ? 'bg-indigo-600 text-white shadow-md shadow-indigo-900/30 ring-1 ring-indigo-400/40'
                : 'bg-gray-100 dark:bg-gray-800 text-gray-600 dark:text-gray-300 hover:bg-gray-200 dark:hover:bg-gray-700 font-normal'
            }`}
          >
            <span>🧪</span>
            <span>Laboratorio Pruebas</span>
            {results && (
              <span className="w-2 h-2 rounded-full bg-emerald-400 animate-ping"></span>
            )}
          </button>

          <button
            type="button"
            onClick={() => {
              setActiveTab('history');
              fetchHistory();
            }}
            className={`px-4 py-2 text-xs sm:text-sm font-medium rounded-xl transition-all flex items-center gap-2 ${
              activeTab === 'history'
                ? 'bg-indigo-600 text-white shadow-md shadow-indigo-900/30 ring-1 ring-indigo-400/40'
                : 'bg-gray-100 dark:bg-gray-800 text-gray-600 dark:text-gray-300 hover:bg-gray-200 dark:hover:bg-gray-700 font-normal'
            }`}
          >
            <span>📜</span>
            <span>Historial Pruebas</span>
            <span className="px-2 py-0.5 text-[11px] font-mono font-medium rounded-full bg-indigo-950 text-indigo-300 border border-indigo-700">
              {historyList.length}
            </span>
          </button>
        </div>

        {loadedHistoryItem && activeTab === 'lab' && (
          <div className="flex items-center gap-2 bg-indigo-950/60 border border-indigo-700/50 px-3 py-1.5 rounded-xl">
            <span className="text-xs text-indigo-300 font-light">
              📁 Viendo prueba guardada: <b className="font-medium text-white">{loadedHistoryItem.strategy_name}</b> ({loadedHistoryItem.timestamp?.substring(5, 16)})
            </span>
            <button
              type="button"
              onClick={() => {
                setLoadedHistoryItem(null);
              }}
              className="text-[11px] font-medium text-gray-400 hover:text-white px-2 py-0.5 bg-gray-800 rounded-lg hover:bg-gray-700 transition"
              title="Volver a los parámetros actuales"
            >
              ✕ Desvincular
            </button>
          </div>
        )}
      </div>

      {/* VISTA: HISTORIAL DE PRUEBAS */}
      {activeTab === 'history' && (
        <div className="bg-slate-900 border border-slate-700/80 rounded-2xl p-6 shadow-xl space-y-4">
          <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 border-b border-slate-700/80 pb-3">
            <div>
              <div className="flex items-center gap-2">
                <span className="text-xl">📜</span>
                <h3 className="font-medium text-white text-base">
                  Historial Pruebas
                </h3>
                <span className="text-xs text-slate-300 font-mono font-light">({historyList.length} registradas)</span>
              </div>
              <p className="text-xs text-slate-300 mt-0.5 font-light">
                Revisa, compara y recarga cualquier simulación anterior con todos sus gráficos, órdenes y monedas atrapadas al instante.
              </p>
            </div>

            <div className="flex items-center gap-2">
              <button
                type="button"
                onClick={fetchHistory}
                disabled={isLoadingHistory}
                className="px-3 py-1.5 bg-slate-800 hover:bg-slate-750 rounded-xl text-xs font-medium text-slate-200 border border-slate-700 transition flex items-center gap-1.5"
              >
                <span className={isLoadingHistory ? 'animate-spin' : ''}>🔄</span>
                <span>Actualizar Datos</span>
              </button>

              <button
                type="button"
                onClick={handleOpenPruneModal}
                className="px-3 py-1.5 bg-amber-950/80 hover:bg-amber-900 text-amber-200 border border-amber-500/60 rounded-xl text-xs font-medium transition flex items-center gap-1.5 shadow-sm active:scale-95"
                title="Depura y conserva automáticamente las estrategias más rentables y eficaces"
              >
                <span>🏆</span>
                <span>Conservar Top</span>
              </button>

              {historyList.length > 0 && (
                <button
                  type="button"
                  onClick={handleClearAllHistory}
                  className="px-3 py-1.5 bg-red-950/80 hover:bg-red-900 text-red-200 border border-red-700/60 rounded-xl text-xs font-medium transition flex items-center gap-1.5"
                >
                  <span>🗑️</span>
                  <span>Vaciar Historial</span>
                </button>
              )}
            </div>
          </div>

          {/* Filtros de Historial */}
          <div className="flex items-center gap-2">
            <span className="text-xs font-medium text-slate-300">Filtrar Pruebas:</span>
            {[
              { id: 'all', label: 'Todas Pruebas' },
              { id: 'portfolio', label: 'Todo Portafolio' },
              { id: 'single', label: 'Moneda Individual' }
            ].map(f => (
              <button
                key={f.id}
                type="button"
                onClick={() => setHistoryFilter(f.id)}
                className={`px-3 py-1 rounded-lg text-xs font-medium transition ${
                  historyFilter === f.id
                    ? 'bg-indigo-600 text-white shadow-sm ring-1 ring-indigo-400'
                    : 'bg-slate-950 text-slate-300 border border-slate-700 hover:text-white hover:bg-slate-800'
                }`}
              >
                {f.label}
              </button>
            ))}
          </div>

          {/* Tabla de Pruebas */}
          {historyList.length === 0 ? (
            <div className="text-center py-12 border-2 border-dashed border-slate-700 rounded-xl bg-slate-950/40">
              <span className="text-3xl block mb-2">🧪</span>
              <h4 className="font-bold text-white text-sm mb-1">Aún no hay pruebas registradas</h4>
              <p className="text-xs text-slate-300 max-w-sm mx-auto mb-4">
                Ejecuta una simulación desde la pestaña de Laboratorio y se guardará automáticamente aquí con todos sus detalles.
              </p>
              <button
                type="button"
                onClick={() => setActiveTab('lab')}
                className="px-4 py-2 bg-indigo-600 hover:bg-indigo-500 text-white font-bold rounded-xl text-xs transition shadow-md shadow-indigo-900/30"
              >
                ⚡ Ir a Simular Ahora
              </button>
            </div>
          ) : (
            <div className="overflow-x-auto">
              <table className="min-w-full divide-y divide-slate-700 text-left">
                <thead className="bg-slate-950 text-slate-100 font-medium text-[11px] uppercase tracking-wider border-b-2 border-slate-700">
                  <tr>
                    <BinanceSortHeader label="Fecha Hora" sortKey="timestamp" currentSort={historySort} onSort={handleHistorySort} />
                    <BinanceSortHeader label="Estrategia Usada" sortKey="strategy_name" currentSort={historySort} onSort={handleHistorySort} />
                    <BinanceSortHeader label="Alcance Prueba" sortKey="is_portfolio" currentSort={historySort} onSort={handleHistorySort} />
                    <BinanceSortHeader label="Periodo Días" sortKey="period" currentSort={historySort} onSort={handleHistorySort} />
                    <BinanceSortHeader label="Capital Flujo" sortKey="final_equity" currentSort={historySort} onSort={handleHistorySort} />
                    <BinanceSortHeader label="Volumen Operado" sortKey="total_volume_traded_usdt" currentSort={historySort} onSort={handleHistorySort} />
                    <BinanceSortHeader label="Trades Total" sortKey="total_trades" currentSort={historySort} onSort={handleHistorySort} align="center" />
                    <BinanceSortHeader label="PnL Cerrado" sortKey="net_pnl" currentSort={historySort} onSort={handleHistorySort} />
                    <BinanceSortHeader label="PnL Flotante" sortKey="unrealized_pnl" currentSort={historySort} onSort={handleHistorySort} />
                    <BinanceSortHeader label="Patrimonio Neto" sortKey="net_equity_pnl" currentSort={historySort} onSort={handleHistorySort} />
                    <BinanceSortHeader label="Diagnóstico Estado" sortKey="trapped_coins_count" currentSort={historySort} onSort={handleHistorySort} />
                    <th className="px-3 py-2.5 text-right font-medium text-[11px] uppercase tracking-wider text-slate-400">Acciones Prueba</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-800 font-mono text-xs">
                  {filteredAndSortedHistory.map((item) => {
                      const hasTrapped = (item.trapped_coins_count || 0) > 0;
                      const isProfit = (item.net_pnl || 0) >= 0;
                      const isEquityProfit = (item.net_equity_pnl || 0) >= 0;
                      const startBal = item.initial_balance || (item.is_portfolio ? (item.symbols_count || 8) * 1000 : 1000);
                      const endBal = item.final_equity !== undefined ? item.final_equity : (item.final_balance !== undefined ? item.final_balance : (startBal + (item.net_equity_pnl !== undefined ? item.net_equity_pnl : (item.net_pnl || 0))));
                      const volTraded = item.total_volume_traded_usdt || (item.total_trades * 100);
                      return (
                        <tr key={item.id} className="hover:bg-slate-800/60 transition-colors">
                          <td className="px-3 py-2.5 text-slate-300 whitespace-nowrap">
                            {item.timestamp?.substring(5, 16)}
                          </td>
                          <td className="px-3 py-2.5 font-sans font-bold text-white truncate max-w-[140px]">
                            {item.strategy_name}
                          </td>
                          <td className="px-3 py-2.5">
                            {item.is_portfolio ? (
                              <span className="px-2 py-0.5 rounded bg-indigo-950 text-indigo-200 border border-indigo-500/50 font-bold text-[10px]">
                                🌐 Portafolio ({item.symbols_count})
                              </span>
                            ) : (
                              <span className="px-2 py-0.5 rounded bg-amber-950 text-amber-200 border border-amber-500/50 font-bold text-[10px]">
                                🪙 {item.symbol}
                              </span>
                            )}
                          </td>
                          <td className="px-3 py-2.5 text-slate-300 whitespace-nowrap">
                            {item.period_label || `${item.days_tested} días`}
                          </td>
                          <td className="px-3 py-2.5 whitespace-nowrap">
                            <span className="font-mono text-slate-300">${startBal.toLocaleString()}</span>
                            <span className="text-slate-500 mx-1">→</span>
                            <span className={`font-mono font-medium ${endBal >= startBal ? 'text-emerald-400' : 'text-rose-400'}`}>
                              ${endBal.toLocaleString(undefined, {minimumFractionDigits: 1, maximumFractionDigits: 1})}
                            </span>
                          </td>
                          <td className="px-3 py-2.5 text-cyan-300 font-mono font-medium whitespace-nowrap">
                            ${volTraded.toLocaleString(undefined, {minimumFractionDigits: 0, maximumFractionDigits: 0})} USDT
                          </td>
                          <td className="px-3 py-2.5 text-center">
                            <span className="font-medium text-white">{item.total_trades}</span>
                            <span className="text-slate-300 text-[10px] block font-light">({item.winning_trades}G / {item.losing_trades}P - {item.win_rate_pct}%)</span>
                          </td>
                          <td className={`px-3 py-2.5 font-medium whitespace-nowrap ${isProfit ? 'text-emerald-400' : 'text-rose-400'}`}>
                            {isProfit ? '+' : ''}{item.net_pnl} USDT
                          </td>
                          <td className={`px-3 py-2.5 font-medium whitespace-nowrap ${(item.unrealized_pnl || 0) >= 0 ? 'text-emerald-400' : 'text-rose-400'}`}>
                            {(item.unrealized_pnl || 0) >= 0 ? '+' : ''}{item.unrealized_pnl || 0} USDT
                          </td>
                          <td className={`px-3 py-2.5 font-medium whitespace-nowrap ${isEquityProfit ? 'text-emerald-400' : 'text-rose-400'}`}>
                            {isEquityProfit ? '+' : ''}{item.net_equity_pnl || item.net_pnl} USDT
                          </td>
                          <td className="px-3 py-2.5">
                            {hasTrapped ? (
                              <span className="px-2 py-0.5 rounded-full text-[10px] font-bold bg-red-950 text-red-200 border border-red-500/50 whitespace-nowrap">
                                🚨 {item.trapped_coins_count} atrapadas
                              </span>
                            ) : (
                              <span className="px-2 py-0.5 rounded-full text-[10px] font-bold bg-emerald-950 text-emerald-200 border border-emerald-500/50 whitespace-nowrap">
                                🟢 Limpio
                              </span>
                            )}
                          </td>
                          <td className="px-3 py-2.5 text-right whitespace-nowrap">
                            <div className="flex items-center justify-end gap-1.5 font-sans">
                              <button
                                type="button"
                                onClick={() => handleLoadHistoryItem(item.id)}
                                className="px-2.5 py-1 bg-indigo-600 hover:bg-indigo-500 text-white rounded-lg text-xs font-bold transition shadow-sm"
                                title="Cargar y ver análisis completo y gráficos"
                              >
                                🔍 Ver
                              </button>
                              <button
                                type="button"
                                onClick={(e) => handleDeleteHistoryItem(e, item.id)}
                                className="p-1 text-slate-400 hover:text-red-400 rounded-lg hover:bg-slate-800 transition"
                                title="Eliminar de historial"
                              >
                                🗑️
                              </button>
                            </div>
                          </td>
                        </tr>
                      );
                    })}
                </tbody>
              </table>
            </div>
          )}
        </div>
      )}

      {/* VISTA: LABORATORIO DE SIMULACIÓN */}
      {activeTab === 'lab' && (
        <>
          {/* 2. Barra de Parámetros de Simulación */}
          <div className="bg-slate-900 border border-slate-700/80 rounded-2xl p-5 shadow-xl">
        
        {/* Acceso Rápido Portafolio vs Monedas */}
        <div className="mb-4 flex flex-wrap items-center gap-1.5">
          <span className="text-xs font-medium text-slate-300 mr-1">Alcance Prueba:</span>
          <button
            type="button"
            onClick={() => setSymbol('PORTFOLIO')}
            className={`px-3 py-1 text-xs font-medium rounded-xl border transition-all flex items-center gap-1 ${
              symbol === 'PORTFOLIO'
                ? 'bg-indigo-600 text-white border-indigo-500 shadow-md shadow-indigo-900/40 ring-1 ring-indigo-400/50'
                : 'bg-slate-950 text-slate-300 border-slate-700 hover:bg-slate-800 hover:text-white'
            }`}
          >
            <span>🌐</span>
            <span>Todo Portafolio</span>
          </button>

          {activePortfolioSymbols.map(sym => (
            <button
              key={sym}
              type="button"
              onClick={() => setSymbol(sym)}
              className={`px-2.5 py-1 text-xs font-mono font-medium rounded-xl border transition-all ${
                symbol === sym
                  ? 'bg-amber-400 text-slate-950 border-amber-400 font-semibold shadow-md ring-1 ring-amber-400/50'
                  : 'bg-slate-950 text-slate-300 border-slate-700 hover:bg-slate-800 hover:text-white'
              }`}
            >
              {sym.replace('USDT', '')}
            </button>
          ))}
        </div>

        {/* Selector de Modo de Tiempo: Días Recientes vs Rango de Fechas Calendario */}
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2.5 mb-4 border-b border-slate-700/80 pb-3">
          <div className="flex items-center gap-2">
            <span className="text-xs font-medium text-slate-300 uppercase tracking-wider">Modo Tiempo:</span>
            <div className="inline-flex rounded-xl bg-slate-950 p-1 border border-slate-700">
              <button
                type="button"
                onClick={() => setDateMode('relative')}
                className={`px-3 py-1 text-xs font-medium rounded-lg transition-all ${
                  dateMode === 'relative'
                    ? 'bg-slate-800 text-indigo-300 shadow'
                    : 'text-slate-300 hover:text-white'
                }`}
              >
                Días Recientes
              </button>
              <button
                type="button"
                onClick={() => setDateMode('range')}
                className={`px-3 py-1 text-xs font-medium rounded-lg transition-all ${
                  dateMode === 'range'
                    ? 'bg-slate-800 text-indigo-300 shadow'
                    : 'text-slate-300 hover:text-white'
                }`}
              >
                Rango Calendario
              </button>
            </div>
          </div>

          {/* Atajos de fechas históricas interesantes */}
          {dateMode === 'range' && (
            <div className="flex items-center flex-wrap gap-1.5 text-xs">
              <span className="text-[11px] text-slate-400 font-light">Atajos rápidos:</span>
              <button
                type="button"
                onClick={() => { setStartDate('2024-01-01'); setEndDate('2024-03-18'); }}
                className="px-2 py-0.5 bg-slate-950 hover:bg-indigo-950 text-indigo-300 border border-indigo-700/60 rounded-lg font-mono text-[11px] font-medium transition"
                title="Rango exacto de tu consulta"
              >
                Ene-Mar 2024
              </button>
              <button
                type="button"
                onClick={() => { setStartDate('2024-01-01'); setEndDate('2024-12-31'); }}
                className="px-2 py-0.5 bg-slate-950 hover:bg-indigo-950 text-indigo-300 border border-indigo-700/60 rounded-lg font-mono text-[11px] font-medium transition"
              >
                Todo 2024
              </button>
              <button
                type="button"
                onClick={() => { setStartDate('2023-01-01'); setEndDate('2023-12-31'); }}
                className="px-2 py-0.5 bg-slate-950 hover:bg-indigo-950 text-indigo-300 border border-indigo-700/60 rounded-lg font-mono text-[11px] font-medium transition"
              >
                Todo 2023
              </button>
              <button
                type="button"
                onClick={() => {
                  const now = new Date();
                  const end = now.toISOString().split('T')[0];
                  const dStart = new Date(now);
                  dStart.setDate(dStart.getDate() - 30);
                  setStartDate(dStart.toISOString().split('T')[0]);
                  setEndDate(end);
                }}
                className="px-2 py-0.5 bg-slate-950 hover:bg-slate-800 text-slate-200 border border-slate-600 rounded-lg font-mono text-[11px] font-medium transition"
              >
                Último Mes
              </button>
            </div>
          )}
        </div>

        <div className={`grid grid-cols-1 sm:grid-cols-2 ${dateMode === 'range' ? 'lg:grid-cols-7' : 'lg:grid-cols-6'} gap-4 items-end`}>
          
          {/* Criptomoneda / Modo */}
          <div>
            <label className="block text-xs font-medium text-slate-200 mb-1 flex items-center">
              <span>Selección Par</span>
              <Tooltip title="Selección de Par" text="Define si se evalúa un par específico (ej. SOLUSDT) o el portafolio completo con todas las monedas configuradas ejecutándose simultáneamente." example="PORTFOLIO simula el reparto equitativo del saldo entre todas tus monedas activas." />
            </label>
            <select
              value={symbol}
              onChange={(e) => setSymbol(e.target.value)}
              className="w-full px-3 py-2 bg-slate-950 border border-slate-600 rounded-xl text-sm font-normal text-white focus:ring-1 focus:ring-indigo-500 outline-none"
            >
              <option value="PORTFOLIO">🌐 TODO EL PORTAFOLIO ({configuredSymbols.length || 8} Monedas)</option>
              <optgroup label="Monedas Configuradas">
                {configuredSymbols.map(s => <option key={s} value={s}>{s}</option>)}
              </optgroup>
              <optgroup label="Otras Monedas Populares">
                {availableSymbols.filter(s => !configuredSymbols.includes(s)).map(s => (
                  <option key={s} value={s}>{s}</option>
                ))}
              </optgroup>
            </select>
          </div>

          {/* Periodo de Tiempo: Modo Relativo vs Modo Rango Calendario */}
          {dateMode === 'relative' ? (
            <div>
              <div className="flex items-center justify-between mb-1">
                <label className="text-xs font-medium text-slate-200 flex items-center">
                  <span>Periodo Días</span>
                  <Tooltip title="Periodo de Evaluación" text="Cantidad de días de historial de mercado real descargados desde Binance para someter la estrategia a prueba." example="30 días prueba el comportamiento reciente; 90 a 365 días evalúa mercados alcistas y bajistas." />
                </label>
              </div>
              <div className="flex items-center gap-1.5">
                <select
                  value={[3, 7, 14, 30, 45, 60, 90, 180, 365].includes(Number(days)) ? days : 'custom'}
                  onChange={(e) => {
                    if (e.target.value !== 'custom') {
                      setDays(Number(e.target.value));
                    }
                  }}
                  className="w-full px-2.5 py-2 bg-slate-950 border border-slate-600 rounded-xl text-xs sm:text-sm font-normal text-white focus:ring-1 focus:ring-indigo-500 outline-none"
                >
                  <option value="3">3 días</option>
                  <option value="7">7 días (1 sem)</option>
                  <option value="14">14 días (2 sem)</option>
                  <option value="30">30 días (1 mes)</option>
                  <option value="45">45 días (1.5 meses)</option>
                  <option value="60">60 días (2 meses)</option>
                  <option value="90">90 días (3 meses)</option>
                  <option value="180">180 días (6 meses)</option>
                  <option value="365">365 días (1 año)</option>
                  <option value="custom">Personalizado...</option>
                </select>
                <input
                  type="number"
                  min="1"
                  max="730"
                  value={days}
                  onChange={(e) => setDays(Math.max(1, Number(e.target.value)))}
                  className="w-16 px-2 py-2 bg-slate-950 border border-slate-600 rounded-xl text-xs sm:text-sm font-mono font-medium text-center text-white focus:ring-1 focus:ring-indigo-500 outline-none"
                  title="Escribe cualquier número exacto de días"
                />
              </div>
            </div>
          ) : (
            <>
              {/* Fecha Inicio (Desde) */}
              <div>
                <label className="block text-xs font-medium text-slate-200 mb-1 flex items-center">
                  <span>Fecha Inicio</span>
                  <Tooltip title="Fecha de Inicio" text="Fecha inicial desde la cual se descargan las velas históricas de Binance para la simulación." />
                </label>
                <input
                  type="date"
                  value={startDate}
                  onChange={(e) => setStartDate(e.target.value)}
                  max={endDate || new Date().toISOString().split('T')[0]}
                  className="w-full px-2.5 py-2 bg-slate-950 border border-slate-600 rounded-xl text-xs sm:text-sm font-normal text-white focus:ring-1 focus:ring-indigo-500 outline-none"
                />
              </div>

              {/* Fecha Fin (Hasta) */}
              <div>
                <label className="block text-xs font-medium text-slate-200 mb-1 flex items-center">
                  <span>Fecha Fin</span>
                  <Tooltip title="Fecha de Fin" text="Fecha de corte final en la que se evalúa el resultado acumulado y el estado de las órdenes." />
                </label>
                <input
                  type="date"
                  value={endDate}
                  onChange={(e) => setEndDate(e.target.value)}
                  min={startDate}
                  max={new Date().toISOString().split('T')[0]}
                  className="w-full px-2.5 py-2 bg-slate-950 border border-slate-600 rounded-xl text-xs sm:text-sm font-normal text-white focus:ring-1 focus:ring-indigo-500 outline-none"
                />
              </div>
            </>
          )}

          {/* Intervalo de Velas */}
          <div>
            <label className="block text-xs font-medium text-slate-200 mb-1 flex items-center">
              <span>Temporalidad Velas</span>
              <Tooltip title="Temporalidad de Velas" text="Resolución temporal (1m, 5m, 15m, 1h) en la que el algoritmo calcula el RSI, volumen y medias móviles." example="5m es la recomendada para evitar ruido excesivo manteniendo buena velocidad de respuesta." />
            </label>
            <select
              value={interval}
              onChange={(e) => setInterval(e.target.value)}
              className="w-full px-3 py-2 bg-slate-950 border border-slate-600 rounded-xl text-sm font-normal text-white focus:ring-1 focus:ring-indigo-500 outline-none"
            >
              <option value="1m">1 Minuto (1m)</option>
              <option value="5m">5 Minutos (5m - Recomendado)</option>
              <option value="15m">15 Minutos (15m)</option>
              <option value="1h">1 Hora (1h)</option>
            </select>
          </div>

          {/* Capital Inicial */}
          <div>
            <label className="block text-xs font-medium text-slate-200 mb-1 flex items-center">
              <span>Saldo Cartera</span>
              <Tooltip title="Saldo de Cartera" text="Capital total en USDT simulado para la cuenta. Si pruebas en modo Portafolio, este saldo se divide equitativamente entre los pares." example="Con $600 en 6 pares, cada moneda dispone de $100 USDT de presupuesto." />
            </label>
            <input
              type="number"
              value={initialBalance}
              onChange={(e) => setInitialBalance(Number(e.target.value))}
              min="10"
              step="50"
              className="w-full px-3 py-2 bg-slate-950 border border-slate-600 rounded-xl text-sm font-mono font-medium text-white focus:ring-1 focus:ring-indigo-500 outline-none"
            />
          </div>

          {/* Selector de Estrategia */}
          <div>
            <div className="flex items-center justify-between mb-1">
              <label className="text-xs font-medium text-slate-200 flex items-center">
                <span>Estrategia Prueba</span>
                <Tooltip title="Estrategia de Prueba" text="Permite seleccionar si se prueba la configuración activa actual del bot o una de las estrategias guardadas en el historial." example="Selecciona 'sniper' o 'agresivo' para comparar su rentabilidad histórica." />
              </label>
              <button
                type="button"
                onClick={handleOpenPruneModal}
                className="text-[10px] text-amber-400 hover:text-amber-300 font-medium underline cursor-pointer"
                title="Depurar y conservar solo las N mejores estrategias más rentables"
              >
                Conservar Top
              </button>
            </div>
            <select
              value={strategySource}
              onChange={(e) => {
                const newSource = e.target.value;
                setStrategySource(newSource);
                // Sincronizar automáticamente la temporalidad de velas a la estrategia elegida
                let stratInterval = null;
                if (newSource === 'current') {
                  stratInterval = activeConfig?.rsiInterval || activeConfig?.rsi_interval;
                } else {
                  const found = savedStrategies.find(s => s.name === newSource);
                  stratInterval = found?.config?.rsiInterval || found?.config?.rsi_interval;
                }
                if (stratInterval && ['1m', '3m', '5m', '15m', '30m', '1h', '2h', '4h', '1d'].includes(stratInterval)) {
                  setInterval(stratInterval);
                }
              }}
              className="w-full px-3 py-2 bg-slate-950 border border-slate-600 rounded-xl text-sm font-normal text-white focus:ring-1 focus:ring-indigo-500 outline-none truncate"
            >
              <option value="current">⭐ Configuración Actual del Bot</option>
              {savedStrategies.map(s => (
                <option key={s.name} value={s.name}>📁 {s.name}</option>
              ))}
            </select>
          </div>

          {/* Botón Ejecutar */}
          <div>
            <button
              type="button"
              onClick={handleRunBacktest}
              disabled={isRunning}
              className={`w-full py-2.5 px-4 font-medium rounded-xl text-white shadow-lg transition-all flex items-center justify-center gap-2 active:scale-95 text-sm ${
                isRunning
                  ? 'bg-indigo-700 opacity-60 cursor-not-allowed'
                  : 'bg-indigo-600 hover:bg-indigo-500 shadow-indigo-900/40 ring-1 ring-indigo-400/50'
              }`}
            >
              {isRunning ? (
                <>
                  <span className="animate-spin text-sm">⏳</span>
                  <span>Simulando Prueba</span>
                </>
              ) : (
                <>
                  <span>⚡</span>
                  <span>{symbol === 'PORTFOLIO' ? 'Test Portafolio' : 'Test Moneda'}</span>
                </>
              )}
            </button>
          </div>
        </div>

        {/* Tira Informativa de Parámetros de la Estrategia Seleccionada en el Menú */}
        {configToTest && (
          <div className="mt-3.5 pt-3 border-t border-slate-800/90 flex flex-col lg:flex-row lg:items-center justify-between gap-2.5 animate-fadeIn">
            <div className="flex items-center flex-wrap gap-2 flex-shrink-0">
              <span className="text-[11px] font-medium text-amber-400 uppercase tracking-wider flex items-center gap-1">
                <span>⭐</span> Estrategia Seleccionada:
              </span>
              <span className="text-xs font-medium text-amber-200 font-mono bg-amber-950/80 px-2.5 py-0.5 rounded-lg border border-amber-600/50">
                {strategySource === 'current' ? (activeConfig?.activeStrategyName || 'Configuración Actual') : strategySource}
              </span>
            </div>
            <div className="flex-grow flex items-center justify-start lg:justify-end overflow-x-auto">
              <StrategyBadgesPills config={configToTest} />
            </div>
          </div>
        )}
      </div>

      {/* 3. Panel de Resultados (Si se ha ejecutado) */}
      {results && !results.error && (
        <div className="space-y-6 animate-fadeIn">

          {/* FICHA TÉCNICA: PARÁMETROS, TAMAÑO DE POSICIONES Y GESTIÓN DE RIESGO */}
          {(() => {
            const activeCfg = results?.config || loadedHistoryItem?.config || configToTest || {};
            const posSize = Number(activeCfg.positionSizeUSDT ?? activeCfg.position_size_usdt ?? activeCfg.order_size_usdt ?? activeCfg.orderSizeUsdt ?? 35);
            const lev = Number(activeCfg.leverage ?? 10);
            const notional = posSize * lev;
            const initBal = Number(results.initial_balance || 600);
            const symCount = results.symbols_count || (results.symbols_list ? results.symbols_list.length : (results.is_portfolio ? 6 : 1));
            const coinBudget = results.is_portfolio ? (initBal / (symCount || 1)) : initBal;
            
            const isDca = activeCfg.enableDcaReentry === true || String(activeCfg.enableDcaReentry).toLowerCase() === 'true';
            const dcaMax = Number(activeCfg.dcaMaxReentries ?? activeCfg.dca_max_reentries ?? 3);
            const dcaDrop = Number(activeCfg.dcaPriceDropPercent ?? activeCfg.dca_price_drop_percent ?? 1.6);
            const dcaMult = Number(activeCfg.dcaVolumeMultiplier ?? activeCfg.dca_volume_multiplier ?? 1.25);
            
            let totalDcaMargin = posSize;
            let curDca = posSize;
            if (isDca) {
              for (let i = 0; i < dcaMax; i++) {
                curDca = curDca * dcaMult;
                totalDcaMargin += curDca;
              }
            }

            const tpVal = activeCfg.takeProfitUSDT ?? activeCfg.take_profit_usdt;
            const isTpEnabled = activeCfg.enableTakeProfitPnl === true || String(activeCfg.enableTakeProfitPnl).toLowerCase() === 'true' || (tpVal !== undefined && Number(tpVal) > 0);
            const slVal = activeCfg.stopLossUSDT ?? activeCfg.stop_loss_usdt;
            const isSlEnabled = activeCfg.enableStopLossPnl === true || String(activeCfg.enableStopLossPnl).toLowerCase() === 'true';
            const isTrailingPnl = activeCfg.enablePnlTrailingStop === true || String(activeCfg.enablePnlTrailingStop).toLowerCase() === 'true';
            const pnlAct = activeCfg.pnlTrailingStopActivationUSDT ?? activeCfg.pnl_trailing_stop_activation_usdt;
            const pnlDrop = activeCfg.pnlTrailingStopDropUSDT ?? activeCfg.pnl_trailing_stop_drop_usdt;
            const testStrategyName = activeCfg.activeStrategyName || activeCfg.strategy_name || results?.strategy_name || loadedHistoryItem?.strategy_name || (strategySource === 'current' ? (activeConfig?.activeStrategyName || 'Estrategia Bot') : strategySource);
            const periodStr = results.period_label || (results.start_date && results.end_date ? `${results.start_date} al ${results.end_date}` : `${results.days_tested} días`);
            const testInterval = results.interval || activeCfg.rsiInterval || activeCfg.rsi_interval || interval;
            const testExecutionTime = results?.executed_at || results?.timestamp || loadedHistoryItem?.timestamp || loadedHistoryItem?.summary?.timestamp;

            return (
              <div className="bg-slate-900 border border-indigo-900/60 rounded-2xl p-4 sm:p-5 shadow-xl space-y-4">
                {/* HEADER DE LA PRUEBA EJECUTADA: NOMBRE, RANGO DE FECHAS Y PÍLDORAS TÉCNICAS DE ESTA PRUEBA */}
                <div className="border-b border-slate-800 pb-3 space-y-2.5">
                  <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2.5">
                    <div className="flex items-center flex-wrap gap-2.5">
                      <span className="text-lg">🧪</span>
                      <h3 className="font-medium text-white text-sm sm:text-base tracking-wide flex items-center gap-1.5">
                        <span className="text-slate-300">Prueba:</span>
                        <span className="px-2.5 py-0.5 rounded-lg text-xs sm:text-sm font-mono font-medium bg-indigo-950 text-indigo-200 border border-indigo-600/70 shadow-sm">
                          {testStrategyName}
                        </span>
                      </h3>

                      {/* Rango de Fechas Exacto de esta Prueba */}
                      <span className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-lg text-xs font-medium bg-slate-950/90 text-indigo-200 border border-indigo-700/60 shadow-sm" title="Periodo exacto evaluado en esta prueba">
                        <span>📅 Del</span>
                        <span className="font-mono text-white font-medium">
                          {periodStr}
                        </span>
                        <span className="text-indigo-300 font-sans text-[11px] font-light">
                          ({results.days_tested}d • ⏱️ {testInterval}{results.symbols_count ? ` • ⭐ ${results.symbols_count} pares` : ''})
                        </span>
                      </span>

                      {/* Fecha y Hora Exacta de Ejecución */}
                      {testExecutionTime && (
                        <span className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-lg text-xs font-light bg-slate-950/90 text-slate-300 border border-slate-700/60 shadow-sm" title="Fecha y hora exacta en que se realizó esta prueba">
                          <span className="text-slate-400">🕒</span>
                          <span className="text-slate-400 font-light">Ejecutada:</span>
                          <span className="font-mono text-white font-medium">{testExecutionTime}</span>
                        </span>
                      )}
                    </div>
                  </div>

                  {/* Badges Técnicos Congelados de la Estrategia de esta Prueba */}
                  <div className="pt-0.5 flex items-center overflow-x-auto">
                    <StrategyBadgesPills config={activeCfg} />
                  </div>
                </div>

                <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3">
                  {/* Bloque 1: Cartera Base */}
                  <div className="p-3 bg-slate-950/80 rounded-xl border border-slate-800/90 flex flex-col justify-between">
                    <div>
                      <span className="text-[11px] font-medium text-slate-400 uppercase tracking-wider flex items-center gap-1.5">
                        <span>💼</span> Cartera Base
                        <Tooltip title="Cartera Base" text="Capital total en USDT asignado a la simulación y su distribución individual por cada par si se operó en modo portafolio." />
                      </span>
                      <div className="text-lg sm:text-xl font-medium font-mono text-white mt-1">
                        ${initBal.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })} <span className="text-xs font-normal text-slate-400">USDT</span>
                      </div>
                    </div>
                    <div className="text-[11px] text-slate-300 mt-1.5 font-light">
                      {results.is_portfolio ? (
                        <span>Asignado: <b className="font-medium text-white">${coinBudget.toFixed(0)} USDT</b> por par en {symCount} pares</span>
                      ) : (
                        <span>Asignado exclusivamente al par <b className="font-medium text-white">{results.symbol}</b></span>
                      )}
                    </div>
                  </div>

                  {/* Bloque 2: Orden Inicial */}
                  <div className="p-3 bg-slate-950/80 rounded-xl border border-slate-800/90 flex flex-col justify-between">
                    <div>
                      <span className="text-[11px] font-medium text-slate-400 uppercase tracking-wider flex items-center gap-1.5">
                        <span>🎯</span> Orden Inicial
                        <Tooltip title="Orden Inicial" text="Margen inicial comprometido por cada posición y su valor nocional en Binance aplicando el apalancamiento configurado." example="$35 de margen con 10x apalancamiento equivale a una orden real de $350 USDT." />
                      </span>
                      <div className="text-lg sm:text-xl font-medium font-mono text-cyan-400 mt-1">
                        ${posSize.toFixed(2)} <span className="text-xs font-normal text-slate-400">USDT margen</span>
                      </div>
                    </div>
                    <div className="text-[11px] text-slate-300 mt-1.5 font-light">
                      <span>Nocional: <b className="font-medium text-white">${notional.toFixed(0)} USDT</b> ({lev}x) • <span className="text-cyan-300 font-medium">{((posSize / coinBudget) * 100).toFixed(0)}%</span> cartera/par</span>
                    </div>
                  </div>

                  {/* Bloque 3: Cobertura Recompras */}
                  <div className="p-3 bg-slate-950/80 rounded-xl border border-slate-800/90 flex flex-col justify-between">
                    <div>
                      <span className="text-[11px] font-medium text-slate-400 uppercase tracking-wider flex items-center gap-1.5">
                        <span>🛡️</span> Cobertura Recompras
                        <Tooltip title="Cobertura Recompras (DCA)" text="Estrategia de re-entradas escalonadas (DCA) al caer el precio para reducir el precio promedio de entrada de la posición." example="Máximo 3 recompras al caer 1.6% con multiplicador 1.25x de volumen." />
                      </span>
                      <div className="text-lg sm:text-xl font-medium font-mono text-amber-300 mt-1">
                        {isDca ? `${dcaMax} Recompras` : 'Sin DCA'}
                      </div>
                    </div>
                    <div className="text-[11px] text-slate-300 mt-1.5 font-light">
                      {isDca ? (
                        <span>Paso -{dcaDrop}% • x{dcaMult} • Máx expuesto <b className="font-medium text-amber-200">${totalDcaMargin.toFixed(2)}</b></span>
                      ) : (
                        <span>Solo 1 orden inicial fija por moneda</span>
                      )}
                    </div>
                  </div>

                  {/* Bloque 4: Reglas Salida */}
                  <div className="p-3 bg-slate-950/80 rounded-xl border border-slate-800/90 flex flex-col justify-between">
                    <div>
                      <span className="text-[11px] font-medium text-slate-400 uppercase tracking-wider flex items-center gap-1.5">
                        <span>🏁</span> Reglas Salida
                        <Tooltip title="Reglas de Salida" text="Mecanismos de toma de beneficios (Take Profit), aseguramiento dinámico (Trailing Stop) y corte de pérdidas (Stop Loss)." />
                      </span>
                      <div className="text-lg sm:text-xl font-medium font-mono text-emerald-400 mt-1">
                        {isTpEnabled && tpVal ? `+${tpVal} USDT` : 'Trailing / Mercado'}
                      </div>
                    </div>
                    <div className="text-[11px] text-slate-300 mt-1.5 font-light space-y-0.5">
                      <div>
                        {isTrailingPnl ? `Trailing: activa +$${pnlAct} / retroceso $${pnlDrop}` : 'Sin Trailing PnL'}
                      </div>
                      <div className={isSlEnabled ? 'text-slate-300' : 'text-rose-400 font-medium'}>
                        {isSlEnabled ? `Stop Loss: -$${Math.abs(Number(slVal))} USDT` : '⚠️ SL desactivado'}
                      </div>
                    </div>
                  </div>
                </div>
              </div>
            );
          })()}

          {/* BANNER DESTACADO: FLUJO FINANCIERO (CAPITAL INICIAL, FINAL, EQUITY Y VOLUMEN COMERCIALIZADO) */}
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3 bg-slate-900 border border-slate-700/80 rounded-2xl p-4 sm:p-5 shadow-xl">
            {/* 1. Capital Inicial (Comienzo) */}
            <div className="p-3.5 bg-slate-950/90 rounded-xl border border-slate-800 flex flex-col justify-between">
              <div>
                <span className="text-[11px] font-medium text-slate-400 uppercase tracking-wider flex items-center gap-1.5">
                  <span>💰</span> Capital Inicial
                  <Tooltip title="Capital Inicial" text="Balance inicial en USDT con el que arrancó la simulación de trading." />
                </span>
                <div className="text-xl sm:text-2xl font-medium font-mono mt-1 text-white">
                  ${(results.initial_balance || 1000)?.toLocaleString(undefined, {minimumFractionDigits: 2, maximumFractionDigits: 2})} <span className="text-xs font-normal text-slate-400">USDT</span>
                </div>
              </div>
              <span className="text-[11px] text-slate-300 block mt-1 font-light">
                {results.is_portfolio ? `Base asignada (${results.symbols_count} pares)` : 'Saldo base de la cuenta'}
              </span>
            </div>

            {/* 2. Capital Final (Término) */}
            <div className="p-3.5 bg-slate-950/90 rounded-xl border border-slate-800 flex flex-col justify-between">
              <div>
                <span className="text-[11px] font-medium text-slate-400 uppercase tracking-wider flex items-center gap-1.5">
                  <span>🏁</span> Capital Final
                  <Tooltip title="Capital Final (Equity)" text="Balance total al concluir el periodo de prueba sumando el saldo de billetera más el valor liquidativo de posiciones abiertas." />
                </span>
                <div className={`text-xl sm:text-2xl font-medium font-mono mt-1 ${
                  (results.final_equity !== undefined ? results.final_equity : results.final_balance) >= (results.initial_balance || 1000)
                    ? 'text-emerald-400' 
                    : 'text-rose-400'
                }`}>
                  ${(results.final_equity !== undefined ? results.final_equity : results.final_balance)?.toLocaleString(undefined, {minimumFractionDigits: 2, maximumFractionDigits: 2})} <span className="text-xs font-normal">USDT</span>
                </div>
              </div>
              <div className="text-[11px] mt-1 font-mono font-medium flex items-center justify-between">
                <span className={(results.net_equity_pnl !== undefined ? results.net_equity_pnl : results.net_pnl) >= 0 ? 'text-emerald-400' : 'text-rose-400'}>
                  {(results.net_equity_pnl !== undefined ? results.net_equity_pnl : results.net_pnl) >= 0 ? '+' : ''}{results.net_equity_pnl !== undefined ? results.net_equity_pnl : results.net_pnl} USDT
                </span>
                <span className="text-slate-300 font-light">
                  ({results.net_equity_return_pct !== undefined ? results.net_equity_return_pct : results.net_return_pct}%)
                </span>
              </div>
            </div>

            {/* 3. Volumen Total Comercializado */}
            <div className="p-3.5 bg-slate-950/90 rounded-xl border border-slate-800 flex flex-col justify-between">
              <div>
                <span className="text-[11px] font-medium text-slate-400 uppercase tracking-wider flex items-center gap-1.5">
                  <span>🔄</span> Volumen Total
                  <Tooltip 
                    title="Volumen Total Transaccionado" 
                    text="Suma acumulada del valor nocional en USDT de todas las compras y ventas ejecutadas. Sobre este monto exacto es que Binance Futures calcula y descuenta las comisiones oficiales (0.02% Maker en órdenes límite y 0.04% Taker en salidas por Stop Loss o mercado)." 
                    example="Si abres y cierras una posición nocional de $350 USDT (ej: $35 de margen con 10x), el volumen total generado es de $700 USDT, pagando aprox. $0.21 USDT en comisiones." 
                  />
                </span>
                <div className="text-xl sm:text-2xl font-medium font-mono mt-1 text-cyan-400">
                  ${(results.total_volume_traded_usdt || results.total_volume_traded || 0)?.toLocaleString(undefined, {minimumFractionDigits: 2, maximumFractionDigits: 2})} <span className="text-xs font-normal text-slate-400">USDT</span>
                </div>
              </div>
              <div className="text-[11px] text-slate-300 mt-1 font-light flex items-center justify-between">
                <span>Comisiones pagadas:</span>
                <span className="text-amber-300 font-mono font-medium">
                  -${(results.total_fees_usdt !== undefined ? results.total_fees_usdt : (results.total_fees || 0))?.toFixed(2)} USDT
                </span>
              </div>
            </div>

            {/* 4. Margen / Capital Puesto en Juego */}
            <div className="p-3.5 bg-slate-950/90 rounded-xl border border-slate-800 flex flex-col justify-between">
              <div>
                <span className="text-[11px] font-medium text-slate-400 uppercase tracking-wider flex items-center gap-1.5">
                  <span>🛡️</span> Margen Máximo
                  <Tooltip title="Margen Máximo Comprometido" text="Pico máximo de margen retenido simultáneamente en posiciones abiertas durante el periodo evaluado." />
                </span>
                <div className="text-xl sm:text-2xl font-medium font-mono mt-1 text-amber-300">
                  ${(results.total_margin_used_usdt || results.total_margin_used || 0)?.toLocaleString(undefined, {minimumFractionDigits: 2, maximumFractionDigits: 2})} <span className="text-xs font-normal text-slate-400">USDT</span>
                </div>
              </div>
              <span className="text-[11px] text-slate-300 block mt-1 font-light">
                Pico máx simultáneo: ${(results.peak_margin_used_usdt || results.peak_margin_used || 0)?.toFixed(2)} USDT
              </span>
            </div>
          </div>
          
          {/* Métricas Principales (KPI Cards) */}
          <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 xl:grid-cols-7 gap-3 sm:gap-4">
            
            {/* PnL Realizado (Cerradas) */}
            <div className={`p-4 rounded-2xl border shadow-md ${
              results.net_pnl >= 0
                ? 'bg-emerald-950/20 border-emerald-500/40'
                : 'bg-rose-950/20 border-rose-500/40'
            }`}>
              <div className="text-[11px] font-medium uppercase tracking-wider text-slate-400 flex items-center justify-between">
                <span>PnL Realizado</span>
                <Tooltip title="PnL Realizado" text="Beneficio o pérdida neta definitiva obtenida exclusivamente de operaciones que ya fueron cerradas." />
              </div>
              <div className={`text-xl font-medium font-mono mt-1 ${
                results.net_pnl >= 0 ? 'text-emerald-400' : 'text-rose-400'
              }`}>
                {results.net_pnl >= 0 ? '+' : ''}{results.net_pnl} <span className="text-xs font-normal">USDT</span>
              </div>
              <div className="text-[11px] text-slate-300 font-mono mt-0.5 font-light">
                {results.winning_trades}G / {results.losing_trades}P ({results.win_rate_pct}%)
              </div>
            </div>

            {/* Pérdidas / Ganancias Flotantes (No Realizadas) */}
            <div className={`p-4 rounded-2xl border shadow-md ${
              (results.total_unrealized_pnl !== undefined ? results.total_unrealized_pnl : (results.unrealized_pnl || 0)) >= 0
                ? 'bg-emerald-950/20 border-emerald-500/40'
                : 'bg-rose-950/20 border-rose-500/40'
            }`}>
              <div className="text-[11px] font-medium uppercase tracking-wider text-slate-400 flex items-center justify-between">
                <span>PnL Flotante</span>
                <Tooltip title="PnL Flotante (Latente)" text="Ganancia o pérdida no realizada de las posiciones que continuaban abiertas al concluir el periodo analizado." />
              </div>
              <div className={`text-xl font-medium font-mono mt-1 ${
                (results.total_unrealized_pnl !== undefined ? results.total_unrealized_pnl : (results.unrealized_pnl || 0)) >= 0 
                  ? 'text-emerald-400' 
                  : 'text-rose-400'
              }`}>
                {(results.total_unrealized_pnl !== undefined ? results.total_unrealized_pnl : (results.unrealized_pnl || 0)) >= 0 ? '+' : ''}
                {results.total_unrealized_pnl !== undefined ? results.total_unrealized_pnl : (results.unrealized_pnl || 0)} <span className="text-xs font-normal">USDT</span>
              </div>
              <div className="text-[11px] text-slate-300 font-mono mt-0.5 font-light">
                {(results.trapped_coins_count || 0) > 0 ? (
                  <span className="text-rose-300 font-normal">⚠️ {results.trapped_coins_count} moneda(s) atrapadas</span>
                ) : (
                  <span>{results.open_positions?.length || (results.open_position ? 1 : 0)} posición abierta</span>
                )}
              </div>
            </div>

            {/* Patrimonio Neto (Equity Real) */}
            <div className={`p-4 rounded-2xl border shadow-md ${
              (results.net_equity_pnl !== undefined ? results.net_equity_pnl : results.net_pnl) >= 0
                ? 'bg-emerald-950/20 border-emerald-500/40'
                : 'bg-rose-950/20 border-rose-500/40'
            }`}>
              <div className="text-[11px] font-medium uppercase tracking-wider text-slate-400 flex items-center justify-between">
                <span>Patrimonio Neto</span>
                <Tooltip title="Patrimonio Neto (Equity)" text="Resultado financiero global de la cuenta combinando el PnL realizado de trades cerrados y el flotante de trades abiertos." />
              </div>
              <div className={`text-xl font-medium font-mono mt-1 ${
                (results.net_equity_pnl !== undefined ? results.net_equity_pnl : results.net_pnl) >= 0 
                  ? 'text-emerald-400' 
                  : 'text-rose-400'
              }`}>
                {(results.net_equity_pnl !== undefined ? results.net_equity_pnl : results.net_pnl) >= 0 ? '+' : ''}
                {results.net_equity_pnl !== undefined ? results.net_equity_pnl : results.net_pnl} <span className="text-xs font-normal">USDT</span>
              </div>
              <div className="text-[11px] text-slate-300 font-mono mt-0.5 font-light">
                Realizado + Flotante
              </div>
            </div>

            {/* Win Rate */}
            <div className="p-4 rounded-2xl border border-slate-700/80 bg-slate-900 shadow-md">
              <div className="text-[11px] font-medium uppercase tracking-wider text-slate-400 flex items-center justify-between">
                <span>Tasa Acierto</span>
                <Tooltip title="Tasa de Acierto (Win Rate)" text="Porcentaje de operaciones completadas con ganancia sobre el total de operaciones cerradas." example="Un Win Rate del 70% significa que 7 de cada 10 operaciones fueron exitosas." />
              </div>
              <div className="text-xl font-medium font-mono mt-1 text-white">
                {results.win_rate_pct}%
              </div>
              <div className="text-[11px] text-slate-300 mt-0.5 font-light">
                {results.winning_trades} de {results.total_trades} cerradas
              </div>
            </div>

            {/* Profit Factor */}
            <div className="p-4 rounded-2xl border border-slate-700/80 bg-slate-900 shadow-md">
              <div className="text-[11px] font-medium uppercase tracking-wider text-slate-400 flex items-center justify-between">
                <span>Factor Beneficio</span>
                <Tooltip title="Factor de Beneficio (Profit Factor)" text="Ratio entre las ganancias brutas y las pérdidas brutas. Un valor mayor a 1.5 refleja solidez." example="Un factor de 2.0 indica que se ganaron $2 por cada $1 perdido." />
              </div>
              <div className={`text-xl font-medium font-mono mt-1 ${
                results.profit_factor >= 1.5 ? 'text-emerald-400' : results.profit_factor >= 1.0 ? 'text-amber-300' : 'text-rose-400'
              }`}>
                {results.profit_factor}
              </div>
              <div className="text-[11px] text-slate-300 mt-0.5 font-light">
                {results.profit_factor >= 2.0 ? '🌟 Excelente' : results.profit_factor >= 1.2 ? '✓ Sólido' : '⚠️ Ajustar'}
              </div>
            </div>

            {/* Máximo Drawdown */}
            <div className="p-4 rounded-2xl border border-slate-700/80 bg-slate-900 shadow-md">
              <div className="text-[11px] font-medium uppercase tracking-wider text-slate-400 flex items-center justify-between">
                <span>Drawdown Máximo</span>
                <Tooltip title="Máxima Caída (Drawdown)" text="El mayor descenso porcentual y en USDT experimentado por la cuenta desde su nivel más alto hasta el punto más bajo." example="Un Drawdown bajo (<10-15%) minimiza el riesgo de liquidación." />
              </div>
              <div className="text-xl font-medium font-mono mt-1 text-amber-400">
                -{results.max_drawdown_pct}%
              </div>
              <div className="text-[11px] text-slate-300 font-mono mt-0.5 font-light">
                -${results.max_drawdown_usdt} USDT
              </div>
            </div>

            {/* Riesgo Liquidación */}
            {(() => {
              const activeCfg = results?.config || loadedHistoryItem?.config || configToTest || {};
              const lev = Number(activeCfg.leverage ?? 10) || 10;
              const liqDropPct = results.liquidation_drop_pct || Number((98.0 / lev).toFixed(1));
              const slVal = activeCfg.stopLossUSDT ?? activeCfg.stop_loss_usdt;
              const isSlEnabled = activeCfg.enableStopLossPnl === true || String(activeCfg.enableStopLossPnl).toLowerCase() === 'true';
              const numSl = Math.abs(Number(slVal));

              let statusBg = 'bg-rose-950/20 border-rose-500/40';
              let statusText = 'text-rose-400';
              let badgeLabel = '🚨 Peligro: Sin SL';
              let badgeColor = 'text-rose-300 bg-rose-950/80 border-rose-600/50';
              let subLabel = `Liquidación a -${liqDropPct}%`;

              if (isSlEnabled && !isNaN(numSl) && numSl > 0) {
                statusBg = 'bg-emerald-950/20 border-emerald-500/40';
                statusText = 'text-emerald-400';
                badgeLabel = '🛡️ Con Stop Loss';
                badgeColor = 'text-emerald-300 bg-emerald-950/80 border-emerald-600/50';
                subLabel = `Corte máx -$${numSl} USDT`;
              } else if (lev <= 5) {
                statusBg = 'bg-amber-950/20 border-amber-500/40';
                statusText = 'text-amber-300';
                badgeLabel = '⚡ Sin SL (Bajo Lev)';
                badgeColor = 'text-amber-300 bg-amber-950/80 border-amber-600/50';
                subLabel = `Soporta hasta -${liqDropPct}%`;
              }

              const stressText = results.max_floating_drop_pct ? ` En esta prueba la peor caída flotante que sufrió una posición fue de -${results.max_floating_drop_pct}%.` : '';

              return (
                <div className={`p-4 rounded-2xl border shadow-md flex flex-col justify-between ${statusBg}`}>
                  <div>
                    <div className="text-[11px] font-medium uppercase tracking-wider text-slate-400 flex items-center justify-between">
                      <span>Riesgo Liquidación</span>
                      <Tooltip 
                        title="Riesgo de Liquidación" 
                        text={`Porcentaje de caída adversa que soporta la posición antes de agotar su margen y ser liquidada por Binance a ${lev}x de apalancamiento.${stressText} Permite verificar si la cuenta está protegida por Stop Loss o en peligro ante caídas abruptas de mercado.`} 
                        example={`Con ${lev}x sin Stop Loss, un descenso de -${liqDropPct}% liquida el 100% del margen. Con Stop Loss activo, el bot corta la pérdida antes de llegar a la liquidación.`}
                      />
                    </div>
                    <div className={`text-xl font-medium font-mono mt-1 ${statusText}`}>
                      -{liqDropPct}%
                    </div>
                  </div>
                  <div className="mt-1">
                    <span className={`inline-flex items-center px-1.5 py-0.5 rounded text-[10.5px] font-medium border ${badgeColor}`}>
                      {badgeLabel}
                    </span>
                    <div className="text-[10.5px] text-slate-300 font-mono mt-0.5 font-light truncate">
                      {results.max_floating_drop_pct ? (
                        <span>Peor caída: -{results.max_floating_drop_pct}%</span>
                      ) : (
                        <span>{subLabel}</span>
                      )}
                    </div>
                  </div>
                </div>
              );
            })()}
          </div>

          {/* 4. SECCIÓN: ANÁLISIS INTELIGENTE Y RECOMENDACIONES */}
          {results.smart_analysis && (
            <div className={`rounded-2xl border p-5 shadow-xl transition-all ${
              results.smart_analysis.health_color === 'red'
                ? 'bg-red-950/30 border-red-500/50'
                : results.smart_analysis.health_color === 'amber'
                ? 'bg-amber-950/30 border-amber-500/50'
                : 'bg-emerald-950/30 border-emerald-500/50'
            }`}>
              <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 mb-4">
                <div className="flex items-center gap-2.5">
                  <span className="text-2xl">🧠</span>
                  <div>
                    <div className="flex items-center gap-2">
                      <h3 className="font-medium text-white text-base">
                        Diagnóstico Inteligente
                      </h3>
                      <span className={`px-2.5 py-0.5 rounded-full text-xs font-medium border ${
                        results.smart_analysis.health_color === 'red'
                          ? 'bg-red-950 text-red-200 border-red-500/60'
                          : results.smart_analysis.health_color === 'amber'
                          ? 'bg-amber-950 text-amber-200 border-amber-500/60'
                          : 'bg-emerald-950 text-emerald-200 border-emerald-500/60'
                      }`}>
                        {results.smart_analysis.health_badge}
                      </span>
                    </div>
                    <p className="text-xs text-slate-200 mt-0.5 font-light">
                      {results.smart_analysis.health_title}
                    </p>
                  </div>
                </div>
              </div>

              {/* Hallazgos Clave */}
              {results.smart_analysis.findings?.length > 0 && (
                <div className="space-y-2 mb-4">
                  <span className="text-xs font-medium text-slate-300 uppercase tracking-wider block">
                    Hallazgos Clave:
                  </span>
                  <div className="grid grid-cols-1 md:grid-cols-2 gap-2.5">
                    {results.smart_analysis.findings.map((f, i) => (
                      <div
                        key={i}
                        className="bg-slate-950/90 border border-slate-800 rounded-xl p-3.5 flex flex-col justify-between shadow-sm"
                      >
                        <div>
                          <div className="flex items-center justify-between gap-2 mb-1.5">
                            <span className="font-medium text-white text-xs flex items-center gap-1.5">
                              <span>{f.type === 'danger' ? '🚨' : f.type === 'warning' ? '⚡' : f.type === 'success' ? '✅' : 'ℹ️'}</span>
                              <span>{cleanUserFacingText(f.title)}</span>
                            </span>
                            {f.metric && (
                              <span className="text-[11px] font-mono font-normal px-2 py-0.5 bg-slate-800 border border-slate-700 rounded-md text-slate-200">
                                {f.metric}
                              </span>
                            )}
                          </div>
                          <p className="text-xs text-slate-300 leading-relaxed font-light">
                            {cleanUserFacingText(f.description)}
                          </p>
                        </div>
                      </div>
                    ))}
                  </div>
                </div>
              )}

              {/* Recomendaciones Accionables */}
              {results.smart_analysis.recommendations?.length > 0 && (
                <div className="space-y-2">
                  <span className="text-xs font-medium text-slate-300 uppercase tracking-wider block">
                    Recomendaciones Prácticas:
                  </span>
                  <div className="grid grid-cols-1 md:grid-cols-2 gap-2.5">
                    {results.smart_analysis.recommendations.map((r, i) => (
                      <div
                        key={i}
                        className="bg-slate-950/95 border border-indigo-900/60 rounded-xl p-3.5 flex flex-col justify-between relative overflow-hidden shadow-sm"
                      >
                        <div>
                          <div className="flex items-center justify-between gap-2 mb-1.5">
                            <span className="text-[10px] font-medium uppercase tracking-wider px-2 py-0.5 rounded-full bg-indigo-950 text-indigo-200 border border-indigo-500/50">
                              {cleanUserFacingText(r.category)}
                            </span>
                            <span className={`text-[10px] font-bold px-2 py-0.5 rounded-full ${
                              r.priority.includes('ALTA')
                                ? 'bg-red-950 text-red-200 border border-red-500/50'
                                : 'bg-blue-950 text-blue-200 border border-blue-500/50'
                            }`}>
                              Prioridad: {r.priority}
                            </span>
                          </div>
                          <h4 className="text-xs font-bold text-white mb-1">
                            {cleanUserFacingText(r.title)}
                          </h4>
                          <p className="text-xs text-slate-200 leading-relaxed font-normal">
                            {cleanUserFacingText(r.text)}
                          </p>
                        </div>
                      </div>
                    ))}
                  </div>
                </div>
              )}
            </div>
          )}

          {/* 5. SECCIÓN: MONEDAS CON POSICIÓN ABIERTA / EN ROJO AL CIERRE (PUNTO 3) */}
          {((results.open_positions && results.open_positions.length > 0) || results.open_position) && (
            <div className="bg-slate-900 border border-rose-500/50 rounded-2xl p-6 shadow-xl space-y-4">
              <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
                <div className="flex items-center gap-2.5">
                  <span className="text-2xl">🔴</span>
                  <div>
                    <h3 className="font-medium text-white text-base flex items-center gap-2">
                      <span>Posiciones Abiertas</span>
                      <span className="px-2 py-0.5 rounded-full text-xs font-medium bg-rose-950 text-rose-200 border border-rose-500/50">
                        {results.open_positions ? results.open_positions.length : 1} moneda(s)
                      </span>
                    </h3>
                    <p className="text-xs text-slate-300 mt-0.5 font-light">
                      Monedas que mantenían una posición activa cuando finalizó la simulación ({results.end_date || results.period_label}).
                    </p>
                  </div>
                </div>
              </div>

              <div className="p-3.5 bg-rose-950/40 border border-rose-500/40 rounded-xl text-xs text-rose-200 leading-relaxed font-normal">
                ⚠️ <b>Aviso de Bloqueo por Falta de Stop Loss:</b> Estas órdenes abrieron durante la simulación y no lograron alcanzar su objetivo. Al tener desactivada la casilla de <b>"Stop Loss Fijo (USDT)"</b> en los parámetros de Salida del panel, quedaron congeladas acumulando pérdidas flotantes e impidiendo que el bot abriera nuevas operaciones en estas monedas durante semanas o meses.
              </div>

              <div className="overflow-x-auto">
                <table className="min-w-full divide-y divide-slate-700 text-left">
                  <thead className="bg-slate-950 text-slate-100 font-medium text-[11px] uppercase tracking-wider border-b-2 border-slate-700">
                    <tr>
                      <BinanceSortHeader label="Moneda Par" sortKey="symbol" currentSort={openPositionsSort} onSort={handleOpenPositionsSort} tooltipInfo={{ title: "Par de la Posición", desc: "Símbolo de la criptomoneda que quedó abierta." }} />
                      <BinanceSortHeader label="Apertura Duración" sortKey="duration_days" currentSort={openPositionsSort} onSort={handleOpenPositionsSort} tooltipInfo={{ title: "Duración de Posición", desc: "Fecha de entrada y días transcurridos con la orden abierta sin cerrar." }} />
                      <BinanceSortHeader label="Precio Entrada" sortKey="entry_price" currentSort={openPositionsSort} onSort={handleOpenPositionsSort} tooltipInfo={{ title: "Precio de Entrada", desc: "Precio promedio de compra ponderado tras aplicar órdenes DCA." }} />
                      <BinanceSortHeader label="Precio Mercado" sortKey="current_price" currentSort={openPositionsSort} onSort={handleOpenPositionsSort} tooltipInfo={{ title: "Precio de Mercado", desc: "Último precio de la vela de cierre en Binance al culminar el test." }} />
                      <BinanceSortHeader label="Recompras DCA" sortKey="dca_reentries" currentSort={openPositionsSort} onSort={handleOpenPositionsSort} align="center" tooltipInfo={{ title: "Recompras Ejecutadas", desc: "Cantidad de órdenes DCA que llegaron a llenarse comparado con el límite permitido." }} />
                      <BinanceSortHeader label="Margen Asignado" sortKey="margin_usdt" currentSort={openPositionsSort} onSort={handleOpenPositionsSort} tooltipInfo={{ title: "Margen Comprometido", desc: "Garantía real en USDT retenida por la posición y su valor nocional total." }} />
                      <BinanceSortHeader label="PnL Flotante" sortKey="unrealized_pnl" currentSort={openPositionsSort} onSort={handleOpenPositionsSort} align="right" tooltipInfo={{ title: "PnL Flotante (Latente)", desc: "Ganancia o pérdida no realizada acumulada al término de la simulación." }} />
                      <BinanceSortHeader label="Estado Orden" sortKey="status" currentSort={openPositionsSort} onSort={handleOpenPositionsSort} align="right" tooltipInfo={{ title: "Estado de la Posición", desc: "Indica si la posición está activa o atrapada en drawdown sin Stop Loss." }} />
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-800 font-mono text-xs">
                    {sortedOpenPositions.map((pos, idx) => {
                      if (!pos) return null;
                      const isNeg = pos.unrealized_pnl < 0;
                      return (
                        <tr key={pos.symbol || idx} className="hover:bg-slate-800/60 transition-colors">
                          <td className="px-3 py-2.5 font-medium font-sans text-white">
                            <span className="px-2 py-0.5 rounded bg-slate-800 text-white border border-slate-700 text-xs font-normal">
                              {pos.symbol}
                            </span>
                          </td>
                          <td className="px-3 py-2.5 text-slate-300 whitespace-nowrap font-light">
                            <div>{pos.entry_time?.substring(0, 16)}</div>
                            <div className="text-[10px] text-amber-300 font-normal">
                              ⏳ Congelada {pos.duration_days} días
                            </div>
                          </td>
                          <td className="px-3 py-2.5 text-white font-medium">
                            ${pos.entry_price}
                          </td>
                          <td className="px-3 py-2.5 text-white font-medium">
                            ${pos.current_price}
                          </td>
                          <td className="px-3 py-2.5 text-center">
                            <span className={`px-2 py-0.5 rounded-full text-[10px] font-medium ${
                              pos.dca_reentries >= pos.max_dca
                                ? 'bg-red-950 text-red-200 border border-red-500/50'
                                : 'bg-indigo-950 text-indigo-200 border border-indigo-500/50'
                            }`}>
                              {pos.dca_reentries} / {pos.max_dca} {pos.dca_reentries >= pos.max_dca ? '(Agotado ⚠️)' : ''}
                            </span>
                          </td>
                          <td className="px-3 py-2.5 text-slate-200 font-normal">
                            ${pos.margin_usdt} <span className="text-[10px] text-slate-400">(${pos.position_size_usdt} USDT)</span>
                          </td>
                          <td className={`px-3 py-2.5 text-right font-medium whitespace-nowrap ${isNeg ? 'text-rose-400' : 'text-emerald-400'}`}>
                            {isNeg ? '' : '+'}{pos.unrealized_pnl} USDT
                            <span className="text-[10px] block opacity-80 font-light">
                              ({isNeg ? '' : '+'}{pos.unrealized_pnl_pct}%)
                            </span>
                          </td>
                          <td className="px-3 py-2.5 text-right whitespace-nowrap">
                            <span className={`px-2 py-0.5 rounded-full text-[10px] font-medium ${
                              pos.is_trapped
                                ? 'bg-red-950 text-red-200 border border-red-500/50'
                                : 'bg-amber-950 text-amber-200 border border-amber-500/50'
                            }`}>
                              {pos.status || 'Abierta'}
                            </span>
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            </div>
          )}

          {/* 6. TABLA RANKING POR MONEDA (Solo en Modo Portafolio Multimoneda) */}
          {results.is_portfolio && results.symbols_ranking?.length > 0 && (
            <div className="bg-slate-900 border border-slate-700/80 rounded-2xl p-6 shadow-xl">
              <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 mb-4">
                <div className="flex items-center gap-2">
                  <span className="text-lg">🏆</span>
                  <h3 className="font-medium text-white text-base">
                    Ranking Monedas
                  </h3>
                  <span className="text-xs text-slate-300 font-light">
                    ({results.symbols_ranking.length} pares evaluados)
                  </span>
                </div>
                {symbolFilter !== 'all' && (
                  <button
                    type="button"
                    onClick={() => setSymbolFilter('all')}
                    className="text-xs px-2.5 py-1 bg-indigo-950 text-indigo-200 border border-indigo-500/50 rounded-lg hover:bg-indigo-900 transition font-normal"
                  >
                    ✕ Quitar filtro ({symbolFilter})
                  </button>
                )}
              </div>

              <div className="overflow-x-auto">
                <table className="min-w-full divide-y divide-slate-700 text-left">
                  <thead className="bg-slate-950 text-slate-100 font-medium text-[11px] uppercase tracking-wider border-b-2 border-slate-700">
                    <tr>
                      <BinanceSortHeader label="Puesto Ranking" sortKey="rank" currentSort={rankingSort} onSort={handleRankingSort} tooltipInfo={{ title: "Puesto Ranking", desc: "Posición de la moneda ordenada según su rendimiento financiero global." }} />
                      <BinanceSortHeader label="Moneda Par" sortKey="symbol" currentSort={rankingSort} onSort={handleRankingSort} tooltipInfo={{ title: "Par Cripto", desc: "Par de futuros perpetuos en Binance evaluado en esta prueba." }} />
                      <BinanceSortHeader label="PnL Cerrado" sortKey="net_pnl" currentSort={rankingSort} onSort={handleRankingSort} tooltipInfo={{ title: "PnL Cerrado", desc: "Ganancia o pérdida neta acumulada de operaciones cerradas en esta moneda." }} />
                      <BinanceSortHeader label="PnL Flotante" sortKey="unrealized_pnl" currentSort={rankingSort} onSort={handleRankingSort} tooltipInfo={{ title: "PnL Flotante", desc: "Beneficio o pérdida de posiciones que quedaron abiertas al finalizar el test." }} />
                      <BinanceSortHeader label="Patrimonio Neto" sortKey="net_equity_pnl" currentSort={rankingSort} onSort={handleRankingSort} tooltipInfo={{ title: "Patrimonio Neto", desc: "Suma del PnL cerrado más el PnL flotante para esta moneda." }} />
                      <BinanceSortHeader label="Volumen Total" sortKey="total_volume_traded_usdt" currentSort={rankingSort} onSort={handleRankingSort} tooltipInfo={{ title: "Volumen Comercializado", desc: "Volumen total en USDT transaccionado en esta criptomoneda." }} />
                      <BinanceSortHeader label="Tasa Acierto" sortKey="win_rate_pct" currentSort={rankingSort} onSort={handleRankingSort} tooltipInfo={{ title: "Tasa de Acierto", desc: "Porcentaje de trades ganadores en este par específico." }} />
                      <BinanceSortHeader label="Trades Total" sortKey="total_trades" currentSort={rankingSort} onSort={handleRankingSort} align="center" tooltipInfo={{ title: "Total de Operaciones", desc: "Número de trades completados (ganados y perdidos) en esta moneda." }} />
                      <BinanceSortHeader label="Estado Final" sortKey="status" currentSort={rankingSort} onSort={handleRankingSort} tooltipInfo={{ title: "Estado al Cierre", desc: "Indica si la moneda quedó libre, con posición abierta o atrapada sin Stop Loss." }} />
                      <th className="px-3 py-2.5 text-right font-medium text-[11px] uppercase tracking-wider text-slate-400">
                        <div className="inline-flex items-center justify-end gap-1 w-full">
                          <span>Acción Ver</span>
                          <Tooltip title="Filtrar por Moneda" text="Permite aislar y ver las operaciones y métricas exclusivas de este par." align="right" />
                        </div>
                      </th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-800 font-mono text-xs">
                    {sortedRanking.map((row, idx) => {
                      const origRank = row._originalIndex || (idx + 1);
                      const medal = origRank === 1 ? '🥇' : origRank === 2 ? '🥈' : origRank === 3 ? '🥉' : `${origRank}º`;
                      const isSelected = symbolFilter === row.symbol;
                      const hasOpen = row.has_open_position;
                      const isTrapped = row.is_trapped;
                      const netEquity = row.net_equity_pnl !== undefined ? row.net_equity_pnl : row.net_pnl;
                      return (
                        <tr 
                          key={row.symbol} 
                          className={`transition-colors ${
                            isSelected 
                              ? 'bg-indigo-950/50 border-l-4 border-l-indigo-400' 
                              : 'hover:bg-slate-800/60'
                          }`}
                        >
                          <td className="px-3 py-2.5 text-sm">{medal}</td>
                          <td className="px-3 py-2.5 font-bold text-white font-sans">
                            {row.symbol}
                          </td>
                          <td className={`px-3 py-2.5 font-bold ${row.net_pnl >= 0 ? 'text-emerald-400' : 'text-rose-400'}`}>
                            {row.net_pnl >= 0 ? '+' : ''}{row.net_pnl} USDT
                          </td>
                          <td className={`px-3 py-2.5 font-bold ${(row.unrealized_pnl || 0) >= 0 ? 'text-emerald-400' : 'text-rose-400'}`}>
                            {(row.unrealized_pnl || 0) >= 0 ? '+' : ''}{row.unrealized_pnl || 0} USDT
                          </td>
                          <td className={`px-3 py-2.5 font-bold ${netEquity >= 0 ? 'text-emerald-400' : 'text-rose-400'}`}>
                            {netEquity >= 0 ? '+' : ''}{netEquity} USDT
                          </td>
                          <td className="px-3 py-2.5 text-cyan-300 font-mono font-bold whitespace-nowrap">
                            ${(row.total_volume_traded_usdt || 0).toLocaleString(undefined, {minimumFractionDigits: 1, maximumFractionDigits: 1})} USDT
                            {row.total_fees_usdt !== undefined && (
                              <span className="text-[10px] text-amber-300 block font-light font-mono">
                                Fee: -${Number(row.total_fees_usdt || 0).toFixed(2)} USDT
                              </span>
                            )}
                          </td>
                          <td className="px-3 py-2.5">
                            <span className="font-bold text-white">{row.win_rate_pct}%</span>
                          </td>
                          <td className="px-3 py-2.5 text-center text-slate-300">
                            {row.total_trades} ({row.winning_trades}G / {row.losing_trades}P)
                          </td>
                          <td className="px-3 py-2.5">
                            {isTrapped ? (
                              <span className="px-2 py-0.5 rounded-full text-[10px] font-bold bg-red-950 text-red-200 border border-red-500/50 whitespace-nowrap">
                                🚨 Congelada
                              </span>
                            ) : hasOpen ? (
                              <span className="px-2 py-0.5 rounded-full text-[10px] font-bold bg-amber-950 text-amber-200 border border-amber-500/50 whitespace-nowrap">
                                ⏳ Abierta
                              </span>
                            ) : (
                              <span className="px-2 py-0.5 rounded-full text-[10px] font-bold bg-emerald-950 text-emerald-200 border border-emerald-500/50 whitespace-nowrap">
                                ✓ Líquido
                              </span>
                            )}
                          </td>
                          <td className="px-3 py-2.5 text-right">
                            <button
                              type="button"
                              onClick={() => setSymbolFilter(isSelected ? 'all' : row.symbol)}
                              className={`px-2.5 py-1 rounded-lg text-xs font-sans font-bold transition ${
                                isSelected
                                  ? 'bg-indigo-600 text-white shadow-sm ring-1 ring-indigo-400'
                                  : 'bg-slate-800 hover:bg-slate-750 text-slate-200 border border-slate-700'
                              }`}
                            >
                              {isSelected ? '✓ Viendo Trades' : 'Ver Trades'}
                            </button>
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            </div>
          )}

          {/* 5. Gráfico de Curva de Capital */}
          <div className="bg-slate-900 border border-slate-700/80 rounded-2xl p-6 shadow-xl">
            <div className="flex items-center justify-between mb-4">
              <div className="flex items-center gap-2">
                <span className="text-lg">📈</span>
                <h3 className="font-medium text-white text-base">
                  Curva Capital
                </h3>
                <span className="text-xs text-slate-300 font-light">
                  ({results.is_portfolio ? 'Portafolio Consolidado' : results.symbol} • {results.days_tested} días)
                </span>
              </div>
              <div className="text-xs font-mono text-slate-300 font-light">
                Saldo Final: <b className="text-white font-medium">${results.final_balance} USDT</b>
              </div>
            </div>

            {renderEquitySvg()}
          </div>

          {/* 6. Tabla de Operaciones Simuladas */}
          <div className="bg-slate-900 border border-slate-700/80 rounded-2xl p-6 shadow-xl">
            <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 mb-4">
              <div className="flex items-center gap-2">
                <span className="text-lg">📋</span>
                <h3 className="font-medium text-white text-base">
                  Historial Operaciones
                </h3>
                <span className="text-xs text-slate-300 font-light">
                  ({filteredTrades.length} registros {symbolFilter !== 'all' ? `• ${symbolFilter}` : ''})
                </span>
              </div>

              {/* Filtros Ganadas / Perdidas */}
              <div className="flex items-center gap-1 bg-slate-950 p-1 rounded-xl border border-slate-800">
                <button
                  type="button"
                  onClick={() => setTradeFilter('all')}
                  className={`px-3 py-1 text-xs font-medium rounded-lg transition ${
                    tradeFilter === 'all'
                      ? 'bg-slate-800 text-white shadow-sm border border-slate-700'
                      : 'text-slate-300 hover:text-white'
                  }`}
                >
                  Todas Operaciones ({results.total_trades})
                </button>
                <button
                  type="button"
                  onClick={() => setTradeFilter('wins')}
                  className={`px-3 py-1 text-xs font-medium rounded-lg transition ${
                    tradeFilter === 'wins'
                      ? 'bg-emerald-950 text-emerald-200 border border-emerald-500/50 shadow-sm'
                      : 'text-slate-300 hover:text-emerald-400'
                  }`}
                >
                  Operaciones Ganadas ({results.winning_trades})
                </button>
                <button
                  type="button"
                  onClick={() => setTradeFilter('losses')}
                  className={`px-3 py-1 text-xs font-medium rounded-lg transition ${
                    tradeFilter === 'losses'
                      ? 'bg-red-950 text-red-200 border border-red-500/50 shadow-sm'
                      : 'text-slate-300 hover:text-red-400'
                  }`}
                >
                  Operaciones Perdidas ({results.losing_trades})
                </button>
              </div>
            </div>

            {filteredTrades.length === 0 ? (
              <div className="text-center py-8 text-slate-400 text-sm font-light">
                No hay operaciones para los filtros seleccionados o la estrategia no encontró entradas en este periodo.
              </div>
            ) : (
              <div className="overflow-x-auto max-h-96 overflow-y-auto">
                <table className="min-w-full divide-y divide-slate-700 text-left">
                  <thead className="bg-slate-950 text-slate-100 font-medium text-[11px] uppercase tracking-wider sticky top-0 border-b-2 border-slate-700">
                    <tr>
                      <BinanceSortHeader label="ID Orden" sortKey="id" currentSort={tradesSort} onSort={handleTradesSort} tooltipInfo={{ title: "ID Operación", desc: "Número correlativo de la operación registrada en la simulación." }} />
                      {results.is_portfolio && (
                        <BinanceSortHeader label="Moneda Par" sortKey="symbol" currentSort={tradesSort} onSort={handleTradesSort} tooltipInfo={{ title: "Par Cripto", desc: "Par de Binance en el cual se ejecutó la operación." }} />
                      )}
                      <BinanceSortHeader label="Fecha Apertura" sortKey="open_time" currentSort={tradesSort} onSort={handleTradesSort} tooltipInfo={{ title: "Fecha Apertura", desc: "Momento exacto en que se cumplió la señal técnica y se abrió la posición." }} />
                      <BinanceSortHeader label="Fecha Cierre" sortKey="close_time" currentSort={tradesSort} onSort={handleTradesSort} tooltipInfo={{ title: "Fecha Cierre", desc: "Momento en que se ejecutó la orden de salida (Take Profit, Stop Loss o Trailing)." }} />
                      <BinanceSortHeader label="Precio Entrada" sortKey="entry_price" currentSort={tradesSort} onSort={handleTradesSort} tooltipInfo={{ title: "Precio de Entrada", desc: "Precio promedio de entrada obtenido en la posición." }} />
                      <BinanceSortHeader label="Precio Salida" sortKey="exit_price" currentSort={tradesSort} onSort={handleTradesSort} tooltipInfo={{ title: "Precio de Salida", desc: "Precio al cual se liquidó y cerró la orden." }} />
                      <BinanceSortHeader label="Margen Total" sortKey="margin_usdt" currentSort={tradesSort} onSort={handleTradesSort} tooltipInfo={{ title: "Margen Comprometido", desc: "Monto total de USDT de garantía utilizados en este trade (incluyendo recompras)." }} />
                      <BinanceSortHeader label="Recompras DCA" sortKey="dca_reentries" currentSort={tradesSort} onSort={handleTradesSort} align="center" tooltipInfo={{ title: "Recompras DCA", desc: "Número de recompras adicionales ejecutadas a la baja antes de cerrar." }} />
                      <BinanceSortHeader label="Comisión Fee" sortKey="fees" currentSort={tradesSort} onSort={handleTradesSort} tooltipInfo={{ title: "Comisión Fee", desc: "Total de comisiones oficiales de Binance descontadas en este trade (Maker 0.02% y Taker 0.04%)." }} />
                      <BinanceSortHeader label="Motivo Salida" sortKey="exit_reason" currentSort={tradesSort} onSort={handleTradesSort} tooltipInfo={{ title: "Motivo de Cierre", desc: "Razón por la cual se cerró la posición: Take Profit, Stop Loss o Trailing Stop." }} />
                      <BinanceSortHeader label="PnL Neto" sortKey="net_pnl" currentSort={tradesSort} onSort={handleTradesSort} align="right" tooltipInfo={{ title: "PnL Neto", desc: "Ganancia o pérdida neta definitiva en USDT obtenida en la operación." }} />
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-800 font-mono text-xs">
                    {filteredAndSortedTrades.map((t) => (
                      <tr key={`${t.symbol}_${t.id}`} className="hover:bg-slate-800/60 transition-colors">
                        <td className="px-3 py-2 text-slate-300">{t.id}</td>
                        {results.is_portfolio && (
                          <td className="px-3 py-2">
                            <span className="px-2 py-0.5 bg-slate-800 rounded font-bold text-[10px] text-white border border-slate-700">
                              {t.symbol?.replace('USDT', '')}
                            </span>
                          </td>
                        )}
                        <td className="px-3 py-2 text-slate-300 whitespace-nowrap">{t.open_time?.substring(5, 16)}</td>
                        <td className="px-3 py-2 text-slate-300 whitespace-nowrap">{t.close_time?.substring(5, 16)}</td>
                        <td className="px-3 py-2 text-white font-bold">${t.entry_price}</td>
                        <td className="px-3 py-2 text-white font-bold">${t.exit_price}</td>
                        <td className="px-3 py-2 text-slate-300">${t.margin_usdt}</td>
                        <td className="px-3 py-2 text-center">
                          {t.dca_reentries > 0 ? (
                            <span className="px-1.5 py-0.5 bg-indigo-950 text-indigo-200 border border-indigo-500/40 rounded font-bold text-[10px]">
                              {t.dca_reentries} DCA
                            </span>
                          ) : '-'}
                        </td>
                        <td className="px-3 py-2 text-amber-300 font-mono font-light whitespace-nowrap">
                          -${Number(t.fees || 0).toFixed(4)} USDT
                        </td>
                        <td className="px-3 py-2 whitespace-nowrap">
                          <span className={`px-2 py-0.5 rounded-full text-[10px] font-normal ${
                            t.net_pnl > 0
                              ? 'bg-emerald-950 text-emerald-200 border border-emerald-500/40'
                              : 'bg-red-950 text-red-200 border border-red-500/40'
                          }`}>
                            {t.exit_reason}
                          </span>
                        </td>
                        <td className="px-3 py-2 text-right font-medium whitespace-nowrap">
                          <span className={t.net_pnl >= 0 ? 'text-emerald-400' : 'text-rose-400'}>
                            {t.net_pnl >= 0 ? '+' : ''}{t.net_pnl} USDT
                          </span>
                          <span className="text-[10px] text-slate-300 block font-light">
                            ({t.return_pct >= 0 ? '+' : ''}{t.return_pct}%)
                          </span>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </div>
        </div>
      )}
        </>
      )}

      {/* MODAL DE DEPURACIÓN DE ESTRATEGIAS (CONSERVAR TOP N) */}
      {isPruneModalOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-950/80 backdrop-blur-sm overflow-y-auto">
          <div className="bg-slate-900 border border-slate-700/80 rounded-2xl max-w-3xl w-full p-6 shadow-2xl space-y-5 my-8">
            
            {/* Cabecera del Modal */}
            <div className="flex items-center justify-between pb-3 border-b border-slate-700/80">
              <div className="flex items-center gap-2.5">
                <span className="text-2xl">🏆</span>
                <div>
                  <h3 className="text-base font-medium text-white">
                    Depurar Estrategias
                  </h3>
                  <p className="text-xs text-slate-300 font-light">
                    Filtra automáticamente las estrategias con mejor desempeño histórico y elimina las menos eficientes.
                  </p>
                </div>
              </div>
              <button
                type="button"
                onClick={() => setIsPruneModalOpen(false)}
                className="text-slate-400 hover:text-white p-1 rounded-lg hover:bg-slate-800 transition text-lg"
              >
                ✕
              </button>
            </div>

            {/* Parámetros de Control */}
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4 bg-slate-950/60 p-4 rounded-xl border border-slate-800">
              {/* Cantidad a conservar */}
              <div>
                <label className="block text-xs font-medium text-slate-200 mb-1">
                  Cantidad Conservar:
                </label>
                <div className="flex items-center gap-2">
                  <input
                    type="number"
                    min="1"
                    max={pruneRankings.length || 29}
                    value={pruneKeepCount}
                    onChange={(e) => setPruneKeepCount(Math.max(1, parseInt(e.target.value) || 1))}
                    className="w-24 px-3 py-1.5 bg-slate-900 border border-slate-600 rounded-xl text-sm font-medium text-amber-400 focus:ring-1 focus:ring-amber-400 outline-none"
                  />
                  {/* Pills de acceso rápido */}
                  <div className="flex items-center gap-1">
                    {[5, 8, 10, 15].map(cnt => (
                      <button
                        key={cnt}
                        type="button"
                        onClick={() => setPruneKeepCount(cnt)}
                        className={`px-2 py-1 text-xs font-medium rounded-lg transition ${
                          pruneKeepCount === cnt
                            ? 'bg-amber-400 text-slate-950 font-semibold'
                            : 'bg-slate-800 text-slate-300 hover:text-white'
                        }`}
                      >
                        Top {cnt}
                      </button>
                    ))}
                  </div>
                </div>
              </div>

              {/* Métrica de clasificación */}
              <div>
                <label className="block text-xs font-medium text-slate-200 mb-1">
                  Criterio Clasificación:
                </label>
                <div className="inline-flex rounded-xl bg-slate-900 p-1 border border-slate-700 w-full">
                  <button
                    type="button"
                    onClick={() => handlePruneMetricChange('net_equity_pnl')}
                    className={`flex-1 py-1 px-2 text-xs font-medium rounded-lg transition text-center ${
                      pruneMetric === 'net_equity_pnl'
                        ? 'bg-indigo-600 text-white shadow font-normal'
                        : 'text-slate-300 hover:text-white'
                    }`}
                  >
                    Patrimonio Neto
                  </button>
                  <button
                    type="button"
                    onClick={() => handlePruneMetricChange('net_pnl')}
                    className={`flex-1 py-1 px-2 text-xs font-medium rounded-lg transition text-center ${
                      pruneMetric === 'net_pnl'
                        ? 'bg-indigo-600 text-white shadow font-normal'
                        : 'text-slate-300 hover:text-white'
                    }`}
                  >
                    PnL Cerrado
                  </button>
                </div>
              </div>
            </div>

            {/* Vista Previa de la Depuración (División en dos columnas) */}
            {isLoadingRankings ? (
              <div className="py-12 text-center text-slate-400 text-sm font-mono font-light">
                <span className="animate-spin inline-block mr-2">⏳</span>
                Calculando ranking de rendimiento de estrategias...
              </div>
            ) : (
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                {/* 1. SE CONSERVARÁN */}
                <div className="bg-slate-950/80 border border-emerald-500/40 rounded-xl p-3.5 space-y-2">
                  <div className="flex items-center justify-between pb-2 border-b border-slate-800">
                    <span className="text-xs font-medium text-emerald-400 flex items-center gap-1.5">
                      <span>🟢</span>
                      <span>Estrategias Conservadas ({Math.min(pruneKeepCount, pruneRankings.length)})</span>
                    </span>
                    <span className="text-[10px] text-slate-400 font-mono font-light">Top {pruneKeepCount} más rentables</span>
                  </div>
                  <div className="max-h-60 overflow-y-auto space-y-1.5 pr-1 font-mono text-xs">
                    {pruneRankings.slice(0, pruneKeepCount).map((s, idx) => (
                      <div
                        key={s.name}
                        className="flex items-center justify-between p-2 rounded-lg bg-emerald-950/20 border border-emerald-500/30 hover:bg-emerald-950/40 transition"
                      >
                        <div className="flex items-center gap-2">
                          <span className="font-medium text-amber-400 text-[11px] w-5">#{idx + 1}</span>
                          <span className="font-normal font-sans text-white text-xs">{s.name}</span>
                        </div>
                        <div className="text-right">
                          <span className="font-medium text-emerald-400">
                            +${(s.net_equity_pnl || 0).toFixed(1)} USDT
                          </span>
                          <span className="text-[10px] text-slate-400 block font-sans font-light">
                            {s.win_rate_pct}% WR • {s.total_trades} trades
                          </span>
                        </div>
                      </div>
                    ))}
                  </div>
                </div>

                {/* 2. SE ELIMINARÁN */}
                <div className="bg-slate-950/80 border border-rose-500/40 rounded-xl p-3.5 space-y-2">
                  <div className="flex items-center justify-between pb-2 border-b border-slate-800">
                    <span className="text-xs font-medium text-rose-400 flex items-center gap-1.5">
                      <span>🔴</span>
                      <span>Estrategias Descartadas ({Math.max(0, pruneRankings.length - pruneKeepCount)})</span>
                    </span>
                    <span className="text-[10px] text-slate-400 font-mono font-light">Menor rendimiento</span>
                  </div>
                  <div className="max-h-60 overflow-y-auto space-y-1.5 pr-1 font-mono text-xs">
                    {pruneRankings.length <= pruneKeepCount ? (
                      <div className="text-center py-8 text-slate-500 text-xs italic">
                        No hay estrategias para eliminar con este corte.
                      </div>
                    ) : (
                      pruneRankings.slice(pruneKeepCount).map((s, idx) => (
                        <div
                          key={s.name}
                          className="flex items-center justify-between p-2 rounded-lg bg-rose-950/20 border border-rose-500/30 hover:bg-rose-950/40 transition opacity-80"
                        >
                          <div className="flex items-center gap-2">
                            <span className="text-slate-500 text-[11px] w-5">#{pruneKeepCount + idx + 1}</span>
                            <span className="font-sans font-medium text-slate-300 text-xs line-through">{s.name}</span>
                          </div>
                          <div className="text-right">
                            <span className={(s.net_equity_pnl || 0) >= 0 ? 'text-slate-300' : 'text-rose-400 font-bold'}>
                              {(s.net_equity_pnl || 0) >= 0 ? '+' : ''}${(s.net_equity_pnl || 0).toFixed(1)} USDT
                            </span>
                            <span className="text-[10px] text-slate-500 block font-sans">
                              {s.has_backtest ? `${s.win_rate_pct}% WR • ${s.trapped_coins_count} atrapadas` : 'Sin pruebas'}
                            </span>
                          </div>
                        </div>
                      ))
                    )}
                  </div>
                </div>
              </div>
            )}

            {/* Checkbox Opcional de Historial */}
            <div className="flex items-center gap-2.5 p-3 rounded-xl bg-slate-950 border border-slate-800">
              <input
                type="checkbox"
                id="pruneHistoryCheck"
                checked={pruneHistory}
                onChange={(e) => setPruneHistory(e.target.checked)}
                className="w-4 h-4 rounded text-indigo-600 focus:ring-indigo-500 bg-slate-900 border-slate-700 cursor-pointer"
              />
              <label htmlFor="pruneHistoryCheck" className="text-xs text-slate-200 cursor-pointer font-medium select-none">
                Limpiar también del Historial de Backtests los registros de las estrategias eliminadas (mantiene el historial sincronizado).
              </label>
            </div>

            {/* Acciones del Modal */}
            <div className="flex items-center justify-between pt-2 border-t border-slate-800">
              <button
                type="button"
                onClick={() => setIsPruneModalOpen(false)}
                className="px-4 py-2 bg-slate-800 hover:bg-slate-700 text-slate-300 font-bold rounded-xl text-xs transition"
              >
                Cancelar
              </button>
              <button
                type="button"
                onClick={handleExecutePrune}
                disabled={isPruning || pruneRankings.length <= pruneKeepCount}
                className={`px-5 py-2 rounded-xl text-xs font-bold text-white transition-all flex items-center gap-2 shadow-lg ${
                  pruneRankings.length <= pruneKeepCount
                    ? 'bg-slate-800 opacity-50 cursor-not-allowed text-slate-500'
                    : isPruning
                      ? 'bg-red-800 opacity-70 cursor-wait'
                      : 'bg-red-600 hover:bg-red-500 shadow-red-900/40 active:scale-95'
                }`}
              >
                {isPruning ? (
                  <>
                    <span className="animate-spin text-sm">⏳</span>
                    <span>Depurando Estrategias...</span>
                  </>
                ) : (
                  <>
                    <span>🗑️</span>
                    <span>Confirmar y Borrar {Math.max(0, pruneRankings.length - pruneKeepCount)} Estrategias</span>
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
