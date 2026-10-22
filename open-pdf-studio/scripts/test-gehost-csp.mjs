// De gehoste bundel onder een strikte Content Security Policy (#693).
//
//   npm run test:hosted-csp -- [--dist <map>] [--poort 3593]
//
// Zonder --dist bouwt hij de gehoste bundel zelf, zoals de release dat doet
// (vite build --mode hosted --base=./). Een eigen statische server serveert
// hem onder /pdf/ met precies het beleid uit het issue als header en verder
// niets. In headless Chromium: een PDF openen, tekenen, een rechthoek
// annoteren en opslaan. Geëist: nul CSP-overtredingen
// (securitypolicyviolation-events en consolefouten), de annotatie zit in het
// opgeslagen bestand, en index.html heeft geen inline code en SRI op elk
// script en stylesheet.
//
// Overtredingen vangen:
//  - in de pagina: een securitypolicyviolation-luisteraar (addInitScript);
//  - in workers: Chromium meldt een eval-overtreding in een worker nergens in
//    de console. Daarom zet de test dezelfde luisteraar vóór elk script dat
//    de server levert en dat niet met SRI in index.html staat; die meldt via
//    console.error, en Playwright geeft workerconsoles door aan de pagina.
//    (Een blob:-worker valt daarbuiten; de app maakt er geen.)
// Eerst een tegenproef op dezelfde server: een inline script, een eval in de
// pagina en een eval in een worker moeten alle drie gezien worden. Anders
// zegt "nul overtredingen" niets.

import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { chromium } from 'playwright';
import { PDFDocument, PDFName } from 'pdf-lib';
import { inktPerBand, maakProefPdf, openPdfInApp, startServer } from './gehost-proef.mjs';
import { controleerIndexHtml, cspBeleid } from './gehost-html.mjs';

const SUB = '/pdf/';

function leesArgs(argv) {
  const args = { poort: 3593 };
  for (let i = 0; i < argv.length; i++) {
    if (argv[i] === '--dist') args.dist = argv[++i];
    else if (argv[i] === '--poort') args.poort = Number(argv[++i]);
    else throw new Error(`Unknown argument: ${argv[i]}`);
  }
  return args;
}

const meld = (s) => console.log(s);

const LUISTERAAR = "self.addEventListener('securitypolicyviolation', function (e) {"
  + " console.error('CSP violation: ' + e.violatedDirective + ' ' + (e.blockedURI || '') + ' ' + (e.sourceFile || '') + ':' + e.lineNumber); });\n";

// In de pagina ook bijhouden, los van de console.
const VANGER = `
  window.__cspOvertredingen = [];
  document.addEventListener('securitypolicyviolation', (e) => {
    window.__cspOvertredingen.push(e.violatedDirective + ' ' + (e.blockedURI || '') + ' ' + (e.sourceFile || '') + ':' + e.lineNumber);
  });
`;

/**
 * Een verse context met de vangers.
 * @param {Set<string>} metSri  URL's die index.html met integrity laadt: die
 *   blijven onaangeroerd, anders klopt de hash niet meer.
 */
async function nieuwePagina(browser, origin, metSri, opties = {}) {
  const ctx = await browser.newContext({ viewport: { width: 1400, height: 900 }, locale: 'en-US', ...opties });
  await ctx.addInitScript(VANGER);
  await ctx.route((url) => url.origin === origin && /\.m?js$/.test(url.pathname) && !metSri.has(url.href), async (route) => {
    const antwoord = await route.fetch();
    await route.fulfill({ response: antwoord, body: LUISTERAAR + await antwoord.text() });
  });
  const page = await ctx.newPage();
  const consolefouten = [];
  const paginafouten = [];
  // Ook de console van workers komt hier binnen (m.worker() is dan gezet).
  page.on('console', (m) => {
    if (m.type() === 'error') consolefouten.push(`${m.worker() ? '[worker] ' : ''}${m.text().slice(0, 300)}`);
  });
  page.on('pageerror', (e) => paginafouten.push(String(e.message).slice(0, 300)));
  const overtredingen = async () => page.evaluate(() => window.__cspOvertredingen || []).catch(() => []);
  return { ctx, page, consolefouten, paginafouten, overtredingen };
}

