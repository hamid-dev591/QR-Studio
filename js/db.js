/**
 * Local-only logo storage. IndexedDB is preferred; a localStorage fallback
 * keeps the logo workflow usable in restricted browsing modes.
 */
const DB_NAME = 'qrstudio';
const DB_VERSION = 1;
const STORE = 'logos';
const FALLBACK_PREFIX = 'qs.logo.v1.';

let dbPromise = null;
let fallbackMode = false;

function hasIndexedDb() {
  try {
    return typeof indexedDB !== 'undefined';
  } catch {
    return false;
  }
}

function openDb() {
  if (fallbackMode || !hasIndexedDb()) return Promise.reject(new Error('IDB_UNAVAILABLE'));
  if (dbPromise) return dbPromise;
  dbPromise = new Promise((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, DB_VERSION);
    request.onupgradeneeded = () => {
      const db = request.result;
      if (!db.objectStoreNames.contains(STORE)) {
        db.createObjectStore(STORE, { keyPath: 'id' });
      }
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error || new Error('IDB_OPEN_FAILED'));
    request.onblocked = () => reject(new Error('IDB_BLOCKED'));
  }).catch((error) => {
    fallbackMode = true;
    throw error;
  });
  return dbPromise;
}

function tx(mode, fn) {
  return openDb().then((db) => new Promise((resolve, reject) => {
    const transaction = db.transaction(STORE, mode);
    const store = transaction.objectStore(STORE);
    let result;
    try {
      result = fn(store);
    } catch (error) {
      reject(error);
      return;
    }
    transaction.oncomplete = () => resolve(result && result.result !== undefined ? result.result : result);
    transaction.onerror = () => reject(transaction.error || new Error('IDB_TX_FAILED'));
    transaction.onabort = () => reject(transaction.error || new Error('IDB_TX_ABORTED'));
  }));
}

function fallbackGet(id) {
  try {
    const raw = localStorage.getItem(FALLBACK_PREFIX + id);
    return raw ? JSON.parse(raw) : null;
  } catch {
    return null;
  }
}

function fallbackAll() {
  const logos = [];
  try {
    for (let i = 0; i < localStorage.length; i++) {
      const key = localStorage.key(i);
      if (key && key.startsWith(FALLBACK_PREFIX)) {
        try {
          const parsed = JSON.parse(localStorage.getItem(key));
          if (parsed && parsed.id) logos.push(parsed);
        } catch { /* ignore corrupt local record */ }
      }
    }
  } catch { /* storage unavailable */ }
  return logos;
}

function normalizeLogo(logo) {
  if (!logo || typeof logo !== 'object') throw new Error('INVALID_LOGO');
  if (!logo.id || typeof logo.id !== 'string') throw new Error('INVALID_LOGO_ID');
  if (!logo.dataUrl || typeof logo.dataUrl !== 'string' || !logo.dataUrl.startsWith('data:')) {
    throw new Error('INVALID_LOGO_DATA');
  }
  return {
    id: logo.id,
    name: String(logo.name || 'logo').slice(0, 120),
    mime: String(logo.mime || 'image/png').slice(0, 80),
    dataUrl: logo.dataUrl,
    size: String(logo.dataUrl).length,
    createdAt: Number(logo.createdAt) || Date.now()
  };
}

export async function putLogo(logo) {
  const value = normalizeLogo(logo);
  if (!fallbackMode) {
    try {
      await tx('readwrite', (store) => store.put(value));
      return value;
    } catch {
      fallbackMode = true;
    }
  }
  const raw = JSON.stringify(value);
  try {
    localStorage.setItem(FALLBACK_PREFIX + value.id, raw);
  } catch {
    throw new Error('STORAGE_FULL');
  }
  return value;
}

export async function getLogo(id) {
  if (!id) return null;
  if (!fallbackMode) {
    try {
      const result = await tx('readonly', (store) => store.get(id));
      if (result) return result;
    } catch {
      fallbackMode = true;
    }
  }
  return fallbackGet(id);
}

export async function getAllLogos() {
  if (!fallbackMode) {
    try {
      const result = await tx('readonly', (store) => store.getAll());
      return Array.isArray(result) ? result : [];
    } catch {
      fallbackMode = true;
    }
  }
  return fallbackAll();
}

export async function deleteLogo(id) {
  if (!id) return;
  if (!fallbackMode) {
    try {
      await tx('readwrite', (store) => store.delete(id));
    } catch {
      fallbackMode = true;
    }
  }
  try {
    localStorage.removeItem(FALLBACK_PREFIX + id);
  } catch { /* ignore */ }
}

export async function clearLogos() {
  if (!fallbackMode) {
    try {
      await tx('readwrite', (store) => store.clear());
    } catch {
      fallbackMode = true;
    }
  }
  try {
    const keys = [];
    for (let i = 0; i < localStorage.length; i++) {
      const key = localStorage.key(i);
      if (key && key.startsWith(FALLBACK_PREFIX)) keys.push(key);
    }
    keys.forEach((key) => localStorage.removeItem(key));
  } catch { /* ignore */ }
}

export async function countLogos() {
  const logos = await getAllLogos();
  return logos.length;
}

/** Remove logo records that are not referenced by any saved QR. */
export async function pruneLogos(referencedIds) {
  const keep = new Set((referencedIds || []).filter(Boolean));
  const logos = await getAllLogos();
  for (const logo of logos) {
    if (!keep.has(logo.id)) await deleteLogo(logo.id);
  }
}

export function isFallbackStorage() {
  return fallbackMode;
}
