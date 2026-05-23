import react from '@vitejs/plugin-react'
import { defineConfig } from 'vitest/config'

/** Vite config for the browser-only React SPA and Vitest suite. */
export default defineConfig({
  plugins: [react()],
  test: {
    environment: 'jsdom',
    setupFiles: ['./src/test/setup.ts'],
    exclude: ['node_modules/**', 'dist/**', 'e2e/**'],
  },
})
