// 실행: node --test tests/
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { haversine, createStraightProvider, getMatrix, nearestNeighbor, optimize, exactPath, heuristicPath, pathCost, insertCheapest, reconcile } from '../js/optimizer.js';

function perms(a) {
  if (a.length <= 1) return [a];
  return a.flatMap((x, i) => perms([...a.slice(0, i), ...a.slice(i + 1)]).map((p) => [x, ...p]));
}
function rng(seed) { let s = seed; return () => { s = (s * 1103515245 + 12345) % 2147483648; return s / 2147483648; }; }

test('haversine: 위도 0.01도 ≈ 1.11km', () => {
  assert.ok(Math.abs(haversine({ lat: 37, lng: 127 }, { lat: 37.01, lng: 127 }) - 1112) < 5);
});

test('최적화 결과가 완전탐색 최적해와 같다 (무작위 30회 × 정류장 7곳)', async () => {
  const rand = rng(7);
  const sp = createStraightProvider(30);
  let worst = 1;
  for (let t = 0; t < 30; t++) {
    const s = { lat: 37.4, lng: 127.1 };
    const stops = Array.from({ length: 7 }, () => ({ lat: 37.4 + (rand() - 0.5) * 0.06, lng: 127.1 + (rand() - 0.5) * 0.06 }));
    const { minutes } = await sp.matrix([s, ...stops, s]);
    const heur = pathCost(minutes, optimize(minutes));
    let best = Infinity;
    for (const p of perms([1, 2, 3, 4, 5, 6, 7])) best = Math.min(best, pathCost(minutes, [0, ...p, 8]));
    worst = Math.max(worst, heur / best);
  }
  assert.ok(worst < 1.0001, `최악 비율 ${worst}`);
});

test('정류장이 많을 때 NN + 2-opt + Or-opt 품질 (8곳, 정확해 대비 30회)', async () => {
  const rand = rng(99);
  const sp = createStraightProvider(30);
  let worst = 1;
  let sum = 0;
  for (let t = 0; t < 30; t++) {
    const s = { lat: 37.4, lng: 127.1 };
    const stops = Array.from({ length: 8 }, () => ({ lat: 37.4 + (rand() - 0.5) * 0.06, lng: 127.1 + (rand() - 0.5) * 0.06 }));
    const { minutes } = await sp.matrix([s, ...stops, s]);
    const r = pathCost(minutes, heuristicPath(minutes)) / pathCost(minutes, exactPath(minutes));
    worst = Math.max(worst, r);
    sum += r;
  }
  console.log(`휴리스틱 평균 ${(sum / 30).toFixed(4)}, 최악 ${worst.toFixed(4)}`);
  assert.ok(worst < 1.05, `최악 비율 ${worst}`);
});

test('정류장 30곳도 빠르게 계산', async () => {
  const rand = rng(5);
  const s = { lat: 37.4, lng: 127.1 };
  const stops = Array.from({ length: 30 }, () => ({ lat: 37.4 + (rand() - 0.5) * 0.08, lng: 127.1 + (rand() - 0.5) * 0.08 }));
  const { minutes } = await createStraightProvider(30).matrix([s, ...stops, s]);
  const t0 = performance.now();
  const p = optimize(minutes);
  const ms = performance.now() - t0;
  assert.equal(new Set(p).size, 32);
  assert.ok(ms < 2000, `${ms}ms`);
  const t1 = performance.now();
  exactPath(minutes.slice(0, 12).map((r) => r.slice(0, 12))); // 10곳 정확해 시간
  console.log(`30곳 ${ms.toFixed(0)}ms, 정확해 10곳 ${(performance.now() - t1).toFixed(0)}ms`);
});

test('비대칭 행렬(도로 시간)에서도 출발·도착 고정, 모든 정류장 포함', () => {
  const m = [
    [0, 5, 9, 4, 0],
    [6, 0, 2, 7, 6],
    [9, 1, 0, 3, 9],
    [4, 8, 2, 0, 4],
    [0, 5, 9, 4, 0],
  ];
  const p = optimize(m);
  assert.equal(p[0], 0);
  assert.equal(p[p.length - 1], 4);
  assert.deepEqual([...p].sort(), [0, 1, 2, 3, 4]);
  let best = Infinity;
  for (const q of perms([1, 2, 3])) best = Math.min(best, pathCost(m, [0, ...q, 4]));
  assert.equal(pathCost(m, p), best);
});

test('정류장 0개·1개 경계', () => {
  assert.deepEqual(optimize([[0, 0], [0, 0]]), [0, 1]);
  assert.deepEqual(optimize([[0, 1, 0], [1, 0, 1], [0, 1, 0]]), [0, 1, 2]);
  assert.deepEqual(nearestNeighbor([[0]]), [0]);
});

test('제공자 실패 시 직선거리로 대체', async () => {
  const bad = { id: 'bad', label: '불량', async matrix() { throw new Error('down'); } };
  const r = await getMatrix([{ lat: 37, lng: 127 }, { lat: 37.01, lng: 127 }], bad, createStraightProvider(30));
  assert.equal(r.providerId, 'straight');
  assert.ok(r.error);
  const wrong = { id: 'w', label: 'w', async matrix() { return { minutes: [[0]], meters: [[0]] }; } };
  assert.equal((await getMatrix([{ lat: 37, lng: 127 }, { lat: 37.01, lng: 127 }], wrong)).providerId, 'straight');
});

test('가장 덜 돌아가는 위치에 끼워 넣기', () => {
  // 0 —1— 2 —1— 3(끝), 1번은 0과 2 사이에 있는 점
  const pos = [0, 1, 2, 3].map((x) => x);
  const m = pos.map((a) => pos.map((b) => Math.abs(a - b)));
  m[3] = m[3].map((_, j) => Math.abs(0 - pos[j])); // 끝 = 출발과 같은 위치
  pos[3] = 0;
  const mm = pos.map((a) => pos.map((b) => Math.abs(a - b)));
  assert.deepEqual(insertCheapest(mm, [0, 2, 3], 1), [0, 1, 2, 3]);
});

test('저장된 순서 맞추기: 없어진 정류장 제외, 새 정류장 끼워 넣기, 별칭 키 인정', () => {
  const xs = [0, 1, 2, 3, 0];
  const m = xs.map((a) => xs.map((b) => Math.abs(a - b)));
  const keys = [null, ['a'], ['b', 'b2'], ['c'], null];
  // 저장 순서 c, b2(=b의 별칭), x(없음). a는 새로 생김 → 끼워 넣기
  const p = reconcile(m, ['c', 'b2', 'x'], keys);
  assert.deepEqual(p.slice(1, -1).includes(1), true);
  assert.deepEqual(p.filter((i) => i === 3 || i === 2), [3, 2]); // c가 b보다 앞 (저장 순서 유지)
  assert.equal(p.length, 5);
});
