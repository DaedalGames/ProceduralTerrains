import { TerrainHeightBaker } from '../../engine/terrain/TerrainHeightBaker.js';
import { compileMaterial } from '../resources/CompileMaterial.js';
import { withRendererState } from '../resources/RendererState.js';

/** Optional finite GPU cache. Reuses the studio's double-buffered bake path. */
export class TerrainHeightCache {
  constructor({ terrain, resolution = 512, attach = true }) {
    if (terrain.mode !== 'finite') throw new TypeError('Height cache requires finite terrain');
    if (!Number.isInteger(resolution) || resolution < 16 || resolution > 2048)
      throw new RangeError('Cache resolution must be 16..2048');
    this.terrain = terrain;
    this.serial = 0;
    this.disposed = false;
    this.baker = new TerrainHeightBaker({
      renderer: terrain._renderer,
      uniforms: terrain._uniforms,
      size: resolution,
      maxSize: 2048,
      requirePrepared: true,
    });
    this._detach = attach ? terrain.addLayer(this) : () => {};
  }
  async prepare(camera, { signal } = {}) {
    if (this.disposed) throw new Error('Height cache disposed');
    this.terrain._assertAlive();
    const serial = ++this.serial,
      t = this.terrain,
      revision = t._revision,
      b = this.baker,
      h = b.prepareProgram(t.configuration.source.octaves, t._stackGLSL);
    try {
      for (const p of h.passes)
        await compileMaterial(t._renderer, p.material, p.camera, {
          geometry: p.mesh.geometry.clone(),
        });
      signal?.throwIfAborted();
      t._assertAlive();
      if (this.disposed || serial !== this.serial || revision !== t._revision)
        throw Object.assign(new Error('Height cache superseded'), { code: 'TERRAIN_SUPERSEDED' });
      if (!b.publishPrepared(h)) throw new Error('Height cache program superseded');
      withRendererState(t._renderer, () => b.bake(t.configuration.source.octaves, t._stackGLSL));
      const u = t._uniforms;
      u.uTerrainHeightTex.value = b.texture;
      u.uTerrainBiomeTex.value = b.biomeTexture;
      u.uUseTerrainHeightTex.value = 1;
      u.uUseTerrainBiomeTex.value = 1;
      u.uWaterTerrainHeightTex.value = b.texture;
      u.uWaterTerrainBiomeTex.value = b.biomeTexture;
      u.uUseWaterTerrainBiomeTex.value = 1;
      u.uBakeTexelWorld.value =
        (t.configuration.layout.chunkCount * t.configuration.layout.chunkSize) / b.target.width;
    } catch (error) {
      b.discardPrepared(h);
      throw error;
    }
  }
  onTerrainChanged(options) {
    if (options?.sourceChanged === false) return;
    return this.prepare(this.terrain._viewCamera, options);
  }
  dispose() {
    if (this.disposed) return;
    this.disposed = true;
    ++this.serial;
    this._detach();
    const u = this.terrain._uniforms;
    if (u.uTerrainHeightTex.value === this.baker.texture) {
      u.uUseTerrainHeightTex.value = 0;
      u.uUseTerrainBiomeTex.value = 0;
      u.uUseWaterTerrainBiomeTex.value = 0;
      u.uTerrainHeightTex.value = null;
      u.uTerrainBiomeTex.value = null;
      u.uWaterTerrainHeightTex.value = null;
      u.uWaterTerrainBiomeTex.value = null;
    }
    this.baker.dispose();
  }
}
export function createHeightCache(options) {
  return new TerrainHeightCache(options);
}
