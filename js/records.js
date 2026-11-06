/** Shared record cards, thumbnail rendering, preview dialog and record actions. */
import { getLogo } from './db.js';
import { downloadRecord, copyQrAsImage, recordDataUrl } from './export.js';
import { t } from './i18n.js';
import { byteLength } from './payloads.js';
import { navigate } from './router.js';
import {
  deleteFavorite, deleteHistory, isFavorite, normalizeRecord, restoreFavorite,
  restoreHistory, toggleFavorite
} from './storage.js';
import { applyIcons, confirmDialog, openModal, printQr, setBusy, toast } from './ui.js';
import {
  copyText, escapeHtml, formatBytes, formatDate, relativeTime, truncate
} from './utils.js';

export const EDIT_KEY = 'qs.edit.v1';
export const NEW_TYPE_KEY = 'qs.newqr.v1';

const TYPE_ICONS = {
  url: 'link',
  text: 'type',
  wifi: 'wifi',
  email: 'mail',
  phone: 'phone',
  sms: 'message-square',
  vcard: 'contact',
  location: 'map-pin'
};

export function typeIcon(type) {
  return TYPE_ICONS[type] || 'qr-code';
}

export function typeLabel(type) {
  return t(`types.${type}`);
}

export function setEditRecord(record) {
  try {
    sessionStorage.setItem(EDIT_KEY, JSON.stringify(record));
  } catch {
    // Session storage can be unavailable in hardened modes; the caller falls back.
  }
}

export function takeEditRecord() {
  try {
    const raw = sessionStorage.getItem(EDIT_KEY);
    sessionStorage.removeItem(EDIT_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw);
    return normalizeRecord(parsed);
  } catch {
    return null;
  }
}

export function setNewType(type) {
  try {
    sessionStorage.setItem(NEW_TYPE_KEY, String(type));
  } catch { /* ignore */ }
}

export function takeNewType() {
  try {
    const value = sessionStorage.getItem(NEW_TYPE_KEY);
    sessionStorage.removeItem(NEW_TYPE_KEY);
    return value;
  } catch {
    return null;
  }
}

export function editRecord(record) {
  if (!record) return;
  setEditRecord(record);
  navigate('generator');
}

/* ------------------------------------------------------------------ */
/* Cards                                                               */
/* ------------------------------------------------------------------ */

export function renderRecordCard(record, { removeIcon = 'trash-2', removeLabel = 'common.delete' } = {}) {
  const favorite = isFavorite(record);
  const when = relativeTime(record.updatedAt || record.createdAt, document.documentElement.lang || 'en');
  const hasLogo = Boolean(record.logoId);
  return `<article class="record-card" data-record="${escapeHtml(record.id)}">
    <div class="record-top">
      <div class="record-thumb is-loading" data-thumb="${escapeHtml(record.id)}">
        <i class="icon" data-lucide="qr-code"></i>
      </div>
      <div class="record-info">
        <div class="record-label" title="${escapeHtml(record.label)}">${escapeHtml(record.label)}</div>
        <div class="record-payload">${escapeHtml(truncate(record.payload.replace(/\s+/g, ' '), 120))}</div>
        <div class="record-meta">
          <span class="badge badge-neutral"><i class="icon" data-lucide="${typeIcon(record.type)}"></i>${escapeHtml(typeLabel(record.type))}</span>
          <span>${escapeHtml(when)}</span>
          ${hasLogo ? `<span class="logo-flag"><i class="icon" data-lucide="image"></i>${escapeHtml(t('preview.logo'))}</span>` : ''}
        </div>
      </div>
      <button type="button" class="record-fav ${favorite ? 'is-active' : ''}" data-record-action="favorite"
        aria-label="${escapeHtml(favorite ? t('preview.unfavorite') : t('preview.favorite'))}"
        aria-pressed="${favorite ? 'true' : 'false'}" title="${escapeHtml(favorite ? t('preview.unfavorite') : t('preview.favorite'))}">
        <i class="icon" data-lucide="star"></i>
      </button>
    </div>
    <div class="record-actions">
      <button type="button" class="record-action" data-record-action="preview" title="${escapeHtml(t('common.preview'))}" aria-label="${escapeHtml(t('common.preview'))}">
        <i class="icon" data-lucide="eye"></i>
      </button>
      <button type="button" class="record-action" data-record-action="download" title="${escapeHtml(t('common.download'))}" aria-label="${escapeHtml(t('common.download'))}">
        <i class="icon" data-lucide="download"></i>
      </button>
      <button type="button" class="record-action" data-record-action="print" title="${escapeHtml(t('common.print'))}" aria-label="${escapeHtml(t('common.print'))}">
        <i class="icon" data-lucide="printer"></i>
      </button>
      <button type="button" class="record-action" data-record-action="edit" title="${escapeHtml(t('common.edit'))}" aria-label="${escapeHtml(t('common.edit'))}">
        <i class="icon" data-lucide="pencil"></i>
      </button>
      <span class="spacer"></span>
      <button type="button" class="record-action is-danger" data-record-action="remove" title="${escapeHtml(t(removeLabel))}" aria-label="${escapeHtml(t(removeLabel))}">
        <i class="icon" data-lucide="${removeIcon}"></i>
      </button>
    </div>
  </article>`;
}

