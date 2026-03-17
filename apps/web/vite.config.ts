import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'
import { resolve } from 'path'

export default defineConfig({
  plugins: [
    react({
      babel: {
        plugins: ['jotai/babel/plugin-react-refresh'],
      },
    }),
    tailwindcss(),
  ],
  root: __dirname,
  base: '/',
  resolve: {
    alias: {
      '@': resolve(__dirname, './src'),
      // Ensure all React imports resolve to the hoisted root node_modules
      'react': resolve(__dirname, '../../node_modules/react'),
      'react-dom': resolve(__dirname, '../../node_modules/react-dom'),
    },
    dedupe: ['react', 'react-dom'],
  },
  build: {
    outDir: 'dist',
    emptyDirBeforeWrite: true,
    sourcemap: true,
    target: 'esnext',
  },
  optimizeDeps: {
    include: ['react', 'react-dom'],
    esbuildOptions: {
      target: 'esnext',
    },
  },
  server: {
    port: 5175,
    open: true,
    proxy: {
      // Proxy WebSocket connections to headless server during dev
      '/ws': {
        target: 'ws://127.0.0.1:9100',
        ws: true,
      },
      // Proxy API calls to headless server during dev
      '/api': {
        target: 'http://127.0.0.1:9100',
        changeOrigin: true,
      },
    },
  },
})
