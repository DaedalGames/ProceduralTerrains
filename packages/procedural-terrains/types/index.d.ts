import type { Camera, Group, WebGLRenderer } from 'three';

/** Linear RGB components in [0, 1]. */
export type TerrainColor = readonly [number, number, number];
export type TerrainPaletteKey = 'deep' | 'shallow' | 'sand' | 'dune' | 'dryGrass'
  | 'grass' | 'forest' | 'jungle' | 'swamp' | 'tundra' | 'redRock' | 'redRock2'
  | 'rock' | 'rockHi' | 'snow' | 'foam';
export type TerrainPalette = Readonly<Record<TerrainPaletteKey, TerrainColor>>;

export interface TerrainConfiguration {
  readonly heightScale: number;
  /** Shoreline used for terrain colouring; this release does not create water. */
  readonly seaLevel: number;
  readonly layout: { readonly chunkCount: number; readonly chunkSize: number };
  readonly source: {
    readonly kind: 'noise'; readonly seed: number; readonly octaves: number;
    readonly scale: number; readonly strength: number; readonly smoothing: number;
    readonly detail: number; readonly persistence: number; readonly lacunarity: number;
    readonly ridge: number; readonly warp: number; readonly falloff: number;
    readonly edgeFalloffMode: 'island' | 'mountains';
  };
  readonly quality: {
    readonly lodSegments: readonly [number, number, number, number];
    readonly lodDistanceScale: number; readonly morphEnabled: boolean;
    readonly mergeEnabled: boolean; readonly cullingEnabled: boolean;
  };
  readonly lighting: {
    readonly sunAzimuth: number; readonly sunElevation: number; readonly fogDensity: number;
  };
  readonly palette: TerrainPalette;
}

export type TerrainConfigurationPatch = Partial<Pick<TerrainConfiguration, 'heightScale' | 'seaLevel'>> & {
  layout?: Partial<TerrainConfiguration['layout']>;
  source?: Partial<TerrainConfiguration['source']>;
  quality?: Partial<TerrainConfiguration['quality']>;
  lighting?: Partial<TerrainConfiguration['lighting']>;
  palette?: Partial<Record<TerrainPaletteKey, TerrainColor>>;
};

export interface TerrainOptions {
  /** Borrowed; never resized, reconfigured or disposed by the terrain. */
  renderer: WebGLRenderer;
  configuration?: TerrainConfigurationPatch;
  signal?: AbortSignal;
}

export interface TerrainDiagnostics {
  disposed: boolean; prepared: boolean; revision: number;
  chunks: number; visible: number; culled: number; lodCounts: number[];
  mergedGroups: number; savedDrawCalls: number;
}

export interface TerrainDocument {
  format: 'procedural-terrains'; schemaVersion: 1; kind: 'finite';
  configuration: TerrainConfiguration;
}

export declare class FiniteTerrain {
  constructor(options: TerrainOptions);
  /** Caller may attach this group to an identity-transformed scene/root. */
  readonly object: Group;
  readonly configuration: TerrainConfiguration;
  /** Explicitly warm and validate the initial shader before first rendering. */
  prepare(camera: Camera, options?: { signal?: AbortSignal }): Promise<void>;
  /** Live uniform edits preserve geometry. Shader edits publish after compilation. */
  configure(patch: TerrainConfigurationPatch, options?: { signal?: AbortSignal }): Promise<void>;
  /** Seconds; advances LOD/culling/time without rendering or installing a loop. */
  update(deltaSeconds: number, frame: { camera: Camera }): void;
  /** CPU approximation in world XZ units; null outside the finite board. */
  sampleHeight(x: number, z: number): number | null;
  serialize(): TerrainDocument;
  getDiagnostics(): TerrainDiagnostics;
  /** Idempotent. Cancels pending operations and releases only owned resources. */
  dispose(): void;
}

export declare function createTerrain(options: TerrainOptions): Promise<FiniteTerrain>;
