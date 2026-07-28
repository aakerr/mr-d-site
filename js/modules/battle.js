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
import { createDiceSim } from './dice3d/sim.js';
// The shared escaper (see escape.js for why there is exactly one). This file
// never distinguished content from attribute positions — escapeHtml covers
// both, aliased to the `esc` name its ~90 call sites already use.
import { escapeHtml as esc } from '../core/escape.js';

const STYLE_ID = 'battle-styles';

// Offensive item kinds a house can use from this screen (HP-mode catalog).
const OFFENSIVE_KINDS = new Set(['attack', 'steal', 'pierce']);

// Sequence timings (ms). Every individual animation stays ≤900ms.
const TRAVEL_MS = 280;   // projectile flight
const IMPACT_MS = 620;   // flash / shake / damage-number lifetime
const COUNT_MS = 450;    // point-total roll
const OUTCOME_MS = 2600; // static outcome caption (text, 250ms pop-in)

// ---- Mr. D's duel rules (combatMode 'duel') — sequence timings ------------
// His five steps play as five beats, each held long enough for a class to
// follow: thrown -> revealed -> countered-or-not -> dice -> points. Beats
// stay short; the dice roll itself (createDiceSim) takes as long as the
// physics needs, on top of these.
const DUEL2_THROW_MS = 900;    // attack item flies across the arena — slow enough to follow
const DUEL2_PRE_ROLL_MS = 500;     // dice sit in the tray a beat before they are thrown
const DUEL2_TALLY_HOLD_MS = 700;   // the ±N sits on the crest before the total moves
const DUEL2_DRAIN_MS = 900;        // a total rolls down (or up) at watchable speed
const DUEL2_RETURN_MS = 800;       // looted points fly back to the attacker's crest
const DUEL2_MATH_STEP_MS = 620;    // one term of the damage sum at a time
const DUEL2_CHARGE_BTN_MS = 620;   // the chosen weapon pulses before anything moves
const DUEL2_CHARGE_CREST_MS = 620; // then the attacker's own crest winds up
const DUEL2_IMPACT_MS = 700;       // the defending card takes the hit
const DUEL2_TOTAL_GROW_MS = 950;   // the damage total swells before it is applied
// Beats between the steps of a strike. Slowed by roughly a third after watching
// a real roll: the whole sequence went by faster than a class could follow, and
// the point of doing it on screen is that thirty people get to see each step
// land. The tray's own tumble was lengthened to match (see ROLL.minRollMs).
const DUEL2_REVEAL_MS = 1250;  // defender's held defense flips face-up
const DUEL2_COUNTER_MS = 2200; // hold on a successful counter — the best moment in his game
const DUEL2_ROLL_HOLD_MS = 1900; // hold on the settled dice total before it's applied
const DUEL2_OUTCOME_HOLD_MS = 2100; // hold on the hit/freeze outcome card before the final tally

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
let strikeCancelled = false;  // End Battle pressed mid-strike — the sequence stands down at its next beat
const timers = new Set();
const fxNodes = new Set();    // transient combat-effect DOM nodes, force-cleaned on unmount

// ---- Mr. D's duel rules — mini shop + dice overlay state -------------------
let miniShopEl = null;        // shop popup, mounted in #overlay-root
let miniShopOpen = false;
let miniShopBuyerId = null;   // which house the popup is buying for
let miniShopBuyInFlight = false;
let diceSim = null;           // live createDiceSim instance, if a roll is mounted
let diceOverlayEl = null;     // dice roll overlay, mounted in #overlay-root

// Pairs ("attackerId:targetId") whose strike has already been thrown and
// resolved THIS Battle Day session — the defender's held defense shows
// face-up on their card from that point on, same as a Stone of Seeing peek
// (store.hasRevealed). This is the local half of that rule: combat itself
// reveals, with no item spent, and store has no flag for that. Cleared with
// store.clearReveals() when Battle Day ends.
const combatRevealed = new Set();
function pairKey(attackerId, targetId) { return `${attackerId}:${targetId}`; }

