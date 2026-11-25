// 서비스워커: 앱 파일(같은 출처)만 캐시한다. 외부 API(카카오 등)는 가로채지 않는다.
// 앱 파일을 고치면 VERSION을 올려야 휴대폰에 새 버전이 반영된다.
const VERSION = 'v9';
const CACHE = `busroute-${VERSION}`;
const ASSETS = [
  './',
  './index.html',
  './manifest.webmanifest',
  './css/app.css',
  './js/app.js',
  './js/db.js',
  './js/util.js',
  './js/model.js',
  './js/optimizer.js',
  './js/roadtime.js',
  './js/geocode.js',
  './js/navlink.js',
  './js/backup.js',
  './js/sample.js',
  './js/views/common.js',
  './js/views/today.js',
  './js/views/timetable.js',
  './js/views/course.js',
  './js/views/roster.js',
  './js/views/settings.js',
  './icons/icon.svg',
  './icons/icon-192.png',
  './icons/icon-512.png',
];

self.addEventListener('install', (e) => {
  // cache: 'reload' → 브라우저 HTTP 캐시의 옛 파일이 섞이지 않게 항상 서버에서 새로 받는다
  e.waitUntil(caches.open(CACHE).then((c) => c.addAll(ASSETS.map((u) => new Request(u, { cache: 'reload' })))).then(() => self.skipWaiting()));
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
  if (url.origin !== self.location.origin) return; // 외부 요청은 그대로 통과(캐시하지 않음)

  // 캐시 우선 → 없으면 네트워크(성공 시 캐시) → 둘 다 실패하면 화면 요청은 index.html
  e.respondWith(
    caches.match(req, { ignoreSearch: true }).then((hit) => hit || fetch(req).then((res) => {
      if (res.ok) { const copy = res.clone(); caches.open(CACHE).then((c) => c.put(req, copy)).catch(() => {}); }
      return res;
    }).catch(() => (req.mode === 'navigate' ? caches.match('./index.html') : Response.error()))),
  );
});

// ---------- 운행 알림 ----------
// 내비를 보는 동안 휴대폰 알림으로 다음 아이와 [도착 완료]를 보여 준다.
// 앱이 kv 'trip'(오늘 코스의 정류장 이름·예정 시각, 좌표 없음)을 저장하면 여기서 알림을 만든다.
// 알림의 [도착 완료]는 앱과 같은 kv 'today'에 기록한다.
function idb() {
  return new Promise((resolve, reject) => {
    const r = indexedDB.open('busroute');
    r.onsuccess = () => resolve(r.result);
    r.onerror = () => reject(r.error);
  });
}
async function kvGet(id) {
  const d = await idb();
  return new Promise((resolve, reject) => {
    const q = d.transaction('kv').objectStore('kv').get(id);
    q.onsuccess = () => resolve(q.result || null);
    q.onerror = () => reject(q.error);
  });
}
async function kvPut(v) {
  const d = await idb();
  return new Promise((resolve, reject) => {
    const tx = d.transaction('kv', 'readwrite');
    tx.objectStore('kv').put(v);
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
  });
}
const fmt = (m) => {
  if (!Number.isFinite(m)) return '--:--';
  const v = ((Math.round(m) % 1440) + 1440) % 1440;
  return `${String(Math.floor(v / 60)).padStart(2, '0')}:${String(v % 60).padStart(2, '0')}`;
};
const mod = (ms) => { const d = new Date(ms); return d.getHours() * 60 + d.getMinutes(); };
const dur = (m) => { m = Math.round(Math.abs(m)); return m < 60 ? `${m}분` : `${Math.floor(m / 60)}시간${m % 60 ? ` ${m % 60}분` : ''}`; };
const cmp = (ms, plan) => {
  if (!Number.isFinite(plan)) return '';
  const d = mod(ms) - Math.round(plan);
  return d === 0 ? '예정대로' : d > 0 ? `예정보다 ${dur(d)} 늦음` : `예정보다 ${dur(-d)} 빠름`;
};

async function loadTrip() {
  const [trip, today] = await Promise.all([kvGet('trip'), kvGet('today')]);
  if (!trip || !trip.on || !today || today.date !== trip.date) return null;
  const cs = today.courses?.[trip.cid];
  if (!cs) return null;
  if (!Array.isArray(cs.done)) cs.done = [];
  if (!cs.arrived || typeof cs.arrived !== 'object') cs.arrived = {};
  return { trip, today, cs };
}

