// Tekstbewerking met tekens buiten WinAnsi (text-edits.js). Heeft het
// originele font de tekens niet, dan viel de saver terug op Standard-14 en
// werd elk teken buiten WinAnsi stil een '?' of verloor het zijn accent:
// Koreaans/Chinees kwam terug als "??? ???", terwijl de weergave de tekst wel
// toonde. Nu komt er een gebundeld volledig font dat alle tekens heeft.
import assert from 'node:assert/strict';
import test from 'node:test';
import fs from 'node:fs';
import { register } from 'node:module';
import { PDFDocument, StandardFonts, PDFName } from 'pdf-lib';
import fontkit from '@pdf-lib/fontkit';
import * as mupdf from 'mupdf';

register('../../core/app-test-hooks.mjs', import.meta.url);
const { installeerBrowserStubs } = await import('../../core/app-test-hooks.mjs');
installeerBrowserStubs();
const { saveTextEditsToPages } = await import('./text-edits.js');

const LIBERATION = fs.readFileSync(new URL('../../../node_modules/pdfjs-dist/standard_fonts/LiberationSans-Regular.ttf', import.meta.url));

async function bronPdf() {
  const pdf = await PDFDocument.create();
  const page = pdf.addPage([595, 842]);
  const font = await pdf.embedFont(StandardFonts.Helvetica);
  page.node.setFontDictionary(PDFName.of('F1'), font.ref);
  page.node.set(PDFName.of('Contents'), pdf.context.register(pdf.context.flateStream(
    'BT /F1 12 Tf 72 700 Td (Plaats: Lodz) Tj ET\n')));
  return pdf.save({ useObjectStreams: false });
}

function tekstVan(bytes) {
  const d = mupdf.Document.openDocument(bytes, 'application/pdf');
  return d.loadPage(0).toStructuredText().asText();
}

test('tekens buiten WinAnsi komen met een volledig font in het bestand', async () => {
  const doc = await PDFDocument.load(await bronPdf());
  const edit = {
    id: 'u1', page: 1, originalText: 'Plaats: Lodz', newText: 'Plaats: Łódź ő',
    pdfX: 72, pdfY: 700, pdfWidth: 70, fontSize: 12, lineSpacing: 14.4, numOriginalLines: 1,
    fontFamily: 'Helvetica', loadedFontName: '', color: '#000000', textAngle: 0,
    originalLineInfo: [{ x: 72, y: 700, width: 70, fontSize: 12, angle: 0, text: 'Plaats: Lodz' }],
    originalSpanTexts: [['Plaats: Lodz']],
  };
  let gevraagd = null;
  const kiesUnicodeFont = async (pdfDoc, tekst) => {
    gevraagd = tekst;
    pdfDoc.registerFontkit(fontkit);
    return { font: await pdfDoc.embedFont(LIBERATION, { subset: true }), name: 'LiberationSans-Regular' };
  };
  await saveTextEditsToPages(doc, doc.getPages(), { textEdits: [edit] }, { kiesUnicodeFont });
  const tekst = tekstVan(await doc.save());
  assert.equal(gevraagd, 'Plaats: Łódź ő');
  assert.match(tekst, /Plaats: Łódź ő/);
  assert.doesNotMatch(tekst, /Lodz/);
});

test('zonder passend font blijft de oude terugval (WinAnsi met vervanging)', async () => {
  const doc = await PDFDocument.load(await bronPdf());
  const edit = {
    id: 'u2', page: 1, originalText: 'Plaats: Lodz', newText: 'Plaats: Łódź',
    pdfX: 72, pdfY: 700, pdfWidth: 70, fontSize: 12, lineSpacing: 14.4, numOriginalLines: 1,
    fontFamily: 'Helvetica', loadedFontName: '', color: '#000000', textAngle: 0,
    originalLineInfo: [{ x: 72, y: 700, width: 70, fontSize: 12, angle: 0, text: 'Plaats: Lodz' }],
    originalSpanTexts: [['Plaats: Lodz']],
  };
  const kiesUnicodeFont = async () => { throw new Error('geen font'); };
  await saveTextEditsToPages(doc, doc.getPages(), { textEdits: [edit] }, { kiesUnicodeFont });
  assert.match(tekstVan(await doc.save()), /Plaats: Lódz/);
});
