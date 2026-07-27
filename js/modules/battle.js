// battle.js — "Battle Day!" duel screen.
// Landing (armed ignition button) -> full-screen cinematic overlay (#overlay-root)
// -> DUEL: challenger house (crest + points + HP + its offensive magic items) on
// the left, chosen opponent (crest + points + HP + active defenses) on the
// right, and the strike resolving centre screen between the two shields.
// A house-vs-house strike resolves through resolveHpAttack (below), which
// mirrors store.applyAttack's shield/reduction/pierce order but spends HIT
// POINTS instead of house points — a house is beaten when its HP hits zero,
// the winner takes a prize in points (store.awardBattleWin), and the loser
// never loses points. Teacher scoring is the one path that still moves points
// directly, via store.applyAttack itself, unchanged.
// Owns ONLY this file. Follows ARCHITECTURE.md contract.
import { lock } from '../core/lock.js';

const STYLE_ID = 'battle-styles';

// Offensive item kinds a house can use from this screen.
const OFFENSIVE_KINDS = new Set(['attack', 'steal', 'pierce']);

// Sequence timings (ms). Every individual animation stays ≤900ms.
const TRAVEL_MS = 280;   // projectile flight
const IMPACT_MS = 620;   // flash / shake / damage-number lifetime
const COUNT_MS = 450;    // point-total roll
const OUTCOME_MS = 2600; // static outcome caption (text, 250ms pop-in)

// ---- module-scoped lifecycle state -----------------------------------------
let ctxRef = null;
let rootEl = null;            // mount target inside #module-root
let overlayEl = null;         // cinematic overlay inside #overlay-root
let unsub = null;             // store subscription
let view = 'landing';         // 'landing' | 'duel'
let targetId = null;          // chosen opponent (defender)
const CINEMATIC_MIN_MS = 2500;   // letters finish stamping ~1.5s; never cut before this
const CRY_TAIL_MS = 500;         // beat of silence after the war cry ends
const CINEMATIC_MAX_MS = 8000;   // backstop if the recording never fires 'ended'
let chooserOpen = false;      // "change attacker" picker showing
let resolving = false;        // suspends subscribe re-renders mid-strike
const timers = new Set();
const fxNodes = new Set();    // transient combat-effect DOM nodes, force-cleaned on unmount

function later(fn, ms) {
  const id = setTimeout(() => { timers.delete(id); try { fn(); } catch (e) { console.warn('battle:', e); } }, ms);
  timers.add(id);
  return id;
}
function clearTimers() { timers.forEach(clearTimeout); timers.clear(); }
function clearFx() { fxNodes.forEach((n) => { try { n.remove(); } catch (e) {} }); fxNodes.clear(); }

function prefersReducedMotion() {
  return !!(window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches);
}

// Spawns a transient fx node inside `parent`, auto-removed after `ttl`ms and
// force-removed on unmount via `fxNodes`.
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

// Same, but takes markup (multi-line outcome captions).
function spawnFxHtml(parent, className, ttl, html) {
  const el = spawnFx(parent, className, ttl);
  if (el) el.innerHTML = html;
  return el;
}

// Same, but never touches the parent's inline position — used for the
// shared #overlay-root (lead-owned) since its fx children are all
// position:fixed and don't need a positioned ancestor.
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

// Remaining-time formatter shared by shield/reduction badges.
function fmtRemain(ms) {
  if (ms <= 0) return null;
  const totalMins = Math.max(1, Math.round(ms / 60000));
  const hrs = Math.floor(totalMins / 60);
  const mins = totalMins % 60;
  return hrs > 0 ? `${hrs}h ${mins}m left` : `${mins}m left`;
}

function houseImg(house, cls) {
  return `<img src="${esc(house.image)}" alt="${esc(house.name)} crest" class="${cls}"
    onerror="this.onerror=null;this.style.display='none';" />`;
}

// The attacking house is whatever core the top bar is on — one obvious source
// of truth, and picking an attacker here moves the top bar with it.
function challengerHouse() {
  return ctxRef ? ctxRef.store.getActiveHouse() : null;
}

