import { describe, expect, it, vi } from 'vitest';
import * as THREE from 'three';
import { createTerrainUniforms } from '../src/engine/terrain/TerrainMaterial.js';
import { WaterSystem } from '../src/engine/water/WaterSystem.js';
import {
  applyMiniWaterLook, createMiniWaterSurfaceMaterial, createMiniWaterCutMaterial,
  realisticMiniAbsorption, resolveMiniReflections, miniTransparencyScale,
} from '../src/engine/mini/MiniWaterMaterial.js';
import { WATER_DEFAULT_PARAMS } from '../src/engine/water/WaterSettings.js';
import { MiniTerrainController } from '../src/engine/mini/MiniTerrainController.js';
import { MiniStudioStage } from '../src/engine/mini/MiniStudioStage.js';
import { createMiniTerrainState, miniParamsPatch } from '../src/engine/mini/MiniTerrainSettings.js';
import { resolveCloudLightingState } from '../src/engine/sky/CloudLightingState.js';
import { evaluateTimeOfDay } from '../src/engine/sky/TimeOfDay.js';

describe('Mini water controls', () => {
  it('delivers performance settings to the auxiliary Mini surface and stylized water', () => {
    const material = createMiniWaterSurfaceMaterial(createTerrainUniforms());
    const system = new WaterSystem({ params: {}, worldMode: 'studio' });
    system.addAuxiliaryWater({ material });
    vi.spyOn(system, '_syncStudioGeometry').mockImplementation(() => {});
    vi.spyOn(system, '_maybeFpsDowngrade').mockImplementation(() => {});
    for (const quality of [0, 1, 2]) {
      system.applyPerf({ waterQuality: quality, waterDetail: 0, waterReflection: 0.4, waterWaves: 0.7 });
      expect(material.uniforms.uWaterQuality.value).toBe(quality);
      expect(material.uniforms.uWaterDetail.value).toBe(0);
      expect(material.uniforms.uWaterReflection.value).toBe(0.4);
      expect(material.uniforms.uWaveComplexity.value).toBe(0.7);
    }
    material.dispose();
  });

  it('updates surface and cut colors together and respects zero/disabled controls', () => {
    const shared = createTerrainUniforms();
    const materials = [createMiniWaterSurfaceMaterial(shared), createMiniWaterCutMaterial(shared)];
    const params = {
      planetStyle: { palette: { shallow: [0.1, 0.3, 0.4], deep: [0, 0.02, 0.1], foam: [0.5, 0.6, 0.7] } },
      waterAbsorptionStrength: 0, waterWaveScale: 2, waterWaveStrength: 0,
      waterFoamEnabled: false, waterUnderwaterCausticsEnabled: false,
      waterFresnelStrength: 0, waterSpecularStrength: 0,
    };
    for (const material of materials) {
      applyMiniWaterLook(material, { params });
      expect(material.uniforms.uMiniWaterShallow.value.toArray()).toEqual(params.planetStyle.palette.shallow);
      expect(material.uniforms.uMiniWaterDeep.value.toArray()).toEqual(params.planetStyle.palette.deep);
      expect(material.uniforms.uMiniWaterAbsorb.value.length()).toBe(0);
      expect(material.uniforms.uMiniCaustics.value).toBe(0);
      expect(material.uniforms.uTerrainSkyAmb).toBe(shared.uTerrainSkyAmb);
    }
    expect(materials[0].uniforms.uMiniWaveScale.value).toBe(2);
    for (const key of ['uMiniWaveStrength', 'uMiniFoamWidth', 'uMiniReflect', 'uMiniSpecular']) {
      expect(materials[0].uniforms[key].value).toBe(0);
    }
    materials.forEach((m) => m.dispose());
  });
});

