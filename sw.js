// Pokédex — service worker
// Precaches the app shell so the PWA loads offline, and opportunistically
// caches everything else it fetches (PokeAPI JSON, sprite images) so a
// Pokémon you've already viewed stays viewable without a connection.
// Paths are relative ("./...") so this works when hosted at a subpath
// (e.g. github.io/pokedex/), not just at a domain root.

const CACHE_VERSION = 'v5';
const STATIC_CACHE = `pokedex-static-${CACHE_VERSION}`;
const RUNTIME_CACHE = `pokedex-runtime-${CACHE_VERSION}`;

const APP_SHELL = [
  './',
  './index.html',
  './styles.css',
  './app.js',
  './manifest.json',
  './icons/apple-touch-icon.png',
  './icons/icon-192.png',
  './icons/icon-512.png',
];

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(STATIC_CACHE).then((cache) => cache.addAll(APP_SHELL))
  );
  self.skipWaiting();
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches
      .keys()
      .then((keys) =>
        Promise.all(
          keys
            .filter((key) => key !== STATIC_CACHE && key !== RUNTIME_CACHE)
            .map((key) => caches.delete(key))
        )
      )
  );
  self.clients.claim();
});

// Cache-first: serve from cache when we have it, otherwise fetch from the
// network and stash a copy in the runtime cache for next time.
self.addEventListener('fetch', (event) => {
  const { request } = event;
  if (request.method !== 'GET') return;

  event.respondWith(
    caches.match(request).then((cached) => {
      if (cached) return cached;

      return fetch(request)
        .then((response) => {
          // response.ok is always false for opaque (no-cors, cross-origin)
          // responses — e.g. the <img> requests to the sprite CDN — so
          // those have to be cached explicitly too, not just "ok" ones.
          if (response.ok || response.type === 'opaque') {
            const copy = response.clone();
            caches.open(RUNTIME_CACHE).then((cache) => cache.put(request, copy));
          }
          return response;
        })
        .catch(() => cached);
    })
  );
});
