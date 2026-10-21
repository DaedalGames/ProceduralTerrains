import React from 'react';
import { createRoot } from 'react-dom/client';
import { createEngineProxy } from '/src/engine/EngineProxy.js';
import { createPerfSettings } from '/src/engine/render/PerformanceSettings.js';
import TouchControls from '/src/components/TouchControls.jsx';
import '/src/styles.css';

let resolveBoot;
window.__booted = new Promise((resolve) => { resolveBoot = resolve; });
const engine = await createEngineProxy({
  canvas: document.getElementById('c'),
  initialView: 'editor',
  initialPerf: { ...createPerfSettings('low'), useWorker: true, energyMode: 'off', autoPerf: false },
  callbacks: {
    onBootComplete: () => resolveBoot(),
    onInfiniteStats: (stats) => { window.__stats = stats; },
  },
});
window.__engine = engine;
const root = createRoot(document.getElementById('controls'));
window.__setMode = async (mode) => {
  await engine.setExploreMode(mode);
  root.render(<TouchControls key={`${engine.worldMode}:${mode}`} mode={mode} onInput={(input) => engine.setTouchInput(input)} />);
};
