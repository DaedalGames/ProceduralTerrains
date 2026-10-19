import assert from 'node:assert/strict';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { chromium } from 'playwright';

const output = fileURLToPath(new URL('../output/playground-qa/', import.meta.url));
await mkdir(output, { recursive: true });
const browser = await chromium.launch({ channel: 'msedge', headless: true, args: ['--enable-webgl', '--ignore-gpu-blocklist'] });
const url = process.env.TERRAIN_PLAYGROUND_URL || 'http://127.0.0.1:6075';
const smoke = process.env.TERRAIN_PLAYGROUND_SMOKE === '1';
try {
  const context = await browser.newContext({ viewport: { width: 1500, height: 1050 }, acceptDownloads: true });
  await context.route('**/api/**', (route) => route.fulfill({ status: 200, contentType: 'application/json', body: '{"user":null}' }));
  await context.addInitScript(() => {
    if (window === top) {
      try { localStorage.setItem('terrain-studio.language', 'fr'); } catch { /* file:// preview */ }
    }
  });
  const page = await context.newPage();
  const editor = page.locator('.pg-code textarea');
  const ready = async () => {
    await page.waitForFunction(() => ['ready', 'error'].includes(document.querySelector('.pg')?.dataset.status), null, { timeout: 90000 });
    assert.equal(await page.locator('.pg').getAttribute('data-status'), 'ready', await page.locator('.pg-logs').innerText());
    await page.frameLocator('iframe').locator('canvas').waitFor();
    await page.frameLocator('iframe').locator('canvas').evaluate(() => new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve))));
  };
  await page.goto(url + '/#/docs/playground');
  await ready();
  assert.equal(await page.locator('#app').count(), 0, 'The docs must not start the studio editor');
  assert.equal(await page.locator('iframe').getAttribute('sandbox'), 'allow-scripts');
  assert((await page.locator('.pg-logs').innerText()).includes('42'));
  const first = await page.locator('.pg-frame').screenshot();
  await page.screenshot({ path: output + '/desktop.png' });
  const initial = await editor.inputValue();
  await editor.fill(initial.replace('seed: 42', 'seed: 678'));
  await editor.press('Control+Enter');
  await ready();
  assert((await page.locator('.pg-logs').innerText()).includes('678'));
  assert(!first.equals(await page.locator('.pg-frame').screenshot()), 'Editing the seed must change the preview');

  const isolation = "try { console.log(parent.document.body); } catch { console.log('parent-isolated'); }\nthrow new Error('playground-error-check');";
  await editor.fill(isolation);
  await editor.press('Control+Enter');
  await page.waitForFunction(() => document.querySelector('.pg')?.dataset.status === 'error');
  assert((await page.locator('.pg-logs').innerText()).includes('parent-isolated'));
  assert((await page.locator('.pg-logs').innerText()).includes('playground-error-check'));
  await page.getByRole('button', { name: 'Arrêter', exact: true }).click();
  assert.equal(await page.locator('iframe').count(), 0);
  await page.getByRole('button', { name: 'Réinitialiser', exact: true }).click();
  await ready();

  for (const template of smoke ? [] : ['scene', 'water', 'infinite', 'planet', 'mini']) {
    await page.locator('.pg-select select').selectOption(template);
    await ready();
    console.log('Rendered template:', template);
  }
  await page.screenshot({ path: output + '/mini.png' });
  await page.locator('.pg-select select').selectOption('viewer');
  await ready();
  await page.waitForFunction(() => JSON.parse(localStorage.getItem('procedural-terrains:docs-playground:v1'))?.code?.includes('createTerrainViewer'));
  await page.getByRole('button', { name: 'Partager', exact: true }).click();
  assert(page.url().includes('?code='));
  const shared = await context.newPage();
  await shared.goto(page.url());
  await shared.locator('.pg-code textarea').waitFor();
  assert.equal(await shared.locator('.pg').getAttribute('data-status'), 'idle', 'Shared code must wait for Run');
  assert.equal(await shared.locator('iframe').count(), 0);
  await shared.close();

  const downloadPromise = page.waitForEvent('download');
  await page.getByRole('button', { name: 'Télécharger .html', exact: true }).click();
  const download = await downloadPromise;
  const htmlPath = output + '/standalone.html';
  await download.saveAs(htmlPath);
  assert((await readFile(htmlPath, 'utf8')).includes('terrain-runtime:/'));
  const offline = await context.newPage();
  await context.setOffline(true);
  const offlineReady = offline.waitForEvent('console', { predicate: (message) => message.text().includes('Terrain ready, seed'), timeout: 60000 });
  await offline.goto(pathToFileURL(htmlPath).href);
  await offlineReady;
  await offline.locator('canvas').waitFor({ timeout: 60000 });
  await offline.locator('canvas').evaluate(() => new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve))));
  assert.equal(await offline.locator('pre').count(), 0, 'Standalone HTML must run without network errors');
  await offline.close();
  await context.setOffline(false);

  await page.setViewportSize({ width: 390, height: 844 });
  await page.waitForFunction(() => {
    const menu = document.querySelector('.lp-nav-menu');
    return menu && getComputedStyle(menu).visibility === 'hidden' && Number(getComputedStyle(menu).opacity) === 0;
  });
  await page.screenshot({ path: output + '/mobile.png', fullPage: true });
  assert(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth));
  await page.evaluate(() => {
    const box = document.querySelector('.lp-content-scroll');
    box.scrollTop += document.querySelector('.pg-frame').getBoundingClientRect().top - box.getBoundingClientRect().top - 65;
  });
  assert(await page.locator('.lp-content-scroll').evaluate((box) => box.scrollTop > 0), 'Mobile preview must be reachable in the documentation scroller');
  await page.screenshot({ path: output + '/mobile-preview.png' });
  await page.getByRole('button', { name: 'Arrêter', exact: true }).click();
  await page.locator('.docs-sidebar-toggle').click();
  await page.locator('.docs-nav a[href="#/docs/api"]').click();
  await page.getByRole('heading', { name: 'Référence API', exact: true }).waitFor();
  assert.equal(await page.locator('iframe').count(), 0);
  const result = { templates: smoke ? 1 : 6, editAndRun: true, errors: true, isolation: true, stopAndReset: true, sharedLink: true, offlineDownload: true, mobile: true, navigationCleanup: true };
  await writeFile(output + (smoke ? '/production-result.json' : '/result.json'), JSON.stringify(result, null, 2));
  console.log(JSON.stringify(result, null, 2));
} finally { await browser.close(); }
