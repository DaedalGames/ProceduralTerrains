import * as THREE from 'three';
import { createTerrainMaterial, createTerrainUniforms } from '../engine/terrain/TerrainMaterial.js';
import { TerrainHeightSampler } from '../engine/terrain/TerrainHeightSampler.js';
import { buildChunkGeometry } from '../engine/terrain/ChunkGeometry.js';
import { defaultLegacyStack } from '../engine/terrain/noise/NoiseStack.js';
import { generateStackGLSL, packStackUniforms } from '../engine/terrain/noise/noiseStackCodegen.js';
import { applyPlanetStyleToUniforms } from '../engine/style/PaletteUniforms.js';
import { validatePrograms, programHealthError } from '../engine/render/ProgramHealthGate.js';
import { FiniteTerrainRuntime } from './FiniteTerrainRuntime.js';
import { applyTerrainShapeUniforms, applyTerrainShadingUniforms } from './TerrainParameters.js';
import { normalizeConfiguration, configurationParameters } from './FiniteTerrainConfiguration.js';

const error = (code, message) => Object.assign(new Error(message), { code });
const checkSignal = signal => { if (signal?.aborted) throw error('TERRAIN_CANCELLED', 'Terrain operation cancelled'); };

/** Browser WebGL2 runtime. Importing this module has no browser side effects. */
export class FiniteTerrain {
  constructor({ renderer, configuration = {}, signal } = {}) {
    checkSignal(signal);
    if (!renderer?.isWebGLRenderer) throw new TypeError('A caller-owned THREE.WebGLRenderer is required');
    this._configuration = normalizeConfiguration(configuration);
    this._requestedConfiguration = this._configuration;
    this._renderer = renderer;
    this._disposed = false;
    this._revision = 0;
    this._jobs = new Set();
    this._cameraPosition = new THREE.Vector3();
    this._viewCamera = null;
    this._worldCamera = null;
    this._viewport = new THREE.Vector4();
    this._prepared = false;
    this._fallback = new THREE.DataTexture(new Uint8Array([128, 128, 128, 255]), 1, 1);
    this._fallback.needsUpdate = true;
    this._uniforms = createTerrainUniforms({ surfaceFallback: this._fallback });
    this._ownedTextures = new Set(Object.values(this._uniforms).map(u => u.value).filter(v => v?.isTexture));
    this._stack = defaultLegacyStack();
    this._stackGLSL = generateStackGLSL(this._stack);
    const packed = packStackUniforms(this._stack);
    for (let i = 0; i < packed.strength.length; i++) this._uniforms.uLayerStrength.value[i] = packed.strength[i];
    this._material = this._makeMaterial(this._configuration.source.octaves);
    this.object = new THREE.Group();
    this.object.name = 'procedural-terrain';
    this._runtime = new FiniteTerrainRuntime(this.object, this._material);
    this._sampler = new TerrainHeightSampler(this._uniforms, () => ({
      octaves: this._configuration.source.octaves, infinite: false,
    }), this._stack);
    this._apply(this._configuration);
  }

  get configuration() { return this._configuration; }

  _assertAlive() {
    if (this._disposed) throw error('TERRAIN_DISPOSED', 'Terrain has been disposed');
  }

  _assertIdentity() {
    this.object.updateWorldMatrix(true, false);
    const e = this.object.matrixWorld.elements;
    if (e.some((v, i) => Math.abs(v - (i % 5 === 0 ? 1 : 0)) > 1e-8)) {
      throw error('TERRAIN_TRANSFORM_UNSUPPORTED', 'Finite terrains require an identity world transform in this release');
    }
  }

  _makeMaterial(octaves) {
    const material = createTerrainMaterial(this._uniforms, octaves, this._stackGLSL, { variant: 'base', worldMode: 'studio' });
    // The existing shader writes display-encoded colour itself. Do not apply
    // host tone mapping to it a second time.
    material.toneMapped = false;
    return material;
  }

