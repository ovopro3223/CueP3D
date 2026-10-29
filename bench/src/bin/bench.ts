import { mkdirSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { runSweep } from '../sweep.js';
import { renderBenchmarksMarkdown } from '../markdown-table.js';
import { formatMarkdown } from '../format-markdown.js';
import { checkGoals, TTFV_GOAL_MS, TTI_GOAL_MS } from '../goals.js';
import { REPO_ROOT } from '../server.js';

async function main(): Promise<void> {
  const report = await runSweep({ onProgress: (message) => console.log(`[bench] ${message}`) });

  const resultsDir = path.join(REPO_ROOT, 'bench', 'results');
  mkdirSync(resultsDir, { recursive: true });
  const timestamp = report.dateIso.replace(/[:.]/g, '-');
  const resultsPath = path.join(resultsDir, `${timestamp}.json`);
  writeFileSync(resultsPath, JSON.stringify(report, null, 2));
  console.log(`[bench] wrote ${resultsPath}`);

  const benchmarksPath = path.join(REPO_ROOT, 'BENCHMARKS.md');
  const formattedMarkdown = await formatMarkdown(renderBenchmarksMarkdown(report), benchmarksPath);
  writeFileSync(benchmarksPath, formattedMarkdown);
  console.log(`[bench] wrote ${benchmarksPath}`);

  const violations = checkGoals(report);
  if (violations.length === 0) {
    console.log(
      `[bench] goals met: cuep3d TTFV ≤ ${String(TTFV_GOAL_MS)}ms and TTI ≤ ${String(TTI_GOAL_MS)}ms ` +
        'on 3g-fast for every model.',
    );
    return;
  }

  console.error('[bench] goal violations (docs/01-design.md §3, 3g-fast, cuep3d mode):');
  for (const violation of violations) {
    console.error(
      `  ${violation.modelSlug}: ${violation.metric} = ${String(violation.valueMs)}ms ` +
        `> ${String(violation.limitMs)}ms`,
    );
  }
  process.exitCode = 1;
}

main().catch((error: unknown) => {
  console.error(error);
  process.exitCode = 1;
});
