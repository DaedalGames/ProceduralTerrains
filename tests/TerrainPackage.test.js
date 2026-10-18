import { describe, it, expect, vi } from 'vitest';
import * as THREE from 'three';
import { createTerrain } from '../packages/procedural-terrains/index.js';
import { createInfiniteTerrain } from '../packages/procedural-terrains/infinite.js';
import { createPlanetTerrain } from '../packages/procedural-terrains/planet.js';
import { createMiniTerrain } from '../packages/procedural-terrains/mini.js';
import { loadTerrainDocument } from '../packages/procedural-terrains/documents.js';
import {
  TerrainResources,
  TerrainCompute,
  TerrainSurfaceProvider,
} from '../packages/procedural-terrains/assets.js';
import {
  createRealWorldTerrain,
  TerrariumProvider,
} from '../packages/procedural-terrains/real-world.js';
import {
  createBlankGraph,
  makeGraphNode,
  makeLayer,
  makeStack,
} from '../packages/procedural-terrains/generation.js';
import { SurfacePreparationClient } from '../src/engine/terrain/surface/SurfacePreparationClient.js';
import { RevisionScope } from '../src/runtime/resources/RevisionScope.js';
import { withRendererState } from '../src/runtime/resources/RendererState.js';
vi.mock('../src/engine/render/ProgramHealthGate.js', () => ({
  validatePrograms: vi.fn(async () => ({ ok: true })),
  programHealthError: () => new Error('Shader failure'),
}));
const renderer = () => ({
  isWebGLRenderer: true,
  compileAsync: vi.fn(async () => {}),
  getCurrentViewport: (v) => v.set(0, 0, 100, 100),
});
const config = {
  layout: { chunkCount: 1, chunkSize: 128 },
  quality: { lodSegments: [16, 8, 4, 2] },
};
const make = (source) =>
  createTerrain({ renderer: renderer(), configuration: { ...config, source } });
const deferred = () => {
  let resolve;
  return {
    promise: new Promise((r) => {
      resolve = r;
    }),
    resolve,
  };
};

