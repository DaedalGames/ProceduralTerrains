import type { PerspectiveCamera, Scene, WebGLRenderer } from 'three';
import type { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import type { FiniteTerrain, TerrainConfigurationPatch } from './index.js';
export declare function createTerrainViewer(
  container: HTMLElement,
  options?: { configuration?: TerrainConfigurationPatch; signal?: AbortSignal },
): Promise<{
  renderer: WebGLRenderer;
  scene: Scene;
  camera: PerspectiveCamera;
  controls: OrbitControls;
  terrain: FiniteTerrain;
  dispose(): void;
}>;
