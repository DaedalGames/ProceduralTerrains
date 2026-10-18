import { PlanetExportBuilder } from './PlanetExportBuilder.js';
import { saveBlob } from '../../platform/DesktopBridge.js';
import { zipSync } from 'fflate';

// Studio adapter: reusable builders return artifacts; only this layer saves them.
export class PlanetExporter {
  static async export(...args) {
    const result = await PlanetExportBuilder.build(...args);
    const onToast = args[4] ?? (() => {});
    if (Object.keys(result.files).length) {
      onToast('Compressing planet package (ZIP)...');
      const zipped = zipSync(result.files);
      onToast(`Saving planet package (${(zipped.byteLength / 1e6).toFixed(1)} MB)...`);
      const saved = await saveBlob(
        new Blob([zipped], { type: 'application/zip' }),
        result.filename,
      );
      if (saved?.canceled) throw new Error('Export save was canceled');
    }
    onToast('Planet export complete!');
  }
}
