// De brug naar de werkplek (#694, #704) in een echte browser.
//
// De gehoste bundel (gebouwd zoals de release: --mode hosted --base=./,
// verder ongewijzigd) staat in een nagebootste werkplek van de OpenAEC
// SuperCloud (scripts/werkplek-proef.mjs): onder /werkplek/app/pdf/ op
// oorsprong A met de strikte CSP van de host (sandbox, geen 'self'), in
//   <iframe sandbox="allow-scripts allow-downloads allow-modals" credentialless>
// op een gastpagina op oorsprong B, met #ouder=<B>&app=pdf&bestand=DOC-1.
// De app heeft dus een opaque origin ("null"), geen opslag en geen cookies.
// Twee kwaadwillende vensters (een derde oorsprong C en een tweede venster
// op B) sturen bij elk bericht van de app eerst vervalste antwoorden.
//
// Gecontroleerd in headless Chromium:
//  1. de handdruk: de gastpagina zwijgt eerst 2 s; vervalste antwoorden op
//     hallo tellen niet, de app blijft elke 250 ms hallo zeggen;
//  2. het document opent uit de bytes van `open`; de app meldt `geopend`;
//     de PDF.js-worker en de andere workers draaien uit blob: (geen
//     terugval op de hoofdthread);
//  3. een rechthoek gaat met Ctrl+S naar de gastpagina; de bytes daar
//     bevatten de annotatie (pdf-lib);
//  4. een tweede opslag krijgt een conflict: de app toont de vertaalde
//     melding met de naam van de kopie en de melding van de host; de bytes
//     staan in de kopie, niets is weg; een derde opslag gaat naar de kopie;
//  5. lijst en versies in de vorm van de host;
//  6. de assistent vraagt via ai.vraag (OpenAI-chatvorm); het antwoord van
//     de host gaat ongewijzigd mee in de volgende beurt; de foutcode
//     geen_tegoed wordt een vertaalde melding;
//  7. een alleen-lezen document: opslaan weigert met een vertaalde melding,
//     er gaat geen opslaan naar de host;
//  8. een mislukte open toont de vertaalde melding en gaat als `melding`
//     naar de host;
//  9. geen enkel vervalst antwoord telde;
// 10. 0 CSP-overtredingen, 0 consolefouten, geen verzoek van de app buiten
//     de bundel en geen enkel verzoek van de app naar de host;
// 11. met een `ouder` die niet de pagina erboven is, start de brug niet.
//
// Draaien:  npm run test:hosted-bridge   (bouwt de bundel zelf)
// of:       node scripts/gehost-brug-e2e.mjs [--dist <map>]
// Poorten:  OPDS_BRUG_POORT_APP (3661) en OPDS_BRUG_POORT_GAST (3662).

import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { chromium } from 'playwright';
import { PDFDocument, PDFName, StandardFonts } from 'pdf-lib';
import {
  APP_PAD, startWerkplek, nieuweContext, sriUrls, totDat, appFrameVan, wachtOpDocument, tekenRechthoek,
  aantalAnnotaties, melding, sluitMelding, bewaardeBytes,
} from './werkplek-proef.mjs';

function leesArgs(argv) {
  const args = {};
  for (let i = 0; i < argv.length; i++) {
    if (argv[i] === '--dist') args.dist = argv[++i];
    else if (!argv[i].startsWith('--') && !args.dist) args.dist = argv[i];
    else throw new Error(`Unknown argument: ${argv[i]}`);
  }
  return args;
}

const POORT_APP = Number(process.env.OPDS_BRUG_POORT_APP || 3661);
const POORT_GAST = Number(process.env.OPDS_BRUG_POORT_GAST || 3662);
const UIT = path.join(os.tmpdir(), 'opds-gehost-brug-e2e');
fs.mkdirSync(UIT, { recursive: true });

const regels = [];
const noteer = (...a) => { const s = a.join(' '); regels.push(s); console.log(s); };
const fouten = [];
const eis = (voorwaarde, bericht) => { if (!voorwaarde) { fouten.push(bericht); noteer('  FOUT: ' + bericht); } return voorwaarde; };
const wacht = (ms) => new Promise((r) => setTimeout(r, ms));

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

async function soortenIn(bytes) {
  const doc = await PDFDocument.load(bytes);
  const annots = doc.getPage(0).node.Annots();
  return {
    paginas: doc.getPageCount(),
    soorten: annots ? annots.asArray().map((r) => String(doc.context.lookup(r).get(PDFName.of('Subtype')))) : [],
  };
}

