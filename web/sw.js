self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open('econoapp-v12').then((cache) =>
      cache.addAll(['./index.html', './styles.css', './app.js', './manifest.webmanifest']),
    ),
  );
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches
      .keys()
      .then((keys) => Promise.all(keys.filter((key) => key !== 'econoapp-v12').map((key) => caches.delete(key)))),
  );
});

self.addEventListener('fetch', (event) => {
  if (event.request.method !== 'GET') return;
  event.respondWith(caches.match(event.request).then((cached) => cached || fetch(event.request)));
});
