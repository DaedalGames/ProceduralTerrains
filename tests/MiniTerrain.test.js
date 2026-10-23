import { describe, expect, it } from 'vitest';
import * as THREE from 'three';
import {
  MINI_CHUNKS_PER_SIDE,
  MINI_FORMATION_SEA01,
  MINI_PROCEDURAL_RELIEF,
  MINI_RECIPE_IDS,
  MINI_TERRAIN_VERSION,
  createMiniTerrainState,
  deriveMiniSeeds,
  miniCompositionUniformValues,
  miniLodSegments,
  miniOctaveCap,
  miniParamsPatch,
  normalizeMiniTerrainState,
  resolveMiniComposition,
  resolveMiniFraming,
  resolveMiniLayout,
} from '../src/engine/mini/MiniTerrainSettings.js';
import { miniComposeCPU, MINI_COMPOSITION_GLSL } from '../src/engine/mini/miniCompositionGLSL.js';
import { MiniTerrainController } from '../src/engine/mini/MiniTerrainController.js';
import { buildMiniWaterCutGeometry } from '../src/engine/mini/MiniWaterCut.js';
import { UnderwaterController } from '../src/engine/render/UnderwaterController.js';
import { buildHeightGLSL, COMMON_UNIFORMS_GLSL } from '../src/engine/terrain/terrainGLSL.js';
import { createTerrainUniforms } from '../src/engine/terrain/TerrainMaterial.js';

function uniformsFor(state, { stack = 0.25 } = {}) {
  const L = resolveMiniLayout(state);
  const c = miniCompositionUniformValues(state);
  return {
    stack,
    L,
    u: {
      uMiniShape: { value: c.shape },
      uMiniFrame: { value: new THREE.Vector4(...c.frame) },
      uMiniGeometry: { value: new THREE.Vector4(...c.geometry) },
      uMiniHeights: { value: new THREE.Vector4(...c.heights) },
      uMiniWobble: { value: new THREE.Vector4(...c.wobble) },
      uMiniDetail: { value: new THREE.Vector4(...c.detail) },
      uBoardHalf: { value: L.half },
      uHeightScale: { value: L.heightScale },
      uTerrainFormationSeaLevel: { value: L.formationSea },
      uInfiniteMode: { value: 0 },
    },
  };
}

// World position at normalized local coordinates (lateral, front) of the
// composition frame, so recipe assertions do not depend on the seed's swing.
function worldAt(state, lateral, front) {
  const c = resolveMiniComposition(state);
  const [fx, fz, cx, cz] = c.frame;
  const half = resolveMiniLayout(state).half;
  const px = cx + lateral * fz + front * fx;
  const pz = cz - lateral * fx + front * fz;
  return [px * half, pz * half];
}

describe('Mini Terrain document', () => {
  it('returns null for projects without a Mini section (old projects unchanged)', () => {
    expect(normalizeMiniTerrainState(undefined)).toBeNull();
    expect(normalizeMiniTerrainState(null)).toBeNull();
    expect(normalizeMiniTerrainState('cove')).toBeNull();
  });

  it('normalizes, clamps and versions a stored section', () => {
    const s = normalizeMiniTerrainState({
      recipe: 'nope', seed: -1, width: 99999, quality: 'ultra', relief: 9,
      waterLevel: -3, vegetation: 2, clouds: 'x', backdrop: [2, -1, 0.5],
      camera: { views: [{ name: 'A', theta: 1, phi: 1, radius: 900 }, { theta: 'bad' }] },
    });
    expect(s.version).toBe(MINI_TERRAIN_VERSION);
    expect(s.recipe).toBe('procedural');
    expect(s.preset).toBe('archipelago');
    expect(s.seed).toBe(4294967295);
    expect(s.width).toBe(2048);
    expect(s.quality).toBe('high');
    expect(s.relief).toBe(1.6);
    expect(s.waterLevel).toBe(0);
    expect(s.vegetation).toBe(1);
    expect(s.backdrop).toEqual([1, 0, 0.5]);
    expect(s.camera.views).toHaveLength(1);
    expect(s.camera.views[0].target).toEqual([0, 0, 0]);
  });

  it('round-trips through JSON exactly', () => {
    const s = createMiniTerrainState({ recipe: 'islet', seed: 42 });
    expect(normalizeMiniTerrainState(JSON.parse(JSON.stringify(s)))).toEqual(s);
  });
});

