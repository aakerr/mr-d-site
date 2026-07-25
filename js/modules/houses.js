// houses.js — "Records": the Ledger.
// The app's record-keeping and analysis screen — the one place that answers
// "why does the score look like this?". Four parts:
//   1. The Term Arc      — week-by-week chart of all four houses (pure SVG/CSS)
//   2. Where points came from — per-house source breakdown + plain-English takeaway
//   3. The Full Ledger   — complete history, filters, CSV export, undo
//   4. Award Routines    — one-tap teacher presets, single house or all four
// Module id stays 'houses' so navigation/dashboard wiring elsewhere is untouched.

const STYLE_ID = 'hse-styles';
const STYLE = `
@keyframes hse-fade-in { from { opacity: 0; transform: translateY(6px); } to { opacity: 1; transform: translateY(0); } }
@keyframes hse-float-up {
  0% { opacity: 0; transform: translate(-50%, 0) scale(0.8); }
  15% { opacity: 1; transform: translate(-50%, -8px) scale(1.15); }
  75% { opacity: 1; transform: translate(-50%, -46px) scale(1); }
  100% { opacity: 0; transform: translate(-50%, -70px) scale(1); }
}
.hse-in { animation: hse-fade-in 280ms ease both; }
.hse-float { position: absolute; left: 50%; top: 0; font-weight: 800; font-size: 1.5rem; pointer-events: none;
  animation: hse-float-up 1100ms ease-out forwards; z-index: 30; text-shadow: 0 2px 8px rgba(0,0,0,0.6); }
.hse-btn { transition: transform 150ms ease, filter 150ms ease, box-shadow 150ms ease; }
.hse-btn:active { transform: scale(0.94); }
.hse-btn:hover { filter: brightness(1.08); }
.hse-scroll::-webkit-scrollbar { width: 8px; }
.hse-scroll::-webkit-scrollbar-thumb { background: var(--color-line, #374151); border-radius: 8px; }

/* ---- card + panel furniture ---- */
.hse-card { background: var(--color-card, #111827); border: 1px solid var(--color-line, #374151); border-radius: 1rem; }
.hse-eyebrow { font-size: 0.875rem; font-weight: 800; letter-spacing: 0.1em; text-transform: uppercase; color: var(--color-text-soft, #9ca3af); }
.hse-sub { font-size: 0.875rem; color: var(--color-text-soft, #9ca3af); }

/* ---- house / scope selector pills ---- */
.hse-pill {
  min-height: 56px; display: flex; align-items: center; gap: 9px;
  padding: 0 14px; border-radius: 0.85rem; border: 2px solid var(--color-line, #374151);
  background: var(--color-card, #111827); color: var(--color-text, #f9fafb);
  transition: transform 150ms ease, border-color 150ms ease, background 150ms ease, box-shadow 150ms ease;
}
.hse-pill:hover { transform: translateY(-1px); }
.hse-pill[data-on="true"] { box-shadow: 0 0 0 3px var(--hse-soft, rgba(245,158,11,0.3)); border-color: var(--hse-acc, #f59e0b); }
.hse-pill-name { font-weight: 800; font-size: 0.95rem; line-height: 1.1; }
.hse-pill-total { font-weight: 800; font-size: 1.25rem; line-height: 1; }
.hse-pill[data-on="false"] .hse-pill-total { color: var(--color-text-soft, #9ca3af); }

/* ---- segmented toggles (chart mode) ---- */
.hse-seg { display: inline-flex; gap: 4px; padding: 4px; border-radius: 0.8rem;
  background: var(--color-card2, #1f2937); border: 1px solid var(--color-line, #374151); }
.hse-seg-btn { min-height: 44px; padding: 0 14px; border-radius: 0.6rem; font-weight: 700; font-size: 0.9rem;
  color: var(--color-text-soft, #9ca3af); transition: background 180ms ease, color 180ms ease; }
.hse-seg-btn[data-on="true"] { background: var(--accent, #f59e0b); color: #0b0f19; }

/* ---- THE TERM ARC ---- */
.hse-chart { position: relative; width: 100%; height: clamp(92px, 13vh, 210px); }
.hse-plot { position: absolute; left: 58px; right: 14px; top: 10px; bottom: 26px; }
.hse-plot-svg { position: absolute; inset: 0; width: 100%; height: 100%; overflow: visible; }
.hse-grid { position: absolute; left: 0; right: 0; height: 0; border-top: 1px dashed var(--color-line, #374151); opacity: 0.75; }
.hse-grid[data-zero="true"] { border-top-style: solid; opacity: 1; }
.hse-ylab { position: absolute; right: calc(100% + 8px); transform: translateY(-50%); white-space: nowrap;
  font-size: 0.875rem; font-weight: 700; color: var(--color-text-soft, #9ca3af); }
.hse-xlab { position: absolute; bottom: 4px; transform: translateX(-50%); white-space: nowrap;
  font-size: 0.9rem; font-weight: 700; color: var(--color-text-soft, #9ca3af); }
.hse-xlab[data-future="true"] { opacity: 0.4; }
.hse-xlab[data-now="true"] { color: var(--color-text, #f9fafb); }
.hse-dot { position: absolute; width: 11px; height: 11px; border-radius: 999px; transform: translate(-50%, -50%);
  border: 2px solid var(--color-card, #111827); box-shadow: 0 1px 3px rgba(0,0,0,0.45); }
.hse-ahead { position: absolute; top: 0; bottom: 0; border-left: 2px dotted var(--color-line, #374151);
  background: repeating-linear-gradient(135deg, rgba(127,127,127,0.09) 0 6px, transparent 6px 12px); }
.hse-ahead-lab { position: absolute; top: 4px; left: 8px; font-size: 0.875rem; font-weight: 700;
  letter-spacing: 0.06em; text-transform: uppercase; color: var(--color-text-soft, #9ca3af); opacity: 0.8; }
.hse-legend-item { display: inline-flex; align-items: center; gap: 7px; min-height: 32px; padding: 0 4px; }
.hse-swatch { width: 14px; height: 14px; border-radius: 4px; flex: 0 0 auto; }
.hse-empty { display: flex; flex-direction: column; align-items: center; justify-content: center; gap: 6px;
  height: 100%; text-align: center; color: var(--color-text-soft, #9ca3af); }

/* ---- breakdown ---- */
.hse-stack { display: flex; flex: 0 0 auto; width: 100%; height: 30px; border-radius: 8px; overflow: hidden;
  background: var(--color-card2, #1f2937); border: 1px solid var(--color-line, #374151); }
.hse-seg-piece { display: flex; align-items: center; justify-content: center; min-width: 0; overflow: hidden;
  font-size: 0.875rem; font-weight: 800; color: #0b0f19; white-space: nowrap;
  transition: filter 150ms ease; }
.hse-seg-piece:hover { filter: brightness(1.12); }
.hse-insight {
  padding: 11px 14px; border-radius: 0.8rem; line-height: 1.45;
  background: rgba(var(--accent-rgb, 245,158,11), 0.12);
  border: 1px solid rgba(var(--accent-rgb, 245,158,11), 0.4);
  color: var(--color-text, #f9fafb); font-size: 0.98rem;
}
.hse-insight b { font-weight: 800; }
.hse-srow { display: grid; grid-template-columns: 150px minmax(0,1fr) 108px; align-items: center; gap: 10px; }

/* ---- award routines ---- */
.hse-preset {
  min-height: 50px; width: 100%; display: flex; align-items: center; justify-content: space-between; gap: 8px;
  padding: 0 12px; border-radius: 0.7rem; font-weight: 800; font-size: 0.92rem; text-align: left;
  border: 1px solid transparent;
}
.hse-target {
  display: flex; align-items: center; gap: 8px; padding: 7px 11px; border-radius: 0.7rem;
  font-weight: 800; font-size: 0.9rem; border: 1px solid;
}
.hse-allmode { background-image: repeating-linear-gradient(135deg, rgba(245,158,11,0.16) 0 8px, transparent 8px 16px); }

/* ---- ledger ---- */
.hse-input {
  min-height: 44px; padding: 0 10px; border-radius: 0.6rem; font-size: 0.9rem;
  background: var(--color-card2, #1f2937); border: 1px solid var(--color-line, #374151);
  color: var(--color-text, #f9fafb);
}
.hse-input:focus { outline: none; border-color: var(--accent, #f59e0b); box-shadow: 0 0 0 3px var(--accent-soft, rgba(245,158,11,0.35)); }
.hse-input::placeholder { color: var(--color-text-soft, #9ca3af); }
@keyframes hse-row-out { to { opacity: 0; transform: translateX(18px) scale(0.98); } }
.hse-tx-row { transition: background 150ms ease; }
.hse-tx-row:hover { background: rgba(127,127,127,0.08); }
.hse-tx-row.hse-row-out { animation: hse-row-out 320ms ease forwards; pointer-events: none; }
.hse-undo-btn {
  width: 44px; height: 44px; min-width: 44px; min-height: 44px;
  display: flex; align-items: center; justify-content: center;
  border-radius: 10px; border: 1px solid transparent;
  background: transparent; color: var(--color-text-soft, #9ca3af);
  font-size: 17px; font-weight: 700; line-height: 1;
  transition: background 150ms ease, color 150ms ease, border-color 150ms ease, transform 150ms ease;
}
.hse-undo-btn:hover, .hse-undo-btn:focus-visible {
  background: rgba(239,68,68,0.14); border-color: rgba(239,68,68,0.45); color: #f87171;
}
.hse-undo-btn:active { transform: scale(0.9); }
.hse-tag-badge {
  display: inline-flex; align-items: center; font-size: 0.875rem; font-weight: 800;
  letter-spacing: 0.03em; padding: 2px 8px; border-radius: 999px; border: 1px solid;
  white-space: nowrap;
}

/* ---- confirm modal (scoped to this module; own overlay, own z-index) ---- */
#hse-modal-root:empty { display: none; }
@keyframes hse-modal-fade { from { opacity: 0; } to { opacity: 1; } }
@keyframes hse-modal-pop { from { opacity: 0; transform: translate(-50%,-46%) scale(0.96); } to { opacity: 1; transform: translate(-50%,-50%) scale(1); } }
.hse-modal-bg {
  position: fixed; inset: 0; z-index: 80; background: rgba(0,0,0,0.65);
  backdrop-filter: blur(3px); animation: hse-modal-fade 180ms ease both;
}
.hse-modal {
  position: fixed; top: 50%; left: 50%; transform: translate(-50%,-50%); z-index: 81;
  width: min(520px, 92vw); max-height: 88vh; display: flex; flex-direction: column;
  background: var(--color-card, #111827); border: 1px solid var(--color-line, #374151);
  border-radius: 1.1rem; box-shadow: 0 30px 80px rgba(0,0,0,0.6);
  animation: hse-modal-pop 200ms ease both;
}
.hse-modal-head {
  display: flex; align-items: center; justify-content: space-between; gap: 10px;
  padding: 16px 18px; border-bottom: 1px solid var(--color-line, #374151);
}
.hse-modal-title { font-weight: 800; font-size: 1.05rem; color: var(--color-text, #f9fafb); }
.hse-modal-x {
  width: 44px; height: 44px; min-width: 44px; min-height: 44px; border-radius: 10px;
  color: var(--color-text-soft, #9ca3af); font-size: 1rem;
  transition: background 150ms ease, color 150ms ease;
}
.hse-modal-x:hover { background: rgba(127,127,127,0.16); color: var(--color-text, #f9fafb); }
.hse-modal-body { padding: 16px 18px; overflow-y: auto; }
.hse-modal-lead { color: var(--color-text, #f9fafb); font-size: 1rem; line-height: 1.55; margin: 0 0 10px; }
.hse-modal-meta { color: var(--color-text-soft, #9ca3af); font-size: 0.9rem; margin-bottom: 10px; }
.hse-modal-warn {
  margin-top: 6px; padding: 10px 12px; border-radius: 0.6rem; font-size: 0.92rem; line-height: 1.5;
  background: rgba(245,158,11,0.1); border: 1px solid rgba(245,158,11,0.4); color: var(--color-text, #f9fafb);
}
.hse-modal-foot {
  display: flex; gap: 10px; justify-content: flex-end; padding: 14px 18px;
  border-top: 1px solid var(--color-line, #374151);
}
.hse-modal-btn {
  min-height: 48px; padding: 0 18px; border-radius: 10px; font-weight: 700; font-size: 0.95rem;
  transition: filter 150ms ease, transform 150ms ease;
}
.hse-modal-btn:active { transform: scale(0.97); }
.hse-modal-btn-cancel { background: var(--color-card2, #1f2937); border: 1px solid var(--color-line, #374151); color: var(--color-text, #f9fafb); }
.hse-modal-btn-cancel:hover { filter: brightness(1.12); }
.hse-modal-btn-danger { background: #b91c1c; border: 1px solid #ef4444; color: #fff; }
.hse-modal-btn-danger:hover { filter: brightness(1.12); }

/* ---- toast (own fixed host, appended to <body> so re-renders don't kill it) ---- */
.hse-toast-host { position: fixed; left: 50%; bottom: 32px; z-index: 85; transform: translateX(-50%);
  display: flex; flex-direction: column; align-items: center; gap: 8px; pointer-events: none; }
@keyframes hse-toast-in { from { opacity: 0; transform: translateY(10px); } to { opacity: 1; transform: translateY(0); } }
@keyframes hse-toast-out { from { opacity: 1; transform: translateY(0); } to { opacity: 0; transform: translateY(10px); } }
.hse-toast {
  background: var(--color-card, #111827); border: 1px solid var(--color-line, #374151);
  color: var(--color-text, #f9fafb); font-weight: 700; font-size: 0.95rem;
  padding: 10px 18px; border-radius: 999px; box-shadow: 0 12px 30px rgba(0,0,0,0.45);
  animation: hse-toast-in 200ms ease both;
}
.hse-toast.hse-toast-out { animation: hse-toast-out 220ms ease both; }

@media (min-width: 1280px) {
  .hse-midrow { height: clamp(172px, 24vh, 330px); }
}
/* 1280x720 smartboards are the tight case: trim the chrome that is nice-to-have
   rather than load-bearing so all four panels still fit without page scroll. */
@media (max-height: 820px) {
  .hse-page { padding: 10px !important; gap: 10px !important; }
  .hse-card { padding: 11px !important; }
  .hse-pill { min-height: 50px; padding: 0 10px; gap: 7px; }
  .hse-pill-total { font-size: 1.1rem; }
  .hse-stack { height: 26px; }
  .hse-midrow { height: clamp(184px, 25.5vh, 330px) !important; }
  .hse-hide-short { display: none !important; }
  .hse-insight { font-size: 0.88rem; padding: 8px 11px; }
  .hse-preset { min-height: 46px; font-size: 0.88rem; }
}
`;

