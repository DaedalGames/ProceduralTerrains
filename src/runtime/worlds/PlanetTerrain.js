import * as THREE from 'three';
import { FiniteTerrain } from '../FiniteTerrain.js';
import { PlanetWorld } from '../../engine/terrain/PlanetWorld.js';
import { PlanetHeightSampler } from '../../engine/terrain/PlanetHeightSampler.js';
import { PlanetHeightBaker } from '../../engine/terrain/PlanetHeightBaker.js';
import { createPlanetMaterial } from '../../engine/terrain/PlanetMaterial.js';
import { compileMaterial } from '../resources/CompileMaterial.js';
import { withRendererState } from '../resources/RendererState.js';

export const planetAdapter = {
  mode: 'planet',
  layoutDefaults: { radius: 16000, faceGrid: 8, triangleBudget: 1000000, bakeResolution: 256 },
  validateLayout(l) {
    for (const [key, min, max] of [
      ['radius', 10, 1e8],
      ['faceGrid', 1, 32],
      ['triangleBudget', 0, 2e7],
      ['bakeResolution', 16, 2048],
    ])
      if (!Number.isFinite(l[key]) || l[key] < min || l[key] > max)
        throw new RangeError(`Invalid layout.${key}`);
    if (!Number.isInteger(l.faceGrid) || !Number.isInteger(l.bakeResolution))
      throw new TypeError('Planet grid and bake resolution must be integers');
  },
  createMaterial: (t, oct, program) => createPlanetMaterial(t._uniforms, oct, program),
  createRuntime(t) {
    return {
      world: null,
      baker: null,
      key: '',
      sampler: new PlanetHeightSampler(
        t._uniforms,
        () => ({ octaves: t.configuration.source.octaves, radius: t.configuration.layout.radius }),
        t._stack,
      ),
      get group() {
        return this.world.group;
      },
      update(camera) {
        this.world.update(camera.position, camera);
      },
      diagnostics() {
        return {
          chunks: this.world.chunks.length,
          visible: this.world.visibleChunkCount,
          culled: this.world.culledChunkCount,
          lodCounts: [...this.world.lodCounts],
          bakeReady: this.baker.ready,
        };
      },
      dispose() {
        if (this.world) {
          this.world.materials = [];
          this.world.dispose();
        }
        this.baker?.dispose();
      },
    };
  },
  apply(t, c) {
    const r = t._runtime,
      l = c.layout,
      u = t._uniforms,
      key = JSON.stringify([l.radius, l.faceGrid, l.bakeResolution, c.quality.lodSegments]);
    u.uPlanetRadius.value = l.radius;
    u.uPlanetEps.value = 2 / (l.faceGrid * 64);
    u.uSkirtDepth.value = Math.max(24, c.heightScale * 0.08) * 3;
    u.uFogDensity.value = 0;
    if (r.key !== key) {
      r.dispose();
      r.key = key;
      r.world = new PlanetWorld(t.object, () => t._material, {
        radius: l.radius,
        faceGrid: l.faceGrid,
        maxHeight: c.heightScale * 1.35 + 2,
        skirtDepth: u.uSkirtDepth.value,
        lodSegments: c.quality.lodSegments,
      });
      r.baseLodDistances = [...r.world._baseLodThresholds];
      r.baker = new PlanetHeightBaker({
        renderer: t._renderer,
        uniforms: u,
        size: l.bakeResolution,
        previewSize: l.bakeResolution,
        climateSize: Math.min(128, l.bakeResolution),
        requirePrepared: true,
      });
    }
    r.world.setTriangleBudget(l.triangleBudget);
    r.world.setLodDistances(r.baseLodDistances.map((d) => d * c.quality.lodDistanceScale));
    r.world.setMorphEnabled(c.quality.morphEnabled);
    r.world.setMergeOptions({ enabled: c.quality.mergeEnabled });
    r.world.cullingEnabled = c.quality.cullingEnabled;
    r.world.maxHeight = c.heightScale * 1.35 + 2;
    r.world.skirtDepth = u.uSkirtDepth.value;
  },
  async prepare(t, camera, signal, check = () => t._assertAlive()) {
    const b = t._runtime.baker,
      h = b.prepareProgram(t.configuration.source.octaves, t._stackGLSL);
    try {
      for (const pass of h.passes)
        await compileMaterial(t._renderer, pass.material, pass.camera ?? camera, {
          geometry: pass.mesh?.geometry.clone() ?? new THREE.BoxGeometry(2, 2, 2),
        });
      signal?.throwIfAborted();
      check();
      b.publishPrepared(h);
    } catch (e) {
      b.discardPrepared(h);
      throw e;
    }
    b.begin(t.configuration.source.octaves, t._stackGLSL);
    withRendererState(t._renderer, () => {
      while (!b.complete) b.step();
    });
    t._uniforms.uPlanetHeightTex.value = b.texture;
    t._uniforms.uUsePlanetHeightTex.value = 1;
    t._uniforms.uPlanetClimateTex.value = b.climateTexture;
    t._uniforms.uUsePlanetClimateTex.value = 1;
  },
  async sourceChanged(t, source, { signal, check, sourceChanged }) {
    t._runtime.sampler.setStack(t._stack);
    t._runtime.world.materials = t._runtime.world.materials.map(() => t._material);
    for (const b of t._runtime.world.batches) b.material = t._material;
    if (sourceChanged)
      await this.prepare(t, t._viewCamera ?? new THREE.PerspectiveCamera(), signal, check);
  },
  sample: (t, x, y, z) => t._runtime.sampler.heightAt3D(x, y, z),
  createProbe(t, material) {
    const geometry = t._runtime.world.batches[0].geometry.clone();
    return { geometry, mesh: new THREE.InstancedMesh(geometry, material, 1) };
  },
};

export async function createPlanetTerrain(options) {
  return new FiniteTerrain({ ...options, _world: planetAdapter });
}
