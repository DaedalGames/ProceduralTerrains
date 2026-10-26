import React, { useEffect, useState } from 'react';
import { translateText, useLanguage } from '../../i18n/LanguageContext.jsx';
import { CUSTOM_AREA_LIMITS, describeRealWorldArea } from '../../engine/terrain/RealWorldHeightmap.js';
import { SliderCtl } from '../controls.jsx';

export default function SurfaceResolutionSetting({ map, onResolution }) {
  useLanguage();
  const geographic = map?.geographic;
  const [zoom, setZoom] = useState(geographic?.zoom ?? 12);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const bboxKey = JSON.stringify(geographic?.bbox);
  useEffect(() => { setZoom(geographic?.zoom ?? 12); setError(''); }, [geographic?.zoom, bboxKey]);
  const info = geographic ? describeRealWorldArea({ bbox: geographic.bbox, zoom }) : null;
  const reload = async () => {
    if (!info || busy || info.zoom === geographic.zoom) return;
    setBusy(true); setError('');
    try {
      const loaded = await onResolution(info.zoom);
      if (loaded === false) setError('Could not reload geographic resolution.');
    } catch (cause) {
      setError(cause?.message || 'Could not reload geographic resolution.');
    } finally { setBusy(false); }
  };
  return <>
    <SliderCtl def={{ label: 'Surface Resolution', ...CUSTOM_AREA_LIMITS.zoom, digits: 0,
      info: 'Geographic tile zoom, matching Terrain detail in the map picker. Reloads real elevation and imagery.' }}
      value={zoom} onChange={setZoom} disabled={!geographic || busy || map?.loading}
      disabledTooltip={translateText('Load a real-world area to adjust its surface resolution.')}
      settingId="terrain.surfaceResolution" />
    {info && <>
      <div className="stat-row"><span className="stat-label">{translateText('Effective zoom')}</span>
        <span className="stat-value stat-mono">z{info.zoom}</span></div>
      <div className="stat-row"><span className="stat-label">{translateText('Output resolution')}</span>
        <span className="stat-value stat-mono">{info.outW}×{info.outH}</span></div>
      {info.zoomClamped && <p className="section-hint">{translateText('Detail is limited by the selected area. Reduce the area size for sharper geographic tiles.')}</p>}
      <button type="button" className="action-btn" disabled={busy || map?.loading || info.zoom === geographic.zoom}
        onClick={reload}>{translateText(busy ? 'Loading terrain…' : 'Reload geographic textures')}</button>
    </>}
    <p className="section-hint">{translateText('Changes the real elevation and imagery tiles for the same area. Apply to download the new resolution.')}</p>
    {error && <p className="section-hint import-map-error" role="alert">{translateText(error)}</p>}
  </>;
}
