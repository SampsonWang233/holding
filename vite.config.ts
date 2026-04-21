import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

// https://vite.dev/config/
export default defineConfig({
  plugins: [react()],
  server: {
    proxy: {
      // Lets Yahoo Finance quotes work locally without exposing an API key (production: use Finnhub — see .env.example).
      '/yahoo-proxy': {
        target: 'https://query1.finance.yahoo.com',
        changeOrigin: true,
        rewrite: (path) => path.replace(/^\/yahoo-proxy/, ''),
      },
    },
  },
})
