// 설정: API 키, 내비 앱, 어린이집 위치, 계산값, 백업
import { esc, parseLatLng, numOrNull, localDate } from '../util.js';
import * as db from '../db.js';
import { geocode } from '../geocode.js';
import { NAVI_APPS } from '../navi.js';
import { buildBackup, restoreBackup, downloadJson } from '../backup.js';
import { sampleData } from '../sample.js';

export async function render(el, ctx) {
  const s = await db.getSettings();
  const d = s.daycare;
  const naviNote = { kakaonavi: 'JavaScript 키 + 도메인 등록 필요. 없으면 카카오맵으로 대체', tmap: '공식 문서 미확인 형식 · 실기기 확인 필요', naver: '', kakaomap: '키 없이 동작' };

  el.innerHTML = `
    <form class="card form" id="settings-form">
      <h3>길안내 앱</h3>
      <div class="radios">
        ${Object.entries(NAVI_APPS).map(([k, v]) => `
          <label class="radio"><input type="radio" name="naviApp" value="${k}" ${s.naviApp === k ? 'checked' : ''}>
            <span><b>${v.label}</b>${naviNote[k] ? `<small>${naviNote[k]}</small>` : ''}</span></label>`).join('')}
      </div>

      <h3>어린이집 (출발·도착)</h3>
      <label>이름<input name="dcName" value="${esc(d.name)}"></label>
      <label>주소<input name="dcAddress" value="${esc(d.address)}"></label>
      <p class="small ${Number.isFinite(d.lat) ? 'muted' : 'warn-text'}">${Number.isFinite(d.lat) ? `좌표: ${d.lat.toFixed(5)}, ${d.lng.toFixed(5)} ${d.roadAddress ? '(' + esc(d.roadAddress) + ')' : ''}` : '좌표 없음 — 코스를 계산하려면 필요합니다'}</p>
      <button class="btn" type="button" id="dc-geo">주소로 좌표 찾기</button>
      <details><summary>좌표 직접 입력</summary>
        <label>위도, 경도<input name="dcCoords" placeholder="37.12345, 127.12345" inputmode="decimal"></label></details>

      <h3>카카오 API 키 <small>이 기기에만 저장됩니다</small></h3>
      <label>REST API 키 (주소 → 좌표)<input name="kakaoRestKey" value="${esc(s.kakaoRestKey)}" autocomplete="off" spellcheck="false"></label>
      <label>JavaScript 키 (카카오내비 사용 시만)<input name="kakaoJsKey" value="${esc(s.kakaoJsKey)}" autocomplete="off" spellcheck="false"></label>
      <p class="small muted">카카오 개발자 콘솔 → 앱 → [카카오맵] 사용 설정 ON 필요. 주소 검색 무료 한도는 하루 100,000건(계정의 첫 앱 기준)입니다.</p>

      <h3>예상 시간 계산</h3>
      <div class="two">
        <label>평균 속도(km/h)<input name="speedKmh" type="number" min="5" max="80" value="${esc(s.speedKmh)}"></label>
        <label>정류장 정차(분)<input name="dwellMin" type="number" min="0" max="10" value="${esc(s.dwellMin)}"></label>
      </div>
      <p class="small muted">거리는 직선거리 기준이라 실제 도로보다 짧습니다. 평균 속도를 낮게 잡아 보정하세요.</p>
      <button class="btn primary big full" type="submit">설정 저장</button>
    </form>

    <section class="card">
      <h3>백업</h3>
      <label class="check"><input type="checkbox" id="incl-keys"> API 키도 백업 파일에 포함</label>
      <div class="actions">
        <button class="btn" id="export">JSON 내보내기</button>
        <label class="btn" for="import-file">JSON 불러오기</label>
        <input type="file" id="import-file" accept="application/json,.json" hidden>
      </div>
    </section>

    <section class="card">
      <h3>시험·초기화</h3>
      <div class="actions">
        <button class="btn" id="sample">샘플 데이터 넣기 (가짜 이름·주소)</button>
        <button class="btn danger" id="wipe">전체 삭제</button>
      </div>
    </section>
  `;

  const form = el.querySelector('#settings-form');
  const collect = () => {
    const f = new FormData(form);
    const next = {
      ...s,
      naviApp: String(f.get('naviApp') || 'kakaomap'),
      kakaoRestKey: String(f.get('kakaoRestKey') || '').trim(),
      kakaoJsKey: String(f.get('kakaoJsKey') || '').trim(),
      speedKmh: numOrNull(f.get('speedKmh')) || 20,
      dwellMin: numOrNull(f.get('dwellMin')) ?? 1,
      daycare: { ...d, name: String(f.get('dcName') || '').trim() || '어린이집', address: String(f.get('dcAddress') || '').trim() },
    };
    if (next.daycare.address !== d.address) Object.assign(next.daycare, { lat: null, lng: null, roadAddress: '' });
    const manual = parseLatLng(f.get('dcCoords'));
    if (manual) Object.assign(next.daycare, manual, { roadAddress: '' });
    return next;
  };
  const save = async (next, msg = '저장했습니다') => {
    await db.saveSettings(next);
    await ctx.touch();
    ctx.toast(msg);
    ctx.refresh();
  };

  form.addEventListener('submit', (e) => { e.preventDefault(); save(collect()); });

  el.querySelector('#dc-geo').addEventListener('click', async (e) => {
    const next = collect();
    e.currentTarget.disabled = true;
    try {
      const g = await geocode(next.daycare.address, next.kakaoRestKey);
      Object.assign(next.daycare, { lat: g.lat, lng: g.lng, roadAddress: g.roadAddress || g.addressName });
      await save(next, '어린이집 좌표를 찾았습니다');
    } catch (err) {
      ctx.toast(err.message, 'error');
      e.currentTarget.disabled = false;
    }
  });

  el.querySelector('#export').addEventListener('click', async () => {
    try {
      const data = await buildBackup({ includeKeys: el.querySelector('#incl-keys').checked });
      downloadJson(data, `bus-backup-${localDate()}.json`);
    } catch (err) { ctx.toast('내보내기 실패: ' + err.message, 'error'); }
  });

  el.querySelector('#import-file').addEventListener('change', async (e) => {
    const file = e.target.files?.[0];
    e.target.value = '';
    if (!file) return;
    try {
      const obj = JSON.parse(await file.text());
      if (!confirm('현재 명단·시간표를 백업 파일 내용으로 바꿉니다. 계속할까요?')) return;
      await restoreBackup(obj);
      await ctx.touch();
      ctx.toast('불러왔습니다');
      ctx.refresh();
    } catch (err) {
      ctx.toast('불러오기 실패: ' + err.message, 'error');
    }
  });

  el.querySelector('#sample').addEventListener('click', async () => {
    if (!confirm('현재 명단·시간표를 지우고 샘플 데이터를 넣을까요? (API 키는 유지)')) return;
    const data = sampleData();
    await db.clear('children');
    await db.clear('runs');
    await db.del('kv', 'today');
    for (const c of data.children) await db.put('children', c);
    for (const r of data.runs) await db.put('runs', r);
    await save({ ...s, daycare: data.settings.daycare }, '샘플 데이터를 넣었습니다');
  });

  el.querySelector('#wipe').addEventListener('click', async () => {
    if (!confirm('모든 데이터(명단·시간표·설정·API 키)를 삭제합니다. 되돌릴 수 없습니다. 계속할까요?')) return;
    for (const st of db.STORES) await db.clear(st);
    ctx.toast('모두 삭제했습니다');
    ctx.refresh();
  });
}
