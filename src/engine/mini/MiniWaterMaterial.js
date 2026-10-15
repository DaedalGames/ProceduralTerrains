import * as THREE from 'three';

// ============================================================================
// Mini Terrain water — a dedicated stylised water for the diorama.
//
// One colour model shared by the SURFACE and the CUT FACES so the edge of the
// volume reads as the same water seen from two sides:
//   * the seen background (water-free scene capture: colour + depth) is
//     refracted, lit by caustics where it is submerged and sunlit, then
//     absorbed along the real optical path (Beer–Lambert, red first);
//   * the in-scattered body colour depends on the depth of water above the
//     point that is seen (pale turquoise shallows → teal → deep blue);
//   * the surface adds a soft studio reflection (Fresnel), a restrained sun
//     glint (never burned), cliff shadows from the Mini light map and a thin
//     animated shore foam;
//   * the cut faces add only a crisp glass edge at the waterline and corners.
//
// Short, moderate waves sized to the diorama live in the normals only; the
// surface stays flat at the water level so it always meets the cut faces.
// All per-pixel sums are written out (no loops) for ANGLE/FXC.
// Without a scene capture (should not happen in Mini, which always runs a
// capture-capable backend) the material falls back to premultiplied alpha.
//
// The same surface also serves the "Stylized" water mode of the classic
// worlds (Tile / Infinite, see water/StylizedWaterLayer.js): unbounded
// (uMiniHalf huge), reflecting the procedural sky instead of the studio
// backdrop, fogged like the terrain, and reading the water depth from the
// studio height bake when one is current (else from the captured scene).
// ============================================================================

export const MINI_WATER_COMMON_GLSL = /* glsl */ `
uniform vec3 uSunDir;
uniform float uSeaLevel;
uniform float uTime;

uniform vec3 uMiniWaterShallow;
uniform vec3 uMiniWaterMid;
uniform vec3 uMiniWaterDeep;
uniform vec3 uMiniWaterSide;
uniform vec3 uMiniWaterAbsorb;    // per-channel absorption per world unit
uniform float uMiniWaterDepthRange;
uniform float uMiniWaterAnim;     // animated time (seconds * speed, 0 when paused)
uniform float uMiniHalf;
uniform float uMiniCaustics;

uniform sampler2D uMiniLightTex;  // R = sun visibility, G = AO, B = terrain height
uniform float uMiniLightEnabled;

uniform sampler2D uSceneColor;
uniform sampler2D uSceneDepth;
uniform vec2 uSceneViewportInv;
uniform float uSceneNear;
uniform float uSceneFar;
uniform float uSceneRefractionEnabled;

float miniLinearDepth(float rawDepth) {
  float z = rawDepth * 2.0 - 1.0;
  return (2.0 * uSceneNear * uSceneFar)
    / max(uSceneFar + uSceneNear - z * (uSceneFar - uSceneNear), 0.0001);
}

// Distance from the camera to the opaque scene along this pixel's ray.
float miniSceneDistance(vec2 uv, vec3 rayDir) {
  vec3 camForward = -vec3(viewMatrix[0][2], viewMatrix[1][2], viewMatrix[2][2]);
  float cosA = max(dot(rayDir, camForward), 1e-3);
  return miniLinearDepth(texture2D(uSceneDepth, uv).r) / cosA;
}

vec3 miniSceneColor(vec2 uv) {
  return pow(max(texture2D(uSceneColor, uv).rgb, vec3(0.0)), vec3(2.2));
}

vec3 miniLight(vec2 xz) {
  if (uMiniLightEnabled < 0.5) return vec3(1.0, 1.0, uSeaLevel - 30.0);
  vec2 uv = xz / max(uMiniHalf * 2.0, 1.0) + 0.5;
  return texture2D(uMiniLightTex, clamp(uv, 0.0, 1.0)).rgb;
}

// Body colour for a column of water of the given depth.
vec3 miniWaterBody(float depth) {
  float r = max(uMiniWaterDepthRange, 1.0);
  vec3 c = mix(uMiniWaterShallow, uMiniWaterMid, smoothstep(0.0, r * 0.35, depth));
  return mix(c, uMiniWaterDeep, smoothstep(r * 0.25, r, depth));
}

float miniCausticLayer(vec2 p, float t) {
  vec2 w = p + 0.55 * vec2(sin(p.y * 1.7 + t), sin(p.x * 1.3 - t * 0.8));
  float v = sin(w.x * 2.2) * sin(w.y * 2.2);
  float line = 1.0 - abs(v);
  return line * line * line * line * line * line;
}

float miniCaustic(vec2 xz, float t) {
  float a = miniCausticLayer(xz * 0.075, t * 0.9);
  float b = miniCausticLayer(xz * 0.11 + vec2(3.1, 1.7), -t * 0.75);
  return min(a, b) * 0.9 + max(a, b) * 0.08;
}
`;