describe('Mini Terrain seeds and composition', () => {
  it('derives independent, deterministic sub-seeds', () => {
    const a = deriveMiniSeeds(1234);
    expect(deriveMiniSeeds(1234)).toEqual(a);
    expect(new Set(Object.values(a)).size).toBe(4);
    expect(deriveMiniSeeds(1235).relief).not.toBe(a.relief);
  });

  it('keeps the composition stable across quality, vegetation, clouds and water level', () => {
    const base = createMiniTerrainState({ recipe: 'cove', seed: 777 });
    const ref = resolveMiniComposition(base);
    for (const patch of [{ quality: 'balanced' }, { quality: 'capture' }, { vegetation: 0 }, { clouds: 1 }, { waterLevel: 0.9 }, { cutStyle: 'dark' }]) {
      expect(resolveMiniComposition({ ...base, ...patch })).toEqual(ref);
    }
    expect(resolveMiniComposition({ ...base, seed: 778 })).not.toEqual(ref);
  });

  it('only exposes a composition when a Mini document is present', () => {
    expect(miniCompositionUniformValues(null).shape).toBe(0);
    for (const id of MINI_RECIPE_IDS.filter((r) => r !== 'procedural')) {
      expect(miniCompositionUniformValues(createMiniTerrainState({ recipe: id })).shape).toBeGreaterThan(0);
    }
    // a fully procedural diorama imposes no silhouette
    expect(miniCompositionUniformValues(createMiniTerrainState({ recipe: 'procedural' })).shape).toBe(0);
  });

  it('scales a procedural preset to the footprint and keeps its shape params', () => {
    const s = createMiniTerrainState({ recipe: 'procedural', preset: 'alpine', seed: 4 });
    const p = miniParamsPatch(s, 'all');
    const L = resolveMiniLayout(s);
    expect(p.preset).toBe('alpine');
    expect(p.snowLine).toBe(0.48);                    // preset look kept
    // softened into a landscape model: gentler ridges, rounded peaks
    expect(p.ridge).toBeCloseTo(0.92 * 0.62, 3);
    expect(p.terrainSmoothing).toBeGreaterThanOrEqual(0.6);
    expect(p.heightScale).toBe(Math.round(640 * 0.5 * MINI_PROCEDURAL_RELIEF));   // 2048 → 1024 footprint
    expect(p.terrainFormationSeaLevel).toBeCloseTo(24 * 0.5 * MINI_PROCEDURAL_RELIEF, 1);
    expect(p.chunkCount).toBe(1);
    expect(L.seaLevel).toBeGreaterThan(0.5);
    expect(miniParamsPatch(s, 'structure')).toEqual({
      chunkCount: 1, chunkSize: 1024, heightScale: p.heightScale, terrainFormationSeaLevel: p.terrainFormationSeaLevel,
      waterMode: 'volumetric', waterQualityPreset: 'custom',
    });
  });
});

