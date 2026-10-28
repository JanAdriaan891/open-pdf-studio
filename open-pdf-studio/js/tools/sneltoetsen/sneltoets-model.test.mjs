// Eigen sneltoetsen (#714): toetscombinaties en het model.
import assert from 'node:assert/strict';
import test from 'node:test';
import fs from 'node:fs';
import {
  combinatieVan, normaliseer, isToegestaan, isEnkeleToets, eventVoor,
} from './toets-combinatie.js';
import {
  effectief, opdrachtMet, wijsToe, haalWeg, herstel, beslis, exporteer, importeer, schoonEigen,
} from './sneltoets-model.js';

const ev = (key, o = {}) => ({ key, code: o.code ?? '', ctrlKey: !!o.ctrl, metaKey: !!o.meta, altKey: !!o.alt, shiftKey: !!o.shift });

test('combinatie van een toets: vaste volgorde, Cmd telt als Ctrl', () => {
  assert.equal(combinatieVan(ev('s', { ctrl: true })), 'Ctrl+S');
  assert.equal(combinatieVan(ev('S', { ctrl: true, shift: true })), 'Ctrl+Shift+S');
  assert.equal(combinatieVan(ev('s', { meta: true, alt: true })), 'Ctrl+Alt+S');
  assert.equal(combinatieVan(ev('PageDown')), 'PageDown');
  assert.equal(combinatieVan(ev('F7')), 'F7');
  assert.equal(combinatieVan(ev('ArrowLeft', { shift: true })), 'Shift+Left');
  assert.equal(combinatieVan(ev('Control', { ctrl: true })), null, 'alleen een modificator');
  assert.equal(combinatieVan(ev('?', { shift: true })), '?', 'Shift zit al in het teken');
});

test('plus en min volgen de fysieke toets, zoals de app ze herkent', () => {
  assert.equal(combinatieVan(ev('=', { ctrl: true, code: 'Equal' })), 'Ctrl+=');
  assert.equal(combinatieVan(ev('+', { ctrl: true, shift: true, code: 'Equal' })), 'Ctrl+Shift+Plus');
  assert.equal(combinatieVan(ev('_', { ctrl: true, shift: true, code: 'Minus' })), 'Ctrl+Shift+Minus');
  assert.equal(combinatieVan(ev('-', { ctrl: true, code: 'Minus' })), 'Ctrl+Minus');
});

test('normaliseren, toegestaan en enkele toetsen', () => {
  assert.equal(normaliseer('shift+ctrl+s'), 'Ctrl+Shift+S');
  assert.equal(normaliseer('Cmd+O'), 'Ctrl+O');
  assert.equal(normaliseer('Ctrl++'), 'Ctrl+Plus');
  assert.equal(normaliseer('Hyper+S'), null);
  assert.equal(isToegestaan('Escape'), false);
  assert.equal(isToegestaan('Ctrl+Tab'), false);
  assert.equal(isToegestaan('Ctrl+Shift+F'), true);
  assert.equal(isEnkeleToets('V'), true);
  assert.equal(isEnkeleToets('Shift+F3'), true);
  assert.equal(isEnkeleToets('Ctrl+V'), false);
  assert.equal(isEnkeleToets('Alt+V'), false);
});

test('afspelen: het nagebootste event geeft dezelfde combinatie terug', () => {
  for (const c of ['Ctrl+S', 'Ctrl+Shift+S', 'Ctrl+=', 'Ctrl+Minus', 'Ctrl+Shift+Plus', 'Ctrl+Shift+Minus', 'F3', 'Shift+F3', 'Delete', 'V', '1', 'Ctrl+,', 'Ctrl+PageDown']) {
    assert.equal(combinatieVan(eventVoor(c)), c, c);
  }
  const e = eventVoor('Ctrl+S');
  assert.equal(e.key, 's');
  e.preventDefault();
  assert.equal(e.defaultPrevented, true);
});

const OPDRACHTEN = [
  { id: 'fit', standaard: ['Ctrl+2'] },
  { id: 'save', standaard: ['Ctrl+S'] },
  { id: 'redo', standaard: ['Ctrl+Y', 'Ctrl+Shift+Z'] },
  { id: 'next', standaard: [] },
  { id: 'select', standaard: ['V'] },
];

test('zonder eigen toetsen gelden de standaardtoetsen en doet de app alles zelf', () => {
  assert.deepEqual(effectief(OPDRACHTEN, {}).get('redo'), ['Ctrl+Y', 'Ctrl+Shift+Z']);
  assert.deepEqual(beslis('Ctrl+2', OPDRACHTEN, {}), { soort: 'door' });
  assert.deepEqual(beslis('Ctrl+K', OPDRACHTEN, {}), { soort: 'door' });
});

test('een toets geven aan een opdracht zonder toets: die voert hem uit', () => {
  const eigen = wijsToe(OPDRACHTEN, {}, 'next', 'PageDown');
  assert.deepEqual(eigen, { next: ['PageDown'] });
  assert.deepEqual(beslis('PageDown', OPDRACHTEN, eigen), { soort: 'uitvoeren', id: 'next' });
  assert.deepEqual(beslis('Ctrl+2', OPDRACHTEN, eigen), { soort: 'door' }, 'de rest blijft standaard');
});

