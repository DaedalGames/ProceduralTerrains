import { describe, expect, it, vi } from 'vitest';
import * as THREE from 'three';
import { Engine } from '../src/engine/Engine.js';
import { EditorControls } from '../src/engine/EditorControls.js';
import { createTerrainUniforms } from '../src/engine/terrain/TerrainMaterial.js';
import { TerrainHeightSampler } from '../src/engine/terrain/TerrainHeightSampler.js';
import { GpuHeightSampler } from '../src/engine/terrain/GpuHeightSampler.js';
import { heightExportRange } from '../src/engine/terrain/RealWorldElevation.js';
import { createRealWorldSource, normalizeRealWorldSource } from '../src/engine/terrain/RealWorldSource.js';

function engineWithElevations(min = -430, max = 8850) {
  const entry = {
    geoRef: {}, meta: { minElev: min, maxElev: max },
    settings: { mode: 'replace', elevationMode: 'meters', heightStrength: 1, heightOffset: 0 },
    width: 2, height: 2, floatData: new Float32Array([0, 0.123456, 0.75, 1]),
    regionBounds: { minX: 0, minZ: 0, cols: 1, rows: 1 },
  };
  const engine = Object.assign(Object.create(Engine.prototype), {
    worldMode: 'studio', params: { heightScale: 420, chunkCount: 1, chunkSize: 100 },
    uniforms: createTerrainUniforms(), importedMaps: { height: entry },
    _setImportState: vi.fn(), _samplePaintHeightOffset: () => 0,
    _sampleManualHeightOffset: () => 0, _sampleSplineHeightOffset: () => 0,
  });
  engine.uniforms.uHeightScale.value = 420;
  engine._rebuildImportedTexture('height');
  return engine;
}