const args = leesArgs(process.argv.slice(2));
let tijdelijk = null;
let BUNDEL = args.dist && path.resolve(args.dist);
if (!BUNDEL) {
  tijdelijk = fs.mkdtempSync(path.join(os.tmpdir(), 'opds-brug-'));
  BUNDEL = path.join(tijdelijk, 'dist');
  const { bouwGehost } = await import('./pak-webbundel.mjs');
  noteer('De gehoste bundel bouwen (--mode hosted --base=./)...');
  await bouwGehost(BUNDEL);
}
if (!fs.existsSync(path.join(BUNDEL, 'index.html'))) {
  console.error(`Geen bundel in ${BUNDEL}`);
  process.exit(2);
}

const documenten = {
  'DOC-1': { naam: 'Plattegrond.pdf', bytes: await maakPdf('Plattegrond', 2) },
  'DOC-RO': { naam: 'Gevel.pdf', bytes: await maakPdf('Gevel', 1), alleenLezen: true },
};
const werkplek = await startWerkplek({ bundel: BUNDEL, poortApp: POORT_APP, poortGast: POORT_GAST, documenten });
const { APP, GAST, DERDE } = werkplek;
noteer(`Bundel ${werkplek.bundelUrl}, gastpagina ${GAST}; CSP:\n  ${werkplek.csp}`);

const html = fs.readFileSync(path.join(BUNDEL, 'index.html'), 'utf8');
const browser = await chromium.launch({ headless: true, args: ['--enable-unsafe-swiftshader'] });
const p = await nieuweContext(browser, APP, sriUrls(html, werkplek.bundelUrl));
const { page } = p;
const consoleAlles = [];
page.on('console', (m) => consoleAlles.push(`[${m.type()}] ${m.text().slice(0, 200)}`));
const gast = () => page.evaluate(() => ({
  log: window.__gast.log, vervalsingen: window.__gast.vervalsingen, eersteAntwoord: window.__gast.eersteAntwoord,
  opgeslagen: window.__gast.opgeslagen, geopend: window.__gast.geopend, meldingen: window.__gast.meldingen,
  vragen: window.__gast.vragen, overzicht: window.__gast.overzicht(),
}));

