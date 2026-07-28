// wheel.js — the Wheel of Fate.
// A themed random-picker for the thing every teacher already does with a
// pointing finger or a popsicle stick: "who answers first", "who presents",
// "tie-break". It deliberately picks a HOUSE, never a student — this app has
// no student roster, and the Wheel is not the place to grow one.
//
// The wheel is now the owner's painted three-piece rig: a tournament-tent
// backdrop (wheel-background.jpg), a static iron-and-gold frame with the
// pointer at twelve o'clock (wheel-outside.png), and the spinning disc
// itself (wheel-center.png) — EIGHT wedges: one per house, two for all four
// houses at once, a sun for Fortune and a moon for Misfortune. The disc is
// the only thing that rotates; the frame and its pointer sit painted on top.
//
// Geometry contract: the disc art's wedge CENTERS sit at 45-degree steps
// clockwise from twelve o'clock, in WEDGES order below. Disc and frame are
// painted on one shared 1254x1254 canvas and stack 1:1 — keep them the same
// size if either PNG is ever repainted.
// Owns ONLY this file. Follows ARCHITECTURE.md contract.
import { lock } from '../core/lock.js';
import { escapeHtml as esc } from '../core/escape.js';
import { prefersReducedMotion } from '../core/util.js';

let store, audio;
let mounted = false;
let spinInProgress = false;
let wheelRotation = 0;        // cumulative degrees applied to the disc — ever-increasing, never reset, so a new spin always turns FORWARD rather than snapping back to 0 first
let pendingIdx = null;        // whichever wedge the current spin is headed for, set the moment the spin starts
let actedThisSpin = false;    // one award/deduction per spin; a new spin re-enables it
let actionInFlight = false;   // an action is mid-PIN-check; blocks a second tap
let revealTimer = null;       // fallback timer if the CSS transitionend never fires

const QUICK_AWARD = 50;       // a house (or all four) picked by the wheel
const FORTUNE_AWARD = 100;    // the sun smiles on a house of the teacher's choosing
const MISFORTUNE_LOSS = 50;   // the moon frowns on a house of the teacher's choosing

// The disc art, clockwise from the pointer at twelve o'clock. Index i's wedge
// center sits at exactly 45*i degrees. House ids follow store.HOUSES
// (1 Camelot, 2 Atlantis, 3 Valhalla, 4 Rivendell).
const WEDGES = [
  { type: 'house', houseId: 1 },   // red castle, top
  { type: 'all' },                 // quartered shield
  { type: 'house', houseId: 2 },   // blue trident
  { type: 'moon' },                // purple crescent — Misfortune
  { type: 'house', houseId: 4 },   // green tree
  { type: 'all' },                 // quartered shield
  { type: 'house', houseId: 3 },   // gold axe
  { type: 'sun' },                 // purple sun — Fortune
];


