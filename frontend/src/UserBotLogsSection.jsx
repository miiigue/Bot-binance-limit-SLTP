import React, { useState, useEffect, useCallback, useRef } from 'react';

export default function UserBotLogsSection({ targetUserId, username, authFetch }) {
  const [logs, setLogs] = useState([]);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState(null);
  const [autoRefresh, setAutoRefresh] = useState(true);
  const [levelFilter, setLevelFilter] = useState('ALL');
  const [searchTerm, setSearchTerm] = useState('');
  const [isCopied, setIsCopied] = useState(false);
  const [botMetadata, setBotMetadata] = useState(null);
  const [isCollapsed, setIsCollapsed] = useState(false);
  const scrollRef = useRef(null);

  const fetchLogs = useCallback(async (isManual = false) => {
    if (!targetUserId) return;
    if (isManual) setIsLoading(true);
    try {
      setError(null);
      const url = `/api/admin/users/${targetUserId}/logs?limit=300${levelFilter !== 'ALL' ? `&level=${levelFilter}` : ''}${searchTerm ? `&search=${encodeURIComponent(searchTerm)}` : ''}`;
      const resp = await authFetch(url);
      if (!resp.ok) {
        if (resp.status === 403) {
          throw new Error('Acceso restringido: Solo el Administrador puede auditar los logs de usuarios.');
        }
        throw new Error(`Error ${resp.status} al cargar logs del bot.`);
      }
      const data = await resp.json();
      setLogs(data.logs || []);
      setBotMetadata({
        operating_mode: data.operating_mode,
        is_running: data.is_running,
        strategy_name: data.strategy_name,
        count: data.count
      });
    } catch (err) {
      setError(err.message || 'Error consultando logs.');
    } finally {
      setIsLoading(false);
    }
  }, [targetUserId, authFetch, levelFilter, searchTerm]);

  // Carga inicial y refresco al cambiar filtros
  useEffect(() => {
    fetchLogs(true);
  }, [fetchLogs]);

  // Temporizador de auto-refresco cada 5 segundos
  useEffect(() => {
    if (!autoRefresh) return;
    const interval = setInterval(() => {
      fetchLogs(false);
    }, 5000);
    return () => clearInterval(interval);
  }, [autoRefresh, fetchLogs]);

  const handleCopyLogs = () => {
    if (logs.length === 0) return;
    const textToCopy = logs.map(l => `${l.timestamp || ''} [${l.level || 'INFO'}] ${l.message || l.raw}`).join('\n');
    navigator.clipboard.writeText(textToCopy);
    setIsCopied(true);
    setTimeout(() => setIsCopied(false), 2000);
  };

  const getLevelBadgeClass = (lvl) => {
    switch (lvl) {
      case 'ERROR':
      case 'CRITICAL':
        return 'bg-rose-500/20 text-rose-300 border-rose-500/40';
      case 'WARNING':
        return 'bg-amber-500/20 text-amber-300 border-amber-500/40';
      default:
        return 'bg-emerald-500/20 text-emerald-300 border-emerald-500/40';
    }
  };

  return (
    <div id="admin-user-bot-logs" className="bg-slate-900/95 border border-amber-500/30 rounded-3xl p-6 sm:p-8 shadow-2xl space-y-5 animate-fadeIn">
      {/* Cabecera de la Sección */}
      <div className="flex flex-col lg:flex-row lg:items-center justify-between gap-4 border-b border-slate-800 pb-5">
        <div className="space-y-1">
          <div className="flex items-center gap-2 flex-wrap">
            <span className="text-xl">📋</span>
            <h3 className="text-base sm:text-lg font-black text-white uppercase tracking-wider">
              Auditoría y Logs del Bot
            </h3>
            <span className="px-2.5 py-0.5 rounded-full text-[10px] font-black uppercase tracking-wider bg-amber-500/20 text-amber-300 border border-amber-500/40 flex items-center gap-1 shadow-sm">
              <span>🔒</span> Solo Administrador
            </span>
            <span className="text-sm font-mono font-bold text-amber-300">
              @{username || `Usuario #${targetUserId}`}
            </span>
          </div>
          <p className="text-xs text-slate-400 leading-relaxed">
            Flujo en vivo de decisiones: disparadores de resguardo (Smart Hedge), pausas anti-rebote, órdenes en Binance y alertas del bot de este usuario.
          </p>
        </div>

        {/* Badges de Estado del Bot */}
        <div className="flex items-center gap-2 flex-wrap self-start lg:self-auto">
          {botMetadata && (
            <>
              <span className={`px-2.5 py-1 rounded-xl text-xs font-bold border flex items-center gap-1.5 ${
                botMetadata.is_running 
                  ? 'bg-emerald-500/10 text-emerald-300 border-emerald-500/30' 
                  : 'bg-slate-800 text-slate-400 border-slate-700'
              }`}>
                <span className={`w-2 h-2 rounded-full ${botMetadata.is_running ? 'bg-emerald-400 animate-ping' : 'bg-slate-500'}`}></span>
                {botMetadata.is_running ? 'BOT ACTIVO' : 'BOT PAUSADO'}
              </span>

              <span className="px-2.5 py-1 rounded-xl text-xs font-mono font-bold bg-slate-950 text-slate-300 border border-slate-800">
                {botMetadata.operating_mode === 'COPY_TRADING' ? '👥 Copy-Trading' : '🤖 Bot Personal'}
              </span>

              {botMetadata.strategy_name && (
                <span className="px-2.5 py-1 rounded-xl text-xs font-mono text-cyan-300 bg-cyan-950/40 border border-cyan-800/50 max-w-[200px] truncate" title={botMetadata.strategy_name}>
                  🎯 {botMetadata.strategy_name}
                </span>
              )}
            </>
          )}

          <button
            type="button"
            onClick={() => setIsCollapsed(!isCollapsed)}
            className="p-1.5 rounded-xl bg-slate-800 hover:bg-slate-700 text-slate-300 hover:text-white transition text-xs font-bold"
            title={isCollapsed ? 'Expandir consola' : 'Plegar consola'}
          >
            {isCollapsed ? '🔽 Desplegar' : '🔼 Plegar'}
          </button>
        </div>
      </div>

      {!isCollapsed && (
        <>
          {/* Barra de Herramientas y Filtros */}
          <div className="flex flex-col md:flex-row items-stretch md:items-center justify-between gap-3 bg-slate-950/70 p-3.5 rounded-2xl border border-slate-800 text-xs">
            {/* Buscador */}
            <div className="flex-1 relative">
              <input
                type="text"
                placeholder="🔍 Filtrar logs (ej: ETH, resguardo, rebote, SL, TP, saldo)..."
                value={searchTerm}
                onChange={(e) => setSearchTerm(e.target.value)}
                className="w-full bg-slate-900 border border-slate-800 rounded-xl px-3.5 py-2 text-white placeholder-slate-500 text-xs font-mono focus:outline-none focus:border-amber-400 transition"
              />
              {searchTerm && (
                <button
                  type="button"
                  onClick={() => setSearchTerm('')}
                  className="absolute right-2.5 top-1/2 -translate-y-1/2 text-slate-500 hover:text-slate-300 font-bold"
                >
                  ✕
                </button>
              )}
            </div>

            {/* Selector de Nivel */}
            <div className="flex items-center gap-2 flex-wrap sm:flex-nowrap">
              <select
                value={levelFilter}
                onChange={(e) => setLevelFilter(e.target.value)}
                className="bg-slate-900 border border-slate-800 text-slate-300 text-xs font-mono rounded-xl px-3 py-2 focus:outline-none focus:border-amber-400"
              >
                <option value="ALL">Todos los Niveles</option>
                <option value="INFO">Solo INFO</option>
                <option value="WARNING">Solo WARNING</option>
                <option value="ERROR">Solo ERROR</option>
              </select>

              {/* Botón Auto-Refresco */}
              <button
                type="button"
                onClick={() => setAutoRefresh(!autoRefresh)}
                className={`px-3 py-2 rounded-xl font-bold flex items-center gap-1.5 transition border ${
                  autoRefresh 
                    ? 'bg-emerald-500/10 text-emerald-400 border-emerald-500/30 hover:bg-emerald-500/20' 
                    : 'bg-slate-800 text-slate-400 border-slate-700 hover:bg-slate-700'
                }`}
                title={autoRefresh ? 'Pausar auto-refresco cada 5s' : 'Activar auto-refresco cada 5s'}
              >
                <span className={`w-2 h-2 rounded-full ${autoRefresh ? 'bg-emerald-400 animate-pulse' : 'bg-slate-500'}`}></span>
                <span>Auto-5s</span>
              </button>

              {/* Botón Refrescar Manual */}
              <button
                type="button"
                onClick={() => fetchLogs(true)}
                disabled={isLoading}
                className="px-3 py-2 bg-slate-800 hover:bg-slate-700 text-slate-200 border border-slate-700 rounded-xl font-bold transition flex items-center gap-1 active:scale-95 disabled:opacity-50"
                title="Actualizar logs ahora"
              >
                <span className={isLoading ? 'animate-spin' : ''}>🔄</span>
                <span>Refrescar</span>
              </button>

              {/* Botón Copiar */}
              <button
                type="button"
                onClick={handleCopyLogs}
                disabled={logs.length === 0}
                className="px-3 py-2 bg-amber-500/15 hover:bg-amber-500/25 text-amber-300 border border-amber-500/40 rounded-xl font-bold transition flex items-center gap-1 active:scale-95 disabled:opacity-50"
                title="Copiar texto de logs"
              >
                <span>{isCopied ? '✅' : '📋'}</span>
                <span>{isCopied ? '¡Copiado!' : 'Copiar'}</span>
              </button>
            </div>
          </div>

          {/* Estado de Error si ocurre */}
          {error && (
            <div className="p-4 rounded-2xl bg-rose-950/40 border border-rose-500/30 text-rose-300 text-xs flex items-center gap-2">
              <span>⚠️</span>
              <span>{error}</span>
            </div>
          )}

          {/* Consola Terminal de Logs */}
          <div className="bg-slate-950 rounded-2xl border border-slate-800 shadow-inner overflow-hidden">
            {/* Barra de Título de la Consola Terminal */}
            <div className="bg-slate-900/90 border-b border-slate-800 px-4 py-2.5 flex items-center justify-between text-xs text-slate-400 font-mono">
              <div className="flex items-center gap-2">
                <div className="flex items-center gap-1.5">
                  <span className="w-2.5 h-2.5 rounded-full bg-rose-500/80"></span>
                  <span className="w-2.5 h-2.5 rounded-full bg-amber-500/80"></span>
                  <span className="w-2.5 h-2.5 rounded-full bg-emerald-500/80"></span>
                </div>
                <span className="text-[11px] text-slate-400 ml-2">
                  bot-engine@{username || 'user'}:~# activity.log
                </span>
              </div>
              <span className="text-[11px] text-slate-500">
                {logs.length} {logs.length === 1 ? 'evento registrado' : 'eventos registrados'}
              </span>
            </div>

            {/* Cuerpo del Log */}
            <div 
              ref={scrollRef}
              className="p-4 max-h-[500px] overflow-y-auto space-y-1.5 font-mono text-xs leading-relaxed select-text"
            >
              {isLoading && logs.length === 0 ? (
                <div className="py-12 text-center text-slate-500 flex flex-col items-center gap-2">
                  <div className="w-6 h-6 border-2 border-amber-400 border-t-transparent rounded-full animate-spin"></div>
                  <span>Cargando registros de actividad del bot de {username}...</span>
                </div>
              ) : logs.length === 0 ? (
                <div className="py-12 text-center text-slate-500 space-y-2">
                  <p className="text-sm">📭 No se encontraron registros para los filtros seleccionados.</p>
                  <p className="text-[11px] text-slate-600">
                    Las actividades del bot (entradas, coberturas, anti-rebote, órdenes, advertencias) aparecerán aquí automáticamente en cuanto el bot ejecute sus ciclos.
                  </p>
                </div>
              ) : (
                logs.map((logItem, idx) => {
                  const msg = logItem.message || logItem.raw;
                  const isHedge = msg.includes('Resguardo') || msg.includes('Cobertura') || msg.includes('Hedge') || msg.includes('🛡️');
                  const isGhost = msg.includes('fantasma') || msg.includes('👻') || msg.includes('-2022');
                  const isBounce = msg.includes('rebote') || msg.includes('pausada');
                  const isTradeClose = msg.includes('POSICIÓN CERRADA') || msg.includes('CERRADA') || msg.includes('🛑');
                  const isTradeOpen = msg.includes('ORDEN ENTRADA') || msg.includes('EJECUTADA') || msg.includes('🚀');

                  let highlightBg = 'hover:bg-slate-900/60';
                  if (isHedge) highlightBg = 'bg-cyan-950/20 border-l-2 border-cyan-400 hover:bg-cyan-950/30';
                  else if (isGhost) highlightBg = 'bg-amber-950/20 border-l-2 border-amber-400 hover:bg-amber-950/30';
                  else if (isBounce) highlightBg = 'bg-indigo-950/20 border-l-2 border-indigo-400 hover:bg-indigo-950/30';
                  else if (isTradeClose) highlightBg = 'bg-emerald-950/15 border-l-2 border-emerald-400 hover:bg-emerald-950/25';

                  return (
                    <div 
                      key={idx}
                      className={`p-2 rounded-lg transition-colors flex items-start gap-2.5 ${highlightBg}`}
                    >
                      {/* Timestamp */}
                      {logItem.timestamp && (
                        <span className="text-[11px] text-slate-500 whitespace-nowrap pt-0.5 select-none">
                          {logItem.timestamp.includes(' ') ? logItem.timestamp.split(' ')[1] : logItem.timestamp}
                        </span>
                      )}

                      {/* Badge de Nivel */}
                      <span className={`px-1.5 py-0.2 rounded text-[10px] font-bold border whitespace-nowrap select-none ${getLevelBadgeClass(logItem.level)}`}>
                        {logItem.level || 'INFO'}
                      </span>

                      {/* Mensaje */}
                      <span className="text-slate-200 break-words flex-1 leading-snug">
                        {msg}
                      </span>
                    </div>
                  );
                })
              )}
            </div>
          </div>
        </>
      )}
    </div>
  );
}
