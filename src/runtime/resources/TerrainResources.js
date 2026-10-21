/** Explicit asset resolution and owned resource scopes. No implicit network I/O. */
export class TerrainResources {
  constructor({
    renderer,
    resolveAsset,
    fetch: fetcher = globalThis.fetch?.bind(globalThis),
  } = {}) {
    this.renderer = renderer;
    this.resolveAsset = resolveAsset;
    this.fetch = fetcher;
    this._leases = new Map();
    this._disposed = false;
  }

  async read(id, { signal } = {}) {
    if (this._disposed) throw new Error('TerrainResources disposed');
    signal?.throwIfAborted();
    if (!this.resolveAsset) throw new Error('Provide resolveAsset to load external assets');
    const result = await this.resolveAsset(id, { signal });
    signal?.throwIfAborted();
    return result;
  }

  acquire(key, create, destroy = (value) => value.dispose()) {
    if (this._disposed) throw new Error('TerrainResources disposed');
    let entry = this._leases.get(key);
    if (!entry) {
      entry = { value: create(), refs: 0, destroy };
      this._leases.set(key, entry);
    }
    entry.refs++;
    let released = false;
    return {
      value: entry.value,
      release: () => {
        if (released) return;
        released = true;
        if (--entry.refs === 0) {
          this._leases.delete(key);
          entry.destroy(entry.value);
        }
      },
    };
  }

  dispose() {
    if (this._disposed) return;
    if (this._leases.size)
      throw new Error('Release active terrain resource leases before disposing resources');
    this._disposed = true;
  }
}
