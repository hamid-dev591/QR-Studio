/** Local persistence for history, favorites, scans, activity and statistics. */
import {
  DEFAULT_STYLE, LIMITS, normalizeStyle, makeFingerprint, QR_TYPES
} from './config.js';
import { formatBytes, safeJsonParse, truncate, uid } from './utils.js';

export const STATE_KEY = 'qs.state.v1';
export const SETTINGS_KEY = 'qs.settings.v1';

export const DEFAULT_SETTINGS = {
  theme: 'dark',
  language: null,
  sidebarCollapsed: false,
  generatorPrefs: { ...DEFAULT_STYLE },
  lastBackupAt: null,
  installDismissed: false
};

function emptyState() {
  return {
    version: 1,
    history: [],
    favorites: [],
    scans: [],
    activity: [],
    stats: { generated: 0, scans: 0, createdAt: Date.now() },
    updatedAt: Date.now()
  };
}

function normalizeSettings(input) {
  const value = input && typeof input === 'object' ? input : {};
  return {
    theme: ['light', 'dark', 'system'].includes(value.theme) ? value.theme : DEFAULT_SETTINGS.theme,
    language: ['en', 'ar'].includes(value.language) ? value.language : null,
    sidebarCollapsed: Boolean(value.sidebarCollapsed),
    generatorPrefs: normalizeStyle({ ...DEFAULT_STYLE, ...(value.generatorPrefs || {}) }),
    lastBackupAt: Number(value.lastBackupAt) || null,
    installDismissed: Boolean(value.installDismissed)
  };
}

export function getSettings() {
  try {
    return normalizeSettings(safeJsonParse(localStorage.getItem(SETTINGS_KEY), {}));
  } catch {
    return normalizeSettings({});
  }
}

export function saveSettings(patch) {
  const current = getSettings();
  const next = normalizeSettings({ ...current, ...(patch || {}) });
  try {
    localStorage.setItem(SETTINGS_KEY, JSON.stringify(next));
  } catch {
    throw new Error('STORAGE_FULL');
  }
  window.dispatchEvent(new CustomEvent('qs:settings-changed', { detail: next }));
  return next;
}

export function normalizeRecord(input) {
  if (!input || typeof input !== 'object') return null;
  const type = QR_TYPES.includes(input.type) ? input.type : null;
  const payload = typeof input.payload === 'string' ? input.payload : '';
  if (!type || !payload) return null;
  const style = normalizeStyle(input.settings || input.style || {});
  const logoId = typeof input.logoId === 'string' && input.logoId ? input.logoId : null;
  const record = {
    id: typeof input.id === 'string' && input.id ? input.id.slice(0, 80) : uid('qr'),
    type,
    payload: payload.slice(0, 6000),
    label: truncate(String(input.label || '').trim(), 180) || type,
    fields: input.fields && typeof input.fields === 'object' ? input.fields : {},
    settings: style,
    logoId,
    createdAt: Number(input.createdAt) || Date.now(),
    updatedAt: Number(input.updatedAt) || null
  };
  record.fingerprint = makeFingerprint(record.payload, record.settings, record.logoId);
  return record;
}

function normalizeArray(value, limit) {
  if (!Array.isArray(value)) return [];
  return value.slice(0, limit);
}

export function getState() {
  let parsed = null;
  try {
    parsed = safeJsonParse(localStorage.getItem(STATE_KEY), null);
  } catch {
    parsed = null;
  }
  if (!parsed || typeof parsed !== 'object') return emptyState();
  const base = emptyState();
  return {
    version: 1,
    history: normalizeArray(parsed.history, LIMITS.history),
    favorites: normalizeArray(parsed.favorites, LIMITS.favorites),
    scans: normalizeArray(parsed.scans, LIMITS.scans),
    activity: normalizeArray(parsed.activity, LIMITS.activity),
    stats: {
      generated: Math.max(0, Number(parsed.stats?.generated) || 0),
      scans: Math.max(0, Number(parsed.stats?.scans) || 0),
      createdAt: Number(parsed.stats?.createdAt) || base.stats.createdAt
    },
    updatedAt: Number(parsed.updatedAt) || Date.now()
  };
}

function notify(action) {
  try {
    window.dispatchEvent(new CustomEvent('qs:state-changed', { detail: { action } }));
  } catch { /* non-browser context */ }
}

function writeState(state, action = 'update') {
  const next = { ...state, version: 1, updatedAt: Date.now() };
  try {
    localStorage.setItem(STATE_KEY, JSON.stringify(next));
  } catch (error) {
    throw new Error('STORAGE_FULL');
  }
  notify(action);
  return next;
}

