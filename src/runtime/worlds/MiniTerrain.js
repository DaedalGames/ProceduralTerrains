import * as THREE from 'three';
import { DEFAULT_PARAMS } from '../../engine/presets.js';
import { createTerrain } from '../FiniteTerrain.js';
import { MiniTerrainController } from '../../engine/mini/MiniTerrainController.js';
import {
  createMiniTerrainState,
  normalizeMiniTerrainState,
  miniParamsPatch,
  resolveMiniLayout,
} from '../../engine/mini/MiniTerrainSettings.js';
import { miniStylePatch } from '../../engine/mini/MiniLook.js';
import { terrainMaterial, terrainStyle } from '../TerrainAppearance.js';
import { applyTerrainShapeUniforms, applyTerrainShadingUniforms } from '../TerrainParameters.js';
import { TerrainHeightCache } from '../effects/TerrainHeightCache.js';
import { compileMaterial } from '../resources/CompileMaterial.js';
import { withRendererState } from '../resources/RendererState.js';

const SOURCE_KEYS = ['seed', 'octaves', 'noiseScale', 'noiseStrength', 'terrainSmoothing',
  'terrainDetail', 'persistence', 'lacunarity', 'ridge', 'warp', 'falloff', 'edgeFalloffMode'];

function configuration(state) {
  const p = { ...DEFAULT_PARAMS, ...miniParamsPatch(state, 'all') },
    l = resolveMiniLayout(state);
  return {
    terrainFormationSeaLevel: p.terrainFormationSeaLevel,
    material: terrainMaterial(p),
    layout: { chunkCount: 1, chunkSize: l.width },
    heightScale: l.heightScale,
    seaLevel: l.seaLevel,
    source: {
      kind: 'noise',
      seed: p.seed,
      octaves: p.octaves,
      scale: p.noiseScale,
      strength: p.noiseStrength,
      smoothing: p.terrainSmoothing,
      detail: p.terrainDetail,
      persistence: p.persistence,
      lacunarity: p.lacunarity,
      ridge: p.ridge,
      warp: p.warp,
      falloff: p.falloff,
      edgeFalloffMode: p.edgeFalloffMode,
    },
    quality: { mergeEnabled: false, morphEnabled: false },
  };
}

/** Mini is a finite presentation. It suggests framing; the host owns its camera. */
export class MiniPresentation {
  constructor(terrain, state, { backdrop = false } = {}) {
    this.terrain = terrain;
    this.backdrop = backdrop;
    this.disposed = false;
    const t = terrain;
    this.context = {
      renderer: t._renderer,
      scene: t.object,
      uniforms: t._uniforms,
      worldMode: 'studio',
      _miniReadbackEnabled: false,
      params: t._params,
      camera: t._viewCamera,
      _activeHeightProgram: () => t._stackGLSL,
      _terrainGen: t._revision,
      _terrainSourcePendingToken: null,
    };
    this.controller = new MiniTerrainController(this.context);
    this.controller.install(state);
    this.cache = new TerrainHeightCache({ terrain, resolution: 256, attach: false });
    this.context.terrainHeightBaker = this.cache.baker;
    this._detach = t.addLayer(this);
    t.mini = this;
    this._apply();
  }
  get state() {
    return this.controller.serialize();
  }
  _apply() {
    const t = this.terrain,
      l = this.controller.layout,
      p = t._params;
    // Mini decorates the saved terrain. Recipe defaults are applied only when
    // creating or explicitly changing a recipe, never while loading/preparing.
    this.context.params = { ...p, ...[...t._layers].find((layer) => layer.system)?.parameters };
    this.context._terrainGen = t._revision;
    const water = [...t._layers].find((layer) => layer.system);
    this.context.water = water?.context.mesh;
    this.context.waterSystem = water?.system;
    applyTerrainShapeUniforms(t._uniforms, p, l.width);
    applyTerrainShadingUniforms(t._uniforms, p, {
      size: l.width,
      skirtDepth: l.baseDepth,
      wallThickness: 0,
    });
    this.controller.applyUniforms(t._uniforms);
    t._runtime.board.syncCells({
      chunkCount: 1,
      chunkSize: l.width,
      maxHeight: Math.max(p.heightScale * 1.35 + 2, t._source.maxHeight),
      skirtDepth: l.baseDepth,
      lodSegments: this.controller.lodSegments(),
      cells: [{ cx: 0, cz: 0 }],
      progressive: false,
    });
    while (t._runtime.board._lodRebuildQueue.length) t._runtime.board.updateLOD(t._cameraPosition);
    t._runtime.board.setMorphEnabled(false);
    t._runtime.board.setMergeOptions({ enabled: false });
    this.controller.syncPresentation();
    this.controller.stage.backdrop.visible = this.backdrop;
    t._miniCloudLayout = this.controller.cloudLayout();
    t._miniVolume = this.controller.underwaterVolume();
  }
  async configure(patch = {}, options = {}) {
    const plan = this.controller.planChange(patch);
    const state = plan.state;
    const p = { ...this.terrain._params, ...plan.params };
    const c = this.terrain.configuration;
    const next = {
      heightScale: p.heightScale, seaLevel: p.seaLevel,
      terrainFormationSeaLevel: p.terrainFormationSeaLevel,
      layout: { chunkCount: 1, chunkSize: state.width },
      material: terrainMaterial(plan.params),
      ...(plan.palette ? { palette: plan.palette.palette, style: terrainStyle(plan.palette) } : {}),
    };
    if (SOURCE_KEYS.some(key => Object.hasOwn(plan.params, key))) {
      next.source = {
        ...c.source, seed: p.seed, octaves: p.octaves,
        scale: p.noiseScale, strength: p.noiseStrength,
        smoothing: p.terrainSmoothing, detail: p.terrainDetail,
        persistence: p.persistence, lacunarity: p.lacunarity, ridge: p.ridge,
        warp: p.warp, falloff: p.falloff, edgeFalloffMode: p.edgeFalloffMode,
      };
    }
    this._nextState = state;
    try {
      await this.terrain.configure(next, options);
      // The effects own their saved parameters; update only the fields changed
      // by this Mini action, preserving edits from the shared water/cloud API.
      for (const layer of this.terrain._layers) {
        if (!layer.system && !layer.layer) continue;
        const parameters = Object.fromEntries(Object.entries(plan.params).filter(([key]) =>
          Object.hasOwn(layer.parameters, key) || (layer.system && key === 'seaLevel')));
        if (Object.keys(parameters).length) await layer.configure({
          parameters,
          ...(layer.system && plan.params.waterMode ? { mode: plan.params.waterMode } : {}),
        }, options);
      }
    } finally {
      if (this._nextState === state) this._nextState = null;
    }
  }

