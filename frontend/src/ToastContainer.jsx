import React from 'react';

function ToastContainer({ toasts = [], onDismiss }) {
  if (!toasts || toasts.length === 0) return null;

  return (
    <div className="fixed bottom-5 right-5 z-50 flex flex-col space-y-2.5 max-w-sm w-full pointer-events-none">
      {toasts.map((toast) => {
        const isSuccess = toast.type === 'success';
        const isError = toast.type === 'error';
        const isWarning = toast.type === 'warning';
        const isInfo = !isSuccess && !isError && !isWarning;

        return (
          <div
            key={toast.id}
            className={`pointer-events-auto p-4 rounded-xl shadow-2xl border backdrop-blur-md transition-all transform animate-in slide-in-from-right-5 duration-300 flex items-start justify-between gap-3 ${
              isSuccess
                ? 'bg-emerald-950/90 border-emerald-500/50 text-emerald-100'
                : isError
                ? 'bg-rose-950/90 border-rose-500/50 text-rose-100'
                : isWarning
                ? 'bg-amber-950/90 border-amber-500/50 text-amber-100'
                : 'bg-gray-900/90 border-gray-700 text-gray-100'
            }`}
          >
            <div className="flex items-start space-x-3">
              <span className="text-xl flex-shrink-0">
                {isSuccess ? '🎉' : isError ? '🛑' : isWarning ? '🛡️' : 'ℹ️'}
              </span>
              <div>
                {toast.title && (
                  <h4 className="font-bold text-sm leading-tight mb-0.5">{toast.title}</h4>
                )}
                <p className="text-xs text-gray-300 leading-snug">{toast.message}</p>
                {toast.time && (
                  <span className="text-[10px] text-gray-400 block mt-1 font-mono">{toast.time}</span>
                )}
              </div>
            </div>

            <button
              type="button"
              onClick={() => onDismiss(toast.id)}
              className="text-gray-400 hover:text-white text-xs p-1 rounded transition"
            >
              ✕
            </button>
          </div>
        );
      })}
    </div>
  );
}

export default ToastContainer;
