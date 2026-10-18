import type { TerrainOptions, FiniteTerrain } from './index.js';
export interface GeoRequest {
  bbox: { west: number; east: number; south: number; north: number };
  zoom: number;
}
export interface HeightmapData {
  data: ArrayLike<number>;
  width: number;
  height: number;
  attribution?: string;
}
export interface ImageryData {
  rgba: Uint8Array | Uint8ClampedArray;
  width: number;
  height: number;
}
export interface GeoProvider {
  attribution?: string;
  loadHeightmap(request: GeoRequest, options?: { signal?: AbortSignal }): Promise<HeightmapData>;
  loadImagery?(request: GeoRequest, options?: { signal?: AbortSignal }): Promise<ImageryData>;
}
export declare class TerrariumProvider implements GeoProvider {
  constructor(options: {
    elevationTileUrl: (z: number, x: number, y: number) => string;
    imageryTileUrl?: (z: number, x: number, y: number) => string;
    attribution?: string;
    fetch?: typeof fetch;
  });
  readonly attribution: string;
  loadHeightmap(
    request: GeoRequest,
    options?: { signal?: AbortSignal; onProgress?: (progress: number) => void },
  ): Promise<HeightmapData>;
  loadImagery(request: GeoRequest, options?: { signal?: AbortSignal }): Promise<ImageryData>;
}
export declare function createRealWorldTerrain(
  options: TerrainOptions & { provider: GeoProvider; request: GeoRequest; imagery?: boolean },
): Promise<FiniteTerrain>;
