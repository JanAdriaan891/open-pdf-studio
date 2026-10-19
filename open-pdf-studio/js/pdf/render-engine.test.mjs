// Page engine choice (#625, M1): the preference must reach every render path
// of the page itself, the scene engine is PDFium-only, and no cache may hand
// back a bitmap the other engine drew.

import assert from 'node:assert/strict';
import test from 'node:test';
import { register } from 'node:module';

register('../core/app-test-hooks.mjs', import.meta.url);
const { installeerBrowserStubs } = await import('../core/app-test-hooks.mjs');
installeerBrowserStubs();

const calls = [];
function wire(w = 2, h = 1) {
  const out = new Uint8Array(8 + w * h * 4);
  const dv = new DataView(out.buffer);
  dv.setUint32(0, w, true);
  dv.setUint32(4, h, true);
  return out;
}
// A page large enough that the scene engine would be tried for PDFium.
let contentBytes = 0;
globalThis.__TAURI__ = {
  core: {
    invoke: async (cmd, args) => {
      calls.push({ cmd, args });
      if (cmd === 'page_content_size') return contentBytes;
      if (args?.engine === 'hayro' && String(args.path).startsWith('mesh')) {
        throw 'hayro worker render failed: HAYRO_UNSUPPORTED: page uses 576 mesh or function shadings (limit 64)';
      }
      return wire();
    },
  },
};
globalThis.ImageData ??= class ImageData {
  constructor(data, width, height) { this.data = data; this.width = width; this.height = height; }
};
globalThis.createImageBitmap ??= async (src) => ({ width: src.width, height: src.height, close() {} });

const { state } = await import('../core/state.js');
const { renderEngineOn, engineForPage } = await import('./render-engine.js');
const { thinLinesKey } = await import('./thin-lines.js');
const { renderPdfPage } = await import('./engine-router.js');
const tc = await import('./tile-cache.js');
const { invokeTileRegion, usesSceneEngine } = await import('./progressive-render.js');
const { DEFAULT_PREFERENCES } = await import('../core/constants.js');

function setEngine(engine) { state.preferences.renderEngine = engine; }

test('the default engine is PDFium; only "hayro" selects Hayro', () => {
  assert.equal(DEFAULT_PREFERENCES.renderEngine, 'pdfium');
  assert.equal(renderEngineOn({ renderEngine: 'hayro' }), 'hayro');
  assert.equal(renderEngineOn({ renderEngine: 'pdfium' }), 'pdfium');
  assert.equal(renderEngineOn({ renderEngine: 'other' }), 'pdfium');
  assert.equal(renderEngineOn({}), 'pdfium');
  assert.equal(renderEngineOn(null), 'pdfium');
});

test('a whole-page render sends the engine to Rust', async () => {
  calls.length = 0;
  setEngine('hayro');
  await renderPdfPage({ path: 'a.pdf', pageIndex: 0, scale: 1, rotation: 0 });
  setEngine('pdfium');
  await renderPdfPage({ path: 'a.pdf', pageIndex: 0, scale: 1, rotation: 0 });
  assert.deepEqual(calls.map((c) => [c.cmd, c.args.engine]), [
    ['render_pdf_page', 'hayro'],
    ['render_pdf_page', 'pdfium'],
  ]);
  // An explicit engine (captured when a render started) wins over the preference.
  calls.length = 0;
  await renderPdfPage({ path: 'a.pdf', pageIndex: 0, scale: 1, rotation: 0, engine: 'hayro' });
  assert.equal(calls[0].args.engine, 'hayro');
});

test('the scene engine is a PDFium-route optimisation only', () => {
  const heavy = 50 * 1024 * 1024;
  assert.equal(usesSceneEngine('pdfium', heavy), true);
  assert.equal(usesSceneEngine('hayro', heavy), false);
  assert.equal(usesSceneEngine('pdfium', 1024), false);
});

test('a tile render with Hayro sends the engine', async () => {
  contentBytes = 50 * 1024 * 1024;
  calls.length = 0;
  setEngine('hayro');
  await invokeTileRegion({
    path: 'big.pdf', pageIndex: 0, scale: 2, rotation: 0,
    regionXPt: 0, regionYPt: 0, regionWPt: 100, regionHPt: 100,
  });
  setEngine('pdfium');
  const cmds = calls.filter((c) => c.cmd !== 'page_content_size');
  assert.deepEqual(cmds.map((c) => [c.cmd, c.args.engine]), [['render_pdf_page_region', 'hayro']]);
  contentBytes = 0;
});

