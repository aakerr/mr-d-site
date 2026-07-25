// shop.js — Friday Magical Item Shop. Houses spend accumulated TERM points on
// items that attack rivals or protect their standings before scores lock.
// The item catalog is teacher-editable (Admin) and lives in the store —
// this module renders whatever store.getShopItems() returns, live.
// Owns ONLY this file. Follows ARCHITECTURE.md contract.
import { media } from '../core/media.js';
import { fitMastheadWhenReady } from '../core/masthead.js';
import { rollInHost } from './dice3d/roll.js';
import { lock } from '../core/lock.js';

const STYLE_ID = 'shop-styles';
const PURPLE = '#a78bfa';
const PURPLE_SOFT = 'rgba(167,139,250,0.35)';
// effect.kind values the store's catalog can contain — see js/core/store.js.
const KNOWN_KINDS = new Set(['attack', 'steal', 'shield', 'pierce', 'reduce', 'wild']);

// ---- module-scoped lifecycle state -----------------------------------------
let ctxRef = null;
let rootEl = null;
let unsub = null;
let clickHandler = null;
let currentRenderFn = null; // set while mounted; lets async media loads trigger a re-render
let activeWildRollDispose = null; // dispose fn for an in-flight dice3d roll, cleared on settle/unmount
let wildRollActive = false; // true from purchase-confirm through overlay teardown — blocks a second concurrent roll
const timers = new Set();
const fxNodes = new Set();  // transient combat-effect DOM nodes, force-cleaned on unmount

// image URL resolution cache — persists across mount/unmount, keyed by media key
const mediaUrlCache = new Map(); // mediaKey -> url string | null (null = resolved, no file)
const mediaFetching = new Set();

// ---- per-mount UI state -----------------------------------------------------
// The buyer is never chosen in-shop anymore — it's whatever house is active in
// the top bar (store.getActiveHouse()), read fresh on every render.
function initState() {
  return {
    targetPicker: null,     // itemId currently choosing a target ('attack'/'pierce' items)
    confirm: null,          // { itemId, buyerId, targetId }
  };
}

function later(fn, ms) {
  const id = setTimeout(() => { timers.delete(id); try { fn(); } catch (e) { console.warn('shop:', e); } }, ms);
  timers.add(id);
  return id;
}
function clearTimers() { timers.forEach(clearTimeout); timers.clear(); }
function clearFx() { fxNodes.forEach((n) => { try { n.remove(); } catch (e) {} }); fxNodes.clear(); }

function prefersReducedMotion() {
  return !!(window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches);
}

// Spawns a transient fx node inside `parent` (setting position:relative on it
// if needed so absolutely-positioned fx anchor correctly), auto-removed after
// `ttl`ms and force-removed on unmount via `fxNodes`.
function spawnFx(parent, className, ttl, text) {
  if (!parent) return null;
  parent.style.position = parent.style.position || 'relative';
  const el = document.createElement('div');
  el.className = className;
  if (text != null) el.textContent = text;
  parent.appendChild(el);
  fxNodes.add(el);
  later(() => { el.remove(); fxNodes.delete(el); }, ttl);
  return el;
}

// Same, but never touches the parent's inline position — used for the shared
// #overlay-root (lead-owned); its fx children are all position:fixed.
function spawnFxPlain(parent, className, ttl) {
  if (!parent) return null;
  const el = document.createElement('div');
  el.className = className;
  parent.appendChild(el);
  fxNodes.add(el);
  later(() => { el.remove(); fxNodes.delete(el); }, ttl);
  return el;
}

