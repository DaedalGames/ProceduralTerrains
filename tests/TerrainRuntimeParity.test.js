import { miniParamsPatch } from '../src/engine/mini/MiniTerrainSettings.js';
import { miniStylePatch } from '../src/engine/mini/MiniLook.js';
import { describe, it, expect, vi } from 'vitest';
import * as THREE from 'three';
import { createTerrain } from '../src/runtime/FiniteTerrain.js';
import { MiniPresentation } from '../src/runtime/worlds/MiniTerrain.js';
import { loadTerrainDocument } from '../src/runtime/TerrainDocument.js';
import { createTerrainCodeDocument } from '../src/export/TerrainCodeExporter.js';
import { applyTerrainShapeUniforms, applyTerrainShadingUniforms } from '../src/runtime/TerrainParameters.js';
import { applyTerrainDetailUniforms, applyTerrainVisualUniforms } from '../src/runtime/TerrainAppearance.js';
import { createTerrainUniforms } from '../src/engine/terrain/TerrainMaterial.js';
import { DEFAULT_PARAMS } from '../src/engine/presets.js';
vi.mock('../src/engine/render/ProgramHealthGate.js', () => ({ validatePrograms: vi.fn(async () => ({ ok: true })), programHealthError: () => new Error('Shader failure') }));
const renderer = () => ({ isWebGLRenderer: true, compileAsync: vi.fn(async () => {}), getCurrentViewport: v => v.set(0,0,128,128) });
const mini = { recipe: 'procedural', preset: 'dunes', seed: 1885913737, width: 1024, quality: 'high', relief: 1.6, shape: 'circle' };
function project() { return { worldMode: 'studio', params: { ...DEFAULT_PARAMS, seed: 1936579376, heightScale: 370, seaLevel: 104, terrainFormationSeaLevel: 77, noiseScale: 80.5, noiseStrength: 2, terrainSmoothing: 1, warp: .95, chunkCount: 1, chunkSize: 1024, waterMode: 'off', biomeScale: 2.3, normalStrength: 1.15, visualsRockDetail: .82 }, miniTerrain: mini }; }

