import React, { useState, useEffect } from 'react';
import { useAuth } from './AuthContext';

export default function AdminReferralsManager({ addToast }) {
  const { authFetch } = useAuth();
  const [loading, setLoading] = useState(true);
  const [data, setData] = useState(null);
  const [saving, setSaving] = useState(false);

  // Form states para configuración
  const [enabled, setEnabled] = useState(true);
  const [platformFee, setPlatformFee] = useState(20.0);
  const [affiliateShare, setAffiliateShare] = useState(10.0);
  const [minPayout, setMinPayout] = useState(10.0);

  const fetchOverview = async () => {
    setLoading(true);
    try {
      const resp = await authFetch('/api/admin/referrals/overview');
      const resJson = await resp.json();
      if (resp.ok && resJson.status === 'success') {
        setData(resJson.data);
        const s = resJson.data.settings;
        if (s) {
          setEnabled(Boolean(s.enabled));
          setPlatformFee(Number(s.platform_success_fee_pct) || 20.0);
          setAffiliateShare(Number(s.affiliate_share_pct) || 10.0);
          setMinPayout(Number(s.min_payout_usdt) || 10.0);
        }
      }
    } catch (err) {
      console.error('Error al cargar resumen admin de referidos:', err);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchOverview();
  }, []);

  const handleSaveSettings = async (e) => {
    e.preventDefault();
    setSaving(true);
    try {
      const resp = await authFetch('/api/admin/referrals/settings', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          enabled,
          platform_success_fee_pct: parseFloat(platformFee),
          affiliate_share_pct: parseFloat(affiliateShare),
          min_payout_usdt: parseFloat(minPayout)
        })
      });
      const resJson = await resp.json();
      if (!resp.ok) {
        throw new Error(resJson.message || 'Error al guardar configuración.');
      }
      if (addToast) {
        addToast('✅ Ajustes Guardados', resJson.message, 'success');
      }
      fetchOverview();
    } catch (err) {
      if (addToast) {
        addToast('❌ Error', err.message, 'error');
      }
    } finally {
      setSaving(false);
    }
  };

  if (loading) {
    return (
      <div className="flex flex-col items-center justify-center p-12 text-slate-400">
        <div className="w-8 h-8 border-3 border-amber-400 border-t-transparent rounded-full animate-spin mb-3"></div>
        <p className="text-xs font-semibold">Cargando gestión institucional de referidos...</p>
      </div>
    );
  }

  const totals = data?.global_totals || {};
  const referrers = data?.referrers || [];

  return (
    <div className="space-y-6 max-w-7xl mx-auto pb-12 animate-fadeIn">
      
      {/* Encabezado */}
      <div className="bg-slate-900/90 border border-slate-800 rounded-3xl p-6 sm:p-8 shadow-xl flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div>
          <div className="inline-flex items-center gap-2 px-3 py-1 rounded-full bg-amber-400/10 border border-amber-400/30 text-amber-300 text-xs font-bold mb-2">
            <span>⚙️</span> Control Maestro de Afiliados & Comisiones
          </div>
          <h2 className="text-2xl font-black text-white tracking-tight">
            Gestión del Programa de Referidos Institucional
          </h2>
          <p className="text-xs text-slate-400 mt-1">
            Define las tasas de cobro por éxito de la plataforma y el porcentaje compartido a los usuarios que inviten a otros miembros.
          </p>
        </div>
        <button
          type="button"
          onClick={fetchOverview}
          className="px-4 py-2 bg-slate-800 hover:bg-slate-700 text-slate-300 rounded-xl text-xs font-bold transition flex items-center gap-2 self-start sm:self-auto cursor-pointer"
        >
          ↻ Actualizar Datos
        </button>
      </div>

      {/* Formulario de Configuración del Programa */}
      <form onSubmit={handleSaveSettings} className="bg-slate-900/90 border border-slate-800 rounded-3xl p-6 shadow-xl space-y-5">
        <div className="flex items-center justify-between border-b border-slate-800 pb-3">
          <h3 className="text-sm font-extrabold text-white uppercase tracking-wider flex items-center gap-2">
            <span>⚖️</span> Parámetros Contables del Programa
          </h3>
          <label className="flex items-center gap-2 cursor-pointer select-none">
            <span className="text-xs font-bold text-slate-300">Programa Activo:</span>
            <input 
              type="checkbox"
              checked={enabled}
              onChange={(e) => setEnabled(e.target.checked)}
              className="w-4 h-4 rounded text-amber-400 focus:ring-amber-400/50 accent-amber-400 cursor-pointer"
            />
          </label>
        </div>

        <div className="grid grid-cols-1 sm:grid-cols-3 gap-5">
          
          {/* Comisión de Éxito de la Plataforma */}
          <div className="p-4 bg-slate-950 rounded-2xl border border-slate-800 space-y-1.5">
            <label className="block text-xs font-black text-white">
              Fee de Éxito de la Plataforma (%)
            </label>
            <div className="flex items-center gap-2">
              <input
                type="number"
                step="0.1"
                min="0"
                max="100"
                required
                value={platformFee}
                onChange={(e) => setPlatformFee(e.target.value)}
                className="w-full px-3 py-2 bg-slate-900 border border-slate-700 rounded-xl text-sm font-mono font-bold text-white focus:outline-none focus:border-amber-400"
              />
              <span className="text-sm font-black text-slate-400">%</span>
            </div>
            <p className="text-[10px] text-slate-400 leading-relaxed">
              Porcentaje que la plataforma retiene sobre las ganancias netas de los bots.
            </p>
          </div>

          {/* Participación del Referidor */}
          <div className="p-4 bg-slate-950 rounded-2xl border border-amber-400/30 space-y-1.5">
            <label className="block text-xs font-black text-amber-300">
              Participación del Referidor (%)
            </label>
            <div className="flex items-center gap-2">
              <input
                type="number"
                step="0.1"
                min="0"
                max="100"
                required
                value={affiliateShare}
                onChange={(e) => setAffiliateShare(e.target.value)}
                className="w-full px-3 py-2 bg-slate-900 border border-amber-400/60 rounded-xl text-sm font-mono font-bold text-amber-300 focus:outline-none focus:border-amber-400"
              />
              <span className="text-sm font-black text-amber-400">%</span>
            </div>
            <p className="text-[10px] text-amber-200/80 leading-relaxed">
              Porcentaje de lo que gana la plataforma que se acredita al usuario referidor (Por defecto: 10.0%).
            </p>
          </div>

          {/* Mínimo de Retiro */}
          <div className="p-4 bg-slate-950 rounded-2xl border border-slate-800 space-y-1.5">
            <label className="block text-xs font-black text-white">
              Umbral Mínimo de Liquidación (USDT)
            </label>
            <div className="flex items-center gap-2">
              <input
                type="number"
                step="1"
                min="1"
                required
                value={minPayout}
                onChange={(e) => setMinPayout(e.target.value)}
                className="w-full px-3 py-2 bg-slate-900 border border-slate-700 rounded-xl text-sm font-mono font-bold text-white focus:outline-none focus:border-amber-400"
              />
              <span className="text-xs font-black text-slate-400">USDT</span>
            </div>
            <p className="text-[10px] text-slate-400 leading-relaxed">
              Monto mínimo acumulado para liquidar comisiones a los afiliados.
            </p>
          </div>

        </div>

        <div className="flex justify-end pt-2">
          <button
            type="submit"
            disabled={saving}
            className="px-6 py-2.5 bg-amber-400 hover:bg-amber-300 text-slate-950 rounded-xl text-xs font-black shadow-lg shadow-amber-400/20 transition flex items-center gap-2 disabled:opacity-50 cursor-pointer"
          >
            {saving ? 'Guardando cambios...' : '💾 Guardar Parámetros de Referidos'}
          </button>
        </div>
      </form>

      {/* Tarjetas de Resumen Global */}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-4">
        
        <div className="bg-slate-900/90 border border-slate-800 rounded-3xl p-5 shadow-xl">
          <span className="text-[10px] text-slate-400 uppercase tracking-wider block font-semibold">
            PnL Total Operado por Referidos
          </span>
          <div className="text-xl font-black text-emerald-400 font-mono mt-1">
            +${(totals.trade_pnl || 0).toFixed(2)} USDT
          </div>
          <span className="text-[10px] text-slate-500">
            {totals.total_events || 0} operaciones cerradas con ganancia
          </span>
        </div>

        <div className="bg-slate-900/90 border border-slate-800 rounded-3xl p-5 shadow-xl">
          <span className="text-[10px] text-slate-400 uppercase tracking-wider block font-semibold">
            Fee Bruto Recaudado por Plataforma
          </span>
          <div className="text-xl font-black text-white font-mono mt-1">
            +${(totals.platform_gross_fee || 0).toFixed(2)} USDT
          </div>
          <span className="text-[10px] text-slate-500">
            Comisiones totales generadas
          </span>
        </div>

        <div className="bg-slate-900/90 border border-slate-800 rounded-3xl p-5 shadow-xl">
          <span className="text-[10px] text-slate-400 uppercase tracking-wider block font-semibold">
            Comisiones a Afiliados (10%)
          </span>
          <div className="text-xl font-black text-amber-300 font-mono mt-1">
            -${(totals.affiliate_payouts || 0).toFixed(2)} USDT
          </div>
          <span className="text-[10px] text-amber-400/80">
            Acreditado a usuarios referidores
          </span>
        </div>

        <div className="bg-slate-900/90 border border-slate-800 rounded-3xl p-5 shadow-xl">
          <span className="text-[10px] text-slate-400 uppercase tracking-wider block font-semibold">
            Ingreso Neto de la Plataforma
          </span>
          <div className="text-xl font-black text-emerald-300 font-mono mt-1">
            +${(totals.platform_net_revenue || 0).toFixed(2)} USDT
          </div>
          <span className="text-[10px] text-emerald-400/80">
            Margen neto retenido
          </span>
        </div>

      </div>

      {/* Tabla de Usuarios Referidores */}
      <div className="bg-slate-900/90 border border-slate-800 rounded-3xl p-6 shadow-xl space-y-4">
        <h3 className="text-sm font-extrabold text-white uppercase tracking-wider flex items-center gap-2 border-b border-slate-800 pb-3">
          <span>👥</span> Directorio de Referidores y Desempeño ({referrers.length})
        </h3>

        {referrers.length > 0 ? (
          <div className="overflow-x-auto rounded-2xl border border-slate-800 bg-slate-950">
            <table className="w-full text-left text-xs">
              <thead className="bg-slate-900 text-slate-400 text-[10px] font-semibold uppercase tracking-wider border-b border-slate-800">
                <tr>
                  <th className="p-3">ID</th>
                  <th className="p-3">Usuario Referidor</th>
                  <th className="p-3">Términos Aceptados</th>
                  <th className="p-3 text-center">Referidos Directos</th>
                  <th className="p-3">PnL Generado por su Red</th>
                  <th className="p-3">Fee Plataforma</th>
                  <th className="p-3 text-right">Comisión Ganada</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-800/60 font-mono">
                {referrers.map((r) => (
                  <tr key={r.referrer_id} className="hover:bg-slate-900/40 transition">
                    <td className="p-3 text-slate-500">#{r.referrer_id}</td>
                    <td className="p-3 font-bold text-white font-sans">{r.referrer_username}</td>
                    <td className="p-3 font-sans">
                      <span className={`px-2 py-0.5 rounded-full text-[10px] font-bold ${
                        r.referral_terms_accepted 
                          ? 'bg-emerald-500/20 text-emerald-300' 
                          : 'bg-rose-500/20 text-rose-300'
                      }`}>
                        {r.referral_terms_accepted ? 'FIRMADO' : 'PENDIENTE'}
                      </span>
                    </td>
                    <td className="p-3 text-center font-bold text-white font-mono">{r.referred_count}</td>
                    <td className="p-3 text-emerald-400 font-bold">+${r.total_trade_pnl?.toFixed(2)} USDT</td>
                    <td className="p-3 text-slate-300">${r.total_platform_fee?.toFixed(2)} USDT</td>
                    <td className="p-3 text-right text-amber-300 font-black">+${r.total_commissions_earned?.toFixed(2)} USDT</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : (
          <div className="py-8 text-center text-slate-500 text-xs">
            Aún no hay registros de referidos ni comisiones generadas en la plataforma.
          </div>
        )}
      </div>

    </div>
  );
}
