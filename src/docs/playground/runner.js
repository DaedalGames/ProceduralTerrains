const MAX_CODE_BYTES = 100_000;
let runtimePromise;

export function loadPlaygroundRuntime() {
  runtimePromise ??= fetch(new URL(import.meta.env.BASE_URL + 'playground-runtime.json', location.href))
    .then((response) => {
      if (!response.ok) throw new Error('Could not load the playground runtime (' + response.status + ').');
      return response.json();
    }).catch((error) => { runtimePromise = null; throw error; });
  return runtimePromise;
}

// Serialized into the iframe: must not capture parent bindings.
// Every run owns its Blob modules, event listeners and WebGL state.
function iframeBootstrap(token, code, bundledRuntime) {
  let userURL = '';
  let started = false;
  const urls = new Map();
  const send = (type, args = [], line = null) => {
    if (parent !== window) parent.postMessage({ __playground: token, type, args, line }, '*');
  };
  const describe = (value) => {
    if (typeof value === 'string') return value.slice(0, 2000);
    if (value instanceof Error) return value.message;
    try {
      const seen = new WeakSet();
      return (JSON.stringify(value, (_, item) => {
        if (item && typeof item === 'object') {
          if (item.isObject3D || item.isMaterial || item.isBufferGeometry) return '[' + item.type + ']';
          if (seen.has(item)) return '[circular]';
          seen.add(item);
        }
        return typeof item === 'function' ? '[function]' : item;
      }) ?? String(value)).slice(0, 2000);
    } catch { return String(value).slice(0, 2000); }
  };
  for (const level of ['log', 'info', 'warn', 'error']) {
    const original = console[level].bind(console);
    console[level] = (...args) => { send(level, args.slice(0, 8).map(describe)); original(...args); };
  }
  const report = (error, fallbackLine) => {
    let line = fallbackLine ?? null;
    if (!line && userURL && error?.stack) {
      const escaped = userURL.replace(/[.*+?^{}$()|[\]\\]/g, '\\$&');
      const match = new RegExp(escaped + ':(\\d+)(?::\\d+)?').exec(error.stack);
      if (match) line = Number(match[1]);
    }
    send('error', [error?.message || String(error)], line);
    if (parent === window) {
      const status = document.createElement('pre');
      status.style.cssText = 'position:fixed;inset:12px;pointer-events:none;color:#ffb4b4;white-space:pre-wrap';
      status.textContent = error?.message || String(error);
      document.body.appendChild(status);
    }
  };
  addEventListener('error', (event) => report(event.error ?? event.message, event.filename === userURL ? event.lineno : null));
  addEventListener('unhandledrejection', (event) => report(event.reason));
  addEventListener('pagehide', () => { for (const url of urls.values()) URL.revokeObjectURL(url); }, { once: true });

  async function start(runtime) {
    if (started) return;
    started = true;
    try {
      for (const [id, source] of Object.entries(runtime.modules))
        urls.set(id, URL.createObjectURL(new Blob([source], { type: 'text/javascript' })));
      const imports = Object.fromEntries(urls);
      for (const [name, id] of Object.entries(runtime.imports)) {
        if (!urls.has(id)) throw new Error('Missing runtime module: ' + name);
        imports[name] = urls.get(id);
      }
      const map = document.createElement('script');
      map.type = 'importmap';
      map.textContent = JSON.stringify({ imports });
      document.head.appendChild(map);
      const NativeWorker = window.Worker;
      if (NativeWorker) window.Worker = class extends NativeWorker {
        constructor(url, options) { super(urls.get(String(url)) ?? url, options); }
      };
      window.__playgroundReady = () => send('ready');
      userURL = URL.createObjectURL(new Blob([code + '\n;globalThis.__playgroundReady();\n'], { type: 'text/javascript' }));
      urls.set('user-code', userURL);
      const script = document.createElement('script');
      script.type = 'module';
      script.src = userURL;
      await new Promise((resolve, reject) => {
        script.onload = resolve;
        script.onerror = () => reject(new Error('Could not load the code module. Check its imports and syntax.'));
        document.head.appendChild(script);
      });
    } catch (error) { report(error); }
  }
  addEventListener('message', (event) => {
    if (event.source === parent && event.data?.__playground === token && event.data.type === 'runtime')
      void start(event.data.runtime);
  });
  if (bundledRuntime) void start(bundledRuntime);
  else send('boot');
}

const safeJSON = (value) => JSON.stringify(value).replace(/</g, '\\u003c');
export function buildDocument(code, token, runtime = null) {
  return '<!doctype html><html lang="en"><head><meta charset="utf-8">' +
    '<meta name="viewport" content="width=device-width,initial-scale=1">' +
    '<title>Procedural Terrains playground</title>' +
    '<style>html,body{margin:0;height:100%;overflow:hidden;background:#101827;color:#dce4f0;font:13px system-ui}#app{position:fixed;inset:0}canvas{display:block}</style>' +
    '</head><body><div id="app"></div><script>(' + iframeBootstrap.toString() + ')(' +
    safeJSON(token) + ',' + safeJSON(code) + ',' + safeJSON(runtime) + ');</script></body></html>';
}
export const buildStandalone = (code, runtime) => buildDocument(code, 'standalone', runtime);

export function encodeCode(code) {
  const bytes = new TextEncoder().encode(code);
  if (bytes.length > MAX_CODE_BYTES) throw new Error('Code is too long to share.');
  let binary = '';
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}
export function decodeCode(text) {
  if (!text || text.length > Math.ceil(MAX_CODE_BYTES * 4 / 3)) return null;
  try {
    const binary = atob(text.replace(/-/g, '+').replace(/_/g, '/') + '='.repeat((4 - text.length % 4) % 4));
    const bytes = Uint8Array.from(binary, (char) => char.charCodeAt(0));
    return new TextDecoder('utf-8', { fatal: true }).decode(bytes);
  } catch { return null; }
}
export const playgroundHref = (code) => '#/docs/playground?code=' + encodeCode(code);
export function codeFromHash(hash = globalThis.location?.hash ?? '') {
  const query = hash.split('?')[1];
  return query ? decodeCode(new URLSearchParams(query).get('code')) : null;
}
