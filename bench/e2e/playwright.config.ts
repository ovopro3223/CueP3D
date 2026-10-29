import { defineConfig, devices } from '@playwright/test';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PORT = 4591;

export default defineConfig({
  testDir: '.',
  testMatch: /.*\.spec\.ts/,
  timeout: 30_000,
  fullyParallel: false,
  workers: 1,
  retries: 0,
  reporter: [['list']],
  use: {
    baseURL: `http://localhost:${String(PORT)}/`,
    trace: 'retain-on-failure',
    launchOptions: {
      // Matches packages/viewer/e2e/playwright.config.ts: only matters on a
      // GPU-less CI runner falling back to software rendering.
      args: ['--enable-unsafe-swiftshader', '--autoplay-policy=no-user-gesture-required'],
    },
  },
  webServer: {
    command: 'node ../dist/bin/serve-demo.js',
    cwd: __dirname,
    port: PORT,
    reuseExistingServer: false,
    timeout: 60_000,
    env: { BENCH_DEMO_PORT: String(PORT) },
  },
  projects: [{ name: 'chromium', use: { ...devices['Desktop Chrome'] } }],
});
