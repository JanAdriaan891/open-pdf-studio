// Opslaan annuleren (#766). De knop Annuleren in het laadvenster (en Esc)
// vraagt het stoppen; de saver kijkt op veilige punten (tussen pagina's,
// tussen de stappen, vlak voor het schrijven) of dat gevraagd is en stopt dan
// met OpslaanGeannuleerd. Tot het schrijven begint staat er niets op schijf:
// het doelbestand blijft zoals het was en het document houdt zijn wijzigingen.
// Het schrijven zelf (tijdelijk bestand + hernoemen) wordt niet onderbroken.
//
// Een lange lus zonder await laat de bediening geen klik verwerken; tik()
// geeft daarom hooguit eens per `pauzeMs` de event-loop even ruimte.

export class OpslaanGeannuleerd extends Error {
  constructor() {
    super('save cancelled');
    this.name = 'OpslaanGeannuleerd';
    this.geannuleerd = true;
  }
}

export function isOpslaanGeannuleerd(fout) {
  return !!fout && (fout.geannuleerd === true || fout.name === 'OpslaanGeannuleerd');
}

/**
 * @param {{ nu?: () => number, pauze?: () => Promise<void>, pauzeMs?: number }} [opties]
 *   nu en pauze zijn in te vullen voor tests.
 */
export function maakOpslaanAnnulering({
  nu = () => (typeof performance !== 'undefined' ? performance.now() : Date.now()),
  pauze = () => new Promise((klaar) => setTimeout(klaar, 0)),
  pauzeMs = 50,
} = {}) {
  let gevraagd = false;
  let schrijftAl = false;
  let laatstePauze = nu();
  return {
    /** Vraag het stoppen; na het begin van het schrijven telt het niet meer. */
    annuleer() { if (!schrijftAl) gevraagd = true; },
    get gevraagd() { return gevraagd; },
    /** Gooit OpslaanGeannuleerd als stoppen gevraagd is. */
    controleer() {
      if (gevraagd) throw new OpslaanGeannuleerd();
    },
    /** Geef de bediening af en toe ruimte en controleer daarna. */
    async tik() {
      if (nu() - laatstePauze >= pauzeMs) {
        await pauze();
        laatstePauze = nu();
      }
      if (gevraagd) throw new OpslaanGeannuleerd();
    },
    /** Laatste controle; daarna wordt er geschreven en telt annuleren niet meer. */
    beginSchrijven() {
      if (gevraagd) throw new OpslaanGeannuleerd();
      schrijftAl = true;
    },
  };
}
