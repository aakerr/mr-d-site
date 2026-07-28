// dashboard.js — Daily Morning Dashboard (home screen)
// Owned module. Follows ARCHITECTURE.md contract.

import { escapeHtml, escapeAttr } from '../core/escape.js';
import { prefersReducedMotion } from '../core/util.js';

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

/* Module tile row: a FIXED column count (the old md:grid-cols-6) meant the
   day the 7th tile (Wheel of Fate, 5.4) showed up, six sat in a tidy row and
   the seventh wrapped alone onto a second line under nothing. auto-fit does
   what a fixed count can't: it grows however many tiles fit at >=132px each
   to fill the row evenly, and only truly wraps once there are too many for
   the width to hold — six tiles stretch a little wider, seven fit flush, an
   eventual eighth or ninth degrades by wrapping instead of by squeezing
   illegibly thin. Mobile keeps the plain 3-column grid (Tailwind's
   grid-cols-3, still in the markup) below this breakpoint. */
@media (min-width: 768px) {
  .dash-tiles-grid { grid-template-columns: repeat(auto-fit, minmax(132px, 1fr)); }
}

/* 7.3 — bell-ringer countdown, in the Daily Itinerary panel header. Ephemeral
   module-scope state (see bellDeadline etc. below), not the store — nothing
   here is worth persisting or logging. */
