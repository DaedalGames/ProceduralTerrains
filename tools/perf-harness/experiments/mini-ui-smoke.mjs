// UI smoke test for Mini Terrain in the real app shell (headless Edge, real
// GPU): landing create dialog → Mini recipe → editor with the Mini panel.
//   node tools/perf-harness/experiments/mini-ui-smoke.mjs   (standalone)
import { chromium } from 'playwright';
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../..');
const OUT = path.join(ROOT, 'output', 'perf-harness', 'runs', 'mini-ui');
fs.mkdirSync(OUT, { recursive: true });
const port = 6077;
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
  page.on('console', (m) => { if (m.type() === 'error') console.log('[console.error]', m.text().slice(0, 200)); });
  await page.goto(`http://127.0.0.1:${port}/`);
  const create = page.getByRole('button', { name: /create terrain|new terrain|créer|nouveau/i }).first();
  await create.waitFor({ state: 'visible', timeout: 240000 });
  await page.waitForFunction(() => !document.querySelector('.lp-primary[disabled]'), null, { timeout: 240000 }).catch(() => {});
  await create.click();
  await page.locator('.landing-create-mini').waitFor({ timeout: 20000 });
  await page.screenshot({ path: path.join(OUT, '1-create-dialog.png') });
  await page.locator('.landing-create-mini-recipes button').first().click();
  // wait for the editor shell and the Mini panel
  await page.getByText('Mini Terrain', { exact: false }).first().waitFor({ timeout: 240000 });
  await page.waitForTimeout(12000);
  await page.screenshot({ path: path.join(OUT, '2-editor.png') });
  console.log('UI smoke done');
} finally {
  await context.close().catch(() => {});
  spawn('taskkill', ['/pid', String(server.pid), '/T', '/F'], { windowsHide: true });
}
