const CACHE_NAME = 'din-static-v64';
const ASSETS = [
  './index.html',
  './styles.css',
  './styles/base-theme.css',
  './styles/cards.css',
  './styles/forms.css',
  './styles/layout-navigation.css',
  './styles/reports.css',
  './styles/transaction-sheet.css',
  './styles/clean-mobile.css',
  './assets/din-mark.svg',
  './assets/din-logo.svg',
  './assets/din-icon.png',
  './assets/login-illustration.jpg',
  './app.js',
  './api.js',
  './finance.js',
  './state.js',
  './utils.js',
  './views.js',
  './views/chrome.js',
  './views/dashboard.js',
  './views/manage.js',
  './views/reports.js',
  './views/assistant.js',
  './views/shared.js',
  './views/transaction-form.js',
  './views/transactions.js',
  './manifest.webmanifest',
];

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(CACHE_NAME).then((cache) => cache.addAll(ASSETS)),
  );
  self.skipWaiting();
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches
      .keys()
      .then((keys) => Promise.all(keys.filter((key) => key !== CACHE_NAME).map((key) => caches.delete(key))))
      .then(() => self.clients.claim()),
  );
});

self.addEventListener('fetch', (event) => {
  if (event.request.method !== 'GET') return;
  const url = new URL(event.request.url);
  if (url.origin !== self.location.origin) return;
  if (url.pathname.startsWith('/api/') || !isPublicAsset(url)) return;

  event.respondWith(
    fetch(event.request)
      .then((response) => {
        const copy = response.clone();
        caches.open(CACHE_NAME).then((cache) => cache.put(event.request, copy));
        return response;
      })
      .catch(() => caches.match(event.request)),
  );
});

self.addEventListener('message', (event) => {
  if (event.data?.type !== 'CLEAR_PRIVATE_CACHES') return;
  event.waitUntil(
    caches.keys().then((keys) =>
      Promise.all(keys.filter((key) => key !== CACHE_NAME).map((key) => caches.delete(key))),
    ),
  );
});

function isPublicAsset(url) {
  const path = url.pathname;
  if (path === '/' || path.endsWith('/index.html')) return true;
  return ASSETS.some((asset) => path.endsWith(asset.replace(/^\./, '')));
}
