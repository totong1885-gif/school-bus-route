import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  resolveRide, ridersFor, buildStops, mergeByGeo, computeTimes, computeCourse, snapshotOf,
  rideType, exceptionNotes, movedInNotes, parseHHMM, fmtHHMM, departOf, applyTodayExtras, compareArrival, elapsedMin, minuteOfDay, durLabel,
} from '../js/model.js';
import { sampleData, SAMPLE_PLACES } from '../js/sample.js';
import { buildNavUrl } from '../js/navlink.js';
import { geocode, createLocator } from '../js/geocode.js';
import { validateBackup, BACKUP_APP } from '../js/backup.js';
import { createRoadProvider } from '../js/roadtime.js';
import { _test as tt } from '../js/views/timetable.js';

const T = { dwellMin: 2, marginFactor: 1.2, roadFactor: 1.3 };
const settingsOf = (d, extra = {}) => ({ speedKmh: 30, ...T, ...d.settings, ...extra });
// 가짜 위치 찾기: 샘플 주소만 앎. 호출 횟수 기록
function fakeLocator(table = SAMPLE_PLACES) {
  const calls = [];
  const fn = async (addrs) => {
    calls.push(...addrs);
    const results = new Map(addrs.map((a) => [a, table[a] ? { ...table[a], roadAddress: a } : null]));
    return { results, error: null };
  };
  fn.calls = calls;
  return fn;
}

test('시각 파싱·표시', () => {
  assert.equal(parseHHMM('08:10'), 490);
  assert.equal(parseHHMM('24:00'), null);
  assert.equal(parseHHMM(''), null);
  assert.equal(fmtHHMM(490.4), '08:10');
  assert.equal(departOf({ departTimes: {} }, 1, 'pm'), parseHHMM('15:50'));
});

test('요일 예외: 안 탐 / 다른 호차 / 그날만 희망 시각', () => {
  const d = sampleData();
  const c5 = d.children.find((c) => c.id === 'c5'); // 금 하원 안 탐
  const c6 = d.children.find((c) => c.id === 'c6'); // 수 등원 1호차, 화 등원 08:40
  assert.equal(resolveRide(c5, 'pm', 5).vehicle, 0);
  assert.equal(resolveRide(c5, 'pm', 4).vehicle, 2);
  assert.equal(resolveRide(c6, 'am', 3).vehicle, 1);
  assert.equal(resolveRide(c6, 'am', 3).changedVehicle, true);
  assert.deepEqual([resolveRide(c6, 'am', 2).vehicle, resolveRide(c6, 'am', 2).desired], [2, '08:40']);
  assert.equal(resolveRide(c6, 'am', null).vehicle, 2); // 기본 배정(요일 없음)
  assert.deepEqual(exceptionNotes(c6, 'am'), ['화 08:40', '수 1호차']);
  assert.deepEqual(exceptionNotes(c5, 'pm'), ['금 ✗']);
  assert.deepEqual(movedInNotes(d.children, 1, 'am'), ['수: 정여름 탑승 (2호차 → 1호차)']);
});

test('등원만/하원만 구분', () => {
  const d = sampleData();
  const t = Object.fromEntries(d.children.map((c) => [c.name, rideType(c)]));
  assert.equal(t['박나래'], 'am');
  assert.equal(t['한가을'], 'pm');
  assert.equal(t['김하늘'], 'both');
});

test('같은 주소(띄어쓰기 차이)·같이 타는 지점은 한 정류장, 희망 시각은 가장 이른 것', () => {
  const stops = buildStops([
    { id: '1', name: 'A', address: '가상시 별빛로 33', desired: '08:20' },
    { id: '2', name: 'B', address: '가상시  별빛로33', desired: '08:10' },
    { id: '3', name: 'C', address: '가상시 솔빛길 7', desired: '' },
  ]);
  assert.equal(stops.length, 2);
  assert.deepEqual(stops[0].riders.map((r) => r.name), ['A', 'B']);
  assert.equal(stops[0].desired, parseHHMM('08:10'));
  // 샘플: 박구름·박나래는 같이 타는 지점(정문)이 같아 1호차 등원 정류장 하나
  const d = sampleData();
  const s = buildStops(ridersFor(d.children, 1, 'am', 1));
  assert.ok(s.some((x) => x.riders.length === 2 && x.address.includes('정문')));
});

