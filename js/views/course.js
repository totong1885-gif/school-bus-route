// 코스: 호차·등하원별 추천 코스 vs 내 코스 비교 (요일 예외 없는 기본 배정 기준)
import { esc } from '../util.js';
import { courseId, fmtHHMM, SHIFT_LABEL } from '../model.js';
import { pickSel, selectorHtml, bindSelector, minLabel, kmLabel, riderNames } from './common.js';

let draft = null; // { cid, keys }
let show = 'mine';

function column(title, sub, c, start, editable) {
  const rows = c.stops.map((s, i) => `
    <li class="row">
      <span class="time">${fmtHHMM(c.rows[i].time)}</span>
      <span class="who"><b>${riderNames(s)}</b><small>${esc(s.address)}</small>
        <em>↳ 이전 지점에서 ${minLabel(c.rows[i].travel)} · ${kmLabel(c.legsMeters[i])}${c.rows[i].wait >= 1 ? ` · ${minLabel(c.rows[i].wait)} 대기` : ''}</em>
        ${c.rows[i].late ? `<em class="red">희망 시각보다 ${minLabel(c.rows[i].late)} 늦음</em>` : ''}</span>
      ${editable ? `<span class="updown">
        <button class="btn sq" data-up="${i}" ${i === 0 ? 'disabled' : ''} aria-label="위로">▲</button>
        <button class="btn sq" data-down="${i}" ${i === c.stops.length - 1 ? 'disabled' : ''} aria-label="아래로">▼</button></span>` : ''}
    </li>`).join('');
  const lastLeg = c.legsMeters.length - 1;
  return `<section class="card col">
    <h3>${title} <small>약 ${minLabel(c.total)} · ${kmLabel(c.totalMeters)} ${sub}</small></h3>
    <ol class="rows">
      <li class="row fixed"><span class="time">${fmtHHMM(c.end - c.total)}</span><span class="who"><b>${esc(start.name)} 출발</b><small>${esc(start.address)}</small></span></li>
      ${rows}
      <li class="row fixed"><span class="time">${fmtHHMM(c.end)}</span><span class="who"><b>${esc(start.name)} 도착</b>
        <em>↳ 이전 지점에서 ${kmLabel(c.legsMeters[lastLeg] || 0)}</em></span></li>
    </ol></section>`;
}

