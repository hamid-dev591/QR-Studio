/** Backup export/import with validation, merge or replace, safety snapshots and undo. */
import { LIMITS, SCHEMA_VERSION } from './config.js';
import { clearLogos, getAllLogos, putLogo } from './db.js';
import { getLanguage, setLanguage, t } from './i18n.js';
import { refresh } from './router.js';
import {
  exportData, getState, normalizeRecord, replaceData, saveSettings
} from './storage.js';
import { applyTheme } from './themes.js';
import { openModal, toast } from './ui.js';
import { downloadBlob, readFileAsText, todayStamp, uid } from './utils.js';

const APP_MARKER = 'QR Studio';
const KIND_MARKER = 'qr-studio-backup';
const SAFETY_KEY = 'qs.backup.safety.v1';
let memorySafety = null;

function fail(code) {
  return Object.assign(new Error(code), { code });
}

function normalizeBackupState(input) {
  const source = input && typeof input === 'object' ? input : {};
  const history = Array.isArray(source.history)
    ? source.history.map(normalizeRecord).filter(Boolean).slice(0, LIMITS.history)
    : [];
  const favorites = Array.isArray(source.favorites)
    ? source.favorites.map(normalizeRecord).filter(Boolean).slice(0, LIMITS.favorites)
    : [];
  const scans = Array.isArray(source.scans)
    ? source.scans
      .filter((scan) => scan && typeof scan.content === 'string' && scan.content.trim())
      .slice(0, LIMITS.scans)
      .map((scan) => ({
        id: typeof scan.id === 'string' && scan.id ? scan.id.slice(0, 80) : uid('scan'),
        content: String(scan.content).slice(0, 4000),
        type: typeof scan.type === 'string' ? scan.type.slice(0, 32) : 'text',
        at: Number(scan.at) || Date.now()
      }))
    : [];
  const activity = Array.isArray(source.activity)
    ? source.activity
      .filter((entry) => entry && typeof entry === 'object')
      .slice(0, LIMITS.activity)
      .map((entry) => ({
        id: typeof entry.id === 'string' && entry.id ? entry.id.slice(0, 80) : uid('act'),
        kind: typeof entry.kind === 'string' ? entry.kind.slice(0, 24) : 'generic',
        type: typeof entry.type === 'string' ? entry.type.slice(0, 32) : null,
        label: String(entry.label || '').slice(0, 120),
        recordId: typeof entry.recordId === 'string' ? entry.recordId.slice(0, 80) : null,
        count: Number(entry.count) || null,
        at: Number(entry.at) || Date.now()
      }))
    : [];
  return {
    version: 1,
    history,
    favorites,
    scans,
    activity,
    stats: {
      generated: Math.max(0, Number(source.stats?.generated) || 0),
      scans: Math.max(0, Number(source.stats?.scans) || 0),
      createdAt: Number(source.stats?.createdAt) || Date.now()
    },
    updatedAt: Number(source.updatedAt) || Date.now()
  };
}

function normalizeBackupLogo(input) {
  if (!input || typeof input !== 'object') return null;
  const id = typeof input.id === 'string' ? input.id.slice(0, 80) : '';
  const dataUrl = typeof input.dataUrl === 'string' ? input.dataUrl : '';
  if (!id || !/^data:image\/(png|jpe?g|svg\+xml)/i.test(dataUrl)) return null;
  if (dataUrl.length > LIMITS.logoBytes * 3) return null;
  return {
    id,
    name: String(input.name || 'logo').slice(0, 120),
    mime: String(input.mime || 'image/png').slice(0, 80),
    dataUrl,
    size: dataUrl.length,
    createdAt: Number(input.createdAt) || Date.now()
  };
}