function createStyles() {
  return `
    <style>
      .wheel-container {
        position: relative; height: 100%; width: 100%; overflow: hidden;
        background: #0b0f19; color: #f9fafb;
        font-family: system-ui, -apple-system, sans-serif;
      }
      /* THE ART BOX — same viewport-anchored 16:9 plate as the Die of Destiny:
         pixel-true on the 1920x1080 board, letterboxed elsewhere, with the
         top bar overlaying the tent canvas exactly as composed. */
      .wheel-art {
        position: fixed; left: 50%; transform: translateX(-50%);
        bottom: 0;
        width: min(100vw, calc(100vh * 16 / 9));
        height: min(100vh, calc(100vw * 9 / 16));
        z-index: 0;
        background: linear-gradient(180deg, rgba(6,8,14,.3), rgba(6,8,14,.08) 30%, rgba(6,8,14,.12)),
          url('images/wheel-background.jpg') center bottom/cover no-repeat, #0b0f19;
      }
      /* The rig: a square holding frame + disc, standing on the painted floor
         emblem at the tent's center. */
      .wheel-rig {
        position: absolute; left: 50%; bottom: calc(16.5% - 30px); transform: translateX(-50%);
        height: 70%; aspect-ratio: 1 / 1;
      }
      /* Disc and frame were painted on the SAME 1254x1254 canvas — the owner
         built the fit (and the lip overlap) into the art itself. They stack
         1:1 in the same box; no sizing math belongs here. The disc's circle
         is centered on its canvas, so rotating the full image is safe. */
      .wheel-disc-img {
        position: absolute; inset: 0; width: 100%; height: 100%; max-width: none;
        transform: rotate(0deg); will-change: transform;
        /* Measured, not assumed: the painted disc's opaque-pixel center sits at
           49.52% / 48.33% of the canvas (scanned via alpha bbox) — about 22px
           off the geometric center at full size. Pivoting there kills the
           orbit-wobble the canvas-center pivot produced. Re-measure if the
           disc art is ever repainted. */
        transform-origin: 49.52% 48.33%;
        filter: drop-shadow(0 6px 24px rgba(0,0,0,0.6));
      }
      .wheel-disc-img.spinning { transition: transform 3.6s cubic-bezier(0.14, 0.72, 0.14, 1); }
      .wheel-ring-img {
        position: absolute; inset: 0; width: 100%; height: 100%; max-width: none;
        pointer-events: none;
        filter: drop-shadow(0 14px 40px rgba(0,0,0,0.55));
      }

      .wheel-title {
        position: absolute; top: 1rem; left: 50%; transform: translateX(-50%); z-index: 6;
        font-family: 'Cinzel', Georgia, serif; font-weight: 800; letter-spacing: 0.04em;
        font-size: clamp(1.4rem, 3.4vw, 2.4rem); color: #fcd34d; white-space: nowrap;
        text-shadow: 0 0 18px rgba(252,211,77,0.4), 0 3px 10px rgba(0,0,0,0.9); text-align: center;
      }
      .wheel-title-mark {
        height: 1em; width: auto; max-width: none; object-fit: contain;
        display: inline-block; vertical-align: -0.25em; margin-right: 0.25em;
      }

      .wheel-spin-btn {
        position: absolute; bottom: calc(1.1rem + 60px); left: 50%; transform: translateX(-50%); z-index: 6;
        padding: 0.9rem 3.25rem; min-height: 60px;
        background: linear-gradient(135deg, #f59e0b 0%, #d97706 100%); color: #1a1a1a;
        border: none; border-radius: 0.85rem; font-family: 'Cinzel', Georgia, serif;
        font-size: 1.3rem; font-weight: 800; letter-spacing: 0.05em; cursor: pointer;
        transition: opacity 200ms ease; touch-action: manipulation;
        box-shadow: 0 4px 20px rgba(245, 158, 11, 0.5), 0 10px 30px rgba(0,0,0,0.5);
      }
      .wheel-spin-btn:active:not(:disabled) { transform: translateX(-50%) scale(0.95); }
      .wheel-spin-btn:disabled { opacity: 0.5; cursor: not-allowed; }

      /* Reveal card — anchored to the RIG's coordinate space: 80px off its
         right edge, vertically centered on the wheel's measured hub line, so
         it tracks the wheel through any reposition or resize. */
      #wheel-reveal-host {
        position: absolute; left: calc(100% + 50px); top: 48.33%;
        transform: translateY(-50%); z-index: 6;
        width: min(24vw, 360px);
      }
      .wheel-reveal {
        border-radius: 1rem; border: 2px solid #f59e0b;
        background: rgba(17,24,39,0.94); padding: 1rem 1.25rem 1.15rem; text-align: center;
        box-shadow: 0 16px 46px rgba(0,0,0,0.55);
        animation: wheel-reveal-in 0.4s cubic-bezier(0.2,0.85,0.2,1) both;
      }
      .wheel-reveal.wheel-reveal-moon { border-color: #a78bfa; }
      @keyframes wheel-reveal-in { 0% { transform: scale(0.85); opacity: 0; } 100% { transform: scale(1); opacity: 1; } }
      .wheel-reveal-label { font-size: 0.85rem; color: #9ca3af; text-transform: uppercase; letter-spacing: 0.12em; margin-bottom: 0.3rem; }
      .wheel-reveal-name {
        font-family: 'Cinzel', Georgia, serif; font-weight: 800; font-size: 1.6rem;
        margin-bottom: 0.7rem; line-height: 1.15;
      }
      .wheel-award-btn {
        padding: 0.7rem 1.3rem; min-height: 48px; background: #f59e0b; color: #1a1a1a;
        border: none; border-radius: 0.6rem; font-size: 0.95rem; font-weight: 700;
        cursor: pointer; transition: all 150ms ease; touch-action: manipulation;
      }
      .wheel-award-btn:active:not(:disabled) { transform: scale(0.95); }
      .wheel-award-btn:disabled { opacity: 0.5; cursor: not-allowed; }
      /* Fortune/Misfortune house choosers: four crest chips. */
      .wheel-house-row { display: flex; gap: 0.4rem; justify-content: center; flex-wrap: wrap; }
      .wheel-house-chip {
        flex: 1 1 40%; min-height: 48px; padding: 0.45rem 0.4rem;
        border-radius: 0.5rem; border: 2px solid var(--wh, #6b7280);
        background: rgba(0,0,0,0.35); color: var(--wh, #e5e7eb);
        font-family: 'Cinzel', Georgia, serif; font-weight: 700; font-size: 0.9rem;
        cursor: pointer; transition: all 150ms ease; touch-action: manipulation;
      }
      .wheel-house-chip:active:not(:disabled) { transform: scale(0.95); }
      .wheel-house-chip:disabled { opacity: 0.5; cursor: not-allowed; }
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
        .wheel-disc-img.spinning { transition: none; }
      }
    </style>
  `;
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
  actedThisSpin = false;
  actionInFlight = false;

  // Uniform pick over the eight painted wedges — this is a picker, not the
  // fate-audited dice, so a plain Math.random() draw is exactly the right
  // amount of ceremony. Two of the eight are all-houses by design.
  const idx = Math.floor(Math.random() * WEDGES.length);
  pendingIdx = idx;

  const disc = el.querySelector('.wheel-disc-img');
  if (!disc) { spinInProgress = false; return; }

  const centerAngle = idx * 45;
  // Land the wedge's center under the frame's pointer (twelve o'clock), with
  // a little honest jitter so it never parks dead-center every time. The
  // jitter stays well inside the wedge's 22.5-degree half-width.
  const jitter = (Math.random() * 24) - 12;
  const targetMod = (360 - centerAngle + jitter + 720) % 360;
  const currentMod = ((wheelRotation % 360) + 360) % 360;
  const forwardDelta = (targetMod - currentMod + 360) % 360;
  const EXTRA_SPINS = 6 * 360;

  const reduced = prefersReducedMotion();
  if (reduced) {
    wheelRotation += forwardDelta;
    disc.classList.remove('spinning');
    disc.style.transform = `rotate(${wheelRotation}deg)`;
    revealOutcome(el, idx);
    return;
  }

  wheelRotation += EXTRA_SPINS + forwardDelta;
  audio.sfx('roll'); // the dice-rattle synth — the app's one "clatter" cue
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
    revealOutcome(el, idx);
  };
  disc.addEventListener('transitionend', onDone);
  // transitionend can be missed (tab backgrounded mid-spin, etc.) — a
  // matching fallback timer guarantees the reveal still happens.
  revealTimer = setTimeout(onDone, 3900);
}

