// Die of Destiny — classroom dice roller with a real 3D physics simulation.
// The 3D tray (js/modules/dice3d/*) drops, tumbles and settles the dice; this
// module reads the physics-decided face and drives the classroom UI: the d20
// prophecy table, one-tap point awards, and the roll-history chips. If WebGL or
// the physics import is unavailable it degrades to a simple Math.random roller.
let store, registry, audio;
let sim = null;           // 3D simulation handle (null in fallback mode)
let sim3dFailed = false;
let storeUnsub = null;    // store subscription (recolors dice on core change)
let rollInProgress = false;
let currentMode = '1d6';
let history = [];         // [{ mode, value1, value2?, total, outcome? }]
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
        gap: 1.25rem; padding: 1.5rem; background: #0b0f19; color: #f9fafb;
        font-family: system-ui, -apple-system, sans-serif; overflow-y: auto;
        /* Reserve the scrollbar gutter so the outcome panel appearing after a
           roll never introduces a scrollbar that shrinks the stage width. */
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

      /* 3D stage */
      .dice-stage {
        position: relative; width: 100%; max-width: 960px; margin: 0 auto;
        aspect-ratio: 16 / 9; min-height: 420px;
        /* Never let the flex column shrink the stage when the result banner or
           d20 outcome panel appears below it — that would resize the canvas. */
        flex-shrink: 0;
        border-radius: 1rem; border: 1px solid #374151; overflow: hidden;
        background: radial-gradient(circle at 50% 35%, #182135 0%, #0b0f19 75%);
        box-shadow: inset 0 0 60px rgba(0,0,0,0.6);
        cursor: pointer; touch-action: manipulation;
      }
      .dice-canvas-host { position: absolute; inset: 0; }
      .dice-tap-hint {
        position: absolute; left: 50%; bottom: 0.75rem; transform: translateX(-50%);
        font-size: 0.85rem; color: #9ca3af; pointer-events: none;
        background: rgba(11,15,25,0.6); padding: 0.25rem 0.75rem; border-radius: 9999px;
      }
      .dice-unavailable-note {
        position: absolute; top: 0.6rem; right: 0.6rem; font-size: 0.75rem;
        color: #fca5a5; background: rgba(239,68,68,0.12); border: 1px solid #ef4444;
        padding: 0.2rem 0.6rem; border-radius: 0.375rem;
      }

      /* Fallback (no-3D) big number */
      .dice-fallback-num {
        position: absolute; inset: 0; display: flex; align-items: center;
        justify-content: center; gap: 2rem; font-size: 7rem; font-weight: bold;
        color: #fcd34d; text-shadow: 0 0 24px rgba(252,211,77,0.5);
      }
      .dice-fallback-num.rolling { animation: dice-spin 0.6s linear infinite; }
      @keyframes dice-spin { to { transform: rotate(360deg); } }

      /* Result banner */
      .dice-result-number {
        text-align: center; font-size: 2.5rem; font-weight: bold; color: #fcd34d;
        text-shadow: 0 0 16px rgba(252, 211, 77, 0.4); min-height: 3rem;
        font-variant-numeric: tabular-nums;
      }

      /* Roll button */
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

      /* d20 outcome panel */
      .dice-result-section { display: flex; flex-direction: column; align-items: center; gap: 1rem; }
      .dice-outcome-panel {
        width: 100%; max-width: 600px; background: #111827;
        border: 2px solid #f59e0b; border-radius: 1rem; padding: 1.75rem; text-align: center;
      }
      .dice-outcome-panel.nat1 {
        border-color: #ef4444; background: rgba(239, 68, 68, 0.1);
        animation: dice-catastrophe 0.6s ease;
      }
      @keyframes dice-catastrophe {
        0%,100% { transform: translateX(0); } 25% { transform: translateX(-8px); } 75% { transform: translateX(8px); }
      }
      .dice-outcome-panel.nat20 {
        border-color: #fcd34d; background: rgba(252, 211, 77, 0.1);
        animation: dice-triumph 0.8s ease;
      }
      @keyframes dice-triumph {
        0% { transform: scale(0.95); opacity: 0; } 50% { transform: scale(1.05); } 100% { transform: scale(1); opacity: 1; }
      }
      .dice-outcome-emoji { font-size: 2.5rem; margin-bottom: 0.5rem; }
      .dice-outcome-title { font-size: 1.75rem; font-weight: bold; color: #fcd34d; margin-bottom: 0.5rem; }
      .dice-outcome-desc { font-size: 1.125rem; color: #9ca3af; margin-bottom: 1.25rem; }
      .dice-point-btn {
        padding: 0.75rem 2rem; min-height: 48px; background: #f59e0b; color: #1a1a1a;
        border: none; border-radius: 0.5rem; font-size: 1rem; font-weight: 700;
        cursor: pointer; transition: all 150ms ease; touch-action: manipulation;
      }
      .dice-point-btn:active { transform: scale(0.95); }
      .dice-point-btn:disabled { opacity: 0.5; cursor: not-allowed; }
      .dice-prophecy-toggle {
        margin-top: 1rem; padding: 0.5rem 1rem; min-height: 48px; background: transparent;
        border: 1px solid #9ca3af; color: #9ca3af; border-radius: 0.375rem;
        font-size: 0.875rem; cursor: pointer; transition: all 150ms ease;
      }
      .dice-prophecy-toggle:active { transform: scale(0.95); }
      .dice-prophecy-table {
        width: 100%; max-width: 600px; margin-top: 1rem; max-height: 0;
        overflow: hidden; transition: max-height 300ms ease;
      }
      .dice-prophecy-table.open { max-height: 640px; }
      .dice-prophecy-row {
        display: grid; grid-template-columns: 60px 1fr; gap: 1rem; padding: 1rem;
        background: #1f2937; border-bottom: 1px solid #374151; border-radius: 0.375rem;
        margin-bottom: 0.5rem; align-items: center;
      }
      .dice-prophecy-row.active { background: rgba(245, 158, 11, 0.2); border-color: #f59e0b; }
      .dice-prophecy-emoji { font-size: 1.75rem; text-align: center; }
      .dice-prophecy-text { text-align: left; }
      .dice-prophecy-range { font-size: 0.875rem; color: #9ca3af; }
      .dice-prophecy-title { font-weight: bold; color: #fcd34d; }
      .dice-prophecy-desc { font-size: 0.875rem; color: #9ca3af; }

      /* History strip */
      .dice-history {
        width: 100%; max-width: 600px; margin: 0 auto; display: flex; gap: 0.5rem;
        flex-wrap: wrap-reverse; justify-content: center; padding-top: 1rem; border-top: 1px solid #374151;
      }
      .dice-history-chip {
        padding: 0.5rem 1rem; background: #1f2937; border: 1px solid #374151;
        border-radius: 9999px; font-size: 0.875rem; color: #9ca3af; font-variant-numeric: tabular-nums;
      }
      .dice-history-chip.d6 { border-color: #3b82f6; color: #3b82f6; }
      .dice-history-chip.d20 { border-color: #f59e0b; color: #fcd34d; }
    </style>
  `;
}

// --- roll handling ----------------------------------------------------------

function setRollEnabled(el, enabled) {
  const btn = el.querySelector('#dice-roll-btn');
  if (btn) btn.disabled = !enabled;
}

async function performRoll(el) {
  if (rollInProgress) return;
  rollInProgress = true;
  setRollEnabled(el, false);

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
  const banner = el.querySelector('.dice-result-number');
  if (banner) banner.textContent = values.length > 1 ? `${values.join(' + ')} = ${total}` : `${total}`;

  // Clear any lingering d20 outcome panel.
  const section = el.querySelector('.dice-result-section');
  if (section) section.innerHTML = '';

  history.unshift({ mode, value1: values[0], value2: values[1], total });
  if (history.length > MAX_HISTORY) history.pop();
  updateHistory(el);
}

function showD20Result(el, value) {
  const prophecy = getProphecy(value);
  const banner = el.querySelector('.dice-result-number');
  if (banner) banner.textContent = `${value}`;

  if (value === 20) setTimeout(() => audio.sfx('fanfare'), 300);

  let panelClass = '';
  if (value === 1) panelClass = 'nat1';
  if (value === 20) panelClass = 'nat20';

  const section = el.querySelector('.dice-result-section');
  if (section) {
    let html = `
      <div class="dice-outcome-panel ${panelClass}">
        <div class="dice-outcome-emoji">${prophecy.emoji}</div>
        <div class="dice-outcome-title">${prophecy.title}</div>
        <div class="dice-outcome-desc">${prophecy.desc}</div>`;

    if (prophecy.hasButton && store.getActiveHouse()) {
      const house = store.getActiveHouse();
      const pts = prophecy.points;
      const ptsText = pts > 0 ? `+${pts}` : `${pts}`;
      html += `<button class="dice-point-btn" data-house="${house.id}" data-points="${pts}">Apply ${ptsText} to ${house.name}</button>`;
    }

    html += `
        <button class="dice-prophecy-toggle" id="dice-prophecy-toggle">Show Prophecy Table</button>
        <div class="dice-prophecy-table" id="dice-prophecy-table">
          ${PROPHECY.map((row) => `
            <div class="dice-prophecy-row ${prophecy.min === row.min ? 'active' : ''}">
              <div class="dice-prophecy-emoji">${row.emoji}</div>
              <div class="dice-prophecy-text">
                <div class="dice-prophecy-range">${row.min}${row.min !== row.max ? '–' + row.max : ''}</div>
                <div class="dice-prophecy-title">${row.title}</div>
                <div class="dice-prophecy-desc">${row.desc}</div>
              </div>
            </div>`).join('')}
        </div>
      </div>`;

    section.innerHTML = html;

    const pointBtn = section.querySelector('.dice-point-btn');
    if (pointBtn) {
      pointBtn.addEventListener('click', (e) => {
        const houseId = Number(e.target.dataset.house);
        const points = Number(e.target.dataset.points);
        store.addPoints(houseId, points, { reason: `Die of Destiny: ${prophecy.title}`, tag: 'dice' });
        e.target.disabled = true;
        e.target.textContent = 'Applied!';
        setTimeout(() => {
          const house = store.getActiveHouse();
          if (house) e.target.textContent = `Apply ${points > 0 ? '+' : ''}${points} to ${house.name}`;
          e.target.disabled = false;
        }, 2000);
      });
    }

    const toggleBtn = section.querySelector('#dice-prophecy-toggle');
    if (toggleBtn) {
      toggleBtn.addEventListener('click', () => {
        const table = section.querySelector('#dice-prophecy-table');
        if (table) {
          table.classList.toggle('open');
          toggleBtn.textContent = table.classList.contains('open') ? 'Hide Prophecy Table' : 'Show Prophecy Table';
        }
      });
    }
  }

  history.unshift({ mode: 'd20', value1: value, total: value, outcome: prophecy.title });
  if (history.length > MAX_HISTORY) history.pop();
  updateHistory(el);
}

function updateHistory(el) {
  const historyHtml = history.map((roll) => {
    const cls = roll.mode === 'd20' ? 'd20' : 'd6';
    const label = roll.mode === '2d6' ? `2d6: ${roll.total}`
      : roll.mode === 'd20' ? `d20: ${roll.total}` : `1d6: ${roll.total}`;
    return `<div class="dice-history-chip ${cls}">${label}</div>`;
  }).join('');
  const historyEl = el.querySelector('.dice-history');
  if (historyEl) historyEl.innerHTML = historyHtml;
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
          <div class="dice-tap-hint">Tap the tray or press ROLL</div>
        </div>
        <div class="dice-result-number">–</div>
        <div class="dice-controls">
          <button class="dice-roll-btn" id="dice-roll-btn">ROLL</button>
        </div>
        <div class="dice-result-section"></div>
        <div class="dice-history"></div>
      </div>
    `;

    const stage = el.querySelector('.dice-stage');
    const host = el.querySelector('.dice-canvas-host');

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
      num.textContent = '–';
      host.appendChild(num);
    }

    // Wire mode buttons.
    el.querySelectorAll('.dice-mode-btn').forEach((btn) => {
      btn.addEventListener('click', () => {
        if (rollInProgress) return;
        el.querySelectorAll('.dice-mode-btn').forEach((b) => b.classList.remove('active'));
        btn.classList.add('active');
        currentMode = btn.dataset.mode;
        sim?.clear();
        const banner = el.querySelector('.dice-result-number');
        if (banner) banner.textContent = '–';
        const section = el.querySelector('.dice-result-section');
        if (section) section.innerHTML = '';
        const num = el.querySelector('.dice-fallback-num');
        if (num) num.textContent = '–';
      });
    });

    // ROLL button + tap-anywhere-on-tray.
    el.querySelector('#dice-roll-btn').addEventListener('click', () => performRoll(el));
    stage.addEventListener('click', (e) => {
      if (e.target.closest('.dice-roll-btn')) return;
      if (!rollInProgress) performRoll(el);
    });
  },

  unmount() {
    if (storeUnsub) { try { storeUnsub(); } catch (e) { console.error(e); } storeUnsub = null; }
    try { sim?.dispose(); } catch (e) { console.error(e); }
    sim = null;
    audio?.stopAll?.();
    rollInProgress = false;
    history = [];
  },
};