test('위치 결과가 같은 건물이면 글자가 달라도 합친다', () => {
  const stops = buildStops([
    { id: '1', name: 'A', address: '가상시 별빛로 33', desired: '' },
    { id: '2', name: 'B', address: '가상시 별빛로 33번지', desired: '' },
  ]);
  const geo = new Map([[stops[0].key, { lat: 37, lng: 127, roadAddress: '가상시 별빛로 33' }], [stops[1].key, { lat: 37, lng: 127, roadAddress: '가상시 별빛로 33' }]]);
  const m = mergeByGeo(stops, geo);
  assert.equal(m.length, 1);
  assert.equal(m[0].keys.length, 2);
});

test('시간 공식: 이동 × 1.3 × 1.2, 정차 2분, 희망 시각 대기·늦음', () => {
  const depart = parseHHMM('08:00');
  // 기본 이동 10분 → 15.6분
  const r = computeTimes(depart, [10, 10, 10], [{ desired: null }, { desired: parseHHMM('08:20') }], T);
  assert.equal(Math.round(r.rows[0].time), parseHHMM('08:16'));
  // 2번: 08:15.6 + 2 + 15.6 = 08:33.2 → 희망 08:20보다 13분 늦음
  assert.equal(Math.round(r.rows[1].late), 13);
  assert.equal(Math.round(r.maxLate), 13);
  const early = computeTimes(depart, [10, 10], [{ desired: parseHHMM('08:30') }], T);
  assert.equal(Math.round(early.rows[0].wait), 14);
  assert.equal(early.rows[0].time, parseHHMM('08:30'));
  assert.equal(Math.round(early.end), parseHHMM('08:30') + 2 + 16); // 대기 후 출발
});

test('코스 계산: 샘플 1호차 등원 + 결석 제외 후 재계산 + 내 코스 유지', async () => {
  const d = sampleData();
  const settings = settingsOf(d);
  const locateMany = fakeLocator();
  const base = { settings, children: d.children, vehicle: 1, shift: 'am', dow: 1, locateMany };
  const c = await computeCourse(base);
  assert.equal(c.ok, true);
  assert.equal(c.recommended.stops.length, 3); // 김하늘, 이바다, 박구름+박나래(정문)
  assert.ok(c.recommended.total <= c.mine.total + 1e-9);
  // 결석: 정문 정류장 두 명 모두 빼면 정류장 2곳
  const c2 = await computeCourse({ ...base, unchecked: ['c3', 'c4'] });
  assert.equal(c2.mine.stops.length, 2);
  // 한 명만 빼면 정류장 유지
  const c3 = await computeCourse({ ...base, unchecked: ['c3'] });
  assert.equal(c3.mine.stops.length, 3);
  // 내 코스(역순) 저장 → 결석해도 남은 순서 유지
  const saved = c.recommended.stops.map((s) => s.key).reverse();
  const c4 = await computeCourse({ ...base, savedOrder: saved, unchecked: ['c1'] });
  assert.deepEqual(c4.mine.stops.map((s) => s.key), saved.filter((k) => !k.includes('무지개로')));
  assert.equal(c4.hasSaved, true);
  // 오늘만 바꾼 순서가 내 코스보다 우선
  const manual = [saved[1], saved[0], saved[2]];
  const c5 = await computeCourse({ ...base, savedOrder: saved, manualOrder: manual });
  assert.deepEqual(c5.mine.stops.map((s) => s.key), manual);
});

test('코스 계산: 수요일엔 다른 호차 아이가 1호차 경로에 끼워 들어간다', async () => {
  const d = sampleData();
  const base = { settings: settingsOf(d), children: d.children, vehicle: 1, shift: 'am', locateMany: fakeLocator() };
  const mon = await computeCourse({ ...base, dow: 1 });
  const saved = mon.recommended.stops.map((s) => s.key);
  const wed = await computeCourse({ ...base, dow: 3, savedOrder: saved });
  assert.equal(wed.mine.stops.length, 4);
  assert.ok(wed.mine.stops.some((s) => s.riders.some((r) => r.name === '정여름' && r.moved)));
  // 기존 3곳의 상대 순서는 유지
  assert.deepEqual(wed.mine.stops.map((s) => s.key).filter((k) => saved.includes(k)), saved);
});

