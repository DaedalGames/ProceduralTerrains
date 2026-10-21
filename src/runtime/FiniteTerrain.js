import { applyTerrainDetailUniforms, applyTerrainVisualUniforms } from './TerrainAppearance.js';
import { DetailPageCache } from '../engine/terrain/detail/DetailPageCache.js';
import * as THREE from 'three';
import { createTerrainMaterial, createTerrainUniforms } from '../engine/terrain/TerrainMaterial.js';
import { TerrainHeightSampler } from '../engine/terrain/TerrainHeightSampler.js';
import { buildChunkGeometry } from '../engine/terrain/ChunkGeometry.js';
import { applyPlanetStyleToUniforms } from '../engine/style/PaletteUniforms.js';
import { validatePrograms, programHealthError } from '../engine/render/ProgramHealthGate.js';
import { TerrainSource } from './TerrainSources.js';
import { resolveSurfaceReference } from '../engine/terrain/surface/SurfaceDocument.js';
import { FiniteTerrainRuntime } from './FiniteTerrainRuntime.js';
import { applyTerrainShapeUniforms, applyTerrainShadingUniforms } from './TerrainParameters.js';
import { normalizeConfiguration, configurationParameters } from './FiniteTerrainConfiguration.js';

const error = (code, message) => Object.assign(new Error(message), { code });
const checkSignal = (signal) => {
  if (signal?.aborted) throw error('TERRAIN_CANCELLED', 'Terrain operation cancelled');
};

/** Browser WebGL2 runtime. Importing this module has no browser side effects. */
export class FiniteTerrain {
  constructor({ renderer, configuration = {}, signal, resources, _world = {} } = {}) {
    checkSignal(signal);
    if (!renderer?.isWebGLRenderer)
      throw new TypeError('A caller-owned THREE.WebGLRenderer is required');
    this._world = _world;
    this.mode = _world.mode ?? 'finite';
    this._layers = new Set();
    if (resources?.renderer && resources.renderer !== renderer)
      throw new TypeError('Resources and terrain must use the same renderer');
    this.resources = resources ?? null;
    this._surface = null;
    this._materialSurface = null;
    this._configuration = normalizeConfiguration(configuration, undefined, _world);
    this._requestedConfiguration = this._configuration;
    this._renderer = renderer;
    this._disposed = false;
    this._revision = 0;
    this._jobs = new Set();
    this._compilingMaterials = new Map();
    this._retiredMaterials = new Set();
    this._cameraPosition = new THREE.Vector3();
    this._viewCamera = null;
    this._worldCamera = null;
    this._viewport = new THREE.Vector4();
    this._prepared = false;
    this._onContextRestored = () => this._detailPageCache?.onContextRestored();
    renderer.domElement?.addEventListener?.('webglcontextrestored', this._onContextRestored);
    this._fallback = new THREE.DataTexture(new Uint8Array([128, 128, 128, 255]), 1, 1);
    this._fallback.needsUpdate = true;
    this._uniforms = createTerrainUniforms({ surfaceFallback: this._fallback });
    this._ownedTextures = new Set(
      Object.values(this._uniforms)
        .map((u) => u.value)
        .filter((v) => v?.isTexture),
    );
    this._source = new TerrainSource(this._configuration, this.mode);
    this._stack = this._source.stack;
    this._stackGLSL = this._source.program;
    this._material = this._makeMaterial(this._configuration.source.octaves);
    this._material.uniforms = this._uniforms;
    this.object = new THREE.Group();
    this.object.name = 'procedural-terrain';
    this._runtime =
      _world.createRuntime?.(this) ?? new FiniteTerrainRuntime(this.object, this._material);
    this._sampler = new TerrainHeightSampler(
      this._uniforms,
      () => ({
        octaves: this._configuration.source.octaves,
        infinite: this.mode === 'infinite',
      }),
      this._stack,
    );
    this._apply(this._configuration);
    this._source.install(this._uniforms, this._sampler);
  }