  async prepare(camera, options = {}) {
    this.context.camera = camera;
    this._apply();
    await this.cache.prepare(camera, options);
    for (const material of this.controller.compileMaterials())
      await compileMaterial(this.terrain._renderer, material, camera);
    this.beforeRender();
  }
  async onTerrainChanged(options = {}) {
    if (this._nextState) {
      this.controller.install(this._nextState);
      this._nextState = null;
    }
    this._apply();
    await this.cache.prepare(this.terrain._viewCamera ?? new THREE.PerspectiveCamera(), options);
  }
  update(_dt, { camera }) {
    this.context.camera = camera;
    this.context._terrainGen = this.terrain._revision;
  }
  beforeRender() {
    this._applyWater();
    withRendererState(this.terrain._renderer, () => this.controller.beforeRender());
  }
  _applyWater() {
    const water = [...this.terrain._layers].find((layer) => layer.system);
    if (water?.system !== this.context.waterSystem) {
      this.context.params = { ...this.terrain._params, ...water?.parameters };
      this.context.water = water?.context.mesh;
      this.context.waterSystem = water?.system;
      this.controller.syncPresentation();
      this.controller.stage.backdrop.visible = this.backdrop;
    }
  }
  framing() {
    return this.controller.framing();
  }
  serialize() {
    return { type: 'mini', state: this.state, backdrop: this.backdrop };
  }
  getDiagnostics() {
    return this.controller.diagnostics();
  }
  dispose() {
    if (this.disposed) return;
    this.disposed = true;
    this._detach();
    this.controller.dispose();
    this.cache.dispose();
    delete this.terrain.mini;
  }
}

export async function createMiniTerrain({ mini = {}, backdrop = false, ...options } = {}) {
  const state = normalizeMiniTerrainState({ ...createMiniTerrainState(mini), ...mini });
  const defaults = configuration(state);
  const look = miniStylePatch(state.recipe, state.preset);
  const custom = options.configuration ?? {};
  const terrain = await createTerrain({
    ...options,
    configuration: {
      ...defaults, ...custom,
      source: { ...defaults.source, ...custom.source },
      material: { ...defaults.material, ...custom.material },
      style: { ...terrainStyle(look), ...custom.style },
      palette: { ...look.palette, ...custom.palette },
      quality: { ...defaults.quality, ...custom.quality },
      layout: { chunkCount: 1, chunkSize: state.width },
    },
  });
  try {
    new MiniPresentation(terrain, state, { backdrop });
    return terrain;
  } catch (error) {
    terrain.dispose();
    throw error;
  }
}
