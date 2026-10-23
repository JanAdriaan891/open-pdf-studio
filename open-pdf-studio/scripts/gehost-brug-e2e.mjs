// De brug naar de gastpagina (#694) in een echte browser.
//
// De gehoste bundel (`npm run build:hosted`, ongewijzigd) staat op oorsprong A
// (http://127.0.0.1:3601). Een testpagina op oorsprong B
// (http://localhost:3602) laadt hem in
//   <iframe sandbox="allow-scripts allow-same-origin allow-downloads allow-modals">
// met `#ouder=<B>&app=pdf&bestand=DOC-1` en beantwoordt het protocol. Twee
// kwaadwillende vensters doen intussen hun best: een iframe op een derde
// oorsprong (http://127.0.0.1:3602) en een tweede iframe op oorsprong B zelf.
// Bij elk bericht van de app sturen zij eerst een vervalst antwoord; de
// testpagina antwoordt pas daarna.
//
// Gecontroleerd in headless Chromium:
//  1. de handdruk: de gastpagina laadt "later" (zwijgt eerst 2 s); vervalste
//     antwoorden op hallo tellen niet, de app blijft hallo zeggen;
//  2. het document uit `bestand` opent, opgehaald zonder cookies;
//  3. een annotatie (rechthoek) gaat met Ctrl+S terug naar de gastpagina; de
//     bytes daar bevatten de annotatie (pdf-lib);
//  4. lijst en versies komen over de brug, met de nieuwe versie erbij;
//  5. geen enkel vervalst antwoord telde (het vervalste bestand is nooit
//     opgehaald, de lijst en de versies zijn de echte);
//  6. een mislukte open (adres met omleiding) toont de vertaalde melding;
//  7. met een `ouder` die niet de pagina erboven is, start de brug niet.
//
// Draaien:  npm run test:hosted-bridge   (bouwt eerst de gehoste bundel)
// of los:   node scripts/gehost-brug-e2e.mjs [map-met-bundel]   (standaard dist)

import http from 'node:http';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium } from 'playwright';
import { PDFDocument, PDFName, StandardFonts } from 'pdf-lib';

const hier = path.dirname(fileURLToPath(import.meta.url));
const BUNDEL = path.resolve(hier, '..', process.argv[2] || 'dist');
const POORT_APP = Number(process.env.OPDS_BRUG_POORT_APP || 3601);
const POORT_GAST = Number(process.env.OPDS_BRUG_POORT_GAST || 3602);
const APP = `http://127.0.0.1:${POORT_APP}`;          // oorsprong A
const GAST = `http://localhost:${POORT_GAST}`;        // oorsprong B (ouder)
const DERDE = `http://127.0.0.1:${POORT_GAST}`;       // oorsprong C (kwaad)
const UIT = path.join(os.tmpdir(), 'opds-gehost-brug-e2e');
fs.mkdirSync(UIT, { recursive: true });

if (!fs.existsSync(path.join(BUNDEL, 'index.html'))) {
  console.error(`Geen bundel in ${BUNDEL}: eerst npm run build:hosted`);
  process.exit(2);
}

const regels = [];
const noteer = (...a) => { const s = a.join(' '); regels.push(s); console.log(s); };
const fouten = [];
const eis = (voorwaarde, bericht) => { if (!voorwaarde) { fouten.push(bericht); noteer('  FOUT: ' + bericht); } };

// ── Testbestanden (zelf gemaakt) ───────────────────────────────────────────
async function maakPdf(titel, paginas) {
  const doc = await PDFDocument.create();
  const font = await doc.embedFont(StandardFonts.Helvetica);
  for (let i = 0; i < paginas; i++) {
    const p = doc.addPage([595, 842]);
    p.drawText(`${titel} - pagina ${i + 1}`, { x: 60, y: 760, size: 24, font });
    p.drawRectangle({ x: 60, y: 200, width: 475, height: 500, borderWidth: 1 });
  }
  return new Uint8Array(await doc.save());
}

const echt = await maakPdf('Plattegrond', 2);
const vervalst = await maakPdf('VERVALST', 1);

