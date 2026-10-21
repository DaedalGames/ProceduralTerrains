import { describe, expect, it, vi } from 'vitest';
import { Engine } from '../src/engine/Engine.js';
import { DEFAULT_PARAMS } from '../src/engine/presets.js';
import { MiniTerrainController } from '../src/engine/mini/MiniTerrainController.js';
import { createMiniTerrainState, miniParamsPatch } from '../src/engine/mini/MiniTerrainSettings.js';
import { createEditableProjectDocument, readEditableProjectDocument } from '../src/project/ProjectDocument.js';

// Exercise the real payload and load paths with rendering and GPU work stubbed.
function projectEngine(state = null) {
  const engine = Object.create(Engine.prototype);
  Object.assign(engine, {
    params: { ...DEFAULT_PARAMS },
    tiles: [{ cx: 0, cz: 0 }],
    tileAssemblyShape: 'square',
    circleRadiusCells: 0,
    projectMode: 'procedural',
    generationSource: 'classic',
    worldMode: 'studio',
    graphView: { x: 0, y: 0, zoom: 1 },
    cb: { onToast: vi.fn(), onParams: vi.fn() },
    controls: { goalTarget: { set: vi.fn() } },
    planetStyle: { importJSON: vi.fn(), setStyle: vi.fn(), applyPlanetPreset: vi.fn() },
    serializeState: () => ({ params: {} }),
    _syncPlanetStyleToParams: vi.fn(),
    _applyPerformance: vi.fn(),
    _notifyPerf: vi.fn(),
    _bindAuthoringMaskTextures: vi.fn(),
    setTimeOfDay: vi.fn(),
    applyAll: vi.fn(),
    rebuildActiveHeightProgram: vi.fn(async () => ({ swapped: true })),
    _clearImportedMaps: vi.fn(),
    waitForTerrainReady: vi.fn(async () => {}),
    _notifyTiles: vi.fn(),
    getExplodeToolState: vi.fn(),
  });
  engine.mini = new MiniTerrainController(engine);
  engine.mini._ensureObjects = vi.fn();
  engine.mini.install(state);
  if (state) Object.assign(engine.params, miniParamsPatch(state));
  return engine;
}

const edits = {
  heightScale: 370, terrainFormationSeaLevel: 31, seaLevel: 104,
  waterMode: 'off', waterEnabled: false, waterQualityPreset: 'high',
  waterOpacity: 0.37, waterWaveStrength: 0.23, waterDioramaReflectionStrength: 0.62,
  noiseScale: 23, ridge: 0.27, octaves: 4, terrainSmoothing: 0.45,
  falloff: 0.35, edgeFalloffMode: 'island',
  cloudCoverage: 0.43, cloudAltitude: 701, cloudRenderMode: 'legacy',
  propsDensity: 0.71, propsTreeScale: 3.2,
};

describe('Mini project settings persistence', () => {
  it.each(['procedural', 'cove', 'hexagon'])('keeps edited settings after saving and loading a %s Mini', async (variant) => {
    const recipe = variant === 'hexagon' ? 'procedural' : variant;
    const state = {
      ...createMiniTerrainState({ recipe, preset: 'dunes', seed: 1936579376 }),
      shape: variant === 'hexagon' ? 'hexagon' : 'circle', relief: 1.2, quality: 'capture', cutStyle: 'dark',
      cloudSpread: 75, waterEdges: 0.8, waterBevel: 3, terrainBevel: 2,
      backdrop: [0.8, 0.7, 0.6], socle: false,
      camera: { views: [{ name: 'Saved view', theta: 0.5, phi: 1, radius: 1500, target: [0, 40, 0] }] },
    };
    const source = projectEngine(state);
    expect(source.mini.state.recipe).toBe(recipe);
    Object.assign(source.params, edits);
    const payload = source.createProjectPayload();
    expect(payload.params).toMatchObject(edits);
    const document = JSON.parse(JSON.stringify(createEditableProjectDocument({ terrain: payload })));
    const loaded = projectEngine();
    await loaded.loadSeedJSON(readEditableProjectDocument(document).terrain);
    expect(loaded.params).toMatchObject(edits);
    expect(loaded.mini.serialize()).toEqual(source.mini.serialize());
    expect(loaded.cb.onParams).toHaveBeenLastCalledWith(expect.objectContaining(edits));
  });

  it('keeps staged height and noise edits when Auto Update is off', async () => {
    const source = projectEngine(createMiniTerrainState());
    source.params.autoUpdate = false;
    source._pendingTerrainParams = { heightScale: 370, noiseScale: 19 };
    const loaded = projectEngine();
    await loaded.loadSeedJSON(JSON.parse(JSON.stringify(source.createProjectPayload())));
    expect(loaded.params).toMatchObject({ autoUpdate: false, heightScale: 370, noiseScale: 19 });
  });

  it('still enforces the footprint and single tile while keeping authored settings', async () => {
    const state = { ...createMiniTerrainState(), width: 1536 };
    const source = projectEngine(state);
    Object.assign(source.params, edits, { chunkCount: 4, chunkSize: 256 });
    source.tiles = [{ cx: 0, cz: 0 }, { cx: 1, cz: 0 }];
    const loaded = projectEngine();
    await loaded.loadSeedJSON(source.createProjectPayload());
    expect(loaded.params).toMatchObject({ ...edits, chunkCount: 1, chunkSize: 1536 });
    expect(loaded.tiles).toEqual([{ cx: 0, cz: 0 }]);
  });

  it('fills missing Mini structural settings from the document', async () => {
    const state = createMiniTerrainState({ preset: 'alpine' });
    const source = projectEngine(state);
    const payload = source.createProjectPayload();
    for (const key of Object.keys(miniParamsPatch(state, 'structure'))) delete payload.params[key];
    const loaded = projectEngine();
    await loaded.loadSeedJSON(payload);
    expect(loaded.params).toMatchObject(miniParamsPatch(state, 'structure'));
  });

  it('uses Mini defaults for invalid saved height and water settings', async () => {
    const source = projectEngine(createMiniTerrainState());
    const payload = source.createProjectPayload();
    Object.assign(payload.params, {
      heightScale: NaN, terrainFormationSeaLevel: Infinity,
      waterMode: null, waterQualityPreset: 42,
    });
    const loaded = projectEngine();
    await loaded.loadSeedJSON(payload);
    expect(loaded.params).toMatchObject(miniParamsPatch(source.mini.state, 'structure'));
  });

  it('retains the v1 full-look migration and v2 shape migration', async () => {
    const state = createMiniTerrainState();
    const original = miniParamsPatch(state);
    for (const version of [1, 2]) {
      const source = projectEngine(state);
      Object.assign(source.params, edits);
      const payload = source.createProjectPayload();
      payload.miniTerrain.version = version;
      const loaded = projectEngine();
      await loaded.loadSeedJSON(payload);
      if (version === 1) expect(loaded.params).toMatchObject(original);
      else {
        expect(loaded.params).toMatchObject(miniParamsPatch(state, 'shape'));
        expect(loaded.params).toMatchObject({ heightScale: 370, seaLevel: 104, waterMode: 'off' });
      }
    }
  });

  it('leaves regular projects without a Mini section unchanged', async () => {
    const source = projectEngine();
    Object.assign(source.params, edits, { chunkCount: 4, chunkSize: 256 });
    const loaded = projectEngine();
    await loaded.loadSeedJSON(source.createProjectPayload());
    expect(loaded.params).toMatchObject({ ...edits, chunkCount: 4, chunkSize: 256 });
    expect(loaded.mini.state).toBeNull();
  });
});