// =============================================================================
// STYLES
// =============================================================================
function injectStyles() {
  if (document.getElementById(STYLE_ID)) return;
  const style = document.createElement('style');
  style.id = STYLE_ID;
  style.textContent = `
  /* ---- landing ---- */
  .battle-landing{position:relative;height:100%;display:flex;flex-direction:column;
    align-items:center;justify-content:center;text-align:center;overflow:hidden;gap:1.5rem;
    background:radial-gradient(ellipse at 50% 30%,#2a0a0a 0%,#0b0f19 68%);}
  .battle-landing-eyebrow{color:#f87171;letter-spacing:.35em;text-transform:uppercase;
    font-size:clamp(.85rem,1.6vw,1.1rem);font-weight:700;}
  .battle-landing-title{font-size:clamp(1.5rem,3.2vw,2.25rem);color:#9ca3af;margin-bottom:.5rem;}
  .battle-ignite-btn{position:relative;background:linear-gradient(135deg,#7f1d1d,#b91c1c 45%,#ef4444);
    color:#fff;font-family:'Cinzel',Georgia,serif;font-weight:800;
    font-size:clamp(1.6rem,4.2vw,3rem);padding:clamp(24px,4vw,44px) clamp(40px,6vw,72px);
    border:3px solid #fca5a5;border-radius:1.5rem;min-height:48px;cursor:pointer;
    letter-spacing:.04em;box-shadow:0 0 0 0 rgba(239,68,68,.55),0 20px 60px rgba(0,0,0,.6);
    animation:battle-pulse-glow 2s ease-in-out infinite;transition:transform .15s ease;}
  .battle-ignite-btn:hover{transform:scale(1.04);}
  .battle-ignite-btn:active{transform:scale(.96);}
  @keyframes battle-pulse-glow{
    0%,100%{box-shadow:0 0 0 0 rgba(239,68,68,.55),0 20px 60px rgba(0,0,0,.6);}
    50%{box-shadow:0 0 50px 14px rgba(239,68,68,.65),0 20px 70px rgba(0,0,0,.7);}
  }
  .battle-landing-sub{color:#6b7280;font-size:clamp(.9rem,1.6vw,1.1rem);max-width:32rem;}

  /* ---- cinematic overlay (kept verbatim — the entry everyone loves) ---- */
  /* The gradient's CENTRE used to be 35% opaque, so the landing page — its
     button, its heading, its hint — showed straight through the middle of the
     cinematic. An opaque layer sits under the gradient now, and the whole
     curtain fades up fast so the room reads it as a hard cut to black. */
  .battle-cinematic{position:fixed;inset:0;z-index:60;overflow:hidden;
    background:radial-gradient(ellipse at 50% 50%,rgba(127,29,29,.55),rgba(0,0,0,.97) 72%),#07090f;
    display:flex;align-items:center;justify-content:center;
    animation:battle-curtain .22s ease-out both;}
  @keyframes battle-curtain{from{opacity:0;}to{opacity:1;}}
  .battle-vignette{position:absolute;inset:0;pointer-events:none;
    box-shadow:inset 0 0 0 0 rgba(239,68,68,0);animation:battle-vignette-pulse 2.5s ease-in-out;}
  @keyframes battle-vignette-pulse{
    0%{box-shadow:inset 0 0 0 0 rgba(239,68,68,0);}
    30%{box-shadow:inset 0 0 140px 40px rgba(239,68,68,.55);}
    60%{box-shadow:inset 0 0 90px 20px rgba(239,68,68,.35);}
    100%{box-shadow:inset 0 0 60px 10px rgba(239,68,68,.25);}
  }
  /* Title reads FIRST, swords slam in beneath it. */
  /* NB: this wrapper is 0x0 — the sword glyphs are absolutely positioned inside
     it, so this % places their CENTRE. At 720p each glyph is ~226px tall, so
     it reaches ~113px either side of this line. Keep it clear of the title.
     Pulled up from 72% to 66% — measured gap between the title's rendered
     bottom edge and the glyphs' rendered top edge went from ~109px to ~54px
     at a 928px-tall viewport, closing the gap by about half while still
     leaving clear daylight between the two (no overlap). */
  .battle-swords-wrap{position:absolute;top:66%;left:50%;transform:translate(-50%,-50%);
    display:flex;align-items:center;justify-content:center;pointer-events:none;}
  .battle-sword{font-size:clamp(5rem,12vw,10rem);position:absolute;
    filter:drop-shadow(0 0 24px rgba(255,180,120,.6));}
  .battle-sword-a{animation:battle-slam-a .7s cubic-bezier(.2,.9,.3,1.4) both;}
  .battle-sword-b{animation:battle-slam-b .7s cubic-bezier(.2,.9,.3,1.4) both;}
  @keyframes battle-slam-a{
    0%{transform:translate(-220px,-40px) rotate(-120deg) scale(.4);opacity:0;}
    70%{transform:translate(6px,0) rotate(-52deg) scale(1.15);opacity:1;}
    100%{transform:translate(0,0) rotate(-45deg) scale(1);opacity:1;}
  }
  @keyframes battle-slam-b{
    0%{transform:translate(220px,-40px) rotate(120deg) scale(.4);opacity:0;}
    70%{transform:translate(-6px,0) rotate(52deg) scale(1.15);opacity:1;}
    100%{transform:translate(0,0) rotate(45deg) scale(1);opacity:1;}
  }
  .battle-flash{position:absolute;inset:0;background:#fff;opacity:0;pointer-events:none;
    animation:battle-flash-pop .35s ease .55s both;}
  @keyframes battle-flash-pop{0%{opacity:0;}30%{opacity:.85;}100%{opacity:0;}}
  .battle-stamp{position:absolute;top:40%;left:50%;transform:translate(-50%,-50%);
    display:flex;gap:clamp(4px,.8vw,10px);font-family:'Cinzel',Georgia,serif;
    font-weight:800;font-size:clamp(2rem,6vw,4.5rem);color:#fca5a5;
    text-shadow:0 0 30px rgba(239,68,68,.8),0 4px 10px rgba(0,0,0,.8);}
  .battle-stamp span{display:inline-block;opacity:0;animation:battle-letter-stamp .35s ease both;}
  @keyframes battle-letter-stamp{
    0%{opacity:0;transform:scale(3) rotate(-8deg);}
    60%{opacity:1;transform:scale(.9) rotate(2deg);}
    100%{opacity:1;transform:scale(1) rotate(0);}
  }

  /* screen shake applied to #module-root during the cinematic slam */
  .battle-shake{animation:battle-shake-kf .5s cubic-bezier(.36,.07,.19,.97) both;}
  @keyframes battle-shake-kf{
    0%,100%{transform:translate(0,0);}
    10%{transform:translate(-10px,-4px);}
    20%{transform:translate(9px,3px);}
    30%{transform:translate(-8px,4px);}
    40%{transform:translate(7px,-3px);}
    50%{transform:translate(-6px,2px);}
    60%{transform:translate(5px,-2px);}
    70%{transform:translate(-4px,2px);}
    80%{transform:translate(3px,-1px);}
    90%{transform:translate(-2px,1px);}
  }

  /* ---- duel screen ---- */
  /* Fills the viewport: only the item list scrolls, so the strike buttons are
     never below the fold on a smartboard. Narrow screens fall back to a plain
     scrolling column (see the media query at the end of this block). */
  .duel-root{position:relative;height:100%;display:flex;flex-direction:column;
    overflow:hidden;padding:.85rem clamp(.75rem,2.2vw,1.75rem) 1rem;
    background:radial-gradient(ellipse at 50% -10%,rgba(153,27,27,.4),#0b0f19 55%),
      radial-gradient(ellipse at 100% 100%,rgba(127,29,29,.25),transparent 60%),#0b0f19;}
  .battle-embers{position:absolute;inset:0;pointer-events:none;overflow:hidden;z-index:0;}
  .battle-ember{position:absolute;bottom:-10px;border-radius:50%;
    background:radial-gradient(circle,#fca5a5,#ef4444 60%,transparent 75%);
    animation:battle-ember-rise linear infinite;opacity:.85;}
  @keyframes battle-ember-rise{
    0%{transform:translateY(0) translateX(0);opacity:0;}
    10%{opacity:.9;}
    100%{transform:translateY(-620px) translateX(var(--ember-drift,20px));opacity:0;}
  }

  /* width:100% is the point: this was shrink-to-fit and centred, so it floated
     ~89px inward from the cards it belongs to. Spanning the same 1560px as
     .duel-stage puts the title on the ATTACKER card's left edge and the
     buttons on the DEFENDER card's right edge, with room for one clean line. */
  .duel-topbar{position:relative;z-index:2;flex:0 0 auto;display:flex;align-items:center;
    justify-content:space-between;gap:1rem;flex-wrap:wrap;
    width:100%;max-width:1560px;margin:0 auto .85rem;}
  .duel-topbar-inner{display:contents;}
  .duel-title{font-family:'Cinzel',Georgia,serif;font-weight:800;
    font-size:clamp(1.2rem,2.6vw,1.9rem);color:#fca5a5;letter-spacing:.05em;
    text-shadow:0 0 26px rgba(239,68,68,.55);line-height:1.1;}
  .duel-sub{color:#f87171;letter-spacing:.2em;text-transform:uppercase;
    font-size:clamp(.65rem,1.1vw,.8rem);font-weight:700;}
  .duel-topbar-actions{display:flex;gap:.6rem;flex-wrap:wrap;}
  /* Height tracks the title's cap-height so the row reads as one line of text
     rather than two chunky slabs; min-width matches the pair to each other so
     "Magic Shop" and "End Battle" are the same size whatever their labels. */
  .battle-shop-btn,.battle-end-btn{min-height:clamp(30px,3.6vh,36px);min-width:clamp(120px,11vw,150px);
    display:inline-flex;align-items:center;justify-content:center;gap:.45em;
    padding:0 .9rem;border-radius:.7rem;
    font-weight:800;font-size:1rem;cursor:pointer;border:2px solid transparent;
    transition:transform .15s ease,filter .15s ease;touch-action:manipulation;}
  .battle-shop-btn:active,.battle-end-btn:active{transform:scale(.96);}
  .battle-btn-mark{height:1.25em;width:auto;object-fit:contain;flex-shrink:0;}
  .battle-shop-btn{background:linear-gradient(135deg,#a855f7,#7e22ce);color:#faf5ff;
    box-shadow:0 8px 26px rgba(168,85,247,.4);}
  .battle-end-btn{background:transparent;border-color:#4b5563;color:#e5e7eb;}
  .battle-end-btn:hover{border-color:#ef4444;color:#fca5a5;}

  /* three columns: challenger | arena | defender */
  .duel-stage{position:relative;z-index:1;display:grid;
    grid-template-columns:minmax(0,1fr) minmax(190px,clamp(190px,19vw,300px)) minmax(0,1fr);
    gap:clamp(.6rem,1.4vw,1.25rem);max-width:1560px;width:100%;margin:0 auto;align-items:stretch;
    flex:1 1 auto;min-height:0;}

  /* No scrollbar on the card itself — only .duel-items (the attack list) is
     ever allowed to scroll, and only if it genuinely can't all fit. The card
     is sized (see .duel-crest and .duel-items below) so everything ELSE
     always fits without needing to scroll or clip. */
  .duel-side{position:relative;height:100%;min-height:0;overflow:visible;
    border-radius:1.25rem;border:2px solid var(--side-accent,#374151);
    background:linear-gradient(160deg,rgba(17,24,39,.94),rgba(11,15,25,.97));
    padding:clamp(.5rem,1vw,.9rem);display:flex;flex-direction:column;align-items:center;
    gap:.3rem;box-shadow:0 10px 34px rgba(0,0,0,.5),0 0 30px -12px var(--side-accent,#374151);}
  .duel-role{flex:0 0 auto;font-size:.68rem;font-weight:800;letter-spacing:.22em;text-transform:uppercase;
    color:var(--side-accent,#9ca3af);opacity:.9;}
  /* The head is TWO columns — numbers beside the crest, not stacked under it —
     and the defender's are mirrored so the two shields face each other across
     the VS. Mirroring is why this is symmetrical by construction rather than by
     luck: both cards render the same DOM in the same order, and only the
     direction flips, so a row can never sit at a different height on one side
     than the other. The columns are flex:1 1 0 (equal halves, not content-
     sized) so the crest stays centred in its half whatever the house is called
     and however many digits its score has. */
  .duel-head{flex:0 0 auto;width:100%;display:flex;align-items:center;
    justify-content:center;gap:clamp(.3rem,1vw,.9rem);}
  .duel-side-defender .duel-head{flex-direction:row-reverse;}
  .duel-stats{flex:1 1 0;min-width:0;display:flex;flex-direction:column;
    align-items:center;justify-content:center;gap:.1rem;}
  .duel-identity{flex:1 1 0;min-width:0;display:flex;flex-direction:column;
    align-items:center;justify-content:center;gap:.2rem;}
  .duel-points-lbl{flex:0 0 auto;font-size:clamp(.72rem,1.1vw,.95rem);font-weight:700;letter-spacing:.16em;text-transform:uppercase;
    color:#9ca3af;text-align:center;}
  .duel-points-val{flex:0 0 auto;font-family:'Cinzel',Georgia,serif;font-weight:800;color:#fde68a;
    font-variant-numeric:tabular-nums;line-height:1;
    font-size:clamp(2.4rem,4.6vw,4.2rem);text-shadow:0 0 26px rgba(253,230,138,.35);}
  /* Hit points sit BELOW points on the same card, same visual treatment, but
     tinted to the house's own accent colour rather than the shared gold — HP
     is what a strike removes, so it reads as "this house's own meter". */
  .duel-hp-lbl{flex:0 0 auto;font-size:clamp(.72rem,1.1vw,.95rem);font-weight:700;letter-spacing:.16em;text-transform:uppercase;
    color:#9ca3af;text-align:center;margin-top:.1rem;}
  /* Wrapper exists so the bar below can be exactly as wide as the number
     above it: the wrapper has no width of its own, so it shrinks to the
     widest child with real content — the "140 / 140" text — and the bar's
     width:100% then resolves against THAT, not an arbitrary fixed value.
     This is what keeps the two edges lined up as the numbers change. */
  .duel-hp-wrap{flex:0 0 auto;display:flex;flex-direction:column;align-items:stretch;}
  .duel-hp-val{flex:0 0 auto;font-family:'Cinzel',Georgia,serif;font-weight:800;
    font-variant-numeric:tabular-nums;line-height:1;text-align:center;white-space:nowrap;
    font-size:clamp(2rem,3.8vw,3.4rem);text-shadow:0 0 18px currentColor;}
  .duel-hp-bar{flex:0 0 auto;width:100%;height:7px;border-radius:999px;
    background:rgba(255,255,255,.08);border:1px solid rgba(255,255,255,.16);overflow:hidden;margin:.25rem 0 .1rem;}
  .duel-hp-fill{height:100%;border-radius:999px;transition:width .45s ease;}
  /* NEVER shrinks. This used to be flex:0 1 auto so the crest would give way
     first and keep the strike list above the fold. That is fine on one card and
     wrong across two: each card shrinks its OWN crest by its OWN content, and
     the attacker carries a strike list the defender doesn't. The result was an
     attacker crest of 73px against a defender crest of 92px, and because every
     row sits below the crest in the same column, points, HP and the bar were
     all 18.6px out of line between the cards. Measured, not guessed.
     A fixed height makes both crests identical, so every row lines up across
     the two cards by construction. The give is now in .duel-items, which is
     the one element allowed its own scrollbar. */
  /* 11vh was too timid. It came from the same edit that stopped the crest
     shrinking, where the priority was keeping the strike list above the fold —
     but it left the shields small on the one screen that is meant to feel like
     an event, and smaller than they had been before. 15vh puts them back at
     roughly their original size on a 720p window and lets them grow properly on
     a 1080p board (79px -> 108px, and 119px -> 162px). The strike list is the
     element allowed to scroll, so it is the one that gives. */
  .duel-crest{position:relative;flex:0 0 auto;height:clamp(115px,22vh,320px);
    aspect-ratio:1;display:flex;align-items:center;justify-content:center;}
  .duel-crest img{max-width:100%;max-height:100%;height:100%;width:auto;object-fit:contain;
    filter:drop-shadow(0 8px 22px rgba(0,0,0,.65));}
  .duel-name{flex:0 0 auto;font-family:'Cinzel',Georgia,serif;font-weight:800;text-align:center;line-height:1.1;
    font-size:clamp(1.45rem,2.7vw,2.3rem);color:var(--side-accent,#f9fafb);}
  .duel-section-lbl{flex:0 0 auto;width:100%;text-align:center;font-size:.7rem;font-weight:800;letter-spacing:.16em;
    text-transform:uppercase;color:#9ca3af;border-top:1px solid #374151;padding-top:.5rem;margin-top:.15rem;}
  .duel-swap-btn{flex:0 0 auto;min-height:36px;padding:0 .8rem;border-radius:.7rem;background:transparent;
    border:1px solid #4b5563;color:#9ca3af;font-weight:700;font-size:.75rem;cursor:pointer;
    touch-action:manipulation;}
  .duel-swap-btn:hover{border-color:var(--side-accent,#9ca3af);color:#e5e7eb;}

  /* offensive item list */
  /* "safe center" is doing real work here. A house often holds one or two
     weapons, and start-aligned they sat at the top of a tall card with a lot of
     nothing under them — the container was full, which is why a height check
     said the card was fine while it plainly was not. Centring matches the
     defender's panel opposite. The "safe" keyword is the important half: when
     the list DOES overflow, centring alone would push the first row above the
     scroll area where it can never be reached, so it falls back to start. */
  .duel-items{width:100%;flex:1 1 auto;min-height:64px;display:grid;align-content:safe center;
    grid-template-columns:repeat(auto-fill,minmax(190px,1fr));gap:.4rem;
    overflow-y:auto;padding-right:.15rem;}
  .duel-item-cell{display:flex;flex-direction:column;min-width:0;}
  .duel-item{width:100%;min-height:52px;display:flex;align-items:center;gap:.5rem;text-align:left;
    border-radius:.85rem;border:2px solid #4b5563;background:#111827;color:#f9fafb;
    padding:.4rem .55rem;cursor:pointer;touch-action:manipulation;
    transition:transform .12s ease,border-color .15s ease,filter .15s ease;}
  .duel-item:hover:not(:disabled){border-color:#ef4444;filter:brightness(1.12);}
  .duel-item:active:not(:disabled){transform:scale(.97);}
  .duel-item:disabled{opacity:.45;cursor:not-allowed;filter:grayscale(.4);}
  .duel-item-emoji{font-size:1.6rem;line-height:1;flex-shrink:0;width:2rem;text-align:center;}
  .duel-item-body{flex:1;min-width:0;display:flex;flex-direction:column;gap:.1rem;}
  .duel-item-name{font-weight:800;font-size:.9rem;line-height:1.15;overflow:hidden;
    display:-webkit-box;-webkit-line-clamp:2;-webkit-box-orient:vertical;}
  .duel-item-meta{display:flex;gap:.4rem;align-items:center;flex-wrap:wrap;}
  .duel-item-dmg{font-size:.78rem;font-weight:800;color:#fca5a5;}
  .duel-item-kind{font-size:.65rem;font-weight:700;letter-spacing:.04em;color:#c4b5fd;
    background:rgba(167,139,250,.14);border:1px solid rgba(167,139,250,.35);
    border-radius:999px;padding:.05rem .4rem;white-space:nowrap;}
  .duel-item-cost,.duel-item-count{flex-shrink:0;font-weight:800;font-size:.8rem;color:#1e1b3a;background:#fde68a;
    border-radius:999px;padding:.2rem .5rem;white-space:nowrap;}
  /* A hair of breathing room above this line — it used to sit on a negative
     top margin that crowded the pill's bottom border above it. */
  .duel-item-reason{font-size:.7rem;font-weight:700;color:#9ca3af;margin:.3rem 0 .15rem .1rem;}
  .duel-item-note{font-size:.7rem;font-weight:700;margin:.3rem 0 .15rem .1rem;}
  .duel-note-block{color:#93c5fd;}
  .duel-note-half{color:#fde68a;}
  .duel-note-pierce{color:#c4b5fd;}
  .duel-empty{width:100%;text-align:center;color:#9ca3af;font-style:italic;font-size:.85rem;
    padding:1rem .5rem;border:1px dashed #4b5563;border-radius:.85rem;}

  /* defender: active defenses */
  /* Takes the leftover height instead of leaving it as bare card. The two cards
     stretch to equal height — that is what keeps every row aligned across them —
     but the defender has no strike list to fill with, so on a 1080p board it was
     62% empty: 480px of nothing under the content. Measured, both resolutions.
     Filling it HERE rather than by centring the whole column is deliberate: the
     head block must stay at the same offset on both cards or the crest, points
     and HP stop lining up, which was the whole point of the mirrored layout. */
  .duel-def{flex:1 1 auto;width:100%;display:flex;flex-direction:column;
    justify-content:center;gap:.4rem;min-height:0;}
  .duel-def-row{display:flex;align-items:center;gap:.5rem;border-radius:.8rem;
    padding:.55rem .7rem;font-weight:700;font-size:.88rem;line-height:1.25;}
  .duel-def-row b{font-weight:800;}
  .duel-def-shield{background:rgba(59,130,246,.16);border:1px solid rgba(96,165,250,.6);color:#bfdbfe;}
  .duel-def-reduce{background:rgba(180,83,9,.2);border:1px solid rgba(251,191,36,.6);color:#fde68a;
    transition:transform .2s ease;}
  .duel-empty-broke{border:1px dashed rgba(251,191,36,.45);color:#fde68a;
    background:rgba(180,83,9,.15);border-radius:.8rem;padding:.55rem .7rem;}
  /* what the attacker stands to win once a defender is chosen — visible
     before anyone strikes, so the class can see the stakes. */
  .duel-prize{flex:0 0 auto;width:100%;text-align:center;font-size:.78rem;font-weight:700;color:#fde68a;
    background:rgba(180,131,6,.14);border:1px dashed rgba(253,230,138,.45);border-radius:.7rem;
    padding:.4rem .55rem;margin-top:.2rem;line-height:1.3;}
  .duel-items-more{grid-column:1/-1;text-align:center;color:var(--color-text-soft,#9ca3af);
    font-size:.8rem;padding:.35rem 0 .1rem;}
  .duel-def-none{background:rgba(127,29,29,.18);border:1px dashed rgba(239,68,68,.5);color:#fca5a5;
    justify-content:center;}
  .duel-reduce-flare{animation:duel-reduce-flare-kf .7s ease;}
  @keyframes duel-reduce-flare-kf{
    0%{transform:scale(1);box-shadow:0 0 0 0 rgba(251,191,36,0);}
    30%{transform:scale(1.08);box-shadow:0 0 20px 5px rgba(251,191,36,.7);}
    100%{transform:scale(1);box-shadow:0 0 0 0 rgba(251,191,36,0);}
  }

  /* opponent picker (right column before a target is chosen) */
  .duel-pick-prompt{font-family:'Cinzel',Georgia,serif;font-weight:800;color:#fca5a5;
    font-size:clamp(1rem,1.8vw,1.3rem);text-align:center;line-height:1.2;}
  .duel-pick-hint{font-size:.78rem;color:#9ca3af;text-align:center;margin-top:-.2rem;}
  .duel-pick{width:100%;display:flex;flex-direction:column;gap:.55rem;margin-top:.3rem;}
  .duel-pick-btn{display:flex;align-items:center;gap:.75rem;min-height:78px;width:100%;
    border-radius:1rem;border:2px solid var(--pick-accent,#374151);background:#111827;
    padding:.55rem .8rem;cursor:pointer;text-align:left;touch-action:manipulation;
    transition:transform .12s ease,box-shadow .15s ease,filter .15s ease;}
  .duel-pick-btn:hover{filter:brightness(1.14);box-shadow:0 0 0 3px var(--pick-soft,rgba(55,65,81,.5));}
  .duel-pick-btn:active{transform:scale(.97);}
  .duel-pick-crest{width:54px;height:54px;object-fit:contain;flex-shrink:0;}
  .duel-pick-info{flex:1;min-width:0;}
  .duel-pick-name{font-weight:800;font-size:1.05rem;color:var(--pick-accent,#f9fafb);
    overflow:hidden;text-overflow:ellipsis;white-space:nowrap;}
  .duel-pick-def{font-size:.72rem;font-weight:700;color:#93c5fd;}
  .duel-pick-def-none{color:#6b7280;}
  .duel-pick-pts{flex-shrink:0;text-align:right;}
  .duel-pick-pts .v{font-weight:800;font-size:1.3rem;color:#fde68a;font-variant-numeric:tabular-nums;}
  .duel-pick-pts .l{font-size:.6rem;letter-spacing:.1em;text-transform:uppercase;color:#9ca3af;}
  /* punching-down lock — the house is still shown (never silently hidden),
     just visibly unavailable, with the reason spelled out. */
  .duel-pick-btn-locked{opacity:.5;cursor:not-allowed;filter:grayscale(.55);}
  .duel-pick-btn-locked:hover{filter:grayscale(.55);box-shadow:none;}
  .duel-pick-locked-reason{display:block;font-size:.68rem;font-weight:700;color:#f87171;margin-top:.15rem;line-height:1.25;}

  /* centre arena — where the strike resolves */
  .duel-arena{position:relative;height:100%;min-height:clamp(150px,22vh,260px);display:flex;
    flex-direction:column;align-items:center;justify-content:center;gap:.5rem;text-align:center;
    padding:.5rem;}
  .duel-vs{font-family:'Cinzel',Georgia,serif;font-weight:800;color:#7f1d1d;
    font-size:clamp(2.4rem,5.5vw,4rem);line-height:1;
    text-shadow:0 0 30px rgba(239,68,68,.45);}
  .duel-arena-hint{color:#9ca3af;font-size:.82rem;max-width:15rem;line-height:1.35;}

  /* projectile: fixed-position so it flies between the two crests wherever they sit */
  .duel-proj{position:fixed;z-index:70;pointer-events:none;font-size:2.1rem;line-height:1;
    width:44px;height:44px;margin:-22px 0 0 -22px;display:flex;align-items:center;justify-content:center;
    filter:drop-shadow(0 0 12px rgba(253,224,71,.8));
    animation:duel-proj-kf var(--travel,280ms) cubic-bezier(.35,0,.75,1) both;}
  @keyframes duel-proj-kf{
    0%{opacity:0;transform:translate(0,0) scale(.5) rotate(-20deg);}
    18%{opacity:1;transform:translate(calc(var(--dx)*.18),calc(var(--dy)*.18)) scale(1) rotate(0deg);}
    100%{opacity:1;transform:translate(var(--dx),var(--dy)) scale(1.15) rotate(18deg);}
  }
  .duel-proj-ghost{opacity:.6;filter:drop-shadow(0 0 14px rgba(196,181,253,.9)) blur(.4px);}
  .duel-proj-stopped{animation:duel-proj-stop-kf .22s ease both;}
  @keyframes duel-proj-stop-kf{
    0%{opacity:1;transform:translate(var(--dx),var(--dy)) scale(1.15);}
    100%{opacity:0;transform:translate(calc(var(--dx) - 26px),calc(var(--dy) - 14px)) scale(.6) rotate(-40deg);}
  }

  /* impact fx on a crest */
  .duel-fx-flash{position:absolute;inset:-8%;border-radius:50%;opacity:0;pointer-events:none;z-index:6;
    animation:duel-fx-flash-kf .5s ease both;}
  .duel-fx-flash-red{background:radial-gradient(circle,rgba(255,255,255,.9),rgba(239,68,68,.65) 55%,transparent 75%);}
  .duel-fx-flash-blue{background:radial-gradient(circle,rgba(255,255,255,.95),rgba(96,165,250,.6) 55%,transparent 75%);}
  .duel-fx-flash-amber{background:radial-gradient(circle,rgba(255,255,255,.85),rgba(217,119,6,.6) 55%,transparent 75%);}
  @keyframes duel-fx-flash-kf{0%{opacity:0;}15%{opacity:1;}100%{opacity:0;}}

  .duel-crest-shake{animation:duel-crest-shake-kf .45s cubic-bezier(.36,.07,.19,.97) both;}
  @keyframes duel-crest-shake-kf{
    0%,100%{transform:translate(0,0) rotate(0);}
    15%{transform:translate(-9px,-3px) rotate(-3deg);}
    30%{transform:translate(8px,3px) rotate(3deg);}
    45%{transform:translate(-7px,3px) rotate(-2deg);}
    60%{transform:translate(6px,-2px) rotate(2deg);}
    80%{transform:translate(-3px,1px) rotate(-1deg);}
  }

  .duel-fx-dmg{position:absolute;top:2%;left:50%;font-family:'Cinzel',Georgia,serif;font-weight:800;
    font-size:clamp(1.9rem,3.4vw,3rem);color:#f87171;white-space:nowrap;pointer-events:none;z-index:9;
    text-shadow:0 3px 14px rgba(0,0,0,.9),0 0 26px rgba(239,68,68,.7);
    animation:duel-fx-dmg-kf .62s ease-out both;}
  @keyframes duel-fx-dmg-kf{
    0%{opacity:0;transform:translate(-50%,0) scale(.7);}
    22%{opacity:1;transform:translate(-50%,-10px) scale(1.25);}
    100%{opacity:0;transform:translate(-50%,-72px) scale(1);}
  }

  .duel-fx-ring{position:absolute;top:50%;left:50%;width:60%;height:60%;
    border:5px solid rgba(147,197,253,.95);border-radius:50%;
    transform:translate(-50%,-50%) scale(.35);opacity:0;pointer-events:none;z-index:7;
    box-shadow:0 0 34px rgba(96,165,250,.8),inset 0 0 26px rgba(96,165,250,.5);
    animation:duel-fx-ring-kf .62s cubic-bezier(.2,.8,.3,1) both;}
  @keyframes duel-fx-ring-kf{
    0%{opacity:.95;transform:translate(-50%,-50%) scale(.35);}
    70%{opacity:.55;}
    100%{opacity:0;transform:translate(-50%,-50%) scale(2.1);}
  }

  /* pierce: the defender's shield ghost visibly fails as the strike passes through */
  .duel-fx-ghost{position:absolute;top:50%;left:50%;transform:translate(-50%,-50%);
    font-size:clamp(2.4rem,5vw,4rem);pointer-events:none;z-index:7;opacity:0;
    animation:duel-fx-ghost-kf .6s ease both;}
  @keyframes duel-fx-ghost-kf{
    0%{opacity:0;transform:translate(-50%,-50%) scale(.8);filter:none;}
    30%{opacity:.9;transform:translate(-50%,-50%) scale(1.1);filter:none;}
    100%{opacity:0;transform:translate(-50%,-50%) scale(1.5);filter:grayscale(1) blur(3px);}
  }

  /* outcome caption between the two shields */
  .duel-outcome{position:absolute;left:50%;top:50%;transform:translate(-50%,-50%);
    width:max-content;max-width:min(30rem,86vw);border-radius:1rem;padding:.8rem 1.1rem;
    background:rgba(11,15,25,.94);pointer-events:none;z-index:12;text-align:center;
    box-shadow:0 16px 50px rgba(0,0,0,.7);animation:duel-outcome-kf .25s cubic-bezier(.34,1.56,.64,1) both;}
  @keyframes duel-outcome-kf{
    0%{opacity:0;transform:translate(-50%,-50%) scale(.8);}
    100%{opacity:1;transform:translate(-50%,-50%) scale(1);}
  }
  .duel-outcome .oc-head{font-family:'Cinzel',Georgia,serif;font-weight:800;line-height:1.1;
    font-size:clamp(1.15rem,2.4vw,1.75rem);}
  .duel-outcome .oc-body{font-size:.85rem;font-weight:700;color:#e5e7eb;margin-top:.3rem;line-height:1.3;}
  .duel-outcome .oc-math{font-family:'Cinzel',Georgia,serif;font-weight:800;margin-top:.25rem;
    font-size:clamp(1.05rem,2vw,1.45rem);color:#fde68a;}
  .duel-outcome-hit{border:2px solid #ef4444;}
  .duel-outcome-hit .oc-head{color:#fca5a5;text-shadow:0 0 22px rgba(239,68,68,.6);}
  .duel-outcome-blocked{border:2px solid #60a5fa;}
  .duel-outcome-blocked .oc-head{color:#bfdbfe;text-shadow:0 0 22px rgba(96,165,250,.6);}
  .duel-outcome-reduced{border:2px solid #f59e0b;}
  .duel-outcome-reduced .oc-head{color:#fde68a;text-shadow:0 0 22px rgba(245,158,11,.6);}
  .duel-outcome-pierced{border:2px solid #a78bfa;}
  .duel-outcome-pierced .oc-head{color:#ddd6fe;text-shadow:0 0 22px rgba(167,139,250,.6);}
  /* victory — same outcome-card component as every other strike result,
     just gold to match the prize/points colour already used across the card. */
  .duel-outcome-victory{border:2px solid #fbbf24;}
  .duel-outcome-victory .oc-head{color:#fde68a;text-shadow:0 0 28px rgba(251,191,36,.75);}

  .battle-fx-vignette{position:fixed;inset:0;z-index:65;pointer-events:none;
    animation:battle-fx-vignette-kf .7s ease both;}
  @keyframes battle-fx-vignette-kf{
    0%{box-shadow:inset 0 0 0 0 rgba(239,68,68,0);}
    35%{box-shadow:inset 0 0 110px 26px rgba(239,68,68,.5);}
    100%{box-shadow:inset 0 0 0 0 rgba(239,68,68,0);}
  }

  /* teacher scoring row — deliberately quieter than the duel above it */
  .duel-teacher{position:relative;z-index:1;flex:0 0 auto;width:100%;max-width:1560px;margin:.8rem auto 0;
    border:1px dashed #4b5563;border-radius:1rem;padding:.7rem .9rem;background:rgba(17,24,39,.55);}
  .duel-teacher-title{font-size:.68rem;font-weight:800;letter-spacing:.16em;text-transform:uppercase;
    color:#9ca3af;text-align:center;margin-bottom:.55rem;}
  .duel-teacher-title span{display:block;letter-spacing:.02em;text-transform:none;font-weight:600;
    font-size:.72rem;color:#6b7280;margin-top:.15rem;}
  .duel-teacher-grid{display:grid;grid-template-columns:repeat(4,minmax(0,1fr));gap:.55rem;}
  @media (max-width:760px){.duel-teacher-grid{grid-template-columns:repeat(2,minmax(0,1fr));}}
  .duel-tchip{position:relative;display:flex;align-items:center;gap:.5rem;border-radius:.85rem;
    border:1px solid var(--tc-accent,#374151);background:#111827;padding:.4rem .5rem;min-width:0;}
  .duel-tchip-crest{width:30px;height:30px;object-fit:contain;flex-shrink:0;}
  .duel-tchip-info{flex:1;min-width:0;}
  .duel-tchip-name{font-weight:800;font-size:.8rem;color:var(--tc-accent,#f9fafb);
    overflow:hidden;text-overflow:ellipsis;white-space:nowrap;}
  .duel-tchip-pts{font-size:.7rem;color:#fde68a;font-weight:700;font-variant-numeric:tabular-nums;}
  .duel-tchip-btns{display:flex;gap:.3rem;flex-shrink:0;}
  .duel-tbtn{min-width:48px;min-height:48px;border-radius:.7rem;border:none;font-weight:800;
    font-size:.82rem;cursor:pointer;touch-action:manipulation;transition:transform .12s ease,filter .12s ease;}
  .duel-tbtn:active{transform:scale(.93);}
  .duel-tbtn:hover{filter:brightness(1.14);}
  .duel-tbtn-up{background:linear-gradient(135deg,#16a34a,#15803d);color:#f0fdf4;}
  .duel-tbtn-down{background:linear-gradient(135deg,#991b1b,#7f1d1d);color:#fee2e2;}
  .duel-fx-chip{position:absolute;top:-4px;left:50%;font-weight:800;font-size:.95rem;white-space:nowrap;
    pointer-events:none;z-index:12;text-shadow:0 2px 8px rgba(0,0,0,.85);
    animation:duel-fx-chip-kf .85s ease-out both;}
  .duel-fx-chip-bad{color:#f87171;}
  .duel-fx-chip-good{color:#4ade80;}
  .duel-fx-chip-blue{color:#bfdbfe;}
  @keyframes duel-fx-chip-kf{
    0%{opacity:0;transform:translate(-50%,0) scale(.75);}
    20%{opacity:1;transform:translate(-50%,-8px) scale(1.15);}
    100%{opacity:0;transform:translate(-50%,-40px) scale(1);}
  }

  /* toast (unaffordable / no target) */
  .duel-toast{position:fixed;bottom:28px;left:50%;transform:translateX(-50%);z-index:72;
    background:#7f1d1d;border:2px solid #ef4444;color:#fee2e2;font-weight:800;
    padding:.75rem 1.3rem;border-radius:.85rem;box-shadow:0 12px 30px rgba(0,0,0,.6);pointer-events:none;
    animation:duel-toast-kf .25s ease both;}
  @keyframes duel-toast-kf{0%{opacity:0;transform:translate(-50%,10px);}100%{opacity:1;transform:translate(-50%,0);}}

  /* Narrow / portrait: stack the three columns and let the page scroll. */
  @media (max-width:1080px){
    .duel-root{overflow-y:auto;display:block;}
    .duel-stage{grid-template-columns:1fr;}
    .duel-side{height:auto;overflow:visible;}
    .duel-items{max-height:clamp(170px,30vh,380px);}
    .duel-arena{height:auto;}
  }

  @media (prefers-reduced-motion:reduce){
    .battle-ignite-btn,.battle-sword-a,.battle-sword-b,.battle-vignette,.battle-flash,
    .battle-stamp span,.battle-shake,.battle-ember,
    .duel-proj,.duel-proj-stopped,.duel-fx-flash,.duel-crest-shake,.duel-fx-ring,.duel-fx-ghost,
    .duel-fx-dmg,.duel-fx-chip,.duel-outcome,.duel-toast,.duel-reduce-flare,
    .battle-fx-vignette{animation:none;}
  }
  `;
  document.head.appendChild(style);
}

