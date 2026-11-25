// 내비 앱 연결 (정류장 한 곳씩 넘김)
// 출처(2026-11-23 확인)
//  - 네이버지도: https://guide.ncloud-docs.com/docs/application-maps-url-scheme-vpc (2026-11-25 주소 변경 확인)
//      nmap://route/car?dlat=&dlng=&dname=&appname=  (appname 필수, 출발지 생략 시 현재 위치, API 키 불필요)
//      경유지: v1lat/v1lng/v1name … v5lat/v5lng/v5name (최대 5곳, 경로 탐색 공통 파라미터)
//      안드로이드 웹: intent://...#Intent;scheme=nmap;...;package=com.nhn.android.nmap;end
//  - 카카오맵 앱: https://apis.map.kakao.com/android_v2/docs/api-guide/urlscheme/
//      kakaomap://route?sp=위도,경도&ep=위도,경도&by=car   (sp 생략 가능 여부는 실기기 확인 필요)
//    카카오맵 웹 링크(PC 등): https://apis.map.kakao.com/web/guide/  /link/to/이름,위도,경도
//  - 카카오내비: https://developers.kakao.com/docs/latest/ko/kakaonavi/js  (URL 스킴 없음, JS SDK + JS 키 + 도메인 등록)
//  - 티맵: 공식 문서 없음 → 실험적 옵션

export const NAV_APPS = {
  naver: { label: '네이버지도', note: '기본 추천 · 키 필요 없음' },
  kakaomap: { label: '카카오맵', note: '키 필요 없음' },
  kakaonavi: { label: '카카오내비', note: 'JavaScript 키 + 도메인 등록 필요. 안 되면 카카오맵으로 대신 엽니다' },
  tmap: { label: '티맵 (실험적)', note: '공식 문서가 없는 형식이라 동작이 보장되지 않습니다', experimental: true },
};

// 앱 설치 안내용 스토어 링크 (네이버 iOS id는 공식 문서 기준, 나머지는 실기기 확인 필요)
export const STORE_LINKS = {
  naver: { android: 'https://play.google.com/store/apps/details?id=com.nhn.android.nmap', ios: 'https://apps.apple.com/app/id311867728' },
  kakaomap: { android: 'https://play.google.com/store/apps/details?id=net.daum.android.map', ios: 'https://apps.apple.com/app/id304608425' },
  kakaonavi: { android: 'https://play.google.com/store/apps/details?id=com.locnall.KimGiSa', ios: 'https://apps.apple.com/app/id417698849' },
};

const KAKAO_SDK_URL = 'https://t1.kakaocdn.net/kakao_js_sdk/2.7.2/kakao.min.js';

export function platformOf(ua) {
  const u = String(ua || '');
  if (/android/i.test(u)) return 'android';
  if (/iphone|ipad|ipod/i.test(u)) return 'ios';
  return 'other';
}

const num = (v) => Number(Number(v).toFixed(7));

export const NAVER_MAX_VIA = 5;
const validPt = (p) => p && Number.isFinite(Number(p.lat)) && Number.isFinite(Number(p.lng));

/** 순수 함수: 길안내 URL. dest = {name, lat, lng, via?: [{name,lat,lng}]} (via는 네이버지도만, 최대 5곳) */
export function buildNavUrl(app, dest, { ua = '', pageUrl = '' } = {}) {
  const name = encodeURIComponent(dest.name || '목적지');
  const lat = num(dest.lat);
  const lng = num(dest.lng);
  const platform = platformOf(ua);
  switch (app) {
    case 'naver': {
      const via = (dest.via || []).filter(validPt).slice(0, NAVER_MAX_VIA)
        .map((v, i) => `&v${i + 1}lat=${num(v.lat)}&v${i + 1}lng=${num(v.lng)}&v${i + 1}name=${encodeURIComponent(v.name || `경유지 ${i + 1}`)}`).join('');
      const path = `route/car?dlat=${lat}&dlng=${lng}&dname=${name}${via}&appname=${encodeURIComponent(pageUrl || 'https://localhost/')}`;
      if (platform === 'android') {
        return `intent://${path}#Intent;scheme=nmap;action=android.intent.action.VIEW;category=android.intent.category.BROWSABLE;package=com.nhn.android.nmap;end`;
      }
      return `nmap://${path}`;
    }
    case 'tmap':
      return `tmap://route?goalname=${name}&goalx=${lng}&goaly=${lat}`;
    case 'kakaomap':
    case 'kakaonavi':
    default:
      if (platform === 'other') return `https://map.kakao.com/link/to/${name},${lat},${lng}`;
      return `kakaomap://route?ep=${lat},${lng}&by=car`;
  }
}

