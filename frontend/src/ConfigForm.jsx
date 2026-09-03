import React, { useState, useEffect } from 'react';
import Tooltip from './Tooltip'; // Importar el nuevo componente
import StrategyRadar from './StrategyRadar'; // Radar de Estrategia y Simulador en Vivo

// --- Definiciones de Componentes Auxiliares ---
function ConfigSection({ title, className, children }) {
  return (
    <fieldset className={`border pt-4 px-4 pb-6 rounded-md border-gray-300 dark:border-gray-600 ${className || ''}`}>
      <legend className="text-base font-medium text-gray-900 dark:text-gray-100 px-2">{title}</legend>
      <div className="mt-4">
        {children}
      </div>
    </fieldset>
  );
}

function ConfigItem({ labelText, htmlFor, description, example, tooltipKey, tooltipText, checkboxName, isChecked, onCheckboxChange, children }) {
  const info = tooltipKey && tooltipTexts[tooltipKey] ? tooltipTexts[tooltipKey] : null;
  const displayDesc = description || (info ? info.desc : (typeof tooltipText === 'object' ? tooltipText.desc : tooltipText));
  const displayExample = example || (info ? info.example : (typeof tooltipText === 'object' ? tooltipText.example : null));

  return (
    <div className="bg-gray-50/80 dark:bg-gray-900/60 p-3.5 rounded-lg border border-gray-200 dark:border-gray-700/70 flex flex-col justify-between hover:border-gray-300 dark:hover:border-gray-600 transition-all shadow-sm">
      <div>
        {/* Header con Título + Tooltip + (Opcional) Toggle de Activado */}
        <div className="flex items-center justify-between mb-1.5 min-h-[26px]">
          <div className="flex items-center space-x-1">
            <label htmlFor={htmlFor} className="block text-xs font-bold text-gray-800 dark:text-gray-200">
              {labelText}
            </label>
            {(info || tooltipText) && (
              <Tooltip text={displayDesc} example={displayExample} title={labelText} />
            )}
          </div>
          {checkboxName && (
            <label htmlFor={checkboxName} className="flex items-center cursor-pointer select-none">
              <input
                id={checkboxName}
                name={checkboxName}
                type="checkbox"
                checked={isChecked}
                onChange={onCheckboxChange}
                className="h-4 w-4 text-primary-600 border-gray-300 rounded focus:ring-primary-500 dark:bg-gray-700 dark:border-gray-600 cursor-pointer"
              />
              <span className={`ml-1.5 text-[11px] font-bold px-1.5 py-0.5 rounded transition-colors ${
                isChecked
                  ? 'bg-green-100 text-green-800 dark:bg-green-900/60 dark:text-green-300 border border-green-700/40'
                  : 'bg-gray-100 text-gray-500 dark:bg-gray-800 dark:text-gray-400 border border-gray-700/40'
              }`}>
                {isChecked ? 'Activado' : 'Desactivado'}
              </span>
            </label>
          )}
        </div>

        {/* Input Form Control (Siempre ubicado arriba a la misma altura uniforme) */}
        <div className="mt-1">
          {children}
        </div>
      </div>

      {/* Descripción y Ejemplo (Siempre ubicado abajo de forma compacta y alineada) */}
      {(displayDesc || displayExample) && (
        <div className="mt-2.5 pt-2 border-t border-gray-200/60 dark:border-gray-700/60 space-y-0.5">
          {displayDesc && (
            <p className="text-[11px] text-gray-500 dark:text-gray-400 leading-snug">
              {displayDesc}
            </p>
          )}
          {displayExample && (
            <p className="text-[10.5px] text-amber-600 dark:text-amber-400 font-medium leading-snug">
              <span className="font-semibold">💡 Ej:</span> {displayExample}
            </p>
          )}
        </div>
      )}
    </div>
  );
}
// --- Fin Definiciones de Componentes Auxiliares ---

// Valores iniciales o por defecto para el formulario
const defaultConfigValues = {
  symbolsToTrade: '',
  leverage: 20,
  rsiInterval: '5m',
  rsiPeriod: 14,
  rsiThresholdUp: 1.5,
  rsiThresholdDown: -1.0,
  rsiEntryLevelLow: 30,
  rsiEntryLevelHigh: 75,
  rsiTarget: 50,
  volumeSmaPeriod: 20,
  volumeFactor: 1.5,
  downtrendCheckCandles: 3,
  downtrendLevelCheck: 5,
  requiredUptrendCandles: 0,
  positionSizeUSDT: 50,
  stopLossUSDT: -10,
  takeProfitUSDT: 20,
  cycleSleepSeconds: 5,
  mode: 'paper',
  orderTimeoutSeconds: 60,
  evaluateRsiDelta: true,
  evaluateVolumeFilter: true,
  evaluateRsiRange: true,
  evaluateDowntrendCandlesBlock: true,
  evaluateDowntrendLevelsBlock: true,
  evaluateRequiredUptrend: true,
  enableTakeProfitPnl: true,
  enableStopLossPnl: true,
  enableTrailingRsiStop: true,
  enablePriceTrailingStop: true,
  priceTrailingStopDistanceUSDT: 0.05,
  priceTrailingStopActivationPnlUSDT: 0.02,
  enablePnlTrailingStop: true,
  pnlTrailingStopActivationUSDT: 0.1,
  pnlTrailingStopDropUSDT: 0.05,
  evaluateOpenInterestIncrease: true,
  openInterestPeriod: '5m',
  evaluateMaFilter: false,
  maPeriod: 200,
  maType: 'EMA',

  // --- NUEVO: Valores por defecto para Estrategia de Soportes ---
  evaluateSupportStrategy: false,
  supportHistoryCandles: 200,
  supportPivotWindow: 5,
  supportConfirmations: 2,
  supportLevelTolerancePercent: 0.5,
  supportOrderStopLossPercent: 2.0,
  supportOrderTakeProfitPercent: 4.0,

  // --- NUEVO: Valores por defecto para Re-entradas DCA ---
  enableDcaReentry: false,
  dcaReentryMode: 'fixed_percent',
  dcaPriceDropPercent: 1.5,
  dcaMaxReentries: 2,
  dcaVolumeMultiplier: 1.0,
};

