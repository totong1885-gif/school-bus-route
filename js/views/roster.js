// 명단: 원아 등록·수정·삭제. 같은 주소는 한 정류장으로 묶어서 보여 준다.
import { esc, parseLatLng } from '../util.js';
import { newId } from '../db.js';
import { buildStops, normalizeAddress } from '../stops.js';
import { geocode } from '../geocode.js';

let editingId = null; // null | 'new' | child id

function formHtml(c, runs) {
  const inRuns = new Set(runs.filter((r) => (r.childIds || []).includes(c.id)).map((r) => r.id));
  const coords = Number.isFinite(c.lat) ? `${c.lat}, ${c.lng}` : '';
  return `
    <form class="card form" id="kid-form">
      <h3>${c.id ? '원아 수정' : '원아 등록'}</h3>
      <label>이름<input name="name" required value="${esc(c.name || '')}" autocomplete="off"></label>
      <label>주소 <small>도로명 주소 권장 (예: ○○시 ○○로 12)</small><input name="address" required value="${esc(c.address || '')}" autocomplete="off"></label>
      <label>상세주소 <small>동·호수. 정류장 묶기와 좌표 검색에는 쓰지 않음</small><input name="detail" value="${esc(c.detail || '')}" autocomplete="off"></label>
      ${runs.length ? `<fieldset><legend>탑승 회차</legend><div class="chips wrap">
        ${runs.map((r) => `<label class="chip toggle"><input type="checkbox" name="runs" value="${esc(r.id)}" ${inRuns.has(r.id) || (!c.id && runs.length === 1) ? 'checked' : ''}><span>${esc(r.name)}</span></label>`).join('')}
      </div></fieldset>` : ''}
      <details><summary>좌표 직접 입력 (주소 검색이 안 될 때)</summary>
        <label>위도, 경도<input name="coords" value="${esc(coords)}" placeholder="37.12345, 127.12345" inputmode="decimal"></label>
      </details>
      <div class="actions">
        <button class="btn primary big" type="submit">저장</button>
        <button class="btn" type="button" id="cancel">취소</button>
        ${c.id ? '<button class="btn danger" type="button" id="delete">삭제</button>' : ''}
      </div>
    </form>`;
}

