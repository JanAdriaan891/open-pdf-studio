// Opslaan annuleren (#766): stoppen op een veilig punt, nooit tijdens het
// schrijven, en het document houdt zijn wijzigingen.
import assert from 'node:assert/strict';
import test from 'node:test';
import fs from 'node:fs';
import { maakOpslaanAnnulering, OpslaanGeannuleerd, isOpslaanGeannuleerd } from './opslaan-annuleren.js';

function klok() {
  let t = 0;
  let pauzes = 0;
  return {
    opties: { nu: () => t, pauze: async () => { pauzes += 1; }, pauzeMs: 50 },
    verder: (ms) => { t += ms; },
    get pauzes() { return pauzes; },
  };
}

test('zonder annuleren loopt alles door', async () => {
  const a = maakOpslaanAnnulering(klok().opties);
  a.controleer();
  await a.tik();
  a.beginSchrijven();
  assert.equal(a.gevraagd, false);
});

test('annuleren stopt bij de volgende controle, op elk veilig punt', async () => {
  for (const punt of ['controleer', 'tik', 'beginSchrijven']) {
    const a = maakOpslaanAnnulering(klok().opties);
    a.annuleer();
    await assert.rejects(async () => a[punt](), (e) => isOpslaanGeannuleerd(e), punt);
  }
});

test('na het begin van het schrijven telt annuleren niet meer', async () => {
  const a = maakOpslaanAnnulering(klok().opties);
  a.beginSchrijven();
  a.annuleer();
  assert.equal(a.gevraagd, false);
  a.controleer();
});

test('tik geeft de bediening hooguit eens per 50 ms ruimte', async () => {
  const k = klok();
  const a = maakOpslaanAnnulering(k.opties);
  await a.tik();
  k.verder(20); await a.tik();
  assert.equal(k.pauzes, 0);
  k.verder(40); await a.tik();
  assert.equal(k.pauzes, 1);
  await a.tik();
  assert.equal(k.pauzes, 1);
});

test('de fout is herkenbaar', () => {
  assert.equal(isOpslaanGeannuleerd(new OpslaanGeannuleerd()), true);
  assert.equal(isOpslaanGeannuleerd(new Error('anders')), false);
  assert.equal(isOpslaanGeannuleerd(null), false);
});

const saver = fs.readFileSync(new URL('../saver.js', import.meta.url), 'utf8');
const nu = saver.slice(saver.indexOf('async function _savePDFNu('), saver.indexOf('export async function savePDFAs('));

test('de saver biedt annuleren alleen bij echt opslaan aan', () => {
  assert.match(nu, /const annuleerbaar = !momentopname && !alleenAnnotaties;/);
  assert.match(nu, /showLoading\('Saving PDF\.\.\.', annuleerbaar \? \{ annuleren: \(\) => annulering\.annuleer\(\) \} : \{\}\)/);
});

test('de laatste controle komt vóór het schrijven, en daarna verdwijnt de knop', () => {
  const schrijf = nu.indexOf('await writeBinaryFileAtomic(outputPath, savedBytes);');
  const laatste = nu.indexOf('annulering.beginSchrijven();');
  const unlock = nu.indexOf('await unlockFile(outputPath);');
  assert.ok(laatste > 0 && laatste < unlock && unlock < schrijf);
  assert.match(nu.slice(laatste, unlock), /showLoading\('Saving PDF\.\.\.'\);/);
  // Ook in de paginalus en rond het opruimen.
  assert.match(nu, /else if \(annuleerbaar\) await annulering\.tik\(\);/);
});

test('geannuleerd: melding, false terug, document niet als opgeslagen gemarkeerd', () => {
  const vang = nu.slice(nu.indexOf('  } catch (error) {'));
  const tak = vang.slice(vang.indexOf('if (isOpslaanGeannuleerd(error))'), vang.indexOf('return false;') + 13);
  assert.match(tak, /updateStatusMessage\(i18next\.t\('saveCancelled'/);
  assert.doesNotMatch(tak, /markDocumentSaved/);
  for (const taal of ['en', 'nl']) {
    const c = JSON.parse(fs.readFileSync(new URL(`../../i18n/locales/${taal}/common.json`, import.meta.url), 'utf8'));
    assert.ok(c.saveCancelled, taal);
  }
});

test('Esc in het laadvenster doet hetzelfde als Annuleren', () => {
  const overlay = fs.readFileSync(new URL('../../solid/components/LoadingOverlay.jsx', import.meta.url), 'utf8');
  assert.match(overlay, /e\.key !== 'Escape' \|\| !visible\(\) \|\| !cancelHandler\(\)/);
  assert.match(overlay, /onClick=\{annuleer\}/);
});
