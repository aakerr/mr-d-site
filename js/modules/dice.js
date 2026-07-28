// Die of Destiny — classroom dice roller with a real 3D physics simulation.
// The 3D tray (js/modules/dice3d/*) drops, tumbles and settles the dice; this
// module reads the physics-decided face and drives the classroom UI: the in-tray
// result number, the d20 celebration + outcome plaque (overlaid on the stage),
// one-tap point awards, and the (currently hidden) roll-history state. If WebGL
// or the physics import is unavailable it degrades to a simple Math.random roller.
import { lock } from '../core/lock.js';

let store, registry, audio;
let sim = null;           // 3D simulation handle (null in fallback mode)
let sim3dFailed = false;
let storeUnsub = null;    // store subscription (recolors dice on core change)
let rollInProgress = false;
let currentMode = '1d6';
let celebrateTimer = null;
let mounted = false;              // guards against a PIN pad resolving after unmount
let awardedThisRoll = false;      // one award per roll; a new roll re-enables awarding
let awardInFlight = false;        // an award is mid-PIN-check; blocks a second tap
let relicClaimedThisRoll = false; // one Mythic relic per natural 20
let relicInFlight = false;        // a relic claim is mid-PIN-check; blocks a second tap
let history = [];         // [{ mode, value1, value2?, total, outcome? }] — kept, not rendered
const MAX_HISTORY = 8;

// Prophecy table: d20 outcome ranges. Teacher-editable in Admin (points,
// title, desc, emoji) — see store.getDiceProphecy()/saveDiceOutcome(). The
// ranges themselves stay fixed in the store so a roll can never land on a gap.
function getProphecy(num) {
  return store.getDiceProphecy().find((p) => num >= p.min && num <= p.max) || null;
}

