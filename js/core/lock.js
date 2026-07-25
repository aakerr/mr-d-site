// lock.js — a teacher PIN in front of the actions a student shouldn't take
// at an unattended smartboard: awarding points, confirming quests, and the
// Admin panel.
//
// HONEST SCOPE: this is a classroom deterrent, not security. Everything runs in
// the browser, so anyone who knows how to open developer tools can get past it.
// It stops the realistic problem — a student walking up and tapping — and that
// is what it is for. Student-facing actions (accepting a quest, buying a shop
// item, rolling the dice) are deliberately NOT locked; they're meant to happen
// at the board.
//
// Unlocking lasts for a while (default 15 minutes of inactivity) and is kept in
// sessionStorage, so a reload mid-lesson doesn't re-prompt but a new day does.
import { store } from './store.js';

const SESSION_KEY = 'mrd-unlocked-until';
const DEFAULT_MINUTES = 15;

// The PIN the setup fields start filled in with. It is only ever a SUGGESTION —
// the lock ships OFF (settings.lock.pinHash is empty) and nothing is gated until
// the teacher actively turns it on. Exported so Admin and the first-run wizard
// offer the same number instead of each hardcoding one.
export const DEFAULT_PIN = '0314';

let padOpen = null;   // the in-flight unlock promise, while the pad is showing

async function sha256(text) {
  try {
    const buf = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(`mrd:${text}`));
    return [...new Uint8Array(buf)].map((b) => b.toString(16).padStart(2, '0')).join('');
  } catch (e) {
    return `plain:${text}`;   // ancient browser — still gates the tap
  }
}

// No I/O/0/1 — this gets read off a screen and copied by hand.
function makeRecoveryCode() {
  const alphabet = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  const out = new Uint32Array(8);
  try { crypto.getRandomValues(out); } catch (e) { for (let i = 0; i < 8; i += 1) out[i] = Math.floor(Math.random() * 1e9); }
  return [...out].map((n) => alphabet[n % alphabet.length]).join('');
}

function cfg() {
  const s = store.getSettings?.() || {};
  const l = s.lock || {};
  return {
    pinHash: l.pinHash || '',
    // How many digits to expect, so the pad knows when the entry is complete.
    // Storing the length (not the PIN) is what lets a 6-digit PIN submit on the
    // 6th tap instead of failing on the 4th.
    len: Number(l.len) >= 4 ? Number(l.len) : 4,
    minutes: Number.isFinite(Number(l.minutes)) ? Number(l.minutes) : DEFAULT_MINUTES,
  };
}

export const lock = {
  // A PIN has been set, so protected actions are gated.
  isEnabled() { return !!cfg().pinHash; },

  isUnlocked() {
    if (!lock.isEnabled()) return true;
    try {
      const until = Number(sessionStorage.getItem(SESSION_KEY) || 0);
      return until > Date.now();
    } catch (e) { return false; }
  },

  // Slide the window forward while the teacher is actively working.
  touch() {
    if (!lock.isEnabled() || !lock.isUnlocked()) return;
    try { sessionStorage.setItem(SESSION_KEY, String(Date.now() + cfg().minutes * 60000)); } catch (e) {}
  },

  lockNow() {
    try { sessionStorage.removeItem(SESSION_KEY); } catch (e) {}
    window.dispatchEvent(new CustomEvent('lock:changed', { detail: { unlocked: false } }));
  },

  async setPin(pin) {
    const clean = String(pin || '').trim();
    if (clean.length < 4) return false;
    const prev = store.getSettings().lock || {};
    store.updateSettings({
      lock: {
        ...prev,
        pinHash: await sha256(clean),
        len: clean.length,
        // Kept in PLAIN TEXT on purpose. A forgotten PIN would otherwise lock
        // the teacher out of Admin — and therefore out of Backup & Restore,
        // the only in-app way to undo it. Because it is plain, it also appears
        // in every backup .json, so the way back in is "open your backup in a
        // text editor and read the code" rather than "open developer tools".
        // A student at the board can't reach it without the backup file.
        recovery: prev.recovery || makeRecoveryCode(),
      },
    });
    lock.touch();
    return true;
  },

  getRecoveryCode() { return (store.getSettings().lock || {}).recovery || ''; },

  // Clear the PIN using the recovery code, for a teacher who is locked out.
  recoverWithCode(code) {
    const want = lock.getRecoveryCode();
    const got = String(code || '').trim().toUpperCase().replace(/[^A-Z0-9]/g, '');
    if (!want || got !== want) return false;
    store.updateSettings({ lock: { ...(store.getSettings().lock || {}), pinHash: '' } });
    try { sessionStorage.removeItem(SESSION_KEY); } catch (e) {}
    return true;
  },

  async verify(pin) {
    const { pinHash } = cfg();
    if (!pinHash) return true;
    return (await sha256(String(pin || '').trim())) === pinHash;
  },

  // Turn the lock off entirely (requires the current PIN).
  async clearPin(currentPin) {
    if (!(await lock.verify(currentPin))) return false;
    store.updateSettings({ lock: { ...(store.getSettings().lock || {}), pinHash: '' } });
    try { sessionStorage.removeItem(SESSION_KEY); } catch (e) {}
    return true;
  },

  setMinutes(minutes) {
    const m = Math.max(1, Math.min(240, Math.round(Number(minutes) || DEFAULT_MINUTES)));
    store.updateSettings({ lock: { ...(store.getSettings().lock || {}), minutes: m } });
  },

  /**
   * Gate a teacher action. Resolves true when it may proceed.
   *   if (await lock.requireUnlock('award points')) { …do it… }
   * No PIN set, or already unlocked → resolves immediately.
   */
  requireUnlock(what = 'continue') {
    if (!lock.isEnabled() || lock.isUnlocked()) { lock.touch(); return Promise.resolve(true); }
    // One pad at a time: a second caller waits on the same answer rather than
    // stacking a second dialog on top of the first.
    if (padOpen) return padOpen;
    padOpen = new Promise((resolve) => { showPad(what, resolve); });
    return padOpen;
  },
};

