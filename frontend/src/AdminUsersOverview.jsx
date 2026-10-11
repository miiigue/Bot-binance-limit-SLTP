import React, { useState, useEffect, useCallback, useMemo } from 'react';
import { useAuth } from './AuthContext';

export default function AdminUsersOverview({ addToast, onSelectUserForDossier }) {
  const { authFetch } = useAuth();
  const [users, setUsers] = useState([]);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState(null);
  const [searchTerm, setSearchTerm] = useState('');
  const [filterBotStatus, setFilterBotStatus] = useState('ALL'); // ALL, RUNNING, PAUSED, NO_KEYS
  const [filterUserStatus, setFilterUserStatus] = useState('ALL'); // ALL, ACTIVE, PENDING, BLOCKED
  const [actionLoading, setActionLoading] = useState({});
  const [lastUpdated, setLastUpdated] = useState(null);

  // Cargar lista de usuarios con datos en tiempo real
  const fetchUsersOverview = useCallback(async () => {
    try {
      setError(null);
      const resp = await authFetch('/api/admin/users_overview');
      if (!resp.ok) {
        throw new Error('Error al consultar la visión general de usuarios.');
      }
      const data = await resp.json();
      setUsers(data.users || []);
      setLastUpdated(data.generated_at || new Date().toLocaleTimeString());
    } catch (err) {
      setError(err.message);
    } finally {
      setIsLoading(false);
    }
  }, [authFetch]);

  useEffect(() => {
    fetchUsersOverview();
    const interval = setInterval(fetchUsersOverview, 10000); // Actualizar cada 10s
    return () => clearInterval(interval);
  }, [fetchUsersOverview]);

  // Alternar encendido/pausa remoto de bot de un usuario
  const handleToggleUserBot = async (userId, currentRunning) => {
    setActionLoading(prev => ({ ...prev, [userId]: true }));
    try {
      const resp = await authFetch('/api/admin/user_bot/toggle', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ user_id: userId, is_running: !currentRunning })
      });
      const data = await resp.json();
      if (!resp.ok) throw new Error(data.message || 'Error al cambiar estado del bot.');
      if (addToast) addToast('✅ Estado del Bot Actualizado', data.message, 'success');
      fetchUsersOverview();
    } catch (err) {
      if (addToast) addToast('Error de Control', err.message, 'error');
    } finally {
      setActionLoading(prev => ({ ...prev, [userId]: false }));
    }
  };

  // Alternar bloqueo/reactivación de cuenta de usuario
  const handleToggleUserAccountStatus = async (userId, currentStatus) => {
    const nextStatus = currentStatus === 'blocked' ? 'active' : 'blocked';
    const actionLabel = nextStatus === 'blocked' ? 'bloquear' : 'reactivar';
    if (!window.confirm(`¿Está seguro de que desea ${actionLabel} la cuenta de este usuario?`)) return;

    setActionLoading(prev => ({ ...prev, [`status_${userId}`]: true }));
    try {
      const resp = await authFetch('/api/admin/toggle_user_status', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ user_id: userId, status: nextStatus })
      });
      const data = await resp.json();
      if (!resp.ok) throw new Error(data.message || 'Error al cambiar estado de usuario.');
      if (addToast) addToast('✅ Estado de Usuario Actualizado', data.message, 'success');
      fetchUsersOverview();
    } catch (err) {
      if (addToast) addToast('Error de Administración', err.message, 'error');
    } finally {
      setActionLoading(prev => ({ ...prev, [`status_${userId}`]: false }));
    }
  };

  // Estadísticas globales agregadas
  const stats = useMemo(() => {
    const total = users.length;
    const runningBots = users.filter(u => u.is_bot_running).length;
    const withKeys = users.filter(u => u.is_api_valid).length;
    const pendingUsers = users.filter(u => u.status === 'pending').length;
    const totalInvested = users.reduce((acc, u) => acc + (u.invested_capital || 0), 0);
    const totalWalletBalance = users.reduce((acc, u) => acc + (u.wallet_balance || 0), 0);
    const totalUnrealizedPnl = users.reduce((acc, u) => acc + (u.unrealized_pnl || 0), 0);
    const totalEquity = totalWalletBalance + totalUnrealizedPnl;

    return {
      total,
      runningBots,
      withKeys,
      pendingUsers,
      totalInvested,
      totalWalletBalance,
      totalUnrealizedPnl,
      totalEquity
    };
  }, [users]);

  // Filtrado de la lista de usuarios
  const filteredUsers = useMemo(() => {
    return users.filter(u => {
      // Búsqueda por texto (nombre, email, cuenta, estrategia)
      const term = searchTerm.toLowerCase().trim();
      const matchSearch = !term || 
        (u.username || '').toLowerCase().includes(term) ||
        (u.email || '').toLowerCase().includes(term) ||
        (u.account_number || '').toLowerCase().includes(term) ||
        (u.strategy_name || '').toLowerCase().includes(term) ||
        (u.country || '').toLowerCase().includes(term);

      // Filtro por Estado de Bot
      let matchBot = true;
      if (filterBotStatus === 'RUNNING') matchBot = u.is_bot_running;
      if (filterBotStatus === 'PAUSED') matchBot = !u.is_bot_running && u.is_api_valid;
      if (filterBotStatus === 'NO_KEYS') matchBot = !u.is_api_valid;

      // Filtro por Estado de Cuenta
      let matchAccount = true;
      if (filterUserStatus === 'ACTIVE') matchAccount = u.status === 'active';
      if (filterUserStatus === 'PENDING') matchAccount = u.status === 'pending';
      if (filterUserStatus === 'BLOCKED') matchAccount = u.status === 'blocked';

      return matchSearch && matchBot && matchAccount;
    });
  }, [users, searchTerm, filterBotStatus, filterUserStatus]);

  if (isLoading && users.length === 0) {
    return (
      <div className="py-16 text-center text-slate-400 text-sm flex flex-col items-center justify-center gap-3">
        <div className="w-10 h-10 border-4 border-amber-400 border-t-transparent rounded-full animate-spin"></div>
        <span>Cargando monitor de usuarios y estado de bots en tiempo real...</span>
      </div>
    );
  }

  return (
    <div className="space-y-6 animate-fadeIn pb-10">
      


      {error && (
        <div className="p-4 bg-rose-500/15 border border-rose-500/30 rounded-2xl text-rose-300 text-xs flex items-center justify-between">
          <span>⚠️ {error}</span>
          <button onClick={fetchUsersOverview} className="underline font-bold hover:text-white">Reintentar</button>
        </div>
      )}

      {/* 2. Tarjetas de Métricas Globales Acumuladas */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
        
        {/* Total Usuarios & Estado */}
        <div className="p-4 bg-slate-900/90 rounded-2xl border border-slate-800 flex flex-col justify-between shadow-lg">
          <div className="flex items-center justify-between">
            <span className="text-[11px] text-slate-400 font-bold uppercase tracking-wider flex items-center gap-1.5">
              <span>👥</span> Usuarios Registrados
            </span>
            {stats.pendingUsers > 0 && (
              <span className="px-2 py-0.5 rounded-full bg-amber-500/20 text-amber-300 border border-amber-500/30 text-[10px] font-bold animate-pulse">
                {stats.pendingUsers} Pendiente{stats.pendingUsers > 1 ? 's' : ''}
              </span>
            )}
          </div>
          <div className="mt-3 flex items-baseline justify-between">
            <span className="text-2xl font-black font-mono text-white">
              {stats.total}
            </span>
            <div className="text-[11px] font-mono text-slate-400 text-right">
              <span className="text-emerald-400 font-bold">{stats.withKeys}</span> con API Keys
            </div>
          </div>
        </div>

        {/* Bots Activos en Vivo */}
        <div className="p-4 bg-slate-900/90 rounded-2xl border border-emerald-500/30 flex flex-col justify-between shadow-lg">
          <div className="flex items-center justify-between">
            <span className="text-[11px] text-emerald-300 font-bold uppercase tracking-wider flex items-center gap-1.5">
              <span>⚡</span> Bots Operando en Vivo
            </span>
            <span className="w-2.5 h-2.5 rounded-full bg-emerald-400 animate-ping"></span>
          </div>
          <div className="mt-3 flex items-baseline justify-between">
            <span className="text-2xl font-black font-mono text-emerald-400">
              {stats.runningBots} <span className="text-xs font-sans text-slate-400 font-normal">/ {stats.total} activos</span>
            </span>
            <span className="text-[10px] text-slate-400 font-mono">
              {stats.total > 0 ? ((stats.runningBots / stats.total) * 100).toFixed(0) : 0}% en línea
            </span>
          </div>
        </div>

        {/* Capital Total Invertido / Asignado */}
        <div className="p-4 bg-slate-900/90 rounded-2xl border border-slate-800 flex flex-col justify-between shadow-lg">
          <div className="flex items-center justify-between">
            <span className="text-[11px] text-slate-400 font-bold uppercase tracking-wider flex items-center gap-1.5">
              <span>💰</span> Capital Invertido
            </span>
            <span className="text-[10px] text-slate-500 font-sans">Pool & Personal</span>
          </div>
          <div className="mt-3">
            <span className="text-2xl font-black font-mono text-sky-400">
              ${stats.totalInvested.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })} <span className="text-xs font-sans text-slate-400 font-normal">USDT</span>
            </span>
          </div>
        </div>

        {/* Patrimonio Total Binance & Flotante Colectivo */}
        <div className="p-4 bg-slate-900/90 rounded-2xl border border-amber-500/30 flex flex-col justify-between shadow-lg">
          <div className="flex items-center justify-between">
            <span className="text-[11px] text-amber-300 font-bold uppercase tracking-wider flex items-center gap-1.5">
              <span>🏦</span> Patrimonio Binance Total
            </span>
            <span className={`text-[10px] font-mono font-bold ${stats.totalUnrealizedPnl >= 0 ? 'text-emerald-400' : 'text-rose-400'}`}>
              Flotante: {stats.totalUnrealizedPnl >= 0 ? '+' : ''}${stats.totalUnrealizedPnl.toFixed(2)}
            </span>
          </div>
          <div className="mt-3">
            <span className="text-2xl font-black font-mono text-amber-300">
              ${stats.totalEquity.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })} <span className="text-xs font-sans text-slate-400 font-normal">USDT</span>
            </span>
          </div>
        </div>
      </div>

      {/* 3. Barra de Búsqueda y Filtros de Usuarios */}
      <div className="bg-slate-900/90 border border-slate-800 rounded-2xl p-4 shadow-md flex flex-col sm:flex-row items-center justify-between gap-3">
        <div className="relative w-full sm:w-80">
          <span className="absolute left-3.5 top-2.5 text-slate-400 text-sm">🔍</span>
          <input
            type="text"
            placeholder="Buscar por usuario, correo, cuenta..."
            value={searchTerm}
            onChange={(e) => setSearchTerm(e.target.value)}
            className="w-full bg-slate-950 border border-slate-800 rounded-xl pl-9 pr-4 py-2 text-xs text-white placeholder-slate-500 focus:outline-none focus:border-amber-400 transition font-sans"
          />
          {searchTerm && (
            <button onClick={() => setSearchTerm('')} className="absolute right-3 top-2.5 text-slate-500 hover:text-white text-xs">✕</button>
          )}
        </div>

        <div className="flex flex-wrap items-center gap-2 w-full sm:w-auto">
          {/* Filtro por Estado de Bot */}
          <select
            value={filterBotStatus}
            onChange={(e) => setFilterBotStatus(e.target.value)}
            className="bg-slate-950 border border-slate-800 text-slate-300 text-xs rounded-xl px-3 py-2 focus:outline-none focus:border-amber-400 font-sans"
          >
            <option value="ALL">🤖 Todos los Bots</option>
            <option value="RUNNING">🟢 Solo Bots Activos</option>
            <option value="PAUSED">⏸️ Solo Bots Pausados</option>
            <option value="NO_KEYS">❌ Sin Claves API</option>
          </select>

          {/* Filtro por Estado de Cuenta */}
          <select
            value={filterUserStatus}
            onChange={(e) => setFilterUserStatus(e.target.value)}
            className="bg-slate-950 border border-slate-800 text-slate-300 text-xs rounded-xl px-3 py-2 focus:outline-none focus:border-amber-400 font-sans"
          >
            <option value="ALL">👤 Todos los Usuarios</option>
            <option value="ACTIVE">🟢 Cuentas Aprobadas</option>
            <option value="PENDING">🟡 Solicitudes Pendientes</option>
            <option value="BLOCKED">🔴 Cuentas Bloqueadas</option>
          </select>
        </div>
      </div>

      {/* 4. Tabla de Usuarios y Monitoreo de Bots */}
      <div className="bg-slate-900/90 border border-slate-800 rounded-3xl p-4 sm:p-6 shadow-xl space-y-4 overflow-hidden">
        <div className="flex items-center justify-between border-b border-slate-800 pb-3">
          <span className="text-xs font-bold text-white uppercase tracking-wider flex items-center gap-2">
            <span>📋</span> Directorio Activo de Usuarios ({filteredUsers.length} encontrados)
          </span>
          <span className="text-[11px] text-slate-500 font-mono">
            Mostrando {filteredUsers.length} de {users.length} usuarios
          </span>
        </div>

        {filteredUsers.length === 0 ? (
          <div className="py-12 text-center text-slate-400 text-xs">
            No se encontraron usuarios que coincidan con los filtros seleccionados.
          </div>
        ) : (
          <div className="overflow-x-auto no-scrollbar">
            <table className="w-full text-left border-collapse font-sans text-xs">
              <thead>
                <tr className="bg-slate-950/80 text-slate-400 uppercase tracking-wider font-bold text-[10px] border-b border-slate-800">
                  <th className="py-3 px-3">Usuario / Cuenta</th>
                  <th className="py-3 px-3">Acceso</th>
                  <th className="py-3 px-3">Estado del Bot</th>
                  <th className="py-3 px-3">Modo & Estrategia</th>
                  <th className="py-3 px-3 text-right">Inversión</th>
                  <th className="py-3 px-3 text-right">Saldo Binance</th>
                  <th className="py-3 px-3 text-right">PnL Flotante</th>
                  <th className="py-3 px-3 text-right">PnL Realizado</th>
                  <th className="py-3 px-3 text-center">Acciones</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-800/60 font-mono">
                {filteredUsers.map((u) => {
                  const isRunning = u.is_bot_running;
                  const isBlocked = u.status === 'blocked';
                  const isPending = u.status === 'pending';

                  return (
                    <tr key={u.id} className="hover:bg-slate-800/40 transition">
                      
                      {/* 1. Usuario / Identificador */}
                      <td className="py-3 px-3 font-sans">
                        <div className="flex flex-col">
                          <div className="flex items-center gap-1.5 font-bold text-white">
                            <span className="font-mono text-amber-300 text-[11px]">{u.account_number}</span>
                            <span>{u.username}</span>
                            {u.role === 'admin' && (
                              <span className="px-1.5 py-0.2 rounded text-[9px] bg-indigo-500/20 text-indigo-300 border border-indigo-500/30 font-bold uppercase">
                                ADMIN
                              </span>
                            )}
                          </div>
                          <span className="text-[10px] text-slate-400 truncate max-w-[180px]">{u.email}</span>
                          {(u.country || u.city) && (
                            <span className="text-[9px] text-slate-500 font-mono mt-0.5">
                              📍 {[u.city, u.country].filter(Boolean).join(', ')}
                            </span>
                          )}
                        </div>
                      </td>

                      {/* 2. Estado de Cuenta */}
                      <td className="py-3 px-3 font-sans">
                        {isPending ? (
                          <span className="px-2 py-0.5 rounded-full bg-amber-500/15 text-amber-300 border border-amber-500/30 text-[10px] font-bold">
                            🟡 Pendiente
                          </span>
                        ) : isBlocked ? (
                          <span className="px-2 py-0.5 rounded-full bg-rose-500/15 text-rose-300 border border-rose-500/30 text-[10px] font-bold">
                            🔴 Bloqueado
                          </span>
                        ) : (
                          <span className="px-2 py-0.5 rounded-full bg-emerald-500/15 text-emerald-300 border border-emerald-500/30 text-[10px] font-bold">
                            🟢 Aprobado
                          </span>
                        )}
                      </td>

                      {/* 3. Estado del Bot */}
                      <td className="py-3 px-3 font-sans">
                        {isRunning ? (
                          <div className="flex items-center gap-1.5">
                            <span className="w-2 h-2 rounded-full bg-emerald-400 animate-ping"></span>
                            <span className="text-emerald-400 font-bold text-[11px]">OPERANDO EN VIVO</span>
                          </div>
                        ) : u.is_api_valid ? (
                          <span className="text-slate-400 font-bold text-[11px]">PAUSADO</span>
                        ) : (
                          <span className="text-rose-400/80 font-semibold text-[10px]">SIN CLAVES API</span>
                        )}
                        <div className="text-[9px] text-slate-500 font-mono mt-0.5">
                          {u.role === 'admin' ? '🏛️ Bot Maestro del Fondo' : (u.is_testnet ? '🧪 Binance Testnet' : (u.is_api_valid ? '⚡ Binance Real' : 'No Conectado'))}
                        </div>
                      </td>

                      {/* 4. Modo & Estrategia */}
                      <td className="py-3 px-3 font-sans">
                        <div className="flex flex-col">
                          <span className="text-amber-300 font-bold text-[11px] truncate max-w-[160px]" title={u.strategy_name}>
                            {u.strategy_name || 'WTN Scalper Pro'}
                          </span>
                          <span className="text-[10px] text-slate-400">
                            {u.role === 'admin' ? 'Bot Maestro (Fondo)' : (u.operating_mode === 'PERSONAL_BOT' ? 'Bot Personal' : 'Copy-Trading Espejo')} • {u.leverage || 10}x
                          </span>
                        </div>
                      </td>

                      {/* 5. Inversión Aportada / Solicitada */}
                      <td className="py-3 px-3 text-right">
                        <div className="flex flex-col items-end">
                          <span className="text-white font-black">
                            ${(u.invested_capital || 0).toFixed(2)}
                          </span>
                          {u.requested_capital > 0 && u.requested_capital !== u.invested_capital && (
                            <span className="text-[9px] text-amber-300 font-sans">
                              Solicitó: ${u.requested_capital.toFixed(2)}
                            </span>
                          )}
                        </div>
                      </td>

                      {/* 6. Saldo Binance */}
                      <td className="py-3 px-3 text-right">
                        <div className="flex flex-col items-end">
                          <span className="text-white font-black">
                            ${(u.wallet_balance || u.balance_detected || 0).toFixed(2)}
                          </span>
                          <span className="text-[9px] text-slate-500 font-sans">
                            Dispon.: ${(u.available_balance || 0).toFixed(2)}
                          </span>
                        </div>
                      </td>

                      {/* 7. PnL Flotante */}
                      <td className="py-3 px-3 text-right">
                        <div className="flex flex-col items-end">
                          <span className={`font-black ${
                            (u.unrealized_pnl || 0) >= 0 ? 'text-emerald-400' : 'text-rose-400'
                          }`}>
                            {(u.unrealized_pnl || 0) >= 0 ? '+' : ''}${(u.unrealized_pnl || 0).toFixed(2)}
                          </span>
                          <span className="text-[9px] text-slate-500 font-sans">
                            {u.open_positions_count || 0} pos. activas
                          </span>
                        </div>
                      </td>

                      {/* 8. PnL Realizado */}
                      <td className="py-3 px-3 text-right">
                        <div className="flex flex-col items-end">
                          <span className={`font-black ${
                            (u.net_pnl || 0) >= 0 ? 'text-emerald-400' : 'text-rose-400'
                          }`}>
                            {(u.net_pnl || 0) >= 0 ? '+' : ''}${(u.net_pnl || 0).toFixed(2)}
                          </span>
                          <span className="text-[9px] text-slate-400 font-sans">
                            WinRate: {u.win_rate || '0.0'}% ({u.total_trades || 0} trades)
                          </span>
                        </div>
                      </td>

                      {/* 9. Acciones del Administrador */}
                      <td className="py-3 px-3 text-center font-sans">
                        <div className="flex items-center justify-center gap-1.5">
                          
                          {/* Encender / Pausar Bot Remoto */}
                          <button
                            type="button"
                            onClick={() => handleToggleUserBot(u.id, isRunning)}
                            disabled={actionLoading[u.id] || !u.is_api_valid}
                            className={`p-1.5 rounded-lg text-xs font-bold transition ${
                              isRunning
                                ? 'bg-rose-950 text-rose-300 border border-rose-700/60 hover:bg-rose-900'
                                : 'bg-emerald-950 text-emerald-300 border border-emerald-700/60 hover:bg-emerald-900'
                            } disabled:opacity-40`}
                            title={isRunning ? 'Pausar bot del usuario' : (u.is_api_valid ? 'Encender bot del usuario' : 'Usuario sin claves API')}
                          >
                            {actionLoading[u.id] ? '⏳' : isRunning ? '⏸️' : '⚡'}
                          </button>

                          {/* Bloquear / Reactivar Cuenta */}
                          <button
                            type="button"
                            onClick={() => handleToggleUserAccountStatus(u.id, u.status)}
                            disabled={actionLoading[`status_${u.id}`] || u.role === 'admin'}
                            className={`p-1.5 rounded-lg text-xs transition ${
                              isBlocked
                                ? 'bg-emerald-950 text-emerald-300 border border-emerald-700/60 hover:bg-emerald-900'
                                : 'bg-slate-800 text-slate-300 hover:text-white border border-slate-700'
                            } disabled:opacity-30`}
                            title={isBlocked ? 'Reactivar cuenta' : 'Bloquear / Suspender usuario'}
                          >
                            {actionLoading[`status_${u.id}`] ? '⏳' : isBlocked ? '🔓' : '🔒'}
                          </button>

                          {/* Ficha Técnica 360° / Dossier */}
                          {onSelectUserForDossier && (
                            <button
                              type="button"
                              onClick={() => onSelectUserForDossier(u.id)}
                              className="p-1.5 bg-indigo-950/80 hover:bg-indigo-900 text-indigo-300 border border-indigo-700/60 rounded-lg text-xs transition"
                              title="Ver Dossier 360° del usuario"
                            >
                              📋
                            </button>
                          )}
                        </div>
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
}
