import * as THREE from 'three';
import {
  MINI_CUT_STYLES,
  MINI_RECIPES,
  createMiniTerrainState,
  miniCompositionUniformValues,
  miniLodSegments,
  miniParamsPatch,
  normalizeMiniTerrainState,
  normalizeMiniView,
  resolveMiniCloudLayout,
  resolveMiniFraming,
  resolveMiniLayout,
} from './MiniTerrainSettings.js';
import { miniCutColor } from './miniCutGLSL.js';
import { MiniStudioStage } from './MiniStudioStage.js';
import { MiniWaterCut } from './MiniWaterCut.js';
import { MiniLightMap } from './MiniLightMap.js';
import { applyMiniWaterLook, createMiniWaterSurfaceMaterial } from './MiniWaterMaterial.js';
import { miniStylePatch, miniWaterColors } from './MiniLook.js';

// ============================================================================
// MiniTerrainController — the engine-side owner of the Mini Terrain
// presentation. The engine stays the orchestrator: it calls a handful of
// hooks (uniforms, LOD segments, wall/base sizes, plinth sync, underwater
// volume, per-frame water-cut sync) and this class answers them from the
// normalized Mini document. Presentation objects (studio stage, water cut)
// are created on first activation and disposed with the engine.
//
// Mini is a specialisation of the finite studio world, so `active` also
// requires worldMode === 'studio': no other mode ever sees Mini behaviour.
// ============================================================================

// Which Mini fields map to which params scope (see miniParamsPatch).
const FIELD_SCOPES = Object.freeze({
  waterLevel: 'water',
  vegetation: 'props',
  clouds: 'clouds',
  quality: 'quality',
});

export class MiniTerrainController {
  constructor(engine) {
    this.engine = engine;
    this.state = null;
    this.stage = null;
    this.waterCut = null;
    this.waterSurface = null;
    this.lightMap = null;
    this._waterEntry = null;
    this._surfaceEntry = null;
    this._presentationKey = '';
    this._homeKey = '';
    this._ground = { texture: null, revision: -1 };
  }

  get active() {
    return !!this.state && this.engine.worldMode === 'studio';
  }

  get layout() {
    return resolveMiniLayout(this.state);
  }

  serialize() {
    return this.state ? structuredClone(this.state) : null;
  }

  /** Install a (possibly null) Mini document. Never touches params. */
  install(state) {
    const next = state ? normalizeMiniTerrainState(state) : null;
    const wasActive = !!this.state;
    this.state = next;
    if (next) this._ensureObjects();
    if (wasActive && !next) this._deactivate();
    this._presentationKey = '';
    this._homeKey = '';
    return this.state;
  }

  /** Create a fresh document for a new project. */
  createState(spec = {}) {
    return createMiniTerrainState({ recipe: spec.recipe, seed: spec.seed, preset: spec.preset });
  }

  /** Params that realise the current document (scope: see miniParamsPatch). */
  paramsPatch(scope = 'all') {
    return this.state ? miniParamsPatch(this.state, scope) : {};
  }

  recipe() {
    return this.state ? MINI_RECIPES[this.state.recipe] : null;
  }