// --- Diccionario profesional con Explicación y Ejemplo Práctico para cada Parámetro ---
const tooltipTexts = {
  // General & Riesgo
  mode: {
    desc: "Define el entorno de operación de Binance Futures.",
    example: "🛡️ Testnet / Simulación para operar seguro sin arriesgar capital real."
  },
  leverage: {
    desc: "Multiplicador de apalancamiento en Binance Futures. Reduce el margen real que se descuenta de tu saldo para sostener el tamaño de posición configurado.",
    example: "Con 5x y un tamaño de posición de 50 USDT, solo se retienen 10 USDT de margen de tu billetera (50 / 5x)."
  },
  positionSizeUSDT: {
    desc: "Tamaño o valor nocional de la orden en USDT que se abrirá y se verá reflejado en tu posición de Binance.",
    example: "Si colocas 50 USDT, tu posición en Binance mostrará un tamaño de 50 USDT en contratos. El margen real deducido de tu billetera será proporcional al apalancamiento (ej: con 5x son 10 USDT)."
  },
  rsi_interval: {
    desc: "Temporalidad (timeframe) de las velas japonesas usadas para el análisis técnico.",
    example: "'5m' analiza velas de 5 minutos; '1m' para scalping ultrarrápido; '15m' para mayor estabilidad."
  },
  symbolsToTrade: {
    desc: "Lista de pares de futuros USDT que el bot monitorea y opera simultáneamente.",
    example: "BTCUSDT,ETHUSDT,SOLUSDT,ADAUSDT,ONDOUSDT (separados por coma, sin espacios)."
  },
  riskPercentage: {
    desc: "Porcentaje máximo de tu balance total permitido en margen sumando todas las posiciones abiertas.",
    example: "Con 50% y balance de 1,000 USDT, el bot bloquea nuevas compras si el margen abierto supera 500 USDT."
  },

  // Estrategia de Entrada
  rsi_period: {
    desc: "Cantidad de velas históricas usadas para calcular el indicador RSI.",
    example: "14 velas (estándar tradicional) o 7 velas (para un RSI más rápido y reactivo a scalping)."
  },
  rsiThresholdUp: {
    desc: "Aumento mínimo de RSI requerido en la última medición respecto al ciclo anterior (Delta RSI) para validar impulso.",
    example: "Con 1.0, si el RSI sube de 35.0 a 36.5 (delta +1.5), se considera señal válida de rebote."
  },
  rsiEntryLevelLow: {
    desc: "Nivel mínimo de RSI permitido para abrir compra. Evita comprar durante caídas libres extremas.",
    example: "Con 25, si el RSI es 28 compra normalmente; si el RSI cae a 18 (desplome vertical), bloquea la entrada."
  },
  rsiEntryLevelHigh: {
    desc: "Nivel máximo de RSI permitido para abrir compra. Evita comprar en la cima de un mercado sobrecomprado.",
    example: "Con 75, si el RSI ya está en 82 (sobrecompra extrema), no compra para evitar trampas alcistas."
  },
  volumeSmaPeriod: {
    desc: "Cantidad de velas para calcular la Media Móvil Simple (SMA) del volumen promedio de referencia.",
    example: "20 velas calcula el promedio de volumen de las últimas 20 velas."
  },
  volumeFactor: {
    desc: "Multiplicador sobre el volumen promedio. El volumen actual de la vela debe ser mayor a (Promedio * Factor).",
    example: "Con factor 1.5 y promedio de 10,000 USDT, la vela actual debe tener al menos 15,000 USDT para comprar."
  },
  downtrendCheckCandles: {
    desc: "Bloquea compras si se detectan N velas consecutivas cerrando a la baja (velas rojas).",
    example: "Con 3, si hay 3 velas rojas consecutivas, el bot espera a que frene la caída antes de comprar."
  },
  downtrendLevelCheck: {
    desc: "Bloquea compras si el RSI ha caído este número de puntos en las velas recientes.",
    example: "Con 5, si el RSI cayó bruscamente de 48 a 41 (caída de 7 puntos), bloquea la compra temporalmente."
  },
  requiredUptrendCandles: {
    desc: "Exige N velas verdes consecutivas cerrando al alza para confirmar giro alcista antes de entrar.",
    example: "Con 1, exige que la última vela haya cerrado en verde para confirmar rebote."
  },
  evaluateOpenInterestIncrease: {
    desc: "Exige que el Interés Abierto (capital institucional en futuros) esté aumentando en el período fijado.",
    example: "Con período '5m', verifica que el dinero en contratos de futuros haya subido en los últimos 5 min."
  },

  // Media Móvil
  evaluateMaFilter: {
    desc: "Filtro de tendencia general. Solo permite comprar si el precio actual está por encima de la media móvil.",
    example: "Si el precio es 0.22$ y la EMA 200 está en 0.20$, autoriza compras (tendencia alcista)."
  },
  maPeriod: {
    desc: "Número de velas para calcular la Media Móvil Exponencial (EMA).",
    example: "200 velas representa el soporte dinámico institucional de largo plazo."
  },

  // Soportes
  evaluateSupportStrategy: {
    desc: "Activa la búsqueda y compra en soportes y rebotes de precio (desactiva la estrategia RSI).",
    example: "El bot detecta pisos históricos donde el precio rebotó y coloca órdenes LIMIT de compra."
  },
  supportHistoryCandles: {
    desc: "Cantidad de velas históricas analizadas para identificar niveles de suelo y soporte.",
    example: "200 velas analiza las últimas 200 velas (aprox. 16 horas en gráfico de 5m)."
  },
  supportPivotWindow: {
    desc: "Velas a izquierda y derecha requeridas para validar un punto mínimo como pivote de soporte.",
    example: "5 velas exige que el precio sea el punto más bajo de 5 velas antes y 5 velas después."
  },
  supportConfirmations: {
    desc: "Cantidad mínima de toques y rebotes que el precio debe haber tenido en ese nivel para validarlo.",
    example: "2 confirmaciones exige que el precio haya rebotado al menos 2 veces en esa zona de precio."
  },
  supportLevelTolerancePercent: {
    desc: "Porcentaje de tolerancia para agrupar toques cercanos en una misma franja de soporte.",
    example: "0.5% agrupa toques entre 9.95$ y 10.05$ como un único soporte en 10.00$."
  },
  supportOrderStopLossPercent: {
    desc: "Porcentaje por debajo del soporte donde se colocará el Stop Loss de protección.",
    example: "2.0% coloca el Stop Loss 2% por debajo del precio de compra en el soporte."
  },
  supportOrderTakeProfitPercent: {
    desc: "Porcentaje por encima del soporte donde se colocará el Take Profit objetivo.",
    example: "4.0% coloca el Take Profit 4% por encima del precio de compra en el soporte."
  },

  // Re-entradas y Órdenes de Seguridad (DCA)
  enableDcaReentry: {
    desc: "Activa compras escalonadas (Scale-In / DCA) si el precio sigue cayendo tras abrir una posición, promediando el precio de entrada a la baja.",
    example: "Si compraste a $100 y cae a $98.5, coloca una orden adicional para bajar tu precio de entrada promedio a $99.25."
  },
  dcaReentryMode: {
    desc: "Método para determinar el precio de la siguiente compra: por porcentaje fijo de caída o por el siguiente soporte inferior confirmado.",
    example: "'Porcentaje Fijo' compra a -1.5% de caída; 'Siguiente Soporte' compra en el siguiente suelo institucional detectado."
  },
  dcaPriceDropPercent: {
    desc: "Porcentaje de caída desde el precio de entrada requerido para activar y colocar la siguiente orden de re-entrada.",
    example: "Con 1.5%, si entraste en $10.00, la orden de seguridad se coloca en $9.85 (-1.5%)."
  },
  dcaMaxReentries: {
    desc: "Cantidad máxima de compras adicionales (re-entradas) permitidas por moneda en una misma operación.",
    example: "Con 2, el bot hará como máximo 2 compras de seguridad (1 orden inicial + hasta 2 adicionales)."
  },
  dcaVolumeMultiplier: {
    desc: "Multiplicador de tamaño (margen) para cada re-entrada respecto a la orden base (Martingala suave).",
    example: "Con 1.5x y orden base de 20 USDT, la 1ª re-entrada será de 30 USDT ($20 * 1.5) para bajar el precio promedio más rápido."
  },

  // Trailing Stops y Salidas
  takeProfitUSDT: {
    desc: "Ganancia neta fija en USDT a la que el bot cerrará la posición inmediatamente.",
    example: "Con 30 USDT, en cuanto el PnL llegue a +30.00 USDT, vende la posición al instante."
  },
  stopLossUSDT: {
    desc: "Pérdida máxima tolerada en USDT antes de cerrar la posición para proteger el capital.",
    example: "Con 20 USDT, si el PnL cae a -20.00 USDT, cierra todo inmediatamente para cortar pérdidas."
  },
  rsiTarget: {
    desc: "Nivel de RSI necesario para armar el Trailing Stop por RSI y empezar a rastrear el pico de RSI.",
    example: "Con 50, cuando el RSI sube a 50 o más, el bot se pone en alerta y registra el pico más alto (ej: 65)."
  },
  rsiThresholdDown: {
    desc: "Caída de puntos RSI permitida desde el pico máximo alcanzado antes de cerrar la posición.",
    example: "Con -8, si el RSI llegó a un pico de 65 y cae a 57 (65 - 8), el bot vende asegurando la subida."
  },
  priceTrailingStopDistanceUSDT: {
    desc: "Distancia fija en dólares que sigue al precio más alto alcanzado por el activo.",
    example: "Con 0.05$ y precio pico de 1.50$, el stop de venta se sitúa en 1.45$ y sube si el precio sube."
  },
  priceTrailingStopActivationPnlUSDT: {
    desc: "Ganancia en USDT requerida en la posición para armar el Trailing Stop por Precio.",
    example: "Con 0.02 USDT, no rastrea precio hasta que la posición esté en positivo por al menos 0.02 USDT."
  },
  pnlTrailingStopActivationUSDT: {
    desc: "Ganancia en USDT requerida para armar el Trailing Stop de PnL y empezar a seguir la ganancia pico.",
    example: "Con 0.10 USDT, en cuanto ganas 0.10 USDT se arma y sigue el PnL máximo alcanzado (ej: +4.00 USDT)."
  },
  pnlTrailingStopDropUSDT: {
    desc: "Caída de ganancia permitida en USDT desde el PnL pico antes de cerrar la posición con ganancias.",
    example: "Con 0.05 USDT y pico de +4.00 USDT, cierra si baja a +3.95 USDT, asegurando +3.95 USDT."
  },

  // Otros Parámetros
  cycleSleepSeconds: {
    desc: "Pausa en segundos entre cada ciclo de análisis y evaluación del bot.",
    example: "5 segundos (rápido para scalping en velas 1m/5m) o 15 segundos para menor consumo de CPU/API."
  },
  orderTimeoutSeconds: {
    desc: "Tiempo máximo en segundos que una orden LIMIT espera ser ejecutada antes de cancelarse.",
    example: "10 segundos cancela la orden si el precio se escapó y no se llenó en 10s para no quedar atrapado."
  }
};


const FormSection = ({ title, children }) => (
  <div className="bg-gray-800 p-6 rounded-lg shadow-xl text-white mb-8">
    <h2 className="text-2xl font-bold mb-6">{title}</h2>
    {children}
  </div>
);

