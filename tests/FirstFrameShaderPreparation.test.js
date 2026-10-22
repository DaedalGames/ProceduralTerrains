import { describe, expect, it, vi } from 'vitest';
import * as THREE from 'three';
import { FirstFrameShaderPreparation } from '../src/engine/render/FirstFrameShaderPreparation.js';
import { MiniLightMap } from '../src/engine/mini/MiniLightMap.js';
import { RealisticCloudSlabLayer } from '../src/engine/sky/realistic/RealisticCloudLayers.js';

const pass = () => ({ material: new THREE.ShaderMaterial(), source: new THREE.Mesh(new THREE.PlaneGeometry()),
  renderTarget: new THREE.WebGLRenderTarget(1, 1) });
const deferred = () => { let resolve; const promise = new Promise(r => { resolve = r; }); return { promise, resolve }; };

describe('first-frame shader preparation', () => {
  it('submits independent passes together and waits for every program', async () => {
    const preparation = new FirstFrameShaderPreparation(), jobs = [deferred(), deferred()];
    const compile = vi.fn((_, current) => { expect(current()).toBe(true); return jobs[compile.mock.calls.length - 1].promise; });
    const state = preparation.request([pass(), pass()], { renderer: {}, compile });
    await Promise.resolve();
    expect(compile).toHaveBeenCalledTimes(2);
    jobs[0].resolve({ ready: true });
    await Promise.resolve();
    expect(state.pending).toBe(true);
    expect(state.ready).toBe(false);
    jobs[1].resolve({ ready: true });
    await state.promise;
    expect(state).toMatchObject({ pending: false, ready: true, error: null });
  });

  it('reuses prepared programs across target resizes but prepares a changed output encoding or shader', async () => {
    const preparation = new FirstFrameShaderPreparation(), renderer = {}, p = pass();
    const compile = vi.fn(async () => ({ ready: true }));
    const first = preparation.request([p], { renderer, compile });
    await first.promise;
    p.renderTarget.setSize(200, 100);
    expect(preparation.request([p], { renderer, compile })).toBe(first);
    p.renderTarget.texture.colorSpace = THREE.SRGBColorSpace;
    const next = preparation.request([p], { renderer, compile });
    expect(next).not.toBe(first);
    await next.promise;
    p.material.needsUpdate = true;
    const changed = preparation.request([p], { renderer, compile });
    expect(changed).not.toBe(next);
    await changed.promise;
    expect(compile).toHaveBeenCalledTimes(3);
  });

  it('does not publish a superseded job or cancel its replacement', async () => {
    const preparation = new FirstFrameShaderPreparation(), renderer = {}, p = pass(), jobs = [deferred(), deferred()];
    const currents = [];
    const compile = vi.fn((_, current) => { currents.push(current); return jobs[compile.mock.calls.length - 1].promise; });
    const first = preparation.request([p], { renderer, compile });
    await Promise.resolve();
    p.material.needsUpdate = true;
    const replacement = preparation.request([p], { renderer, compile });
    await Promise.resolve();
    expect(currents[0]()).toBe(false);
    jobs[0].resolve({ ready: true });
    await first.promise;
    expect(first).toMatchObject({ ready: false, aborted: true });
    expect(replacement.pending).toBe(true);
    jobs[1].resolve({ ready: true });
    await replacement.promise;
    expect(replacement.ready).toBe(true);
  });

  it('retires an in-flight pass if its render target is replaced during resize', async () => {
    const preparation = new FirstFrameShaderPreparation(), renderer = {}, p = pass(), job = deferred();
    const compile = vi.fn(() => job.promise);
    const first = preparation.request([p], { renderer, compile });
    p.renderTarget = new THREE.WebGLRenderTarget(2, 2);
    const replacement = preparation.request([p], { renderer, compile });
    expect(replacement).not.toBe(first);
    job.resolve({ ready: true });
    await Promise.all([first.promise, replacement.promise]);
    expect(first.aborted).toBe(true);
    expect(replacement.ready).toBe(true);
  });

  it('cancels queued work when the presentation is removed', async () => {
    const preparation = new FirstFrameShaderPreparation(), job = deferred();
    let current;
    const state = preparation.request([pass()], { renderer: {}, compile: (_, isCurrent) => { current = isCurrent; return job.promise; } });
    await Promise.resolve();
    preparation.cancel();
    expect(current()).toBe(false);
    job.resolve({ ready: true });
    await state.promise;
    expect(state).toMatchObject({ ready: false, aborted: true, pending: false });
  });

  it('retains shader failures instead of showing an unprepared first frame', async () => {
    const preparation = new FirstFrameShaderPreparation(), error = new Error('link failed');
    const state = preparation.request([pass()], { renderer: {}, compile: () => { throw error; } });
    await state.promise;
    expect(state).toMatchObject({ ready: false, pending: false, error });
  });

  it('prepares Mini lighting with its own camera and target formats without publishing a bake', () => {
    const map = new MiniLightMap({ uHeightScale: { value: 100 } });
    try {
      const [bake, readback] = map.preparationPasses();
      expect(bake).toMatchObject({ material: map.bakeMaterial, camera: map.bakeCamera, targetScene: map.bakeScene });
      expect(bake.renderTarget.texture.type).toBe(THREE.HalfFloatType);
      expect(readback.renderTarget.texture.type).toBe(THREE.FloatType);
      expect(map.texture).toBeNull();
      expect(map.field).toBeNull();
      expect(map.preparationPasses()[1].renderTarget).toBe(readback.renderTarget);
    } finally { map.dispose(); }
  });

  it('describes the realistic cloud bakes before drawing and releases the retained noise program', () => {
    const renderer = { render: vi.fn() }, layer = new RealisticCloudSlabLayer(new THREE.Scene(), { renderer });
    const passes = layer.preparationPasses();
    const noise = passes.find(p => p.renderTarget?.isWebGL3DRenderTarget);
    const disposed = vi.spyOn(noise.material, 'dispose');
    expect(passes.some(p => p.material === layer._weather.material)).toBe(true);
    expect(passes.some(p => p.material === layer._shadowPass.material)).toBe(true);
    expect(layer._weather.keys.dirty).toBe(true);
    expect(renderer.render).not.toHaveBeenCalled();
    layer.dispose();
    expect(disposed).toHaveBeenCalledOnce();
  });
});
