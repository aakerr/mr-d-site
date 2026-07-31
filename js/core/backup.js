// backup.js — persistent, file-based auto-backup for a static app.
// Uses the File System Access API (Chrome/Edge, which the smartboard runs).
// The teacher picks a backup FOLDER once; the directory handle is persisted in
// IndexedDB (handles are structured-cloneable) so it survives reloads. Every
// store change is debounced (~2s) and written to `mrd-live-backup.json`, plus a
// write-once-per-day rolling snapshot `mrd-backup-YYYY-MM-DD.json`.
//
// Self-initializing on first import (needs the store, which it imports directly).
// NEVER throws into the app — all failures become console.warn + a status flag.
//
// NOTE FOR THE LEAD: add `import './core/backup.js';` to js/main.js so autosave
// runs at boot even when the Admin panel is never opened.
import { CONFIG } from '../config.js';
import { store } from './store.js';
import { media } from './media.js';

const HANDLE_DB = 'mrd-backup';
const HANDLE_STORE = 'handles';
const HANDLE_KEY = 'folder';
// The SECOND destination. There is no cloud service in this app and no account
// to sign into — instead the teacher points this at the local folder his
// OneDrive / Google Drive / Dropbox desktop app already syncs, and that client
// does the uploading. Real off-this-machine protection, no OAuth, nothing to
// expire, and it keeps working if the school changes providers.
const CLOUD_KEY = 'cloudFolder';
const DAILY_KEY = 'lastDaily';
const LIVE_FILE = 'mrd-live-backup.json';
const DEBOUNCE_MS = 2000;

let dirHandle = null;     // FileSystemDirectoryHandle | null
let connected = false;    // handle present AND read-write permission granted
let cloudHandle = null;   // the synced-folder handle, or null
let cloudConnected = false;
let cloudLastSave = null;
let cloudError = null;
let lastSaveTs = 0;
let lastDownloadTs = 0;   // last daily safety-net download (see maybeDailyDownload)
let lastError = null;
let lastRestoreFile = null;   // which file restoreLatest() actually used
let lastDailyDate = null; // 'YYYY-MM-DD' of the most recent daily snapshot
let debounceTimer = null;
let initialized = false;
let subscribed = false;

