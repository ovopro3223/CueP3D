import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    // Playwright specs live under tests/ and are run by `playwright test`,
    // not vitest — vitest's default include would otherwise also pick up
    // *.spec.ts and try to run them in Node.
    include: ['src/**/*.test.ts'],
  },
});
