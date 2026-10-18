import { createTerrain, FiniteTerrain, type TerrainDocument } from 'procedural-terrains';
import { WebGLRenderer, PerspectiveCamera, Scene } from 'three';

async function consumer(renderer: WebGLRenderer) {
  const camera = new PerspectiveCamera();
  const terrain: FiniteTerrain = await createTerrain({ renderer, configuration: {
    source: { kind: 'noise', seed: 123 }, quality: { lodSegments: [64, 32, 16, 8] },
    palette: { grass: [0.1, 0.2, 0.1] },
  } });
  new Scene().add(terrain.object);
  await terrain.prepare(camera);
  await terrain.configure({ heightScale: 300 });
  terrain.update(0.016, { camera });
  const height: number | null = terrain.sampleHeight(0, 0);
  const document: TerrainDocument = terrain.serialize();
  await createTerrain({ renderer, configuration: document.configuration });
  // @ts-expect-error Graph sources have not been released.
  await terrain.configure({ source: { kind: 'graph' } });
  // @ts-expect-error Configuration is immutable.
  terrain.configuration.source.seed = 1;
  // @ts-expect-error LOD requires four levels.
  await terrain.configure({ quality: { lodSegments: [64, 32] } });
  terrain.dispose();
  return height;
}
void consumer;
