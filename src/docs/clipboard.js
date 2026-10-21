export async function copyText(text) {
  if (navigator.clipboard?.writeText) {
    try { await navigator.clipboard.writeText(text); return; } catch { /* try the legacy fallback */ }
  }
  const input = document.createElement('textarea');
  input.value = text;
  input.style.cssText = 'position:fixed;opacity:0;pointer-events:none';
  document.body.appendChild(input);
  input.select();
  try {
    if (!document.execCommand('copy')) throw new Error('Clipboard unavailable');
  } finally { input.remove(); }
}

