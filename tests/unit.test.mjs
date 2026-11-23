// 실행: node --test tests/
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { haversine, getMatrix } from '../js/route/distance.js';
import { nearestNeighbor, twoOpt, improve, pathLength, recommend, schedule, fmtHHMM, parseHHMM } from '../js/route/optimize.js';
import { buildStops, reconcileOrder, stopKeyOf } from '../js/stops.js';
import { buildNaviUrl } from '../js/navi.js';
import { geocode } from '../js/geocode.js';
import { validateBackup, BACKUP_APP } from '../js/backup.js';
import { buildPlan } from '../js/plan.js';
import { sampleData } from '../js/sample.js';
import { parseLatLng } from '../js/util.js';

function permutations(a) {
  if (a.length <= 1) return [a];
  return a.flatMap((x, i) => permutations([...a.slice(0, i), ...a.slice(i + 1)]).map((p) => [x, ...p]));
}

function rng(seed) { let s = seed; return () => { s = (s * 1103515245 + 12345) % 2147483648; return s / 2147483648; }; }

test('haversine: 위도 0.01도 ≈ 1.11km', () => {
  const d = haversine({ lat: 37, lng: 127 }, { lat: 37.01, lng: 127 });
  assert.ok(Math.abs(d - 1112) < 5, String(d));
});

test('2-opt 결과가 완전탐색 최적해와 같거나 매우 가깝다 (무작위 30회, 정류장 7곳)', async () => {
  const rand = rng(42);
  let worst = 0;
  for (let t = 0; t < 30; t++) {
    const start = { lat: 37.4, lng: 127.1 };
    const stops = Array.from({ length: 7 }, (_, i) => ({ key: 'k' + i, lat: 37.4 + (rand() - 0.5) * 0.05, lng: 127.1 + (rand() - 0.5) * 0.05 }));
    const pts = [start, ...stops, start];
    const { matrix } = await getMatrix(pts);
    const heur = pathLength(matrix, improve(matrix, nearestNeighbor(matrix)));
    let best = Infinity;
    for (const p of permutations([1, 2, 3, 4, 5, 6, 7])) best = Math.min(best, pathLength(matrix, [0, ...p, 8]));
    worst = Math.max(worst, heur / best);
  }
  console.log("최악 비율", worst.toFixed(4)); assert.ok(worst < 1.03, `최악 비율 ${worst.toFixed(3)}`);
});

test('출발·도착 노드는 고정', () => {
  const m = [[0, 1, 9, 9], [1, 0, 1, 9], [9, 1, 0, 1], [9, 9, 1, 0]];
  const p = twoOpt(m, nearestNeighbor(m));
  assert.equal(p[0], 0);
  assert.equal(p[p.length - 1], 3);
  assert.deepEqual(p, [0, 1, 2, 3]);
});

test('정류장 0개·1개도 오류 없음', async () => {
  const s = { lat: 37, lng: 127 };
  assert.deepEqual((await recommend(s, s, [])).ordered, []);
  assert.equal((await recommend(s, s, [{ key: 'a', lat: 37.01, lng: 127 }])).ordered.length, 1);
});

test('도로거리 제공자가 실패하면 직선거리로 대체', async () => {
  const bad = { id: 'bad', label: '불량', async matrix() { throw new Error('API down'); } };
  const r = await getMatrix([{ lat: 37, lng: 127 }, { lat: 37.01, lng: 127 }], bad);
  assert.equal(r.providerId, 'straight');
  assert.ok(r.error);
});

test('같은 주소(동·호수만 다름)는 한 정류장, 좌표 없는 원아는 missing', () => {
  const kids = [
    { id: '1', name: 'A', address: '가상시 별빛로 33', detail: '101동', roadAddress: '가상시 별빛로 33', lat: 37.1, lng: 127.1 },
    { id: '2', name: 'B', address: '가상시  별빛로 33', detail: '203동', roadAddress: '가상시 별빛로 33', lat: 37.1, lng: 127.1 },
    { id: '3', name: 'C', address: '가상시 솔빛길 7', lat: 37.2, lng: 127.2 },
    { id: '4', name: 'D', address: '가상시 어딘가', lat: null, lng: null },
  ];
  const { stops, missing } = buildStops(kids);
  assert.equal(stops.length, 2);
  assert.deepEqual(stops[0].children.map((c) => c.name), ['A', 'B']);
  assert.deepEqual(missing.map((c) => c.name), ['D']);
  assert.ok(stopKeyOf(kids[2]).startsWith('c:'));
});

test('저장된 내 순서: 없어진 정류장 제외, 새 정류장은 뒤에', () => {
  const stops = [{ key: 'a' }, { key: 'b' }, { key: 'c' }];
  const r = reconcileOrder(['c', 'x', 'a'], stops);
  assert.deepEqual(r.ordered.map((s) => s.key), ['c', 'a', 'b']);
  assert.equal(r.added, 1);
});

test('예상 시각: 20km/h, 정차 1분', () => {
  const { legs, times } = schedule('08:20', [1000, 2000, 1000], 20, 1);
  assert.deepEqual(legs.map((l) => l.minutes), [3, 6, 3]);
  assert.deepEqual(times.map(fmtHHMM), ['08:20', '08:23', '08:30', '08:34']);
  assert.equal(parseHHMM('잘못'), 480);
});

