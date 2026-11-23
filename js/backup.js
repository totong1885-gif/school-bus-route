// 명단 파일(JSON) 내보내기·불러오기. 원아 이름·주소가 들어 있으니 파일 보관에 주의.
import * as db from './db.js';

export const BACKUP_APP = 'school-bus-route';
export const BACKUP_VERSION = 2;

export async function buildBackup({ includeKeys = false } = {}) {
  const settings = await db.getSettings();
  if (!includeKeys) { settings.kakaoRestKey = ''; settings.kakaoJsKey = ''; }
  return {
    app: BACKUP_APP,
    version: BACKUP_VERSION,
    exportedAt: new Date().toISOString(),
    settings,
    children: await db.getAll('children'),
    courses: await db.getAll('courses'),
  };
}

/** 순수 함수: 형식 검사 */
export function validateBackup(obj) {
  const errors = [];
  if (!obj || typeof obj !== 'object') return { ok: false, errors: ['JSON 파일 형식이 아닙니다'] };
  if (obj.app !== BACKUP_APP) errors.push('이 앱의 명단 파일이 아닙니다');
  if (obj.version !== BACKUP_VERSION) errors.push(`지원하지 않는 파일 버전입니다 (${obj.version})`);
  if (!Array.isArray(obj.children)) errors.push('원아 목록이 없습니다');
  if (obj.courses !== undefined && !Array.isArray(obj.courses)) errors.push('코스 형식 오류');
  (obj.children || []).forEach((c, i) => {
    if (!c || typeof c.id !== 'string' || typeof c.name !== 'string' || typeof c.address !== 'string') errors.push(`원아 ${i + 1}번 형식 오류`);
  });
  (obj.courses || []).forEach((c, i) => {
    if (!c || typeof c.id !== 'string' || !Array.isArray(c.order)) errors.push(`코스 ${i + 1}번 형식 오류`);
  });
  // 좌표가 들어 있으면 받지 않는다(저장하지 않는 원칙)
  return { ok: errors.length === 0, errors };
}

const stripCoords = (c) => { const { lat, lng, roadAddress, ...rest } = c; return rest; };

export async function restoreBackup(obj) {
  const v = validateBackup(obj);
  if (!v.ok) throw new Error(v.errors.join(', '));
  const cur = await db.getSettings();
  const s = { ...cur, ...(obj.settings || {}), id: 'settings' };
  if (!obj.settings?.kakaoRestKey) s.kakaoRestKey = cur.kakaoRestKey;
  if (!obj.settings?.kakaoJsKey) s.kakaoJsKey = cur.kakaoJsKey;
  if (s.daycare) s.daycare = stripCoords(s.daycare);
  await db.clear('children');
  await db.clear('courses');
  await db.del('kv', 'today');
  await db.del('kv', 'timetable');
  for (const c of obj.children) await db.put('children', stripCoords(c));
  for (const c of obj.courses || []) await db.put('courses', c);
  await db.saveSettings(s);
}

export function downloadJson(obj, filename) {
  const blob = new Blob([JSON.stringify(obj, null, 2)], { type: 'application/json' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
