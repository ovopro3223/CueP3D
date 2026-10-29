import type { Browser } from 'puppeteer';

export interface PngStats {
  width: number;
  height: number;
  mean: [number, number, number, number];
  corners: {
    topLeft: [number, number, number, number];
    topRight: [number, number, number, number];
    bottomLeft: [number, number, number, number];
    bottomRight: [number, number, number, number];
  };
}

/**
 * Tests need to inspect rendered PNG pixels but this package has no Node PNG
 * decoder dependency — it decodes through the browser's own ImageBitmap/
 * Canvas instead, reusing the Puppeteer dependency the package already has.
 * The decode logic is handed to Puppeteer as a plain source string (not a
 * typed function) so it never needs DOM lib types in this Node-only package.
 */
export async function decodePngStats(browser: Browser, png: Buffer): Promise<PngStats> {
  const page = await browser.newPage();
  try {
    const base64 = JSON.stringify(png.toString('base64'));
    const script = `(async () => {
      const binary = atob(${base64});
      const bytes = new Uint8Array(binary.length);
      for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
      const blob = new Blob([bytes], { type: 'image/png' });
      const bitmap = await createImageBitmap(blob);
      const canvas = document.createElement('canvas');
      canvas.width = bitmap.width;
      canvas.height = bitmap.height;
      const ctx = canvas.getContext('2d');
      ctx.drawImage(bitmap, 0, 0);
      const { data, width, height } = ctx.getImageData(0, 0, bitmap.width, bitmap.height);
      let r = 0, g = 0, b = 0, a = 0;
      const count = width * height;
      for (let i = 0; i < data.length; i += 4) {
        r += data[i]; g += data[i + 1]; b += data[i + 2]; a += data[i + 3];
      }
      function pixelAt(x, y) {
        const idx = (y * width + x) * 4;
        return [data[idx], data[idx + 1], data[idx + 2], data[idx + 3]];
      }
      return {
        width, height,
        mean: [r / count, g / count, b / count, a / count],
        corners: {
          topLeft: pixelAt(0, 0),
          topRight: pixelAt(width - 1, 0),
          bottomLeft: pixelAt(0, height - 1),
          bottomRight: pixelAt(width - 1, height - 1),
        },
      };
    })()`;
    return (await page.evaluate(script)) as PngStats;
  } finally {
    await page.close();
  }
}
