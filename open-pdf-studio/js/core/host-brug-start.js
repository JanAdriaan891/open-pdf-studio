// De brug naar de gastpagina (core/host-brug.js, #694) aan de app koppelen.
//
// Alleen de gehoste bouw roept dit aan, als eerste stap van de opstart
// (main.js), zodat `window.__OPDS_HOST__` er staat vóór iets het opslagcontract
// leest. Zonder `#ouder=…` in een iframe, of met een contract van de
// gastpagina zelf, gebeurt er niets.

import i18next from '../i18n/config.js';
import { showMessage } from '../solid/stores/dialogStore.js';
import { installeerHostBrug } from './host-brug.js';

/** @returns {object|null} de brug, of null als hij niet nodig of niet toegestaan is */
export function startHostBrug(venster = window) {
  try {
    return installeerHostBrug({
      venster,
      vertaal: (sleutel) => i18next.t(sleutel),
      bijGeenContact: (fout) => {
        console.warn('[brug]', fout?.message);
        showMessage(i18next.t('hostNoContact'));
      },
    });
  } catch (e) {
    console.warn('[brug] niet gestart:', e);
    return null;
  }
}
