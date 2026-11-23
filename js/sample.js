// 시험용 가짜 데이터. 이름·주소는 모두 지어낸 것(가상 도시 "햇살시").
// 가짜 주소는 카카오에서 찾을 수 없으므로, 아래 임의 좌표로 화면 시험만 가능하게 한다.
// (실제 장소와 무관. 길안내 목적지도 의미 없는 위치)
const BASE = { lat: 37.4, lng: 127.1 };
const at = (dLat, dLng) => ({ lat: +(BASE.lat + dLat).toFixed(6), lng: +(BASE.lng + dLng).toFixed(6) });

export const SAMPLE_PLACES = {
  '햇살시 중앙로 1': at(0, 0),
  '햇살시 무지개로 12': at(0.004, 0.006),
  '햇살시 솔빛길 7': at(-0.006, 0.010),
  '햇살시 별빛로 33': at(0.009, -0.004),
  '햇살시 꽃담길 5': at(-0.002, -0.008),
  '햇살시 은하수로 120': at(0.012, 0.012),
  '햇살시 다솜로 48': at(-0.010, -0.002),
  '햇살시 새싹길 9': at(0.001, 0.015),
  '햇살시 별빛로 33 정문': at(0.0092, -0.0042),
};

const noEx = {};

export function sampleData() {
  const kid = (id, name, address, am, pm, extra = {}) => ({
    id, name, address, pickup: '', am: { vehicle: am, desired: '' }, pm: { vehicle: pm, desired: '' }, exceptions: noEx, ...extra,
  });
  return {
    settings: {
      daycare: { name: '햇살어린이집(가상)', address: '햇살시 중앙로 1' },
      vehicleCount: 2,
      departTimes: { '1-am': '08:03', '1-pm': '15:50', '2-am': '08:20', '2-pm': '17:10' },
    },
    children: [
      kid('c1', '김하늘', '햇살시 무지개로 12', 1, 1),
      kid('c2', '이바다', '햇살시 솔빛길 7', 1, 1, { am: { vehicle: 1, desired: '08:10' } }),
      kid('c3', '박구름', '햇살시 별빛로 33', 1, 1, { pickup: '햇살시 별빛로 33 정문' }),
      kid('c4', '박나래', '햇살시 별빛로 33', 1, 0, { pickup: '햇살시 별빛로 33 정문' }),
      kid('c5', '최새봄', '햇살시 꽃담길 5', 2, 2, { exceptions: { '5-pm': { vehicle: 0, time: '' } } }),
      kid('c6', '정여름', '햇살시 은하수로 120', 2, 2, { exceptions: { '3-am': { vehicle: 1, time: '' }, '2-am': { vehicle: null, time: '08:40' } } }),
      kid('c7', '한가을', '햇살시 다솜로 48', 0, 2),
      kid('c8', '윤겨울', '햇살시 새싹길 9', 2, 2),
    ],
  };
}
