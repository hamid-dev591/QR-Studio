/** Small, dependency-free helpers shared across QR Studio. */

export const $ = (selector, root = document) => root.querySelector(selector);
export const $$ = (selector, root = document) => Array.from(root.querySelectorAll(selector));

export function escapeHtml(value) {
  return String(value ?? '')
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#39;');
}

export function escapeAttr(value) {
  return escapeHtml(value).replaceAll('`', '&#96;');
}

export function uid(prefix = 'id') {
  const raw = typeof crypto !== 'undefined' && crypto.randomUUID
    ? crypto.randomUUID().replaceAll('-', '').slice(0, 16)
    : Math.random().toString(36).slice(2, 10) + Date.now().toString(36);
  return `${prefix}_${raw}`;
}

export function debounce(fn, wait = 150) {
  let timer;
  const debounced = (...args) => {
    clearTimeout(timer);
    timer = setTimeout(() => fn(...args), wait);
  };
  debounced.cancel = () => clearTimeout(timer);
  debounced.flush = (...args) => {
    clearTimeout(timer);
    fn(...args);
  };
  return debounced;
}

export function throttle(fn, wait = 100) {
  let last = 0;
  let timer = null;
  let lastArgs = null;
  return (...args) => {
    const now = Date.now();
    const remaining = wait - (now - last);
    lastArgs = args;
    if (remaining <= 0) {
      last = now;
      fn(...args);
    } else if (!timer) {
      timer = setTimeout(() => {
        last = Date.now();
        timer = null;
        fn(...lastArgs);
      }, remaining);
    }
  };
}

/** Yield to the event loop so large jobs never freeze the UI. */
export function yieldToMain() {
  if (typeof scheduler !== 'undefined' && typeof scheduler.yield === 'function') {
    return scheduler.yield();
  }
  return new Promise((resolve) => setTimeout(resolve, 0));
}

export function clamp(value, min, max) {
  const num = Number(value);
  if (!Number.isFinite(num)) return min;
  return Math.min(max, Math.max(min, num));
}

export function localeFor(lang) {
  return lang === 'ar' ? 'ar-u-nu-latn' : 'en';
}

export function formatDate(timestamp, lang = 'en', opts = {}) {
  const date = new Date(timestamp);
  if (Number.isNaN(date.getTime())) return '';
  try {
    return new Intl.DateTimeFormat(localeFor(lang), {
      dateStyle: 'medium',
      timeStyle: 'short',
      ...opts
    }).format(date);
  } catch {
    return date.toLocaleString();
  }
}

export function formatDateShort(timestamp, lang = 'en') {
  return formatDate(timestamp, lang, { dateStyle: 'medium', timeStyle: undefined });
}

export function relativeTime(timestamp, lang = 'en') {
  const diff = Date.now() - Number(timestamp || 0);
  const rtf = new Intl.RelativeTimeFormat(localeFor(lang), { numeric: 'auto' });
  const seconds = Math.round(diff / 1000);
  if (Math.abs(seconds) < 45) return rtf.format(0, 'second');
  const minutes = Math.round(seconds / 60);
  if (Math.abs(minutes) < 55) return rtf.format(-minutes, 'minute');
  const hours = Math.round(minutes / 60);
  if (Math.abs(hours) < 23) return rtf.format(-hours, 'hour');
  const days = Math.round(hours / 24);
  if (Math.abs(days) < 30) return rtf.format(-days, 'day');
  const months = Math.round(days / 30);
  if (Math.abs(months) < 12) return rtf.format(-months, 'month');
  return rtf.format(-Math.round(months / 12), 'year');
}

export function formatNumber(value, lang = 'en') {
  try {
    return new Intl.NumberFormat(localeFor(lang)).format(Number(value) || 0);
  } catch {
    return String(value);
  }
}

export function formatBytes(bytes) {
  const value = Number(bytes) || 0;
  if (value < 1024) return `${value} B`;
  const units = ['KB', 'MB', 'GB'];
  let size = value / 1024;
  let i = 0;
  while (size >= 1024 && i < units.length - 1) {
    size /= 1024;
    i++;
  }
  return `${size.toFixed(size >= 10 ? 0 : 1)} ${units[i]}`;
}

export function safeJsonParse(text, fallback = null) {
  try {
    return JSON.parse(text);
  } catch {
    return fallback;
  }
}

export function downloadBlob(blob, filename) {
  if (!(blob instanceof Blob) || blob.size === 0) {
    throw new Error('EMPTY_BLOB');
  }
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  a.rel = 'noopener';
  a.style.display = 'none';
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 4000);
}

export function readFileAsText(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result || ''));
    reader.onerror = () => reject(reader.error || new Error('READ_FAILED'));
    reader.readAsText(file);
  });
}

export function readFileAsDataURL(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result || ''));
    reader.onerror = () => reject(reader.error || new Error('READ_FAILED'));
    reader.readAsDataURL(file);
  });
}

export function readFileAsArrayBuffer(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result);
    reader.onerror = () => reject(reader.error || new Error('READ_FAILED'));
    reader.readAsArrayBuffer(file);
  });
}

const scriptCache = new Map();

