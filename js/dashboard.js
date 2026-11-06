/** Dashboard: overview, quick actions, recent codes, activity and local storage. */
import { getLanguage, t } from './i18n.js';
import {
  getState, getStorageEstimate, getStorageMetrics
} from './storage.js';
import { applyIcons, emptyState } from './ui.js';
import { openRecordPreview, setNewType, typeIcon, typeLabel } from './records.js';
import { navigate } from './router.js';
import {
  escapeHtml, formatBytes, formatNumber, relativeTime, truncate
} from './utils.js';

const ACTIVITY_ICONS = {
  generate: 'qr-code',
  scan: 'scan-line',
  batch: 'layers',
  favorite: 'star',
  edit: 'pencil',
  delete: 'trash-2',
  clear: 'trash-2',
  generic: 'info'
};

const DASHBOARD_TYPES = [
  'url', 'text', 'wifi', 'email', 'phone', 'sms', 'vcard', 'location'
];

function activityText(entry) {
  const key = `activity.${entry.kind || 'generic'}`;
  let label = entry.label || '';
  if (label === 'history') label = t('nav.history');
  else if (label === 'favorites') label = t('nav.favorites');
  else label = truncate(label, 70);
  const values = {
    label: escapeHtml(label),
    count: escapeHtml(String(entry.count ?? ''))
  };
  return escapeHtml(t(key)).replace(/\{\{\s*(label|count)\s*\}\}/g, (match, name) => (
    `<strong>${values[name]}</strong>`
  ));
}

function statCard({ icon, label, value, meta }) {
  return `<div class="stat-card">
    <div class="stat-head">
      <span class="stat-label">${escapeHtml(label)}</span>
      <span class="stat-icon"><i class="icon" data-lucide="${icon}"></i></span>
    </div>
    <div class="stat-value">${escapeHtml(value)}</div>
    <div class="stat-meta">${escapeHtml(meta)}</div>
  </div>`;
}

