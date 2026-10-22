// De brug naar de gastpagina (#694): oorsprong uit de hash, strikt filteren
// op venster en oorsprong, de handdruk en de time-outs met een nepklok, en
// verzoek en antwoord bij elkaar houden.

import assert from 'node:assert/strict';
import test from 'node:test';

import {
  isGeldigeOorsprong, leesBrugHash, brugGegevens, maakHostBrug, installeerHostBrug,
  BrugFout, WERKPLEK, HALLO_INTERVAL_MS, HALLO_OPGEVEN_MS, VERZOEK_TIMEOUT_MS,
} from './host-brug.js';

const OUDER = 'https://cloud.example.org';

// ── Nepklok ────────────────────────────────────────────────────────────────
function nepKlok() {
  let nu = 0;
  let volgnummer = 0;
  const timers = new Map(); // id -> { op, elke, f }
  const klok = {
    setTimeout(f, ms) { const id = ++volgnummer; timers.set(id, { op: nu + ms, elke: null, f }); return id; },
    clearTimeout(id) { timers.delete(id); },
    setInterval(f, ms) { const id = ++volgnummer; timers.set(id, { op: nu + ms, elke: ms, f }); return id; },
    clearInterval(id) { timers.delete(id); },
  };
  return {
    klok,
    get nu() { return nu; },
    get aantal() { return timers.size; },
    /** Laat `ms` verstrijken en vuur alles wat in die tijd afloopt, op volgorde. */
    vooruit(ms) {
      const eind = nu + ms;
      for (;;) {
        let eerst = null;
        for (const [id, t] of timers) if (t.op <= eind && (!eerst || t.op < eerst[1].op)) eerst = [id, t];
        if (!eerst) break;
        const [id, t] = eerst;
        nu = t.op;
        if (t.elke) t.op += t.elke; else timers.delete(id);
        t.f();
      }
      nu = eind;
    },
  };
}

// ── Nepvensters ────────────────────────────────────────────────────────────
function nepOuder() {
  const verzonden = [];
  return {
    verzonden,
    postMessage(bericht, doel, overdracht) { verzonden.push({ bericht, doel, overdracht }); },
    soorten() { return verzonden.map((v) => v.bericht.soort); },
    laatste(soort) { return [...verzonden].reverse().find((v) => v.bericht.soort === soort); },
  };
}

function nepVenster({ hash = `#ouder=${encodeURIComponent(OUDER)}&app=pdf&bestand=DOC-1`, voorouders, ouder = nepOuder() } = {}) {
  const luisteraars = new Set();
  const venster = {
    parent: ouder,
    location: { hash, ...(voorouders ? { ancestorOrigins: voorouders } : {}) },
    addEventListener(soort, f) { if (soort === 'message') luisteraars.add(f); },
    removeEventListener(soort, f) { if (soort === 'message') luisteraars.delete(f); },
    /** Een bericht dat bij dit venster aankomt. */
    ontvang(data, { origin = OUDER, source = ouder } = {}) {
      for (const f of luisteraars) f({ data, origin, source });
    },
    get luisteraars() { return luisteraars.size; },
  };
  return venster;
}

const ok = (antwoord, waarde) => ({ werkplek: WERKPLEK, antwoord, ok: true, waarde });
const mis = (antwoord, fout) => ({ werkplek: WERKPLEK, antwoord, ok: false, fout });
const rust = () => new Promise((r) => setImmediate(r));

/** Brug in een nepvenster, met de handdruk al beantwoord. */
async function verbondenBrug(opties = {}) {
  const tijd = nepKlok();
  const venster = nepVenster();
  const brug = maakHostBrug({ ouder: OUDER, ouderVenster: venster.parent, venster, klok: tijd.klok, ...opties });
  brug.start();
  venster.ontvang(ok(venster.parent.verzonden[0].bericht.id));
  await brug.verbinding;
  return { brug, venster, tijd, ouder: venster.parent };
}

