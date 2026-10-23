// Een document van de gastsite openen (#546).
//
// Het opslagcontract zelf staat in core/platform.js; hier zit alleen de stap
// naar een tabblad. Een document van de site opent als elk ander document:
// een tabblad met als pad `opds-host://<id>/<naam>`, zodat Opslaan (Ctrl+S)
// via writeBinaryFile() teruggaat naar de site.
//
// De site geeft een document op twee manieren mee:
//  - bij de start: `window.__OPDS_HOST__.document = '<id>'`
//  - later (een site die zelf niet herlaadt):
//      window.dispatchEvent(new CustomEvent('opds:open-document', { detail: { id } }))
//
// In de werkplek (#704) kan de site een document alleen-lezen geven (dan is
// het hier alleen-lezen, zie isHostAlleenLezen), hoort de site welk document
// open staat (`geopend`) en krijgt hij een mislukte open als melding.

import i18next from '../i18n/config.js';
import { gastObject } from '../core/gehost.js';
import { hostOpslag, openHostBestand, meldHostGeopend, meldBijHost } from '../core/platform.js';
import { state } from '../core/state.js';
import { createTab } from '../ui/chrome/tabs.js';
import { loadPDFIfNeeded } from './loader.js';
import { showMessage } from '../bridge.js';

export const OPEN_EVENT = 'opds:open-document';

/** Open document `id` van de site in een tabblad. */
export async function openHostDocument(id) {
  if (id === undefined || id === null || id === '') return false;
  try {
    const { pad, data, alleenLezen } = await openHostBestand(id);
    const { index } = createTab(pad);
    // Het document zoals de store het geeft (niet het kale object van
    // createTab), en vóór het laden, zodat bewerken geen moment kan.
    const doc = state.documents[index];
    if (alleenLezen && doc) doc.hostAlleenLezen = true;
    await loadPDFIfNeeded(pad, index, data);
    if (doc && state.documents.includes(doc) && doc.pdfDoc) void meldHostGeopend(id);
    return true;
  } catch (e) {
    // Afgehandeld: de gebruiker en de site horen het hieronder.
    console.warn('[gast] document van de site niet geopend:', e);
    // De brug naar de gastpagina (core/host-brug.js) geeft een eigen, vertaalde
    // melding mee, of heeft het geen-contact al gemeld.
    if (!e?.gemeld) {
      const melding = typeof e?.gebruikersMelding === 'string' && e.gebruikersMelding
        ? e.gebruikersMelding
        : i18next.t('failedToLoadPdf', { error: e?.message || String(e) });
      showMessage(melding);
      // Ook in de statusbalk van de site, als die dat kent.
      void meldBijHost(melding, 'fout');
    }
    return false;
  }
}

/**
 * Bij de start: het document dat de site meegeeft openen en luisteren naar
 * latere verzoeken. Zonder opslagcontract gebeurt er niets.
 * @returns {Promise<boolean>} of er een document van de site openging
 */
export async function startMetGastsite() {
  if (!hostOpslag()) return false;
  window.addEventListener(OPEN_EVENT, (e) => { openHostDocument(e?.detail?.id); });
  return openHostDocument(gastObject()?.document);
}