describe('Diorama water shader and reflections', () => {
  it('keeps the Stylized program and sky-only reflection by default', () => {
    const shared = createTerrainUniforms();
    const surface = createMiniWaterSurfaceMaterial(shared);
    applyMiniWaterLook(surface, { params: { ...WATER_DEFAULT_PARAMS } });
    expect(surface.defines?.MINI_WATER_REALISTIC).toBeUndefined();
    expect(surface.uniforms.uMiniReflectTerrain.value).toBe(0);
    expect(surface.uniforms.uMiniTraceSteps.value).toBe(0);
    expect(surface.uniforms.uMiniReflectDistort.value).toBe(1);
    expect(surface.uniforms.uMiniReflectBlur.value).toBe(0);
    expect(surface.uniforms.uMiniReflect.value).toBeCloseTo(0.6, 6);
    surface.dispose();
  });

  it('switches surface and cut to the Realistic program with physical absorption', () => {
    const shared = createTerrainUniforms();
    const surface = createMiniWaterSurfaceMaterial(shared);
    const cut = createMiniWaterCutMaterial(shared);
    const params = { ...WATER_DEFAULT_PARAMS, waterDioramaShader: 'realistic', waterWaveDirection: 90 };
    for (const material of [surface, cut]) {
      applyMiniWaterLook(material, { params, depthRange: 50 });
      expect(material.defines.MINI_WATER_REALISTIC).toBe(1);
      const absorb = material.uniforms.uMiniWaterAbsorb.value;
      // red is always absorbed first
      expect(absorb.x).toBeGreaterThan(absorb.y);
      expect(absorb.x).toBeGreaterThan(absorb.z);
    }
    expect(surface.fragmentShader).toContain('#ifdef MINI_WATER_REALISTIC');
    expect(surface.fragmentShader).toContain('waterDirectionalNormal(p.xz, t, fragDist');
    expect(surface.uniforms.uWaveDir.value.y).toBeCloseTo(1, 6);
    // Auto mirrors the terrain with the Realistic shader
    expect(surface.uniforms.uMiniReflectTerrain.value).toBe(1);
    expect(surface.uniforms.uMiniTraceSteps.value).toBeGreaterThan(0);

    applyMiniWaterLook(surface, { params: { ...params, waterDioramaShader: 'stylized' } });
    expect(surface.defines.MINI_WATER_REALISTIC).toBeUndefined();
    surface.dispose();
    cut.dispose();
  });

  it('resolves reflection modes, strength and limits', () => {
    expect(resolveMiniReflections({ waterDioramaReflections: 'off' }).strength).toBe(0);
    expect(resolveMiniReflections({ waterDioramaReflections: 'terrain' }, false).terrain).toBe(true);
    expect(resolveMiniReflections({ waterDioramaReflections: 'sky' }, true).terrain).toBe(false);
    expect(resolveMiniReflections({ waterDioramaReflections: 'bogus' }, true).terrain).toBe(true);
    const r = resolveMiniReflections({ waterDioramaReflectionBlur: 4, waterDioramaReflectionDistortion: -1 });
    expect(r.blur).toBe(1);
    expect(r.distortion).toBe(0);

    const surface = createMiniWaterSurfaceMaterial(createTerrainUniforms());
    applyMiniWaterLook(surface, { params: { waterFresnelStrength: 1, waterDioramaReflectionStrength: 0.5 } });
    expect(surface.uniforms.uMiniReflect.value).toBeCloseTo(0.3, 6);
    surface.dispose();
  });

  it('matches the Tile water absorption model', () => {
    const absorb = realisticMiniAbsorption([0.02, 0.4, 0.38], 46, 1, 0.6);
    expect(absorb[1]).toBeCloseTo(2.3 / 46 * 1.15, 6);
    expect(realisticMiniAbsorption([0.1, 0.5, 0.5], 40, 0, 0.5)).toEqual([0, 0, 0]);
  });
});