function ConfigForm({ 
  initialConfig: propInitialConfig, 
  onSave, 
  availableStrategies, 
  onRefreshStrategies,
  isLoadingStrategies,
  strategyError,
  onStrategyNameChange
}) {
  const [formData, setFormData] = useState(defaultConfigValues);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState(null);
  const [showSuccessMessage, setShowSuccessMessage] = useState(false);
  
  // --- ESTADOS MOVIDOS DESDE RiskDisplay ---
  const [riskData, setRiskData] = useState(null);
  const [riskError, setRiskError] = useState('');
  // --- FIN ESTADOS MOVIDOS ---
  
  const [riskPercentage, setRiskPercentage] = useState(50);

  // --- Estados para la gestión unificada de estrategias ---
  const [strategyNameInput, setStrategyNameInput] = useState('');
  const [selectedStrategyToLoad, setSelectedStrategyToLoad] = useState('');
  const [validationError, setValidationError] = useState(null);
  const [isLoadingSelectedStrategy, setIsLoadingSelectedStrategy] = useState(false);
  const [loadStrategyError, setLoadStrategyError] = useState(null);
  const [loadStrategySuccess, setLoadStrategySuccess] = useState(null);
  const [isDeletingStrategy, setIsDeletingStrategy] = useState(null);
  const [deleteStrategyError, setDeleteStrategyError] = useState(null);
  const [deleteStrategySuccess, setDeleteStrategySuccess] = useState(null);

  // --- LÓGICA MOVIDA DESDE RiskDisplay ---
  useEffect(() => {
    const fetchRiskData = async () => {
      try {
        const response = await fetch('/api/risk_config');
        if (!response.ok) {
          throw new Error('La respuesta del servidor no fue OK');
        }
        const data = await response.json();
        setRiskData(data);
        setRiskError('');
      } catch (err) {
        setRiskError('Error al cargar los datos de riesgo. ¿Está el backend en funcionamiento?');
        console.error(err);
      }
    };

    fetchRiskData();
    const intervalId = setInterval(fetchRiskData, 5000);
    return () => clearInterval(intervalId);
  }, []);

  // --- Sincronizar formData cuando cambia propInitialConfig ---
  useEffect(() => {
    if (propInitialConfig && Object.keys(propInitialConfig).length > 0) {
      const newFormData = { ...defaultConfigValues };
      for (const key in propInitialConfig) {
        if (propInitialConfig[key] !== undefined) {
          newFormData[key] = propInitialConfig[key];
        }
      }
      if (propInitialConfig.downtrend_level_check !== undefined) {
        newFormData.downtrendLevelCheck = propInitialConfig.downtrend_level_check;
      }
      setFormData(newFormData);

      const stratName = propInitialConfig.activeStrategyName || propInitialConfig.active_strategy_name;
      if (stratName && stratName !== 'N/A' && stratName !== 'Configuración Modificada') {
        setStrategyNameInput(stratName);
        setSelectedStrategyToLoad(stratName);
        if (onStrategyNameChange) {
          onStrategyNameChange(stratName);
        }
      }
    }
  }, [propInitialConfig, onStrategyNameChange]);

  // Carga inicial de fallback si no se pasó propInitialConfig
  useEffect(() => {
    if (!propInitialConfig) {
      const fetchInitialConfig = async () => {
        try {
          const response = await fetch('/api/config');
          if (response.ok) {
            const data = await response.json();
            const newFormData = { ...defaultConfigValues, ...data };
            setFormData(newFormData);
            const stratName = data.activeStrategyName || data.active_strategy_name;
            if (stratName && stratName !== 'N/A' && stratName !== 'Configuración Modificada') {
              setStrategyNameInput(stratName);
              setSelectedStrategyToLoad(stratName);
              if (onStrategyNameChange) {
                onStrategyNameChange(stratName);
              }
            }
          }
        } catch (err) {
          console.error("Error al cargar config:", err);
        }
      };
      fetchInitialConfig();
    }
  }, [propInitialConfig, onStrategyNameChange]);

  const handleChange = (event) => {
    const { name, value, type, checked } = event.target;
    setFormData(prevFormData => ({
      ...prevFormData,
      [name]: type === 'checkbox' ? checked : value
    }));
    setValidationError(null);
  };

  // --- Guardar y Aplicar al Bot (Atómico y Validado) ---
  const handleSaveAndApply = async (overrideName = null) => {
    setValidationError(null);
    setShowSuccessMessage(false);
    setError(null);

    const nameToSave = (overrideName || strategyNameInput || '').trim();
    if (!nameToSave) {
      setValidationError("⚠️ Debes escribir un NOMBRE para la configuración antes de guardar.");
      window.scrollTo({ top: 0, behavior: 'smooth' });
      return;
    }
    if (anySpecial(nameToSave)) {
      setValidationError("⚠️ El nombre no debe contener puntos (.), barras (/) ni caracteres especiales.");
      window.scrollTo({ top: 0, behavior: 'smooth' });
      return;
    }

    const symbols = (formData.symbolsToTrade || '').trim();
    if (!symbols) {
      setValidationError("⚠️ Debes indicar al menos un par de monedas en 'Símbolos' (ej: SOLUSDT, BTCUSDT).");
      window.scrollTo({ top: 0, behavior: 'smooth' });
      return;
    }

    setIsLoading(true);
    try {
      const dataToSend = {
        ...formData,
        activeStrategyName: nameToSave,
        symbolsToTrade: symbols
      };

      if (dataToSend.downtrendLevelCheck !== undefined) dataToSend.downtrend_level_check = dataToSend.downtrendLevelCheck;
      if (dataToSend.evaluateOpenInterestIncrease !== undefined) dataToSend.evaluate_open_interest_increase = dataToSend.evaluateOpenInterestIncrease;
      if (dataToSend.openInterestPeriod !== undefined) dataToSend.open_interest_period = dataToSend.openInterestPeriod;
      if (dataToSend.evaluateMaFilter !== undefined) dataToSend.evaluate_ma_filter = dataToSend.evaluateMaFilter;
      if (dataToSend.maType !== undefined) dataToSend.ma_type = dataToSend.maType;
      if (dataToSend.maPeriod !== undefined) dataToSend.ma_period = dataToSend.maPeriod;
      if (dataToSend.evaluateSupportStrategy !== undefined) dataToSend.evaluate_support_strategy = dataToSend.evaluateSupportStrategy;
      if (dataToSend.supportHistoryCandles !== undefined) dataToSend.support_history_candles = dataToSend.supportHistoryCandles;
      if (dataToSend.supportPivotWindow !== undefined) dataToSend.support_pivot_window = dataToSend.supportPivotWindow;
      if (dataToSend.supportConfirmations !== undefined) dataToSend.support_confirmations = dataToSend.supportConfirmations;
      if (dataToSend.supportLevelTolerancePercent !== undefined) dataToSend.support_level_tolerance_percent = dataToSend.supportLevelTolerancePercent;
      if (dataToSend.supportOrderStopLossPercent !== undefined) dataToSend.support_order_stop_loss_percent = dataToSend.supportOrderStopLossPercent;
      if (dataToSend.supportOrderTakeProfitPercent !== undefined) dataToSend.support_order_take_profit_percent = dataToSend.supportOrderTakeProfitPercent;
      if (dataToSend.enableDcaReentry !== undefined) dataToSend.enable_dca_reentry = dataToSend.enableDcaReentry;
      if (dataToSend.dcaReentryMode !== undefined) dataToSend.dca_reentry_mode = dataToSend.dcaReentryMode;
      if (dataToSend.dcaPriceDropPercent !== undefined) dataToSend.dca_price_drop_percent = dataToSend.dcaPriceDropPercent;
      if (dataToSend.dcaMaxReentries !== undefined) dataToSend.dca_max_reentries = dataToSend.dcaMaxReentries;
      if (dataToSend.dcaVolumeMultiplier !== undefined) dataToSend.dca_volume_multiplier = dataToSend.dcaVolumeMultiplier;

      const result = await onSave(dataToSend);
      if (result?.success || !result?.error) {
        setShowSuccessMessage(true);
        setSelectedStrategyToLoad(nameToSave);
        if (onStrategyNameChange) {
          onStrategyNameChange(nameToSave);
        }
        if (onRefreshStrategies) {
          onRefreshStrategies();
        }
        setTimeout(() => setShowSuccessMessage(false), 5000);
      } else {
        setValidationError(result?.error || "Error al guardar la configuración.");
      }
    } catch (err) {
      setValidationError(err.message || "Error al guardar la configuración.");
    } finally {
      setIsLoading(false);
    }
  };

  // Guardar como Nueva Versión / Copia
  const handleSaveAsNewCopy = () => {
    const defaultNewName = strategyNameInput ? `${strategyNameInput}_v2` : 'MiEstrategia_v1';
    const newName = prompt("Introduce un nuevo nombre para esta copia de la estrategia:", defaultNewName);
    if (!newName || !newName.trim()) return;
    setStrategyNameInput(newName.trim());
    handleSaveAndApply(newName.trim());
  };

  const anySpecial = (str) => {
    return ['.', '/', '\\'].some(char => str.includes(char));
  };

  // --- Funciones para Guardar y Cargar Estrategias ---
  const handleSaveRisk = async () => {
    try {
      const response = await fetch('/api/risk_config', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ risk_percentage: riskPercentage }),
      });
      if (response.ok) {
        alert('Porcentaje de riesgo guardado exitosamente.');
      } else {
        const errorData = await response.json();
        alert(`Error al guardar el riesgo: ${errorData.error || 'Error desconocido'}`);
      }
    } catch (error) {
      alert(`Error de red al guardar el riesgo: ${error}`);
    }
  };

  const handleSaveCurrentStrategy = async () => {
    if (!strategyNameInput.trim()) {
      setSaveStrategyError("Por favor, introduce un nombre para la estrategia.");
      setTimeout(() => setSaveStrategyError(null), 3000);
      return;
    }
    setIsSavingStrategy(true);
    setSaveStrategyError(null);
    setSaveStrategySuccess(null);

    try {
      const response = await fetch(`/api/strategies/${encodeURIComponent(strategyNameInput)}`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(formData), // Guardar el formData actual tal cual
      });
      const result = await response.json();
      if (!response.ok) {
        throw new Error(result.error || `Error HTTP ${response.status}`);
      }
      setSaveStrategySuccess(result.message || "Estrategia guardada con éxito.");
      if (onStrategyNameChange) {
        onStrategyNameChange(strategyNameInput); 
      }
      setStrategyNameInput(''); // Limpiar input
      onRefreshStrategies(); // Actualizar la lista de estrategias en el desplegable
      setTimeout(() => setSaveStrategySuccess(null), 3000);
    } catch (err) {
      console.error("Error saving strategy:", err);
      setSaveStrategyError(err.message || "Error al guardar la estrategia.");
      setTimeout(() => setSaveStrategyError(null), 5000);
    }
    setIsSavingStrategy(false);
  };

  const handleLoadSelectedStrategy = async (strategyName) => {
    if (!strategyName) {
      setLoadStrategyError("Por favor, selecciona una estrategia para cargar.");
      setTimeout(() => setLoadStrategyError(null), 3000);
      return;
    }
    setIsLoadingSelectedStrategy(true);
    setLoadStrategyError(null);
    setLoadStrategySuccess(null);

    try {
      const response = await fetch(`/api/strategies/${encodeURIComponent(strategyName)}`);
      const strategyData = await response.json();
      if (!response.ok) {
        throw new Error(strategyData.error || `Error HTTP ${response.status}`);
      }
      // Aquí es crucial asegurar que todos los campos que ConfigForm espera existan en strategyData,
      // o que se usen valores por defecto si faltan, para evitar errores de "controlled/uncontrolled".
      // Una forma es fusionar con defaultConfigValues.
      const newFormData = { ...defaultConfigValues, ...strategyData }; 
      setFormData(newFormData);
      setStrategyNameInput(strategyName);
      setSelectedStrategyToLoad(strategyName);
      setValidationError(null);
      if (onStrategyNameChange) {
        onStrategyNameChange(strategyName);
      }
      setLoadStrategySuccess(`Estrategia '${strategyName}' cargada con éxito. ¡Haz clic en 'Guardar y Aplicar' para dejarla activa en el bot!`);
      setTimeout(() => setLoadStrategySuccess(null), 5000);
    } catch (err) {
      console.error("Error loading strategy:", err);
      setLoadStrategyError(err.message || "Error al cargar la estrategia.");
      setTimeout(() => setLoadStrategyError(null), 5000);
    }
    setIsLoadingSelectedStrategy(false);
  };

  // --- NUEVA FUNCIÓN PARA ELIMINAR ESTRATEGIA ---
  const handleDeleteStrategy = async (strategyName) => {
    if (!window.confirm(`¿Estás seguro de que quieres eliminar la estrategia "${strategyName}"? Esta acción no se puede deshacer.`)) {
      return;
    }
    setIsDeletingStrategy(strategyName); // Indica qué estrategia se está eliminando
    setDeleteStrategyError(null);
    setDeleteStrategySuccess(null);

    try {
      const response = await fetch(`/api/strategies/${encodeURIComponent(strategyName)}`, {
        method: 'DELETE',
      });
      const result = await response.json();
      if (!response.ok) {
        throw new Error(result.error || `Error HTTP ${response.status}`);
      }
      setDeleteStrategySuccess(result.message || `Estrategia "${strategyName}" eliminada con éxito.`);
      onRefreshStrategies(); // Actualizar la lista de estrategias disponibles
      // Limpiar el input de carga si la estrategia eliminada era la seleccionada
      if (selectedStrategyToLoad === strategyName) {
        setSelectedStrategyToLoad('');
        if (onStrategyNameChange) {
          onStrategyNameChange(''); // Borrar el nombre si la estrategia activa fue eliminada
        }
      }
      setTimeout(() => setDeleteStrategySuccess(null), 3000);
    } catch (err) {
      console.error("Error deleting strategy:", err);
      setDeleteStrategyError(err.message || `Error al eliminar la estrategia "${strategyName}".`);
      setTimeout(() => setDeleteStrategyError(null), 5000);
    }
    setIsDeletingStrategy(null);
  };
  // -------------------------------------------------

  const renderLabelWithCheckbox = (fieldName, labelText, checkboxName, tooltipKey) => {
    const info = tooltipKey && tooltipTexts[tooltipKey] ? tooltipTexts[tooltipKey] : null;
    const isChecked = !!formData[checkboxName];

    return (
      <div className="flex flex-col justify-between">
        <div>
          <div className="flex items-center justify-between mb-1">
            <div className="flex items-center">
              <label htmlFor={fieldName} className="block text-sm font-semibold text-gray-700 dark:text-gray-200">
                {labelText}
              </label>
              {info && <Tooltip text={info.desc} example={info.example} title={labelText} />}
            </div>
            <label htmlFor={checkboxName} className="flex items-center cursor-pointer select-none">
              <input
                id={checkboxName}
                name={checkboxName}
                type="checkbox"
                checked={isChecked}
                onChange={handleChange}
                className="h-4 w-4 text-primary-600 border-gray-300 rounded focus:ring-primary-500 dark:bg-gray-700 dark:border-gray-600 cursor-pointer"
              />
              <span className={`ml-1.5 text-xs font-semibold px-1.5 py-0.5 rounded transition-colors ${
                isChecked
                  ? 'bg-green-100 text-green-800 dark:bg-green-900/60 dark:text-green-300'
                  : 'bg-gray-100 text-gray-500 dark:bg-gray-700 dark:text-gray-400'
              }`}>
                {isChecked ? 'Activado' : 'Desactivado'}
              </span>
            </label>
          </div>
        </div>
        {info && (
          <div className="mt-1.5 space-y-0.5">
            {info.desc && (
              <p className="text-[11.5px] text-gray-500 dark:text-gray-400 leading-tight">
                {info.desc}
              </p>
            )}
            {info.example && (
              <p className="text-[11px] text-amber-600 dark:text-amber-400 font-medium leading-tight">
                <span className="font-semibold">💡 Ej:</span> {info.example}
              </p>
            )}
          </div>
        )}
      </div>
    );
  };

  if (!propInitialConfig) {
    return <p className="text-center text-gray-500 dark:text-gray-400">Cargando configuración...</p>;
  }

  return (
    <form onSubmit={handleSubmit} className="space-y-6 bg-white dark:bg-gray-800 shadow-lg rounded-lg p-6 mb-8">
      <h2 className="text-xl font-semibold text-gray-900 dark:text-white mb-6">Configuración del Bot</h2>

      {/* ============================================================ */}
      {/* 🚀 CENTRO DE CONTROL DE ESTRATEGIA Y GUARDADO UNIFICADO       */}
      {/* ============================================================ */}
      <div className="bg-gradient-to-r from-gray-900 via-indigo-950 to-gray-900 border-2 border-indigo-500/50 rounded-2xl p-5 sm:p-6 shadow-2xl space-y-4">
        
        {/* Fila 1: Selector de Estrategia Guardada y Acciones */}
        <div className="flex flex-col md:flex-row md:items-center justify-between gap-4 pb-4 border-b border-indigo-800/50">
          <div className="flex-grow">
            <label htmlFor="selectSavedStrategy" className="block text-xs font-extrabold uppercase tracking-wider text-indigo-300 mb-1.5 flex items-center gap-1.5">
              <span>📂</span> Cargar Estrategia / Plantilla Guardada:
            </label>
            <div className="flex items-center gap-2">
              <select
                id="selectSavedStrategy"
                value={selectedStrategyToLoad}
                onChange={(e) => {
                  setSelectedStrategyToLoad(e.target.value);
                  if (e.target.value) {
                    handleLoadSelectedStrategy(e.target.value);
                  }
                }}
                className="flex-grow py-2.5 px-3.5 bg-gray-950 border border-indigo-500/60 rounded-xl text-sm font-bold text-white focus:ring-2 focus:ring-indigo-400 outline-none shadow-inner"
              >
                <option value="">-- Seleccionar Estrategia para Cargar --</option>
                {availableStrategies.map(item => {
                  const name = typeof item === 'object' ? item.name : item;
                  return <option key={name} value={name}>📁 {name}</option>;
                })}
              </select>
              {selectedStrategyToLoad && (
                <button
                  type="button"
                  onClick={() => handleDeleteStrategy(selectedStrategyToLoad)}
                  className="px-3.5 py-2.5 bg-red-950/80 hover:bg-red-900 text-red-300 border border-red-700/60 rounded-xl text-xs font-bold transition flex items-center gap-1.5 active:scale-95 shadow"
                  title="Eliminar esta estrategia"
                >
                  <span>🗑️</span>
                  <span className="hidden sm:inline">Eliminar</span>
                </button>
              )}
            </div>
          </div>

          {/* Badge Estado Activo */}
          <div className="flex flex-col justify-end">
            <span className="text-[11px] font-bold text-gray-400 uppercase tracking-wider">Estrategia Activa:</span>
            <span className="text-sm font-extrabold text-amber-400 font-mono flex items-center gap-1.5 mt-0.5">
              <span>⭐</span> {strategyNameInput || formData.activeStrategyName || 'Sin Nombre Asignado'}
            </span>
          </div>
        </div>

        {/* Fila 2: Nombre Obligatorio y Botones de Guardado */}
        <div className="flex flex-col lg:flex-row lg:items-end justify-between gap-4">
          
          {/* Input Obligatorio del Nombre */}
          <div className="flex-grow">
            <label htmlFor="strategyNameInput" className="block text-xs font-extrabold uppercase tracking-wider text-yellow-400 mb-1 flex items-center gap-1.5">
              <span>🏷️</span> Nombre de la Configuración / Estrategia <span className="text-red-400">* (Obligatorio)</span>:
            </label>
            <input 
              type="text" 
              id="strategyNameInput"
              value={strategyNameInput}
              onChange={(e) => {
                setStrategyNameInput(e.target.value);
                setValidationError(null);
              }}
              placeholder="Ej: SOPORTES_SCALPING_5M o MI_ESTRATEGIA_SOL"
              className="w-full py-2.5 px-3.5 bg-gray-950 border-2 border-yellow-500/70 focus:border-yellow-400 rounded-xl text-sm font-bold text-white placeholder-gray-500 outline-none shadow-inner"
            />
            <p className="text-[11px] text-gray-400 mt-1">
              💡 Este nombre identificará estos parámetros tanto en tu bot en vivo como en el Laboratorio de Backtesting.
            </p>
          </div>

          {/* Botones de Acción */}
          <div className="flex flex-wrap items-center gap-2.5">
            {/* Botón Principal: Guardar y Aplicar */}
            <button
              type="button"
              onClick={() => handleSaveAndApply()}
              disabled={isLoading}
              className="px-5 py-2.5 bg-gradient-to-r from-emerald-600 to-teal-600 hover:from-emerald-500 hover:to-teal-500 text-white font-extrabold text-sm rounded-xl shadow-lg shadow-emerald-900/50 transition-all flex items-center gap-2 active:scale-95 disabled:opacity-50"
            >
              <span>💾</span>
              <span>{isLoading ? 'Guardando...' : 'Guardar y Aplicar al Bot'}</span>
            </button>

            {/* Botón Secundario: Guardar como Nueva Copia */}
            <button
              type="button"
              onClick={handleSaveAsNewCopy}
              disabled={isLoading}
              className="px-4 py-2.5 bg-gray-800 hover:bg-gray-700 text-gray-200 border border-gray-600 font-bold text-xs rounded-xl shadow transition-all flex items-center gap-1.5 active:scale-95 disabled:opacity-50"
              title="Guardar una copia con otro nombre"
            >
              <span>➕</span>
              <span>Guardar Nueva Copia</span>
            </button>
          </div>
        </div>

        {/* Mensajes de Validación y Feedback */}
        {validationError && (
          <div className="p-3 bg-red-950/90 border border-red-500/70 rounded-xl text-red-200 text-xs font-bold flex items-center gap-2 animate-bounce">
            <span>⚠️</span>
            <span>{validationError}</span>
          </div>
        )}
        {showSuccessMessage && (
          <div className="p-3 bg-emerald-950/90 border border-emerald-500/70 rounded-xl text-emerald-200 text-xs font-bold flex items-center gap-2 animate-fadeIn">
            <span>✓</span>
            <span>¡Configuración guardada en la biblioteca y aplicada al bot en vivo exitosamente!</span>
          </div>
        )}
        {loadStrategySuccess && (
          <div className="p-3 bg-blue-950/90 border border-blue-500/70 rounded-xl text-blue-200 text-xs font-bold flex items-center gap-2 animate-fadeIn">
            <span>ℹ️</span>
            <span>{loadStrategySuccess}</span>
          </div>
        )}
      </div>

      {/* Radar de Estrategia, Línea de Tiempo y Simulador Dinámico */}
      <StrategyRadar config={formData} />
      
      <fieldset className="border pt-4 px-4 pb-6 rounded-md border-gray-300 dark:border-gray-600">
        <legend className="text-base font-medium text-gray-900 dark:text-gray-100 px-2">General</legend>
        <div className="grid grid-cols-1 md:grid-cols-4 gap-6 mt-4">
          <ConfigItem labelText="Entorno de Ejecución" htmlFor="mode" tooltipKey="mode">
            <div className="mt-1 flex items-center px-3 py-2 border border-green-300 bg-green-50 dark:bg-green-950/40 dark:border-green-800 rounded-md shadow-sm">
              <span className="w-2.5 h-2.5 rounded-full bg-green-500 mr-2 animate-pulse"></span>
              <span className="text-xs font-bold text-green-800 dark:text-green-300 uppercase tracking-wide">
                🛡️ Testnet / Simulación (Protegido)
              </span>
            </div>
          </ConfigItem>
          <ConfigItem labelText="Apalancamiento (Multiplicador x)" htmlFor="leverage" tooltipKey="leverage">
            <input type="number" name="leverage" id="leverage" value={formData.leverage} onChange={handleChange} min="1" max="125" step="1" className="mt-1 block w-full py-2 px-3 border border-gray-300 bg-white dark:bg-gray-900 dark:border-gray-700 rounded-md shadow-sm focus:outline-none focus:ring-primary-500 focus:border-primary-500 sm:text-sm" placeholder="Ej: 3 (para 3x)"/>
          </ConfigItem>
          <ConfigItem labelText="Tamaño Posición (USDT)" htmlFor="positionSizeUSDT" tooltipKey="positionSizeUSDT">
            <input type="number" name="positionSizeUSDT" id="positionSizeUSDT" value={formData.positionSizeUSDT} onChange={handleChange} step="any" className="mt-1 block w-full py-2 px-3 border border-gray-300 bg-white dark:bg-gray-900 dark:border-gray-700 rounded-md shadow-sm focus:outline-none focus:ring-primary-500 focus:border-primary-500 sm:text-sm font-semibold" min="1"/>
            <span className="text-[11px] text-gray-500 dark:text-gray-400 mt-1 block">
              💡 Margen en billetera: <strong className="text-emerald-400 font-mono">~${(Number(formData.positionSizeUSDT || 0) / (Number(formData.leverage) || 1)).toFixed(2)} USDT</strong> ({formData.leverage || 1}x)
            </span>
          </ConfigItem>
          <ConfigItem labelText="Intervalo de Velas General" htmlFor="rsiInterval" tooltipKey="rsi_interval">
            <input type="text" name="rsiInterval" id="rsiInterval" value={formData.rsiInterval} onChange={handleChange} className="mt-1 block w-full py-2 px-3 border border-gray-300 bg-white dark:bg-gray-900 dark:border-gray-700 rounded-md shadow-sm focus:outline-none focus:ring-primary-500 focus:border-primary-500 sm:text-sm" placeholder="Ej: 1m, 5m"/>
          </ConfigItem>
          <div className="md:col-span-4">
            <ConfigItem labelText="Símbolos (separados por coma)" htmlFor="symbolsToTrade" tooltipKey="symbolsToTrade">
              <textarea name="symbolsToTrade" id="symbolsToTrade" value={formData.symbolsToTrade} onChange={handleChange} rows={2} className="mt-1 block w-full py-2 px-3 border border-gray-300 bg-white dark:bg-gray-900 dark:border-gray-700 rounded-md shadow-sm focus:outline-none focus:ring-primary-500 focus:border-primary-500 sm:text-sm" placeholder="BTCUSDT,ETHUSDT"></textarea>
            </ConfigItem>
          </div>
        </div>
      </fieldset>

      {/* --- GESTIÓN DE RIESGO GLOBAL (COMPACTA) --- */}
      <div className="bg-gradient-to-r from-gray-900 via-indigo-950/40 to-gray-900 border border-indigo-900/60 rounded-xl p-4 shadow-sm my-2">
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
          <div className="flex items-center space-x-3">
            <span className="text-xl p-2 bg-indigo-500/20 text-indigo-400 rounded-lg">🛡️</span>
            <div>
              <h4 className="text-sm font-bold text-white flex items-center gap-2">
                Gestión de Riesgo Global de la Cartera
                <span className="text-[10px] px-2 py-0.5 rounded-full font-bold bg-indigo-950 text-indigo-300 border border-indigo-800">
                  Límite: {riskPercentage}%
                </span>
              </h4>
              <p className="text-xs text-gray-400">
                El monitor de balance, márgenes en vivo y ranking por moneda se encuentran en la pestaña <strong className="text-indigo-300">📈 Rendimiento & PnL</strong>.
              </p>
            </div>
          </div>

          <div className="flex items-center gap-2 flex-shrink-0">
            <div className="relative w-20">
              <NumberInput
                id="risk-percentage"
                name="risk-percentage"
                value={riskPercentage}
                onChange={(e) => setRiskPercentage(e.target.value)}
                min="1"
                max="100"
              />
              <span className="absolute inset-y-0 right-2 flex items-center text-xs text-gray-400 pointer-events-none font-bold">%</span>
            </div>
            <button
              type="button"
              onClick={handleSaveRisk}
              className="bg-indigo-600 hover:bg-indigo-500 text-white text-xs font-bold py-2 px-3 rounded-lg shadow transition active:scale-95 whitespace-nowrap"
            >
              Guardar Riesgo
            </button>
          </div>
        </div>
      </div>
      {/* ------------------------------------------- */}

      {/* ======================================================== */}
      {/* PARÁMETROS DE ENTRADA (ESTRUCTURADOS EN 4 BLOQUES CLAROS) */}
      {/* ======================================================== */}
      <fieldset className="border pt-4 px-5 pb-6 rounded-xl border-gray-300 dark:border-gray-700 bg-white/40 dark:bg-gray-800/40 shadow-sm space-y-6">
        <legend className="text-base font-bold text-gray-900 dark:text-gray-100 px-3 flex items-center">
          <span className="mr-2">🎯</span> Parámetros de ENTRADA (Filtros de Compra RSI)
        </legend>

        {/* 1. CONFIGURACIÓN RSI Y RANGOS */}
        <div className="space-y-2">
          <div className="text-xs font-bold text-indigo-500 dark:text-indigo-400 uppercase tracking-wider flex items-center">
            <span className="mr-1.5">📊</span> 1. Indicador RSI y Rango de Entrada
          </div>
          <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
            <ConfigItem labelText="Periodo RSI" htmlFor="rsiPeriod" tooltipKey="rsi_period">
              <input type="number" name="rsiPeriod" id="rsiPeriod" value={formData.rsiPeriod} onChange={handleChange} className="block w-full py-2 px-3 border border-gray-300 bg-white dark:bg-gray-900 dark:border-gray-700 rounded-md shadow-sm focus:outline-none focus:ring-primary-500 focus:border-primary-500 sm:text-sm font-semibold" min="1"/>
            </ConfigItem>

            <ConfigItem 
              labelText="RSI Cambio Positivo (Delta)" 
              htmlFor="rsiThresholdUp" 
              checkboxName="evaluateRsiDelta" 
              isChecked={!!formData.evaluateRsiDelta} 
              onCheckboxChange={handleChange} 
              tooltipKey="rsiThresholdUp"
            >
              <input type="number" name="rsiThresholdUp" id="rsiThresholdUp" value={formData.rsiThresholdUp} onChange={handleChange} step="any" className="block w-full py-2 px-3 border border-gray-300 bg-white dark:bg-gray-900 dark:border-gray-700 rounded-md shadow-sm focus:outline-none focus:ring-primary-500 focus:border-primary-500 sm:text-sm font-semibold"/>
            </ConfigItem>

            <ConfigItem 
              labelText="RSI Límite Inferior (Rango)" 
              htmlFor="rsiEntryLevelLow" 
              checkboxName="evaluateRsiRange" 
              isChecked={!!formData.evaluateRsiRange} 
              onCheckboxChange={handleChange} 
              tooltipKey="rsiEntryLevelLow"
            >
              <input type="number" name="rsiEntryLevelLow" id="rsiEntryLevelLow" value={formData.rsiEntryLevelLow} onChange={handleChange} step="any" className="block w-full py-2 px-3 border border-gray-300 bg-white dark:bg-gray-900 dark:border-gray-700 rounded-md shadow-sm focus:outline-none focus:ring-primary-500 focus:border-primary-500 sm:text-sm font-semibold"/>
            </ConfigItem>

            <ConfigItem labelText="RSI Límite Superior" htmlFor="rsiEntryLevelHigh" tooltipKey="rsiEntryLevelHigh">
              <input type="number" name="rsiEntryLevelHigh" id="rsiEntryLevelHigh" value={formData.rsiEntryLevelHigh} onChange={handleChange} step="any" className="block w-full py-2 px-3 border border-gray-300 bg-white dark:bg-gray-900 dark:border-gray-700 rounded-md shadow-sm focus:outline-none focus:ring-primary-500 focus:border-primary-500 sm:text-sm font-semibold"/>
            </ConfigItem>
          </div>
        </div>

        {/* 2. FILTRO DE VOLUMEN */}
        <div className="space-y-2">
          <div className="text-xs font-bold text-cyan-500 dark:text-cyan-400 uppercase tracking-wider flex items-center">
            <span className="mr-1.5">📈</span> 2. Filtro de Volumen de Mercado
          </div>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <ConfigItem 
              labelText="Factor Volumen Mínimo" 
              htmlFor="volumeFactor" 
              checkboxName="evaluateVolumeFilter" 
              isChecked={!!formData.evaluateVolumeFilter} 
              onCheckboxChange={handleChange} 
              tooltipKey="volumeFactor"
            >
              <input type="number" name="volumeFactor" id="volumeFactor" value={formData.volumeFactor} onChange={handleChange} step="0.1" className="block w-full py-2 px-3 border border-gray-300 bg-white dark:bg-gray-900 dark:border-gray-700 rounded-md shadow-sm focus:outline-none focus:ring-primary-500 focus:border-primary-500 sm:text-sm font-semibold"/>
            </ConfigItem>

            <ConfigItem labelText="Periodo SMA Volumen" htmlFor="volumeSmaPeriod" tooltipKey="volumeSmaPeriod">
              <input type="number" name="volumeSmaPeriod" id="volumeSmaPeriod" value={formData.volumeSmaPeriod} onChange={handleChange} className="block w-full py-2 px-3 border border-gray-300 bg-white dark:bg-gray-900 dark:border-gray-700 rounded-md shadow-sm focus:outline-none focus:ring-primary-500 focus:border-primary-500 sm:text-sm font-semibold"/>
            </ConfigItem>
          </div>
        </div>

        {/* 3. FILTROS DE PROTECCIÓN Y CONFIRMACIÓN */}
        <div className="space-y-2">
          <div className="text-xs font-bold text-rose-500 dark:text-rose-400 uppercase tracking-wider flex items-center">
            <span className="mr-1.5">🛡️</span> 3. Filtros de Protección y Confirmación (Anti-Cascada y Rebote)
          </div>
          <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
            <ConfigItem 
              labelText="Velas Rojas para Bloquear" 
              htmlFor="downtrendCheckCandles" 
              checkboxName="evaluateDowntrendCandlesBlock" 
              isChecked={!!formData.evaluateDowntrendCandlesBlock} 
              onCheckboxChange={handleChange} 
              tooltipKey="downtrendCheckCandles"
            >
              <input type="number" name="downtrendCheckCandles" id="downtrendCheckCandles" value={formData.downtrendCheckCandles} onChange={handleChange} className="block w-full py-2 px-3 border border-gray-300 bg-white dark:bg-gray-900 dark:border-gray-700 rounded-md shadow-sm focus:outline-none focus:ring-primary-500 focus:border-primary-500 sm:text-sm font-semibold"/>
            </ConfigItem>

            <ConfigItem 
              labelText="Nivel RSI para Bloquear" 
              htmlFor="downtrendLevelCheck" 
              checkboxName="evaluateDowntrendLevelsBlock" 
              isChecked={!!formData.evaluateDowntrendLevelsBlock} 
              onCheckboxChange={handleChange} 
              tooltipKey="downtrendLevelCheck"
            >
              <input type="number" name="downtrendLevelCheck" id="downtrendLevelCheck" value={formData.downtrendLevelCheck} onChange={handleChange} className="block w-full py-2 px-3 border border-gray-300 bg-white dark:bg-gray-900 dark:border-gray-700 rounded-md shadow-sm focus:outline-none focus:ring-primary-500 focus:border-primary-500 sm:text-sm font-semibold"/>
            </ConfigItem>

            <ConfigItem 
              labelText="Velas Verdes Requeridas" 
              htmlFor="requiredUptrendCandles" 
              checkboxName="evaluateRequiredUptrend" 
              isChecked={!!formData.evaluateRequiredUptrend} 
              onCheckboxChange={handleChange} 
              tooltipKey="requiredUptrendCandles"
            >
              <input type="number" name="requiredUptrendCandles" id="requiredUptrendCandles" value={formData.requiredUptrendCandles} onChange={handleChange} className="block w-full py-2 px-3 border border-gray-300 bg-white dark:bg-gray-900 dark:border-gray-700 rounded-md shadow-sm focus:outline-none focus:ring-primary-500 focus:border-primary-500 sm:text-sm font-semibold"/>
            </ConfigItem>
          </div>
        </div>

        {/* 4. FILTRO DE INTERÉS ABIERTO */}
        <div className="space-y-2">
          <div className="text-xs font-bold text-amber-500 dark:text-amber-400 uppercase tracking-wider flex items-center">
            <span className="mr-1.5">🐋</span> 4. Filtro de Interés Abierto (Capital Institucional)
          </div>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <ConfigItem 
              labelText="Filtro Interés Abierto (OI)" 
              htmlFor="openInterestPeriod" 
              checkboxName="evaluateOpenInterestIncrease" 
              isChecked={!!formData.evaluateOpenInterestIncrease} 
              onCheckboxChange={handleChange} 
              tooltipKey="evaluateOpenInterestIncrease"
            >
              <input type="text" name="openInterestPeriod" id="openInterestPeriod" value={formData.openInterestPeriod} onChange={handleChange} className="block w-full py-2 px-3 border border-gray-300 bg-white dark:bg-gray-900 dark:border-gray-700 rounded-md shadow-sm focus:outline-none focus:ring-primary-500 focus:border-primary-500 sm:text-sm font-semibold" placeholder="Ej: 5m, 15m"/>
            </ConfigItem>
          </div>
        </div>
      </fieldset>

      {/* --- Estrategia de Media Móvil --- */}
      <ConfigSection title="Filtro de Media Móvil (MA)" className="col-span-1">
        <div className="space-y-4">
          <ConfigItem labelText="Activar Filtro de Media Móvil" tooltipKey="evaluateMaFilter">
            <Switch
              name="evaluateMaFilter"
              checked={formData.evaluateMaFilter}
              onChange={handleChange}
            />
          </ConfigItem>
          {formData.evaluateMaFilter && (
            <div className="pt-2">
              <ConfigItem labelText="Período de la Media Móvil" htmlFor="maPeriod" tooltipKey="maPeriod">
                <NumberInput
                  id="maPeriod"
                  name="maPeriod"
                  value={formData.maPeriod}
                  onChange={handleChange}
                />
              </ConfigItem>
            </div>
          )}
        </div>
      </ConfigSection>

      {/* --- NUEVA SECCIÓN: Estrategia de Soportes Confirmados --- */}
      <ConfigSection title="Estrategia de Soportes Confirmados" className="col-span-1 md:col-span-2">
        <div className="space-y-4">
          <ConfigItem labelText="Activar Estrategia de Soportes (Desactiva la Estrategia RSI)" tooltipKey="evaluateSupportStrategy">
            <Switch
              name="evaluateSupportStrategy"
              checked={formData.evaluateSupportStrategy}
              onChange={handleChange}
            />
          </ConfigItem>

          {formData.evaluateSupportStrategy && (
            <div className="grid grid-cols-1 md:grid-cols-3 gap-4 pt-4">
              <ConfigItem labelText="Velas de Historial" htmlFor="supportHistoryCandles" tooltipKey="supportHistoryCandles">
                <NumberInput
                  id="supportHistoryCandles"
                  name="supportHistoryCandles"
                  value={formData.supportHistoryCandles}
                  onChange={handleChange}
                />
              </ConfigItem>
              <ConfigItem labelText="Ventana de Pivote" htmlFor="supportPivotWindow" tooltipKey="supportPivotWindow">
                <NumberInput
                  id="supportPivotWindow"
                  name="supportPivotWindow"
                  value={formData.supportPivotWindow}
                  onChange={handleChange}
                />
              </ConfigItem>
              <ConfigItem labelText="Confirmaciones Mínimas" htmlFor="supportConfirmations" tooltipKey="supportConfirmations">
                <NumberInput
                  id="supportConfirmations"
                  name="supportConfirmations"
                  value={formData.supportConfirmations}
                  onChange={handleChange}
                />
              </ConfigItem>
              <ConfigItem labelText="Tolerancia de Nivel (%)" htmlFor="supportLevelTolerancePercent" tooltipKey="supportLevelTolerancePercent">
                <NumberInput
                  id="supportLevelTolerancePercent"
                  name="supportLevelTolerancePercent"
                  value={formData.supportLevelTolerancePercent}
                  onChange={handleChange}
                  step={0.1}
                />
              </ConfigItem>
              <ConfigItem labelText="Stop Loss de Orden (%)" htmlFor="supportOrderStopLossPercent" tooltipKey="supportOrderStopLossPercent">
                <NumberInput
                  id="supportOrderStopLossPercent"
                  name="supportOrderStopLossPercent"
                  value={formData.supportOrderStopLossPercent}
                  onChange={handleChange}
                  step={0.1}
                />
              </ConfigItem>
              <ConfigItem labelText="Take Profit de Orden (%)" htmlFor="supportOrderTakeProfitPercent" tooltipKey="supportOrderTakeProfitPercent">
                <NumberInput
                  id="supportOrderTakeProfitPercent"
                  name="supportOrderTakeProfitPercent"
                  value={formData.supportOrderTakeProfitPercent}
                  onChange={handleChange}
                  step={0.1}
                />
              </ConfigItem>
            </div>
          )}
        </div>
      </ConfigSection>

      {/* --- NUEVA SECCIÓN: Re-entradas y Órdenes de Seguridad (DCA / Scale-In) --- */}
      <ConfigSection title="🛡️ Re-entradas y Órdenes de Seguridad (DCA / Scale-In)" className="col-span-1 md:col-span-2">
        <div className="space-y-4">
          <ConfigItem labelText="Activar Re-entradas en Caída (DCA)" tooltipKey="enableDcaReentry">
            <Switch
              name="enableDcaReentry"
              checked={formData.enableDcaReentry}
              onChange={handleChange}
            />
          </ConfigItem>

          {formData.enableDcaReentry && (
            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4 pt-4">
              <ConfigItem labelText="Modo de Re-entrada" htmlFor="dcaReentryMode" tooltipKey="dcaReentryMode">
                <select
                  id="dcaReentryMode"
                  name="dcaReentryMode"
                  value={formData.dcaReentryMode || 'fixed_percent'}
                  onChange={handleChange}
                  className="block w-full py-2 px-3 border border-gray-300 bg-white dark:bg-gray-900 dark:border-gray-700 rounded-md shadow-sm focus:outline-none focus:ring-primary-500 focus:border-primary-500 sm:text-sm font-semibold text-gray-900 dark:text-gray-100"
                >
                  <option value="fixed_percent">📉 % de Caída Fijo</option>
                  <option value="next_support">🏛️ Siguiente Soporte Confirmado</option>
                </select>
              </ConfigItem>

              {formData.dcaReentryMode !== 'next_support' && (
                <ConfigItem labelText="% de Caída para Re-entrada" htmlFor="dcaPriceDropPercent" tooltipKey="dcaPriceDropPercent">
                  <NumberInput
                    id="dcaPriceDropPercent"
                    name="dcaPriceDropPercent"
                    value={formData.dcaPriceDropPercent}
                    onChange={handleChange}
                    step={0.1}
                    min={0.1}
                  />
                </ConfigItem>
              )}

              <ConfigItem labelText="Máximo de Re-entradas" htmlFor="dcaMaxReentries" tooltipKey="dcaMaxReentries">
                <NumberInput
                  id="dcaMaxReentries"
                  name="dcaMaxReentries"
                  value={formData.dcaMaxReentries}
                  onChange={handleChange}
                  min={1}
                  max={10}
                />
              </ConfigItem>

              <ConfigItem labelText="Multiplicador de Volumen" htmlFor="dcaVolumeMultiplier" tooltipKey="dcaVolumeMultiplier">
                <NumberInput
                  id="dcaVolumeMultiplier"
                  name="dcaVolumeMultiplier"
                  value={formData.dcaVolumeMultiplier}
                  onChange={handleChange}
                  step={0.1}
                  min={0.5}
                />
              </ConfigItem>
            </div>
          )}
        </div>
      </ConfigSection>

      {/* ======================================================== */}
      {/* PARÁMETROS DE SALIDA (ESTRUCTURADOS EN 3 BLOQUES CLAROS) */}
      {/* ======================================================== */}
      <fieldset className="border pt-4 px-5 pb-6 rounded-xl border-gray-300 dark:border-gray-700 bg-white/40 dark:bg-gray-800/40 shadow-sm space-y-6">
        <legend className="text-base font-bold text-gray-900 dark:text-gray-100 px-3 flex items-center">
          <span className="mr-2">🚪</span> Parámetros de SALIDA y Trailing Stops
        </legend>

        {/* 1. SALIDAS FIJAS POR PNL */}
        <div className="space-y-2">
          <div className="text-xs font-bold text-emerald-500 dark:text-emerald-400 uppercase tracking-wider flex items-center">
            <span className="mr-1.5">🎯</span> 1. Salidas Fijas por PnL (Take Profit y Stop Loss)
          </div>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <ConfigItem 
              labelText="Take Profit Fijo (USDT)" 
              htmlFor="takeProfitUSDT" 
              checkboxName="enableTakeProfitPnl" 
              isChecked={!!formData.enableTakeProfitPnl} 
              onCheckboxChange={handleChange} 
              tooltipKey="takeProfitUSDT"
            >
              <input type="number" name="takeProfitUSDT" id="takeProfitUSDT" value={formData.takeProfitUSDT} onChange={handleChange} step="any" className="block w-full py-2 px-3 border border-gray-300 bg-white dark:bg-gray-900 dark:border-gray-700 rounded-md shadow-sm focus:outline-none focus:ring-primary-500 focus:border-primary-500 sm:text-sm font-semibold" min="0"/>
            </ConfigItem>

            <ConfigItem 
              labelText="Stop Loss Fijo (USDT)" 
              htmlFor="stopLossUSDT" 
              checkboxName="enableStopLossPnl" 
              isChecked={!!formData.enableStopLossPnl} 
              onCheckboxChange={handleChange} 
              tooltipKey="stopLossUSDT"
            >
              <input type="number" name="stopLossUSDT" id="stopLossUSDT" value={formData.stopLossUSDT} onChange={handleChange} step="any" className="block w-full py-2 px-3 border border-gray-300 bg-white dark:bg-gray-900 dark:border-gray-700 rounded-md shadow-sm focus:outline-none focus:ring-primary-500 focus:border-primary-500 sm:text-sm font-semibold" placeholder="Ej: 20"/>
            </ConfigItem>
          </div>
        </div>

        {/* 2. SALIDA POR TRAILING RSI */}
        <div className="space-y-2">
          <div className="text-xs font-bold text-purple-500 dark:text-purple-400 uppercase tracking-wider flex items-center">
            <span className="mr-1.5">📉</span> 2. Salida por Trailing RSI
          </div>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <ConfigItem labelText="RSI Objetivo Activación (Salida)" htmlFor="rsiTarget" tooltipKey="rsiTarget">
              <input type="number" name="rsiTarget" id="rsiTarget" value={formData.rsiTarget} onChange={handleChange} step="any" className="block w-full py-2 px-3 border border-gray-300 bg-white dark:bg-gray-900 dark:border-gray-700 rounded-md shadow-sm focus:outline-none focus:ring-primary-500 focus:border-primary-500 sm:text-sm font-semibold"/>
            </ConfigItem>

            <ConfigItem 
              labelText="RSI Drop Salida (Negativo)" 
              htmlFor="rsiThresholdDown" 
              checkboxName="enableTrailingRsiStop" 
              isChecked={!!formData.enableTrailingRsiStop} 
              onCheckboxChange={handleChange} 
              tooltipKey="rsiThresholdDown"
            >
              <input type="number" name="rsiThresholdDown" id="rsiThresholdDown" value={formData.rsiThresholdDown} onChange={handleChange} step="any" className="block w-full py-2 px-3 border border-gray-300 bg-white dark:bg-gray-900 dark:border-gray-700 rounded-md shadow-sm focus:outline-none focus:ring-primary-500 focus:border-primary-500 sm:text-sm font-semibold"/>
            </ConfigItem>
          </div>
        </div>

        {/* 3. TRAILING STOPS DINÁMICOS */}
        <div className="space-y-2">
          <div className="text-xs font-bold text-amber-500 dark:text-amber-400 uppercase tracking-wider flex items-center">
            <span className="mr-1.5">🏃</span> 3. Trailing Stops Dinámicos (Precio y PnL)
          </div>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <ConfigItem 
              labelText="Distancia Trailing Precio (USDT)" 
              htmlFor="priceTrailingStopDistanceUSDT" 
              checkboxName="enablePriceTrailingStop" 
              isChecked={!!formData.enablePriceTrailingStop} 
              onCheckboxChange={handleChange} 
              tooltipKey="priceTrailingStopDistanceUSDT"
            >
              <input type="number" name="priceTrailingStopDistanceUSDT" id="priceTrailingStopDistanceUSDT" value={formData.priceTrailingStopDistanceUSDT} onChange={handleChange} step="any" className="block w-full py-2 px-3 border border-gray-300 bg-white dark:bg-gray-900 dark:border-gray-700 rounded-md shadow-sm focus:outline-none focus:ring-primary-500 focus:border-primary-500 sm:text-sm font-semibold" min="0"/>
            </ConfigItem>

            <ConfigItem labelText="Activación PNL para Trailing Precio (USDT)" htmlFor="priceTrailingStopActivationPnlUSDT" tooltipKey="priceTrailingStopActivationPnlUSDT">
              <input type="number" name="priceTrailingStopActivationPnlUSDT" id="priceTrailingStopActivationPnlUSDT" value={formData.priceTrailingStopActivationPnlUSDT} onChange={handleChange} className="block w-full py-2 px-3 border border-gray-300 bg-white dark:bg-gray-900 dark:border-gray-700 rounded-md shadow-sm focus:outline-none focus:ring-primary-500 focus:border-primary-500 sm:text-sm font-semibold" step="any"/>
            </ConfigItem>

            <ConfigItem 
              labelText="Activación PNL para Trailing PNL (USDT)" 
              htmlFor="pnlTrailingStopActivationUSDT" 
              checkboxName="enablePnlTrailingStop" 
              isChecked={!!formData.enablePnlTrailingStop} 
              onCheckboxChange={handleChange} 
              tooltipKey="pnlTrailingStopActivationUSDT"
            >
              <input type="number" id="pnlTrailingStopActivationUSDT" name="pnlTrailingStopActivationUSDT" value={formData.pnlTrailingStopActivationUSDT} onChange={handleChange} disabled={!formData.enablePnlTrailingStop} className="block w-full py-2 px-3 border border-gray-300 bg-white dark:bg-gray-900 dark:border-gray-700 rounded-md shadow-sm focus:outline-none focus:ring-primary-500 focus:border-primary-500 sm:text-sm font-semibold disabled:opacity-50" step="any"/>
            </ConfigItem>

            <ConfigItem 
              labelText="Caída de PNL para Salir (USDT)" 
              htmlFor="pnlTrailingStopDropUSDT" 
              tooltipKey="pnlTrailingStopDropUSDT"
            >
              <input type="number" id="pnlTrailingStopDropUSDT" name="pnlTrailingStopDropUSDT" value={formData.pnlTrailingStopDropUSDT} onChange={handleChange} disabled={!formData.enablePnlTrailingStop} className="block w-full py-2 px-3 border border-gray-300 bg-white dark:bg-gray-900 dark:border-gray-700 rounded-md shadow-sm focus:outline-none focus:ring-primary-500 focus:border-primary-500 sm:text-sm font-semibold disabled:opacity-50" step="any"/>
            </ConfigItem>
          </div>
        </div>
      </fieldset>

      <fieldset className="border pt-4 px-4 pb-6 rounded-md border-gray-300 dark:border-gray-600">
        <legend className="text-base font-medium text-gray-900 dark:text-gray-100 px-2">Otros Parámetros</legend>
        <div className="grid grid-cols-1 md:grid-cols-2 gap-6 mt-4">
          <ConfigItem labelText="Ciclo de Segundos" htmlFor="cycleSleepSeconds" tooltipKey="cycleSleepSeconds">
            <input type="number" name="cycleSleepSeconds" id="cycleSleepSeconds" value={formData.cycleSleepSeconds} onChange={handleChange} className="mt-1 block w-full py-2 px-3 border border-gray-300 bg-white dark:bg-gray-900 dark:border-gray-700 rounded-md shadow-sm focus:outline-none focus:ring-primary-500 focus:border-primary-500 sm:text-sm"/>
          </ConfigItem>
          <ConfigItem labelText="Timeout de Orden (segundos)" htmlFor="orderTimeoutSeconds" tooltipKey="orderTimeoutSeconds">
            <input type="number" name="orderTimeoutSeconds" id="orderTimeoutSeconds" value={formData.orderTimeoutSeconds} onChange={handleChange} className="mt-1 block w-full py-2 px-3 border border-gray-300 bg-white dark:bg-gray-900 dark:border-gray-700 rounded-md shadow-sm focus:outline-none focus:ring-primary-500 focus:border-primary-500 sm:text-sm"/>
          </ConfigItem>
        </div>
      </fieldset>

      {/* Botón Inferior Sincronizado para Guardar y Aplicar */}
      <div className="pt-6">
        <button 
          type="button" 
          onClick={() => handleSaveAndApply()} 
          disabled={isLoading} 
          className="w-full py-3.5 px-6 bg-gradient-to-r from-emerald-600 to-teal-600 hover:from-emerald-500 hover:to-teal-500 text-white font-extrabold text-base rounded-xl shadow-xl shadow-emerald-900/40 transition-all flex items-center justify-center gap-2 active:scale-95 disabled:opacity-50"
        >
          <span>💾</span>
          <span>{isLoading ? 'Guardando y Aplicando...' : `Guardar y Aplicar "${strategyNameInput || 'Configuración'}" al Bot`}</span>
        </button>
        {validationError && <p className="mt-2 text-sm text-red-500 text-center font-bold">⚠️ {validationError}</p>}
        {showSuccessMessage && <p className="mt-2 text-sm text-green-500 text-center font-bold">✓ ¡Configuración guardada y aplicada exitosamente!</p>}
      </div>

      {/* --- Biblioteca de Estrategias Guardadas --- */}
      <ConfigSection title="Biblioteca de Estrategias Guardadas" className="bg-gray-50 dark:bg-gray-800/50 mt-6">
        <div className="space-y-4">
          <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2">
            <p className="text-xs text-gray-500 dark:text-gray-400">
              Carga o administra las estrategias que tienes guardadas en el disco local:
            </p>
            {deleteStrategySuccess && <span className="text-xs text-green-500 font-bold">{deleteStrategySuccess}</span>}
            {deleteStrategyError && <span className="text-xs text-red-500 font-bold">{deleteStrategyError}</span>}
          </div>

          {isLoadingStrategies && <p className="text-sm text-gray-500 dark:text-gray-400">Cargando lista de estrategias...</p>}
          {strategyError && <p className="text-sm text-red-500 dark:text-red-400">Error al cargar estrategias: {strategyError}</p>}

            {!isLoadingStrategies && !strategyError && (
              availableStrategies.length > 0 ? (
                <ul className="space-y-2">
                  {availableStrategies.map(item => {
                    const name = typeof item === 'object' ? item.name : item;
                    const cfg = typeof item === 'object' ? item.config : null;

                    return (
                      <li key={name} className="p-2.5 bg-gray-50 dark:bg-gray-800 rounded-lg border border-gray-200 dark:border-gray-700/80 shadow-sm flex items-center justify-between gap-3">
                        <div className="flex items-center flex-wrap min-w-0 flex-grow py-0.5">
                          <span className="text-gray-900 dark:text-gray-100 font-bold text-sm whitespace-nowrap">{name}</span>
                          
                          {/* Resumen compacto en píldoras horizontales al lado del nombre */}
                          {cfg && Object.keys(cfg).length > 0 && (() => {
                            const symbolsCount = cfg.symbolsToTrade ? cfg.symbolsToTrade.split(',').map(s => s.trim()).filter(Boolean).length : 0;
                            return (
                              <div className="flex flex-wrap items-center gap-1.5 ml-2.5">
                                {/* Cantidad de Monedas */}
                                {symbolsCount > 0 && (
                                  <span className="inline-flex items-center px-2 py-0.5 rounded text-[11px] font-semibold bg-amber-100/80 dark:bg-amber-950/70 text-amber-800 dark:text-amber-300 border border-amber-300 dark:border-amber-700/60" title={`Lista de ${symbolsCount} monedas guardadas`}>
                                    🪙 {symbolsCount} {symbolsCount === 1 ? 'moneda' : 'monedas'}
                                  </span>
                                )}

                                {/* Margen y Apalancamiento */}
                                {cfg.positionSizeUSDT && (
                                  <span className="inline-flex items-center px-2 py-0.5 rounded text-[11px] font-semibold bg-emerald-100/70 dark:bg-emerald-950/70 text-emerald-800 dark:text-emerald-300 border border-emerald-300 dark:border-emerald-700/60" title="Margen y Apalancamiento">
                                    💵 {cfg.leverage ? `${cfg.leverage}x • ` : ''}${cfg.positionSizeUSDT} USDT
                                  </span>
                                )}

                                {/* Estrategia de Soportes o RSI */}
                                {cfg.evaluateSupportStrategy ? (
                                  <>
                                    <span className="inline-flex items-center px-2 py-0.5 rounded text-[11px] font-semibold bg-indigo-50 dark:bg-indigo-950/60 text-indigo-700 dark:text-indigo-300 border border-indigo-200 dark:border-indigo-800/60" title="Estrategia de Soportes Confirmados">
                                      🏛️ Soportes • {cfg.rsiInterval || '5m'}
                                    </span>
                                    {cfg.supportHistoryCandles && (
                                      <span className="inline-flex items-center px-2 py-0.5 rounded text-[11px] font-semibold bg-blue-50 dark:bg-blue-950/60 text-blue-700 dark:text-blue-300 border border-blue-200 dark:border-blue-800/60" title="Velas de Historial y Ventana Pivote">
                                        📜 Hist: {cfg.supportHistoryCandles}v • Pivote: {cfg.supportPivotWindow || 3}
                                      </span>
                                    )}
                                    {cfg.supportConfirmations && (
                                      <span className="inline-flex items-center px-2 py-0.5 rounded text-[11px] font-semibold bg-purple-50 dark:bg-purple-950/60 text-purple-700 dark:text-purple-300 border border-purple-200 dark:border-purple-800/60" title="Confirmaciones Mínimas y Tolerancia">
                                        ✅ {cfg.supportConfirmations} toques (Tol: {cfg.supportLevelTolerancePercent || 0.2}%)
                                      </span>
                                    )}
                                    {cfg.supportOrderTakeProfitPercent && (
                                      <span className="inline-flex items-center px-2 py-0.5 rounded text-[11px] font-semibold bg-emerald-50 dark:bg-emerald-950/60 text-emerald-700 dark:text-emerald-300 border border-emerald-200 dark:border-emerald-800/60" title="Take Profit de Orden (%)">
                                        🎯 TP: +{cfg.supportOrderTakeProfitPercent}%
                                      </span>
                                    )}
                                    {cfg.supportOrderStopLossPercent && (
                                      <span className="inline-flex items-center px-2 py-0.5 rounded text-[11px] font-semibold bg-rose-50 dark:bg-rose-950/60 text-rose-700 dark:text-rose-300 border border-rose-200 dark:border-rose-800/60" title="Stop Loss de Orden (%)">
                                        🛑 SL: -{cfg.supportOrderStopLossPercent}%
                                      </span>
                                    )}
                                  </>
                                ) : (
                                  <>
                                    {cfg.rsiPeriod !== undefined && (
                                      <span className="inline-flex items-center px-2 py-0.5 rounded text-[11px] font-semibold bg-blue-50 dark:bg-blue-950/60 text-blue-700 dark:text-blue-300 border border-blue-200 dark:border-blue-800/60">
                                        ⏱️ {cfg.rsiInterval || '1m'} • RSI({cfg.rsiPeriod}){cfg.evaluateRsiDelta && cfg.rsiThresholdUp ? ` Δ+${cfg.rsiThresholdUp}` : ''}
                                      </span>
                                    )}

                                    {/* Rango RSI */}
                                    {(cfg.evaluateRsiRange || cfg.rsiEntryLevelHigh) && (
                                      <span className="inline-flex items-center px-2 py-0.5 rounded text-[11px] font-semibold bg-purple-50 dark:bg-purple-950/60 text-purple-700 dark:text-purple-300 border border-purple-200 dark:border-purple-800/60">
                                        📊 {cfg.rsiEntryLevelLow || '0'} - {cfg.rsiEntryLevelHigh || '100'}
                                      </span>
                                    )}
                                  </>
                                )}

                                {/* Take Profit Fijo (si no fue mostrado por soporte en %) */}
                                {!cfg.supportOrderTakeProfitPercent && cfg.enableTakeProfitPnl && cfg.takeProfitUSDT && (
                                  <span className="inline-flex items-center px-2 py-0.5 rounded text-[11px] font-semibold bg-emerald-50 dark:bg-emerald-950/60 text-emerald-700 dark:text-emerald-300 border border-emerald-200 dark:border-emerald-800/60">
                                    🎯 TP: +${cfg.takeProfitUSDT}
                                  </span>
                                )}

                                {/* Stop Loss Fijo (si no fue mostrado por soporte en %) */}
                                {!cfg.supportOrderStopLossPercent && cfg.enableStopLossPnl && cfg.stopLossUSDT && (
                                  <span className="inline-flex items-center px-2 py-0.5 rounded text-[11px] font-semibold bg-rose-50 dark:bg-rose-950/60 text-rose-700 dark:text-rose-300 border border-rose-200 dark:border-rose-800/60">
                                    🛑 SL: ${cfg.stopLossUSDT}
                                  </span>
                                )}

                                {/* Trailing PnL / Trailing Precio */}
                                {cfg.enablePnlTrailingStop && (
                                  <span className="inline-flex items-center px-2 py-0.5 rounded text-[11px] font-semibold bg-amber-50 dark:bg-amber-950/60 text-amber-700 dark:text-amber-300 border border-amber-200 dark:border-amber-800/60">
                                    🏃 Tr.PnL ${cfg.pnlTrailingStopActivationUSDT}/${cfg.pnlTrailingStopDropUSDT}
                                  </span>
                                )}
                                {!cfg.enablePnlTrailingStop && cfg.enablePriceTrailingStop && (
                                  <span className="inline-flex items-center px-2 py-0.5 rounded text-[11px] font-semibold bg-amber-50 dark:bg-amber-950/60 text-amber-700 dark:text-amber-300 border border-amber-200 dark:border-amber-800/60">
                                    🏃 Tr.Precio ${cfg.priceTrailingStopDistanceUSDT}
                                  </span>
                                )}

                                {/* Re-entradas DCA */}
                                {cfg.enableDcaReentry && (
                                  <span className="inline-flex items-center px-2 py-0.5 rounded text-[11px] font-semibold bg-cyan-50 dark:bg-cyan-950/60 text-cyan-700 dark:text-cyan-300 border border-cyan-200 dark:border-cyan-800/60" title="Re-entradas y Órdenes de Seguridad (DCA)">
                                    🔄 DCA: {cfg.dcaMaxReentries || 2}x {cfg.dcaReentryMode === 'next_support' ? 'Soportes' : `@ ${cfg.dcaPriceDropPercent || 1.5}%`} ({cfg.dcaVolumeMultiplier || 1}x)
                                  </span>
                                )}

                                {/* Ciclo */}
                                {cfg.cycleSleepSeconds && (
                                  <span className="inline-flex items-center px-1.5 py-0.5 rounded text-[10.5px] font-medium bg-gray-100 dark:bg-gray-900 text-gray-600 dark:text-gray-400 border border-gray-200 dark:border-gray-700">
                                    ⚡ {cfg.cycleSleepSeconds}s
                                  </span>
                                )}
                              </div>
                            );
                          })()}
                        </div>

                        <div className="space-x-2 flex-shrink-0 flex items-center">
                          <button 
                            type="button" 
                            onClick={() => handleLoadSelectedStrategy(name)}
                            disabled={isLoadingSelectedStrategy || isDeletingStrategy === name}
                            className="px-3 py-1.5 text-xs bg-green-600 hover:bg-green-700 text-white font-semibold rounded-md shadow-sm focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-green-500 disabled:opacity-50 whitespace-nowrap"
                          >
                            {isLoadingSelectedStrategy && selectedStrategyToLoad === name ? 'Cargando...' : 'Cargar'}
                          </button>
                          <button 
                            type="button" 
                            onClick={() => handleDeleteStrategy(name)}
                            disabled={isDeletingStrategy === name}
                            className="px-3 py-1.5 text-xs bg-red-600 hover:bg-red-700 text-white font-semibold rounded-md shadow-sm focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-red-500 disabled:opacity-50 whitespace-nowrap"
                          >
                            {isDeletingStrategy === name ? 'Eliminando...' : 'Eliminar'}
                          </button>
                        </div>
                      </li>
                    );
                  })}
                </ul>
              ) : (
                <p className="text-sm text-gray-500 dark:text-gray-400">No hay estrategias guardadas.</p>
              )
            )}
            {/* Mensajes de éxito/error para la carga general (si se mantiene el select) */}
            {loadStrategySuccess && !deleteStrategySuccess && <p className="mt-2 text-sm text-green-500 dark:text-green-400">{loadStrategySuccess}</p>}
            {loadStrategyError && !deleteStrategyError && <p className="mt-2 text-sm text-red-500 dark:text-red-400">{loadStrategyError}</p>}
          </div>
        </ConfigSection>
        {/* --- Fin Sección de Gestión de Estrategias --- */}
      </form>
  );
}

