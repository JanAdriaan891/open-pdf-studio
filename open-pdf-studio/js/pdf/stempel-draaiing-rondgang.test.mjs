// Stempels en afbeeldingen houden hun draaiing over opslaan → heropenen, en
// elke andere lezer toont ze zoals de app.
//
// De draaiing staat in de appearance (één cm om het midden, /Rect is de
// omhullende), niet in /OPS_Rotation: die sleutel kent geen andere lezer.
// Elk geval gaat twee keer door de echte saver en lader, met de bitmap uit de
// appearance (stempel-rondgang.testhulp.mjs), op bladen met /Rotate 0, 90,
// 180 en 270, met en zonder draaiing in de app. Daarnaast een oud bestand
// zoals CP-21: schermafdrukken op een /Rotate-90-blad, de bitmap zonder
// draaiing in de ongedraaide /Rect en /OPS_Rotation -90.

import assert from 'node:assert/strict';
import test from 'node:test';
import { PDFDocument, PDFName, PDFNumber } from 'pdf-lib';
import { leegBlad, opslaan, woordenboeken } from './rondgang.testhulp.mjs';
import { laadMetBeelden, pngDataUrl, pngMaat, maakPng, appearance, getallen } from './stempel-rondgang.testhulp.mjs';

const norm = (g) => { let h = g % 360; if (h <= -180) h += 360; if (h > 180) h -= 360; return h; };
const dichtbij = (a, b, tol, wat) => assert.ok(Math.abs(a - b) <= tol, `${wat}: ${a} i.p.v. ${b}`);

const VAK = { x: 200, y: 150, width: 160, height: 80 };

function stempelModel(soort, rotation) {
  const basis = {
    id: `${soort}-1`, page: 1, ...VAK, rotation, opacity: 1, author: 'User',
    color: '#ef4444', imageData: pngDataUrl(80, 40),
  };
  return soort === 'image'
    ? { ...basis, type: 'image', stampName: 'Image', lockAspectRatio: true }
    : { ...basis, type: 'stamp', stampName: 'Mijn beeld', stampText: 'MIJN BEELD' };
}

const midden = (m) => ({ x: m.x + m.width / 2, y: m.y + m.height / 2 });

/**
 * Onafhankelijk van de lader: de cm's vóór `/Img Do` (of vóór de eerste `re`
 * bij een tekststempel) vermenigvuldigen en uitrekenen hoe het vak er op het
 * scherm uitziet: hoek met de klok mee, lengtes van de assen.
 */
function opScherm(ap, paginaRotatie, tot = '/Img Do') {
  const eind = ap.inhoud.indexOf(tot);
  assert.ok(eind > 0, `appearance tekent ${tot}`);
  const cms = [...ap.inhoud.slice(0, eind).matchAll(/(-?[\d.]+) (-?[\d.]+) (-?[\d.]+) (-?[\d.]+) (-?[\d.]+) (-?[\d.]+) cm/g)]
    .map((m) => m.slice(1, 7).map(Number));
  let ctm = [1, 0, 0, 1, 0, 0];
  for (const m of cms) {
    ctm = [
      m[0] * ctm[0] + m[1] * ctm[2], m[0] * ctm[1] + m[1] * ctm[3],
      m[2] * ctm[0] + m[3] * ctm[2], m[2] * ctm[1] + m[3] * ctm[3],
      m[4] * ctm[0] + m[5] * ctm[2] + ctm[4], m[4] * ctm[1] + m[5] * ctm[3] + ctm[5],
    ];
  }
  const alfa = Math.atan2(ctm[1], ctm[0]) * 180 / Math.PI;
  return {
    hoek: norm(paginaRotatie - alfa),
    lx: Math.hypot(ctm[0], ctm[1]),
    ly: Math.hypot(ctm[2], ctm[3]),
    det: ctm[0] * ctm[3] - ctm[1] * ctm[2],
    ctm,
  };
}

