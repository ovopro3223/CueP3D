/**
 * GLTFLoader's own `onProgress` reports compressed download progress
 * unreliably (brief note) — it is driven by XHR `progress` events, which
 * some servers/compressions never fire correctly. Reading the response body
 * as a stream gives a byte count we can trust before handing the full
 * buffer to `GLTFLoader.parse`.
 */
export async function fetchWithProgress(
  url: string,
  onProgress?: (bytesLoaded: number) => void,
): Promise<ArrayBuffer> {
  const response = await fetch(url);
  if (!response.ok) {
    throw new Error(`fetchWithProgress: ${String(response.status)} ${response.statusText} for ${url}`);
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
