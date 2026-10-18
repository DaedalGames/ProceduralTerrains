import * as THREE from 'three';
import { FiniteTerrain } from '../FiniteTerrain.js';
import { InfiniteWorld } from '../../engine/terrain/InfiniteWorld.js';
import { InfiniteTerrainClipmap } from '../../engine/terrain/InfiniteTerrainClipmap.js';
import { createInfiniteTerrainMaterial } from '../../engine/terrain/TerrainMaterial.js';
import { createInfiniteWaterMaterial } from '../../engine/terrain/WaterMaterial.js';
import { compileMaterial } from '../resources/CompileMaterial.js';
import { withRendererState } from '../resources/RendererState.js';

function validate(l) {
  for (const [name, min, max] of [
    ['viewRadius', 2, 32],
    ['triangleBudget', 0, 20000000],
    ['maxCreatesPerFrame', 1, 1024],
    ['streamBudgetMs', 0.1, 20],
    ['cacheResolution', 64, 1024],
  ]) {
    if (!Number.isFinite(l[name]) || l[name] < min || l[name] > max)
      throw new RangeError(`layout.${name} must be ${min}..${max}`);
  }
  for (const key of ['viewRadius', 'maxCreatesPerFrame', 'cacheResolution'])
    if (!Number.isInteger(l[key])) throw new TypeError(`layout.${key} must be an integer`);
}

export const infiniteAdapter = {
  mode: 'infinite',
  layoutDefaults: {
    viewRadius: 8,
    triangleBudget: 1000000,
    maxCreatesPerFrame: 16,
    streamBudgetMs: 1.5,
    cacheResolution: 256,
  },
  validateLayout: validate,
  createMaterial: (t, octaves, program) =>
    createInfiniteTerrainMaterial(t._uniforms, octaves, program, {
      variant: t._surface ? 'surface' : 'base',
    }),
  createRuntime(t) {
    return {
      world: null,
      cache: null,
      key: '',
      get group() {
        return this.world.group;
      },
      update(camera) {
        this.world.update(camera.position, camera);
        this.world.waterPlane.visible = false;
      },
      diagnostics() {
        const w = this.world;
        return {
          chunks: w.chunks.size,
          visible: w.visibleChunkCount,
          culled: w.culledChunkCount,
          lodCounts: [...w.lodCounts],
          cache: this.cache.diagnostics(),
        };
      },
      dispose() {
        this.world?.dispose();
        this.cache?.dispose();
        this.waterMaterial?.dispose();
      },
    };
  },
  apply(t, c) {
    const r = t._runtime,
      l = c.layout,
      u = t._uniforms;
    const key = JSON.stringify([l.chunkSize, l.viewRadius, l.cacheResolution]);
    if (r.key !== key) {
      r.dispose();
      r.key = key;
      r.waterMaterial = createInfiniteWaterMaterial(u, c.source.octaves, t._stackGLSL);
      r.world = new InfiniteWorld(t.object, t._material, r.waterMaterial, {
        chunkSize: l.chunkSize,
        viewRadius: l.viewRadius,
        maxHeight: c.heightScale * 1.35 + 2,
        skirtDepth: Math.max(24, c.heightScale * 0.08),
        seaLevel: 0,
        lodSegments: c.quality.lodSegments,
      });
      r.world.waterPlane.visible = false;
      r.cache = new InfiniteTerrainClipmap({
        renderer: t._renderer,
        uniforms: u,
        chunkSize: l.chunkSize,
        viewRadius: l.viewRadius,
        octaves: c.source.octaves,
        stackGLSL: t._stackGLSL,
        resolutions: [l.cacheResolution, l.cacheResolution, l.cacheResolution],
        requirePrepared: true,
      });
    }
    r.world.setMaxCreatesPerFrame(l.maxCreatesPerFrame);
    r.world.setChunkStreamBudget(l.streamBudgetMs);
    r.world.setTriangleBudget(l.triangleBudget);
    r.world.setLodMultiplier(c.quality.lodDistanceScale);
    r.world.setViewRadius(l.viewRadius);
    r.world.setLodSegments(c.quality.lodSegments);
    r.world.setMorphEnabled(c.quality.morphEnabled);
    r.world.setMergeOptions({ enabled: c.quality.mergeEnabled });
    r.world.cullingEnabled = c.quality.cullingEnabled;
    r.world.updateSettings({
      maxHeight: c.heightScale * 1.35 + 2,
      skirtDepth: Math.max(24, c.heightScale * 0.08),
      seaLevel: c.seaLevel,
    });
    u.uUseInfiniteFieldCache.value = 1;
  },
  async prepare(t, camera, signal, check = () => t._assertAlive()) {
    const cache = t._runtime.cache;
    const h = cache.prepareProgram(t.configuration.source.octaves, t._stackGLSL);
    try {
      for (const p of h.passes ?? [{ material: h.material ?? cache.material }])
        await compileMaterial(t._renderer, p.material, p.camera ?? camera, {
          geometry: p.mesh?.geometry.clone(),
        });
      signal?.throwIfAborted();
      check();
      cache.publishPrepared(h);
    } catch (e) {
      cache.discardPrepared(h);
      throw e;
    }
    withRendererState(t._renderer, () => {
      for (let i = 0; i < 3; i++) cache.update(t._cameraPosition, t._revision);
    });
  },
  async sourceChanged(t, source, { signal, check, sourceChanged }) {
    if (sourceChanged)
      await this.prepare(t, t._viewCamera ?? new THREE.PerspectiveCamera(), signal, check);
    t._runtime.world.terrainMaterial = t._material;
    t._runtime.world.merge.material = t._material;
    t._runtime.world.batches.material = t._material;
  },
  update(t) {
    withRendererState(t._renderer, () => t._runtime.cache.update(t._cameraPosition, t._revision));
  },
  createProbe(t, material) {
    const geometry = t._runtime.world.batches.meshes[0].geometry.clone();
    const mesh = new THREE.InstancedMesh(geometry, material, 1);
    return { geometry, mesh };
  },
};

export async function createInfiniteTerrain(options) {
  return new FiniteTerrain({ ...options, _world: infiniteAdapter });
}
