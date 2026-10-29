#!/usr/bin/env node
/**
 * Enforces D-004 (AV1 only — see docs/codec-policy.md for the policy this
 * script is not the place to restate):
 *   1. ffprobe every media file under the given directories; only
 *      `av1`/`vp9` codec_names are allowed.
 *   2. grep the source tree for forbidden codec identifiers, so a stray
 *      legacy encoder flag in a script fails CI even before it produces a
 *      file. SOURCE_IGNORE_FILES excludes this file plus any package's own
 *      codec-policy definition/test (they legitimately hold these
 *      identifiers as data, to detect and reject them) — see
 *      docs/change-requests/P3-codec-policy-source-scan-exclusion.md.
 * Exit 0 and prints nothing when clean; exit 1 with a readable report
 * otherwise.
 */
import { execFile } from 'node:child_process';
import { readdir, readFile } from 'node:fs/promises';
import path from 'node:path';
import { promisify } from 'node:util';

const execFileAsync = promisify(execFile);

const MEDIA_EXTENSIONS = new Set(['.mp4', '.m4v', '.avif', '.webm', '.mkv']);
const ALLOWED_CODECS = new Set(['av1', 'vp9']);

const FORBIDDEN_TOKENS = [
  'libx264',
  'libx265',
  'h264_',
  'hevc_',
  'avc1',
  'hvc1',
  'hev1',
  'h264',
  'hevc',
];
const FORBIDDEN_SOURCE_PATTERN = new RegExp(
  `\\b(${FORBIDDEN_TOKENS.map((t) => t.replace('_', '_?')).join('|')})`,
  'i',
);
const SOURCE_EXTENSIONS = new Set([
  '.ts',
  '.tsx',
  '.js',
  '.mjs',
  '.cjs',
  '.sh',
  '.ps1',
  '.yml',
  '.yaml',
]);
const SOURCE_SCAN_ROOTS = ['packages', 'apps', 'bench', 'scripts', '.github'];
const SOURCE_IGNORE_DIRS = new Set(['node_modules', 'dist', 'coverage', '.turbo']);
// This file names the forbidden identifiers in order to detect them; it is
// the one file that legitimately needs to, so it does not scan itself.
const SOURCE_IGNORE_FILES = new Set([
  'assert-free-codecs.mjs',
  'codec-policy.ts',
  'codec-policy.test.ts',
]);

async function walk(dir, onFile) {
  let entries;
  try {
    entries = await readdir(dir, { withFileTypes: true });
  } catch (error) {
    if (error.code === 'ENOENT') return;
    throw error;
  }
  for (const entry of entries) {
    if (entry.name.startsWith('.') && entry.name !== '.github') continue;
    if (SOURCE_IGNORE_DIRS.has(entry.name)) continue;
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      await walk(full, onFile);
    } else {
      await onFile(full);
    }
  }
}

async function findMediaFiles(dirs) {
  const files = [];
  for (const dir of dirs) {
    await walk(dir, (file) => {
      if (MEDIA_EXTENSIONS.has(path.extname(file).toLowerCase())) files.push(file);
    });
  }
  return files;
}

async function probeCodec(file) {
  const { stdout } = await execFileAsync('ffprobe', [
    '-v',
    'error',
    '-select_streams',
    'v:0',
    '-show_entries',
    'stream=codec_name',
    '-of',
    'csv=p=0',
    file,
  ]);
  return stdout.trim().toLowerCase();
}

async function checkMedia(dirs) {
  const files = await findMediaFiles(dirs);
  const violations = [];
  for (const file of files) {
    let codec;
    try {
      codec = await probeCodec(file);
    } catch (error) {
      violations.push(`${file}: ffprobe failed (${error.message.split('\n')[0]})`);
      continue;
    }
    if (!ALLOWED_CODECS.has(codec)) {
      violations.push(
        `${file}: codec "${codec}" is not allowed (allowed: ${[...ALLOWED_CODECS].join(', ')})`,
      );
    }
  }
  return { checked: files.length, violations };
}

async function checkSource() {
  const violations = [];
  let checked = 0;
  for (const root of SOURCE_SCAN_ROOTS) {
    await walk(root, async (file) => {
      if (!SOURCE_EXTENSIONS.has(path.extname(file).toLowerCase())) return;
      if (SOURCE_IGNORE_FILES.has(path.basename(file))) return;
      checked += 1;
      const content = await readFile(file, 'utf8');
      const lines = content.split('\n');
      for (let i = 0; i < lines.length; i++) {
        const match = lines[i].match(FORBIDDEN_SOURCE_PATTERN);
        if (match) {
          violations.push(`${file}:${i + 1}: forbidden codec identifier "${match[0]}"`);
        }
      }
    });
  }
  return { checked, violations };
}

async function main() {
  const mediaDirs = process.argv.slice(2);
  if (mediaDirs.length === 0) {
    console.error('Usage: assert-free-codecs.mjs <dir> [dir...]');
    process.exitCode = 1;
    return;
  }

  const [media, source] = await Promise.all([checkMedia(mediaDirs), checkSource()]);
  const allViolations = [...media.violations, ...source.violations];

  if (allViolations.length > 0) {
    console.error('Codec policy violations (D-004 — AV1 only, no H.264/H.265):\n');
    for (const v of allViolations) console.error(`  - ${v}`);
    console.error(`\n${media.checked} media file(s) and ${source.checked} source file(s) scanned.`);
    process.exitCode = 1;
    return;
  }

  console.log(
    `assert-free-codecs: clean (${media.checked} media file(s), ${source.checked} source file(s) scanned).`,
  );
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
