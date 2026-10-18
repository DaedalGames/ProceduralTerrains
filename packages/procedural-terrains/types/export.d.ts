import type { FiniteTerrain } from './index.js';
export interface TerrainExportOptions {
  format?: 'glb' | 'obj';
  meshRes?: number;
  texRes?: number;
  heightRes?: number;
  collisionRes?: number;
  includeMesh?: boolean;
  includeSkirts?: boolean;
  includeBase?: boolean;
  bakeColor?: boolean;
  bakeNormal?: boolean;
  bakeLighting?: boolean;
  exportHeightmap?: boolean;
  exportCollision?: boolean;
  exportWater?: boolean;
  exportPreset?: boolean;
  exportSplat?: boolean;
  region?: { cx: number; cz: number; size: number };
  signal?: AbortSignal;
  onProgress?: (message: string) => void;
}
export interface TerrainExportResult {
  files: Record<string, Uint8Array>;
  filename: string;
  diagnostics: unknown[];
}
export declare function exportTerrain(
  terrain: FiniteTerrain,
  options?: TerrainExportOptions,
): Promise<TerrainExportResult>;
export declare function zipTerrainExport(
  result: TerrainExportResult,
  options?: { level?: 0 | 1 | 2 | 3 | 4 | 5 | 6 | 7 | 8 | 9 },
): Uint8Array;
