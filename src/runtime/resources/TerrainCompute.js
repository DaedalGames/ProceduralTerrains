import { erode } from '../../engine/terrain/erosion/erosionSim.js';

/** One compute service per consumer. Aborting a job cannot cancel another owner. */
export class TerrainCompute {
  constructor({ workerFactory } = {}) {
    this.workerFactory = workerFactory;
    this.jobs = new Set();
    this.disposed = false;
  }
  erode(input, { signal, onProgress } = {}) {
    if (this.disposed) return Promise.reject(new Error('TerrainCompute disposed'));
    signal?.throwIfAborted();
    if (!this.workerFactory && typeof Worker === 'undefined') {
      return Promise.resolve().then(() => {
        signal?.throwIfAborted();
        if (this.disposed) throw new Error('TerrainCompute disposed');
        const out = erode({ ...input, heightmap: input.heightmap.slice(), onProgress });
        const delta = out.eroded.map((v, i) => v - input.heightmap[i]);
        const { eroded, ...fields } = out;
        return { type: 'result', id: 1, delta, ...fields };
      });
    }
    const worker =
      this.workerFactory?.('erosion') ||
      new Worker(new URL('../../engine/terrain/erosion/erosion.worker.js', import.meta.url), {
        type: 'module',
      });
    return new Promise((resolve, reject) => {
      let settled = false;
      const finish = (reason, value) => {
        if (settled) return;
        settled = true;
        signal?.removeEventListener('abort', abort);
        worker.terminate();
        this.jobs.delete(abort);
        reason ? reject(reason) : resolve(value);
      };
      const abort = () => finish(signal?.reason || new Error('Terrain compute cancelled'));
      this.jobs.add(abort);
      signal?.addEventListener('abort', abort, { once: true });
      worker.onmessage = ({ data }) => {
        if (data.type === 'progress') {
          try {
            onProgress?.(data.progress, data.phase);
          } catch (error) {
            finish(error);
          }
        } else if (data.type === 'error') finish(new Error(data.message));
        else if (data.type === 'result') finish(null, data);
      };
      worker.onerror = (e) => finish(new Error(e.message || 'Terrain compute worker failed'));
      worker.onmessageerror = () =>
        finish(new Error('Terrain compute message could not be decoded'));
      const heightmap = input.heightmap.slice();
      try {
        worker.postMessage({ ...input, heightmap, type: 'erode', id: 1 }, [heightmap.buffer]);
      } catch (error) {
        finish(error);
      }
    });
  }
  dispose() {
    if (this.disposed) return;
    this.disposed = true;
    for (const abort of [...this.jobs]) abort();
  }
}
