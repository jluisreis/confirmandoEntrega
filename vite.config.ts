import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import { VitePWA } from 'vite-plugin-pwa'

export default defineConfig({
  plugins: [
    react(),
    VitePWA({
      registerType: 'autoUpdate',
      // deixa o service worker ativo também em "vite dev" pra facilitar testar
      devOptions: { enabled: true },
      manifest: {
        name: 'Painel de Entregas - Nobre Lar',
        short_name: 'Entregas',
        description: 'Confirmação de entregas com sincronização offline',
        theme_color: '#0f172a',
        background_color: '#0f172a',
        display: 'standalone',
        start_url: '/',
        icons: [
          { src: '/vite.svg', sizes: 'any', type: 'image/svg+xml', purpose: 'any maskable' },
        ],
      },
      workbox: {
        // app shell: HTML/JS/CSS ficam disponíveis offline
        globPatterns: ['**/*.{js,css,html,ico,png,svg}'],
        // não tenta cachear/interceptar as chamadas ao Apps Script — essas
        // são tratadas pelo cache manual em offline-store.ts (mais controle
        // sobre quando usar dado salvo vs. buscar de novo)
        navigateFallbackDenylist: [/^\/macros\//],
        runtimeCaching: [],
      },
    }),
  ],
})
