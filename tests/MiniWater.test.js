import { describe, expect, it, vi } from 'vitest';
import * as THREE from 'three';
import { createTerrainUniforms } from '../src/engine/terrain/TerrainMaterial.js';
import { WaterSystem } from '../src/engine/water/WaterSystem.js';
import { applyMiniWaterLook, createMiniWaterSurfaceMaterial, createMiniWaterCutMaterial } from '../src/engine/mini/MiniWaterMaterial.js';
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
