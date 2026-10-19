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

/** Human-readable engine name for diagnostics (MCP viewport state, logs). */
export function renderEngineLabel(engine = renderEngineOn()) {
  return engine === 'hayro' ? 'Hayro' : 'PDFium';
}
