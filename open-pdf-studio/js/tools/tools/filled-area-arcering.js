// Arcering van de schets van een gevuld gebied (#279).
//
// De voorbeeldweergave tijdens het tekenen moet precies de arcering tonen die
// het vlak na afronden krijgt: dezelfde parameters als het vlak dat de tool
// aanmaakt (filled-area-tool.js, _createFilledAreaAnnotation) en dezelfde
// schaalregio-factor als rendering.js — die neemt het EERSTE punt van de
// buitencontour. In de gatenfase gebruikte de schets eerst het eerste punt
// van het gat (of helemaal geen regiofactor), zodat de arceringsdichtheid bij
// het afronden versprong.

// Punt waar de schaalregio bemonsterd wordt.
export function regioMonsterpunt(fase, buitenPunten, huidigePunten, cursor) {
  if (fase === 'holes' && buitenPunten && buitenPunten.length > 0) return buitenPunten[0];
  if (huidigePunten && huidigePunten.length > 0) return huidigePunten[0];
  return cursor;
}

// Arceringsopties voor drawMeasureAreaShape, of null zonder arcering.
export function schetsArcering(prefs, regioFactor = 1) {
  const patroon = prefs?.filledAreaHatchPattern;
  if (!patroon || patroon === 'none') return null;
  return {
    pattern: patroon,
    // Zelfde terugval als het aangemaakte vlak (hatchColor || '#000000').
    color: prefs.filledAreaHatchColor || '#000000',
    scale: (prefs.filledAreaHatchScale ?? 100) * regioFactor,
    angle: prefs.filledAreaHatchAngle ?? 0,
  };
}
