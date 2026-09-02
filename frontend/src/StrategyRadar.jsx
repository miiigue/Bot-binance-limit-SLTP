import React, { useState, useMemo } from 'react';

/**
 * Componente StrategyRadar:
 * 1. Línea de tiempo visual del ciclo de vida del trade (Paso 1 -> Paso 2 -> Paso 3 -> Salida).
 * 2. Resumen lógico en lenguaje natural ("SI ocurre X -> El bot hace Y").
 * 3. Simulador de escenario en vivo con precios hipotéticos y cálculo de Ratio Riesgo/Beneficio.
 */
function StrategyRadar({ config }) {
  const [isExpanded, setIsExpanded] = useState(true);
  const [simulatedPrice, setSimulatedPrice] = useState(100);

  // Valores parseados de la configuración
  const leverage = Number(config?.leverage) || 20;
  const positionSizeUSDT = Number(config?.positionSizeUSDT) || 50;
  const estimatedMargin = leverage > 0 ? (positionSizeUSDT / leverage) : positionSizeUSDT;
  const rsiInterval = config?.rsiInterval || '5m';
  const rsiPeriod = Number(config?.rsiPeriod) || 14;
  const symbols = config?.symbolsToTrade ? config.symbolsToTrade.split(',').map(s => s.trim()).filter(Boolean) : [];
  
  // Estrategia de Soportes
  const isSupportStrategy = !!config?.evaluateSupportStrategy;
  const supportHistoryCandles = Number(config?.supportHistoryCandles) || 200;
  const supportConfirmations = Number(config?.supportConfirmations) || 2;
  const supportTolerance = Number(config?.supportLevelTolerancePercent) || 0.5;
  const supportSLPercent = Number(config?.supportOrderStopLossPercent) || 2.0;
  const supportTPPercent = Number(config?.supportOrderTakeProfitPercent) || 4.0;

  // Filtros RSI / Momentum
  const evalRsiDelta = !!config?.evaluateRsiDelta;
  const rsiThresholdUp = Number(config?.rsiThresholdUp) || 1.5;
  const evalRsiRange = !!config?.evaluateRsiRange;
  const rsiLow = Number(config?.rsiEntryLevelLow) || 30;
  const rsiHigh = Number(config?.rsiEntryLevelHigh) || 75;

  // Filtros de Volumen & Tendencia
  const evalVolume = !!config?.evaluateVolumeFilter;
  const volumeFactor = Number(config?.volumeFactor) || 1.5;
  const volumeSmaPeriod = Number(config?.volumeSmaPeriod) || 20;
  
  const evalDowntrendCandles = !!config?.evaluateDowntrendCandlesBlock;
  const downtrendCandles = Number(config?.downtrendCheckCandles) || 3;
  
  const evalDowntrendLevel = !!config?.evaluateDowntrendLevelsBlock;
  const downtrendLevel = Number(config?.downtrendLevelCheck) || 5;

  const evalUptrend = !!config?.evaluateRequiredUptrend;
  const requiredUptrendCandles = Number(config?.requiredUptrendCandles) || 0;

  const evalOI = !!config?.evaluateOpenInterestIncrease;
  const oiPeriod = config?.openInterestPeriod || '5m';

  const evalMA = !!config?.evaluateMaFilter;
  const maPeriod = Number(config?.maPeriod) || 200;

  // Salidas
  const enableTP = !!config?.enableTakeProfitPnl;
  const tpUSDT = Math.abs(Number(config?.takeProfitUSDT) || 20);

  const enableSL = !!config?.enableStopLossPnl;
  const slUSDT = Math.abs(Number(config?.stopLossUSDT) || 10);

  const enableTrailingRsi = !!config?.enableTrailingRsiStop;
  const rsiTarget = Number(config?.rsiTarget) || 50;
  const rsiDrop = Math.abs(Number(config?.rsiThresholdDown) || 1.0);

  const enablePriceTrailing = !!config?.enablePriceTrailingStop;
  const priceTrailingDist = Number(config?.priceTrailingStopDistanceUSDT) || 0.05;
  const priceTrailingActivationPnl = Number(config?.priceTrailingStopActivationPnlUSDT) || 0.02;

  const enablePnlTrailing = !!config?.enablePnlTrailingStop;
  const pnlTrailingActivation = Number(config?.pnlTrailingStopActivationUSDT) || 0.10;
  const pnlTrailingDrop = Number(config?.pnlTrailingStopDropUSDT) || 0.05;

  const orderTimeout = Number(config?.orderTimeoutSeconds) || 60;

  // Cálculos del simulador
  const simulation = useMemo(() => {
    const p = simulatedPrice > 0 ? simulatedPrice : 100;
    const contractUnits = positionSizeUSDT / p;

    let calcTpPrice = 0;
    let calcSlPrice = 0;
    let tpGainUSDT = 0;
    let slLossUSDT = 0;
    let tpReturnOnMargin = 0;
    let slLossOnMargin = 0;

    if (isSupportStrategy) {
      calcTpPrice = p * (1 + supportTPPercent / 100);
      calcSlPrice = p * (1 - supportSLPercent / 100);
      tpGainUSDT = positionSizeUSDT * (supportTPPercent / 100);
      slLossUSDT = positionSizeUSDT * (supportSLPercent / 100);
      tpReturnOnMargin = estimatedMargin > 0 ? (tpGainUSDT / estimatedMargin) * 100 : 0;
      slLossOnMargin = estimatedMargin > 0 ? (slLossUSDT / estimatedMargin) * 100 : 0;
    } else {
      tpGainUSDT = enableTP ? tpUSDT : 0;
      slLossUSDT = enableSL ? slUSDT : 0;
      calcTpPrice = enableTP && contractUnits > 0 ? p + (tpUSDT / contractUnits) : 0;
      calcSlPrice = enableSL && contractUnits > 0 ? p - (slUSDT / contractUnits) : 0;
      tpReturnOnMargin = estimatedMargin > 0 ? (tpGainUSDT / estimatedMargin) * 100 : 0;
      slLossOnMargin = estimatedMargin > 0 ? (slLossUSDT / estimatedMargin) * 100 : 0;
    }

    const rrRatio = slLossUSDT > 0 ? (tpGainUSDT / slLossUSDT).toFixed(2) : 'N/A';
    const pnlTrailingActivationPrice = contractUnits > 0 ? p + (pnlTrailingActivation / contractUnits) : p;

    return {
      price: p,
      contractUnits,
      tpPrice: calcTpPrice,
      slPrice: calcSlPrice,
      tpGainUSDT,
      slLossUSDT,
      tpReturnOnMargin,
      slLossOnMargin,
      rrRatio,
      pnlTrailingActivationPrice
    };
  }, [
    simulatedPrice,
    positionSizeUSDT,
    estimatedMargin,
    isSupportStrategy,
    supportTPPercent,
    supportSLPercent,
    enableTP,
    tpUSDT,
    enableSL,
    slUSDT,
    pnlTrailingActivation
  ]);

  return (
    <div className="bg-gradient-to-br from-gray-900 via-slate-900 to-gray-950 border border-blue-900/40 rounded-xl shadow-2xl p-5 mb-8 text-gray-100 transition-all duration-300">
      
      {/* Header del Radar con botón de colapsar */}
      <div className="flex items-center justify-between border-b border-gray-800 pb-4 mb-4">
        <div className="flex items-center space-x-3">
          <div className="w-9 h-9 rounded-lg bg-blue-600/20 border border-blue-500/40 flex items-center justify-center text-blue-400 text-lg shadow-inner">
            🧭
          </div>
          <div>
            <div className="flex items-center space-x-2">
              <h3 className="text-base sm:text-lg font-bold text-white tracking-wide">
                Radar de Estrategia y Simulador en Vivo
              </h3>
              <span className="flex items-center space-x-1 px-2 py-0.5 bg-emerald-950/80 border border-emerald-700/60 rounded-full text-[10.5px] font-semibold text-emerald-300">
                <span className="w-1.5 h-1.5 rounded-full bg-emerald-400 animate-ping"></span>
                <span>En Tiempo Real</span>
              </span>
            </div>
            <p className="text-xs text-gray-400 mt-0.5">
              Visualización del ciclo de ejecución, reglas lógicas dinámicas y simulación matemática.
            </p>
          </div>
        </div>

        <button
          type="button"
          onClick={() => setIsExpanded(!isExpanded)}
          className="px-3 py-1.5 text-xs font-semibold text-gray-300 bg-gray-800 hover:bg-gray-700 active:bg-gray-600 border border-gray-700 rounded-md transition-colors"
        >
          {isExpanded ? '▲ Ocultar Radar' : '▼ Ver Radar y Simulación'}
        </button>
      </div>

      {isExpanded && (
        <div className="space-y-6">
          
          {/* ======================================================== */}
          {/* 1. LÍNEA DE TIEMPO DEL CICLO DE VIDA DEL TRADE */}
          {/* ======================================================== */}
          <div>
            <div className="text-xs font-bold text-blue-400 uppercase tracking-wider mb-2.5 flex items-center">
              <span className="mr-1.5">1️⃣</span> Línea de Tiempo del Trade (Flujo Visual de Ejecución)
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3 relative">
              
              {/* PASO 1: ESCANEO */}
              <div className="bg-gray-800/70 border border-gray-700/80 rounded-lg p-3.5 relative overflow-hidden flex flex-col justify-between">
                <div className="absolute top-0 right-0 px-2 py-0.5 bg-blue-900/60 text-[10px] font-bold text-blue-300 rounded-bl">
                  PASO 1
                </div>
                <div>
                  <div className="text-xs font-bold text-blue-300 mb-1 flex items-center">
                    📡 Escaneo de Mercado
                  </div>
                  <p className="text-[11.5px] text-gray-300 leading-snug">
                    Monitorea <span className="text-white font-semibold">{symbols.length > 0 ? `${symbols.length} pares` : 'pares'}</span> en velas de <span className="text-amber-300 font-semibold">{rsiInterval}</span>.
                  </p>
                </div>
                <div className="mt-2.5 pt-2 border-t border-gray-700/60 flex flex-wrap gap-1">
                  <span className={`text-[10px] px-1.5 py-0.5 rounded font-medium ${evalMA ? 'bg-blue-950 text-blue-300 border border-blue-800' : 'bg-gray-900 text-gray-500 line-through'}`}>
                    EMA {maPeriod}
                  </span>
                  <span className={`text-[10px] px-1.5 py-0.5 rounded font-medium ${evalOI ? 'bg-purple-950 text-purple-300 border border-purple-800' : 'bg-gray-900 text-gray-500 line-through'}`}>
                    OI ({oiPeriod})
                  </span>
                </div>
              </div>

              {/* PASO 2: CONDICIÓN DISPARADORA */}
              <div className="bg-gray-800/70 border border-gray-700/80 rounded-lg p-3.5 relative overflow-hidden flex flex-col justify-between">
                <div className="absolute top-0 right-0 px-2 py-0.5 bg-cyan-900/60 text-[10px] font-bold text-cyan-300 rounded-bl">
                  PASO 2
                </div>
                <div>
                  <div className="text-xs font-bold text-cyan-300 mb-1 flex items-center">
                    ⚡ Señal de Disparo
                  </div>
                  <p className="text-[11.5px] text-gray-300 leading-snug">
                    {isSupportStrategy ? (
                      <>Rebote en soporte de precio con <span className="text-white font-semibold">≥{supportConfirmations} toques</span>.</>
                    ) : (
                      <>RSI({rsiPeriod}) en rango <span className="text-white font-semibold">{rsiLow} - {rsiHigh}</span> con Delta <span className="text-emerald-400 font-semibold">≥+{rsiThresholdUp}</span>.</>
                    )}
                  </p>
                </div>
                <div className="mt-2.5 pt-2 border-t border-gray-700/60 flex flex-wrap gap-1">
                  <span className={`text-[10px] px-1.5 py-0.5 rounded font-medium ${evalVolume ? 'bg-cyan-950 text-cyan-300 border border-cyan-800' : 'bg-gray-900 text-gray-500 line-through'}`}>
                    Vol &gt; {volumeFactor}x
                  </span>
                  <span className={`text-[10px] px-1.5 py-0.5 rounded font-medium ${evalDowntrendCandles ? 'bg-rose-950 text-rose-300 border border-rose-800' : 'bg-gray-900 text-gray-500 line-through'}`}>
                    Filtro {downtrendCandles} Rojas
                  </span>
                </div>
              </div>

              {/* PASO 3: ENTRADA / ORDEN */}
              <div className="bg-gray-800/70 border border-gray-700/80 rounded-lg p-3.5 relative overflow-hidden flex flex-col justify-between">
                <div className="absolute top-0 right-0 px-2 py-0.5 bg-amber-900/60 text-[10px] font-bold text-amber-300 rounded-bl">
                  PASO 3
                </div>
                <div>
                  <div className="text-xs font-bold text-amber-300 mb-1 flex items-center">
                    🛒 Colocación de Orden
                  </div>
                  <p className="text-[11.5px] text-gray-200 leading-snug">
                    Tamaño de posición: <span className="text-white font-bold text-xs">${positionSizeUSDT.toLocaleString()} USDT</span> en contratos.
                  </p>
                  <p className="text-[10.5px] text-gray-400 mt-1">
                    (Margen en billetera: <strong className="text-emerald-400">${estimatedMargin.toFixed(2)} USDT</strong> con apalancamiento <strong className="text-amber-400">{leverage}x</strong>)
                  </p>
                </div>
                <div className="mt-2.5 pt-2 border-t border-gray-700/60 text-[10.5px] text-gray-400 flex items-center justify-between">
                  <span>Tipo: <strong className="text-white">LIMIT BUY</strong></span>
                  <span>Timeout: <strong className="text-white">{orderTimeout}s</strong></span>
                </div>
              </div>

              {/* PASO 4: BLINDAJE & SALIDA */}
              <div className="bg-gray-800/70 border border-gray-700/80 rounded-lg p-3.5 relative overflow-hidden flex flex-col justify-between">
                <div className="absolute top-0 right-0 px-2 py-0.5 bg-emerald-900/60 text-[10px] font-bold text-emerald-300 rounded-bl">
                  PASO 4
                </div>
                <div>
                  <div className="text-xs font-bold text-emerald-300 mb-1 flex items-center">
                    🛡️ Gestión & Salida
                  </div>
                  <p className="text-[11.5px] text-gray-300 leading-snug">
                    {enableTP && `TP: +${Number(tpUSDT).toFixed(2)} USDT. `}
                    {enableSL && `SL: -${Number(slUSDT).toFixed(2)} USDT. `}
                    {enablePnlTrailing && `Trailing PnL activo (+${Number(pnlTrailingActivation).toFixed(2)} USDT).`}
                  </p>
                </div>
                <div className="mt-2.5 pt-2 border-t border-gray-700/60 flex flex-wrap gap-1">
                  <span className={`text-[10px] px-1.5 py-0.5 rounded font-medium ${enableTP ? 'bg-emerald-950 text-emerald-300 border border-emerald-800' : 'bg-gray-900 text-gray-500'}`}>
                    TP {enableTP ? `+$${Number(tpUSDT).toFixed(2)}` : 'OFF'}
                  </span>
                  <span className={`text-[10px] px-1.5 py-0.5 rounded font-medium ${enableSL ? 'bg-red-950 text-red-300 border border-red-800' : 'bg-gray-900 text-gray-500'}`}>
                    SL {enableSL ? `-$${Number(slUSDT).toFixed(2)}` : 'OFF'}
                  </span>
                  <span className={`text-[10px] px-1.5 py-0.5 rounded font-medium ${enablePnlTrailing ? 'bg-purple-950 text-purple-300 border border-purple-800' : 'bg-gray-900 text-gray-500'}`}>
                    Trail PnL {enablePnlTrailing ? 'ON' : 'OFF'}
                  </span>
                </div>
              </div>

            </div>
          </div>

          {/* ======================================================== */}
          {/* 2. REGLAS LÓGICAS EN LENGUAJE NATURAL */}
          {/* ======================================================== */}
          <div className="bg-gray-950/80 border border-gray-800 rounded-lg p-4">
            <div className="text-xs font-bold text-indigo-400 uppercase tracking-wider mb-2.5 flex items-center">
              <span className="mr-1.5">2️⃣</span> Resumen Lógico de la Estrategia en Lenguaje Natural
            </div>

            <div className="space-y-2.5 text-xs text-gray-200 leading-relaxed">
              
              {/* ENTRADA */}
              <div className="bg-gray-900/90 border border-gray-800 p-2.5 rounded">
                <span className="font-bold text-emerald-400 block mb-1">
                  🟢 REGLA DE COMPRA (Condiciones requeridas en simultáneo):
                </span>
                <ul className="list-disc list-inside space-y-1 text-gray-300 ml-1">
                  {isSupportStrategy ? (
                    <li>
                      Escanear las últimas <strong className="text-white">{supportHistoryCandles} velas</strong> en busca de un soporte con al menos <strong className="text-white">{supportConfirmations} toques</strong> (tolerancia de ±{supportTolerance}%).
                    </li>
                  ) : (
                    <>
                      {evalRsiDelta && (
                        <li>
                          El indicador <strong>RSI({rsiPeriod})</strong> en velas de <strong>{rsiInterval}</strong> debe aumentar al menos <strong className="text-emerald-300">+{rsiThresholdUp} puntos</strong> respecto a la vela anterior confirmando impulso comprador.
                        </li>
                      )}
                      {evalRsiRange && (
                        <li>
                          El RSI actual debe ubicarse estrictamente en la franja permitida entre <strong className="text-white">{rsiLow}.0</strong> y <strong className="text-white">{rsiHigh}.0</strong>.
                        </li>
                      )}
                      {evalVolume && (
                        <li>
                          El volumen de la vela debe ser al menos <strong className="text-cyan-300">{volumeFactor}x</strong> mayor al promedio móvil de las últimas <strong>{volumeSmaPeriod} velas</strong>.
                        </li>
                      )}
                      {evalDowntrendCandles && (
                        <li>
                          Se bloquea la entrada si se detectan <strong className="text-rose-300">{downtrendCandles} velas rojas seguidas</strong> para no comprar en cascada bajista.
                        </li>
                      )}
                      {evalDowntrendLevel && (
                        <li>
                          Se bloquea si el RSI se desplomó más de <strong className="text-rose-300">{downtrendLevel} puntos</strong> en las velas recientes.
                        </li>
                      )}
                      {evalUptrend && requiredUptrendCandles > 0 && (
                        <li>
                          Exige al menos <strong className="text-emerald-300">{requiredUptrendCandles} vela(s) verde(s)</strong> consecutiva(s) para confirmar el rebote.
                        </li>
                      )}
                      {evalOI && (
                        <li>
                          El <strong>Interés Abierto (OI)</strong> debe haber crecido en los últimos <strong>{oiPeriod}</strong> (ingreso de dinero institucional).
                        </li>
                      )}
                      {evalMA && (
                        <li>
                          El precio actual debe cotizar <strong>por encima de la Media Móvil (EMA {maPeriod})</strong> indicando tendencia alcista.
                        </li>
                      )}
                    </>
                  )}
                </ul>

                {/* --- LÍNEA SIMPLE, DESTACADA Y VISIBLE --- */}
                <div className="mt-3 bg-gradient-to-r from-emerald-950/90 via-gray-900 to-emerald-950/90 border border-emerald-500/50 rounded-lg px-3.5 py-2.5 flex flex-wrap items-center justify-between gap-2 text-xs shadow-md">
                  <div className="flex items-center space-x-2">
                    <span className="text-emerald-400 font-extrabold text-sm">⚡ ACCIÓN:</span>
                    <span className="text-gray-100">
                      Abre orden <strong className="text-white">LIMIT BUY</strong> por un tamaño de posición de <strong className="text-emerald-300 font-bold text-sm">${positionSizeUSDT.toLocaleString()} USDT</strong> en contratos
                    </span>
                  </div>
                  <div className="flex items-center space-x-1.5 text-[11.5px] bg-black/50 px-2.5 py-1 rounded border border-emerald-800/50 text-gray-300">
                    <span>Margen Billetera: <strong className="text-emerald-400">${estimatedMargin.toFixed(2)} USDT</strong></span>
                    <span className="text-gray-500">•</span>
                    <span>Apalancamiento: <strong className="text-amber-400">{leverage}x</strong></span>
                  </div>
                </div>
              </div>

              {/* SALIDA */}
              <div className="bg-gray-900/90 border border-gray-800 p-2.5 rounded">
                <span className="font-bold text-rose-400 block mb-1">
                  🔴 REGLA DE SALIDA (Se cerrará la posición por la primera condición que ocurra):
                </span>
                <ul className="list-disc list-inside space-y-1 text-gray-300 ml-1">
                  {isSupportStrategy ? (
                    <>
                      <li><strong>Take Profit Automático:</strong> Cierra con orden LIMIT al subir un <strong className="text-emerald-300">+{supportTPPercent}%</strong> desde el soporte.</li>
                      <li><strong>Stop Loss de Protección:</strong> Corta pérdidas si cae un <strong className="text-rose-300">-{supportSLPercent}%</strong> por debajo del soporte.</li>
                    </>
                  ) : (
                    <>
                      {enableTP && (
                        <li>
                          <strong>Take Profit Fijo:</strong> Cierra inmediatamente a mercado al alcanzar <strong className="text-emerald-300">+{Number(tpUSDT).toFixed(2)} USDT</strong> de ganancia neta.
                        </li>
                      )}
                      {enableSL && (
                        <li>
                          <strong>Stop Loss Fijo:</strong> Cierra de inmediato si la pérdida no realizada toca <strong className="text-rose-300">-{Number(slUSDT).toFixed(2)} USDT</strong>.
                        </li>
                      )}
                      {enablePnlTrailing && (
                        <li>
                          <strong>Trailing Stop por PnL:</strong> Se arma en cuanto la posición gane <strong className="text-purple-300">+{Number(pnlTrailingActivation).toFixed(2)} USDT</strong>; si la ganancia retrocede <strong className="text-amber-300">{Number(pnlTrailingDrop).toFixed(2)} USDT</strong> desde el pico más alto, vende y consolida ganancias.
                        </li>
                      )}
                      {enableTrailingRsi && (
                        <li>
                          <strong>Trailing Stop por RSI:</strong> Se activa si el RSI alcanza <strong className="text-blue-300">{rsiTarget}</strong>; si luego cae <strong className="text-amber-300">{rsiDrop} puntos</strong> desde el RSI máximo, cierra la posición.
                        </li>
                      )}
                      {enablePriceTrailing && (
                        <li>
                          <strong>Trailing Stop por Precio:</strong> Se arma con <strong className="text-blue-300">+{Number(priceTrailingActivationPnl).toFixed(2)} USDT</strong> de ganancia y persigue al precio a una distancia fija de <strong className="text-amber-300">${priceTrailingDist}</strong>.
                        </li>
                      )}
                    </>
                  )}
                </ul>

                {/* --- AVISOS INTELIGENTES DE INCONSISTENCIAS O CONFIGURACIÓN --- */}
                {enableSL && enableTP && slUSDT > tpUSDT * 2 && (
                  <div className="mt-2 p-2 bg-rose-950/60 border border-rose-800/80 rounded text-rose-200 text-[11px] flex items-start space-x-1.5">
                    <span className="text-rose-400 font-bold">⚠️ RIESGO DESPROPORCIONADO:</span>
                    <span>
                      Tu Stop Loss (-{Number(slUSDT).toFixed(2)} USDT) es {Math.round(slUSDT / (tpUSDT || 1))}x mayor que tu Take Profit (+{Number(tpUSDT).toFixed(2)} USDT). Estás arriesgando perder mucho para ganar poco (Ratio {simulation.rrRatio}:1). Se recomienda ajustar un Stop Loss más cercano.
                    </span>
                  </div>
                )}

                {enablePnlTrailing && enableTP && pnlTrailingActivation < tpUSDT && (
                  <div className="mt-1.5 p-2 bg-blue-950/60 border border-blue-800/80 rounded text-blue-200 text-[11px] flex items-start space-x-1.5">
                    <span className="text-blue-400 font-bold">ℹ️ PRIORIDAD DE SALIDA:</span>
                    <span>
                      El Trailing PnL se activará primero a +{Number(pnlTrailingActivation).toFixed(2)} USDT. Si hay un retroceso de {Number(pnlTrailingDrop).toFixed(2)} USDT, el bot cerrará la posición antes de llegar al Take Profit Fijo de +{Number(tpUSDT).toFixed(2)} USDT.
                    </span>
                  </div>
                )}
              </div>

            </div>
          </div>

          {/* ======================================================== */}
          {/* 3. SIMULADOR DE ESCENARIO REAL */}
          {/* ======================================================== */}
          <div className="bg-gradient-to-r from-blue-950/40 via-slate-900/60 to-purple-950/40 border border-blue-800/40 rounded-lg p-4">
            <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-2 mb-3">
              <div className="text-xs font-bold text-amber-400 uppercase tracking-wider flex items-center">
                <span className="mr-1.5">3️⃣</span> Simulador de Escenario Numérico en Vivo
              </div>
              <div className="flex items-center space-x-2">
                <label htmlFor="simPrice" className="text-xs text-gray-400">
                  Precio de Referencia:
                </label>
                <div className="relative">
                  <span className="absolute inset-y-0 left-0 pl-2 flex items-center text-xs text-gray-400">$</span>
                  <input
                    type="number"
                    id="simPrice"
                    value={simulatedPrice}
                    onChange={(e) => setSimulatedPrice(parseFloat(e.target.value) || 0)}
                    step="any"
                    min="0.000001"
                    className="w-24 pl-5 pr-2 py-1 bg-gray-900 border border-gray-700 rounded text-xs font-bold text-white focus:outline-none focus:ring-1 focus:ring-blue-500"
                  />
                </div>
              </div>
            </div>

            <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 text-center">
              
              {/* TAMAÑO POSICIÓN / MARGEN */}
              <div className="bg-gray-900/80 p-2.5 rounded border border-gray-800">
                <div className="text-[11px] text-gray-400 font-medium">💵 Posición / Margen</div>
                <div className="text-sm font-bold text-white mt-0.5">
                  <span className="text-emerald-400">${positionSizeUSDT} USDT</span> <span className="text-[10.5px] text-amber-400 font-normal">({leverage}x)</span>
                </div>
                <div className="text-[10px] text-gray-300 mt-0.5">
                  Margen: <strong className="text-emerald-400">${estimatedMargin.toFixed(2)} USDT</strong> ({simulation.contractUnits.toFixed(2)} uds)
                </div>
              </div>

              {/* TAKE PROFIT OBJETIVO */}
              <div className="bg-gray-900/80 p-2.5 rounded border border-gray-800">
                <div className="text-[11px] text-emerald-400 font-medium">🎯 Take Profit Precio</div>
                <div className="text-sm font-bold text-emerald-300 mt-0.5">
                  {simulation.tpPrice > 0 ? `$${simulation.tpPrice.toFixed(4)}` : 'Desactivado'}
                </div>
                <div className="text-[10px] text-emerald-400/80 mt-0.5">
                  {simulation.tpGainUSDT > 0 ? `+${simulation.tpGainUSDT.toFixed(2)} USDT (+${simulation.tpReturnOnMargin.toFixed(1)}% ROI)` : '-'}
                </div>
              </div>

              {/* STOP LOSS PRECIO */}
              <div className="bg-gray-900/80 p-2.5 rounded border border-gray-800">
                <div className="text-[11px] text-rose-400 font-medium">🛑 Stop Loss Precio</div>
                <div className="text-sm font-bold text-rose-300 mt-0.5">
                  {simulation.slPrice > 0 ? `$${simulation.slPrice.toFixed(4)}` : 'Desactivado'}
                </div>
                <div className="text-[10px] text-rose-400/80 mt-0.5">
                  {simulation.slLossUSDT > 0 ? `-${simulation.slLossUSDT.toFixed(2)} USDT (-${simulation.slLossOnMargin.toFixed(1)}% ROI)` : '-'}
                </div>
              </div>

              {/* RATIO R:R */}
              <div className="bg-gray-900/80 p-2.5 rounded border border-gray-800">
                <div className="text-[11px] text-purple-400 font-medium">⚖️ Ratio Riesgo / Beneficio</div>
                <div className="text-sm font-bold text-purple-300 mt-0.5">
                  {simulation.rrRatio !== 'N/A' ? `${simulation.rrRatio} : 1` : 'N/A'}
                </div>
                <div className="text-[10px] text-gray-400 mt-0.5">
                  {simulation.rrRatio >= 1.5 ? '✅ Favorable' : simulation.rrRatio !== 'N/A' ? '⚠️ Ajustado' : 'Sin SL/TP fijo'}
                </div>
              </div>

            </div>

          </div>

        </div>
      )}

    </div>
  );
}

export default StrategyRadar;
