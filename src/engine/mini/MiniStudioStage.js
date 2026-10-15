import * as THREE from 'three';
import { MINI_LIGHTING_GLSL, miniLightingUniforms } from './MiniLighting.js';

// ============================================================================
// MiniStudioStage — presentation objects around a Mini Terrain diorama:
//
//   * backdrop : a large inside-out sphere with a soft vertical gradient (the
//                neutral studio background; never part of an export);
//   * shadow   : a ground plane under the socle that only darkens — an
//                analytic soft drop shadow offset along the sun direction plus
//                a tight contact occlusion. No shadow map, no extra pass;
//   * socle    : a simple, slightly chamfered pedestal under the section base.
//
// All three write display colour with the same manual gamma as the terrain so
// they stay consistent on the canvas and in every intermediate render target.
// They are owned here and disposed together; the engine hides them during
// exports/heightmap captures through its plinth-visibility switch.
// ============================================================================

const BACKDROP_VERTEX = /* glsl */ `
varying vec3 vDir;
void main() {
  vDir = normalize(position);
  vec4 wp = modelMatrix * vec4(position, 1.0);
  gl_Position = projectionMatrix * viewMatrix * wp;
}
`;

const BACKDROP_FRAGMENT = /* glsl */ `
uniform vec3 uColor;     // display (sRGB) colour at the horizon
varying vec3 vDir;
void main() {
  float y = normalize(vDir).y;
  vec3 top = uColor * 1.035;
  vec3 low = uColor * 0.90;
  vec3 col = mix(low, uColor, smoothstep(-0.55, 0.0, y));
  col = mix(col, top, smoothstep(0.05, 0.85, y));
  gl_FragColor = vec4(col, 1.0);
}
`;

const SHADOW_VERTEX = /* glsl */ `
varying vec3 vWorldPos;
void main() {
  vec4 wp = modelMatrix * vec4(position, 1.0);
  vWorldPos = wp.xyz;
  gl_Position = projectionMatrix * viewMatrix * wp;
}
`;

const SHADOW_FRAGMENT = /* glsl */ `
uniform vec3 uSunDir;
uniform float uHalf;        // socle half-width
uniform float uLift;        // height of the diorama mass above the ground
uniform float uStrength;
uniform vec3 uShadowColor;  // display colour of full shadow
varying vec3 vWorldPos;

float sdBox(vec2 p, vec2 b) {
  vec2 d = abs(p) - b;
  return length(max(d, 0.0)) + min(max(d.x, d.y), 0.0);
}

void main() {
  vec3 sun = normalize(uSunDir);
  float elev = max(sun.y, 0.18);
  vec2 offset = -sun.xz / elev * uLift * 0.45;
  float soft = uHalf * 0.55 + uLift * 0.25;
  float drop = 1.0 - smoothstep(-soft * 0.35, soft, sdBox(vWorldPos.xz - offset, vec2(uHalf * 0.92)));
  float contact = 1.0 - smoothstep(0.0, uHalf * 0.12, sdBox(vWorldPos.xz, vec2(uHalf)));
  float shade = clamp(drop * 0.55 + contact * 0.45, 0.0, 1.0) * uStrength;
  gl_FragColor = vec4(uShadowColor * shade, shade);
}
`;

const SOCLE_VERTEX = /* glsl */ `
varying vec3 vNormalW;
varying vec3 vWorldPos;
void main() {
  vec4 wp = modelMatrix * vec4(position, 1.0);
  vWorldPos = wp.xyz;
  vNormalW = normalize(mat3(modelMatrix) * normal);
  gl_Position = projectionMatrix * viewMatrix * wp;
}
`;

