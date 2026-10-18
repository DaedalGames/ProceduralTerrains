import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { zlibSync } from 'fflate';
import { fileURLToPath } from 'node:url';
import { build, preview } from 'vite';
import { chromium } from 'playwright';
const root = fileURLToPath(new URL('../examples/three-finite-terrain', import.meta.url));
const raw = [];
for (let size = 512; size >= 1; size /= 2) {
  for (let i = 0; i < size * size; i++) raw.push(145, 90, 40, 255);
  for (let i = 0; i < size * size; i++) raw.push(128, 128, 128, 255);
}
const bytes = zlibSync(new Uint8Array(raw)),
  sha256 = createHash('sha256').update(bytes).digest('hex');
const catalog = JSON.stringify({
  assets: [
    {
      id: 'polyhaven:red_sand',
      name: 'Fixture',
      physicalSize: [2, 2],
      resolutions: { 512: { path: 'fixture.pbr', sha256 } },
    },
  ],
});
const middleware = (server) => {
  server.middlewares.use((req, res, next) => {
    if (req.url === '/__fixture__/catalog.json') {
      res.setHeader('Content-Type', 'application/json');
      res.end(catalog);
    } else if (req.url === '/__fixture__/fixture.pbr') {
      res.end(bytes);
    } else next();
  });
};
await build({ root, logLevel: 'warn' });
const server = await preview({
  root,
  preview: { host: '127.0.0.1', port: 0 },
  plugins: [{ name: 'terrain-fixtures', configurePreviewServer: middleware }],
});
let browser;
try {
  browser = await chromium.launch({
    headless: true,
    ...(process.env.TERRAIN_BROWSER_PATH
      ? { executablePath: process.env.TERRAIN_BROWSER_PATH }
      : {}),
    args: [
      '--no-sandbox',
      '--enable-webgl',
      '--ignore-gpu-blocklist',
      '--use-gl=angle',
      '--use-angle=swiftshader',
      '--enable-unsafe-swiftshader',
    ],
  });
  const cases = process.argv.slice(2);
  if (!cases.length)
    cases.push(
      'finite',
      'heightmap',
      'manual',
      'graph',
      'geo',
      'cache',
      'infinite',
      'planet',
      'mini',
      'planet:effects',
      'infinite:effects',
      'mini:effects',
      'underwater',
      'water:legacy',
      'water:realistic',
      'water:volumetric',
      'water:cinematic',
      'water:stylized',
      'clouds:legacy',
      'clouds:realistic',
      'worker',
      'surface',
      'surface-worker',
      'detail',
      'export',
      'infinite:export',
      'planet:export',
    );
  for (const kind of cases) {
    const page = await browser.newPage();
    const errors = [];
    page.on('pageerror', (e) => errors.push(e.message));
    page.on('console', (m) => {
      if (m.type() === 'error') errors.push(m.text());
    });
    try {
      await page.goto(new URL('matrix.html', server.resolvedUrls.local[0]).href);
      await page.waitForFunction(() => !!window.runCase);
      const result = await page.evaluate((kind) => window.runCase(kind), kind);
      assert.equal(errors.length, 0, `${kind}: ${errors.join('\n')}`);
      assert.equal(result.glError, 0, JSON.stringify(result));
      assert(result.colors > 1, `${kind}: empty render`);
      console.log(JSON.stringify(result));
    } catch (e) {
      throw new Error(`${kind}: ${e.message}\n${errors.join('\n')}`, { cause: e });
    } finally {
      await page.close();
    }
  }
} finally {
  await browser?.close();
  await new Promise((resolve, reject) =>
    server.httpServer.close((error) => (error ? reject(error) : resolve())),
  );
}