// Every transaction carries a `tag` set by whichever module logged it. These
// are the display labels + colours used by the ledger badges, the breakdown
// segments and the category filter, so one vocabulary covers the whole screen.
const CATS = {
  quest:  { name: 'Quests',            short: 'Quest',  color: '#a78bfa' },
  potw:   { name: 'Place of the Week', short: 'POTW',   color: '#38bdf8' },
  battle: { name: 'Battle Day',        short: 'Battle', color: '#fb7185' },
  dice:   { name: 'Die of Destiny',    short: 'Dice',   color: '#34d399' },
  shop:   { name: 'Magic Shop',        short: 'Shop',   color: '#f59e0b' },
  attack: { name: 'Attacks',           short: 'Attack', color: '#f87171' },
  wild:   { name: 'Wildcards',         short: 'Wild',   color: '#c084fc' },
  manual: { name: 'Your own awards',   short: 'Manual', color: '#9ca3af' },
};
const CAT_ORDER = ['quest', 'potw', 'battle', 'dice', 'shop', 'attack', 'wild', 'manual'];

// 'quick' is a legacy alias for a hand-typed award, and a missing tag means the
// same thing — both belong in the same bucket as 'manual' or the breakdown
// under-reports how much of the score the teacher handed out personally.
function catOf(tag) {
  const t = tag || 'manual';
  return t === 'quick' ? 'manual' : t;
}
// A tag from a module this screen has never heard of still gets a readable
// name and a badge rather than being dropped on the floor.
function catMeta(key) {
  if (CATS[key]) return CATS[key];
  const name = String(key).replace(/[-_]+/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase());
  return { name, short: name, color: '#9ca3af' };
}
function catRank(key) {
  const i = CAT_ORDER.indexOf(key);
  return i < 0 ? CAT_ORDER.length : i;
}

