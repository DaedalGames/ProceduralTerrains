import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Check, Download, Eraser, Link2, LoaderCircle, Play, RotateCcw, ShieldCheck, Square, Terminal } from 'lucide-react';
import { translateText as t, useLanguage } from '../../i18n/LanguageContext.jsx';
import { copyText } from '../clipboard.js';
import CodeEditor from './CodeEditor.jsx';
import { DEFAULT_TEMPLATE, PLAYGROUND_TEMPLATES } from './templates.js';
import { buildDocument, buildStandalone, codeFromHash, loadPlaygroundRuntime, playgroundHref } from './runner.js';

const DRAFT_KEY = 'procedural-terrains:docs-playground:v1';
function initialState() {
  const shared = codeFromHash();
  if (shared !== null) return { code: shared, template: null, shared: true };
  try {
    const draft = JSON.parse(localStorage.getItem(DRAFT_KEY) ?? 'null');
    if (typeof draft?.code === 'string' && draft.code.length <= 100000)
      return { code: draft.code, template: PLAYGROUND_TEMPLATES.some((item) => item.id === draft.template) ? draft.template : null };
  } catch { /* use the default template */ }
  return { code: DEFAULT_TEMPLATE.code, template: DEFAULT_TEMPLATE.id };
}
const newRun = (code) => ({ code, token: crypto.randomUUID() });

