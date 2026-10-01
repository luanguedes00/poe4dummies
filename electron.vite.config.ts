import { resolve } from 'node:path'
import { defineConfig } from 'electron-vite'
import react from '@vitejs/plugin-react'

export default defineConfig({
  main: {
    build: { externalizeDeps: true },
  },
  preload: {
    // O preload roda com sandbox: só pode importar 'electron'. Nada externo.
    build: { externalizeDeps: false },
  },
  renderer: {
    root: resolve(__dirname, 'src/renderer'),
    plugins: [react()],
    build: {
      rollupOptions: {
        input: {
          dashboard: resolve(__dirname, 'src/renderer/dashboard.html'),
          overlay: resolve(__dirname, 'src/renderer/overlay.html'),
          campaign: resolve(__dirname, 'src/renderer/campaign.html'),
        },
      },
    },
  },
})
