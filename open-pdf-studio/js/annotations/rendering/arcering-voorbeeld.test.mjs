// Het voorbeeld naast een arceringstype in de Type-kiezer moet de arcering
// zijn die het type werkelijk op het vlak zet (#279). Het oude voorbeeld was
// een nagetekend icoontje uit een handvol "families": raster liggend/staand
// toonden maar één lijnrichting, NEN47-1 en -3 stonden als metselverband in
// de lijst, de volle vullingen (NEN47-5, -18, -19) als schuine lijnen, elke
// diagonaal gespiegeld, en smal/midden/breed zagen er hetzelfde uit.
//
// Deze test tekent het voorbeeld van ELK type met een opnemende context en
// controleert het tegen de patroondefinitie van dat type.

import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

globalThis.window = globalThis.window || {};
globalThis.document = globalThis.document || { createElement: () => null };

// Zelfde aanpak als hatch-geometrie.test.mjs: de echte bron, alleen de
// app-brede state-import vervangen door een stub.
function laadBron(pad, vervangingen) {
  const url = new URL(pad, import.meta.url);
  let bron = readFileSync(url, 'utf8');
  for (const [patroon, door] of vervangingen) bron = bron.replace(patroon, door);
  bron = bron.replace(/from '(\.[^']*)'/g, (_m, spec) => `from '${new URL(spec, url).href}'`);
  return import('data:text/javascript;base64,' + Buffer.from(bron, 'utf8').toString('base64'));
}

const STATE_STUB = 'const state = { preferences: {}, documents: [], activeDocumentIndex: 0 };';
const hatch = await laadBron('./hatch-patterns.js', [
  [/^import \{ arcControlPoint \}.*$/m, 'const arcControlPoint = (a, b) => ({ x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 });'],
  [/^import \{ state \}.*$/m, STATE_STUB],
]);
const stijlTypen = await laadBron('../style-types.js', [
  [/^import \{ state as _appState \}.*$/m, 'const _appState = { preferences: {} };'],
]);
const { tekenArceringVoorbeeld, arceringVoorbeeldSpec, getHatchPattern, ARCERING_VOORBEELD_PAPIER } = hatch;
const TYPEN = stijlTypen.STYLE_TYPES.filledArea;

// --- opnemende 2D-context met transformaties --------------------------------
// Paden worden pas vastgelegd bij stroke()/fill(); een knippad telt dus niet
// als getekende lijn.
function maakRecorder() {
  let m = [1, 0, 0, 1, 0, 0];
  const stapel = [];
  const T = (x, y) => [m[0] * x + m[2] * y + m[4], m[1] * x + m[3] * y + m[5]];
  const ops = { lijnen: [], stippen: [], vullingen: [] };
  let pad = [];
  let bogen = [];
  let cur = null;
  const ctx = {
    canvas: { width: 0, height: 0 },
    strokeStyle: '#000000', fillStyle: '#000000', lineWidth: 1,
    save() { stapel.push({ m: m.slice(), s: ctx.strokeStyle, f: ctx.fillStyle, w: ctx.lineWidth }); },
    restore() { const t = stapel.pop(); m = t.m; ctx.strokeStyle = t.s; ctx.fillStyle = t.f; ctx.lineWidth = t.w; },
    scale(sx, sy) { m = [m[0] * sx, m[1] * sx, m[2] * sy, m[3] * sy, m[4], m[5]]; },
    translate(tx, ty) { m = [m[0], m[1], m[2], m[3], m[0] * tx + m[2] * ty + m[4], m[1] * tx + m[3] * ty + m[5]]; },
    rotate(a) {
      const c = Math.cos(a), s = Math.sin(a);
      m = [m[0] * c + m[2] * s, m[1] * c + m[3] * s, -m[0] * s + m[2] * c, -m[1] * s + m[3] * c, m[4], m[5]];
    },
    clip() {}, closePath() {}, setLineDash() {},
    quadraticCurveTo(_cx, _cy, x, y) { cur = T(x, y); },
    beginPath() { pad = []; bogen = []; cur = null; },
    moveTo(x, y) { cur = T(x, y); },
    lineTo(x, y) { const p = T(x, y); if (cur) pad.push([cur[0], cur[1], p[0], p[1]]); cur = p; },
    arc(x, y) { bogen.push(T(x, y)); },
    stroke() { for (const s of pad) ops.lijnen.push({ s, kleur: ctx.strokeStyle, breedte: ctx.lineWidth }); },
    fill() { for (const b of bogen) ops.stippen.push({ b, kleur: ctx.fillStyle }); },
    fillRect(x, y, w, h) { ops.vullingen.push({ van: T(x, y), tot: T(x + w, y + h), kleur: ctx.fillStyle }); },
  };
  return { ctx, ops };
}

const B = 64, H = 24;
function voorbeeld(type, pixelRatio = 1) {
  const { ctx, ops } = maakRecorder();
  tekenArceringVoorbeeld(ctx, arceringVoorbeeldSpec(type.props, type.color), { breedte: B, hoogte: H, pixelRatio });
  return ops;
}