describe('independent sources and world contracts', () => {
  it('round-trips a borrowed heightmap without retaining or freezing the input', async () => {
    const data = new Float32Array([10, 20, 30, 40]);
    const t = await make({ kind: 'heightmap', data, width: 2, height: 2 });
    data[0] = 999;
    expect(t.sampleHeight(-32, -32)).toBe(10);
    expect(t.sampleHeight(0, 0)).toBe(25);
    const restored = await loadTerrainDocument(t.serialize(), { renderer: renderer() });
    expect(restored.sampleHeight(32, 32)).toBe(40);
    expect(t.sampleHeight(1000, 0)).toBeNull();
    t.dispose();
    restored.dispose();
  });
  it('compiles a node document and preserves its uniforms on unrelated edits', async () => {
    const graph = createBlankGraph(),
      node = makeGraphNode('constant');
    node.params.value = 0.25;
    graph.nodes.push(node);
    graph.edges.push({
      id: 'height',
      source: node.id,
      sourceHandle: 'height',
      target: 'terrain-output',
      targetHandle: 'height',
      type: 'analytic-height',
    });
    const t = await make({ kind: 'graph', graph });
    expect(t._source.program.kind).toBe('graph');
    await t.configure({ lighting: { sunElevation: 40 } });
    expect(t.configuration.source.graph.nodes).toHaveLength(2);
    expect(Number.isFinite(t.sampleHeight(0, 0))).toBe(true);
    t.dispose();
  });
  it('switches manual, procedural and heightmap sources and retires old textures', async () => {
    const t = await make({
      kind: 'manual',
      document: { baseSource: 'flat', shapes: [] },
      resolution: 32,
    });
    expect(t.sampleHeight(0, 0)).toBe(0);
    const retired = vi.fn();
    t._source.texture.addEventListener('dispose', retired);
    await t.configure({ source: { kind: 'noise', stack: makeStack([makeLayer('legacy')]) } });
    expect(retired).toHaveBeenCalledOnce();
    expect(Number.isFinite(t.sampleHeight(0, 0))).toBe(true);
    expect(t._uniforms.uManualEnabled.value).toBe(0);
    t.dispose();
  });
  it('retains the source field and its GPU texture on lighting-only edits', async () => {
    const t = await make({
      kind: 'heightmap',
      data: [-1000, 2000, 4000, 6000],
      width: 2,
      height: 2,
    });
    const source = t._source,
      texture = source.texture;
    await t.configure({ lighting: { sunElevation: 40 } });
    expect(t._source).toBe(source);
    expect(t._source.texture).toBe(texture);
    expect(t._runtime.board._maxHeight).toBeGreaterThanOrEqual(6000);
    expect(t._runtime.board._skirtDepth).toBeGreaterThan(1000);
    t.dispose();
  });
  it('does not dispose borrowed PBR resources shared by two terrains', async () => {
    const a = await make({ kind: 'noise' }),
      b = await make({ kind: 'noise' });
    const surface = {
      backend: 'array',
      diffuse: new THREE.DataArrayTexture(new Uint8Array(4), 1, 1, 1),
      props: new THREE.DataArrayTexture(new Uint8Array(4), 1, 1, 1),
    };
    const disposed = vi.fn();
    surface.diffuse.addEventListener('dispose', disposed);
    await a.setSurface(surface);
    await b.setSurface(surface);
    a.dispose();
    expect(disposed).not.toHaveBeenCalled();
    expect(b._uniforms.uSurfaceArrayMode.value).toBe(1);
    await b.setSurface(null);
    b.dispose();
    expect(disposed).not.toHaveBeenCalled();
    surface.diffuse.dispose();
    surface.props.dispose();
    expect(disposed).toHaveBeenCalledOnce();
  });
  it('keeps the last material and bindings when a PBR candidate fails compilation', async () => {
    const r = renderer(),
      t = await createTerrain({ renderer: r, configuration: config }),
      material = t._material;
    const surface = {
      backend: 'array',
      diffuse: new THREE.DataArrayTexture(new Uint8Array(4), 1, 1, 1),
      props: new THREE.DataArrayTexture(new Uint8Array(4), 1, 1, 1),
    };
    r.compileAsync.mockRejectedValueOnce(new Error('PBR compile failed'));
    await expect(t.setSurface(surface)).rejects.toThrow('PBR compile failed');
    expect(t._material).toBe(material);
    expect(t._surface).toBe(null);
    expect(t._uniforms.uSurfaceArrayMode.value).toBe(0);
    t.dispose();
    surface.diffuse.dispose();
    surface.props.dispose();
  });
  it('detaches manual sculpt/paint documents before freezing public configuration', async () => {
    const document = { baseSource: 'flat', shapes: [], surfacePaint: { version: 1 } };
    const t = await make({ kind: 'manual', document, resolution: 32 });
    document.surfacePaint.version = 999;
    document.shapes.push({ type: 'hill' });
    expect(t.configuration.source.document.surfacePaint.version).toBe(1);
    expect(t.configuration.source.document.shapes).toHaveLength(0);
    t.dispose();
  });
  it('requires a graph when a manual document uses a nodes base', async () => {
    await expect(make({ kind: 'manual', document: { baseSource: 'nodes' } })).rejects.toThrow(
      'requires source.graph',
    );
  });
  it('keeps world-specific source constraints explicit and world ownership isolated', async () => {
    await expect(
      createPlanetTerrain({ renderer: renderer(), configuration: { source: { kind: 'manual' } } }),
    ).rejects.toThrow('3D evaluator');
    await expect(
      createInfiniteTerrain({
        renderer: renderer(),
        configuration: { source: { kind: 'heightmap' } },
      }),
    ).rejects.toThrow('finite terrain');
    const t = await createInfiniteTerrain({
      renderer: renderer(),
      configuration: { ...config, layout: { chunkSize: 64, viewRadius: 2, cacheResolution: 64 } },
    });
    expect(t.mode).toBe('infinite');
    expect(Number.isFinite(t.sampleHeight(1e5, 1e5))).toBe(true);
    expect(t.serialize().kind).toBe('infinite');
    t.dispose();
    const planet = await createPlanetTerrain({
      renderer: renderer(),
      configuration: { ...config, layout: { radius: 500, faceGrid: 1, bakeResolution: 16 } },
    });
    expect(Number.isFinite(planet.sampleHeight3D(1, 0, 0))).toBe(true);
    expect(() => planet.sampleHeight(0, 0)).toThrow('sampleHeight3D');
    planet.dispose();
  });
  it('publishes the current planet shader to future folded-patch batches', async () => {
    const t = await createPlanetTerrain({
      renderer: renderer(),
      configuration: { ...config, layout: { radius: 500, faceGrid: 1, bakeResolution: 16 } },
    });
    const old = t._runtime.world._ensurePatchMaterial();
    const prepare = vi.spyOn(t._world, 'prepare').mockResolvedValue();
    try {
      await t.configure({ source: { octaves: 3 } });
      expect(t._material).not.toBe(old);
      expect(t._runtime.world._ensurePatchMaterial()).toBe(t._material);
      expect(t._runtime.world._patchMaterial.defines.OCTAVES).toBe(3);
    } finally {
      prepare.mockRestore();
      t.dispose();
    }
  });
  it('creates Mini presentation without camera controls, DOM or an animation loop', async () => {
    const t = await createMiniTerrain({
      renderer: renderer(),
      mini: { recipe: 'cove', quality: 'balanced', width: 512 },
    });
    expect(t.mini.state.recipe).toBe('cove');
    expect(t.mini.framing().radius).toBeGreaterThan(0);
    expect(t._runtime.board.geometries[0].attributes.position.count).toBeGreaterThan(16000);
    expect(t.serialize().extensions[0].type).toBe('mini');
    expect(t.mini.controller.stage.backdrop.visible).toBe(false);
    t.dispose();
  });
  it('rejects bad documents and cleans partially constructed extension loads', async () => {
    await expect(
      loadTerrainDocument(
        { format: 'procedural-terrains', schemaVersion: 99 },
        { renderer: renderer() },
      ),
    ).rejects.toThrow('Unsupported');
    const t = await make({ kind: 'noise' }),
      doc = t.serialize();
    doc.extensions = [{ type: 'unknown' }];
    await expect(loadTerrainDocument(doc, { renderer: renderer() })).rejects.toThrow('extension');
    t.dispose();
  });
});

