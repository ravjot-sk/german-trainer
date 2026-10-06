// Offline support: cache the app shell so the daily session opens without a connection.
// Gemini and Firebase requests go to other origins and are never cached.
const VERSION = 'gt-v12';
const SHELL = [
  './', './index.html', './manifest.webmanifest', './css/app.css',
  './js/app.js', './js/store.js', './js/i18n.js', './js/gemini.js', './js/srs.js',
  './js/check.js', './js/session.js', './js/categories.js', './js/languages.js', './js/actions.js',
  './js/sync.js', './js/syncmerge.js', './js/firebase-config.js', './js/icons.js', './js/furigana.js', './js/gappool.js',
  './js/rules.js', './js/ruleseeds.js',
  './js/ui/dom.js', './js/ui/context.js', './js/ui/text.js', './js/ui/sheet.js', './js/router.js', './js/background.js', './js/stats.js', './js/answer.js',
  './js/practice/runtime.js', './js/practice/render.js', './js/practice/grade.js',
  './js/views/learncard.js', './js/views/today.js', './js/views/lookup.js', './js/views/words.js', './js/views/suggest.js',
  './js/views/editor.js', './js/views/correct.js', './js/views/profile.js', './js/views/settings.js', './js/views/account.js',
  './icons/icon-192.png', './icons/icon-512.png', './icons/apple-touch-icon.png',
];

self.addEventListener('install', (e) => {
  e.waitUntil(caches.open(VERSION).then((c) => c.addAll(SHELL)).then(() => self.skipWaiting()));
});

self.addEventListener('activate', (e) => {
  e.waitUntil(
    caches.keys().then((keys) => Promise.all(keys.filter((k) => k !== VERSION).map((k) => caches.delete(k))))
      .then(() => self.clients.claim())
  );
});

// Network first for our own files (so updates land), falling back to the cache offline.
// no-cache makes every request check with the server instead of taking the browser's HTTP
// cache (GitHub Pages allows 10 minutes), which right after a deploy could hand out an old
// module next to new ones.
self.addEventListener('fetch', (e) => {
  const url = new URL(e.request.url);
  if (e.request.method !== 'GET' || url.origin !== self.location.origin) return;
  e.respondWith(
    fetch(e.request, { cache: 'no-cache' })
      .then((res) => {
        const copy = res.clone();
        caches.open(VERSION).then((c) => c.put(e.request, copy));
        return res;
      })
      .catch(() => caches.match(e.request, { ignoreSearch: true }).then((r) => r || caches.match('./index.html')))
  );
});
