import assert from 'node:assert/strict';
import test from 'node:test';
import { readFileSync } from 'node:fs';

const source = readFileSync(new URL('./ocr.js', import.meta.url), 'utf8');
const functions = source.slice(source.indexOf('function tauri()')).replaceAll('export ', '');
const deferred = () => { let resolve; const promise = new Promise(r => { resolve = r; }); return { promise, resolve }; };
function harness() {
  const a = { currentPage: 1, filePath: 'a.pdf', pdfDoc: { numPages: 2 }, ocrResults: {}, modified: false };
  const b = { ...a, filePath: 'b.pdf', ocrResults: {} };
  let active = a;
  const failures = [], closed = [], records = [];
  const deps = {
    state: { documents: [a, b] }, getActiveDocument: () => active,
    window: { __TAURI__: { core: { invoke: async () => [{ text: 'recognized' }] } } },
    recordOcrPage: (doc, page, oldWords, newWords) => records.push({doc,page,oldWords,newWords}),
    markDocumentModified: doc => { doc.modified = true; },
    startPrintProgress() {}, updatePrintProgress() {}, finishPrintProgress() {},
    failPrintProgress: message => failures.push(message), sluitPrintProgress: () => closed.push(true),
    i18next: { t: key => key }, console: { warn() {} },
  };
  const api = new Function('deps', `with (deps) { ${functions}; return {ocrCurrentPage, ocrAllPages}; }`)(deps);
  return { a, b, deps, api, failures, closed, records, switchTab: () => { active = b; } };
}

test('OCR remains on its original page and document across navigation', async () => {
  const h = harness(), gate = deferred();
  h.deps.window.__TAURI__.core.invoke = () => gate.promise;
  const job = h.api.ocrCurrentPage();
  h.a.currentPage = 2;
  h.switchTab();
  gate.resolve([{ text: 'page one' }]);
  await job;
  assert.deepEqual(h.a.ocrResults, { 1: [{ text: 'page one' }] });
  assert.equal(h.a.modified, true);
  assert.equal(h.b.modified, false);
  assert.equal(h.records[0].doc, h.a);
  assert.equal(h.records[0].page, 1);
});

test('OCR ignores a document closed or structurally replaced during recognition', async () => {
  for (const change of [h => { h.deps.state.documents = [h.b]; }, h => { h.a.pdfDoc = {}; }]) {
    const h = harness(), gate = deferred();
    h.deps.window.__TAURI__.core.invoke = () => gate.promise;
    const job = h.api.ocrAllPages();
    change(h);
    gate.resolve([{ text: 'stale' }]);
    await job;
    assert.deepEqual(h.a.ocrResults, {});
    assert.equal(h.a.modified, false);
    assert.equal(h.closed.length, 1);
  }
});

test('a later OCR error keeps earlier recognized pages marked as unsaved', async () => {
  const h = harness();
  h.deps.window.__TAURI__.core.invoke = async (_name, args) => {
    if (args.pageIndex === 1) throw new Error('recognition failed');
    h.switchTab();
    return [{ text: 'page one' }];
  };
  await h.api.ocrAllPages();
  assert.equal(h.a.modified, true);
  assert.equal(h.b.modified, false);
  assert.deepEqual(Object.keys(h.a.ocrResults), ['1']);
  assert.equal(h.failures.length, 1);
});
test('background OCR undo belongs only to its original document',()=>{
 const undoSource=readFileSync(new URL('../core/undo-manager.js',import.meta.url),'utf8');
 const body=undoSource.slice(undoSource.indexOf('export function recordOcrPage')).replace('export ','');
 const active={undoStack:[]},background={undoStack:[],redoStack:[{}],savedUndoStackLength:0,inhoudRevisie:0};
 const deps={getActiveDocument:()=>active,execute:()=>assert.fail('active-tab execute must not run'),
  clonePlainValue:v=>JSON.parse(JSON.stringify(v)),MAX_UNDO_STACK:100,
  verhoogInhoudRevisie:doc=>doc.inhoudRevisie++};
 const record=new Function('deps',`with(deps){${body};return recordOcrPage;}`)(deps);
 record(background,2,[],[{text:'background'}]);
 assert.equal(active.undoStack.length,0);assert.equal(background.undoStack[0].page,2);
 assert.equal(background.redoStack.length,0);assert.equal(background.savedUndoStackLength,-1);
});