/**
 * Render visible thumbnails lazily with a small concurrency limit.
 * @returns {() => void} cleanup
 */
export function hydrateThumbs(root, records, { signal } = {}) {
  const byId = new Map(records.map((record) => [record.id, record]));
  const nodes = Array.from(root.querySelectorAll('[data-thumb]'));
  if (!nodes.length) return () => {};

  let cancelled = false;
  let running = 0;
  const queue = [];
  const queued = new Set();

  const observer = typeof IntersectionObserver === 'function'
    ? new IntersectionObserver((entries) => {
      entries.forEach((entry) => {
        if (!entry.isIntersecting) return;
        observer.unobserve(entry.target);
        enqueue(entry.target);
      });
    }, { rootMargin: '260px' })
    : null;

  function enqueue(node) {
    if (cancelled || queued.has(node)) return;
    queued.add(node);
    queue.push(node);
    pump();
  }

  async function renderOne(node) {
    if (cancelled || !node.isConnected) return;
    const record = byId.get(node.getAttribute('data-thumb'));
    if (!record) return;
    try {
      const dataUrl = await recordDataUrl(record, { size: 180 });
      if (cancelled || !node.isConnected) return;
      node.classList.remove('is-loading', 'is-placeholder');
      node.innerHTML = `<img src="${dataUrl}" alt="" loading="lazy" decoding="async">`;
    } catch (error) {
      if (cancelled || !node.isConnected) return;
      node.classList.remove('is-loading');
      node.classList.add('is-placeholder');
      node.innerHTML = '<i class="icon" data-lucide="qr-code"></i>';
      applyIcons(node);
    }
  }

  function pump() {
    while (!cancelled && running < 3 && queue.length) {
      const node = queue.shift();
      running += 1;
      renderOne(node).finally(() => {
        running -= 1;
        pump();
      });
    }
  }

  if (observer) {
    nodes.forEach((node) => observer.observe(node));
  } else {
    nodes.forEach(enqueue);
  }

  if (signal) {
    signal.addEventListener('abort', () => {
      cancelled = true;
      observer?.disconnect();
    }, { once: true });
  }

  return () => {
    cancelled = true;
    observer?.disconnect();
    queue.length = 0;
  };
}

/* ------------------------------------------------------------------ */
/* Actions                                                             */
/* ------------------------------------------------------------------ */

export async function downloadRecordWithToast(record) {
  try {
    const result = await downloadRecord(record, {
      format: 'png',
      size: record.settings?.exportSize || 1024
    });
    toast(t('toast.downloadStarted', { filename: result.filename }), { type: 'success' });
    return true;
  } catch (error) {
    console.error('[download] failed', error);
    toast(t('toast.downloadFailed'), { type: 'error' });
    return false;
  }
}

export function toggleFavoriteWithToast(record) {
  try {
    const added = toggleFavorite(record);
    toast(t(added ? 'toast.favoriteAdded' : 'toast.favoriteRemoved'), {
      type: added ? 'success' : 'info'
    });
    return added;
  } catch (error) {
    if (error?.message === 'FAVORITES_LIMIT') {
      toast(t('toast.limit'), { type: 'warning' });
    } else {
      toast(t('errors.saveFailed'), { type: 'error' });
    }
    return null;
  }
}

