export function esc(s) {
  return String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}

export function localDate(d = new Date()) {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

export const DAY_NAMES = ['일', '월', '화', '수', '목', '금', '토'];

let toastTimer = null;
export function toast(msg, kind = 'info') {
  try {
    const el = document.getElementById('toast');
    if (!el) return;
    el.textContent = msg;
    el.className = `toast show ${kind}`;
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => { el.className = 'toast'; }, kind === 'error' ? 5000 : 3000);
  } catch { /* 무시 */ }
}

export function numOrNull(v) {
  if (v === '' || v === null || v === undefined) return null;
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
}

/** "37.1234, 127.1234" → {lat,lng} | null */
export function parseLatLng(s) {
  const m = String(s || '').split(/[,\s]+/).filter(Boolean).map(Number);
  if (m.length !== 2 || !m.every(Number.isFinite)) return null;
  const [lat, lng] = m;
  if (lat < 30 || lat > 45 || lng < 120 || lng > 135) return null; // 한반도 주변 범위만 허용
  return { lat, lng };
}
