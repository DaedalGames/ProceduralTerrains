import assert from 'node:assert/strict';
import { mkdir, writeFile, readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createServer, build, preview } from 'vite';
import { chromium } from 'playwright';

const fixture = fileURLToPath(new URL('../.cache/export-code-consumer/', import.meta.url));
const server = await createServer({ server: { middlewareMode: true }, appType: 'custom' });
let consumer, browser;
try {
  const { createTerrainCodeFiles } = await server.ssrLoadModule('/src/export/TerrainCodeExporter.js');
  const files = createTerrainCodeFiles({
    worldMode: 'studio', editorMode: 'procedural', generationSource: 'classic',
    params: { seed: 42, chunkCount: 2, waterMode: 'off' },
    tiles: [{ cx: 0, cz: 0 }],
  });
  await mkdir(fixture, { recursive: true });
  for (const [path, bytes] of Object.entries(files)) await writeFile(join(fixture, path.slice('code/'.length)), bytes);
  const packageInfo = JSON.parse(await readFile(new URL('../packages/procedural-terrains/package.json', import.meta.url), 'utf8'));
  for (const [key, entry] of Object.entries(packageInfo.exports)) {
    if (key !== './package.json') await import(new URL('../packages/procedural-terrains/' + entry.import.slice(2), import.meta.url));
  }
  await build({ root: fixture, configFile: false, base: './', logLevel: 'warn' });
  consumer = await preview({ root: fixture, configFile: false, preview: { port: 6074, host: '127.0.0.1', strictPort: true } });
  browser = await chromium.launch({ channel: 'msedge', headless: true, args: ['--enable-webgl', '--ignore-gpu-blocklist'] });
  const page = await browser.newPage({ viewport: { width: 800, height: 600 } });
  const errors = [];
  page.on('pageerror', (error) => errors.push(error.message));
  await page.goto('http://127.0.0.1:6074');
  await page.waitForFunction(() => !document.querySelector('#status'), null, { timeout: 60000 });
  assert(await page.locator('canvas').isVisible());
  await page.screenshot({ path: fileURLToPath(new URL('../output/docs-qa/exported-code.png', import.meta.url)) });
  assert.deepEqual(errors, []);
  console.log('Generated npm consumer: production build, all public ESM imports and real WebGL terrain rendering passed.');
} finally {
  await browser?.close();
  await consumer?.close();
  await server.close();
}
