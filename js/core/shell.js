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

import { openHelp } from './help.js';
import { maybeRunFirstRun } from './firstrun.js';
import { health } from './health.js';

const NEUTRAL_ACCENT = '#f59e0b';
const NEUTRAL_ACCENT_SOFT = 'rgba(245,158,11,0.35)';

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

  // Make the speaker toggle actually silence things today (see applySoundGate).
  try { applySoundGate(audio, store); } catch (e) { console.warn('shell: sound gate failed', e); }

  // ---------------- shared: live accent CSS vars ----------------
  function applyAccentVars() {
    let house = null;
    try { house = store.getActiveHouse(); } catch (e) { house = null; }
    const accent = house ? house.accent : NEUTRAL_ACCENT;
    const soft = house ? house.accentSoft : NEUTRAL_ACCENT_SOFT;
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

    if (theme.seasonal) {
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
    const pillWidthExpr = 'min(30.6rem,44vw)';
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
          <button type="button" data-admin-btn class="admin-glyph-btn flex items-center justify-center rounded-xl" title="Teacher's Admin — settings, help, planner" aria-label="Teacher's Admin">
            <span class="text-base leading-none">🗝️</span>
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

      ${currentModuleId === 'admin' ? '' : `
      <button type="button" data-points-trigger data-open="${fabOpen}" class="points-trigger-btn absolute top-1/2 -translate-y-1/2 shrink-0 flex items-center justify-center rounded-full font-display" style="left:calc(50% + ${pillWidthExpr}/2 + 12px)" title="Quick Points" aria-label="Quick Points">
        <span class="points-trigger-dot leading-none" style="background:${dotColor};box-shadow:0 0 10px 1px ${dotSoft}">±</span>
      </button>
      `}
    `;
  }

  // Delegated listener on the (never-replaced) topbar root — survives every
  // innerHTML re-render of its children.
  topbarRoot.addEventListener('click', (e) => {
    if (e.target.closest('[data-brand]')) { registry.home(); return; }
    if (e.target.closest('[data-admin-btn]')) { registry.navigate('admin'); return; }

    if (e.target.closest('[data-help-btn]')) {
      try { openHelp(); } catch (err) { console.warn('shell: help failed to open', err); }
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

  window.addEventListener('module:navigate', (e) => {
    currentModuleId = e?.detail?.id ?? null;
    renderTopbar();
    setFabAdminHidden(currentModuleId === 'admin');
  });

  // The quick-point FAB has no place on the Teacher's Admin screen — hide it
  // (force-closing any open panel first) there, restore it everywhere else.
  function setFabAdminHidden(hidden) {
    if (hidden) {
      if (fabOpen || fabClosing) { fabOpen = false; fabClosing = false; renderFab(); }
      fabRoot.style.display = 'none';
    } else {
      fabRoot.style.display = '';
    }
  }

  // ================= QUICK-POINTS PANEL (triggered from the top bar) =================
  let fabOpen = false;
  let fabClosing = false;
  let selectedHouseId = (store.getActiveHouse() || store.HOUSES[1]).id;

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

  function applyPoints(delta) {
    delta = Math.max(-9999, Math.min(9999, Math.round(delta) || 0));
    if (!delta || !store.HOUSES[selectedHouseId]) return;
    const reasonEl = fabRoot.querySelector('[data-fab-reason]');
    const reason = ((reasonEl && reasonEl.value) || '').trim();
    const house = currentHouse();
    store.addPoints(selectedHouseId, delta, { reason: reason || 'Quick adjust', tag: 'quick' });
    // Clear the reason so the NEXT award doesn't silently inherit this one's
    // label — the panel is deliberately not re-rendered, so do it by hand.
    if (reasonEl) {
      reasonEl.value = '';
      // Keep typing possible immediately, but only if the teacher was already
      // in the field — never steal focus from wherever he actually is.
      if (document.activeElement === reasonEl) reasonEl.focus();
    }
    if (audio && typeof audio.sfx === 'function') audio.sfx(delta > 0 ? 'coin' : 'thud');
    spawnToast(delta, house);
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

  fabRoot.addEventListener('click', (e) => {
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
    if (quick) { applyPoints(Number(quick.dataset.fabQuick)); return; }

    const apply = e.target.closest('[data-fab-apply]');
    if (apply) {
      const amountEl = fabRoot.querySelector('[data-fab-amount]');
      const raw = ((amountEl && amountEl.value) || '').replace(/[^0-9]/g, '');
      const amt = Math.min(9999, parseInt(raw, 10) || 0);
      if (!amt) return;
      applyPoints(apply.dataset.fabApply === 'add' ? amt : -amt);
      if (amountEl) amountEl.value = '';
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
    if (fabOpen && !fabClosing && !e.target.closest('[data-fab-panel]') && !e.target.closest('[data-points-trigger]')) {
      closeFab();
    }
  });
  document.addEventListener('keydown', (e) => {
    if (e.key !== 'Escape') return;
    if (coreMenuOpen) { coreMenuOpen = false; renderTopbar(); }
    if (fabOpen) closeFab();
  });

  // ---------------- store reactivity ----------------
  function rerenderAll() {
    applyAccentVars();
    applyThemeSettings();
    renderTopbar();
    // Keep the FAB's preselected house following the active core, but only
    // while the panel is closed — never yank a selection mid-interaction.
    if (!fabOpen && !fabClosing) {
      const h = store.getActiveHouse();
      selectedHouseId = h ? h.id : selectedHouseId;
    }
  }
  store.subscribe(rerenderAll);
  window.__mrdShellRerender = rerenderAll; // idempotency escape hatch, see top guard

  // ---------------- initial paint ----------------
  // Safety net: the app always boots on 'dashboard' (main.js calls
  // registry.home() right after initShell), but if that ever changed and we
  // somehow booted straight into 'admin', don't flash the FAB into view.
  try { currentModuleId = registry.currentId?.() ?? currentModuleId; } catch (e) { /* keep default */ }
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
