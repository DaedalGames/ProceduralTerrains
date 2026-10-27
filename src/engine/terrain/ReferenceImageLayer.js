import * as THREE from 'three';

export const REFERENCE_DEFAULTS = Object.freeze({ visible: true, opacity: 0.5, scale: 1, x: 0, z: 0 });
export const REFERENCE_CONTROLS = Object.freeze({
  opacity: { label: 'Reference Opacity', min: 0, max: 1, step: 0.01, digits: 2 },
  scale: { label: 'Reference Scale', min: 0.05, max: 40, step: 0.05, digits: 2, unit: ' tiles' },
  x: { label: 'Reference Position X', min: -20, max: 20, step: 0.05, digits: 2, unit: ' tiles' },
  z: { label: 'Reference Position Z', min: -20, max: 20, step: 0.05, digits: 2, unit: ' tiles' },
});

export function normalizeReferenceSettings(input = {}) {
  const settings = { visible: input?.visible !== false };
  for (const [key, { min, max }] of Object.entries(REFERENCE_CONTROLS)) {
    const value = input?.[key];
    settings[key] = typeof value === 'number' && Number.isFinite(value)
      ? Math.max(min, Math.min(max, value)) : REFERENCE_DEFAULTS[key];
  }
  return settings;
}

// Only embedded raster pixels may be restored; never fetch project-supplied URLs.
export function normalizeReferenceImage(input) {
  if (!input || input.version !== 1 || typeof input.dataUrl !== 'string'
      || !/^data:image\/png;base64,[A-Za-z0-9+/]+={0,2}$/.test(input.dataUrl)) return null;
  return { version: 1, source: 'local', fileName: String(input.fileName || 'Reference.png'),
    dataUrl: input.dataUrl, settings: normalizeReferenceSettings(input.settings) };
}

/** Editor-only pass: absent from terrain, collision, water, minimap and export scenes. */
export class ReferenceImageLayer {
  constructor(imageData, width, height) {
    this.scene = new THREE.Scene();
    this.texture = new THREE.DataTexture(new Uint8Array(imageData.data), width, height);
    this.texture.colorSpace = THREE.SRGBColorSpace;
    this.texture.minFilter = this.texture.magFilter = THREE.LinearFilter;
    // Canvas pixels start at the top; the plane's top edge points towards -Z.
    this.texture.flipY = true;
    this.texture.needsUpdate = true;
    this.mesh = new THREE.Mesh(new THREE.PlaneGeometry(1, 1), new THREE.MeshBasicMaterial({
      map: this.texture, transparent: true, depthTest: false, depthWrite: false,
      toneMapped: false, side: THREE.DoubleSide,
    }));
    this.mesh.name = 'reference-image';
    this.mesh.rotation.x = -Math.PI / 2;
    this.mesh.raycast = () => {};
    this.scene.add(this.mesh);
    this.aspect = width / height;
  }

  sync(settings, cellSize) {
    const size = cellSize * settings.scale;
    this.mesh.scale.set(size * Math.min(1, this.aspect), size / Math.max(1, this.aspect), 1);
    this.mesh.position.set(settings.x * cellSize, 0, settings.z * cellSize);
    this.mesh.material.opacity = settings.opacity;
    this.mesh.visible = settings.visible && settings.opacity > 0;
  }

  render(renderer, camera) {
    if (!this.mesh.visible) return;
    const autoClear = renderer.autoClear;
    try {
      renderer.autoClear = false;
      renderer.render(this.scene, camera);
    } finally {
      renderer.autoClear = autoClear;
    }
  }

  dispose() {
    this.texture.dispose();
    this.mesh.geometry.dispose();
    this.mesh.material.dispose();
    this.scene.clear();
  }
}
