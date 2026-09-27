/*
 * sw.js — 오프라인 캐시
 * 버전(CACHE_NAME)을 올리면 이전 캐시는 activate 단계에서 정리된다.
 */
const CACHE_NAME = 'manse-eve-v1';
const PRECACHE = [
  './',
  './index.html',
  './manifest.json',
  './js/engine.js',
  './js/levelSetup.js',
  './js/solo.js',
  './js/art.js',
  './js/ui.js',
  './data/levels.json',
  './icons/icon-192.png',
  './icons/icon-512.png',
  './icons/icon-maskable-192.png',
  './icons/icon-maskable-512.png'
];

self.addEventListener('install', function (event) {
  event.waitUntil(
    caches.open(CACHE_NAME)
      .then(function (cache) { return cache.addAll(PRECACHE); })
      .then(function () { return self.skipWaiting(); })
  );
});

self.addEventListener('activate', function (event) {
  event.waitUntil(
    caches.keys().then(function (names) {
      return Promise.all(names.filter(function (n) { return n !== CACHE_NAME; }).map(function (n) { return caches.delete(n); }));
    }).then(function () { return self.clients.claim(); })
  );
});

// 앱 자체 파일: 캐시 우선(오프라인 우선), 실패 시 네트워크.
// 그 외(구글 폰트 등): 네트워크 우선, 실패하면 캐시.
self.addEventListener('fetch', function (event) {
  const req = event.request;
  if (req.method !== 'GET') return;
  const url = new URL(req.url);
  const isSameOrigin = url.origin === self.location.origin;

  if (isSameOrigin) {
    event.respondWith(
      caches.match(req).then(function (cached) {
        if (cached) return cached;
        return fetch(req).then(function (res) {
          const copy = res.clone();
          caches.open(CACHE_NAME).then(function (cache) { cache.put(req, copy); });
          return res;
        }).catch(function () { return cached; });
      })
    );
  } else {
    event.respondWith(
      fetch(req).then(function (res) {
        const copy = res.clone();
        caches.open(CACHE_NAME).then(function (cache) { cache.put(req, copy); });
        return res;
      }).catch(function () { return caches.match(req); })
    );
  }
});
