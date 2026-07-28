// shop.js — The Magic Shop. Houses spend accumulated TERM points on items for
// whichever battle system is active (store.getCombatMode()): under Mr. D's
// duel rules EVERY purchase is banked into the house armoury for Battle Day;
// under hit-points rules weapons stockpile while shields and wildcards fire
// on the spot. The shop is open all week — Friday is when the armoury gets
// USED, not the only day it can be filled.
// The item catalog is teacher-editable (Admin) and lives in the store —
// this module renders whatever store.getShopItems() returns, live.
// Owns ONLY this file. Follows ARCHITECTURE.md contract.
import { escapeHtml as esc, escapeAttr } from '../core/escape.js';
import { media } from '../core/media.js';
import { rollInHost } from './dice3d/roll.js';
import { lock } from '../core/lock.js';
import { injectCarouselStyles, carouselHtml, wireCarousel, carouselScrollLeft } from '../core/carousel.js';
import { makeTimerSet } from '../core/util.js';

const STYLE_ID = 'shop-styles';
const PURPLE = '#a78bfa';
const PURPLE_SOFT = 'rgba(167,139,250,0.35)';
// Valid effect.kind values are the STORE's business, per combat mode — see
// store.SHOP_KINDS / store.DUEL_KINDS and store.shopKindsForMode(). A
// hand-copied list here once knew only the hit-points kinds, which marked
// every card "Misconfigured" in the shipped default duel mode. Never again.

// ---- module-scoped lifecycle state -----------------------------------------
let ctxRef = null;
let rootEl = null;
let unsub = null;
let clickHandler = null;
let currentRenderFn = null; // set while mounted; lets async media loads trigger a re-render
let activeWildRollDispose = null; // dispose fn for an in-flight dice3d roll, cleared on settle/unmount
let wildRollActive = false; // true from purchase-confirm through overlay teardown — blocks a second concurrent roll
// Set while a PAID wildcard's outcome hasn't been written to the store yet
// (the die is still tumbling). Holds the recorder function so unmount() can
// decide the fate with a substitute draw — a house that has spent its points
// must get its outcome, wherever the teacher navigates. See playWildReveal.
let pendingWildOutcome = null;
// In-flight guard for resolvePurchase() — module-scoped (not a DOM attribute
// or state on `s`) because a store mutation mid-purchase (store.purchase(),
// addPoints(), activateShield(), etc.) triggers store.subscribe(doRender),
// which rebuilds the whole screen via innerHTML and would otherwise wipe out
// a disabled attribute set on the old button node. Set synchronously before
// the `lock.requireUnlock()` await (see resolvePurchase), so a double-tap on
// Confirm in the same tick is blocked before it ever reaches store.purchase()
// — the same pattern battle.js's `resolving` and dice.js's `awardInFlight`
// use. Cleared in a `finally` so a refused PIN can't wedge the modal.
let purchaseInFlight = false;
let carouselTeardown = null; // teardown fn from wireCarousel — torn down before every re-render and on unmount
// Toast/banner host lives on <body>, not inside rootEl (houses.js's pattern):
// every store change rebuilds rootEl via innerHTML, which would wipe a toast
// mid-animation — often the very toast explaining the change. Created on
// mount, removed (children and all) on unmount.
let toastHost = null;
const { timers, later, clearTimers } = makeTimerSet('shop');
const fxNodes = new Set();  // transient combat-effect DOM nodes, force-cleaned on unmount

// ---- pressed-pointer render deferral ---------------------------------------
// Ported from houses.js, which documents the root cause in full: a store emit
// from ANYWHERE — the top bar's quick award, another module's write — rebuilds
// this whole screen via innerHTML. If that lands while the teacher's finger is
// physically down on a BUY button, the pressed node is torn out of the
// document before pointerup, and per the browsers' click-dispatch rules the
// tap silently never becomes a click. So: never rebuild while a pointer is
// down inside the shop; hold the render until release. A watchdog guards
// against ever losing a pointerup (e.g. focus leaving the window mid-press)
// and leaving the screen silently stale forever.
let pointerDownInside = false;
let renderDeferred = false;
let deferWatchdog = null;

function clearDeferWatchdog() {
  if (deferWatchdog) { clearTimeout(deferWatchdog); deferWatchdog = null; }
}
function onShopPointerDown(e) {
  if (rootEl && rootEl.contains(e.target)) pointerDownInside = true;
}
function onShopPointerRelease() {
  pointerDownInside = false;
  clearDeferWatchdog();
  if (renderDeferred) { renderDeferred = false; if (currentRenderFn) currentRenderFn(); }
}

// image URL resolution cache — persists across mount/unmount, keyed by media key
const mediaUrlCache = new Map(); // mediaKey -> url string | null (null = resolved, no file)
// mediaKey -> token for the lookup currently in flight. A token (not a Set):
// eviction mid-flight deletes the entry, and the settle handler only writes
// the cache if ITS token is still the current one — so a lookup started
// before the file changed can never re-cache the now-revoked URL, even if a
// fresh lookup for the same key has already begun.
const mediaFetching = new Map();

// media.js announces every put/delete with this event — the one signal that
// any object URL previously handed out for that key is now revoked (its
// header names this file as the listener; change the name in both places or
// not at all). Registered ONCE at module scope, not per mount: the cache
// itself outlives mounts, so its invalidation must too, and a per-mount
// listener would stack duplicates across visits. If the shop is on screen,
// repaint so the next resolveItemImage re-fetches — through the same holds
// the store subscription honours (mid-purchase, mid-reveal, finger down).
window.addEventListener('mrd:media-changed', (e) => {
  const key = e && e.detail ? e.detail.key : null;
  if (key == null) return;
  mediaUrlCache.delete(key);
  mediaFetching.delete(key);
  if (!currentRenderFn || purchaseInFlight || wildRollActive) return;
  if (pointerDownInside) { renderDeferred = true; return; }
  currentRenderFn();
});

// ---- per-mount UI state -----------------------------------------------------
// The buyer is never chosen in-shop anymore — it's whatever house is active in
// the top bar (store.getActiveHouse()), read fresh on every render.
function initState() {
  return {
    confirm: null,          // { itemId, buyerId } — every kind now confirms untargeted
  };
}

function clearFx() { fxNodes.forEach((n) => { try { n.remove(); } catch (e) {} }); fxNodes.clear(); }

// mm/hh remaining-time formatters shared by shield/reduction displays.
function fmtRemain(ms) {
  if (ms <= 0) return null;
  const totalMins = Math.max(1, Math.round(ms / 60000));
  const hrs = Math.floor(totalMins / 60);
  const mins = totalMins % 60;
  return hrs > 0 ? `${hrs}h ${mins}m left` : `${mins}m left`;
}
function kindLabel(kind) {
  return {
    // hit-points kinds
    attack: '⚔️ Attack',
    steal: '🐴 Steal',
    pierce: '🫥 Pierce — ignores defenses',
    shield: '🛡️ Defense',
    reduce: '🕵️ Defense (Mythic)',
    wild: '🎲 Wildcard',
    // Mr. D's duel kinds ('steal' is shared — same label either way)
    damage: '⚔️ Attack',
    freeze: '🧊 Freeze',
    block: '🛡️ Defense',
    reveal: '🔮 Reveal',
    hide: '🌫️ Conceal',
    timeturn: '⏳ Time Turn',
    extraslot: '🎒 Extra Slot',
  }[kind] || kind;
}

// Maps a d20 result to a wild-swing outcome, scaled off the item's own
// `effect.amount` so teacher-created wildcards work the same way:
//   1: -100%  2-5: -60%  6-9: -30%  10-11: nothing  12-15: +30%  16-19: +60%  20: +100%
function wildOutcomeTable(amount) {
  const amt = Math.max(1, Math.round(Number(amount) || 1));
  return [
    { min: 1, max: 1, pct: -1 },
    { min: 2, max: 5, pct: -0.6 },
    { min: 6, max: 9, pct: -0.3 },
    { min: 10, max: 11, pct: 0 },
    { min: 12, max: 15, pct: 0.3 },
    { min: 16, max: 19, pct: 0.6 },
    { min: 20, max: 20, pct: 1 },
  ].map((row) => ({ ...row, amount: Math.round(amt * row.pct) }));
}

function wildRowForRoll(value, table) {
  return table.find((r) => value >= r.min && value <= r.max) || null;
}

// Monday-based week start, matching store.js's own (private) startOfWeek() —
// duplicated here since store.js is lead-owned and doesn't expose it.
function startOfWeekLocal(d = new Date()) {
  const x = new Date(d);
  const day = (x.getDay() + 6) % 7; // Monday=0
  x.setHours(0, 0, 0, 0);
  x.setDate(x.getDate() - day);
  return x;
}

// Consumables (attack/steal/pierce/wild) aren't "ACTIVE" like shields — instead
// we show how many times this house has bought this item since Monday, read
// straight from the transaction log store.purchase() already writes
// (`Bought: <item name>`, tag 'shop').
function boughtThisWeekCount(store, houseId, itemName) {
  const since = startOfWeekLocal().getTime();
  const prefix = `Bought: ${itemName}`;
  return store.getTransactions({ houseId, limit: 100000 })
    .filter((t) => t.ts >= since && typeof t.reason === 'string' && t.reason.startsWith(prefix))
    .length;
}

