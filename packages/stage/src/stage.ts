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

export function createStage(renderer: THREE.WebGLRenderer, params: StageParams): Stage {
  renderer.toneMapping = TONE_MAPPING[params.toneMapping];
  renderer.toneMappingExposure = params.exposure;
  renderer.outputColorSpace = THREE.SRGBColorSpace;

  const scene = new THREE.Scene();
  const camera = new THREE.PerspectiveCamera(params.fovDeg, 1, NEAR, FAR);

  let environmentTexture: THREE.Texture | null = null;
  if (params.environment !== 'none') {
    const pmrem = new THREE.PMREMGenerator(renderer);
    const envScene = new RoomEnvironment();
    environmentTexture = pmrem.fromScene(envScene, 0.04).texture;
    scene.environment = environmentTexture;
    pmrem.dispose();

    if (params.environment === 'studio-warm') {
      const warmLight = new THREE.DirectionalLight(0xfff1d8, 0.6);
      warmLight.position.set(2, 3, 2);
      scene.add(warmLight);
    }
  }

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

    setView(nextAzimuthRad, nextElevationRad) {
      azimuthRad = nextAzimuthRad;
      elevationRad = nextElevationRad;
      applyView();
    },

    getView() {
      return { azimuthRad, elevationRad };
    },

    setModel(root) {
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
      environmentTexture?.dispose();
    },
  };
}
