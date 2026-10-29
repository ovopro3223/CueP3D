import { defineConfig } from '@playwright/test';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PORT = 4873;

export default defineConfig({
  testDir: './tests',
  timeout: 30_000,
  fullyParallel: false,
  workers: 1,
  // Strict locally; retries only on the slower hosted CI runner (see
  // packages/viewer/e2e/playwright.config.ts).
  retries: process.env.CI ? 2 : 0,
  reporter: [['list']],
  use: {
    baseURL: `http://localhost:${PORT}`,
    trace: 'retain-on-failure',
  },
  webServer: {
    command: `node server.mjs`,
    cwd: __dirname,
    port: PORT,
    reuseExistingServer: false,
    env: { PORT: String(PORT) },
  },
  projects: [{ name: 'chromium', use: { browserName: 'chromium' } }],
});
