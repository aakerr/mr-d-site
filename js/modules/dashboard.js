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
.dash-accent-line { border-color: var(--accent, #f59e0b); }
.dash-tile.dash-accent-line:hover { border-color: var(--accent, #f59e0b); }

/* A house's accent is an IDENTITY colour (crest, bar fill, border, dot) —
   it is not automatically a safe TEXT colour. In dark mode every card is
   dark enough that the accent reads fine as foreground text. In light mode
   the card flips to near-white and two of the four house colours (Valhalla
   amber, Rivendell green) drop well under the 4.5:1 body-text contrast
   floor against it. .acc-text lets an element keep using its house accent
   as text in dark mode (via the --acc custom property set inline, right
   alongside the same accent still doing its identity work on the crest/bar
   next to it) while swapping to the theme's body-text token in light mode,
   where it stays legible. This same class/variable pair is used identically
   in houses.js so the whole app fixes this one way, not several. */
.acc-text { color: var(--acc, var(--color-text, #f9fafb)); }
html[data-mode="light"] .acc-text { color: var(--color-text, #111827); }

/* These two spots use Tailwind's fixed "valhalla" (amber) utility colour as
   plain decoration -- not tied to any selected house -- so in light mode
   they just need to become legible; dark mode (where the glow/identity look
   already works) is untouched. */
html[data-mode="light"] .dash-welcome-h1 { color: var(--color-text) !important; }
html[data-mode="light"] .dash-hw-badge {
  color: var(--color-text) !important;
  background: var(--color-card2) !important;
  border-color: var(--color-line) !important;
}

/* THE MIDDLE ROW IS A FIXED BOX. It used to size to its own content, so the
   moment a class had five homework items instead of one, the right-hand column
   grew, the row grew with it, the standings card no longer matched its height
   and the whole screen slid down. A dashboard cannot change shape because
   somebody added an assignment.
   Height is locked here; the three panels inside already carry overflow-y-auto,
   so extra items become a scrollbar inside a panel rather than a taller page.
   Only from the md breakpoint up, where the two columns sit side by side —
   stacked on a narrow screen a fixed height would crush them.
   The height is set by the LEFT panel's needs, not the right's: there are
   always exactly four houses, so the standings should never scroll, while the
   itinerary and homework hold however many items the day happens to have.
   That is the whole trade — a fixed thing sets the box, a variable thing
   scrolls inside it. */
@media (min-width: 768px) {
  /* flex:0 0 auto matters as much as the height. The page column is a flex
     container, so without it the row is just a shrinkable child and gets
     squeezed back to whatever is left over — which is how a 238px row measured
     212px and put the standings back into a scrollbar. */
  .dash-row { flex: 0 0 auto; height: clamp(238px, 34vh, 380px); min-height: 0; }
  .dash-row > * { min-height: 0; height: 100%; }
  .dash-col-card { height: 100%; min-height: 0; }
}
`;

// module id -> PNG icon (368x370, transparent). Unknown ids fall back to
// their registered emoji so the plugin/tile pattern keeps working.
const MODULE_ICON_MAP = {
  // houses: no PNG — falls back to the module's 📜 (it's the ledger now)
  potw: 'images/icon-potw.png',
  quests: 'images/icon-quest.png',
  battle: 'images/icon-battle.png',
  shop: 'images/icon-market.png',
  dice: 'images/icon-dice.png',
};
const MODULE_SUBTITLE_MAP = {
  houses: 'History & analysis',
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
  return `<div class="flex items-center gap-2 text-gray-400 text-sm font-semibold uppercase tracking-wide mb-1.5">${icon(iconName)}<span>${label}</span></div>`;
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
      <div class="dash-hero dash-in relative overflow-hidden rounded-2xl bg-gradient-to-br from-card to-card2 border-2 border-valhalla/60 min-h-[130px] xl:min-h-[160px] p-4 xl:p-5 flex items-center gap-6 flex-wrap"
           style="--dash-glow: rgba(245,158,11,0.35);">
        <div class="flex-1 min-w-[260px]">
          <div class="text-gray-400 text-xs xl:text-sm font-bold uppercase tracking-[0.2em]">Welcome</div>
          <h1 class="font-display font-extrabold text-4xl xl:text-5xl tracking-wide text-valhalla dash-welcome-h1 drop-shadow-[0_0_18px_rgba(245,158,11,0.6)]">
            SCHOLARS!
          </h1>
          <p class="mt-0.5 text-gray-300 text-sm xl:text-base">Choose your house core to begin the day's quest.</p>
        </div>
        <div class="flex gap-4 xl:gap-6 flex-wrap items-end">
          ${houses.map((h) => `
            <div class="flex flex-col items-center gap-1.5">
              ${houseImg(h, 'h-12 xl:h-16 w-auto object-contain drop-shadow-[0_6px_16px_rgba(0,0,0,0.5)]')}
              <span class="text-xs xl:text-sm font-bold acc-text" style="--acc:${h.accent}">${h.name}</span>
            </div>
          `).join('')}
        </div>
      </div>`;
  }

  const h = activeHouse;
  return `
    <div class="dash-hero dash-in relative overflow-hidden rounded-2xl border-2 min-h-[165px] xl:min-h-[205px] flex items-center"
         style="border-color:${h.accent}; --dash-glow:${h.accentSoft};">
      <div class="absolute inset-0 bg-gradient-to-br from-card2 to-card"></div>
      <img src="${h.heroImage}" alt="" class="absolute inset-0 w-full h-full object-cover object-center"
           onerror="this.onerror=null;this.style.display='none';" />
      <div class="absolute inset-0 bg-gradient-to-r from-black/85 via-black/50 to-black/10"></div>
      <!-- The three lines stay TIGHT together — a couple of px between each,
           the way Welcome/name already sat. What reaches the shield's top and
           bottom edges is the NAME growing, not space being distributed.
           An earlier attempt used justify-between, which spread the free height
           into the gaps instead: it aligned the edges but pushed the two gaps
           out to 12px each and left the name barely larger. The type does the
           work here; the gaps are meant to be small and equal. -->
      <div class="relative z-10 flex items-center gap-5 p-4 xl:p-6 w-full" style="--crest-h:clamp(7rem,21vh,10.5rem)">
        ${houseImg(h, 'w-auto object-contain shrink-0 drop-shadow-[0_10px_26px_rgba(0,0,0,0.65)]', 'style="height:var(--crest-h)"')}
        <!-- Spaced by INK, not by boxes. Box-to-box said 2px and 0px while the
             eye saw 14px and 25px, because a line box reserves descender room
             under the baseline that an all-caps house name never uses: 21.8px
             of dead space under "CAMELOT!" against 10px above it. Margins here
             cancel that reserved space, so the numbers below are what is
             actually visible between letters.
             Every ratio below is an ink inset per em, measured with canvas
             TextMetrics rather than guessed: Cinzel caps sit .0806 below the top
             of their line box and .1758 above the bottom; the label and the
             italic motto have their own. They multiply by each line's font size,
             so changing a size keeps the gaps honest. Change the TYPEFACE and
             they all need re-measuring.
             The four numbers on the next line are the only ones meant to be
             edited: two font sizes, the name size, and the two gaps. -->
        <div class="flex-1 min-w-[240px] flex flex-col justify-center" style="
             height:var(--crest-h);
             --gap-top:10px; --gap-bot:10px;
             --wel-fs:16px; --motto-fs:36px; --name-fs:125px">
          <div class="text-white/80 font-bold uppercase tracking-[0.25em] drop-shadow-[0_2px_8px_rgba(0,0,0,0.7)]" style="font-size:var(--wel-fs);line-height:1;margin-bottom:calc(var(--gap-top) - 0.1438 * var(--wel-fs) - 0.0806 * var(--name-fs))">Welcome</div>
          <!-- Sized OFF the crest, not off the viewport: the name is whatever is
               left of the shield's height once the other two lines and the two
               gaps are taken out. That is what makes top and bottom line up on
               their own at any screen size — a vh value only matches at the one
               height it was tuned at and drifts everywhere else.
               An explicit size now, set above, rather than solved from the
               shield: he asked for a specific one. The column therefore centres
               on the shield instead of spanning it edge to edge — with the name
               smaller than the shield's height, something has to give, and the
               gaps he specified are the part worth holding exactly. -->
          <h1 class="font-display font-extrabold tracking-wide text-white leading-none drop-shadow-[0_2px_10px_rgba(0,0,0,0.7)]" style="font-size:var(--name-fs)">
            ${h.name.toUpperCase()}!
          </h1>
          <p class="text-white/90 italic drop-shadow-[0_2px_8px_rgba(0,0,0,0.7)]" style="font-size:var(--motto-fs);line-height:1;margin-top:calc(var(--gap-bot) - 0.1758 * var(--name-fs) - 0.1308 * var(--motto-fs))">&ldquo;${escapeHtml(h.motto)}&rdquo;</p>
        </div>
      </div>
    </div>`;
}



function renderStandings(state, store) {
  const totals = store.getTotals('term');
  const max = Math.max(1, ...totals.map((t) => Math.max(0, t.total)));
  const activeCore = state.activeCore;
  return `
    <div class="dash-in bg-card rounded-2xl border-2 dash-accent-line p-[clamp(6px,1.2vh,16px)] flex flex-col flex-1 min-h-0">
      ${sectionHeader('trophy', 'Current Term Standings')}
      <!-- There are ALWAYS exactly four houses, so these rows share the space
           instead of scrolling: each is flex-1 inside a fixed-height box, which
           means four always fit at any viewport without tuning row heights
           against a scrollbar. overflow-hidden is a backstop, not the plan. -->
      <div class="flex flex-col gap-[clamp(3px,0.5vh,10px)] flex-1 min-h-0 overflow-hidden pr-1">
        ${totals.map((t, i) => {
          const isActive = activeCore !== 'all' && t.house.core === activeCore;
          const pct = Math.max(4, Math.round((Math.max(0, t.total) / max) * 100));
          return `
          <div class="rounded-xl border px-3 py-[clamp(2px,0.6vh,10px)] flex-1 min-h-0 flex flex-col justify-center ${isActive ? 'bg-card2' : 'border-transparent'}" ${isActive ? `style="border-color:${t.house.accent}"` : ''}>
            <div class="flex items-center gap-3">
              <div class="w-7 text-center font-bold text-gray-400 text-[clamp(0.8rem,1.6vh,1rem)] shrink-0">#${i + 1}</div>
              ${houseImg(t.house, 'w-auto object-contain shrink-0 drop-shadow', 'style="height: clamp(1.6rem, 4.4vh, 3.25rem); max-height: 100%;"')}
              <div class="flex-1 min-w-0">
                <div class="flex items-baseline gap-5">
                  <span class="font-bold text-[clamp(1rem,2.65vh,1.625rem)] truncate acc-text" style="--acc:${t.house.accent}">${t.house.name}</span>
                  <span class="font-extrabold text-gray-100 text-[clamp(1rem,2.5vh,1.625rem)] shrink-0">${t.total}</span>
                </div>
                <div class="mt-[clamp(2px,0.4vh,6px)] rounded-full overflow-hidden" style="background: var(--color-line, #374151); height: clamp(5px, 1vh, 10px);">
                  <div class="dash-bar-fill h-full rounded-full" style="width:${pct}%; background:${t.house.accent};"></div>
                </div>
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
      <div class="dash-in bg-card rounded-2xl border-2 dash-accent-line p-[clamp(6px,1.2vh,16px)] flex flex-col flex-[3] min-h-0">
        ${sectionHeader('calendar', 'Daily Itinerary')}
        <div class="text-gray-400 italic flex-1 flex items-center justify-center text-center px-4">
          Pick a house core to see today's schedule.
        </div>
      </div>`;
  }
  const items = store.getItinerary();
  return `
    <div class="dash-in bg-card rounded-2xl border-2 dash-accent-line p-[clamp(6px,1.2vh,16px)] flex flex-col flex-[3] min-h-0">
      ${sectionHeader('calendar', 'Daily Itinerary')}
      <div class="flex flex-col gap-2 overflow-y-auto dash-scroll pr-1">
        ${items.length ? items.map((it, i) => `
          <div class="flex items-start gap-2.5 shrink-0">
            <span class="shrink-0 flex items-center justify-center rounded-md bg-card2 border border-line font-bold text-gray-200" style="width:clamp(1.25rem,2.7vh,1.6rem); height:clamp(1.25rem,2.7vh,1.6rem); font-size:clamp(0.65rem,1.3vh,0.85rem);">${i + 1}</span>
            <span class="text-gray-200 leading-snug" style="font-size:clamp(0.9rem,1.9vh,1.15rem);">${escapeHtml(it.text)}</span>
          </div>`).join('') : '<div class="text-gray-500 italic">Nothing scheduled.</div>'}
      </div>
    </div>`;
}

function renderHomework(state, store) {
  const items = state.activeCore === 'all' ? [] : store.getHomework();
  return `
    <div class="dash-in bg-card rounded-2xl border-2 dash-accent-line p-[clamp(4px,1vh,12px)] flex flex-col flex-[2] min-h-0">
      ${sectionHeader('book', 'Homework &amp; Upcoming Quizzes')}
      <div class="flex flex-col gap-2 overflow-y-auto dash-scroll pr-1">
        ${state.activeCore === 'all' ? '<div class="text-gray-400 italic">Pick a house core to see assignments.</div>' :
          (items.length ? items.map((hw) => `
          <div class="flex items-center gap-2.5 shrink-0">
            <span class="shrink-0 rounded-md bg-valhalla/20 border border-valhalla/50 font-bold text-valhalla dash-hw-badge" style="padding:clamp(2px,0.4vh,5px) 9px; font-size:clamp(0.65rem,1.3vh,0.85rem);">Due ${escapeHtml(hw.due)}</span>
            <span class="text-gray-200 leading-snug" style="font-size:clamp(0.9rem,1.9vh,1.15rem);">${escapeHtml(hw.text)}</span>
          </div>`).join('') : '<div class="text-gray-500 italic">Nothing due. Enjoy it!</div>')}
      </div>
    </div>`;
}

function renderModuleTiles(registry) {
  const tiles = registry.modules().filter((m) => m.showTile && m.id !== 'dashboard');
  if (!tiles.length) return '';
  return `
    <div class="dash-in">
      <div class="w-full h-[3px] rounded-full mb-3 xl:mb-4"
           style="background: linear-gradient(90deg, transparent, var(--accent, #f59e0b) 12%, var(--accent, #f59e0b) 88%, transparent);"></div>
      <div class="grid grid-cols-3 md:grid-cols-6 gap-3 xl:gap-4 w-full">
        ${tiles.map((m) => {
          const iconSrc = MODULE_ICON_MAP[m.id];
          const subtitle = MODULE_SUBTITLE_MAP[m.id];
          const iconHtml = iconSrc
            ? pngWithEmojiFallback(iconSrc, m.icon || '📘', 'w-12 h-12 xl:w-14 xl:h-14 object-contain', 'w-12 h-12 xl:w-14 xl:h-14 text-3xl')
            : `<div class="w-12 h-12 xl:w-14 xl:h-14 flex items-center justify-center text-3xl shrink-0">${m.icon || '📘'}</div>`;
          return `
          <button data-nav="${m.id}" class="dash-tile ${m.tileClass || ''} w-full
            bg-card rounded-2xl border-2 dash-accent-line p-4 flex flex-col items-center gap-1.5">
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
    <div class="h-full w-full px-3 xl:px-5 pt-1.5 xl:pt-2 pb-3 xl:pb-5 flex flex-col gap-3 xl:gap-5 overflow-y-auto dash-scroll">
      ${renderHero(state, store)}
      <div class="dash-row grid grid-cols-1 md:grid-cols-2 gap-3 xl:gap-4">
        <div class="flex flex-col min-h-0">${renderStandings(state, store)}</div>
        <div class="flex flex-col gap-3 xl:gap-4 min-h-0">
          ${renderItinerary(state, store)}
          ${renderHomework(state, store)}
        </div>
      </div>
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
