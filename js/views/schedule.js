// 시간표: 회차(등원 1차, 하원 1차 …)별 출발 시각·요일·탑승 원아
import { esc, DAY_NAMES } from '../util.js';
import { newId } from '../db.js';
import { parseHHMM } from '../route/optimize.js';

let editingId = null; // null | 'new' | run id

function formHtml(run, children) {
  const sel = new Set(run.childIds || []);
  const days = new Set(run.days || []);
  return `
    <form class="card form" id="run-form">
      <h3>${run.id ? '회차 수정' : '새 회차'}</h3>
      <label>이름<input name="name" required value="${esc(run.name || '')}" placeholder="예: 등원 1차"></label>
      <div class="two">
        <label>구분<select name="type">
          <option value="am" ${run.type !== 'pm' ? 'selected' : ''}>등원</option>
          <option value="pm" ${run.type === 'pm' ? 'selected' : ''}>하원</option></select></label>
        <label>출발 시각<input type="time" name="departTime" required value="${esc(run.departTime || '08:20')}"></label>
      </div>
      <fieldset><legend>운행 요일</legend><div class="chips wrap">
        ${[1, 2, 3, 4, 5, 6, 0].map((d) => `<label class="chip toggle"><input type="checkbox" name="days" value="${d}" ${days.has(d) ? 'checked' : ''}><span>${DAY_NAMES[d]}</span></label>`).join('')}
      </div></fieldset>
      <fieldset><legend>탑승 원아 (${children.length}명 중)</legend><div class="chips wrap">
        ${children.length ? children.map((c) => `<label class="chip toggle"><input type="checkbox" name="kids" value="${esc(c.id)}" ${sel.has(c.id) ? 'checked' : ''}><span>${esc(c.name)}</span></label>`).join('') : '<span class="muted">명단에 원아를 먼저 등록하세요</span>'}
      </div></fieldset>
      <div class="actions">
        <button class="btn primary big" type="submit">저장</button>
        <button class="btn" type="button" id="cancel">취소</button>
        ${run.id ? '<button class="btn danger" type="button" id="delete">회차 삭제</button>' : ''}
      </div>
    </form>`;
}

export async function render(el, ctx) {
  const { db } = ctx;
  const [children, runs] = await Promise.all([db.getAll('children'), db.getAll('runs')]);
  children.sort((a, b) => a.name.localeCompare(b.name, 'ko'));
  runs.sort((a, b) => parseHHMM(a.departTime) - parseHHMM(b.departTime));
  const byId = new Map(children.map((c) => [c.id, c]));

  const editing = editingId === 'new' ? { type: 'am', days: [1, 2, 3, 4, 5], childIds: [] } : runs.find((r) => r.id === editingId);

  el.innerHTML = `
    ${editing ? formHtml(editing, children) : '<button class="btn primary big full" id="add">+ 회차 추가</button>'}
    ${runs.map((r) => `
      <section class="card run">
        <div class="run-head">
          <span class="time big-time">${esc(r.departTime)}</span>
          <span class="who"><b>${esc(r.name)}</b><small>${r.type === 'pm' ? '하원' : '등원'} · ${(r.days || []).map((d) => DAY_NAMES[d]).join('') || '요일 없음'} · ${(r.childIds || []).length}명${r.myOrder?.length ? ' · 내 코스 저장됨' : ''}</small></span>
          <button class="btn" data-edit="${esc(r.id)}">수정</button>
        </div>
        <p class="names">${(r.childIds || []).map((id) => byId.get(id)?.name).filter(Boolean).map(esc).join(', ') || '<span class="muted">배정된 원아 없음</span>'}</p>
      </section>`).join('')}
    ${runs.length ? '' : '<p class="muted">회차가 없습니다. 위 버튼으로 추가하세요.</p>'}
  `;

  el.querySelector('#add')?.addEventListener('click', () => { editingId = 'new'; ctx.refresh(); });
  el.querySelectorAll('[data-edit]').forEach((b) => b.addEventListener('click', () => { editingId = b.dataset.edit; ctx.refresh(); }));
  el.querySelector('#cancel')?.addEventListener('click', () => { editingId = null; ctx.refresh(); });
  el.querySelector('#delete')?.addEventListener('click', async () => {
    if (!confirm(`'${editing.name}' 회차를 삭제할까요?`)) return;
    await db.del('runs', editing.id);
    await ctx.touch();
    editingId = null;
    ctx.refresh();
  });
  el.querySelector('#run-form')?.addEventListener('submit', async (e) => {
    e.preventDefault();
    const f = new FormData(e.target);
    const run = {
      ...editing,
      id: editing.id || newId('r'),
      name: String(f.get('name')).trim() || '회차',
      type: f.get('type') === 'pm' ? 'pm' : 'am',
      departTime: String(f.get('departTime') || '08:00'),
      days: f.getAll('days').map(Number),
      childIds: f.getAll('kids').map(String),
      myOrder: editing.myOrder || null,
      updatedAt: Date.now(),
    };
    await db.put('runs', run);
    await ctx.touch();
    editingId = null;
    ctx.toast('회차를 저장했습니다');
    ctx.refresh();
  });
}
