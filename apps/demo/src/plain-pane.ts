import * as THREE from 'three';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js';
import { createStage, type Stage } from '@cuep3d/stage';
import { validateManifest } from '@cuep3d/manifest';
import { fetchWithProgress } from './fetch-with-progress.js';
import { formatBytes, formatMs, renderMetricsStrip } from './metrics.js';
import { rotateCameraAroundTarget } from './orbit.js';
import type { BenchMetricsSnapshot } from './bench-hook.js';

export interface PlainPaneOptions {
  readonly container: HTMLElement;
  readonly metricsEl: HTMLDListElement;
  readonly baseUrl: string;
  readonly reducedMotion: boolean;
  readonly onUpdate?: ((state: string, metrics: BenchMetricsSnapshot) => void) | undefined;
}

export interface PlainPaneHandle {
  setModel(baseUrl: string): void;
  reload(): void;
  dispose(): void;
}

const KEY_STEP_RAD = THREE.MathUtils.degToRad(8);

function disposeScene(root: THREE.Object3D): void {
  root.traverse((object) => {
    if (!(object instanceof THREE.Mesh)) return;
    object.geometry.dispose();
    const materials = Array.isArray(object.material) ? object.material : [object.material];
    for (const material of materials) {
      for (const key of [
        'map',
        'normalMap',
        'roughnessMap',
        'metalnessMap',
        'emissiveMap',
        'aoMap',
      ] as const) {
        const texture = (material as unknown as Record<string, unknown>)[key];
        if (texture instanceof THREE.Texture) texture.dispose();
      }
      material.dispose();
    }
  });
}

