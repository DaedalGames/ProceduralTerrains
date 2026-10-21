import * as THREE from 'three';
import { fetchBboxElevation, fetchBboxImagery } from '../../engine/terrain/RealWorldHeightmap.js';
import { createTerrain } from '../FiniteTerrain.js';

function validateRequest({ bbox, zoom }) {
  if (
    !bbox ||
    ![bbox.west, bbox.east, bbox.south, bbox.north].every(Number.isFinite) ||
    bbox.west >= bbox.east ||
    bbox.south >= bbox.north ||
    bbox.west < -180 ||
    bbox.east > 180 ||
    bbox.south < -85 ||
    bbox.north > 85
  )
    throw new TypeError('An ordered non-antimeridian bbox within Web Mercator limits is required');
  if (!Number.isInteger(zoom) || zoom < 0 || zoom > 18) throw new RangeError('zoom must be 0..18');
  const n = 2 ** zoom,
    merc = (lat) => ((1 - Math.asinh(Math.tan((lat * Math.PI) / 180)) / Math.PI) / 2) * n;
  const nx =
    Math.floor(((bbox.east + 180) / 360) * n) - Math.floor(((bbox.west + 180) / 360) * n) + 1;
  const ny = Math.floor(merc(bbox.south)) - Math.floor(merc(bbox.north)) + 1;
  if (nx > 6 || ny > 6)
    throw new RangeError('Request exceeds the 6×6 tile budget; reduce zoom or bbox');
}
/** All endpoints and attribution are explicit. No network work at import time. */
export class TerrariumProvider {
  constructor({
    elevationTileUrl,
    imageryTileUrl,
    attribution,
    fetch: fetcher = globalThis.fetch?.bind(globalThis),
  } = {}) {
    if (typeof elevationTileUrl !== 'function')
      throw new TypeError('elevationTileUrl(z,x,y) is required');
    this.elevationTileUrl = elevationTileUrl;
    this.imageryTileUrl = imageryTileUrl;
    this.attribution = attribution ?? '';
    this.fetch = fetcher;
  }
  async loadHeightmap(request, { signal, onProgress } = {}) {
    validateRequest(request);
    const r = await fetchBboxElevation(
      {
        minLon: request.bbox.west,
        maxLon: request.bbox.east,
        minLat: request.bbox.south,
        maxLat: request.bbox.north,
      },
      request.zoom,
      { signal, onProgress, tileUrl: this.elevationTileUrl, fetch: this.fetch },
    );
    return { data: r.elev, width: r.width, height: r.height, attribution: this.attribution };
  }
  async loadImagery(request, { signal, onProgress } = {}) {
    validateRequest(request);
    if (!this.imageryTileUrl) throw new Error('No imagery endpoint configured');
    return fetchBboxImagery(
      {
        minLon: request.bbox.west,
        maxLon: request.bbox.east,
        minLat: request.bbox.south,
        maxLat: request.bbox.north,
      },
      request.zoom,
      { signal, onProgress, tileUrl: this.imageryTileUrl, fetch: this.fetch },
    );
  }
}
export async function createRealWorldTerrain({
  provider,
  request,
  imagery = false,
  signal,
  ...options
} = {}) {
  if (!provider?.loadHeightmap) throw new TypeError('A heightmap provider is required');
  signal?.throwIfAborted();
  const map = await provider.loadHeightmap(request, { signal });
  const terrain = await createTerrain({
    ...options,
    signal,
    configuration: {
      ...options.configuration,
      source: {
        ...options.configuration?.source,
        kind: 'heightmap',
        data: map.data,
        width: map.width,
        height: map.height,
      },
    },
  });
  terrain.attribution = map.attribution ?? provider.attribution ?? '';
  try {
    if (imagery) {
      const image = await provider.loadImagery(request, { signal });
      signal?.throwIfAborted();
      const texture = new THREE.DataTexture(image.rgba, image.width, image.height);
      texture.colorSpace = THREE.SRGBColorSpace;
      texture.minFilter = texture.magFilter = THREE.LinearFilter;
      texture.needsUpdate = true;
      terrain.setImagery(texture);
      terrain._ownedTextures.add(texture);
    }
    return terrain;
  } catch (error) {
    terrain.dispose();
    throw error;
  }
}