  get configuration() {
    return this._configuration;
  }

  addLayer(layer) {
    this._assertAlive();
    this._layers.add(layer);
    return () => this._layers.delete(layer);
  }

  sampleHeight3D(x, y, z) {
    this._assertAlive();
    if (this.mode !== 'planet') throw new TypeError('sampleHeight3D requires a planet terrain');
    if (![x, y, z].every(Number.isFinite) || Math.hypot(x, y, z) < 1e-9)
      throw new TypeError('A nonzero finite direction is required');
    const length = Math.hypot(x, y, z);
    return this._world.sample(this, x / length, y / length, z / length);
  }

  setImagery(texture, { blend = 1 } = {}) {
    this._assertAlive();
    if (this.mode !== 'finite') throw new TypeError('Imagery requires finite terrain');
    if (texture && !texture.isTexture) throw new TypeError('A THREE.Texture is required');
    if (!Number.isFinite(blend) || blend < 0 || blend > 1)
      throw new RangeError('blend must be 0..1');
    if (this._source.variant === 'manual-empty-base' && texture)
      throw new TypeError('Flat manual terrain does not support imagery; use a heightmap source');
    const size = this.configuration.layout.chunkCount * this.configuration.layout.chunkSize;
    const u = this._uniforms;
    u.uImportImageryTex.value = texture;
    u.uImportImageryMode.value = texture ? 3 : 0;
    u.uImportImageryBlend.value = blend;
    u.uImportHeightRegion.value.set(-size / 2, -size / 2, size, size);
  }

  _installSurface(surface, u = this._uniforms) {
    u.uSurfDiffuse.value = surface.diffuse;
    u.uSurfProps.value = surface.props;
    u.uSurfaceArrayMode.value = surface.backend === 'array' ? 1 : 0;
    u.uSurfaceRoleMap.value = surface.mapping ?? u.uSurfaceRoleMap.value;
    u.uSurfaceRoleTint.value = surface.tints ?? u.uSurfaceRoleTint.value;
    u.uSurfaceAssetSize.value = surface.sizes
      ? [...surface.sizes, ...new Array(Math.max(0, 64 - surface.sizes.length)).fill(2)]
      : u.uSurfaceAssetSize.value;
    u.uSurfaceGraphCode.value = surface.graph?.body ?? '';
    u.uSurfaceGraphParams.value = Array.from(
      { length: 128 },
      (_, i) => new THREE.Vector4(...(surface.graph?.values[i] ?? [0, 0, 0, 0])),
    );
    u.uSurfaceContributions.value = surface.budget?.contributions ?? 4;
    u.uSurfPresent.value = surface.present ?? u.uSurfPresent.value;
    u.uSurfRolePresent.value = surface.rolePresent ?? u.uSurfRolePresent.value;
    u.uSurfTile.value = surface.tile ?? u.uSurfTile.value;
    if (surface.paint?.layers) {
      const items = (slot) => {
        const layer = surface.paint.layers.find((l) => l.slot === slot);
        return layer ? resolveSurfaceReference(layer.materialInstanceId, surface.document) : null;
      };
      u.uSurfacePaintMap.value = Array.from({ length: 32 }, (_, slot) => {
        const refs = items(slot);
        return refs
          ? new THREE.Vector4(
              surface.slots[refs[0].assetId],
              refs[1] ? surface.slots[refs[1].assetId] : -1,
              refs[0].wetness ?? 0,
              refs[0].scale ?? 1,
            )
          : new THREE.Vector4(-1, -1, 0, 1);
      });
      u.uSurfacePaintTint.value = Array.from(
        { length: 32 },
        (_, slot) => new THREE.Vector3(...(items(slot)?.[0].tint ?? [1, 1, 1])),
      );
    }
    u.uSurfMode.value = 1;
    u.uSurfAmount.value = 1;
    u.uSurfReveal.value = 1;
  }

