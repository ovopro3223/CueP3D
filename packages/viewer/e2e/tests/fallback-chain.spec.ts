import { test, expect, type Page } from '@playwright/test';

const FORCE_HIGH_END_POLICY = {
  deviceMemory: 8,
  hardwareConcurrency: 8,
  connection: { effectiveType: '4g', downlink: 50 },
};

declare global {
  interface Window {
    Harness: {
      create(optionsJson: string): number;
      getState(id: number): string;
      getDegraded(id: number): boolean;
      waitForState(id: number, state: string, timeoutMs: number): Promise<boolean>;
      dispose(id: number): void;
    };
  }
}

async function createViewerOnPage(page: Page): Promise<number> {
  return page.evaluate(({ options }) => window.Harness.create(JSON.stringify(options)), {
    options: { src: '/fixtures/out-cube/cuep3d.json', policy: FORCE_HIGH_END_POLICY },
  });
}

test('removing WebCodecs (VideoDecoder) falls back to the <video> element player and still reaches live, not degraded', async ({
  page,
}) => {
  await page.addInitScript(() => {
    // @ts-expect-error -- simulating a browser with no WebCodecs support.
    delete window.VideoDecoder;
  });
  await page.goto('/');

  const id = await createViewerOnPage(page);
  const reachedLive = await page.evaluate(
    (id) => window.Harness.waitForState(id, 'live', 15_000),
    id,
  );
  expect(reachedLive).toBe(true);

  const degraded = await page.evaluate((id) => window.Harness.getDegraded(id), id);
  expect(degraded).toBe(false);

  await page.evaluate((id) => window.Harness.dispose(id), id);
});

test('every proxy variant unreachable on the network → degraded, but still reaches live via L0 alone', async ({
  page,
}) => {
  await page.route('**/fixtures/out-cube/proxy-*', (route) =>
    route.fulfill({ status: 404, body: 'blocked' }),
  );
  await page.route('**/fixtures/out-cube/frames-*/**', (route) =>
    route.fulfill({ status: 404, body: 'blocked' }),
  );
  await page.goto('/');

  const id = await createViewerOnPage(page);
  const reachedLive = await page.evaluate(
    (id) => window.Harness.waitForState(id, 'live', 15_000),
    id,
  );
  expect(reachedLive).toBe(true);

  const degraded = await page.evaluate((id) => window.Harness.getDegraded(id), id);
  expect(degraded).toBe(true);

  const reachedSettled = await page.evaluate(
    (id) => window.Harness.waitForState(id, 'settled', 15_000),
    id,
  );
  expect(reachedSettled).toBe(true);

  await page.evaluate((id) => window.Harness.dispose(id), id);
});
