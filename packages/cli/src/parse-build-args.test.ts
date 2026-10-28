import { describe, expect, it } from 'vitest';
import { parseBuildArgs, BuildArgsError, BUILD_HELP } from './parse-build-args.js';

describe('parseBuildArgs', () => {
  it('parses a minimal valid invocation with defaults', () => {
    const result = parseBuildArgs(['model.glb', '-o', 'out/model']);
    expect(result).toEqual({
      input: 'model.glb',
      outDir: 'out/model',
      frames: 72,
      ringsDeg: [20],
      proxySizes: [1024, 512],
      environment: 'studio-neutral',
      background: '#ffffff',
      encoder: 'auto',
    });
  });

  it('parses every flag from §7', () => {
    const result = parseBuildArgs([
      'model.glb',
      '--out',
      'out/model',
      '--frames',
      '36',
      '--rings',
      '10,20,30',
      '--proxy-sizes',
      '2048,1024,512',
      '--env',
      'studio-warm',
      '--background',
      '#000000',
      '--encoder',
      'svt-av1',
    ]);
    expect(result).toEqual({
      input: 'model.glb',
      outDir: 'out/model',
      frames: 36,
      ringsDeg: [10, 20, 30],
      proxySizes: [2048, 1024, 512],
      environment: 'studio-warm',
      background: '#000000',
      encoder: 'svt-av1',
    });
  });

  it('returns {help:true} for -h/--help without requiring other args', () => {
    expect(parseBuildArgs(['--help'])).toEqual({ help: true });
    expect(parseBuildArgs(['-h'])).toEqual({ help: true });
  });

  it('throws when the input model path is missing', () => {
    expect(() => parseBuildArgs(['-o', 'out'])).toThrow(BuildArgsError);
  });

  it('throws when -o/--out is missing', () => {
    expect(() => parseBuildArgs(['model.glb'])).toThrow(BuildArgsError);
  });

  it('throws on an unknown flag', () => {
    expect(() => parseBuildArgs(['model.glb', '-o', 'out', '--bogus'])).toThrow(BuildArgsError);
  });

  it('throws on an invalid --env value', () => {
    expect(() => parseBuildArgs(['model.glb', '-o', 'out', '--env', 'dark-mode'])).toThrow(
      BuildArgsError,
    );
  });

  it('throws on an invalid --encoder value', () => {
    expect(() => parseBuildArgs(['model.glb', '-o', 'out', '--encoder', 'x264'])).toThrow(
      BuildArgsError,
    );
  });

  it('BUILD_HELP documents every §7 flag', () => {
    for (const flag of [
      '--out',
      '--frames',
      '--rings',
      '--proxy-sizes',
      '--env',
      '--background',
      '--encoder',
    ]) {
      expect(BUILD_HELP).toContain(flag);
    }
  });
});
