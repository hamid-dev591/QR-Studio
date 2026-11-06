/** QR Studio application shell: theme, language, navigation, PWA and shortcuts. */
import { APP_VERSION } from './config.js';
import { apply, getLanguage, initLanguage, setLanguage, t } from './i18n.js';
import { getSettings, getState, saveSettings } from './storage.js';
import { getEffectiveTheme, initTheme, toggleTheme } from './themes.js';
import { applyIcons, toast } from './ui.js';
import { currentRouteName, refresh, startRouter } from './router.js';

const mobileQuery = window.matchMedia('(max-width: 900px)');
let deferredPrompt = null;
let shellBound = false;

function $(selector) {
  return document.querySelector(selector);
}

function isStandalone() {
  return window.matchMedia('(display-mode: standalone)').matches
    || window.navigator.standalone === true;
}

/* ------------------------------------------------------------------ */
/* Navigation shell                                                    */
/* ------------------------------------------------------------------ */

function openDrawer() {
  const sidebar = $('#sidebar');
  const scrim = $('#drawer-scrim');
  if (!sidebar || !scrim) return;
  sidebar.classList.add('is-open');
  scrim.classList.add('is-visible');
  scrim.setAttribute('aria-hidden', 'false');
  document.body.classList.add('drawer-open');
  applyIcons(sidebar);
}

function closeDrawer() {
  const sidebar = $('#sidebar');
  const scrim = $('#drawer-scrim');
  if (!sidebar || !scrim) return;
  sidebar.classList.remove('is-open');
  scrim.classList.remove('is-visible');
  scrim.setAttribute('aria-hidden', 'true');
  document.body.classList.remove('drawer-open');
}

function syncSidebar() {
  const shell = $('#app-shell');
  const collapse = $('#sidebar-collapse');
  if (!shell) return;
  const settings = getSettings();
  const collapsed = Boolean(settings.sidebarCollapsed) && !mobileQuery.matches;
  shell.classList.toggle('sidebar-collapsed', collapsed);
  if (collapse) {
    collapse.innerHTML = `<i class="icon" data-lucide="${collapsed ? 'panel-left-open' : 'panel-left-close'}"></i>`;
    collapse.setAttribute(
      'aria-label',
      t(collapsed ? 'common.expandSidebar' : 'common.collapseSidebar')
    );
    applyIcons(collapse);
  }
  if (!mobileQuery.matches) {
    closeDrawer();
  }
}

function bindShell() {
  if (shellBound) return;
  shellBound = true;

  const menu = $('#menu-toggle');
  const scrim = $('#drawer-scrim');
  const collapse = $('#sidebar-collapse');
  const nav = $('#main-nav');

  menu?.addEventListener('click', () => {
    const sidebar = $('#sidebar');
    if (sidebar?.classList.contains('is-open')) closeDrawer();
    else openDrawer();
  });
  scrim?.addEventListener('click', closeDrawer);

  collapse?.addEventListener('click', () => {
    const settings = getSettings();
    const collapsed = !settings.sidebarCollapsed;
    saveSettings({ sidebarCollapsed: collapsed });
    syncSidebar();
    toast(t(collapsed ? 'common.sidebarCollapsed' : 'common.sidebarExpanded'), {
      type: 'info',
      duration: 1800
    });
  });

  nav?.addEventListener('click', (event) => {
    if (event.target.closest('.nav-item')) closeDrawer();
  });

  mobileQuery.addEventListener?.('change', syncSidebar);
}

/* ------------------------------------------------------------------ */
/* Header controls                                                     */
/* ------------------------------------------------------------------ */

function syncThemeButton() {
  const button = $('#theme-toggle');
  if (!button) return;
  const dark = getEffectiveTheme() === 'dark';
  button.innerHTML = `<i class="icon" data-lucide="${dark ? 'sun' : 'moon'}"></i>`;
  button.setAttribute('aria-label', t('common.toggleTheme'));
  applyIcons(button);
}

