import * as THREE from 'three';

const POLAR_EPSILON = 1e-3;

/**
 * Nudges `camera` by (deltaAzimuthRad, deltaPolarRad) around `target`, for
 * keyboard-driven orbit on top of three.js OrbitControls. Safe to call
 * alongside OrbitControls because OrbitControls.update() re-derives its own
 * internal Spherical from the camera's *current* position/target offset on
 * every call (`spherical.setFromVector3(offset)` at the top of update()), so
 * a direct position write here is picked up, not overwritten, by the next
 * controls.update().
 */
export function rotateCameraAroundTarget(
  camera: THREE.Camera,
  target: THREE.Vector3,
  deltaAzimuthRad: number,
  deltaPolarRad: number,
): void {
  const offset = camera.position.clone().sub(target);
  const spherical = new THREE.Spherical().setFromVector3(offset);
  spherical.theta += deltaAzimuthRad;
  spherical.phi = THREE.MathUtils.clamp(
    spherical.phi + deltaPolarRad,
    POLAR_EPSILON,
    Math.PI - POLAR_EPSILON,
  );
  offset.setFromSpherical(spherical);
  camera.position.copy(target).add(offset);
  camera.lookAt(target);
}