function noticeOf({ trip, cs }) {
  const done = new Set(cs.done);
  const n = trip.stops.length;
  const idx = trip.stops.findIndex((s) => !done.has(s.key));
  const via = new Set(trip.viaKeys || []);
  // 방금 도착한 곳
  let last = null;
  for (const s of trip.stops) {
    const at = cs.arrived[s.key];
    if (done.has(s.key) && at && (!last || at > last.at)) last = { s, at };
  }
  const lastLine = last ? `방금 ${last.s.names} ${fmt(mod(last.at))} 도착 · ${cmp(last.at, last.s.plan)}` : '';
  const since = cs.startedAt ? `출발 후 ${dur((Date.now() - cs.startedAt) / 60000)}` : '';
  if (cs.endAt) {
    const base = cs.startedAt || null;
    return {
      key: '__done', title: `🏁 ${trip.title} 운행 끝`,
      body: [`${fmt(mod(cs.endAt))} 어린이집 도착 · ${cmp(cs.endAt, trip.endPlan)}`, base ? `총 ${dur((cs.endAt - base) / 60000)} 걸림` : ''].filter(Boolean).join('\n'),
      actions: [], sticky: false,
    };
  }
  if (idx < 0) {
    return {
      key: '__end', title: `모든 정류장 완료 (${n}곳) → 어린이집`,
      body: [`어린이집 도착 예정 ${fmt(trip.endPlan)}`, lastLine, since].filter(Boolean).join('\n'),
      actions: [{ action: 'end', title: '✓ 어린이집 도착' }, via.has('__end') ? { action: 'open', title: '앱 열기' } : { action: 'nav', title: '▶ 어린이집 길안내' }],
      sticky: true,
    };
  }
  const s = trip.stops[idx];
  return {
    key: s.key, title: `다음 ${idx + 1}/${n} · ${s.names}`,
    body: [`예정 ${fmt(s.plan)} · ${s.addr || ''}`, lastLine, since].filter(Boolean).join('\n'),
    actions: [{ action: 'done', title: '✓ 도착 완료' }, via.has(s.key) ? { action: 'open', title: '앱 열기' } : { action: 'nav', title: '▶ 이어서 길안내' }],
    sticky: true,
  };
}

async function syncNotice(force = false) {
  const t = await loadTrip().catch(() => null);
  if (!t) { (await self.registration.getNotifications({ tag: 'trip' })).forEach((x) => x.close()); return; }
  const nt = noticeOf(t);
  const sig = JSON.stringify([nt.title, nt.body.split('\n').slice(0, 2), nt.actions]);
  if (!force && t.trip.lastSig === sig) return;
  const changed = t.trip.lastKey !== nt.key;
  t.trip.lastSig = sig;
  t.trip.lastKey = nt.key;
  await kvPut(t.trip);
  await self.registration.showNotification(nt.title, {
    body: nt.body, tag: 'trip', renotify: changed, requireInteraction: nt.sticky,
    actions: nt.actions, icon: './icons/icon-192.png', badge: './icons/icon-192.png',
    vibrate: changed ? [120, 60, 120] : undefined, data: { key: nt.key },
  });
}

async function tellClients(msg) {
  const list = await self.clients.matchAll({ type: 'window', includeUncontrolled: true });
  list.forEach((c) => c.postMessage(msg));
  return list;
}

async function openApp(go) {
  const list = await self.clients.matchAll({ type: 'window', includeUncontrolled: true });
  const c = list[0];
  if (c) {
    await c.focus().catch(() => {});
    c.postMessage({ type: 'go', go: go || '' });
    return;
  }
  await self.clients.openWindow(`./${go ? `?go=${go}` : ''}#today`);
}

self.addEventListener('message', (e) => {
  const t = e.data?.type;
  if (t === 'trip-sync') e.waitUntil(syncNotice(!!e.data.force).catch((err) => console.warn(err)));
});

self.addEventListener('notificationclick', (e) => {
  const action = e.action;
  e.waitUntil((async () => {
    if (action === 'done' || action === 'end') {
      const t = await loadTrip();
      if (!t) { e.notification.close(); return; }
      if (action === 'done') {
        const s = t.trip.stops.find((x) => !t.cs.done.includes(x.key));
        if (s) { t.cs.done.push(s.key); t.cs.arrived[s.key] = Date.now(); }
      } else {
        t.cs.endAt = Date.now();
      }
      await kvPut(t.today);
      await syncNotice(true);
      await tellClients({ type: 'today-changed' });
      return;
    }
    e.notification.close();
    await openApp(action === 'nav' ? 'via' : '');
  })().catch((err) => console.warn(err)));
});

// 알림을 밀어서 지우면 운행 알림을 끈다
self.addEventListener('notificationclose', (e) => {
  if (e.notification.tag !== 'trip') return;
  e.waitUntil(kvGet('trip').then((t) => (t ? kvPut({ ...t, on: false }) : null)).then(() => tellClients({ type: 'today-changed' })).catch(() => {}));
});