// ── Ouder ──────────────────────────────────────────────────────────────────
test('ouder is alleen een kale oorsprong scheme://host[:poort]', () => {
  for (const goed of ['https://cloud.example.org', 'http://127.0.0.1:3602', 'http://localhost:8080', 'https://[::1]:4443']) {
    assert.equal(isGeldigeOorsprong(goed), true, goed);
  }
  for (const fout of [
    '', null, undefined, 'cloud.example.org', 'https://cloud.example.org/', 'https://cloud.example.org/pad',
    'https://cloud.example.org?x=1', 'https://cloud.example.org#x', 'https://user:pw@cloud.example.org',
    'HTTPS://Cloud.Example.org', 'https://cloud.example.org:443', 'javascript:alert(1)', 'file:///c:/x',
    'data:text/html,x', 'null', '*', 'ftp://cloud.example.org', ' https://cloud.example.org',
  ]) {
    assert.equal(isGeldigeOorsprong(fout), false, String(fout));
  }
});

test('de hash levert ouder en bestand; zonder geldige ouder of voor een ander gereedschap niets', () => {
  assert.deepEqual(
    leesBrugHash(`#ouder=${encodeURIComponent(OUDER)}&app=pdf&bestand=Drawing%2F01`),
    { ouder: OUDER, bestand: 'Drawing/01' },
  );
  assert.deepEqual(leesBrugHash(`#ouder=${OUDER}`), { ouder: OUDER, bestand: null }, 'bestand is optioneel');
  assert.equal(leesBrugHash('#app=pdf&bestand=1'), null);
  assert.equal(leesBrugHash('#ouder=https%3A%2F%2Fcloud.example.org%2F&bestand=1'), null, 'met pad');
  assert.equal(leesBrugHash(`#ouder=${OUDER}&app=cad&bestand=1`), null, 'ander gereedschap');
  assert.equal(leesBrugHash(''), null);
  assert.equal(leesBrugHash(undefined), null);
});

test('alleen in een iframe, en waar de browser het weet moet de pagina erboven ouder zijn', () => {
  assert.deepEqual(brugGegevens(nepVenster()), { ouder: OUDER, bestand: 'DOC-1' });
  assert.deepEqual(brugGegevens(nepVenster({ voorouders: [OUDER, 'https://ander.example'] })), { ouder: OUDER, bestand: 'DOC-1' });
  assert.equal(brugGegevens(nepVenster({ voorouders: ['https://kwaad.example'] })), null, 'andere pagina erboven');
  assert.equal(brugGegevens(nepVenster({ voorouders: [] })), null, 'geen pagina erboven');
  assert.equal(brugGegevens(nepVenster({ voorouders: ['null'] })), null, 'verborgen oorsprong');

  const bovenaan = nepVenster();
  bovenaan.parent = bovenaan;
  assert.equal(brugGegevens(bovenaan), null, 'geen iframe: gewone browsermodus');
  assert.equal(brugGegevens(nepVenster({ hash: '' })), null, 'geen hash');
});

test('installeren: zet het contract neer en begint de handdruk; een bestaand contract wint', () => {
  const tijd = nepKlok();
  const venster = nepVenster();
  const brug = installeerHostBrug({ venster, klok: tijd.klok });
  assert.ok(brug);
  assert.equal(venster.__OPDS_HOST__.document, 'DOC-1');
  for (const f of ['open', 'save', 'list', 'versions']) assert.equal(typeof venster.__OPDS_HOST__.storage[f], 'function', f);
  assert.deepEqual(venster.parent.soorten(), ['hallo']);
  assert.equal(venster.parent.verzonden[0].doel, OUDER, 'alleen naar ouder');
  brug.stop();

  const eigen = { storage: { open() {}, save() {} } };
  const metContract = nepVenster();
  metContract.__OPDS_HOST__ = eigen;
  assert.equal(installeerHostBrug({ venster: metContract, klok: tijd.klok }), null);
  assert.equal(metContract.__OPDS_HOST__, eigen, 'het contract van de gastpagina blijft');
  assert.equal(metContract.parent.verzonden.length, 0, 'en er gaat niets naar buiten');

  const zonderOuder = nepVenster({ hash: '#bestand=1' });
  assert.equal(installeerHostBrug({ venster: zonderOuder, klok: tijd.klok }), null);
  assert.equal(zonderOuder.__OPDS_HOST__, undefined);
});

