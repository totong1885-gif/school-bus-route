// 코스: 추천 코스 vs 내 코스 비교, ▲▼로 순서 변경 후 저장
import { esc, DAY_NAMES } from '../util.js';
import { buildPlan, decorate } from '../plan.js';
import { stopTitle } from '../stops.js';
import { fmtHHMM, fmtKm, parseHHMM } from '../route/optimize.js';

let pickedRunId = null;
let draft = null; // { runId, keys:[] } 저장 전 편집 중인 순서
let show = 'mine'; // 좁은 화면에서 보이는 쪽

function columnHtml(title, icon, meta, plan, start, run, editable) {
  const rows = plan.ordered.map((s, i) => `
    <li class="row">
      <span class="time">${fmtHHMM(plan.times[i + 1])}</span>
      <span class="who"><b>${esc(stopTitle(s))}</b><small>${esc(s.address)}</small>
        <em>↳ 이전 지점에서 ${plan.legs[i].minutes}분 · ${fmtKm(plan.legs[i].meters)}</em></span>
      ${editable ? `<span class="updown">
        <button class="btn sq" data-up="${i}" ${i === 0 ? 'disabled' : ''} aria-label="위로">▲</button>
        <button class="btn sq" data-down="${i}" ${i === plan.ordered.length - 1 ? 'disabled' : ''} aria-label="아래로">▼</button></span>` : ''}
    </li>`).join('');
  const last = plan.legs[plan.legs.length - 1];
  return `
    <section class="card col">
      <h3>${icon} ${title} <small>약 ${plan.totalMin}분 · ${fmtKm(plan.totalM)} ${meta}</small></h3>
      <ol class="rows">
        <li class="row fixed"><span class="time">${fmtHHMM(plan.times[0])}</span><span class="who"><b>${esc(start.name)} 출발</b><small>${esc(start.address)}</small></span></li>
        ${rows}
        <li class="row fixed"><span class="time">${fmtHHMM(plan.times[plan.times.length - 1])}</span><span class="who"><b>${esc(start.name)} 도착</b><small>${esc(start.address)}</small>
          ${last ? `<em>↳ 이전 지점에서 ${last.minutes}분 · ${fmtKm(last.meters)}</em>` : ''}</span></li>
      </ol>
    </section>`;
}

