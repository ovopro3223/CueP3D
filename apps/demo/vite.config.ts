import { defineConfig } from 'vite';

// GitHub Pages serves a project site from /<repo-name>/. D-002 settled the npm
// scope (@understudy3d) but not the GitHub repo name yet (see P7a report,
// open questions) — overridable via env so CI can set the real path without
// editing this file.
const PAGES_BASE = process.env.UNDERSTUDY_DEMO_BASE ?? '/understudy/';

export default defineConfig({
  base: PAGES_BASE,
  build: {
    target: 'es2022',
  },
  server: {
    fs: {
      strict: true,
    },
  },
  // @understudy3d/viewer doesn't exist in this worktree yet (see
  // docs/reports/P7a-report.md) — without this, Vite's dep-scan crawls the
  // dynamic import in understudy-pane.ts at dev-server startup and the
  // whole server fails to start, not just that one pane.
  optimizeDeps: {
    exclude: ['@understudy3d/viewer'],
  },
});