function createStyles() {
  return `
    <style>
      .dice-container {
        display: flex; flex-direction: column; height: 100%; width: 100%;
        gap: 0.85rem; padding: 1.25rem 1.5rem; background: #0b0f19; color: #f9fafb;
        font-family: system-ui, -apple-system, sans-serif; overflow-y: auto;
        /* Reserve the scrollbar gutter so overlays/content never introduce a
           scrollbar that would shrink the stage width. */
        scrollbar-gutter: stable;
      }
      .dice-modes { display: flex; gap: 1rem; justify-content: center; flex-wrap: wrap; }
      .dice-mode-btn {
        min-width: 120px; padding: 1rem 1.5rem; min-height: 64px;
        border: 2px solid #374151; background: #1f2937; color: #f9fafb;
        border-radius: 0.5rem; font-size: 1.125rem; font-weight: 600;
        cursor: pointer; transition: all 200ms ease; touch-action: manipulation;
      }
      .dice-mode-btn:active { transform: scale(0.95); }
      .dice-mode-btn.active {
        border-color: #3b82f6; background: #1e3a8a;
        box-shadow: 0 0 12px rgba(59, 130, 246, 0.4);
      }
      /* d20 button: neutral/grey like the others when unselected (just a faint
         gold border hint); the full gold gradient/glow/serif only when active. */
      .dice-mode-btn.d20-special { border-color: #6b5322; }
      .dice-mode-btn.d20-special.active {
        background: linear-gradient(135deg, #f59e0b 0%, #d97706 100%);
        color: #1a1a1a; border-color: #fcd34d; font-family: Georgia, serif;
        box-shadow: 0 0 24px rgba(245, 158, 11, 0.8);
      }

      /* 3D stage — fixed 16:9 box; all result/celebration/plaque UI overlays it
         so nothing below can ever resize the canvas. */
      .dice-stage {
        position: relative; width: 100%; max-width: 960px; margin: 0 auto;
        aspect-ratio: 16 / 9; min-height: 420px; flex-shrink: 0;
        border-radius: 1rem; border: 1px solid #374151; overflow: hidden;
        background: radial-gradient(circle at 50% 35%, #182135 0%, #0b0f19 75%);
        box-shadow: inset 0 0 60px rgba(0,0,0,0.6);
        cursor: pointer; touch-action: manipulation;
      }
      .dice-canvas-host { position: absolute; inset: 0; }
      .dice-unavailable-note {
        position: absolute; top: 0.6rem; right: 0.6rem; font-size: 0.75rem; z-index: 6;
        color: #fca5a5; background: rgba(239,68,68,0.12); border: 1px solid #ef4444;
        padding: 0.2rem 0.6rem; border-radius: 0.375rem;
      }

      /* Fallback (no-3D) big number */
      .dice-fallback-num {
        position: absolute; inset: 0; display: flex; align-items: center;
        justify-content: center; gap: 2rem; font-size: 6rem; font-weight: bold;
        color: #fcd34d; text-shadow: 0 0 24px rgba(252,211,77,0.5);
      }
      .dice-fallback-num.rolling { animation: dice-spin 0.6s linear infinite; }
      @keyframes dice-spin { to { transform: rotate(360deg); } }

      /* In-tray result number: bottom-center of the stage, over the 3D scene. */
      .dice-tray-result {
        position: absolute; left: 50%; bottom: 0.55rem; transform: translateX(-50%);
        z-index: 5; pointer-events: none; white-space: nowrap;
        font-size: clamp(1.6rem, 4.5vw, 2.6rem); font-weight: 800; color: #fde68a;
        font-variant-numeric: tabular-nums;
        text-shadow: 0 2px 10px rgba(0,0,0,0.95), 0 0 22px rgba(252,211,77,0.35);
      }
      .dice-tray-result.pop { animation: dice-num-pop 0.4s cubic-bezier(0.2,0.8,0.2,1); }
      @keyframes dice-num-pop {
        0% { transform: translateX(-50%) scale(0.55); opacity: 0.2; }
        60% { transform: translateX(-50%) scale(1.18); }
        100% { transform: translateX(-50%) scale(1); }
      }

      /* Outcome / prophecy plaque overlay — centered over the dice field. */
      .dice-plaque-backdrop {
        position: absolute; inset: 0; z-index: 10; display: none;
        align-items: center; justify-content: center; padding: 1rem;
        background: rgba(5,8,15,0.55);
        backdrop-filter: blur(6px); -webkit-backdrop-filter: blur(6px);
      }
      .dice-plaque-backdrop.open { display: flex; }
      .dice-plaque {
        position: relative; width: min(92%, 520px); max-height: 92%; overflow-y: auto;
        background: rgba(17,24,39,0.94); border: 2px solid #f59e0b; border-radius: 1rem;
        padding: 1.5rem 1.5rem 1.6rem; text-align: center;
        box-shadow: 0 20px 60px rgba(0,0,0,0.6);
        animation: dice-plaque-in 0.35s cubic-bezier(0.2,0.85,0.2,1) both;
      }
      @keyframes dice-plaque-in { 0% { transform: scale(0.85); opacity: 0; } 100% { transform: scale(1); opacity: 1; } }
      .dice-plaque.nat1 { border-color: #ef4444; }
      .dice-plaque.nat1 .dice-outcome-title { color: #fca5a5; }
      .dice-plaque.nat20 { border-color: #fcd34d; }
      .dice-plaque-close {
        position: absolute; top: 0.5rem; right: 0.5rem;
        width: 48px; height: 48px; min-width: 48px; display: flex;
        align-items: center; justify-content: center;
        background: rgba(0,0,0,0.35); border: 1px solid #4b5563; color: #f9fafb;
        border-radius: 9999px; font-size: 1.25rem; cursor: pointer;
        transition: all 150ms ease; touch-action: manipulation;
      }
      .dice-plaque-close:active { transform: scale(0.92); }
      .dice-outcome-emoji { font-size: 2.75rem; margin-bottom: 0.4rem; }
      .dice-outcome-title { font-size: 1.85rem; font-weight: bold; color: #fcd34d; margin-bottom: 0.4rem; }
      .dice-outcome-desc { font-size: 1.15rem; color: #cbd5e1; margin-bottom: 1.25rem; }
      /* A roll that could not be paid out — amber, so it never reads as a win. */
      .dice-awarded-refused { color: #fbbf24; font-weight: 700; line-height: 1.4; }
      .dice-point-btn {
        padding: 0.85rem 2rem; min-height: 52px; background: #f59e0b; color: #1a1a1a;
        border: none; border-radius: 0.5rem; font-size: 1.05rem; font-weight: 700;
        cursor: pointer; transition: all 150ms ease; touch-action: manipulation;
      }
      .dice-point-btn:active { transform: scale(0.95); }
      .dice-point-btn:disabled { opacity: 0.5; cursor: not-allowed; }

      /* Award controls: house chips (All Cores, or the "other house" path). */
      .dice-award-row {
        display: flex; flex-wrap: wrap; gap: 0.6rem; justify-content: center; margin-top: 0.5rem;
      }
      .dice-award-hint { font-size: 0.9rem; color: #9ca3af; margin-bottom: 0.6rem; }
      .dice-house-btn {
        min-height: 48px; padding: 0.7rem 1.1rem; border-radius: 0.5rem;
        border: 2px solid var(--h, #6b7280); background: rgba(255,255,255,0.05);
        color: #f9fafb; font-size: 1rem; font-weight: 700; cursor: pointer;
        transition: all 150ms ease; touch-action: manipulation;
      }
      .dice-house-btn:hover { background: color-mix(in srgb, var(--h) 22%, transparent); }
      .dice-house-btn:active { transform: scale(0.95); }
      .dice-house-btn:disabled { opacity: 0.45; cursor: not-allowed; }
      .dice-other-toggle {
        margin-top: 0.9rem; padding: 0.5rem 1rem; min-height: 44px; background: transparent;
        border: 1px dashed #4b5563; color: #9ca3af; border-radius: 0.375rem;
        font-size: 0.85rem; cursor: pointer; transition: all 150ms ease; touch-action: manipulation;
      }
      .dice-other-toggle:active { transform: scale(0.95); }
      .dice-other-wrap { display: none; }
      .dice-other-wrap.open { display: block; }
      /* Obvious confirmation once a roll's points have been awarded. */
      .dice-awarded {
        margin-top: 0.5rem; padding: 0.85rem 1rem; border-radius: 0.5rem;
        background: rgba(34,197,94,0.14); border: 2px solid #22c55e; color: #bbf7d0;
        font-size: 1.05rem; font-weight: 700;
      }

      /* Mythic Triumph: relic chooser (natural 20 only). */
      .dice-relic-heading {
        margin-top: 0.9rem; margin-bottom: 0.7rem; font-size: 1.15rem;
        font-weight: 800; color: #fcd34d;
      }
      .dice-relic-row { display: flex; flex-wrap: wrap; gap: 0.55rem; justify-content: center; }
      .dice-relic-card {
        flex: 1 1 128px; max-width: 165px; min-height: 128px;
        padding: 0.75rem 0.55rem; border-radius: 0.75rem;
        border: 2px solid rgba(245,158,11,0.55); background: rgba(245,158,11,0.08);
        color: #f9fafb; cursor: pointer; text-align: center;
        transition: all 150ms ease; touch-action: manipulation;
      }
      .dice-relic-card:hover { background: rgba(245,158,11,0.2); border-color: #fcd34d; }
      .dice-relic-card:active { transform: scale(0.96); }
      .dice-relic-emoji { font-size: 1.9rem; line-height: 1.1; }
      .dice-relic-name { font-size: 0.95rem; font-weight: 800; color: #fcd34d; margin: 0.25rem 0 0.2rem; }
      .dice-relic-effect { font-size: 0.76rem; color: #cbd5e1; line-height: 1.3; }
      .dice-relic-claimed {
        margin-top: 0.6rem; padding: 0.9rem 1rem; border-radius: 0.5rem;
        background: rgba(252,211,77,0.15); border: 2px solid #fcd34d; color: #fde68a;
        font-size: 1.05rem; font-weight: 700; line-height: 1.4;
      }

      /* Prophecy table (rendered inside a plaque). */
      .dice-plaque-heading { font-size: 1.5rem; font-weight: bold; color: #fcd34d; margin-bottom: 1rem; }
      .dice-prophecy-row {
        display: grid; grid-template-columns: 52px 1fr; gap: 0.85rem; padding: 0.85rem;
        background: #1f2937; border: 1px solid #374151; border-radius: 0.375rem;
        margin-bottom: 0.5rem; align-items: center; text-align: left;
      }
      .dice-prophecy-row.active { background: rgba(245, 158, 11, 0.22); border-color: #f59e0b; }
      .dice-prophecy-emoji { font-size: 1.6rem; text-align: center; }
      .dice-prophecy-range { font-size: 0.85rem; color: #9ca3af; }
      .dice-prophecy-title { font-weight: bold; color: #fcd34d; }
      .dice-prophecy-desc { font-size: 0.85rem; color: #9ca3af; }

      /* Controls under the stage — ROLL sits immediately below the box. */
      .dice-controls { display: flex; justify-content: center; }
      .dice-roll-btn {
        padding: 1rem 3rem; min-height: 64px;
        background: linear-gradient(135deg, #3b82f6 0%, #2563eb 100%);
        color: #fff; border: none; border-radius: 0.75rem;
        font-size: 1.375rem; font-weight: 700; cursor: pointer;
        transition: all 200ms ease; touch-action: manipulation;
        box-shadow: 0 4px 16px rgba(59, 130, 246, 0.4);
      }
      .dice-roll-btn:active:not(:disabled) { transform: scale(0.95); }
      .dice-roll-btn:disabled { opacity: 0.5; cursor: not-allowed; }
      .dice-extra { display: flex; justify-content: center; }
      .dice-prophecy-btn {
        padding: 0.5rem 1rem; min-height: 44px; background: transparent;
        border: 1px solid #4b5563; color: #9ca3af; border-radius: 0.375rem;
        font-size: 0.85rem; cursor: pointer; transition: all 150ms ease; touch-action: manipulation;
      }
      .dice-prophecy-btn:active { transform: scale(0.95); }
    </style>
  `;
}