  _apply(c) {
    const p = configurationParameters(c);
    const size = p.chunkCount * p.chunkSize;
    const skirtDepth = Math.max(24, p.heightScale * 0.08);
    applyTerrainShapeUniforms(this._uniforms, p, size);
    applyTerrainShadingUniforms(this._uniforms, p, {
      size, skirtDepth, wallThickness: Math.max(10, size * 0.006),
    });
    this._uniforms.uTerrainDetailQuality.value = 0;
    this._uniforms.uBakeOrigin.value.set(-size / 2, -size / 2);
    this._uniforms.uBakeSpan.value.set(size, size);
    const az = THREE.MathUtils.degToRad(p.sunAzimuth);
    const el = THREE.MathUtils.degToRad(p.sunElevation);
    this._uniforms.uSunDir.value.set(Math.cos(el) * Math.sin(az), Math.sin(el), Math.cos(el) * Math.cos(az));
    this._uniforms.uFogDensity.value = p.fogDensity * 0.0001;
    applyPlanetStyleToUniforms(this._uniforms, { palette: c.palette });
    const b = this._runtime.board;
    b.syncCells({ chunkCount: p.chunkCount, chunkSize: p.chunkSize,
      maxHeight: p.heightScale * 1.35 + 2, skirtDepth,
      lodSegments: c.quality.lodSegments, cells: [{ cx: 0, cz: 0 }], progressive: false });
    // Public configuration commits are complete; the studio retains its own
    // progressive geometry cadence through the same TerrainBoard implementation.
    while (b._lodRebuildQueue.length) b.updateLOD(this._cameraPosition);
    b.setMorphEnabled(c.quality.morphEnabled);
    b.setLodDistanceScale(c.quality.lodDistanceScale);
    b.setMergeOptions({ enabled: c.quality.mergeEnabled });
    b.cullingEnabled = c.quality.cullingEnabled;
  }

  _cancelJobs(code, message) {
    for (const job of this._jobs) job.cancel(error(code, message));
  }

  // Cancels the public operation immediately. Driver compilation cannot be
  // interrupted; its candidate resources are retired once it actually settles.
  _operation(task, signal) {
    checkSignal(signal);
    let cancel;
    const cancelled = new Promise((_, reject) => { cancel = reject; });
    const job = { cancel };
    const onAbort = () => cancel(error('TERRAIN_CANCELLED', 'Terrain operation cancelled'));
    signal?.addEventListener('abort', onAbort, { once: true });
    this._jobs.add(job);
    const work = Promise.resolve().then(task);
    return Promise.race([work, cancelled]).finally(() => {
      signal?.removeEventListener('abort', onAbort);
      this._jobs.delete(job);
    });
  }

  async _compile(material, camera) {
    const geometry = buildChunkGeometry(2, 0, { morph: true });
    const scene = new THREE.Scene();
    scene.add(new THREE.Mesh(geometry, material));
    try {
      await this._renderer.compileAsync(scene, camera);
      const health = await validatePrograms({ renderer: this._renderer, materials: [material] });
      if (!health.ok) throw programHealthError(health);
    } finally {
      geometry.dispose();
    }
  }

  async prepare(camera, { signal } = {}) {
    this._assertAlive();
    this._assertIdentity();
    if (!camera?.isCamera) throw new TypeError('A THREE.Camera is required');
    this._viewCamera = camera;
    checkSignal(signal);
    const revision = this._revision;
    await this._operation(async () => {
      await this._compile(this._material, camera);
      this._assertAlive();
      checkSignal(signal);
      if (revision !== this._revision) throw error('TERRAIN_SUPERSEDED', 'Terrain preparation superseded');
      this._prepared = true;
    }, signal);
  }