// =============================================================================
// LANDING VIEW
// =============================================================================
function renderLanding() {
  if (!rootEl) return;
  view = 'landing';
  targetId = null;
  chooserOpen = false;
  rootEl.innerHTML = `
    <div class="battle-landing">
      <div class="battle-landing-eyebrow">Friday Showdown</div>
      <div class="battle-landing-title">The houses stand ready&hellip;</div>
      <button type="button" class="battle-ignite-btn font-display">⚔️ BATTLE DAY!</button>
      <p class="battle-landing-sub">Tap to ignite Combat Mode — one house picks an opponent, spends its magic items, and strikes.</p>
    </div>`;
  const btn = rootEl.querySelector('.battle-ignite-btn');
  if (btn) btn.addEventListener('click', triggerCinematic);
}

// =============================================================================
// CINEMATIC ENTRY (overlay in #overlay-root) — unchanged, then lands on the duel
// =============================================================================
function triggerCinematic() {
  const host = document.getElementById('overlay-root');
  if (!host || overlayEl) return;

  // A Battle Day session begins here — everyone's HP refills to full before
  // the duel ever renders, so no house arrives already half-beaten from last
  // week's fight.
  ctxRef.store.resetAllHp();

  ctxRef.audio.sfx('sword');
  // A recorded war cry REPLACES the robot voice rather than joining it — two
  // voices over one another would be worse than either alone. Until the teacher
  // records one, speech synthesis carries the line as before.
  let cryEl = null;
  if (ctxRef.store.getSfx && ctxRef.store.getSfx('battlecry')) {
    cryEl = ctxRef.audio.sfx('battlecry') || null;   // undefined when muted
  } else {
    ctxRef.audio.say("It's Battle Day! Attack!", { rate: 1.05, pitch: 0.8 });
  }

  overlayEl = document.createElement('div');
  overlayEl.className = 'battle-cinematic';
  const letters = 'BATTLE DAY'.split('');
  overlayEl.innerHTML = `
    <div class="battle-vignette"></div>
    <div class="battle-flash"></div>
    <div class="battle-swords-wrap">
      <span class="battle-sword battle-sword-a">🗡️</span>
      <span class="battle-sword battle-sword-b">🗡️</span>
    </div>
    <div class="battle-stamp">
      ${letters.map((ch, i) => `<span style="animation-delay:${0.55 + i * 0.07}s">${ch === ' ' ? '&nbsp;' : esc(ch)}</span>`).join('')}
    </div>`;
  host.appendChild(overlayEl);

  const mainEl = document.getElementById('module-root');
  if (mainEl) {
    mainEl.classList.remove('battle-shake');
    void mainEl.offsetWidth;
    mainEl.classList.add('battle-shake');
    later(() => mainEl.classList.remove('battle-shake'), 550);
  }

  // Hold the cinematic until the war cry has FINISHED, then a beat of silence
  // before cutting to the duel. Timed off the recording rather than a fixed
  // number, so re-recording a longer or shorter line needs no code change.
  // Floor: the letters finish stamping around 1.5s, so never cut before 2.5s.
  // Ceiling: if 'ended' never arrives (a stalled file), cut anyway at 8s.
  const cutAt = Date.now();
  let cut = false;
  const cutToDuel = () => {
    if (cut) return;
    cut = true;
    if (overlayEl) { overlayEl.remove(); overlayEl = null; }
    renderDuel();
  };
  const finishAfter = (ms) => later(cutToDuel, Math.max(0, ms));

  if (cryEl) {
    cryEl.addEventListener('ended', () => {
      const elapsed = Date.now() - cutAt;
      finishAfter(Math.max(CINEMATIC_MIN_MS - elapsed, CRY_TAIL_MS));
    });
    later(cutToDuel, CINEMATIC_MAX_MS);            // stalled-audio backstop
  } else {
    finishAfter(CINEMATIC_MIN_MS);
  }
}

