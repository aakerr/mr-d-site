// dashboard.js — Daily Morning Dashboard (home screen)
// Owned module. Follows ARCHITECTURE.md contract.

const STYLE_ID = 'dash-styles';
const STYLE = `
@keyframes dash-fade-in { from { opacity: 0; transform: translateY(6px); } to { opacity: 1; transform: translateY(0); } }
@keyframes dash-bar-grow { from { width: 0%; } }
@keyframes dash-glow-pulse {
  0%, 100% { box-shadow: 0 0 18px 2px var(--dash-glow, rgba(245,158,11,0.35)); }
  50% { box-shadow: 0 0 34px 8px var(--dash-glow, rgba(245,158,11,0.5)); }
}
.dash-in { animation: dash-fade-in 320ms ease both; }
.dash-bar-fill { animation: dash-bar-grow 900ms cubic-bezier(.16,.84,.44,1) both; }
.dash-hero { animation: dash-glow-pulse 3.2s ease-in-out infinite; }
.dash-tile { transition: transform 180ms ease, box-shadow 180ms ease, border-color 180ms ease; }
.dash-tile:active { transform: scale(0.96); }
.dash-tile:hover { transform: translateY(-2px); }
.dash-launcher { transition: transform 150ms ease, box-shadow 200ms ease, filter 200ms ease; }
.dash-launcher:hover { filter: brightness(1.08); }
.dash-launcher:active { transform: scale(0.97); }
.dash-scroll::-webkit-scrollbar { width: 8px; }
.dash-scroll::-webkit-scrollbar-thumb { background: #374151; border-radius: 8px; }
.dash-accent-line { border-color: color-mix(in srgb, var(--accent, #f59e0b) 65%, transparent); }
.dash-tile.dash-accent-line:hover { border-color: var(--accent, #f59e0b); }
`;

function ensureStyle() {
  if (document.getElementById(STYLE_ID)) return;
  const s = document.createElement('style');
  s.id = STYLE_ID;
  s.textContent = STYLE;
  document.head.appendChild(s);
}

function fmtDateLong() {
  return new Date().toLocaleDateString(undefined, { weekday: 'long', year: 'numeric', month: 'long', day: 'numeric' });
}

function houseImg(house, cls, extraAttrs = '') {
  return `<img src="${house.image}" alt="${house.name} crest" class="${cls}" ${extraAttrs}
    onerror="this.onerror=null;this.style.display='none';" />`;
}

function escapeHtml(str) {
  return String(str).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}

function renderHero(state, store) {
  const activeHouse = store.getActiveHouse();
  if (state.activeCore === 'all' || !activeHouse) {
    const houses = Object.values(store.HOUSES);
    return `
      <div class="dash-hero dash-in relative overflow-hidden rounded-2xl bg-gradient-to-br from-card to-card2 border-2 border-valhalla/60 p-6 flex items-center gap-6 flex-wrap"
           style="--dash-glow: rgba(245,158,11,0.35);">
        <div class="flex-1 min-w-[260px]">
          <h1 class="font-display font-extrabold text-4xl xl:text-5xl tracking-wide text-valhalla drop-shadow-[0_0_18px_rgba(245,158,11,0.6)]">
            WELCOME, SCHOLARS!
          </h1>
          <p class="mt-2 text-gray-300 text-lg">Choose your house core to begin the day's quest.</p>
        </div>
        <div class="flex gap-3 flex-wrap">
          ${houses.map((h) => `
            <div class="flex flex-col items-center gap-1">
              <div class="w-16 h-16 xl:w-20 xl:h-20 rounded-xl overflow-hidden border-2 flex items-center justify-center bg-card2"
                   style="border-color:${h.accent}; box-shadow: 0 0 14px ${h.accentSoft};">
                ${houseImg(h, 'w-full h-full object-cover')}
              </div>
              <span class="text-xs font-bold" style="color:${h.accent}">${h.name}</span>
            </div>
          `).join('')}
        </div>
      </div>`;
  }

  const h = activeHouse;
  return `
    <div class="dash-hero dash-in relative overflow-hidden rounded-2xl bg-gradient-to-br from-card to-card2 border-2 p-6 flex items-center gap-6 flex-wrap"
         style="border-color:${h.accent}; --dash-glow:${h.accentSoft};">
      <div class="w-44 xl:w-56 aspect-[3/2] shrink-0 rounded-2xl overflow-hidden border-2 bg-card2"
           style="border-color:${h.accent}; box-shadow: 0 0 24px ${h.accentSoft};">
        ${houseImg(h, 'w-full h-full object-cover scale-[1.06]')}
      </div>
      <div class="flex-1 min-w-[240px]">
        <h1 class="font-display font-extrabold text-4xl xl:text-6xl tracking-wide drop-shadow-lg" style="color:${h.accent};">
          WELCOME, ${h.name.toUpperCase()}!
        </h1>
        <p class="mt-2 text-gray-300 text-lg xl:text-xl italic">&ldquo;${escapeHtml(h.motto)}&rdquo;</p>
      </div>
    </div>`;
}



