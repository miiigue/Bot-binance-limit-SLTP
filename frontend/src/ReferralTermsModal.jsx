import React, { useState } from 'react';
import { useAuth } from './AuthContext';

export default function ReferralTermsModal({ isOpen, onClose, onAccepted }) {
  const { authFetch } = useAuth();
  const [hasChecked, setHasChecked] = useState(false);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [errorMsg, setErrorMsg] = useState(null);

  if (!isOpen) return null;

  const TERMS_VERSION = 'v1.0-2026';

  const handleAccept = async () => {
    if (!hasChecked) return;
    setIsSubmitting(true);
    setErrorMsg(null);
    try {
      const resp = await authFetch('/api/user/referrals/accept_terms', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ version: TERMS_VERSION })
      });
      const data = await resp.json();
      if (!resp.ok) {
        throw new Error(data.message || 'Error al aceptar los términos de referidos.');
      }
      if (onAccepted) {
        onAccepted(data.user);
      }
      onClose();
    } catch (err) {
      setErrorMsg(err.message);
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <div className="fixed inset-0 z-[120] flex items-center justify-center p-3 sm:p-6 bg-slate-950/90 backdrop-blur-xl animate-fadeIn">
      <div className="bg-slate-900 border border-slate-700/80 rounded-3xl max-w-2xl w-full max-h-[90vh] flex flex-col shadow-2xl overflow-hidden relative">
        
        {/* Encabezado */}
        <div className="p-5 sm:p-6 bg-slate-950 border-b border-slate-800 flex items-center justify-between">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-2xl bg-amber-400/10 border border-amber-400/30 flex items-center justify-center text-xl">
              🤝
            </div>
            <div>
              <div className="flex items-center gap-2">
                <h3 className="text-base sm:text-lg font-black text-white tracking-tight">
                  Términos del Programa de Referidos & Afiliados
                </h3>
                <span className="px-2 py-0.5 rounded-full text-[10px] font-mono font-extrabold bg-amber-400 text-slate-950">
                  {TERMS_VERSION}
                </span>
              </div>
              <p className="text-xs text-slate-400 mt-0.5">
                WTN ALGO-TRADING — Contrato de Distribución de Comisiones y Responsabilidad
              </p>
            </div>
          </div>
        </div>

        {/* Cuerpo con Scroll del Contrato Legal de Referidos */}
        <div className="p-5 sm:p-6 overflow-y-auto space-y-4 text-xs text-slate-300 leading-relaxed font-sans max-h-[50vh] no-scrollbar">
          
          <div className="p-3.5 bg-amber-500/10 border border-amber-500/30 rounded-2xl text-amber-200 text-[11px] leading-relaxed">
            <strong className="block font-bold text-amber-300 mb-0.5">⚠️ Requisito Legal Indispensable:</strong>
            Para activar tu enlace de recomendación y habilitar a tus invitados a registrarse con tu código de usuario, debes leer, comprender y aceptar formalmente las condiciones de remuneración, transparencia y exención de asesoría financiera descritas a continuación. Si rechazas estos términos, tu código no quedará habilitado para invitar.
          </div>

          <div className="space-y-2">
            <h4 className="font-extrabold text-white text-xs uppercase tracking-wider text-amber-400 border-b border-slate-800 pb-1">
              1. Modelo de Remuneración por Éxito (Success Fee Share)
            </h4>
            <p>
              El usuario referidor participa del <strong>éxito operativo</strong> generado por los bots de sus referidos. La plataforma WTN recauda una comisión de éxito porcentual sobre las ganancias netas cerradas de trading de los usuarios recomendados. De dicho cobro efectuado por la plataforma, el referidor recibe el porcentaje fijado por el sistema (porcentaje de participación en comisiones de éxito).
            </p>
            <p className="text-slate-400">
              * Nota: Si un trade resulta en pérdida (Stop Loss) o el usuario referido no obtiene ganancias netas, no se devenga comisión alguna para la plataforma ni para el referidor.
            </p>
          </div>

          <div className="space-y-2">
            <h4 className="font-extrabold text-white text-xs uppercase tracking-wider text-amber-400 border-b border-slate-800 pb-1">
              2. No Asesoramiento Financiero ni Captación no Autorizada
            </h4>
            <p>
              El usuario que comparte su código de invitación declara actuar a título personal y comprende que WTN ALGO-TRADING es una herramienta tecnológica y de software algorítmico automatizado. Queda estrictamente prohibido al referidor prometer rendimientos fijos o garantizados, gestionar fondos de terceros sin autorización o presentarse como asesor financiero registrado.
            </p>
          </div>

          <div className="space-y-2">
            <h4 className="font-extrabold text-white text-xs uppercase tracking-wider text-amber-400 border-b border-slate-800 pb-1">
              3. Custodia Exclusiva y Operativa en Cuentas Privadas de Binance
            </h4>
            <p>
              Todos los usuarios invitados mantienen en todo momento el control y custodia total de sus fondos dentro de sus propias cuentas de Binance Futures. Las comisiones de referidos se calculan a nivel de software y se liquidan de acuerdo con las políticas contables internas de la plataforma.
            </p>
          </div>

          <div className="space-y-2">
            <h4 className="font-extrabold text-white text-xs uppercase tracking-wider text-amber-400 border-b border-slate-800 pb-1">
              4. Aprobación y Estado de las Cuentas Referidas
            </h4>
            <p>
              La creación de una cuenta mediante un código de referido no garantiza su activación automática; cada cuenta referida está sujeta al procedimiento estándar de auditoría, verificación y aprobación por la Administración de WTN Solutions LLC.
            </p>
          </div>

        </div>

        {/* Footer con Checkbox y Botones */}
        <div className="p-5 sm:p-6 bg-slate-950 border-t border-slate-800 space-y-4">
          {errorMsg && (
            <div className="p-3 bg-rose-500/15 border border-rose-500/40 rounded-xl text-rose-300 text-xs flex items-center gap-2">
              <span>⚠️</span> {errorMsg}
            </div>
          )}

          <label className="flex items-start gap-3 cursor-pointer group select-none">
            <input 
              type="checkbox"
              checked={hasChecked}
              onChange={(e) => setHasChecked(e.target.checked)}
              className="mt-1 w-4 h-4 rounded border-slate-700 bg-slate-950 text-amber-400 focus:ring-amber-400/50 cursor-pointer accent-amber-400"
            />
            <span className="text-xs text-slate-300 group-hover:text-white transition leading-relaxed">
              He leído detenidamente, comprendo y <strong>acepto sin reservas los Términos del Programa de Referidos</strong>, el modelo de participación por comisiones de éxito y las obligaciones legales aplicables.
            </span>
          </label>

          <div className="flex items-center justify-end gap-3 pt-1">
            <button
              type="button"
              onClick={onClose}
              disabled={isSubmitting}
              className="px-4 py-2.5 bg-slate-800 hover:bg-slate-700 text-slate-300 rounded-xl text-xs font-bold transition disabled:opacity-50 cursor-pointer"
            >
              Rechazar / Cancelar
            </button>
            <button
              type="button"
              onClick={handleAccept}
              disabled={!hasChecked || isSubmitting}
              className="px-6 py-2.5 bg-amber-400 hover:bg-amber-300 text-slate-950 rounded-xl text-xs font-black shadow-lg shadow-amber-400/20 transition flex items-center gap-2 disabled:opacity-40 disabled:cursor-not-allowed cursor-pointer"
            >
              {isSubmitting ? (
                <>
                  <span className="w-4 h-4 border-2 border-slate-950 border-t-transparent rounded-full animate-spin"></span>
                  Firmando Contrato Digital...
                </>
              ) : (
                <>
                  <span>✍️</span> Aceptar y Activar Mi Código
                </>
              )}
            </button>
          </div>
        </div>

      </div>
    </div>
  );
}
