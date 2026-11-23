// 카카오 로컬 API 주소 검색
// 문서: https://developers.kakao.com/docs/latest/ko/local/dev-guide
//   GET https://dapi.kakao.com/v2/local/search/address.json?query=...
//   Authorization: KakaoAK {REST_API_KEY}
//   응답 documents[].x = 경도, documents[].y = 위도
// 모든 실패는 GeoError로 바꿔 던진다. 호출하는 쪽은 메시지만 보여 주면 된다.

export class GeoError extends Error {
  constructor(code, message) { super(message); this.code = code; }
}

const ENDPOINT = 'https://dapi.kakao.com/v2/local/search/address.json';

export async function geocode(query, restKey, { timeoutMs = 8000, fetchImpl } = {}) {
  const q = String(query || '').trim();
  if (!q) throw new GeoError('EMPTY', '주소가 비어 있습니다');
  if (!restKey) throw new GeoError('NO_KEY', '설정에서 카카오 REST 키를 먼저 입력하세요');
  if (typeof navigator !== 'undefined' && navigator.onLine === false) {
    throw new GeoError('OFFLINE', '오프라인 상태입니다. 연결된 뒤 다시 시도하세요');
  }
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
    if (e && e.name === 'AbortError') throw new GeoError('TIMEOUT', '주소 검색 응답이 늦습니다. 잠시 후 다시 시도하세요');
    throw new GeoError('NETWORK', '주소 검색 서버에 연결하지 못했습니다(네트워크 또는 브라우저 차단)');
  } finally {
    clearTimeout(timer);
  }

  let body = null;
  try { body = await res.json(); } catch { /* 본문 없음 */ }

  if (!res.ok) {
    const msg = String(body?.message || body?.msg || '');
    if (body?.code === -10 || /limit/i.test(msg)) throw new GeoError('QUOTA', '카카오 API 일일 무료 한도를 넘었습니다. 내일 다시 시도하세요');
    if (res.status === 401) throw new GeoError('KEY', 'REST 키가 올바르지 않습니다. 설정에서 확인하세요');
    if (res.status === 403) throw new GeoError('DISABLED', '카카오 개발자 콘솔에서 [카카오맵] 사용 설정을 ON으로 바꿔야 합니다');
    throw new GeoError('HTTP', `주소 검색 실패 (HTTP ${res.status})`);
  }

  const d = body?.documents?.[0];
  if (!d) throw new GeoError('NOT_FOUND', '주소를 찾지 못했습니다. 도로명 주소로 다시 입력해 보세요');
  const lat = Number(d.y);
  const lng = Number(d.x);
  if (!Number.isFinite(lat) || !Number.isFinite(lng)) throw new GeoError('BAD_DATA', '좌표 형식이 올바르지 않습니다');
  return {
    lat,
    lng,
    roadAddress: d.road_address?.address_name || '',
    addressName: d.address_name || '',
    count: body.documents.length,
  };
}