const SURFACE_VERTEX = /* glsl */ `
varying vec3 vWorldPos;
void main() {
  vec4 wp = modelMatrix * vec4(position, 1.0);
  vWorldPos = wp.xyz;
  gl_Position = projectionMatrix * viewMatrix * wp;
}
`;

const SURFACE_FRAGMENT = /* glsl */ `
precision highp float;
${MINI_WATER_COMMON_GLSL}
uniform float uMiniRefraction;
uniform float uMiniWaveStrength;
uniform float uMiniFoamWidth;
uniform float uMiniReflect;
uniform float uMiniWaveScale;
// environment: 0 = studio backdrop (Mini), 1 = procedural sky colours
uniform float uMiniEnvSky;
uniform vec3 uSkyZenith;
uniform vec3 uSkyHorizon;
uniform vec3 uFogColor;
uniform float uFogDensity;
// depth source when no Mini light map: the studio height bake (if current)
uniform sampler2D uTerrainHeightTex;
uniform float uUseTerrainHeightTex;
uniform float uMiniBakeDepth;
uniform vec2 uBakeOrigin;
uniform vec2 uBakeSpan;
uniform float uHeightScale;
// Infinite World: the plane ends at the terrain render distance
uniform float uWaterFadeStart;
uniform float uWaterFadeEnd;
varying vec3 vWorldPos;

float miniHash(vec2 p) {
  vec3 p3 = fract(vec3(p.xyx) * 0.1031);
  p3 += dot(p3, p3.yzx + 33.33);
  return fract((p3.x + p3.y) * p3.z);
}

vec2 miniGradDir(vec2 i) {
  float a = miniHash(i) * 6.2831853;
  return vec2(cos(a), sin(a));
}

// Gradient noise with analytic derivatives: x = value, yz = d/dx, d/dy.
// Unlike value noise it has no axis-aligned cell plateaus, so the ripples
// never read as a grid.
vec3 miniGradNoise(vec2 p) {
  vec2 i = floor(p);
  vec2 f = fract(p);
  vec2 u = f * f * f * (f * (f * 6.0 - 15.0) + 10.0);
  vec2 du = 30.0 * f * f * (f * (f - 2.0) + 1.0);
  vec2 ga = miniGradDir(i);
  vec2 gb = miniGradDir(i + vec2(1.0, 0.0));
  vec2 gc = miniGradDir(i + vec2(0.0, 1.0));
  vec2 gd = miniGradDir(i + vec2(1.0, 1.0));
  float va = dot(ga, f);
  float vb = dot(gb, f - vec2(1.0, 0.0));
  float vc = dot(gc, f - vec2(0.0, 1.0));
  float vd = dot(gd, f - vec2(1.0, 1.0));
  float k = va - vb - vc + vd;
  float v = va + u.x * (vb - va) + u.y * (vc - va) + u.x * u.y * k;
  vec2 d = ga + u.x * (gb - ga) + u.y * (gc - ga) + u.x * u.y * (ga - gb - gc + gd)
         + du * (u.yx * k + vec2(vb, vc) - va);
  return vec3(v, d);
}

float miniNoise(vec2 p) {
  return miniGradNoise(p).x * 0.5 + 0.5;
}

// One trochoid-like wave band: sharp crests (exp(sin - 1)), deep-water
// dispersion (longer waves travel faster) and a band limit against the pixel
// footprint so distant water never aliases into a shimmering grid.
vec2 miniWaveBand(vec2 p, float angle, float len, float slope, float t, float footprint) {
  vec2 dir = vec2(cos(angle), sin(angle));
  float k = 6.2831853 / len;
  float phase = dot(p, dir) * k - t * sqrt(9.81 * k) * 0.55;
  float s = sin(phase);
  float limit = 1.0 - smoothstep(len * 0.12, len * 0.38, footprint);
  return dir * (exp(s - 1.0) * cos(phase) * slope * limit);
}

vec3 miniWaterNormal(vec2 p, float t, float footprint, float calm) {
  // slow domain warp bends every crest line: no straight, repeating rows
  vec3 w0 = miniGradNoise(p * 0.011 + vec2(t * 0.013, -t * 0.009));
  vec3 w1 = miniGradNoise(p * 0.011 + vec2(17.3, -4.1) - vec2(t * 0.011, t * 0.007));
  vec2 q = p + vec2(w0.x, w1.x) * 14.0;

  float wind = 0.62;
  vec2 s = vec2(0.0);
  s += miniWaveBand(q, wind - 0.92, 41.0, 0.050, t, footprint);
  s += miniWaveBand(q, wind + 0.58, 27.8, 0.055, t, footprint);
  s += miniWaveBand(q, wind - 0.27, 19.4, 0.060, t, footprint);
  s += miniWaveBand(q, wind + 1.13, 13.6, 0.055, t, footprint);
  s += miniWaveBand(q, wind + 0.09, 9.8, 0.060, t, footprint);
  s += miniWaveBand(q, wind - 1.41, 6.9, 0.050, t, footprint);
  s += miniWaveBand(q, wind + 0.37, 4.7, 0.045, t, footprint);

  // capillary ripples: two rotated, drifting gradient-noise octaves
  const mat2 ROT_A = mat2(0.80, -0.60, 0.60, 0.80);
  const mat2 ROT_B = mat2(-0.39, 0.92, -0.92, -0.39);
  vec2 r1p = ROT_A * (p * 0.21) + vec2(t * 0.21, t * 0.07);
  vec2 r2p = ROT_B * (p * 0.53) - vec2(t * 0.09, t * 0.33);
  // d/dp n(R p f) = f * transpose(R) * grad (row-vector product)
  vec2 r1 = (miniGradNoise(r1p).yz * ROT_A) * 0.21 * 0.20;
  vec2 r2 = (miniGradNoise(r2p).yz * ROT_B) * 0.53 * 0.07;
  r1 *= 1.0 - smoothstep(1.2, 3.2, footprint);
  r2 *= 1.0 - smoothstep(0.5, 1.4, footprint);
  s += (r1 + r2) * 1.2;

  s *= uMiniWaveStrength * calm * 1.7;
  return normalize(vec3(-s.x, 1.0, -s.y));
}

// Soft studio environment seen in reflections: warm bright horizon, pale
// blue zenith, slightly darker below the horizon. No HDR spikes.
vec3 miniEnvironment(vec3 dir) {
  vec3 horizon = mix(vec3(0.80, 0.81, 0.79), uSkyHorizon, uMiniEnvSky);
  vec3 zenith = mix(vec3(0.50, 0.66, 0.84), uSkyZenith, uMiniEnvSky);
  vec3 low = mix(vec3(0.55, 0.58, 0.58), uSkyHorizon * 0.7, uMiniEnvSky);
  vec3 c = mix(horizon, zenith, smoothstep(0.02, 0.75, dir.y));
  return mix(low, c, smoothstep(-0.25, 0.02, dir.y));
}

// Terrain height under a point from the studio bake, or -1e4 when unknown.
float miniBakedTerrain(vec2 xz) {
  if (uMiniBakeDepth < 0.5 || uUseTerrainHeightTex < 0.5) return -1e4;
  vec2 uv = (xz - uBakeOrigin) / max(uBakeSpan, vec2(1.0));
  if (uv.x < 0.0 || uv.y < 0.0 || uv.x > 1.0 || uv.y > 1.0) return -1e4;
  return texture2D(uTerrainHeightTex, uv).a * uHeightScale;
}

void main() {
  vec3 p = vWorldPos;
  if (abs(p.x) > uMiniHalf || abs(p.z) > uMiniHalf) discard;
  vec3 rayDir = normalize(p - cameraPosition);
  vec3 viewDir = -rayDir;
  float fragDist = length(p - cameraPosition);
  float t = uMiniWaterAnim;
  vec3 lightHere = miniLight(p.xz);
  float bakedHere = miniBakedTerrain(p.xz);
  float columnHere = uMiniLightEnabled > 0.5 ? max(uSeaLevel - lightHere.b, 0.0)
    : (bakedHere > -1e3 ? max(uSeaLevel - bakedHere, 0.0) : 20.0);
  // shallow, sheltered water is calmer; open water carries the full spectrum
  float calm = mix(0.45, 1.0, smoothstep(0.5, 9.0, columnHere));
  float footprint = length(fwidth(p.xz));
  float waveScale = max(uMiniWaveScale, 0.05);
  vec3 n = miniWaterNormal(p.xz / waveScale, t, footprint / waveScale, calm);
  if (dot(n, viewDir) < 0.0) n = -n;

  vec2 uv = gl_FragCoord.xy * uSceneViewportInv;
  vec2 screenUv = uv;
  float edgeFade = 1.0 - smoothstep(uWaterFadeStart, uWaterFadeEnd, length(cameraPosition.xz - p.xz));
  if (edgeFade < 0.002) discard;
  vec3 background = vec3(0.0);
  float sceneDist = fragDist + 60.0;
  float hasScene = step(0.5, uSceneRefractionEnabled);
  if (hasScene > 0.5) {
    sceneDist = miniSceneDistance(uv, rayDir);
    float thickness = clamp((sceneDist - fragDist) / 50.0, 0.0, 1.0);
    vec2 ruv = clamp(uv + n.xz * uMiniRefraction * thickness, vec2(0.002), vec2(0.998));
    float refractedDist = miniSceneDistance(ruv, rayDir);
    // never pull in something that is in front of the water surface
    if (refractedDist > fragDist + 0.5) {
      uv = ruv;
      sceneDist = refractedDist;
    }
    background = miniSceneColor(uv);
  }

  vec3 seabed = cameraPosition + rayDir * sceneDist;
  vec3 lightSurface = miniLight(p.xz);
  vec3 lightSeabed = miniLight(seabed.xz);
  // vertical water depth under this surface point, from the filtered height
  // in the light map: smooth, view independent (no capture-resolution steps)
  float seabedDepth = max(uSeaLevel - seabed.y, 0.0);
  // without a current light map, the captured seabed is the depth source
  float columnDepth = uMiniLightEnabled > 0.5 ? max(uSeaLevel - lightSurface.b, 0.0)
    : (bakedHere > -1e3 ? max(uSeaLevel - bakedHere, 0.0) : seabedDepth);
  // optical path: flat-bottom estimate from the column depth, shortened where
  // the captured scene is nearer (slopes, beaches, cliffs under the surface)
  float flatPath = columnDepth / max(-rayDir.y, 0.12);
  float path = min(flatPath, max(sceneDist - fragDist, 0.0) + 3.0);
  float sunUp = clamp(uSunDir.y * 1.3, 0.0, 1.0);

  // caustics on the sunlit, submerged seabed only (tinted, not white noise)
  float caustic = miniCaustic(seabed.xz, t) * uMiniCaustics
    * exp(-seabedDepth / 26.0) * smoothstep(0.6, 3.0, seabedDepth)
    * sunUp * lightSeabed.r;
  background *= 1.0 + caustic * vec3(0.85, 1.0, 0.95);

  vec3 transmittance = exp(-uMiniWaterAbsorb * path);
  vec3 body = miniWaterBody(columnDepth);
  float bodyLight = (0.62 + 0.5 * sunUp * mix(0.78, 1.0, lightSurface.r)) * mix(0.88, 1.0, lightSurface.g);
  vec3 col = background * transmittance + body * bodyLight * (vec3(1.0) - transmittance);

  // soft studio reflection + restrained sun glint
  float ndv = clamp(dot(n, viewDir), 0.0, 1.0);
  float fresnel = 0.02 + 0.98 * pow(1.0 - ndv, 5.0);
  col = mix(col, miniEnvironment(reflect(rayDir, n)), clamp(fresnel * uMiniReflect, 0.0, 0.85));
  vec3 halfDir = normalize(normalize(uSunDir) + viewDir);
  float nh = max(dot(n, halfDir), 0.0);
  float glint = pow(nh, 900.0) * 0.8 + pow(nh, 120.0) * 0.05;
  col += vec3(1.0, 0.96, 0.88) * glint * sunUp * lightSurface.r;

  // thin animated shore foam where the water column is very shallow
  float shore = 1.0 - smoothstep(0.0, uMiniFoamWidth, columnDepth);
  float breakup = miniNoise(p.xz * 0.31 + vec2(t * 0.5, t * 0.3)) * 0.6
                + miniNoise(mat2(0.8, -0.6, 0.6, 0.8) * p.xz * 0.97 - t * 0.4) * 0.4;
  // continuous line with soft variation (a hard threshold on a thin band
  // breaks into dashes along steep shores)
  float foam = shore * (0.4 + 0.6 * smoothstep(0.3, 0.75, breakup + shore * 0.25));
  // a shore is where the bed rises: wide flat shallows (lagoons, sandbanks)
  // keep only a faint trace instead of turning white
  float bedSlope = fwidth(columnDepth) / max(footprint, 1e-3);
  foam *= mix(0.25, 1.0, smoothstep(0.015, 0.09, bedSlope));
  col = mix(col, vec3(0.97, 0.98, 0.97) * (0.75 + 0.25 * lightSurface.r), foam * 0.8 * hasScene);

  // crisp glass edge where the surface meets the cut faces
  float edgeDist = uMiniHalf - max(abs(p.x), abs(p.z));
  float edgePx = edgeDist / max(fwidth(edgeDist), 1e-4);
  col = mix(col, vec3(0.94, 0.98, 0.97), (1.0 - smoothstep(0.0, 1.6, edgePx)) * 0.55);

  // distance fog, the terrain's formula (negligible at diorama scale)
  float fogF = 1.0 - exp(-uFogDensity * uFogDensity * fragDist * fragDist);
  col = mix(col, uFogColor, clamp(fogF, 0.0, 1.0));

  if (hasScene > 0.5) {
    // far edge (Infinite World): dissolve into the water-free scene behind
    col = mix(miniSceneColor(screenUv), col, edgeFade);
    gl_FragColor = vec4(pow(max(col, vec3(0.0)), vec3(1.0 / 2.2)), 1.0);
  } else {
    // no capture: the blended terrain behind is the background, so opacity
    // follows the same absorption (clear shallows, opaque deep water)
    // (col already carries the body weighted by 1 - T: un-weight it first)
    float bodyAlpha = clamp(1.0 - dot(transmittance, vec3(0.2126, 0.7152, 0.0722)), 0.18, 0.97);
    vec3 straight = col / bodyAlpha;
    float alpha = max(bodyAlpha, max(foam * 0.8, fresnel * uMiniReflect * 0.85)) * edgeFade;
    gl_FragColor = vec4(pow(max(straight, vec3(0.0)), vec3(1.0 / 2.2)) * alpha, alpha);
  }
}
`;

