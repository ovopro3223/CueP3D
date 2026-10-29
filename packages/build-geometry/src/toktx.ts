import { execFile } from 'node:child_process';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { promisify } from 'node:util';

const execFileAsync = promisify(execFile);

const TOKTX_INSTALL_HINT =
  'build-geometry: "toktx" was not found on PATH. Install KTX-Software (same v4.4.2 release CI ' +
  'uses) from https://github.com/KhronosGroup/KTX-Software/releases — ' +
  'Windows: run KTX-Software-4.4.2-Windows-x64.exe and add its bin/ directory to PATH; ' +
  'Linux: `sudo apt-get install -y ./KTX-Software-4.4.2-Linux-x86_64.deb` (or build from source).';

function isEnoent(error: unknown): boolean {
  return (
    typeof error === 'object' &&
    error !== null &&
    'code' in error &&
    (error as { code?: unknown }).code === 'ENOENT'
  );
}

/**
 * toktx has no dedicated "are you there" flag; `--version` is the cheapest
 * call that fails with ENOENT when the binary is absent but exits fine
 * (whatever its status code) when present. Only ENOENT is treated as
 * "missing" — any other failure means toktx exists but rejected the probe,
 * which is not this function's concern.
 */
export async function ensureToktx(): Promise<void> {
  try {
    await execFileAsync('toktx', ['--version']);
  } catch (error) {
    if (isEnoent(error)) {
      throw new Error(TOKTX_INSTALL_HINT);
    }
  }
}

export interface EncodeKtx2Options {
  image: Uint8Array;
  mimeType: string;
  mode: 'etc1s' | 'uastc';
  resize?: readonly [number, number];
  colorspace: 'linear' | 'srgb';
}

function extensionForMimeType(mimeType: string): string | null {
  if (mimeType === 'image/png') return 'png';
  if (mimeType === 'image/jpeg') return 'jpg';
  return null;
}

export async function encodeKtx2(options: EncodeKtx2Options): Promise<Uint8Array> {
  const ext = extensionForMimeType(options.mimeType);
  if (!ext) {
    throw new Error(
      `build-geometry: unsupported source texture MIME type "${options.mimeType}" for KTX2 encoding ` +
        '(only image/png and image/jpeg inputs are supported).',
    );
  }

  const tmpDir = await mkdtemp(path.join(tmpdir(), 'understudy-ktx2-'));
  const inPath = path.join(tmpDir, `in.${ext}`);
  const outPath = path.join(tmpDir, 'out.ktx2');

  try {
    await writeFile(inPath, options.image);

    const args = [
      '--t2',
      '--genmipmap',
      '--encode',
      options.mode,
      '--assign_oetf',
      options.colorspace,
    ];
    if (options.resize) {
      args.push('--resize', `${options.resize[0]}x${options.resize[1]}`);
    }
    args.push(outPath, inPath);

    try {
      await execFileAsync('toktx', args);
    } catch (error) {
      if (isEnoent(error)) {
        throw new Error(TOKTX_INSTALL_HINT);
      }
      const stderr =
        typeof error === 'object' && error !== null && 'stderr' in error
          ? String((error as { stderr?: unknown }).stderr)
          : '';
      const message = stderr.trim().length > 0 ? stderr : (error as Error).message;
      throw new Error(`build-geometry: toktx failed (args: ${args.join(' ')}).\n${message}`);
    }

    return await readFile(outPath);
  } finally {
    await rm(tmpDir, { recursive: true, force: true });
  }
}