function emberField(count = 14) {
  let html = '';
  for (let i = 0; i < count; i++) {
    const left = Math.round(Math.random() * 100);
    const size = 3 + Math.round(Math.random() * 5);
    const dur = 3.5 + Math.random() * 3.5;
    const delay = Math.random() * 5;
    const drift = Math.round((Math.random() - 0.5) * 60);
    html += `<span class="battle-ember" style="left:${left}%;width:${size}px;height:${size}px;
      animation-duration:${dur.toFixed(2)}s;animation-delay:${delay.toFixed(2)}s;--ember-drift:${drift}px;"></span>`;
  }
  return html;
}

// =============================================================================
// DUEL VIEW — markup
// =============================================================================

// Points block that sits BELOW each crest (the teacher's layout: shield on
// top, then points, then hit points).
function pointsBlockHtml(store, house, side) {
  return `
    <div class="duel-points-lbl">Points</div>
    <div class="duel-points-val" data-points="${side}">${store.getTotal(house.id, 'term')}</div>`;
}

// Hit points sit BELOW points on the same card — same layout, same labelling
// convention, but tinted to the house's own accent colour rather than the
// shared gold, and backed by a bar so the class can watch it drain without
// reading the number. This is what a strike removes now; points never move
// for the loser.
function hpBlockHtml(store, house, side) {
  const max = store.getMaxHp(house.id);
  const cur = store.getHp(house.id);
  const pct = max > 0 ? Math.max(0, Math.min(100, Math.round((cur / max) * 100))) : 0;
  return `
    <div class="duel-hp-lbl">Hit Points</div>
    <div class="duel-hp-wrap">
      <div class="duel-hp-val" data-hp="${side}" style="color:${esc(house.accent)}">${cur} / ${max}</div>
      <div class="duel-hp-bar">
        <div class="duel-hp-fill" data-hp-bar="${side}" style="width:${pct}%;background:${esc(house.accent)}"></div>
      </div>
    </div>`;
}

