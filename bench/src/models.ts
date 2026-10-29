/**
 * docs/01-design.md §10: Avocado, BoomBox, WaterBottle (D-005a — not
 * DamagedHelmet). Mirrors apps/demo/src/models.ts's slugs; not imported
 * from there since apps/demo is a Vite app (not a library another package
 * depends on) and this list is tiny and stable.
 */
export interface BenchModel {
  readonly slug: 'avocado' | 'boombox' | 'waterbottle';
  readonly label: string;
}

export const BENCH_MODELS: readonly BenchModel[] = [
  { slug: 'avocado', label: 'Avocado' },
  { slug: 'boombox', label: 'BoomBox' },
  { slug: 'waterbottle', label: 'WaterBottle' },
];

export type BenchMode = 'plain' | 'cuep3d';
export const BENCH_MODES: readonly BenchMode[] = ['plain', 'cuep3d'];
