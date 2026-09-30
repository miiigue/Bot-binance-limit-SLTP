import React, { useState } from 'react';
import { useAuth } from './AuthContext';

export default function LegalTermsModal({ user, onTermsAccepted }) {
  const { authFetch } = useAuth();
  const [hasChecked, setHasChecked] = useState(false);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [errorMsg, setErrorMsg] = useState(null);

  const TERMS_VERSION = 'v1.0-2026';

  const handleAccept = async () => {
    if (!hasChecked) return;
    setIsSubmitting(true);
    setErrorMsg(null);
    try {
      const resp = await authFetch('/api/user/accept_terms', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ version: TERMS_VERSION })
      });
      const data = await resp.json();
      if (!resp.ok) {
        throw new Error(data.message || 'Error al guardar la aceptación de términos.');
      }
      if (onTermsAccepted) {
        onTermsAccepted(data.user || user);
      }
    } catch (err) {
      setErrorMsg(err.message);
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <div className="fixed inset-0 z-[100] flex items-center justify-center p-3 sm:p-6 bg-slate-950/90 backdrop-blur-xl animate-fadeIn">
      <div className="bg-slate-900 border border-slate-700/80 rounded-3xl max-w-3xl w-full max-h-[92vh] flex flex-col shadow-2xl overflow-hidden relative">
        
        {/* Encabezado Institucional Legal */}
        <div className="p-5 sm:p-6 bg-slate-950 border-b border-slate-800 flex items-center justify-between">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-2xl bg-amber-400/10 border border-amber-400/30 flex items-center justify-center text-xl">
              📜
            </div>
            <div>
              <div className="flex items-center gap-2">
                <h3 className="text-base sm:text-lg font-black text-white tracking-tight">
                  Términos de Servicio & Declaración de Riesgos
                </h3>
                <span className="px-2 py-0.5 rounded-full text-[10px] font-mono font-extrabold bg-amber-400 text-slate-950">
                  {TERMS_VERSION}
                </span>
              </div>
              <p className="text-xs text-slate-400 mt-0.5">
                WTN ALGO-TRADING — WTN Solutions LLC (Acuerdo de Licencia de Software Privado)
              </p>
            </div>
          </div>
        </div>

        {/* Cuerpo con Scroll del Contrato Legal */}
        <div className="p-5 sm:p-6 overflow-y-auto space-y-4 text-xs text-slate-300 leading-relaxed font-sans max-h-[55vh] no-scrollbar">
          
          <div className="p-3.5 bg-amber-500/10 border border-amber-500/30 rounded-2xl text-amber-200 text-[11px] leading-relaxed">
            <strong className="block font-bold text-amber-300 mb-0.5">🛡️ Firma Digital Obligatoria para Todos los Usuarios:</strong>
            Para garantizar la máxima seguridad jurídica y transparencia, todos los usuarios (nuevos y registrados) deben revisar y aceptar el presente acuerdo de uso privado antes de acceder al entorno operativo.
          </div>

          <div className="space-y-3">
            <h4 className="font-extrabold text-white text-sm uppercase tracking-wider text-amber-400 border-b border-slate-800 pb-1">
              1. Carácter Privado y Exclusivo por Invitación
            </h4>
            <p>
              La plataforma tecnológica <strong>WTN ALGO-TRADING</strong> opera de forma privada y reservada exclusivamente para usuarios invitados directamente por la administración. No constituye una oferta pública de valores, intermediación financiera ni captación pública de fondos masiva. El acceso es personal e intransferible.
            </p>
          </div>

          <div className="space-y-3">
            <h4 className="font-extrabold text-white text-sm uppercase tracking-wider text-amber-400 border-b border-slate-800 pb-1">
              2. Custodia Total y Licencia de Software API
            </h4>
            <p>
              En la modalidad de Copy-Trading o sincronización de cuenta propia de Binance Futures mediante API Keys, <strong>el usuario mantiene la custodia total y soberana de sus activos en su propio exchange</strong>. La tecnología únicamente requiere permisos de Lectura (<em>Enable Reading</em>) y Ejecución de Futuros (<em>Enable Futures</em>). <strong>Queda estrictamente prohibido y bloqueado cualquier permiso de retiro de fondos (<em>Enable Withdrawals</em>)</strong>.
            </p>
          </div>

          <div className="space-y-3">
            <h4 className="font-extrabold text-white text-sm uppercase tracking-wider text-amber-400 border-b border-slate-800 pb-1">
              3. Declaración de Riesgos y Volatilidad de Mercado
            </h4>
            <p>
              El trading en mercados financieros descentralizados y derivados cripto (Futures) involucra un riesgo inherente derivado de la volatilidad extrema, deslizamientos (<em>slippage</em>) y condiciones imprevistas de mercado. El usuario acepta expresamente que los rendimientos pasados generados por los algoritmos cuantitativos no garantizan ni aseguran resultados o ganancias futuras.
            </p>
          </div>

          <div className="space-y-3">
            <h4 className="font-extrabold text-white text-sm uppercase tracking-wider text-amber-400 border-b border-slate-800 pb-1">
              4. Registro en Base de Datos y Trazabilidad Legal
            </h4>
            <p>
              Al aceptar este documento, la plataforma registrará una firma digital indeleble asociada a tu ID de cuenta (<strong>{user?.account_number || `Cuenta #${user?.id}`}</strong>), timestamp exacto en hora UTC, dirección IP de conexión y la versión activa de los términos (<strong>{TERMS_VERSION}</strong>) en la base de datos central para constancia jurídica de consentimiento informado.
            </p>
          </div>

        </div>

        {/* Pie con Checkbox y Botón de Aceptación */}
        <div className="p-5 sm:p-6 bg-slate-950 border-t border-slate-800 space-y-4">
          {errorMsg && (
            <div className="p-3 bg-rose-500/15 border border-rose-500/30 rounded-xl text-rose-300 text-xs">
              ⚠️ {errorMsg}
            </div>
          )}

          <label className="flex items-start gap-3 cursor-pointer group">
            <input
              type="checkbox"
              checked={hasChecked}
              onChange={(e) => setHasChecked(e.target.checked)}
              className="mt-0.5 w-4 h-4 rounded border-slate-700 bg-slate-900 text-amber-400 focus:ring-amber-400 focus:ring-offset-slate-950 cursor-pointer"
            />
            <span className="text-xs text-slate-300 group-hover:text-white leading-relaxed">
              He leído, comprendo y acepto íntegramente los <strong>Términos de Servicio, la Declaración de Riesgos y la Exención de Responsabilidad Legal</strong> de WTN Solutions LLC (Versión {TERMS_VERSION}).
            </span>
          </label>

          <button
            type="button"
            onClick={handleAccept}
            disabled={!hasChecked || isSubmitting}
            className={`w-full py-3.5 px-6 rounded-2xl font-black text-xs uppercase tracking-wider transition-all shadow-xl flex items-center justify-center gap-2 ${
              hasChecked && !isSubmitting
                ? 'bg-gradient-to-r from-amber-400 to-amber-500 hover:from-amber-300 hover:to-amber-400 text-slate-950 shadow-amber-500/25 active:scale-[0.99]'
                : 'bg-slate-800 text-slate-500 cursor-not-allowed border border-slate-700'
            }`}
          >
            {isSubmitting ? (
              <div className="w-4 h-4 border-2 border-slate-950 border-t-transparent rounded-full animate-spin"></div>
            ) : (
              <>
                <span>✍️</span> ACEPTAR Y CONTINUAR AL BOT
              </>
            )}
          </button>
        </div>

      </div>
    </div>
  );
}