// ── De opslag achter de gastpagina (oorsprong B) ───────────────────────────
const opslag = {
  docs: new Map([['DOC-1', { naam: 'Plattegrond.pdf', versies: [{ version: '1', bytes: echt, modified: '2026-10-01' }] }]]),
  adressen: new Map(),      // token -> { bestand, geldigTot }
  ophalen: [],              // { pad, cookie, origin }
  vervalstOpgehaald: 0,
};
const laatsteBytes = (id) => opslag.docs.get(id).versies.at(-1).bytes;

const SOORTEN = {
  '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.mjs': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8', '.json': 'application/json', '.svg': 'image/svg+xml', '.png': 'image/png',
  '.ico': 'image/x-icon', '.wasm': 'application/wasm', '.woff2': 'font/woff2', '.woff': 'font/woff', '.ttf': 'font/ttf',
  '.map': 'application/json', '.bcmap': 'application/octet-stream', '.pfb': 'application/octet-stream',
};

// Oorsprong A: alleen de bundel, zoals hij is.
function bundelServer(req, res) {
  const url = new URL(req.url, APP);
  let pad = decodeURIComponent(url.pathname);
  if (pad.endsWith('/')) pad += 'index.html';
  const bestand = path.resolve(BUNDEL, '.' + pad);
  if (!bestand.startsWith(BUNDEL) || !fs.existsSync(bestand) || !fs.statSync(bestand).isFile()) {
    res.writeHead(404).end('niet gevonden');
    return;
  }
  res.writeHead(200, { 'Content-Type': SOORTEN[path.extname(bestand).toLowerCase()] || 'application/octet-stream' });
  fs.createReadStream(bestand).pipe(res);
}

function leesLijf(req) {
  return new Promise((klaar, mis) => {
    const delen = [];
    req.on('data', (d) => delen.push(d));
    req.on('end', () => klaar(Buffer.concat(delen)));
    req.on('error', mis);
  });
}

// Oorsprong B (en C: zelfde server, andere hostnaam).
async function gastServer(req, res) {
  const host = req.headers.host || '';
  const url = new URL(req.url, `http://${host}`);
  const p = url.pathname;
  const html = (s) => res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' }).end(s);
  const js = (s) => res.writeHead(200, { 'Content-Type': 'text/javascript; charset=utf-8' }).end(s);
  const json = (o) => res.writeHead(200, { 'Content-Type': 'application/json' }).end(JSON.stringify(o));

  if (p === '/gast.html') return html(GAST_HTML);
  if (p === '/gast.js') return js(GAST_JS);
  if (p === '/ander.html') return html(ANDER_HTML);
  if (p === '/kwaad.html') return html(KWAAD_HTML);

  // Een kortlevend adres voor precies één bestand (de gastpagina vraagt het).
  if (p === '/maak-adres') {
    const bestand = url.searchParams.get('bestand');
    if (bestand === 'OMLEIDING') return json({ adres: `${GAST}/omleiding` });
    if (!opslag.docs.has(bestand)) return res.writeHead(404).end();
    const token = Math.random().toString(36).slice(2);
    opslag.adressen.set(token, { bestand, geldigTot: Date.now() + 30_000 });
    return json({ adres: `${GAST}/opslag/${token}` });
  }
  if (p.startsWith('/opslag/')) {
    const token = p.slice('/opslag/'.length);
    const adres = opslag.adressen.get(token);
    opslag.adressen.delete(token); // eenmalig
    opslag.ophalen.push({ pad: '/opslag/…', cookie: req.headers.cookie || null, origin: req.headers.origin || null });
    if (!adres || adres.geldigTot < Date.now()) return res.writeHead(403).end();
    res.writeHead(200, {
      'Content-Type': 'application/pdf',
      'Access-Control-Allow-Origin': APP,
      'Cache-Control': 'no-store',
    });
    return res.end(Buffer.from(laatsteBytes(adres.bestand)));
  }
  if (p === '/omleiding') {
    opslag.ophalen.push({ pad: '/omleiding', cookie: req.headers.cookie || null, origin: req.headers.origin || null });
    return res.writeHead(302, { Location: `${GAST}/vervalst.pdf`, 'Access-Control-Allow-Origin': APP }).end();
  }
  if (p === '/vervalst.pdf') {
    opslag.vervalstOpgehaald++;
    res.writeHead(200, { 'Content-Type': 'application/pdf', 'Access-Control-Allow-Origin': '*' });
    return res.end(Buffer.from(vervalst));
  }
  // De gastpagina bewaart wat de app opsloeg als nieuwe versie.
  if (p === '/bewaar' && req.method === 'POST') {
    const bestand = url.searchParams.get('bestand');
    const doc = opslag.docs.get(bestand);
    if (!doc) return res.writeHead(404).end();
    const bytes = new Uint8Array(await leesLijf(req));
    doc.versies.push({ version: String(doc.versies.length + 1), bytes, modified: new Date().toISOString().slice(0, 10) });
    return json({ versie: doc.versies.at(-1).version });
  }
  if (p === '/lijst') return json([...opslag.docs].map(([id, d]) => ({ id, naam: d.naam })));
  if (p === '/versies') {
    const doc = opslag.docs.get(url.searchParams.get('bestand'));
    return json(doc ? doc.versies.map((v) => ({ versie: v.version, modified: v.modified, grootte: v.bytes.length })) : []);
  }
  res.writeHead(404).end('niet gevonden');
}

