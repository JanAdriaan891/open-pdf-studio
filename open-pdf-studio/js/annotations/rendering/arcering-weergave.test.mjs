// Arceringen bij een draaihoek en bij ver uitzoomen (#279).
//
// 1. Een rechthoek, ellips, veelhoek of wolk met een arceringshoek kreeg maar
//    een deel gearceerd: het arceringsgebied was 1,5x het kader in het
//    gedraaide assenstelsel, en een langgerekte vorm onder 90° paste daar
//    niet in. Nu bedekt de arcering bij elke hoek de hele vorm.
// 2. Bij ver uitzoomen verving de renderer een fijne arcering door één
//    vlak in de volle arceringskleur. Een arcering van dunne lijnen is dan
//    een lichte toon; het vlak sprong naar zwart en de achtergrondkleur
//    verdween. Nu krijgt dat vlak de dekking van de lijnen als alfa.

import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

globalThis.window = globalThis.window || {};
globalThis.document = globalThis.document || { createElement: () => null };
globalThis.__arceringTestState = { preferences: {}, documents: [], activeDocumentIndex: 0 };

const bronUrl = new URL('./hatch-patterns.js', import.meta.url);
const bron = readFileSync(bronUrl, 'utf8')
  .replace(/^import \{ arcControlPoint \}.*$/m,
    'const arcControlPoint = (a, b) => ({ x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 });')
  .replace(/^import \{ state \}.*$/m, 'const state = globalThis.__arceringTestState;')
  .replace(/from '(\.[^']*)'/g, (_m, spec) => `from '${new URL(spec, bronUrl).href}'`);
const { applyHatchFill, applyHatchFillPolygon } =
  await import('data:text/javascript;base64,' + Buffer.from(bron, 'utf8').toString('base64'));

// Opnemende context met transformaties. Met `schaal` krijgt hij ook
// getTransform en een canvasmaat, zoals een echt canvas op die zoom.
function maakRecorder({ schaal = null } = {}) {
  let m = schaal ? [schaal, 0, 0, schaal, 0, 0] : [1, 0, 0, 1, 0, 0];
  const stapel = [];
  const T = (x, y) => [m[0] * x + m[2] * y + m[4], m[1] * x + m[3] * y + m[5]];
  const ops = { lijnen: [], vullingen: [] };
  let pad = [];
  let cur = null;
  const ctx = {
    canvas: schaal ? { width: 2000, height: 2000 } : { width: 0, height: 0 },
    globalAlpha: 1, strokeStyle: '#000', fillStyle: '#000', lineWidth: 1,
    save() { stapel.push({ m: m.slice(), a: ctx.globalAlpha }); },
    restore() { const t = stapel.pop(); m = t.m; ctx.globalAlpha = t.a; },
    translate(tx, ty) { m = [m[0], m[1], m[2], m[3], m[0] * tx + m[2] * ty + m[4], m[1] * tx + m[3] * ty + m[5]]; },
    rotate(a) {
      const c = Math.cos(a), s = Math.sin(a);
      m = [m[0] * c + m[2] * s, m[1] * c + m[3] * s, -m[0] * s + m[2] * c, -m[1] * s + m[3] * c, m[4], m[5]];
    },
    scale(sx, sy) { m = [m[0] * sx, m[1] * sx, m[2] * sy, m[3] * sy, m[4], m[5]]; },
    clip() {}, closePath() {}, setLineDash() {}, rect() {},
    quadraticCurveTo(_a, _b, x, y) { cur = T(x, y); },
    beginPath() { pad = []; cur = null; },
    moveTo(x, y) { cur = T(x, y); },
    lineTo(x, y) { const p = T(x, y); if (cur) pad.push([cur[0], cur[1], p[0], p[1]]); cur = p; },
    arc() {}, fill() {},
    stroke() { for (const s of pad) ops.lijnen.push({ s, breedte: ctx.lineWidth }); },
    fillRect(x, y, w, h) { ops.vullingen.push({ alfa: ctx.globalAlpha, kleur: ctx.fillStyle }); },
    getTransform() {
      const [a, b, c, d, e, f] = m;
      return {
        a, b, c, d, e, f,
        invertSelf() {
          const det = a * d - b * c;
          return { a: d / det, b: -b / det, c: -c / det, d: a / det, e: (c * f - d * e) / det, f: (b * e - a * f) / det };
        },
      };
    },
  };
  if (!schaal) delete ctx.getTransform;
  return { ctx, ops };
}

function afstandTotSegment(px, py, [x1, y1, x2, y2]) {
  const dx = x2 - x1, dy = y2 - y1;
  const l2 = dx * dx + dy * dy;
  const t = l2 ? Math.max(0, Math.min(1, ((px - x1) * dx + (py - y1) * dy) / l2)) : 0;
  return Math.hypot(px - (x1 + t * dx), py - (y1 + t * dy));
}

// Grootste afstand van een punt in de vorm tot de dichtstbijzijnde
// arceringslijn. Bij lijnen om de 10 is dat hooguit 5 als alles bedekt is.
function grootsteGat(ops, vorm) {
  let grootste = 0;
  for (let i = 0; i <= 40; i++) {
    for (let j = 0; j <= 8; j++) {
      const px = vorm.x + (vorm.width * i) / 40;
      const py = vorm.y + (vorm.height * j) / 8;
      let min = Infinity;
      for (const { s } of ops.lijnen) min = Math.min(min, afstandTotSegment(px, py, s));
      grootste = Math.max(grootste, min);
    }
  }
  return grootste;
}