  async setSurface(surface, options = {}) {
    this._assertAlive();
    if (
      surface &&
      (!surface.diffuse?.isTexture || !surface.props?.isTexture || surface.backend !== 'array')
    )
      throw new TypeError('A valid surface array resource is required');
    this._surface = surface;
    try {
      await this.configure({}, options);
    } catch (error) {
      if (this._surface === surface) this._surface = this._materialSurface;
      throw error;
    }
  }

  _assertAlive() {
    if (this._disposed) throw error('TERRAIN_DISPOSED', 'Terrain has been disposed');
  }

  _assertIdentity() {
    this.object.updateWorldMatrix(true, false);
    const e = this.object.matrixWorld.elements;
    if (e.some((v, i) => Math.abs(v - (i % 5 === 0 ? 1 : 0)) > 1e-8)) {
      throw error(
        'TERRAIN_TRANSFORM_UNSUPPORTED',
        'Terrain worlds require an identity world transform in this release',
      );
    }
  }

  _makeMaterial(octaves, source = this._source) {
    const variant = this._surface
      ? source.variant === 'base'
        ? 'surface'
        : source.variant === 'hybrid-base'
          ? 'hybrid-surface'
          : 'manual-surface'
      : source.variant;
    const cloneValue = (value) =>
      value?.isTexture
        ? value
        : Array.isArray(value)
          ? value.map(cloneValue)
          : value?.clone
            ? value.clone()
            : value;
    const uniforms = Object.fromEntries(
      Object.entries(this._uniforms).map(([name, u]) => [name, { value: cloneValue(u.value) }]),
    );
    source.install(uniforms);
    if (this._surface) this._installSurface(this._surface, uniforms);
    else {
      uniforms.uSurfaceArrayMode.value = 0;
      uniforms.uSurfMode.value = 0;
    }
    const material =
      this._world.createMaterial?.({ ...this, _uniforms: uniforms }, octaves, source.program) ??
      createTerrainMaterial(uniforms, octaves, source.program, { variant, worldMode: 'studio' });
    // The existing shader writes display-encoded colour itself. Do not apply
    // host tone mapping to it a second time.
    material.toneMapped = false;
    return material;
  }

  _apply(c, source = this._source) {
    const p = (this._params = configurationParameters(c));
    const size = p.chunkCount * p.chunkSize;
    const skirtDepth = Math.max(24, p.heightScale * 0.08);
    applyTerrainShapeUniforms(this._uniforms, p, size);
    applyTerrainShadingUniforms(this._uniforms, p, {
      size,
      skirtDepth,
      wallThickness: Math.max(10, size * 0.006),
    });
    applyTerrainDetailUniforms(this._uniforms, c.material);
    applyTerrainVisualUniforms(this._uniforms, c.material);
    this._uniforms.uBakeOrigin.value.set(-size / 2, -size / 2);
    this._uniforms.uBakeSpan.value.set(size, size);
    const az = THREE.MathUtils.degToRad(p.sunAzimuth);
    const el = THREE.MathUtils.degToRad(p.sunElevation);
    this._uniforms.uSunDir.value.set(
      Math.cos(el) * Math.sin(az),
      Math.sin(el),
      Math.cos(el) * Math.cos(az),
    );
    this._uniforms.uFogDensity.value = p.fogDensity * 0.0001;
    applyPlanetStyleToUniforms(this._uniforms, { ...c.style, palette: c.palette });
    this._uniforms.uInfiniteMode.value = this.mode === 'infinite' ? 1 : 0;
    if (this._world.apply) {
      this._world.apply(this, c);
      return;
    }
    const b = this._runtime.board;
    b.syncCells({
      chunkCount: p.chunkCount,
      chunkSize: p.chunkSize,
      maxHeight: Math.max(
        p.heightScale * 1.35 + 2,
        source.maxHeight + (source.hasBase ? p.heightScale * 1.35 : 0),
      ),
      skirtDepth: skirtDepth - Math.min(0, source.minHeight),
      lodSegments: c.quality.lodSegments,
      cells: [{ cx: 0, cz: 0 }],
      progressive: false,
    });
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
    let cancel, reason;
    const cancelled = new Promise((_, reject) => {
      cancel = (error) => {
        reason = error;
        reject(error);
      };
    });
    const job = { cancel };
    const onAbort = () => cancel(error('TERRAIN_CANCELLED', 'Terrain operation cancelled'));
    signal?.addEventListener('abort', onAbort, { once: true });
    this._jobs.add(job);
    const work = Promise.resolve().then(() => {
      if (reason) throw reason;
      this._assertAlive();
      checkSignal(signal);
      return task();
    });
    return Promise.race([work, cancelled]).finally(() => {
      signal?.removeEventListener('abort', onAbort);
      this._jobs.delete(job);
    });
  }

