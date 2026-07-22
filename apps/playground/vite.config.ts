import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

export default defineConfig({
  plugins: [react()],
  server: {
    proxy: {
      '/stt': 'http://localhost:8787',
      '/llm': 'http://localhost:8787',
    },
  },
})
