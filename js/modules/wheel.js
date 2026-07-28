// wheel.js — the Wheel of Fate.
// A themed random-picker for the thing every teacher already does with a
// pointing finger or a popsicle stick: "who answers first", "who presents",
// "tie-break". Four house wedges, one SPIN, one winner. It deliberately picks
// a HOUSE, never a student — this app has no student roster, and the Wheel
// is not the place to grow one.
//
// The wheel is CSS, not SVG: a 2x2 grid clipped to a circle produces four
// perfect 90-degree pie wedges for free (a square grid split down the middle
// both ways meets exactly at the center, and border-radius:50% trims the
// corners into a circle around it) — no conic-gradient string-building, no
// trig for the wedge fills. The only angle math left is for the SPIN itself:
// where the disc has to stop so the winning wedge's center lands under the
// fixed pointer at the top.
// Owns ONLY this file. Follows ARCHITECTURE.md contract.
import { lock } from '../core/lock.js';
import { escapeHtml as esc } from '../core/escape.js';
import { prefersReducedMotion } from '../core/util.js';

let store, audio;
let mounted = false;
let spinInProgress = false;
let wheelRotation = 0;        // cumulative degrees applied to the disc — ever-increasing, never reset, so a new spin always turns FORWARD rather than snapping back to 0 first
let pendingHouseId = null;    // whichever house the current spin is headed for, set the moment the spin starts
let awardedThisSpin = false;  // one quick-award per spin; a new spin re-enables it
let awardInFlight = false;    // an award is mid-PIN-check; blocks a second tap
let revealTimer = null;       // fallback timer if the CSS transitionend never fires

const QUICK_AWARD_POINTS = 5;

// Grid position -> the angle (clockwise from the pointer at 12 o'clock) of
// that wedge's CENTER. Fixed forever — only which house sits in which slot
// changes (that follows store.HOUSES' own order, i.e. house id ascending).
const SLOT_ANGLES = { tr: 45, br: 135, bl: 225, tl: 315 };
const SLOT_ORDER = ['tr', 'br', 'bl', 'tl']; // clockwise from the pointer, matches house array index 0..3

