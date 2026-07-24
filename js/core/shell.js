// shell.js — persistent Classroom OS shell: top bar (brand/home, core
// switcher, term/date tracker, subtle teacher admin glyph) + floating
// quick-point adder (FAB). Owns #topbar and #fab-root only. Reactive via
// store.subscribe(); never mutates state directly (all point changes go
// through store.addPoints). The brand ("MR. D'S CLASSROOM") is the home
// button — there is no separate Home control.

const NEUTRAL_ACCENT = '#f59e0b';
const NEUTRAL_ACCENT_SOFT = 'rgba(245,158,11,0.35)';

function hexToRgbTriplet(hex) {
  const m = /^#?([a-f\d]{2})([a-f\d]{2})([a-f\d]{2})$/i.exec(hex || '');
  if (!m) return '245,158,11';
  return [1, 2, 3].map((i) => parseInt(m[i], 16)).join(',');
}

function formatToday() {
  try {
    return new Intl.DateTimeFormat('en-US', { weekday: 'short', month: 'short', day: 'numeric' }).format(new Date());
  } catch (e) { return ''; }
}

function housesByCore(store) {
  return [1, 2, 3, 4].map((c) => store.HOUSES[c]).filter(Boolean);
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
    const pct = Math.max(4, Math.min(100, Math.round((termInfo.week / termInfo.totalWeeks) * 100)));

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

    topbarRoot.innerHTML = `
      <div class="h-full w-full flex items-center justify-between gap-2 sm:gap-4 px-3 sm:px-5">
        <button type="button" data-brand data-active="${homeActive}" class="shell-brand flex items-center gap-2 px-2 sm:px-3 rounded-xl" title="Home" aria-label="Go to dashboard">
          <span class="text-xl sm:text-2xl leading-none">🏰</span>
          <span class="brand-label hidden md:inline font-body font-semibold text-base sm:text-lg md:text-xl text-gray-50">MR. D'S CLASSROOM</span>
        </button>

        <div class="relative flex-1 max-w-[30.6rem]" data-core-switcher>
          <button type="button" data-core-btn data-open="${coreMenuOpen}" class="core-switch-btn w-full grid grid-cols-[auto_1fr_auto] items-center gap-2 sm:gap-3 px-3 sm:px-4 py-1.5 rounded-xl">
            <span class="core-dot shrink-0 justify-self-start" style="background:${dotColor};box-shadow:0 0 8px 1px ${dotSoft}"></span>
            <span class="switcher-label justify-self-center font-display font-extrabold tracking-wide text-lg sm:text-xl lg:text-2xl truncate text-gray-50 text-center">${switchLabel}</span>
            <span class="justify-self-end text-gray-400 text-xs transition-transform duration-200" style="transform:rotate(${coreMenuOpen ? 180 : 0}deg)">▾</span>
          </button>
          ${menuHtml}
        </div>

        <div class="flex items-center gap-1 sm:gap-2">
          <div class="hidden sm:flex flex-col items-end justify-center min-w-[130px] md:min-w-[160px]">
            <span class="text-xs md:text-sm font-semibold text-gray-100">${formatToday()}</span>
            <span class="text-[10px] md:text-xs text-gray-400 truncate max-w-[160px]">${termInfo.label}</span>
            <div class="term-progress-track w-24 md:w-36 h-1.5 mt-1">
              <div class="term-progress-fill" style="width:${pct}%"></div>
            </div>
          </div>

          <button type="button" data-admin-btn class="admin-glyph-btn flex items-center justify-center rounded-xl" title="Teacher's Admin" aria-label="Teacher's Admin">
            <span class="text-base leading-none">🗝️</span>
          </button>
        </div>
      </div>
    `;
  }

  // Delegated listener on the (never-replaced) topbar root — survives every
  // innerHTML re-render of its children.
  topbarRoot.addEventListener('click', (e) => {
    if (e.target.closest('[data-brand]')) { registry.home(); return; }
    if (e.target.closest('[data-admin-btn]')) { registry.navigate('admin'); return; }

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

  // ================= FLOATING QUICK-POINT ADDER (FAB) =================
  let fabOpen = false;
  let fabClosing = false;
  let selectedHouseId = (store.getActiveHouse() || store.HOUSES[1]).id;

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

    fabRoot.innerHTML = `
      <button type="button" data-fab-btn data-open="${fabOpen}" class="fab-btn" aria-label="Quick add or deduct house points">±</button>
      ${panelHtml}
    `;
  }

  function currentHouse() { return store.HOUSES[selectedHouseId]; }

  function spawnToast(delta, house) {
    try {
      const toast = document.createElement('div');
      toast.className = 'point-toast';
      toast.textContent = `${delta > 0 ? '+' : ''}${delta}${house ? ' ' + house.name : ''}`;
      toast.style.color = house ? house.accent : NEUTRAL_ACCENT;
      const jitter = Math.round((Math.random() - 0.5) * 40);
      toast.style.right = `${44 + jitter}px`;
      toast.style.bottom = '96px';
      fabRoot.appendChild(toast);
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
    if (audio && typeof audio.sfx === 'function') audio.sfx(delta > 0 ? 'coin' : 'thud');
    spawnToast(delta, house);
  }

  function openFab() { fabOpen = true; fabClosing = false; renderFab(); }
  function closeFab() {
    if (!fabOpen) return;
    fabClosing = true;
    renderFab();
    setTimeout(() => { fabOpen = false; fabClosing = false; renderFab(); }, 160);
  }

  fabRoot.addEventListener('click', (e) => {
    if (e.target.closest('[data-fab-btn]')) {
      if (fabOpen && !fabClosing) closeFab(); else openFab();
      return;
    }
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
    if (fabOpen && !fabClosing && !e.target.closest('[data-fab-panel]') && !e.target.closest('[data-fab-btn]')) {
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
}
