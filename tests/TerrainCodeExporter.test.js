import { describe, it, expect } from 'vitest';
import { transform } from 'esbuild';
import { createTerrainCodeDocument, createTerrainCodeFiles } from '../src/export/TerrainCodeExporter.js';
import { loadTerrainDocument } from '../src/runtime/TerrainDocument.js';
import { readEditableProjectDocument } from '../src/project/ProjectDocument.js';
import { createBlankGraph, makeGraphNode } from '../src/engine/terrain/graph/GraphDocument.js';
import { createMiniTerrainState } from '../src/engine/mini/MiniTerrainSettings.js';

const project = (patch = {}) => ({
  worldMode: 'studio', editorMode: 'procedural', generationSource: 'classic',
  params: { seed: 4294967295, chunkCount: 2, waterMode: 'off' },
  tiles: [{ cx: 0, cz: 0 }], tileAssemblyShape: 'square', ...patch,
});
const decode = (bytes) => new TextDecoder().decode(bytes);

describe('npm terrain code export', () => {
  it('round-trips a studio noise source through the public document loader without DOM', async () => {
    const { document } = createTerrainCodeDocument(project());
    const terrain = await loadTerrainDocument(document, { renderer: { isWebGLRenderer: true } });
    try {
      expect(terrain.configuration.source.seed).toBe(4294967295);
      expect(terrain.serialize()).toEqual(document);
      expect(Number.isFinite(terrain.sampleHeight(10, 20))).toBe(true);
    } finally { terrain.dispose(); }
  });

  it.each([['studio', 'finite'], ['infinite', 'infinite'], ['planet', 'planet']])(
    'maps %s to a validated %s document', (worldMode, kind) => {
      const { document } = createTerrainCodeDocument(project({ worldMode }));
      expect(document.kind).toBe(kind);
      if (kind === 'planet') expect(document.configuration.layout.radius).toBe(16000);
      if (kind === 'infinite') expect(document.configuration.layout.viewRadius).toBe(8);
    },
  );

  it('preserves graph and manual generation documents without freezing studio input', () => {
    const graph = createBlankGraph();
    const node = makeGraphNode('constant');
    node.params.value = 0.25;
    graph.nodes.push(node);
    graph.edges.push({ id: 'h', source: node.id, sourceHandle: 'height', target: 'terrain-output', targetHandle: 'height', type: 'analytic-height' });
    const saved = project({ editorMode: 'nodes', generationSource: 'graph', graph });
    const { document } = createTerrainCodeDocument(saved);
    expect(document.configuration.source.kind).toBe('graph');
    expect(document.configuration.source.graph).toEqual(graph);
    node.params.value = 0.5;
    expect(document.configuration.source.graph.nodes[1].params.value).toBe(0.25);
    const manual = createTerrainCodeDocument(project({
      editorMode: 'manual',
      manualTerrain: { baseSource: 'nodes', shapes: [] }, graph,
    })).document;
    expect(manual.configuration.source.kind).toBe('manual');
    expect(manual.configuration.source.graph).toEqual(graph);
  });

  it('serializes Mini, water and realistic clouds as public extensions', () => {
    const miniTerrain = createMiniTerrainState({ recipe: 'cove', seed: 42 });
    const { document } = createTerrainCodeDocument(project({
      miniTerrain,
      params: { chunkCount: 1, waterMode: 'stylized', cloudsEnabled: true, cloudRenderMode: 'realistic' },
    }));
    expect(document.extensions.map((item) => item.type)).toEqual(['mini', 'water', 'clouds']);
    expect(document.extensions[0].state).toEqual(miniTerrain);
    expect(document.extensions[1].mode).toBe('stylized');
    expect(document.extensions[2].mode).toBe('realistic');
  });

  it('emits parseable JS, consistent JSON, install instructions and an editable project', async () => {
    const saved = project({ params: { seed: 123, chunkCount: 2, waterMode: 'off' }, paint: { version: 1 } });
    const files = createTerrainCodeFiles(saved);
    expect(Object.keys(files)).toHaveLength(7);
    const code = decode(files['code/terrain.js']);
    const document = JSON.parse(decode(files['code/terrain.json']));
    expect(code).toContain(JSON.stringify(document, null, 2));
    expect(code).toContain("from 'procedural-terrains/documents'");
    await expect(transform(code, { loader: 'js', format: 'esm' })).resolves.toBeDefined();
    await expect(transform(decode(files['code/main.js']), { loader: 'js', format: 'esm' })).resolves.toBeDefined();
    const editable = readEditableProjectDocument(JSON.parse(decode(files['code/studio-project.ptrterrain'])));
    expect(editable.terrain.params.seed).toBe(123);
    expect(editable.terrain.paint).toEqual(saved.paint);
    expect(decode(files['code/README.md'])).toContain('Studio paint, erosion and destruction');
    expect(decode(files['code/README.md'])).toContain('npm install /path/to/dist/npm/');
    expect(JSON.parse(decode(files['code/package.json'])).scripts.build).toBe('vite build');
  });

  it('reports unsupported studio layouts instead of silently claiming parity', () => {
    const { warnings } = createTerrainCodeDocument(project({
      tiles: [{ cx: 1, cz: 0 }], tileAssemblyShape: 'circle',
      realWorldSource: { type: 'elevation' },
    }));
    expect(warnings.join('\n')).toContain('one centred square board');
    expect(warnings.join('\n')).toContain('Circular Tile clipping');
    expect(warnings.join('\n')).toContain('explicit real-world provider');
  });
});