const CUT_VERTEX = /* glsl */ `
varying vec3 vWorldPos;
void main() {
  vec4 wp = modelMatrix * vec4(position, 1.0);
  vWorldPos = wp.xyz;
  gl_Position = projectionMatrix * viewMatrix * wp;
}
`;

const CUT_FRAGMENT = /* glsl */ `
precision highp float;
${MINI_WATER_COMMON_GLSL}
uniform float uCutHalf;
uniform float uCutBottom;
varying vec3 vWorldPos;

float cutBoxExit(vec3 p, vec3 dir) {
  vec3 d = vec3(
    abs(dir.x) < 1e-5 ? 1e-5 : dir.x,
    abs(dir.y) < 1e-5 ? 1e-5 : dir.y,
    abs(dir.z) < 1e-5 ? 1e-5 : dir.z
  );
  float tx = ((d.x > 0.0 ? uCutHalf : -uCutHalf) - p.x) / d.x;
  float tz = ((d.z > 0.0 ? uCutHalf : -uCutHalf) - p.z) / d.z;
  float ty = ((d.y > 0.0 ? uSeaLevel : uCutBottom) - p.y) / d.y;
  return max(min(min(tx, tz), ty), 0.0);
}

void main() {
  vec3 p = vWorldPos;
  vec3 rayDir = normalize(p - cameraPosition);
  float fragDist = length(p - cameraPosition);
  float path = cutBoxExit(p + rayDir * 0.05, rayDir);
  vec2 uv = gl_FragCoord.xy * uSceneViewportInv;
  vec3 background = vec3(0.0);
  float hasScene = step(0.5, uSceneRefractionEnabled);
  if (hasScene > 0.5) {
    float sceneDist = miniSceneDistance(uv, rayDir);
    path = min(path, max(sceneDist - fragDist, 0.0));
    background = miniSceneColor(uv);
  }

  // Same colour model as the surface right above this column: body colour
  // from the column depth, same light, same absorption. The section reads
  // as a slice of the very water seen from the top, not a different glass.
  vec3 light = miniLight(p.xz);
  float sunUp = clamp(uSunDir.y * 1.3, 0.0, 1.0);
  float depthBelow = max(uSeaLevel - p.y, 0.0);
  float column = uMiniLightEnabled > 0.5 ? max(uSeaLevel - light.b, depthBelow) : max(depthBelow * 1.2, 1.0);
  vec3 body = miniWaterBody(column);
  float bodyLight = (0.62 + 0.5 * sunUp * mix(0.78, 1.0, light.r)) * mix(0.88, 1.0, light.g);
  // light fades slightly with depth inside the slice
  float inside = clamp(depthBelow / max(column, 1.0), 0.0, 1.0);
  body *= bodyLight * mix(1.0, 0.74, inside);
  vec3 transmittance = exp(-uMiniWaterAbsorb * 1.4 * path);
  vec3 col = background * transmittance + body * (vec3(1.0) - transmittance);

  // crisp glass edges: the waterline and the vertical corners
  float topDist = uSeaLevel - p.y;
  float topPx = topDist / max(fwidth(topDist), 1e-4);
  float cornerDist = uCutHalf - min(abs(p.x), abs(p.z));
  float cornerPx = cornerDist / max(fwidth(cornerDist), 1e-4);
  float edge = max(1.0 - smoothstep(0.0, 1.6, topPx), (1.0 - smoothstep(0.0, 1.4, cornerPx)) * 0.5);
  col = mix(col, vec3(0.93, 0.98, 0.97), edge * 0.5);

  if (hasScene > 0.5) {
    gl_FragColor = vec4(pow(max(col, vec3(0.0)), vec3(1.0 / 2.2)), 1.0);
  } else {
    float alpha = clamp(1.0 - dot(transmittance, vec3(0.2126, 0.7152, 0.0722)) + edge * 0.3, 0.0, 1.0);
    gl_FragColor = vec4(pow(max(col, vec3(0.0)), vec3(1.0 / 2.2)) * alpha, alpha);
  }
}
`;

