// De opdrachten die een eigen sneltoets kunnen krijgen (#714).
//
// `standaard` is wat de app zonder eigen instellingen doet. Een opdracht met
// een standaardtoets voert de verdeler uit door die toets na te spelen in de
// gewone toetsafhandeling (`speelAf`): zo doet een eigen toets precies wat de
// standaardtoets doet, met dezelfde controles (alleen-lezen PDF/A, selectie,
// tekstbewerking…). Opdrachten zonder standaardtoets (bladeren, lint-
// opdrachten) roepen hun functie direct aan. Extensies leveren hun
// lintopdrachten via het opdrachtregister (plugins/extension-commands.js).

import { getActiveDocument } from '../../core/state.js';
import { setTool } from '../manager.js';
import { extensieOpdrachten, voerExtensieOpdrachtUit } from '../../plugins/extension-commands.js';

export const CATEGORIEEN = Object.freeze(['file', 'edit', 'view', 'navigation', 'tools', 'drafting', 'extensions']);

/** [id, categorie, Engelse naam, standaardtoetsen] van de opdrachten met een standaardtoets. */
const MET_TOETS = [
  ['file.new', 'file', 'New Document', ['Ctrl+N']],
  ['file.open', 'file', 'Open', ['Ctrl+O']],
  ['file.save', 'file', 'Save', ['Ctrl+S']],
  ['file.saveAs', 'file', 'Save As', ['Ctrl+Shift+S']],
  ['file.close', 'file', 'Close Tab', ['Ctrl+W']],
  ['file.properties', 'file', 'Document Properties', ['Ctrl+D']],
  ['file.preferences', 'file', 'Preferences', ['Ctrl+,']],
  ['edit.undo', 'edit', 'Undo', ['Ctrl+Z']],
  ['edit.redo', 'edit', 'Redo', ['Ctrl+Y', 'Ctrl+Shift+Z']],
  ['edit.selectAll', 'edit', 'Select All', ['Ctrl+A']],
  ['edit.copy', 'edit', 'Copy', ['Ctrl+C']],
  ['edit.cut', 'edit', 'Cut', ['Ctrl+X']],
  ['edit.paste', 'edit', 'Paste', ['Ctrl+V']],
  ['edit.pasteInPlace', 'edit', 'Paste in Place', ['Ctrl+Shift+V']],
  ['edit.delete', 'edit', 'Delete', ['Delete']],
  ['edit.clearPage', 'edit', 'Clear Page', ['Ctrl+Shift+C']],
  ['view.zoomIn', 'view', 'Zoom In', ['Ctrl+=']],
  ['view.zoomOut', 'view', 'Zoom Out', ['Ctrl+Minus']],
  ['view.actualSize', 'view', 'Actual Size', ['Ctrl+0']],
  ['view.fitWidth', 'view', 'Fit Width', ['Ctrl+1']],
  ['view.fitPage', 'view', 'Fit Page', ['Ctrl+2']],
  ['view.thinLines', 'view', 'Thin Lines', ['Ctrl+5']],
  ['view.rotateRight', 'view', 'Rotate Page Right', ['Ctrl+Shift+Plus']],
  ['view.rotateLeft', 'view', 'Rotate Page Left', ['Ctrl+Shift+Minus']],
  ['view.fullscreen', 'view', 'Full Screen', ['Ctrl+L']],
  ['view.find', 'view', 'Find', ['Ctrl+F']],
  ['view.findNext', 'view', 'Find Next', ['F3']],
  ['view.leftPanel', 'view', 'Toggle Left Panel', ['F8']],
  ['view.annotationsList', 'view', 'Toggle Annotations List', ['F11']],
  ['view.properties', 'view', 'Toggle Properties', ['F12']],
  ['view.shortcuts', 'view', 'Keyboard Shortcuts', ['F1']],
  ['navigation.nextTab', 'navigation', 'Next Tab', ['Ctrl+Tab', 'Ctrl+PageDown']],
  ['navigation.previousTab', 'navigation', 'Previous Tab', ['Ctrl+Shift+Tab', 'Ctrl+PageUp']],
  ['drafting.grid', 'drafting', 'Toggle Grid', ['F7']],
  ['drafting.snap', 'drafting', 'Toggle Snap to Grid', ['F9']],
  ['drafting.polar', 'drafting', 'Toggle Polar Tracking', ['F10']],
  ['drafting.objectSnap', 'drafting', 'Toggle Object Snap', ['Shift+F3']],
];