// ── Handdruk ───────────────────────────────────────────────────────────────
test('handdruk: hallo elke 250 ms tot de gastpagina antwoordt, daarna niet meer', async () => {
  const tijd = nepKlok();
  const venster = nepVenster();
  const brug = maakHostBrug({ ouder: OUDER, ouderVenster: venster.parent, venster, klok: tijd.klok });
  brug.start();
  assert.equal(HALLO_INTERVAL_MS, 250);
  assert.equal(venster.parent.verzonden.length, 1, 'meteen de eerste');
  tijd.vooruit(1000);
  assert.equal(venster.parent.verzonden.length, 5, 'en dan elke 250 ms');
  const berichten = venster.parent.verzonden.map((v) => v.bericht);
  assert.ok(berichten.every((b) => b.werkplek === 1 && b.soort === 'hallo' && typeof b.id === 'number'));
  assert.equal(new Set(berichten.map((b) => b.id)).size, 5, 'elk met een eigen id');

  // De gastpagina laadt later en beantwoordt een eerdere hallo: ook goed.
  venster.ontvang(ok(berichten[2].id));
  await brug.verbinding;
  assert.equal(brug.toestand, 'verbonden');
  tijd.vooruit(5000);
  assert.equal(venster.parent.verzonden.length, 5, 'na het antwoord geen hallo meer');
  assert.equal(tijd.aantal, 0, 'geen timers meer');
});

test('handdruk: na 60 s zonder antwoord opgeven, met één melding; verzoeken falen dan meteen', async () => {
  const tijd = nepKlok();
  const venster = nepVenster();
  const meldingen = [];
  const brug = maakHostBrug({
    ouder: OUDER, ouderVenster: venster.parent, venster, klok: tijd.klok,
    bijGeenContact: (f) => meldingen.push(f.code),
    vertaal: (s) => `vertaald:${s}`,
  });
  brug.start();
  const open = brug.opslag.open('DOC-1'); // wacht op de handdruk
  tijd.vooruit(HALLO_OPGEVEN_MS - 1);
  assert.equal(brug.toestand, 'wacht');
  assert.equal(meldingen.length, 0);
  tijd.vooruit(1);
  assert.equal(brug.toestand, 'opgegeven');
  assert.deepEqual(meldingen, ['geen-contact']);
  await assert.rejects(brug.verbinding, (e) => e instanceof BrugFout && e.code === 'geen-contact');
  await assert.rejects(open, (e) => {
    assert.equal(e.code, 'geen-contact');
    assert.equal(e.gemeld, true, 'de melding is er al: niet nog eens tonen');
    return true;
  });
  const hallos = venster.parent.verzonden.length;
  assert.equal(hallos, HALLO_OPGEVEN_MS / HALLO_INTERVAL_MS + 1);
  tijd.vooruit(10_000);
  assert.equal(venster.parent.verzonden.length, hallos, 'geen hallo meer na opgeven');
  // Een laat antwoord verandert niets meer.
  venster.ontvang(ok(venster.parent.verzonden[0].bericht.id));
  assert.equal(brug.toestand, 'opgegeven');
  await assert.rejects(brug.opslag.list(), (e) => e.code === 'geen-contact');
  assert.equal(venster.parent.verzonden.length, hallos, 'een verzoek na opgeven gaat niet naar buiten');
});

test('handdruk: een weigering van de gastpagina stopt meteen', async () => {
  const tijd = nepKlok();
  const venster = nepVenster();
  const brug = maakHostBrug({ ouder: OUDER, ouderVenster: venster.parent, venster, klok: tijd.klok });
  brug.start();
  venster.ontvang(mis(venster.parent.verzonden[0].bericht.id, 'Not allowed'));
  await assert.rejects(brug.verbinding, (e) => e.code === 'geweigerd' && e.message === 'Not allowed');
  tijd.vooruit(1000);
  assert.equal(venster.parent.verzonden.length, 1);
});

