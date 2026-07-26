// quests.js — Class Quests board (the screen the class looks at).
//
// The teacher's description of the loop, verbatim, is what this screen models:
//   "a house would agree to a task, that task would be moved to the top of the
//    task screen and no longer be available to choose below. The task is there
//    until it's completed. When it is in the active window and the conditions
//    are met, Mr. D can click a box and the task is complete. The points go to
//    the house. If a house decides they can't complete the task, and Mr. D
//    clicks an x on it, the points are deducted and another house can steal the
//    task. There are some tasks that can be repeated and open to other houses.
//    Some are one shots only."
//
// So: ONE hero card at the top (the accepted quest + the two teacher buttons),
// the board of still-available quests underneath, and a ledger of finished
// deeds at the bottom. All the mechanics live in the store — this file only
// renders them and asks for confirmation before anything scores.
//
// Owns ONLY this file. Follows ARCHITECTURE.md contract.
// Everything is sized with clamp(…vh…) so it reads from the back of the room
// at 1280x720 and doesn't turn into a wall of text at 1920x1080.

import { fitMastheadWhenReady } from '../core/masthead.js';
import { lock } from '../core/lock.js';
import { injectCarouselStyles, carouselHtml, wireCarousel, carouselScrollLeft } from '../core/carousel.js';

const STYLE_ID = 'quest-styles';

// ---- module-scoped lifecycle state (mount/unmount owns all of it) ----------
let ctxRef = null;
let rootEl = null;
let unsub = null;
let clickHandler = null;
let keyHandler = null;
let lockHandler = null;
let tickTimer = null;
const timers = new Set();
const fxNodes = new Set();
let carTeardown = null;   // teardown returned by the shared wireCarousel(), re-armed every render

// per-mount UI state
let ui = null;   // { modal: null | {...}, sortAsc: bool, celebrateCore: number|null }
let lastBoardW = 0;   // last measured grid width, reused when the carousel hides the grid

function initUi() {
  return { modal: null, sortAsc: false, celebrateCore: null };
}

function later(fn, ms) {
  const id = setTimeout(() => { timers.delete(id); try { fn(); } catch (e) { console.warn('quests:', e); } }, ms);
  timers.add(id);
  return id;
}
function clearTimers() { timers.forEach(clearTimeout); timers.clear(); }
function clearFx() { fxNodes.forEach((n) => { try { n.remove(); } catch (e) {} }); fxNodes.clear(); }

