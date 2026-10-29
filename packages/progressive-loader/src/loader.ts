import * as THREE from 'three';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';
import { KTX2Loader } from 'three/examples/jsm/loaders/KTX2Loader.js';
import { MeshoptDecoder } from 'meshoptimizer';
import { resolveUrl, type Tier } from '@understudy3d/manifest';
import type { Stage } from '@understudy3d/stage';
import { fetchWithProgress } from './progress-fetch.js';
import { collectTextures } from './textures.js';

export interface ProgressiveLoaderOptions {
  ktx2TranscoderPath?: string;
}

export interface ProgressiveLoader {
  loadTier(
    tier: Tier,
    baseUrl: string,
    onProgress?: (bytes: number) => void,
  ): Promise<THREE.Object3D>;
  warm(root: THREE.Object3D, stage: Stage): Promise<void>;
  dispose(): void;
}

/**
 * Self-hosted by default (D-005: no paid CDN) — the three.js basis
 * transcoder files (basis_transcoder.js/.wasm) ship in
 * three/examples/jsm/libs/basis; integrators copy them to this path (or
 * pass `ktx2TranscoderPath` to point wherever they actually serve them from,
 * CDN included).
 */
const DEFAULT_KTX2_TRANSCODER_PATH = './basis/';

const WARM_TARGET_SIZE = 4;

function toError(event: unknown): Error {
  if (event instanceof Error) return event;
  if (event && typeof event === 'object' && 'message' in event) {
    return new Error(String((event as { message: unknown }).message));
  }
  return new Error('GLTFLoader: failed to parse tier.');
}

export function createProgressiveLoader(
  renderer: THREE.WebGLRenderer,
  opts: ProgressiveLoaderOptions = {},
): ProgressiveLoader {
  const ktx2Loader = new KTX2Loader();
  ktx2Loader.setTranscoderPath(opts.ktx2TranscoderPath ?? DEFAULT_KTX2_TRANSCODER_PATH);
  ktx2Loader.detectSupport(renderer);

  const gltfLoader = new GLTFLoader();
  gltfLoader.setKTX2Loader(ktx2Loader);
  gltfLoader.setMeshoptDecoder(MeshoptDecoder);

  const warmTarget = new THREE.WebGLRenderTarget(WARM_TARGET_SIZE, WARM_TARGET_SIZE);

  let disposed = false;
  function assertNotDisposed(): void {
    if (disposed) throw new Error('ProgressiveLoader: already disposed.');
  }

  return {
    async loadTier(tier, baseUrl, onProgress) {
      assertNotDisposed();
      const url = resolveUrl(baseUrl, tier.url);
      const buffer = await fetchWithProgress(url, onProgress);

      const gltf = await new Promise<{ scene: THREE.Group }>((resolve, reject) => {
        gltfLoader.parse(buffer, url, resolve, (event) => reject(toError(event)));
      });

      return gltf.scene;
    },

    async warm(root, stage) {
      assertNotDisposed();

      // §5.3: stage.scene already carries the live environment/lights this
      // tier will actually be rendered with — compiling against a different
      // scene risks a different shader variant (e.g. light count) and a
      // stall on the real first frame instead of here.
      const wasVisible = root.visible;
      root.visible = true;
      stage.scene.add(root);

      try {
        await renderer.compileAsync(stage.scene, stage.camera);

        // compileAsync only links shader programs; an actual draw call is
        // what forces texture upload and full GPU pipeline validation, and
        // render() skips invisible objects — so this has to be a real
        // render(), just aimed at a throwaway 4x4 target instead of the
        // visible canvas.
        const previousTarget = renderer.getRenderTarget();
        renderer.setRenderTarget(warmTarget);
        renderer.render(stage.scene, stage.camera);
        renderer.setRenderTarget(previousTarget);

        for (const texture of collectTextures(root)) {
          renderer.initTexture(texture);
        }
      } finally {
        stage.scene.remove(root);
        root.visible = wasVisible;
      }
    },

    dispose() {
      if (disposed) return;
      disposed = true;
      ktx2Loader.dispose();
      warmTarget.dispose();
    },
  };
}
