// De uitklaplijsten van de Type-kiezer en de arceringskiezer blijven binnen
// het venster (#279). De Type-lijst is 280 px breed en hing aan de linkerkant
// van een smallere knop helemaal rechts in het venster: het rechterdeel (met
// de namen) viel weg. De arceringslijst klapte onderaan het paneel onder de
// vensterrand uit.

import test from 'node:test';
import assert from 'node:assert/strict';
import { uitklapPositie } from './uitklap-positie.js';

const venster = { breedte: 1500, hoogte: 950 };
const knop = (left, top, breedte = 200, hoogte = 28) => ({ left, top, right: left + breedte, bottom: top + hoogte });

test('genoeg ruimte: onder de knop, links uitgelijnd', () => {
  const p = uitklapPositie(knop(300, 200), venster, { breedte: 280, maxHoogte: 420 });
  assert.deepEqual(p, { x: 300, breedte: 280, maxHoogte: 420, y: 230 });
});

test('knop helemaal rechts: de lijst schuift naar links tot binnen het venster', () => {
  // Zo stond de Type-kiezer in het eigenschappenpaneel: knop op x=1297.
  const p = uitklapPositie(knop(1297, 228, 195), venster, { breedte: 280, maxHoogte: 420 });
  assert.equal(p.x + p.breedte, 1500 - 4);
  assert.equal(p.breedte, 280);
  assert.equal(p.y, 258);
});

test('rechts uitgelijnd: rechterkant van lijst en knop gelijk', () => {
  const p = uitklapPositie(knop(1280, 100, 210), venster, { breedte: 320, maxHoogte: 420, uitlijning: 'rechts' });
  assert.equal(p.x + p.breedte, 1490);
});

test('te weinig ruimte onder de knop: de lijst klapt naar boven uit', () => {
  // Arceringskiezer onderaan het paneel (knop op y=805..829).
  const p = uitklapPositie(knop(1283, 805, 210, 24), venster,
    { breedte: 320, maxHoogte: 420, uitlijning: 'rechts', tussenruimte: 0 });
  assert.equal(p.y, undefined);
  assert.equal(p.onder, 950 - 805);
  assert.equal(p.maxHoogte, 420);
});

test('krap aan beide kanten: de grootste kant, met een kleinere hoogte', () => {
  const p = uitklapPositie(knop(100, 150, 200, 28), { breedte: 800, hoogte: 360 }, { breedte: 280, maxHoogte: 420 });
  // onder: 360 - 178 - 2 - 4 = 176; boven: 150 - 2 - 4 = 144 → onder.
  assert.equal(p.y, 180);
  assert.equal(p.maxHoogte, 176);
});

test('venster smaller dan de lijst: lijst past zich aan', () => {
  const p = uitklapPositie(knop(10, 10, 100), { breedte: 200, hoogte: 600 }, { breedte: 280, maxHoogte: 420 });
  assert.equal(p.x, 4);
  assert.equal(p.breedte, 192);
});
