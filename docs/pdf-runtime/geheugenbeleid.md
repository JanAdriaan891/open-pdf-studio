# Geheugenbeleid voor de huidige Tauri-app

De schermrenderer gebruikt één controle vóór de bitmapallocatie, gedeeld door
PDFium-sidecar en in-process fallback. `dimensions` controleert eindige positieve
geometrie, afronding en een door de aanroeper opgegeven RGBA-bytebudget. Het
schermbudget is gelijk aan de bestaande workerpayload: 64 MiB min 32 headerbytes.
Een afgewezen render levert `PDF_OUTPUT_LIMIT` of `PDF_INVALID_GEOMETRY`, geen
lege bitmap. Regio's worden vóór het openen van de pagina gecontroleerd.

Dit begrenst **niet** het totale procesgeheugen. PDFium kan al tijdens het openen
van een pagina veel geheugen gebruiken. Het overzetten/converteren van pixels
kost bovendien extra buffers. De bestaande workerpool, cache-evictie en
inactiviteitstrimming blijven nodig.

| Pad | Bestaande grens / nieuwe controle | Niet afdwingbaar via huidige adapter |
| --- | --- | --- |
| PDFium-worker | SHM-payload; gedeelde geometriecontrole | Decodebudget per stream; onderbreken van een lopende native decoder |
| PDFium in-process | Dezelfde schermbitmapgrens als de worker | Totale native allocatie en decodertijd |
| PDF.js | Browser/worker en eigen canvasbeleid | Apart budget voor xref-, object- en fallback-decoders via publieke API |
| MuPDF WASM | WASM-geheugen en bestaande rendererfouten | Per-stream-budget via huidige JS-adapter |
| Eigen Rust-renderer | Eigen caches en implementatie | Nog geen uniforme decodergrens; geen garantie afgeleid van PDFiumbeleid |

Er is geen nieuwe limiet op PDF-bestandsgrootte. Een klein bestand kan een grote
uitgepakte stream bevatten; inputbytes begrenzen is geen decodebudget. Het
blind overnemen van een 512 MiB bestandslimiet zou grote bouwtekeningen breken.

## Streaming en resterende evaluatie (#676)

De huidige PDFium-adapter geeft een paginahandle aan de renderer. De applicatie
kan de interne contentdecoder niet vervangen door een streaming reader zonder
backendwerk. PDF.js-workertransport is evenmin bewijs dat de hele parser een
begrensd streamingpad gebruikt. Een nieuwe backend moet expliciet aantonen wat
er gebeurt met xref/objectstreams, herstel, geneste resources, misvormde en sterk
gecomprimeerde input. Een uitgeput budget mag geen geslaagde halve pagina worden.

De gedeelde Rust-tests dekken grenswaarden zonder enorme allocaties. Een
representatieve corpusmeting blijft vereist vóór een decoderwijziging: registreer
backendversie, bestandshash, piek-RSS van app én workers, eerste-paginatijd,
volledige rendertijd en annuleringslatentie. Deze wijziging claimt geen gemeten
snelheidswinst of volledige oplossing voor parsergeheugen. #676 blijft open voor
die backend- en corpusevaluatie.
