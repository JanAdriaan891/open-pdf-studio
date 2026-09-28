// Arcering op een rechthoek, ellips, veelhoek of wolk overleeft opslaan →
// heropenen, en het gekozen type uit de Type-kiezer ook (#279).
//
// Een vlak (filledArea, meetvlak) schreef zijn arcering al als eigen
// sleutels; een rechthoek, ellips, veelhoek of wolk niet. Na heropenen was de
// arcering van die vormen verdwenen. Het gekozen type (styleType) werd voor
// geen enkele soort bewaard: de Type-kiezer toonde na heropenen "Aangepast".
//
// De converter zelf is in node niet te laden (core/state.ts hangt aan de
// DOM); de rondgang hieronder loopt via echte PDF-bytes en de lezer uit
// color-extraction.js, en de laatste tests bewaken dat de opslag en de
// converter de gedeelde helpers op de juiste plekken gebruiken.

import assert from 'node:assert/strict';
import test from 'node:test';
import { readFileSync } from 'node:fs';
import { PDFDocument, PDFName } from 'pdf-lib';

import { schrijfHatchMeta, hatchVanVorm, schrijfStijlType, stijlTypeUitExtra } from './hatch-meta.js';
import { extractAnnotationColors } from '../loader/color-extraction.js';

const RECT = [100, 100, 300, 200];

async function rondgang(subtype, ann, extraDict = {}) {
  const doc = await PDFDocument.create();
  const pagina = doc.addPage([600, 800]);
  const context = doc.context;
  const dict = context.obj({ Type: 'Annot', Subtype: subtype, Rect: RECT, ...extraDict });
  schrijfHatchMeta(dict, ann, context);
  schrijfStijlType(dict, ann);
  pagina.node.set(PDFName.of('Annots'), context.obj([context.register(dict)]));
  const heropend = await PDFDocument.load(await doc.save());
  const kaart = await extractAnnotationColors(1, heropend);
  return kaart.get(RECT.join(',')) || {};
}

const ARCERING = { hatchPattern: 'crosshatch', hatchColor: '#008000', hatchScale: 75, hatchAngle: 30 };

for (const subtype of ['Square', 'Circle']) {
  test(`${subtype}: arcering komt na heropenen terug`, async () => {
    const extra = await rondgang(subtype, { type: 'box', ...ARCERING });
    assert.deepEqual(hatchVanVorm(extra), ARCERING);
  });
}

test('Polygon (veelhoek, wolk): arcering komt na heropenen terug', async () => {
  const extra = await rondgang('Polygon', { type: 'cloud', ...ARCERING }, { Vertices: [100, 100, 300, 100, 300, 200] });
  assert.deepEqual(hatchVanVorm(extra), ARCERING);
});

test('hoek 0 overleeft de rondgang', async () => {
  const extra = await rondgang('Square', { ...ARCERING, hatchAngle: 0 });
  assert.equal(hatchVanVorm(extra).hatchAngle, 0);
});

test('zonder eigen arceringskleur blijft de kleur weg (volgt op het scherm de rand)', async () => {
  const extra = await rondgang('Square', { hatchPattern: 'horizontal', hatchScale: 100 });
  assert.deepEqual(hatchVanVorm(extra), { hatchPattern: 'horizontal', hatchScale: 100 });
});

test('een vorm zonder arcering krijgt geen arceringsvelden', async () => {
  const extra = await rondgang('Square', { hatchPattern: 'none' });
  assert.equal(extra.opsHatchPattern, undefined);
  assert.deepEqual(hatchVanVorm(extra), {});
  assert.deepEqual(hatchVanVorm(undefined), {});
});

test('het gekozen type komt na heropenen terug', async () => {
  const extra = await rondgang('Polygon', { type: 'filledArea', styleType: 'inb-staal', hatchPattern: 'staal-dubbel' },
    { Vertices: [100, 100, 300, 100, 300, 200] });
  assert.deepEqual(stijlTypeUitExtra(extra), { styleType: 'inb-staal' });
  const zonder = await rondgang('Square', { hatchPattern: 'none' });
  assert.deepEqual(stijlTypeUitExtra(zonder), {});
});

// ── de opslag en de converter gebruiken de helpers ─────────────────────────

const SAVER = readFileSync(new URL('../saver.js', import.meta.url), 'utf8');
const CONVERTER = readFileSync(new URL('../loader/annotation-converter.js', import.meta.url), 'utf8');

function blok(bron, begin, eind) {
  const a = bron.indexOf(begin);
  assert.ok(a >= 0, `niet gevonden: ${begin}`);
  const b = bron.indexOf(eind, a + begin.length);
  assert.ok(b > a, `geen einde na: ${begin}`);
  return bron.slice(a, b);
}

test('de opslag schrijft de arcering van rechthoek, ellips en veelhoek/wolk', () => {
  assert.match(blok(SAVER, "case 'box': {", "case 'vectorSnippet'"), /schrijfHatchMeta\(annotDict, ann, context\)/);
  assert.match(blok(SAVER, "case 'circle': {", "case 'line':"), /schrijfHatchMeta\(annotDict, ann, context\)/);
  assert.match(blok(SAVER, "case 'cloudPolyline': {", "case 'text':"), /schrijfHatchMeta\(annotDict, ann, context\)/);
});

test('de opslag schrijft het gekozen type voor elke soort', () => {
  assert.match(blok(SAVER, '// Add annotation to page', 'parentAnnotRef = context.register(annotDict)'), /schrijfStijlType\(annotDict, ann\)/);
});

test('de converter leest arcering en type terug', () => {
  assert.match(blok(CONVERTER, 'const baseProps = {', '};'), /stijlTypeUitExtra\(extraColors\)/);
  assert.match(blok(CONVERTER, 'const sqProps = {', 'return createAnnotation(sqProps)'), /hatchVanVorm\(extraColors\)/);
  assert.match(blok(CONVERTER, 'const crProps = {', 'return createAnnotation(crProps)'), /hatchVanVorm\(extraColors\)/);
  assert.match(blok(CONVERTER, 'const polyProps = {', 'return createAnnotation(polyProps)'), /hatchVanVorm\(extraColors\)/);
});