// --- Componentes Reutilizables ---
function NumberInput({ id, name, value, onChange, step = "any", min, max, disabled }) {
  const handleChange = (e) => {
    // Permitir vaciar el campo o escribir un número
    const val = e.target.value;
    if (val === '' || !isNaN(val)) {
      onChange(e);
    }
  };

  return (
    <input
      type="number"
      id={id}
      name={name}
      value={value}
      onChange={handleChange}
      step={step}
      min={min}
      max={max}
      disabled={disabled}
      className="mt-1 block w-full py-2 px-3 border border-gray-300 bg-white dark:bg-gray-800 dark:border-gray-600 rounded-md shadow-sm focus:outline-none focus:ring-indigo-500 focus:border-indigo-500 sm:text-sm disabled:opacity-50"
    />
  );
}

function Switch({ name, checked, onChange, disabled }) {
  return (
    <button
      type="button"
      className={`${
        checked ? 'bg-indigo-600' : 'bg-gray-200 dark:bg-gray-700'
      } relative inline-flex items-center h-6 rounded-full w-11 transition-colors focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-indigo-500 disabled:opacity-50`}
      role="switch"
      aria-checked={checked}
      onClick={() => onChange({ target: { name, value: !checked, type: 'checkbox', checked: !checked } })}
      disabled={disabled}
    >
      <span
        className={`${
          checked ? 'translate-x-6' : 'translate-x-1'
        } inline-block w-4 h-4 transform bg-white rounded-full transition-transform`}
      />
    </button>
  );
}

export default ConfigForm; 