// 거리 제공자(provider) 인터페이스
//   { id, label, async matrix(points) -> number[][] (미터) }
//   points: [{ lat, lng }, ...]
// 도로거리 API로 바꾸려면 같은 형태의 provider를 만들어 넘기면 된다.
// (예: road-kakaomobility.js)

const R = 6371000;
const toRad = (d) => (d * Math.PI) / 180;

export function haversine(a, b) {
  const dLat = toRad(b.lat - a.lat);
  const dLng = toRad(b.lng - a.lng);
  const s = Math.sin(dLat / 2) ** 2 +
    Math.cos(toRad(a.lat)) * Math.cos(toRad(b.lat)) * Math.sin(dLng / 2) ** 2;
  return 2 * R * Math.asin(Math.min(1, Math.sqrt(s)));
}

export const straightProvider = {
  id: 'straight',
  label: '직선거리',
  async matrix(points) {
    return points.map((p) => points.map((q) => haversine(p, q)));
  },
};

// provider가 실패하면 직선거리로 대체한다. 앱이 멈추지 않게 하는 것이 우선.
export async function getMatrix(points, provider = straightProvider) {
  if (provider && provider !== straightProvider) {
    try {
      const m = await provider.matrix(points);
      if (Array.isArray(m) && m.length === points.length) return { matrix: m, providerId: provider.id, label: provider.label };
      throw new Error('잘못된 거리 행렬');
    } catch (e) {
      console.warn(`${provider.label} 실패, 직선거리로 대체`, e);
      const m = await straightProvider.matrix(points);
      return { matrix: m, providerId: straightProvider.id, label: straightProvider.label, error: e };
    }
  }
  return { matrix: await straightProvider.matrix(points), providerId: straightProvider.id, label: straightProvider.label };
}
