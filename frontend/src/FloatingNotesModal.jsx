import React, { useState, useEffect, useRef } from 'react';

export default function FloatingNotesModal() {
  const [isOpen, setIsOpen] = useState(false);
  const [activeTab, setActiveTab] = useState('notes'); // 'notes' | 'chat'
  const [notes, setNotes] = useState('');
  const [saveStatus, setSaveStatus] = useState('idle'); // 'idle' | 'saving' | 'saved' | 'error'
  const [chatInput, setChatInput] = useState('');
  const [chatHistory, setChatHistory] = useState([]);
  const [isSending, setIsSending] = useState(false);
  
  const saveTimeoutRef = useRef(null);
  const chatBottomRef = useRef(null);

  // Cargar notas e historial al montar el componente
  useEffect(() => {
    fetchNotes();
  }, []);

  // Auto-scroll en el chat
  useEffect(() => {
    if (activeTab === 'chat' && chatBottomRef.current) {
      chatBottomRef.current.scrollIntoView({ behavior: 'smooth' });
    }
  }, [chatHistory, activeTab]);

  const fetchNotes = async () => {
    try {
      const res = await fetch('/api/notes');
      if (res.ok) {
        const data = await res.json();
        if (data.notes !== undefined) setNotes(data.notes);
        if (Array.isArray(data.chat_history)) setChatHistory(data.chat_history);
      }
    } catch (err) {
      console.warn('Error al cargar notas de la BD:', err);
    }
  };

  const saveNotesToDb = async (contentToSave) => {
    setSaveStatus('saving');
    try {
      const res = await fetch('/api/notes', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ notes: contentToSave, chat_history: chatHistory }),
      });
      if (res.ok) {
        setSaveStatus('saved');
        setTimeout(() => setSaveStatus('idle'), 2500);
      } else {
        setSaveStatus('error');
      }
    } catch (err) {
      console.error('Error al guardar notas:', err);
      setSaveStatus('error');
    }
  };

  const handleNotesChange = (e) => {
    const val = e.target.value;
    setNotes(val);
    setSaveStatus('saving');

    // Debounce automático de 1.2 segundos para guardar mientras escribe
    if (saveTimeoutRef.current) clearTimeout(saveTimeoutRef.current);
    saveTimeoutRef.current = setTimeout(() => {
      saveNotesToDb(val);
    }, 1200);
  };

  const handleClose = () => {
    if (saveTimeoutRef.current) clearTimeout(saveTimeoutRef.current);
    saveNotesToDb(notes);
    setIsOpen(false);
  };

  const handleSendMessage = async (customMsg = null) => {
    const msgToSend = (customMsg !== null ? customMsg : chatInput).trim();
    if (!msgToSend || isSending) return;

    const userMessage = {
      role: 'user',
      text: msgToSend,
      time: new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }),
    };

    setChatHistory((prev) => [...prev, userMessage]);
    setChatInput('');
    setIsSending(true);
    setActiveTab('chat');

    try {
      const res = await fetch('/api/notes/chat', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          message: msgToSend,
          notes: notes,
        }),
      });

      if (res.ok) {
        const data = await res.json();
        if (data.chat_history) {
          setChatHistory(data.chat_history);
        } else if (data.reply) {
          setChatHistory((prev) => [
            ...prev,
            {
              role: 'assistant',
              text: data.reply,
              time: new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }),
            },
          ]);
        }
      } else {
        setChatHistory((prev) => [
          ...prev,
          {
            role: 'assistant',
            text: '⚠️ No se pudo obtener respuesta del servidor en este momento.',
            time: new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }),
          },
        ]);
      }
    } catch (err) {
      setChatHistory((prev) => [
        ...prev,
        {
          role: 'assistant',
          text: `⚠️ Error de conexión: ${err.message}`,
          time: new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }),
        },
      ]);
    } finally {
      setIsSending(false);
    }
  };

  const handleSendCurrentNotes = () => {
    if (!notes.trim()) return;
    handleSendMessage(`Notas de bitácora:\n${notes}`);
  };

  return (
    <>
      {/* Botón Flotante con Ícono de Lápiz */}
      <button
        onClick={() => {
          if (!isOpen) fetchNotes();
          setIsOpen(!isOpen);
        }}
        className="fixed bottom-6 right-6 z-50 w-14 h-14 rounded-full bg-gradient-to-tr from-amber-600 via-amber-500 to-yellow-400 text-slate-950 shadow-2xl shadow-amber-500/40 hover:scale-110 active:scale-95 transition-all duration-200 border-2 border-amber-200 flex items-center justify-center group focus:outline-none focus:ring-4 focus:ring-amber-400/50"
        title="Bitácora & Asistente IA"
        aria-label="Abrir Bitácora & Asistente"
      >
        <svg
          className="w-6 h-6 transition-transform duration-200 group-hover:rotate-12"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth="2.5"
          strokeLinecap="round"
          strokeLinejoin="round"
        >
          <path d="M12 20h9" />
          <path d="M16.5 3.5a2.121 2.121 0 0 1 3 3L7 19l-4 1 1-4L16.5 3.5z" />
        </svg>

        {/* Indicador de pulso activo */}
        <span className="absolute top-0 right-0 flex h-3.5 w-3.5">
          <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-amber-400 opacity-75"></span>
          <span className="relative inline-flex rounded-full h-3.5 w-3.5 bg-amber-300 border border-slate-950"></span>
        </span>
      </button>

      {/* Ventana Modal Flotante */}
      {isOpen && (
        <div className="fixed bottom-24 right-4 sm:right-6 z-50 w-[420px] max-w-[94vw] h-[550px] max-h-[82vh] bg-slate-900/95 border-2 border-amber-500/60 shadow-2xl rounded-2xl flex flex-col overflow-hidden backdrop-blur-xl animate-in fade-in zoom-in-95 duration-200 text-slate-100 font-sans">
          
          {/* Header */}
          <div className="flex items-center justify-between px-4 py-3 bg-slate-950/80 border-b border-amber-500/30">
            <div className="flex items-center gap-2">
              <span className="text-lg">✏️</span>
              <div>
                <h3 className="text-sm font-bold text-amber-300 leading-tight">Bitácora & Asistente</h3>
                <span className="text-[10px] text-slate-400 block font-mono">Persistencia en SQLite</span>
              </div>
            </div>

            <div className="flex items-center gap-2">
              {/* Indicador de Guardado */}
              <span className="text-[11px] font-mono px-2 py-0.5 rounded-full flex items-center gap-1 border">
                {saveStatus === 'saving' && (
                  <span className="text-amber-300 border-amber-500/40 bg-amber-950/50 flex items-center gap-1">
                    <span className="w-1.5 h-1.5 rounded-full bg-amber-400 animate-ping"></span> Guardando...
                  </span>
                )}
                {saveStatus === 'saved' && (
                  <span className="text-emerald-300 border-emerald-500/40 bg-emerald-950/50">
                    ✓ Guardado en DB
                  </span>
                )}
                {saveStatus === 'idle' && (
                  <span className="text-slate-400 border-slate-700 bg-slate-800/40">
                    ● En línea
                  </span>
                )}
                {saveStatus === 'error' && (
                  <span className="text-rose-400 border-rose-500/40 bg-rose-950/50">
                    ✕ Error al guardar
                  </span>
                )}
              </span>

              {/* Botón Cerrar (Guarda al cerrar) */}
              <button
                onClick={handleClose}
                className="w-7 h-7 rounded-lg bg-slate-800/80 hover:bg-slate-700 text-slate-300 hover:text-white flex items-center justify-center transition-colors border border-slate-700 text-xs font-bold"
                title="Cerrar y guardar"
              >
                ✕
              </button>
            </div>
          </div>

          {/* Navegación por Pestañas */}
          <div className="flex border-b border-slate-800 bg-slate-950/40 text-xs font-bold">
            <button
              onClick={() => setActiveTab('notes')}
              className={`flex-1 py-2 flex items-center justify-center gap-1.5 transition-colors border-b-2 ${
                activeTab === 'notes'
                  ? 'border-amber-400 text-amber-300 bg-slate-900/60'
                  : 'border-transparent text-slate-400 hover:text-slate-200'
              }`}
            >
              <span>📝</span>
              <span>Bitácora de Notas</span>
            </button>
            <button
              onClick={() => setActiveTab('chat')}
              className={`flex-1 py-2 flex items-center justify-center gap-1.5 transition-colors border-b-2 ${
                activeTab === 'chat'
                  ? 'border-amber-400 text-amber-300 bg-slate-900/60'
                  : 'border-transparent text-slate-400 hover:text-slate-200'
              }`}
            >
              <span>🤖</span>
              <span>Copiloto de Trading</span>
              {chatHistory.length > 0 && (
                <span className="text-[10px] px-1.5 py-0.2 rounded-full bg-amber-500/20 text-amber-300 border border-amber-500/40">
                  {chatHistory.length}
                </span>
              )}
            </button>
          </div>

          {/* Cuerpo de la Pestaña: NOTAS */}
          {activeTab === 'notes' && (
            <div className="flex-1 flex flex-col p-3 overflow-hidden gap-2">
              <div className="flex items-center justify-between text-[11px] text-slate-400 px-1">
                <span>Escribe notas, observaciones de mercado o instrucciones:</span>
                <span className="font-mono text-[10px]">{notes.length} caracteres</span>
              </div>

              <textarea
                value={notes}
                onChange={handleNotesChange}
                placeholder="Escribe aquí tus observaciones, análisis de trades, notas de mercado o recordatorios... Se guardará en la base de datos automáticamente al escribir o cerrar la ventana."
                className="flex-1 w-full bg-slate-950/80 border border-slate-800 focus:border-amber-400/80 rounded-xl p-3 text-sm text-slate-100 placeholder-slate-500 resize-none focus:outline-none font-sans leading-relaxed focus:ring-1 focus:ring-amber-400/30 transition-all"
              />

              {/* Barra inferior de acciones */}
              <div className="flex items-center justify-between pt-1 gap-2">
                <button
                  onClick={() => saveNotesToDb(notes)}
                  className="px-3 py-1.5 bg-slate-800 hover:bg-slate-700 text-slate-200 rounded-lg text-xs font-semibold flex items-center gap-1.5 border border-slate-700 transition-colors"
                  title="Guardar de inmediato en base de datos"
                >
                  <span>💾</span>
                  <span>Guardar</span>
                </button>

                <div className="flex items-center gap-2">
                  <button
                    onClick={handleSendCurrentNotes}
                    disabled={!notes.trim() || isSending}
                    className="px-3.5 py-1.5 bg-gradient-to-r from-amber-500 to-yellow-500 hover:from-amber-400 hover:to-yellow-400 text-slate-950 font-bold rounded-lg text-xs flex items-center gap-1.5 shadow-md shadow-amber-500/20 disabled:opacity-50 disabled:cursor-not-allowed transition-all"
                    title="Enviar contenido de la bitácora al Copiloto"
                  >
                    <span>💬</span>
                    <span>Enviar a Copiloto</span>
                  </button>
                </div>
              </div>
            </div>
          )}

          {/* Cuerpo de la Pestaña: CHAT & ASISTENTE */}
          {activeTab === 'chat' && (
            <div className="flex-1 flex flex-col overflow-hidden">
              {/* Historial de Mensajes */}
              <div className="flex-1 overflow-y-auto p-3 space-y-3 font-sans text-xs">
                {chatHistory.length === 0 ? (
                  <div className="h-full flex flex-col items-center justify-center text-center p-4 text-slate-400">
                    <span className="text-3xl mb-2">🤖</span>
                    <p className="font-semibold text-slate-300 mb-1">Copiloto WTN Algo-Trading</p>
                    <p className="text-[11px] leading-relaxed max-w-[280px]">
                      Conectado a la telemetría en vivo del bot. Pregúntame sobre balance, posiciones abiertas, trailing stop o cualquier instrucción.
                    </p>
                    <div className="mt-3 flex flex-wrap gap-1.5 justify-center">
                      <button
                        onClick={() => handleSendMessage('¿Cómo están mis posiciones abiertas y el margen?')}
                        className="text-[10px] px-2 py-1 rounded bg-slate-800 hover:bg-slate-700 text-amber-300 border border-slate-700 transition-colors"
                      >
                        📊 Mis posiciones
                      </button>
                      <button
                        onClick={() => handleSendMessage('¿Qué recomendación das para el trailing stop?')}
                        className="text-[10px] px-2 py-1 rounded bg-slate-800 hover:bg-slate-700 text-amber-300 border border-slate-700 transition-colors"
                      >
                        📈 Trailing Stop
                      </button>
                      <button
                        onClick={() => handleSendMessage('¿Cuál es el saldo total y exposición de cartera?')}
                        className="text-[10px] px-2 py-1 rounded bg-slate-800 hover:bg-slate-700 text-amber-300 border border-slate-700 transition-colors"
                      >
                        💰 Saldo y Exposición
                      </button>
                    </div>
                  </div>
                ) : (
                  chatHistory.map((m, idx) => (
                    <div
                      key={idx}
                      className={`flex flex-col ${
                        m.role === 'user' ? 'items-end' : 'items-start'
                      }`}
                    >
                      <div className="flex items-center gap-1.5 mb-0.5 px-1">
                        <span className="text-[10px] font-bold text-slate-400">
                          {m.role === 'user' ? 'Tú' : 'Copiloto'}
                        </span>
                        <span className="text-[9px] text-slate-500 font-mono">{m.time}</span>
                      </div>
                      <div
                        className={`max-w-[88%] rounded-2xl px-3 py-2 leading-relaxed whitespace-pre-wrap ${
                          m.role === 'user'
                            ? 'bg-amber-500 text-slate-950 font-medium rounded-br-none shadow-md shadow-amber-500/10'
                            : 'bg-slate-800/90 text-slate-100 border border-slate-700 rounded-bl-none shadow-md'
                        }`}
                      >
                        {m.text}
                      </div>
                    </div>
                  ))
                )}
                {isSending && (
                  <div className="flex items-center gap-2 text-slate-400 text-xs p-2">
                    <span className="w-2 h-2 rounded-full bg-amber-400 animate-ping"></span>
                    <span>El Copiloto está analizando...</span>
                  </div>
                )}
                <div ref={chatBottomRef} />
              </div>

              {/* Input y Botón Enviar */}
              <div className="p-2.5 bg-slate-950/90 border-t border-slate-800 flex items-center gap-2">
                <input
                  type="text"
                  value={chatInput}
                  onChange={(e) => setChatInput(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter') handleSendMessage();
                  }}
                  placeholder="Escribe tu mensaje o instrucción..."
                  disabled={isSending}
                  className="flex-1 bg-slate-900 border border-slate-700 focus:border-amber-400 rounded-xl px-3 py-2 text-xs text-slate-100 placeholder-slate-500 focus:outline-none font-sans"
                />
                <button
                  onClick={() => handleSendMessage()}
                  disabled={!chatInput.trim() || isSending}
                  className="px-4 py-2 bg-gradient-to-r from-amber-500 to-yellow-500 hover:from-amber-400 hover:to-yellow-400 text-slate-950 font-bold rounded-xl text-xs flex items-center gap-1 shadow-md shadow-amber-500/20 disabled:opacity-50 disabled:cursor-not-allowed transition-all"
                >
                  <span>Enviar</span>
                  <svg className="w-3.5 h-3.5" viewBox="0 0 24 24" fill="currentColor">
                    <path d="M3.4 20.4l17.45-7.48a1 1 0 000-1.84L3.4 3.6a.993.993 0 00-1.39.91L2 9.12c0 .5.37.93.87.99L17 12 2.87 13.88c-.5.07-.87.5-.87 1l.01 4.61c0 .71.73 1.2 1.39.91z" />
                  </svg>
                </button>
              </div>
            </div>
          )}
        </div>
      )}
    </>
  );
}
