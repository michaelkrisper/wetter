// App shell cache. The deploy workflow replaces __VERSION__ with the commit,
// so every release installs a fresh cache; weather data is never cached here
// (the app keeps the last forecast in localStorage instead).

const VERSION = '__VERSION__';
const CACHE = `wetter-${VERSION}`;

const SHELL = [
  './',
  'index.html',
  'styles.css',
  'manifest.webmanifest',
  'icons/icon.svg',
  'icons/icon-192.png',
  'icons/apple-touch-icon.png',
  'js/main.js',
  'js/config.js',
  'js/forecast.js',
  'js/regions.js',
  'js/borders.js',
  'js/model.js',
  'js/weather-codes.js',
  'js/location.js',
  'js/storage.js',
  'js/sources/http.js',
  'js/sources/open-meteo.js',
  'js/sources/geosphere.js',
  'js/sources/nominatim.js',
  'js/sources/radar-grid.js',
  'js/ui/chart.js',
  'js/ui/colors.js',
  'js/ui/format.js',
  'js/ui/icons.js',
  'js/ui/render.js',
  'js/ui/radar.js',
];

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches
      .open(CACHE)
      .then((cache) => cache.addAll(SHELL.map((path) => new Request(path, { cache: 'reload' }))))
      .then(() => self.skipWaiting()),
  );
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches
      .keys()
      .then((keys) => Promise.all(keys.filter((key) => key !== CACHE).map((key) => caches.delete(key))))
      .then(() => self.clients.claim()),
  );
});

self.addEventListener('fetch', (event) => {
  const { request } = event;
  if (request.method !== 'GET' || new URL(request.url).origin !== self.location.origin) return;
  event.respondWith(
    caches
      .match(request, { ignoreSearch: true })
      .then((hit) => hit ?? (request.mode === 'navigate' ? caches.match('./') : null))
      .then((hit) => hit ?? fetch(request)),
  );
});