describe('owned resources and asynchronous work', () => {
  it('reference-counts shared assets while keeping unrelated scopes alive', () => {
    const resources = new TerrainResources(),
      dispose = vi.fn(),
      create = vi.fn(() => ({ dispose }));
    const a = resources.acquire('shared', create),
      b = resources.acquire('shared', create);
    expect(a.value).toBe(b.value);
    expect(create).toHaveBeenCalledOnce();
    expect(() => resources.dispose()).toThrow('Release active');
    a.release();
    expect(dispose).not.toHaveBeenCalled();
    b.release();
    b.release();
    expect(dispose).toHaveBeenCalledOnce();
    resources.dispose();
  });
  it('resolves explicit assets with cancellation and no implicit network', async () => {
    const r = new TerrainResources();
    await expect(r.read('asset')).rejects.toThrow('resolveAsset');
    r.dispose();
    const signal = AbortSignal.abort();
    const resolver = vi.fn();
    const s = new TerrainResources({ resolveAsset: resolver });
    await expect(s.read('a', { signal })).rejects.toBeTruthy();
    expect(resolver).not.toHaveBeenCalled();
    s.dispose();
  });
  it('isolates surface workers between engines and cleans job listeners', async () => {
    const wa = { postMessage: vi.fn(), terminate: vi.fn() },
      wb = { postMessage: vi.fn(), terminate: vi.fn() };
    const a = new SurfacePreparationClient({ workerFactory: () => wa }),
      b = new SurfacePreparationClient({ workerFactory: () => wb });
    const one = a.prepare({}),
      two = b.prepare({});
    const first = expect(one).rejects.toMatchObject({ code: 'SURFACE_ATLAS_SUPERSEDED' });
    a.cancel();
    await first;
    expect(wa.terminate).toHaveBeenCalledOnce();
    expect(wb.terminate).not.toHaveBeenCalled();
    wb.onerror({ message: 'fixture failure' });
    await expect(two).rejects.toThrow('fixture failure');
    a.dispose();
    b.dispose();
  });
  it('aborts one erosion worker without detaching the caller grid or cancelling another', async () => {
    const workers = [];
    const service = new TerrainCompute({
      workerFactory: () => {
        const w = { terminate: vi.fn(), postMessage: vi.fn() };
        workers.push(w);
        return w;
      },
    });
    const signal = new AbortController(),
      grid = new Float32Array(16),
      a = service.erode({ heightmap: grid, width: 4, height: 4 }, { signal: signal.signal }),
      b = service.erode({ heightmap: grid, width: 4, height: 4 });
    signal.abort();
    await expect(a).rejects.toBeTruthy();
    expect(grid.byteLength).toBe(64);
    expect(workers[0].terminate).toHaveBeenCalledOnce();
    expect(workers[1].terminate).not.toHaveBeenCalled();
    workers[1].onmessage({ data: { type: 'result', delta: new Float32Array(16) } });
    expect((await b).delta).toHaveLength(16);
    service.dispose();
  });
  it('never publishes late effect work after supersession or destruction', async () => {
    const scope = new RevisionScope(),
      d = deferred();
    let published = 0;
    const a = scope.run(async (check) => {
      await d.promise;
      check();
      published++;
    });
    const rejection = expect(a).rejects.toMatchObject({ code: 'TERRAIN_SUPERSEDED' });
    await scope.run(async (check) => {
      check();
      published++;
    });
    await rejection;
    d.resolve();
    await Promise.resolve();
    expect(published).toBe(1);
    scope.dispose();
    await expect(scope.run(() => {})).rejects.toMatchObject({ code: 'TERRAIN_DISPOSED' });
  });
  it('restores render targets, viewport, clear and XR state after a failed pass', () => {
    const old = { name: 'host' },
      viewport = new THREE.Vector4(3, 4, 90, 80),
      scissor = new THREE.Vector4(1, 2, 20, 30);
    let target = old,
      test = true,
      color = new THREE.Color('red'),
      alpha = 0.5;
    const r = {
      getRenderTarget: () => target,
      setRenderTarget: (t) => {
        target = t;
      },
      getViewport: (v) => v.copy(viewport),
      setViewport: (v) => viewport.copy(v),
      getScissor: (v) => v.copy(scissor),
      setScissor: (v) => scissor.copy(v),
      getScissorTest: () => test,
      setScissorTest: (v) => {
        test = v;
      },
      getClearColor: (v) => v.copy(color),
      getClearAlpha: () => alpha,
      setClearColor: (c, a) => {
        color = c;
        alpha = a;
      },
      autoClear: false,
      xr: { enabled: true },
      shadowMap: { autoUpdate: false },
    };
    expect(() =>
      withRendererState(r, () => {
        r.setRenderTarget(null);
        viewport.set(0, 0, 1, 1);
        r.xr.enabled = false;
        throw new Error('pass');
      }),
    ).toThrow('pass');
    expect(target).toBe(old);
    expect(viewport.toArray()).toEqual([3, 4, 90, 80]);
    expect(r.xr.enabled).toBe(true);
    expect(r.autoClear).toBe(false);
  });
});

