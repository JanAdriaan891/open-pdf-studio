// Laadhaken om de echte plugin-api.js onder node te laden (#550/#551): de
// zware app-modules die zij importeert (state, gereedschap, tekenen, undo,
// paginatoegang, het eigenschappenpaneel) worden kleine stubs. De registers
// (annotatietypen, paletten, panelen, selectieluisteraars, gereedschapsgroepen,
// lint en opdrachten) blijven echt. setNativePanelHidden telt zijn aanroepen in
// globalThis.__nativePaneelVerborgen.
//
// Gebruik: register('./plugin-api-stubs.mjs', import.meta.url) en daarna de
// modules met een dynamische import() laden.

import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

const JS = new URL('../', import.meta.url).href;

const STUBS = {
  'core/state.js': 'export const state = { preferences: {} }; export const getActiveDocument = () => null; export const getPageRotation = () => 0; export const getAnnotationBounds = () => null;',
  'tools/manager.js': 'export const setTool = () => {};',
  'annotations/factory.js': 'export const createAnnotation = (x) => x;',
  'annotations/rendering.js': 'export const redrawAnnotations = () => {};',
  'core/undo-manager.js': 'export const beginUndoTransaction = () => {}, endUndoTransaction = () => {}, recordAdd = () => {}, recordModify = () => {}, recordDelete = () => {};',
  'plugins/page-access.js': 'export const getPageInfoForDocument = () => null, readPageContentForDocument = () => null, renderPageTileForDocument = () => null;',
  'tools/pdf-snap-extractor.js': 'export const extractPageGeometry = () => null;',
  'annotations/schaal-op-punt.js': 'export const schaalOpPunt = () => null;',
  'annotations/scale-region.js': 'export const getScaleFromRegion = () => null;',
  'annotations/systeem-geometrie-app.js': 'export const systeemInstanceGeometrie = () => null;',
  'solid/stores/propertiesStore.js': 'export const setNativePanelHidden = (v) => { (globalThis.__nativePaneelVerborgen ??= []).push(v); };',
};

const zonderQuery = (url) => url.split('?')[0];

function stubVoor(url) {
  const u = zonderQuery(url);
  if (!u.startsWith(JS)) return null;
  return STUBS[u.slice(JS.length)] ?? null;
}

// Een stub hoeft niet te bestaan (core/state.js is in de app state.ts).
export async function resolve(specifier, context, nextResolve) {
  if (specifier.startsWith('.') && context.parentURL?.startsWith(JS)) {
    const url = new URL(specifier, context.parentURL).href;
    if (stubVoor(url) !== null) return { url, shortCircuit: true };
  }
  return nextResolve(specifier, context);
}

export async function load(url, context, nextLoad) {
  const stub = stubVoor(url);
  if (stub !== null) return { format: 'module', source: stub, shortCircuit: true };
  // Het package.json van de app zegt geen "type": "module": de .js-bestanden
  // onder js/ zelf als module laden.
  const u = zonderQuery(url);
  if (u.startsWith(JS) && u.endsWith('.js')) {
    return { format: 'module', source: readFileSync(fileURLToPath(u), 'utf8'), shortCircuit: true };
  }
  return nextLoad(url, context);
}