// ---------------------------------------------------------------- the PIN pad
function showPad(what, resolve) {
  const host = document.getElementById('overlay-root') || document.body;
  const el = document.createElement('div');
  el.className = 'lock-pad-backdrop';
  el.innerHTML = `
    <div class="lock-pad" role="dialog" aria-modal="true" aria-label="Teacher PIN">
      <div class="lock-pad-title">🔒 Teacher PIN</div>
      <div class="lock-pad-sub">Enter your PIN to ${escapeHtml(what)}.</div>
      <div class="lock-pad-dots" data-dots></div>
      <div class="lock-pad-keys">
        ${[1,2,3,4,5,6,7,8,9].map((n) => `<button type="button" data-k="${n}">${n}</button>`).join('')}
        <button type="button" data-k="clear" class="lock-pad-alt">Clear</button>
        <button type="button" data-k="0">0</button>
        <button type="button" data-k="cancel" class="lock-pad-alt">Cancel</button>
      </div>
      <div class="lock-pad-err" data-err hidden>That PIN didn't match — try again.</div>
      <button type="button" class="lock-pad-forgot" data-forgot>Forgot your PIN?</button>
    </div>`;
  host.appendChild(el);

  let entry = '';
  const dots = el.querySelector('[data-dots]');
  const err = el.querySelector('[data-err]');
  const expect = cfg().len;
  const paint = () => { dots.textContent = '●'.repeat(entry.length).padEnd(Math.max(expect, entry.length), '·'); };
  paint();

  const done = (ok) => {
    el.remove();
    document.removeEventListener('keydown', onKey, true);
    padOpen = null;
    resolve(ok);
    window.dispatchEvent(new CustomEvent('lock:changed', { detail: { unlocked: ok } }));
  };

  const submit = async () => {
    if (await lock.verify(entry)) {
      try { sessionStorage.setItem(SESSION_KEY, String(Date.now() + cfg().minutes * 60000)); } catch (e) {}
      done(true);
    } else {
      err.hidden = false;
      entry = ''; paint();
      el.querySelector('.lock-pad').classList.add('shake');
      setTimeout(() => el.querySelector('.lock-pad')?.classList.remove('shake'), 400);
    }
  };

  const push = (d) => {
    if (entry.length >= expect) return;
    entry += d; paint(); err.hidden = true;
    if (entry.length >= expect) submit();   // complete — no extra "OK" tap needed
  };

  el.addEventListener('click', (e) => {
    if (e.target.closest('[data-forgot]')) { showRecovery(); return; }
    const b = e.target.closest('[data-k]');
    if (!b) { if (e.target === el) done(false); return; }
    const k = b.dataset.k;
    if (k === 'cancel') return done(false);
    if (k === 'clear') { entry = ''; paint(); err.hidden = true; return; }
    push(k);
  });

  // The way back in for a teacher who is locked out. The code lives in plain
  // text in every backup .json, so this needs no developer tools and loses no
  // data — unlike clearing the site, which loses the term.
  function showRecovery() {
    const pad = el.querySelector('.lock-pad');
    pad.innerHTML = `
      <div class="lock-pad-title">🔑 Forgotten PIN</div>
      <div class="lock-pad-sub">Open your most recent backup <b>.json</b> file in any text editor and search for <b>recovery</b>. Type the code here and the PIN is turned off — nothing else changes and no points are lost.</div>
      <input type="text" class="lock-pad-code" data-code autocomplete="off" spellcheck="false" placeholder="XXXXXXXX" aria-label="Recovery code" />
      <div class="lock-pad-keys lock-pad-keys-2">
        <button type="button" data-r="back" class="lock-pad-alt">← Back</button>
        <button type="button" data-r="go">Turn the PIN off</button>
      </div>
      <div class="lock-pad-err" data-rerr hidden>That code doesn't match the one in your backup.</div>
      <div class="lock-pad-note">No backup file? The PIN can only be cleared by clearing this browser's site data — which erases every point, quest and setting too. Ask whoever set this up before doing that.</div>`;

    const codeEl = pad.querySelector('[data-code]');
    const rerr = pad.querySelector('[data-rerr]');
    codeEl.focus();
    pad.addEventListener('click', (e2) => {
      const b = e2.target.closest('[data-r]');
      if (!b) return;
      if (b.dataset.r === 'back') { done(false); lock.requireUnlock(what); return; }
      if (lock.recoverWithCode(codeEl.value)) done(true);   // PIN is off; let the action through
      else { rerr.hidden = false; codeEl.select(); }
    });
  }

  // Capture phase + stopPropagation: while the pad is up, keys belong to it.
  // Otherwise 'M' would still hit the global mute shortcut behind the dialog.
  function onKey(e) {
    if (e.key === 'Escape') { e.stopPropagation(); return done(false); }
    if (e.key === 'Enter') { e.stopPropagation(); return submit(); }
    if (e.key === 'Backspace') { e.stopPropagation(); entry = entry.slice(0, -1); paint(); return; }
    if (/^[0-9]$/.test(e.key)) { e.stopPropagation(); return push(e.key); }
    e.stopPropagation();
  }
  document.addEventListener('keydown', onKey, true);
}

function escapeHtml(s) {
  return String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}