// --- plaque overlay helpers -------------------------------------------------

function closePlaque(el) {
  const backdrop = el.querySelector('.dice-plaque-backdrop');
  if (backdrop) { backdrop.classList.remove('open'); backdrop.innerHTML = ''; }
}

/** Fill and open the stage plaque overlay. Returns the .dice-plaque element. */
function showPlaque(el, innerHtml, variant) {
  const backdrop = el.querySelector('.dice-plaque-backdrop');
  if (!backdrop) return null;
  backdrop.innerHTML = `
    <div class="dice-plaque ${variant || ''}">
      <button class="dice-plaque-close" aria-label="Close">✕</button>
      ${innerHtml}
    </div>`;
  backdrop.classList.add('open');
  backdrop.querySelector('.dice-plaque-close').addEventListener('click', () => closePlaque(el));
  return backdrop.querySelector('.dice-plaque');
}

function prophecyRowsHtml(activeMin) {
  return store.getDiceProphecy().map((row) => `
    <div class="dice-prophecy-row ${activeMin === row.min ? 'active' : ''}">
      <div class="dice-prophecy-emoji">${row.emoji}</div>
      <div>
        <div class="dice-prophecy-range">${row.min}${row.min !== row.max ? '–' + row.max : ''}</div>
        <div class="dice-prophecy-title">${row.title}</div>
        <div class="dice-prophecy-desc">${row.desc}</div>
      </div>
    </div>`).join('');
}

