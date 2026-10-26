import assert from 'node:assert/strict';
import { mkdir } from 'node:fs/promises';
import { renderToStaticMarkup } from 'react-dom/server';
import { createElement } from 'react';
import { createServer } from 'vite';
import { chromium } from 'playwright';

const server = await createServer({ optimizeDeps: { noDiscovery: true, include: [] },
  server: { host: '127.0.0.1', port: 0, hmr: false } });
await server.listen();
let browser;
try {
  const { renderPanel } = await server.ssrLoadModule('/src/components/panels/index.jsx');
  const { setLanguage } = await server.ssrLoadModule('/src/i18n/language.js');
  const { SliderField } = await server.ssrLoadModule('/src/components/ui/RealWorldMapPicker.jsx');
  setLanguage('fr', { persist: false });
  const markup = renderToStaticMarkup(renderPanel('terrain', {
    realTerrainMode: true, worldMode: 'studio', params: { heightScale: 420, noiseScale: 48 },
    perf: { resolutionScale: 1.25, terrainDetailQuality: 2 },
    importedMaps: { height: { width: 874, height: 478, elevation: { min: -430, max: 8850 },
      geographic: { bbox: { minLat: 45.78, maxLat: 45.92, minLon: 6.79, maxLon: 6.95 }, zoom: 12 },
      settings: { elevationMode: 'meters', mode: 'replace', heightStrength: 0.1, heightOffset: 0 } } },
  }));
  browser = await chromium.launch({ channel: 'msedge', headless: true,
    args: ['--enable-webgl', '--ignore-gpu-blocklist'] });
  const page = await browser.newPage({ viewport: { width: 390, height: 900 } });
  const errors = [];
  page.on('pageerror', (error) => errors.push(error.message));
  await page.goto(`${server.resolvedUrls.local[0]}tools/surface-qa.html`);
  const lighting = await page.evaluate(async () => {
    const THREE = await import('/node_modules/three/build/three.module.js');
    const { COMMON_UNIFORMS_GLSL, NOISE_GLSL } = await import('/src/engine/terrain/terrainGLSL.js');
    const { BIOME_GLSL } = await import('/src/engine/terrain/biomeGLSL.js');
    const { PALETTE_UNIFORMS_GLSL, TERRAIN_COLOR_FUNCTIONS_GLSL } = await import('/src/engine/shaders/terrainColor.glsl.js');
    const { createTerrainUniforms } = await import('/src/engine/terrain/TerrainMaterial.js');
    const uniforms = createTerrainUniforms();
    const renderer = new THREE.WebGLRenderer();
    const shaderErrors = [];
    renderer.debug.onShaderError = (gl, program) => shaderErrors.push(gl.getProgramInfoLog(program));
    const material = new THREE.ShaderMaterial({ uniforms, defines: { OCTAVES: 1 },
      vertexShader: 'void main(){gl_Position=vec4(position.xy,0.0,1.0);}',
      fragmentShader: `precision highp float; ${COMMON_UNIFORMS_GLSL}\n${NOISE_GLSL}\n${BIOME_GLSL}\n${PALETTE_UNIFORMS_GLSL}\n${TERRAIN_COLOR_FUNCTIONS_GLSL}\nvoid main(){vec3 n=vec3(0.0,1.0,0.0);gl_FragColor=vec4(terrainLighting(vec3(0.0),n,n,1.0,1.0,1.0,0.0,1.0,1.0,1.0,n),1.0);}` });
    const scene = new THREE.Scene();
    const mesh = new THREE.Mesh(new THREE.PlaneGeometry(2, 2), material);
    scene.add(mesh);
    const target = new THREE.WebGLRenderTarget(1, 1, { type: THREE.FloatType });
    const values = [];
    for (const specular of [1, 0]) {
      uniforms.uTerrainSpecular.value = specular;
      renderer.setRenderTarget(target);
      renderer.render(scene, new THREE.Camera());
      const pixels = new Float32Array(4);
      renderer.readRenderTargetPixels(target, 0, 0, 1, 1, pixels);
      values.push(pixels[0]);
    }
    const glError = renderer.getContext().getError();
    material.dispose(); mesh.geometry.dispose(); target.dispose(); renderer.dispose();
    return { values, shaderErrors, glError };
  });
  assert.deepEqual(errors, []);
  assert.deepEqual(lighting.shaderErrors, []);
  assert.equal(lighting.glError, 0);
  assert.ok(lighting.values[0] > 0.5);
  assert.equal(lighting.values[1], 0);
  await page.setContent(`<html lang="fr"><head><link rel="stylesheet" href="${server.resolvedUrls.local[0]}src/styles.css"></head><body><div style="display:flex;flex-direction:column;width:390px;height:900px;background:var(--bg-panel)">${markup}</div></body></html>`);
  await page.locator('.real-elevation-status').waitFor();
  assert.match(await page.locator('.real-elevation-status').innerText(), /Altitudes réelles actives/);
  assert.equal(await page.locator('[data-setting-id="terrain.heightScale"]').count(), 0);
  assert.equal(await page.locator('[data-setting-id="terrain.realWorldVerticalScale"] input[type="range"]').inputValue(), '0.1');
  const statusBox = await page.locator('.real-elevation-status').boundingBox();
  const contentBox = await page.locator('.side-panel-content').boundingBox();
  assert.ok(statusBox.y + statusBox.height < contentBox.y + contentBox.height);
  await mkdir('output', { recursive: true });
  await page.screenshot({ path: 'output/real-terrain-height-active.png' });
  const resolution = page.locator('[data-setting-id="performance.resolutionScale"]');
  await resolution.scrollIntoViewIfNeeded();
  assert.equal(await resolution.locator('input[type="range"]').inputValue(), '1.25');
  assert.equal(await page.locator('[data-setting-id="terrain.surfaceResolution"] input[type="range"]').inputValue(), '12');
  assert.equal(await page.locator('[data-setting-id="performance.terrainDetailQuality"] select').inputValue(), '2');
  await page.screenshot({ path: 'output/real-terrain-resolution.png' });
  const sliders = [
    { label: 'Area size', value: 30, min: 1, max: 100, step: 1, unit: ' km' },
    { label: 'Terrain detail', value: 12, min: 6, max: 15, step: 1, unit: ' · z12 effective' },
  ].map((props) => renderToStaticMarkup(createElement(SliderField, props))).join('');
  await page.setContent(`<html><head><link rel="stylesheet" href="${server.resolvedUrls.local[0]}src/styles.css"></head><body><div style="width:310px;display:grid;gap:24px;padding:20px;background:var(--bg-panel)">${sliders}</div></body></html>`);
  const fills = await page.locator('.realworld-map-slider .slider-track-fill').evaluateAll((items) =>
    items.map((item) => ({ color: getComputedStyle(item).backgroundColor, width: item.getBoundingClientRect().width })));
  assert.equal(fills.length, 2);
  for (const fill of fills) { assert.equal(fill.color, 'rgb(37, 99, 235)'); assert.ok(fill.width > 0); }
  await page.screenshot({ path: 'output/real-terrain-map-sliders.png' });
  console.log(JSON.stringify({ lighting, fills, screenshots: ['output/real-terrain-height-active.png', 'output/real-terrain-resolution.png', 'output/real-terrain-map-sliders.png'] }, null, 2));
} finally {
  await browser?.close();
  await server.close();
}
