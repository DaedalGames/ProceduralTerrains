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
import { applyPlanetStyleToUniforms } from '../../engine/style/PaletteUniforms.js';
import { applyTerrainShapeUniforms, applyTerrainShadingUniforms } from '../TerrainParameters.js';
import { TerrainHeightCache } from '../effects/TerrainHeightCache.js';
import { compileMaterial } from '../resources/CompileMaterial.js';
import { withRendererState } from '../resources/RendererState.js';

function configuration(state) {
  const p = { ...DEFAULT_PARAMS, ...miniParamsPatch(state, 'all') },
    l = resolveMiniLayout(state);
  return {
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
      p = { ...t._params, ...miniParamsPatch(this.controller.state, 'all') };
    // The Mini relief/cut uses the same uniforms and evaluator as the studio.
    this.context.params = p;
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
    applyPlanetStyleToUniforms(
      t._uniforms,
      miniStylePatch(this.controller.state.recipe, this.controller.state.preset),
    );
    this.controller.applyUniforms(t._uniforms);
    t._runtime.board.syncCells({
      chunkCount: 1,
      chunkSize: l.width,
      maxHeight: l.heightScale * 1.35 + 2,
      skirtDepth: l.baseDepth,
      lodSegments: this.controller.lodSegments(),
      cells: [{ cx: 0, cz: 0 }],
      progressive: false,
    });
    while (t._runtime.board._lodRebuildQueue.length) t._runtime.board.updateLOD(t._cameraPosition);
    this.controller.syncPresentation();
    this.controller.stage.backdrop.visible = this.backdrop;
    t._miniCloudLayout = this.controller.cloudLayout();
    t._miniVolume = this.controller.underwaterVolume();
  }
  async configure(patch = {}, options = {}) {
    const state = normalizeMiniTerrainState({ ...this.controller.state, ...patch });
    this._nextState = state;
    try {
      await this.terrain.configure(configuration(state), options);
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
  const terrain = await createTerrain({
    ...options,
    configuration: { ...options.configuration, ...configuration(state) },
  });
  try {
    new MiniPresentation(terrain, state, { backdrop });
    return terrain;
  } catch (error) {
    terrain.dispose();
    throw error;
  }
}
