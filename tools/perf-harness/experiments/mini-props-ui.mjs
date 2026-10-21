// UI check of the Mini Terrain "Props size" slider in the real app shell
// (headless Edge, real GPU): landing → Mini Terrain → Mountain range, then
// drive the slider and read the engine params it should change.
//   node tools/perf-harness/experiments/mini-props-ui.mjs   (standalone)
import { chromium } from 'playwright';
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../..');
const OUT = path.join(ROOT, 'output', 'perf-harness', 'runs', 'mini-props-ui');
fs.mkdirSync(OUT, { recursive: true });
const port = 6078;
const vite = path.join(ROOT, 'node_modules', 'vite', 'bin', 'vite.js');
const server = spawn(process.execPath, [vite, '--port', String(port), '--strictPort', '--host', '127.0.0.1'], { cwd: ROOT, stdio: ['ignore', 'pipe', 'pipe'], windowsHide: true });
await new Promise((resolve, reject) => {
  const on = (b) => { if (/Local:|ready in/i.test(b.toString().replace(/\x1b\[[0-9;]*m/g, ''))) resolve(); };
  server.stdout.on('data', on);
  server.stderr.on('data', on);
  setTimeout(() => reject(new Error('vite did not start')), 120000);
});
const context = await chromium.launchPersistentContext(path.join(ROOT, 'output', 'perf-harness', '.profile-ui'), {
  channel: 'msedge', headless: true, viewport: { width: 1440, height: 900 },
  args: ['--ignore-gpu-blocklist', '--enable-gpu', '--use-angle=d3d11', '--force-device-scale-factor=1'],
});
try {
  const page = await context.newPage();
  page.on('pageerror', (e) => console.log('[pageerror]', String(e.message).slice(0, 300)));
  await page.goto(`http://127.0.0.1:${port}/`);
  const create = page.getByRole('button', { name: /create terrain|créer/i }).first();
  await create.waitFor({ state: 'visible', timeout: 240000 });
  await create.click();
  await page.getByText('Choose a Mini Terrain template').click();
  await page.getByText('Mountain range').first().click();
  await page.getByRole('button', { name: /create mountain range/i }).click();
  await page.locator('.lp-primary, .landing-create').first().waitFor({ state: 'detached', timeout: 240000 }).catch(() => {});
  await page.getByText('Compiling shaders', { exact: false }).first().waitFor({ timeout: 120000 }).catch(() => {});
  await page.getByText('Compiling shaders', { exact: false }).first().waitFor({ state: 'detached', timeout: 480000 });
  await page.waitForTimeout(8000);
  // reach the setting through the Ctrl+K settings search
  await page.keyboard.press('Control+K');
  await page.keyboard.type('Mini Props Size');
  await page.waitForTimeout(500);
  await page.screenshot({ path: path.join(OUT, '0-search.png') });
  await page.keyboard.press('Enter');
  const slider = page.locator('[data-setting-id="mini.propScale"]');
  await slider.waitFor({ timeout: 20000 });
  await page.waitForTimeout(800);
  const read = () => slider.evaluate((el) => [el.innerText, ...[...el.querySelectorAll('input')].map((i) => i.value)].join(' | ').replace(/\s+/g, ' '));
  console.log('before', await read());
  await slider.screenshot({ path: path.join(OUT, '1-slider.png') });
  await page.screenshot({ path: path.join(OUT, '2-editor.png') });
  const range = slider.locator('input[type="range"]');
  await range.fill('2');
  await page.waitForTimeout(1500);
  console.log('after', await read());
  await slider.screenshot({ path: path.join(OUT, '3-slider-2x.png') });
  await page.screenshot({ path: path.join(OUT, '4-editor-2x.png') });
  console.log('UI check done');
} finally {
  await context.close().catch(() => {});
  spawn('taskkill', ['/pid', String(server.pid), '/T', '/F'], { windowsHide: true });
}
