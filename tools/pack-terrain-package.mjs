import { mkdir } from 'node:fs/promises';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('../', import.meta.url));
const destination = fileURLToPath(new URL('../dist/npm/', import.meta.url));
await mkdir(destination, { recursive: true });
if (!process.env.npm_execpath) throw new Error('Run this script through npm run pack:lib.');
// Invoke npm through Node on Windows too; no shell or prepack recursion.
const result = spawnSync(process.execPath, [
  process.env.npm_execpath, 'pack', '--workspace=procedural-terrains',
  '--ignore-scripts', '--pack-destination', destination, '--json',
], { cwd: root, encoding: 'utf8' });
if (result.error) throw result.error;
if (result.status !== 0) throw new Error(result.stderr || 'Could not pack procedural-terrains');
const [archive] = JSON.parse(result.stdout);
if (!archive?.files.some((file) => file.path === 'dist/index.js'))
  throw new Error('Build the library with npm run build:lib before packing it.');
console.log('npm package: dist/npm/' + archive.filename + ' (' + archive.size + ' bytes)');