export async function render(el, ctx) {
  const { db } = ctx;
  const [settings, children, courses] = await Promise.all([ctx.settings(), db.getAll('children'), db.getAll('courses')]);
  const sel = pickSel(settings, ctx.shared);
  const cid = courseId(sel.vehicle, sel.shift);
  if (draft && draft.cid !== cid) draft = null;
  const saved = courses.find((c) => c.id === cid)?.order || null;

  el.innerHTML = `${selectorHtml(sel)}<div id="body"><div class="card loading">코스 계산 중…</div></div>`;
  bindSelector(el, ctx.shared, (apply) => {
    if (draft && !confirm('저장하지 않은 순서 변경이 있습니다. 버리고 이동할까요?')) return;
    draft = null; apply(); ctx.refresh();
  });

  const course = await ctx.compute({ settings, children, vehicle: sel.vehicle, shift: sel.shift, dow: null, savedOrder: saved, manualOrder: draft?.keys || null });
  const body = el.querySelector('#body');
  if (!course.ok) {
    body.innerHTML = `<div class="card warn"><h3>코스를 계산하지 못했습니다</h3><p>${esc(course.message)}</p>
      <p class="small">인터넷 연결과 설정의 카카오 REST 키를 확인하세요. (위치 정보는 저장하지 않으므로 계산할 때마다 인터넷이 필요합니다)</p>
      <button class="btn primary" data-go="settings">설정으로</button></div>`;
    body.querySelector('[data-go]').addEventListener('click', () => ctx.go('settings'));
    return;
  }
  if (!course.recommended.stops.length) {
    body.innerHTML = `<div class="card empty">${sel.vehicle}호차 ${SHIFT_LABEL[sel.shift]}에 배정된 아이가 없습니다. 명단에서 호차를 지정하세요.</div>`;
    return;
  }

  const rec = course.recommended;
  const mine = course.mine;
  const diff = Math.round(mine.total - rec.total);
  const diffText = diff > 0 ? `내 코스가 추천보다 <b>${diff}분 더 걸려요</b>` : diff < 0 ? `내 코스가 추천보다 <b>${-diff}분 빨라요</b>` : '내 코스와 추천 코스의 시간이 같아요';
  const status = draft ? '<b class="red">변경됨 · 저장 필요</b>' : course.hasSaved ? '저장됨' : '아직 저장 안 함 · 추천 순서로 표시 중';

  body.innerHTML = `
    <p class="muted small">${SHIFT_LABEL[sel.shift]} ${sel.vehicle}호차 · 월~금 기본 배정 기준 · ${esc(course.label)}${course.providerError ? ' (도로 시간 실패로 직선 추정)' : ''} · 정차 ${settings.dwellMin}분, 여유 ×${settings.marginFactor}, 도로보정 ×${settings.roadFactor}</p>
    ${course.failed.length ? `<div class="card warn">위치를 못 찾아 빠진 정류장: <b>${esc(course.failed.map((s) => s.address).join(', '))}</b></div>` : ''}
    <div class="card diff">${diffText}</div>
    <div class="seg" role="tablist">
      <button class="${show === 'rec' ? 'on' : ''}" data-show="rec">🤖 추천 코스</button>
      <button class="${show === 'mine' ? 'on' : ''}" data-show="mine">🚐 내 코스</button>
    </div>
    <div class="cols" data-show="${show}">
      <div class="col-rec">${column('🤖 추천 코스', '가장 빠른 순서', rec, course.start, false)}
        <div class="actions">
          <button class="btn" id="recalc">이동거리로 최적 코스 계산</button>
          <button class="btn" id="copy-rec">추천 → 내 코스로 복사</button>
        </div></div>
      <div class="col-mine">${column('🚐 내 코스', status, mine, course.start, true)}
        <div class="actions">
          <button class="btn primary big" id="save" ${draft ? '' : 'disabled'}>내 코스 저장</button>
          ${course.hasSaved ? '<button class="btn danger" id="clear">내 코스 지우기 (추천으로 복귀)</button>' : ''}
        </div></div>
    </div>`;

  const keys = mine.stops.map((s) => s.key);
  const setDraft = (k) => { draft = { cid, keys: k }; ctx.refresh(); };
  const move = (i, d) => {
    const j = i + d;
    if (j < 0 || j >= keys.length) return;
    [keys[i], keys[j]] = [keys[j], keys[i]];
    setDraft(keys);
  };
  body.querySelectorAll('[data-show]').forEach((b) => b.addEventListener('click', () => { show = b.dataset.show; ctx.refresh(); }));
  body.querySelectorAll('[data-up]').forEach((b) => b.addEventListener('click', () => move(+b.dataset.up, -1)));
  body.querySelectorAll('[data-down]').forEach((b) => b.addEventListener('click', () => move(+b.dataset.down, 1)));
  body.querySelector('#recalc').addEventListener('click', () => { ctx.toast(`최적 순서를 다시 계산했습니다 (${course.label})`); ctx.refresh(); });
  body.querySelector('#copy-rec').addEventListener('click', () => { setDraft(rec.stops.map((s) => s.key)); show = 'mine'; });
  body.querySelector('#save')?.addEventListener('click', async () => {
    await db.put('courses', { id: cid, order: keys, updatedAt: Date.now() });
    draft = null;
    ctx.toast('내 코스를 저장했습니다. 오늘 화면과 시간표에 반영됩니다');
    ctx.refresh();
  });
  body.querySelector('#clear')?.addEventListener('click', async () => {
    if (!confirm('저장된 내 코스를 지우고 추천 순서로 돌아갈까요?')) return;
    await db.del('courses', cid);
    draft = null;
    ctx.refresh();
  });
}