function crestHtml(house, side) {
  return `<div class="duel-crest" data-crest="${side}">${houseImg(house, '')}</div>`;
}

function kindTag(kind) {
  return { attack: 'Attack', steal: 'Steal', pierce: 'Pierce' }[kind] || kind;
}

// One stockpiled item, with what the strike DOES (damage/steal amount), how
// many the house is holding, and a plain-English reason when it can't be
// used right now. Nothing here gates on points any more — if the house owns
// it, it can throw it; the only blocker left is "no opponent chosen yet".
function itemRowHtml(store, item, count, target) {
  const kind = item.effect.kind;
  const amount = item.effect.amount;
  const disabled = !target;
  // The strike removes HIT POINTS now, not points. A 'steal' item still deals
  // HP damage AND hands the attacker points equal to that damage — both are
  // true, so both are said.
  const dmgText = kind === 'steal' ? `−${amount} HP · steal ${amount} pts` : `−${amount} HP`;

  let reason = '';
  if (!target) reason = `<div class="duel-item-reason">🎯 Choose an opponent first</div>`;

  let note = '';
  if (target) {
    if (kind === 'pierce' && (store.isShielded(target.id) || store.hasReduction(target.id))) {
      note = `<div class="duel-item-note duel-note-pierce">🫥 Ignores their defenses — full damage</div>`;
    } else if (store.isShielded(target.id)) {
      note = `<div class="duel-item-note duel-note-block">🛡️ Their shield will block this</div>`;
    } else if (store.hasReduction(target.id)) {
      note = `<div class="duel-item-note duel-note-half">🕵️ Halved by their relic → ${Math.max(1, Math.round(amount / 2))} HP</div>`;
    }
  }

  return `
    <div class="duel-item-cell">
    <button type="button" class="duel-item" data-strike-item="${esc(item.id)}" ${disabled ? 'disabled' : ''}
      title="${esc(item.desc || item.name)}">
      <span class="duel-item-emoji">${esc(item.emoji || '⚔️')}</span>
      <span class="duel-item-body">
        <span class="duel-item-name">${esc(item.name)}</span>
        <span class="duel-item-meta">
          <span class="duel-item-dmg">${dmgText}</span>
          <span class="duel-item-kind">${kindTag(kind)}</span>
        </span>
      </span>
      ${count > 1 ? `<span class="duel-item-count">×${count}</span>` : ''}
    </button>
    ${reason}${note}
    </div>`;
}

function challengerSideHtml(store, challenger, target) {
  // Battle Day spends from what the house already bought and stockpiled in
  // the Magic Shop — not from the catalogue, and not from the treasury.
  // Anything malformed (an item deleted from the shop since it was bought)
  // is dropped by store.getInventory rather than rendered broken; the
  // OFFENSIVE_KINDS check is a second belt-and-suspenders filter here.
  const inventory = store.getInventory(challenger.id)
    .filter((row) => row.item && row.item.effect && OFFENSIVE_KINDS.has(row.item.effect.kind));

  let list;
  if (!inventory.length) {
    list = `<div class="duel-empty">No attack items yet. Purchase them in the Magic Shop</div>`;
  } else {
    list = inventory.map(({ item, count }) => itemRowHtml(store, item, count, target)).join('');
  }

  return `
    <section class="duel-side duel-side-attacker" style="--side-accent:${esc(challenger.accent)}">
      <div class="duel-role">⚔️ Attacker</div>
      <div class="duel-head">
        <div class="duel-stats">
          ${pointsBlockHtml(store, challenger, 'challenger')}
          ${hpBlockHtml(store, challenger, 'challenger')}
        </div>
        <div class="duel-identity">
          ${crestHtml(challenger, 'challenger')}
          <div class="duel-name">${esc(challenger.name)}</div>
        </div>
      </div>
      <div class="duel-section-lbl">Ready to strike</div>
      <div class="duel-items">${list}</div>
    </section>`;
}

