/** About: product story, features, privacy, limitations and credits. */
import { APP_VERSION } from './config.js';
import { t } from './i18n.js';
import { applyIcons } from './ui.js';
import { escapeHtml } from './utils.js';

const FEATURES = [
  ['qr-code', 'about.featureGenerate', 'about.featureGenerateDesc'],
  ['palette', 'about.featureDesign', 'about.featureDesignDesc'],
  ['layers', 'about.featureBatch', 'about.featureBatchDesc'],
  ['scan-line', 'about.featureScan', 'about.featureScanDesc'],
  ['history', 'about.featureLibrary', 'about.featureLibraryDesc'],
  ['shield-check', 'about.featurePrivacy', 'about.featurePrivacyDesc']
];

const LIMITATIONS = [
  ['hard-drive', 'about.limitations.local'],
  ['camera', 'about.limitations.camera'],
  ['scan-line', 'about.limitations.barcode'],
  ['layers', 'about.limitations.batch'],
  ['wifi', 'about.limitations.wifi'],
  ['history', 'about.limitations.history'],
  ['cloud-off', 'about.limitations.pwa'],
  ['image', 'about.limitations.svg']
];

const CREDITS = [
  ['qr-code', 'about.credits.qr'],
  ['scan-line', 'about.credits.jsqr'],
  ['folder-archive', 'about.credits.jszip'],
  ['file-spreadsheet', 'about.credits.papaparse'],
  ['sparkles', 'about.credits.lucide']
];

const SHORTCUTS = [
  ['Ctrl / ⌘ + K', 'about.shortcuts.search'],
  ['Ctrl / ⌘ + S', 'about.shortcuts.save'],
  ['Ctrl / ⌘ + Shift + L', 'about.shortcuts.language'],
  ['Esc', 'about.shortcuts.escape']
];

function featureCard(icon, titleKey, descKey) {
  return `<article class="feature-card">
    <span class="feature-icon"><i class="icon" data-lucide="${escapeHtml(icon)}"></i></span>
    <div>
      <h3>${escapeHtml(t(titleKey))}</h3>
      <p>${escapeHtml(t(descKey))}</p>
    </div>
  </article>`;
}

