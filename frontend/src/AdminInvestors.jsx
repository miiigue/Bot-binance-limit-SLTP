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

  // Estados de bloqueo/suspensión de usuarios
  const [isTogglingStatus, setIsTogglingStatus] = useState({}); // { [userId]: boolean }

  // Estados de Ficha Técnica 360° (Dossier del Inversionista)
  const [dossierUser, setDossierUser] = useState(null);
  const [dossierData, setDossierData] = useState(null);
  const [isLoadingDossier, setIsLoadingDossier] = useState(false);

  const fetchInvestorsData = useCallback(async () => {
    try {
      setError(null);
      const resp = await authFetch('/api/admin/investors');
      if (!resp.ok) {
        throw new Error('Error al cargar información de inversionistas.');
      }
      const res = await resp.json();
      const fetchedData = res.data || { investors: [], pending_users: [], pool_stats: {} };
      setData(fetchedData);

      // Pre-llenar montos solicitados en approvalInputs si están disponibles
      if (fetchedData.pending_users && fetchedData.pending_users.length > 0) {
        setApprovalInputs(prev => {
          const nextInputs = { ...prev };
          fetchedData.pending_users.forEach(p => {
            if ((nextInputs[p.id] === undefined || nextInputs[p.id] === '') && p.requested_capital > 0) {
              nextInputs[p.id] = p.requested_capital;
            }
          });
          return nextInputs;
        });
      }
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

  // Bloquear / Suspender o Reactivar cuenta de un usuario
  const handleToggleStatus = async (user) => {
    const newStatus = user.status === 'blocked' ? 'active' : 'blocked';
    const actionLabel = newStatus === 'blocked' ? 'BLOQUEAR y revocar el acceso a' : 'REACTIVAR la cuenta de';
    
    if (!window.confirm(`¿Estás seguro de que deseas ${actionLabel} ${user.username}? El cambio entrará en vigor inmediatamente.`)) {
      return;
    }

    setIsTogglingStatus(prev => ({ ...prev, [user.id]: true }));
    try {
      const resp = await authFetch('/api/admin/toggle_user_status', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ user_id: user.id, status: newStatus })
      });

      const res = await resp.json();
      if (!resp.ok) throw new Error(res.message || 'Error al cambiar estado.');

      if (addToast) {
        addToast(
          newStatus === 'blocked' ? '🚫 Inversionista Bloqueado' : '✅ Inversionista Reactivado',
          `La cuenta de ${user.username} ha sido ${newStatus === 'blocked' ? 'suspendida' : 'reactivada'} con éxito.`,
          newStatus === 'blocked' ? 'warning' : 'success'
        );
      }
      fetchInvestorsData();
    } catch (err) {
      if (addToast) addToast('Error', err.message, 'error');
      else alert(err.message);
    } finally {
      setIsTogglingStatus(prev => ({ ...prev, [user.id]: false }));
    }
  };

  // Abrir Ficha Técnica 360° de un inversionista
  const handleOpenDossier = async (user) => {
    setDossierUser(user);
    setDossierData(null);
    setIsLoadingDossier(true);
    try {
      const resp = await authFetch(`/api/admin/investor_dossier/${user.id}`);
      if (!resp.ok) throw new Error('No se pudo cargar la Ficha Técnica 360° del inversionista.');
      const res = await resp.json();
      setDossierData(res.dossier);
    } catch (err) {
      if (addToast) addToast('Error', err.message, 'error');
      else alert(err.message);
    } finally {
      setIsLoadingDossier(false);
    }
  };

  // Descarga del Estado de Cuenta en PDF del cliente desde la vista de Administrador
  const handleDownloadClientStatement = (dossier) => {
    if (!dossier || !dossier.portfolio) return;
    const p = dossier.portfolio;
    const trades = dossier.recent_trades || [];
    const clientUser = p.user || {};
    const accNum = p.account_number || clientUser.account_number || 'WTN-2026-0000';
    const isProfit = (p.net_pnl || 0) >= 0;

    const printWindow = window.open('', '_blank');
    if (!printWindow) {
      alert('Por favor permite ventanas emergentes para generar el documento PDF.');
      return;
    }

    const rowsHtml = (p.transactions || []).map(t => `
      <tr style="border-bottom: 1px solid #e2e8f0;">
        <td style="padding: 8px 12px; font-size: 12px;">${t.created_at || '-'}</td>
        <td style="padding: 8px 12px; font-size: 12px; font-weight: bold; color: ${t.transaction_type === 'WITHDRAWAL' ? '#e11d48' : '#059669'};">
          ${t.transaction_type === 'INITIAL' ? 'Aporte Inicial' : (t.transaction_type === 'DEPOSIT' ? 'Depósito Adicional' : 'Retiro')}
        </td>
        <td style="padding: 8px 12px; font-size: 12px; font-family: monospace; font-weight: bold; text-align: right;">
          $${Number(t.amount_usdt).toFixed(2)} USDT
        </td>
        <td style="padding: 8px 12px; font-size: 12px; color: #64748b;">${t.notes || '-'}</td>
      </tr>
    `).join('');

    const tradesHtml = trades.slice(0, 15).map(tr => `
      <tr style="border-bottom: 1px solid #f1f5f9;">
        <td style="padding: 6px 10px; font-size: 11px;">${tr.close_timestamp || tr.open_timestamp || '-'}</td>
        <td style="padding: 6px 10px; font-size: 11px; font-weight: bold;">${tr.symbol}</td>
        <td style="padding: 6px 10px; font-size: 11px;">${tr.trade_type}</td>
        <td style="padding: 6px 10px; font-size: 11px; font-family: monospace; text-align: right; font-weight: bold; color: ${(tr.pnl_usdt || 0) >= 0 ? '#059669' : '#e11d48'};">
          ${(tr.pnl_usdt || 0) >= 0 ? '+' : ''}${Number(tr.pnl_usdt || 0).toFixed(2)} USDT
        </td>
      </tr>
    `).join('');

    printWindow.document.write(`
      <!DOCTYPE html>
      <html>
      <head>
        <title>Estado de Cuenta - ${clientUser.username} - ${accNum}</title>
        <style>
          @media print {
            body { -webkit-print-color-adjust: exact; print-color-adjust: exact; }
            .no-print { display: none !important; }
          }
          body { font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif; color: #0f172a; margin: 0; padding: 40px; background: #fff; }
          .header { display: flex; justify-content: space-between; align-items: flex-start; border-bottom: 2px solid #f59e0b; padding-bottom: 20px; margin-bottom: 25px; }
          .logo { font-size: 22px; font-weight: 900; color: #0f172a; }
          .logo span { color: #f59e0b; }
          .sub-brand { font-size: 12px; font-weight: 700; color: #64748b; margin-top: 4px; }
          .badge { background: #fef3c7; color: #92400e; padding: 4px 10px; border-radius: 6px; font-size: 11px; font-weight: bold; text-transform: uppercase; }
          .acc-tag { display: inline-block; background: #0f172a; color: #fbbf24; font-family: monospace; font-weight: bold; font-size: 12px; padding: 3px 8px; border-radius: 4px; margin-top: 6px; }
          .grid { display: grid; grid-template-columns: repeat(4, 1fr); gap: 15px; margin-bottom: 30px; }
          .card { background: #f8fafc; border: 1px solid #e2e8f0; border-radius: 10px; padding: 15px; }
          .card-title { font-size: 11px; color: #64748b; font-weight: bold; text-transform: uppercase; margin-bottom: 6px; }
          .card-val { font-size: 20px; font-weight: 900; font-family: monospace; }
          table { width: 100%; border-collapse: collapse; margin-top: 10px; }
          th { background: #f1f5f9; text-align: left; padding: 8px 12px; font-size: 11px; text-transform: uppercase; color: #475569; }
          .footer { margin-top: 40px; border-top: 1px solid #e2e8f0; padding-top: 15px; font-size: 11px; color: #94a3b8; text-align: center; line-height: 1.5; }
          .btn-print { background: #0f172a; color: #fff; padding: 10px 20px; border-radius: 8px; font-weight: bold; cursor: pointer; border: none; font-size: 13px; }
        </style>
      </head>
      <body>
        <div class="no-print" style="margin-bottom: 20px; display: flex; justify-content: flex-end; gap: 10px;">
          <button class="btn-print" onclick="window.print()">🖨️ Imprimir / Guardar como PDF</button>
        </div>

        <div class="header">
          <div>
            <div class="logo">⚡ WTN <span>ALGO-TRADING</span> (Binance)</div>
            <div class="sub-brand">WTN Solutions LLC • Quantitative Asset Management & Pool</div>
            <div class="acc-tag">N° CUENTA: ${accNum}</div>
          </div>
          <div style="text-align: right;">
            <div class="badge">Copia Oficial de Administración</div>
            <div style="font-size: 12px; color: #64748b; margin-top: 6px;">Fecha de Emisión: ${dossier.generated_at}</div>
            <div style="font-size: 13px; font-weight: bold; color: #0f172a; margin-top: 2px;">Titular: ${clientUser.username}</div>
            <div style="font-size: 11px; color: #64748b;">${clientUser.email || ''}</div>
          </div>
        </div>

        <div class="grid">
          <div class="card">
            <div class="card-title">Capital Depositado</div>
            <div class="card-val" style="color: #0f172a;">$${Number(p.capital_invested).toFixed(2)} <span style="font-size: 12px;">USDT</span></div>
          </div>
          <div class="card">
            <div class="card-title">Valor Actual Estimado</div>
            <div class="card-val" style="color: #0284c7;">$${Number(p.current_value).toFixed(2)} <span style="font-size: 12px;">USDT</span></div>
          </div>
          <div class="card">
            <div class="card-title">Ganancia Neta ($)</div>
            <div class="card-val" style="color: ${isProfit ? '#059669' : '#e11d48'};">
              ${isProfit ? '+' : ''}$${Number(p.net_pnl).toFixed(2)}
            </div>
          </div>
          <div class="card">
            <div class="card-title">Retorno (ROI) / Cuota</div>
            <div class="card-val" style="color: ${isProfit ? '#059669' : '#e11d48'};">
              ${isProfit ? '+' : ''}${Number(p.roi_percentage).toFixed(2)}%
              <div style="font-size: 11px; color: #64748b; font-weight: normal; margin-top: 4px;">Participación: ${p.share_percentage}%</div>
            </div>
          </div>
        </div>

        <div style="margin-bottom: 30px;">
          <h3 style="font-size: 14px; text-transform: uppercase; color: #0f172a; margin-bottom: 10px; border-left: 3px solid #f59e0b; padding-left: 8px;">
            Historial de Movimientos de Capital
          </h3>
          <table>
            <thead>
              <tr>
                <th>Fecha</th>
                <th>Tipo</th>
                <th style="text-align: right;">Monto</th>
                <th>Notas</th>
              </tr>
            </thead>
            <tbody>
              ${rowsHtml || '<tr><td colspan="4" style="text-align: center; padding: 15px; color: #94a3b8;">Sin movimientos registrados</td></tr>'}
            </tbody>
          </table>
        </div>

        <div style="margin-bottom: 30px;">
          <h3 style="font-size: 14px; text-transform: uppercase; color: #0f172a; margin-bottom: 10px; border-left: 3px solid #0284c7; padding-left: 8px;">
            Muestra de Últimas Operaciones Ejecutadas por el Bot (Pool)
          </h3>
          <table>
            <thead>
              <tr>
                <th>Fecha Cierre</th>
                <th>Par</th>
                <th>Tipo</th>
                <th style="text-align: right;">Resultado</th>
              </tr>
            </thead>
            <tbody>
              ${tradesHtml || '<tr><td colspan="4" style="text-align: center; padding: 15px; color: #94a3b8;">Sin operaciones recientes</td></tr>'}
            </tbody>
          </table>
        </div>

        <div class="footer">
          Copia certificada emitida por la Administración de <strong>WTN Solutions LLC</strong> — WTN ALGO-TRADING (Binance).<br>
          Cifrado institucional de cuenta ${accNum} verificado en servidor central.<br>
          Operaciones sujetas a condiciones de mercado y volatilidad en Binance Futures.
        </div>
      </body>
      </html>
    `);
    printWindow.document.close();
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
      <div className="grid grid-cols-2 lg:grid-cols-5 gap-3 sm:gap-4">
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
          <div className="text-[11px] text-slate-400 mt-1">Ganancia neta acumulada</div>
        </div>

        {/* Card WTN Solutions LLC (Casa Matriz) */}
        <div className="bg-slate-900 border border-amber-500/30 rounded-2xl p-4 sm:p-5 shadow-lg bg-gradient-to-b from-amber-500/5 to-transparent">
          <div className="text-amber-400 text-xs font-bold uppercase tracking-wider mb-1 flex items-center justify-between">
            <span>WTN Solutions LLC</span>
            <span>👑</span>
          </div>
          <div className="text-xl sm:text-2xl font-black font-mono text-amber-300">
            ${Number(pool.wtn_house_capital || 0).toFixed(2)} <span className="text-xs text-slate-400 font-normal">USDT</span>
          </div>
          <div className="text-[11px] text-slate-400 mt-1">
            Cuota casa matriz: <strong className="text-amber-300">{Number(pool.wtn_house_share || 0).toFixed(1)}%</strong>
          </div>
        </div>

        <div className="bg-slate-900 border border-slate-800 rounded-2xl p-4 sm:p-5 shadow-lg">
          <div className="text-slate-400 text-xs font-bold uppercase tracking-wider mb-1 flex items-center justify-between">
            <span>Inversionistas</span>
            <span>👥</span>
          </div>
          <div className="text-xl sm:text-2xl font-black font-mono text-white">
            {pool.active_investors_count || 0} <span className="text-xs text-slate-400 font-normal">activos</span>
          </div>
          <div className="text-[11px] text-slate-400 mt-1 flex flex-wrap items-center gap-1.5">
            {pending.length > 0 ? (
              <span className="text-amber-400 font-bold bg-amber-400/10 px-2 py-0.5 rounded-full border border-amber-400/30 animate-pulse">
                {pending.length} pendiente(s)
              </span>
            ) : (
              <span>Al día</span>
            )}
            {pool.blocked_investors_count > 0 && (
              <span className="text-rose-400 font-bold bg-rose-500/10 px-1.5 py-0.5 rounded-full border border-rose-500/30">
                {pool.blocked_investors_count} susp.
              </span>
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
                  {pUser.requested_capital > 0 ? (
                    <div className="mt-1.5 flex items-center gap-2">
                      <span className="text-[11px] font-semibold text-slate-400">Monto Solicitado a Invertir:</span>
                      <span className="px-2.5 py-0.5 bg-emerald-500/15 border border-emerald-500/30 rounded-lg text-emerald-400 font-mono font-black text-xs shadow-sm flex items-center gap-1">
                        <span>💰</span> ${Number(pUser.requested_capital).toLocaleString('en-US', { minimumFractionDigits: 2 })} USDT
                      </span>
                    </div>
                  ) : (
                    <div className="mt-1 text-[11px] text-slate-500 italic">
                      Monto a invertir no especificado
                    </div>
                  )}
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
                <th className="py-3 px-3">N° Cuenta</th>
                <th className="py-3 px-3">Usuario / Rol</th>
                <th className="py-3 px-3 text-center">Estado</th>
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
                  <td colSpan="9" className="py-8 text-center text-slate-500">
                    No hay inversionistas activos todavía. Las cuentas aprobadas aparecerán aquí.
                  </td>
                </tr>
              ) : (
                investors.map((inv) => {
                  const invProfit = (inv.net_pnl || 0) >= 0;
                  const isInvAdmin = inv.role === 'admin';
                  const isBlocked = inv.status === 'blocked';

                  return (
                    <tr key={inv.id} className={`hover:bg-slate-800/30 transition ${isBlocked ? 'bg-rose-950/10' : ''}`}>
                      {/* N° Cuenta Institucional */}
                      <td className="py-3 px-3">
                        <span className="font-mono font-bold text-amber-300 text-xs bg-slate-950 px-2 py-1 rounded border border-slate-800">
                          {inv.account_number || 'WTN-2026-0000'}
                        </span>
                      </td>

                      {/* Usuario */}
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

                      {/* Estado */}
                      <td className="py-3 px-3 text-center">
                        {isBlocked ? (
                          <span className="px-2 py-0.5 rounded-full text-[10px] font-black bg-rose-500/20 text-rose-300 border border-rose-500/40">
                            SUSPENDIDO
                          </span>
                        ) : (
                          <span className="px-2 py-0.5 rounded-full text-[10px] font-black bg-emerald-500/20 text-emerald-300 border border-emerald-500/40">
                            ACTIVO
                          </span>
                        )}
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

                      {/* Acciones */}
                      <td className="py-3 px-3 text-center">
                        <div className="flex items-center justify-center gap-1.5 flex-wrap">
                          {/* Botón Ficha Técnica 360° */}
                          <button
                            type="button"
                            onClick={() => handleOpenDossier(inv)}
                            className="px-2.5 py-1 bg-cyan-500/20 hover:bg-cyan-500/30 text-cyan-300 border border-cyan-500/40 rounded-lg text-[11px] font-bold transition flex items-center gap-1"
                            title="Ver Ficha Técnica 360° del Inversionista"
                          >
                            <span>👁️</span> 360°
                          </button>

                          {/* Botón Movimiento de Capital */}
                          <button
                            type="button"
                            onClick={() => {
                              setSelectedUserForCapital(inv);
                              setTxType('DEPOSIT');
                              setTxAmount('');
                              setTxNotes('');
                            }}
                            className="px-2.5 py-1 bg-slate-800 hover:bg-slate-700 text-white rounded-lg text-[11px] font-bold transition border border-slate-700"
                            title="Registrar depósito o retiro de capital"
                          >
                            ⚙️ Mov
                          </button>

                          {/* Botón Bloquear / Reactivar (no para Admin) */}
                          {!isInvAdmin && (
                            <button
                              type="button"
                              onClick={() => handleToggleStatus(inv)}
                              disabled={isTogglingStatus[inv.id]}
                              className={`px-2 py-1 rounded-lg text-[11px] font-extrabold transition border flex items-center gap-1 ${
                                isBlocked
                                  ? 'bg-emerald-500/20 hover:bg-emerald-500/30 text-emerald-300 border-emerald-500/40'
                                  : 'bg-rose-500/20 hover:bg-rose-500/30 text-rose-300 border-rose-500/40'
                              } disabled:opacity-50`}
                              title={isBlocked ? "Reactivar acceso a la plataforma" : "Bloquear acceso inmediatamente"}
                            >
                              {isTogglingStatus[inv.id] ? (
                                '...'
                              ) : isBlocked ? (
                                '✓ Activar'
                              ) : (
                                '🚫 Bloquear'
                              )}
                            </button>
                          )}
                        </div>
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
      {/* MODAL FICHA TÉCNICA 360° DEL INVERSIONISTA */}
      {dossierUser && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-3 sm:p-6 bg-slate-950/85 backdrop-blur-md overflow-y-auto">
          <div className="bg-slate-900 border border-slate-700 rounded-3xl max-w-4xl w-full max-h-[90vh] overflow-y-auto shadow-2xl text-white p-5 sm:p-8 relative">
            
            {/* Cabecera del Dossier */}
            <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4 pb-4 border-b border-slate-800">
              <div>
                <div className="flex flex-wrap items-center gap-2 mb-1">
                  <span className="text-2xl">👁️</span>
                  <h3 className="text-xl font-black text-white">
                    Ficha Técnica 360°: {dossierUser.username}
                  </h3>
                  <span className="px-2.5 py-0.5 rounded-full text-[10px] font-black uppercase tracking-wider bg-cyan-500/20 text-cyan-300 border border-cyan-500/30">
                    Inspección Master
                  </span>
                  <span className="px-2.5 py-0.5 rounded-md text-xs font-mono font-bold bg-slate-950 text-amber-400 border border-slate-700">
                    {dossierData?.portfolio?.account_number || dossierUser.account_number || 'WTN-2026-0000'}
                  </span>
                </div>
                <p className="text-xs text-slate-400">
                  WTN Solutions LLC • Vista expandida y estado patrimonial del inversionista en tiempo real.
                </p>
              </div>

              <div className="flex items-center gap-2 self-stretch sm:self-auto justify-end">
                {/* Botón Descargar PDF Cliente */}
                {dossierData && (
                  <button
                    type="button"
                    onClick={() => handleDownloadClientStatement(dossierData)}
                    className="px-4 py-2 bg-gradient-to-r from-amber-400 to-amber-500 hover:from-amber-300 hover:to-amber-400 text-slate-950 font-black text-xs rounded-xl shadow-lg shadow-amber-500/20 transition flex items-center gap-1.5"
                  >
                    <span>🖨️</span> Descargar PDF Cliente
                  </button>
                )}

                <button
                  type="button"
                  onClick={() => { setDossierUser(null); setDossierData(null); }}
                  className="w-8 h-8 rounded-xl bg-slate-800 hover:bg-slate-700 text-slate-400 hover:text-white flex items-center justify-center font-bold text-base transition"
                >
                  ✕
                </button>
              </div>
            </div>

            {/* Contenido del Dossier */}
            {isLoadingDossier ? (
              <div className="py-16 flex flex-col items-center justify-center text-slate-400">
                <div className="w-10 h-10 border-4 border-amber-400 border-t-transparent rounded-full animate-spin mb-4"></div>
                <p className="text-sm font-bold">Cargando auditoría 360° del inversionista...</p>
              </div>
            ) : !dossierData ? (
              <div className="py-12 text-center text-slate-500">
                No se encontraron datos para este usuario.
              </div>
            ) : (
              <div className="mt-6 space-y-6">
                {/* KPIs Idénticos a los del inversionista */}
                {(() => {
                  const p = dossierData.portfolio || {};
                  const isCliProfit = (p.net_pnl || 0) >= 0;
                  return (
                    <div className="grid grid-cols-2 lg:grid-cols-4 gap-3 sm:gap-4">
                      <div className="bg-slate-950 border border-slate-800 rounded-2xl p-4 shadow">
                        <div className="text-slate-400 text-xs font-bold uppercase mb-1">Capital Depositado</div>
                        <div className="text-xl font-black font-mono text-white">
                          ${Number(p.capital_invested || 0).toFixed(2)} <span className="text-xs text-slate-400">USDT</span>
                        </div>
                        <div className="text-[11px] text-slate-400 mt-1">Aporte neto acumulado</div>
                      </div>

                      <div className="bg-slate-950 border border-slate-800 rounded-2xl p-4 shadow">
                        <div className="text-slate-400 text-xs font-bold uppercase mb-1">Valor Actual Hoy</div>
                        <div className="text-xl font-black font-mono text-cyan-400">
                          ${Number(p.current_value || 0).toFixed(2)} <span className="text-xs text-slate-400">USDT</span>
                        </div>
                        <div className="text-[11px] text-slate-400 mt-1">
                          Cuota: <strong className="text-amber-300">{Number(p.share_percentage || 0).toFixed(2)}%</strong> del pool
                        </div>
                      </div>

                      <div className="bg-slate-950 border border-slate-800 rounded-2xl p-4 shadow">
                        <div className="text-slate-400 text-xs font-bold uppercase mb-1">Ganancia Neta ($)</div>
                        <div className={`text-xl font-black font-mono ${isCliProfit ? 'text-emerald-400' : 'text-rose-400'}`}>
                          {isCliProfit ? '+' : ''}${Number(p.net_pnl || 0).toFixed(2)}
                        </div>
                        <div className="text-[11px] text-slate-400 mt-1">{isCliProfit ? 'Beneficio generado' : 'Drawdown'}</div>
                      </div>

                      <div className="bg-slate-950 border border-slate-800 rounded-2xl p-4 shadow">
                        <div className="text-slate-400 text-xs font-bold uppercase mb-1">Retorno (ROI)</div>
                        <div className={`text-xl font-black font-mono ${isCliProfit ? 'text-emerald-400' : 'text-rose-400'}`}>
                          {isCliProfit ? '+' : ''}{Number(p.roi_percentage || 0).toFixed(2)}%
                        </div>
                        <div className="text-[11px] text-slate-400 mt-1">Rentabilidad sobre aporte</div>
                      </div>
                    </div>
                  );
                })()}

                {/* Historial de Movimientos de Capital del Inversionista */}
                <div className="bg-slate-950 border border-slate-800 rounded-2xl p-4">
                  <h4 className="text-xs font-bold uppercase tracking-wider text-slate-300 mb-3 flex items-center gap-2">
                    <span>📋</span> Historial de Transacciones de este Inversionista
                  </h4>
                  <div className="overflow-x-auto max-h-48 no-scrollbar">
                    <table className="w-full text-left border-collapse text-xs">
                      <thead>
                        <tr className="border-b border-slate-800 text-[10px] uppercase text-slate-400 font-bold">
                          <th className="py-2 px-3">Fecha</th>
                          <th className="py-2 px-3">Tipo</th>
                          <th className="py-2 px-3 text-right">Monto</th>
                          <th className="py-2 px-3">Notas</th>
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-slate-800/50">
                        {(dossierData.portfolio?.transactions || []).length === 0 ? (
                          <tr>
                            <td colSpan="4" className="py-4 text-center text-slate-500">
                              Sin transacciones registradas.
                            </td>
                          </tr>
                        ) : (
                          dossierData.portfolio.transactions.map(t => {
                            const isWd = t.transaction_type === 'WITHDRAWAL';
                            return (
                              <tr key={t.id} className="hover:bg-slate-900/50">
                                <td className="py-2 px-3 font-mono text-slate-400 text-[11px]">{t.created_at || '-'}</td>
                                <td className="py-2 px-3">
                                  <span className={`px-2 py-0.5 rounded text-[10px] font-bold ${
                                    isWd ? 'bg-rose-500/10 text-rose-300' : 'bg-emerald-500/10 text-emerald-300'
                                  }`}>
                                    {t.transaction_type === 'INITIAL' ? 'Aporte Inicial' : (isWd ? 'Retiro' : 'Depósito')}
                                  </span>
                                </td>
                                <td className="py-2 px-3 text-right font-mono font-bold text-white">
                                  {isWd ? '-' : '+'}${Number(t.amount_usdt).toFixed(2)} USDT
                                </td>
                                <td className="py-2 px-3 text-slate-400 text-xs">{t.notes || '-'}</td>
                              </tr>
                            );
                          })
                        )}
                      </tbody>
                    </table>
                  </div>
                </div>

                {/* Últimas Operaciones Ejecutadas en el Fondo */}
                <div className="bg-slate-950 border border-slate-800 rounded-2xl p-4">
                  <h4 className="text-xs font-bold uppercase tracking-wider text-slate-300 mb-3 flex items-center gap-2">
                    <span>⚡</span> Últimas Operaciones Ejecutadas en Binance Futures (Afectan a este Inversionista)
                  </h4>
                  <div className="overflow-x-auto max-h-48 no-scrollbar">
                    <table className="w-full text-left border-collapse text-xs">
                      <thead>
                        <tr className="border-b border-slate-800 text-[10px] uppercase text-slate-400 font-bold">
                          <th className="py-2 px-3">Fecha Cierre</th>
                          <th className="py-2 px-3">Símbolo</th>
                          <th className="py-2 px-3">Tipo</th>
                          <th className="py-2 px-3 text-right">Resultado</th>
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-slate-800/50">
                        {(dossierData.recent_trades || []).length === 0 ? (
                          <tr>
                            <td colSpan="4" className="py-4 text-center text-slate-500">
                              Sin operaciones recientes.
                            </td>
                          </tr>
                        ) : (
                          dossierData.recent_trades.slice(0, 10).map((tr, idx) => (
                            <tr key={idx} className="hover:bg-slate-900/50">
                              <td className="py-2 px-3 font-mono text-slate-400 text-[11px]">{tr.close_timestamp || tr.open_timestamp || '-'}</td>
                              <td className="py-2 px-3 font-bold text-white">{tr.symbol}</td>
                              <td className="py-2 px-3 text-slate-300">{tr.trade_type}</td>
                              <td className={`py-2 px-3 text-right font-mono font-bold ${(tr.pnl_usdt || 0) >= 0 ? 'text-emerald-400' : 'text-rose-400'}`}>
                                {(tr.pnl_usdt || 0) >= 0 ? '+' : ''}${Number(tr.pnl_usdt || 0).toFixed(2)} USDT
                              </td>
                            </tr>
                          ))
                        )}
                      </tbody>
                    </table>
                  </div>
                </div>

              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
