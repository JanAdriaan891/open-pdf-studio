// Plaats van een uitklaplijst die met position:fixed aan een knop in het
// eigenschappenpaneel hangt (Type-kiezer, arceringskiezer). De lijst blijft
// binnen het venster (#279): hij schuift naar links als hij anders voorbij de
// rechterrand valt, en klapt naar boven uit als er onder de knop minder
// ruimte is dan erboven.
//
//   knop:    { left, right, top, bottom } (getBoundingClientRect)
//   venster: { breedte, hoogte }          (innerWidth/innerHeight)
//   uitlijning: 'links' = linkerkant van de lijst op die van de knop,
//               'rechts' = rechterkanten gelijk.
//
// Uitkomst: { x, breedte, maxHoogte } plus óf { y } (naar beneden) óf
// { onder } (afstand van de onderrand van het venster, naar boven).
export function uitklapPositie(knop, venster, { breedte, maxHoogte, uitlijning = 'links', marge = 4, tussenruimte = 2 }) {
  const w = Math.max(0, Math.min(breedte, venster.breedte - 2 * marge));
  const gewenstX = uitlijning === 'rechts' ? knop.right - w : knop.left;
  const x = Math.max(marge, Math.min(gewenstX, venster.breedte - w - marge));

  const ruimteOnder = venster.hoogte - knop.bottom - tussenruimte - marge;
  const ruimteBoven = knop.top - tussenruimte - marge;
  const naarBoven = ruimteOnder < maxHoogte && ruimteBoven > ruimteOnder;
  const hoogte = Math.max(0, Math.min(maxHoogte, naarBoven ? ruimteBoven : ruimteOnder));

  return naarBoven
    ? { x, breedte: w, maxHoogte: hoogte, onder: venster.hoogte - knop.top + tussenruimte }
    : { x, breedte: w, maxHoogte: hoogte, y: knop.bottom + tussenruimte };
}
