import assert from 'node:assert/strict';
import { fileURLToPath } from 'node:url';
import { createServer } from 'vite';
import { chromium } from 'playwright';

const root = fileURLToPath(new URL('../examples/three-finite-terrain', import.meta.url));
const server = await createServer({ root, server: { host: '127.0.0.1', port: 0 } });
await server.listen();
let browser;
try {
  browser = await chromium.launch({
    headless: true,
    ...(process.env.TERRAIN_BROWSER_PATH ? { executablePath: process.env.TERRAIN_BROWSER_PATH } : {}),
    args: ['--no-sandbox', '--enable-webgl', '--ignore-gpu-blocklist', '--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader'],
  });
  const page = await browser.newPage({ viewport: { width: 900, height: 700 } });
  const errors = [];
  page.on('pageerror', e => errors.push(e.message));
  page.on('console', m => { if (m.type() === 'error') errors.push(m.text()); });
  await page.goto(server.resolvedUrls.local[0]);
  await page.waitForFunction(() => !document.querySelector('#regenerate').disabled, null, { timeout: 120000 });
  const result = await page.evaluate(async () => {
    const { ready } = await import('/main.js');
    const { terrain, renderer, scene, camera } = await ready;
    const THREE = await import('/node_modules/three/build/three.module.js');
    renderer.setAnimationLoop(null);
    const target = new THREE.WebGLRenderTarget(96, 96);
    const pixels = new Uint8Array(96 * 96 * 4);
    const render = () => {
      renderer.setRenderTarget(target);
      terrain.update(0, { camera });
      renderer.render(scene, camera);
      renderer.readRenderTargetPixels(target, 0, 0, 96, 96, pixels);
      return pixels.slice();
    };
    const first = render();
    await terrain.configure({ source: { seed: 42 } });
    const second = render();
    let changedPixels = 0;
    for (let i = 0; i < first.length; i += 4) {
      if (first[i] !== second[i] || first[i + 1] !== second[i + 1] || first[i + 2] !== second[i + 2]) changedPixels++;
    }
    await terrain.configure({ source: { octaves: 4 } });
    render();
    const diagnostics = terrain.getDiagnostics();
    const gl = renderer.getContext();
    const info = gl.getExtension('WEBGL_debug_renderer_info');
    const gpu = info ? gl.getParameter(info.UNMASKED_RENDERER_WEBGL) : gl.getParameter(gl.RENDERER);
    const glError = gl.getError();
    terrain.dispose();
    renderer.render(scene, camera);
    const rendererUsable = !gl.isContextLost();
    renderer.setRenderTarget(null); target.dispose();
    return { changedPixels, diagnostics, glError, rendererUsable, gpu };
  });
  assert.equal(errors.length, 0, errors.join('\n'));
  assert(result.changedPixels > 100, 'Terrain must visibly respond to seed changes');
  assert.equal(result.glError, 0);
  assert(result.rendererUsable);
  assert.equal(result.diagnostics.chunks, 64);
  console.log(JSON.stringify(result, null, 2));
} finally {
  await browser?.close();
  await server.close();
}
