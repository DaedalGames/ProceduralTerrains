import * as THREE from 'three';
import { WIND_VERT_BODY } from './windGLSL.js';

// ============================================================================
// PropModels — the built-in procedural prop library (every world mode).
//
// Simplified OPAQUE volumes instead of alpha cards: they keep a readable
// silhouette from a close-up to a diorama overview and never turn into dark
// spikes. Every model is unit-sized (height ≈ 1, rooted at y = 0) so the
// catalogue's metre ranges and the asset library's scale/width/height keep
// their meaning. Vertex attributes:
//   color    — baked albedo multiplier / ambient occlusion (white = tinted),
//   aTintMix — 1: takes the instance tint (foliage, rock, flower heads),
//              0: fixed colour (trunks, flower stems),
//   aBend    — 0 at the root → 1 at the tip, drives the shared wind sway.
//
// One lit material (createPropLitMaterial) shades them with the SAME light
// model as the terrain (sun colour/intensity, sky ambient, ground bounce,
// fog), so props sit in the scene under every palette and time of day.
// ============================================================================

const smoothstep = (a, b, x) => {
  const t = Math.min(1, Math.max(0, (x - a) / (b - a)));
  return t * t * (3 - 2 * t);
};
const srgbToLinear = (c) => (c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4);
const hexLinear = (h) => [0, 2, 4].map((i) => srgbToLinear(parseInt(h.slice(i, i + 2), 16) / 255));

const TRUNK = hexLinear('6b5440');
const STEM = hexLinear('5f8a3c');

class PropBuilder {
  constructor() {
    this.position = [];
    this.normal = [];
    this.color = [];
    this.tintMix = [];
    this.bend = [];
  }

  // Append a (possibly indexed) geometry. `shade(x,y,z)` returns the baked
  // occlusion, `bend(x,y,z)` the wind weight.
  add(geometry, { color = [1, 1, 1], tintMix = 1, shade = null, bend = null }) {
    const g = geometry.index ? geometry.toNonIndexed() : geometry;
    if (!g.getAttribute('normal')) g.computeVertexNormals();
    const pos = g.getAttribute('position');
    const nor = g.getAttribute('normal');
    for (let i = 0; i < pos.count; i++) {
      const x = pos.getX(i); const y = pos.getY(i); const z = pos.getZ(i);
      this.position.push(x, y, z);
      this.normal.push(nor.getX(i), nor.getY(i), nor.getZ(i));
      const ao = shade ? shade(x, y, z) : 1;
      this.color.push(color[0] * ao, color[1] * ao, color[2] * ao);
      this.tintMix.push(tintMix);
      this.bend.push(bend ? bend(x, y, z) : 0);
    }
    if (g !== geometry) g.dispose();
    geometry.dispose();
  }

  // Raw triangle with an explicit (shared) normal — used for grass blades.
  triangle(a, b, c, n, { color, tintMix = 1, bends }) {
    for (const [i, p] of [a, b, c].entries()) {
      this.position.push(p[0], p[1], p[2]);
      this.normal.push(n[0], n[1], n[2]);
      const k = color[i] ?? color;
      this.color.push(k[0], k[1], k[2]);
      this.tintMix.push(tintMix);
      this.bend.push(bends[i]);
    }
  }

  finish(name, { normalizeHeight = null } = {}) {
    if (normalizeHeight) {
      let top = 0;
      for (let i = 1; i < this.position.length; i += 3) top = Math.max(top, this.position[i]);
      const k = top > 0 ? normalizeHeight / top : 1;
      for (let i = 0; i < this.position.length; i++) this.position[i] *= k;
    }
    const geo = new THREE.BufferGeometry();
    geo.name = name;
    geo.setAttribute('position', new THREE.Float32BufferAttribute(this.position, 3));
    geo.setAttribute('normal', new THREE.Float32BufferAttribute(this.normal, 3));
    geo.setAttribute('color', new THREE.Float32BufferAttribute(this.color, 3));
    geo.setAttribute('aTintMix', new THREE.Float32BufferAttribute(this.tintMix, 1));
    geo.setAttribute('aBend', new THREE.Float32BufferAttribute(this.bend, 1));
    geo.computeBoundingSphere();
    return geo;
  }
}