export default function Playground() {
  useLanguage();
  const [initial] = useState(initialState);
  const [{ code, template }, setState] = useState(initial);
  const [run, setRun] = useState(() => initial.shared ? null : newRun(initial.code));
  const [approved, setApproved] = useState(!initial.shared);
  const [status, setStatus] = useState(initial.shared ? 'idle' : 'running');
  const [logs, setLogs] = useState([]);
  const [linkCopied, setLinkCopied] = useState(false);
  const [downloading, setDownloading] = useState(false);
  const frameRef = useRef(null);
  const logRef = useRef(null);
  const copyTimer = useRef(null);
  const activeToken = useRef(run?.token);
  activeToken.current = run?.token;
  const srcDoc = useMemo(() => run ? buildDocument(run.code, run.token) : '', [run]);
  const errorLine = [...logs].reverse().find((entry) => entry.level === 'error' && entry.line)?.line;
  const addError = useCallback((error) => {
    setStatus('error');
    setLogs((items) => [...items.slice(-199), { level: 'error', text: error.message || String(error) }]);
  }, []);
  const deliverRuntime = useCallback(async () => {
    const token = run?.token;
    if (!token) return;
    try {
      const runtime = await loadPlaygroundRuntime();
      if (activeToken.current === token)
        frameRef.current?.contentWindow?.postMessage({ __playground: token, type: 'runtime', runtime }, '*');
    } catch (error) { if (activeToken.current === token) addError(error); }
  }, [run?.token, addError]);

  useEffect(() => {
    const onMessage = (event) => {
      if (!run || event.source !== frameRef.current?.contentWindow) return;
      const data = event.data;
      if (!data || data.__playground !== run.token) return;
      if (data.type === 'boot') { void deliverRuntime(); return; }
      if (data.type === 'ready') { setStatus((value) => value === 'error' ? value : 'ready'); return; }
      if (!['log', 'info', 'warn', 'error'].includes(data.type)) return;
      if (data.type === 'error') setStatus('error');
      const text = (Array.isArray(data.args) ? data.args.slice(0, 8) : []).map(String).join(' ').slice(0, 8000);
      const line = Number.isInteger(data.line) && data.line > 0 && data.line <= run.code.split('\n').length ? data.line : null;
      setLogs((items) => [...items.slice(-199), { level: data.type, text, line }]);
    };
    window.addEventListener('message', onMessage);
    return () => window.removeEventListener('message', onMessage);
  }, [run, deliverRuntime]);
  useEffect(() => {
    const onHash = () => {
      const shared = codeFromHash();
      if (shared === null) return;
      setState({ code: shared, template: null });
      setApproved(false); setRun(null); setLogs([]); setStatus('idle');
    };
    window.addEventListener('hashchange', onHash);
    return () => window.removeEventListener('hashchange', onHash);
  }, []);
  useEffect(() => {
    if (!approved) return;
    const timer = setTimeout(() => {
      try { localStorage.setItem(DRAFT_KEY, JSON.stringify({ code, template })); } catch { /* session only */ }
    }, 400);
    return () => clearTimeout(timer);
  }, [code, template, approved]);
  useEffect(() => {
    if (logRef.current) logRef.current.scrollTop = logRef.current.scrollHeight;
  }, [logs]);
  useEffect(() => () => clearTimeout(copyTimer.current), []);

  const execute = (source = code) => {
    setApproved(true); setLogs([]); setStatus('running'); setRun(newRun(source));
  };
  const pickTemplate = (id) => {
    const next = PLAYGROUND_TEMPLATES.find((item) => item.id === id);
    if (!next) return;
    setState({ code: next.code, template: next.id });
    execute(next.code);
  };
  const share = async () => {
    try {
      const href = playgroundHref(code);
      const url = location.origin + location.pathname + href;
      history.replaceState(null, '', url);
      await copyText(url);
      setLinkCopied(true); clearTimeout(copyTimer.current);
      copyTimer.current = setTimeout(() => setLinkCopied(false), 1800);
    } catch (error) { addError(error); }
  };
  const download = async () => {
    setDownloading(true);
    try {
      const runtime = await loadPlaygroundRuntime();
      const url = URL.createObjectURL(new Blob([buildStandalone(code, runtime)], { type: 'text/html' }));
      const link = document.createElement('a');
      link.href = url; link.download = 'procedural-terrain-playground.html'; link.click();
      setTimeout(() => URL.revokeObjectURL(url), 1000);
    } catch (error) { addError(error); }
    finally { setDownloading(false); }
  };

  return (
    <div className="pg" data-status={status}>
      <header className="docs-page-head">
        <span className="docs-eyebrow">{t('Get started')}</span>
        <h1>{t('Playground')}</h1>
        <p>{t('Edit the terrain code and run it to see the result here. Start from an example, share your code or download a standalone HTML page.')}</p>
      </header>
      <div className="pg-toolbar">
        <label className="pg-select"><span>{t('Template')}</span>
          <select value={template ?? ''} onChange={(event) => pickTemplate(event.target.value)}>
            {!template && <option value="">{t('Custom code')}</option>}
            {PLAYGROUND_TEMPLATES.map((item) => <option key={item.id} value={item.id}>{t(item.title)}</option>)}
          </select>
        </label>
        <button type="button" className="docs-btn" onClick={() => execute()} title="Ctrl+Enter">
          <Play size={13} aria-hidden />{t('Run')} <kbd>Ctrl ↵</kbd>
        </button>
        <button type="button" className="docs-btn ghost" onClick={() => { setRun(null); setStatus('stopped'); }} disabled={!run}>
          <Square size={12} aria-hidden />{t('Stop')}
        </button>
        <button type="button" className="docs-btn ghost" onClick={() => pickTemplate(template ?? DEFAULT_TEMPLATE.id)}>
          <RotateCcw size={13} aria-hidden />{t('Reset')}
        </button>
        <span className="pg-toolbar-spacer" />
        <button type="button" className="docs-btn ghost" onClick={share}>
          {linkCopied ? <Check size={13} aria-hidden /> : <Link2 size={13} aria-hidden />}{t(linkCopied ? 'Link copied' : 'Share')}
        </button>
        <button type="button" className="docs-btn ghost" onClick={download} disabled={downloading}>
          <Download size={13} aria-hidden />{t('Download .html')}
        </button>
      </div>
      <div className="pg-layout">
        <CodeEditor value={code} onChange={(next) => setState((state) => ({ ...state, code: next }))} onRun={() => execute()} label={t('Playground code')} errorLine={errorLine} />
        <div className="pg-output">
          <div className="pg-frame">
            {run ? <iframe key={run.token} ref={frameRef} title={t('Playground output')} sandbox="allow-scripts" srcDoc={srcDoc} onLoad={deliverRuntime} />
              : <div className="pg-placeholder">{t('Press Run to preview the terrain.')}</div>}
            {status === 'running' && <div className="docs-live-status" role="status"><LoaderCircle size={15} className="docs-spin" aria-hidden />{t('Running…')}</div>}
            <span className={'pg-state ' + status} role="status">{t({ running: 'Running…', ready: 'Ready', error: 'Error', idle: 'Ready to run', stopped: 'Stopped' }[status])}</span>
          </div>
          <section className="pg-console" aria-label={t('Console')}>
            <header><span><Terminal size={13} aria-hidden />{t('Console')}</span>
              <button type="button" className="docs-copy" onClick={() => setLogs([])} disabled={!logs.length}><Eraser size={12} aria-hidden /><span>{t('Clear')}</span></button>
            </header>
            <div className="pg-logs" ref={logRef} role="log" aria-live="polite">
              {!logs.length && <p className="pg-log-empty">{t('console.log() output appears here.')}</p>}
              {logs.map((entry, index) => <pre key={index} className={'pg-log ' + entry.level}>{entry.line ? t('Line {0}: ', { 0: entry.line }) : ''}{entry.text}</pre>)}
            </div>
          </section>
          <p className="pg-note"><ShieldCheck size={13} aria-hidden />{t('Runs the local npm runtime in an isolated preview. Your draft is saved on this device.')}</p>
        </div>
      </div>
      <p className="pg-help">{t('Ctrl+Enter runs the code. Escape then Tab leaves the editor. Shared code runs only when you press Run.')}</p>
    </div>
  );
}
