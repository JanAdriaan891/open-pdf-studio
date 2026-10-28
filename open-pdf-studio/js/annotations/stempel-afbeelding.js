// Afbeelding van een eigen stempel (#749).
//
// Een eigen stempel uit een afbeeldingsbestand werd bewaard als tijdelijke
// blob:-URL zonder bestandstype. Bij opslaan herkende de saver alleen JPEG en
// gaf al het andere als PNG aan pdf-lib: een GIF, BMP, SVG of WebP faalde
// daar stil en de stempel was na opnieuw openen weg. Hier: het bestandstype
// uit de extensie of de eerste bytes, en welke formaten pdf-lib zelf kan
// insluiten. Pure functies, zonder DOM.

const MIME = {
  png: 'image/png', jpg: 'image/jpeg', jpeg: 'image/jpeg', gif: 'image/gif',
  bmp: 'image/bmp', svg: 'image/svg+xml', webp: 'image/webp',
};

/** Het MIME-type uit de bestandsnaam, of '' als die onbekend is. */
export function mimeUitNaam(naam) {
  const ext = String(naam || '').split(/[\\/]/).pop().split('.').pop().toLowerCase();
  return MIME[ext] || '';
}

/** Het formaat aan de eerste bytes: 'png', 'jpeg', 'gif', 'bmp', 'webp', 'svg' of ''. */
export function formaatUitBytes(bytes) {
  const b = bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes || []);
  if (b.length >= 8 && b[0] === 0x89 && b[1] === 0x50 && b[2] === 0x4e && b[3] === 0x47) return 'png';
  if (b.length >= 3 && b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff) return 'jpeg';
  if (b.length >= 6 && b[0] === 0x47 && b[1] === 0x49 && b[2] === 0x46 && b[3] === 0x38) return 'gif';
  if (b.length >= 2 && b[0] === 0x42 && b[1] === 0x4d) return 'bmp';
  if (b.length >= 12 && b[0] === 0x52 && b[1] === 0x49 && b[2] === 0x46 && b[3] === 0x46
      && b[8] === 0x57 && b[9] === 0x45 && b[10] === 0x42 && b[11] === 0x50) return 'webp';
  // SVG: tekst met een <svg-element (eventueel na een XML-kop of commentaar).
  const kop = new TextDecoder().decode(b.subarray(0, Math.min(b.length, 1024))).toLowerCase();
  if (kop.includes('<svg')) return 'svg';
  return '';
}

/** Kan pdf-lib dit formaat zelf insluiten (embedPng/embedJpg)? */
export function isInsluitbaar(formaat) {
  return formaat === 'png' || formaat === 'jpeg';
}
