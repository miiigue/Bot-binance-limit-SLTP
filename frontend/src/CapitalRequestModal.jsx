import React, { useState } from 'react';
import { useAuth } from './AuthContext';

export default function CapitalRequestModal({ isOpen, onClose, onRequestSubmitted }) {
  const { authFetch, user } = useAuth();
  const [amount, setAmount] = useState('1000');
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [feedback, setFeedback] = useState(null);

  if (!isOpen) return null;

  const handleSubmit = async (e) => {
    e.preventDefault();
    const val = parseFloat(amount);
    if (isNaN(val) || val <= 0) {
      setFeedback({ type: 'error', text: 'Ingresa un monto válido en USDT mayor a 0.' });
      return;
    }

    setIsSubmitting(true);
    setFeedback(null);
    try {
      const resp = await authFetch('/api/investor/request_capital', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ amount: val })
      });
      const data = await resp.json();
      if (!resp.ok) {
        throw new Error(data.message || 'Error al enviar la solicitud.');
      }

      setFeedback({ type: 'success', text: data.message });
      setTimeout(() => {
        if (onRequestSubmitted) onRequestSubmitted(val);
        onClose();
      }, 2000);
    } catch (err) {
      setFeedback({ type: 'error', text: err.message });
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <div className="fixed inset-0 z-[100] flex items-center justify-center p-4 bg-slate-950/80 backdrop-blur-md animate-fadeIn">
      <div className="bg-slate-900 border border-slate-800 rounded-3xl max-w-md w-full p-6 sm:p-8 shadow-2xl space-y-5 relative">
        <button
          onClick={onClose}
          className="absolute top-5 right-5 text-slate-400 hover:text-white text-lg font-bold"
        >
          ✕
        </button>

        <div>
          <div className="w-10 h-10 rounded-2xl bg-amber-400/10 border border-amber-400/30 flex items-center justify-center text-xl mb-3">
            💼
          </div>
          <h3 className="text-xl font-black text-white tracking-tight">
            Solicitar Aporte / Inclusión al Fondo
          </h3>
          <p className="text-xs text-slate-400 mt-1">
            Cuenta: <strong className="text-amber-400 font-mono">{user?.account_number || `WTN-2026-${String(user?.id || 1).padStart(4, '0')}`}</strong>
          </p>
        </div>

        <div className="p-3.5 bg-slate-950 rounded-2xl border border-slate-800 text-xs text-slate-300 leading-relaxed">
          <span>
            Indica el capital en USDT que deseas incorporar al pool cuantitativo gestionado por <strong>WTN Solutions LLC</strong>. Tu solicitud ingresará al panel de aprobación de la Administración.
          </span>
        </div>

        {feedback && (
          <div className={`p-3 rounded-xl border text-xs ${
            feedback.type === 'success' ? 'bg-emerald-500/15 border-emerald-500/30 text-emerald-300' : 'bg-rose-500/15 border-rose-500/30 text-rose-300'
          }`}>
            {feedback.text}
          </div>
        )}

        <form onSubmit={handleSubmit} className="space-y-4">
          <div>
            <label className="text-xs font-bold text-slate-300 block mb-1">
              Monto a Invertir (USDT):
            </label>
            <div className="relative">
              <input
                type="number"
                min="10"
                step="10"
                required
                value={amount}
                onChange={(e) => setAmount(e.target.value)}
                placeholder="Ej. 1000"
                className="w-full bg-slate-950 border border-slate-700 rounded-xl px-3.5 py-3 text-sm text-white font-mono font-bold focus:border-amber-400 focus:outline-none"
              />
              <span className="absolute right-3.5 top-3.5 text-xs text-slate-500 font-bold font-mono">USDT</span>
            </div>
          </div>

          <div className="grid grid-cols-3 gap-2">
            {[500, 1000, 5000].map((preset) => (
              <button
                key={preset}
                type="button"
                onClick={() => setAmount(String(preset))}
                className="py-1.5 bg-slate-950 hover:bg-slate-800 text-slate-300 border border-slate-800 rounded-xl text-xs font-mono font-bold transition"
              >
                ${preset}
              </button>
            ))}
          </div>

          <div className="flex gap-3 pt-2">
            <button
              type="button"
              onClick={onClose}
              className="flex-1 py-3 px-4 bg-slate-800 hover:bg-slate-700 text-slate-300 font-bold rounded-xl text-xs transition"
            >
              Cancelar
            </button>
            <button
              type="submit"
              disabled={isSubmitting}
              className="flex-1 py-3 px-4 bg-gradient-to-r from-amber-400 to-amber-500 hover:from-amber-300 hover:to-amber-400 text-slate-950 font-black rounded-xl text-xs uppercase tracking-wider transition shadow-lg shadow-amber-500/25 flex items-center justify-center gap-2"
            >
              {isSubmitting ? (
                <div className="w-4 h-4 border-2 border-slate-950 border-t-transparent rounded-full animate-spin"></div>
              ) : (
                'Enviar Solicitud'
              )}
            </button>
          </div>
        </form>

      </div>
    </div>
  );
}
