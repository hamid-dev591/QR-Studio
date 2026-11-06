/** Hash-based SPA router with lazy view loading and cleanup. */
import { t } from './i18n.js';
import { applyIcons, closeAllModals } from './ui.js';
import { escapeHtml } from './utils.js';

const ROUTES = {
  dashboard: {
    title: 'nav.dashboard',
    kicker: 'nav.workspace',
    load: () => import('./dashboard.js')
  },
  generator: {
    title: 'nav.generator',
    kicker: 'nav.workspace',
    load: () => import('./generator.js')
  },
  batch: {
    title: 'nav.batch',
    kicker: 'nav.workspace',
    load: () => import('./batch.js')
  },
  scanner: {
    title: 'nav.scanner',
    kicker: 'nav.workspace',
    load: () => import('./scanner.js')
  },
  history: {
    title: 'nav.history',
    kicker: 'nav.library',
    load: () => import('./history.js')
  },
  favorites: {
    title: 'nav.favorites',
    kicker: 'nav.library',
    load: () => import('./favorites.js')
  },
  settings: {
    title: 'nav.settings',
    kicker: 'nav.system',
    load: () => import('./settings.js')
  },
  about: {
    title: 'nav.about',
    kicker: 'nav.system',
    load: () => import('./about.js')
  }
};

const viewModules = new Map();
let currentCleanup = null;
let currentRoute = null;
let renderToken = 0;
let renderAbort = null;
let started = false;

export function routeFromHash() {
  const raw = String(location.hash || '').replace(/^#\/?/, '').split('?')[0].trim();
  return Object.prototype.hasOwnProperty.call(ROUTES, raw) ? raw : 'dashboard';
}

export function hashParams() {
  const index = String(location.hash || '').indexOf('?');
  return new URLSearchParams(index >= 0 ? location.hash.slice(index + 1) : '');
}

export function currentRouteName() {
  return currentRoute;
}

export function navigate(path) {
  const target = String(path || 'dashboard').replace(/^#\/?/, '');
  const hash = `#/${target}`;
  if (location.hash === hash) {
    render({ force: true });
    return;
  }
  location.hash = hash;
}

async function loadView(name) {
  if (viewModules.has(name)) return viewModules.get(name);
  const promise = ROUTES[name].load().catch((error) => {
    viewModules.delete(name);
    throw error;
  });
  viewModules.set(name, promise);
  return promise;
}

function setShell(name) {
  const route = ROUTES[name];
  const title = t(route.title);
  const kicker = document.getElementById('page-kicker');
  const heading = document.getElementById('page-title');
  if (kicker) kicker.textContent = t(route.kicker);
  if (heading) heading.textContent = title;
  document.title = `${title} · QR Studio`;

  document.querySelectorAll('#main-nav .nav-item').forEach((item) => {
    const active = item.getAttribute('data-route') === name;
    item.classList.toggle('is-active', active);
    if (active) item.setAttribute('aria-current', 'page');
    else item.removeAttribute('aria-current');
  });
}

function loadingMarkup() {
  return `<div class="route-loading"><span class="spinner"></span><span>${escapeHtml(t('common.loading'))}</span></div>`;
}

function errorMarkup() {
  return `<div class="empty-state" role="alert">
    <div class="empty-icon"><i class="icon" data-lucide="alert-triangle"></i></div>
    <h3>${escapeHtml(t('errors.viewFailed'))}</h3>
    <p>${escapeHtml(t('errors.network'))}</p>
    <button type="button" class="btn btn-primary" data-route-retry>
      <i class="icon" data-lucide="refresh-cw"></i>
      <span>${escapeHtml(t('errors.routeRetry'))}</span>
    </button>
  </div>`;
}

export async function render({ force = false } = {}) {
  if (!force && !started) return null;
  const name = routeFromHash();
  const view = document.getElementById('view');
  if (!view) return null;

  const token = ++renderToken;
  if (renderAbort) {
    try { renderAbort.abort(); } catch { /* ignore */ }
  }
  renderAbort = new AbortController();
  const signal = renderAbort.signal;

  if (typeof currentCleanup === 'function') {
    try { currentCleanup(); } catch (error) { console.error('[router] cleanup failed', error); }
  }
  currentCleanup = null;

  closeAllModals();
  const changed = currentRoute !== name;
  currentRoute = name;
  setShell(name);

  if (changed) {
    try { window.scrollTo({ top: 0, behavior: 'auto' }); } catch { /* ignore */ }
  }

  view.innerHTML = loadingMarkup();
  applyIcons(view);

  try {
    const module = await loadView(name);
    if (token !== renderToken) return null;
    view.innerHTML = '';
    const result = await module.default(view, {
      name,
      params: hashParams(),
      navigate,
      signal,
      refresh: () => render({ force: true })
    });
    if (token !== renderToken) {
      if (typeof result === 'function') {
        try { result(); } catch { /* ignore */ }
      }
      return null;
    }
    currentCleanup = typeof result === 'function'
      ? result
      : result && typeof result.cleanup === 'function'
        ? result.cleanup
        : null;
    view.querySelectorAll('[data-route-retry]').forEach((button) => {
      button.addEventListener('click', () => render({ force: true }));
    });
    applyIcons(view);
    document.documentElement.classList.add('is-ready');
    return name;
  } catch (error) {
    if (token !== renderToken) return null;
    console.error('[router] view failed', error);
    view.innerHTML = errorMarkup();
    applyIcons(view);
    const retry = view.querySelector('[data-route-retry]');
    if (retry) retry.addEventListener('click', () => render({ force: true }));
    document.documentElement.classList.add('is-ready');
    return null;
  }
}

export function refresh() {
  return render({ force: true });
}

export function startRouter() {
  started = true;
  const raw = String(location.hash || '').replace(/^#\/?/, '').split('?')[0].trim();
  if (!raw || !Object.prototype.hasOwnProperty.call(ROUTES, raw)) {
    try {
      history.replaceState(null, '', `${location.pathname}${location.search}#/dashboard`);
    } catch {
      location.hash = '#/dashboard';
    }
  }
  window.addEventListener('hashchange', () => { render({ force: true }); });
  return render({ force: true });
}
