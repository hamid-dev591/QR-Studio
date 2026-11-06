/** Settings: appearance, generator defaults, local data, install and privacy. */
import { DEFAULT_STYLE, ERROR_LEVELS, EXPORT_SIZES } from './config.js';
import {
  clearFavorites, clearHistory, clearLocalData, clearScans, getFavorites,
  getHistory, getScans, getSettings, getStorageEstimate, getStorageMetrics,
  restoreFavorite, restoreHistory, saveSettings
} from './storage.js';
import { clearLogos, countLogos, pruneLogos } from './db.js';
import { getLanguage, setLanguage, t } from './i18n.js';
import { exportBackup, reviewBackup } from './backup.js';
import { applyTheme, getThemePreference } from './themes.js';
import {
  applyIcons, confirmDialog, setBusy, toast
} from './ui.js';
import {
  escapeHtml, formatBytes, formatNumber
} from './utils.js';

function themeCard(value, icon, labelKey, current) {
  return `<label class="choice-card">
    <input type="radio" name="theme-choice" value="${value}" ${current === value ? 'checked' : ''}>
    <span class="choice-inner">
      <i class="icon" data-lucide="${icon}"></i>
      <span class="choice-label">${escapeHtml(t(labelKey))}</span>
    </span>
  </label>`;
}

function languageCard(value, icon, labelKey, current) {
  return `<label class="choice-card">
    <input type="radio" name="language-choice" value="${value}" ${current === value ? 'checked' : ''}>
    <span class="choice-inner">
      <i class="icon" data-lucide="${icon}"></i>
      <span class="choice-label" ${value === 'ar' ? 'lang="ar"' : ''}>${escapeHtml(t(labelKey))}</span>
    </span>
  </label>`;
}

function actionRow({ title, desc, button, danger = false }) {
  return `<div class="setting-row">
    <div class="setting-row-text">
      <div class="setting-row-title">${escapeHtml(title)}</div>
      <div class="setting-row-desc">${escapeHtml(desc)}</div>
    </div>
    ${button}
  </div>`;
}