function later(fn, ms) {
  const id = setTimeout(() => { timers.delete(id); try { fn(); } catch (e) { console.warn('battle:', e); } }, ms);
  timers.add(id);
  return id;
}
function clearTimers() { timers.forEach(clearTimeout); timers.clear(); }
function clearFx() { fxNodes.forEach((n) => { try { n.remove(); } catch (e) {} }); fxNodes.clear(); }
// A timer-based Promise, tracked in `timers` like every other delay in this
// file, so an unmount mid-sequence sweeps it up instead of leaving a dangling
// resolve.
function delay(ms) { return new Promise((resolve) => { later(resolve, ms); }); }

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
  /* The same crossed-swords mark as the dashboard tile and the cinematic —
     one graphic everywhere Battle Day announces itself. max-width:none guards
     against the preflight img rule collapsing it (same trap as the cinematic). */
  .battle-ignite-icon{height:1.25em;width:auto;max-width:none;display:inline-block;
    vertical-align:-0.28em;margin-right:.25em;
    filter:drop-shadow(0 2px 6px rgba(0,0,0,.55));}
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
  /* The Sword of Destiny art replaces the old 🗡️ glyph. Its blade is drawn at
     +45° (up-right), so each img is pre-rotated to point straight UP; the
     span keyframes below then swing them to their final ±45°, exactly as they
     swung the emoji. Sword B is mirrored (scaleX before rotate) so hilt and
     gem face outward on both sides — the pair reads as one symmetric X. */
  /* max-width:none matters: Tailwind's preflight gives every img max-width:100%,
     and inside this shrink-to-fit absolute span that resolves to a collapsed
     zero-height box — the sword simply vanishes without it. */
  .battle-sword img{height:1.15em;width:auto;max-width:none;display:block;transform:rotate(-45deg);}
  .battle-sword-b img{transform:rotate(45deg) scaleX(-1);}
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
  /* FORGED STEEL. The letters carry a blade-metal gradient clipped to the
     glyphs; the old flat pink stays as the pre-clip color so any browser that
     can't clip still shows the original treatment. The red text-shadow reads
     as heat coming off the metal — it draws the glyph silhouette behind the
     transparent fill, which is exactly the underglow wanted here. */
  .battle-stamp{position:absolute;top:40%;left:50%;transform:translate(-50%,-50%);
    display:flex;gap:clamp(4px,.8vw,10px);font-family:'Cinzel',Georgia,serif;
    font-weight:800;font-size:clamp(2rem,6vw,4.5rem);color:#fca5a5;
    text-shadow:0 0 26px rgba(239,68,68,.6),0 4px 10px rgba(0,0,0,.8);}
  .battle-stamp span{display:inline-block;opacity:0;animation:battle-letter-stamp .35s ease both;
    background:linear-gradient(180deg,#ffffff 0%,#e6ebf2 28%,#a7b3c4 47%,#6e7d91 52%,#c2ccd9 70%,#f4f7fb 100%);
    -webkit-background-clip:text;background-clip:text;color:transparent;
    -webkit-text-stroke:1px rgba(15,23,42,.35);}
  /* One light glint sweeps the title just after the swords land — a bright
     band soft-lighted across the stamp box, so it catches the letters without
     needing to clip to them. Runs once. */
  .battle-stamp::after{content:'';position:absolute;inset:-12% -6%;pointer-events:none;
    background:linear-gradient(115deg,transparent 42%,rgba(255,255,255,.9) 50%,transparent 58%);
    mix-blend-mode:soft-light;transform:translateX(-130%);
    animation:battle-glint .9s ease-out 1.7s 1 both;}
  @keyframes battle-glint{to{transform:translateX(130%);}}
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
  /* The same mark inside the (non-flex) duel banner and mini-shop titles. */
  .duel-title .battle-btn-mark,.duel-shop-title .battle-btn-mark{display:inline-block;
    vertical-align:-0.28em;margin-right:.3em;max-width:none;}
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
  /* Duel mode stacks points, crest, name AND two labelled slot rows into one
     card. At 1280x720 that budget does not stretch to a 22vh crest — the
     utility row overflowed the card and collided with the teacher-scoring band
     below it, by 118px. The crest gives way because it is the one part with no
     information in it. On a 1080p board the vh terms give it back. */
  /* Duel mode's top half carries less than hp mode's did — no HP row, no bar —
     so it had slack it was not using. Everything in it goes up about 20% to
     fill the space, scoped to duel so the hp screen is untouched. The maxima
     are what actually bind at 1920 wide, which is why they move most. */
  .duel-root[data-mode="duel"] .duel-crest{height:clamp(77px,14.9vh,246px);}
  .duel-root[data-mode="duel"] .duel-points-val{font-size:clamp(2.9rem,5.5vw,5rem);}
  .duel-root[data-mode="duel"] .duel-points-lbl{font-size:clamp(.86rem,1.32vw,1.14rem);}
  .duel-root[data-mode="duel"] .duel-name{font-size:clamp(1.75rem,3.25vw,2.75rem);}
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
  /* Bigger. It crosses a 1900px board in front of a class — at 2.1rem it was a
     detail you had to already be looking for. */
  .duel-proj{position:fixed;z-index:70;pointer-events:none;font-size:clamp(2.6rem,5.2vh,4.4rem);line-height:1;
    width:76px;height:76px;margin:-38px 0 0 -38px;display:flex;align-items:center;justify-content:center;
    filter:drop-shadow(0 0 18px rgba(253,224,71,.85));
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
  /* ---- the wind-up ----------------------------------------------------------
     A strike used to be instant: tap, and it was already resolving. These give
     it somewhere to build FROM. The chosen weapon pulses first, then the
     attacker's own crest charges — the attack visibly comes off their shield —
     and only then does anything fly. */
  .duel2-slot-charging{animation:duel2-charge-kf .62s ease-in-out 2;
    box-shadow:0 0 0 0 rgba(239,68,68,.6);}
  @keyframes duel2-charge-kf{
    0%{transform:scale(1);box-shadow:0 0 0 0 rgba(239,68,68,.55);}
    50%{transform:scale(1.045);box-shadow:0 0 0 12px rgba(239,68,68,0);}
    100%{transform:scale(1);box-shadow:0 0 0 0 rgba(239,68,68,0);}}
  .duel-crest-charge{animation:duel-crest-charge-kf .78s ease-in-out both;}
  @keyframes duel-crest-charge-kf{
    0%{transform:scale(1);filter:drop-shadow(0 8px 22px rgba(0,0,0,.65));}
    55%{transform:scale(1.13);filter:drop-shadow(0 0 34px var(--side-accent,#ef4444)) brightness(1.25);}
    100%{transform:scale(1);filter:drop-shadow(0 8px 22px rgba(0,0,0,.65));}}
  /* The whole defending card takes the hit, not just its crest. */
  .duel-card-hit{animation:duel-card-hit-kf .72s cubic-bezier(.36,.07,.19,.97) both;}
  @keyframes duel-card-hit-kf{
    0%,100%{transform:translate3d(0,0,0);}
    12%{transform:translate3d(-9px,3px,0);} 26%{transform:translate3d(8px,-3px,0);}
    40%{transform:translate3d(-6px,2px,0);} 55%{transform:translate3d(5px,-2px,0);}
    70%{transform:translate3d(-3px,1px,0);} 85%{transform:translate3d(2px,0,0);}}
  /* The damage total swells before it is taken off the defender. */
  .duel-dice-total.grow{animation:duel-total-grow-kf .85s cubic-bezier(.2,.9,.3,1.2) both;
    display:inline-block;}
  @keyframes duel-total-grow-kf{
    0%{transform:scale(.72);opacity:.35;}
    60%{transform:scale(1.22);opacity:1;}
    100%{transform:scale(1.08);opacity:1;}}
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
  /* The damage number on the crest is the single most important number of the
     round, and at .62s it flew off before anyone read it. This variant pops,
     then HOLDS at full size for most of its life before drifting away. */
  .duel-fx-tally{position:absolute;top:-4%;left:50%;font-family:'Cinzel',Georgia,serif;font-weight:800;
    font-size:clamp(2.9rem,5.4vw,4.6rem);white-space:nowrap;pointer-events:none;z-index:12;
    animation:duel-fx-tally-kf 2.2s cubic-bezier(.2,.9,.3,1) both;}
  .duel-fx-tally-dmg{color:#fca5a5;text-shadow:0 4px 18px rgba(0,0,0,.95),0 0 34px rgba(239,68,68,.85);}
  .duel-fx-tally-gain{color:#86efac;text-shadow:0 4px 18px rgba(0,0,0,.95),0 0 34px rgba(34,197,94,.85);}
  @keyframes duel-fx-tally-kf{
    0%{opacity:0;transform:translate(-50%,14px) scale(.55);}
    12%{opacity:1;transform:translate(-50%,-6px) scale(1.32);}
    22%{opacity:1;transform:translate(-50%,-10px) scale(1.1);}
    76%{opacity:1;transform:translate(-50%,-14px) scale(1.1);}
    100%{opacity:0;transform:translate(-50%,-84px) scale(.94);}
  }
  /* While a total is rolling it wears its direction: red on the way down,
     green on the way up, and back to the house gold the moment it settles. */
  .duel-points-val{transition:color .28s ease,text-shadow .28s ease;}
  .duel-points-val.pts-falling{color:#fca5a5!important;text-shadow:0 0 26px rgba(239,68,68,.6);}
  .duel-points-val.pts-rising{color:#86efac!important;text-shadow:0 0 26px rgba(34,197,94,.6);}

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

  /* ---- Mr. D's rules (combatMode 'duel') --------------------------------- */
  /* defender card: the secret shape, never its contents, until struck */
  .duel-def-hidden{background:rgba(76,29,149,.18);border:1px dashed rgba(167,139,250,.5);color:#c4b5fd;
    justify-content:center;text-align:center;}
  .duel-def-frozen{background:rgba(30,64,175,.2);border:1px solid rgba(96,165,250,.55);color:#bfdbfe;
    justify-content:center;text-align:center;}

  /* the reveal — defender's held defense flips face-up over their crest at
     the moment of the strike, not before */
  .duel-reveal-card{position:absolute;left:50%;top:38%;transform:translate(-50%,-50%);
    display:flex;flex-direction:column;align-items:center;gap:.2rem;
    background:rgba(11,15,25,.95);border:2px solid #a78bfa;border-radius:1rem;
    padding:.6rem 1.1rem;pointer-events:none;z-index:11;text-align:center;
    box-shadow:0 14px 40px rgba(0,0,0,.6),0 0 30px -8px rgba(167,139,250,.6);
    animation:duel-reveal-kf .4s cubic-bezier(.34,1.56,.64,1) both;}
  @keyframes duel-reveal-kf{
    0%{opacity:0;transform:translate(-50%,-50%) rotateY(90deg) scale(.7);}
    55%{opacity:1;}
    100%{opacity:1;transform:translate(-50%,-50%) rotateY(0) scale(1);}
  }
  .duel-reveal-emoji{font-size:clamp(1.8rem,3.4vw,2.6rem);display:block;
    filter:drop-shadow(0 0 14px rgba(167,139,250,.6));}
  .duel-reveal-name{font-family:'Cinzel',Georgia,serif;font-weight:800;color:#ddd6fe;
    font-size:clamp(.78rem,1.5vw,.95rem);white-space:nowrap;}

  /* dice overlay — his rule #4: the damage dice roll live, on screen */
  .duel-dice-overlay{position:fixed;inset:0;z-index:80;overflow:hidden;
    background:rgba(7,9,18,.6);-webkit-backdrop-filter:blur(10px) saturate(115%);
    backdrop-filter:blur(10px) saturate(115%);display:flex;align-items:center;
    justify-content:center;animation:battle-curtain .18s ease-out both;}
  /* Bigger. This is the moment the whole room is watching — at 720px it read
     like a tooltip over the board rather than an event on it. */
  .duel-dice-stage{display:flex;flex-direction:column;align-items:center;gap:1.1rem;
    width:min(1180px,94vw);max-height:94vh;padding:0 1rem;}
  .duel-dice-title{font-weight:800;color:#fca5a5;text-align:center;line-height:1.2;
    font-size:clamp(1.3rem,3vw,2.3rem);text-shadow:0 0 22px rgba(239,68,68,.5);}
  .duel-dice-frame{position:relative;width:100%;aspect-ratio:16/9;border-radius:1.25rem;
    overflow:hidden;box-shadow:0 24px 70px rgba(0,0,0,.65);background:rgba(0,0,0,.35);
    border:1px solid rgba(239,68,68,.35);}
  .duel-dice-host{position:absolute;inset:0;}
  /* The tray must not move when the sum arrives. "Rolling..." is one short line
     and the finished math is a huge number plus a caption, so the stage — which
     is centred — used to grow underneath and shove the dice frame 22px up just
     as the class looked at it. The box reserves its FINAL height from the moment
     the overlay opens, built from the same clamps the terms use, and centres
     whatever is in it. Measured shift after: 0px. */
  .duel-dice-total{position:relative;text-align:center;color:#e5e7eb;font-weight:700;
    line-height:1.3;font-size:clamp(1.05rem,2.2vw,1.6rem);opacity:0;transition:opacity .3s ease;
    min-height:calc(clamp(2.6rem,6.4vw,4.6rem) * 1.15 + clamp(.7rem,1.4vw,1rem) * 1.3 + .35rem);
    display:flex;flex-direction:column;align-items:center;justify-content:center;}
  .duel-dice-total.show{opacity:1;}
  .duel-dice-parts{color:#9ca3af;margin-right:.5rem;}
  .duel-dice-num{font-family:'Cinzel',Georgia,serif;font-weight:800;color:#fde68a;
    font-size:clamp(2rem,5vw,3.2rem);text-shadow:0 0 24px rgba(253,230,138,.6);}

  /* THE MATH. The multiplier used to appear only on the outcome card, after the
     dice had already gone — so the class saw a roll of 12 and then, on a
     different screen, a number 100x bigger with no shown connection. It is now
     built up a term at a time on the tray itself: the faces, the sum, the
     multiplier, and finally the damage. Each term is laid out in the flow from
     the start (hidden, not absent) so nothing shifts sideways as it fills in. */
  .duel-dice-math{display:flex;flex-wrap:wrap;align-items:baseline;justify-content:center;
    gap:.1em .38em;font-family:'Cinzel',Georgia,serif;font-weight:800;line-height:1.15;}
  .duel-dice-math > *{opacity:0;transform:translateY(8px) scale(.9);
    transition:opacity .3s ease,transform .3s cubic-bezier(.2,.9,.3,1.3);}
  .duel-dice-math > .in{opacity:1;transform:none;}
  .dm-faces{color:#9ca3af;font-size:clamp(1.2rem,2.6vw,2rem);font-weight:700;}
  .dm-op{color:#6b7280;font-size:clamp(1.1rem,2.2vw,1.7rem);}
  .dm-sum{color:#fde68a;font-size:clamp(1.9rem,4.4vw,3rem);text-shadow:0 0 22px rgba(253,230,138,.55);}
  .dm-mult{color:#c4b5fd;font-size:clamp(1.4rem,3vw,2.2rem);text-shadow:0 0 20px rgba(167,139,250,.5);}
  .dm-final{color:#fca5a5;font-size:clamp(2.6rem,6.4vw,4.6rem);
    text-shadow:0 4px 18px rgba(0,0,0,.9),0 0 38px rgba(239,68,68,.7);}
  .dm-final.gain{color:#86efac;text-shadow:0 4px 18px rgba(0,0,0,.9),0 0 38px rgba(34,197,94,.7);}
  .dm-final.chill{color:#93c5fd;text-shadow:0 4px 18px rgba(0,0,0,.9),0 0 38px rgba(59,130,246,.7);}
  .dm-final.punch{animation:dm-punch-kf .9s cubic-bezier(.2,.9,.3,1.25) both;}
  @keyframes dm-punch-kf{
    0%{transform:scale(.45);}55%{transform:scale(1.3);}75%{transform:scale(1.12);}100%{transform:scale(1.18);}
  }
  .duel-dice-caption{margin-top:.35rem;font-family:'Cinzel',Georgia,serif;font-weight:700;
    letter-spacing:.16em;font-size:clamp(.7rem,1.4vw,1rem);color:#9ca3af;
    opacity:0;transition:opacity .3s ease;}
  .duel-dice-caption.in{opacity:1;}
  /* Out of flow: it only appears when a roll overshoots what the defender owns,
     and it must not resize the box it sits in. */
  .dm-capped{position:absolute;top:100%;left:0;right:0;margin-top:.15rem;
    color:#fbbf24;font-weight:700;font-family:'Plus Jakarta Sans',system-ui,sans-serif;
    font-size:clamp(.72rem,1.4vw,1rem);letter-spacing:.02em;}

  /* second-target chooser — only the Catapult reaches this today, but it keys
     off effect.targets so any item the teacher gives two targets gets it too */
  .duel-two-overlay{position:fixed;inset:0;z-index:78;background:rgba(7,9,18,.78);
    display:flex;align-items:center;justify-content:center;padding:clamp(.75rem,3vw,2rem);
    animation:battle-curtain .18s ease-out both;}
  .duel-two-modal{width:min(560px,100%);max-height:92vh;overflow-y:auto;background:#141225;
    border:2px solid #f59e0b;border-radius:1.5rem;padding:clamp(1rem,2.4vw,1.75rem);
    box-shadow:0 24px 70px rgba(0,0,0,.7),0 0 60px rgba(245,158,11,.22);}
  .duel-two-title{font-family:'Cinzel',Georgia,serif;font-weight:800;color:#fbbf24;
    text-align:center;font-size:clamp(1.2rem,2.6vw,1.8rem);line-height:1.2;}
  .duel-two-sub{text-align:center;color:#d1d5db;font-size:clamp(.8rem,1.5vw,1rem);
    margin:.4rem 0 .9rem;line-height:1.45;}
  .duel-two-cancel{width:100%;margin-top:.8rem;min-height:46px;border-radius:.8rem;
    border:1px solid #374151;background:#1f2937;color:#d1d5db;font-weight:700;cursor:pointer;}
  .duel-two-cancel:hover{background:#374151;}

  /* mini shop — buy without leaving Battle Day */
  /* A raised Shroud is a condition, not an item in a slot — it gets its own
     look so nobody tries to spend it twice. */
  .duel2-util-active{border-color:rgba(148,163,184,.7)!important;
    background:linear-gradient(180deg,rgba(100,116,139,.28),rgba(51,65,85,.18))!important;}
  .duel2-util-active .duel2-util-state{color:#cbd5e1;font-weight:800;}

  .duel-shop-overlay{position:fixed;inset:0;z-index:75;background:rgba(7,9,18,.72);
    display:flex;align-items:center;justify-content:center;padding:clamp(.75rem,3vw,2rem);
    animation:battle-curtain .18s ease-out both;overflow-y:auto;}
  .duel-shop-modal{position:relative;width:min(980px,100%);max-height:92vh;overflow-y:auto;
    background:#141225;border:2px solid #a855f7;border-radius:1.5rem;
    padding:clamp(1rem,2.4vw,1.75rem);box-shadow:0 24px 70px rgba(0,0,0,.7),0 0 60px rgba(168,85,247,.25);}
  .duel-shop-close{position:absolute;top:.7rem;right:.7rem;min-width:36px;min-height:36px;
    border-radius:.6rem;border:1px solid #4b5563;background:#1f2937;color:#e5e7eb;
    font-weight:800;cursor:pointer;touch-action:manipulation;}
  .duel-shop-title{font-family:'Cinzel',Georgia,serif;font-weight:800;color:#e9d5ff;
    text-align:center;font-size:clamp(1.2rem,2.6vw,1.7rem);margin-bottom:.9rem;}
  .duel-shop-houses{display:grid;grid-template-columns:repeat(auto-fit,minmax(150px,1fr));
    gap:.6rem;margin-bottom:1rem;}
  .duel-shop-house{display:flex;flex-direction:column;align-items:center;gap:.2rem;
    border-radius:.9rem;border:2px solid var(--pick-accent,#374151);background:#111827;
    padding:.55rem .5rem;cursor:pointer;touch-action:manipulation;
    transition:transform .12s ease,filter .15s ease;}
  .duel-shop-house:hover{filter:brightness(1.14);}
  .duel-shop-house:active{transform:scale(.97);}
  .duel-shop-house-active{box-shadow:0 0 0 3px var(--pick-accent,#a855f7);}
  .duel-shop-house-crest{width:36px;height:36px;object-fit:contain;}
  .duel-shop-house-name{font-weight:800;font-size:.82rem;color:var(--pick-accent,#f9fafb);
    overflow:hidden;text-overflow:ellipsis;white-space:nowrap;max-width:100%;}
  .duel-shop-house-pts{font-size:.72rem;color:#fde68a;font-variant-numeric:tabular-nums;}
  .duel-shop-grid{display:grid;grid-template-columns:repeat(auto-fill,minmax(230px,1fr));gap:.75rem;}
  .duel-shop-item{display:flex;flex-direction:column;gap:.3rem;border-radius:1rem;
    border:1px solid #374151;background:#111827;padding:.7rem .8rem;}
  .duel-shop-item-head{display:flex;align-items:center;gap:.5rem;}
  .duel-shop-item-emoji{font-size:1.7rem;flex-shrink:0;}
  .duel-shop-item-name-wrap{flex:1;min-width:0;}
  .duel-shop-item-name{font-weight:800;font-size:.9rem;color:#f9fafb;line-height:1.2;}
  .duel-shop-item-held{font-weight:700;font-size:.68rem;color:#c4b5fd;white-space:nowrap;}
  .duel-shop-item-slot{font-size:.62rem;font-weight:700;letter-spacing:.08em;color:#9ca3af;margin-top:.1rem;}
  .duel-shop-item-cost{flex-shrink:0;font-weight:800;font-size:.82rem;color:#1e1b3a;
    background:#fde68a;border-radius:999px;padding:.2rem .55rem;white-space:nowrap;}
  .duel-shop-item-desc{font-size:.76rem;color:#d1d5db;line-height:1.35;flex:1;}
  .duel-shop-buy{min-height:38px;border-radius:.7rem;border:none;font-weight:800;font-size:.85rem;
    cursor:pointer;touch-action:manipulation;background:linear-gradient(135deg,#a855f7,#7e22ce);
    color:#fff;transition:transform .12s ease,filter .15s ease;}
  .duel-shop-buy:hover:not(:disabled){filter:brightness(1.12);}
  .duel-shop-buy:active:not(:disabled){transform:scale(.96);}
  .duel-shop-buy:disabled{opacity:.45;cursor:not-allowed;background:#374151;}
  .duel-shop-item-reason{font-size:.7rem;font-weight:700;color:#f87171;line-height:1.3;}

  /* ---- fixed item-slot cards (duel mode redesign) -------------------------
     Points sit directly above the crest now (no HP row in this mode), and
     item holdings render as two FIXED rows — item slots, then utility slots
     — every cell always drawn (filled / empty / locked) so the row COUNT
     never changes. Fixed heights + line-clamped text mean the card's total
     height cannot move when a house buys, spends, or loses an item; the
     attacker and defender cards use the exact same cell classes, so they
     measure identically by construction, the same way the rest of this file
     mirrors the two sides. */
  /* The identity block (points, crest, name) takes the slack; the slots sit at
     the BOTTOM of the card, which is where he asked for them and is also what
     stops a tall card leaving dead space under them. margin-top:auto on the
     first slot label pushes everything after it down. */
  /* THE CARD IS A 60/40 SPLIT. Identity on top — role, points, crest, name —
     and the slots below. Fixed shares rather than content-driven heights,
     because the slots were sized by clamp() and ended up too small to read
     while the top half kept space it did not need.
     Everything in the bottom half sizes to ITS share: the slot rows are
     flex:1 1 0 and the buttons fill their row, so the buttons get whatever the
     40% leaves after the two labels. On a 1080p board that is roughly double
     what the old fixed clamp gave them. */
  .duel2-top{flex:0 0 60%;min-height:0;display:flex;flex-direction:column;
    align-items:center;justify-content:flex-start;gap:.2rem;width:100%;}
  /* The role reads as a HEADER for the card rather than a caption above it:
     full width, ruled off, and set in the same face as the house name at a size
     just below it (28px against the name's 37px on a 1080p board) so the two
     sit in an obvious hierarchy instead of one whispering. */
  .duel2-top .duel-role{width:100%;flex:0 0 auto;
    font-family:'Cinzel',Georgia,serif;font-size:clamp(.95rem,2.6vh,2rem);
    letter-spacing:.12em;opacity:1;text-align:center;
    padding-bottom:clamp(3px,.7vh,10px);
    border-bottom:1px solid rgba(255,255,255,.14);
    margin-bottom:clamp(2px,.6vh,10px);}
  /* Points, crest and name share whatever the header leaves, centred in it, so
     the header sits at the top of the card and the identity stays optically
     centred in the rest. */
  .duel2-top .duel-points-lbl{margin-top:auto;}
  .duel2-top .duel-name{margin-bottom:auto;}
  .duel2-bottom{flex:0 0 40%;min-height:0;width:100%;display:flex;
    flex-direction:column;gap:.15rem;}
  .duel2-bottom .duel-section-lbl{flex:0 0 auto;}
  .duel2-bottom .duel2-slots-row{flex:1 1 0;min-height:0;}
  .duel2-bottom .duel2-util-row{flex:1 1 0;min-height:0;}
  .duel2-bottom .duel2-slot,
  .duel2-bottom .duel2-util-slot{height:100%;min-height:0;}
  /* Breathing room under the utility row. It was sitting hard against the card's
     bottom edge, which read as an overlap even where nothing actually
     overflowed. */
  .duel2-util-row{margin-bottom:clamp(4px,0.9vh,12px);}
  .duel2-slots-row{width:100%;display:grid;grid-template-columns:1fr 1fr;gap:.5rem;}
  .duel2-util-row{width:100%;display:grid;grid-template-columns:1fr 1fr 1fr;gap:.4rem;}
  .duel2-slot{position:relative;height:clamp(40px,5.9vh,84px);border-radius:.9rem;
    display:flex;flex-direction:column;align-items:center;justify-content:center;
    gap:.1rem;text-align:center;padding:.22rem .35rem;overflow:hidden;box-sizing:border-box;
    border:2px solid #4b5563;background:#111827;}
    /* Type scales with the slot now. The 60/40 split roughly doubled the
     button height, but the text was still sized for the old 64px slot and
     that is what made it unreadable across a classroom. */
  .duel2-slot-emoji{font-size:clamp(1rem,2.4vh,2.4rem);line-height:1;}
    /* flex:0 0 auto is load-bearing. The ATTACK slot carries a damage line the
     defense slot does not, so with everything shrinkable the name — the one
     thing you have to read to know which weapon it is — was the part that gave,
     collapsing to 1px while the emoji kept its full 24. Measured, not guessed:
     the defender's name rendered at 14px and the attacker's at 1px. */
  .duel2-slot-name{flex:0 0 auto;font-weight:800;font-size:clamp(.72rem,1.85vh,1.4rem);line-height:1.15;color:#f9fafb;
    overflow:hidden;display:-webkit-box;-webkit-line-clamp:2;-webkit-box-orient:vertical;}
    /* Row, not column. At the shorter slot height the badge and the damage
     stacked needed 35px and the slot had 64 to hold everything — so the bottom
     was clipped. Side by side they take 18px and nothing has to be removed to
     fit: "Attack · 2d6 x 100" reads as one line. */
  .duel2-slot-meta{display:flex;flex-direction:row;gap:.35rem;align-items:center;
    justify-content:center;flex-wrap:wrap;}
  .duel2-slot-dmg{font-size:clamp(.62rem,1.55vh,1.2rem);font-weight:800;color:#fca5a5;}
  .duel2-slot-kind{font-size:clamp(.56rem,1.35vh,1.05rem);font-weight:700;letter-spacing:.04em;color:#c4b5fd;
    background:rgba(167,139,250,.14);border:1px solid rgba(167,139,250,.35);
    border-radius:999px;padding:.05rem .4rem;white-space:nowrap;}
  .duel2-slot-reason{position:absolute;bottom:.3rem;left:.3rem;right:.3rem;
    font-size:.6rem;font-weight:700;color:#f87171;line-height:1.15;overflow:hidden;
    text-overflow:ellipsis;white-space:nowrap;}
  button.duel2-slot{cursor:pointer;touch-action:manipulation;font:inherit;
    transition:transform .12s ease,border-color .15s ease,filter .15s ease;}
  button.duel2-slot:hover:not(:disabled){border-color:#ef4444;filter:brightness(1.12);}
  button.duel2-slot:active:not(:disabled){transform:scale(.97);}
  button.duel2-slot:disabled{opacity:.55;cursor:not-allowed;filter:grayscale(.35);}
  .duel2-slot-locked{border-style:dashed;border-color:#4b5563;background:rgba(17,24,39,.5);}
  .duel2-slot-lock{font-size:1.3rem;opacity:.8;}
  .duel2-slot-lock-label{font-size:.64rem;font-weight:700;color:#9ca3af;line-height:1.2;}
  .duel2-slot-empty{border-style:dashed;}
  .duel2-slot-empty-label{font-size:.72rem;font-weight:700;font-style:italic;color:#6b7280;}
  .duel2-slot-hidden{border-color:rgba(167,139,250,.5);background:rgba(76,29,149,.16);}
  .duel2-slot-hidden-emoji{font-size:1.6rem;}
  .duel2-slot-hidden-label{font-size:.72rem;font-weight:800;color:#c4b5fd;}
  .duel2-slot-revealed{border-color:rgba(96,165,250,.6);background:rgba(30,64,175,.16);}

  .duel2-util-slot{height:clamp(46px,6.4vh,94px);border-radius:.75rem;border:1px solid #374151;
    background:#111827;display:flex;flex-direction:column;align-items:center;justify-content:center;
    gap:.1rem;text-align:center;padding:.3rem .2rem;overflow:hidden;box-sizing:border-box;}
  .duel2-util-emoji{font-size:clamp(.85rem,1.9vh,1.8rem);line-height:1;}
  .duel2-util-name{font-size:clamp(.6rem,1.55vh,1.2rem);font-weight:800;color:#e5e7eb;line-height:1.1;
    overflow:hidden;text-overflow:ellipsis;white-space:nowrap;max-width:100%;}
  .duel2-util-state{font-size:clamp(.56rem,1.3vh,1.05rem);font-weight:700;color:#9ca3af;}
  .duel2-util-empty{opacity:.5;}
  .duel2-util-held{border-color:rgba(253,230,138,.4);}
  button.duel2-util-slot{font:inherit;}
  button.duel2-util-interactive{cursor:pointer;touch-action:manipulation;
    transition:transform .12s ease,border-color .15s ease,filter .15s ease;}
  button.duel2-util-interactive:hover:not(:disabled){border-color:#a78bfa;filter:brightness(1.15);}
  button.duel2-util-interactive:active:not(:disabled){transform:scale(.96);}
  button.duel2-util-interactive:not(:disabled) .duel2-util-state{color:#c4b5fd;font-weight:800;}
  button.duel2-util-interactive:disabled{cursor:not-allowed;}

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
    .duel-fx-dmg,.duel-fx-tally,.duel-fx-chip,.duel-outcome,.duel-toast,.duel-reduce-flare,
    .duel-reveal-card,.duel-dice-overlay,.duel-shop-overlay,
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
      <button type="button" class="battle-ignite-btn font-display"><img class="battle-ignite-icon" src="images/icon-battle.png" alt=""> BATTLE DAY!</button>
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
  // week's fight. Mr. D's duel rules (combatMode 'duel') don't use hit
  // points at all — this is HP-mode-only housekeeping.
  if (ctxRef.store.getCombatMode() === 'hp') ctxRef.store.resetAllHp();

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
      <span class="battle-sword battle-sword-a"><img src="images/shop/sword-of-destiny.png" alt=""></span>
      <span class="battle-sword battle-sword-b"><img src="images/shop/sword-of-destiny.png" alt=""></span>
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
      ${housePickHtml(store, others, 'data-pick-target', { showDefenses: false, attackerId: challenger.id })}
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

// Dispatches to whichever ruleset is active. HP mode (renderHpDuel) is the
// original screen, left untouched below. 'duel' is Mr. D's own rules
// (renderMrDDuel), built alongside it — see the STORE API note at the top of
// this file's task brief for why the two never share a render path.
function renderDuel() {
  if (!rootEl || resolving) return;
  if (ctxRef.store.getCombatMode() === 'duel') renderMrDDuel();
  else renderHpDuel();
}

function renderHpDuel() {
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
          <div class="duel-title font-display"><img class="battle-btn-mark" src="images/icon-battle.png" alt="" onerror="this.style.display='none'" />BATTLE DAY — CHOOSE YOUR OPPONENT</div>
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

  wireHpDuel();
}

// =============================================================================
// DUEL VIEW — wiring (HP mode)
// =============================================================================
function wireHpDuel() {
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
    btn.addEventListener('click', () => strikeHp(btn.getAttribute('data-strike-item')));
  });

  rootEl.querySelectorAll('[data-teacher]').forEach((btn) => {
    btn.addEventListener('click', () => {
      teacherScore(Number(btn.getAttribute('data-house')), Number(btn.getAttribute('data-teacher')));
    });
  });
}

// =============================================================================
// DUEL VIEW — markup (Mr. D's rules, combatMode 'duel')
// =============================================================================
// His five steps, in order: (1) attacker picks a held ATTACK item, (2) the
// defender's held DEFENSE item is revealed — hidden until this moment,
// (3) a correct counter cancels the attack outright, (4) otherwise the
// damage dice are rolled live and read aloud, (5) the points move. No hit
// points here — a duel-mode strike moves POINTS directly via
// store.applyDuelAttack, same as store.previewDuelAttack already previews.

function kindTagDuel(kind) {
  return { damage: 'Attack', steal: 'Steal', freeze: 'Freeze' }[kind] || kind;
}

// ---- fixed item-slot cards --------------------------------------------------
// Redesigned layout: no HP in this mode, so points move up above the crest,
// and item holdings render as a FIXED grid — 2 item slots, then 3 utility
// slots — always all of them, whether filled, empty, or locked. That is what
// keeps a card's height constant whatever a house happens to be holding: the
// slot COUNT never changes, only what's drawn inside each one. See .duel2-slot
// in the styles for the fixed heights this depends on.
const UTILITY_ITEM_IDS = ['stone', 'shroud', 'timeturner'];

// Expands getInventory's { item, count } rows into one entry per physically
// held copy, e.g. two Swords -> [swordItem, swordItem] — each occupies its
// own slot, independently strikeable.
function heldSlotInstances(store, houseId, slot) {
  const flat = [];
  store.getInventory(houseId)
    .filter((row) => row.item && row.item.slot === slot)
    .forEach(({ item, count }) => { for (let i = 0; i < count; i += 1) flat.push(item); });
  return flat;
}

function lockedSlotHtml(slotLabel) {
  return `<div class="duel2-slot duel2-slot-locked">
    <span class="duel2-slot-lock">🔒</span>
    <span class="duel2-slot-lock-label">Bag of Holding unlocks this ${esc(slotLabel)} slot</span>
  </div>`;
}

// One attack-slot cell on the attacker's card: locked (no 2nd slot without
// the Bag of Holding), empty, or holding an item ready to strike with.
function attackSlotHtml(item, unlocked, target, frozen) {
  if (!unlocked) return lockedSlotHtml('attack');
  if (!item) return `<div class="duel2-slot duel2-slot-empty"><span class="duel2-slot-empty-label">Empty attack slot</span></div>`;
  const kind = item.effect.kind;
  const dice = item.effect.dice || '1d6';
  const mult = Math.max(1, Number(item.effect.mult) || 1);
  const dmgText = kind === 'freeze' ? `${dice} days frozen` : mult > 1 ? `${dice} × ${mult}` : dice;
  const disabled = !target || frozen;
  const reason = frozen ? '❄️ Frozen' : (!target ? '🎯 Choose an opponent' : '');
  return `
    <button type="button" class="duel2-slot duel2-slot-filled" data-strike-item="${esc(item.id)}" ${disabled ? 'disabled' : ''}
      title="${esc(item.desc || item.name)}">
      <span class="duel2-slot-emoji">${esc(item.emoji || '⚔️')}</span>
      <span class="duel2-slot-name">${esc(item.name)}</span>
      <span class="duel2-slot-meta">
        <span class="duel2-slot-kind">${esc(kindTagDuel(kind))}</span>
        <span class="duel2-slot-dmg">${esc(dmgText)}</span>
      </span>
      ${reason ? `<span class="duel2-slot-reason">${esc(reason)}</span>` : ''}
    </button>`;
}

// One defense-slot cell on the defender's card: locked, a secret (the normal
// state — his rule #2), or revealed — either because a Stone of Seeing
// peeked it (store.hasRevealed) or because a strike against THIS attacker has
// already landed this session (combatRevealed). Revealed always shows what
// is actually held right now, live, not a stale snapshot from the moment it
// was revealed.
function defenseSlotHtml(item, unlocked, revealed) {
  if (!unlocked) return lockedSlotHtml('defense');
  if (!revealed) {
    return `<div class="duel2-slot duel2-slot-hidden">
      <span class="duel2-slot-hidden-emoji">🎭</span>
      <span class="duel2-slot-hidden-label">Hidden</span>
    </div>`;
  }
  if (!item) {
    return `<div class="duel2-slot duel2-slot-revealed duel2-slot-empty"><span class="duel2-slot-empty-label">Undefended</span></div>`;
  }
  return `<div class="duel2-slot duel2-slot-revealed">
    <span class="duel2-slot-emoji">${esc(item.emoji || '🛡️')}</span>
    <span class="duel2-slot-name">${esc(item.name)}</span>
    <span class="duel2-slot-kind">Defense</span>
  </div>`;
}

// One utility slot (Stone of Seeing / Shroud of Secrecy / Time Turner):
// plain "held or not held" for every house, except the attacker's OWN Stone
// slot, which is clickable — see peekWithStone.
function utilitySlotHtml(store, houseId, itemId, interactiveOpts) {
  const catalogItem = store.getShopItems().find((i) => i.id === itemId);
  const emoji = (catalogItem && catalogItem.emoji) || '✨';
  const name = (catalogItem && catalogItem.name) || itemId;
  const held = store.countOwned(houseId, itemId);
  if (!held) {
    return `<div class="duel2-util-slot duel2-util-empty">
      <span class="duel2-util-emoji">${esc(emoji)}</span>
      <span class="duel2-util-name">${esc(name)}</span>
      <span class="duel2-util-state">Not held</span>
    </div>`;
  }
  const heldLabel = held > 1 ? `×${held} held` : 'Held';
  if (interactiveOpts) {
    // `state` is what the slot SAYS when it can be used ("Tap to peek"), and
    // falls back to the plain held count when it cannot — a button that offers
    // an action it will then refuse is worse than one that just shows a count.
    return `<button type="button" class="duel2-util-slot duel2-util-held duel2-util-interactive"
        ${interactiveOpts.attr || 'data-stone-peek'}
        ${interactiveOpts.enabled ? '' : 'disabled'} title="${esc(interactiveOpts.title || '')}">
      <span class="duel2-util-emoji">${esc(emoji)}</span>
      <span class="duel2-util-name">${esc(name)}</span>
      <span class="duel2-util-state">${esc(interactiveOpts.enabled ? (interactiveOpts.state || 'Tap to use') : heldLabel)}</span>
    </button>`;
  }
  return `<div class="duel2-util-slot duel2-util-held">
    <span class="duel2-util-emoji">${esc(emoji)}</span>
    <span class="duel2-util-name">${esc(name)}</span>
    <span class="duel2-util-state">${esc(heldLabel)}</span>
  </div>`;
}

// An ACTIVE shroud is not an item any more — it is a condition. It gets its own
// chip so a house that has already raised one cannot be sold the idea of
// raising another, and so the class can see it is up.
function shroudSlotHtml(store, houseId) {
  const cat = store.getShopItems().find((i) => i.id === 'shroud');
  const emoji = (cat && cat.emoji) || '🌫️';
  const name = (cat && cat.name) || 'The Shroud of Secrecy';
  if (store.isShrouded(houseId)) {
    const ts = store.shroudedUntil(houseId);
    const until = ts ? new Date(ts).toLocaleDateString(undefined, { weekday: 'short', month: 'short', day: 'numeric' }) : '';
    return `<div class="duel2-util-slot duel2-util-held duel2-util-active" title="No Stone of Seeing can look at this house until then">
      <span class="duel2-util-emoji">${esc(emoji)}</span>
      <span class="duel2-util-name">${esc(name)}</span>
      <span class="duel2-util-state">🌫️ Up${until ? ` until ${esc(until)}` : ''}</span>
    </div>`;
  }
  const held = store.countOwned(houseId, 'shroud');
  return utilitySlotHtml(store, houseId, 'shroud', held ? {
    attr: `data-raise-shroud="${Number(houseId)}"`, enabled: true, state: 'Tap to raise',
    title: 'Raise the Shroud — no Stone of Seeing can look at this house for a week',
  } : null);
}

// The Time Turner can only be offered when there is something to take back.
function timeTurnerSlotHtml(store, houseId) {
  const held = store.countOwned(houseId, 'timeturner');
  if (!held) return utilitySlotHtml(store, houseId, 'timeturner', null);
  const gate = store.canTimeTurn(houseId);
  const last = store.lastStrikeOn(houseId);
  return utilitySlotHtml(store, houseId, 'timeturner', {
    attr: `data-time-turn="${Number(houseId)}"`,
    enabled: !!gate.ok,
    state: 'Tap to undo',
    title: gate.ok
      ? `Take back ${last && last.itemName ? last.itemName : 'the last attack'} on this house`
      : (gate.reason || 'Nothing to take back yet'),
  });
}

function utilityRowHtml(store, houseId, stoneOpts) {
  return `<div class="duel2-util-row">
    ${utilitySlotHtml(store, houseId, 'stone', stoneOpts)}
    ${shroudSlotHtml(store, houseId)}
    ${timeTurnerSlotHtml(store, houseId)}
  </div>`;
}

// Points ABOVE the crest — duel mode has no hit points, so this is the whole
// "head" of the card. Reuses the same points-block/crest/name partials as
// HP mode so the two rulesets read as the same family, just laid out to its
// own spec.
function duelCardHeadHtml(store, house, side) {
  return `${pointsBlockHtml(store, house, side)}${crestHtml(house, side)}<div class="duel-name">${esc(house.name)}</div>`;
}

function attackerCardHtmlDuel(store, challenger, target) {
  const limits = store.duelSlotLimits(challenger.id);
  const held = heldSlotInstances(store, challenger.id, 'attack');
  const frozen = store.isFrozen(challenger.id);
  const slots = [0, 1].map((i) => attackSlotHtml(held[i] || null, limits.attack >= i + 1, target, frozen)).join('');
  const revealedAlready = !!target && (store.hasRevealed(challenger.id, target.id) || combatRevealed.has(pairKey(challenger.id, target.id)));
  const stoneEnabled = !!target && store.countOwned(challenger.id, 'stone') > 0 && !revealedAlready;
  const stoneTitle = !target ? 'Choose an opponent first'
    : revealedAlready ? `${target.name}'s defense is already revealed`
    : `Peek at ${target.name}'s held items`;
  return `
    <section class="duel-side duel-side-attacker" style="--side-accent:${esc(challenger.accent)}">
      <div class="duel2-top">
        <div class="duel-role">⚔️ Attacker</div>
        ${duelCardHeadHtml(store, challenger, 'challenger')}
      </div>
      <div class="duel2-bottom">
        <div class="duel-section-lbl">Attack slots${frozen ? ' — ❄️ frozen' : ''}</div>
        <div class="duel2-slots-row">${slots}</div>
        <div class="duel-section-lbl">Utility</div>
        ${utilityRowHtml(store, challenger.id, { enabled: stoneEnabled, title: stoneTitle })}
      </div>
    </section>`;
}

// The defender's held defense stays a secret here — his rule #2 says it is
// revealed only at the moment of the strike, so this card shows the shape of
// that secret (a locked/hidden slot) rather than its contents, until a Stone
// of Seeing or a landed strike reveals it for real.
function defenderCardHtmlDuel(store, target, challenger) {
  const limits = store.duelSlotLimits(target.id);
  const held = heldSlotInstances(store, target.id, 'defense');
  const frozen = store.isFrozen(target.id);
  const revealed = !!challenger && (store.hasRevealed(challenger.id, target.id) || combatRevealed.has(pairKey(challenger.id, target.id)));
  const slots = [0, 1].map((i) => defenseSlotHtml(held[i] || null, limits.defense >= i + 1, revealed)).join('');
  return `
    <section class="duel-side duel-side-defender" style="--side-accent:${esc(target.accent)}">
      <div class="duel2-top">
        <div class="duel-role">🛡️ Defender</div>
        ${duelCardHeadHtml(store, target, 'defender')}
      </div>
      <div class="duel2-bottom">
        <div class="duel-section-lbl">Defense slots${frozen ? ' — ❄️ frozen' : ''}</div>
        <div class="duel2-slots-row">${slots}</div>
        <div class="duel-section-lbl">Utility</div>
        ${utilityRowHtml(store, target.id)}
      </div>
    </section>`;
}

function targetPickerHtmlDuel(store, challenger) {
  const others = Object.values(store.HOUSES).filter((h) => h.id !== challenger.id);
  return `
    <section class="duel-side" style="--side-accent:#4b5563">
      <div class="duel-role">🎯 Choose an opponent</div>
      <div class="duel-pick-prompt">Who does ${esc(challenger.name)} attack?</div>
      <div class="duel-pick-hint">Their defense stays secret until the strike lands.</div>
      ${housePickHtml(store, others, 'data-pick-target', { showDefenses: false, attackerId: challenger.id })}
    </section>`;
}

function renderMrDDuel() {
  if (!rootEl || resolving) return;
  view = 'duel';
  const store = ctxRef.store;
  const challenger = challengerHouse();

  if (challenger && targetId === challenger.id) targetId = null;
  const target = targetId != null ? store.HOUSES[targetId] : null;

  const showChooser = !challenger || chooserOpen;
  const leftHtml = showChooser ? chooserHtml(store) : attackerCardHtmlDuel(store, challenger, target);
  const rightHtml = showChooser ? `<section class="duel-side" style="--side-accent:#374151">
      <div class="duel-role">🛡️ Defender</div>
      <div class="duel-pick-hint">Waiting for an attacker&hellip;</div>
    </section>`
    : (target ? defenderCardHtmlDuel(store, target, challenger) : targetPickerHtmlDuel(store, challenger));

  rootEl.innerHTML = `
    <div class="duel-root" data-mode="duel">
      <div class="battle-embers">${emberField()}</div>
      <div class="duel-topbar">
        <div class="duel-topbar-inner">
          <div class="duel-title font-display"><img class="battle-btn-mark" src="images/icon-battle.png" alt="" onerror="this.style.display='none'" />BATTLE DAY — CHOOSE YOUR OPPONENT</div>
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

  wireMrDDuel();
}

// =============================================================================
// DUEL VIEW — wiring (Mr. D's rules)
// =============================================================================
function wireMrDDuel() {
  if (!rootEl) return;
  const store = ctxRef.store;

  const shopBtn = rootEl.querySelector('.battle-shop-btn');
  if (shopBtn) shopBtn.addEventListener('click', openMiniShop);
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
    btn.addEventListener('click', () => strikeDuel(btn.getAttribute('data-strike-item')));
  });

  const stoneBtn = rootEl.querySelector('[data-stone-peek]');
  if (stoneBtn) stoneBtn.addEventListener('click', peekWithStone);

  // Both cards carry a utility row, so these are scoped by house id rather
  // than by which side of the board they happen to be on.
  rootEl.querySelectorAll('[data-raise-shroud]').forEach((btn) => {
    btn.addEventListener('click', () => raiseShroudFor(Number(btn.getAttribute('data-raise-shroud'))));
  });
  rootEl.querySelectorAll('[data-time-turn]').forEach((btn) => {
    btn.addEventListener('click', () => timeTurnFor(Number(btn.getAttribute('data-time-turn'))));
  });

  rootEl.querySelectorAll('[data-teacher]').forEach((btn) => {
    btn.addEventListener('click', () => {
      teacherScore(Number(btn.getAttribute('data-house')), Number(btn.getAttribute('data-teacher')));
    });
  });
}

// The Stone of Seeing: spent to look at what a house is holding. Only the
// attacker's own Stone slot is clickable (see utilitySlotHtml) — this reveals
// the CURRENT target's defense on their card, live, from here on (persisted
// by store.hasRevealed, same "stays revealed" guarantee the store gives the
// Battle-Day-long combatRevealed set below it).
async function peekWithStone() {
  if (!rootEl || resolving) return;
  const store = ctxRef.store;
  const challenger = challengerHouse();
  const target = targetId != null ? store.HOUSES[targetId] : null;
  if (!challenger || !target) return;
  if (store.countOwned(challenger.id, 'stone') < 1) return;
  if (store.hasRevealed(challenger.id, target.id) || combatRevealed.has(pairKey(challenger.id, target.id))) return;

  resolving = true;
  const ok = await lock.requireUnlock('use this item');
  if (!rootEl) { resolving = false; return; }
  if (!ok) { resolving = false; return; }

  const result = store.peekHouse(challenger.id, target.id);
  resolving = false;
  if (!rootEl) return;
  renderDuel();
  if (!result.ok) { toast(result.reason || 'The Stone of Seeing found nothing.'); return; }
  ctxRef.audio.sfx('coin');
  if (result.shrouded) toast(`🌫️ ${target.name} is shrouded — the Stone shows nothing (still spent).`);
}

// The Shroud of Secrecy: spent to put a house out of sight for a week. Nothing
// visible happens to THEM — the effect is entirely on other houses' Stones,
// which is exactly why the slot has to say plainly that it is up, and until
// when, or a class has no way to know 500 points bought anything.
async function raiseShroudFor(houseId) {
  if (!rootEl || resolving) return;
  const store = ctxRef.store;
  const house = store.HOUSES[houseId];
  if (!house || store.isShrouded(houseId)) return;
  if (store.countOwned(houseId, 'shroud') < 1) return;

  resolving = true;
  const ok = await lock.requireUnlock('use this item');
  if (!rootEl) { resolving = false; return; }
  if (!ok) { resolving = false; return; }

  const result = store.raiseShroud(houseId);
  resolving = false;
  if (!rootEl) return;
  renderDuel();
  if (!result.ok) { toast(result.reason || 'The Shroud could not be raised.'); return; }
  ctxRef.audio.sfx('coin');
  const until = result.until
    ? new Date(result.until).toLocaleDateString(undefined, { weekday: 'long', month: 'short', day: 'numeric' })
    : 'next week';
  toast(`🌫️ ${house.name} is shrouded until ${until}. No Stone of Seeing can look at them.`);
}

// The Time Turner: spent to take back the last attack that landed on a house.
// The undo DELETES the strike's ledger entries rather than paying compensation,
// so the history reads as though it never happened.
async function timeTurnFor(houseId) {
  if (!rootEl || resolving) return;
  const store = ctxRef.store;
  const house = store.HOUSES[houseId];
  if (!house) return;
  const gate = store.canTimeTurn(houseId);
  if (!gate.ok) { toast(gate.reason || 'There is nothing to take back.'); return; }

  resolving = true;
  const ok = await lock.requireUnlock('use this item');
  if (!rootEl) { resolving = false; return; }
  if (!ok) { resolving = false; return; }

  const before = store.getTotal(houseId, 'term');
  const result = store.useTimeTurner(houseId);
  resolving = false;
  if (!rootEl) return;
  renderDuel();
  if (!result.ok) { toast(result.reason || 'The Time Turner could not be used.'); return; }
  ctxRef.audio.sfx('coin');

  // Roll the restored points back up on whichever card this house is showing on,
  // so the undo is watched rather than merely announced.
  const side = challengerHouse() && challengerHouse().id === houseId ? 'challenger'
    : (targetId === houseId ? 'defender' : null);
  if (side && !prefersReducedMotion()) {
    const crest = rootEl.querySelector(`[data-crest="${side}"]`);
    if (crest && result.restored > 0) spawnFx(crest, 'duel-fx-tally duel-fx-tally-gain', 2200, `+${result.restored}`);
    animatePoints(side, before, store.getTotal(houseId, 'term'), DUEL2_DRAIN_MS);
  }
  const bits = [];
  if (result.restored > 0) bits.push(`${result.restored} points came back`);
  if (result.unfroze) bits.push('the freeze is lifted');
  toast(`⏳ ${house.name} turned back time — ${bits.join(' and ') || 'the attack never happened'}.`);
}

// =============================================================================
// MINI SHOP — buy without leaving Battle Day. Same spend path the Magic Shop
// itself uses (store.purchase + store.addToInventory), gated by
// store.duelCanBuy so the weekly slot limits are honoured here too.
// =============================================================================
function closeMiniShop() {
  if (miniShopEl) { try { miniShopEl.remove(); } catch (e) {} fxNodes.delete(miniShopEl); miniShopEl = null; }
  miniShopOpen = false;
}

function openMiniShop() {
  if (!rootEl || resolving) return;
  const store = ctxRef.store;
  const challenger = challengerHouse();
  miniShopBuyerId = challenger ? challenger.id : Number(Object.keys(store.HOUSES)[0]);
  miniShopOpen = true;
  renderMiniShop();
}

function renderMiniShop() {
  if (!miniShopOpen) return;
  const host = document.getElementById('overlay-root');
  if (!host) return;
  if (miniShopEl) { try { miniShopEl.remove(); } catch (e) {} fxNodes.delete(miniShopEl); miniShopEl = null; }

  const store = ctxRef.store;
  const houses = Object.values(store.HOUSES);
  const buyer = store.HOUSES[miniShopBuyerId] || houses[0];
  const items = store.getShopItems();
  const buyerPts = store.getTotal(buyer.id, 'term');

  miniShopEl = document.createElement('div');
  miniShopEl.className = 'duel-shop-overlay';
  miniShopEl.innerHTML = `
    <div class="duel-shop-modal">
      <button type="button" class="duel-shop-close" data-shop-close aria-label="Close the shop">✕</button>
      <div class="duel-shop-title font-display"><img class="battle-btn-mark" src="images/icon-market.png" alt="" onerror="this.style.display='none'" />Magic Shop</div>
      <div class="duel-shop-houses">
        ${houses.map((h) => `
          <button type="button" class="duel-shop-house${h.id === buyer.id ? ' duel-shop-house-active' : ''}"
            data-shop-house="${h.id}" style="--pick-accent:${esc(h.accent)}">
            ${houseImg(h, 'duel-shop-house-crest')}
            <span class="duel-shop-house-name">${esc(h.name)}</span>
            <b class="duel-shop-house-pts">${store.getTotal(h.id, 'term')} pts</b>
          </button>`).join('')}
      </div>
      <div class="duel-shop-grid">
        ${items.map((item) => {
          const gate = store.duelCanBuy(buyer.id, item.id);
          const held = store.countOwned(buyer.id, item.id);
          const afford = buyerPts >= item.cost;
          const disabled = !gate.ok || !afford;
          const why = !gate.ok ? gate.reason : (!afford ? 'Not enough points.' : '');
          return `
          <div class="duel-shop-item">
            <div class="duel-shop-item-head">
              <span class="duel-shop-item-emoji">${esc(item.emoji || '✨')}</span>
              <div class="duel-shop-item-name-wrap">
                <div class="duel-shop-item-name">${esc(item.name)}${held ? ` <span class="duel-shop-item-held">×${held} held</span>` : ''}</div>
                <div class="duel-shop-item-slot">${esc((item.slot || 'utility').toUpperCase())}</div>
              </div>
              <div class="duel-shop-item-cost">${item.cost} pts</div>
            </div>
            <div class="duel-shop-item-desc">${esc(item.desc || '')}</div>
            <button type="button" class="duel-shop-buy" data-shop-buy="${esc(item.id)}" ${disabled ? 'disabled' : ''}>
              ${gate.ok ? (afford ? 'Buy' : 'Not enough points') : 'Slot full'}
            </button>
            ${why ? `<div class="duel-shop-item-reason">🚫 ${esc(why)}</div>` : ''}
          </div>`;
        }).join('')}
      </div>
    </div>`;
  host.appendChild(miniShopEl);
  fxNodes.add(miniShopEl);
  wireMiniShop();
}

function wireMiniShop() {
  if (!miniShopEl) return;
  const closeBtn = miniShopEl.querySelector('[data-shop-close]');
  if (closeBtn) closeBtn.addEventListener('click', closeMiniShop);
  miniShopEl.addEventListener('click', (e) => { if (e.target === miniShopEl) closeMiniShop(); });

  miniShopEl.querySelectorAll('[data-shop-house]').forEach((btn) => {
    btn.addEventListener('click', () => {
      miniShopBuyerId = Number(btn.getAttribute('data-shop-house'));
      renderMiniShop();
    });
  });
  miniShopEl.querySelectorAll('[data-shop-buy]').forEach((btn) => {
    btn.addEventListener('click', () => buyMiniShopItem(btn.getAttribute('data-shop-buy')));
  });
}

// The arena's own toast sits at z-index 72 and the mini-shop overlay at 75 —
// a refusal spoken down there would be invisible behind the modal the buyer
// is actually looking at. Park the same toast inside the overlay instead
// (fixed-position children stack within it, so it rides on top).
function miniShopToast(text) {
  if (!miniShopEl) { toast(text); return; }
  const existing = miniShopEl.querySelector('.duel-toast');
  if (existing) existing.remove();
  const el = document.createElement('div');
  el.className = 'duel-toast';
  el.textContent = text;
  miniShopEl.appendChild(el);
  later(() => { try { el.remove(); } catch (e) {} }, 2200);
}

async function buyMiniShopItem(itemId) {
  if (miniShopBuyInFlight || !miniShopOpen) return;
  const store = ctxRef.store;
  const item = store.getShopItems().find((i) => i.id === itemId);
  const buyerId = miniShopBuyerId;
  if (!item || buyerId == null) return;
  const gate = store.duelCanBuy(buyerId, item.id);
  // A refusal has to be SAID — a tap that just repaints the shop reads as a
  // broken button, and the store's reason is written to be read out.
  if (!gate.ok) { renderMiniShop(); miniShopToast(gate.reason || 'That cannot be bought right now.'); return; }

  // Same gate the Magic Shop itself uses before spending a house's points.
  miniShopBuyInFlight = true;
  try {
    const allowed = await lock.requireUnlock('buy this item');
    if (!miniShopOpen) return;              // popup closed while the PIN pad was open
    if (!allowed) return;                    // refused — no charge

    const ok = store.purchase(buyerId, item.cost, item.name);
    if (!ok) {
      // purchase only says no when the points on the button went stale —
      // the total changed under the shop. The re-render fixes the numbers;
      // this says why nothing was bought.
      renderMiniShop();
      const held = store.getTotal(buyerId, 'term');
      miniShopToast(`${store.HOUSES[buyerId]?.name || 'That house'} holds ${held} pts now — ${item.name} costs ${item.cost}. Nothing was bought.`);
      return;
    }
    store.addToInventory(buyerId, item.id);
    ctxRef.audio.sfx('coin');
    renderMiniShop();
  } finally {
    miniShopBuyInFlight = false;
  }
}

// =============================================================================
// DICE OVERLAY — a real roll, on screen, before any points move.
// The tray handles 1d6, 2d6, 3d6 and d20 natively, so every duel item rolls in
// a single throw with all of its dice in the air at once.
// Anything else a teacher might type (parseDice falls back gracefully) still
// gets an honest uniform roll, just without a 3D die to show for it.
// =============================================================================
function closeDiceOverlay() {
  if (diceSim) { try { diceSim.dispose(); } catch (e) { console.warn('battle: dice dispose failed', e); } diceSim = null; }
  if (diceOverlayEl) { try { diceOverlayEl.remove(); } catch (e) {} fxNodes.delete(diceOverlayEl); diceOverlayEl = null; }
}

function plainRoll(n, sides) {
  let total = 0; const rolls = [];
  for (let i = 0; i < n; i += 1) { const v = 1 + Math.floor(Math.random() * sides); rolls.push(v); total += v; }
  return { total, rolls };
}

// Rolls `item`'s dice for `house`, live on screen, and resolves with the
// total the class watched land. Never rolled in software and animated as
// something else — this total is what gets passed to applyDuelAttack.
// Resolves null when the roll was CANCELLED under it (the overlay torn down
// by unmount or End Battle mid-tumble) — the caller must treat that as "no
// strike", never as a roll of zero.
async function rollItemDice(item, house, cap = null) {
  const store = ctxRef.store;
  const { n, sides } = store.parseDice(item.effect.dice);
  const host = document.getElementById('overlay-root');
  if (!host) {
    console.warn('battle: no #overlay-root — rolling without the 3D dice');
    return { ...plainRoll(n, sides), label: item.effect.dice || '1d6' };
  }

  diceOverlayEl = document.createElement('div');
  diceOverlayEl.className = 'duel-dice-overlay';
  diceOverlayEl.innerHTML = `
    <div class="duel-dice-stage">
      <div class="duel-dice-title font-display">${esc(item.emoji || '🎲')} ${esc(item.name)} — rolling&hellip;</div>
      <div class="duel-dice-frame"><div class="duel-dice-host"></div></div>
      <div class="duel-dice-total" data-dice-total>Rolling&hellip;</div>
    </div>`;
  host.appendChild(diceOverlayEl);
  fxNodes.add(diceOverlayEl);
  const diceHost = diceOverlayEl.querySelector('.duel-dice-host');
  const totalEl = diceOverlayEl.querySelector('[data-dice-total]');
  totalEl.classList.add('show');

  try {
        // Half the default die size. The Die of Destiny's tray is the whole screen;
    // this overlay is a panel, and dice tuned for the former filled the latter.
    // fate:false because this is real damage, not the weighted classroom roll.
    diceSim = createDiceSim({ container: diceHost, audio: ctxRef.audio, fate: false, dieScale: 1.5 });
    diceSim.setHouse(house);
  } catch (e) {
    console.warn('battle: could not start the 3D dice, using a plain roll instead', e);
    closeDiceOverlay();
    return { ...plainRoll(n, sides), label: item.effect.dice || '1d6' };
  }

  // The overlay used to arrive and throw in the same frame, so the dice were
  // already tumbling before anyone had found them on the board. Let them sit in
  // the tray for a beat first — the room looks at the dice, THEN they go.
  if (!prefersReducedMotion()) await delay(DUEL2_PRE_ROLL_MS);
  // Gone during the beat means closeDiceOverlay ran under us (unmount or End
  // Battle) — that is a cancellation, not a cue to roll invisible dice.
  if (!diceSim) return null;

  let rolls = [];
  let label = `${n}d${sides}`;
  try {
    if (sides === 6 && n >= 1 && n <= 3) {
      // 1d6, 2d6 and 3d6 are all real tray modes now — every die leaves the
      // hand together. 3d6 used to roll as 2d6 then a lone d6, which split the
      // loudest moment of his game into two beats.
      // A null result is the sim disposed mid-roll (see sim.dispose) — cancel.
      const results = await diceSim.roll(`${n}d6`);
      if (results == null) { closeDiceOverlay(); return null; }
      rolls = results.map((r) => r.value);
    } else if (sides === 20 && n === 1) {
      const results = await diceSim.roll('d20');
      if (results == null) { closeDiceOverlay(); return null; }
      rolls = results.map((r) => r.value);
    } else {
      // Not a shape the 3D sim can physically render (e.g. a teacher-edited
      // spec like "4d6") — still an honest uniform roll, just without dice.
      rolls = plainRoll(n, sides).rolls;
    }
  } catch (e) {
    console.warn('battle: dice roll did not settle, using a plain draw instead', e);
    rolls = plainRoll(n, sides).rolls;
  }

  const total = rolls.reduce((a, b) => a + b, 0);
  const kind = item.effect?.kind;
  const mult = Math.max(1, Number(item.effect?.mult) || 1);
  const isFreeze = kind === 'freeze';
  // The freeze rolls DAYS, so there is no multiplier and nothing to cap.
  const raw = isFreeze ? total : total * mult;
  const landed = isFreeze ? raw : (cap == null ? raw : Math.min(raw, Math.max(0, cap)));

  if (diceOverlayEl) {
    // Every term is in the DOM from the start, hidden — revealing them one at a
    // time by adding a class means the row is already its final width, so the
    // sum does not slide sideways as the multiplier arrives.
    const finalClass = isFreeze ? 'chill' : (kind === 'steal' ? 'gain' : '');
    const caption = isFreeze ? 'DAYS FROZEN' : (kind === 'steal' ? 'POINTS STOLEN' : 'DAMAGE');
    const terms = [`<span class="dm-faces">${esc(rolls.join('  +  '))}</span>`];
    if (rolls.length > 1) terms.push('<span class="dm-op">=</span>', `<span class="dm-sum">${total}</span>`);
    if (!isFreeze && mult > 1) terms.push('<span class="dm-op">×</span>', `<span class="dm-mult">${mult}</span>`);
    const needsFinal = terms.length > 1;
    if (needsFinal) terms.push('<span class="dm-op">=</span>');
    terms.push(`<span class="dm-final ${finalClass}">${landed}</span>`);
    const cappedNote = (!isFreeze && landed < raw)
      ? `<div class="dm-capped">${raw} rolled — but that is all they have left</div>` : '';

    totalEl.innerHTML = `<div class="duel-dice-math">${terms.join('')}</div>
      <div class="duel-dice-caption">${caption}</div>${cappedNote}`;

    const steps = [...totalEl.querySelectorAll('.duel-dice-math > *')];
    const finalEl = totalEl.querySelector('.dm-final');
    const capEl = totalEl.querySelector('.dm-capped');
    if (capEl) capEl.style.opacity = '0';

    if (prefersReducedMotion()) {
      steps.forEach((el) => el.classList.add('in'));
      totalEl.querySelector('.duel-dice-caption')?.classList.add('in');
      if (capEl) capEl.style.opacity = '1';
    } else {
      // Faces first, then each operator with the term it introduces, so the row
      // reads as a sentence being spoken rather than a formula appearing.
      for (let i = 0; i < steps.length; i += 1) {
        const el = steps[i];
        const isFinalTerm = el === finalEl;
        el.classList.add('in');
        if (isFinalTerm) {
          el.classList.add('punch');
          ctxRef.audio.sfx('coin');
          totalEl.querySelector('.duel-dice-caption')?.classList.add('in');
          if (capEl) capEl.style.transition = 'opacity .4s ease', capEl.style.opacity = '1';
        }
        // Operators are punctuation — they land with the term after them.
        const pause = el.classList.contains('dm-op') ? 140 : DUEL2_MATH_STEP_MS;
        await delay(isFinalTerm ? DUEL2_TOTAL_GROW_MS : pause);
        if (!diceOverlayEl) break;
      }
    }
    if (diceOverlayEl) await delay(DUEL2_ROLL_HOLD_MS);
  }
  closeDiceOverlay();
  return { total, rolls, label, landed, raw };
}

// =============================================================================
// THE STRIKE (Mr. D's rules) — his five steps, one beat at a time:
//   1. attack thrown  2. defense revealed  3. countered or not
//   4. dice rolled (only if not countered)  5. points applied
// =============================================================================
async function resolveDuelSequence(challenger, target, item, preview, second = null) {
  const store = ctxRef.store;
  const beforeChallenger = store.getTotal(challenger.id, 'term');
  const beforeTarget = store.getTotal(target.id, 'term');
  const reduced = prefersReducedMotion();
  const travel = reduced ? 0 : DUEL2_THROW_MS;
  // Checked at every beat. Before the first applyDuelAttack a cancellation
  // calls the whole strike off — nothing spent, nothing struck. After it the
  // strike is committed and only the remaining ceremony is skipped.
  const aborted = () => !rootEl || strikeCancelled;

  const chalCrest = rootEl.querySelector('[data-crest="challenger"]');
  const defCrest = rootEl.querySelector('[data-crest="defender"]');

  // Step 0 — THE WIND-UP. A strike used to begin resolving on the tap itself,
  // which left a class no moment to lean in. The chosen weapon pulses, then the
  // attacker's crest charges, so the attack visibly gathers on their shield
  // before anything crosses the arena.
  if (!reduced) {
    const btn = [...rootEl.querySelectorAll('button.duel2-slot')]
      .find((b) => b.getAttribute('data-strike-item') === item.id);
    if (btn) {
      btn.classList.add('duel2-slot-charging');
      later(() => btn.classList.remove('duel2-slot-charging'), DUEL2_CHARGE_BTN_MS + 200);
    }
    await delay(DUEL2_CHARGE_BTN_MS);
    if (aborted()) { closeDiceOverlay(); return; }
    if (chalCrest) {
      chalCrest.classList.remove('duel-crest-charge'); void chalCrest.offsetWidth;
      chalCrest.classList.add('duel-crest-charge');
      later(() => chalCrest.classList.remove('duel-crest-charge'), DUEL2_CHARGE_CREST_MS + 200);
    }
    await delay(DUEL2_CHARGE_CREST_MS);
    if (aborted()) { closeDiceOverlay(); return; }
  }

  // Step 1 — the attack crosses, slowly enough to watch, and lands ON the
  // defender's shield: their crest takes the hit and the whole card rocks.
  ctxRef.audio.sfx('sword');
  if (!reduced) spawnProjectile(chalCrest, defCrest, { emoji: item.emoji || '⚔️', travel });
  await delay(travel);
  if (aborted()) { closeDiceOverlay(); return; }
  if (!reduced) {
    if (defCrest) {
      defCrest.classList.remove('duel-crest-shake'); void defCrest.offsetWidth;
      defCrest.classList.add('duel-crest-shake');
      later(() => defCrest.classList.remove('duel-crest-shake'), 700);
      spawnFx(defCrest, 'duel-fx-ring', IMPACT_MS);
    }
    ctxRef.audio.sfx('thud');
    await delay(DUEL2_IMPACT_MS);
    if (aborted()) { closeDiceOverlay(); return; }
  }

  // Step 2 — the defender's held defense is revealed. Hidden until now: this
  // shows whichever item actually decides the outcome (blockedBy when it
  // counters, otherwise whatever they're holding), never a spoiler in advance.
  const revealed = preview.blocked ? preview.blockedBy : preview.defenseHeld;
  // From here on their defense card shows what's ACTUALLY held, live — the
  // fixed-slot card checks this same set (see defenderCardHtmlDuel).
  combatRevealed.add(pairKey(challenger.id, target.id));
  const revealHost = rootEl.querySelector('[data-crest="defender"]')?.closest('.duel-side');
  if (revealHost) {
    spawnFxHtml(revealHost, 'duel-reveal-card', DUEL2_REVEAL_MS + 400, revealed
      ? `<span class="duel-reveal-emoji">${esc(revealed.emoji || '🛡️')}</span><span class="duel-reveal-name">${esc(revealed.name)}</span>`
      : `<span class="duel-reveal-emoji">💥</span><span class="duel-reveal-name">Undefended!</span>`);
  }
  ctxRef.audio.sfx('coin');
  await delay(DUEL2_REVEAL_MS);
  if (aborted()) { closeDiceOverlay(); return; }

  // Set once the totals have already been rolled in step 5, so the final beat
  // knows not to pin them back and replay the same count a second time.
  let pointsRolled = false;

  // Step 3 — the counter check. A correct counter cancels the attack
  // completely: no damage, no dice. This is the best moment in his game, so
  // it gets the biggest treatment on screen: a screen shake, a blue flash and
  // ring on the defender's crest, and a dedicated outcome card — the same
  // "something big just happened" language as a direct hit, just in blue.
  if (preview.blocked) {
    store.applyDuelAttack({ attackerId: challenger.id, targetId: target.id, itemId: item.id, rolled: 0 });
    const mainEl = document.getElementById('module-root');
    if (mainEl && !reduced) {
      mainEl.classList.remove('battle-shake'); void mainEl.offsetWidth; mainEl.classList.add('battle-shake');
      later(() => mainEl.classList.remove('battle-shake'), 550);
    }
    const crest = rootEl.querySelector('[data-crest="defender"]');
    if (crest && !reduced) {
      spawnFx(crest, 'duel-fx-ring', IMPACT_MS);
      spawnFx(crest, 'duel-fx-flash duel-fx-flash-blue', 500);
    }
    ctxRef.audio.sfx('sword');
    screenVignettePulse();
    outcomeCard('blocked', '🛡️ COUNTERED!',
      `${esc(target.name)}'s ${esc(revealed ? revealed.name : 'defense')} stopped ${esc(challenger.name)}'s ${esc(item.name)} cold.`,
      `No damage, no dice`);
    await delay(DUEL2_COUNTER_MS);
  } else {
    // Step 4 — not countered: the damage dice roll live, on screen.
    // Pass the defender's purse so the tray can show what will actually be taken
    // rather than a number the zero floor is about to trim behind the scenes.
    const roll = await rollItemDice(item, challenger, store.getTotal(target.id, 'term'));
    // A null roll was cancelled under us — nothing applies, the item stays in
    // the armoury (applyDuelAttack is the only thing that spends it and it
    // never runs), and strikeDuel's finally resets `resolving`.
    if (!roll || aborted()) return;

    // Step 5 — the points are applied, using the exact total the class watched land.
    const out = store.applyDuelAttack({ attackerId: challenger.id, targetId: target.id, itemId: item.id, rolled: roll.total });
    // From this line the strike is COMMITTED — points moved, item spent. A
    // cancellation from here on only skips ceremony, and the second house of
    // a two-target item must still take its hit before we stand down, or an
    // End Battle press would half-land the strike.
    let secondDone = false;
    const applySecond = () => {
      if (!second || secondDone) return null;
      secondDone = true;
      // The second house's defense resolves publicly the moment this lands —
      // the whole room sees whether it countered. Mark the pair revealed the
      // same way the first target was in step 2, so their card shows what is
      // actually held instead of staying "Hidden" after the redraw. Done here,
      // inside the closure, so every path that lands the hit (ceremony or an
      // End Battle abort) reveals it.
      combatRevealed.add(pairKey(challenger.id, second.id));
      return store.applyDuelAttack({
        attackerId: challenger.id, targetId: second.id, itemId: item.id, rolled: roll.total, consume: false });
    };
    const crest = rootEl.querySelector('[data-crest="defender"]');
    const isFreeze = item.effect.kind === 'freeze';
    if (crest && !reduced) {
      spawnFx(crest, `duel-fx-flash duel-fx-flash-${isFreeze ? 'amber' : 'red'}`, 500);
      shakeCrest(crest);
    }
    ctxRef.audio.sfx('thud');
    screenVignettePulse();

    if (isFreeze) {
      spawnFx(crest, 'duel-fx-dmg', IMPACT_MS, `❄️ ${out.frozenDays}d`);
      outcomeCard('reduced', '❄️ FROZEN!',
        `${esc(target.name)} cannot earn points for ${out.frozenDays} school day${out.frozenDays === 1 ? '' : 's'} — weekends do not count.`, '');
    } else {
      const stealNote = item.effect.kind === 'steal' ? ` ${esc(challenger.name)} looted <b>${out.stolen} pts</b>.` : '';
      // No math line any more — the tray built the sum up a term at a time and
      // the class watched it. Restating it here just competed with the tally.
      outcomeCard('hit', '💥 DIRECT HIT!',
        `${esc(challenger.name)} struck ${esc(target.name)} with ${esc(item.name)}.${stealNote}`, '');

      // THE TALLY. The damage lands on the crest as a big red −N, holds long
      // enough to actually be read, and only then does the defender's total
      // start draining underneath it. Nothing has re-rendered since the strike
      // began (renderDuel is gated on `resolving`), so the number on screen is
      // still the pre-strike one and can simply be rolled to its new value.
      pointsRolled = true;
      spawnFx(crest, 'duel-fx-tally duel-fx-tally-dmg', 2200, `−${out.damage}`);
      await delay(DUEL2_TALLY_HOLD_MS);
      if (aborted()) { applySecond(); return; }
      // The defending card rocks WHILE its total comes down, so the shake and
      // the falling number read as one event rather than two.
      const defCard = crest ? crest.closest('.duel-side') : null;
      if (defCard && !reduced) {
        defCard.classList.remove('duel-card-hit'); void defCard.offsetWidth;
        defCard.classList.add('duel-card-hit');
        later(() => defCard.classList.remove('duel-card-hit'), DUEL2_IMPACT_MS + 200);
      }
      animatePoints('defender', beforeTarget, store.getTotal(target.id, 'term'), DUEL2_DRAIN_MS);
      await delay(DUEL2_DRAIN_MS + 200);
      if (aborted()) { applySecond(); return; }

      // A steal is not damage — the points go SOMEWHERE. So the item flies back
      // the way it came, and the attacker's crest gets the mirror of what the
      // defender just took: a green +N, then their own total climbing.
      const gained = store.getTotal(challenger.id, 'term') - beforeChallenger;
      if (gained > 0) {
        const chalCrest = rootEl.querySelector('[data-crest="challenger"]');
        if (crest && chalCrest && !reduced) {
          spawnProjectile(crest, chalCrest, { emoji: item.emoji || '⚔️', travel: DUEL2_RETURN_MS });
          await delay(DUEL2_RETURN_MS);
          if (aborted()) { applySecond(); return; }
          ctxRef.audio.sfx('coin');
          shakeCrest(chalCrest);
        }
        if (chalCrest) spawnFx(chalCrest, 'duel-fx-tally duel-fx-tally-gain', 2200, `+${gained}`);
        await delay(DUEL2_TALLY_HOLD_MS);
        if (aborted()) { applySecond(); return; }
        animatePoints('challenger', beforeChallenger, beforeChallenger + gained, DUEL2_DRAIN_MS);
        await delay(DUEL2_DRAIN_MS + 200);
        if (aborted()) { applySecond(); return; }
      }

      // THE SECOND HOUSE. One roll, two victims — re-rolling would double a
      // sequence that already runs a dozen seconds, and "3d6 x 100 each" reads
      // fine as both houses taking the same hit. They are struck one at a time:
      // the defender card simply becomes the second house, so the screen never
      // has to hold two defenders at once.
      if (second) {
        await delay(700);
        if (aborted()) { applySecond(); return; }
        targetId = second.id;
        resolving = false; renderDuel(); resolving = true;   // swap the defender card
        if (!rootEl) return;
        await delay(600);
        if (aborted()) { applySecond(); return; }

        const chalCrest2 = rootEl.querySelector('[data-crest="challenger"]');
        const crest2 = rootEl.querySelector('[data-crest="defender"]');
        const before2 = store.getTotal(second.id, 'term');
        if (chalCrest2 && crest2 && !reduced) {
          spawnProjectile(chalCrest2, crest2, { emoji: item.emoji || '⚔️', travel: DUEL2_THROW_MS });
          await delay(DUEL2_THROW_MS);
          if (aborted()) { applySecond(); return; }
        }
        // Its own block check — the second house's defenses are its own.
        // What they hold is captured BEFORE the hit resolves: a correct
        // counter is consumed by applyDuelAttack, and the reveal card must
        // show the item that decided the outcome, not the empty slot it
        // left behind.
        const heldDef2 = store.getInventory(second.id)
          .map(({ item: it }) => it).find((it) => it.slot === 'defense') || null;
        const out2 = applySecond();
        // Step 2 again, for the second house: their defense is revealed at
        // the moment of the strike, with the same card the first defender got
        // — resolving it silently left the class guessing what just happened.
        const revealed2 = out2.blocked ? out2.blockedBy : heldDef2;
        const revealHost2 = crest2 ? crest2.closest('.duel-side') : null;
        if (revealHost2) {
          spawnFxHtml(revealHost2, 'duel-reveal-card', DUEL2_REVEAL_MS + 400, revealed2
            ? `<span class="duel-reveal-emoji">${esc(revealed2.emoji || '🛡️')}</span><span class="duel-reveal-name">${esc(revealed2.name)}</span>`
            : `<span class="duel-reveal-emoji">💥</span><span class="duel-reveal-name">Undefended!</span>`);
          ctxRef.audio.sfx('coin');
          await delay(DUEL2_REVEAL_MS);
        }
        if (crest2 && !reduced) {
          spawnFx(crest2, `duel-fx-flash duel-fx-flash-${out2.blocked ? 'blue' : 'red'}`, 500);
          shakeCrest(crest2);
        }
        ctxRef.audio.sfx(out2.blocked ? 'sword' : 'thud');
        screenVignettePulse();
        if (out2.blocked) {
          outcomeCard('blocked', '🛡️ COUNTERED!',
            `${esc(second.name)}'s ${esc(out2.blockedBy?.name || 'defense')} stopped it.`, '');
          await delay(DUEL2_COUNTER_MS);
        } else {
          outcomeCard('hit', '💥 AND ' + esc(second.name.toUpperCase()) + '!',
            `${esc(item.name)} lands on ${esc(second.name)} as well.`, '');
          spawnFx(crest2, 'duel-fx-tally duel-fx-tally-dmg', 2200, `−${out2.damage}`);
          await delay(DUEL2_TALLY_HOLD_MS);
          if (aborted()) return;   // second already landed — only ceremony remains
          const defCard2 = crest2 ? crest2.closest('.duel-side') : null;
          if (defCard2 && !reduced) {
            defCard2.classList.remove('duel-card-hit'); void defCard2.offsetWidth;
            defCard2.classList.add('duel-card-hit');
            later(() => defCard2.classList.remove('duel-card-hit'), DUEL2_IMPACT_MS + 200);
          }
          animatePoints('defender', before2, store.getTotal(second.id, 'term'), DUEL2_DRAIN_MS);
          await delay(DUEL2_DRAIN_MS + 200);
          if (aborted()) return;
        }
      }
    }
    await delay(pointsRolled ? DUEL2_OUTCOME_HOLD_MS - 900 : DUEL2_OUTCOME_HOLD_MS);
  }
  // Cancelled here means End Battle already painted the landing screen — the
  // strike (and any second house) is fully landed, so just stay off the stage.
  if (aborted()) return;

  // Final beat — resolving flips false HERE, before the redraw, so
  // renderDuel() (guarded by `resolving`, like every render in this file)
  // is actually allowed to run. One clean redraw with the final state, then
  // the point totals are pinned back to their pre-strike values and rolled
  // forward — the same "watch it move" convention as the HP-mode strike.
  resolving = false;
  renderDuel();
  const afterChallenger = store.getTotal(challenger.id, 'term');
  const afterTarget = store.getTotal(target.id, 'term');
  if (pointsRolled) return;   // step 5 already walked both totals to their new values
  const chalEl = rootEl.querySelector('[data-points="challenger"]');
  if (chalEl) chalEl.textContent = String(beforeChallenger);
  const defEl = rootEl.querySelector('[data-points="defender"]');
  if (defEl) defEl.textContent = String(beforeTarget);
  animatePoints('challenger', beforeChallenger, afterChallenger, COUNT_MS);
  animatePoints('defender', beforeTarget, afterTarget, COUNT_MS);
}

// Asks which SECOND house a multi-target item also hits. Resolves to a house id,
// or null if the teacher backs out — backing out must cost nothing, because this
// runs before the weapon is spent.
function pickSecondTarget(store, challenger, firstTarget, item) {
  return new Promise((resolve) => {
    const host = document.getElementById('overlay-root') || document.body;
    const others = Object.values(store.HOUSES)
      .filter((h) => h.id !== challenger.id && h.id !== firstTarget.id);
    const el = document.createElement('div');
    el.className = 'duel-two-overlay';
    el.innerHTML = `
      <div class="duel-two-modal" role="dialog" aria-modal="true" aria-label="Choose the second house">
        <div class="duel-two-title">${esc(item.emoji || '🪨')} ${esc(item.name)} hits TWO houses</div>
        <div class="duel-two-sub">${esc(challenger.name)} has already aimed at <b>${esc(firstTarget.name)}</b>.
          Who else does it hit? They are struck one at a time.</div>
        ${housePickHtml(store, others, 'data-second-target', { showDefenses: false, attackerId: challenger.id })}
        <button type="button" class="duel-two-cancel" data-second-cancel>Cancel — do not use it yet</button>
      </div>`;
    host.appendChild(el);
    fxNodes.add(el);
    const done = (val) => {
      try { el.remove(); } catch (e) {}
      fxNodes.delete(el);
      document.removeEventListener('keydown', onKey);
      resolve(val);
    };
    const onKey = (ev) => { if (ev.key === 'Escape') done(null); };
    document.addEventListener('keydown', onKey);
    el.addEventListener('click', (ev) => {
      if (ev.target === el || ev.target.closest('[data-second-cancel]')) return done(null);
      const btn = ev.target.closest('[data-second-target]');
      if (btn && !btn.disabled) done(Number(btn.getAttribute('data-second-target')));
    });
    el.querySelector('[data-second-target]:not([disabled])')?.focus();
  });
}

async function strikeDuel(itemId) {
  if (!rootEl || resolving) return;
  const store = ctxRef.store;
  const challenger = challengerHouse();
  const target = targetId != null ? store.HOUSES[targetId] : null;
  if (!challenger || !target) return;
  const invRow = store.getInventory(challenger.id).find((row) => row.item.id === itemId && row.item.slot === 'attack');
  if (!invRow) return;

  // Gate the strike, not the ceremony — same convention as strikeHp: picking
  // the item is free, nothing is spent or struck until the teacher approves.
  resolving = true;
  strikeCancelled = false;   // a stale flag from an earlier End Battle must not kill this strike
  const ok = await lock.requireUnlock('use this item');
  if (!rootEl) { resolving = false; return; }
  if (!ok) { resolving = false; return; }

  const preview = store.previewDuelAttack(challenger.id, target.id, itemId);
  if (!preview.ok) {
    resolving = false;
    renderDuel();
    toast(preview.reason || 'That attack could not be used.');
    return;
  }

  // A multi-target item needs its second house chosen BEFORE the ceremony
  // starts, so backing out here costs nothing.
  let second = null;
  if ((preview.targets || 1) > 1) {
    const secondId = await pickSecondTarget(store, challenger, target, preview.item);
    if (!rootEl) { resolving = false; return; }
    if (secondId == null) { resolving = false; renderDuel(); return; }
    second = store.HOUSES[secondId] || null;
  }

  try {
    await resolveDuelSequence(challenger, target, preview.item, preview, second);
  } catch (e) {
    console.warn('battle: duel strike sequence failed', e);
  } finally {
    closeDiceOverlay();
    resolving = false;         // idempotent — resolveDuelSequence already clears this on its normal path
    strikeCancelled = false;   // the cancellation is spent with the strike it cancelled
  }
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
  // A number that is moving should say which way. Red while it drains, green
  // while it climbs, house gold again the instant it stops — the colour is the
  // whole point, so it is cleared on the same tick the count finishes and on
  // any early bail-out, never left stuck mid-strike.
  const dirClass = to < from ? 'pts-falling' : 'pts-rising';
  const clearDir = () => { const n = readEl(); if (n) n.classList.remove('pts-falling', 'pts-rising'); };
  if (from === to || prefersReducedMotion()) { el.textContent = String(to); clearDir(); return; }
  el.classList.remove('pts-falling', 'pts-rising');
  el.classList.add(dirClass);
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
    else later(clearDir, 260);   // let the settled number sit red/green a moment, then home
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
async function strikeHp(itemId) {
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
  let looted = 0;
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
    // The house's HP hit zero: the battle is over. The winner takes the
    // prize in points; the loser never loses any.
    // ORDER IS DELIBERATE: the prize is awarded BEFORE any steal loot lands.
    // The gap rule measures the two totals as they stood when the arena's
    // banner advertised the prize — loot arriving first would raise the
    // winner's total and quietly shrink the payout below the number the
    // class was promised.
    if (result.defeated) {
      const prize = store.awardBattleWin(challenger.id, target.id);
      battleWon = { prize };
    }
    // A steal loots exactly what was actually taken — 0 if blocked, half if
    // reduced. The attacker gains POINTS equal to the HP damage dealt; that
    // is the whole point of the item. The target's points never move.
    // addPoints can still decline (a frozen challenger cannot earn), so the
    // announcement below uses the written delta, never the request.
    if (kind === 'steal' && result.outcome !== 'blocked' && result.applied > 0) {
      const lootTx = store.addPoints(challenger.id, result.applied, { reason: `${item.name} loot from ${target.name}`, tag: 'attack' });
      looted = lootTx ? lootTx.delta : 0;
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

  // hpLost is what the meter actually dropped — `result.applied` is the hit's
  // strength, which overshoots when the blow lands on a nearly-empty pool.
  playStrike({ item, kind, amount, result, challenger, target, looted,
    hpLost: result.before - result.after,
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
          `−${o.hpLost} HP — full damage`);
        maybeAnnounceVictory(o);
      }, reduced ? 0 : 180);
      return;
    }

    if (o.result.outcome === 'reduced') {
      flareReduceBadge(o.target.id);
      landHit(o, crest, reduced, 'amber');
      outcomeCard('reduced', '🕵️ HALVED',
        `${esc(o.target.name)}'s relic weakened the blow.`,
        `${o.amount} → ${o.hpLost} HP`);
      maybeAnnounceVictory(o);
      return;
    }

    landHit(o, crest, reduced);
    outcomeCard('hit', '💥 DIRECT HIT!',
      `${esc(o.challenger.name)} struck ${esc(o.target.name)} with ${esc(o.item.name)}.${o.kind === 'steal' && o.looted > 0 ? ` They looted <b>${o.looted} pts</b>.` : ''}`,
      `−${o.hpLost} HP`);
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
  // Previously this fired synchronously in strikeHp() before the projectile had
  // even travelled, which read as the deduction happening mid-attack.
  ctxRef.audio.sfx('coin');
  screenVignettePulse();
  if (crest && !reduced) {
    spawnFx(crest, `duel-fx-flash duel-fx-flash-${tint}`, 500);
    shakeCrest(crest);
  }
  // Damage number is text feedback — always shown (static under reduced motion).
  spawnFx(crest, 'duel-fx-dmg', IMPACT_MS, `−${o.hpLost}`);
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
// already been awarded (see strikeHp()) — this just SHOWS it, reusing the same
// outcome-card component and FX vocabulary as every other strike result, then
// clears the chosen opponent so the attacker can pick a new one.
function maybeAnnounceVictory(o) {
  if (!o.battleWon) return;
  later(() => {
    // view check: End Battle during the strike ceremony lands on the landing
    // screen, and a delayed fanfare (or the renderDuel below) must not drag
    // the class back into a duel that has already been ended.
    if (!rootEl || view !== 'duel') return;
    ctxRef.audio.sfx('fanfare');
    screenVignettePulse();
    // A gap-rule prize of 0 (the winner was already ahead) must not read as
    // "+0 pts" — a fanfare over nothing looks like a broken payout. The win
    // card stays; the prize line says why there is no bounty.
    outcomeCard('victory', `🏆 ${esc(o.challenger.name).toUpperCase()} WINS THE DUEL!`,
      `${esc(o.target.name)} is defeated — but keeps every point it earned. No points were lost.`,
      o.battleWon.prize > 0
        ? `+${o.battleWon.prize} pts to ${esc(o.challenger.name)}`
        : `${esc(o.challenger.name)} was already ahead — no bounty`);
    later(() => {
      if (!rootEl || view !== 'duel') return;
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
    // A frozen house cannot earn, and addPoints declines without a word — the
    // refusal has to be SAID, not celebrated with a coin and a floating +10
    // nothing was actually written for (same contract as the Die of Destiny's
    // award path).
    const why = store.explainRefusal(houseId, delta);
    const tx = why ? null : store.addPoints(houseId, delta, { reason: 'Battle Day Victory (teacher)', tag: 'battle' });
    if (!tx) { toast(why || 'Those points could not be added.'); return; }
    ctxRef.audio.sfx('coin');
    // addPoints already re-rendered via subscribe — query the fresh chip.
    spawnFx(rootEl.querySelector(`[data-tchip="${houseId}"]`), 'duel-fx-chip duel-fx-chip-good', 850, `+${tx.delta}`);
    return;
  }

  const result = store.applyAttack({ toId: houseId, amount: -delta, label: 'Battle Day Defeat (teacher)' });
  const chip = rootEl.querySelector(`[data-tchip="${houseId}"]`);
  if (result.outcome === 'blocked') {
    ctxRef.audio.sfx('sword');
    spawnFx(chip, 'duel-fx-chip duel-fx-chip-blue', 850, '🛡️ BLOCKED');
  } else if (!result.applied) {
    // The zero floor took nothing — a house on 0 cannot lose 10, and floating
    // "−10" over an unchanged total is a lie the class will catch.
    toast(store.explainRefusal(houseId, delta) || `${house.name} has nothing left to take.`);
  } else if (result.outcome === 'reduced') {
    ctxRef.audio.sfx('thud');
    flareReduceBadge(houseId);
    // `applied` is what the ledger wrote — halved by the relic, then possibly
    // trimmed again at the zero floor. Announce that, not the request.
    spawnFx(chip, 'duel-fx-chip duel-fx-chip-bad', 850, `${-delta} → ${result.applied}`);
  } else {
    ctxRef.audio.sfx('thud');
    spawnFx(chip, 'duel-fx-chip duel-fx-chip-bad', 850, `−${result.applied}`);
  }
}

function endBattle() {
  // Pressed mid-strike, this used to race the suspended resolveDuelSequence —
  // the strike still landed and the duel screen yanked itself back over the
  // landing page. Now it CANCELS: the flag makes the sequence stand down at
  // its next beat (a strike that has not applied yet is fully called off,
  // nothing spent; one that has stays fully landed, second house included),
  // and closeDiceOverlay resolves any in-flight roll with null so the
  // sequence is never left awaiting physics that no longer exists.
  if (resolving) strikeCancelled = true;
  closeMiniShop();
  closeDiceOverlay();
  clearFx();
  if (overlayEl) { overlayEl.remove(); overlayEl = null; }
  const mainEl = document.getElementById('module-root');
  if (mainEl) mainEl.classList.remove('battle-shake');
  // Next week's holdings start secret again — clears both halves of "who has
  // seen whose defense": the store's Stone-of-Seeing memory and this file's
  // own record of pairs revealed by a landed strike.
  combatRevealed.clear();
  if (ctxRef) ctxRef.store.clearReveals();
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
    strikeCancelled = false;
    miniShopOpen = false;
    miniShopBuyerId = null;
    miniShopBuyInFlight = false;
    combatRevealed.clear();
    injectStyles();
    renderLanding();
    unsub = ctx.store.subscribe(() => { if (view === 'duel' && !resolving) renderDuel(); });
  },

  unmount() {
    closeMiniShop();
    closeDiceOverlay();     // disposes the WebGL dice sim if a roll is mid-flight
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
    strikeCancelled = false;
  },
};