// ── De testpagina op oorsprong B ───────────────────────────────────────────
const GAST_HTML = `<!doctype html><meta charset="utf-8"><title>Gastpagina</title>
<style>html,body{margin:0;height:100%}iframe{border:0}#app{width:100%;height:100%}.klein{position:absolute;width:1px;height:1px;left:-10px}</style>
<body><script src="/gast.js"></script></body>`;

const GAST_JS = `
'use strict';
const zoek = new URLSearchParams(location.search);
const APP = ${JSON.stringify(APP)};
const DERDE = ${JSON.stringify(DERDE)};
const OUDER = zoek.get('ouder') || location.origin;   // voor de controle met een verkeerde ouder
const BESTAND = zoek.get('bestand') || 'DOC-1';
const ZWIJG_MS = Number(zoek.get('zwijg') || 2000);
const UITSTEL_MS = 400;                                 // eerst de vervalsers, dan wij
// Een sessiecookie van de gastpagina: die mag nooit bij de opslag-URL mee.
document.cookie = 'sessie=geheim; path=/';

const gast = window.__gast = { log: [], opgeslagen: [], vervalsingen: 0, start: 0, eersteAntwoord: null };

function frame(src, klasse, naam) {
  const f = document.createElement('iframe');
  if (klasse) f.className = klasse;
  if (naam) f.name = naam;
  f.src = src;
  document.body.appendChild(f);
  return new Promise((r) => f.addEventListener('load', () => r(f), { once: true }));
}

(async () => {
  // Volgorde in window.frames: 0 = ander venster (B), 1 = derde oorsprong, 2 = app.
  const ander = await frame('/ander.html', 'klein');
  const kwaad = await frame(DERDE + '/kwaad.html', 'klein');
  const app = document.createElement('iframe');
  app.id = 'app';
  app.name = 'opds-app';
  app.setAttribute('sandbox', 'allow-scripts allow-same-origin allow-downloads allow-modals');
  app.src = APP + '/#ouder=' + encodeURIComponent(OUDER) + '&app=pdf&bestand=' + encodeURIComponent(BESTAND);
  gast.start = performance.now();
  document.body.appendChild(app);

  function vervals(data) {
    gast.vervalsingen++;
    ander.contentWindow.vervals(2, data);
    kwaad.contentWindow.postMessage({ vervals: data, frame: 2 }, DERDE);
  }

  function antwoord(id, ok, waardeOfFout) {
    const bericht = ok ? { werkplek: 1, antwoord: id, ok: true, waarde: waardeOfFout }
                       : { werkplek: 1, antwoord: id, ok: false, fout: String(waardeOfFout) };
    app.contentWindow.postMessage(bericht, APP);
  }

  async function behandel(data) {
    switch (data.soort) {
      case 'hallo': return {};
      case 'open': {
        const r = await fetch('/maak-adres?bestand=' + encodeURIComponent(data.bestand));
        if (!r.ok) throw new Error('Unknown file');
        const { adres } = await r.json();
        return { naam: data.bestand === 'DOC-1' ? 'Plattegrond.pdf' : data.bestand + '.pdf', adres };
      }
      case 'opslaan': {
        if (!(data.bytes instanceof ArrayBuffer)) throw new Error('bytes is not an ArrayBuffer');
        gast.opgeslagen.push({ bestand: data.bestand, bytes: new Uint8Array(data.bytes.slice(0)) });
        const r = await fetch('/bewaar?bestand=' + encodeURIComponent(data.bestand), { method: 'POST', body: data.bytes });
        return r.json();
      }
      case 'lijst': return (await fetch('/lijst')).json();
      case 'versies': return (await fetch('/versies?bestand=' + encodeURIComponent(data.bestand))).json();
      default: throw new Error('Unknown request');
    }
  }

  window.addEventListener('message', async (event) => {
    if (event.source !== app.contentWindow || event.origin !== APP) return;
    const data = event.data;
    if (!data || data.werkplek !== 1 || typeof data.id !== 'number') return;
    const t = Math.round(performance.now() - gast.start);
    gast.log.push({ t, id: data.id, soort: data.soort, bestand: data.bestand,
      bytes: data.bytes instanceof ArrayBuffer ? data.bytes.byteLength : undefined });
    vervals({ id: data.id, soort: data.soort });
    // De gastpagina "laadt later": eerst een poos niets.
    if (performance.now() - gast.start < ZWIJG_MS) return;
    await new Promise((r) => setTimeout(r, UITSTEL_MS));
    if (data.soort === 'hallo' && gast.eersteAntwoord === null) gast.eersteAntwoord = t;
    try { antwoord(data.id, true, await behandel(data)); }
    catch (e) { antwoord(data.id, false, e.message); }
  });
})();
`;