function createStyles() {
  return `
    <style>
      .wheel-container {
        display: flex; flex-direction: column; align-items: center; height: 100%; width: 100%;
        gap: 1rem; padding: 1.25rem 1.5rem 2rem; background: #0b0f19; color: #f9fafb;
        font-family: system-ui, -apple-system, sans-serif; overflow-y: auto;
        scrollbar-gutter: stable;
      }
      .wheel-title {
        font-family: 'Cinzel', Georgia, serif; font-weight: 800; letter-spacing: 0.04em;
        font-size: clamp(1.3rem, 3vw, 1.9rem); color: #fcd34d;
        text-shadow: 0 0 18px rgba(252,211,77,0.4); text-align: center;
      }
      .wheel-subtitle { color: #9ca3af; font-size: 0.95rem; text-align: center; margin-top: -0.5rem; }

      /* Stage: fixed square, holds the pointer + the rotating disc. */
      .wheel-stage {
        position: relative; width: min(72vw, 46vh, 420px); aspect-ratio: 1 / 1; flex-shrink: 0;
        margin: 0.25rem auto 0;
      }
      .wheel-pointer {
        position: absolute; top: -2px; left: 50%; transform: translateX(-50%); z-index: 6;
        width: 0; height: 0; border-left: 16px solid transparent; border-right: 16px solid transparent;
        border-top: 26px solid #fcd34d; filter: drop-shadow(0 2px 6px rgba(0,0,0,0.6));
      }
      .wheel-hub {
        position: absolute; inset: 0; margin: auto; width: 15%; height: 15%; border-radius: 50%;
        background: radial-gradient(circle at 35% 30%, #fde68a, #b45309 70%);
        border: 3px solid #1a1a1a; z-index: 5; box-shadow: 0 2px 10px rgba(0,0,0,0.6);
      }
      .wheel-disc {
        position: absolute; inset: 0; border-radius: 50%; overflow: hidden;
        display: grid; grid-template-columns: 1fr 1fr; grid-template-rows: 1fr 1fr;
        border: 6px solid #1a1a1a; box-shadow: 0 10px 40px rgba(0,0,0,0.55), inset 0 0 30px rgba(0,0,0,0.35);
        transform: rotate(0deg);
      }
      .wheel-disc.spinning { transition: transform 3.6s cubic-bezier(0.14, 0.72, 0.14, 1); }
      .wheel-wedge {
        display: flex; flex-direction: column; align-items: center; justify-content: center;
        gap: 0.3rem; padding: 8%;
      }
      .wheel-wedge-crest { width: 30%; height: auto; object-fit: contain; filter: drop-shadow(0 2px 6px rgba(0,0,0,0.6)); }
      .wheel-wedge-name {
        font-family: 'Cinzel', Georgia, serif; font-weight: 800; font-size: clamp(0.7rem, 2.4vw, 1rem);
        color: #fff; text-shadow: 0 1px 4px rgba(0,0,0,0.85); text-align: center; line-height: 1.1;
      }

      .wheel-spin-btn {
        padding: 1rem 3.25rem; min-height: 64px;
        background: linear-gradient(135deg, #f59e0b 0%, #d97706 100%); color: #1a1a1a;
        border: none; border-radius: 0.85rem; font-family: 'Cinzel', Georgia, serif;
        font-size: 1.3rem; font-weight: 800; letter-spacing: 0.05em; cursor: pointer;
        transition: all 200ms ease; touch-action: manipulation;
        box-shadow: 0 4px 20px rgba(245, 158, 11, 0.5);
      }
      .wheel-spin-btn:active:not(:disabled) { transform: scale(0.95); }
      .wheel-spin-btn:disabled { opacity: 0.5; cursor: not-allowed; }

      /* Reveal card — pops in under the wheel once it settles. */
      .wheel-reveal {
        width: min(92%, 420px); border-radius: 1rem; border: 2px solid #f59e0b;
        background: rgba(17,24,39,0.94); padding: 1rem 1.25rem 1.15rem; text-align: center;
        box-shadow: 0 16px 46px rgba(0,0,0,0.55);
        animation: wheel-reveal-in 0.4s cubic-bezier(0.2,0.85,0.2,1) both;
      }
      @keyframes wheel-reveal-in { 0% { transform: scale(0.85); opacity: 0; } 100% { transform: scale(1); opacity: 1; } }
      .wheel-reveal-label { font-size: 0.85rem; color: #9ca3af; text-transform: uppercase; letter-spacing: 0.12em; margin-bottom: 0.3rem; }
      .wheel-reveal-name {
        font-family: 'Cinzel', Georgia, serif; font-weight: 800; font-size: 1.7rem;
        margin-bottom: 0.7rem;
      }
      .wheel-award-btn {
        padding: 0.75rem 1.5rem; min-height: 52px; background: #f59e0b; color: #1a1a1a;
        border: none; border-radius: 0.6rem; font-size: 1rem; font-weight: 700;
        cursor: pointer; transition: all 150ms ease; touch-action: manipulation;
      }
      .wheel-award-btn:active:not(:disabled) { transform: scale(0.95); }
      .wheel-award-btn:disabled { opacity: 0.5; cursor: not-allowed; }
      .wheel-awarded {
        margin-top: 0.6rem; padding: 0.75rem 0.9rem; border-radius: 0.5rem;
        background: rgba(34,197,94,0.14); border: 2px solid #22c55e; color: #bbf7d0;
        font-size: 1rem; font-weight: 700;
      }
      .wheel-award-refused {
        margin-top: 0.6rem; padding: 0.75rem 0.9rem; border-radius: 0.5rem;
        background: rgba(251,191,36,0.12); border: 2px solid #fbbf24; color: #fde68a;
        font-size: 0.95rem; font-weight: 700; line-height: 1.4;
      }

      @media (prefers-reduced-motion: reduce) {
        .wheel-disc.spinning { transition: none; }
      }
    </style>
  `;
}