  /**
   * Compute the params patch for a document change. Returns
   * { state, params, palette, composition } describing what must be
   * invalidated — relief composition, palette and water/cloud/props params
   * are separate categories so a vegetation change never rebuilds terrain.
   */
  planChange(patch = {}) {
    if (!this.state) return null;
    const prev = this.state;
    const next = normalizeMiniTerrainState({ ...prev, ...patch });
    const changed = Object.keys(next).filter((key) => JSON.stringify(next[key]) !== JSON.stringify(prev[key]));
    let params = {};
    let palette = null;
    let composition = false;
    if (changed.includes('recipe') || changed.includes('preset')) {
      // A new recipe is a new look: relief, water look, palette, clouds, props.
      const r = MINI_RECIPES[next.recipe];
      next.vegetation = patch.vegetation ?? r.vegetation;
      next.clouds = patch.clouds ?? r.clouds;
      next.cutStyle = patch.cutStyle ?? r.cutStyle;
      params = miniParamsPatch(next, 'all');
      palette = miniStylePatch(next.recipe, next.preset);
      composition = true;
    } else {
      if (changed.includes('seed')) {
        // A seed replaces the generated composition, detail noise and the
        // scattered props; amounts, quality and presentation are kept.
        const all = miniParamsPatch(next, 'all');
        params.seed = all.seed;
        params.propsSeed = all.propsSeed;
        composition = true;
      }
      if (changed.includes('relief')) {
        // Relief scales the whole height range: the composition heights, and
        // for a procedural diorama the stack itself (heightScale) with the
        // formation and water levels that are expressed in the same units.
        const all = miniParamsPatch(next, 'all');
        const structure = miniParamsPatch(next, 'structure');
        params.heightScale = structure.heightScale;
        params.terrainFormationSeaLevel = structure.terrainFormationSeaLevel;
        Object.assign(params, miniParamsPatch(next, 'water'));
        params.cloudAltitude = all.cloudAltitude;
        composition = true;
      }
      if (changed.includes('width')) {
        params = { ...params, ...miniParamsPatch(next, 'all') };
        composition = true;
      }
      for (const [field, scope] of Object.entries(FIELD_SCOPES)) {
        if (changed.includes(field)) Object.assign(params, miniParamsPatch(next, scope));
      }
    }
    return { state: next, changed, params, palette, composition };
  }

  // ------------------------------------------------------------------ hooks

  /** Composition + cut uniforms (shape 0 / cut 0 when not active). */
  applyUniforms(u) {
    const active = this.active;
    const c = miniCompositionUniformValues(active ? this.state : null);
    if (u.uMiniShape) u.uMiniShape.value = c.shape;
    u.uMiniFrame?.value.set(...c.frame);
    u.uMiniGeometry?.value.set(...c.geometry);
    u.uMiniHeights?.value.set(...c.heights);
    u.uMiniWobble?.value.set(...c.wobble);
    u.uMiniDetail?.value.set(...c.detail);
    if (u.uMiniCut) u.uMiniCut.value = active ? 1 : 0;
    if (!active) return;
    const style = MINI_CUT_STYLES[this.state.cutStyle] ?? MINI_CUT_STYLES.strata;
    const L = this.layout;
    u.uMiniCutTopsoil?.value.set(...miniCutColor(style.topsoil));
    u.uMiniCutBandA?.value.set(...miniCutColor(style.bandA));
    u.uMiniCutBandB?.value.set(...miniCutColor(style.bandB));
    u.uMiniCutDeep?.value.set(...miniCutColor(style.deep));
    u.uMiniCutSediment?.value.set(...miniCutColor(style.sediment));
    u.uMiniCutParams?.value.set(style.bands, -L.baseDepth, Math.max(4, L.width * 0.012), L.reliefHeight);
  }

  lodSegments() {
    return miniLodSegments(this.state);
  }

  /** Cloud slab placement override (null = the classic board layout). */
  cloudLayout() {
    return this.active ? resolveMiniCloudLayout(this.state) : null;
  }

  /**
   * Plinth replacement: hide the classic box, lay out the studio stage and
   * the water cut, install the camera home. Returns true when Mini owns the
   * base (the caller skips its own plinth build).
   */
  syncPresentation() {
    const eng = this.engine;
    if (!this.active) {
      this._deactivate();
      return false;
    }
    this._ensureObjects();
    const L = this.layout;
    const p = eng.params;
    if (eng.plinth) eng.plinth.visible = false;
    if (eng.diskWall) eng.diskWall.visible = false;
    this._ownsPlinth = true;
    const maxHeight = L.formationSea + L.heightScale * 0.8;
    this.stage.setLayout({
      half: L.half,
      baseY: -L.baseDepth,
      socleHeight: L.socleHeight,
      socleMargin: L.socleMargin,
      maxHeight,
      socle: this.state.socle,
    });
    this.stage.setBackdrop(this.state.backdrop);
    this.stage.setSocleColor(MINI_CUT_STYLES[this.state.cutStyle]?.sediment ?? [0.7, 0.62, 0.5]);
    this.stage.setVisible(eng._plinthWanted !== false);
    this.waterCut.setBounds({
      half: L.half,
      bottom: -L.baseDepth,
      top: p.seaLevel,
      inset: Math.max(0.35, L.width * 0.0005),
    });
    this.lightMap.setLayout({ half: L.half, segments: L.segments });
    this._applyWaterLook();
    eng.waterSystem?.setStudioOverride(this.waterSurface);
    this._syncHome();
    return true;
  }

