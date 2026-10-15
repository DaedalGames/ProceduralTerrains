// ============================================================================
// Mini Terrain look — the art direction of the diorama presentation.
//
// A soft, legible stylised 3D: muted natural palettes (no neon greens), a warm
// key light with a cool sky fill, clear coloured water, restrained post (no
// burned highlights, no heavy bloom). Everything here is data; the engine
// applies it through the existing style/params systems so advanced panels
// keep editing the same values.
// ============================================================================

const srgbToLinear = (c) => (c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4);
const hex = (value) => {
  const h = String(value).replace('#', '');
  return [0, 2, 4].map((i) => srgbToLinear(parseInt(h.slice(i, i + 2), 16) / 255));
};
const palette = (colors) => Object.fromEntries(Object.entries(colors).map(([k, v]) => [k, hex(v)]));

// Terrain palettes (authored as display colours, stored linear like every
// palette the terrain shader reads).
export const MINI_PALETTES = Object.freeze({
  coast: palette({
    deep: '#1d6e86', shallow: '#5cc9c0', sand: '#e8d9b0', dune: '#efe2bd',
    dryGrass: '#a9b46a', grass: '#7fa653', forest: '#4f7d3d', jungle: '#3f6e36',
    swamp: '#5d7a4a', tundra: '#8d9474', redRock: '#a7856a', redRock2: '#bf9c7c',
    rock: '#a39a8c', rockHi: '#c9c1b3', snow: '#f3f1ec', foam: '#ffffff',
  }),
  lake: palette({
    deep: '#1f5d73', shallow: '#62b9ad', sand: '#d9cfae', dune: '#e3d9b9',
    dryGrass: '#9fa86a', grass: '#6f9a4f', forest: '#3f6a3b', jungle: '#365f35',
    swamp: '#55704a', tundra: '#8b8f78', redRock: '#9a8773', redRock2: '#b29e88',
    rock: '#8f8b84', rockHi: '#bdb8ae', snow: '#f4f4f2', foam: '#ffffff',
  }),
});

const RECIPE_LOOK = Object.freeze({
  cove: 'coast',
  islet: 'coast',
  lake: 'lake',
});

/** planetStyle.setStyle() patch for a recipe (and procedural base preset). */
export function miniStylePatch(recipe, preset = null) {
  const key = recipe === 'procedural'
    ? (preset === 'alpine' || preset === 'canyon' ? 'lake' : 'coast')
    : (RECIPE_LOOK[recipe] ?? 'coast');
  return {
    planetPreset: 'custom',
    palettePreset: 'custom',
    palette: MINI_PALETTES[key],
    paletteSaturation: 0.9,
    paletteContrast: 0.96,
    paletteTint: [1, 1, 1],
    // warm key, cool generous sky fill, warm ground bounce: soft studio
    sunColor: [1.0, 0.95, 0.86],
    sunIntensity: 1.05,
    skyAmbient: [0.62, 0.70, 0.82],
    groundBounce: [0.34, 0.30, 0.24],
    customEdits: false,
  };
}

// Water body colours (display sRGB, converted for the shader).
export const MINI_WATER_COLORS = Object.freeze({
  coast: { shallow: '#8fe3d6', mid: '#3fb7c2', deep: '#1a6f96', side: '#6fd3cb' },
  lake: { shallow: '#8fd2c0', mid: '#3a9fa6', deep: '#1c5d76', side: '#6cc5b8' },
});

export function miniWaterColors(recipe) {
  const c = MINI_WATER_COLORS[RECIPE_LOOK[recipe] ?? 'coast'];
  return {
    shallow: hex(c.shallow),
    mid: hex(c.mid),
    deep: hex(c.deep),
    side: hex(c.side),
  };
}

// Post: restrained grading, almost no bloom, no god rays (no sky in frame).
export const MINI_VISUAL_PARAMS = Object.freeze({
  visualsPostEnabled: true,
  visualsExposure: 1.02,
  visualsContrast: 1.03,
  visualsSaturation: 0.97,
  visualsVignette: 0.1,
  visualsBloomStrength: 0.04,
  visualsBloomThreshold: 0.92,
  visualsSunRaysStrength: 0,
  visualsTerrainColorVariation: 0.3,
  visualsTerrainHeightDetail: 0.35,
  visualsWetShoreStrength: 0.35,
});

export function miniLookKey(recipe) {
  return RECIPE_LOOK[recipe] ?? 'coast';
}
