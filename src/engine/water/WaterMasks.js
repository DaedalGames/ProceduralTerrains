export * from './WaterMaskArtifacts.js';
import { maskToPngBytes } from './WaterMaskArtifacts.js';
import { saveBlob } from '../../platform/DesktopBridge.js';
export async function downloadMaskPng(mask, resolution, filename, opts) {
  return saveBlob(
    new Blob([await maskToPngBytes(mask, resolution, opts)], { type: 'image/png' }),
    filename,
  );
}
