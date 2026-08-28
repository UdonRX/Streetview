/* Streetview Journey v0.1.0 */
const SHELL_CACHE = 'streetview-shell-v0.1.0';
const IMAGE_CACHE = 'streetview-images-v0.1.0';
const SHELL = ['/', '/index.html', '/styles.css', '/app.js', '/manifest.webmanifest'];
const IMAGE_LIMIT = 80;

self.addEventListener('install', (event) => {
  event.waitUntil(caches.open(SHELL_CACHE).then((cache) => cache.addAll(SHELL)));
  self.skipWaiting();
});

self.addEventListener('activate', (event) => {
  event.waitUntil(caches.keys().then((keys) => Promise.all(
    keys.filter((key) => ![SHELL_CACHE, IMAGE_CACHE].includes(key)).map((key) => caches.delete(key))
  )));
  self.clients.claim();
});

async function trimImages(cache) {
  const keys = await cache.keys();
  while (keys.length > IMAGE_LIMIT) {
    await cache.delete(keys.shift());
  }
}

self.addEventListener('fetch', (event) => {
  const request = event.request;
  if (request.method !== 'GET') return;
  const url = new URL(request.url);

  if (request.destination === 'image' && url.origin !== self.location.origin) {
    event.respondWith((async () => {
      const cache = await caches.open(IMAGE_CACHE);
      const hit = await cache.match(request);
      if (hit) return hit;
      const response = await fetch(request);
      if (response.ok || response.type === 'opaque') {
        await cache.put(request, response.clone());
        trimImages(cache).catch(() => {});
      }
      return response;
    })());
    return;
  }

  if (url.origin === self.location.origin && !url.pathname.startsWith('/api/')) {
    event.respondWith(caches.match(request).then((hit) => hit || fetch(request)));
  }
});
