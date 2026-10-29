import prettier from 'prettier';

/**
 * `markdown-table.ts`'s renderer doesn't align table pipes (column widths
 * vary run to run with real byte/ms values), so `pnpm run format` would
 * flag every regenerated BENCHMARKS.md. Runs it through prettier's own API
 * (not a `pnpm exec prettier` subprocess — same reasoning as server.ts's
 * use of Vite's API) so the committed file always matches the repo's own
 * format gate, using whatever `.prettierrc.json` applies at `filePath`.
 */
export async function formatMarkdown(markdown: string, filePath: string): Promise<string> {
  const config = await prettier.resolveConfig(filePath);
  return prettier.format(markdown, { ...config, filepath: filePath });
}