let geslaagd = false;
try {
  await page.goto(werkplek.gastAdres({ bestand: 'DOC-1', zwijg: 2000, vervalsers: 1, conflict: 1 }), { waitUntil: 'load' });
  const frame = await appFrameVan(page);

  // 1. Handdruk met een gastpagina die later "laadt".
  await totDat(async () => {
    const g = await gast();
    return g.eersteAntwoord !== null || g.log.some((r) => r.soort !== 'hallo');
  }, 60_000, 'eerste antwoord op hallo');
  let g = await gast();
  const hallosVoor = g.log.filter((r) => r.soort === 'hallo' && r.t < 2000).length;
  const eersteAnder = g.log.find((r) => r.soort !== 'hallo');
  noteer(`1. handdruk: ${hallosVoor} keer hallo in de eerste 2 s, ${g.vervalsingen} keer vervalst geantwoord; verbonden na ${g.eersteAntwoord} ms`);
  eis(hallosVoor >= 6, `te weinig hallo tijdens het zwijgen (${hallosVoor})`);
  if (eersteAnder && (g.eersteAntwoord === null || eersteAnder.t < g.eersteAntwoord)) {
    throw new Error(`de app vroeg "${eersteAnder.soort}" vóór de echte handdruk: een vervalst hallo-antwoord telde`);
  }
  const binnen = await frame.evaluate(() => {
    let opslag = 'bruikbaar';
    try { void window.localStorage.length; } catch (e) { opslag = e.name; }
    let koekje = 'leesbaar';
    try { void document.cookie; } catch (e) { koekje = e.name; }
    return {
      origin: self.origin, ancestorOrigins: [...(location.ancestorOrigins || [])], opslag, koekje,
      contract: !!window.__OPDS_HOST__, document: window.__OPDS_HOST__?.document, ai: typeof window.__OPDS_HOST__?.ai?.vraag,
    };
  });
  noteer(`   in het iframe: origin=${binnen.origin}, ancestorOrigins=${JSON.stringify(binnen.ancestorOrigins)}, localStorage: ${binnen.opslag}, cookie: ${binnen.koekje}`);
  eis(binnen.origin === 'null', 'het iframe heeft geen opaque origin');
  eis(binnen.contract && binnen.document === 'DOC-1' && binnen.ai === 'function', 'de brug zette het contract niet neer');

  // 2. Het document opent uit de bytes.
  await wachtOpDocument(frame, 'Plattegrond.pdf');
  g = await gast();
  noteer(`2. open { bestand: ${g.log.find((r) => r.soort === 'open')?.bestand} } -> Plattegrond.pdf staat in een tabblad; geopend: ${JSON.stringify(g.geopend)}`);
  eis(g.geopend.includes('DOC-1'), 'de app meldde geopend niet');
  const workers = page.workers().map((w) => w.url());
  noteer(`   workers: ${workers.map((u) => u.replace(/[0-9a-f-]{20,}/, '…')).join(', ') || 'geen'}`);
  eis(workers.length > 0 && workers.every((u) => u.startsWith('blob:')), `workers niet uit blob: ${workers.join(', ')}`);
  eis(!consoleAlles.some((t) => /fake worker/i.test(t)), 'PDF.js viel terug op de hoofdthread (fake worker)');
  eis(await frame.evaluate(() => Worker.opdsBlobWorker === true), 'elke andere worker start niet uit blob: (de vervanging van Worker ontbreekt)');
  await page.screenshot({ path: path.join(UIT, '1-geopend.png') });

  // 3. Een rechthoek tekenen en opslaan.
  await tekenRechthoek(page, frame, { x: 0.15, y: 0.2 });
  eis(await aantalAnnotaties(frame) === 1, 'de rechthoek is niet gemaakt');
  await page.keyboard.press('Control+s');
  await totDat(async () => (await gast()).opgeslagen.length >= 1, 60_000, 'opslaan bij de gastpagina');
  await wacht(800);
  const eerste = await bewaardeBytes(page, 'DOC-1');
  fs.writeFileSync(path.join(UIT, 'opgeslagen-1.pdf'), eerste);
  const s1 = await soortenIn(eerste);
  noteer(`3. opslaan { bestand: DOC-1, bytes: ${eerste.length} }; ${s1.paginas} pagina's, annotaties op blad 1: ${s1.soorten.join(', ') || 'geen'}`);
  eis(s1.paginas === 2 && s1.soorten.includes('/Square'), 'de opgeslagen bytes hebben geen rechthoek of niet het echte document');
  eis(await melding(frame) === null, 'een gewone opslag toonde een melding');

  // 4. Tweede opslag: conflict.
  await tekenRechthoek(page, frame, { x: 0.45, y: 0.2 });
  noteer(`4. tweede rechthoek: ${await aantalAnnotaties(frame)} annotaties`);
  await page.keyboard.press('Control+s');
  await totDat(async () => (await gast()).opgeslagen.length >= 2, 60_000, 'tweede opslag bij de gastpagina');
  const conflictTekst = await totDat(() => melding(frame), 60_000, 'melding na het conflict');
  noteer(`   conflict: de app toont "${conflictTekst.replace(/\s+/g, ' ').slice(0, 220)}…"`);
  eis(conflictTekst.includes('Plattegrond (conflict).pdf'), 'de melding noemt de kopie niet');
  eis(/separate copy/.test(conflictTekst), 'de vertaalde conflictmelding ontbreekt');
  eis(/not reserved for you/.test(conflictTekst), 'de melding "niet vastgezet" ontbreekt');
  eis(conflictTekst.includes('Iemand anders sloeg dit bestand intussen op.'), 'de melding van de host ontbreekt');
  await sluitMelding(frame);
  const kopie = await bewaardeBytes(page, 'DOC-1-conflict');
  const s2 = kopie ? await soortenIn(kopie) : { soorten: [] };
  eis(s2.soorten.filter((x) => x === '/Square').length === 2, 'de kopie heeft niet beide rechthoeken: er ging iets verloren');
  // Een derde opslag gaat naar de kopie.
  await tekenRechthoek(page, frame, { x: 0.15, y: 0.6 });
  await page.keyboard.press('Control+s');
  await totDat(async () => (await gast()).overzicht['DOC-1-conflict']?.versies === 2, 60_000, 'derde opslag in de kopie');
  await wacht(500);
  g = await gast();
  noteer(`   daarna: ${JSON.stringify(g.overzicht)}; melding bij de derde opslag: ${await melding(frame) ?? 'geen'}`);
  eis(g.overzicht['DOC-1'].versies === 1, 'het origineel kreeg een versie na het conflict');
  eis(await melding(frame) === null, '"niet vastgezet" werd nog eens gemeld');

  // 5. Lijst en versies.
  const lijst = await frame.evaluate(() => window.__OPDS_HOST__.storage.list());
  const versies = await frame.evaluate(() => window.__OPDS_HOST__.storage.versions('DOC-1'));
  noteer(`5. lijst: ${JSON.stringify(lijst)}`);
  noteer(`   versies van DOC-1: ${versies.map((v) => `v${v.version} (${v.author})`).join(', ')}`);
  eis(lijst.length === 2 && lijst[0].id === 'DOC-1' && lijst[0].name === 'Plattegrond.pdf' && lijst[0].modified, 'verkeerde lijst');
  eis(versies.length === 3 && versies.every((v) => v.version && v.modified && v.author), 'verkeerde versies');

  // 6. De assistent via ai.vraag.
  await frame.locator('#assistant-launcher').click();
  const ondertitel = await frame.locator('.chat-subtitle').innerText();
  eis(/via the OpenAEC workplace/.test(ondertitel), `ondertitel van de assistent: ${ondertitel}`);
  eis(await frame.locator('.chat-header button[title*="API key"]').count() === 0, 'de sleutelknop staat er in de werkplek');
  const vraag = async (tekst, verwacht) => {
    await frame.locator('.chat-input').fill(tekst);
    await frame.locator('.chat-input').press('Enter');
    await totDat(() => frame.evaluate((v) => [...document.querySelectorAll('.chat-assistant .chat-bubble')]
      .some((b) => b.innerText.includes(v)), verwacht), 60_000, `antwoord "${verwacht}"`);
  };
  await vraag('Hoeveel pagina\'s heeft dit document?', 'Nep-antwoord 1');
  await vraag('En de tweede?', 'Nep-antwoord 2');
  const geenTegoed = 'Your AI credit is used up.';
  await vraag('Nog een vraag zonder tegoed', geenTegoed);
  g = await gast();
  const [v1, v2] = g.vragen;
  noteer(`6. assistent: ${g.vragen.length} vragen; vraag 2 = ${JSON.stringify(v2.messages.map((m) => m.role))}`);
  eis(v1.messages[0].role === 'system' && v1.messages.at(-1).content.includes('pagina'), 'de eerste vraag heeft niet de chatvorm');
  const terug = v2.messages.find((m) => m.role === 'assistant');
  eis(terug?.content === 'Nep-antwoord 1' && terug?.openaec_denkblokken?.[0]?.signature === 'sig-1',
    'het antwoord van de host ging niet ongewijzigd mee in de volgende beurt');
  eis(typeof v2.max_tokens === 'number', 'max_tokens ontbreekt');
  await page.screenshot({ path: path.join(UIT, '2-assistent.png') });
  await frame.locator('.chat-header .chat-close').last().click();

  // 7. Een alleen-lezen document.
  await frame.evaluate(() => window.dispatchEvent(new CustomEvent('opds:open-document', { detail: { id: 'DOC-RO' } })));
  await wachtOpDocument(frame, 'Gevel.pdf');
  const voorRo = (await gast()).opgeslagen.length;
  // Focus in het iframe: een klik op het blad (met het selectiegereedschap).
  await page.keyboard.press('Escape');
  const vakRo = await (await frame.$('canvas#annotation-canvas') || await frame.$('canvas#pdf-canvas')).boundingBox();
  await page.mouse.click(vakRo.x + 30, Math.max(vakRo.y, 0) + 30);
  await page.keyboard.press('Control+s');
  const roTekst = await totDat(() => melding(frame), 30_000, 'melding bij opslaan alleen-lezen');
  noteer(`7. alleen-lezen: "${roTekst}"`);
  eis(/read-only/.test(roTekst), 'geen vertaalde melding bij opslaan van een alleen-lezen document');
  await sluitMelding(frame);
  eis((await gast()).opgeslagen.length === voorRo, 'een alleen-lezen document ging naar de host');
  eis((await gast()).geopend.includes('DOC-RO'), 'geopend niet gemeld voor het alleen-lezen document');

  // 8. Een mislukte open.
  await frame.evaluate(() => window.dispatchEvent(new CustomEvent('opds:open-document', { detail: { id: 'ONBEKEND' } })));
  const misTekst = await totDat(() => melding(frame), 30_000, 'melding na mislukte open');
  noteer(`8. mislukte open: "${misTekst}"`);
  eis(misTekst === 'The file could not be read from storage. Try again.', 'niet de vertaalde melding');
  await totDat(async () => (await gast()).meldingen.length > 0, 10_000, 'melding bij de host');
  g = await gast();
  noteer(`   bij de host: ${JSON.stringify(g.meldingen)}`);
  eis(g.meldingen[0].tekst === misTekst && g.meldingen[0].toon === 'fout', 'de host kreeg de melding niet');
  await sluitMelding(frame);

  // 9. Geen vervalst antwoord telde.
  const tekst = await frame.evaluate(() => document.body.innerText);
  noteer(`9. ${g.vervalsingen} keer vervalst geantwoord (derde oorsprong én ander venster op de juiste oorsprong)`);
  eis(!tekst.includes('VERVALST') && !tekst.includes('Vervalst.pdf'), 'een vervalst antwoord is zichtbaar in de app');
  eis(g.vervalsingen >= g.log.length, 'niet elk bericht kreeg een vervalst antwoord');
  eis(!lijst.some((d) => d.id === 'VERVALST') && !versies.some((v) => v.version === 'VERVALST'), 'een vervalste lijst telde');

  // 10. CSP, console en verzoeken.
  await wacht(500);
  const overtredingen = await p.overtredingen();
  const buiten = werkplek.verzoeken.app.filter((v) => !v.pad.startsWith(APP_PAD));
  const naarHost = werkplek.verzoeken.gast.filter((v) => v.origin === 'null');
  const metKoekje = werkplek.verzoeken.app.filter((v) => v.cookie);
  noteer(`10. ${overtredingen.length} CSP-overtreding(en), ${p.consolefouten.length} consolefout(en), ${p.paginafouten.length} paginafout(en); `
    + `${werkplek.verzoeken.app.length} verzoeken naar de bundel (${buiten.length} buiten ${APP_PAD}, ${metKoekje.length} met cookie), ${naarHost.length} van de app naar de host`);
  eis(overtredingen.length === 0, `CSP-overtredingen:\n    ${overtredingen.join('\n    ')}`);
  eis(p.consolefouten.length === 0, `consolefouten:\n    ${p.consolefouten.join('\n    ')}`);
  eis(p.paginafouten.length === 0, `paginafouten:\n    ${p.paginafouten.join('\n    ')}`);
  eis(buiten.length === 0 && naarHost.length === 0 && metKoekje.length === 0, 'de app haalde iets buiten de bundel of bij de host');

  // 11. Een ouder die niet de pagina erboven is: geen brug.
  const page2 = await p.ctx.newPage();
  await page2.goto(werkplek.gastAdres({ ouder: DERDE }), { waitUntil: 'load' });
  const frame2 = await appFrameVan(page2);
  await totDat(() => frame2.evaluate(() => !!document.querySelector('#app-root')?.children.length).catch(() => false), 60_000, 'tweede app geladen');
  await wacht(1500);
  const zonder = await frame2.evaluate(() => ({ contract: window.__OPDS_HOST__ !== undefined, ancestor: [...(location.ancestorOrigins || [])] }));
  const log2 = await page2.evaluate(() => window.__gast.log.length);
  noteer(`11. #ouder=${DERDE} onder ${zonder.ancestor[0]}: __OPDS_HOST__ ${zonder.contract ? 'staat er (FOUT)' : 'ontbreekt'}, ${log2} berichten naar buiten`);
  eis(!zonder.contract && log2 === 0, 'de brug startte met een ouder die niet de pagina erboven is');
  await page2.close();

  geslaagd = fouten.length === 0;
} catch (e) {
  fouten.push(e.message);
  noteer('FOUT: ' + e.stack);
  try { await page.screenshot({ path: path.join(UIT, 'fout.png') }); } catch { /* */ }
} finally {
  await browser.close();
  await werkplek.sluit();
  if (tijdelijk) fs.rmSync(tijdelijk, { recursive: true, force: true });
}

fs.writeFileSync(path.join(UIT, 'verslag.txt'), regels.join('\n') + '\n');
noteer(geslaagd ? `GESLAAGD (verslag en schermafdrukken in ${UIT})` : `MISLUKT: ${fouten.length} fout(en)`);
process.exit(geslaagd ? 0 : 1);
