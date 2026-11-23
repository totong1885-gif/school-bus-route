// 업무 규칙: 그날 타는 아이(요일 예외), 정류장 묶기, 시간 계산, 희망 시각, 코스 계산
// 화면·저장소와 분리된 순수 로직(코스 계산만 주입받은 함수로 비동기 호출). Node로 테스트 가능.
import { getMatrix, optimize, reconcile, createStraightProvider, pathCost } from './optimizer.js';

export const WEEKDAYS = [1, 2, 3, 4, 5];
export const DAY_NAMES = ['일', '월', '화', '수', '목', '금', '토'];
export const SHIFTS = ['am', 'pm'];
export const SHIFT_LABEL = { am: '등원', pm: '하원' };
export const courseId = (vehicle, shift) => `${vehicle}-${shift}`;

export const DEFAULT_DEPART = { am: '08:10', pm: '15:50' };

// ---------- 시각 ----------
export function parseHHMM(s) {
  const m = /^(\d{1,2}):(\d{2})$/.exec(String(s ?? '').trim());
  if (!m) return null;
  const h = +m[1];
  const mi = +m[2];
  if (h > 23 || mi > 59) return null;
  return h * 60 + mi;
}

export function fmtHHMM(min) {
  if (!Number.isFinite(min)) return '--:--';
  const v = ((Math.round(min) % 1440) + 1440) % 1440;
  return `${String(Math.floor(v / 60)).padStart(2, '0')}:${String(v % 60).padStart(2, '0')}`;
}

export function departOf(settings, vehicle, shift) {
  const t = parseHHMM(settings?.departTimes?.[courseId(vehicle, shift)]);
  return t ?? parseHHMM(DEFAULT_DEPART[shift]);
}

// ---------- 주소·정류장 ----------
export function normalizeKey(addr) {
  return String(addr || '').replace(/\s+/g, '');
}

export function stopAddressOf(child) {
  return String(child?.pickup || '').trim() || String(child?.address || '').trim();
}

/** 그날 그 시간대(등원/하원)에 이 아이가 타는 호차와 희망 시각 */
export function resolveRide(child, shift, dow) {
  const base = child?.[shift] || {};
  const baseVehicle = Number(base.vehicle) || 0;
  const ex = WEEKDAYS.includes(dow) ? child?.exceptions?.[`${dow}-${shift}`] : null;
  const hasExVehicle = ex && ex.vehicle !== null && ex.vehicle !== undefined && ex.vehicle !== '';
  const vehicle = hasExVehicle ? Number(ex.vehicle) || 0 : baseVehicle;
  const exTime = ex && parseHHMM(ex.time) !== null ? ex.time : '';
  return {
    vehicle,
    baseVehicle,
    desired: exTime || (parseHHMM(base.desired) !== null ? base.desired : ''),
    changedVehicle: !!hasExVehicle && vehicle !== baseVehicle,
    changedTime: !!exTime,
  };
}

/** 'both' | 'am' | 'pm' | 'none' (기본 배정 기준) */
export function rideType(child) {
  const am = (Number(child?.am?.vehicle) || 0) > 0;
  const pm = (Number(child?.pm?.vehicle) || 0) > 0;
  return am && pm ? 'both' : am ? 'am' : pm ? 'pm' : 'none';
}

/** 해당 호차·시간대·요일에 타는 아이 목록. dow가 없으면 요일 예외 없이 기본 배정 */
export function ridersFor(children, vehicle, shift, dow) {
  const out = [];
  for (const c of children) {
    const r = resolveRide(c, shift, dow);
    if (r.vehicle !== vehicle || vehicle <= 0) continue;
    out.push({ id: c.id, name: c.name, address: stopAddressOf(c), desired: r.desired, moved: r.changedVehicle, fromVehicle: r.baseVehicle });
  }
  return out;
}