  async configure(patch, { signal } = {}) {
    this._assertAlive();
    checkSignal(signal);
    const next = normalizeConfiguration(patch, this._requestedConfiguration);
    this._cancelJobs('TERRAIN_SUPERSEDED', 'Terrain configuration superseded');
    const revision = ++this._revision;
    this._requestedConfiguration = next;
    const changedProgram = next.source.octaves !== this._configuration.source.octaves;
    const candidate = changedProgram ? this._makeMaterial(next.source.octaves) : null;
    let published = false;
    try {
      await this._operation(async () => {
        try {
          if (candidate) await this._compile(candidate, this._viewCamera || new THREE.PerspectiveCamera());
          this._assertAlive();
          checkSignal(signal);
          if (revision !== this._revision) throw error('TERRAIN_SUPERSEDED', 'Terrain configuration superseded');
          this._assertIdentity();
          this._apply(next);
          if (candidate) {
            const old = this._material;
            this._runtime.board.material = this._material = candidate;
            this._runtime.board.group.traverse(o => { if (o.isMesh && o.material === old) o.material = candidate; });
            old.dispose();
          }
          this._configuration = next;
          published = true;
          if (candidate) this._prepared = true;
        } finally {
          if (candidate && !published) candidate.dispose();
        }
      }, signal);
    } catch (err) {
      if (revision === this._revision) this._requestedConfiguration = this._configuration;
      throw err;
    }
  }

  update(deltaSeconds, { camera } = {}) {
    this._assertAlive();
    this._assertIdentity();
    if (!Number.isFinite(deltaSeconds) || deltaSeconds < 0) throw new RangeError('deltaSeconds must be nonnegative');
    if (!camera?.isCamera) throw new TypeError('A THREE.Camera is required');
    this._viewCamera = camera;
    camera.updateWorldMatrix(true, false);
    camera.getWorldPosition(this._cameraPosition);
    // TerrainBoard consumes world camera coordinates. For a parented camera,
    // a detached view camera preserves its projection without changing the host.
    let view = camera;
    if (camera.parent) {
      if (!this._worldCamera || this._worldCamera.type !== camera.type) this._worldCamera = camera.clone(false);
      view = this._worldCamera;
      view.projectionMatrix.copy(camera.projectionMatrix);
      view.projectionMatrixInverse.copy(camera.projectionMatrixInverse);
      camera.matrixWorld.decompose(view.position, view.quaternion, view.scale);
      view.updateMatrix();
      view.updateMatrixWorld(true);
    }
    this._uniforms.uTime.value += Math.min(deltaSeconds, 0.1);
    this._runtime.update(view);
    const viewport = this._renderer.getCurrentViewport(this._viewport);
    this._uniforms.uPixelWorldPerDist.value = camera.isPerspectiveCamera
      ? 2 * Math.tan(THREE.MathUtils.degToRad(camera.fov) * 0.5) / (Math.max(camera.zoom, 1e-6) * Math.max(1, viewport.w)) : 0;
  }

  sampleHeight(x, z) {
    this._assertAlive();
    this._assertIdentity();
    if (!Number.isFinite(x) || !Number.isFinite(z)) throw new TypeError('Coordinates must be finite');
    const half = this._configuration.layout.chunkCount * this._configuration.layout.chunkSize / 2;
    return Math.abs(x) > half || Math.abs(z) > half ? null : this._sampler.heightAt(x, z);
  }

  serialize() {
    this._assertAlive();
    return { format: 'procedural-terrains', schemaVersion: 1, kind: 'finite', configuration: JSON.parse(JSON.stringify(this._configuration)) };
  }

  getDiagnostics() {
    const b = this._runtime.board;
    return { disposed: this._disposed, prepared: this._prepared, revision: this._revision,
      chunks: b.activeChunkCount, visible: b.visibleChunkCount, culled: b.culledChunkCount,
      lodCounts: [...b.lodCounts], mergedGroups: b.mergedGroupCount, savedDrawCalls: b.savedDrawCalls };
  }

  dispose() {
    if (this._disposed) return;
    this._disposed = true;
    ++this._revision;
    this._cancelJobs('TERRAIN_DISPOSED', 'Terrain has been disposed');
    this._runtime.dispose();
    this.object.removeFromParent();
    this._material.dispose();
    for (const texture of this._ownedTextures) texture.dispose();
    this._ownedTextures.clear();
    this._viewCamera = null;
    this._worldCamera = null;
  }
}

export async function createTerrain(options) {
  return new FiniteTerrain(options);
}
