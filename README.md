# 등하원 차량 (어린이집 통학차량 기사용 PWA)

서버 없이 정적 파일만으로 동작합니다. 데이터는 기사님 휴대폰 브라우저(IndexedDB)에만 저장됩니다.

## 배포 (무료)
- **GitHub Pages**: 이 폴더를 저장소에 올리고 Settings → Pages → 브랜치 선택. `https://아이디.github.io/저장소/` 로 접속
- **Cloudflare Pages**: 빌드 명령 없음, 출력 폴더 `/`
- 휴대폰에서 접속 → 브라우저 메뉴 "홈 화면에 추가"
- 파일을 고친 뒤에는 `sw.js`의 `VERSION`을 올려야 기기에 새 버전이 반영됩니다

## 처음 설정
1. [카카오 개발자 콘솔](https://developers.kakao.com/)에서 앱 생성 → **[카카오맵] 사용 설정 ON** → REST API 키 복사
2. 앱 설정 탭에 REST 키 입력, 어린이집 주소 입력 → "주소로 좌표 찾기"
3. 명단에서 원아 등록 → 시간표에서 회차(출발 시각·요일·탑승 원아) 지정
4. 코스 탭에서 추천 순서 확인, 필요하면 ▲▼로 바꾸고 "내 코스 저장"
- 카카오내비를 쓰려면 JavaScript 키를 입력하고, 콘솔의 [플랫폼 → Web]에 배포 도메인을 등록해야 합니다. 키가 없으면 카카오맵으로 대신 엽니다.

## 구조
```
index.html, css/app.css, manifest.webmanifest, sw.js, icons/
js/app.js            탭 전환, 전역 오류 처리
js/db.js             IndexedDB (사용 불가 시 메모리 대체)
js/geocode.js        카카오 주소 검색 (모든 실패 → GeoError 코드)
js/stops.js          같은 주소 → 한 정류장
js/plan.js           회차 + 원아 + 설정 → 추천/내 코스 계산
js/route/distance.js 거리 제공자 인터페이스 + 직선거리
js/route/optimize.js nearest neighbor → 2-opt + Or-opt, 예상 시각
js/route/road-kakaomobility.js  도로거리 제공자 자리 (미구현)
js/navi.js           내비 앱 URL
js/backup.js         JSON 백업
js/sample.js         가짜 시험 데이터
js/views/*.js        5개 화면
tests/unit.test.mjs  단위 테스트 (node --test tests/unit.test.mjs)
```

## 도로거리로 바꾸기
`{ id, label, async matrix(points) → number[][] (미터) }` 형태의 제공자를 만들어 `buildPlan(..., { provider })`에 넘기면 됩니다. 실패하면 자동으로 직선거리로 대체됩니다.

## 확인한 공식 문서 (2026-11-23)
| 항목 | 출처 |
|---|---|
| 카카오 주소 검색 API | https://developers.kakao.com/docs/latest/ko/local/dev-guide |
| 카카오 무료 한도 (주소→좌표 100,000건/일, 계정의 첫 앱만) | https://developers.kakao.com/docs/latest/ko/getting-started/quota |
| 카카오맵 사용 설정, 한도 초과 시 400/-10 | https://developers.kakao.com/docs/latest/ko/kakaomap/common |
| 카카오 운영정책 제5조 20호 (캐시는 사용자 환경 개선 목적, 최신 유지) | https://developers.kakao.com/terms/latest/ko/site-policies |
| 카카오맵 길찾기 링크 `/link/to/이름,위도,경도` | https://apis.map.kakao.com/web/guide/ |
| 카카오내비 JS SDK (웹 URL 스킴 없음) | https://developers.kakao.com/docs/latest/ko/kakaonavi/js |
| 네이버지도 `nmap://route/car` | https://guide.ncloud-docs.com/docs/maps-url-scheme |
| 카카오모빌리티 길찾기 무료 한도 | https://developers.kakaomobility.com/price/ |
| TMAP URL 스킴 | **공식 문서에서 찾지 못함** — 비공식 형식 `tmap://route?goalname=&goalx=경도&goaly=위도` 사용 |
