import React, { useState, useEffect } from 'react';

const RiskDisplay = () => {
  const [riskData, setRiskData] = useState(null);
  const [error, setError] = useState('');

  useEffect(() => {
    const fetchData = async () => {
      try {
        const response = await fetch('/api/risk_config');
        if (response.ok) {
          const data = await response.json();
          setRiskData(data);
          setError('');
        } else {
          setError('No se pudo cargar la información de riesgo.');
        }
      } catch (err) {
        setError('Error de conexión con el servidor de riesgo.');
      }
    };

    fetchData();
    const intervalId = setInterval(fetchData, 5000); // Actualizar cada 5 segundos

    return () => clearInterval(intervalId);
  }, []);

  if (error) {
    return (
      <div className="bg-red-900 text-white p-4 rounded-lg shadow-md">
        <p>{error}</p>
      </div>
    );
  }

  if (!riskData) {
    return (
      <div className="bg-gray-800 text-white p-4 rounded-lg shadow-md">
        <p>Cargando información de riesgo...</p>
      </div>
    );
  }

  const { total_balance, max_exposure, current_exposure, risk_percentage } = riskData;
  const currentExpNum = parseFloat(current_exposure);
  const maxExpNum = parseFloat(max_exposure);
  const progressPercentage = maxExpNum > 0 ? (currentExpNum / maxExpNum) * 100 : 0;
  
  // Limitar el ancho visual de la barra al 100% para evitar desbordamiento
  const cappedProgressPercentage = Math.min(progressPercentage, 100);

  // Determinar el color de la barra de progreso
  let progressBarColor = 'bg-green-500';
  if (progressPercentage > 75) {
    progressBarColor = 'bg-red-500';
  } else if (progressPercentage > 50) {
    progressBarColor = 'bg-yellow-500';
  }

  return (
    <div className="bg-gray-800 p-4 rounded-lg shadow-md text-white">
      <h2 className="text-xl font-bold mb-4">Monitor de Riesgo Global</h2>
      <div className="grid grid-cols-1 md:grid-cols-3 gap-4 text-center">
        <div>
          <p className="text-sm text-gray-400">Balance Total</p>
          <p className="text-2xl font-semibold">{total_balance} USDT</p>
        </div>
        <div>
          <p className="text-sm text-gray-400">Exposición Máxima ({risk_percentage})</p>
          <p className="text-2xl font-semibold">{max_exposure} USDT</p>
        </div>
        <div>
          <p className="text-sm text-gray-400">Exposición Actual</p>
          <p className="text-2xl font-semibold">{current_exposure} USDT</p>
        </div>
      </div>
      <div className="mt-4">
        <p className="text-sm text-gray-400 mb-1">Uso de Exposición</p>
        <div className="w-full bg-gray-700 rounded-full h-4">
          <div
            className={`h-4 rounded-full ${progressBarColor}`}
            style={{ width: `${cappedProgressPercentage}%` }}
          ></div>
        </div>
      </div>
    </div>
  );
};

export default RiskDisplay;
