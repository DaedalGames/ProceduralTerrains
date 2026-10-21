import { materializePreparedSurface } from '../../engine/terrain/surface/SurfacePreparationWire.js';
/** Explicit, serializable pack requests; one worker per cancellable job. */
export class TerrainSurfaceWorker {
  constructor({ workerFactory } = {}) {
    this.workerFactory = workerFactory;
    this.jobs = new Set();
    this.disposed = false;
  }
  prepare(options, { signal } = {}) {
    if (this.disposed) return Promise.reject(new Error('TerrainSurfaceWorker disposed'));
    signal?.throwIfAborted();
    const worker =
      this.workerFactory?.() ??
      new Worker(new URL('./SurfacePreparation.worker.js', import.meta.url), { type: 'module' });
    return new Promise((resolve, reject) => {
      let settled = false;
      const finish = (error, result) => {
        if (settled) return;
        settled = true;
        signal?.removeEventListener('abort', abort);
        this.jobs.delete(abort);
        worker.terminate();
        error ? reject(error) : resolve(result);
      };
      const abort = () => finish(signal?.reason ?? new Error('Surface preparation cancelled'));
      this.jobs.add(abort);
      signal?.addEventListener('abort', abort, { once: true });
      worker.onerror = (e) => finish(new Error(e.message || 'Surface worker failed'));
      worker.onmessageerror = () =>
        finish(new Error('Surface worker message could not be decoded'));
      worker.onmessage = ({ data }) => {
        if (settled) return;
        if (data.error) {
          finish(Object.assign(new Error(data.error.message), { code: data.error.code }));
          return;
        }
        try {
          const surface = materializePreparedSurface(data.result);
          let disposed = false;
          surface.dispose = () => {
            if (disposed) return;
            disposed = true;
            surface.diffuse.dispose();
            surface.props.dispose();
          };
          finish(null, surface);
        } catch (error) {
          finish(error);
        }
      };
      try {
        worker.postMessage({ options });
      } catch (error) {
        finish(error);
      }
    });
  }
  dispose() {
    if (this.disposed) return;
    this.disposed = true;
    for (const cancel of [...this.jobs]) cancel();
  }
}
