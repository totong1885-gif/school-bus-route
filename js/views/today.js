// 오늘 운행: 결석 체크 → 순서 재계산, 다음 정류장 길안내, 도착 완료 체크.
// 계산 결과(snapshot)를 IndexedDB에 저장 → 오프라인/앱 재시작에도 마지막 코스를 그대로 보여 준다.
import { esc, localDate } from '../util.js';
import { buildPlan } from '../plan.js';
import { stopTitle } from '../stops.js';
import { fmtHHMM, fmtKm, parseHHMM } from '../route/optimize.js';
import { launchNavi, NAVI_APPS } from '../navi.js';

let pickedRunId = null;

function autoPick(runs) {
  const now = new Date();
  const dow = now.getDay();
  const mins = now.getHours() * 60 + now.getMinutes();
  const todays = runs.filter((r) => (r.days || []).includes(dow));
  const list = (todays.length ? todays : runs).slice().sort((a, b) => parseHHMM(a.departTime) - parseHHMM(b.departTime));
  return list.find((r) => parseHHMM(r.departTime) >= mins - 60) || list[list.length - 1];
}

async function rebuild(state, run, children, settings) {
  const plan = await buildPlan(run, children, settings, { absent: state.absent });
  const rosterIds = new Set(run.childIds || []);
  const snap = {
    builtAt: Date.now(),
    runName: run.name,
    departTime: run.departTime,
    roster: children.filter((c) => rosterIds.has(c.id)).map((c) => ({ id: c.id, name: c.name })),
    ok: plan.ok,
    reason: plan.reason || null,
    missing: (plan.missing || []).map((c) => c.name),
    usesMyOrder: !!plan.hasSaved,
  };
  if (plan.ok) {
    const m = plan.mine;
    snap.start = plan.start;
    snap.stops = m.ordered.map((s, i) => ({ ...s, eta: m.times[i + 1], leg: m.legs[i] }));
    snap.endEta = m.times[m.times.length - 1];
    snap.totalM = m.totalM;
  }
  state.snapshot = snap;
}