// =============================================================================
// STYLES
// =============================================================================
function injectStyles() {
  if (document.getElementById(STYLE_ID)) return;
  const style = document.createElement('style');
  style.id = STYLE_ID;
  style.textContent = `
  .shop-root{position:relative;height:100%;overflow-y:auto;scrollbar-gutter:stable both-edges;padding:1.25rem clamp(1rem,3vw,2rem) 2rem;
    background:radial-gradient(ellipse at 50% -10%,rgba(88,28,135,.35),rgba(11,15,25,.5) 55%),
      linear-gradient(180deg,rgba(6,8,14,.4),rgba(6,8,14,.25) 40%,rgba(6,8,14,.35)),
      url('images/magic-shop.jpg') center 30%/cover no-repeat fixed,#0b0f19;}
  /* The wizard mark sits OUTSIDE the centred text block, so the title and
     subtitle centre on each other rather than on "icon + title". */
  /* treasury pill — the ONLY house shown is whatever's active in the top bar,
     so this is a wide identity pill (crest + name + total) rather than a picker. */
  /* Shields flank a points-only pill; the pill spans the width of the heading
     text above it (set at render time from the heading block's measured width). */
  .shop-treasury-row{display:flex;align-items:center;justify-content:center;
    gap:clamp(.6rem,1.6vw,1.4rem);margin:0 auto 1.5rem;}
  .shop-treasury-crest{height:clamp(3.2rem,8vw,5.4rem);width:auto;object-fit:contain;flex-shrink:0;
    filter:drop-shadow(0 6px 16px rgba(0,0,0,.6));}
  .shop-treasury .val{font-size:clamp(1.8rem,5vw,3rem);font-weight:800;color:#fde68a;
    font-variant-numeric:tabular-nums;line-height:1;}
  .shop-treasury .unit{font-size:clamp(.9rem,2.2vw,1.4rem);font-weight:700;color:#fde68a;
    margin-left:.4rem;opacity:.85;}
  .shop-treasury{display:flex;align-items:baseline;justify-content:center;
    background:#141225;border:2px solid ${PURPLE};border-radius:1.5rem;
    padding:clamp(.5rem,1.4vh,1rem) 1.5rem;box-shadow:0 0 26px ${PURPLE_SOFT};
    flex:0 0 auto;}

  /* one quiet line under the treasury naming the duel rule of the week */
  .shop-mode-note{max-width:720px;margin:-.5rem auto 1.25rem;text-align:center;color:#c4b5fd;
    font-style:italic;font-size:.95rem;}

  /* shown instead of the shop grid when the top bar is on "All Cores" */
  .shop-pickhouse{max-width:520px;margin:2.5rem auto;text-align:center;color:#c4b5fd;font-style:italic;
    font-size:1.15rem;padding:2.5rem 2rem;border:1px dashed #4c1d95;border-radius:1.25rem;}

  /* sections */
  .shop-section{max-width:1320px;margin:0 auto 1.75rem;}
  .shop-section-title{font-family:'Cinzel',Georgia,serif;font-weight:800;font-size:1.15rem;
    color:#e9d5ff;letter-spacing:.04em;margin-bottom:.75rem;text-align:center;
    text-shadow:0 0 16px rgba(167,139,250,.4);}

  /* Every section is its own flex row, not a grid — a grid's own
     auto-fit(minmax()) tracks always span the full row regardless of how many
     cards actually landed in it, so a lone last card just sat in the grid's
     first column, hugging the left edge under a row of empty cells. Flex-wrap
     has no such phantom cells: justify-content applies per wrapped LINE, so a
     partial last row centers itself while a full row fills out identically to
     the old grid. The basis has to be the 300px MAX, not the 240 min: that's
     what the grid's own auto-fit(minmax()) used to decide how many 300px
     columns fit per row, and matching it here keeps a full row's column count
     (and therefore its pixels) unchanged — min-width:240 is what still lets a
     row shrink that far on a narrow screen. */
  .shop-grid{display:flex;flex-wrap:wrap;gap:1.1rem;align-items:stretch;justify-content:center;}
  .shop-grid > .shop-card{flex:1 1 300px;min-width:280px;max-width:310px;}
  .shop-empty{max-width:600px;margin:0 auto;text-align:center;color:#9ca3af;font-style:italic;padding:2rem;
    border:1px dashed #4c1d95;border-radius:1.25rem;}
  /* Every card is a stretched grid cell laid out as a flex column, so equal-height
     rows fall out of the grid (align-items:stretch) instead of any fixed pixel
     height. Text areas below (name/flavor/status) are clamped to a fixed number
     of lines so the natural content height — and therefore the row height — is
     identical for every card, in every section, at every width. The BUY button
     rides margin-top:auto so it always sits on the bottom edge of the card. */
  .shop-card{position:relative;height:100%;box-sizing:border-box;border-radius:1.5rem;border:2px solid #4c1d95;
    background:linear-gradient(160deg,rgba(30,20,55,.92),rgba(11,15,25,.96));
    padding:1.4rem 1.2rem;display:flex;flex-direction:column;align-items:center;text-align:center;gap:.3rem;
    box-shadow:0 12px 34px rgba(76,29,149,.25);transition:transform .18s ease,box-shadow .18s ease;}
  .shop-card:hover{transform:translateY(-3px);box-shadow:0 16px 42px rgba(76,29,149,.4);}
  .shop-card-broken{border-color:#7f1d1d;border-style:dashed;opacity:.85;}
  .shop-card-emoji{font-size:3.4rem;filter:drop-shadow(0 4px 14px rgba(167,139,250,.5));line-height:1;}
  .shop-card-art{width:84px;height:84px;flex-shrink:0;display:flex;align-items:center;justify-content:center;}
  /* contain + padding, never cover: the art must sit WHOLE inside the frame
     with breathing room on every side (owner spec: at least 3px). cover
     cropped the tall Sword of Destiny and the Shield's corners. */
  .shop-card-img{width:100%;height:100%;object-fit:contain;padding:4px;box-sizing:border-box;
    border-radius:1rem;box-shadow:0 4px 14px rgba(167,139,250,.45);}
  .shop-card-name{font-weight:800;font-size:1.2rem;color:#e9d5ff;width:100%;flex-shrink:0;
    line-height:1.25;height:3rem;display:-webkit-box;-webkit-line-clamp:2;-webkit-box-orient:vertical;
    overflow:hidden;}
  .shop-kind-tag{font-size:.7rem;font-weight:700;color:#c4b5fd;letter-spacing:.03em;flex-shrink:0;
    background:rgba(167,139,250,.12);border:1px solid rgba(167,139,250,.35);
    border-radius:999px;padding:.2rem .6rem;box-sizing:border-box;height:1.7rem;max-width:100%;
    display:inline-flex;align-items:center;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;}
  .shop-cost-badge{position:absolute;top:14px;right:14px;background:${PURPLE};color:#1e1b3a;
    font-weight:800;font-size:.85rem;padding:.3rem .65rem;border-radius:999px;}
  .shop-flavor{color:#9ca3af;font-size:.9rem;line-height:1.4;width:100%;flex-shrink:0;
    height:4.2em;display:-webkit-box;-webkit-line-clamp:3;-webkit-box-orient:vertical;overflow:hidden;}
  /* fixed-height slot for the shield/reduce "ACTIVE" remaining-time line and the
     broken-item note — reserved even when empty so cards without one still match. */
  .shop-card-status{width:100%;flex-shrink:0;min-height:1.7rem;display:flex;flex-direction:column;
    align-items:center;justify-content:center;gap:.3rem;}
  .shop-broken-note{color:#fca5a5;font-size:.75rem;font-weight:700;background:rgba(127,29,29,.25);
    border:1px solid rgba(239,68,68,.4);border-radius:.6rem;padding:.4rem .6rem;}
  .shop-buy-btn{width:100%;min-height:56px;border-radius:1rem;font-weight:800;font-size:1.05rem;
    border:none;cursor:pointer;margin-top:auto;flex-shrink:0;color:#fff;
    background:linear-gradient(135deg,#a855f7,#7e22ce);box-shadow:0 8px 22px rgba(168,85,247,.4);
    transition:transform .14s ease,filter .14s ease,opacity .14s ease;touch-action:manipulation;}
  .shop-buy-btn:active:not(:disabled){transform:scale(.95);}
  .shop-buy-btn:hover:not(:disabled){filter:brightness(1.12);}
  .shop-buy-btn:disabled{opacity:.4;cursor:not-allowed;filter:grayscale(.3);}
  .shop-buy-btn.shop-active{background:linear-gradient(135deg,#16a34a,#15803d);box-shadow:0 8px 22px rgba(22,163,74,.4);}
  .shop-card.shake{animation:shop-shake .4s ease;}
  @keyframes shop-shake{
    0%,100%{transform:translateX(0);}
    20%{transform:translateX(-8px);}
    40%{transform:translateX(7px);}
    60%{transform:translateX(-5px);}
    80%{transform:translateX(3px);}
  }
  .shop-shield-remain{font-size:.75rem;color:#93c5fd;font-weight:700;}
  .shop-bought-badge{font-size:.75rem;color:#c4b5fd;font-weight:700;background:rgba(167,139,250,.14);
    border:1px solid rgba(167,139,250,.35);border-radius:.6rem;padding:.15rem .6rem;}

  /* ---- carousel layout — opt-in alternative to .shop-grid above, toggled via
     store.getLayout('shop'); the grid itself is untouched by any of this.
     ONE strip across every buyable item (offensive+defensive+wildcards+
     broken), not one strip per section: stacking a carousel per section would
     just trade the page's one vertical scroll for three or four, which is
     exactly what this layout exists to remove for a teacher standing at the
     board. Each card still prints its own kind-tag (Attack/Defense/Wildcard/
     Unavailable), so the category read survives without a section header. */
  .shop-carousel-outer{max-width:1320px;margin:0 auto 1.75rem;
    height:clamp(460px,58vh,520px);display:flex;
    --carousel-card-w:clamp(215px,18vw,250px);--carousel-card-maxh:440px;}

  /* confirm modal */
  .shop-modal-backdrop{position:fixed;inset:0;z-index:65;background:rgba(0,0,0,.72);
    display:flex;align-items:center;justify-content:center;padding:1.5rem;
    animation:shop-fade-in .2s ease both;}
  @keyframes shop-fade-in{from{opacity:0;}to{opacity:1;}}
  .shop-modal{width:min(440px,100%);background:#141225;border:2px solid ${PURPLE};border-radius:1.5rem;
    padding:1.75rem;box-shadow:0 24px 70px rgba(0,0,0,.7),0 0 60px ${PURPLE_SOFT};
    animation:shop-pop-in .25s cubic-bezier(.175,.885,.32,1.275) both;text-align:center;}
  @keyframes shop-pop-in{0%{opacity:0;transform:scale(.85) translateY(10px);}100%{opacity:1;transform:scale(1) translateY(0);}}
  .shop-modal-emoji{font-size:3rem;margin-bottom:.4rem;}
  .shop-modal-title{font-weight:800;font-size:1.3rem;color:#e9d5ff;margin-bottom:.6rem;}
  .shop-modal-body{color:#d1d5db;font-size:1rem;line-height:1.5;margin-bottom:1.4rem;}
  .shop-modal-body b{color:#fde68a;}
  .shop-modal-actions{display:flex;gap:.75rem;}
  .shop-modal-btn{flex:1;min-height:52px;border-radius:.85rem;font-weight:800;font-size:1rem;
    border:none;cursor:pointer;touch-action:manipulation;transition:transform .12s ease;}
  .shop-modal-btn:active{transform:scale(.95);}
  .shop-modal-confirm{background:linear-gradient(135deg,#a855f7,#7e22ce);color:#fff;}
  .shop-modal-cancel{background:#1f2937;color:#e5e7eb;border:1px solid #374151;}

  /* wildcard reveal — a real d20 roll decides the swing. The overlay itself is
     just a blur+scrim so the shop stays recognisable-but-out-of-focus behind
     it; the actual title/tray/stakes composition lives in .shop-wild-stage,
     simply centered on screen — no geometric pin to anything behind the blur
     (that fought the page's scroll position and was dropped). */
  .shop-wild-overlay{position:fixed;inset:0;z-index:80;overflow:hidden;
    background:rgba(7,9,18,.55);
    -webkit-backdrop-filter:blur(10px) saturate(115%);backdrop-filter:blur(10px) saturate(115%);}
  .shop-wild-overlay::before{content:'';position:absolute;inset:0;pointer-events:none;z-index:0;
    background:radial-gradient(ellipse at 50% 60%,rgba(76,29,149,.32),transparent 70%);}
  .shop-wild-flash{position:absolute;inset:0;pointer-events:none;z-index:3;
    background:radial-gradient(circle,#fff,#fde68a 55%,transparent 80%);opacity:0;}
  .shop-wild-overlay.shop-wild-flashing .shop-wild-flash{animation:shop-wild-flash-kf .18s ease both;}
  @keyframes shop-wild-flash-kf{0%{opacity:0;}45%{opacity:1;}100%{opacity:0;}}

  /* Title above, tray+stakes below — comfortably centered, capped so it never
     overflows the viewport on a smaller display. */
  .shop-wild-stage{position:fixed;top:50%;left:50%;transform:translate(-50%,-50%);z-index:1;
    display:flex;flex-direction:column;align-items:center;gap:1.5rem;
    width:min(1200px,94vw);max-height:94vh;overflow-y:auto;padding:0 1rem;}

  .shop-wild-header{text-align:center;}
  .shop-wild-header-emoji{font-size:3.5rem;filter:drop-shadow(0 0 24px rgba(167,139,250,.6));}
  .shop-wild-title{font-family:'Cinzel',Georgia,serif;font-weight:800;color:#e9d5ff;
    font-size:clamp(1.2rem,3vw,2rem);letter-spacing:.04em;margin-top:.4rem;
    text-shadow:0 0 20px rgba(167,139,250,.5);}

  /* dice tray + stakes table, side by side, STRETCHED to equal height so the
     stakes card is exactly as tall as the dice window either way. */
  .shop-wild-body{position:relative;display:flex;gap:2rem;align-items:stretch;justify-content:center;
    flex-wrap:wrap;width:100%;}
  .shop-wild-dice-frame{position:relative;width:min(720px,56vw);aspect-ratio:16/9;border-radius:1.5rem;
    overflow:hidden;box-shadow:0 24px 70px rgba(0,0,0,.65);}
  .shop-wild-dice-host{position:absolute;inset:0;border-radius:1.5rem;overflow:hidden;
    background:rgba(0,0,0,.35);border:1px solid rgba(167,139,250,.35);}

  /* the rolled number (raw d20 face) — shown large right over the tray the
     instant the die settles, before the swing is revealed. */
  .shop-wild-rolled-block{position:absolute;inset:0;z-index:5;display:none;
    align-items:center;justify-content:center;pointer-events:none;}
  .shop-wild-rolled-block.show{display:flex;}
  .shop-wild-rolled-number{font-family:'Cinzel',Georgia,serif;font-weight:800;color:#fde68a;
    font-size:clamp(4rem,11vw,7rem);text-shadow:0 6px 30px rgba(0,0,0,.85),0 0 40px rgba(253,230,138,.6);
    background:rgba(15,23,42,.4);border-radius:1.5rem;padding:.3rem 1.1rem;
    animation:shop-wild-number-kf .4s cubic-bezier(.34,1.56,.64,1) both;
    transition:opacity .3s ease;}
  .shop-wild-rolled-block.fading .shop-wild-rolled-number{opacity:0;}

  .shop-wild-table{background:rgba(17,24,39,.9);border:1px solid rgba(167,139,250,.35);
    border-radius:1rem;padding:1.1rem 1.3rem;min-width:280px;box-sizing:border-box;
    display:flex;flex-direction:column;justify-content:center;}
  .shop-wild-table-title{font-weight:800;color:#c4b5fd;font-size:1rem;letter-spacing:.08em;
    text-transform:uppercase;margin-bottom:.7rem;text-align:center;}
  .shop-wild-row{display:flex;justify-content:space-between;gap:1.5rem;padding:.45rem .6rem;
    border-radius:.6rem;font-size:1.15rem;color:#d1d5db;transition:background .3s ease,transform .3s ease;}
  .shop-wild-range{font-weight:700;color:#9ca3af;}
  .shop-wild-outcome{font-weight:800;}
  .shop-wild-row-hit{background:rgba(167,139,250,.32);transform:scale(1.08);}
  .shop-wild-row-hit .shop-wild-range,.shop-wild-row-hit .shop-wild-outcome{color:#fde68a;}

  /* Overlaid centered on the tray+table row (not stacked below it), so its
     appearance never shifts the layout. */
  .shop-wild-reveal-block{display:none;flex-direction:column;align-items:center;gap:.7rem;
    position:absolute;inset:0;z-index:2;justify-content:center;text-align:center;pointer-events:none;}
  .shop-wild-reveal-block.show{display:flex;}
  .shop-wild-number{font-family:'Cinzel',Georgia,serif;font-weight:800;
    font-size:clamp(3rem,10vw,6rem);text-shadow:0 4px 20px rgba(0,0,0,.7);
    animation:shop-wild-number-kf .5s cubic-bezier(.34,1.56,.64,1) both;}
  .shop-wild-number-good{color:#4ade80;}
  .shop-wild-number-bad{color:#f87171;}
  .shop-wild-number-neutral{color:#9ca3af;}
  @keyframes shop-wild-number-kf{
    0%{transform:scale(2.2);opacity:0;}
    60%{transform:scale(.9);opacity:1;}
    100%{transform:scale(1);opacity:1;}
  }
  .shop-wild-caption{color:#e9d5ff;font-weight:700;font-size:clamp(.95rem,2vw,1.2rem);
    background:rgba(15,23,42,.6);padding:.5rem 1rem;border-radius:.75rem;max-width:80vw;}
  .shop-wild-treasury-line{color:#fde68a;font-weight:800;font-variant-numeric:tabular-nums;
    font-size:clamp(1rem,2.4vw,1.5rem);opacity:0;transition:opacity .3s ease;}
  .shop-wild-treasury-line.show{opacity:1;}

  .shop-wild-overlay.shop-wild-fadeout{animation:shop-wild-fadeout-kf .35s ease forwards;}
  @keyframes shop-wild-fadeout-kf{to{opacity:0;}}

  /* result banner */
  .shop-banner{position:fixed;top:22px;left:50%;transform:translateX(-50%);z-index:70;
    background:#141225;border:2px solid ${PURPLE};border-radius:1rem;padding:.9rem 1.4rem;
    font-weight:800;color:#f9fafb;box-shadow:0 12px 34px rgba(0,0,0,.6),0 0 30px ${PURPLE_SOFT};
    animation:shop-banner-in .35s cubic-bezier(.175,.885,.32,1.275) both;text-align:center;max-width:90vw;}
  .shop-banner.shop-banner-out{animation:shop-banner-out .3s ease forwards;}
  @keyframes shop-banner-in{0%{opacity:0;transform:translate(-50%,-16px) scale(.9);}100%{opacity:1;transform:translate(-50%,0) scale(1);}}
  @keyframes shop-banner-out{to{opacity:0;transform:translate(-50%,-16px) scale(.9);}}

  /* toast (insufficient funds) */
  .shop-toast{position:fixed;bottom:28px;left:50%;transform:translateX(-50%);z-index:70;
    background:#7f1d1d;border:2px solid #ef4444;color:#fee2e2;font-weight:700;
    padding:.75rem 1.3rem;border-radius:.85rem;box-shadow:0 12px 30px rgba(0,0,0,.6);
    animation:shop-banner-in .3s ease both;}

  /* mythic rewards — a full section matching the others in weight, not fine
     print. Not buyable, but reads deliberately from across the room. */
  .shop-mythic-section{max-width:1320px;margin:0 auto 1.75rem;}
  .shop-mythic-heading{font-family:'Cinzel',Georgia,serif;font-weight:800;
    font-size:clamp(1.3rem,2.9vw,1.7rem);color:#fde68a;letter-spacing:.04em;
    margin-bottom:.9rem;text-align:center;text-shadow:0 0 20px rgba(251,191,36,.45);}
  .shop-mythic-sub{display:block;color:#c4b5fd;font-size:.9rem;font-weight:600;
    font-style:italic;margin-top:.3rem;letter-spacing:.01em;}
  .shop-mythic-grid{display:grid;grid-template-columns:repeat(auto-fit,minmax(260px,1fr));gap:1.1rem;}
  .shop-mythic-card{border-radius:1.5rem;border:2px solid rgba(251,191,36,.55);
    background:linear-gradient(160deg,rgba(120,53,15,.3),rgba(11,15,25,.94));
    padding:1.4rem 1.2rem;display:flex;flex-direction:column;align-items:center;text-align:center;gap:.55rem;
    box-shadow:0 12px 30px rgba(120,53,15,.28);}
  .shop-mythic-card-emoji{font-size:3.2rem;filter:drop-shadow(0 4px 14px rgba(251,191,36,.55));}
  .shop-mythic-card-name{font-weight:800;color:#fde68a;font-size:1.3rem;}
  .shop-mythic-card-tag{font-size:.72rem;font-weight:800;letter-spacing:.06em;color:#78350f;
    background:#fde68a;border-radius:999px;padding:.2rem .7rem;}
  .shop-mythic-card-desc{color:#e9d9b8;font-size:1.05rem;line-height:1.42;}

  @media (prefers-reduced-motion:reduce){
    .shop-card.shake,.shop-banner,.shop-toast,.shop-modal,.shop-modal-backdrop{animation:none;}
    .shop-wild-number,.shop-wild-rolled-number{animation:none;}
  }
  `;
  document.head.appendChild(style);
}

