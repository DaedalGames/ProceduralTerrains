import { describe, expect, it } from 'vitest';
import * as THREE from 'three';
import { miniBevelPoint, miniFootprint, sampleMiniHeight } from '../src/engine/mini/MiniBevel.js';
import { createMiniTerrainState, normalizeMiniTerrainState, resolveMiniLayout } from '../src/engine/mini/MiniTerrainSettings.js';
import { MiniTerrainController } from '../src/engine/mini/MiniTerrainController.js';
import { buildMiniWaterCutGeometry } from '../src/engine/mini/MiniWaterCut.js';
import { createTerrainUniforms } from '../src/engine/terrain/TerrainMaterial.js';
import { createMiniWaterSurfaceMaterial, createMiniWaterCutMaterial } from '../src/engine/mini/MiniWaterMaterial.js';
import { buildMiniWaterVolume, buildMiniSectionWalls } from '../src/engine/mini/MiniExport.js';
import { UnderwaterController } from '../src/engine/render/UnderwaterController.js';

function expectChamferGeometry(geometry, half, bevel, rounded = false) {
  const p = geometry.getAttribute('position');
  const normals = geometry.getAttribute('normal');
  for (let i = 0; i < p.count; i++) {
    if (rounded) {
      const distance = Math.hypot(Math.max(Math.abs(p.getX(i)) - half + bevel, 0), Math.max(Math.abs(p.getZ(i)) - half + bevel, 0));
      expect(distance).toBeLessThanOrEqual(bevel + 1e-4);
    } else {
      expect(Math.abs(p.getX(i)) + Math.abs(p.getZ(i))).toBeLessThanOrEqual(2 * half - bevel + 1e-4);
    }
  }
  const indices = geometry.index.array;
  for (let i = 0; i < indices.length; i += 3) {
    const [a, b, c] = Array.from(indices.slice(i, i + 3), (index) => new THREE.Vector3().fromBufferAttribute(p, index));
    const face = b.sub(a).cross(c.sub(a));
    if (face.lengthSq() < 1e-12) continue;
    expect(face.dot(new THREE.Vector3().fromBufferAttribute(normals, indices[i]))).toBeGreaterThan(0);
  }
}