// Lumpy foliage lobe: icosphere with low-frequency bumps.
function lobe(radius, cx, cy, cz, squash, phase, detail) {
  const geo = new THREE.IcosahedronGeometry(1, detail);
  const pos = geo.getAttribute('position');
  for (let i = 0; i < pos.count; i++) {
    const x = pos.getX(i); const y = pos.getY(i); const z = pos.getZ(i);
    const bump = 1 + 0.11 * Math.sin(x * 4.3 + z * 3.1 + phase)
      + 0.08 * Math.cos(y * 5.7 - x * 2.3 + phase * 1.7)
      + 0.05 * Math.sin(z * 7.9 + y * 3.3 - phase);
    pos.setXYZ(i, cx + x * radius * bump, cy + y * radius * bump * squash, cz + z * radius * bump);
  }
  geo.computeVertexNormals();
  return geo;
}

function trunk(height, bottom, top, segments) {
  const geo = new THREE.CylinderGeometry(top, bottom, height, segments, 1, true);
  geo.translate(0, height / 2, 0);
  return geo;
}

/** Broadleaf tree: trunk + crown cluster (near: 5 lobes, far: 3 low lobes). */
export function makeBroadleafGeometry({ far = false } = {}) {
  const b = new PropBuilder();
  const detail = 0;
  b.add(trunk(0.62, 0.085, 0.05, far ? 5 : 7), {
    color: TRUNK, tintMix: 0, bend: (x, y) => y * 0.15,
  });
  const lobes = far
    // overview LOD: a rounded crown (detail 1) and two light shoulders
    ? [lobe(0.48, 0, 0.96, 0, 0.88, 0.0, 1), lobe(0.34, 0.22, 0.86, 0.12, 0.9, 1.3, detail),
      lobe(0.32, -0.2, 0.9, -0.15, 0.9, 2.6, detail)]
    // crown + top in full detail, three lighter shoulders: < 240 triangles
    : [lobe(0.44, 0, 0.98, 0, 0.88, 0.0, 1), lobe(0.31, 0.30, 0.86, 0.06, 0.9, 1.3, 0),
      lobe(0.29, -0.17, 0.84, 0.27, 0.9, 2.6, 0), lobe(0.30, -0.13, 0.88, -0.29, 0.9, 3.9, 0),
      lobe(0.27, 0.05, 1.30, -0.02, 0.92, 5.2, 1)];
  // each lobe a slightly different value: the crown reads as leaf clumps
  const clump = [1, 0.9, 1.04, 0.94, 1.08];
  for (const [index, g] of lobes.entries()) {
    const value = clump[index % clump.length];
    b.add(g, {
      tintMix: 1,
      shade: (x, y, z) => {
        const under = 0.62 + 0.38 * smoothstep(0.55, 1.35, y);
        const core = Math.hypot(x, y - 0.98, z);
        return value * under * (0.82 + 0.18 * smoothstep(0.15, 0.55, core));
      },
      bend: (x, y) => 0.25 + 0.75 * smoothstep(0.5, 1.5, y),
    });
  }
  return b.finish(far ? 'prop-broadleaf-far' : 'prop-broadleaf', { normalizeHeight: 1 });
}

/**
 * Conifer: a slender spire of overlapping branch whorls. Each whorl is a
 * shallow cone whose rim alternates long drooping branch tips and short
 * notches, rotated by the golden angle so the branches never line up; the
 * middle ring bulges slightly so whorls read full rather than as lampshades.
 */
