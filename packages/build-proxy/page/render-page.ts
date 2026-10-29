import * as THREE from 'three';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';
import { KTX2Loader } from 'three/examples/jsm/loaders/KTX2Loader.js';
import { MeshoptDecoder } from 'three/examples/jsm/libs/meshopt_decoder.module.js';
import { createStage } from '@cuep3d/stage';
import type { Stage } from '@cuep3d/stage';
import type { StageParams } from '@cuep3d/manifest';

/**
 * Loaded into headless Chromium by packages/build-proxy's Node orchestrator.
 * Bundled standalone with esbuild (see scripts/build-page.mjs) — this file
 * never runs under Node and must not import anything Node-only.
 */
interface CueP3DRender {
  load(url: string): Promise<void>;
  setView(azimuthRad: number, elevationRad: number): void;
  snapshot(): Promise<string>; // base64-encoded PNG bytes
}

declare global {
  interface Window {
    __cuep3dRender?: CueP3DRender;
    __cuep3dPageReady?: boolean;
    __cuep3dPageError?: string;
  }
}

function readParamsFromUrl(): { size: number; stage: StageParams; background: string } {
  const params = new URLSearchParams(window.location.search);
  const size = Number(params.get('size'));
  const stageParam = params.get('stage');
  if (!Number.isFinite(size) || size <= 0)
    throw new Error(`invalid size param: ${params.get('size')}`);
  if (!stageParam) throw new Error('missing stage param');
  const stage = JSON.parse(atob(stageParam)) as StageParams;
  const background = params.get('background') ?? '#ffffff';
  return { size, stage, background };
}

function canvasToPngBase64(canvas: HTMLCanvasElement): Promise<string> {
  return new Promise((resolve, reject) => {
    canvas.toBlob((blob) => {
      if (!blob) {
        reject(new Error('canvas.toBlob returned null'));
        return;
      }
      const reader = new FileReader();
      reader.onloadend = () => {
        const dataUrl = reader.result;
        if (typeof dataUrl !== 'string') {
          reject(new Error('FileReader did not produce a data URL'));
          return;
        }
        resolve(dataUrl.slice(dataUrl.indexOf(',') + 1));
      };
      reader.onerror = () => reject(reader.error ?? new Error('FileReader failed'));
      reader.readAsDataURL(blob);
    }, 'image/png');
  });
}

async function main(): Promise<void> {
  const { size, stage: stageParams, background } = readParamsFromUrl();

  const canvasElement = document.getElementById('c');
  if (!(canvasElement instanceof HTMLCanvasElement)) throw new Error('missing #c canvas element');
  const canvas: HTMLCanvasElement = canvasElement;
  canvas.width = size;
  canvas.height = size;

  const renderer = new THREE.WebGLRenderer({
    canvas,
    antialias: true,
    preserveDrawingBuffer: true,
    alpha: false,
  });
  renderer.setPixelRatio(1);
  renderer.setSize(size, size, false);
  renderer.setClearColor(new THREE.Color(background), 1);

  const stage: Stage = createStage(renderer, stageParams);
  // Baking the manifest background into every frame (§5.2 `proxy.background`)
  // is build-proxy's job, not the shared stage's — the live viewer paints its
  // own clear colour behind the canvas instead.
  stage.scene.background = new THREE.Color(background);
  stage.camera.aspect = 1;
  stage.camera.updateProjectionMatrix();

  const ktx2Loader = new KTX2Loader();
  ktx2Loader.setTranscoderPath('/basis/');
  ktx2Loader.detectSupport(renderer);

  const gltfLoader = new GLTFLoader();
  gltfLoader.setMeshoptDecoder(MeshoptDecoder);
  gltfLoader.setKTX2Loader(ktx2Loader);

  let warmed = false;

  async function load(url: string): Promise<void> {
    const gltf = await gltfLoader.loadAsync(url);
    stage.setModel(gltf.scene);
    await renderer.compileAsync(stage.scene, stage.camera);
    // Two warm renders: PMREM environment and KTX2 textures otherwise show up
    // dark/uninitialized on the very first frame (brief, "Implementation notes").
    stage.render();
    stage.render();
    warmed = true;
  }

  function setView(azimuthRad: number, elevationRad: number): void {
    stage.setView(azimuthRad, elevationRad);
  }

  async function snapshot(): Promise<string> {
    if (!warmed) throw new Error('snapshot() called before load() finished warming the stage');
    stage.render();
    return canvasToPngBase64(canvas);
  }

  window.__cuep3dRender = { load, setView, snapshot };
  window.__cuep3dPageReady = true;
}

main().catch((error: unknown) => {
  window.__cuep3dPageError =
    error instanceof Error ? (error.stack ?? error.message) : String(error);
});
