import { buildSurfaceResources } from '../../engine/terrain/surface/SurfaceResources.js';

export class TerrainSurfaceProvider {
  constructor({
    baseUrl,
    legacyBaseUrl,
    loadUserAsset,
    fetch: fetcher = globalThis.fetch?.bind(globalThis),
  } = {}) {
    if (!baseUrl) throw new Error('An explicit material pack baseUrl is required');
    this.baseUrl = baseUrl.endsWith('/') ? baseUrl : `${baseUrl}/`;
    this.legacyBaseUrl = legacyBaseUrl;
    this.loadUserAsset = loadUserAsset;
    this.fetch = fetcher;
    this.cache = new Map();
    this._catalog = null;
  }
  resolveUrl(path) {
    return new URL(path, this.baseUrl).href;
  }
  async loadCatalog({ signal } = {}) {
    if (this._catalog) return this._catalog;
    const r = await this.fetch(this.resolveUrl('catalog.json'), { signal });
    if (!r.ok) throw new Error(`Surface catalog HTTP ${r.status}`);
    this._catalog = await r.json();
    return this._catalog;
  }
  dispose() {
    this.cache.clear();
    this._catalog = null;
  }
}

export async function createSurfaceResources(options) {
  if (!options?.provider) throw new Error('An explicit surface provider is required');
  if (JSON.stringify(options.document ?? {}).includes('legacy:') && !options.provider.legacyBaseUrl)
    throw new Error('Explicit legacyBaseUrl required for legacy maps');
  const surface = await buildSurfaceResources(options);
  let disposed = false;
  surface.dispose = () => {
    if (disposed) return;
    disposed = true;
    surface.diffuse.dispose();
    surface.props.dispose();
  };
  return surface;
}
