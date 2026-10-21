import type { Camera, Group } from 'three';
import type { EffectHostOptions, TerrainLayer, TerrainExtension } from './index.js';
export type WaterMode = 'off' | 'legacy' | 'realistic' | 'volumetric' | 'cinematic' | 'stylized';
export interface WaterParameters {
  waterEnabled?: boolean;
  waterHideAtZero?: boolean;
  waterMode?: string;
  waterQualityPreset?: string;
  waterAutoDowngradeInfinite?: boolean;
  waterLegacyOnLowFps?: boolean;
  waterOpacity?: number;
  waterRoughness?: number;
  waterFresnelStrength?: number;
  waterRefractionStrength?: number;
  waterSpecularStrength?: number;
  waterBiomeColorEnabled?: boolean;
  waterBiomeColorStrength?: number;
  waterNaturalColor?: number;
  waterDioramaShader?: string;
  waterDioramaReflections?: string;
  waterDioramaReflectionStrength?: number;
  waterDioramaReflectionBlur?: number;
  waterDioramaReflectionDistortion?: number;
  waterDioramaTransparency?: number;
  waterDioramaTint?: number;
  waterDioramaShoreClarity?: number;
  waterAtmosphereInfluence?: number;
  waterSunResponse?: number;
  waterAmbientResponse?: number;
  waterFoamLighting?: number;
  waterDepthColorStrength?: number;
  waterDepthOpacityStrength?: number;
  waterMaxVisibleDepth?: number;
  waterDepthFalloff?: number;
  waterShallowDistance?: number;
  waterDeepDistance?: number;
  waterAbsorptionStrength?: number;
  waterWaveSpeed?: number;
  waterWaveScale?: number;
  waterWaveStrength?: number;
  waterSmallWaveStrength?: number;
  waterLargeWaveStrength?: number;
  waterNormalIntensity?: number;
  waterWaveDirection?: number;
  waterAnimSpeed?: number;
  waterFoamEnabled?: boolean;
  waterFoamStrength?: number;
  waterFoamWidth?: number;
  waterFoamSoftness?: number;
  waterFoamAnimSpeed?: number;
  waterSlopeFoam?: number;
  waterCliffFoam?: number;
  waterUnderwaterEnabled?: boolean;
  waterUnderwaterMode?: string;
  waterUnderwaterFogDensity?: number;
  waterUnderwaterVisibility?: number;
  waterUnderwaterDistortion?: number;
  waterUnderwaterCaustics?: number;
  waterUnderwaterCausticsEnabled?: boolean;
  waterUnderwaterCausticScale?: number;
  waterUnderwaterCausticSpeed?: number;
  waterUnderwaterCausticMinDepth?: number;
  waterUnderwaterCausticMinDepthFalloff?: number;
  waterUnderwaterParticles?: boolean;
  waterUnderwaterLightShafts?: boolean;
  waterSurfaceTransition?: number;
  waterReflectionQuality?: number;
  waterRefractionQuality?: number;
  waterFoamQuality?: number;
  waterCausticsQuality?: number;
  waterNormalResolution?: number;
  waterRenderScale?: number;
  waterUpdateFrequency?: number;
  waterDisableExpensiveBelowFps?: number;
  waterDebugView?: string;
  waterShowMeshBounds?: boolean;
  waterShowPerfCost?: boolean;
  seaLevel?: number;
  waterAnim?: boolean;
}
export interface WaterQuality {
  waterQuality?: 0 | 1 | 2;
  waterDetail?: number;
  waterReflection?: number;
  waterWaves?: number;
}
export type WaterOptions = EffectHostOptions & {
  signal?: AbortSignal;
  mode?: WaterMode;
  parameters?: WaterParameters;
  quality?: WaterQuality;
}
export declare class TerrainWater implements TerrainLayer {
  constructor(options: WaterOptions);
  readonly object: Group;
  configure(
    patch?: { mode?: WaterMode; parameters?: WaterParameters; quality?: WaterQuality },
    options?: { signal?: AbortSignal },
  ): Promise<void>;
  prepare(camera: Camera, options?: { signal?: AbortSignal }): Promise<void>;
  update(deltaSeconds: number, frame: { camera: Camera }): void;
  serialize(): TerrainExtension;
  getDiagnostics(): Record<string, unknown>;
  dispose(): void;
}
export declare function createWater(options: WaterOptions): Promise<TerrainWater>;
export declare const WATER_DEFAULT_PARAMS: Readonly<Required<WaterParameters>>;
export declare const WATER_MODES: readonly { value: WaterMode; label: string }[];
