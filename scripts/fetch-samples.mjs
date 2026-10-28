#!/usr/bin/env node
/**
 * Downloads the sample glTF models used by tests, the demo and benchmarks
 * from KhronosGroup/glTF-Sample-Assets at a pinned commit, and writes
 * samples/LICENSES.md with attributions read from each model's own
 * metadata.json. See docs/00-decisions.md D-005a for why these three models.
 */
import { createWriteStream, existsSync, mkdirSync } from 'node:fs';
import { writeFile } from 'node:fs/promises';
import { pipeline } from 'node:stream/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const PINNED_SHA = '8f492390ddc7a2ae221a1369ef560589cf8c70fb';
const REPO = 'KhronosGroup/glTF-Sample-Assets';
const RAW_BASE = `https://raw.githubusercontent.com/${REPO}/${PINNED_SHA}`;

const MODELS = [
  { name: 'Avocado', dir: 'Avocado' },
  { name: 'BoomBox', dir: 'BoomBox' },
  { name: 'WaterBottle', dir: 'WaterBottle' },
];

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const samplesDir = path.join(__dirname, '..', 'samples');

async function fetchJson(url) {
  const res = await fetch(url);
  if (!res.ok) throw new Error(`GET ${url} -> ${res.status} ${res.statusText}`);
  return res.json();
}

async function downloadFile(url, destPath) {
  const res = await fetch(url);
  if (!res.ok) throw new Error(`GET ${url} -> ${res.status} ${res.statusText}`);
  if (!res.body) throw new Error(`GET ${url} -> empty body`);
  await pipeline(res.body, createWriteStream(destPath));
}

function formatAttribution(model, metadata) {
  const lines = [
    `### ${model.name}`,
    '',
    `Source: \`${model.dir}/glTF-Binary/${model.name}.glb\` at`,
    `${REPO}@${PINNED_SHA}`,
    '',
  ];
  for (const entry of metadata.legal) {
    const who = entry.owner && entry.owner !== 'Public' ? entry.owner : entry.artist;
    lines.push(
      `- **${entry.what}** — ${who} (${entry.year}), ${entry.text} ([${entry.spdx ?? entry.license}](${entry.licenseUrl}))`,
    );
  }
  lines.push('');
  return lines.join('\n');
}

async function main() {
  mkdirSync(samplesDir, { recursive: true });

  const licenseSections = [
    '# Sample model licenses',
    '',
    'Downloaded by `scripts/fetch-samples.mjs` — do not edit by hand, re-run the script instead.',
    '',
    `Pinned at ${REPO}@${PINNED_SHA}. See docs/00-decisions.md D-005a for why these three models were chosen.`,
    '',
  ];

  for (const model of MODELS) {
    const glbUrl = `${RAW_BASE}/Models/${model.dir}/glTF-Binary/${model.name}.glb`;
    const metadataUrl = `${RAW_BASE}/Models/${model.dir}/metadata.json`;
    const destPath = path.join(samplesDir, `${model.name}.glb`);

    if (existsSync(destPath)) {
      console.log(`skip ${model.name}.glb (already present)`);
    } else {
      console.log(`fetching ${model.name}.glb ...`);
      await downloadFile(glbUrl, destPath);
    }

    const metadata = await fetchJson(metadataUrl);
    licenseSections.push(formatAttribution(model, metadata));
  }

  await writeFile(path.join(samplesDir, 'LICENSES.md'), licenseSections.join('\n'));
  console.log('wrote samples/LICENSES.md');
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