  _retireMaterial(material) {
    if (this._compilingMaterials.has(material)) this._retiredMaterials.add(material);
    else material.dispose();
  }

  async _compile(material, camera) {
    this._compilingMaterials.set(material, (this._compilingMaterials.get(material) ?? 0) + 1);
    const probe = this._world.createProbe?.(this, material);
    const geometry = probe?.geometry ?? buildChunkGeometry(2, 0, { morph: true });
    const scene = new THREE.Scene();
    scene.add(probe?.mesh ?? new THREE.Mesh(geometry, material));
    try {
      await this._renderer.compileAsync(scene, camera);
      const health = await validatePrograms({ renderer: this._renderer, materials: [material] });
      if (!health.ok) throw programHealthError(health);
    } finally {
      geometry.dispose();
      const count = this._compilingMaterials.get(material) - 1;
      if (count) this._compilingMaterials.set(material, count);
      else {
        this._compilingMaterials.delete(material);
        if (this._retiredMaterials.delete(material)) material.dispose();
      }
    }
  }

  async prepare(camera, { signal } = {}) {
    this._assertAlive();
    this._assertIdentity();
    if (!camera?.isCamera) throw new TypeError('A THREE.Camera is required');
    this._viewCamera = camera;
    camera.updateWorldMatrix(true, false);
    camera.getWorldPosition(this._cameraPosition);
    checkSignal(signal);
    const revision = this._revision;
    await this._operation(async () => {
      await this._compile(this._material, camera);
      this._assertAlive();
      checkSignal(signal);
      if (revision !== this._revision)
        throw error('TERRAIN_SUPERSEDED', 'Terrain preparation superseded');
      await this._world.prepare?.(this, camera, signal, () => {
        this._assertAlive();
        checkSignal(signal);
        if (revision !== this._revision)
          throw error('TERRAIN_SUPERSEDED', 'Terrain preparation superseded');
      });
      for (const layer of this._layers) await layer.prepare?.(camera, { signal });
      this._assertAlive();
      checkSignal(signal);
      if (revision !== this._revision)
        throw error('TERRAIN_SUPERSEDED', 'Terrain preparation superseded');
      this._prepared = true;
    }, signal);
  }

