import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    // This package also has e2e/tests/*.spec.ts, which are Playwright
    // specs (run via `playwright test`, not Vitest) and use
    // test.describe() outside a Playwright runner context — Vitest's
    // default glob would otherwise pick them up and fail to run them.
    include: ['src/**/*.test.ts'],
  },
});
