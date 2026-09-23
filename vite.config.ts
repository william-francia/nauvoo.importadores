import react from '@vitejs/plugin-react'
import { defineConfig } from 'vite'
import { VitePWA } from 'vite-plugin-pwa'

// https://vite.dev/config/
export default defineConfig({
  plugins: [
    react(),
    VitePWA({
      registerType: 'autoUpdate',
      injectRegister: 'auto',
      includeAssets: ['ico.png'],
      manifest: {
        name: 'Nuvoo Importadores',
        short_name: 'Nuvoo',
        lang: 'es',
        description: 'Sistema de gestión de ventas, productos e inventario para Nuvoo Importadores.',
        theme_color: '#1f6b5d',
        background_color: '#f4efe7',
        display: 'standalone',
        display_override: ['window-controls-overlay', 'standalone'],
        start_url: '/',
        scope: '/',
        orientation: 'any',
        categories: ['business', 'productivity'],
        icons: [
          {
            src: '/ico.png',
            sizes: '1254x1254',
            type: 'image/png',
            purpose: 'any maskable',
          },
        ],
      },
      workbox: {
        maximumFileSizeToCacheInBytes: 3 * 1024 * 1024,
        // Mantiene disponible el contenedor de React al abrir enlaces internos
        // o cuando la conexión es intermitente. Los datos de Supabase se
        // solicitarán de nuevo cuando haya conexión.
        navigateFallback: '/index.html',
        globPatterns: ['**/*.{js,css,html,ico,png,svg,webp,woff2}'],
      },
    }),
  ],
})