export function mountPlainPane(options: PlainPaneOptions): PlainPaneHandle {
  const { container, metricsEl, onUpdate } = options;
  let baseUrl = options.baseUrl;
  const reducedMotion = options.reducedMotion;

  const renderer = new THREE.WebGLRenderer({ antialias: true });
  renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
  // Matches the proxy frames' baked background (manifest.proxy.background,
  // "#ffffff" for all three demo models) so the two panes are a fair visual
  // comparison; updated again below once the manifest itself is fetched.
  renderer.setClearColor(0xffffff, 1);
  renderer.domElement.tabIndex = 0;
  renderer.domElement.setAttribute(
    'aria-label',
    'Plain pane 3D view. Drag to orbit, or focus and use arrow keys.',
  );
  container.appendChild(renderer.domElement);

  let stage: Stage | null = null;
  let controls: OrbitControls | null = null;
  let currentModel: THREE.Object3D | null = null;
  let rafHandle = 0;
  let disposed = false;
  let generation = 0;
  let abortController: AbortController | null = null;

  function setSize(): void {
    const width = container.clientWidth || 1;
    const height = container.clientHeight || 1;
    renderer.setSize(width, height, false);
    if (stage) {
      stage.camera.aspect = width / height;
      stage.camera.updateProjectionMatrix();
    }
  }

  const resizeObserver = new ResizeObserver(() => {
    setSize();
    if (stage) stage.render();
  });
  resizeObserver.observe(container);

  function renderOnce(): void {
    if (stage) stage.render();
  }

  function startRenderLoop(): void {
    const tick = (): void => {
      if (disposed) return;
      controls?.update();
      renderOnce();
      rafHandle = requestAnimationFrame(tick);
    };
    rafHandle = requestAnimationFrame(tick);
  }

  function stopRenderLoop(): void {
    cancelAnimationFrame(rafHandle);
  }

  function showNote(message: string, tone: 'loading' | 'error'): void {
    let note = container.querySelector<HTMLDivElement>('.viewport-note');
    if (!note) {
      note = document.createElement('div');
      note.className = 'viewport-note';
      container.appendChild(note);
    }
    note.textContent = message;
    note.dataset.tone = tone;
  }

  function clearNote(): void {
    container.querySelector('.viewport-note')?.remove();
  }

  function onKeyDown(event: KeyboardEvent): void {
    if (!stage || !controls) return;
    let dAz = 0;
    let dPolar = 0;
    switch (event.key) {
      case 'ArrowLeft':
        dAz = -KEY_STEP_RAD;
        break;
      case 'ArrowRight':
        dAz = KEY_STEP_RAD;
        break;
      case 'ArrowUp':
        dPolar = -KEY_STEP_RAD;
        break;
      case 'ArrowDown':
        dPolar = KEY_STEP_RAD;
        break;
      default:
        return;
    }
    event.preventDefault();
    rotateCameraAroundTarget(stage.camera, controls.target, dAz, dPolar);
    controls.update();
    renderOnce();
  }
  renderer.domElement.addEventListener('keydown', onKeyDown);

  async function load(forceReload: boolean): Promise<void> {
    const myGeneration = ++generation;
    abortController?.abort();
    abortController = new AbortController();
    const signal = abortController.signal;
    const cacheMode: RequestCache = forceReload ? 'reload' : 'default';

    const startedAt = performance.now();
    let bytesTotal = 0;
    renderMetricsStrip(metricsEl, { label: 'State', value: 'loading' }, [
      { label: 'Time to first render', value: '—' },
      { label: 'Bytes total', value: '—' },
    ]);
    onUpdate?.('loading', { bytesBeforeFirstVisual: 0, bytesTotal: 0 });
    showNote('Loading original .glb…', 'loading');

    try {
      const manifestResponse = await fetch(`${baseUrl}cuep3d.json`, {
        cache: cacheMode,
        signal,
      });
      if (!manifestResponse.ok) {
        throw new Error(`cuep3d.json: ${String(manifestResponse.status)}`);
      }
      const manifestJson = await manifestResponse.json();
      bytesTotal += Number(manifestResponse.headers.get('content-length') ?? 0);
      if (myGeneration !== generation) return;
      const manifest = validateManifest(manifestJson);
      renderer.setClearColor(new THREE.Color(manifest.proxy.background), 1);

      if (stage) stage.dispose();
      controls?.dispose();
      stage = createStage(renderer, manifest.stage);
      controls = new OrbitControls(stage.camera, renderer.domElement);
      controls.target.set(...manifest.stage.target);
      controls.enableDamping = !reducedMotion;
      controls.dampingFactor = 0.08;
      controls.rotateSpeed = 1;
      controls.update();
      setSize();

      const glbBuffer = await fetchWithProgress(
        `${baseUrl}original.glb`,
        { cache: cacheMode, signal },
        (bytesLoaded) => {
          if (myGeneration !== generation) return;
          renderMetricsStrip(metricsEl, { label: 'State', value: 'loading' }, [
            { label: 'Time to first render', value: '—' },
            { label: 'Bytes total', value: formatBytes(bytesTotal + bytesLoaded) },
          ]);
        },
      );
      if (myGeneration !== generation) return;
      bytesTotal += glbBuffer.byteLength;

      const loader = new GLTFLoader();
      const gltf = await new Promise<{ scene: THREE.Object3D }>((resolve, reject) => {
        loader.parse(glbBuffer, '', resolve, reject);
      });
      if (myGeneration !== generation) return;

      const box = new THREE.Box3().setFromObject(gltf.scene);
      const sphere = new THREE.Sphere();
      box.getBoundingSphere(sphere);
      gltf.scene.position.sub(sphere.center);

      if (currentModel) disposeScene(currentModel);
      currentModel = gltf.scene;
      stage.setModel(currentModel);
      clearNote();
      renderOnce();

      const ttfr = performance.now() - startedAt;
      renderMetricsStrip(metricsEl, { label: 'State', value: 'rendered' }, [
        { label: 'Time to first render', value: formatMs(ttfr) },
        { label: 'Bytes total', value: formatBytes(bytesTotal) },
      ]);
      // Plain has no tiering, so TTFV and TTI are the same event (docs/01-
      // design.md §10) and bytesBeforeFirstVisual == bytesTotal: nothing is
      // visible until the whole .glb has parsed.
      onUpdate?.('rendered', {
        ttfv: ttfr,
        tti: ttfr,
        bytesBeforeFirstVisual: bytesTotal,
        bytesTotal,
      });
    } catch (error) {
      if (signal.aborted) return;
      clearNote();
      const message = error instanceof Error ? error.message : String(error);
      showNote(`Failed to load: ${message}`, 'error');
      renderMetricsStrip(metricsEl, { label: 'State', value: 'error' }, [
        { label: 'Time to first render', value: '—' },
        { label: 'Bytes total', value: formatBytes(bytesTotal) },
      ]);
      onUpdate?.('error', { bytesBeforeFirstVisual: bytesTotal, bytesTotal });
    }
  }

  startRenderLoop();
  void load(false);

  return {
    setModel(newBaseUrl: string): void {
      baseUrl = newBaseUrl;
      void load(false);
    },
    reload(): void {
      void load(true);
    },
    dispose(): void {
      disposed = true;
      stopRenderLoop();
      abortController?.abort();
      resizeObserver.disconnect();
      renderer.domElement.removeEventListener('keydown', onKeyDown);
      controls?.dispose();
      if (currentModel) disposeScene(currentModel);
      stage?.dispose();
      renderer.dispose();
      renderer.domElement.remove();
    },
  };
}
