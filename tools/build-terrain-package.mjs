import { readFile, writeFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { build } from 'vite';

const root = fileURLToPath(new URL('../', import.meta.url));
await build({ root, configFile: fileURLToPath(new URL('../vite.lib.config.js', import.meta.url)) });
const license = await readFile(new URL('../LICENSE', import.meta.url), 'utf8');
await writeFile(new URL('../packages/procedural-terrains/LICENSE', import.meta.url), license.replace(/[\t ]+$/gm, ''));