function pushActivity(state, entry) {
  state.activity = [
    {
      id: uid('act'),
      kind: entry.kind || 'generate',
      type: entry.type || null,
      label: truncate(String(entry.label || ''), 120),
      recordId: entry.recordId || null,
      count: Number(entry.count) || null,
      at: Date.now()
    },
    ...(Array.isArray(state.activity) ? state.activity : [])
  ].slice(0, LIMITS.activity);
}

function retryWithTrim(state, commit, isRecordAddition) {
  try {
    return commit(state);
  } catch (error) {
    if (error.message !== 'STORAGE_FULL' || !isRecordAddition) throw error;
    for (const cap of [50, 20]) {
      if (state.history.length <= cap) continue;
      state.history = state.history.slice(0, cap);
      try {
        return commit(state);
      } catch (inner) {
        if (inner.message !== 'STORAGE_FULL') throw inner;
      }
    }
    throw error;
  }
}

export function saveRecord(record, options = {}) {
  const normalized = normalizeRecord(record);
  if (!normalized) throw new Error('INVALID_RECORD');
  const state = getState();
  const index = state.history.findIndex(
    (item) => item.id === normalized.id || item.fingerprint === normalized.fingerprint
  );

  if (index >= 0) {
    const existing = state.history[index];
    const merged = {
      ...normalized,
      id: existing.id,
      createdAt: existing.createdAt,
      updatedAt: Date.now()
    };
    state.history.splice(index, 1);
    state.history.unshift(merged);
    const next = writeState(state, 'history-update');
    return { record: merged, isNew: false, state: next };
  }

  state.history.unshift(normalized);
  state.history = state.history.slice(0, LIMITS.history);
  state.stats.generated += 1;
  pushActivity(state, {
    kind: options.activityKind || 'generate',
    type: normalized.type,
    label: normalized.label,
    recordId: normalized.id
  });
  const next = retryWithTrim(state, (value) => writeState(value, 'history-add'), true);
  return { record: normalized, isNew: true, state: next };
}

export function updateRecord(id, patch = {}) {
  if (!id) return null;
  const state = getState();
  let updated = null;
  let oldFingerprint = null;
  state.history = state.history.map((item) => {
    if (item.id !== id) return item;
    oldFingerprint = item.fingerprint;
    updated = normalizeRecord({ ...item, ...patch, id: item.id, createdAt: item.createdAt, updatedAt: Date.now() });
    return updated || item;
  });
  if (updated) {
    state.favorites = state.favorites.map((item) => {
      if (item.id !== id && item.fingerprint !== oldFingerprint) return item;
      return { ...updated, createdAt: item.createdAt, favoritedAt: item.favoritedAt };
    });
    pushActivity(state, {
      kind: 'edit', type: updated.type, label: updated.label, recordId: updated.id
    });
    writeState(state, 'record-update');
  }
  return updated;
}

export function deleteHistory(id) {
  const state = getState();
  const index = state.history.findIndex((item) => item.id === id);
  if (index < 0) return null;
  const [removed] = state.history.splice(index, 1);
  pushActivity(state, { kind: 'delete', type: removed.type, label: removed.label, recordId: removed.id });
  writeState(state, 'history-delete');
  return { record: removed, index };
}

export function restoreHistory(record, index = 0) {
  const normalized = normalizeRecord(record);
  if (!normalized) return false;
  const state = getState();
  if (!state.history.some((item) => item.id === normalized.id || item.fingerprint === normalized.fingerprint)) {
    state.history.splice(Math.min(index, state.history.length), 0, normalized);
    state.history = state.history.slice(0, LIMITS.history);
    writeState(state, 'history-restore');
  }
  return true;
}

export function clearHistory() {
  const state = getState();
  state.history = [];
  pushActivity(state, { kind: 'clear', label: 'history' });
  writeState(state, 'history-clear');
}

export function getHistory() {
  return getState().history;
}

export function getFavorites() {
  return getState().favorites;
}

export function isFavorite(record) {
  if (!record) return false;
  const favorites = getFavorites();
  return favorites.some((item) => item.id === record.id || item.fingerprint === record.fingerprint);
}

export function toggleFavorite(record) {
  const normalized = normalizeRecord(record);
  if (!normalized) throw new Error('INVALID_RECORD');
  const state = getState();
  const index = state.favorites.findIndex(
    (item) => item.id === normalized.id || item.fingerprint === normalized.fingerprint
  );
  if (index >= 0) {
    state.favorites.splice(index, 1);
    writeState(state, 'favorite-remove');
    return false;
  }
  if (state.favorites.length >= LIMITS.favorites) throw new Error('FAVORITES_LIMIT');
  state.favorites.unshift({ ...normalized, favoritedAt: Date.now() });
  pushActivity(state, {
    kind: 'favorite', type: normalized.type, label: normalized.label, recordId: normalized.id
  });
  writeState(state, 'favorite-add');
  return true;
}