async function rondgang(modellen, { rotatie = 0, keer = 2, laad = laadMetBeelden } = {}) {
  let bytes = await leegBlad({ rotatie });
  let huidig = modellen;
  const rondes = [];
  for (let i = 0; i < keer; i++) {
    bytes = await opslaan(bytes, huidig);
    huidig = await laad(bytes);
    rondes.push({ bytes, modellen: huidig });
  }
  return rondes;
}

for (const soort of ['stamp', 'image']) {
  for (const paginaRotatie of [0, 90, 180, 270]) {
    for (const draai of [0, 30, 90, -45]) {
      test(`${soort} op /Rotate ${paginaRotatie}, draaiing ${draai}: twee keer opgeslagen, gelijk in app en bestand`, async () => {
        const model = stempelModel(soort, draai);
        const rondes = await rondgang([model], { rotatie: paginaRotatie });
        for (const [i, { bytes, modellen }] of rondes.entries()) {
          const wat = `ronde ${i + 1}`;
          const terug = modellen.filter((m) => m.type === soort);
          assert.equal(terug.length, 1, `${wat}: één ${soort}`);
          const [m] = terug;
          dichtbij(norm(m.rotation || 0), norm(draai), 0.01, `${wat}: draaiing`);
          dichtbij(m.width, VAK.width, 0.05, `${wat}: breedte`);
          dichtbij(m.height, VAK.height, 0.05, `${wat}: hoogte`);
          dichtbij(midden(m).x, midden(VAK).x, 0.05, `${wat}: midden x`);
          dichtbij(midden(m).y, midden(VAK).y, 0.05, `${wat}: midden y`);
          assert.equal(m.apImageSpace, 'visual', `${wat}: pixels rechtop in het vak`);
          assert.deepEqual(pngMaat(m.imageData), { b: 80, h: 40 }, `${wat}: dezelfde bitmap`);

          const lijst = await woordenboeken(bytes);
          const stempels = lijst.filter(({ dict }) => dict.get(PDFName.of('Subtype'))?.toString() === '/Stamp');
          assert.equal(stempels.length, 1, `${wat}: één /Stamp in het bestand`);
          const { dict } = stempels[0];
          assert.equal(dict.get(PDFName.of('OPS_Rotation')), undefined, `${wat}: geen /OPS_Rotation`);

          // Wat elke lezer tekent: /BBox past 1:1 op /Rect, /Matrix identiteit,
          // en de bitmap staat op het scherm in de draaiing van de app.
          const ap = appearance(lijst.doc, dict);
          const rect = getallen(dict.get(PDFName.of('Rect')));
          assert.ok(ap.matrix === null || ap.matrix.join() === '1,0,0,1,0,0', `${wat}: /Matrix identiteit`);
          dichtbij(ap.bbox[2] - ap.bbox[0], rect[2] - rect[0], 0.01, `${wat}: /BBox-breedte = /Rect`);
          dichtbij(ap.bbox[3] - ap.bbox[1], rect[3] - rect[1], 0.01, `${wat}: /BBox-hoogte = /Rect`);
          const s = opScherm(ap, paginaRotatie);
          assert.ok(s.det > 0, `${wat}: niet gespiegeld`);
          dichtbij(s.hoek, norm(draai), 0.01, `${wat}: draaiing op het scherm`);
          dichtbij(s.lx, VAK.width, 0.05, `${wat}: beeldbreedte op het scherm`);
          dichtbij(s.ly, VAK.height, 0.05, `${wat}: beeldhoogte op het scherm`);
          // Het midden van de bitmap is het midden van /Rect.
          const mx = 0.5 * s.ctm[0] + 0.5 * s.ctm[2] + s.ctm[4] + rect[0] - ap.bbox[0];
          const my = 0.5 * s.ctm[1] + 0.5 * s.ctm[3] + s.ctm[5] + rect[1] - ap.bbox[1];
          dichtbij(mx, (rect[0] + rect[2]) / 2, 0.05, `${wat}: midden x in het bestand`);
          dichtbij(my, (rect[1] + rect[3]) / 2, 0.05, `${wat}: midden y in het bestand`);
        }
      });
    }
  }
}

