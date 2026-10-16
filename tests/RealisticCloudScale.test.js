import { describe, expect, it } from 'vitest';
import * as THREE from 'three';
import { CLOUD_DEFAULT_PARAMS } from '../src/engine/sky/CloudSettings.js';
import {
  RealisticCloudSlabLayer,
  RealisticInfiniteCloudLayer,
  RealisticPlanetCloudLayer,
} from '../src/engine/sky/realistic/RealisticCloudLayers.js';

const frequencies = (layer) => {
  const u = layer.material.uniforms;
  return [u.uCloudShapeFreq.value, u.uCloudDetailFreq.value, u.uCloudCellFreq.value];
};

describe.each([
  ['studio', RealisticCloudSlabLayer, (layer, params) => layer.applyParams(params, 100, 1024, {}, { radius: 512 })],
  ['infinite', RealisticInfiniteCloudLayer, (layer, params) => layer.applyParams(params, 100, 1024, {})],
  ['planet', RealisticPlanetCloudLayer, (layer, params) => layer.applyParams(params, 16000, {})],
])('realistic cloud scale in %s', (_mode, Layer, apply) => {
  it('shrinks formations as System Scale increases, even at maximum Billow Size', () => {
    const layer = new Layer(new THREE.Scene());
    try {
      const params = { ...CLOUD_DEFAULT_PARAMS, cloudsEnabled: true, cloudAltitude: 225,
        cloudThickness: 160, cloudBillowSize: 3, cloudTowering: 1, cloudCoverage: 0.46 };
      const samples = [1, 3.2, 10].map((cloudSystemScale) => {
        apply(layer, { ...params, cloudSystemScale });
        return frequencies(layer);
      });
      for (let i = 0; i < 3; i++) {
        expect(samples[1][i]).toBeGreaterThan(samples[0][i]);
        expect(samples[2][i]).toBeCloseTo(samples[0][i] * 10, 10);
      }
      const u = layer.material.uniforms;
      expect(u.uCloudTop.value - u.uCloudBottom.value).toBeCloseTo(160);
      expect(u.uCloudCoverage.value).toBe(0.46);
      expect(u.uCloudTowering.value).toBe(1);
    } finally {
      layer.dispose();
    }
  });

  it('keeps Billow Size useful independently of System Scale', () => {
    const layer = new Layer(new THREE.Scene());
    try {
      const params = { ...CLOUD_DEFAULT_PARAMS, cloudSystemScale: 10, cloudBillowSize: 1 };
      apply(layer, params);
      const small = frequencies(layer);
      apply(layer, { ...params, cloudBillowSize: 3 });
      frequencies(layer).forEach((f, i) => expect(f).toBeCloseTo(small[i] / 3, 10));
    } finally {
      layer.dispose();
    }
  });
});

it('preserves the default realistic cloud appearance and size across board spread changes', () => {
  const layer = new RealisticCloudSlabLayer(new THREE.Scene());
  try {
    layer.applyParams(CLOUD_DEFAULT_PARAMS, 100, 1024, {}, { radius: 512 });
    const baseline = frequencies(layer);
    expect(baseline[0]).toBeCloseTo(1 / (Math.sqrt(620 * 1024 * 0.3) * 1.6), 10);
    expect(baseline[2]).toBeCloseTo(0.33 / (620 * 3.2), 10);
    expect(layer._weatherScale).toBeCloseTo(3.2 / (1024 * 34), 10);
    layer.applyParams(CLOUD_DEFAULT_PARAMS, 100, 1024, {}, { radius: 256 });
    expect(frequencies(layer)).toEqual(baseline);
    expect(layer.material.uniforms.uCloudRadius.value).toBe(256);
  } finally {
    layer.dispose();
  }
});

it('breaks weather into smaller patches at high scale consistently across board sizes', () => {
  const layer = new RealisticCloudSlabLayer(new THREE.Scene());
  try {
    const params = { ...CLOUD_DEFAULT_PARAMS, cloudSystemScale: 10 };
    layer.applyParams(params, 100, 1024, {}, { radius: 512 });
    const weatherScale = layer._weatherScale;
    // The former mapping spanned less than one noise unit at maximum scale,
    // leaving one broad patch over the whole board regardless of billow size.
    expect(weatherScale * 1024).toBeGreaterThan(2);
    layer.applyParams(params, 100, 2048, {}, { radius: 1024 });
    expect(layer._weatherScale * 2048).toBeCloseTo(weatherScale * 1024, 10);
  } finally {
    layer.dispose();
  }
});
