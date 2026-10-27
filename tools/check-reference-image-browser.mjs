import assert from 'node:assert/strict';
import { mkdir } from 'node:fs/promises';
import { resolve } from 'node:path';
import { createServer } from 'vite';
import { chromium } from 'playwright';

// Real WebGL + canvas decoding test; no terrain shader mocks or image fixtures.
const output = resolve('output/reference-image-qa');
await mkdir(output, { recursive: true });
const server = await createServer({ optimizeDeps: { entries: ['index.html'] }, server: { host: '127.0.0.1', port: 0 }, plugins: [{
  name: 'reference-image-qa',
  configureServer(server) {
    server.middlewares.use('/reference-image-qa', (_req, res) => {
      res.setHeader('Content-Type', 'text/html');
      res.end('<html><body style="margin:0;background:#18202b"><canvas id="view"></canvas></body></html>');
    });
  },
}] });
await server.listen();
let browser;
try {
  browser = await chromium.launch({ headless: true,
    ...(process.env.TERRAIN_BROWSER_PATH ? { executablePath: process.env.TERRAIN_BROWSER_PATH } : {}),
    args: ['--no-sandbox', '--enable-webgl', '--ignore-gpu-blocklist', '--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader'],
  });
  const page = await browser.newPage({ viewport: { width: 512, height: 512 } });
  const errors = [];
  page.on('pageerror', (e) => errors.push(e.message));
  await page.goto(`${server.resolvedUrls.local[0]}reference-image-qa`);
  const result = await page.evaluate(async () => {
    const THREE = await import('/node_modules/three/build/three.module.js');
    const { Engine } = await import('/src/engine/Engine.js');
    const { encodePortableProject, decodePortableProject } = await import('/src/project/PortableProject.js');
    const source = document.createElement('canvas');
    source.width = source.height = 64;
    const ctx = source.getContext('2d');
    ctx.fillStyle = '#ff0000'; ctx.fillRect(0, 0, 32, 32);
    ctx.fillStyle = '#00ff00'; ctx.fillRect(32, 0, 32, 32);
    ctx.fillStyle = '#0000ff'; ctx.fillRect(0, 32, 32, 32);
    // Bottom right stays transparent.
    const blob = await new Promise((resolve) => source.toBlob(resolve));
    const renderer = new THREE.WebGLRenderer({ canvas: document.querySelector('#view'), preserveDrawingBuffer: true });
    renderer.setSize(512, 512);
    const camera = new THREE.OrthographicCamera(-1, 1, 1, -1, 0.1, 10);
    camera.position.set(0, 3, 0); camera.up.set(0, 0, -1); camera.lookAt(0, 0, 0);
    const scene = new THREE.Scene();
    scene.background = new THREE.Color('#ffffff');
    // Opaque terrain above the reference: it must not occlude the guide.
    const terrain = new THREE.Mesh(new THREE.PlaneGeometry(2, 2), new THREE.MeshBasicMaterial({ color: '#ffffff' }));
    terrain.rotation.x = -Math.PI / 2; terrain.position.y = 0.5; scene.add(terrain);
    const engine = Object.assign(Object.create(Engine.prototype), {
      params: { seed: 1, chunkCount: 1, chunkSize: 2 }, importedMaps: {}, importedMapState: {},
      cb: { onImportedMaps() {}, onToast() {} }, worldMode: 'studio', exploreMode: 'none',
      renderer, camera,
    });
    const read = () => {
      const gl = renderer.getContext(), pixels = new Uint8Array(512 * 512 * 4);
      gl.readPixels(0, 0, 512, 512, gl.RGBA, gl.UNSIGNED_BYTE, pixels);
      const sample = (x, y) => [...pixels.slice((y * 512 + x) * 4, (y * 512 + x) * 4 + 3)];
      return { topLeft: sample(128, 384), topRight: sample(384, 384), bottomLeft: sample(128, 128), bottomRight: sample(384, 128) };
    };
    const render = () => { renderer.render(scene, camera); engine._renderReferenceImage(); return read(); };
    await engine.importTileMap('reference', new File([blob], 'quadrants.png', { type: 'image/png' }));
    engine.setTileMapSetting('reference', 'opacity', 1);
    const opaque = render();
    engine.setTileMapSetting('reference', 'opacity', 0.5);
    const half = render();
    engine.setTileMapSetting('reference', 'visible', false);
    const hidden = render();
    engine.setTileMapSetting('reference', 'visible', true);
    engine.worldMode = 'planet'; const planet = render();
    engine.worldMode = 'infinite'; const infinite = render();
    engine.worldMode = 'studio';
    engine.setTileMapSetting('reference', 'x', 2); const moved = render();
    engine.setTileMapSetting('reference', 'x', 0);
    engine.setTileMapSetting('reference', 'scale', 0.25); const small = render();
    engine.setTileMapSetting('reference', 'scale', 1);
    engine.setTileMapSetting('reference', 'opacity', 1);
    const saved = engine._serializeReferenceImage();
    const project = await decodePortableProject(await encodePortableProject({ terrain: { params: engine.params, referenceImage: saved } }));
    engine.clearReferenceImage();
    await engine._restoreReferenceImage(project.terrain.referenceImage);
    const restored = render();
    // Moving the real terrain must not affect the reference or its saved pixels.
    terrain.position.y = 0.8;
    const edited = render();
    return { opaque, half, hidden, planet, infinite, moved, small, restored, edited,
      roundtrip: saved.dataUrl === engine._serializeReferenceImage().dataUrl };
  });
  assert.deepEqual(result.opaque, { topLeft: [255, 0, 0], topRight: [0, 255, 0], bottomLeft: [0, 0, 255], bottomRight: [255, 255, 255] });
  assert.deepEqual(result.restored, result.opaque);
  assert.deepEqual(result.edited, result.opaque);
  for (const key of ['hidden', 'planet', 'infinite', 'moved', 'small']) {
    for (const pixel of Object.values(result[key])) assert.deepEqual(pixel, [255, 255, 255], key);
  }
  assert(result.half.topLeft[0] === 255 && result.half.topLeft[1] > 100 && result.half.topLeft[1] < 230);
  assert(result.roundtrip);
  assert.deepEqual(errors, []);
  await page.screenshot({ path: resolve(output, 'reference-quadrants.png') });
  console.log(JSON.stringify({ passed: true, checks: ['orientation', 'RGBA transparency', 'opacity', 'visibility', 'position', 'scale', 'mode isolation', 'portable roundtrip', 'terrain editing'], result }));
} finally {
  await browser?.close();
  await server.close();
}
