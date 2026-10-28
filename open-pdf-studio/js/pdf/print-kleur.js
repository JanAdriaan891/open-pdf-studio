// Kleurmodus van de afdruk (#754): in kleur, in grijswaarden of zwart-wit.
//
// De printopdracht en het voorbeeld werken met paginabeelden (canvas). De
// omzetting gebeurt op die pixels: grijs volgens de luminantie (ITU-R BT.601,
// dezelfde weging als de meeste printerstuurprogramma's), zwart-wit met een
// drempel op de helft. Het alfakanaal blijft staan. Pure functies op de
// pixeldata, los te testen; maakCanvasGrijs werkt in banden, zodat een A0 op
// 300 dpi niet in één keer als ImageData in het geheugen hoeft.

export const KLEUR_MODI = Object.freeze(['color', 'grayscale', 'bw']);

/** Hoort er iets omgezet te worden? Een onbekende modus telt als kleur. */
export function moetOmzetten(modus) {
  return modus === 'grayscale' || modus === 'bw';
}

/** Grijswaarde (0..255) van een RGB-pixel. */
export function luminantie(r, g, b) {
  return Math.round(0.299 * r + 0.587 * g + 0.114 * b);
}

/**
 * Zet RGBA-pixeldata ter plekke om.
 * @param {Uint8ClampedArray|Uint8Array} data
 * @param {'color'|'grayscale'|'bw'} modus
 */
export function zetPixelsOm(data, modus) {
  if (!moetOmzetten(modus)) return data;
  const zw = modus === 'bw';
  for (let i = 0; i < data.length; i += 4) {
    let l = luminantie(data[i], data[i + 1], data[i + 2]);
    if (zw) l = l < 128 ? 0 : 255;
    data[i] = l;
    data[i + 1] = l;
    data[i + 2] = l;
  }
  return data;
}

/**
 * Zet een canvas ter plekke om, per band van `band` rijen.
 * @param {HTMLCanvasElement} canvas
 * @param {'color'|'grayscale'|'bw'} modus
 * @returns {HTMLCanvasElement} hetzelfde canvas
 */
export function maakCanvasGrijs(canvas, modus, band = 512) {
  if (!moetOmzetten(modus) || !canvas?.width || !canvas?.height) return canvas;
  const ctx = canvas.getContext('2d', { willReadFrequently: true });
  for (let y = 0; y < canvas.height; y += band) {
    const hoogte = Math.min(band, canvas.height - y);
    const beeld = ctx.getImageData(0, y, canvas.width, hoogte);
    zetPixelsOm(beeld.data, modus);
    ctx.putImageData(beeld, 0, y);
  }
  return canvas;
}
