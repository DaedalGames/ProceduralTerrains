import type { WebGLRenderer, Texture, Vector3, Vector4 } from 'three';
import type { JsonObject } from './index.js';
export declare class TerrainResources {
  constructor(options?: {
    renderer?: WebGLRenderer;
    resolveAsset?: (id: string, options: { signal?: AbortSignal }) => Promise<unknown>;
    fetch?: typeof fetch;
  });
  read(id: string, options?: { signal?: AbortSignal }): Promise<unknown>;
  acquire<T>(
    key: string,
    create: () => T,
    destroy?: (value: T) => void,
  ): { value: T; release(): void };
  dispose(): void;
}
export interface ErosionInput {
  heightmap: Float32Array;
  width: number;
  height: number;
  params?: Record<string, number>;
}
export interface ErosionResult {
  type: 'result';
  id: number;
  delta: Float32Array;
  flow: Float32Array;
  erosionMask: Float32Array;
  depositionMask: Float32Array;
  sedimentMap: Float32Array;
  slopeMap: Float32Array;
}
export declare class TerrainCompute {
  constructor(options?: { workerFactory?: (kind: 'erosion') => Worker });
  erode(
    input: ErosionInput,
    options?: { signal?: AbortSignal; onProgress?: (progress: number, phase: string) => void },
  ): Promise<ErosionResult>;
  dispose(): void;
}
export interface SurfaceDocument {
  version: number;
  roles: Record<string, string>;
  settings: { profile: string; paletteInfluence: number };
  [key: string]: unknown;
}
export declare function createSurfaceDocument(input?: Partial<SurfaceDocument>): SurfaceDocument;
export declare class TerrainSurfaceProvider {
  constructor(options: {
    baseUrl: string;
    legacyBaseUrl?: string;
    loadUserAsset?: (hash: string, options: { signal?: AbortSignal }) => Promise<Blob>;
    fetch?: typeof fetch;
  });
  dispose(): void;
}
export interface SurfaceResources {
  backend: 'array';
  diffuse: Texture;
  props: Texture;
  mapping: Vector4[];
  tints: Vector3[];
  sizes: number[];
  document: SurfaceDocument;
  dispose(): void;
}
export declare function createSurfaceResources(options: {
  provider: TerrainSurfaceProvider;
  document?: Partial<SurfaceDocument>;
  signal?: AbortSignal;
  graph?: JsonObject;
  paint?: JsonObject;
}): Promise<SurfaceResources>;
export declare class TerrainSurfaceWorker {
  constructor(options?: { workerFactory?: () => Worker });
  prepare(
    input: {
      provider: { baseUrl: string; legacyBaseUrl?: string };
      document?: Partial<SurfaceDocument>;
    },
    options?: { signal?: AbortSignal },
  ): Promise<SurfaceResources>;
  dispose(): void;
}