export function validateBackup(raw) {
  if (!raw || typeof raw !== 'object') throw fail('INVALID');
  if (raw.app && raw.app !== APP_MARKER) throw fail('INVALID');
  if (raw.kind && raw.kind !== KIND_MARKER) throw fail('INVALID');

  const version = Number(raw.version || raw.state?.version || 1);
  if (Number.isFinite(version) && version > SCHEMA_VERSION) throw fail('VERSION');

  const looksLikeRawState = Array.isArray(raw.history) || Array.isArray(raw.favorites);
  const sourceState = raw.state && typeof raw.state === 'object'
    ? raw.state
    : looksLikeRawState
      ? raw
      : null;
  if (!sourceState) throw fail('INVALID');

  const state = normalizeBackupState(sourceState);
  const logs = Array.isArray(raw.logos)
    ? raw.logos.map(normalizeBackupLogo).filter(Boolean)
    : [];
  const settings = raw.settings && typeof raw.settings === 'object' ? raw.settings : null;

  const counts = {
    history: state.history.length,
    favorites: state.favorites.length,
    scans: state.scans.length,
    logos: logs.length,
    settings: Boolean(settings)
  };
  if (!counts.history && !counts.favorites && !counts.scans && !counts.logos && !counts.settings) {
    throw fail('EMPTY');
  }
  return {
    state,
    settings,
    logos: logs,
    counts,
    version,
    exportedAt: Number(raw.exportedAt) || null
  };
}

export async function exportBackup() {
  const data = exportData();
  const logos = await getAllLogos();
  const payload = {
    app: APP_MARKER,
    kind: KIND_MARKER,
    version: SCHEMA_VERSION,
    exportedAt: Date.now(),
    state: data.state,
    settings: data.settings,
    logos: logos.map((logo) => ({
      id: logo.id,
      name: logo.name,
      mime: logo.mime,
      dataUrl: logo.dataUrl,
      createdAt: logo.createdAt
    }))
  };
  const json = JSON.stringify(payload, null, 2);
  const bytes = new Blob([json]).size;
  if (bytes > LIMITS.backupBytes) throw fail('TOO_LARGE');
  downloadBlob(new Blob([json], { type: 'application/json' }), `qr-studio-backup-${todayStamp()}.json`);
  saveSettings({ lastBackupAt: Date.now() });
  return { bytes, filename: `qr-studio-backup-${todayStamp()}.json` };
}

export async function readBackupFile(file) {
  if (!file) throw fail('READ_FAILED');
  if (file.size > LIMITS.backupBytes) throw fail('TOO_LARGE');
  if (file.type && file.type !== 'application/json' && file.type !== 'text/plain'
    && !/\.json$/i.test(file.name || '')) {
    throw fail('INVALID');
  }
  let text;
  try {
    text = await readFileAsText(file);
  } catch {
    throw fail('READ_FAILED');
  }
  let raw;
  try {
    raw = JSON.parse(text);
  } catch {
    throw fail('JSON');
  }
  return validateBackup(raw);
}

function sameRecord(a, b) {
  return a.id === b.id || (a.fingerprint && a.fingerprint === b.fingerprint);
}

function mergeArrays(current, incoming, limit) {
  const output = (Array.isArray(current) ? current : []).slice();
  for (const item of incoming) {
    if (!output.some((existing) => sameRecord(existing, item))) output.push(item);
    if (output.length >= limit) break;
  }
  return output.slice(0, limit);
}

function mergeScans(current, incoming) {
  const output = (Array.isArray(current) ? current : []).slice();
  const keys = new Set(output.map((scan) => `${scan.content}\u0000${scan.at}`));
  for (const scan of incoming) {
    const key = `${scan.content}\u0000${scan.at}`;
    if (!keys.has(key)) {
      keys.add(key);
      output.push(scan);
    }
    if (output.length >= LIMITS.scans) break;
  }
  return output.slice(0, LIMITS.scans);
}

