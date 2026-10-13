import { Show } from 'solid-js';
import { useTranslation, localizeNumber } from '../../../i18n/useTranslation.js';
import { openDialog } from '../../stores/dialogStore.js';
import { kalibratieVoor, zetKalibratie, wisKalibratie } from '../../../pdf/schermkalibratie.js';

export default function PageDisplayTab(props) {
  const { t } = useTranslation('preferences');
  const p = props.prefs;

  // Schermkalibratie voor Werkelijke grootte (#520), per schermschaal. De
  // wijziging gaat in het voorkeurensignaal; pas Opslaan legt hem vast.
  const dpr = () => window.devicePixelRatio || 1;
  const schaalProcent = () => Math.round(dpr() * 100);
  const huidig = () => kalibratieVoor(p.screenCalibration[0](), dpr());

  function kalibreer() {
    openDialog('screen-calibration', {
      pxPerInch: huidig(),
      dpr: dpr(),
      onApply: (pxPerInch) => p.screenCalibration[1](zetKalibratie(p.screenCalibration[0](), dpr(), pxPerInch)),
    });
  }

  function verwijder() {
    p.screenCalibration[1](wisKalibratie(p.screenCalibration[0](), dpr()));
  }

  return (
    <>
      <fieldset class="pref-fieldset">
        <legend>{t('pageDisplay.rendering')}</legend>
        <div class="pref-row pref-checkbox-row">
          <label class="pref-checkbox-label">
            <input type="checkbox" checked={p.thinLines[0]()} onChange={e => p.thinLines[1](e.target.checked)} />
            <span>{t('pageDisplay.thinLines')}</span>
          </label>
        </div>
        <div class="pref-row pref-checkbox-row">
          <label class="pref-checkbox-label">
            <input type="checkbox" checked={p.showScrollbars[0]()} onChange={e => p.showScrollbars[1](e.target.checked)} />
            <span>{t('pageDisplay.showScrollbars')}</span>
          </label>
        </div>
        <div class="pref-row pref-checkbox-row">
          <label class="pref-checkbox-label">
            <input type="checkbox" checked={p.progressiveRender[0]()} onChange={e => p.progressiveRender[1](e.target.checked)} />
            <span>{t('pageDisplay.progressiveRender')}</span>
          </label>
        </div>
      </fieldset>
      <fieldset class="pref-fieldset">
        <legend>{t('pageDisplay.actualSize')}</legend>
        <div class="pref-row">
          <span class="pref-status-text">
            <Show when={huidig() != null} fallback={t('pageDisplay.calibrationNone', { scale: schaalProcent() })}>
              {t('pageDisplay.calibrationActive', { scale: schaalProcent(), ppi: localizeNumber(huidig()) })}
            </Show>
          </span>
          <span class="pref-inline-buttons">
            <button class="pref-btn pref-btn-secondary" onClick={kalibreer}>{t('pageDisplay.calibrate')}</button>
            <button class="pref-btn pref-btn-secondary" disabled={huidig() == null} onClick={verwijder}>{t('pageDisplay.removeCalibration')}</button>
          </span>
        </div>
        <div class="pref-row">
          <span class="pref-hint">{t('pageDisplay.calibrationHint')}</span>
        </div>
      </fieldset>
      <fieldset class="pref-fieldset">
        <legend>{t('pageDisplay.panels')}</legend>
        <div class="pref-row pref-checkbox-row">
          <label class="pref-checkbox-label">
            <input type="checkbox" checked={p.propertiesPanelVisible[0]()} onChange={e => p.propertiesPanelVisible[1](e.target.checked)} />
            <span>{t('pageDisplay.showPropertiesPanel')}</span>
          </label>
        </div>
        <div class="pref-row pref-checkbox-row">
          <label class="pref-checkbox-label">
            <input type="checkbox" checked={p.toolPaletteVisible[0]()} onChange={e => p.toolPaletteVisible[1](e.target.checked)} />
            <span>{t('pageDisplay.showToolPalette')}</span>
          </label>
        </div>
      </fieldset>
    </>
  );
}
