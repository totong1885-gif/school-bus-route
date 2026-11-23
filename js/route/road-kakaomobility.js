// 도로거리 제공자 자리(현재 비활성).
// 카카오모빌리티 길찾기 API(https://developers.kakaomobility.com/guide/navi-api/start)
//   - 다중 출발지/다중 목적지 길찾기: POST https://apis-navi.kakaomobility.com/v1/destinations/directions
//     → 출발지 1곳에서 여러 목적지까지의 거리·시간을 돌려준다. 이를 정류장 수만큼 호출하면 행렬을 만들 수 있다.
//   - 무료 제공량(2026-11 확인, https://developers.kakaomobility.com/price/): 자동차 길찾기 10,000건/일,
//     다중 목적지 1,000건/일. 정류장 N개면 회차당 약 N+2회 호출이 필요하니 한도를 계산해 볼 것.
// 구현 시 matrix(points)가 number[][](미터)를 돌려주기만 하면 optimize.js는 그대로 동작한다.
// 실패하면 distance.js의 getMatrix가 자동으로 직선거리로 대체한다.

export function createKakaoMobilityProvider({ restKey } = {}) {
  return {
    id: 'kakaomobility',
    label: '도로거리(카카오모빌리티)',
    async matrix(/* points */) {
      if (!restKey) throw new Error('REST 키 없음');
      throw new Error('도로거리 제공자는 아직 구현되지 않았습니다');
    },
  };
}