function syncLanguageButton() {
  const button = $('#lang-toggle');
  if (!button) return;
  const lang = getLanguage();
  button.textContent = lang === 'ar' ? 'EN' : 'AR';
  button.setAttribute('lang', lang === 'ar' ? 'en' : 'ar');
  button.setAttribute('title', lang === 'ar' ? t('common.english') : t('common.arabic'));
  button.setAttribute(
    'aria-label',
    lang === 'ar' ? t('common.switchToEnglish') : t('common.switchToArabic')
  );
}

function bindHeader() {
  $('#theme-toggle')?.addEventListener('click', () => {
    toggleTheme();
    syncThemeButton();
  });

  $('#lang-toggle')?.addEventListener('click', async (event) => {
    const button = event.currentTarget;
    button.disabled = true;
    try {
      await setLanguage(getLanguage() === 'ar' ? 'en' : 'ar');
    } catch (error) {
      console.error('[i18n] language switch failed', error);
      toast(t('errors.locale'), { type: 'error' });
    } finally {
      button.disabled = false;
    }
  });

  $('#install-btn')?.addEventListener('click', async () => {
    if (!deferredPrompt) {
      toast(t('settings.install.unavailable'), { type: 'info', duration: 6000 });
      return;
    }
    const prompt = deferredPrompt;
    deferredPrompt = null;
    try {
      prompt.prompt();
      const choice = await prompt.userChoice;
      if (choice.outcome === 'accepted') {
        const btn = $('#install-btn');
        if (btn) btn.hidden = true;
        toast(t('common.installed'), { type: 'success' });
      }
    } catch (error) {
      console.error('[install] prompt failed', error);
    }
  });

  applyIcons(document);
}

/* ------------------------------------------------------------------ */
/* Live indicators                                                     */
/* ------------------------------------------------------------------ */

function syncBadges() {
  const state = getState();
  const counts = {
    history: state.history.length,
    favorites: state.favorites.length
  };
  document.querySelectorAll('[data-badge]').forEach((badge) => {
    const key = badge.getAttribute('data-badge');
    const count = counts[key] || 0;
    badge.textContent = count > 999 ? '999+' : String(count);
    badge.hidden = count === 0;
  });
}

function syncOnline() {
  const badge = $('#offline-badge');
  if (!badge) return;
  badge.hidden = navigator.onLine;
}

function bindNetwork() {
  syncOnline();
  window.addEventListener('online', () => {
    syncOnline();
    toast(t('toast.online'), { type: 'success' });
  });
  window.addEventListener('offline', () => {
    syncOnline();
    toast(t('toast.offline'), { type: 'warning', duration: 5000 });
  });
}

function bindStateEvents() {
  window.addEventListener('qs:state-changed', syncBadges);
  window.addEventListener('qs:settings-changed', () => {
    syncSidebar();
    syncThemeButton();
    syncLanguageButton();
  });
  window.addEventListener('themechange', syncThemeButton);

  window.addEventListener('languagechange', () => {
    apply(document);
    applyIcons(document);
    syncLanguageButton();
    syncSidebar();
    syncBadges();
    // Dynamic views are generated in JavaScript, so rebuild the active route
    // after the dictionary changes. First mount is owned by startRouter().
    if (currentRouteName()) refresh();
  });
}

/* ------------------------------------------------------------------ */
/* PWA                                                                 */
/* ------------------------------------------------------------------ */

let updateReloadPending = false;

function showUpdate(worker) {
  toast(t('toast.updateReady'), {
    type: 'info',
    duration: 0,
    actionLabel: t('toast.updateAction'),
    onAction: () => {
      if (updateReloadPending) return;
      updateReloadPending = true;
      // Reload only after the new worker takes control. Reloading on a fixed
      // timer can race activation and leave the old cache serving the page.
      navigator.serviceWorker.addEventListener('controllerchange', () => {
        if (updateReloadPending) location.reload();
      }, { once: true });
      try {
        worker.postMessage({ type: 'SKIP_WAITING' });
      } catch { /* ignore */ }
      // Safety net for browsers that activate without firing controllerchange.
      setTimeout(() => {
        if (updateReloadPending) location.reload();
      }, 5000);
    }
  });
}

