import * as THREE from 'three';
import { MINI_BEVEL_GLSL } from './MiniBevel.js';

// ============================================================================
// MiniLightMap — soft sun shadows and ambient occlusion for the diorama.
//
// The engine has no shadow maps and the terrain is displaced in its vertex
// shader, so instead of touching every terrain program (and its 16-sampler
// budget) the Mini presentation:
//   1. BAKES a small light map over the footprint on the GPU, from a grid of
//      the terrain's own VERTEX heights (TerrainHeightBaker.renderHeightGrid:
//      the compiled height program, one sample per surface vertex). The
//      terrain displaces its vertices analytically, so this grid is exact and
//      current in the very frame of an edit; the slow progressive full bake
//      (fragment normals only) is never waited for:
//        R = sun visibility (height-field ray march toward the sun, soft
//            penumbra growing with distance to the occluder),
//        G = ambient occlusion (8-direction horizon estimate),
//        B = terrain height (world units, filtered: smooth water depth);
//   2. APPLIES it with a decal mesh on the same vertex grid, drawn
//      right after the terrain with multiplicative blending (dst × factor), so
//      it darkens terrain only (props and water are separate objects).
// The water shader samples the same map for cliff shadows on the surface.
//
// Re-baked only when the terrain field, the sun direction or the footprint
// change (at most once per frame while a slider is dragged).
// Static loop bounds, masks instead of break — ANGLE/FXC friendly.
// ============================================================================

const BAKE_VERTEX = /* glsl */ `
varying vec2 vUv;
void main() {
  vUv = uv;
  gl_Position = vec4(position.xy, 0.0, 1.0);
}
`;

// Texel i of the (segments + 1)^2 grid holds the height of vertex i, at
// x = -half + i * width / segments: sampling a vertex position hits a texel
// centre exactly, in between it interpolates like the terrain triangles.
const HEIGHT_FETCH = /* glsl */ `
uniform sampler2D uMiniHeightGrid;
uniform float uMiniGridSegments;
uniform float uHalf;
uniform float uMiniTerrainBevel;
uniform float uMiniBevelRounded;
uniform float uHeightScale;
float miniBakedHeight(vec2 xz) {
  vec2 g = (xz + uHalf) / max(uHalf * 2.0, 1.0) * uMiniGridSegments;
  vec2 uv = (g + 0.5) / (uMiniGridSegments + 1.0);
  return textureLod(uMiniHeightGrid, clamp(uv, 0.0, 1.0), 0.0).a * uHeightScale;
}
`;

const BAKE_FRAGMENT = /* glsl */ `
precision highp float;
${HEIGHT_FETCH}
${MINI_BEVEL_GLSL}
uniform vec3 uSunDir;
uniform float uSoftness;
varying vec2 vUv;

void main() {
  vec2 xz = (vUv * 2.0 - 1.0) * uHalf;
  float h = miniBakedHeight(xz) + 0.6;
  vec3 sun = normalize(uSunDir);
  float horiz = max(length(sun.xz), 1e-3);
  vec2 dir = sun.xz / horiz;
  float rise = sun.y / horiz;          // ray climb per horizontal unit
  float stepLen = uHalf / 96.0;

  float occluded = 0.0;
  for (int i = 1; i <= 72; i++) {
    float t = float(i) * stepLen * (1.0 + float(i) * 0.02);
    vec2 q = xz + dir * t;
    float inside = step(0.0, miniBevelDistance(q, uHalf, uMiniTerrainBevel, uMiniBevelRounded));
    float above = miniBakedHeight(q) - (h + t * rise);
    // penumbra widens with distance to the occluder
    occluded = max(occluded, inside * smoothstep(0.0, uSoftness + t * 0.12, above));
  }

  float occ = 0.0;
  for (int k = 0; k < 8; k++) {
    float a = float(k) * 0.7853982 + 0.39;
    vec2 d = vec2(cos(a), sin(a));
    occ += clamp((miniBakedHeight(xz + d * 5.0) - h) / 5.0, 0.0, 1.0);
    occ += clamp((miniBakedHeight(xz + d * 16.0) - h) / 16.0, 0.0, 1.0);
    occ += clamp((miniBakedHeight(xz + d * 42.0) - h) / 42.0, 0.0, 1.0) * 0.8;
  }
  float ao = 1.0 - clamp(occ / 22.4 * 1.9, 0.0, 1.0) * 0.7;
  gl_FragColor = vec4(1.0 - occluded, ao, h - 0.6, 1.0);
}
`;

