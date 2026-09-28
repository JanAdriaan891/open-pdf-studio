// Namen van arceringen in alle 39 talen (#279).
//
// - De arceringskiezer zocht de patroonnamen onder hatchPatterns.* terwijl ze
//   onder appearance.hatchPatterns.* staan: in elke taal stonden de kale id's
//   in de lijst ("staal-dubbel", "basic"). Veertien patronen hadden ook in het
//   Engels en Nederlands geen naam, en de andere 37 talen hadden er geen.
// - De labels van de arceringssectie ("Hatch Pattern", "Hatch Color",
//   "Hatch Scale") waren in elke taal Engels, ook in het Nederlands.
// - De namen in de Type-kiezer ("Staal (dubbele lijn)", "Diagonaal smal", …)
//   stonden vast in het Nederlands in style-types.js, ook in een Engelse UI.
// - De type-editor ("Typen bewerken") had alleen Engelse en Nederlandse teksten.

import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

globalThis.window = globalThis.window || {};
globalThis.document = globalThis.document || { createElement: () => null };

const HIER = dirname(fileURLToPath(import.meta.url));
const TALEN_MAP = join(HIER, '../../../i18n/locales');
const TALEN = readdirSync(TALEN_MAP);
const json = (taal, bestand) => JSON.parse(readFileSync(join(TALEN_MAP, taal, bestand), 'utf8'));

function laadBron(pad, vervangingen) {
  const url = new URL(pad, import.meta.url);
  let bron = readFileSync(url, 'utf8');
  for (const [patroon, door] of vervangingen) bron = bron.replace(patroon, door);
  bron = bron.replace(/from '(\.[^']*)'/g, (_m, spec) => `from '${new URL(spec, url).href}'`);
  return import('data:text/javascript;base64,' + Buffer.from(bron, 'utf8').toString('base64'));
}

globalThis.__stijlTypenState = { preferences: {} };
const { BUILTIN_HATCH_PATTERNS, HATCH_CATEGORIES } = await laadBron('../../../annotations/rendering/hatch-patterns.js', [
  [/^import \{ arcControlPoint \}.*$/m, 'const arcControlPoint = (a) => a;'],
  [/^import \{ state \}.*$/m, 'const state = { preferences: {}, documents: [], activeDocumentIndex: 0 };'],
]);
const stijlTypen = await laadBron('../../../annotations/style-types.js', [
  [/^import \{ state as _appState \}.*$/m, 'const _appState = globalThis.__stijlTypenState;'],
]);
const { STYLE_TYPES, styleTypesFor, styleTypeLabel } = stijlTypen;
const PATROON_IDS = BUILTIN_HATCH_PATTERNS.map((p) => p.id);
const TYPE_IDS = STYLE_TYPES.filledArea.map((t) => t.id);

const tekst = (v) => typeof v === 'string' && v.trim().length > 0;

test('39 talen', () => {
  assert.equal(TALEN.length, 39);
});

test('de arceringskiezer zoekt namen en categorieën onder appearance.*', () => {
  const bron = readFileSync(join(HIER, 'HatchPatternSection.jsx'), 'utf8');
  assert.match(bron, /`appearance\.hatchPatterns\.\$\{id\}`/);
  assert.match(bron, /`appearance\.hatchCategories\.\$\{cat\}`/);
  assert.doesNotMatch(bron, /`hatchPatterns\.\$\{id\}`/);
});

test('elk patroon en elke categorie heeft in elke taal een naam', () => {
  for (const taal of TALEN) {
    const a = json(taal, 'properties.json').appearance || {};
    for (const id of PATROON_IDS) assert.ok(tekst(a.hatchPatterns?.[id]), `${taal}: appearance.hatchPatterns.${id}`);
    for (const cat of HATCH_CATEGORIES) assert.ok(tekst(a.hatchCategories?.[cat]), `${taal}: appearance.hatchCategories.${cat}`);
    for (const k of ['hatchPattern', 'hatchColor', 'hatchScale', 'hatchAngle']) assert.ok(tekst(a[k]), `${taal}: appearance.${k}`);
  }
});

test('de labels van de arceringssectie zijn nergens meer Engels (behalve in het Engels)', () => {
  const en = json('en', 'properties.json').appearance;
  const overgenomen = [];
  for (const taal of TALEN) {
    if (taal === 'en') continue;
    const a = json(taal, 'properties.json').appearance;
    for (const k of ['hatchPattern', 'hatchColor', 'hatchScale']) if (a[k] === en[k]) overgenomen.push(`${taal} ${k}`);
  }
  assert.deepEqual(overgenomen, []);
});

test('"Geen" en "Gemengd" (common) zijn vertaald', () => {
  for (const taal of TALEN) {
    const c = json(taal, 'common.json');
    assert.ok(tekst(c.none) && tekst(c.mixed), taal);
    if (taal !== 'en') {
      assert.notEqual(c.none, 'None', `${taal}: common.none`);
      assert.notEqual(c.mixed, 'Mixed', `${taal}: common.mixed`);
    }
  }
});

