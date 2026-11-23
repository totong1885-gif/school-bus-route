// 방문 순서 최적화 + 거리/시간 제공자(provider) 인터페이스
//
// provider: { id, label, async matrix(points) -> { minutes: number[][], meters: number[][] } }
//   points: [{lat, lng}, ...]   (0번 = 출발, 마지막 = 도착)
// 기본은 직선거리 제공자. 도로시간 API는 roadtime.js 제공자를 넘기면 된다.
// 제공자가 실패하면 getMatrix가 직선거리로 대체한다(앱이 멈추지 않게).

const R = 6371000;
const rad = (d) => (d * Math.PI) / 180;

export function haversine(a, b) {
  const dLat = rad(b.lat - a.lat);
  const dLng = rad(b.lng - a.lng);
  const s = Math.sin(dLat / 2) ** 2 + Math.cos(rad(a.lat)) * Math.cos(rad(b.lat)) * Math.sin(dLng / 2) ** 2;
  return 2 * R * Math.asin(Math.min(1, Math.sqrt(s)));
}

export function createStraightProvider(speedKmh = 30) {
  const speed = Math.max(1, Number(speedKmh) || 30);
  return {
    id: 'straight',
    label: '직선거리 추정',
    async matrix(points) {
      const meters = points.map((p) => points.map((q) => haversine(p, q)));
      const minutes = meters.map((row) => row.map((m) => (m / 1000 / speed) * 60));
      return { minutes, meters };
    },
  };
}

function validMatrix(m, n) {
  return Array.isArray(m) && m.length === n && m.every((r) => Array.isArray(r) && r.length === n && r.every((v) => Number.isFinite(v)));
}

/** provider로 행렬을 얻고, 실패하면 fallback(직선)으로 대체 */
export async function getMatrix(points, provider, fallback) {
  const fb = fallback || createStraightProvider();
  if (provider && provider !== fb) {
    try {
      const r = await provider.matrix(points);
      if (validMatrix(r?.minutes, points.length) && validMatrix(r?.meters, points.length)) {
        return { ...r, label: provider.label, providerId: provider.id, note: r.note || '' };
      }
      throw new Error('잘못된 응답');
    } catch (e) {
      const r = await fb.matrix(points);
      return { ...r, label: fb.label, providerId: fb.id, error: e };
    }
  }
  const r = await fb.matrix(points);
  return { ...r, label: fb.label, providerId: fb.id };
}

export function pathCost(m, path) {
  let s = 0;
  for (let i = 0; i < path.length - 1; i++) s += m[path[i]][path[i + 1]];
  return s;
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
    let bd = Infinity;
    for (const j of rest) if (m[cur][j] < bd) { bd = m[cur][j]; best = j; }
    path.push(best);
    rest.delete(best);
    cur = best;
  }
  path.push(n - 1);
  return path;
}

// 2-opt: 구간 뒤집기. 비대칭 행렬(도로시간)도 맞도록 경로 전체 비용으로 비교
export function twoOpt(m, initial) {
  let path = initial.slice();
  let best = pathCost(m, path);
  for (let round = 0; round < 200; round++) {
    let improved = false;
    for (let i = 1; i < path.length - 2; i++) {
      for (let k = i + 1; k < path.length - 1; k++) {
        const cand = path.slice(0, i).concat(path.slice(i, k + 1).reverse(), path.slice(k + 1));
        const c = pathCost(m, cand);
        if (c < best - 1e-9) { path = cand; best = c; improved = true; }
      }
    }
    if (!improved) break;
  }
  return path;
}

// Or-opt: 정류장 1~3개 묶음을 다른 위치로 옮겨 보기 (2-opt 보완)
export function orOpt(m, initial) {
  let path = initial.slice();
  let best = pathCost(m, path);
  let improved = true;
  let guard = 0;
  while (improved && guard++ < 500) {
    improved = false;
    outer:
    for (let len = 1; len <= 3; len++) {
      for (let i = 1; i + len <= path.length - 1; i++) {
        const seg = path.slice(i, i + len);
        const rest = path.slice(0, i).concat(path.slice(i + len));
        for (let j = 1; j < rest.length; j++) {
          if (j === i) continue;
          for (const s of [seg, seg.slice().reverse()]) {
            const cand = rest.slice(0, j).concat(s, rest.slice(j));
            const c = pathCost(m, cand);
            if (c < best - 1e-9) { path = cand; best = c; improved = true; break outer; }
          }
        }
      }
    }
  }
  return path;
}