function esc(s) {
  return String(s == null ? '' : s).replace(/[&<>"']/g, (c) =>
    ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}

function prefersReducedMotion() {
  return !!(window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches);
}

// The store defaults a quest's give-up penalty to half its reward; older
// saved quests may predate the field, so mirror that default here rather than
// showing the teacher "−undefined".
// The colour this SCREEN is dressed in. Follows the active house unless the
// teacher has given Quests its own colour in Admin (see store.MODULE_THEMES).
//
// Used for the screen's own chrome — the quest cards and the active-quest
// frame. Things that identify a PARTICULAR house keep the house's colour:
// the All Cores cards, the Hall of Deeds rows, and the running total. A board
// that is entirely one colour would lose that distinction.
function screenAccent(store, house) {
  const fallback = {
    color: house ? house.accent : '#f59e0b',
    soft: house ? house.accentSoft : 'rgba(245,158,11,.35)',
  };
  try {
    const t = store.getModuleTheme('quests');
    if (!t || !t.configurable || t.matchHouse || !t.color) return fallback;
    const n = t.color.replace('#', '');
    const rgb = [0, 2, 4].map((i) => parseInt(n.slice(i, i + 2), 16)).join(',');
    return { color: t.color, soft: `rgba(${rgb},0.35)` };
  } catch (e) { return fallback; }
}

function penaltyOf(q) {
  const p = Number(q?.penalty);
  return Number.isFinite(p) ? Math.max(0, Math.round(p)) : Math.round(Number(q?.points || 0) / 2);
}

// "how long it's been active", phrased to slot into "accepted ___ ago".
// Deliberately coarse — nobody at the back of the room needs seconds.
function activeFor(ts) {
  if (!ts) return 'a moment';
  const mins = Math.floor((Date.now() - ts) / 60000);
  if (mins < 1) return 'a moment';
  if (mins < 60) return `${mins} min`;
  const h = Math.floor(mins / 60);
  const m = mins % 60;
  if (h < 24) return m ? `${h}h ${m}m` : `${h}h`;
  const d = Math.floor(h / 24);
  return d === 1 ? '1 day' : `${d} days`;
}

function shortWhen(ts) {
  if (!ts) return '';
  const mins = Math.floor((Date.now() - ts) / 60000);
  if (mins < 1) return 'just now';
  if (mins < 60) return `${mins}m ago`;
  const h = Math.floor(mins / 60);
  if (h < 24) return `${h}h ago`;
  const d = Math.floor(h / 24);
  if (d === 1) return 'yesterday';
  if (d < 7) return `${d}d ago`;
  return new Date(ts).toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
}

// =============================================================================
// STYLES — injected once, under the quest- prefix, removed on unmount.
// =============================================================================
function injectStyles() {
  if (document.getElementById(STYLE_ID)) return;
  const s = document.createElement('style');
  s.id = STYLE_ID;
  s.textContent = `
  /* ---- layout: header + hero pinned, board scrolls, deeds pinned ---- */
  /* --rgap / --bgap are the column gaps, held in variables so the two rules
     below can top them up to exactly one card-gap (1.1rem) without inflating
     every other gap in the stack. */
  .quest-root{--rgap:clamp(8px,1.4vh,18px);height:100%;display:flex;flex-direction:column;gap:var(--rgap);
    padding:clamp(8px,1.4vh,16px) clamp(12px,1.8vw,26px) clamp(10px,1.6vh,20px);
    background:radial-gradient(ellipse at 50% -20%,rgba(245,158,11,.13),transparent 60%),var(--color-page,#0b0f19);
    color:var(--color-text,#f9fafb);overflow:hidden;box-sizing:border-box;}

  /* ---- masthead (mirrors the Magic Shop header) ---- */
  /* The quest mark sits OUTSIDE the centred text block, so the title and
     subtitle centre on each other rather than on "icon + title". */
  /* TEXT centres on the screen; the scroll mark hangs left with a matching
     spacer on the right so the centring is of the text, not "icon + text". */
  .quest-head{flex-shrink:0;display:flex;align-items:flex-start;justify-content:center;
    gap:clamp(.5rem,1.4vw,1.1rem);}
  .quest-headings{text-align:center;}
  .mh-ink{display:inline-block;white-space:nowrap;}
  .quest-head-icon,.quest-head-spacer{width:clamp(2.2rem,5.4vw,3.6rem);flex:0 0 auto;}
  .quest-head-icon{height:auto;object-fit:contain;
    filter:drop-shadow(0 4px 14px var(--accent-soft,rgba(245,158,11,.5)));}
  .quest-head-title{font-family:Cinzel,Georgia,serif;font-weight:800;letter-spacing:.05em;
    font-size:clamp(1.4rem,3.4vw,2.4rem);line-height:1.1;color:var(--accent,#f59e0b);
    text-shadow:0 0 26px var(--accent-soft,rgba(245,158,11,.4));}
  /* Scaled so the tagline spans roughly the same width as the title above it. */
  .quest-head-sub{color:#fcd34d;font-style:italic;font-weight:600;
    font-size:clamp(1.05rem,2.7vw,1.7rem);margin-top:.05rem;line-height:1.05;}

  /* ---- ACTIVE QUEST hero ---- */
  .quest-hero{flex-shrink:0;position:relative;display:flex;gap:clamp(12px,2vw,28px);flex-wrap:wrap;
    border:3px solid var(--h,#f59e0b);border-radius:1.5rem;padding:clamp(12px,2vh,24px) clamp(14px,2vw,28px);
    background:linear-gradient(135deg,rgba(31,41,55,.96),rgba(17,24,39,.98));
    box-shadow:0 0 34px var(--hs,rgba(245,158,11,.35)),0 18px 40px rgba(0,0,0,.45);
    animation:quest-hero-glow 3.4s ease-in-out infinite;}
  @keyframes quest-hero-glow{
    0%,100%{box-shadow:0 0 26px var(--hs,rgba(245,158,11,.3)),0 18px 40px rgba(0,0,0,.45);}
    50%{box-shadow:0 0 48px var(--hs,rgba(245,158,11,.5)),0 18px 40px rgba(0,0,0,.45);}
  }
  .quest-hero.quest-pop{animation:quest-pop-kf .6s cubic-bezier(.34,1.56,.64,1) both;}
  @keyframes quest-pop-kf{0%{transform:scale(1);}35%{transform:scale(1.02);}100%{transform:scale(1);}}
  .quest-hero-main{flex:1 1 min(560px,100%);min-width:0;display:flex;flex-direction:column;
    gap:clamp(7px,1vh,10px);justify-content:center;}
  /* The quest's own mark, same idea as on the cards — sized off the title so
     the two read as one line rather than an icon parked beside a heading. */
  .quest-hero-head{display:flex;align-items:baseline;gap:clamp(8px,1.2vw,16px);min-width:0;}
  .quest-hero-icon{flex:0 0 auto;line-height:1;font-size:clamp(1.5rem,3.6vh,2.4rem);
    filter:drop-shadow(0 4px 12px var(--hs,rgba(245,158,11,.5)));}
  .quest-hero-eyebrow{display:flex;align-items:center;gap:clamp(6px,1vw,12px);flex-wrap:wrap;
    font-size:clamp(1rem,1.8vh,1.25rem);font-weight:800;letter-spacing:.1em;text-transform:uppercase;
    color:var(--h,#f59e0b);}
  .quest-hero-crest{height:clamp(1.7rem,3.6vh,2.6rem);width:auto;object-fit:contain;flex-shrink:0;
    filter:drop-shadow(0 4px 10px rgba(0,0,0,.6));}
  .quest-hero-timer{color:var(--color-text-soft,#9ca3af);letter-spacing:.02em;text-transform:none;font-weight:700;}
  .quest-hero-title{font-family:Cinzel,Georgia,serif;font-weight:800;line-height:1.06;
    font-size:clamp(1.7rem,4.6vh,3.2rem);color:#f9fafb;margin:0;}
  .quest-hero-desc{font-size:clamp(1.05rem,2.4vh,1.7rem);line-height:1.35;color:#e5e7eb;margin:0;
    max-width:60ch;}

  /* Centred, and no longer a filled pill. As a pill it sat hard left while the
     Accept button below it sat centred, so the card read lopsided — and the
     block of colour competed with the button for attention. It is a footnote
     about the quest, so it now reads as one: small coloured text with a mark. */
  .quest-chip-row{display:flex;justify-content:center;gap:clamp(6px,.8vw,12px);flex-wrap:wrap;
    margin-top:auto;padding-top:0;}
  .quest-chip{display:inline-flex;align-items:center;gap:.4em;
    font-size:clamp(.85rem,1.4vh,.98rem);font-weight:700;letter-spacing:.02em;
    white-space:nowrap;background:none;border:none;padding:0;}
  .quest-chip-repeat{color:#4ade80;}
  .quest-chip-once{color:#c4b5fd;}

  .quest-hero-side{flex:0 0 clamp(230px,22vw,320px);display:flex;flex-direction:column;
    gap:clamp(6px,1vh,12px);justify-content:center;}

  .quest-act{width:100%;min-height:clamp(52px,7.4vh,74px);border-radius:1rem;border:none;cursor:pointer;
    font-weight:800;font-size:clamp(1.05rem,2.2vh,1.5rem);font-family:inherit;
    display:flex;align-items:center;justify-content:center;gap:.5em;flex-wrap:wrap;
    transition:transform .12s ease,filter .16s ease;touch-action:manipulation;}
  .quest-act:hover{filter:brightness(1.1);}
  .quest-act:active{transform:scale(.96);}
  .quest-act small{font-size:.72em;font-weight:800;opacity:.85;}
  .quest-act-done{background:linear-gradient(135deg,#22c55e,#15803d);color:#04220f;
    box-shadow:0 10px 26px rgba(34,197,94,.4);}
  .quest-act-fail{background:rgba(127,29,29,.55);border:2px solid #ef4444;color:#fecaca;}

  /* empty hero — no quest accepted yet */
  .quest-hero-empty{flex-shrink:0;display:flex;align-items:center;justify-content:center;gap:clamp(10px,1.6vw,22px);
    flex-wrap:wrap;text-align:center;border:3px dashed var(--h,#374151);border-radius:1.5rem;
    padding:clamp(14px,2.6vh,30px) clamp(14px,2vw,28px);background:rgba(17,24,39,.7);}
  .quest-hero-empty-icon{font-size:clamp(2rem,5vh,3.4rem);line-height:1;}
  .quest-hero-empty-title{font-family:Cinzel,Georgia,serif;font-weight:800;
    font-size:clamp(1.2rem,3vh,2rem);color:#f3f4f6;}
  .quest-hero-empty-sub{font-size:clamp(1.05rem,2vh,1.35rem);color:var(--color-text-soft,#9ca3af);margin-top:.15em;}

  /* ---- All Cores: four active quests side by side ---- */
  .quest-all-grid{flex-shrink:0;display:grid;grid-template-columns:repeat(4,1fr);gap:clamp(8px,1vw,16px);}
  @media (max-width:900px){.quest-all-grid{grid-template-columns:repeat(2,1fr);}}
  .quest-all-card{border:2px solid var(--h,#374151);border-left-width:8px;border-radius:1.1rem;
    padding:clamp(8px,1.4vh,16px) clamp(10px,1vw,16px);background:rgba(17,24,39,.9);
    display:flex;flex-direction:column;gap:.3em;min-height:clamp(110px,15vh,170px);}
  .quest-all-house{display:flex;align-items:center;gap:.45em;font-weight:800;color:var(--h,#f59e0b);
    font-size:clamp(1rem,2vh,1.35rem);}
  .quest-all-crest{height:clamp(1.3rem,2.8vh,2rem);width:auto;object-fit:contain;flex-shrink:0;}
  .quest-all-title{font-weight:700;color:#f3f4f6;font-size:clamp(1rem,2vh,1.35rem);line-height:1.25;}
  .quest-all-none{color:var(--color-text-soft,#9ca3af);font-style:italic;font-size:clamp(1rem,1.8vh,1.2rem);
    margin:auto 0;}
  .quest-all-foot{margin-top:auto;display:flex;align-items:baseline;justify-content:space-between;gap:.6em;
    padding-top:.4em;}
  .quest-all-pts{font-weight:800;color:#fde68a;font-size:clamp(1.1rem,2.4vh,1.6rem);}
  .quest-all-time{color:var(--color-text-soft,#9ca3af);font-size:clamp(.95rem,1.6vh,1.05rem);}

  /* ---- QUEST BOARD ---- */
  /* Sizing for the SHARED carousel engine (js/core/carousel.js) — it reads
     these two variables off any ancestor of the strip. Same numbers the
     prototype used, so switching a teacher over to the shared engine changes
     nothing about how the board looks. */
  .quest-board{--bgap:clamp(6px,1vh,12px);--carousel-card-w:clamp(215px,18vw,250px);--carousel-card-maxh:340px;
    flex:1;min-height:0;display:flex;flex-direction:column;gap:var(--bgap);
    /* One full card-gap between the active-quest field and the header row. */
    margin-top:calc(1.1rem - var(--rgap));}
  /* And the same again between the header row and the first row of cards. */
  .quest-grid,.car-wrap{margin-top:calc(1.1rem - var(--bgap));}
  .quest-board-head{flex-shrink:0;display:flex;align-items:center;gap:clamp(8px,1.2vw,18px);flex-wrap:wrap;}
  /* Its own class, NOT .quest-head-spacer: that one is a fixed-width mirror of
     the masthead's scroll icon and must stay fixed or the title stops being
     centred. Here the job is the opposite — eat the slack so the sort control
     lands on the grid's right edge instead of floating mid-row. */
  .quest-head-push{flex:1 1 auto;min-width:0;}
  .quest-board-title{font-family:Cinzel,Georgia,serif;font-weight:800;letter-spacing:.05em;
    font-size:clamp(1.1rem,2.6vh,1.8rem);color:#e5e7eb;}
  .quest-board-count{color:var(--color-text-soft,#9ca3af);font-weight:700;font-size:clamp(1rem,1.8vh,1.2rem);}
  .quest-sort{min-height:44px;padding:.4em 1em;border-radius:.8rem;border:1px solid var(--color-line,#374151);
    background:var(--color-card2,#1f2937);color:#e5e7eb;font-weight:700;font-family:inherit;cursor:pointer;
    font-size:clamp(1rem,1.7vh,1.1rem);}
  .quest-sort:hover{background:var(--color-line,#374151);}
  .quest-lockbar{flex-shrink:0;display:flex;align-items:center;gap:.5em;flex-wrap:wrap;
    font-size:clamp(1rem,2vh,1.35rem);font-weight:800;color:#fcd34d;
    background:rgba(245,158,11,.12);border:1px solid rgba(245,158,11,.45);
    border-radius:.9rem;padding:.5em .9em;}
  .quest-lockbar.quest-lockbar-info{color:#93c5fd;background:rgba(59,130,246,.12);border-color:rgba(59,130,246,.45);}

  /* Same rule as .shop-grid — cards match the Magic Shop's 300px exactly, which
     lands 3 across at 1280 instead of four narrower ones. */
  .quest-grid{flex:1;min-height:0;overflow-y:auto;display:grid;gap:1.1rem;
    grid-template-columns:repeat(auto-fit,minmax(240px,300px));align-content:start;
    /* Padding SYMMETRIC on purpose: the tracks are centred inside this box, so
       a one-sided pad would shift them off the --board-w axis below by half of
       it and the hero would no longer line up with the cards. */
    /* The scrollbar eats from ONE side, which narrows the content box and drags
       the centred tracks half a scrollbar to the left — the cards then sat 5.5px
       off the hero above them. Reserving the gutter on both edges keeps the
       tracks centred on the same axis whether the grid scrolls or not. */
    scrollbar-gutter:stable both-edges;
    justify-content:center;padding:0 4px 4px;}

  /* Everything above the grid is pinned to the width of the cards themselves,
     so the hero's left edge meets the left card's and the sort control lands
     on the right card's edge. --board-w is measured from the live column
     tracks in syncBoardWidth() (auto-fit means the count changes with width);
     the 100% fallback keeps this sane before the first measurement and in
     carousel mode, where there is no grid to match. */
  .quest-hero,.quest-hero-empty,.quest-lockbar,.quest-board-head,.quest-deeds{
    width:var(--board-w,100%);margin-left:auto;margin-right:auto;}
  /* One card-gap under the masthead too, so the rhythm above the active-quest
     field matches the rhythm below it. */
  .quest-hero,.quest-hero-empty{margin-top:calc(1.1rem - var(--rgap));}
  .quest-card{display:flex;flex-direction:column;gap:clamp(4px,.7vh,10px);border-radius:1.1rem;
    border:2px solid var(--color-line,#374151);background:linear-gradient(160deg,rgba(31,41,55,.92),rgba(17,24,39,.96));
    padding:clamp(16px,2.2vh,24px) clamp(16px,1.5vw,22px);
    transition:transform .16s ease,border-color .16s ease,box-shadow .16s ease;}
  .quest-card:not(.quest-card-locked):hover{transform:translateY(-3px);border-color:var(--accent,#f59e0b);
    box-shadow:0 12px 30px rgba(0,0,0,.45);}
  .quest-card-locked{opacity:.5;filter:grayscale(.35);}
  .quest-card-top{display:flex;align-items:flex-start;justify-content:space-between;gap:.7em;}
  /* The kind-of-task mark. Sized off the title so it reads as a sibling of the
     words, and flex-shrink:0 so a long title never squashes it. */
  .quest-type-icon{flex:0 0 auto;line-height:1.2;font-size:clamp(1.05rem,2.2vh,1.45rem);}
  .quest-card-title{font-weight:800;color:#f9fafb;line-height:1.2;font-size:clamp(1.1rem,2.3vh,1.55rem);
    flex:1 1 auto;min-width:0;}
  .quest-card-pts{flex-shrink:0;text-align:center;font-weight:800;line-height:1;color:#fde68a;
    font-size:clamp(1.35rem,3vh,2.1rem);}
  .quest-card-pts small{display:block;font-size:clamp(.75rem,1.4vh,.95rem);letter-spacing:.12em;text-transform:uppercase;
    color:var(--color-text-soft,#9ca3af);font-weight:800;margin-top:.25em;}
  /* Title and description share a column beside the icon, so the body copy
     starts at the TITLE's left edge rather than under the icon. No horizontal
     padding of its own — that would break the alignment it now inherits. */
  .quest-card-text{flex:1 1 auto;min-width:0;display:flex;flex-direction:column;
    gap:clamp(4px,.7vh,7px);}
  .quest-card-desc{color:#d1d5db;font-size:clamp(1rem,1.95vh,1.3rem);line-height:1.35;}
  /* Tight: description, frequency and button read as one block at the foot of
     the card, and the saved height comes straight off the card. */
  .quest-card-foot{margin-top:auto;display:flex;flex-direction:column;gap:clamp(5px,.8vh,9px);padding-top:.15em;}
  /* Sized to its words and centred, not full-bleed: a button as wide as the
     card read as a slab and crowded the chip above it. */
  .quest-accept{align-self:center;width:auto;padding:0 clamp(18px,2vw,30px);
    min-height:clamp(32px,3.6vh,38px);border-radius:999px;border:none;cursor:pointer;
    font-weight:800;font-family:inherit;font-size:clamp(.95rem,1.8vh,1.15rem);color:#0b0f19;
    background:var(--h,#f59e0b);box-shadow:0 8px 20px var(--hs,rgba(245,158,11,.35));
    display:flex;align-items:center;justify-content:center;gap:.4em;
    transition:transform .12s ease,filter .16s ease;touch-action:manipulation;}
  .quest-accept:hover{filter:brightness(1.1);}
  .quest-accept:active{transform:scale(.96);}
  .quest-card-note{font-size:clamp(1rem,1.7vh,1.1rem);font-weight:700;color:var(--color-text-soft,#9ca3af);
    text-align:center;}
  .quest-empty{grid-column:1/-1;text-align:center;font-style:italic;color:var(--color-text-soft,#9ca3af);
    font-size:clamp(1rem,2vh,1.3rem);padding:clamp(16px,3vh,36px);border:1px dashed var(--color-line,#374151);
    border-radius:1.1rem;}

  /* ---- Hall of Deeds ---- */
  .quest-deeds{flex-shrink:0;border:1px solid var(--color-line,#374151);border-radius:1.1rem;
    background:rgba(17,24,39,.8);padding:clamp(7px,1.1vh,14px) clamp(10px,1vw,16px);
    display:flex;align-items:center;gap:clamp(8px,1vw,16px);min-width:0;}
  .quest-deeds-title{flex-shrink:0;font-family:Cinzel,Georgia,serif;font-weight:800;color:#e5e7eb;
    font-size:clamp(1rem,1.9vh,1.25rem);letter-spacing:.04em;}
  .quest-deeds-strip{flex:1;min-width:0;display:flex;gap:clamp(6px,.8vw,12px);overflow-x:auto;padding-bottom:2px;}
  .quest-deed{flex-shrink:0;display:flex;align-items:center;gap:.6em;border-radius:.8rem;
    border:1px solid var(--color-line,#374151);border-left:5px solid var(--h,#6b7280);
    background:var(--color-card2,#1f2937);padding:.4em .8em;max-width:clamp(200px,22vw,300px);}
  /* ---- carousel layout: quest-card internals only ----
     The strip, arrows, counter and focus-scaling now live in the shared
     js/core/carousel.js (injectCarouselStyles / carouselHtml / wireCarousel).
     Everything below is genuinely about a QUEST CARD specifically, scoped to
     .car-strip > .quest-card — the shared engine has no idea what a quest
     card's internals look like, and never should. */
  /* Quest-accent highlight on the focused card. The shared engine only does
     scale/opacity/filter (generic to any card); the coloured glow uses this
     card's own --h/--hs, which is quest-specific. */
  .car-strip > .quest-card.is-focus{border-color:var(--h,#f59e0b);border-width:3px;
    box-shadow:0 0 40px var(--hs,rgba(245,158,11,.6)),0 20px 48px rgba(0,0,0,.6);}
  /* Card contents restack into a column so the art leads, like the Magic Shop —
     needed because the carousel card is narrow and tall, unlike the grid's. */
  .car-strip > .quest-card{text-align:center;}
  .car-strip > .quest-card .quest-card-top{flex-direction:column;align-items:center;gap:.35em;}
  .car-strip > .quest-card .quest-type-icon{font-size:clamp(2.6rem,7vh,3.6rem);line-height:1;
    filter:drop-shadow(0 6px 16px var(--hs,rgba(245,158,11,.45)));margin-bottom:.1em;}
  /* Title: centred, and clamped to two lines so a long one can't push the
     description out of the fixed-height card below. */
  .car-strip > .quest-card .quest-card-title{text-align:center;font-size:clamp(.95rem,2vh,1.15rem);
    display:-webkit-box;-webkit-line-clamp:2;-webkit-box-orient:vertical;overflow:hidden;}
  /* The card is a fixed-height flex column, so the description — the only
     freely shrinkable child — lost the fight and collapsed to a few pixels
     once the padding grew. Reserve exactly three lines and refuse to shrink;
     overflow:hidden clips cleanly even where -webkit-line-clamp is ignored. */
  .car-strip > .quest-card .quest-card-desc{font-size:clamp(.8rem,1.5vh,.92rem);line-height:1.3;
    flex:0 0 auto;height:3.9em;overflow:hidden;
    display:-webkit-box;-webkit-line-clamp:3;-webkit-box-orient:vertical;}
  /* Matches the grid's Accept button exactly — this used to be a separate,
     taller value forked in the prototype's own CSS, so the same control was
     two different heights depending on the view. */
  .car-strip > .quest-card .quest-accept{padding:0 clamp(12px,1.4vw,20px);font-size:.9rem;
    min-height:clamp(32px,3.6vh,38px);}

  /* Running total, sat next to the deeds it comes from. Pinned left of the
     strip so it never scrolls away with the entries. */
  .quest-deeds-total{flex-shrink:0;display:flex;align-items:baseline;gap:.35em;
    padding:.2em .7em;border-radius:999px;border:1px solid var(--h,#f59e0b);
    background:rgba(17,24,39,.9);box-shadow:0 0 16px var(--hs,rgba(245,158,11,.3));
    transition:transform .2s ease,box-shadow .2s ease;}
  .quest-deeds-crest{height:1.15em;width:auto;object-fit:contain;align-self:center;flex-shrink:0;}
  .quest-deeds-val{font-weight:800;color:#fde68a;font-variant-numeric:tabular-nums;
    font-size:clamp(1rem,1.9vh,1.25rem);line-height:1;}
  .quest-deeds-unit{font-size:.72em;font-weight:700;color:#fde68a;opacity:.85;}
  /* The kick when points land — this is the moment the row exists for. */
  .quest-deeds-total.is-hit{transform:scale(1.12);
    box-shadow:0 0 30px var(--hs,rgba(245,158,11,.75));}

  .quest-deed-icon{flex-shrink:0;font-size:clamp(1rem,1.7vh,1.15rem);line-height:1;}
  .quest-deed-main{min-width:0;}
  .quest-deed-title{font-weight:700;color:#f3f4f6;font-size:clamp(1rem,1.7vh,1.1rem);
    white-space:nowrap;overflow:hidden;text-overflow:ellipsis;}
  .quest-deed-meta{color:var(--color-text-soft,#9ca3af);font-size:clamp(.95rem,1.5vh,1rem);
    white-space:nowrap;overflow:hidden;text-overflow:ellipsis;}
  .quest-deed-pts{flex-shrink:0;font-weight:800;color:#4ade80;font-size:clamp(1.05rem,1.8vh,1.2rem);}
  .quest-deeds-none{color:var(--color-text-soft,#9ca3af);font-style:italic;font-size:clamp(1rem,1.7vh,1.1rem);}

  /* ---- confirm modal ---- */
  .quest-modal-bg{position:fixed;inset:0;z-index:60;background:rgba(0,0,0,.72);backdrop-filter:blur(3px);
    display:flex;align-items:center;justify-content:center;padding:1.5rem;animation:quest-fade .18s ease both;}
  @keyframes quest-fade{from{opacity:0;}to{opacity:1;}}
  .quest-modal{width:min(620px,100%);max-height:92vh;overflow-y:auto;border-radius:1.4rem;
    background:var(--color-card,#111827);border:3px solid var(--m,#f59e0b);padding:clamp(18px,3vh,32px);
    box-shadow:0 30px 80px rgba(0,0,0,.7),0 0 50px var(--ms,rgba(245,158,11,.3));text-align:center;
    animation:quest-modal-in .22s cubic-bezier(.34,1.56,.64,1) both;box-sizing:border-box;}
  @keyframes quest-modal-in{from{opacity:0;transform:scale(.92) translateY(12px);}to{opacity:1;transform:none;}}
  .quest-modal-icon{font-size:clamp(2.2rem,5vh,3.4rem);line-height:1;}
  .quest-modal-title{font-family:Cinzel,Georgia,serif;font-weight:800;color:var(--m,#f59e0b);
    font-size:clamp(1.3rem,3vh,2rem);margin:.3em 0 .35em;}
  .quest-modal-body{color:#e5e7eb;font-size:clamp(1.05rem,2.1vh,1.4rem);line-height:1.5;margin-bottom:.8em;}
  .quest-modal-body b{color:#fde68a;}
  .quest-modal-warn{margin:0 0 1em;padding:.7em 1em;border-radius:.8rem;font-weight:700;
    font-size:clamp(1rem,2vh,1.3rem);line-height:1.45;
    background:rgba(239,68,68,.14);border:1px solid rgba(239,68,68,.5);color:#fecaca;}
  .quest-modal-info{margin:0 0 1em;padding:.7em 1em;border-radius:.8rem;
    font-size:clamp(1rem,1.9vh,1.2rem);line-height:1.45;
    background:rgba(148,163,184,.12);border:1px solid rgba(148,163,184,.35);color:#cbd5e1;}
  .quest-modal-acts{display:flex;gap:.8em;}
  .quest-modal-btn{flex:1;min-height:clamp(52px,7vh,66px);border-radius:.95rem;border:none;cursor:pointer;
    font-weight:800;font-family:inherit;font-size:clamp(1rem,2.1vh,1.35rem);
    transition:transform .12s ease,filter .16s ease;touch-action:manipulation;}
  .quest-modal-btn:hover{filter:brightness(1.1);}
  .quest-modal-btn:active{transform:scale(.96);}
  .quest-modal-cancel{background:var(--color-card2,#1f2937);border:1px solid var(--color-line,#374151);color:#e5e7eb;}
  .quest-modal-go{background:var(--m,#f59e0b);color:#0b0f19;}
  .quest-modal-go.danger{background:#ef4444;color:#fff;}

  /* ---- celebration: points fly up from the hero ---- */
  .quest-fly{position:fixed;z-index:75;pointer-events:none;font-family:Cinzel,Georgia,serif;font-weight:800;
    color:#4ade80;text-shadow:0 4px 18px rgba(0,0,0,.8),0 0 24px rgba(74,222,128,.6);
    font-size:clamp(1.6rem,4vh,3rem);animation:quest-fly-kf 1.15s cubic-bezier(.2,.7,.3,1) both;}
  @keyframes quest-fly-kf{
    0%{opacity:0;transform:translate(-50%,0) scale(.6);}
    18%{opacity:1;transform:translate(-50%,-14px) scale(1.15);}
    100%{opacity:0;transform:translate(calc(-50% + var(--dx,0px)),var(--dy,-220px)) scale(.9);}
  }
  .quest-toast{position:fixed;bottom:26px;left:50%;transform:translateX(-50%);z-index:78;
    background:var(--color-card2,#1f2937);border:2px solid var(--accent,#f59e0b);color:#f9fafb;
    padding:.7em 1.4em;border-radius:.9rem;font-weight:700;font-size:clamp(1rem,2vh,1.25rem);
    box-shadow:0 14px 40px rgba(0,0,0,.6);animation:quest-toast-in .22s ease both;max-width:90vw;text-align:center;}
  @keyframes quest-toast-in{from{opacity:0;transform:translate(-50%,14px);}to{opacity:1;transform:translate(-50%,0);}}

  @media (prefers-reduced-motion:reduce){
    .quest-hero,.quest-hero.quest-pop,.quest-modal,.quest-modal-bg,.quest-toast,.quest-fly{animation:none;}
  }

  /* ---- 1280x720 smartboards: masthead + hero were costing ~390px combined,
     leaving almost none of the 644px module area for the quest cards. Trim the
     chrome that's nice-to-have (masthead scale, hero padding/sizes, board/deeds
     chrome) so at least one full row of cards is visible without page scroll.
     Text stays >=14px (0.875rem) and every button stays >=48px (touch). The
     masthead sizes below only change what the CSS proposes — masthead.js still
     measures the (now smaller) title ink and fits the subtitle/pill to match,
     so nothing here fights the fitter. ---- */
  @media (max-height: 800px) {
    .quest-root{--rgap:clamp(5px,.9vh,9px);
      padding:clamp(5px,.9vh,9px) clamp(10px,1.6vw,20px) clamp(6px,1vh,10px);}

    /* masthead: smaller mark, tighter title (subtitle/pill scale to match) */
    .quest-head{gap:clamp(.35rem,.9vw,.6rem);}
    .quest-head-icon,.quest-head-spacer{width:clamp(1.4rem,3.2vw,1.9rem);}
    .quest-head-title{font-size:clamp(1rem,2.2vw,1.4rem);}

    /* Active-quest hero. Padding matches the CARDS exactly so the field reads
       as the same family, and the row gaps are the card's gaps — the panel was
       using its own tighter values, which is what made it look unrelated. The
       two teacher buttons stay at the 48px touch minimum. */
    .quest-hero{padding:clamp(16px,2.2vh,22px) clamp(16px,1.5vw,20px);gap:clamp(16px,1.5vw,20px);}
    .quest-hero-main{gap:clamp(7px,1vh,10px);}
    .quest-hero-eyebrow{font-size:.875rem;}
    .quest-hero-crest{height:1.15rem;}
    .quest-hero-icon{font-size:1.4rem;}
    .quest-hero-title{font-size:clamp(1.1rem,2.6vh,1.5rem);line-height:1.05;}
    .quest-hero-desc{font-size:.9rem;line-height:1.25;}
    .quest-chip{font-size:.875rem;}
    /* Just the two buttons now, so the column is only as wide as they need. */
    .quest-hero-side{flex:0 0 clamp(170px,16vw,210px);gap:clamp(7px,1vh,10px);justify-content:center;}
    .quest-act{min-height:40px;font-size:.95rem;padding:.3em .8em;}

    /* "No quest yet" is the NORMAL state every Monday, so at 720p it earns a
       slim line, not a 104px dashed panel. It grows back into the full hero
       card the moment a quest is actually accepted — which is when the space
       is worth spending. The ~64px this frees goes straight to the grid. */
    .quest-hero-empty{gap:clamp(6px,1vw,12px);flex-wrap:nowrap;border-width:2px;
      padding:clamp(6px,1vh,10px) clamp(12px,1.6vw,20px);}
    .quest-hero-empty-icon{font-size:clamp(1.1rem,2.4vh,1.5rem);}
    .quest-hero-empty-title{font-size:clamp(1rem,2.2vh,1.3rem);}
    .quest-hero-empty-sub{font-size:.875rem;margin-top:0;}

    /* board header + lockbar + cards: reclaim the rest for the grid */
    .quest-board{--bgap:clamp(4px,.7vh,8px);}
    .quest-board-title{font-size:1rem;}
    .quest-board-count{font-size:.875rem;}
    /* The board header's height is set by this control, so trimming it is what
       actually returns rows to the grid. Still a comfortable tap target. */
    .quest-sort{min-height:30px;font-size:.82rem;padding:.2em .7em;border-radius:999px;}
    .quest-lockbar{font-size:.9rem;padding:.35em .7em;}
    /* Deliberately LOOSER than before (was 7px/4px). The cards read as cramped;
       the room comes from the trimmed empty hero above, not from the grid. */
    /* Roughly the Magic Shop's interior (1.4rem/1.2rem). The text was sitting
       almost on the border, which is what made the cards look sloppy. */
    .quest-card{padding:clamp(16px,2.2vh,22px) clamp(16px,1.5vw,20px);gap:clamp(7px,1vh,10px);}
    .quest-card-title{font-size:1rem;}
    .quest-card-pts{font-size:1.25rem;}
    .quest-card-desc{font-size:.9rem;line-height:1.25;}

    /* Hall of Deeds: smaller chrome, still a full strip */
    .quest-deeds{padding:clamp(4px,.7vh,8px) clamp(8px,.8vw,12px);}
    .quest-deeds-title{font-size:.9rem;}
  }
  `;
  document.head.appendChild(s);
}

// =============================================================================
// small shared bits
// =============================================================================
function crest(house, cls) {
  return `<img src="${esc(house.image)}" alt="" class="${cls}" onerror="this.style.display='none'" />`;
}

// The single most important thing a student needs to understand about a quest
// besides what it's worth: can we do it again, or is it gone forever?
function repeatChip(q) {
  return q.repeatable
    ? '<span class="quest-chip quest-chip-repeat">♻️ Repeatable</span>'
    : '<span class="quest-chip quest-chip-once">★ One time only</span>';
}

// =============================================================================
// RENDER
// =============================================================================
function headerHtml(store, core) {
  const house = core === 'all' ? null : store.HOUSES[core];
  // The tagline is fixed rather than per-house: it is measured to size the
  // points pill, so it must not change width when the core is switched.
  return `
    <div class="quest-head">
      <img class="quest-head-icon" src="images/icon-quest.png" alt="" onerror="this.style.visibility='hidden'" />
      <div class="quest-headings">
        <div class="quest-head-title"><span class="mh-ink">THE CLASS QUEST BOARD</span></div>
        <div class="quest-head-sub"><span class="mh-ink">Take up a quest. Earn the glory. Serve the school.</span></div>
      </div>
      <span class="quest-head-spacer" aria-hidden="true"></span>
    </div>`;
  // The crests-and-pill row that used to sit here is gone. It cost 35px to
  // state something the top bar already says, and the number only MATTERS for
  // the couple of seconds after an award — so the total now lives in the Hall
  // of Deeds, which is where the completion animation already lands.
}

function heroHtml(store, core) {
  const house = store.HOUSES[core];
  const q = store.getActiveQuest(core);

  if (!q) {
    return `
      <section class="quest-hero-empty" style="--h:${screenAccent(store, house).color}">
        <div class="quest-hero-empty-icon">🧭</div>
        <div>
          <div class="quest-hero-empty-title">${esc(house.name)} has no quest yet</div>
          <div class="quest-hero-empty-sub">Pick one from the board below — it moves up here once accepted.</div>
        </div>
      </section>`;
  }

  const pop = ui.celebrateCore === core ? ' quest-pop' : '';
  return `
    <section class="quest-hero${pop}" style="--h:${screenAccent(store, house).color};--hs:${screenAccent(store, house).soft}">
      <div class="quest-hero-main">
        <div class="quest-hero-eyebrow">
          ${crest(house, 'quest-hero-crest')}
          <span>${esc(house.name)} · Quest in progress</span>
          <span class="quest-hero-timer">⏱ accepted ${esc(activeFor(q.startedTs))} ago</span>
        </div>
        <div class="quest-hero-head">
          <span class="quest-hero-icon">${store.questIcon(q)}</span>
          <h2 class="quest-hero-title">${esc(q.title)}</h2>
        </div>
        <p class="quest-hero-desc">${esc(q.desc || 'No description — ask Mr. D what this one takes.')}</p>
      </div>
      <div class="quest-hero-side">
        <button type="button" class="quest-act quest-act-done" data-q="complete" data-core="${core}">
          ✓ Complete +${q.points}
        </button>
        <button type="button" class="quest-act quest-act-fail" data-q="fail" data-core="${core}">
          ✗ Give Up −${penaltyOf(q)}
        </button>
      </div>
    </section>`;
}

// 'All Cores' — a scoreboard of who is working on what right now.
function allCoresHtml(store) {
  return `
    <div class="quest-all-grid">
      ${[1, 2, 3, 4].map((core) => {
        const h = store.HOUSES[core];
        const q = store.getActiveQuest(core);
        return `
          <div class="quest-all-card" style="--h:${h.accent}">
            <div class="quest-all-house">${crest(h, 'quest-all-crest')}${esc(h.name)}</div>
            ${q ? `
              <div class="quest-all-title">${esc(q.title)}</div>
              <div class="quest-all-foot">
                <span class="quest-all-pts">${q.points} pts</span>
                <span class="quest-all-time">${esc(shortWhen(q.startedTs))}</span>
              </div>`
            : '<div class="quest-all-none">No quest accepted</div>'}
          </div>`;
      }).join('')}
    </div>`;
}

function boardHtml(store, core) {
  const isAll = core === 'all';
  const house = isAll ? null : store.HOUSES[core];
  const active = isAll ? null : store.getActiveQuest(core);
  const locked = !!active;

  const quests = store.getAvailableQuests()
    .slice()
    .sort((a, b) => (ui.sortAsc ? a.points - b.points : b.points - a.points) || String(a.title).localeCompare(String(b.title)));

  let bar = '';
  if (isAll) {
    bar = `<div class="quest-lockbar quest-lockbar-info">👆 Pick a house core in the top bar to accept a quest.</div>`;
  } else if (locked) {
    bar = `<div class="quest-lockbar">🔒 ${esc(house.name)} must finish or give up “${esc(active.title)}” before taking another quest.</div>`;
  }

  const qt = (q) => ctxRef.store.questType(q);
  const sa = screenAccent(store, house);
  const cards = quests.length ? quests.map((q) => {
    const canAccept = !isAll && !locked;
    return `
      <div class="quest-card${canAccept ? '' : ' quest-card-locked'}" style="--h:${sa.color};--hs:${sa.soft}">
        <div class="quest-card-top">
          <span class="quest-type-icon" title="${esc(qt(q).label)} — ${esc(qt(q).blurb)}" aria-label="${esc(qt(q).label)}">${ctxRef.store.questIcon(q)}</span>
          <div class="quest-card-text">
            <div class="quest-card-title">${esc(q.title)}</div>
            <div class="quest-card-desc">${esc(q.desc || '')}</div>
          </div>
          <div class="quest-card-pts">${q.points}<small>pts</small></div>
        </div>
        <div class="quest-card-foot">
          <div class="quest-chip-row">${repeatChip(q)}</div>
          ${canAccept
            ? `<button type="button" class="quest-accept" data-q="accept" data-id="${esc(q.id)}">Accept Quest</button>`
            : `<div class="quest-card-note">${isAll ? 'Pick a core to accept' : '🔒 Finish your current quest first'}</div>`}
        </div>
      </div>`;
  }).join('') : `<div class="quest-empty">Every quest is taken or retired. Mr. D can add more in Admin → Quests.</div>`;

  // Teacher-chosen layout (Admin), not a per-visit toggle. The shared engine
  // (js/core/carousel.js) owns the strip/arrows/counter/focus; this file only
  // supplies the cards themselves, identically to the grid.
  const carousel = store.getLayout('quests') === 'carousel';
  const body = carousel
    ? carouselHtml(cards, { label: 'quests' })
    : `<div class="quest-grid">${cards}</div>`;

  return `
    <section class="quest-board">
      <div class="quest-board-head">
        <span class="quest-board-title">📜 Quests to Choose From</span>
        <span class="quest-board-count">${quests.length} available</span>
        <div class="quest-head-push"></div>
        <button type="button" class="quest-sort" data-q="sort">Points ${ui.sortAsc ? '▲ low first' : '▼ high first'}</button>
      </div>
      ${bar}
      ${body}
    </section>`;
}

function deedsHtml(store, core) {
  const items = store.getCompletedQuests({ limit: 10 });
  const house = core === 'all' ? null : store.HOUSES[core];
  // The running total lives here rather than in a band of its own: this strip
  // is where a completion already lands, so the number is beside the deed that
  // just moved it. [data-house-total] is the flight target for flyPoints().
  const total = house ? `
    <div class="quest-deeds-total" data-house-total style="--h:${house.accent};--hs:${house.accentSoft}"
         title="${esc(house.name)} — points this term">
      <img class="quest-deeds-crest" src="${esc(house.image)}" alt=""
        onerror="this.style.visibility='hidden'" />
      <span class="quest-deeds-val">${store.getTotal(house.id, 'term')}</span><span class="quest-deeds-unit">pts</span>
    </div>` : '';
  return `
    <div class="quest-deeds">
      <div class="quest-deeds-title">🏆 Hall of Deeds</div>
      ${total}
      ${items.length ? `
        <div class="quest-deeds-strip">
          ${items.map((c) => {
            const h = store.HOUSES[c.core];
            // The kind of task, looked up from the catalog by id. A quest the
            // teacher has since deleted no longer resolves, so questType()'s
            // fallback carries it rather than leaving a gap in the row.
            const src = store.getQuestCatalog().find((q) => q.id === c.questId);
            return `
              <div class="quest-deed" style="--h:${h ? h.accent : '#6b7280'}">
                <span class="quest-deed-icon">${store.questIcon(src)}</span>
                <div class="quest-deed-main">
                  <div class="quest-deed-title">${esc(c.title)}</div>
                  <div class="quest-deed-meta">${esc(h ? h.name : '')} · ${esc(shortWhen(c.ts))}</div>
                </div>
                <div class="quest-deed-pts">+${c.points}</div>
              </div>`;
          }).join('')}
        </div>`
      : '<div class="quest-deeds-none">No quests completed yet — the first one goes here.</div>'}
    </div>`;
}

// ---- confirm modals ---------------------------------------------------------
// Every scoring action gets one. On a touch smartboard a stray sleeve can hit a
// button, and an accidental award or penalty is exactly the kind of thing the
// teacher would have to come asking about.
function modalHtml(store) {
  const m = ui.modal;
  if (!m) return '';
  const house = store.HOUSES[m.core];
  if (!house) return '';

  let icon = '❓';
  let title = '';
  let body = '';
  let extra = '';
  let go = 'Confirm';
  let danger = false;
  let color = house.accent;
  let colorSoft = house.accentSoft;

  if (m.kind === 'accept') {
    const q = store.getQuestCatalog().find((x) => x.id === m.questId);
    if (!q) return '';
    icon = store.questType(q).icon;   // the quest's own kind reads better than a generic sword
    title = 'Accept this quest?';
    body = `<b>${esc(house.name)}</b> takes on <b>${esc(q.title)}</b> for <b>${q.points} points</b>.`;
    extra = `<div class="quest-modal-info">It leaves the board while you hold it. Giving up later costs
      <b>${penaltyOf(q)} points</b> and hands the quest back to the other houses.</div>`;
    go = 'Accept';
  } else if (m.kind === 'complete') {
    const q = store.getActiveQuest(m.core);
    if (!q) return '';
    icon = '🎉';
    title = 'Award the points?';
    body = `<b>${esc(house.name)}</b> completed <b>${esc(q.title)}</b>.`;
    extra = `<div class="quest-modal-info">This adds <b>+${q.points} points</b> to ${esc(house.name)} and files the
      quest in the Hall of Deeds. ${q.repeatable
        ? 'It is <b>repeatable</b>, so it returns to the board for any house.'
        : 'It is a <b>one-time</b> quest, so it leaves the board for good.'}</div>`;
    go = `✓ Complete — award +${q.points}`;
    color = '#22c55e';
    colorSoft = 'rgba(34,197,94,.35)';
  } else if (m.kind === 'fail') {
    const q = store.getActiveQuest(m.core);
    if (!q) return '';
    const penalty = penaltyOf(q);
    icon = '✗';
    title = 'Give up this quest?';
    body = `<b>${esc(house.name)}</b> is giving up on <b>${esc(q.title)}</b>.`;
    extra = `<div class="quest-modal-warn">⚠️ ${esc(house.name)} loses <b>${penalty} points</b>${penalty === 0 ? ' (no penalty set)' : ''},
      and the quest goes back on the board for another house to steal.</div>
      <div class="quest-modal-info">Accepted by mistake instead? Use “Clear without penalty” in
      Admin → Quests.</div>`;
    go = penalty > 0 ? `✗ Give up — deduct ${penalty}` : '✗ Give up';
    danger = true;
    color = '#ef4444';
    colorSoft = 'rgba(239,68,68,.35)';
  }

  return `
    <div class="quest-modal-bg" data-q="modal-bg">
      <div class="quest-modal" style="--m:${color};--ms:${colorSoft}">
        <div class="quest-modal-icon">${icon}</div>
        <div class="quest-modal-title">${title}</div>
        <div class="quest-modal-body">${body}</div>
        ${extra}
        <div class="quest-modal-acts">
          <button type="button" class="quest-modal-btn quest-modal-cancel" data-q="modal-cancel">Cancel</button>
          <button type="button" class="quest-modal-btn quest-modal-go${danger ? ' danger' : ''}" data-q="modal-ok">${go}</button>
        </div>
      </div>
    </div>`;
}

function render() {
  if (!rootEl || !ctxRef) return;
  const store = ctxRef.store;
  const core = store.getState().activeCore;
  // This whole screen re-renders on every store change AND on the 60s clock
  // tick that refreshes "2m ago". Rebuilding innerHTML resets the board's
  // scroll, so a teacher reading halfway down the quest list got yanked back
  // to the top roughly once a minute. Carry the position across the rebuild.
  const prevGrid = rootEl.querySelector('.quest-grid');
  const keepTop = prevGrid ? prevGrid.scrollTop : 0;
  const keepLeft = carouselScrollLeft(rootEl);
  // Tear down the previous wiring BEFORE the DOM it's attached to is replaced:
  // wireCarousel() binds its click listener to the ROOT we pass it (so arrow
  // clicks work no matter where in the strip they land), and that root is
  // rootEl itself, which survives this innerHTML replace. Without an explicit
  // teardown here the click listener would stack a new one on every render.
  if (carTeardown) { carTeardown(); carTeardown = null; }
  rootEl.innerHTML = `
    <div class="quest-root">
      ${headerHtml(store, core)}
      ${core === 'all' ? allCoresHtml(store) : heroHtml(store, core)}
      ${boardHtml(store, core)}
      ${deedsHtml(store, core)}
    </div>
    ${modalHtml(store)}`;
  fitMastheadWhenReady({
    icon: rootEl.querySelector('.quest-head-icon'),
    titleInk: rootEl.querySelector('.quest-head-title .mh-ink'),
    subInk: rootEl.querySelector('.quest-head-sub .mh-ink'),
    headings: rootEl.querySelector('.quest-headings'),
    // No pill any more — the masthead fitter tolerates a null here.
  });

  // Restore the grid's scroll position captured above, before paint so it
  // never flashes. The carousel's own position is restored by wireCarousel()
  // below via restoreLeft, using the same plain (non-smooth) assignment.
  const grid = rootEl.querySelector('.quest-grid');
  if (grid && keepTop) grid.scrollTop = keepTop;
  syncBoardWidth();
  // No-ops safely when this render is a grid (no [data-car-strip] to find).
  carTeardown = wireCarousel(rootEl, { restoreLeft: keepLeft });
}

// Publish the grid's real content width so the hero, lockbar, board header and
// Hall of Deeds can sit on exactly the same axis as the cards. Measured from
// the computed column tracks rather than assumed, because auto-fit changes the
// column count with the viewport.
function syncBoardWidth() {
  const root = rootEl && rootEl.querySelector('.quest-root');
  if (!root) return;
  const grid = rootEl.querySelector('.quest-grid');

  // Carousel mode has no grid to measure, but the header and the active-quest
  // field must still line up with where the CARDS would be — full-bleed there
  // made the panel look like it belonged to a different screen. The layout
  // always starts as the grid, so the remembered width is warm by the time the
  // carousel can be reached; it only goes stale on a resize mid-carousel,
  // which the next toggle corrects.
  if (!grid) {
    if (lastBoardW) root.style.setProperty('--board-w', `${lastBoardW}px`);
    else root.style.removeProperty('--board-w');
    return;
  }

  const cs = getComputedStyle(grid);
  const cols = cs.gridTemplateColumns.split(' ').map(parseFloat).filter((n) => !Number.isNaN(n));
  if (!cols.length) { root.style.removeProperty('--board-w'); return; }
  const gap = parseFloat(cs.columnGap) || 0;
  const w = cols.reduce((a, b) => a + b, 0) + gap * (cols.length - 1);
  lastBoardW = w;
  root.style.setProperty('--board-w', `${w}px`);
}

// =============================================================================
// feedback: toast + points flying to the house
// =============================================================================
function toast(text) {
  const host = document.getElementById('overlay-root') || document.body;
  const t = document.createElement('div');
  t.className = 'quest-toast';
  t.textContent = text;
  host.appendChild(t);
  fxNodes.add(t);
  later(() => { t.remove(); fxNodes.delete(t); }, 2400);
}

// Points visibly leave the quest and land ON the house total in the Hall of
// Deeds, which then kicks. The whole reason the total sits down there is this
// moment — the class should see the number that just moved.
function flyPoints(fromRect, points) {
  if (!fromRect) return;
  const host = document.getElementById('overlay-root') || document.body;
  const count = prefersReducedMotion() ? 1 : 5;
  const fromX = fromRect.left + fromRect.width / 2;
  const fromY = fromRect.top + fromRect.height / 2;

  // Aim at the live total; with no house total on screen ("All Cores"), fall
  // back to drifting upward as before rather than flying to 0,0.
  const target = rootEl && rootEl.querySelector('[data-house-total]');
  const t = target ? target.getBoundingClientRect() : null;
  const dx = t ? (t.left + t.width / 2) - fromX : 0;
  const dy = t ? (t.top + t.height / 2) - fromY : -(fromY) + 40;

  for (let i = 0; i < count; i += 1) {
    later(() => {
      const el = document.createElement('div');
      el.className = 'quest-fly';
      el.textContent = `+${points}`;
      el.style.left = `${fromX}px`;
      el.style.top = `${fromY}px`;
      // Spread only across the flight, so they still converge on the total.
      el.style.setProperty('--dx', `${dx + (Math.random() - 0.5) * 60}px`);
      el.style.setProperty('--dy', `${dy}px`);
      host.appendChild(el);
      fxNodes.add(el);
      later(() => { el.remove(); fxNodes.delete(el); }, 1300);
    }, i * 110);
  }

  // Kick the total as the first coins arrive (the flight runs 1.15s).
  if (target) {
    later(() => {
      const live = rootEl && rootEl.querySelector('[data-house-total]');
      if (!live) return;                        // re-rendered away mid-flight
      live.classList.add('is-hit');
      later(() => live.classList.remove('is-hit'), 420);
    }, 900);
  }
}

// =============================================================================
// actions
// =============================================================================
// Teacher-only kinds ('complete', 'fail') are gated behind the PIN pad —
// see lock.js. The confirm modal stays open (untouched) while the pad is up,
// so a cancel leaves everything exactly as it was: no state change, no
// optimistic render, no half-applied award/penalty. 'accept' is a student
// action at the board and is never gated.
async function confirmModal() {
  const store = ctxRef.store;
  const m = ui.modal;
  if (!m) return;

  if (m.kind === 'accept') {
    ui.modal = null;
    const ok = store.startQuest(m.core, m.questId);
    if (!ok) { render(); toast('That quest is no longer available.'); return; }
    ctxRef.audio?.sfx?.('sword');
    ui.celebrateCore = m.core;
    later(() => { ui.celebrateCore = null; render(); }, 700);
    render();   // startQuest already emitted, but re-render for the celebrate class
    return;
  }

  if (m.kind === 'complete') {
    const granted = await lock.requireUnlock('mark this quest complete');
    if (!ui) return;   // module was unmounted while the PIN pad was up
    if (!granted) { ui.modal = null; render(); return; }
    ui.modal = null;
    // The hero used to have a dedicated points readout (.quest-hero-points);
    // that markup is gone (points now live in the Complete button's own
    // label), but this selector was never updated, so it always matched
    // nothing and the fly-to-total animation silently never played. The
    // Complete button carries the same "+N" and is still in the DOM at this
    // point (store.completeQuest below hasn't re-rendered the hero away yet).
    const heroBtn = rootEl.querySelector(`.quest-act-done[data-core="${m.core}"]`);
    const rect = heroBtn ? heroBtn.getBoundingClientRect() : null;
    const house = store.HOUSES[m.core];
    const quest = store.completeQuest(m.core);   // emits → re-render via subscribe
    render();
    if (quest) {
      ctxRef.audio?.sfx?.('fanfare');
      flyPoints(rect, quest.points);
      toast(`🎉 +${quest.points} to ${house.name} — “${quest.title}” complete!`);
    }
    return;
  }

  if (m.kind === 'fail') {
    const granted = await lock.requireUnlock('fail this quest');
    if (!ui) return;   // module was unmounted while the PIN pad was up
    if (!granted) { ui.modal = null; render(); return; }
    ui.modal = null;
    const house = store.HOUSES[m.core];
    const res = store.failQuest(m.core);
    render();
    if (res) {
      ctxRef.audio?.sfx?.('thud');
      toast(res.penalty > 0
        ? `${house.name} gave up “${res.quest.title}” — ${res.penalty} points deducted. It's back on the board.`
        : `${house.name} gave up “${res.quest.title}”. It's back on the board.`);
    }
    return;
  }

  ui.modal = null;
  render();
}

function onClick(e) {
  const btn = e.target.closest('[data-q]');
  if (!btn) return;
  const store = ctxRef.store;
  const action = btn.dataset.q;

  switch (action) {
    case 'sort':
      ui.sortAsc = !ui.sortAsc;
      render();
      break;

    // Carousel prev/next/focus-tracking clicks are handled entirely inside
    // wireCarousel() (js/core/carousel.js), which binds its own listener to
    // rootEl — they never reach this switch.

    case 'accept': {
      const core = store.getState().activeCore;
      if (core === 'all') { toast('Pick a house core in the top bar first.'); return; }
      ui.modal = { kind: 'accept', core, questId: btn.dataset.id };
      render();
      break;
    }

    case 'complete':
      ui.modal = { kind: 'complete', core: Number(btn.dataset.core) };
      render();
      break;

    case 'fail':
      ui.modal = { kind: 'fail', core: Number(btn.dataset.core) };
      render();
      break;

    case 'modal-ok':
      confirmModal();
      break;

    case 'modal-cancel':
      ui.modal = null;
      render();
      break;

    case 'modal-bg':
      // Only a click on the backdrop itself dismisses — not one that bubbled
      // up from inside the card.
      if (e.target === btn) { ui.modal = null; render(); }
      break;

    default:
      break;
  }
}

// =============================================================================
// Module contract
// =============================================================================
export default {
  id: 'quests',
  title: 'Quests',
  icon: '🗺️',
  order: 25,
  showTile: true,

  mount(el, ctx) {
    ctxRef = ctx;
    rootEl = el;
    ui = initUi();
    injectStyles();
    injectCarouselStyles();
    render();

    clickHandler = onClick;
    rootEl.addEventListener('click', clickHandler);

    keyHandler = (ev) => {
      if (ev.key === 'Escape' && ui && ui.modal) { ui.modal = null; render(); }
    };
    document.addEventListener('keydown', keyHandler);

    // Keep the 🔒/🗝️ hero badge honest the moment the teacher unlocks (or the
    // session times out and re-locks) — not just on the next store event.
    lockHandler = () => render();
    window.addEventListener('lock:changed', lockHandler);

    // Keeps "accepted 12 min ago" honest without any other churn.
    tickTimer = setInterval(() => { if (!ui || !ui.modal) render(); }, 60000);

    unsub = ctx.store.subscribe(() => render());
  },

  unmount() {
    clearTimers();
    clearFx();
    if (tickTimer) { clearInterval(tickTimer); tickTimer = null; }
    if (unsub) { try { unsub(); } catch (e) {} unsub = null; }
    if (carTeardown) { carTeardown(); carTeardown = null; }
    if (rootEl && clickHandler) rootEl.removeEventListener('click', clickHandler);
    if (keyHandler) document.removeEventListener('keydown', keyHandler);
    if (lockHandler) window.removeEventListener('lock:changed', lockHandler);
    const st = document.getElementById(STYLE_ID);
    if (st) st.remove();
    rootEl = null; ctxRef = null; clickHandler = null; keyHandler = null; lockHandler = null; ui = null;
    lastBoardW = 0;
  },
};
