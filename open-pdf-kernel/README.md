# open-pdf-kernel

De Rust-kernel van Open PDF Studio: fase 1 van de Rust-migratie (zie [`docs/rust-migratie-plan.md`](../docs/rust-migratie-plan.md) en issue #625).

De crate is een pure Rust-bibliotheek zonder Tauri-afhankelijkheid. De app praat er via dunne commands mee; een latere native UI roept haar direct aan.

## Modules

| Module | Inhoud |
|---|---|
| `model` | Annotatiemodel: verliesvrije spiegel van het JS-object (`js/types/annotation.ts`). Getypeerde velden voor tekenen en opslaan; al het andere blijft ongewijzigd in `extra`. |

## Testen

```bash
cargo test -p open-pdf-kernel
```

Op Windows bouw je buiten de OneDrive-map, bijvoorbeeld met `CARGO_TARGET_DIR=C:\opds-cargo-target-kernel`.
