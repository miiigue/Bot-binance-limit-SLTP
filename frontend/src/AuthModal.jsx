import React, { useState, useEffect } from 'react';
import { useAuth } from './AuthContext';
import LegalModal from './LegalModal';

export default function AuthModal({ initialMode = 'login', prefilledInvestmentAmount = '0', onClose } = {}) {
  const { needsInitialAdmin, login, register } = useAuth();

  const [mode, setMode] = useState(needsInitialAdmin ? 'setup' : (initialMode || 'login')); // 'setup', 'login', 'register', 'pending_notice'
  const [registerStep, setRegisterStep] = useState(1); // 1: Datos Personales, 2: Cuenta & Capital, 3: Aceptación Legal & Enviar
  const [username, setUsername] = useState('');
  const [email, setEmail] = useState('');
  const [country, setCountry] = useState('');
  const [city, setCity] = useState('');
  const [birthDate, setBirthDate] = useState('');
  const [investmentAmount, setInvestmentAmount] = useState(prefilledInvestmentAmount && parseFloat(prefilledInvestmentAmount) > 0 ? String(prefilledInvestmentAmount) : '0');
  const [password, setPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [referralCode, setReferralCode] = useState('');
  const [acceptedTerms, setAcceptedTerms] = useState(false);
  const [showLegalModal, setShowLegalModal] = useState(false);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [errorMessage, setErrorMessage] = useState(null);
  const [successNotice, setSuccessNotice] = useState(null);

  // Sincronizar monto si cambia externamente desde la landing page
  useEffect(() => {
    if (prefilledInvestmentAmount && parseFloat(prefilledInvestmentAmount) > 0) {
      setInvestmentAmount(String(prefilledInvestmentAmount));
    }
  }, [prefilledInvestmentAmount]);

  // Sincronizar modo si cambia desde la landing page (ej: login -> register)
  useEffect(() => {
    if (!needsInitialAdmin && initialMode) {
      setMode(initialMode);
    }
  }, [initialMode, needsInitialAdmin]);

  // Auto-detectar código de referido desde el enlace (?ref=codigo)
  useEffect(() => {
    try {
      const searchParams = new URLSearchParams(window.location.search);
      const ref = searchParams.get('ref') || searchParams.get('invitation') || searchParams.get('code');
      if (ref) {
        setReferralCode(ref.trim());
        if (mode === 'login' && !needsInitialAdmin) {
          setMode('register');
        }
      }
    } catch (e) {
      // Ignorar errores en parseo de URL
    }
  }, [mode, needsInitialAdmin]);

  // Validación por cada paso del registro
  const isStep1Valid = 
    Boolean(referralCode.trim()) &&
    Boolean(country.trim()) &&
    Boolean(city.trim()) &&
    Boolean(birthDate.trim());

  const isStep2Valid =
    Boolean(username.trim()) &&
    Boolean(email.trim()) &&
    investmentAmount !== '' &&
    !isNaN(parseFloat(investmentAmount)) &&
    parseFloat(investmentAmount) >= 0 &&
    password.length >= 6 &&
    password === confirmPassword;

  const isStep3Valid = Boolean(acceptedTerms);

  // Validación completa en tiempo real del formulario de registro
  const isRegisterFormValid = isStep1Valid && isStep2Valid && isStep3Valid;

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

    if (!username.trim() || !email.trim() || !password) {
      setErrorMessage('Todos los campos obligatorios deben ser completados.');
      return;
    }

    if (mode === 'register') {
      if (!referralCode.trim()) {
        setErrorMessage('El Código de Invitación / Referido es obligatorio para registrarse.');
        return;
      }

      if (!country.trim() || !city.trim() || !birthDate.trim()) {
        setErrorMessage('Por favor completa tu país, ciudad y fecha de nacimiento.');
        return;
      }

      const parsedAmount = parseFloat(investmentAmount);
      if (investmentAmount === '' || isNaN(parsedAmount) || parsedAmount < 0) {
        setErrorMessage('Por favor ingresa un monto válido igual o mayor a 0 USDT.');
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

    if (!acceptedTerms) {
      setErrorMessage('Debes aceptar los Términos de Servicio y el Descargo de Riesgo para registrarte.');
      return;
    }

    setIsSubmitting(true);
    try {
      const res = await register(
        username.trim(), 
        email.trim(), 
        password,
        mode === 'register' ? (parseFloat(investmentAmount) || 0) : 0,
        country.trim(),
        city.trim(),
        birthDate.trim(),
        referralCode.trim()
      );
      if (res.pending_approval) {
        setSuccessNotice('Tu solicitud de cuenta ha sido registrada con éxito. Está en espera de aprobación por el Administrador.');
        setMode('pending_notice');
      }
    } catch (err) {
      setErrorMessage(err.message || 'Error al procesar el registro.');
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <div 
      className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-950/85 backdrop-blur-md overflow-y-auto"
      onClick={(e) => {
        if (e.target === e.currentTarget && onClose) {
          onClose();
        }
      }}
    >
      <div className="relative w-full max-w-md bg-slate-900 border border-slate-700/80 rounded-3xl shadow-2xl shadow-cyan-500/10 p-6 sm:p-8 text-white">
        
        {/* Botón Cerrar (Volver a la Landing Page) */}
        {onClose && (
          <button
            type="button"
            onClick={onClose}
            className="absolute top-5 right-5 w-8 h-8 rounded-full bg-slate-800 hover:bg-slate-700 text-slate-400 hover:text-white flex items-center justify-center transition border border-slate-700 text-sm font-bold z-10"
            title="Cerrar y volver a la página principal"
          >
            ✕
          </button>
        )}
        
        {/* Encabezado con Logo y Título */}
        <div className="text-center mb-6">
          <div className="inline-flex items-center justify-center w-16 h-16 rounded-2xl bg-amber-400/10 border border-amber-400/30 text-3xl shadow-inner mb-3">
            <span>⚡</span>
          </div>
          <h2 className="text-2xl font-black tracking-tight text-white">
            WTN ALGO-TRADING
          </h2>
          <div className="text-xs font-bold text-amber-400 uppercase tracking-widest mt-0.5">
            Institutional Trading Division
          </div>
          <p className="text-[11px] text-slate-400 mt-1 font-medium">
            WTN Solutions LLC • Asset Management & Pool
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

            {/* FORMULARIO REGISTRO INVERSIONISTA EN 3 PASOS */}
            {mode === 'register' && (
              <form onSubmit={handleRegisterSubmit} className="space-y-4">
                
                {/* STEPPER PROFESIONAL INSTITUCIONAL */}
                <div className="bg-slate-950 p-3 rounded-2xl border border-slate-800">
                  <div className="flex items-center justify-between text-xs font-mono mb-2">
                    <span className="font-bold text-amber-400 uppercase tracking-wider">
                      Paso {registerStep} de 3
                    </span>
                    <span className="text-[11px] text-slate-400 font-sans">
                      {registerStep === 1 && '1. Invitación y Residencia'}
                      {registerStep === 2 && '2. Cuenta y Capital'}
                      {registerStep === 3 && '3. Conformidad Legal'}
                    </span>
                  </div>
                  {/* Barra de Progreso */}
                  <div className="w-full h-1.5 bg-slate-800 rounded-full overflow-hidden flex">
                    <div 
                      className="bg-gradient-to-r from-amber-400 to-amber-500 h-full transition-all duration-300 ease-out"
                      style={{ width: `${(registerStep / 3) * 100}%` }}
                    />
                  </div>
                  {/* Indicadores de Pasos */}
                  <div className="grid grid-cols-3 gap-2 mt-2.5 text-center">
                    <button
                      type="button"
                      onClick={() => setRegisterStep(1)}
                      className={`text-[10px] font-bold py-1 rounded-lg transition ${
                        registerStep === 1
                          ? 'bg-amber-400/20 text-amber-300 border border-amber-400/40'
                          : isStep1Valid ? 'text-emerald-400 hover:text-white' : 'text-slate-500'
                      }`}
                    >
                      {isStep1Valid && registerStep > 1 ? '✓ ' : ''}Invitación
                    </button>
                    <button
                      type="button"
                      onClick={() => { if (isStep1Valid) setRegisterStep(2); }}
                      disabled={!isStep1Valid}
                      className={`text-[10px] font-bold py-1 rounded-lg transition disabled:cursor-not-allowed ${
                        registerStep === 2
                          ? 'bg-amber-400/20 text-amber-300 border border-amber-400/40'
                          : isStep2Valid && registerStep > 2 ? 'text-emerald-400 hover:text-white' : 'text-slate-500'
                      }`}
                    >
                      {isStep2Valid && registerStep > 2 ? '✓ ' : ''}Cuenta
                    </button>
                    <button
                      type="button"
                      onClick={() => { if (isStep1Valid && isStep2Valid) setRegisterStep(3); }}
                      disabled={!isStep1Valid || !isStep2Valid}
                      className={`text-[10px] font-bold py-1 rounded-lg transition disabled:cursor-not-allowed ${
                        registerStep === 3
                          ? 'bg-amber-400/20 text-amber-300 border border-amber-400/40'
                          : isStep3Valid ? 'text-emerald-400' : 'text-slate-500'
                      }`}
                    >
                      Términos
                    </button>
                  </div>
                </div>

                {/* =========================================================================
                    PASO 1: CÓDIGO DE INVITACIÓN & RESIDENCIA
                   ========================================================================= */}
                {registerStep === 1 && (
                  <div className="space-y-3.5 animate-fadeIn">
                    <div className="p-3 bg-slate-950/60 border border-slate-800 rounded-xl text-xs text-slate-400 leading-relaxed">
                      <span>💼</span> Acceso exclusivo: Ingresa el código de invitación de quien te refirió y tus datos de residencia para verificar tu elegibilidad.
                    </div>

                    {/* Código de Invitación / Referido Obligatorio */}
                    <div className="p-3 bg-amber-400/10 border border-amber-400/30 rounded-xl">
                      <div className="flex items-center justify-between mb-1">
                        <label className="block text-xs font-black text-amber-300">
                          Código de Invitación / Referido *
                        </label>
                        <span className="text-[10px] bg-amber-400 text-slate-950 font-bold px-1.5 py-0.2 rounded font-mono">
                          REQUERIDO
                        </span>
                      </div>
                      <input
                        type="text"
                        required
                        value={referralCode}
                        onChange={(e) => setReferralCode(e.target.value)}
                        placeholder="Usuario de quien te invitó"
                        className="w-full px-3.5 py-2.5 bg-slate-950 border border-amber-400/50 rounded-xl text-sm font-mono font-bold text-white focus:outline-none focus:border-amber-400 focus:ring-1 focus:ring-amber-400 transition"
                      />
                      <p className="text-[10px] text-amber-200/80 mt-1">
                        Solo pueden solicitar cuenta usuarios referidos formalmente por un miembro activo.
                      </p>
                    </div>

                    <div className="grid grid-cols-2 gap-3">
                      <div>
                        <label className="block text-xs font-bold text-slate-300 mb-1">País de Residencia *</label>
                        <input
                          type="text"
                          required
                          value={country}
                          onChange={(e) => setCountry(e.target.value)}
                          placeholder="ej: México"
                          className="w-full px-3.5 py-2.5 bg-slate-950 border border-slate-700 rounded-xl text-sm text-white focus:outline-none focus:border-amber-400 focus:ring-1 focus:ring-amber-400 transition"
                        />
                      </div>
                      <div>
                        <label className="block text-xs font-bold text-slate-300 mb-1">Ciudad *</label>
                        <input
                          type="text"
                          required
                          value={city}
                          onChange={(e) => setCity(e.target.value)}
                          placeholder="ej: CDMX"
                          className="w-full px-3.5 py-2.5 bg-slate-950 border border-slate-700 rounded-xl text-sm text-white focus:outline-none focus:border-amber-400 focus:ring-1 focus:ring-amber-400 transition"
                        />
                      </div>
                    </div>

                    <div>
                      <label className="block text-xs font-bold text-slate-300 mb-1">Fecha de Nacimiento *</label>
                      <input
                        type="date"
                        required
                        value={birthDate}
                        onChange={(e) => setBirthDate(e.target.value)}
                        className="w-full px-3.5 py-2.5 bg-slate-950 border border-slate-700 rounded-xl text-sm text-white focus:outline-none focus:border-amber-400 focus:ring-1 focus:ring-amber-400 transition"
                      />
                      <p className="text-[10px] text-slate-400 mt-1">
                        Debes ser mayor de 18 años para operar en mercados de derivados.
                      </p>
                    </div>

                    <button
                      type="button"
                      disabled={!isStep1Valid}
                      onClick={() => { setErrorMessage(null); setRegisterStep(2); }}
                      className="w-full mt-3 py-3 bg-gradient-to-r from-amber-400 to-amber-500 hover:from-amber-300 hover:to-amber-400 text-slate-950 font-black text-sm rounded-xl shadow-lg shadow-amber-500/20 transition-all flex items-center justify-center gap-2 disabled:opacity-40 disabled:cursor-not-allowed"
                    >
                      <span>Siguiente: Datos de Cuenta</span>
                      <span>→</span>
                    </button>
                  </div>
                )}

                {/* =========================================================================
                    PASO 2: CREDENCIALES & CAPITAL ESTIMADO
                   ========================================================================= */}
                {registerStep === 2 && (
                  <div className="space-y-3.5 animate-fadeIn">
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
                          Monto Inicial que vas a Invertir *
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
                          min="0"
                          required
                          value={investmentAmount}
                          onChange={(e) => setInvestmentAmount(e.target.value)}
                          placeholder="0"
                          className="w-full pl-8 pr-16 py-2.5 bg-slate-950 border border-slate-700 rounded-xl text-sm font-mono font-bold text-white focus:outline-none focus:border-amber-400 focus:ring-1 focus:ring-amber-400 transition"
                        />
                        <div className="absolute inset-y-0 right-0 pr-3.5 flex items-center pointer-events-none text-xs font-bold text-slate-400">
                          USDT
                        </div>
                      </div>
                      <p className="text-[10px] text-slate-400 mt-1">
                        Puedes colocar 0 si solo deseas solicitar la apertura de cuenta sin fondear capital de inmediato.
                      </p>
                    </div>

                    <div>
                      <label className="block text-xs font-bold text-slate-300 mb-1">Contraseña de Acceso *</label>
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
                      {confirmPassword !== '' && confirmPassword !== password && (
                        <p className="text-[11px] text-rose-400 mt-1 font-semibold flex items-center gap-1">
                          <span>⚠️</span> Las contraseñas no coinciden.
                        </p>
                      )}
                      {confirmPassword !== '' && confirmPassword === password && password.length >= 6 && (
                        <p className="text-[11px] text-emerald-400 mt-1 font-semibold flex items-center gap-1">
                          <span>✓</span> Las contraseñas coinciden correctamente.
                        </p>
                      )}
                    </div>

                    <div className="flex items-center gap-3 pt-2">
                      <button
                        type="button"
                        onClick={() => { setErrorMessage(null); setRegisterStep(1); }}
                        className="w-1/3 py-2.5 bg-slate-800 hover:bg-slate-700 text-slate-300 hover:text-white font-bold text-xs rounded-xl transition"
                      >
                        ← Volver
                      </button>
                      <button
                        type="button"
                        disabled={!isStep2Valid}
                        onClick={() => { setErrorMessage(null); setRegisterStep(3); }}
                        className="w-2/3 py-2.5 bg-gradient-to-r from-amber-400 to-amber-500 hover:from-amber-300 hover:to-amber-400 text-slate-950 font-black text-xs rounded-xl shadow-lg shadow-amber-500/20 transition flex items-center justify-center gap-1.5 disabled:opacity-40 disabled:cursor-not-allowed"
                      >
                        <span>Siguiente: Términos y Enviar</span>
                        <span>→</span>
                      </button>
                    </div>
                  </div>
                )}

                {/* =========================================================================
                    PASO 3: TÉRMINOS LEGALES, DESCARGO DE RIESGO & ENVIAR
                   ========================================================================= */}
                {registerStep === 3 && (
                  <div className="space-y-4 animate-fadeIn">
                    
                    {/* Tarjeta de Resumen Rápido de Solicitud */}
                    <div className="p-3 bg-slate-950/70 border border-slate-800 rounded-xl text-xs space-y-1.5">
                      <div className="text-[11px] font-bold text-amber-400 uppercase tracking-wider mb-1 flex items-center justify-between">
                        <span>📋 Resumen de tu Solicitud</span>
                        <span className="text-slate-400 font-mono text-[10px]">Paso 3 de 3</span>
                      </div>
                      <div className="flex justify-between text-slate-300">
                        <span className="text-slate-400">Usuario:</span>
                        <span className="font-mono text-white font-semibold">{username}</span>
                      </div>
                      <div className="flex justify-between text-slate-300">
                        <span className="text-slate-400">Correo:</span>
                        <span className="text-slate-200">{email}</span>
                      </div>
                      <div className="flex justify-between text-slate-300">
                        <span className="text-slate-400">Ubicación:</span>
                        <span className="text-slate-200">{city}, {country}</span>
                      </div>
                      <div className="flex justify-between text-slate-300">
                        <span className="text-slate-400">Invitado por:</span>
                        <span className="font-mono text-amber-300 font-bold">{referralCode}</span>
                      </div>
                      <div className="flex justify-between text-slate-300 pt-1 border-t border-slate-800">
                        <span className="text-slate-400">Capital Inicial:</span>
                        <span className="font-mono text-emerald-400 font-bold">
                          ${parseFloat(investmentAmount || 0).toLocaleString('en-US', { minimumFractionDigits: 2 })} USDT
                        </span>
                      </div>
                    </div>

                    {/* Resumen de los 4 Títulos Institucionales de Términos */}
                    <div className="space-y-2 p-3.5 bg-slate-950/90 border border-cyan-500/30 rounded-2xl">
                      <div className="flex items-center justify-between">
                        <span className="text-xs font-black text-white flex items-center gap-1.5">
                          <span>⚖️</span> TÍTULOS DE ACEPTACIÓN LEGAL
                        </span>
                        <button
                          type="button"
                          onClick={() => setShowLegalModal(true)}
                          className="text-[11px] text-cyan-400 hover:text-cyan-300 underline font-bold"
                        >
                          Ver documento completo
                        </button>
                      </div>

                      <div className="space-y-2 pt-1 text-[11px] text-slate-300">
                        <div className="p-2 rounded-lg bg-slate-900 border border-slate-800">
                          <strong className="text-amber-300 block mb-0.5">1. Carácter Privado y Restringido por Invitación</strong>
                          <p className="text-[10px] text-slate-400 leading-tight">
                            El acceso se otorga bajo invitación confidencial. No constituye oferta pública de valores ni captación abierta.
                          </p>
                        </div>
                        <div className="p-2 rounded-lg bg-slate-900 border border-slate-800">
                          <strong className="text-amber-300 block mb-0.5">2. Naturaleza Tecnológica de la Herramienta</strong>
                          <p className="text-[10px] text-slate-400 leading-tight">
                            WTN Solutions LLC provee licenciamiento de software y automatización. No constituye asesoría financiera individualizada.
                          </p>
                        </div>
                        <div className="p-2 rounded-lg bg-slate-900 border border-slate-800">
                          <strong className="text-amber-300 block mb-0.5">3. Declaración de Riesgo en Mercado de Futuros</strong>
                          <p className="text-[10px] text-slate-400 leading-tight">
                            El trading de derivados conlleva riesgo sustancial de capital. Rendimientos pasados o estimados no garantizan resultados futuros.
                          </p>
                        </div>
                        <div className="p-2 rounded-lg bg-slate-900 border border-slate-800">
                          <strong className="text-amber-300 block mb-0.5">4. Autocustodia y Responsabilidad de Credenciales</strong>
                          <p className="text-[10px] text-slate-400 leading-tight">
                            El cliente mantiene la titularidad de su cuenta y garantiza que los fondos provienen de orígenes lícitos.
                          </p>
                        </div>
                      </div>
                    </div>

                    {/* Checkbox de Conformidad */}
                    <div className="pt-1">
                      <label className="flex items-start gap-2.5 cursor-pointer group p-2.5 bg-amber-400/10 border border-amber-400/30 rounded-xl">
                        <input
                          type="checkbox"
                          checked={acceptedTerms}
                          onChange={(e) => setAcceptedTerms(e.target.checked)}
                          className="mt-0.5 w-4 h-4 rounded border-slate-700 bg-slate-950 text-amber-400 focus:ring-amber-400 accent-amber-400 cursor-pointer"
                        />
                        <span className="text-[11px] text-slate-200 leading-snug">
                          He leído, comprendo y acepto los <strong className="text-amber-300">Términos de Servicio</strong> y el <strong className="text-amber-300">Descargo de Responsabilidad de Riesgo</strong> institucionales para dar de alta mi cuenta.
                        </span>
                      </label>
                    </div>

                    {/* Botones de Navegación Final */}
                    <div className="flex items-center gap-3 pt-1">
                      <button
                        type="button"
                        onClick={() => { setErrorMessage(null); setRegisterStep(2); }}
                        className="w-1/3 py-3 bg-slate-800 hover:bg-slate-700 text-slate-300 hover:text-white font-bold text-xs rounded-xl transition"
                      >
                        ← Volver
                      </button>
                      <button
                        type="submit"
                        disabled={isSubmitting || !isRegisterFormValid}
                        className="w-2/3 py-3 bg-gradient-to-r from-emerald-500 to-emerald-600 hover:from-emerald-400 hover:to-emerald-500 text-white font-black text-xs sm:text-sm rounded-xl shadow-lg shadow-emerald-500/20 transition-all flex items-center justify-center gap-2 disabled:opacity-40 disabled:cursor-not-allowed"
                      >
                        {isSubmitting ? (
                          <>
                            <span className="w-4 h-4 border-2 border-white border-t-transparent rounded-full animate-spin"></span>
                            Enviando Solicitud...
                          </>
                        ) : (
                          <>
                            <span>🚀</span> Enviar Solicitud de Cuenta
                          </>
                        )}
                      </button>
                    </div>

                  </div>
                )}

              </form>
            )}
          </div>
        )}

        <LegalModal
          isOpen={showLegalModal}
          onClose={() => setShowLegalModal(false)}
        />

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
