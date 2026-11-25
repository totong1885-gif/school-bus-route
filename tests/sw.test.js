// 서비스워커의 운행 알림을 가짜 환경(IndexedDB·알림·창)에서 돌려 본다. 데이터는 모두 가짜.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';

function makeEnv(kv) {
  const store = new Map(Object.entries(kv).map(([k, v]) => [k, structuredClone(v)]));
  const later = (fn) => setTimeout(fn, 0);
  const fakeDb = {
    transaction() {
      const tx = {
        objectStore: () => ({
          get(id) { const q = {}; later(() => { q.result = structuredClone(store.get(id)); q.onsuccess?.(); }); return q; },
          put(v) { store.set(v.id, structuredClone(v)); later(() => tx.oncomplete?.()); },
        }),
      };
      return tx;
    },
  };
  const shown = [];
  const messages = [];
  const opened = [];
  const handlers = {};
  const self = {
    addEventListener: (t, fn) => { handlers[t] = fn; },
    registration: {
      showNotification: async (title, opts) => { shown.push({ title, ...opts }); },
      getNotifications: async () => [],
    },
    clients: {
      matchAll: async () => [{ postMessage: (m) => messages.push(m), focus: async () => {} }],
      openWindow: async (u) => opened.push(u),
      claim: async () => {},
    },
    location: { origin: 'https://ex' },
  };
  const ctx = vm.createContext({
    self, console, setTimeout, Date, JSON, Math, Number, String, Set, Promise, URL,
    indexedDB: { open: () => { const r = {}; later(() => { r.result = fakeDb; r.onsuccess?.(); }); return r; } },
    caches: {},
  });
  vm.runInContext(readFileSync(new URL('../sw.js', import.meta.url), 'utf8'), ctx);
  const fire = async (type, ev) => {
    let p;
    handlers[type]({ ...ev, waitUntil: (x) => { p = x; } });
    await p;
  };
  return { store, shown, messages, opened, fire };
}

const plain = (x) => JSON.parse(JSON.stringify(x));
const DATE = '2026-11-25';
const trip = {
  id: 'trip', on: true, date: DATE, cid: '1-am', title: '1호차 등원',
  stops: [
    { key: 'a', names: '가짜하나', addr: '가짜로 1', plan: 8 * 60 + 6 },
    { key: 'b', names: '가짜둘', addr: '가짜로 2', plan: 8 * 60 + 15 },
  ],
  endPlan: 8 * 60 + 30, viaKeys: ['a', 'b', '__end'],
};
const today = { id: 'today', date: DATE, courses: { '1-am': { unchecked: [], done: [], arrived: {}, startedAt: Date.now() - 5 * 60000 } } };

test('운행 알림: 다음 아이 → 도착 완료 → 다음 아이 → 어린이집 도착', async () => {
  const env = makeEnv({ trip, today });
  await env.fire('message', { data: { type: 'trip-sync', force: true } });
  let n = env.shown.at(-1);
  assert.equal(n.title, '다음 1/2 · 가짜하나');
  assert.match(n.body, /^예정 08:06 · 가짜로 1/);
  assert.deepEqual(plain(n.actions).map((a) => a.action), ['done', 'open']);
  assert.equal(n.tag, 'trip');
  assert.equal(n.requireInteraction, true);

  // 같은 내용이면 다시 띄우지 않는다
  await env.fire('message', { data: { type: 'trip-sync' } });
  assert.equal(env.shown.length, 1);

  await env.fire('notificationclick', { action: 'done', notification: { close() {} } });
  const cs = env.store.get('today').courses['1-am'];
  assert.deepEqual(plain(cs.done), ['a']);
  assert.ok(cs.arrived.a > 0);
  n = env.shown.at(-1);
  assert.equal(n.title, '다음 2/2 · 가짜둘');
  assert.equal(n.renotify, true);
  assert.match(n.body, /방금 가짜하나 \d\d:\d\d 도착 · 예정/);
  assert.deepEqual(plain(env.messages.at(-1)), { type: 'today-changed' });

  await env.fire('notificationclick', { action: 'done', notification: { close() {} } });
  n = env.shown.at(-1);
  assert.equal(n.title, '모든 정류장 완료 (2곳) → 어린이집');
  assert.deepEqual(plain(n.actions).map((a) => a.action), ['end', 'open']);

  await env.fire('notificationclick', { action: 'end', notification: { close() {} } });
  n = env.shown.at(-1);
  assert.match(n.title, /운행 끝/);
  assert.equal(n.requireInteraction, false);
  assert.ok(env.store.get('today').courses['1-am'].endAt > 0);
});

test('운행 알림: 경유지에 없는 다음 아이면 [이어서 길안내], 누르면 앱으로', async () => {
  const env = makeEnv({ trip: { ...trip, viaKeys: ['a'] }, today });
  await env.fire('notificationclick', { action: 'done', notification: { close() {} } });
  assert.deepEqual(plain(env.shown.at(-1).actions).map((a) => a.action), ['done', 'nav']);
  await env.fire('notificationclick', { action: 'nav', notification: { close() {} } });
  assert.deepEqual(plain(env.messages.at(-1)), { type: 'go', go: 'via' });
});

test('운행 알림: 꺼져 있거나 날짜가 다르면 기록하지 않는다', async () => {
  const env = makeEnv({ trip: { ...trip, on: false }, today });
  await env.fire('notificationclick', { action: 'done', notification: { close() {} } });
  assert.deepEqual(plain(env.store.get('today').courses['1-am'].done), []);
  const env2 = makeEnv({ trip: { ...trip, date: '2026-11-24' }, today });
  await env2.fire('message', { data: { type: 'trip-sync', force: true } });
  assert.equal(env2.shown.length, 0);
});
