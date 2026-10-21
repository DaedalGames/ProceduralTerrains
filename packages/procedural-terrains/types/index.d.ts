import type { Camera, Group, WebGLRenderer, Texture } from 'three';

export type JsonValue =
  | string
  | number
  | boolean
  | null
  | JsonValue[]
  | { [key: string]: JsonValue };
export type JsonObject = { [key: string]: JsonValue };
export interface NoiseParameters {
  readonly seed: number;
  readonly octaves: number;
  readonly scale: number;
  readonly strength: number;
  readonly smoothing: number;
  readonly detail: number;
  readonly persistence: number;
  readonly lacunarity: number;
  readonly ridge: number;
  readonly warp: number;
  readonly falloff: number;
  readonly edgeFalloffMode: 'island' | 'mountains';
}
export interface NoiseLayer {
  id: string;
  name: string;
  type: string;
  enabled: boolean;
  blendMode: string;
  strength: number;
  opacity: number;
  seedOffset: number;
  params: Record<string, number>;
  masks?: JsonObject[];
}
export interface NoiseStack {
  version: number;
  layers: NoiseLayer[];
  normalizeOutput?: boolean;
  outputMin?: number;
  outputMax?: number;
}
export interface GraphNode {
  id: string;
  type: string;
  params?: JsonObject;
  position?: { x: number; y: number };
  label?: string;
}
export interface GraphDocument {
  version: number;
  nodes: GraphNode[];
  edges: {
    id?: string;
    source: string;
    target: string;
    sourceHandle?: string;
    targetHandle?: string;
    type?: 'analytic-height' | 'analytic-color';
  }[];
  [key: string]: unknown;
}
export interface ManualDocument {
  version?: number;
  baseSource?: 'flat' | 'procedural' | 'nodes';
  shapes?: JsonObject[];
  sculpt?: JsonObject | null;
  surfacePaint?: JsonObject | null;
}
export type TerrainSourcePatch =
  | (Partial<NoiseParameters> & { kind?: 'noise'; stack?: NoiseStack })
  | (Partial<NoiseParameters> & { kind: 'graph'; graph: GraphDocument })
  | (Partial<NoiseParameters> & {
      kind: 'manual';
      document?: ManualDocument;
      resolution?: number;
      stack?: NoiseStack;
      graph?: GraphDocument;
    })
  | (Partial<NoiseParameters> & {
      kind: 'heightmap';
      data: ArrayLike<number>;
      width: number;
      height: number;
    });
export interface TerrainExtension {
  type: string;
  [key: string]: unknown;
}
export interface TerrainLayer {
  prepare?(camera: Camera, options?: { signal?: AbortSignal }): Promise<void>;
  onTerrainChanged?(options?: { signal?: AbortSignal }): void | Promise<void>;
  update?(deltaSeconds: number, frame: { camera: Camera }): void;
  beforeRender?(): void;
  serialize?(): TerrainExtension;
  dispose(): void;
}

/** Linear RGB components in [0, 1]. */
export type TerrainColor = readonly [number, number, number];
export type TerrainPaletteKey =
  | 'deep'
  | 'shallow'
  | 'sand'
  | 'dune'
  | 'dryGrass'
  | 'grass'
  | 'forest'
  | 'jungle'
  | 'swamp'
  | 'tundra'
  | 'redRock'
  | 'redRock2'
  | 'rock'
  | 'rockHi'
  | 'snow'
  | 'foam';
export type TerrainPalette = Readonly<Record<TerrainPaletteKey, TerrainColor>>;

export interface TerrainMaterialSettings {
  readonly biomeScale: number;
  readonly moistScale: number;
  readonly moistBias: number;
  readonly tempBias: number;
  readonly biomeDebug: boolean;
  readonly snowLine: number;
  readonly normalStrength: number;
  readonly aoStrength: number;
  readonly aoRidge: number;
  readonly rockSlopeLo: number;
  readonly rockSlopeHi: number;
  readonly snowSlopeMin: number;
  readonly snowSlopeMax: number;
  readonly terrainDetailQuality: number;
  readonly terrainDetailScale: number;
  readonly terrainDetailStrength: number;
  readonly terrainDetailNormal: number;
  readonly terrainDetailNear: number;
  readonly terrainDetailFar: number;
  readonly terrainRockSlope: number;
  readonly terrainRockSharpness: number;
  readonly terrainTriplanar: boolean;
  readonly terrainShoreRange: number;
  readonly terrainShoreWetness: number;
  readonly terrainDetailOpacity: number;
  readonly terrainMicroDetail: number;
  readonly terrainMacroVariation: number;
  readonly visualsTerrainColorVariation: number;
  readonly visualsTerrainHeightDetail: number;
  readonly visualsWetShoreStrength: number;
  readonly visualsRockDetail: number;
  readonly visualsSoilDetail: number;
  readonly visualsSandDetail: number;
  readonly visualsFoamBreakup: number;
  readonly visualsWetSandRange: number;
  readonly visualsShallowWaterSoftness: number;
}
export interface TerrainStyleSettings {
  readonly paletteSaturation: number;
  readonly paletteContrast: number;
  readonly paletteTint: TerrainColor;
  readonly sunColor: TerrainColor;
  readonly sunIntensity: number;
  readonly skyAmbient: TerrainColor;
  readonly groundBounce: TerrainColor;
}
export interface TerrainConfiguration {
  readonly heightScale: number;
  readonly terrainFormationSeaLevel: number;
  readonly material: Readonly<TerrainMaterialSettings>;
  readonly style: Readonly<TerrainStyleSettings>;
  /** Shoreline in world units; optional water is a separate layer. */
  readonly seaLevel: number;
  readonly layout: {
    readonly chunkCount: number;
    readonly chunkSize: number;
    readonly viewRadius?: number;
    readonly triangleBudget?: number;
    readonly maxCreatesPerFrame?: number;
    readonly streamBudgetMs?: number;
    readonly cacheResolution?: number;
    readonly radius?: number;
    readonly faceGrid?: number;
    readonly bakeResolution?: number;
  };
  readonly source: Readonly<
    NoiseParameters &
      (
        | { kind: 'noise'; stack?: NoiseStack }
        | { kind: 'graph'; graph: GraphDocument }
        | {
            kind: 'manual';
            document: ManualDocument;
            resolution: number;
            graph?: GraphDocument;
            stack?: NoiseStack;
          }
        | { kind: 'heightmap'; data: readonly number[]; width: number; height: number }
      )
  >;
  readonly quality: {
    readonly lodSegments: readonly [number, number, number, number];
    readonly lodDistanceScale: number;
    readonly morphEnabled: boolean;
    readonly mergeEnabled: boolean;
    readonly cullingEnabled: boolean;
  };
  readonly lighting: {
    readonly sunAzimuth: number;
    readonly sunElevation: number;
    readonly fogDensity: number;
  };
  readonly palette: TerrainPalette;
}

