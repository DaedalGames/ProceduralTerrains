import { normalizeTerrainSource } from './TerrainSources.js';
import { DEFAULT_PARAMS } from '../engine/presets.js';
import { EARTH_PALETTE, PALETTE_KEYS } from '../engine/style/ColorPalette.js';

const p = DEFAULT_PARAMS;
const defaults = {
  heightScale: p.heightScale,
  seaLevel: p.seaLevel,
  layout: { chunkCount: 8, chunkSize: p.chunkSize },
  source: {
    kind: 'noise',
    seed: p.seed,
    octaves: p.octaves,
    scale: p.noiseScale,
    strength: p.noiseStrength,
    smoothing: p.terrainSmoothing,
    detail: p.terrainDetail,
    persistence: p.persistence,
    lacunarity: p.lacunarity,
    ridge: p.ridge,
    warp: p.warp,
    falloff: p.falloff,
    edgeFalloffMode: p.edgeFalloffMode,
  },
  quality: {
    lodSegments: [64, 32, 16, 8],
    lodDistanceScale: 1,
    morphEnabled: true,
    mergeEnabled: true,
    cullingEnabled: true,
  },
  lighting: { sunAzimuth: p.sunAzimuth, sunElevation: p.sunElevation, fogDensity: 0 },
  palette: EARTH_PALETTE,
};

export function freezeConfiguration(value) {
  if (value && typeof value === 'object' && !Object.isFrozen(value)) {
    Object.values(value).forEach(freezeConfiguration);
    Object.freeze(value);
  }
  return value;
}

function record(value, allowed, path) {
  if (!value || typeof value !== 'object' || Array.isArray(value))
    throw new TypeError(`${path} must be an object`);
  for (const key of Object.keys(value)) {
    if (!allowed.includes(key)) throw new TypeError(`Unsupported terrain option: ${path}.${key}`);
  }
}

function number(value, min, max, name, integer = false) {
  if (
    !Number.isFinite(value) ||
    value < min ||
    value > max ||
    (integer && !Number.isInteger(value))
  ) {
    throw new RangeError(
      `${name} must be ${integer ? 'an integer' : 'a number'} in [${min}, ${max}]`,
    );
  }
}

export function normalizeConfiguration(patch = {}, base = defaults, world = {}) {
  const layoutDefaults = { ...defaults.layout, ...world.layoutDefaults };
  record(patch, Object.keys(defaults), 'configuration');
  const next = { ...base, ...patch };
  for (const key of ['layout', 'quality', 'lighting', 'palette']) {
    if (patch[key] !== undefined)
      record(patch[key], Object.keys(key === 'layout' ? layoutDefaults : defaults[key]), key);
    next[key] = { ...(key === 'layout' ? layoutDefaults : {}), ...base[key], ...patch[key] };
  }
  next.quality.lodSegments = [...next.quality.lodSegments];
  next.palette = Object.fromEntries(PALETTE_KEYS.map((key) => [key, [...next.palette[key]]]));
  if (patch.source !== undefined)
    record(
      patch.source,
      [
        ...Object.keys(defaults.source),
        'stack',
        'graph',
        'document',
        'resolution',
        'data',
        'width',
        'height',
      ],
      'source',
    );
  next.source =
    patch.source === undefined && Object.isFrozen(base.source)
      ? base.source
      : normalizeTerrainSource(patch.source, base.source, defaults.source, world.mode);
  world.validateLayout?.(next.layout);
  number(next.heightScale, 1, 100000, 'heightScale');
  number(next.seaLevel, -100000, 100000, 'seaLevel');
  number(next.layout.chunkCount, 1, 32, 'layout.chunkCount', true);
  number(next.layout.chunkSize, 1, 100000, 'layout.chunkSize');
  number(next.source.seed, -2147483648, 4294967295, 'source.seed', true);
  number(next.source.octaves, 1, 12, 'source.octaves', true);
  for (const [key, min, max] of [
    ['scale', 0.01, 1000],
    ['strength', 0, 4],
    ['smoothing', 0, 1],
    ['detail', 0, 1],
    ['persistence', 0.01, 1],
    ['lacunarity', 1, 4],
    ['ridge', 0, 2],
    ['warp', 0, 4],
    ['falloff', 0, 1],
  ])
    number(next.source[key], min, max, `source.${key}`);
  if (!['island', 'mountains'].includes(next.source.edgeFalloffMode))
    throw new TypeError('Invalid edgeFalloffMode');
  const segments = next.quality.lodSegments;
  if (segments.length !== 4) throw new TypeError('quality.lodSegments requires four resolutions');
  segments.forEach((v, i) => {
    number(v, 2, 256, 'quality.lodSegments', true);
    if (v % 2 || (i > 0 && segments[i - 1] !== v * 2)) {
      throw new RangeError('LOD resolutions must be even and halve at each level');
    }
  });
  number(next.quality.lodDistanceScale, 0.1, 10, 'quality.lodDistanceScale');
  for (const key of ['morphEnabled', 'mergeEnabled', 'cullingEnabled']) {
    if (typeof next.quality[key] !== 'boolean')
      throw new TypeError(`quality.${key} must be boolean`);
  }
  number(next.lighting.sunAzimuth, -360, 360, 'lighting.sunAzimuth');
  number(next.lighting.sunElevation, -90, 90, 'lighting.sunElevation');
  number(next.lighting.fogDensity, 0, 10, 'lighting.fogDensity');
  for (const key of PALETTE_KEYS) {
    const color = next.palette[key];
    if (color.length !== 3) throw new TypeError(`palette.${key} must be a linear RGB triple`);
    color.forEach((v) => number(v, 0, 1, `palette.${key}`));
  }
  return freezeConfiguration(next);
}

export function configurationParameters(c) {
  return {
    ...DEFAULT_PARAMS,
    ...c.layout,
    heightScale: c.heightScale,
    seaLevel: c.seaLevel,
    // This is a generation input; moving the live shoreline does not change it.
    terrainFormationSeaLevel: DEFAULT_PARAMS.terrainFormationSeaLevel,
    seed: c.source.seed,
    octaves: c.source.octaves,
    noiseScale: c.source.scale,
    noiseStrength: c.source.strength,
    terrainSmoothing: c.source.smoothing,
    terrainDetail: c.source.detail,
    persistence: c.source.persistence,
    lacunarity: c.source.lacunarity,
    ridge: c.source.ridge,
    warp: c.source.warp,
    falloff: c.source.falloff,
    edgeFalloffMode: c.source.edgeFalloffMode,
    ...c.lighting,
  };
}
