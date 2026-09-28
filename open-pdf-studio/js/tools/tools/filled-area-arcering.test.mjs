// De arcering in de schets van een gevuld gebied is die van het afgeronde
// vlak (#279), ook in de gatenfase: dezelfde schaalregio (eerste punt van de
// buitencontour) en dezelfde kleur als het vlak dat de tool aanmaakt.

import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { regioMonsterpunt, schetsArcering } from './filled-area-arcering.js';

const PREFS = {
  filledAreaHatchPattern: 'staal-dubbel',
  filledAreaHatchColor: '#123456',
  filledAreaHatchScale: 142,
  filledAreaHatchAngle: 30,
};

test('zonder patroon geen arcering', () => {
  assert.equal(schetsArcering({ filledAreaHatchPattern: 'none' }, 2), null);
  assert.equal(schetsArcering({}, 2), null);
});

test('de schaalregio vermenigvuldigt de hatchScale, net als rendering.js', () => {
  assert.deepEqual(schetsArcering(PREFS, 0.5), { pattern: 'staal-dubbel', color: '#123456', scale: 71, angle: 30 });
  assert.equal(schetsArcering(PREFS).scale, 142);
});

test('zonder eigen kleur: zwart, zoals het aangemaakte vlak', () => {
  const { filledAreaHatchColor, ...zonder } = PREFS;
  assert.equal(schetsArcering(zonder, 1).color, '#000000');
});

test('in de gatenfase telt het eerste punt van de buitencontour', () => {
  const buiten = [{ x: 10, y: 20 }, { x: 90, y: 20 }, { x: 90, y: 80 }];
  const gat = [{ x: 40, y: 40 }, { x: 60, y: 40 }];
  const cursor = { x: 1, y: 2 };
  assert.deepEqual(regioMonsterpunt('holes', buiten, gat, cursor), { x: 10, y: 20 });
  assert.deepEqual(regioMonsterpunt('holes', buiten, [], cursor), { x: 10, y: 20 });
  assert.deepEqual(regioMonsterpunt('outer', null, buiten, cursor), { x: 10, y: 20 });
  assert.deepEqual(regioMonsterpunt('outer', null, [], cursor), cursor);
});

test('de tool gebruikt deze arcering in beide schetsweergaven', () => {
  const bron = readFileSync(new URL('./filled-area-tool.js', import.meta.url), 'utf8');
  const aanroepen = bron.match(/hatchOpts = _schetsArcering\(prefs,/g) || [];
  assert.equal(aanroepen.length, 2, 'rubberband- en gatenfase-weergave');
  assert.doesNotMatch(bron, /scale: prefs\.filledAreaHatchScale \?\? 100,/, 'geen weergave zonder regiofactor');
});