export default async function dashboardView(view, ctx) {
  const lang = getLanguage();
  const state = getState();
  const metrics = getStorageMetrics();
  const recent = state.history.slice(0, 6);
  const activity = state.activity.slice(0, 7);
  const estimate = await getStorageEstimate();

  const quotaPercent = estimate.quota > 0
    ? Math.min(100, Math.round((estimate.usage / estimate.quota) * 1000) / 10)
    : null;

  const recentMarkup = recent.length
    ? `<div class="recent-list">${recent.map((record) => `
        <button type="button" class="recent-item" data-recent="${escapeHtml(record.id)}">
          <span class="recent-icon"><i class="icon" data-lucide="${typeIcon(record.type)}"></i></span>
          <span class="recent-body">
            <span class="recent-label">${escapeHtml(record.label)}</span>
            <span class="recent-meta">
              <span>${escapeHtml(typeLabel(record.type))}</span>
              <span aria-hidden="true">·</span>
              <span>${escapeHtml(t('common.bytes'))}: ${formatBytes(record.payload.length)}</span>
            </span>
          </span>
          <span class="recent-time">${escapeHtml(relativeTime(record.updatedAt || record.createdAt, lang))}</span>
          <i class="icon icon-directional" data-lucide="arrow-right"></i>
        </button>`).join('')}</div>`
    : emptyState({
      icon: 'qr-code',
      title: t('dashboard.recentEmpty'),
      description: t('dashboard.recentEmptyDesc'),
      action: `<button type="button" class="btn btn-primary btn-sm" data-goto="generator">
        <i class="icon" data-lucide="sparkles"></i>
        <span>${escapeHtml(t('dashboard.heroCta'))}</span>
      </button>`
    });

  const activityMarkup = activity.length
    ? `<div class="activity-list">${activity.map((entry) => `
        <div class="activity-item">
          <span class="activity-icon is-${escapeHtml(entry.kind || 'generic')}">
            <i class="icon" data-lucide="${ACTIVITY_ICONS[entry.kind] || 'info'}"></i>
          </span>
          <span class="activity-body">
            <span class="activity-title">${activityText(entry)}</span>
            <span class="activity-time">${escapeHtml(relativeTime(entry.at, lang))}</span>
          </span>
        </div>`).join('')}</div>`
    : `<div class="empty-state compact">
        <div class="empty-icon"><i class="icon" data-lucide="list-filter"></i></div>
        <p>${escapeHtml(t('dashboard.activityEmpty'))}</p>
      </div>`;

  const quickMarkup = DASHBOARD_TYPES.map((type) => `
    <button type="button" class="quick-action" data-quick-type="${type}">
      <span class="quick-icon"><i class="icon" data-lucide="${typeIcon(type)}"></i></span>
      <span class="quick-text">
        <span class="quick-label">${escapeHtml(t(`types.${type}`))}</span>
        <span class="quick-desc">${escapeHtml(t('dashboard.allTypes'))}</span>
      </span>
    </button>`).join('');

  view.innerHTML = `<div class="dashboard-grid view-enter">
    <div class="dashboard-main">
      <section class="card dashboard-hero">
        <div class="dashboard-hero-copy">
          <span class="eyebrow"><i class="icon" data-lucide="shield-check"></i>${escapeHtml(t('dashboard.heroEyebrow'))}</span>
          <h2>${escapeHtml(t('dashboard.heroTitle'))}</h2>
          <p>${escapeHtml(t('dashboard.heroBody'))}</p>
          <div class="hero-actions">
            <button type="button" class="btn btn-primary" data-goto="generator">
              <i class="icon" data-lucide="qr-code"></i>
              <span>${escapeHtml(t('dashboard.heroCta'))}</span>
            </button>
            <button type="button" class="btn btn-secondary" data-goto="batch">
              <i class="icon" data-lucide="layers"></i>
              <span>${escapeHtml(t('dashboard.heroBatch'))}</span>
            </button>
            <button type="button" class="btn btn-ghost" data-goto="scanner">
              <i class="icon" data-lucide="scan-line"></i>
              <span>${escapeHtml(t('dashboard.heroScan'))}</span>
            </button>
          </div>
        </div>
        <div class="dashboard-hero-art" aria-hidden="true">
          <div class="hero-qr"><i class="icon" data-lucide="qr-code"></i></div>
          <span class="hero-chip hero-chip-1"><i class="icon" data-lucide="wifi"></i></span>
          <span class="hero-chip hero-chip-2"><i class="icon" data-lucide="star"></i></span>
          <span class="hero-chip hero-chip-3"><i class="icon" data-lucide="link"></i></span>
        </div>
      </section>

      <div class="stat-grid is-four">
        ${statCard({
          icon: 'qr-code',
          label: t('dashboard.statsGenerated'),
          value: formatNumber(state.stats.generated, lang),
          meta: t('dashboard.statsMetaGenerated')
        })}
        ${statCard({
          icon: 'scan-line',
          label: t('dashboard.statsScans'),
          value: formatNumber(state.stats.scans, lang),
          meta: t('dashboard.statsMetaScans')
        })}
        ${statCard({
          icon: 'history',
          label: t('dashboard.statsSaved'),
          value: formatNumber(metrics.history, lang),
          meta: t('dashboard.statsMetaSaved')
        })}
        ${statCard({
          icon: 'star',
          label: t('dashboard.statsFavorites'),
          value: formatNumber(metrics.favorites, lang),
          meta: t('dashboard.statsMetaFavorites')
        })}
      </div>

      <section class="card">
        <div class="card-header">
          <div>
            <h3 class="card-title">${escapeHtml(t('dashboard.quickTitle'))}</h3>
            <p class="card-subtitle">${escapeHtml(t('dashboard.quickDesc'))}</p>
          </div>
        </div>
        <div class="card-body">
          <div class="quick-grid is-four">${quickMarkup}</div>
        </div>
      </section>

      <section class="card">
        <div class="card-header">
          <div>
            <h3 class="card-title">${escapeHtml(t('dashboard.recentTitle'))}</h3>
            <p class="card-subtitle">${escapeHtml(t('dashboard.recentDesc'))}</p>
          </div>
          ${recent.length ? `<a class="link-action" href="#/history">${escapeHtml(t('dashboard.viewAll'))}<i class="icon icon-directional" data-lucide="arrow-right"></i></a>` : ''}
        </div>
        <div class="card-body">${recentMarkup}</div>
      </section>
    </div>

    <aside class="dashboard-side">
      <section class="card">
        <div class="card-header">
          <div>
            <h3 class="card-title">${escapeHtml(t('dashboard.activityTitle'))}</h3>
            <p class="card-subtitle">${escapeHtml(t('dashboard.activityDesc'))}</p>
          </div>
        </div>
        <div class="card-body">${activityMarkup}</div>
      </section>

      <section class="card">
        <div class="card-header">
          <div>
            <h3 class="card-title">${escapeHtml(t('dashboard.storageTitle'))}</h3>
            <p class="card-subtitle">${escapeHtml(t('dashboard.storageDesc'))}</p>
          </div>
          <a class="link-action" href="#/settings">${escapeHtml(t('dashboard.manage'))}</a>
        </div>
        <div class="card-body stack">
          <div class="storage-meter">
            <div class="storage-meter-row">
              <span>${escapeHtml(t('dashboard.storageUsed'))}</span>
              <strong>${escapeHtml(metrics.formatted)}</strong>
            </div>
            <div class="progress" aria-hidden="true">
              <div class="progress-bar" style="width:${quotaPercent === null ? 12 : Math.max(2, quotaPercent)}%"></div>
            </div>
            <div class="storage-meter-foot">
              <span>${escapeHtml(t('dashboard.storageEstimate'))}</span>
              <span>${quotaPercent === null
                ? escapeHtml(t('dashboard.storageUnknown'))
                : `${formatBytes(estimate.usage)} / ${formatBytes(estimate.quota)}`}</span>
            </div>
          </div>
          <dl class="kv-list">
            <div class="kv-row"><dt>${escapeHtml(t('dashboard.storageHistory'))}</dt><dd>${formatNumber(metrics.history, lang)}</dd></div>
            <div class="kv-row"><dt>${escapeHtml(t('dashboard.storageFavorites'))}</dt><dd>${formatNumber(metrics.favorites, lang)}</dd></div>
            <div class="kv-row"><dt>${escapeHtml(t('dashboard.storageScans'))}</dt><dd>${formatNumber(metrics.scans, lang)}</dd></div>
          </dl>
        </div>
      </section>

      <div class="banner banner-info">
        <i class="icon" data-lucide="shield-check"></i>
        <div><strong>${escapeHtml(t('dashboard.privacyTitle'))}</strong><br>${escapeHtml(t('dashboard.privacyDesc'))}</div>
      </div>

      <div class="banner banner-warning">
        <i class="icon" data-lucide="sparkles"></i>
        <div><strong>${escapeHtml(t('dashboard.tipTitle'))}</strong><br>${escapeHtml(t('dashboard.tipBody'))}</div>
      </div>
    </aside>
  </div>`;

  applyIcons(view);

  const onClick = (event) => {
    const go = event.target.closest('[data-goto]');
    if (go) {
      navigate(go.getAttribute('data-goto'));
      return;
    }
    const quick = event.target.closest('[data-quick-type]');
    if (quick) {
      setNewType(quick.getAttribute('data-quick-type'));
      navigate('generator');
      return;
    }
    const recentButton = event.target.closest('[data-recent]');
    if (recentButton) {
      const record = state.history.find((item) => item.id === recentButton.getAttribute('data-recent'));
      if (record) {
        openRecordPreview(record, {
          context: 'history',
          onChanged: () => ctx.refresh(),
          onRemoved: () => ctx.refresh()
        });
      }
    }
  };

  view.addEventListener('click', onClick);
  return () => view.removeEventListener('click', onClick);
}
