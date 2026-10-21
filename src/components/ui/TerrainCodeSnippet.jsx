import { useEffect, useState } from 'react';
import { RefreshCw } from 'lucide-react';
import { translateText as t, useLanguage } from '../../i18n/LanguageContext.jsx';
import CodeBlock from '../../docs/CodeBlock.jsx';

export default function TerrainCodeSnippet({ generateCode, revision }) {
  useLanguage();
  const [snippet, setSnippet] = useState(null);
  const [busy, setBusy] = useState(true);
  const [error, setError] = useState(false);
  const [refresh, setRefresh] = useState(0);
  useEffect(() => {
    let cancelled = false;
    setBusy(true);
    setError(false);
    // Wait until slider/graph edits settle before serializing the live project.
    const timer = setTimeout(async () => {
      try {
        const next = await generateCode();
        if (!cancelled) setSnippet(next);
      } catch {
        if (!cancelled) setError(true);
      } finally {
        if (!cancelled) setBusy(false);
      }
    }, 200);
    return () => { cancelled = true; clearTimeout(timer); };
  }, [generateCode, revision, refresh]);

  return (
    <div className="terrain-code-snippet" aria-busy={busy}>
      <p className="settings-hint">{t('Copy the current terrain into your Three.js application, or use the complete example as main.js in a Vite project.')}</p>
      <CodeBlock code="npm install procedural-terrains" lang="sh" caption={t('Installation')} />
      <div className="terrain-code-toolbar">
        <span role="status">{busy ? t('Updating code…') : error ? t('Unable to generate terrain code.') : t('Code matches the current terrain settings.')}</span>
        <button type="button" className="action-btn" onClick={() => setRefresh((value) => value + 1)} disabled={busy}>
          <RefreshCw size={12} aria-hidden /> {t('Refresh code')}
        </button>
      </div>
      {!error && snippet && <CodeBlock copyDisabled={busy} tabs={[
        { label: t('In your scene'), code: snippet.code, lang: 'js' },
        { label: t('Complete example'), code: snippet.standaloneCode, lang: 'js' },
      ]} />}
      <p className="settings-hint">{t('In your scene: call renderTerrain(deltaSeconds) each frame and disposeTerrain() on cleanup. The complete example includes its own camera and rendering loop.')}</p>
      {!busy && !error && snippet?.warnings?.length > 0 && (
        <details className="terrain-code-notes">
          <summary>{t('Conversion notes')} ({snippet.warnings.length})</summary>
          <ul>{snippet.warnings.map((warning) => <li key={warning}>{t(warning)}</li>)}</ul>
        </details>
      )}
      <a href="#/docs/code-export" target="_blank" rel="noopener noreferrer">{t('Documentation')}</a>
    </div>
  );
}
