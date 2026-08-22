import React, { useState, useEffect } from 'react';
import Tooltip from './Tooltip'; // Importar el nuevo componente

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

function ConfigItem({ labelText, htmlFor, description, tooltipText, children }) { // <--- 1. Aceptar tooltipText
  return (
    <div>
      <div className="flex items-center"> {/* Contenedor para alinear etiqueta y tooltip */}
        <label htmlFor={htmlFor} className="block text-sm font-medium text-gray-700 dark:text-gray-300">
          {labelText}
        </label>
        {tooltipText && <Tooltip text={tooltipText} />} {/* <--- 2. Renderizar tooltip si existe */}
      </div>
      {children}
      {description && <p className="mt-1 text-xs text-gray-500 dark:text-gray-400">{description}</p>}
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
};

// --- Objeto con los textos para cada tooltip ---
const tooltipTexts = {
  riskPercentage: "Porcentaje máximo del balance total que se permite arriesgar sumando el margen de todas las posiciones abiertas. Un 50% significa que el bot no abrirá nuevas posiciones si el margen total utilizado supera la mitad de tu balance.",
  symbolsToTrade: "Lista de todos los pares de criptomonedas que el bot operará, separados por comas. Por ejemplo: BTCUSDT,ETHUSDT,BNBUSDT.",
  mode: "Define si el bot operará en un entorno de simulación (Paper Trading) sin dinero real, o en el mercado real (Real) con tu capital.",
  leverage: "Multiplicador de apalancamiento en Binance Futures (ej: 3 para 3x, 10 para 10x, 20 para 20x). El bot lo ajustará automáticamente en Binance para cada par al iniciar.",
  positionSizeUSDT: "El tamaño base de la posición en USDT que el bot intentará abrir. El margen real utilizado dependerá del apalancamiento.",
  rsi_interval: "El intervalo de tiempo de las velas para los cálculos (ej. 1m, 5m, 15m, 1h). Afecta a todas las estrategias que usan velas.",
  rsi_period: "Número de velas hacia atrás que se usan para calcular el RSI. Un valor más bajo reacciona más rápido a los cambios de precio.",
  rsiThresholdUp: "RSI debe aumentar al menos este valor en la última vela para considerarse una señal de entrada. Filtra movimientos laterales.",
  rsiEntryLevelLow: "Nivel de RSI por debajo del cual el bot considerará una posible compra. Usado en estrategias de 'sobreventa'.",
  rsiEntryLevelHigh: "Nivel de RSI por encima del cual el bot considerará una posible compra en estrategias de 'momentum' o ruptura.",
  volumeSmaPeriod: "Número de velas para calcular la media móvil simple (SMA) del volumen. Ayuda a identificar si el volumen actual es anómalo.",
  volumeFactor: "Multiplicador para el volumen promedio. El volumen actual debe ser mayor que (SMA del Volumen * Factor) para ser una señal válida.",
  downtrendCheckCandles: "Número de velas rojas consecutivas (tendencia bajista) que deben ocurrir para bloquear temporalmente las compras.",
  downtrendLevelCheck: "Si el RSI ha caído este número de niveles (ej. de 50 a 45) en las últimas velas, bloquea temporalmente las compras.",
  requiredUptrendCandles: "Número de velas verdes consecutivas requeridas antes de permitir una entrada. Confirma un cambio de tendencia a corto plazo.",
  evaluateMaFilter: "Activa o desactiva el filtro de Media Móvil. Si está activo, el bot solo comprará si el precio está por encima de la media móvil seleccionada.",
  maPeriod: "Número de velas que se usan para calcular la Media Móvil. Un valor más alto representa una tendencia a más largo plazo.",
  evaluateSupportStrategy: "Activa o desactiva la estrategia de compra en niveles de soporte. Si está activa, el bot buscará soportes y colocará órdenes de compra en ellos, ignorando la estrategia RSI.",
  supportHistoryCandles: "Número de velas históricas que el bot analizará para encontrar niveles de soporte.",
  supportPivotWindow: "Número de velas a la izquierda y derecha de un punto bajo (pivote) para considerarlo un posible soporte.",
  supportConfirmations: "Número mínimo de 'toques' o rebotes que debe tener un nivel para ser considerado un soporte válido.",
  supportLevelTolerancePercent: "Porcentaje de tolerancia para agrupar precios cercanos en un único nivel de soporte. Un 0.5% agrupará precios que estén a menos de 0.5% de distancia.",
  supportOrderStopLossPercent: "Porcentaje por debajo del precio de la orden de soporte donde se colocará el Stop Loss.",
  supportOrderTakeProfitPercent: "Porcentaje por encima del precio de la orden de soporte donde se colocará el Take Profit.",
  takeProfitUSDT: "Ganancia en USDT a la que el bot intentará cerrar la posición automáticamente para asegurar beneficios.",
  stopLossUSDT: "Pérdida máxima en USDT a la que el bot cerrará la posición para limitar las pérdidas (ej: 20 o -20).",
  rsiTarget: "Cuando el RSI alcanza este nivel después de una entrada, se activa el 'Trailing Stop por RSI' (si está habilitado).",
  rsiThresholdDown: "Si el Trailing Stop por RSI está activo, y el RSI cae este valor (negativo) desde su punto más alto, la posición se cierra.",
  priceTrailingStopDistanceUSDT: "Distancia en USDT que sigue al precio. Si el precio sube, el Stop Loss sube con él, manteniendo esta distancia.",
  priceTrailingStopActivationPnlUSDT: "Ganancia en USDT que la posición debe alcanzar para que el 'Trailing Stop por Precio' se active.",
  pnlTrailingStopActivationUSDT: "La ganancia en USDT a la que el Trailing Stop basado en PNL se 'arma' o activa. A partir de aquí, empezará a seguir el PNL.",
  pnlTrailingStopDropUSDT: "La cantidad en USDT que el PNL debe caer desde su punto más alto (después de activarse) para que la posición se cierre.",
  cycleSleepSeconds: "El tiempo en segundos que el bot espera entre cada ciclo de revisión de condiciones. Un valor más bajo es más rápido pero consume más recursos.",
  orderTimeoutSeconds: "Tiempo máximo en segundos que una orden de entrada (LIMIT) permanecerá abierta. Si no se llena en este tiempo, se cancelará.",
  evaluateOpenInterestIncrease: "Si está activo, exige que el Interés Abierto (dinero en futuros) haya subido en las últimas velas para permitir una compra.",
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
  
  const [riskPercentage, setRiskPercentage] = useState(50); // Estado para el % de riesgo

  // --- Estados para la gestión de estrategias ---
  const [strategyNameInput, setStrategyNameInput] = useState('');
  const [selectedStrategyToLoad, setSelectedStrategyToLoad] = useState('');
  const [isSavingStrategy, setIsSavingStrategy] = useState(false);
  const [saveStrategyError, setSaveStrategyError] = useState(null);
  const [saveStrategySuccess, setSaveStrategySuccess] = useState(null);
  const [isLoadingSelectedStrategy, setIsLoadingSelectedStrategy] = useState(false);
  const [loadStrategyError, setLoadStrategyError] = useState(null);
  const [loadStrategySuccess, setLoadStrategySuccess] = useState(null);
  // --- Estados para la eliminación de estrategias ---
  const [isDeletingStrategy, setIsDeletingStrategy] = useState(null); // Guardará el nombre de la estrategia que se está eliminando
  const [deleteStrategyError, setDeleteStrategyError] = useState(null);
  const [deleteStrategySuccess, setDeleteStrategySuccess] = useState(null);
  // -------------------------------------------------

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

    fetchRiskData(); // Carga inicial
    const intervalId = setInterval(fetchRiskData, 5000); // Refrescar cada 5 segundos

    return () => clearInterval(intervalId); // Limpiar el intervalo al desmontar el componente
  }, []);
  // --- FIN LÓGICA MOVIDA ---


  // --- NUEVO: Cargar la configuración desde el backend al montar ---
  useEffect(() => {
    const fetchInitialConfig = async () => {
      try {
        // Cargar configuración principal del bot (config.ini)
        const response = await fetch('/api/config');
        if (!response.ok) {
          throw new Error(`No se pudo cargar la configuración inicial: ${response.statusText}`);
        }
        const configFromServer = await response.json();
        
        // Mapear la configuración del backend (snake_case) al formato del frontend (camelCase)
        const mappedData = {
          ...defaultConfigValues, // Empezar con los valores por defecto
          symbolsToTrade: configFromServer.SYMBOLS?.symbols_to_trade || configFromServer.symbolsToTrade || '',
          activeStrategyName: configFromServer.GENERAL?.active_strategy_name || configFromServer.activeStrategyName || 'N/A',
          leverage: configFromServer.leverage !== undefined ? configFromServer.leverage : (configFromServer.TRADING?.leverage || 20),
          
          // Mapeo de [TRADING]
          rsiInterval: configFromServer.TRADING?.rsi_interval,
          rsiPeriod: configFromServer.TRADING?.rsi_period,
          rsiThresholdUp: configFromServer.TRADING?.rsi_threshold_up,
          rsiThresholdDown: configFromServer.TRADING?.rsi_threshold_down,
          rsiEntryLevelLow: configFromServer.TRADING?.rsi_entry_level_low,
          rsiEntryLevelHigh: configFromServer.TRADING?.rsi_entry_level_high,
          rsiTarget: configFromServer.TRADING?.rsi_target,
          volumeSmaPeriod: configFromServer.TRADING?.volume_sma_period,
          volumeFactor: configFromServer.TRADING?.volume_factor,
          downtrendCheckCandles: configFromServer.TRADING?.downtrend_check_candles,
          downtrendLevelCheck: configFromServer.TRADING?.downtrend_level_check,
          requiredUptrendCandles: configFromServer.TRADING?.required_uptrend_candles,
          positionSizeUSDT: configFromServer.TRADING?.position_size_usdt,
          stopLossUSDT: configFromServer.TRADING?.stop_loss_usdt,
          takeProfitUSDT: configFromServer.TRADING?.take_profit_usdt,
          cycleSleepSeconds: configFromServer.TRADING?.cycle_sleep_seconds,
          orderTimeoutSeconds: configFromServer.TRADING?.order_timeout_seconds,
          
          // Mapeo de booleans de [TRADING]
          evaluateRsiDelta: configFromServer.TRADING?.evaluate_rsi_delta,
          evaluateVolumeFilter: configFromServer.TRADING?.evaluate_volume_filter,
          evaluateRsiRange: configFromServer.TRADING?.evaluate_rsi_range,
          evaluateDowntrendCandlesBlock: configFromServer.TRADING?.evaluate_downtrend_candles_block,
          evaluateDowntrendLevelsBlock: configFromServer.TRADING?.evaluate_downtrend_levels_block,
          evaluateRequiredUptrend: configFromServer.TRADING?.evaluate_required_uptrend,
          enableTakeProfitPnl: configFromServer.TRADING?.enable_take_profit_pnl,
          enableStopLossPnl: configFromServer.TRADING?.enable_stop_loss_pnl,
          enableTrailingRsiStop: configFromServer.TRADING?.enable_trailing_rsi_stop,
          enablePriceTrailingStop: configFromServer.TRADING?.enable_price_trailing_stop,
          priceTrailingStopDistanceUSDT: configFromServer.TRADING?.price_trailing_stop_distance_usdt,
          priceTrailingStopActivationPnlUSDT: configFromServer.TRADING?.price_trailing_stop_activation_pnl_usdt,
          enablePnlTrailingStop: configFromServer.TRADING?.enable_pnl_trailing_stop,
          pnlTrailingStopActivationUSDT: configFromServer.TRADING?.pnl_trailing_stop_activation_usdt,
          pnlTrailingStopDropUSDT: configFromServer.TRADING?.pnl_trailing_stop_drop_usdt,
          evaluateOpenInterestIncrease: configFromServer.TRADING?.evaluate_open_interest_increase,
          openInterestPeriod: configFromServer.TRADING?.open_interest_period,

          // Mapeo de Media Móvil
          evaluateMaFilter: configFromServer.TRADING?.evaluate_ma_filter,
          maType: configFromServer.TRADING?.ma_type,
          maPeriod: configFromServer.TRADING?.ma_period,

          // --- NUEVO: Mapeo de Estrategia de Soportes ---
          evaluateSupportStrategy: configFromServer.TRADING?.evaluate_support_strategy,
          supportHistoryCandles: configFromServer.TRADING?.support_history_candles,
          supportPivotWindow: configFromServer.TRADING?.support_pivot_window,
          supportConfirmations: configFromServer.TRADING?.support_confirmations,
          supportLevelTolerancePercent: configFromServer.TRADING?.support_level_tolerance_percent,
          supportOrderStopLossPercent: configFromServer.TRADING?.support_order_stop_loss_percent,
          supportOrderTakeProfitPercent: configFromServer.TRADING?.support_order_take_profit_percent,

          // Mapeo de [BINANCE]
          mode: configFromServer.BINANCE?.mode
        };

        // Filtrar claves undefined para no sobreescribir defaults innecesariamente
        Object.keys(mappedData).forEach(key => {
          if (mappedData[key] === undefined) {
            delete mappedData[key];
          }
        });
        
        setFormData(prevData => ({ ...prevData, ...mappedData }));
        if (onStrategyNameChange && mappedData.activeStrategyName) {
            onStrategyNameChange(mappedData.activeStrategyName);
        }

      } catch (error) {
        console.error("Error al cargar la configuración del servidor:", error);
        setError("No se pudo cargar la configuración de config.ini. Se muestran los valores por defecto.");
      }
    };

    fetchInitialConfig();
  }, [onStrategyNameChange]); // Dependencia para que se ejecute una vez
  // -------------------------------------------------------------

  useEffect(() => {
    if (propInitialConfig) {
      const newFormData = { ...defaultConfigValues }; 

      // Copiar todos los valores de propInitialConfig al nuevo estado del formulario
      // Esto manejará la mayoría de las claves, incluyendo las que ya están en camelCase
      for (const key in propInitialConfig) {
        if (Object.prototype.hasOwnProperty.call(propInitialConfig, key)) {
          newFormData[key] = propInitialConfig[key];
        }
      }

      // Mapeo específico para claves que difieren o necesitan conversión especial
      // Para 'downtrendLevelCheck' (campo numérico del formulario):
      // Debe tomar su valor de 'downtrend_level_check' (snake_case desde el backend).
      if (propInitialConfig.downtrend_level_check !== undefined) {
        newFormData.downtrendLevelCheck = propInitialConfig.downtrend_level_check;
      }
      // No hay necesidad de la condición 'else if (propInitialConfig.evaluateDowntrendLevelsBlock !== undefined)' aquí
      // para 'newFormData.downtrendLevelCheck', ya que 'evaluateDowntrendLevelsBlock'
      // es para el checkbox y ya se habrá copiado a 'newFormData.evaluateDowntrendLevelsBlock' en el bucle anterior si existe.

      // Si el backend enviara 'evaluate_downtrend_levels_block' (snake_case) y el form usa 'evaluateDowntrendLevelsBlock' (camelCase)
      // el bucle anterior ya lo manejaría si 'propInitialConfig' tuviera la clave correcta del backend.
      // El backend ya envía 'evaluateDowntrendLevelsBlock', así que el bucle es suficiente.

      setFormData(newFormData);
      if (onStrategyNameChange) {
        onStrategyNameChange('');
      }
      console.log("ConfigForm recibió propInitialConfig y actualizó formData:", newFormData);
    }
  }, [propInitialConfig, onStrategyNameChange]);

  const handleChange = (event) => {
    const { name, value, type, checked } = event.target;
    setFormData(prevFormData => ({
      ...prevFormData,
      [name]: type === 'checkbox' ? checked : value
    }));
    // Al cambiar cualquier campo, indicar que la estrategia actual (si la había) ha sido modificada.
    if (onStrategyNameChange) {
      onStrategyNameChange('Configuración Modificada'); // O simplemente '' para borrarlo
    }
  };

  const handleSubmit = async (event) => {
    event.preventDefault();
    setIsLoading(true);
    setError(null);
    setShowSuccessMessage(false);

    const dataToSend = { ...formData };
    if (dataToSend.downtrendLevelCheck !== undefined) {
        dataToSend.downtrend_level_check = dataToSend.downtrendLevelCheck;
    }
    if (dataToSend.evaluateOpenInterestIncrease !== undefined) {
        dataToSend.evaluate_open_interest_increase = dataToSend.evaluateOpenInterestIncrease;
    }
    if (dataToSend.openInterestPeriod !== undefined) {
        dataToSend.open_interest_period = dataToSend.openInterestPeriod;
    }

    // --- NUEVO: Añadir los nuevos campos de MA al objeto que se envía ---
    if (dataToSend.evaluateMaFilter !== undefined) {
      dataToSend.evaluate_ma_filter = dataToSend.evaluateMaFilter;
    }
    if (dataToSend.maType !== undefined) {
      dataToSend.ma_type = dataToSend.maType;
    }
    if (dataToSend.maPeriod !== undefined) {
      dataToSend.ma_period = dataToSend.maPeriod;
    }

    // --- NUEVO: Añadir los nuevos campos de Soportes al objeto que se envía ---
    if (dataToSend.evaluateSupportStrategy !== undefined) {
      dataToSend.evaluate_support_strategy = dataToSend.evaluateSupportStrategy;
    }
    if (dataToSend.supportHistoryCandles !== undefined) {
      dataToSend.support_history_candles = dataToSend.supportHistoryCandles;
    }
    if (dataToSend.supportPivotWindow !== undefined) {
      dataToSend.support_pivot_window = dataToSend.supportPivotWindow;
    }
    if (dataToSend.supportConfirmations !== undefined) {
      dataToSend.support_confirmations = dataToSend.supportConfirmations;
    }
    if (dataToSend.supportLevelTolerancePercent !== undefined) {
      dataToSend.support_level_tolerance_percent = dataToSend.supportLevelTolerancePercent;
    }
    if (dataToSend.supportOrderStopLossPercent !== undefined) {
      dataToSend.support_order_stop_loss_percent = dataToSend.supportOrderStopLossPercent;
    }
    if (dataToSend.supportOrderTakeProfitPercent !== undefined) {
      dataToSend.support_order_take_profit_percent = dataToSend.supportOrderTakeProfitPercent;
    }

    try {
      const success = await onSave(dataToSend);
      if (success) {
        setShowSuccessMessage(true);
        setTimeout(() => setShowSuccessMessage(false), 3000);
        // Al guardar en config.ini, la configuración ya no es una estrategia nombrada específica.
      }
    } catch (err) {
      setError(err.message || 'Error al guardar la configuración.');
    } finally {
      setIsLoading(false);
    }
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
      setFormData(newFormData); // Actualizar el formulario con los datos de la estrategia
      if (onStrategyNameChange) {
        onStrategyNameChange(strategyName); // Actualizar el nombre en la cabecera
      }
      setLoadStrategySuccess(`Estrategia '${strategyName}' cargada en el formulario. ¡Recuerda guardar la configuración si deseas aplicarla!`);
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

  const renderLabelWithCheckbox = (fieldName, labelText, checkboxName) => (
    <div className="flex items-center justify-between mb-1">
      <label htmlFor={fieldName} className="block text-sm font-medium text-gray-700 dark:text-gray-300">
        {labelText}
      </label>
      <div className="flex items-center">
        <input
          id={checkboxName}
          name={checkboxName}
          type="checkbox"
          checked={!!formData[checkboxName]}
          onChange={handleChange}
          className="h-4 w-4 text-primary-600 border-gray-300 rounded focus:ring-primary-500 dark:bg-gray-700 dark:border-gray-600"
        />
        <span className="ml-2 text-xs text-gray-500 dark:text-gray-400">
          ({formData[checkboxName] ? 'Activado' : 'Desactivado'})
        </span>
      </div>
    </div>
  );

  if (!propInitialConfig) {
    return <p className="text-center text-gray-500 dark:text-gray-400">Cargando configuración...</p>;
  }

  return (
    <form onSubmit={handleSubmit} className="space-y-6 bg-white dark:bg-gray-800 shadow-lg rounded-lg p-6 mb-8">
      <h2 className="text-xl font-semibold text-gray-900 dark:text-white mb-6">Configuración del Bot</h2>
      
      <fieldset className="border pt-4 px-4 pb-6 rounded-md border-gray-300 dark:border-gray-600">
        <legend className="text-base font-medium text-gray-900 dark:text-gray-100 px-2">General</legend>
        <div className="grid grid-cols-1 md:grid-cols-4 gap-6 mt-4">
          <ConfigItem labelText="Modo de Operación" htmlFor="mode" tooltipText={tooltipTexts.mode}>
            <select id="mode" name="mode" value={formData.mode} onChange={handleChange} className="mt-1 block w-full py-2 px-3 border border-gray-300 bg-white dark:bg-gray-900 dark:border-gray-700 rounded-md shadow-sm focus:outline-none focus:ring-primary-500 focus:border-primary-500 sm:text-sm">
              <option value="paper">Paper Trading (Simulación)</option>
              <option value="real">Real (con dinero real)</option>
            </select>
          </ConfigItem>
          <ConfigItem labelText="Apalancamiento (Multiplicador x)" htmlFor="leverage" tooltipText={tooltipTexts.leverage}>
            <input type="number" name="leverage" id="leverage" value={formData.leverage} onChange={handleChange} min="1" max="125" step="1" className="mt-1 block w-full py-2 px-3 border border-gray-300 bg-white dark:bg-gray-900 dark:border-gray-700 rounded-md shadow-sm focus:outline-none focus:ring-primary-500 focus:border-primary-500 sm:text-sm" placeholder="Ej: 3 (para 3x)"/>
          </ConfigItem>
          <ConfigItem labelText="Tamaño Posición (USDT)" htmlFor="positionSizeUSDT" tooltipText={tooltipTexts.positionSizeUSDT}>
            <input type="number" name="positionSizeUSDT" id="positionSizeUSDT" value={formData.positionSizeUSDT} onChange={handleChange} step="any" className="mt-1 block w-full py-2 px-3 border border-gray-300 bg-white dark:bg-gray-900 dark:border-gray-700 rounded-md shadow-sm focus:outline-none focus:ring-primary-500 focus:border-primary-500 sm:text-sm" min="1"/>
          </ConfigItem>
          <ConfigItem labelText="Intervalo de Velas General" htmlFor="rsiInterval" tooltipText={tooltipTexts.rsi_interval}>
            <input type="text" name="rsiInterval" id="rsiInterval" value={formData.rsiInterval} onChange={handleChange} className="mt-1 block w-full py-2 px-3 border border-gray-300 bg-white dark:bg-gray-900 dark:border-gray-700 rounded-md shadow-sm focus:outline-none focus:ring-primary-500 focus:border-primary-500 sm:text-sm" placeholder="Ej: 1m, 5m"/>
          </ConfigItem>
          <div className="md:col-span-4">
            <ConfigItem labelText="Símbolos (separados por coma)" htmlFor="symbolsToTrade" tooltipText={tooltipTexts.symbolsToTrade}>
              <textarea name="symbolsToTrade" id="symbolsToTrade" value={formData.symbolsToTrade} onChange={handleChange} rows={2} className="mt-1 block w-full py-2 px-3 border border-gray-300 bg-white dark:bg-gray-900 dark:border-gray-700 rounded-md shadow-sm focus:outline-none focus:ring-primary-500 focus:border-primary-500 sm:text-sm" placeholder="BTCUSDT,ETHUSDT"></textarea>
            </ConfigItem>
          </div>
        </div>
      </fieldset>

      {/* --- SECCIÓN UNIFICADA DE GESTIÓN DE RIESGO --- */}
      <ConfigSection title="Monitor y Gestión de Riesgo Global">
        {riskError && <p className="text-red-500 text-sm mb-4">{riskError}</p>}
        {riskData ? (
          <div className="space-y-4">
            {/* Fila de Datos */}
            <div className="grid grid-cols-1 md:grid-cols-3 gap-4 text-center">
              <div className="bg-gray-700 p-3 rounded-lg">
                <h4 className="text-sm font-medium text-gray-400">Balance Total (USDT)</h4>
                <p className="text-lg font-semibold text-white">{riskData.total_balance}</p>
              </div>
              <div className="bg-gray-700 p-3 rounded-lg">
                <h4 className="text-sm font-medium text-gray-400">Máximo de Exposición</h4>
                <p className="text-lg font-semibold text-white">{riskData.max_exposure} <span className="text-xs text-gray-400">({riskData.risk_percentage})</span></p>
              </div>
              <div className="bg-gray-700 p-3 rounded-lg">
                <h4 className="text-sm font-medium text-gray-400">Exposición Actual</h4>
                <p className="text-lg font-semibold text-white">{riskData.current_exposure}</p>
              </div>
            </div>

            {/* Barra de Progreso */}
            <div>
              <div className="w-full bg-gray-600 rounded-full h-4 relative">
                <div 
                  className={`h-4 rounded-full transition-all duration-500 ${(() => {
                    const maxExpNum = parseFloat(riskData.max_exposure);
                    const currentExpNum = parseFloat(riskData.current_exposure);
                    const progressPercentage = maxExpNum > 0 ? (currentExpNum / maxExpNum) * 100 : 0;
                    if (progressPercentage > 90) return 'bg-red-500';
                    if (progressPercentage > 70) return 'bg-yellow-500';
                    return 'bg-green-500';
                  })()}`}
                  style={{ width: `${(() => {
                    const maxExpNum = parseFloat(riskData.max_exposure);
                    const currentExpNum = parseFloat(riskData.current_exposure);
                    const progressPercentage = maxExpNum > 0 ? (currentExpNum / maxExpNum) * 100 : 0;
                    return Math.min(progressPercentage, 100); // Capado al 100%
                  })()}%` }}
                ></div>
              </div>
            </div>

            {/* Fila de Configuración */}
            <div className="grid grid-cols-1 md:grid-cols-2 gap-6 pt-4 border-t border-gray-700">
              <ConfigItem
                labelText="Ajustar Máximo % de Capital en Riesgo"
                htmlFor="risk-percentage"
                tooltipText={tooltipTexts.riskPercentage}
              >
                <div className="mt-1 flex rounded-md shadow-sm">
                  <NumberInput
                    id="risk-percentage"
                    name="risk-percentage"
                    value={riskPercentage}
                    onChange={(e) => setRiskPercentage(e.target.value)}
                    min="0"
                    max="100"
                  />
                  <span className="inline-flex items-center px-3 rounded-r-md border border-l-0 border-gray-300 bg-gray-50 text-gray-500 sm:text-sm dark:bg-gray-700 dark:border-gray-600 dark:text-gray-300">
                    %
                  </span>
                </div>
              </ConfigItem>
              <div className="self-end pb-1">
                <button
                  type="button"
                  onClick={handleSaveRisk}
                  className="w-full bg-purple-600 hover:bg-purple-700 text-white font-bold py-2 px-4 rounded-md focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-purple-500"
                >
                  Guardar Riesgo
                </button>
              </div>
            </div>

          </div>
        ) : (
          <p className="text-center text-gray-400">Cargando datos del monitor de riesgo...</p>
        )}
      </ConfigSection>
      {/* ------------------------------------------- */}

      <fieldset className="border pt-4 px-4 pb-6 rounded-md border-gray-300 dark:border-gray-600">
        <legend className="text-base font-medium text-gray-900 dark:text-gray-100 px-2">Parámetros de ENTRADA</legend>
            <div className="grid grid-cols-1 md:grid-cols-3 gap-6 mt-4"> 
          <ConfigItem labelText="Periodo RSI" htmlFor="rsiPeriod" tooltipText={tooltipTexts.rsi_period}>
            <input type="number" name="rsiPeriod" id="rsiPeriod" value={formData.rsiPeriod} onChange={handleChange} className="mt-1 block w-full py-2 px-3 border border-gray-300 bg-white dark:bg-gray-900 dark:border-gray-700 rounded-md shadow-sm focus:outline-none focus:ring-primary-500 focus:border-primary-500 sm:text-sm" min="1"/>
          </ConfigItem>
          <div>
            <div className="flex items-center">
              {renderLabelWithCheckbox("rsiThresholdUp", "RSI Cambio Positivo", "evaluateRsiDelta")}
              <Tooltip text={tooltipTexts.rsiThresholdUp} />
            </div>
            <input type="number" name="rsiThresholdUp" id="rsiThresholdUp" value={formData.rsiThresholdUp} onChange={handleChange} step="any" className="mt-1 block w-full py-2 px-3 border border-gray-300 bg-white dark:bg-gray-900 dark:border-gray-700 rounded-md shadow-sm focus:outline-none focus:ring-primary-500 focus:border-primary-500 sm:text-sm"/>
          </div>
          <div>
            <div className="flex items-center">
              {renderLabelWithCheckbox("rsiEntryLevelLow", "RSI Límite Inferior", "evaluateRsiRange")}
              <Tooltip text={tooltipTexts.rsiEntryLevelLow} />
            </div>
            <input type="number" name="rsiEntryLevelLow" id="rsiEntryLevelLow" value={formData.rsiEntryLevelLow} onChange={handleChange} step="any" className="mt-1 block w-full py-2 px-3 border border-gray-300 bg-white dark:bg-gray-900 dark:border-gray-700 rounded-md shadow-sm focus:outline-none focus:ring-primary-500 focus:border-primary-500 sm:text-sm"/>
            <p className="mt-1 text-xs text-gray-500 dark:text-gray-400">Eval. Rango también afecta Límite Superior.</p>
          </div>
          <ConfigItem labelText="RSI Límite Superior" htmlFor="rsiEntryLevelHigh" tooltipText={tooltipTexts.rsiEntryLevelHigh}>
            <input type="number" name="rsiEntryLevelHigh" id="rsiEntryLevelHigh" value={formData.rsiEntryLevelHigh} onChange={handleChange} step="any" className="mt-1 block w-full py-2 px-3 border border-gray-300 bg-white dark:bg-gray-900 dark:border-gray-700 rounded-md shadow-sm focus:outline-none focus:ring-primary-500 focus:border-primary-500 sm:text-sm"/>
          </ConfigItem>
          <ConfigItem labelText="Periodo SMA Volumen" htmlFor="volumeSmaPeriod" tooltipText={tooltipTexts.volumeSmaPeriod}>
            <input type="number" name="volumeSmaPeriod" id="volumeSmaPeriod" value={formData.volumeSmaPeriod} onChange={handleChange} className="mt-1 block w-full py-2 px-3 border border-gray-300 bg-white dark:bg-gray-900 dark:border-gray-700 rounded-md shadow-sm focus:outline-none focus:ring-primary-500 focus:border-primary-500 sm:text-sm"/>
          </ConfigItem>
          <div>
            <div className="flex items-center">
              {renderLabelWithCheckbox("volumeFactor", "Factor Volumen Mínimo", "evaluateVolumeFilter")}
              <Tooltip text={tooltipTexts.volumeFactor} />
            </div>
            <input type="number" name="volumeFactor" id="volumeFactor" value={formData.volumeFactor} onChange={handleChange} step="0.1" className="mt-1 block w-full py-2 px-3 border border-gray-300 bg-white dark:bg-gray-900 dark:border-gray-700 rounded-md shadow-sm focus:outline-none focus:ring-primary-500 focus:border-primary-500 sm:text-sm"/>
          </div>
          <div>
            <div className="flex items-center">
              {renderLabelWithCheckbox("downtrendCheckCandles", "Velas Rojas para Bloquear", "evaluateDowntrendCandlesBlock")}
              <Tooltip text={tooltipTexts.downtrendCheckCandles} />
            </div>
            <input type="number" name="downtrendCheckCandles" id="downtrendCheckCandles" value={formData.downtrendCheckCandles} onChange={handleChange} className="mt-1 block w-full py-2 px-3 border border-gray-300 bg-white dark:bg-gray-900 dark:border-gray-700 rounded-md shadow-sm focus:outline-none focus:ring-primary-500 focus:border-primary-500 sm:text-sm"/>
          </div>
          <div>
            <div className="flex items-center">
              {renderLabelWithCheckbox("downtrendLevelCheck", "Nivel RSI para Bloquear", "evaluateDowntrendLevelsBlock")}
              <Tooltip text={tooltipTexts.downtrendLevelCheck} />
            </div>
            <input type="number" name="downtrendLevelCheck" id="downtrendLevelCheck" value={formData.downtrendLevelCheck} onChange={handleChange} className="mt-1 block w-full py-2 px-3 border border-gray-300 bg-white dark:bg-gray-900 dark:border-gray-700 rounded-md shadow-sm focus:outline-none focus:ring-primary-500 focus:border-primary-500 sm:text-sm"/>
          </div>
          <div>
            <div className="flex items-center">
              {renderLabelWithCheckbox("requiredUptrendCandles", "Velas Verdes Requeridas", "evaluateRequiredUptrend")}
              <Tooltip text={tooltipTexts.requiredUptrendCandles} />
            </div>
            <input type="number" name="requiredUptrendCandles" id="requiredUptrendCandles" value={formData.requiredUptrendCandles} onChange={handleChange} className="mt-1 block w-full py-2 px-3 border border-gray-300 bg-white dark:bg-gray-900 dark:border-gray-700 rounded-md shadow-sm focus:outline-none focus:ring-primary-500 focus:border-primary-500 sm:text-sm"/>
          </div>
          <div>
            <div className="flex items-center">
              {renderLabelWithCheckbox("openInterestPeriod", "Filtro Interés Abierto (OI)", "evaluateOpenInterestIncrease")}
              <Tooltip text={tooltipTexts.evaluateOpenInterestIncrease} />
            </div>
            <input type="text" name="openInterestPeriod" id="openInterestPeriod" value={formData.openInterestPeriod} onChange={handleChange} className="mt-1 block w-full py-2 px-3 border border-gray-300 bg-white dark:bg-gray-900 dark:border-gray-700 rounded-md shadow-sm focus:outline-none focus:ring-primary-500 focus:border-primary-500 sm:text-sm" placeholder="Ej: 5m, 15m"/>
          </div>
        </div>
      </fieldset>

      {/* --- Estrategia de Media Móvil --- */}
      <ConfigSection title="Filtro de Media Móvil (MA)" className="col-span-1">
        <div className="space-y-4">
          <ConfigItem labelText="Activar Filtro de Media Móvil" tooltipText={tooltipTexts.evaluateMaFilter}>
            <Switch
              name="evaluateMaFilter"
              checked={formData.evaluateMaFilter}
              onChange={handleChange}
            />
          </ConfigItem>
          {formData.evaluateMaFilter && (
            <>
              <ConfigItem labelText="Período de la Media Móvil" htmlFor="maPeriod" tooltipText={tooltipTexts.maPeriod}>
                <NumberInput
                  id="maPeriod"
                  name="maPeriod"
                  value={formData.maPeriod}
                  onChange={handleChange}
                />
              </ConfigItem>
            </>
          )}
        </div>
      </ConfigSection>

      {/* --- NUEVA SECCIÓN: Estrategia de Soportes Confirmados --- */}
      <ConfigSection title="Estrategia de Soportes Confirmados" className="col-span-1 md:col-span-2">
        <div className="space-y-4">
          <ConfigItem labelText="Activar Estrategia de Soportes (Desactiva la Estrategia RSI)" tooltipText={tooltipTexts.evaluateSupportStrategy}>
            <Switch
              name="evaluateSupportStrategy"
              checked={formData.evaluateSupportStrategy}
              onChange={handleChange}
            />
          </ConfigItem>

          {formData.evaluateSupportStrategy && (
            <div className="grid grid-cols-1 md:grid-cols-3 gap-6 pt-4">
              <ConfigItem labelText="Velas de Historial" htmlFor="supportHistoryCandles" tooltipText={tooltipTexts.supportHistoryCandles}>
                <NumberInput
                  id="supportHistoryCandles"
                  name="supportHistoryCandles"
                  value={formData.supportHistoryCandles}
                  onChange={handleChange}
                />
              </ConfigItem>
              <ConfigItem labelText="Ventana de Pivote" htmlFor="supportPivotWindow" tooltipText={tooltipTexts.supportPivotWindow}>
                <NumberInput
                  id="supportPivotWindow"
                  name="supportPivotWindow"
                  value={formData.supportPivotWindow}
                  onChange={handleChange}
                />
              </ConfigItem>
              <ConfigItem labelText="Confirmaciones Mínimas" htmlFor="supportConfirmations" tooltipText={tooltipTexts.supportConfirmations}>
                <NumberInput
                  id="supportConfirmations"
                  name="supportConfirmations"
                  value={formData.supportConfirmations}
                  onChange={handleChange}
                />
              </ConfigItem>
              <ConfigItem labelText="Tolerancia de Nivel (%)" htmlFor="supportLevelTolerancePercent" tooltipText={tooltipTexts.supportLevelTolerancePercent}>
                <NumberInput
                  id="supportLevelTolerancePercent"
                  name="supportLevelTolerancePercent"
                  value={formData.supportLevelTolerancePercent}
                  onChange={handleChange}
                  step={0.1}
                />
              </ConfigItem>
              <ConfigItem labelText="Stop Loss de Orden (%)" htmlFor="supportOrderStopLossPercent" tooltipText={tooltipTexts.supportOrderStopLossPercent}>
                <NumberInput
                  id="supportOrderStopLossPercent"
                  name="supportOrderStopLossPercent"
                  value={formData.supportOrderStopLossPercent}
                  onChange={handleChange}
                  step={0.1}
                />
              </ConfigItem>
              <ConfigItem labelText="Take Profit de Orden (%)" htmlFor="supportOrderTakeProfitPercent" tooltipText={tooltipTexts.supportOrderTakeProfitPercent}>
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

      {/* --- Trailing Stops --- */}
      <ConfigSection title="Trailing Stops" className="col-span-1 md:col-span-3">
        <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
              <div>
                <div className="flex items-center">
                  {renderLabelWithCheckbox("takeProfitUSDT", "Take Profit (USDT)", "enableTakeProfitPnl")}
                  <Tooltip text={tooltipTexts.takeProfitUSDT} />
                </div>
              <input type="number" name="takeProfitUSDT" id="takeProfitUSDT" value={formData.takeProfitUSDT} onChange={handleChange} step="any" className="mt-1 block w-full py-2 px-3 border border-gray-300 bg-white dark:bg-gray-900 dark:border-gray-700 rounded-md shadow-sm focus:outline-none focus:ring-primary-500 focus:border-primary-500 sm:text-sm" min="0"/>
              </div>
              <div>
                <div className="flex items-center">
                  {renderLabelWithCheckbox("stopLossUSDT", "Stop Loss (USDT)", "enableStopLossPnl")}
                  <Tooltip text={tooltipTexts.stopLossUSDT} />
                </div>
            <input type="number" name="stopLossUSDT" id="stopLossUSDT" value={formData.stopLossUSDT} onChange={handleChange} step="any" className="mt-1 block w-full py-2 px-3 border border-gray-300 bg-white dark:bg-gray-900 dark:border-gray-700 rounded-md shadow-sm focus:outline-none focus:ring-primary-500 focus:border-primary-500 sm:text-sm" placeholder="Ej: 20"/>
          </div>
            <ConfigItem labelText="RSI Objetivo Activación (Salida)" htmlFor="rsiTarget" tooltipText={tooltipTexts.rsiTarget}>
              <input type="number" name="rsiTarget" id="rsiTarget" value={formData.rsiTarget} onChange={handleChange} step="any" className="mt-1 block w-full py-2 px-3 border border-gray-300 bg-white dark:bg-gray-900 dark:border-gray-700 rounded-md shadow-sm focus:outline-none focus:ring-primary-500 focus:border-primary-500 sm:text-sm"/>
            </ConfigItem>
              <div>
                <div className="flex items-center">
                  {renderLabelWithCheckbox("rsiThresholdDown", "RSI Drop Salida (Negativo)", "enableTrailingRsiStop")}
                  <Tooltip text={tooltipTexts.rsiThresholdDown} />
                </div>
              <input type="number" name="rsiThresholdDown" id="rsiThresholdDown" value={formData.rsiThresholdDown} onChange={handleChange} step="any" className="mt-1 block w-full py-2 px-3 border border-gray-300 bg-white dark:bg-gray-900 dark:border-gray-700 rounded-md shadow-sm focus:outline-none focus:ring-primary-500 focus:border-primary-500 sm:text-sm"/>
              <p className="mt-1 text-xs text-gray-500 dark:text-gray-400">Eval. Trailing RSI también afecta RSI Objetivo.</p>
            </div>
            <div>
              <div className="flex items-center">
                {renderLabelWithCheckbox("priceTrailingStopDistanceUSDT", "Distancia Trailing Precio (USDT)", "enablePriceTrailingStop")}
                <Tooltip text={tooltipTexts.priceTrailingStopDistanceUSDT} />
              </div>
                <input
                type="number"
                name="priceTrailingStopDistanceUSDT"
                id="priceTrailingStopDistanceUSDT"
                value={formData.priceTrailingStopDistanceUSDT}
                  onChange={handleChange}
                  step="any"
                className="mt-1 block w-full py-2 px-3 border border-gray-300 bg-white dark:bg-gray-900 dark:border-gray-700 rounded-md shadow-sm focus:outline-none focus:ring-primary-500 focus:border-primary-500 sm:text-sm"
                min="0"
                />
              </div>
              <ConfigItem labelText="Activación PNL para Trailing Precio (USDT)" htmlFor="priceTrailingStopActivationPnlUSDT" tooltipText={tooltipTexts.priceTrailingStopActivationPnlUSDT}>
                <input
                type="number"
                name="priceTrailingStopActivationPnlUSDT"
                id="priceTrailingStopActivationPnlUSDT"
                value={formData.priceTrailingStopActivationPnlUSDT}
                  onChange={handleChange}
              className="mt-1 block w-full p-2 border border-gray-300 rounded-md shadow-sm focus:ring-blue-500 focus:border-blue-500 sm:text-sm dark:bg-gray-700 dark:border-gray-600 dark:placeholder-gray-400 dark:text-white"
                step="any"
                />
              </ConfigItem>

              {/* Contenedor reorganizado para poner los campos de Trailing PNL lado a lado */}
              <div className="md:col-span-3">
                <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                  
                  {/* Campo de Activación PNL */}
                  <ConfigItem 
                    description="PNL mínimo en USDT que debe alcanzar la posición para armar este trailing stop por PNL."
                  >
                    <div className="flex items-center">
                      {renderLabelWithCheckbox("pnlTrailingStopActivationUSDT", "Activación PNL para Trailing PNL (USDT)", "enablePnlTrailingStop")}
                      <Tooltip text={tooltipTexts.pnlTrailingStopActivationUSDT} />
                    </div>
                    <input
                      type="number"
                      id="pnlTrailingStopActivationUSDT"
                      name="pnlTrailingStopActivationUSDT"
                      value={formData.pnlTrailingStopActivationUSDT}
                      onChange={handleChange}
                      disabled={!formData.enablePnlTrailingStop}
                      className="mt-1 block w-full p-2 border border-gray-300 rounded-md shadow-sm focus:ring-blue-500 focus:border-blue-500 sm:text-sm dark:bg-gray-700 dark:border-gray-600 dark:placeholder-gray-400 dark:text-white disabled:opacity-50"
                      step="any"
                    />
                  </ConfigItem>

                  {/* Campo de Caída de PNL */}
                  <ConfigItem 
                    labelText="Caída de PNL para Salir (USDT)" 
                    htmlFor="pnlTrailingStopDropUSDT" 
                    description="Si está armado, se sale si el PNL cae esta cantidad en USDT desde el PNL pico alcanzado."
                    tooltipText={tooltipTexts.pnlTrailingStopDropUSDT}
                  >
                      <input
                      type="number"
                      id="pnlTrailingStopDropUSDT"
                      name="pnlTrailingStopDropUSDT"
                      value={formData.pnlTrailingStopDropUSDT}
                      onChange={handleChange}
                      disabled={!formData.enablePnlTrailingStop}
                      className="mt-1 block w-full p-2 border border-gray-300 rounded-md shadow-sm focus:ring-blue-500 focus:border-blue-500 sm:text-sm dark:bg-gray-700 dark:border-gray-600 dark:placeholder-gray-400 dark:text-white disabled:opacity-50"
                      step="any"
                      />
                  </ConfigItem>

                </div>
              </div>
        </div>
      </ConfigSection>

        <fieldset className="border pt-4 px-4 pb-6 rounded-md border-gray-300 dark:border-gray-600">
        <legend className="text-base font-medium text-gray-900 dark:text-gray-100 px-2">Otros Parámetros</legend>
            <div className="grid grid-cols-1 md:grid-cols-3 gap-6 mt-4">
              <ConfigItem labelText="Ciclo de Segundos" htmlFor="cycleSleepSeconds" description="Pausa entre cada ciclo del bot." tooltipText={tooltipTexts.cycleSleepSeconds}>
            <input type="number" name="cycleSleepSeconds" id="cycleSleepSeconds" value={formData.cycleSleepSeconds} onChange={handleChange} className="mt-1 block w-full py-2 px-3 border border-gray-300 bg-white dark:bg-gray-900 dark:border-gray-700 rounded-md shadow-sm focus:outline-none focus:ring-primary-500 focus:border-primary-500 sm:text-sm"/>
            <p className="mt-1 text-xs text-gray-500 dark:text-gray-400">Pausa entre cada ciclo del bot.</p>
              </ConfigItem>
              <ConfigItem labelText="Timeout de Orden (segundos)" htmlFor="orderTimeoutSeconds" description="Tiempo para cancelar una orden si no se completa." tooltipText={tooltipTexts.orderTimeoutSeconds}>
            <input type="number" name="orderTimeoutSeconds" id="orderTimeoutSeconds" value={formData.orderTimeoutSeconds} onChange={handleChange} className="mt-1 block w-full py-2 px-3 border border-gray-300 bg-white dark:bg-gray-900 dark:border-gray-700 rounded-md shadow-sm focus:outline-none focus:ring-primary-500 focus:border-primary-500 sm:text-sm"/>
            <p className="mt-1 text-xs text-gray-500 dark:text-gray-400">Tiempo para cancelar una orden si no se completa.</p>
              </ConfigItem>
            </div>
        </fieldset>

      <div className="pt-6">
        <button type="submit" disabled={isLoading} className="w-full bg-primary-600 hover:bg-primary-700 text-white font-bold py-2 px-4 rounded-md focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-primary-500 disabled:opacity-50">
          {isLoading ? 'Guardando en config.ini...' : 'Guardar Configuración (para el Bot)'}
          </button>
        {showSuccessMessage && <p className="mt-2 text-sm text-green-600 dark:text-green-400 text-center">¡Configuración (config.ini) guardada exitosamente!</p>}
        {error && <p className="mt-2 text-sm text-red-600 dark:text-red-400 text-center">Error al guardar config.ini: {error}</p>}
        </div>

      {/* --- Sección de Gestión de Estrategias --- */}
      <ConfigSection title="Gestión de Estrategias" className="bg-gray-50 dark:bg-gray-800/50">
        <div className="space-y-6">
          {/* Guardar Estrategia */}
          <div>
            <h4 className="text-md font-medium text-gray-800 dark:text-gray-200 mb-2">Guardar Configuración Actual como Estrategia</h4>
            <div className="flex items-end space-x-3">
              <div className="flex-grow">
                <label htmlFor="strategyNameInput" className="block text-sm font-medium text-gray-700 dark:text-gray-300">Nombre para la Estrategia:</label>
                <input 
                  type="text" 
                  id="strategyNameInput"
                  value={strategyNameInput}
                  onChange={(e) => setStrategyNameInput(e.target.value)}
                  placeholder="Ej: MiEstrategiaRSI"
                  className="mt-1 block w-full py-2 px-3 border border-gray-300 bg-white dark:bg-gray-900 dark:border-gray-700 rounded-md shadow-sm focus:outline-none focus:ring-primary-500 focus:border-primary-500 sm:text-sm"
                />
              </div>
              <button 
                type="button" 
                onClick={handleSaveCurrentStrategy} 
                disabled={isSavingStrategy || !strategyNameInput.trim()}
                className="px-4 py-2 bg-blue-600 hover:bg-blue-700 text-white font-semibold rounded-md shadow-sm focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-blue-500 disabled:opacity-50 whitespace-nowrap"
              >
                {isSavingStrategy ? 'Guardando...' : 'Guardar Estrategia'}
              </button>
            </div>
            {saveStrategySuccess && <p className="mt-2 text-sm text-green-500 dark:text-green-400">{saveStrategySuccess}</p>}
            {saveStrategyError && <p className="mt-2 text-sm text-red-500 dark:text-red-400">{saveStrategyError}</p>}
          </div>

          {/* Cargar Estrategia */}
          <div className="pt-6 border-t border-gray-300 dark:border-gray-600">
            <h4 className="text-md font-medium text-gray-800 dark:text-gray-200 mb-2">Estrategias Guardadas</h4>
            {isLoadingStrategies && <p className="text-sm text-gray-500 dark:text-gray-400">Cargando lista de estrategias...</p>}
            {strategyError && <p className="text-sm text-red-500 dark:text-red-400">Error al cargar estrategias: {strategyError}</p>}
            
            {deleteStrategySuccess && <p className="mt-2 mb-2 text-sm text-green-500 dark:text-green-400">{deleteStrategySuccess}</p>}
            {deleteStrategyError && <p className="mt-2 mb-2 text-sm text-red-500 dark:text-red-400">{deleteStrategyError}</p>}

            {!isLoadingStrategies && !strategyError && (
              availableStrategies.length > 0 ? (
                <ul className="space-y-3">
                  {availableStrategies.map(name => (
                    <li key={name} className="p-3 bg-gray-50 dark:bg-gray-700 rounded-md shadow-sm flex items-center justify-between">
                      <span className="text-gray-800 dark:text-gray-200 font-medium">{name}</span>
                      <div className="space-x-2 flex-shrink-0">
                        <button 
                          type="button" 
                          onClick={() => handleLoadSelectedStrategy(name)} // Modificado para pasar el nombre directamente
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
                  ))}
                </ul>
              ) : (
                <p className="text-sm text-gray-500 dark:text-gray-400">No hay estrategias guardadas.</p>
              )
            )}
            {/* Mensajes de éxito/error para la carga general (si se mantiene el select) */}
            {loadStrategySuccess && !deleteStrategySuccess && <p className="mt-2 text-sm text-green-500 dark:text-green-400">{loadStrategySuccess}</p>}
            {loadStrategyError && !deleteStrategyError && <p className="mt-2 text-sm text-red-500 dark:text-red-400">{loadStrategyError}</p>}
          </div>
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