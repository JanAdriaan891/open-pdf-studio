// Toetscombinaties voor de eigen sneltoetsen (#714).
//
// Een combinatie is een tekst als "Ctrl+Shift+S", "F7", "PageDown" of
// "Ctrl+Plus": de modificatoren altijd in de volgorde Ctrl, Alt, Shift, dan de
// toets. Cmd op een Mac telt als Ctrl, net als in de toetsafhandeling van de
// app (keyboard-handlers.js). Pure functies, zonder DOM.

const MODIFICATOREN = ['Ctrl', 'Alt', 'Shift'];
const ALLEEN_MODIFICATOR = new Set(['Control', 'Shift', 'Alt', 'Meta', 'AltGraph', 'OS', 'CapsLock', 'Fn']);

// e.key-namen die een eigen, leesbare naam krijgen.
const NAMEN = {
  ' ': 'Space', '+': 'Plus', '-': 'Minus',
  ArrowUp: 'Up', ArrowDown: 'Down', ArrowLeft: 'Left', ArrowRight: 'Right',
  Esc: 'Escape', Del: 'Delete',
};

// Toetsen die nooit een eigen sneltoets kunnen worden: Escape blijft
// "annuleren" (#273), Tab en Enter horen bij de bediening van dialogen.
const VERBODEN = new Set(['Escape', 'Tab', 'Enter']);

function toetsNaam(key) {
  if (typeof key !== 'string' || !key) return null;
  if (ALLEEN_MODIFICATOR.has(key) || key === 'Unidentified' || key === 'Dead' || key === 'Process') return null;
  if (NAMEN[key]) return NAMEN[key];
  if (key.length === 1) return key.toUpperCase();
  return key;
}

/**
 * De combinatie van een keydown-event, of null voor een losse modificator.
 * @param {{ key:string, ctrlKey?:boolean, metaKey?:boolean, altKey?:boolean, shiftKey?:boolean }} e
 */
export function combinatieVan(e) {
  // Plus en Minus naar de fysieke toets, zoals de app ze zelf herkent
  // (Ctrl+Shift+Plus/Minus draait de pagina, Ctrl+= en Ctrl+- zoomen).
  let toets;
  if (e?.code === 'Minus' || e?.code === 'NumpadSubtract') toets = 'Minus';
  else if (e?.code === 'NumpadAdd') toets = 'Plus';
  else if (e?.code === 'Equal') toets = e.shiftKey ? 'Plus' : '=';
  else toets = toetsNaam(e?.key);
  if (!toets) return null;
  const delen = [];
  if (e.ctrlKey || e.metaKey) delen.push('Ctrl');
  if (e.altKey) delen.push('Alt');
  // Shift zit al in een hoofdletterloos teken als "?" of "!": alleen bij
  // letters, cijfers, benoemde toetsen en Plus/Minus telt Shift mee.
  if (e.shiftKey && (toets.length > 1 || /^[A-Z0-9]$/.test(toets))) delen.push('Shift');
  delen.push(toets);
  return delen.join('+');
}

/** Een combinatie in de vaste vorm, of null als ze niet geldig is. */
export function normaliseer(combinatie) {
  if (typeof combinatie !== 'string') return null;
  const delen = combinatie.split('+').map((d) => d.trim());
  // "Ctrl++" (de plustoets) staat als laatste lege delen.
  if (combinatie.endsWith('++')) { delen.splice(-2, 2, 'Plus'); }
  const toets = delen.pop();
  if (!toets) return null;
  const mods = new Set();
  for (const d of delen) {
    const m = MODIFICATOREN.find((x) => x.toLowerCase() === d.toLowerCase()) || (/^(cmd|meta|control)$/i.test(d) ? 'Ctrl' : null);
    if (!m) return null;
    mods.add(m);
  }
  const naam = toetsNaam(toets.length === 1 ? toets : (NAMEN[toets] || toets));
  if (!naam) return null;
  return [...MODIFICATOREN.filter((m) => mods.has(m)), naam].join('+');
}

/** Mag deze combinatie een sneltoets zijn? */
export function isToegestaan(combinatie) {
  const c = normaliseer(combinatie);
  if (!c) return false;
  const toets = c.split('+').pop();
  return !VERBODEN.has(toets);
}

/**
 * Zonder Ctrl of Alt: een "enkele" toets (letter, cijfer, F-toets, PageDown…).
 * Zo'n sneltoets werkt nooit tijdens het typen.
 */
export function isEnkeleToets(combinatie) {
  const c = normaliseer(combinatie) || '';
  return !c.startsWith('Ctrl+') && !c.startsWith('Alt+');
}

/**
 * Een nagebootst keydown-event voor een combinatie, om een bestaande
 * sneltoets precies zo af te spelen als de gebruiker hem indrukt.
 */
export function eventVoor(combinatie, doel = null) {
  const c = normaliseer(combinatie);
  if (!c) return null;
  const delen = c.split('+');
  const toets = delen.pop();
  const shift = delen.includes('Shift');
  let key = toets;
  let code = toets;
  if (/^[A-Z]$/.test(toets)) { key = shift ? toets : toets.toLowerCase(); code = `Key${toets}`; }
  else if (/^[0-9]$/.test(toets)) { code = `Digit${toets}`; }
  else if (toets === 'Plus') { key = '+'; code = 'Equal'; }
  else if (toets === 'Minus') { key = '-'; code = 'Minus'; }
  else if (toets === '=') { code = 'Equal'; }
  else if (toets === ',') { code = 'Comma'; }
  else if (toets === 'Space') { key = ' '; code = 'Space'; }
  else if (['Up', 'Down', 'Left', 'Right'].includes(toets)) { key = `Arrow${toets}`; code = key; }
  let tegengehouden = false;
  return {
    type: 'keydown', key, code,
    ctrlKey: delen.includes('Ctrl'), metaKey: false, altKey: delen.includes('Alt'), shiftKey: shift,
    repeat: false, target: doel, isTrusted: false,
    get defaultPrevented() { return tegengehouden; },
    preventDefault() { tegengehouden = true; },
    stopPropagation() {}, stopImmediatePropagation() {},
  };
}
