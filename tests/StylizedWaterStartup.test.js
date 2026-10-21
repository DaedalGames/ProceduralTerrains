import { describe, expect, it, vi } from 'vitest';
import { StylizedWaterLayer } from '../src/engine/water/StylizedWaterLayer.js';
import { WaterSystem } from '../src/engine/water/WaterSystem.js';
import { createTerrainUniforms } from '../src/engine/terrain/TerrainMaterial.js';
import { applyMiniWaterLook, createMiniWaterSurfaceMaterial } from '../src/engine/mini/MiniWaterMaterial.js';

function setup() {
  const jobs = [];
  const engine = {
    worldMode: 'studio',
    params: { waterMode: 'stylized' },
    uniforms: createTerrainUniforms(),
    cb: { onToast: vi.fn() },
    _needsRender: false,
  };
  engine.compileWaterMaterialsAsync = vi.fn((materials, onSwap, options) =>
    new Promise((resolve) => jobs.push({ materials, onSwap, ...options, resolve })));
  const layer = new StylizedWaterLayer(engine);
  const system = Object.assign(Object.create(WaterSystem.prototype), {
    engine, _effectiveMode: 'stylized', _stylizedActive: true, _stylized: layer,
    addAuxiliaryWater: vi.fn(), removeAuxiliaryWater: vi.fn(),
  });
  layer.ensure(system);
  layer.applySettings();
  return { engine, layer, system, jobs };
}

describe('Stylized first-use preparation', () => {
  it('keeps Legacy visible until the requested GPU program passes preparation', async () => {
    const { engine, layer, system, jobs } = setup();
    layer.prepare(system, 'studio');
    expect(system._stylizedMaterial()).toBeNull();
    expect(system.getTransitionState()).toMatchObject({ renderedMode: 'legacy', pending: true });
    expect(system.isRequestedMaterialReady()).toBe(false);

    jobs[0].onSwap();
    jobs[0].resolve(true);
    await Promise.resolve();
    expect(system._stylizedMaterial()).toBe(layer.material);
    expect(system.getTransitionState()).toMatchObject({ renderedMode: 'stylized', pending: false });
    expect(engine._needsRender).toBe(true);
  });

  it('cannot attach a cancelled request after a newer request has started', async () => {
    const { layer, system, jobs } = setup();
    layer.prepare(system, 'studio');
    layer.cancelPreparation();
    layer.prepare(system, 'studio');
    expect(jobs[0].isCurrent()).toBe(false);
    jobs[0].onSwap();
    jobs[0].resolve(false);
    await Promise.resolve();
    expect(layer.ready).toBe(false);
    expect(layer.pending).toBe(true);

    jobs[1].onSwap();
    jobs[1].resolve(true);
    await Promise.resolve();
    expect(layer.ready).toBe(true);
  });

  it('restarts pending preparation for the new world instead of waiting on a retired job', async () => {
    const { engine, layer, system, jobs } = setup();
    layer.prepare(system, 'studio');
    engine.worldMode = 'infinite';
    layer.prepare(system, 'infinite');
    expect(jobs).toHaveLength(2);
    expect(jobs[0].isCurrent()).toBe(false);
    expect(jobs[1].isCurrent()).toBe(true);

    jobs[0].resolve(false);
    jobs[1].onSwap();
    jobs[1].resolve(true);
    await Promise.resolve();
    expect(layer.ready).toBe(true);
  });

  it('keeps a visible fallback after failure without retrying on every settings sync', async () => {
    const { engine, layer, system, jobs } = setup();
    layer.prepare(system, 'studio');
    jobs[0].resolve(false);
    await Promise.resolve();
    expect(system.getTransitionState()).toMatchObject({ renderedMode: 'legacy', pending: false, failed: true });
    layer.prepare(system, 'studio');
    expect(jobs).toHaveLength(1);
    expect(engine.cb.onToast).toHaveBeenCalledOnce();

    layer.cancelPreparation();
    layer.prepare(system, 'studio');
    expect(jobs).toHaveLength(2);
  });

  it('only changes the compiled reflection variant when the reflection path changes', () => {
    const material = createMiniWaterSurfaceMaterial(createTerrainUniforms());
    applyMiniWaterLook(material, { params: { waterDioramaReflections: 'sky' } });
    const sky = material.version;
    applyMiniWaterLook(material, {
      params: { waterDioramaReflections: 'sky', waterDioramaReflectionStrength: .5, waterDioramaReflectionBlur: .6 },
    });
    expect(material.version).toBe(sky);
    expect(material.defines.MINI_WATER_TERRAIN_REFLECTION).toBeUndefined();

    applyMiniWaterLook(material, { params: { waterDioramaReflections: 'terrain' } });
    expect(material.defines.MINI_WATER_TERRAIN_REFLECTION).toBe(1);
    const terrain = material.version;
    applyMiniWaterLook(material, { params: { waterDioramaReflections: 'terrain', waterDioramaReflectionStrength: .7 } });
    expect(material.version).toBe(terrain);
    applyMiniWaterLook(material, { params: { waterDioramaReflections: 'off' } });
    expect(material.defines.MINI_WATER_TERRAIN_REFLECTION).toBeUndefined();
    material.dispose();
  });
});
