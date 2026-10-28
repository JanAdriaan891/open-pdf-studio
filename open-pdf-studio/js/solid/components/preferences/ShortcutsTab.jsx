import { createSignal, createMemo, For, Show, onCleanup } from 'solid-js';
import { useTranslation } from '../../../i18n/useTranslation.js';
import { sneltoetsOpdrachten } from '../../../tools/keyboard-handlers.js';
import { CATEGORIEEN } from '../../../tools/sneltoetsen/opdrachten.js';
import { combinatieVan, isToegestaan } from '../../../tools/sneltoetsen/toets-combinatie.js';
import {
  effectief, opdrachtMet, wijsToe, haalWeg, herstel, exporteer, importeer, schoonEigen,
} from '../../../tools/sneltoetsen/sneltoets-model.js';
import { saveFileDialog, writeBinaryFile, openFileDialog, readBinaryFile } from '../../../core/platform.js';

// Voorkeuren > Sneltoetsen (#714). Werkt op de signaal-kopie van de
// voorkeuren (prefs.keyboardShortcuts); Opslaan in het voorkeurenvenster zet
// ze in state.preferences, en de verdeler gebruikt ze dan meteen.
export default function ShortcutsTab(props) {
  const { t } = useTranslation('preferences');
  const [eigen, setEigen] = props.prefs.keyboardShortcuts;
  const [zoek, setZoek] = createSignal('');
  // Opnemen: { id } terwijl we op een toets wachten; { id, combinatie, bezet } bij een conflict.
  const [opname, setOpname] = createSignal(null);
  const [melding, setMelding] = createSignal('');

  const opdrachten = sneltoetsOpdrachten();
  const naam = (o) => t(`shortcuts.commands.${o.id}`, o.naam);
  const categorieNaam = (c) => t(`shortcuts.categories.${c}`, c);
  const huidig = createMemo(() => effectief(opdrachten, schoonEigen(eigen())));
  const gewijzigd = (id) => Object.prototype.hasOwnProperty.call(eigen() || {}, id);

  const zichtbaar = createMemo(() => {
    const z = zoek().trim().toLowerCase();
    return CATEGORIEEN.map((categorie) => ({
      categorie,
      rijen: opdrachten.filter((o) => o.categorie === categorie && (!z
        || naam(o).toLowerCase().includes(z)
        || o.naam.toLowerCase().includes(z)
        || (huidig().get(o.id) || []).some((c) => c.toLowerCase().includes(z)))),
    })).filter((g) => g.rijen.length > 0);
  });

  function zet(nieuw) { setEigen(nieuw); setMelding(''); }

  // Opnemen van de volgende toetscombinatie. Capture op window, zodat geen
  // andere sneltoets (of het sluiten van de dialoog met Esc) hem eerst pakt.
  function opToets(e) {
    const o = opname();
    if (!o || o.bezet) return;
    e.preventDefault();
    e.stopImmediatePropagation();
    if (e.key === 'Escape') { stopOpname(); return; }
    const combinatie = combinatieVan(e);
    if (!combinatie) return; // alleen een modificator: blijven wachten
    if (!isToegestaan(combinatie)) { setMelding(t('shortcuts.notAllowed', { key: combinatie, defaultValue: '{{key}} cannot be used as a shortcut.' })); return; }
    const bezet = opdrachtMet(combinatie, opdrachten, schoonEigen(eigen()), { behalve: o.id });
    if (bezet) { setOpname({ ...o, combinatie, bezet }); return; }
    zet(wijsToe(opdrachten, schoonEigen(eigen()), o.id, combinatie));
    stopOpname();
  }
  function startOpname(id) {
    stopOpname();
    setMelding('');
    setOpname({ id });
    window.addEventListener('keydown', opToets, true);
  }
  function stopOpname() {
    window.removeEventListener('keydown', opToets, true);
    setOpname(null);
  }
  onCleanup(stopOpname);

  function wijsOpnieuwToe() {
    const o = opname();
    if (o?.bezet) zet(wijsToe(opdrachten, schoonEigen(eigen()), o.id, o.combinatie));
    stopOpname();
  }

  async function exporteerBestand() {
    try {
      const pad = await saveFileDialog('open-pdf-studio-shortcuts.json', [{ name: 'JSON', extensions: ['json'] }]);
      if (!pad) return;
      await writeBinaryFile(pad, new TextEncoder().encode(exporteer(eigen())));
      setMelding(t('shortcuts.exported', 'Shortcuts exported.'));
    } catch (e) {
      setMelding(t('shortcuts.exportFailed', { error: e?.message || String(e), defaultValue: 'Export failed: {{error}}' }));
    }
  }
  async function importeerBestand() {
    try {
      const pad = await openFileDialog(['json']);
      if (!pad) return;
      const tekst = new TextDecoder().decode(await readBinaryFile(pad));
      zet(importeer(tekst));
      setMelding(t('shortcuts.imported', 'Shortcuts imported. Click Save to use them.'));
    } catch (e) {
      setMelding(t('shortcuts.importFailed', 'This file does not contain Open PDF Studio shortcuts.'));
    }
  }

  return (
    <div class="shortcuts-tab">
      <div class="pref-row shortcuts-toolbar">
        <input type="search" class="pref-input shortcuts-search" placeholder={t('shortcuts.search', 'Search command or key')}
          value={zoek()} onInput={(e) => setZoek(e.target.value)} />
        <button class="pref-btn pref-btn-secondary" onClick={() => zet({})}>{t('shortcuts.resetAll', 'Reset all')}</button>
        <button class="pref-btn pref-btn-secondary" onClick={importeerBestand}>{t('shortcuts.import', 'Import…')}</button>
        <button class="pref-btn pref-btn-secondary" onClick={exporteerBestand}>{t('shortcuts.export', 'Export…')}</button>
      </div>
      <Show when={melding()}>
        <div class="pref-row shortcuts-message">{melding()}</div>
      </Show>
      <div class="shortcuts-list">
        <For each={zichtbaar()}>
          {(groep) => (
            <fieldset class="pref-fieldset">
              <legend>{categorieNaam(groep.categorie)}</legend>
              <For each={groep.rijen}>
                {(o) => (
                  <div class="shortcuts-command" classList={{ changed: gewijzigd(o.id) }} data-command={o.id}>
                    <span class="shortcuts-command-name">{naam(o)}</span>
                    <span class="shortcuts-command-keys">
                      <For each={huidig().get(o.id) || []}>
                        {(c) => (
                          <span class="shortcuts-chip">
                            <kbd>{c}</kbd>
                            <button class="shortcuts-chip-remove" title={t('shortcuts.remove', 'Remove')}
                              onClick={() => zet(haalWeg(opdrachten, schoonEigen(eigen()), o.id, c))}>×</button>
                          </span>
                        )}
                      </For>
                      <Show when={opname()?.id === o.id && !opname()?.bezet}>
                        <span class="shortcuts-recording">{t('shortcuts.pressKeys', 'Press a key combination… (Esc cancels)')}</span>
                      </Show>
                    </span>
                    <span class="shortcuts-command-actions">
                      <button class="pref-btn pref-btn-secondary" onClick={() => startOpname(o.id)}>{t('shortcuts.add', 'Add')}</button>
                      <button class="pref-btn pref-btn-secondary" disabled={!gewijzigd(o.id)}
                        onClick={() => zet(herstel(opdrachten, schoonEigen(eigen()), o.id))}>{t('shortcuts.reset', 'Reset')}</button>
                    </span>
                    <Show when={opname()?.id === o.id && opname()?.bezet}>
                      <div class="shortcuts-conflict">
                        <span>{t('shortcuts.inUse', {
                          key: opname().combinatie,
                          command: naam(opdrachten.find((x) => x.id === opname().bezet) || { id: opname().bezet, naam: opname().bezet }),
                          defaultValue: '{{key}} is already used by "{{command}}".',
                        })}</span>
                        <button class="pref-btn pref-btn-primary" onClick={wijsOpnieuwToe}>{t('shortcuts.reassign', 'Reassign')}</button>
                        <button class="pref-btn pref-btn-secondary" onClick={stopOpname}>{t('shortcuts.cancel', 'Cancel')}</button>
                      </div>
                    </Show>
                  </div>
                )}
              </For>
            </fieldset>
          )}
        </For>
      </div>
    </div>
  );
}
