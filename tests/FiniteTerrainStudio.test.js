import { describe, it, expect } from 'vitest';
import * as THREE from 'three';
import { Engine } from '../src/engine/Engine.js';
import { FiniteTerrainRuntime } from '../src/runtime/FiniteTerrainRuntime.js';
import { createTerrainUniforms, createTerrainMaterial } from '../src/engine/terrain/TerrainMaterial.js';
import { DEFAULT_PARAMS } from '../src/engine/presets.js';
import { applyTerrainShapeUniforms, applyTerrainShadingUniforms } from '../src/runtime/TerrainParameters.js';

describe('studio / library shared finite runtime', () => {
  it('keeps the studio and standalone runtime on the same geometry, LOD and culling path', () => {
    const uniforms = createTerrainUniforms();
    const material = createTerrainMaterial(uniforms, 7, undefined, { variant: 'base', worldMode: 'studio' });
    const runtime = new FiniteTerrainRuntime(new THREE.Scene(), material);
    runtime.board.build({ chunkCount: 4, chunkSize: 64, maxHeight: 800, skirtDepth: 24, lodSegments: [16, 8, 4, 2] });
    const camera = new THREE.PerspectiveCamera(50, 1, 1, 10000);
    camera.position.set(500, 600, 700); camera.lookAt(0, 0, 0);
    const engine = Object.create(Engine.prototype);
    Object.assign(engine, { camera, board: runtime.board });
    engine._refreshStudioChunkView(123);
    const lod = [...runtime.board.lodCounts];
    const visible = runtime.board.visibleChunkCount;
    runtime.update(camera);
    expect(runtime.board.lodCounts).toEqual(lod);
    expect(runtime.board.visibleChunkCount).toBe(visible);
    expect(engine._lastLodUpdate).toBe(123);
    runtime.dispose(); material.dispose();
  });

  it('preserves seed-domain, scale, edge and shading semantics from the studio', () => {
    const u = createTerrainUniforms();
    applyTerrainShapeUniforms(u, DEFAULT_PARAMS, 2048);
    applyTerrainShadingUniforms(u, DEFAULT_PARAMS, { size: 2048, skirtDepth: 44.8, wallThickness: 12.288 });
    expect(u.uSeedOffset.value.toArray()).toEqual([
      -646.3245668411255, -634.9020133018494,
    ]);
    expect(u.uFrequency.value).toBe(45 * 0.1 / 2048);
    expect(u.uTerrainFormationSeaLevel.value).toBe(100);
    expect(u.uPlinthBaseY.value).toBe(-44.8);
    expect(u.uRockSlopeHi.value).toBeGreaterThan(u.uRockSlopeLo.value);
  });
});
