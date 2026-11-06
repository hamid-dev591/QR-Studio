/** Tiny JSON-based i18n with full RTL support. */
import { getSettings, saveSettings } from './storage.js';

const dictionaries = new Map();
const missing = new Set();
let currentLanguage = 'en';
let dictionary = {};
let fallback = {};

function lookup(source, key) {
  if (!source) return undefined;
  return String(key).split('.').reduce((value, part) => (
    value && typeof value === 'object' ? value[part] : undefined
  ), source);
}

function interpolate(template, params) {
  if (!params) return template;
  // Locales use {{name}} placeholders; accept single braces for convenience.
  return String(template).replace(/\{\{\s*(\w+)\s*\}\}|\{(\w+)\}/g, (match, doubleKey, singleKey) => {
    const key = doubleKey || singleKey;
    return Object.prototype.hasOwnProperty.call(params, key) ? String(params[key]) : match;
  });
}

export function hasKey(key) {
  return lookup(dictionary, key) !== undefined || lookup(fallback, key) !== undefined;
}

export function t(key, params) {
  let value = lookup(dictionary, key);
  if (value === undefined) {
    value = lookup(fallback, key);
    if (value === undefined) {
      if (!missing.has(key)) {
        missing.add(key);
        if (location.hostname === 'localhost' || location.hostname === '127.0.0.1') {
          console.warn(`[i18n] Missing key: ${key}`);
        }
      }
      return key;
    }
  }
  return typeof value === 'string' ? interpolate(value, params) : value;
}

async function fetchLocale(lang) {
  if (dictionaries.has(lang)) return dictionaries.get(lang);
  const response = await fetch(`./locales/${lang}.json`, { credentials: 'same-origin' });
  if (!response.ok) throw new Error(`LOCALE_LOAD_FAILED:${lang}`);
  const json = await response.json();
  dictionaries.set(lang, json);
  return json;
}

export function apply(root = document) {
  if (!root || !root.querySelectorAll) return;
  root.querySelectorAll('[data-i18n]').forEach((node) => {
    const key = node.getAttribute('data-i18n');
    if (!key) return;
    node.textContent = t(key);
  });
  root.querySelectorAll('[data-i18n-placeholder]').forEach((node) => {
    node.setAttribute('placeholder', t(node.getAttribute('data-i18n-placeholder')));
  });
  root.querySelectorAll('[data-i18n-title]').forEach((node) => {
    node.setAttribute('title', t(node.getAttribute('data-i18n-title')));
  });
  root.querySelectorAll('[data-i18n-aria-label]').forEach((node) => {
    node.setAttribute('aria-label', t(node.getAttribute('data-i18n-aria-label')));
  });
  root.querySelectorAll('[data-i18n-value]').forEach((node) => {
    node.setAttribute('value', t(node.getAttribute('data-i18n-value')));
  });
}

export function getLanguage() {
  return currentLanguage;
}

export function isRtl() {
  return currentLanguage === 'ar';
}

export function setDirection(lang) {
  const rtl = lang === 'ar';
  document.documentElement.lang = lang;
  document.documentElement.dir = rtl ? 'rtl' : 'ltr';
  document.documentElement.setAttribute('data-lang', lang);
}

export async function setLanguage(lang, { persist = true } = {}) {
  const next = lang === 'ar' ? 'ar' : 'en';
  const nextDictionary = await fetchLocale(next);
  currentLanguage = next;
  dictionary = nextDictionary;
  if (!fallback || !Object.keys(fallback).length) {
    try {
      fallback = next === 'en' ? nextDictionary : await fetchLocale('en');
    } catch {
      fallback = nextDictionary;
    }
  }
  setDirection(next);
  if (persist) saveSettings({ language: next });
  apply(document);
  window.dispatchEvent(new CustomEvent('languagechange', { detail: { language: next } }));
  return next;
}

export async function initLanguage() {
  const settings = getSettings();
  const browserLang = (navigator.language || 'en').toLowerCase().startsWith('ar') ? 'ar' : 'en';
  const lang = settings.language || browserLang;
  setDirection(lang);
  try {
    await setLanguage(lang, { persist: false });
  } catch (error) {
    currentLanguage = 'en';
    dictionary = {};
    fallback = {};
    setDirection('en');
    throw error;
  }
  return lang;
}

export async function toggleLanguage() {
  return setLanguage(currentLanguage === 'ar' ? 'en' : 'ar');
}