export async function render(el, ctx) {
  const { db } = ctx;
  const [settings, children, runs, rev] = await Promise.all([
    db.getSettings(), db.getAll('children'), db.getAll('runs'), db.get('kv', 'rev'),
  ]);
  let state = await db.get('kv', 'today');
  const date = localDate();

  if (!runs.length) {
    el.innerHTML = `<div class="card empty">
      <h2>운행 회차가 없습니다</h2>
      <p>명단에서 원아를 등록하고, 시간표에서 등원·하원 회차를 만들어 주세요.</p>
      <button class="btn primary" data-go="roster">명단으로</button>
      <button class="btn" data-go="settings">설정 (샘플 데이터)</button></div>`;
    el.querySelectorAll('[data-go]').forEach((b) => b.addEventListener('click', () => ctx.go(b.dataset.go)));
    return;
  }

  let run = runs.find((r) => r.id === pickedRunId)
    || (state && state.date === date && runs.find((r) => r.id === state.runId))
    || autoPick(runs);
  pickedRunId = run.id;

  let dirty = false;
  if (!state || state.date !== date || state.runId !== run.id) {
    state = { id: 'today', date, runId: run.id, absent: [], done: [], snapshot: null };
    dirty = true;
  }
  if (!state.snapshot || (rev?.t || 0) > state.snapshot.builtAt) {
    try { await rebuild(state, run, children, settings); dirty = true; } catch (e) {
      console.error(e);
      ctx.toast('코스를 다시 계산하지 못해 마지막 코스를 표시합니다', 'error');
    }
  }
  if (dirty) await db.put('kv', state);

  const snap = state.snapshot || { ok: false, reason: 'NONE', roster: [], missing: [] };
  const done = new Set(state.done);
  const absent = new Set(state.absent);
  const stops = snap.stops || [];
  const next = stops.find((s) => !done.has(s.key));
  const doneCount = stops.filter((s) => done.has(s.key)).length;
  const naviLabel = NAVI_APPS[settings.naviApp]?.label || '카카오맵';

  const runChips = runs.slice().sort((a, b) => parseHHMM(a.departTime) - parseHHMM(b.departTime)).map((r) => `
    <button class="chip ${r.id === run.id ? 'on' : ''}" data-run="${esc(r.id)}">${esc(r.name)} <small>${esc(r.departTime || '')}</small></button>`).join('');

  let body = '';
  if (!snap.ok) {
    body = snap.reason === 'NO_DAYCARE'
      ? `<div class="card warn"><h2>어린이집 위치가 없습니다</h2><p>설정에서 어린이집 주소의 좌표를 먼저 찾아 주세요.</p><button class="btn primary" data-go="settings">설정으로</button></div>`
      : `<div class="card warn"><p>코스를 만들 수 없습니다.</p></div>`;
  } else if (next) {
    body = `
      <section class="next card">
        <div class="next-label">다음 정류장 · ${doneCount + 1}/${stops.length}</div>
        <div class="next-name">${esc(stopTitle(next))}</div>
        <div class="next-addr">${esc(next.address)}</div>
        <div class="next-eta">예상 ${fmtHHMM(next.eta)}</div>
        <button class="btn huge go" data-navi="${esc(next.key)}">▶ 다음 정류장 길안내<small>${esc(naviLabel)}</small></button>
        <button class="btn big ok" data-done="${esc(next.key)}">✓ 도착 완료</button>
      </section>`;
  } else {
    body = `
      <section class="next card">
        <div class="next-label">모든 정류장 완료 (${stops.length}곳)</div>
        <div class="next-name">어린이집으로 복귀</div>
        <div class="next-eta">예상 ${fmtHHMM(snap.endEta)}</div>
        <button class="btn huge go" data-navi="__end">▶ 어린이집 길안내<small>${esc(naviLabel)}</small></button>
      </section>`;
  }

  const list = stops.map((s, i) => `
    <li class="stop ${done.has(s.key) ? 'done' : ''} ${next && s.key === next.key ? 'current' : ''}">
      <span class="time">${fmtHHMM(s.eta)}</span>
      <span class="who"><b>${i + 1}. ${esc(stopTitle(s))}</b><small>${esc(s.address)}</small></span>
      <button class="btn check" data-toggle="${esc(s.key)}" aria-label="${done.has(s.key) ? '완료 취소' : '완료'}">${done.has(s.key) ? '✓' : '○'}</button>
    </li>`).join('');

  const rosterHtml = (snap.roster || []).map((c) => `
    <button class="chip absent-chip ${absent.has(c.id) ? 'on' : ''}" data-absent="${esc(c.id)}" aria-pressed="${absent.has(c.id)}">
      ${absent.has(c.id) ? '결석 ' : ''}${esc(c.name)}</button>`).join('');

  el.innerHTML = `
    <div class="chips">${runChips}</div>
    ${body}
    ${snap.missing?.length ? `<div class="card warn">좌표가 없어 코스에서 빠진 원아: <b>${esc(snap.missing.join(', '))}</b> (명단에서 주소 확인)</div>` : ''}
    <section class="card">
      <h3>결석 체크 <small>누르면 결석 / 다시 누르면 취소. 정류장에서 빠지고 순서를 다시 계산합니다</small></h3>
      <div class="chips wrap">${rosterHtml || '<span class="muted">이 회차에 배정된 원아가 없습니다</span>'}</div>
    </section>
    ${stops.length ? `<section class="card">
      <h3>오늘 코스 <small>${snap.usesMyOrder ? '내 코스 순서' : '추천 순서'} · 출발 ${esc(snap.departTime || '')} · 약 ${fmtKm(snap.totalM || 0)}(직선)</small></h3>
      <ol class="stops">${list}</ol>
      <button class="btn" id="reset-done">완료 체크 모두 지우기</button>
    </section>` : ''}
  `;

  const save = async () => { await db.put('kv', state); await ctx.refresh(); };

  el.querySelectorAll('[data-go]').forEach((b) => b.addEventListener('click', () => ctx.go(b.dataset.go)));
  el.querySelectorAll('[data-run]').forEach((b) => b.addEventListener('click', () => { pickedRunId = b.dataset.run; ctx.refresh(); }));
  el.querySelectorAll('[data-navi]').forEach((b) => b.addEventListener('click', async () => {
    const key = b.dataset.navi;
    const dest = key === '__end'
      ? { name: snap.start?.name || '어린이집', lat: snap.start?.lat, lng: snap.start?.lng }
      : (() => { const s = stops.find((x) => x.key === key); return { name: stopTitle(s), lat: s.lat, lng: s.lng }; })();
    const r = await launchNavi(settings.naviApp, dest, settings);
    ctx.toast(r.message, r.ok ? 'info' : 'error');
  }));
  el.querySelectorAll('[data-done]').forEach((b) => b.addEventListener('click', () => {
    if (!state.done.includes(b.dataset.done)) state.done.push(b.dataset.done);
    save();
  }));
  el.querySelectorAll('[data-toggle]').forEach((b) => b.addEventListener('click', () => {
    const k = b.dataset.toggle;
    state.done = state.done.includes(k) ? state.done.filter((x) => x !== k) : [...state.done, k];
    save();
  }));
  el.querySelectorAll('[data-absent]').forEach((b) => b.addEventListener('click', async () => {
    const id = b.dataset.absent;
    state.absent = state.absent.includes(id) ? state.absent.filter((x) => x !== id) : [...state.absent, id];
    try { await rebuild(state, run, children, settings); } catch (e) { console.error(e); ctx.toast('재계산 실패, 이전 코스 유지', 'error'); }
    save();
  }));
  el.querySelector('#reset-done')?.addEventListener('click', () => {
    if (confirm('오늘 완료 체크를 모두 지울까요?')) { state.done = []; save(); }
  });
}