  _applyWaterLook() {
    if (!this.state) return;
    const L = this.layout;
    const look = {
      colors: miniWaterColors(this.state.recipe),
      params: this.engine.params,
      half: L.half,
      depthRange: L.reliefHeight * 0.32,
    };
    applyMiniWaterLook(this.waterSurface, look);
    applyMiniWaterLook(this.waterCut?.material, look);
  }

  /**
   * Per-frame: re-bake the light map when the terrain or sun changed, drive
   * the water animation clock, and keep the cut faces on the water surface.
   */
  beforeRender() {
    if (!this.waterCut) return;
    const eng = this.engine;
    if (this.active && this.lightMap) {
      const sun = eng.uniforms.uSunDir.value;
      const L = this.layout;
      // Structural identity of the diorama: a different recipe/seed/footprint
      // must never be shown with data derived from the previous terrain.
      const structure = [this.state.recipe, this.state.seed, this.state.preset ?? '', L.half].join(':');
      // The light map is baked from the terrain's vertex heights rendered by
      // the compiled height program (one small grid, same frame as an edit),
      // so it follows every slider live. It needs the program that draws the
      // terrain right now: during a structural recompile (or before the first
      // program is ready) the previous map is never shown over a different
      // relief (white foam plains, floating dark "mountains").
      const baker = eng.terrainHeightBaker;
      const program = eng._activeHeightProgram?.('studio');
      const programKey = program ? `${Math.round(eng.params.octaves)}:${program.heightSig || program.sig}` : null;
      const programReady = !!baker?.material && baker.programKey === programKey
        && eng._terrainSourcePendingToken == null;
      let lightValid = false;
      if (programReady) {
        const u = eng.uniforms;
        const key = [
          eng._terrainGen, programKey, u.uHeightScale.value,
          sun.x.toFixed(3), sun.y.toFixed(3), sun.z.toFixed(3), L.half, L.segments,
        ].join(':');
        const renderHeights = (grid) => baker.renderHeightGrid(grid, this._gridTransform(L));
        if (this.lightMap.update(eng.renderer, key, sun, renderHeights)) eng._needsRender = true;
        lightValid = this.lightMap.isCurrent(key);
        if (lightValid) this._lightStructure = structure;
      }
      lightValid = lightValid && this._lightStructure === structure;
      const lightTex = lightValid ? this.lightMap.texture : null;
      const p = eng.params;
      const anim = p.waterAnim ? (eng.uniforms.uTime?.value ?? 0) * (p.waterAnimSpeed ?? 1) * (p.waterWaveSpeed ?? 1) : 0;
      for (const material of [this.waterSurface, this.waterCut.material]) {
        applyMiniWaterLook(material, { lightTex, animTime: anim });
      }
      this.lightMap.decal.visible = !!lightTex && this.stage?.group.visible !== false;
      // Vegetation and rocks are regular props: they receive the diorama's
      // cliff shadows / AO, and a live ground. Whenever the scatter is complete
      // for the terrain the map describes, its heights are captured; a later
      // edit keeps that scatter visible, re-seated on the live relief, while
      // the props rebuild (no blinking, no floating trees mid-drag).
      const pm = eng.propsManager;
      if (pm && lightValid && pm.scatterSettled && pm.scatterRevision === eng._terrainGen
          && this._ground.revision !== eng._terrainGen) {
        this._ground.texture = this.lightMap.snapshot(eng.renderer);
        this._ground.revision = this._ground.texture ? eng._terrainGen : -1;
      }
      pm?.setMiniLightMap(lightTex, L.half, this._ground);
    }
    const visible = this.active && !!eng.water?.visible && eng.params.seaLevel > 0.5;
    this.waterCut.mesh.visible = visible;
    if (visible) {
      const L = this.layout;
      this.waterCut.setBounds({
        half: L.half,
        bottom: -L.baseDepth,
        top: eng.params.seaLevel,
        inset: Math.max(0.35, L.width * 0.0005),
      });
    }
  }

