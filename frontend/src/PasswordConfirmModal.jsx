import React, { useState, useEffect } from 'react';

/**
 * PasswordConfirmModal
 * Modal de alta seguridad institucional para confirmar acciones críticas
 * solicitando la contraseña de inicio de sesión del usuario.
 */
export default function PasswordConfirmModal({
  isOpen,
  title = '🔒 Confirmación de Seguridad Requerida',
  badge = 'ACCIÓN PROTEGIDA',
  message = 'Para continuar, ingrese su contraseña de inicio de sesión:',
  confirmText = 'Confirmar y Desbloquear',
  cancelText = 'Cancelar',
  type = 'warning', // 'danger' | 'warning' | 'info'
  onConfirm, // async (password) => boolean | void
  onClose
}) {
  const [password, setPassword] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [isLoading, setIsLoading] = useState(false);
  const [errorMessage, setErrorMessage] = useState('');

  useEffect(() => {
    if (isOpen) {
      setPassword('');
      setShowPassword(false);
      setErrorMessage('');
      setIsLoading(false);
    }
  }, [isOpen]);

  useEffect(() => {
    const handleKeyDown = (e) => {
      if (e.key === 'Escape' && isOpen && !isLoading && onClose) {
        onClose();
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [isOpen, isLoading, onClose]);

  if (!isOpen) return null;

  const handleSubmit = async (e) => {
    if (e) e.preventDefault();
    if (!password.trim() || isLoading) return;

    setIsLoading(true);
    setErrorMessage('');

    try {
      if (onConfirm) {
        await onConfirm(password);
      }
    } catch (err) {
      setErrorMessage(err.message || 'Error al validar la contraseña.');
    } finally {
      setIsLoading(false);
    }
  };

  const getStyleByType = () => {
    switch (type) {
      case 'danger':
        return {
          icon: '⚠️',
          iconBg: 'bg-rose-500/15 border-rose-500/30 text-rose-400',
          btnBg: 'bg-rose-600 hover:bg-rose-500 text-white shadow-rose-600/30 font-black',
          badgeBg: 'text-rose-400 bg-rose-500/10 border-rose-500/20'
        };
      case 'info':
        return {
          icon: 'ℹ️',
          iconBg: 'bg-sky-500/15 border-sky-500/30 text-sky-400',
          btnBg: 'bg-sky-500 hover:bg-sky-400 text-slate-950 shadow-sky-500/30 font-black',
          badgeBg: 'text-sky-400 bg-sky-500/10 border-sky-500/20'
        };
      case 'warning':
      default:
        return {
          icon: '🔒',
          iconBg: 'bg-amber-500/15 border-amber-500/30 text-amber-400',
          btnBg: 'bg-gradient-to-r from-amber-400 to-amber-500 hover:from-amber-300 hover:to-amber-400 text-slate-950 shadow-amber-400/25 font-black',
          badgeBg: 'text-amber-400 bg-amber-400/10 border-amber-400/20'
        };
    }
  };

  const style = getStyleByType();

  return (
    <div className="fixed inset-0 z-[120] flex items-center justify-center p-4 bg-slate-950/85 backdrop-blur-md animate-in fade-in duration-150">
      <div className="bg-slate-900 border border-slate-700/80 rounded-3xl max-w-md w-full p-6 sm:p-7 shadow-2xl space-y-5 relative overflow-hidden animate-in zoom-in-95 duration-150">
        
        {/* Glow de Fondo */}
        <div className="absolute top-0 right-0 -mt-10 -mr-10 w-48 h-48 bg-amber-500/10 rounded-full blur-2xl pointer-events-none"></div>

        {/* Encabezado */}
        <div className="flex items-start gap-3.5">
          <div className={`w-12 h-12 rounded-2xl border flex items-center justify-center text-2xl flex-shrink-0 shadow-inner ${style.iconBg}`}>
            {style.icon}
          </div>
          <div className="flex-1 min-w-0">
            <span className={`text-[10px] font-black tracking-wider uppercase px-2 py-0.5 rounded border inline-block ${style.badgeBg}`}>
              {badge}
            </span>
            <h3 className="text-base sm:text-lg font-black text-white tracking-tight mt-1 leading-snug">
              {title}
            </h3>
          </div>
          <button
            type="button"
            onClick={onClose}
            disabled={isLoading}
            className="text-slate-400 hover:text-white text-lg font-bold p-1 rounded-lg hover:bg-slate-800 transition disabled:opacity-50"
          >
            ✕
          </button>
        </div>

        {/* Mensaje de Advertencia */}
        <div className="bg-slate-950/80 p-3.5 rounded-2xl border border-slate-800/90 text-xs text-slate-300 leading-relaxed">
          {message}
        </div>

        {/* Formulario de Contraseña */}
        <form onSubmit={handleSubmit} className="space-y-4">
          <div>
            <label className="block text-xs font-bold text-slate-300 uppercase tracking-wider mb-1.5">
              Contraseña de Inicio de Sesión:
            </label>
            <div className="relative">
              <input
                type={showPassword ? 'text' : 'password'}
                autoFocus
                disabled={isLoading}
                value={password}
                onChange={(e) => {
                  setPassword(e.target.value);
                  if (errorMessage) setErrorMessage('');
                }}
                placeholder="Ingresa tu clave actual..."
                className="w-full py-2.5 pl-3.5 pr-11 bg-slate-950 border border-slate-700 focus:border-amber-400 rounded-xl text-sm font-medium text-white outline-none transition shadow-inner placeholder:text-slate-500"
              />
              <button
                type="button"
                tabIndex={-1}
                onClick={() => setShowPassword(prev => !prev)}
                className="absolute right-3 top-2.5 text-slate-400 hover:text-slate-200 text-sm transition"
              >
                {showPassword ? '🙈' : '👁️'}
              </button>
            </div>
            {errorMessage && (
              <p className="mt-2 text-xs text-rose-400 font-semibold flex items-center gap-1.5 animate-fadeIn">
                <span>⚠️</span>
                <span>{errorMessage}</span>
              </p>
            )}
          </div>

          {/* Botones de Acción */}
          <div className="flex gap-3 pt-2">
            <button
              type="button"
              disabled={isLoading}
              onClick={onClose}
              className="flex-1 py-3 px-4 bg-slate-800 hover:bg-slate-700 text-slate-300 hover:text-white rounded-xl text-xs font-bold transition border border-slate-700 disabled:opacity-50"
            >
              {cancelText}
            </button>
            <button
              type="submit"
              disabled={!password.trim() || isLoading}
              className={`flex-1 py-3 px-4 rounded-xl text-xs uppercase tracking-wider transition shadow-lg flex items-center justify-center gap-2 disabled:opacity-50 disabled:cursor-not-allowed ${style.btnBg}`}
            >
              {isLoading ? (
                <>
                  <div className="w-3.5 h-3.5 border-2 border-current border-t-transparent rounded-full animate-spin"></div>
                  <span>Verificando...</span>
                </>
              ) : (
                <span>{confirmText}</span>
              )}
            </button>
          </div>
        </form>

      </div>
    </div>
  );
}
