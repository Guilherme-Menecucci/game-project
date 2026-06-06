import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

export default defineConfig({
  plugins: [react()],
  server: {
    proxy: {
      '/api': {
        target: 'http://localhost:3000',
        rewrite: (path) => path.replace(/^\/api/, ''),
      },
      '/colyseus': {
        target: 'ws://localhost:2567',
        ws: true,
        rewriteWsOrigin: true,
        rewrite: (path) => path.replace(/^\/colyseus/, ''),
      },
    },
  },
})