export default function aboutView(view, ctx) {
  view.innerHTML = `<div class="about-view view-enter">
    <div class="page-intro">
      <div>
        <span class="eyebrow"><i class="icon" data-lucide="circle-help"></i>${escapeHtml(t('about.kicker'))}</span>
        <h2>${escapeHtml(t('about.title'))}</h2>
        <p>${escapeHtml(t('about.subtitle'))}</p>
      </div>
      <span class="badge badge-accent about-version">${escapeHtml(t('about.version', { version: APP_VERSION }))}</span>
    </div>

    <div class="about-grid">
      <div class="about-column">
        <section class="card about-hero">
          <div class="about-hero-mark" aria-hidden="true">
            <img src="./assets/icons/logo.svg" alt="" width="58" height="58">
          </div>
          <div class="about-hero-copy">
            <h3>QR Studio</h3>
            <p>${escapeHtml(t('about.built'))}</p>
            <div class="chip-row">
              <span class="badge badge-neutral">HTML</span>
              <span class="badge badge-neutral">CSS</span>
              <span class="badge badge-neutral">JavaScript</span>
              <span class="badge badge-success"><i class="icon" data-lucide="cloud-off"></i>${escapeHtml(t('common.offline'))}</span>
            </div>
          </div>
        </section>

        <section class="card">
          <div class="card-header">
            <div>
              <h3 class="card-title">${escapeHtml(t('about.featuresTitle'))}</h3>
              <p class="card-subtitle">${escapeHtml(t('about.subtitle'))}</p>
            </div>
          </div>
          <div class="card-body">
            <div class="feature-grid">${FEATURES.map(([icon, title, desc]) => featureCard(icon, title, desc)).join('')}</div>
          </div>
        </section>

        <section class="card">
          <div class="card-header">
            <div>
              <h3 class="card-title">${escapeHtml(t('about.privacyTitle'))}</h3>
              <p class="card-subtitle">${escapeHtml(t('about.featurePrivacy'))}</p>
            </div>
            <span class="stat-icon"><i class="icon" data-lucide="lock"></i></span>
          </div>
          <div class="card-body stack">
            <p class="about-paragraph">${escapeHtml(t('about.privacyBody'))}</p>
            <div class="banner banner-success">
              <i class="icon" data-lucide="shield-check"></i>
              <div>${escapeHtml(t('common.localOnly'))}</div>
            </div>
          </div>
        </section>

        <section class="card">
          <div class="card-header">
            <div>
              <h3 class="card-title">${escapeHtml(t('about.limitationsTitle'))}</h3>
              <p class="card-subtitle">${escapeHtml(t('about.noWarranty'))}</p>
            </div>
            <span class="stat-icon"><i class="icon" data-lucide="alert-triangle"></i></span>
          </div>
          <div class="card-body">
            <ul class="about-list limitations-list">
              ${LIMITATIONS.map(([icon, key]) => `<li>
                <span class="about-list-icon"><i class="icon" data-lucide="${escapeHtml(icon)}"></i></span>
                <span>${escapeHtml(t(key))}</span>
              </li>`).join('')}
            </ul>
          </div>
        </section>
      </div>

      <aside class="about-column">
        <section class="card">
          <div class="card-header">
            <div>
              <h3 class="card-title">${escapeHtml(t('about.creditsTitle'))}</h3>
              <p class="card-subtitle">${escapeHtml(t('about.creditsBody'))}</p>
            </div>
            <span class="stat-icon"><i class="icon" data-lucide="sparkles"></i></span>
          </div>
          <div class="card-body stack">
            <ul class="about-list credits-list">
              ${CREDITS.map(([icon, key]) => `<li>
                <span class="about-list-icon"><i class="icon" data-lucide="${escapeHtml(icon)}"></i></span>
                <span>${escapeHtml(t(key))}</span>
              </li>`).join('')}
            </ul>
            <p class="note">${escapeHtml(t('about.license'))}</p>
          </div>
        </section>

        <section class="card">
          <div class="card-header">
            <div>
              <h3 class="card-title">${escapeHtml(t('about.shortcutsTitle'))}</h3>
            </div>
            <span class="stat-icon"><i class="icon" data-lucide="mouse-pointer-click"></i></span>
          </div>
          <div class="card-body">
            <ul class="shortcut-list">
              ${SHORTCUTS.map(([keys, key]) => `<li>
                <kbd class="shortcut-keys">${escapeHtml(keys)}</kbd>
                <span>${escapeHtml(t(key))}</span>
              </li>`).join('')}
            </ul>
          </div>
        </section>

        <section class="card">
          <div class="card-header">
            <div>
              <h3 class="card-title">${escapeHtml(t('about.offlineTitle'))}</h3>
              <p class="card-subtitle">${escapeHtml(t('common.installApp'))}</p>
            </div>
            <span class="stat-icon"><i class="icon" data-lucide="cloud-off"></i></span>
          </div>
          <div class="card-body stack">
            <p class="about-paragraph">${escapeHtml(t('about.offlineBody'))}</p>
            <button type="button" class="btn btn-secondary btn-block" data-about-install>
              <i class="icon" data-lucide="download"></i>
              <span>${escapeHtml(t('common.installApp'))}</span>
            </button>
          </div>
        </section>

        <div class="about-signoff">
          <span><i class="icon" data-lucide="qr-code"></i>${escapeHtml(t('about.made'))}</span>
          <span class="muted">${escapeHtml(t('about.version', { version: APP_VERSION }))}</span>
        </div>
      </aside>
    </div>
  </div>`;

  applyIcons(view);

  const onInstall = (event) => {
    if (!event.target.closest('[data-about-install]')) return;
    const install = document.getElementById('install-btn');
    if (install && !install.hidden) install.click();
    else ctx.navigate('settings');
  };

  view.addEventListener('click', onInstall);
  return () => view.removeEventListener('click', onInstall);
}