export function makeConiferGeometry({ far = false } = {}) {
  const b = new PropBuilder();
  b.add(trunk(0.3, 0.06, 0.035, far ? 5 : 7), { color: TRUNK, tintMix: 0, bend: (x, y) => y * 0.1 });
  const count = far ? 4 : 6;
  const radial = far ? 8 : 10;   // even: tips and notches alternate all round
  const rand = seeded(far ? 41 : 17);
  for (let k = 0; k < count; k++) {
    const t = k / (count - 1);
    const r = (0.44 - 0.3 * t) * (0.94 + rand() * 0.12);
    const h = 0.4 - 0.12 * t;
    const base = 0.16 + t * 0.8;
    const cone = new THREE.ConeGeometry(r, h, radial, far ? 1 : 2, true);
    const pos = cone.getAttribute('position');
    for (let i = 0; i < pos.count; i++) {
      const x = pos.getX(i); const y = pos.getY(i); const z = pos.getZ(i);
      const radius = Math.hypot(x, z);
      if (radius < 1e-5) continue;
      const a = Math.atan2(z, x);
      const rim = y < -h * 0.49 ? 1 : 0;
      const mid = !rim && y < h * 0.4 ? 1 : 0;
      const seg = Math.round(((a + Math.PI) / (Math.PI * 2)) * radial);
      const tip = seg % 2 === 0;
      const spread = rim ? (tip ? 1.3 : 0.8) : mid ? 1.1 : 1;
      const wobble = 1 + 0.07 * Math.sin(a * 3 + k * 1.9);
      const droop = rim ? (tip ? -0.07 : 0.035) : 0;
      pos.setXYZ(i, x * spread * wobble, y + droop, z * spread * wobble);
    }
    cone.rotateY(k * 2.39996);
    cone.computeVertexNormals();
    cone.translate(0, base + h * 0.5, 0);
    const top = 0.9 + 0.1 * t;
    b.add(cone, {
      tintMix: 1,
      // shaded under each whorl, sunlit branch tips, lighter toward the crown
      shade: (x, y, z) => top * (0.6 + 0.4 * smoothstep(base, base + h * 0.8, y))
        * (0.93 + 0.07 * smoothstep(0.05, 0.35, Math.hypot(x, z))),
      bend: (x, y) => 0.2 + 0.8 * smoothstep(0.3, 1.3, y),
    });
  }
  // leader shoot at the crown
  const leader = new THREE.ConeGeometry(0.035, 0.16, far ? 3 : 4, 1, true);
  leader.translate(0, 1.32, 0);
  b.add(leader, { tintMix: 1, shade: () => 1, bend: () => 1 });
  return b.finish(far ? 'prop-conifer-far' : 'prop-conifer', { normalizeHeight: 1 });
}

/** Faceted, slightly flattened boulder with carved facets. */
export function makeRockGeometry({ far = false } = {}) {
  const b = new PropBuilder();
  const geo = new THREE.IcosahedronGeometry(1, far ? 0 : 1);
  const pos = geo.getAttribute('position');
  for (let i = 0; i < pos.count; i++) {
    const x = pos.getX(i); const y = pos.getY(i); const z = pos.getZ(i);
    const warp = 0.82 + 0.16 * Math.sin(x * 3.1 + z * 2.3) + 0.1 * Math.cos(y * 4.2 - x * 1.7);
    pos.setXYZ(i, x * warp, Math.max(-0.3, y * 0.7 * warp) + 0.3, z * warp * 0.92);
  }
  const flat = geo.index ? geo.toNonIndexed() : geo;
  if (flat !== geo) geo.dispose();
  flat.computeVertexNormals();   // faceted
  b.add(flat, {
    tintMix: 1,
    shade: (x, y, z) => (0.72 + 0.28 * smoothstep(0.0, 0.85, y))
      * (0.9 + 0.1 * Math.sin(x * 9.1 + z * 6.3)),
  });
  return b.finish(far ? 'prop-rock-far' : 'prop-rock');
}

// Deterministic pseudo-random for authored geometry (no Math.random).
function seeded(seed) {
  let s = seed >>> 0;
  return () => {
    s = (Math.imul(s ^ (s >>> 15), 0x2c1b3c6d) + 0x9e3779b9) >>> 0;
    return ((s ^ (s >>> 13)) >>> 0) / 4294967296;
  };
}

function addBlades(b, count, { seed, height = 1, spread = 0.42, width = 0.07, tintMix = 1, color = null, lean = 0.35 }) {
  const rand = seeded(seed);
  for (let i = 0; i < count; i++) {
    const a = rand() * Math.PI * 2;
    const r = Math.sqrt(rand()) * spread;
    const bx = Math.cos(a) * r; const bz = Math.sin(a) * r;
    const h = height * (0.55 + rand() * 0.45);
    const face = rand() * Math.PI * 2;
    const leanA = a + (rand() - 0.5) * 0.8;
    const lx = Math.cos(leanA) * lean * h; const lz = Math.sin(leanA) * lean * h;
    const w = width * (0.7 + rand() * 0.6);
    const px = Math.cos(face) * w; const pz = Math.sin(face) * w;
    const tip = [bx + lx, h, bz + lz];
    // normal leans up so thin blades never read black from behind
    const nx = -Math.sin(face) * 0.45; const nz = Math.cos(face) * 0.45;
    const nl = Math.hypot(nx, 1, nz);
    const n = [nx / nl, 1 / nl, nz / nl];
    const baseC = color ? color.map((c) => c * 0.55) : [0.55, 0.55, 0.55];
    const tipC = color ? color.map((c) => c * 1.05) : [1.05, 1.05, 1.05];
    b.triangle([bx - px, 0, bz - pz], [bx + px, 0, bz + pz], tip, n, {
      color: [baseC, baseC, tipC], tintMix, bends: [0, 0, 1],
    });
  }
}

