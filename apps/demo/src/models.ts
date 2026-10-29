export interface DemoModel {
  readonly slug: string;
  readonly label: string;
  readonly dir: string;
  readonly attribution: string;
  readonly attributionUrl: string;
}

// Three models only — no DamagedHelmet (D-005a: its glTF rebuild is CC-BY-4.0
// but the earlier model it was rebuilt from is CC-BY-NC-4.0, so the asset as
// distributed is NC-encumbered). All three below are CC0-1.0, Microsoft 2017,
// per samples/LICENSES.md (written by scripts/fetch-samples.mjs).
export const DEMO_MODELS: readonly DemoModel[] = [
  {
    slug: 'avocado',
    label: 'Avocado',
    dir: 'avocado',
    attribution: 'Avocado — Microsoft (2017), CC0-1.0',
    attributionUrl: 'https://creativecommons.org/publicdomain/zero/1.0/legalcode',
  },
  {
    slug: 'boombox',
    label: 'BoomBox',
    dir: 'boombox',
    attribution: 'BoomBox — Microsoft (2017), CC0-1.0',
    attributionUrl: 'https://creativecommons.org/publicdomain/zero/1.0/legalcode',
  },
  {
    slug: 'waterbottle',
    label: 'WaterBottle',
    dir: 'waterbottle',
    attribution: 'WaterBottle — Microsoft (2017), CC0-1.0',
    attributionUrl: 'https://creativecommons.org/publicdomain/zero/1.0/legalcode',
  },
];

export function findModel(slug: string): DemoModel {
  const model = DEMO_MODELS.find((m) => m.slug === slug);
  if (!model) throw new Error(`Unknown model slug: ${slug}`);
  return model;
}

export function modelBaseUrl(model: DemoModel): string {
  return `${import.meta.env.BASE_URL}models/${model.dir}/`;
}
