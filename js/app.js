import * as db from './db.js';
import { toast, esc, DAY_NAMES } from './util.js';
import * as today from './views/today.js';
import * as schedule from './views/schedule.js';
import * as course from './views/course.js';
import * as roster from './views/roster.js';
import * as settings from './views/settings.js';

const TABS = [
  { id: 'today', label: '오늘', icon: '✅', view: today },
  { id: 'schedule', label: '시간표', icon: '🕘', view: schedule },
  { id: 'course', label: '코스', icon: '🧭', view: course },
  { id: 'roster', label: '명단', icon: '👧', view: roster },
  { id: 'settings', label: '설정', icon: '⚙️', view: settings },
];

let current = 'today';
let rendering = Promise.resolve();

const ctx = {
  db,
  toast,
  go(tab) { location.hash = tab; },
  refresh() { return render(); },
  // 데이터가 바뀌었음을 기록 → 오늘 화면이 코스를 다시 만든다
  async touch() { try { await db.put('kv', { id: 'rev', t: Date.now() }); } catch (e) { console.warn(e); } },
};

function tabFromHash() {
  const h = location.hash.replace('#', '');
  return TABS.some((t) => t.id === h) ? h : 'today';
}

function renderNav() {
  const nav = document.getElementById('nav');
  nav.innerHTML = TABS.map((t) => `
    <a href="#${t.id}" class="tab ${t.id === current ? 'active' : ''}" ${t.id === current ? 'aria-current="page"' : ''}>
      <span class="tab-icon" aria-hidden="true">${t.icon}</span><span>${t.label}</span>
    </a>`).join('');
}

function renderHeader() {
  const d = new Date();
  document.getElementById('date').textContent = `${d.getMonth() + 1}월 ${d.getDate()}일 (${DAY_NAMES[d.getDay()]})`;
}

async function render() {
  const run = async () => {
    current = tabFromHash();
    renderNav();
    renderHeader();
    const main = document.getElementById('main');
    const tab = TABS.find((t) => t.id === current);
    try {
      await tab.view.render(main, ctx);
    } catch (e) {
      console.error(e);
      main.innerHTML = `<div class="card error-card"><h2>화면을 그리지 못했습니다</h2>
        <p>${esc(e?.message || e)}</p><button class="btn" id="retry">다시 시도</button></div>`;
      document.getElementById('retry')?.addEventListener('click', () => render());
    }
  };
  rendering = rendering.then(run, run);
  return rendering;
}

function updateOnline() {
  const b = document.getElementById('offline');
  if (b) b.hidden = navigator.onLine !== false;
}

window.addEventListener('error', (e) => { console.error(e.error || e.message); toast('오류가 발생했지만 계속 사용할 수 있습니다', 'error'); });
window.addEventListener('unhandledrejection', (e) => { console.error(e.reason); toast('처리 중 오류: ' + (e.reason?.message || '알 수 없음'), 'error'); e.preventDefault(); });
window.addEventListener('hashchange', () => { window.scrollTo(0, 0); render(); });
window.addEventListener('online', updateOnline);
window.addEventListener('offline', updateOnline);

(async function start() {
  updateOnline();
  if (await db.isMemoryMode()) {
    const w = document.getElementById('memwarn');
    if (w) w.hidden = false;
  }
  if (navigator.storage?.persist) navigator.storage.persist().catch(() => {});
  render();
  if ('serviceWorker' in navigator && location.protocol !== 'file:') {
    navigator.serviceWorker.register('./sw.js').catch((e) => console.warn('서비스워커 등록 실패', e));
  }
})();
