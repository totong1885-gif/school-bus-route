// 원아 → 정류장 묶기. 같은 주소(카카오가 돌려준 도로명 주소, 없으면 좌표, 없으면 입력 주소)는 한 정류장.
// 상세주소(동·호수)는 묶기 기준에 쓰지 않는다 → 같은 건물의 다른 호수는 같은 정류장.

export function normalizeAddress(s) {
  return String(s || '').replace(/\s+/g, ' ').trim();
}

const isNum = (v) => typeof v === 'number' && Number.isFinite(v);

export function hasCoords(o) {
  return !!o && isNum(o.lat) && isNum(o.lng);
}

export function stopKeyOf(child) {
  if (child.roadAddress) return 'r:' + child.roadAddress.replace(/\s+/g, '');
  if (hasCoords(child)) return `c:${child.lat.toFixed(5)},${child.lng.toFixed(5)}`;
  return 'a:' + normalizeAddress(child.address).replace(/\s+/g, '');
}

/**
 * @param children 원아 목록
 * @returns {stops:[{key,address,lat,lng,children:[{id,name}]}], missing:[child]} missing = 좌표 없는 원아
 */
export function buildStops(children) {
  const map = new Map();
  const missing = [];
  for (const c of children) {
    if (!hasCoords(c)) { missing.push(c); continue; }
    const key = stopKeyOf(c);
    if (!map.has(key)) {
      map.set(key, { key, address: c.roadAddress || normalizeAddress(c.address), lat: c.lat, lng: c.lng, children: [] });
    }
    map.get(key).children.push({ id: c.id, name: c.name });
  }
  return { stops: [...map.values()], missing };
}

export function stopTitle(stop) {
  return stop.children.map((c) => c.name).join(', ');
}

/** 저장된 내 순서(key 목록)를 현재 정류장에 맞춘다: 없어진 정류장은 빼고 새 정류장은 뒤에 붙인다. */
export function reconcileOrder(savedKeys, stops) {
  const byKey = new Map(stops.map((s) => [s.key, s]));
  const out = [];
  for (const k of savedKeys || []) {
    if (byKey.has(k)) { out.push(byKey.get(k)); byKey.delete(k); }
  }
  return { ordered: out.concat([...byKey.values()]), added: byKey.size };
}
