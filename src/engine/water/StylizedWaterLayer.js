import { applyMiniWaterLook, createMiniWaterSurfaceMaterial, resolveMiniReflections } from '../mini/MiniWaterMaterial.js';
import { miniWaterColors } from '../mini/MiniLook.js';

// ============================================================================
// StylizedWaterLayer — the Mini Terrain water surface offered to the classic
// worlds as the "Stylized" water mode (Tile and Infinite World; the Planet
// shell keeps its spherical water, like the Realistic tiers).
//
// The managed WaterSystem material stays the cheap Legacy one and is never
// shown: the stylized material is presented through the WaterSystem
// overrides of the studio mesh and of the Infinite water plane, and is
// registered as auxiliary water so it receives the water-free scene capture
// (refraction + depth). A Mini diorama's own surface keeps priority.
// ============================================================================

export const STYLIZED_WATER_MODE = 'stylized';

export class StylizedWaterLayer {
  constructor(engine) {
    this.engine = engine;
    this.material = null;
    this._entry = null;
    this._compileGeneration = 0;
    this._compilingVersion = -1;
    this._compilingWorldMode = null;
    this._readyVersion = -1;
    this.pending = false;
    this.failed = false;
  }

  /** Create the material (and its capture registration) on first use. */
  ensure(waterSystem) {
    if (this.material) return this.material;
    const eng = this.engine;
    this.material = createMiniWaterSurfaceMaterial(eng.uniforms, {
      name: 'StylizedWaterSurface',
      sky: eng.proceduralSky?.uniforms ?? null,
    });
    // unbounded surface: no footprint clip, no glass edge
    this.material.uniforms.uMiniHalf.value = 1e7;
    this._entry = {
      material: this.material,
      applySettings: (params) => this.applySettings(params),
    };
    waterSystem.addAuxiliaryWater(this._entry);
    return this.material;
  }

  get ready() {
    return !!this.material && this._readyVersion === this.material.version;
  }

  prepare(waterSystem, worldMode) {
    const material = this.material;
    if (!material || this.ready || ((this.pending || this.failed)
      && this._compilingVersion === material.version && this._compilingWorldMode === worldMode)) return;
    const engine = this.engine;
    const version = material.version;
    const generation = ++this._compileGeneration;
    this._compilingVersion = version;
    this._compilingWorldMode = worldMode;
    this.pending = true;
    this.failed = false;
    const isCurrent = () => this.material === material && generation === this._compileGeneration
      && material.version === version && engine.worldMode === worldMode
      && waterSystem.getEffectiveMode() === STYLIZED_WATER_MODE && !waterSystem._disposed;
    // Leave the already-prepared Legacy material visible until both linking
    // and the offscreen validation draw finish. First draw must never compile.
    engine.compileWaterMaterialsAsync([material], () => {
      if (!isCurrent()) return;
      this._readyVersion = version;
      this.pending = false;
      engine._needsRender = true;
    }, { isCurrent }).then((ready) => {
      if (!isCurrent() || ready) return;
      this.pending = false;
      this.failed = true;
      engine._needsRender = true;
      engine.cb?.onToast?.('Water could not be prepared. Legacy water remains active.');
    });
  }

  cancelPreparation() {
    this._compileGeneration++;
    this.pending = false;
    this.failed = false;
  }

  applySettings(params = this.engine.params) {
    if (!this.material) return;
    const heightScale = Math.max(1, params.heightScale ?? 560);
    applyMiniWaterLook(this.material, {
      colors: miniWaterColors('procedural'),
      params,
      depthRange: Math.max(30, Math.min(heightScale * 0.18, (params.waterDeepDistance ?? 55) * 2)),
    });
    const u = this.material.uniforms;
    u.uMiniWaveScale.value = Math.max(0.1, params.waterWaveScale ?? 1);
    u.uMiniReflect.value = 0.6 * Math.max(0, params.waterFresnelStrength ?? 1)
      * resolveMiniReflections(params).strength;
  }

  /** Per frame: animation clock and depth source. */
  update(worldMode) {
    if (!this.material) return;
    const eng = this.engine;
    const p = eng.params;
    const anim = p.waterAnim ? (eng.uniforms.uTime?.value ?? 0) * (p.waterAnimSpeed ?? 1) * (p.waterWaveSpeed ?? 1) : 0;
    applyMiniWaterLook(this.material, { animTime: anim, lightTex: null });
    const u = this.material.uniforms;
    // the studio height bake is board-local: Infinite World reads the capture
    u.uMiniBakeDepth.value = worldMode === 'studio' ? 1 : 0;
    // Infinite World fades the plane out at the terrain render distance (the
    // managed material's fade, kept current by InfiniteWorld)
    const fade = worldMode === 'infinite' ? eng.infiniteWorld?.waterMaterial?.uniforms : null;
    u.uWaterFadeStart.value = fade?.uWaterFadeStart?.value ?? 99999;
    u.uWaterFadeEnd.value = fade?.uWaterFadeEnd?.value ?? 100000;
  }

  get compileMaterials() {
    return this.material ? [this.material] : [];
  }

  dispose(waterSystem) {
    this.cancelPreparation();
    this._readyVersion = -1;
    if (this._entry) waterSystem?.removeAuxiliaryWater(this._entry);
    this._entry = null;
    this.material?.dispose();
    this.material = null;
  }
}
