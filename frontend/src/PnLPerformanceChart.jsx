import React, { useEffect, useState, useMemo } from 'react';
import Tooltip from './Tooltip';

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

  // Ordenamiento para el Gráfico de Rendimiento por Moneda o Estrategia
  // 'PNL_DESC' (Mayor a menor), 'PNL_ASC' (Menor a mayor), 'WINRATE_DESC', 'TRADES_DESC', 'ALPHA'
  const [coinSortOrder, setCoinSortOrder] = useState('PNL_DESC');
  // Modo de vista del ranking: 'COINS' (por criptomoneda) o 'STRATEGIES' (torneo por estrategia)
  const [rankingViewMode, setRankingViewMode] = useState('COINS');
  // Estado para la inspección interactiva del trade seleccionado al pasar el cursor o tocar la barra
  const [activeTradeInspector, setActiveTradeInspector] = useState(null);

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
    if (t.strategy_name && String(t.strategy_name).trim()) return String(t.strategy_name).trim();
    if (t.parameters) {
      try {
        const p = typeof t.parameters === 'string' ? JSON.parse(t.parameters) : t.parameters;
        if (p.strategy_name) return String(p.strategy_name).trim();
        if (p.active_strategy_name) return String(p.active_strategy_name).trim();
      } catch (_) {}
    }
    return 'Global';
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

  // Curva de Capital (Cumulative Equity) y Maximum Drawdown (MDD)
  const { equityPoints, maxDrawdownUSDT, maxDrawdownPercent } = useMemo(() => {
    let runningTotal = 0;
    let peak = 0;
    let maxDD = 0;

    const points = filteredTrades.map((t, idx) => {
      const pnl = getTradePnL(t);
      runningTotal += pnl;
      if (runningTotal > peak) peak = runningTotal;
      const currentDD = peak - runningTotal;
      if (currentDD > maxDD) maxDD = currentDD;

      return {
        index: idx + 1,
        symbol: t.symbol,
        pnl,
        cumulative: runningTotal,
        time: t.close_timestamp ? (() => {
          const raw = String(t.close_timestamp).trim();
          const iso = (raw.includes('T') || raw.includes('Z') || raw.includes('+'))
            ? (raw.endsWith('Z') || raw.includes('+') ? raw : raw + 'Z')
            : raw.replace(' ', 'T') + 'Z';
          const p = new Date(iso);
          return isNaN(p.getTime()) ? t.close_timestamp : p.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
        })() : `#${idx + 1}`
      };
    });

    const totalBalanceRef = riskData ? parseFloat(riskData.total_balance) || 1000 : 1000;
    const maxDDPct = totalBalanceRef > 0 ? ((maxDD / totalBalanceRef) * 100).toFixed(2) : '0.00';

    return {
      equityPoints: points,
      maxDrawdownUSDT: maxDD,
      maxDrawdownPercent: maxDDPct
    };
  }, [filteredTrades, riskData]);

  // SVG Dimensiones y Escalas
  const svgWidth = 800;
  const svgHeight = 220;
  const padding = { top: 20, right: 30, bottom: 30, left: 60 };

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
      const margin = entryPrice > 0 && qty > 0 ? (entryPrice * qty) / 10 : 25;
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

  // Cálculos de la barra de estrés de riesgo
  const totalBalanceNum = riskData ? parseFloat(riskData.total_balance) || 0 : 0;
  const currentExpNum = riskData ? parseFloat(riskData.current_exposure) || 0 : 0;
  const maxExpNum = riskData ? parseFloat(riskData.max_exposure) || 0 : 0;
  const freeMarginNum = riskData && riskData.free_margin ? parseFloat(riskData.free_margin) : Math.max(0, totalBalanceNum - currentExpNum);

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
    const barWidth = 24;
    const colSpacing = 36;
    const leftMargin = 50;
    const rightMargin = 20;
    const totalSvgWidth = Math.max(500, leftMargin + tradesList.length * colSpacing + rightMargin);
    const svgHeight = 90;
    const centerY = 45; // El centro exacto matemático donde se posa la línea base
    const maxBarHeight = 32;

    const isThisCoinInspected = activeTradeInspector && activeTradeInspector.coin === symbolOrStrat;

    return (
      <div className="mt-2.5 pt-2 border-t border-gray-200 dark:border-gray-800/80">
        
        {/* Leyenda superior y contador */}
        <div className="flex flex-wrap items-center justify-between gap-2 text-[11px] text-gray-500 dark:text-gray-400 mb-1.5 px-1 font-mono">
          <div className="flex items-center gap-3">
            <span className="flex items-center gap-1.5">
              <span className="w-2.5 h-2.5 bg-emerald-500 rounded-sm inline-block shadow-sm"></span>
              <span className="text-emerald-500 dark:text-emerald-400 font-bold text-[10px]">▲ Ganancia (Win)</span>
            </span>
            <span className="flex items-center gap-1.5">
              <span className="w-2.5 h-2.5 bg-rose-500 rounded-sm inline-block shadow-sm"></span>
              <span className="text-rose-500 dark:text-rose-400 font-bold text-[10px]">▼ Pérdida (Loss)</span>
            </span>
          </div>

          <span className="text-[10px] text-gray-400">
            {tradesList.length} {tradesList.length === 1 ? 'trade cerrado' : 'trades cerrados'} (cronológico ➔)
          </span>
        </div>

        {/* Panel Inspector Interactivo (Aparece al hacer click o pasar el cursor en cualquier trade) */}
        {isThisCoinInspected && activeTradeInspector && (
          <div className="mb-2 p-2.5 bg-slate-950 border-2 border-amber-400/80 rounded-xl flex flex-wrap items-center justify-between gap-2 shadow-2xl animate-fadeIn">
            <div className="flex items-center gap-2">
              <span className={`px-2 py-0.5 rounded text-[11px] font-black font-mono ${
                activeTradeInspector.isWin
                  ? 'bg-emerald-500/20 text-emerald-300 border border-emerald-500/50'
                  : 'bg-rose-500/20 text-rose-300 border border-rose-500/50'
              }`}>
                Trade #{activeTradeInspector.index} {activeTradeInspector.isWin ? 'WIN 🎯' : 'LOSS 🛑'}
              </span>
              <span className={`text-sm font-black font-mono ${activeTradeInspector.isWin ? 'text-emerald-400' : 'text-rose-400'}`}>
                {activeTradeInspector.isWin ? '+' : ''}${activeTradeInspector.pnl.toFixed(4)} USDT
              </span>
            </div>

            <div className="flex flex-wrap items-center gap-3 text-xs font-mono text-slate-300">
              {activeTradeInspector.trade.trade_type && (
                <span>
                  Tipo: <strong className={activeTradeInspector.trade.trade_type === 'LONG' ? 'text-emerald-400' : 'text-rose-400'}>{activeTradeInspector.trade.trade_type}</strong>
                </span>
              )}
              {activeTradeInspector.trade.close_reason && (
                <span>
                  Salida: <strong className="text-white">{activeTradeInspector.trade.close_reason}</strong>
                </span>
              )}
              {activeTradeInspector.timeStr && (
                <span className="text-slate-400">
                  🕒 {activeTradeInspector.timeStr}
                </span>
              )}
            </div>

            <button
              type="button"
              onClick={() => setActiveTradeInspector(null)}
              className="px-2 py-0.5 rounded bg-slate-800 hover:bg-slate-700 text-slate-400 hover:text-white text-xs font-bold font-mono transition"
              title="Cerrar detalle"
            >
              ✕ Cerrar
            </button>
          </div>
        )}

        {/* Contenedor del Gráfico SVG con Eje Cero Matemático */}
        <div className="relative w-full bg-gray-100 dark:bg-slate-950/90 rounded-xl p-2 border border-gray-200 dark:border-slate-800 shadow-inner overflow-hidden">
          <div className="w-full overflow-x-auto no-scrollbar">
            <svg
              width={totalSvgWidth}
              height={svgHeight}
              viewBox={`0 0 ${totalSvgWidth} ${svgHeight}`}
              className="select-none block"
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

                const timeStr = t.close_timestamp ? (() => {
                  const raw = String(t.close_timestamp).trim();
                  const d = new Date(raw.includes('T') ? raw : raw.replace(' ', 'T') + 'Z');
                  return isNaN(d.getTime()) ? t.close_timestamp : d.toLocaleString([], { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' });
                })() : `Trade #${idx + 1}`;

                const handleSelect = () => {
                  setActiveTradeInspector({
                    coin: symbolOrStrat,
                    trade: t,
                    index: idx + 1,
                    pnl,
                    isWin,
                    isLoss,
                    timeStr
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
          <div className="text-[10px] text-slate-500 mt-1 px-1 flex items-center justify-between">
            <span>💡 Toca o pasa el cursor sobre cualquier barra para ver el detalle de ese trade.</span>
          </div>
        )}
      </div>
    );
  };

  return (
    <div className="space-y-6">

      {/* ======================================================== */}
      {/* 1. MONITOR DE BILLETERA & GESTIÓN DE RIESGO BINANCE (MOVIDO Y MEJORADO) */}
      {/* ======================================================== */}
      <div className="bg-gradient-to-br from-gray-900 via-gray-900 to-slate-900 border border-indigo-900/50 rounded-2xl shadow-2xl p-5 relative overflow-hidden">
        {/* Glow de fondo decorativo */}
        <div className="absolute -top-24 -right-24 w-72 h-72 bg-indigo-600/10 rounded-full blur-3xl pointer-events-none" />
        
        <div className="flex flex-wrap items-center justify-between gap-3 pb-4 border-b border-gray-800 relative z-10">
          <div className="flex items-center space-x-3">
            <div className="p-2.5 bg-indigo-500/20 text-indigo-400 rounded-xl border border-indigo-500/30 shadow-inner">
              <span className="text-2xl">🛡️</span>
            </div>
            <div>
              <div className="flex items-center gap-2">
                <h2 className="text-base font-bold text-white tracking-wide">
                  Monitor de Billetera Binance & Salud de Margen
                </h2>
                <Tooltip title="Monitor de Margen y Billetera" text="Monitorea en vivo el balance total, margen retenido en trades activos y margen libre disponible en tu cuenta de Binance Futures." />
                <span className="text-[10px] px-2 py-0.5 rounded-full font-bold bg-emerald-950 text-emerald-300 border border-emerald-800 flex items-center gap-1">
                  <span className="w-1.5 h-1.5 rounded-full bg-emerald-400 animate-pulse"></span>
                  Futures Testnet Live
                </span>
              </div>
              <p className="text-xs text-gray-400 mt-0.5">
                Datos en tiempo real de tu cuenta: balance disponible, capital comprometido y protección contra liquidación.
              </p>
            </div>
          </div>

          <button
            type="button"
            onClick={fetchAllData}
            disabled={isLoading}
            className="px-3 py-1.5 bg-gray-800 hover:bg-gray-700 text-gray-200 text-xs font-semibold rounded-lg border border-gray-700 transition flex items-center gap-1.5 active:scale-95"
          >
            <span>🔄</span> Actualizar Datos
          </button>
        </div>

        {/* 4 Tarjetas Financieras Principales */}
        <div className="grid grid-cols-2 lg:grid-cols-4 gap-3.5 my-4 relative z-10">
          
          {/* Balance Total */}
          <div className="bg-gray-800/80 border border-gray-700/80 rounded-xl p-3.5 flex flex-col justify-between shadow-md">
            <div className="flex items-center justify-between text-gray-400 text-xs mb-1">
              <span className="font-semibold uppercase tracking-wider text-[11px] flex items-center gap-1">
                <span>💰 Balance Total</span>
                <Tooltip title="Balance Total de Cuenta" text="Capital total en USDT disponible en la billetera de futuros de Binance (saldo de margen + fondos disponibles)." />
              </span>
              <span className="text-gray-500">USDT</span>
            </div>
            <div className="text-2xl font-black font-mono text-white tracking-tight">
              ${totalBalanceNum.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
            </div>
            <div className="text-[11px] text-gray-400 mt-1 flex items-center justify-between">
              <span>Ganancia Cartera:</span>
              <span className={`font-semibold font-mono ${walletNetProfit >= 0 ? 'text-emerald-400' : 'text-rose-400'}`}>
                {walletNetProfit >= 0 ? `+${walletNetProfit.toFixed(2)}` : walletNetProfit.toFixed(2)} USDT ({walletNetProfit >= 0 ? '+' : ''}{walletRoiPct.toFixed(2)}%)
              </span>
            </div>
          </div>

          {/* Margen Ocupado / Exposición Actual */}
          <div className="bg-gray-800/80 border border-gray-700/80 rounded-xl p-3.5 flex flex-col justify-between shadow-md">
            <div className="flex items-center justify-between text-gray-400 text-xs mb-1">
              <span className="font-semibold uppercase tracking-wider text-[11px] flex items-center gap-1">
                <span>🔒 Margen en Uso</span>
                <Tooltip title="Margen Comprometido" text="Monto de USDT actualmente retenido como garantía en las posiciones abiertas activas." />
              </span>
              <span className={`text-[10px] px-1.5 py-0.2 rounded font-bold border ${stressBorder}`}>
                {stressLabel}
              </span>
            </div>
            <div className="text-2xl font-black font-mono text-amber-400 tracking-tight">
              ${currentExpNum.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
            </div>
            <div className="text-[11px] text-gray-400 mt-1 flex items-center justify-between">
              <span>Ocupado en trades</span>
              <span className="text-amber-300 font-semibold font-mono">
                {totalBalanceNum > 0 ? ((currentExpNum / totalBalanceNum) * 100).toFixed(1) : 0}% del saldo
              </span>
            </div>
          </div>

          {/* Margen Libre / Disponible */}
          <div className="bg-gray-800/80 border border-gray-700/80 rounded-xl p-3.5 flex flex-col justify-between shadow-md">
            <div className="flex items-center justify-between text-gray-400 text-xs mb-1">
              <span className="font-semibold uppercase tracking-wider text-[11px] flex items-center gap-1">
                <span>🟢 Margen Libre</span>
                <Tooltip title="Margen Disponible" text="Capital libre en USDT no asignado a ninguna posición, disponible para nuevas aperturas o absorber retrocesos de mercado." />
              </span>
              <span className="text-emerald-400 text-[10px] font-bold">Disponible</span>
            </div>
            <div className="text-2xl font-black font-mono text-emerald-400 tracking-tight">
              ${freeMarginNum.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
            </div>
            <div className="text-[11px] text-gray-400 mt-1 flex items-center justify-between">
              <span>Listo para operar</span>
              <span className="text-emerald-300 font-semibold font-mono">
                {totalBalanceNum > 0 ? ((freeMarginNum / totalBalanceNum) * 100).toFixed(1) : 100}% libre
              </span>
            </div>
          </div>

          {/* Límite Máximo Autorizado */}
          <div className="bg-gray-800/80 border border-gray-700/80 rounded-xl p-3.5 flex flex-col justify-between shadow-md">
            <div className="flex items-center justify-between text-gray-400 text-xs mb-1">
              <span className="font-semibold uppercase tracking-wider text-[11px] flex items-center gap-1">
                <span>🛡️ Límite Autorizado</span>
                <Tooltip title="Límite Máximo de Exposición" text="Porcentaje máximo de tu cartera total que el bot tiene autorización de comprometer en margen simultáneamente." example="Si tienes $1,000 y fijas 50%, el bot nunca usará más de $500 en margen, protegiéndote de sobreexposición." />
              </span>
              <span className="text-purple-300 text-[10px] font-mono font-bold">
                {riskData?.risk_percentage || `${riskPercentageInput}%`}
              </span>
            </div>
            <div className="text-2xl font-black font-mono text-purple-300 tracking-tight">
              ${maxExpNum.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
            </div>
            <div className="text-[11px] text-gray-400 mt-1 flex items-center justify-between">
              <span>Tope de seguridad</span>
              <span className="text-purple-400 font-semibold font-mono">Bloqueo automático</span>
            </div>
          </div>

        </div>

        {/* Barra de Estrés y Ajuste Rápido de Riesgo */}
        <div className="mt-4 pt-3 border-t border-gray-800/80 flex flex-col md:flex-row items-stretch md:items-center justify-between gap-4 relative z-10">
          
          {/* Barra de Progreso */}
          <div className="flex-1 space-y-1.5">
            <div className="flex items-center justify-between text-xs text-gray-300">
              <span className="font-semibold flex items-center gap-1.5">
                <span>Nivel de Utilización de Margen:</span>
                <Tooltip title="Nivel de Utilización" text="Porcentaje del límite de riesgo autorizado que está en uso en este momento. Verde = Seguro (<50%), Amarillo = Moderado (50-80%), Rojo = Alto Riesgo (>80%)." />
                <span className="font-mono text-white font-bold">{stressRatio.toFixed(1)}% del límite</span>
              </span>
              <span className="text-gray-400 text-[11px] font-mono">
                ${currentExpNum.toFixed(2)} de ${maxExpNum.toFixed(2)} USDT max
              </span>
            </div>
            <div className="w-full bg-gray-950 rounded-full h-3.5 p-0.5 border border-gray-800 relative overflow-hidden">
              <div
                className={`h-full rounded-full transition-all duration-700 ${stressColor}`}
                style={{ width: `${stressRatio}%` }}
              />
            </div>
          </div>

          {/* Formulario de Ajuste de Límite (Solo Admin) */}
          {!readOnly && (
            <form onSubmit={handleSaveRiskLimit} className="flex items-center gap-2 flex-shrink-0 bg-gray-950/70 p-2 rounded-xl border border-gray-800">
              <label htmlFor="riskInput" className="text-xs text-gray-300 font-medium whitespace-nowrap pl-1 flex items-center gap-1">
                <span>Ajustar Límite:</span>
                <Tooltip title="Ajuste de Riesgo Máximo" text="Guarda el porcentaje máximo de riesgo permitido para el bot tanto en Binance como en la configuración del servidor." />
              </label>
              <div className="relative w-20">
                <input
                  id="riskInput"
                  type="number"
                  min="1"
                  max="100"
                  value={riskPercentageInput}
                  onChange={(e) => setRiskPercentageInput(e.target.value)}
                  className="w-full text-xs font-bold font-mono bg-gray-900 border border-gray-700 rounded-lg py-1.5 pl-2.5 pr-6 text-white text-center focus:ring-2 focus:ring-indigo-500 focus:border-transparent outline-none"
                />
                <span className="absolute inset-y-0 right-2 flex items-center text-xs text-gray-400 pointer-events-none font-bold">%</span>
              </div>
              <button
                type="submit"
                disabled={isSavingRisk}
                className="px-3 py-1.5 bg-indigo-600 hover:bg-indigo-500 disabled:bg-gray-700 text-white text-xs font-bold rounded-lg shadow transition active:scale-95 whitespace-nowrap"
              >
                {isSavingRisk ? 'Guardando...' : '💾 Guardar'}
              </button>
            </form>
          )}

        </div>

        {/* Feedback Alert */}
        {riskFeedback && (
          <div className={`mt-3 p-2.5 rounded-lg text-xs font-semibold flex items-center gap-2 ${
            riskFeedback.type === 'success' 
              ? 'bg-emerald-950/80 text-emerald-300 border border-emerald-800' 
              : 'bg-rose-950/80 text-rose-300 border border-rose-800'
          }`}>
            <span>{riskFeedback.type === 'success' ? '✅' : '⚠️'}</span>
            <span>{riskFeedback.msg}</span>
          </div>
        )}

      </div>

      {/* ======================================================== */}
      {/* 2. KPIs FINANCIEROS Y GESTIÓN INSTITUCIONAL */}
      {/* ======================================================== */}
      <div className="bg-white dark:bg-gray-900 border border-gray-200 dark:border-gray-800 rounded-2xl shadow-lg p-5 transition-all">
        
        {/* Cabecera de KPIs */}
        <div className="flex flex-wrap items-center justify-between gap-3 pb-4 border-b border-gray-200 dark:border-gray-800">
          <div className="flex items-center space-x-2.5">
            <div className="p-2 bg-emerald-500/20 text-emerald-500 rounded-lg">
              <span className="text-xl">📈</span>
            </div>
            <div>
              <h2 className="text-base font-bold text-gray-900 dark:text-white flex items-center gap-2">
                <span>Rendimiento Financiero y Estadísticas de Trading</span>
                <Tooltip title="Estadísticas de Trading" text="Historial completo de trades cerrados, ratio de acierto, factor de beneficio y curva de capital acumulado en vivo." />
                <span className={`text-xs px-2.5 py-0.5 rounded-full font-bold border ${
                  netPnL >= 0 
                    ? 'bg-emerald-500/20 text-emerald-400 border-emerald-500/30' 
                    : 'bg-rose-500/20 text-rose-400 border-rose-500/30'
                }`}>
                  {netPnL >= 0 ? `+${netPnL.toFixed(2)} USDT` : `${netPnL.toFixed(2)} USDT`}
                </span>
              </h2>
              <p className="text-xs text-gray-500 dark:text-gray-400">
                Historial completo de trades cerrados, ratio de acierto y control de Drawdown.
              </p>
            </div>
          </div>

          {/* Filtro por moneda, por estrategia y Exportar CSV */}
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
                text="Explicación contable exacta: El balance actual de Binance ($5,023.99) es la suma del capital base ($5,000.00) más el PnL de operaciones ya cerradas (+26.09 USDT) ajustado por el flotante y las comisiones de apertura de las posiciones abiertas activas (-2.10 USDT)." 
              />
            </div>
            <span className="text-[10px] font-mono font-bold px-2 py-0.5 rounded-full bg-indigo-950 text-indigo-300 border border-indigo-800">
              Conciliación Exacta en Tiempo Real
            </span>
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3 text-xs font-mono">
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

            {/* 2. Trades Cerrados */}
            <div className="p-3 bg-slate-900/90 rounded-xl border border-slate-800">
              <span className="text-[10px] font-sans font-semibold text-slate-400 block uppercase tracking-wider flex items-center justify-between">
                <span>2. (+) Trades Cerrados</span>
                <span className="text-[9px] text-emerald-400 font-bold">{totalTrades} ops</span>
              </span>
              <span className={`text-lg font-black block mt-0.5 ${netPnL >= 0 ? 'text-emerald-400' : 'text-rose-400'}`}>
                {netPnL >= 0 ? `+${netPnL.toFixed(2)}` : netPnL.toFixed(2)} <span className="text-xs text-slate-400 font-normal">USDT</span>
              </span>
              <span className="text-[10px] text-slate-500 font-sans block mt-1">
                Ganancia neta finalizada
              </span>
            </div>

            {/* 3. Diferencial Posiciones Abiertas */}
            <div className="p-3 bg-slate-900/90 rounded-xl border border-slate-800">
              <span className="text-[10px] font-sans font-semibold text-slate-400 block uppercase tracking-wider flex items-center justify-between">
                <span>3. (±) Flotante & Tasas</span>
                <span className="text-[9px] text-amber-400 font-bold">${currentExpNum.toFixed(0)} margen</span>
              </span>
              <span className={`text-lg font-black block mt-0.5 ${openDifferential >= 0 ? 'text-emerald-400' : 'text-amber-400'}`}>
                {openDifferential >= 0 ? `+${openDifferential.toFixed(2)}` : openDifferential.toFixed(2)} <span className="text-xs text-slate-400 font-normal">USDT</span>
              </span>
              <span className="text-[10px] text-slate-500 font-sans block mt-1">
                Trades en curso & comisiones
              </span>
            </div>

            {/* 4. Balance Binance */}
            <div className="p-3 bg-emerald-950/30 rounded-xl border border-emerald-800/60 shadow-sm">
              <span className="text-[10px] font-sans font-semibold text-emerald-300 block uppercase tracking-wider flex items-center justify-between">
                <span>4. (=) Saldo Binance</span>
                <span className="text-[9px] font-bold text-emerald-400">100% Saldo</span>
              </span>
              <span className="text-lg font-black text-emerald-300 block mt-0.5">
                ${totalBalanceNum.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })} <span className="text-xs text-slate-400 font-normal">USDT</span>
              </span>
              <span className="text-[10px] font-bold text-emerald-400 font-sans block mt-1">
                Ganancia Neta: {walletNetProfit >= 0 ? `+${walletNetProfit.toFixed(2)}` : walletNetProfit.toFixed(2)} USDT ({walletNetProfit >= 0 ? '+' : ''}{walletRoiPct.toFixed(2)}%)
              </span>
            </div>
          </div>
        </div>

        {/* 5 Tarjetas de Métricas Clave */}
        <div className="grid grid-cols-2 lg:grid-cols-5 gap-3.5 my-4">
          
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

          {/* Tarjeta de PnL Trades Cerrados */}
          <div className="p-3 bg-gray-50 dark:bg-gray-800/60 rounded-xl border border-gray-200 dark:border-gray-700/80">
            <span className="text-[11px] font-semibold text-gray-500 dark:text-gray-400 uppercase tracking-wider flex items-center justify-between">
              <span>💰 PnL Cerrado</span>
              <Tooltip title="PnL Operaciones Cerradas" text="Suma neta realizada de los trades completados y guardados en el historial (ganancias brutas menos comisiones ya liquidadas)." />
            </span>
            <span className={`text-xl font-bold font-mono ${netPnL >= 0 ? 'text-emerald-500' : 'text-rose-500'}`}>
              {netPnL >= 0 ? `+${netPnL.toFixed(2)}` : netPnL.toFixed(2)} <span className="text-xs">USDT</span>
            </span>
            <span className="text-[10px] text-gray-400 block mt-0.5 font-mono">
              Bruto: {totalGrossPnL >= 0 ? `+${totalGrossPnL.toFixed(1)}` : totalGrossPnL.toFixed(1)} USDT
            </span>
          </div>

          {/* Tarjeta de Rendimiento Billetera Binance */}
          <div className="p-3 bg-emerald-950/20 dark:bg-emerald-950/30 rounded-xl border border-emerald-500/40 shadow-sm">
            <span className="text-[11px] font-semibold text-emerald-400 uppercase tracking-wider flex items-center justify-between">
              <span>🏦 Neto Binance</span>
              <Tooltip title="Rendimiento Neto en Billetera" text="Diferencia real entre el saldo actual de la cuenta Binance ($5,023.99 USDT) y el capital inicial base ($5,000.00 USDT)." />
            </span>
            <span className={`text-xl font-bold font-mono ${walletNetProfit >= 0 ? 'text-emerald-400' : 'text-rose-400'}`}>
              {walletNetProfit >= 0 ? `+${walletNetProfit.toFixed(2)}` : walletNetProfit.toFixed(2)} <span className="text-xs">USDT</span>
            </span>
            <span className="text-[10px] text-emerald-400/80 block mt-0.5 font-mono">
              Retorno: {walletNetProfit >= 0 ? '+' : ''}{walletRoiPct.toFixed(2)}%
            </span>
          </div>

          {/* Comisiones Totales Pagadas a Binance */}
          <div className="p-3 bg-amber-950/20 dark:bg-amber-950/30 rounded-xl border border-amber-500/50 shadow-sm">
            <span className="text-[11px] font-semibold text-amber-500 dark:text-amber-400 uppercase tracking-wider flex items-center justify-between">
              <span>💸 Comisiones</span>
              <Tooltip title="Comisiones Totales Binance" text="Total de comisiones oficiales cobradas por Binance Futures en órdenes de entrada (Maker 0.02% / Taker 0.05%) y salida (0.05% Taker). Descontadas automáticamente del saldo." />
            </span>
            <span className="text-xl font-bold font-mono text-amber-400">
              -${totalCommissions.toFixed(2)} <span className="text-xs text-gray-400 font-normal">USDT</span>
            </span>
            <span className="text-[10px] text-gray-400 block mt-0.5 font-mono">
              ~{(totalTrades > 0 ? (totalCommissions / totalTrades) : 0).toFixed(3)}/op
            </span>
          </div>

          {/* Mejor / Peor */}
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

        {/* Curva de Capital Acumulado SVG */}
        {equityPoints.length > 1 ? (
          <div className="mt-4 p-4 bg-gray-950 rounded-xl border border-gray-800 relative">
            <div className="flex items-center justify-between px-2 mb-2">
              <span className="text-xs font-bold text-gray-300 flex items-center gap-1">
                <span>📈 Curva de Crecimiento de Capital ({equityPoints.length} operaciones)</span>
                <Tooltip title="Curva de Crecimiento de Capital" text="Muestra la evolución cronológica del saldo acumulado trade a trade. Una pendiente ascendente constante refleja consistencia en la estrategia." />
              </span>
              <span className="text-xs font-mono text-emerald-400">
                Total Acumulado: {netPnL >= 0 ? `+${netPnL.toFixed(4)}` : netPnL.toFixed(4)} USDT
              </span>
            </div>

            <div className="w-full overflow-x-auto">
              <svg viewBox={`0 0 ${svgWidth} ${svgHeight}`} className="w-full h-auto max-h-56">
                <defs>
                  <linearGradient id="equityGradient" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="0%" stopColor="#10b981" stopOpacity="0.40" />
                    <stop offset="100%" stopColor="#10b981" stopOpacity="0.0" />
                  </linearGradient>
                </defs>

                <line
                  x1={padding.left}
                  y1={zeroY}
                  x2={svgWidth - padding.right}
                  y2={zeroY}
                  stroke="#475569"
                  strokeDasharray="4 4"
                  strokeWidth="1.5"
                />

                {areaPath && (
                  <path d={areaPath} fill="url(#equityGradient)" />
                )}

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

                {equityPoints.map((pt, i) => (
                  <g key={i} className="group cursor-pointer">
                    <circle
                      cx={getX(i)}
                      cy={getY(pt.cumulative)}
                      r={equityPoints.length > 50 ? 2 : 3.5}
                      fill={pt.pnl >= 0 ? '#10b981' : '#f43f5e'}
                      stroke="#0f172a"
                      strokeWidth="1.5"
                    />
                    <title>{`${pt.symbol} (Trade #${pt.index}): ${pt.pnl >= 0 ? '+' : ''}${pt.pnl.toFixed(4)} USDT | Acumulado: ${pt.cumulative.toFixed(4)} USDT`}</title>
                  </g>
                ))}

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
          </div>
        ) : (
          <div className="py-8 text-center bg-gray-50 dark:bg-gray-800/40 rounded-xl border border-dashed border-gray-300 dark:border-gray-700">
            <p className="text-sm font-semibold text-gray-600 dark:text-gray-300">
              {totalTrades === 0 ? 'No hay operaciones cerradas registradas todavía.' : 'Se necesita al menos 2 operaciones para graficar la curva.'}
            </p>
            <p className="text-xs text-gray-400 mt-1">
              En cuanto el bot cierre sus primeros trades, la curva de capital y el ranking por moneda se actualizarán en tiempo real.
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

    </div>
  );
}

export default PnLPerformanceChart;
