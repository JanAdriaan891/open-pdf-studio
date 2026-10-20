// Page engine choice (#625): which Rust engine renders the PAGE itself —
// PDFium, Hayro (pure Rust), or automatic (default): Hayro for heavy pages,
// PDFium for the rest. Annotations are always drawn by the app. The resolved
// engine travels with every render command (`engine`; Rust only ever sees
// 'pdfium' or 'hayro'), and every bitmap cache keys on the preference (via
// thinLinesKey), so switching never shows a bitmap the other engine drew.

import { state } from '../core/state.js';

/**
 * Content-stream size from which automatic picks Hayro. Measured on the
 * verification set: from 0.5 MB on, Hayro rendered all 35 pages faster than
 * PDFium (0.2-0.66x the time); below it the two are close and PDFium is the
 * proven route.
 */
export const HEAVY_CONTENT_BYTES = 512 * 1024;

/** The engine preference: 'pdfium', 'hayro' or 'auto' (default). */
export function renderEngineOn(prefs = state.preferences) {
  const v = prefs && prefs.renderEngine;
  return v === 'pdfium' || v === 'hayro' ? v : 'auto';
}

/** The engine for a page with `contentBytes` of content under preference `pref`. */
export function engineForContent(pref, contentBytes) {
  if (pref !== 'auto') return pref;
  return contentBytes >= HEAVY_CONTENT_BYTES ? 'hayro' : 'pdfium';
}

// Automatic choice per page, filled by resolvePageEngine.
const _autoChoice = new Map();

// Pages Hayro refused (HAYRO_UNSUPPORTED: e.g. hundreds of mesh shadings
// that would need gigabytes). They are rendered with PDFium from then on, and
// the status bar shows PDFium for them, because that is what drew them.
const _pdfiumPages = new Set();

/** Whether a render error is Hayro refusing the page (not a real failure). */
export function isHayroUnsupported(err) {
  return String(err?.message ?? err).includes('HAYRO_UNSUPPORTED');
}

/**
 * The engine that will actually draw this page ('pdfium' or 'hayro'): an
 * automatic choice already made for it (PDFium until measured), and PDFium
 * for a page Hayro refused.
 */
export function engineForPage(engine, path, pageIndex) {
  const key = `${path}|${pageIndex}`;
  const eng = engine === 'auto' ? (_autoChoice.get(key) || 'pdfium') : engine;
  return eng === 'hayro' && _pdfiumPages.has(key) ? 'pdfium' : eng;
}

/** Resolve the preference for one page, measuring its content for 'auto'. */
export async function resolvePageEngine(engine, path, pageIndex) {
  if (engine === 'auto') {
    const key = `${path}|${pageIndex}`;
    if (!_autoChoice.has(key)) {
      const { pageContentBytes } = await import('./progressive-render.js');
      _autoChoice.set(key, engineForContent('auto', await pageContentBytes(path, pageIndex + 1)));
    }
  }
  return engineForPage(engine, path, pageIndex);
}

/**
 * Run a render with the page's engine; when Hayro refuses the page, remember
 * that and run it again with PDFium. Other errors are passed on unchanged.
 */
export async function withPageEngine(engine, path, pageIndex, run) {
  const eng = await resolvePageEngine(engine, path, pageIndex);
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