// ── Strikt filteren ────────────────────────────────────────────────────────
test('berichten van een andere oorsprong of een ander venster tellen niet', async () => {
  const tijd = nepKlok();
  const venster = nepVenster();
  const brug = maakHostBrug({ ouder: OUDER, ouderVenster: venster.parent, venster, klok: tijd.klok });
  brug.start();
  const halloId = venster.parent.verzonden[0].bericht.id;
  const anderVenster = nepOuder();

  venster.ontvang(ok(halloId), { origin: 'https://kwaad.example' });
  venster.ontvang(ok(halloId), { origin: 'https://cloud.example.org.kwaad.example' });
  venster.ontvang(ok(halloId), { origin: 'http://cloud.example.org' });
  venster.ontvang(ok(halloId), { origin: 'null' });
  venster.ontvang(ok(halloId), { source: anderVenster });   // juiste oorsprong, ander venster
  venster.ontvang(ok(halloId), { source: null });
  venster.ontvang(ok(halloId), { source: venster });        // van onszelf
  venster.ontvang({ ...ok(halloId), werkplek: 2 });
  venster.ontvang({ antwoord: halloId, ok: true });          // zonder werkplek
  venster.ontvang({ ...ok(halloId), antwoord: String(halloId) });
  venster.ontvang(`{"werkplek":1,"antwoord":${halloId},"ok":true}`);
  venster.ontvang(null);
  assert.equal(brug.toestand, 'wacht', 'niets daarvan telt als antwoord');

  venster.ontvang(ok(halloId));
  await brug.verbinding;

  // Ook na de handdruk: een vervalst antwoord op een lopend verzoek telt niet.
  const lijst = brug.opslag.list();
  await rust();
  const id = venster.parent.laatste('lijst').bericht.id;
  venster.ontvang(ok(id, [{ id: 'VERVALST', name: 'x.pdf' }]), { origin: 'https://kwaad.example' });
  venster.ontvang(ok(id, [{ id: 'VERVALST', name: 'x.pdf' }]), { source: anderVenster });
  venster.ontvang(ok(id, [{ id: 'ECHT', name: 'a.pdf' }]));
  assert.deepEqual(await lijst, [{ id: 'ECHT', name: 'a.pdf' }]);
  brug.stop();
  assert.equal(venster.luisteraars, 0, 'na stoppen luistert hij niet meer');
});

// ── Verzoek en antwoord ────────────────────────────────────────────────────
test('verzoek en antwoord: volgorde, fouten, onbekende ids en dubbele antwoorden', async () => {
  const { brug, venster, ouder } = await verbondenBrug();
  const a = brug.verzoek('lijst');
  const b = brug.verzoek('versies', { bestand: 'B' });
  const c = brug.verzoek('versies', { bestand: 'C' });
  await rust();
  const [va, vb, vc] = ouder.verzonden.slice(-3).map((v) => v.bericht);
  assert.deepEqual(vb, { bestand: 'B', werkplek: 1, id: vb.id, soort: 'versies' });
  assert.equal(new Set([va.id, vb.id, vc.id]).size, 3);

  venster.ontvang(ok(9999, 'onbekend'));          // geen verzoek met dit id
  venster.ontvang(mis(vc.id, 'No access'));
  venster.ontvang(ok(vb.id, ['B1']));
  venster.ontvang(ok(vb.id, ['B2']));              // tweede antwoord: genegeerd
  venster.ontvang(ok(va.id, ['A']));
  assert.deepEqual(await a, ['A']);
  assert.deepEqual(await b, ['B1']);
  await assert.rejects(c, (e) => e instanceof BrugFout && e.code === 'host' && e.message === 'No access');
  assert.ok(ouder.verzonden.every((v) => v.doel === OUDER), 'alles alleen naar ouder');

  // Velden overschrijven werkplek, id en soort niet.
  brug.verzoek('lijst', { werkplek: 7, id: 'x', soort: 'kwaad' });
  await rust();
  const laatst = ouder.verzonden.at(-1).bericht;
  assert.equal(laatst.werkplek, 1);
  assert.equal(laatst.soort, 'lijst');
  assert.equal(typeof laatst.id, 'number');
});