for (const paginaRotatie of [0, 90, 180, 270]) {
  for (const draai of [0, 30]) {
    test(`tekststempel op /Rotate ${paginaRotatie}, draaiing ${draai}: draaiing en vak komen terug`, async () => {
      const model = {
        id: 'ts', type: 'stamp', page: 1, ...VAK, rotation: draai, opacity: 1, author: 'User',
        stampName: 'Goedgekeurd', stampText: 'GOEDGEKEURD', stampColor: '#16a34a', color: '#16a34a',
      };
      const rondes = await rondgang([model], { rotatie: paginaRotatie });
      for (const [i, { bytes, modellen }] of rondes.entries()) {
        const wat = `ronde ${i + 1}`;
        const [m] = modellen.filter((a) => a.type === 'stamp');
        assert.ok(m, `${wat}: stempel terug`);
        assert.equal(m.stampText, 'GOEDGEKEURD');
        dichtbij(norm(m.rotation || 0), draai, 0.01, `${wat}: draaiing`);
        dichtbij(m.width, VAK.width, 0.05, `${wat}: breedte`);
        dichtbij(m.height, VAK.height, 0.05, `${wat}: hoogte`);
        dichtbij(midden(m).x, midden(VAK).x, 0.05, `${wat}: midden x`);
        dichtbij(midden(m).y, midden(VAK).y, 0.05, `${wat}: midden y`);
        const lijst = await woordenboeken(bytes);
        const { dict } = lijst.find(({ dict: d }) => d.get(PDFName.of('Subtype'))?.toString() === '/Stamp');
        assert.equal(dict.get(PDFName.of('OPS_Rotation')), undefined);
        const s = opScherm(appearance(lijst.doc, dict), paginaRotatie, ' re W n');
        dichtbij(s.hoek, draai, 0.01, `${wat}: draaiing op het scherm`);
      }
    });
  }
}

/**
 * Een bestand zoals -CP-21 Constructieoverzicht.pdf: A3 liggend via
 * /Rotate 90, een geplakte schermafdruk als /Stamp. De appearance tekent de
 * bitmap zonder draaiing in de ongedraaide /Rect (326,97 × 474,67), maar de
 * pixels (1138 × 784, hier op schaal) liggen zoals op het scherm. Een oudere
 * versie schreef er /OPS_Rotation -90 bij.
 */
async function cp21Achtig({ pixels = [114, 78], rect = [300, 200, 626.967, 674.666], opsRotation = -90, rotatie = 90 } = {}) {
  const doc = await PDFDocument.create();
  const pagina = doc.addPage([842, 1191]);
  pagina.node.set(PDFName.of('Rotate'), PDFNumber.of(rotatie));
  const png = await doc.embedPng(maakPng(...pixels));
  const bw = rect[2] - rect[0];
  const bh = rect[3] - rect[1];
  const ap = doc.context.register(doc.context.stream(`q\n${bw} 0 0 ${bh} 0 0 cm\n/Img Do\nQ\n`, {
    Type: 'XObject', Subtype: 'Form', BBox: [0, 0, bw, bh],
    Resources: doc.context.obj({ XObject: doc.context.obj({ Img: png.ref }) }),
  }));
  const annot = doc.context.obj({
    Type: 'Annot', Subtype: 'Stamp', Rect: rect, Name: 'clipboard.image.0800002c',
    F: 4, AP: doc.context.obj({ N: ap }),
    ...(opsRotation !== null ? { OPS_Rotation: opsRotation } : {}),
  });
  pagina.node.set(PDFName.of('Annots'), doc.context.obj([doc.context.register(annot)]));
  return doc.save();
}