/** Load a locally bundled UMD library on demand. */
export function loadScript(src, globalName) {
  if (globalName && window[globalName]) return Promise.resolve(window[globalName]);
  if (scriptCache.has(src)) return scriptCache.get(src);
  const promise = new Promise((resolve, reject) => {
    const script = document.createElement('script');
    script.src = src;
    script.async = true;
    script.onload = () => {
      if (globalName && !window[globalName]) {
        reject(new Error(`LIBRARY_MISSING:${globalName}`));
        return;
      }
      resolve(globalName ? window[globalName] : true);
    };
    script.onerror = () => reject(new Error(`SCRIPT_FAILED:${src}`));
    document.head.appendChild(script);
  });
  scriptCache.set(src, promise);
  promise.catch(() => scriptCache.delete(src));
  return promise;
}

export function dataUrlToBlob(dataUrl) {
  const match = /^data:([^;,]+)?(;base64)?,(.*)$/s.exec(String(dataUrl || ''));
  if (!match) throw new Error('INVALID_DATA_URL');
  const mime = match[1] || 'application/octet-stream';
  const isBase64 = Boolean(match[2]);
  const data = isBase64 ? atob(match[3]) : decodeURIComponent(match[3]);
  const bytes = new Uint8Array(data.length);
  for (let i = 0; i < data.length; i++) bytes[i] = data.charCodeAt(i);
  return new Blob([bytes], { type: mime });
}

export function blobToDataUrl(blob) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result || ''));
    reader.onerror = () => reject(reader.error || new Error('READ_FAILED'));
    reader.readAsDataURL(blob);
  });
}

export async function copyText(text) {
  const value = String(text ?? '');
  if (navigator.clipboard && window.isSecureContext) {
    try {
      await navigator.clipboard.writeText(value);
      return;
    } catch {
      // Permission or focus failures fall back to the legacy path below.
    }
  }
  const area = document.createElement('textarea');
  area.value = value;
  area.setAttribute('readonly', '');
  area.style.position = 'fixed';
  area.style.opacity = '0';
  area.style.pointerEvents = 'none';
  document.body.appendChild(area);
  area.select();
  const ok = document.execCommand('copy');
  area.remove();
  if (!ok) throw new Error('COPY_FAILED');
}

export function sanitizeFilename(name, fallback = 'qr-code') {
  let value = String(name || '')
    .normalize('NFC')
    .replace(/[\u0000-\u001f\u007f<>:"/\\|?*]/g, '-')
    .replace(/\s+/g, ' ')
    .replace(/^[. ]+|[. ]+$/g, '')
    .slice(0, 80)
    .trim();
  if (!value) value = fallback;
  return value;
}

export function uniqueFilename(base, extension, used) {
  const ext = String(extension || 'png').replace(/^\./, '').toLowerCase();
  let candidate = `${base}.${ext}`;
  let i = 2;
  while (used.has(candidate.toLowerCase())) {
    candidate = `${base}-${i}.${ext}`;
    i++;
  }
  used.add(candidate.toLowerCase());
  return candidate;
}

export function stripExtension(filename) {
  return String(filename || '').replace(/\.[a-z0-9]{2,5}$/i, '');
}

export function truncate(text, max = 80) {
  const value = String(text ?? '');
  return value.length > max ? `${value.slice(0, max - 1)}…` : value;
}

export function safeHttpUrl(value) {
  try {
    const url = new URL(String(value || '').trim());
    if (url.protocol !== 'http:' && url.protocol !== 'https:') return null;
    return url;
  } catch {
    return null;
  }
}

export function domainOf(value) {
  const url = safeHttpUrl(value);
  return url ? url.hostname : '';
}

export function hexToRgb(hex) {
  const match = /^#?([0-9a-f]{6})$/i.exec(String(hex || ''));
  if (!match) return null;
  const int = parseInt(match[1], 16);
  return { r: (int >> 16) & 255, g: (int >> 8) & 255, b: int & 255 };
}

export function relativeLuminance(hex) {
  const rgb = hexToRgb(hex);
  if (!rgb) return 0;
  const channel = (v) => {
    const c = v / 255;
    return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
  };
  return 0.2126 * channel(rgb.r) + 0.7152 * channel(rgb.g) + 0.0722 * channel(rgb.b);
}

export function contrastRatio(a, b) {
  const l1 = relativeLuminance(a);
  const l2 = relativeLuminance(b);
  const light = Math.max(l1, l2);
  const dark = Math.min(l1, l2);
  return (light + 0.05) / (dark + 0.05);
}

export function isDarkColor(hex) {
  return relativeLuminance(hex) < 0.25;
}

export function waitForImage(img) {
  if (img.complete && img.naturalWidth) return Promise.resolve(img);
  return new Promise((resolve, reject) => {
    img.onload = () => resolve(img);
    img.onerror = () => reject(new Error('IMAGE_LOAD_FAILED'));
  });
}

export function raf() {
  return new Promise((resolve) => requestAnimationFrame(resolve));
}

export function cssEscape(value) {
  if (window.CSS && typeof CSS.escape === 'function') return CSS.escape(String(value));
  return String(value).replace(/[^a-zA-Z0-9_-]/g, (ch) => `\\${ch}`);
}

export function todayStamp() {
  const d = new Date();
  const pad = (n) => String(n).padStart(2, '0');
  return `${d.getFullYear()}${pad(d.getMonth() + 1)}${pad(d.getDate())}-${pad(d.getHours())}${pad(d.getMinutes())}`;
}

export function looksLikeBase64DataUrl(value, allowedMime = []) {
  const match = /^data:([^;,]+)?(;base64)?,/i.exec(String(value || ''));
  if (!match) return false;
  const mime = (match[1] || '').toLowerCase();
  return allowedMime.length === 0 || allowedMime.includes(mime);
}
