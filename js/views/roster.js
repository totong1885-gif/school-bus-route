// 명단: 아이 등록·수정·삭제, 같은 정류장끼리 묶어 보기, 등원만/하원만 필터, 요일별 예외
import { esc } from '../util.js';
import { newId } from '../db.js';
import { WEEKDAYS, DAY_NAMES, rideType, stopAddressOf, normalizeKey, parseHHMM } from '../model.js';
import { geocode } from '../geocode.js';

let editingId = null; // null | 'new' | id
let filter = 'all';

const FILTERS = { all: '전체', am: '등원만', pm: '하원만', both: '등·하원', none: '안 탐' };
const TYPE_BADGE = { am: '등원만', pm: '하원만', none: '안 탐' };

function vehicleOptions(n, value, { allowDefault = false } = {}) {
  const opts = [];
  if (allowDefault) opts.push(`<option value="" ${value === '' || value === null || value === undefined ? 'selected' : ''}>기본대로</option>`);
  opts.push(`<option value="0" ${String(value) === '0' ? 'selected' : ''}>안 탐</option>`);
  for (let v = 1; v <= n; v++) opts.push(`<option value="${v}" ${String(value) === String(v) ? 'selected' : ''}>${v}호차</option>`);
  return opts.join('');
}

function formHtml(c, n) {
  const ex = c.exceptions || {};
  const exRows = WEEKDAYS.map((d) => `
    <tr><th>${DAY_NAMES[d]}</th>
      ${['am', 'pm'].map((s) => {
        const e = ex[`${d}-${s}`] || {};
        return `<td><select name="ex-${d}-${s}-v" aria-label="${DAY_NAMES[d]} ${s === 'am' ? '등원' : '하원'} 호차">${vehicleOptions(n, e.vehicle ?? '', { allowDefault: true })}</select>
          <input type="time" name="ex-${d}-${s}-t" value="${esc(e.time || '')}" aria-label="${DAY_NAMES[d]} ${s === 'am' ? '등원' : '하원'} 그날만 희망 시각"></td>`;
      }).join('')}
    </tr>`).join('');
  return `
    <form class="card form" id="kid-form">
      <h3>${c.id ? '아이 정보 수정' : '아이 등록'}</h3>
      <label>이름<input name="name" required value="${esc(c.name || '')}" autocomplete="off"></label>
      <label>집 주소 <small>도로명 주소 권장. 저장하면 위치를 확인합니다</small><input name="address" required value="${esc(c.address || '')}" autocomplete="off"></label>
      <label>같이 타는 지점 (선택) <small>집 앞이 아닌 곳(아파트 정문 등)에서 탈 때 그 주소</small><input name="pickup" value="${esc(c.pickup || '')}" autocomplete="off"></label>
      <button class="btn" type="button" id="check-addr">주소 확인</button> <span id="addr-result" class="small"></span>
      <div class="two">
        <label>등원 차량<select name="am-v">${vehicleOptions(n, c.am?.vehicle ?? 1)}</select></label>
        <label>등원 희망 시각 <small>집 앞 탑승</small><input type="time" name="am-t" value="${esc(c.am?.desired || '')}"></label>
        <label>하원 차량<select name="pm-v">${vehicleOptions(n, c.pm?.vehicle ?? 1)}</select></label>
        <label>하원 희망 시각 <small>집 앞 하차</small><input type="time" name="pm-t" value="${esc(c.pm?.desired || '')}"></label>
      </div>
      <details ${Object.keys(ex).length ? 'open' : ''}><summary>요일별 예외 (그날만 안 탐 / 다른 호차 / 희망 시각)</summary>
        <table class="ex-table"><thead><tr><th></th><th>등원</th><th>하원</th></tr></thead><tbody>${exRows}</tbody></table>
      </details>
      <div class="actions">
        <button class="btn primary big" type="submit">저장</button>
        <button class="btn" type="button" id="cancel">취소</button>
        ${c.id ? '<button class="btn danger" type="button" id="delete">삭제</button>' : ''}
      </div>
    </form>`;
}

function readForm(form, base) {
  const f = new FormData(form);
  const exceptions = {};
  for (const d of WEEKDAYS) {
    for (const s of ['am', 'pm']) {
      const v = String(f.get(`ex-${d}-${s}-v`) ?? '');
      const t = String(f.get(`ex-${d}-${s}-t`) ?? '');
      const e = {};
      if (v !== '') e.vehicle = Number(v);
      if (parseHHMM(t) !== null) e.time = t;
      if (Object.keys(e).length) exceptions[`${d}-${s}`] = { vehicle: e.vehicle ?? null, time: e.time || '' };
    }
  }
  return {
    ...base,
    id: base.id || newId('c'),
    name: String(f.get('name') || '').trim(),
    address: String(f.get('address') || '').replace(/\s+/g, ' ').trim(),
    pickup: String(f.get('pickup') || '').replace(/\s+/g, ' ').trim(),
    am: { vehicle: Number(f.get('am-v')) || 0, desired: parseHHMM(f.get('am-t')) !== null ? String(f.get('am-t')) : '' },
    pm: { vehicle: Number(f.get('pm-v')) || 0, desired: parseHHMM(f.get('pm-t')) !== null ? String(f.get('pm-t')) : '' },
    exceptions,
    updatedAt: Date.now(),
  };
}