test('elk arceringstype heeft in elke taal een eigen naam', () => {
  for (const taal of TALEN) {
    const namen = json(taal, 'properties.json').styleTypes?.filledArea || {};
    for (const id of TYPE_IDS) assert.ok(tekst(namen[id]), `${taal}: styleTypes.filledArea.${id}`);
    assert.deepEqual(Object.keys(namen).sort(), [...TYPE_IDS].sort(), `${taal}: geen overbodige sleutels`);
    // Twee typen met dezelfde naam zijn in de lijst niet uit elkaar te houden.
    const dubbel = Object.values(namen).filter((v, i, a) => a.indexOf(v) !== i);
    assert.deepEqual(dubbel, [], `${taal}: dubbele namen`);
  }
});

test('in het Nederlands zijn de namen precies de ingebouwde namen', () => {
  const nl = json('nl', 'properties.json').styleTypes.filledArea;
  for (const t of STYLE_TYPES.filledArea) assert.equal(nl[t.id], t.label, t.id);
});

test('geen taal neemt de Engelse namen over', () => {
  const en = json('en', 'properties.json');
  for (const taal of TALEN) {
    if (taal === 'en') continue;
    const p = json(taal, 'properties.json');
    const vergelijk = [
      ...PATROON_IDS.map((id) => [p.appearance.hatchPatterns[id], en.appearance.hatchPatterns[id]]),
      ...TYPE_IDS.map((id) => [p.styleTypes.filledArea[id], en.styleTypes.filledArea[id]]),
    ];
    const gelijk = vergelijk.filter(([a, b]) => a === b).length;
    // Een handvol woorden is echt gelijk (Beton, Aluminium, Zigzag, NEN 47…).
    assert.ok(gelijk / vergelijk.length < 0.1, `${taal}: ${gelijk} van ${vergelijk.length} namen gelijk aan het Engels`);
  }
});

test('de type-editor heeft in elke taal dezelfde teksten als in het Engels', () => {
  const en = json('en', 'dialogs.json').styleType;
  for (const taal of TALEN) {
    const d = json(taal, 'dialogs.json').styleType || {};
    assert.deepEqual(Object.keys(d).sort(), Object.keys(en).sort(), taal);
    for (const [k, v] of Object.entries(d)) assert.ok(tekst(v), `${taal}: styleType.${k}`);
    assert.match(d.editTitle, /\{\{kind\}\}/, `${taal}: editTitle zonder {{kind}}`);
  }
});

// ── naam van een type: vertaling, eigen naam, terugval ─────────────────────

const NAMEN = { 'styleTypes.filledArea.inb-staal': 'Steel (double line)' };
const t = (sleutel) => NAMEN[sleutel] ?? sleutel;

test('een ingebouwd type toont zijn vertaalde naam', () => {
  globalThis.__stijlTypenState.preferences = {};
  const staal = styleTypesFor('filledArea').find((e) => e.id === 'inb-staal');
  assert.equal(staal.labelKey, 'styleTypes.filledArea.inb-staal');
  assert.equal(styleTypeLabel(staal, t), 'Steel (double line)');
});

test('een eigen naam van de gebruiker wint van de vertaling', () => {
  globalThis.__stijlTypenState.preferences = { customStyleTypes: { filledArea: { 'inb-staal': { label: 'Mijn staal' } } } };
  try {
    const staal = styleTypesFor('filledArea').find((e) => e.id === 'inb-staal');
    assert.equal(styleTypeLabel(staal, t), 'Mijn staal');
  } finally {
    globalThis.__stijlTypenState.preferences = {};
  }
});

test('zonder vertaling (of met omgezette cijfers) de eigen naam; eigen typen ongewijzigd', () => {
  const beton = styleTypesFor('filledArea').find((e) => e.id === 'beton');
  assert.equal(styleTypeLabel(beton, t), 'Beton');
  // Perzisch/Arabisch: een ontbrekende sleutel komt terug met omgezette cijfers.
  const omgezet = (k) => k.replace(/[0-9]/g, (d) => '۰۱۲۳۴۵۶۷۸۹'[d]);
  const nen = styleTypesFor('filledArea').find((e) => e.id === 'inb-nen47-01-metselwerk-baksteen');
  assert.equal(styleTypeLabel(nen, omgezet), nen.label);
  assert.equal(styleTypeLabel({ id: 'custom-1', label: 'Eigen type' }, t), 'Eigen type');
  // Soorten zonder vertaalde namen houden hun eigen naam.
  const pen = styleTypesFor('line')[0];
  assert.equal(pen.labelKey, undefined);
  assert.equal(styleTypeLabel(pen, t), pen.label);
});