describe('Mini Terrain params and invalidation scopes', () => {
  const state = createMiniTerrainState({ recipe: 'cove', seed: 9 });

  it('builds one chunk of W with no edge falloff and a frozen formation level', () => {
    const p = miniParamsPatch(state, 'all');
    const L = resolveMiniLayout(state);
    expect(p.chunkCount).toBe(1);
    expect(p.chunkSize).toBe(L.width);
    expect(p.falloff).toBe(0);
    expect(p.terrainFormationSeaLevel).toBeCloseTo(MINI_FORMATION_SEA01 * L.reliefHeight, 1);
    expect(p.propsSeed).toBe(deriveMiniSeeds(9).props);
    expect(p.waterMode).toBe('volumetric');
  });

  it('water level moves the water only', () => {
    const lo = miniParamsPatch({ ...state, waterLevel: 0 }, 'water');
    const hi = miniParamsPatch({ ...state, waterLevel: 1 }, 'water');
    expect(Object.keys(lo)).toEqual(['seaLevel', 'waterEnabled']);
    expect(hi.seaLevel).toBeGreaterThan(lo.seaLevel);
    expect(lo.seaLevel).toBeGreaterThan(0.5);
    expect(miniParamsPatch({ ...state, waterLevel: 0 }, 'all').terrainFormationSeaLevel)
      .toBe(miniParamsPatch({ ...state, waterLevel: 1 }, 'all').terrainFormationSeaLevel);
  });

  it('separates vegetation, clouds and quality from relief', () => {
    expect(Object.keys(miniParamsPatch(state, 'props')).every((k) => k.startsWith('props'))).toBe(true);
    expect(Object.keys(miniParamsPatch(state, 'clouds')).every((k) => k.startsWith('cloud'))).toBe(true);
    expect(Object.keys(miniParamsPatch(state, 'quality'))).toEqual(['waterMode', 'waterQualityPreset']);
    // per-chunk 2:1 LOD ladder; LOD0 across the chunk grid = full resolution
    expect(miniLodSegments({ ...state, quality: 'balanced' })).toEqual([32, 16, 8, 4]);
    expect(miniLodSegments({ ...state, quality: 'high' })).toEqual([64, 32, 16, 8]);
    expect(miniLodSegments({ ...state, quality: 'capture' })).toEqual([128, 64, 32, 16]);
    expect(miniLodSegments(state)[0] * MINI_CHUNKS_PER_SIDE).toBe(resolveMiniLayout(state).segments);
  });

  it('band-limits the noise octaves to the surface mesh', () => {
    // finest ridge octave keeps >= 3 surface quads per lattice cell
    for (const quality of ['balanced', 'high', 'capture']) {
      for (const recipe of MINI_RECIPE_IDS) {
        const s = { ...createMiniTerrainState({ recipe, preset: 'alpine' }), quality };
        const p = miniParamsPatch(s, 'all');
        const segments = resolveMiniLayout(s).segments;
        expect(p.octaves).toBe(miniOctaveCap(p, segments));
        const finestCells = p.noiseScale * 0.1 * 1.7 * p.lacunarity ** (p.octaves - 1);
        if (p.octaves > 3) expect(finestCells).toBeLessThanOrEqual(segments / 3);
      }
    }
    // lower noise scales (broader features) leave room for more detail
    expect(miniOctaveCap({ noiseScale: 15, lacunarity: 2.05 }, 256))
      .toBeGreaterThan(miniOctaveCap({ noiseScale: 60, lacunarity: 2.05 }, 256));
    expect(Object.keys(miniParamsPatch(state, 'shape'))).toContain('octaves');
  });

  it('scales trees, rocks and grass with Props size only', () => {
    const ctrl = new MiniTerrainController({ worldMode: 'studio' });
    ctrl.state = state;
    const base = miniParamsPatch(state, 'all');
    expect(state.propScale).toBe(1);
    const bigger = ctrl.planChange({ propScale: 2 });
    expect(bigger.composition).toBe(false);
    expect(Object.keys(bigger.params).sort()).toEqual(['propsGrass', 'propsRockScale', 'propsTreeScale']);
    expect(bigger.params.propsTreeScale).toBeCloseTo(base.propsTreeScale * 2, 3);
    expect(bigger.params.propsRockScale).toBeCloseTo(base.propsRockScale * 2, 3);
    expect(normalizeMiniTerrainState({ ...state, propScale: 99 }).propScale).toBe(3);
  });

  it('plans controller changes per category', () => {
    const ctrl = new MiniTerrainController({ worldMode: 'studio' });
    ctrl.state = state;
    const water = ctrl.planChange({ waterLevel: 0.8 });
    expect(water.composition).toBe(false);
    expect(Object.keys(water.params)).toEqual(['seaLevel', 'waterEnabled']);
    const veg = ctrl.planChange({ vegetation: 0.1 });
    expect(veg.composition).toBe(false);
    expect(Object.keys(veg.params).every((k) => k.startsWith('props'))).toBe(true);
    const seed = ctrl.planChange({ seed: 12345 });
    expect(seed.composition).toBe(true);
    expect(Object.keys(seed.params).sort()).toEqual(['propsSeed', 'seed']);
    expect(seed.state.vegetation).toBe(state.vegetation);
    const recipe = ctrl.planChange({ recipe: 'lake' });
    expect(recipe.palette.palettePreset).toBe('custom');
    expect(recipe.params.chunkCount).toBe(1);
    const relief = ctrl.planChange({ relief: 1.3 });
    expect(relief.composition).toBe(true);
    expect(Object.keys(relief.params).sort())
      .toEqual(['cloudAltitude', 'heightScale', 'seaLevel', 'terrainFormationSeaLevel', 'waterEnabled']);
  });

  it('relief rescales a procedural diorama and its water together', () => {
    const ctrl = new MiniTerrainController({ worldMode: 'studio' });
    ctrl.state = createMiniTerrainState({ recipe: 'procedural', seed: 7, preset: 'highlands' });
    const base = miniParamsPatch(ctrl.state, 'all');
    const taller = ctrl.planChange({ relief: ctrl.state.relief * 1.5 });
    expect(taller.params.heightScale).toBeGreaterThan(base.heightScale * 1.4);
    expect(taller.params.terrainFormationSeaLevel).toBeGreaterThan(base.terrainFormationSeaLevel);
    expect(taller.params.seaLevel).toBeGreaterThan(base.seaLevel);
    expect(taller.params.cloudAltitude).toBeGreaterThan(base.cloudAltitude);
  });
});

