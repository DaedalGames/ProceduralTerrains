import assert from 'node:assert/strict';
import { mkdir, writeFile } from 'node:fs/promises';
import { chromium } from 'playwright';

const output = new URL('../output/docs-qa/', import.meta.url);
await mkdir(output, { recursive: true });
const browser = await chromium.launch({ channel: 'msedge', headless: true });
try {
  const page = await browser.newPage({ viewport: { width: 1440, height: 1000 } });
  const errors = [];
  page.on('pageerror', (error) => errors.push(error.message));
  await page.route('**/api/**', (route) => route.fulfill({ status: 200, contentType: 'application/json', body: '{"user":null}' }));
  await page.addInitScript(() => localStorage.setItem('terrain-studio.language', 'fr'));
  const url = process.env.TERRAIN_DOCS_URL || 'http://127.0.0.1:6073';
  await page.goto(url + '/#/docs/api/configuration');
  await page.locator('.docs-markdown h1').filter({ hasText: 'Référence API' }).waitFor();
  assert.equal(await page.locator('#app').count(), 0, 'Direct docs links must not boot the WebGL editor');
  await page.locator('#configuration').waitFor();
  assert(await page.locator('.docs-outline').isVisible());
  await page.screenshot({ path: new URL('api-desktop.png', output).pathname.replace(/^\/([A-Za-z]:)/, '$1'), fullPage: true });
  await page.keyboard.press('Control+k');
  await page.getByRole('combobox', { name: 'Rechercher dans la documentation' }).fill('heightmap');
  assert(await page.locator('.docs-results [role="option"]').count() > 0);
  await page.getByRole('combobox', { name: 'Rechercher dans la documentation' }).fill('sampleHeight3D');
  assert(await page.locator('.docs-results a[href="#/docs/api"]').count() > 0);
  await page.keyboard.press('Enter');
  assert(page.url().includes('#/docs/'));
  await page.goto(url + '/#/docs/overview');
  await page.getByRole('heading', { name: 'Vos terrains. Votre scène Three.js.' }).waitFor();
  await page.screenshot({ path: new URL('overview-desktop.png', output).pathname.replace(/^\/([A-Za-z]:)/, '$1') });
  for (const id of ['getting-started', 'worlds', 'effects', 'code-export', 'api', 'package']) {
    await page.goto(url + '/#/docs/' + id);
    await page.locator('.docs-markdown h1').waitFor();
    assert(await page.locator('.docs-copy').count() > 0, id + ' must have copyable examples');
  }
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto(url + '/#/docs/api/configuration');
  await page.locator('.docs-sidebar-toggle').click();
  await page.locator('.docs-nav').getByRole('link', { name: 'Studio et export de code', exact: true }).click();
  await page.getByRole('heading', { level: 1, name: 'Studio et export de code' }).waitFor();
  await page.waitForFunction(() => {
    const heading = document.querySelector('.docs-markdown h1');
    return heading && heading.getBoundingClientRect().top > 90;
  });
  assert.equal(await page.locator('.docs-sidebar').getAttribute('class'), 'docs-sidebar');
  assert(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth));
  await page.screenshot({ path: new URL('export-mobile.png', output).pathname.replace(/^\/([A-Za-z]:)/, '$1') });
  assert.deepEqual(errors, []);
  await page.locator('.lp-brand').click();
  await page.locator('#app').waitFor();
  const result = { desktop: true, mobile: true, french: true, search: true, deepLinks: true, routes: 8, pageErrors: errors };
  await writeFile(new URL('result.json', output), JSON.stringify(result, null, 2));
  console.log(JSON.stringify(result, null, 2));
} finally { await browser.close(); }