function mergeStates(current, incoming) {
  return {
    version: 1,
    history: mergeArrays(current.history, incoming.history, LIMITS.history),
    favorites: mergeArrays(current.favorites, incoming.favorites, LIMITS.favorites),
    scans: mergeScans(current.scans, incoming.scans),
    activity: current.activity.slice(0, LIMITS.activity),
    stats: {
      generated: Math.max(Number(current.stats?.generated) || 0, incoming.stats.generated),
      scans: Math.max(Number(current.stats?.scans) || 0, incoming.stats.scans),
      createdAt: Math.min(
        Number(current.stats?.createdAt) || Date.now(),
        incoming.stats.createdAt
      )
    },
    updatedAt: Date.now()
  };
}

async function snapshotCurrent() {
  const data = exportData();
  const snapshot = {
    state: data.state,
    settings: data.settings,
    logos: await getAllLogos()
  };
  memorySafety = snapshot;
  try {
    sessionStorage.setItem(SAFETY_KEY, JSON.stringify(snapshot));
  } catch {
    // The in-memory snapshot still allows Undo during this session.
  }
  return snapshot;
}

function readSafety() {
  if (memorySafety) return memorySafety;
  try {
    const raw = sessionStorage.getItem(SAFETY_KEY);
    return raw ? JSON.parse(raw) : null;
  } catch {
    return null;
  }
}

function clearSafety() {
  memorySafety = null;
  try { sessionStorage.removeItem(SAFETY_KEY); } catch { /* ignore */ }
}

async function applyAppearance(settings) {
  if (!settings) return;
  if (['light', 'dark', 'system'].includes(settings.theme)) {
    applyTheme(settings.theme);
  }
  if ((settings.language === 'ar' || settings.language === 'en')
    && settings.language !== getLanguage()) {
    try {
      await setLanguage(settings.language, { persist: false });
    } catch { /* dictionary load failure is non-fatal for the import */ }
  }
}

async function writeLogos(logos) {
  for (const logo of logos) {
    try {
      await putLogo(logo);
    } catch {
      // A logo that cannot be stored must not abort the whole import.
    }
  }
}

export async function restoreSafetySnapshot() {
  const snapshot = readSafety();
  if (!snapshot) {
    toast(t('backup.undone'), { type: 'warning' });
    return false;
  }
  replaceData(snapshot.state, { settings: snapshot.settings });
  await clearLogos();
  await writeLogos(snapshot.logos || []);
  await applyAppearance(snapshot.settings);
  clearSafety();
  toast(t('backup.undone'), { type: 'success' });
  refresh();
  return true;
}

async function importBackup(backup, mode) {
  const current = getState();
  if (mode === 'replace') {
    await snapshotCurrent();
    replaceData(backup.state, { settings: backup.settings });
    await clearLogos();
    await writeLogos(backup.logos);
    await applyAppearance(backup.settings);
  } else {
    const merged = mergeStates(current, backup.state);
    replaceData(merged);
    await writeLogos(backup.logos);
  }
  const counts = {
    history: backup.state.history.length,
    favorites: backup.state.favorites.length,
    scans: backup.state.scans.length
  };
  const message = t(mode === 'replace' ? 'backup.successReplace' : 'backup.successMerge', counts);
  toast(message, {
    type: 'success',
    duration: mode === 'replace' ? 10000 : 4800,
    actionLabel: mode === 'replace' ? t('backup.undo') : '',
    onAction: mode === 'replace' ? () => { restoreSafetySnapshot(); } : null
  });
  return { imported: true, mode, counts };
}