function wedgeHtml(house, slot) {
  return `<div class="wheel-wedge" style="background:${esc(house.accent)}" data-slot="${slot}">
    <img class="wheel-wedge-crest" src="${esc(house.image)}" alt="" onerror="this.style.display='none';" />
    <span class="wheel-wedge-name">${esc(house.name)}</span>
  </div>`;
}

function discHtml(houses) {
  // houses is store.HOUSES in id order (1..4) — SLOT_ORDER maps that same
  // index onto the fixed clockwise-from-pointer grid areas.
  return houses.map((h, i) => wedgeHtml(h, SLOT_ORDER[i])).join('');
}

// Applies the disc's rotation for the CURRENT store.HOUSES order/positions.
// Called once at mount and again every time the spin lands, so the grid-area
// assignment in the stylesheet lines up with SLOT_ORDER regardless of how
// many houses a teacher has (always 4 here, but written defensively).
function wireGridAreas(el) {
  const style = document.createElement('style');
  style.textContent = `
    .wheel-wedge[data-slot="tr"] { grid-column: 2; grid-row: 1; }
    .wheel-wedge[data-slot="br"] { grid-column: 2; grid-row: 2; }
    .wheel-wedge[data-slot="bl"] { grid-column: 1; grid-row: 2; }
    .wheel-wedge[data-slot="tl"] { grid-column: 1; grid-row: 1; }
  `;
  el.appendChild(style);
}

function setSpinEnabled(el, enabled) {
  const btn = el.querySelector('#wheel-spin-btn');
  if (btn) btn.disabled = !enabled;
}

function clearReveal(el) {
  const host = el.querySelector('#wheel-reveal-host');
  if (host) host.innerHTML = '';
}

async function performSpin(el) {
  if (spinInProgress) return;
  spinInProgress = true;
  setSpinEnabled(el, false);
  clearReveal(el);
  clearTimeout(revealTimer);
  awardedThisSpin = false;
  awardInFlight = false;

  const houses = Object.values(store.HOUSES);
  // Uniform pick — this is a picker, not the fate-audited dice, so a plain
  // Math.random() draw is exactly the right amount of ceremony.
  const idx = Math.floor(Math.random() * houses.length);
  const house = houses[idx];
  pendingHouseId = house.id;

  const disc = el.querySelector('.wheel-disc');
  if (!disc) { spinInProgress = false; return; }

  const centerAngle = SLOT_ANGLES[SLOT_ORDER[idx]];
  // Rotate the disc so this wedge's center lands at the pointer (0deg / top).
  const targetMod = (360 - centerAngle + 360) % 360;
  const currentMod = ((wheelRotation % 360) + 360) % 360;
  const forwardDelta = (targetMod - currentMod + 360) % 360;
  const EXTRA_SPINS = 6 * 360; // pure flourish — how many full turns before it settles

  const reduced = prefersReducedMotion();
  if (reduced) {
    // No suspense, no transition: jump straight to the answer.
    wheelRotation += forwardDelta;
    disc.classList.remove('spinning');
    disc.style.transform = `rotate(${wheelRotation}deg)`;
    revealWinner(el, house);
    return;
  }

  wheelRotation += EXTRA_SPINS + forwardDelta;
  audio.sfx('roll'); // the same dice-rattle synth tone — the only "wheel clatter" cue already in the app
  disc.classList.add('spinning');
  // Force layout so the browser registers the pre-spin transform before the
  // transition-triggering one below actually starts (otherwise both can
  // collapse into a single frame and the wheel appears to teleport).
  void disc.offsetWidth;
  disc.style.transform = `rotate(${wheelRotation}deg)`;

  let settled = false;
  const onDone = () => {
    if (settled) return;
    settled = true;
    disc.removeEventListener('transitionend', onDone);
    clearTimeout(revealTimer);
    disc.classList.remove('spinning');
    revealWinner(el, house);
  };
  disc.addEventListener('transitionend', onDone);
  // transitionend can be missed (tab backgrounded mid-spin, etc.) — a
  // matching fallback timer guarantees the reveal still happens.
  revealTimer = setTimeout(onDone, 3900);
}

