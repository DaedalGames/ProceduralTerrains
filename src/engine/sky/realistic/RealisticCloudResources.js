import * as THREE from 'three';
import {
  NOISE_VOLUME_FRAGMENT,
  WEATHER_CUBE_FRAGMENT,
  WEATHER_FLAT_FRAGMENT,
} from './realisticCloudGLSL.js';

// ============================================================================
// GPU inputs of the realistic cloud mode (port of the Procedural Planets
// bakes):
//   noise volumes   64^3 tileable Perlin-Worley (RG8) + Worley fbm (R8),
//                   baked once per renderer and shared by every layer
//   weather field   r = cloud field, g = cloud type. It evolves through
//                   keyframes WEATHER_STEP apart: the shader crossfades A -> B
//                   while the keyframe after B is baked into the third target.
//                   Cubemap (planet, one face per frame) or a 2D window over
//                   world XZ (flat, re-centred as the wind drifts it).
// ============================================================================

const NOISE_SIZE = 64;
const WEATHER_STEP = 0.004;
export const WEATHER_SIZE = 512;

const WEATHER_TARGET = {
  type: THREE.UnsignedByteType,
  format: THREE.RGFormat,
  minFilter: THREE.LinearFilter,
  magFilter: THREE.LinearFilter,
  wrapS: THREE.ClampToEdgeWrapping,
  wrapT: THREE.ClampToEdgeWrapping,
  depthBuffer: false,
  stencilBuffer: false,
  generateMipmaps: false,
};

const FULLSCREEN_VERTEX = /* glsl */ `
void main() {
  gl_Position = vec4(position.xy, 0.0, 1.0);
}
`;

function screenMaterial(fragmentShader, uniforms) {
  return new THREE.ShaderMaterial({
    vertexShader: FULLSCREEN_VERTEX,
    fragmentShader,
    uniforms,
    depthTest: false,
    depthWrite: false,
    blending: THREE.NoBlending,
  });
}

// One fullscreen-triangle scene per renderer for every bake.
class Blitter {
  constructor() {
    this.camera = new THREE.OrthographicCamera(-1, 1, 1, -1, 0, 1);
    this.quad = new THREE.Mesh(new THREE.PlaneGeometry(2, 2));
    this.quad.frustumCulled = false;
    this.scene = new THREE.Scene();
    this.scene.add(this.quad);
  }

  blit(renderer, material, target, layer = 0) {
    this.quad.material = material;
    renderer.setRenderTarget(target, layer);
    renderer.render(this.scene, this.camera);
  }

  dispose() {
    this.quad.geometry.dispose();
  }
}

// Saves / restores the renderer state a bake touches.
function withBakeState(renderer, fn) {
  const prevTarget = renderer.getRenderTarget();
  const prevFace = renderer.getActiveCubeFace?.() ?? 0;
  const prevMip = renderer.getActiveMipmapLevel?.() ?? 0;
  const prevAutoClear = renderer.autoClear;
  const prevXr = renderer.xr?.enabled;
  try {
    renderer.autoClear = false;
    if (renderer.xr) renderer.xr.enabled = false;
    fn();
  } finally {
    renderer.setRenderTarget(prevTarget, prevFace, prevMip);
    renderer.autoClear = prevAutoClear;
    if (renderer.xr) renderer.xr.enabled = prevXr;
  }
}

const _shared = new WeakMap();
const _owners = new WeakMap();

export function retainRealisticNoiseVolumes(renderer) {
  if (!renderer) return () => {};
  _owners.set(renderer, (_owners.get(renderer) || 0) + 1);
  let released = false;
  return () => {
    if (released) return; released = true;
    const count = (_owners.get(renderer) || 1) - 1;
    if (count > 0) { _owners.set(renderer, count); return; }
    _owners.delete(renderer);
    const entry = _shared.get(renderer);
    if (entry) { entry.noiseRT.dispose(); entry.erosionRT.dispose(); entry.blitter.dispose(); _shared.delete(renderer); }
  };
}

/**
 * Shared noise volumes for a renderer (baked on first use). Returns
 * { noise, erosion } 3D textures.
 */