.dash-bell-root { position: relative; display: flex; align-items: center; flex-shrink: 0; }
.dash-bell-chip {
  display: flex; align-items: center; gap: 0.3rem; min-height: 30px;
  padding: 0.25rem 0.6rem; border-radius: 999px; border: 1px solid var(--color-line, #374151);
  background: var(--color-card2, #1f2937); color: #9ca3af; font-size: 0.72rem; font-weight: 700;
  cursor: pointer; transition: color 150ms ease, border-color 150ms ease, transform 150ms ease;
  touch-action: manipulation; white-space: nowrap;
}
.dash-bell-chip:hover { color: var(--accent, #f59e0b); border-color: var(--accent, #f59e0b); }
.dash-bell-chip:active { transform: scale(0.94); }
.dash-bell-picker {
  position: absolute; top: calc(100% + 6px); right: 0; z-index: 20; min-width: 172px;
  display: flex; flex-direction: column; gap: 0.5rem; padding: 0.6rem;
  background: var(--color-card, #111827); border: 1px solid var(--color-line, #374151);
  border-radius: 0.75rem; box-shadow: 0 12px 32px rgba(0,0,0,0.5);
}
.dash-bell-picker-row { display: flex; gap: 0.4rem; }
.dash-bell-preset-btn {
  flex: 1; min-height: 34px; padding: 0.3rem 0.4rem; border-radius: 0.5rem;
  border: 1px solid var(--color-line, #374151); background: var(--color-card2, #1f2937);
  color: var(--color-text, #f9fafb); font-size: 0.76rem; font-weight: 700; cursor: pointer;
  touch-action: manipulation;
}
.dash-bell-preset-btn:hover { border-color: var(--accent, #f59e0b); }
.dash-bell-preset-btn:active { transform: scale(0.95); }
.dash-bell-picker-custom { display: flex; gap: 0.4rem; }
.dash-bell-custom-input {
  width: 0; flex: 1; min-width: 0; min-height: 34px; padding: 0.3rem 0.5rem; border-radius: 0.5rem;
  border: 1px solid var(--color-line, #374151); background: var(--color-card2, #1f2937);
  color: var(--color-text, #f9fafb); font-size: 0.8rem;
}
.dash-bell-running { display: flex; align-items: center; gap: 0.5rem; }
.dash-bell-time {
  font-variant-numeric: tabular-nums; font-weight: 800; letter-spacing: 0.02em;
  font-size: clamp(1.3rem, 3.4vh, 2.3rem); color: var(--accent, #f59e0b); line-height: 1;
  text-shadow: 0 0 14px rgba(245,158,11,0.35);
}
.dash-bell-time.dash-bell-done { color: #fbbf24; }
.dash-bell-cancel {
  width: 26px; height: 26px; min-width: 26px; border-radius: 999px;
  border: 1px solid var(--color-line, #374151); background: var(--color-card2, #1f2937);
  color: #9ca3af; font-size: 0.8rem; cursor: pointer; touch-action: manipulation; flex-shrink: 0;
}
.dash-bell-cancel:active { transform: scale(0.92); }
.dash-bell-pulse { animation: dash-bell-pulse 1s ease-in-out infinite; }
@keyframes dash-bell-pulse { 0%, 100% { opacity: 1; } 50% { opacity: 0.5; } }
@media (prefers-reduced-motion: reduce) {
  .dash-bell-pulse { animation: none; }
}
`;

// module id -> PNG icon (368x370, transparent). Unknown ids fall back to
// their registered emoji so the plugin/tile pattern keeps working.
const MODULE_ICON_MAP = {
  // Records' tile shows the same scroll art as the masthead one tap away —
  // the tile-emoji/screen-art mismatch was the exact class of thing the
  // owner asked to be hunted down (see the Battle Day mark).
  houses: 'images/icon-points.png',
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
  wheel: 'Spin for a house',
};

// ---- 7.3 bell-ringer countdown timer ---------------------------------------
// Module-scoped, NOT in `state` — the store has nothing to say about a bell
// timer and never should (no undo history for "5 more minutes on the map
// quiz"). This screen rebuilds its whole DOM from a string on every store
// change (dash-in fade-ins and all), so a timer living in the render() closure
// would forget itself the moment a point got awarded anywhere in the app.
// Living up here instead, it survives that — and survives navigating away and
// back too, on purpose: the deadline is a wall-clock TIMESTAMP, never a tick
// count, so time spent on another screen is accounted for automatically
// rather than the countdown silently pausing while unmounted.
let bellDeadline = null;     // ms epoch the timer reaches zero, or null when idle
let bellDoneUntil = null;    // ms epoch the "TIME!" beat clears itself, or null
let bellPickerOpen = false;  // preset/custom picker popover open
let bellTickId = null;       // the one 1s interval — only alive while a timer is actually running
let bellDoneTimeoutId = null; // clears the "TIME!" beat back to idle

const BELL_DONE_MS = 3000;     // how long "TIME!" holds before auto-clearing
const BELL_PRESETS = [2, 5, 10]; // minutes

function bellRemainingLabel(ms) {
  const total = Math.max(0, Math.ceil(ms / 1000));
  const m = Math.floor(total / 60);
  const s = total % 60;
  return `${m}:${String(s).padStart(2, '0')}`;
}

// Renders whichever of the four bell states applies right now — idle chip,
// open picker, running countdown, or the "TIME!" beat — always inside the
// same data-bell-root wrapper so a targeted repaint (see repaintBell) can
// swap just this subtree without touching the rest of the dashboard.
function bellChipHtml() {
  if (bellDoneUntil != null) {
    const reduced = prefersReducedMotion();
    return `<div data-bell-root class="dash-bell-root">
      <div class="dash-bell-time dash-bell-done${reduced ? '' : ' dash-bell-pulse'}">TIME!</div>
    </div>`;
  }
  if (bellDeadline != null) {
    const remaining = bellDeadline - Date.now();
    return `<div data-bell-root class="dash-bell-root">
      <div class="dash-bell-running">
        <span class="dash-bell-time">${bellRemainingLabel(remaining)}</span>
        <button type="button" data-bell-cancel class="dash-bell-cancel" aria-label="Cancel timer">✕</button>
      </div>
    </div>`;
  }
  if (bellPickerOpen) {
    return `<div data-bell-root class="dash-bell-root">
      <button type="button" data-bell-toggle class="dash-bell-chip" aria-label="Bell-ringer timer">⏱ Timer</button>
      <div class="dash-bell-picker">
        <div class="dash-bell-picker-row">
          ${BELL_PRESETS.map((m) => `<button type="button" data-bell-preset="${m}" class="dash-bell-preset-btn">${m} min</button>`).join('')}
        </div>
        <div class="dash-bell-picker-custom">
          <input type="number" inputmode="numeric" min="1" max="180" step="1" placeholder="Custom min" data-bell-custom-input class="dash-bell-custom-input" />
          <button type="button" data-bell-custom-start class="dash-bell-preset-btn">Start</button>
        </div>
      </div>
    </div>`;
  }
  return `<div data-bell-root class="dash-bell-root">
    <button type="button" data-bell-toggle class="dash-bell-chip" aria-label="Bell-ringer timer">⏱ Timer</button>
  </div>`;
}

// The header row shared by all three renderItinerary() branches — same
// sectionHeader() icon+label, plus the bell chip riding along on the right.
function itineraryHeaderHtml() {
  return `<div class="flex items-center justify-between gap-2 mb-1.5">
    <div class="flex items-center gap-2 text-gray-400 text-sm font-semibold uppercase tracking-wide">${icon('calendar')}<span>Daily Itinerary</span></div>
    ${bellChipHtml()}
  </div>`;
}

// Swaps just the bell subtree for a fresh one — used by the 1s tick and by
// the picker/cancel actions, so a running countdown updates every second
// without re-rendering (and re-fading-in) the entire dashboard around it.
function repaintBell(el) {
  if (!el || !el.isConnected) return;
  const root = el.querySelector('[data-bell-root]');
  if (!root) return;
  root.outerHTML = bellChipHtml();
}

function stopBellInterval() {
  if (bellTickId) { clearInterval(bellTickId); bellTickId = null; }
}

function startBellInterval(el, ctx) {
  stopBellInterval();
  bellTickId = setInterval(() => tickBell(el, ctx), 1000);
}

function tickBell(el, ctx) {
  if (!el || !el.isConnected) { stopBellInterval(); return; }
  if (bellDeadline != null && Date.now() >= bellDeadline) {
    // Time's up: stop counting, ring the existing points-awarded chime (the
    // "gentle chime" 7.3 asks for IS this one — SFX_SLOTS' 'coin' slot, the
    // same cue every point award already plays), hold "TIME!" a beat, then
    // clear itself back to idle. No store write anywhere in this path.
    bellDeadline = null;
    stopBellInterval();
    bellDoneUntil = Date.now() + BELL_DONE_MS;
    ctx.audio?.sfx?.('coin');
    repaintBell(el);
    clearTimeout(bellDoneTimeoutId);
    bellDoneTimeoutId = setTimeout(() => { bellDoneUntil = null; bellDoneTimeoutId = null; repaintBell(el); }, BELL_DONE_MS);
    return;
  }
  repaintBell(el);
}

function startBellTimer(minutes, el, ctx) {
  const ms = Math.round(Number(minutes) * 60000);
  if (!(ms > 0)) return;
  bellDeadline = Date.now() + ms;
  bellDoneUntil = null;
  bellPickerOpen = false;
  clearTimeout(bellDoneTimeoutId);
  bellDoneTimeoutId = null;
  startBellInterval(el, ctx);
  repaintBell(el);
}

function cancelBellTimer(el) {
  bellDeadline = null;
  bellDoneUntil = null;
  bellPickerOpen = false;
  stopBellInterval();
  clearTimeout(bellDoneTimeoutId);
  bellDoneTimeoutId = null;
  repaintBell(el);
}

function ensureStyle() {
  if (document.getElementById(STYLE_ID)) return;
  const s = document.createElement('style');
  s.id = STYLE_ID;
  s.textContent = STYLE;
  document.head.appendChild(s);
}

// Portrait, transparent-bg house shield — always contain-fit, never cropped.
function houseImg(house, cls, extraAttrs = '') {
  return `<img src="${escapeAttr(house.image)}" alt="${escapeAttr(house.name)} crest" class="${cls}" ${extraAttrs}
    onerror="this.onerror=null;this.style.display='none';" />`;
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

// 6.1 — a fresh install's fallback plan ("Bell Ringer: Map of the Fertile
// Crescent") used to read as today's ACTUAL schedule with nothing telling the
// class otherwise. store.getItineraryInfo()/getHomeworkInfo() now say when
// the fallback fired; this is the one line that tells a teacher, not the
// class, to go build the real thing.
function sampleCaption() {
  return `<div class="text-[11px] text-gray-500 italic mb-1 -mt-0.5">Sample plan &mdash; build yours in Admin &rarr; Planner.</div>`;
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
              <span class="text-xs xl:text-sm font-bold acc-text" style="--acc:${h.accent}">${escapeHtml(h.name)}</span>
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
      <img src="${escapeAttr(h.heroImage)}" alt="" class="absolute inset-0 w-full h-full object-cover object-center"
           onerror="this.onerror=null;this.style.display='none';" />
      <div class="absolute inset-0 bg-gradient-to-r from-black/85 via-black/50 to-black/10"></div>
      <!-- The three lines stay TIGHT together — a couple of px between each,
           the way Welcome/name already sat. What reaches the shield's top and
           bottom edges is the NAME growing, not space being distributed.
           An earlier attempt used justify-between, which spread the free height
           into the gaps instead: it aligned the edges but pushed the two gaps
           out to 12px each and left the name barely larger. The type does the
           work here; the gaps are meant to be small and equal. -->
      <!-- Easter egg: a 20x20 hotspot in the hero's bottom-left corner opens the
           banner tuner (tools/hero-tuner.js). No cursor change, no hover state,
           no label — you have to know it is there, which is the point.
           z-20 puts it over the gradient but it is the only thing in that corner,
           so it cannot steal a click from anything real. Worst case if a student
           finds it: a panel of sliders that saves nothing and closes on reload. -->
      <div data-hero-tuner class="absolute left-0 bottom-0 z-20" style="width:20px;height:20px" aria-hidden="true"></div>
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
            ${escapeHtml(h.name.toUpperCase())}!
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
                  <span class="font-bold text-[clamp(1rem,2.65vh,1.625rem)] truncate acc-text" style="--acc:${t.house.accent}">${escapeHtml(t.house.name)}</span>
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

// 6.5 — itinerary times are bare strings ("8:05", "1:45") with no AM/PM. This
// app's school day only ever spans 8am to ~2:30pm, so the ambiguous hours
// (1-6) are always the after-lunch stretch and everything else (7-12) is
// already unambiguous — the shipped data runs 8:05 straight through 2:30 on
// exactly that rule. Converting to minutes-since-midnight on it turns "which
// core is next" into a plain numeric comparison against the real clock.
function schoolMinutes(timeStr) {
  const m = /^(\d{1,2}):(\d{2})$/.exec(String(timeStr || '').trim());
  if (!m) return null;
  let h = Number(m[1]);
  const min = Number(m[2]);
  if (h < 7) h += 12;
  return h * 60 + min;
}

// Which core's day starts next, by the clock — wrapping back to whichever
// core starts earliest once the last one has already begun. Returns null
// only when no core has a single timed itinerary item to compare, which is
// the one case still worth a shrug.
function findNextCore(store) {
  const now = new Date();
  const nowMinutes = now.getHours() * 60 + now.getMinutes();
  const candidates = [1, 2, 3, 4]
    .map((core) => {
      const first = store.getItinerary(core)[0];
      const mins = first ? schoolMinutes(first.time) : null;
      return mins == null ? null : { core, mins, time: first.time };
    })
    .filter(Boolean)
    .sort((a, b) => a.mins - b.mins);
  if (!candidates.length) return null;
  return candidates.find((c) => c.mins >= nowMinutes) || candidates[0];
}

function itineraryItemsHtml(items) {
  return items.length ? items.map((it, i) => `
    <div class="flex items-start gap-2.5 shrink-0">
      <span class="shrink-0 flex items-center justify-center rounded-md bg-card2 border border-line font-bold text-gray-200" style="width:clamp(1.25rem,2.7vh,1.6rem); height:clamp(1.25rem,2.7vh,1.6rem); font-size:clamp(0.65rem,1.3vh,0.85rem);">${i + 1}</span>
      <span class="text-gray-200 leading-snug" style="font-size:clamp(0.9rem,1.9vh,1.15rem);">${escapeHtml(it.text)}</span>
    </div>`).join('') : '<div class="text-gray-500 italic">Nothing scheduled.</div>';
}

function homeworkItemsHtml(items) {
  return items.length ? items.map((hw) => `
    <div class="flex items-center gap-2.5 shrink-0">
      <span class="shrink-0 rounded-md bg-valhalla/20 border border-valhalla/50 font-bold text-valhalla dash-hw-badge" style="padding:clamp(2px,0.4vh,5px) 9px; font-size:clamp(0.65rem,1.3vh,0.85rem);">Due ${escapeHtml(hw.due)}</span>
      <span class="text-gray-200 leading-snug" style="font-size:clamp(0.9rem,1.9vh,1.15rem);">${escapeHtml(hw.text)}</span>
    </div>`).join('') : '<div class="text-gray-500 italic">Nothing due. Enjoy it!</div>';
}

// The "Up next" strip shared by both All-Cores panels: a house-accented label
// naming the core whose day starts soonest, plus the tap target that switches
// the board to it (same store.setActiveCore() path as the top-bar switcher).
function upNextHeaderHtml(store, next) {
  const house = store.HOUSES[next.core];
  const acc = house ? house.accent : '';
  return `<div class="text-xs font-bold uppercase tracking-wide mb-1 acc-text" style="--acc:${acc}">Up next: Core ${next.core} &middot; ${escapeHtml(next.time)}</div>`;
}

function renderItinerary(state, store) {
  if (state.activeCore === 'all') {
    const next = findNextCore(store);
    if (!next) {
      return `
        <div class="dash-in bg-card rounded-2xl border-2 dash-accent-line p-[clamp(6px,1.2vh,16px)] flex flex-col flex-[3] min-h-0">
          ${itineraryHeaderHtml()}
          <div class="text-gray-400 italic flex-1 flex items-center justify-center text-center px-4">
            Pick a house core to see today's schedule.
          </div>
        </div>`;
    }
    const info = store.getItineraryInfo(next.core);
    return `
      <div data-nextcore="${next.core}" class="dash-in bg-card rounded-2xl border-2 dash-accent-line p-[clamp(6px,1.2vh,16px)] flex flex-col flex-[3] min-h-0 cursor-pointer" title="Tap to switch the board to this house core">
        ${itineraryHeaderHtml()}
        ${upNextHeaderHtml(store, next)}
        ${info.sample ? sampleCaption() : ''}
        <div data-scroll="itinerary" class="flex flex-col gap-2 overflow-y-auto dash-scroll pr-1">${itineraryItemsHtml(info.items)}</div>
      </div>`;
  }
  const info = store.getItineraryInfo();
  return `
    <div class="dash-in bg-card rounded-2xl border-2 dash-accent-line p-[clamp(6px,1.2vh,16px)] flex flex-col flex-[3] min-h-0">
      ${itineraryHeaderHtml()}
      ${info.sample ? sampleCaption() : ''}
      <div data-scroll="itinerary" class="flex flex-col gap-2 overflow-y-auto dash-scroll pr-1">${itineraryItemsHtml(info.items)}</div>
    </div>`;
}

function renderHomework(state, store) {
  if (state.activeCore === 'all') {
    const next = findNextCore(store);
    if (!next) {
      return `
        <div class="dash-in bg-card rounded-2xl border-2 dash-accent-line p-[clamp(4px,1vh,12px)] flex flex-col flex-[2] min-h-0">
          ${sectionHeader('book', 'Homework &amp; Upcoming Quizzes')}
          <div class="text-gray-400 italic">Pick a house core to see assignments.</div>
        </div>`;
    }
    const info = store.getHomeworkInfo(next.core);
    return `
      <div data-nextcore="${next.core}" class="dash-in bg-card rounded-2xl border-2 dash-accent-line p-[clamp(4px,1vh,12px)] flex flex-col flex-[2] min-h-0 cursor-pointer" title="Tap to switch the board to this house core">
        ${sectionHeader('book', 'Homework &amp; Upcoming Quizzes')}
        ${info.sample ? sampleCaption() : ''}
        <div data-scroll="homework" class="flex flex-col gap-2 overflow-y-auto dash-scroll pr-1">${homeworkItemsHtml(info.items)}</div>
      </div>`;
  }
  const info = store.getHomeworkInfo();
  return `
    <div class="dash-in bg-card rounded-2xl border-2 dash-accent-line p-[clamp(4px,1vh,12px)] flex flex-col flex-[2] min-h-0">
      ${sectionHeader('book', 'Homework &amp; Upcoming Quizzes')}
      ${info.sample ? sampleCaption() : ''}
      <div data-scroll="homework" class="flex flex-col gap-2 overflow-y-auto dash-scroll pr-1">${homeworkItemsHtml(info.items)}</div>
    </div>`;
}

function renderModuleTiles(registry) {
  const tiles = registry.modules().filter((m) => m.showTile && m.id !== 'dashboard');
  if (!tiles.length) return '';
  return `
    <div class="dash-in">
      <div class="w-full h-[3px] rounded-full mb-3 xl:mb-4"
           style="background: linear-gradient(90deg, transparent, var(--accent, #f59e0b) 12%, var(--accent, #f59e0b) 88%, transparent);"></div>
      <div class="grid grid-cols-3 dash-tiles-grid gap-3 xl:gap-4 w-full">
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
  // This screen re-renders from a string on EVERY store change, and a fresh
  // DOM starts at scrollTop 0 — so a teacher reading halfway down the
  // itinerary or homework panel got yanked back to the top by a point award
  // made anywhere in the app. Same fix quests.js carries: capture each
  // scroll container's position before the rebuild and put it back before
  // paint. Keyed by name, not index, because the itinerary panel only has a
  // scroll container when a house core is active — a core switch must not
  // hand the itinerary's old position to the homework panel.
  const kept = {};
  root.querySelectorAll('[data-scroll]').forEach((n) => { kept[n.dataset.scroll] = n.scrollTop; });
  root.innerHTML = `
    <div data-scroll="page" class="h-full w-full px-3 xl:px-5 pt-1.5 xl:pt-2 pb-3 xl:pb-5 flex flex-col gap-3 xl:gap-5 overflow-y-auto dash-scroll">
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
  root.querySelectorAll('[data-scroll]').forEach((n) => {
    const top = kept[n.dataset.scroll];
    if (top) n.scrollTop = top;
  });
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
    // The bell timer's own state (bellDeadline/bellDoneUntil) is module-scope
    // and outlives navigating away from this screen — see the comment above
    // its declaration. A "TIME!" beat that finished while the teacher was on
    // another screen should not still be showing when they come back.
    if (bellDoneUntil != null && Date.now() >= bellDoneUntil) {
      bellDoneUntil = null;
    } else if (bellDoneUntil != null) {
      bellDoneTimeoutId = setTimeout(() => { bellDoneUntil = null; bellDoneTimeoutId = null; repaintBell(el); }, bellDoneUntil - Date.now());
    }
    render(el, ctx);

    this._clickHandler = (e) => {
      // The hidden corner hotspot. Loaded on demand so the tuner costs nothing
      // until someone who knows about it asks for it, and a missing or broken
      // tool file can never take the dashboard down with it.
      if (e.target.closest('[data-hero-tuner]')) {
        import('../../tools/hero-tuner.js')
          .then((m) => m.openHeroTuner())
          .catch((err) => console.warn('hero tuner unavailable:', err?.message || err));
        return;
      }

      // 7.3 — bell-ringer timer chip/picker/cancel. No store writes anywhere
      // in this branch; see the bell* functions above render().
      if (e.target.closest('[data-bell-toggle]')) { bellPickerOpen = !bellPickerOpen; repaintBell(el); return; }
      const presetBtn = e.target.closest('[data-bell-preset]');
      if (presetBtn) { startBellTimer(Number(presetBtn.dataset.bellPreset), el, ctx); return; }
      if (e.target.closest('[data-bell-custom-start]')) {
        const input = el.querySelector('[data-bell-custom-input]');
        const mins = input ? Number(input.value) : NaN;
        if (Number.isFinite(mins) && mins > 0 && mins <= 180) startBellTimer(mins, el, ctx);
        return;
      }
      if (e.target.closest('[data-bell-cancel]')) { cancelBellTimer(el); return; }

      // 6.5 — All-Cores mode's itinerary/homework panels preview whichever
      // core's day starts next; tapping either one switches the board to it,
      // the same store call the top-bar core switcher uses.
      const nextCoreEl = e.target.closest('[data-nextcore]');
      if (nextCoreEl) { ctx.store.setActiveCore(Number(nextCoreEl.dataset.nextcore)); return; }

      const btn = e.target.closest('[data-nav]');
      if (!btn) return;
      const id = btn.getAttribute('data-nav');
      // 6.4 REVISED (owner spec, 2026-07-27): the Records tile — trophy art,
      // "Records" title, unchanged — is the drill-down DOOR to the standings,
      // not Records itself. Tapping it opens the Council of Four podium; the
      // podium is the one that goes on to send a tapped house into Records
      // (council.js's job, not this file's). No new tile, no new module id.
      if (id === 'houses') { ctx.registry.navigate('council'); return; }
      ctx.registry.navigate(id);
    };
    el.addEventListener('click', this._clickHandler);

    this._unsub = ctx.store.subscribe(() => render(el, ctx));
    this._el = el;
    this._ctx = ctx;

    // A timer already running (from before this mount, e.g. a quick trip to
    // Battle Day and back) resumes ticking against its same wall-clock
    // deadline — nothing to recompute, just start painting it again.
    if (bellDeadline != null) startBellInterval(el, ctx);
  },

  unmount() {
    stopBellInterval();
    if (bellDoneTimeoutId) { clearTimeout(bellDoneTimeoutId); bellDoneTimeoutId = null; }
    if (this._unsub) { this._unsub(); this._unsub = null; }
    if (this._el && this._clickHandler) this._el.removeEventListener('click', this._clickHandler);
    this._el = null;
    this._ctx = null;
  },
};