test('코스 계산: 정류장 0개·1개, 어린이집 주소 없음/위치 못 찾음, 일부 주소 실패', async () => {
  const d = sampleData();
  const settings = settingsOf(d);
  const zero = await computeCourse({ settings, children: [], vehicle: 1, shift: 'am', dow: 1, locateMany: fakeLocator() });
  assert.equal(zero.ok, true);
  assert.equal(zero.mine.stops.length, 0);
  const one = await computeCourse({ settings, children: [d.children[0]], vehicle: 1, shift: 'am', dow: 1, locateMany: fakeLocator() });
  assert.equal(one.mine.stops.length, 1);
  const noDc = await computeCourse({ settings: { ...settings, daycare: { name: 'x', address: '' } }, children: d.children, vehicle: 1, shift: 'am', locateMany: fakeLocator() });
  assert.equal(noDc.reason, 'NO_DAYCARE');
  const geoFail = await computeCourse({ settings, children: d.children, vehicle: 1, shift: 'am', locateMany: fakeLocator({}) });
  assert.equal(geoFail.ok, false);
  const partial = { ...SAMPLE_PLACES };
  delete partial['햇살시 솔빛길 7'];
  const p = await computeCourse({ settings, children: d.children, vehicle: 1, shift: 'am', dow: 1, locateMany: fakeLocator(partial) });
  assert.equal(p.ok, true);
  assert.equal(p.failed.length, 1);
  assert.equal(p.mine.stops.length, 2);
});

test('스냅샷에는 좌표가 들어가지 않는다', async () => {
  const d = sampleData();
  const c = await computeCourse({ settings: settingsOf(d), children: d.children, vehicle: 1, shift: 'am', dow: 1, locateMany: fakeLocator() });
  const json = JSON.stringify(snapshotOf(c, { date: '2026-11-23' }));
  assert.ok(!/"lat"|"lng"/.test(json), json);
  assert.ok(json.includes('김하늘'));
});

