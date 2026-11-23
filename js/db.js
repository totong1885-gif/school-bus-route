// IndexedDB 래퍼. 쓸 수 없는 환경이면 메모리 저장소로 대체(새로고침 시 사라짐)해 앱이 멈추지 않게 한다.
// 저장하는 것: 설정, 원아(이름·주소 글자·배정), 내 코스 순서, 오늘 상태와 마지막 코스(좌표 없음).
// 저장하지 않는 것: 카카오에서 받은 좌표, 도로 시간 응답.
const DB_NAME = 'busroute';
const DB_VERSION = 2;
export const STORES = ['kv', 'children', 'courses'];

let dbPromise = null;
let memory = null;

function clone(v) {
  try { return structuredClone(v); } catch { return JSON.parse(JSON.stringify(v)); }
}

function useMemory() {
  if (!memory) { memory = {}; for (const s of STORES) memory[s] = new Map(); }
  return null;
}

function openDb() {
  if (dbPromise) return dbPromise;
  dbPromise = new Promise((resolve, reject) => {
    if (typeof indexedDB === 'undefined') { reject(new Error('IndexedDB 미지원')); return; }
    const req = indexedDB.open(DB_NAME, DB_VERSION);
    req.onupgradeneeded = (e) => {
      const db = req.result;
      if (e.oldVersion < 2) {
        // v1(이전 구조, 좌표 저장)은 모두 지우고 새로 시작
        for (const name of [...db.objectStoreNames]) db.deleteObjectStore(name);
      }
      for (const s of STORES) if (!db.objectStoreNames.contains(s)) db.createObjectStore(s, { keyPath: 'id' });
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
    req.onblocked = () => reject(new Error('다른 창에서 앱이 열려 있어 저장소를 열 수 없습니다'));
  }).catch((e) => {
    console.warn('IndexedDB 사용 불가, 메모리 저장소 사용:', e);
    return useMemory();
  });
  return dbPromise;
}

export async function isMemoryMode() {
  await openDb();
  return memory !== null;
}

const p = (req) => new Promise((resolve, reject) => { req.onsuccess = () => resolve(req.result); req.onerror = () => reject(req.error); });

async function withStore(store, mode, fn) {
  const db = await openDb();
  if (!db) return fn(null);
  const tx = db.transaction(store, mode);
  const result = await fn(tx.objectStore(store));
  await new Promise((resolve, reject) => {
    tx.oncomplete = resolve;
    tx.onerror = () => reject(tx.error);
    tx.onabort = () => reject(tx.error || new Error('저장 취소됨'));
  });
  return result;
}

export const getAll = (store) => withStore(store, 'readonly', (os) => (os ? p(os.getAll()) : [...memory[store].values()].map(clone)));
export const get = (store, id) => withStore(store, 'readonly', async (os) => (os ? (await p(os.get(id))) ?? null : clone(memory[store].get(id) ?? null)));
export const put = (store, obj) => withStore(store, 'readwrite', (os) => (os ? p(os.put(obj)) : (memory[store].set(obj.id, clone(obj)), obj.id)));
export const del = (store, id) => withStore(store, 'readwrite', (os) => (os ? p(os.delete(id)) : memory[store].delete(id)));
export const clear = (store) => withStore(store, 'readwrite', (os) => (os ? p(os.clear()) : memory[store].clear()));

export const DEFAULT_SETTINGS = {
  id: 'settings',
  daycare: { name: '어린이집', address: '' },
  vehicleCount: 1,
  departTimes: { '1-am': '08:10', '1-pm': '15:50', '2-am': '08:10', '2-pm': '15:50', '3-am': '08:10', '3-pm': '15:50' },
  kakaoRestKey: '',
  kakaoJsKey: '',
  naviApp: 'naver', // naver | kakaomap | kakaonavi | tmap(실험)
  showTmap: false,
  useRoadApi: false,
  speedKmh: 30,
  dwellMin: 2,
  marginFactor: 1.2,
  roadFactor: 1.3,
};

export async function getSettings() {
  let s = null;
  try { s = await get('kv', 'settings'); } catch (e) { console.warn(e); }
  const d = clone(DEFAULT_SETTINGS);
  return { ...d, ...(s || {}), daycare: { ...d.daycare, ...(s?.daycare || {}) }, departTimes: { ...d.departTimes, ...(s?.departTimes || {}) } };
}

export const saveSettings = (s) => put('kv', { ...s, id: 'settings' });

export function newId(prefix) {
  const rnd = typeof crypto !== 'undefined' && crypto.randomUUID ? crypto.randomUUID().slice(0, 8) : Math.random().toString(36).slice(2, 10);
  return `${prefix}_${Date.now().toString(36)}_${rnd}`;
}
