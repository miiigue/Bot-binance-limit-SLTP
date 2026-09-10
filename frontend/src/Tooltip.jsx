import React from 'react';

/**
 * Componente de Tooltip profesional con soporte para título, descripción y caja destacada de ejemplo.
 * @param {object} props
 * @param {string|object} props.text - Texto explicativo o estructura { title, desc, example }.
 * @param {string} [props.example] - Texto del ejemplo práctico.
 * @param {string} [props.title] - Título opcional del parámetro.
 */
const Tooltip = ({ text, example, title, position = 'top', align = 'center' }) => {
  let displayTitle = title;
  let displayDesc = typeof text === 'object' ? text.desc : text;
  let displayExample = example || (typeof text === 'object' ? text.example : null);

  if (typeof text === 'object' && text.title && !displayTitle) {
    displayTitle = text.title;
  }

  if (!displayDesc && !displayExample) {
    return null;
  }

  const isBottom = position === 'bottom';
  const posClasses = isBottom ? 'top-full mt-2' : 'bottom-full mb-2';
  
  let alignClasses = 'left-1/2 -translate-x-1/2';
  let arrowAlignClasses = 'left-1/2 -translate-x-1/2';
  if (align === 'left') {
    alignClasses = 'left-0';
    arrowAlignClasses = 'left-3';
  } else if (align === 'right') {
    alignClasses = 'right-0';
    arrowAlignClasses = 'right-3';
  }

  const arrowClasses = isBottom
    ? `-top-1 border-l border-t ${arrowAlignClasses}`
    : `-bottom-1 border-r border-b ${arrowAlignClasses}`;

  return (
    <div 
      onClick={(e) => e.stopPropagation()}
      className="group relative inline-flex items-center justify-center ml-1.5 align-middle cursor-default"
    >
      {/* Botón / Icono de ayuda interactivo */}
      <span className="w-4 h-4 bg-blue-100 text-blue-700 dark:bg-blue-900/60 dark:text-blue-300 hover:bg-blue-200 dark:hover:bg-blue-800 text-[11px] font-bold rounded-full flex items-center justify-center cursor-help transition-colors shadow-sm border border-blue-300 dark:border-blue-700 select-none">
        ?
      </span>
      {/* Contenedor flotante del Tooltip */}
      <div className={`absolute ${posClasses} ${alignClasses} w-72 sm:w-84 bg-gray-900/95 backdrop-blur-sm text-gray-100 text-xs rounded-lg p-3.5 opacity-0 group-hover:opacity-100 transition-all duration-200 pointer-events-none z-50 shadow-2xl border border-gray-700 text-left font-normal normal-case`}>
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
        {/* Flecha indicadora */}
        <div className={`absolute w-2 h-2 bg-gray-900 rotate-45 border-gray-700 ${arrowClasses}`}></div>
      </div>
    </div>
  );
};

export default Tooltip;
