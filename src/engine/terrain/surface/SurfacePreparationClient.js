import { materializePreparedSurface } from './SurfacePreparationWire.js';

/** Worker ownership follows the engine, so one studio cannot cancel another. */
export class SurfacePreparationClient {
  constructor({ workerFactory } = {}) {
    this.workerFactory = workerFactory;
    this.worker = null;
    this.nextId = 1;
    this.pending = new Map();
  }
  cancel() {
    for (const job of this.pending.values()) {
      job.signal?.removeEventListener('abort', job.abort);
      job.reject(
        Object.assign(new Error('Surface build superseded'), { code: 'SURFACE_ATLAS_SUPERSEDED' }),
      );
    }
    this.pending.clear();
    this.worker?.terminate();
    this.worker = null;
  }
  _worker() {
    if (this.worker) return this.worker;
    const worker =
      this.workerFactory?.() ??
      new Worker(new URL('./SurfacePreparationWorker.js', import.meta.url), { type: 'module' });
    this.worker = worker;
    worker.onmessage = ({ data }) => {
      const job = this.pending.get(data.id);
      if (!job) {
        data.result?.textures?.color?.close?.();
        data.result?.textures?.properties?.close?.();
        return;
      }
      this.pending.delete(data.id);
      job.signal?.removeEventListener('abort', job.abort);
      if (data.error)
        job.reject(
          Object.assign(new Error(data.error.message), {
            name: data.error.name,
            stack: data.error.stack,
          }),
        );
      else job.resolve(data.result);
    };
    worker.onerror = (event) => {
      for (const job of this.pending.values()) {
        job.signal?.removeEventListener('abort', job.abort);
        job.reject(new Error(event.message || 'Surface preparation worker failed'));
      }
      this.pending.clear();
      worker.terminate();
      this.worker = null;
    };
    return worker;
  }
  async prepare(options, { signal } = {}) {
    signal?.throwIfAborted();
    const id = this.nextId++;
    const prepared = await new Promise((resolve, reject) => {
      const abort = () => {
        this.pending.delete(id);
        reject(signal?.reason ?? new DOMException('Aborted', 'AbortError'));
      };
      this.pending.set(id, { resolve, reject, signal, abort });
      signal?.addEventListener('abort', abort, { once: true });
      try {
        this._worker().postMessage({ id, options });
      } catch (error) {
        this.pending.delete(id);
        signal?.removeEventListener('abort', abort);
        reject(error);
      }
    });
    if (signal?.aborted) {
      prepared.textures?.color?.close?.();
      prepared.textures?.properties?.close?.();
      signal.throwIfAborted();
    }
    return materializePreparedSurface(prepared);
  }
  dispose() {
    this.cancel();
  }
}
const owners = new WeakMap(),
  legacy = new SurfacePreparationClient();
function client(owner) {
  if (!owner) return legacy;
  let value = owners.get(owner);
  if (!value) {
    value = new SurfacePreparationClient();
    owners.set(owner, value);
  }
  return value;
}
export function cancelSurfacePreparations(owner) {
  client(owner).cancel();
}
export function prepareSurfaceInBackground(options, { owner, signal } = {}) {
  return client(owner).prepare(options, { signal });
}
