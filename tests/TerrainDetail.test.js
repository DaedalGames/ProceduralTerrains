import { afterEach, describe, expect, it } from 'vitest';
import { createTerrainUniforms } from '../src/engine/terrain/TerrainMaterial.js';
import { TerrainHeightSampler } from '../src/engine/terrain/TerrainHeightSampler.js';
import { PlanetHeightSampler } from '../src/engine/terrain/PlanetHeightSampler.js';
import { DEFAULT_PARAMS } from '../src/engine/presets.js';
import { buildHeightGLSL, NOISE_GLSL } from '../src/engine/terrain/terrainGLSL.js';
import { PLANET_NOISE_GLSL } from '../src/engine/terrain/planetGLSL.js';
import { makeLayer, makeStack } from '../src/engine/terrain/noise/NoiseStack.js';
import { generateStackGLSL } from '../src/engine/terrain/noise/noiseStackCodegen.js';
import { fbm2, ridged2, billow2, setNoiseDetailCut, vnoise2, rot2 } from '../src/engine/terrain/noise/cpuNoise.js';

// Terrain Detail (params.terrainDetail) fades fine octaves out and rounds
// ridge creases, through the uTerrainDetailCut uniform (1 - detail).

const studio = (uniforms) => new TerrainHeightSampler(uniforms, () => ({ octaves: 7, infinite: false }));

// mean |second difference| along a line: high-frequency roughness
function roughness(sampler, step = 1.5, n = 400) {
  let sum = 0;
  let prev2 = sampler.heightAt(-300, 40);
  let prev1 = sampler.heightAt(-300 + step, 40);
  for (let i = 2; i < n; i++) {
    const h = sampler.heightAt(-300 + i * step, 40);
    sum += Math.abs(h - 2 * prev1 + prev2);
    prev2 = prev1;
    prev1 = h;
  }
  return sum / (n - 2);
}

afterEach(() => setNoiseDetailCut(0));

describe('Terrain Detail', () => {
  it('defaults to full detail (the historical field)', () => {
    expect(DEFAULT_PARAMS.terrainDetail).toBe(1);
    const u = createTerrainUniforms();
    expect(u.uTerrainDetailCut.value).toBe(0);
    // a sampler whose uniforms never had the cut behaves exactly the same
    const a = studio(u);
    const legacy = createTerrainUniforms();
    delete legacy.uTerrainDetailCut;
    const b = studio(legacy);
    for (const [x, z] of [[0, 0], [123.4, -88.1], [-410, 260], [777, 5]]) {
      expect(a.heightAt(x, z)).toBe(b.heightAt(x, z));
    }
  });

  it('smooths the studio and planet fields as detail goes down', () => {
    const u = createTerrainUniforms();
    const full = roughness(studio(u));
    u.uTerrainDetailCut.value = 0.6;
    const smooth = roughness(studio(u));
    expect(smooth).toBeLessThan(full * 0.7);
    // broad shape kept: same order of height range
    const s = studio(u);
    expect(Math.abs(s.heightAt(0, 0))).toBeLessThan(DEFAULT_PARAMS.heightScale * 2);

    const pu = createTerrainUniforms();
    pu.uPlanetRadius.value = 16000;
    const planet = new PlanetHeightSampler(pu, () => ({ octaves: 7 }));
    const along = (p) => {
      let sum = 0;
      const h = (t) => p.heightAt3D(Math.cos(t), 0.3, Math.sin(t));
      for (let i = 1; i < 300; i++) sum += Math.abs(h((i + 1) * 4e-4) - 2 * h(i * 4e-4) + h((i - 1) * 4e-4));
      return sum;
    };
    const planetFull = along(planet);
    pu.uTerrainDetailCut.value = 0.6;
    expect(along(planet)).toBeLessThan(planetFull * 0.8);
  });

  it('leaves the CPU noise-layer fractals unchanged at full detail', () => {
    // reference: the plain fractal sum the layers used before Terrain Detail
    const ref = (x, y, oct, pers, lac) => {
      let amp = 0.5, sum = 0, norm = 0;
      for (let i = 0; i < oct; i++) {
        sum += amp * vnoise2(x, y); norm += amp; amp *= pers;
        const r = rot2(x, y); x = r[0] * lac; y = r[1] * lac;
      }
      return sum / norm;
    };
    for (const [x, y] of [[0.3, 1.7], [12.9, -4.2], [-7.7, 3.3]]) {
      expect(fbm2(x, y, 6, 0.5, 2, 0, 0)).toBe(ref(x, y, 6, 0.5, 2));
    }
    const full = [ridged2(3.1, 4.7, 6, 0.5, 2, 2), billow2(3.1, 4.7, 6, 0.5, 2)];
    setNoiseDetailCut(0.7);
    expect(ridged2(3.1, 4.7, 6, 0.5, 2, 2)).not.toBe(full[0]);
    expect(billow2(3.1, 4.7, 6, 0.5, 2)).not.toBe(full[1]);
    // finest octaves fully faded: equal to a shorter stack's first octaves
    expect(fbm2(0.3, 1.7, 6, 0.5, 2, 0, 0)).not.toBe(ref(0.3, 1.7, 6, 0.5, 2));
  });

  it('wires the cut into every fractal loop on the GPU', () => {
    expect(NOISE_GLSL).toContain('uniform float uTerrainDetailCut;');
    expect(NOISE_GLSL).toMatch(/float fbm\(vec2 p\)[\s\S]*?octaveKeep/);
    expect(NOISE_GLSL).toMatch(/float ridgedFBM\(vec2 p\)[\s\S]*?creaseAbs/);
    // the 4-octave warp / mask FBM is deliberately left untouched
    expect(NOISE_GLSL.match(/float fbm4\(vec2 p\)[\s\S]*?\n}/)[0]).not.toContain('octaveKeep');
    expect(PLANET_NOISE_GLSL).toMatch(/float fbm3D\(vec3 p\)[\s\S]*?octaveKeep/);
    expect(PLANET_NOISE_GLSL).toMatch(/float ridgedFBM3D\(vec3 p\)[\s\S]*?creaseAbs/);
    const stack = makeStack([makeLayer('fbm'), makeLayer('ridged'), makeLayer('billow')]);
    const { body2d, body3d } = generateStackGLSL(stack);
    for (const body of [body2d, body3d]) {
      expect(body.match(/octaveKeep\(float\(i\), \d+\.0\)/g)?.length).toBeGreaterThanOrEqual(3);
      expect(body).toContain('creaseAbs(');
    }
    // the guard keeps one declaration when several chunks include the helper
    const height = buildHeightGLSL(body2d);
    expect(height).toContain('#ifndef TERRAIN_DETAIL_FN');
  });
});
