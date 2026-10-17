import React, { useState, useEffect } from 'react';
import { useAuth } from './AuthContext';
import ReferralTermsModal from './ReferralTermsModal';

export default function ReferralProgramView({ addToast }) {
  const { user, authFetch, updateUser } = useAuth();
  const [loading, setLoading] = useState(true);
  const [data, setData] = useState(null);
  const [showTermsModal, setShowTermsModal] = useState(false);
  const [copied, setCopied] = useState(false);

  const fetchDashboard = async () => {
    setLoading(true);
    try {
      const resp = await authFetch('/api/user/referrals/dashboard');
      const resJson = await resp.json();
      if (resp.ok && resJson.status === 'success') {
        setData(resJson.data);
      }
    } catch (err) {
      console.error('Error al cargar dashboard de referidos:', err);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchDashboard();
  }, []);

  const referralCode = data?.referral_code || user?.username || '';
  const referralLink = `${window.location.origin}/?ref=${encodeURIComponent(referralCode)}`;

  const handleCopyLink = () => {
    if (!referralCode) return;
    navigator.clipboard.writeText(referralLink);
    setCopied(true);
    if (addToast) {
      addToast('📋 Enlace Copiado', 'Tu enlace de invitación exclusivo se copió al portapapeles.', 'success');
    }
    setTimeout(() => setCopied(false), 3000);
  };

  const isTermsAccepted = Boolean(data?.terms_accepted || user?.referral_terms_accepted || user?.role === 'admin');

  if (loading) {
    return (
      <div className="flex flex-col items-center justify-center p-12 text-slate-400">
        <div className="w-8 h-8 border-3 border-amber-400 border-t-transparent rounded-full animate-spin mb-3"></div>
        <p className="text-xs font-semibold">Cargando programa de referidos...</p>
      </div>
    );
  }

  return (
    <div className="space-y-6 max-w-6xl mx-auto pb-12 animate-fadeIn">
      
      {/* Banner Superior Principal */}
      <div className="bg-gradient-to-r from-slate-900 via-indigo-950/40 to-slate-900 border border-slate-800 rounded-3xl p-6 sm:p-8 shadow-2xl relative overflow-hidden">
        <div className="absolute right-0 top-0 translate-x-8 -translate-y-8 w-64 h-64 bg-amber-400/5 rounded-full blur-3xl pointer-events-none"></div>

        <div className="flex flex-col md:flex-row md:items-center justify-between gap-6 relative z-10">
          <div className="space-y-2 max-w-2xl">
            <div className="inline-flex items-center gap-2 px-3 py-1 rounded-full bg-amber-400/10 border border-amber-400/30 text-amber-300 text-xs font-bold">
              <span>🤝</span> Programa Institucional de Invitación & Afiliados
            </div>
            <h2 className="text-2xl sm:text-3xl font-black text-white tracking-tight">
              Comparte el Poder del Algo-Trading y <span className="text-amber-400">Gana Comisiones de Éxito</span>
            </h2>
            <p className="text-xs sm:text-sm text-slate-300 leading-relaxed font-sans">
              Invita a tus socios o amigos a la plataforma mediante tu código exclusivo. Cuando sus bots generen <strong>ganancias netas en Binance</strong>, tú recibirás automáticamente un <strong>{data?.program_settings?.affiliate_share_pct || 10.0}%</strong> de la comisión de éxito recaudada por la plataforma.
            </p>
          </div>

          {/* Estado de Activación */}
          <div className="bg-slate-950/90 border border-slate-800 rounded-2xl p-5 min-w-[260px] text-center space-y-3">
            <span className="text-[10px] text-slate-400 uppercase tracking-widest font-black block">
              ESTADO DE TU CÓDIGO
            </span>
            {isTermsAccepted ? (
              <div className="space-y-2">
                <div className="inline-flex items-center gap-2 px-3 py-1 bg-emerald-500/20 border border-emerald-500/40 rounded-xl text-emerald-300 text-xs font-extrabold">
                  <span>✓</span> ACTIVO Y HABILITADO
                </div>
                <div className="text-[11px] text-slate-400 font-mono">
                  Código: <strong className="text-white text-xs">{referralCode}</strong>
                </div>
              </div>
            ) : (
              <div className="space-y-3">
                <div className="inline-flex items-center gap-2 px-3 py-1 bg-rose-500/20 border border-rose-500/40 rounded-xl text-rose-300 text-xs font-bold">
                  <span>⚠️</span> PENDIENTE DE ACTIVACIÓN
                </div>
                <p className="text-[11px] text-slate-400 leading-tight">
                  Debes firmar los términos legales del programa para que otros puedan usar tu código.
                </p>
                <button
                  type="button"
                  onClick={() => setShowTermsModal(true)}
                  className="w-full py-2 px-3 bg-amber-400 hover:bg-amber-300 text-slate-950 rounded-xl text-xs font-black shadow transition active:scale-95 cursor-pointer"
                >
                  ✍️ Aceptar Términos & Activar
                </button>
              </div>
            )}
          </div>
        </div>
      </div>

      {/* Tarjeta de Compartir Enlace & Código (Solo si está activo) */}
      {isTermsAccepted ? (
        <div className="bg-slate-900/90 border border-slate-800 rounded-3xl p-6 shadow-xl space-y-4">
          <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2 border-b border-slate-800 pb-3">
            <h3 className="text-sm font-extrabold text-white uppercase tracking-wider flex items-center gap-2">
              <span>🔗</span> Tu Enlace Exclusivo de Registro
            </h3>
            <span className="text-xs text-amber-400 font-medium">
              El registro en la plataforma es exclusivo por invitación obligatoria
            </span>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-3 gap-4 pt-1">
            
            {/* Campo 1: Código directo */}
            <div className="p-4 bg-slate-950 rounded-2xl border border-slate-800 flex flex-col justify-between">
              <div>
                <span className="text-[10px] text-slate-400 uppercase tracking-wider block font-semibold mb-1">
                  Tu Código de Usuario Único
                </span>
                <span className="text-xl font-black font-mono text-white tracking-wider">
                  {referralCode}
                </span>
                <p className="text-[10px] text-slate-500 mt-1">
                  Tus invitados pueden escribir este usuario al registrarse.
                </p>
              </div>
            </div>

            {/* Campo 2: Enlace Web completo con botón copiar */}
            <div className="md:col-span-2 p-4 bg-slate-950 rounded-2xl border border-slate-800 flex flex-col sm:flex-row sm:items-center justify-between gap-3">
              <div className="min-w-0 flex-1">
                <span className="text-[10px] text-slate-400 uppercase tracking-wider block font-semibold mb-1">
                  Enlace Directo para Compartir (Autocompleta tu código)
                </span>
                <div className="text-xs font-mono text-emerald-400 truncate bg-slate-900 px-3 py-2 rounded-xl border border-slate-800 select-all">
                  {referralLink}
                </div>
              </div>
              <button
                type="button"
                onClick={handleCopyLink}
                className="px-5 py-3 bg-amber-400 hover:bg-amber-300 text-slate-950 rounded-xl text-xs font-black shadow-lg shadow-amber-400/20 transition flex items-center justify-center gap-2 active:scale-95 flex-shrink-0 cursor-pointer"
              >
                <span>{copied ? '✓' : '📋'}</span>
                <span>{copied ? '¡Copiado!' : 'Copiar Enlace'}</span>
              </button>
            </div>

          </div>
        </div>
      ) : (
        <div className="p-6 bg-slate-900/60 border border-slate-800 rounded-3xl text-center space-y-3">
          <div className="text-3xl">🔒</div>
          <h3 className="text-base font-bold text-white">Enlace de Invitación Deshabilitado</h3>
          <p className="text-xs text-slate-400 max-w-lg mx-auto leading-relaxed">
            Para proteger tanto a los usuarios como a la plataforma, el sistema requiere que todo referidor acepte primero el <strong>Acuerdo de Distribución de Comisiones y Responsabilidad</strong> antes de poder invitar amigos.
          </p>
          <button
            type="button"
            onClick={() => setShowTermsModal(true)}
            className="py-2.5 px-6 bg-amber-400 hover:bg-amber-300 text-slate-950 rounded-xl text-xs font-black transition cursor-pointer shadow-lg shadow-amber-400/20"
          >
            Revisar y Aceptar Términos de Referidos
          </button>
        </div>
      )}

      {/* Métricas del Programa */}
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
        
        {/* Total Referidos */}
        <div className="bg-slate-900/90 border border-slate-800 rounded-3xl p-5 shadow-xl flex items-center gap-4">
          <div className="w-12 h-12 rounded-2xl bg-indigo-500/10 border border-indigo-500/30 flex items-center justify-center text-2xl flex-shrink-0">
            👥
          </div>
          <div>
            <span className="text-[10px] text-slate-400 uppercase tracking-wider block font-semibold">
              Amigos Invitados
            </span>
            <div className="text-2xl font-black text-white font-mono mt-0.5">
              {data?.total_referred_count || 0}
            </div>
            <span className="text-[10px] text-slate-500">
              Registrados con tu código
            </span>
          </div>
        </div>

        {/* PnL Generado por la Red */}
        <div className="bg-slate-900/90 border border-slate-800 rounded-3xl p-5 shadow-xl flex items-center gap-4">
          <div className="w-12 h-12 rounded-2xl bg-emerald-500/10 border border-emerald-500/30 flex items-center justify-center text-2xl flex-shrink-0">
            📈
          </div>
          <div>
            <span className="text-[10px] text-slate-400 uppercase tracking-wider block font-semibold">
              PnL Ganado por tus Referidos
            </span>
            <div className="text-2xl font-black text-emerald-400 font-mono mt-0.5">
              +${(data?.total_network_pnl || 0).toFixed(2)} <span className="text-xs font-sans text-slate-400">USDT</span>
            </div>
            <span className="text-[10px] text-slate-500">
              Ganancias generadas por sus bots
            </span>
          </div>
        </div>

        {/* Comisiones Acreditadas al Referidor */}
        <div className="bg-slate-900/90 border border-slate-800 rounded-3xl p-5 shadow-xl flex items-center gap-4">
          <div className="w-12 h-12 rounded-2xl bg-amber-400/10 border border-amber-400/30 flex items-center justify-center text-2xl flex-shrink-0">
            💰
          </div>
          <div>
            <span className="text-[10px] text-slate-400 uppercase tracking-wider block font-semibold">
              Tus Ganancias de Afiliado
            </span>
            <div className="text-2xl font-black text-amber-300 font-mono mt-0.5">
              +${(data?.total_commissions_earned_usdt || 0).toFixed(2)} <span className="text-xs font-sans text-slate-400">USDT</span>
            </div>
            <span className="text-[10px] text-emerald-400 font-medium">
              ({data?.program_settings?.affiliate_share_pct || 10}% de comisión de éxito)
            </span>
          </div>
        </div>

      </div>

      {/* Listado de Amigos Referidos */}
      <div className="bg-slate-900/90 border border-slate-800 rounded-3xl p-6 shadow-xl space-y-4">
        <div className="flex items-center justify-between border-b border-slate-800 pb-3">
          <h3 className="text-sm font-extrabold text-white uppercase tracking-wider flex items-center gap-2">
            <span>👥</span> Tus Usuarios Referidos ({data?.referred_users?.length || 0})
          </h3>
          <button
            type="button"
            onClick={fetchDashboard}
            className="px-3 py-1 bg-slate-800 hover:bg-slate-700 text-slate-300 rounded-xl text-xs font-bold transition flex items-center gap-1 cursor-pointer"
          >
            ↻ Actualizar
          </button>
        </div>

        {data?.referred_users && data.referred_users.length > 0 ? (
          <div className="overflow-x-auto rounded-2xl border border-slate-800 bg-slate-950">
            <table className="w-full text-left text-xs">
              <thead className="bg-slate-900 text-slate-400 text-[10px] font-semibold uppercase tracking-wider border-b border-slate-800">
                <tr>
                  <th className="p-3">#</th>
                  <th className="p-3">Usuario</th>
                  <th className="p-3">Correo</th>
                  <th className="p-3">Fecha de Registro</th>
                  <th className="p-3">Capital Asignado</th>
                  <th className="p-3 text-right">Estado</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-800/60 font-sans">
                {data.referred_users.map((refUser, idx) => (
                  <tr key={refUser.id} className="hover:bg-slate-900/40 transition">
                    <td className="p-3 font-mono text-slate-500">#{idx + 1}</td>
                    <td className="p-3 font-bold text-white font-mono">{refUser.username}</td>
                    <td className="p-3 text-slate-400 font-mono text-[11px]">{refUser.email_masked}</td>
                    <td className="p-3 text-slate-400">{refUser.created_at ? refUser.created_at.split(' ')[0] : '-'}</td>
                    <td className="p-3 font-mono font-bold text-white">${refUser.requested_capital?.toFixed(2)} USDT</td>
                    <td className="p-3 text-right">
                      <span className={`px-2 py-0.5 rounded-full text-[10px] font-bold ${
                        refUser.status === 'active' 
                          ? 'bg-emerald-500/20 text-emerald-300 border border-emerald-500/40' 
                          : 'bg-amber-500/20 text-amber-300 border border-amber-500/40'
                      }`}>
                        {refUser.status === 'active' ? 'ACTIVO' : 'PENDIENTE'}
                      </span>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : (
          <div className="py-8 text-center text-slate-500 text-xs">
            Aún no tienes referidos registrados. Comparte tu código <strong>{referralCode}</strong> para empezar a generar comisiones.
          </div>
        )}
      </div>

      {/* Historial de Comisiones Generadas por Operaciones */}
      {data?.commissions_history && data.commissions_history.length > 0 && (
        <div className="bg-slate-900/90 border border-slate-800 rounded-3xl p-6 shadow-xl space-y-4">
          <h3 className="text-sm font-extrabold text-white uppercase tracking-wider flex items-center gap-2 border-b border-slate-800 pb-3">
            <span>💵</span> Historial de Comisiones Acreditadas
          </h3>
          <div className="overflow-x-auto rounded-2xl border border-slate-800 bg-slate-950">
            <table className="w-full text-left text-xs">
              <thead className="bg-slate-900 text-slate-400 text-[10px] font-semibold uppercase tracking-wider border-b border-slate-800">
                <tr>
                  <th className="p-3">ID</th>
                  <th className="p-3">Referido</th>
                  <th className="p-3">Ganancia del Trade</th>
                  <th className="p-3">Fee Plataforma ({data?.program_settings?.platform_success_fee_pct}%)</th>
                  <th className="p-3">Tu Parte ({data?.program_settings?.affiliate_share_pct}%)</th>
                  <th className="p-3">Comisión Ganada</th>
                  <th className="p-3 text-right">Fecha</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-800/60 font-mono text-[11px]">
                {data.commissions_history.map((c) => (
                  <tr key={c.id} className="hover:bg-slate-900/40 transition">
                    <td className="p-3 text-slate-500">#{c.id}</td>
                    <td className="p-3 font-bold text-white font-sans">{c.referred_username}</td>
                    <td className="p-3 text-emerald-400 font-bold">+${c.trade_pnl?.toFixed(2)} USDT</td>
                    <td className="p-3 text-slate-300">${c.platform_fee_usdt?.toFixed(2)} USDT</td>
                    <td className="p-3 text-amber-400 font-bold">{c.affiliate_share_pct}%</td>
                    <td className="p-3 text-amber-300 font-extrabold">+${c.commission_usdt?.toFixed(4)} USDT</td>
                    <td className="p-3 text-right text-slate-500 font-sans">{c.created_at}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* Modal de Aceptación de Términos */}
      <ReferralTermsModal 
        isOpen={showTermsModal} 
        onClose={() => setShowTermsModal(false)}
        onAccepted={(updatedUser) => {
          if (updateUser) {
            updateUser(updatedUser);
          }
          fetchDashboard();
          if (addToast) {
            addToast('🎉 Programa Activado', 'Has aceptado los términos de referidos. ¡Ya puedes invitar a tus amigos!', 'success');
          }
        }}
      />

    </div>
  );
}