function showProphecyPlaque(el, activeMin) {
  showPlaque(el, `
    <div class="dice-plaque-heading">Prophecy Table</div>
    ${prophecyRowsHtml(activeMin ?? null)}
  `, '');
}

// --- roll handling ----------------------------------------------------------

function setRollEnabled(el, enabled) {
  const btn = el.querySelector('#dice-roll-btn');
  if (btn) btn.disabled = !enabled;
}

function updateTrayResult(el, text) {
  const r = el.querySelector('.dice-tray-result');
  if (!r) return;
  r.textContent = text;
  r.classList.remove('pop');
  void r.offsetWidth; // restart the pop animation
  r.classList.add('pop');
}

async function performRoll(el) {
  if (rollInProgress) return;
  rollInProgress = true;
  setRollEnabled(el, false);

  // A new roll clears any lingering suspense timer / plaque and re-enables the
  // one-award-per-roll lock.
  clearTimeout(celebrateTimer);
  closePlaque(el);
  awardedThisRoll = false;
  awardInFlight = false;
  relicClaimedThisRoll = false;
  relicInFlight = false;

  const mode = currentMode;
  let results;

  if (sim) {
    results = await sim.roll(mode);           // physics decides the values
  } else {
    results = await fallbackRoll(el, mode);   // Math.random + spin
  }

  rollInProgress = false;
  setRollEnabled(el, true);
  // null = cancelled (sim disposed mid-roll by unmount, or a roll was already
  // in flight). The per-roll flags were reset above, so just stand down.
  if (!results) return;

  if (mode === 'd20') {
    showD20Result(el, results[0].value);
  } else {
    showD6Result(el, mode, results.map((r) => r.value));
  }
}

function showD6Result(el, mode, values) {
  const total = values.reduce((a, b) => a + b, 0);
  updateTrayResult(el, values.length > 1 ? `${values.join(' + ')} = ${total}` : `${total}`);

  history.unshift({ mode, value1: values[0], value2: values[1], total });
  if (history.length > MAX_HISTORY) history.pop();
}

