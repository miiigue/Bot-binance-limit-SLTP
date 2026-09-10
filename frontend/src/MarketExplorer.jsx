import React, { useState, useEffect, useMemo } from 'react';
import Tooltip from './Tooltip';

const MarketExplorer = ({ config, onSaveConfig, onSelectSymbolForChart }) => {
  const [coins, setCoins] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [addedSymbols, setAddedSymbols] = useState({});

  // Filter states
  const [searchTerm, setSearchTerm] = useState('');
  const [minPrice, setMinPrice] = useState('');
  const [maxPrice, setMaxPrice] = useState('');
  const [minVolume, setMinVolume] = useState('');
  const [performance, setPerformance] = useState('all'); // 'all', 'gainers', 'losers'
  const [sortBy, setSortBy] = useState({ key: 'quoteVolume', order: 'desc' });

  const activeSymbolsList = useMemo(() => {
    return config?.symbolsToTrade 
      ? config.symbolsToTrade.split(',').map(s => s.trim().toUpperCase()).filter(Boolean)
      : [];
  }, [config?.symbolsToTrade]);

  const fetchMarketData = async () => {
    try {
      setLoading(true);
      const response = await fetch('/api/market_data');
      if (!response.ok) {
        throw new Error(`HTTP error! status: ${response.status}`);
      }
      const data = await response.json();
      setCoins(Array.isArray(data) ? data : []);
    } catch (e) {
      setError(e.message);
      console.error('Error fetching market data:', e);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchMarketData();
    const intervalId = setInterval(fetchMarketData, 30000); 
    return () => clearInterval(intervalId);
  }, []);

  const handleAddSymbol = async (symbol) => {
    const cleanSym = symbol.trim().toUpperCase();
    if (activeSymbolsList.includes(cleanSym)) {
      alert(`El par ${cleanSym} ya está en tu lista de monedas activas.`);
      return;
    }

    const newSymbolsStr = activeSymbolsList.length > 0
      ? `${activeSymbolsList.join(',')},${cleanSym}`
      : cleanSym;

    setAddedSymbols(prev => ({ ...prev, [cleanSym]: true }));

    if (onSaveConfig) {
      const updatedConfig = { ...config, symbolsToTrade: newSymbolsStr };
      await onSaveConfig(updatedConfig);
    }
  };

  const filteredAndSortedCoins = useMemo(() => {
    let filtered = coins.filter(coin => {
      if (searchTerm && !coin.symbol.toLowerCase().includes(searchTerm.toLowerCase())) return false;
      if (minPrice && coin.price < parseFloat(minPrice)) return false;
      if (maxPrice && coin.price > parseFloat(maxPrice)) return false;
      if (minVolume && coin.quoteVolume < parseFloat(minVolume)) return false;
      if (performance === 'gainers' && coin.priceChangePercent <= 0) return false;
      if (performance === 'losers' && coin.priceChangePercent >= 0) return false;
      return true;
    });

    filtered.sort((a, b) => {
      const valA = a[sortBy.key];
      const valB = b[sortBy.key];
      if (valA < valB) return sortBy.order === 'asc' ? -1 : 1;
      if (valA > valB) return sortBy.order === 'asc' ? 1 : -1;
      return 0;
    });

    return filtered;
  }, [coins, searchTerm, minPrice, maxPrice, minVolume, performance, sortBy]);

  const handleSort = (key) => {
    if (sortBy.key === key) {
      setSortBy({ key, order: sortBy.order === 'asc' ? 'desc' : 'asc' });
    } else {
      setSortBy({ key, order: 'desc' });
    }
  };

  const SortIcon = ({ columnKey }) => {
    const isActive = sortBy.key === columnKey;
    const isAsc = isActive && sortBy.order === 'asc';
    const isDesc = isActive && sortBy.order === 'desc';
    return (
      <span className="inline-flex flex-col items-center justify-center text-[7px] leading-[6px] w-2.5 h-3 ml-1 align-middle">
        <span className={`transition-all ${isAsc ? 'text-amber-400 font-black scale-125' : isActive ? 'text-slate-600' : 'text-slate-500'}`}>▲</span>
        <span className={`transition-all ${isDesc ? 'text-amber-400 font-black scale-125' : isActive ? 'text-slate-600' : 'text-slate-500'}`}>▼</span>
      </span>
    );
  };

  return (
    <div className="space-y-6">
      {/* 📡 Explorador y Escáner de Mercado Binance */}
      <div className="bg-white dark:bg-gray-900 border border-gray-200 dark:border-gray-800 rounded-2xl shadow-lg p-5 transition-all">
        {/* Cabecera */}
        <div className="flex flex-wrap items-center justify-between gap-3 pb-4 border-b border-gray-200 dark:border-gray-800">
          <div className="flex items-center space-x-2.5">
            <div className="p-2 bg-yellow-400/20 text-yellow-500 rounded-lg">
              <span className="text-xl">📡</span>
            </div>
            <div>
              <h2 className="text-base font-bold text-gray-900 dark:text-white flex items-center gap-2">
                <span>Escáner y Radar de Oportunidades Binance Futures</span>
                <Tooltip title="Radar de Mercado" text="Monitor en tiempo real de todos los contratos USDT en Binance Futures para identificar monedas con alto volumen, fuertes tendencias o caídas aprovechables." example="Filtra por Top Ganadoras para operar rupturas o Top Caídas para estrategias de rebote RSI." />
                <span className="text-xs bg-emerald-500/20 text-emerald-400 border border-emerald-500/30 px-2 py-0.5 rounded-full font-semibold">
                  {coins.length} Pares USDT
                </span>
              </h2>
              <p className="text-xs text-gray-500 dark:text-gray-400">
                Descubre pares con mayor volumen y volatilidad, y agrégalos a tu bot con un solo clic.
              </p>
            </div>
          </div>

          <button
            type="button"
            onClick={fetchMarketData}
            disabled={loading}
            className="px-3 py-1.5 bg-gray-100 dark:bg-gray-800 hover:bg-gray-200 dark:hover:bg-gray-700 text-gray-700 dark:text-gray-200 text-xs font-bold rounded-xl border border-gray-200 dark:border-gray-700 flex items-center gap-1.5 transition"
          >
            <span>🔄</span> Actualizar Mercado
          </button>
        </div>

        {/* Filtros */}
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-5 gap-3 my-4">
          <div>
            <label className="text-[11px] font-medium text-gray-500 dark:text-gray-400 mb-1 flex items-center">
              <span>Buscar Moneda</span>
              <Tooltip title="Buscador de Símbolos" text="Filtra la lista escribiendo el nombre de la criptomoneda (ej. BTC, ETH, SOL)." />
            </label>
            <input
              type="text"
              placeholder="🔍 Moneda (ej. SOL)..."
              className="w-full bg-gray-50 dark:bg-gray-800 border border-gray-200 dark:border-gray-700 text-gray-900 dark:text-white placeholder-gray-400 text-xs rounded-xl px-3 py-2 focus:ring-2 focus:ring-yellow-500 focus:outline-none"
              value={searchTerm}
              onChange={(e) => setSearchTerm(e.target.value)}
            />
          </div>

          <div>
            <label className="text-[11px] font-medium text-gray-500 dark:text-gray-400 mb-1 flex items-center">
              <span>Precio Mínimo</span>
              <Tooltip title="Precio Mínimo" text="Oculta monedas cuyo precio esté por debajo de este valor en USDT." />
            </label>
            <input
              type="number"
              placeholder="Precio Mín. $"
              className="w-full bg-gray-50 dark:bg-gray-800 border border-gray-200 dark:border-gray-700 text-gray-900 dark:text-white placeholder-gray-400 text-xs rounded-xl px-3 py-2 focus:ring-2 focus:ring-yellow-500 focus:outline-none"
              value={minPrice}
              onChange={(e) => setMinPrice(e.target.value)}
            />
          </div>

          <div>
            <label className="text-[11px] font-medium text-gray-500 dark:text-gray-400 mb-1 flex items-center">
              <span>Precio Máximo</span>
              <Tooltip title="Precio Máximo" text="Oculta monedas cuyo precio supere este valor en USDT." />
            </label>
            <input
              type="number"
              placeholder="Precio Máx. $"
              className="w-full bg-gray-50 dark:bg-gray-800 border border-gray-200 dark:border-gray-700 text-gray-900 dark:text-white placeholder-gray-400 text-xs rounded-xl px-3 py-2 focus:ring-2 focus:ring-yellow-500 focus:outline-none"
              value={maxPrice}
              onChange={(e) => setMaxPrice(e.target.value)}
            />
          </div>

          <div>
            <label className="text-[11px] font-medium text-gray-500 dark:text-gray-400 mb-1 flex items-center">
              <span>Volumen Mínimo</span>
              <Tooltip title="Volumen Mínimo" text="Filtra monedas con volumen insuficiente para garantizar liquidez adecuada y spreads bajos." example="Un volumen de 10,000,000 descarta pares ilíquidos." />
            </label>
            <input
              type="number"
              placeholder="Volumen Mín. (USDT)"
              className="w-full bg-gray-50 dark:bg-gray-800 border border-gray-200 dark:border-gray-700 text-gray-900 dark:text-white placeholder-gray-400 text-xs rounded-xl px-3 py-2 focus:ring-2 focus:ring-yellow-500 focus:outline-none"
              value={minVolume}
              onChange={(e) => setMinVolume(e.target.value)}
            />
          </div>

          <div>
            <label className="text-[11px] font-medium text-gray-500 dark:text-gray-400 mb-1 flex items-center">
              <span>Clasificación</span>
              <Tooltip title="Clasificación de Mercado" text="Muestra todas las monedas, solo las que van en ganancia en 24h (+) o las que van en caída (-)." />
            </label>
            <select
              className="w-full bg-gray-50 dark:bg-gray-800 border border-gray-200 dark:border-gray-700 text-gray-900 dark:text-white text-xs rounded-xl px-3 py-2 focus:ring-2 focus:ring-yellow-500 focus:outline-none font-semibold"
              value={performance}
              onChange={(e) => setPerformance(e.target.value)}
            >
              <option value="all">🪙 Todos los Pares</option>
              <option value="gainers">🚀 Top Ganadoras (+)</option>
              <option value="losers">📉 Top Caídas (-)</option>
            </select>
          </div>
        </div>

        {/* Tabla */}
        {loading && coins.length === 0 ? (
          <div className="text-center py-12 text-sm text-gray-500">Cargando datos de mercado de Binance...</div>
        ) : error ? (
          <div className="text-center py-8 text-sm text-rose-500">Error al consultar Binance: {error}</div>
        ) : (
          <div className="overflow-x-auto rounded-xl border border-gray-200 dark:border-gray-800">
            <table className="min-w-full divide-y divide-gray-200 dark:divide-gray-800 text-left">
              <thead className="bg-gray-100 dark:bg-gray-800/80">
                <tr>
                  <th scope="col" className="px-4 py-3 text-xs font-bold text-gray-500 dark:text-gray-400 uppercase tracking-wider cursor-pointer select-none" onClick={() => handleSort('symbol')}>
                    <div className="inline-flex items-center gap-1">
                      <span>Par</span>
                      <SortIcon columnKey="symbol" />
                      <Tooltip title="Par de Negociación" text="Símbolo del contrato de futuros en Binance cotizado contra USDT." align="left" />
                    </div>
                  </th>
                  <th scope="col" className="px-4 py-3 text-xs font-bold text-gray-500 dark:text-gray-400 uppercase tracking-wider cursor-pointer select-none" onClick={() => handleSort('price')}>
                    <div className="inline-flex items-center gap-1">
                      <span>Precio</span>
                      <SortIcon columnKey="price" />
                      <Tooltip title="Precio en Vivo" text="Último precio de cotización ejecutado en Binance Futures." />
                    </div>
                  </th>
                  <th scope="col" className="px-4 py-3 text-xs font-bold text-gray-500 dark:text-gray-400 uppercase tracking-wider cursor-pointer select-none" onClick={() => handleSort('priceChangePercent')}>
                    <div className="inline-flex items-center gap-1">
                      <span>Cambio 24h</span>
                      <SortIcon columnKey="priceChangePercent" />
                      <Tooltip title="Variación 24 Horas" text="Porcentaje de subida o bajada en el precio en las últimas 24 horas." />
                    </div>
                  </th>
                  <th scope="col" className="px-4 py-3 text-xs font-bold text-gray-500 dark:text-gray-400 uppercase tracking-wider cursor-pointer select-none" onClick={() => handleSort('quoteVolume')}>
                    <div className="inline-flex items-center gap-1">
                      <span>Volumen 24h (USDT)</span>
                      <SortIcon columnKey="quoteVolume" />
                      <Tooltip title="Volumen Comercializado" text="Total de capital transaccionado en millones de USDT durante las últimas 24 horas." />
                    </div>
                  </th>
                  <th scope="col" className="px-4 py-3 text-xs font-bold text-gray-500 dark:text-gray-400 uppercase tracking-wider text-right">
                    <div className="inline-flex items-center justify-end gap-1 w-full">
                      <span>Acción Rápida</span>
                      <Tooltip title="Acciones Rápidas" text="Ver el gráfico técnico interactivo de la moneda o añadirla instantáneamente a la lista de trading del bot." align="right" />
                    </div>
                  </th>
                </tr>
              </thead>
              <tbody className="bg-white dark:bg-gray-900 divide-y divide-gray-200 dark:divide-gray-800 font-mono text-xs">
                {filteredAndSortedCoins.slice(0, 50).map((coin) => {
                  const isAlreadyActive = activeSymbolsList.includes(coin.symbol.toUpperCase());
                  return (
                    <tr key={coin.symbol} className="hover:bg-gray-50 dark:hover:bg-gray-800/50 transition">
                      <td className="px-4 py-3 font-bold text-gray-900 dark:text-white flex items-center gap-2">
                        <span>{coin.symbol}</span>
                        {isAlreadyActive && (
                          <span className="text-[10px] bg-yellow-500/20 text-yellow-600 dark:text-yellow-400 border border-yellow-500/30 px-1.5 py-0.2 rounded font-sans font-semibold">
                            Activo
                          </span>
                        )}
                      </td>
                      <td className="px-4 py-3 text-gray-700 dark:text-gray-300">
                        ${coin.price > 1 ? coin.price.toFixed(4) : coin.price.toFixed(6)}
                      </td>
                      <td className={`px-4 py-3 font-bold ${coin.priceChangePercent >= 0 ? 'text-emerald-500' : 'text-rose-500'}`}>
                        {coin.priceChangePercent >= 0 ? `+${coin.priceChangePercent.toFixed(2)}%` : `${coin.priceChangePercent.toFixed(2)}%`}
                      </td>
                      <td className="px-4 py-3 text-gray-600 dark:text-gray-400">
                        ${(coin.quoteVolume / 1_000_000).toFixed(2)}M USDT
                      </td>
                      <td className="px-4 py-3 text-right space-x-2">
                        <button
                          type="button"
                          onClick={() => onSelectSymbolForChart && onSelectSymbolForChart(coin.symbol)}
                          className="px-2 py-1 bg-gray-100 dark:bg-gray-800 hover:bg-gray-200 dark:hover:bg-gray-700 text-gray-700 dark:text-gray-300 rounded-lg text-xs font-sans font-semibold border border-gray-200 dark:border-gray-700 transition"
                          title="Ver Gráfico"
                        >
                          📊 Ver
                        </button>
                        <button
                          type="button"
                          disabled={isAlreadyActive || addedSymbols[coin.symbol]}
                          onClick={() => handleAddSymbol(coin.symbol)}
                          className={`px-2.5 py-1 rounded-lg text-xs font-sans font-bold shadow-sm transition ${
                            isAlreadyActive || addedSymbols[coin.symbol]
                              ? 'bg-gray-200 dark:bg-gray-800 text-gray-400 border border-transparent cursor-not-allowed'
                              : 'bg-yellow-500 hover:bg-yellow-400 text-black border border-yellow-400 active:scale-95'
                          }`}
                        >
                          {isAlreadyActive || addedSymbols[coin.symbol] ? '✓ En Bot' : '➕ Añadir'}
                        </button>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  );
};

export default MarketExplorer;
