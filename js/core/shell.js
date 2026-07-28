// shell.js — persistent Classroom OS shell: top bar (brand/home, core
// switcher, quick-points trigger, term/date tracker, subtle teacher admin
// glyph) + its quick-points dropdown panel. Owns #topbar and #fab-root only.
// Reactive via store.subscribe(); never mutates state directly (all point
// changes go through store.addPoints). The brand ("MR. D'S CLASSROOM") is
// the home button — there is no separate Home control.
//
// Quick points live entirely in the top bar now: a small "±" trigger button
// sits left of the date/term block, and tapping it opens a dropdown panel
// anchored top-right, below the bar (#fab-root hosts only the panel + point
// toasts — it has no permanently-visible circle anymore). This replaces the
// earlier bottom-right floating action button, which the teacher reported
// as overlapping module content.

import { maybeRunFirstRun } from './firstrun.js';
import { health } from './health.js';
import { lock } from './lock.js';
import { backup } from './backup.js';
import { prefersReducedMotion } from './util.js';

const NEUTRAL_ACCENT = '#f59e0b';
const NEUTRAL_ACCENT_SOFT = 'rgba(245,158,11,0.35)';

// A couple of small rules the shared theme.css doesn't carry, injected here
// the same way dashboard.js injects its own STYLE block: owned by the module
// that uses them, never duplicated into theme.css.
const SHELL_STYLE_ID = 'shell-extra-styles';
const SHELL_STYLE = `
/* 7.2 — the "saved ✓" pulse on the backup cloud button. */
@keyframes shell-saved-fade {
  0%   { opacity: 0; transform: scale(0.75); }
  18%  { opacity: 1; transform: scale(1); }
  70%  { opacity: 1; transform: scale(1); }
  100% { opacity: 0; transform: scale(1); }
}
.shell-saved-pulse {
  position: absolute; top: -3px; right: -3px;
  width: 17px; height: 17px; border-radius: 999px;
  background: #16a34a; color: #fff; font: 800 11px/17px system-ui, sans-serif;
  text-align: center; pointer-events: none;
  animation: shell-saved-fade 1.5s ease both;
}
.shell-saved-pulse-static { animation: none; opacity: 1; }

/* FIX-PLAN 5.5 — quiet mode's in-app twin of theme.css's OS-level
   "@media (prefers-reduced-motion: reduce)" rule, gated on the <html
   data-quiet> attribute applyThemeSettings() sets instead of an OS setting —
   same freeze, same universal selector, so it reaches every animation in
   the app (this file's seasonal particles included) with no other module
   needing to know quiet mode exists. */
html[data-quiet] *, html[data-quiet] *::before, html[data-quiet] *::after {
  animation-duration: 0.001ms !important;
  animation-iteration-count: 1 !important;
  transition-duration: 0.001ms !important;
  scroll-behavior: auto !important;
}
`;
function ensureShellStyle() {
  if (document.getElementById(SHELL_STYLE_ID)) return;
  const s = document.createElement('style');
  s.id = SHELL_STYLE_ID;
  s.textContent = SHELL_STYLE;
  document.head.appendChild(s);
}

// Shared width expression for the center house-pill — hoisted so both
// renderTopbar() (which positions the pill itself, plus the mute and ±
// triggers flanking it) and the backup-status trigger/popover (added beside
// the mute button) can anchor off the exact same value.
const PILL_WIDTH_EXPR = 'min(30.6rem,44vw)';

// True when anything is filling the screen. Also covers the installed-app case:
// a window opened from the manifest has no tab strip or address bar to hide, so
// the button reads as "already filling the board" and offers nothing to undo.
function isFullscreen() {
  try {
    if (document.fullscreenElement) return true;
    return window.matchMedia && window.matchMedia('(display-mode: standalone)').matches;
  } catch (e) { return false; }
}

function hexToRgbTriplet(hex) {
  const m = /^#?([a-f\d]{2})([a-f\d]{2})([a-f\d]{2})$/i.exec(hex || '');
  if (!m) return '245,158,11';
  return [1, 2, 3].map((i) => parseInt(m[i], 16)).join(',');
}

function formatToday() {
  try {
    return new Intl.DateTimeFormat('en-US', { weekday: 'short', month: 'short', day: 'numeric', year: 'numeric' }).format(new Date());
  } catch (e) { return ''; }
}

// Lucide-style calendar glyph, authored inline (no asset) — 22-24px,
// stroke currentColor so it inherits whatever muted text color it sits in.
const CALENDAR_ICON_SVG = `
  <svg class="date-cal-icon w-[22px] h-[22px] sm:w-6 sm:h-6 shrink-0" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
    <rect width="18" height="18" x="3" y="4" rx="2" ry="2"></rect>
    <line x1="16" y1="2" x2="16" y2="6"></line>
    <line x1="8" y1="2" x2="8" y2="6"></line>
    <line x1="3" y1="10" x2="21" y2="10"></line>
  </svg>
`;

function housesByCore(store) {
  return [1, 2, 3, 4].map((c) => store.HOUSES[c]).filter(Boolean);
}

// ---------------------------------------------------------------------------
// Sound gate
//
// `settings.soundEnabled` is the master switch, flipped by the speaker button
// in the top bar. js/core/audio.js is lead-owned, so rather than edit it we
// wrap the shared `audio` singleton here — every module receives the same
// object via ctx, so wrapping it once covers the whole app.
//
// LEAD: once audio.js honours the setting itself, this wrapper becomes
// redundant (it is idempotent and double-guarding is harmless, but you can
// delete it). See the handover note for the exact audio.js patch.
//
// play() is MUTED rather than suppressed on purpose: potw.js waits on the
// returned element's 'ended' event to advance the voyage, so returning nothing
// would strand the Place of the Week cinematic on its intro screen forever.
function applySoundGate(audio, store) {
  if (!audio || audio.__mrdSoundGated) return;
  audio.__mrdSoundGated = true;

  const soundOn = () => {
    try { return store.getSettings().soundEnabled !== false; } catch (e) { return true; }
  };

  ['sfx', 'say'].forEach((name) => {
    const fn = audio[name];
    if (typeof fn !== 'function') return;
    audio[name] = function gated(...args) { return soundOn() ? fn.apply(audio, args) : undefined; };
  });

  const play = audio.play;
  if (typeof play === 'function') {
    audio.play = function gatedPlay(src, opts = {}) {
      return play.call(audio, src, soundOn() ? opts : { ...opts, volume: 0 });
    };
  }
}

// Guard against double-initialization (e.g. if boot code ever calls this
// twice) — re-wiring listeners on top of listeners would double-fire clicks.
let initialized = false;