// Vervalste antwoorden: een open wijst naar het vervalste bestand, een lijst
// en versies bevatten 'VERVALST', opslaan "mislukt".
const VERVALSER = (bron) => `
function vervalstAntwoord(data, bron) {
  const id = data.id;
  switch (data.soort) {
    case 'hallo': return { werkplek: 1, antwoord: id, ok: true, waarde: {} };
    case 'open': return { werkplek: 1, antwoord: id, ok: true, waarde: { naam: 'Vervalst.pdf', adres: ${JSON.stringify(GAST)} + '/vervalst.pdf?van=' + bron } };
    case 'lijst': return { werkplek: 1, antwoord: id, ok: true, waarde: [{ id: 'VERVALST', naam: 'Vervalst.pdf' }] };
    case 'versies': return { werkplek: 1, antwoord: id, ok: true, waarde: [{ versie: 'VERVALST' }] };
    default: return { werkplek: 1, antwoord: id, ok: false, fout: 'VERVALST ' + bron };
  }
}
function stuurVervalst(index, data) {
  const doel = parent.frames[index];
  const bericht = vervalstAntwoord(data, ${JSON.stringify(bron)});
  for (let i = 0; i < 3; i++) doel.postMessage(bericht, '*');
}`;

// Een tweede venster op oorsprong B: juiste oorsprong, verkeerd venster.
const ANDER_HTML = `<!doctype html><meta charset="utf-8"><script>${VERVALSER('ander-venster')}
window.vervals = (index, data) => stuurVervalst(index, data);
</script>`;

// Een venster op een derde oorsprong.
const KWAAD_HTML = `<!doctype html><meta charset="utf-8"><script>${VERVALSER('derde-oorsprong')}
window.addEventListener('message', (e) => {
  if (e.source !== parent || !e.data || !e.data.vervals) return;
  stuurVervalst(e.data.frame, e.data.vervals);
});
</script>`;

// ── Servers ────────────────────────────────────────────────────────────────
function luister(handler, poort, host) {
  return new Promise((klaar, mis) => {
    const s = http.createServer((req, res) => {
      Promise.resolve(handler(req, res)).catch((e) => { try { res.writeHead(500).end(String(e)); } catch { /* */ } });
    });
    s.once('error', mis);
    s.listen(poort, host, () => klaar(s));
  });
}

