import { createTerrain } from './FiniteTerrain.js';
import { createInfiniteTerrain } from './worlds/InfiniteTerrain.js';
import { createPlanetTerrain } from './worlds/PlanetTerrain.js';
import { MiniPresentation } from './worlds/MiniTerrain.js';
import { createWater } from './effects/TerrainWater.js';
import { createClouds } from './effects/TerrainClouds.js';

export async function loadTerrainDocument(document, options = {}) {
  if (document?.format !== 'procedural-terrains' || document.schemaVersion !== 1)
    throw new TypeError('Unsupported terrain document');
  const factory = {
    finite: createTerrain,
    infinite: createInfiniteTerrain,
    planet: createPlanetTerrain,
  }[document.kind];
  if (!factory) throw new TypeError('Unsupported world kind');
  const terrain = await factory({ ...options, configuration: document.configuration });
  try {
    for (const extension of document.extensions ?? []) {
      options.signal?.throwIfAborted();
      if (extension.type === 'mini') {
        if (terrain.mode !== 'finite') throw new TypeError('Mini requires finite world');
        new MiniPresentation(terrain, extension.state, { backdrop: extension.backdrop });
      } else if (extension.type === 'water')
        await createWater({ ...extension, terrain, signal: options.signal });
      else if (extension.type === 'clouds')
        await createClouds({ ...extension, terrain, signal: options.signal });
      else throw new TypeError(`Unsupported terrain extension: ${extension.type}`);
    }
    return terrain;
  } catch (error) {
    terrain.dispose();
    throw error;
  }
}
