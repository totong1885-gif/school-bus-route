// 시간표: 선생님 공유용 한 페이지. 등원(왼쪽)·하원(오른쪽), 호차별 칸. 월~금 기본 배정 기준.
// 요일 예외는 빨간 글씨. 복사(엑셀/카톡)·인쇄(A4 가로).
import { esc, copyToClipboard } from '../util.js';
import { courseId, fmtHHMM, SHIFTS, SHIFT_LABEL, exceptionNotes, movedInNotes, applyTtEdits, TT_END } from '../model.js';

let editing = false; // 시간 직접 수정 모드

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
          key: s.key,
          keys: s.keys,
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

// 시각 칸: 평소엔 글자, 수정 모드에선 입력칸. 직접 고친 시각은 파란 글씨 + 계산 시각을 작게
function timeCell(cid, key, time, edited, calc, extraCls = '') {
  if (editing && key) {
    return `<td class="t edit ${extraCls}"><input type="time" class="tt-in ${edited ? 'edited' : ''}" data-cid="${esc(cid)}" data-key="${esc(key)}" value="${fmtHHMM(time)}" aria-label="시각 고치기">${edited ? `<button class="tt-undo" data-undo="${esc(cid)}|${esc(key)}">계산값 ${fmtHHMM(calc)}로</button>` : ''}</td>`;
  }
  return `<td class="t ${extraCls} ${edited ? 'edited' : ''}">${edited ? '✎' : ''}${fmtHHMM(time)}${edited ? `<small class="calc">계산 ${fmtHHMM(calc)}</small>` : ''}</td>`;
}

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
          <td>${nameHtml(s)}</td>${timeCell(courseId(v, shift), s.key, s.time, s.edited, s.calc, s.late ? 'red' : '')}</tr>`;
      });
    }
    rows += `<tr class="arrive"><td>어린이집 도착</td>${timeCell(courseId(v, shift), TT_END, sec.end, sec.endEdited, sec.calcEnd)}</tr>`;
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
  const base = data;
  let tt = (await db.get('kv', 'ttTimes').catch(() => null)) || { id: 'ttTimes', courses: {} };
  if (!tt.courses || typeof tt.courses !== 'object') tt.courses = {};
  const saveTt = () => db.put('kv', tt).catch((e) => { console.error(e); ctx.toast('저장하지 못했습니다', 'error'); });
  const editCount = () => Object.values(tt.courses).reduce((a, m) => a + Object.keys(m || {}).length, 0);

  // 계산은 한 번만 하고, 수정 모드 전환·시각 수정은 화면만 다시 그린다
  const paint = () => {
    data = { ...base, sections: applyTtEdits(base.sections, tt) };
    const cnt = editCount();
    el.innerHTML = `
    <div class="no-print actions">
      <button class="btn" id="copy-excel">📋 엑셀용 복사</button>
      <button class="btn" id="copy-kakao">💬 카톡용 복사</button>
      <button class="btn" id="print">🖨 인쇄 (A4 가로)</button>
    </div>
    ${offline ? `<div class="card warn no-print">지금은 계산할 수 없어 ${new Date(snap.builtAt).toLocaleString('ko-KR')}에 만든 시간표를 보여 줍니다. (${esc(freshFail || '')})</div>` : ''}
    ${!offline && data.failMsg ? `<div class="card warn no-print">${esc(data.failMsg)}</div>` : ''}
    ${allFailed && !snap ? `<div class="card warn">시간표를 계산하지 못했습니다. 인터넷 연결과 설정을 확인하세요.</div>` : `
    <div class="no-print tt-editbar ${editing ? 'on' : ''}">
      <button class="btn ${editing ? 'ok' : 'primary'} full" id="tt-edit">${editing ? '✓ 시간 수정 끝' : '✏️ 시간 직접 수정'}</button>
      ${editing ? '<p class="small">시각 칸을 눌러 바꾸면 바로 저장됩니다. 계산값으로 돌리려면 칸 아래 버튼을 누르세요.</p>' : ''}
      ${cnt ? `<p class="small"><span class="edited-mark">✎ 직접 고친 시간 ${cnt}개</span> ${editing ? '<button class="btn danger" id="tt-reset">모두 계산값으로</button>' : ''}</p>` : ''}
    </div>
    <div class="sheet ${editing ? 'editing' : ''}">
      <h2 class="sheet-title">${esc(title)}</h2>
      <div class="tt-wrap">${tableHtml('am', data, n)}${tableHtml('pm', data, n)}</div>
      <p class="small muted">빨간 글씨 = 요일별 예외 (✗ 그날 안 탐 · N호차 = 그날만 다른 호차 · 시각 = 그날만 희망 시각)${cnt ? ' · <span class="edited-mark">✎ 파란 글씨 = 직접 고친 시간</span> (작은 글씨는 계산한 시간)' : ''}</p>
    </div>
    <div class="no-print actions">
      ${Array.from({ length: n }, (_, i) => i + 1).flatMap((v) => SHIFTS.map((s) => `<button class="btn" data-edit="${v}-${s}">${v}호차 ${SHIFT_LABEL[s]} 순서 수정</button>`)).join('')}
    </div>`}`;
    bind();
  };

  const bind = () => {
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
    el.querySelector('#tt-edit')?.addEventListener('click', () => { editing = !editing; paint(); });
    el.querySelectorAll('.tt-in').forEach((inp) => inp.addEventListener('change', async () => {
      const { cid, key } = inp.dataset;
      const m = tt.courses[cid] || (tt.courses[cid] = {});
      if (inp.value) m[key] = inp.value; else delete m[key];
      await saveTt();
      ctx.toast(inp.value ? `${inp.value}(으)로 고쳤습니다` : '계산값으로 돌렸습니다', 'info');
      paint();
    }));
    el.querySelectorAll('[data-undo]').forEach((b) => b.addEventListener('click', async () => {
      const [cid, key] = b.dataset.undo.split('|');
      if (tt.courses[cid]) delete tt.courses[cid][key];
      await saveTt();
      ctx.toast('계산값으로 돌렸습니다', 'info');
      paint();
    }));
    el.querySelector('#tt-reset')?.addEventListener('click', async () => {
      if (!confirm('직접 고친 시간을 모두 지우고 계산값으로 돌릴까요?')) return;
      tt.courses = {};
      await saveTt();
      paint();
    });
    el.querySelectorAll('[data-edit]').forEach((b) => b.addEventListener('click', () => {
      const [v, s] = b.dataset.edit.split('-');
      ctx.shared.vehicle = +v;
      ctx.shared.shift = s;
      editing = false;
      ctx.go('course');
    }));
  };
  paint();
}

export const _test = { excelRows, kakaoText };
