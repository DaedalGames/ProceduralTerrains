import { cp, mkdir, readFile, writeFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';

// Reuse the verified build; GitHub Packages requires a scoped package name.
const source = new URL('../packages/procedural-terrains/', import.meta.url);
const target = new URL('../dist/github-package/', import.meta.url);
await mkdir(target, { recursive: true });
const manifest = JSON.parse(await readFile(new URL('package.json', source), 'utf8'));
manifest.name = '@zyfou/procedural-terrains';
manifest.publishConfig = { access: 'public', registry: 'https://npm.pkg.github.com/' };
delete manifest.scripts; // The archive is built and tested before it is staged.
await writeFile(new URL('package.json', target), JSON.stringify(manifest, null, 2) + '\n');
for (const file of manifest.files) {
  await cp(new URL(file, source), new URL(file, target), { recursive: true });
}
console.log(fileURLToPath(target));
