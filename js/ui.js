/** Reusable UI primitives: modals, toasts, dialogs, print, busy states. */
import { escapeHtml, uid, waitForImage } from './utils.js';

const modalStack = [];

export function applyIcons(root = document) {
  if (window.Lucide && typeof window.Lucide.createIcons === 'function') {
    window.Lucide.createIcons(root);
  }
}

function focusables(element) {
  return Array.from(element.querySelectorAll(
    'a[href], button:not([disabled]), textarea:not([disabled]), input:not([disabled]), select:not([disabled]), [tabindex]:not([tabindex="-1"])'
  )).filter((node) => !node.hidden && node.offsetParent !== null);
}

function syncBodyLock() {
  document.body.classList.toggle('modal-open', modalStack.length > 0);
}

export function openModal({
  title = '',
  subtitle = '',
  content = '',
  actions = [],
  size = 'md',
  onClose = null,
  closeOnBackdrop = true,
  className = ''
} = {}) {
  const id = uid('modal');
  const overlay = document.createElement('div');
  overlay.className = 'modal-backdrop';
  overlay.setAttribute('data-modal', id);
  const titleId = `${id}-title`;
  const header = title
    ? `<header class="modal-header">
        <div>
          <h2 id="${titleId}" class="modal-title">${escapeHtml(title)}</h2>
          ${subtitle ? `<p class="modal-subtitle">${escapeHtml(subtitle)}</p>` : ''}
        </div>
        <button type="button" class="btn btn-icon btn-ghost modal-close" data-modal-close aria-label="Close">
          <i class="icon" data-lucide="x"></i>
        </button>
      </header>`
    : '';
  const footer = actions.length
    ? `<footer class="modal-footer">${actions.map((action, index) => `
        <button type="button" class="btn ${action.variant ? `btn-${action.variant}` : 'btn-secondary'}" data-modal-action="${index}" ${action.disabled ? 'disabled' : ''}>
          ${action.icon ? `<i class="icon" data-lucide="${escapeHtml(action.icon)}"></i>` : ''}
          <span>${escapeHtml(action.label || '')}</span>
        </button>`).join('')}</footer>`
    : '';
  overlay.innerHTML = `<section class="modal modal-${escapeHtml(size)} ${escapeHtml(className)}" role="dialog" aria-modal="true" ${title ? `aria-labelledby="${titleId}"` : ''}>
    ${header}
    <div class="modal-body">${typeof content === 'string' ? content : ''}</div>
    ${footer}
  </section>`;
  const modalEl = overlay.querySelector('.modal');
  const bodyEl = overlay.querySelector('.modal-body');
  if (content instanceof Node) bodyEl.appendChild(content);
  document.body.appendChild(overlay);
  applyIcons(overlay);

  const trigger = document.activeElement;
  const modal = {
    id,
    overlay,
    element: modalEl,
    body: bodyEl,
    footer: overlay.querySelector('.modal-footer'),
    close,
    setTitle(nextTitle, nextSubtitle = '') {
      const heading = overlay.querySelector('.modal-title');
      if (heading) heading.textContent = nextTitle;
      const sub = overlay.querySelector('.modal-subtitle');
      if (sub) sub.textContent = nextSubtitle;
    }
  };

  function close() {
    if (!overlay.isConnected) return;
    const index = modalStack.indexOf(modal);
    if (index >= 0) modalStack.splice(index, 1);
    overlay.classList.remove('is-open');
    syncBodyLock();
    const remove = () => {
      overlay.remove();
      if (trigger && typeof trigger.focus === 'function' && trigger.isConnected) {
        try { trigger.focus({ preventScroll: true }); } catch { /* ignore */ }
      }
    };
    const timeout = setTimeout(remove, 220);
    overlay.addEventListener('transitionend', () => {
      clearTimeout(timeout);
      remove();
    }, { once: true });
    if (typeof onClose === 'function') onClose();
  }

  overlay.addEventListener('click', (event) => {
    if (event.target === overlay && closeOnBackdrop) close();
    if (event.target.closest('[data-modal-close]')) close();
  });

  overlay.querySelectorAll('[data-modal-action]').forEach((button) => {
    button.addEventListener('click', async () => {
      const action = actions[Number(button.getAttribute('data-modal-action'))];
      if (!action) return;
      if (typeof action.onClick !== 'function') {
        if (action.close !== false) close();
        return;
      }
      try {
        setBusy(button, true);
        const result = await action.onClick(modal);
        if (result !== false && action.close !== false) close();
      } catch (error) {
        console.error(error);
        toast(error.message || 'Something went wrong', { type: 'error' });
      } finally {
        if (button.isConnected) setBusy(button, false);
      }
    });
  });

  modalStack.push(modal);
  syncBodyLock();
  requestAnimationFrame(() => {
    overlay.classList.add('is-open');
    const focusTarget = overlay.querySelector('[autofocus]') || focusables(overlay)[0];
    if (focusTarget) focusTarget.focus({ preventScroll: true });
  });

  return modal;
}

