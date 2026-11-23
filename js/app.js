import * as db from './db.js';
import { toast, esc } from './util.js';
import { createLocator } from './geocode.js';
import { createRoadProvider } from './roadtime.js';
import { computeCourse, DAY_NAMES } from './model.js';
import { launchNav, storeLinkFor, NAV_APPS } from './navlink.js';
import * as today from './views/today.js';
import * as timetable from './views/timetable.js';
import * as course from './views/course.js';
import * as roster from './views/roster.js';
import * as settingsView from './views/settings.js';

const TABS = [
  { id: 'today', label: '오늘', icon: '✅', view: today },
  { id: 'timetable', label: '시간표', icon: '🕘', view: timetable },
  { id: 'course', label: '코스', icon: '🧭', view: course },
  { id: 'roster', label: '명단', icon: '👧', view: roster },
  { id: 'settings', label: '설정', icon: '⚙️', view: settingsView },
];

let current = 'today';
let queue = Promise.resolve();
let restKey = '';
const locateMany = createLocator(() => restKey);

const ctx = {
  db,
  toast,
  shared: { vehicle: null, shift: null }, // 탭 사이에 고른 호차·등하원을 공유
  go(tab) { location.hash = tab; },
  refresh() { return render(); },
  async settings() {
    const s = await db.getSettings();
    restKey = s.kakaoRestKey || '';
    return s;
  },
  /** 코스 계산 (주소 검색 + 거리 행렬 + 순서 + 시간). 실패해도 예외 대신 {ok:false} */
  async compute(opts) {
    try {
      const s = opts.settings;
      restKey = s.kakaoRestKey || '';
      const provider = s.useRoadApi && s.kakaoRestKey ? createRoadProvider({ restKey: s.kakaoRestKey, speedKmh: s.speedKmh }) : null;
      return await computeCourse({ ...opts, locateMany, provider });
    } catch (e) {
      console.error(e);
      return { ok: false, reason: 'ERROR', message: '코스 계산 중 문제가 생겼습니다: ' + (e?.message || e) };
    }
  },
  locateMany,
  /** 길안내 + 앱이 안 열릴 때 설치 안내 */
  async navigate(app, dest, settings) {
    const r = await launchNav(app, dest, settings, {
      onNotOpened: () => showInstallHint(app),
    });
    toast(r.message, r.ok ? 'info' : 'error');
  },
};

function showInstallHint(app) {
  const el = document.getElementById('hint');
  if (!el) return;
  const label = NAV_APPS[app]?.label || '지도 앱';
  const link = storeLinkFor(app, navigator.userAgent);
  el.innerHTML = `<b>${esc(label)}이(가) 열리지 않았나요?</b><span>앱이 설치되어 있는지 확인하세요. 설정에서 다른 내비 앱을 고를 수도 있습니다.</span>
    <div class="actions">${link ? `<a class="btn primary" href="${esc(link)}" target="_blank" rel="noopener">설치하러 가기</a>` : ''}<button class="btn" id="hint-close">닫기</button></div>`;
  el.hidden = false;
  el.querySelector('#hint-close')?.addEventListener('click', () => { el.hidden = true; });
}

function tabFromHash() {
  const h = location.hash.replace('#', '');
  return TABS.some((t) => t.id === h) ? h : 'today';
}

function renderChrome() {
  document.getElementById('nav').innerHTML = TABS.map((t) => `
    <a href="#${t.id}" class="tab ${t.id === current ? 'active' : ''}" ${t.id === current ? 'aria-current="page"' : ''}>
      <span class="tab-icon" aria-hidden="true">${t.icon}</span><span>${t.label}</span></a>`).join('');
  const d = new Date();
  document.getElementById('date').textContent = `${d.getMonth() + 1}월 ${d.getDate()}일 (${DAY_NAMES[d.getDay()]})`;
}

function render() {
  const run = async () => {
    current = tabFromHash();
    renderChrome();
    const main = document.getElementById('main');
    try {
      await TABS.find((t) => t.id === current).view.render(main, ctx);
    } catch (e) {
      console.error(e);
      main.innerHTML = `<div class="card error-card"><h2>화면을 표시하지 못했습니다</h2>
        <p>잠시 후 다시 시도해 주세요. 계속되면 설정에서 명단 파일을 내보내 두세요.</p>
        <p class="small muted">${esc(e?.message || e)}</p><button class="btn primary" id="retry">다시 시도</button></div>`;
      document.getElementById('retry')?.addEventListener('click', () => render());
    }
  };
  queue = queue.then(run, run);
  return queue;
}

function updateOnline() {
  const b = document.getElementById('offline');
  if (b) b.hidden = navigator.onLine !== false;
}

window.addEventListener('error', (e) => { console.error(e.error || e.message); toast('문제가 생겼지만 계속 사용할 수 있습니다', 'error'); });
window.addEventListener('unhandledrejection', (e) => { console.error(e.reason); toast('처리 중 문제가 생겼습니다: ' + (e.reason?.message || '알 수 없음'), 'error'); e.preventDefault(); });
window.addEventListener('hashchange', () => { window.scrollTo(0, 0); render(); });
window.addEventListener('online', () => { updateOnline(); render(); });
window.addEventListener('offline', updateOnline);

(async function start() {
  updateOnline();
  try {
    if (await db.isMemoryMode()) document.getElementById('memwarn').hidden = false;
    if (navigator.storage?.persist) navigator.storage.persist().catch(() => {});
  } catch (e) { console.warn(e); }
  render();
  if ('serviceWorker' in navigator && location.protocol !== 'file:') {
    // 새 버전이 설치되어 제어권이 바뀌면 한 번만 새로고침 → 옛 화면이 남지 않게
    const hadController = !!navigator.serviceWorker.controller;
    let reloaded = false;
    navigator.serviceWorker.addEventListener('controllerchange', () => {
      if (!hadController || reloaded) return;
      reloaded = true;
      location.reload();
    });
    navigator.serviceWorker.register('./sw.js').catch((e) => console.warn('서비스워커 등록 실패', e));
  }
})();