export function getRealisticNoiseVolumes(renderer) {
  let entry = _shared.get(renderer);
  if (!entry) {
    const volume = (format) => {
      const rt = new THREE.WebGL3DRenderTarget(NOISE_SIZE, NOISE_SIZE, NOISE_SIZE, { depthBuffer: false });
      const t = rt.texture;
      t.format = format;
      t.type = THREE.UnsignedByteType;
      t.minFilter = THREE.LinearFilter;
      t.magFilter = THREE.LinearFilter;
      t.wrapS = t.wrapT = t.wrapR = THREE.RepeatWrapping;
      t.generateMipmaps = false;
      return rt;
    };
    entry = {
      noiseRT: volume(THREE.RGFormat),
      erosionRT: volume(THREE.RedFormat),
      baked: false,
      blitter: new Blitter(),
    };
    _shared.set(renderer, entry);
  }
  if (!entry.baked) {
    const mat = screenMaterial(NOISE_VOLUME_FRAGMENT, {
      uLayer: { value: 0 },
      uSize: { value: NOISE_SIZE },
    });
    withBakeState(renderer, () => {
      for (const rt of [entry.noiseRT, entry.erosionRT]) {
        for (let layer = 0; layer < NOISE_SIZE; layer++) {
          mat.uniforms.uLayer.value = layer;
          entry.blitter.blit(renderer, mat, rt, layer);
        }
      }
    });
    mat.dispose();
    entry.baked = true;
  }
  return { noise: entry.noiseRT.texture, erosion: entry.erosionRT.texture, blitter: entry.blitter };
}