describe('studio to package appearance parity', () => {
  it('preserves edited source, relief, palette and shader inputs when installing Mini', async () => {
    const p = project();
    const { document } = createTerrainCodeDocument(p, { quality: { terrainDetailQuality: 3, terrainDetailStrength: 1.1 } });
    const t = await loadTerrainDocument(document, { renderer: renderer() });
    const expected = createTerrainUniforms();
    const source = { ...p.params, ...document.configuration.material };
    applyTerrainShapeUniforms(expected, source, 1024);
    applyTerrainShadingUniforms(expected, source, { size: 1024, skirtDepth: t._uniforms.uSkirtDepth.value, wallThickness: 0 });
    applyTerrainDetailUniforms(expected, source);
    applyTerrainVisualUniforms(expected, source);
    for (const key of ['uHeightScale','uSeaLevel','uTerrainFormationSeaLevel','uSeedOffset','uFrequency','uAmplitude','uWarp','uNormalStrength','uBiomeScale','uTerrainDetailQuality','uTerrainDetailStrength','uVisualRockDetail'])
      expect(t._uniforms[key].value, key).toEqual(expected[key].value);
    expect(t._uniforms.uColGrass.value.toArray()).toEqual(document.configuration.palette.grass);
    expect(t._runtime.board._maxHeight).toBeGreaterThanOrEqual(370 * 1.35);
    expect(t.serialize().configuration).toEqual(document.configuration);
    t.dispose();
  });
  it('loads legacy Mini exports with presentation defaults without losing custom source edits', async () => {
    const { document } = createTerrainCodeDocument(project());
    delete document.configuration.material;
    delete document.configuration.style;
    delete document.configuration.terrainFormationSeaLevel;
    const t = await loadTerrainDocument(document, { renderer: renderer() });
    const defaults = miniParamsPatch(mini, 'all');
    expect(t._uniforms.uHeightScale.value).toBe(370);
    expect(t.configuration.source.seed).toBe(1936579376);
    expect(t.configuration.source.scale).toBe(80.5);
    expect(t._uniforms.uNormalStrength.value).toBe(defaults.normalStrength);
    expect(t.configuration.style.sunIntensity).toBe(miniStylePatch(mini.recipe, mini.preset).sunIntensity);
    expect(t.configuration.terrainFormationSeaLevel).toBe(defaults.terrainFormationSeaLevel);
    t.dispose();
  });
  it('does not regenerate the source or reset custom height on a presentation edit', async () => {
    const { document } = createTerrainCodeDocument(project());
    const t = await loadTerrainDocument(document, { renderer: renderer() });
    vi.spyOn(t.mini.cache, 'prepare').mockResolvedValue();
    const source = t._source;
    const heights = [-200,0,200].map(x => t.sampleHeight(x,0));
    await t.mini.configure({ cutStyle: 'soil' });
    expect(t.mini.state.cutStyle).toBe('soil');
    expect(t._source).toBe(source);
    expect(t._uniforms.uHeightScale.value).toBe(370);
    expect([-200,0,200].map(x => t.sampleHeight(x,0))).toEqual(heights);
    t.dispose();
  });
  it('rebinds existing Mini water materials to newly created and replaced water systems', async () => {
    const t = await createTerrain({ renderer: renderer(), configuration: { layout: { chunkCount: 1, chunkSize: 1024 } } });
    const m = new MiniPresentation(t, mini);
    const system = () => ({ addAuxiliaryWater: vi.fn(), removeAuxiliaryWater: vi.fn(), setStudioOverride: vi.fn(function(v) { this.studioOverride = v; }) });
    const a = system(), b = system();
    m.context.waterSystem = a;
    m.controller.syncPresentation();
    m.controller.syncPresentation();
    expect(a.addAuxiliaryWater).toHaveBeenCalledTimes(2);
    m.context.waterSystem = b;
    m.controller.syncPresentation();
    expect(a.removeAuxiliaryWater).toHaveBeenCalledTimes(2);
    expect(a.studioOverride).toBe(null);
    expect(b.addAuxiliaryWater).toHaveBeenCalledTimes(2);
    expect(b.studioOverride).toBe(m.controller.waterSurface);
    t.dispose();
    expect(b.removeAuxiliaryWater).toHaveBeenCalledTimes(2);
  });
  it('invalidates derived height caches when biome climate changes the legacy relief', async () => {
    const t = await createTerrain({ renderer: renderer(), configuration: {
      layout: { chunkCount: 1, chunkSize: 1024 }, heightScale: 370 } });
    const onTerrainChanged = vi.fn();
    t.addLayer({ onTerrainChanged, dispose() {} });
    const points = [-300,-100,0,100,300];
    const before = points.map(x => t.sampleHeight(x,0));
    await t.configure({ material: { biomeScale: 2.7, moistBias: .7 } });
    expect(points.map(x => t.sampleHeight(x,0))).not.toEqual(before);
    expect(onTerrainChanged.mock.calls.at(-1)[0].sourceChanged).toBe(true);
    await t.configure({ material: { normalStrength: 1.8 } });
    expect(onTerrainChanged.mock.calls.at(-1)[0].sourceChanged).toBe(false);
    await t.configure({ terrainFormationSeaLevel: 160 });
    expect(onTerrainChanged.mock.calls.at(-1)[0].sourceChanged).toBe(true);
    t.dispose();
  });
  it('detaches style arrays and material settings, validates and round-trips them', async () => {
    const style = { paletteTint: [.8,.7,.6], sunIntensity: .9 };
    const t = await createTerrain({ renderer: renderer(), configuration: { style, material: { terrainDetailQuality: 2, terrainTriplanar: false, visualsRockDetail: .8 } } });
    style.paletteTint[0] = 0;
    expect(t.configuration.style.paletteTint).toEqual([.8,.7,.6]);
    expect(Object.isFrozen(style.paletteTint)).toBe(false);
    await t.configure({ material: { normalStrength: 1.8 } });
    expect(t._uniforms.uTerrainDetailQuality.value).toBe(2);
    expect(t._uniforms.uTerrainTriplanar.value).toBe(0);
    expect(t._uniforms.uNormalStrength.value).toBe(1.8);
    expect(t._uniforms.uPaletteTint.value.toArray()).toEqual([.8,.7,.6]);
    await expect(t.configure({ material: { terrainDetailQuality: 9 } })).rejects.toThrow();
    await expect(t.configure({ material: { unknown: 1 } })).rejects.toThrow();
    const restored = await loadTerrainDocument(t.serialize(), { renderer: renderer() });
    expect(restored.configuration).toEqual(t.configuration);
    t.dispose(); restored.dispose();
  });
});
