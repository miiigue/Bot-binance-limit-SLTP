import React from 'react';

/**
 * Componente de Tooltip profesional con soporte para título, descripción y caja destacada de ejemplo.
 * @param {object} props
 * @param {string|object} props.text - Texto explicativo o estructura { title, desc, example }.
 * @param {string} [props.example] - Texto del ejemplo práctico.
 * @param {string} [props.title] - Título opcional del parámetro.
 */
const Tooltip = ({ text, example, title }) => {
  let displayTitle = title;
  let displayDesc = typeof text === 'object' ? text.desc : text;
  let displayExample = example || (typeof text === 'object' ? text.example : null);

  if (typeof text === 'object' && text.title && !displayTitle) {
    displayTitle = text.title;
  }

  if (!displayDesc && !displayExample) {
    return null;
  }

  return (
    <div className="group relative inline-flex items-center justify-center ml-1.5 align-middle">
      {/* Botón / Icono de ayuda interactivo */}
      <span className="w-4 h-4 bg-blue-100 text-blue-700 dark:bg-blue-900/60 dark:text-blue-300 hover:bg-blue-200 dark:hover:bg-blue-800 text-[11px] font-bold rounded-full flex items-center justify-center cursor-help transition-colors shadow-sm border border-blue-300 dark:border-blue-700">
        ?
      </span>
      {/* Contenedor flotante del Tooltip */}
      <div className="absolute bottom-full mb-2 w-72 sm:w-84 bg-gray-900/95 backdrop-blur-sm text-gray-100 text-xs rounded-lg p-3.5 opacity-0 group-hover:opacity-100 transition-all duration-200 pointer-events-none z-50 transform -translate-x-1/2 left-1/2 shadow-2xl border border-gray-700">
        {displayTitle && (
          <div className="font-bold text-blue-300 mb-1 border-b border-gray-700/80 pb-1 text-xs tracking-wide uppercase">
            {displayTitle}
          </div>
        )}
        <div className="text-gray-200 leading-relaxed text-[11.5px]">
          {displayDesc}
        </div>
        {displayExample && (
          <div className="mt-2 pt-2 border-t border-gray-700/80 bg-blue-950/40 rounded p-1.5 border border-blue-800/40">
            <span className="font-semibold text-amber-300 block mb-0.5 text-[11px]">
              💡 Ejemplo práctico:
            </span>
            <span className="text-gray-300 text-[11px] leading-snug block">
              {displayExample}
            </span>
          </div>
        )}
        {/* Flecha inferior */}
        <div className="absolute left-1/2 -bottom-1 -translate-x-1/2 w-2 h-2 bg-gray-900 rotate-45 border-r border-b border-gray-700"></div>
      </div>
    </div>
  );
};

export default Tooltip;