test('elk verzoek geeft na 120 s op; een laat antwoord doet dan niets meer', async () => {
  const { brug, venster, tijd, ouder } = await verbondenBrug();
  const lijst = brug.opslag.list();
  await rust();
  const id = ouder.laatste('lijst').bericht.id;
  tijd.vooruit(VERZOEK_TIMEOUT_MS - 1);
  let klaar = false;
  lijst.then(() => { klaar = true; }, () => { klaar = true; });
  await rust();
  assert.equal(klaar, false, 'nog niet opgegeven');
  tijd.vooruit(1);
  await assert.rejects(lijst, (e) => e.code === 'time-out');
  venster.ontvang(ok(id, [{ id: 'laat' }]));
  assert.equal(tijd.aantal, 0);
});

// ── De vier soorten ────────────────────────────────────────────────────────
test('open: adres van de gastpagina ophalen zonder cookies, cache of omleiding', async () => {
  const opgehaald = [];
  const fetch = async (url, opties) => {
    opgehaald.push({ url, opties });
    return { ok: true, status: 200, arrayBuffer: async () => Uint8Array.from([37, 80, 68, 70]).buffer };
  };
  const { brug, venster, ouder } = await verbondenBrug({ fetch });
  const open = brug.opslag.open('DOC-1');
  await rust();
  const v = ouder.laatste('open').bericht;
  assert.deepEqual(v, { bestand: 'DOC-1', werkplek: 1, id: v.id, soort: 'open' });
  venster.ontvang(ok(v.id, { naam: 'Plattegrond.pdf', adres: 'https://opslag.example/t/abc?sig=1' }));
  const { name, data } = await open;
  assert.equal(name, 'Plattegrond.pdf');
  assert.deepEqual([...new Uint8Array(data)], [37, 80, 68, 70]);
  assert.equal(opgehaald.length, 1);
  assert.equal(opgehaald[0].url, 'https://opslag.example/t/abc?sig=1');
  assert.equal(opgehaald[0].opties.credentials, 'omit');
  assert.equal(opgehaald[0].opties.cache, 'no-store');
  assert.equal(opgehaald[0].opties.redirect, 'error');
});

test('open: elke mislukking draagt de vertaalde melding voor de gebruiker', async () => {
  const gevallen = [
    ['de gastpagina weigert', (v, venster) => venster.ontvang(mis(v.id, 'Forbidden'))],
    ['geen adres', (v, venster) => venster.ontvang(ok(v.id, { naam: 'a.pdf' }))],
    ['een ongeldig adres', (v, venster) => venster.ontvang(ok(v.id, { naam: 'a.pdf', adres: 'javascript:alert(1)' }))],
    ['ophalen mislukt', (v, venster) => venster.ontvang(ok(v.id, { naam: 'a.pdf', adres: 'https://opslag.example/404' }))],
    ['omleiding of netwerkfout', (v, venster) => venster.ontvang(ok(v.id, { naam: 'a.pdf', adres: 'https://opslag.example/omleiding' }))],
  ];
  const fetch = async (url) => {
    if (url.endsWith('/omleiding')) throw new TypeError('Failed to fetch');
    return { ok: false, status: 404, arrayBuffer: async () => new ArrayBuffer(0) };
  };
  for (const [naam, antwoord] of gevallen) {
    const { brug, venster, ouder } = await verbondenBrug({ fetch, vertaal: (s) => `vertaald:${s}` });
    const open = brug.opslag.open('DOC-1');
    await rust();
    antwoord(ouder.laatste('open').bericht, venster);
    await assert.rejects(open, (e) => {
      assert.equal(e.gebruikersMelding, 'vertaald:hostOpenFailed', naam);
      return true;
    }, naam);
  }
  // Zonder vertaling: de Engelse tekst uit het issue.
  const { brug, tijd } = await verbondenBrug({ fetch });
  const open = brug.opslag.open('DOC-1');
  await rust();
  tijd.vooruit(VERZOEK_TIMEOUT_MS);
  await assert.rejects(open, (e) => e.code === 'time-out'
    && e.gebruikersMelding === 'The file could not be read from storage. Try again.');
});

