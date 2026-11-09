/*
 * sw.js — 오프라인 캐시
 * 버전(CACHE_NAME)을 올리면 이전 캐시는 activate 단계에서 정리된다.
 */
const CACHE_NAME = 'manse-eve-v28';
const PRECACHE = [
  './',
  './index.html',
  './manifest.json',
  './js/engine.js',
  './js/levelSetup.js',
  './js/solo.js',
  './js/art.js',
  './js/ui.js',
  './js/audio.js',
  './js/story.js',
  './js/multi.js',
  './js/crackdown.js',
  './js/tutorial.js',
  './js/firstRoll.js',
  './js/quickRules.js',
  './js/texts.js',
  // 게임 속 글(고치기 쉽게 따로 둔 마크다운)
  './texts/tutorial.md',
  './texts/stories.md',
  './texts/crackdown.md',
  './texts/rules.md',
  './texts/link.md',
  // 기기끼리 함께하기(시험판): 오프라인에서도 열려야 하므로 QR 도구까지 미리 저장
  './link.html',
  './js/link/rtc.js',
  './js/link/connlog.js',
  './js/link/qr.js',
  './js/link/netgame.js',
  './js/link/linkui.js',
  './vendor/qrcode-generator.mjs',
  './vendor/jsQR.min.js',
  './data/crackdown.json',
  './icons/icon-192.png',
  './icons/icon-512.png',
  './icons/icon-maskable-192.png',
  './icons/icon-maskable-512.png'
].concat(
  // 주사위 그림 24장: img/dice/{색}_{눈}.webp
  ['black', 'white', 'red', 'blue'].flatMap(function (c) {
    return [1, 2, 3, 4, 5, 6].map(function (v) { return './img/dice/' + c + '_' + v + '.webp'; });
  })
);

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

  // 게임 속 글(texts/*.md)은 GitHub에서 고치면 바로 보이도록 네트워크 우선(새 글이 있으면 받아 캐시도 바꿈),
  // 인터넷이 없으면 캐시에 있던 글을 쓴다
  if (isSameOrigin && /\/texts\/[^/]+\.md$/.test(url.pathname)) {
    event.respondWith(
      fetch(req, { cache: 'no-cache' }).then(function (res) {
        if (res.ok) { const copy = res.clone(); caches.open(CACHE_NAME).then(function (cache) { cache.put(req, copy); }); }
        return res;
      }).catch(function () { return caches.match(req); })
    );
    return;
  }

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
