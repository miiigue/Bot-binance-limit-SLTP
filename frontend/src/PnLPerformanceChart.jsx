import React, { useEffect, useState, useMemo } from 'react';
import Tooltip from './Tooltip';
import BinanceSortHeader, { sortTableData } from './BinanceSortHeader';

import { formatShortDate } from './dateUtils';

// Helper robusto para parsear fechas de diversas fuentes y formatos (ISO, timestamp numérico, SQLite)
const parseDate = (val) => {
  if (!val) return null;
  if (val instanceof Date) return isNaN(val.getTime()) ? null : val;
  if (typeof val === 'number') {
    const d = new Date(val);
    return isNaN(d.getTime()) ? null : d;
  }
  const s = String(val).trim();
  if (!s) return null;
  if (/^\d{10,13}$/.test(s)) {
    const d = new Date(Number(s.length === 10 ? s + '000' : s));
    if (!isNaN(d.getTime())) return d;
  }
  const iso = s.includes('T') ? (s.endsWith('Z') || s.includes('+') ? s : s + 'Z') : s.replace(' ', 'T') + 'Z';
  let d = new Date(iso);
  if (!isNaN(d.getTime())) return d;
  d = new Date(s);
  return isNaN(d.getTime()) ? null : d;
};

// Formatea duración transcurrida legible (ej: 2d 5h 14m, 3h 22m, 45m 12s, 30s)
const formatDuration = (ms) => {
  if (!ms || ms < 0 || isNaN(ms)) return '0s';
  const totalSeconds = Math.floor(ms / 1000);
  const days = Math.floor(totalSeconds / 86400);
  const hours = Math.floor((totalSeconds % 86400) / 3600);
  const minutes = Math.floor((totalSeconds % 3600) / 60);
  const seconds = totalSeconds % 60;

  if (days > 0) return `${days}d ${hours}h ${minutes}m`;
  if (hours > 0) return `${hours}h ${minutes}m`;
  if (minutes > 0) return `${minutes}m ${seconds}s`;
  return `${seconds}s`;
};

// Formato de hora compacto para el eje X (ej: 14:32)
const formatTimeHHmm = (d) => {
  if (!d) return '--:--';
  return d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', hour12: false });
};

// Formato completo de fecha y hora para el inspector (ej: 26 sept 2026, 14:32:15)
const formatFullDateTime = (d) => {
  if (!d) return '---';
  return d.toLocaleString([], {
    day: '2-digit',
    month: 'short',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    hour12: false
  });
};

