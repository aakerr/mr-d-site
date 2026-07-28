// IndexedDB-backed media store — lets the teacher drag-and-drop videos/songs
// into the app (a static site can't write real files). Blobs persist in the
// browser alongside localStorage state.
// Key convention: 'potw:<profileKey>:video' | 'potw:<profileKey>:song'
//
// THE CHANGE EVENT. Every successful put() or delete() fires
//   window CustomEvent 'mrd:media-changed', detail: { key }
// This is the one signal that any object URL previously handed out for that
// key is now revoked and stale. Modules that keep their own URL caches
// (shop.js's art cache) listen for exactly this event name — change it in
// both places or not at all.
const DB_NAME = 'mrd-media';
const STORE = 'files';

function openDb() {
  return new Promise((resolve, reject) => {
    try {
      const req = indexedDB.open(DB_NAME, 1);
      req.onupgradeneeded = () => req.result.createObjectStore(STORE);
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => reject(req.error);
    } catch (e) { reject(e); }
  });
}

function run(mode, op) {
  return openDb().then((db) => new Promise((resolve, reject) => {
    const t = db.transaction(STORE, mode);
    const req = op(t.objectStore(STORE));
    t.oncomplete = () => { db.close(); resolve(req?.result); };
    t.onerror = () => { db.close(); reject(t.error); };
    t.onabort = () => { db.close(); reject(t.error); };
  }));
}

const urlCache = new Map(); // key -> objectURL

// See "THE CHANGE EVENT" above — fired after every successful put/delete so
// consumers holding a cached URL for this key know to drop it.
function announceChange(key) {
  try { window.dispatchEvent(new CustomEvent('mrd:media-changed', { detail: { key } })); }
  catch (e) { /* an event that cannot fire must never fail the write it follows */ }
}

export const media = {
  // Store a File/Blob under key. Returns record metadata or null on failure.
  async put(key, file) {
    try {
      const rec = { blob: file, name: file.name || key, type: file.type || '', size: file.size || 0, ts: Date.now() };
      await run('readwrite', (s) => s.put(rec, key));
      if (urlCache.has(key)) { URL.revokeObjectURL(urlCache.get(key)); urlCache.delete(key); }
      announceChange(key);
      return { key, name: rec.name, type: rec.type, size: rec.size };
    } catch (e) { console.warn('media.put failed', key, e); return null; }
  },

  // Metadata (no blob) or null.
  async info(key) {
    try {
      const rec = await run('readonly', (s) => s.get(key));
      return rec ? { key, name: rec.name, type: rec.type, size: rec.size, ts: rec.ts } : null;
    } catch (e) { return null; }
  },

  // Object URL for playback, or null if absent. URLs are cached per key.
  async url(key) {
    try {
      if (urlCache.has(key)) return urlCache.get(key);
      const rec = await run('readonly', (s) => s.get(key));
      if (!rec?.blob) return null;
      const u = URL.createObjectURL(rec.blob);
      urlCache.set(key, u);
      return u;
    } catch (e) { return null; }
  },

  async delete(key) {
    try {
      await run('readwrite', (s) => s.delete(key));
      if (urlCache.has(key)) { URL.revokeObjectURL(urlCache.get(key)); urlCache.delete(key); }
      announceChange(key);
      return true;
    } catch (e) { return false; }
  },

  // [{key, name, type, size, ts}] for keys starting with prefix. One readonly
  // cursor pass over the store — this used to open a fresh DB connection per
  // matching key (getAllKeys(), then media.info() in a loop), which turns
  // into a lot of IndexedDB opens once a term's worth of media piles up.
  async list(prefix = '') {
    try {
      const results = [];
      await run('readonly', (s) => {
        const req = s.openCursor();
        req.onsuccess = () => {
          const cursor = req.result;
          if (!cursor) return; // done — transaction completes, run() resolves
          const k = cursor.key;
          if (typeof k === 'string' && k.startsWith(prefix)) {
            const rec = cursor.value;
            results.push({ key: k, name: rec.name, type: rec.type, size: rec.size, ts: rec.ts });
          }
          cursor.continue();
        };
        return req;
      });
      return results;
    } catch (e) { return []; }
  },
};
