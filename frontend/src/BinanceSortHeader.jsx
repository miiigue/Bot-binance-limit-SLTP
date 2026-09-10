import React from 'react';
import Tooltip from './Tooltip';

/**
 * Componente de encabezado de tabla estilo Binance con indicadores visuales
 * de dirección (▲ ascendente / ▼ descendente) y resaltado interactivo.
 */
export const BinanceSortHeader = ({
  label,
  sortKey,
  currentSort,
  onSort,
  align = 'left',
  className = '',
  title,
  tooltipInfo
}) => {
  const isActive = currentSort?.key === sortKey;
  const isAsc = isActive && currentSort?.direction === 'asc';
  const isDesc = isActive && currentSort?.direction === 'desc';

  const justifyClass = 
    align === 'right' ? 'justify-end' : 
    align === 'center' ? 'justify-center' : 
    'justify-start';

  const textAlignment = 
    align === 'right' ? 'text-right' : 
    align === 'center' ? 'text-center' : 
    'text-left';

  const defaultTitle = !tooltipInfo ? (title || `Ordenar por ${label} (${isActive ? (isDesc ? 'Mayor a menor ▼' : 'Menor a mayor ▲') : 'Clic para ordenar'})`) : undefined;

  return (
    <th
      scope="col"
      onClick={() => onSort(sortKey)}
      className={`px-3 py-2.5 cursor-pointer select-none group transition-colors hover:bg-slate-800/80 ${textAlignment} ${className}`}
      title={defaultTitle}
    >
      <div className={`inline-flex items-center gap-1.5 ${justifyClass} w-full`}>
        <span className={`font-extrabold text-[11px] uppercase tracking-wider transition-colors ${
          isActive ? 'text-amber-400' : 'text-slate-200 group-hover:text-white'
        }`}>
          {label}
        </span>
        {tooltipInfo && (
          <Tooltip 
            title={typeof tooltipInfo === 'object' ? tooltipInfo.title || label : label}
            text={typeof tooltipInfo === 'object' ? tooltipInfo.desc || tooltipInfo.text : tooltipInfo}
            example={typeof tooltipInfo === 'object' ? tooltipInfo.example : null}
            position="top"
            align={align === 'right' ? 'right' : align === 'center' ? 'center' : 'left'}
          />
        )}
        <span className="inline-flex flex-col items-center justify-center text-[7px] leading-[6px] w-2.5 h-3 flex-shrink-0">
          <span 
            className={`transition-all duration-150 ${
              isAsc 
                ? 'text-amber-400 font-black scale-125' 
                : isActive 
                  ? 'text-slate-600' 
                  : 'text-slate-500 group-hover:text-slate-300'
            }`}
          >
            ▲
          </span>
          <span 
            className={`transition-all duration-150 ${
              isDesc 
                ? 'text-amber-400 font-black scale-125' 
                : isActive 
                  ? 'text-slate-600' 
                  : 'text-slate-500 group-hover:text-slate-300'
            }`}
          >
            ▼
          </span>
        </span>
      </div>
    </th>
  );
};

/**
 * Función utilitaria universal para ordenar filas de tablas con soporte para
 * números, importes con signos/símbolos, fechas ISO y cadenas de texto.
 */
export const sortTableData = (items, sortConfig, extractors = {}) => {
  if (!items || !Array.isArray(items) || items.length === 0) return [];
  if (!sortConfig || !sortConfig.key) return items;

  const { key, direction } = sortConfig;
  const multiplier = direction === 'asc' ? 1 : -1;

  return [...items].sort((a, b) => {
    let valA, valB;

    if (extractors[key]) {
      valA = extractors[key](a);
      valB = extractors[key](b);
    } else {
      valA = a?.[key];
      valB = b?.[key];
    }

    if (valA === undefined || valA === null) valA = '';
    if (valB === undefined || valB === null) valB = '';

    // Comparación directa de tipos numéricos
    if (typeof valA === 'number' && typeof valB === 'number') {
      return (valA - valB) * multiplier;
    }

    // Limpieza y parsing si son cadenas que representan números o importes monetarios
    const cleanStr = (s) => String(s).replace(/[$,%]/g, '').replace(/USDT/gi, '').trim();
    const parsedA = parseFloat(cleanStr(valA));
    const parsedB = parseFloat(cleanStr(valB));

    if (!isNaN(parsedA) && !isNaN(parsedB) && cleanStr(valA) !== '' && cleanStr(valB) !== '') {
      return (parsedA - parsedB) * multiplier;
    }

    // Fechas en formato ISO o YYYY-MM-DD
    const strA = String(valA).trim();
    const strB = String(valB).trim();
    if (strA.length > 8 && strB.length > 8 && (strA.includes('-') || strA.includes(':'))) {
      const dateA = Date.parse(strA);
      const dateB = Date.parse(strB);
      if (!isNaN(dateA) && !isNaN(dateB)) {
        return (dateA - dateB) * multiplier;
      }
    }

    // Comparación de cadenas con soporte numérico local
    return strA.localeCompare(strB, undefined, { numeric: true, sensitivity: 'base' }) * multiplier;
  });
};

export default BinanceSortHeader;