function waterUniforms(shared) {
  return {
    uSunDir: shared.uSunDir,
    uSeaLevel: shared.uSeaLevel,
    uTime: shared.uTime,
    uMiniWaterShallow: { value: new THREE.Vector3(0.27, 0.77, 0.67) },
    uMiniWaterMid: { value: new THREE.Vector3(0.05, 0.47, 0.54) },
    uMiniWaterDeep: { value: new THREE.Vector3(0.01, 0.16, 0.31) },
    uMiniWaterSide: { value: new THREE.Vector3(0.39, 0.78, 0.72) },
    uMiniWaterAbsorb: { value: new THREE.Vector3(0.045, 0.019, 0.013) },
    uMiniWaterDepthRange: { value: 70 },
    uMiniWaterAnim: { value: 0 },
    uMiniHalf: { value: 512 },
    uMiniCaustics: { value: 0.9 },
    uMiniLightTex: { value: null },
    uMiniLightEnabled: { value: 0 },
    uSceneColor: { value: null },
    uSceneDepth: { value: null },
    uSceneTexelSize: { value: new THREE.Vector2(1, 1) },
    uSceneViewportInv: { value: new THREE.Vector2(1, 1) },
    uSceneNear: { value: 1 },
    uSceneFar: { value: 50000 },
    uSceneRefractionEnabled: { value: 0 },
  };
}