test('CP-21: een oude schermafdruk op een /Rotate-90-blad staat rechtop en vult zijn vak op het scherm', async () => {
  const bytes = await cp21Achtig();
  const [m] = (await laadMetBeelden(bytes)).filter((a) => a.type === 'stamp');
  assert.equal(m.rotation, 0, '/OPS_Rotation -90 telt niet, de bitmap staat rechtop');
  // Op het scherm is het vak liggend: 474,67 breed, 326,97 hoog.
  dichtbij(m.width, 474.666, 0.01, 'breedte op het scherm');
  dichtbij(m.height, 326.967, 0.01, 'hoogte op het scherm');
  assert.equal(m.apImageSpace, 'visual');
  // Midden: /Rect-midden (463,48 ; 437,33) op het blad; /Rotate 90 →
  // scherm x = y_pdf, y = x_pdf.
  dichtbij(midden(m).x, 437.333, 0.01, 'midden x');
  dichtbij(midden(m).y, 463.4835, 0.01, 'midden y');
});

test('CP-21: na opslaan toont elke lezer de schermafdruk rechtop, ook na een tweede keer', async () => {
  let bytes = await cp21Achtig();
  let modellen = await laadMetBeelden(bytes);
  for (let ronde = 1; ronde <= 2; ronde++) {
    bytes = await opslaan(bytes, modellen);
    modellen = await laadMetBeelden(bytes);
    const [m] = modellen.filter((a) => a.type === 'stamp');
    assert.equal(m.rotation, 0, `ronde ${ronde}: rechtop`);
    dichtbij(m.width, 474.666, 0.01, `ronde ${ronde}: breedte`);
    dichtbij(m.height, 326.967, 0.01, `ronde ${ronde}: hoogte`);
    assert.equal(m.apImageSpace, 'visual');
    const lijst = await woordenboeken(bytes);
    const { dict } = lijst.find(({ dict: d }) => d.get(PDFName.of('Subtype'))?.toString() === '/Stamp');
    assert.equal(dict.get(PDFName.of('OPS_Rotation')), undefined, `ronde ${ronde}: geen /OPS_Rotation meer`);
    const rect = getallen(dict.get(PDFName.of('Rect')));
    dichtbij(rect[0], 300, 0.01, 'zelfde /Rect');
    dichtbij(rect[2], 626.967, 0.01, 'zelfde /Rect');
    const s = opScherm(appearance(lijst.doc, dict), 90);
    dichtbij(s.hoek, 0, 0.01, `ronde ${ronde}: rechtop op het scherm`);
    dichtbij(s.lx, 474.666, 0.01, `ronde ${ronde}: vult de breedte op het scherm`);
    dichtbij(s.ly, 326.967, 0.01, `ronde ${ronde}: vult de hoogte op het scherm`);
  }
});

test('CP-21 op /Rotate 270 werkt net zo', async () => {
  const [m] = (await laadMetBeelden(await cp21Achtig({ rotatie: 270, opsRotation: 90 }))).filter((a) => a.type === 'stamp');
  assert.equal(m.rotation, 0);
  dichtbij(m.width, 474.666, 0.01, 'breedte');
});

test('een bitmap die bij het ongedraaide vak past, staat zoals elke lezer hem toont (kwartslag mee met het blad)', async () => {
  // Zoals VO Constructie.pdf: de pixels liggen in PDF-ruimte; de pagina
  // draait ze mee. Niet platgedrukt in het schermvak.
  const bytes = await cp21Achtig({ pixels: [78, 114], opsRotation: null });
  const [m] = (await laadMetBeelden(bytes)).filter((a) => a.type === 'stamp');
  assert.equal(m.rotation, 90);
  dichtbij(m.width, 326.967, 0.01, 'breedte langs de beeldas');
  dichtbij(m.height, 474.666, 0.01, 'hoogte langs de beeldas');
  // Opslaan schrijft hem terug zoals hij stond: geen draai-cm, zelfde /Rect.
  const uit = await opslaan(bytes, await laadMetBeelden(bytes));
  const lijst = await woordenboeken(uit);
  const { dict } = lijst.find(({ dict: d }) => d.get(PDFName.of('Subtype'))?.toString() === '/Stamp');
  const ap = appearance(lijst.doc, dict);
  assert.doesNotMatch(ap.inhoud, /0 1 -1 0 0 0 cm|0 -1 1 0 0 0 cm/, 'geen draai-cm');
  const rect = getallen(dict.get(PDFName.of('Rect')));
  [300, 200, 626.967, 674.666].forEach((v, i) => dichtbij(rect[i], v, 0.01, `/Rect[${i}]`));
});

