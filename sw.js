// 서비스 종료: 예전에 설치된 앱(서비스워커·오프라인 캐시)을 스스로 지우고 종료 안내 화면을 띄운다.
// 이전 앱 코드는 git 기록(커밋 bc63acc)에 있다.
self.addEventListener('install', () => self.skipWaiting());
self.addEventListener('activate', (e) => {
  e.waitUntil((async () => {
    for (const k of await caches.keys()) await caches.delete(k);
    await self.registration.unregister();
    const list = await self.clients.matchAll({ type: 'window' });
    for (const c of list) c.navigate(new URL(`./?ended=${Date.now()}`, self.registration.scope).href).catch(() => {});
  })());
});
