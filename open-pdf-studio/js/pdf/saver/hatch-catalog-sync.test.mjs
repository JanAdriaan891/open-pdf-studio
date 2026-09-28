// De opslag tekent arceringen uit een eigen kopie van de patroondefinities
// (hatch-catalog.js, zonder DOM-afhankelijkheden). Die kopie moet gelijk
// blijven aan de patronen waarmee het scherm tekent (rendering/hatch-
// patterns.js), anders ziet een vlak er na opslaan in een andere lezer anders
// uit dan in de app (#279). Onbekende patronen tekent de opslag als een
// gewone 45°-arcering; elk type in de Type-kiezer moet dus een bekend patroon
// gebruiken.

import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { HATCH_LINE_FAMILIES } from './hatch-catalog.js';

globalThis.window = globalThis.window || {};
globalThis.document = globalThis.document || { createElement: () => null };

function laadBron(pad, vervangingen) {
  const url = new URL(pad, import.meta.url);
  let bron = readFileSync(url, 'utf8');
  for (const [patroon, door] of vervangingen) bron = bron.replace(patroon, door);
  bron = bron.replace(/from '(\.[^']*)'/g, (_m, spec) => `from '${new URL(spec, url).href}'`);
  return import('data:text/javascript;base64,' + Buffer.from(bron, 'utf8').toString('base64'));
}

const { BUILTIN_HATCH_PATTERNS } = await laadBron('../../annotations/rendering/hatch-patterns.js', [
  [/^import \{ arcControlPoint \}.*$/m, 'const arcControlPoint = (a) => a;'],
  [/^import \{ state \}.*$/m, 'const state = { preferences: {}, documents: [], activeDocumentIndex: 0 };'],
]);
const { STYLE_TYPES } = await laadBron('../../annotations/style-types.js', [
  [/^import \{ state as _appState \}.*$/m, 'const _appState = { preferences: {} };'],
]);

test('opslag en scherm kennen dezelfde patronen', () => {
  const scherm = BUILTIN_HATCH_PATTERNS.map((p) => p.id).sort();
  const opslag = Object.keys(HATCH_LINE_FAMILIES).sort();
  assert.deepEqual(opslag, scherm);
});

test('elk patroon heeft in de opslag dezelfde lijnfamilies als op het scherm', () => {
  for (const p of BUILTIN_HATCH_PATTERNS) {
    assert.deepEqual(HATCH_LINE_FAMILIES[p.id], p.lineFamilies, p.id);
  }
});

test('elk arceringstype gebruikt een patroon dat scherm en opslag kennen', () => {
  const bekend = new Set(BUILTIN_HATCH_PATTERNS.map((p) => p.id));
  const onbekend = STYLE_TYPES.filledArea
    .filter((t) => !bekend.has(t.props.hatchPattern) || !(t.props.hatchPattern in HATCH_LINE_FAMILIES))
    .map((t) => `${t.id}: ${t.props.hatchPattern}`);
  assert.deepEqual(onbekend, []);
});
