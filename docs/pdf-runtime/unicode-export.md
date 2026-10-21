# Unicode-exportcontract (#678)

De nieuwe suite gebruikt dezelfde `embedOcrFont` en `writeOcrTextLayer` als de
app. Elke fixture heeft een zichtbare pagina én een onzichtbare OCR-pagina.
De controle onderzoekt glyph-id's, zichtbare outlines, ingebedde fontprogramma's,
ToUnicode, PDF.js-extractie en een onafhankelijke MuPDF-WASM-rasterisatie.

Voorbereiden (cache buiten de checkout):

```
OPS_UNICODE_FONT_DIR=/pad/naar/cache node scripts/prepare-unicode-fonts.mjs
OPS_UNICODE_FONT_DIR=/pad/naar/cache node --test js/pdf/unicode-export-contract.test.mjs
```

De CI provisiont de bestanden vóór de unitsuite. Ontbrekende fixtures worden
lokaal zichtbaar overgeslagen; opgegeven maar ongeldige fixtures falen. URLs zijn
vastgezet op commits en SHA-256. De OFL-licenties worden mee opgehaald. De
fixtureverwijzingen zijn afkomstig uit het openbare craft-libs fontmanifest;
er wordt geen upstream implementatie overgenomen.

`check-unicode-browser.mjs` herhaalt de rondgang en canvasweergave in Chromium
tegen Vite (BASE_URL, standaard poort 3042). De Node-suite draait de onafhankelijke
MuPDF-WASM-renderer; dit is geen test van een native MuPDF-bibliotheek.

## Grenzen en gevonden afwijking

Latijnse accenten, Grieks, Cyrillisch, Vietnamees en Thai hebben exacte extractie.
De Thaise fixture is een variable font op de standaardinstelling; andere assen
zijn hiermee niet gekwalificeerd. De bestaande CJK-tekstvak- en ontbrekend-font-
tests blijven nodig voor de echte saver en zijn niet vervangen.

Arabisch is een **bekende falende TODO-test**: fontkit produceert bij de gekozen
fixture ook gevormde glyphs zonder codePoints. Bij heropenen voegt PDF.js daar
controletekens aan toe. De browserrunner vermeldt dit afzonderlijk en verbergt
het niet als een geslaagde extractie. Geen claim op correcte RTL-caretposities,
joining of volledige tekstbewerking. Deze afwijking vraagt een afzonderlijke
ToUnicode/shaping-oplossing vóór kwalificatie.

Deze suite kwalificeert de gedeelde embedding-/OCR-primitieven. Zij bewijst niet
dat alle bestaande tekstedit-, formulier- of annotatiepaden alle scripts kunnen
opslaan. Uitbreiding van die paden en niet-standaard fontvariaties blijft onderdeel
van #678; de regressie-infrastructuur maakt die gaten nu reproduceerbaar.
