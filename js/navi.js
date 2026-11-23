// 내비 앱 연결
// 출처(2026-11 확인)
//  - 카카오맵 길찾기 링크: https://apis.map.kakao.com/web/guide/  (/link/to/이름,위도,경도)
//  - 카카오내비: https://developers.kakao.com/docs/latest/ko/kakaonavi/js
//      웹용 URL 스킴은 공식 문서에 없음. JS SDK Kakao.Navi.start + JavaScript 키 + 도메인 등록 필요.
//  - 네이버지도: https://guide.ncloud-docs.com/docs/maps-url-scheme
//      nmap://route/car?dlat=&dlng=&dname=&appname=   (appname 필수, 모바일 웹은 페이지 URL)
//  - TMAP: 공식 URL 스킴 문서를 찾지 못함 → 널리 쓰이는 비공식 형식 사용, 실기기 확인 필요.

export const NAVI_APPS = {
  kakaomap: { label: '카카오맵', verified: true },
  kakaonavi: { label: '카카오내비', verified: true, needsJsKey: true },
  naver: { label: '네이버지도', verified: true },
  tmap: { label: '티맵', verified: false },
};

const KAKAO_SDK_URL = 'https://t1.kakaocdn.net/kakao_js_sdk/2.7.2/kakao.min.js';

export function platformOf(ua) {
  const u = String(ua || '');
  if (/android/i.test(u)) return 'android';
  if (/iphone|ipad|ipod/i.test(u)) return 'ios';
  return 'other';
}

/**
 * 순수 함수: 내비 URL 만들기 (테스트 가능)
 * dest: {name, lat, lng}
 */
export function buildNaviUrl(app, dest, { ua = '', pageUrl = '' } = {}) {
  const name = encodeURIComponent(dest.name || '목적지');
  const lat = Number(dest.lat);
  const lng = Number(dest.lng);
  switch (app) {
    case 'naver': {
      const appname = encodeURIComponent(pageUrl || 'https://localhost/');
      const path = `route/car?dlat=${lat}&dlng=${lng}&dname=${name}&appname=${appname}`;
      if (platformOf(ua) === 'android') {
        return `intent://${path}#Intent;scheme=nmap;action=android.intent.action.VIEW;category=android.intent.category.BROWSABLE;package=com.nhn.android.nmap;end`;
      }
      return `nmap://${path}`;
    }
    case 'tmap':
      return `tmap://route?goalname=${name}&goalx=${lng}&goaly=${lat}`;
    case 'kakaomap':
    case 'kakaonavi': // SDK를 못 쓰면 카카오맵 링크로 대체
    default:
      return `https://map.kakao.com/link/to/${name},${lat},${lng}`;
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
    const t = setTimeout(() => reject(new Error('SDK 로드 시간 초과')), 8000);
    s.onload = () => { clearTimeout(t); window.Kakao ? resolve(window.Kakao) : reject(new Error('SDK 없음')); };
    s.onerror = () => { clearTimeout(t); reject(new Error('SDK 로드 실패')); };
    document.head.appendChild(s);
  }).catch((e) => { sdkPromise = null; throw e; });
  return sdkPromise;
}

/**
 * 길안내 실행. 실패해도 예외를 밖으로 던지지 않고 결과 메시지를 돌려준다.
 * @returns {ok:boolean, message:string}
 */
export async function launchNavi(app, dest, settings = {}) {
  try {
    if (!Number.isFinite(Number(dest.lat)) || !Number.isFinite(Number(dest.lng))) {
      return { ok: false, message: '이 정류장은 좌표가 없어 길안내를 할 수 없습니다' };
    }
    if (app === 'kakaonavi' && settings.kakaoJsKey) {
      try {
        const Kakao = await loadKakaoSdk();
        if (!Kakao.isInitialized()) Kakao.init(settings.kakaoJsKey);
        Kakao.Navi.start({ name: dest.name || '목적지', x: Number(dest.lng), y: Number(dest.lat), coordType: 'wgs84' });
        return { ok: true, message: '카카오내비를 여는 중' };
      } catch (e) {
        console.warn('카카오내비 실패, 카카오맵으로 대체', e);
        openUrl(buildNaviUrl('kakaomap', dest));
        return { ok: true, message: '카카오내비를 열 수 없어 카카오맵으로 대신 엽니다' };
      }
    }
    const url = buildNaviUrl(app, dest, { ua: navigator.userAgent, pageUrl: location.origin + location.pathname });
    openUrl(url);
    const label = NAVI_APPS[app]?.label || '카카오맵';
    return { ok: true, message: `${label}을(를) 여는 중. 열리지 않으면 앱 설치 여부를 확인하세요` };
  } catch (e) {
    console.error(e);
    return { ok: false, message: '길안내 앱을 열지 못했습니다' };
  }
}

function openUrl(url) {
  if (url.startsWith('https://')) {
    // 웹 링크는 새 창(앱 링크 처리는 OS가 담당). 팝업 차단 시 현재 창에서 연다.
    const w = window.open(url, '_blank', 'noopener');
    if (!w) location.href = url;
  } else {
    location.href = url;
  }
}