describe('Mini edges and bevels', () => {
  it('links either slider, uses water size when enabling sync, and preserves independent values when unlinked', () => {
    const ctrl = new MiniTerrainController({ worldMode: 'studio' });
    ctrl.state = normalizeMiniTerrainState({ waterBevel: 3, terrainBevel: 8 });
    ctrl.state = ctrl.planChange({ bevelSync: true }).state;
    expect(ctrl.state).toMatchObject({ bevelSync: true, waterBevel: 3, terrainBevel: 3 });
    for (const patch of [{ waterBevel: 6 }, { terrainBevel: 4 }]) {
      const plan = ctrl.planChange(patch);
      expect(plan.params).toEqual({});
      expect(plan.composition).toBe(false);
      expect(plan.state.waterBevel).toBe(plan.state.terrainBevel);
      ctrl.state = plan.state;
    }
    expect(ctrl.state.waterBevel).toBe(4);
    ctrl.state = ctrl.planChange({ bevelSync: false, terrainBevel: 9 }).state;
    expect(ctrl.state).toMatchObject({ waterBevel: 4, terrainBevel: 9 });
    const saved = normalizeMiniTerrainState(JSON.parse(JSON.stringify({ ...ctrl.state, bevelStyle: 'rounded' })));
    expect(saved).toMatchObject({ bevelSync: false, bevelStyle: 'rounded', waterBevel: 4, terrainBevel: 9 });
  });

  it('projects rounded corners onto a circular arc and keeps the existing chamfer style by default', () => {
    const point = miniBevelPoint(100, 100, 100, 20, true);
    expect(Math.hypot(point[0] - 80, point[1] - 80)).toBeCloseTo(20);
    expect(point[0]).toBeGreaterThan(90);
    expect(miniBevelPoint(100, 0, 100, 20, true)).toEqual([100, 0]);
    const ring = miniFootprint(100, 20, true);
    expect(ring).toHaveLength(68);
    for (const [x, z] of ring) {
      expect(Math.hypot(Math.max(Math.abs(x) - 80, 0), Math.max(Math.abs(z) - 80, 0))).toBeCloseTo(20);
    }
    const geo = buildMiniWaterCutGeometry(100, -40, 30, 0, 20, true);
    expect(geo.index.count).toBe(68 * 6);
    const water = buildMiniWaterVolume({ at: () => -10, res: 8, half: 100, seaLevel: 30, baseY: -40, bevel: 20, rounded: true });
    const walls = buildMiniSectionWalls({ at: () => 10, res: 8, half: 100, seaLevel: 30, baseY: -40, bevel: 20, rounded: true,
      cut: { topsoil: [0.1, 0.1, 0.1], bandA: [0.2, 0.2, 0.2], bandB: [0.3, 0.3, 0.3], deep: [0.1, 0.1, 0.1], sediment: [0.4, 0.4, 0.4], bands: 8, topsoilDepth: 4, reliefHeight: 100 } });
    for (const geometry of [geo, water, walls]) {
      expectChamferGeometry(geometry, 100, 20, true);
      geometry.dispose();
    }
    expect(normalizeMiniTerrainState({}).bevelStyle).toBe('chamfer');
  });

  it('respects the rounded water volume instead of the smaller chamfered volume', () => {
    const state = { worldMode: 'studio', cameraPos: new THREE.Vector3(93, 5, 93), seaLevel: 30,
      waterActive: true, quality: 'high', volume: { minX: -100, maxX: 100, minZ: -100, maxZ: 100, floorY: -40, bevel: 20, rounded: true } };
    const ctrl = new UnderwaterController();
    ctrl.update(1, state);
    expect(ctrl.isUnderwater).toBe(true);
    ctrl.update(1, { ...state, cameraPos: new THREE.Vector3(99, 5, 99) });
    expect(ctrl.isUnderwater).toBe(false);
  });

  it('preserves old square projects and serializes independent presentation controls', () => {
    const original = createMiniTerrainState();
    expect(original).toMatchObject({ waterEdges: 1, waterBevel: 0, terrainBevel: 0 });
    const state = normalizeMiniTerrainState({ ...original, waterEdges: 0, waterBevel: 3, terrainBevel: 8 });
    expect(normalizeMiniTerrainState(JSON.parse(JSON.stringify(state)))).toEqual(state);
    expect(resolveMiniLayout(state).waterBevel).toBeCloseTo(state.width * 0.03);
    expect(resolveMiniLayout(state).terrainBevel).toBeCloseTo(state.width * 0.08);
    expect(normalizeMiniTerrainState({ waterEdges: 9, waterBevel: -5, terrainBevel: 500 })).toMatchObject({ waterEdges: 2, waterBevel: 0, terrainBevel: 10 });
  });

  it('changes the presentation without changing the terrain field or seed', () => {
    const engine = { worldMode: 'studio', params: {}, uniforms: createTerrainUniforms() };
    const ctrl = new MiniTerrainController(engine);
    ctrl.state = createMiniTerrainState();
    const plan = ctrl.planChange({ waterEdges: 0, waterBevel: 4, terrainBevel: 6 });
    expect(plan.params).toEqual({});
    expect(plan.composition).toBe(false);
    expect(plan.state.seed).toBe(ctrl.state.seed);
    ctrl.state = plan.state;
    ctrl.applyUniforms(engine.uniforms);
    expect(engine.uniforms.uMiniTerrainBevel.value).toBeCloseTo(ctrl.state.width * 0.06);
    ctrl.waterSurface = createMiniWaterSurfaceMaterial(engine.uniforms);
    ctrl.waterCut = { material: createMiniWaterCutMaterial(engine.uniforms) };
    ctrl._applyWaterLook();
    for (const material of [ctrl.waterSurface, ctrl.waterCut.material]) {
      expect(material.uniforms.uMiniWaterEdges.value).toBe(0);
      expect(material.uniforms.uMiniWaterBevel.value).toBeCloseTo(ctrl.state.width * 0.04);
      material.dispose();
    }
    engine.worldMode = 'infinite';
    ctrl.applyUniforms(engine.uniforms);
    expect(engine.uniforms.uMiniTerrainBevel.value).toBe(0);
  });

  it('chamfers corners without moving the center or straight edge middles', () => {
    expect(miniBevelPoint(100, 100, 100, 20)).toEqual([90, 90]);
    expect(miniBevelPoint(-100, -100, 100, 20)).toEqual([-90, -90]);
    expect(miniBevelPoint(0, 0, 100, 20)).toEqual([0, 0]);
    expect(miniBevelPoint(100, 0, 100, 20)).toEqual([100, 0]);
    expect(miniFootprint(100, 0)).toHaveLength(4);
    expect(miniFootprint(100, 20)).toHaveLength(8);
    expect(sampleMiniHeight((i, j) => i + j * 2, 10, 100, 10, -10)).toBeCloseTo(14.5);
  });

  it('builds eight outward faces and exports chamfered water and terrain blocks', () => {
    const cut = buildMiniWaterCutGeometry(100, -40, 30, 0, 20);
    expect(cut.index.count).toBe(48);
    const water = buildMiniWaterVolume({ at: () => -10, res: 8, half: 100, seaLevel: 30, baseY: -40, bevel: 20 });
    const walls = buildMiniSectionWalls({ at: () => 10, res: 8, half: 100, seaLevel: 30, baseY: -40, bevel: 20,
      cut: { topsoil: [0.1, 0.1, 0.1], bandA: [0.2, 0.2, 0.2], bandB: [0.3, 0.3, 0.3], deep: [0.1, 0.1, 0.1], sediment: [0.4, 0.4, 0.4], bands: 8, topsoilDepth: 4, reliefHeight: 100 } });
    for (const geometry of [cut, water, walls]) {
      expectChamferGeometry(geometry, 100, 20);
      geometry.dispose();
    }
  });

  it('does not activate underwater effects in removed water corners', () => {
    const controller = new UnderwaterController();
    controller.update(1, { worldMode: 'studio', cameraPos: new THREE.Vector3(99, 5, 99), seaLevel: 30,
      waterActive: true, quality: 'high', volume: { minX: -100, maxX: 100, minZ: -100, maxZ: 100, floorY: -40, bevel: 20 } });
    expect(controller.isUnderwater).toBe(false);
    expect(controller.underwaterBlend).toBe(0);
  });
});