export async function render(el, ctx) {
  const { db } = ctx;
  const [settings, children, runs] = await Promise.all([db.getSettings(), db.getAll('children'), db.getAll('runs')]);
  children.sort((a, b) => a.name.localeCompare(b.name, 'ko'));
  const { stops, missing } = buildStops(children);
  const byId = new Map(children.map((c) => [c.id, c]));
  const editing = editingId === 'new' ? {} : byId.get(editingId);

  const kidBtn = (k) => `<button class="chip" data-edit="${esc(k.id)}">${esc(k.name)}${byId.get(k.id)?.detail ? ` <small>${esc(byId.get(k.id).detail)}</small>` : ''}</button>`;

  el.innerHTML = `
    ${editing ? formHtml(editing, runs) : `
      <button class="btn primary big full" id="add">+ 원아 등록</button>
      ${settings.kakaoRestKey ? '' : '<div class="card warn">카카오 REST 키가 없어 주소로 좌표를 찾을 수 없습니다. 설정에서 입력하거나 좌표를 직접 입력하세요.</div>'}`}
    ${missing.length ? `<section class="card warn">
      <h3>좌표 없음 (${missing.length}명) <small>코스에서 빠집니다</small></h3>
      <div class="chips wrap">${missing.map((c) => kidBtn(c)).join('')}</div>
      <button class="btn" id="geo-missing">좌표 다시 검색</button>
    </section>` : ''}
    <h3 class="section-title">정류장 ${stops.length}곳 · 원아 ${children.length}명</h3>
    ${stops.map((s) => `
      <section class="card stop-card">
        <div class="addr">📍 ${esc(s.address)}${s.children.length > 1 ? ` <span class="badge">${s.children.length}명 한 정류장</span>` : ''}</div>
        <div class="chips wrap">${s.children.map(kidBtn).join('')}</div>
      </section>`).join('')}
    ${children.length ? `<button class="btn" id="geo-all">전체 좌표 다시 받기 <small>(주소 변경 반영)</small></button>` : ''}
  `;

  el.querySelector('#add')?.addEventListener('click', () => { editingId = 'new'; ctx.refresh(); });
  el.querySelectorAll('[data-edit]').forEach((b) => b.addEventListener('click', () => { editingId = b.dataset.edit; ctx.refresh(); window.scrollTo(0, 0); }));
  el.querySelector('#cancel')?.addEventListener('click', () => { editingId = null; ctx.refresh(); });

  el.querySelector('#delete')?.addEventListener('click', async () => {
    if (!confirm(`${editing.name} 원아를 삭제할까요?`)) return;
    await db.del('children', editing.id);
    for (const r of runs) {
      if ((r.childIds || []).includes(editing.id)) await db.put('runs', { ...r, childIds: r.childIds.filter((x) => x !== editing.id), updatedAt: Date.now() });
    }
    await ctx.touch();
    editingId = null;
    ctx.refresh();
  });

  el.querySelector('#kid-form')?.addEventListener('submit', async (e) => {
    e.preventDefault();
    const btn = e.target.querySelector('[type=submit]');
    btn.disabled = true;
    try {
      const f = new FormData(e.target);
      const address = normalizeAddress(f.get('address'));
      const c = {
        ...editing,
        id: editing.id || newId('c'),
        name: String(f.get('name')).trim(),
        address,
        detail: String(f.get('detail') || '').trim(),
        updatedAt: Date.now(),
      };
      const manual = parseLatLng(f.get('coords'));
      const prevCoords = Number.isFinite(editing.lat) ? `${editing.lat}, ${editing.lng}` : '';
      const manualChanged = String(f.get('coords') || '').trim() !== prevCoords;
      if (manual && manualChanged) {
        Object.assign(c, { lat: manual.lat, lng: manual.lng, roadAddress: '', geoStatus: 'manual' });
      } else if (address !== editing.address || !Number.isFinite(editing.lat)) {
        try {
          const g = await geocode(address, settings.kakaoRestKey);
          Object.assign(c, { lat: g.lat, lng: g.lng, roadAddress: g.roadAddress || g.addressName, geoStatus: 'ok' });
        } catch (err) {
          Object.assign(c, { lat: null, lng: null, roadAddress: '', geoStatus: 'fail' });
          ctx.toast(`저장했지만 좌표를 찾지 못했습니다: ${err.message}`, 'error');
        }
      }
      await db.put('children', c);
      const picked = new Set(f.getAll('runs').map(String));
      for (const r of runs) {
        const has = (r.childIds || []).includes(c.id);
        if (picked.has(r.id) && !has) await db.put('runs', { ...r, childIds: [...(r.childIds || []), c.id], updatedAt: Date.now() });
        if (!picked.has(r.id) && has) await db.put('runs', { ...r, childIds: r.childIds.filter((x) => x !== c.id), updatedAt: Date.now() });
      }
      await ctx.touch();
      editingId = null;
      if (c.geoStatus !== 'fail') ctx.toast('저장했습니다');
      ctx.refresh();
    } finally {
      btn.disabled = false;
    }
  });

  const regeo = async (list, btn) => {
    if (!settings.kakaoRestKey) { ctx.toast('설정에서 카카오 REST 키를 먼저 입력하세요', 'error'); return; }
    btn.disabled = true;
    let ok = 0; let fail = 0; let lastErr = '';
    for (const c of list) {
      btn.textContent = `검색 중… ${ok + fail + 1}/${list.length}`;
      try {
        const g = await geocode(c.address, settings.kakaoRestKey);
        await db.put('children', { ...c, lat: g.lat, lng: g.lng, roadAddress: g.roadAddress || g.addressName, geoStatus: 'ok', updatedAt: Date.now() });
        ok++;
      } catch (err) {
        fail++; lastErr = err.message;
        if (['NO_KEY', 'KEY', 'QUOTA', 'OFFLINE', 'DISABLED'].includes(err.code)) break; // 더 시도해도 실패할 오류
      }
    }
    await ctx.touch();
    ctx.toast(`성공 ${ok}명${fail ? `, 실패 ${fail}명 (${lastErr})` : ''}`, fail ? 'error' : 'info');
    ctx.refresh();
  };
  el.querySelector('#geo-missing')?.addEventListener('click', (e) => regeo(missing, e.currentTarget));
  el.querySelector('#geo-all')?.addEventListener('click', (e) => {
    const list = children.filter((c) => c.geoStatus !== 'manual' && c.geoStatus !== 'sample');
    if (!list.length) { ctx.toast('다시 받을 원아가 없습니다(직접 입력·샘플 좌표 제외)'); return; }
    if (confirm(`${list.length}명의 좌표를 카카오에서 다시 받을까요?`)) regeo(list, e.currentTarget);
  });
}