const servers = [];
servers.push(await luister(bundelServer, POORT_APP, '127.0.0.1'));
servers.push(await luister(gastServer, POORT_GAST, '127.0.0.1'));
// localhost kan in de browser ook ::1 zijn.
try { servers.push(await luister(gastServer, POORT_GAST, '::1')); } catch { /* geen IPv6 */ }

// ── De browser ─────────────────────────────────────────────────────────────
const browser = await chromium.launch({ headless: true, args: ['--enable-unsafe-swiftshader'] });
const context = await browser.newContext({ viewport: { width: 1400, height: 900 }, locale: 'en-US' });
const page = await context.newPage();
const paginaFouten = [];
page.on('pageerror', (e) => paginaFouten.push(String(e.message).slice(0, 200)));
page.on('console', (m) => { if (m.type() === 'error') paginaFouten.push('[console] ' + m.text().slice(0, 200)); });

const wacht = (ms) => new Promise((r) => setTimeout(r, ms));
async function totDat(f, ms, wat) {
  const eind = Date.now() + ms;
  for (;;) {
    const v = await f();
    if (v) return v;
    if (Date.now() > eind) throw new Error(`Time-out: ${wat}`);
    await wacht(100);
  }
}
const gastToestand = () => page.evaluate(() => ({
  log: window.__gast.log, vervalsingen: window.__gast.vervalsingen, eersteAntwoord: window.__gast.eersteAntwoord,
  opgeslagen: window.__gast.opgeslagen.length,
}));