/** Grass tuft: tapered blades leaning out, darker at the root. */
export function makeGrassGeometry({ far = false } = {}) {
  const b = new PropBuilder();
  addBlades(b, far ? 7 : 14, { seed: far ? 7 : 11, height: 1, spread: 0.45, width: far ? 0.1 : 0.07 });
  return b.finish(far ? 'prop-grass-far' : 'prop-grass');
}

/** Wildflowers: green stems + small tinted blossoms. */
export function makeFlowerGeometry() {
  const b = new PropBuilder();
  addBlades(b, 8, { seed: 23, height: 0.7, spread: 0.32, width: 0.05, tintMix: 0, color: STEM });
  const rand = seeded(91);
  for (let i = 0; i < 5; i++) {
    const a = rand() * Math.PI * 2;
    const r = Math.sqrt(rand()) * 0.3;
    const y = 0.62 + rand() * 0.38;
    const head = new THREE.IcosahedronGeometry(0.085 + rand() * 0.04, 0);
    head.scale(1, 0.6, 1);
    head.translate(Math.cos(a) * r, y, Math.sin(a) * r);
    const flat = head.index ? head.toNonIndexed() : head;
    if (flat !== head) head.dispose();
    flat.computeVertexNormals();
    b.add(flat, { tintMix: 1, shade: () => 1, bend: () => 1 });
    const stem = new THREE.CylinderGeometry(0.008, 0.012, y, 3, 1, true);
    stem.translate(Math.cos(a) * r, y / 2, Math.sin(a) * r);
    b.add(stem, { color: STEM, tintMix: 0, bend: (x, yy) => yy / y });
  }
  return b.finish('prop-flowers');
}

// ---------------------------------------------------------------------------
// Material
// ---------------------------------------------------------------------------

const VERTEX = /* glsl */ `
attribute float aBend;
attribute float aTintMix;
uniform float uTime;
uniform vec2  uWindDir;
uniform float uWindStrength;
uniform float uWindSpeed;
uniform float uGustScale;
uniform float uGustIntensity;
uniform float uWindStrengthMul;
// Mini diorama live ground: instances are placed relative to the ground and
// stand on the live terrain height under their root (light map B), so they
// follow every relief edit in the frame it is drawn
uniform sampler2D uMiniLightTex;
uniform float uMiniHalf;
uniform float uMiniGroundShift;
uniform float uMiniTerrainBevel;
uniform float uMiniBevelRounded;
uniform float uMiniHexagon;
uniform float uBoardHalf;
varying vec3 vNormalW;
varying vec3 vWorldPos;
varying vec3 vAlbedo;
varying float vTinted;

void main() {
  vec3 transformed = position;
${WIND_VERT_BODY}
  vec4 local = vec4(transformed, 1.0);
  mat3 normalBasis = mat3(modelMatrix);
  #ifdef USE_INSTANCING
    local = instanceMatrix * local;
    normalBasis = normalBasis * mat3(instanceMatrix);
  #endif
  vec4 wp = modelMatrix * local;
  #ifdef USE_INSTANCING
    if (uMiniGroundShift > 0.5) {
      vec3 root = (modelMatrix * instanceMatrix * vec4(0.0, 0.0, 0.0, 1.0)).xyz;
      vec2 groundUv = clamp(root.xz / (uMiniHalf * 2.0) + 0.5, 0.0, 1.0);
      wp.y += textureLod(uMiniLightTex, groundUv, 0.0).b;
    }
  #endif
  vWorldPos = wp.xyz;
  vNormalW = normalize(normalBasis * normal);
  vec3 tint = vec3(1.0);
  #ifdef USE_INSTANCING_COLOR
    // instance tints are display-space albedo
    tint = pow(max(instanceColor, vec3(0.0)), vec3(2.2));
  #endif
  vec3 base = vec3(1.0);
  #ifdef USE_COLOR
    base = color;
  #endif
  vAlbedo = base * mix(vec3(1.0), tint, aTintMix);
  vTinted = aTintMix;
  gl_Position = projectionMatrix * viewMatrix * wp;
  #ifdef USE_INSTANCING
    vec3 miniRoot = (modelMatrix * instanceMatrix * vec4(0.0, 0.0, 0.0, 1.0)).xyz;
    vec2 corner = max(abs(miniRoot.xz) - (uBoardHalf - uMiniTerrainBevel), 0.0);
    bool outsideMini = uMiniBevelRounded > 0.5 ? length(corner) > uMiniTerrainBevel
      : abs(miniRoot.x) + abs(miniRoot.z) > 2.0 * uBoardHalf - uMiniTerrainBevel;
    if (uMiniHexagon > 0.5) {
      vec2 q = abs(miniRoot.xz);
      outsideMini = max(q.x, dot(q, vec2(0.5, 0.866025404))) > uBoardHalf * 0.866025404;
    }
    if ((uMiniTerrainBevel > 0.0 || uMiniHexagon > 0.5) && outsideMini) {
      gl_Position = vec4(2.0, 2.0, 2.0, 1.0);
    }
  #endif
}
`;

