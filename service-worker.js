/* QR Studio service worker — versioned offline shell.
 * Bump CACHE_NAME whenever the precache list or runtime assets change.
 * Updates are applied only after the user accepts the in-app prompt.
 */
const CACHE_NAME = 'qr-studio-cache-v1.0.7';
const CACHE_PREFIX = 'qr-studio-cache-';

const PRECACHE = [
  './index.html',
  './manifest.json',
  './css/main.css',
  './css/layout.css',
  './css/components.css',
  './css/generator.css',
  './css/scanner.css',
  './css/responsive.css',
  './js/about.js',
  './js/app.js',
  './js/backup.js',
  './js/batch.js',
  './js/config.js',
  './js/dashboard.js',
  './js/db.js',
  './js/export.js',
  './js/favorites.js',
  './js/generator.js',
  './js/history.js',
  './js/i18n.js',
  './js/library-view.js',
  './js/payloads.js',
  './js/qr-engine.js',
  './js/records.js',
  './js/router.js',
  './js/scanner.js',
  './js/settings.js',
  './js/storage.js',
  './js/themes.js',
  './js/ui.js',
  './js/utils.js',
  './locales/en.json',
  './locales/ar.json',
  './lib/lucide/lucide.js',
  './lib/qr-code-styling/qr-code-styling.js',
  './lib/jsqr/jsQR.js',
  './lib/jszip/jszip.min.js',
  './lib/papaparse/papaparse.min.js',
  './assets/icons/icon.svg',
  './assets/icons/icon-16.png',
  './assets/icons/icon-32.png',
  './assets/icons/icon-180.png',
  './assets/icons/icon-192.png',
  './assets/icons/icon-512.png',
  './assets/icons/icon-maskable.svg',
  './assets/icons/icon-maskable-512.png',
  './assets/icons/logo.svg'
];

self.addEventListener('install', (event) => {
  event.waitUntil((async () => {
    const cache = await caches.open(CACHE_NAME);
    await cache.addAll(PRECACHE.map((url) => new Request(url, { cache: 'reload' })));
  })());
});

self.addEventListener('activate', (event) => {
  event.waitUntil((async () => {
    const keys = await caches.keys();
    await Promise.all(
      keys
        .filter((key) => key.startsWith(CACHE_PREFIX) && key !== CACHE_NAME)
        .map((key) => caches.delete(key))
    );
    if (self.registration.navigationPreload) {
      try { await self.registration.navigationPreload.disable(); } catch { /* ignore */ }
    }
    await self.clients.claim();
  })());
});

self.addEventListener('message', (event) => {
  if (event.data && event.data.type === 'SKIP_WAITING') {
    self.skipWaiting();
  }
});

function offlineResponse() {
  return new Response(
    'QR Studio is offline and this resource is not cached. Reopen the app from the home screen or start the local server.',
    {
      status: 503,
      statusText: 'Offline',
      headers: { 'Content-Type': 'text/plain; charset=utf-8' }
    }
  );
}

async function handleNavigation(request) {
  const cache = await caches.open(CACHE_NAME);
  const shell = await cache.match('./index.html');
  if (shell) return shell;
  try {
    return await fetch(request);
  } catch {
    return offlineResponse();
  }
}

async function staleWhileRevalidate(request) {
  const cache = await caches.open(CACHE_NAME);
  const cached = await cache.match(request);
  const networkPromise = fetch(request)
    .then((response) => {
      if (response && response.ok && response.type === 'basic') {
        cache.put(request, response.clone()).catch(() => {});
      }
      return response;
    })
    .catch(() => null);

  if (cached) return cached;
  const fresh = await networkPromise;
  return fresh || offlineResponse();
}

self.addEventListener('fetch', (event) => {
  const request = event.request;
  if (request.method !== 'GET') return;

  const url = new URL(request.url);
  if (url.origin !== self.location.origin) return;
  if (url.pathname.endsWith('/service-worker.js')) return;

  if (request.mode === 'navigate') {
    event.respondWith(handleNavigation(request));
    return;
  }

  event.respondWith(staleWhileRevalidate(request));
});