/** Gereedschappen: [id, gereedschap, Engelse naam, standaardtoetsen]. */
const GEREEDSCHAP = [
  ['tools.select', 'select', 'Select', ['V']],
  ['tools.hand', 'hand', 'Hand', ['H']],
  ['tools.highlight', 'highlight', 'Highlight', ['1']],
  ['tools.draw', 'draw', 'Freehand', ['2']],
  ['tools.line', 'line', 'Line', ['3']],
  ['tools.box', 'box', 'Rectangle', ['4']],
  ['tools.circle', 'circle', 'Ellipse', ['5']],
  ['tools.textbox', 'textbox', 'Text Box', ['T']],
  ['tools.comment', 'comment', 'Note', ['N']],
  ['tools.arrow', 'arrow', 'Arrow', []],
  ['tools.polyline', 'polyline', 'Polyline', []],
  ['tools.polygon', 'polygon', 'Polygon', []],
  ['tools.cloud', 'cloud', 'Cloud', []],
  ['tools.callout', 'callout', 'Callout', []],
  ['tools.stamp', 'stamp', 'Stamp', []],
  ['tools.eraser', 'eraser', 'Eraser', []],
  ['tools.measureDistance', 'measureDistance', 'Measure Distance', []],
  ['tools.measureArea', 'measureArea', 'Measure Area', []],
  ['tools.measurePerimeter', 'measurePerimeter', 'Measure Perimeter', []],
  ['tools.measureAngle', 'measureAngle', 'Measure Angle', []],
  ['tools.count', 'count', 'Count', []],
  ['tools.redaction', 'redaction', 'Redaction', []],
];

async function bladerNaar(welk) {
  const doc = getActiveDocument();
  if (!doc?.pdfDoc) return;
  const totaal = doc.pdfDoc.numPages || 1;
  const nu = doc.currentPage || 1;
  const doel = { next: Math.min(totaal, nu + 1), previous: Math.max(1, nu - 1), first: 1, last: totaal }[welk];
  if (doel === nu) return;
  const { goToPage } = await import('../../pdf/renderer.js');
  await goToPage(doel);
}

/** Opdrachten zonder standaardtoets: [id, categorie, Engelse naam, uitvoeren]. */
const ZONDER_TOETS = [
  ['file.print', 'file', 'Print', () => import('../../ui/chrome/dialogs.js').then((m) => m.showPrintDialog())],
  ['file.mergePdfs', 'file', 'Merge PDFs', () => import('../../ui/chrome/dialogs.js').then((m) => m.showMergePdfsDialog())],
  ['navigation.nextPage', 'navigation', 'Next Page', () => bladerNaar('next')],
  ['navigation.previousPage', 'navigation', 'Previous Page', () => bladerNaar('previous')],
  ['navigation.firstPage', 'navigation', 'First Page', () => bladerNaar('first')],
  ['navigation.lastPage', 'navigation', 'Last Page', () => bladerNaar('last')],
  ['edit.insertPage', 'edit', 'Insert Page', () => import('../../ui/chrome/dialogs.js').then((m) => m.showInsertPageDialog())],
  ['edit.extractPages', 'edit', 'Extract Pages', () => import('../../ui/chrome/dialogs.js').then((m) => m.showExtractPagesDialog())],
];

/**
 * Alle opdrachten, ingebouwd en van extensies.
 * @param {{ speelAf: (combinatie:string) => void, taal?: string }} opties
 * @returns {{ id:string, categorie:string, naam:string, standaard:string[], uitvoeren: () => any }[]}
 */
export function alleOpdrachten({ speelAf, taal = 'en' }) {
  const lijst = [];
  for (const [id, categorie, naam, standaard] of MET_TOETS) {
    lijst.push({ id, categorie, naam, standaard, uitvoeren: () => speelAf(standaard[0]) });
  }
  for (const [id, categorie, naam, uitvoeren] of ZONDER_TOETS) {
    lijst.push({ id, categorie, naam, standaard: [], uitvoeren });
  }
  for (const [id, gereedschap, naam, standaard] of GEREEDSCHAP) {
    lijst.push({
      id, categorie: 'tools', naam, standaard,
      uitvoeren: () => { if (getActiveDocument()?.pdfDoc) setTool(gereedschap); },
    });
  }
  for (const o of extensieOpdrachten.lijst(taal)) {
    lijst.push({
      id: o.command, categorie: 'extensions', naam: o.label || o.title || o.command, standaard: [],
      uitvoeren: () => voerExtensieOpdrachtUit(o.command, { source: 'ui' }),
    });
  }
  return lijst;
}

/** De ingebouwde opdracht-id's met hun standaardtoetsen (voor tests en de lijst). */
export const INGEBOUWDE_STANDAARD = Object.freeze(Object.fromEntries([
  ...MET_TOETS.map(([id, , , standaard]) => [id, standaard]),
  ...GEREEDSCHAP.map(([id, , , standaard]) => [id, standaard]),
  ...ZONDER_TOETS.map(([id]) => [id, []]),
]));
