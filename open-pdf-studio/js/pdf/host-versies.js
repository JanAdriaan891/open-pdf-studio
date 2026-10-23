// De versies van een document van de site, voor de lijst in "Op deze site" (#707).
//
// De site geeft ze via het opslagcontract (`versions(id)`, in de werkplek het
// bericht `versies`) als [{ version, modified?, author? }]. Openen kan alleen
// via `open { bestand }`: dat protocol kent geen versienummer (ouder.ts van de
// werkplek), dus alleen de huidige versie gaat open. Oudere versies staan er
// ter informatie.

const alsGetal = (v) => (typeof v === 'number' ? v : (/^\s*\d+\s*$/.test(String(v ?? '')) ? Number(v) : NaN));

/**
 * De versies, nieuwste eerst, met de huidige gemarkeerd.
 * Met alleen versienummers: aflopend op nummer en de hoogste is de huidige.
 * Anders blijft de volgorde van de site en is er geen huidige aan te wijzen.
 * @param {unknown} lijst
 * @returns {{ version: string, modified: string|null, author: string|null, huidig: boolean }[]}
 */
export function ordenVersies(lijst) {
  if (!Array.isArray(lijst)) return [];
  const versies = lijst
    .filter((v) => v && typeof v === 'object' && v.version !== undefined && v.version !== null && String(v.version) !== '')
    .map((v) => ({
      version: String(v.version),
      modified: typeof v.modified === 'string' && v.modified ? v.modified : null,
      author: typeof v.author === 'string' && v.author ? v.author : null,
      huidig: false,
    }));
  if (versies.length && versies.every((v) => Number.isFinite(alsGetal(v.version)))) {
    versies.sort((a, b) => alsGetal(b.version) - alsGetal(a.version));
    versies[0].huidig = true;
  }
  return versies;
}