export type TerrainConfigurationPatch = Partial<
  Pick<TerrainConfiguration, 'heightScale' | 'seaLevel' | 'terrainFormationSeaLevel'>
> & {
  material?: Partial<TerrainMaterialSettings>;
  style?: Partial<TerrainStyleSettings>;
  layout?: Partial<TerrainConfiguration['layout']>;
  source?: TerrainSourcePatch;
  quality?: Partial<TerrainConfiguration['quality']>;
  lighting?: Partial<TerrainConfiguration['lighting']>;
  palette?: Partial<Record<TerrainPaletteKey, TerrainColor>>;
};

export interface EffectWorldOptions {
  mode?: 'finite' | 'infinite';
  /** Active coverage in world units, 1..100000 (infinite minimum: 6). No terrain mesh is allocated. */
  size?: number;
  heightScale?: number;
  seaLevel?: number;
  sunAzimuth?: number;
  sunElevation?: number;
}
export type EffectHostOptions =
  | { terrain: FiniteTerrain; renderer?: never; world?: never }
  | { renderer: WebGLRenderer; world?: EffectWorldOptions; terrain?: never };
export interface TerrainOptions {
  /** Borrowed; never resized, reconfigured or disposed by the terrain. */
  renderer: WebGLRenderer;
  configuration?: TerrainConfigurationPatch;
  signal?: AbortSignal;
  resources?: import('./assets.js').TerrainResources;
}

export interface TerrainDiagnostics {
  disposed: boolean;
  prepared: boolean;
  revision: number;
  chunks: number;
  visible: number;
  culled: number;
  lodCounts: number[];
  mergedGroups?: number;
  savedDrawCalls?: number;
  mode?: 'finite' | 'infinite' | 'planet';
}

export interface TerrainDocument {
  format: 'procedural-terrains';
  schemaVersion: 1;
  kind: 'finite' | 'infinite' | 'planet';
  extensions?: TerrainExtension[];
  configuration: TerrainConfiguration;
}

export declare class FiniteTerrain {
  constructor(options: TerrainOptions);
  /** Caller may attach this group to an identity-transformed scene/root. */
  readonly object: Group;
  readonly mode: 'finite' | 'infinite' | 'planet';
  readonly configuration: TerrainConfiguration;
  mini?: import('./mini.js').MiniPresentation;
  attribution?: string;
  /** Explicitly warm and validate the initial shader before first rendering. */
  prepare(camera: Camera, options?: { signal?: AbortSignal }): Promise<void>;
  /** Live uniform edits preserve geometry. Shader edits publish after compilation. */
  configure(patch: TerrainConfigurationPatch, options?: { signal?: AbortSignal }): Promise<void>;
  /** Seconds; advances LOD/culling/time without rendering or installing a loop. */
  update(deltaSeconds: number, frame: { camera: Camera }): void;
  /** CPU approximation in world XZ units; null outside the finite board. */
  sampleHeight(x: number, z: number): number | null;
  sampleHeight3D(x: number, y: number, z: number): number;
  /** Borrowed textures/resources are never disposed by the terrain. */
  setImagery(texture: Texture | null, options?: { blend?: number }): void;
  setSurface(
    surface: import('./assets.js').SurfaceResources | null,
    options?: { signal?: AbortSignal },
  ): Promise<void>;
  addLayer(layer: TerrainLayer): () => void;
  serialize(): TerrainDocument;
  getDiagnostics(): TerrainDiagnostics;
  /** Idempotent. Cancels pending operations and releases only owned resources. */
  dispose(): void;
}

export declare function createTerrain(options: TerrainOptions): Promise<FiniteTerrain>;
