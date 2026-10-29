#!/usr/bin/env node
/**
 * Builds apps/demo/public/models/<slug>/ for the three demo models by
 * running the real CLI (packages/cli/dist/bin.js), then copies each raw
 * sample .glb alongside the CLI output as original.glb — that's what the
 * Plain pane loads, deliberately un-optimized, so the comparison is honest.
 * Output is git-ignored (see root .gitignore) and rebuilt by this script,
 * not committed.
 */
import { copyFileSync, existsSync, mkdirSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const demoDir = path.join(__dirname, '..');
const repoRoot = path.join(demoDir, '..', '..');
const cliBin = path.join(repoRoot, 'packages', 'cli', 'dist', 'bin.js');
const samplesDir = path.join(repoRoot, 'samples');
const outDir = path.join(demoDir, 'public', 'models');

// progressive-loader's KTX2 transcoder path is resolved per-manifest, relative
// to that model's own understudy.json (DEFAULT_KTX2_TRANSCODER_PATH = './basis/'
// in packages/progressive-loader/src/loader.ts) — each model needs its own copy.
// Without this, those requests 404 and Vite's dev-server SPA fallback serves
// index.html for them with a 200 status, which hangs KTX2 transcoding forever
// instead of failing loudly (verified directly: 'warming' never advances).
const require = createRequire(import.meta.url);
const basisSrcDir = path.dirname(
  require.resolve('three/examples/jsm/libs/basis/basis_transcoder.js'),
);

const MODELS = [
  { slug: 'avocado', file: 'Avocado.glb' },
  { slug: 'boombox', file: 'BoomBox.glb' },
  { slug: 'waterbottle', file: 'WaterBottle.glb' },
];

// toktx (KTX-Software) ships outside the default PATH on a fresh shell on
// this machine; append its usual Windows install location if it's not
// already reachable, rather than making every invocation remember to.
const KTX_BIN = 'C:\\Program Files\\KTX-Software\\bin';
const env = { ...process.env };
if (existsSync(KTX_BIN) && !env.PATH?.split(path.delimiter).includes(KTX_BIN)) {
  env.PATH = `${env.PATH}${path.delimiter}${KTX_BIN}`;
}

function run(args) {
  const result = spawnSync(process.execPath, args, { stdio: 'inherit', env });
  if (result.status !== 0) {
    throw new Error(`command failed (${String(result.status)}): node ${args.join(' ')}`);
  }
}

function main() {
  if (!existsSync(cliBin)) {
    throw new Error(
      `CLI not built: ${cliBin} does not exist. Run "pnpm run build" at the repo root first.`,
    );
  }

  mkdirSync(outDir, { recursive: true });

  for (const model of MODELS) {
    const inputGlb = path.join(samplesDir, model.file);
    if (!existsSync(inputGlb)) {
      throw new Error(
        `Sample not found: ${inputGlb}. Run "pnpm run fetch-samples" at the repo root first.`,
      );
    }

    const modelOutDir = path.join(outDir, model.slug);
    console.log(`\n[demo:assets] building ${model.slug} from ${model.file}...`);
    run([cliBin, 'build', inputGlb, '-o', modelOutDir, '--frames', '72']);

    copyFileSync(inputGlb, path.join(modelOutDir, 'original.glb'));
    console.log(
      `[demo:assets] wrote ${path.join(modelOutDir, 'original.glb')} (Plain pane source)`,
    );

    const basisOutDir = path.join(modelOutDir, 'basis');
    mkdirSync(basisOutDir, { recursive: true });
    for (const file of ['basis_transcoder.js', 'basis_transcoder.wasm']) {
      copyFileSync(path.join(basisSrcDir, file), path.join(basisOutDir, file));
    }
    console.log(`[demo:assets] copied KTX2 transcoder to ${basisOutDir}`);
  }

  console.log('\n[demo:assets] done.');
}

main();
