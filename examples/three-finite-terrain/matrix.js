import * as THREE from 'three';
import { createTerrain } from 'procedural-terrains';
import { createInfiniteTerrain } from 'procedural-terrains/infinite';
import { createPlanetTerrain } from 'procedural-terrains/planet';
import { createMiniTerrain } from 'procedural-terrains/mini';
import { createWater } from 'procedural-terrains/water';
import { createClouds } from 'procedural-terrains/clouds';
import {
  TerrainRenderPipeline,
  createHeightCache,
  createDetailCache,
} from 'procedural-terrains/render';
import { exportTerrain, zipTerrainExport } from 'procedural-terrains/export';
import { zlibSync } from 'fflate';
import {
  TerrainCompute,
  TerrainSurfaceProvider,
  createSurfaceDocument,
  createSurfaceResources,
  TerrainSurfaceWorker,
} from 'procedural-terrains/assets';
import { createBlankGraph, makeGraphNode } from 'procedural-terrains/generation';
import { createRealWorldTerrain } from 'procedural-terrains/real-world';

export async function runCase(kind) {
  const renderer = new THREE.WebGLRenderer({
    canvas: document.querySelector('canvas'),
    antialias: false,
  });
  renderer.setSize(128, 128);
  const scene = new THREE.Scene();
  scene.background = new THREE.Color('#123456');
  const camera = new THREE.PerspectiveCamera(50, 1, 1, 1e6);
  camera.position.set(300, 500, 600);
  camera.lookAt(0, 0, 0);
  const stages = [];
  const check = (label) => {
    const error = renderer.getContext().getError();
    if (error) stages.push({ label, error });
  };
  const opts = {
    renderer,
    configuration: {
      layout: { chunkCount: 2, chunkSize: 128 },
      source: { octaves: 3 },
      heightScale: 120,
      seaLevel: 25,
      quality: { lodSegments: [16, 8, 4, 2], mergeEnabled: false },
    },
  };
  let terrain, pipeline;
  const artifacts = {};
  try {
    if (kind.startsWith('infinite'))
      terrain = await createInfiniteTerrain({
        ...opts,
        configuration: {
          ...opts.configuration,
          layout: { chunkSize: 128, viewRadius: 2, cacheResolution: 64 },
        },
      });
    else if (kind.startsWith('planet')) {
      terrain = await createPlanetTerrain({
        ...opts,
        configuration: {
          ...opts.configuration,
          layout: { radius: 500, faceGrid: 2, bakeResolution: 32 },
        },
      });
      camera.position.set(800, 800, 1000);
      camera.lookAt(0, 0, 0);
    } else if (kind.startsWith('mini'))
      terrain = await createMiniTerrain({
        ...opts,
        mini: { recipe: 'cove', quality: 'balanced', width: 512 },
      });
    else if (kind === 'heightmap')
      terrain = await createTerrain({
        ...opts,
        configuration: {
          ...opts.configuration,
          source: { kind: 'heightmap', data: [0, 50, 150, 20], width: 2, height: 2 },
        },
      });
    else if (kind === 'manual')
      terrain = await createTerrain({
        ...opts,
        configuration: {
          ...opts.configuration,
          source: { kind: 'manual', document: { baseSource: 'flat', shapes: [] }, resolution: 32 },
        },
      });
    else if (kind === 'graph') {
      const graph = createBlankGraph();
      const n = makeGraphNode('constant');
      graph.nodes.push(n);
      graph.edges.push({
        id: 'height',
        source: n.id,
        sourceHandle: 'height',
        target: 'terrain-output',
        targetHandle: 'height',
        type: 'analytic-height',
      });
      terrain = await createTerrain({
        ...opts,
        configuration: { ...opts.configuration, source: { kind: 'graph', graph } },
      });
    } else if (kind === 'geo')
      terrain = await createRealWorldTerrain({
        ...opts,
        request: { bbox: { west: 0, east: 1, south: 0, north: 1 }, zoom: 0 },
        provider: {
          loadHeightmap: async () => ({
            data: [0, 20, 80, 40],
            width: 2,
            height: 2,
            attribution: 'Fixture provider',
          }),
        },
      });
    else terrain = await createTerrain(opts);
    check('construct');
    scene.add(terrain.object);
    if (kind === 'cache') createHeightCache({ terrain, resolution: 32 });
    const detail =
      kind === 'detail'
        ? createDetailCache({
            terrain,
            onError: (error) => {
              throw error;
            },
          })
        : null;
    let water, clouds;
    if (kind.startsWith('water:') || kind.endsWith(':effects') || kind === 'underwater')
      water = await createWater({
        terrain,
        mode: kind.startsWith('water:') ? kind.split(':')[1] : 'volumetric',
      });
    if (kind.startsWith('clouds:') || kind.endsWith(':effects'))
      clouds = await createClouds({
        terrain,
        mode: kind.startsWith('clouds:') ? kind.split(':')[1] : 'realistic',
        parameters: { cloudShadowsEnabled: true },
      });
    if (kind === 'underwater') {
      camera.position.set(0, 10, 30);
      camera.lookAt(0, 10, 0);
    }
    await terrain.prepare(camera);
    check('prepare');
    pipeline = new TerrainRenderPipeline({ renderer, terrains: [terrain] });
    terrain.update(kind === 'underwater' ? 1 : 0.016, { camera });
    check('update');
    pipeline.render(scene, camera);
    check('render');
    if (terrain.mini) await terrain.mini.configure({ seed: 42 });
    else await terrain.configure({ source: { seed: 42 } });
    check('configure');
    terrain.update(0.016, { camera });
    check('update2');
    pipeline.render(scene, camera);
    check('render2');
    if (kind === 'surface') {
      const raw = [];
      for (let size = 512; size >= 1; size /= 2) {
        for (let i = 0; i < size * size; i++) raw.push(145, 90, 40, 255);
        for (let i = 0; i < size * size; i++) raw.push(128, 128, 128, 255);
      }
      const bytes = zlibSync(new Uint8Array(raw));
      const sha256 = Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256', bytes)), (x) =>
        x.toString(16).padStart(2, '0'),
      ).join('');
      const document = createSurfaceDocument({ settings: { profile: 'eco' } });
      document.roles = Object.fromEntries(
        Object.keys(document.roles).map((role) => [role, 'polyhaven:red_sand']),
      );
      const provider = new TerrainSurfaceProvider({
        baseUrl: 'https://pack.invalid/',
        fetch: async (url) =>
          url.endsWith('catalog.json')
            ? {
                ok: true,
                json: async () => ({
                  assets: [
                    {
                      id: 'polyhaven:red_sand',
                      name: 'Fixture',
                      physicalSize: [2, 2],
                      resolutions: { 512: { path: 'fixture.pbr', sha256 } },
                    },
                  ],
                }),
              }
            : { ok: true, arrayBuffer: async () => bytes.buffer },
      });
      const surface = await createSurfaceResources({ document, provider });
      try {
        await terrain.setSurface(surface);
        terrain.update(0.016, { camera });
        pipeline.render(scene, camera);
        check('surface');
        artifacts.surfaceArray = terrain._material.defines.SURFACE_ARRAYS === 1;
        await terrain.setSurface(null);
      } finally {
        surface.dispose();
        provider.dispose();
      }
    }
    if (kind === 'surface-worker') {
      const worker = new TerrainSurfaceWorker();
      const document = createSurfaceDocument({ settings: { profile: 'eco' } });
      document.roles = Object.fromEntries(
        Object.keys(document.roles).map((role) => [role, 'polyhaven:red_sand']),
      );
      let surface;
      try {
        surface = await worker.prepare({
          provider: { baseUrl: new URL('/__fixture__/', location.href).href },
          document,
        });
        await terrain.setSurface(surface);
        pipeline.render(scene, camera);
        check('surface-worker');
        await terrain.setSurface(null);
        artifacts.surfaceWorker = surface.backend === 'array';
      } finally {
        surface?.dispose();
        worker.dispose();
      }
    }
    if (kind === 'export' || kind.endsWith(':export')) {
      const result = await exportTerrain(terrain, {
        ...(terrain.mode === 'infinite' ? { region: { cx: 120, cz: -180, size: 256 } } : {}),
        format: 'glb',
        meshRes: 4,
        texRes: 8,
        exportHeightmap: true,
        bakeColor: true,
      });
      artifacts.files = Object.keys(result.files);
      artifacts.zipBytes = zipTerrainExport(result).byteLength;
    }
    if (kind === 'worker') {
      const compute = new TerrainCompute();
      try {
        const input = new Float32Array(16).fill(5);
        const output = await compute.erode({
          heightmap: input,
          width: 4,
          height: 4,
          params: { iterations: 1 },
        });
        artifacts.worker = { samples: output.delta.length, untouched: input.byteLength === 64 };
      } finally {
        compute.dispose();
      }
    }
    if (detail) {
      for (let i = 0; i < 60 && !detail.cache.hasReadyPage; i++) {
        terrain.update(0.016, { camera });
        await new Promise((resolve) => setTimeout(resolve, 10));
      }
      artifacts.detail = detail.getDiagnostics();
      if (!detail.cache.hasReadyPage) throw new Error('Detail worker produced no GPU pages');
    }
    const pixels = new Uint8Array(128 * 128 * 4);
    renderer.readRenderTargetPixels(pipeline.target, 0, 0, 128, 128, pixels);
    const colors = new Set();
    for (let i = 0; i < pixels.length; i += 4)
      colors.add(`${pixels[i]},${pixels[i + 1]},${pixels[i + 2]}`);
    let changed = 0;
    for (let i = 0; i < pixels.length; i += 4)
      if (pixels[i] !== 18 || pixels[i + 1] !== 52 || pixels[i + 2] !== 86) changed++;
    return {
      kind,
      diagnostics: terrain.getDiagnostics(),
      water: water?.getDiagnostics(),
      clouds: clouds?.getDiagnostics(),
      changed,
      colors: colors.size,
      glError: stages[0]?.error ?? renderer.getContext().getError(),
      stages,
      ...artifacts,
    };
  } finally {
    pipeline?.dispose();
    terrain?.dispose();
    renderer.dispose();
  }
}
window.runCase = runCase;
