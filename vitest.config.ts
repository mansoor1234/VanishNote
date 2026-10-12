import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    include: ['tests/unit/**/*.test.ts', 'tests/integration/**/*.test.ts'],
    environment: 'node',
    // PBKDF2 at 600k iterations takes a few hundred ms per derivation.
    testTimeout: 30_000,
    hookTimeout: 60_000,
  },
});
