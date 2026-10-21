import { describe, expect, it } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import WaterPanel from '../src/components/ui/WaterPanel.jsx';
import EnvironmentPanel from '../src/components/ui/EnvironmentPanel.jsx';
import MiniTerrainPanel from '../src/components/panels/MiniTerrainPanel.jsx';
import { createMiniTerrainState } from '../src/engine/mini/MiniTerrainSettings.js';
import { WATER_DEFAULT_PARAMS } from '../src/engine/water/WaterSettings.js';

describe('Mini water inspector', () => {
  it('offers a hexagon footprint and hides square corner controls for it', () => {
    const html = renderToStaticMarkup(<MiniTerrainPanel ctx={{ miniTerrain: { ...createMiniTerrainState(), shape: 'hexagon' } }} />);
    expect(html).toContain('Hexagon');
    expect(html).not.toContain('data-setting-id="mini.waterBevel"');
    expect(html).not.toContain('data-setting-id="mini.terrainBevel"');
  });
  it('exposes the three presentation controls in the Mini panel', () => {
    const html = renderToStaticMarkup(<MiniTerrainPanel ctx={{ miniTerrain: createMiniTerrainState() }} />);
    for (const key of ['waterEdges', 'waterBevel', 'terrainBevel', 'bevelSync', 'bevelStyle']) {
      expect(html).toContain(`data-setting-id="mini.${key}"`);
    }
  });
  it('hides lighting controls that belong to the other water renderers', () => {
    const html = renderToStaticMarkup(<EnvironmentPanel miniActive params={{}} onParam={() => {}} onTuning={() => {}} />);
    expect(html).not.toContain('lighting.waterAtmosphereInfluence');
    expect(html).not.toContain('lighting.waterSunResponse');
  });
  it('keeps supported controls and hides options belonging to other renderers in every mode', () => {
    for (const waterMode of ['legacy', 'realistic', 'volumetric', 'cinematic', 'stylized', 'off']) {
      const html = renderToStaticMarkup(<WaterPanel miniActive worldMode="studio"
        params={{ ...WATER_DEFAULT_PARAMS, seaLevel: 40, waterMode }} perf={{}}
        onParam={() => {}} planetStyleProps={{ onColorChange: () => {} }} />);
      for (const id of ['performance.waterQuality', 'performance.waterReflection', 'performance.waterDetail', 'performance.waterWaves',
        'water.waterOpacity', 'water.waterAbsorptionStrength', 'water.waterWaveScale', 'water.waterFoamEnabled', 'water.waterUnderwaterCaustics',
        'water.waterDioramaShader', 'water.waterDioramaReflections', 'water.waterDioramaReflectionStrength',
        'water.waterDioramaTransparency', 'water.waterDioramaShoreClarity']) {
        expect(html).toContain(`data-setting-id="${id}"`);
      }
      for (const id of ['water.waterMode', 'water.waterRoughness', 'water.waterDepthFalloff', 'water.waterSmallWaveStrength',
        'water.waterReflectionQuality', 'water.waterNormalResolution', 'water.waterDebugView', 'water.waterLegacyOnLowFps']) {
        expect(html).not.toContain(`data-setting-id="${id}"`);
      }
    }
  });
  it('shows the full wave field only with the Realistic diorama shader', () => {
    const render = (shader) => renderToStaticMarkup(<WaterPanel miniActive worldMode="studio"
      params={{ ...WATER_DEFAULT_PARAMS, seaLevel: 40, waterDioramaShader: shader }} perf={{}}
      onParam={() => {}} planetStyleProps={{ onColorChange: () => {} }} />);
    expect(render('realistic')).toContain('data-setting-id="water.waterSmallWaveStrength"');
    expect(render('realistic')).toContain('data-setting-id="water.waterDioramaTint"');
    expect(render('stylized')).not.toContain('data-setting-id="water.waterDioramaTint"');
    expect(render('stylized')).not.toContain('data-setting-id="water.waterSmallWaveStrength"');
  });
  it('offers the diorama controls for the classic Stylized water mode', () => {
    const html = renderToStaticMarkup(<WaterPanel worldMode="studio"
      params={{ ...WATER_DEFAULT_PARAMS, seaLevel: 40, waterMode: 'stylized' }} perf={{}}
      onParam={() => {}} planetStyleProps={{ onColorChange: () => {} }} />);
    expect(html).toContain('data-setting-id="water.waterDioramaReflections"');
  });
});
