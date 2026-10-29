/**
 * AVIF support probe. Uses an <img> decode of a known-valid 1x1 AVIF
 * (standard feature-detection technique; createImageBitmap is pickier about
 * minimal/synthetic AVIF structure than <img>'s decoder, so <img> is the
 * correct instrument here even though real frames are decoded with
 * createImageBitmap in avif-sequence-player.ts) rather than attempting to
 * decode the real frame sequence just to check support.
 */

const PROBE_SRC =
  'data:image/avif;base64,AAAAIGZ0eXBhdmlmAAAAAGF2aWZtaWYxbWlhZk1BMUIAAADybWV0YQAAAAAAAAAoaGRscgAAAAAAAAAAcGljdAAAAAAAAAAAAAAAAGxpYmF2aWYAAAAADnBpdG0AAAAAAAEAAAAeaWxvYwAAAABEAAABAAEAAAABAAABGgAAABcAAAAoaWluZgAAAAAAAQAAABppbmZlAgAAAAABAABhdjAxQ29sb3IAAAAAamlwcnAAAABLaXBjbwAAABRpc3BlAAAAAAAAAAEAAAABAAAAEHBpeGkAAAAAAwgICAAAAAxhdjFDgQAMAAAAABNjb2xybmNseAACAAIABoAAAAAXaXBtYQAAAAAAAAABAAEEAQKDBAAAAB9tZGF0EgAKCBgANogQEAwgMg8f8D///8WfhwB8+ErK42A=';

let cached: Promise<boolean> | null = null;

export function probeAvifSupport(): Promise<boolean> {
  cached ??= new Promise<boolean>((resolve) => {
    if (typeof Image === 'undefined') {
      resolve(false);
      return;
    }
    const img = new Image();
    img.onload = () => resolve(img.width === 1 && img.height === 1);
    img.onerror = () => resolve(false);
    img.src = PROBE_SRC;
  });
  return cached;
}

/** Test-only: forces the next probeAvifSupport() call to re-run its check. */
export function resetAvifProbeCache(): void {
  cached = null;
}