// Richting van een segment als hoek in [0, 180).
const richting = ([x1, y1, x2, y2]) => {
  let a = Math.atan2(y2 - y1, x2 - x1) * 180 / Math.PI;
  a = ((a % 180) + 180) % 180;
  return Math.round(a * 10) / 10 % 180;
};
const familieRichting = (hoek) => Math.round((((hoek % 180) + 180) % 180) * 10) / 10 % 180;

test('er zijn arceringstypen om te controleren', () => {
  assert.ok(TYPEN.length >= 100, `aantal typen: ${TYPEN.length}`);
});

for (const type of TYPEN) {
  const p = type.props;
  const patroon = getHatchPattern(p.hatchPattern);

  test(`voorbeeld ${type.id}: patroon ${p.hatchPattern} @${p.hatchScale}% zoals op het vlak`, () => {
    assert.ok(patroon, `onbekend patroon ${p.hatchPattern}`);
    const ops = voorbeeld(type);

    // Achtergrond: de vulkleur van het type, anders wit papier.
    const achtergrond = ops.vullingen[0];
    assert.equal(achtergrond.kleur, p.fillColor || ARCERING_VOORBEELD_PAPIER, 'achtergrond');

    const families = patroon.lineFamilies || [];
    if (families.length === 0) {
      // Volle vulling in de arceringskleur over het hele vakje.
      const vol = ops.vullingen.slice(1).find((v) => v.kleur === p.hatchColor);
      assert.ok(vol, 'volle vulling in de arceringskleur');
      assert.ok(vol.van[0] <= 0 && vol.van[1] <= 0 && vol.tot[0] >= B && vol.tot[1] >= H, 'vulling dekt het vakje');
      assert.equal(ops.lijnen.length, 0);
      return;
    }

    // Lijnen en stippen in de arceringskleur, niets in een andere kleur.
    for (const l of ops.lijnen) assert.equal(l.kleur, p.hatchColor, 'lijnkleur');
    for (const s of ops.stippen) assert.equal(s.kleur, p.hatchColor, 'stipkleur');

    // Precies de lijnrichtingen van het patroon (hoek 0: geen extra draaiing).
    const lijnFamilies = families.filter((f) => !(f.dashPattern && f.dashPattern.includes(0)));
    const verwacht = [...new Set(lijnFamilies.map((f) => familieRichting(f.angle)))].sort((a, b) => a - b);
    const getekend = [...new Set(ops.lijnen.map((l) => richting(l.s)))].sort((a, b) => a - b);
    assert.deepEqual(getekend, verwacht, 'lijnrichtingen');

    const heeftStippen = families.some((f) => f.dashPattern && f.dashPattern.includes(0));
    assert.equal(ops.stippen.length > 0, heeftStippen, 'stippen');
  });
}

test('smal, midden en breed verschillen: de lijnafstand volgt de hatchScale', () => {
  const afstand = (id) => {
    const type = TYPEN.find((t) => t.id === id);
    const ops = voorbeeld(type);
    // 45°-lijnen: loodrechte positie p = (y - x) / √2.
    const posities = [...new Set(ops.lijnen.map(({ s: [x, y] }) => Math.round(((y - x) / Math.SQRT2) * 100) / 100))]
      .sort((a, b) => a - b);
    const verschillen = posities.slice(1).map((v, i) => Math.round((v - posities[i]) * 10) / 10);
    return Math.min(...verschillen);
  };
  assert.equal(afstand('inb-diagonaal-smal'), 2.8);
  assert.equal(afstand('inb-diagonaal-midden'), 5.7);
  assert.equal(afstand('inb-diagonaal-breed'), 8.5);
});

test('een diagonaal onder 45° loopt in het voorbeeld dezelfde kant op als op het vlak', () => {
  // Canvas-y wijst naar beneden: 45° loopt van linksboven naar rechtsonder.
  const type = TYPEN.find((t) => t.id === 'algemeen');
  const ops = voorbeeld(type);
  assert.ok(ops.lijnen.length > 0);
  for (const { s: [x1, y1, x2, y2] } of ops.lijnen) assert.ok((x2 - x1) * (y2 - y1) > 0, 'linksboven → rechtsonder');
});

test('op een scherm met hoge pixeldichtheid blijft het dezelfde tekening, alleen scherper', () => {
  const type = TYPEN.find((t) => t.id === 'inb-staal');
  const een = voorbeeld(type, 1);
  const twee = voorbeeld(type, 2);
  const sleutel = (ops, f) => ops.lijnen.map(({ s }) => s.map((v) => Math.round((v / f) * 100) / 100).join(',')).sort();
  assert.deepEqual(sleutel(twee, 2), sleutel(een, 1));
  // Lijnen minstens één apparaatpixel breed.
  for (const l of twee.lijnen) assert.ok(l.breedte * 2 >= 1 - 1e-9);
});

test('de Type-kiezer gebruikt dit voorbeeld voor arceringen', () => {
  const bron = readFileSync(new URL('../../solid/components/properties-panel/DimensionTypeSection.jsx', import.meta.url), 'utf8');
  assert.match(bron, /arceringVoorbeeldUrl\(\s*arceringVoorbeeldSpec\(/);
  assert.doesNotMatch(bron, /_hatchFamily/);
});
