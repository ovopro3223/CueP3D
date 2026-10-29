import * as THREE from 'three';
import { RoomEnvironment } from 'three/examples/jsm/environments/RoomEnvironment.js';
import type { StageParams } from '@cuep3d/manifest';
import { cameraPositionForView } from './math.js';

/**
 * A frame image the overlay quad can display: whatever the proxy-player
 * hands back (ImageBitmap, HTMLVideoElement, HTMLImageElement) or a raw
 * WebCodecs VideoFrame, which modern browsers accept as a texImage2D source
 * even though three.js's own types don't list it yet.
 */
export type FrameImage = TexImageSource | VideoFrame;

export interface Stage {
  readonly scene: THREE.Scene;
  readonly camera: THREE.PerspectiveCamera;
  /**
   * Builds the PMREM environment (and any preset lights) if `createStage`
   * was asked to defer it. Idempotent; a no-op for `environment: 'none'`.
   * `setModel()` with a model calls it, so a model never renders without
   * its lighting — the caller only needs it explicitly when something
   * (shader warm-up) must see `scene.environment` before the first
   * `setModel()`. See D-014.
   */
  ensureEnvironment(): void;
  setView(azimuthRad: number, elevationRad: number): void;
  getView(): { azimuthRad: number; elevationRad: number };
  setModel(root: THREE.Object3D | null): void;
  setOverlayFrame(image: FrameImage | null): void;
  setOverlayOpacity(alpha: number): void;
  render(): void;
  dispose(): void;
}

const TONE_MAPPING: Record<StageParams['toneMapping'], THREE.ToneMapping> = {
  aces: THREE.ACESFilmicToneMapping,
  neutral: THREE.NeutralToneMapping,
  none: THREE.NoToneMapping,
};

const NEAR = 0.01;
const FAR = 1000;

export interface CreateStageOptions {
  /**
   * Skip building the PMREM environment until `ensureEnvironment()` (or the
   * first `setModel()` with a model). The proxy overlay — a screen-aligned
   * quad with an unlit material — needs no environment, and generating one
   * is the single largest piece of GPU work before the first frame: on the
   * benchmark's headless Chromium the first canvas present waited ~550 ms
   * for it (D-014). Default false: build-proxy and the Plain pane render
   * lit models immediately and keep the eager behaviour.
   */
  deferEnvironment?: boolean | undefined;
}

