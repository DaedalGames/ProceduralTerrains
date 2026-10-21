import { describe, expect, it, vi } from 'vitest';
import { strToU8 } from 'fflate';
import { decodePortableProject, encodePortableProject } from '../src/project/PortableProject.js';
import { createMiniTerrainState } from '../src/engine/mini/MiniTerrainSettings.js';

describe('project file imports', () => {
  it('reads a binary Mini document and preserves its name and terrain settings', async () => {
    const miniTerrain = createMiniTerrainState({ preset: 'dunes', seed: 1936579376 });
    const source = { metadata: { name: 'Mini desert', extra: 'preserved' }, terrain: { params: { seed: miniTerrain.seed }, miniTerrain } };
    const bytes = await encodePortableProject(source);
    const project = await decodePortableProject(bytes.slice().buffer, { legacyName: 'different filename' });
    expect(project.metadata).toMatchObject(source.metadata);
    expect(project.terrain.miniTerrain).toEqual(miniTerrain);
    expect(project.terrain.params.seed).toBe(1936579376);
  });

  it('keeps the filename for legacy bare JSON imports', async () => {
    const project = await decodePortableProject(strToU8(JSON.stringify({ params: { seed: 42 } })), { legacyName: 'old desert' });
    expect(project.metadata.name).toBe('old desert');
    expect(project.terrain.params.seed).toBe(42);
  });

  it('keeps the document name for JSON project envelopes', async () => {
    const project = await decodePortableProject(strToU8(JSON.stringify({ metadata: { name: 'Saved title' }, terrain: { params: { seed: 10 } } })), { legacyName: 'filename' });
    expect(project.metadata.name).toBe('Saved title');
    expect(project.terrain.params.seed).toBe(10);
  });

  it('rejects corrupt archives before storing assets', async () => {
    const writeBlob = vi.fn();
    await expect(decodePortableProject(strToU8('PKbroken archive'), { writeBlob })).rejects.toThrow();
    expect(writeBlob).not.toHaveBeenCalled();
  });
});
