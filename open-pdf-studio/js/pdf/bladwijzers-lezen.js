// Bladwijzers uit de outline van een pdf.js-document, als het model van het
// bladwijzerpaneel (doc.bookmarks). Geen imports uit de app: de lader, het
// samenvoegen en de unit-tests gebruiken dezelfde omzetting.

// Load bookmarks from PDF outline
export async function loadBookmarksFromPdf(pdfDoc) {
  if (!pdfDoc) return [];
  try {
    const outline = await pdfDoc.getOutline();
    if (!outline || outline.length === 0) return [];
    const bookmarks = [];
    let nextId = 1;
    async function processItems(items, parentId) {
      for (let i = 0; i < items.length; i++) {
        const item = items[i];
        const id = 'bm_' + (nextId++);
        let page = 1;
        let top = null;
        let left = null;

        // Resolve destination
        if (item.dest) {
          try {
            let dest = item.dest;
            if (typeof dest === 'string') {
              dest = await pdfDoc.getDestination(dest);
            }
            if (dest && Array.isArray(dest)) {
              const pageRef = dest[0];
              const pageIndex = await pdfDoc.getPageIndex(pageRef);
              page = pageIndex + 1;
              if (dest.length > 2) left = dest[2];
              if (dest.length > 3) top = dest[3];
            }
          } catch (e) {
            // Failed to resolve dest - use page 1
          }
        }

        const bm = {
          id,
          title: item.title || 'Untitled',
          page,
          top,
          left,
          zoom: null,
          parentId,
          expanded: true,
          bold: !!(item.bold),
          italic: !!(item.italic),
          color: item.color ? rgbArrayToHex(item.color) : null,
          sortOrder: i,
          fromPdf: true,
        };
        bookmarks.push(bm);

        if (item.items && item.items.length > 0) {
          await processItems(item.items, id);
        }
      }
    }
    await processItems(outline, null);
    return bookmarks;
  } catch (e) {
    console.warn('Failed to load bookmarks:', e);
    return [];
  }
}

function rgbArrayToHex(arr) {
  if (!arr || arr.length < 3) return null;
  const r = Math.round(arr[0] * 255);
  const g = Math.round(arr[1] * 255);
  const b = Math.round(arr[2] * 255);
  return '#' + [r, g, b].map(c => c.toString(16).padStart(2, '0')).join('');
}
