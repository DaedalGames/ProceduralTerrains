import { TerrainExportBuilder } from './TerrainExportBuilder.js';
import { saveBlob } from '../../platform/DesktopBridge.js';
import { zipSync } from 'fflate';
export { buildTerrainBakeFragment } from './TerrainExportBuilder.js';

// Studio adapter: reusable builders return artifacts; only this layer saves them.
export class TerrainExporter {
  static async export(...args) {
    const result = await TerrainExportBuilder.build(...args);
    const onToast = args[5] ?? (() => {});
    if (Object.keys(result.files).length) {
      onToast('Compressing terrain package (ZIP)...');
      const zipped = zipSync(result.files);
      onToast(`Saving terrain package (${(zipped.byteLength / 1e6).toFixed(1)} MB)...`);
      const saved = await saveBlob(
        new Blob([zipped], { type: 'application/zip' }),
        result.filename,
      );
      if (saved?.canceled) throw new Error('Export save was canceled');
    }
    onToast('Export completed successfully!');
  }
}