function houseChipRow(kind) {
  const houses = Object.values(store.HOUSES);
  return `<div class="wheel-house-row">${houses.map((h) => `
    <button type="button" class="wheel-house-chip" style="--wh:${esc(h.accent)}"
      data-kind="${kind}" data-house="${h.id}">${esc(h.name)}</button>`).join('')}</div>`;
}

function revealOutcome(el, idx) {
  spinInProgress = false;
  setSpinEnabled(el, true);
  if (!mounted) return;

  const wedge = WEDGES[idx];
  const host = el.querySelector('#wheel-reveal-host');
  if (!host) return;

  if (wedge.type === 'house') {
    const house = store.HOUSES[wedge.houseId];
    audio?.sfx?.('fanfare');
    host.innerHTML = `
      <div class="wheel-reveal">
        <div class="wheel-reveal-label">The Wheel of Fate has spoken</div>
        <div class="wheel-reveal-name" style="color:${esc(house.accent)}">${esc(house.name)}</div>
        <button type="button" class="wheel-award-btn" data-kind="house" data-house="${house.id}">+${QUICK_AWARD} to them</button>
        <div id="wheel-award-result"></div>
      </div>`;
  } else if (wedge.type === 'all') {
    audio?.sfx?.('fanfare');
    host.innerHTML = `
      <div class="wheel-reveal">
        <div class="wheel-reveal-label">The Wheel of Fate has spoken</div>
        <div class="wheel-reveal-name" style="color:#e5e7eb">ALL FOUR HOUSES</div>
        <button type="button" class="wheel-award-btn" data-kind="all">+${QUICK_AWARD} to all four</button>
        <div id="wheel-award-result"></div>
      </div>`;
  } else if (wedge.type === 'sun') {
    audio?.sfx?.('reveal');
    host.innerHTML = `
      <div class="wheel-reveal">
        <div class="wheel-reveal-label">The sun shines — Fortune!</div>
        <div class="wheel-reveal-name" style="color:#fcd34d">☀️ +${FORTUNE_AWARD} to a house</div>
        ${houseChipRow('fortune')}
        <div id="wheel-award-result"></div>
      </div>`;
  } else {
    audio?.sfx?.('thud');
    host.innerHTML = `
      <div class="wheel-reveal wheel-reveal-moon">
        <div class="wheel-reveal-label">The moon frowns — Misfortune…</div>
        <div class="wheel-reveal-name" style="color:#c4b5fd">🌙 −${MISFORTUNE_LOSS} from a house</div>
        ${houseChipRow('misfortune')}
        <div id="wheel-award-result"></div>
      </div>`;
  }

  host.querySelectorAll('[data-kind]').forEach((btn) => {
    btn.addEventListener('click', () => applyOutcome(el, idx, btn));
  });
}

