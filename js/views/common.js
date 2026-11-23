// 여러 화면이 같이 쓰는 조각: 호차·등하원 선택, 정류장 표시
import { esc } from '../util.js';
import { SHIFT_LABEL } from '../model.js';

export function pickSel(settings, shared) {
  const n = Math.min(3, Math.max(1, Number(settings.vehicleCount) || 1));
  const vehicle = Math.min(n, Math.max(1, Number(shared.vehicle) || 1));
  const shift = shared.shift === 'am' || shared.shift === 'pm' ? shared.shift : (new Date().getHours() < 12 ? 'am' : 'pm');
  shared.vehicle = vehicle;
  shared.shift = shift;
  return { vehicle, shift, count: n };
}

export function selectorHtml(sel) {
  const vs = [];
  for (let v = 1; v <= sel.count; v++) {
    vs.push(`<button class="chip ${v === sel.vehicle ? 'on' : ''}" data-vehicle="${v}" aria-pressed="${v === sel.vehicle}">${v}호차</button>`);
  }
  return `<div class="selector">
    <div class="seg small-seg">${['am', 'pm'].map((s) => `<button class="${s === sel.shift ? 'on' : ''}" data-shift="${s}" aria-pressed="${s === sel.shift}">${SHIFT_LABEL[s]}</button>`).join('')}</div>
    <div class="chips">${vs.join('')}</div></div>`;
}

export function bindSelector(el, shared, onChange) {
  el.querySelectorAll('[data-vehicle]').forEach((b) => b.addEventListener('click', () => { if (onChange(() => { shared.vehicle = +b.dataset.vehicle; }) === false) return; }));
  el.querySelectorAll('[data-shift]').forEach((b) => b.addEventListener('click', () => { if (onChange(() => { shared.shift = b.dataset.shift; }) === false) return; }));
}

export function minLabel(m) {
  const v = Math.round(m);
  return `${v}분`;
}

export function kmLabel(m) {
  return `${(m / 1000).toFixed(1)}km`;
}

export function riderNames(stop) {
  return esc((stop.riders || []).map((r) => r.name).join(', '));
}
