import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    environment: 'node',
    include: ['tests/**/*.test.{js,mjs,cjs}'],
    reporters: 'default',
    pool: 'forks',
    testTimeout: 10000
  }
});
