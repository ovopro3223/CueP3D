import type { Page } from '@playwright/test';

/**
 * Ground truth for frame N: the exact PNG scripts/make-fixtures.mjs encoded
 * the fixtures from, committed under fixtures/proxy-ref/ (served by
 * server.mjs at /fixtures/). These used to be regenerated here at test time
 * with ffmpeg's drawtext, which tied the reference to whichever font the
 * machine had — Arial on Windows, DejaVu on Linux — so a Linux runner was
 * comparing decoded Arial frames against DejaVu references.
 */
export function referenceFrame(index: number): string {
  return `fixtures/proxy-ref/${String(index).padStart(3, '0')}.png`;
}

export const FIXTURES = {
  av1: {
    kind: 'video' as const,
    codec: 'av01' as const,
    container: 'mp4' as const,
    url: 'proxy-fixture.av1.mp4',
    width: 256,
    height: 256,
    bytes: 124078,
    gop: 8,
    frames: 72,
  },
  vp9: {
    kind: 'video' as const,
    codec: 'vp09' as const,
    container: 'mp4' as const,
    url: 'proxy-fixture.vp9.mp4',
    width: 256,
    height: 256,
    bytes: 182092,
    gop: 8,
    frames: 72,
  },
  avif: {
    kind: 'image-sequence' as const,
    codec: 'avif' as const,
    url: 'avif/{i}.avif',
    width: 256,
    height: 256,
    bytes: 258811,
    frames: 72,
  },
};

export const BASE_URL = 'http://localhost:4873/fixtures/manifest.json';

interface HarnessWindow {
  Harness: {
    createPlayer(variantJson: string, baseUrl: string): Promise<number>;
    selectVariant(variantsJson: string): Promise<string | null>;
    disposePlayer(id: number): void;
    waitFirstFrame(
      id: number,
    ): Promise<{ width: number; height: number; kind: string; elapsedMs: number }>;
    waitFirstFrameAndBytes(id: number): Promise<{ loaded: number; total: number }>;
    getFrame(
      id: number,
      index: number,
    ): Promise<{ width: number; height: number; kind: string; elapsedMs: number }>;
    compareFrameToReference(
      id: number,
      index: number,
      referenceUrl: string,
      crop?: { x: number; y: number; w: number; h: number },
    ): Promise<{ meanAbsDiffPct: number }>;
    getAvailable(id: number): { from: number; to: number };
    getBytes(id: number): { loaded: number; total: number };
    prefetch(id: number, center: number, radius: number): void;
    simulateScrub(
      id: number,
      totalFrames: number,
      prefetchRadius: number,
    ): Promise<{ hits: number; misses: number; total: number }>;
    resourceUrlsMatching(substring: string): string[];
    expectGetFrameRejects(id: number, index: number): Promise<boolean>;
  };
}

export async function createPlayer(page: Page, variant: object): Promise<number> {
  return page.evaluate(
    async ({ variant, baseUrl }) => {
      const w = window as unknown as HarnessWindow;
      return w.Harness.createPlayer(JSON.stringify(variant), baseUrl);
    },
    { variant, baseUrl: BASE_URL },
  );
}

export function harness(page: Page): HarnessWindow['Harness'] {
  // Thin typed proxy over page.evaluate so each call site reads like a
  // normal method call instead of repeating the evaluate() boilerplate.
  return new Proxy({} as HarnessWindow['Harness'], {
    get(_target, methodName: string) {
      return (...args: unknown[]) =>
        page.evaluate(
          ({ methodName, args }) => {
            const w = window as unknown as HarnessWindow;
            // eslint-disable-next-line @typescript-eslint/no-explicit-any
            return (w.Harness as any)[methodName](...args);
          },
          { methodName, args },
        );
    },
  });
}