test('een /SquareImage van een ander programma op een /Rotate-90-blad: rechtop zoals zijn appearance, ook na opslaan', async () => {
  // Zoals B3 K-1-1B-e: de appearance draait de afbeelding een kwartslag
  // terug, zodat hij op het gedraaide blad rechtop staat.
  const doc = await PDFDocument.create();
  const pagina = doc.addPage([842, 1191]);
  pagina.node.set(PDFName.of('Rotate'), PDFNumber.of(90));
  const png = await doc.embedPng(maakPng(90, 77));
  const rect = [199.26, 963.9, 628.48, 1465.12]; // 429,22 × 501,22 in PDF-ruimte
  const ap = doc.context.register(doc.context.stream(
    `1 0 0 RG 0 w 199.26 963.9 429.22 501.22 re q 0 501.22 -429.22 0 628.48 963.9 cm /Image Do Q `, {
      Type: 'XObject', Subtype: 'Form', BBox: [199.26, 963.9, 628.48, 1465.12],
      Matrix: [1, 0, 0, 1, -199.26, -963.9],
      Resources: doc.context.obj({ XObject: doc.context.obj({ Image: png.ref }) }),
    }));
  const annot = doc.context.obj({
    Type: 'Annot', Subtype: 'Square', IT: 'SquareImage', Rect: rect, F: 4,
    Image: png.ref, AP: doc.context.obj({ N: ap }),
  });
  pagina.node.set(PDFName.of('Annots'), doc.context.obj([doc.context.register(annot)]));
  let bytes = await doc.save();
  let modellen = await laadMetBeelden(bytes);
  for (let ronde = 0; ronde <= 2; ronde++) {
    const [m] = modellen.filter((a) => a.type === 'image');
    assert.ok(m, `ronde ${ronde}: afbeelding`);
    dichtbij(norm(m.rotation || 0), 0, 0.01, `ronde ${ronde}: rechtop`);
    dichtbij(m.width, 501.22, 0.01, `ronde ${ronde}: breedte op het scherm`);
    dichtbij(m.height, 429.22, 0.01, `ronde ${ronde}: hoogte op het scherm`);
    assert.equal(m.apImageSpace, 'visual');
    if (ronde === 2) break;
    bytes = await opslaan(bytes, modellen);
    modellen = await laadMetBeelden(bytes);
    const lijst = await woordenboeken(bytes);
    const { dict } = lijst.find(({ dict: d }) => d.get(PDFName.of('Subtype'))?.toString() === '/Stamp');
    const s = opScherm(appearance(lijst.doc, dict), 90);
    dichtbij(s.hoek, 0, 0.01, `ronde ${ronde + 1}: rechtop in het bestand`);
    dichtbij(s.lx, 501.22, 0.01, `ronde ${ronde + 1}: breedte in het bestand`);
  }
});

test('een vrijwel vierkante bitmap is geen oude schermafdruk', async () => {
  const bytes = await cp21Achtig({ pixels: [100, 96], rect: [300, 200, 500, 404], opsRotation: -90 });
  const [m] = (await laadMetBeelden(bytes)).filter((a) => a.type === 'stamp');
  // Zoals de appearance hem tekent: met het blad mee gedraaid.
  assert.equal(m.rotation, 90);
});
