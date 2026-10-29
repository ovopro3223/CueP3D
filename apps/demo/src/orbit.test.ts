import * as THREE from 'three';
import { describe, expect, it } from 'vitest';
import { rotateCameraAroundTarget } from './orbit.js';

describe('rotateCameraAroundTarget', () => {
  it('preserves distance from target', () => {
    const target = new THREE.Vector3(0, 0, 0);
    const camera = new THREE.PerspectiveCamera();
    camera.position.set(0, 0, 2);
    const startDistance = camera.position.distanceTo(target);

    rotateCameraAroundTarget(camera, target, Math.PI / 8, 0.1);

    expect(camera.position.distanceTo(target)).toBeCloseTo(startDistance, 6);
  });

  it('rotates azimuth by the requested delta on the equator', () => {
    const target = new THREE.Vector3(0, 0, 0);
    const camera = new THREE.PerspectiveCamera();
    camera.position.set(0, 0, 2);

    rotateCameraAroundTarget(camera, target, Math.PI / 2, 0);

    expect(camera.position.x).toBeCloseTo(2, 5);
    expect(camera.position.z).toBeCloseTo(0, 5);
    expect(camera.position.y).toBeCloseTo(0, 5);
  });

  it('clamps the polar angle away from the poles', () => {
    const target = new THREE.Vector3(0, 0, 0);
    const camera = new THREE.PerspectiveCamera();
    camera.position.set(0, 0, 2);

    rotateCameraAroundTarget(camera, target, 0, Math.PI * 10);

    const offset = camera.position.clone().sub(target);
    const spherical = new THREE.Spherical().setFromVector3(offset);
    expect(spherical.phi).toBeGreaterThan(0);
    expect(spherical.phi).toBeLessThan(Math.PI);
  });

  it('always points the camera at the target', () => {
    const target = new THREE.Vector3(0.1, 0.2, -0.3);
    const camera = new THREE.PerspectiveCamera();
    camera.position.set(0.1, 0.2, 1.7);

    rotateCameraAroundTarget(camera, target, 1.1, -0.4);

    const forward = new THREE.Vector3();
    camera.getWorldDirection(forward);
    const toTarget = target.clone().sub(camera.position).normalize();
    expect(forward.dot(toTarget)).toBeCloseTo(1, 4);
  });
});
