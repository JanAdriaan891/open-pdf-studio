// Page engine choice (#625): which Rust engine renders the PAGE itself —
// PDFium (default) or Hayro (pure Rust). Annotations are always drawn by the
// app. The choice travels with every render command (`engine`), and every
// bitmap cache keys on it (via thinLinesKey), so switching never shows a
// bitmap the other engine drew.

import { state } from '../core/state.js';

/** The selected page engine: 'hayro' only when chosen, else 'pdfium'. */
export function renderEngineOn(prefs = state.preferences) {
  return prefs && prefs.renderEngine === 'hayro' ? 'hayro' : 'pdfium';
}

// Pages Hayro refused (HAYRO_UNSUPPORTED: e.g. hundreds of mesh shadings
// that would need gigabytes). They are rendered with PDFium from then on, and
// the status bar shows PDFium for them, because that is what drew them.
const _pdfiumPages = new Set();

/** Whether a render error is Hayro refusing the page (not a real failure). */
export function isHayroUnsupported(err) {
  return String(err?.message ?? err).includes('HAYRO_UNSUPPORTED');
}

/** The engine that will actually draw this page. */
export function engineForPage(engine, path, pageIndex) {
  return engine === 'hayro' && _pdfiumPages.has(`${path}|${pageIndex}`) ? 'pdfium' : engine;
}

/**
 * Run a render with the page's engine; when Hayro refuses the page, remember
 * that and run it again with PDFium. Other errors are passed on unchanged.
 */
export async function withPageEngine(engine, path, pageIndex, run) {
  const eng = engineForPage(engine, path, pageIndex);
  try {
    return await run(eng);
  } catch (err) {
    if (eng !== 'hayro' || !isHayroUnsupported(err)) throw err;
    console.warn(`[render-engine] Hayro refused p${pageIndex + 1} of ${path}: ${String(err?.message ?? err).slice(0, 160)} — PDFium renders it`);
    _pdfiumPages.add(`${path}|${pageIndex}`);
    return run('pdfium');
  }
}

/** Human-readable engine name for diagnostics (MCP viewport state, logs). */
export function renderEngineLabel(engine = renderEngineOn()) {
  return engine === 'hayro' ? 'Hayro' : 'PDFium';
}

/** Label of the engine that actually draws this page (after a Hayro refusal: PDFium). */
export function pageEngineLabel(path, pageIndex) {
  return renderEngineLabel(engineForPage(renderEngineOn(), path, pageIndex));
}
