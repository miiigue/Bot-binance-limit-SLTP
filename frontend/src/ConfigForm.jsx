import React, { useState, useEffect } from 'react';

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

function ConfigItem({ labelText, htmlFor, description, children }) {
  return (
    <div>
      <label htmlFor={htmlFor} className="block text-sm font-medium text-gray-700 dark:text-gray-300">
        {labelText}
      </label>
      {children}
      {description && <p className="mt-1 text-xs text-gray-500 dark:text-gray-400">{description}</p>}
    </div>
  );
}
// --- Fin Definiciones de Componentes Auxiliares ---

// Valores iniciales o por defecto para el formulario
const defaultConfigValues = {
  symbolsToTrade: '',
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
  openInterestPeriod: '5m'
};

function ConfigForm({ initialConfig: propInitialConfig, onSave }) {
  const [formData, setFormData] = useState(defaultConfigValues);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState(null);
  const [showSuccessMessage, setShowSuccessMessage] = useState(false);

  useEffect(() => {
    if (propInitialConfig) {
      // Crear una copia de propInitialConfig para no mutar el original directamente
      const newFormData = { ...defaultConfigValues }; // Empezar con defaults por si alguna clave falta en propInitialConfig

      for (const key in propInitialConfig) {
        if (Object.prototype.hasOwnProperty.call(propInitialConfig, key)) {
          // Si la clave existe en propInitialConfig, usar su valor.
          // Esto incluye los booleanos que ya deberían venir correctamente desde App.jsx
          newFormData[key] = propInitialConfig[key];
        }
      }

      // Mapeo específico si las claves internas del formulario difieren de las props
      // En App.jsx, ahora enviamos 'evaluateDowntrendLevelsBlock'. 
      // Si ConfigForm usa 'downtrendLevelCheck' internamente para su estado formData:
      if (propInitialConfig.evaluateDowntrendLevelsBlock !== undefined) {
        newFormData.downtrendLevelCheck = propInitialConfig.evaluateDowntrendLevelsBlock;
      } else if (propInitialConfig.downtrend_level_check !== undefined) { // Fallback si aún viniera la clave vieja
        newFormData.downtrendLevelCheck = propInitialConfig.downtrend_level_check;
      }

      // Las claves de Open Interest ya deberían coincidir con lo que App.jsx envía:
      // newFormData.evaluateOpenInterestIncrease = propInitialConfig.evaluateOpenInterestIncrease;
      // newFormData.openInterestPeriod = propInitialConfig.openInterestPeriod;
      // Estas se manejan por el bucle general si las claves son las mismas.

      setFormData(newFormData);
      console.log("ConfigForm recibió propInitialConfig y actualizó formData:", newFormData);
    }
  }, [propInitialConfig]);

  const handleChange = (event) => {
    const { name, value, type, checked } = event.target;
    setFormData(prevFormData => ({
      ...prevFormData,
      [name]: type === 'checkbox' ? checked : value
    }));
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

    try {
      const success = await onSave(dataToSend);
      if (success) {
        setShowSuccessMessage(true);
        setTimeout(() => setShowSuccessMessage(false), 3000);
      }
    } catch (err) {
      setError(err.message || 'Error al guardar la configuración.');
    } finally {
      setIsLoading(false);
    }
  };

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
        <div className="grid grid-cols-1 md:grid-cols-3 gap-6 mt-4">
          <div>
            <label htmlFor="mode" className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">Modo Binance</label>
            <select id="mode" name="mode" value={formData.mode} onChange={handleChange} className="mt-1 block w-full py-2 px-3 border border-gray-300 bg-white dark:bg-gray-900 dark:border-gray-700 rounded-md shadow-sm focus:outline-none focus:ring-primary-500 focus:border-primary-500 sm:text-sm">
              <option value="paper">Paper Trading (Testnet)</option>
              <option value="live">Live Trading</option>
            </select>
        </div>
          <div>
            <label htmlFor="rsiInterval" className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">Intervalo Velas RSI</label>
            <input type="text" name="rsiInterval" id="rsiInterval" value={formData.rsiInterval} onChange={handleChange} className="mt-1 block w-full py-2 px-3 border border-gray-300 bg-white dark:bg-gray-900 dark:border-gray-700 rounded-md shadow-sm focus:outline-none focus:ring-primary-500 focus:border-primary-500 sm:text-sm" placeholder="Ej: 1m, 5m"/>
              </div>
              <div>
            <label htmlFor="positionSizeUSDT" className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">Tamaño Posición (USDT)</label>
            <input type="number" name="positionSizeUSDT" id="positionSizeUSDT" value={formData.positionSizeUSDT} onChange={handleChange} step="any" className="mt-1 block w-full py-2 px-3 border border-gray-300 bg-white dark:bg-gray-900 dark:border-gray-700 rounded-md shadow-sm focus:outline-none focus:ring-primary-500 focus:border-primary-500 sm:text-sm" min="1"/>
          </div>
          <div className="md:col-span-3">
            <label htmlFor="symbolsToTrade" className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">Símbolos (separados por coma)</label>
            <textarea name="symbolsToTrade" id="symbolsToTrade" value={formData.symbolsToTrade} onChange={handleChange} rows={2} className="mt-1 block w-full py-2 px-3 border border-gray-300 bg-white dark:bg-gray-900 dark:border-gray-700 rounded-md shadow-sm focus:outline-none focus:ring-primary-500 focus:border-primary-500 sm:text-sm" placeholder="BTCUSDT,ETHUSDT"></textarea>
              </div>
            </div>
        </fieldset>

      <fieldset className="border pt-4 px-4 pb-6 rounded-md border-gray-300 dark:border-gray-600">
        <legend className="text-base font-medium text-gray-900 dark:text-gray-100 px-2">Parámetros de ENTRADA</legend>
            <div className="grid grid-cols-1 md:grid-cols-3 gap-6 mt-4"> 
              <div>
            <label htmlFor="rsiPeriod" className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">Periodo RSI</label>
            <input type="number" name="rsiPeriod" id="rsiPeriod" value={formData.rsiPeriod} onChange={handleChange} className="mt-1 block w-full py-2 px-3 border border-gray-300 bg-white dark:bg-gray-900 dark:border-gray-700 rounded-md shadow-sm focus:outline-none focus:ring-primary-500 focus:border-primary-500 sm:text-sm" min="1"/>
          </div>
          <div>
            {renderLabelWithCheckbox("rsiThresholdUp", "RSI Cambio Positivo", "evaluateRsiDelta")}
            <input type="number" name="rsiThresholdUp" id="rsiThresholdUp" value={formData.rsiThresholdUp} onChange={handleChange} step="any" className="mt-1 block w-full py-2 px-3 border border-gray-300 bg-white dark:bg-gray-900 dark:border-gray-700 rounded-md shadow-sm focus:outline-none focus:ring-primary-500 focus:border-primary-500 sm:text-sm"/>
          </div>
          <div>
            {renderLabelWithCheckbox("rsiEntryLevelLow", "RSI Límite Inferior", "evaluateRsiRange")}
            <input type="number" name="rsiEntryLevelLow" id="rsiEntryLevelLow" value={formData.rsiEntryLevelLow} onChange={handleChange} step="any" className="mt-1 block w-full py-2 px-3 border border-gray-300 bg-white dark:bg-gray-900 dark:border-gray-700 rounded-md shadow-sm focus:outline-none focus:ring-primary-500 focus:border-primary-500 sm:text-sm"/>
            <p className="mt-1 text-xs text-gray-500 dark:text-gray-400">Eval. Rango también afecta Límite Superior.</p>
              </div>
              <div>
            <label htmlFor="rsiEntryLevelHigh" className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">RSI Límite Superior</label>
            <input type="number" name="rsiEntryLevelHigh" id="rsiEntryLevelHigh" value={formData.rsiEntryLevelHigh} onChange={handleChange} step="any" className="mt-1 block w-full py-2 px-3 border border-gray-300 bg-white dark:bg-gray-900 dark:border-gray-700 rounded-md shadow-sm focus:outline-none focus:ring-primary-500 focus:border-primary-500 sm:text-sm"/>
              </div>
              <div>
            <label htmlFor="volumeSmaPeriod" className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">Periodo SMA Volumen</label>
            <input type="number" name="volumeSmaPeriod" id="volumeSmaPeriod" value={formData.volumeSmaPeriod} onChange={handleChange} className="mt-1 block w-full py-2 px-3 border border-gray-300 bg-white dark:bg-gray-900 dark:border-gray-700 rounded-md shadow-sm focus:outline-none focus:ring-primary-500 focus:border-primary-500 sm:text-sm" min="0"/>
              </div>
              <div>
            {renderLabelWithCheckbox("volumeFactor", "Factor Volumen", "evaluateVolumeFilter")}
            <input type="number" name="volumeFactor" id="volumeFactor" value={formData.volumeFactor} onChange={handleChange} step="any" className="mt-1 block w-full py-2 px-3 border border-gray-300 bg-white dark:bg-gray-900 dark:border-gray-700 rounded-md shadow-sm focus:outline-none focus:ring-primary-500 focus:border-primary-500 sm:text-sm" min="0"/>
            <p className="mt-1 text-xs text-gray-500 dark:text-gray-400">Eval. Volumen también afecta Periodo SMA.</p>
              </div>
              <div>
            {renderLabelWithCheckbox("downtrendCheckCandles", "Velas Tendencia Bajista", "evaluateDowntrendCandlesBlock")}
            <input type="number" name="downtrendCheckCandles" id="downtrendCheckCandles" value={formData.downtrendCheckCandles} onChange={handleChange} className="mt-1 block w-full py-2 px-3 border border-gray-300 bg-white dark:bg-gray-900 dark:border-gray-700 rounded-md shadow-sm focus:outline-none focus:ring-primary-500 focus:border-primary-500 sm:text-sm" min="0"/>
              </div>
              <div>
            {renderLabelWithCheckbox("downtrendLevelCheck", "Niveles Tendencia Bajista", "evaluateDowntrendLevelsBlock")}
            <input type="number" name="downtrendLevelCheck" id="downtrendLevelCheck" value={formData.downtrendLevelCheck} onChange={handleChange} className="mt-1 block w-full py-2 px-3 border border-gray-300 bg-white dark:bg-gray-900 dark:border-gray-700 rounded-md shadow-sm focus:outline-none focus:ring-primary-500 focus:border-primary-500 sm:text-sm" min="0"/>
              </div>
              <div>
            {renderLabelWithCheckbox("requiredUptrendCandles", "Velas Tendencia Alcista", "evaluateRequiredUptrend")}
            <input type="number" name="requiredUptrendCandles" id="requiredUptrendCandles" value={formData.requiredUptrendCandles} onChange={handleChange} className="mt-1 block w-full py-2 px-3 border border-gray-300 bg-white dark:bg-gray-900 dark:border-gray-700 rounded-md shadow-sm focus:outline-none focus:ring-primary-500 focus:border-primary-500 sm:text-sm" min="0"/>
              </div>
              <div>
                {renderLabelWithCheckbox("evaluateOpenInterestIncrease", "Evaluar Aumento OI", "evaluateOpenInterestIncrease")}
                <p className="mt-1 text-xs text-gray-500 dark:text-gray-400">
                  Si está activado, la entrada requiere que el Open Interest (en USDT) en el intervalo seleccionado sea mayor que el anterior.
                </p>
              </div>
              <div>
                <label htmlFor="openInterestPeriod" className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">
                  Periodo Velas OI
                </label>
                <select 
                  id="openInterestPeriod" 
                  name="openInterestPeriod" 
                  value={formData.openInterestPeriod} 
                  onChange={handleChange} 
                  className="mt-1 block w-full py-2 px-3 border border-gray-300 bg-white dark:bg-gray-900 dark:border-gray-700 rounded-md shadow-sm focus:outline-none focus:ring-primary-500 focus:border-primary-500 sm:text-sm"
                  disabled={!formData.evaluateOpenInterestIncrease}
                >
                  <option value="5m">5 minutos</option>
                  <option value="15m">15 minutos</option>
                  <option value="30m">30 minutos</option>
                  <option value="1h">1 hora</option>
                  <option value="2h">2 horas</option>
                  <option value="4h">4 horas</option>
                  <option value="6h">6 horas</option>
                  <option value="12h">12 horas</option>
                  <option value="1d">1 día</option>
                </select>
                <p className="mt-1 text-xs text-gray-500 dark:text-gray-400">
                  Intervalo para obtener datos de Open Interest. Usado si "Evaluar Aumento OI" está activado.
                </p>
              </div>
            </div>
        </fieldset>

      <fieldset className="border pt-4 px-4 pb-6 rounded-md border-gray-300 dark:border-gray-600">
        <legend className="text-base font-medium text-gray-900 dark:text-gray-100 px-2">Parámetros de SALIDA y Gestión de Riesgo</legend>
        
        <div className="mt-4 pt-4 border-t border-gray-300 dark:border-gray-700">
          <h4 className="text-md font-semibold text-gray-800 dark:text-gray-200 mb-3">Take Profit / Stop Loss Fijos</h4>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
              <div>
              {renderLabelWithCheckbox("takeProfitUSDT", "Take Profit (USDT)", "enableTakeProfitPnl")}
              <input type="number" name="takeProfitUSDT" id="takeProfitUSDT" value={formData.takeProfitUSDT} onChange={handleChange} step="any" className="mt-1 block w-full py-2 px-3 border border-gray-300 bg-white dark:bg-gray-900 dark:border-gray-700 rounded-md shadow-sm focus:outline-none focus:ring-primary-500 focus:border-primary-500 sm:text-sm" min="0"/>
              </div>
              <div>
              {renderLabelWithCheckbox("stopLossUSDT", "Stop Loss (USDT)", "enableStopLossPnl")}
              <input type="number" name="stopLossUSDT" id="stopLossUSDT" value={formData.stopLossUSDT} onChange={handleChange} step="any" className="mt-1 block w-full py-2 px-3 border border-gray-300 bg-white dark:bg-gray-900 dark:border-gray-700 rounded-md shadow-sm focus:outline-none focus:ring-primary-500 focus:border-primary-500 sm:text-sm"/>
            </div>
          </div>
        </div>

        <div className="mt-6 pt-4 border-t border-gray-300 dark:border-gray-700">
          <h4 className="text-md font-semibold text-gray-800 dark:text-gray-200 mb-3">Trailing Stop por RSI</h4>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
            <div>
              <label htmlFor="rsiTarget" className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">RSI Objetivo Activación (Salida)</label>
              <input type="number" name="rsiTarget" id="rsiTarget" value={formData.rsiTarget} onChange={handleChange} step="any" className="mt-1 block w-full py-2 px-3 border border-gray-300 bg-white dark:bg-gray-900 dark:border-gray-700 rounded-md shadow-sm focus:outline-none focus:ring-primary-500 focus:border-primary-500 sm:text-sm"/>
              </div>
              <div>
              {renderLabelWithCheckbox("rsiThresholdDown", "RSI Drop Salida (Negativo)", "enableTrailingRsiStop")}
              <input type="number" name="rsiThresholdDown" id="rsiThresholdDown" value={formData.rsiThresholdDown} onChange={handleChange} step="any" className="mt-1 block w-full py-2 px-3 border border-gray-300 bg-white dark:bg-gray-900 dark:border-gray-700 rounded-md shadow-sm focus:outline-none focus:ring-primary-500 focus:border-primary-500 sm:text-sm"/>
              <p className="mt-1 text-xs text-gray-500 dark:text-gray-400">Eval. Trailing RSI también afecta RSI Objetivo.</p>
            </div>
          </div>
        </div>

        <div className="mt-6 pt-4 border-t border-gray-300 dark:border-gray-700">
          <h4 className="text-md font-semibold text-gray-800 dark:text-gray-200 mb-3">Trailing Stop por Precio</h4>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
            <div>
              {renderLabelWithCheckbox("priceTrailingStopDistanceUSDT", "Distancia Trailing Precio (USDT)", "enablePriceTrailingStop")}
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
              <p className="mt-1 text-xs text-gray-500 dark:text-gray-400">Cuánto debe caer el precio desde su pico para activar el stop (si PnL de activación fue alcanzado).</p>
              </div>
              <div>
              <label htmlFor="priceTrailingStopActivationPnlUSDT" className="block text-sm font-medium text-gray-700 dark:text-gray-300">
                PnL de Activación Trailing Precio (USDT)
                </label>
                <input
                type="number"
                name="priceTrailingStopActivationPnlUSDT"
                id="priceTrailingStopActivationPnlUSDT"
                value={formData.priceTrailingStopActivationPnlUSDT}
                  onChange={handleChange}
                step="any"
                className="mt-1 block w-full py-2 px-3 border border-gray-300 bg-white dark:bg-gray-900 dark:border-gray-700 rounded-md shadow-sm focus:outline-none focus:ring-primary-500 focus:border-primary-500 sm:text-sm"
                min="0"
                />
              <p className="mt-1 text-xs text-gray-500 dark:text-gray-400">El PnL en USDT que la posición debe alcanzar para que este trailing stop se active.</p>
            </div>
          </div>
              </div>

        <div className="mt-6 pt-4 border-t border-gray-300 dark:border-gray-700">
          <h4 className="text-md font-semibold text-gray-800 dark:text-gray-200 mb-3">Trailing Stop por PNL</h4>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
            
            <ConfigItem 
              description="PNL mínimo en USDT que debe alcanzar la posición para armar este trailing stop por PNL."
            >
              {renderLabelWithCheckbox("pnlTrailingStopActivationUSDT", "Activación PNL para Trailing PNL (USDT)", "enablePnlTrailingStop")}
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

            <ConfigItem 
              labelText="Caída de PNL para Salir (USDT)" 
              htmlFor="pnlTrailingStopDropUSDT" 
              description="Si está armado, se sale si el PNL cae esta cantidad en USDT desde el PNL pico alcanzado."
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
        </fieldset>

        <fieldset className="border pt-4 px-4 pb-6 rounded-md border-gray-300 dark:border-gray-600">
        <legend className="text-base font-medium text-gray-900 dark:text-gray-100 px-2">Otros Ajustes</legend>
            <div className="grid grid-cols-1 md:grid-cols-3 gap-6 mt-4">
              <div>
            <label htmlFor="cycleSleepSeconds" className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">Espera Entre Ciclos (seg)</label>
            <input type="number" name="cycleSleepSeconds" id="cycleSleepSeconds" value={formData.cycleSleepSeconds} onChange={handleChange} className="mt-1 block w-full py-2 px-3 border border-gray-300 bg-white dark:bg-gray-900 dark:border-gray-700 rounded-md shadow-sm focus:outline-none focus:ring-primary-500 focus:border-primary-500 sm:text-sm" min="1"/>
              </div>
              <div>
            <label htmlFor="orderTimeoutSeconds" className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">Timeout Órdenes (seg)</label>
            <input type="number" name="orderTimeoutSeconds" id="orderTimeoutSeconds" value={formData.orderTimeoutSeconds} onChange={handleChange} className="mt-1 block w-full py-2 px-3 border border-gray-300 bg-white dark:bg-gray-900 dark:border-gray-700 rounded-md shadow-sm focus:outline-none focus:ring-primary-500 focus:border-primary-500 sm:text-sm" min="0"/>
              </div>
            </div>
        </fieldset>

      <div className="pt-6">
        <button type="submit" disabled={isLoading} className="w-full bg-primary-600 hover:bg-primary-700 text-white font-bold py-2 px-4 rounded-md focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-primary-500 disabled:opacity-50">
          {isLoading ? 'Guardando...' : 'Guardar Configuración'}
          </button>
        {showSuccessMessage && <p className="mt-2 text-sm text-green-600 dark:text-green-400 text-center">¡Configuración guardada exitosamente!</p>}
        {error && <p className="mt-2 text-sm text-red-600 dark:text-red-400 text-center">Error: {error}</p>}
        </div>
      </form>
  );
}

export default ConfigForm; 