function esc(s) {
  return String(s == null ? '' : s).replace(/[&<>"']/g, (c) =>
    ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}

function houseImg(house, cls) {
  return `<img src="${house.image}" alt="${esc(house.name)} artwork" class="${cls}"
    onerror="this.onerror=null;this.style.display='none';" />`;
}

// mm/hh remaining-time formatters shared by shield/reduction displays.
function fmtRemain(ms) {
  if (ms <= 0) return null;
  const totalMins = Math.max(1, Math.round(ms / 60000));
  const hrs = Math.floor(totalMins / 60);
  const mins = totalMins % 60;
  return hrs > 0 ? `${hrs}h ${mins}m left` : `${mins}m left`;
}
function fmtRemainShort(ms) {
  if (ms <= 0) return null;
  const totalMins = Math.max(1, Math.round(ms / 60000));
  const hrs = Math.floor(totalMins / 60);
  const mins = totalMins % 60;
  return hrs > 0 ? `${hrs}h` : `${mins}m`;
}

function kindLabel(kind) {
  return {
    attack: '⚔️ Attack',
    steal: '🐴 Steal',
    pierce: '🫥 Pierce — ignores defenses',
    shield: '🛡️ Defense',
    reduce: '🕵️ Defense (Mythic)',
    wild: '🎲 Wildcard',
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
    background:radial-gradient(ellipse at 50% -10%,rgba(88,28,135,.4),#0b0f19 55%),
      radial-gradient(ellipse at 100% 100%,rgba(76,29,149,.22),transparent 60%),#0b0f19;}
  /* The wizard mark sits OUTSIDE the centred text block, so the title and
     subtitle centre on each other rather than on "icon + title". */
  /* The TEXT centres on the screen; the mark hangs to its left and an equal
     spacer on the right keeps that true. The mark is allowed to look
     off-balance — that is the intended composition. */
  .shop-header{display:flex;align-items:flex-start;justify-content:center;
    gap:clamp(.5rem,1.4vw,1.1rem);margin-bottom:1rem;}
  .shop-header-mark,.shop-header-spacer{width:clamp(2.2rem,5.4vw,3.6rem);flex:0 0 auto;}
  .shop-header-mark{height:auto;filter:drop-shadow(0 4px 14px rgba(167,139,250,.5));}
  .shop-headings{text-align:center;}
  .mh-ink{display:inline-block;white-space:nowrap;}
  .shop-title{font-family:'Cinzel',Georgia,serif;font-weight:800;
    font-size:clamp(1.4rem,3.4vw,2.4rem);color:${PURPLE};letter-spacing:.05em;
    text-shadow:0 0 26px ${PURPLE_SOFT};}
  .shop-subtitle{color:#c4b5fd;font-style:italic;font-weight:600;font-size:clamp(1.05rem,2.7vw,1.7rem);
    margin-top:.05rem;line-height:1.05;}

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

  /* shown instead of the shop grid when the top bar is on "All Cores" */
  .shop-pickhouse{max-width:520px;margin:2.5rem auto;text-align:center;color:#c4b5fd;font-style:italic;
    font-size:1.15rem;padding:2.5rem 2rem;border:1px dashed #4c1d95;border-radius:1.25rem;}

  /* sections */
  .shop-section{max-width:1200px;margin:0 auto 1.75rem;}
  .shop-section-title{font-family:'Cinzel',Georgia,serif;font-weight:800;font-size:1.15rem;
    color:#e9d5ff;letter-spacing:.04em;margin-bottom:.75rem;text-align:center;
    text-shadow:0 0 16px rgba(167,139,250,.4);}

  /* Every section is its own grid — capping the column max-width (instead of
     1fr) keeps a card the same width whether its section has 7 items or 2, so
     e.g. Wildcards (usually few items) doesn't stretch into oversized cards
     next to Offensive/Defensive's normal-width ones. Centered so a short row
     doesn't hug the left edge. */
  .shop-grid{display:grid;grid-template-columns:repeat(auto-fit,minmax(240px,300px));gap:1.1rem;
    align-items:stretch;justify-content:center;}
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
    padding:1.4rem 1.2rem;display:flex;flex-direction:column;align-items:center;text-align:center;gap:.6rem;
    box-shadow:0 12px 34px rgba(76,29,149,.25);transition:transform .18s ease,box-shadow .18s ease;}
  .shop-card:hover{transform:translateY(-3px);box-shadow:0 16px 42px rgba(76,29,149,.4);}
  .shop-card-broken{border-color:#7f1d1d;border-style:dashed;opacity:.85;}
  .shop-card-emoji{font-size:3.4rem;filter:drop-shadow(0 4px 14px rgba(167,139,250,.5));line-height:1;}
  .shop-card-art{width:84px;height:84px;flex-shrink:0;display:flex;align-items:center;justify-content:center;}
  .shop-card-img{width:100%;height:100%;object-fit:cover;border-radius:1rem;box-shadow:0 4px 14px rgba(167,139,250,.45);}
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

  /* target picker */
  .shop-target-picker{display:flex;flex-wrap:wrap;gap:.5rem;justify-content:center;width:100%;}
  .shop-target-chip{min-height:48px;padding:0 .9rem;border-radius:.85rem;font-weight:700;font-size:.85rem;
    border:2px solid var(--tc-accent,#374151);background:#111827;color:var(--tc-accent,#e5e7eb);
    cursor:pointer;display:flex;align-items:center;gap:.4rem;touch-action:manipulation;
    transition:transform .12s ease;}
  .shop-target-chip:active{transform:scale(.93);}
  .shop-target-thumb{width:22px;height:22px;border-radius:.3rem;overflow:hidden;border:1px solid var(--tc-accent,#374151);}
  .shop-target-thumb img{width:100%;height:100%;object-fit:cover;}
  .shop-target-cancel{min-height:44px;padding:0 .9rem;border-radius:.75rem;background:transparent;
    border:1px solid #4b5563;color:#9ca3af;font-weight:600;cursor:pointer;}

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
  .shop-mythic-section{max-width:1200px;margin:0 auto 1.75rem;}
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

  /* ---- combat effects: attack landing / steal travel / block / pierce / reduce ---- */
  /* (all ≤900ms, pointer-events:none) */
  .shop-fx-num{position:absolute;top:-6px;left:50%;font-weight:800;font-size:1.05rem;
    text-shadow:0 2px 8px rgba(0,0,0,.75);pointer-events:none;z-index:20;
    animation:shop-fx-num-kf .9s ease-out both;white-space:nowrap;}
  .shop-fx-num-bad{color:#f87171;}
  .shop-fx-num-good{color:#fde68a;}
  @keyframes shop-fx-num-kf{
    0%{opacity:0;transform:translate(-50%,0) scale(.7);}
    20%{opacity:1;transform:translate(-50%,-8px) scale(1.2);}
    100%{opacity:0;transform:translate(-50%,-46px) scale(1);}
  }

  .shop-fx-flash{position:absolute;inset:-2px;border-radius:1rem;opacity:0;pointer-events:none;z-index:15;
    animation:shop-fx-flash-kf .5s ease both;}
  .shop-fx-flash-red{background:rgba(239,68,68,.5);}
  .shop-fx-flash-blue{background:rgba(96,165,250,.5);}
  .shop-fx-flash-amber{background:rgba(217,119,6,.5);}
  @keyframes shop-fx-flash-kf{0%{opacity:0;}15%{opacity:1;}100%{opacity:0;}}

  .shop-fx-hit{animation:shop-fx-hit-kf .45s cubic-bezier(.36,.07,.19,.97) both;}
  @keyframes shop-fx-hit-kf{
    0%,100%{transform:translate(0,0);}
    20%{transform:translate(-5px,0);}
    40%{transform:translate(4px,0);}
    60%{transform:translate(-3px,0);}
    80%{transform:translate(2px,0);}
  }

  .shop-fx-slash{position:absolute;inset:0;pointer-events:none;z-index:16;overflow:hidden;border-radius:1rem;}
  .shop-fx-slash-mark{position:absolute;top:50%;left:50%;width:150%;height:4px;
    background:linear-gradient(90deg,transparent,rgba(255,255,255,.95),transparent);
    transform:translate(-50%,-50%) rotate(-25deg) scaleX(0);opacity:0;
    animation:shop-fx-slash-kf .4s ease both;}
  @keyframes shop-fx-slash-kf{
    0%{opacity:0;transform:translate(-50%,-50%) rotate(-25deg) scaleX(0);}
    35%{opacity:1;transform:translate(-50%,-50%) rotate(-25deg) scaleX(1);}
    100%{opacity:0;transform:translate(-50%,-50%) rotate(-25deg) scaleX(1);}
  }

  .shop-fx-shield-ring{position:absolute;top:50%;left:50%;width:24px;height:24px;
    border:3px solid rgba(147,197,253,.9);border-radius:50%;
    transform:translate(-50%,-50%) scale(.4);opacity:0;pointer-events:none;z-index:17;
    box-shadow:0 0 18px rgba(96,165,250,.6);
    animation:shop-fx-ring-kf .7s cubic-bezier(.2,.8,.3,1) both;}
  @keyframes shop-fx-ring-kf{
    0%{opacity:.9;transform:translate(-50%,-50%) scale(.4);}
    70%{opacity:.5;}
    100%{opacity:0;transform:translate(-50%,-50%) scale(3.2);}
  }

  .shop-fx-blocked-label{position:absolute;left:50%;bottom:-26px;transform:translate(-50%,0);
    background:rgba(15,23,42,.92);border:1px solid rgba(147,197,253,.7);color:#bfdbfe;
    font-weight:800;font-size:.68rem;padding:.25rem .5rem;border-radius:.5rem;white-space:nowrap;
    pointer-events:none;z-index:20;
    animation:shop-fx-label-kf .9s ease both;}
  @keyframes shop-fx-label-kf{
    0%{opacity:0;transform:translate(-50%,6px) scale(.85);}
    15%{opacity:1;transform:translate(-50%,0) scale(1);}
    80%{opacity:1;}
    100%{opacity:0;transform:translate(-50%,-4px) scale(.97);}
  }

  /* pierce: ghostly phase-through, then normal damage lands */
  .shop-fx-phase{position:absolute;inset:-2px;border-radius:1rem;pointer-events:none;z-index:14;
    background:linear-gradient(120deg,rgba(196,181,253,.4),rgba(96,165,250,.28));
    opacity:0;filter:blur(1px);animation:shop-fx-phase-kf .35s ease both;}
  @keyframes shop-fx-phase-kf{
    0%{opacity:0;transform:scale(.95);}
    30%{opacity:.85;transform:scale(1.03);}
    60%{opacity:.4;transform:scale(1);}
    100%{opacity:0;transform:scale(1.05);}
  }

  .shop-fx-vignette-red{position:fixed;inset:0;z-index:66;pointer-events:none;
    animation:shop-fx-vignette-kf .7s ease both;}
  @keyframes shop-fx-vignette-kf{
    0%{box-shadow:inset 0 0 0 0 rgba(239,68,68,0);}
    35%{box-shadow:inset 0 0 100px 22px rgba(239,68,68,.4);}
    100%{box-shadow:inset 0 0 0 0 rgba(239,68,68,0);}
  }

  .shop-fx-travel-dot{position:fixed;width:12px;height:12px;margin:-6px 0 0 -6px;border-radius:50%;
    background:radial-gradient(circle,#fde68a,#f59e0b 70%);box-shadow:0 0 12px 3px rgba(245,158,11,.7);
    pointer-events:none;z-index:70;
    animation:shop-fx-travel-kf .6s ease-in-out both;}
  @keyframes shop-fx-travel-kf{
    0%{opacity:0;transform:translate(0,0) scale(.4);}
    15%{opacity:1;transform:translate(0,0) scale(1);}
    90%{opacity:1;}
    100%{opacity:0;transform:translate(var(--dx),var(--dy)) scale(.6);}
  }

  @media (prefers-reduced-motion:reduce){
    .shop-card.shake,.shop-banner,.shop-toast,.shop-modal,.shop-modal-backdrop{animation:none;}
    .shop-fx-num,.shop-fx-blocked-label,.shop-wild-number,.shop-wild-rolled-number{animation:none;}
  }
  `;
  document.head.appendChild(style);
}

// =============================================================================
// helpers — attack math
// =============================================================================
function otherHouses(store, buyerId) {
  return Object.values(store.HOUSES).filter((h) => h.id !== buyerId);
}

function topHouseExcluding(store, buyerId) {
  const totals = store.getTotals('term').filter((t) => t.house.id !== buyerId);
  return totals[0] ? totals[0].house : null;
}

// =============================================================================
// item catalog helpers — validation + image resolution
// =============================================================================
// The points pill should span exactly the width of the heading text above it
// (title/subtitle block), with the two shields sitting outside that span.
// Measured after paint because the heading is fluid-typed.
function sizeTreasuryToHeadings(root) {
  try {
    const headings = root.querySelector('.shop-headings');
    const pill = root.querySelector('.shop-treasury');
    if (!headings || !pill) return;
    const w = Math.round(headings.getBoundingClientRect().width);
    if (w > 0) { pill.style.width = w + 'px'; }
  } catch (e) { /* presentation only — never break the shop */ }
}

function itemIssues(item) {
  if (!item || typeof item !== 'object') return ['missing item'];
  const issues = [];
  if (!item.name) issues.push('missing name');
  // Mythic rewards are never purchased with points — cost 0 is expected there.
  if (!item.mythicOnly && !(Number(item.cost) > 0)) issues.push('invalid cost');
  if (!item.effect || !KNOWN_KINDS.has(item.effect.kind)) issues.push('unknown effect');
  else if (!(Number(item.effect.amount) > 0)) issues.push('invalid amount');
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
      mediaFetching.add(key);
      media.url(key)
        .then((url) => { mediaUrlCache.set(key, url || null); mediaFetching.delete(key); onReady && onReady(); })
        .catch(() => { mediaUrlCache.set(key, null); mediaFetching.delete(key); onReady && onReady(); });
    }
    return undefined;
  }
  return raw; // plain URL / path
}

// Always returns the same fixed-size art slot (image or emoji fallback) so
// every card's art occupies identical height, whether or not it has artwork.
function itemArtHtml(item) {
  const resolved = resolveItemImage(item, () => { if (currentRenderFn) currentRenderFn(); });
  if (resolved) {
    return `<div class="shop-card-art"><img src="${esc(resolved)}" alt="${esc(item.name)}" class="shop-card-img"
      onerror="this.parentElement.innerHTML='<div class=&quot;shop-card-emoji&quot;>${esc(item.emoji || '✨')}</div>';" /></div>`;
  }
  return `<div class="shop-card-art"><div class="shop-card-emoji">${esc(item.emoji || '✨')}</div></div>`;
}

// =============================================================================
// RENDER
// =============================================================================
// Consumables (attack/steal/pierce/wild) show how many the buyer already
// bought this week — the only "you've already got one" signal that fits their
// repeatable nature, mirroring the shield/reduce "ACTIVE" line below.
const CONSUMABLE_KINDS = new Set(['attack', 'steal', 'pierce', 'wild']);

function itemCard(store, s, item, buyerId) {
  const issues = itemIssues(item);
  if (issues.length) {
    const nm = item?.name || 'Unknown Item';
    const desc = item?.desc || '';
    return `
      <div class="shop-card shop-card-broken" data-card="${esc(item?.id || 'unknown')}">
        <div class="shop-card-art"><div class="shop-card-emoji">❓</div></div>
        <div class="shop-card-name" title="${esc(nm)}">${esc(nm)}</div>
        <div class="shop-kind-tag" title="Unavailable">⚠️ Unavailable</div>
        <div class="shop-flavor" title="${esc(desc)}">${esc(desc)}</div>
        <div class="shop-card-status"><div class="shop-broken-note">⚠️ Misconfigured — ask your teacher to fix this item in Admin.</div></div>
        <button type="button" class="shop-buy-btn" disabled>Unavailable</button>
      </div>`;
  }

  const kind = item.effect.kind;
  const treasury = store.getTotal(buyerId, 'term');
  const affordable = treasury >= item.cost;
  const art = itemArtHtml(item);
  const kindTag = `<div class="shop-kind-tag" title="${esc(kindLabel(kind))}">${esc(kindLabel(kind))}</div>`;

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

  if ((kind === 'attack' || kind === 'pierce') && s.targetPicker === item.id) {
    const targets = otherHouses(store, buyerId);
    return `
      <div class="shop-card" data-card="${esc(item.id)}">
        <div class="shop-cost-badge">${item.cost} pts</div>
        ${art}
        <div class="shop-card-name" title="${esc(item.name)}">${esc(item.name)}</div>
        ${kindTag}
        <div class="shop-flavor">Choose a target house:</div>
        <div class="shop-target-picker">
          ${targets.map((h) => `
            <button type="button" class="shop-target-chip" data-target-item="${esc(item.id)}" data-target-house="${h.id}" style="--tc-accent:${h.accent}">
              <span class="shop-target-thumb" style="border-color:${h.accent}">${houseImg(h, 'w-full h-full')}</span>
              ${esc(h.name)}
            </button>`).join('')}
        </div>
        <button type="button" class="shop-target-cancel" data-target-cancel="${esc(item.id)}">Cancel</button>
      </div>`;
  }

  // attack / pierce (no picker open) / steal / wild all use the plain BUY card.
  const boughtCount = CONSUMABLE_KINDS.has(kind) ? boughtThisWeekCount(store, buyerId, item.name) : 0;
  return `
    <div class="shop-card" data-card="${esc(item.id)}">
      <div class="shop-cost-badge">${item.cost} pts</div>
      ${art}
      <div class="shop-card-name" title="${esc(item.name)}">${esc(item.name)}</div>
      ${kindTag}
      <div class="shop-flavor" title="${esc(item.desc)}">${esc(item.desc)}</div>
      <div class="shop-card-status">${boughtCount > 0 ? `<div class="shop-bought-badge">Bought ×${boughtCount} this week</div>` : ''}</div>
      <button type="button" class="shop-buy-btn" data-buy="${esc(item.id)}" ${affordable ? '' : 'disabled'}>BUY</button>
    </div>`;
}

function defenseWarnHtml(store, target) {
  if (!target) return '';
  if (store.isShielded(target.id)) {
    return `<br><br>⚠️ ${esc(target.name)} is shielded — the attack will be <b>blocked</b>, but the cost is still paid.`;
  }
  if (store.hasReduction(target.id)) {
    return `<br><br>🕵️ ${esc(target.name)} has damage reduction active — this hit will be <b>halved</b>.`;
  }
  return '';
}

function pierceNoteHtml(store, target) {
  if (!target) return '';
  const defended = store.isShielded(target.id) || store.hasReduction(target.id);
  return defended
    ? `<br><br>🫥 ${esc(target.name)} is defended, but this strike <b>ignores shields and damage reduction</b> entirely.`
    : `<br><br>🫥 This strike <b>ignores any shield or damage reduction</b>.`;
}

function confirmModalHtml(store, s) {
  if (!s.confirm) return '';
  const item = store.getShopItems().find((i) => i.id === s.confirm.itemId);
  if (!item || itemIssues(item).length) return '';
  const { buyerId, targetId } = s.confirm;
  const buyer = store.HOUSES[buyerId];
  const target = targetId != null ? store.HOUSES[targetId] : null;
  const amount = item.effect.amount;
  const kind = item.effect.kind;

  let bodyHtml = '';
  let confirmLabel = 'Confirm Purchase';

  if (kind === 'steal') {
    bodyHtml = `<b>${esc(buyer.name)}</b> will spend <b>${item.cost} pts</b> to steal <b>${amount} pts</b> from the leading rival, <b>${target ? esc(target.name) : '—'}</b>.${defenseWarnHtml(store, target)}`;
  } else if (kind === 'attack') {
    bodyHtml = `<b>${esc(buyer.name)}</b> will spend <b>${item.cost} pts</b> to deduct <b>${amount} pts</b> from <b>${target ? esc(target.name) : '—'}</b>.${defenseWarnHtml(store, target)}`;
  } else if (kind === 'pierce') {
    bodyHtml = `<b>${esc(buyer.name)}</b> will spend <b>${item.cost} pts</b> to strike <b>${target ? esc(target.name) : '—'}</b> for <b>${amount} pts</b>.${pierceNoteHtml(store, target)}`;
  } else if (kind === 'shield') {
    bodyHtml = `<b>${esc(buyer.name)}</b> will spend <b>${item.cost} pts</b> to raise the ${esc(item.name)}, blocking incoming attacks for <b>${amount} hour${amount === 1 ? '' : 's'}</b>.`;
  } else if (kind === 'reduce') {
    bodyHtml = `<b>${esc(buyer.name)}</b> will spend <b>${item.cost} pts</b> to activate ${esc(item.name)}, halving incoming damage for <b>${amount} hour${amount === 1 ? '' : 's'}</b>.`;
  } else if (kind === 'wild') {
    bodyHtml = `<b>${esc(buyer.name)}</b> will spend <b>${item.cost} pts</b> to open ${esc(item.name)} — a d20 roll decides the fate, up to <b>±${amount} pts</b>. Watch the die land!`;
    confirmLabel = '🎲 Take the Risk!';
  }

  return `
    <div class="shop-modal-backdrop" data-modal-backdrop>
      <div class="shop-modal">
        <div class="shop-modal-emoji">${esc(item.emoji || '✨')}</div>
        <div class="shop-modal-title">Confirm: ${esc(item.name)}</div>
        <div class="shop-modal-body">${bodyHtml}</div>
        <div class="shop-modal-actions">
          <button type="button" class="shop-modal-btn shop-modal-cancel" data-modal-cancel>Cancel</button>
          <button type="button" class="shop-modal-btn shop-modal-confirm" data-modal-confirm>${confirmLabel}</button>
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
  const buyer = store.getActiveHouse();
  const items = store.getShopItems();
  const mythic = items.filter((it) => it.mythicOnly && !itemIssues(it).length);

  const headerHtml = `
    <div class="shop-header">
      <img class="shop-header-mark" src="images/icon-market.png" alt="" onerror="this.style.visibility='hidden'" />
      <div class="shop-headings">
        <div class="shop-title font-display"><span class="mh-ink">THE FRIDAY MAGIC SHOP</span></div>
        <div class="shop-subtitle"><span class="mh-ink">Spend your hoard. Strike your rivals. Guard your points.</span></div>
      </div>
      <span class="shop-header-spacer" aria-hidden="true"></span>
    </div>`;

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

    const offensive = buyable.filter((it) => !itemIssues(it).length && ['attack', 'steal', 'pierce'].includes(it.effect?.kind));
    const defensive = buyable.filter((it) => !itemIssues(it).length && ['shield', 'reduce'].includes(it.effect?.kind));
    const wildcards = buyable.filter((it) => !itemIssues(it).length && it.effect?.kind === 'wild');
    const broken = buyable.filter((it) => itemIssues(it).length);
    const anyBuyable = offensive.length || defensive.length || wildcards.length || broken.length;

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

      ${anyBuyable ? `
        ${sectionHtml('⚔️ Offensive', offensive, store, s, buyerId)}
        ${sectionHtml('🛡️ Defensive', defensive, store, s, buyerId)}
        ${sectionHtml('🎲 Wildcards', wildcards, store, s, buyerId)}
        ${sectionHtml('⚠️ Needs Attention', broken, store, s, buyerId)}
      ` : '<div class="shop-empty">The shop shelves are empty — check back after your teacher stocks it in Admin.</div>'}

      ${mythicSectionHtml(mythic)}
    `;
  }

  rootEl.innerHTML = `
    <div class="shop-root">
      ${headerHtml}
      ${bodyHtml}
    </div>
    ${confirmModalHtml(store, s)}
  `;
  fitMastheadWhenReady({
    icon: rootEl.querySelector('.shop-header-mark'),
    titleInk: rootEl.querySelector('.shop-title .mh-ink'),
    subInk: rootEl.querySelector('.shop-subtitle .mh-ink'),
    headings: rootEl.querySelector('.shop-headings'),
    pill: rootEl.querySelector('.shop-treasury'),
  });
}

// =============================================================================
// feedback: banner / toast / shake
// =============================================================================
function showBanner(text) {
  const el = document.createElement('div');
  el.className = 'shop-banner';
  el.textContent = text;
  rootEl.appendChild(el);
  later(() => {
    el.classList.add('shop-banner-out');
    later(() => el.remove(), 300);
  }, 2200);
}

function showToast(text) {
  const existing = rootEl.querySelector('.shop-toast');
  if (existing) existing.remove();
  const el = document.createElement('div');
  el.className = 'shop-toast';
  el.textContent = text;
  rootEl.appendChild(el);
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
// COMBAT EFFECTS — attack landing, steal travel, block, pierce, reduce.
// Pure CSS/DOM, ≤900ms, pointer-events:none, respects prefers-reduced-motion,
// tracked in fxNodes for guaranteed cleanup.
// =============================================================================
function screenVignette() {
  if (prefersReducedMotion()) return; // decorative-only — skip entirely under reduced motion
  const host = document.getElementById('overlay-root');
  if (!host) return;
  spawnFxPlain(host, 'shop-fx-vignette-red', 700);
}

function attackLandingFx(targetChip, amount) {
  screenVignette();
  if (!targetChip) return;
  const reduced = prefersReducedMotion();
  if (!reduced) {
    spawnFx(targetChip, 'shop-fx-flash shop-fx-flash-red', 500);
    const slash = spawnFx(targetChip, 'shop-fx-slash', 450);
    if (slash) slash.innerHTML = '<span class="shop-fx-slash-mark"></span>';
    targetChip.classList.remove('shop-fx-hit');
    void targetChip.offsetWidth;
    targetChip.classList.add('shop-fx-hit');
    later(() => targetChip.classList.remove('shop-fx-hit'), 450);
  }
  spawnFx(targetChip, 'shop-fx-num shop-fx-num-bad', 900, `-${amount}`);
}

// Pierce: a ghostly phase-through beat, then the normal attack landing plays.
function pierceFx(targetChip, appliedAmount) {
  if (!targetChip) return;
  const reduced = prefersReducedMotion();
  if (!reduced) spawnFx(targetChip, 'shop-fx-phase', 350);
  later(() => attackLandingFx(targetChip, appliedAmount), reduced ? 0 : 220);
}

// Reduction: shows the halving explicitly ("30 → 15") and flares the reduce badge.
function reducedFx(targetChip, rawAmount, appliedAmount) {
  screenVignette();
  if (!targetChip) return;
  const reduced = prefersReducedMotion();
  if (!reduced) {
    spawnFx(targetChip, 'shop-fx-flash shop-fx-flash-amber', 500);
    const slash = spawnFx(targetChip, 'shop-fx-slash', 450);
    if (slash) slash.innerHTML = '<span class="shop-fx-slash-mark"></span>';
    targetChip.classList.remove('shop-fx-hit');
    void targetChip.offsetWidth;
    targetChip.classList.add('shop-fx-hit');
    later(() => targetChip.classList.remove('shop-fx-hit'), 450);
  }
  spawnFx(targetChip, 'shop-fx-num shop-fx-num-bad', 900, `${rawAmount} → ${appliedAmount}`);
}

// Traveling golden dot from the target chip to the buyer chip, using
// getBoundingClientRect() + position:fixed so it reads correctly regardless
// of where the chips sit in the (scrollable) buyer row.
function travelDot(fromEl, toEl) {
  if (prefersReducedMotion()) return;
  if (!fromEl || !toEl || !rootEl) return;
  const a = fromEl.getBoundingClientRect();
  const b = toEl.getBoundingClientRect();
  const dot = document.createElement('div');
  dot.className = 'shop-fx-travel-dot';
  dot.style.left = `${a.left + a.width / 2}px`;
  dot.style.top = `${a.top + a.height / 2}px`;
  dot.style.setProperty('--dx', `${(b.left + b.width / 2) - (a.left + a.width / 2)}px`);
  dot.style.setProperty('--dy', `${(b.top + b.height / 2) - (a.top + a.height / 2)}px`);
  rootEl.appendChild(dot);
  fxNodes.add(dot);
  later(() => { dot.remove(); fxNodes.delete(dot); }, 650);
}

function stealFx(buyerChip, targetChip, amount) {
  spawnFx(targetChip, 'shop-fx-num shop-fx-num-bad', 900, `-${amount}`);
  spawnFx(buyerChip, 'shop-fx-num shop-fx-num-good', 900, `+${amount}`);
  travelDot(targetChip, buyerChip);
}

function blockFx(targetChip) {
  if (!targetChip) return;
  const reduced = prefersReducedMotion();
  if (!reduced) {
    spawnFx(targetChip, 'shop-fx-shield-ring', 700);
    spawnFx(targetChip, 'shop-fx-flash shop-fx-flash-blue', 500);
  }
  spawnFx(targetChip, 'shop-fx-blocked-label', 900, '🛡️ BLOCKED');
}

// =============================================================================
// purchase resolution
// =============================================================================

// 'wild' is its own flow: pay immediately, then a REAL d20 roll (via the
// shared dice3d API) decides the swing live on screen — the class watches it
// land before the score changes. The outcome table is shown beside the tray
// so the mapping is never a mystery. Points apply the instant the die
// settles (or, in the fallback/rejection path, the instant a substitute draw
// resolves) — never silently, and never before the reveal.
function playWildReveal(s, item, buyer, buyerId, mountedRootAtStart) {
  const store = ctxRef.store;
  const audio = ctxRef.audio;
  const host = document.getElementById('overlay-root');
  const amount = item.effect.amount;
  const table = wildOutcomeTable(amount);
  wildRollActive = true;

  // Defensive fallback if the shared overlay host is ever missing — still
  // resolves fairly and never silently.
  if (!host) {
    const value = 1 + Math.floor(Math.random() * 20);
    const row = wildRowForRoll(value, table) || { amount: 0 };
    store.addPoints(buyerId, row.amount, { reason: `${item.name} — rolled ${value}`, tag: 'wild' });
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
  }

  // Pacing (so the class can actually follow the roll, not blink and miss it):
  //   die settles -> rolled number + matching stakes row hold ~1.5-2s
  //   -> fade out -> RESULT ("+6"/"−12") appears, holds a full 2s
  //   -> ONLY THEN points are applied and the treasury count animates up/down.
  const HOLD_ROLL_MS = 1800;
  const FADE_MS = 300;
  const HOLD_RESULT_MS = 2000;
  const COUNT_MS = 900;
  const POST_COUNT_MS = 500;

  function finish(value) {
    const row = wildRowForRoll(value, table) || { min: value, max: value, amount: 0 };
    const swing = row.amount;
    const good = swing > 0;
    const neutral = swing === 0;
    const startTotal = store.getTotal(buyerId, 'term'); // cost already spent; swing not applied yet

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
          // ---- ONLY NOW do the points actually move: apply + animate the
          // treasury counter together, so the stored total and the screen
          // change in lockstep.
          store.addPoints(buyerId, swing, {
            reason: `${item.name} — rolled ${value}: ${neutral ? 'no change' : good ? 'fortune!' : 'misfortune!'}`,
            tag: 'wild',
          });
          audio.sfx(good ? 'coin' : 'thud');
          if (rootEl === mountedRootAtStart) render(s);

          const finishUp = () => later(() => {
            overlay.classList.add('shop-wild-fadeout');
            later(teardownOverlay, 350);
          }, POST_COUNT_MS);

          const treasuryLineEl = overlay.querySelector('.shop-wild-treasury-line');
          if (treasuryLineEl) {
            treasuryLineEl.classList.add('show');
            animateTreasuryCount(treasuryLineEl, startTotal, startTotal + swing, COUNT_MS, finishUp);
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

async function resolvePurchase(s) {
  const store = ctxRef.store;
  const audio = ctxRef.audio;
  const item = store.getShopItems().find((i) => i.id === s.confirm.itemId);
  if (!item || itemIssues(item).length) { s.confirm = null; render(s); return; }
  const { buyerId, targetId } = s.confirm;
  const kind = item.effect.kind;

  // Gate the spend itself — one PIN entry per shop session (lock.js keeps a
  // 15-minute unlock window), not one per purchase. Everything above this
  // line only reads the pending confirm state; nothing has been charged yet,
  // and this single gate sits before BOTH the wild dispatch below and the
  // normal store.purchase() further down, so it covers both paths.
  const mountedRootAtStart = rootEl;
  const allowed = await lock.requireUnlock('buy this item');
  if (rootEl !== mountedRootAtStart) return; // shop was unmounted while the PIN pad was open
  if (!allowed) return; // PIN refused — no charge, no sound, no FX, no banner; confirm modal stays open as-is

  if (kind === 'wild') { resolveWildPurchase(s, item, buyerId); return; }

  const buyer = store.HOUSES[buyerId];
  const target = targetId != null ? store.HOUSES[targetId] : null;
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

  let result = null;
  if (kind === 'shield') {
    store.activateShield(buyerId, amount);
  } else if (kind === 'reduce') {
    store.activateReduction(buyerId, amount);
  } else if (kind === 'attack' || kind === 'pierce') {
    result = store.applyAttack({ fromId: buyerId, toId: target.id, amount, pierce: kind === 'pierce', label: item.name });
  } else if (kind === 'steal') {
    // The ONE combat rule resolves shield/reduction on the deduction; the
    // buyer then loots exactly what was actually taken (0 if blocked, half
    // if reduced) — never more than the target really lost.
    result = store.applyAttack({ fromId: buyerId, toId: target.id, amount, pierce: false, label: item.name });
    if (result.outcome !== 'blocked' && result.applied > 0) {
      store.addPoints(buyerId, result.applied, { reason: `${item.name} loot from ${target.name}`, tag: 'attack' });
    }
  }

  // Every store mutation above already fired its own synchronous re-render
  // via store.subscribe (innerHTML rebuild) — close the modal and let that
  // settle FIRST. Only after this render are buyer/target chip elements
  // guaranteed to be the ones actually attached to the page; querying them
  // any earlier risks grabbing nodes that are about to be replaced, and
  // spawning banner/fx nodes before this render would just get wiped by it.
  s.confirm = null;
  s.targetPicker = null;
  render(s);

  const buyerChip = rootEl.querySelector(`[data-buyer="${buyerId}"]`);
  const targetChip = target ? rootEl.querySelector(`[data-buyer="${target.id}"]`) : null;

  if (kind === 'shield') {
    showBanner(`${buyer.name} raised the ${item.name}! ${emoji}`);
    return;
  }
  if (kind === 'reduce') {
    showBanner(`${buyer.name} activated ${item.name}! ${emoji}`);
    return;
  }

  // attack / steal / pierce share the same outcome-driven fx.
  if (result.outcome === 'blocked') {
    audio.sfx('sword');
    blockFx(targetChip);
    showBanner(`🛡️ ${target.name} blocked the ${item.name} from ${buyer.name}!`);
    return;
  }

  audio.sfx('thud');
  if (result.outcome === 'pierced') pierceFx(targetChip, result.applied);
  else if (result.outcome === 'reduced') reducedFx(targetChip, amount, result.applied);
  else attackLandingFx(targetChip, result.applied);

  if (kind === 'steal') {
    const note = result.outcome === 'reduced' ? ` (defenses halved it: ${amount} → ${result.applied})`
      : result.outcome === 'pierced' ? ' (slipped past defenses!)' : '';
    showBanner(`${buyer.name} stole ${result.applied} pts from ${target.name}!${note} ${emoji}`);
  } else {
    const verb = result.outcome === 'pierced' ? 'pierced' : result.outcome === 'reduced' ? 'struck (halved)' : 'struck';
    showBanner(`${buyer.name} ${verb} ${target.name} for ${result.applied} pts! ${emoji}`);
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
        if (!item || itemIssues(item).length) return;
        const treasury = store.getTotal(buyerId, 'term');
        if (treasury < item.cost) { showToast('Not enough points'); shakeCard(itemId); return; }

        const kind = item.effect.kind;
        if (kind === 'wild' && wildRollActive) {
          showToast('A roll is already in progress');
          return;
        }
        if (kind === 'shield' || kind === 'reduce' || kind === 'wild') {
          s.confirm = { itemId, buyerId, targetId: null };
          doRender();
          return;
        }
        if (kind === 'steal') {
          const target = topHouseExcluding(store, buyerId);
          s.confirm = { itemId, buyerId, targetId: target ? target.id : null };
          doRender();
          return;
        }
        if (kind === 'attack' || kind === 'pierce') {
          s.targetPicker = itemId;
          doRender();
          return;
        }
        return;
      }

      const targetCancel = e.target.closest('[data-target-cancel]');
      if (targetCancel) { s.targetPicker = null; doRender(); return; }

      const targetPick = e.target.closest('[data-target-item]');
      if (targetPick) {
        const activeHouse = store.getActiveHouse();
        if (!activeHouse) return;
        const itemId = targetPick.getAttribute('data-target-item');
        const houseId = Number(targetPick.getAttribute('data-target-house'));
        s.confirm = { itemId, buyerId: activeHouse.id, targetId: houseId };
        s.targetPicker = null;
        doRender();
        return;
      }

      const modalConfirm = e.target.closest('[data-modal-confirm]');
      if (modalConfirm) { resolvePurchase(s); return; }

      const modalCancel = e.target.closest('[data-modal-cancel]');
      const backdrop = e.target.matches('[data-modal-backdrop]') ? e.target : null;
      if (modalCancel || backdrop) { s.confirm = null; doRender(); return; }
    };
    rootEl.addEventListener('click', clickHandler);

    unsub = store.subscribe(doRender);
  },

  unmount() {
    clearTimers();
    clearFx();
    // A pending dice3d roll self-disposes once its host leaves the document
    // (clearFx() above already removed it), but do it immediately here too
    // rather than waiting on that ~500ms poll — no leaked canvas/RAF.
    if (activeWildRollDispose) { try { activeWildRollDispose(); } catch (e) {} activeWildRollDispose = null; }
    wildRollActive = false;
    if (unsub) { unsub(); unsub = null; }
    if (rootEl && clickHandler) rootEl.removeEventListener('click', clickHandler);
    clickHandler = null;
    rootEl = null;
    ctxRef = null;
    currentRenderFn = null;
  },
};