function renderStandings(state, store) {
  const totals = store.getTotals('term');
  const max = Math.max(1, ...totals.map((t) => Math.max(0, t.total)));
  const activeCore = state.activeCore;
  return `
    <div class="dash-in bg-card rounded-2xl border dash-accent-line p-5 flex flex-col min-h-0 flex-1">
      <div class="text-gray-400 text-sm font-semibold uppercase tracking-wide mb-3">Current Term Standings</div>
      <div class="flex flex-col gap-2.5 overflow-y-auto dash-scroll pr-1">
        ${totals.map((t, i) => {
          const isActive = activeCore !== 'all' && t.house.core === activeCore;
          const pct = Math.max(4, Math.round((Math.max(0, t.total) / max) * 100));
          return `
          <div class="flex items-center gap-3 rounded-xl p-2 border ${isActive ? 'bg-card2' : 'border-transparent'}" ${isActive ? `style="border-color:${t.house.accent}"` : ''}>
            <div class="w-6 text-center font-bold text-gray-400">#${i + 1}</div>
            <div class="w-[4.5rem] h-12 rounded-lg overflow-hidden border shrink-0" style="border-color:${t.house.accent}">
              ${houseImg(t.house, 'w-full h-full object-cover scale-110')}
            </div>
            <div class="flex-1 min-w-0">
              <div class="flex items-baseline gap-3">
                <span class="font-semibold truncate" style="color:${t.house.accent}">${t.house.name}</span>
                <span class="font-bold text-gray-100 shrink-0">${t.total}</span>
              </div>
              <div class="h-2 rounded-full bg-card2 mt-1 overflow-hidden max-w-[81%]">
                <div class="dash-bar-fill h-full rounded-full" style="width:${pct}%; background:${t.house.accent};"></div>
              </div>
            </div>
          </div>`;
        }).join('')}
      </div>
    </div>`;
}

function renderItinerary(state, store) {
  if (state.activeCore === 'all') {
    return `
      <div class="dash-in bg-card rounded-2xl border dash-accent-line p-5 flex flex-col min-h-0">
        <div class="text-gray-400 text-sm font-semibold uppercase tracking-wide mb-3">Daily Itinerary</div>
        <div class="text-gray-400 italic flex-1 flex items-center justify-center text-center px-4">
          Pick a house core to see today's schedule.
        </div>
      </div>`;
  }
  const items = store.getItinerary();
  return `
    <div class="dash-in bg-card rounded-2xl border dash-accent-line p-5 flex flex-col min-h-0">
      <div class="text-gray-400 text-sm font-semibold uppercase tracking-wide mb-3">Daily Itinerary</div>
      <div class="flex flex-col gap-2 overflow-y-auto dash-scroll pr-1">
        ${items.length ? items.map((it, i) => `
          <div class="flex items-start gap-3">
            <span class="shrink-0 w-7 h-7 flex items-center justify-center rounded-md bg-card2 border border-line text-xs font-bold text-gray-200">${i + 1}</span>
            <span class="text-gray-200 text-sm xl:text-base">${escapeHtml(it.text)}</span>
          </div>`).join('') : '<div class="text-gray-500 italic">Nothing scheduled.</div>'}
      </div>
    </div>`;
}

