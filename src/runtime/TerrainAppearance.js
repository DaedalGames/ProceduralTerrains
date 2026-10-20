import { DEFAULT_PARAMS } from '../engine/presets.js';

// Shared appearance contract: only shader inputs, never editor or post-process state.
export const DETAIL_FIELDS = {
  terrainDetailQuality: ['uTerrainDetailQuality', 3, 0, 3],
  terrainDetailScale: ['uTerrainDetailScale', 0.16, 0.04, 0.6],
  terrainDetailStrength: ['uTerrainDetailStrength', 0.72, 0, 1.6],
  terrainDetailNormal: ['uTerrainDetailNormalStrength', 0.42, 0, 1],
  terrainDetailNear: ['uTerrainDetailNear', 80, 10, 180],
  terrainDetailFar: ['uTerrainDetailFar', 190, 40, 420],
  terrainRockSlope: ['uTerrainRockSlope', 0.28, 0.08, 0.72],
  terrainRockSharpness: ['uTerrainRockSharpness', 0.14, 0.04, 0.35],
  terrainTriplanar: ['uTerrainTriplanar', true],
  terrainShoreRange: ['uTerrainShoreRange', 18, 2, 60],
  terrainShoreWetness: ['uTerrainShoreWetness', 0.35, 0, 1],
  terrainDetailOpacity: ['uTerrainDetailOpacity', 1, 0, 1],
  terrainMicroDetail: ['uTerrainMicroDetail', 0.6, 0, 1],
  terrainMacroVariation: ['uTerrainMacroVariation', 0.5, 0, 1],
};
export const VISUAL_FIELDS = {
  visualsTerrainColorVariation: ['uVisualTerrainColorVariation', 0.36, 0, 2],
  visualsTerrainHeightDetail: ['uVisualTerrainHeightDetail', 0.42, 0, 2],
  visualsWetShoreStrength: ['uVisualWetShoreStrength', 0.55, 0, 2],
  visualsRockDetail: ['uVisualRockDetail', 0.45, 0, 2],
  visualsSoilDetail: ['uVisualSoilDetail', 0.35, 0, 2],
  visualsSandDetail: ['uVisualSandDetail', 0.38, 0, 2],
  visualsFoamBreakup: ['uVisualFoamBreakup', 0.45, 0, 2],
  visualsWetSandRange: ['uVisualWetSandRange', 18, 0, 1000],
  visualsShallowWaterSoftness: ['uVisualShallowWaterSoftness', 0.38, 0, 2],
};
const shading = {
  biomeScale: ['uBiomeScale', 0.01, 1000],
  moistScale: ['uMoistScale', 0.01, 1000],
  moistBias: ['uMoistBias', -10, 10],
  tempBias: ['uTempBias', -10, 10],
  biomeDebug: ['uBiomeDebug', false],
  snowLine: ['uSnowLine', -100000, 100000],
  normalStrength: ['uNormalStrength', 0, 10],
  aoStrength: ['uAO', 0, 10],
  aoRidge: ['uAORidge', 0, 10],
  rockSlopeLo: ['uRockSlopeLo', 0, 2],
  rockSlopeHi: ['uRockSlopeHi', 0, 2],
  snowSlopeMin: ['uSnowSlopeMin', 0, 2],
  snowSlopeMax: ['uSnowSlopeMax', 0, 2],
};
export const MATERIAL_FIELDS = { ...Object.fromEntries(Object.entries(shading).map(([key, v]) =>
  [key, [v[0], DEFAULT_PARAMS[key] ?? (typeof v[1] === 'boolean' ? v[1] : 0), ...(typeof v[1] === 'boolean' ? [] : v.slice(1))]])), ...DETAIL_FIELDS, ...VISUAL_FIELDS };
export const MATERIAL_DEFAULTS = Object.fromEntries(Object.entries(MATERIAL_FIELDS).map(([key, v]) => [key, v[1]]));
export const STYLE_DEFAULTS = {
  paletteSaturation: 1, paletteContrast: 1, paletteTint: [1,1,1],
  sunColor: [1,.94,.82], sunIntensity: 1.25,
  skyAmbient: [.36,.46,.62], groundBounce: [.20,.16,.11],
};
export function terrainStyle(value = {}) {
  return Object.fromEntries(Object.keys(STYLE_DEFAULTS).filter(key => value[key] !== undefined).map(key => [key, structuredClone(value[key])]));
}
export function terrainMaterial(value = {}) {
  return Object.fromEntries(Object.keys(MATERIAL_DEFAULTS).filter(key => value[key] !== undefined).map(key => [key, value[key]]));
}
function applyFields(u, values, fields) {
  for (const [key, [name, fallback]] of Object.entries(fields)) {
    const v = values[key] ?? fallback;
    if (u[name]) u[name].value = typeof v === 'boolean' ? Number(v) : v;
  }
}
export function applyTerrainDetailUniforms(u, values = {}) {
  applyFields(u, values, DETAIL_FIELDS);
  u.uTerrainDetailFar.value = Math.max(u.uTerrainDetailNear.value + 1, u.uTerrainDetailFar.value);
}
export function applyTerrainVisualUniforms(u, values = {}) { applyFields(u, values, VISUAL_FIELDS); }