function showD20Result(el, value) {
  const prophecy = getProphecy(value);
  const variant = value === 1 ? 'nat1' : value === 20 ? 'nat20' : '';

  // In-tray bottom number pops as usual; hold a suspense beat, then the plaque
  // pops in centered over the dice (no grow-in-center number).
  updateTrayResult(el, `${value}`);
  if (value === 20) setTimeout(() => audio.sfx('fanfare'), 300);

  clearTimeout(celebrateTimer);
  celebrateTimer = setTimeout(() => showOutcomePlaque(el, prophecy, variant), 1200);

  history.unshift({ mode: 'd20', value1: value, total: value, outcome: prophecy.title });
  if (history.length > MAX_HISTORY) history.pop();
}

const ptsLabel = (pts) => (pts > 0 ? `+${pts}` : `${pts}`);

function houseChipHtml(house, pts) {
  return `<button class="dice-house-btn" style="--h:${house.accent}"
    data-house="${house.id}" data-points="${pts}">${ptsLabel(pts)} to ${house.name}</button>`;
}

/** Plain-words description of what a mythic relic actually does. */
function relicEffectText(item) {
  const hours = Number(item?.effect?.amount) || 48;
  return item?.effect?.kind === 'shield'
    ? `Attacks are blocked for ${hours} hours`
    : `Incoming damage is halved for ${hours} hours`;
}

function relicCardHtml(item) {
  return `<button class="dice-relic-card" data-relic="${item.id}">
      <div class="dice-relic-emoji">${item.emoji || '✨'}</div>
      <div class="dice-relic-name">${item.name}</div>
      <div class="dice-relic-effect">${relicEffectText(item)}</div>
    </button>`;
}