/** 같은 주소(띄어쓰기 무시)는 한 정류장. 정류장 희망 시각은 가장 이른 것 */
export function buildStops(riders) {
  const map = new Map();
  for (const r of riders) {
    const key = normalizeKey(r.address);
    if (!key) continue;
    if (!map.has(key)) map.set(key, { key, keys: [key], address: r.address, riders: [], desired: null });
    const s = map.get(key);
    s.riders.push(r);
    const d = parseHHMM(r.desired);
    if (d !== null && (s.desired === null || d < s.desired)) s.desired = d;
  }
  return [...map.values()];
}

/** 위치 검색 결과(메모리)로 같은 건물인 정류장을 합친다. geo: Map(stop.key → {lat,lng,roadAddress}) */
export function mergeByGeo(stops, geo) {
  const byPlace = new Map();
  const out = [];
  for (const s of stops) {
    const g = geo.get(s.key);
    if (!g) continue;
    const place = g.roadAddress ? 'r:' + normalizeKey(g.roadAddress) : `c:${g.lat.toFixed(5)},${g.lng.toFixed(5)}`;
    if (byPlace.has(place)) {
      const t = byPlace.get(place);
      t.riders.push(...s.riders);
      t.keys.push(...s.keys);
      if (s.desired !== null && (t.desired === null || s.desired < t.desired)) t.desired = s.desired;
    } else {
      const merged = { ...s, keys: [...s.keys], riders: [...s.riders], lat: g.lat, lng: g.lng };
      byPlace.set(place, merged);
      out.push(merged);
    }
  }
  return out;
}

export function stopTitle(stop) {
  return (stop?.riders || []).map((r) => r.name).join(', ');
}

// ---------- 시간 계산 ----------
export function timingOf(settings) {
  return {
    dwellMin: Math.max(0, Number(settings?.dwellMin ?? 2)),
    marginFactor: Math.max(1, Number(settings?.marginFactor ?? 1.2)),
    roadFactor: Math.max(1, Number(settings?.roadFactor ?? 1.3)),
  };
}

/**
 * 구간 시간 = 기본 이동시간 × 도로보정 × 여유, 정류장마다 정차시간.
 * 희망 시각보다 일찍 도착하면 그 시각까지 대기, 늦으면 late(분) 표시.
 * @param baseLegs 기본 이동시간(분) 배열: 출발→1, …, 마지막→도착 (길이 = 정류장 수 + 1)
 */
export function computeTimes(departMin, baseLegs, stops, timing) {
  const { dwellMin, marginFactor, roadFactor } = timing;
  let t = departMin;
  const rows = [];
  let end = departMin;
  baseLegs.forEach((base, i) => {
    const travel = base * roadFactor * marginFactor;
    t += travel;
    if (i === stops.length) { end = t; return; }
    const arrive = t;
    const desired = stops[i].desired;
    let wait = 0;
    let late = 0;
    if (desired !== null && desired !== undefined) {
      if (arrive < desired) { wait = desired - arrive; t = desired; } else { late = arrive - desired; }
    }
    rows.push({ time: t, arrive, travel, wait, late: late >= 0.5 ? late : 0 });
    t += dwellMin;
  });
  const maxLate = Math.max(0, ...rows.map((r) => r.late));
  return { rows, end, total: end - departMin, maxLate };
}

// ---------- 코스 계산 ----------
/**
 * @param opts.locateMany async (addresses[]) => Map(address → {lat,lng,roadAddress} | null), errors
 * @param opts.provider 거리·시간 제공자 (없으면 직선)
 * @param opts.savedOrder 내 코스(저장된 정류장 키 목록) | null
 * @param opts.manualOrder 오늘만 바꾼 순서 | null (내 코스보다 우선)
 * @returns {ok, reason?, message?, start, depart, recommended, mine, failed[], label, error?}
 */
