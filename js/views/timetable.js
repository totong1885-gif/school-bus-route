// 시간표: 선생님 공유용 한 페이지. 등원(왼쪽)·하원(오른쪽), 호차별 칸. 월~금 기본 배정 기준.
// 요일 예외는 빨간 글씨. 복사(엑셀/카톡)·인쇄(A4 가로).
import { esc, copyToClipboard } from '../util.js';
import { courseId, fmtHHMM, SHIFTS, SHIFT_LABEL, exceptionNotes, movedInNotes } from '../model.js';

async function buildSections(ctx, settings, children, courses) {
  const n = Math.min(3, Math.max(1, Number(settings.vehicleCount) || 1));
  const byId = new Map(children.map((c) => [c.id, c]));
  const sections = {};
  let failMsg = '';
  for (const shift of SHIFTS) {
    for (let v = 1; v <= n; v++) {
      const cid = courseId(v, shift);
      const saved = courses.find((c) => c.id === cid)?.order || null;
      const course = await ctx.compute({ settings, children, vehicle: v, shift, dow: null, savedOrder: saved });
      if (!course.ok) { failMsg = course.message; sections[cid] = null; continue; }
      sections[cid] = {
        vehicle: v,
        shift,
        depart: course.depart,
        end: course.mine.end,
        stops: course.mine.stops.map((s, i) => ({
          names: s.riders.map((r) => ({ name: r.name, notes: exceptionNotes(byId.get(r.id), shift) })),
          time: course.mine.rows[i].time,
          late: course.mine.rows[i].late,
        })),
        failed: course.failed.map((s) => s.riders.map((r) => r.name).join(', ')),
        movedIn: movedInNotes(children, v, shift),
        mine: course.hasSaved,
      };
      if (course.failed.length && !failMsg) failMsg = course.geoError?.message || '';
    }
  }
  return { sections, failMsg, n };
}

const nameHtml = (s) => s.names.map((x) => `${esc(x.name)}${x.notes.length ? ` <span class="red">(${esc(x.notes.join(', '))})</span>` : ''}`).join(', ');
const nameText = (s) => s.names.map((x) => `${x.name}${x.notes.length ? `(${x.notes.join(', ')})` : ''}`).join(', ');

function tableHtml(shift, data, n) {
  let rows = '';
  for (let v = 1; v <= n; v++) {
    const sec = data.sections[courseId(v, shift)];
    if (!sec) { rows += `<tr><th>${v}호차</th><td colspan="2" class="muted">계산할 수 없음</td></tr>`; continue; }
    const extra = [...sec.movedIn.map((t) => `<span class="red">${esc(t)}</span>`), ...sec.failed.map((t) => `<span class="red">위치 못 찾음: ${esc(t)}</span>`)];
    const span = Math.max(1, sec.stops.length) + 1 + (extra.length ? 1 : 0);
    if (!sec.stops.length) {
      rows += `<tr class="vstart"><th rowspan="${span}">${v}호차<br><small>${fmtHHMM(sec.depart)} 출발</small></th><td colspan="2" class="muted">배정된 아이 없음</td></tr>`;
    } else {
      sec.stops.forEach((s, i) => {
        rows += `<tr class="${i === 0 ? 'vstart' : ''}">${i === 0 ? `<th rowspan="${span}">${v}호차<br><small>${fmtHHMM(sec.depart)} 출발</small>${sec.mine ? '' : '<br><small>(추천 순서)</small>'}</th>` : ''}
          <td>${nameHtml(s)}</td><td class="t ${s.late ? 'red' : ''}">${fmtHHMM(s.time)}</td></tr>`;
      });
    }
    rows += `<tr class="arrive"><td>어린이집 도착</td><td class="t">${fmtHHMM(sec.end)}</td></tr>`;
    if (extra.length) rows += `<tr><td colspan="2" class="small">${extra.join('<br>')}</td></tr>`;
  }
  return `<table class="tt"><caption>${SHIFT_LABEL[shift]}</caption>
    <thead><tr><th>호차</th><th>정류장</th><th>${shift === 'am' ? '탑승' : '하차'}</th></tr></thead><tbody>${rows}</tbody></table>`;
}

/** 엑셀 붙여넣기용: 등원·하원 나란히 6열 */
function excelRows(data, n) {
  const col = (shift) => {
    const out = [];
    for (let v = 1; v <= n; v++) {
      const sec = data.sections[courseId(v, shift)];
      if (!sec) continue;
      sec.stops.forEach((s, i) => out.push([i === 0 ? `${v}호차 ${fmtHHMM(sec.depart)} 출발` : '', nameText(s), fmtHHMM(s.time)]));
      out.push(['', '어린이집 도착', fmtHHMM(sec.end)]);
      sec.movedIn.forEach((t) => out.push(['', t, '']));
    }
    return out;
  };
  const a = col('am');
  const p = col('pm');
  const rows = [['등원', '', '', '하원', '', ''], ['호차', '정류장', '탑승', '호차', '정류장', '하차']];
  for (let i = 0; i < Math.max(a.length, p.length); i++) rows.push([...(a[i] || ['', '', '']), ...(p[i] || ['', '', ''])]);
  return rows;
}

