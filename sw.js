const CACHE = 'geoshrink-v18';
const ASSETS = [
  './',
  './index.html',
  './style.css',
  './app.js',
  './manifest.json',
  './data/countries-110m.json',
  './data/name-to-iso3.json',
  './data/country-meta.json',
  './engine/map.js',
  './engine/hud.js',
  './engine/progression.js',
  './engine/theme.js',
  './engine/storage.js',
  './engine/graph.js',
  './engine/geoPartition.js',
  './engine/modeShell.js',
  './engine/heroGlobe.js',
  './engine/shop.js',
  './engine/multiplayer.js',
  './engine/home.js',
  './modes/narrow.js',
  './modes/neighbor.js',
  './modes/fog.js',
  './modes/size.js',
  './modes/flags.js',
  './modes/capitals.js',
  './modes/compass.js',
  './modes/blocs.js',
  './modes/expedition.js',
  './modes/daily.js',
  './modes/atlas.js',
  './modes/multiplayer.js',
  './dino/trex.svg',
  './dino/spinosaurus.svg',
  './dino/velociraptor.svg',
  './dino/iguanodon.svg',
  './dino/australovenator.svg',
  'https://cdn.jsdelivr.net/npm/d3@7/dist/d3.min.js',
  'https://cdn.jsdelivr.net/npm/topojson-client@3/dist/topojson-client.min.js'
];

self.addEventListener('install', (e) => {
  e.waitUntil(caches.open(CACHE).then((c) => c.addAll(ASSETS)));
  self.skipWaiting();
});

self.addEventListener('activate', (e) => {
  e.waitUntil(
    caches.keys().then((keys) => Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k))))
  );
  self.clients.claim();
});

// Firestore's realtime sync (long-polling/streaming requests) must never be
// intercepted by the cache-first handler below — multiplayer needs live
// connectivity regardless of caching, and cache-first logic on this traffic
// would silently break real-time updates.
const NEVER_CACHE_HOSTS = ['firestore.googleapis.com', 'firebaseinstallations.googleapis.com', 'identitytoolkit.googleapis.com'];

self.addEventListener('fetch', (e) => {
  if (e.request.method !== 'GET') return;
  if (NEVER_CACHE_HOSTS.some((h) => e.request.url.includes(h))) return;
  e.respondWith(
    caches.match(e.request).then((cached) => {
      const network = fetch(e.request)
        .then((resp) => {
          const copy = resp.clone();
          caches.open(CACHE).then((c) => c.put(e.request, copy));
          return resp;
        })
        .catch(() => cached);
      return cached || network;
    })
  );
});
