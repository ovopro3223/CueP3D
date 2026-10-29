import { describe, expect, it } from 'vitest';
import { listEncoders } from './ffmpeg-process.js';
import {
  DEFAULT_SELECT_ENCODER_DEPS,
  selectAv1Encoder,
  type SelectEncoderDeps,
} from './select-encoder.js';
import type { Av1EncoderChoice } from './types.js';

function fakeDeps(opts: {
  encodersText: string;
  smokeResults: Partial<Record<Av1EncoderChoice, boolean>>;
}): SelectEncoderDeps & { calls: Av1EncoderChoice[] } {
  const calls: Av1EncoderChoice[] = [];
  return {
    calls,
    listEncoders: async () => opts.encodersText,
    smokeTest: async (choice) => {
      calls.push(choice);
      return opts.smokeResults[choice] ?? false;
    },
  };
}

describe('selectAv1Encoder — deterministic (mocked ffmpeg)', () => {
  it('auto: falls through libsvtav1-absent builds straight to the next candidate', async () => {
    // This ffmpeg build has libaom-av1 and av1_nvenc but not libsvtav1 — the
    // exact shape of the owner's machine and CI per the task brief.
    const deps = fakeDeps({
      encodersText: 'V....D libaom-av1\nV....D av1_nvenc\n',
      smokeResults: { nvenc: true, libaom: true },
    });
    const result = await selectAv1Encoder('auto', 512, deps);
    expect(result.choice).toBe('nvenc');
    expect(deps.calls).not.toContain('svt-av1');
    expect(result.attempted[0]).toEqual({
      choice: 'svt-av1',
      available: false,
      smokeTestPassed: null,
    });
  });

  it('auto: falls all the way to libaom when svt-av1 is absent and nvenc smoke-test fails', async () => {
    const deps = fakeDeps({
      encodersText: 'V....D libaom-av1\nV....D av1_nvenc\n',
      smokeResults: { nvenc: false, libaom: true },
    });
    const result = await selectAv1Encoder('auto', 512, deps);
    expect(result.choice).toBe('libaom');
    expect(result.attempted.map((a) => a.choice)).toEqual(['svt-av1', 'nvenc', 'libaom']);
  });

  it('auto: picks svt-av1 first when it is present and works', async () => {
    const deps = fakeDeps({
      encodersText: 'V....D libsvtav1\nV....D libaom-av1\n',
      smokeResults: { 'svt-av1': true, libaom: true },
    });
    const result = await selectAv1Encoder('auto', 512, deps);
    expect(result.choice).toBe('svt-av1');
  });

  it('auto: throws a descriptive error when every candidate is unusable', async () => {
    const deps = fakeDeps({
      encodersText: 'V....D libaom-av1\n',
      smokeResults: { libaom: false },
    });
    await expect(selectAv1Encoder('auto', 512, deps)).rejects.toThrow(/no working AV1 encoder/);
  });

  it('explicit preference: throws rather than silently substituting a different encoder', async () => {
    const deps = fakeDeps({
      encodersText: 'V....D libaom-av1\nV....D av1_nvenc\n',
      smokeResults: { libaom: true },
    });
    await expect(selectAv1Encoder('svt-av1', 512, deps)).rejects.toThrow(
      /"svt-av1" is unavailable/,
    );
    expect(deps.calls).toEqual([]); // never even smoke-tested, since it's not compiled in
  });

  it('explicit preference: succeeds when that exact encoder is available and works', async () => {
    const deps = fakeDeps({
      encodersText: 'V....D libaom-av1\nV....D av1_nvenc\n',
      smokeResults: { nvenc: true },
    });
    const result = await selectAv1Encoder('nvenc', 512, deps);
    expect(result.choice).toBe('nvenc');
  });
});

describe('selectAv1Encoder — real ffmpeg on this machine', () => {
  // Which AV1 encoders are compiled in differs by machine: the owner's
  // Windows build (ffmpeg "essentials") has libaom-av1 + av1_nvenc and no
  // libsvtav1; Ubuntu's apt ffmpeg — what CI runs — has libsvtav1 +
  // libaom-av1 and no nvenc. So assert consistency with the real
  // `ffmpeg -encoders` output rather than hard-coding one machine's shape.
  it('auto resolves to a working encoder, and reports svt-av1 availability consistently with ffmpeg -encoders', async () => {
    const encodersText = await listEncoders();
    expect(encodersText).toContain('libaom-av1');
    const hasSvt = encodersText.includes('libsvtav1');

    const result = await selectAv1Encoder('auto', 256, DEFAULT_SELECT_ENCODER_DEPS);
    expect(['svt-av1', 'nvenc', 'libaom']).toContain(result.choice);
    const svtAttempt = result.attempted.find((a) => a.choice === 'svt-av1');
    expect(svtAttempt?.available).toBe(hasSvt);
    if (!hasSvt) {
      expect(result.choice).not.toBe('svt-av1');
      expect(svtAttempt).toEqual({ choice: 'svt-av1', available: false, smokeTestPassed: null });
    }
  }, 30_000);

  it('requesting svt-av1 explicitly either works or fails gracefully — never with a crash', async () => {
    const hasSvt = (await listEncoders()).includes('libsvtav1');
    const attempt = selectAv1Encoder('svt-av1', 256, DEFAULT_SELECT_ENCODER_DEPS);
    if (hasSvt) {
      await expect(attempt).resolves.toMatchObject({ choice: 'svt-av1' });
    } else {
      await expect(attempt).rejects.toThrow(/"svt-av1" is unavailable/);
    }
  }, 30_000);
});
