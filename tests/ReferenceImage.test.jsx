import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it, vi } from 'vitest';
import * as THREE from 'three';
import { Engine } from '../src/engine/Engine.js';
import { ENGINE_METHODS } from '../src/engine/EngineProxy.js';
import { ReferenceImageLayer, normalizeReferenceImage, normalizeReferenceSettings } from '../src/engine/terrain/ReferenceImageLayer.js';
import { ReferenceImageSection } from '../src/components/ui/ImportMapsContent.jsx';
import { renderPanel } from '../src/components/panels/index.jsx';
import { panelAvailable } from '../src/components/panels/panelMeta.js';
import { encodePortableProject, decodePortableProject, assertCloudSurfaceSafe } from '../src/project/PortableProject.js';

const decoded = () => ({ width: 2, height: 1, originalWidth: 2, originalHeight: 1,
  imageData: { data: new Uint8ClampedArray([255, 0, 0, 255, 0, 255, 0, 128]) },
  preview: 'data:image/png;base64,aW1hZ2U=' });
const file = { name: 'my-map.png', type: 'image/png' };
function engineFixture() {
  return Object.assign(Object.create(Engine.prototype), {
    params: { seed: 7, chunkCount: 4, chunkSize: 128 }, tiles: [{ cx: 0, cz: 0 }],
    importedMaps: { height: { settings: { mode: 'replace' } }, imagery: { settings: { mode: 'blend' } } },
    importedMapState: {}, worldMode: 'studio', exploreMode: 'none',
    realWorldSource: { id: 'unchanged' },
    cb: { onImportedMaps: vi.fn(), onToast: vi.fn() },
    _decodeImportedImage: vi.fn(async () => decoded()), applyAll: vi.fn(),
    _syncPlanetStyleToParams: vi.fn(), _serializeCreatorTools: () => ({}),
  });
}