export function seedOffset(seed = 0) {
  // three decorrelated offsets in [-50, 50) from the integer seed
  let s = (Number(seed) >>> 0) || 1;
  const next = () => {
    s = (s + 0x6D2B79F5) >>> 0;
    let t = s;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
  return new THREE.Vector3(next() * 100 - 50, next() * 100 - 50, next() * 100 - 50);
}

// ---------------------------------------------------------------------------
// Keyframe clock shared by both weather fields: the displayed weather time
// follows wt but waits at keyframe B until the next one is baked, then catches
// up (never a jump).
// ---------------------------------------------------------------------------
class WeatherKeyframes {
  constructor(count) {
    this.count = count;
    this.dirty = true;
    this._a = 0; this._b = 0; this._c = 1;
    this._tA = 0; this._tB = 0; this._tC = 0;
    this._shown = 0;
    this._prev = 0;
  }

  start(wt) {
    this._b = this._a;
    this._tA = this._tB = wt;
    this._shown = this._prev = wt;
    this.dirty = false;
    this.queue();
  }

  queue() {
    this._c = [0, 1, 2].find((i) => i !== this._a && i !== this._b);
    this._tC = this._tB + WEATHER_STEP;
    this.pending = true;
  }

  advance(wt) {
    const dw = Math.max(0, wt - this._prev);
    this._prev = wt;
    const behind = wt - this._shown > dw;
    this._shown = Math.min(this._shown + dw * (behind ? 1.5 : 1), wt, this._tB);
    if (this._shown >= this._tB && !this.pending) {
      this._a = this._b; this._tA = this._tB;
      this._b = this._c; this._tB = this._tC;
      this.queue();
    }
    const span = this._tB - this._tA;
    return span > 0 ? THREE.MathUtils.clamp((this._shown - this._tA) / span, 0, 1) : 0;
  }

  get late() {
    return this._prev - this._tB > WEATHER_STEP * 0.5;
  }
}

/** Planet weather: three RG8 cubemaps, one face of the next keyframe per frame. */
export class CubeWeatherField {
  constructor(size = WEATHER_SIZE) {
    this.size = size;
    this.targets = [0, 1, 2].map(() => new THREE.WebGLCubeRenderTarget(size, WEATHER_TARGET));
    this.keys = new WeatherKeyframes(3);
    this._face = 0;
    this._initFace = 0;
    this.material = screenMaterial(WEATHER_CUBE_FRAGMENT, {
      uSeedOffset: { value: new THREE.Vector3() },
      uWeatherTime: { value: 0 },
      uFaceSize: { value: size },
      uFace: { value: 0 },
      uCloudScale: { value: 3.2 },
      uLoopGuard: { value: 0 },
    });
    this.blend = 0;
  }

  /** Re-bake from scratch when the seed or system scale changes. */
  configure(scale, seedVec) {
    const u = this.material.uniforms;
    if (u.uCloudScale.value === scale && u.uSeedOffset.value.equals(seedVec)) return;
    u.uCloudScale.value = scale;
    u.uSeedOffset.value.copy(seedVec);
    this.keys.dirty = true;
    this._initFace = 0;
  }

  _bakeFace(renderer, blitter, idx, time, face) {
    const u = this.material.uniforms;
    u.uWeatherTime.value = time;
    u.uFace.value = face;
    blitter.blit(renderer, this.material, this.targets[idx], face);
  }

  update(renderer, blitter, wt) {
    const k = this.keys;
    withBakeState(renderer, () => {
      if (k.dirty) {
        for (; this._initFace < 6; this._initFace++) this._bakeFace(renderer, blitter, k._a, wt, this._initFace);
        this._initFace = 0;
        k.start(wt);
        this._face = 0;
      }
      if (k.pending) {
        do {
          this._bakeFace(renderer, blitter, k._c, k._tC, this._face);
        } while (++this._face < 6 && k.late);
        if (this._face >= 6) { this._face = 0; k.pending = false; }
      }
    });
    this.blend = k.advance(wt);
  }

  get current() { return this.targets[this.keys._a].texture; }
  get next() { return this.targets[this.keys._b].texture; }

  dispose() {
    for (const rt of this.targets) rt.dispose();
    this.material.dispose();
  }
}

/**
 * Flat weather: three RG8 2D maps over a field-space window. The window is
 * re-centred (all keyframes re-baked) when the drifted view leaves its core.
 */
export class FlatWeatherField {
  constructor(size = WEATHER_SIZE) {
    this.size = size;
    this.targets = [0, 1, 2].map(() => new THREE.WebGLRenderTarget(size, size, WEATHER_TARGET));
    this.keys = new WeatherKeyframes(3);
    this.center = new THREE.Vector2(Infinity, Infinity);
    this.half = 1;
    this.material = screenMaterial(WEATHER_FLAT_FRAGMENT, {
      uSeedOffset: { value: new THREE.Vector3() },
      uWeatherTime: { value: 0 },
      uFaceSize: { value: size },
      uWindowCenter: { value: new THREE.Vector2() },
      uWindowHalf: { value: 1 },
      uCloudScale: { value: 1e-3 },
      uLoopGuard: { value: 0 },
    });
    this.blend = 0;
  }

  configure(scale, seedVec) {
    const u = this.material.uniforms;
    if (u.uCloudScale.value === scale && u.uSeedOffset.value.equals(seedVec)) return;
    u.uCloudScale.value = scale;
    u.uSeedOffset.value.copy(seedVec);
    this.keys.dirty = true;
  }

  _bake(renderer, blitter, idx, time) {
    const u = this.material.uniforms;
    u.uWeatherTime.value = time;
    u.uWindowCenter.value.copy(this.center);
    u.uWindowHalf.value = this.half;
    blitter.blit(renderer, this.material, this.targets[idx]);
  }

  /**
   * @param {THREE.Vector2} want field-space point the window must cover
   * @param {number} half window half width (world units)
   */
  update(renderer, blitter, wt, want, half) {
    const k = this.keys;
    const moved = Math.abs(want.x - this.center.x) > this.half * 0.18
      || Math.abs(want.y - this.center.y) > this.half * 0.18
      || Math.abs(half - this.half) > this.half * 0.05;
    withBakeState(renderer, () => {
      if (moved) {
        this.center.copy(want);
        this.half = half;
        if (!k.dirty) {
          // same weather times, new window: re-bake what is shown
          this._bake(renderer, blitter, k._a, k._tA);
          if (k._b !== k._a) this._bake(renderer, blitter, k._b, k._tB);
          k.pending = true;
        }
      }
      if (k.dirty) {
        this._bake(renderer, blitter, k._a, wt);
        k.start(wt);
      }
      if (k.pending) {
        this._bake(renderer, blitter, k._c, k._tC);
        k.pending = false;
      }
    });
    this.blend = k.advance(wt);
  }

  get current() { return this.targets[this.keys._a].texture; }
  get next() { return this.targets[this.keys._b].texture; }

  dispose() {
    for (const rt of this.targets) rt.dispose();
    this.material.dispose();
  }
}
