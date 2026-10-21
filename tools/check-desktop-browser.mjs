import assert from 'node:assert/strict';
import { _electron as electron } from 'playwright';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { encodePortableProject, decodePortableProject } from '../src/project/PortableProject.js';
import { createEditableProjectDocument } from '../src/project/ProjectDocument.js';
import { DEFAULT_PARAMS } from '../src/engine/presets.js';

const output = resolve(process.env.TERRAIN_DESKTOP_QA_OUTPUT || 'output/desktop-qa');
const executablePath = resolve(process.env.TERRAIN_DESKTOP_EXECUTABLE || 'out/Procedural Terrains-win32-x64/ProceduralTerrains.exe');
await mkdir(output, { recursive: true });
const profile = resolve(output, `profile-${Date.now()}`);
const fixture = createEditableProjectDocument({ metadata: { name: 'Desktop release check' }, terrain: { params: { ...DEFAULT_PARAMS, seed: 12345, cloudsEnabled: false }, worldMode: 'studio' } });
const input = resolve(output, 'startup.ptrterrain');
const savedPath = resolve(output, 'roundtrip.ptrterrain');
await writeFile(input, await encodePortableProject(fixture));
const app = await electron.launch({ executablePath, args: ['--no-file-associations', `--user-data-dir=${profile}`, input], timeout: 30000 });
let page;
const errors = [];
try {
  page = await app.firstWindow();
  page.on('pageerror', (error) => errors.push(error.message));
  await page.locator('#topbar').waitFor({ timeout: 120000 });
  await page.waitForFunction(() => document.querySelector('footer')?.textContent.includes('Ready'), null, { timeout: 120000 });
  assert((await page.title()).includes('Desktop release check'));
  assert.equal(await app.evaluate(({ app }) => app.getPath('userData')), profile);
  await page.screenshot({ path: resolve(output, 'startup.png') });
  // Exercise native dialogs through the actual menu, with deterministic paths.
  await app.evaluate(({ dialog }, path) => { dialog.showSaveDialog = async () => ({ canceled: false, filePath: path }); }, savedPath);
  await page.keyboard.press('Control+Shift+s');
  await page.waitForFunction((path) => document.title.includes('Desktop release check') && window.proceduralTerrainsDesktop, savedPath);
  // File creation is asynchronous, so wait for the actual filesystem result.
  let document;
  for (let attempt = 0; attempt < 100; attempt++) {
    try { document = await decodePortableProject(await readFile(savedPath)); break; }
    catch (error) { if (attempt === 99) throw error; await new Promise((resolve) => setTimeout(resolve, 100)); }
  }
  assert.equal(document.terrain.params.seed, 12345);
  await app.evaluate(({ dialog }, path) => { dialog.showOpenDialog = async () => ({ canceled: false, filePaths: [path] }); }, savedPath);
  const reopened = await page.evaluate(() => window.proceduralTerrainsDesktop.openDocument());
  assert.equal(reopened.path, savedPath);
  assert.deepEqual(errors, []);
  const result = { startupDocument: true, saveAs: true, reopen: true, seed: document.terrain.params.seed, errors };
  await writeFile(resolve(output, 'result.json'), JSON.stringify(result, null, 2));
  console.log(JSON.stringify(result));
} catch (error) {
  if (page) {
    await page.screenshot({ path: resolve(output, 'failure.png') }).catch(() => {});
    await writeFile(resolve(output, 'failure.json'), JSON.stringify({ message: error.message, errors, aria: await page.locator('body').ariaSnapshot().catch(() => '') }, null, 2));
  }
  throw error;
} finally {
  await app.close();
}

