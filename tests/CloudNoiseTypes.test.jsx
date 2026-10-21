import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it, vi } from 'vitest';
import * as THREE from 'three';
import CloudPanel from '../src/components/ui/CloudPanel.jsx';
import { CLOUD_DEFAULT_PARAMS, CLOUD_NOISE_TYPES, normalizeCloudFormation, resolveCloudNoiseType } from '../src/engine/sky/CloudSettings.js';
import { CloudSlabLayer } from '../src/engine/sky/CloudSlabLayer.js';
import { InfiniteCloudLayer } from '../src/engine/sky/InfiniteCloudLayer.js';
import { PlanetCloudLayer } from '../src/engine/sky/PlanetCloudLayer.js';
import { RealisticCloudSlabLayer, RealisticInfiniteCloudLayer, RealisticPlanetCloudLayer } from '../src/engine/sky/realistic/RealisticCloudLayers.js';
import { cloudCoverageAt } from '../src/engine/sky/cloudFieldCPU.js';

describe('cloud noise types', () => {
  it.each(CLOUD_NOISE_TYPES)('preserves %s through save normalization with the variation seed', (cloudNoiseVariant) => {
    const saved = { ...CLOUD_DEFAULT_PARAMS, cloudNoiseVariant, cloudNoiseSeed: 21 };
    const loaded = normalizeCloudFormation(JSON.parse(JSON.stringify(saved)));
    expect(loaded).toEqual(saved);
    expect(resolveCloudNoiseType(loaded)).toBe(CLOUD_NOISE_TYPES.indexOf(cloudNoiseVariant));
  });

  it('defaults missing or unknown types to Soft', () => {
    expect(resolveCloudNoiseType()).toBe(0);
    expect(resolveCloudNoiseType({ cloudNoiseVariant: 'unknown' })).toBe(0);
    expect(normalizeCloudFormation({ seed: 12 })).toEqual({ seed: 12, cloudNoiseVariant: 'soft' });
  });

  it.each(['legacy', 'realistic'])('shows all types and the selected type in the %s panel', (cloudRenderMode) => {
    const html = renderToStaticMarkup(<CloudPanel params={{ ...CLOUD_DEFAULT_PARAMS, cloudsEnabled: true, cloudRenderMode, cloudNoiseVariant: 'billowy' }} perf={{}} onParam={() => {}} />);
    expect(html).toContain('Noise Type');
    expect(html).toContain('value="billowy" selected=""');
    for (const type of CLOUD_NOISE_TYPES) expect(html).toContain(`value="${type}"`);
  });

  it.each([CloudSlabLayer, InfiniteCloudLayer, PlanetCloudLayer, RealisticCloudSlabLayer, RealisticInfiniteCloudLayer, RealisticPlanetCloudLayer])('switches types in %s without rebuilding the material or changing the seed', (Layer) => {
    const layer = new Layer(new THREE.Scene());
    const apply = (cloudNoiseVariant) => {
      const params = { ...CLOUD_DEFAULT_PARAMS, cloudNoiseVariant, cloudNoiseSeed: 21 };
      if (layer instanceof PlanetCloudLayer) layer.applyParams(params, 16000, {});
      else layer.applyParams(params, 100, 1024, {});
    };
    try {
      apply('soft');
      const material = layer.material;
      const offset = material.uniforms.uCloudVariationOffset.value.clone();
      for (const [index, type] of CLOUD_NOISE_TYPES.entries()) {
        apply(type);
        expect(layer.material).toBe(material);
        expect(material.uniforms.uCloudNoiseType.value).toBe(index);
        expect(material.uniforms.uCloudVariationOffset.value.equals(offset)).toBe(true);
      }
    } finally { layer.dispose(); }
  });

  it('evaluates distinct bounded CPU fields for culling each noise type', () => {
    const field = { scale: 1, windX: 0, windY: 0, windZ: 0, time: 0, rotation: 0, coverage: 0.5, softness: 0.16, octaves: 3 };
    const sample = (noiseType) => Array.from({ length: 100 }, (_, i) => cloudCoverageAt(i * 0.17, i * 0.11, i * 0.37, { ...field, noiseType }));
    const patterns = [0, 1, 2].map(sample);
    expect(sample(undefined)).toEqual(patterns[0]);
    expect(patterns[1]).not.toEqual(patterns[0]);
    expect(patterns[2]).not.toEqual(patterns[0]);
    for (const value of patterns.flat()) { expect(value).toBeGreaterThanOrEqual(0); expect(value).toBeLessThanOrEqual(1); }
  });
  it.each([CloudSlabLayer, PlanetCloudLayer])('retains the newest noise variation while %s prepares a quality shader', async (Layer) => {
    const layer = new Layer(new THREE.Scene());
    const apply = (params, perf) => Layer === PlanetCloudLayer
      ? layer.applyParams(params, 16000, perf) : layer.applyParams(params, 100, 1024, perf);
    const perf = { cloudLightMode: 1 };
    const params = { ...CLOUD_DEFAULT_PARAMS, cloudsEnabled: true };
    apply(params, perf);
    const previous = layer.material;
    let finish;
    layer._compile = () => new Promise(resolve => { finish = resolve; });
    layer._rebuildMaterial(16, 6, 5, 4, true, 1);
    apply({ ...params, cloudNoiseSeed: 21, cloudNoiseVariant: 'wispy', cloudCoverage: 0.72 },
      { ...perf, cloudSteps: 16 });
    const latestOffset = previous.uniforms.uCloudVariationOffset.value.clone();
    finish({ ready: true });
    await vi.waitFor(() => expect(layer.material).not.toBe(previous));
    try {
      expect(layer.material.uniforms.uCloudNoiseType.value).toBe(2);
      expect(layer.material.uniforms.uCloudVariationOffset.value.equals(latestOffset)).toBe(true);
      expect(layer.material.uniforms.uCloudCoverage.value).toBe(0.72);
    } finally { layer.dispose(); }
  });

});