const DECAL_VERTEX = /* glsl */ `
${HEIGHT_FETCH}
${MINI_BEVEL_GLSL}
varying vec2 vXZ;
void main() {
  vec2 xz = position.xz * uHalf;
  xz = miniBevelPoint(xz, uHalf, uMiniTerrainBevel, uMiniBevelRounded);
  vXZ = xz;
  vec4 wp = vec4(xz.x, miniBakedHeight(xz) + 0.25, xz.y, 1.0);
  gl_Position = projectionMatrix * viewMatrix * wp;
}
`;

const DECAL_FRAGMENT = /* glsl */ `
precision highp float;
uniform sampler2D uMiniLightTex;
uniform float uHalf;
uniform float uShadowStrength;
uniform float uAOStrength;
uniform vec3 uShadowTint;
varying vec2 vXZ;
void main() {
  vec2 uv = vXZ / (uHalf * 2.0) + 0.5;
  vec2 light = texture2D(uMiniLightTex, uv).rg;
  float shade = (1.0 - light.r) * uShadowStrength;
  // shadowed areas keep the cool sky fill instead of turning grey
  vec3 factor = mix(vec3(1.0), uShadowTint, shade);
  factor *= mix(1.0, light.g, uAOStrength);
  gl_FragColor = vec4(factor, 1.0);
}
`;

const COPY_FRAGMENT = /* glsl */ `
precision highp float;
uniform sampler2D uSource;
varying vec2 vUv;
void main() {
  gl_FragColor = texture2D(uSource, vUv);
}
`;

function buildDecalGrid(segments) {
  const geo = new THREE.PlaneGeometry(2, 2, segments, segments);
  geo.rotateX(-Math.PI / 2);
  return geo;
}