const FRAGMENT = /* glsl */ `
precision highp float;
uniform vec3 uSunDir;
uniform vec3 uTerrainSunCol;
uniform float uTerrainSunIntensity;
uniform vec3 uTerrainSkyAmb;
uniform vec3 uTerrainBounce;
uniform vec3 uFogColor;
uniform float uFogDensity;
uniform float uFoliage;          // 1 = leaves (wrap + back light), 0 = rock
uniform sampler2D uMiniLightTex; // optional Mini diorama sun visibility / AO
uniform float uMiniLightEnabled;
uniform float uMiniHalf;
uniform vec3 uPropFadeCenter;
uniform vec4 uPropFadeRanges;
varying vec3 vNormalW;
varying vec3 vWorldPos;
varying vec3 vAlbedo;
varying float vTinted;

float propDither(vec2 p) {
  return fract(52.9829189 * fract(dot(floor(p), vec2(0.06711056, 0.00583715))));
}

void main() {
  float propDistance = distance(vWorldPos, uPropFadeCenter);
  float fadeIn = uPropFadeRanges.y <= 0.0 ? 1.0 : smoothstep(uPropFadeRanges.x, uPropFadeRanges.y, propDistance);
  float fadeOut = 1.0 - smoothstep(uPropFadeRanges.z, uPropFadeRanges.w, propDistance);
  if (propDither(gl_FragCoord.xy) > fadeIn * fadeOut) discard;

  vec3 n = normalize(vNormalW);
  if (!gl_FrontFacing) n = -n;
  vec3 l = normalize(uSunDir);
  vec3 v = normalize(cameraPosition - vWorldPos);
  vec2 light = vec2(1.0);
  if (uMiniLightEnabled > 0.5) {
    vec2 uv = vWorldPos.xz / (uMiniHalf * 2.0) + 0.5;
    light = texture2D(uMiniLightTex, clamp(uv, 0.0, 1.0)).rg;
  }
  float sunVis = mix(0.3, 1.0, light.r);
  float leaf = uFoliage * vTinted;
  float wrapAmount = mix(0.12, 0.45, leaf);
  float diffuse = clamp((dot(n, l) + wrapAmount) / (1.0 + wrapAmount), 0.0, 1.0);
  diffuse *= diffuse;
  vec3 sunCol = uTerrainSunCol * uTerrainSunIntensity * sunVis;
  // same split as the terrain: sun + hemispheric sky + ground bounce
  vec3 sky = uTerrainSkyAmb * 0.5 * (n.y * 0.5 + 0.5);
  vec3 bounce = uTerrainBounce * 0.25 * (1.0 - n.y * 0.5);
  vec3 col = vAlbedo * (sunCol * diffuse + (sky + bounce) * 1.25 * mix(0.7, 1.0, light.g));
  // light through thin leaves at the silhouette
  float back = pow(clamp(dot(-l, v), 0.0, 1.0), 4.0) * pow(1.0 - abs(dot(n, v)), 2.0) * leaf;
  col += vAlbedo * vec3(0.9, 1.0, 0.6) * back * 0.35 * sunVis;
  // a faint sheen on stone
  vec3 h = normalize(l + v);
  col += vec3(0.9) * pow(max(dot(n, h), 0.0), 40.0) * 0.04 * (1.0 - uFoliage) * sunVis;

  float dist = length(cameraPosition - vWorldPos);
  float fogF = 1.0 - exp(-uFogDensity * uFogDensity * dist * dist);
  col = mix(col, uFogColor, clamp(fogF, 0.0, 1.0));
  gl_FragColor = vec4(pow(max(col, vec3(0.0)), vec3(1.0 / 2.2)), 1.0);
}
`;