function showOutcomePlaque(el, prophecy, variant) {
  const pts = prophecy.points;
  const active = store.getActiveHouse();   // null when 'All Cores' is selected
  const allHouses = Object.values(store.HOUSES);

  let inner = `
    <div class="dice-outcome-emoji">${prophecy.emoji}</div>
    <div class="dice-outcome-title">${prophecy.title}</div>
    <div class="dice-outcome-desc">${prophecy.desc}</div>`;

  if (prophecy.hasButton) {
    inner += '<div class="dice-award-area">';
    if (active) {
      // Single core active: keep the one-tap default, plus an "other house"
      // affordance because the rolling house isn't always the active core.
      inner += `<button class="dice-point-btn" data-house="${active.id}" data-points="${pts}">Apply ${ptsLabel(pts)} to ${active.name}</button>`;
      const others = allHouses.filter((h) => h.id !== active.id);
      inner += `
        <div>
          <button class="dice-other-toggle" id="dice-other-toggle">Award to a different house ▾</button>
          <div class="dice-other-wrap" id="dice-other-wrap">
            <div class="dice-award-row">${others.map((h) => houseChipHtml(h, pts)).join('')}</div>
          </div>
        </div>`;
    } else {
      // 'All Cores': no active house — offer all four so the award is never lost.
      inner += `
        <div class="dice-award-hint">Award ${ptsLabel(pts)} to which house?</div>
        <div class="dice-award-row">${allHouses.map((h) => houseChipHtml(h, pts)).join('')}</div>`;
    }
    inner += '</div>';
  }

  const plaque = showPlaque(el, inner, variant);
  if (!plaque) return;

  const area = plaque.querySelector('.dice-award-area');

  async function award(houseId, points) {
    if (awardedThisRoll || awardInFlight) return;   // one award per roll; ignore a second tap while the PIN pad is up
    const h = store.HOUSES[houseId];
    if (!h) return;

    // Gate the payout, not the ceremony: the plaque, the roll, the reveal all
    // already happened. Nothing below this line runs until the teacher approves.
    //   - awardInFlight goes true BEFORE the await so a double-tap during the
    //     pad can't queue a second award() call.
    //   - awardedThisRoll only goes true AFTER store.addPoints succeeds, so a
    //     cancelled PIN never burns the roll's one award.
    //   - awardInFlight is cleared right after the await resolves (either way)
    //     so a refusal leaves the teacher free to tap again immediately.
    awardInFlight = true;
    const ok = await lock.requireUnlock('award these points');
    awardInFlight = false;
    if (!mounted) return;               // module unmounted while the pad was open
    if (!ok || awardedThisRoll) return;  // refused, or already awarded some other way

    // A frozen house cannot earn, and addPoints declines without a word. The
    // roll still happened and is still spent — but the board must not claim an
    // award that was never made.
    const why = store.explainRefusal(houseId, points);
    const tx = why ? null : store.addPoints(houseId, points, { reason: `Die of Destiny: ${prophecy.title}`, tag: 'dice' });
    awardedThisRoll = true;
    if (!tx) {
      if (area) {
        area.textContent = '';
        const msg = document.createElement('div');
        msg.className = 'dice-awarded dice-awarded-refused';
        msg.textContent = why || 'Those points could not be added.';
        area.appendChild(msg);
      }
      return;
    }
    audio?.sfx?.('coin');
    if (!area) return;

    const awarded = `<div class="dice-awarded">✓ Awarded ${ptsLabel(tx.delta)} to ${h.name}</div>`;

    // MYTHIC TRIUMPH: the winning house now claims a relic. If a teacher has
    // deleted the mythic items in Admin, skip the step and just keep the points.
    const relics = prophecy.mythic ? (store.getMythicRewards?.() || []) : [];
    if (!relics.length) { area.innerHTML = awarded; return; }

    area.innerHTML = `
      ${awarded}
      <div class="dice-relic-heading">👑 Choose your Mythic Relic</div>
      <div class="dice-relic-row">${relics.map(relicCardHtml).join('')}</div>`;

    area.querySelectorAll('.dice-relic-card').forEach((card) => {
      card.addEventListener('click', (e) => claimRelic(h, e.currentTarget.dataset.relic, awarded));
    });
  }

  async function claimRelic(house, itemId, awardedHtml) {
    if (relicClaimedThisRoll || relicInFlight) return;   // one relic per natural 20; ignore a second tap while pending

    // Same ordering as award(): flip the in-flight flag before the await,
    // only mint relicClaimedThisRoll after store.grantMythicItem actually runs.
    relicInFlight = true;
    const ok = await lock.requireUnlock('award this relic');
    relicInFlight = false;
    if (!mounted) return;
    if (!ok || relicClaimedThisRoll) return;

    const item = store.grantMythicItem(house.id, itemId);
    if (!item) return;
    relicClaimedThisRoll = true;
    audio?.sfx?.('fanfare');
    if (!area) return;
    area.innerHTML = `
      ${awardedHtml}
      <div class="dice-relic-claimed">
        ${item.emoji || '✨'} ${house.name} claims the ${item.name} —
        ${relicEffectText(item).toLowerCase()}
      </div>`;
  }

  plaque.querySelectorAll('.dice-point-btn, .dice-house-btn').forEach((btn) => {
    btn.addEventListener('click', (e) => {
      const t = e.currentTarget;
      award(Number(t.dataset.house), Number(t.dataset.points));
    });
  });

  const toggle = plaque.querySelector('#dice-other-toggle');
  if (toggle) {
    toggle.addEventListener('click', () => {
      const wrap = plaque.querySelector('#dice-other-wrap');
      if (!wrap) return;
      wrap.classList.toggle('open');
      toggle.textContent = wrap.classList.contains('open')
        ? 'Award to a different house ▴' : 'Award to a different house ▾';
    });
  }

  // If this roll's points were already awarded, reflect that immediately (e.g.
  // the teacher closed and re-opened nothing — defensive, keeps state honest).
  if (awardedThisRoll && area) {
    area.innerHTML = '<div class="dice-awarded">✓ Points already awarded for this roll</div>';
  }
}

// --- non-3D fallback --------------------------------------------------------

function fallbackRoll(el, mode) {
  const sides = mode === 'd20' ? 20 : 6;
  const count = mode === '2d6' ? 2 : 1;
  const numEl = el.querySelector('.dice-fallback-num');
  audio.sfx('roll');
  if (numEl) { numEl.classList.add('rolling'); numEl.textContent = '?'; }

  return new Promise((resolve) => {
    setTimeout(() => {
      const values = Array.from({ length: count }, () => Math.floor(Math.random() * sides) + 1);
      if (numEl) {
        numEl.classList.remove('rolling');
        numEl.textContent = values.join('  ');
      }
      audio.sfx('diceland');
      resolve(values.map((v) => ({ value: v, display: String(v) })));
    }, 1000);
  });
}

// --- module -----------------------------------------------------------------

