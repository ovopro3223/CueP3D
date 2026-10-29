/**
 * @cuep3d/proxy-player public API. Frozen per docs/01-design.md §5.4 —
 * a sibling package (viewer, P6) is written against these signatures without
 * reading this package's internals, so nothing here may change shape.
 */

export type FrameImage = VideoFrame | ImageBitmap | HTMLImageElement | HTMLVideoElement;

export interface ProxyPlayer {
  readonly firstFrame: Promise<FrameImage>;
  readonly available: { from: number; to: number };
  onAvailableChange(cb: () => void): () => void;
  getFrame(index: number): Promise<FrameImage>;
  prefetch(centerIndex: number, radius: number): void;
  readonly bytesLoaded: number;
  readonly bytesTotal: number;
  dispose(): void;
}