test('a tile render keeps the engine it was started with', async () => {
  calls.length = 0;
  setEngine('pdfium');
  await invokeTileRegion({
    path: 'a.pdf', pageIndex: 0, scale: 2, rotation: 0,
    regionXPt: 0, regionYPt: 0, regionWPt: 100, regionHPt: 100, engine: 'hayro',
  });
  const region = calls.find((c) => c.cmd === 'render_pdf_page_region');
  assert.equal(region.args.engine, 'hayro');
});

test('cache keys differ per engine', async () => {
  assert.notEqual(thinLinesKey(false, 'pdfium'), thinLinesKey(false, 'hayro'));
  assert.notEqual(thinLinesKey(true, 'pdfium'), thinLinesKey(true, 'hayro'));
  // PDFium keys are unchanged, so existing cache keys stay valid.
  assert.equal(thinLinesKey(false, 'pdfium'), 'true');
  assert.equal(thinLinesKey(true, 'pdfium'), 'thin');

  const img = new ImageData(new Uint8ClampedArray(4), 1, 1);
  tc.tileCacheClearAll();
  await tc.tileCacheSet('a.pdf', 1, 2, 0, '0,0', img, { thinLines: false, engine: 'hayro' });
  setEngine('pdfium');
  assert.equal(tc.tileCacheGet('a.pdf', 1, 2, 0, '0,0', false), null, 'no Hayro tile for PDFium');
  setEngine('hayro');
  assert.notEqual(tc.tileCacheGet('a.pdf', 1, 2, 0, '0,0', false), null);
  setEngine('pdfium');
  tc.tileCacheClearAll();
});

test('a page Hayro refuses is rendered with PDFium, and stays with PDFium', async () => {
  calls.length = 0;
  setEngine('hayro');
  const out = await renderPdfPage({ path: 'mesh.pdf', pageIndex: 0, scale: 1, rotation: 0 });
  assert.ok(out.length > 8, 'a bitmap comes back');
  assert.deepEqual(calls.map((c) => c.args.engine), ['hayro', 'pdfium']);
  assert.equal(engineForPage('hayro', 'mesh.pdf', 0), 'pdfium');
  assert.equal(engineForPage('hayro', 'mesh.pdf', 1), 'hayro', 'other pages keep Hayro');
  calls.length = 0;
  await renderPdfPage({ path: 'mesh.pdf', pageIndex: 0, scale: 2, rotation: 0 });
  assert.deepEqual(calls.map((c) => c.args.engine), ['pdfium'], 'no second Hayro attempt');
  setEngine('pdfium');
});

test('a tile of a page Hayro refuses is rendered with PDFium', async () => {
  calls.length = 0;
  setEngine('hayro');
  await invokeTileRegion({
    path: 'mesh-tiles.pdf', pageIndex: 2, scale: 2, rotation: 0,
    regionXPt: 0, regionYPt: 0, regionWPt: 100, regionHPt: 100,
  });
  const regions = calls.filter((c) => c.cmd === 'render_pdf_page_region');
  assert.deepEqual(regions.map((c) => c.args.engine), ['hayro', 'pdfium']);
  assert.equal(engineForPage('hayro', 'mesh-tiles.pdf', 2), 'pdfium');
  setEngine('pdfium');
});

test('other Hayro errors are not hidden by a PDFium retry', async () => {
  const saved = globalThis.__TAURI__.core.invoke;
  globalThis.__TAURI__.core.invoke = async () => { throw 'hayro worker render failed: read error'; };
  setEngine('hayro');
  await assert.rejects(renderPdfPage({ path: 'x.pdf', pageIndex: 0, scale: 1, rotation: 0 }));
  globalThis.__TAURI__.core.invoke = saved;
  setEngine('pdfium');
});

test('the diagnostic label names the engine that drew the page', async () => {
  const { pageEngineLabel } = await import('./render-engine.js');
  setEngine('hayro');
  assert.equal(pageEngineLabel('mesh.pdf', 0), 'PDFium', 'refused page');
  assert.equal(pageEngineLabel('other.pdf', 0), 'Hayro');
  setEngine('pdfium');
  assert.equal(pageEngineLabel('other.pdf', 0), 'PDFium');
});
