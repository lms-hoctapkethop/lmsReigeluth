import { defineConfig } from 'vite'

export default defineConfig({
  appType: 'spa',
  server: {
    host: 'localhost',
    port: 5173,
    proxy: {
      '/api': 'http://127.0.0.1:4319',
      '/auth': 'http://127.0.0.1:4319',
    },
  },
  build: { outDir: 'dist', emptyOutDir: true, sourcemap: 'hidden' },
})