export function createMiniWaterSurfaceMaterial(shared, { name = 'MiniWaterSurface', sky = null } = {}) {
  return new THREE.ShaderMaterial({
    name,
    uniforms: {
      ...waterUniforms(shared),
      uMiniRefraction: { value: 0.035 },
      uMiniWaveStrength: { value: 1.0 },
      uMiniFoamWidth: { value: 2.4 },
      uMiniReflect: { value: 0.6 },
      uMiniWaveScale: { value: 1.0 },
      uMiniEnvSky: { value: sky ? 1 : 0 },
      uSkyZenith: sky?.uSkyZenith ?? { value: new THREE.Color(0.3, 0.5, 0.85) },
      uSkyHorizon: sky?.uSkyHorizon ?? { value: new THREE.Color(0.75, 0.8, 0.85) },
      uFogColor: shared.uFogColor ?? { value: new THREE.Color(0.8, 0.84, 0.86) },
      uFogDensity: shared.uFogDensity ?? { value: 0 },
      uTerrainHeightTex: shared.uTerrainHeightTex ?? { value: null },
      uUseTerrainHeightTex: shared.uUseTerrainHeightTex ?? { value: 0 },
      uMiniBakeDepth: { value: 0 },
      uBakeOrigin: shared.uBakeOrigin ?? { value: new THREE.Vector2() },
      uBakeSpan: shared.uBakeSpan ?? { value: new THREE.Vector2(1, 1) },
      uHeightScale: shared.uHeightScale ?? { value: 1 },
      uWaterFadeStart: { value: 99999 },
      uWaterFadeEnd: { value: 100000 },
    },
    vertexShader: SURFACE_VERTEX,
    fragmentShader: SURFACE_FRAGMENT,
    transparent: true,
    premultipliedAlpha: true,
    depthTest: true,
    depthWrite: false,
    side: THREE.DoubleSide,
  });
}

