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

// module id -> PNG icon (368x370, transparent). Unknown ids fall back to
// their registered emoji so the plugin/tile pattern keeps working.
const MODULE_ICON_MAP = {
  houses: 'images/icon-points.png',
  potw: 'images/icon-potw.png',
  quests: 'images/icon-quest.png',
  battle: 'images/icon-battle.png',
  shop: 'images/icon-market.png',
  dice: 'images/icon-dice.png',
};
const MODULE_SUBTITLE_MAP = {
  houses: 'Track & award',
  potw: 'Explore the world',
  quests: 'Active challenges',
  battle: 'Team competitions',
  shop: 'Spend your hoard',
  dice: 'Test your luck',
};

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

// Portrait, transparent-bg house shield — always contain-fit, never cropped.
function houseImg(house, cls, extraAttrs = '') {
  return `<img src="${house.image}" alt="${house.name} crest" class="${cls}" ${extraAttrs}
    onerror="this.onerror=null;this.style.display='none';" />`;
}

function escapeHtml(str) {
  return String(str).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}

// Small inline line-art icons (lucide-style, hand-authored — no external assets).
function icon(name) {
  const attrs = 'viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" class="shrink-0"';
  const PATHS = {
    calendar: '<rect x="3" y="4.5" width="18" height="16" rx="2"/><path d="M16 2.5v4M8 2.5v4M3 9.5h18"/><path d="M7 13.5h6M7 17h9"/>',
    book: '<rect x="4" y="3" width="13" height="18" rx="2"/><path d="M4 7.5h3M4 11.5h3M4 15.5h3"/><path d="M19.5 14.5l-6 6-2.5.5.5-2.5 6-6z"/><path d="M17 12l2.5 2.5"/>',
    trophy: '<path d="M7 4h10v6a5 5 0 0 1-10 0V4z"/><path d="M7 6H4.5a2 2 0 0 0 0 4H7"/><path d="M17 6h2.5a2 2 0 0 1 0 4H17"/><path d="M12 15v3"/><path d="M9 21h6"/><path d="M10.5 18h3"/>',
  };
  return `<svg ${attrs}>${PATHS[name] || ''}</svg>`;
}

function sectionHeader(iconName, label) {
  return `<div class="flex items-center gap-2 text-gray-400 text-sm font-semibold uppercase tracking-wide mb-3">${icon(iconName)}<span>${label}</span></div>`;
}

// <img> with a graceful emoji-fallback sibling, shown if the PNG 404s.
function pngWithEmojiFallback(src, emoji, cls, wrapCls) {
  return `<div class="${wrapCls} relative flex items-center justify-center shrink-0">
    <img src="${src}" alt="" class="${cls}" onerror="this.style.display='none'; this.nextElementSibling.style.display='flex';" />
    <span class="hidden absolute inset-0 items-center justify-center">${emoji}</span>
  </div>`;
}

function renderHero(state, store) {
  const activeHouse = store.getActiveHouse();
  if (state.activeCore === 'all' || !activeHouse) {
    const houses = Object.values(store.HOUSES);
    return `
      <div class="dash-hero dash-in relative overflow-hidden rounded-2xl bg-gradient-to-br from-card to-card2 border-2 border-valhalla/60 min-h-[160px] xl:min-h-[200px] p-6 flex items-center gap-6 flex-wrap"
           style="--dash-glow: rgba(245,158,11,0.35);">
        <div class="flex-1 min-w-[260px]">
          <h1 class="font-display font-extrabold text-4xl xl:text-5xl tracking-wide text-valhalla drop-shadow-[0_0_18px_rgba(245,158,11,0.6)]">
            WELCOME, SCHOLARS!
          </h1>
          <p class="mt-2 text-gray-300 text-lg">Choose your house core to begin the day's quest.</p>
        </div>
        <div class="flex gap-5 xl:gap-7 flex-wrap items-end">
          ${houses.map((h) => `
            <div class="flex flex-col items-center gap-2">
              ${houseImg(h, 'h-16 xl:h-20 w-auto object-contain drop-shadow-[0_6px_16px_rgba(0,0,0,0.5)]')}
              <span class="text-xs xl:text-sm font-bold" style="color:${h.accent}">${h.name}</span>
            </div>
          `).join('')}
        </div>
      </div>`;
  }

  const h = activeHouse;
  return `
    <div class="dash-hero dash-in relative overflow-hidden rounded-2xl border-2 min-h-[210px] xl:min-h-[270px] flex items-center"
         style="border-color:${h.accent}; --dash-glow:${h.accentSoft};">
      <div class="absolute inset-0 bg-gradient-to-br from-card2 to-card"></div>
      <img src="${h.heroImage}" alt="" class="absolute inset-0 w-full h-full object-cover object-center"
           onerror="this.onerror=null;this.style.display='none';" />
      <div class="absolute inset-0 bg-gradient-to-r from-black/85 via-black/50 to-black/10"></div>
      <div class="relative z-10 flex items-center gap-6 p-6 xl:p-8 w-full">
        ${houseImg(h, 'h-40 xl:h-52 w-auto object-contain shrink-0 drop-shadow-[0_10px_26px_rgba(0,0,0,0.65)]')}
        <div class="flex-1 min-w-[240px]">
          <h1 class="font-display font-extrabold text-4xl xl:text-6xl tracking-wide text-white drop-shadow-[0_2px_10px_rgba(0,0,0,0.7)]">
            WELCOME, ${h.name.toUpperCase()}!
          </h1>
          <p class="mt-2 text-white/90 text-2xl xl:text-3xl italic drop-shadow-[0_2px_8px_rgba(0,0,0,0.7)]">&ldquo;${escapeHtml(h.motto)}&rdquo;</p>
        </div>
      </div>
    </div>`;
}



