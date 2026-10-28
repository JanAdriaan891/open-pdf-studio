// Kleurmodus van de afdruk (#754): grijswaarden en zwart-wit.
import assert from 'node:assert/strict';
import test from 'node:test';
import fs from 'node:fs';
import { KLEUR_MODI, moetOmzetten, luminantie, zetPixelsOm } from './print-kleur.js';
import { herstelPrintInstellingen, PRINT_STANDAARD } from '../solid/stores/print-instellingen.js';

const px = (...rgba) => new Uint8ClampedArray(rgba);

test('kleur laat de pixels staan, ook bij een onbekende modus', () => {
  for (const modus of ['color', undefined, 'sepia']) {
    assert.equal(moetOmzetten(modus), false, String(modus));
    assert.deepEqual([...zetPixelsOm(px(200, 10, 30, 255), modus)], [200, 10, 30, 255]);
  }
});

test('grijswaarden: luminantie in alle drie kanalen, alfa blijft', () => {
  assert.equal(luminantie(255, 255, 255), 255);
  assert.equal(luminantie(0, 0, 0), 0);
  assert.equal(luminantie(255, 0, 0), 76);
  assert.equal(luminantie(0, 255, 0), 150);
  assert.equal(luminantie(0, 0, 255), 29);
  const d = zetPixelsOm(px(255, 0, 0, 255, 0, 0, 255, 128), 'grayscale');
  assert.deepEqual([...d], [76, 76, 76, 255, 29, 29, 29, 128]);
});

test('zwart-wit: drempel op de helft, alleen 0 of 255', () => {
  const d = zetPixelsOm(px(127, 127, 127, 255, 128, 128, 128, 255, 220, 30, 30, 255, 255, 255, 0, 255), 'bw');
  assert.deepEqual([...d], [0, 0, 0, 255, 255, 255, 255, 255, 0, 0, 0, 255, 255, 255, 255, 255]);
});

test('de keuze wordt onthouden en gecontroleerd', () => {
  assert.deepEqual(KLEUR_MODI, ['color', 'grayscale', 'bw']);
  assert.equal(PRINT_STANDAARD.colorMode, 'color');
  assert.equal(herstelPrintInstellingen({ colorMode: 'grayscale' }).colorMode, 'grayscale');
  assert.equal(herstelPrintInstellingen({ colorMode: 'bw' }).colorMode, 'bw');
  assert.equal(herstelPrintInstellingen({ colorMode: 'paars' }).colorMode, 'color');
  assert.equal(herstelPrintInstellingen({}).colorMode, 'color');
});

test('printopdracht, opslaan als PDF en het voorbeeld gebruiken de kleurmodus', () => {
  const job = fs.readFileSync(new URL('./print-job.js', import.meta.url), 'utf8');
  assert.match(job, /maakCanvasGrijs\(canvas, kleur\)/, 'renderPrintBeeld zet het paginabeeld om');
  assert.match(job, /renderPrintBeeld\(pageNum, pxPerPt, plaatsing, deel, \{ markeringen, kleur \}\)/);
  // Opslaan als PDF: met grijs of zwart-wit de beeldenweg, niet de vectorweg.
  const opslaan = job.slice(job.indexOf('export async function slaPrintOpAlsPdf('), job.indexOf('async function metMeerPerBlad('));
  assert.ok(opslaan.indexOf('moetOmzetten(kleur)') < opslaan.indexOf('bouwVectorPrintPdf('));
  const dialoog = fs.readFileSync(new URL('../solid/components/dialogs/PrintDialog.jsx', import.meta.url), 'utf8');
  assert.equal((dialoog.match(/\{ markeringen, kleur: colorMode\(\) \}/g) || []).length, 3, 'drie voorbeeldpaden');
  assert.equal((dialoog.match(/kleur: colorMode\(\),/g) || []).length, 2, 'printen en opslaan als PDF');
  assert.match(dialoog, /colorMode: colorMode\(\),/, 'bewaard in printSettings');
  for (const taal of ['en', 'nl']) {
    const p = JSON.parse(fs.readFileSync(new URL(`../i18n/locales/${taal}/dialogs.json`, import.meta.url), 'utf8')).print;
    for (const k of ['colorLabel', 'colorModeColor', 'colorModeGrayscale', 'colorModeBw']) assert.ok(p[k], `${taal}: ${k}`);
  }
});