export class MiniLightMap {
  constructor(sharedUniforms, { size = 512 } = {}) {
    this.shared = sharedUniforms;
    this.size = size;
    this.target = new THREE.WebGLRenderTarget(size, size, {
      type: THREE.HalfFloatType,
      depthBuffer: false,
      stencilBuffer: false,
    });
    this.target.texture.minFilter = THREE.LinearFilter;
    this.target.texture.magFilter = THREE.LinearFilter;
    this.target.texture.generateMipmaps = false;
    this.target.texture.name = 'MiniLightMap';

    this.grid = null;   // (segments + 1)^2 vertex heights, see ensureGrid
    const heightUniforms = {
      uMiniHeightGrid: { value: null },
      uMiniGridSegments: { value: 256 },
      uHalf: { value: 512 },
      uMiniTerrainBevel: sharedUniforms.uMiniTerrainBevel ?? { value: 0 },
      uMiniBevelRounded: sharedUniforms.uMiniBevelRounded ?? { value: 0 },
      uHeightScale: sharedUniforms.uHeightScale,
    };
    this._heightUniforms = heightUniforms;
    this.bakeMaterial = new THREE.ShaderMaterial({
      name: 'MiniLightMapBake',
      uniforms: {
        ...heightUniforms,
        uSunDir: { value: new THREE.Vector3(0.5, 0.7, 0.3) },
        uSoftness: { value: 3 },
      },
      vertexShader: BAKE_VERTEX,
      fragmentShader: BAKE_FRAGMENT,
      depthTest: false,
      depthWrite: false,
    });
    this.bakeScene = new THREE.Scene();
    this.bakeCamera = new THREE.OrthographicCamera(-1, 1, 1, -1, 0, 1);
    const quad = new THREE.Mesh(new THREE.PlaneGeometry(2, 2), this.bakeMaterial);
    quad.frustumCulled = false;
    this.bakeScene.add(quad);
    this._quad = quad;

    this.decalMaterial = new THREE.ShaderMaterial({
      name: 'MiniLightDecal',
      uniforms: {
        ...heightUniforms,
        uMiniLightTex: { value: this.target.texture },
        uShadowStrength: { value: 0.62 },
        uAOStrength: { value: 0.85 },
        uShadowTint: { value: new THREE.Vector3(0.6, 0.66, 0.8) },
      },
      vertexShader: DECAL_VERTEX,
      fragmentShader: DECAL_FRAGMENT,
      blending: THREE.CustomBlending,
      blendEquation: THREE.AddEquation,
      blendSrc: THREE.DstColorFactor,
      blendDst: THREE.ZeroFactor,
      depthTest: true,
      depthWrite: false,
      polygonOffset: true,
      polygonOffsetFactor: -2,
      polygonOffsetUnits: -4,
    });
    this.decal = new THREE.Mesh(buildDecalGrid(256), this.decalMaterial);
    this.decal.name = 'mini-light-decal';
    this.decal.frustumCulled = false;
    this.decal.renderOrder = 6;   // right after the terrain (0), before water (10)
    this._segments = 256;
    this._key = '';
    this.ready = false;

    // CPU copy of the vertex-height grid for prop placement (see
    // requestHeightField): the half-float grid is copied into a float target
    // (always readable) and read back asynchronously, never stalling a frame.
    this.field = null;
    this._readTarget = null;
    this._readPending = false;
    this._readQueued = null;
    this._copyMaterial = new THREE.ShaderMaterial({
      name: 'MiniLightMapCopy',
      uniforms: { uSource: { value: null } },
      vertexShader: BAKE_VERTEX,
      fragmentShader: COPY_FRAGMENT,
      depthTest: false,
      depthWrite: false,
    });
  }

  /**
   * Read the current vertex-height grid back to the CPU. Resolves into
   * `this.field` = { revision, n, half, heights: Float32Array(n * n) } with
   * heights[j * n + i] = world height of the vertex at
   * (x, z) = (-half + i * step, -half + j * step), step = 2 * half / (n - 1).
   * One read in flight at a time; a newer request replaces a queued one.
   * `onReady(field)` runs when the data lands.
   */
  requestHeightField(renderer, revision, heightScale, onReady) {
    if (!renderer || !this.grid || !renderer.readRenderTargetPixelsAsync) return;
    const request = { revision, heightScale, half: this._heightUniforms.uHalf.value, onReady };
    if (this._readPending) {
      this._readQueued = request;
      return;
    }
    const n = this.grid.width;
    if (!this._readTarget || this._readTarget.width !== n) {
      this._readTarget?.dispose();
      this._readTarget = new THREE.WebGLRenderTarget(n, n, {
        type: THREE.FloatType,
        format: THREE.RGBAFormat,
        minFilter: THREE.NearestFilter,
        magFilter: THREE.NearestFilter,
        depthBuffer: false,
        stencilBuffer: false,
        generateMipmaps: false,
      });
      this._readTarget.texture.name = 'MiniHeightFieldReadback';
    }
    const target = this._readTarget;
    const previous = renderer.getRenderTarget();
    try {
      this._copyMaterial.uniforms.uSource.value = this.grid.texture;
      this._quad.material = this._copyMaterial;
      renderer.setRenderTarget(target);
      renderer.render(this.bakeScene, this.bakeCamera);
    } finally {
      this._quad.material = this.bakeMaterial;
      renderer.setRenderTarget(previous);
    }
    this._readPending = true;
    const rgba = new Float32Array(n * n * 4);
    renderer.readRenderTargetPixelsAsync(target, 0, 0, n, n, rgba)
      .then(() => {
        if (this._readTarget !== target) return;
        const heights = new Float32Array(n * n);
        for (let i = 0; i < heights.length; i++) heights[i] = rgba[i * 4 + 3] * request.heightScale;
        this.field = { revision: request.revision, n, half: request.half, heights };
        request.onReady?.(this.field);
      })
      .catch(() => {})
      .finally(() => {
        this._readPending = false;
        const next = this._readQueued;
        this._readQueued = null;
        if (next && this._readTarget === target) {
          this.requestHeightField(renderer, next.revision, next.heightScale, next.onReady);
        }
      });
  }