export function closeTopModal() {
  const top = modalStack[modalStack.length - 1];
  if (top) top.close();
}

export function closeAllModals() {
  while (modalStack.length) closeTopModal();
}

document.addEventListener('keydown', (event) => {
  if (!modalStack.length) return;
  const top = modalStack[modalStack.length - 1];
  if (event.key === 'Escape') {
    event.preventDefault();
    top.close();
    return;
  }
  if (event.key === 'Tab') {
    const nodes = focusables(top.overlay);
    if (!nodes.length) return;
    const first = nodes[0];
    const last = nodes[nodes.length - 1];
    if (event.shiftKey && document.activeElement === first) {
      event.preventDefault();
      last.focus();
    } else if (!event.shiftKey && document.activeElement === last) {
      event.preventDefault();
      first.focus();
    }
  }
});

export function confirmDialog({
  title,
  message,
  confirmLabel = 'Confirm',
  cancelLabel = 'Cancel',
  danger = false,
  checkboxLabel = '',
  icon = ''
} = {}) {
  return new Promise((resolve) => {
    let resolved = false;
    const checkboxId = uid('confirm');
    const content = `
      <div class="confirm-content">
        ${icon ? `<div class="confirm-icon ${danger ? 'is-danger' : ''}"><i class="icon" data-lucide="${escapeHtml(icon)}"></i></div>` : ''}
        <div class="confirm-message">${escapeHtml(message || '')}</div>
        ${checkboxLabel ? `<label class="check-row" for="${checkboxId}">
          <input type="checkbox" id="${checkboxId}" data-confirm-check>
          <span>${escapeHtml(checkboxLabel)}</span>
        </label>` : ''}
      </div>`;
    const modal = openModal({
      title,
      content,
      size: 'sm',
      actions: [
        { label: cancelLabel, variant: 'ghost', close: false, onClick: () => { finish(false); modal.close(); } },
        {
          label: confirmLabel,
          variant: danger ? 'danger' : 'primary',
          close: false,
          disabled: Boolean(checkboxLabel),
          onClick: (m) => { finish(true); m.close(); }
        }
      ],
      onClose: () => finish(false)
    });
    function finish(value) {
      if (resolved) return;
      resolved = true;
      resolve(value);
    }
    const check = modal.overlay.querySelector('[data-confirm-check]');
    const confirmBtn = modal.overlay.querySelector('[data-modal-action="1"]');
    if (check && confirmBtn) {
      check.addEventListener('change', () => {
        confirmBtn.disabled = !check.checked;
      });
      modal.overlay.querySelector('.modal-body').addEventListener('click', (event) => {
        // Clicking the row toggles natively; nothing else required.
        if (event.target.closest('.check-row')) return;
      });
    }
  });
}

