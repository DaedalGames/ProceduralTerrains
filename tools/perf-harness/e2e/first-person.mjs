// Real browser + production worker transport: click capture, look, keyboard,
// unlock/re-entry, and mobile joystick/viewport drag in every world mode.
// node tools/perf-harness/e2e/first-person.mjs
import { chromium } from 'playwright';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import assert from 'node:assert/strict';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../..');
const port = 6076;
const server = spawn(process.execPath, [path.join(ROOT, 'node_modules/vite/bin/vite.js'), '--port', String(port), '--strictPort', '--host', '127.0.0.1'], {
  cwd: ROOT, stdio: ['ignore', 'pipe', 'pipe'], windowsHide: true,
});
const browser = await chromium.launch({ channel: 'msedge', headless: true, args: ['--ignore-gpu-blocklist', '--enable-gpu', '--use-angle=d3d11'] });
try {
  await new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error('Vite did not start')), 30000);
    server.stdout.on('data', (data) => { if (/ready in/.test(String(data))) { clearTimeout(timer); resolve(); } });
    server.once('exit', (code) => { clearTimeout(timer); reject(new Error(`Vite exited: ${code}`)); });
  });
  const context = await browser.newContext({ viewport: { width: 1000, height: 700 }, hasTouch: true });
  const page = await context.newPage();
  page.on('pageerror', (error) => console.log('PAGE ERROR:', error.message));
  await page.goto(`http://127.0.0.1:${port}/tools/perf-harness/e2e/first-person.html`);
  await page.waitForFunction(() => window.__engine, null, { timeout: 180000 });
  await page.evaluate(() => window.__booted);
  assert.equal(await page.evaluate(() => window.__engine.rendererConfig.transport), 'worker');
  const cdp = await context.newCDPSession(page);
  const touchDrag = async (x, y, dx, dy) => {
    await cdp.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ x, y }] });
    await cdp.send('Input.dispatchTouchEvent', { type: 'touchMove', touchPoints: [{ x: x + dx, y: y + dy }] });
    await page.waitForTimeout(450);
    await cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
    await page.waitForTimeout(200);
  };
  for (const world of ['studio', 'infinite', 'planet']) {
    if (world !== 'studio') await page.evaluate((worldMode) => window.__engine.transitionMode({ worldMode, reason: 'world-mode' }), world);
    for (const mode of world === 'infinite' ? ['none', 'walk', 'plane'] : ['walk', 'plane']) {
      await page.evaluate((value) => window.__setMode(value), mode);
      await page.waitForTimeout(300);
      assert.equal(await page.evaluate(() => window.__engine.getSnapshot().pointerLockEnabled), true);
      await page.mouse.click(500, 250);
      await page.waitForFunction(() => document.pointerLockElement === document.getElementById('c'));
      await page.mouse.move(570, 280);
      await page.keyboard.down('KeyW');
      await page.waitForTimeout(350);
      await page.keyboard.up('KeyW');
      await page.evaluate(() => document.exitPointerLock());
      await page.waitForFunction(() => !document.pointerLockElement);
      // Re-enter after Escape/browser release.
      await page.mouse.click(500, 250);
      await page.waitForFunction(() => document.pointerLockElement === document.getElementById('c'));
      await page.evaluate(() => document.exitPointerLock());
      await page.waitForFunction(() => !document.pointerLockElement);
      // A coarse pointer makes the actual production joysticks visible.
      await page.emulateMedia({ media: 'screen' });
      await page.setViewportSize({ width: 780, height: 700 });
      const before = await page.evaluate(() => window.__engine.getPerfDiagnostics());
      const joystick = await page.locator('.touch-joystick-move').boundingBox();
      assert.ok(joystick, 'mobile move joystick is visible');
      await touchDrag(joystick.x + joystick.width / 2, joystick.y + joystick.height / 2, 0, -45);
      const after = await page.evaluate(() => window.__engine.getPerfDiagnostics());
      const distance = Math.hypot(...['x', 'y', 'z'].map((axis) => after.camera[axis] - before.camera[axis]));
      assert.ok(distance > 0.01, `${world}/${mode} mobile movement: ${distance}`);
      await touchDrag(350, 250, 70, 25);
      assert.equal(await page.evaluate(() => document.pointerLockElement), null);
      console.log('PASS', world, mode, 'desktop lock/re-entry + mobile movement/drag');
      await page.setViewportSize({ width: 1000, height: 700 });
    }
    await page.evaluate(() => window.__setMode('none'));
  }
  await context.close();
} finally {
  await browser.close();
  server.kill();
}
