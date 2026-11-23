// IndexedDB 래퍼. IndexedDB를 쓸 수 없는 환경(일부 사생활 보호 모드 등)에서는
// 메모리 저장소로 대체해 앱이 멈추지 않게 한다(이 경우 새로고침하면 데이터가 사라짐).
const DB_NAME = 'busroute';
const DB_VERSION = 1;
export const STORES = ['kv', 'children', 'runs'];

let dbPromise = null;
let memory = null; // { storeName: Map }

function clone(v) {
  try { return structuredClone(v); } catch { return JSON.parse(JSON.stringify(v)); }
}

function useMemory() {
  if (!memory) {
    memory = {};
    for (const s of STORES) memory[s] = new Map();
  }
  return null;
}

function openDb() {
  if (dbPromise) return dbPromise;
  dbPromise = new Promise((resolve, reject) => {
    if (typeof indexedDB === 'undefined') { reject(new Error('IndexedDB 미지원')); return; }
    const req = indexedDB.open(DB_NAME, DB_VERSION);
    req.onupgradeneeded = () => {
      const db = req.result;
      for (const s of STORES) {
        if (!db.objectStoreNames.contains(s)) db.createObjectStore(s, { keyPath: 'id' });
      }
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
    req.onblocked = () => reject(new Error('IndexedDB blocked'));
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

function reqToPromise(req) {
  return new Promise((resolve, reject) => {
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

async function withStore(store, mode, fn) {
  const db = await openDb();
  if (!db) return fn(null);
  const tx = db.transaction(store, mode);
  const result = await fn(tx.objectStore(store));
  await new Promise((resolve, reject) => {
    tx.oncomplete = resolve;
    tx.onerror = () => reject(tx.error);
    tx.onabort = () => reject(tx.error || new Error('transaction aborted'));
  });
  return result;
}

export async function getAll(store) {
  return withStore(store, 'readonly', (os) =>
    os ? reqToPromise(os.getAll()) : [...memory[store].values()].map(clone));
}

export async function get(store, id) {
  return withStore(store, 'readonly', async (os) => {
    if (os) return (await reqToPromise(os.get(id))) ?? null;
    const v = memory[store].get(id);
    return v ? clone(v) : null;
  });
}

export async function put(store, obj) {
  return withStore(store, 'readwrite', (os) => {
    if (os) return reqToPromise(os.put(obj));
    memory[store].set(obj.id, clone(obj));
    return obj.id;
  });
}

export async function del(store, id) {
  return withStore(store, 'readwrite', (os) => {
    if (os) return reqToPromise(os.delete(id));
    memory[store].delete(id);
  });
}

export async function clear(store) {
  return withStore(store, 'readwrite', (os) => {
    if (os) return reqToPromise(os.clear());
    memory[store].clear();
  });
}

// 기본값을 채운 설정 객체
export const DEFAULT_SETTINGS = {
  id: 'settings',
  kakaoRestKey: '',
  kakaoJsKey: '',
  naviApp: 'kakaomap', // kakaomap | kakaonavi | naver | tmap
  daycare: { name: '어린이집', address: '', lat: null, lng: null, roadAddress: '' },
  speedKmh: 20,
  dwellMin: 1,
};

export async function getSettings() {
  const s = await get('kv', 'settings');
  return { ...clone(DEFAULT_SETTINGS), ...(s || {}), daycare: { ...DEFAULT_SETTINGS.daycare, ...(s?.daycare || {}) } };
}

export async function saveSettings(s) {
  return put('kv', { ...s, id: 'settings' });
}

export function newId(prefix) {
  const rnd = (typeof crypto !== 'undefined' && crypto.randomUUID)
    ? crypto.randomUUID().slice(0, 8)
    : Math.random().toString(36).slice(2, 10);
  return `${prefix}_${Date.now().toString(36)}_${rnd}`;
}