export function createStage(
  renderer: THREE.WebGLRenderer,
  params: StageParams,
  options: CreateStageOptions = {},
): Stage {
  renderer.toneMapping = TONE_MAPPING[params.toneMapping];
  renderer.toneMappingExposure = params.exposure;
  renderer.outputColorSpace = THREE.SRGBColorSpace;

  const scene = new THREE.Scene();
  const camera = new THREE.PerspectiveCamera(params.fovDeg, 1, NEAR, FAR);

  // The whole render target is kept, not just its texture: three.js only
  // counts a render target's texture down (renderer.info, GPU memory) via
  // `renderTarget.dispose()` — `texture.dispose()` alone on a render-target
  // texture is a no-op in WebGLTextures, which left one texture and its
  // framebuffer behind per stage (found by the viewer's dispose test once
  // the environment was built after its baseline, D-014).
  let environmentTarget: THREE.WebGLRenderTarget | null = null;
  let environmentReady = params.environment === 'none';
  function ensureEnvironment(): void {
    if (environmentReady) return;
    environmentReady = true;
    const pmrem = new THREE.PMREMGenerator(renderer);
    const envScene = new RoomEnvironment();
    environmentTarget = pmrem.fromScene(envScene, 0.04);
    scene.environment = environmentTarget.texture;
    pmrem.dispose();
    // The room's own geometry and materials are only inputs to the PMREM;
    // without this they stayed registered with the renderer for the life
    // of the page (one geometry per stage, visible in renderer.info).
    envScene.dispose();

    if (params.environment === 'studio-warm') {
      const warmLight = new THREE.DirectionalLight(0xfff1d8, 0.6);
      warmLight.position.set(2, 3, 2);
      scene.add(warmLight);
    }
  }
  if (!options.deferEnvironment) ensureEnvironment();

  let currentModel: THREE.Object3D | null = null;
  let azimuthRad = 0;
  let elevationRad = 0;

  function applyView(): void {
    const [x, y, z] = cameraPositionForView(
      azimuthRad,
      elevationRad,
      params.distance,
      params.target,
    );
    camera.position.set(x, y, z);
    camera.up.set(0, 1, 0);
    camera.lookAt(params.target[0], params.target[1], params.target[2]);
  }
  applyView();

  // Overlay (proxy frame) pass: a screen-aligned quad rendered as a second,
  // depth-untested orthographic pass over the main scene, in the same
  // canvas/context — this is what makes the cross-fade a single-canvas
  // operation with no DOM compositing.
  const overlayScene = new THREE.Scene();
  const overlayCamera = new THREE.OrthographicCamera(-1, 1, 1, -1, 0, 1);
  const overlayTexture = new THREE.Texture();
  overlayTexture.colorSpace = THREE.SRGBColorSpace;
  overlayTexture.minFilter = THREE.LinearFilter;
  overlayTexture.magFilter = THREE.LinearFilter;
  overlayTexture.generateMipmaps = false;
  const overlayMaterial = new THREE.MeshBasicMaterial({
    map: overlayTexture,
    transparent: true,
    depthTest: false,
    depthWrite: false,
    opacity: 1,
    // The overlay shows an already-tonemapped, display-ready frame (a PNG
    // baked by this same stage code at build time, or a decoded video/AVIF
    // frame derived from it) — not a linear scene value. MeshBasicMaterial
    // defaults toneMapped:true, which would apply the renderer's tonemapping
    // curve to it a second time. See docs/change-requests/P6-overlay-tonemapping.md.
    toneMapped: false,
  });
  const overlayQuad = new THREE.Mesh(new THREE.PlaneGeometry(2, 2), overlayMaterial);
  overlayQuad.visible = false;
  overlayScene.add(overlayQuad);

  return {
    scene,
    camera,

    ensureEnvironment,

    setView(nextAzimuthRad, nextElevationRad) {
      azimuthRad = nextAzimuthRad;
      elevationRad = nextElevationRad;
      applyView();
    },

    getView() {
      return { azimuthRad, elevationRad };
    },

    setModel(root) {
      if (root) ensureEnvironment();
      if (currentModel) scene.remove(currentModel);
      currentModel = root;
      if (root) scene.add(root);
    },

    setOverlayFrame(image) {
      if (!image) {
        overlayQuad.visible = false;
        return;
      }
      overlayTexture.image = image as unknown as TexImageSource;
      overlayTexture.needsUpdate = true;
      // Upload now, not at the next render. A WebCodecs VideoFrame belongs
      // to the player and can be closed before the next animation frame
      // (LRU eviction, or a GOP re-decode replacing the cached instance);
      // texImage2D of a closed VideoFrame is a silent no-op that leaves the
      // previous frame on screen. Measured: the overlay sat nine frames
      // behind the scrub at handoff, read as a "5.2% codec floor" (D-013).
      renderer.initTexture(overlayTexture);
      overlayQuad.visible = true;
    },

    setOverlayOpacity(alpha) {
      overlayMaterial.opacity = alpha;
    },

    render() {
      renderer.autoClear = true;
      renderer.render(scene, camera);
      if (overlayQuad.visible) {
        renderer.autoClear = false;
        renderer.render(overlayScene, overlayCamera);
        renderer.autoClear = true;
      }
    },

    dispose() {
      overlayQuad.geometry.dispose();
      overlayMaterial.dispose();
      overlayTexture.dispose();
      environmentTarget?.dispose();
    },
  };
}
