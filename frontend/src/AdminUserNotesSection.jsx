import React, { useState, useEffect, useCallback } from 'react';

export default function AdminUserNotesSection({ targetUserId, username, authFetch }) {
  const [notes, setNotes] = useState([]);
  const [isLoading, setIsLoading] = useState(true);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [newNote, setNewNote] = useState('');
  const [error, setError] = useState(null);
  const [successMsg, setSuccessMsg] = useState(null);
  const [isCollapsed, setIsCollapsed] = useState(false);
  const [confirmDeleteId, setConfirmDeleteId] = useState(null);
  const [searchTerm, setSearchTerm] = useState('');

  const fetchNotes = useCallback(async () => {
    if (!targetUserId) return;
    setIsLoading(true);
    try {
      setError(null);
      const resp = await authFetch(`/api/admin/users/${targetUserId}/notes`);
      if (!resp.ok) {
        if (resp.status === 403) {
          throw new Error('Acceso restringido: Solo el Administrador puede ver esta bitácora.');
        }
        throw new Error(`Error ${resp.status} al cargar observaciones.`);
      }
      const data = await resp.json();
      setNotes(data.notes || []);
    } catch (err) {
      setError(err.message || 'Error al consultar las observaciones.');
    } finally {
      setIsLoading(false);
    }
  }, [targetUserId, authFetch]);

  useEffect(() => {
    fetchNotes();
  }, [fetchNotes]);

  const handleAddNote = async (e) => {
    e?.preventDefault();
    const clean = newNote.trim();
    if (!clean) return;

    setIsSubmitting(true);
    setError(null);
    setSuccessMsg(null);

    try {
      const resp = await authFetch(`/api/admin/users/${targetUserId}/notes`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ note: clean })
      });
      const data = await resp.json();
      if (!resp.ok) {
        throw new Error(data.message || 'No se pudo guardar la observación.');
      }

      setNewNote('');
      setSuccessMsg('Observación guardada exitosamente.');
      setTimeout(() => setSuccessMsg(null), 3000);
      
      // Añadir la nueva nota arriba inmediatamente
      if (data.note) {
        setNotes(prev => [data.note, ...prev]);
      } else {
        fetchNotes();
      }
    } catch (err) {
      setError(err.message || 'Error al guardar observación.');
    } finally {
      setIsSubmitting(false);
    }
  };

  const handleDeleteNote = async (noteId) => {
    try {
      setError(null);
      const resp = await authFetch(`/api/admin/users/${targetUserId}/notes/${noteId}`, {
        method: 'DELETE'
      });
      const data = await resp.json();
      if (!resp.ok) {
        throw new Error(data.message || 'No se pudo eliminar la observación.');
      }
      setNotes(prev => prev.filter(n => n.id !== noteId));
      setConfirmDeleteId(null);
    } catch (err) {
      setError(err.message || 'Error al eliminar observación.');
    }
  };

  const filteredNotes = notes.filter(n => {
    if (!searchTerm) return true;
    const term = searchTerm.toLowerCase();
    return (n.note || '').toLowerCase().includes(term) ||
           (n.admin_username || '').toLowerCase().includes(term) ||
           (n.created_at || '').toLowerCase().includes(term);
  });

  return (
    <div id="admin-user-notes-section" className="bg-slate-900/95 border-2 border-amber-500/40 rounded-3xl p-6 sm:p-8 shadow-2xl shadow-amber-950/20 space-y-6 relative overflow-hidden transition-all duration-300">
      {/* Glow de fondo */}
      <div className="absolute top-0 right-0 -mt-10 -mr-10 w-72 h-72 bg-amber-500/10 rounded-full blur-3xl pointer-events-none"></div>

      {/* Cabecera Principal de la Sección */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 border-b border-slate-800 pb-5 relative z-10">
        <div className="space-y-1">
          <div className="flex items-center gap-2 flex-wrap">
            <span className="text-xl">📝</span>
            <h2 className="text-lg sm:text-xl font-black text-amber-300 tracking-tight flex items-center gap-2">
              BITÁCORA DE OBSERVACIONES INTERNAS
            </h2>
            <span className="px-2.5 py-0.5 rounded-full text-[10px] font-black uppercase tracking-wider bg-amber-500/20 border border-amber-500/50 text-amber-300 shadow-sm">
              🔒 Solo Admin
            </span>
            <span className="px-2 py-0.5 rounded-full text-[11px] font-mono font-bold bg-slate-800 text-slate-300 border border-slate-700">
              {notes.length} {notes.length === 1 ? 'acote' : 'acotes'}
            </span>
          </div>
          <p className="text-xs text-slate-400">
            Registro confidencial de seguimiento, acuerdos y notas sobre el usuario <span className="font-bold text-white">@{username}</span>. No visible para el usuario.
          </p>
        </div>

        <div className="flex items-center gap-2 self-start sm:self-auto">
          {/* Botón Refrescar */}
          <button
            onClick={fetchNotes}
            disabled={isLoading}
            className="px-3 py-1.5 rounded-xl text-xs font-semibold bg-slate-800 hover:bg-slate-700 text-slate-200 border border-slate-700 flex items-center gap-1.5 transition-colors disabled:opacity-50"
            title="Refrescar observaciones"
          >
            <span className={isLoading ? 'animate-spin' : ''}>🔄</span>
            <span className="hidden sm:inline">Refrescar</span>
          </button>

          {/* Botón Colapsar / Expandir */}
          <button
            onClick={() => setIsCollapsed(!isCollapsed)}
            className="px-3 py-1.5 rounded-xl text-xs font-semibold bg-slate-800 hover:bg-slate-700 text-slate-200 border border-slate-700 transition-colors"
          >
            {isCollapsed ? '▼ Expandir' : '▲ Plegar'}
          </button>
        </div>
      </div>

      {/* Contenido Expandible */}
      {!isCollapsed && (
        <div className="space-y-6 relative z-10 animate-fadeIn">
          {/* Mensajes de Feedback */}
          {error && (
            <div className="p-3.5 rounded-xl bg-rose-500/15 border border-rose-500/30 text-rose-300 text-xs flex items-center justify-between">
              <span>⚠️ {error}</span>
              <button onClick={() => setError(null)} className="text-slate-400 hover:text-white">✕</button>
            </div>
          )}
          {successMsg && (
            <div className="p-3.5 rounded-xl bg-emerald-500/15 border border-emerald-500/30 text-emerald-300 text-xs flex items-center justify-between">
              <span>✅ {successMsg}</span>
              <button onClick={() => setSuccessMsg(null)} className="text-slate-400 hover:text-white">✕</button>
            </div>
          )}

          {/* Formulario para Ingresar Nueva Observación */}
          <form onSubmit={handleAddNote} className="space-y-3 bg-slate-950/70 border border-slate-800/80 rounded-2xl p-4 sm:p-5 shadow-inner">
            <div className="flex items-center justify-between">
              <label htmlFor="new-admin-note" className="text-xs font-bold text-slate-300 flex items-center gap-1.5">
                <span>✍️</span> Redactar Nueva Observación o Novedad:
              </label>
              <span className="text-[11px] text-slate-500 font-mono">
                {newNote.length} caracteres
              </span>
            </div>

            <textarea
              id="new-admin-note"
              rows={3}
              value={newNote}
              onChange={(e) => setNewNote(e.target.value)}
              placeholder={`Ejemplo:\n- 27/10: Se acordó con el usuario cambiar su estrategia a 22_AGRESIVA con $500 por posición.\n- Presenta saldo residual de testnet en ETH; se aisló correctamente.\n- Notificado por WhatsApp sobre su rendimiento semanal.`}
              className="w-full bg-slate-900 border border-slate-700 rounded-xl px-4 py-3 text-xs sm:text-sm text-slate-100 placeholder-slate-500 focus:outline-none focus:border-amber-400 focus:ring-1 focus:ring-amber-400 font-sans leading-relaxed resize-y min-h-[90px]"
            />

            <div className="flex items-center justify-between gap-3 pt-1">
              <span className="text-[11px] text-slate-500 italic">
                Presiona "Guardar" para registrar la observación con tu usuario de Administrador y fecha/hora exacta.
              </span>
              <div className="flex items-center gap-2">
                {newNote && (
                  <button
                    type="button"
                    onClick={() => setNewNote('')}
                    className="px-3 py-1.5 rounded-xl text-xs font-semibold text-slate-400 hover:text-slate-200 transition-colors"
                  >
                    Borrar
                  </button>
                )}
                <button
                  type="submit"
                  disabled={!newNote.trim() || isSubmitting}
                  className="px-5 py-2 rounded-xl text-xs font-black uppercase tracking-wider bg-gradient-to-r from-amber-500 to-amber-600 hover:from-amber-400 hover:to-amber-500 text-slate-950 shadow-md shadow-amber-500/20 transition-all disabled:opacity-40 disabled:cursor-not-allowed flex items-center gap-1.5"
                >
                  {isSubmitting ? (
                    <>
                      <span className="animate-spin">⏳</span>
                      <span>Guardando...</span>
                    </>
                  ) : (
                    <>
                      <span>💾</span>
                      <span>Guardar Observación</span>
                    </>
                  )}
                </button>
              </div>
            </div>
          </form>

          {/* Barra de Búsqueda / Filtro de Observaciones Previas */}
          {notes.length > 3 && (
            <div className="flex items-center gap-3">
              <div className="relative flex-1">
                <span className="absolute left-3.5 top-1/2 -translate-y-1/2 text-slate-500 text-xs">🔍</span>
                <input
                  type="text"
                  value={searchTerm}
                  onChange={(e) => setSearchTerm(e.target.value)}
                  placeholder="Buscar en el historial de observaciones..."
                  className="w-full bg-slate-950/80 border border-slate-800 rounded-xl pl-9 pr-3 py-2 text-xs text-slate-200 placeholder-slate-500 focus:outline-none focus:border-amber-400"
                />
              </div>
              {searchTerm && (
                <button
                  onClick={() => setSearchTerm('')}
                  className="text-xs text-slate-400 hover:text-white px-2 py-1"
                >
                  Limpiar filtro
                </button>
              )}
            </div>
          )}

          {/* Historial / Timeline de Observaciones */}
          <div className="space-y-3">
            <div className="flex items-center justify-between text-xs font-bold text-slate-400 px-1">
              <span>📋 HISTORIAL CRONOLÓGICO DE OBSERVACIONES ({filteredNotes.length})</span>
            </div>

            {isLoading && notes.length === 0 ? (
              <div className="p-8 text-center bg-slate-950/40 rounded-2xl border border-slate-800/60">
                <span className="animate-spin inline-block text-2xl mb-2">⏳</span>
                <p className="text-xs text-slate-400">Cargando bitácora de observaciones...</p>
              </div>
            ) : filteredNotes.length === 0 ? (
              <div className="p-8 text-center bg-slate-950/40 rounded-2xl border border-dashed border-slate-800/80">
                <span className="text-3xl mb-2 block">📭</span>
                <p className="text-xs font-semibold text-slate-300">
                  {searchTerm 
                    ? 'No se encontraron observaciones que coincidan con la búsqueda.' 
                    : 'Aún no hay observaciones ni acotes registrados para este usuario.'}
                </p>
                <p className="text-[11px] text-slate-500 mt-1">
                  Usa el recuadro superior para escribir la primera nota de auditoría sobre @{username}.
                </p>
              </div>
            ) : (
              <div className="space-y-3 max-h-[500px] overflow-y-auto pr-1 scrollbar-thin scrollbar-thumb-slate-700">
                {filteredNotes.map((note) => (
                  <div
                    key={note.id}
                    className="bg-slate-950/80 border border-slate-800 hover:border-slate-700/80 rounded-2xl p-4.5 sm:p-5 transition-all shadow-sm space-y-2.5"
                  >
                    {/* Header de la Tarjeta de Nota */}
                    <div className="flex flex-wrap items-center justify-between gap-2 border-b border-slate-800/60 pb-2.5">
                      <div className="flex items-center gap-2">
                        <span className="px-2.5 py-0.5 rounded-md bg-amber-500/10 border border-amber-500/30 text-amber-300 text-[11px] font-mono font-bold flex items-center gap-1">
                          <span>🛡️</span> {note.admin_username || 'Admin'}
                        </span>
                        <span className="text-[11px] font-mono text-slate-400 flex items-center gap-1">
                          <span>📅</span> {note.created_at || 'Fecha no disponible'}
                        </span>
                      </div>

                      {/* Botón de Borrar con Confirmación Rápida */}
                      <div>
                        {confirmDeleteId === note.id ? (
                          <div className="flex items-center gap-1.5 animate-fadeIn">
                            <span className="text-[10px] text-rose-300 font-semibold">¿Eliminar?</span>
                            <button
                              onClick={() => handleDeleteNote(note.id)}
                              className="px-2 py-0.5 rounded bg-rose-600 hover:bg-rose-500 text-white text-[10px] font-bold"
                            >
                              Sí
                            </button>
                            <button
                              onClick={() => setConfirmDeleteId(null)}
                              className="px-2 py-0.5 rounded bg-slate-800 hover:bg-slate-700 text-slate-300 text-[10px]"
                            >
                              No
                            </button>
                          </div>
                        ) : (
                          <button
                            onClick={() => setConfirmDeleteId(note.id)}
                            className="text-slate-500 hover:text-rose-400 text-xs p-1 rounded transition-colors"
                            title="Eliminar esta observación"
                          >
                            🗑️
                          </button>
                        )}
                      </div>
                    </div>

                    {/* Cuerpo de la Nota */}
                    <div className="text-xs sm:text-sm text-slate-200 font-sans leading-relaxed whitespace-pre-wrap selection:bg-amber-500/30">
                      {note.note}
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