describe('Diorama water transparency', () => {
  it('keeps the authored absorption at the default transparency', () => {
    expect(miniTransparencyScale({})).toBe(1);
    expect(miniTransparencyScale({ waterDioramaTransparency: 0.75 })).toBe(0.5);
    expect(miniTransparencyScale({ waterDioramaTransparency: 0 })).toBe(4);
  });

  it('scales absorption in both shaders and clears the waterline', () => {
    const shared = createTerrainUniforms();
    for (const shader of ['stylized', 'realistic']) {
      const surface = createMiniWaterSurfaceMaterial(shared);
      const base = { ...WATER_DEFAULT_PARAMS, waterDioramaShader: shader };
      applyMiniWaterLook(surface, { params: base, depthRange: 50 });
      const before = surface.uniforms.uMiniWaterAbsorb.value.clone();
      applyMiniWaterLook(surface, { params: { ...base, waterDioramaTransparency: 0.75, waterDioramaShoreClarity: 2 } });
      expect(surface.uniforms.uMiniWaterAbsorb.value.x).toBeCloseTo(before.x * 0.5, 6);
      expect(surface.uniforms.uMiniShoreClear.value).toBe(2);
      surface.dispose();
    }
  });

  it('turns spectral tint off with zero Colour Absorption', () => {
    const neutral = realisticMiniAbsorption([0.02, 0.4, 0.38], 46, 1, 0.6, 0);
    expect(neutral[0]).toBeCloseTo(neutral[1], 6);
    expect(neutral[1]).toBeCloseTo(neutral[2], 6);
  });
});

describe('Mini time of day', () => {
  it('enables the sky for new projects without resetting it during layout restoration', () => {
    const state = createMiniTerrainState();
    expect(miniParamsPatch(state).skyboxEnabled).toBe(true);
    expect(miniParamsPatch(state).skyboxDayNightCycle).toBe(true);
    expect(miniParamsPatch(state, 'structure')).not.toHaveProperty('skyboxEnabled');
    expect(miniParamsPatch(state, 'structure')).not.toHaveProperty('skyboxDayNightCycle');
  });

  it('syncs sky reflections, stage fill, and backdrop visibility across day/night/manual lighting', () => {
    const shared = createTerrainUniforms();
    const sky = { uSkyZenith: { value: new THREE.Color() }, uSkyHorizon: { value: new THREE.Color() } };
    const engine = { uniforms: shared, worldMode: 'studio', proceduralSky: { uniforms: sky }, _skyActive: () => true };
    const mini = new MiniTerrainController(engine);
    mini.state = createMiniTerrainState();
    mini.stage = new MiniStudioStage(shared);
    mini.waterSurface = createMiniWaterSurfaceMaterial(shared);
    const fill = [];
    for (const time of [0.5, 0]) {
      const tod = evaluateTimeOfDay(time);
      sky.uSkyZenith.value.setRGB(...tod.zenith);
      sky.uSkyHorizon.value.setRGB(...tod.horizon);
      const state = resolveCloudLightingState({ proceduralSkyActive: true, timeOfDay: tod });
      mini.syncLighting(state);
      expect(mini.stage.backdrop.visible).toBe(false);
      expect(mini.waterSurface.uniforms.uMiniEnvSky.value).toBe(1);
      expect(mini.waterSurface.uniforms.uSkyZenith.value.equals(sky.uSkyZenith.value)).toBe(true);
      expect(Number.isFinite(mini.stage.shadowMaterial.uniforms.uStrength.value)).toBe(true);
      fill.push(mini.stage.fill.color.r + mini.stage.fill.color.g + mini.stage.fill.color.b);
    }
    expect(fill[1]).toBeLessThan(fill[0] * 0.1);
    engine._skyActive = () => false;
    mini.syncLighting();
    expect(mini.stage.backdrop.visible).toBe(true);
    expect(mini.waterSurface.uniforms.uMiniEnvSky.value).toBe(0);
    mini.stage.dispose();
    mini.waterSurface.dispose();
  });
});
