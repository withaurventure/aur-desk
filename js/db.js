// AUR Desk — on-phone database (IndexedDB). Nothing here ever leaves the phone
// unless you make a backup yourself.
const DB_NAME = 'aur-desk';
const DB_VERSION = 2; // v2 adds quotations and invoices ('docs')
let dbPromise;

function open() {
  if (!dbPromise) {
    dbPromise = new Promise((resolve, reject) => {
      const req = indexedDB.open(DB_NAME, DB_VERSION);
      req.onupgradeneeded = () => {
        const d = req.result;
        for (const store of ['clients', 'rates', 'docs']) {
          if (!d.objectStoreNames.contains(store)) d.createObjectStore(store, { keyPath: 'id' });
        }
        if (!d.objectStoreNames.contains('kv')) d.createObjectStore('kv');
      };
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => reject(req.error);
    });
  }
  return dbPromise;
}

async function run(store, mode, fn) {
  const d = await open();
  return new Promise((resolve, reject) => {
    const t = d.transaction(store, mode);
    const req = fn(t.objectStore(store));
    t.oncomplete = () => resolve(req ? req.result : undefined);
    t.onerror = () => reject(t.error);
    t.onabort = () => reject(t.error);
  });
}

export const db = {
  all: (store) => run(store, 'readonly', (s) => s.getAll()),
  get: (store, id) => run(store, 'readonly', (s) => s.get(id)),
  put: (store, value) => run(store, 'readwrite', (s) => s.put(value)),
  del: (store, id) => run(store, 'readwrite', (s) => s.delete(id)),
  clear: (store) => run(store, 'readwrite', (s) => s.clear()),
  getKV: (key) => run('kv', 'readonly', (s) => s.get(key)),
  setKV: (key, value) => run('kv', 'readwrite', (s) => s.put(value, key)),

  // Erase everything (used by "Forgot PIN").
  async wipe() {
    const d = await open();
    d.close();
    dbPromise = null;
    await new Promise((resolve) => {
      const req = indexedDB.deleteDatabase(DB_NAME);
      req.onsuccess = req.onerror = req.onblocked = () => resolve();
    });
  },
};

// Ask Android not to clear our data when storage runs low.
export function keepDataSafe() {
  if (navigator.storage && navigator.storage.persist) navigator.storage.persist().catch(() => {});
}