export default {
  id: 'dice',
  title: 'Die of Destiny',
  icon: '🎲',
  order: 40,
  showTile: true,

  async mount(el, ctx) {
    store = ctx.store;
    registry = ctx.registry;
    audio = ctx.audio;
    currentMode = '1d6';
    rollInProgress = false;
    mounted = true;
    awardInFlight = false;
    relicInFlight = false;

    el.innerHTML = createStyles() + `
      <div class="dice-container">
        <div class="dice-modes">
          <button class="dice-mode-btn active" data-mode="1d6">1d6</button>
          <button class="dice-mode-btn" data-mode="2d6">2d6</button>
          <button class="dice-mode-btn d20-special" data-mode="d20">d20 — Die of Destiny</button>
        </div>
        <div class="dice-stage">
          <div class="dice-canvas-host"></div>
          <div class="dice-tray-result"></div>
          <div class="dice-plaque-backdrop"></div>
        </div>
        <div class="dice-controls">
          <button class="dice-roll-btn" id="dice-roll-btn">ROLL</button>
        </div>
        <div class="dice-extra">
          <button class="dice-prophecy-btn" id="dice-prophecy-btn">Prophecy Table</button>
        </div>
      </div>
    `;

    const stage = el.querySelector('.dice-stage');
    const host = el.querySelector('.dice-canvas-host');
    const backdrop = el.querySelector('.dice-plaque-backdrop');

    // Try to spin up the 3D physics sim; fall back gracefully on any failure.
    sim = null;
    sim3dFailed = false;
    try {
      const { createDiceSim } = await import('./dice3d/sim.js');
      sim = createDiceSim({ container: host, audio });
      // Tint the dice with the active house accent (null = All → defaults).
      sim.setHouse(store.getActiveHouse());
      // Recolor live when the teacher switches core in the top bar (no remount).
      storeUnsub = store.subscribe(() => sim?.setHouse(store.getActiveHouse()));
    } catch (e) {
      sim3dFailed = true;
      console.warn('dice: 3D unavailable, using fallback roller —', e?.message || e);
    }

    if (sim3dFailed) {
      const note = document.createElement('div');
      note.className = 'dice-unavailable-note';
      note.textContent = '3D unavailable';
      stage.appendChild(note);
      const num = document.createElement('div');
      num.className = 'dice-fallback-num';
      num.textContent = '';
      host.appendChild(num);
    }

    // Plaque backdrop: click outside the plaque dismisses; stop the click from
    // reaching the stage's tap-to-roll handler either way.
    backdrop.addEventListener('click', (e) => {
      e.stopPropagation();
      if (e.target === backdrop) closePlaque(el);
    });

    // Wire mode buttons.
    el.querySelectorAll('.dice-mode-btn').forEach((btn) => {
      btn.addEventListener('click', () => {
        if (rollInProgress) return;
        el.querySelectorAll('.dice-mode-btn').forEach((b) => b.classList.remove('active'));
        btn.classList.add('active');
        currentMode = btn.dataset.mode;
        sim?.clear();
        closePlaque(el);
        clearTimeout(celebrateTimer);
        const r = el.querySelector('.dice-tray-result');
        if (r) { r.textContent = ''; r.classList.remove('pop'); }
        const num = el.querySelector('.dice-fallback-num');
        if (num) num.textContent = '';
      });
    });

    // ROLL button + tap-anywhere-on-tray (ignored while a plaque is open).
    el.querySelector('#dice-roll-btn').addEventListener('click', () => performRoll(el));
    stage.addEventListener('click', (e) => {
      if (e.target.closest('.dice-plaque-backdrop')) return;
      if (backdrop.classList.contains('open')) return;
      if (!rollInProgress) performRoll(el);
    });

    // Prophecy table button — opens the table as a dismissible plaque any time.
    el.querySelector('#dice-prophecy-btn').addEventListener('click', () => showProphecyPlaque(el));
  },

  unmount() {
    mounted = false;
    if (storeUnsub) { try { storeUnsub(); } catch (e) { console.error(e); } storeUnsub = null; }
    clearTimeout(celebrateTimer);
    celebrateTimer = null;
    try { sim?.dispose(); } catch (e) { console.error(e); }
    sim = null;
    audio?.stopAll?.();
    rollInProgress = false;
    awardedThisRoll = false;
    awardInFlight = false;
    relicClaimedThisRoll = false;
    relicInFlight = false;
    history = [];
  },
};
