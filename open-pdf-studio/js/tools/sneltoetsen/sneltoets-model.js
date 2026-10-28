// Eigen sneltoetsen (#714): het model, zonder DOM.
//
// Elke opdracht heeft standaardtoetsen (wat de app altijd al deed). De
// gebruiker legt per opdracht een eigen lijst vast; die vervangt de standaard
// van die opdracht. In de voorkeuren staat alleen wat afwijkt:
//   keyboardShortcuts: { [opdracht-id]: ["Ctrl+Shift+F", …] }   ([] = geen toets)
//
// De bestaande toetsafhandeling blijft de standaardtoetsen uitvoeren. De
// verdeler (sneltoets-verdeler.js) grijpt alleen in waar de gebruiker iets
// veranderde: een eigen combinatie voert haar opdracht uit, een weggehaalde
// of verplaatste standaardtoets doet niets meer.

import { normaliseer, isToegestaan } from './toets-combinatie.js';

export const EXPORT_FORMAAT = 'open-pdf-studio-shortcuts';
export const EXPORT_VERSIE = 1;

function uniek(lijst) {
  const uit = [];
  for (const c of lijst) {
    const n = normaliseer(c);
    if (n && !uit.includes(n)) uit.push(n);
  }
  return uit;
}

/** Een gecontroleerde kopie van de opgeslagen eigen toetsen. */
export function schoonEigen(eigen) {
  const uit = {};
  if (!eigen || typeof eigen !== 'object' || Array.isArray(eigen)) return uit;
  for (const [id, lijst] of Object.entries(eigen)) {
    if (typeof id !== 'string' || !id || !Array.isArray(lijst)) continue;
    uit[id] = uniek(lijst.filter((c) => typeof c === 'string' && isToegestaan(c)));
  }
  return uit;
}

/** De standaardtoetsen per opdracht-id (genormaliseerd). */
export function standaardVan(opdrachten) {
  const uit = new Map();
  for (const o of opdrachten) uit.set(o.id, uniek(o.standaard || []));
  return uit;
}

/** Per opdracht de toetsen die nu gelden. */
export function effectief(opdrachten, eigen = {}) {
  const uit = new Map();
  for (const [id, standaard] of standaardVan(opdrachten)) {
    uit.set(id, Object.prototype.hasOwnProperty.call(eigen, id) ? [...eigen[id]] : standaard);
  }
  // Eigen toetsen van een opdracht die (nog) niet bestaat, zoals een
  // extensie die later laadt, blijven bewaard en tellen mee zodra ze er is.
  return uit;
}

/** Welke opdracht heeft deze combinatie nu? (null = geen) */
export function opdrachtMet(combinatie, opdrachten, eigen = {}, { behalve = null } = {}) {
  const c = normaliseer(combinatie);
  if (!c) return null;
  for (const [id, toetsen] of effectief(opdrachten, eigen)) {
    if (id !== behalve && toetsen.includes(c)) return id;
  }
  return null;
}

function zetLijst(opdrachten, eigen, id, lijst) {
  const standaard = standaardVan(opdrachten).get(id) || [];
  const uit = { ...eigen };
  const zelfde = lijst.length === standaard.length && lijst.every((c, i) => c === standaard[i]);
  if (zelfde) delete uit[id];
  else uit[id] = lijst;
  return uit;
}

/**
 * Geef opdracht `id` combinatie `combinatie`. Had een andere opdracht die,
 * dan verliest die hem (Opnieuw toewijzen). Geeft de nieuwe eigen toetsen.
 */
export function wijsToe(opdrachten, eigen, id, combinatie) {
  const c = normaliseer(combinatie);
  if (!c || !isToegestaan(c)) return eigen;
  let uit = { ...eigen };
  const huidig = effectief(opdrachten, uit);
  for (const [anderId, toetsen] of huidig) {
    if (anderId !== id && toetsen.includes(c)) {
      uit = zetLijst(opdrachten, uit, anderId, toetsen.filter((x) => x !== c));
    }
  }
  const eigenLijst = effectief(opdrachten, uit).get(id) || [];
  if (!eigenLijst.includes(c)) uit = zetLijst(opdrachten, uit, id, [...eigenLijst, c]);
  return uit;
}

/** Haal één combinatie weg bij opdracht `id`. */
export function haalWeg(opdrachten, eigen, id, combinatie) {
  const c = normaliseer(combinatie);
  const lijst = (effectief(opdrachten, eigen).get(id) || []).filter((x) => x !== c);
  return zetLijst(opdrachten, eigen, id, lijst);
}

/** Opdracht `id` terug naar haar standaardtoetsen. Wie die nu heeft, verliest ze. */
export function herstel(opdrachten, eigen, id) {
  let uit = { ...eigen };
  delete uit[id];
  for (const c of standaardVan(opdrachten).get(id) || []) {
    for (const [anderId, toetsen] of effectief(opdrachten, uit)) {
      if (anderId !== id && toetsen.includes(c)) {
        uit = zetLijst(opdrachten, uit, anderId, toetsen.filter((x) => x !== c));
      }
    }
  }
  return uit;
}

/**
 * Wat doet een ingedrukte combinatie?
 *  { soort: 'door' }            de gewone toetsafhandeling doet het (standaard)
 *  { soort: 'uitvoeren', id }   de gebruiker gaf deze combinatie aan opdracht id
 *  { soort: 'slikken' }         een standaardtoets die de gebruiker weghaalde
 */
export function beslis(combinatie, opdrachten, eigen = {}) {
  const c = normaliseer(combinatie);
  if (!c || !eigen || Object.keys(eigen).length === 0) return { soort: 'door' };
  const standaard = standaardVan(opdrachten);
  const nu = effectief(opdrachten, eigen);
  for (const [id, toetsen] of nu) {
    if (!toetsen.includes(c)) continue;
    // Dezelfde opdracht had deze toets al standaard: de app doet het zelf.
    if ((standaard.get(id) || []).includes(c)) return { soort: 'door' };
    return { soort: 'uitvoeren', id };
  }
  for (const [id, toetsen] of standaard) {
    if (toetsen.includes(c) && !(nu.get(id) || []).includes(c)) return { soort: 'slikken' };
  }
  return { soort: 'door' };
}

/** De eigen toetsen als tekst voor een exportbestand. */
export function exporteer(eigen) {
  return JSON.stringify({ format: EXPORT_FORMAAT, version: EXPORT_VERSIE, shortcuts: schoonEigen(eigen) }, null, 2);
}

/**
 * Lees een exportbestand. Gooit een Error met `code` bij een ongeldig bestand.
 * @returns {Record<string,string[]>}
 */
export function importeer(tekst) {
  let data;
  try { data = JSON.parse(tekst); } catch { throw Object.assign(new Error('not JSON'), { code: 'ongeldig' }); }
  if (!data || data.format !== EXPORT_FORMAAT || typeof data.shortcuts !== 'object') {
    throw Object.assign(new Error('not a shortcuts file'), { code: 'ongeldig' });
  }
  if (data.version > EXPORT_VERSIE) throw Object.assign(new Error('newer version'), { code: 'nieuwer' });
  return schoonEigen(data.shortcuts);
}