function defenseListHtml(store, house) {
  const rows = [];
  if (store.isShielded(house.id)) {
    rows.push(`<div class="duel-def-row duel-def-shield">🛡️ <b>Shield up</b> — blocks attacks · ${esc(fmtRemain(store.shieldRemainingMs(house.id)) || '')}</div>`);
  }
  if (store.hasReduction(house.id)) {
    rows.push(`<div class="duel-def-row duel-def-reduce" data-reduce-badge>🕵️ <b>Damage halved</b> — relic active · ${esc(fmtRemain(store.reductionRemainingMs(house.id)) || '')}</div>`);
  }
  if (!rows.length) rows.push(`<div class="duel-def-row duel-def-none">💥 Undefended — a strike lands in full</div>`);
  return `<div class="duel-def">${rows.join('')}</div>`;
}

// What the attacker stands to win if this house falls, shown as soon as a
// defender is chosen so the class can see the stakes before a single item is
// thrown.
function prizePreviewHtml(store, challenger, target) {
  const prize = store.previewPrize(challenger.id, target.id);
  return `<div class="duel-prize">🏆 If ${esc(target.name)} falls: <b>${prize} pts</b> to ${esc(challenger.name)} — ${esc(target.name)} loses none.</div>`;
}

function defenderSideHtml(store, target, challenger) {
  return `
    <section class="duel-side duel-side-defender" style="--side-accent:${esc(target.accent)}">
      <div class="duel-role">🛡️ Defender</div>
      <div class="duel-head">
        <div class="duel-stats">
          ${pointsBlockHtml(store, target, 'defender')}
          ${hpBlockHtml(store, target, 'defender')}
        </div>
        <div class="duel-identity">
          ${crestHtml(target, 'defender')}
          <div class="duel-name">${esc(target.name)}</div>
        </div>
      </div>
      <div class="duel-section-lbl">Their active defenses</div>
      ${defenseListHtml(store, target)}
      ${challenger ? prizePreviewHtml(store, challenger, target) : ''}
    </section>`;
}

// Big touch targets for choosing who to attack (or who attacks). When
// `attackerId` is given, each house is checked against store.canAttack — a
// house that can't legally be attacked (punching-down guard) still SHOWS but
// is visibly locked, with the reason spelled out, rather than disappearing.
function housePickHtml(store, houses, attr, { showDefenses = true, attackerId = null } = {}) {
  return `<div class="duel-pick">${houses.map((h) => {
    const shielded = store.isShielded(h.id);
    const reduced = store.hasReduction(h.id);
    const def = shielded ? '🛡️ Shielded' : reduced ? '🕵️ Damage halved' : 'Undefended';
    const gate = attackerId != null ? store.canAttack(attackerId, h.id) : { ok: true, reason: '' };
    return `
      <button type="button" class="duel-pick-btn${gate.ok ? '' : ' duel-pick-btn-locked'}" ${attr}="${h.id}"
        ${gate.ok ? '' : 'disabled'}
        style="--pick-accent:${esc(h.accent)};--pick-soft:${esc(h.accentSoft || 'rgba(55,65,81,.5)')}">
        ${houseImg(h, 'duel-pick-crest')}
        <span class="duel-pick-info">
          <span class="duel-pick-name">${esc(h.name)}</span>
          ${showDefenses ? `<span class="duel-pick-def ${shielded || reduced ? '' : 'duel-pick-def-none'}">${def}</span>` : ''}
          ${!gate.ok ? `<span class="duel-pick-locked-reason">🚫 ${esc(gate.reason)}</span>` : ''}
        </span>
        <span class="duel-pick-pts"><span class="v">${store.getTotal(h.id, 'term')}</span><br><span class="l">pts</span></span>
      </button>`;
  }).join('')}</div>`;
}

function targetPickerHtml(store, challenger) {
  const others = Object.values(store.HOUSES).filter((h) => h.id !== challenger.id);
  return `
    <section class="duel-side" style="--side-accent:#4b5563">
      <div class="duel-role">🎯 Choose an opponent</div>
      <div class="duel-pick-prompt">Who does ${esc(challenger.name)} attack?</div>
      <div class="duel-pick-hint">Tap a house to see their points and defenses.</div>
      ${housePickHtml(store, others, 'data-pick-target', { attackerId: challenger.id })}
    </section>`;
}

function chooserHtml(store) {
  return `
    <section class="duel-side" style="--side-accent:#4b5563">
      <div class="duel-role">⚔️ Who is attacking?</div>
      <div class="duel-pick-prompt">Choose the challenging house</div>
      <div class="duel-pick-hint">This also switches the top bar to that house.</div>
      ${housePickHtml(store, Object.values(store.HOUSES), 'data-pick-challenger', { showDefenses: false })}
    </section>`;
}

function arenaHtml(challenger, target) {
  const hint = !challenger ? 'Pick the attacking house to begin.'
    : !target ? 'Now choose who they attack →'
    : 'Pick a magic item on the left to strike.';
  // "Change opponent" lives here rather than on the defender card: it is about
  // the matchup, not about either house, and the middle column has room the
  // cards do not. There is deliberately no "change attacker" twin — the
  // attacker IS whichever house is selected in the top bar, one class at a time.
  return `
    <div class="duel-arena" data-arena>
      <div class="duel-vs font-display">VS</div>
      <div class="duel-arena-hint">${esc(hint)}</div>
      ${target ? '<button type="button" class="duel-swap-btn" data-clear-target>⇄ Change opponent</button>' : ''}
    </div>`;
}

function teacherRowHtml(store) {
  const houses = Object.values(store.HOUSES);
  // Teacher-set in Admin → Battle Day. Both the label and the value the button
  // carries come from the same number, so they can never drift apart.
  const tScore = store.getCombat().teacherScore;
  return `
    <div class="duel-teacher">
      <div class="duel-teacher-title">👩‍🏫 Teacher scoring — not a house attack
        <span>Award or deduct directly. Deductions still respect shields and relics.</span>
      </div>
      <div class="duel-teacher-grid">
        ${houses.map((h) => `
          <div class="duel-tchip" data-tchip="${h.id}" style="--tc-accent:${esc(h.accent)}">
            ${houseImg(h, 'duel-tchip-crest')}
            <div class="duel-tchip-info">
              <div class="duel-tchip-name">${esc(h.name)}</div>
              <div class="duel-tchip-pts">${store.getTotal(h.id, 'term')} pts</div>
            </div>
            <div class="duel-tchip-btns">
              <button type="button" class="duel-tbtn duel-tbtn-up" data-teacher="${tScore}" data-house="${h.id}" title="Victory +${tScore}">+${tScore}</button>
              <button type="button" class="duel-tbtn duel-tbtn-down" data-teacher="-${tScore}" data-house="${h.id}" title="Defeat −${tScore}">−${tScore}</button>
            </div>
          </div>`).join('')}
      </div>
    </div>`;
}

function renderDuel() {
  if (!rootEl || resolving) return;
  view = 'duel';
  const store = ctxRef.store;
  const challenger = challengerHouse();

  // A target that is no longer valid (house became the challenger) is dropped.
  if (challenger && targetId === challenger.id) targetId = null;
  const target = targetId != null ? store.HOUSES[targetId] : null;

  const showChooser = !challenger || chooserOpen;
  const leftHtml = showChooser ? chooserHtml(store) : challengerSideHtml(store, challenger, target);
  const rightHtml = showChooser ? `<section class="duel-side" style="--side-accent:#374151">
      <div class="duel-role">🛡️ Defender</div>
      <div class="duel-pick-hint">Waiting for an attacker&hellip;</div>
    </section>`
    : (target ? defenderSideHtml(store, target, challenger) : targetPickerHtml(store, challenger));

  rootEl.innerHTML = `
    <div class="duel-root">
      <div class="battle-embers">${emberField()}</div>
      <div class="duel-topbar">
        <div class="duel-topbar-inner">
          <div class="duel-title font-display">⚔️ BATTLE DAY — CHOOSE YOUR STRIKE</div>
        <div class="duel-topbar-actions">
          <button type="button" class="battle-shop-btn"><img class="battle-btn-mark" src="images/icon-market.png" alt="" onerror="this.style.display='none'" />Magic Shop</button>
          <button type="button" class="battle-end-btn">🏳️ End Battle</button>
        </div>
        </div>
      </div>
      <div class="duel-stage">
        ${leftHtml}
        ${arenaHtml(showChooser ? null : challenger, showChooser ? null : target)}
        ${rightHtml}
      </div>
      ${teacherRowHtml(store)}
    </div>`;

  wireDuel();
}

// =============================================================================
// DUEL VIEW — wiring
// =============================================================================
function wireDuel() {
  if (!rootEl) return;
  const store = ctxRef.store;

  const shopBtn = rootEl.querySelector('.battle-shop-btn');
  if (shopBtn) shopBtn.addEventListener('click', () => ctxRef.registry.navigate('shop'));
  const endBtn = rootEl.querySelector('.battle-end-btn');
  if (endBtn) endBtn.addEventListener('click', endBattle);

  const openChooser = rootEl.querySelector('[data-open-chooser]');
  if (openChooser) openChooser.addEventListener('click', () => { chooserOpen = true; renderDuel(); });

  rootEl.querySelectorAll('[data-pick-challenger]').forEach((btn) => {
    btn.addEventListener('click', () => {
      const id = Number(btn.getAttribute('data-pick-challenger'));
      chooserOpen = false;
      if (targetId === id) targetId = null;
      ctxRef.audio.sfx('coin');
      // setActiveCore emits -> subscribe -> renderDuel(); no manual redraw needed.
      store.setActiveCore(id);
    });
  });

  rootEl.querySelectorAll('[data-pick-target]').forEach((btn) => {
    btn.addEventListener('click', () => {
      targetId = Number(btn.getAttribute('data-pick-target'));
      ctxRef.audio.sfx('sword');
      renderDuel();
    });
  });

  const clearTarget = rootEl.querySelector('[data-clear-target]');
  if (clearTarget) clearTarget.addEventListener('click', () => { targetId = null; renderDuel(); });

  rootEl.querySelectorAll('[data-strike-item]').forEach((btn) => {
    btn.addEventListener('click', () => strike(btn.getAttribute('data-strike-item')));
  });

  rootEl.querySelectorAll('[data-teacher]').forEach((btn) => {
    btn.addEventListener('click', () => {
      teacherScore(Number(btn.getAttribute('data-house')), Number(btn.getAttribute('data-teacher')));
    });
  });
}