// Undoing a transaction only ever deletes the points row (store.removeTransaction
// never touches quest/shop/combat state) — so for tags where OTHER state was
// also changed at the time, the confirm modal must say plainly that only the
// points are reverting.
function tagWarning(t) {
  switch (catOf(t.tag)) {
    case 'quest':
      if (/^Quest complete:/i.test(t.reason || '')) return 'This removes the points only — the quest stays marked complete on the Quests board.';
      if (/^Quest abandoned:/i.test(t.reason || '')) return 'This removes the points only — the quest stays abandoned and back on the board for another house.';
      return 'This removes the points only — the quest’s status on the Quests board is not changed.';
    case 'shop':
      return 'This removes the points only — the purchased item stays in effect (an active shield, for example, is not revoked).';
    case 'attack':
      return 'This removes the points only — the attack already happened, so any shield broken or damage already dealt is not undone.';
    case 'potw':
      return 'This removes the points only — the bounty stays marked as paid, so it will not be paid out again automatically.';
    default:
      return '';
  }
}

function ensureStyle() {
  if (document.getElementById(STYLE_ID)) return;
  const s = document.createElement('style');
  s.id = STYLE_ID;
  s.textContent = STYLE;
  document.head.appendChild(s);
}

function escapeHtml(str) {
  return String(str).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}

function signed(n) { return `${n > 0 ? '+' : ''}${n}`; }

function houseImg(house, cls) {
  return `<img src="${house.image}" alt="" class="${cls}" onerror="this.onerror=null;this.style.display='none';" />`;
}

function pngWithEmojiFallback(src, emoji, cls, wrapCls) {
  return `<div class="${wrapCls} relative inline-flex items-center justify-center shrink-0 align-middle">
    <img src="${src}" alt="" class="${cls}" onerror="this.style.display='none'; this.nextElementSibling.style.display='inline-flex';" />
    <span class="hidden absolute inset-0 items-center justify-center">${emoji}</span>
  </div>`;
}

