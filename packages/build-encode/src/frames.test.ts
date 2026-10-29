import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { readFrameSequence } from './frames.js';

async function touchFiles(dir: string, names: string[]): Promise<void> {
  await Promise.all(names.map((name) => writeFile(path.join(dir, name), '')));
}

describe('readFrameSequence', () => {
  let dir: string;

  beforeEach(async () => {
    dir = await mkdtemp(path.join(os.tmpdir(), 'build-encode-frames-'));
  });

  afterEach(async () => {
    await rm(dir, { recursive: true, force: true });
  });

  it('reads a contiguous zero-padded sequence sorted numerically', async () => {
    await touchFiles(dir, ['002.png', '000.png', '001.png']);
    const sequence = await readFrameSequence(dir);
    expect(sequence.files).toEqual(['000.png', '001.png', '002.png']);
    expect(sequence.count).toBe(3);
    expect(sequence.padWidth).toBe(3);
    expect(sequence.pattern).toBe('%03d.png');
  });

  it('ignores non-matching files in the directory', async () => {
    await touchFiles(dir, ['000.png', '001.png', 'camera.json', 'notes.txt']);
    const sequence = await readFrameSequence(dir);
    expect(sequence.files).toEqual(['000.png', '001.png']);
  });

  it('throws when the directory has no frames', async () => {
    await expect(readFrameSequence(dir)).rejects.toThrow(/no "NNN\.png" frames/);
  });

  it('throws when the directory does not exist', async () => {
    await expect(readFrameSequence(path.join(dir, 'missing'))).rejects.toThrow(
      /cannot read framesDir/,
    );
  });

  it('throws on a non-contiguous sequence (gap)', async () => {
    await touchFiles(dir, ['000.png', '002.png']);
    await expect(readFrameSequence(dir)).rejects.toThrow(/not contiguous/);
  });

  it('throws on a sequence that does not start at 0', async () => {
    await touchFiles(dir, ['001.png', '002.png']);
    await expect(readFrameSequence(dir)).rejects.toThrow(/not contiguous/);
  });

  it('throws on inconsistent zero-padding', async () => {
    await touchFiles(dir, ['000.png', '01.png']);
    await expect(readFrameSequence(dir)).rejects.toThrow(/inconsistent zero-padding/);
  });

  it('infers a different pad width (e.g. 4 digits) correctly', async () => {
    await mkdir(dir, { recursive: true });
    await touchFiles(dir, ['0000.png', '0001.png']);
    const sequence = await readFrameSequence(dir);
    expect(sequence.padWidth).toBe(4);
    expect(sequence.pattern).toBe('%04d.png');
  });
});