function toast(text) {
  if (!rootEl) return;
  const existing = rootEl.querySelector('.duel-toast');
  if (existing) existing.remove();
  const el = document.createElement('div');
  el.className = 'duel-toast';
  el.textContent = text;
  rootEl.appendChild(el);
  fxNodes.add(el);
  later(() => { el.remove(); fxNodes.delete(el); }, 2200);
}

// Same rolling readout as animatePoints, but for the HP number AND its bar —
// the bar is "the thing a class will actually watch" per the brief, so it has
// to drain in step with the number, not jump.
function animateHp(side, from, to, max, durationMs) {
  const valEl = () => (rootEl ? rootEl.querySelector(`[data-hp="${side}"]`) : null);
  const barEl = () => (rootEl ? rootEl.querySelector(`[data-hp-bar="${side}"]`) : null);
  const pctOf = (n) => (max > 0 ? Math.max(0, Math.min(100, Math.round((n / max) * 100))) : 0);
  const paint = (n) => {
    const v = valEl(); if (v) v.textContent = `${n} / ${max}`;
    const b = barEl(); if (b) b.style.width = `${pctOf(n)}%`;
  };
  if (!valEl()) return;
  if (from === to || prefersReducedMotion()) { paint(to); return; }
  const steps = 14;
  const stepMs = Math.max(16, Math.round(durationMs / steps));
  let i = 0;
  const tick = () => {
    if (!valEl()) return;               // re-rendered or unmounted — final value already drawn
    i += 1;
    const t = Math.min(1, i / steps);
    const eased = 1 - (1 - t) * (1 - t);
    paint(Math.round(from + (to - from) * eased));
    if (t < 1) later(tick, stepMs);
  };
  paint(from);
  tick();
}

// Rolls a points readout from `from` to `to` so the class watches the score
// move rather than seeing it snap. Ticks via later() so an unmount sweeps it up.
function animatePoints(side, from, to, durationMs) {
  const readEl = () => (rootEl ? rootEl.querySelector(`[data-points="${side}"]`) : null);
  const el = readEl();
  if (!el) return;
  if (from === to || prefersReducedMotion()) { el.textContent = String(to); return; }
  const steps = 14;
  const stepMs = Math.max(16, Math.round(durationMs / steps));
  let i = 0;
  const tick = () => {
    const node = readEl();
    if (!node) return;                 // re-rendered or unmounted — final value already drawn
    i += 1;
    const t = Math.min(1, i / steps);
    const eased = 1 - (1 - t) * (1 - t);
    node.textContent = String(Math.round(from + (to - from) * eased));
    if (t < 1) later(tick, stepMs);
  };
  el.textContent = String(from);
  tick();
}

// =============================================================================
// COMBAT EFFECTS — pure CSS/DOM, pointer-events:none via the fx classes,
// every animation ≤900ms, tracked in fxNodes for guaranteed cleanup.
// =============================================================================
function centerOf(el) {
  const r = el.getBoundingClientRect();
  return { x: r.left + r.width / 2, y: r.top + r.height / 2 };
}

// Flies the item's emoji from the challenger crest to the defender crest.
// `stopAt` < 1 stops it short (a blocked strike dies against the shield).
function spawnProjectile(fromEl, toEl, { emoji = '⚔️', ghost = false, stopAt = 1, travel = TRAVEL_MS } = {}) {
  if (!rootEl || !fromEl || !toEl) return null;
  const a = centerOf(fromEl);
  const b = centerOf(toEl);
  const el = document.createElement('div');
  el.className = `duel-proj${ghost ? ' duel-proj-ghost' : ''}`;
  el.textContent = emoji;
  el.style.left = `${a.x}px`;
  el.style.top = `${a.y}px`;
  el.style.setProperty('--dx', `${(b.x - a.x) * stopAt}px`);
  el.style.setProperty('--dy', `${(b.y - a.y) * stopAt}px`);
  el.style.setProperty('--travel', `${travel}ms`);
  rootEl.appendChild(el);
  fxNodes.add(el);
  later(() => { el.remove(); fxNodes.delete(el); }, travel + 300);
  return el;
}

function screenVignettePulse() {
  if (prefersReducedMotion()) return; // decorative-only — skip under reduced motion
  const host = document.getElementById('overlay-root');
  if (!host) return;
  spawnFxPlain(host, 'battle-fx-vignette', 700);
}

function shakeCrest(crest) {
  if (!crest || prefersReducedMotion()) return;
  crest.classList.remove('duel-crest-shake');
  void crest.offsetWidth;
  crest.classList.add('duel-crest-shake');
  later(() => crest.classList.remove('duel-crest-shake'), 460);
}

function outcomeCard(kind, head, body, math) {
  const arena = rootEl ? rootEl.querySelector('[data-arena]') : null;
  if (!arena) return;
  spawnFxHtml(arena, `duel-outcome duel-outcome-${kind}`, OUTCOME_MS, `
    <div class="oc-head">${head}</div>
    ${math ? `<div class="oc-math">${math}</div>` : ''}
    <div class="oc-body">${body}</div>`);
}

// The relic badge only exists while that house is the on-screen defender, so
// callers pass the house whose relic actually absorbed the hit.
function flareReduceBadge(houseId) {
  if (houseId != null && houseId !== targetId) return;
  const badge = rootEl ? rootEl.querySelector('[data-reduce-badge]') : null;
  if (!badge || prefersReducedMotion()) return;
  badge.classList.remove('duel-reduce-flare');
  void badge.offsetWidth;
  badge.classList.add('duel-reduce-flare');
  later(() => badge.classList.remove('duel-reduce-flare'), 720);
}

// =============================================================================
// HP COMBAT RESOLUTION — reproduces store.applyAttack's shield/reduction/
// pierce order (a full shield blocks outright; otherwise a reduction halves
// the hit; a `pierce` attack ignores both) but spends HIT POINTS instead of
// house points. store.applyAttack itself is left untouched — it is still the
// engine behind teacher scoring, which moves points directly on purpose.
// =============================================================================
function resolveHpAttack(store, { toId, amount, pierce = false }) {
  const dmg = Math.max(0, Math.round(Number(amount) || 0));
  const shielded = store.isShielded(toId);
  const reduced = store.hasReduction(toId);
  const beforeHp = store.getHp(toId);

  if (shielded && !pierce) {
    return { outcome: 'blocked', applied: 0, shielded, reduced, before: beforeHp, after: beforeHp, defeated: false };
  }
  const applied = (reduced && !pierce) ? Math.max(1, Math.round(dmg / 2)) : dmg;
  const dmgResult = store.damageHp(toId, applied);
  return {
    outcome: pierce && (shielded || reduced) ? 'pierced' : (reduced ? 'reduced' : 'full'),
    applied, shielded, reduced, blocked: dmg - applied,
    before: dmgResult.before, after: dmgResult.after, defeated: dmgResult.defeated,
  };
}

// =============================================================================
// THE STRIKE
// =============================================================================
async function strike(itemId) {
  if (!rootEl || resolving) return;
  const store = ctxRef.store;
  const challenger = challengerHouse();
  const target = targetId != null ? store.HOUSES[targetId] : null;
  // The item was bought (and its cost paid) in the Magic Shop, possibly days
  // ago — look it up in what the house is actually holding, not the catalogue.
  const invRow = challenger ? store.getInventory(challenger.id).find((row) => row.item.id === itemId) : null;
  const item = invRow ? invRow.item : null;
  if (!item || !challenger || !target) return;

  const kind = item.effect.kind;
  const amount = item.effect.amount;
  const pierce = kind === 'pierce';

  // Gate the strike, not the ceremony: choosing the item is free, but nothing
  // is consumed or struck until the teacher approves. `resolving` doubles as
  // the in-flight guard here — set true before the await so a double-tap on
  // this or any other item/teacher-scoring button is blocked exactly like it
  // is during the real mutation below, and it also suspends the
  // store-subscribe re-render while the pad is up (no optimistic UI change on
  // a refusal).
  resolving = true;
  const ok = await lock.requireUnlock('use this item');
  if (!rootEl) { resolving = false; return; }   // unmounted while the pad was open
  if (!ok) { resolving = false; return; }       // refused — nothing moves, retry stays open

  const beforeChallenger = store.getTotal(challenger.id, 'term');
  const beforeTarget = store.getTotal(target.id, 'term');
  const maxTargetHp = store.getMaxHp(target.id);

  // Suspend re-renders so the whole resolution lands in ONE redraw — otherwise
  // consumeFromInventory(), the HP hit and any steal/prize payout each rebuild
  // the DOM and every fx node we spawn is attached to a soon-to-be-detached
  // element. (resolving is already true from the gate above; kept true
  // straight through.)
  let result;
  let battleWon = null;
  try {
    // Take it out of the stockpile first. This can only fail if someone
    // double-tapped past the `resolving` guard or the last copy was already
    // struck elsewhere — either way, bail with no damage, no animation, and
    // no half-applied state. Nothing below this line runs.
    if (!store.consumeFromInventory(challenger.id, itemId)) {
      resolving = false;
      renderDuel();
      toast(`${item.name} is already gone — nothing struck`);
      return;
    }
    // HIT POINTS take the damage now, not points — shields/reductions/pierce
    // resolve exactly as before, just against HP (see resolveHpAttack above).
    result = resolveHpAttack(store, { toId: target.id, amount, pierce });
    // A steal loots exactly what was actually taken — 0 if blocked, half if
    // reduced. The attacker gains POINTS equal to the HP damage dealt; that
    // is the whole point of the item. The target's points never move.
    if (kind === 'steal' && result.outcome !== 'blocked' && result.applied > 0) {
      store.addPoints(challenger.id, result.applied, { reason: `${item.name} loot from ${target.name}`, tag: 'attack' });
    }
    // The house's HP hit zero: the battle is over. The winner takes the
    // prize in points; the loser never loses any.
    if (result.defeated) {
      const prize = store.awardBattleWin(challenger.id, target.id);
      battleWon = { prize };
    }
  } finally {
    resolving = false;
  }

  renderDuel(); // one redraw, final numbers in the DOM

  const afterChallenger = store.getTotal(challenger.id, 'term');
  const afterTarget = store.getTotal(target.id, 'term'); // combat never touches the loser's points

  // Hold both points totals AND the defender's HP readout at their pre-strike
  // values — the redraw above already painted the final numbers, but the
  // reveal should wait for the hit to actually land (see landHit).
  const chalEl = rootEl.querySelector('[data-points="challenger"]');
  if (chalEl) chalEl.textContent = String(beforeChallenger);
  const defEl = rootEl.querySelector('[data-points="defender"]');
  if (defEl) defEl.textContent = String(beforeTarget);
  const defHpEl = rootEl.querySelector('[data-hp="defender"]');
  if (defHpEl) defHpEl.textContent = `${result.before} / ${maxTargetHp}`;
  const defHpBar = rootEl.querySelector('[data-hp-bar="defender"]');
  if (defHpBar) defHpBar.style.width = `${maxTargetHp > 0 ? Math.max(0, Math.min(100, Math.round((result.before / maxTargetHp) * 100))) : 0}%`;

  playStrike({ item, kind, amount, result, challenger, target,
    beforeChallenger, afterChallenger, beforeTarget, afterTarget,
    beforeTargetHp: result.before, afterTargetHp: result.after, maxTargetHp, battleWon });
}