export async function confirmRemoveRecord(record, context) {
  const favoriteContext = context === 'favorites';
  const confirmed = await confirmDialog({
    title: t(favoriteContext ? 'preview.removeTitle' : 'preview.deleteTitle'),
    message: t(favoriteContext ? 'preview.removeMessage' : 'preview.deleteMessage'),
    confirmLabel: t(favoriteContext ? 'preview.removeConfirm' : 'preview.deleteConfirm'),
    cancelLabel: t('common.cancel'),
    danger: !favoriteContext,
    icon: favoriteContext ? 'star' : 'trash-2'
  });
  if (!confirmed) return null;

  if (favoriteContext) {
    const removed = deleteFavorite(record.id);
    if (!removed) return null;
    toast(t('favorites.removed'), {
      type: 'success',
      actionLabel: t('favorites.undo'),
      onAction: () => {
        restoreFavorite(removed.record, removed.index);
        toast(t('favorites.restored'), { type: 'success' });
      }
    });
    return removed;
  }

  const removed = deleteHistory(record.id);
  if (!removed) return null;
  toast(t('history.removed'), {
    type: 'success',
    actionLabel: t('history.undo'),
    onAction: () => {
      restoreHistory(removed.record, removed.index);
      toast(t('history.restored'), { type: 'success' });
    }
  });
  return removed;
}

/* ------------------------------------------------------------------ */
/* Preview modal                                                       */
/* ------------------------------------------------------------------ */

function metaRow(label, value) {
  return `<div class="kv-row"><dt>${escapeHtml(label)}</dt><dd>${escapeHtml(value)}</dd></div>`;
}

