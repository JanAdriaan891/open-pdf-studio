// De Type-kiezer bovenaan het eigenschappenpaneel (maatlijnen, lijnen,
// arceringen) toont zijn eigen teksten — label, "Aangepast", zoekveld,
// "geen typen" en de knop naar de type-editor — in elke taal vertaald (#279).
// Ontbreekt een sleutel, dan valt i18next terug op Engels; ontbreekt hij ook
// daar, dan staat de kale sleutel ("measurement.searchType") in beeld.

import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const HIER = dirname(fileURLToPath(import.meta.url));
const TALEN = join(HIER, '../../../i18n/locales');
const BRON = readFileSync(join(HIER, 'DimensionTypeSection.jsx'), 'utf8');

const meting = (taal) =>
  JSON.parse(readFileSync(join(TALEN, taal, 'properties.json'), 'utf8')).measurement || {};

// Alle measurement.*-sleutels die de kiezer zelf opvraagt.
const GEBRUIKT = [...new Set([...BRON.matchAll(/t\('measurement\.(\w+)'\)/g)].map((m) => m[1]))].sort();

// Woorden die in die taal echt hetzelfde zijn als in het Engels.
const GELIJK_AAN_ENGELS = {
  da: ['Type'],
  fr: ['Type'],
  nb: ['Type'],
  nl: ['Type'],
};

test('de kiezer vraagt de verwachte sleutels op', () => {
  assert.deepEqual(GEBRUIKT, ['dimType', 'dimTypeCustom', 'editTypes', 'noTypesFound', 'searchType']);
});

test('alle 39 talen hebben de teksten van de Type-kiezer, niet leeg', () => {
  const talen = readdirSync(TALEN);
  assert.equal(talen.length, 39);
  for (const taal of talen) {
    const m = meting(taal);
    for (const sleutel of GEBRUIKT) {
      const tekst = m[sleutel];
      assert.ok(typeof tekst === 'string' && tekst.trim().length > 0, `${taal}: measurement.${sleutel} ontbreekt`);
      assert.ok(!tekst.includes('measurement.'), `${taal}: measurement.${sleutel} is een kale sleutel`);
    }
  }
});

test('geen taal neemt de Engelse tekst over', () => {
  const en = meting('en');
  const overgenomen = [];
  for (const taal of readdirSync(TALEN)) {
    if (taal === 'en') continue;
    const toegestaan = new Set(GELIJK_AAN_ENGELS[taal] || []);
    const m = meting(taal);
    for (const sleutel of GEBRUIKT) {
      if (m[sleutel] === en[sleutel] && !toegestaan.has(m[sleutel])) overgenomen.push(`${taal} ${sleutel}: ${m[sleutel]}`);
    }
  }
  assert.deepEqual(overgenomen, []);
});
