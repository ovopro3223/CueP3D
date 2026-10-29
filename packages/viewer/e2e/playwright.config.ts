import { defineConfig, devices } from '@playwright/test';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PORT = 4517;

export default defineConfig({
  testDir: './tests',
  testMatch: /.*\.spec\.ts/,
  timeout: 30_000,
  fullyParallel: false,
  workers: 1,
  // Strict locally. On the hosted CI runner (two cores, software-rendered
  // WebGL) the GPU-resource-count and long-task assertions can flake under
  // load without indicating a regression — retries there, never here.
  retries: process.env.CI ? 2 : 0,
  reporter: [['list']],
  use: {
    baseURL: `http://localhost:${PORT}/`,
    trace: 'retain-on-failure',
    launchOptions: {
      // Only matters on a GPU-less CI runner falling back to software
      // rendering — see packages/progressive-loader/playwright.config.ts
      // for why this flag (not --use-gl=swiftshader) is the right one.
      args: ['--enable-unsafe-swiftshader', '--autoplay-policy=no-user-gesture-required'],
    },
  },
  webServer: {
    command: 'node server.mjs',
    cwd: __dirname,
    port: PORT,
    reuseExistingServer: false,
    env: { VIEWER_TEST_PORT: String(PORT) },
  },
  projects: [{ name: 'chromium', use: { ...devices['Desktop Chrome'] } }],
});
