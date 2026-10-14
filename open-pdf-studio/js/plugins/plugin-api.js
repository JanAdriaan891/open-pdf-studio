/**
 * Plugin API
 *
 * Creates the `api` object that is passed to plugin activate() functions.
 * This is the contract between the host app and plugins.
 */

import { registerAnnotationType, unregisterAnnotationType } from './annotation-type-registry.js';
import { registerToolPalette, unregisterToolPalette, getPalette } from './palette-registry.js';
import { registerPropertyPanel as _registerPropertyPanel, unregisterPropertyPanel as _unregisterPropertyPanel } from './property-panel-registry.js';
import {
  registerSelectionListener as _registerSelectionListener,
  unregisterSelectionListener as _unregisterSelectionListener,
} from './selection-listener-registry.js';
import { clearToolGroups, toolGroupIdsOf } from './tool-group-state.js';
import { setNativePanelHidden } from '../solid/stores/propertiesStore.js';
import { state, getActiveDocument, getPageRotation, getAnnotationBounds } from '../core/state.js';
import { setTool } from '../tools/manager.js';
import { createAnnotation } from '../annotations/factory.js';
import { redrawAnnotations } from '../annotations/rendering.js';
import { beginUndoTransaction, endUndoTransaction, recordAdd, recordModify, recordDelete } from '../core/undo-manager.js';
import { applyAnnotationBatch } from './annotation-batch.js';
import { getPageInfoForDocument, readPageContentForDocument, renderPageTileForDocument } from './page-access.js';
import { extractPageGeometry } from '../tools/pdf-snap-extractor.js';
import { schaalOpPunt } from '../annotations/schaal-op-punt.js';
import { getScaleFromRegion } from '../annotations/scale-region.js';
import * as systeemTypenRegistry from '../annotations/systeem-typen-registry.js';
import { systeemInstanceGeometrie } from '../annotations/systeem-geometrie-app.js';
import { openSysteemtypenEditor } from '../solid/stores/systeemtypenEditorStore.js';
import { createSystemTypeApi } from './system-type-api.js';
import { createRoot, createEffect } from 'solid-js';
import { createViewNavigation } from './view-navigation.js';
import { maakBijdrageScope } from './extension-contributions.js';
import { lintRegister } from './ribbon-tab-registry.js';

// Wat createViewNavigation van de app nodig heeft (#557). De modules voor
// selecteren en in beeld brengen worden vooraf geladen (`prepare`), zodat de
// laatste identiteitscontrole en de selectie zelf in één synchrone stap
// gebeuren: geen wachtmoment waarin een tabbladwissel ertussen kan komen.
function viewNavigationHost() {
  let m = null;
  return {
    documents: () => state.documents,
    activeDocument: () => getActiveDocument(),
    pageCount: doc => doc?.numPages || doc?.pdfDoc?.numPages || 0,
    async loadPageAnnotations(doc, pageNum) {
      const { ensureAnnotationsForPage } = await import('../pdf/loader.js');
      if (getActiveDocument() !== doc) return;
      await ensureAnnotationsForPage(pageNum, doc);
      const started = Date.now();
      while (doc._annotationPagesReady && !doc._annotationPagesReady.has(pageNum)) {
        if (getActiveDocument() !== doc || Date.now() - started > 30_000) return;
        await new Promise(resolve => setTimeout(resolve, 20));
      }
    },
    async goToPage(doc, pageNum) {
      // Twee-paginaweergave: staat de pagina al in de getoonde spread, dan
      // niet navigeren (goToPage zou dat als 'volgende spread' lezen).
      const anker = p => (p <= 1 ? 1 : (p % 2 === 0 ? p : p - 1));
      if (doc.facingSpread && anker(pageNum) === anker(doc.currentPage)) return;
      const { goToPage } = await import('../pdf/renderer.js');
      if (getActiveDocument() === doc) await goToPage(pageNum);
    },
    async prepare() {
      if (m) return;
      const [filters, model, panel, list] = await Promise.all([
        import('../annotations/view-filters.js'),
        import('../annotations/corrections/model.js'),
        import('../ui/panels/properties-panel.js'),
        import('../ui/panels/annotations-list.js'),
      ]);
      m = { filters, model, panel, list };
    },
    // Verborgen (niet getekend) of op een vergrendelde laag: een klik pakt
    // zo'n object ook niet.
    isHidden: (doc, ann) => !!m && m.filters.isAnnotationHiddenInView(ann),
    isLocked: (doc, ann) => !!m && !m.filters.isAnnotationHiddenInView(ann)
      && !m.filters.isAnnotationPickableInView(ann),
    // De gewone selectieroute, zoals een klik in de annotatielijst: een
    // vervanging (#508) blijft één selectie, het eigenschappenpaneel volgt en
    // meldt de selectie aan de plugin-listeners.
    select(doc, anns) {
      const leden = m.model.expandCorrectionGroups(doc.annotations, anns);
      const ouder = leden.length > 1 ? m.model.replaceParentOf(leden, doc.annotations) : null;
      doc.selectedAnnotation = ouder || anns[0];
      doc.selectedAnnotations = leden;
      redrawAnnotations();
      if (ouder) m.panel.showProperties(ouder);
      else if (leden.length > 1) m.panel.showMultiSelectionProperties();
      else m.panel.showProperties(anns[0]);
      m.list.updateAnnotationsList();
    },
    // De omhullende van de selectie in het midden van de weergave; even
    // wachten zoals de annotatielijst doet, tot de paginawissel staat.
    reveal(doc, anns) {
      const kaders = anns.map(a => getAnnotationBounds(a)).filter(Boolean);
      let doel = anns[0];
      if (kaders.length > 1) {
        const x = Math.min(...kaders.map(b => b.x)), y = Math.min(...kaders.map(b => b.y));
        doel = { type: 'box', page: anns[0].page, x, y,
          width: Math.max(...kaders.map(b => b.x + b.width)) - x,
          height: Math.max(...kaders.map(b => b.y + b.height)) - y };
      }
      setTimeout(() => { if (getActiveDocument() === doc) m.list.scrollToAnnotation(doel); }, 50);
    },
  };
}