function playStrike(o) {
  const audio = ctxRef.audio;
  const reduced = prefersReducedMotion();
  const chalCrest = rootEl.querySelector('[data-crest="challenger"]');
  const defCrest = rootEl.querySelector('[data-crest="defender"]');
  const blocked = o.result.outcome === 'blocked';
  const travel = reduced ? 0 : TRAVEL_MS;

  let proj = null;
  if (!reduced) {
    proj = spawnProjectile(chalCrest, defCrest, {
      emoji: o.item.emoji || '⚔️',
      ghost: o.result.outcome === 'pierced',
      stopAt: blocked ? 0.74 : 1,
      travel,
    });
  }

  later(() => {
    if (!rootEl) return;
    const crest = rootEl.querySelector('[data-crest="defender"]');

    if (blocked) {
      if (proj) { proj.classList.add('duel-proj-stopped'); }
      if (!reduced) {
        spawnFx(crest, 'duel-fx-ring', IMPACT_MS);
        spawnFx(crest, 'duel-fx-flash duel-fx-flash-blue', 500);
      }
      audio.sfx('sword');
      outcomeCard('blocked', '🛡️ BLOCKED',
        `${esc(o.target.name)} takes <b>no damage</b>.`,
        `0 damage`);
      // Nothing changed hands — the item is spent from the stockpile either
      // way, but no HP or points moved, so there is nothing to animate.
      return;
    }

    if (o.result.outcome === 'pierced') {
      if (!reduced) spawnFx(crest, 'duel-fx-ghost', IMPACT_MS, '🛡️');
      // the defence fails first, then the hit lands
      later(() => {
        if (!rootEl) return;
        landHit(o, rootEl.querySelector('[data-crest="defender"]'), reduced);
        outcomeCard('pierced', '🫥 PIERCED!',
          `${esc(o.challenger.name)}'s strike phased straight through ${esc(o.target.name)}'s defense.`,
          `−${o.result.applied} HP — full damage`);
        maybeAnnounceVictory(o);
      }, reduced ? 0 : 180);
      return;
    }

    if (o.result.outcome === 'reduced') {
      flareReduceBadge(o.target.id);
      landHit(o, crest, reduced, 'amber');
      outcomeCard('reduced', '🕵️ HALVED',
        `${esc(o.target.name)}'s relic weakened the blow.`,
        `${o.amount} → ${o.result.applied} HP`);
      maybeAnnounceVictory(o);
      return;
    }

    landHit(o, crest, reduced);
    outcomeCard('hit', '💥 DIRECT HIT!',
      `${esc(o.challenger.name)} struck ${esc(o.target.name)} with ${esc(o.item.name)}.${o.kind === 'steal' ? ` They looted <b>${o.result.applied} pts</b>.` : ''}`,
      `−${o.result.applied} HP`);
    maybeAnnounceVictory(o);
  }, travel);
}

// Shared "the hit lands" beat: flash, shake, big rising damage number, vignette,
// thud, and both totals — and now the defender's HP bar — rolling to their
// new values.
function landHit(o, crest, reduced, tint = 'red') {
  ctxRef.audio.sfx('thud');
  // The points-taking-away cue lands HERE, at the same instant the HP number/
  // bar actually starts to drop below — not back when the strike was thrown.
  // Previously this fired synchronously in strike() before the projectile had
  // even travelled, which read as the deduction happening mid-attack.
  ctxRef.audio.sfx('coin');
  screenVignettePulse();
  if (crest && !reduced) {
    spawnFx(crest, `duel-fx-flash duel-fx-flash-${tint}`, 500);
    shakeCrest(crest);
  }
  // Damage number is text feedback — always shown (static under reduced motion).
  spawnFx(crest, 'duel-fx-dmg', IMPACT_MS, `−${o.result.applied}`);
  // The strike removes HIT POINTS — this is the meter the class is watching.
  animateHp('defender', o.beforeTargetHp, o.afterTargetHp, o.maxTargetHp, COUNT_MS);
  // Points: the defender's total NEVER moves from combat any more (before ===
  // after always) — this just redraws the same number. Only a steal, or a
  // battle-winning prize, actually moves the attacker's total, and this is
  // where that gain reveals itself.
  animatePoints('defender', o.beforeTarget, o.afterTarget, COUNT_MS);
  animatePoints('challenger', o.beforeChallenger, o.afterChallenger, COUNT_MS);
}

// If this strike finished the defender off, the duel is over: the prize has
// already been awarded (see strike()) — this just SHOWS it, reusing the same
// outcome-card component and FX vocabulary as every other strike result, then
// clears the chosen opponent so the attacker can pick a new one.
function maybeAnnounceVictory(o) {
  if (!o.battleWon) return;
  later(() => {
    if (!rootEl) return;
    ctxRef.audio.sfx('fanfare');
    screenVignettePulse();
    outcomeCard('victory', `🏆 ${esc(o.challenger.name).toUpperCase()} WINS THE DUEL!`,
      `${esc(o.target.name)} is defeated — but keeps every point it earned. No points were lost.`,
      `+${o.battleWon.prize} pts to ${esc(o.challenger.name)}`);
    later(() => {
      if (!rootEl) return;
      targetId = null;   // battle over — back to picking a new opponent
      renderDuel();
    }, OUTCOME_MS);
  }, OUTCOME_MS);
}

// =============================================================================
// TEACHER SCORING — same ±10 as before, but a deduction is a real attack so
// shields and relics behave exactly as they do house-vs-house.
// =============================================================================
async function teacherScore(houseId, delta) {
  if (!rootEl || resolving) return;
  const store = ctxRef.store;
  const house = store.HOUSES[houseId];
  if (!house) return;

  // Gate the payout. `resolving` again doubles as the in-flight guard (blocks
  // a second tap here or on a strike button while the pad is up) and the
  // early `if (!rootEl || resolving) return;` above is re-checked below via
  // the explicit `!rootEl` test, since a plain re-entry to this function
  // would otherwise see `resolving` still true and bounce harmlessly anyway.
  resolving = true;
  const ok = await lock.requireUnlock('score this battle');
  resolving = false;
  if (!rootEl) return;   // unmounted while the pad was open
  if (!ok) return;        // refused — nothing moves, retry stays open

  if (delta > 0) {
    store.addPoints(houseId, delta, { reason: 'Battle Day Victory (teacher)', tag: 'battle' });
    ctxRef.audio.sfx('coin');
    // addPoints already re-rendered via subscribe — query the fresh chip.
    spawnFx(rootEl.querySelector(`[data-tchip="${houseId}"]`), 'duel-fx-chip duel-fx-chip-good', 850, `+${delta}`);
    return;
  }

  const result = store.applyAttack({ toId: houseId, amount: -delta, label: 'Battle Day Defeat (teacher)' });
  const chip = rootEl.querySelector(`[data-tchip="${houseId}"]`);
  if (result.outcome === 'blocked') {
    ctxRef.audio.sfx('sword');
    spawnFx(chip, 'duel-fx-chip duel-fx-chip-blue', 850, '🛡️ BLOCKED');
  } else if (result.outcome === 'reduced') {
    ctxRef.audio.sfx('thud');
    flareReduceBadge(houseId);
    spawnFx(chip, 'duel-fx-chip duel-fx-chip-bad', 850, `${-delta} → ${result.applied}`);
  } else {
    ctxRef.audio.sfx('thud');
    spawnFx(chip, 'duel-fx-chip duel-fx-chip-bad', 850, `−${result.applied}`);
  }
}

function endBattle() {
  clearFx();
  if (overlayEl) { overlayEl.remove(); overlayEl = null; }
  const mainEl = document.getElementById('module-root');
  if (mainEl) mainEl.classList.remove('battle-shake');
  renderLanding();
}

// =============================================================================
// Module contract
// =============================================================================
export default {
  id: 'battle',
  title: 'Battle Day',
  icon: '⚔️',
  order: 30,
  showTile: true,

  mount(el, ctx) {
    ctxRef = ctx;
    rootEl = el;
    targetId = null;
    chooserOpen = false;
    resolving = false;
    injectStyles();
    renderLanding();
    unsub = ctx.store.subscribe(() => { if (view === 'duel' && !resolving) renderDuel(); });
  },

  unmount() {
    clearTimers();
    clearFx();
    if (unsub) { unsub(); unsub = null; }
    if (overlayEl) { try { overlayEl.remove(); } catch (e) {} overlayEl = null; }
    const mainEl = document.getElementById('module-root');
    if (mainEl) mainEl.classList.remove('battle-shake');
    rootEl = null;
    ctxRef = null;
    view = 'landing';
    targetId = null;
    chooserOpen = false;
    resolving = false;
  },
};
