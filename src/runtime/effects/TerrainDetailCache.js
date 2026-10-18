import { DetailPageCache } from '../../engine/terrain/detail/DetailPageCache.js';
import { withRendererState } from '../resources/RendererState.js';

/** Optional camera-local detail pages; each cache owns its own CPU worker. */
export class TerrainDetailCache {
  constructor({ terrain, quality = 2, scale = 0.16, strength = 0.72, onError } = {}) {
    if (
      !Number.isInteger(quality) ||
      quality < 1 ||
      quality > 3 ||
      !Number.isFinite(scale) ||
      scale <= 0 ||
      !Number.isFinite(strength) ||
      strength < 0
    )
      throw new RangeError('Invalid detail quality, scale or strength');
    terrain._assertAlive();
    this.terrain = terrain;
    this.quality = quality;
    this.scale = scale;
    this.strength = strength;
    this.disposed = false;
    this.cache = new DetailPageCache({
      renderer: terrain._renderer,
      uniforms: terrain._uniforms,
      onError,
    });
    this._detach = terrain.addLayer(this);
    this._apply();
  }
  _apply() {
    const u = this.terrain._uniforms;
    u.uTerrainDetailQuality.value = this.quality;
    u.uTerrainDetailScale.value = this.scale;
    u.uTerrainDetailStrength.value = this.strength;
  }
  onTerrainChanged() {
    this.cache.invalidate();
    this._apply();
  }
  update(dt, { camera }) {
    const t = this.terrain,
      seed = t._uniforms.uSeedOffset.value;
    withRendererState(t._renderer, () =>
      this.cache.update({
        camera,
        mode: t.mode,
        generation: t._revision,
        scale: this.scale * (0.55 + (0.7 * this.quality) / 3),
        seedX: seed.x,
        seedY: seed.y,
        active: true,
        dt,
      }),
    );
  }
  getDiagnostics() {
    return {
      pending: this.cache.pending.size,
      cpuPages: this.cache.cpu.size,
      ready: this.cache.hasReadyPage,
    };
  }
  dispose() {
    if (this.disposed) return;
    this.disposed = true;
    this._detach();
    this.cache.dispose();
    this.terrain._uniforms.uTerrainDetailQuality.value = 0;
    this.terrain._uniforms.uDetailGlobalBlend.value = 0;
    this.terrain._uniforms.uDetailPageArray.value = null;
  }
}
export function createDetailCache(options) {
  return new TerrainDetailCache(options);
}
