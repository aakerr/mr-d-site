// storage.js — the ONE place key/value persistence happens.
//
// WHY THIS EXISTS: every setting, flag and the whole term's state is kept in
// the browser's localStorage. That is the single fact behind the empty-board
// risk — "clear browsing data" wipes it. The path off that is a desktop build
// where the same data lives in a plain file on disk, and this module is the
// seam that makes that a one-file change instead of a hunt through eight.
//
// THE CONTRACT — deliberately SYNCHRONOUS. localStorage is synchronous and the
// store reads it synchronously at load time; making this async would ripple
// through load() and every caller. So the API stays synchronous, and the
// desktop backend honours that by keeping an in-memory cache hydrated at boot
// and writing through to disk asynchronously behind it. A caller never waits.
//
// TWO BACKENDS:
//   • browser  — localStorage, exactly as before. Zero behaviour change.
//   • desktop  — window.classos.kv, a synchronous bridge the Electron preload
//                exposes over the file on disk (built in the desktop step;
//                absent today, so the browser path is what runs).
//
// Everything is failure-tolerant: a refused write (private mode, quota) is
// swallowed the same way the raw localStorage calls were, never thrown.

// Prefer the desktop bridge when it is present; fall back to localStorage.
// Detected once at module load — the environment does not change mid-session.
const bridge = (typeof window !== 'undefined' && window.classos && window.classos.kv) || null;

function lsGet(key) {
  try { return localStorage.getItem(key); } catch (e) { return null; }
}
function lsSet(key, val) {
  try { localStorage.setItem(key, val); return true; } catch (e) { return false; }
}
function lsRemove(key) {
  try { localStorage.removeItem(key); return true; } catch (e) { return false; }
}
function lsKeys() {
  const out = [];
  try { for (let i = 0; i < localStorage.length; i += 1) { const k = localStorage.key(i); if (k != null) out.push(k); } }
  catch (e) { /* none */ }
  return out;
}

export const storage = {
  // The string value for a key, or null if absent. Never throws.
  get(key) {
    if (bridge) { try { const v = bridge.get(key); return v == null ? null : v; } catch (e) { return null; } }
    return lsGet(key);
  },

  // Persist a string. Returns true on success, false if the store refused
  // (private mode, quota) — same silent tolerance the raw calls had.
  set(key, val) {
    if (bridge) { try { bridge.set(key, String(val)); return true; } catch (e) { return false; } }
    return lsSet(key, String(val));
  },

  remove(key) {
    if (bridge) { try { bridge.remove(key); return true; } catch (e) { return false; } }
    return lsRemove(key);
  },

  // Every key currently stored — used by the health check to find stray
  // corrupt-backup crumbs. Order is not guaranteed.
  keys() {
    if (bridge) { try { return bridge.keys() || []; } catch (e) { return []; } }
    return lsKeys();
  },
};
