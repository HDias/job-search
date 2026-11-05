import { defineConfig } from 'vitest/config';

/**
 * Testes do backend. O frontend tem o próprio Vitest em `web/vite.config.ts`,
 * com ambiente jsdom. Sem este include, o Vitest da raiz tentaria rodar os
 * testes de `web/` no ambiente Node.
 */
export default defineConfig({
  test: {
    include: ['test/**/*.test.ts'],
  },
});