describe('reference image authoring', () => {
  it('imports RGBA without touching heights, geographic imagery or terrain generation', async () => {
    const engine = engineFixture();
    const height = engine.importedMaps.height, imagery = engine.importedMaps.imagery;
    const params = structuredClone(engine.params);
    expect(await engine.importTileMap('reference', file)).toBe(true);
    expect(engine.importedMaps.height).toBe(height);
    expect(engine.importedMaps.imagery).toBe(imagery);
    expect(engine.realWorldSource).toEqual({ id: 'unchanged' });
    expect(engine.params).toEqual(params);
    expect(engine.applyAll).not.toHaveBeenCalled();
    expect([...engine.referenceImageLayer.texture.image.data]).toEqual([...decoded().imageData.data]);
    expect(engine.importedMapState.reference.settings).toEqual(normalizeReferenceSettings());
    engine.clearReferenceImage();
  });

  it('applies controls, preserves them on replacement and disposes GPU resources', async () => {
    const engine = engineFixture();
    await engine.importTileMap('reference', file);
    engine.setTileMapSetting('reference', 'opacity', 0.27);
    engine.setTileMapSetting('reference', 'x', 1.5);
    engine.setTileMapSetting('reference', 'visible', false);
    const old = engine.referenceImageLayer;
    const dispose = vi.spyOn(old, 'dispose');
    await engine.importTileMap('reference', file);
    expect(dispose).toHaveBeenCalledOnce();
    expect(engine.importedMaps.reference.settings).toMatchObject({ opacity: 0.27, x: 1.5, visible: false });
    expect(engine.applyAll).not.toHaveBeenCalled();
    const layer = engine.referenceImageLayer;
    const releases = [layer.texture, layer.mesh.geometry, layer.mesh.material].map((r) => vi.spyOn(r, 'dispose'));
    engine.clearReferenceImage();
    expect(releases.every((spy) => spy.mock.calls.length === 1)).toBe(true);
    expect(engine.importedMaps.reference).toBeNull();
    expect(engine.importedMapState.reference).toEqual({});
  });

  it('keeps the previous image on unsupported or corrupt imports', async () => {
    const engine = engineFixture();
    await engine.importTileMap('reference', file);
    const previous = engine.referenceImageLayer;
    expect(await engine.importTileMap('reference', { type: 'image/svg+xml' })).toBe(false);
    engine._decodeImportedImage.mockRejectedValueOnce(new Error('corrupt'));
    expect(await engine.importTileMap('reference', file)).toBe(false);
    expect(engine.referenceImageLayer).toBe(previous);
    expect(engine.importedMapState.reference.error).toMatch(/invalid image/);
    engine.clearReferenceImage();
  });

  it('ignores stale decodes after replacement, removal and disposal', async () => {
    const engine = engineFixture();
    let resolve;
    engine._decodeImportedImage.mockImplementationOnce(() => new Promise((r) => { resolve = r; }));
    const pending = engine.importTileMap('reference', file);
    await engine.importTileMap('reference', { ...file, name: 'new.png' });
    resolve(decoded());
    expect(await pending).toBe(false);
    expect(engine.importedMaps.reference.fileName).toBe('new.png');
    for (const dispose of [false, true]) {
      engine._decodeImportedImage.mockImplementationOnce(() => new Promise((r) => { resolve = r; }));
      const loading = engine.importTileMap('reference', file);
      if (dispose) engine._disposed = true;
      else engine.clearReferenceImage();
      resolve(decoded());
      expect(await loading).toBe(false);
      expect(engine.referenceImageLayer).toBeNull();
    }
  });

  it('round-trips pixels and controls through portable projects and restores without a network request', async () => {
    const engine = engineFixture();
    await engine.importTileMap('reference', file);
    engine.setTileMapSetting('reference', 'scale', 3.5);
    engine.setTileMapSetting('reference', 'z', -2);
    const payload = engine.createProjectPayload();
    const bytes = await encodePortableProject({ terrain: payload });
    const project = await decodePortableProject(bytes);
    expect(project.terrain.referenceImage).toEqual(engine._serializeReferenceImage());
    expect(engine.serializeState().referenceImage).toEqual(payload.referenceImage);
    const restored = engineFixture();
    await restored._restoreReferenceImage(project.terrain.referenceImage);
    expect(restored._serializeReferenceImage()).toEqual(payload.referenceImage);
    expect(restored._decodeImportedImage.mock.calls[0][0]).toBeInstanceOf(Blob);
    await restored._restoreReferenceImage({ ...payload.referenceImage, settings: { opacity: 0.9 } });
    expect(restored._decodeImportedImage).toHaveBeenCalledOnce();
    await restored._restoreReferenceImage(undefined); // legacy project clears reference
    expect(restored.importedMaps.reference).toBeNull();
    // Preserve the application's existing policy for private local images.
    expect(() => assertCloudSurfaceSafe(project)).toThrow(/local textures/);
    engine.clearReferenceImage();
  });

  it('rejects remote/invalid project images and normalizes unsafe controls', async () => {
    expect(normalizeReferenceImage({ version: 1, dataUrl: 'https://example.com/map.png' })).toBeNull();
    expect(normalizeReferenceImage({ version: 2, dataUrl: decoded().preview })).toBeNull();
    expect(normalizeReferenceSettings({ scale: -1, x: Infinity, z: -30, opacity: 3, visible: false }))
      .toEqual({ scale: 0.05, x: 0, z: -20, opacity: 1, visible: false });
    await expect(engineFixture()._restoreReferenceImage({ dataUrl: 'bad' })).rejects.toThrow(/Invalid reference/);
  });

  it('renders only in Tile editing and leaves the main scene and picking untouched', async () => {
    const engine = engineFixture();
    await engine.importTileMap('reference', file);
    engine.renderer = { autoClear: true, render: vi.fn() };
    engine.camera = new THREE.PerspectiveCamera();
    engine._renderReferenceImage();
    expect(engine.renderer.render).toHaveBeenCalledOnce();
    expect(engine.renderer.autoClear).toBe(true);
    const layer = engine.referenceImageLayer;
    expect(layer.mesh.material).toMatchObject({ depthWrite: false, depthTest: false, transparent: true });
    const hits = [];
    layer.mesh.raycast({}, hits);
    expect(hits).toEqual([]);
    expect(layer.mesh.scale.toArray()).toEqual([512, 256, 1]);
    for (const mode of ['planet', 'infinite']) {
      engine.worldMode = mode; engine._renderReferenceImage();
    }
    engine.worldMode = 'studio';
    engine.exploreMode = 'walk'; engine._renderReferenceImage();
    engine.exploreMode = 'none';
    engine.setTileMapSetting('reference', 'visible', false); engine._renderReferenceImage();
    expect(engine.renderer.render).toHaveBeenCalledOnce();
    engine.setTileMapSetting('reference', 'visible', true);
    engine.setTileMapSetting('reference', 'x', 2);
    engine._renderReferenceImage();
    expect(layer.mesh.position.x).toBe(1024);
    expect(engine.renderer.render).toHaveBeenCalledTimes(2);
    engine.clearReferenceImage();
  });

  it.each(['procedural', 'mini', 'manual'])('renders and restores the reference in %s editing', async (mode) => {
    const engine = engineFixture();
    engine.projectMode = mode === 'manual' ? 'manual' : 'procedural';
    engine.mini = { active: mode === 'mini' };
    await engine.importTileMap('reference', file);
    engine.renderer = { autoClear: true, render: vi.fn() };
    engine.camera = new THREE.PerspectiveCamera();
    engine.setTileMapSetting('reference', 'opacity', 0.4);
    engine.setTileMapSetting('reference', 'scale', 2);
    const saved = engine._serializeReferenceImage();
    engine.clearReferenceImage();
    await engine._restoreReferenceImage(saved);
    engine._renderReferenceImage();
    expect(engine.renderer.render).toHaveBeenCalledOnce();
    expect(engine.referenceImageLayer.mesh.material.opacity).toBe(0.4);
    expect(engine.referenceImageLayer.mesh.scale.x).toBe(1024);
    expect(engine.applyAll).not.toHaveBeenCalled();
    engine.clearReferenceImage();
  });

  it('restores renderer state even when rendering fails', () => {
    const layer = new ReferenceImageLayer(decoded().imageData, 2, 1);
    const renderer = { autoClear: true, render: () => { throw new Error('render'); } };
    expect(() => layer.render(renderer, {})).toThrow('render');
    expect(renderer.autoClear).toBe(true);
    layer.dispose();
  });

  it('exposes import and controls through shared UI and worker commands', () => {
    expect(renderToStaticMarkup(renderPanel('reference', {}))).toContain('Choose file');
    expect(panelAvailable('reference', 'studio')).toBe(true);
    expect(panelAvailable('reference', 'planet')).toBe(false);
    expect(panelAvailable('reference', 'infinite')).toBe(false);
    const html = renderToStaticMarkup(<ReferenceImageSection ctx={{ importedMaps: { reference: {
      fileName: file.name, preview: decoded().preview, settings: normalizeReferenceSettings(),
    } } }} />);
    for (const label of ['Show Reference', 'Reference Opacity', 'Reference Scale', 'Reference Position X', 'Reference Position Z', 'Remove Reference']) {
      expect(html).toContain(label);
    }
    expect(html).toContain('image/png,image/jpeg,image/webp');
    expect(html).not.toContain('Height Strength');
    expect(ENGINE_METHODS).toContain('clearReferenceImage');
    expect(ENGINE_METHODS).toContain('importTileMap');
    expect(ENGINE_METHODS).toContain('setTileMapSetting');
  });
});