describe('Mini composition height field (CPU twin)', () => {
  it('passes the stack through untouched when Mini is off', () => {
    const u = createTerrainUniforms();
    expect(miniComposeCPU(u, 10, 20, 0.37)).toBe(0.37);
  });

  it('cove: sheltered water in the bowl and at the front, cliffs behind', () => {
    const state = createMiniTerrainState({ recipe: 'cove', seed: 1 });
    const { u, L } = uniformsFor(state);
    const sea01 = L.formationSea / L.heightScale;
    const h = (lat, front) => miniComposeCPU(u, ...worldAt(state, lat, front), 0.25);
    expect(h(0, 0)).toBeLessThan(sea01);          // bowl
    expect(h(0, 0.85)).toBeLessThan(sea01);       // open sea toward the camera
    expect(h(0, -0.75)).toBeGreaterThan(sea01 + 0.25); // cliffs behind
    expect(h(-0.7, -0.1)).toBeGreaterThan(sea01 + 0.2); // horseshoe arm
  });

  it('islet: land in the middle, water at the corners', () => {
    const state = createMiniTerrainState({ recipe: 'islet', seed: 3 });
    const { u, L } = uniformsFor(state);
    const sea01 = L.formationSea / L.heightScale;
    expect(miniComposeCPU(u, ...worldAt(state, 0, 0), 0.25)).toBeGreaterThan(sea01 + 0.2);
    for (const [x, z] of [[-0.95, -0.95], [0.95, 0.95], [-0.95, 0.95], [0.95, -0.95]]) {
      expect(miniComposeCPU(u, x * L.half, z * L.half, 0.25)).toBeLessThan(sea01);
    }
  });

  it('lake: a basin below the water line framed by land', () => {
    const state = createMiniTerrainState({ recipe: 'lake', seed: 5 });
    const { u, L } = uniformsFor(state);
    const sea01 = L.formationSea / L.heightScale;
    expect(miniComposeCPU(u, ...worldAt(state, 0, 0), 0.25)).toBeLessThan(sea01);
    expect(miniComposeCPU(u, ...worldAt(state, 0, -0.85), 0.25)).toBeGreaterThan(sea01 + 0.3);
  });

  it('is deterministic and continuous across the footprint', () => {
    const state = createMiniTerrainState({ recipe: 'cove', seed: 99 });
    const { u, L } = uniformsFor(state);
    let maxStep = 0;
    let prev = miniComposeCPU(u, -L.half, 0, 0.25);
    for (let i = 1; i <= 512; i++) {
      const x = -L.half + (i / 512) * L.width;
      const v = miniComposeCPU(u, x, 0, 0.25);
      maxStep = Math.max(maxStep, Math.abs(v - prev));
      prev = v;
    }
    // ~2 units per step: a steep cliff, never a discontinuity
    expect(maxStep).toBeLessThan(0.08);
    expect(miniComposeCPU(u, 12.5, -40, 0.3)).toBe(miniComposeCPU(u, 12.5, -40, 0.3));
  });
});

