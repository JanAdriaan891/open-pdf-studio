// Arceringsgegevens van een vlak: schrijven naar de annotatie en teruglezen.
//
// De arcering staat als lijnen in de appearance, zodat elke lezer hem toont.
// Om hem in de app te kunnen blijven bewerken moeten de parameters er ook als
// eigen sleutels bij: zonder die sleutels kent het model na heropenen geen
// arcering meer en schrijft de volgende save het vlak zonder arcering weg.

import { PDFName } from 'pdf-lib';
import { pdfTextString } from './pdf-text.js';

/** Zet OPS_HatchPattern/Color/Scale/Angle op de annotatie (niets bij 'none'). */
export function schrijfHatchMeta(annotDict, ann, context) {
  if (!ann?.hatchPattern || ann.hatchPattern === 'none') return false;
  annotDict.set(PDFName.of('OPS_HatchPattern'), pdfTextString(ann.hatchPattern));
  if (ann.hatchColor) annotDict.set(PDFName.of('OPS_HatchColor'), pdfTextString(ann.hatchColor));
  if (ann.hatchScale != null) annotDict.set(PDFName.of('OPS_HatchScale'), context.obj(ann.hatchScale));
  if (ann.hatchAngle != null) annotDict.set(PDFName.of('OPS_HatchAngle'), context.obj(ann.hatchAngle));
  return true;
}

/** De arceringsvelden voor het annotatiemodel, uit de gelezen OPS_-sleutels. */
export function hatchUitExtra(extra, standaardKleur = '#000000') {
  const e = extra || {};
  return {
    hatchPattern: e.opsHatchPattern || 'none',
    hatchColor: e.opsHatchColor || standaardKleur,
    hatchScale: e.opsHatchScale ?? 100,
    hatchAngle: e.opsHatchAngle ?? 0,
  };
}

/**
 * Arcering van een rechthoek, ellips, veelhoek of wolk (#279): alleen de
 * velden die het bestand heeft. Zonder arcering blijft het model gelijk aan
 * dat van een vorm zonder arcering; zonder eigen kleur volgt de arcering op
 * het scherm de randkleur, net als vóór het opslaan.
 */
export function hatchVanVorm(extra) {
  const e = extra || {};
  if (!e.opsHatchPattern || e.opsHatchPattern === 'none') return {};
  const uit = { hatchPattern: e.opsHatchPattern };
  if (e.opsHatchColor) uit.hatchColor = e.opsHatchColor;
  if (e.opsHatchScale != null) uit.hatchScale = e.opsHatchScale;
  if (e.opsHatchAngle != null) uit.hatchAngle = e.opsHatchAngle;
  return uit;
}

/**
 * Het gekozen type uit de Type-kiezer (arcering-, maatlijn-, pentype) als
 * /OPS_StyleType (#279). Zonder deze sleutel toonde de kiezer na heropenen
 * "Aangepast", ook als er sinds de keuze niets veranderd was.
 */
export function schrijfStijlType(annotDict, ann) {
  if (!ann?.styleType || typeof ann.styleType !== 'string') return false;
  annotDict.set(PDFName.of('OPS_StyleType'), pdfTextString(ann.styleType));
  return true;
}

/** Het gekozen type terug voor het model; niets als het bestand er geen heeft. */
export function stijlTypeUitExtra(extra) {
  const t = extra?.opsStyleType;
  return typeof t === 'string' && t ? { styleType: t } : {};
}
