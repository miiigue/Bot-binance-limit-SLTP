import React, { useState, useEffect, useCallback } from 'react';
import { useAuth } from './AuthContext';

export default function AdminInvestors({ addToast }) {
  const { authFetch } = useAuth();
  const [data, setData] = useState({ investors: [], pending_users: [], pool_stats: {} });
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState(null);

  // Estados de aprobación
  const [approvalInputs, setApprovalInputs] = useState({}); // { [userId]: capitalAmount }
  const [isProcessingApproval, setIsProcessingApproval] = useState({});

  // Estados de modal de movimiento de capital
  const [selectedUserForCapital, setSelectedUserForCapital] = useState(null);
  const [txType, setTxType] = useState('DEPOSIT');
  const [txAmount, setTxAmount] = useState('');
  const [txNotes, setTxNotes] = useState('');
  const [isSavingCapital, setIsSavingCapital] = useState(false);

  // Estado de descarga de backup
  const [isDownloadingBackup, setIsDownloadingBackup] = useState(false);

  const fetchInvestorsData = useCallback(async () => {
    try {
      setError(null);
      const resp = await authFetch('/api/admin/investors');
      if (!resp.ok) {
        throw new Error('Error al cargar información de inversionistas.');
      }
      const res = await resp.json();
      setData(res.data || { investors: [], pending_users: [], pool_stats: {} });
    } catch (err) {
      setError(err.message);
    } finally {
      setIsLoading(false);
    }
  }, [authFetch]);

  useEffect(() => {
    fetchInvestorsData();
    const interval = setInterval(fetchInvestorsData, 15000);
    return () => clearInterval(interval);
  }, [fetchInvestorsData]);

  // Manejar cambio de input de capital inicial para un usuario pendiente
  const handleCapitalInputChange = (userId, value) => {
    setApprovalInputs(prev => ({ ...prev, [userId]: value }));
  };

  // Aprobar usuario
  const handleApprove = async (userId) => {
    const capital = parseFloat(approvalInputs[userId] || 0);
    setIsProcessingApproval(prev => ({ ...prev, [userId]: true }));

    try {
      const resp = await authFetch('/api/admin/approve_user', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ user_id: userId, initial_capital: capital })
      });

      const res = await resp.json();
      if (!resp.ok) {
        throw new Error(res.message || 'Error al aprobar usuario.');
      }

      if (addToast) addToast('✅ Inversionista Aprobado', `Cuenta aprobada con $${capital.toFixed(2)} USDT asignados.`, 'success');
      fetchInvestorsData();
    } catch (err) {
      if (addToast) addToast('Error de Aprobación', err.message, 'error');
      else alert(err.message);
    } finally {
      setIsProcessingApproval(prev => ({ ...prev, [userId]: false }));
    }
  };

  // Rechazar usuario
  const handleReject = async (userId) => {
    if (!window.confirm('¿Estás seguro de que deseas rechazar esta solicitud de registro?')) return;
    setIsProcessingApproval(prev => ({ ...prev, [userId]: true }));

    try {
      const resp = await authFetch('/api/admin/reject_user', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ user_id: userId })
      });

      const res = await resp.json();
      if (!resp.ok) throw new Error(res.message || 'Error al rechazar.');

      if (addToast) addToast('Solicitud Rechazada', 'El usuario ha sido rechazado.', 'info');
      fetchInvestorsData();
    } catch (err) {
      if (addToast) addToast('Error', err.message, 'error');
      else alert(err.message);
    } finally {
      setIsProcessingApproval(prev => ({ ...prev, [userId]: false }));
    }
  };

  // Guardar movimiento de capital (Depósito o Retiro)
  const handleSaveCapitalMovement = async (e) => {
    e.preventDefault();
    if (!selectedUserForCapital || !txAmount || parseFloat(txAmount) <= 0) {
      alert('Por favor ingresa un monto válido mayor que 0.');
      return;
    }

    setIsSavingCapital(true);
    try {
      const resp = await authFetch('/api/admin/modify_capital', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          user_id: selectedUserForCapital.id,
          amount: parseFloat(txAmount),
          type: txType,
          notes: txNotes.trim()
        })
      });

      const res = await resp.json();
      if (!resp.ok) throw new Error(res.message || 'Error al registrar movimiento.');

      if (addToast) {
        addToast('Movimiento Registrado', `${txType === 'DEPOSIT' ? 'Depósito' : 'Retiro'} de $${parseFloat(txAmount).toFixed(2)} USDT guardado.`, 'success');
      }

      setSelectedUserForCapital(null);
      setTxAmount('');
      setTxNotes('');
      fetchInvestorsData();
    } catch (err) {
      alert(err.message);
    } finally {
      setIsSavingCapital(false);
    }
  };

  // Descargar Copia de Seguridad (.db)
  const handleDownloadBackup = async () => {
    setIsDownloadingBackup(true);
    try {
      const resp = await authFetch('/api/admin/backup_db');
      if (!resp.ok) {
        throw new Error('Error al descargar la base de datos.');
      }

      const blob = await resp.blob();
      const disposition = resp.headers.get('Content-Disposition');
      let filename = `backup_binance_bot_${new Date().toISOString().replace(/[:.]/g, '-')}.db`;
      if (disposition && disposition.indexOf('filename=') !== -1) {
        const matches = /filename[^;=\n]*=((['"]).*?\2|[^;\n]*)/.exec(disposition);
        if (matches != null && matches[1]) {
          filename = matches[1].replace(/['"]/g, '');
        }
      }

      const url = window.URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = filename;
      document.body.appendChild(a);
      a.click();
      window.URL.revokeObjectURL(url);
      document.body.removeChild(a);

      if (addToast) addToast('💾 Backup Descargado', `Base de datos ${filename} guardada con éxito.`, 'success');
    } catch (err) {
      alert(`Error al generar copia de seguridad: ${err.message}`);
    } finally {
      setIsDownloadingBackup(false);
    }
  };

  const pool = data.pool_stats || {};
  const investors = data.investors || [];
  const pending = data.pending_users || [];
  const isProfit = (pool.total_pool_pnl || 0) >= 0;

  return (
    <div className="space-y-6 max-w-7xl mx-auto">
      
      {/* Encabezado Principal */}
      <div className="bg-slate-900 border border-slate-800 rounded-3xl p-5 sm:p-6 shadow-xl flex flex-col md:flex-row items-start md:items-center justify-between gap-4">
        <div>
          <div className="flex items-center gap-2 mb-1">
            <span className="text-2xl">👥</span>
            <h2 className="text-xl sm:text-2xl font-black text-white">
              Gestión de Inversionistas & Pool de Capital
            </h2>
            <span className="px-2.5 py-0.5 rounded-full text-[11px] font-extrabold bg-amber-400 text-slate-950 shadow">
              👑 Control Master
            </span>
          </div>
          <p className="text-xs text-slate-400">
            Mesa de administración de aportes, solicitudes de inversores y descarga de copias de seguridad del sistema.
          </p>
        </div>

        {/* Botón de Backup */}
        <button
          type="button"
          onClick={handleDownloadBackup}
          disabled={isDownloadingBackup}
          className="w-full md:w-auto px-5 py-2.5 bg-gradient-to-r from-cyan-500 to-blue-600 hover:from-cyan-400 hover:to-blue-500 text-white font-black text-xs sm:text-sm rounded-xl shadow-lg shadow-cyan-500/20 transition-all flex items-center justify-center gap-2 disabled:opacity-50"
        >
          {isDownloadingBackup ? (
            <>
              <span className="w-4 h-4 border-2 border-white border-t-transparent rounded-full animate-spin"></span>
              Descargando Backup...
            </>
          ) : (
            <>
              <span>💾</span> Descargar Copia de Seguridad (.db)
            </>
          )}
        </button>
      </div>

      {/* Tarjetas KPI de Estado del Pool */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3 sm:gap-4">
        <div className="bg-slate-900 border border-slate-800 rounded-2xl p-4 sm:p-5 shadow-lg">
          <div className="text-slate-400 text-xs font-bold uppercase tracking-wider mb-1 flex items-center justify-between">
            <span>Pool Depositado</span>
            <span>🏦</span>
          </div>
          <div className="text-xl sm:text-2xl font-black font-mono text-white">
            ${Number(pool.total_deposited_pool || 0).toFixed(2)} <span className="text-xs text-slate-400 font-normal">USDT</span>
          </div>
          <div className="text-[11px] text-slate-400 mt-1">Capital total activo aportado</div>
        </div>

        <div className="bg-slate-900 border border-slate-800 rounded-2xl p-4 sm:p-5 shadow-lg">
          <div className="text-slate-400 text-xs font-bold uppercase tracking-wider mb-1 flex items-center justify-between">
            <span>Balance Vivo Binance</span>
            <span className="text-amber-400">⚡</span>
          </div>
          <div className="text-xl sm:text-2xl font-black font-mono text-amber-300">
            ${Number(pool.live_pool_balance || 0).toFixed(2)} <span className="text-xs text-slate-400 font-normal">USDT</span>
          </div>
          <div className="text-[11px] text-slate-400 mt-1">Valor en cuenta de futuros</div>
        </div>

        <div className="bg-slate-900 border border-slate-800 rounded-2xl p-4 sm:p-5 shadow-lg">
          <div className="text-slate-400 text-xs font-bold uppercase tracking-wider mb-1 flex items-center justify-between">
            <span>Rendimiento Global</span>
            <span>{isProfit ? '📈' : '📉'}</span>
          </div>
          <div className={`text-xl sm:text-2xl font-black font-mono ${isProfit ? 'text-emerald-400' : 'text-rose-400'}`}>
            {isProfit ? '+' : ''}${Number(pool.total_pool_pnl || 0).toFixed(2)} ({Number(pool.total_pool_roi || 0).toFixed(2)}%)
          </div>
          <div className="text-[11px] text-slate-400 mt-1">Ganancia neta total a distribuir</div>
        </div>

        <div className="bg-slate-900 border border-slate-800 rounded-2xl p-4 sm:p-5 shadow-lg">
          <div className="text-slate-400 text-xs font-bold uppercase tracking-wider mb-1 flex items-center justify-between">
            <span>Inversionistas</span>
            <span>👥</span>
          </div>
          <div className="text-xl sm:text-2xl font-black font-mono text-white">
            {pool.active_investors_count || 0} <span className="text-xs text-slate-400 font-normal">activos</span>
          </div>
          <div className="text-[11px] text-slate-400 mt-1 flex items-center gap-1.5">
            {pending.length > 0 ? (
              <span className="text-amber-400 font-bold bg-amber-400/10 px-2 py-0.5 rounded-full border border-amber-400/30 animate-pulse">
                {pending.length} pendiente(s)
              </span>
            ) : (
              <span>Al día</span>
            )}
          </div>
        </div>
      </div>

      {/* BANDEJA DE SOLICITUDES PENDIENTES DE APROBACIÓN */}
      {pending.length > 0 && (
        <div className="bg-amber-950/20 border border-amber-500/40 rounded-3xl p-5 sm:p-6 shadow-xl">
          <div className="flex items-center gap-2 mb-3">
            <span className="text-xl">🔔</span>
            <h3 className="text-base font-black text-amber-300">
              Solicitudes de Inversionistas Pendientes de Aprobación ({pending.length})
            </h3>
          </div>
          <p className="text-xs text-slate-300 mb-4">
            Ingresa el capital inicial en USDT aportado por cada persona para autorizar su acceso. Podrás modificar este monto en cualquier momento.
          </p>

          <div className="space-y-3">
            {pending.map((pUser) => (
              <div key={pUser.id} className="bg-slate-900/90 border border-slate-800 rounded-2xl p-4 flex flex-col sm:flex-row sm:items-center justify-between gap-4">
                <div>
                  <div className="font-bold text-white text-sm flex items-center gap-2">
                    <span>👤</span> {pUser.username}
                    <span className="text-[11px] text-slate-400 font-normal">({pUser.email || 'Sin correo'})</span>
                  </div>
                  <div className="text-[11px] text-slate-500 font-mono mt-0.5">
                    Registrado el: {pUser.created_at || '-'}
                  </div>
                </div>

                <div className="flex items-center gap-2 flex-wrap sm:flex-nowrap">
                  <div className="flex items-center bg-slate-950 border border-slate-700 rounded-xl px-2.5 py-1.5 focus-within:border-amber-400">
                    <span className="text-xs text-slate-400 mr-1.5 font-bold">$</span>
                    <input
                      type="number"
                      step="any"
                      min="0"
                      placeholder="Capital USDT (ej: 1000)"
                      value={approvalInputs[pUser.id] ?? ''}
                      onChange={(e) => handleCapitalInputChange(pUser.id, e.target.value)}
                      className="w-36 bg-transparent text-xs text-white focus:outline-none font-mono font-bold"
                    />
                    <span className="text-[10px] text-slate-400 font-bold ml-1">USDT</span>
                  </div>

                  <button
                    type="button"
                    onClick={() => handleApprove(pUser.id)}
                    disabled={isProcessingApproval[pUser.id]}
                    className="px-4 py-2 bg-emerald-500 hover:bg-emerald-400 text-slate-950 font-extrabold text-xs rounded-xl shadow transition flex items-center gap-1 disabled:opacity-50"
                  >
                    ✓ Aprobar
                  </button>

                  <button
                    type="button"
                    onClick={() => handleReject(pUser.id)}
                    disabled={isProcessingApproval[pUser.id]}
                    className="px-3 py-2 bg-slate-800 hover:bg-rose-500/20 text-rose-300 hover:text-rose-200 border border-slate-700 hover:border-rose-500/40 font-bold text-xs rounded-xl transition"
                  >
                    ✗ Rechazar
                  </button>
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* TABLA MAESTRA DE INVERSIONISTAS ACTIVOS */}
      <div className="bg-slate-900 border border-slate-800 rounded-3xl p-5 sm:p-6 shadow-xl">
        <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-2 mb-4 pb-3 border-b border-slate-800">
          <div>
            <h3 className="text-base font-bold text-white flex items-center gap-2">
              <span>📊</span> Distribución Maestra del Fondo & Inversionistas Activos
            </h3>
            <p className="text-xs text-slate-400 mt-0.5">
              Visualización y gestión de capital individual de cada cuenta autorizada.
            </p>
          </div>
          <span className="text-xs text-slate-500 font-mono">
            {investors.length} cuentas autorizadas
          </span>
        </div>

        <div className="overflow-x-auto no-scrollbar">
          <table className="w-full text-left border-collapse">
            <thead>
              <tr className="border-b border-slate-800 text-[11px] font-bold uppercase text-slate-400 tracking-wider">
                <th className="py-3 px-3">Usuario / Rol</th>
                <th className="py-3 px-3 text-right">Capital Aportado</th>
                <th className="py-3 px-3 text-right">Participación</th>
                <th className="py-3 px-3 text-right">Valor Actual</th>
                <th className="py-3 px-3 text-right">Ganancia Neta</th>
                <th className="py-3 px-3 text-right">ROI %</th>
                <th className="py-3 px-3 text-center">Acciones</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-800/60 text-xs">
              {investors.length === 0 ? (
                <tr>
                  <td colSpan="7" className="py-8 text-center text-slate-500">
                    No hay inversionistas activos todavía. Las cuentas aprobadas aparecerán aquí.
                  </td>
                </tr>
              ) : (
                investors.map((inv) => {
                  const invProfit = (inv.net_pnl || 0) >= 0;
                  const isInvAdmin = inv.role === 'admin';
                  return (
                    <tr key={inv.id} className="hover:bg-slate-800/30 transition">
                      <td className="py-3 px-3">
                        <div className="font-bold text-white flex items-center gap-1.5">
                          <span>{isInvAdmin ? '👑' : '👤'}</span> {inv.username}
                          {isInvAdmin && (
                            <span className="text-[10px] bg-amber-400/20 text-amber-300 border border-amber-400/40 px-1.5 py-0.2 rounded font-mono font-bold">
                              Admin
                            </span>
                          )}
                        </div>
                        <div className="text-[11px] text-slate-500 font-mono">
                          {inv.email || 'Sin correo'}
                        </div>
                      </td>

                      <td className="py-3 px-3 text-right font-mono font-bold text-white">
                        ${Number(inv.net_capital || 0).toFixed(2)} USDT
                      </td>

                      <td className="py-3 px-3 text-right">
                        <span className="px-2 py-0.5 rounded-full font-mono font-bold text-amber-300 bg-amber-400/10 border border-amber-400/30 text-[11px]">
                          {Number(inv.share_percentage || 0).toFixed(2)}%
                        </span>
                      </td>

                      <td className="py-3 px-3 text-right font-mono font-bold text-cyan-400">
                        ${Number(inv.current_value || 0).toFixed(2)} USDT
                      </td>

                      <td className={`py-3 px-3 text-right font-mono font-bold ${invProfit ? 'text-emerald-400' : 'text-rose-400'}`}>
                        {invProfit ? '+' : ''}${Number(inv.net_pnl || 0).toFixed(2)}
                      </td>

                      <td className={`py-3 px-3 text-right font-mono font-bold ${invProfit ? 'text-emerald-400' : 'text-rose-400'}`}>
                        {invProfit ? '+' : ''}{Number(inv.roi_percentage || 0).toFixed(2)}%
                      </td>

                      <td className="py-3 px-3 text-center">
                        <button
                          type="button"
                          onClick={() => {
                            setSelectedUserForCapital(inv);
                            setTxType('DEPOSIT');
                            setTxAmount('');
                            setTxNotes('');
                          }}
                          className="px-3 py-1 bg-slate-800 hover:bg-slate-700 text-white rounded-lg text-[11px] font-bold transition border border-slate-700"
                        >
                          ⚙️ Movimiento
                        </button>
                      </td>
                    </tr>
                  );
                })
              )}
            </tbody>
          </table>
        </div>
      </div>

      {/* MODAL DE MOVIMIENTO DE CAPITAL (DEPÓSITO O RETIRO) */}
      {selectedUserForCapital && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-950/80 backdrop-blur-sm">
          <div className="bg-slate-900 border border-slate-700 rounded-3xl p-6 max-w-md w-full shadow-2xl text-white">
            <div className="flex items-center justify-between mb-4 pb-2 border-b border-slate-800">
              <h4 className="font-bold text-base flex items-center gap-2">
                <span>💰</span> Movimiento de Capital: {selectedUserForCapital.username}
              </h4>
              <button
                type="button"
                onClick={() => setSelectedUserForCapital(null)}
                className="text-slate-400 hover:text-white text-lg font-bold"
              >
                ✕
              </button>
            </div>

            <form onSubmit={handleSaveCapitalMovement} className="space-y-4">
              <div>
                <label className="block text-xs font-bold text-slate-300 mb-1">Tipo de Movimiento</label>
                <div className="grid grid-cols-2 gap-2 bg-slate-950 p-1 rounded-xl border border-slate-800">
                  <button
                    type="button"
                    onClick={() => setTxType('DEPOSIT')}
                    className={`py-2 text-xs font-bold rounded-lg transition ${
                      txType === 'DEPOSIT'
                        ? 'bg-emerald-500 text-slate-950 shadow'
                        : 'text-slate-400 hover:text-white'
                    }`}
                  >
                    + Depósito / Aporte
                  </button>
                  <button
                    type="button"
                    onClick={() => setTxType('WITHDRAWAL')}
                    className={`py-2 text-xs font-bold rounded-lg transition ${
                      txType === 'WITHDRAWAL'
                        ? 'bg-rose-500 text-white shadow'
                        : 'text-slate-400 hover:text-white'
                    }`}
                  >
                    - Retiro de Fondos
                  </button>
                </div>
              </div>

              <div>
                <label className="block text-xs font-bold text-slate-300 mb-1">Monto en USDT *</label>
                <div className="flex items-center bg-slate-950 border border-slate-700 rounded-xl px-3 py-2 focus-within:border-amber-400">
                  <span className="text-sm text-slate-400 mr-2 font-bold">$</span>
                  <input
                    type="number"
                    step="any"
                    min="0.01"
                    required
                    placeholder="0.00"
                    value={txAmount}
                    onChange={(e) => setTxAmount(e.target.value)}
                    className="w-full bg-transparent text-sm text-white focus:outline-none font-mono font-bold"
                  />
                  <span className="text-xs text-slate-400 font-bold ml-2">USDT</span>
                </div>
              </div>

              <div>
                <label className="block text-xs font-bold text-slate-300 mb-1">Notas / Concepto (Opcional)</label>
                <input
                  type="text"
                  placeholder="ej: Transferencia TRC20, pago de dividendos..."
                  value={txNotes}
                  onChange={(e) => setTxNotes(e.target.value)}
                  className="w-full px-3 py-2 bg-slate-950 border border-slate-700 rounded-xl text-xs text-white focus:outline-none focus:border-amber-400"
                />
              </div>

              <div className="flex items-center gap-3 pt-2">
                <button
                  type="button"
                  onClick={() => setSelectedUserForCapital(null)}
                  className="flex-1 py-2.5 bg-slate-800 hover:bg-slate-700 text-white text-xs font-bold rounded-xl transition"
                >
                  Cancelar
                </button>
                <button
                  type="submit"
                  disabled={isSavingCapital}
                  className="flex-1 py-2.5 bg-amber-400 hover:bg-amber-300 text-slate-950 text-xs font-black rounded-xl shadow transition disabled:opacity-50"
                >
                  {isSavingCapital ? 'Guardando...' : 'Confirmar Movimiento'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
}
