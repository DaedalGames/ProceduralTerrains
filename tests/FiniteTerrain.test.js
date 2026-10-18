import { describe, it, expect, vi } from 'vitest';
import * as THREE from 'three';
import { createTerrain } from '../packages/procedural-terrains/index.js';
import { validatePrograms } from '../src/engine/render/ProgramHealthGate.js';

vi.mock('../src/engine/render/ProgramHealthGate.js', () => ({
  validatePrograms: vi.fn(async () => ({ ok: true })),
  programHealthError: result => Object.assign(new Error('Shader failed'), { code: result.code }),
}));

function renderer() {
  return {
    isWebGLRenderer: true,
    compileAsync: vi.fn(async () => {}),
    getCurrentViewport: v => v.set(0, 0, 640, 480),
    dispose: vi.fn(), setSize: vi.fn(), setAnimationLoop: vi.fn(), render: vi.fn(),
  };
}
const camera = () => {
  const c = new THREE.PerspectiveCamera(50, 1, 1, 10000);
  c.position.set(500, 600, 700); c.lookAt(0, 0, 0); return c;
};
const configuration = { layout: { chunkCount: 2, chunkSize: 64 }, quality: { lodSegments: [16, 8, 4, 2] } };
const deferred = () => { let resolve; const promise = new Promise(r => { resolve = r; }); return { promise, resolve }; };

