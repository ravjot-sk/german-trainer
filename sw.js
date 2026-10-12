// Offline support and fast start: the app opens from the cached copy of this version at once,
// even on a weak signal. A new version is downloaded in the background and waits until the app
// asks for it (the "Neue Version" bar, or the next start); see app.js.
// Gemini and Firebase requests go to other origins and are never cached.
const VERSION = 'gt-v24';
const SHELL = [
  './', './index.html', './manifest.webmanifest', './css/app.css',
  './js/app.js', './js/appstate.js', './js/html.js', './js/store.js', './js/i18n.js', './js/i18n/de.js', './js/i18n/en.js', './js/srs.js',
  './js/gemini.js', './js/gemclient.js', './js/gemini/client.js', './js/gemini/shared.js', './js/gemini/words.js',
  './js/gemini/sentences.js', './js/gemini/grading.js', './js/gemini/grammar.js', './js/gemini/setup.js',
  './js/check.js', './js/session.js', './js/categories.js', './js/languages.js', './js/actions.js',
  './js/sync.js', './js/syncmerge.js', './js/invites.js', './js/firebase-config.js', './js/icons.js', './js/furigana.js', './js/gappool.js',
  './js/rules.js', './js/ruleseeds.js', './js/report.js', './js/localdb.js', './js/reviews.js', './js/resume.js',
  './js/ui/dom.js', './js/ui/context.js', './js/ui/text.js', './js/ui/sheet.js', './js/ui/suggest.js', './js/ui/report.js', './js/ui/catlist.js', './js/router.js', './js/background.js', './js/stats.js', './js/answer.js',
  './js/practice/runtime.js', './js/practice/render.js', './js/practice/grade.js', './js/practice/feedback.js', './js/practice/english.js',
  './js/views/learncard.js', './js/views/today.js', './js/views/lookup.js', './js/views/words.js',
  './js/views/editor.js', './js/views/correct.js', './js/views/profile.js', './js/views/settings.js', './js/views/account.js',
  './icons/icon-192.png', './icons/icon-512.png', './icons/apple-touch-icon.png',
];

// cache: 'reload' skips the browser's HTTP cache (GitHub Pages allows 10 minutes), which right
// after a deploy could put an old module into the new version next to new ones.
self.addEventListener('install', (e) => {
  e.waitUntil(caches.open(VERSION).then((c) => c.addAll(SHELL.map((u) => new Request(u, { cache: 'reload' })))));
});

self.addEventListener('message', (e) => {
  if (e.data === 'skipWaiting') self.skipWaiting();
});

self.addEventListener('activate', (e) => {
  e.waitUntil(
    caches.keys().then((keys) => Promise.all(keys.filter((k) => k !== VERSION).map((k) => caches.delete(k))))
      .then(() => self.clients.claim())
  );
});

// Cache first, from this version's cache only, so an open app never mixes files of two
// versions. Anything not cached is fetched and kept.
self.addEventListener('fetch', (e) => {
  const url = new URL(e.request.url);
  if (e.request.method !== 'GET' || url.origin !== self.location.origin) return;
  e.respondWith(caches.open(VERSION).then(async (cache) => {
    const hit = await cache.match(e.request, { ignoreSearch: true })
      || (e.request.mode === 'navigate' ? await cache.match('./index.html') : null);
    if (hit) return hit;
    const res = await fetch(e.request, { cache: 'no-cache' });
    if (res.ok) cache.put(e.request, res.clone());
    return res;
  }));
});
