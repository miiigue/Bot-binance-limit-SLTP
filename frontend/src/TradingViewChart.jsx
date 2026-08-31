import React, { useEffect, useRef, useState } from 'react';

// Sub-componente para cada gráfico individual en la cuadrícula de mosaico
function MiniTradingViewWidget({ symbol, interval, onExpand }) {
  const widgetId = useRef('tv_mini_' + symbol + '_' + Math.random().toString(36).substring(2, 7));
  const [isLoaded, setIsLoaded] = useState(false);

  useEffect(() => {
    if (!window.TradingView) return;

    const formattedSymbol = symbol.trim().toUpperCase();
    const tvSymbol = 'BINANCE:' + formattedSymbol + '.P';

    try {
      new window.TradingView.widget({
        autosize: true,
        symbol: tvSymbol,
        interval: interval || '5',
        timezone: 'Etc/UTC',
        theme: 'dark',
        style: '1', // Velas
        locale: 'es',
        toolbar_bg: '#111827',
        enable_publishing: false,
        hide_side_toolbar: true,
        hide_top_toolbar: false,
        allow_symbol_change: false,
        container_id: widgetId.current,
        studies: ['RSI@tv-basicstudies', 'Volume@tv-basicstudies'],
        disabled_features: ['header_saveload', 'header_symbol_search'],
        overrides: {
          'paneProperties.background': '#0f172a',
          'paneProperties.vertGridProperties.color': '#1e293b',
          'paneProperties.horzGridProperties.color': '#1e293b',
          'scalesProperties.textColor': '#94a3b8',
          'mainSeriesProperties.candleStyle.upColor': '#10b981',
          'mainSeriesProperties.candleStyle.downColor': '#ef4444',
          'mainSeriesProperties.candleStyle.wickUpColor': '#10b981',
          'mainSeriesProperties.candleStyle.wickDownColor': '#ef4444',
        }
      });
      setIsLoaded(true);
    } catch (e) {
      console.error('Error al cargar widget para ' + symbol + ':', e);
    }
  }, [symbol, interval]);

  return (
    <div className="bg-gray-900 border border-gray-800 rounded-xl overflow-hidden shadow-lg flex flex-col transition hover:border-yellow-500/50">
      {/* Barra superior de la tarjeta */}
      <div className="px-3 py-2 bg-gray-800/80 border-b border-gray-700/80 flex items-center justify-between">
        <div className="flex items-center space-x-2">
          <span className="font-mono font-bold text-sm text-yellow-400">{symbol}</span>
          <span className="text-[10px] bg-emerald-500/20 text-emerald-300 px-1.5 py-0.5 rounded font-semibold">
            {interval}m
          </span>
        </div>
        <button
          type="button"
          onClick={() => onExpand(symbol)}
          className="px-2 py-0.5 text-xs font-semibold bg-gray-700 hover:bg-yellow-500 hover:text-black text-gray-200 rounded transition flex items-center gap-1 shadow"
          title="Ver en pantalla completa"
        >
          <span>🔍</span> Ampliar
        </button>
      </div>

      {/* Contenedor del widget */}
      <div className="w-full h-80 bg-[#0f172a]">
        <div id={widgetId.current} className="w-full h-full" />
      </div>
    </div>
  );
}