function PnLPerformanceChart({ symbolsList = [], readOnly = false }) {
  const [trades, setTrades] = useState([]);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState(null);
  const [filterSymbol, setFilterSymbol] = useState('ALL');
  const [filterStrategy, setFilterStrategy] = useState('ALL');
  const [backendSummary, setBackendSummary] = useState(null);
  const [accountStatus, setAccountStatus] = useState(null);

  // Estado del Monitor de Riesgo y Billetera Binance
  const [riskData, setRiskData] = useState(null);
  const [riskPercentageInput, setRiskPercentageInput] = useState('50');
  const [isSavingRisk, setIsSavingRisk] = useState(false);
  const [riskFeedback, setRiskFeedback] = useState(null);
  const [isCancellingOrders, setIsCancellingOrders] = useState(false);
  const [cancelOrdersFeedback, setCancelOrdersFeedback] = useState(null);

  // Ordenamiento para el Gráfico de Rendimiento por Moneda o Estrategia
  // 'PNL_DESC' (Mayor a menor), 'PNL_ASC' (Menor a mayor), 'WINRATE_DESC', 'TRADES_DESC', 'ALPHA'
  const [coinSortOrder, setCoinSortOrder] = useState('PNL_DESC');
  // Modo de vista del ranking: 'COINS' (por criptomoneda) o 'STRATEGIES' (torneo por estrategia)
  const [rankingViewMode, setRankingViewMode] = useState('COINS');
  // Estado para la inspección interactiva del trade seleccionado al pasar el cursor o tocar la barra
  const [activeTradeInspector, setActiveTradeInspector] = useState(null);
  // Estado para la inspección interactiva de los puntos en la curva de capital (Punto Cero y cierres)
  const [selectedEquityIndex, setSelectedEquityIndex] = useState(null);

  // Estado para la tabla de historial de trades cerrados en general
  const [showAllClosedTrades, setShowAllClosedTrades] = useState(true);
  const [globalTradeLimit, setGlobalTradeLimit] = useState(50);
  const [globalTradeSort, setGlobalTradeSort] = useState({ key: 'close_timestamp', direction: 'desc' });

  const handleGlobalSort = (key) => {
    setGlobalTradeSort(prev => {
      if (prev?.key === key) {
        return { key, direction: prev.direction === 'asc' ? 'desc' : 'asc' };
      }
      return { key, direction: 'desc' };
    });
  };

  // Cargar datos financieros y de billetera
  const fetchAllData = async () => {
    setIsLoading(true);
    setError(null);
    try {
      const [tradesResp, statusResp, riskResp] = await Promise.all([
        fetch('/api/all_trades?limit=2000'),
        fetch('/api/status'),
        fetch('/api/risk_config')
      ]);

      if (tradesResp.ok) {
        const data = await tradesResp.json();
        setTrades(Array.isArray(data.trades) ? data.trades : []);
        if (data.summary) {
          setBackendSummary(data.summary);
        }
      }

      if (statusResp.ok) {
        const statusData = await statusResp.json();
        setAccountStatus(statusData);
      }

      if (riskResp.ok) {
        const riskJson = await riskResp.json();
        setRiskData(riskJson);
        if (riskJson.risk_percentage_raw !== undefined) {
          setRiskPercentageInput(String(riskJson.risk_percentage_raw));
        } else if (riskJson.risk_percentage) {
          setRiskPercentageInput(riskJson.risk_percentage.replace('%', '').trim());
        }
      }
    } catch (err) {
      console.error('Error al cargar datos financieros:', err);
      setError(err.message);
    } finally {
      setIsLoading(false);
    }
  };

  useEffect(() => {
    fetchAllData();
    // Refresco periódico automático de trades, riesgo y saldo cada 5 segundos en vivo
    const intervalId = setInterval(() => {
      fetchAllData();
    }, 5000);

    return () => clearInterval(intervalId);
  }, []);

  // Guardar nuevo % máximo de riesgo
  const handleSaveRiskLimit = async (e) => {
    e?.preventDefault();
    const val = parseFloat(riskPercentageInput);
    if (isNaN(val) || val < 1 || val > 100) {
      setRiskFeedback({ type: 'error', msg: 'El porcentaje debe estar entre 1% y 100%.' });
      return;
    }

    setIsSavingRisk(true);
    setRiskFeedback(null);
    try {
      const resp = await fetch('/api/risk_config', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ risk_percentage: val })
      });

      if (resp.ok) {
        setRiskFeedback({ type: 'success', msg: `Límite actualizado al ${val}% con éxito.` });
        fetchAllData();
        setTimeout(() => setRiskFeedback(null), 4000);
      } else {
        const errJson = await resp.json();
        setRiskFeedback({ type: 'error', msg: errJson.error || 'Error al guardar.' });
      }
    } catch (err) {
      setRiskFeedback({ type: 'error', msg: err.message });
    } finally {
      setIsSavingRisk(false);
    }
  };

  // Cancelar órdenes límite huérfanas en Binance para liberar margen retenido
  const handleCancelStaleOrders = async () => {
    if (!window.confirm("¿Deseas cancelar todas las órdenes de entrada huérfanas en Binance?\\n\\nEsto liberará inmediatamente el margen en USDT retenido en órdenes pendientes sin tocar tus posiciones abiertas ni sus Stop Loss / Take Profit.")) {
      return;
    }
    setIsCancellingOrders(true);
    setCancelOrdersFeedback(null);
    try {
      const resp = await fetch('/api/wallet/cancel_stale_orders', { method: 'POST' });
      const data = await resp.json();
      if (resp.ok) {
        setCancelOrdersFeedback({ 
          type: 'success', 
          msg: data.message || `Órdenes huérfanas canceladas. Margen libre restaurado.` 
        });
        fetchAllData();
        setTimeout(() => setCancelOrdersFeedback(null), 6000);
      } else {
        setCancelOrdersFeedback({ type: 'error', msg: data.error || 'Error al cancelar órdenes.' });
      }
    } catch (err) {
      setCancelOrdersFeedback({ type: 'error', msg: err.message });
    } finally {
      setIsCancellingOrders(false);
    }
  };

  // Helper para obtener la comisión cobrada por Binance
  const getTradeCommission = (t) => {
    const comm = parseFloat(t.commission_usdt);
    if (!isNaN(comm) && comm > 0) return comm;
    // Estimación automática si la columna viniese vacía
    const openP = parseFloat(t.open_price) || 0;
    const closeP = parseFloat(t.close_price) || openP;
    const qty = parseFloat(t.quantity) || 0;
    const posSize = parseFloat(t.position_size_usdt) || (openP * qty);
    const entryNotional = (openP * qty) > 0 ? (openP * qty) : posSize;
    const exitNotional = (closeP * qty) > 0 ? (closeP * qty) : entryNotional;
    return (entryNotional * 0.0002) + (exitNotional * 0.0005);
  };

  // Helper para obtener el PnL neto real de un trade (después de deducir comisiones)
  const getTradePnL = (t) => {
    const raw = parseFloat(t.pnl_usdt);
    if (!isNaN(raw) && Math.abs(raw) > 1e-6) return raw;
    const openP = parseFloat(t.open_price);
    const closeP = parseFloat(t.close_price);
    const qty = parseFloat(t.quantity);
    if (!isNaN(openP) && !isNaN(closeP) && !isNaN(qty) && openP > 0 && closeP > 0 && qty > 0 && Math.abs(openP - closeP) > 1e-8) {
      const gross = (t.trade_type === 'SHORT' ? (openP - closeP) : (closeP - openP)) * qty;
      const comm = getTradeCommission(t);
      return gross - comm;
    }
    return !isNaN(raw) ? raw : 0;
  };

  // Helper para obtener el PnL bruto (antes de comisiones de Binance)
  const getTradeGrossPnL = (t) => {
    const gross = parseFloat(t.gross_pnl_usdt);
    if (!isNaN(gross) && Math.abs(gross) > 1e-6) return gross;
    const net = getTradePnL(t);
    const comm = getTradeCommission(t);
    return net + comm;
  };

  // Helper para extraer el nombre de la estrategia de un trade
  const getTradeStrategy = (t) => {
    const rawStrat = t.strategy_name && String(t.strategy_name).trim();
    if (rawStrat && rawStrat.toLowerCase() !== 'global') {
      return rawStrat;
    }
    if (t.parameters) {
      try {
        const p = typeof t.parameters === 'string' ? JSON.parse(t.parameters) : t.parameters;
        const pStrat = p.strategy_name || p.active_strategy_name;
        if (pStrat && String(pStrat).trim().toLowerCase() !== 'global') return String(pStrat).trim();
      } catch (_) {}
    }
    // Buscar si el símbolo tiene estrategia asociada en accountStatus
    if (t.symbol && Array.isArray(accountStatus?.statuses)) {
      const found = accountStatus.statuses.find(s => s.symbol?.toUpperCase() === t.symbol?.toUpperCase());
      if (found?.strategy_name && found.strategy_name.toLowerCase() !== 'global') {
        return found.strategy_name;
      }
    }
    return 'v3_RSI-SNIPER-MOMENTUM_v3';
  };

  // Filtrar operaciones válidas descartando órdenes de entrada espurias con PnL 0 de sincronizaciones
  const validTrades = useMemo(() => {
    return trades.filter(t => {
      const pnl = getTradePnL(t);
      if (Math.abs(pnl) > 1e-6) return true;
      // Descartar si es sync dummy de Binance sin PnL real
      if (t.close_reason && t.close_reason.includes('Binance Testnet Sync') && Math.abs(pnl) < 1e-6) {
        return false;
      }
      return true;
    });
  }, [trades]);

  // Lista única de estrategias disponibles en el historial
  const availableStrategies = useMemo(() => {
    const set = new Set();
    validTrades.forEach(t => {
      const s = getTradeStrategy(t);
      if (s) set.add(s);
    });
    return Array.from(set).sort();
  }, [validTrades]);

  // Filtrar trades por símbolo y por estrategia
  const filteredTrades = useMemo(() => {
    return validTrades.filter(t => {
      if (filterSymbol !== 'ALL' && (!t.symbol || t.symbol.toUpperCase() !== filterSymbol.toUpperCase())) {
        return false;
      }
      if (filterStrategy !== 'ALL' && getTradeStrategy(t) !== filterStrategy) {
        return false;
      }
      return true;
    });
  }, [validTrades, filterSymbol, filterStrategy]);

  // Ordenar historial de trades cerrados en general
  const sortedGlobalTrades = useMemo(() => {
    if (!filteredTrades || filteredTrades.length === 0) return [];
    return sortTableData(filteredTrades, globalTradeSort, {
      id: (t) => t.id || t.binance_trade_id || 0,
      close_timestamp: (t) => Date.parse(t.close_timestamp) || 0,
      symbol: (t) => t.symbol || '',
      trade_type: (t) => t.trade_type || 'LONG',
      close_reason: (t) => t.close_reason || '',
      pnl_usdt: (t) => getTradePnL(t),
      open_price: (t) => parseFloat(t.open_price) || 0,
      close_price: (t) => parseFloat(t.close_price) || 0,
      quantity: (t) => parseFloat(t.quantity) || 0,
      commission_usdt: (t) => getTradeCommission(t)
    });
  }, [filteredTrades, globalTradeSort]);

  const visibleGlobalTrades = useMemo(() => {
    if (globalTradeLimit === 'ALL') return sortedGlobalTrades;
    const limitNum = Number(globalTradeLimit) || 50;
    return sortedGlobalTrades.slice(0, limitNum);
  }, [sortedGlobalTrades, globalTradeLimit]);

  // Métricas financieras calculadas
  const totalTrades = filteredTrades.length;
  const winningTrades = filteredTrades.filter(t => getTradePnL(t) > 0);
  const losingTrades = filteredTrades.filter(t => getTradePnL(t) < 0);
  const winRate = totalTrades > 0 ? ((winningTrades.length / totalTrades) * 100).toFixed(1) : '0.0';

  const grossProfit = winningTrades.reduce((acc, t) => acc + getTradePnL(t), 0);
  const grossLoss = Math.abs(losingTrades.reduce((acc, t) => acc + getTradePnL(t), 0));
  const netPnL = grossProfit - grossLoss;
  const profitFactor = grossLoss > 0 ? (grossProfit / grossLoss).toFixed(2) : (grossProfit > 0 ? '∞' : '1.00');

  // Comisiones totales Binance y PnL Bruto de mercado
  const totalCommissions = filteredTrades.reduce((acc, t) => acc + getTradeCommission(t), 0);
  const totalGrossPnL = filteredTrades.reduce((acc, t) => acc + getTradeGrossPnL(t), 0);

  const avgWin = winningTrades.length > 0 ? grossProfit / winningTrades.length : 0;
  const avgLoss = losingTrades.length > 0 ? grossLoss / losingTrades.length : 0;
  const realizedRiskReward = avgLoss > 0 ? (avgWin / avgLoss).toFixed(2) : (avgWin > 0 ? '∞' : '1.00');

  const bestTrade = filteredTrades.length > 0
    ? Math.max(...filteredTrades.map(t => getTradePnL(t)))
    : 0;
  const worstTrade = filteredTrades.length > 0
    ? Math.min(...filteredTrades.map(t => getTradePnL(t)))
    : 0;

  // Curva de Capital (Cumulative Equity), Maximum Drawdown (MDD) y Lapso de Tiempo
  const {
    equityPoints,
    maxDrawdownUSDT,
    maxDrawdownPercent,
    totalSessionElapsedStr,
    puntoCeroDate,
    lastCloseDate
  } = useMemo(() => {
    // 1. Ordenar cronológicamente ascendente (desde el primer trade hasta el más reciente)
    const sortedTrades = [...filteredTrades].sort((a, b) => {
      const da = parseDate(a.close_timestamp || a.open_timestamp)?.getTime() || (a.id || 0);
      const db = parseDate(b.close_timestamp || b.open_timestamp)?.getTime() || (b.id || 0);
      return da - db;
    });

    if (sortedTrades.length === 0) {
      return {
        equityPoints: [],
        maxDrawdownUSDT: 0,
        maxDrawdownPercent: '0.00',
        totalSessionElapsedStr: '0s',
        puntoCeroDate: null,
        lastCloseDate: null
      };
    }

    // 2. Establecer el Punto Cero (apertura de la primera posición)
    const pCeroDate = parseDate(sortedTrades[0].open_timestamp) || parseDate(sortedTrades[0].close_timestamp) || new Date();
    const lCloseDate = parseDate(sortedTrades[sortedTrades.length - 1].close_timestamp) || parseDate(sortedTrades[sortedTrades.length - 1].open_timestamp) || pCeroDate;
    const sessionElapsedMs = Math.max(0, lCloseDate.getTime() - pCeroDate.getTime());
    const sessionElapsedFormatted = formatDuration(sessionElapsedMs);

    let runningTotal = 0;
    let peak = 0;
    let maxDD = 0;

    const points = [];

    // Punto Cero: Momento exacto de apertura de la primera posición
    points.push({
      index: 0,
      isPuntoCero: true,
      label: 'Punto Cero (Inicio)',
      symbol: sortedTrades[0].symbol || 'INICIO',
      side: sortedTrades[0].trade_type || 'LONG',
      pnl: 0,
      cumulative: 0,
      date: pCeroDate,
      time: formatTimeHHmm(pCeroDate),
      fullDateTime: formatFullDateTime(pCeroDate),
      elapsedMs: 0,
      elapsedStr: '0s (Inicio)',
      diffUSDT: 0,
      diffPercent: 0,
      diffDirection: 'NONE',
      tradeObj: null
    });

    // Puntos de Cierre: 1 hasta N
    sortedTrades.forEach((t, idx) => {
      const pnl = getTradePnL(t);
      const prevCumulative = runningTotal;
      runningTotal += pnl;

      if (runningTotal > peak) peak = runningTotal;
      const currentDD = peak - runningTotal;
      if (currentDD > maxDD) maxDD = currentDD;

      const cDate = parseDate(t.close_timestamp) || parseDate(t.open_timestamp) || pCeroDate;
      const tradeElapsedMs = Math.max(0, cDate.getTime() - pCeroDate.getTime());
      const tradeElapsedFormatted = formatDuration(tradeElapsedMs);

      const diffUSDT = runningTotal - prevCumulative; // Equivale al PnL de este cierre
      let diffPct = 0;
      if (prevCumulative === 0) {
        diffPct = diffUSDT !== 0 ? (diffUSDT > 0 ? 100 : -100) : 0;
      } else {
        diffPct = (diffUSDT / Math.abs(prevCumulative)) * 100;
      }

      points.push({
        index: idx + 1,
        isPuntoCero: false,
        label: `Cierre #${idx + 1}`,
        symbol: t.symbol || '',
        side: t.trade_type || 'LONG',
        pnl,
        cumulative: runningTotal,
        date: cDate,
        time: formatTimeHHmm(cDate),
        fullDateTime: formatFullDateTime(cDate),
        elapsedMs: tradeElapsedMs,
        elapsedStr: tradeElapsedFormatted,
        diffUSDT,
        diffPercent: diffPct,
        diffDirection: diffUSDT > 0 ? 'UP' : (diffUSDT < 0 ? 'DOWN' : 'FLAT'),
        tradeObj: t
      });
    });

    const totalBalanceRef = riskData ? parseFloat(riskData.total_balance) || 1000 : 1000;
    const maxDDPct = totalBalanceRef > 0 ? ((maxDD / totalBalanceRef) * 100).toFixed(2) : '0.00';

    return {
      equityPoints: points,
      maxDrawdownUSDT: maxDD,
      maxDrawdownPercent: maxDDPct,
      totalSessionElapsedStr: sessionElapsedFormatted,
      puntoCeroDate: pCeroDate,
      lastCloseDate: lCloseDate
    };
  }, [filteredTrades, riskData]);

  // Selección del punto a inspeccionar (por defecto el último cierre registrado)
  const activeEquityIndex = (selectedEquityIndex !== null && selectedEquityIndex >= 0 && selectedEquityIndex < equityPoints.length)
    ? selectedEquityIndex
    : (equityPoints.length > 0 ? equityPoints.length - 1 : 0);

  const inspectedEquityPoint = equityPoints[activeEquityIndex] || null;

  // SVG Dimensiones y Escalas
  const svgWidth = 800;
  const svgHeight = 250;
  const padding = { top: 25, right: 35, bottom: 45, left: 60 };

  const minEquity = equityPoints.length > 0 ? Math.min(0, ...equityPoints.map(p => p.cumulative)) : 0;
  const maxEquity = equityPoints.length > 0 ? Math.max(1, ...equityPoints.map(p => p.cumulative)) : 1;
  const equityRange = (maxEquity - minEquity) || 1;

  const getY = (val) => {
    const chartHeight = svgHeight - padding.top - padding.bottom;
    return padding.top + chartHeight - ((val - minEquity) / equityRange) * chartHeight;
  };

  const getX = (idx) => {
    const chartWidth = svgWidth - padding.left - padding.right;
    if (equityPoints.length <= 1) return padding.left + chartWidth / 2;
    return padding.left + (idx / (equityPoints.length - 1)) * chartWidth;
  };

  const zeroY = getY(0);

  const linePath = equityPoints.length > 0
    ? equityPoints.reduce((acc, pt, i) => `${acc} ${i === 0 ? 'M' : 'L'} ${getX(i)} ${getY(pt.cumulative)}`, '')
    : '';

  const areaPath = equityPoints.length > 0
    ? `${linePath} L ${getX(equityPoints.length - 1)} ${zeroY} L ${getX(0)} ${zeroY} Z`
    : '';

  // Marcas de tiempo en el eje X para mostrar las horas de los cierres sin solapamientos
  const xAxisTicks = useMemo(() => {
    if (equityPoints.length <= 1) return [];
    if (equityPoints.length <= 8) {
      return equityPoints.map((pt, i) => ({ point: pt, index: i }));
    }
    const count = 7;
    const step = (equityPoints.length - 1) / (count - 1);
    const result = [];
    const usedIndices = new Set();
    for (let c = 0; c < count; c++) {
      const idx = Math.min(equityPoints.length - 1, Math.round(c * step));
      if (!usedIndices.has(idx)) {
        usedIndices.add(idx);
        result.push({ point: equityPoints[idx], index: idx });
      }
    }
    return result;
  }, [equityPoints]);

  // ========================================================
  // DESGLOSE Y RANKING POR CRIPTOMONEDA (CON ORDENAMIENTO)
  // ========================================================
  const coinPerformanceList = useMemo(() => {
    const map = {};

    validTrades.forEach(t => {
      const sym = (t.symbol || 'DESCONOCIDO').toUpperCase();
      const pnl = getTradePnL(t);

      if (!map[sym]) {
        map[sym] = {
          symbol: sym,
          totalPnL: 0,
          tradesCount: 0,
          wins: 0,
          losses: 0,
          bestTrade: -Infinity,
          worstTrade: Infinity,
          trades: []
        };
      }

      map[sym].totalPnL += pnl;
      map[sym].tradesCount += 1;
      map[sym].trades.push(t);
      if (pnl > 0) map[sym].wins += 1;
      if (pnl < 0) map[sym].losses += 1;
      if (pnl > map[sym].bestTrade) map[sym].bestTrade = pnl;
      if (pnl < map[sym].worstTrade) map[sym].worstTrade = pnl;
    });

    const list = Object.values(map).map(c => {
      const sortedTrades = [...c.trades].sort((a, b) => {
        const timeA = new Date(a.close_timestamp || a.open_timestamp || 0).getTime() || (a.id || 0);
        const timeB = new Date(b.close_timestamp || b.open_timestamp || 0).getTime() || (b.id || 0);
        return timeA - timeB;
      });

      return {
        ...c,
        trades: sortedTrades,
        winRate: c.tradesCount > 0 ? ((c.wins / c.tradesCount) * 100).toFixed(1) : '0.0',
        bestTrade: c.bestTrade === -Infinity ? 0 : c.bestTrade,
        worstTrade: c.worstTrade === Infinity ? 0 : c.worstTrade
      };
    });

    // Aplicar ordenamiento interactivo
    list.sort((a, b) => {
      if (coinSortOrder === 'PNL_DESC') return b.totalPnL - a.totalPnL; // Mayor a menor
      if (coinSortOrder === 'PNL_ASC') return a.totalPnL - b.totalPnL;  // Menor a mayor
      if (coinSortOrder === 'WINRATE_DESC') return parseFloat(b.winRate) - parseFloat(a.winRate);
      if (coinSortOrder === 'TRADES_DESC') return b.tradesCount - a.tradesCount;
      if (coinSortOrder === 'ALPHA') return a.symbol.localeCompare(b.symbol);
      return b.totalPnL - a.totalPnL;
    });

    return list;
  }, [validTrades, coinSortOrder]);

  const maxAbsCoinPnL = useMemo(() => {
    if (coinPerformanceList.length === 0) return 1;
    return Math.max(0.1, ...coinPerformanceList.map(c => Math.abs(c.totalPnL)));
  }, [coinPerformanceList]);

  // ========================================================
  // DESGLOSE Y RANKING POR ESTRATEGIA (TORNEO DE ESTRATEGIAS)
  // ========================================================
  const strategyPerformanceList = useMemo(() => {
    const map = {};

    validTrades.forEach(t => {
      const strat = getTradeStrategy(t);
      const pnl = getTradePnL(t);
      const sym = (t.symbol || '').toUpperCase();

      if (!map[strat]) {
        map[strat] = {
          strategy: strat,
          totalPnL: 0,
          tradesCount: 0,
          wins: 0,
          losses: 0,
          symbols: new Set(),
          bestTrade: -Infinity,
          worstTrade: Infinity,
          trades: []
        };
      }

      map[strat].totalPnL += pnl;
      map[strat].tradesCount += 1;
      map[strat].trades.push(t);
      if (sym) map[strat].symbols.add(sym);
      if (pnl > 0) map[strat].wins += 1;
      if (pnl < 0) map[strat].losses += 1;
      if (pnl > map[strat].bestTrade) map[strat].bestTrade = pnl;
      if (pnl < map[strat].worstTrade) map[strat].worstTrade = pnl;
    });

    const list = Object.values(map).map(s => {
      const sortedTrades = [...s.trades].sort((a, b) => {
        const timeA = new Date(a.close_timestamp || a.open_timestamp || 0).getTime() || (a.id || 0);
        const timeB = new Date(b.close_timestamp || b.open_timestamp || 0).getTime() || (b.id || 0);
        return timeA - timeB;
      });

      return {
        ...s,
        trades: sortedTrades,
        symbolsList: Array.from(s.symbols),
        winRate: s.tradesCount > 0 ? ((s.wins / s.tradesCount) * 100).toFixed(1) : '0.0',
        bestTrade: s.bestTrade === -Infinity ? 0 : s.bestTrade,
        worstTrade: s.worstTrade === Infinity ? 0 : s.worstTrade
      };
    });

    // Aplicar ordenamiento interactivo
    list.sort((a, b) => {
      if (coinSortOrder === 'PNL_DESC') return b.totalPnL - a.totalPnL;
      if (coinSortOrder === 'PNL_ASC') return a.totalPnL - b.totalPnL;
      if (coinSortOrder === 'WINRATE_DESC') return parseFloat(b.winRate) - parseFloat(a.winRate);
      if (coinSortOrder === 'TRADES_DESC') return b.tradesCount - a.tradesCount;
      if (coinSortOrder === 'ALPHA') return a.strategy.localeCompare(b.strategy);
      return b.totalPnL - a.totalPnL;
    });

    return list;
  }, [validTrades, coinSortOrder]);

  // Resumen Consolidado del Torneo de Estrategias
  const tournamentBreakdown = useMemo(() => {
    let winSum = 0;
    let lossSum = 0;
    let winCount = 0;
    let lossCount = 0;
    strategyPerformanceList.forEach(s => {
      if (s.totalPnL > 0.00001) {
        winSum += s.totalPnL;
        winCount += 1;
      } else if (s.totalPnL < -0.00001) {
        lossSum += s.totalPnL;
        lossCount += 1;
      }
    });
    return {
      winningStrategiesSum: winSum,
      losingStrategiesSum: lossSum,
      winningStratsCount: winCount,
      losingStratsCount: lossCount,
      netStrategiesSum: winSum + lossSum
    };
  }, [strategyPerformanceList]);

  const maxAbsStrategyPnL = useMemo(() => {
    if (strategyPerformanceList.length === 0) return 1;
    return Math.max(0.1, ...strategyPerformanceList.map(s => Math.abs(s.totalPnL)));
  }, [strategyPerformanceList]);

  // Exportar reporte a CSV
  const handleExportCSV = () => {
    if (filteredTrades.length === 0) {
      alert('No hay operaciones para exportar.');
      return;
    }

    const headers = [
      'ID',
      'Símbolo',
      'Estrategia',
      'Tipo',
      'Fecha Apertura',
      'Fecha Cierre',
      'Precio Entrada',
      'Precio Salida',
      'Cantidad',
      'Tamaño USDT',
      'PnL Neto USDT',
      'Comisión Binance USDT',
      'PnL Bruto USDT',
      'Razón Cierre'
    ];

    const rows = filteredTrades.map(t => [
      t.id || '',
      t.symbol || '',
      `"${getTradeStrategy(t)}"`,
      t.trade_type || 'LONG',
      t.open_timestamp ? `"${t.open_timestamp}"` : '',
      t.close_timestamp ? `"${t.close_timestamp}"` : '',
      t.open_price || 0,
      t.close_price || 0,
      t.quantity || 0,
      t.position_size_usdt || 0,
      getTradePnL(t).toFixed(4),
      getTradeCommission(t).toFixed(4),
      getTradeGrossPnL(t).toFixed(4),
      `"${t.close_reason || ''}"`
    ]);

    const csvContent = [headers.join(','), ...rows.map(e => e.join(','))].join('\n');
    const blob = new Blob([csvContent], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    const today = new Date().toISOString().split('T')[0];
    link.setAttribute('href', url);
    link.setAttribute('download', `reporte_trading_bot_${filterSymbol}_${today}.csv`);
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
  };

  // Donut de margen de cartera
  const portfolioDonutData = useMemo(() => {
    const activePositions = accountStatus?.statuses?.filter(s => s.in_position) || [];
    const colors = ['#10b981', '#3b82f6', '#f59e0b', '#8b5cf6', '#ec4899', '#06b6d4', '#14b8a6', '#f97316'];
    
    let allocatedMargin = 0;
    const slices = activePositions.map((pos, idx) => {
      const entryPrice = parseFloat(pos.entry_price || pos.current_price || 1);
      const qty = parseFloat(pos.current_position || pos.position_size || 0);
      const lev = parseFloat(pos.leverage || 12);
      const margin = parseFloat(pos.margin_usdt) > 0 
        ? parseFloat(pos.margin_usdt) 
        : (entryPrice > 0 && qty > 0 ? (entryPrice * qty) / lev : 25);
      allocatedMargin += margin;
      return {
        symbol: pos.symbol,
        margin: Math.max(1, margin),
        color: colors[idx % colors.length]
      };
    });

    const totalBalance = riskData ? parseFloat(riskData.total_balance) || 1000 : 1000;
    const freeMargin = Math.max(0, totalBalance - allocatedMargin);

    return {
      slices,
      allocatedMargin,
      freeMargin,
      totalPositions: activePositions.length
    };
  }, [accountStatus, riskData]);

  // Lista única de símbolos
  const availableSymbols = Array.from(new Set(trades.map(t => t.symbol && t.symbol.toUpperCase()).filter(Boolean)));

  // Cálculos de la barra de estrés de riesgo y desglose de billetera
  const totalBalanceNum = riskData ? parseFloat(riskData.total_balance) || 0 : 0;
  const marginBalanceNum = riskData && riskData.margin_balance ? parseFloat(riskData.margin_balance) || totalBalanceNum : totalBalanceNum;
  const currentExpNum = riskData ? parseFloat(riskData.current_exposure) || 0 : 0;
  const openOrdersMarginNum = riskData && riskData.open_orders_margin ? parseFloat(riskData.open_orders_margin) || 0 : 0;
  const unrealizedPnLNum = riskData && riskData.unrealized_pnl ? parseFloat(riskData.unrealized_pnl) || 0 : 0;
  const maxExpNum = riskData ? parseFloat(riskData.max_exposure) || 0 : 0;
  const freeMarginNum = riskData && riskData.free_margin ? parseFloat(riskData.free_margin) : Math.max(0, totalBalanceNum - currentExpNum - openOrdersMarginNum);

  // Conciliación Financiera y Auditoría de Saldos Binance
  const initialPoolBase = (accountStatus?.initial_capital !== undefined && accountStatus?.initial_capital !== null) 
    ? parseFloat(accountStatus.initial_capital) 
    : 5000.0;
  const walletNetProfit = totalBalanceNum > 0 ? (totalBalanceNum - initialPoolBase) : 0;
  const walletRoiPct = initialPoolBase > 0 ? ((walletNetProfit / initialPoolBase) * 100) : 0;
  const openDifferential = totalBalanceNum > 0 ? (walletNetProfit - netPnL) : 0;

  // Porcentaje de la exposición actual respecto al límite máximo autorizado
  const stressRatio = maxExpNum > 0 ? Math.min(100, (currentExpNum / maxExpNum) * 100) : 0;
  const stressColor = stressRatio > 80 ? 'bg-rose-500' : stressRatio > 50 ? 'bg-amber-500' : 'bg-emerald-500';
  const stressBorder = stressRatio > 80 ? 'border-rose-500/50 text-rose-400' : stressRatio > 50 ? 'border-amber-500/50 text-amber-400' : 'border-emerald-500/50 text-emerald-400';
  const stressLabel = stressRatio > 80 ? 'ALTO RIESGO' : stressRatio > 50 ? 'MODERADO' : 'SEGURO';

  // Renderizador del gráfico de barras por trade cerrado (Eje central 0 con ganancias arriba y pérdidas abajo)
  const renderTradeSequenceChart = (tradesList, symbolOrStrat) => {
    if (!tradesList || tradesList.length === 0) {
      return (
        <div className="py-2.5 text-center text-[11px] text-gray-500 font-mono italic">
          Sin operaciones cerradas registradas
        </div>
      );
    }

    // Calcular el valor absoluto máximo entre los trades para escalar las barras de forma equilibrada
    const maxAbs = Math.max(0.05, ...tradesList.map(t => Math.abs(getTradePnL(t))));

    // Geometría SVG
    const barWidth = 12;
    const colSpacing = 20;
    const leftMargin = 45;
    const rightMargin = 20;
    const totalSvgWidth = Math.max(400, leftMargin + tradesList.length * colSpacing + rightMargin);
    const svgHeight = 180;
    const centerY = 90; // El centro exacto matemático donde se posa la línea base
    const maxBarHeight = 65;

    const isThisCoinInspected = activeTradeInspector && activeTradeInspector.coin === symbolOrStrat;

    // Helper para formatear fecha estilo exacto: "20 sept, 23:14"
    const formatTradeTime = (timestamp) => {
      if (!timestamp) return '';
      try {
        const raw = String(timestamp).trim();
        const isoString = (raw.includes('T') || raw.includes('Z') || raw.includes('+')) 
          ? (raw.endsWith('Z') || raw.includes('+') ? raw : raw + 'Z')
          : raw.replace(' ', 'T') + 'Z';
        const d = new Date(isoString);
        if (isNaN(d.getTime())) return timestamp;
        const day = d.getDate();
        const months = ['ene', 'feb', 'mar', 'abr', 'may', 'jun', 'jul', 'ago', 'sept', 'oct', 'nov', 'dic'];
        const month = months[d.getMonth()] || '';
        const hours = String(d.getHours()).padStart(2, '0');
        const minutes = String(d.getMinutes()).padStart(2, '0');
        return `${day} ${month}, ${hours}:${minutes}`;
      } catch (e) {
        return timestamp;
      }
    };

    return (
      <div className="mt-2.5 pt-2 border-t border-gray-200 dark:border-gray-800/80">
        
        {/* Leyenda superior y contador */}
        <div className="flex flex-wrap items-center justify-end gap-2 text-[11px] text-gray-500 dark:text-gray-400 mb-1.5 px-1 font-mono">
          <span className="text-[10px] text-slate-400 font-semibold">
            {tradesList.length} {tradesList.length === 1 ? 'trade cerrado' : 'trades cerrados'} (cronológico ➔)
          </span>
        </div>

        {/* Contenedor del Gráfico SVG con Eje Cero Matemático y Tooltip Dinámico */}
        <div className="relative w-full bg-gray-100 dark:bg-slate-950/90 rounded-xl p-2 border border-gray-200 dark:border-slate-800 shadow-inner min-h-[160px]">
          <div className="relative w-full overflow-x-auto no-scrollbar">
            
            {/* Tooltip Flotante sobre la barra con la información exacta requerida */}
            {isThisCoinInspected && activeTradeInspector && (
              <div
                className="absolute z-30 pointer-events-none transition-all duration-150 -translate-x-1/2 bg-slate-900/95 backdrop-blur-md border border-amber-400/80 shadow-2xl rounded-xl px-3 py-2 text-left font-mono whitespace-nowrap"
                style={{
                  left: `${Math.max(75, Math.min(totalSvgWidth - 75, activeTradeInspector.x + barWidth / 2))}px`,
                  top: `${Math.max(4, centerY - 68)}px`
                }}
              >
                <div className="flex items-center gap-1.5 text-xs font-black">
                  <span className="text-white">Trade #{activeTradeInspector.index}</span>
                  <span className={activeTradeInspector.isWin ? 'text-emerald-400' : 'text-rose-400'}>
                    {activeTradeInspector.isWin ? 'WIN 🎯' : 'LOSS 🛑'}
                  </span>
                </div>
                <div className={`text-xs font-black mt-0.5 ${activeTradeInspector.isWin ? 'text-emerald-400' : 'text-rose-400'}`}>
                  {activeTradeInspector.isWin ? '+' : ''}${activeTradeInspector.pnl.toFixed(4)} USDT
                </div>
                <div className="text-[11px] text-slate-300 mt-0.5">
                  Tipo: <strong className={activeTradeInspector.trade.trade_type === 'LONG' ? 'text-emerald-400' : 'text-rose-400'}>{activeTradeInspector.trade.trade_type || 'LONG'}</strong>
                </div>
                {activeTradeInspector.timeStr && (
                  <div className="text-[10px] text-slate-400 mt-0.5">
                    🕒 {activeTradeInspector.timeStr}
                  </div>
                )}
              </div>
            )}

            <svg
              width={totalSvgWidth}
              height={svgHeight}
              viewBox={`0 0 ${totalSvgWidth} ${svgHeight}`}
              className="select-none block"
              onMouseLeave={() => setActiveTradeInspector(null)}
            >
              <defs>
                {/* Gradiente Verde para Ganancias */}
                <linearGradient id="winGrad" x1="0%" y1="0%" x2="0%" y2="100%">
                  <stop offset="0%" stopColor="#34d399" />
                  <stop offset="100%" stopColor="#10b981" />
                </linearGradient>

                {/* Gradiente Rojo para Pérdidas */}
                <linearGradient id="lossGrad" x1="0%" y1="0%" x2="0%" y2="100%">
                  <stop offset="0%" stopColor="#f43f5e" />
                  <stop offset="100%" stopColor="#e11d48" />
                </linearGradient>

                {/* Filtro de Resaltado Dorado para Trade Activo */}
                <filter id="activeGlow" x="-20%" y="-20%" width="140%" height="140%">
                  <feDropShadow dx="0" dy="0" stdDeviation="3" floodColor="#fbbf24" />
                </filter>
              </defs>

              {/* 1. Línea Base Horizontal Eje Cero */}
              <line
                x1={leftMargin - 6}
                y1={centerY}
                x2={totalSvgWidth - rightMargin}
                y2={centerY}
                stroke="#64748b"
                strokeWidth="1.5"
                strokeDasharray="4 3"
              />

              {/* 2. Etiqueta 0.00 en el Eje a la Izquierda */}
              <rect
                x="6"
                y={centerY - 9}
                width="36"
                height="18"
                rx="4"
                fill="#0f172a"
                stroke="#475569"
                strokeWidth="1"
              />
              <text
                x="24"
                y={centerY + 4}
                textAnchor="middle"
                fill="#94a3b8"
                fontSize="10"
                fontWeight="bold"
                fontFamily="monospace"
              >
                0.00
              </text>

              {/* 3. Barras de cada Trade Cerrado */}
              {tradesList.map((t, idx) => {
                const pnl = getTradePnL(t);
                const isWin = pnl > 0.00001;
                const isLoss = pnl < -0.00001;
                const absPnl = Math.abs(pnl);

                // Altura proporcional: escala entre 8px y 32px
                const barHeight = Math.max(8, Math.min(maxBarHeight, Math.round((absPnl / maxAbs) * maxBarHeight)));
                const x = leftMargin + idx * colSpacing;

                const isSelected = activeTradeInspector && 
                  activeTradeInspector.coin === symbolOrStrat && 
                  activeTradeInspector.index === (idx + 1);

                const timeStr = formatTradeTime(t.close_timestamp);

                const handleSelect = () => {
                  setActiveTradeInspector({
                    coin: symbolOrStrat,
                    trade: t,
                    index: idx + 1,
                    pnl,
                    isWin,
                    isLoss,
                    timeStr,
                    x
                  });
                };

                return (
                  <g key={t.id || idx} className="cursor-pointer">
                    {/* Zona de Clic / Hover invisible para facilitar selección en móviles y escritorio */}
                    <rect
                      x={x - 4}
                      y="4"
                      width={barWidth + 8}
                      height={svgHeight - 8}
                      fill="transparent"
                      onClick={handleSelect}
                      onMouseEnter={handleSelect}
                    />

                    {/* Si es Ganancia: Nace en centerY y sube hacia arriba (y = centerY - barHeight) */}
                    {isWin && (
                      <rect
                        x={x}
                        y={centerY - barHeight}
                        width={barWidth}
                        height={barHeight}
                        rx="3"
                        fill="url(#winGrad)"
                        stroke={isSelected ? "#fbbf24" : "#34d399"}
                        strokeWidth={isSelected ? 2.5 : 1}
                        filter={isSelected ? "url(#activeGlow)" : undefined}
                        onClick={handleSelect}
                        onMouseEnter={handleSelect}
                        className="transition-all hover:brightness-125"
                      />
                    )}

                    {/* Si es Pérdida: Nace en centerY y baja hacia abajo (y = centerY) */}
                    {isLoss && (
                      <rect
                        x={x}
                        y={centerY}
                        width={barWidth}
                        height={barHeight}
                        rx="3"
                        fill="url(#lossGrad)"
                        stroke={isSelected ? "#fbbf24" : "#fb7185"}
                        strokeWidth={isSelected ? 2.5 : 1}
                        filter={isSelected ? "url(#activeGlow)" : undefined}
                        onClick={handleSelect}
                        onMouseEnter={handleSelect}
                        className="transition-all hover:brightness-125"
                      />
                    )}

                    {/* Si es Breakeven 0 */}
                    {!isWin && !isLoss && (
                      <circle
                        cx={x + barWidth / 2}
                        cy={centerY}
                        r="3"
                        fill="#94a3b8"
                        onClick={handleSelect}
                        onMouseEnter={handleSelect}
                      />
                    )}

                    {/* Número de Trade debajo de la barra */}
                    <text
                      x={x + barWidth / 2}
                      y={centerY + 34}
                      textAnchor="middle"
                      fill={isSelected ? "#fbbf24" : "#94a3b8"}
                      fontSize="10"
                      fontWeight={isSelected ? "bold" : "normal"}
                      fontFamily="monospace"
                      onClick={handleSelect}
                      onMouseEnter={handleSelect}
                    >
                      #{idx + 1}
                    </text>
                  </g>
                );
              })}
            </svg>
          </div>
        </div>

        {/* Indicador de ayuda al usuario */}
        {!isThisCoinInspected && (
          <div className="text-[10px] text-slate-500 mt-1 px-1 flex items-center justify-between font-mono">
            <span>💡 Pasa el cursor o toca cualquier barra para ver el detalle del trade.</span>
          </div>
        )}
      </div>
    );
  };

  return (
    <div className="space-y-6">

      {/* ======================================================== */}
      {/* 1. KPIs FINANCIEROS Y RENDIMIENTO GENERAL */}
      {/* ======================================================== */}
      <div className="bg-white dark:bg-gray-900 border border-gray-200 dark:border-gray-800 rounded-2xl shadow-lg p-5 transition-all">
        
        {/* Cabecera de KPIs */}
        <div className="flex flex-wrap items-center justify-between gap-3 pb-4 border-b border-gray-200 dark:border-gray-800">
          <div>
            <h2 className="text-base font-bold text-gray-900 dark:text-white flex items-center gap-2">
              <span>Rendimiento Financiero</span>
              <Tooltip title="Rendimiento Financiero" text="Historial completo de trades cerrados, ratio de acierto, factor de beneficio y curva de capital acumulado en vivo." />
              <span className={`text-xs px-2.5 py-0.5 rounded-full font-bold border ${
                netPnL >= 0 
                  ? 'bg-emerald-500/20 text-emerald-400 border-emerald-500/30' 
                  : 'bg-rose-500/20 text-rose-400 border-rose-500/30'
              }`}>
                {netPnL >= 0 ? `+${netPnL.toFixed(2)} USDT` : `${netPnL.toFixed(2)} USDT`}
              </span>
            </h2>
          </div>

          {/* Filtro por moneda, por estrategia, Historial de Trades, Sincronizar y Exportar CSV */}
          <div className="flex flex-wrap items-center gap-2">
            {availableSymbols.length > 0 && (
              <select
                value={filterSymbol}
                onChange={(e) => setFilterSymbol(e.target.value)}
                className="text-xs py-1.5 px-3 bg-gray-100 dark:bg-gray-800 border border-gray-200 dark:border-gray-700 rounded-lg font-semibold text-gray-800 dark:text-gray-200 focus:ring-2 focus:ring-primary-500"
              >
                <option value="ALL">🪙 Todas las Monedas ({trades.length} ops)</option>
                {availableSymbols.map(sym => (
                  <option key={sym} value={sym}>{sym}</option>
                ))}
              </select>
            )}

            {availableStrategies.length > 0 && (
              <select
                value={filterStrategy}
                onChange={(e) => setFilterStrategy(e.target.value)}
                className="text-xs py-1.5 px-3 bg-gray-100 dark:bg-gray-800 border border-gray-200 dark:border-gray-700 rounded-lg font-semibold text-purple-700 dark:text-purple-300 focus:ring-2 focus:ring-purple-500"
              >
                <option value="ALL">🧠 Todas las Estrategias</option>
                {availableStrategies.map(strat => (
                  <option key={strat} value={strat}>🧠 {strat}</option>
                ))}
              </select>
            )}

            <button
              type="button"
              onClick={() => {
                setShowAllClosedTrades(true);
                setTimeout(() => {
                  const el = document.getElementById('historial-trades-general');
                  if (el) el.scrollIntoView({ behavior: 'smooth' });
                }, 60);
              }}
              className="px-3 py-1.5 bg-amber-950/40 hover:bg-amber-900/60 text-amber-300 hover:text-amber-200 border border-amber-600/40 hover:border-amber-500 text-xs font-bold rounded-lg shadow-sm transition flex items-center gap-1.5 active:scale-95 cursor-pointer"
              title="Ir directamente al historial general de trades cerrados al final de la página"
            >
              <span>📜</span>
              <span>Historial de Trades ↓</span>
            </button>

            <button
              type="button"
              onClick={fetchAllData}
              disabled={isLoading}
              className="px-3 py-1.5 bg-indigo-600 hover:bg-indigo-500 disabled:opacity-50 text-white text-xs font-bold rounded-lg shadow transition flex items-center gap-1.5 active:scale-95"
              title="Sincronizar trades y PnL en vivo con Binance Testnet"
            >
              <span>{isLoading ? '⏳' : '🔄'}</span> Sincronizar Binance
            </button>

            <button
              type="button"
              onClick={handleExportCSV}
              className="px-3 py-1.5 bg-emerald-600 hover:bg-emerald-500 text-white text-xs font-bold rounded-lg shadow transition flex items-center gap-1.5 active:scale-95"
              title="Descargar reporte detallado en Excel CSV"
            >
              <span>📥</span> Exportar CSV
            </button>
          </div>
        </div>

        {/* PANEL INSTITUCIONAL DE AUDITORÍA Y CONCILIACIÓN DE SALDOS BINANCE */}
        <div className="my-4 p-4 bg-slate-950/90 rounded-2xl border border-indigo-900/40 shadow-inner">
          <div className="flex flex-wrap items-center justify-between gap-2 pb-2.5 mb-3 border-b border-slate-800">
            <div className="flex items-center gap-2">
              <span className="text-base">⚖️</span>
              <span className="text-xs sm:text-sm font-bold text-white tracking-wide">
                Conciliación Contable Oficial: Billetera Binance vs PnL de Operaciones
              </span>
              <Tooltip 
                title="Auditoría de Saldos y PnL" 
                text="Conciliación matemática exacta: Saldo Total Billetera = [1. Capital Base] + [2. PnL Bruto Trades] - [3. Comisiones Binance] + [4. Funding & Tasas]. Cada centavo queda auditado entre tus operaciones y el saldo real en Binance." 
              />
            </div>
            <div className="flex items-center gap-2">
              <span className={`text-[10px] font-mono font-bold px-2 py-0.5 rounded-full border ${
                unrealizedPnLNum >= 0 ? 'bg-emerald-950 text-emerald-300 border-emerald-800' : 'bg-rose-950 text-rose-300 border-rose-800'
              }`}>
                Flotante en Vivo: {unrealizedPnLNum >= 0 ? '+' : ''}{unrealizedPnLNum.toFixed(2)} USDT
              </span>
              <span className="text-[10px] font-mono font-bold px-2 py-0.5 rounded-full bg-indigo-950 text-indigo-300 border border-indigo-800">
                Conciliación Exacta
              </span>
            </div>
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-5 gap-3 text-xs font-mono">
            {/* 1. Base */}
            <div className="p-3 bg-slate-900/90 rounded-xl border border-slate-800">
              <span className="text-[10px] font-sans font-semibold text-slate-400 block uppercase tracking-wider">
                1. Capital Inicial Base
              </span>
              <span className="text-lg font-black text-white block mt-0.5">
                ${initialPoolBase.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })} <span className="text-xs text-slate-400 font-normal">USDT</span>
              </span>
              <span className="text-[10px] text-slate-500 font-sans block mt-1">
                Fondo depositado de inicio
              </span>
            </div>

            {/* 2. PnL Bruto Trades */}
            <div className="p-3 bg-slate-900/90 rounded-xl border border-slate-800">
              <span className="text-[10px] font-sans font-semibold text-slate-400 block uppercase tracking-wider flex items-center justify-between">
                <span>2. (+) PnL Bruto</span>
                <span className="text-[9px] text-emerald-400 font-bold">{totalTrades} ops</span>
              </span>
              <span className={`text-lg font-black block mt-0.5 ${totalGrossPnL >= 0 ? 'text-emerald-400' : 'text-rose-400'}`}>
                {totalGrossPnL >= 0 ? `+${totalGrossPnL.toFixed(2)}` : totalGrossPnL.toFixed(2)} <span className="text-xs text-slate-400 font-normal">USDT</span>
              </span>
              <span className="text-[10px] text-slate-400 font-sans block mt-1 font-mono">
                Neto: {netPnL >= 0 ? `+${netPnL.toFixed(2)}` : netPnL.toFixed(2)} USDT
              </span>
            </div>

            {/* 3. Comisiones Binance */}
            <div className="p-3 bg-amber-950/20 rounded-xl border border-amber-500/40">
              <span className="text-[10px] font-sans font-semibold text-amber-400 block uppercase tracking-wider flex items-center justify-between">
                <span>3. (-) Comisiones</span>
                <Tooltip title="Comisiones Totales Binance" text="Comisiones cobradas por Binance en aperturas y cierres de mercado (Maker/Taker). Se restan directamente de los beneficios de los trades." />
              </span>
              <span className="text-lg font-black block mt-0.5 text-amber-400">
                -${totalCommissions.toFixed(2)} <span className="text-xs text-slate-400 font-normal">USDT</span>
              </span>
              <span className="text-[10px] text-slate-500 font-sans block mt-1">
                Costos de corretaje Binance
              </span>
            </div>

            {/* 4. Funding & Tasas */}
            <div className="p-3 bg-slate-900/90 rounded-xl border border-slate-800">
              <span className="text-[10px] font-sans font-semibold text-slate-400 block uppercase tracking-wider flex items-center justify-between">
                <span>4. (+/-) Funding & Tasas</span>
                <Tooltip title="Tasas de Financiación & Descuentos" text="Abonos o débitos automáticos que Binance aplica en tu saldo cada 8 horas por financiamiento entre posiciones Long/Short (Funding Rates) e intereses." />
              </span>
              <span className={`text-lg font-black block mt-0.5 ${openDifferential >= 0 ? 'text-emerald-400' : 'text-amber-400'}`}>
                {openDifferential >= 0 ? `+${openDifferential.toFixed(2)}` : openDifferential.toFixed(2)} <span className="text-xs text-slate-400 font-normal">USDT</span>
              </span>
              <span className="text-[10px] text-slate-500 font-sans block mt-1">
                Liquidado por Binance
              </span>
            </div>

            {/* 5. Balance Binance */}
            <div className="p-3 bg-emerald-950/30 rounded-xl border border-emerald-800/60 shadow-sm">
              <span className="text-[10px] font-sans font-semibold text-emerald-300 block uppercase tracking-wider flex items-center justify-between">
                <span>5. (=) Saldo Billetera</span>
                <span className="text-[9px] font-bold text-emerald-400">100% Saldo</span>
              </span>
              <span className="text-lg font-black text-emerald-300 block mt-0.5">
                ${totalBalanceNum.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })} <span className="text-xs text-slate-400 font-normal">USDT</span>
              </span>
              <span className="text-[10px] font-bold text-emerald-400 font-sans block mt-1">
                Total: {walletNetProfit >= 0 ? `+${walletNetProfit.toFixed(2)}` : walletNetProfit.toFixed(2)} USDT ({walletNetProfit >= 0 ? '+' : ''}{walletRoiPct.toFixed(2)}%)
              </span>
            </div>
          </div>
        </div>

        {/* 4 Tarjetas de Métricas Clave Operativas */}
        <div className="grid grid-cols-2 sm:grid-cols-2 lg:grid-cols-4 gap-3.5 my-4">
          
          {/* 1. Tasa de Acierto */}
          <div className="p-3 bg-gray-50 dark:bg-gray-800/60 rounded-xl border border-gray-200 dark:border-gray-700/80">
            <span className="text-[11px] font-semibold text-gray-500 dark:text-gray-400 uppercase tracking-wider flex items-center justify-between">
              <span>🎯 Acierto</span>
              <Tooltip title="Tasa de Acierto (Win Rate)" text="Porcentaje de operaciones completadas con ganancia sobre el total de operaciones cerradas." example="Un Win Rate del 70% significa que 7 de cada 10 operaciones fueron exitosas." />
            </span>
            <span className={`text-xl font-bold font-mono ${parseFloat(winRate) >= 50 ? 'text-emerald-500' : 'text-amber-500'}`}>
              {winRate}%
            </span>
            <span className="text-[10px] text-gray-400 block mt-0.5">
              {winningTrades.length} G / {losingTrades.length} P
            </span>
          </div>

          {/* 2. Total Trades */}
          <div className="p-3 bg-gray-50 dark:bg-gray-800/60 rounded-xl border border-gray-200 dark:border-gray-700/80">
            <span className="text-[11px] font-semibold text-gray-500 dark:text-gray-400 uppercase tracking-wider flex items-center justify-between">
              <span>📊 Total Trades</span>
              <Tooltip title="Total de Operaciones Finalizadas" text="Número total de operaciones ejecutadas y cerradas registradas en el historial." />
            </span>
            <span className="text-xl font-bold font-mono text-white">
              {totalTrades} <span className="text-xs text-gray-400 font-normal">ops</span>
            </span>
            <span className="text-[10px] text-gray-400 block mt-0.5 font-mono">
              Prom: {totalTrades > 0 ? (netPnL / totalTrades >= 0 ? `+${(netPnL / totalTrades).toFixed(2)}` : (netPnL / totalTrades).toFixed(2)) : '0.00'} USDT/op
            </span>
          </div>

          {/* 4. Mejor / Peor */}
          <div className="p-3 bg-gray-50 dark:bg-gray-800/60 rounded-xl border border-gray-200 dark:border-gray-700/80">
            <span className="text-[11px] font-semibold text-gray-500 dark:text-gray-400 uppercase tracking-wider flex items-center justify-between">
              <span>🏆 Mejor / Peor</span>
              <Tooltip title="Mejor y Peor Operación" text="El trade más rentable cerrado por Take Profit y el trade con mayor pérdida cerrado por Stop Loss." />
            </span>
            <div className="flex items-center justify-between text-xs font-mono font-bold mt-1">
              <span className="text-emerald-400">+{bestTrade.toFixed(2)}</span>
              <span className="text-gray-500">/</span>
              <span className="text-rose-400">{worstTrade.toFixed(2)}</span>
            </div>
            <span className="text-[10px] text-gray-400 block mt-0.5">
              Mejor TP vs Peor SL
            </span>
          </div>

        </div>

        {/* Curva de Capital Acumulado SVG con Horas y Tiempo Transcurrido */}
        {equityPoints.length > 1 ? (
          <div className="mt-4 p-4 bg-gray-950 rounded-xl border border-gray-800 relative">
            {/* Cabecera de la Curva con Lapso Total desde Punto Cero */}
            <div className="flex flex-wrap items-center justify-between gap-2 px-1 mb-3">
              <div className="flex items-center gap-2">
                <span className="text-xs font-bold text-gray-200 flex items-center gap-1.5">
                  <span>📈 Curva de Crecimiento de Capital</span>
                  <Tooltip title="Curva de Crecimiento de Capital" text="Muestra la evolución cronológica del capital desde la apertura de la primera posición (Punto Cero) hasta cada cierre registrado." />
                </span>
                <span className="bg-slate-800 text-slate-300 text-[11px] px-2 py-0.5 rounded font-mono font-semibold">
                  {filteredTrades.length} {filteredTrades.length === 1 ? 'cierre' : 'cierres'}
                </span>
              </div>

              <div className="flex flex-wrap items-center gap-2 text-xs font-mono">
                {/* Lapso de tiempo transcurrido desde Punto Cero hasta el último cierre */}
                <div className="flex items-center gap-1.5 bg-slate-900/90 border border-slate-700/80 px-2.5 py-1 rounded-lg shadow-sm">
                  <span className="text-amber-400 font-bold">⏱️ Lapso Total:</span>
                  <span className="text-white font-black">{totalSessionElapsedStr}</span>
                  <span className="text-slate-400 text-[10px] hidden sm:inline">(Punto Cero ➔ Último)</span>
                </div>

                <div className="flex items-center gap-1.5 bg-slate-900/90 border border-slate-700/80 px-2.5 py-1 rounded-lg shadow-sm">
                  <span className="text-slate-400">Total Acumulado:</span>
                  <span className={`font-black ${netPnL >= 0 ? 'text-emerald-400' : 'text-rose-400'}`}>
                    {netPnL >= 0 ? `+${netPnL.toFixed(4)}` : netPnL.toFixed(4)} USDT
                  </span>
                </div>
              </div>
            </div>

            {/* Inspector Interactivo del Punto / Cierre Seleccionado (Al tocar o pasar el cursor) */}
            {inspectedEquityPoint && (
              <div className="mb-3 p-3 bg-slate-900/95 rounded-xl border border-slate-700 shadow-lg transition-all animate-fadeIn">
                <div className="flex flex-wrap items-center justify-between gap-2 border-b border-slate-800 pb-2 mb-2">
                  <div className="flex items-center gap-2">
                    <span className={`px-2 py-0.5 rounded text-[11px] font-mono font-bold ${
                      inspectedEquityPoint.isPuntoCero 
                        ? 'bg-amber-500/20 text-amber-300 border border-amber-500/40' 
                        : 'bg-sky-500/20 text-sky-300 border border-sky-500/40'
                    }`}>
                      {inspectedEquityPoint.isPuntoCero ? '🎯 PUNTO CERO' : `📍 CIERRE #${inspectedEquityPoint.index}`}
                    </span>
                    <span className="text-xs font-bold text-white font-mono">
                      {inspectedEquityPoint.isPuntoCero ? 'Apertura de la Primera Posición (Punto de Referencia)' : `${inspectedEquityPoint.symbol} (${inspectedEquityPoint.side})`}
                    </span>
                  </div>
                  <div className="flex items-center gap-2 text-xs">
                    <span className="text-slate-300 font-mono text-[11px]">📅 {inspectedEquityPoint.fullDateTime}</span>
                    <span className="bg-slate-800 text-amber-300 px-2 py-0.5 rounded font-mono font-bold text-[11px] border border-slate-700">
                      ⏱️ {inspectedEquityPoint.isPuntoCero ? 'Inicio (0s)' : `+${inspectedEquityPoint.elapsedStr} desde Punto Cero`}
                    </span>
                  </div>
                </div>

                <div className="grid grid-cols-2 sm:grid-cols-4 gap-2 text-xs font-mono">
                  {/* Resultado del cierre */}
                  <div className="p-2 bg-slate-950/70 rounded-lg border border-slate-800/80">
                    <span className="text-[10px] text-slate-400 uppercase tracking-wider block">PnL del Cierre</span>
                    <span className={`text-sm font-black ${inspectedEquityPoint.isPuntoCero ? 'text-slate-400' : (inspectedEquityPoint.pnl >= 0 ? 'text-emerald-400' : 'text-rose-400')}`}>
                      {inspectedEquityPoint.isPuntoCero ? '0.0000 USDT' : `${inspectedEquityPoint.pnl >= 0 ? '+' : ''}${inspectedEquityPoint.pnl.toFixed(4)} USDT`}
                    </span>
                  </div>

                  {/* Capital Acumulado */}
                  <div className="p-2 bg-slate-950/70 rounded-lg border border-slate-800/80">
                    <span className="text-[10px] text-slate-400 uppercase tracking-wider block">Capital Acumulado</span>
                    <span className={`text-sm font-black ${inspectedEquityPoint.cumulative >= 0 ? 'text-emerald-400' : 'text-rose-400'}`}>
                      {inspectedEquityPoint.cumulative >= 0 ? '+' : ''}${inspectedEquityPoint.cumulative.toFixed(4)} USDT
                    </span>
                  </div>

                  {/* Diferencia vs Cierre Anterior */}
                  <div className="p-2 bg-slate-950/70 rounded-lg border border-slate-800/80">
                    <span className="text-[10px] text-slate-400 uppercase tracking-wider block">Diferencia vs Anterior</span>
                    <span className={`text-sm font-black ${inspectedEquityPoint.isPuntoCero ? 'text-slate-400' : (inspectedEquityPoint.diffUSDT >= 0 ? 'text-emerald-400' : 'text-rose-400')}`}>
                      {inspectedEquityPoint.isPuntoCero ? 'Base Inicial (0.00)' : `${inspectedEquityPoint.diffUSDT >= 0 ? '+' : ''}${inspectedEquityPoint.diffUSDT.toFixed(4)} USDT`}
                    </span>
                  </div>

                  {/* % Crecimiento / Bajada */}
                  <div className="p-2 bg-slate-950/70 rounded-lg border border-slate-800/80">
                    <span className="text-[10px] text-slate-400 uppercase tracking-wider block">% Rendimiento vs Anterior</span>
                    {inspectedEquityPoint.isPuntoCero ? (
                      <span className="text-xs text-slate-400 font-bold">Punto 0.00%</span>
                    ) : (
                      <span className={`text-sm font-black inline-flex items-center gap-1 ${inspectedEquityPoint.diffUSDT >= 0 ? 'text-emerald-400' : 'text-rose-400'}`}>
                        <span>{inspectedEquityPoint.diffUSDT >= 0 ? '▲ Crecimiento:' : '▼ Bajada:'}</span>
                        <span>{inspectedEquityPoint.diffUSDT >= 0 ? '+' : ''}{inspectedEquityPoint.diffPercent.toFixed(2)}%</span>
                      </span>
                    )}
                  </div>
                </div>
              </div>
            )}

            {/* Gráfico SVG con Eje X de Horas y Guía Interactiva */}
            <div className="w-full overflow-x-auto">
              <svg viewBox={`0 0 ${svgWidth} ${svgHeight}`} className="w-full h-auto max-h-64 select-none">
                <defs>
                  <linearGradient id="equityGradient" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="0%" stopColor="#10b981" stopOpacity="0.40" />
                    <stop offset="100%" stopColor="#10b981" stopOpacity="0.0" />
                  </linearGradient>
                </defs>

                {/* Línea horizontal en Y = 0 */}
                <line
                  x1={padding.left}
                  y1={zeroY}
                  x2={svgWidth - padding.right}
                  y2={zeroY}
                  stroke="#475569"
                  strokeDasharray="4 4"
                  strokeWidth="1.5"
                />

                {/* Área bajo la curva */}
                {areaPath && (
                  <path d={areaPath} fill="url(#equityGradient)" />
                )}

                {/* Línea de evolución de capital */}
                {linePath && (
                  <path
                    d={linePath}
                    fill="none"
                    stroke={netPnL >= 0 ? '#10b981' : '#f43f5e'}
                    strokeWidth="2.5"
                    strokeLinecap="round"
                    strokeLinejoin="round"
                  />
                )}

                {/* Eje horizontal de tiempo (base del gráfico) */}
                <line
                  x1={padding.left}
                  y1={svgHeight - padding.bottom}
                  x2={svgWidth - padding.right}
                  y2={svgHeight - padding.bottom}
                  stroke="#334155"
                  strokeWidth="1"
                />

                {/* Ticks y Horas de cada cierre a lo largo del eje X */}
                {xAxisTicks.map(({ point: pt, index: idx }) => (
                  <g key={`tick-${idx}`}>
                    <line
                      x1={getX(idx)}
                      y1={svgHeight - padding.bottom}
                      x2={getX(idx)}
                      y2={svgHeight - padding.bottom + 5}
                      stroke="#475569"
                      strokeWidth="1"
                    />
                    <text
                      x={getX(idx)}
                      y={svgHeight - padding.bottom + 17}
                      fill="#94a3b8"
                      fontSize="10"
                      textAnchor="middle"
                      fontFamily="monospace"
                    >
                      {pt.time}
                    </text>
                  </g>
                ))}

                {/* Línea guía vertical y distintivo de hora para el punto inspeccionado */}
                {inspectedEquityPoint && (
                  <g>
                    <line
                      x1={getX(activeEquityIndex)}
                      y1={padding.top}
                      x2={getX(activeEquityIndex)}
                      y2={svgHeight - padding.bottom}
                      stroke="#38bdf8"
                      strokeWidth="1.5"
                      strokeDasharray="3 3"
                      opacity="0.85"
                    />
                    {/* Badge destacado de hora bajo el eje */}
                    <rect
                      x={getX(activeEquityIndex) - 24}
                      y={svgHeight - padding.bottom + 23}
                      width="48"
                      height="17"
                      rx="4"
                      fill="#0284c7"
                      opacity="0.95"
                    />
                    <text
                      x={getX(activeEquityIndex)}
                      y={svgHeight - padding.bottom + 35}
                      fill="#ffffff"
                      fontSize="10"
                      fontWeight="bold"
                      textAnchor="middle"
                      fontFamily="monospace"
                    >
                      {inspectedEquityPoint.time}
                    </text>
                  </g>
                )}

                {/* Puntos de Cierre interactivos */}
                {equityPoints.map((pt, i) => {
                  const isSelected = i === activeEquityIndex;
                  const isZero = pt.isPuntoCero;
                  return (
                    <g
                      key={`point-${i}`}
                      className="cursor-pointer"
                      onClick={() => setSelectedEquityIndex(i)}
                      onTouchStart={() => setSelectedEquityIndex(i)}
                      onMouseEnter={() => setSelectedEquityIndex(i)}
                    >
                      {/* Target táctil amplio e invisible para facilitar pulsar en pantallas móviles */}
                      <circle
                        cx={getX(i)}
                        cy={getY(pt.cumulative)}
                        r={16}
                        fill="transparent"
                      />
                      {/* Resalte del punto seleccionado */}
                      {isSelected && (
                        <circle
                          cx={getX(i)}
                          cy={getY(pt.cumulative)}
                          r={8}
                          fill="none"
                          stroke="#38bdf8"
                          strokeWidth="2.5"
                          opacity="0.8"
                        />
                      )}
                      {/* Círculo del punto */}
                      <circle
                        cx={getX(i)}
                        cy={getY(pt.cumulative)}
                        r={isSelected ? 6 : (isZero ? 4.5 : (equityPoints.length > 50 ? 2.5 : 4))}
                        fill={isZero ? '#fbbf24' : (pt.pnl >= 0 ? '#10b981' : '#f43f5e')}
                        stroke={isSelected ? '#38bdf8' : '#0f172a'}
                        strokeWidth={isSelected ? 2.5 : 1.5}
                      />
                      <title>{`${pt.label} (${pt.symbol}): ${pt.isPuntoCero ? 'Inicio 0.00' : (pt.pnl >= 0 ? '+' : '') + pt.pnl.toFixed(4)} USDT | Hora: ${pt.time}`}</title>
                    </g>
                  );
                })}

                {/* Etiquetas de valores de escala Y */}
                <text x={padding.left - 8} y={getY(maxEquity) + 4} fill="#94a3b8" fontSize="10" textAnchor="end">
                  +{maxEquity.toFixed(2)}
                </text>
                <text x={padding.left - 8} y={zeroY + 4} fill="#cbd5e1" fontSize="10" textAnchor="end">
                  0.00
                </text>
                {minEquity < 0 && (
                  <text x={padding.left - 8} y={getY(minEquity) + 4} fill="#f87171" fontSize="10" textAnchor="end">
                    {minEquity.toFixed(2)}
                  </text>
                )}
              </svg>
            </div>
            
            {/* Pie del Gráfico con Guía de Uso */}
            <div className="mt-2 text-center text-[11px] text-gray-500 flex items-center justify-center gap-2">
              <span>👆 Toca o pasa el cursor sobre cualquier punto para ver el detalle de ese cierre y su rendimiento.</span>
            </div>
          </div>
        ) : (
          <div className="py-8 text-center bg-gray-50 dark:bg-gray-800/40 rounded-xl border border-dashed border-gray-300 dark:border-gray-700">
            <p className="text-sm font-semibold text-gray-600 dark:text-gray-300">
              {totalTrades === 0 ? 'No hay operaciones cerradas registradas todavía.' : 'Se necesita al menos 1 operación cerrada para graficar la curva.'}
            </p>
            <p className="text-xs text-gray-400 mt-1">
              En cuanto el bot abra y cierre sus primeros trades, la curva de capital y el tiempo transcurrido desde el punto cero se actualizarán en tiempo real.
            </p>
          </div>
        )}

      </div>

      {/* ======================================================== */}
      {/* 3. RANKING Y RENDIMIENTO: POR MONEDA O POR ESTRATEGIA   */}
      {/* ======================================================== */}
      <div className="bg-white dark:bg-gray-900 border border-gray-200 dark:border-gray-800 rounded-2xl shadow-lg p-5 transition-all">
        
        {/* Cabecera del Ranking con Selector de Modo y Ordenamiento */}
        <div className="flex flex-col lg:flex-row lg:items-center justify-between gap-4 pb-4 border-b border-gray-200 dark:border-gray-800">
          <div className="flex items-center space-x-3">
            <div className={`p-2.5 rounded-xl ${rankingViewMode === 'STRATEGIES' ? 'bg-purple-500/20 text-purple-400' : 'bg-blue-500/20 text-blue-400'}`}>
              <span className="text-2xl">{rankingViewMode === 'STRATEGIES' ? '🧠' : '📊'}</span>
            </div>
            <div>
              <div className="flex items-center gap-2 flex-wrap">
                <h3 className="text-base font-bold text-gray-900 dark:text-white flex items-center gap-2">
                  <span>{rankingViewMode === 'STRATEGIES' ? 'Torneo de Rendimiento por Estrategia' : 'Ranking de Rendimiento por Criptomoneda'}</span>
                  <Tooltip 
                    title={rankingViewMode === 'STRATEGIES' ? 'Torneo de Estrategias en Vivo' : 'Rendimiento Individual por Moneda'} 
                    text={rankingViewMode === 'STRATEGIES' 
                      ? 'Comparativa en vivo de las distintas estrategias activadas. Analiza cuál genera mayor PnL neto, mejor tasa de aciertos (Win Rate) y consistencia en el mercado.' 
                      : 'Desglose detallado del PnL, tasa de acierto y volumen de cada par para identificar qué monedas aportan más a la cuenta y cuáles convendría pausar o ajustar.'
                    } 
                  />
                  <span className="text-xs font-normal text-gray-400">
                    ({rankingViewMode === 'STRATEGIES' ? `${strategyPerformanceList.length} estrategias` : `${coinPerformanceList.length} pares`})
                  </span>
                </h3>
              </div>
              <p className="text-xs text-gray-500 dark:text-gray-400 mt-0.5">
                {rankingViewMode === 'STRATEGIES'
                  ? 'Compara el desempeño entre estrategias para descubrir cuál es la más rentable y consistente en Binance Testnet.'
                  : 'Compara qué monedas son las más rentables y cuáles generan pérdidas para optimizar tu cesta de trading.'
                }
              </p>
            </div>
          </div>

          {/* Selector de Modo (Moneda vs Estrategia) + Selector de Orden */}
          <div className="flex flex-wrap items-center gap-2">
            {/* Pestañas de Vista */}
            <div className="flex items-center bg-gray-100 dark:bg-gray-800 p-1 rounded-xl border border-gray-200 dark:border-gray-700">
              <button
                type="button"
                onClick={() => setRankingViewMode('COINS')}
                className={`px-3 py-1 rounded-lg text-xs font-bold transition flex items-center gap-1.5 ${
                  rankingViewMode === 'COINS'
                    ? 'bg-blue-600 text-white shadow'
                    : 'text-gray-500 dark:text-gray-400 hover:text-white'
                }`}
              >
                <span>🪙</span> Por Moneda
              </button>
              <button
                type="button"
                onClick={() => setRankingViewMode('STRATEGIES')}
                className={`px-3 py-1 rounded-lg text-xs font-bold transition flex items-center gap-1.5 ${
                  rankingViewMode === 'STRATEGIES'
                    ? 'bg-gradient-to-r from-purple-600 to-indigo-600 text-white shadow'
                    : 'text-gray-500 dark:text-gray-400 hover:text-white'
                }`}
              >
                <span>🧠</span> Torneo por Estrategia
              </button>
            </div>

            {/* Botones de Ordenamiento */}
            <div className="flex flex-wrap items-center gap-1 bg-gray-100 dark:bg-gray-800 p-1 rounded-xl border border-gray-200 dark:border-gray-700">
              <span className="text-[11px] font-bold text-gray-400 px-1.5">Orden:</span>
              
              <button
                type="button"
                onClick={() => setCoinSortOrder('PNL_DESC')}
                className={`px-2 py-1 rounded-lg text-xs font-bold transition flex items-center gap-1 ${
                  coinSortOrder === 'PNL_DESC'
                    ? 'bg-emerald-600 text-white shadow'
                    : 'text-gray-400 hover:text-white hover:bg-gray-700/50'
                }`}
                title="Ordenar de mayor a menor ganancia (Top Ganadoras primero)"
              >
                <span>⬇️</span> Mayor PnL
              </button>

              <button
                type="button"
                onClick={() => setCoinSortOrder('PNL_ASC')}
                className={`px-2 py-1 rounded-lg text-xs font-bold transition flex items-center gap-1 ${
                  coinSortOrder === 'PNL_ASC'
                    ? 'bg-rose-600 text-white shadow'
                    : 'text-gray-400 hover:text-white hover:bg-gray-700/50'
                }`}
                title="Ordenar de menor a mayor ganancia (Mayores Pérdidas primero)"
              >
                <span>⬆️</span> Menor PnL
              </button>

              <button
                type="button"
                onClick={() => setCoinSortOrder('WINRATE_DESC')}
                className={`px-2 py-1 rounded-lg text-xs font-bold transition ${
                  coinSortOrder === 'WINRATE_DESC'
                    ? 'bg-blue-600 text-white shadow'
                    : 'text-gray-400 hover:text-white hover:bg-gray-700/50'
                }`}
                title="Ordenar por mayor tasa de acierto (%)"
              >
                🎯 Win Rate
              </button>

              <button
                type="button"
                onClick={() => setCoinSortOrder('TRADES_DESC')}
                className={`px-2 py-1 rounded-lg text-xs font-bold transition ${
                  coinSortOrder === 'TRADES_DESC'
                    ? 'bg-purple-600 text-white shadow'
                    : 'text-gray-400 hover:text-white hover:bg-gray-700/50'
                }`}
                title="Ordenar por cantidad de operaciones"
              >
                🔢 Trades
              </button>
            </div>
          </div>
        </div>

        {/* VISTA 1: RANKING POR CRIPTOMONEDA */}
        {rankingViewMode === 'COINS' && (
          coinPerformanceList.length > 0 ? (
            <div className="mt-4 space-y-3">
              {coinPerformanceList.map((coin, index) => {
                const isProfit = coin.totalPnL >= 0;
                const barWidthPercent = Math.min(100, Math.max(8, (Math.abs(coin.totalPnL) / maxAbsCoinPnL) * 100));

                return (
                  <div
                    key={coin.symbol}
                    className={`p-3 rounded-xl border transition-all hover:border-gray-600 ${
                      filterSymbol === coin.symbol 
                        ? 'bg-indigo-950/40 border-indigo-500/60 shadow-md' 
                        : 'bg-gray-50 dark:bg-gray-800/40 border-gray-200 dark:border-gray-800'
                    }`}
                  >
                    <div className="flex flex-wrap items-center justify-between gap-2 mb-2">
                      
                      {/* Identificación de la moneda */}
                      <div className="flex items-center space-x-2.5">
                        <span className="w-6 h-6 rounded-lg bg-gray-200 dark:bg-gray-700 text-gray-700 dark:text-gray-200 font-bold text-xs flex items-center justify-center font-mono">
                          #{index + 1}
                        </span>
                        <span className="text-sm font-bold text-gray-900 dark:text-white font-mono">
                          {coin.symbol}
                        </span>
                        <span className="text-[11px] px-2 py-0.5 rounded-full font-bold bg-gray-200 dark:bg-gray-700/60 text-gray-600 dark:text-gray-300">
                          {coin.tradesCount} {coin.tradesCount === 1 ? 'operación' : 'operaciones'}
                        </span>
                        <span className={`text-[11px] px-2 py-0.5 rounded-full font-bold ${
                          parseFloat(coin.winRate) >= 50 ? 'bg-emerald-950 text-emerald-300 border border-emerald-800/60' : 'bg-amber-950 text-amber-300 border border-amber-800/60'
                        }`}>
                          Win Rate: {coin.winRate}% ({coin.wins}W / {coin.losses}L)
                        </span>
                      </div>

                      {/* Ganancia y Botón de Filtro */}
                      <div className="flex items-center space-x-3">
                        <div className="text-right">
                          <span className={`text-base font-extrabold font-mono ${isProfit ? 'text-emerald-400' : 'text-rose-400'}`}>
                            {isProfit ? `+${coin.totalPnL.toFixed(4)}` : coin.totalPnL.toFixed(4)} <span className="text-xs">USDT</span>
                          </span>
                          <div className="text-[10px] text-gray-400 flex items-center justify-end gap-1 font-mono">
                            <span>Max: +{coin.bestTrade.toFixed(2)}</span>
                            <span>•</span>
                            <span>Min: {coin.worstTrade.toFixed(2)}</span>
                          </div>
                        </div>

                        <button
                          type="button"
                          onClick={() => setFilterSymbol(filterSymbol === coin.symbol ? 'ALL' : coin.symbol)}
                          className={`text-[11px] px-2.5 py-1 rounded-lg font-semibold transition ${
                            filterSymbol === coin.symbol
                              ? 'bg-indigo-600 text-white shadow'
                              : 'bg-gray-200 dark:bg-gray-700 hover:bg-gray-300 dark:hover:bg-gray-600 text-gray-700 dark:text-gray-300'
                          }`}
                          title={filterSymbol === coin.symbol ? 'Quitar filtro' : `Filtrar solo trades de ${coin.symbol}`}
                        >
                          {filterSymbol === coin.symbol ? '✓ Filtrado' : '🔍 Filtrar'}
                        </button>
                      </div>

                    </div>

                    {/* Gráfico de Barras por Trade Cerrado (Eje Cero con Ganancias Arriba y Pérdidas Abajo) */}
                    {renderTradeSequenceChart(coin.trades, coin.symbol)}

                  </div>
                );
              })}
            </div>
          ) : (
            <div className="py-6 text-center text-gray-400 text-xs">
              No hay operaciones cerradas para generar el ranking por moneda.
            </div>
          )
        )}

        {/* VISTA 2: TORNEO POR ESTRATEGIA */}
        {rankingViewMode === 'STRATEGIES' && (
          strategyPerformanceList.length > 0 ? (
            <div className="mt-4 space-y-3">
              {/* Cuadro de Coherencia Matemática y Resumen del Torneo */}
              <div className="grid grid-cols-1 md:grid-cols-3 gap-3 p-3.5 bg-slate-950/80 rounded-xl border border-slate-800 shadow-inner">
                <div className="flex items-center justify-between p-2.5 bg-emerald-950/40 border border-emerald-500/30 rounded-lg">
                  <div>
                    <div className="text-[11px] text-emerald-400 font-bold uppercase tracking-wider flex items-center gap-1">
                      <span>🏆 Ganadoras ({tournamentBreakdown.winningStratsCount})</span>
                    </div>
                    <div className="text-[10px] text-slate-400">Total acumulado en profit</div>
                  </div>
                  <div className="text-right">
                    <div className="text-base font-mono font-black text-emerald-400">
                      +{tournamentBreakdown.winningStrategiesSum.toFixed(4)} USDT
                    </div>
                  </div>
                </div>

                <div className="flex items-center justify-between p-2.5 bg-rose-950/40 border border-rose-500/30 rounded-lg">
                  <div>
                    <div className="text-[11px] text-rose-400 font-bold uppercase tracking-wider flex items-center gap-1">
                      <span>🔻 En Drawdown / Previas ({tournamentBreakdown.losingStratsCount})</span>
                    </div>
                    <div className="text-[10px] text-slate-400">Total en pérdida neta</div>
                  </div>
                  <div className="text-right">
                    <div className="text-base font-mono font-black text-rose-400">
                      {tournamentBreakdown.losingStrategiesSum.toFixed(4)} USDT
                    </div>
                  </div>
                </div>

                <div className="flex items-center justify-between p-2.5 bg-cyan-950/40 border border-cyan-500/30 rounded-lg">
                  <div>
                    <div className="text-[11px] text-cyan-400 font-bold uppercase tracking-wider flex items-center gap-1">
                      <span>📊 PnL Neto Consolidado</span>
                    </div>
                    <div className="text-[10px] text-slate-400">Ganadoras + Pérdidas</div>
                  </div>
                  <div className="text-right">
                    <div className={`text-base font-mono font-black ${tournamentBreakdown.netStrategiesSum >= 0 ? 'text-cyan-400' : 'text-rose-400'}`}>
                      {tournamentBreakdown.netStrategiesSum >= 0 ? `+${tournamentBreakdown.netStrategiesSum.toFixed(4)}` : tournamentBreakdown.netStrategiesSum.toFixed(4)} USDT
                    </div>
                  </div>
                </div>
              </div>

              {strategyPerformanceList.map((strat, index) => {
                const isProfit = strat.totalPnL >= 0;
                const barWidthPercent = Math.min(100, Math.max(8, (Math.abs(strat.totalPnL) / maxAbsStrategyPnL) * 100));
                const medal = index === 0 ? '🥇' : index === 1 ? '🥈' : index === 2 ? '🥉' : null;

                return (
                  <div
                    key={strat.strategy}
                    className="p-3.5 rounded-xl border bg-gray-50 dark:bg-gray-800/40 border-gray-200 dark:border-gray-800 transition-all hover:border-purple-500/50 shadow-sm"
                  >
                    <div className="flex flex-wrap items-center justify-between gap-2 mb-2">
                      
                      {/* Identificación y Medalla de la Estrategia */}
                      <div className="flex flex-wrap items-center gap-2">
                        <span className="w-7 h-7 rounded-lg bg-gray-200 dark:bg-gray-700 text-gray-700 dark:text-gray-200 font-bold text-xs flex items-center justify-center font-mono">
                          {medal ? medal : `#${index + 1}`}
                        </span>
                        <span className="text-sm font-extrabold text-gray-900 dark:text-purple-300 font-mono flex items-center gap-1.5">
                          <span>🧠</span> {strat.strategy}
                        </span>
                        <span className="text-[11px] px-2 py-0.5 rounded-full font-bold bg-gray-200 dark:bg-gray-700/60 text-gray-600 dark:text-gray-300">
                          {strat.tradesCount} {strat.tradesCount === 1 ? 'operación' : 'operaciones'}
                        </span>
                        <span className={`text-[11px] px-2 py-0.5 rounded-full font-bold ${
                          parseFloat(strat.winRate) >= 50 
                            ? 'bg-emerald-950 text-emerald-300 border border-emerald-800/60' 
                            : 'bg-amber-950 text-amber-300 border border-amber-800/60'
                        }`}>
                          Win Rate: {strat.winRate}% ({strat.wins}W / {strat.losses}L)
                        </span>

                        {/* Monedas operadas con esta estrategia */}
                        {strat.symbolsList && strat.symbolsList.length > 0 && (
                          <div className="flex items-center gap-1 ml-1 flex-wrap">
                            <span className="text-[10px] text-gray-400 font-medium">Pares:</span>
                            {strat.symbolsList.map(sym => (
                              <span key={sym} className="text-[10px] px-1.5 py-0.5 rounded bg-indigo-950/60 text-indigo-300 border border-indigo-800/40 font-mono font-bold">
                                {sym}
                              </span>
                            ))}
                          </div>
                        )}
                      </div>

                      {/* Ganancia Total de la Estrategia y Botón de Filtrado */}
                      <div className="flex items-center space-x-3">
                        <div className="text-right">
                          <span className={`text-base font-extrabold font-mono ${isProfit ? 'text-emerald-400' : 'text-rose-400'}`}>
                            {isProfit ? `+${strat.totalPnL.toFixed(4)}` : strat.totalPnL.toFixed(4)} <span className="text-xs">USDT</span>
                          </span>
                          <div className="text-[10px] text-gray-400 flex items-center justify-end gap-1 font-mono">
                            <span>Max: +{strat.bestTrade.toFixed(2)}</span>
                            <span>•</span>
                            <span>Min: {strat.worstTrade.toFixed(2)}</span>
                          </div>
                        </div>

                        <button
                          type="button"
                          onClick={() => setFilterStrategy(filterStrategy === strat.strategy ? 'ALL' : strat.strategy)}
                          className={`text-[11px] px-2.5 py-1 rounded-lg font-semibold transition ${
                            filterStrategy === strat.strategy
                              ? 'bg-purple-600 text-white shadow'
                              : 'bg-gray-200 dark:bg-gray-700 hover:bg-gray-300 dark:hover:bg-gray-600 text-gray-700 dark:text-gray-300'
                          }`}
                          title={filterStrategy === strat.strategy ? 'Quitar filtro' : `Filtrar KPIs y curva solo de ${strat.strategy}`}
                        >
                          {filterStrategy === strat.strategy ? '✓ Filtrado' : '🔍 Filtrar'}
                        </button>
                      </div>

                    </div>

                    {/* Gráfico de Barras por Trade Cerrado (Eje Cero con Ganancias Arriba y Pérdidas Abajo) */}
                    {renderTradeSequenceChart(strat.trades, strat.strategy)}

                  </div>
                );
              })}
            </div>
          ) : (
            <div className="py-6 text-center text-gray-400 text-xs">
              No hay operaciones registradas con información de estrategia aún. En cuanto el bot ejecute trades con una estrategia activa, aparecerán aquí en vivo.
            </div>
          )
        )}

      </div>

      {/* ======================================================== */}
      {/* 4. DONUT DE ASIGNACIÓN DE CARTERA */}
      {/* ======================================================== */}
      <div className="bg-white dark:bg-gray-900 border border-gray-200 dark:border-gray-800 rounded-2xl shadow-lg p-5 transition-all">
        <div className="flex items-center space-x-2.5 pb-3 border-b border-gray-200 dark:border-gray-800">
          <div className="p-2 bg-yellow-400/20 text-yellow-500 rounded-lg">
            <span className="text-xl">🍩</span>
          </div>
          <div>
            <h3 className="text-base font-bold text-gray-900 dark:text-white">
              Distribución de Margen y Exposición de Cartera en Posición
            </h3>
            <p className="text-xs text-gray-500 dark:text-gray-400">
              Visualiza en tiempo real qué porcentaje de tu capital está colocado en cada moneda abierta.
            </p>
          </div>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-2 gap-6 items-center mt-4">
          <div className="flex justify-center items-center relative">
            <svg viewBox="0 0 160 160" className="w-44 h-44 transform -rotate-90">
              <circle cx="80" cy="80" r="60" fill="transparent" stroke="#1e293b" strokeWidth="24" />
              
              {portfolioDonutData.slices.length > 0 ? (
                (() => {
                  let accumulatedPercent = 0;
                  const total = portfolioDonutData.slices.reduce((a, b) => a + b.margin, 0);
                  const circumference = 2 * Math.PI * 60;
                  
                  return portfolioDonutData.slices.map((slice, idx) => {
                    const pct = total > 0 ? (slice.margin / total) : 0;
                    const strokeDasharray = `${pct * circumference} ${circumference}`;
                    const strokeDashoffset = -accumulatedPercent * circumference;
                    accumulatedPercent += pct;

                    return (
                      <circle
                        key={idx}
                        cx="80"
                        cy="80"
                        r="60"
                        fill="transparent"
                        stroke={slice.color}
                        strokeWidth="24"
                        strokeDasharray={strokeDasharray}
                        strokeDashoffset={strokeDashoffset}
                        className="transition-all duration-500"
                      />
                    );
                  });
                })()
              ) : (
                <circle cx="80" cy="80" r="60" fill="transparent" stroke="#10b981" strokeWidth="24" opacity="0.4" />
              )}
            </svg>

            <div className="absolute flex flex-col items-center justify-center text-center pointer-events-none">
              <span className="text-xs text-gray-400 font-semibold uppercase">Posiciones</span>
              <span className="text-xl font-extrabold text-white font-mono">
                {portfolioDonutData.totalPositions}
              </span>
              <span className="text-[10px] text-emerald-400 font-mono">
                {portfolioDonutData.totalPositions > 0 ? 'Activas' : 'Esperando'}
              </span>
            </div>
          </div>

          <div className="space-y-2.5">
            <h4 className="text-xs font-bold text-gray-400 uppercase tracking-wider mb-2">
              Desglose de Monedas en Posición:
            </h4>
            {portfolioDonutData.slices.length > 0 ? (
              <div className="grid grid-cols-2 gap-2">
                {portfolioDonutData.slices.map((slice, i) => (
                  <div key={i} className="flex items-center space-x-2 bg-gray-50 dark:bg-gray-800/60 p-2 rounded-lg border border-gray-200 dark:border-gray-700/60">
                    <span className="w-3 h-3 rounded-full flex-shrink-0" style={{ backgroundColor: slice.color }} />
                    <div className="min-w-0">
                      <span className="text-xs font-bold text-gray-900 dark:text-white truncate block font-mono">{slice.symbol}</span>
                      <span className="text-[10px] text-gray-400 block font-mono">Margen: ~{slice.margin.toFixed(0)} USDT</span>
                    </div>
                  </div>
                ))}
              </div>
            ) : (
              <p className="text-xs text-gray-500 py-4">
                Actualmente no hay posiciones abiertas. El 100% de tu saldo está libre en USDT.
              </p>
            )}

            <div className="pt-3 border-t border-gray-200 dark:border-gray-800 flex items-center justify-between text-xs">
              <span className="text-gray-500 dark:text-gray-400">🛡️ Estado de Billetera:</span>
              <span className="font-bold text-emerald-500 font-mono">
                ${freeMarginNum.toFixed(2)} USDT LIBRE
              </span>
            </div>
          </div>
        </div>
      </div>

      {/* --- SECCIÓN HISTORIAL GENERAL DE TRADES CERRADOS (TODOS LOS PARES) --- */}
      <div id="historial-trades-general" className="mt-8 pt-6 border-t border-gray-200 dark:border-gray-800 scroll-mt-6">
        <div className="flex flex-wrap items-center justify-between gap-3 mb-4">
          <button
            onClick={() => setShowAllClosedTrades(!showAllClosedTrades)}
            className="flex items-center gap-2.5 px-4 py-2.5 rounded-xl bg-slate-900 hover:bg-slate-800 text-slate-100 font-extrabold text-xs border border-slate-700/80 shadow-lg transition-all duration-200 cursor-pointer"
          >
            <span className="text-base">{showAllClosedTrades ? '📂' : '📜'}</span>
            <span>{showAllClosedTrades ? 'Ocultar Historial General de Trades' : 'Ver ÚLTIMOS TRADES CERRADOS EN GENERAL (Todos los pares)'}</span>
            <span className="ml-1.5 px-2 py-0.5 rounded-full bg-amber-500/20 text-amber-300 font-mono text-[11px] border border-amber-500/30">
              {sortedGlobalTrades.length} trades
            </span>
            <span className="text-slate-400 text-xs ml-1">{showAllClosedTrades ? '▲' : '▼'}</span>
          </button>

          {showAllClosedTrades && (
            <div className="flex items-center gap-3 text-xs font-mono">
              <div className="flex items-center gap-1.5 text-slate-300">
                <span>Mostrar:</span>
                <select
                  value={globalTradeLimit}
                  onChange={(e) => setGlobalTradeLimit(e.target.value)}
                  className="px-2.5 py-1 rounded-lg bg-slate-900 border border-slate-700 text-amber-400 font-bold focus:outline-none focus:border-amber-500 cursor-pointer"
                >
                  <option value={20}>20 trades</option>
                  <option value={50}>50 trades</option>
                  <option value={100}>100 trades</option>
                  <option value={500}>500 trades</option>
                  <option value="ALL">Todos ({sortedGlobalTrades.length})</option>
                </select>
              </div>
              <span className="text-slate-400 hidden sm:inline">•</span>
              <span className="text-slate-400 text-[11px] hidden sm:inline">Auto-actualizado en vivo</span>
            </div>
          )}
        </div>

        {showAllClosedTrades && (
          <div className="bg-slate-950 border border-slate-800 rounded-2xl p-4 shadow-2xl overflow-hidden">
            <div className="flex items-center justify-between gap-2 mb-3 pb-2 border-b border-slate-800">
              <div className="flex items-center gap-2 text-xs font-bold text-slate-200">
                <span>📊</span>
                <span>HISTORIAL GENERAL DE TRADES CERRADOS</span>
                <span className="text-slate-400 font-normal">
                  (Filtro actual: {filterSymbol === 'ALL' ? 'Todos los pares' : filterSymbol} • Estrategia: {filterStrategy})
                </span>
              </div>
              <span className="text-xs text-amber-400 font-mono font-bold">
                {visibleGlobalTrades.length} / {sortedGlobalTrades.length} mostrados
              </span>
            </div>

            {sortedGlobalTrades.length > 0 ? (
              <div className="overflow-x-auto">
                <table className="min-w-full divide-y divide-slate-800 text-xs font-mono">
                  <thead className="bg-slate-900 border-b border-slate-700">
                    <tr>
                      <BinanceSortHeader label="ID" sortKey="id" currentSort={globalTradeSort} onSort={(k) => handleGlobalSort(k)} />
                      <BinanceSortHeader label="Fecha Cierre" sortKey="close_timestamp" currentSort={globalTradeSort} onSort={(k) => handleGlobalSort(k)} />
                      <BinanceSortHeader label="Símbolo" sortKey="symbol" currentSort={globalTradeSort} onSort={(k) => handleGlobalSort(k)} />
                      <BinanceSortHeader label="Lado" sortKey="trade_type" currentSort={globalTradeSort} onSort={(k) => handleGlobalSort(k)} />
                      <BinanceSortHeader label="Motivo" sortKey="close_reason" currentSort={globalTradeSort} onSort={(k) => handleGlobalSort(k)} />
                      <BinanceSortHeader label="PnL Neto" sortKey="pnl_usdt" currentSort={globalTradeSort} onSort={(k) => handleGlobalSort(k)} align="right" tooltipInfo={{ title: "PnL Neto", desc: "Ganancia o pérdida real acreditada/debitada de tu billetera de Binance." }} />
                      <BinanceSortHeader label="Entrada" sortKey="open_price" currentSort={globalTradeSort} onSort={(k) => handleGlobalSort(k)} align="right" />
                      <BinanceSortHeader label="Salida" sortKey="close_price" currentSort={globalTradeSort} onSort={(k) => handleGlobalSort(k)} align="right" />
                      <BinanceSortHeader label="Cantidad" sortKey="quantity" currentSort={globalTradeSort} onSort={(k) => handleGlobalSort(k)} align="right" />
                      <BinanceSortHeader label="Comisión" sortKey="commission_usdt" currentSort={globalTradeSort} onSort={(k) => handleGlobalSort(k)} align="right" tooltipInfo={{ title: "Comisión Binance", desc: "Comisión oficial descontada por Binance Futures en este trade (entrada + salida)." }} />
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-800">
                    {visibleGlobalTrades.map((trade) => {
                      const comm = getTradeCommission(trade);
                      const gross = getTradeGrossPnL(trade);
                      const pnlNet = getTradePnL(trade);
                      const pnlClass = pnlNet > 0 ? 'text-emerald-400 font-bold' : pnlNet < 0 ? 'text-rose-400 font-bold' : 'text-slate-300 font-bold';
                      const tradeId = trade.id || trade.binance_trade_id || '-';

                      return (
                        <tr key={trade.id || `${trade.symbol}-${trade.close_timestamp}`} className="hover:bg-slate-900/70 transition-colors">
                          <td className="px-2 py-1.5 whitespace-nowrap text-slate-400 font-bold">#{tradeId}</td>
                          <td className="px-2 py-1.5 whitespace-nowrap text-slate-300">{formatShortDate(trade.close_timestamp)}</td>
                          <td className="px-2 py-1.5 whitespace-nowrap font-bold text-white">{trade.symbol}</td>
                          <td className="px-2 py-1.5 whitespace-nowrap">
                            <span className={`px-1.5 py-0.2 rounded text-[10px] font-bold ${trade.trade_type === 'SHORT' ? 'bg-rose-950 text-rose-300 border border-rose-600/50' : 'bg-emerald-950 text-emerald-300 border border-emerald-600/50'}`}>
                              {trade.trade_type || 'LONG'}
                            </span>
                          </td>
                          <td className="px-2 py-1.5 whitespace-nowrap text-slate-300 max-w-[260px] truncate" title={trade.close_reason || 'N/A'}>
                            {trade.close_reason || 'N/A'}
                          </td>
                          <td className={`px-2 py-1.5 text-right whitespace-nowrap font-bold ${pnlClass}`} title={`PnL Bruto: ${gross >= 0 ? '+' : ''}${gross.toFixed(4)} USDT (Comisión: -${comm.toFixed(4)} USDT)`}>
                            {pnlNet >= 0 ? `+${pnlNet.toFixed(4)}` : pnlNet.toFixed(4)} USDT
                          </td>
                          <td className="px-2 py-1.5 text-right whitespace-nowrap text-white font-bold">{parseFloat(trade.open_price)?.toFixed(4) ?? 'N/A'}</td>
                          <td className="px-2 py-1.5 text-right whitespace-nowrap text-white font-bold">{parseFloat(trade.close_price)?.toFixed(4) ?? 'N/A'}</td>
                          <td className="px-2 py-1.5 text-right whitespace-nowrap text-slate-300">{parseFloat(trade.quantity)?.toFixed(4) ?? 'N/A'}</td>
                          <td className="px-2 py-1.5 text-right whitespace-nowrap text-amber-400 font-mono font-medium" title="Comisión Binance (entrada + salida)">
                            -{comm.toFixed(4)}
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>

                {/* Totales Consolidados al pie de la tabla general */}
                {(() => {
                  let totalNet = 0;
                  let totalComm = 0;
                  let totalGross = 0;
                  sortedGlobalTrades.forEach(t => {
                    const net = getTradePnL(t);
                    const c = getTradeCommission(t);
                    const g = getTradeGrossPnL(t);
                    totalNet += net;
                    totalComm += c;
                    totalGross += g;
                  });
                  const totalPnlClass = totalNet > 0 ? 'text-emerald-400 font-bold' : totalNet < 0 ? 'text-rose-400 font-bold' : 'text-slate-300 font-bold';

                  return (
                    <div className="mt-3 pt-2 border-t border-slate-800 flex flex-wrap items-center justify-between gap-3 text-xs px-2 font-mono">
                      <span className="text-slate-400">
                        Mostrando <span className="text-white font-bold">{visibleGlobalTrades.length}</span> de <span className="text-white font-bold">{sortedGlobalTrades.length}</span> trades cerrados
                      </span>
                      <div className="flex flex-wrap items-center gap-4 text-xs">
                        <span className="text-slate-400">
                          Comisiones Totales: <span className="text-amber-400 font-bold">-${totalComm.toFixed(4)} USDT</span>
                        </span>
                        <span className="text-slate-400">
                          PnL Bruto Total: <span className="text-slate-200 font-bold">{totalGross >= 0 ? `+${totalGross.toFixed(4)}` : totalGross.toFixed(4)} USDT</span>
                        </span>
                        <span className="font-bold text-slate-200">
                          Total PnL Neto Acumulado: 
                          <span className={`ml-1.5 font-bold ${totalPnlClass}`}>
                            {totalNet >= 0 ? `+${totalNet.toFixed(4)}` : totalNet.toFixed(4)} USDT
                          </span>
                        </span>
                      </div>
                    </div>
                  );
                })()}
              </div>
            ) : (
              <div className="py-8 text-center text-slate-400 text-xs font-mono">
                No hay operaciones cerradas registradas en el historial general.
              </div>
            )}
          </div>
        )}
      </div>

    </div>
  );
}

export default PnLPerformanceChart;
