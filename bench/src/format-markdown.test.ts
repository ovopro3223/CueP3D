import { describe, expect, it } from 'vitest';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { formatMarkdown } from './format-markdown.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(__dirname, '..', '..');

describe('formatMarkdown', () => {
  it('pads an unaligned markdown table using the repo prettier config', async () => {
    const raw = '| a | bb |\n| --- | --- |\n| 1 | 22 |\n';
    const formatted = await formatMarkdown(raw, path.join(repoRoot, 'BENCHMARKS.md'));
    expect(formatted).toContain('| a   | bb  |');
    expect(formatted).toContain('| --- | --- |');
  });

  it('is idempotent on already-formatted markdown', async () => {
    const raw = '| a   | bb  |\n| --- | --- |\n| 1   | 22  |\n';
    const formatted = await formatMarkdown(raw, path.join(repoRoot, 'BENCHMARKS.md'));
    expect(formatted).toBe(raw);
  });
});
