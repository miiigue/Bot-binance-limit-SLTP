import React from 'react';

/**
 * Un componente de tooltip que muestra un ícono de '?' y revela un texto de ayuda al pasar el mouse.
 * Utiliza clases de Tailwind CSS para el estilizado.
 * @param {object} props - Las propiedades del componente.
 * @param {string} props.text - El texto que se mostrará dentro del tooltip.
 */
const Tooltip = ({ text }) => {
  return (
    // Contenedor principal que detecta el hover del grupo
    <div className="group relative inline-flex items-center justify-center ml-2">
      {/* El ícono de interrogación visible */}
      <span className="w-4 h-4 bg-gray-400 text-white text-xs font-semibold rounded-full flex items-center justify-center cursor-help">
        ?
      </span>
      {/* El cuadro de texto del tooltip, inicialmente invisible */}
      <div className="absolute bottom-full mb-2 w-64 bg-gray-800 text-white text-xs rounded-lg py-2 px-3 opacity-0 group-hover:opacity-100 transition-opacity duration-300 pointer-events-none z-10 transform -translate-x-1/2 left-1/2">
        {text}
        {/* Pequeña flecha debajo del tooltip para señalar el ícono */}
        <svg className="absolute text-gray-800 h-2 w-full left-0 top-full" x="0px" y="0px" viewBox="0 0 255 255" xmlSpace="preserve">
          <polygon className="fill-current" points="0,0 127.5,127.5 255,0" />
        </svg>
      </div>
    </div>
  );
};

export default Tooltip;