// 정류장이 적을 때(≤ EXACT_LIMIT)는 Held-Karp 동적계획법으로 정확한 최적해를 구한다.
// (10곳이면 약 10만 번 계산, 휴대폰에서도 즉시 끝남)
export const EXACT_LIMIT = 10;

export function exactPath(m) {
  const n = m.length;
  const k = n - 2; // 중간 정류장 수
  if (k <= 1) return [...Array(n).keys()];
  const full = (1 << k) - 1;
  const dp = new Float64Array((1 << k) * k).fill(Infinity);
  const parent = new Int16Array((1 << k) * k).fill(-1);
  for (let j = 0; j < k; j++) dp[(1 << j) * k + j] = m[0][j + 1];
  for (let mask = 1; mask <= full; mask++) {
    for (let j = 0; j < k; j++) {
      const cur = dp[mask * k + j];
      if (!(mask & (1 << j)) || cur === Infinity) continue;
      for (let nx = 0; nx < k; nx++) {
        if (mask & (1 << nx)) continue;
        const nm = mask | (1 << nx);
        const v = cur + m[j + 1][nx + 1];
        if (v < dp[nm * k + nx]) { dp[nm * k + nx] = v; parent[nm * k + nx] = j; }
      }
    }
  }
  let best = Infinity;
  let last = 0;
  for (let j = 0; j < k; j++) {
    const v = dp[full * k + j] + m[j + 1][n - 1];
    if (v < best) { best = v; last = j; }
  }
  const order = [];
  let mask = full;
  let j = last;
  while (j >= 0) {
    order.push(j + 1);
    const pj = parent[mask * k + j];
    mask &= ~(1 << j);
    j = pj;
  }
  return [0, ...order.reverse(), n - 1];
}

/** 추천 경로(행렬 인덱스). 0과 n-1은 고정 */
export function optimize(m) {
  if (m.length - 2 <= EXACT_LIMIT) return exactPath(m);
  return heuristicPath(m);
}

/** nearest neighbor → 2-opt → Or-opt (정류장이 많을 때) */
export function heuristicPath(m) {
  let path = nearestNeighbor(m);
  for (let k = 0; k < 20; k++) {
    const before = pathCost(m, path);
    path = orOpt(m, twoOpt(m, path));
    if (pathCost(m, path) >= before - 1e-9) break;
  }
  return path;
}

/** idx를 path(0..end 고정)에 가장 덜 돌아가는 위치로 끼워 넣기 */
export function insertCheapest(m, path, idx) {
  let bestPos = path.length - 1;
  let bestAdd = Infinity;
  for (let p = 1; p < path.length; p++) {
    const a = path[p - 1];
    const b = path[p];
    const add = m[a][idx] + m[idx][b] - m[a][b];
    if (add < bestAdd - 1e-9) { bestAdd = add; bestPos = p; }
  }
  return path.slice(0, bestPos).concat([idx], path.slice(bestPos));
}

/**
 * 저장된 순서(키 목록)를 현재 정류장에 맞춘다.
 *  - 없어진 정류장은 빼고, 새 정류장은 가장 덜 돌아가는 위치에 끼워 넣는다.
 * @param keysOfIdx 행렬 인덱스(1..n) → 그 정류장이 인정하는 키 배열
 * @returns 경로(행렬 인덱스, 0과 끝 포함)
 */
export function reconcile(m, savedKeys, keysOfIdx) {
  const n = m.length;
  const used = new Set();
  const path = [0];
  for (const k of savedKeys || []) {
    for (let i = 1; i < n - 1; i++) {
      if (!used.has(i) && keysOfIdx[i].includes(k)) { path.push(i); used.add(i); break; }
    }
  }
  path.push(n - 1);
  let out = path;
  for (let i = 1; i < n - 1; i++) if (!used.has(i)) out = insertCheapest(m, out, i);
  return out;
}