  /**
   * uv transform for TerrainHeightBaker.renderHeightGrid so texel i of the
   * (segments + 1)^2 grid lands exactly on surface vertex i
   * (x = -half + i * width / segments), whatever the shared bake rectangle.
   */
  _gridTransform(L) {
    const u = this.engine.uniforms;
    const o = u.uBakeOrigin.value;
    const span = u.uBakeSpan.value;
    const sx = Math.max(span.x, 1);
    const sz = Math.max(span.y, 1);
    const step = (2 * L.half) / L.segments;
    const n = L.segments + 1;
    this._gridUv ||= new THREE.Vector4();
    return this._gridUv.set(
      (-L.half - o.x - 0.5 * step) / sx,
      (-L.half - o.y - 0.5 * step) / sz,
      (step * n) / sx,
      (step * n) / sz,
    );
  }

  setStageVisible(visible) {
    this.stage?.setVisible(visible && this.active);
    if (this.waterCut && !visible) this.waterCut.mesh.visible = false;
  }

  /** Bounded water volume for the underwater detector (null = unbounded). */
  underwaterVolume() {
    if (!this.active) return null;
    const L = this.layout;
    return { minX: -L.half, maxX: L.half, minZ: -L.half, maxZ: L.half, floorY: -L.baseDepth };
  }

  /** Walkable rectangle: the footprint, a step inside the cut faces. */
  walkBounds() {
    if (!this.active) return null;
    const L = this.layout;
    const m = Math.max(1.5, L.width * 0.004);
    return { minX: -L.half + m, maxX: L.half - m, minZ: -L.half + m, maxZ: L.half - m };
  }

  framing() {
    const cam = this.engine.camera;
    return resolveMiniFraming(this.state, { fov: cam?.fov ?? 45, aspect: cam?.aspect || 16 / 9 });
  }

  /** Recentre on the composition (blend = ease, else cut). */
  frame({ blend = true } = {}) {
    if (!this.active) return;
    this._syncHome(true);
    this.engine.controls.goToView(this.engine.controls.home, { blend });
    this.engine._needsRender = true;
  }

  saveView(name) {
    if (!this.state) return null;
    const view = normalizeMiniView({ name: name || `View ${(this.state.camera?.views?.length ?? 0) + 1}`, ...this.engine.controls.getView() });
    const views = [...(this.state.camera?.views ?? []), view].slice(-8);
    this.state = normalizeMiniTerrainState({ ...this.state, camera: { views } });
    return this.state;
  }

  removeView(index) {
    if (!this.state?.camera?.views) return this.state;
    const views = this.state.camera.views.filter((_, i) => i !== index);
    this.state = normalizeMiniTerrainState({ ...this.state, camera: { views } });
    return this.state;
  }

  goToView(index) {
    const view = this.state?.camera?.views?.[index];
    if (!view) return false;
    this.engine.controls.goToView(view, { blend: true });
    this.engine._needsRender = true;
    return true;
  }

  diagnostics() {
    if (!this.state) return null;
    const L = this.layout;
    return {
      active: this.active,
      recipe: this.state.recipe,
      seed: this.state.seed,
      width: L.width,
      segments: L.segments,
      surfaceTriangles: 2 * L.segments * L.segments,
      wallTriangles: 8 * L.segments,
      lightDecalTriangles: 2 * L.segments * L.segments,
      lightMapReady: !!this.lightMap?.ready,
      props: this.engine.propsManager?.getDiagnostics?.()?.instances ?? null,
      waterCutVisible: !!this.waterCut?.mesh.visible,
    };
  }

