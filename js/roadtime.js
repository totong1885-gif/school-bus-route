// 도로 시간 제공자: 카카오모빌리티 다중 목적지 길찾기 (설정에서 켰을 때만 사용)
// 문서: https://developers.kakaomobility.com/guide/navi-api/destinations.html
//   POST https://apis-navi.kakaomobility.com/v1/destinations/directions
//   Authorization: KakaoAK {REST_API_KEY}, 목적지 최대 30개, radius 최대 10000m
//   응답 routes[].summary.duration(초), distance(미터)
// 무료 제공량(2026-11 확인): 다중 목적지 1,000건/일. 정류장 N곳이면 처음 계산 시 약 N+1건 사용.
// 결과는 메모리에만 둔다(앱을 닫으면 사라짐). 지도 서버에는 좌표만 보내고 이름은 보내지 않는다.
import { haversine } from './optimizer.js';

const ENDPOINT = 'https://apis-navi.kakaomobility.com/v1/destinations/directions';
const pairCache = new Map(); // "lat,lng>lat,lng" → {min, m}

const pt = (p) => `${p.lat.toFixed(6)},${p.lng.toFixed(6)}`;

export class RoadError extends Error {
  constructor(code, message) { super(message); this.code = code; }
}

export function createRoadProvider({ restKey, speedKmh = 30, fetchImpl, timeoutMs = 10000 } = {}) {
  const doFetch = fetchImpl || ((...a) => fetch(...a));
  const straightMin = (a, b) => (haversine(a, b) / 1000 / Math.max(1, speedKmh)) * 60;

  async function callOrigin(origin, dests) {
    const ctrl = typeof AbortController !== 'undefined' ? new AbortController() : null;
    const timer = setTimeout(() => ctrl && ctrl.abort(), timeoutMs);
    let res;
    try {
      res = await doFetch(ENDPOINT, {
        method: 'POST',
        headers: { Authorization: `KakaoAK ${restKey}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({
          origin: { x: origin.lng, y: origin.lat },
          destinations: dests.map((d, i) => ({ key: String(i), x: d.lng, y: d.lat })),
          radius: 10000,
          priority: 'TIME',
        }),
        signal: ctrl ? ctrl.signal : undefined,
      });
    } catch (e) {
      throw new RoadError(e?.name === 'AbortError' ? 'TIMEOUT' : 'NETWORK', '도로 시간 서버에 연결하지 못했습니다');
    } finally {
      clearTimeout(timer);
    }
    let body = null;
    try { body = await res.json(); } catch { /* 무시 */ }
    if (!res.ok) {
      if (res.status === 401) throw new RoadError('KEY', '도로 시간: REST 키를 확인하세요');
      if (res.status === 429 || body?.code === -10) throw new RoadError('QUOTA', '도로 시간: 오늘 무료 사용량을 넘었습니다');
      throw new RoadError('HTTP', `도로 시간 오류 (HTTP ${res.status})`);
    }
    return Array.isArray(body?.routes) ? body.routes : [];
  }

  return {
    id: 'road',
    label: '도로 시간(카카오모빌리티)',
    async matrix(points) {
      if (!restKey) throw new RoadError('NO_KEY', 'REST 키 없음');
      if (typeof navigator !== 'undefined' && navigator.onLine === false) throw new RoadError('OFFLINE', '오프라인');
      const n = points.length;
      let estimated = 0;
      for (let i = 0; i < n; i++) {
        const need = [];
        for (let j = 0; j < n; j++) {
          if (i === j || pt(points[i]) === pt(points[j])) continue;
          const k = `${pt(points[i])}>${pt(points[j])}`;
          if (!pairCache.has(k) && !need.some((p) => pt(p) === pt(points[j]))) need.push(points[j]);
        }
        for (let s = 0; s < need.length; s += 30) {
          const chunk = need.slice(s, s + 30);
          const routes = await callOrigin(points[i], chunk);
          for (const r of routes) {
            const d = chunk[Number(r.key)];
            if (!d) continue;
            if (r.result_code === 0 && r.summary) {
              pairCache.set(`${pt(points[i])}>${pt(d)}`, { min: r.summary.duration / 60, m: r.summary.distance });
            }
          }
        }
      }
      const minutes = [];
      const meters = [];
      for (let i = 0; i < n; i++) {
        minutes.push([]); meters.push([]);
        for (let j = 0; j < n; j++) {
          if (i === j || pt(points[i]) === pt(points[j])) { minutes[i].push(0); meters[i].push(0); continue; }
          const c = pairCache.get(`${pt(points[i])}>${pt(points[j])}`);
          if (c) { minutes[i].push(c.min); meters[i].push(c.m); } else {
            estimated++;
            minutes[i].push(straightMin(points[i], points[j]));
            meters[i].push(haversine(points[i], points[j]));
          }
        }
      }
      return { minutes, meters, note: estimated ? `${estimated}개 구간은 도로 시간을 못 받아 직선으로 추정` : '' };
    },
  };
}

export function clearRoadCache() { pairCache.clear(); }