// =============================================================================
// item catalog helpers — validation + image resolution
// =============================================================================
// An item is renderable when the ACTIVE combat mode's engine implements it.
// The store owns the two kind lists (SHOP_KINDS for hit points, DUEL_KINDS for
// Mr. D's rules), so this can never drift from Admin's own save-time
// validation (store.saveShopItem). Duel items are validated by their real
// shape — damage/steal carry `dice`/`mult` and NO `effect.amount` — so the
// amount check is a hit-points-only rule.
function itemIssues(store, item) {
  if (!item || typeof item !== 'object') return ['missing item'];
  const issues = [];
  if (!item.name) issues.push('missing name');
  // Mythic rewards are never purchased with points — cost 0 is expected there.
  if (!item.mythicOnly && !(Number(item.cost) > 0)) issues.push('invalid cost');
  if (!item.effect || !store.shopKindsForMode().includes(item.effect.kind)) issues.push('unknown effect');
  else if (store.getCombatMode() !== 'duel' && !(Number(item.effect.amount) > 0)) issues.push('invalid amount');
  return issues;
}

// Returns a resolved <img> src string, null (no image / resolution failed), or
// undefined (a media: lookup is still in flight — caller should show the emoji
// for now; `onReady` fires once the async lookup settles so the caller can redraw).
function resolveItemImage(item, onReady) {
  const raw = item.image;
  if (!raw) return null;
  if (raw.startsWith('media:')) {
    const key = raw.slice(6);
    if (mediaUrlCache.has(key)) return mediaUrlCache.get(key);
    if (!mediaFetching.has(key)) {
      // The token pins this lookup to the cache generation it started in: if
      // the file changes mid-flight, the mrd:media-changed handler above
      // drops the entry, the token comparison fails, and this result — a URL
      // that was revoked while we waited — is discarded instead of cached.
      const token = {};
      mediaFetching.set(key, token);
      const settle = (url) => {
        if (mediaFetching.get(key) !== token) return; // superseded/evicted mid-flight
        mediaUrlCache.set(key, url || null);
        mediaFetching.delete(key);
        onReady && onReady();
      };
      media.url(key).then(settle).catch(() => settle(null));
    }
    return undefined;
  }
  return raw; // plain URL / path
}

