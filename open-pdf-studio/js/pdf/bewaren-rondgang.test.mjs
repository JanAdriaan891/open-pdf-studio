// Wat de app of een ander programma op een annotatie zet, overleeft opslaan
// (#621): lezen, de ruwe waarde bewaren, terugschrijven. Tekenen is de
// optionele helft; weggooien is de fout.
//
// Elk geval: opslaan -> heropenen -> opslaan -> heropenen met de echte saver
// en lader (rondgang.testhulp.mjs), terugzoeken op soort, geen dubbelingen.

import assert from 'node:assert/strict';
import test from 'node:test';
import { PDFDocument, PDFName, PDFString, PDFDict, PDFArray, decodePDFRawStream } from 'pdf-lib';
import { leegBlad, opslaan, laad, woordenboeken } from './rondgang.testhulp.mjs';
import { decodePdfTextObject } from './saver/pdf-text.js';

const naam = (d, k) => d.get(PDFName.of(k))?.toString();
const tekst = (d, k) => decodePdfTextObject(d.get(PDFName.of(k)));
const subtype = (d) => naam(d, 'Subtype');

/** Opslaan en heropenen, `keer` keer; elke volgende keer op het vorige bestand. */
async function rondgang(modellen, { keer = 2, bron, rotatie = 0, lagen = null } = {}) {
  let bytes = bron || await leegBlad({ rotatie });
  let huidig = modellen;
  let huidigeLagen = lagen;
  for (let i = 0; i < keer; i++) {
    bytes = await opslaan(bytes, huidig, { lagen: huidigeLagen });
    huidig = await laad(bytes);
    huidigeLagen = huidig.lagen;
  }
  return { modellen: huidig, bytes };
}

/** De gedecodeerde inhoud van de /AP /N van een annotatie. */
function apInhoud(doc, dict) {
  const ctx = doc.context;
  const ap = ctx.lookup(dict.get(PDFName.of('AP')));
  const stroom = ctx.lookup(ap.get(PDFName.of('N')));
  return Buffer.from(decodePDFRawStream(stroom).decode()).toString('latin1');
}

const basis = {
  page: 1, rotation: 0, color: '#000000', strokeColor: '#000000', fillColor: null,
  lineWidth: 1, borderStyle: 'solid', opacity: 1, author: 'User',
};
const ARCERING = { hatchPattern: 'diagonal-left', hatchColor: '#ff0000', hatchScale: 100, hatchAngle: 0 };

// ── 1. arcering uit het eigenschappenpaneel ─────────────────────────────────

const VORMEN = {
  box: { ...basis, id: 'bx', type: 'box', x: 80, y: 100, width: 140, height: 80 },
  circle: { ...basis, id: 'ci', type: 'circle', x: 300, y: 100, width: 120, height: 80 },
  polygon: { ...basis, id: 'pg', type: 'polygon', x: 80, y: 300, width: 140, height: 90, sides: 6 },
  cloud: { ...basis, id: 'cl', type: 'cloud', x: 300, y: 300, width: 160, height: 90 },
};

for (const [soort, vorm] of Object.entries(VORMEN)) {
  for (const extra of [{}, { rotation: 30, fillColor: '#00ff00' }]) {
    const wat = `${soort}${extra.rotation ? ' gedraaid met vulling' : ''}`;
    test(`arcering op een ${wat} blijft na twee rondgangen, in de sleutels en de appearance`, async () => {
      const { modellen, bytes } = await rondgang([{ ...vorm, ...ARCERING, ...extra }]);
      assert.equal(modellen.length, 1);
      const [m] = modellen;
      assert.equal(m.type, soort);
      assert.equal(m.hatchPattern, 'diagonal-left');
      assert.equal(m.hatchColor, '#ff0000');
      if (extra.rotation) assert.equal(m.rotation, 30);
      const dicts = await woordenboeken(bytes);
      const [{ dict }] = dicts;
      assert.equal(tekst(dict, 'OPS_HatchPattern'), 'diagonal-left');
      // De arcering staat in de appearance: een uitsnede (W n) met rode lijnen.
      const ap = apInhoud(dicts.doc, dict);
      assert.match(ap, /W n\n/, 'arcering knipt op de vorm');
      assert.match(ap, /1 0 0 RG/, 'rode arceringslijnen');
    });
  }
}

test('een vorm zonder arcering krijgt geen arceringssleutels', async () => {
  const { modellen, bytes } = await rondgang([VORMEN.box]);
  const [{ dict }] = await woordenboeken(bytes);
  assert.equal(dict.get(PDFName.of('OPS_HatchPattern')), undefined);
  assert.equal(modellen[0].hatchPattern, undefined);
});