describe('Mini circle shape', () => {
  it('defaults to square and derives a full-radius rounded bevel for circles', () => {
    expect(createMiniTerrainState().shape).toBe('square');
    expect(normalizeMiniTerrainState({ recipe: 'cove', shape: 'hexagon' }).shape).toBe('square');
    const square = resolveMiniLayout(createMiniTerrainState());
    expect(square.terrainBevel).toBe(0);
    expect(square.rounded).toBe(false);
    const L = resolveMiniLayout({ ...createMiniTerrainState(), shape: 'circle', terrainBevel: 4, bevelStyle: 'chamfer' });
    expect(L.terrainBevel).toBe(L.half);
    expect(L.waterBevel).toBe(L.half);
    expect(L.rounded).toBe(true);
  });

  it('projects the footprint onto a circle', () => {
    const [x, z] = miniBevelPoint(100, 100, 100, 100, true);
    expect(Math.hypot(x, z)).toBeCloseTo(100, 6);
    expect(miniBevelPoint(30, -40, 100, 100, true)).toEqual([30, -40]);
    for (const [px, pz] of miniFootprint(100, 100, true)) expect(Math.hypot(px, pz)).toBeCloseTo(100, 6);
  });

  it('keeps the water cut on its inset circle', () => {
    const geometry = buildMiniWaterCutGeometry(100, -40, 30, 0.5, 100, true);
    const pos = geometry.getAttribute('position');
    for (let i = 0; i < pos.count; i++) expect(Math.hypot(pos.getX(i), pos.getZ(i))).toBeCloseTo(99.5, 4);
    geometry.dispose();
  });
});
