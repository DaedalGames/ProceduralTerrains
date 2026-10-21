import type { Camera, Group } from 'three';
import type { EffectHostOptions, TerrainLayer, TerrainExtension } from './index.js';
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
export interface CloudQuality {
  cloudSteps?: number;
  cloudLightSteps?: number;
  cloudOctaves?: number;
  cloudDetailOctaves?: number;
  cloudRealisticSteps?: number;
  cloudRenderScale?: number;
  cloudMaxDistance?: number;
  cloudUseErosion?: boolean;
  cloudSelfShadow?: boolean;
  cloudLightMode?: 0 | 1;
  cloudStepLOD?: boolean;
  cloudFallback?: 'none' | 'lite' | 'off';
}
export type CloudOptions = EffectHostOptions & {
  signal?: AbortSignal;
  mode?: CloudMode;
  parameters?: CloudParameters;
  quality?: CloudQuality;
}
export declare class TerrainClouds implements TerrainLayer {
  constructor(options: CloudOptions);
  readonly object: Group;
  configure(
    patch?: { mode?: CloudMode; parameters?: CloudParameters; quality?: CloudQuality },
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
