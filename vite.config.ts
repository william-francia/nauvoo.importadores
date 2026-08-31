import react from '@vitejs/plugin-react'
import { defineConfig } from 'vite'
import { VitePWA } from 'vite-plugin-pwa'

// https://vite.dev/config/
export default defineConfig({
  plugins: [
    react(),
    VitePWA({
      registerType: 'autoUpdate',
      manifest: {
        name: 'Nuvoo Importadores',
        short_name: 'Nuvoo',
        lang: 'es',
        description: 'Panel de gestion para Nuvoo Importadores.',
        theme_color: '#1f6b5d',
        background_color: '#f4efe7',
        display: 'standalone',
        start_url: '/login',
        icons: [
          {
            src: '/nuvoo-icon.svg',
            sizes: 'any',
            type: 'image/svg+xml',
            purpose: 'any maskable',
          },
        ],
      },
    }),
  ],
})
