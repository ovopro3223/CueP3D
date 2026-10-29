import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    // Playwright specs live under e2e/ and are run by `playwright test`, not
    // vitest — same convention as proxy-player and progressive-loader.
    include: ['src/**/*.test.ts'],
  },
});
