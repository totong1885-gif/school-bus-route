// 오늘 운행: 호차·등하원 선택 → 타는 아이 체크(기본 전부) → 자동 경로 → 한 곳씩 길안내 → 완료 체크
// 체크 해제·오늘만 바꾼 순서·완료는 오늘 날짜에만 적용(다음 날 자동 복귀).
// 계산 결과는 좌표 없이 스냅샷으로 저장 → 오프라인이면 마지막 순서와 주소 글자만 보여 준다.
import { esc, localDate } from '../util.js';
import { courseId, ridersFor, fmtHHMM, snapshotOf, DAY_NAMES, SHIFT_LABEL } from '../model.js';
import { NAV_APPS } from '../navlink.js';
import { pickSel, selectorHtml, bindSelector, minLabel, riderNames } from './common.js';
import { copyToClipboard } from '../util.js';

let previewDow = 1; // 주말에 미리 볼 요일

export async function render(el, ctx) {
  const { db } = ctx;
  const [settings, children, courses, saved] = await Promise.all([
    ctx.settings(), db.getAll('children'), db.getAll('courses'), db.get('kv', 'today'),
  ]);
  const date = localDate();
  const state = saved && saved.date === date
    ? saved
    : { id: 'today', date, courses: {}, snaps: saved?.snaps || {} };
  const realDow = new Date().getDay();
  const weekend = realDow === 0 || realDow === 6;
  const dow = weekend ? previewDow : realDow;
  const sel = pickSel(settings, ctx.shared);
  const cid = courseId(sel.vehicle, sel.shift);
  const cs = state.courses[cid] || (state.courses[cid] = { unchecked: [], manual: null, done: [] });
  const riders = ridersFor(children, sel.vehicle, sel.shift, dow);
  const save = () => db.put('kv', state).catch((e) => { console.error(e); ctx.toast('저장하지 못했습니다', 'error'); });

  if (!children.length) {
    el.innerHTML = `<div class="card empty"><h2>등록된 아이가 없습니다</h2>
      <p>설정에서 어린이집 주소를 넣고, 명단에서 아이를 등록하세요.</p>
      <button class="btn primary big" data-go="roster">명단으로</button>
      <button class="btn" data-go="settings">설정 (샘플 데이터로 시험)</button></div>`;
    el.querySelectorAll('[data-go]').forEach((b) => b.addEventListener('click', () => ctx.go(b.dataset.go)));
    return;
  }

  const checklist = riders.map((r) => {
    const on = !cs.unchecked.includes(r.id);
    return `<label class="ride ${on ? 'on' : 'off'}"><input type="checkbox" data-ride="${esc(r.id)}" ${on ? 'checked' : ''}>
      <span class="box" aria-hidden="true">${on ? '☑' : '☐'}</span>
      <span class="who"><b>${esc(r.name)}</b><small>${on ? '' : '오늘 안 탐 · '}${r.moved ? `<span class="red">오늘만 ${sel.vehicle}호차</span> · ` : ''}${r.desired ? `희망 ${esc(r.desired)} · ` : ''}${esc(r.address)}</small></span></label>`;
  }).join('');

  el.innerHTML = `
    ${weekend ? `<div class="card warn">오늘(${DAY_NAMES[realDow]})은 운행하지 않습니다. 미리 보기 요일:
      <div class="chips">${[1, 2, 3, 4, 5].map((d) => `<button class="chip ${d === dow ? 'on' : ''}" data-dow="${d}">${DAY_NAMES[d]}</button>`).join('')}</div></div>` : ''}
    ${selectorHtml(sel)}
    <div id="route"><div class="card loading">경로 계산 중… (주소 위치 찾는 중)</div></div>
    <section class="card">
      <h3>${SHIFT_LABEL[sel.shift]} 타는 아이 <small>체크를 풀면 오늘만 경로에서 빠집니다</small></h3>
      ${riders.length ? `<div class="rides">${checklist}</div>` : `<p class="muted">${DAY_NAMES[dow]}요일 ${sel.vehicle}호차 ${SHIFT_LABEL[sel.shift]}에 타는 아이가 없습니다.</p>`}
    </section>`;

  el.querySelectorAll('[data-dow]').forEach((b) => b.addEventListener('click', () => { previewDow = +b.dataset.dow; ctx.refresh(); }));
  bindSelector(el, ctx.shared, (apply) => { apply(); ctx.refresh(); });
  el.querySelectorAll('[data-ride]').forEach((b) => b.addEventListener('change', async () => {
    const id = b.dataset.ride;
    cs.unchecked = b.checked ? cs.unchecked.filter((x) => x !== id) : [...cs.unchecked, id];
    await save();
    ctx.refresh();
  }));

  if (!riders.length) { el.querySelector('#route').innerHTML = ''; await save(); return; }

  // ---- 경로 계산 ----
  const savedOrder = courses.find((c) => c.id === cid)?.order || null;
  const course = await ctx.compute({ settings, children, vehicle: sel.vehicle, shift: sel.shift, dow, unchecked: cs.unchecked, savedOrder, manualOrder: cs.manual });
  let view;
  if (course.ok) {
    state.snaps[cid] = snapshotOf(course, { date, dow });
    view = {
      live: true,
      label: course.label,
      depart: course.depart,
      end: course.mine.end,
      maxLate: course.mine.maxLate,
      start: course.start,
      stops: course.mine.stops.map((s, i) => ({ ...s, ...course.mine.rows[i], legMin: course.mine.rows[i].travel })),
      failed: course.failed,
      geoError: course.geoError,
      providerError: course.providerError,
      hasManual: course.hasManual,
      hasSaved: course.hasSaved,
    };
  } else {
    const snap = state.snaps[cid];
    if (snap) {
      const unchecked = new Set(cs.unchecked);
      view = {
        live: false,
        reason: course.message,
        snapDate: snap.date,
        label: snap.label,
        depart: snap.depart,
        end: snap.end,
        stops: snap.stops
          .map((s) => ({ ...s, riders: s.riders.filter((r) => !unchecked.has(r.id)) }))
          .filter((s) => s.riders.length),
      };
      if (cs.manual) {
        const pos = (s) => { const i = s.keys.findIndex((k) => cs.manual.includes(k)); return i < 0 ? 1e9 : cs.manual.indexOf(s.keys[i]); };
        view.stops.sort((a, b) => pos(a) - pos(b));
      }
    }
  }
  await save();

  const route = el.querySelector('#route');
  if (!view) {
    route.innerHTML = `<div class="card warn"><h3>경로를 계산하지 못했습니다</h3><p>${esc(course.message || '')}</p>
      ${course.reason === 'NO_DAYCARE' || course.reason === 'GEO' ? '<button class="btn primary" data-go="settings">설정 확인</button>' : ''}</div>`;
    route.querySelectorAll('[data-go]').forEach((b) => b.addEventListener('click', () => ctx.go(b.dataset.go)));
    return;
  }

  const done = new Set(cs.done);
  const stops = view.stops;
  const next = stops.find((s) => !done.has(s.key));
  const primary = settings.naviApp === 'tmap' && !settings.showTmap ? 'naver' : settings.naviApp;
  const secondary = primary === 'naver' ? 'kakaomap' : 'naver';
  const doneCount = stops.filter((s) => done.has(s.key)).length;

  const nextCard = next ? `
    <section class="next card">
      <div class="next-label">다음 정류장 · ${doneCount + 1}/${stops.length}</div>
      <div class="next-name">${riderNames(next)}</div>
      <div class="next-addr">${esc(next.address)}</div>
      <div class="next-eta">예상 ${fmtHHMM(next.time)}${next.wait >= 1 ? ` <span class="badge">${minLabel(next.wait)} 대기</span>` : ''}${next.late ? ` <span class="badge red-bg">${minLabel(next.late)} 늦음</span>` : ''}</div>
      ${view.live ? `
        <button class="btn huge go" data-nav="${esc(next.key)}" data-app="${primary}">▶ 다음 정류장 길안내<small>${esc(NAV_APPS[primary].label)}</small></button>
        <button class="btn" data-nav="${esc(next.key)}" data-app="${secondary}">${esc(NAV_APPS[secondary].label)} 열기</button>`
      : `<p class="warn-text">위치 정보가 없어 길안내를 열 수 없습니다. 인터넷 연결과 설정을 확인하거나 주소를 복사해 쓰세요.</p>
        <button class="btn" data-copy="${esc(next.address)}">주소 복사</button>`}
      <button class="btn big ok" data-done="${esc(next.key)}">✓ 도착 완료</button>
    </section>` : `
    <section class="next card">
      <div class="next-label">모든 정류장 완료 (${stops.length}곳)</div>
      <div class="next-name">어린이집으로 복귀</div>
      <div class="next-eta">예상 도착 ${fmtHHMM(view.end)}</div>
      ${view.live ? `<button class="btn huge go" data-nav="__end" data-app="${primary}">▶ 어린이집 길안내<small>${esc(NAV_APPS[primary].label)}</small></button>` : ''}
    </section>`;

  const rows = stops.map((s, i) => `
    <li class="stop ${done.has(s.key) ? 'done' : ''} ${next && s.key === next.key ? 'current' : ''}">
      <span class="time">${fmtHHMM(s.time)}</span>
      <span class="who"><b>${i + 1}. ${riderNames(s)}</b><small>${esc(s.address)}</small>
        ${s.wait >= 1 ? `<em>${minLabel(s.wait)} 대기 (희망 시각 맞춤)</em>` : ''}${s.late ? `<em class="red">희망 시각보다 ${minLabel(s.late)} 늦음</em>` : ''}</span>
      <span class="updown">
        <button class="btn sq" data-up="${i}" ${i === 0 ? 'disabled' : ''} aria-label="위로">▲</button>
        <button class="btn sq" data-down="${i}" ${i === stops.length - 1 ? 'disabled' : ''} aria-label="아래로">▼</button>
      </span>
      <button class="btn check" data-toggle="${esc(s.key)}" aria-label="${done.has(s.key) ? '완료 취소' : '완료'}">${done.has(s.key) ? '✓' : '○'}</button>
    </li>`).join('');

  route.innerHTML = `
    ${!view.live ? `<div class="card warn"><b>${esc(view.snapDate || '')} 마지막으로 계산한 경로를 보여 줍니다.</b><br>${esc(view.reason || '')}<br><small>체크를 바꾸면 해당 정류장만 빠지고, 시각은 다시 계산되지 않습니다.</small></div>` : ''}
    ${view.maxLate ? `<div class="card danger-card">⚠ 희망 시각보다 최대 ${minLabel(view.maxLate)} 늦습니다. <b>출발을 ${Math.ceil(view.maxLate)}분 앞당기세요.</b></div>` : ''}
    ${view.failed?.length ? `<div class="card warn">위치를 찾지 못해 빠진 정류장: <b>${esc(view.failed.map((s) => s.riders.map((r) => r.name).join(', ')).join(' / '))}</b><br><small>${esc(view.geoError?.message || '명단에서 주소를 확인하세요')}</small></div>` : ''}
    ${nextCard}
    <section class="card">
      <h3>경로 <small>어린이집 ${fmtHHMM(view.depart)} 출발 → ${fmtHHMM(view.end)} 도착 · ${esc(view.label || '')}${view.live ? (view.hasManual ? ' · 오늘만 바꾼 순서' : view.hasSaved ? ' · 내 코스' : ' · 추천 순서') : ''}</small></h3>
      ${view.providerError ? `<p class="small warn-text">도로 시간을 받지 못해 직선거리로 계산했습니다 (${esc(view.providerError.message)})</p>` : ''}
      <ol class="stops">${rows}</ol>
      <div class="actions">
        ${cs.manual ? '<button class="btn" id="reset-order">오늘 순서 원래대로</button>' : ''}
        ${cs.done.length ? '<button class="btn" id="reset-done">완료 체크 지우기</button>' : ''}
      </div>
    </section>`;

  const keys = stops.map((s) => s.key);
  const move = async (i, d) => {
    const j = i + d;
    if (j < 0 || j >= keys.length) return;
    [keys[i], keys[j]] = [keys[j], keys[i]];
    // 오프라인 스냅샷에서 바꾼 순서도 기억(키 기준)
    cs.manual = keys.slice();
    await save();
    ctx.refresh();
  };
  route.querySelectorAll('[data-up]').forEach((b) => b.addEventListener('click', () => move(+b.dataset.up, -1)));
  route.querySelectorAll('[data-down]').forEach((b) => b.addEventListener('click', () => move(+b.dataset.down, 1)));
  route.querySelectorAll('[data-nav]').forEach((b) => b.addEventListener('click', () => {
    const key = b.dataset.nav;
    const dest = key === '__end'
      ? { name: view.start?.name, lat: view.start?.lat, lng: view.start?.lng }
      : (() => { const s = stops.find((x) => x.key === key); return { name: s.riders.map((r) => r.name).join(', '), lat: s.lat, lng: s.lng }; })();
    ctx.navigate(b.dataset.app, dest, settings);
  }));
  route.querySelectorAll('[data-copy]').forEach((b) => b.addEventListener('click', async () => {
    ctx.toast((await copyToClipboard(b.dataset.copy)) ? '주소를 복사했습니다' : '복사하지 못했습니다', 'info');
  }));
  route.querySelectorAll('[data-done]').forEach((b) => b.addEventListener('click', async () => {
    if (!cs.done.includes(b.dataset.done)) cs.done.push(b.dataset.done);
    await save();
    ctx.refresh();
    window.scrollTo(0, 0);
  }));
  route.querySelectorAll('[data-toggle]').forEach((b) => b.addEventListener('click', async () => {
    const k = b.dataset.toggle;
    cs.done = cs.done.includes(k) ? cs.done.filter((x) => x !== k) : [...cs.done, k];
    await save();
    ctx.refresh();
  }));
  route.querySelector('#reset-order')?.addEventListener('click', async () => { cs.manual = null; await save(); ctx.refresh(); });
  route.querySelector('#reset-done')?.addEventListener('click', async () => {
    if (!confirm('오늘 완료 체크를 모두 지울까요?')) return;
    cs.done = []; await save(); ctx.refresh();
  });
}
