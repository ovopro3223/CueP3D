import { defineConfig, type Plugin, type Rollup } from 'vite';

// GitHub Pages serves a project site from /<repo-name>/. D-002 settled the npm
// scope (@cuep3d) but not the GitHub repo name yet (see P7a report,
// open questions) — overridable via env so CI can set the real path without
// editing this file.
const PAGES_BASE = process.env.CUEP3D_DEMO_BASE ?? '/cuep3d/';

/**
 * D-014: the CueP3D pane is a dynamic `import('@cuep3d/viewer')`, so without
 * help the browser only learns about the viewer's chunks after the entry
 * module has downloaded and run — one extra round trip plus the entry's
 * bytes on a slow link. This plugin finds the chunk Rollup made for that
 * import, walks its static import graph (three.js, mp4box, the viewer and
 * its contracts — not the lazily imported progressive-loader chunk), and
 * injects a tiny inline script that adds `<link rel="modulepreload">` for
 * each, so those requests leave as soon as the HTML is parsed. The script
 * skips them for `?mode=plain` (the bench's Plain column) so that column
 * never pays for CueP3D's code; the Plain pane's own chunk is loaded by its
 * dynamic import as before. Only chunks the browser would fetch anyway are
 * preloaded, never speculatively.
 */
function preloadCueP3DPath(): Plugin {
  let base = '/';
  return {
    name: 'cuep3d:preload-viewer-path',
    configResolved(config) {
      base = config.base;
    },
    transformIndexHtml: {
      order: 'post',
      handler(_html, ctx) {
        const bundle: Rollup.OutputBundle | undefined = ctx.bundle;
        if (!bundle) return;
        const chunks = Object.values(bundle).filter(
          (item): item is Rollup.OutputChunk => item.type === 'chunk',
        );
        // By module membership, not `facadeModuleId`: Rollup reports no facade
        // for this chunk once the viewer's entry module shares it with the
        // packages it re-exports.
        const isViewerEntryModule = (id: string): boolean =>
          /[\\/]viewer[\\/]dist[\\/]index\.js$/.test(id);
        const viewerEntry = chunks.find((chunk) => chunk.moduleIds.some(isViewerEntryModule));
        if (!viewerEntry) return;
        const files = new Set<string>();
        const visit = (chunk: Rollup.OutputChunk): void => {
          if (files.has(chunk.fileName)) return;
          files.add(chunk.fileName);
          for (const imported of chunk.imports) {
            const dep = bundle[imported];
            if (dep?.type === 'chunk') visit(dep);
          }
        };
        visit(viewerEntry);
        const hrefs = JSON.stringify([...files].map((file) => `${base}${file}`));
        return [
          {
            tag: 'script',
            injectTo: 'head-prepend',
            children:
              `if(new URLSearchParams(location.search).get('mode')!=='plain'){` +
              `for(const h of ${hrefs}){const l=document.createElement('link');` +
              `l.rel='modulepreload';l.crossOrigin='';l.href=h;document.head.appendChild(l);}}`,
          },
        ];
      },
    },
  };
}

export default defineConfig({
  base: PAGES_BASE,
  plugins: [preloadCueP3DPath()],
  build: {
    target: 'es2022',
    rollupOptions: {
      output: {
        // three.js core (plus the controls/environment modules both panes
        // use) is one shared chunk; its loaders and their WASM blobs
        // (GLTFLoader, KTX2Loader, zstd, ktx-parse) stay with whichever
        // lazily loaded chunk needs them — the Plain pane or the viewer's
        // progressive-loader — so none of it is on the path to the first
        // CueP3D frame (D-014).
        manualChunks(id) {
          const normalized = id.replace(/\\/g, '/');
          if (
            normalized.includes('/node_modules/three/') &&
            !/\/examples\/jsm\/(loaders|libs)\//.test(normalized)
          ) {
            return 'three';
          }
          return undefined;
        },
      },
    },
  },
  server: {
    fs: {
      strict: true,
    },
  },
  // @cuep3d/viewer doesn't exist in this worktree yet (see
  // docs/reports/P7a-report.md) — without this, Vite's dep-scan crawls the
  // dynamic import in cuep3d-pane.ts at dev-server startup and the
  // whole server fails to start, not just that one pane.
  optimizeDeps: {
    exclude: ['@cuep3d/viewer'],
  },
});