const isCsp = (t) => /CSP violation|Content Security Policy|Refused to/i.test(t);

// Tegenproef: een eigen pagina op dezelfde server, onder hetzelfde beleid.
const TEGENPROEF = '/tegenproef/';
const TEGENPROEF_BESTANDEN = {
  'index.html': '<!doctype html><html><head><script src="pagina.js"></script><script>window.inline = 1;</script></head><body></body></html>',
  'pagina.js': "try { eval('1'); } catch (e) {}\nnew Worker('worker.js').onmessage = function () { window.workerKlaar = true; };",
  'worker.js': "try { eval('1'); } catch (e) {}\npostMessage(1);",
};

/** Ziet deze opzet een inline script, een eval in de pagina en een eval in een worker? */
async function tegenproef(browser, origin) {
  const p = await nieuwePagina(browser, origin, new Set());
  try {
    await p.page.goto(`${origin}${TEGENPROEF}`, { waitUntil: 'load' });
    await p.page.waitForFunction(() => window.workerKlaar === true, null, { timeout: 10000 }).catch(() => {});
    await p.page.waitForTimeout(500);
    const inPagina = await p.overtredingen();
    return {
      inline: inPagina.some((t) => t.startsWith('script-src-elem inline')),
      eval: inPagina.some((t) => t.startsWith('script-src eval')),
      worker: p.consolefouten.some((t) => t.startsWith('[worker] CSP violation: script-src eval')),
    };
  } finally {
    await p.ctx.close();
  }
}

/** De URL's die index.html met integrity laadt, absoluut. */
function sriUrls(html, basisUrl) {
  const uit = new Set();
  for (const m of html.matchAll(/<(?:script|link)\b[^>]*\bintegrity=[^>]*>/gi)) {
    const url = /\b(?:src|href)="([^"]+)"/.exec(m[0])?.[1];
    if (url) uit.add(new URL(url, basisUrl).href);
  }
  return uit;
}