function TradingViewChart({ selectedSymbol = 'SOLUSDT', symbolsList = [], onSelectSymbol }) {
  const [viewMode, setViewMode] = useState('grid'); // 'grid' (Mosaico) o 'single' (Grande)
  const [currentInterval, setCurrentInterval] = useState('5'); // '1', '5', '15', '60', 'D'
  const [activeSymbol, setActiveSymbol] = useState(selectedSymbol || 'SOLUSDT');
  const [gridCols, setGridCols] = useState(2); // 2, 3 o 4 columnas
  const [isScriptLoaded, setIsScriptLoaded] = useState(false);

  const singleWidgetId = useRef('tv_single_' + Math.random().toString(36).substring(2, 9));

  // Sincronizar símbolo seleccionado
  useEffect(() => {
    if (selectedSymbol && selectedSymbol !== activeSymbol) {
      setActiveSymbol(selectedSymbol);
    }
  }, [selectedSymbol]);

  // Cargar el script oficial de TradingView una sola vez
  useEffect(() => {
    if (window.TradingView) {
      setIsScriptLoaded(true);
      return;
    }
    const script = document.createElement('script');
    script.src = 'https://s3.tradingview.com/tv.js';
    script.async = true;
    script.onload = () => setIsScriptLoaded(true);
    document.head.appendChild(script);
  }, []);

  // Inicializar el widget individual grande cuando se esté en modo 'single'
  useEffect(() => {
    if (viewMode !== 'single' || !isScriptLoaded || !window.TradingView) return;

    const formattedSymbol = (activeSymbol || 'SOLUSDT').trim().toUpperCase();
    const tvSymbol = 'BINANCE:' + formattedSymbol + '.P';

    try {
      new window.TradingView.widget({
        autosize: true,
        symbol: tvSymbol,
        interval: currentInterval,
        timezone: 'Etc/UTC',
        theme: 'dark',
        style: '1', // Velas
        locale: 'es',
        toolbar_bg: '#111827',
        enable_publishing: false,
        hide_side_toolbar: false,
        allow_symbol_change: true,
        container_id: singleWidgetId.current,
        studies: [
          'RSI@tv-basicstudies',
          'MASimple@tv-basicstudies',
          'Volume@tv-basicstudies'
        ],
        disabled_features: ['header_saveload'],
        enabled_features: ['study_templates'],
        overrides: {
          'paneProperties.background': '#0f172a',
          'paneProperties.vertGridProperties.color': '#1e293b',
          'paneProperties.horzGridProperties.color': '#1e293b',
          'symbolWatermarkProperties.transparency': 90,
          'scalesProperties.textColor': '#94a3b8',
          'mainSeriesProperties.candleStyle.upColor': '#10b981',
          'mainSeriesProperties.candleStyle.downColor': '#ef4444',
          'mainSeriesProperties.candleStyle.wickUpColor': '#10b981',
          'mainSeriesProperties.candleStyle.wickDownColor': '#ef4444',
        }
      });
    } catch (e) {
      console.error('Error al inicializar widget TradingView grande:', e);
    }
  }, [viewMode, isScriptLoaded, activeSymbol, currentInterval]);

  const handleExpandSymbol = (sym) => {
    setActiveSymbol(sym);
    setViewMode('single');
    if (onSelectSymbol) onSelectSymbol(sym);
    window.scrollTo({ top: 0, behavior: 'smooth' });
  };

  const intervals = [
    { label: '1m', value: '1' },
    { label: '5m', value: '5' },
    { label: '15m', value: '15' },
    { label: '1h', value: '60' },
    { label: '4h', value: '240' },
    { label: '1D', value: 'D' },
  ];

  // Limpiar lista de símbolos para el mosaico
  const cleanedSymbols = symbolsList && symbolsList.length > 0
    ? symbolsList.map(s => s.trim().toUpperCase()).filter(Boolean)
    : ['BTCUSDT', 'ETHUSDT', 'SOLUSDT', 'DOGEUSDT', 'NEARUSDT', 'ADAUSDT', 'OPUSDT', 'ARBUSDT'];

  return (
    <div className="bg-white dark:bg-gray-900 border border-gray-200 dark:border-gray-800 rounded-2xl shadow-lg p-4 mb-6 transition-all">
      {/* Barra de Control Principal */}
      <div className="flex flex-wrap items-center justify-between gap-3 pb-3 border-b border-gray-200 dark:border-gray-800">
        <div className="flex items-center space-x-2.5">
          <div className="p-2 bg-yellow-400/20 text-yellow-500 rounded-lg">
            <span className="text-xl">📊</span>
          </div>
          <div>
            <h2 className="text-base font-bold text-gray-900 dark:text-white flex items-center gap-2">
              {viewMode === 'grid' ? (
                <>
                  <span>Mosaico Multi-Gráfico de Bots Activos</span>
                  <span className="text-xs bg-yellow-500/20 text-yellow-500 border border-yellow-500/30 px-2 py-0.5 rounded-full font-bold">
                    {cleanedSymbols.length} Monedas en Vivo
                  </span>
                </>
              ) : (
                <>
                  <span>Gráfico Ampliado:</span>
                  <span className="text-yellow-500 font-mono font-extrabold">{activeSymbol}</span>
                  <span className="text-xs bg-emerald-500/20 text-emerald-400 border border-emerald-500/30 px-2 py-0.5 rounded-full font-semibold">
                    Binance Futures
                  </span>
                </>
              )}
            </h2>
            <p className="text-xs text-gray-500 dark:text-gray-400">
              {viewMode === 'grid' 
                ? 'Monitorea todas las monedas activas al mismo tiempo en tiempo real.' 
                : 'Inspecciona velas, soportes, RSI y volumen con herramientas de análisis.'}
            </p>
          </div>
        </div>

        {/* Selector de Modo de Vista y Controles */}
        <div className="flex flex-wrap items-center gap-2">
          {/* Botones Modo: Mosaico vs Individual */}
          <div className="flex items-center bg-gray-100 dark:bg-gray-800 p-1 rounded-xl border border-gray-200 dark:border-gray-700">
            <button
              type="button"
              onClick={() => setViewMode('grid')}
              className={`px-3 py-1 text-xs font-bold rounded-lg transition-all flex items-center gap-1.5 ${
                viewMode === 'grid'
                  ? 'bg-yellow-500 text-black shadow-sm'
                  : 'text-gray-600 dark:text-gray-300 hover:bg-gray-200 dark:hover:bg-gray-700'
              }`}
            >
              <span>🔲</span> Mosaico ({cleanedSymbols.length})
            </button>
            <button
              type="button"
              onClick={() => setViewMode('single')}
              className={`px-3 py-1 text-xs font-bold rounded-lg transition-all flex items-center gap-1.5 ${
                viewMode === 'single'
                  ? 'bg-yellow-500 text-black shadow-sm'
                  : 'text-gray-600 dark:text-gray-300 hover:bg-gray-200 dark:hover:bg-gray-700'
              }`}
            >
              <span>🔍</span> Ampliado
            </button>
          </div>

          {/* Selector de Columnas (solo en modo Mosaico) */}
          {viewMode === 'grid' && (
            <div className="hidden sm:flex items-center bg-gray-100 dark:bg-gray-800 p-1 rounded-xl border border-gray-200 dark:border-gray-700 text-xs">
              <span className="text-[11px] text-gray-500 px-2 font-semibold">Columnas:</span>
              {[2, 3, 4].map(cols => (
                <button
                  key={cols}
                  type="button"
                  onClick={() => setGridCols(cols)}
                  className={`px-2 py-0.5 font-bold rounded-md transition ${
                    gridCols === cols
                      ? 'bg-gray-700 text-white'
                      : 'text-gray-500 hover:text-gray-300'
                  }`}
                >
                  {cols}
                </button>
              ))}
            </div>
          )}

          {/* Selector de Intervalos */}
          <div className="flex items-center bg-gray-100 dark:bg-gray-800 p-1 rounded-xl border border-gray-200 dark:border-gray-700">
            {intervals.map(({ label, value }) => (
              <button
                key={value}
                type="button"
                onClick={() => setCurrentInterval(value)}
                className={`px-2 py-1 text-xs font-bold rounded-md transition-colors ${
                  currentInterval === value
                    ? 'bg-yellow-500 text-black shadow-sm'
                    : 'text-gray-600 dark:text-gray-300 hover:bg-gray-200 dark:hover:bg-gray-700'
                }`}
              >
                {label}
              </button>
            ))}
          </div>
        </div>
      </div>

      {/* Barra de Monedas (en modo Individual) */}
      {viewMode === 'single' && cleanedSymbols.length > 0 && (
        <div className="py-2.5 flex items-center gap-1.5 overflow-x-auto scrollbar-thin scrollbar-thumb-gray-600">
          <span className="text-xs font-semibold text-gray-500 dark:text-gray-400 whitespace-nowrap mr-1">
            🪙 Cambiar Par:
          </span>
          {cleanedSymbols.map((sym) => (
            <button
              key={sym}
              type="button"
              onClick={() => {
                setActiveSymbol(sym);
                if (onSelectSymbol) onSelectSymbol(sym);
              }}
              className={`px-2.5 py-1 text-xs font-semibold rounded-lg border transition-all whitespace-nowrap ${
                activeSymbol === sym
                  ? 'bg-yellow-500 text-black font-bold border-yellow-400 shadow-md ring-2 ring-yellow-400/40'
                  : 'bg-gray-50 dark:bg-gray-800/60 text-gray-700 dark:text-gray-300 border-gray-200 dark:border-gray-700/80 hover:bg-gray-100 dark:hover:bg-gray-700'
              }`}
            >
              {sym}
            </button>
          ))}
        </div>
      )}

      {/* VISTA 1: Mosaico Cuadrícula de Todos los Bots */}
      {viewMode === 'grid' && (
        <div className={`grid gap-4 mt-3 ${
          gridCols === 2 ? 'grid-cols-1 lg:grid-cols-2' :
          gridCols === 3 ? 'grid-cols-1 md:grid-cols-2 lg:grid-cols-3' :
          'grid-cols-1 sm:grid-cols-2 lg:grid-cols-4'
        }`}>
          {cleanedSymbols.map(sym => (
            <MiniTradingViewWidget
              key={sym}
              symbol={sym}
              interval={currentInterval}
              onExpand={handleExpandSymbol}
            />
          ))}
        </div>
      )}

      {/* VISTA 2: Gráfico Individual Grande */}
      {viewMode === 'single' && (
        <div className="w-full rounded-xl overflow-hidden border border-gray-200 dark:border-gray-800 bg-[#0f172a] relative shadow-inner mt-3" style={{ height: '580px' }}>
          <div id={singleWidgetId.current} className="w-full h-full" />
        </div>
      )}
    </div>
  );
}

export default TradingViewChart;