function fmtDate(ts) {
  return new Date(ts).toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
}
function fmtClock(ts) {
  return new Date(ts).toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit' });
}
// Time alone is ambiguous once the log spans weeks — the full ledger always
// shows the day, with today called out by name so it reads at a glance.
function fmtWhen(ts) {
  const d = new Date(ts);
  const now = new Date();
  if (d.toDateString() === now.toDateString()) return `Today ${fmtClock(ts)}`;
  return `${fmtDate(ts)} ${fmtClock(ts)}`;
}
function isoDay(d) {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

// ---- module instance state (survives store re-renders, not module reloads) ----
function initInternalState(store) {
  const active = store.getActiveHouse();
  return {
    chartMode: 'cumulative',            // 'cumulative' | 'weekly'
    scope: active ? active.id : 'all',  // 'all' | houseId — drives the WHOLE screen
    cat: 'all',                         // ledger category filter
    from: '', to: '', search: '',       // ledger date range + reason search
    confirmTxId: null,
    lastActiveCore: store.getState().activeCore,
  };
}

// ============================================================================
// HEADER — what these records are about, and the one selector that drives it
// ============================================================================

function renderHeader(store, s) {
  const houses = Object.values(store.HOUSES);
  const term = store.getTermInfo();
  const classTotal = houses.reduce((n, h) => n + store.getTotal(h.id, 'term'), 0);
  const on = (key) => String(s.scope) === String(key);

  const allPill = `
    <button type="button" class="hse-pill" data-scope="all" data-on="${on('all')}"
      style="--hse-acc:#f59e0b; --hse-soft:rgba(245,158,11,0.3); ${on('all') ? 'border-color:#f59e0b;' : ''}"
      aria-pressed="${on('all')}">
      <span class="text-xl leading-none">🏰</span>
      <span class="hse-pill-name">All Houses</span>
      <span class="hse-pill-total ml-1" style="color:${on('all') ? '#f59e0b' : ''}">${classTotal}</span>
    </button>`;

  const housePills = houses.map((h) => `
    <button type="button" class="hse-pill" data-scope="${h.id}" data-on="${on(h.id)}"
      style="--hse-acc:${h.accent}; --hse-soft:${h.accentSoft}; ${on(h.id) ? `border-color:${h.accent};` : ''}"
      aria-pressed="${on(h.id)}">
      ${houseImg(h, 'h-9 w-auto object-contain shrink-0')}
      <span class="hse-pill-name" style="color:${h.accent}">${escapeHtml(h.name)}</span>
      <span class="hse-pill-total" style="color:${on(h.id) ? h.accent : ''}">${store.getTotal(h.id, 'term')}</span>
    </button>`).join('');

  return `
    <div class="hse-in flex items-center gap-4 flex-wrap shrink-0">
      <div class="flex items-center gap-2.5">
        ${pngWithEmojiFallback('images/icon-points.png', '📜', 'h-9 w-9 xl:h-10 xl:w-10 object-contain', 'h-9 w-9 xl:h-10 xl:w-10 text-3xl')}
        <div class="leading-tight">
          <h1 class="font-display font-extrabold text-2xl xl:text-3xl text-gray-50">Records</h1>
          <div class="hse-sub whitespace-nowrap">${escapeHtml(term.label)}<span class="hidden 2xl:inline"> · every point, and where it came from</span></div>
        </div>
      </div>
      <div class="ml-auto flex items-center gap-2 flex-wrap" role="group" aria-label="Choose which house these records show">
        ${allPill}${housePills}
      </div>
    </div>`;
}

// ============================================================================
// 1. THE TERM ARC — pure SVG/CSS, no libraries
// ============================================================================

// Round grid values ("0, 100, 200, 300") read far better across a classroom
// than whatever the data happens to max out at.
function niceScale(min, max) {
  let lo = Math.min(0, min);
  let hi = Math.max(0, max);
  if (hi === lo) hi = lo + 10;
  const raw = (hi - lo) / 4;
  const mag = Math.pow(10, Math.floor(Math.log10(Math.max(raw, 1e-6))));
  const norm = raw / mag;
  const step = (norm <= 1 ? 1 : norm <= 2 ? 2 : norm <= 5 ? 5 : 10) * mag;
  lo = Math.floor(lo / step) * step;
  hi = Math.ceil(hi / step) * step;
  const ticks = [];
  for (let v = lo; v <= hi + step / 1000; v += step) ticks.push(Math.round(v));
  return { lo, hi, ticks };
}

function renderArc(store, s) {
  const cumulative = s.chartMode === 'cumulative';
  const series = store.getWeeklySeries({ cumulative });
  const houses = Object.values(store.HOUSES);
  const term = store.getTermInfo();
  const weeks = series.length;
  const drawnTo = Math.max(1, Math.min(weeks, term.week)); // don't draw a flat line into weeks that haven't happened
  const drawn = series.slice(0, drawnTo);

  const txs = store.getState().transactions;
  const inTerm = txs.filter((t) => {
    const first = series[0].from.getTime();
    const last = series[weeks - 1].from.getTime() + 7 * 86400000;
    return t.ts >= first && t.ts < last;
  }).length;
  const outside = txs.length - inTerm;

  const toggle = `
    <div class="hse-seg" role="group" aria-label="Chart view">
      <button type="button" class="hse-seg-btn" data-chart="cumulative" data-on="${cumulative}" aria-pressed="${cumulative}">Running total</button>
      <button type="button" class="hse-seg-btn" data-chart="weekly" data-on="${!cumulative}" aria-pressed="${!cumulative}">Points per week</button>
    </div>`;

  const head = (extra) => `
    <div class="hse-card hse-in p-3 xl:p-4 flex flex-col gap-2 shrink-0">
      <div class="flex items-end justify-between gap-3 flex-wrap">
        <div>
          <div class="hse-eyebrow">The Term Arc</div>
          <div class="hse-sub">${cumulative
            ? 'The House Cup race — every house’s running total, week by week.'
            : 'What each house actually scored in each week of the term.'}</div>
        </div>
        ${extra}
        ${toggle}
      </div>
      <div class="hse-chart">CHART_BODY</div>
      ${outside > 0 ? `<div class="hse-sub">Note: ${outside} ${outside === 1 ? 'entry falls' : 'entries fall'} outside the term dates, so ${outside === 1 ? 'it is' : 'they are'} not on this chart (the ledger still lists ${outside === 1 ? 'it' : 'them'}).</div>` : ''}
    </div>`;

  if (!inTerm) {
    return head('').replace('CHART_BODY', () => `
      <div class="hse-empty">
        <div class="text-4xl">🏁</div>
        <div class="text-lg font-bold" style="color:var(--color-text)">The race starts when you award your first points.</div>
        <div class="hse-sub">Use the Award Routines below, or the ± button in the top bar. Every award lands here.</div>
      </div>`);
  }

  // ---- scale ----
  let dMin = 0, dMax = 0;
  for (const w of drawn) for (const h of houses) {
    const v = w.totals[h.id] || 0;
    if (v < dMin) dMin = v;
    if (v > dMax) dMax = v;
  }
  const { lo, hi, ticks } = niceScale(dMin, dMax);
  const xAt = (i) => (weeks === 1 ? 50 : (i / (weeks - 1)) * 100);
  const yAt = (v) => (1 - (v - lo) / (hi - lo)) * 100;

  const gridHtml = ticks.map((t) => `
    <div class="hse-grid" data-zero="${t === 0}" style="top:${yAt(t).toFixed(2)}%">
      <span class="hse-ylab">${t}</span>
    </div>`).join('');

  const focus = s.scope !== 'all' ? Number(s.scope) : null;
  const lines = houses.map((h) => {
    const pts = drawn.map((w, i) => `${xAt(i).toFixed(3)},${yAt(w.totals[h.id] || 0).toFixed(3)}`).join(' ');
    const dim = focus && focus !== h.id;
    return `<polyline points="${pts}" fill="none" stroke="${h.accent}" stroke-width="${focus === h.id ? 5 : 3.5}"
      stroke-linejoin="round" stroke-linecap="round" vector-effect="non-scaling-stroke"
      opacity="${dim ? 0.28 : 1}" />`;
  }).join('');

  const dots = houses.map((h) => {
    const dim = focus && focus !== h.id;
    return drawn.map((w, i) => {
      const v = w.totals[h.id] || 0;
      return `<span class="hse-dot" style="left:${xAt(i).toFixed(3)}%; top:${yAt(v).toFixed(3)}%; background:${h.accent}; opacity:${dim ? 0.3 : 1}"
        title="${escapeHtml(h.name)} — week ${w.week}: ${cumulative ? `${v} total` : signed(v)}"></span>`;
    }).join('');
  }).join('');

  const xLabels = series.map((w, i) => `
    <span class="hse-xlab" style="left:${xAt(i).toFixed(3)}%" data-future="${w.week > drawnTo}" data-now="${w.week === drawnTo}"
      title="Week of ${escapeHtml(w.from.toLocaleDateString(undefined, { month: 'short', day: 'numeric' }))}">${w.week === drawnTo ? 'Now' : w.week}</span>`).join('');

  const ahead = drawnTo < weeks ? `
    <div class="hse-ahead" style="left:${xAt(drawnTo - 1).toFixed(3)}%; right:0;">
      <span class="hse-ahead-lab">${weeks - drawnTo} ${weeks - drawnTo === 1 ? 'week' : 'weeks'} still to come</span>
    </div>` : '';

  const body = `
    <div class="hse-plot">
      ${ahead}
      ${gridHtml}
      <svg class="hse-plot-svg" viewBox="0 0 100 100" preserveAspectRatio="none" aria-hidden="true">${lines}</svg>
      ${dots}
    </div>
    <div class="hse-plot" style="top:auto; bottom:0; height:24px;">${xLabels}</div>`;

  const legend = `
    <div class="flex items-center gap-1 flex-wrap">
      ${houses.map((h) => {
        const last = drawn[drawn.length - 1].totals[h.id] || 0;
        const dim = focus && focus !== h.id;
        return `<span class="hse-legend-item" style="opacity:${dim ? 0.45 : 1}">
          <span class="hse-swatch" style="background:${h.accent}"></span>
          <span class="text-sm font-bold" style="color:${h.accent}">${escapeHtml(h.name)}</span>
          <span class="text-sm font-extrabold" style="color:var(--color-text)">${cumulative ? last : signed(last)}</span>
        </span>`;
      }).join('')}
    </div>`;

  return head(legend).replace('CHART_BODY', () => body);
}

// ============================================================================
// 2. WHERE THE POINTS CAME FROM
// ============================================================================

// getBreakdown() keys by raw tag; fold the aliases together and sort into a
// stable order so the same source is always the same colour in the same place.
function sourcesFor(store, houseId) {
  const raw = store.getBreakdown(houseId, 'term');
  const merged = {};
  for (const [tag, v] of Object.entries(raw)) {
    const k = catOf(tag);
    const m = merged[k] || (merged[k] = { key: k, earned: 0, lost: 0, net: 0, count: 0 });
    m.earned += v.earned; m.lost += v.lost; m.net += v.net; m.count += v.count;
  }
  const rows = Object.values(merged).sort((a, b) => catRank(a.key) - catRank(b.key));
  return {
    rows,
    earned: rows.reduce((n, r) => n + r.earned, 0),
    lost: rows.reduce((n, r) => n + r.lost, 0),
    net: rows.reduce((n, r) => n + r.net, 0),
  };
}

function combinedSources(store) {
  const all = {};
  let earned = 0, lost = 0, net = 0;
  for (const h of Object.values(store.HOUSES)) {
    const d = sourcesFor(store, h.id);
    for (const r of d.rows) {
      const m = all[r.key] || (all[r.key] = { key: r.key, earned: 0, lost: 0, net: 0, count: 0 });
      m.earned += r.earned; m.lost += r.lost; m.net += r.net; m.count += r.count;
    }
    earned += d.earned; lost += d.lost; net += d.net;
  }
  return { rows: Object.values(all).sort((a, b) => catRank(a.key) - catRank(b.key)), earned, lost, net };
}

// The takeaway, in the teacher's own terms: is the game driving behaviour, or
// is he simply handing points out? That question is the reason this panel exists.
function insightFor(who, data, isClass) {
  const name = escapeHtml(who);
  if (!data.earned) {
    return `Nothing has been recorded for <b>${name}</b> yet — the takeaway appears as soon as the first points land.`;
  }
  const ranked = data.rows.filter((r) => r.earned > 0).sort((a, b) => b.earned - a.earned);
  const top = ranked[0];
  const pct = Math.round((top.earned / data.earned) * 100);
  const manual = data.rows.find((r) => r.key === 'manual');
  const manualPct = Math.round(((manual ? manual.earned : 0) / data.earned) * 100);

  let line;
  if (top.key === 'manual') {
    line = `Most of <b>${name}</b>’s points came from <b>your own awards</b> — ${pct}% of everything earned. The games and quests are driving the other ${100 - pct}%.`;
  } else {
    line = `<b>${escapeHtml(catMeta(top.key).name)}</b> ${catMeta(top.key).name.endsWith('s') ? 'are' : 'is'} <b>${name}</b>’s biggest source — ${pct}% of everything earned`;
    line += manualPct >= 1 ? `, with your own awards at ${manualPct}%.` : `, and you have handed out almost nothing by hand.`;
  }
  if (data.lost > 0) {
    const lostTop = data.rows.filter((r) => r.lost > 0).sort((a, b) => b.lost - a.lost)[0];
    line += ` ${isClass ? 'They have' : `${name} has`} also given up <b>${data.lost}</b> points, mostly to <b>${escapeHtml(catMeta(lostTop.key).name)}</b>.`;
  }
  return line;
}

function stackBar(rows, total) {
  if (!total) {
    return `<div class="hse-stack"><div class="flex-1 flex items-center justify-center hse-sub">No points earned yet</div></div>`;
  }
  return `<div class="hse-stack">
    ${rows.filter((r) => r.earned > 0).map((r) => {
      const pct = (r.earned / total) * 100;
      const m = catMeta(r.key);
      return `<div class="hse-seg-piece" style="width:${pct.toFixed(2)}%; background:${m.color};"
        title="${escapeHtml(m.name)}: ${r.earned} points earned from ${r.count} ${r.count === 1 ? 'entry' : 'entries'}">${pct >= 9 ? r.earned : ''}</div>`;
    }).join('')}
  </div>`;
}

function renderBreakdown(store, s) {
  const allMode = s.scope === 'all';
  const houses = Object.values(store.HOUSES);
  const data = allMode ? combinedSources(store) : sourcesFor(store, Number(s.scope));
  const who = allMode ? 'the class' : store.HOUSES[Number(s.scope)].name;
  // Tint the takeaway with whichever house is on screen so the panel, the
  // header pill and the highlighted chart line all read as one selection.
  const raw = allMode ? '#f59e0b' : store.HOUSES[Number(s.scope)].accent;
  const acc = /^#[0-9a-f]{6}$/i.test(raw) ? raw : '#f59e0b';

  const legend = `
    <div class="flex items-center gap-x-3 gap-y-1 flex-wrap">
      ${data.rows.filter((r) => r.earned > 0).map((r) => `
        <span class="hse-legend-item">
          <span class="hse-swatch" style="background:${catMeta(r.key).color}"></span>
          <span class="text-sm font-semibold" style="color:var(--color-text)">${escapeHtml(catMeta(r.key).name)}</span>
        </span>`).join('') || '<span class="hse-sub">No sources yet</span>'}
    </div>`;

  // All Houses: four comparable bars. One house: the same bar plus the detail
  // table, which is where the counts and net values live.
  const body = allMode
    ? `<div class="flex flex-col gap-2">
        ${houses.map((h) => {
          const d = sourcesFor(store, h.id);
          return `<div class="hse-srow">
            <span class="flex items-center gap-2 min-w-0">
              ${houseImg(h, 'h-7 w-auto object-contain shrink-0')}
              <span class="font-bold text-sm truncate" style="color:${h.accent}">${escapeHtml(h.name)}</span>
            </span>
            ${stackBar(d.rows, d.earned)}
            <span class="text-right leading-tight">
              <span class="font-extrabold text-base" style="color:var(--color-text)">${d.net}</span>
              <span class="hse-sub block">+${d.earned} / −${d.lost}</span>
            </span>
          </div>`;
        }).join('')}
      </div>`
    : `<div class="flex flex-col gap-2">
        ${stackBar(data.rows, data.earned)}
        <div>
          <table class="w-full text-sm" style="color:var(--color-text)">
            <thead><tr class="hse-sub text-left">
              <th class="font-semibold py-1">Source</th>
              <th class="font-semibold py-1 text-right">Entries</th>
              <th class="font-semibold py-1 text-right">Earned</th>
              <th class="font-semibold py-1 text-right">Lost</th>
              <th class="font-semibold py-1 text-right">Net</th>
            </tr></thead>
            <tbody>
              ${data.rows.length ? data.rows.map((r) => `
                <tr style="border-top:1px solid var(--color-line)">
                  <td class="py-1.5"><span class="inline-flex items-center gap-2">
                    <span class="hse-swatch" style="background:${catMeta(r.key).color}"></span>${escapeHtml(catMeta(r.key).name)}
                  </span></td>
                  <td class="py-1.5 text-right">${r.count}</td>
                  <td class="py-1.5 text-right text-emerald-400 font-bold">${r.earned ? `+${r.earned}` : '—'}</td>
                  <td class="py-1.5 text-right text-red-400 font-bold">${r.lost ? `−${r.lost}` : '—'}</td>
                  <td class="py-1.5 text-right font-extrabold">${r.net}</td>
                </tr>`).join('') : `<tr><td colspan="5" class="py-3 hse-sub">Nothing recorded for this house yet.</td></tr>`}
            </tbody>
          </table>
        </div>
      </div>`;

  return `
    <div class="hse-card hse-in p-3 xl:p-4 flex flex-col gap-2.5 h-full min-h-0">
      <div class="flex items-end justify-between gap-3 flex-wrap">
        <div>
          <div class="hse-eyebrow">Where the points came from</div>
          <div class="hse-sub hse-hide-short">${allMode ? 'All four houses, whole term.' : `${escapeHtml(who)}, whole term.`}</div>
        </div>
        ${allMode ? legend : ''}
      </div>
      <div class="flex-1 min-h-0 overflow-y-auto hse-scroll pr-1 flex flex-col gap-2.5">
        <div class="hse-insight" style="background:${acc}1f; border-color:${acc}77;">${insightFor(who, data, allMode)}</div>
        ${body}
      </div>
    </div>`;
}

// ============================================================================
// 4. AWARD ROUTINES — the teacher's one-tap presets
// ============================================================================

function renderAwards(store, s) {
  const allMode = s.scope === 'all';
  const house = allMode ? null : store.HOUSES[Number(s.scope)];
  const accent = allMode ? '#f59e0b' : house.accent;
  const soft = allMode ? 'rgba(245,158,11,0.35)' : house.accentSoft;
  const presets = store.getAwardPresets();

  const target = allMode
    ? `<div class="hse-target hse-allmode" style="border-color:${accent}; color:${accent};">
         <span>🏰</span><span>Awarding ALL FOUR HOUSES</span>
       </div>`
    : `<div class="hse-target" style="border-color:${accent}; background:${soft}; color:${accent};">
         ${houseImg(house, 'h-6 w-auto object-contain')}<span>Awarding ${escapeHtml(house.name)}</span>
       </div>`;

  return `
    <div class="hse-card hse-in p-3 xl:p-4 flex flex-col gap-2.5 h-full min-h-0 relative" id="hse-award-anchor">
      <div class="flex items-start justify-between gap-2 flex-wrap">
        <div>
          <div class="hse-eyebrow">Award Routines</div>
          <div class="hse-sub hse-hide-short">One tap. Everything lands in the ledger below.</div>
        </div>
      </div>
      ${target}
      <div class="flex-1 min-h-0 overflow-y-auto hse-scroll pr-1 grid grid-cols-2 gap-2 content-start">
        ${presets.length ? presets.map((p) => {
          const up = p.points >= 0;
          return `<button type="button" class="hse-btn hse-preset ${allMode ? 'hse-allmode' : ''}" data-preset="${escapeHtml(p.id)}"
            style="${up
              ? `background:${allMode ? 'transparent' : soft}; border-color:${accent}; color:var(--color-text);`
              : 'background:rgba(239,68,68,0.14); border-color:rgba(239,68,68,0.5); color:var(--color-text);'}">
            <span class="truncate">${escapeHtml(p.label)}</span>
            <span class="shrink-0 font-extrabold" style="color:${up ? accent : '#f87171'}">${signed(p.points)}${allMode ? ' ea' : ''}</span>
          </button>`;
        }).join('') : '<div class="hse-sub">No presets yet — add them in Admin → Settings.</div>'}
      </div>
      <div class="hse-sub">Presets are edited in <b>Admin → Settings</b>.<span class="hse-hide-short"> Mistake? Undo it in the ledger below.</span></div>
    </div>`;
}

