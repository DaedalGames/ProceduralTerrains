import { readdir, readFile } from 'node:fs/promises';
import { join, posix } from 'node:path';
import { fileURLToPath } from 'node:url';
import { init, parse } from 'es-module-lexer';

const root = fileURLToPath(new URL('../', import.meta.url));
export const moduleId = (path) => 'terrain-runtime:/' + path;

export function dependencyId(specifier, importer) {
  if (specifier.startsWith('.')) return posix.normalize(posix.join(posix.dirname(importer), specifier));
  if (specifier === 'three') return 'three/three.module.js';
  if (specifier === 'fflate') return 'fflate.js';
  if (specifier.startsWith('three/addons/')) return specifier;
  if (specifier.startsWith('three/examples/jsm/')) return specifier.replace('three/examples/jsm/', 'three/addons/');
  return null;
}

/** Preserve ESM semantics, cycles and dynamic imports using a virtual import map. */
export function rewriteModule(source, id) {
  const [imports, exports] = parse(source);
  const replacements = [];
  const dependencies = [];
  for (const record of imports) {
    if (record.d === -2 && source.slice(record.e, record.e + 4) === '.url') {
      replacements.push({ start: record.s, end: record.e + 4, text: JSON.stringify(moduleId(id)) });
    } else if (record.n) {
      const target = dependencyId(record.n, id);
      if (!target) throw new Error('Unsupported playground dependency: ' + record.n + ' in ' + id);
      dependencies.push(target);
      const name = moduleId(target);
      replacements.push({ start: record.s, end: record.e, text: record.d === -1 ? name : JSON.stringify(name) });
    }
  }
  for (const change of replacements.sort((a, b) => b.start - a.start))
    source = source.slice(0, change.start) + change.text + source.slice(change.end);
  return { source: source.replace(/^\/\/# sourceMappingURL=.*$/gm, ''), dependencies, classicWorker: imports.length === 0 && exports.length === 0 };
}

async function collect(directory, prefix, files) {
  for (const entry of await readdir(directory, { withFileTypes: true })) {
    const path = join(directory, entry.name);
    const name = prefix + entry.name;
    if (entry.isDirectory()) await collect(path, name + '/', files);
    else if (entry.name.endsWith('.js')) files.set(name, await readFile(path, 'utf8'));
  }
}

export async function createPlaygroundRuntime() {
  await init;
  const manifest = JSON.parse(await readFile(join(root, 'packages/procedural-terrains/package.json'), 'utf8'));
  const files = new Map();
  await collect(join(root, 'packages/procedural-terrains/dist'), 'package/', files);
  const entries = [...files.keys()];
  for (const name of ['three.module.js', 'three.core.js'])
    files.set('three/' + name, await readFile(join(root, 'node_modules/three/build', name), 'utf8'));
  await collect(join(root, 'node_modules/three/examples/jsm'), 'three/addons/', files);
  files.set('fflate.js', await readFile(join(root, 'node_modules/fflate/esm/browser.js'), 'utf8'));
  entries.push('three/three.module.js', 'fflate.js', 'three/addons/controls/OrbitControls.js');
  const modules = {};
  const classicWorkers = [];
  const visit = (id) => {
    if (Object.hasOwn(modules, moduleId(id))) return;
    if (!files.has(id)) throw new Error('Missing playground module: ' + id);
    const result = rewriteModule(files.get(id), id);
    modules[moduleId(id)] = result.source;
    if (id.startsWith('package/assets/') && result.classicWorker) classicWorkers.push(moduleId(id));
    for (const dependency of result.dependencies) visit(dependency);
  };
  entries.forEach(visit);
  const imports = { three: moduleId('three/three.module.js'), fflate: moduleId('fflate.js') };
  for (const [name, entry] of Object.entries(manifest.exports)) {
    if (name === './package.json') continue;
    imports[name === '.' ? manifest.name : manifest.name + name.slice(1)] = moduleId('package/' + entry.import.replace('./dist/', ''));
  }
  for (const id of Object.keys(modules).filter((id) => id.startsWith(moduleId('three/addons/')))) {
    const path = id.slice('terrain-runtime:/'.length);
    imports[path] = id;
    imports[path.replace('three/addons/', 'three/examples/jsm/')] = id;
  }
  return { version: manifest.version, modules, imports, classicWorkers };
}