  /**
   * What the exporter needs to rebuild the diorama outside the app: section
   * depth and strata, water colours (linear) and the socle. Null when off.
   */
  exportSpec() {
    if (!this.active) return null;
    const L = this.layout;
    const style = MINI_CUT_STYLES[this.state.cutStyle] ?? MINI_CUT_STYLES.strata;
    const water = miniWaterColors(this.state.recipe);
    return {
      width: L.width,
      half: L.half,
      baseDepth: L.baseDepth,
      cut: {
        topsoil: miniCutColor(style.topsoil),
        bandA: miniCutColor(style.bandA),
        bandB: miniCutColor(style.bandB),
        deep: miniCutColor(style.deep),
        sediment: miniCutColor(style.sediment),
        bands: style.bands,
        topsoilDepth: Math.max(4, L.width * 0.012),
        reliefHeight: L.reliefHeight,
      },
      water: { ...water, depthRange: L.reliefHeight * 0.32 },
      socle: this.state.socle
        ? { height: L.socleHeight, margin: L.socleMargin, color: miniCutColor(style.sediment) }
        : null,
    };
  }

  /** Materials the engine should warm with the Mini scene. */
  compileMaterials() {
    return [
      this.waterSurface, this.waterCut?.material, ...(this.lightMap?.materials ?? []),
      ...(this.stage?.materials ?? []),
    ].filter(Boolean);
  }

  dispose() {
    this._deactivate();
    if (this._waterEntry) this.engine.waterSystem?.removeAuxiliaryWater(this._waterEntry);
    if (this._surfaceEntry) this.engine.waterSystem?.removeAuxiliaryWater(this._surfaceEntry);
    this._waterEntry = null;
    this._surfaceEntry = null;
    this.lightMap?.dispose();
    this.waterSurface?.dispose();
    this.stage?.dispose();
    this.waterCut?.dispose();
    this.lightMap = null;
    this.waterSurface = null;
    this.stage = null;
    this.waterCut = null;
  }

  // ---------------------------------------------------------------- internal

  _ensureObjects() {
    const eng = this.engine;
    if (!eng.scene || !eng.uniforms) return;
    if (!this.stage) {
      this.stage = new MiniStudioStage(eng.uniforms);
      eng.scene.add(this.stage.group);
    }
    if (!this.waterCut) {
      this.waterCut = new MiniWaterCut(eng.uniforms);
      eng.scene.add(this.waterCut.mesh);
      this._waterEntry = {
        mesh: this.waterCut.mesh,
        material: this.waterCut.material,
        applySettings: (params) => applyMiniWaterLook(this.waterCut?.material, { params }),
      };
      eng.waterSystem?.addAuxiliaryWater(this._waterEntry);
    }
    if (!this.waterSurface) {
      // Rendered on the studio water mesh through the WaterSystem override;
      // registered as auxiliary so it receives the water-free scene capture.
      this.waterSurface = createMiniWaterSurfaceMaterial(eng.uniforms);
      this._surfaceEntry = {
        material: this.waterSurface,
        applySettings: (params) => applyMiniWaterLook(this.waterSurface, { params }),
      };
      eng.waterSystem?.addAuxiliaryWater(this._surfaceEntry);
    }
    if (!this.lightMap) {
      this.lightMap = new MiniLightMap(eng.uniforms);
      this.stage.group.add(this.lightMap.decal);
    }
  }

  _deactivate() {
    const eng = this.engine;
    if (this.stage) this.stage.setVisible(false);
    if (this.waterCut) this.waterCut.mesh.visible = false;
    eng.propsManager?.setMiniLightMap(null);
    if (eng.waterSystem?.studioOverride && eng.waterSystem.studioOverride === this.waterSurface) {
      eng.waterSystem.setStudioOverride(null);
    }
    if (this._ownsPlinth) {
      this._ownsPlinth = false;
      if (eng.plinth) eng.plinth.visible = eng._plinthWanted !== false;
      eng._plinthGeometryKey = null;
    }
    if (eng.controls?.home) {
      eng.controls.setHome(null);
      eng._plinthGeometryKey = null;
    }
    this._homeKey = '';
  }

  _syncHome(force = false) {
    const controls = this.engine.controls;
    if (!controls) return;
    const f = this.framing();
    const key = JSON.stringify([f.theta, f.radius, f.target, f.minRadius, f.maxRadius]);
    if (!force && key === this._homeKey && controls.home) return;
    this._homeKey = key;
    controls.setHome(f);
  }
}
