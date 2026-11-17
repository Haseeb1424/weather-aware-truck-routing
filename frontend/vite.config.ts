import tailwindcss from '@tailwindcss/vite'
import react from '@vitejs/plugin-react'
import { defineConfig } from 'vite'

export default defineConfig({
  plugins: [react(), tailwindcss()],
  build: {
    rollupOptions: {
      // MapLibre is large and rarely changes; a separate chunk caches well.
      output: { manualChunks: { maplibre: ['maplibre-gl', 'react-map-gl/maplibre'] } },
    },
    chunkSizeWarningLimit: 1100,
  },
  server: {
    port: 5180,
    proxy: { '/api': 'http://127.0.0.1:8000' },
  },
})
