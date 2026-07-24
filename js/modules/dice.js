// Die of Destiny — classroom dice roller with a real 3D physics simulation.
// The 3D tray (js/modules/dice3d/*) drops, tumbles and settles the dice; this
// module reads the physics-decided face and drives the classroom UI: the in-tray
// result number, the d20 celebration + outcome plaque (overlaid on the stage),
// one-tap point awards, and the (currently hidden) roll-history state. If WebGL
// or the physics import is unavailable it degrades to a simple Math.random roller.
let store, registry, audio;
let sim = null;           // 3D simulation handle (null in fallback mode)
let sim3dFailed = false;
let storeUnsub = null;    // store subscription (recolors dice on core change)
let rollInProgress = false;
let currentMode = '1d6';
let celebrateTimer = null;
let history = [];         // [{ mode, value1, value2?, total, outcome? }] — kept, not rendered
const MAX_HISTORY = 8;

// Prophecy table: d20 outcome ranges (unchanged classroom behavior).
const PROPHECY = [
  { min: 1,  max: 1,  emoji: '💀', title: 'CATASTROPHE',    desc: 'House loses 10 points',                        points: -10, hasButton: true },
  { min: 2,  max: 5,  emoji: '🌧️', title: 'Misfortune',     desc: 'Teacher picks the next challenger',            points: 0,   hasButton: false },
  { min: 6,  max: 9,  emoji: '😐', title: 'Fate is Neutral', desc: 'Nothing happens',                              points: 0,   hasButton: false },
  { min: 10, max: 14, emoji: '✨', title: 'Small Favor',     desc: 'Move your token / +2 class points',            points: 2,   hasButton: true },
  { min: 15, max: 19, emoji: '🔥', title: 'Fortune Smiles',  desc: '+5 house points',                              points: 5,   hasButton: true },
  { min: 20, max: 20, emoji: '👑', title: 'MYTHIC TRIUMPH',  desc: '+20 points AND a free Magic Shop item!',       points: 20,  hasButton: true },
];

