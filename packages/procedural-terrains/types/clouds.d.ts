import type { Camera } from 'three';
import type { FiniteTerrain, TerrainLayer, TerrainExtension } from './index.js';
export type CloudMode = 'legacy' | 'realistic';
export interface CloudParameters {
  cloudsEnabled?: boolean;
  cloudChunksEnabled?: boolean;
  cloudCoverage?: number;
  cloudDensity?: number;
  cloudSoftness?: number;
  cloudNoiseVariant?: string;
  cloudNoiseSeed?: number;
  cloudAltitude?: number;
  cloudThickness?: number;
  cloudScale?: number;
  cloudDetailScale?: number;
  cloudDetailStrength?: number;
  cloudErosionScale?: number;
  cloudErosionStrength?: number;
  cloudWindDir?: number;
  cloudWindSpeed?: number;
  cloudRotationSpeed?: number;
  cloudEvolveSpeed?: number;
  cloudLightAbsorption?: number;
  cloudShadowStrength?: number;
  cloudScatteringStrength?: number;
  cloudAtmosphereInfluence?: number;
  cloudSunResponse?: number;
  cloudAmbientResponse?: number;
  cloudSilverLining?: number;
  cloudShadowsEnabled?: boolean;
  cloudShadowOpacity?: number;
  cloudColor?: number[];
  cloudShadowColor?: number[];
  cloudRenderMode?: string;
  cloudSystemScale?: number;
  cloudErosion?: number;
  cloudBillowSize?: number;
  cloudTowering?: number;
  cloudShear?: number;
  cloudForwardScatter?: number;
  cloudSkyTint?: number[];
  cloudExposure?: number;
}
export interface CloudOptions {
  terrain: FiniteTerrain;
  signal?: AbortSignal;
  mode?: CloudMode;
  parameters?: CloudParameters;
  quality?: Record<string, number>;
}
export declare class TerrainClouds implements TerrainLayer {
  constructor(options: CloudOptions);
  configure(
    patch?: { mode?: CloudMode; parameters?: CloudParameters },
    options?: { signal?: AbortSignal },
  ): Promise<void>;
  prepare(camera: Camera, options?: { signal?: AbortSignal }): Promise<void>;
  update(deltaSeconds: number, frame: { camera: Camera }): void;
  serialize(): TerrainExtension;
  getDiagnostics(): Record<string, unknown>;
  dispose(): void;
}
export declare function createClouds(options: CloudOptions): Promise<TerrainClouds>;
export declare const CLOUD_DEFAULT_PARAMS: Readonly<Required<CloudParameters>>;