test('opnieuw toewijzen: de vorige eigenaar verliest de toets', () => {
  assert.equal(opdrachtMet('Ctrl+2', OPDRACHTEN, {}), 'fit');
  const eigen = wijsToe(OPDRACHTEN, {}, 'next', 'Ctrl+2');
  assert.deepEqual(eigen, { fit: [], next: ['Ctrl+2'] });
  assert.deepEqual(beslis('Ctrl+2', OPDRACHTEN, eigen), { soort: 'uitvoeren', id: 'next' });
  assert.equal(opdrachtMet('Ctrl+2', OPDRACHTEN, eigen), 'next');
});

test('weghalen: een weggehaalde standaardtoets doet niets meer', () => {
  const eigen = haalWeg(OPDRACHTEN, {}, 'select', 'V');
  assert.deepEqual(eigen, { select: [] });
  assert.deepEqual(beslis('V', OPDRACHTEN, eigen), { soort: 'slikken' });
});

test('een tweede toets naast de standaard, en terug naar de standaard', () => {
  let eigen = wijsToe(OPDRACHTEN, {}, 'fit', 'Ctrl+Shift+F');
  assert.deepEqual(effectief(OPDRACHTEN, eigen).get('fit'), ['Ctrl+2', 'Ctrl+Shift+F']);
  assert.deepEqual(beslis('Ctrl+2', OPDRACHTEN, eigen), { soort: 'door' });
  assert.deepEqual(beslis('Ctrl+Shift+F', OPDRACHTEN, eigen), { soort: 'uitvoeren', id: 'fit' });
  eigen = haalWeg(OPDRACHTEN, eigen, 'fit', 'Ctrl+Shift+F');
  assert.deepEqual(eigen, {}, 'gelijk aan de standaard: niets bewaard');
});

test('herstellen: de opdracht krijgt haar standaard terug, ook als een ander die had', () => {
  let eigen = wijsToe(OPDRACHTEN, {}, 'next', 'Ctrl+2');
  eigen = herstel(OPDRACHTEN, eigen, 'fit');
  assert.deepEqual(effectief(OPDRACHTEN, eigen).get('fit'), ['Ctrl+2']);
  assert.deepEqual(effectief(OPDRACHTEN, eigen).get('next'), []);
});

test('Escape en Tab kunnen niet worden toegewezen', () => {
  assert.deepEqual(wijsToe(OPDRACHTEN, {}, 'next', 'Escape'), {});
  assert.deepEqual(wijsToe(OPDRACHTEN, {}, 'next', 'Ctrl+Tab'), {});
});

test('export en import geven dezelfde sneltoetsen; een vreemd bestand wordt geweigerd', () => {
  const eigen = wijsToe(OPDRACHTEN, haalWeg(OPDRACHTEN, {}, 'select', 'V'), 'next', 'PageDown');
  assert.deepEqual(importeer(exporteer(eigen)), eigen);
  assert.throws(() => importeer('geen json'), (e) => e.code === 'ongeldig');
  assert.throws(() => importeer('{"format":"iets anders","shortcuts":{}}'), (e) => e.code === 'ongeldig');
  assert.throws(() => importeer('{"format":"open-pdf-studio-shortcuts","version":99,"shortcuts":{}}'), (e) => e.code === 'nieuwer');
  // Kapotte waarden vallen weg, onbekende opdrachten (een extensie die later laadt) blijven.
  assert.deepEqual(schoonEigen({ a: ['ctrl+k', 'Escape', 7, 'Ctrl+K'], b: 'x', 'ext:x:y': ['F6'] }), { a: ['Ctrl+K'], 'ext:x:y': ['F6'] });
});

test('de ingebouwde lijst klopt met de toetsafhandeling en heeft geen dubbele toetsen', async () => {
  const bron = fs.readFileSync(new URL('./opdrachten.js', import.meta.url), 'utf8');
  const standaard = [...bron.matchAll(/\['[a-z]+\.[A-Za-z]+', '[^']*', '[^']*', \[([^\]]*)\]/g)]
    .flatMap((m) => [...m[1].matchAll(/'([^']+)'/g)].map((x) => normaliseer(x[1])));
  assert.ok(standaard.length > 40);
  assert.equal(new Set(standaard).size, standaard.length, 'elke standaardtoets hoort bij één opdracht');
  const kh = fs.readFileSync(new URL('../keyboard-handlers.js', import.meta.url), 'utf8');
  // De verdeler hangt vóór de tabwissel, en speelt standaardtoetsen af via de gewone weg.
  assert.ok(kh.indexOf("addEventListener('keydown', handleEigenSneltoets, true)") < kh.indexOf("addEventListener('keydown', handleTabSneltoets, true)"));
  assert.match(kh, /if \(tabSneltoetsRichting\(ev\)\) handleTabSneltoets\(ev\);\n\s+else handleKeydown\(ev\);/);
  // Een paar standaardtoetsen uit de lijst die de toetsafhandeling echt kent.
  assert.match(kh, /e\.key === 'F8'[\s\S]{0,200}toggleLeftPanel\(\)/);
  assert.match(kh, /ctrl && e\.key === '2'[\s\S]{0,60}fitPage/);
});
