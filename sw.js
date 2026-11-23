// 서비스워커: 앱 파일(같은 출처)만 캐시. 외부 API(카카오 등)는 가로채지 않는다.
// 앱 파일을 고치면 VERSION을 올려야 새 파일이 배포된다.
const VERSION = 'v1';
const CACHE = `busroute-${VERSION}`;
const ASSETS = [
  './',
  './index.html',
  './manifest.webmanifest',
  './css/app.css',
  './js/app.js',
  './js/db.js',
  './js/util.js',
  './js/stops.js',
  './js/plan.js',
  './js/geocode.js',
  './js/navi.js',
  './js/backup.js',
  './js/sample.js',
  './js/route/distance.js',
  './js/route/optimize.js',
  './js/route/road-kakaomobility.js',
  './js/views/today.js',
  './js/views/schedule.js',
  './js/views/course.js',
  './js/views/roster.js',
  './js/views/settings.js',
  './icons/icon.svg',
  './icons/icon-192.png',
  './icons/icon-512.png',
];

self.addEventListener('install', (e) => {
  e.waitUntil(caches.open(CACHE).then((c) => c.addAll(ASSETS)).then(() => self.skipWaiting()));
});

self.addEventListener('activate', (e) => {
  e.waitUntil(
    caches.keys()
      .then((keys) => Promise.all(keys.filter((k) => k.startsWith('busroute-') && k !== CACHE).map((k) => caches.delete(k))))
      .then(() => self.clients.claim()),
  );
});

self.addEventListener('fetch', (e) => {
  const req = e.request;
  if (req.method !== 'GET') return;
  const url = new URL(req.url);
  if (url.origin !== self.location.origin) return; // 외부 요청은 브라우저 기본 동작

  // 캐시 우선, 없으면 네트워크 → 성공하면 캐시에 저장. 둘 다 실패하면 페이지 요청은 index.html로.
  e.respondWith(
    caches.match(req, { ignoreSearch: true }).then((hit) => hit || fetch(req).then((res) => {
      if (res.ok) { const copy = res.clone(); caches.open(CACHE).then((c) => c.put(req, copy)); }
      return res;
    }).catch(() => (req.mode === 'navigate' ? caches.match('./index.html') : Response.error()))),
  );
});
