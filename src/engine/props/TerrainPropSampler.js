// ============================================================================
// TerrainPropSampler — one query surface for prop placement.
//
// Wraps the existing height fields (TerrainHeightSampler for flat Tile/Infinite,
// PlanetHeightSampler for Planet) and the paint layers, exposing a single rich
// sample record that the placement masks consume. We do NOT re-derive any height
// math here — every field comes from samplers that are already f32-exact ports
// of the rendered GLSL, so props land on the real visual surface.
//
//   FlatPropSampler.sampleAt(x, z)            → record
//   PlanetPropSampler.sampleAt3D(dx, dy, dz)  → record (dir must be unit length)
//
// record = {
//   height, position:[x,y,z], normal:{x,y,z}, slope (0..1),
//   biomeWeights:{desert,canyon,wetland,mountains}, moisture, temperature,
//   water (bool), shoreDistance (height - waterLevel), mask (paint props or null),
//   surfaceRadius? (planet only)
// }
// ============================================================================

function clamp(v, a, b) { return v < a ? a : v > b ? b : v; }

export class FlatPropSampler {
  /**
   * @param {object} opts
   * @param {TerrainHeightSampler} opts.cpu
   * @param {function} opts.getWaterLevel        () => number
   * @param {function} [opts.getHeightOffset]    (x,z) => number   paint height (studio)
   * @param {function} [opts.getPaintBiomeWeights] (x,z) => weights|null
   * @param {function} [opts.getPaintMask]        (x,z) => {grass,flowers,mixed}|null
   * @param {function} [opts.getPropExclusion]    (x,z) => 0..1 spline exclusion
   */
  constructor({ cpu, surfaceField, getWaterLevel, getHeightOffset, getPaintBiomeWeights, getPaintMask, getPropExclusion }) {
    this.cpu = cpu;
    this.surfaceField = surfaceField || null;   // GPU faceted-surface readback
    this.getWaterLevel = getWaterLevel;
    this.getHeightOffset = getHeightOffset || (() => 0);
    this.getPaintBiomeWeights = getPaintBiomeWeights || (() => null);
    this.getPaintMask = getPaintMask || (() => null);
    this.getPropExclusion = getPropExclusion || (() => 0);
  }

  /** Cheap paint-mask density (0..1) for the density pre-gate — no terrain eval. */
  paintDensityAt(x, z) {
    const m = this.getPaintMask(x, z);
    return m ? Math.max(m.grass || 0, m.flowers || 0, m.mixed || 0, m.rocks || 0, m.trees || 0) : 0;
  }

  paintDensityForTypeAt(type, x, z) {
    const m = this._paintMask(x, z);
    if (!m) return 0;
    if (type === 'grass') return (m.grass || 0) + (m.mixed || 0) * 0.55;
    if (type === 'flower') return (m.flowers || 0) + (m.mixed || 0) * 0.45;
    if (type === 'rock') return m.rocks || 0;
    if (type === 'broadleaf' || type === 'conifer') return m.trees || 0;
    return 0;
  }

  _paintMask(x, z) { return this.getPaintMask(x, z); }

  /** Center the faceted-surface readback tile on the build area up-front. */
  prime(cx, cz) { this.surfaceField?.prime(cx, cz); }

  beginBatch(cx, cz) {
    if (this.surfaceField?.beginBatch) this.surfaceField.beginBatch(cx, cz);
    else this.surfaceField?.prime(cx, cz);
  }

  endBatch() { this.surfaceField?.endBatch?.(); }

  sampleAt(x, z) {
    const waterLevel = this.getWaterLevel();
    const paintOffset = this.getHeightOffset(x, z);
    const info = this.cpu.sampleSurfaceInfo(x, z, {
      waterLevel,
      paintHeightOffset: paintOffset,
      paintBiomeWeights: this.getPaintBiomeWeights(x, z),
      eps: 2.0,
    });
    const climate = this.cpu.climateAt(x, z);
    // Anchor height to the ACTUAL rendered (faceted) mesh so props sit on the
    // visible surface, not the smooth analytic field that floats above crests.
    // Slope/biome/climate stay analytic (smooth normals look better than the
    // faceted ones, and biome is a smooth field anyway).
    let height = info.height;
    if (this.surfaceField) {
      const surf = this.surfaceField.heightAt(x, z);
      if (Number.isFinite(surf)) height = surf + paintOffset;
    }
    return {
      x, z,
      height,
      position: [x, height, z],
      normal: info.normal,
      slope: info.slope,
      biomeWeights: info.biomeWeights,
      moisture: climate.moist,
      temperature: climate.temp,
      heightScale: this.cpu.u?.uHeightScale?.value ?? 560,
      water: height <= waterLevel + 0.01,
      shoreDistance: height - waterLevel,
      mask: this.getPaintMask(x, z),
      excludeProps: this.getPropExclusion(x, z),
    };
  }
}

/**
 * Mini Terrain placement sampler: the same record as FlatPropSampler, read
 * from the live vertex-height grid (GPU-rendered by the compiled height
 * program and read back; it already contains every height offset) and a
 * coarse climate grid. Lookups instead of full noise-stack evaluations make
 * a whole-diorama scatter cheap enough to rebuild in the frame an edit lands.
 */
export class MiniFieldPropSampler extends FlatPropSampler {
  constructor(opts) {
    super(opts);
    this.field = null;
    this._climate = null;
    this._climateKey = '';
  }

  setField(field) {
    this.field = field;
    this._maskX = NaN;
    this._syncClimate(field.half);
  }

  prime() {}
  beginBatch() {}
  endBatch() {}