  async configure(patch, { signal } = {}) {
    this._assertAlive();
    checkSignal(signal);
    const next = normalizeConfiguration(patch, this._requestedConfiguration, this._world);
    this._cancelJobs('TERRAIN_SUPERSEDED', 'Terrain configuration superseded');
    const revision = ++this._revision;
    this._requestedConfiguration = next;
    const wasPrepared = this._prepared;
    const sameLayout = JSON.stringify(next.layout) === JSON.stringify(this._configuration.layout);
    const reuseSource = next.source === this._configuration.source && sameLayout;
    const nextSource = reuseSource ? this._source : new TerrainSource(next, this.mode);
    const sourceChanged = !reuseSource || next.heightScale !== this._configuration.heightScale
      || next.terrainFormationSeaLevel !== this._configuration.terrainFormationSeaLevel
      || ['biomeScale', 'moistScale', 'moistBias', 'tempBias'].some(
        key => next.material[key] !== this._configuration.material[key]);
    const changedProgram =
      nextSource.signature !== this._source.signature || this._materialSurface !== this._surface;
    const candidate = changedProgram ? this._makeMaterial(next.source.octaves, nextSource) : null;
    let published = false,
      started = false;
    try {
      await this._operation(async () => {
        started = true;
        try {
          if (candidate)
            await this._compile(candidate, this._viewCamera || new THREE.PerspectiveCamera());
          this._assertAlive();
          checkSignal(signal);
          if (revision !== this._revision)
            throw error('TERRAIN_SUPERSEDED', 'Terrain configuration superseded');
          this._assertIdentity();
          this._apply(next, nextSource);
          const previousSource = this._source;
          this._source = nextSource;
          this._stack = nextSource.stack;
          this._stackGLSL = nextSource.program;
          nextSource.install(this._uniforms, this._sampler);
          if (this._surface) this._installSurface(this._surface);
          else {
            this._uniforms.uSurfMode.value = 0;
            this._uniforms.uSurfaceArrayMode.value = 0;
          }
          if (candidate) {
            const old = this._material;
            if (this._runtime.board) this._runtime.board.material = candidate;
            candidate.uniforms = this._uniforms;
            this._material = candidate;
            this._runtime.group.traverse((o) => {
              if (o.isMesh && o.material === old) o.material = candidate;
            });
            this._retireMaterial(old);
          }
          this._configuration = next;
          this._materialSurface = this._surface;
          // Publication is synchronous. Failed/cancelled optional warm-ups must
          // never retire resources already bound to the live meshes.
          published = true;
          if (previousSource !== nextSource) previousSource.dispose();
          const check = () => {
            this._assertAlive();
            checkSignal(signal);
            if (revision !== this._revision)
              throw error('TERRAIN_SUPERSEDED', 'Terrain configuration superseded');
          };
          this._prepared = false;
          await this._world.sourceChanged?.(this, nextSource, { signal, check, sourceChanged });
          check();
          for (const layer of this._layers) {
            await layer.onTerrainChanged?.({
              signal,
              sourceChanged,
              programChanged: changedProgram,
            });
            check();
          }
          this._prepared = wasPrepared || !!candidate;
        } finally {
          if (!published) {
            candidate?.dispose();
            if (!reuseSource) nextSource.dispose();
          }
        }
      }, signal);
    } catch (err) {
      if (!started) {
        candidate?.dispose();
        if (!reuseSource) nextSource.dispose();
      }
      if (revision === this._revision) this._requestedConfiguration = this._configuration;
      throw err;
    }
  }

