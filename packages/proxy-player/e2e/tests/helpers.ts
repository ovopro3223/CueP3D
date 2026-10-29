import { execFile } from 'node:child_process';
import { mkdir } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { promisify } from 'node:util';
import type { Page } from '@playwright/test';

const execFileAsync = promisify(execFile);
const __dirname = path.dirname(fileURLToPath(import.meta.url));
export const generatedDir = path.join(__dirname, '..', '.generated');

// Mirrors scripts/make-fixtures.mjs exactly (same lavfi graph, same drawtext
// filter) so a regenerated frame N is pixel-for-pixel what frame N looked
// like before AV1/VP9 encoding — the ground truth the decoded output is
// checked against.
const FONT =
  process.platform === 'win32'
    ? 'C\\:/Windows/Fonts/arial.ttf'
    : '/usr/share/fonts/truetype/dejavu/DejaVuSans-Bold.ttf';
const SIZE = 256;
const FPS = 24;
const FRAMES = 72;

export async function generateReferenceFrame(index: number): Promise<string> {
  await mkdir(generatedDir, { recursive: true });
  const outPath = path.join(generatedDir, `ref-${String(index).padStart(3, '0')}.png`);
  const drawtext =
    `drawtext=fontfile='${FONT}':text='%{eif\\:n\\:d\\:3}':` +
    `x=(w-tw)/2:y=(h-th)/2:fontsize=64:fontcolor=white:box=1:boxcolor=black@0.6:boxborderw=12`;
  const source = `testsrc2=size=${SIZE}x${SIZE}:rate=${FPS}:duration=${FRAMES / FPS}`;
  await execFileAsync('ffmpeg', [
    '-y',
    '-f',
    'lavfi',
    '-i',
    `${source},${drawtext},select=eq(n\\,${index})`,
    '-vframes',
    '1',
    '-update',
    '1',
    outPath,
    '-loglevel',
    'error',
  ]);
  return `generated/ref-${String(index).padStart(3, '0')}.png`;
}

export const FIXTURES = {
  av1: {
    kind: 'video' as const,
    codec: 'av01' as const,
    container: 'mp4' as const,
    url: 'proxy-fixture.av1.mp4',
    width: 256,
    height: 256,
    bytes: 121874,
    gop: 8,
  },
  vp9: {
    kind: 'video' as const,
    codec: 'vp09' as const,
    container: 'mp4' as const,
    url: 'proxy-fixture.vp9.mp4',
    width: 256,
    height: 256,
    bytes: 175690,
    gop: 8,
  },
  avif: {
    kind: 'image-sequence' as const,
    codec: 'avif' as const,
    url: 'avif/{i}.avif',
    width: 256,
    height: 256,
    bytes: 502091,
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
