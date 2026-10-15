import * as THREE from 'three';

// ============================================================================
// MiniLightMap — soft sun shadows and ambient occlusion for the diorama.
//
// The engine has no shadow maps and the terrain is displaced in its vertex
// shader, so instead of touching every terrain program (and its 16-sampler
// budget) the Mini presentation:
//   1. BAKES a small light map over the footprint on the GPU, from the very
//      height bake the terrain already samples (uTerrainHeightTex):
//        R = sun visibility (height-field ray march toward the sun, soft
//            penumbra growing with distance to the occluder),
//        G = ambient occlusion (8-direction horizon estimate),
//        B = terrain height (world units, filtered: smooth water depth);
//   2. APPLIES it with a decal mesh that follows the same height bake, drawn
//      right after the terrain with multiplicative blending (dst × factor), so
//      it darkens terrain only (props and water are separate objects).
// The water shader samples the same map for cliff shadows on the surface.
//
// Re-baked only when the terrain field, the sun direction or the footprint
// change. Static loop bounds, masks instead of break — ANGLE/FXC friendly.
// ============================================================================

const BAKE_VERTEX = /* glsl */ `
varying vec2 vUv;
void main() {
  vUv = uv;
  gl_Position = vec4(position.xy, 0.0, 1.0);
}
`;

const HEIGHT_FETCH = /* glsl */ `
uniform sampler2D uTerrainHeightTex;
uniform vec2 uBakeOrigin;
uniform vec2 uBakeSpan;
uniform float uHeightScale;
float miniBakedHeight(vec2 xz) {
  vec2 uv = (xz - uBakeOrigin) / max(uBakeSpan, vec2(1.0));
  return textureLod(uTerrainHeightTex, clamp(uv, 0.0, 1.0), 0.0).a * uHeightScale;
}
`;

const BAKE_FRAGMENT = /* glsl */ `
precision highp float;
${HEIGHT_FETCH}
uniform vec3 uSunDir;
uniform float uHalf;
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
    float inside = step(abs(q.x), uHalf) * step(abs(q.y), uHalf);
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
uniform float uHalf;
varying vec2 vXZ;
void main() {
  vec2 xz = position.xz * uHalf;
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

    const heightUniforms = {
      uTerrainHeightTex: sharedUniforms.uTerrainHeightTex,
      uBakeOrigin: sharedUniforms.uBakeOrigin,
      uBakeSpan: sharedUniforms.uBakeSpan,
      uHeightScale: sharedUniforms.uHeightScale,
    };
    this.bakeMaterial = new THREE.ShaderMaterial({
      name: 'MiniLightMapBake',
      uniforms: {
        ...heightUniforms,
        uSunDir: { value: new THREE.Vector3(0.5, 0.7, 0.3) },
        uHalf: { value: 512 },
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
        uHalf: { value: 512 },
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
  }

  get texture() {
    return this.ready ? this.target.texture : null;
  }

  setLayout({ half, segments }) {
    this.bakeMaterial.uniforms.uHalf.value = half;
    this.decalMaterial.uniforms.uHalf.value = half;
    this.bakeMaterial.uniforms.uSoftness.value = Math.max(1.5, half * 0.006);
    if (segments && segments !== this._segments) {
      this._segments = segments;
      this.decal.geometry.dispose();
      this.decal.geometry = buildDecalGrid(segments);
    }
  }

  /**
   * Re-bake when the key (terrain generation, sun, footprint) changed.
   * Returns true when a bake was rendered this call.
   */
  update(renderer, key, sunDir) {
    if (!renderer || !this.shared.uTerrainHeightTex?.value) {
      this.ready = false;
      return false;
    }
    if (key === this._key && this.ready) return false;
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
    return [this.bakeMaterial, this.decalMaterial];
  }

  dispose() {
    this.decal.removeFromParent();
    this.decal.geometry.dispose();
    this._quad.geometry.dispose();
    this.bakeMaterial.dispose();
    this.decalMaterial.dispose();
    this.target.dispose();
  }
}
