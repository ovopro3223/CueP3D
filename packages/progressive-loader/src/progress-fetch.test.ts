import { describe, expect, it, vi } from 'vitest';
import { fetchWithProgress } from './progress-fetch.js';

function fakeResponse(totalBytes: number, chunkSize: number): Response {
  const full = new Uint8Array(totalBytes);
  for (let i = 0; i < totalBytes; i++) full[i] = i % 256;

  let offset = 0;
  const stream = new ReadableStream<Uint8Array>({
    pull(controller) {
      if (offset >= totalBytes) {
        controller.close();
        return;
      }
      const end = Math.min(offset + chunkSize, totalBytes);
      controller.enqueue(full.slice(offset, end));
      offset = end;
    },
  });

  return new Response(stream, { status: 200 });
}

describe('fetchWithProgress', () => {
  it('reports monotonically increasing progress ending at the total byte count', async () => {
    const totalBytes = 10_000;
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => fakeResponse(totalBytes, 1_000)),
    );

    const seen: number[] = [];
    const buffer = await fetchWithProgress('https://example.test/model.glb', (bytes) => {
      seen.push(bytes);
    });

    expect(buffer.byteLength).toBe(totalBytes);
    expect(seen.length).toBeGreaterThan(1);
    expect(seen.at(-1)).toBe(totalBytes);
    for (let i = 1; i < seen.length; i++) {
      expect(seen[i]).toBeGreaterThan(seen[i - 1] as number);
    }

    vi.unstubAllGlobals();
  });

  it('returns the exact bytes received', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => fakeResponse(257, 64)),
    );

    const buffer = await fetchWithProgress('https://example.test/model.glb');
    const bytes = new Uint8Array(buffer);
    expect(bytes.length).toBe(257);
    expect(bytes[0]).toBe(0);
    expect(bytes[256]).toBe(256 % 256);

    vi.unstubAllGlobals();
  });

  it('rejects on a non-ok response', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => new Response(null, { status: 404, statusText: 'Not Found' })),
    );

    await expect(fetchWithProgress('https://example.test/missing.glb')).rejects.toThrow(/404/);

    vi.unstubAllGlobals();
  });
});
