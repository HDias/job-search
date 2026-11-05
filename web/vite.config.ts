import react from '@vitejs/plugin-react';
import { defineConfig } from 'vitest/config';

const API = 'http://localhost:3344';

/**
 * Em produção o mesmo Express serve o build de `web/dist`.
 * Em desenvolvimento, o Vite faz proxy para a API na 3344.
 */
export default defineConfig({
  plugins: [react()],
  server: {
    port: 5173,
    proxy: {
      '/api': API,
      '/applications': API,
      '/base_profile': API,
      '/cv': API,
      '/extras': API,
    },
  },
  test: {
    environment: 'jsdom',
    globals: true,
    setupFiles: './src/test/setup.ts',
    css: false,
  },
});
