import assert from 'node:assert/strict';
import { mkdir, writeFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { createServer, build, preview } from 'vite';
import { chromium } from 'playwright';

const fixture = new URL('../.cache/terrain-snippet/', import.meta.url);
const output = new URL('../output/snippet-qa/', import.meta.url);
await mkdir(fixture, { recursive: true });
await mkdir(output, { recursive: true });
await writeFile(new URL('index.html', fixture), '<!doctype html><html><body><div id="fixture"></div><script type="module" src="./app.jsx"></script></body></html>');
await writeFile(new URL('app.jsx', fixture), `
import React, { useCallback, useState } from 'react';
import { createRoot } from 'react-dom/client';
import { ExportPanel } from '/src/components/panels/index.jsx';
import { FlatPanelContext } from '/src/components/panels/PanelContext.js';
import { createTerrainCodeSnippet } from '/src/export/TerrainCodeExporter.js';
import { setLanguage } from '/src/i18n/language.js';
import '/src/styles.css';
setLanguage('fr', { persist: false });
function App() {
  const [seed, setSeed] = useState(17);
  const [fail, setFail] = useState(false);
  const generate = useCallback(async () => {
    if (fail) throw new Error('capture-test');
    return createTerrainCodeSnippet({worldMode:'studio',editorMode:'procedural',generationSource:'classic',params:{seed,chunkCount:2,waterMode:'off'},tiles:[{cx:0,cz:0}]});
  }, [seed, fail]);
  return <><div style={{position:'relative',display:'flex',flexDirection:'column',width:'min(440px, 100vw)',height:'100vh'}}>
    <FlatPanelContext.Provider value={true}><ExportPanel ctx={{worldMode:'studio',boardSize:256,tiles:[{cx:0,cz:0}],onTerrainCodeSnippet:generate,terrainCodeRevision:seed,onClose:()=>{},onExport:async()=>{}}}/></FlatPanelContext.Provider>
  </div><div style={{position:'fixed',right:0,top:0}}><button onClick={()=>setSeed(42)}>Change seed</button><button onClick={()=>setFail(!fail)}>Toggle failure</button></div></>;
}
createRoot(document.getElementById('fixture')).render(<App/>);
`);

const server = await createServer({ server: { host: '127.0.0.1', port: 0 } });
let browser, consumer;
try {
  await server.listen();
  browser = await chromium.launch({ channel: 'msedge', headless: true, args: ['--enable-webgl', '--ignore-gpu-blocklist'] });
  const context = await browser.newContext({ viewport: { width: 1100, height: 900 }, permissions: ['clipboard-read', 'clipboard-write'] });
  const page = await context.newPage();
  const errors = [];
  page.on('pageerror', (error) => errors.push(error.message));
  await page.goto(server.resolvedUrls.local[0] + '.cache/terrain-snippet/index.html');
  await page.getByRole('button', { name: 'Utiliser dans le code', exact: true }).click();
  const snippet = page.locator('.terrain-code-snippet');
  await page.waitForFunction(() => document.querySelector('.terrain-code-snippet')?.getAttribute('aria-busy') === 'false');
  const terrainCode = snippet.locator('.docs-code').nth(1);
  assert((await terrainCode.innerText()).includes('"seed": 17'));
  await terrainCode.getByRole('button', { name: 'Copier le code', exact: true }).click();
  const integration = await page.evaluate(() => navigator.clipboard.readText());
  assert(integration.includes('function renderTerrain(deltaSeconds)'));
  assert(integration.includes('function disposeTerrain()'));
  await terrainCode.getByRole('tab', { name: 'Exemple complet' }).click();
  await page.getByRole('button', { name: 'Change seed', exact: true }).click();
  await page.waitForFunction(() => document.querySelector('.terrain-code-snippet')?.getAttribute('aria-busy') === 'false' && document.querySelector('.terrain-code-snippet .docs-code:last-of-type pre')?.textContent.includes('"seed": 42'));
  assert.equal(await terrainCode.getByRole('tab', { name: 'Exemple complet' }).getAttribute('aria-selected'), 'true');
  await snippet.getByRole('button', { name: 'Actualiser le code' }).click();
  await page.waitForFunction(() => document.querySelector('.terrain-code-snippet')?.getAttribute('aria-busy') === 'false');
  await terrainCode.getByRole('button', { name: /Copier le code|Copié/ }).click();
  const complete = await page.evaluate(() => navigator.clipboard.readText());
  assert(complete.includes('renderer.setAnimationLoop'));
  assert(!complete.includes("from './terrain.js'"));
  await page.screenshot({ path: fileURLToPath(new URL('desktop.png', output)) });
  await page.setViewportSize({ width: 390, height: 844 });
  assert(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth));
  await page.screenshot({ path: fileURLToPath(new URL('mobile.png', output)) });
  await page.getByRole('button', { name: 'Toggle failure', exact: true }).click();
  await snippet.getByText('Impossible de générer le code du terrain.', { exact: true }).waitFor();
  await page.getByRole('button', { name: 'Toggle failure', exact: true }).click();
  await snippet.getByRole('tab', { name: 'Dans votre scène' }).waitFor();
  assert.deepEqual(errors, []);

  // Build the copied code with a marker after its first frame. No terrain.js
  // or #status element is provided by the consumer.
  await writeFile(new URL('copied.js', fixture), complete.replace('pipeline.render(scene, camera);', 'pipeline.render(scene, camera); window.terrainRendered = true;'));
  await writeFile(new URL('render.html', fixture), '<!doctype html><html><body><script type="module" src="./copied.js"></script></body></html>');
  await build({ root: fileURLToPath(fixture), configFile: false, base: './', logLevel: 'warn', build: { rollupOptions: { input: fileURLToPath(new URL('render.html', fixture)) } } });
  consumer = await preview({ root: fileURLToPath(fixture), configFile: false, preview: { host: '127.0.0.1', port: 0 } });
  await page.goto(consumer.resolvedUrls.local[0] + 'render.html');
  await page.waitForFunction(() => window.terrainRendered, null, { timeout: 60000 });
  assert(await page.locator('canvas').isVisible());
  await page.screenshot({ path: fileURLToPath(new URL('rendered.png', output)) });
  assert.deepEqual(errors, []);
  console.log('Export panel: French UI, both clipboard formats, live seed, refresh, tab preservation, failure recovery, mobile layout and production WebGL render passed.');
} finally {
  await browser?.close();
  await consumer?.close();
  await server.close();
}
