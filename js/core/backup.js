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

const HANDLE_DB = 'mrd-backup';
const HANDLE_STORE = 'handles';
const HANDLE_KEY = 'folder';
const DAILY_KEY = 'lastDaily';
const LIVE_FILE = 'mrd-live-backup.json';
const DEBOUNCE_MS = 2000;

let dirHandle = null;     // FileSystemDirectoryHandle | null
let connected = false;    // handle present AND read-write permission granted
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
  try {
    const blob = new Blob([stateText()], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `mrd-backup-${today}.json`;
    a.style.display = 'none';
    document.body.appendChild(a);
    a.click();
    // Revoke late: revoking synchronously can cancel the download in some builds.
    setTimeout(() => { try { URL.revokeObjectURL(url); a.remove(); } catch (e) {} }, 30000);
    lastDownloadTs = Date.now();
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
