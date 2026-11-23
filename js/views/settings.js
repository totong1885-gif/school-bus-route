// 설정: 어린이집, 호차·출발 시각, 내비 앱, 키, 시간 계산값, 명단 파일
import { esc, numOr, localDate } from '../util.js';
import * as db from '../db.js';
import { geocode, clearGeoMemory } from '../geocode.js';
import { clearRoadCache } from '../roadtime.js';
import { NAV_APPS } from '../navlink.js';
import { parseHHMM } from '../model.js';
import { buildBackup, restoreBackup, downloadJson } from '../backup.js';
import { sampleData } from '../sample.js';

export async function render(el, ctx) {
  const s = await ctx.settings();
  const n = Math.min(3, Math.max(1, Number(s.vehicleCount) || 1));
  const apps = Object.entries(NAV_APPS).filter(([k, v]) => !v.experimental || s.showTmap || s.naviApp === k);

  el.innerHTML = `
    <form class="card form" id="sf">
      <h3>어린이집 (출발·도착)</h3>
      <label>이름<input name="dcName" value="${esc(s.daycare.name)}"></label>
      <label>주소<input name="dcAddress" value="${esc(s.daycare.address)}" placeholder="도로명 주소"></label>
      <button class="btn" type="button" id="dc-check">주소 확인</button> <span id="dc-result" class="small"></span>

      <h3>호차와 출발 시각 <small>24시간제</small></h3>
      <label>운행 호차 수<select name="vehicleCount">${[1, 2, 3].map((v) => `<option value="${v}" ${v === n ? 'selected' : ''}>${v}대</option>`).join('')}</select></label>
      <table class="ex-table"><thead><tr><th></th><th>등원 출발</th><th>하원 출발</th></tr></thead><tbody>
        ${[1, 2, 3].slice(0, n).map((v) => `<tr><th>${v}호차</th>
          <td><input type="time" name="dt-${v}-am" value="${esc(s.departTimes[`${v}-am`] || '08:10')}" required></td>
          <td><input type="time" name="dt-${v}-pm" value="${esc(s.departTimes[`${v}-pm`] || '15:50')}" required></td></tr>`).join('')}
      </tbody></table>

      <h3>기본 길안내 앱</h3>
      <div class="radios">
        ${apps.map(([k, v]) => `<label class="radio"><input type="radio" name="naviApp" value="${k}" ${s.naviApp === k ? 'checked' : ''}>
          <span><b>${v.label}</b><small>${esc(v.note)}</small></span></label>`).join('')}
      </div>
      <label class="check"><input type="checkbox" name="showTmap" ${s.showTmap ? 'checked' : ''}> 실험적 기능(티맵) 보이기</label>

      <h3>지도 서비스 키 <small>이 휴대폰에만 저장</small></h3>
      <label>카카오 REST API 키 (주소 → 위치)<input name="kakaoRestKey" value="${esc(s.kakaoRestKey)}" autocomplete="off" spellcheck="false"></label>
      <label>카카오 JavaScript 키 (카카오내비 쓸 때만)<input name="kakaoJsKey" value="${esc(s.kakaoJsKey)}" autocomplete="off" spellcheck="false"></label>
      <label class="check"><input type="checkbox" name="useRoadApi" ${s.useRoadApi ? 'checked' : ''}> 도로 시간으로 계산 (카카오모빌리티, 하루 무료 1,000건)</label>
      <p class="small muted">끄면 직선거리 ÷ 평균 속도로 추정합니다. 켜도 실패하면 자동으로 직선 추정을 씁니다. 지도 서버에는 좌표만 보내고 이름은 보내지 않습니다.</p>

      <h3>시간 계산</h3>
      <div class="two">
        <label>평균 속도(km/h) <small>도로 시간을 못 받을 때</small><input name="speedKmh" type="number" min="5" max="80" step="1" value="${esc(s.speedKmh)}"></label>
        <label>정류장 정차(분)<input name="dwellMin" type="number" min="0" max="15" step="0.5" value="${esc(s.dwellMin)}"></label>
        <label>이동시간 여유(×)<input name="marginFactor" type="number" min="1" max="3" step="0.05" value="${esc(s.marginFactor)}"></label>
        <label>도로 시간 보정(×) <small>신호·스쿨존</small><input name="roadFactor" type="number" min="1" max="3" step="0.05" value="${esc(s.roadFactor)}"></label>
      </div>
      <button class="btn primary big full" type="submit">설정 저장</button>
    </form>

    <section class="card">
      <h3>명단 파일 <small>이름·주소가 들어 있으니 보관에 주의</small></h3>
      <label class="check"><input type="checkbox" id="incl-keys"> API 키도 파일에 넣기</label>
      <div class="actions">
        <button class="btn" id="export">명단 파일 내보내기</button>
        <label class="btn" for="import-file">명단 파일 불러오기</label>
        <input type="file" id="import-file" accept="application/json,.json" hidden>
      </div>
    </section>

    <section class="card">
      <h3>기타</h3>
      <div class="actions">
        <button class="btn" id="relocate">위치 다시 찾기</button>
        <button class="btn" id="sample">샘플 데이터 넣기 (가짜 이름·주소)</button>
        <button class="btn danger" id="wipe">전체 삭제</button>
      </div>
      <p class="small muted">위치(좌표)는 저장하지 않고 앱을 열 때마다 다시 찾습니다.</p>
    </section>`;

  const form = el.querySelector('#sf');
  const collect = () => {
    const f = new FormData(form);
    const count = Math.min(3, Math.max(1, Number(f.get('vehicleCount')) || 1));
    const departTimes = { ...s.departTimes };
    for (let v = 1; v <= 3; v++) {
      for (const sh of ['am', 'pm']) {
        const val = f.get(`dt-${v}-${sh}`);
        if (val !== null && parseHHMM(val) !== null) departTimes[`${v}-${sh}`] = String(val);
      }
    }
    return {
      ...s,
      daycare: { name: String(f.get('dcName') || '').trim() || '어린이집', address: String(f.get('dcAddress') || '').replace(/\s+/g, ' ').trim() },
      vehicleCount: count,
      departTimes,
      naviApp: String(f.get('naviApp') || 'naver'),
      showTmap: f.get('showTmap') === 'on',
      kakaoRestKey: String(f.get('kakaoRestKey') || '').trim(),
      kakaoJsKey: String(f.get('kakaoJsKey') || '').trim(),
      useRoadApi: f.get('useRoadApi') === 'on',
      speedKmh: Math.min(80, Math.max(5, numOr(f.get('speedKmh'), 30))),
      dwellMin: Math.min(15, Math.max(0, numOr(f.get('dwellMin'), 2))),
      marginFactor: Math.min(3, Math.max(1, numOr(f.get('marginFactor'), 1.2))),
      roadFactor: Math.min(3, Math.max(1, numOr(f.get('roadFactor'), 1.3))),
    };
  };

  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    const next = collect();
    if (next.naviApp === 'tmap' && !next.showTmap) next.naviApp = 'naver';
    await db.saveSettings(next);
    ctx.toast('설정을 저장했습니다');
    ctx.refresh();
  });
  form.querySelector('[name=vehicleCount]').addEventListener('change', async () => { await db.saveSettings(collect()); ctx.refresh(); });
  form.querySelector('[name=showTmap]').addEventListener('change', async () => { await db.saveSettings(collect()); ctx.refresh(); });

  el.querySelector('#dc-check').addEventListener('click', async () => {
    const out = el.querySelector('#dc-result');
    const v = collect();
    out.textContent = '확인 중…';
    try {
      const g = await geocode(v.daycare.address, v.kakaoRestKey);
      out.textContent = `✓ ${g.roadAddress || v.daycare.address}`;
    } catch (err) {
      out.textContent = `✗ ${err.message}`;
    }
  });

  el.querySelector('#export').addEventListener('click', async () => {
    try {
      downloadJson(await buildBackup({ includeKeys: el.querySelector('#incl-keys').checked }), `명단-${localDate()}.json`);
    } catch (err) { ctx.toast('내보내지 못했습니다: ' + err.message, 'error'); }
  });
  el.querySelector('#import-file').addEventListener('change', async (e) => {
    const file = e.target.files?.[0];
    e.target.value = '';
    if (!file) return;
    try {
      const obj = JSON.parse(await file.text());
      if (!confirm('지금 명단·내 코스를 파일 내용으로 바꿉니다. 계속할까요?')) return;
      await restoreBackup(obj);
      ctx.toast('명단을 불러왔습니다');
      ctx.refresh();
    } catch (err) {
      ctx.toast('불러오지 못했습니다: ' + (err instanceof SyntaxError ? 'JSON 파일이 아닙니다' : err.message), 'error');
    }
  });
  el.querySelector('#relocate').addEventListener('click', () => { clearGeoMemory(); clearRoadCache(); ctx.toast('다음 계산 때 위치를 다시 찾습니다'); });
  el.querySelector('#sample').addEventListener('click', async () => {
    if (!confirm('지금 명단·내 코스를 지우고 샘플 데이터를 넣을까요? (API 키는 유지)')) return;
    const d = sampleData();
    await db.clear('children');
    await db.clear('courses');
    await db.del('kv', 'today');
    await db.del('kv', 'timetable');
    for (const c of d.children) await db.put('children', c);
    await db.saveSettings({ ...s, ...d.settings, departTimes: { ...s.departTimes, ...d.settings.departTimes } });
    ctx.toast('샘플 데이터를 넣었습니다');
    ctx.refresh();
  });
  el.querySelector('#wipe').addEventListener('click', async () => {
    if (!confirm('명단·코스·설정·API 키를 모두 지웁니다. 되돌릴 수 없습니다. 계속할까요?')) return;
    for (const st of db.STORES) await db.clear(st);
    clearGeoMemory();
    ctx.toast('모두 지웠습니다');
    ctx.refresh();
  });
}
