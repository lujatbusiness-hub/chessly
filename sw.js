/*
 * Chessly — service worker, so the app can be installed on a phone and works offline.
 *
 * The app shell (HTML, CSS, JS, icons), the puzzle set and Stockfish are cached on install; everything else
 * (theme artwork) is cached the first time it is used. Requests are answered from the cache
 * right away and refreshed in the background, so a new version shows up on the next start.
 * Bump VERSION to drop the old cache completely.
 */
const VERSION = 'chessly-v5';

const PRECACHE = [
    './',
    'index.html',
    'manifest.webmanifest',
    'css/theme.css',
    'css/style.css',
    'js/config.js',
    'js/chess.js',
    'js/openings.js',
    'js/sound.js',
    'js/engine.js',
    'js/rating.js',
    'js/puzzles.js',
    'js/puzzles-data.js',
    'js/board.js',
    'js/app.js',
    'js/pwa.js',
    'vendor/stockfish/stockfish.js',
    'assets/icons/icon-192.png',
    'assets/icons/icon-512.png',
    'assets/icons/icon-maskable-512.png',
    'assets/icons/apple-touch-icon.png',
];

self.addEventListener('install', (event) => {
    event.waitUntil(caches.open(VERSION).then((cache) => cache.addAll(PRECACHE)).then(() => self.skipWaiting()));
});

self.addEventListener('activate', (event) => {
    event.waitUntil(
        caches.keys()
            .then((keys) => Promise.all(keys.filter((key) => key !== VERSION).map((key) => caches.delete(key))))
            .then(() => self.clients.claim()),
    );
});

// Stale-while-revalidate for same-origin GET requests.
self.addEventListener('fetch', (event) => {
    const request = event.request;
    if (request.method !== 'GET' || new URL(request.url).origin !== self.location.origin) return;

    event.respondWith(caches.open(VERSION).then(async (cache) => {
        const cached = await cache.match(request, { ignoreSearch: true });
        const network = fetch(request)
            .then((response) => {
                if (response.ok) cache.put(request, response.clone());
                return response;
            })
            .catch(() => null);
        if (cached) {
            event.waitUntil(network);
            return cached;
        }
        const response = await network;
        if (response) return response;
        // Offline and not cached: fall back to the app shell for page loads.
        if (request.mode === 'navigate') return cache.match('index.html');
        return Response.error();
    }));
});