describe('finite terrain public runtime', () => {
  it('uses the caller loop/renderer and preserves geometry on continuous edits', async () => {
    const r = renderer();
    const t = await createTerrain({ renderer: r, configuration });
    const b = t._runtime.board;
    const geometry = b.geometries[0];
    const sample = t.sampleHeight(10, 20);
    await t.prepare(camera());
    t.update(0.016, { camera: camera() });
    await t.configure({ heightScale: 700, palette: { grass: [0.3, 0.2, 0.1] } });
    expect(t.sampleHeight(10, 20)).not.toBe(sample);
    expect(b.geometries[0]).toBe(geometry);
    expect(t._uniforms.uColGrass.value.toArray()).toEqual([0.3, 0.2, 0.1]);
    expect(t.sampleHeight(100000, 0)).toBeNull();
    expect(r.render).not.toHaveBeenCalled();
    expect(r.setSize).not.toHaveBeenCalled();
    expect(r.setAnimationLoop).not.toHaveBeenCalled();
    t.dispose();
    expect(r.dispose).not.toHaveBeenCalled();
  });

  it('isolates configuration, uniforms, textures, geometry and destruction across instances', async () => {
    const r = renderer(); const scene = new THREE.Scene();
    const a = await createTerrain({ renderer: r, configuration });
    const b = await createTerrain({ renderer: r, configuration });
    scene.add(a.object, b.object);
    const height = b.sampleHeight(11, 22);
    expect(a._uniforms.uSurfDiffuse.value).not.toBe(b._uniforms.uSurfDiffuse.value);
    const disposed = vi.fn(); a._fallback.addEventListener('dispose', disposed);
    const otherDisposed = vi.fn(); b._fallback.addEventListener('dispose', otherDisposed);
    await a.configure({ source: { seed: 42 } });
    expect(b.sampleHeight(11, 22)).toBe(height);
    a.dispose(); a.dispose();
    expect(disposed).toHaveBeenCalledTimes(1);
    expect(otherDisposed).not.toHaveBeenCalled();
    expect(scene.children).toEqual([b.object]);
    b.update(0.01, { camera: camera() });
    expect(b.sampleHeight(11, 22)).toBe(height);
    expect(() => a.sampleHeight(0, 0)).toThrow('disposed');
    b.dispose();
  });

  it('rejects unsupported and invalid input without changing the current terrain', async () => {
    const t = await createTerrain({ renderer: renderer(), configuration });
    const original = t.configuration;
    await expect(t.configure({ source: { kind: 'graph' } })).rejects.toThrow('source.kind');
    await expect(t.configure({ layout: { chunkCount: NaN } })).rejects.toThrow('chunkCount');
    await expect(t.configure({ quality: { lodSegments: [32, 10, 4, 2] } })).rejects.toThrow('halve');
    await expect(t.configure({ water: true })).rejects.toThrow('Unsupported');
    expect(t.configuration).toBe(original);
    expect(() => { t.configuration.source.seed = 999; }).toThrow();
    const doc = t.serialize(); doc.configuration.source.seed = 999;
    expect(t.configuration.source.seed).not.toBe(999);
    const restored = await createTerrain({ renderer: renderer(), configuration: t.serialize().configuration });
    expect(restored.sampleHeight(7, 9)).toBe(t.sampleHeight(7, 9));
    t.object.position.x = 10;
    expect(() => t.update(0.01, { camera: camera() })).toThrow('identity');
    t.dispose(); restored.dispose();
  });

  it('publishes only the latest shader candidate and retires the superseded material', async () => {
    const r = renderer(); const pending = [];
    r.compileAsync.mockImplementation(scene => {
      const d = deferred(); pending.push({ ...d, material: scene.children[0].material }); return d.promise;
    });
    const t = await createTerrain({ renderer: r, configuration });
    const first = t.configure({ source: { octaves: 5 } });
    const firstResult = expect(first).rejects.toMatchObject({ code: 'TERRAIN_SUPERSEDED' });
    await vi.waitFor(() => expect(pending).toHaveLength(1));
    const retired = vi.fn(); pending[0].material.addEventListener('dispose', retired);
    const second = t.configure({ source: { octaves: 6 }, heightScale: 800 });
    await vi.waitFor(() => expect(pending).toHaveLength(2));
    expect(t.configuration.source.octaves).toBe(7);
    pending[1].resolve(); await second;
    expect(t.configuration.source.octaves).toBe(6);
    expect(t._runtime.board.material).toBe(pending[1].material);
    pending[0].resolve(); await firstResult;
    await vi.waitFor(() => expect(retired).toHaveBeenCalledTimes(1));
    expect(t.configuration.heightScale).toBe(800);
    expect(t.configuration.source.octaves).toBe(6);
    t.dispose();
  });

  it('cancels promptly, keeps the previous revision, and frees the late candidate', async () => {
    const r = renderer(); const d = deferred(); let candidate;
    r.compileAsync.mockImplementation(scene => { candidate = scene.children[0].material; return d.promise; });
    const t = await createTerrain({ renderer: r, configuration });
    const controller = new AbortController();
    const operation = t.configure({ source: { octaves: 4 } }, { signal: controller.signal });
    const rejected = expect(operation).rejects.toMatchObject({ code: 'TERRAIN_CANCELLED' });
    await vi.waitFor(() => expect(candidate).toBeTruthy());
    const retired = vi.fn(); candidate.addEventListener('dispose', retired);
    controller.abort(); await rejected;
    expect(t.configuration.source.octaves).toBe(7);
    d.resolve(); await vi.waitFor(() => expect(retired).toHaveBeenCalledTimes(1));
    expect(t.configuration.source.octaves).toBe(7);
    t.dispose();
  });

  it('rejects preparation on shader failure and preserves the last valid configuration', async () => {
    const t = await createTerrain({ renderer: renderer(), configuration });
    validatePrograms.mockResolvedValueOnce({ ok: false, code: 'PROGRAM_LINK_FAILED' });
    await expect(t.configure({ source: { octaves: 4 } })).rejects.toMatchObject({ code: 'PROGRAM_LINK_FAILED' });
    expect(t.configuration.source.octaves).toBe(7);
    t.dispose();
  });

  it('rejects in-flight operations on dispose and prevents late publication', async () => {
    const r = renderer(); const d = deferred(); r.compileAsync.mockReturnValue(d.promise);
    const t = await createTerrain({ renderer: r, configuration });
    const result = expect(t.configure({ source: { octaves: 3 } })).rejects.toMatchObject({ code: 'TERRAIN_DISPOSED' });
    await vi.waitFor(() => expect(r.compileAsync).toHaveBeenCalled());
    t.dispose(); await result; d.resolve();
    await Promise.resolve();
    expect(t.getDiagnostics()).toMatchObject({ disposed: true, chunks: 0 });
    expect(r.dispose).not.toHaveBeenCalled();
  });

  it('rebuilds a changed layout, releases its previous geometry and rejects ancestor transforms', async () => {
    const t = await createTerrain({ renderer: renderer(), configuration });
    const previous = t._runtime.board.geometries[0];
    const disposed = vi.fn(); previous.addEventListener('dispose', disposed);
    await t.configure({ layout: { chunkCount: 4 } });
    expect(t.getDiagnostics().chunks).toBe(16);
    expect(disposed).toHaveBeenCalledTimes(1);
    const parent = new THREE.Group(); parent.add(t.object); parent.scale.setScalar(2);
    await expect(t.prepare(camera())).rejects.toMatchObject({ code: 'TERRAIN_TRANSFORM_UNSUPPORTED' });
    t.dispose();
  });

  it('uses a parented camera world pose without changing the caller camera or rebuilding its view each frame', async () => {
    const t = await createTerrain({ renderer: renderer(), configuration });
    const parent = new THREE.Group(); parent.position.set(100, 50, 0);
    const c = camera(); parent.add(c);
    const local = c.position.clone();
    t.update(0.01, { camera: c });
    const view = t._worldCamera;
    expect(view.position.x).toBe(local.x + 100);
    expect(view.position.y).toBe(local.y + 50);
    expect(c.position.equals(local)).toBe(true);
    parent.position.x += 10;
    t.update(0.01, { camera: c });
    expect(t._worldCamera).toBe(view);
    expect(view.position.x).toBe(local.x + 110);
    t.dispose();
  });
});
