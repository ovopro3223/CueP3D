import { listEncoders as listEncodersReal, runFfmpeg } from './ffmpeg-process.js';
import type { Av1EncoderChoice, EncoderPreference } from './types.js';

const ENCODER_NAME: Record<Av1EncoderChoice, string> = {
  'svt-av1': 'libsvtav1',
  nvenc: 'av1_nvenc',
  libaom: 'libaom-av1',
};

const SMOKE_FLAGS: Record<Av1EncoderChoice, string[]> = {
  'svt-av1': ['-c:v', 'libsvtav1', '-preset', '6', '-crf', '32'],
  nvenc: ['-c:v', 'av1_nvenc', '-cq', '30', '-preset', 'p5'],
  libaom: ['-c:v', 'libaom-av1', '-crf', '30', '-b:v', '0', '-cpu-used', '6'],
};

export interface SelectEncoderDeps {
  listEncoders: () => Promise<string>;
  smokeTest: (choice: Av1EncoderChoice, size: number) => Promise<boolean>;
}

/**
 * A real smoke-test encode, not just a check that ffmpeg -encoders lists the
 * name: av1_nvenc is compiled into this ffmpeg build regardless of whether
 * the host actually has an NVIDIA GPU, and AV1 NVENC additionally rejects
 * frame sizes below ~192px, so "listed" does not mean "usable at this size".
 */
export async function defaultSmokeTest(choice: Av1EncoderChoice, size: number): Promise<boolean> {
  try {
    await runFfmpeg([
      '-f',
      'lavfi',
      '-i',
      `testsrc2=size=${size}x${size}:rate=24:duration=0.3`,
      '-frames:v',
      '4',
      ...SMOKE_FLAGS[choice],
      '-f',
      'null',
      '-',
    ]);
    return true;
  } catch {
    return false;
  }
}

export const DEFAULT_SELECT_ENCODER_DEPS: SelectEncoderDeps = {
  listEncoders: listEncodersReal,
  smokeTest: defaultSmokeTest,
};

export interface EncoderAttempt {
  choice: Av1EncoderChoice;
  available: boolean;
  smokeTestPassed: boolean | null;
}

export interface SelectEncoderResult {
  choice: Av1EncoderChoice;
  attempted: EncoderAttempt[];
}

/**
 * 'auto' prefers svt-av1 -> nvenc -> libaom (D-005 / brief order), skipping
 * gracefully past any encoder that is missing from this ffmpeg build or
 * fails a real smoke-test encode at the requested size. An explicit
 * preference must itself pass both checks or the build fails loudly rather
 * than silently falling back to a different encoder than requested.
 */
export async function selectAv1Encoder(
  preference: EncoderPreference,
  smokeSize: number,
  deps: SelectEncoderDeps = DEFAULT_SELECT_ENCODER_DEPS,
): Promise<SelectEncoderResult> {
  const order: Av1EncoderChoice[] =
    preference === 'auto' ? ['svt-av1', 'nvenc', 'libaom'] : [preference];
  const encodersText = await deps.listEncoders();
  const attempted: EncoderAttempt[] = [];

  for (const choice of order) {
    const available = encodersText.includes(ENCODER_NAME[choice]);
    if (!available) {
      attempted.push({ choice, available: false, smokeTestPassed: null });
      continue;
    }
    const smokeTestPassed = await deps.smokeTest(choice, smokeSize);
    attempted.push({ choice, available: true, smokeTestPassed });
    if (smokeTestPassed) {
      return { choice, attempted };
    }
  }

  const summary = attempted
    .map(
      (a) =>
        `${a.choice} (${!a.available ? 'not compiled in' : a.smokeTestPassed ? 'ok' : 'smoke test failed'})`,
    )
    .join(', ');
  throw new Error(
    preference === 'auto'
      ? `encodeProxy: no working AV1 encoder found. Tried: ${summary}.`
      : `encodeProxy: requested encoder "${preference}" is unavailable (${summary}).`,
  );
}