export async function openRecordPreview(record, {
  context = 'history',
  onChanged = null,
  onRemoved = null
} = {}) {
  const favoriteContext = context === 'favorites';
  const created = formatDate(record.createdAt, document.documentElement.lang || 'en');
  const updated = record.updatedAt ? formatDate(record.updatedAt, document.documentElement.lang || 'en') : '';
  const bytes = byteLength(record.payload);
  const size = record.settings?.exportSize || 1024;

  let favorite = isFavorite(record);

  const content = `<div class="preview-modal">
    <div class="preview-modal-grid">
      <div class="preview-visual">
        <div class="preview-modal-qr" data-preview-qr>
          <span class="spinner" role="status" aria-label="${escapeHtml(t('common.loading'))}"></span>
        </div>
        <div class="preview-download-row">
          <div class="select-wrap">
            <select class="select" data-preview-format aria-label="${escapeHtml(t('preview.format'))}">
              <option value="png">PNG</option>
              <option value="svg">SVG</option>
              <option value="jpg">JPG</option>
            </select>
            <i class="icon" data-lucide="chevrons-up-down"></i>
          </div>
          <button type="button" class="btn btn-primary btn-sm" data-preview-download>
            <i class="icon" data-lucide="download"></i>
            <span>${escapeHtml(t('preview.download'))}</span>
          </button>
        </div>
      </div>
      <div class="preview-details">
        <div class="chip-row">
          <span class="badge badge-accent"><i class="icon" data-lucide="${typeIcon(record.type)}"></i>${escapeHtml(typeLabel(record.type))}</span>
          <span class="badge badge-neutral">${escapeHtml(relativeTime(record.updatedAt || record.createdAt, document.documentElement.lang || 'en'))}</span>
          ${record.logoId ? '<span class="badge badge-info"><i class="icon" data-lucide="image"></i>' + escapeHtml(t('preview.withLogo')) + '</span>' : ''}
        </div>
        <dl class="kv-list">
          ${metaRow(t('preview.label'), record.label)}
          ${metaRow(t('preview.created'), created)}
          ${updated ? metaRow(t('preview.updated'), updated) : ''}
          ${metaRow(t('preview.bytes'), bytes >= 1024
            ? `${formatBytes(bytes)} · ${bytes} ${t('common.bytes')}`
            : formatBytes(bytes))}
          ${metaRow(t('preview.ecc'), record.settings?.errorCorrection || 'M')}
          ${metaRow(t('preview.size'), t('preview.dimensions', { size }))}
          ${metaRow(t('preview.logo'), record.logoId ? t('preview.withLogo') : t('preview.withoutLogo'))}
        </dl>
        <div class="field">
          <span class="field-label">${escapeHtml(t('preview.payload'))}</span>
          <pre class="code-block" data-preview-payload>${escapeHtml(record.payload)}</pre>
        </div>
      </div>
    </div>
    <div class="preview-modal-actions">
      <button type="button" class="btn btn-secondary btn-sm" data-preview-favorite>
        <i class="icon" data-lucide="star"></i>
        <span>${escapeHtml(favorite ? t('preview.unfavorite') : t('preview.favorite'))}</span>
      </button>
      <button type="button" class="btn btn-secondary btn-sm" data-preview-copy-image>
        <i class="icon" data-lucide="copy"></i>
        <span>${escapeHtml(t('preview.copyImage'))}</span>
      </button>
      <button type="button" class="btn btn-secondary btn-sm" data-preview-copy-text>
        <i class="icon" data-lucide="type"></i>
        <span>${escapeHtml(t('preview.copyText'))}</span>
      </button>
      <button type="button" class="btn btn-secondary btn-sm" data-preview-print>
        <i class="icon" data-lucide="printer"></i>
        <span>${escapeHtml(t('preview.print'))}</span>
      </button>
      <span class="spacer"></span>
      <button type="button" class="btn btn-secondary btn-sm" data-preview-edit>
        <i class="icon" data-lucide="pencil"></i>
        <span>${escapeHtml(t('preview.edit'))}</span>
      </button>
      <button type="button" class="btn btn-danger btn-sm" data-preview-delete>
        <i class="icon" data-lucide="${favoriteContext ? 'star' : 'trash-2'}"></i>
        <span>${escapeHtml(favoriteContext ? t('favorites.delete') : t('preview.delete'))}</span>
      </button>
    </div>
  </div>`;

  const modal = openModal({
    title: t('preview.title'),
    subtitle: t('preview.subtitle'),
    content,
    size: 'lg'
  });

  const favoriteButton = modal.body.querySelector('[data-preview-favorite]');
  const qrTarget = modal.body.querySelector('[data-preview-qr]');

  function paintFavorite() {
    if (!favoriteButton) return;
    favoriteButton.innerHTML = `<i class="icon" data-lucide="star"></i><span>${escapeHtml(
      favorite ? t('preview.unfavorite') : t('preview.favorite')
    )}</span>`;
    favoriteButton.classList.toggle('is-active', favorite);
    favoriteButton.classList.toggle('btn-soft', favorite);
    favoriteButton.classList.toggle('btn-secondary', !favorite);
    applyIcons(favoriteButton);
  }
  paintFavorite();

  try {
    const dataUrl = await recordDataUrl(record, { size: 900 });
    if (!qrTarget?.isConnected) return;
    qrTarget.innerHTML = `<img src="${dataUrl}" alt="${escapeHtml(record.label)}">`;
  } catch (error) {
    console.error('[preview] render failed', error);
    if (qrTarget?.isConnected) {
      qrTarget.innerHTML = `<div class="preview-failed"><i class="icon" data-lucide="alert-triangle"></i><span>${escapeHtml(t('preview.loadFailed'))}</span></div>`;
      applyIcons(qrTarget);
    }
  }

  modal.body.addEventListener('click', async (event) => {
    const button = event.target.closest('button');
    if (!button) return;

    if (button.matches('[data-preview-download]')) {
      const format = modal.body.querySelector('[data-preview-format]')?.value || 'png';
      setBusy(button, true);
      try {
        const result = await downloadRecord(record, { format, size });
        toast(t('toast.downloadStarted', { filename: result.filename }), { type: 'success' });
      } catch (error) {
        console.error('[preview] download failed', error);
        toast(t('toast.downloadFailed'), { type: 'error' });
      } finally {
        if (button.isConnected) setBusy(button, false);
      }
      return;
    }

    if (button.matches('[data-preview-print]')) {
      setBusy(button, true);
      try {
        const dataUrl = await recordDataUrl(record, { size: 1024 });
        await printQr(dataUrl, {
          title: record.label,
          subtitle: `${typeLabel(record.type)} · ${record.payload}`
        });
        toast(t('toast.printed'), { type: 'info' });
      } catch (error) {
        console.error('[preview] print failed', error);
        toast(t('toast.printFailed'), { type: 'error' });
      } finally {
        if (button.isConnected) setBusy(button, false);
      }
      return;
    }

    if (button.matches('[data-preview-copy-image]')) {
      setBusy(button, true);
      try {
        const mode = await copyQrAsImage(record, { size });
        if (mode === 'image') toast(t('toast.copyImage'), { type: 'success' });
        else toast(t('toast.copyImageFallback'), { type: 'info' });
      } catch (error) {
        console.error('[preview] copy failed', error);
        toast(t('toast.copyFailed'), { type: 'error' });
      } finally {
        if (button.isConnected) setBusy(button, false);
      }
      return;
    }

    if (button.matches('[data-preview-copy-text]')) {
      try {
        await copyText(record.payload);
        toast(t('toast.copyPayload'), { type: 'success' });
      } catch {
        toast(t('toast.copyFailed'), { type: 'error' });
      }
      return;
    }

    if (button.matches('[data-preview-favorite]')) {
      const added = toggleFavoriteWithToast(record);
      if (added === null) return;
      favorite = added;
      paintFavorite();
      onChanged?.();
      return;
    }

    if (button.matches('[data-preview-edit]')) {
      modal.close();
      editRecord(record);
      return;
    }

    if (button.matches('[data-preview-delete]')) {
      const removed = await confirmRemoveRecord(record, favoriteContext ? 'favorites' : 'history');
      if (!removed) return;
      modal.close();
      onChanged?.();
      onRemoved?.(record);
    }
  });
}

