// 오늘 운행: 호차·등하원 선택 → 타는 아이 체크(기본 전부) → 자동 경로 → 한 곳씩 길안내 → 완료 체크
// 체크 해제·오늘만 바꾼 순서·완료는 오늘 날짜에만 적용(다음 날 자동 복귀).
// 계산 결과는 좌표 없이 스냅샷으로 저장 → 오프라인이면 마지막 순서와 주소 글자만 보여 준다.
import { esc, localDate } from '../util.js';
import { courseId, ridersFor, resolveRide, applyTodayExtras, fmtHHMM, snapshotOf, DAY_NAMES, SHIFT_LABEL, minuteOfDay, compareArrival, elapsedMin, durLabel, ttEditOf, TT_END } from '../model.js';
import { newId } from '../db.js';
import { NAV_APPS, NAVER_MAX_VIA } from '../navlink.js';
import { pickSel, selectorHtml, bindSelector, minLabel, riderNames } from './common.js';
import { copyToClipboard } from '../util.js';

let previewDow = 1; // 주말에 미리 볼 요일
let ridesOpen = false; // 타는 아이 목록: 평소엔 접어 두고, 연 상태는 앱을 쓰는 동안만 유지
let addOpen = false; // '오늘만 아이 추가' 칸 열림
let addMode = 'roster'; // 'roster' 명단에서 고르기 | 'temp' 명단에 없는 아이
let tick = null; // '지금까지 N분' 1분마다 갱신

