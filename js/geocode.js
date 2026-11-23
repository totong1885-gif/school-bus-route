// 주소 → 위치: 카카오 로컬 API 주소 검색
// 문서: https://developers.kakao.com/docs/latest/ko/local/dev-guide
//   GET https://dapi.kakao.com/v2/local/search/address.json?query=...
//   Authorization: KakaoAK {REST_API_KEY}   (documents[].x = 경도, y = 위도)
// 결과는 메모리(Map)에만 둔다. IndexedDB 등에 저장하지 않는다 → 앱을 다시 열면 다시 찾는다.
import { SAMPLE_PLACES } from './sample.js';

export class GeoError extends Error {
  constructor(code, message) { super(message); this.code = code; }
}

const ENDPOINT = 'https://dapi.kakao.com/v2/local/search/address.json';
const memo = new Map(); // address → {lat,lng,roadAddress}
const STOP_CODES = ['NO_KEY', 'KEY', 'QUOTA', 'OFFLINE', 'DISABLED', 'NETWORK'];

export async function geocode(query, restKey, { timeoutMs = 8000, fetchImpl } = {}) {
  const q = String(query || '').trim();
  if (!q) throw new GeoError('EMPTY', '주소가 비어 있습니다');
  if (SAMPLE_PLACES[q]) return { ...SAMPLE_PLACES[q], roadAddress: q, sample: true };
  if (!restKey) throw new GeoError('NO_KEY', '설정에서 카카오 REST 키를 먼저 입력하세요');
  if (typeof navigator !== 'undefined' && navigator.onLine === false) throw new GeoError('OFFLINE', '인터넷에 연결되어 있지 않습니다');
  const doFetch = fetchImpl || ((...a) => fetch(...a));
  const ctrl = typeof AbortController !== 'undefined' ? new AbortController() : null;
  const timer = setTimeout(() => ctrl && ctrl.abort(), timeoutMs);
  let res;
  try {
    res = await doFetch(`${ENDPOINT}?query=${encodeURIComponent(q)}&size=5`, {
      headers: { Authorization: `KakaoAK ${restKey}` },
      signal: ctrl ? ctrl.signal : undefined,
    });
  } catch (e) {
    if (e?.name === 'AbortError') throw new GeoError('TIMEOUT', '주소 검색 응답이 늦습니다. 잠시 후 다시 시도하세요');
    throw new GeoError('NETWORK', '주소 검색 서버에 연결하지 못했습니다');
  } finally {
    clearTimeout(timer);
  }
  let body = null;
  try { body = await res.json(); } catch { /* 본문 없음 */ }
  if (!res.ok) {
    const msg = String(body?.message || body?.msg || '');
    if (body?.code === -10 || /limit/i.test(msg)) throw new GeoError('QUOTA', '카카오 주소 검색의 오늘 무료 사용량을 넘었습니다');
    if (res.status === 401) throw new GeoError('KEY', 'REST 키가 올바르지 않습니다. 설정에서 확인하세요');
    if (res.status === 403) throw new GeoError('DISABLED', '카카오 개발자 콘솔에서 [카카오맵] 사용 설정을 켜야 합니다');
    throw new GeoError('HTTP', `주소 검색 실패 (오류 ${res.status})`);
  }
  const d = body?.documents?.[0];
  if (!d) throw new GeoError('NOT_FOUND', `주소를 찾지 못했습니다: ${q}`);
  const lat = Number(d.y);
  const lng = Number(d.x);
  if (!Number.isFinite(lat) || !Number.isFinite(lng)) throw new GeoError('BAD_DATA', '위치 정보 형식이 올바르지 않습니다');
  return { lat, lng, roadAddress: d.road_address?.address_name || d.address_name || '' };
}

/**
 * 여러 주소의 위치를 찾는다(메모리 캐시 사용, 동시에 3개씩).
 * 키 오류·한도 초과·오프라인처럼 계속해도 실패할 오류가 나면 나머지는 시도하지 않는다.
 * @returns {results: Map(address → loc|null), error: GeoError|null, failedCount}
 */
export function createLocator(getKey, options = {}) {
  return async function locateMany(addresses) {
    const uniq = [...new Set(addresses.map((a) => String(a || '').trim()).filter(Boolean))];
    const results = new Map();
    let error = null;
    let stop = false;
    const queue = uniq.filter((a) => {
      if (memo.has(a)) { results.set(a, memo.get(a)); return false; }
      return true;
    });
    const worker = async () => {
      while (queue.length && !stop) {
        const a = queue.shift();
        try {
          const loc = await geocode(a, getKey(), options);
          memo.set(a, loc);
          results.set(a, loc);
        } catch (e) {
          results.set(a, null);
          if (!error || STOP_CODES.includes(e.code)) error = e;
          if (STOP_CODES.includes(e.code)) stop = true;
        }
      }
    };
    await Promise.all([worker(), worker(), worker()]);
    for (const a of uniq) if (!results.has(a)) results.set(a, null);
    const failedCount = [...results.values()].filter((v) => !v).length;
    return { results, error, failedCount };
  };
}

export function clearGeoMemory() { memo.clear(); }
