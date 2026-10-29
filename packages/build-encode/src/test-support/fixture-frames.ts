import { mkdir } from 'node:fs/promises';
import path from 'node:path';
import { runFfmpeg } from '../ffmpeg-process.js';

export interface FixtureFramesOptions {
  dir: string;
  frames: number;
  size: number;
  fps: number;
}

const FONT =
  process.platform === 'win32'
    ? 'C\\:/Windows/Fonts/arial.ttf'
    : '/usr/share/fonts/truetype/dejavu/DejaVuSans-Bold.ttf';

/**
 * Generates a numbered-pattern "NNN.png" source sequence the same way
 * scripts/make-fixtures.mjs does, for tests to run against when
 * fixtures/frames (raw numbered PNGs, as opposed to the already-encoded
 * fixtures/proxy-fixture.*) is absent, which it is in this repo.
 */
export async function generateFixtureFrames(opts: FixtureFramesOptions): Promise<void> {
  await mkdir(opts.dir, { recursive: true });
  const drawtext =
    `drawtext=fontfile='${FONT}':text='%{eif\\:n\\:d\\:3}':` +
    `x=(w-tw)/2:y=(h-th)/2:fontsize=${Math.max(16, Math.round(opts.size / 8))}:fontcolor=white:box=1:boxcolor=black@0.6:boxborderw=12`;
  const source = `testsrc2=size=${opts.size}x${opts.size}:rate=${opts.fps}:duration=${opts.frames / opts.fps}`;

  await runFfmpeg([
    '-f',
    'lavfi',
    '-i',
    `${source},${drawtext}`,
    '-frames:v',
    String(opts.frames),
    '-start_number',
    '0',
    path.join(opts.dir, '%03d.png'),
  ]);
}