const LANG = { x: 100, y: 300, width: 340, height: 60 };

for (const hoek of [0, 30, 45, 60, 90, 135, 165]) {
  test(`langgerekte rechthoek met arceringshoek ${hoek}°: de hele vorm is gearceerd`, () => {
    const { ctx, ops } = maakRecorder();
    applyHatchFill(ctx, { ...LANG, hatchPattern: 'horizontal', hatchColor: '#000', hatchScale: 100, hatchAngle: hoek });
    assert.ok(ops.lijnen.length > 0);
    assert.ok(grootsteGat(ops, LANG) <= 5 + 1e-6, `gat ${grootsteGat(ops, LANG).toFixed(1)}`);
  });
}

test('staande rechthoek onder 90° en een ellips-kader onder 45°: ook volledig', () => {
  for (const [vorm, hoek] of [[{ x: 50, y: 50, width: 40, height: 400 }, 90], [{ x: 0, y: 0, width: 500, height: 80 }, 45]]) {
    const { ctx, ops } = maakRecorder();
    applyHatchFill(ctx, { ...vorm, hatchPattern: 'vertical', hatchColor: '#000', hatchScale: 100, hatchAngle: hoek });
    assert.ok(grootsteGat(ops, vorm) <= 5 + 1e-6);
  }
});

test('zonder hoek blijft het arceringsgebied 1,5x het kader (zelfde lijnen als voorheen)', () => {
  const { ctx, ops } = maakRecorder();
  applyHatchFill(ctx, { ...LANG, hatchPattern: 'horizontal', hatchColor: '#000', hatchScale: 100, hatchAngle: 0 });
  // Horizontale lijnen over de volle breedte van het uitgebreide gebied.
  const xs = ops.lijnen.flatMap(({ s }) => [s[0], s[2]]);
  assert.equal(Math.min(...xs), 270 - 255);
  assert.equal(Math.max(...xs), 270 + 255);
});

const VIERKANT = [{ x: 0, y: 0 }, { x: 200, y: 0 }, { x: 200, y: 200 }, { x: 0, y: 200 }];

test('ver uitgezoomd: een fijne kruisarcering wordt een lichte toon, geen volle kleur', () => {
  // Kruisarcering op 25%: lijnen om 2,5 pt, 0,4 pt breed. Op 10% zoom liggen
  // ze 0,25 px uit elkaar → samengevoegd tot een vlak per familie.
  const { ctx, ops } = maakRecorder({ schaal: 0.1 });
  applyHatchFillPolygon(ctx, VIERKANT, null, 'crosshatch', '#000000', 25, 0);
  assert.equal(ops.lijnen.length, 0);
  assert.equal(ops.vullingen.length, 2);
  for (const v of ops.vullingen) assert.ok(Math.abs(v.alfa - 0.4 / 2.5) < 1e-9, `alfa ${v.alfa}`);
});

test('gestreepte en gestippelde families: de dekking telt alleen het getekende deel', () => {
  // lood-blokken: lijnen om 1 × 1,42 pt, streep [4,5 aan, 4,5 uit] → half getekend.
  const lood = maakRecorder({ schaal: 0.2 });
  applyHatchFillPolygon(lood.ctx, VIERKANT, null, 'lood-blokken', '#000000', 142, 0);
  assert.equal(lood.ops.vullingen.length, 1);
  assert.ok(Math.abs(lood.ops.vullingen[0].alfa - (0.4 / 1.42) * 0.5) < 1e-9);
  // Stippen om 10 pt met straal 1 pt → π/100 van het vlak.
  const stip = maakRecorder({ schaal: 0.03 });
  applyHatchFillPolygon(stip.ctx, VIERKANT, null, 'dots', '#000000', 100, 0);
  assert.equal(stip.ops.vullingen.length, 1);
  assert.ok(Math.abs(stip.ops.vullingen[0].alfa - Math.PI / 100) < 1e-9);
});

test('met dunne lijnen (TL) van één pixel loopt een dichte arcering wel helemaal dicht', () => {
  const st = globalThis.__arceringTestState;
  st.preferences = { thinLines: true };
  st.documents = [{ scale: 0.1 }];
  try {
    const { ctx, ops } = maakRecorder({ schaal: 0.1 });
    applyHatchFillPolygon(ctx, VIERKANT, null, 'crosshatch', '#000000', 25, 0);
    assert.equal(ops.vullingen.length, 2);
    for (const v of ops.vullingen) assert.equal(v.alfa, 1);
  } finally {
    st.preferences = {};
    st.documents = [];
  }
});

test('niet verzadigd: gewoon lijnen, geen vlak', () => {
  const { ctx, ops } = maakRecorder({ schaal: 1 });
  applyHatchFillPolygon(ctx, VIERKANT, null, 'crosshatch', '#000000', 25, 0);
  assert.equal(ops.vullingen.length, 0);
  assert.ok(ops.lijnen.length > 0);
});