test('opslaan: een eigen kopie van de bytes gaat als transferable mee', async () => {
  const { brug, venster, ouder } = await verbondenBrug();
  const groot = Uint8Array.from([0, 0, 1, 2, 3, 0]);
  const bytes = groot.subarray(2, 5); // een venster op een grotere buffer
  const opslaan = brug.opslag.save('DOC-1', bytes, { name: 'a.pdf' });
  await rust();
  const { bericht, overdracht, doel } = ouder.laatste('opslaan');
  assert.equal(doel, OUDER);
  assert.equal(bericht.bestand, 'DOC-1');
  assert.ok(bericht.bytes instanceof ArrayBuffer);
  assert.deepEqual([...new Uint8Array(bericht.bytes)], [1, 2, 3], 'precies de bytes, niet de hele buffer');
  assert.deepEqual(overdracht, [bericht.bytes]);
  assert.notEqual(bericht.bytes, groot.buffer, 'de buffer van de app zelf blijft van de app');
  assert.deepEqual(Object.keys(bericht).sort(), ['bestand', 'bytes', 'id', 'soort', 'werkplek']);
  venster.ontvang(ok(bericht.id, { versie: '3' }));
  assert.deepEqual(await opslaan, { versie: '3' }, 'het resultaat van de gastpagina');
});

test('lijst en versies in de vorm van het contract', async () => {
  const { brug, venster, ouder } = await verbondenBrug();
  const lijst = brug.opslag.list();
  await rust();
  const vl = ouder.laatste('lijst').bericht;
  assert.deepEqual(Object.keys(vl).sort(), ['id', 'soort', 'werkplek']);
  venster.ontvang(ok(vl.id, [{ id: 7, naam: 'Gevel.pdf' }, { id: 'B', name: 'B.pdf', modified: 'gisteren' }, null, { naam: 'zonder id' }]));
  assert.deepEqual(await lijst, [
    { id: '7', naam: 'Gevel.pdf', name: 'Gevel.pdf' },
    { id: 'B', name: 'B.pdf', modified: 'gisteren' },
  ]);

  const versies = brug.opslag.versions('DOC-1');
  await rust();
  const vv = ouder.laatste('versies').bericht;
  assert.equal(vv.bestand, 'DOC-1');
  venster.ontvang(ok(vv.id, [{ versie: 2, auteur: 'An' }, { version: '1' }]));
  assert.deepEqual(await versies, [{ versie: 2, auteur: 'An', version: '2' }, { version: '1' }]);

  const leeg = brug.opslag.versions('DOC-2');
  await rust();
  venster.ontvang(ok(ouder.laatste('versies').bericht.id, null));
  assert.deepEqual(await leeg, []);
});

test('stoppen: lopende verzoeken falen, zonder melding voor de gebruiker', async () => {
  const tijd = nepKlok();
  const venster = nepVenster();
  const meldingen = [];
  const brug = maakHostBrug({
    ouder: OUDER, ouderVenster: venster.parent, venster, klok: tijd.klok, bijGeenContact: () => meldingen.push(1),
  });
  brug.start();
  const lijst = brug.opslag.list();
  brug.stop();
  await assert.rejects(lijst, (e) => e.code === 'geen-contact');
  assert.equal(meldingen.length, 0);
  assert.equal(tijd.aantal, 0, 'geen timers meer');
  assert.equal(venster.luisteraars, 0);
});