// Always returns the same fixed-size art slot (image or emoji fallback) so
// every card's art occupies identical height, whether or not it has artwork.
// The broken-image fallback is wired AFTER render (wireCardImageFallbacks) —
// it used to be an inline onerror that embedded the emoji in a JS string,
// where an apostrophe in a teacher-typed emoji field terminated the string
// and killed the handler.
function itemArtHtml(item) {
  const resolved = resolveItemImage(item, () => { if (currentRenderFn) currentRenderFn(); });
  if (resolved) {
    return `<div class="shop-card-art"><img src="${escapeAttr(resolved)}" alt="${escapeAttr(item.name)}" class="shop-card-img"
      data-fallback-emoji="${escapeAttr(item.emoji || '✨')}" /></div>`;
  }
  return `<div class="shop-card-art"><div class="shop-card-emoji">${esc(item.emoji || '✨')}</div></div>`;
}

// If a card's artwork fails to load, swap in the emoji slot instead. Wired
// fresh after every render — listeners attach in the same task the <img>
// nodes are created, before any error event can fire, and DOM APIs
// (textContent) carry the emoji so no teacher-typed character can break out.
function wireCardImageFallbacks(root) {
  root.querySelectorAll('img.shop-card-img[data-fallback-emoji]').forEach((img) => {
    img.addEventListener('error', () => {
      const holder = img.parentElement;
      if (!holder) return;
      const fallback = document.createElement('div');
      fallback.className = 'shop-card-emoji';
      fallback.textContent = img.getAttribute('data-fallback-emoji') || '✨';
      holder.replaceChildren(fallback);
    }, { once: true });
  });
}

// =============================================================================
// RENDER
// =============================================================================
// Consumables (attack/steal/pierce/wild) show how many the buyer already
// bought this week — the only "you've already got one" signal that fits their
// repeatable nature, mirroring the shield/reduce "ACTIVE" line below.
const CONSUMABLE_KINDS = new Set(['attack', 'steal', 'pierce', 'wild']);

