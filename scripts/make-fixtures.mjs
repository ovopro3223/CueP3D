#!/usr/bin/env node
/**
 * Generates the committed test fixtures used by packages/proxy-player (P4):
 * a 72-frame, 256x256, GOP-8 numbered pattern encoded as AV1 MP4, VP9 MP4,
 * and an AVIF still-image sequence — all from the same source frames, so a
 * decoded frame's content can be checked against its expected index.
 *
 * Every output is one of the two codecs D-004 allows, even though the
 * installed ffmpeg build also provides the royalty-bearing legacy ones.
 */
import { execFile } from 'node:child_process';
import { mkdir, readdir, rm } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { promisify } from 'node:util';

const execFileAsync = promisify(execFile);

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const root = path.join(__dirname, '..');
const fixturesDir = path.join(root, 'fixtures');
const avifDir = path.join(fixturesDir, 'avif');
const tmpDir = path.join(fixturesDir, '.tmp');

const FRAMES = 72;
const SIZE = 256;
const FPS = 24;
const GOP = 8;

const FONT =
  process.platform === 'win32'
    ? 'C\\:/Windows/Fonts/arial.ttf'
    : '/usr/share/fonts/truetype/dejavu/DejaVuSans-Bold.ttf';

async function run(args) {
  console.log('ffmpeg', args.join(' '));
  await execFileAsync('ffmpeg', args);
}

async function main() {
  await rm(tmpDir, { recursive: true, force: true });
  await mkdir(tmpDir, { recursive: true });
  await mkdir(avifDir, { recursive: true });

  const drawtext =
    `drawtext=fontfile='${FONT}':text='%{eif\\:n\\:d\\:3}':` +
    `x=(w-tw)/2:y=(h-th)/2:fontsize=64:fontcolor=white:box=1:boxcolor=black@0.6:boxborderw=12`;
  const source = `testsrc2=size=${SIZE}x${SIZE}:rate=${FPS}:duration=${FRAMES / FPS}`;

  // 1. Numbered PNG frames — the ground truth both video fixtures and the
  // AVIF sequence are encoded from, and what P4's Playwright tests compare
  // decoded frames against.
  await run([
    '-y',
    '-f',
    'lavfi',
    '-i',
    `${source},${drawtext}`,
    '-frames:v',
    String(FRAMES),
    '-start_number',
    '0',
    path.join(tmpDir, '%03d.png'),
  ]);

  // 2. AV1 MP4 — primary proxy fixture
  await run([
    '-y',
    '-framerate',
    String(FPS),
    '-start_number',
    '0',
    '-i',
    path.join(tmpDir, '%03d.png'),
    '-c:v',
    'libaom-av1',
    '-crf',
    '28',
    '-b:v',
    '0',
    '-cpu-used',
    '6',
    '-g',
    String(GOP),
    '-keyint_min',
    String(GOP),
    '-pix_fmt',
    'yuv420p',
    '-movflags',
    '+faststart',
    path.join(fixturesDir, 'proxy-fixture.av1.mp4'),
  ]);

  // 3. VP9 MP4 — royalty-free fallback fixture
  await run([
    '-y',
    '-framerate',
    String(FPS),
    '-start_number',
    '0',
    '-i',
    path.join(tmpDir, '%03d.png'),
    '-c:v',
    'libvpx-vp9',
    '-crf',
    '32',
    '-b:v',
    '0',
    '-g',
    String(GOP),
    '-pix_fmt',
    'yuv420p',
    '-movflags',
    '+faststart',
    path.join(fixturesDir, 'proxy-fixture.vp9.mp4'),
  ]);

  // 4. AVIF sequence — last-resort fallback fixture, one still per frame
  const pngFiles = (await readdir(tmpDir)).filter((f) => f.endsWith('.png')).sort();
  for (const file of pngFiles) {
    const index = path.basename(file, '.png');
    await run([
      '-y',
      '-i',
      path.join(tmpDir, file),
      '-c:v',
      'libaom-av1',
      '-still-picture',
      '1',
      '-crf',
      '24',
      path.join(avifDir, `${index}.avif`),
    ]);
  }

  await rm(tmpDir, { recursive: true, force: true });
  console.log(`Wrote ${FRAMES} frames -> AV1 mp4, VP9 mp4, ${pngFiles.length} AVIF stills.`);
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