let sdkPromise = null;
function loadKakaoSdk() {
  if (typeof window !== 'undefined' && window.Kakao) return Promise.resolve(window.Kakao);
  if (sdkPromise) return sdkPromise;
  sdkPromise = new Promise((resolve, reject) => {
    const s = document.createElement('script');
    s.src = KAKAO_SDK_URL;
    s.crossOrigin = 'anonymous';
    const t = setTimeout(() => reject(new Error('시간 초과')), 8000);
    s.onload = () => { clearTimeout(t); window.Kakao ? resolve(window.Kakao) : reject(new Error('SDK 없음')); };
    s.onerror = () => { clearTimeout(t); reject(new Error('SDK 로드 실패')); };
    document.head.appendChild(s);
  }).catch((e) => { sdkPromise = null; throw e; });
  return sdkPromise;
}

/** 앱이 열려 화면이 숨겨지지 않으면(=앱 미설치 가능성) onNotOpened 호출 */
function watchOpen(onNotOpened, ms = 2500) {
  let left = false;
  const mark = () => { if (document.visibilityState === 'hidden') left = true; };
  const blur = () => { left = true; };
  document.addEventListener('visibilitychange', mark);
  window.addEventListener('pagehide', blur);
  window.addEventListener('blur', blur);
  setTimeout(() => {
    document.removeEventListener('visibilitychange', mark);
    window.removeEventListener('pagehide', blur);
    window.removeEventListener('blur', blur);
    if (!left && document.visibilityState === 'visible') onNotOpened?.();
  }, ms);
}

/**
 * 길안내 실행. 예외를 밖으로 던지지 않는다.
 * @returns {ok, message}
 */
export async function launchNav(app, dest, settings = {}, { onNotOpened } = {}) {
  try {
    if (!Number.isFinite(Number(dest?.lat)) || !Number.isFinite(Number(dest?.lng))) {
      return { ok: false, message: '위치 정보가 없어 길안내를 열 수 없습니다. 인터넷 연결 후 다시 시도하세요' };
    }
    if (app === 'kakaonavi') {
      if (settings.kakaoJsKey) {
        try {
          const Kakao = await loadKakaoSdk();
          if (!Kakao.isInitialized()) Kakao.init(settings.kakaoJsKey);
          Kakao.Navi.start({ name: dest.name || '목적지', x: Number(dest.lng), y: Number(dest.lat), coordType: 'wgs84' });
          return { ok: true, message: '카카오내비를 여는 중' };
        } catch (e) {
          console.warn('카카오내비 실패 → 카카오맵', e);
        }
      }
      app = 'kakaomap';
    }
    const ua = navigator.userAgent;
    const url = buildNavUrl(app, dest, { ua, pageUrl: location.origin + location.pathname });
    if (url.startsWith('https://')) {
      const w = window.open(url, '_blank', 'noopener');
      if (!w) location.href = url;
    } else {
      watchOpen(onNotOpened);
      location.href = url;
    }
    return { ok: true, message: `${NAV_APPS[app]?.label || '지도 앱'}을(를) 여는 중` };
  } catch (e) {
    console.error(e);
    return { ok: false, message: '길안내 앱을 열지 못했습니다' };
  }
}

export function storeLinkFor(app, ua) {
  const p = platformOf(ua);
  const links = STORE_LINKS[app];
  if (!links || p === 'other') return null;
  return links[p];
}