async function hoofd() {
  const args = leesArgs(process.argv.slice(2));
  let tijdelijk = null;
  let dist = args.dist && path.resolve(args.dist);
  if (!dist) {
    tijdelijk = fs.mkdtempSync(path.join(os.tmpdir(), 'opds-csp-'));
    dist = path.join(tijdelijk, 'dist');
    const { bouwGehost } = await import('./pak-webbundel.mjs');
    meld('Building the hosted bundle (--mode hosted --base=./)...');
    await bouwGehost(dist);
  }
  const fouten = [];
  const eis = (ok, bericht) => { if (!ok) fouten.push(bericht); return ok; };

  // index.html zelf: geen inline code, SRI op alles.
  const html = fs.readFileSync(path.join(dist, 'index.html'), 'utf8');
  const htmlFouten = controleerIndexHtml(html, (rel) => fs.readFileSync(path.join(dist, ...rel.split('/'))));
  eis(htmlFouten.length === 0, `index.html: ${htmlFouten.join('; ')}`);
  meld(`index.html: ${htmlFouten.length ? htmlFouten.join('; ') : 'no inline code, SRI on every script and stylesheet'}`);

  const werk = tijdelijk || fs.mkdtempSync(path.join(os.tmpdir(), 'opds-csp-'));
  const tegenproefMap = path.join(werk, 'tegenproef');
  fs.mkdirSync(tegenproefMap, { recursive: true });
  for (const [naam, inhoud] of Object.entries(TEGENPROEF_BESTANDEN)) fs.writeFileSync(path.join(tegenproefMap, naam), inhoud);

  const headers = {};
  const server = await startServer({ [SUB]: dist, [TEGENPROEF]: tegenproefMap }, { poort: args.poort, headers });
  headers['Content-Security-Policy'] = cspBeleid(server.origin);
  meld(`Serving ${dist} at ${server.origin}${SUB}\n  Content-Security-Policy: ${headers['Content-Security-Policy']}`);

  const pdfPad = path.join(werk, 'proef.pdf');
  fs.writeFileSync(pdfPad, await maakProefPdf());

  const browser = await chromium.launch({ headless: true });
  try {
    const tp = await tegenproef(browser, server.origin);
    meld(`Control page: inline script ${tp.inline ? 'seen' : 'MISSED'}, eval in page ${tp.eval ? 'seen' : 'MISSED'}, eval in worker ${tp.worker ? 'seen' : 'MISSED'}`);
    eis(tp.inline && tp.eval && tp.worker, 'control: a deliberate violation was not reported; the detector is blind');

    const p = await nieuwePagina(browser, server.origin, sriUrls(html, `${server.origin}${SUB}`), { acceptDownloads: true });
    const { page } = p;
    await page.goto(`${server.origin}${SUB}`, { waitUntil: 'load', timeout: 60000 });

    // Openen en tekenen.
    await openPdfInApp(page, pdfPad);
    const inkt = await inktPerBand(page);
    for (const [band, n] of Object.entries(inkt)) eis(n > 50, `no ink in band ${band} (${n})`);
    meld(`1. opened and drawn (ink per band ${JSON.stringify(inkt)})`);

    // Annoteren: rechthoek-gereedschap, slepen over een leeg stuk pagina.
    await page.locator('button.tp-btn[title="Rect"]').first().click();
    const vak = await page.locator('canvas#annotation-canvas').boundingBox()
      || await page.locator('canvas#pdf-canvas').boundingBox();
    const x0 = vak.x + vak.width * 0.55;
    const y0 = vak.y + vak.height * 0.15;
    await page.mouse.move(x0, y0);
    await page.mouse.down();
    await page.mouse.move(x0 + 60, y0 + 40, { steps: 5 });
    await page.mouse.move(x0 + 120, y0 + 80, { steps: 5 });
    await page.mouse.up();
    await page.waitForTimeout(500);
    const totaal = await page.evaluate(() => document.querySelector('.status-bar, #status-bar')?.textContent || document.body.innerText);
    eis(/Annotations:\s*1\b/.test(totaal), 'the rectangle annotation was not created');
    meld('2. rectangle annotation drawn');

    // Opslaan: in de browser wordt dat een download.
    const [download] = await Promise.all([
      page.waitForEvent('download', { timeout: 30000 }),
      page.click('.quick-access-toolbar .quick-access-btn >> nth=1'),
    ]);
    const opgeslagen = path.join(werk, 'opgeslagen.pdf');
    await download.saveAs(opgeslagen);
    const doc = await PDFDocument.load(fs.readFileSync(opgeslagen));
    const annots = doc.getPage(0).node.Annots();
    const soorten = annots ? annots.asArray().map((r) => String(doc.context.lookup(r).get(PDFName.of('Subtype')))) : [];
    eis(soorten.includes('/Square'), `saved PDF has no Square annotation (${soorten.join(', ') || 'none'})`);
    meld(`3. saved ${fs.statSync(opgeslagen).size} bytes, annotations: ${soorten.join(', ') || 'none'}`);

    await page.waitForTimeout(500);
    const overtredingen = await p.overtredingen();
    const cspConsole = p.consolefouten.filter(isCsp);
    eis(overtredingen.length === 0, `CSP violation events:\n    ${overtredingen.join('\n    ')}`);
    eis(p.consolefouten.length === 0, `console errors:\n    ${p.consolefouten.join('\n    ')}`);
    eis(p.paginafouten.length === 0, `page errors:\n    ${p.paginafouten.join('\n    ')}`);
    meld(`4. ${overtredingen.length} violation event(s), ${cspConsole.length} CSP console report(s), ${p.consolefouten.length} console error(s)`);

    const buiten = server.verzoeken.filter((v) => !v.url.startsWith(SUB) && !v.url.startsWith(TEGENPROEF));
    eis(buiten.length === 0, `requests outside ${SUB}: ${buiten.map((v) => v.url).join(', ')}`);
    await p.ctx.close();
  } finally {
    await browser.close();
    await server.sluit();
    fs.rmSync(werk, { recursive: true, force: true });
  }

  if (fouten.length) {
    console.error(`\nFAILED (${fouten.length}):\n  ${fouten.join('\n  ')}`);
    process.exit(1);
  }
  meld('\nOK: the hosted bundle runs under the strict CSP without violations');
}

hoofd().catch((e) => {
  console.error(e);
  process.exit(1);
});
