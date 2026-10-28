import { For, createMemo } from 'solid-js';
import Dialog from '../Dialog.jsx';
import { closeDialog } from '../../stores/dialogStore.js';
import { useTranslation } from '../../../i18n/useTranslation.js';
import { state } from '../../../core/state.js';
import { showPreferencesDialog } from '../../../core/preferences.js';
import { sneltoetsOpdrachten } from '../../../tools/keyboard-handlers.js';
import { CATEGORIEEN } from '../../../tools/sneltoetsen/opdrachten.js';
import { effectief, schoonEigen } from '../../../tools/sneltoetsen/sneltoets-model.js';

// De sneltoetsenlijst (F1). Toont de toetsen die nu gelden, ook de eigen
// toetsen uit Voorkeuren > Sneltoetsen (#714); de lijst komt uit hetzelfde
// opdrachtenregister als de toetsafhandeling, dus ze loopt nooit achter.
export default function ShortcutsDialog() {
  const close = () => closeDialog('shortcuts');
  const { t } = useTranslation('preferences');
  const { t: tCommon } = useTranslation('common');

  const groepen = createMemo(() => {
    const opdrachten = sneltoetsOpdrachten();
    const toetsen = effectief(opdrachten, schoonEigen(state.preferences?.keyboardShortcuts));
    return CATEGORIEEN.map((categorie) => ({
      categorie,
      rijen: opdrachten
        .filter((o) => o.categorie === categorie && (toetsen.get(o.id) || []).length > 0)
        .map((o) => ({ naam: t(`shortcuts.commands.${o.id}`, o.naam), toetsen: toetsen.get(o.id) })),
    })).filter((g) => g.rijen.length > 0);
  });
  // Twee kolommen, ongeveer even lang.
  const kolommen = createMemo(() => {
    const g = groepen();
    const totaal = g.reduce((n, x) => n + x.rijen.length + 2, 0);
    const links = [];
    let n = 0;
    let i = 0;
    while (i < g.length && n < totaal / 2) { n += g[i].rijen.length + 2; links.push(g[i]); i += 1; }
    return [links, g.slice(i)];
  });

  const aanpassen = () => { close(); showPreferencesDialog('shortcuts'); };
  const footer = (
    <>
      <button class="pref-btn pref-btn-secondary" onClick={aanpassen}>{t('shortcuts.customize', 'Customize…')}</button>
      <div class="pref-footer-right">
        <button class="pref-btn pref-btn-primary" onClick={close}>{tCommon('close', 'Close')}</button>
      </div>
    </>
  );

  return (
    <Dialog
      title={t('shortcuts.title', 'Keyboard Shortcuts')}
      dialogClass="shortcuts-dialog"
      footerClass="preferences-footer"
      onClose={close}
      footer={footer}
    >
      <div class="shortcuts-grid">
        <For each={kolommen()}>
          {(kolom) => (
            <div class="shortcuts-column">
              <For each={kolom}>
                {(groep) => (
                  <div class="shortcuts-category">
                    <h3>{t(`shortcuts.categories.${groep.categorie}`, groep.categorie)}</h3>
                    <For each={groep.rijen}>
                      {(rij) => (
                        <div class="shortcuts-row">
                          <span class="shortcuts-action">{rij.naam}</span>
                          <span class="shortcuts-keys">
                            <For each={rij.toetsen}>
                              {(combinatie, i) => (
                                <>
                                  {i() > 0 ? <span class="shortcuts-or">/</span> : null}
                                  <For each={combinatie.split('+')}>{(toets) => <kbd>{toets}</kbd>}</For>
                                </>
                              )}
                            </For>
                          </span>
                        </div>
                      )}
                    </For>
                  </div>
                )}
              </For>
            </div>
          )}
        </For>
      </div>
    </Dialog>
  );
}
