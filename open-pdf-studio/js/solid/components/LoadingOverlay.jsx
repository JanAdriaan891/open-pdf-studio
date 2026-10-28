import { Show, createSignal, createEffect, onMount, onCleanup } from 'solid-js';
import { visible, message, progress, cancelHandler } from '../stores/loadingStore.js';
import { useTranslation } from '../../i18n/useTranslation.js';

export default function LoadingOverlay() {
  const { t } = useTranslation('common');
  // Eén klik op Annuleren is genoeg: daarna blijft de knop uit tot de
  // volgende taak (het werk stopt pas na de lopende stap).
  const [geannuleerd, setGeannuleerd] = createSignal(false);
  createEffect(() => { if (!visible()) setGeannuleerd(false); });
  const annuleer = () => {
    if (geannuleerd() || !cancelHandler()) return;
    setGeannuleerd(true);
    cancelHandler()?.();
  };
  // Esc doet hetzelfde als Annuleren (#766), alleen als er iets te annuleren is.
  onMount(() => {
    const opToets = (e) => {
      if (e.key !== 'Escape' || !visible() || !cancelHandler()) return;
      e.preventDefault();
      e.stopPropagation();
      annuleer();
    };
    window.addEventListener('keydown', opToets, true);
    onCleanup(() => window.removeEventListener('keydown', opToets, true));
  });
  return (
    <div class="loading-overlay" classList={{ visible: visible() }}>
      <div class="loading-content">
        <Show when={progress() == null}>
          <div class="loading-spinner"></div>
        </Show>
        <div class="loading-text">{message()}</div>
        <Show when={progress() != null}>
          <div class="loading-progress" role="progressbar" aria-valuemin="0" aria-valuemax="100"
            aria-valuenow={Math.round((progress() || 0) * 100)}>
            <div class="loading-progress-fill" style={{ width: `${(progress() || 0) * 100}%` }}></div>
          </div>
        </Show>
        <Show when={cancelHandler()}>
          <button type="button" class="loading-cancel" disabled={geannuleerd()}
            onClick={annuleer}>
            {t('cancel')}
          </button>
        </Show>
      </div>
    </div>
  );
}
