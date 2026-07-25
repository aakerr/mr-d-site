// firstrun.js — the first-run setup wizard.
//
// Shown once, the very first time the app is opened in a browser, and again
// on demand from Help ("Run the setup wizard again"). One friendly screen per
// step, and a visible "Skip for now" on EVERY step — this must never stand
// between the teacher and a class that is already sitting down.
//
// The whole point of step 2 is to get a backup folder connected. Everything
// else here is a bonus; that one step is the difference between "I lost my
// term" and "I restored it in fifteen seconds".
//
// Owns exactly one element (#firstrun-root), removed completely on close.
import { store } from './store.js';
import { backup } from './backup.js';

const ROOT_ID = 'firstrun-root';

function esc(s) {
  return String(s == null ? '' : s).replace(/[&<>"']/g, (c) =>
    ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}

function nextMonday() {
  const d = new Date();
  const day = (d.getDay() + 6) % 7;          // Monday = 0
  if (day !== 0) d.setDate(d.getDate() + (7 - day));
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

// ---------------------------------------------------------------------------
// state
// ---------------------------------------------------------------------------
let rootEl = null;
let step = 0;
let keyHandler = null;
let busy = false;         // a folder picker is open
let termDraft = null;     // { termStart, termWeeks } while editing step 3
let savedTerm = false;

const TOTAL = 5;

function isOpen() { return !!(rootEl && rootEl.isConnected); }

// ---------------------------------------------------------------------------
// steps
// ---------------------------------------------------------------------------
function backupStatusHtml() {
  let s;
  try { s = backup.status(); } catch (e) { s = { supported: false }; }

  if (!s.supported) {
    return `
      <div class="fr-status fr-status-warn">
        <b>This browser can't do automatic backups.</b>
        Saving straight to a folder on your computer only works in <b>Google Chrome</b> and <b>Microsoft Edge</b>.
        Everything in the app still works here — it just won't back itself up.
        <div class="fr-status-fix">If you can, close this and open the app in Chrome or Edge, then run this setup again from <b>❓ Help</b>.</div>
      </div>`;
  }
  if (s.connected) {
    return `
      <div class="fr-status fr-status-ok">
        <b>✅ Connected — you're protected.</b>
        Backups are being written to <b>${esc(s.folderName || 'your folder')}</b>, a couple of seconds after every change, plus a dated snapshot once a day.
      </div>`;
  }
  if (s.needsPermission) {
    return `
      <div class="fr-status fr-status-warn">
        <b>Permission needed.</b> The app remembers your folder (<b>${esc(s.folderName)}</b>) but the browser has dropped permission to write to it.
        <div class="fr-status-fix">Tap the button below and pick the same folder again.</div>
      </div>`;
  }
  return `
    <div class="fr-status fr-status-warn">
      <b>⚠️ Not connected yet.</b> Right now, everything you do lives only inside this browser on this computer.
      <div class="fr-status-fix">If this browser's data is ever cleared, there is no way to get your points back. This takes about fifteen seconds to fix.</div>
    </div>`;
}

function stepWelcome() {
  return {
    eyebrow: 'Welcome',
    title: "Mr. D's Classroom OS",
    html: `
      <p class="fr-lede">This is the whole classroom on one screen: four houses, their points, your week, and a set of games to spend them on.</p>
      <p>You award points from the bar at the top and everything else follows — the standings, the Magic Shop, Battle Day, the weekly voyage to a place on the map, and the quests your classes take on. The calendar you plan in the Admin panel feeds the morning dashboard, so the board is right when students walk in. Nothing here needs an account and nothing leaves this computer.</p>
      <p>This setup takes about a minute. You can skip any part of it and come back later from <b>❓ Help</b>.</p>
    `,
    next: "Let's go",
  };
}

function stepBackup() {
  let s;
  try { s = backup.status(); } catch (e) { s = { supported: false, connected: false }; }
  const btnLabel = s.needsPermission ? 'Reconnect the folder' : 'Choose a backup folder';
  return {
    eyebrow: 'Step 2 of 5 — the important one',
    title: 'Protect your work',
    html: `
      <p class="fr-lede">Everything this app knows lives inside this browser, on this computer. There is no cloud account holding a copy.</p>
      <p>That keeps it private and fast, but it means one careless "clear browsing data" would take the whole term's points with it. So the app can save itself to a real folder on your computer instead — automatically, every time anything changes.</p>
      ${backupStatusHtml()}
      ${s.supported ? `
        <p class="fr-actions">
          <button type="button" class="fr-btn fr-btn-primary" data-fr-action="connect"${busy ? ' disabled' : ''}>${busy ? 'Waiting for you to pick a folder…' : (s.connected ? 'Change the folder' : btnLabel)}</button>
        </p>
        <p class="fr-tip">💡 Pick a folder inside <b>Google Drive</b> or <b>OneDrive</b> if you have one — then your backups sync off the computer as well.</p>
      ` : ''}
      <p class="fr-fineprint">Backups hold your points, calendar, quests, shop and settings. They do <b>not</b> hold uploaded videos or PDFs — those are too big, and you would upload them again on a new computer.</p>
    `,
    next: s.connected ? 'Next' : 'Next (I understand the risk)',
    nextWarn: !s.connected && s.supported,
  };
}

function stepTerm() {
  const s = (() => { try { return store.getSettings(); } catch (e) { return {}; } })();
  const draft = termDraft || { termStart: s.termStart || nextMonday(), termWeeks: s.termWeeks || 9 };
  return {
    eyebrow: 'Step 3 of 5',
    title: 'When does your term start?',
    html: `
      <p class="fr-lede">This drives the "Week 3 of 9" counter in the top bar and the term totals on the leaderboard.</p>
      <div class="fr-fields">
        <label class="fr-field">
          <span class="fr-flabel">Term starts (a Monday)</span>
          <input type="date" class="fr-input" value="${esc(draft.termStart)}" data-fr-term-start />
        </label>
        <label class="fr-field">
          <span class="fr-flabel">How many weeks?</span>
          <input type="number" min="1" max="52" class="fr-input" value="${esc(String(draft.termWeeks))}" data-fr-term-weeks />
        </label>
      </div>
      ${savedTerm ? '<div class="fr-status fr-status-ok"><b>✅ Saved.</b> The top bar has already updated.</div>' : ''}
      <p class="fr-actions"><button type="button" class="fr-btn fr-btn-primary" data-fr-action="save-term">Save these dates</button></p>
      <p class="fr-fineprint">You can change this whenever a new term starts — <b>🗝️ Admin → ⚙️ Settings → Term Timeline</b>. Changing it never deletes any points.</p>
    `,
    next: 'Next',
  };
}

function stepHouses() {
  let houses = [];
  try { houses = [1, 2, 3, 4].map((c) => store.HOUSES[c]).filter(Boolean); } catch (e) { houses = []; }
  return {
    eyebrow: 'Step 4 of 5',
    title: 'Your four houses',
    html: `
      <p class="fr-lede">One house per class period. Tap the big name in the middle of the top bar to switch between them.</p>
      <div class="fr-houses">
        ${houses.map((h) => `
          <div class="fr-house" style="--h:${esc(h.accent)}">
            <img src="${esc(h.image)}" alt="" class="fr-house-crest" onerror="this.style.display='none'" />
            <div class="fr-house-name">${esc(h.name)}</div>
            <div class="fr-house-motto">${esc(h.motto)}</div>
            <div class="fr-house-core">Core ${esc(String(h.core))}</div>
          </div>`).join('')}
      </div>
      <p>None of this is fixed. The crests and banners are ordinary picture files in the app's <code>images</code> folder — swap one out and the app picks it up. Names, mottos and colours can be changed too, and changing any of it never costs a house a single point.</p>
    `,
    next: 'Next',
  };
}

function stepDone() {
  return {
    eyebrow: 'All set',
    title: "You're ready",
    html: `
      <p class="fr-lede">Two things to remember, and then go and teach.</p>
      <ul class="fr-remember">
        <li><span class="fr-glyph">🗝️</span><div><b>The key, top right.</b> That is your Admin panel — the calendar, quests, the shop, the Place of the Week and all your settings. It is deliberately faint so students leave it alone.</div></li>
        <li><span class="fr-glyph">❓</span><div><b>The question mark, next to it.</b> That is the handbook: how to award points, how to undo a mistake, how to set up next week's destination, and a <b>System check</b> that tells you if anything needs attention.</div></li>
      </ul>
      <p class="fr-actions">
        <button type="button" class="fr-btn fr-btn-primary" data-fr-action="finish">Start using the app</button>
        <button type="button" class="fr-btn" data-fr-action="open-help">Open the handbook</button>
      </p>
    `,
    next: null,
  };
}

const STEPS = [stepWelcome, stepBackup, stepTerm, stepHouses, stepDone];

// ---------------------------------------------------------------------------
// rendering
// ---------------------------------------------------------------------------
function render() {
  if (!rootEl) return;
  const s = STEPS[step]();
  rootEl.innerHTML = `
    <div class="fr-backdrop"></div>
    <div class="fr-panel" role="dialog" aria-modal="true" aria-label="Setup">
      <div class="fr-head">
        <div class="fr-dots" aria-hidden="true">
          ${STEPS.map((_, i) => `<span class="fr-dot" data-on="${i <= step}"></span>`).join('')}
        </div>
        <button type="button" class="fr-skip" data-fr-action="skip">Skip for now</button>
      </div>
      <div class="fr-body">
        <div class="fr-eyebrow">${esc(s.eyebrow)}</div>
        <h2 class="fr-title">${esc(s.title)}</h2>
        ${s.html}
      </div>
      <div class="fr-foot">
        <button type="button" class="fr-btn fr-btn-ghost" data-fr-action="back"${step === 0 ? ' hidden' : ''}>← Back</button>
        <div class="fr-foot-spacer"></div>
        ${s.next ? `<button type="button" class="fr-btn ${s.nextWarn ? '' : 'fr-btn-primary'}" data-fr-action="next">${esc(s.next)}</button>` : ''}
      </div>
    </div>`;
}

// ---------------------------------------------------------------------------
// behaviour
// ---------------------------------------------------------------------------
function readTermDraft() {
  if (!rootEl) return;
  const startEl = rootEl.querySelector('[data-fr-term-start]');
  const weeksEl = rootEl.querySelector('[data-fr-term-weeks]');
  if (!startEl && !weeksEl) return;
  termDraft = {
    termStart: (startEl && startEl.value) || (termDraft && termDraft.termStart) || nextMonday(),
    termWeeks: Math.max(1, Math.min(52, Number(weeksEl && weeksEl.value) || 9)),
  };
}

function saveTerm() {
  readTermDraft();
  if (!termDraft) return;
  try {
    store.updateSettings({ termStart: termDraft.termStart, termWeeks: termDraft.termWeeks });
    savedTerm = true;
  } catch (e) { console.warn('firstrun: could not save term', e); }
  render();
}

function markDone() {
  try { store.updateSettings({ setupDone: true }); }
  catch (e) { console.warn('firstrun: could not persist setupDone', e); }
}

function goto(n) {
  // Leaving the term step keeps whatever was typed, even if "Save" wasn't tapped.
  if (step === 2) readTermDraft();
  step = Math.max(0, Math.min(STEPS.length - 1, n));
  savedTerm = false;
  render();
  const panel = rootEl && rootEl.querySelector('.fr-body');
  if (panel) panel.scrollTop = 0;
}

function onClick(e) {
  const btn = e.target.closest('[data-fr-action]');
  if (!btn) return;
  const what = btn.dataset.frAction;

  if (what === 'skip' || what === 'finish') { markDone(); close(); return; }
  if (what === 'back') { goto(step - 1); return; }
  if (what === 'next') {
    if (step >= STEPS.length - 1) { markDone(); close(); return; }
    goto(step + 1);
    return;
  }

  if (what === 'connect') {
    busy = true;
    render();
    Promise.resolve()
      .then(() => backup.connectFolder())
      .catch((err) => { console.warn('firstrun: connect failed', err); })
      .then(() => { busy = false; if (isOpen()) render(); });
    return;
  }

  if (what === 'save-term') { saveTerm(); return; }

  if (what === 'open-help') {
    markDone();
    close();
    // Dynamic import so firstrun ↔ help never form a static import cycle.
    import('./help.js')
      .then((m) => m.openHelp('cheat-sheet'))
      .catch((err) => console.warn('firstrun: could not open help', err));
  }
}

function onKeydown(e) {
  if (!isOpen()) return;
  if (e.key === 'Escape') { e.stopPropagation(); markDone(); close(); }
}

function close() {
  if (keyHandler) { document.removeEventListener('keydown', keyHandler, true); keyHandler = null; }
  if (rootEl) { rootEl.removeEventListener('click', onClick); rootEl.remove(); }
  rootEl = null;
  busy = false;
  termDraft = null;
  savedTerm = false;
}

function openWizard(atStep = 0) {
  if (isOpen()) return;
  step = atStep;
  rootEl = document.createElement('div');
  rootEl.id = ROOT_ID;
  rootEl.addEventListener('click', onClick);
  document.body.appendChild(rootEl);
  keyHandler = onKeydown;
  document.addEventListener('keydown', keyHandler, true);
  render();
}

// ---------------------------------------------------------------------------
// public API
// ---------------------------------------------------------------------------

/** Open the wizard on demand (Help → "Run the setup wizard again"). */
export function startSetup() { openWizard(0); }

/** True when this browser has never been through (or skipped) setup. */
export function needsSetup() {
  try { return !store.getSettings().setupDone; } catch (e) { return false; }
}

/**
 * Called once at boot from shell.js. Shows the wizard only if setup has never
 * been completed OR skipped. Wrapped so a failure here can never stop the app
 * from starting.
 */
export function maybeRunFirstRun() {
  try {
    if (!needsSetup()) return false;
    // One frame's delay so the dashboard is painted behind the wizard — it
    // reads as "here is your app, plus a hand getting started", not a gate.
    setTimeout(() => { try { openWizard(0); } catch (e) { console.warn('firstrun: open failed', e); } }, 350);
    return true;
  } catch (e) {
    console.warn('firstrun: skipped', e);
    return false;
  }
}

export const firstrun = { start: startSetup, needsSetup, maybeRun: maybeRunFirstRun };