// ============================================================================
// 3. THE FULL LEDGER
// ============================================================================

const LEDGER_RENDER_CAP = 400; // the DOM cap only — CSV export always covers everything

// One place decides what "currently filtered" means, so the row list, the
// count/net line and the CSV export can never disagree with each other.
function filteredTxs(store, s) {
  const txs = store.getTransactions({
    houseId: s.scope === 'all' ? null : Number(s.scope),
    from: s.from || null,
    to: s.to || null,
    search: s.search || '',
    limit: null,
  });
  return s.cat === 'all' ? txs : txs.filter((t) => catOf(t.tag) === s.cat);
}

function categoriesInUse(store) {
  const seen = new Set(store.getState().transactions.map((t) => catOf(t.tag)));
  return [...seen].sort((a, b) => catRank(a) - catRank(b));
}

function renderLedgerRows(store, s) {
  const txs = filteredTxs(store, s);
  const showHouse = s.scope === 'all';
  if (!txs.length) {
    return `<div class="p-6 text-center hse-sub">Nothing matches these filters. ${
      (s.cat !== 'all' || s.from || s.to || s.search) ? 'Try <b>Clear filters</b>.' : 'No point activity recorded yet.'}</div>`;
  }
  const shown = txs.slice(0, LEDGER_RENDER_CAP);
  const rows = shown.map((t) => {
    const h = store.HOUSES[t.houseId];
    const up = t.delta > 0;
    const m = catMeta(catOf(t.tag));
    return `
      <div class="hse-tx-row flex items-center gap-2.5 py-1.5 px-1 rounded-lg" data-tx-row="${t.id}">
        <span class="text-sm w-32 shrink-0" style="color:var(--color-text-soft)">${escapeHtml(fmtWhen(t.ts))}</span>
        ${showHouse ? `
        <span class="flex items-center gap-1.5 w-28 shrink-0 min-w-0">
          <span class="w-2.5 h-2.5 rounded-full shrink-0" style="background:${h ? h.accent : '#666'}"></span>
          <span class="text-sm font-semibold truncate" style="color:${h ? h.accent : '#9ca3af'}">${h ? escapeHtml(h.name) : '—'}</span>
        </span>` : ''}
        <span class="font-extrabold w-16 text-base shrink-0 text-right ${up ? 'text-emerald-400' : 'text-red-400'}">${signed(t.delta)}</span>
        <span class="flex-1 min-w-0 flex items-center gap-2">
          <span class="text-sm truncate" style="color:var(--color-text)">${escapeHtml(t.reason || 'Points adjustment')}</span>
          <span class="hse-tag-badge shrink-0" style="border-color:${m.color}66; color:${m.color}; background:${m.color}1a;">${escapeHtml(m.short)}</span>
        </span>
        <button type="button" class="hse-undo-btn shrink-0" data-undo="${t.id}" aria-label="Remove this entry" title="Remove this entry">✕</button>
      </div>`;
  }).join('');
  const capped = txs.length > shown.length
    ? `<div class="py-3 text-center hse-sub">Showing the ${shown.length} most recent of ${txs.length} matching entries — narrow the filters, or export the CSV for the lot.</div>`
    : '';
  return rows + capped;
}

