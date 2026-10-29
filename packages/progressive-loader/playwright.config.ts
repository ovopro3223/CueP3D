import { defineConfig, devices } from '@playwright/test';

const PORT = 4319;

export default defineConfig({
  testDir: './tests',
  testMatch: /.*\.spec\.ts/,
  fullyParallel: false,
  retries: 0,
  reporter: 'line',
  use: {
    baseURL: `http://localhost:${PORT}/`,
    launchOptions: {
      // Only takes effect if Chromium falls back to software rendering (no
      // GPU, e.g. most CI runners) — recent Chrome versions otherwise block
      // WebGL on SwiftShader outright. Forcing swiftshader unconditionally
      // (--use-gl=swiftshader) caused WebGL context loss when a real GPU
      // was also available, so it is deliberately not set here.
      args: ['--enable-unsafe-swiftshader'],
    },
  },
  webServer: {
    command: `node tests/server.mjs`,
    port: PORT,
    reuseExistingServer: false,
    env: { PL_TEST_PORT: String(PORT) },
  },
  projects: [
    {
      name: 'chromium',
      use: { ...devices['Desktop Chrome'] },
    },
  ],
});