function kakaoText(data, n, title) {
  const lines = [title];
  for (const shift of SHIFTS) {
    lines.push('', `[${SHIFT_LABEL[shift]}]`);
    for (let v = 1; v <= n; v++) {
      const sec = data.sections[courseId(v, shift)];
      if (!sec) continue;
      lines.push(`■ ${v}호차 ${fmtHHMM(sec.depart)} 출발`);
      sec.stops.forEach((s) => lines.push(`  ${fmtHHMM(s.time)} ${nameText(s)}`));
      lines.push(`  ${fmtHHMM(sec.end)} 어린이집 도착`);
      sec.movedIn.forEach((t) => lines.push(`  * ${t}`));
    }
  }
  return lines.join('\n');
}

export async function render(el, ctx) {
  const { db } = ctx;
  const [settings, children, courses, snap] = await Promise.all([ctx.settings(), db.getAll('children'), db.getAll('courses'), db.get('kv', 'timetable')]);
  if (!children.length) {
    el.innerHTML = '<div class="card empty">명단에 아이를 등록하면 시간표가 만들어집니다.</div>';
    return;
  }
  el.innerHTML = '<div class="card loading">시간표 계산 중…</div>';
  let data = await buildSections(ctx, settings, children, courses);
  const freshFail = data.failMsg;
  const allFailed = Object.values(data.sections).every((s) => s === null);
  let offline = false;
  if (allFailed && snap) { data = snap.data; offline = true; } else if (!allFailed) {
    db.put('kv', { id: 'timetable', builtAt: Date.now(), data }).catch(() => {});
  }
  const n = data.n;
  const title = `${settings.daycare.name || '어린이집'} 등·하원 차량 시간표 (월~금 기본)`;

  el.innerHTML = `
    <div class="no-print actions">
      <button class="btn" id="copy-excel">📋 엑셀용 복사</button>
      <button class="btn" id="copy-kakao">💬 카톡용 복사</button>
      <button class="btn" id="print">🖨 인쇄 (A4 가로)</button>
    </div>
    ${offline ? `<div class="card warn no-print">지금은 계산할 수 없어 ${new Date(snap.builtAt).toLocaleString('ko-KR')}에 만든 시간표를 보여 줍니다. (${esc(freshFail || '')})</div>` : ''}
    ${!offline && data.failMsg ? `<div class="card warn no-print">${esc(data.failMsg)}</div>` : ''}
    ${allFailed && !snap ? `<div class="card warn">시간표를 계산하지 못했습니다. 인터넷 연결과 설정을 확인하세요.</div>` : `
    <div class="sheet">
      <h2 class="sheet-title">${esc(title)}</h2>
      <div class="tt-wrap">${tableHtml('am', data, n)}${tableHtml('pm', data, n)}</div>
      <p class="small muted">빨간 글씨 = 요일별 예외 (✗ 그날 안 탐 · N호차 = 그날만 다른 호차 · 시각 = 그날만 희망 시각)</p>
    </div>
    <div class="no-print actions">
      ${Array.from({ length: n }, (_, i) => i + 1).flatMap((v) => SHIFTS.map((s) => `<button class="btn" data-edit="${v}-${s}">${v}호차 ${SHIFT_LABEL[s]} 순서 수정</button>`)).join('')}
    </div>`}`;

  el.querySelector('#print').addEventListener('click', () => { try { window.print(); } catch { ctx.toast('인쇄를 열 수 없습니다', 'error'); } });
  el.querySelector('#copy-excel').addEventListener('click', async () => {
    const rows = excelRows(data, n);
    const tsv = rows.map((r) => r.join('\t')).join('\n');
    const html = `<table>${rows.map((r) => `<tr>${r.map((c) => `<td>${esc(c)}</td>`).join('')}</tr>`).join('')}</table>`;
    ctx.toast((await copyToClipboard(tsv, html)) ? '복사했습니다. 엑셀에 붙여 넣으세요' : '복사하지 못했습니다', 'info');
  });
  el.querySelector('#copy-kakao').addEventListener('click', async () => {
    ctx.toast((await copyToClipboard(kakaoText(data, n, title))) ? '복사했습니다. 카톡에 붙여 넣으세요' : '복사하지 못했습니다', 'info');
  });
  el.querySelectorAll('[data-edit]').forEach((b) => b.addEventListener('click', () => {
    const [v, s] = b.dataset.edit.split('-');
    ctx.shared.vehicle = +v;
    ctx.shared.shift = s;
    ctx.go('course');
  }));
}

export const _test = { excelRows, kakaoText };
