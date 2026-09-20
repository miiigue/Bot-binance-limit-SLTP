import React, { useState } from 'react';
import { useAuth } from './AuthContext';

export default function AuthModal() {
  const { needsInitialAdmin, login, register } = useAuth();

  const [mode, setMode] = useState(needsInitialAdmin ? 'setup' : 'login'); // 'setup', 'login', 'register', 'pending_notice'
  const [username, setUsername] = useState('');
  const [email, setEmail] = useState('');
  const [investmentAmount, setInvestmentAmount] = useState('');
  const [password, setPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [errorMessage, setErrorMessage] = useState(null);
  const [successNotice, setSuccessNotice] = useState(null);

  const handleLoginSubmit = async (e) => {
    e.preventDefault();
    setErrorMessage(null);
    if (!username.trim() || !password) {
      setErrorMessage('Por favor ingresa tu usuario/correo y contraseña.');
      return;
    }

    setIsSubmitting(true);
    try {
      await login(username.trim(), password);
    } catch (err) {
      setErrorMessage(err.message || 'Error al iniciar sesión.');
    } finally {
      setIsSubmitting(false);
    }
  };

  const handleRegisterSubmit = async (e) => {
    e.preventDefault();
    setErrorMessage(null);

    if (!username.trim() || !password) {
      setErrorMessage('Todos los campos obligatorios deben ser completados.');
      return;
    }

    if (mode === 'register') {
      const parsedAmount = parseFloat(investmentAmount);
      if (!investmentAmount || isNaN(parsedAmount) || parsedAmount <= 0) {
        setErrorMessage('Por favor ingresa un monto válido a invertir (mínimo 1 USDT).');
        return;
      }
    }

    if (password.length < 6) {
      setErrorMessage('La contraseña debe tener un mínimo de 6 caracteres.');
      return;
    }

    if (password !== confirmPassword) {
      setErrorMessage('Las contraseñas no coinciden.');
      return;
    }

    setIsSubmitting(true);
    try {
      const res = await register(
        username.trim(), 
        email.trim(), 
        password,
        mode === 'register' ? (parseFloat(investmentAmount) || 0) : 0
      );
      if (res.pending_approval) {
        setSuccessNotice('Tu solicitud de cuenta ha sido registrada con éxito. Está en espera de aprobación por el Super Administrador.');
        setMode('pending_notice');
      }
    } catch (err) {
      setErrorMessage(err.message || 'Error al procesar el registro.');
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-950/80 backdrop-blur-md overflow-y-auto">
      <div className="relative w-full max-w-md bg-slate-900 border border-slate-700/80 rounded-3xl shadow-2xl shadow-amber-500/10 p-6 sm:p-8 text-white">
        
        {/* Encabezado con Logo y Título */}
        <div className="text-center mb-6">
          <div className="inline-flex items-center justify-center w-16 h-16 rounded-2xl bg-amber-400/10 border border-amber-400/30 text-3xl shadow-inner mb-3">
            <span>⚡</span>
          </div>
          <h2 className="text-2xl font-black tracking-tight text-white">
            WTN ALGO-TRADING
          </h2>
          <div className="text-xs font-bold text-amber-400 uppercase tracking-widest mt-0.5">
            Binance Institutional Division
          </div>
          <p className="text-[11px] text-slate-400 mt-1 font-medium">
            WTN Solutions LLC • Quantitative Asset Management & Pool
          </p>
        </div>

        {/* Notificación de Error */}
        {errorMessage && (
          <div className="mb-5 p-3.5 bg-rose-500/15 border border-rose-500/40 rounded-xl text-rose-300 text-xs flex items-start gap-2 animate-shake">
            <span className="text-sm">⚠️</span>
            <div className="flex-1 font-semibold">{errorMessage}</div>
          </div>
        )}

        {/* CASO 1: Setup Inicial (Super Administrador) */}
        {(mode === 'setup' || needsInitialAdmin) && (
          <div>
            <div className="mb-4 p-3 bg-amber-500/10 border border-amber-500/30 rounded-xl">
              <div className="flex items-center gap-2 text-amber-400 text-xs font-bold uppercase tracking-wider mb-1">
                <span>👑</span> Configuración Inicial del Sistema
              </div>
              <p className="text-xs text-slate-300 leading-relaxed">
                No hay usuarios registrados. La primera cuenta que crees tendrá el rol de <strong className="text-white">Super Administrador</strong> con acceso absoluto al bot, configuraciones y mesa de inversores.
              </p>
            </div>

            <form onSubmit={handleRegisterSubmit} className="space-y-3.5">
              <div>
                <label className="block text-xs font-bold text-slate-300 mb-1">Nombre de Usuario *</label>
                <input
                  type="text"
                  required
                  value={username}
                  onChange={(e) => setUsername(e.target.value)}
                  placeholder="admin"
                  className="w-full px-3.5 py-2.5 bg-slate-950 border border-slate-700 rounded-xl text-sm text-white focus:outline-none focus:border-amber-400 focus:ring-1 focus:ring-amber-400 transition"
                />
              </div>

              <div>
                <label className="block text-xs font-bold text-slate-300 mb-1">Correo Electrónico (Opcional)</label>
                <input
                  type="email"
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  placeholder="admin@tu-dominio.com"
                  className="w-full px-3.5 py-2.5 bg-slate-950 border border-slate-700 rounded-xl text-sm text-white focus:outline-none focus:border-amber-400 focus:ring-1 focus:ring-amber-400 transition"
                />
              </div>

              <div>
                <label className="block text-xs font-bold text-slate-300 mb-1">Contraseña Maestra *</label>
                <input
                  type="password"
                  required
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  placeholder="Mínimo 6 caracteres"
                  className="w-full px-3.5 py-2.5 bg-slate-950 border border-slate-700 rounded-xl text-sm text-white focus:outline-none focus:border-amber-400 focus:ring-1 focus:ring-amber-400 transition"
                />
              </div>

              <div>
                <label className="block text-xs font-bold text-slate-300 mb-1">Confirmar Contraseña *</label>
                <input
                  type="password"
                  required
                  value={confirmPassword}
                  onChange={(e) => setConfirmPassword(e.target.value)}
                  placeholder="Repite la contraseña"
                  className="w-full px-3.5 py-2.5 bg-slate-950 border border-slate-700 rounded-xl text-sm text-white focus:outline-none focus:border-amber-400 focus:ring-1 focus:ring-amber-400 transition"
                />
              </div>

              <button
                type="submit"
                disabled={isSubmitting}
                className="w-full mt-2 py-3 bg-gradient-to-r from-amber-400 to-amber-500 hover:from-amber-300 hover:to-amber-400 text-slate-950 font-black text-sm rounded-xl shadow-lg shadow-amber-500/20 transition-all flex items-center justify-center gap-2 disabled:opacity-50"
              >
                {isSubmitting ? (
                  <>
                    <span className="w-4 h-4 border-2 border-slate-950 border-t-transparent rounded-full animate-spin"></span>
                    Creando Super Administrador...
                  </>
                ) : (
                  <>
                    <span>🚀</span> Crear Cuenta Maestra e Ingresar
                  </>
                )}
              </button>
            </form>
          </div>
        )}

        {/* CASO 2: Usuario Normal (Login o Registro de Inversionista) */}
        {!needsInitialAdmin && mode !== 'setup' && mode !== 'pending_notice' && (
          <div>
            {/* Selector de Pestañas Login / Registro */}
            <div className="flex bg-slate-950 p-1 rounded-xl mb-5 border border-slate-800">
              <button
                type="button"
                onClick={() => { setMode('login'); setErrorMessage(null); }}
                className={`flex-1 py-2 text-xs font-bold rounded-lg transition-all ${
                  mode === 'login'
                    ? 'bg-amber-400 text-slate-950 shadow'
                    : 'text-slate-400 hover:text-white'
                }`}
              >
                Iniciar Sesión
              </button>
              <button
                type="button"
                onClick={() => { setMode('register'); setErrorMessage(null); }}
                className={`flex-1 py-2 text-xs font-bold rounded-lg transition-all ${
                  mode === 'register'
                    ? 'bg-amber-400 text-slate-950 shadow'
                    : 'text-slate-400 hover:text-white'
                }`}
              >
                Solicitar Acceso Inversionista
              </button>
            </div>

            {/* FORMULARIO LOGIN */}
            {mode === 'login' && (
              <form onSubmit={handleLoginSubmit} className="space-y-4">
                <div>
                  <label className="block text-xs font-bold text-slate-300 mb-1">Usuario o Correo Electrónico</label>
                  <input
                    type="text"
                    required
                    value={username}
                    onChange={(e) => setUsername(e.target.value)}
                    placeholder="Ingresa tu usuario o email"
                    className="w-full px-3.5 py-2.5 bg-slate-950 border border-slate-700 rounded-xl text-sm text-white focus:outline-none focus:border-amber-400 focus:ring-1 focus:ring-amber-400 transition"
                  />
                </div>

                <div>
                  <label className="block text-xs font-bold text-slate-300 mb-1">Contraseña</label>
                  <input
                    type="password"
                    required
                    value={password}
                    onChange={(e) => setPassword(e.target.value)}
                    placeholder="Tu contraseña"
                    className="w-full px-3.5 py-2.5 bg-slate-950 border border-slate-700 rounded-xl text-sm text-white focus:outline-none focus:border-amber-400 focus:ring-1 focus:ring-amber-400 transition"
                  />
                </div>

                <button
                  type="submit"
                  disabled={isSubmitting}
                  className="w-full mt-2 py-3 bg-gradient-to-r from-amber-400 to-amber-500 hover:from-amber-300 hover:to-amber-400 text-slate-950 font-black text-sm rounded-xl shadow-lg shadow-amber-500/20 transition-all flex items-center justify-center gap-2 disabled:opacity-50"
                >
                  {isSubmitting ? (
                    <>
                      <span className="w-4 h-4 border-2 border-slate-950 border-t-transparent rounded-full animate-spin"></span>
                      Verificando credenciales...
                    </>
                  ) : (
                    <>
                      <span>🔑</span> Ingresar al Panel
                    </>
                  )}
                </button>
              </form>
            )}

            {/* FORMULARIO REGISTRO INVERSIONISTA */}
            {mode === 'register' && (
              <form onSubmit={handleRegisterSubmit} className="space-y-3.5">
                <div className="p-3 bg-slate-950/60 border border-slate-800 rounded-xl mb-1 text-xs text-slate-400">
                  <span>💼</span> Las cuentas de nuevos inversionistas ingresan en estado de <strong className="text-amber-300">solo lectura</strong> una vez aprobadas por el Administrador.
                </div>

                <div>
                  <label className="block text-xs font-bold text-slate-300 mb-1">Nombre de Usuario *</label>
                  <input
                    type="text"
                    required
                    value={username}
                    onChange={(e) => setUsername(e.target.value)}
                    placeholder="ej: juan_inversor"
                    className="w-full px-3.5 py-2.5 bg-slate-950 border border-slate-700 rounded-xl text-sm text-white focus:outline-none focus:border-amber-400 focus:ring-1 focus:ring-amber-400 transition"
                  />
                </div>

                <div>
                  <label className="block text-xs font-bold text-slate-300 mb-1">Correo Electrónico *</label>
                  <input
                    type="email"
                    required
                    value={email}
                    onChange={(e) => setEmail(e.target.value)}
                    placeholder="inversor@ejemplo.com"
                    className="w-full px-3.5 py-2.5 bg-slate-950 border border-slate-700 rounded-xl text-sm text-white focus:outline-none focus:border-amber-400 focus:ring-1 focus:ring-amber-400 transition"
                  />
                </div>

                <div>
                  <div className="flex items-center justify-between mb-1">
                    <label className="block text-xs font-bold text-slate-300">
                      Monto que vas a Invertir *
                    </label>
                    <span className="text-[10px] text-amber-400 font-bold uppercase tracking-wider">USDT / Dólares</span>
                  </div>
                  <div className="relative flex items-center">
                    <div className="absolute inset-y-0 left-0 pl-3.5 flex items-center pointer-events-none text-emerald-400 font-black text-sm">
                      $
                    </div>
                    <input
                      type="number"
                      step="any"
                      min="1"
                      required
                      value={investmentAmount}
                      onChange={(e) => setInvestmentAmount(e.target.value)}
                      placeholder="ej: 1000"
                      className="w-full pl-8 pr-16 py-2.5 bg-slate-950 border border-slate-700 rounded-xl text-sm font-mono font-bold text-white focus:outline-none focus:border-amber-400 focus:ring-1 focus:ring-amber-400 transition"
                    />
                    <div className="absolute inset-y-0 right-0 pr-3.5 flex items-center pointer-events-none text-xs font-bold text-slate-400">
                      USDT
                    </div>
                  </div>
                  <p className="text-[10px] text-slate-400 mt-1">
                    Capital con el que deseas ingresar al pool algorítmico institucional.
                  </p>
                </div>

                <div>
                  <label className="block text-xs font-bold text-slate-300 mb-1">Contraseña *</label>
                  <input
                    type="password"
                    required
                    value={password}
                    onChange={(e) => setPassword(e.target.value)}
                    placeholder="Mínimo 6 caracteres"
                    className="w-full px-3.5 py-2.5 bg-slate-950 border border-slate-700 rounded-xl text-sm text-white focus:outline-none focus:border-amber-400 focus:ring-1 focus:ring-amber-400 transition"
                  />
                </div>

                <div>
                  <label className="block text-xs font-bold text-slate-300 mb-1">Confirmar Contraseña *</label>
                  <input
                    type="password"
                    required
                    value={confirmPassword}
                    onChange={(e) => setConfirmPassword(e.target.value)}
                    placeholder="Repite tu contraseña"
                    className="w-full px-3.5 py-2.5 bg-slate-950 border border-slate-700 rounded-xl text-sm text-white focus:outline-none focus:border-amber-400 focus:ring-1 focus:ring-amber-400 transition"
                  />
                </div>

                <button
                  type="submit"
                  disabled={isSubmitting}
                  className="w-full mt-2 py-3 bg-gradient-to-r from-emerald-500 to-emerald-600 hover:from-emerald-400 hover:to-emerald-500 text-white font-black text-sm rounded-xl shadow-lg shadow-emerald-500/20 transition-all flex items-center justify-center gap-2 disabled:opacity-50"
                >
                  {isSubmitting ? (
                    <>
                      <span className="w-4 h-4 border-2 border-white border-t-transparent rounded-full animate-spin"></span>
                      Registrando solicitud...
                    </>
                  ) : (
                    <>
                      <span>📝</span> Solicitar Cuenta de Inversionista
                    </>
                  )}
                </button>
              </form>
            )}
          </div>
        )}

        {/* CASO 3: Aviso de Cuenta Pendiente de Aprobación */}
        {mode === 'pending_notice' && (
          <div className="text-center py-4">
            <div className="w-16 h-16 bg-emerald-500/20 text-emerald-400 border border-emerald-500/30 rounded-full flex items-center justify-center text-3xl mx-auto mb-4">
              ✓
            </div>
            <h3 className="text-lg font-bold text-white mb-2">
              ¡Solicitud Enviada Exitosamente!
            </h3>
            {investmentAmount && parseFloat(investmentAmount) > 0 && (
              <div className="inline-flex items-center gap-1.5 px-3.5 py-1.5 bg-emerald-500/15 border border-emerald-500/30 rounded-xl text-emerald-400 font-mono font-bold text-xs mb-3">
                <span>💰</span> Monto a Invertir: ${parseFloat(investmentAmount).toLocaleString('en-US', { minimumFractionDigits: 2 })} USDT
              </div>
            )}
            <p className="text-xs text-slate-300 leading-relaxed mb-6">
              {successNotice || 'Tu cuenta ha sido registrada. Por motivos de seguridad y privacidad financiera, el Super Administrador debe autorizar tu acceso y asignar tu capital aportado.'}
            </p>
            <button
              type="button"
              onClick={() => { setMode('login'); setSuccessNotice(null); }}
              className="w-full py-2.5 bg-slate-800 hover:bg-slate-700 text-white font-bold text-xs rounded-xl transition"
            >
              Volver al Inicio de Sesión
            </button>
          </div>
        )}

        {/* Pie del modal */}
        <div className="mt-6 pt-4 border-t border-slate-800 text-center text-[11px] text-slate-500">
          <div className="font-semibold text-slate-400">WTN Solutions LLC &copy; {new Date().getFullYear()} • WTN ALGO-TRADING (Binance)</div>
          <div className="text-[10px] text-slate-600 mt-1">Cifrado Militar JWT & SHA-256 • Protección Anti-Fuerza Bruta Activa</div>
        </div>
      </div>
    </div>
  );
}