function itemCard(store, s, item, buyerId) {
  const issues = itemIssues(store, item);
  if (issues.length) {
    // Class-facing copy stays in-world: no "ask your teacher" from the shop
    // floor. The actual diagnostics live in Admin's shop editor, where the
    // teacher is the audience.
    const nm = item?.name || 'Unknown Item';
    const desc = item?.desc || '';
    return `
      <div class="shop-card shop-card-broken" data-card="${esc(item?.id || 'unknown')}">
        <div class="shop-card-art"><div class="shop-card-emoji">❓</div></div>
        <div class="shop-card-name" title="${esc(nm)}">${esc(nm)}</div>
        <div class="shop-kind-tag" title="Unavailable">⚠️ Unavailable</div>
        <div class="shop-flavor" title="${esc(desc)}">${esc(desc)}</div>
        <div class="shop-card-status"><div class="shop-broken-note">The shopkeeper has taken this one off the shelf.</div></div>
        <button type="button" class="shop-buy-btn" disabled>Unavailable</button>
      </div>`;
  }

  const kind = item.effect.kind;
  const treasury = store.getTotal(buyerId, 'term');
  const affordable = treasury >= item.cost;
  const art = itemArtHtml(item);
  const kindTag = `<div class="shop-kind-tag" title="${esc(kindLabel(kind))}">${esc(kindLabel(kind))}</div>`;

  // ---- Mr. D's duel rules: EVERY purchase banks into the armoury ------------
  // (the same store path Battle Day's mini-shop uses — see resolvePurchase).
  // The card shows what the house already holds and, when a slot-limited buy
  // would be refused, quotes store.duelCanBuy's own reason — so this screen
  // and the mini-shop can never disagree about the one-attack-one-defense
  // weekly rule.
  if (store.getCombatMode() === 'duel') {
    const held = store.countOwned(buyerId, item.id);
    const gate = store.duelCanBuy(buyerId, item.id);
    return `
      <div class="shop-card" data-card="${esc(item.id)}">
        <div class="shop-cost-badge">${item.cost} pts</div>
        ${art}
        <div class="shop-card-name" title="${esc(item.name)}">${esc(item.name)}</div>
        ${kindTag}
        <div class="shop-flavor" title="${esc(item.desc)}">${esc(item.desc)}</div>
        <div class="shop-card-status">
          ${held > 0 ? `<div class="shop-bought-badge">×${held} in your armoury</div>` : ''}
          ${!gate.ok ? `<div class="shop-broken-note">🚫 ${esc(gate.reason)}</div>` : ''}
        </div>
        <button type="button" class="shop-buy-btn" data-buy="${esc(item.id)}" ${gate.ok && affordable ? '' : 'disabled'}>
          ${gate.ok ? 'BUY' : 'SLOT FULL'}
        </button>
      </div>`;
  }

  // Shield & (non-mythic) reduce items are both self-buff "defense" purchases:
  // ACTIVE while in effect, rebuy disabled, remaining time shown.
  if (kind === 'shield' || kind === 'reduce') {
    const isActive = kind === 'shield' ? store.isShielded(buyerId) : store.hasReduction(buyerId);
    const remainMs = kind === 'shield' ? store.shieldRemainingMs(buyerId) : store.reductionRemainingMs(buyerId);
    const remain = isActive ? fmtRemain(remainMs) : null;
    return `
      <div class="shop-card" data-card="${esc(item.id)}">
        <div class="shop-cost-badge">${item.cost} pts</div>
        ${art}
        <div class="shop-card-name" title="${esc(item.name)}">${esc(item.name)}</div>
        ${kindTag}
        <div class="shop-flavor" title="${esc(item.desc)}">${esc(item.desc)}</div>
        <div class="shop-card-status">${isActive ? `<div class="shop-shield-remain">${kind === 'shield' ? '🛡️' : '🕵️'} ACTIVE — ${remain || 'protected'}</div>` : ''}</div>
        <button type="button" class="shop-buy-btn ${isActive ? 'shop-active' : ''}" data-buy="${esc(item.id)}"
          ${isActive ? 'disabled' : (affordable ? '' : 'disabled')}>
          ${isActive ? 'ACTIVE' : 'BUY'}
        </button>
      </div>`;
  }

  // Stockpiled kinds (attack/steal/pierce, per store.isStockpiled) never need
  // a target at purchase time — they're banked in the armoury and spent on
  // Battle Day, so attack / steal / pierce / wild all use the plain BUY card.
  const boughtCount = CONSUMABLE_KINDS.has(kind) ? boughtThisWeekCount(store, buyerId, item.name) : 0;
  // Stockpiled items (attack/steal/pierce) show what the house already holds
  // in its armoury from earlier purchases this week — the "you already have
  // ammo banked" signal store.countOwned exists for.
  const armouryCount = store.isStockpiled(item) ? store.countOwned(buyerId, item.id) : 0;
  return `
    <div class="shop-card" data-card="${esc(item.id)}">
      <div class="shop-cost-badge">${item.cost} pts</div>
      ${art}
      <div class="shop-card-name" title="${esc(item.name)}">${esc(item.name)}</div>
      ${kindTag}
      <div class="shop-flavor" title="${esc(item.desc)}">${esc(item.desc)}</div>
      <div class="shop-card-status">
        ${armouryCount > 0 ? `<div class="shop-bought-badge">×${armouryCount} in your armoury</div>` : ''}
        ${boughtCount > 0 ? `<div class="shop-bought-badge">Bought ×${boughtCount} this week</div>` : ''}
      </div>
      <button type="button" class="shop-buy-btn" data-buy="${esc(item.id)}" ${affordable ? '' : 'disabled'}>BUY</button>
    </div>`;
}

function confirmModalHtml(store, s) {
  if (!s.confirm) return '';
  const item = store.getShopItems().find((i) => i.id === s.confirm.itemId);
  if (!item || itemIssues(store, item).length) return '';
  const { buyerId } = s.confirm;
  const buyer = store.HOUSES[buyerId];
  const amount = item.effect.amount;
  const kind = item.effect.kind;

  let bodyHtml = '';
  let confirmLabel = 'Confirm Purchase';

  if (store.getCombatMode() === 'duel') {
    // Mr. D's rules: every item is banked, whatever its kind — attacks and
    // defenses wait in the armoury for Battle Day, utilities wait to be used.
    const held = store.countOwned(buyerId, item.id);
    const heldNote = held > 0 ? ` <b>${esc(buyer.name)}</b> already holds <b>×${held}</b> in the armoury.` : '';
    bodyHtml = `<b>${esc(buyer.name)}</b> will spend <b>${item.cost} pts</b> to add <b>${esc(item.name)}</b> to the armoury — held until it is used on <b>Battle Day</b>.${heldNote}`;
  } else if (kind === 'shield') {
    bodyHtml = `<b>${esc(buyer.name)}</b> will spend <b>${item.cost} pts</b> to raise the ${esc(item.name)}, blocking incoming attacks for <b>${amount} hour${amount === 1 ? '' : 's'}</b>.`;
  } else if (kind === 'reduce') {
    bodyHtml = `<b>${esc(buyer.name)}</b> will spend <b>${item.cost} pts</b> to activate ${esc(item.name)}, halving incoming damage for <b>${amount} hour${amount === 1 ? '' : 's'}</b>.`;
  } else if (kind === 'wild') {
    bodyHtml = `<b>${esc(buyer.name)}</b> will spend <b>${item.cost} pts</b> to open ${esc(item.name)} — a d20 roll decides the fate, up to <b>±${amount} pts</b>. Watch the die land!`;
    confirmLabel = '🎲 Take the Risk!';
  } else if (store.isStockpiled(item)) {
    // Offensive items (attack/steal/pierce) are stockpiled now — buying one
    // banks it in the armoury for Battle Day instead of firing at a target.
    const owned = store.countOwned(buyerId, item.id);
    const ownedNote = owned > 0 ? ` <b>${esc(buyer.name)}</b> already holds <b>${owned}</b> of these in the armoury.` : '';
    bodyHtml = `<b>${esc(buyer.name)}</b> will spend <b>${item.cost} pts</b> to add <b>${esc(item.name)}</b> to the armoury — it's saved to use on <b>Battle Day</b>, not fired now.${ownedNote}`;
  }

  return `
    <div class="shop-modal-backdrop" data-modal-backdrop>
      <div class="shop-modal">
        <div class="shop-modal-emoji">${esc(item.emoji || '✨')}</div>
        <div class="shop-modal-title">Confirm: ${esc(item.name)}</div>
        <div class="shop-modal-body">${bodyHtml}</div>
        <div class="shop-modal-actions">
          <button type="button" class="shop-modal-btn shop-modal-cancel" data-modal-cancel>Cancel</button>
          <button type="button" class="shop-modal-btn shop-modal-confirm" data-modal-confirm ${purchaseInFlight ? 'disabled' : ''}>${confirmLabel}</button>
        </div>
      </div>
    </div>`;
}


function sectionHtml(title, items, store, s, buyerId) {
  if (!items.length) return '';
  return `
    <div class="shop-section">
      <div class="shop-section-title">${title}</div>
      <div class="shop-grid">${items.map((it) => itemCard(store, s, it, buyerId)).join('')}</div>
    </div>`;
}

// Carousel layout — see the rationale comment above .shop-carousel-outer in
// injectStyles(): ONE strip across every buyable item, in the same
// offensive/defensive/wildcard/broken order the grid uses for its sections,
// rather than one strip per section.
function carouselBodyHtml(items, store, s, buyerId) {
  if (!items.length) return '';
  const cardsHtml = items.map((it) => itemCard(store, s, it, buyerId)).join('');
  return `<div class="shop-carousel-outer">${carouselHtml(cardsHtml, { label: 'shop items' })}</div>`;
}

function mythicSectionHtml(mythicItems) {
  if (!mythicItems.length) return '';
  return `
    <div class="shop-mythic-section">
      <div class="shop-mythic-heading">🏆 Mythic Rewards
        <span class="shop-mythic-sub">Earned by rolling a natural 20 — never bought</span>
      </div>
      <div class="shop-mythic-grid">
        ${mythicItems.map((it) => `
          <div class="shop-mythic-card">
            <div class="shop-mythic-card-emoji">${esc(it.emoji || '✨')}</div>
            <div class="shop-mythic-card-name">${esc(it.name)}</div>
            <div class="shop-mythic-card-tag">MYTHIC</div>
            <div class="shop-mythic-card-desc">${esc(it.desc)}</div>
          </div>`).join('')}
      </div>
    </div>`;
}

