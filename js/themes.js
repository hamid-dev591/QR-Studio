/** Theme handling with persistence and no first-paint flash. */
import { getSettings, saveSettings } from './storage.js';

const media = typeof matchMedia === 'function'
  ? matchMedia('(prefers-color-scheme: dark)')
  : null;

let preference = 'dark';

function effective(theme = preference) {
  if (theme === 'system') return media && media.matches ? 'dark' : 'light';
  return theme === 'light' ? 'light' : 'dark';
}

function paint() {
  const resolved = effective();
  document.documentElement.dataset.theme = resolved;
  document.documentElement.dataset.themePreference = preference;
  const meta = document.querySelector('meta[name="theme-color"]');
  if (meta) meta.setAttribute('content', resolved === 'dark' ? '#0a0910' : '#f6f5fb');
  window.dispatchEvent(new CustomEvent('themechange', {
    detail: { theme: resolved, preference }
  }));
}

export function applyTheme(theme = preference) {
  preference = ['light', 'dark', 'system'].includes(theme) ? theme : 'dark';
  paint();
}

export function initTheme() {
  applyTheme(getSettings().theme || 'dark');
  if (media) {
    const onChange = () => {
      if (preference === 'system') paint();
    };
    if (typeof media.addEventListener === 'function') media.addEventListener('change', onChange);
    else if (typeof media.addListener === 'function') media.addListener(onChange);
  }
}

export function setTheme(theme, { persist = true } = {}) {
  applyTheme(theme);
  if (persist) saveSettings({ theme: preference });
  return preference;
}

export function toggleTheme() {
  const next = effective() === 'dark' ? 'light' : 'dark';
  return setTheme(next);
}

export function getThemePreference() {
  return preference;
}

export function getEffectiveTheme() {
  return effective();
}
