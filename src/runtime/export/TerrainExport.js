import * as THREE from 'three';
import { zipSync } from 'fflate';
import { TerrainExportBuilder } from '../../engine/terrain/TerrainExportBuilder.js';
import { PlanetExportBuilder } from '../../engine/terrain/PlanetExportBuilder.js';
import { TerrainSource } from '../TerrainSources.js';

/** Artifacts only: no download, filesystem, Electron bridge or implicit save. */
export async function exportTerrain(terrain, { signal, onProgress, region, ...options } = {}) {
  terrain._assertAlive();
  signal?.throwIfAborted();
  if (options.format && !['glb', 'obj'].includes(options.format))
    throw new TypeError('Export format must be glb or obj');
  for (const key of ['meshRes', 'texRes', 'heightRes', 'collisionRes'])
    if (
      options[key] !== undefined &&
      (!Number.isInteger(options[key]) ||
        options[key] < 2 ||
        options[key] > (key === 'meshRes' ? 1024 : 4096))
    )
      throw new RangeError(`Invalid ${key}`);
  const configuration = terrain.configuration,
    document = terrain.serialize();
  let size = configuration.layout.chunkCount * configuration.layout.chunkSize;
  if (terrain.mode === 'infinite') {
    if (
      !region ||
      ![region.cx, region.cz, region.size].every(Number.isFinite) ||
      region.size <= 0 ||
      region.size > 100000
    )
      throw new TypeError(
        'Infinite exports require a finite square region {cx,cz,size} in world units',
      );
    size = region.size;
    options.tiles = [{ cx: region.cx / size, cz: region.cz / size }];
  } else if (region) throw new TypeError('region is only supported for infinite terrain');
  const uniforms = Object.fromEntries(
    Object.entries(terrain._uniforms).map(([name, u]) => [
      name,
      {
        value: u.value?.isTexture
          ? u.value
          : u.value?.clone
            ? u.value.clone()
            : Array.isArray(u.value)
              ? u.value.map((v) => (v?.clone ? v.clone() : v))
              : u.value,
      },
    ]),
  );
  const source = new TerrainSource(configuration, terrain.mode);
  source.install(uniforms);
  uniforms.uUseTerrainHeightTex.value = 0;
  uniforms.uUseTerrainBiomeTex.value = 0;
  uniforms.uUseInfiniteFieldCache.value = 0;
  const params = { ...terrain._params, planetRadius: configuration.layout.radius };
  const progress = (message) => {
    signal?.throwIfAborted();
    terrain._assertAlive();
    onProgress?.(message);
  };
  try {
    let result;
    if (terrain.mode === 'planet')
      result = await PlanetExportBuilder.build(
        terrain._renderer,
        params,
        uniforms,
        options,
        progress,
        source.program,
        source.stack,
      );
    else
      result = await TerrainExportBuilder.build(
        terrain._renderer,
        params,
        uniforms,
        size,
        { ...options, mini: terrain.mini?.controller.exportSpec() },
        progress,
        source.program,
      );
    signal?.throwIfAborted();
    result.files['terrain.json'] = new TextEncoder().encode(JSON.stringify(document, null, 2));
    return result;
  } finally {
    source.dispose();
  }
}
export function zipTerrainExport(result, { level = 6 } = {}) {
  return zipSync(result.files, { level });
}