const FALLBACK_LIGHT = () => ({
  uSunDir: { value: new THREE.Vector3(0.45, 0.8, 0.35).normalize() },
  uTerrainSunCol: { value: new THREE.Vector3(1.0, 0.95, 0.86) },
  uTerrainSunIntensity: { value: 1.1 },
  uTerrainSkyAmb: { value: new THREE.Vector3(0.62, 0.7, 0.82) },
  uTerrainBounce: { value: new THREE.Vector3(0.34, 0.3, 0.24) },
  uFogColor: { value: new THREE.Color(0xcfd6dc) },
  uFogDensity: { value: 0 },
});

/**
 * Lit prop material. `shared` = the engine's terrain uniforms (lighting and
 * fog are shared by reference); without it (asset previews) a neutral studio
 * light is used. `wind` = createWindUniforms() block (optional).
 */
export function createPropLitMaterial({ shared = null, wind = null, windStrengthMul = 1, foliage = true, name = 'prop-lit', miniLight = null } = {}) {
  const fallback = FALLBACK_LIGHT();
  const pick = (key) => shared?.[key] ?? fallback[key];
  const fade = {
    center: { value: new THREE.Vector3() },
    ranges: { value: new THREE.Vector4(0, 0, 1e6, 1e6 + 1) },
    groundShift: { value: 0 },
  };
  const material = new THREE.ShaderMaterial({
    name,
    uniforms: {
      uSunDir: pick('uSunDir'),
      uTerrainSunCol: pick('uTerrainSunCol'),
      uTerrainSunIntensity: pick('uTerrainSunIntensity'),
      uTerrainSkyAmb: pick('uTerrainSkyAmb'),
      uTerrainBounce: pick('uTerrainBounce'),
      uFogColor: pick('uFogColor'),
      uFogDensity: pick('uFogDensity'),
      uFoliage: { value: foliage ? 1 : 0 },
      uMiniLightTex: miniLight?.tex ?? { value: null },
      uMiniLightEnabled: miniLight?.enabled ?? { value: 0 },
      uMiniHalf: miniLight?.half ?? { value: 512 },
      uMiniGroundShift: fade.groundShift,
      uMiniTerrainBevel: shared?.uMiniTerrainBevel ?? { value: 0 },
      uMiniBevelRounded: shared?.uMiniBevelRounded ?? { value: 0 },
      uMiniHexagon: shared?.uMiniHexagon ?? { value: 0 },
      uBoardHalf: shared?.uBoardHalf ?? { value: 512 },
      uPropFadeCenter: fade.center,
      uPropFadeRanges: fade.ranges,
      uTime: wind?.uTime ?? { value: 0 },
      uWindDir: wind?.uWindDir ?? { value: new THREE.Vector2(1, 0) },
      uWindStrength: wind?.uWindStrength ?? { value: 0 },
      uWindSpeed: wind?.uWindSpeed ?? { value: 1 },
      uGustScale: wind?.uGustScale ?? { value: 0.01 },
      uGustIntensity: wind?.uGustIntensity ?? { value: 0 },
      uWindStrengthMul: { value: windStrengthMul },
    },
    vertexShader: VERTEX,
    fragmentShader: FRAGMENT,
    vertexColors: true,
    side: THREE.DoubleSide,
  });
  material.userData.propFadeUniforms = fade;
  return material;
}