export function initShell(ctx) {
  const topbarRoot = document.getElementById('topbar');
  const fabRoot = document.getElementById('fab-root');
  if (!topbarRoot || !fabRoot) return; // shell DOM not present — stay silent

  const { store, registry, audio } = ctx || {};
  if (!store || !registry) return;

  if (initialized) {
    try { window.__mrdShellRerender && window.__mrdShellRerender(); } catch (e) { /* noop */ }
    return;
  }
  initialized = true;
  ensureShellStyle();

  // Make the speaker toggle actually silence things today (see applySoundGate).
  try { applySoundGate(audio, store); } catch (e) { console.warn('shell: sound gate failed', e); }

  // ---------------- shared: live accent CSS vars ----------------
  // Reads the module-scoped `currentModuleId` declared further down, so the
  // accent can follow the teacher's per-screen colour instead of the house.
  function applyAccentVars() {
    let house = null;
    try { house = store.getActiveHouse(); } catch (e) { house = null; }
    let accent = house ? house.accent : NEUTRAL_ACCENT;
    let soft = house ? house.accentSoft : NEUTRAL_ACCENT_SOFT;

    // A screen set to its own colour keeps it whichever house is active; one
    // set to "match house" behaves exactly as the app always did. Screens with
    // baked-in palettes report matchHouse and fall through untouched.
    try {
      const t = store.getModuleTheme(currentModuleId);
      if (t && t.configurable && !t.matchHouse && t.color) {
        accent = t.color;
        soft = `rgba(${hexToRgbTriplet(t.color)},0.35)`;
      }
    } catch (e) { /* a theme lookup must never cost us the accent */ }

    const root = document.documentElement;
    root.style.setProperty('--accent', accent);
    root.style.setProperty('--accent-soft', soft);
    root.style.setProperty('--accent-rgb', hexToRgbTriplet(accent));
  }

  // ---------------- shared: teacher theme settings (mode + seasonal) ----------------
  const SEASON_EMOJI = { fall: '🍂', winter: '❄️', spring: '🌸', summer: '☀️' };
  let seasonFxRoot = null;
  let currentSeason = null; // last-applied season, so we don't churn the DOM every store tick

  function ensureSeasonFxRoot() {
    if (seasonFxRoot && seasonFxRoot.isConnected) return seasonFxRoot;
    seasonFxRoot = document.createElement('div');
    seasonFxRoot.id = 'season-fx-root';
    seasonFxRoot.setAttribute('aria-hidden', 'true');
    document.body.appendChild(seasonFxRoot);
    return seasonFxRoot;
  }

  // A handful of slow, near-invisible drifting emoji — purely ambient, never
  // interactive (pointer-events:none in CSS) and reduced-motion-safe (the
  // global prefers-reduced-motion rule in theme.css freezes .season-particle
  // like every other animation).
  function renderSeasonParticles(season) {
    if (season === currentSeason) return;
    currentSeason = season;
    const root = ensureSeasonFxRoot();
    root.innerHTML = '';
    const emoji = season && SEASON_EMOJI[season];
    if (!emoji) return;
    const COUNT = 6;
    for (let i = 0; i < COUNT; i++) {
      const span = document.createElement('span');
      span.className = 'season-particle';
      span.textContent = emoji;
      const left = Math.max(2, Math.min(96, Math.round((i / COUNT) * 100 + (Math.random() * 8 - 4))));
      const dur = 18 + Math.random() * 10;
      span.style.left = `${left}%`;
      span.style.fontSize = `${14 + Math.random() * 10}px`;
      span.style.animationDuration = `${dur}s`;
      span.style.animationDelay = `${-(Math.random() * dur)}s`;
      root.appendChild(span);
    }
  }

  function seasonForDate(d = new Date()) {
    const m = d.getMonth(); // 0=Jan … 11=Dec
    if (m >= 8 && m <= 10) return 'fall';   // Sep–Nov
    if (m === 11 || m <= 1) return 'winter'; // Dec–Feb
    if (m >= 2 && m <= 4) return 'spring';   // Mar–May
    return 'summer';                          // Jun–Aug
  }

  function applyThemeSettings() {
    let settings = null;
    try { settings = store.getSettings(); } catch (e) { settings = null; }
    const theme = (settings && settings.theme) || { mode: 'dark', seasonal: false };
    document.documentElement.dataset.mode = theme.mode === 'light' ? 'light' : 'dark';

    // FIX-PLAN 5.5 — projector-safe quiet mode. The `data-quiet` attribute on
    // <html> mirrors theme.css's `@media (prefers-reduced-motion: reduce)`
    // rule (see SAVED_PULSE_STYLE's sibling below) app-wide, so every CSS
    // animation in the app freezes on this app-level switch the same way it
    // already does on the OS-level one — not just the seasonal particles,
    // though those are the one thing this file renders itself and so get an
    // extra belt-and-braces check just below.
    let quiet = false;
    try { quiet = store.getQuietMode(); } catch (e) { quiet = false; }
    document.documentElement.toggleAttribute('data-quiet', quiet);

    if (theme.seasonal && !quiet) {
      const season = seasonForDate();
      document.documentElement.dataset.season = season;
      renderSeasonParticles(season);
    } else {
      delete document.documentElement.dataset.season;
      renderSeasonParticles(null);
    }
  }

  // ---------------- global mute shortcut ----------------
  // The sound and help icons were removed from the bar to save space, so this
  // is the fast way to silence everything (ambient loops especially) without
  // hunting through Admin. Ignored while typing.
  function onGlobalKey(e) {
    if (e.key !== 'm' && e.key !== 'M') return;
    if (e.metaKey || e.ctrlKey || e.altKey) return;
    const t = e.target;
    if (t && (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA' || t.tagName === 'SELECT' || t.isContentEditable)) return;
    try {
      const on = store.getSettings().soundEnabled !== false;
      store.updateSettings({ soundEnabled: !on });
      if (on) { try { audio.stopAll(); } catch (err) {} }
    } catch (err) { /* never break the app over a shortcut */ }
  }
  document.addEventListener('keydown', onGlobalKey);

  // ================= TOP BAR =================
  let coreMenuOpen = false;
  let currentModuleId = null;

  // Admin-glyph long-press: holding the key down while unlocked re-locks
  // immediately (mirrors the shift-click below). adminLongPressFired is a
  // one-shot flag so the click that follows the press-and-release doesn't
  // ALSO navigate into Admin.
  let adminLongPressTimer = null;
  let adminLongPressFired = false;
  const ADMIN_LONG_PRESS_MS = 550;
  function clearAdminLongPress() {
    if (adminLongPressTimer) { clearTimeout(adminLongPressTimer); adminLongPressTimer = null; }
  }

  // ---------------- backup status trigger + popover ----------------
  // A small control beside the sound button so a stopped/absent auto-backup
  // is somewhere the teacher can't help but see, without ever nagging while
  // things are fine (backup.health() level 'folder' renders nothing at all).
  // Every call into backup.js is wrapped: a thrown health()/status() must
  // never take the whole top bar down with it.
  let backupPanelOpen = false;
  let backupPanelClosing = false;

  // ---------------- 7.2: "saved ✓" pulse on the cloud button ----------------
  // The cloud button shows nothing at all once backup is fully healthy
  // (bHealth.level === 'folder', see backupBtnHtml below) — right, for a
  // steady state, but it left a teacher with zero positive feedback that
  // anything was ever actually saved. This adds a one-shot ✓ that appears and
  // fades whenever a transaction lands AND it genuinely reached disk.
  let savedPulseUntil = 0;     // Date.now() the ✓ has fully faded by
  let savedPulseFiredAt = 0;   // throttle clock — see the 5s guard below
  let savedPulseTimer = null;  // forces one more paint so the ✓ actually clears
  let lastTxCount = null;      // baseline for "did a transaction just land?"

  function maybeTriggerSavedPulse() {
    let txCount = null;
    try { txCount = (store.getState().transactions || []).length; } catch (e) { return; }
    const prev = lastTxCount;
    lastTxCount = txCount;
    if (prev == null || txCount <= prev) return;              // first paint, or not a new award
    if (Date.now() - savedPulseFiredAt < 5000) return;         // max one pulse per 5s — a burst of awards must not strobe
    if (!store.lastPersistOk()) return;                        // the write itself failed — nothing to celebrate
    const h = safeBackupHealth();
    // 'attention'/'none' stay the dominant, urgent signal — a cheerful ✓ has
    // no business appearing next to "your backup has stopped".
    if (!h || h.level === 'attention' || h.level === 'none') return;
    savedPulseFiredAt = Date.now();
    savedPulseUntil = Date.now() + 1500;
    if (savedPulseTimer) clearTimeout(savedPulseTimer);
    savedPulseTimer = setTimeout(() => { savedPulseTimer = null; renderTopbar(); }, 1550);
  }

  function safeBackupHealth() {
    try { return backup.health(); } catch (e) { console.warn('shell: backup.health() failed', e); return null; }
  }
  function safeBackupStatus() {
    try { return backup.status(); } catch (e) { console.warn('shell: backup.status() failed', e); return null; }
  }

  function renderTopbar() {
    let activeCore = 1;
    try { activeCore = store.getState().activeCore; } catch (e) { /* keep default */ }
    let activeHouse = null;
    try { activeHouse = store.getActiveHouse(); } catch (e) { /* stay null */ }
    const houses = housesByCore(store);

    const switchLabel = activeHouse
      ? `House ${activeHouse.name}`
      : 'All Cores / Global Standings';
    const dotColor = activeHouse ? activeHouse.accent : NEUTRAL_ACCENT;
    const dotSoft = activeHouse ? activeHouse.accentSoft : NEUTRAL_ACCENT_SOFT;

    let termInfo = { week: 1, totalWeeks: 9, label: '' };
    try { termInfo = store.getTermInfo(); } catch (e) { /* keep default */ }

    let soundOn = true;
    try { soundOn = store.getSettings().soundEnabled !== false; } catch (e) { /* default to audible */ }

    // Teacher-lock glyph: only ever differs from the plain dim key when a PIN
    // is actually set (lock.isEnabled()) — with no PIN, nothing below applies
    // and the bar looks exactly as it always has.
    let lockEnabled = false;
    let lockLocked = false;
    try {
      lockEnabled = lock.isEnabled();
      lockLocked = lockEnabled && !lock.isUnlocked();
    } catch (e) { /* never let the lock glyph break the bar */ }
    const adminGlyph = lockLocked ? '🔒' : '🗝️';
    const adminTitle = lockLocked
      ? "Teacher's Admin — locked. Tap to enter your PIN."
      : lockEnabled
        ? "Teacher's Admin — settings, help, planner. Shift-click or long-press to lock now."
        : "Teacher's Admin — settings, help, planner";
    // Text-shadow rather than opacity/color: .admin-glyph-btn's hover/active
    // rules already drive opacity + color, and an inline style on those
    // properties would out-specificity the hover state and freeze it. A glow
    // layers on top of whatever opacity is current without fighting it.
    const adminGlyphStyle = (lockEnabled && !lockLocked) ? 'text-shadow:0 0 6px rgba(245,158,11,0.6)' : '';

    const homeActive = !!(currentModuleId && currentModuleId !== 'dashboard');

    const menuHtml = coreMenuOpen ? `
      <div class="core-menu absolute left-0 top-[calc(100%+8px)] w-72 sm:w-80 rounded-xl overflow-hidden shadow-2xl z-50" data-core-menu>
        ${houses.map((h) => `
          <button type="button" data-core-option="${h.core}" aria-selected="${activeCore === h.core}" class="core-menu-item w-full flex items-center gap-3 px-4 text-left">
            <span class="w-3 h-3 rounded-full shrink-0" style="background:${h.accent};box-shadow:0 0 6px 1px ${h.accentSoft}"></span>
            <span class="flex flex-col leading-tight">
              <span class="font-display font-bold text-base text-gray-50">House ${h.name}</span>
              <span class="text-xs text-gray-400">Core ${h.core} &middot; ${h.motto}</span>
            </span>
          </button>
        `).join('')}
        <button type="button" data-core-option="all" aria-selected="${activeCore === 'all'}" class="core-menu-item w-full flex items-center gap-3 px-4 text-left border-t border-line">
          <span class="w-3 h-3 rounded-full shrink-0" style="background:${NEUTRAL_ACCENT}"></span>
          <span class="flex flex-col leading-tight">
            <span class="font-display font-bold text-base text-gray-50">All Cores</span>
            <span class="text-xs text-gray-400">Global Standings</span>
          </span>
        </button>
      </div>
    ` : '';

    // The pill is positioned absolutely, centered on #topbar's full width
    // (#topbar is the positioning context — see CSS). This is deliberate
    // rather than a flex-1/flex-1 balancing act: the brand block and the
    // date/admin group have different intrinsic (min-content) widths, and at
    // typical desktop widths the row has little to no slack space for
    // flex-grow to redistribute evenly — so two flex-1 side groups do NOT
    // reliably land the middle group in the true center (verified: it drifted
    // ~16px off at 1280px). Absolute + translateX(-50%) is exact regardless.
    // The ± trigger is a SEPARATE absolutely-positioned element anchored to
    // the pill's own right edge (not grouped with it) — grouping them under
    // one shared centered wrapper would center the *pair*, which visibly
    // drifts the pill itself off-true-center by half the trigger's width
    // (also verified, ~28px off) since the trigger only adds width on one side.
    const pillWidthExpr = PILL_WIDTH_EXPR;

    // ---- backup status trigger (beside the sound button) ----
    // Never let a backup failure break the shell: a thrown health() renders
    // nothing rather than a broken bar (see safeBackupHealth()).
    let backupBtnHtml = '';
    const bHealth = safeBackupHealth();
    // 7.2 — the ✓ pulse is the one reason this button ever appears while
    // fully healthy ('folder' level normally renders nothing at all, see the
    // file header note above maybeTriggerSavedPulse()).
    const pulsing = Date.now() < savedPulseUntil
      && bHealth && bHealth.level !== 'attention' && bHealth.level !== 'none';
    if (bHealth && (bHealth.level !== 'folder' || pulsing)) {
      const level = bHealth.level;
      const urgent = level === 'attention' || level === 'none';
      // Reuses .sound-trigger-btn/.sound-trigger-dot wholesale (identical 44px
      // hit-area / 38px dot geometry, hover/active transitions, and the
      // data-muted amber-halo rule already defined for the mute button) — the
      // 'attention' level rides that rule as-is; 'none' is the same look
      // shifted to rose via an inline override (inline beats the class rule).
      const roseGlow = level === 'none'
        ? 'background:rgba(244,63,94,0.18);box-shadow:0 0 0 1px rgba(244,63,94,0.65);opacity:1;'
        : '';
      const title = pulsing && level === 'folder'
        ? 'Saved'
        : (level === 'daily' ? `Backup: ${bHealth.message}` : `Backup needs attention: ${bHealth.message}`);
      // prefers-reduced-motion: no fade animation, just a static ✓ that this
      // same render pass removes once savedPulseUntil has passed (the timer
      // in maybeTriggerSavedPulse forces that repaint).
      const pulseHtml = pulsing
        ? `<span class="shell-saved-pulse${prefersReducedMotion() ? ' shell-saved-pulse-static' : ''}" aria-hidden="true">&check;</span>`
        : '';
      backupBtnHtml = `
      <button type="button" data-backup-btn data-open="${backupPanelOpen}" data-muted="${urgent}" class="sound-trigger-btn absolute top-1/2 -translate-y-1/2 shrink-0 flex items-center justify-center rounded-full" style="left:calc(50% + ${pillWidthExpr}/2 + 12px + 52px)" title="${title}" aria-label="Backup status">
        <span class="sound-trigger-dot leading-none" style="${roseGlow}">☁️</span>
        ${pulseHtml}
      </button>
      `;
    }

    topbarRoot.innerHTML = `
      <div class="h-full w-full flex items-center gap-2 sm:gap-4 px-3 sm:px-5">
        <button type="button" data-brand data-active="${homeActive}" class="shell-brand flex-1 flex items-center gap-2 sm:gap-3 px-2 sm:px-3 rounded-xl justify-start" title="Home" aria-label="Go to dashboard">
          <img src="images/class-shield.png" alt="Mr. D's Classroom crest" class="h-10 sm:h-11 w-auto object-contain shrink-0" onerror="this.style.display='none'" />
          <div class="hidden md:flex flex-col items-start leading-tight">
            <span class="brand-label font-body font-semibold text-base sm:text-lg md:text-xl text-gray-50">MR. D'S CLASSROOM</span>
            <span class="shell-subline text-[11px] sm:text-xs font-normal text-gray-400">Green Middle School</span>
          </div>
        </button>

        <div class="flex-1 flex items-center gap-1 sm:gap-2 justify-end">
          <div class="hidden sm:flex items-center gap-2 text-gray-400">
            ${CALENDAR_ICON_SVG}
            <div class="flex flex-col items-start justify-center">
              <span class="text-xs md:text-sm font-semibold text-gray-100 whitespace-nowrap">${formatToday()}</span>
              <span class="shell-subline text-[11px] sm:text-xs font-normal text-gray-400 whitespace-nowrap">Week ${termInfo.week} of ${termInfo.totalWeeks}</span>
            </div>
          </div>

          <!-- Sound and Help used to sit here. Both live inside Admin (Settings →
               sound, and the ❓ Help tab), so the bar keeps only the one door in. -->
          <button type="button" data-admin-btn data-locked="${lockLocked}" class="admin-glyph-btn flex items-center justify-center rounded-xl" title="${adminTitle}" aria-label="Teacher's Admin">
            <span class="text-base leading-none" style="${adminGlyphStyle}">${adminGlyph}</span>
          </button>
        </div>
      </div>

      <div class="absolute left-1/2 top-1/2 -translate-x-1/2 -translate-y-1/2 w-[${pillWidthExpr}]" data-core-switcher>
        <button type="button" data-core-btn data-open="${coreMenuOpen}" class="core-switch-btn w-full grid grid-cols-[auto_1fr_auto] items-center gap-2 sm:gap-3 px-3 sm:px-4 py-1.5 rounded-xl">
          <span class="core-dot shrink-0 justify-self-start" style="background:${dotColor};box-shadow:0 0 8px 1px ${dotSoft}"></span>
          <span class="switcher-label justify-self-center font-display font-extrabold tracking-wide text-lg sm:text-xl lg:text-2xl truncate text-gray-50 text-center">${switchLabel}</span>
          <span class="justify-self-end text-gray-400 text-xs transition-transform duration-200" style="transform:rotate(${coreMenuOpen ? 180 : 0}deg)">▾</span>
        </button>
        ${menuHtml}
      </div>

      <!-- Mute sits to the LEFT of the pill and ± to the right: the pair flanks
           the switcher symmetrically and, being absolutely positioned, neither
           one shifts the date block on the right. -->
      <button type="button" data-sound-btn class="sound-trigger-btn absolute top-1/2 -translate-y-1/2 shrink-0 flex items-center justify-center rounded-full" data-muted="${!soundOn}" style="right:calc(50% + ${pillWidthExpr}/2 + 12px)" title="${soundOn ? 'Sound on — tap to mute (or press M)' : 'Sound off — tap to unmute (or press M)'}" aria-label="${soundOn ? 'Mute all sound' : 'Unmute sound'}" aria-pressed="${!soundOn}">
        <span class="sound-trigger-dot leading-none">${soundOn ? '🔊' : '🔇'}</span>
      </button>
      ${backupBtnHtml}

      <!-- Fullscreen. On a 1080p board Chrome's tab strip and address bar cost
           roughly 130px of height, and every size in this app is in vh units —
           so that chrome does not just look untidy, it shrinks the entire
           interface by about 12%. Fullscreen has to be triggered by a real tap
           (browsers refuse it otherwise), which is exactly why it is a button
           and not something the app does at startup. Sits on the far side of
           the sound button, mirroring the ± trigger's offset. -->
      <button type="button" data-fullscreen-btn class="sound-trigger-btn absolute top-1/2 -translate-y-1/2 shrink-0 flex items-center justify-center rounded-full" style="left:calc(50% + ${pillWidthExpr}/2 + 12px + 104px)" title="${isFullscreen() ? 'Leave fullscreen (or press Escape)' : 'Fill the whole board — hides the browser bars'}" aria-label="${isFullscreen() ? 'Leave fullscreen' : 'Go fullscreen'}" aria-pressed="${isFullscreen()}">
        <span class="sound-trigger-dot leading-none">${isFullscreen() ? '🗗' : '⛶'}</span>
      </button>

      ${currentModuleId === 'admin' ? '' : `
      <button type="button" data-points-trigger data-open="${fabOpen}" class="points-trigger-btn absolute top-1/2 -translate-y-1/2 shrink-0 flex items-center justify-center rounded-full font-display" style="left:calc(50% + ${pillWidthExpr}/2 + 12px)" title="Quick Points" aria-label="Quick Points">
        <span class="points-trigger-dot leading-none" style="background:${dotColor};box-shadow:0 0 10px 1px ${dotSoft}">±</span>
      </button>
      `}
    `;
  }

  // Delegated listener on the (never-replaced) topbar root — survives every
  // innerHTML re-render of its children.
  // async: only the admin-btn branch below ever awaits anything, and every
  // branch is mutually exclusive (each `if` returns), so pausing mid-await on
  // that one branch cannot affect how the others run — they still execute
  // fully synchronously on whichever click actually matches them.
  topbarRoot.addEventListener('click', async (e) => {
    if (e.target.closest('[data-brand]')) { registry.home(); return; }

    if (e.target.closest('[data-admin-btn]')) {
      if (adminLongPressFired) { adminLongPressFired = false; return; } // the press already acted
      if (e.shiftKey && lock.isEnabled() && lock.isUnlocked()) { lock.lockNow(); return; }
      if (await lock.requireUnlock('open the Teacher Admin panel')) registry.navigate('admin');
      return;
    }

    if (e.target.closest('[data-fullscreen-btn]')) {
      // requestFullscreen only resolves inside a real user gesture, which is
      // why this lives on a tap rather than at startup. Failures are silent on
      // purpose — a school machine may block it by policy, and an error dialog
      // mid-lesson helps nobody. The bar redraws from the fullscreenchange
      // listener, so the glyph flips itself either way.
      try {
        if (isFullscreen()) document.exitFullscreen?.();
        else document.documentElement.requestFullscreen?.().catch(() => {});
      } catch (err) { console.warn('shell: fullscreen toggle failed', err); }
      return;
    }

    if (e.target.closest('[data-sound-btn]')) {
      // Writing the setting re-renders the bar through store.subscribe, so the
      // glyph flips itself; the audio gate above reads the same setting live.
      try {
        const on = store.getSettings().soundEnabled !== false;
        store.updateSettings({ soundEnabled: !on });
        if (!on && audio && typeof audio.sfx === 'function') audio.sfx('coin'); // audible proof it came back
      } catch (err) { console.warn('shell: sound toggle failed', err); }
      return;
    }

    if (e.target.closest('[data-points-trigger]')) {
      if (fabOpen && !fabClosing) closeFab(); else openFab();
      return;
    }

    if (e.target.closest('[data-backup-btn]')) {
      if (backupPanelOpen && !backupPanelClosing) closeBackupPanel(); else openBackupPanel();
      return;
    }

    if (e.target.closest('[data-core-btn]')) {
      coreMenuOpen = !coreMenuOpen;
      renderTopbar();
      return;
    }

    const option = e.target.closest('[data-core-option]');
    if (option) {
      const val = option.dataset.coreOption;
      coreMenuOpen = false;
      store.setActiveCore(val === 'all' ? 'all' : Number(val)); // triggers reactive re-render
      // "All Cores" IS the Council of Four screen — there is no single house to
      // show, so send them there. Picking a single core again must not strand
      // the teacher on a screen that no longer matches the selector.
      if (val === 'all') registry.navigate('council');
      else if (currentModuleId === 'council') registry.home();
      return;
    }
  });

  // Long-press the admin key to re-lock instantly (only means anything while
  // a PIN is set and the session is currently unlocked — see clearAdminLongPress).
  topbarRoot.addEventListener('pointerdown', (e) => {
    if (!e.target.closest('[data-admin-btn]')) return;
    clearAdminLongPress();
    adminLongPressFired = false;
    if (!lock.isEnabled() || !lock.isUnlocked()) return; // nothing to re-lock
    adminLongPressTimer = setTimeout(() => {
      adminLongPressFired = true;
      lock.lockNow();
    }, ADMIN_LONG_PRESS_MS);
  });
  topbarRoot.addEventListener('pointerup', clearAdminLongPress);
  topbarRoot.addEventListener('pointercancel', clearAdminLongPress);
  document.addEventListener('pointerup', clearAdminLongPress); // release outside the bar still cancels it

  window.addEventListener('module:navigate', (e) => {
    currentModuleId = e?.detail?.id ?? null;
    applyAccentVars();          // the new screen may carry its own colour
    renderTopbar();
    setFabAdminHidden(currentModuleId === 'admin');
  });

  // Keep the glyph (🗝️ / 🔒) and its title truthful as the lock state changes
  // from any source: this button, the PIN pad itself, or an idle timeout.
  window.addEventListener('lock:changed', () => renderTopbar());

  // The quick-point FAB has no place on the Teacher's Admin screen — hide it
  // (force-closing any open panel first) there, restore it everywhere else.
  // The backup popover lives in the same #fab-root, so it force-closes too.
  function setFabAdminHidden(hidden) {
    if (hidden) {
      if (fabOpen || fabClosing) { fabOpen = false; fabClosing = false; renderFab(); }
      if (backupPanelOpen || backupPanelClosing) { backupPanelOpen = false; backupPanelClosing = false; renderBackupPanel(); }
      fabRoot.style.display = 'none';
    } else {
      fabRoot.style.display = '';
    }
  }

  // ================= QUICK-POINTS PANEL (triggered from the top bar) =================
  let fabOpen = false;
  let fabClosing = false;
  let selectedHouseId = (store.getActiveHouse() || store.HOUSES[1]).id;

  // In-flight guard for applyPoints() — module-scoped (not a DOM attribute)
  // because the panel can outlive any given render pass. Set synchronously
  // before the `lock.requireUnlock()` await so a double-tap in the same tick
  // can never queue a second store.addPoints() call, and cleared in a
  // `finally` so a refused PIN (or a thrown error) never wedges the panel —
  // the teacher must be able to retry immediately. See applyPoints() below.
  let pointsInFlight = false;

  // Disables/re-enables the actual buttons the teacher taps, for visible
  // feedback during the await. Safe to call even if the panel has since
  // closed (renderFab() tears down #fab-panel-host's innerHTML, so a stale
  // query here just finds nothing).
  function setFabButtonsDisabled(disabled) {
    fabRoot.querySelectorAll('[data-fab-quick], [data-fab-apply]').forEach((btn) => {
      btn.disabled = disabled;
    });
  }

  // The panel gets its own host element inside #fab-root, separate from any
  // point toast currently animating there — so closing the panel mid-toast
  // can't yank the toast out of the DOM before its own timeout fires.
  let fabPanelHost = null;
  function ensureFabPanelHost() {
    if (fabPanelHost && fabPanelHost.isConnected) return fabPanelHost;
    fabPanelHost = document.createElement('div');
    fabPanelHost.id = 'fab-panel-host';
    fabRoot.appendChild(fabPanelHost);
    return fabPanelHost;
  }

  // ---- backup popover — same construction as the quick-points panel above:
  // its own host inside #fab-root (so it can't be yanked out by a toast or
  // the points panel re-rendering), open/closing booleans driving a
  // pop-in/pop-out animation, force-torn-down on Admin, closed by outside
  // tap or Escape. It reuses .fab-panel/.fab-close-btn/.fab-apply-btn for
  // visuals so it reads as the same system as the points panel, just
  // anchored under the backup trigger instead of pinned top-right.
  let backupPanelHost = null;
  function ensureBackupPanelHost() {
    if (backupPanelHost && backupPanelHost.isConnected) return backupPanelHost;
    backupPanelHost = document.createElement('div');
    backupPanelHost.id = 'backup-panel-host';
    fabRoot.appendChild(backupPanelHost);
    return backupPanelHost;
  }

  function renderBackupPanel() {
    const visible = backupPanelOpen || backupPanelClosing;
    let panelHtml = '';
    if (visible) {
      const bHealth = safeBackupHealth();
      const bStatus = safeBackupStatus();
      const message = (bHealth && bHealth.message) || 'Backup status isn’t available right now.';
      const canConnect = !!(bStatus && bStatus.supported);
      // Anchored under its own trigger rather than .fab-panel's usual pinned
      // right:16px, so it opens beneath the control that spawned it. The
      // trigger now sits on the RIGHT of the core switcher (it used to sit left,
      // where it crowded the school name), so this mirrors it — same offset,
      // measured from the left, and clamped so a narrow window cannot push the
      // panel off the edge.
      panelHtml = `
        <div class="fab-panel p-4 flex flex-col gap-3 ${backupPanelClosing ? 'closing' : ''}" data-backup-panel style="left:min(calc(100vw - 16px - 316px), calc(50% + ${PILL_WIDTH_EXPR}/2 + 12px + 52px - 136px));right:auto">
          <div class="flex items-center justify-between">
            <span class="font-display font-bold text-sm text-gray-100">Backup</span>
            <button type="button" data-backup-close class="fab-close-btn rounded-full flex items-center justify-center text-gray-400 hover:text-gray-100 hover:bg-white/10 text-lg leading-none">✕</button>
          </div>
          <p class="text-xs text-gray-200 leading-snug">${message}</p>
          <p class="text-[11px] text-gray-400 leading-snug">A backup is just a saved copy of the house points — so if this computer is ever wiped or swapped out, the term’s points aren’t lost with it.</p>
          <div class="flex flex-col gap-2">
            ${canConnect ? `<button type="button" data-backup-connect class="fab-apply-btn rounded-xl bg-white/10 font-bold text-xs sm:text-sm text-gray-100">Connect a backup folder</button>` : ''}
            <button type="button" data-backup-download class="fab-apply-btn rounded-xl bg-emerald-600/80 font-bold text-xs sm:text-sm text-white">Save a backup now</button>
          </div>
        </div>
      `;
    }
    ensureBackupPanelHost().innerHTML = panelHtml;
  }

  // Mirrors openFab()/closeFab() exactly, including the re-render of the top
  // bar so the trigger's data-open glow/rotate cue stays in sync.
  function openBackupPanel() { backupPanelOpen = true; backupPanelClosing = false; renderBackupPanel(); renderTopbar(); }
  function closeBackupPanel() {
    if (!backupPanelOpen) return;
    backupPanelClosing = true;
    renderBackupPanel();
    renderTopbar();
    setTimeout(() => { backupPanelOpen = false; backupPanelClosing = false; renderBackupPanel(); renderTopbar(); }, 160);
  }

  function renderFab() {
    const houses = housesByCore(store);
    const panelVisible = fabOpen || fabClosing;

    const panelHtml = panelVisible ? `
      <div class="fab-panel p-4 flex flex-col gap-3 ${fabClosing ? 'closing' : ''}" data-fab-panel>
        <div class="flex items-center justify-between">
          <span class="font-display font-bold text-sm text-gray-100">Quick Points</span>
          <button type="button" data-fab-close class="fab-close-btn rounded-full flex items-center justify-center text-gray-400 hover:text-gray-100 hover:bg-white/10 text-lg leading-none">✕</button>
        </div>

        <div class="grid grid-cols-4 gap-2" data-fab-house-row>
          ${houses.map((h) => `
            <button type="button" data-fab-house="${h.id}" data-selected="${h.id === selectedHouseId}"
              style="--chip-accent:${h.accent};--chip-accent-soft:${h.accentSoft}"
              class="fab-house-chip rounded-xl bg-white/5 flex flex-col items-center justify-center py-1.5 gap-1 text-[10px] font-semibold text-gray-200">
              <span class="w-2.5 h-2.5 rounded-full" style="background:${h.accent}"></span>
              ${h.name}
            </button>
          `).join('')}
        </div>

        <div class="grid grid-cols-4 gap-2">
          <button type="button" data-fab-quick="5" class="fab-quick-btn rounded-xl bg-white/5 font-bold text-emerald-400 text-sm">+5</button>
          <button type="button" data-fab-quick="-5" class="fab-quick-btn rounded-xl bg-white/5 font-bold text-rose-400 text-sm">-5</button>
          <button type="button" data-fab-quick="10" class="fab-quick-btn rounded-xl bg-white/5 font-bold text-emerald-400 text-sm">+10</button>
          <button type="button" data-fab-quick="-10" class="fab-quick-btn rounded-xl bg-white/5 font-bold text-rose-400 text-sm">-10</button>
        </div>

        <div class="flex items-center gap-2">
          <input type="text" inputmode="numeric" pattern="[0-9]*" maxlength="4" placeholder="Amt" data-fab-amount
            class="w-16 rounded-xl bg-card2 border border-line px-2 py-2 text-center text-sm font-semibold text-gray-50 focus:outline-none" />
          <button type="button" data-fab-apply="add" class="fab-apply-btn flex-1 rounded-xl bg-emerald-600/80 font-bold text-xs sm:text-sm text-white">+ Add</button>
          <button type="button" data-fab-apply="deduct" class="fab-apply-btn flex-1 rounded-xl bg-rose-600/80 font-bold text-xs sm:text-sm text-white">− Deduct</button>
        </div>

        <input type="text" maxlength="60" placeholder="Reason (optional)" data-fab-reason
          class="w-full rounded-xl bg-card2 border border-line px-3 py-2 text-xs text-gray-200 focus:outline-none" />
      </div>
    ` : '';

    ensureFabPanelHost().innerHTML = panelHtml;
  }

  function currentHouse() { return store.HOUSES[selectedHouseId]; }

  function spawnToast(delta, house) {
    try {
      const toast = document.createElement('div');
      toast.className = 'point-toast';
      toast.textContent = `${delta > 0 ? '+' : ''}${delta}${house ? ' ' + house.name : ''}`;
      toast.style.color = house ? house.accent : NEUTRAL_ACCENT;
      // Anchored below the top bar now (the trigger that spawned it lives up
      // there too) and drifts downward — a toast drifting "up" from the top
      // edge would just fly off-screen.
      const jitter = Math.round((Math.random() - 0.5) * 40);
      toast.style.top = 'calc(var(--topbar-height) + 10px)';
      toast.style.right = `${90 + jitter}px`;
      fabRoot.appendChild(toast); // sibling of #fab-panel-host — survives panel re-renders
      setTimeout(() => toast.remove(), 1500);
    } catch (e) { /* purely cosmetic — never block point logging */ }
  }

  // A refusal has to SAY so. The point toast is a two-word flash in a house
  // colour; a declined write needs a sentence, held long enough to read, in a
  // colour that does not look like a successful award.
  function spawnNotice(message) {
    try {
      const el = document.createElement('div');
      el.className = 'point-toast point-toast-notice';
      el.textContent = message;
      el.style.top = 'calc(var(--topbar-height) + 10px)';
      el.style.right = '90px';
      fabRoot.appendChild(el);
      setTimeout(() => el.remove(), 5200);
    } catch (e) { /* cosmetic only — never block point logging */ }
  }

  // FIX-PLAN 5.6 — the once-daily safety-net download is a mechanical event
  // (a file lands in Downloads) unless something says so; backup.js fires
  // 'mrd:backup-download' and never renders anything itself (it doesn't own
  // any UI). Styled exactly like spawnNotice's toast, held for the shorter
  // 2s the design calls for — this is good news, not a warning that needs
  // time to read.
  function spawnScribeToast() {
    try {
      const el = document.createElement('div');
      el.className = 'point-toast point-toast-notice';
      el.textContent = "📜 The scribe has archived this week's ledger";
      el.style.top = 'calc(var(--topbar-height) + 10px)';
      el.style.right = '90px';
      fabRoot.appendChild(el);
      setTimeout(() => el.remove(), 2000);
    } catch (e) { /* cosmetic only — the download already happened either way */ }
  }
  window.addEventListener('mrd:backup-download', spawnScribeToast);

  // Resolves true iff the points were actually applied. The lock gates the
  // APPLY, not the panel opening (see file header note near the import) — so
  // this awaits requireUnlock() before touching store/reason/sound/toast.
  // On refusal it returns false having done nothing, so callers can leave the
  // panel exactly as the teacher left it (typed amount and reason intact).
  //
  // In-flight guard: pointsInFlight is set synchronously, before the
  // requireUnlock() await, so a double-tap dispatched in the same tick sees
  // it already true and bails out having done nothing — the second tap never
  // reaches the await, let alone store.addPoints(). Cleared in a `finally`
  // so a refused PIN or a thrown error can't wedge the control; the teacher
  // can retry the instant the pad closes. See battle.js `resolving` / dice.js
  // `awardInFlight` for the same pattern elsewhere in this codebase.
  async function applyPoints(delta) {
    delta = Math.max(-9999, Math.min(9999, Math.round(delta) || 0));
    if (!delta || !store.HOUSES[selectedHouseId]) return false;
    if (pointsInFlight) return false; // second tap while the first is still resolving — ignore
    pointsInFlight = true;
    setFabButtonsDisabled(true);
    try {
      if (!(await lock.requireUnlock('award points'))) return false;
      const reasonEl = fabRoot.querySelector('[data-fab-reason]');
      const reason = ((reasonEl && reasonEl.value) || '').trim();
      const house = currentHouse();
      // addPoints can DECLINE — a frozen house cannot earn, and a house on zero
      // has nothing left to lose. It can also TRIM a deduction to what is
      // actually there. Playing the coin sound and flashing "+10" regardless
      // was the app lying to a room full of children, so the result is checked.
      const why = store.explainRefusal(selectedHouseId, delta);
      const tx = why ? null : store.addPoints(selectedHouseId, delta, { reason: reason || 'Quick adjust', tag: 'quick' });
      if (!tx) {
        spawnNotice(why || 'That change could not be recorded.');
        return false;
      }
      // Clear the reason so the NEXT award doesn't silently inherit this one's
      // label — the panel is deliberately not re-rendered, so do it by hand.
      if (reasonEl) {
        reasonEl.value = '';
        // Keep typing possible immediately, but only if the teacher was already
        // in the field — never steal focus from wherever he actually is.
        if (document.activeElement === reasonEl) reasonEl.focus();
      }
      if (audio && typeof audio.sfx === 'function') audio.sfx(delta > 0 ? 'coin' : 'thud');
      // tx.delta, not delta — a deduction trimmed at the zero floor must show
      // the number that actually moved.
      spawnToast(tx.delta, house);
      return true;
    } finally {
      pointsInFlight = false;
      setFabButtonsDisabled(false);
    }
  }

  // These also re-render the top bar so the trigger button's data-open
  // state (its glow/rotate cue) stays in sync with the panel.
  function openFab() { fabOpen = true; fabClosing = false; renderFab(); renderTopbar(); }
  function closeFab() {
    if (!fabOpen) return;
    fabClosing = true;
    renderFab();
    renderTopbar();
    setTimeout(() => { fabOpen = false; fabClosing = false; renderFab(); renderTopbar(); }, 160);
  }

  // async for the same reason as the top bar's click listener above: only the
  // two applyPoints() branches ever await, the rest still run fully
  // synchronously since every branch returns.
  fabRoot.addEventListener('click', async (e) => {
    if (e.target.closest('[data-fab-close]')) { closeFab(); return; }

    const chip = e.target.closest('[data-fab-house]');
    if (chip) {
      selectedHouseId = Number(chip.dataset.fabHouse);
      fabRoot.querySelectorAll('[data-fab-house]').forEach((el) => {
        el.dataset.selected = String(Number(el.dataset.fabHouse) === selectedHouseId);
      });
      return;
    }

    const quick = e.target.closest('[data-fab-quick]');
    if (quick) { await applyPoints(Number(quick.dataset.fabQuick)); return; }

    const apply = e.target.closest('[data-fab-apply]');
    if (apply) {
      const amountEl = fabRoot.querySelector('[data-fab-amount]');
      const raw = ((amountEl && amountEl.value) || '').replace(/[^0-9]/g, '');
      const amt = Math.min(9999, parseInt(raw, 10) || 0);
      if (!amt) return;
      // Only clear the typed amount on success — a refused PIN must leave the
      // panel exactly as the teacher left it, ready to retry.
      const ok = await applyPoints(apply.dataset.fabApply === 'add' ? amt : -amt);
      if (ok && amountEl) amountEl.value = '';
      return;
    }

    if (e.target.closest('[data-backup-close]')) { closeBackupPanel(); return; }

    if (e.target.closest('[data-backup-connect]')) {
      // Called synchronously from this click handler (a real user gesture),
      // never on a timer — connectFolder() opens the OS folder picker, which
      // requires that. Re-render on completion either way so a granted/denied
      // permission is reflected immediately rather than waiting for the next
      // unrelated store tick.
      try {
        await backup.connectFolder();
      } catch (err) { console.warn('shell: backup connectFolder failed', err); }
      renderBackupPanel();
      renderTopbar();
      return;
    }

    if (e.target.closest('[data-backup-download]')) {
      try { backup.downloadNow(); } catch (err) { console.warn('shell: backup downloadNow failed', err); }
      renderBackupPanel();
      return;
    }
  });

  // Digits-only enforcement for the amount field (max 4 digits === max 9999).
  fabRoot.addEventListener('input', (e) => {
    const amountEl = e.target.closest('[data-fab-amount]');
    if (amountEl) amountEl.value = amountEl.value.replace(/[^0-9]/g, '').slice(0, 4);
  });

  // ---------------- outside tap / Escape closes menu + panel ----------------
  document.addEventListener('pointerdown', (e) => {
    if (coreMenuOpen && !e.target.closest('[data-core-switcher]')) {
      coreMenuOpen = false;
      renderTopbar();
    }
    // The PIN pad (lock.js) mounts into #overlay-root, outside #fab-root, so
    // without this exclusion tapping a digit while awarding points would read
    // as an "outside" tap and collapse the quick-points panel mid-entry.
    if (fabOpen && !fabClosing && !e.target.closest('[data-fab-panel]') && !e.target.closest('[data-points-trigger]') && !e.target.closest('.lock-pad-backdrop')) {
      closeFab();
    }
    if (backupPanelOpen && !backupPanelClosing && !e.target.closest('[data-backup-panel]') && !e.target.closest('[data-backup-btn]')) {
      closeBackupPanel();
    }
  });
  document.addEventListener('keydown', (e) => {
    if (e.key !== 'Escape') return;
    if (coreMenuOpen) { coreMenuOpen = false; renderTopbar(); }
    if (fabOpen) closeFab();
    if (backupPanelOpen) closeBackupPanel();
  });

  // ---------------- store reactivity ----------------
  function rerenderAll() {
    applyAccentVars();
    applyThemeSettings();
    maybeTriggerSavedPulse(); // before renderTopbar, so a fresh pulse paints in the same pass
    renderTopbar(); // re-evaluates backup.health() too, so the trigger updates the moment a folder connects (or a permission drops)
    if (backupPanelOpen || backupPanelClosing) renderBackupPanel(); // keep its message current while open
    // Keep the FAB's preselected house following the active core, but only
    // while the panel is closed — never yank a selection mid-interaction.
    if (!fabOpen && !fabClosing) {
      const h = store.getActiveHouse();
      selectedHouseId = h ? h.id : selectedHouseId;
    }
  }
  store.subscribe(rerenderAll);
  window.__mrdShellRerender = rerenderAll; // idempotency escape hatch, see top guard

  // Fullscreen can be entered or left without touching our button — F11, or
  // Escape, which is how most people get out. Redraw so the glyph never claims
  // the opposite of what the screen is actually doing.
  try { document.addEventListener('fullscreenchange', rerenderAll); } catch (e) { /* non-fatal */ }

  // ---------------- initial paint ----------------
  // Safety net: the app always boots on 'dashboard' (main.js calls
  // registry.home() right after initShell), but if that ever changed and we
  // somehow booted straight into 'admin', don't flash the FAB into view.
  try { currentModuleId = registry.currentId?.() ?? currentModuleId; } catch (e) { /* keep default */ }
  // Baseline for maybeTriggerSavedPulse's "did a transaction just land?"
  // check, taken at boot rather than left to the first store event — without
  // this, the very first award of a session would set the baseline instead
  // of pulsing against it.
  try { lastTxCount = (store.getState().transactions || []).length; } catch (e) { /* stays null */ }
  applyAccentVars();
  applyThemeSettings(); // apply any saved theme (mode + seasonal) immediately on load
  renderTopbar();
  renderFab();
  setFabAdminHidden(currentModuleId === 'admin');

  // Remember when auto-backup last actually wrote a file, so the System check
  // can honestly say "your last backup was 9 days ago" across reloads.
  try { health.initBackupWatch(); } catch (e) { console.warn('shell: backup watch failed', e); }

  // First-run wizard — shows once, on a browser that has never been set up,
  // and never blocks the app (every step has "Skip for now").
  try { maybeRunFirstRun(); } catch (e) { console.warn('shell: first-run wizard skipped', e); }
}