function renderHomework(state, store) {
  const items = state.activeCore === 'all' ? [] : store.getHomework();
  return `
    <div class="dash-in bg-card rounded-2xl border dash-accent-line p-5 flex flex-col min-h-0">
      <div class="text-gray-400 text-sm font-semibold uppercase tracking-wide mb-3">Homework &amp; Upcoming Quizzes</div>
      <div class="flex flex-col gap-2 overflow-y-auto dash-scroll pr-1">
        ${state.activeCore === 'all' ? '<div class="text-gray-400 italic">Pick a house core to see assignments.</div>' :
          (items.length ? items.map((hw) => `
          <div class="flex items-center gap-3">
            <span class="shrink-0 px-2 py-0.5 rounded-md bg-valhalla/20 border border-valhalla/50 text-xs font-bold text-valhalla">Due ${escapeHtml(hw.due)}</span>
            <span class="text-gray-200 text-sm xl:text-base">${escapeHtml(hw.text)}</span>
          </div>`).join('') : '<div class="text-gray-500 italic">Nothing due. Enjoy it!</div>')}
      </div>
    </div>`;
}

function renderLaunchers() {
  return `
    <div class="dash-in grid grid-cols-1 sm:grid-cols-2 gap-4">
      <button data-nav="potw" class="dash-launcher border-2 dash-accent-line h-20 xl:h-24 rounded-2xl font-display font-extrabold text-xl xl:text-2xl text-gray-900
        bg-gradient-to-r from-valhalla to-emerald-500 shadow-lg shadow-valhalla/20 flex items-center justify-center gap-3">
        🌍 Launch Place of the Week
      </button>
      <button data-nav="battle" class="dash-launcher border-2 dash-accent-line h-20 xl:h-24 rounded-2xl font-display font-extrabold text-xl xl:text-2xl text-gray-50
        bg-gradient-to-r from-red-600 to-camelot shadow-lg shadow-camelot/30 flex items-center justify-center gap-3">
        ⚔️ Start Battle Day
      </button>
    </div>`;
}

function renderModuleTiles(registry) {
  const tiles = registry.modules().filter((m) => m.showTile && m.id !== 'dashboard');
  if (!tiles.length) return '';
  return `
    <div class="dash-in">
      <div class="text-gray-400 text-sm font-semibold uppercase tracking-wide mb-2">More Modules</div>
      <div class="flex flex-wrap gap-3">
        ${tiles.map((m) => `
          <button data-nav="${m.id}" class="dash-tile ${m.tileClass || ''} min-w-[140px] flex-1 basis-[140px] max-w-[220px]
            bg-card rounded-2xl border dash-accent-line p-4 flex flex-col items-center gap-1.5">
            <span class="text-3xl">${m.icon || '📘'}</span>
            <span class="font-semibold text-gray-100 text-sm text-center">${escapeHtml(m.title)}</span>
          </button>
        `).join('')}
      </div>
    </div>`;
}

function render(root, ctx) {
  const { store } = ctx;
  const state = store.getState();
  root.innerHTML = `
    <div class="h-full w-full p-4 xl:p-6 flex flex-col gap-4 xl:gap-5 overflow-y-auto dash-scroll">
      ${renderHero(state, store)}
      <div class="grid grid-cols-1 md:grid-cols-2 gap-4 xl:gap-5">
        <div class="flex flex-col">${renderStandings(state, store)}</div>
        <div class="flex flex-col gap-4 xl:gap-5">
          ${renderItinerary(state, store)}
          ${renderHomework(state, store)}
        </div>
      </div>
      ${renderLaunchers()}
      ${renderModuleTiles(ctx.registry)}
    </div>
  `;
}

export default {
  id: 'dashboard',
  title: 'Morning Dashboard',
  icon: '🏰',
  order: 10,
  showTile: false,
  _unsub: null,
  _clickHandler: null,

  mount(el, ctx) {
    ensureStyle();
    render(el, ctx);

    this._clickHandler = (e) => {
      const btn = e.target.closest('[data-nav]');
      if (!btn) return;
      const id = btn.getAttribute('data-nav');
      ctx.registry.navigate(id);
    };
    el.addEventListener('click', this._clickHandler);

    this._unsub = ctx.store.subscribe(() => render(el, ctx));
    this._el = el;
    this._ctx = ctx;
  },

  unmount() {
    if (this._unsub) { this._unsub(); this._unsub = null; }
    if (this._el && this._clickHandler) this._el.removeEventListener('click', this._clickHandler);
    this._el = null;
    this._ctx = null;
  },
};