  update(deltaSeconds, { camera } = {}) {
    this._assertAlive();
    this._assertIdentity();
    if (!Number.isFinite(deltaSeconds) || deltaSeconds < 0)
      throw new RangeError('deltaSeconds must be nonnegative');
    if (!camera?.isCamera) throw new TypeError('A THREE.Camera is required');
    this._viewCamera = camera;
    camera.updateWorldMatrix(true, false);
    camera.getWorldPosition(this._cameraPosition);
    // TerrainBoard consumes world camera coordinates. For a parented camera,
    // a detached view camera preserves its projection without changing the host.
    let view = camera;
    if (camera.parent) {
      if (!this._worldCamera || this._worldCamera.type !== camera.type)
        this._worldCamera = camera.clone(false);
      view = this._worldCamera;
      view.projectionMatrix.copy(camera.projectionMatrix);
      view.projectionMatrixInverse.copy(camera.projectionMatrixInverse);
      camera.matrixWorld.decompose(view.position, view.quaternion, view.scale);
      view.updateMatrix();
      view.updateMatrixWorld(true);
    }
    const detail = this.configuration.material;
    if (!this._externalDetailCache && detail.terrainDetailQuality > 0 && typeof Worker === 'function' && this._renderer.initTexture) {
      this._detailPageCache ??= new DetailPageCache({ renderer: this._renderer, uniforms: this._uniforms });
      const seed = this._uniforms.uSeedOffset.value;
      this._detailPageCache.update({ camera: view, mode: this.mode === 'finite' ? 'studio' : this.mode,
        generation: this._revision,
        scale: detail.terrainDetailScale * (0.55 + 0.70 * Math.min(1, detail.terrainDetailQuality / 3)),
        seedX: seed.x, seedY: seed.y, active: true, allowUpload: !this._compilingMaterials.size,
        dt: Math.min(deltaSeconds, 0.1) });
    } else if (!this._externalDetailCache && this._detailPageCache) {
      this._uniforms.uDetailGlobalBlend.value = 0;
    }
    this._uniforms.uTime.value += Math.min(deltaSeconds, 0.1);
    this._runtime.update(view);
    this._world.update?.(this, view);
    for (const layer of this._layers) layer.update?.(Math.min(deltaSeconds, 0.1), { camera: view });
    const viewport = this._renderer.getCurrentViewport(this._viewport);
    this._uniforms.uPixelWorldPerDist.value = camera.isPerspectiveCamera
      ? (2 * Math.tan(THREE.MathUtils.degToRad(camera.fov) * 0.5)) /
        (Math.max(camera.zoom, 1e-6) * Math.max(1, viewport.w))
      : 0;
  }

  sampleHeight(x, z) {
    this._assertAlive();
    this._assertIdentity();
    if (!Number.isFinite(x) || !Number.isFinite(z))
      throw new TypeError('Coordinates must be finite');
    if (this.mode === 'planet') throw new TypeError('Use sampleHeight3D for planet terrains');
    const half = (this._configuration.layout.chunkCount * this._configuration.layout.chunkSize) / 2;
    return this.mode !== 'infinite' && (Math.abs(x) > half || Math.abs(z) > half)
      ? null
      : this._source.sample(x, z, (a, b) => this._sampler.heightAt(a, b));
  }

  serialize() {
    this._assertAlive();
    return {
      format: 'procedural-terrains',
      schemaVersion: 1,
      kind: this.mode,
      extensions: [...this._layers].map((layer) => layer.serialize?.()).filter(Boolean),
      configuration: JSON.parse(JSON.stringify(this._configuration)),
    };
  }

  getDiagnostics() {
    const b = this._runtime.board;
    if (!b)
      return {
        disposed: this._disposed,
        prepared: this._prepared,
        revision: this._revision,
        mode: this.mode,
        ...this._runtime.diagnostics(),
      };
    return {
      disposed: this._disposed,
      prepared: this._prepared,
      revision: this._revision,
      chunks: b.activeChunkCount,
      visible: b.visibleChunkCount,
      culled: b.culledChunkCount,
      lodCounts: [...b.lodCounts],
      mergedGroups: b.mergedGroupCount,
      savedDrawCalls: b.savedDrawCalls,
    };
  }

  dispose() {
    if (this._disposed) return;
    this._disposed = true;
    ++this._revision;
    this._cancelJobs('TERRAIN_DISPOSED', 'Terrain has been disposed');
    for (const layer of [...this._layers]) layer.dispose();
    this._layers.clear();
    this._world.dispose?.(this);
    this._runtime.dispose();
    this._source.dispose();
    this._detailPageCache?.dispose();
    this._renderer.domElement?.removeEventListener?.('webglcontextrestored', this._onContextRestored);
    this.object.removeFromParent();
    this._retireMaterial(this._material);
    for (const texture of this._ownedTextures) texture.dispose();
    this._ownedTextures.clear();
    this._viewCamera = null;
    this._worldCamera = null;
  }
}

export async function createTerrain(options) {
  return new FiniteTerrain(options);
}