function render(s) {
  if (!rootEl) return;
  const store = ctxRef.store;
  const layout = store.getLayout('shop'); // 'grid' (default, untouched) | 'carousel'
  // Capture scroll position (if a strip is currently mounted) and tear down its
  // listeners BEFORE the DOM underneath them is replaced — re-wired below,
  // after the new strip exists, so the wireCarousel scroll/click listeners
  // never accumulate across renders (a purchase re-renders this screen).
  const prevCarouselScrollLeft = carouselScrollLeft(rootEl);
  if (carouselTeardown) { carouselTeardown(); carouselTeardown = null; }
  const buyer = store.getActiveHouse();
  const items = store.getShopItems();
  const mythic = items.filter((it) => it.mythicOnly && !itemIssues(store, it).length);

  // No masthead: the painted shopfront behind the cards already names the
  // place, and the rule line under the treasury carries the weekly rhythm
  // ("stock up all week, settle it on Friday") where it matters.

  let bodyHtml;
  if (!buyer) {
    // "All Cores" is a viewing mode, not a house — there's nothing to buy for.
    bodyHtml = `
      <div class="shop-pickhouse">🔒 Pick a house core in the top bar to shop.</div>
      ${mythicSectionHtml(mythic)}
    `;
  } else {
    const buyerId = buyer.id;
    const treasury = store.getTotal(buyerId, 'term');
    const buyable = items.filter((it) => !it.mythicOnly);
    const duel = store.getCombatMode() === 'duel';

    // Section grouping follows the ACTIVE rule set: Mr. D's items group by the
    // slot they occupy in a house's weekly hand (attack/defense/utility),
    // hit-points items by what their effect does. Broken items always trail.
    const valid = buyable.filter((it) => !itemIssues(store, it).length);
    const broken = buyable.filter((it) => itemIssues(store, it).length);
    const sections = duel
      ? [
        ['⚔️ Attacks', valid.filter((it) => (it.slot || 'utility') === 'attack')],
        ['🛡️ Defenses', valid.filter((it) => (it.slot || 'utility') === 'defense')],
        ['🔮 Utilities', valid.filter((it) => (it.slot || 'utility') === 'utility')],
      ]
      : [
        ['⚔️ Offensive', valid.filter((it) => ['attack', 'steal', 'pierce'].includes(it.effect?.kind))],
        ['🛡️ Defensive', valid.filter((it) => ['shield', 'reduce'].includes(it.effect?.kind))],
        ['🎲 Wildcards', valid.filter((it) => it.effect?.kind === 'wild')],
      ];
    sections.push(['⚠️ Unavailable', broken]);
    const anyBuyable = sections.some(([, list]) => list.length);

    bodyHtml = `
      <div class="shop-treasury-row" data-buyer="${buyerId}" style="--tr-accent:${buyer.accent}">
        <img class="shop-treasury-crest" src="${esc(buyer.image)}" alt="${esc(buyer.name)} crest"
          onerror="this.style.visibility='hidden'" />
        <div class="shop-treasury" title="${esc(buyer.name)} treasury">
          <span class="val">${treasury}</span><span class="unit">pts</span>
        </div>
        <img class="shop-treasury-crest" src="${esc(buyer.image)}" alt="" aria-hidden="true"
          onerror="this.style.visibility='hidden'" />
      </div>

      ${duel ? '<div class="shop-mode-note">One attack and one defense held per house per week — chosen in secret, revealed on Battle Day.</div>' : ''}

      ${anyBuyable ? (layout === 'carousel'
        ? carouselBodyHtml(sections.flatMap(([, list]) => list), store, s, buyerId)
        : sections.map(([title, list]) => sectionHtml(title, list, store, s, buyerId)).join(''))
        : '<div class="shop-empty">The shop shelves are empty — check back after your teacher stocks it in Admin.</div>'}

      ${mythicSectionHtml(mythic)}
    `;
  }

  rootEl.innerHTML = `
    <div class="shop-root">
      ${bodyHtml}
    </div>
    ${confirmModalHtml(store, s)}
  `;
  wireCardImageFallbacks(rootEl);
  if (layout === 'carousel') {
    carouselTeardown = wireCarousel(rootEl, { restoreLeft: prevCarouselScrollLeft });
  }
}

// =============================================================================
// feedback: banner / toast / shake
// =============================================================================
// Both mount into toastHost (on <body>) rather than rootEl — the banner is
// usually announcing the very store change that is about to rebuild rootEl,
// and as a rootEl child it died in that rebuild before anyone read it. The
// nodes themselves are position:fixed, so where they live changes nothing
// about where they appear.
function showBanner(text) {
  if (!toastHost) return;
  const el = document.createElement('div');
  el.className = 'shop-banner';
  el.textContent = text;
  toastHost.appendChild(el);
  later(() => {
    el.classList.add('shop-banner-out');
    later(() => el.remove(), 300);
  }, 2200);
}

function showToast(text) {
  if (!toastHost) return;
  const existing = toastHost.querySelector('.shop-toast');
  if (existing) existing.remove();
  const el = document.createElement('div');
  el.className = 'shop-toast';
  el.textContent = text;
  toastHost.appendChild(el);
  later(() => el.remove(), 2000);
}

function shakeCard(itemId) {
  const card = rootEl.querySelector(`[data-card="${itemId}"]`);
  if (!card) return;
  card.classList.remove('shake');
  void card.offsetWidth;
  card.classList.add('shake');
  later(() => card.classList.remove('shake'), 400);
}

// Steps a treasury readout element's text from `from` to `to` over roughly
// `durationMs`, so the class visibly watches the pot move rather than seeing
// it snap. Ticks via later() (the module's tracked setTimeout) so it's swept
// up by the same cleanup as everything else if the shop unmounts mid-count.
function animateTreasuryCount(el, from, to, durationMs, onDone) {
  if (!el) { if (onDone) onDone(); return; }
  if (from === to) { el.textContent = `🪙 ${to} pts`; if (onDone) onDone(); return; }
  const steps = 18;
  const stepMs = Math.max(16, Math.round(durationMs / steps));
  let i = 0;
  const tick = () => {
    i += 1;
    const t = Math.min(1, i / steps);
    const eased = 1 - (1 - t) * (1 - t); // ease-out
    el.textContent = `🪙 ${Math.round(from + (to - from) * eased)} pts`;
    if (t < 1) later(tick, stepMs);
    else if (onDone) onDone();
  };
  tick();
}

// =============================================================================
// purchase resolution
// =============================================================================

