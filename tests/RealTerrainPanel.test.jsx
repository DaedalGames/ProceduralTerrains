import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { expect, it } from 'vitest';
import { renderPanel } from '../src/components/panels/index.jsx';
import { normalizeMarkers } from '../src/engine/terrain/RealWorldMarkers.js';

it('keeps height and noise scale available in the Real Terrain tool', () => {
  const html = renderToStaticMarkup(renderPanel('terrain', {
    realTerrainMode: true, worldMode: 'studio', params: { heightScale: 300, noiseScale: 48 }, perf: {},
  }));
  expect(html).toContain('Height Scale');
  expect(html).toContain('terrain.heightScale');
  expect(html).toContain('Noise Scale');
  expect(html).toContain('terrain.noiseScale');
  expect(html).toContain('Select Area on Map');
  expect(html).not.toContain('Close map picker');
});

it('shows the city fetch action before automatic markers are enabled', () => {
  const html = renderToStaticMarkup(renderPanel('markers', { realWorldMarkers: normalizeMarkers() }));
  expect(html).toContain('Fetch city names and show markers');
});

it('exposes the shared terrain resolution and detail controls beside the imported resolution', () => {
  const html = renderToStaticMarkup(renderPanel('terrain', {
    realTerrainMode: true, worldMode: 'studio', params: { heightScale: 420, noiseScale: 48 },
    perf: { resolutionScale: 1.25, terrainDetailQuality: 2 },
    importedMaps: { height: { width: 874, height: 478, settings: { mode: 'replace' },
      geographic: { bbox: { minLat: 45.78, maxLat: 45.92, minLon: 6.79, maxLon: 6.95 }, zoom: 12 } } },
  }));
  expect(html).toContain('874×478');
  expect(html).toContain('Terrain Resolution');
  expect(html).toContain('performance.resolutionScale');
  expect(html).toContain('value="1.25 ×"');
  expect(html).toContain('terrain.surfaceResolution');
  expect(html).toContain('Surface Resolution');
  expect(html).toContain('Reload geographic textures');
  expect(html).toContain('matching Terrain detail in the map picker');
  expect(html).not.toContain('Quality · up to 2K');
  expect(html).toContain('performance.terrainDetailQuality');
  expect(html).toContain('<option value="2" selected="">Medium</option>');
  expect(html).toContain('keeps its source resolution');
});

it('shows real altitude controls and source elevations for a geographic heightmap', () => {
  const html = renderToStaticMarkup(renderPanel('terrain', {
    realTerrainMode: true, worldMode: 'studio', params: { heightScale: 420, noiseScale: 48 }, perf: {},
    importedMaps: { height: { elevation: { min: -430, max: 8850 }, settings: { elevationMode: 'meters', mode: 'replace' } } },
  }));
  expect(html).toContain('True elevation (meters)');
  expect(html).toContain('terrain.realWorldElevation');
  expect(html).toContain('-430');
  expect(html).toContain('8850');
  expect(html).toContain('Real elevations active');
  expect(html).toContain('terrain.activeElevation');
  expect(html).toContain('terrain.realWorldVerticalScale');
  expect(html).toContain('Vertical Scale');
  expect(html).not.toContain('data-setting-id="terrain.heightScale"');
});

it.each(['disabled', 'preview'])('does not claim real elevations are active in %s mode', (mode) => {
  const html = renderToStaticMarkup(renderPanel('terrain', {
    realTerrainMode: true, worldMode: 'studio', params: { heightScale: 420, noiseScale: 48 }, perf: {},
    importedMaps: { height: { elevation: { min: 10, max: 3000 }, settings: { elevationMode: 'meters', mode } } },
  }));
  expect(html).not.toContain('Real elevations active');
  expect(html).toContain('data-setting-id="terrain.heightScale"');
});

it('identifies the noise height control when real elevations are blended', () => {
  const html = renderToStaticMarkup(renderPanel('terrain', {
    realTerrainMode: true, worldMode: 'studio', params: { heightScale: 420, noiseScale: 48 }, perf: {},
    importedMaps: { height: { elevation: { min: 10, max: 3000 }, settings: { elevationMode: 'meters', mode: 'blend', blend: 0.5 } } },
  }));
  expect(html).toContain('Real elevations active');
  expect(html).toContain('Noise Height Scale');
  expect(html).toContain('blended with procedural noise');
});

it('shows the current vertical reduction beside the unmodified source elevation range', () => {
  const html = renderToStaticMarkup(renderPanel('terrain', {
    realTerrainMode: true, worldMode: 'studio', params: { heightScale: 420, noiseScale: 48 }, perf: {},
    importedMaps: { height: { elevation: { min: 10, max: 8850 },
      settings: { elevationMode: 'meters', mode: 'replace', heightStrength: 0.1 } } },
  }));
  expect(html).toContain('terrain.realWorldVerticalScale');
  expect(html).toContain('value="0.10 ×"');
  expect(html).toContain('Source elevations are preserved in meters');
  expect(html).not.toContain('data-setting-id="terrain.heightScale"');
});
