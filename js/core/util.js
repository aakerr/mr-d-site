// =============================================================================
// util.js — small helpers duplicated (byte-identically) across the modules
// =============================================================================
// Not every duplicate in the app belongs here. This file holds only the ones
// that were verified to have the exact same contract everywhere they lived:
// a 'YYYY-MM-DD' string family built on the same local-time rules, a
// reduced-motion check, and the later()/timer-Set pattern every screen uses
// to track its own setTimeouts so unmount can sweep them.
//
// NOT here, on purpose: `addDays` exists in two places (store.js, admin.js)
// with the SAME NAME but DIFFERENT CONTRACTS — store's takes/returns a
// 'YYYY-MM-DD' string, admin's takes/returns a Date. Unifying them behind one
// name would silently break whichever call sites expect the other shape, so
// both stay put; each carries a comment pointing at this warning. Likewise
// `parseYMD` (admin.js only, not duplicated) and the escaper family
// (js/core/escape.js) are out of scope for this file.

// ---- 'YYYY-MM-DD' string family, LOCAL time -------------------------------
// Deliberately not toISOString(), which converts to UTC first and so reports
// the wrong day either side of midnight for anyone west of Greenwich — this
// app deals in school days, not instants.
export function pad(n) { return String(n).padStart(2, '0'); }

export function ymd(d) {
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

export function todayStr() { return ymd(new Date()); }

// ---- reduced motion ---------------------------------------------------------
export function prefersReducedMotion() {
  return !!(window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches);
}

// ---- later()/timer-Set lifecycle -------------------------------------------
// Every screen module tracks its own setTimeouts in a module-scoped Set so
// unmount can cancel anything still pending instead of leaking a callback
// into a torn-down DOM. `tag` is just the console.warn prefix, so a thrown
// callback still reads "battle: …" / "shop: …" / "admin: …" as before.
export function makeTimerSet(tag) {
  const timers = new Set();
  function later(fn, ms) {
    const id = setTimeout(() => {
      timers.delete(id);
      try { fn(); } catch (e) { console.warn(`${tag}:`, e); }
    }, ms);
    timers.add(id);
    return id;
  }
  function clearTimers() { timers.forEach(clearTimeout); timers.clear(); }
  return { timers, later, clearTimers };
}
