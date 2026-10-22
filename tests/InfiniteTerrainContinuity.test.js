import { describe, expect, it } from 'vitest';
import * as THREE from 'three';
import { InfiniteWorld } from '../src/engine/terrain/InfiniteWorld.js';
import { InfiniteTerrainBatches } from '../src/engine/terrain/InfiniteTerrainBatches.js';
import { InfiniteTerrainClipmap } from '../src/engine/terrain/InfiniteTerrainClipmap.js';
import { createTerrainUniforms } from '../src/engine/terrain/TerrainMaterial.js';

function world() {
  const material = new THREE.MeshBasicMaterial();
  material.uniforms = {};
  const w = new InfiniteWorld(new THREE.Scene(), material, material, {
    chunkSize: 128, viewRadius: 3, maxHeight: 800, skirtDepth: 40,
  });
  return w;
}

describe('Infinite World surface continuity', () => {
  it('keeps nearby terrain detailed at mountain altitude and coarsens above the terrain bounds', () => {
    const w = world();
    w.chunks.set('0,0', { cx: 0, cz: 0, centerX: 64, centerZ: 64, lod: 3, fresh: true });
    w._updateLOD(new THREE.Vector3(64, 780, 64));
    expect(w.chunks.get('0,0').lod).toBe(0);
    w.setMorphEnabled(false);
    w._updateLOD(new THREE.Vector3(64, 3000, 64));
    expect(w.chunks.get('0,0').lod).toBe(3);
    w.dispose();
  });

  it('publishes an identical shared edge for different live LODs and morph progress', () => {
    const w = world();
    const a = { cx: 0, cz: 0, centerX: 64, centerZ: 64, lod: 0, morph: 0.4 };
    const b = { cx: 1, cz: 0, centerX: 192, centerZ: 64, lod: 1, morph: 0.7 };
    w.chunks.set('0,0', a); w.chunks.set('1,0', b);
    w._updateLOD(new THREE.Vector3(0, 0, 0)); // first step has dt=0
    expect(a.edgeLod[1]).toBeCloseTo(1.7);
    expect(b.edgeLod[3]).toBe(a.edgeLod[1]);
    expect(a.edgeLod[0]).toBeCloseTo(0.4);
    w.dispose();
  });

  it('uploads shared edges into every batch and retains them after a geometry rebuild', () => {
    const group = new THREE.Group();
    const material = new THREE.MeshBasicMaterial();
    const geometries = Array.from({length:4}, () => new THREE.PlaneGeometry());
    const b = new InfiniteTerrainBatches({group, material, geometries, capacity:4});
    const chunks = [{cx:0,cz:0,lod:0,morph:0.25,edgeLod:[0.25,1.5,2,0.25]}];
    b.commit(chunks, 128);
    expect(Array.from(b.meshes[0].geometry.getAttribute('aEdgeLod').array.slice(0,4))).toEqual(chunks[0].edgeLod);
    const replacement = new THREE.PlaneGeometry();
    b.updateGeometry(0, replacement); b.ensureCapacity(16); b.commit(chunks, 128);
    expect(Array.from(b.meshes[0].geometry.getAttribute('aEdgeLod').array.slice(0,4))).toEqual(chunks[0].edgeLod);
    b.dispose(); material.dispose(); for (const g of [...geometries,replacement]) g.dispose();
  });

  it('preserves sub-metre height precision and enough near-field samples for the grid', () => {
    const cache = new InfiniteTerrainClipmap({ renderer:{}, uniforms:createTerrainUniforms(), chunkSize:128, viewRadius:12, octaves:5 });
    const near = cache.levels[0];
    expect(near.span / near.resolution).toBeLessThanOrEqual(128 / 64);
    expect(near.target.texture.type).toBe(THREE.FloatType);
    expect(near.target.texture.internalFormat).toBe('RGBA32F');
    expect(near.target.texture.minFilter).toBe(THREE.NearestFilter); // shader filters explicitly
    cache.dispose();
  });
});
