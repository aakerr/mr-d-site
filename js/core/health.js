// health.js — "System check": live diagnostics written for a teacher, not a
// developer. Every check answers two questions: is this OK, and if not, what
// exactly should I do about it (one sentence, no jargon).
//
// Surfaced inside the Help overlay (js/core/help.js → "System check").
//
// HARD RULE: nothing in here may ever throw into the app. Each check is run
// inside its own try/catch; a check that blows up degrades to a neutral
// "couldn't check this" row instead of taking the panel (or the app) down.
//
// Owns no DOM. Returns plain data; help.js renders it.
import { store } from './store.js';
import { backup } from './backup.js';
import { media } from './media.js';

const LAST_BACKUP_KEY = 'mrd-last-backup-ts';   // our own key, never touched by the store
const DAY_MS = 86400000;
const STALE_BACKUP_DAYS = 7;
// localStorage is ~5 MB in every browser we target. Warn well before the wall,
// because the failure mode (a silent QuotaExceededError on save) is invisible.
const LS_BUDGET_BYTES = 5 * 1024 * 1024;

// ---------------------------------------------------------------------------
// small date helpers (local time, matching store.js conventions)
// ---------------------------------------------------------------------------
const pad = (n) => String(n).padStart(2, '0');
function dateStr(d = new Date()) { return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`; }
function addDays(str, n) {
  const d = new Date(str + 'T00:00:00');
  d.setDate(d.getDate() + n);
  return dateStr(d);
}
function mondayOf(d = new Date()) {
  const x = new Date(d);
  const day = (x.getDay() + 6) % 7;             // Monday = 0
  x.setHours(0, 0, 0, 0);
  x.setDate(x.getDate() - day);
  return dateStr(x);
}
function daysBetween(aStr, bStr) {
  return Math.round((new Date(bStr + 'T00:00:00') - new Date(aStr + 'T00:00:00')) / DAY_MS);
}
function friendlyDate(str) {
  try {
    return new Date(str + 'T00:00:00').toLocaleDateString(undefined, { weekday: 'long', month: 'long', day: 'numeric' });
  } catch (e) { return str; }
}
function agoLabel(ts) {
  const mins = Math.floor((Date.now() - ts) / 60000);
  if (mins < 1) return 'just now';
  if (mins < 60) return `${mins} minute${mins === 1 ? '' : 's'} ago`;
  const hrs = Math.floor(mins / 60);
  if (hrs < 24) return `${hrs} hour${hrs === 1 ? '' : 's'} ago`;
  const days = Math.floor(hrs / 24);
  return `${days} day${days === 1 ? '' : 's'} ago`;
}
function formatBytes(n) {
  if (!(n > 0)) return '0 KB';
  if (n < 1024 * 1024) return `${Math.round(n / 1024)} KB`;
  if (n < 1024 * 1024 * 1024) return `${(n / (1024 * 1024)).toFixed(1)} MB`;
  return `${(n / (1024 * 1024 * 1024)).toFixed(1)} GB`;
}

// ---------------------------------------------------------------------------
// last-successful-backup memory
//
// backup.js keeps `lastSaveTs` in a module variable, so it resets to 0 on every
// reload — which would make "your last backup was 9 days ago" impossible to
// detect. We mirror the timestamp into our own localStorage key whenever it
// advances, giving an honest "when did this browser last write a backup file".
// ---------------------------------------------------------------------------
let watchTimer = null;
let watching = false;

function readMirrored() {
  try { return Number(localStorage.getItem(LAST_BACKUP_KEY)) || 0; } catch (e) { return 0; }
}

function noteBackupTs() {
  try {
    const ts = Number(backup.status().lastSaveTs) || 0;
    if (ts > readMirrored()) localStorage.setItem(LAST_BACKUP_KEY, String(ts));
  } catch (e) { /* diagnostics must never break anything */ }
}

function lastBackupTs() {
  let live = 0;
  try { live = Number(backup.status().lastSaveTs) || 0; } catch (e) { live = 0; }
  return Math.max(live, readMirrored());
}

// Watch for successful writes. backup.js debounces ~2s after a store change, so
// we look 3.5s later. No permanent interval — this only ticks when data changes.
function initBackupWatch() {
  if (watching) return;
  watching = true;
  noteBackupTs();
  try {
    store.subscribe(() => {
      if (watchTimer) clearTimeout(watchTimer);
      watchTimer = setTimeout(() => { watchTimer = null; noteBackupTs(); }, 3500);
    });
  } catch (e) { console.warn('health: backup watch failed', e); }
}

// ---------------------------------------------------------------------------
// checks — each returns { id, level, title, detail, fix, action? }
//   level: 'ok' | 'warn' | 'unknown'
//   fix:   ONE sentence telling the teacher what to do. Omitted when level==='ok'.
//   action:{ label, run } — optional inline button (run may be async)
// ---------------------------------------------------------------------------

function checkBackup() {
  const s = backup.status();
  if (!s.supported) {
    return {
      id: 'backup', level: 'warn', title: 'Automatic backup to a folder',
      detail: 'This browser cannot save backup files to a folder on this computer. Only Chrome and Microsoft Edge can (on Windows, Mac and Chromebooks).',
      fix: 'Open the app in Google Chrome or Microsoft Edge, then connect a backup folder — everything still works in this browser, it just will not back itself up.',
    };
  }
  if (s.connected) {
    return {
      id: 'backup', level: 'ok', title: 'Automatic backup to a folder',
      detail: `Connected to the folder "${s.folderName || 'your backup folder'}". The app saves itself there a couple of seconds after every change, plus one dated snapshot each day.`,
    };
  }
  if (s.needsPermission) {
    return {
      id: 'backup', level: 'warn', title: 'Automatic backup to a folder',
      detail: `The app remembers your folder ("${s.folderName}") but the browser has dropped permission to write to it, so nothing is being saved right now.`,
      fix: 'Tap Reconnect folder below and pick the same folder again.',
      action: { label: 'Reconnect folder', run: () => backup.connectFolder() },
    };
  }
  return {
    id: 'backup', level: 'warn', title: 'Automatic backup to a folder',
    detail: 'No backup folder is connected. Everything you do lives only inside this browser on this computer — if the browser data is ever cleared, it is gone for good.',
    fix: 'Tap Connect backup folder below and pick somewhere safe, such as a Google Drive or OneDrive folder.',
    action: { label: 'Connect backup folder', run: () => backup.connectFolder() },
  };
}

function checkLastBackup() {
  const s = backup.status();
  if (!s.supported) {
    return { id: 'backup-age', level: 'unknown', title: 'Last backup', detail: 'Not available in this browser.', fix: '' };
  }
  const ts = lastBackupTs();
  if (!ts) {
    if (!s.connected) {
      return {
        id: 'backup-age', level: 'warn', title: 'Last backup',
        detail: 'This browser has never written a backup file.',
        fix: 'Connect a backup folder (see the check above) — the first backup is written the moment you do.',
      };
    }
    return {
      id: 'backup-age', level: 'ok', title: 'Last backup',
      detail: 'The folder is connected; the next change you make will be written to it within a couple of seconds.',
    };
  }
  const ageDays = (Date.now() - ts) / DAY_MS;
  if (ageDays > STALE_BACKUP_DAYS) {
    return {
      id: 'backup-age', level: 'warn', title: 'Last backup',
      detail: `The last backup this browser wrote was ${agoLabel(ts)}${s.connected ? '' : ', and the folder is no longer connected'}.`,
      fix: s.connected
        ? 'Award a point (or change anything) to trigger a fresh save, and check the file appears in your backup folder.'
        : 'Reconnect your backup folder so saving resumes.',
      action: s.connected ? { label: 'Save a backup now', run: () => backup.writeNow() } : null,
    };
  }
  return {
    id: 'backup-age', level: 'ok', title: 'Last backup',
    detail: `Saved ${agoLabel(ts)}${s.folderName ? ` to "${s.folderName}"` : ''}.`,
  };
}

function checkBackupError() {
  const s = backup.status();
  if (!s.lastError || s.lastError === 'unsupported') return null;
  return {
    id: 'backup-error', level: 'warn', title: 'Backup reported a problem',
    detail: String(s.lastError),
    fix: 'Reconnect your backup folder; if the message mentions permission, pick the same folder again when the browser asks.',
    action: { label: 'Reconnect folder', run: () => backup.connectFolder() },
  };
}

function checkMaps() {
  const loaded = !!(window.google && window.google.maps);
  const element = !!(window.customElements && window.customElements.get('gmp-map-3d'));
  if (loaded && element) {
    return {
      id: 'maps', level: 'ok', title: '3D map (Place of the Week)',
      detail: 'Google Maps 3D loaded successfully — the flight to this week\'s destination will work.',
    };
  }
  if (loaded && !element) {
    return {
      id: 'maps', level: 'unknown', title: '3D map (Place of the Week)',
      detail: 'Google Maps loaded but the 3D map is still starting up. This is usually fine a second or two after the app opens.',
      fix: 'Run this check again in a moment; if it stays like this, reload the page.',
    };
  }
  return {
    id: 'maps', level: 'warn', title: '3D map (Place of the Week)',
    detail: 'Google Maps 3D has not loaded, so Place of the Week will show a simple globe instead of flying to the destination. This almost always means no internet, or the school network is blocking Google Maps.',
    fix: 'Check the computer is online, then reload the page — everything else in the app works without internet.',
  };
}

async function checkPotwMedia() {
  const profiles = store.getPotwProfiles() || {};
  const broken = [];
  for (const [key, p] of Object.entries(profiles)) {
    const type = p && p.presentation && p.presentation.type;
    if (!type) continue;
    if (type === 'pdf') {
      const info = await media.info(`potw:${key}:slides.pdf`);
      if (!info) broken.push(p.title || key);
    } else if (type === 'images') {
      const info = await media.info(`potw:${key}:slide:001`);
      if (!info) broken.push(p.title || key);
    }
    // 'gslides' decks are a URL, not a stored file — nothing to verify here.
  }
  if (!broken.length) {
    return {
      id: 'potw-media', level: 'ok', title: 'Place of the Week presentations',
      detail: 'Every destination that says it has a presentation actually has the file stored.',
    };
  }
  const names = broken.map((n) => `"${n}"`).join(', ');
  return {
    id: 'potw-media', level: 'warn', title: 'Place of the Week presentations',
    detail: `${broken.length === 1 ? 'This destination says it has a presentation' : 'These destinations say they have a presentation'}, but the file is missing from this browser: ${names}. This happens after restoring a backup on a different computer — backups do not carry videos, PDFs or images.`,
    fix: 'Open 🗝️ Admin → Place of the Week, edit the destination named above, and upload the PDF again.',
  };
}

function checkPotwSchedule() {
  const profiles = store.getPotwProfiles() || {};
  const entries = Object.entries(profiles);
  if (!entries.length) {
    return {
      id: 'potw-schedule', level: 'warn', title: 'Place of the Week schedule',
      detail: 'There are no destinations set up at all.',
      fix: 'Open 🗝️ Admin → Place of the Week and add a destination.',
    };
  }
  const today = dateStr();
  const monday = mondayOf();
  const thisWeek = entries.filter(([, p]) => p.weekOf && p.weekOf <= today && today <= addDays(p.weekOf, 6));
  const unscheduled = entries.filter(([, p]) => !p.weekOf).map(([k, p]) => p.title || k);

  if (!thisWeek.length) {
    let fallback = '';
    try {
      const key = store.resolvePotwKey();
      fallback = (profiles[key] && profiles[key].title) || key || '';
    } catch (e) { fallback = ''; }
    return {
      id: 'potw-schedule', level: 'warn', title: 'Place of the Week schedule',
      detail: `No Place of the Week is scheduled for this week (the week of ${friendlyDate(monday)}).${fallback ? ` If you launch it, "${fallback}" will play instead.` : ''}${unscheduled.length ? ` ${unscheduled.length} destination${unscheduled.length === 1 ? ' has' : 's have'} no week set: ${unscheduled.map((n) => `"${n}"`).join(', ')}.` : ''}`,
      fix: `Open 🗝️ Admin → Place of the Week and set "Week of" to ${monday} on the destination you want this week.`,
    };
  }
  const name = thisWeek[0][1].title || thisWeek[0][0];
  return {
    id: 'potw-schedule', level: 'ok', title: 'Place of the Week schedule',
    detail: `"${name}" is scheduled for this week.${unscheduled.length ? ` (${unscheduled.length} other destination${unscheduled.length === 1 ? ' has' : 's have'} no week set — that is fine, they simply wait their turn.)` : ''}`,
  };
}

function checkTerm() {
  const s = store.getSettings();
  const info = store.getTermInfo();
  const start = s.termStart;
  const weeks = Number(s.termWeeks) || 9;
  if (!start || !/^\d{4}-\d{2}-\d{2}$/.test(start)) {
    return {
      id: 'term', level: 'warn', title: 'Term dates',
      detail: 'The term start date is missing or is not a real date, so "Week N of M" in the top bar cannot be trusted.',
      fix: 'Open 🗝️ Admin → ⚙️ Settings and set Term Start to the Monday your term begins.',
    };
  }
  const today = dateStr();
  const end = addDays(start, weeks * 7 - 1);
  const daysLeft = daysBetween(today, end);
  if (today < start) {
    return {
      id: 'term', level: 'ok', title: 'Term dates',
      detail: `Your ${weeks}-week term starts on ${friendlyDate(start)}.`,
    };
  }
  if (daysLeft < 0) {
    return {
      id: 'term', level: 'warn', title: 'Term dates',
      detail: `Your ${weeks}-week term ended on ${friendlyDate(end)}, ${Math.abs(daysLeft)} day${Math.abs(daysLeft) === 1 ? '' : 's'} ago. The top bar is stuck showing Week ${info.week} of ${weeks}.`,
      fix: 'Open 🗝️ Admin → ⚙️ Settings and set a new Term Start (the Monday the new term begins).',
    };
  }
  if (daysLeft <= 7) {
    return {
      id: 'term', level: 'warn', title: 'Term dates',
      detail: `Your ${weeks}-week term ends on ${friendlyDate(end)} — ${daysLeft === 0 ? 'today' : `in ${daysLeft} day${daysLeft === 1 ? '' : 's'}`}.`,
      fix: 'When it ends, open 🗝️ Admin → ⚙️ Settings and set the new Term Start so the week counter keeps up.',
    };
  }
  return {
    id: 'term', level: 'ok', title: 'Term dates',
    detail: `${info.label}. This term runs ${friendlyDate(start)} to ${friendlyDate(end)}.`,
  };
}

function checkStorage() {
  let bytes = 0;
  try {
    for (let i = 0; i < localStorage.length; i++) {
      const k = localStorage.key(i);
      const v = localStorage.getItem(k) || '';
      bytes += (k.length + v.length) * 2;    // UTF-16 in every browser we target
    }
  } catch (e) {
    return { id: 'storage', level: 'unknown', title: 'Storage space', detail: 'Could not measure how much space this app is using.', fix: '' };
  }
  const pct = Math.round((bytes / LS_BUDGET_BYTES) * 100);
  const txCount = (store.getState().transactions || []).length;
  const base = `Using about ${formatBytes(bytes)} of the roughly 5 MB this browser allows (${pct}%). That covers ${txCount} logged point change${txCount === 1 ? '' : 's'} plus your calendar, quests, shop and settings. Videos and PDFs are stored separately and do not count towards this.`;
  if (pct >= 80) {
    return {
      id: 'storage', level: 'warn', title: 'Storage space',
      detail: base,
      fix: 'Make sure your backup folder is connected, then start a fresh term in ⚙️ Settings — a new term start keeps the app fast and your old backup files keep the history.',
    };
  }
  return { id: 'storage', level: 'ok', title: 'Storage space', detail: base };
}

async function checkMediaStorage() {
  if (!(navigator.storage && navigator.storage.estimate)) return null;
  const est = await navigator.storage.estimate();
  if (!est || !est.usage) return null;
  const quota = est.quota || 0;
  const pct = quota ? Math.round((est.usage / quota) * 100) : 0;
  const detail = `Your uploaded videos, PDFs and images take up about ${formatBytes(est.usage)}${quota ? ` of the ${formatBytes(quota)} this computer offers (${pct}%)` : ''}.`;
  if (quota && pct >= 85) {
    return {
      id: 'media-storage', level: 'warn', title: 'Uploaded files (videos & PDFs)', detail,
      fix: 'Open 🗝️ Admin → Place of the Week and delete uploads from destinations you have already taught.',
    };
  }
  return { id: 'media-storage', level: 'ok', title: 'Uploaded files (videos & PDFs)', detail };
}

// ---------------------------------------------------------------------------
// runner
// ---------------------------------------------------------------------------
const CHECKS = [
  ['backup', checkBackup],
  ['backup-age', checkLastBackup],
  ['backup-error', checkBackupError],
  ['maps', checkMaps],
  ['potw-media', checkPotwMedia],
  ['potw-schedule', checkPotwSchedule],
  ['term', checkTerm],
  ['storage', checkStorage],
  ['media-storage', checkMediaStorage],
];

export const health = {
  formatBytes,

  initBackupWatch,

  // Runs every check. A check that throws becomes a neutral row — never an
  // exception, never a blank panel.
  async run() {
    const out = [];
    for (const [id, fn] of CHECKS) {
      try {
        const res = await fn();
        if (res) out.push(res);
      } catch (e) {
        console.warn('health: check failed', id, e);
        out.push({
          id, level: 'unknown', title: id,
          detail: 'This check could not run on this computer.',
          fix: 'Reload the page (hold Shift and click reload) and try again.',
        });
      }
    }
    return out;
  },

  // { ok, warn, unknown } counts — used for the Help button's warning dot.
  summarize(results) {
    const counts = { ok: 0, warn: 0, unknown: 0 };
    (results || []).forEach((r) => { counts[r.level] = (counts[r.level] || 0) + 1; });
    return counts;
  },
};