async function registerServiceWorker() {
  if (!('serviceWorker' in navigator)) return;
  if (location.protocol !== 'https:' && location.protocol !== 'http:') return;
  try {
    const registration = await navigator.serviceWorker.register('./service-worker.js', { updateViaCache: 'none' });
    if (registration.waiting && navigator.serviceWorker.controller) {
      showUpdate(registration.waiting);
    }
    registration.addEventListener('updatefound', () => {
      const installing = registration.installing;
      if (!installing) return;
      installing.addEventListener('statechange', () => {
        if (installing.state === 'installed' && navigator.serviceWorker.controller) {
          showUpdate(installing);
        }
      });
    });
  } catch (error) {
    console.warn('[pwa] service worker registration failed', error);
  }
}

function bindInstallPrompt() {
  const button = $('#install-btn');
  if (!button) return;
  if (isStandalone()) button.hidden = true;

  window.addEventListener('beforeinstallprompt', (event) => {
    event.preventDefault();
    deferredPrompt = event;
    if (!isStandalone()) button.hidden = false;
  });

  window.addEventListener('appinstalled', () => {
    deferredPrompt = null;
    button.hidden = true;
    toast(t('common.installed'), { type: 'success' });
  });
}

/* ------------------------------------------------------------------ */
/* Keyboard shortcuts                                                  */
/* ------------------------------------------------------------------ */

function bindShortcuts() {
  document.addEventListener('keydown', (event) => {
    const target = event.target;
    const typing = target instanceof Element
      && /^(INPUT|TEXTAREA|SELECT)$/.test(target.tagName);

    if (event.key === 'Escape') {
      closeDrawer();
      return;
    }

    const mod = event.ctrlKey || event.metaKey;
    if (!mod) return;

    const key = String(event.key || '').toLowerCase();

    if (key === 'k' && !event.altKey) {
      const search = document.querySelector('#view .search-field input');
      if (search) {
        event.preventDefault();
        search.focus();
        if (typeof search.select === 'function') search.select();
      }
      return;
    }

    if (key === 's' && !event.altKey) {
      if (currentRouteName() === 'generator') {
        event.preventDefault();
        window.dispatchEvent(new CustomEvent('qs:save'));
      }
      return;
    }

    if (key === 'l' && event.shiftKey) {
      event.preventDefault();
      if (!typing) {
        setLanguage(getLanguage() === 'ar' ? 'en' : 'ar').catch(() => {
          toast(t('errors.locale'), { type: 'error' });
        });
      }
    }
  });
}

/* ------------------------------------------------------------------ */
/* Bootstrap                                                           */
/* ------------------------------------------------------------------ */

function applyVersion() {
  document.querySelectorAll('[data-app-version]').forEach((node) => {
    node.textContent = APP_VERSION;
  });
}

async function boot() {
  initTheme();
  try {
    await initLanguage();
  } catch (error) {
    console.error('[i18n] initial language failed', error);
    try {
      await setLanguage('en', { persist: false });
    } catch { /* the dictionary is unavailable; route markup still loads */ }
  }

  apply(document);
  applyVersion();
  bindShell();
  bindHeader();
  bindNetwork();
  bindStateEvents();
  bindInstallPrompt();
  bindShortcuts();
  syncSidebar();
  syncThemeButton();
  syncLanguageButton();
  syncBadges();
  syncOnline();

  try {
    await startRouter();
  } catch (error) {
    console.error('[router] boot failed', error);
  }

  registerServiceWorker();
  document.documentElement.classList.remove('is-booting');
}

boot();
