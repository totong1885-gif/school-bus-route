// 시험용 가짜 데이터. 이름·주소는 모두 지어낸 것이고, 좌표는 임의의 점이다.
// (실제 주소가 아니므로 길안내 목적지는 실제 장소와 무관)
export function sampleData() {
  const base = { lat: 37.4000, lng: 127.1000 };
  const p = (dLat, dLng) => ({ lat: +(base.lat + dLat).toFixed(6), lng: +(base.lng + dLng).toFixed(6) });
  const kids = [
    ['c1', '김하늘', '햇살시 무지개로 12', '', p(0.004, 0.006)],
    ['c2', '이바다', '햇살시 솔빛길 7', '', p(-0.006, 0.010)],
    ['c3', '박구름', '햇살시 별빛로 33', '101동', p(0.009, -0.004)],
    ['c4', '박나래', '햇살시 별빛로 33', '203동', p(0.009, -0.004)],
    ['c5', '최새봄', '햇살시 꽃담길 5', '', p(-0.002, -0.008)],
    ['c6', '정여름', '햇살시 은하수로 120', '', p(0.012, 0.012)],
    ['c7', '한가을', '햇살시 다솜로 48', '', p(-0.010, -0.002)],
    ['c8', '윤겨울', '햇살시 새싹길 9', '', p(0.001, 0.015)],
  ];
  const children = kids.map(([id, name, address, detail, c]) => ({
    id, name, address, detail, lat: c.lat, lng: c.lng, roadAddress: address, geoStatus: 'sample',
  }));
  return {
    settings: {
      daycare: { name: '햇살어린이집(가상)', address: '햇살시 중앙로 1', roadAddress: '햇살시 중앙로 1', lat: base.lat, lng: base.lng },
    },
    children,
    runs: [
      { id: 'r_am', name: '등원 1차', type: 'am', departTime: '08:20', days: [1, 2, 3, 4, 5], childIds: children.map((c) => c.id), myOrder: null },
      { id: 'r_pm', name: '하원 1차', type: 'pm', departTime: '16:00', days: [1, 2, 3, 4, 5], childIds: ['c1', 'c2', 'c3', 'c4', 'c5'], myOrder: null },
    ],
  };
}
