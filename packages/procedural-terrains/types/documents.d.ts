import type { TerrainDocument, TerrainOptions, FiniteTerrain } from './index.js';
export declare function loadTerrainDocument(
  document: TerrainDocument,
  options: TerrainOptions,
): Promise<FiniteTerrain>;
