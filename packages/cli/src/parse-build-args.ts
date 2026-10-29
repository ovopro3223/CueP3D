/**
 * Flag parsing for `cuep3d build`, per docs/01-design.md §7. Hand-rolled
 * rather than pulling in an args library — the surface is tiny and fixed.
 */

export interface BuildArgs {
  input: string;
  outDir: string;
  frames: number;
  ringsDeg: number[];
  proxySizes: number[];
  environment: 'studio-neutral' | 'studio-warm' | 'none';
  background: string;
  encoder: 'auto' | 'libaom' | 'svt-av1' | 'nvenc';
}

export class BuildArgsError extends Error {}

export const BUILD_HELP = `Usage: cuep3d build <model.glb> -o <outDir> [options]

Options:
  -o, --out <dir>          Output directory (required)
      --frames <n>         Frames per ring (default: 72)
      --rings <deg,...>    Elevation ring(s) in degrees (default: 20)
      --proxy-sizes <n,...> Proxy video sizes, largest first (default: 1024,512)
      --env <preset>       studio-neutral | studio-warm | none (default: studio-neutral)
      --background <hex>   Background colour baked into proxy frames (default: #ffffff)
      --encoder <name>     auto | libaom | svt-av1 | nvenc (default: auto)
  -h, --help                Show this help
`;

const ENVIRONMENTS = ['studio-neutral', 'studio-warm', 'none'] as const;
const ENCODERS = ['auto', 'libaom', 'svt-av1', 'nvenc'] as const;

function parseNumberList(value: string, flag: string): number[] {
  const parts = value.split(',').map((part) => Number(part.trim()));
  if (parts.some((n) => !Number.isFinite(n))) {
    throw new BuildArgsError(`${flag} must be a comma-separated list of numbers, got "${value}"`);
  }
  return parts;
}

export function parseBuildArgs(argv: string[]): BuildArgs | { help: true } {
  if (argv.includes('-h') || argv.includes('--help')) {
    return { help: true };
  }

  const positionals: string[] = [];
  let outDir: string | undefined;
  let frames = 72;
  let ringsDeg = [20];
  let proxySizes = [1024, 512];
  let environment: BuildArgs['environment'] = 'studio-neutral';
  let background = '#ffffff';
  let encoder: BuildArgs['encoder'] = 'auto';

  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    const next = (): string => {
      i += 1;
      const value = argv[i];
      if (value === undefined) throw new BuildArgsError(`${arg} requires a value`);
      return value;
    };

    switch (arg) {
      case '-o':
      case '--out':
        outDir = next();
        break;
      case '--frames':
        frames = Number(next());
        break;
      case '--rings':
        ringsDeg = parseNumberList(next(), '--rings');
        break;
      case '--proxy-sizes':
        proxySizes = parseNumberList(next(), '--proxy-sizes');
        break;
      case '--env':
        environment = next() as BuildArgs['environment'];
        break;
      case '--background':
        background = next();
        break;
      case '--encoder':
        encoder = next() as BuildArgs['encoder'];
        break;
      default:
        if (arg === undefined) break;
        if (arg.startsWith('-')) {
          throw new BuildArgsError(`Unknown flag: ${arg}`);
        }
        positionals.push(arg);
    }
  }

  const input = positionals[0];
  if (!input) throw new BuildArgsError('Missing <model.glb> input path');
  if (!outDir) throw new BuildArgsError('Missing required -o/--out <dir>');
  if (!Number.isFinite(frames) || frames <= 0) {
    throw new BuildArgsError('--frames must be a positive number');
  }
  if (!ENVIRONMENTS.includes(environment)) {
    throw new BuildArgsError(
      `Invalid --env "${environment}" (expected one of ${ENVIRONMENTS.join(', ')})`,
    );
  }
  if (!ENCODERS.includes(encoder)) {
    throw new BuildArgsError(
      `Invalid --encoder "${encoder}" (expected one of ${ENCODERS.join(', ')})`,
    );
  }
  if (proxySizes.some((size) => size <= 0)) {
    throw new BuildArgsError('--proxy-sizes must be positive numbers');
  }

  return { input, outDir, frames, ringsDeg, proxySizes, environment, background, encoder };
}
