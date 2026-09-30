import React from 'react';

export default function LegalModal({ isOpen, onClose }) {
  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-950/85 backdrop-blur-md overflow-y-auto">
      <div className="relative w-full max-w-2xl bg-slate-900 border border-slate-700 rounded-3xl shadow-2xl p-6 sm:p-8 text-white my-8 max-h-[85vh] flex flex-col">
        
        {/* Header */}
        <div className="flex items-center justify-between border-b border-slate-800 pb-4 mb-4">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-2xl bg-amber-400/10 border border-amber-400/30 flex items-center justify-center text-amber-400 text-xl font-bold">
              ⚖️
            </div>
            <div>
              <h3 className="text-lg font-black text-white tracking-tight">TÉRMINOS DE SERVICIO Y AVISO DE RIESGO</h3>
              <p className="text-[11px] text-amber-400 font-bold uppercase tracking-wider">WTN Solutions LLC • Acceso Privado Reservado</p>
            </div>
          </div>
          <button 
            onClick={onClose}
            className="w-8 h-8 rounded-xl bg-slate-800 hover:bg-slate-700 text-slate-400 hover:text-white flex items-center justify-center text-sm font-bold transition"
          >
            ✕
          </button>
        </div>

        {/* Scrollable Body */}
        <div className="overflow-y-auto pr-2 space-y-4 text-xs text-slate-300 leading-relaxed font-sans flex-1">
          <div className="p-3 bg-amber-400/10 border border-amber-400/20 rounded-2xl text-amber-300 text-[11px]">
            <strong>AVISO IMPORTANTE:</strong> Este documento establece las condiciones legales para el uso de la tecnología cuantitativa WTN Algo-Trading. Léalo atentamente antes de solicitar acceso o vincular credenciales.
          </div>

          <section>
            <h4 className="font-bold text-white text-sm mb-1 text-amber-400">1. Carácter Privado y Restringido por Invitación</h4>
            <p>
              El acceso a la plataforma WTN ALGO-TRADING es de carácter estrictamente privado, confidencial y restringido. El uso del sistema se otorga mediante invitación directa individual. Este software no constituye una oferta pública de valores, captación masiva de dinero ni intermediación financiera abierta al público en general.
            </p>
          </section>

          <section>
            <h4 className="font-bold text-white text-sm mb-1 text-amber-400">2. Naturaleza Tecnológica de la Herramienta</h4>
            <p>
              WTN ALGO-TRADING es un desarrollo tecnológico y suite de software algorítmico de procesamiento de datos de mercado en tiempo real. WTN Solutions LLC provee licenciamiento de software y herramientas de automatización de órdenes. Ningún módulo de esta plataforma constituye asesoramiento financiero, recomendación de inversión personalizada ni gestión de activos bajo mandato público.
            </p>
          </section>

          <section>
            <h4 className="font-bold text-white text-sm mb-1 text-amber-400">3. Declaración y Descargo de Alto Riesgo en Mercado de Futuros</h4>
            <p>
              El trading en mercados de derivados de activos digitales y futuros de criptomonedas (Binance Futures) involucra apalancamiento financiero y un **alto nivel de riesgo de pérdida parcial o total del capital**.
            </p>
            <ul className="list-disc pl-5 space-y-1 mt-1 text-slate-400">
              <li>El usuario comprende que la volatilidad del mercado puede generar oscilaciones severas en el saldo.</li>
              <li>Los rendimientos o simulaciones pasadas no garantizan bajo ninguna circunstancia resultados futuros.</li>
              <li>El usuario asume el riesgo íntegro de las operaciones ejecutadas en su cuenta o en el pool colectivo.</li>
            </ul>
          </section>

          <section>
            <h4 className="font-bold text-white text-sm mb-1 text-amber-400">4. Custodia de Claves API y Modalidad Copy Trading</h4>
            <p>
              En la modalidad de Copy Trading, el usuario vincula su propia cuenta de Binance mediante claves API protegidas con cifrado AES-256-GCM. 
            </p>
            <ul className="list-disc pl-5 space-y-1 mt-1 text-slate-400">
              <li>El usuario mantiene la custodia y propiedad exclusiva de sus fondos dentro de su exchange (Binance).</li>
              <li>Las claves API suministradas únicamente deben otorgar permisos de lectura y operaciones de futuros (Sin permisos de retiro).</li>
              <li>El usuario puede activar o pausar la sincronización en cualquier momento desde su panel de control.</li>
            </ul>
          </section>

          <section>
            <h4 className="font-bold text-white text-sm mb-1 text-amber-400">5. Exención de Responsabilidad Técnica</h4>
            <p>
              WTN Solutions LLC y sus administradores quedan expresamente eximidos de responsabilidad contractual o extracontractual derivada de:
            </p>
            <ul className="list-disc pl-5 space-y-1 mt-1 text-slate-400">
              <li>Interrupciones, latencia o fallas en las API de terceros (Binance Exchange).</li>
              <li>Mantenimientos imprevistos o caídas de servidores de red o de intermediarios de datos.</li>
              <li>Deslizamiento de precios (slippage) causado por falta de liquidez o eventos macroeconómicos de volatilidad extrema.</li>
            </ul>
          </section>

          <section>
            <h4 className="font-bold text-white text-sm mb-1 text-amber-400">6. Aceptación Expresa</h4>
            <p>
              Al completar el registro o conectar sus claves API, el usuario declara haber leído, comprendido y aceptado en su totalidad los presentes términos, aceptando operar bajo su propia cuenta y riesgo en el entorno de la tecnología provista.
            </p>
          </section>
        </div>

        {/* Footer */}
        <div className="border-t border-slate-800 pt-4 mt-4 flex justify-end">
          <button
            onClick={onClose}
            className="px-6 py-2.5 bg-gradient-to-r from-amber-400 to-amber-500 hover:from-amber-300 hover:to-amber-400 text-slate-950 font-black rounded-xl text-xs uppercase tracking-wider transition shadow-lg shadow-amber-500/20"
          >
            Entendido y Aceptado
          </button>
        </div>

      </div>
    </div>
  );
}