  // The placement pre-gate and the sample ask for the same point in a row.
  _paintMask(x, z) {
    if (x !== this._maskX || z !== this._maskZ) {
      this._maskX = x;
      this._maskZ = z;
      this._maskValue = this.getPaintMask(x, z);
    }
    return this._maskValue;
  }

  // Climate varies over hundreds of units: a 65² grid, rebuilt only when a
  // climate input (seed, frequency, biome sliders, footprint) changes.
  _syncClimate(half) {
    const u = this.cpu.u;
    const key = [
      half, u.uFrequency.value, u.uSeedOffset.value.x, u.uSeedOffset.value.y, u.uBiomeScale.value,
      u.uTempBias.value, u.uMoistBias.value, u.uMoistScale.value,
    ].join(':');
    if (key === this._climateKey) return;
    this._climateKey = key;
    const n = 65;
    const data = new Float32Array(n * n * 5);
    const step = (2 * half) / (n - 1);
    for (let j = 0; j < n; j++) {
      for (let i = 0; i < n; i++) {
        const c = this.cpu.climateAt(-half + i * step, -half + j * step);
        const o = (j * n + i) * 5;
        data[o] = c.temp; data[o + 1] = c.moist; data[o + 2] = c.cont;
        data[o + 3] = c.erosion; data[o + 4] = c.region;
      }
    }
    this._climate = { n, half, step, data };
  }

  _climateAt(x, z) {
    const { n, half, step, data } = this._climate;
    const fx = clamp((x + half) / step, 0, n - 1.0001);
    const fz = clamp((z + half) / step, 0, n - 1.0001);
    const i = Math.floor(fx); const j = Math.floor(fz);
    const tx = fx - i; const tz = fz - j;
    const o00 = (j * n + i) * 5; const o10 = o00 + 5;
    const o01 = o00 + n * 5; const o11 = o01 + 5;
    const at = (k) => {
      const a = data[o00 + k] + (data[o10 + k] - data[o00 + k]) * tx;
      const b = data[o01 + k] + (data[o11 + k] - data[o01 + k]) * tx;
      return a + (b - a) * tz;
    };
    return { temp: at(0), moist: at(1), cont: at(2), erosion: at(3), region: at(4) };
  }

  heightAt(x, z) {
    const { n, half, heights } = this.field;
    const step = (2 * half) / (n - 1);
    const fx = clamp((x + half) / step, 0, n - 1.0001);
    const fz = clamp((z + half) / step, 0, n - 1.0001);
    const i = Math.floor(fx); const j = Math.floor(fz);
    const tx = fx - i; const tz = fz - j;
    const k = j * n + i;
    const a = heights[k] + (heights[k + 1] - heights[k]) * tx;
    const b = heights[k + n] + (heights[k + n + 1] - heights[k + n]) * tx;
    return a + (b - a) * tz;
  }

  sampleAt(x, z) {
    const waterLevel = this.getWaterLevel();
    const height = this.heightAt(x, z);
    // normal over one surface quad: the slope the visible mesh has
    const e = (2 * this.field.half) / (this.field.n - 1);
    const nx = this.heightAt(x - e, z) - this.heightAt(x + e, z);
    const nz = this.heightAt(x, z - e) - this.heightAt(x, z + e);
    const ny = 2 * e;
    const len = Math.hypot(nx, ny, nz) || 1;
    const normal = { x: nx / len, y: ny / len, z: nz / len };
    const climate = this._climateAt(x, z);
    const weights = this.cpu._biomeWeights(climate);
    const painted = this.getPaintBiomeWeights(x, z);
    const biomeWeights = painted ? this.cpu._dominantBiome(weights, painted).weights : weights;
    return {
      x, z,
      height,
      position: [x, height, z],
      normal,
      slope: clamp(1 - normal.y, 0, 1),
      biomeWeights,
      moisture: climate.moist,
      temperature: climate.temp,
      heightScale: this.cpu.u?.uHeightScale?.value ?? 560,
      water: height <= waterLevel + 0.01,
      shoreDistance: height - waterLevel,
      mask: this._paintMask(x, z),
      excludeProps: this.getPropExclusion(x, z),
    };
  }
}

export class PlanetPropSampler {
  /**
   * @param {object} opts
   * @param {PlanetHeightSampler} opts.planet
   * @param {function} opts.getWaterLevel   () => number
   * @param {function} opts.getPlanetRadius () => number
   */
  constructor({ planet, getWaterLevel, getPlanetRadius }) {
    this.planet = planet;
    this.getWaterLevel = getWaterLevel;
    this.getPlanetRadius = getPlanetRadius;
  }

  /** @param {number} dx,dy,dz unit direction from planet center. */
  sampleAt3D(dx, dy, dz) {
    const waterLevel = this.getWaterLevel();
    const radius = this.getPlanetRadius();
    const height = this.planet.heightAt3D(dx, dy, dz);
    const normal = this.planet.normalAt(dx, dy, dz);
    // radial "up" is the direction itself; slope = 1 - cos(angle to up)
    const slope = clamp(1 - (normal.x * dx + normal.y * dy + normal.z * dz), 0, 1);
    const { climate, weights } = this.planet.biomeInfoAt3D(dx, dy, dz);
    const surfaceRadius = radius + height;
    return {
      x: dx, z: dz,
      height,
      position: [dx * surfaceRadius, dy * surfaceRadius, dz * surfaceRadius],
      normal,
      slope,
      biomeWeights: weights,
      moisture: climate.moist,
      temperature: climate.temp,
      heightScale: this.planet.u?.uHeightScale?.value ?? 560,
      water: height <= waterLevel + 0.01,
      shoreDistance: height - waterLevel,
      mask: null,
      surfaceRadius,
    };
  }
}