function summaryMarkup(backup) {
  const { counts } = backup;
  return `<div class="stack">
    <div class="kv-list">
      <div class="kv-row"><dt>${t('backup.history', { count: counts.history })}</dt><dd>${counts.history}</dd></div>
      <div class="kv-row"><dt>${t('backup.favorites', { count: counts.favorites })}</dt><dd>${counts.favorites}</dd></div>
      <div class="kv-row"><dt>${t('backup.scans', { count: counts.scans })}</dt><dd>${counts.scans}</dd></div>
      <div class="kv-row"><dt>${t('backup.logos', { count: counts.logos })}</dt><dd>${counts.logos}</dd></div>
      <div class="kv-row"><dt>${t('backup.summary')}</dt><dd>${counts.settings ? t('backup.settings') : t('backup.noSettings')}</dd></div>
    </div>
    <hr class="divider">
    <div class="field">
      <span class="field-label">${t('backup.mode')}</span>
      <div class="backup-modes">
        <label class="choice-card">
          <input type="radio" name="backup-mode" value="merge" checked>
          <span class="choice-inner">
            <i class="icon" data-lucide="layers"></i>
            <span class="choice-copy">
              <span class="choice-label">${t('backup.merge')}</span>
              <span class="setting-row-desc">${t('backup.mergeDesc')}</span>
            </span>
          </span>
        </label>
        <label class="choice-card">
          <input type="radio" name="backup-mode" value="replace">
          <span class="choice-inner">
            <i class="icon" data-lucide="refresh-cw"></i>
            <span class="choice-copy">
              <span class="choice-label">${t('backup.replace')}</span>
              <span class="setting-row-desc">${t('backup.replaceDesc')}</span>
            </span>
          </span>
        </label>
      </div>
    </div>
    <div class="banner banner-warning" data-replace-warning hidden>
      <i class="icon" data-lucide="alert-triangle"></i>
      <div>${t('backup.replaceWarning')}</div>
    </div>
    <label class="check-row" data-replace-check hidden>
      <input type="checkbox" data-replace-confirm>
      <span>${t('backup.replaceCheck')}</span>
    </label>
    <p class="note">${t('backup.safety')}</p>
  </div>`;
}

export async function reviewBackup(file) {
  let backup;
  try {
    backup = await readBackupFile(file);
  } catch (error) {
    const map = {
      JSON: 'invalidJson',
      VERSION: 'invalidVersion',
      EMPTY: 'empty',
      TOO_LARGE: 'tooLarge',
      READ_FAILED: 'readFailed',
      INVALID: 'invalid'
    };
    toast(t(`backup.${map[error?.code] || 'failed'}`), { type: 'error', duration: 6000 });
    return { imported: false };
  }

  let result = { imported: false };
  let resolveDone;
  const done = new Promise((resolve) => { resolveDone = resolve; });
  const modal = openModal({
    title: t('backup.title'),
    subtitle: t('backup.subtitle'),
    content: summaryMarkup(backup),
    size: 'md',
    onClose: () => resolveDone(result),
    actions: [
      { label: t('backup.cancel'), variant: 'ghost', close: false, onClick: (m) => { m.close(); } },
      {
        label: t('backup.confirm'),
        variant: 'primary',
        icon: 'upload',
        close: false,
        onClick: async (m) => {
          const mode = m.body.querySelector('input[name="backup-mode"]:checked')?.value || 'merge';
          try {
            result = await importBackup(backup, mode);
            m.close();
            return result;
          } catch (error) {
            console.error('[backup] import failed', error);
            toast(t(error?.message === 'STORAGE_FULL' ? 'toast.storageFull' : 'backup.failed'), { type: 'error' });
            return false;
          }
        }
      }
    ]
  });

  const importButton = modal.overlay.querySelector('[data-modal-action="1"]');
  const warning = modal.body.querySelector('[data-replace-warning]');
  const check = modal.body.querySelector('[data-replace-check]');
  const checkbox = modal.body.querySelector('[data-replace-confirm]');

  const sync = () => {
    const mode = modal.body.querySelector('input[name="backup-mode"]:checked')?.value || 'merge';
    const replace = mode === 'replace';
    if (warning) warning.hidden = !replace;
    if (check) check.hidden = !replace;
    if (checkbox && !replace) checkbox.checked = false;
    if (importButton) importButton.disabled = replace && !checkbox?.checked;
  };
  modal.body.addEventListener('change', sync);
  sync();

  return done;
}
