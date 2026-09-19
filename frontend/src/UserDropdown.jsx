import React, { useState, useEffect, useRef } from 'react';

export default function UserDropdown({
  user,
  isAdmin,
  isInvestor,
  logout,
  soundOn,
  handleToggleSound,
  deferredPrompt,
  onTriggerInstall
}) {
  const [isOpen, setIsOpen] = useState(false);
  const [copiedAccount, setCopiedAccount] = useState(false);
  const [isStandalone, setIsStandalone] = useState(false);
  const [desktopDownloadToast, setDesktopDownloadToast] = useState(false);
  const dropdownRef = useRef(null);

  // Detectar si la app ya corre en modo standalone instalado
  useEffect(() => {
    const isRunningStandalone =
      window.matchMedia('(display-mode: standalone)').matches ||
      window.navigator.standalone === true;
    setIsStandalone(isRunningStandalone);
  }, []);

  // Cerrar el menú al hacer clic fuera o presionar Escape
  useEffect(() => {
    function handleClickOutside(event) {
      if (dropdownRef.current && !dropdownRef.current.contains(event.target)) {
        setIsOpen(false);
      }
    }
    function handleKeyDown(event) {
      if (event.key === 'Escape') {
        setIsOpen(false);
      }
    }
    if (isOpen) {
      document.addEventListener('mousedown', handleClickOutside);
      document.addEventListener('touchstart', handleClickOutside);
      document.addEventListener('keydown', handleKeyDown);
    }
    return () => {
      document.removeEventListener('mousedown', handleClickOutside);
      document.removeEventListener('touchstart', handleClickOutside);
      document.removeEventListener('keydown', handleKeyDown);
    };
  }, [isOpen]);

  const accountNumber = user?.account_number || (isAdmin ? 'WTN-2026-ADMIN' : `WTN-2026-${String(user?.id || 1).padStart(4, '0')}`);
  const supportEmail = 'soporte@wtnsolutions.com';

  const handleCopyAccount = (e) => {
    e.stopPropagation();
    navigator.clipboard.writeText(accountNumber);
    setCopiedAccount(true);
    setTimeout(() => setCopiedAccount(false), 2000);
  };

  // Descarga exclusiva para PC de escritorio si el navegador no tiene instalador nativo
  const triggerDesktopDownload = () => {
    const currentOrigin = (window.location.origin || 'https://178.105.192.140.sslip.io').replace('http:', 'https:');

    // 1. Script BAT para iniciar en ventana independiente de app nativa sin barras de navegador
    const batContent = `@echo off\r\n` +
      `title WTN ALGO-TRADING (Binance) - WTN Solutions LLC\r\n` +
      `echo ==================================================================\r\n` +
      `echo        WTN ALGO-TRADING (Binance) - WTN Solutions LLC\r\n` +
      `echo ==================================================================\r\n` +
      `echo Iniciando aplicacion de escritorio...\r\n` +
      `start msedge --app="${currentOrigin}" --window-size=1440,900 || start chrome --app="${currentOrigin}" --window-size=1440,900 || start ${currentOrigin}\r\n` +
      `exit\r\n`;

    const blobBat = new Blob([batContent], { type: 'application/x-bat' });
    const batUrl = URL.createObjectURL(blobBat);
    const batLink = document.createElement('a');
    batLink.href = batUrl;
    batLink.download = 'WTN-ALGO-TRADING-Desktop.bat';
    document.body.appendChild(batLink);
    batLink.click();
    document.body.removeChild(batLink);
    URL.revokeObjectURL(batUrl);

    // 2. Acceso directo .url para Windows
    const urlContent = `[InternetShortcut]\r\nURL=${currentOrigin}/\r\nIconIndex=0\r\nIconFile=${currentOrigin}/favicon.ico\r\n`;
    const blobUrl = new Blob([urlContent], { type: 'application/internet-shortcut' });
    const urlUrl = URL.createObjectURL(blobUrl);
    const urlLink = document.createElement('a');
    urlLink.href = urlUrl;
    urlLink.download = 'WTN-ALGO-TRADING.url';
    document.body.appendChild(urlLink);
    urlLink.click();
    document.body.removeChild(urlLink);
    URL.revokeObjectURL(urlUrl);

    setDesktopDownloadToast(true);
    setTimeout(() => setDesktopDownloadToast(false), 5000);
  };

  // Manejar instalación de la aplicación
  const handleInstallClick = async () => {
    setIsOpen(false);
    if (isStandalone) {
      alert('La aplicación WTN ALGO-TRADING ya se encuentra instalada en este dispositivo.');
      return;
    }

    const promptEvent = window.__wtn_install_prompt || deferredPrompt;

    // 1. Si el navegador tiene listo el prompt nativo de instalación (Android / Chrome / Edge)
    if (promptEvent) {
      try {
        await promptEvent.prompt();
        const choice = await promptEvent.userChoice;
        if (choice && choice.outcome === 'accepted') {
          console.log('[WTN] Instalación nativa aceptada.');
          setIsStandalone(true);
        }
        window.__wtn_install_prompt = null;
        if (onTriggerInstall) onTriggerInstall();
      } catch (err) {
        console.warn('Error al invocar prompt de instalación:', err);
      }
      return;
    }

    // 2. Si el prompt no está disponible inmediatamente (ej: iOS o móvil con prompt pendiente)
    const userAgent = (navigator.userAgent || '').toLowerCase();
    const isApple = /iphone|ipad|ipod/.test(userAgent) || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);
    const isMobile = /android|iphone|ipad|ipod|mobile/.test(userAgent);

    if (isApple) {
      alert('En iPhone/iPad: Presiona el botón Compartir 📤 en la barra de Safari y selecciona "Agregar a pantalla de inicio" 📲 para instalar.');
      return;
    }

    if (isMobile) {
      alert('Para instalar en tu teléfono: Toca el menú (tres puntos ⋮) en Chrome y presiona "Instalar aplicación" para colocarla en tu pantalla de inicio.');
      return;
    }

    // 3. Únicamente en computadoras de escritorio (Windows / PC): descargar lanzador
    triggerDesktopDownload();
  };

  // Manejar apertura de correo de soporte
  const handleContactSupport = () => {
    setIsOpen(false);
    const subject = encodeURIComponent(`Consulta WTN Trading - Cuenta ${accountNumber} (${user?.username || 'Usuario'})`);
    const body = encodeURIComponent(
      `Estimado equipo de WTN Solutions LLC,\n\n` +
      `Titular: ${user?.username || 'Inversionista'}\n` +
      `Número de Cuenta: ${accountNumber}\n` +
      `Correo Registrado: ${user?.email || 'N/A'}\n` +
      `Fecha: ${new Date().toLocaleDateString('es-ES')}\n\n` +
      `Detalle de mi consulta / requerimiento:\n\n`
    );
    window.location.href = `mailto:${supportEmail}?subject=${subject}&body=${body}`;
  };

  return (
    <div className="relative inline-block text-left" ref={dropdownRef}>
      {/* Botón Disparador del Menú */}
      <button
        type="button"
        onClick={() => setIsOpen(!isOpen)}
        className="flex items-center gap-1.5 sm:gap-2 bg-slate-950 hover:bg-slate-900 border border-slate-800 hover:border-amber-500/50 px-2 sm:px-3 py-1 rounded-xl shadow-md transition-all duration-150 focus:outline-none focus:ring-2 focus:ring-amber-400/50 select-none group"
        aria-expanded={isOpen}
        aria-haspopup="true"
      >
        {/* Avatar Circular */}
        <div className="w-6 h-6 sm:w-7 sm:h-7 rounded-lg bg-gradient-to-br from-amber-400 to-amber-600 flex items-center justify-center text-slate-950 font-black text-xs shadow-inner">
          {isAdmin ? '👑' : (user?.username?.[0]?.toUpperCase() || '💼')}
        </div>

        {/* Info Usuario */}
        <div className="flex flex-col text-left min-w-0">
          <div className="flex items-center gap-1">
            <span className="text-xs font-bold text-white max-w-[85px] sm:max-w-[120px] truncate group-hover:text-amber-300 transition-colors">
              {user?.username || 'Usuario'}
            </span>
          </div>
          {accountNumber && (
            <span className="hidden sm:inline-block text-[9px] font-mono font-bold text-amber-400 -mt-0.5">
              {accountNumber}
            </span>
          )}
        </div>

        {/* Badge de Rol */}
        <span className={`text-[9px] font-extrabold px-1.5 py-0.5 rounded-md uppercase tracking-wider hidden xs:inline-block ${
          isAdmin 
            ? 'bg-amber-400 text-slate-950' 
            : 'bg-cyan-500/20 text-cyan-300 border border-cyan-500/40'
        }`}>
          {isAdmin ? 'Admin' : 'Inversor'}
        </span>

        {/* Flecha Chevron */}
        <svg
          className={`w-3.5 h-3.5 text-slate-400 transition-transform duration-200 group-hover:text-amber-400 ${isOpen ? 'rotate-180 text-amber-400' : ''}`}
          fill="none"
          stroke="currentColor"
          viewBox="0 0 24 24"
        >
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2.5" d="M19 9l-7 7-7-7" />
        </svg>
      </button>

      {/* Menú Desplegable Flotante */}
      {isOpen && (
        <div className="absolute right-0 mt-2 w-72 sm:w-80 rounded-2xl bg-slate-900 border border-slate-700/80 shadow-2xl z-50 overflow-hidden backdrop-blur-xl animate-in fade-in zoom-in-95 duration-150">
          
          {/* Encabezado del Perfil */}
          <div className="p-4 bg-gradient-to-b from-slate-800/90 to-slate-900 border-b border-slate-700/70">
            <div className="flex items-center gap-3">
              <div className="w-11 h-11 rounded-xl bg-gradient-to-br from-amber-400 via-amber-500 to-amber-600 flex items-center justify-center text-slate-950 font-black text-lg shadow-lg ring-2 ring-amber-400/30">
                {isAdmin ? '👑' : (user?.username?.[0]?.toUpperCase() || '💼')}
              </div>
              <div className="flex-1 min-w-0">
                <div className="flex items-center justify-between gap-1">
                  <span className="text-sm font-extrabold text-white truncate">
                    {user?.username || 'Usuario'}
                  </span>
                  <span className={`text-[9px] font-black px-1.5 py-0.5 rounded-full ${
                    isAdmin 
                      ? 'bg-amber-400 text-slate-950' 
                      : 'bg-emerald-500/20 text-emerald-400 border border-emerald-500/30'
                  }`}>
                    {isAdmin ? 'Super Admin' : 'Inversor'}
                  </span>
                </div>
                {user?.email && (
                  <p className="text-[11px] text-slate-400 truncate mt-0.5" title={user.email}>
                    {user.email}
                  </p>
                )}
              </div>
            </div>

            {/* Tarjeta de Cuenta Institucional */}
            <div className="mt-3 bg-slate-950/70 border border-slate-800 rounded-xl p-2.5 flex items-center justify-between">
              <div className="min-w-0">
                <div className="text-[9px] font-bold text-slate-400 uppercase tracking-wider">Número de Cuenta</div>
                <div className="font-mono text-xs font-black text-amber-400 tracking-wide truncate">
                  {accountNumber}
                </div>
              </div>
              <button
                type="button"
                onClick={handleCopyAccount}
                className="px-2 py-1 bg-slate-800 hover:bg-slate-700 text-slate-300 hover:text-white rounded-lg text-[10px] font-bold transition flex items-center gap-1 border border-slate-700"
                title="Copiar número de cuenta"
              >
                {copiedAccount ? (
                  <span className="text-emerald-400 flex items-center gap-0.5">✓ Copiado</span>
                ) : (
                  <span>📋 Copiar</span>
                )}
              </button>
            </div>
          </div>

          {/* Opciones Principales de Acción */}
          <div className="p-2 space-y-1">
            
            {/* 1. Instalar App */}
            <button
              type="button"
              onClick={handleInstallClick}
              className="w-full flex items-center justify-between px-3 py-2.5 rounded-xl text-left text-xs font-semibold text-slate-200 hover:text-white hover:bg-slate-800/80 transition group"
            >
              <div className="flex items-center gap-2.5 min-w-0">
                <div className="w-7 h-7 rounded-lg bg-amber-500/10 border border-amber-500/30 flex items-center justify-center text-amber-400 group-hover:scale-105 transition-transform">
                  📲
                </div>
                <div className="min-w-0">
                  <div className="font-bold text-slate-100 group-hover:text-amber-300 transition-colors">
                    {isStandalone ? 'App Instalada' : 'Instalar App'}
                  </div>
                  <div className="text-[10px] text-slate-400">
                    {isStandalone ? 'Modo Aplicación Activo' : 'Instalar en teléfono o computadora'}
                  </div>
                </div>
              </div>
              <span className={`text-[10px] px-2 py-0.5 rounded-full font-bold ${
                isStandalone 
                  ? 'bg-emerald-500/20 text-emerald-400 border border-emerald-500/30' 
                  : 'bg-amber-400/20 text-amber-300 border border-amber-400/30'
              }`}>
                {isStandalone ? '✓ Instalada' : 'Instalar'}
              </span>
            </button>

            {/* 2. Contáctanos (Soporte WTN) */}
            <button
              type="button"
              onClick={handleContactSupport}
              className="w-full flex items-center justify-between px-3 py-2.5 rounded-xl text-left text-xs font-semibold text-slate-200 hover:text-white hover:bg-slate-800/80 transition group"
            >
              <div className="flex items-center gap-2.5 min-w-0">
                <div className="w-7 h-7 rounded-lg bg-cyan-500/10 border border-cyan-500/30 flex items-center justify-center text-cyan-400 group-hover:scale-105 transition-transform">
                  ✉️
                </div>
                <div className="min-w-0">
                  <div className="font-bold text-slate-100 group-hover:text-cyan-300 transition-colors">
                    Contáctanos
                  </div>
                  <div className="text-[10px] text-slate-400 truncate">
                    {supportEmail}
                  </div>
                </div>
              </div>
              <span className="text-[10px] bg-cyan-500/10 text-cyan-400 border border-cyan-500/20 px-2 py-0.5 rounded-full font-bold">
                Email
              </span>
            </button>

            {/* 3. Toggle de Sonido */}
            <button
              type="button"
              onClick={() => {
                handleToggleSound();
              }}
              className="w-full flex items-center justify-between px-3 py-2.5 rounded-xl text-left text-xs font-semibold text-slate-200 hover:text-white hover:bg-slate-800/80 transition group"
            >
              <div className="flex items-center gap-2.5 min-w-0">
                <div className="w-7 h-7 rounded-lg bg-indigo-500/10 border border-indigo-500/30 flex items-center justify-center text-indigo-400 group-hover:scale-105 transition-transform">
                  {soundOn ? '🔊' : '🔇'}
                </div>
                <div className="min-w-0">
                  <div className="font-bold text-slate-100">
                    Alertas Sonoras
                  </div>
                  <div className="text-[10px] text-slate-400">
                    Notificaciones de órdenes y señales
                  </div>
                </div>
              </div>
              <span className={`text-[10px] font-bold px-2 py-0.5 rounded-full ${
                soundOn ? 'bg-emerald-500/20 text-emerald-400' : 'bg-slate-800 text-slate-400'
              }`}>
                {soundOn ? 'ON' : 'OFF'}
              </span>
            </button>
          </div>

          {/* Separador y Salir */}
          <div className="p-2 border-t border-slate-800 bg-slate-950/40">
            <button
              type="button"
              onClick={() => {
                setIsOpen(false);
                logout();
              }}
              className="w-full flex items-center justify-center gap-2 px-3 py-2 rounded-xl text-xs font-bold text-rose-400 hover:text-white hover:bg-rose-500/20 border border-rose-500/20 hover:border-rose-500/40 transition-all duration-150 shadow-sm"
            >
              <span>🚪</span>
              <span>Cerrar Sesión Segura</span>
            </button>
            <div className="mt-2 text-center text-[9px] text-slate-500">
              WTN Solutions LLC • División Algorítmica Binance
            </div>
          </div>
        </div>
      )}

      {/* Notificación Toast de Lanzador de Escritorio */}
      {desktopDownloadToast && (
        <div className="fixed bottom-5 right-5 z-50 bg-slate-900 border border-amber-500/50 text-white px-4 py-3 rounded-2xl shadow-2xl flex items-center gap-3 animate-in fade-in slide-in-from-bottom-5">
          <span className="text-xl">💻</span>
          <div className="text-xs">
            <div className="font-black text-amber-300">¡Lanzador de Escritorio Descargado!</div>
            <div className="text-slate-300">Abre el archivo para iniciar la app en modo independiente.</div>
          </div>
        </div>
      )}
    </div>
  );
}