// ---- helpers ---------------------------------------------------------------
function supported() {
  return typeof window !== 'undefined' && 'showDirectoryPicker' in window;
}
function pad(n) { return String(n).padStart(2, '0'); }
function dateStr(d = new Date()) { return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`; }

function stateText() {
  let obj;
  try {
    const raw = localStorage.getItem(CONFIG.STORAGE_KEY);
    obj = raw ? JSON.parse(raw) : store.getState();
  } catch (e) { obj = store.getState(); }
  return JSON.stringify({ ...obj, savedAt: new Date().toISOString() }, null, 2);
}

// ---- IndexedDB (handle persistence) — every op is failure-tolerant ---------
function openDb() {
  return new Promise((resolve, reject) => {
    try {
      const req = indexedDB.open(HANDLE_DB, 1);
      req.onupgradeneeded = () => req.result.createObjectStore(HANDLE_STORE);
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => reject(req.error);
    } catch (e) { reject(e); }
  });
}
async function idbGet(key) {
  try {
    const db = await openDb();
    return await new Promise((res, rej) => {
      const rq = db.transaction(HANDLE_STORE, 'readonly').objectStore(HANDLE_STORE).get(key);
      rq.onsuccess = () => { db.close(); res(rq.result); };
      rq.onerror = () => { db.close(); rej(rq.error); };
    });
  } catch (e) { console.warn('backup: idbGet failed', e); return undefined; }
}
async function idbPut(key, val) {
  try {
    const db = await openDb();
    await new Promise((res, rej) => {
      const t = db.transaction(HANDLE_STORE, 'readwrite');
      t.objectStore(HANDLE_STORE).put(val, key);
      t.oncomplete = () => { db.close(); res(); };
      t.onerror = () => { db.close(); rej(t.error); };
    });
  } catch (e) { console.warn('backup: idbPut failed (handle may be non-persistable)', e); }
}
async function idbDel(key) {
  try {
    const db = await openDb();
    await new Promise((res, rej) => {
      const t = db.transaction(HANDLE_STORE, 'readwrite');
      t.objectStore(HANDLE_STORE).delete(key);
      t.oncomplete = () => { db.close(); res(); };
      t.onerror = () => { db.close(); rej(t.error); };
    });
  } catch (e) { console.warn('backup: idbDel failed', e); }
}

// ---- permission + file IO --------------------------------------------------
async function verifyPermission(handle, withRequest) {
  if (!handle) return false;
  const opts = { mode: 'readwrite' };
  try {
    if ((await handle.queryPermission(opts)) === 'granted') return true;
    if (withRequest && (await handle.requestPermission(opts)) === 'granted') return true;
  } catch (e) { console.warn('backup: permission check failed', e); }
  return false;
}

async function writeFileInFolder(name, text) {
  const fh = await dirHandle.getFileHandle(name, { create: true });
  const writable = await fh.createWritable();
  await writable.write(text);
  await writable.close();
}

// ---- the uploaded files ------------------------------------------------------
// The JSON carries every SETTING and record; the teacher's uploaded FILES —
// lesson PDFs, slide images, intro songs, destination artwork — live in
// IndexedDB and never fitted in it. They are the one thing a restore could not
// bring back, which made "restore everything" untrue. They now ride along in a
// media/ subfolder beside the JSON, with a manifest naming each key.
//
// Deliberately written only when they CHANGE (a content hash of key+size+ts),
// because copying a term's worth of PDFs on every points award would grind.
// Per destination, so a change written locally still gets written off-site.
const lastMediaSig = { local: null, cloud: null };

// Copy every uploaded file into <target>/media, skipping anything already
// there at the same size. Returns { files, bytes, copied } — `copied` being
// what this run actually had to write, which is what makes the second and
// later runs cheap.
async function writeMediaInto(targetHandle, which) {
  if (!targetHandle) return { files: 0, bytes: 0, copied: 0 };
  let items = [];
  try { items = await media.list(''); } catch (e) { return { files: 0, bytes: 0, copied: 0 }; }
  const bytes = items.reduce((a, i) => a + (i.size || 0), 0);
  const sig = items.map((i) => `${i.key}:${i.size}:${i.ts}`).sort().join('|');
  if (sig && sig === lastMediaSig[which]) return { files: items.length, bytes, copied: 0 };

  const mediaDir = await targetHandle.getDirectoryHandle('media', { create: true });
  const manifest = [];
  let copied = 0;
  for (const it of items) {
    // A key is an arbitrary string ("potw:egypt:slide:003"); a filename is not.
    const safe = it.key.replace(/[^a-zA-Z0-9._-]/g, '_');
    manifest.push({ key: it.key, file: safe, name: it.name, type: it.type, size: it.size, ts: it.ts });
    try {
      const existing = await mediaDir.getFileHandle(safe).then((h) => h.getFile()).catch(() => null);
      if (existing && existing.size === it.size) continue;   // already there, unchanged
      const blob = await media.blob(it.key);
      if (!blob) continue;
      const fh = await mediaDir.getFileHandle(safe, { create: true });
      const w = await fh.createWritable();
      await w.write(blob);
      await w.close();
      copied += 1;
    } catch (e) { console.warn('backup: media write failed', it.key, e); }
  }
  const mh = await targetHandle.getFileHandle('mrd-media-manifest.json', { create: true });
  const mw = await mh.createWritable();
  await mw.write(JSON.stringify(manifest, null, 2));
  await mw.close();
  lastMediaSig[which] = sig;
  return { files: items.length, bytes, copied };
}

async function doWrite() {
  if (!connected || !dirHandle) return;
  try {
    if (!(await verifyPermission(dirHandle, false))) {
      connected = false;
      lastError = 'Folder permission was revoked — reconnect to resume auto-backup.';
      return;
    }
    const text = stateText();
    await writeFileInFolder(LIVE_FILE, text);
    await writeMediaInto(dirHandle, 'local');
    // rolling daily snapshot — write-once per calendar day
    const today = dateStr();
    if (lastDailyDate !== today) {
      await writeFileInFolder(`mrd-backup-${today}.json`, text);
      lastDailyDate = today;
      idbPut(DAILY_KEY, today);
    }
    lastSaveTs = Date.now();
    lastError = null;
  } catch (e) {
    lastError = (e && e.message) || String(e);
    console.warn('backup: write failed', e);
  }
}

function scheduleWrite() {
  if (!connected) return;
  if (debounceTimer) clearTimeout(debounceTimer);
  debounceTimer = setTimeout(() => { debounceTimer = null; doWrite(); }, DEBOUNCE_MS);
}

// ---- daily safety-net download ---------------------------------------------
// The folder backup above is better in every way EXCEPT the one that matters
// most here: it has to be set up, it needs a permission the browser drops
// between sessions, and it only exists in Chrome and Edge. A teacher who taps
// "Skip for now" once ends up with no backup at all and nothing telling him so.
//
// This is the floor under that. Once per school day, the first time he actually
// changes something, the state is downloaded as an ordinary file. No folder, no
// permission, no setup, and it works in every browser. Recovering means finding
// the newest mrd-backup-*.json in Downloads, which is a thing he can do without
// help — unlike anything involving a permission prompt.
//
// Deliberately fired from a store change rather than on load: a store change
// follows a tap, so there is fresh user activation and the browser treats it as
// a download the user asked for. A download on a cold page load is the kind
// browsers block, and it would also fire on days he only glances at the board.
const DL_KEY = 'mrd-last-download';
let lastDownloadDate = null;
try { lastDownloadDate = localStorage.getItem(DL_KEY); } catch (e) { lastDownloadDate = null; }

function downloadEnabled() {
  try { return store.getSettings().backupDownload !== false; } catch (e) { return true; }
}

// Cheap proxy for "the teacher has put work into this". Deliberately generous:
// a spurious backup costs one small file in Downloads, a missing one costs a day.
function hasAnythingWorthKeeping() {
  try {
    const st = store.getState();
    if ((st.transactions || []).length > 0) return true;
    if ((st.planner?.events || []).length > 0) return true;
    if (Object.keys(st.quests?.active || {}).length > 0) return true;
    if ((st.quests?.completed || []).length > 0) return true;
    if (Object.keys(st.inventory || {}).length > 0) return true;
    // A profile the teacher wrote, rather than the two that ship.
    const profiles = Object.keys(st.potw?.profiles || {});
    if (profiles.some((k) => k !== 'mesopotamia' && k !== 'egypt')) return true;
    if (Object.keys(st.settings?.houses || {}).length > 0) return true;
    return false;
  } catch (e) { return false; }
}

function maybeDailyDownload() {
  if (!downloadEnabled()) return;
  const today = dateStr();
  if (lastDownloadDate === today) return;
  // Nothing worth saving yet — don't hand him an empty file on a fresh install.
  // But "worth saving" is not only points: an afternoon spent building quests,
  // planning the term or writing a Place of the Week is a day's work that used
  // to get no backup at all, because the ledger happened to be untouched.
  if (!hasAnythingWorthKeeping()) return;
  // Claim the day BEFORE writing. If the download throws, we still don't retry
  // on every subsequent keystroke — one attempt per day, win or lose.
  lastDownloadDate = today;
  try { localStorage.setItem(DL_KEY, today); } catch (e) { /* storage full — the banner covers it */ }
  const filename = `mrd-backup-${today}.json`;
  try {
    const blob = new Blob([stateText()], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = filename;
    a.style.display = 'none';
    document.body.appendChild(a);
    a.click();
    // Revoke late: revoking synchronously can cancel the download in some builds.
    setTimeout(() => { try { URL.revokeObjectURL(url); a.remove(); } catch (e) {} }, 30000);
    lastDownloadTs = Date.now();
    // FIX-PLAN 5.6: this is a mechanical event (a file lands in Downloads with
    // nobody watching) unless something says so. shell.js is lead-owned for
    // toasts, so this file just announces the fact — a plain DOM CustomEvent,
    // no import either way — and shell.js decides how to say it.
    try {
      if (typeof window !== 'undefined') {
        window.dispatchEvent(new CustomEvent('mrd:backup-download', { detail: { filename } }));
      }
    } catch (e) { /* the download already succeeded; a toast is not worth failing over */ }
  } catch (e) {
    console.warn('backup: daily download failed', e);
  }
}

function ensureSubscribed() {
  if (subscribed) return;
  subscribed = true;
  try {
    store.subscribe(() => { scheduleWrite(); maybeDailyDownload(); });
  } catch (e) { console.warn('backup: subscribe failed', e); }
}

// ---- boot (self-init on first import) --------------------------------------
async function boot() {
  if (initialized) return;
  initialized = true;
  // SUBSCRIBE FIRST, ALWAYS. This used to sit below the supported() check, so on
  // any browser without showDirectoryPicker — Firefox, Safari — the daily
  // safety-net download never ran, while backup.health() and the shell's cloud
  // tooltip both went on promising "a backup file is saved to your Downloads
  // once a day". The folder autosave genuinely needs the File System Access
  // API; the daily download does not, and works everywhere.
  ensureSubscribed();                // subscribe even before a folder is chosen
  if (!supported()) return;          // folder autosave degrades; the download does not
  try {
    lastDailyDate = (await idbGet(DAILY_KEY)) || null;
    const handle = await idbGet(HANDLE_KEY);
    if (handle) {
      dirHandle = handle;
      // Re-check permission WITHOUT prompting (prompting needs a user gesture).
      connected = await verifyPermission(handle, false);
      if (!connected) lastError = 'Reconnect the backup folder to resume auto-saving.';
    }
    const ch = await idbGet(CLOUD_KEY);
    if (ch) {
      cloudHandle = ch;
      cloudConnected = await verifyPermission(ch, false);
      if (!cloudConnected) cloudError = 'Reconnect the off-site folder to resume copying.';
    }
  } catch (e) { console.warn('backup: boot failed', e); }
}
boot();

// ---- public API ------------------------------------------------------------
export const backup = {
  async connectFolder() {
    if (!supported()) { lastError = 'unsupported'; return false; }
    try {
      // If we already have a handle that only lost permission, re-request it.
      if (dirHandle && !connected) {
        if (await verifyPermission(dirHandle, true)) {
          connected = true;
          await writeNow();
          return true;
        }
      }
      const handle = await window.showDirectoryPicker({ mode: 'readwrite', id: 'mrd-backup' });
      if (!(await verifyPermission(handle, true))) { lastError = 'Permission to write the folder was denied.'; return false; }
      dirHandle = handle;
      connected = true;
      lastDailyDate = null;             // ensure today's snapshot lands in the new folder
      await idbPut(HANDLE_KEY, handle);
      await writeNow();
      return true;
    } catch (e) {
      if (e && e.name === 'AbortError') return false;   // user cancelled the picker
      lastError = (e && e.message) || String(e);
      console.warn('backup: connect failed', e);
      return false;
    }
  },

  async disconnect() {
    if (debounceTimer) { clearTimeout(debounceTimer); debounceTimer = null; }
    dirHandle = null;
    connected = false;
    lastError = null;
    await idbDel(HANDLE_KEY);
    return true;
  },

  status() {
    return {
      lastRestoreFile,
      supported: supported(),
      connected,
      hasHandle: !!dirHandle,
      needsPermission: !!dirHandle && !connected,
      folderName: dirHandle ? dirHandle.name : '',
      lastSaveTs,
      lastError,
      downloadEnabled: downloadEnabled(),
      lastDownloadDate,
      lastDownloadTs,
    };
  },

  // ONE answer to "is his work safe?", for anything that has to show a light
  // rather than explain a subsystem. Levels, worst first:
  //   'none'   — nothing is protecting this data. Say so loudly.
  //   'daily'  — the safety-net download only: a day's work is the most at risk.
  //   'folder' — folder autosave running; seconds of exposure at worst.
  // 'attention' means it USED to work and has stopped, which is the state most
  // worth interrupting him for — he has every reason to think he is covered.
  health() {
    const s = backup.status();
    if (s.needsPermission || (s.lastError && s.lastError !== 'unsupported')) {
      return { level: 'attention', folder: s.connected,
        message: s.needsPermission
          ? `Reconnect the backup folder “${s.folderName}” to start saving again.`
          : 'Automatic backup has stopped. Open Admin → Settings to check it.' };
    }
    if (s.connected) return { level: 'folder', folder: true, message: `Saving to “${s.folderName}” after every change.` };
    if (s.downloadEnabled) {
      return { level: 'daily', folder: false,
        message: 'A backup file is saved to your Downloads once a day. Connect a folder for continuous backup.' };
    }
    return { level: 'none', folder: false,
      message: 'Nothing is backing up this computer. A term of house points could be lost.' };
  },

  // Manual trigger for the same safety-net file, so a teacher can take one on
  // demand — before a holiday, or to hand a copy to someone.
  downloadNow() {
    lastDownloadDate = null;
    try { localStorage.removeItem(DL_KEY); } catch (e) {}
    maybeDailyDownload();
    return lastDownloadTs;
  },

  async writeNow() { return writeNow(); },

  // Read the latest live backup from the folder and return the parsed state.
  // The CALLER validates the user's intent, applies via localStorage + reload.
  // Read the media/ folder back into IndexedDB. Runs after a JSON restore, so
  // a rebuilt machine gets the teacher's PDFs, slides and songs back rather
  // than a set of profiles pointing at files that no longer exist.
  // Returns { restored, missing } for the confirmation line.
  async restoreMedia() {
    if (!dirHandle) return { restored: 0, missing: 0 };
    let manifest = [];
    try {
      const fh = await dirHandle.getFileHandle('mrd-media-manifest.json', { create: false });
      manifest = JSON.parse(await (await fh.getFile()).text());
    } catch (e) { return { restored: 0, missing: 0 }; }
    if (!Array.isArray(manifest) || !manifest.length) return { restored: 0, missing: 0 };

    let mediaDir = null;
    try { mediaDir = await dirHandle.getDirectoryHandle('media', { create: false }); }
    catch (e) { return { restored: 0, missing: manifest.length }; }

    let restored = 0; let missing = 0;
    for (const it of manifest) {
      if (!it || !it.key || !it.file) continue;
      try {
        const fh = await mediaDir.getFileHandle(it.file, { create: false });
        const blob = await fh.getFile();
        const ok = await media.putRecord(it.key, blob, { name: it.name, type: it.type, size: it.size, ts: it.ts });
        if (ok) restored += 1; else missing += 1;
      } catch (e) { missing += 1; }
    }
    return { restored, missing };
  },

  // Is there a backup sitting in the folder right now? Used by the empty-board
  // rescue on boot, which must not restore anything without asking.
  async peekLatest() {
    if (!dirHandle) return null;
    try {
      if (!(await verifyPermission(dirHandle, false))) return null;
      const candidates = [LIVE_FILE, ...(await datedSnapshotNames())];
      for (const name of candidates) {
        try {
          const fh = await dirHandle.getFileHandle(name, { create: false });
          const file = await fh.getFile();
          const data = JSON.parse(await file.text());
          if (data && typeof data === 'object' && 'transactions' in data) {
            return { name, savedAt: data.savedAt || null, transactions: (data.transactions || []).length };
          }
        } catch (e) { /* try the next candidate */ }
      }
    } catch (e) { /* nothing readable */ }
    return null;
  },

  // ---- the second (off-site) copy ------------------------------------------
  async connectCloudFolder() {
    if (!supported()) { cloudError = 'unsupported'; return false; }
    try {
      const handle = await window.showDirectoryPicker({ id: 'mrd-cloud', mode: 'readwrite' });
      if (!(await verifyPermission(handle, true))) { cloudError = 'Permission denied.'; return false; }
      cloudHandle = handle;
      cloudConnected = true;
      cloudError = null;
      await idbPut(CLOUD_KEY, handle);
      await backup.writeCloudNow();
      return true;
    } catch (e) {
      if (e && e.name === 'AbortError') return false;   // the teacher closed the picker
      cloudError = (e && e.message) || String(e);
      return false;
    }
  },

  async disconnectCloudFolder() {
    cloudHandle = null; cloudConnected = false; cloudLastSave = null; cloudError = null;
    await idbDel(CLOUD_KEY);
  },

  // Write the state, a dated snapshot AND every uploaded file into the synced
  // folder. Copying media off-site is the owner's call (2026-07-31): a lesson
  // PDF is as hard to replace as the points beside it, so both travel. Only
  // changed files are written, so the first run is the expensive one and the
  // rest are nearly free — and the app now shows the size so nobody is
  // surprised by what their sync client is about to carry.
  async writeCloudNow() {
    if (!cloudHandle) { cloudError = 'No off-site folder chosen.'; return false; }
    try {
      if (!(await verifyPermission(cloudHandle, true))) {
        cloudConnected = false;
        cloudError = 'Permission to the off-site folder was refused.';
        return false;
      }
      const text = stateText();
      for (const name of [LIVE_FILE, `mrd-backup-${dateStr()}.json`]) {
        const fh = await cloudHandle.getFileHandle(name, { create: true });
        const w = await fh.createWritable();
        await w.write(text);
        await w.close();
      }
      await writeMediaInto(cloudHandle, 'cloud');
      cloudConnected = true;
      cloudLastSave = Date.now();
      cloudError = null;
      return true;
    } catch (e) {
      cloudError = (e && e.message) || String(e);
      return false;
    }
  },

  // What a backup actually weighs, so the teacher can see it before his sync
  // client does. Records are trivial; the uploaded files are the number that
  // matters on school wifi.
  async sizes() {
    let stateBytes = 0;
    try { stateBytes = new Blob([stateText()]).size; } catch (e) { stateBytes = 0; }
    let items = [];
    try { items = await media.list(''); } catch (e) { items = []; }
    const mediaBytes = items.reduce((a, i) => a + (i.size || 0), 0);
    return { stateBytes, mediaBytes, mediaFiles: items.length, totalBytes: stateBytes + mediaBytes };
  },

  cloudStatus() {
    return { supported: supported(), connected: cloudConnected, lastSave: cloudLastSave, lastError: cloudError };
  },

  async restoreLatest() {
    if (!dirHandle) { lastError = 'No backup folder connected.'; return null; }
    try {
      if (!(await verifyPermission(dirHandle, true))) { lastError = 'Folder permission denied.'; return null; }
      // The live file first, then the dated snapshots, newest first. This used
      // to read ONLY mrd-live-backup.json and report "no valid backup" while a
      // folder full of perfectly good mrd-backup-YYYY-MM-DD.json files sat
      // beside it — the one moment a teacher needs this to work is the moment
      // the live file is the thing that got damaged.
      const candidates = [LIVE_FILE, ...(await datedSnapshotNames())];
      let lastReason = 'No backup file found in the folder yet.';
      for (const name of candidates) {
        try {
          const fh = await dirHandle.getFileHandle(name, { create: false });
          const data = JSON.parse(await (await fh.getFile()).text());
          if (!data || typeof data !== 'object' || !('version' in data) || !('transactions' in data)) {
            lastReason = `${name} is not a valid backup.`;
            continue;
          }
          lastError = null;
          lastRestoreFile = name;      // so Admin can say WHICH file it used
          return data;
        } catch (e) {
          if (!(e && e.name === 'NotFoundError')) lastReason = `${name} could not be read.`;
        }
      }
      lastError = lastReason;
      return null;
    } catch (e) {
      lastError = (e && e.name === 'NotFoundError') ? 'No backup file found in the folder yet.' : ((e && e.message) || String(e));
      console.warn('backup: restore read failed', e);
      return null;
    }
  },
};

// Dated snapshots in the folder, newest first. Named mrd-backup-YYYY-MM-DD.json
// by maybeDailyDownload and doWrite, so a lexical sort is a date sort.
async function datedSnapshotNames() {
  const names = [];
  try {
    for await (const [name, handle] of dirHandle.entries()) {
      if (handle.kind === 'file' && /^mrd-backup-\d{4}-\d{2}-\d{2}\.json$/.test(name)) names.push(name);
    }
  } catch (e) { console.warn('backup: could not list the folder', e); }
  return names.sort().reverse();
}

async function writeNow() {
  if (debounceTimer) { clearTimeout(debounceTimer); debounceTimer = null; }
  await doWrite();
  return lastSaveTs;
}
