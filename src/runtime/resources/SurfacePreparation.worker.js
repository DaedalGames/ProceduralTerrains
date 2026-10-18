import { buildSurfaceResources } from '../../engine/terrain/surface/SurfaceResources.js';
import { serializePreparedSurface } from '../../engine/terrain/surface/SurfacePreparationWire.js';
import { TerrainSurfaceProvider } from './SurfaceAssets.js';
self.onmessage = async ({ data }) => {
  let surface, provider;
  try {
    provider = new TerrainSurfaceProvider(data.options.provider);
    surface = await buildSurfaceResources({ ...data.options, provider });
    const { result, transfer } = serializePreparedSurface(surface);
    self.postMessage({ result }, transfer);
  } catch (error) {
    self.postMessage({ error: { message: error.message, code: error.code } });
  } finally {
    surface?.diffuse.dispose();
    surface?.props.dispose();
    provider?.dispose();
  }
};