function renderLedgerStats(store, s) {
  const txs = filteredTxs(store, s);
  const net = txs.reduce((n, t) => n + t.delta, 0);
  const filtered = s.cat !== 'all' || s.from || s.to || s.search || s.scope !== 'all';
  return `<span class="font-bold" style="color:var(--color-text)">${txs.length}</span> ${txs.length === 1 ? 'entry' : 'entries'}${filtered ? ' shown' : ''} ·
    net <span class="font-extrabold ${net >= 0 ? 'text-emerald-400' : 'text-red-400'}">${signed(net)}</span>`;
}

function renderLedger(store, s) {
  const cats = categoriesInUse(store);
  const dirty = s.cat !== 'all' || s.from || s.to || s.search;
  return `
    <div class="hse-card hse-in p-3 xl:p-4 flex flex-col gap-2 flex-1 min-h-0" style="min-height:150px;">
      <div class="flex items-center gap-3 flex-wrap">
        <div>
          <div class="hse-eyebrow">The Ledger${s.scope === 'all' ? '' : ` — ${escapeHtml(store.HOUSES[Number(s.scope)].name)}`}</div>
          <div class="hse-sub" id="hse-ledger-stats">${renderLedgerStats(store, s)}</div>
        </div>
        <div class="ml-auto flex items-center gap-2 flex-wrap">
          <label class="sr-only" for="hse-cat">Category</label>
          <select id="hse-cat" class="hse-input" data-filter="cat" aria-label="Filter by category">
            <option value="all"${s.cat === 'all' ? ' selected' : ''}>All categories</option>
            ${cats.map((c) => `<option value="${c}"${s.cat === c ? ' selected' : ''}>${escapeHtml(catMeta(c).name)}</option>`).join('')}
          </select>
          <input type="date" class="hse-input" style="width:138px" data-filter="from" value="${escapeHtml(s.from)}" aria-label="From date" title="Only show entries on or after this date" />
          <input type="date" class="hse-input" style="width:138px" data-filter="to" value="${escapeHtml(s.to)}" aria-label="To date" title="Only show entries on or before this date" />
          <input type="search" id="hse-search" class="hse-input" style="width:170px" placeholder="Search reasons…"
            value="${escapeHtml(s.search)}" aria-label="Search the reason text" />
          <button type="button" class="hse-btn hse-input font-bold" data-clear-filters ${dirty ? '' : 'hidden'}>Clear filters</button>
          <button type="button" class="hse-btn hse-input font-extrabold" data-export
            style="background:var(--accent); border-color:var(--accent); color:#0b0f19;">⬇ Export CSV</button>
        </div>
      </div>
      <div class="flex-1 min-h-0 overflow-y-auto hse-scroll pr-1" id="hse-ledger-body">${renderLedgerRows(store, s)}</div>
      <div class="hse-sub hse-hide-short">Tap ✕ on any line to undo it — you will be asked to confirm first.</div>
    </div>`;
}