describe('Mini shader integration', () => {
  it('declares the Mini uniforms once and composes after the shared finalizer', () => {
    expect(COMMON_UNIFORMS_GLSL.match(/uniform float uMiniShape;/g)).toHaveLength(1);
    const src = buildHeightGLSL('');
    expect(src).toContain('float miniCompose(vec2 xz, float stackH01)');
    expect(src).toContain('if (uInfiniteMode < 0.5 && uMiniShape > 0.5) finalH01 = miniCompose(xz, finalH01);');
    expect(MINI_COMPOSITION_GLSL).not.toMatch(/\bfor\s*\(|\bwhile\s*\(|\bbreak;/);
  });

  it('defaults the shared uniforms to "Mini off"', () => {
    const u = createTerrainUniforms();
    expect(u.uMiniShape.value).toBe(0);
    expect(u.uMiniCut.value).toBe(0);
  });
});

describe('Mini water cut and underwater volume', () => {
  it('builds four outward-facing faces from the base to the water level', () => {
    const geo = buildMiniWaterCutGeometry(512, -70, 80, 0.5);
    const pos = geo.getAttribute('position');
    const nor = geo.getAttribute('normal');
    const idx = geo.index;
    expect(idx.count).toBe(24);
    const a = new THREE.Vector3(); const b = new THREE.Vector3(); const c = new THREE.Vector3();
    for (let t = 0; t < idx.count; t += 3) {
      a.fromBufferAttribute(pos, idx.getX(t));
      b.fromBufferAttribute(pos, idx.getX(t + 1));
      c.fromBufferAttribute(pos, idx.getX(t + 2));
      const n = new THREE.Vector3().subVectors(b, a).cross(new THREE.Vector3().subVectors(c, a)).normalize();
      const expected = new THREE.Vector3().fromBufferAttribute(nor, idx.getX(t));
      expect(n.dot(expected)).toBeGreaterThan(0.99);
    }
    let minY = Infinity; let maxY = -Infinity; let maxXZ = 0;
    for (let i = 0; i < pos.count; i++) {
      minY = Math.min(minY, pos.getY(i));
      maxY = Math.max(maxY, pos.getY(i));
      maxXZ = Math.max(maxXZ, Math.abs(pos.getX(i)), Math.abs(pos.getZ(i)));
    }
    expect(minY).toBe(-70);
    expect(maxY).toBe(80);
    expect(maxXZ).toBeLessThan(512);   // inset: the opaque section wall stays in front
  });

  it('never treats a camera outside the footprint as underwater', () => {
    const ctrl = new UnderwaterController();
    const volume = { minX: -512, maxX: 512, minZ: -512, maxZ: 512, floorY: -70 };
    const base = { worldMode: 'studio', seaLevel: 70, waterActive: true, quality: 'high' };
    ctrl.update(1, { ...base, cameraPos: new THREE.Vector3(900, 20, 0), volume });
    expect(ctrl.isUnderwater).toBe(false);
    expect(ctrl.underwaterBlend).toBe(0);
    ctrl.update(1, { ...base, cameraPos: new THREE.Vector3(0, 20, 0), volume });
    expect(ctrl.isUnderwater).toBe(true);
    // without a volume the legacy flat test is unchanged
    const legacy = new UnderwaterController();
    legacy.update(1, { ...base, cameraPos: new THREE.Vector3(900, 20, 0) });
    expect(legacy.isUnderwater).toBe(true);
  });

  it('frames the whole footprint from a three-quarter view', () => {
    const state = createMiniTerrainState({ recipe: 'islet', seed: 8 });
    const f = resolveMiniFraming(state, { fov: 45, aspect: 16 / 9 });
    const L = resolveMiniLayout(state);
    expect(f.radius).toBeGreaterThan(L.width);
    expect(f.radius).toBeLessThan(f.maxRadius);
    expect(f.minRadius).toBeLessThan(f.radius);
    expect(f.phi).toBeGreaterThan(Math.PI / 4);
    expect(f.phi).toBeLessThan(Math.PI / 2);
  });
});

describe('Mini Terrain keeps a single footprint', () => {
  it('refuses every tile growth path and collapses restored tiles', async () => {
    const { Engine } = await import('../src/engine/Engine.js');
    const P = Engine.prototype;
    const ghost = { visible: true };
    const fake = {
      mini: { state: { recipe: 'cove' } },
      worldMode: 'studio',
      _landingShowcase: false,
      exploreMode: 'none',
      tileAssemblyShape: 'square',
      circleRadiusCells: 0,
      diskRadiusCells: 0,
      tileGridExtent: 2,
      tiles: [{ cx: 0, cz: 0 }, { cx: 1, cz: 0 }],
      _tileGhost: ghost,
      _rebuildTiles() { throw new Error('tiles must not be rebuilt in Mini'); },
    };
    for (const name of ['_miniLocksTiles', '_enforceMiniSingleTile', '_hasTile', '_inTilePlacementBounds', 'canAddTileAt', 'canExpandCircle']) {
      if (P[name]) fake[name] = P[name];
    }
    expect(P.canAddTileAt.call(fake, 0, 1)).toBe(false);
    expect(P.addTile.call(fake, 0, 1)).toBe(false);
    expect(P.canExpandCircle.call(fake)).toBe(false);
    expect(P.removeTile.call(fake, 1, 0)).toBe(false);
    expect(P._tileInteractionActive.call(fake)).toBe(false);
    P.setTileAssemblyShape.call(fake, 'circle');
    expect(fake.tileAssemblyShape).toBe('square');
    expect(P._enforceMiniSingleTile.call(fake)).toBe(true);
    expect(fake.tiles).toEqual([{ cx: 0, cz: 0 }]);
    expect(ghost.visible).toBe(false);
  }, 30000);   // importing the full engine module can be slow under a parallel run
});

describe('Mini clouds', () => {
  it('centres the cloud slab and matches the terrain width by default', async () => {
    const { resolveMiniCloudLayout } = await import('../src/engine/mini/MiniTerrainSettings.js');
    for (const recipe of MINI_RECIPE_IDS) {
      const state = createMiniTerrainState({ recipe, seed: 99 });
      const L = resolveMiniLayout(state);
      const c = resolveMiniCloudLayout(state);
      expect(c.center).toEqual({ x: 0, z: 0 });
      expect(c.radius).toBe(L.half);
    }
  });
});

describe('Mini light map live height grid', () => {
  it('maps grid texel centres exactly onto the surface vertices', () => {
    const state = createMiniTerrainState({ recipe: 'procedural', seed: 5 });
    const L = resolveMiniLayout(state);
    // a shared bake rectangle that does not match the footprint
    const origin = new THREE.Vector2(-L.half * 1.3, -L.half * 0.9);
    const span = new THREE.Vector2(L.half * 2.7, L.half * 2.2);
    const ctrl = new MiniTerrainController({
      worldMode: 'studio',
      uniforms: { uBakeOrigin: { value: origin }, uBakeSpan: { value: span } },
    });
    const t = ctrl._gridTransform(L);
    const n = L.segments + 1;
    const step = (2 * L.half) / L.segments;
    for (const i of [0, 1, L.segments >> 1, L.segments]) {
      // TerrainHeightBaker: bakeUv = t.xy + vUv * t.zw ; xz = origin + bakeUv * span
      const vUv = (i + 0.5) / n;
      const x = origin.x + (t.x + vUv * t.z) * span.x;
      const z = origin.y + (t.y + vUv * t.w) * span.y;
      expect(x).toBeCloseTo(-L.half + i * step, 6);
      expect(z).toBeCloseTo(-L.half + i * step, 6);
    }
  });
});

describe('Mini export', () => {
  const half = 100;
  const res = 8;
  const sea = 10;
  // land rises along +x: x < 0 is under water, x > 0 is dry
  const at = (i) => -20 + (i / res) * 60;

  it('exports the water as a block limited to the real water column', async () => {
    const { buildMiniWaterVolume } = await import('../src/engine/mini/MiniExport.js');
    const geo = buildMiniWaterVolume({ at: (i) => at(i), res, half, seaLevel: sea, baseY: -30 });
    const pos = geo.getAttribute('position');
    const index = geo.getIndex().array;
    let maxY = -Infinity;
    let minY = Infinity;
    for (const v of index) {
      maxY = Math.max(maxY, pos.getY(v));
      minY = Math.min(minY, pos.getY(v));
      // no face beyond the footprint
      expect(Math.abs(pos.getX(v))).toBeLessThanOrEqual(half + 1e-6);
      expect(Math.abs(pos.getZ(v))).toBeLessThanOrEqual(half + 1e-6);
    }
    expect(maxY).toBeCloseTo(sea, 6);
    expect(minY).toBeCloseTo(at(0), 6);   // deepest rim, above the base
    // the dry +x face contributes nothing
    for (let t = 0; t < index.length; t += 3) {
      const tri = [index[t], index[t + 1], index[t + 2]];
      if (tri.every((v) => Math.abs(pos.getX(v) - half) < 1e-6)) throw new Error('water face on the dry side');
    }
    // every face points out of the block (or up for the surface)
    const nrm = geo.getAttribute('normal');
    for (let t = 0; t < index.length; t += 3) {
      const [a, b, c] = [index[t], index[t + 1], index[t + 2]].map((v) => new THREE.Vector3().fromBufferAttribute(pos, v));
      const n = new THREE.Vector3().crossVectors(b.clone().sub(a), c.clone().sub(a));
      if (n.lengthSq() < 1e-12) continue;
      expect(n.dot(new THREE.Vector3().fromBufferAttribute(nrm, index[t]))).toBeGreaterThan(0);
    }
  });

  it('bakes the section strata as vertex colours down to the section base', async () => {
    const { buildMiniSectionWalls, miniCutAlbedoCPU } = await import('../src/engine/mini/MiniExport.js');
    const cut = {
      topsoil: [0.1, 0.05, 0.02], bandA: [0.4, 0.3, 0.2], bandB: [0.3, 0.2, 0.1],
      deep: [0.08, 0.07, 0.06], sediment: [0.6, 0.5, 0.3], bands: 9, topsoilDepth: 6, reliefHeight: 300,
    };
    const geo = buildMiniSectionWalls({ at: (i) => at(i), res, half, baseY: -40, seaLevel: sea, cut, rows: 10 });
    const pos = geo.getAttribute('position');
    const col = geo.getAttribute('color');
    expect(col.count).toBe(pos.count);
    let minY = Infinity;
    for (let v = 0; v < pos.count; v++) {
      minY = Math.min(minY, pos.getY(v));
      for (let c = 0; c < 3; c++) expect(Number.isFinite(col.array[v * 3 + c])).toBe(true);
    }
    expect(minY).toBeCloseTo(-40, 6);
    // topsoil right under a dry rim, sediment right under a submerged one
    const dry = miniCutAlbedoCPU(0, 39.5, 40, sea, { ...cut, baseY: -40 });
    const wet = miniCutAlbedoCPU(0, -20.5, -20, sea, { ...cut, baseY: -40 });
    expect(dry[0]).toBeLessThan(0.15);
    expect(wet[0]).toBeGreaterThan(0.45);
  });
});

describe('Stylized water mode', () => {
  it('is available on Tile and Infinite World and falls back to Legacy on Planet', async () => {
    const { WATER_MODES, resolveEffectiveWaterMode } = await import('../src/engine/water/WaterSettings.js');
    expect(WATER_MODES.some((m) => m.value === 'stylized')).toBe(true);
    const params = { waterMode: 'stylized', waterEnabled: true, seaLevel: 40, waterAutoDowngradeInfinite: true };
    expect(resolveEffectiveWaterMode(params, 'studio')).toBe('stylized');
    expect(resolveEffectiveWaterMode(params, 'infinite')).toBe('stylized');
    expect(resolveEffectiveWaterMode(params, 'planet')).toBe('legacy');
  });
});
