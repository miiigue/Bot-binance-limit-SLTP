import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
 
// https://vitejs.dev/config/
export default defineConfig({
  plugins: [react()],
  server: {
    proxy: {
      // Redirige todas las peticiones que empiecen con /api al servidor backend
      '/api': {
        target: 'http://127.0.0.1:5002', // El puerto donde corre tu backend de Flask
        changeOrigin: true, // Necesario para la redirección
        secure: false,      // No necesitamos SSL en desarrollo
      }
    },
  },
}) 