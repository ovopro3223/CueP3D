/**
 * Deliberately standalone, not imported from @understudy3d/progressive-loader
 * (which has the same helper): the Plain pane is meant to be the naive,
 * independent baseline everyone actually ships today, not a consumer of
 * Understudy's own optimized loading code.
 */
export async function fetchWithProgress(
  url: string,
  init: RequestInit,
  onProgress?: (bytesLoaded: number) => void,
): Promise<ArrayBuffer> {
  const response = await fetch(url, init);
  if (!response.ok) {
    throw new Error(
      `fetchWithProgress: ${String(response.status)} ${response.statusText} for ${url}`,
    );
  }

  const body = response.body;
  if (!body || !onProgress) {
    return response.arrayBuffer();
  }

  const reader = body.getReader();
  const chunks: Uint8Array[] = [];
  let bytesLoaded = 0;

  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    chunks.push(value);
    bytesLoaded += value.byteLength;
    onProgress(bytesLoaded);
  }

  const merged = new Uint8Array(bytesLoaded);
  let offset = 0;
  for (const chunk of chunks) {
    merged.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return merged.buffer;
}
