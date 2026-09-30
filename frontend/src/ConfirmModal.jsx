import React, { useEffect } from 'react';

export default function ConfirmModal({
  isOpen,
  title = '¿Confirmar Acción?',
  message = '¿Está seguro de que desea realizar esta acción?',
  confirmText = 'Sí, Confirmar',
  cancelText = 'Cancelar',
  type = 'warning', // 'danger' | 'warning' | 'info' | 'success'
  onConfirm,
  onClose
}) {
  useEffect(() => {
    const handleKeyDown = (e) => {
      if (e.key === 'Escape' && isOpen && onClose) {
        onClose();
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [isOpen, onClose]);

  if (!isOpen) return null;

  const getTypeStyles = () => {
    switch (type) {
      case 'danger':
        return {
          icon: '⚠️',
          iconBg: 'bg-rose-500/15 border-rose-500/30 text-rose-400',
          btnBg: 'bg-rose-600 hover:bg-rose-500 text-white shadow-rose-600/30',
          badge: 'ACCIÓN CRÍTICA'
        };
      case 'success':
        return {
          icon: '⚡',
          iconBg: 'bg-emerald-500/15 border-emerald-500/30 text-emerald-400',
          btnBg: 'bg-emerald-500 hover:bg-emerald-400 text-slate-950 shadow-emerald-500/30 font-black',
          badge: 'ACTIVACIÓN'
        };
      case 'info':
        return {
          icon: 'ℹ️',
          iconBg: 'bg-sky-500/15 border-sky-500/30 text-sky-400',
          btnBg: 'bg-sky-500 hover:bg-sky-400 text-slate-950 shadow-sky-500/30 font-black',
          badge: 'INFORMACIÓN'
        };
      case 'warning':
      default:
        return {
          icon: '🛡️',
          iconBg: 'bg-amber-500/15 border-amber-500/30 text-amber-400',
          btnBg: 'bg-amber-400 hover:bg-amber-300 text-slate-950 shadow-amber-400/30 font-black',
          badge: 'CONFIRMACIÓN DE SEGURIDAD'
        };
    }
  };

  const style = getTypeStyles();

  return (
    <div className="fixed inset-0 z-[100] flex items-center justify-center p-4 bg-slate-950/80 backdrop-blur-md animate-in fade-in duration-150">
      <div className="bg-slate-900 border border-slate-700/80 rounded-3xl max-w-md w-full p-6 shadow-2xl space-y-5 relative overflow-hidden animate-in zoom-in-95 duration-150">
        
        {/* Glow de Fondo */}
        <div className="absolute top-0 right-0 -mt-10 -mr-10 w-48 h-48 bg-amber-500/10 rounded-full blur-2xl pointer-events-none"></div>

        {/* Encabezado */}
        <div className="flex items-start gap-4">
          <div className={`w-12 h-12 rounded-2xl border flex items-center justify-center text-2xl flex-shrink-0 shadow-inner ${style.iconBg}`}>
            {style.icon}
          </div>
          <div className="flex-1 min-w-0">
            <span className="text-[10px] font-black tracking-wider uppercase text-amber-400 bg-amber-400/10 px-2 py-0.5 rounded border border-amber-400/20">
              {style.badge}
            </span>
            <h3 className="text-lg font-black text-white tracking-tight mt-1">
              {title}
            </h3>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="text-slate-400 hover:text-white text-lg font-bold p-1 rounded-lg hover:bg-slate-800 transition"
          >
            ✕
          </button>
        </div>

        {/* Mensaje de Confirmación */}
        <div className="bg-slate-950/80 p-4 rounded-2xl border border-slate-800 text-xs text-slate-300 leading-relaxed">
          {message}
        </div>

        {/* Botones de Acción */}
        <div className="flex gap-3 pt-2">
          <button
            type="button"
            onClick={onClose}
            className="flex-1 py-3 px-4 bg-slate-800 hover:bg-slate-700 text-slate-300 hover:text-white rounded-xl text-xs font-bold transition border border-slate-700"
          >
            {cancelText}
          </button>
          <button
            type="button"
            onClick={() => {
              onConfirm();
              onClose();
            }}
            className={`flex-1 py-3 px-4 rounded-xl text-xs uppercase tracking-wider transition shadow-lg ${style.btnBg}`}
          >
            {confirmText}
          </button>
        </div>

      </div>
    </div>
  );
}