function getProphecy(num) {
  return PROPHECY.find((p) => num >= p.min && num <= p.max) || null;
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
      .dice-mode-btn.d20-special {
        background: linear-gradient(135deg, #f59e0b 0%, #d97706 100%);
        color: #1a1a1a; border-color: #fcd34d;
        box-shadow: 0 0 16px rgba(245, 158, 11, 0.5); font-family: Georgia, serif;
      }
      .dice-mode-btn.d20-special.active { box-shadow: 0 0 24px rgba(245, 158, 11, 0.8); }

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

      /* Celebration: the result number grows large in the center of the tray. */
      .dice-celebrate {
        position: absolute; inset: 0; display: none; z-index: 8;
        align-items: center; justify-content: center; pointer-events: none;
      }
      .dice-celebrate.open { display: flex; }
      .dice-celebrate-num {
        font-size: clamp(4.5rem, 16vw, 9rem); font-weight: 900; color: #fde68a;
        font-variant-numeric: tabular-nums; line-height: 1;
        text-shadow: 0 6px 30px rgba(0,0,0,0.95), 0 0 46px rgba(252,211,77,0.55);
        animation: dice-grow 0.8s cubic-bezier(0.2,0.85,0.2,1) both;
      }
      .dice-celebrate.nat1 .dice-celebrate-num { color: #fca5a5; text-shadow: 0 6px 30px rgba(0,0,0,0.95), 0 0 46px rgba(239,68,68,0.6); }
      .dice-celebrate.nat20 .dice-celebrate-num { color: #fcd34d; text-shadow: 0 6px 30px rgba(0,0,0,0.95), 0 0 60px rgba(252,211,77,0.8); }
      @keyframes dice-grow {
        0% { transform: scale(0.15); opacity: 0; }
        35% { opacity: 1; }
        72% { transform: scale(1.16); }
        100% { transform: scale(1); }
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
      .dice-point-btn {
        padding: 0.85rem 2rem; min-height: 52px; background: #f59e0b; color: #1a1a1a;
        border: none; border-radius: 0.5rem; font-size: 1.05rem; font-weight: 700;
        cursor: pointer; transition: all 150ms ease; touch-action: manipulation;
      }
      .dice-point-btn:active { transform: scale(0.95); }
      .dice-point-btn:disabled { opacity: 0.5; cursor: not-allowed; }

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
  return PROPHECY.map((row) => `
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

  // A new roll clears any lingering celebration / plaque.
  clearTimeout(celebrateTimer);
  const cel = el.querySelector('.dice-celebrate');
  if (cel) { cel.classList.remove('open'); cel.innerHTML = ''; }
  closePlaque(el);

  const mode = currentMode;
  let results;

  if (sim) {
    results = await sim.roll(mode);           // physics decides the values
  } else {
    results = await fallbackRoll(el, mode);   // Math.random + spin
  }

  rollInProgress = false;
  setRollEnabled(el, true);
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

  updateTrayResult(el, `${value}`);
  if (value === 20) setTimeout(() => audio.sfx('fanfare'), 300);

  // Celebration: the number grows large in the center (~0.8s), then HOLDS for a
  // dramatic suspense beat before the outcome plaque pops up.
  const cel = el.querySelector('.dice-celebrate');
  if (cel) {
    cel.className = `dice-celebrate open ${variant}`;
    cel.innerHTML = `<div class="dice-celebrate-num">${value}</div>`;
  }
  clearTimeout(celebrateTimer);
  celebrateTimer = setTimeout(() => {
    if (cel) { cel.classList.remove('open'); cel.innerHTML = ''; }
    showOutcomePlaque(el, prophecy, variant);
  }, 2100); // ~0.8s grow + ~1.3s hold

  history.unshift({ mode: 'd20', value1: value, total: value, outcome: prophecy.title });
  if (history.length > MAX_HISTORY) history.pop();
}

function showOutcomePlaque(el, prophecy, variant) {
  let inner = `
    <div class="dice-outcome-emoji">${prophecy.emoji}</div>
    <div class="dice-outcome-title">${prophecy.title}</div>
    <div class="dice-outcome-desc">${prophecy.desc}</div>`;

  const house = store.getActiveHouse();
  if (prophecy.hasButton && house) {
    const pts = prophecy.points;
    const ptsText = pts > 0 ? `+${pts}` : `${pts}`;
    inner += `<button class="dice-point-btn" data-house="${house.id}" data-points="${pts}">Apply ${ptsText} to ${house.name}</button>`;
  }

  const plaque = showPlaque(el, inner, variant);
  if (!plaque) return;

  const pointBtn = plaque.querySelector('.dice-point-btn');
  if (pointBtn) {
    pointBtn.addEventListener('click', (e) => {
      const houseId = Number(e.currentTarget.dataset.house);
      const points = Number(e.currentTarget.dataset.points);
      store.addPoints(houseId, points, { reason: `Die of Destiny: ${prophecy.title}`, tag: 'dice' });
      e.currentTarget.disabled = true;
      e.currentTarget.textContent = 'Applied!';
      setTimeout(() => {
        const h = store.getActiveHouse();
        if (h) e.currentTarget.textContent = `Apply ${points > 0 ? '+' : ''}${points} to ${h.name}`;
        e.currentTarget.disabled = false;
      }, 2000);
    });
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
      audio.sfx('thud');
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
          <div class="dice-celebrate"></div>
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
        const cel = el.querySelector('.dice-celebrate');
        if (cel) { cel.classList.remove('open'); cel.innerHTML = ''; }
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
    if (storeUnsub) { try { storeUnsub(); } catch (e) { console.error(e); } storeUnsub = null; }
    clearTimeout(celebrateTimer);
    celebrateTimer = null;
    try { sim?.dispose(); } catch (e) { console.error(e); }
    sim = null;
    audio?.stopAll?.();
    rollInProgress = false;
    history = [];
  },
};