export function toast(message, {
  type = 'info',
  duration = 3800,
  actionLabel = '',
  onAction = null
} = {}) {
  const root = document.getElementById('toast-root');
  if (!root) return null;
  while (root.children.length >= 4) root.firstElementChild?.remove();
  const el = document.createElement('div');
  el.className = `toast toast-${type}`;
  el.setAttribute('role', 'status');
  const icon = type === 'success' ? 'circle-check' : type === 'error' ? 'alert-triangle' : type === 'warning' ? 'alert-triangle' : 'info';
  el.innerHTML = `<i class="icon toast-icon" data-lucide="${icon}"></i>
    <div class="toast-message">${escapeHtml(message)}</div>
    ${actionLabel ? `<button type="button" class="toast-action">${escapeHtml(actionLabel)}</button>` : ''}
    <button type="button" class="btn btn-icon btn-ghost toast-close" aria-label="Dismiss"><i class="icon" data-lucide="x"></i></button>`;
  root.appendChild(el);
  applyIcons(el);
  let timer = null;
  const dismiss = () => {
    if (!el.isConnected) return;
    clearTimeout(timer);
    el.classList.remove('is-visible');
    setTimeout(() => el.remove(), 220);
  };
  const arm = () => {
    clearTimeout(timer);
    if (duration > 0) timer = setTimeout(dismiss, duration);
  };
  el.querySelector('.toast-close')?.addEventListener('click', dismiss);
  const actionBtn = el.querySelector('.toast-action');
  if (actionBtn) {
    actionBtn.addEventListener('click', () => {
      try { onAction?.(); } finally { dismiss(); }
    });
  }
  el.addEventListener('mouseenter', () => clearTimeout(timer));
  el.addEventListener('mouseleave', arm);
  requestAnimationFrame(() => el.classList.add('is-visible'));
  arm();
  return { dismiss, element: el };
}

export function setBusy(button, busy) {
  if (!button) return;
  if (busy) {
    button.dataset.wasDisabled = button.disabled ? '1' : '';
    button.disabled = true;
    button.classList.add('is-busy');
    button.setAttribute('aria-busy', 'true');
  } else {
    button.disabled = button.dataset.wasDisabled === '1';
    button.classList.remove('is-busy');
    button.removeAttribute('aria-busy');
    delete button.dataset.wasDisabled;
  }
}

export function emptyState({ icon = 'qr-code', title, description, action = '' }) {
  return `<div class="empty-state">
    <div class="empty-icon"><i class="icon" data-lucide="${escapeHtml(icon)}"></i></div>
    <h3>${escapeHtml(title || '')}</h3>
    <p>${escapeHtml(description || '')}</p>
    ${action || ''}
  </div>`;
}

export function statusBadge(text, variant = 'neutral') {
  return `<span class="badge badge-${escapeHtml(variant)}">${escapeHtml(text)}</span>`;
}

export async function printQr(dataUrl, { title = '', subtitle = '' } = {}) {
  const root = document.getElementById('print-root');
  if (!root) return;
  root.innerHTML = `<div class="print-sheet">
    <img src="${dataUrl}" alt="" class="print-image">
    ${title ? `<div class="print-title">${escapeHtml(title)}</div>` : ''}
    ${subtitle ? `<div class="print-subtitle">${escapeHtml(subtitle)}</div>` : ''}
    <div class="print-footer">QR Studio · ${new Date().toLocaleDateString()}</div>
  </div>`;
  const img = root.querySelector('img');
  try {
    await waitForImage(img);
  } catch {
    toast('Unable to prepare the print view', { type: 'error' });
    return;
  }
  root.classList.add('is-printing');
  const cleanup = () => {
    root.classList.remove('is-printing');
    root.innerHTML = '';
    window.removeEventListener('afterprint', cleanup);
  };
  window.addEventListener('afterprint', cleanup, { once: true });
  setTimeout(() => {
    window.print();
    setTimeout(cleanup, 1200);
  }, 50);
}

export async function copyWithToast(text, successMessage, errorMessage) {
  try {
    const { copyText } = await import('./utils.js');
    await copyText(text);
    toast(successMessage, { type: 'success' });
    return true;
  } catch {
    toast(errorMessage, { type: 'error' });
    return false;
  }
}