// 'wild' is its own flow: pay immediately, then a REAL d20 roll (via the
// shared dice3d API) decides the swing live on screen — the class watches it
// land, and the swing is written to the store the INSTANT the die settles.
// The outcome table is shown beside the tray so the mapping is never a
// mystery. Everything after the settle — the number, the highlight, the
// treasury count — is pure presentation of a ledger entry that already
// exists, so navigating away mid-reveal can no longer eat a paid-for
// outcome (it used to: the swing sat in a setTimeout that unmount cleared).
function playWildReveal(s, item, buyer, buyerId, mountedRootAtStart) {
  const store = ctxRef.store;
  const audio = ctxRef.audio;
  const host = document.getElementById('overlay-root');
  const amount = item.effect.amount;
  const table = wildOutcomeTable(amount);
  wildRollActive = true;

  // The one writer of this roll's outcome. Idempotent — only the first call
  // writes — and registered as pendingWildOutcome so unmount() can invoke it
  // with a substitute draw if the shop is torn down while the die is still
  // tumbling (the cost is already spent; the outcome must not be lost).
  // Captures the pre-swing total so the reveal can animate the treasury from
  // the numbers that were true at settle time, however late it plays.
  let recorded = null;
  const recordOutcome = (value) => {
    if (recorded) return recorded;
    const row = wildRowForRoll(value, table) || { min: value, max: value, amount: 0 };
    const swing = row.amount;
    const startTotal = store.getTotal(buyerId, 'term'); // cost already spent; swing lands next
    const tx = store.addPoints(buyerId, swing, {
      reason: `${item.name} — rolled ${value}: ${swing === 0 ? 'no change' : swing > 0 ? 'fortune!' : 'misfortune!'}`,
      tag: 'wild',
    });
    recorded = { value, row, swing, applied: tx ? tx.delta : 0, startTotal };
    pendingWildOutcome = null;
    return recorded;
  };
  pendingWildOutcome = recordOutcome;

  // Defensive fallback if the shared overlay host is ever missing — still
  // resolves fairly and never silently.
  if (!host) {
    recordOutcome(1 + Math.floor(Math.random() * 20));
    if (rootEl === mountedRootAtStart) render(s);
    wildRollActive = false;
    return;
  }

  const overlay = document.createElement('div');
  overlay.className = 'shop-wild-overlay';
  overlay.innerHTML = `
    <div class="shop-wild-flash"></div>
    <div class="shop-wild-stage">
      <div class="shop-wild-header">
        <div class="shop-wild-header-emoji">${esc(item.emoji || '🎲')}</div>
        <div class="shop-wild-title">${esc(item.name.toUpperCase())} — rolling for fate&hellip;</div>
      </div>
      <div class="shop-wild-body">
        <div class="shop-wild-dice-frame">
          <div class="shop-wild-dice-host"></div>
          <div class="shop-wild-rolled-block"><div class="shop-wild-rolled-number"></div></div>
        </div>
        <div class="shop-wild-table">
          <div class="shop-wild-table-title">The Stakes</div>
          ${table.map((row) => `
            <div class="shop-wild-row" data-min="${row.min}" data-max="${row.max}">
              <span class="shop-wild-range">${row.min === row.max ? row.min : `${row.min}–${row.max}`}</span>
              <span class="shop-wild-outcome">${row.amount > 0 ? `+${row.amount}` : row.amount < 0 ? row.amount : 'Nothing'}</span>
            </div>`).join('')}
        </div>
        <div class="shop-wild-reveal-block">
          <div class="shop-wild-number"></div>
          <div class="shop-wild-caption"></div>
          <div class="shop-wild-treasury-line"></div>
        </div>
      </div>
    </div>
  `;
  host.appendChild(overlay);
  fxNodes.add(overlay);

  // No JS positioning — .shop-wild-stage centers itself via CSS (see styles).
  // Pinning the tray's bottom to the treasury card was tried and dropped: the
  // shop is a long, internally-scrolling page, so the card's on-screen
  // position depends on scroll and fought the layout. A simple, comfortable
  // centered composition (title above, tray + stakes below) reads better and
  // never fights geometry.

  function teardownOverlay() {
    overlay.remove();
    fxNodes.delete(overlay);
    // Dispose the roll's WebGL context now, right as its tray disappears —
    // not at settle, so the die stays visibly at rest through the reveal.
    if (activeWildRollDispose) { try { activeWildRollDispose(); } catch (e) {} activeWildRollDispose = null; }
    wildRollActive = false;
    // Store changes were held back from the screen while the overlay ran
    // (see the subscribe guard in mount()) — paint the true state now.
    if (rootEl === mountedRootAtStart && currentRenderFn) currentRenderFn();
  }

  // Pacing (so the class can actually follow the roll, not blink and miss it):
  //   die settles (points are WRITTEN here) -> rolled number + matching
  //   stakes row hold ~1.5-2s -> fade out -> RESULT ("+6"/"−12") appears,
  //   holds a full 2s -> ONLY THEN the treasury count animates up/down.
  // The score is already correct from the first beat; the reveal just takes
  // its time telling the class about it.
  const HOLD_ROLL_MS = 1800;
  const FADE_MS = 300;
  const HOLD_RESULT_MS = 2000;
  const COUNT_MS = 900;
  const POST_COUNT_MS = 500;

  function finish(value) {
    // Write the outcome FIRST — everything below is theatre over a ledger
    // entry that now exists, safe against any navigation.
    const { row, swing, applied, startTotal } = recordOutcome(value);
    const good = swing > 0;
    const neutral = swing === 0;

    // ---- die settled: show the raw rolled number over the tray and light up
    // the stakes row it lands on; hold so it's actually readable.
    overlay.classList.add('shop-wild-flashing');
    const hitRow = overlay.querySelector(`[data-min="${row.min}"][data-max="${row.max}"]`);
    if (hitRow) hitRow.classList.add('shop-wild-row-hit');
    const rolledBlock = overlay.querySelector('.shop-wild-rolled-block');
    const rolledNumberEl = overlay.querySelector('.shop-wild-rolled-number');
    if (rolledNumberEl) rolledNumberEl.textContent = value;
    if (rolledBlock) rolledBlock.classList.add('show');

    later(() => {
      // ---- fade the rolled number + row highlight out.
      if (rolledBlock) rolledBlock.classList.add('fading');
      if (hitRow) hitRow.classList.remove('shop-wild-row-hit');

      later(() => {
        if (rolledBlock) { rolledBlock.classList.remove('show'); rolledBlock.classList.remove('fading'); }

        // ---- the RESULT number appears large and holds a full 2 seconds —
        // the score has NOT moved yet.
        const revealBlock = overlay.querySelector('.shop-wild-reveal-block');
        const numberEl = overlay.querySelector('.shop-wild-number');
        const captionEl = overlay.querySelector('.shop-wild-caption');
        if (numberEl) {
          numberEl.textContent = neutral ? '0' : `${good ? '+' : ''}${swing}`;
          numberEl.className = `shop-wild-number ${neutral ? 'shop-wild-number-neutral' : (good ? 'shop-wild-number-good' : 'shop-wild-number-bad')}`;
        }
        if (captionEl) {
          captionEl.textContent = `${item.name} (rolled ${value}) — ${buyer.name} ${neutral ? 'nothing happens' : good ? `gains ${swing}` : `loses ${Math.abs(swing)}`}`;
        }
        if (revealBlock) revealBlock.classList.add('show');
        showBanner(`${buyer.name} rolled ${value} on ${item.name} — ${neutral ? 'nothing happens.' : `${good ? '+' : ''}${swing} pts!`} ${item.emoji || '🎲'}`);

        later(() => {
          // ---- the points already moved at settle (recordOutcome); this is
          // the moment the SCREEN catches up: the shop repaints and the
          // treasury counter animates the delta that was really written.
          audio.sfx(good ? 'coin' : 'thud');
          if (rootEl === mountedRootAtStart) render(s);

          const finishUp = () => later(() => {
            overlay.classList.add('shop-wild-fadeout');
            later(teardownOverlay, 350);
          }, POST_COUNT_MS);

          const treasuryLineEl = overlay.querySelector('.shop-wild-treasury-line');
          if (treasuryLineEl) {
            treasuryLineEl.classList.add('show');
            animateTreasuryCount(treasuryLineEl, startTotal, startTotal + applied, COUNT_MS, finishUp);
          } else {
            finishUp();
          }
        }, HOLD_RESULT_MS);
      }, FADE_MS);
    }, HOLD_ROLL_MS);
  }

  const diceHost = overlay.querySelector('.shop-wild-dice-host');
  let rollPromise;
  try {
    rollPromise = rollInHost(diceHost, { mode: 'd20', house: buyer, fate: false, audio });
  } catch (e) {
    console.warn('shop: could not start the dice roll, using a plain draw instead', e);
    rollPromise = null;
  }

  if (rollPromise) {
    activeWildRollDispose = rollPromise.dispose || null;
    rollPromise.then(({ value }) => finish(value)).catch((e) => {
      console.warn('shop: dice roll did not settle, using a plain draw instead', e);
      activeWildRollDispose = null;
      finish(1 + Math.floor(Math.random() * 20));
    });
  } else {
    finish(1 + Math.floor(Math.random() * 20));
  }
}

// Pays the cost immediately; the roll (and the swing it decides) plays out
// in playWildReveal above regardless of what happens to this shop instance
// afterward — the student already spent the points.
function resolveWildPurchase(s, item, buyerId) {
  const store = ctxRef.store;
  const buyer = store.HOUSES[buyerId];
  const mountedRootAtStart = rootEl;

  // Belt-and-suspenders: the buy-click handler already blocks this, but never
  // charge a second roll while one is still resolving.
  if (wildRollActive) { s.confirm = null; render(s); showToast('A roll is already in progress'); return; }

  const ok = store.purchase(buyerId, item.cost, item.name);
  if (!ok) { s.confirm = null; render(s); showToast('Not enough points'); return; }

  s.confirm = null;
  render(s); // close the confirm modal — the full-screen roll overlay takes over
  playWildReveal(s, item, buyer, buyerId, mountedRootAtStart);
}

// Disables/re-enables the Confirm button for visible feedback during the
// await. purchaseInFlight suspending store.subscribe (see mount(), above)
// means no re-render can happen out from under this while it's set, so the
// attribute sticks until we explicitly clear it or replace the modal.
function setConfirmButtonDisabled(disabled) {
  if (!rootEl) return;
  const btn = rootEl.querySelector('[data-modal-confirm]');
  if (btn) btn.disabled = disabled;
}

