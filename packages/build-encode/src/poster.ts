import { readFile } from 'node:fs/promises';
import path from 'node:path';
import type { ProxyPoster, ProxyVariant } from '@cuep3d/manifest';

/**
 * The inline poster (D-014): frame 0 of the AVIF still sequence encodeProxy
 * already produced at the smallest size, read back and inlined as a
 * `data:` URL for `manifest.proxy.poster`. No second encode — it is
 * literally the same file the AVIF fallback would fetch first, so the
 * poster and the first video keyframe come from the same rendered PNG.
 *
 * Why inline rather than a URL: on a 150 ms-RTT link every extra request
 * costs a round trip before the first visual; the poster inside the
 * manifest arrives with the one request the viewer cannot avoid.
 */
export async function readProxyPoster(
  variants: readonly ProxyVariant[],
  outDir: string,
): Promise<ProxyPoster> {
  const sequence = variants.find((v) => v.kind === 'image-sequence' && v.codec === 'avif');
  if (!sequence) {
    throw new Error('readProxyPoster: no AVIF image-sequence variant to take frame 0 from');
  }
  const firstFrameUrl = sequence.url.replace('{i}', '000');
  const file = path.join(outDir, ...firstFrameUrl.split('/'));
  const bytes = await readFile(file);
  return {
    codec: 'avif',
    url: `data:image/avif;base64,${bytes.toString('base64')}`,
    width: sequence.width,
    height: sequence.height,
    bytes: bytes.byteLength,
  };
}
