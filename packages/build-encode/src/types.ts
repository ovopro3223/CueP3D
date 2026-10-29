export type Av1EncoderChoice = 'libaom' | 'svt-av1' | 'nvenc';
export type EncoderPreference = 'auto' | Av1EncoderChoice;

export interface EncodeQuality {
  av1Crf?: number;
  vp9Crf?: number;
  avifCrf?: number;
}

export interface EncodeProxyOptions {
  /** Directory of "NNN.png" frames from P2, at the largest proxy size. */
  framesDir: string;
  outDir: string;
  /** Square render sizes, e.g. [1024, 512]. AV1 is encoded at every size; VP9 and AVIF only at the smallest. */
  sizes: number[];
  /** Nominal timeline fps for <video> seeking (24). */
  fps: number;
  /** Keyframe interval. */
  gop: number;
  encoder: EncoderPreference;
  quality?: EncodeQuality;
}

export const DEFAULT_QUALITY: Required<EncodeQuality> = {
  av1Crf: 30,
  vp9Crf: 33,
  avifCrf: 28,
};
