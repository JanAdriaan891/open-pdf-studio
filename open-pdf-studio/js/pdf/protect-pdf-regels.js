// Pure rules of "Protect with password" (see protect-pdf.js): no state, no DOM.

import { opslaanGeweigerd } from './wachtwoord-pdf.js';

/** Shortest password the dialog accepts, in characters. */
export const MIN_LENGTE = 6;

/** The rights a recipient has; all on = unrestricted. */
export const STANDAARD_RECHTEN = Object.freeze({
  print: true,
  printHogeKwaliteit: true,
  wijzigen: true,
  kopieren: true,
  annoteren: true,
  formulieren: true,
  samenstellen: true,
  toegankelijkheid: true,
});

/**
 * Checks the dialog input. Returns an i18n key (dialogs namespace) for the
 * first problem, or null when the input can be used.
 * @param {{ gebruiker: string, gebruikerHerhaald: string, eigenaar: string, eigenaarHerhaald: string }} v
 */
export function controleerWachtwoorden({ gebruiker, gebruikerHerhaald, eigenaar, eigenaarHerhaald }) {
  if (!gebruiker && !eigenaar) return 'protectPdf.needPassword';
  // Een kort wachtwoord is snel te raden, ook bij AES-256.
  if ((gebruiker && [...gebruiker].length < MIN_LENGTE) || (eigenaar && [...eigenaar].length < MIN_LENGTE)) {
    return 'protectPdf.tooShort';
  }
  if (gebruiker !== gebruikerHerhaald) return 'protectPdf.userMismatch';
  if (eigenaar !== eigenaarHerhaald) return 'protectPdf.ownerMismatch';
  if (gebruiker && eigenaar && gebruiker === eigenaar) return 'protectPdf.samePassword';
  return null;
}

/**
 * Het bestand op schijf waaruit de beveiligde kopie gemaakt wordt, of null als
 * er geen kopie gemaakt mag worden.
 *  - Na een paginabewerking rendert het document uit een werkkopie
 *    (`filePath`); het opgeslagen bestand staat dan in `saveTargetPath`. De
 *    werkkopie mist wat daarna is opgeslagen (bv. nieuwe annotaties).
 *  - Een met een wachtwoord geopend document wordt nooit opgeslagen, ook niet
 *    als kopie (wachtwoord-pdf.js): `filePath` is dan de ONTSLEUTELDE
 *    werkkopie, en een kopie met alleen een rechtenwachtwoord zou zonder
 *    wachtwoord openen.
 *  - Een naamloos document heeft geen bestand op schijf.
 * @param {{filePath?:string, saveTargetPath?:string, isUntitled?:boolean, passwordProtected?:boolean}|null} doc
 * @returns {string|null}
 */
export function bronVoorBeveiliging(doc) {
  if (!doc || doc.isUntitled || opslaanGeweigerd(doc)) return null;
  return doc.saveTargetPath || doc.filePath || null;
}