async function resolvePurchase(s) {
  const store = ctxRef.store;
  const audio = ctxRef.audio;
  const item = store.getShopItems().find((i) => i.id === s.confirm.itemId);
  if (!item || itemIssues(store, item).length) { s.confirm = null; render(s); return; }
  const { buyerId } = s.confirm;
  const kind = item.effect.kind;

  // In-flight guard: a double-tap on Confirm in the same tick must not spend
  // the cost twice, add the item to the armoury twice, loot twice, or double
  // a shield/reduction duration. Set synchronously — BEFORE the
  // requireUnlock() await — so the second tap sees purchaseInFlight already
  // true and bails out having done nothing. Cleared in the `finally` below
  // so a refused PIN (or a thrown error) can't wedge the Confirm button; the
  // teacher can retry the instant the pad closes. Same pattern as battle.js
  // `resolving` / dice.js `awardInFlight`.
  if (purchaseInFlight) return;
  purchaseInFlight = true;
  setConfirmButtonDisabled(true);
  try {
    // Gate the spend itself — one PIN entry per shop session (lock.js keeps a
    // 15-minute unlock window), not one per purchase. Everything above this
    // line only reads the pending confirm state; nothing has been charged yet,
    // and this single gate sits before BOTH the wild dispatch below and the
    // normal store.purchase() further down, so it covers both paths.
    const mountedRootAtStart = rootEl;
    const allowed = await lock.requireUnlock('buy this item');
    if (rootEl !== mountedRootAtStart) return; // shop was unmounted while the PIN pad was open
    if (!allowed) return; // PIN refused — no charge, no sound, no FX, no banner; confirm modal stays open as-is

    // ---- Mr. D's duel rules: ONE purchase path for both screens ------------
    // This is the exact store sequence Battle Day's mini-shop runs
    // (battle.js buyMiniShopItem): duelCanBuy gate → store.purchase →
    // store.addToInventory. Because the gate and both mutations live in the
    // store, the Magic Shop and the mini-shop can never disagree about what a
    // house may hold or what a purchase does.
    if (store.getCombatMode() === 'duel') {
      const buyer = store.HOUSES[buyerId];
      const gate = store.duelCanBuy(buyerId, item.id);
      if (!gate.ok) { s.confirm = null; render(s); showToast(gate.reason); return; }
      const ok = store.purchase(buyerId, item.cost, item.name);
      if (!ok) { s.confirm = null; render(s); showToast('Not enough points'); return; }
      store.addToInventory(buyerId, item.id);
      audio.sfx('coin');
      s.confirm = null;
      render(s);
      const held = store.countOwned(buyerId, item.id);
      showBanner(`${buyer.name} stashed ${item.name} in the armoury (×${held}) — ready for Battle Day! ${item.emoji || '✨'}`);
      return;
    }

    if (kind === 'wild') { resolveWildPurchase(s, item, buyerId); return; }

    // The only kinds that reach here are shield/reduce (self-buffs) — attack/
    // steal/pierce are always stockpiled (store.isStockpiled), so buying one
    // banks it in the armoury via the branch above and never fires live.
    const buyer = store.HOUSES[buyerId];
    const amount = item.effect.amount;
    const emoji = item.emoji || '✨';

    const ok = store.purchase(buyerId, item.cost, item.name);
    if (!ok) {
      s.confirm = null;
      render(s);
      showToast('Not enough points');
      return;
    }
    audio.sfx('coin');

    if (kind === 'shield') {
      store.activateShield(buyerId, amount);
    } else if (kind === 'reduce') {
      store.activateReduction(buyerId, amount);
    } else if (store.isStockpiled(item)) {
      // Buying an offensive item (attack/steal/pierce) no longer fires it — it
      // goes into the buyer's armoury and is spent later, on Battle Day.
      store.addToInventory(buyerId, item.id);
    }

    // Every store mutation above would normally fire its own synchronous
    // re-render via store.subscribe, but that's suspended while
    // purchaseInFlight is true (see mount()) — close the modal and render
    // explicitly instead.
    s.confirm = null;
    render(s);

    if (kind === 'shield') {
      showBanner(`${buyer.name} raised the ${item.name}! ${emoji}`);
      return;
    }
    if (kind === 'reduce') {
      showBanner(`${buyer.name} activated ${item.name}! ${emoji}`);
      return;
    }
    if (store.isStockpiled(item)) {
      const owned = store.countOwned(buyerId, item.id);
      showBanner(`${buyer.name} stashed ${item.name} in the armoury (×${owned}) — ready for Battle Day! ${emoji}`);
    }
  } finally {
    purchaseInFlight = false;
    setConfirmButtonDisabled(false); // no-op if the modal is already gone
  }
}

// =============================================================================
// Module contract
// =============================================================================
export default {
  id: 'shop',
  title: 'Magic Shop',
  icon: '🔮',
  order: 35,
  showTile: true,

  mount(el, ctx) {
    ctxRef = ctx;
    rootEl = el;
    injectStyles();
    injectCarouselStyles();
    // See the toastHost declaration at the top of the file: banners/toasts
    // must outlive the re-render their own store change triggers.
    toastHost = document.createElement('div');
    toastHost.className = 'shop-toast-host';
    document.body.appendChild(toastHost);
    const store = ctx.store;
    const s = initState();

    const doRender = () => render(s);
    currentRenderFn = doRender;
    doRender();

    clickHandler = (e) => {
      const buyBtn = e.target.closest('[data-buy]');
      if (buyBtn && !buyBtn.disabled) {
        const activeHouse = store.getActiveHouse();
        if (!activeHouse) return; // no buyer selected — buttons shouldn't render, but guard anyway
        const buyerId = activeHouse.id;
        const itemId = buyBtn.getAttribute('data-buy');
        const item = store.getShopItems().find((i) => i.id === itemId);
        if (!item || itemIssues(store, item).length) return;
        const treasury = store.getTotal(buyerId, 'term');
        if (treasury < item.cost) { showToast('Not enough points'); shakeCard(itemId); return; }

        // Mr. D's rules: slot limits are the STORE's rule (duelCanBuy), the
        // same gate the Battle Day mini-shop consults — refuse loudly, in the
        // store's own words, then confirm a plain armoury purchase (no
        // targets, no instant effects — everything waits for Battle Day).
        if (store.getCombatMode() === 'duel') {
          const gate = store.duelCanBuy(buyerId, item.id);
          if (!gate.ok) { showToast(gate.reason); shakeCard(itemId); return; }
          s.confirm = { itemId, buyerId };
          doRender();
          return;
        }

        const kind = item.effect.kind;
        if (kind === 'wild' && wildRollActive) {
          showToast('A roll is already in progress');
          return;
        }
        if (kind === 'shield' || kind === 'reduce' || kind === 'wild') {
          s.confirm = { itemId, buyerId };
          doRender();
          return;
        }
        // Stockpiled offensive items (attack/steal/pierce, per
        // store.isStockpiled) skip target selection entirely — buying one
        // just banks it in the armoury for Battle Day, so BUY goes straight
        // to the confirm modal with no target.
        if (store.isStockpiled(item)) {
          s.confirm = { itemId, buyerId };
          doRender();
          return;
        }
        return;
      }

      const modalConfirm = e.target.closest('[data-modal-confirm]');
      if (modalConfirm) { resolvePurchase(s); return; }

      const modalCancel = e.target.closest('[data-modal-cancel]');
      const backdrop = e.target.matches('[data-modal-backdrop]') ? e.target : null;
      if (modalCancel || backdrop) { s.confirm = null; doRender(); return; }
    };
    rootEl.addEventListener('click', clickHandler);

    // Never rebuild the grid under a finger that is still physically down —
    // see the deferral block at the top of the file. Pointer Events cover
    // mouse/touch/pen on every browser this app targets; mousedown/mouseup
    // are added too as a cheap belt-and-braces fallback.
    document.addEventListener('pointerdown', onShopPointerDown, true);
    document.addEventListener('pointerup', onShopPointerRelease, true);
    document.addEventListener('pointercancel', onShopPointerRelease, true);
    document.addEventListener('mousedown', onShopPointerDown, true);
    document.addEventListener('mouseup', onShopPointerRelease, true);

    // Suspend store-triggered re-renders while a purchase is resolving (see
    // purchaseInFlight above) — store.purchase()/addPoints()/activateShield()
    // etc. all fire this subscribe callback, and rebuilding the DOM mid-flight
    // would blow away the disabled attribute on the Confirm button. The
    // explicit render(s) calls inside resolvePurchase() still run regardless,
    // so the final state always paints once the guard clears.
    // Also suspended while a wildcard reveal is running: the swing is written
    // the instant the die settles, but the treasury behind the blur must not
    // move until the reveal's own beat — finish() repaints explicitly at
    // exactly that moment, and teardown always ends with the true state.
    // And held while a pointer is down inside the shop, so the emit can't eat
    // the very tap that caused it — deferred to onShopPointerRelease.
    unsub = store.subscribe(() => {
      if (purchaseInFlight || wildRollActive) return;
      if (pointerDownInside) {
        renderDeferred = true;
        clearDeferWatchdog();
        deferWatchdog = setTimeout(() => {
          if (renderDeferred) { renderDeferred = false; pointerDownInside = false; doRender(); }
        }, 1500);
        return;
      }
      doRender();
    });
  },

  unmount() {
    // A paid-for wildcard whose outcome hasn't been written yet (the teacher
    // navigated away while the die was still tumbling): decide it NOW with a
    // fair substitute draw. The reveal is gone, but the ledger entry — and
    // the points — are correct the moment any other screen looks at them.
    if (pendingWildOutcome) {
      try { pendingWildOutcome(1 + Math.floor(Math.random() * 20)); } catch (e) { console.warn('shop:', e); }
      pendingWildOutcome = null;
    }
    clearTimers();
    clearFx();
    // A pending dice3d roll self-disposes once its host leaves the document
    // (clearFx() above already removed it), but do it immediately here too
    // rather than waiting on that ~500ms poll — no leaked canvas/RAF.
    if (activeWildRollDispose) { try { activeWildRollDispose(); } catch (e) {} activeWildRollDispose = null; }
    wildRollActive = false;
    purchaseInFlight = false; // don't leave the guard set if the teacher navigates away mid-PIN
    if (unsub) { unsub(); unsub = null; }
    document.removeEventListener('pointerdown', onShopPointerDown, true);
    document.removeEventListener('pointerup', onShopPointerRelease, true);
    document.removeEventListener('pointercancel', onShopPointerRelease, true);
    document.removeEventListener('mousedown', onShopPointerDown, true);
    document.removeEventListener('mouseup', onShopPointerRelease, true);
    clearDeferWatchdog();
    pointerDownInside = false;
    renderDeferred = false;
    if (rootEl && clickHandler) rootEl.removeEventListener('click', clickHandler);
    clickHandler = null;
    if (carouselTeardown) { carouselTeardown(); carouselTeardown = null; }
    if (toastHost) { try { toastHost.remove(); } catch (e) {} toastHost = null; }
    rootEl = null;
    ctxRef = null;
    currentRenderFn = null;
  },
};