export function createPluginApi(pluginId) {
  // System types (#567): registry, native tool, native editor and the
  // geometry of system instances as the host. See docs/plugin-systeemtypen.md
  // for the contract and the lifecycle.
  const systemTypes = createSystemTypeApi(pluginId, {
    ...systeemTypenRegistry,
    systeemInstanceGeometrie,
    setTool,
    openEditor: openSysteemtypenEditor,
  });
  // Bijdragescope (#550/#551): lint-tabbladen en opdrachten, opgeruimd in _cleanup.
  const scope = maakBijdrageScope(pluginId);
  const registeredTypes = [];
  const registeredPalettes = [];
  const registeredPanels = [];
  const registeredSelectionListeners = []; // [{typeName, fn}]
  const documentListeners = new Map();
  let viewNavigation = null;
  const navigation = () => (viewNavigation ??= createViewNavigation(viewNavigationHost()));
  let disposeDocumentEvents = null;
  // Verborg deze extensie het eigen eigenschappenpaneel? Alleen dan zet
  // _cleanup het terug (#550).
  let verbergtNativePaneel = false;

  function ensureDocumentEvents() {
    if (disposeDocumentEvents) return;
    let previous = null;
    createRoot(dispose => {
      disposeDocumentEvents = dispose;
      createEffect(() => {
        const doc = getActiveDocument();
        const documentId = doc?.id ?? null;
        const page = doc?.currentPage ?? null;
        const scale = doc ? JSON.stringify({
          documentScale: doc.measureScale,
          calibratedAnnotations: (doc.annotations || [])
            .filter(a => ['scaleRegion', 'scaleBar', 'viewport'].includes(a.type))
            .map(a => [a.id, a.page, a.x, a.y, a.width, a.height, a.scaleString, a.pixelsPerUnit, a.unit]),
        }) : null;
        const current = { documentId, page, scale };
        if (previous) {
          if (previous.documentId !== documentId) emit('documentChanged', { documentId });
          if (previous.documentId !== documentId || previous.page !== page) emit('pageChanged', { documentId, page });
          if (previous.documentId !== documentId || previous.scale !== scale) emit('scaleChanged', { documentId });
        }
        previous = current;
      });
    });
  }

  function emit(type, event) {
    for (const listener of documentListeners.get(type) || []) {
      try { listener(event); } catch (error) { console.warn(`[plugin] ${type} listener failed`, error); }
    }
  }

  return {
    pluginId,

    // --- Feature flags ---
    // Plugins can feature-detect optional fork capabilities, e.g.:
    //   if (api.features?.toolGroups === true) { ... }
    // Adding a flag here is the contract for opting plugins into a feature
    // without breaking older OPPS builds that lack it.
    features: {
      toolGroups: true,
      annotationBatch: true,
      pageAnalysis: true,
      pluginDocumentEvents: true,
      systemTypes: true,
      viewNavigation: true,
      ribbonTabs: true,
    },

    // --- Annotation type registration ---
    registerAnnotationType(typeName, handler) {
      // Na _cleanup gesloten: een late registratie blijft anders voorgoed staan (#550).
      scope.eisActief('annotationType', typeName);
      const prefixedName = typeName;
      registerAnnotationType(prefixedName, handler);
      registeredTypes.push(prefixedName);
    },

    unregisterAnnotationType(typeName) {
      // Alleen wat deze API zelf registreerde: een oude API (na herladen) haalt
      // zo nooit het type van de nieuwe versie weg (#550).
      const idx = registeredTypes.indexOf(typeName);
      if (idx < 0) return;
      unregisterAnnotationType(typeName);
      registeredTypes.splice(idx, 1);
    },

    // --- Tool palette registration ---
    registerToolPalette(descriptor) {
      scope.eisActief('palette', String(descriptor?.id));
      registerToolPalette(descriptor);
      registeredPalettes.push(descriptor.id);
    },

    unregisterToolPalette(id) {
      const idx = registeredPalettes.indexOf(id);
      if (idx < 0) return;
      unregisterToolPalette(id);
      registeredPalettes.splice(idx, 1);
    },

    // --- Property panel registration (custom edit-form for plugin annotations) ---
    registerPropertyPanel(typeName, renderFn) {
      scope.eisActief('propertyPanel', typeName);
      _registerPropertyPanel(typeName, renderFn);
      registeredPanels.push(typeName);
    },

    unregisterPropertyPanel(typeName) {
      const idx = registeredPanels.indexOf(typeName);
      if (idx < 0) return;
      _unregisterPropertyPanel(typeName);
      registeredPanels.splice(idx, 1);
    },

    // --- Selection listener (direct selection-event channel for plugin annotations) ---
    // Listener fires with `annotation` on select and `null` on deselect. Plugins
    // should compare by stable id (not ref) since OPPS may reload annotation refs.
    registerSelectionListener(typeName, fn) {
      scope.eisActief('selectionListener', typeName);
      _registerSelectionListener(typeName, fn);
      registeredSelectionListeners.push({ typeName, fn });
    },

    unregisterSelectionListener(typeName, fn) {
      const idx = registeredSelectionListeners.findIndex(e => e.typeName === typeName && e.fn === fn);
      if (idx < 0) return;
      _unregisterSelectionListener(typeName, fn);
      registeredSelectionListeners.splice(idx, 1);
    },

    // --- Native property-panel visibility ---
    // Plugin can hide OPPS' native eigenschappen-paneel during plugin-annotation
    // editing so all controls live in the plugin's own palette/UI.
    // Pass false to hide, true to restore. Caller is responsible for restoring on deselect.
    setNativePanelVisible(visible) {
      scope.eisActief('nativePanel', 'visibility');
      verbergtNativePaneel = !visible;
      setNativePanelHidden(!visible);
    },

    // --- Tool management ---
    setTool(toolName) {
      setTool(toolName);
    },

    setToolOverrides(overrides) {
      state.toolOverrides = overrides;
    },

    // --- State access (read-only helpers) ---
    // A detached copy: writing to it changes nothing. System types go through
    // the system type API below, which validates every change.
    getPreferences() {
      return JSON.parse(JSON.stringify(state.preferences));
    },

    getCurrentTool() {
      return state.currentTool;
    },

    getCurrentPage() {
      const doc = getActiveDocument();
      return doc ? doc.currentPage : 1;
    },

    /**
     * Returns the active document's annotation array (read-only snapshot).
     * Plugins use this for analytics-style widgets (counts, dashboards) that
     * need to inspect existing annotations without subscribing to every
     * mutation. Polling is expected — the returned array is the live store
     * reference, so plugins must not mutate it.
     *
     * Each annotation has a `page` field (1-indexed). When no document is
     * open, returns []. The activeDocument's `numPages` (page-count) can be
     * derived via `getPageCount()`.
     */
    getAnnotations() {
      const doc = getActiveDocument();
      return doc && Array.isArray(doc.annotations) ? doc.annotations : [];
    },

    /**
     * Returns the active document's total page-count (>= 1) or 0 if no
     * document is open. Combined with `getAnnotations()` and `getCurrentPage()`
     * this gives plugins everything they need for per-page analytics.
     */
    getPageCount() {
      const doc = getActiveDocument();
      if (!doc) return 0;
      // Prefer numPages (canonical), fallback to pdfDoc.numPages, otherwise 0.
      if (typeof doc.numPages === 'number' && doc.numPages > 0) return doc.numPages;
      const pdfDoc = doc.pdfDoc;
      if (pdfDoc && typeof pdfDoc.numPages === 'number' && pdfDoc.numPages > 0) {
        return pdfDoc.numPages;
      }
      return 0;
    },

    // --- Annotation helpers ---
    createAnnotation(props) {
      return createAnnotation(props);
    },

    getDocumentInfo() {
      const doc = getActiveDocument();
      return doc ? { id: doc.id, pageCount: doc.numPages || doc.pdfDoc?.numPages || 0, currentPage: doc.currentPage,
        name: doc.fileName || null } : null;
    },

    getPageInfo(pageNum, options = {}) {
      const doc = getActiveDocument();
      return getPageInfoForDocument(doc, pageNum, {
        ...options, rotation: getPageRotation(pageNum), isCurrent: candidate => getActiveDocument() === candidate,
      });
    },

    getScaleAt(pageNum, x, y) {
      const doc = getActiveDocument();
      if (!doc || !Number.isInteger(pageNum) || pageNum < 1 || pageNum > (doc.numPages || doc.pdfDoc?.numPages || 0) ||
          !Number.isFinite(x) || !Number.isFinite(y)) return null;
      const scale = getScaleFromRegion(pageNum, x, y) || schaalOpPunt(doc, pageNum, x, y);
      return scale && Number.isFinite(scale.pixelsPerUnit) && scale.pixelsPerUnit > 0 ? { ...scale } : null;
    },

    readPageContent(pageNum, options = {}) {
      const doc = getActiveDocument();
      return readPageContentForDocument(doc, pageNum, {
        ...options, rotation: getPageRotation(pageNum), isCurrent: candidate => getActiveDocument() === candidate,
        extractVectors: (page, request) => extractPageGeometry(page, request),
      });
    },

    renderPageTile(pageNum, rect, options = {}) {
      const doc = getActiveDocument();
      return renderPageTileForDocument(doc, pageNum, rect, {
        ...options, rotation: getPageRotation(pageNum), isCurrent: candidate => getActiveDocument() === candidate,
      });
    },

    onDocumentEvent(type, listener) {
      if (!['documentChanged', 'pageChanged', 'scaleChanged'].includes(type) || typeof listener !== 'function') {
        throw new TypeError('Unsupported document event or listener');
      }
      scope.eisActief('documentEvent', type);
      let listeners = documentListeners.get(type);
      if (!listeners) { listeners = new Set(); documentListeners.set(type, listeners); }
      listeners.add(listener);
      ensureDocumentEvents();
      return () => listeners.delete(listener);
    },

    async waitForPageAnnotations(pageNum, options = {}) {
      const doc = getActiveDocument();
      const pageCount = doc?.numPages || doc?.pdfDoc?.numPages || 0;
      if (!Number.isInteger(pageNum) || pageNum < 1 || pageNum > pageCount) throw new RangeError('Invalid document page');
      const checkActive = () => {
        if (options.signal?.aborted || getActiveDocument() !== doc) {
          throw new DOMException('Page annotation load aborted', 'AbortError');
        }
      };
      checkActive();
      const { ensureAnnotationsForPage } = await import('../pdf/loader.js');
      checkActive();
      await ensureAnnotationsForPage(pageNum, doc);
      const started = Date.now();
      while (!doc._annotationPagesReady?.has(pageNum)) {
        checkActive();
        if (Date.now() - started > 30_000) throw new Error('Timed out waiting for page annotations');
        await new Promise(resolve => setTimeout(resolve, 20));
      }
      checkActive();
      return doc.annotations.filter(annotation => annotation.page === pageNum)
        .map(annotation => JSON.parse(JSON.stringify(annotation)));
    },

    /** Apply create/update/delete operations atomically with one undo step. */
    applyAnnotationBatch(operations) {
      return applyAnnotationBatch(getActiveDocument(), operations, {
        createAnnotation, beginUndoTransaction, endUndoTransaction,
        recordAdd, recordModify, recordDelete, redraw: redrawAnnotations,
      });
    },

    redrawAnnotations() {
      redrawAnnotations();
    },

    // --- System types (#567) ---
    // Read detached snapshots, register and update types owned by this
    // plugin ('ext:<pluginId>#<key>'), pick a type for the native tool, open
    // the native editor, listen to confirmed changes and read the geometry of
    // a system instance in the active document.
    listSystemTypes: systemTypes.listSystemTypes,
    getSystemType: systemTypes.getSystemType,
    systemTypeId: systemTypes.systemTypeId,
    registerSystemType: systemTypes.registerSystemType,
    updateSystemType: systemTypes.updateSystemType,
    selectSystemTypeForTool: systemTypes.selectSystemTypeForTool,
    openSystemTypeEditor: systemTypes.openSystemTypeEditor,
    onSystemTypesChanged: systemTypes.onSystemTypesChanged,
    getSystemInstanceGeometry: systemTypes.getSystemInstanceGeometry,

    // --- View navigation and selection (#557) ---
    // Document-scoped: pass the id from getDocumentInfo(). Each call resolves
    // to { ok: true, ... } or { ok: false, code, message }; the identity of
    // the document is checked again after every wait, so a tab switch or
    // close while a call is pending never selects in another document. A
    // newer call from the same plugin supersedes an older pending one.
    navigateToPage(request) {
      return navigation().navigateToPage(request);
    },

    selectAnnotations(request) {
      return navigation().selectAnnotations(request);
    },

    focusAnnotation(request) {
      return navigation().focusAnnotation(request);
    },

    // --- Linttabbladen (#551): alleen data, de host tekent; zie ribbon-tab-registry.js ---
    registerRibbonTab(descriptor) {
      return lintRegister.registreer(scope, descriptor);
    },

    unregisterRibbonTab(id) {
      return lintRegister.afmelden(scope, id);
    },

    /** Overzicht van wat deze extensie heeft geregistreerd (app_list_extensions). */
    _bijdragenOverzicht() {
      return {
        ribbonTabs: lintRegister.vanExtensie(pluginId),
        commands: scope.lijst().filter((b) => b.soort === 'command').length,
        annotationTypes: [...registeredTypes],
        palettes: [...registeredPalettes],
        propertyPanels: [...registeredPanels],
      };
    },

    // --- Cleanup (called by plugin-manager on deactivate) ---
    _cleanup() {
      const waarschuwingen = scope.ruimOp();
      // De gereedschapsgroepen van de eigen paletten, vóór die verdwijnen.
      const eigenGroepen = toolGroupIdsOf(registeredPalettes.map(id => getPalette(id)));
      registeredTypes.forEach(t => unregisterAnnotationType(t));
      registeredPalettes.forEach(id => unregisterToolPalette(id));
      registeredPanels.forEach(t => _unregisterPropertyPanel(t));
      registeredSelectionListeners.forEach(({ typeName, fn }) => _unregisterSelectionListener(typeName, fn));
      // Het eigenschappenpaneel en de gereedschapsgroepen per extensie
      // herstellen, niet globaal: andere extensies houden hun toestand (#550).
      if (verbergtNativePaneel) setNativePanelHidden(false);
      verbergtNativePaneel = false;
      clearToolGroups(eigenGroepen);
      registeredTypes.length = 0;
      registeredPalettes.length = 0;
      registeredPanels.length = 0;
      registeredSelectionListeners.length = 0;
      disposeDocumentEvents?.();
      disposeDocumentEvents = null;
      documentListeners.clear();
      // Only runtime state: stored system types are never removed here, so a
      // document that references them keeps working.
      systemTypes.dispose();
      return waarschuwingen;
    }
  };
}
