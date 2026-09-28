// Het gekozen en het aangewezen item in de Type-kiezer en de arceringskiezer
// krijgen --theme-accent-soft als achtergrond (#279). Geen enkel thema
// definieerde die variabele, dus gold overal de terugvalwaarde #cce4f7 —
// lichtblauw onder witte themakleur-tekst, in de donkere thema's nauwelijks
// leesbaar. Elk thema definieert hem nu, en de tekst blijft erop leesbaar.

import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const CSS = readFileSync(new URL('../../../../styles/themes.css', import.meta.url), 'utf8');

// Blokken per thema: [data-theme="naam"] { ... }
function themas() {
  const uit = {};
  const re = /\[data-theme="([^"]+)"\]\s*\{([\s\S]*?)\n\}/g;
  let m;
  while ((m = re.exec(CSS))) {
    const vars = {};
    for (const v of m[2].matchAll(/(--theme-[\w-]+)\s*:\s*([^;]+);/g)) vars[v[1]] = v[2].trim();
    uit[m[1]] = vars;
  }
  return uit;
}

function kleur(tekst) {
  const hex = /^#([0-9a-f]{6})$/i.exec(tekst);
  if (hex) {
    const n = parseInt(hex[1], 16);
    return { r: (n >> 16) & 255, g: (n >> 8) & 255, b: n & 255, a: 1 };
  }
  const rgba = /^rgba?\(\s*([\d.]+)\s*,\s*([\d.]+)\s*,\s*([\d.]+)\s*(?:,\s*([\d.]+)\s*)?\)$/i.exec(tekst);
  if (rgba) return { r: +rgba[1], g: +rgba[2], b: +rgba[3], a: rgba[4] != null ? +rgba[4] : 1 };
  throw new Error(`onbekende kleur ${tekst}`);
}

const over = (voor, achter) => ({
  r: voor.a * voor.r + (1 - voor.a) * achter.r,
  g: voor.a * voor.g + (1 - voor.a) * achter.g,
  b: voor.a * voor.b + (1 - voor.a) * achter.b,
  a: 1,
});

function luminantie({ r, g, b }) {
  const lin = (c) => { c /= 255; return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4; };
  return 0.2126 * lin(r) + 0.7152 * lin(g) + 0.0722 * lin(b);
}

const contrast = (a, b) => {
  const [l1, l2] = [luminantie(a), luminantie(b)].sort((x, y) => y - x);
  return (l1 + 0.05) / (l2 + 0.05);
};

test('elk thema definieert --theme-accent-soft', () => {
  const t = themas();
  assert.ok(Object.keys(t).length >= 7, `thema's: ${Object.keys(t).join(', ')}`);
  for (const [naam, vars] of Object.entries(t)) {
    assert.ok(vars['--theme-accent-soft'], `${naam}: --theme-accent-soft ontbreekt`);
  }
});

test('tekst in themakleur blijft leesbaar op de zachte accentkleur', () => {
  for (const [naam, vars] of Object.entries(themas())) {
    const vlak = kleur(vars['--theme-surface']);
    const achtergrond = over(kleur(vars['--theme-accent-soft']), vlak);
    const tekst = over(kleur(vars['--theme-text']), achtergrond);
    const c = contrast(tekst, achtergrond);
    assert.ok(c >= 4.5, `${naam}: contrast ${c.toFixed(2)} < 4,5`);
  }
});