/* ------------------------------------------------------------------ */
/* Delegated card bindings                                             */
/* ------------------------------------------------------------------ */

export function bindRecordCards(root, records, {
  context = 'history',
  onChanged = null,
  onRemoved = null
} = {}) {
  const byId = new Map(records.map((record) => [record.id, record]));
  const handler = async (event) => {
    const target = event.target.closest('[data-record-action]');
    if (!target) return;
    const card = target.closest('[data-record]');
    if (!card) return;
    const record = byId.get(card.getAttribute('data-record'));
    if (!record) return;

    const action = target.getAttribute('data-record-action');
    if (action === 'favorite') {
      const added = toggleFavoriteWithToast(record);
      if (added === null) return;
      target.classList.toggle('is-active', added);
      target.setAttribute('aria-pressed', added ? 'true' : 'false');
      target.setAttribute('aria-label', t(added ? 'preview.unfavorite' : 'preview.favorite'));
      target.setAttribute('title', t(added ? 'preview.unfavorite' : 'preview.favorite'));
      onChanged?.();
      return;
    }

    if (action === 'preview') {
      openRecordPreview(record, { context, onChanged, onRemoved });
      return;
    }

    if (action === 'download') {
      setBusy(target, true);
      await downloadRecordWithToast(record);
      if (target.isConnected) setBusy(target, false);
      return;
    }

    if (action === 'print') {
      setBusy(target, true);
      try {
        const dataUrl = await recordDataUrl(record, { size: 1024 });
        await printQr(dataUrl, {
          title: record.label,
          subtitle: `${typeLabel(record.type)} · ${record.payload}`
        });
      } catch (error) {
        console.error('[print] failed', error);
        toast(t('toast.printFailed'), { type: 'error' });
      } finally {
        if (target.isConnected) setBusy(target, false);
      }
      return;
    }

    if (action === 'edit') {
      editRecord(record);
      return;
    }

    if (action === 'remove') {
      const removed = await confirmRemoveRecord(record, context);
      if (removed) {
        onChanged?.();
        onRemoved?.(removed.record);
      }
    }
  };

  root.addEventListener('click', handler);
  return () => root.removeEventListener('click', handler);
}

/** Loaded separately so callers can await it when opening a preview directly. */
export async function logoDataFor(record) {
  if (!record?.logoId) return null;
  try {
    return (await getLogo(record.logoId))?.dataUrl || null;
  } catch {
    return null;
  }
}