let geslaagd = false;
try {
  await page.goto(`${GAST}/gast.html`, { waitUntil: 'load' });
  const appFrame = await totDat(() => page.frame({ name: 'opds-app' }), 30_000, 'app-iframe');

  // 1. Handdruk met een gastpagina die later "laadt".
  // Klaar zodra de echte handdruk er is, of zodra de app (ten onrechte) al
  // iets anders vraagt dan hallo.
  await totDat(async () => {
    const g = await gastToestand();
    return g.eersteAntwoord !== null || g.log.some((r) => r.soort !== 'hallo');
  }, 30_000, 'eerste antwoord op hallo');
  let t = await gastToestand();
  const hallosVoor = t.log.filter((r) => r.soort === 'hallo' && r.t < 2000).length;
  const eersteAnder = t.log.find((r) => r.soort !== 'hallo');
  noteer(`1. handdruk: ${hallosVoor} keer hallo in de eerste 2 s (elke 250 ms), ${t.vervalsingen} vervalste antwoorden gestuurd; verbonden na ${t.eersteAntwoord} ms`);
  eis(hallosVoor >= 6, `te weinig hallo tijdens het zwijgen (${hallosVoor})`);
  if (eersteAnder && (t.eersteAntwoord === null || eersteAnder.t < t.eersteAntwoord)) {
    throw new Error(`de app vroeg "${eersteAnder.soort}" vóór de echte handdruk: een vervalst hallo-antwoord telde`);
  }
  const herkomst = await appFrame.evaluate(() => ({
    ancestorOrigins: [...(location.ancestorOrigins || [])], contract: !!window.__OPDS_HOST__, document: window.__OPDS_HOST__?.document,
  }));
  noteer(`   in het iframe: ancestorOrigins=${JSON.stringify(herkomst.ancestorOrigins)}, __OPDS_HOST__ ${herkomst.contract ? 'staat er' : 'ontbreekt'}, document=${herkomst.document}`);
  eis(herkomst.contract && herkomst.document === 'DOC-1', 'de brug zette het contract niet neer');

  // 2. Het document uit `bestand` opent.
  await totDat(() => appFrame.evaluate(() => {
    const c = document.querySelector('#pdf-canvas') || document.querySelector('#continuous-container canvas');
    return !!c && c.width > 200 && document.body.innerText.includes('Plattegrond.pdf');
  }), 60_000, 'document open in de app');
  await wacht(800);
  t = await gastToestand();
  const open = t.log.find((r) => r.soort === 'open');
  noteer(`2. open { bestand: ${open?.bestand} } -> Plattegrond.pdf staat in een tabblad`);
  const ophalen = opslag.ophalen.filter((o) => o.pad === '/opslag/…');
  eis(ophalen.length === 1, `het adres werd ${ophalen.length} keer opgehaald`);
  eis(ophalen[0]?.cookie === null, `cookie ging mee met het ophalen: ${ophalen[0]?.cookie}`);
  noteer(`   adres opgehaald met Origin ${ophalen[0]?.origin}, cookie: ${ophalen[0]?.cookie ?? 'geen'}`);
  await page.screenshot({ path: path.join(UIT, '1-geopend.png') });

  // 3. Een rechthoek tekenen en opslaan.
  const canvas = await appFrame.$('#annotation-canvas') || await appFrame.$('#pdf-canvas')
    || await appFrame.$('#continuous-container canvas');
  const vak = await canvas.boundingBox();
  noteer(`3. blad op ${Math.round(vak.x)},${Math.round(vak.y)} (${Math.round(vak.width)}x${Math.round(vak.height)})`);
  // Eerst de focus in het iframe (een klik op het blad), dan sneltoets 4: rechthoek.
  await page.mouse.click(vak.x + 40, vak.y + 40);
  await page.keyboard.press('Escape');
  await page.keyboard.press('4');
  const gereedschap = await appFrame.evaluate(() => document.body.innerText.match(/Tool:\s*([^\n]+)/)?.[1] || '?');
  noteer(`   gereedschap: ${gereedschap}`);
  const x0 = vak.x + vak.width * 0.3; const y0 = vak.y + vak.height * 0.4;
  await page.mouse.move(x0, y0);
  await page.mouse.down();
  for (let i = 1; i <= 10; i++) await page.mouse.move(x0 + i * 15, y0 + i * 10);
  await page.mouse.up();
  await wacht(300);
  await page.keyboard.press('Control+s');
  await totDat(async () => (await gastToestand()).opgeslagen > 0, 60_000, 'opslaan bij de gastpagina');
  await wacht(800);
  const ontvangen = await page.evaluate(() => {
    const o = window.__gast.opgeslagen[0];
    let s = '';
    for (const b of o.bytes) s += String.fromCharCode(b);
    return { bestand: o.bestand, b64: btoa(s) };
  });
  const bytes = Buffer.from(ontvangen.b64, 'base64');
  fs.writeFileSync(path.join(UIT, 'opgeslagen.pdf'), bytes);
  const doc = await PDFDocument.load(bytes);
  const annots = doc.getPage(0).node.Annots();
  const soorten = annots ? annots.asArray().map((r) => String(doc.context.lookup(r).get(PDFName.of('Subtype')))) : [];
  noteer(`   opslaan { bestand: ${ontvangen.bestand}, bytes: ${bytes.length} } als ArrayBuffer; ${doc.getPageCount()} pagina's, annotaties op blad 1: ${soorten.join(', ') || 'geen'}`);
  eis(bytes.subarray(0, 5).toString() === '%PDF-', 'de opgeslagen bytes zijn geen PDF');
  eis(doc.getPageCount() === 2, 'het opgeslagen document is niet het echte (2 pagina\'s)');
  eis(soorten.includes('/Square'), 'geen rechthoek in de opgeslagen bytes');
  eis(Buffer.compare(Buffer.from(laatsteBytes('DOC-1')), bytes) === 0, 'de opslag achter de gastpagina heeft andere bytes');
  await page.screenshot({ path: path.join(UIT, '2-opgeslagen.png') });

  // 4. Lijst en versies over de brug (het contract dat de app gebruikt).
  const lijst = await appFrame.evaluate(() => window.__OPDS_HOST__.storage.list());
  const versies = await appFrame.evaluate(() => window.__OPDS_HOST__.storage.versions('DOC-1'));
  noteer(`4. lijst: ${JSON.stringify(lijst)}`);
  noteer(`   versies van DOC-1: ${versies.map((v) => `v${v.version} (${v.modified}, ${v.grootte} bytes)`).join(', ')}`);
  eis(lijst.length === 1 && lijst[0].id === 'DOC-1' && lijst[0].name === 'Plattegrond.pdf', 'verkeerde lijst');
  eis(versies.length === 2 && versies[1].version === '2' && versies[1].grootte === bytes.length, 'de nieuwe versie staat niet in de versies');

  // 5. Geen vervalst antwoord telde.
  t = await gastToestand();
  const tekst = await appFrame.evaluate(() => document.body.innerText);
  noteer(`5. ${t.vervalsingen} keer vervalst geantwoord (derde oorsprong én ander venster op de juiste oorsprong); vervalst bestand ${opslag.vervalstOpgehaald} keer opgehaald`);
  eis(opslag.vervalstOpgehaald === 0, 'de app haalde het vervalste bestand op');
  eis(!tekst.includes('VERVALST') && !tekst.includes('Vervalst.pdf'), 'een vervalst antwoord is zichtbaar in de app');
  eis(t.vervalsingen >= t.log.length, 'niet elk bericht kreeg een vervalst antwoord');
  eis(t.log.filter((r) => r.soort === 'open').length === 1, 'de app opende meer dan eens');

  // 6. Een mislukte open toont de vertaalde melding.
  await appFrame.evaluate(() => window.dispatchEvent(new CustomEvent('opds:open-document', { detail: { id: 'OMLEIDING' } })));
  const melding = 'The file could not be read from storage. Try again.';
  await totDat(() => appFrame.evaluate((m) => document.body.innerText.includes(m), melding), 30_000, 'melding na mislukte open');
  noteer(`6. adres met omleiding: de app toont "${melding}"; de omleiding is niet gevolgd (vervalst bestand ${opslag.vervalstOpgehaald} keer opgehaald)`);
  eis(opslag.ophalen.some((o) => o.pad === '/omleiding'), 'het omleidingsadres is niet geprobeerd');
  eis(opslag.vervalstOpgehaald === 0, 'de omleiding is gevolgd');
  await page.screenshot({ path: path.join(UIT, '3-melding.png') });

  // 7. Een ouder die niet de pagina erboven is: geen brug.
  const page2 = await context.newPage();
  await page2.goto(`${GAST}/gast.html?ouder=${encodeURIComponent(DERDE)}&zwijg=0`, { waitUntil: 'load' });
  const appFrame2 = await totDat(() => page2.frame({ name: 'opds-app' }), 30_000, 'tweede app-iframe');
  await totDat(() => appFrame2.evaluate(() => !!document.querySelector('#app-root')?.children.length).catch(() => false), 60_000, 'tweede app geladen');
  await wacht(1500);
  const zonder = await appFrame2.evaluate(() => ({ contract: window.__OPDS_HOST__ !== undefined, ancestor: [...(location.ancestorOrigins || [])] }));
  const log2 = await page2.evaluate(() => window.__gast.log.length);
  noteer(`7. #ouder=${DERDE} onder ${zonder.ancestor[0]}: __OPDS_HOST__ ${zonder.contract ? 'staat er (FOUT)' : 'ontbreekt'}, ${log2} berichten naar buiten`);
  eis(!zonder.contract && log2 === 0, 'de brug startte met een ouder die niet de pagina erboven is');
  await page2.close();

  // De mislukte open uit stap 6 hoort er te staan; de rest niet.
  const relevant = paginaFouten.filter((f) => !/favicon|status of 404|Failed to load resource|document van de site niet geopend/i.test(f));
  if (relevant.length) noteer('   paginafouten: ' + relevant.join(' | '));
  geslaagd = fouten.length === 0;
} catch (e) {
  fouten.push(e.message);
  noteer('FOUT: ' + e.stack);
  try { await page.screenshot({ path: path.join(UIT, 'fout.png') }); } catch { /* */ }
} finally {
  await browser.close();
  for (const s of servers) s.close();
}

fs.writeFileSync(path.join(UIT, 'verslag.txt'), regels.join('\n') + '\n');
noteer(geslaagd ? `GESLAAGD (verslag en schermafdrukken in ${UIT})` : `MISLUKT: ${fouten.length} fout(en)`);
process.exit(geslaagd ? 0 : 1);