test('내비 URL', () => {
  const dest = { name: '김하늘, 이바다', lat: 37.1234, lng: 127.5678 };
  assert.equal(buildNaviUrl('kakaomap', dest), 'https://map.kakao.com/link/to/%EA%B9%80%ED%95%98%EB%8A%98%2C%20%EC%9D%B4%EB%B0%94%EB%8B%A4,37.1234,127.5678');
  const ios = buildNaviUrl('naver', dest, { ua: 'iPhone', pageUrl: 'https://ex.github.io/app/' });
  assert.match(ios, /^nmap:\/\/route\/car\?dlat=37\.1234&dlng=127\.5678&dname=.+&appname=https%3A%2F%2Fex\.github\.io%2Fapp%2F$/);
  const and = buildNaviUrl('naver', dest, { ua: 'Linux; Android 14', pageUrl: 'https://ex.github.io/app/' });
  assert.match(and, /^intent:\/\/route\/car\?.+#Intent;scheme=nmap;.+package=com\.nhn\.android\.nmap;end$/);
  assert.equal(buildNaviUrl('tmap', { name: 'X', lat: 37.1, lng: 127.2 }), 'tmap://route?goalname=X&goalx=127.2&goaly=37.1');
  // 이름의 쉼표가 인코딩되어 카카오맵 좌표 구분자와 섞이지 않는다
  assert.ok(!decodeURIComponent(buildNaviUrl('kakaomap', dest).split('/to/')[1].split(',37')[0]).includes('/'));
});

const fakeRes = (status, body) => ({ ok: status >= 200 && status < 300, status, json: async () => body });

test('geocode: 성공 응답에서 x=경도, y=위도', async () => {
  let seen;
  const g = await geocode('가상시 무지개로 12', 'KEY', {
    fetchImpl: async (url, opt) => { seen = { url, opt }; return fakeRes(200, { documents: [{ x: '127.5', y: '37.5', address_name: '가상', road_address: { address_name: '가상시 무지개로 12' } }] }); },
  });
  assert.deepEqual([g.lat, g.lng, g.roadAddress], [37.5, 127.5, '가상시 무지개로 12']);
  assert.equal(seen.opt.headers.Authorization, 'KakaoAK KEY');
  assert.ok(seen.url.startsWith('https://dapi.kakao.com/v2/local/search/address.json?query='));
});

test('geocode: 모든 실패가 GeoError 코드로 정리된다', async () => {
  const cases = [
    [async () => fakeRes(401, { msg: 'invalid' }), 'KEY'],
    [async () => fakeRes(400, { code: -10, msg: 'API limit has been exceeded.' }), 'QUOTA'],
    [async () => fakeRes(403, { message: 'disabled' }), 'DISABLED'],
    [async () => fakeRes(200, { documents: [] }), 'NOT_FOUND'],
    [async () => fakeRes(500, null), 'HTTP'],
    [async () => { throw new TypeError('Failed to fetch'); }, 'NETWORK'],
    [async () => { const e = new Error('abort'); e.name = 'AbortError'; throw e; }, 'TIMEOUT'],
    [async () => ({ ok: true, status: 200, json: async () => { throw new SyntaxError('bad json'); } }), 'NOT_FOUND'],
  ];
  for (const [fetchImpl, code] of cases) {
    await assert.rejects(geocode('주소', 'KEY', { fetchImpl }), (e) => e.code === code, code);
  }
  await assert.rejects(geocode('주소', ''), (e) => e.code === 'NO_KEY');
});

test('백업 검증', () => {
  assert.equal(validateBackup({ app: BACKUP_APP, version: 1, children: [{ id: 'a', name: 'n' }], runs: [{ id: 'r', childIds: [] }] }).ok, true);
  assert.equal(validateBackup({ app: 'other', version: 1, children: [], runs: [] }).ok, false);
  assert.equal(validateBackup({ app: BACKUP_APP, version: 99, children: [], runs: [] }).ok, false);
  assert.equal(validateBackup({ app: BACKUP_APP, version: 1, children: [{}], runs: [] }).ok, false);
  assert.equal(validateBackup(null).ok, false);
});

test('샘플 데이터로 전체 코스 계산 + 결석 반영', async () => {
  const d = sampleData();
  const settings = { speedKmh: 20, dwellMin: 1, daycare: d.settings.daycare };
  const run = d.runs[0];
  const plan = await buildPlan(run, d.children, settings);
  assert.equal(plan.ok, true);
  assert.equal(plan.recommended.ordered.length, 7); // 8명, 2명이 같은 주소
  const absentAll = await buildPlan(run, d.children, settings, { absent: ['c3', 'c4'] });
  assert.equal(absentAll.recommended.ordered.length, 6); // 같은 주소 2명 모두 결석 → 정류장 제외
  const absentOne = await buildPlan(run, d.children, settings, { absent: ['c3'] });
  assert.equal(absentOne.recommended.ordered.length, 7); // 한 명만 결석 → 정류장 유지
  // 내 코스 저장 후 결석: 저장 순서 유지 + 해당 정류장만 빠짐
  const saved = { ...run, myOrder: plan.recommended.ordered.map((s) => s.key).reverse() };
  const p2 = await buildPlan(saved, d.children, settings, { absent: ['c1'] });
  const expect = saved.myOrder.filter((k) => !k.includes('무지개로'));
  assert.deepEqual(p2.mine.ordered.map((s) => s.key), expect);
  // 어린이집 좌표 없음
  const p3 = await buildPlan(run, d.children, { ...settings, daycare: { name: 'x' } });
  assert.equal(p3.ok, false);
  assert.equal(p3.reason, 'NO_DAYCARE');
});

test('좌표 직접 입력 파싱', () => {
  assert.deepEqual(parseLatLng('37.1, 127.2'), { lat: 37.1, lng: 127.2 });
  assert.equal(parseLatLng('127.2, 37.1'), null); // 순서 뒤바뀜 방지
  assert.equal(parseLatLng('abc'), null);
});