describe('geographic elevations independent of procedural noise', () => {
  it('scales the visible relief and camera framing without modifying source elevations or noise amplitude', () => {
    const engine = engineWithElevations();
    const entry = engine.importedMaps.height;
    const source = [...entry.floatData];
    entry.elevationFramed = true;
    engine.controls = new EditorControls(new THREE.PerspectiveCamera(), { addEventListener() {}, removeEventListener() {} });
    engine.controls.setBoardSize(engine.boardSize);
    engine.controls.setElevationRange({ min: -430, max: 8850 });
    engine.controls.goalRadius = 9280;
    Object.assign(engine, { applyAll: vi.fn(), _rebuildRealWorldBuildings: vi.fn(),
      _syncRealWorldSeaLevel: vi.fn(), _frameRealWorldElevation: vi.fn() });
    engine.setTileMapSetting('height', 'heightStrength', 0.1);
    expect(engine._sampleRealWorldHeight(50, 50)).toBeCloseTo(885, 2);
    expect(engine.controls.goalRadius).toBeCloseTo(928, 2);
    expect(engine.params.heightScale).toBe(420);
    expect(entry.meta).toEqual({ minElev: -430, maxElev: 8850 });
    expect([...entry.floatData]).toEqual(source);
    entry.texture.dispose();
    engine.controls.dispose();
  });

  it('keeps geographic terrain matte independently of its elevation mode', () => {
    const engine = engineWithElevations();
    expect(engine.uniforms.uTerrainSpecular.value).toBe(0);
    engine.importedMaps.height.settings.elevationMode = 'normalized';
    engine._syncImportedMapUniforms();
    expect(engine.uniforms.uTerrainSpecular.value).toBe(0);
    engine.importedMaps.height.texture.dispose();
    engine.importedMaps.height = null;
    engine._syncImportedMapUniforms();
    expect(engine.uniforms.uTerrainSpecular.value).toBe(1);
    engine.getClientSnapshot = () => ({});
    engine.setClientState({ workspacePreset: 'real-terrain' });
    expect(engine.uniforms.uTerrainSpecular.value).toBe(0);
    engine.worldMode = 'infinite';
    engine._syncImportedMapUniforms();
    expect(engine.uniforms.uTerrainSpecular.value).toBe(1);
  });

  it('defaults new imports to meters and preserves normalized legacy projects', () => {
    const input = { bbox: { minLat: 45, maxLat: 46, minLon: 6, maxLon: 7 }, zoom: 10 };
    const source = createRealWorldSource(input);
    expect(source.heightSettings.elevationMode).toBe('meters');
    expect(normalizeRealWorldSource(JSON.parse(JSON.stringify(source)))).toEqual(source);
    expect(normalizeRealWorldSource(input).heightSettings.elevationMode).toBe('normalized');
  });

  it('keeps peaks and negative elevations when noise amplitude changes', () => {
    const engine = engineWithElevations();
    expect(engine._sampleRealWorldHeight(-50, -50)).toBe(-430);
    expect(engine._sampleRealWorldHeight(50, 50)).toBe(8850);
    engine.params.heightScale = 20;
    engine._syncImportedMapUniforms();
    expect(engine._sampleRealWorldHeight(50, 50)).toBe(8850);
    expect(engine.uniforms.uImportElevationRange.value.toArray()).toEqual([-430, 9280]);
    expect(engine.params.heightScale).toBe(20);
    engine.importedMaps.height.texture.dispose();
  });

  it('retains sub-meter elevation precision in the existing filterable half-float texture', () => {
    const engine = engineWithElevations();
    const entry = engine.importedMaps.height;
    const sampler = new TerrainHeightSampler(engine.uniforms, () => ({ infinite: false, octaves: 4 }));
    const expected = -430 + entry.floatData[1] * 9280;
    expect(sampler.heightAt(25, -25)).toBeCloseTo(expected, 2);
    expect(sampler.heightAt(25, -25)).toBeCloseTo(engine._sampleRealWorldHeight(25, -25), 2);
    expect(sampler.heightAt(0, 0)).toBeCloseTo(engine._sampleRealWorldHeight(0, 0), 2);
    entry.texture.dispose();
  });

  it('preserves the altitude of a perfectly flat geographic selection', () => {
    const engine = engineWithElevations(2740, 2740);
    expect(engine._sampleRealWorldHeight(0, 0)).toBe(2740);
    const sampler = new TerrainHeightSampler(engine.uniforms, () => ({ infinite: false, octaves: 4 }));
    expect(sampler.heightAt(0, 0)).toBe(2740);
    engine.importedMaps.height.texture.dispose();
  });

  it('blends imports after noise evaluation and adds erosion afterwards', () => {
    const engine = engineWithElevations();
    const entry = engine.importedMaps.height;
    Object.assign(entry.settings, { mode: 'blend', blend: 0.25 });
    engine._syncImportedMapUniforms();
    const sampler = new TerrainHeightSampler(engine.uniforms, () => ({ infinite: false, octaves: 4 }));
    const procedural = sampler.heightAt(25, 25, { ignoreImports: true });
    sampler.erosion = { enabled: true, offsetAt: () => -12 };
    expect(sampler.heightAt(25, 25)).toBeCloseTo(procedural * 0.75 + 8850 * 0.25 - 12, 2);
    engine.uniforms.uImportHeightMode.value = 0;
    expect(sampler.heightAt(25, 25)).toBeCloseTo(procedural - 12, 2);
    entry.texture.dispose();
  });

  it('includes altitude and exaggeration in culling bounds and below-sea-level skirts', () => {
    const engine = engineWithElevations();
    Object.assign(engine.importedMaps.height.settings, { heightStrength: 2, heightOffset: -50 });
    expect(engine._maxHeight()).toBeGreaterThan(17650);
    expect(engine._skirtDepth()).toBeGreaterThan(910);
    engine.worldMode = 'infinite';
    expect(engine._maxHeight()).toBeCloseTo(420 * 1.35 + 2);
    engine.importedMaps.height.texture.dispose();
  });

  it('puts geographic sea level at zero without altering noise amplitude', () => {
    const engine = engineWithElevations();
    engine.setParam = vi.fn();
    engine._syncRealWorldSeaLevel();
    expect(engine.setParam).toHaveBeenCalledWith('seaLevel', 0);
    expect(engine.params.heightScale).toBe(420);
    engine.importedMaps.height.texture.dispose();
  });

  it('encodes collision and export heights across the actual altitude range', () => {
    const engine = engineWithElevations();
    const range = heightExportRange(engine.uniforms, 420);
    expect(range).toEqual({ min: -430, max: 8850 });
    const gpu = new GpuHeightSampler({ uniforms: engine.uniforms, tileSize: 1 });
    gpu._data = new Uint8Array([255, 0, 0, 255]);
    expect(gpu._texel(0, 0)).toBe(8850);
    gpu._data[0] = 0;
    expect(gpu._texel(0, 0)).toBe(-430);
    engine.uniforms.uImportHeightMeters.value = 0;
    expect(heightExportRange(engine.uniforms, 420)).toEqual({ min: 0, max: 420 });
    engine.importedMaps.height.texture.dispose();
    gpu.dispose();
  });

  it('keeps camera focus at geographic altitude after reset and returns to zero for ordinary terrains', () => {
    const controls = new EditorControls(new THREE.PerspectiveCamera(), {
      addEventListener() {}, removeEventListener() {},
    });
    controls.setBoardSize(1000);
    controls.setElevationRange({ min: 2400, max: 8800 });
    controls.reset(1000);
    expect(controls.goalTarget.y).toBe(5600);
    expect(controls.goalRadius).toBe(6400 * 1.4);
    expect(controls.maxRadius).toBeGreaterThanOrEqual(6400 * 3.2);
    controls.setElevationRange(null);
    controls.focusCenter();
    expect(controls.goalTarget.y).toBe(0);
    controls.dispose();
  });
});