const SOCLE_FRAGMENT = /* glsl */ `
${MINI_LIGHTING_GLSL}
uniform vec3 uSunDir;
uniform vec3 uColor;       // linear albedo
uniform float uTopY;
uniform float uBottomY;
varying vec3 vNormalW;
varying vec3 vWorldPos;
void main() {
  vec3 n = normalize(vNormalW);
  float ndl = max(dot(n, normalize(uSunDir)), 0.0);
  float t = clamp((vWorldPos.y - uBottomY) / max(uTopY - uBottomY, 1.0), 0.0, 1.0);
  vec3 albedo = uColor * mix(0.78, 1.0, smoothstep(0.0, 0.35, t));
  // thin darker groove just under the section base
  albedo *= 1.0 - 0.18 * smoothstep(0.86, 1.0, t);
  vec3 lit = albedo * miniLighting(ndl, 1.0, 1.0);
  gl_FragColor = vec4(pow(max(lit, vec3(0.0)), vec3(1.0 / 2.2)), 1.0);
}
`;

const srgbToLinear = (c) => (c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4);

function chamferedBoxGeometry(width, height, depth, chamfer) {
  // A box whose top edges are bevelled: built from an extruded rounded rect
  // would cost more triangles than this deserves; a two-tier box reads the same.
  const c = Math.min(chamfer, height * 0.45, width * 0.1);
  const lower = new THREE.BoxGeometry(width, height - c, depth);
  lower.translate(0, -c / 2, 0);
  const upper = new THREE.BoxGeometry(width - c * 2, c, depth - c * 2);
  upper.translate(0, height / 2 - c / 2, 0);
  const merged = mergeGeometries([lower, upper]);
  lower.dispose();
  upper.dispose();
  return merged;
}

function mergeGeometries(geometries) {
  const positions = [];
  const normals = [];
  const indices = [];
  let offset = 0;
  for (const geo of geometries) {
    const pos = geo.getAttribute('position');
    const nor = geo.getAttribute('normal');
    for (let i = 0; i < pos.count; i++) {
      positions.push(pos.getX(i), pos.getY(i), pos.getZ(i));
      normals.push(nor.getX(i), nor.getY(i), nor.getZ(i));
    }
    const idx = geo.index;
    for (let i = 0; i < idx.count; i++) indices.push(idx.getX(i) + offset);
    offset += pos.count;
  }
  const out = new THREE.BufferGeometry();
  out.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
  out.setAttribute('normal', new THREE.Float32BufferAttribute(normals, 3));
  out.setIndex(indices);
  out.computeBoundingSphere();
  return out;
}

export class MiniStudioStage {
  constructor(sharedUniforms) {
    this.group = new THREE.Group();
    this.group.name = 'mini-studio-stage';

    this.backdropMaterial = new THREE.ShaderMaterial({
      name: 'MiniBackdrop',
      uniforms: { uColor: { value: new THREE.Vector3(0.91, 0.89, 0.86) } },
      vertexShader: BACKDROP_VERTEX,
      fragmentShader: BACKDROP_FRAGMENT,
      side: THREE.BackSide,
      depthWrite: false,
    });
    this.backdrop = new THREE.Mesh(new THREE.SphereGeometry(1, 48, 24), this.backdropMaterial);
    this.backdrop.name = 'mini-backdrop';
    this.backdrop.frustumCulled = false;
    this.backdrop.renderOrder = -100;
    this.backdrop.scale.setScalar(24000);

    this.shadowMaterial = new THREE.ShaderMaterial({
      name: 'MiniShadowCatcher',
      uniforms: {
        uSunDir: sharedUniforms.uSunDir,
        uHalf: { value: 512 },
        uLift: { value: 300 },
        uStrength: { value: 0.42 },
        uShadowColor: { value: new THREE.Vector3(0.36, 0.33, 0.30) },
      },
      vertexShader: SHADOW_VERTEX,
      fragmentShader: SHADOW_FRAGMENT,
      transparent: true,
      premultipliedAlpha: true,
      depthWrite: false,
    });
    const plane = new THREE.PlaneGeometry(1, 1);
    plane.rotateX(-Math.PI / 2);
    this.shadow = new THREE.Mesh(plane, this.shadowMaterial);
    this.shadow.name = 'mini-shadow-catcher';
    this.shadow.renderOrder = -50;

    this.socleMaterial = new THREE.ShaderMaterial({
      name: 'MiniSocle',
      uniforms: {
        ...miniLightingUniforms(sharedUniforms),
        uSunDir: sharedUniforms.uSunDir,
        uColor: { value: new THREE.Vector3(0.6, 0.52, 0.4) },
        uTopY: { value: -70 },
        uBottomY: { value: -115 },
      },
      vertexShader: SOCLE_VERTEX,
      fragmentShader: SOCLE_FRAGMENT,
    });
    this.socle = new THREE.Mesh(new THREE.BoxGeometry(1, 1, 1), this.socleMaterial);
    this.socle.name = 'mini-socle';

    // Soft studio fill for the lit props (trees, rocks): sky above, warm
    // bounce below. The terrain and water shaders do their own lighting.
    // (physically based light units: Lambert divides by pi, hence the value)
    this.fill = new THREE.HemisphereLight(0xdbe7f5, 0x8a7d66, 3.2);
    this.fill.name = 'mini-studio-fill';

    this.group.add(this.backdrop, this.shadow, this.socle, this.fill);
    this._layoutKey = '';
    this.group.visible = false;
  }