export function deleteFavorite(id) {
  const state = getState();
  const index = state.favorites.findIndex((item) => item.id === id);
  if (index < 0) return null;
  const [removed] = state.favorites.splice(index, 1);
  writeState(state, 'favorite-delete');
  return { record: removed, index };
}

export function restoreFavorite(record, index = 0) {
  const normalized = normalizeRecord(record);
  if (!normalized) return false;
  const state = getState();
  if (!state.favorites.some((item) => item.id === normalized.id || item.fingerprint === normalized.fingerprint)) {
    state.favorites.splice(Math.min(index, state.favorites.length), 0, { ...normalized, favoritedAt: Date.now() });
    writeState(state, 'favorite-restore');
  }
  return true;
}

export function clearFavorites() {
  const state = getState();
  state.favorites = [];
  pushActivity(state, { kind: 'clear', label: 'favorites' });
  writeState(state, 'favorites-clear');
}

export function addScan(scan) {
  const content = String(scan?.content || '').slice(0, 4000);
  if (!content) throw new Error('INVALID_SCAN');
  const state = getState();
  const record = {
    id: uid('scan'),
    content,
    type: String(scan.type || 'text').slice(0, 32),
    at: Date.now()
  };
  state.scans.unshift(record);
  state.scans = state.scans.slice(0, LIMITS.scans);
  state.stats.scans += 1;
  pushActivity(state, {
    kind: 'scan', type: record.type, label: truncate(content.replace(/\s+/g, ' '), 80)
  });
  writeState(state, 'scan-add');
  return record;
}

export function getScans() {
  return getState().scans;
}

export function clearScans() {
  const state = getState();
  state.scans = [];
  writeState(state, 'scans-clear');
}

export function getActivity() {
  return getState().activity;
}

export function getStats() {
  return getState().stats;
}

export function recordBatch(count, failed = 0) {
  const total = Math.max(0, Number(count) || 0);
  if (!total) return;
  const state = getState();
  state.stats.generated += total;
  pushActivity(state, {
    kind: 'batch',
    label: total === 1 ? '1 QR' : `${total} QR`,
    count: total
  });
  writeState(state, 'batch');
}

export function exportData() {
  return { state: getState(), settings: getSettings() };
}

export function replaceData(next, { settings = null } = {}) {
  if (!next || typeof next !== 'object') throw new Error('INVALID_STATE');
  const state = {
    version: 1,
    history: normalizeArray(next.history, LIMITS.history),
    favorites: normalizeArray(next.favorites, LIMITS.favorites),
    scans: normalizeArray(next.scans, LIMITS.scans),
    activity: normalizeArray(next.activity, LIMITS.activity),
    stats: {
      generated: Math.max(0, Number(next.stats?.generated) || 0),
      scans: Math.max(0, Number(next.stats?.scans) || 0),
      createdAt: Number(next.stats?.createdAt) || Date.now()
    },
    updatedAt: Date.now()
  };
  writeState(state, 'replace');
  if (settings) {
    const current = getSettings();
    saveSettings({ ...current, ...settings });
  }
}

export function getStorageMetrics() {
  let bytes = 0;
  let keys = 0;
  try {
    for (let i = 0; i < localStorage.length; i++) {
      const key = localStorage.key(i);
      if (!key) continue;
      keys++;
      bytes += (key.length + (localStorage.getItem(key) || '').length) * 2;
    }
  } catch { /* unavailable */ }
  const state = getState();
  return {
    bytes,
    formatted: formatBytes(bytes),
    keys,
    history: state.history.length,
    favorites: state.favorites.length,
    scans: state.scans.length,
    generated: state.stats.generated,
    scanCount: state.stats.scans
  };
}

export async function getStorageEstimate() {
  try {
    if (navigator.storage && typeof navigator.storage.estimate === 'function') {
      const estimate = await navigator.storage.estimate();
      return { usage: estimate.usage || 0, quota: estimate.quota || 0 };
    }
  } catch { /* ignore */ }
  return { usage: 0, quota: 0 };
}

export function clearLocalData() {
  try {
    localStorage.removeItem(STATE_KEY);
    localStorage.removeItem(SETTINGS_KEY);
  } catch { /* ignore */ }
  notify('clear-all');
}

export function addActivity(kind, data = {}) {
  const state = getState();
  pushActivity(state, { ...data, kind });
  writeState(state, 'activity');
}

// Keep other open tabs coherent without refreshing the current form.
if (typeof window !== 'undefined') {
  window.addEventListener('storage', (event) => {
    if (event.key === STATE_KEY || event.key === SETTINGS_KEY) {
      window.dispatchEvent(new CustomEvent('qs:state-changed', { detail: { action: 'external' } }));
    }
  });
}