export async function render(el, ctx) {
  const { db } = ctx;
  const [settings, children, courses, saved, tt] = await Promise.all([
    ctx.settings(), db.getAll('children'), db.getAll('courses'), db.get('kv', 'today'), db.get('kv', 'ttTimes').catch(() => null),
  ]);
  let trip = await db.get('kv', 'trip').catch(() => null);
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
  // 운행 기록(오늘만): 출발 시각, 정류장별 도착 시각, 어린이집 도착 시각 (ms)
  if (!cs.arrived || typeof cs.arrived !== 'object') cs.arrived = {};
  if (tick) { clearInterval(tick); tick = null; }
  // 오늘만 추가한 아이(돌발 상황). 날짜가 바뀌면 state가 새로 만들어져 자동으로 사라진다.
  if (!Array.isArray(state.extras)) state.extras = [];
  const todayKids = applyTodayExtras(children, state.extras, dow);
  const riders = ridersFor(todayKids, sel.vehicle, sel.shift, dow);
  const myExtras = state.extras.filter((x) => x.shift === sel.shift && Number(x.vehicle) === sel.vehicle);
  const extraIdOf = (x) => (x.kind === 'roster' ? x.childId : x.id);
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
    const added = myExtras.some((x) => extraIdOf(x) === r.id);
    const label = `<label class="ride ${on ? 'on' : 'off'} ${added ? 'added' : ''}"><input type="checkbox" data-ride="${esc(r.id)}" ${on ? 'checked' : ''}>
      <span class="box" aria-hidden="true">${on ? '☑' : '☐'}</span>
      <span class="who"><b>${esc(r.name)}${added ? ' <span class="tag">오늘 추가</span>' : ''}</b><small>${on ? '' : '오늘 안 탐 · '}${r.temp ? '<span class="red">명단에 없는 아이</span> · ' : r.moved && !added ? `<span class="red">오늘만 ${sel.vehicle}호차</span> · ` : ''}${r.desired ? `희망 ${esc(r.desired)} · ` : ''}${esc(r.address)}</small></span></label>`;
    return added ? `<div class="ride-row">${label}<button class="btn danger" data-unextra="${esc(r.id)}" aria-label="${esc(r.name)} 추가 취소">빼기</button></div>` : label;
  }).join('');
  // 명단에서 추가할 수 있는 아이: 오늘 이 호차·시간대에 타지 않는 아이
  const candidates = todayKids.filter((c) => !c._temp && !riders.some((r) => r.id === c.id)).map((c) => {
    const rr = resolveRide(c, sel.shift, dow);
    return { c, now: rr.vehicle > 0 ? `오늘 ${rr.vehicle}호차` : `${SHIFT_LABEL[sel.shift]} 안 탐` };
  });
  const addPanel = `<div class="add-box">
    <button class="btn full ${addOpen ? '' : 'primary'}" id="add-toggle" aria-expanded="${addOpen}">${addOpen ? '추가 닫기' : '＋ 오늘만 아이 추가 (돌발 상황)'}</button>
    ${addOpen ? `<div class="add-panel">
      <div class="seg">
        <button class="${addMode === 'roster' ? 'on' : ''}" data-addmode="roster">명단에서 고르기</button>
        <button class="${addMode === 'temp' ? 'on' : ''}" data-addmode="temp">직접 입력</button>
      </div>
      ${addMode === 'roster' ? `
        <p class="small muted">누르면 오늘만 ${sel.vehicle}호차 ${SHIFT_LABEL[sel.shift]}에 넣고 순서를 다시 계산합니다. 다른 호차에 타던 아이는 그 호차에서 빠집니다.</p>
        ${candidates.length ? `<div class="rides">${candidates.map(({ c, now }) => `<button class="ride pick" data-addkid="${esc(c.id)}">
          <span class="box" aria-hidden="true">＋</span><span class="who"><b>${esc(c.name)}</b><small>${esc(now)} · ${esc(c.pickup || c.address || '')}</small></span></button>`).join('')}</div>`
          : '<p class="muted">추가할 수 있는 아이가 없습니다. 명단의 아이가 모두 이미 타고 있습니다.</p>'}`
      : `<form class="form" id="temp-form" autocomplete="off">
        <label>이름<input name="name" required maxlength="20"></label>
        <label>${sel.shift === 'am' ? '타는' : '내리는'} 곳 주소 <small>도로명 주소 권장</small><input name="address" required maxlength="100"></label>
        <label>희망 시각 (선택)<input type="time" name="desired"></label>
        <button class="btn primary full big" type="submit">오늘만 추가</button>
        <p class="small muted">오늘 하루만 쓰고 명단에는 저장하지 않습니다. 계속 타면 명단 탭에서 등록하세요.</p>
      </form>`}
    </div>` : ''}
  </div>`;
  const offRiders = riders.filter((r) => cs.unchecked.includes(r.id));
  const offCount = offRiders.length;
  const offNames = offRiders.map((r) => r.name).join(', ');

  el.innerHTML = `
    ${weekend ? `<div class="card warn">오늘(${DAY_NAMES[realDow]})은 운행하지 않습니다. 미리 보기 요일:
      <div class="chips">${[1, 2, 3, 4, 5].map((d) => `<button class="chip ${d === dow ? 'on' : ''}" data-dow="${d}">${DAY_NAMES[d]}</button>`).join('')}</div></div>` : ''}
    ${selectorHtml(sel)}
    <div id="route"><div class="card loading">경로 계산 중… (주소 위치 찾는 중)</div></div>
    <details class="card fold" id="rides-fold" ${ridesOpen || !riders.length ? 'open' : ''}>
      <summary>
        <span class="fold-title"><b>${SHIFT_LABEL[sel.shift]} 타는 아이</b>
          <small>${riders.length - offCount}명 탐${myExtras.length ? ` · <span class="blue">오늘 추가 ${myExtras.length}명</span>` : ''}${offCount ? ` · <span class="red">안 탐 ${offCount}명: ${esc(offNames)}</span>` : ''}</small></span>
        <span class="fold-btn">${ridesOpen || !riders.length ? '접기 ▲' : '펼치기 ▼'}</span>
      </summary>
      ${riders.length ? `<p class="small muted">체크를 풀면 오늘만 경로에서 빠집니다</p>
      <div class="rides">${checklist}</div>` : `<p class="muted">${DAY_NAMES[dow]}요일 ${sel.vehicle}호차 ${SHIFT_LABEL[sel.shift]}에 타는 아이가 없습니다.</p>`}
      ${addPanel}
    </details>`;

  el.querySelectorAll('[data-dow]').forEach((b) => b.addEventListener('click', () => { previewDow = +b.dataset.dow; ctx.refresh(); }));
  bindSelector(el, ctx.shared, (apply) => { apply(); ctx.refresh(); });
  const fold = el.querySelector('#rides-fold');
  fold?.addEventListener('toggle', () => {
    ridesOpen = fold.open;
    const b = fold.querySelector('.fold-btn');
    if (b) b.textContent = ridesOpen ? '접기 ▲' : '펼치기 ▼';
  });
  // ---- 오늘만 추가 ----
  const addExtra = async (x, name) => {
    state.extras = [...state.extras.filter((e) => !(extraIdOf(e) === extraIdOf(x) && e.shift === x.shift)), x];
    cs.unchecked = cs.unchecked.filter((id) => id !== extraIdOf(x));
    ridesOpen = true;
    await save();
    ctx.toast(`${name}: 오늘만 ${sel.vehicle}호차 ${SHIFT_LABEL[sel.shift]}에 추가했습니다`, 'info');
    ctx.refresh();
  };
  el.querySelector('#add-toggle')?.addEventListener('click', (e) => { e.preventDefault(); addOpen = !addOpen; ridesOpen = true; ctx.refresh(); });
  el.querySelectorAll('[data-addmode]').forEach((b) => b.addEventListener('click', (e) => { e.preventDefault(); addMode = b.dataset.addmode; ctx.refresh(); }));
  el.querySelectorAll('[data-addkid]').forEach((b) => b.addEventListener('click', (e) => {
    e.preventDefault();
    const c = children.find((k) => k.id === b.dataset.addkid);
    if (!c) return;
    addOpen = false;
    addExtra({ kind: 'roster', childId: c.id, vehicle: sel.vehicle, shift: sel.shift }, c.name);
  }));
  el.querySelector('#temp-form')?.addEventListener('submit', (e) => {
    e.preventDefault();
    const f = new FormData(e.target);
    const name = String(f.get('name') || '').trim();
    const address = String(f.get('address') || '').trim();
    if (!name || !address) { ctx.toast('이름과 주소를 넣어 주세요', 'error'); return; }
    addOpen = false;
    addExtra({ kind: 'temp', id: newId('tmp'), name, address, desired: String(f.get('desired') || ''), vehicle: sel.vehicle, shift: sel.shift }, name);
  });
  el.querySelectorAll('[data-unextra]').forEach((b) => b.addEventListener('click', async (e) => {
    e.preventDefault();
    const id = b.dataset.unextra;
    state.extras = state.extras.filter((x) => !(extraIdOf(x) === id && x.shift === sel.shift));
    cs.unchecked = cs.unchecked.filter((x) => x !== id);
    await save();
    ctx.toast('추가를 취소했습니다', 'info');
    ctx.refresh();
  }));

  el.querySelectorAll('[data-ride]').forEach((b) => b.addEventListener('change', async () => {
    const id = b.dataset.ride;
    cs.unchecked = b.checked ? cs.unchecked.filter((x) => x !== id) : [...cs.unchecked, id];
    await save();
    ctx.refresh();
  }));

  if (!riders.length) { el.querySelector('#route').innerHTML = ''; await save(); return; }

  // ---- 경로 계산 ----
  const savedOrder = courses.find((c) => c.id === cid)?.order || null;
  const course = await ctx.compute({ settings, children: todayKids, vehicle: sel.vehicle, shift: sel.shift, dow, unchecked: cs.unchecked, savedOrder, manualOrder: cs.manual });
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
  // 네이버지도 경유지 길안내: 남은 정류장 순서대로 + 마지막 어린이집. 한 번에 최대 6곳(경유 5 + 목적지 1)
  const stopName = (s) => s.riders.map((r) => r.name).join(', ');
  const viaPts = view.live ? [
    ...stops.filter((s) => !done.has(s.key)).map((s) => ({ key: s.key, name: stopName(s), short: s.riders[0]?.name || '정류장', lat: s.lat, lng: s.lng })),
    ...(view.start ? [{ key: '__end', name: view.start.name || '어린이집', short: '어린이집', lat: view.start.lat, lng: view.start.lng }] : []),
  ].filter((p) => Number.isFinite(Number(p.lat)) && Number.isFinite(Number(p.lng))) : [];

  // ---- 운행 기록 ----
  const hhmm = (ms) => fmtHHMM(minuteOfDay(ms));
  // 예정 시각: 시간표에서 직접 고친 시각이 있으면 그것, 없으면 계산 시각
  const planOf = (s) => ttEditOf(tt, cid, s.keys || s.key) ?? s.time;
  const planEnd = ttEditOf(tt, cid, TT_END) ?? view.end;
  const plannedStartMs = (() => { const d = new Date(); d.setHours(0, Math.round(view.depart), 0, 0); return d.getTime(); })();
  const baseMs = cs.startedAt || plannedStartMs; // 출발을 기록하지 않았으면 예정 출발 시각 기준
  const startCmp = cs.startedAt ? compareArrival(cs.startedAt, view.depart) : null;
  const tripBar = cs.endAt
    ? `<div class="trip"><span>🏁 <b>운행 끝</b> · ${hhmm(baseMs)} 출발 → ${hhmm(cs.endAt)} 어린이집 도착</span><span>총 <b>${durLabel(elapsedMin(baseMs, cs.endAt))}</b> 걸림 <small>(예정 ${durLabel(view.end - view.depart)})</small></span></div>`
    : cs.startedAt
      ? `<div class="trip"><span>🚐 <b>${hhmm(cs.startedAt)} 출발</b>${startCmp && startCmp.diff ? ` <small class="${startCmp.cls}">(${startCmp.text})</small>` : ''}</span><span>출발 후 지금까지 <b id="elapsed">${durLabel(elapsedMin(cs.startedAt, Date.now()))}</b></span></div>`
      : `<div class="trip">출발 전 · 예정 ${fmtHHMM(view.depart)} 출발 <button class="btn" id="start-now">지금 출발</button></div>`;
  const recLine = (s) => {
    const at = cs.arrived[s.key];
    if (!done.has(s.key) || !at) return '';
    const c = compareArrival(at, planOf(s));
    return `<div class="rec"><span>예정 ${fmtHHMM(planOf(s))} → <b>도착 ${hhmm(at)}</b></span><span>출발 후 <b>${durLabel(elapsedMin(baseMs, at))}</b></span>${c ? `<span class="${c.cls}">${c.text}</span>` : ''}</div>`;
  };

  // ---- 운행 알림 (내비를 보는 동안 휴대폰 알림으로 다음 아이·도착 완료) ----
  const canNotify = 'Notification' in window && 'serviceWorker' in navigator;
  const notifyOn = canNotify && !!trip?.on && trip.cid === cid && trip.date === date && Notification.permission === 'granted';
  const tripData = () => ({
    id: 'trip', on: true, date, cid,
    title: `${sel.vehicle}호차 ${SHIFT_LABEL[sel.shift]}`,
    stops: stops.map((s) => ({ key: s.key, names: stopName(s), addr: s.address, plan: planOf(s) })),
    endPlan: planEnd,
    viaKeys: trip?.cid === cid && trip?.date === date ? trip.viaKeys || [] : [],
    lastSig: trip?.cid === cid ? trip.lastSig : null,
    lastKey: trip?.cid === cid ? trip.lastKey : null,
  });
  const syncNotice = async (patch = {}, force = false) => {
    trip = { ...tripData(), ...patch };
    await db.put('kv', trip).catch(() => {});
    const reg = await navigator.serviceWorker.ready.catch(() => null);
    reg?.active?.postMessage({ type: 'trip-sync', force });
  };
  const notifyBtn = canNotify ? `<button class="btn notify ${notifyOn ? 'on' : ''}" id="notify-toggle">${notifyOn ? '🔔 운행 알림 켜짐 (끄기)' : '🔕 운행 알림 켜기'}</button>` : '';

  const nextCard = next ? `
    <section class="next card">
      ${tripBar}
      ${notifyBtn}
      <div class="next-label">다음 정류장 · ${doneCount + 1}/${stops.length}</div>
      <div class="next-name">${riderNames(next)}</div>
      <div class="next-addr">${esc(next.address)}</div>
      <div class="next-eta">예상 ${fmtHHMM(next.time)}${planOf(next) !== next.time ? ` <span class="edited-mark">(시간표 ${fmtHHMM(planOf(next))})</span>` : ''}${next.wait >= 1 ? ` <span class="badge">${minLabel(next.wait)} 대기</span>` : ''}${next.late ? ` <span class="badge red-bg">${minLabel(next.late)} 늦음</span>` : ''}</div>
      ${view.live ? `
        <button class="btn huge go" data-nav="${esc(next.key)}" data-app="${primary}">▶ 다음 정류장 길안내<small>${esc(NAV_APPS[primary].label)}</small></button>
        ${viaPts.length >= 2 ? `<button class="btn big via" id="nav-via">🗺 ${viaPts.length > NAVER_MAX_VIA + 1 ? `앞 ${NAVER_MAX_VIA + 1}곳` : `남은 ${viaPts.length}곳`} 한 번에 길안내<small>네이버지도 · 경유지로 ${viaPts.slice(0, NAVER_MAX_VIA + 1).map((p) => p.short).join(' → ')}</small></button>` : ''}
        <button class="btn" data-nav="${esc(next.key)}" data-app="${secondary}">${esc(NAV_APPS[secondary].label)} 열기</button>`
      : `<p class="warn-text">위치 정보가 없어 길안내를 열 수 없습니다. 인터넷 연결과 설정을 확인하거나 주소를 복사해 쓰세요.</p>
        <button class="btn" data-copy="${esc(next.address)}">주소 복사</button>`}
      <button class="btn big ok" data-done="${esc(next.key)}">✓ 도착 완료</button>
    </section>` : `
    <section class="next card">
      ${tripBar}
      ${notifyBtn}
      <div class="next-label">모든 정류장 완료 (${stops.length}곳)</div>
      <div class="next-name">${cs.endAt ? '어린이집 도착 완료' : '어린이집으로 복귀'}</div>
      <div class="next-eta">예상 도착 ${fmtHHMM(view.end)}${planEnd !== view.end ? ` (시간표 ${fmtHHMM(planEnd)})` : ''}${cs.endAt ? ` · 실제 ${hhmm(cs.endAt)} <span class="${compareArrival(cs.endAt, planEnd)?.cls}">(${compareArrival(cs.endAt, planEnd)?.text})</span>` : ''}</div>
      ${cs.endAt ? '' : `${view.live ? `<button class="btn huge go" data-nav="__end" data-app="${primary}">▶ 어린이집 길안내<small>${esc(NAV_APPS[primary].label)}</small></button>` : ''}
      <button class="btn big ok" id="end-now">✓ 어린이집 도착</button>`}
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
      ${recLine(s)}
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
        ${cs.done.length || cs.startedAt || cs.endAt ? '<button class="btn" id="reset-done">완료·시간 기록 지우기</button>' : ''}
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
    // 첫 길안내를 누르면 출발한 것으로 보고 시각을 기록
    if (!cs.startedAt && !cs.done.length) { cs.startedAt = Date.now(); save(); }
    if (notifyOn) syncNotice({ viaKeys: [key] });
    ctx.navigate(b.dataset.app, dest, settings);
  }));
  route.querySelector('#nav-via')?.addEventListener('click', () => {
    const pts = viaPts.slice(0, NAVER_MAX_VIA + 1);
    const last = pts[pts.length - 1];
    if (!cs.startedAt && !cs.done.length) { cs.startedAt = Date.now(); save(); }
    if (notifyOn) syncNotice({ viaKeys: pts.map((p) => p.key) });
    ctx.navigate('naver', { name: last.name, lat: last.lat, lng: last.lng, via: pts.slice(0, -1) }, settings);
  });
  route.querySelector('#notify-toggle')?.addEventListener('click', async () => {
    if (notifyOn) {
      trip = { ...trip, on: false };
      await db.put('kv', trip).catch(() => {});
      (await navigator.serviceWorker.ready.catch(() => null))?.active?.postMessage({ type: 'trip-sync' });
      ctx.toast('운행 알림을 껐습니다', 'info');
      ctx.refresh();
      return;
    }
    let perm = Notification.permission;
    if (perm === 'default') perm = await Notification.requestPermission().catch(() => 'denied');
    if (perm !== 'granted') { ctx.toast('알림이 막혀 있습니다. 휴대폰 설정 → 앱/크롬 → 알림에서 허용해 주세요', 'error'); return; }
    await syncNotice({}, true);
    ctx.toast('운행 알림을 켰습니다. 내비를 보면서 알림에서 [도착 완료]를 누르세요', 'info');
    ctx.refresh();
  });
  if (notifyOn) syncNotice();
  // 알림의 [이어서 길안내]로 앱이 열렸을 때
  if (ctx.shared.go === 'via') {
    ctx.shared.go = '';
    const b = route.querySelector('#nav-via') || route.querySelector('[data-nav]');
    if (b) { b.scrollIntoView({ block: 'center' }); b.classList.add('pulse'); try { b.click(); } catch { /* 막히면 직접 누르게 둔다 */ } }
  }
  const markArrived = (k) => {
    if (!cs.done.includes(k)) cs.done.push(k);
    cs.arrived[k] = Date.now();
    const s = stops.find((x) => x.key === k);
    const c = s ? compareArrival(cs.arrived[k], planOf(s)) : null;
    ctx.toast(`도착 ${hhmm(cs.arrived[k])} · 출발 후 ${durLabel(elapsedMin(baseMs, cs.arrived[k]))}${c ? ` · ${c.text}` : ''}`, 'info');
  };
  route.querySelector('#start-now')?.addEventListener('click', async () => { cs.startedAt = Date.now(); await save(); ctx.refresh(); });
  route.querySelector('#end-now')?.addEventListener('click', async () => { cs.endAt = Date.now(); await save(); ctx.refresh(); window.scrollTo(0, 0); });
  if (cs.startedAt && !cs.endAt) {
    tick = setInterval(() => {
      const e = document.getElementById('elapsed');
      if (e) e.textContent = durLabel(elapsedMin(cs.startedAt, Date.now())); else { clearInterval(tick); tick = null; }
    }, 30000);
  }
  route.querySelectorAll('[data-copy]').forEach((b) => b.addEventListener('click', async () => {
    ctx.toast((await copyToClipboard(b.dataset.copy)) ? '주소를 복사했습니다' : '복사하지 못했습니다', 'info');
  }));
  route.querySelectorAll('[data-done]').forEach((b) => b.addEventListener('click', async () => {
    markArrived(b.dataset.done);
    await save();
    ctx.refresh();
    window.scrollTo(0, 0);
  }));
  route.querySelectorAll('[data-toggle]').forEach((b) => b.addEventListener('click', async () => {
    const k = b.dataset.toggle;
    if (cs.done.includes(k)) { cs.done = cs.done.filter((x) => x !== k); delete cs.arrived[k]; cs.endAt = null; } else markArrived(k);
    await save();
    ctx.refresh();
  }));
  route.querySelector('#reset-order')?.addEventListener('click', async () => { cs.manual = null; await save(); ctx.refresh(); });
  route.querySelector('#reset-done')?.addEventListener('click', async () => {
    if (!confirm('오늘 완료 체크와 출발·도착 시간 기록을 모두 지울까요?')) return;
    cs.done = []; cs.arrived = {}; cs.startedAt = null; cs.endAt = null; await save(); ctx.refresh();
  });
}