  get texture() {
    return this.ready ? this.target.texture : null;
  }

  setLayout({ half, segments }) {
    this._heightUniforms.uHalf.value = half;
    this.bakeMaterial.uniforms.uSoftness.value = Math.max(1.5, half * 0.006);
    if (segments && segments !== this._segments) {
      this._segments = segments;
      this.decal.geometry.dispose();
      this.decal.geometry = buildDecalGrid(segments);
      this.invalidate();
    }
  }

  /** The vertex-height grid render target ((segments + 1)^2, half float). */
  ensureGrid() {
    const n = this._segments + 1;
    if (!this.grid || this.grid.width !== n) {
      this.grid?.dispose();
      this.grid = new THREE.WebGLRenderTarget(n, n, {
        type: THREE.HalfFloatType,
        format: THREE.RGBAFormat,
        minFilter: THREE.LinearFilter,
        magFilter: THREE.LinearFilter,
        depthBuffer: false,
        stencilBuffer: false,
        generateMipmaps: false,
      });
      this.grid.texture.colorSpace = THREE.NoColorSpace;
      this.grid.texture.name = 'MiniVertexHeightGrid';
      this._heightUniforms.uMiniHeightGrid.value = this.grid.texture;
      this.ready = false;
      this._key = '';
    }
    this._heightUniforms.uMiniGridSegments.value = this._segments;
    return this.grid;
  }

  /** Whether the published bake was made for `key`. */
  isCurrent(key) {
    return this.ready && this._key === key;
  }

  /**
   * Re-bake when the key (terrain generation, height program, sun, footprint)
   * changed. `renderHeights(gridTarget)` fills the vertex-height grid and
   * returns false when no height program is available (nothing is changed).
   * Returns true when a bake was rendered this call.
   */
  update(renderer, key, sunDir, renderHeights) {
    if (!renderer || !renderHeights) return false;
    if (key === this._key && this.ready) return false;
    const grid = this.ensureGrid();
    if (!renderHeights(grid)) return false;
    this._key = key;
    this.bakeMaterial.uniforms.uSunDir.value.copy(sunDir);
    const previous = renderer.getRenderTarget();
    const autoClear = renderer.autoClear;
    try {
      renderer.autoClear = true;
      renderer.setRenderTarget(this.target);
      renderer.render(this.bakeScene, this.bakeCamera);
    } finally {
      renderer.setRenderTarget(previous);
      renderer.autoClear = autoClear;
    }
    this.ready = true;
    return true;
  }

  invalidate() {
    this._key = '';
  }

  get materials() {
    return [this.bakeMaterial, this.decalMaterial, this._copyMaterial];
  }

  dispose() {
    this.decal.removeFromParent();
    this.decal.geometry.dispose();
    this._quad.geometry.dispose();
    this.bakeMaterial.dispose();
    this.decalMaterial.dispose();
    this.target.dispose();
    this.grid?.dispose();
    this.grid = null;
    this._readTarget?.dispose();
    this._readTarget = null;
    this.field = null;
    this._copyMaterial.dispose();
  }
}
