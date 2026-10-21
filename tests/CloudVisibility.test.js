import { describe, expect, it, vi } from 'vitest';
import * as THREE from 'three';
import { Engine } from '../src/engine/Engine.js';

// Keep the driver wait unresolved to exercise frames rendered during warmup.
describe('cloud visibility during underwater warmup', () => {
  it.each(['studio', 'infinite', 'planet'])('keeps %s clouds attached while shaders compile', async (worldMode) => {
    const engine = Object.create(Engine.prototype);
    const scene = new THREE.Scene();
    const geometry = new THREE.BoxGeometry();
    const materials = Array.from({ length: 5 }, () => new THREE.MeshBasicMaterial());
    const meshes = materials.map((material) => new THREE.Mesh(geometry, material));
    const chunkGroup = new THREE.Group();
    chunkGroup.add(...meshes.slice(3));
    scene.add(...meshes.slice(0, 3), chunkGroup);
    const parents = meshes.map((mesh) => mesh.parent);
    const target = { width: 640, height: 360 };
    let finishCompile;
    Object.assign(engine, {
      worldMode, scene, renderer: {}, camera: {},
      studioCloud: { mesh: meshes[0] },
      infiniteCloud: { mesh: meshes[1] },
      planetCloudLayer: { mesh: meshes[2] },
      planetCloudChunks: { group: chunkGroup },
      underwater: { _rt: {}, _material: new THREE.MeshBasicMaterial() },
      _resolveCameraCompileTarget: () => ({ renderTarget: target }),
      _ensureUnderwaterWarmTarget: vi.fn(),
      _compileSceneStaggered: vi.fn(() => new Promise((resolve) => { finishCompile = resolve; })),
      _compileExactPass: vi.fn(async () => ({ ready: true })),
    });
    const pending = engine._warmUnderwaterShaders(target);
    expect(finishCompile).toBeTypeOf('function');
    for (const [index, mesh] of meshes.entries()) {
      expect(mesh.parent).toBe(parents[index]);
      expect(engine._isRenderable(mesh)).toBe(true);
    }
    const exclusions = engine._compileSceneStaggered.mock.calls[0][1].skipMaterials;
    for (const material of materials) expect(exclusions.has(material)).toBe(true);
    finishCompile({ ready: true });
    expect(await pending).toBe(true);
    expect(engine._underwaterWarmPromise).toBeNull();
    for (const [index, mesh] of meshes.entries()) expect(mesh.parent).toBe(parents[index]);
    geometry.dispose();
    materials.forEach((material) => material.dispose());
    engine.underwater._material.dispose();
  });
});
