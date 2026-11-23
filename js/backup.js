// JSON 백업 내보내기/불러오기
import * as db from './db.js';

export const BACKUP_APP = 'school-bus-route';
export const BACKUP_VERSION = 1;

export async function buildBackup({ includeKeys = false } = {}) {
  const settings = await db.getSettings();
  if (!includeKeys) { settings.kakaoRestKey = ''; settings.kakaoJsKey = ''; }
  return {
    app: BACKUP_APP,
    version: BACKUP_VERSION,
    exportedAt: new Date().toISOString(),
    settings,
    children: await db.getAll('children'),
    runs: await db.getAll('runs'),
  };
}

/** 순수 함수: 백업 형식 검사 */
export function validateBackup(obj) {
  const errors = [];
  if (!obj || typeof obj !== 'object') return { ok: false, errors: ['JSON 객체가 아닙니다'] };
  if (obj.app !== BACKUP_APP) errors.push('이 앱의 백업 파일이 아닙니다');
  if (typeof obj.version !== 'number' || obj.version > BACKUP_VERSION) errors.push('지원하지 않는 백업 버전입니다');
  if (!Array.isArray(obj.children)) errors.push('원아 목록이 없습니다');
  if (!Array.isArray(obj.runs)) errors.push('회차 목록이 없습니다');
  (obj.children || []).forEach((c, i) => {
    if (!c || typeof c.id !== 'string' || typeof c.name !== 'string') errors.push(`원아 ${i + 1}번 형식 오류`);
  });
  (obj.runs || []).forEach((r, i) => {
    if (!r || typeof r.id !== 'string' || !Array.isArray(r.childIds)) errors.push(`회차 ${i + 1}번 형식 오류`);
  });
  return { ok: errors.length === 0, errors };
}

export async function restoreBackup(obj) {
  const v = validateBackup(obj);
  if (!v.ok) throw new Error(v.errors.join('\n'));
  const cur = await db.getSettings();
  const s = { ...cur, ...(obj.settings || {}), id: 'settings' };
  // 백업에 키가 비어 있으면 현재 기기의 키를 유지
  if (!obj.settings?.kakaoRestKey) s.kakaoRestKey = cur.kakaoRestKey;
  if (!obj.settings?.kakaoJsKey) s.kakaoJsKey = cur.kakaoJsKey;
  await db.clear('children');
  await db.clear('runs');
  await db.del('kv', 'today');
  for (const c of obj.children) await db.put('children', c);
  for (const r of obj.runs) await db.put('runs', r);
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