async function applyOutcome(el, idx, btn) {
  if (actedThisSpin || actionInFlight || idx !== pendingIdx) return;

  // Same ordering discipline as the Die of Destiny: the in-flight flag goes
  // up BEFORE the await so a double-tap during the PIN pad can't queue a
  // second action, and actedThisSpin only goes true AFTER the store actually
  // writes, so a cancelled PIN never burns the spin's one action.
  actionInFlight = true;
  const ok = await lock.requireUnlock('apply the wheel’s decree');
  actionInFlight = false;
  if (!mounted) return;
  if (!ok || actedThisSpin) return;

  const resultEl = el.querySelector('#wheel-award-result');
  const kind = btn.dataset.kind;
  const disableAll = () => el.querySelectorAll('[data-kind]').forEach((b) => { b.disabled = true; });

  if (kind === 'all') {
    const made = store.awardAll(QUICK_AWARD, { reason: 'Wheel of Fate — all houses', tag: 'manual' });
    actedThisSpin = made.length > 0;
    if (!resultEl) return;
    if (!made.length) {
      resultEl.innerHTML = '<div class="wheel-award-refused">No house could receive points right now.</div>';
      return;
    }
    audio?.sfx?.('coin');
    const skipped = 4 - made.length;
    resultEl.innerHTML = `<div class="wheel-awarded">✓ +${QUICK_AWARD} to ${made.length === 4 ? 'all four houses' : `${made.length} houses`}${skipped ? ' — ' + skipped + ' frozen' : ''}</div>`;
    disableAll();
    return;
  }

  const houseId = Number(btn.dataset.house);
  const house = store.HOUSES[houseId];
  if (!house) return;

  if (kind === 'misfortune') {
    const tx = store.addPoints(houseId, -MISFORTUNE_LOSS, { reason: 'Wheel of Fate — Misfortune', tag: 'manual' });
    actedThisSpin = !!tx;
    if (!resultEl) return;
    if (!tx) {
      resultEl.innerHTML = `<div class="wheel-award-refused">${esc(house.name)} had nothing left to take.</div>`;
      return;
    }
    audio?.sfx?.('thud');
    resultEl.innerHTML = `<div class="wheel-award-refused">${esc(house.name)} loses ${Math.abs(tx.delta)} points to Misfortune.</div>`;
    disableAll();
    return;
  }

  // 'house' and 'fortune' are both a straight award; only the size differs.
  const points = kind === 'fortune' ? FORTUNE_AWARD : QUICK_AWARD;
  const why = store.explainRefusal(houseId, points);
  const tx = why ? null : store.addPoints(houseId, points, { reason: kind === 'fortune' ? 'Wheel of Fate — Fortune' : 'Wheel of Fate', tag: 'manual' });
  actedThisSpin = !!tx;
  if (!resultEl) return;
  if (!tx) {
    resultEl.innerHTML = `<div class="wheel-award-refused">${esc(why || 'Those points could not be added.')}</div>`;
    return;
  }
  audio?.sfx?.('coin');
  resultEl.innerHTML = `<div class="wheel-awarded">✓ Awarded +${tx.delta} to ${esc(house.name)}</div>`;
  disableAll();
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
    actedThisSpin = false;
    actionInFlight = false;
    pendingIdx = null;
    wheelRotation = 0;

    el.innerHTML = createStyles() + `
      <div class="wheel-container">
        <div class="wheel-art">
          <div class="wheel-rig">
            <img class="wheel-disc-img" src="images/wheel-center.png" alt="" />
            <img class="wheel-ring-img" src="images/wheel-outside.png" alt="" />
            <div id="wheel-reveal-host"></div>
          </div>
        </div>
        <div class="wheel-title"><img class="wheel-title-mark" src="images/icon-wheel.png" alt="" onerror="this.outerHTML='🎡 '" />Wheel of Fate</div>
        <button type="button" class="wheel-spin-btn" id="wheel-spin-btn">SPIN</button>
      </div>
    `;

    el.querySelector('#wheel-spin-btn').addEventListener('click', () => performSpin(el));
  },

  unmount() {
    mounted = false;
    spinInProgress = false;
    pendingIdx = null;
    actedThisSpin = false;
    actionInFlight = false;
    clearTimeout(revealTimer);
    revealTimer = null;
    audio?.stopAll?.();
  },
};
