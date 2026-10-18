export class RevisionScope {
  constructor() {
    this.revision = 0;
    this.disposed = false;
    this.pending = new Set();
  }
  cancel(code = 'TERRAIN_SUPERSEDED') {
    for (const reject of this.pending) reject(Object.assign(new Error(code), { code }));
    this.pending.clear();
  }
  run(task, { signal } = {}) {
    if (this.disposed)
      return Promise.reject(Object.assign(new Error('Disposed'), { code: 'TERRAIN_DISPOSED' }));
    signal?.throwIfAborted();
    this.cancel();
    const revision = ++this.revision;
    const check = () => {
      signal?.throwIfAborted();
      if (this.disposed || revision !== this.revision)
        throw Object.assign(new Error('Operation retired'), {
          code: this.disposed ? 'TERRAIN_DISPOSED' : 'TERRAIN_SUPERSEDED',
        });
    };
    let reject;
    const cancelled = new Promise((_, r) => {
      reject = r;
    });
    this.pending.add(reject);
    const abort = () =>
      reject(Object.assign(new Error('Operation cancelled'), { code: 'TERRAIN_CANCELLED' }));
    signal?.addEventListener('abort', abort, { once: true });
    return Promise.race([
      Promise.resolve().then(() => {
        check();
        return task(check);
      }),
      cancelled,
    ]).finally(() => {
      this.pending.delete(reject);
      signal?.removeEventListener('abort', abort);
    });
  }
  dispose() {
    this.disposed = true;
    ++this.revision;
    this.cancel('TERRAIN_DISPOSED');
  }
}
