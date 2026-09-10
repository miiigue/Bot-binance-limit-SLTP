/** @type {import('tailwindcss').Config} */
export default {
  content: [
    "./index.html",
    "./src/**/*.{js,ts,jsx,tsx}", // Busca clases de Tailwind en estos archivos
  ],
  theme: {
    extend: {
      colors: {
        // Esquema de azules modernos para Bot-binance-limit-SLTP
        primary: {
          50: '#f0f7ff',
          100: '#e0eefe',
          200: '#bae0fd',
          300: '#7cc9fb',
          400: '#36adf3',
          500: '#0c91de',
          600: '#0074bd',
          700: '#005d9a',
          800: '#004f80',
          900: '#00426b',
          950: '#002a47',
        },
      },
    },
  },
  plugins: [], // Aquí puedes añadir plugins de Tailwind
} 