describe('explicit external providers', () => {
  it('builds real-world terrain from an injected provider without network access', async () => {
    const provider = {
      loadHeightmap: vi.fn(async () => ({
        width: 2,
        height: 2,
        data: [10, 20, 30, 40],
        attribution: 'Fixture source',
      })),
    };
    const t = await createRealWorldTerrain({
      renderer: renderer(),
      configuration: config,
      provider,
      request: { bbox: { west: 0, east: 1, south: 0, north: 1 }, zoom: 0 },
    });
    expect(t.attribution).toBe('Fixture source');
    expect(t.sampleHeight(0, 0)).toBe(25);
    t.dispose();
  });
  it('requires explicit endpoints and validates requests before fetching', async () => {
    expect(() => new TerrariumProvider()).toThrow('elevationTileUrl');
    const fetch = vi.fn(),
      p = new TerrariumProvider({ elevationTileUrl: () => '/tile', fetch });
    await expect(
      p.loadHeightmap({ bbox: { west: 170, east: -170, south: 0, north: 1 }, zoom: 1 }),
    ).rejects.toThrow('bbox');
    await expect(
      p.loadHeightmap({ bbox: { west: 0, east: 10, south: 0, north: 10 }, zoom: 18 }),
    ).rejects.toThrow('budget');
    expect(fetch).not.toHaveBeenCalled();
  });
  it('keeps surface provider catalogs and URL resolution scoped to their owner', async () => {
    const fetch = vi.fn(async () => ({ ok: true, json: async () => ({ assets: [] }) }));
    const a = new TerrainSurfaceProvider({ baseUrl: 'https://assets.invalid/pack', fetch }),
      b = new TerrainSurfaceProvider({ baseUrl: 'https://assets.invalid/other', fetch });
    expect(a.resolveUrl('a')).toBe('https://assets.invalid/pack/a');
    await a.loadCatalog();
    await a.loadCatalog();
    await b.loadCatalog();
    expect(fetch).toHaveBeenCalledTimes(2);
    expect(a.cache).not.toBe(b.cache);
    a.dispose();
    b.dispose();
  });
});