function revealWinner(el, house) {
  spinInProgress = false;
  setSpinEnabled(el, true);
  if (!mounted) return;
  audio?.sfx?.('fanfare');

  const host = el.querySelector('#wheel-reveal-host');
  if (!host) return;
  host.innerHTML = `
    <div class="wheel-reveal">
      <div class="wheel-reveal-label">The Wheel of Fate has spoken</div>
      <div class="wheel-reveal-name" style="color:${esc(house.accent)}">${esc(house.name)}</div>
      <button type="button" class="wheel-award-btn" id="wheel-award-btn">+${QUICK_AWARD_POINTS} to them</button>
      <div id="wheel-award-result"></div>
    </div>`;

  const btn = host.querySelector('#wheel-award-btn');
  if (btn) btn.addEventListener('click', () => awardQuickPoints(el, house));
}

async function awardQuickPoints(el, house) {
  if (awardedThisSpin || awardInFlight || house.id !== pendingHouseId) return;

  // Same ordering discipline as the Die of Destiny: the in-flight flag goes
  // up BEFORE the await so a double-tap during the PIN pad can't queue a
  // second award, and awardedThisSpin only goes true AFTER addPoints
  // actually lands, so a cancelled PIN never burns the spin's one award.
  awardInFlight = true;
  const ok = await lock.requireUnlock('award these points');
  awardInFlight = false;
  if (!mounted) return;
  if (!ok || awardedThisSpin) return;

  const resultEl = el.querySelector('#wheel-award-result');
  const why = store.explainRefusal(house.id, QUICK_AWARD_POINTS);
  const tx = why ? null : store.addPoints(house.id, QUICK_AWARD_POINTS, { reason: 'Wheel of Fate', tag: 'manual' });
  awardedThisSpin = !!tx;

  if (!resultEl) return;
  if (!tx) {
    resultEl.innerHTML = `<div class="wheel-award-refused">${esc(why || 'Those points could not be added.')}</div>`;
    return;
  }
  audio?.sfx?.('coin');
  resultEl.innerHTML = `<div class="wheel-awarded">✓ Awarded +${tx.delta} to ${esc(house.name)}</div>`;
  const btn = el.querySelector('#wheel-award-btn');
  if (btn) btn.disabled = true;
}

export default {
  id: 'wheel',
  title: 'Wheel of Fate',
  icon: '🎡',
  order: 45,
  showTile: true,

  mount(el, ctx) {
    store = ctx.store;
    audio = ctx.audio;
    mounted = true;
    spinInProgress = false;
    awardedThisSpin = false;
    awardInFlight = false;
    pendingHouseId = null;
    wheelRotation = 0;

    const houses = Object.values(store.HOUSES);

    el.innerHTML = createStyles() + `
      <div class="wheel-container">
        <div class="wheel-title">🎡 Wheel of Fate</div>
        <div class="wheel-subtitle">Spin for who answers first, who presents, or a tie-break — house-level only.</div>
        <div class="wheel-stage">
          <div class="wheel-pointer"></div>
          <div class="wheel-disc">${discHtml(houses)}</div>
          <div class="wheel-hub"></div>
        </div>
        <button type="button" class="wheel-spin-btn" id="wheel-spin-btn">SPIN</button>
        <div id="wheel-reveal-host"></div>
      </div>
    `;

    wireGridAreas(el);

    el.querySelector('#wheel-spin-btn').addEventListener('click', () => performSpin(el));
  },

  unmount() {
    mounted = false;
    spinInProgress = false;
    pendingHouseId = null;
    awardedThisSpin = false;
    awardInFlight = false;
    clearTimeout(revealTimer);
    revealTimer = null;
    audio?.stopAll?.();
  },
};
