import assert from 'node:assert/strict';
import { mkdtemp, readFile, writeFile, rm } from 'node:fs/promises';
import { execFileSync } from 'node:child_process';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('../', import.meta.url));
const directory = await mkdtemp(join(tmpdir(), 'terrain-package-'));
const npm = process.platform === 'win32' ? 'npm.cmd' : 'npm';
const run = (command, args, cwd = root) => execFileSync(command, args, { cwd, encoding: 'utf8', stdio: ['ignore', 'pipe', 'inherit'] });
try {
  process.stdout.write(run(process.execPath, ['tools/build-terrain-package.mjs']));
  const result = JSON.parse(run(npm, ['pack', '--ignore-scripts', '--workspace=procedural-terrains', '--pack-destination', directory, '--json']));
  const [pack] = result;
  assert(pack.files.some(f => f.path === 'dist/index.js'));
  assert(pack.files.some(f => f.path === 'types/index.d.ts'));
  assert(pack.files.some(f => f.path === 'LICENSE'));
  assert(pack.files.every(f => /^(dist\/|types\/|README.md$|LICENSE$|package.json$)/.test(f.path)));
  await writeFile(join(directory, 'package.json'), JSON.stringify({ private: true, type: 'module' }));
  run(npm, ['install', '--ignore-scripts', '--no-audit', '--no-fund', '--package-lock=false', join(directory, pack.filename), 'three@0.185.1'], directory);
  const manifest = JSON.parse(await readFile(join(directory, 'node_modules/procedural-terrains/package.json'), 'utf8'));
  for(const entry of Object.values(manifest.exports)){if(entry.types)assert(pack.files.some(f=>f.path===entry.types.slice(2)));}
  assert.deepEqual(manifest.peerDependencies, { three: '~0.185.1' });
  assert.deepEqual(manifest.dependencies, {fflate:'^0.8.3'});
  await writeFile(join(directory, 'consumer.mjs'), `
    import assert from 'node:assert/strict';
    import * as THREE from 'three';
    import { createTerrain } from 'procedural-terrains';
    const manifest=JSON.parse(await (await import('node:fs/promises')).readFile(new URL('./node_modules/procedural-terrains/package.json',import.meta.url),'utf8'));
    for(const key of Object.keys(manifest.exports)){if(key!=='.' && key!=='./package.json')await import('procedural-terrains/'+key.slice(2));}
    assert.equal(typeof globalThis.document, 'undefined');
    const terrain = await createTerrain({ renderer: { isWebGLRenderer: true }, configuration: { layout: { chunkCount: 2 } } });
    assert(terrain.object instanceof THREE.Group, 'Consumer and package must share one Three.js instance');
    const initial = terrain.sampleHeight(10, 20);
    assert(Number.isFinite(initial));
    await terrain.configure({ heightScale: 700 });
    assert.notEqual(terrain.sampleHeight(10, 20), initial);
    terrain.dispose();
    assert.equal(terrain.getDiagnostics().chunks, 0);
    console.log('Installed tarball: ESM import without DOM, shared Three.js, configuration, sampling and disposal passed');
  `);
  process.stdout.write(run(process.execPath, [join(directory, 'consumer.mjs')], directory));
  console.log(`Package verified: ${pack.filename} (${pack.size} bytes, ${pack.files.length} files)`);
} finally {
  await rm(directory, { recursive: true, force: true });
}