export async function computeCourse(opts) {
  const { settings, children, vehicle, shift, dow = null, unchecked = [], savedOrder = null, manualOrder = null, locateMany, provider } = opts;
  const riders = ridersFor(children, vehicle, shift, dow).filter((r) => !unchecked.includes(r.id));
  const rawStops = buildStops(riders);
  const depart = departOf(settings, vehicle, shift);
  const daycareAddr = String(settings?.daycare?.address || '').trim();
  if (!daycareAddr) return { ok: false, reason: 'NO_DAYCARE', message: '설정에서 어린이집 주소를 입력하세요', riders, depart };

  const { results, error } = await locateMany([daycareAddr, ...rawStops.map((s) => s.address)]);
  const start = results.get(daycareAddr);
  if (!start) {
    return { ok: false, reason: 'GEO', message: error?.message || '어린이집 주소의 위치를 찾지 못했습니다', riders, depart };
  }
  const geo = new Map();
  const failed = [];
  for (const s of rawStops) {
    const g = results.get(s.address);
    if (g) geo.set(s.key, g); else failed.push(s);
  }
  const stops = mergeByGeo(rawStops, geo);
  const timing = timingOf(settings);
  const fallback = createStraightProvider(settings?.speedKmh);
  const points = [start, ...stops, start];
  const mx = await getMatrix(points, provider || fallback, fallback);
  const keysOfIdx = [null, ...stops.map((s) => s.keys), null];

  const toCourse = (path) => {
    const ordered = path.slice(1, -1).map((i) => stops[i - 1]);
    const baseLegs = [];
    const meters = [];
    for (let k = 0; k < path.length - 1; k++) {
      baseLegs.push(mx.minutes[path[k]][path[k + 1]]);
      meters.push(mx.meters[path[k]][path[k + 1]]);
    }
    const times = computeTimes(depart, baseLegs, ordered, timing);
    return { stops: ordered, legsMeters: meters, totalMeters: meters.reduce((a, b) => a + b, 0), ...times, cost: pathCost(mx.minutes, path) };
  };

  const recPath = optimize(mx.minutes);
  const baseOrder = manualOrder || savedOrder;
  const minePath = baseOrder ? reconcile(mx.minutes, baseOrder, keysOfIdx) : recPath;
  return {
    ok: true,
    start: { ...start, name: settings?.daycare?.name || '어린이집', address: daycareAddr },
    depart,
    riders,
    recommended: toCourse(recPath),
    mine: toCourse(minePath),
    hasSaved: !!(savedOrder && savedOrder.length),
    hasManual: !!(manualOrder && manualOrder.length),
    failed,
    geoError: error || null,
    label: mx.label,
    providerError: mx.error || null,
  };
}

/** 오프라인 표시용 스냅샷: 좌표는 넣지 않는다 */
export function snapshotOf(course, extra = {}) {
  return {
    builtAt: Date.now(),
    depart: course.depart,
    end: course.mine.end,
    label: course.label,
    stops: course.mine.stops.map((s, i) => ({
      key: s.key,
      keys: s.keys,
      address: s.address,
      riders: s.riders.map((r) => ({ id: r.id, name: r.name })),
      time: course.mine.rows[i].time,
      wait: course.mine.rows[i].wait,
      late: course.mine.rows[i].late,
    })),
    ...extra,
  };
}

/** 시간표용 요일 예외 설명: "(금 ✗, 수 3호차, 화 08:30)" */
export function exceptionNotes(child, shift) {
  const notes = [];
  for (const d of WEEKDAYS) {
    const r = resolveRide(child, shift, d);
    if (r.changedVehicle) notes.push(r.vehicle === 0 ? `${DAY_NAMES[d]} ✗` : `${DAY_NAMES[d]} ${r.vehicle}호차`);
    if (r.changedTime && r.vehicle > 0) notes.push(`${DAY_NAMES[d]} ${r.desired}`);
  }
  return notes;
}

/** 다른 호차에서 특정 요일에만 이 호차로 오는 아이 */
export function movedInNotes(children, vehicle, shift) {
  const out = [];
  for (const c of children) {
    for (const d of WEEKDAYS) {
      const r = resolveRide(c, shift, d);
      if (r.changedVehicle && r.vehicle === vehicle) {
        out.push(`${DAY_NAMES[d]}: ${c.name} 탑승 (${r.baseVehicle ? r.baseVehicle + '호차' : '평소 안 탐'} → ${vehicle}호차)`);
      }
    }
  }
  return out;
}
