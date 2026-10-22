import { describe, expect, it, vi } from 'vitest';
import * as THREE from 'three';
import { Engine } from '../src/engine/Engine.js';

function harness() {
  const e = Object.create(Engine.prototype);
  Object.assign(e, { worldMode:'planet', params:{planetRadius:16000,heightScale:560,seaLevel:100}, camera:new THREE.PerspectiveCamera(60,1,.64,192000) });
  return e;
}

describe('Planet camera depth precision', () => {
  it('separates sub-metre water/terrain depths in orbit with a 24-bit buffer', () => {
    const e = harness(); e.camera.position.set(0,0,41600); e._syncPlanetCameraClipping();
    expect(e.camera.near).toBeCloseTo(496.84);
    const depth = (near,d) => {const far=e.camera.far; return far/(far-near)-far*near/((far-near)*d);};
    const delta = n => depth(n,25500.5)-depth(n,25500);
    expect(delta(.64)).toBeLessThan(1/(2**24));
    expect(delta(e.camera.near)).toBeGreaterThan(4/(2**24));
    // The near plane remains well inside the empty space before all relief.
    expect(e.camera.near).toBeLessThan(41600-16000-e._maxHeight());
  });

  it('restores close clipping while walking, flying or approaching the surface', () => {
    const e=harness();
    e.camera.position.set(0,0,96000);e._syncPlanetCameraClipping();expect(e.camera.near).toBe(640);
    e.camera.position.set(0,0,17280);e._syncPlanetCameraClipping();expect(e.camera.near).toBeCloseTo(10.44);
    e.camera.position.set(0,0,16400);e._syncPlanetCameraClipping();expect(e.camera.near).toBe(.64);
  });

  it('leaves other world modes untouched and skips redundant projection updates', () => {
    const e=harness(); e.camera.position.set(0,0,41600);
    e.camera.updateProjectionMatrix=vi.fn(e.camera.updateProjectionMatrix.bind(e.camera));
    e._syncPlanetCameraClipping(); e._syncPlanetCameraClipping();
    expect(e.camera.updateProjectionMatrix).toHaveBeenCalledTimes(1);
    e.worldMode='studio';e.camera.near=1;e._syncPlanetCameraClipping();expect(e.camera.near).toBe(1);
    e.worldMode='planet';e.camera=new THREE.OrthographicCamera(-1,1,1,-1,.1,100);e._syncPlanetCameraClipping();expect(e.camera.near).toBe(.1);
  });
});
