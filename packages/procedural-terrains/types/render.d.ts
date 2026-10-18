import type { Camera, Scene, WebGLRenderer, WebGLRenderTarget } from 'three';
import { Pass } from 'three/addons/postprocessing/Pass.js';
import type { FiniteTerrain, TerrainLayer } from './index.js';
export interface PipelineOptions {
  renderer: WebGLRenderer;
  terrains?: FiniteTerrain[];
}
export declare class TerrainRenderPipeline {
  constructor(options: PipelineOptions);
  render(scene: Scene, camera: Camera, options?: { target?: WebGLRenderTarget | null }): void;
  dispose(): void;
}
/** Replaces RenderPass: draws the scene, then terrain effects. */
export declare class TerrainPass extends Pass {
  constructor(scene: Scene, camera: Camera, options: PipelineOptions);
  dispose(): void;
}
export declare class TerrainHeightCache implements TerrainLayer {
  constructor(options: { terrain: FiniteTerrain; resolution?: number });
  prepare(camera: Camera, options?: { signal?: AbortSignal }): Promise<void>;
  dispose(): void;
}
export declare function createHeightCache(options: {
  terrain: FiniteTerrain;
  resolution?: number;
}): TerrainHeightCache;
export declare class TerrainDetailCache implements TerrainLayer {
  constructor(options: {
    terrain: FiniteTerrain;
    quality?: 1 | 2 | 3;
    scale?: number;
    strength?: number;
    onError?: (error: Error) => void;
  });
  update(deltaSeconds: number, frame: { camera: Camera }): void;
  getDiagnostics(): { pending: number; cpuPages: number; ready: boolean };
  dispose(): void;
}
export declare function createDetailCache(options: {
  terrain: FiniteTerrain;
  quality?: 1 | 2 | 3;
  scale?: number;
  strength?: number;
  onError?: (error: Error) => void;
}): TerrainDetailCache;