test('내비 URL', () => {
  const dest = { name: '김하늘, 이바다', lat: 37.1234, lng: 127.5678 };
  const page = 'https://ex.github.io/app/';
  assert.match(buildNavUrl('naver', dest, { ua: 'iPhone', pageUrl: page }), /^nmap:\/\/route\/car\?dlat=37\.1234&dlng=127\.5678&dname=.+&appname=https%3A%2F%2Fex\.github\.io%2Fapp%2F$/);
  assert.match(buildNavUrl('naver', dest, { ua: 'Android 14', pageUrl: page }), /^intent:\/\/route\/car\?.+#Intent;scheme=nmap;.+package=com\.nhn\.android\.nmap;end$/);
  assert.equal(buildNavUrl('kakaomap', dest, { ua: 'Android' }), 'kakaomap://route?ep=37.1234,127.5678&by=car');
  assert.match(buildNavUrl('kakaomap', dest, { ua: 'Windows' }), /^https:\/\/map\.kakao\.com\/link\/to\/.+,37\.1234,127\.5678$/);
  assert.equal(buildNavUrl('kakaonavi', dest, { ua: 'iPhone' }), 'kakaomap://route?ep=37.1234,127.5678&by=car'); // SDK 없을 때 대체
  assert.equal(buildNavUrl('tmap', { name: 'X', lat: 37.1, lng: 127.2 }), 'tmap://route?goalname=X&goalx=127.2&goaly=37.1');
});

const res = (status, body) => ({ ok: status >= 200 && status < 300, status, json: async () => body });

test('주소 검색: 성공, 모든 실패 유형이 쉬운 안내로', async () => {
  const ok = await geocode('가상시 1', 'K', { fetchImpl: async (u, o) => { assert.equal(o.headers.Authorization, 'KakaoAK K'); return res(200, { documents: [{ x: '127.5', y: '37.5', road_address: { address_name: '도로명' } }] }); } });
  assert.deepEqual([ok.lat, ok.lng, ok.roadAddress], [37.5, 127.5, '도로명']);
  const cases = [
    [async () => res(401, {}), 'KEY'],
    [async () => res(400, { code: -10, msg: 'API limit has been exceeded.' }), 'QUOTA'],
    [async () => res(403, {}), 'DISABLED'],
    [async () => res(200, { documents: [] }), 'NOT_FOUND'],
    [async () => res(500, null), 'HTTP'],
    [async () => { throw new TypeError('Failed to fetch'); }, 'NETWORK'],
    [async () => { const e = new Error('x'); e.name = 'AbortError'; throw e; }, 'TIMEOUT'],
  ];
  for (const [fetchImpl, code] of cases) await assert.rejects(geocode('가상시 1', 'K', { fetchImpl }), (e) => e.code === code && /[가-힣]/.test(e.message));
  await assert.rejects(geocode('가상시 1', ''), (e) => e.code === 'NO_KEY');
  // 샘플 주소는 키 없이 가짜 좌표
  assert.equal((await geocode('햇살시 중앙로 1', '')).sample, true);
});

test('위치 찾기(여러 개): 키 오류면 나머지를 더 시도하지 않음, 캐시는 메모리만', async () => {
  let n = 0;
  const loc = createLocator(() => 'K', { fetchImpl: async () => { n++; return res(401, {}); } });
  const r = await loc(['a1', 'a2', 'a3', 'a4', 'a5', 'a6']);
  assert.equal(r.error.code, 'KEY');
  assert.ok(n <= 3, `호출 ${n}회`);
  assert.equal(r.failedCount, 6);
});

test('도로 시간 제공자: 응답 파싱·캐시·실패 처리 (가짜 서버)', async () => {
  const pts = [{ lat: 37.4, lng: 127.1 }, { lat: 37.41, lng: 127.1 }, { lat: 37.4, lng: 127.12 }, { lat: 37.4, lng: 127.1 }];
  let calls = 0;
  const fetchImpl = async (url, opt) => {
    calls++;
    const b = JSON.parse(opt.body);
    assert.ok(!JSON.stringify(b).includes('name'), '이름을 보내면 안 됨');
    return res(200, { routes: b.destinations.map((d) => ({ key: d.key, result_code: 0, summary: { duration: 600, distance: 2000 } })) });
  };
  const p = createRoadProvider({ restKey: 'K', fetchImpl });
  const m = await p.matrix(pts);
  assert.equal(m.minutes[0][1], 10);
  assert.equal(m.minutes[0][3], 0); // 같은 지점(출발=도착)
  const before = calls;
  await p.matrix(pts.slice(0, 3).concat([pts[0]]));
  assert.equal(calls, before, '캐시된 구간은 다시 호출하지 않음');
  const bad = createRoadProvider({ restKey: 'K', fetchImpl: async () => res(429, { code: -10 }) });
  await assert.rejects(bad.matrix([{ lat: 36, lng: 127 }, { lat: 36.1, lng: 127 }]), (e) => e.code === 'QUOTA');
});

test('명단 파일 검사', () => {
  assert.equal(validateBackup({ app: BACKUP_APP, version: 2, children: [{ id: 'a', name: 'n', address: 'x' }], courses: [{ id: '1-am', order: [] }] }).ok, true);
  assert.equal(validateBackup({ app: BACKUP_APP, version: 1, children: [], courses: [] }).ok, false);
  assert.equal(validateBackup({ app: 'x', version: 2, children: [] }).ok, false);
  assert.equal(validateBackup({ app: BACKUP_APP, version: 2, children: [{ id: 'a' }] }).ok, false);
  assert.equal(validateBackup('문자열').ok, false);
});

test('시간표 복사: 엑셀(등원·하원 나란히)·카톡 텍스트', () => {
  const data = {
    n: 1,
    sections: {
      '1-am': { depart: 483, end: 520, stops: [{ names: [{ name: '김하늘', notes: [] }], time: 486 }, { names: [{ name: '최새봄', notes: ['금 ✗'] }], time: 491 }], movedIn: [] },
      '1-pm': { depart: 950, end: 990, stops: [{ names: [{ name: '김하늘', notes: [] }], time: 954 }], movedIn: ['수: 정여름 탑승 (2호차 → 1호차)'] },
    },
  };
  const rows = tt.excelRows(data, 1);
  assert.deepEqual(rows[2], ['1호차 08:03 출발', '김하늘', '08:06', '1호차 15:50 출발', '김하늘', '15:54']);
  assert.deepEqual(rows[3].slice(0, 3), ['', '최새봄(금 ✗)', '08:11']);
  const text = tt.kakaoText(data, 1, '제목');
  assert.match(text, /\[등원\]\n■ 1호차 08:03 출발\n {2}08:06 김하늘/);
  assert.match(text, /\* 수: 정여름 탑승/);
});

test('오늘만 추가: 명단 아이를 다른 호차로 옮기고, 명단에 없는 아이를 임시로 넣는다 (원본 명단은 그대로)', () => {
  const kids = [
    { id: 'a', name: '가', address: '햇살시 가길 1', am: { vehicle: 1 }, pm: { vehicle: 1 } },
    { id: 'b', name: '나', address: '햇살시 나길 2', am: { vehicle: 2 }, pm: { vehicle: 0 } },
  ];
  const extras = [
    { kind: 'roster', childId: 'b', vehicle: 1, shift: 'pm', desired: '17:30' },
    { kind: 'temp', id: 'tmp1', name: '임시아이', address: '햇살시 다길 3', vehicle: 1, shift: 'pm' },
    { kind: 'temp', id: 'tmp2', name: '주소없음', address: ' ', vehicle: 1, shift: 'pm' },
  ];
  const today = applyTodayExtras(kids, extras, 2);
  const pm1 = ridersFor(today, 1, 'pm', 2);
  assert.deepEqual(pm1.map((r) => r.id), ['a', 'b', 'tmp1']);
  assert.equal(pm1.find((r) => r.id === 'b').desired, '17:30');
  assert.equal(pm1.find((r) => r.id === 'tmp1').temp, true);
  // 다른 요일·등원에는 영향 없음, 원본도 그대로
  assert.deepEqual(ridersFor(today, 1, 'pm', 3).map((r) => r.id), ['a']);
  assert.deepEqual(ridersFor(today, 2, 'am', 2).map((r) => r.id), ['b']);
  assert.equal(kids.length, 2);
  assert.equal(kids[1].exceptions, undefined);
  // 다른 호차에 타던 아이를 옮기면 원래 호차에서 빠진다
  const moved = applyTodayExtras(kids, [{ kind: 'roster', childId: 'a', vehicle: 2, shift: 'am' }], 2);
  assert.deepEqual(ridersFor(moved, 1, 'am', 2).map((r) => r.id), []);
  assert.deepEqual(ridersFor(moved, 2, 'am', 2).map((r) => r.id).sort(), ['a', 'b']);
});

test('도착 기록: 예정 시각과 비교, 출발 후 걸린 시간', () => {
  const at = (h, m) => new Date(2026, 10, 24, h, m, 30).getTime();
  assert.equal(minuteOfDay(at(17, 8)), 17 * 60 + 8);
  assert.deepEqual(compareArrival(at(17, 8), 17 * 60 + 6), { diff: 2, cls: 'late', text: '예정보다 2분 늦음' });
  assert.deepEqual(compareArrival(at(17, 3), 17 * 60 + 6), { diff: -3, cls: 'early', text: '예정보다 3분 빠름' });
  assert.equal(compareArrival(at(17, 6), 17 * 60 + 6).text, '예정대로');
  assert.equal(compareArrival(NaN, 100), null);
  assert.equal(elapsedMin(at(17, 2), at(17, 21)), 19);
  assert.equal(elapsedMin(null, at(17, 2)), null);
  assert.equal(compareArrival(at(20, 28), 17 * 60 + 10).text, '예정보다 3시간 18분 늦음');
  assert.equal(durLabel(60), '1시간');
});

test('applyTtEdits / ttEditOf: 직접 고친 시각을 덮어쓰고 계산값은 남긴다', async () => {
  const { applyTtEdits, ttEditOf, TT_END } = await import('../js/model.js');
  const sections = {
    '1-am': { vehicle: 1, shift: 'am', depart: 480, end: 525, stops: [
      { key: 'a', keys: ['a', 'b'], time: 499, late: 3 },
      { key: 'c', keys: ['c'], time: 510, late: 0 },
    ] },
    '2-am': null,
  };
  const tt = { courses: { '1-am': { b: '08:25', [TT_END]: '08:50', c: 'bad' } } };
  const out = applyTtEdits(sections, tt);
  assert.equal(out['1-am'].stops[0].time, 505);
  assert.equal(out['1-am'].stops[0].calc, 499);
  assert.equal(out['1-am'].stops[0].edited, true);
  assert.equal(out['1-am'].stops[0].late, 0);
  assert.equal(out['1-am'].stops[1].edited, undefined);
  assert.equal(out['1-am'].end, 530);
  assert.equal(out['1-am'].calcEnd, 525);
  assert.equal(out['2-am'], null);
  assert.equal(sections['1-am'].stops[0].time, 499, '원본은 그대로');
  assert.equal(ttEditOf(null, '1-am', 'a'), null);
  assert.equal(ttEditOf(tt, '1-pm', 'b'), null);
});

test('buildNavUrl: 네이버지도 경유지(최대 5곳, 좌표 없는 곳 제외)', () => {
  const dest = { name: '어린이집', lat: 37.5, lng: 127.5 };
  const via = [{ name: '가', lat: 37.1, lng: 127.1 }, { name: '나', lat: NaN, lng: 1 }, ...[2, 3, 4, 5, 6].map((i) => ({ name: 'v' + i, lat: 37 + i / 10, lng: 127 }))];
  const u = buildNavUrl('naver', { ...dest, via }, { ua: 'iPhone', pageUrl: 'https://ex/' });
  assert.match(u, /^nmap:\/\/route\/car\?dlat=37\.5&dlng=127\.5&dname=.+&v1lat=37\.1&v1lng=127\.1&v1name=%EA%B0%80&v2lat=37\.2&.+&v5lat=37\.5&v5lng=127&v5name=v5&appname=/);
  assert.doesNotMatch(u, /v6lat|NaN/);
  assert.equal(buildNavUrl('kakaomap', { ...dest, via }, { ua: 'Android' }), 'kakaomap://route?ep=37.5,127.5&by=car');
});