export function createMiniWaterCutMaterial(shared) {
  return new THREE.ShaderMaterial({
    name: 'MiniWaterCut',
    uniforms: {
      ...waterUniforms(shared),
      uCutHalf: { value: 512 },
      uCutBottom: { value: -70 },
    },
    vertexShader: CUT_VERTEX,
    fragmentShader: CUT_FRAGMENT,
    transparent: true,
    premultipliedAlpha: true,
    depthTest: true,
    depthWrite: false,
    side: THREE.FrontSide,
  });
}

/**
 * Push the Mini water look into a surface or cut material. `colors` are
 * linear RGB triplets (MiniLook.miniWaterColors); params supply live water
 * settings so the Water panel still steers clarity, waves and foam.
 */
export function applyMiniWaterLook(material, { colors, params, half, depthRange, lightTex, animTime }) {
  const u = material?.uniforms;
  if (!u) return;
  if (colors) {
    u.uMiniWaterShallow.value.set(...colors.shallow);
    u.uMiniWaterMid.value.set(...colors.mid);
    u.uMiniWaterDeep.value.set(...colors.deep);
    u.uMiniWaterSide.value.set(...colors.side);
  }
  if (params) {
    // waterOpacity (0..1) is the optical density: lower = clearer water
    const density = 0.45 + (params.waterOpacity ?? 0.5) * 1.1;
    const absorb = (params.waterAbsorptionStrength ?? 0.7) * density;
    u.uMiniWaterAbsorb.value.set(0.050 * absorb, 0.021 * absorb, 0.014 * absorb);
    u.uMiniCaustics.value = (params.waterUnderwaterCausticsEnabled === false ? 0 : 1)
      * Math.min(1.6, (params.waterUnderwaterCaustics ?? 0.32) * 2.6);
    if (u.uMiniWaveStrength) u.uMiniWaveStrength.value = (params.waterWaveStrength ?? 0.55) * 1.5;
    if (u.uMiniFoamWidth) u.uMiniFoamWidth.value = params.waterFoamEnabled === false ? 0 : (params.waterFoamWidth ?? 2.2) * 0.6;
    if (u.uMiniRefraction) u.uMiniRefraction.value = 0.06 * (params.waterRefractionStrength ?? 0.5);
  }
  if (Number.isFinite(half)) u.uMiniHalf.value = half;
  if (Number.isFinite(depthRange)) u.uMiniWaterDepthRange.value = depthRange;
  if (lightTex !== undefined) {
    u.uMiniLightTex.value = lightTex;
    u.uMiniLightEnabled.value = lightTex ? 1 : 0;
  }
  if (Number.isFinite(animTime)) u.uMiniWaterAnim.value = animTime;
}