// ---- CSV export ------------------------------------------------------------

function csvCell(v) {
  const str = String(v == null ? '' : v);
  return /[",\r\n]/.test(str) ? `"${str.replace(/"/g, '""')}"` : str;
}

function buildCsv(store, txs) {
  const head = ['Date', 'Time', 'House', 'Points', 'Reason', 'Category'];
  const lines = [head.join(',')];
  for (const t of txs) {
    const d = new Date(t.ts);
    const h = store.HOUSES[t.houseId];
    lines.push([
      isoDay(d),
      d.toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit', hour12: false }),
      h ? h.name : `House ${t.houseId}`,
      t.delta,
      t.reason || '',
      catMeta(catOf(t.tag)).name,
    ].map(csvCell).join(','));
  }
  return lines.join('\r\n');
}

function downloadCsv(store, s) {
  const txs = filteredTxs(store, s);
  if (!txs.length) return 0;
  // Oldest-first reads like a register and sorts correctly in a spreadsheet.
  const csv = buildCsv(store, txs.slice().reverse());
  // The BOM is what makes Excel open a UTF-8 CSV without mangling accents.
  const blob = new Blob(['\uFEFF' + csv], { type: 'text/csv;charset=utf-8;' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = `house-points-${s.scope === 'all' ? 'all-houses' : (store.HOUSES[Number(s.scope)].name.toLowerCase().replace(/[^a-z0-9]+/g, '-'))}-${isoDay(new Date())}.csv`;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 2000);
  return txs.length;
}

// ---- undo confirm modal ----------------------------------------------------

function renderConfirmModal(store, s) {
  if (!s.confirmTxId) return '';
  const t = store.getState().transactions.find((x) => x.id === s.confirmTxId);
  if (!t) return '';
  const h = store.HOUSES[t.houseId];
  if (!h) return '';
  const before = store.getTotal(h.id, 'term');
  const after = before - t.delta;
  const m = catMeta(catOf(t.tag));
  const warn = tagWarning(t);
  const reasonLabel = t.reason || m.name;
  return `
    <div class="hse-modal-bg" data-action="hse-modal-cancel"></div>
    <div class="hse-modal" role="dialog" aria-modal="true" aria-labelledby="hse-modal-title">
      <div class="hse-modal-head">
        <div id="hse-modal-title" class="hse-modal-title">Remove this entry?</div>
        <button type="button" class="hse-modal-x" data-action="hse-modal-cancel" aria-label="Cancel, keep this entry">✕</button>
      </div>
      <div class="hse-modal-body">
        <p class="hse-modal-lead">Remove &ldquo;<b>${signed(t.delta)} ${escapeHtml(reasonLabel)}</b>&rdquo; from
          <b style="color:${h.accent}">${escapeHtml(h.name)}</b>?
          ${escapeHtml(h.name)}&rsquo;s total will go from <b>${before}</b> to <b>${after}</b>.</p>
        <div class="hse-modal-meta">Logged ${escapeHtml(new Date(t.ts).toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' }))} at ${escapeHtml(fmtClock(t.ts))}</div>
        ${warn ? `<div class="hse-modal-warn">⚠️ ${warn}</div>` : ''}
      </div>
      <div class="hse-modal-foot">
        <button type="button" class="hse-modal-btn hse-modal-btn-cancel" data-action="hse-modal-cancel">Cancel</button>
        <button type="button" class="hse-modal-btn hse-modal-btn-danger" data-action="hse-modal-confirm" data-tx="${t.id}">Remove entry</button>
      </div>
    </div>`;
}

function showToast(host, message) {
  if (!host) return;
  const t = document.createElement('div');
  t.className = 'hse-toast';
  t.textContent = message;
  host.appendChild(t);
  setTimeout(() => {
    t.classList.add('hse-toast-out');
    t.addEventListener('animationend', () => t.remove(), { once: true });
    setTimeout(() => { if (t.parentNode) t.remove(); }, 400);
  }, 1900);
}

function floatFeedback(anchorEl, delta) {
  if (!anchorEl) return;
  const badge = document.createElement('div');
  badge.className = 'hse-float';
  badge.style.color = delta > 0 ? '#34d399' : '#f87171';
  badge.textContent = signed(delta);
  anchorEl.appendChild(badge);
  badge.addEventListener('animationend', () => badge.remove());
  setTimeout(() => { if (badge.parentNode) badge.remove(); }, 1400);
}

// ============================================================================
// COMPOSITION
// ============================================================================

function render(root, ctx, s) {
  const store = ctx.store;
  root.innerHTML = `
    <div class="hse-page h-full w-full p-3 xl:p-5 flex flex-col gap-3 xl:gap-4 overflow-y-auto hse-scroll">
      ${renderHeader(store, s)}
      ${renderArc(store, s)}
      <div class="hse-midrow grid grid-cols-1 xl:grid-cols-3 gap-3 xl:gap-4 shrink-0 min-h-0">
        <div class="xl:col-span-2 min-w-0 min-h-0">${renderBreakdown(store, s)}</div>
        <div class="min-w-0 min-h-0">${renderAwards(store, s)}</div>
      </div>
      ${renderLedger(store, s)}
    </div>
    <div id="hse-modal-root">${renderConfirmModal(store, s)}</div>
  `;
}

export default {
  id: 'houses',
  title: 'Records',
  icon: '📜',
  order: 15,
  showTile: true,

  mount(el, ctx) {
    ensureStyle();
    const store = ctx.store;
    const s = initInternalState(store);

    // Toast host lives on <body>: every store change re-renders `el`, which
    // would otherwise wipe out a toast mid-animation.
    const toastHost = document.createElement('div');
    toastHost.className = 'hse-toast-host';
    document.body.appendChild(toastHost);

    // Full re-render, preserving where the teacher had scrolled the ledger.
    const doRender = () => {
      const prev = el.querySelector('#hse-ledger-body');
      const top = prev ? prev.scrollTop : 0;
      const search = el.querySelector('#hse-search');
      const caret = (search && document.activeElement === search) ? search.selectionStart : null;
      render(el, ctx, s);
      const next = el.querySelector('#hse-ledger-body');
      if (next && top) next.scrollTop = top;
      if (caret != null) {
        const box = el.querySelector('#hse-search');
        if (box) { box.focus(); box.setSelectionRange(caret, caret); }
      }
    };

    // Typing in the search box must not rebuild the inputs underneath the
    // caret, so ledger-only filter changes patch just the rows and the counts.
    const refreshLedger = () => {
      const body = el.querySelector('#hse-ledger-body');
      const stats = el.querySelector('#hse-ledger-stats');
      if (body) body.innerHTML = renderLedgerRows(store, s);
      if (stats) stats.innerHTML = renderLedgerStats(store, s);
      const clear = el.querySelector('[data-clear-filters]');
      // Toggle rather than re-render: rebuilding the toolbar would yank the
      // search box out from under the caret on the very first keystroke.
      if (clear) clear.hidden = !(s.cat !== 'all' || s.from || s.to || s.search);
    };

    doRender();

    const award = (points, label, tag) => {
      const allMode = s.scope === 'all';
      if (allMode) {
        store.awardAll(points, { reason: label, tag: tag || 'manual' });
      } else {
        store.addPoints(Number(s.scope), points, { reason: label, tag: tag || 'manual' });
      }
      ctx.audio.sfx(points > 0 ? 'coin' : 'thud');
      floatFeedback(el.querySelector('#hse-award-anchor'), points);
      const target = allMode ? 'all four houses' : store.HOUSES[Number(s.scope)].name;
      showToast(toastHost, `${signed(points)} ${label} → ${target}`);
    };

    const clickHandler = (e) => {
      const scopeBtn = e.target.closest('[data-scope]');
      if (scopeBtn) {
        const v = scopeBtn.getAttribute('data-scope');
        s.scope = v === 'all' ? 'all' : Number(v);
        doRender();
        return;
      }

      const chartBtn = e.target.closest('[data-chart]');
      if (chartBtn) { s.chartMode = chartBtn.getAttribute('data-chart'); doRender(); return; }

      const presetBtn = e.target.closest('[data-preset]');
      if (presetBtn) {
        const p = store.getAwardPresets().find((x) => x.id === presetBtn.getAttribute('data-preset'));
        if (p) award(Math.round(Number(p.points) || 0), p.label, p.tag);
        return;
      }

      if (e.target.closest('[data-clear-filters]')) {
        s.cat = 'all'; s.from = ''; s.to = ''; s.search = '';
        doRender();
        return;
      }

      if (e.target.closest('[data-export]')) {
        const n = downloadCsv(store, s);
        showToast(toastHost, n ? `Exported ${n} ${n === 1 ? 'entry' : 'entries'} to CSV` : 'Nothing to export');
        return;
      }

      // ---- undo: open the confirm modal, never delete on first tap ----
      const undoBtn = e.target.closest('[data-undo]');
      if (undoBtn) { s.confirmTxId = undoBtn.getAttribute('data-undo'); doRender(); return; }

      if (e.target.closest('[data-action="hse-modal-cancel"]')) { s.confirmTxId = null; doRender(); return; }

      const modalConfirm = e.target.closest('[data-action="hse-modal-confirm"]');
      if (modalConfirm) {
        const txId = modalConfirm.getAttribute('data-tx');
        const tx = store.getState().transactions.find((t) => t.id === txId);
        s.confirmTxId = null;
        doRender(); // Cancel and Confirm both dismiss the modal immediately
        if (!tx) return;
        const house = store.HOUSES[tx.houseId];
        const row = el.querySelector(`[data-tx-row="${CSS.escape(txId)}"]`);
        let done = false;
        const finish = () => {
          if (done) return;
          done = true;
          store.removeTransaction(txId); // store subscribe -> doRender() with updated totals
          ctx.audio.sfx('thud');          // quiet: this is a correction, not a reward
          showToast(toastHost, `Removed ${signed(tx.delta)}${house ? ` from ${house.name}` : ''}`);
        };
        if (row) {
          row.classList.add('hse-row-out');
          row.addEventListener('animationend', finish, { once: true });
          setTimeout(finish, 420); // safety net when animations are off (reduced motion)
        } else {
          finish();
        }
      }
    };
    el.addEventListener('click', clickHandler);

    const changeHandler = (e) => {
      const f = e.target.closest('[data-filter]');
      if (!f) return;
      s[f.getAttribute('data-filter')] = f.value;
      refreshLedger();
    };
    el.addEventListener('change', changeHandler);

    const inputHandler = (e) => {
      if (e.target.id !== 'hse-search') return;
      s.search = e.target.value;
      refreshLedger();
    };
    el.addEventListener('input', inputHandler);

    const keyHandler = (e) => {
      if (e.key === 'Escape' && s.confirmTxId) { s.confirmTxId = null; doRender(); }
    };
    document.addEventListener('keydown', keyHandler);

    // Follow the top-bar core switcher: changing class up there should change
    // whose records are on screen. ('All Cores' navigates away to the Council,
    // so it never reaches us.) A choice made with the pills here otherwise stands.
    const unsub = store.subscribe(() => {
      const core = store.getState().activeCore;
      if (core !== s.lastActiveCore) {
        s.lastActiveCore = core;
        if (core !== 'all' && store.HOUSES[core]) s.scope = store.HOUSES[core].id;
      }
      doRender();
    });

    this._el = el;
    this._clickHandler = clickHandler;
    this._changeHandler = changeHandler;
    this._inputHandler = inputHandler;
    this._keyHandler = keyHandler;
    this._unsub = unsub;
    this._toastHost = toastHost;
  },

  unmount() {
    if (this._unsub) { this._unsub(); this._unsub = null; }
    if (this._el) {
      if (this._clickHandler) this._el.removeEventListener('click', this._clickHandler);
      if (this._changeHandler) this._el.removeEventListener('change', this._changeHandler);
      if (this._inputHandler) this._el.removeEventListener('input', this._inputHandler);
    }
    if (this._keyHandler) { document.removeEventListener('keydown', this._keyHandler); this._keyHandler = null; }
    if (this._toastHost) { this._toastHost.remove(); this._toastHost = null; }
    this._el = null;
    this._clickHandler = null;
    this._changeHandler = null;
    this._inputHandler = null;
  },
};