  /**
   * @param {object} layout  { half, baseY, socleHeight, socleMargin, maxHeight, socle }
   */
  setLayout({ half, baseY, socleHeight, socleMargin, maxHeight, socle = true }) {
    const key = `${half}:${baseY}:${socleHeight}:${socleMargin}:${socle}`;
    const bottom = socle ? baseY - socleHeight : baseY;
    this.shadow.position.set(0, bottom - 0.5, 0);
    this.shadow.scale.set(half * 9, 1, half * 9);
    this.shadowMaterial.uniforms.uHalf.value = half + (socle ? socleMargin : 0);
    this.shadowMaterial.uniforms.uLift.value = Math.max(1, maxHeight - bottom);
    this.socle.visible = !!socle;
    this.socleMaterial.uniforms.uTopY.value = baseY;
    this.socleMaterial.uniforms.uBottomY.value = bottom;
    if (key === this._layoutKey) return;
    this._layoutKey = key;
    if (socle) {
      const width = (half + socleMargin) * 2;
      this.socle.geometry.dispose();
      this.socle.geometry = chamferedBoxGeometry(width, socleHeight, width, socleMargin * 0.9);
      this.socle.position.set(0, baseY - socleHeight / 2, 0);
    }
  }

  /** Backdrop + shadow tint from a display-space [r,g,b] colour. */
  setBackdrop(rgb) {
    const [r, g, b] = rgb;
    this.backdropMaterial.uniforms.uColor.value.set(r, g, b);
    this.shadowMaterial.uniforms.uShadowColor.value.set(r * 0.38, g * 0.36, b * 0.35);
  }

  /** Socle albedo from a display-space colour. */
  setSocleColor(rgb) {
    const lin = rgb.map(srgbToLinear);
    this.socleMaterial.uniforms.uColor.value.set(lin[0], lin[1], lin[2]);
  }

  setLighting(state, skyActive) {
    this.backdrop.visible = !skyActive;
    if (!state) return;
    this.fill.color.setRGB(...state.ambientTopColor);
    this.fill.groundColor.setRGB(...state.groundBounceColor);
    this.shadowMaterial.uniforms.uStrength.value = Math.min(0.6, Math.max(...state.directLightColor, 0) * 0.6);
  }

  setVisible(visible) {
    this.group.visible = !!visible;
  }

  get materials() {
    return [this.backdropMaterial, this.shadowMaterial, this.socleMaterial];
  }

  dispose() {
    this.group.removeFromParent();
    this.backdrop.geometry.dispose();
    this.shadow.geometry.dispose();
    this.socle.geometry.dispose();
    for (const m of this.materials) m.dispose();
  }
}
