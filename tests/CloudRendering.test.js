import { describe, expect, it, vi } from 'vitest';
import * as THREE from 'three';
import { CLOUD_DEFAULT_PARAMS, cloudNoiseOffset, normalizeCloudFormation } from '../src/engine/sky/CloudSettings.js';
import { CloudSlabLayer } from '../src/engine/sky/CloudSlabLayer.js';
import { PlanetCloudLayer } from '../src/engine/sky/PlanetCloudLayer.js';
import { InfiniteCloudLayer } from '../src/engine/sky/InfiniteCloudLayer.js';
import { RealisticCloudSlabLayer, RealisticInfiniteCloudLayer, RealisticPlanetCloudLayer } from '../src/engine/sky/realistic/RealisticCloudLayers.js';
import { CloudShadowPass, TERRAIN_CLOUD_SHADOW_GLSL } from '../src/engine/sky/CloudShadowPass.js';
import { REALISTIC_CLOUD_FRAGMENT } from '../src/engine/sky/realistic/realisticCloudGLSL.js';

describe('cloud noise variation', () => {
  it('preserves the original pattern at zero and serializes independently from terrain', () => {
    expect(cloudNoiseOffset(0)).toEqual([0, 0, 0]);
    expect(cloudNoiseOffset(21)).toEqual(cloudNoiseOffset(21));
    expect(cloudNoiseOffset(21)).not.toEqual(cloudNoiseOffset(22));
    const params = normalizeCloudFormation(JSON.parse(JSON.stringify({ ...CLOUD_DEFAULT_PARAMS, seed: 12, cloudNoiseSeed: 21 })));
    expect(params.seed).toBe(12);
    expect(params.cloudNoiseSeed).toBe(21);
  });

  it.each([CloudSlabLayer, InfiniteCloudLayer, PlanetCloudLayer, RealisticCloudSlabLayer, RealisticInfiniteCloudLayer, RealisticPlanetCloudLayer])('changes and restores the live noise in %s', (Layer) => {
    const layer = new Layer(new THREE.Scene());
    const apply = (cloudNoiseSeed) => {
      const p = { ...CLOUD_DEFAULT_PARAMS, seed: 12, cloudNoiseSeed };
      if (layer instanceof PlanetCloudLayer) layer.applyParams(p, 16000, {});
      else layer.applyParams(p, 100, 1024, {});
    };
    try {
      apply(0);
      const original = layer.material.uniforms.uCloudVariationOffset.value.clone();
      const seed = layer._seed?.clone();
      apply(21);
      expect(layer.material.uniforms.uCloudVariationOffset.value.equals(original)).toBe(false);
      if (seed) expect(layer._seed.equals(seed)).toBe(false);
      apply(0);
      expect(layer.material.uniforms.uCloudVariationOffset.value.equals(original)).toBe(true);
      if (seed) expect(layer._seed.equals(seed)).toBe(true);
    } finally { layer.dispose(); }
  });
});

describe('cloud shadows', () => {
  it.each([false, true])('uses the live cloud field and preserves render state (realistic=%s)', (realistic) => {
    const layer = new (realistic ? RealisticCloudSlabLayer : CloudSlabLayer)(new THREE.Scene());
    layer.applyParams(CLOUD_DEFAULT_PARAMS, 100, 1024, {});
    const pass = new CloudShadowPass({ realistic });
    const target = {}, tiles = new THREE.Texture();
    const renderer = { xr: { enabled: true }, autoClear: false,
      getRenderTarget: () => target, getActiveCubeFace: () => 2, getActiveMipmapLevel: () => 1,
      setRenderTarget: vi.fn(), render: vi.fn() };
    try {
      const state = pass.render(renderer, layer.material.uniforms, new THREE.Vector3(0, 1, 0), tiles);
      expect(state.altitude).toBe(240);
      expect(pass.material.uniforms.uCloudVariationOffset).toBe(layer.material.uniforms.uCloudVariationOffset);
      expect(pass.material.uniforms.uShadowTileOccupancy.value).toBe(tiles);
      expect(renderer.setRenderTarget).toHaveBeenLastCalledWith(target, 2, 1);
      expect(renderer.xr.enabled).toBe(true);
      expect(renderer.autoClear).toBe(false);
      expect(pass.material.fragmentShader).toContain(realistic ? 'cloudDensityAt(p, 0.0)' : 'cloudDensity(p)');
      renderer.render.mockImplementation(() => { throw new Error('draw failed'); });
      expect(() => pass.render(renderer, layer.material.uniforms, new THREE.Vector3(0, 1, 0))).toThrow('draw failed');
      expect(renderer.setRenderTarget).toHaveBeenLastCalledWith(target, 2, 1);
      expect(renderer.xr.enabled).toBe(true);
    } finally { pass.dispose(); layer.dispose(); tiles.dispose(); }
  });

  it('shares the tile mask texture unit and projects toward the sun', () => {
    expect(TERRAIN_CLOUD_SHADOW_GLSL).toContain('#define uTerrainCloudShadowTex uTileOccupancy');
    expect(TERRAIN_CLOUD_SHADOW_GLSL).not.toContain('uniform sampler');
    expect(TERRAIN_CLOUD_SHADOW_GLSL).toContain('uSunDir.xz * rise');
  });

  it('does not allocate a shadow map for disabled clouds', () => {
    const layer = new CloudSlabLayer(new THREE.Scene(), { renderer: {} });
    try {
      expect(layer.renderTerrainShadow(new THREE.Vector3(0, 1, 0))).toBeNull();
      expect(layer._shadowPass).toBeUndefined();
    } finally { layer.dispose(); }
  });
});

it('uses independent volumetric samples and a consistent column profile for realistic clouds', () => {
  expect(REALISTIC_CLOUD_FRAGMENT).toContain('F += weatherWarp(p);');
  expect(REALISTIC_CLOUD_FRAGMENT).toContain('cloudDensityAt(p - offset, detailW)');
  expect(REALISTIC_CLOUD_FRAGMENT).not.toContain('hf > min(g0.z');
  expect(REALISTIC_CLOUD_FRAGMENT).not.toContain('pow(jitter / steps, bias)');
});