function rideText(c) {
  const p = [];
  if (c.am?.vehicle > 0) p.push(`등원 ${c.am.vehicle}호차${c.am.desired ? ' ' + c.am.desired : ''}`);
  if (c.pm?.vehicle > 0) p.push(`하원 ${c.pm.vehicle}호차${c.pm.desired ? ' ' + c.pm.desired : ''}`);
  const exCount = Object.keys(c.exceptions || {}).length;
  if (exCount) p.push(`<span class="red">예외 ${exCount}</span>`);
  return p.join(' · ');
}

export async function render(el, ctx) {
  const { db } = ctx;
  const [settings, children] = await Promise.all([ctx.settings(), db.getAll('children')]);
  const n = Math.min(3, Math.max(1, Number(settings.vehicleCount) || 1));
  children.sort((a, b) => a.name.localeCompare(b.name, 'ko'));
  const editing = editingId === 'new' ? { am: { vehicle: 1 }, pm: { vehicle: 1 } } : children.find((c) => c.id === editingId);

  const shown = children.filter((c) => filter === 'all' || rideType(c) === filter);
  const groups = new Map();
  for (const c of shown) {
    const addr = stopAddressOf(c);
    const k = normalizeKey(addr);
    if (!groups.has(k)) groups.set(k, { address: addr, kids: [] });
    groups.get(k).kids.push(c);
  }
  const counts = Object.fromEntries(Object.keys(FILTERS).map((k) => [k, k === 'all' ? children.length : children.filter((c) => rideType(c) === k).length]));

  el.innerHTML = `
    ${editing ? formHtml(editing, n) : '<button class="btn primary big full" id="add">+ 아이 등록</button>'}
    <div class="chips">${Object.entries(FILTERS).map(([k, v]) => `<button class="chip ${filter === k ? 'on' : ''}" data-filter="${k}">${v} <small>${counts[k]}</small></button>`).join('')}</div>
    <h3 class="section-title">정류장 ${groups.size}곳 · 아이 ${shown.length}명</h3>
    ${[...groups.values()].map((g) => `
      <section class="card stop-card">
        <div class="addr">📍 ${esc(g.address)} ${g.kids.length > 1 ? `<span class="badge">${g.kids.length}명 한 정류장</span>` : ''}</div>
        ${g.kids.map((c) => `
          <button class="kid" data-edit="${esc(c.id)}">
            <b>${esc(c.name)}</b> ${TYPE_BADGE[rideType(c)] ? `<span class="badge alt">${TYPE_BADGE[rideType(c)]}</span>` : ''}
            <small>${rideText(c)}${c.pickup ? ` · 집: ${esc(c.address)}` : ''}</small>
          </button>`).join('')}
      </section>`).join('') || '<p class="muted">해당하는 아이가 없습니다.</p>'}
    <p class="small muted">명단은 이 휴대폰에만 저장됩니다. 설정 → "명단 파일 내보내기"로 따로 보관하세요.</p>
  `;

  el.querySelector('#add')?.addEventListener('click', () => { editingId = 'new'; ctx.refresh(); });
  el.querySelectorAll('[data-filter]').forEach((b) => b.addEventListener('click', () => { filter = b.dataset.filter; ctx.refresh(); }));
  el.querySelectorAll('[data-edit]').forEach((b) => b.addEventListener('click', () => { editingId = b.dataset.edit; ctx.refresh(); window.scrollTo(0, 0); }));
  el.querySelector('#cancel')?.addEventListener('click', () => { editingId = null; ctx.refresh(); });

  el.querySelector('#check-addr')?.addEventListener('click', async () => {
    const form = el.querySelector('#kid-form');
    const out = el.querySelector('#addr-result');
    const addrs = [form.address.value, form.pickup.value].map((s) => s.trim()).filter(Boolean);
    out.textContent = '확인 중…';
    const msgs = [];
    for (const a of addrs) {
      try {
        const g = await geocode(a, settings.kakaoRestKey);
        msgs.push(`✓ ${g.roadAddress || a}`);
      } catch (e) {
        msgs.push(`✗ ${e.message}`);
      }
    }
    out.textContent = msgs.join(' / ');
  });

  el.querySelector('#delete')?.addEventListener('click', async () => {
    if (!confirm(`${editing.name} 아이를 명단에서 삭제할까요?`)) return;
    await db.del('children', editing.id);
    editingId = null;
    ctx.toast('삭제했습니다');
    ctx.refresh();
  });

  el.querySelector('#kid-form')?.addEventListener('submit', async (e) => {
    e.preventDefault();
    const c = readForm(e.target, editing);
    if (!c.name || !c.address) { ctx.toast('이름과 주소를 입력하세요', 'error'); return; }
    await db.put('children', c);
    editingId = null;
    ctx.refresh();
    // 저장 후 위치 확인(결과는 저장하지 않음). 실패해도 저장은 유지.
    try {
      await geocode(stopAddressOf(c), settings.kakaoRestKey);
      ctx.toast('저장했습니다');
    } catch (err) {
      ctx.toast(`저장했지만 위치를 확인하지 못했습니다: ${err.message}`, 'error');
    }
  });
}
