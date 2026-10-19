import { stat } from 'node:fs/promises';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createPlaygroundRuntime } from '../tools/playground-runtime.mjs';

const root = fileURLToPath(new URL('../', import.meta.url));
const run = promisify(execFile);

// Parent page fetches these public module sources and hands them to its
// opaque-origin iframe. No server CORS configuration or public CDN is needed.
export default function playgroundRuntime() {
  let pending;
  const prepare = (rebuild = false) => pending ??= (async () => {
    const exists = await stat(join(root, 'packages/procedural-terrains/dist/index.js')).then(() => true, () => false);
    if (rebuild || !exists) await run(process.execPath, [join(root, 'tools/build-terrain-package.mjs')], {
      cwd: root, windowsHide: true, maxBuffer: 4 * 1024 * 1024,
    });
    return JSON.stringify(await createPlaygroundRuntime());
  })().catch((error) => { pending = null; throw error; });
  return {
    name: 'terrain-playground-runtime',
    configureServer(server) {
      server.middlewares.use(async (req, res, next) => {
        if (req.url?.split('?')[0] !== '/playground-runtime.json') return next();
        try {
          res.setHeader('Content-Type', 'application/json; charset=utf-8');
          res.setHeader('Cache-Control', 'no-cache');
          res.end(await prepare(true));
        } catch (error) {
          res.statusCode = 503; res.end('Playground runtime unavailable');
          console.error('[playground-runtime]', error);
        }
      });
    },
    async generateBundle() {
      this.emitFile({ type: 'asset', fileName: 'playground-runtime.json', source: await prepare() });
    },
  };
}