export default async function settingsView(view, ctx) {
  const lang = getLanguage();
  const settings = getSettings();
  const metrics = getStorageMetrics();
  const estimate = await getStorageEstimate();
  const pref = getThemePreference();
  const logoCount = await countLogos();
  const quota = estimate.quota > 0 ? `${formatBytes(estimate.usage)} / ${formatBytes(estimate.quota)}` : t('settings.data.unknown');

  view.innerHTML = `<div class="settings-grid view-enter">
    <div class="settings-column">
      <section class="card">
        <div class="card-header">
          <div>
            <h3 class="card-title">${escapeHtml(t('settings.appearance.title'))}</h3>
            <p class="card-subtitle">${escapeHtml(t('settings.appearance.desc'))}</p>
          </div>
        </div>
        <div class="card-body stack">
          <div class="field">
            <span class="field-label">${escapeHtml(t('settings.theme'))}</span>
            <div class="choice-grid">
              ${themeCard('light', 'sun', 'common.light', pref)}
              ${themeCard('dark', 'moon', 'common.dark', pref)}
              ${themeCard('system', 'monitor', 'common.system', pref)}
            </div>
            <p class="field-hint">${escapeHtml(t('settings.themeDesc'))}</p>
          </div>
          <div class="field">
            <span class="field-label">${escapeHtml(t('settings.language'))}</span>
            <div class="choice-grid is-two">
              ${languageCard('en', 'globe', 'common.english', getLanguage())}
              ${languageCard('ar', 'globe', 'common.arabic', getLanguage())}
            </div>
            <p class="field-hint">${escapeHtml(t('settings.languageDesc'))}</p>
          </div>
        </div>
      </section>

      <section class="card">
        <div class="card-header">
          <div>
            <h3 class="card-title">${escapeHtml(t('settings.defaults.title'))}</h3>
            <p class="card-subtitle">${escapeHtml(t('settings.defaults.desc'))}</p>
          </div>
        </div>
        <div class="card-body stack">
          <div class="field-grid">
            <div class="field">
              <label class="field-label" for="default-ecc">${escapeHtml(t('settings.defaults.ecc'))}</label>
              <div class="select-wrap">
                <select class="select" id="default-ecc" data-default-ecc>
                  ${ERROR_LEVELS.map((level) => `<option value="${level}" ${settings.generatorPrefs.errorCorrection === level ? 'selected' : ''}>${escapeHtml(t(`generator.ecc.${level}`))} (${level})</option>`).join('')}
                </select>
                <i class="icon" data-lucide="chevrons-up-down"></i>
              </div>
              <p class="field-hint">${escapeHtml(t('settings.defaults.eccDesc'))}</p>
            </div>
            <div class="field">
              <label class="field-label" for="default-size">${escapeHtml(t('settings.defaults.size'))}</label>
              <div class="select-wrap">
                <select class="select" id="default-size" data-default-size>
                  ${EXPORT_SIZES.map((size) => `<option value="${size}" ${settings.generatorPrefs.exportSize === size ? 'selected' : ''}>${formatNumber(size, lang)} × ${formatNumber(size, lang)}</option>`).join('')}
                </select>
                <i class="icon" data-lucide="chevrons-up-down"></i>
              </div>
              <p class="field-hint">${escapeHtml(t('settings.defaults.sizeDesc'))}</p>
            </div>
          </div>
          <div class="field">
            <div class="control-row">
              <span class="field-label">${escapeHtml(t('settings.defaults.margin'))}</span>
              <span class="range-value" data-margin-value>${formatNumber(settings.generatorPrefs.marginPercent, lang)}%</span>
            </div>
            <input type="range" min="0" max="10" step="1" value="${settings.generatorPrefs.marginPercent}" data-default-margin
              aria-label="${escapeHtml(t('settings.defaults.margin'))}">
            <p class="field-hint">${escapeHtml(t('settings.defaults.marginDesc'))}</p>
          </div>
          <div class="divider"></div>
          <div class="setting-row">
            <div class="setting-row-text">
              <div class="setting-row-title">${escapeHtml(t('settings.defaults.reset'))}</div>
              <div class="setting-row-desc">${escapeHtml(t('settings.defaults.resetDesc'))}</div>
            </div>
            <button type="button" class="btn btn-secondary btn-sm" data-reset-defaults>
              <i class="icon" data-lucide="rotate-ccw"></i>
              <span>${escapeHtml(t('common.reset'))}</span>
            </button>
          </div>
        </div>
      </section>

      <section class="card" id="data-settings">
        <div class="card-header">
          <div>
            <h3 class="card-title">${escapeHtml(t('settings.data.title'))}</h3>
            <p class="card-subtitle">${escapeHtml(t('settings.data.desc'))}</p>
          </div>
        </div>
        <div class="card-body stack">
          <dl class="kv-list">
            <div class="kv-row"><dt>${escapeHtml(t('settings.data.usage'))}</dt><dd>${escapeHtml(metrics.formatted)} · ${escapeHtml(t('settings.data.keys', { count: formatNumber(metrics.keys, lang) }))}</dd></div>
            <div class="kv-row"><dt>${escapeHtml(t('settings.data.quota'))}</dt><dd>${escapeHtml(quota)}</dd></div>
            <div class="kv-row"><dt>${escapeHtml(t('settings.data.history'))}</dt><dd>${formatNumber(metrics.history, lang)}</dd></div>
            <div class="kv-row"><dt>${escapeHtml(t('settings.data.favorites'))}</dt><dd>${formatNumber(metrics.favorites, lang)}</dd></div>
            <div class="kv-row"><dt>${escapeHtml(t('settings.data.scans'))}</dt><dd>${formatNumber(metrics.scans, lang)}</dd></div>
            <div class="kv-row"><dt>${escapeHtml(t('settings.data.generated'))}</dt><dd>${formatNumber(metrics.generated, lang)}</dd></div>
            <div class="kv-row"><dt>${escapeHtml(t('generator.preview.logo'))}</dt><dd>${formatNumber(logoCount, lang)}</dd></div>
          </dl>
          <div class="divider"></div>
          ${actionRow({
            title: t('settings.data.export'),
            desc: t('settings.data.exportDesc'),
            button: `<button type="button" class="btn btn-primary btn-sm" data-export-backup>
              <i class="icon" data-lucide="download"></i><span>${escapeHtml(t('settings.data.exportButton'))}</span>
            </button>`
          })}
          ${actionRow({
            title: t('settings.data.import'),
            desc: t('settings.data.importDesc'),
            button: `<button type="button" class="btn btn-secondary btn-sm" data-import-backup>
              <i class="icon" data-lucide="upload"></i><span>${escapeHtml(t('settings.data.importButton'))}</span>
            </button>`
          })}
          <input type="file" accept="application/json,.json" data-import-file hidden>
          <div class="divider"></div>
          ${actionRow({
            title: t('settings.data.clearHistory'),
            desc: t('settings.data.clearHistoryDesc'),
            button: `<button type="button" class="btn btn-secondary btn-sm" data-clear-section="history" ${metrics.history ? '' : 'disabled'}>
              <i class="icon" data-lucide="trash-2"></i><span>${escapeHtml(t('common.clear'))}</span>
            </button>`
          })}
          ${actionRow({
            title: t('settings.data.clearFavorites'),
            desc: t('settings.data.clearFavoritesDesc'),
            button: `<button type="button" class="btn btn-secondary btn-sm" data-clear-section="favorites" ${metrics.favorites ? '' : 'disabled'}>
              <i class="icon" data-lucide="trash-2"></i><span>${escapeHtml(t('common.clear'))}</span>
            </button>`
          })}
          ${actionRow({
            title: t('settings.data.clearScans'),
            desc: t('settings.data.clearScansDesc'),
            button: `<button type="button" class="btn btn-secondary btn-sm" data-clear-section="scans" ${metrics.scans ? '' : 'disabled'}>
              <i class="icon" data-lucide="trash-2"></i><span>${escapeHtml(t('common.clear'))}</span>
            </button>`
          })}
          ${actionRow({
            title: t('settings.data.prune'),
            desc: t('settings.data.pruneDesc'),
            button: `<button type="button" class="btn btn-secondary btn-sm" data-prune-logos>
              <i class="icon" data-lucide="sparkles"></i><span>${escapeHtml(t('common.clear'))}</span>
            </button>`
          })}
          <div class="divider"></div>
          <div class="banner banner-danger">
            <i class="icon" data-lucide="alert-triangle"></i>
            <div>
              <strong>${escapeHtml(t('settings.data.clearAll'))}</strong><br>
              ${escapeHtml(t('settings.data.clearAllDesc'))}
            </div>
            <button type="button" class="btn btn-danger btn-sm" data-clear-all>
              <i class="icon" data-lucide="trash-2"></i>
              <span>${escapeHtml(t('settings.data.clearAll'))}</span>
            </button>
          </div>
        </div>
      </section>
    </div>

    <aside class="settings-column">
      <section class="card">
        <div class="card-header">
          <div>
            <h3 class="card-title">${escapeHtml(t('settings.install.title'))}</h3>
            <p class="card-subtitle">${escapeHtml(t('settings.install.desc'))}</p>
          </div>
          <span class="stat-icon"><i class="icon" data-lucide="download"></i></span>
        </div>
        <div class="card-body stack">
          <button type="button" class="btn btn-primary btn-block" data-install>
            <i class="icon" data-lucide="download"></i>
            <span>${escapeHtml(t('settings.install.button'))}</span>
          </button>
          <p class="note">${escapeHtml(t('settings.install.desc'))}</p>
        </div>
      </section>

      <section class="card">
        <div class="card-header">
          <div>
            <h3 class="card-title">${escapeHtml(t('settings.offline.title'))}</h3>
            <p class="card-subtitle">${escapeHtml(t('settings.offline.desc'))}</p>
          </div>
          <span class="stat-icon"><i class="icon" data-lucide="cloud-off"></i></span>
        </div>
      </section>

      <section class="card">
        <div class="card-header">
          <div>
            <h3 class="card-title">${escapeHtml(t('settings.privacy.title'))}</h3>
            <p class="card-subtitle">${escapeHtml(t('settings.privacy.desc'))}</p>
          </div>
          <span class="stat-icon"><i class="icon" data-lucide="shield-check"></i></span>
        </div>
        <div class="card-body">
          <div class="banner banner-info">
            <i class="icon" data-lucide="lock"></i>
            <div>${escapeHtml(t('common.localOnly'))}</div>
          </div>
        </div>
      </section>

      <section class="card">
        <div class="card-header">
          <div>
            <h3 class="card-title">${escapeHtml(t('settings.about.title'))}</h3>
            <p class="card-subtitle">${escapeHtml(t('settings.about.desc'))}</p>
          </div>
        </div>
        <div class="card-body">
          <a class="btn btn-secondary btn-block" href="#/about">
            <i class="icon" data-lucide="circle-help"></i>
            <span>${escapeHtml(t('settings.about.link'))}</span>
          </a>
        </div>
      </section>
    </aside>
  </div>`;

  applyIcons(view);

  const importInput = view.querySelector('[data-import-file]');
  const importButton = view.querySelector('[data-import-backup]');

  const onThemeChange = (event) => {
    const input = event.target.closest('input[name="theme-choice"]');
    if (!input) return;
    applyTheme(input.value);
    saveSettings({ theme: input.value });
    toast(t('toast.settingsSaved'), { type: 'success', duration: 1600 });
  };

  const onLanguageChange = async (event) => {
    const input = event.target.closest('input[name="language-choice"]');
    if (!input || input.value === getLanguage()) return;
    try {
      // The shell re-renders the active view on `languagechange`.
      await setLanguage(input.value);
    } catch (error) {
      console.error('[settings] language switch failed', error);
      toast(t('errors.locale'), { type: 'error' });
    }
  };

  const saveDefaults = (patch) => {
    const current = getSettings().generatorPrefs;
    try {
      saveSettings({ generatorPrefs: { ...current, ...patch } });
      toast(t('toast.settingsSaved'), { type: 'success', duration: 1500 });
    } catch {
      toast(t('errors.saveFailed'), { type: 'error' });
    }
  };

  const onDefaultsChange = (event) => {
    const target = event.target;
    if (target.matches('[data-default-ecc]')) saveDefaults({ errorCorrection: target.value });
    else if (target.matches('[data-default-size]')) saveDefaults({ exportSize: Number(target.value) });
  };

  const margin = view.querySelector('[data-default-margin]');
  const marginValue = view.querySelector('[data-margin-value]');
  const onMarginInput = () => {
    if (marginValue) marginValue.textContent = `${formatNumber(margin.value, lang)}%`;
  };
  const onMarginChange = () => saveDefaults({ marginPercent: Number(margin.value) });
  margin?.addEventListener('input', onMarginInput);
  margin?.addEventListener('change', onMarginChange);

  const onResetDefaults = (event) => {
    if (!event.target.closest('[data-reset-defaults]')) return;
    try {
      saveSettings({ generatorPrefs: { ...DEFAULT_STYLE } });
      toast(t('settings.defaults.resetDone'), { type: 'success' });
      ctx.refresh();
    } catch {
      toast(t('errors.saveFailed'), { type: 'error' });
    }
  };

  const onExport = async (event) => {
    const button = event.target.closest('[data-export-backup]');
    if (!button) return;
    setBusy(button, true);
    try {
      await exportBackup();
      toast(t('settings.data.exportDone'), { type: 'success' });
    } catch (error) {
      console.error('[settings] export failed', error);
      toast(t(error?.code === 'TOO_LARGE' ? 'backup.tooLarge' : 'errors.saveFailed'), { type: 'error' });
    } finally {
      if (button.isConnected) setBusy(button, false);
    }
  };

  const onImportClick = (event) => {
    if (!event.target.closest('[data-import-backup]')) return;
    importInput?.click();
  };

  const onImportFile = async () => {
    const file = importInput?.files?.[0];
    if (!file) return;
    importInput.value = '';
    if (importButton) setBusy(importButton, true);
    try {
      const result = await reviewBackup(file);
      if (result?.imported) await ctx.refresh();
    } finally {
      if (importButton?.isConnected) setBusy(importButton, false);
    }
  };

  const clearSection = async (section) => {
    if (section === 'history') {
      const snapshot = getHistory();
      const confirmed = await confirmDialog({
        title: t('history.clearTitle'),
        message: t('history.clearMessage'),
        confirmLabel: t('history.clearAll'),
        cancelLabel: t('common.cancel'),
        danger: true,
        icon: 'trash-2',
        checkboxLabel: t('history.clearCheck')
      });
      if (!confirmed) return;
      clearHistory();
      toast(t('toast.cleared'), {
        type: 'success',
        actionLabel: t('common.undo'),
        duration: 8000,
        onAction: () => {
          for (let i = snapshot.length - 1; i >= 0; i -= 1) restoreHistory(snapshot[i], 0);
          toast(t('history.restored'), { type: 'success' });
          ctx.refresh();
        }
      });
    } else if (section === 'favorites') {
      const snapshot = getFavorites();
      const confirmed = await confirmDialog({
        title: t('favorites.clearTitle'),
        message: t('favorites.clearMessage'),
        confirmLabel: t('favorites.clearAll'),
        cancelLabel: t('common.cancel'),
        danger: true,
        icon: 'star',
        checkboxLabel: t('favorites.clearCheck')
      });
      if (!confirmed) return;
      clearFavorites();
      toast(t('toast.cleared'), {
        type: 'success',
        actionLabel: t('common.undo'),
        duration: 8000,
        onAction: () => {
          for (let i = snapshot.length - 1; i >= 0; i -= 1) restoreFavorite(snapshot[i], 0);
          toast(t('favorites.restored'), { type: 'success' });
          ctx.refresh();
        }
      });
    } else if (section === 'scans') {
      const confirmed = await confirmDialog({
        title: t('scanner.history.clearTitle'),
        message: t('scanner.history.clearMessage'),
        confirmLabel: t('scanner.history.clear'),
        cancelLabel: t('common.cancel'),
        danger: true,
        icon: 'scan-line'
      });
      if (!confirmed) return;
      clearScans();
      toast(t('scanner.history.cleared'), { type: 'success' });
    }
    ctx.refresh();
  };

  const onClearSection = (event) => {
    const button = event.target.closest('[data-clear-section]');
    if (!button) return;
    clearSection(button.getAttribute('data-clear-section'));
  };

  const onPrune = async (event) => {
    const button = event.target.closest('[data-prune-logos]');
    if (!button) return;
    setBusy(button, true);
    try {
      const before = await countLogos();
      const referenced = [...getHistory(), ...getFavorites()].map((record) => record.logoId).filter(Boolean);
      await pruneLogos(referenced);
      const removed = Math.max(0, before - (await countLogos()));
      if (removed > 0) toast(t('settings.data.pruneDone', { count: removed }), { type: 'success' });
      else toast(t('settings.data.pruneNone'), { type: 'info' });
      ctx.refresh();
    } catch (error) {
      console.error('[settings] logo cleanup failed', error);
      toast(t('errors.unknown'), { type: 'error' });
    } finally {
      if (button.isConnected) setBusy(button, false);
    }
  };

  const onClearAll = async (event) => {
    if (!event.target.closest('[data-clear-all]')) return;
    const confirmed = await confirmDialog({
      title: t('settings.data.clearAll'),
      message: t('settings.data.clearAllDesc'),
      confirmLabel: t('settings.data.clearAll'),
      cancelLabel: t('common.cancel'),
      danger: true,
      icon: 'alert-triangle',
      checkboxLabel: t('settings.data.clearAllCheck')
    });
    if (!confirmed) return;
    try {
      await clearLogos();
      clearLocalData();
      try {
        sessionStorage.removeItem('qs.edit.v1');
        sessionStorage.removeItem('qs.newqr.v1');
        sessionStorage.removeItem('qs.backup.safety.v1');
      } catch { /* ignore */ }
      toast(t('settings.data.cleared'), { type: 'success' });
      setTimeout(() => { location.reload(); }, 700);
    } catch (error) {
      console.error('[settings] clear failed', error);
      toast(t('errors.unknown'), { type: 'error' });
    }
  };

  const onInstall = (event) => {
    if (!event.target.closest('[data-install]')) return;
    const install = document.getElementById('install-btn');
    if (install) install.click();
    else toast(t('settings.install.unavailable'), { type: 'info', duration: 6000 });
  };

  view.addEventListener('change', onThemeChange);
  view.addEventListener('change', onLanguageChange);
  view.addEventListener('change', onDefaultsChange);
  view.addEventListener('change', onImportFile);
  view.addEventListener('click', onResetDefaults);
  view.addEventListener('click', onExport);
  view.addEventListener('click', onImportClick);
  view.addEventListener('click', onClearSection);
  view.addEventListener('click', onPrune);
  view.addEventListener('click', onClearAll);
  view.addEventListener('click', onInstall);

  return () => {
    view.removeEventListener('change', onThemeChange);
    view.removeEventListener('change', onLanguageChange);
    view.removeEventListener('change', onDefaultsChange);
    view.removeEventListener('change', onImportFile);
    view.removeEventListener('click', onResetDefaults);
    view.removeEventListener('click', onExport);
    view.removeEventListener('click', onImportClick);
    view.removeEventListener('click', onClearSection);
    view.removeEventListener('click', onPrune);
    view.removeEventListener('click', onClearAll);
    view.removeEventListener('click', onInstall);
    margin?.removeEventListener('input', onMarginInput);
    margin?.removeEventListener('change', onMarginChange);
  };
}