export async function render(el, ctx) {
  const { db } = ctx;
  const [settings, children, runs] = await Promise.all([db.getSettings(), db.getAll('children'), db.getAll('runs')]);
  if (!runs.length) {
    el.innerHTML = `<div class="card empty"><h2>회차가 없습니다</h2><p>시간표에서 회차를 먼저 만드세요.</p><button class="btn primary" data-go="schedule">시간표로</button></div>`;
    el.querySelector('[data-go]').addEventListener('click', () => ctx.go('schedule'));
    return;
  }
  const sorted = runs.slice().sort((a, b) => parseHHMM(a.departTime) - parseHHMM(b.departTime));
  const run = sorted.find((r) => r.id === pickedRunId) || sorted[0];
  pickedRunId = run.id;
  if (draft && draft.runId !== run.id) draft = null;

  const plan = await buildPlan(run, children, settings);
  const chips = sorted.map((r) => `<button class="chip ${r.id === run.id ? 'on' : ''}" data-run="${esc(r.id)}">${esc(r.name)} <small>${esc(r.departTime)}</small></button>`).join('');

  if (!plan.ok) {
    el.innerHTML = `<div class="chips">${chips}</div><div class="card warn"><h2>어린이집 위치가 없습니다</h2><p>설정에서 어린이집 주소의 좌표를 찾아 주세요.</p><button class="btn primary" data-go="settings">설정으로</button></div>`;
    el.querySelector('[data-go]').addEventListener('click', () => ctx.go('settings'));
    el.querySelectorAll('[data-run]').forEach((b) => b.addEventListener('click', () => { pickedRunId = b.dataset.run; ctx.refresh(); }));
    return;
  }

  // 편집 중인 순서가 있으면 그것을, 없으면 저장된 내 코스(없으면 추천)를 보여 준다
  let mine = plan.mine;
  if (draft) {
    const byKey = new Map(plan.mine.ordered.map((s) => [s.key, s]));
    const ordered = draft.keys.map((k) => byKey.get(k)).filter(Boolean);
    for (const s of plan.mine.ordered) if (!draft.keys.includes(s.key)) ordered.push(s);
    mine = decorate(plan.start, plan.end, ordered, run, settings);
  }
  const days = (run.days || []).map((d) => DAY_NAMES[d]).join('');
  const status = draft ? '<b class="dirty">변경됨 — 저장 필요</b>' : (plan.hasSaved ? '저장됨' : '아직 저장 안 함 — 추천 순서로 표시 중');
  const diff = mine.totalM - plan.recommended.totalM;

  el.innerHTML = `
    <div class="chips">${chips}</div>
    <p class="muted small">${esc(run.type === 'pm' ? '하원' : '등원')} · ${esc(days)} · 정류장 ${plan.recommended.ordered.length}곳 · 거리/시간은 ${esc(plan.providerLabel)} 기준 추정 (평균 ${settings.speedKmh}km/h, 정차 ${settings.dwellMin}분)</p>
    ${plan.missing.length ? `<div class="card warn">좌표가 없어 빠진 원아: <b>${esc(plan.missing.map((c) => c.name).join(', '))}</b></div>` : ''}
    ${plan.recommended.ordered.length === 0 ? '<div class="card empty">이 회차에 좌표가 있는 원아가 없습니다. 시간표에서 원아를 배정하세요.</div>' : `
    <div class="seg" role="tablist">
      <button class="${show === 'rec' ? 'on' : ''}" data-show="rec">🤖 추천 코스</button>
      <button class="${show === 'mine' ? 'on' : ''}" data-show="mine">🚐 내 코스</button>
    </div>
    <div class="cols" data-show="${show}">
      <div class="col-rec">${columnHtml('추천 코스', '🤖', '최단 순서', plan.recommended, plan.start, run, false)}</div>
      <div class="col-mine">${columnHtml('내 코스', '🚐', status, mine, plan.start, run, true)}
        <p class="muted small">${Math.abs(diff) < 50 ? '추천 코스와 거리 차이 없음' : (diff > 0 ? `추천보다 ${fmtKm(diff)} 더 김` : `추천보다 ${fmtKm(-diff)} 짧음`)}</p>
        <div class="actions">
          <button class="btn primary big" id="save" ${draft ? '' : 'disabled'}>내 코스 저장</button>
          <button class="btn" id="use-rec">추천 순서로 되돌리기</button>
        </div>
      </div>
    </div>`}
  `;

  const keys = mine.ordered.map((s) => s.key);
  const move = (i, d) => {
    const j = i + d;
    if (j < 0 || j >= keys.length) return;
    [keys[i], keys[j]] = [keys[j], keys[i]];
    draft = { runId: run.id, keys };
    ctx.refresh();
  };
  el.querySelectorAll('[data-run]').forEach((b) => b.addEventListener('click', () => {
    if (draft && !confirm('저장하지 않은 변경이 있습니다. 버리고 이동할까요?')) return;
    draft = null; pickedRunId = b.dataset.run; ctx.refresh();
  }));
  el.querySelectorAll('[data-show]').forEach((b) => b.addEventListener('click', () => { show = b.dataset.show; ctx.refresh(); }));
  el.querySelectorAll('[data-up]').forEach((b) => b.addEventListener('click', () => move(+b.dataset.up, -1)));
  el.querySelectorAll('[data-down]').forEach((b) => b.addEventListener('click', () => move(+b.dataset.down, 1)));
  el.querySelector('#save')?.addEventListener('click', async () => {
    await db.put('runs', { ...run, myOrder: keys, updatedAt: Date.now() });
    await ctx.touch();
    draft = null;
    ctx.toast('내 코스를 저장했습니다');
    ctx.refresh();
  });
  el.querySelector('#use-rec')?.addEventListener('click', async () => {
    if (!confirm('저장된 내 코스를 지우고 추천 순서를 쓸까요?')) return;
    await db.put('runs', { ...run, myOrder: null, updatedAt: Date.now() });
    await ctx.touch();
    draft = null;
    ctx.refresh();
  });
}