function renderStandings(state, store) {
  const totals = store.getTotals('term');
  const max = Math.max(1, ...totals.map((t) => Math.max(0, t.total)));
  const activeCore = state.activeCore;
  return `
    <div class="dash-in bg-card rounded-2xl border dash-accent-line p-5 flex flex-col min-h-0 flex-1">
      ${sectionHeader('trophy', 'Current Term Standings')}
      <div class="flex flex-col gap-2.5 overflow-y-auto dash-scroll pr-1">
        ${totals.map((t, i) => {
          const isActive = activeCore !== 'all' && t.house.core === activeCore;
          const pct = Math.max(4, Math.round((Math.max(0, t.total) / max) * 100));
          return `
          <div class="flex items-center gap-3 rounded-xl p-2 border ${isActive ? 'bg-card2' : 'border-transparent'}" ${isActive ? `style="border-color:${t.house.accent}"` : ''}>
            <div class="w-6 text-center font-bold text-gray-400">#${i + 1}</div>
            ${houseImg(t.house, 'h-12 w-auto object-contain shrink-0 drop-shadow')}
            <div class="flex-1 min-w-0">
              <div class="flex items-baseline gap-3">
                <span class="font-semibold truncate" style="color:${t.house.accent}">${t.house.name}</span>
                <span class="font-bold text-gray-100 shrink-0">${t.total}</span>
              </div>
              <div class="h-2 rounded-full mt-1 overflow-hidden max-w-[81%]" style="background: var(--color-line, #374151);">
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
        ${sectionHeader('calendar', 'Daily Itinerary')}
        <div class="text-gray-400 italic flex-1 flex items-center justify-center text-center px-4">
          Pick a house core to see today's schedule.
        </div>
      </div>`;
  }
  const items = store.getItinerary();
  return `
    <div class="dash-in bg-card rounded-2xl border dash-accent-line p-5 flex flex-col min-h-0">
      ${sectionHeader('calendar', 'Daily Itinerary')}
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
      ${sectionHeader('book', 'Homework &amp; Upcoming Quizzes')}
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
      <button data-nav="potw" class="dash-launcher h-24 xl:h-28 rounded-2xl bg-gradient-to-r from-emerald-700 to-emerald-400 shadow-lg shadow-emerald-950/40 flex items-center justify-center gap-4 px-5">
        ${pngWithEmojiFallback('images/icon-potw.png', '🌍', 'h-11 w-11 xl:h-12 xl:w-12 object-contain', 'w-11 h-11 xl:w-12 xl:h-12 text-3xl')}
        <div class="text-left">
          <div class="font-display font-extrabold text-xl xl:text-2xl text-white leading-tight">Launch Place of the Week</div>
          <div class="text-xs xl:text-sm text-white/85 font-semibold mt-0.5">Explore. Discover. Learn.</div>
        </div>
      </button>
      <button data-nav="battle" class="dash-launcher h-24 xl:h-28 rounded-2xl bg-gradient-to-r from-red-800 to-red-500 shadow-lg shadow-red-950/50 flex items-center justify-center gap-4 px-5">
        ${pngWithEmojiFallback('images/icon-battle.png', '⚔️', 'h-11 w-11 xl:h-12 xl:w-12 object-contain', 'w-11 h-11 xl:w-12 xl:h-12 text-3xl')}
        <div class="text-left">
          <div class="font-display font-extrabold text-xl xl:text-2xl text-white leading-tight">Start Battle Day</div>
          <div class="text-xs xl:text-sm text-white/85 font-semibold mt-0.5">Challenge Another House</div>
        </div>
      </button>
    </div>`;
}

function renderModuleTiles(registry) {
  const tiles = registry.modules().filter((m) => m.showTile && m.id !== 'dashboard');
  if (!tiles.length) return '';
  return `
    <div class="dash-in">
      <div class="text-gray-400 text-sm font-semibold uppercase tracking-wide mb-2">More Modules</div>
      <div class="flex flex-wrap gap-3 justify-center">
        ${tiles.map((m) => {
          const iconSrc = MODULE_ICON_MAP[m.id];
          const subtitle = MODULE_SUBTITLE_MAP[m.id];
          const iconHtml = iconSrc
            ? pngWithEmojiFallback(iconSrc, m.icon || '📘', 'w-14 h-14 xl:w-16 xl:h-16 object-contain', 'w-14 h-14 xl:w-16 xl:h-16 text-4xl')
            : `<div class="w-14 h-14 xl:w-16 xl:h-16 flex items-center justify-center text-4xl shrink-0">${m.icon || '📘'}</div>`;
          return `
          <button data-nav="${m.id}" class="dash-tile ${m.tileClass || ''} min-w-[150px] flex-1 basis-[150px] max-w-[220px]
            bg-card rounded-2xl border dash-accent-line p-4 flex flex-col items-center gap-1.5">
            ${iconHtml}
            <span class="font-semibold text-gray-100 text-sm text-center">${escapeHtml(m.title)}</span>
            ${subtitle ? `<span class="text-xs text-gray-400 text-center">${escapeHtml(subtitle)}</span>` : ''}
          </button>`;
        }).join('')}
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
