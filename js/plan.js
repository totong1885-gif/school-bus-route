// 회차(run) + 원아 + 설정 → 화면에 그릴 코스 계산. 코스·오늘 화면이 같이 쓴다.
import { buildStops, reconcileOrder, hasCoords } from './stops.js';
import { recommend, legDistances, schedule } from './route/optimize.js';
import { straightProvider } from './route/distance.js';

export function runChildren(run, children, absentIds = []) {
  const ids = new Set(run?.childIds || []);
  const absent = new Set(absentIds);
  return children.filter((c) => ids.has(c.id) && !absent.has(c.id));
}

export function daycarePoint(settings) {
  const d = settings.daycare || {};
  return hasCoords(d) ? { lat: d.lat, lng: d.lng, name: d.name || '어린이집', address: d.roadAddress || d.address || '' } : null;
}

/** 순서가 정해진 정류장 목록에 거리·시간을 붙인다 */
export function decorate(start, end, ordered, run, settings) {
  const meters = legDistances(start, end, ordered);
  const { legs, times } = schedule(run?.departTime, meters, settings.speedKmh, settings.dwellMin);
  const totalM = meters.reduce((a, b) => a + b, 0);
  return { ordered, legs, times, totalM, totalMin: times[times.length - 1] - times[0] };
}

/**
 * @param opts.absent 결석 원아 id
 * @param opts.provider 거리 제공자 (기본 직선)
 * @returns {ok, reason?, start, end, missing, recommended, mine, hasSaved, providerLabel}
 */
export async function buildPlan(run, children, settings, { absent = [], provider = straightProvider } = {}) {
  const start = daycarePoint(settings);
  const kids = runChildren(run, children, absent);
  const { stops, missing } = buildStops(kids);
  if (!start) return { ok: false, reason: 'NO_DAYCARE', missing, stops };
  const rec = await recommend(start, start, stops, provider);
  const recommended = decorate(start, start, rec.ordered, run, settings);
  const hasSaved = Array.isArray(run?.myOrder) && run.myOrder.length > 0;
  const mineOrdered = hasSaved ? reconcileOrder(run.myOrder, stops).ordered : rec.ordered;
  const mine = decorate(start, start, mineOrdered, run, settings);
  return { ok: true, start, end: start, missing, recommended, mine, hasSaved, providerLabel: rec.providerLabel, providerError: rec.error };
}
