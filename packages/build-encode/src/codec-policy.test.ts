import { mkdtemp, readFile, readdir, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { assertFreeCodecs } from './codec-policy.js';
import { runFfmpeg } from './ffmpeg-process.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

describe('assertFreeCodecs', () => {
  let dir: string;

  beforeEach(async () => {
    dir = await mkdtemp(path.join(os.tmpdir(), 'build-encode-codec-policy-'));
  });

  afterEach(async () => {
    await rm(dir, { recursive: true, force: true });
  });

  it('accepts the repo-committed AV1/VP9/AVIF fixtures', async () => {
    const repoRoot = path.join(__dirname, '..', '..', '..');
    await expect(
      assertFreeCodecs([
        path.join(repoRoot, 'fixtures', 'proxy-fixture.av1.mp4'),
        path.join(repoRoot, 'fixtures', 'proxy-fixture.vp9.mp4'),
        path.join(repoRoot, 'fixtures', 'avif', '000.avif'),
      ]),
    ).resolves.toBeUndefined();
  });

  it('rejects a locally generated mpeg4 file (never committed) with a readable reason', async () => {
    const file = path.join(dir, 'legacy.mp4');
    await runFfmpeg([
      '-f',
      'lavfi',
      '-i',
      'testsrc2=size=64x64:rate=24:duration=0.2',
      '-frames:v',
      '4',
      '-c:v',
      'mpeg4',
      file,
    ]);
    await expect(assertFreeCodecs([file])).rejects.toThrow(/mpeg4/);
  }, 30_000);

  it('rejects a missing/unreadable file instead of throwing an opaque error', async () => {
    await expect(assertFreeCodecs([path.join(dir, 'does-not-exist.mp4')])).rejects.toThrow(
      /ffprobe failed/,
    );
  });
});

describe('source scan: no legacy codec identifiers in this package', () => {
  // These are the strings the brief forbids passing to ffmpeg under any
  // flag. This file and codec-policy.ts itself legitimately name them (as
  // data, to detect/test for them) so both are excluded here, same as
  // scripts/assert-free-codecs.mjs excludes itself from its own scan. That
  // root script does not yet know about these two files — see
  // docs/change-requests/P3-codec-policy-source-scan-exclusion.md.
  const BANNED = /libx264|libx265|h264_|hevc_|\bh264\b|\bhevc\b|\bavc1\b|\bhvc1\b|\bhev1\b/i;
  const EXCLUDED_FILES = new Set(['codec-policy.ts', 'codec-policy.test.ts']);

  async function collectSourceFiles(dir: string): Promise<string[]> {
    const entries = await readdir(dir, { withFileTypes: true });
    const files: string[] = [];
    for (const entry of entries) {
      if (entry.name === 'node_modules' || entry.name === 'dist') continue;
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) {
        files.push(...(await collectSourceFiles(full)));
      } else if (entry.name.endsWith('.ts') && !EXCLUDED_FILES.has(entry.name)) {
        files.push(full);
      }
    }
    return files;
  }

  it('contains no forbidden codec identifier outside the files that legitimately name them', async () => {
    const srcDir = path.join(__dirname);
    const files = await collectSourceFiles(srcDir);
    expect(files.length).toBeGreaterThan(0);

    const violations: string[] = [];
    for (const file of files) {
      const content = await readFile(file, 'utf8');
      const lines = content.split('\n');
      for (let i = 0; i < lines.length; i++) {
        const match = lines[i]!.match(BANNED);
        if (match) {
          violations.push(`${path.relative(srcDir, file)}:${i + 1}: "${match[0]}"`);
        }
      }
    }
    expect(violations).toEqual([]);
  });
});
