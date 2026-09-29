import React, { useState, useEffect, useCallback } from 'react';
import { useAuth } from './AuthContext';

export default function UserBotPanel() {
  const { authFetch, user } = useAuth();

  // Estados de datos
  const [botData, setBotData] = useState(null);
  const [tradesData, setTradesData] = useState([]);
  const [metricsData, setMetricsData] = useState(null);
  const [isLoading, setIsLoading] = useState(true);
  const [actionLoading, setActionLoading] = useState(false);
  const [feedback, setFeedback] = useState(null);

  // Estados del Formulario de API Keys
  const [apiKey, setApiKey] = useState('');
  const [apiSecret, setApiSecret] = useState('');
  const [isTestnet, setIsTestnet] = useState(false);
  const [showSecret, setShowSecret] = useState(false);
  const [showApiModal, setShowApiModal] = useState(false);

  // Cargar estado del bot y balance del usuario
  const fetchUserBotStatus = useCallback(async () => {
    try {
      const resp = await authFetch('/api/user/bot');
      if (!resp.ok) return;
      const data = await resp.json();
      setBotData(data);
    } catch (err) {
      console.error("Error al obtener estado de bot de usuario:", err);
    } finally {
      setIsLoading(false);
    }
  }, [authFetch]);

  // Cargar trades personales del usuario
  const fetchUserTrades = useCallback(async () => {
    try {
      const resp = await authFetch('/api/user/trades?limit=30');
      if (!resp.ok) return;
      const data = await resp.json();
      setTradesData(data.trades || []);
      setMetricsData(data.metrics || null);
    } catch (err) {
      console.error("Error al obtener operaciones del usuario:", err);
    }
  }, [authFetch]);

  useEffect(() => {
    fetchUserBotStatus();
    fetchUserTrades();
    const interval = setInterval(() => {
      fetchUserBotStatus();
      fetchUserTrades();
    }, 8000);
    return () => clearInterval(interval);
  }, [fetchUserBotStatus, fetchUserTrades]);

  // Guardar / Conectar API Keys
  const handleSaveApiKeys = async (e) => {
    e.preventDefault();
    const cleanKey = apiKey.replace(/\s+/g, '').replace(/['"]/g, '');
    const cleanSecret = apiSecret.replace(/\s+/g, '').replace(/['"]/g, '');

    if (!cleanKey || !cleanSecret) {
      setFeedback({ type: 'error', text: 'Por favor ingresa tanto tu API Key como tu API Secret de Binance.' });
      return;
    }

    if (cleanKey === cleanSecret) {
      setFeedback({ type: 'error', text: 'El API Key y el Secret Key son idénticos. Asegúrate de copiar cada uno en su campo correspondiente.' });
      return;
    }

    if (cleanKey.includes('BEGIN') || cleanSecret.includes('BEGIN')) {
      setFeedback({ 
        type: 'error', 
        text: 'Detectamos una clave asimétrica RSA/Ed25519. Binance Futures requiere una clave de tipo HMAC ("Generada por el sistema") de 64 caracteres alfanuméricos.' 
      });
      return;
    }

    if (cleanKey.length < 30 || cleanSecret.length < 30) {
      setFeedback({ 
        type: 'error', 
        text: 'La clave ingresada es demasiado corta. Las claves estándar de Binance tienen 64 caracteres. Verifica que no haya quedado incompleta al copiar.' 
      });
      return;
    }

    setActionLoading(true);
    setFeedback(null);

    try {
      const resp = await authFetch('/api/user/keys', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          api_key: cleanKey,
          api_secret: cleanSecret,
          is_testnet: isTestnet
        })
      });

      const resJson = await resp.json();
      if (!resp.ok) {
        throw new Error(resJson.message || 'Error al validar las claves con Binance.');
      }

      setFeedback({ type: 'success', text: resJson.message });
      setApiKey('');
      setApiSecret('');
      setShowApiModal(false);
      fetchUserBotStatus();
    } catch (err) {
      setFeedback({ type: 'error', text: err.message });
    } finally {
      setActionLoading(false);
    }
  };

  // Eliminar API Keys
  const handleDeleteApiKeys = async () => {
    if (!window.confirm("¿Estás seguro de que deseas desconectar tus claves API de Binance? La replicación de trades se detendrá.")) {
      return;
    }

    setActionLoading(true);
    try {
      const resp = await authFetch('/api/user/keys', { method: 'DELETE' });
      const resJson = await resp.json();
      if (resp.ok) {
        setFeedback({ type: 'info', text: 'Claves API desconectadas y eliminadas de forma segura.' });
        fetchUserBotStatus();
      } else {
        throw new Error(resJson.message);
      }
    } catch (err) {
      setFeedback({ type: 'error', text: err.message });
    } finally {
      setActionLoading(false);
    }
  };

  // Activar / Pausar Sincronización Automática
  const handleToggleSync = async () => {
    if (!botData?.has_valid_keys) {
      setFeedback({ type: 'error', text: 'Primero debes conectar tus claves API de Binance para activar la replicación de trades.' });
      setShowApiModal(true);
      return;
    }

    setActionLoading(true);
    setFeedback(null);
    try {
      const resp = await authFetch('/api/user/bot/toggle', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ is_running: !isBotRunning })
      });
      const resJson = await resp.json();
      if (!resp.ok) throw new Error(resJson.message);

      setFeedback({ type: 'success', text: resJson.message });
      fetchUserBotStatus();
    } catch (err) {
      setFeedback({ type: 'error', text: err.message });
    } finally {
      setActionLoading(false);
    }
  };

  const isBotRunning = Boolean(botData?.bot_settings?.is_running);
  const hasKeys = Boolean(botData?.has_valid_keys);
  const balance = Number(botData?.balance_usdt || 0);

  if (isLoading && !botData) {
    return (
      <div className="flex flex-col items-center justify-center p-16 text-slate-400">
        <div className="w-12 h-12 border-4 border-amber-400 border-t-transparent rounded-full animate-spin mb-4"></div>
        <p className="text-sm font-mono font-bold tracking-wide">Cargando tu cuenta personal de Binance...</p>
      </div>
    );
  }

  return (
    <div className="max-w-6xl mx-auto px-4 py-6 space-y-6">

      {/* Banner Superior de Estado Institucional */}
      <div className="relative overflow-hidden bg-gradient-to-r from-slate-900 via-slate-950 to-slate-900 border border-slate-800 rounded-3xl p-6 sm:p-8 shadow-2xl">
        <div className="absolute top-0 right-0 -mt-10 -mr-10 w-64 h-64 bg-amber-500/10 rounded-full blur-3xl pointer-events-none"></div>

        <div className="flex flex-col lg:flex-row lg:items-center justify-between gap-6 relative z-10">
          <div>
            <div className="inline-flex items-center gap-2 px-3 py-1 rounded-full bg-amber-400/10 border border-amber-400/30 text-amber-400 text-xs font-mono font-bold mb-3">
              <span className="w-2 h-2 rounded-full bg-amber-400 animate-pulse"></span>
              MODALIDAD: CUENTA PROPIA BINANCE (COPY-TRADING)
            </div>
            <h1 className="text-2xl sm:text-3xl font-black text-white tracking-tight">
              Mi Cuenta Binance (Fondos Propios)
            </h1>
            <p className="text-slate-400 text-xs sm:text-sm mt-1 max-w-2xl font-mono">
              Mantén el control y custodia total de tus fondos en tu propio Binance. Las compras y ventas del algoritmo institucional gestionado por el Administrador se replican automáticamente en tu cuenta.
            </p>
          </div>

          {/* Tarjeta de Saldo Binance y Replicación */}
          <div className="flex flex-wrap sm:flex-nowrap items-center gap-4 bg-slate-950/80 border border-slate-800/80 rounded-2xl p-4 font-mono shadow-inner">
            <div className="pr-4 border-r border-slate-800">
              <span className="text-[10px] text-slate-500 block uppercase tracking-wider">Tu Balance Binance</span>
              <span className="text-xl font-black text-emerald-400">${balance.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })} <span className="text-xs text-slate-400">USDT</span></span>
            </div>
            <div>
              <span className="text-[10px] text-slate-500 block uppercase tracking-wider">Replicación Algorítmica</span>
              <div className="flex items-center gap-2 mt-0.5">
                <span className={`w-3 h-3 rounded-full ${isBotRunning ? 'bg-emerald-400 animate-ping' : 'bg-slate-600'}`}></span>
                <span className={`text-xs font-black ${isBotRunning ? 'text-emerald-400' : 'text-slate-400'}`}>
                  {isBotRunning ? 'SINCRONIZACIÓN ACTIVA' : 'SINCRONIZACIÓN PAUSADA'}
                </span>
              </div>
            </div>
          </div>
        </div>

        {/* Mensaje de Alerta / Feedback */}
        {feedback && (
          <div className={`mt-4 p-3.5 rounded-xl border text-xs font-mono flex items-center justify-between animate-fadeIn ${
            feedback.type === 'success' ? 'bg-emerald-500/15 border-emerald-500/30 text-emerald-300' :
            feedback.type === 'error' ? 'bg-rose-500/15 border-rose-500/30 text-rose-300' :
            'bg-sky-500/15 border-sky-500/30 text-sky-300'
          }`}>
            <span>{feedback.text}</span>
            <button onClick={() => setFeedback(null)} className="text-slate-400 hover:text-white ml-2 text-sm">✕</button>
          </div>
        )}
      </div>

      {/* Grid: 1. Estado de Conexión API - 2. Control de Replicación */}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-6">

        {/* Tarjeta de Conexión de Claves */}
        <div className="bg-slate-900/90 border border-slate-800 rounded-3xl p-6 shadow-xl space-y-4">
          <div className="flex items-center justify-between">
            <h3 className="text-sm font-black text-white font-mono uppercase tracking-wider flex items-center gap-2">
              <span>🔑</span> Claves API de Binance
            </h3>
            <span className={`px-2.5 py-0.5 rounded-full text-[10px] font-mono font-bold border ${
              hasKeys 
                ? 'bg-emerald-500/15 text-emerald-400 border-emerald-500/30' 
                : 'bg-amber-500/15 text-amber-400 border-amber-500/30'
            }`}>
              {hasKeys ? 'VINCULADO 🟢' : 'SIN VINCULAR ⚪'}
            </span>
          </div>

          {hasKeys ? (
            <div className="space-y-3 font-mono">
              <div className="bg-slate-950 p-3.5 rounded-2xl border border-slate-800 text-xs space-y-2">
                <div className="flex justify-between text-slate-400">
                  <span>API Key:</span>
                  <span className="text-amber-400 font-bold">{botData?.api_key_masked}</span>
                </div>
                <div className="flex justify-between text-slate-400">
                  <span>Entorno:</span>
                  <span className="text-slate-200">{botData?.is_testnet ? 'Testnet (Demo)' : 'Binance Real (Live)'}</span>
                </div>
                <div className="flex justify-between text-slate-400">
                  <span>Seguridad:</span>
                  <span className="text-emerald-400 font-bold">Cifrado AES-256 Activo 🛡️</span>
                </div>
              </div>

              <div className="flex gap-2">
                <button
                  onClick={() => setShowApiModal(true)}
                  className="flex-1 py-2.5 px-3 bg-slate-800 hover:bg-slate-700 text-slate-300 hover:text-white rounded-xl text-xs font-bold font-mono transition"
                >
                  Actualizar Claves
                </button>
                <button
                  onClick={handleDeleteApiKeys}
                  disabled={actionLoading}
                  className="py-2.5 px-3 bg-rose-500/15 hover:bg-rose-500/25 text-rose-400 border border-rose-500/30 rounded-xl text-xs font-bold font-mono transition"
                >
                  Desconectar
                </button>
              </div>
            </div>
          ) : (
            <div className="space-y-3">
              <p className="text-xs text-slate-400 font-mono">
                Conecta tu cuenta de Binance Futures mediante API Keys para que el algoritmo empiece a replicar las compras y ventas en tu exchange.
              </p>
              <button
                onClick={() => setShowApiModal(true)}
                className="w-full py-3 px-4 bg-gradient-to-r from-amber-500 to-amber-600 hover:from-amber-400 hover:to-amber-500 text-slate-950 font-black rounded-xl text-xs font-mono uppercase tracking-wider transition shadow-lg shadow-amber-500/20 active:scale-[0.98]"
              >
                ➕ Vincular mi Cuenta de Binance
              </button>
            </div>
          )}
        </div>

        {/* Tarjeta de Control de Replicación Automática */}
        <div className={`border rounded-3xl p-6 shadow-xl flex flex-col justify-between transition-all duration-300 ${
          isBotRunning 
            ? 'bg-gradient-to-b from-emerald-950/40 via-slate-900 to-slate-950 border-emerald-500/50 shadow-emerald-500/10' 
            : 'bg-slate-900/90 border-slate-800'
        }`}>
          <div>
            <div className="flex items-center justify-between mb-3">
              <h3 className="text-sm font-black text-white font-mono uppercase tracking-wider flex items-center gap-2">
                <span>⚡</span> Control de Sincronización
              </h3>
              <span className="text-[10px] font-mono text-slate-400 bg-slate-950 px-2 py-0.5 rounded border border-slate-800">
                Estrategia Administrador
              </span>
            </div>
            <p className="text-xs text-slate-400 font-mono mb-4">
              {isBotRunning 
                ? '🟢 Tu cuenta está recibiendo las señales del algoritmo institucional en tiempo real.'
                : '⏸️ La replicación está en pausa. Actívala para sincronizar las operaciones del fondo.'}
            </p>
          </div>

          <button
            onClick={handleToggleSync}
            disabled={actionLoading}
            className={`w-full py-3.5 px-6 rounded-2xl font-mono font-black text-xs tracking-wider transition-all shadow-xl flex items-center justify-center gap-2 active:scale-[0.98] ${
              isBotRunning
                ? 'bg-rose-600 hover:bg-rose-500 text-white shadow-rose-600/30'
                : 'bg-gradient-to-r from-emerald-500 to-teal-500 hover:from-emerald-400 hover:to-teal-400 text-slate-950 shadow-emerald-500/25'
            }`}
          >
            {actionLoading ? (
              <div className="w-4 h-4 border-2 border-current border-t-transparent rounded-full animate-spin"></div>
            ) : isBotRunning ? (
              <><span>⏸️</span> PAUSAR REPLICACIÓN DE TRADES</>
            ) : (
              <><span>⚡</span> ACTIVAR REPLICACIÓN AUTOMÁTICA</>
            )}
          </button>
        </div>

      </div>

      {/* Sección 3: Historial y Métricas de Operaciones Replicadas */}
      <div className="bg-slate-900/90 border border-slate-800 rounded-3xl p-6 sm:p-8 shadow-xl space-y-6 font-mono">
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 border-b border-slate-800 pb-4">
          <div>
            <h3 className="text-base font-black text-white uppercase tracking-wider flex items-center gap-2">
              <span>📊</span> Historial de Operaciones Replicadas en tu Binance
            </h3>
            <p className="text-xs text-slate-400 mt-0.5">
              Compras y ventas ejecutadas exclusivamente sobre tu cuenta de Binance Futures por el bot maestro.
            </p>
          </div>
          <button
            onClick={fetchUserTrades}
            className="px-3 py-1.5 bg-slate-800 hover:bg-slate-700 text-slate-300 hover:text-white rounded-xl text-xs font-bold transition self-start sm:self-auto"
          >
            ↻ Actualizar Historial
          </button>
        </div>

        {/* Métricas Personales */}
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-4">
          <div className="bg-slate-950 p-4 rounded-2xl border border-slate-800 text-center">
            <span className="text-[10px] text-slate-500 uppercase block tracking-wider">PnL Neto Generado</span>
            <span className={`text-lg font-black ${(metricsData?.total_pnl || 0) >= 0 ? 'text-emerald-400' : 'text-rose-400'}`}>
              {(metricsData?.total_pnl || 0) >= 0 ? '+' : ''}${(metricsData?.total_pnl || 0).toFixed(2)} USDT
            </span>
          </div>

          <div className="bg-slate-950 p-4 rounded-2xl border border-slate-800 text-center">
            <span className="text-[10px] text-slate-500 uppercase block tracking-wider">Tasa de Acierto (Win Rate)</span>
            <span className="text-lg font-black text-amber-400">
              {(metricsData?.win_rate || 0).toFixed(1)}%
            </span>
          </div>

          <div className="bg-slate-950 p-4 rounded-2xl border border-slate-800 text-center">
            <span className="text-[10px] text-slate-500 uppercase block tracking-wider">Trades Replicados</span>
            <span className="text-lg font-black text-white">
              {metricsData?.total_trades || 0}
            </span>
          </div>

          <div className="bg-slate-950 p-4 rounded-2xl border border-slate-800 text-center">
            <span className="text-[10px] text-slate-500 uppercase block tracking-wider">Profit Factor</span>
            <span className="text-lg font-black text-teal-400">
              {(metricsData?.profit_factor || 1.0).toFixed(2)}
            </span>
          </div>
        </div>

        {/* Tabla de Operaciones Replicadas */}
        <div className="overflow-x-auto rounded-2xl border border-slate-800 bg-slate-950">
          <table className="w-full text-left text-xs">
            <thead className="bg-slate-900/90 text-slate-400 text-[10px] uppercase tracking-wider border-b border-slate-800">
              <tr>
                <th className="p-3">Símbolo</th>
                <th className="p-3">Tipo</th>
                <th className="p-3">Precio Entrada</th>
                <th className="p-3">Precio Salida</th>
                <th className="p-3">Cantidad</th>
                <th className="p-3">PnL Neto</th>
                <th className="p-3">Fecha de Cierre</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-800/60 font-mono">
              {tradesData.length > 0 ? (
                tradesData.map((t) => {
                  const pnl = Number(t.pnl_usdt || 0);
                  const isWin = pnl >= 0;
                  return (
                    <tr key={t.id} className="hover:bg-slate-900/50 transition">
                      <td className="p-3 font-bold text-white">{t.symbol}</td>
                      <td className="p-3">
                        <span className={`px-2 py-0.5 rounded text-[10px] font-bold ${
                          t.trade_type === 'LONG' ? 'bg-emerald-500/15 text-emerald-400' : 'bg-rose-500/15 text-rose-400'
                        }`}>
                          {t.trade_type}
                        </span>
                      </td>
                      <td className="p-3 text-slate-300">${Number(t.open_price).toFixed(2)}</td>
                      <td className="p-3 text-slate-300">{t.close_price ? `$${Number(t.close_price).toFixed(2)}` : 'Abierta'}</td>
                      <td className="p-3 text-slate-400">{t.quantity}</td>
                      <td className={`p-3 font-bold ${isWin ? 'text-emerald-400' : 'text-rose-400'}`}>
                        {t.close_timestamp ? `${isWin ? '+' : ''}$${pnl.toFixed(4)} USDT` : 'En curso'}
                      </td>
                      <td className="p-3 text-slate-500 text-[11px] whitespace-nowrap">
                        {t.close_timestamp || t.open_timestamp}
                      </td>
                    </tr>
                  );
                })
              ) : (
                <tr>
                  <td colSpan={7} className="p-8 text-center text-slate-500 text-xs">
                    No hay operaciones cerradas aún. Cuando el algoritmo central abra y cierre posiciones, quedarán registradas aquí en tiempo real.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </div>

      {/* Modal de Conexión de Claves API de Binance */}
      {showApiModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-950/80 backdrop-blur-md animate-fadeIn">
          <div className="bg-slate-900 border border-slate-800 rounded-3xl max-w-lg w-full p-6 sm:p-8 shadow-2xl space-y-6 font-mono relative">
            <button
              onClick={() => setShowApiModal(false)}
              className="absolute top-5 right-5 text-slate-400 hover:text-white text-lg font-bold"
            >
              ✕
            </button>

            <div>
              <div className="w-10 h-10 rounded-2xl bg-amber-400/10 border border-amber-400/30 flex items-center justify-center text-xl mb-3">
                🔑
              </div>
              <h3 className="text-xl font-black text-white tracking-tight">
                Vincular Cuenta de Binance Futures
              </h3>
              <p className="text-xs text-slate-400 mt-1">
                Tus credenciales se cifran con grado militar (AES-256-GCM). Solo se usarán para enviar las órdenes de trading a tu exchange.
              </p>
            </div>

            {/* Banner de Advertencia de Retiros */}
            <div className="p-3.5 bg-amber-500/10 border border-amber-500/25 rounded-2xl text-[11px] text-amber-300 space-y-1">
              <strong className="block font-bold text-amber-200">🛡️ Regla de Oro de Seguridad:</strong>
              <span>
                En Binance, al crear tu API Key, <strong>NUNCA habilites la casilla "Retiros" (Enable Withdrawals)</strong>. El bot únicamente necesita permisos de <strong>Lectura (Reading)</strong> y <strong>Trading de Futuros (Enable Futures)</strong>. De este modo, nadie puede extraer fondos de tu cuenta.
              </span>
            </div>

            <form onSubmit={handleSaveApiKeys} className="space-y-4">
              <div>
                <label className="text-xs font-bold text-slate-300 block mb-1">
                  Binance API Key:
                </label>
                <input
                  type="text"
                  required
                  value={apiKey}
                  onChange={(e) => setApiKey(e.target.value)}
                  placeholder="Pega aquí tu API Key de Binance..."
                  className="w-full bg-slate-950 border border-slate-700 rounded-xl px-3.5 py-2.5 text-xs text-white placeholder-slate-600 focus:border-amber-400 focus:outline-none"
                />
              </div>

              <div>
                <div className="flex justify-between items-center mb-1">
                  <label className="text-xs font-bold text-slate-300">
                    Binance Secret Key:
                  </label>
                  <button
                    type="button"
                    onClick={() => setShowSecret(!showSecret)}
                    className="text-[10px] text-slate-400 hover:text-white"
                  >
                    {showSecret ? 'Ocultar' : 'Mostrar'}
                  </button>
                </div>
                <input
                  type={showSecret ? "text" : "password"}
                  required
                  value={apiSecret}
                  onChange={(e) => setApiSecret(e.target.value)}
                  placeholder="Pega aquí tu Secret Key..."
                  className="w-full bg-slate-950 border border-slate-700 rounded-xl px-3.5 py-2.5 text-xs text-white placeholder-slate-600 focus:border-amber-400 focus:outline-none"
                />
              </div>

              <div className="p-3.5 bg-slate-950 rounded-2xl border border-slate-800 space-y-2.5">
                <div className="flex items-center justify-between">
                  <span className="text-xs text-slate-300 font-bold flex items-center gap-1.5">
                    <span>🌐</span> ¿Dónde creaste tu API Key?
                  </span>
                  <span className="text-[10px] text-amber-400 font-mono font-bold">
                    {isTestnet ? 'MODO DEMO / TESTNET' : 'MODO FONDOS REALES'}
                  </span>
                </div>
                <div className="grid grid-cols-2 gap-2">
                  <button
                    type="button"
                    onClick={() => setIsTestnet(false)}
                    className={`py-2 px-3 rounded-xl text-xs font-bold border transition text-center flex flex-col items-center justify-center gap-0.5 ${
                      !isTestnet 
                        ? 'bg-amber-400 text-slate-950 border-amber-400 font-black shadow-lg shadow-amber-400/20' 
                        : 'bg-slate-900 text-slate-400 border-slate-800 hover:text-white'
                    }`}
                  >
                    <span>🟡 Binance Real (Mainnet)</span>
                    <span className="text-[9px] opacity-80 font-normal">www.binance.com</span>
                  </button>
                  <button
                    type="button"
                    onClick={() => setIsTestnet(true)}
                    className={`py-2 px-3 rounded-xl text-xs font-bold border transition text-center flex flex-col items-center justify-center gap-0.5 ${
                      isTestnet 
                        ? 'bg-amber-400 text-slate-950 border-amber-400 font-black shadow-lg shadow-amber-400/20' 
                        : 'bg-slate-900 text-slate-400 border-slate-800 hover:text-white'
                    }`}
                  >
                    <span>🧪 Testnet (Simulación)</span>
                    <span className="text-[9px] opacity-80 font-normal">testnet.binancefuture.com</span>
                  </button>
                </div>
                <p className="text-[10px] text-slate-400 leading-relaxed">
                  {isTestnet 
                    ? '⚠️ Asegúrate de que las credenciales provengan de testnet.binancefuture.com (o Mock Trading).' 
                    : 'ℹ️ Las credenciales deben ser creadas en tu cuenta real de Binance con permiso "Enable Futures" (Habilitar Futuros).'}
                </p>
              </div>

              <div className="flex gap-3 pt-2">
                <button
                  type="button"
                  onClick={() => setShowApiModal(false)}
                  className="flex-1 py-3 px-4 bg-slate-800 hover:bg-slate-700 text-slate-300 font-bold rounded-xl text-xs transition"
                >
                  Cancelar
                </button>
                <button
                  type="submit"
                  disabled={actionLoading}
                  className="flex-1 py-3 px-4 bg-gradient-to-r from-amber-500 to-amber-600 hover:from-amber-400 hover:to-amber-500 text-slate-950 font-black rounded-xl text-xs uppercase tracking-wider transition shadow-lg shadow-amber-500/25 flex items-center justify-center gap-2"
                >
                  {actionLoading ? (
                    <div className="w-4 h-4 border-2 border-slate-950 border-t-transparent rounded-full animate-spin"></div>
                  ) : (
                    'Verificar y Guardar'
                  )}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

    </div>
  );
}
