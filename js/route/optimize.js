// 경로 순서 최적화: nearest neighbor로 초기해 → 2-opt 개선.
// 노드 0 = 출발(어린이집), 노드 n-1 = 도착(어린이집)은 고정. 중간 노드만 순서를 바꾼다.
// 거리 행렬이 비대칭(도로거리)이어도 맞게 동작하도록 경로 전체 길이로 비교한다.
import { getMatrix, haversine } from './distance.js';

export function pathLength(m, path) {
  let sum = 0;
  for (let i = 0; i < path.length - 1; i++) sum += m[path[i]][path[i + 1]];
  return sum;
}

export function nearestNeighbor(m) {
  const n = m.length;
  if (n <= 2) return [...Array(n).keys()];
  const rest = new Set();
  for (let i = 1; i < n - 1; i++) rest.add(i);
  const path = [0];
  let cur = 0;
  while (rest.size) {
    let best = -1;
    let bestD = Infinity;
    for (const j of rest) {
      if (m[cur][j] < bestD) { bestD = m[cur][j]; best = j; }
    }
    path.push(best);
    rest.delete(best);
    cur = best;
  }
  path.push(n - 1);
  return path;
}

export function twoOpt(m, initial, maxRounds = 200) {
  let path = initial.slice();
  let best = pathLength(m, path);
  for (let round = 0; round < maxRounds; round++) {
    let improved = false;
    for (let i = 1; i < path.length - 2; i++) {
      for (let k = i + 1; k < path.length - 1; k++) {
        const cand = path.slice(0, i).concat(path.slice(i, k + 1).reverse(), path.slice(k + 1));
        const len = pathLength(m, cand);
        if (len < best - 1e-6) { path = cand; best = len; improved = true; }
      }
    }
    if (!improved) break;
  }
  return path;
}

// Or-opt: 정류장 1~3개 묶음을 다른 위치로 옮겨 보는 개선 (2-opt가 놓치는 경우 보완)
export function orOpt(m, initial) {
  let path = initial.slice();
  let best = pathLength(m, path);
  let improved = true;
  while (improved) {
    improved = false;
    for (let len = 1; len <= 3; len++) {
      for (let i = 1; i + len <= path.length - 1; i++) {
        const seg = path.slice(i, i + len);
        const rest = path.slice(0, i).concat(path.slice(i + len));
        for (let j = 1; j < rest.length; j++) {
          if (j === i) continue;
          for (const s of [seg, seg.slice().reverse()]) {
            const cand = rest.slice(0, j).concat(s, rest.slice(j));
            const l = pathLength(m, cand);
            if (l < best - 1e-6) { path = cand; best = l; improved = true; break; }
          }
          if (improved) break;
        }
        if (improved) break;
      }
      if (improved) break;
    }
  }
  return path;
}

export function improve(m, initial) {
  let path = initial;
  for (let k = 0; k < 20; k++) {
    const before = pathLength(m, path);
    path = orOpt(m, twoOpt(m, path));
    if (pathLength(m, path) >= before - 1e-6) break;
  }
  return path;
}

/**
 * 추천 순서 계산
 * @param start {lat,lng} 출발
 * @param end   {lat,lng} 도착
 * @param stops [{key, lat, lng, ...}]
 * @param provider 거리 제공자 (기본 직선거리)
 * @returns {ordered, providerLabel, error?}
 */
export async function recommend(start, end, stops, provider) {
  if (!stops.length) return { ordered: [], providerLabel: '직선거리' };
  const pts = [start, ...stops, end];
  const { matrix, label, error } = await getMatrix(pts, provider);
  const path = improve(matrix, nearestNeighbor(matrix));
  return { ordered: path.slice(1, -1).map((i) => stops[i - 1]), providerLabel: label, error };
}

/** 구간 거리(미터) 목록: 출발→1, 1→2, ..., 마지막→도착 */
export function legDistances(start, end, ordered) {
  const pts = [start, ...ordered, end];
  const legs = [];
  for (let i = 0; i < pts.length - 1; i++) legs.push(haversine(pts[i], pts[i + 1]));
  return legs;
}

/**
 * 예상 시각 계산 (직선거리 기준 추정)
 * @returns {legs:[{meters, minutes}], times:[분(자정 기준)] (출발, 각 정류장, 도착)}
 */
export function schedule(departHHMM, legsMeters, speedKmh = 20, dwellMin = 1) {
  const start = parseHHMM(departHHMM);
  const speed = Math.max(1, Number(speedKmh) || 20);
  const dwell = Math.max(0, Number(dwellMin) || 0);
  const times = [start];
  const legs = [];
  let t = start;
  legsMeters.forEach((m, i) => {
    const minutes = Math.round((m / 1000 / speed) * 60);
    legs.push({ meters: m, minutes });
    t += minutes;
    times.push(t);
    if (i < legsMeters.length - 1) t += dwell; // 중간 정류장 정차
  });
  return { legs, times };
}

export function parseHHMM(s) {
  const m = /^(\d{1,2}):(\d{2})$/.exec(String(s || '').trim());
  if (!m) return 8 * 60;
  return Math.min(23, +m[1]) * 60 + Math.min(59, +m[2]);
}

export function fmtHHMM(min) {
  const v = ((Math.round(min) % 1440) + 1440) % 1440;
  return `${String(Math.floor(v / 60)).padStart(2, '0')}:${String(v % 60).padStart(2, '0')}`;
}

export function fmtKm(m) {
  return `${(m / 1000).toFixed(1)}km`;
}
