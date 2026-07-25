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

// per-mount UI state
let ui = null;   // { modal: null | {...}, sortAsc: bool, celebrateCore: number|null }

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
  .quest-root{height:100%;display:flex;flex-direction:column;gap:clamp(8px,1.4vh,18px);
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

  /* Shields flank a points-only pill; the pill spans the width of the heading
     text above it (set at render time from the heading block's measured width).
     Crests are contain-fit transparent PNGs — never boxed or cropped. */
  .quest-points-row{flex-shrink:0;display:flex;align-items:center;justify-content:center;
    gap:clamp(.6rem,1.6vw,1.4rem);margin:clamp(5px,1vh,12px) auto 0;}
  .quest-crest{height:min(clamp(2.8rem,8vw,5.4rem),9vh);width:auto;object-fit:contain;flex-shrink:0;
    filter:drop-shadow(0 6px 16px rgba(0,0,0,.6));}
  .quest-points{display:flex;align-items:baseline;justify-content:center;flex:0 0 auto;
    background:var(--color-card,#111827);border:2px solid var(--qp-accent,#f59e0b);
    border-radius:1.5rem;padding:clamp(.35rem,1.1vh,1rem) 1.5rem;
    box-shadow:0 0 26px var(--qp-glow,rgba(245,158,11,.35));}
  .quest-points .val{font-size:clamp(1.8rem,5vw,3rem);font-weight:800;color:#fde68a;
    font-variant-numeric:tabular-nums;line-height:1;}
  .quest-points .unit{font-size:clamp(.9rem,2.2vw,1.4rem);font-weight:700;color:#fde68a;
    margin-left:.4rem;opacity:.85;}

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
    gap:clamp(4px,.9vh,10px);}
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

  .quest-chip-row{display:flex;gap:clamp(6px,.8vw,12px);flex-wrap:wrap;margin-top:auto;padding-top:.4em;}
  .quest-chip{display:inline-flex;align-items:center;gap:.4em;border-radius:999px;
    font-size:clamp(1rem,1.7vh,1.15rem);font-weight:800;padding:.3em .85em;white-space:nowrap;}
  .quest-chip-repeat{background:rgba(34,197,94,.16);border:1px solid rgba(34,197,94,.55);color:#4ade80;}
  .quest-chip-once{background:rgba(168,85,247,.16);border:1px solid rgba(168,85,247,.55);color:#c4b5fd;}
  .quest-chip-penalty{background:rgba(239,68,68,.14);border:1px solid rgba(239,68,68,.45);color:#fca5a5;}

  .quest-hero-side{flex:0 0 clamp(230px,22vw,320px);display:flex;flex-direction:column;
    gap:clamp(6px,1vh,12px);justify-content:center;}
  .quest-hero-points{text-align:center;font-family:Cinzel,Georgia,serif;font-weight:800;line-height:.95;
    font-size:clamp(2.4rem,6.4vh,4.4rem);color:#fde68a;text-shadow:0 0 26px rgba(253,230,138,.45);}
  .quest-hero-points small{display:block;font-family:inherit;font-size:clamp(.95rem,1.6vh,1.1rem);
    letter-spacing:.16em;text-transform:uppercase;color:var(--color-text-soft,#9ca3af);margin-top:.15em;}
  .quest-teacher-bar{display:flex;align-items:center;justify-content:center;gap:.4em;
    font-size:clamp(.95rem,1.5vh,1.05rem);font-weight:800;letter-spacing:.1em;text-transform:uppercase;
    color:#fcd34d;}

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
  .quest-board{flex:1;min-height:0;display:flex;flex-direction:column;gap:clamp(6px,1vh,12px);}
  .quest-board-head{flex-shrink:0;display:flex;align-items:center;gap:clamp(8px,1.2vw,18px);flex-wrap:wrap;}
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

  .quest-grid{flex:1;min-height:0;overflow-y:auto;display:grid;gap:clamp(8px,1.2vw,16px);
    grid-template-columns:repeat(auto-fill,minmax(clamp(240px,20vw,330px),1fr));align-content:start;
    padding-right:4px;padding-bottom:4px;}
  .quest-card{display:flex;flex-direction:column;gap:clamp(4px,.7vh,10px);border-radius:1.1rem;
    border:2px solid var(--color-line,#374151);background:linear-gradient(160deg,rgba(31,41,55,.92),rgba(17,24,39,.96));
    padding:clamp(10px,1.5vh,18px) clamp(12px,1vw,18px);
    transition:transform .16s ease,border-color .16s ease,box-shadow .16s ease;}
  .quest-card:not(.quest-card-locked):hover{transform:translateY(-3px);border-color:var(--accent,#f59e0b);
    box-shadow:0 12px 30px rgba(0,0,0,.45);}
  .quest-card-locked{opacity:.5;filter:grayscale(.35);}
  .quest-card-top{display:flex;align-items:flex-start;justify-content:space-between;gap:.7em;}
  .quest-card-title{font-weight:800;color:#f9fafb;line-height:1.2;font-size:clamp(1.1rem,2.3vh,1.55rem);}
  .quest-card-pts{flex-shrink:0;text-align:center;font-weight:800;line-height:1;color:#fde68a;
    font-size:clamp(1.35rem,3vh,2.1rem);}
  .quest-card-pts small{display:block;font-size:clamp(.75rem,1.4vh,.95rem);letter-spacing:.12em;text-transform:uppercase;
    color:var(--color-text-soft,#9ca3af);font-weight:800;margin-top:.25em;}
  .quest-card-desc{color:#d1d5db;font-size:clamp(1rem,1.95vh,1.3rem);line-height:1.35;}
  .quest-card-foot{margin-top:auto;display:flex;flex-direction:column;gap:clamp(5px,.8vh,10px);padding-top:.4em;}
  .quest-accept{width:100%;min-height:clamp(48px,6vh,60px);border-radius:.9rem;border:none;cursor:pointer;
    font-weight:800;font-family:inherit;font-size:clamp(1rem,2vh,1.3rem);color:#0b0f19;
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
    .quest-root{gap:clamp(5px,.9vh,9px);
      padding:clamp(5px,.9vh,9px) clamp(10px,1.6vw,20px) clamp(6px,1vh,10px);}

    /* masthead: smaller mark, tighter title (subtitle/pill scale to match) */
    .quest-head{gap:clamp(.35rem,.9vw,.6rem);}
    .quest-head-icon,.quest-head-spacer{width:clamp(1.4rem,3.2vw,1.9rem);}
    .quest-head-title{font-size:clamp(1rem,2.2vw,1.4rem);}
    .quest-points-row{margin:clamp(3px,.6vh,6px) auto 0;gap:clamp(.4rem,1vw,.7rem);}
    .quest-crest{height:min(clamp(1.4rem,3.6vw,1.9rem),4.2vh);}
    .quest-points{padding:.2rem 1rem;}
    .quest-points .val{font-size:clamp(1.1rem,2.8vw,1.5rem);}
    .quest-points .unit{font-size:.75rem;}

    /* active-quest hero: tighter padding/gaps and smaller type; the two
       teacher buttons stay pinned at the 48px touch minimum */
    .quest-hero{padding:clamp(6px,1vh,10px) clamp(10px,1.4vw,16px);gap:clamp(8px,1.2vw,14px);}
    .quest-hero-main{gap:3px;}
    .quest-hero-eyebrow{font-size:.875rem;}
    .quest-hero-crest{height:1.15rem;}
    .quest-hero-title{font-size:clamp(1.1rem,2.6vh,1.5rem);line-height:1.05;}
    .quest-hero-desc{font-size:.9rem;line-height:1.25;}
    .quest-chip-row{padding-top:2px;}
    .quest-chip{font-size:.875rem;padding:.2em .6em;}
    .quest-hero-side{flex:0 0 180px;gap:4px;}
    .quest-hero-points{font-size:1.4rem;}
    .quest-hero-points small{font-size:.875rem;margin-top:0;}
    .quest-teacher-bar{font-size:.875rem;}
    .quest-act{min-height:48px;font-size:.9rem;}

    /* board header + lockbar + cards: reclaim the rest for the grid */
    .quest-board{gap:clamp(4px,.7vh,8px);}
    .quest-board-title{font-size:1rem;}
    .quest-board-count{font-size:.875rem;}
    .quest-sort{min-height:36px;font-size:.9rem;padding:.3em .8em;}
    .quest-lockbar{font-size:.9rem;padding:.35em .7em;}
    .quest-card{padding:clamp(7px,.9vh,11px) clamp(8px,.8vw,12px);gap:4px;}
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
// Match the points pill's width to the heading text above it (measured after
// paint, since the heading is fluid-typed). Presentation only — never throws.
function sizeQuestPill(root) {
  try {
    const headings = root.querySelector('.quest-headings');
    const pill = root.querySelector('.quest-points');
    if (!headings || !pill) return;
    const w = Math.round(headings.getBoundingClientRect().width);
    if (w > 0) pill.style.width = w + 'px';
  } catch (e) { /* ignore */ }
}

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
    </div>
    ${house ? `
      <div class="quest-points-row" style="--qp-accent:${house.accent}; --qp-glow:${house.accentSoft}">
        <img class="quest-crest" src="${esc(house.image)}" alt="${esc(house.name)} crest"
          onerror="this.style.visibility='hidden'" />
        <div class="quest-points" title="${esc(house.name)} points">
          <span class="val">${store.getTotal(house.id, 'term')}</span><span class="unit">pts</span>
        </div>
        <img class="quest-crest" src="${esc(house.image)}" alt="" aria-hidden="true"
          onerror="this.style.visibility='hidden'" />
      </div>` : ''}`;
}

function heroHtml(store, core) {
  const house = store.HOUSES[core];
  const q = store.getActiveQuest(core);

  if (!q) {
    return `
      <section class="quest-hero-empty" style="--h:${house.accent}">
        <div class="quest-hero-empty-icon">🧭</div>
        <div>
          <div class="quest-hero-empty-title">${esc(house.name)} has no quest yet</div>
          <div class="quest-hero-empty-sub">Pick one from the board below — it moves up here once accepted.</div>
        </div>
      </section>`;
  }

  const penalty = penaltyOf(q);
  const pop = ui.celebrateCore === core ? ' quest-pop' : '';
  const stillLocked = lock.isEnabled() && !lock.isUnlocked();
  return `
    <section class="quest-hero${pop}" style="--h:${house.accent};--hs:${house.accentSoft}">
      <div class="quest-hero-main">
        <div class="quest-hero-eyebrow">
          ${crest(house, 'quest-hero-crest')}
          <span>${esc(house.name)} · Quest in progress</span>
          <span class="quest-hero-timer">⏱ accepted ${esc(activeFor(q.startedTs))} ago</span>
        </div>
        <h2 class="quest-hero-title">${esc(q.title)}</h2>
        <p class="quest-hero-desc">${esc(q.desc || 'No description — ask Mr. D what this one takes.')}</p>
        <div class="quest-chip-row">
          ${repeatChip(q)}
          <span class="quest-chip quest-chip-penalty">✗ Giving up costs ${penalty} pts</span>
        </div>
      </div>
      <div class="quest-hero-side">
        <div class="quest-hero-points">${q.points}<small>points</small></div>
        <div class="quest-teacher-bar">${stillLocked ? '🔒' : '🗝️'} Teacher only</div>
        <button type="button" class="quest-act quest-act-done" data-q="complete" data-core="${core}">
          ✓ Mark Complete
        </button>
        <button type="button" class="quest-act quest-act-fail" data-q="fail" data-core="${core}">
          ✗ Give Up <small>−${penalty} pts</small>
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

  const cards = quests.length ? quests.map((q) => {
    const canAccept = !isAll && !locked;
    return `
      <div class="quest-card${canAccept ? '' : ' quest-card-locked'}" style="--h:${house ? house.accent : '#f59e0b'};--hs:${house ? house.accentSoft : 'rgba(245,158,11,.35)'}">
        <div class="quest-card-top">
          <div class="quest-card-title">${esc(q.title)}</div>
          <div class="quest-card-pts">${q.points}<small>pts</small></div>
        </div>
        <div class="quest-card-desc">${esc(q.desc || '')}</div>
        <div class="quest-card-foot">
          <div class="quest-chip-row">${repeatChip(q)}</div>
          ${canAccept
            ? `<button type="button" class="quest-accept" data-q="accept" data-id="${esc(q.id)}">⚔️ Accept Quest</button>`
            : `<div class="quest-card-note">${isAll ? 'Pick a core to accept' : '🔒 Finish your current quest first'}</div>`}
        </div>
      </div>`;
  }).join('') : `<div class="quest-empty">Every quest is taken or retired. Mr. D can add more in Admin → Quests.</div>`;

  return `
    <section class="quest-board">
      <div class="quest-board-head">
        <span class="quest-board-title">📜 Quests to Choose From</span>
        <span class="quest-board-count">${quests.length} available</span>
        <div class="quest-head-spacer"></div>
        <button type="button" class="quest-sort" data-q="sort">Points ${ui.sortAsc ? '▲ low first' : '▼ high first'}</button>
      </div>
      ${bar}
      <div class="quest-grid">${cards}</div>
    </section>`;
}

function deedsHtml(store) {
  const items = store.getCompletedQuests({ limit: 10 });
  return `
    <div class="quest-deeds">
      <div class="quest-deeds-title">🏆 Hall of Deeds</div>
      ${items.length ? `
        <div class="quest-deeds-strip">
          ${items.map((c) => {
            const h = store.HOUSES[c.core];
            return `
              <div class="quest-deed" style="--h:${h ? h.accent : '#6b7280'}">
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
    icon = '⚔️';
    title = 'Accept this quest?';
    body = `<b>${esc(house.name)}</b> takes on <b>${esc(q.title)}</b> for <b>${q.points} points</b>.`;
    extra = `<div class="quest-modal-info">It leaves the board while you hold it. Giving up later costs
      <b>${penaltyOf(q)} points</b> and hands the quest back to the other houses.</div>`;
    go = '⚔️ Accept';
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
  rootEl.innerHTML = `
    <div class="quest-root">
      ${headerHtml(store, core)}
      ${core === 'all' ? allCoresHtml(store) : heroHtml(store, core)}
      ${boardHtml(store, core)}
      ${deedsHtml(store)}
    </div>
    ${modalHtml(store)}`;
  fitMastheadWhenReady({
    icon: rootEl.querySelector('.quest-head-icon'),
    titleInk: rootEl.querySelector('.quest-head-title .mh-ink'),
    subInk: rootEl.querySelector('.quest-head-sub .mh-ink'),
    headings: rootEl.querySelector('.quest-headings'),
    pill: rootEl.querySelector('.quest-points'),
  });
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

// Points visibly leave the quest card and rise toward the top bar, where the
// house total lives — so the class sees where the reward went.
function flyPoints(fromRect, points) {
  if (!fromRect) return;
  const host = document.getElementById('overlay-root') || document.body;
  const count = prefersReducedMotion() ? 1 : 5;
  for (let i = 0; i < count; i += 1) {
    later(() => {
      const el = document.createElement('div');
      el.className = 'quest-fly';
      el.textContent = `+${points}`;
      el.style.left = `${fromRect.left + fromRect.width / 2}px`;
      el.style.top = `${fromRect.top + fromRect.height / 2}px`;
      el.style.setProperty('--dx', `${(Math.random() - 0.5) * 140}px`);
      el.style.setProperty('--dy', `${-(fromRect.top + fromRect.height / 2) + 40}px`);
      host.appendChild(el);
      fxNodes.add(el);
      later(() => { el.remove(); fxNodes.delete(el); }, 1300);
    }, i * 110);
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
    const heroPts = rootEl.querySelector('.quest-hero-points');
    const rect = heroPts ? heroPts.getBoundingClientRect() : null;
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
    if (rootEl && clickHandler) rootEl.removeEventListener('click', clickHandler);
    if (keyHandler) document.removeEventListener('keydown', keyHandler);
    if (lockHandler) window.removeEventListener('lock:changed', lockHandler);
    const st = document.getElementById(STYLE_ID);
    if (st) st.remove();
    rootEl = null; ctxRef = null; clickHandler = null; keyHandler = null; lockHandler = null; ui = null;
  },
};
