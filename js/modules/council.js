// council.js — Council of Four: the neutral, all-houses standings screen.
//
// Reached by choosing "All Cores" in the top bar. Deliberately has NO module
// tiles, NO scoring controls and NO single-house hero: nobody owns this screen.
// Four heraldic banners stand side by side, their HEIGHT driven by score, so
// the standings read as shapes from the back of the classroom before anyone
// reads a number.
//
// Everything (name, accent, crest, motto) is read from store.HOUSES at render
// time — the teacher can rename/recolour houses in Admin and this follows.
//
// The DOM skeleton is built ONCE and afterwards only mutated (heights, order,
// text). That is what makes the live reaction work: rebuilding the markup on
// every store change would restart every CSS transition and the banners would
// snap instead of rising.

import { escapeHtml } from '../core/escape.js';

const STYLE_ID = 'council-styles';

// Banner height envelope, as a % of the arena. MAX leaves headroom above the
// tallest banner for its crest and crown; MIN keeps a last-place (or negative)
// house comfortably readable. BASE is the "everybody is level" height.
const MIN_PCT = 32;
const MAX_PCT = 72;
const BASE_PCT = 47;

const SPRING = 'cubic-bezier(.34,1.42,.5,1)';
const MOVE_MS = 700;

const STYLE = `
.council-root {
  position: relative; height: 100%; width: 100%; overflow: hidden;
  display: flex; flex-direction: column;
  background:
    radial-gradient(130% 70% at 50% -12%, rgba(245,158,11,0.13), transparent 62%),
    radial-gradient(80% 55% at 50% 112%, rgba(148,163,184,0.14), transparent 65%),
    linear-gradient(180deg, #0c111d 0%, #0f1526 46%, #070a12 100%);
}
/* Council-chamber rays fanning out from the table, pure CSS. */
.council-rays {
  position: absolute; inset: 0; pointer-events: none; opacity: .8;
  background: repeating-conic-gradient(from 192deg at 50% 122%,
    rgba(253,230,180,0.075) 0deg 2.6deg, transparent 2.6deg 12deg);
  -webkit-mask-image: radial-gradient(95% 105% at 50% 120%, #000 10%, transparent 80%);
  mask-image: radial-gradient(95% 105% at 50% 120%, #000 10%, transparent 80%);
}
/* Vignette so the corners fall away and the banners hold the eye. */
.council-vignette {
  position: absolute; inset: 0; pointer-events: none;
  background: radial-gradient(120% 95% at 50% 42%, transparent 48%, rgba(0,0,0,0.62) 100%);
}

/* ---------------- header ---------------- */
.council-head {
  position: relative; z-index: 3; flex: 0 0 auto;
  padding: clamp(6px,1.6vh,20px) clamp(12px,2vw,34px) clamp(2px,0.8vh,10px);
  display: flex; align-items: center; justify-content: center;
}
.council-titlewrap { text-align: center; }
.council-title {
  font-family: Cinzel, Georgia, serif; font-weight: 800;
  font-size: clamp(1.5rem, 4.4vh, 3.35rem); line-height: 1.05;
  letter-spacing: 0.12em; color: #fdf5e2;
  text-shadow: 0 0 26px rgba(245,158,11,0.42), 0 3px 12px rgba(0,0,0,0.8);
}
.council-rule {
  height: 2px; margin: clamp(3px,0.7vh,9px) auto 0; width: min(760px, 62vw);
  background: linear-gradient(90deg, transparent, rgba(245,158,11,0.55) 22%, rgba(245,158,11,0.85) 50%, rgba(245,158,11,0.55) 78%, transparent);
}
.council-sub {
  margin-top: clamp(2px,0.6vh,8px);
  font-size: clamp(0.62rem, 1.5vh, 0.95rem); letter-spacing: 0.32em;
  text-transform: uppercase; color: #9ca3af; font-weight: 600;
}
.council-scope {
  position: absolute; right: clamp(12px,2vw,34px); top: 50%; transform: translateY(-50%);
  display: flex; gap: 4px; padding: 4px; border-radius: 999px;
  background: rgba(17,24,39,0.72); border: 1px solid #374151;
  backdrop-filter: blur(6px);
}
.council-scope button {
  min-height: 40px; padding: 0 clamp(10px,1.1vw,18px); border-radius: 999px;
  font-size: clamp(0.6rem, 1.3vh, 0.8rem); font-weight: 700; letter-spacing: 0.12em;
  text-transform: uppercase; color: #9ca3af; transition: color 180ms ease, background 180ms ease;
}
.council-scope button:hover { color: #e5e7eb; }
.council-scope button[aria-pressed="true"] {
  color: #0b0f19; background: linear-gradient(180deg, #fbbf24, #f59e0b);
  box-shadow: 0 2px 10px rgba(245,158,11,0.4);
}

/* ---------------- arena ---------------- */
.council-arena { position: relative; z-index: 2; flex: 1 1 auto; min-height: 0; margin: 0 clamp(6px,1.4vw,30px); }
/* The round table itself: a circle laid flat in perspective. Only its far arc
   clears the banners, which is exactly the read we want — a chamber, not a chart. */
.council-table {
  position: absolute; left: 50%; bottom: -28%; width: min(70%, 1120px); aspect-ratio: 1 / 1;
  transform: translateX(-50%) perspective(1000px) rotateX(78deg);
  border-radius: 50%; pointer-events: none;
  border: 2px solid rgba(245,158,11,0.30);
  background:
    radial-gradient(circle at 50% 50%, rgba(245,158,11,0.10) 0%, rgba(120,80,20,0.10) 55%, rgba(245,158,11,0.16) 88%, transparent 100%);
  box-shadow: 0 0 90px 20px rgba(245,158,11,0.10);
}
.council-table::before {
  content: ''; position: absolute; inset: 12%; border-radius: 50%;
  border: 1px solid rgba(245,158,11,0.16);
}
.council-glow {
  position: absolute; left: 50%; bottom: -10%; transform: translateX(-50%);
  width: 96%; height: 34%; border-radius: 50%; pointer-events: none;
  background: radial-gradient(ellipse at 50% 60%, rgba(245,158,11,0.16), rgba(11,15,25,0) 70%);
}
.council-floorline {
  position: absolute; left: 1%; right: 1%; bottom: 0; height: 2px; pointer-events: none;
  background: linear-gradient(90deg, transparent, rgba(245,158,11,0.5) 18%, rgba(245,158,11,0.55) 82%, transparent);
  box-shadow: 0 0 22px 3px rgba(245,158,11,0.18);
}

.council-col {
  position: absolute; top: 0; bottom: 0; width: 25%;
  padding: 0 clamp(4px, 0.8vw, 20px);
  display: flex; flex-direction: column; align-items: center; justify-content: flex-end;
  transition: left ${MOVE_MS}ms ${SPRING};
}
.council-crown {
  font-size: clamp(1.1rem, 3vh, 2.2rem); line-height: 1;
  opacity: 0; transform: translateY(8px) scale(.7);
  transition: opacity 420ms ease, transform 420ms ${SPRING};
  filter: drop-shadow(0 0 12px rgba(245,158,11,0.85));
  margin-bottom: clamp(1px, 0.4vh, 6px);
}
.council-col[data-lead="true"] .council-crown {
  opacity: 1; transform: translateY(0) scale(1);
  animation: council-crown-float 3.4s ease-in-out infinite;
}
.council-crestwrap {
  position: relative; z-index: 3; display: flex; align-items: flex-end; justify-content: center;
  height: clamp(2.6rem, 8.4vh, 6.2rem);
  margin-bottom: clamp(-12px, -1vh, -4px);
}
.council-crest { height: 100%; width: auto; object-fit: contain;
  filter: drop-shadow(0 8px 18px rgba(0,0,0,0.7)) drop-shadow(0 0 14px var(--acc-soft, rgba(245,158,11,.35))); }
.council-crest-fallback { display: none; font-size: clamp(1.6rem, 5vh, 3rem); }
/* heraldic rod the banner hangs from — rides up and down with the banner top */
.council-rod {
  position: relative; z-index: 2; width: 106%; flex: 0 0 auto;
  height: clamp(3px, 0.55vh, 7px); border-radius: 999px; margin-bottom: -1px;
  background: linear-gradient(90deg, rgba(120,86,24,0.35), #d8b56b 18%, #f6e3ab 50%, #d8b56b 82%, rgba(120,86,24,0.35));
  box-shadow: 0 2px 10px rgba(0,0,0,0.6);
}

.council-banner {
  position: relative; z-index: 1; width: 100%;
  min-height: clamp(7rem, 18vh, 12rem);
  border-radius: clamp(10px, 1.4vh, 18px) clamp(10px, 1.4vh, 18px) 6px 6px;
  border: 1px solid var(--acc-line, rgba(255,255,255,0.16));
  border-bottom: none;
  background:
    linear-gradient(180deg, var(--acc-hi) 0%, var(--acc-mid) 46%, var(--acc-lo) 100%);
  box-shadow: 0 -2px 34px -6px var(--acc-glow), inset 0 1px 0 rgba(255,255,255,0.28);
  overflow: hidden;
  display: flex; flex-direction: column; align-items: center;
  padding: clamp(10px, 1.9vh, 24px) clamp(4px, 0.6vw, 12px) clamp(2.9rem, 7.2vh, 4.9rem);
  transition: height ${MOVE_MS}ms ${SPRING}, box-shadow 300ms ease;
}
/* faint heraldic weave so a flat colour block reads as cloth */
.council-banner::before {
  content: ''; position: absolute; inset: 0; pointer-events: none; opacity: .16;
  background:
    repeating-linear-gradient(115deg, rgba(255,255,255,0.14) 0 2px, transparent 2px 9px),
    radial-gradient(120% 60% at 50% 0%, rgba(255,255,255,0.30), transparent 60%);
}
/* leader shimmer — a slow light sweep down the cloth */
.council-banner::after {
  content: ''; position: absolute; top: -20%; bottom: -20%; width: 45%; left: 0;
  pointer-events: none; opacity: 0;
  background: linear-gradient(90deg, transparent, rgba(255,255,255,0.42), transparent);
}
.council-col[data-lead="true"] .council-banner::after {
  opacity: 1; animation: council-shimmer 4.2s cubic-bezier(.5,0,.5,1) infinite;
}
.council-col[data-lead="true"] .council-banner { box-shadow: 0 -2px 54px -2px var(--acc-glow), inset 0 1px 0 rgba(255,255,255,0.4); }

.council-name {
  font-family: Cinzel, Georgia, serif; font-weight: 800;
  font-size: clamp(0.85rem, 2.6vh, 2rem); line-height: 1.1; letter-spacing: 0.08em;
  color: #fff; text-shadow: 0 2px 10px rgba(0,0,0,0.6); text-align: center;
  max-width: 100%; overflow: hidden; text-overflow: ellipsis; white-space: nowrap;
}
.council-motto {
  font-size: clamp(0.52rem, 1.35vh, 0.85rem); font-style: italic; color: rgba(255,255,255,0.72);
  text-align: center; max-width: 100%; overflow: hidden; text-overflow: ellipsis; white-space: nowrap;
  margin-top: 1px;
}
.council-points {
  font-family: Cinzel, Georgia, serif; font-weight: 800;
  font-size: clamp(2rem, 7.6vh, 5.6rem); line-height: 1; color: #fff;
  margin-top: auto; margin-bottom: auto;
  text-shadow: 0 4px 22px rgba(0,0,0,0.55), 0 0 26px rgba(255,255,255,0.28);
  font-variant-numeric: tabular-nums;
}
.council-pts-label {
  font-size: clamp(0.5rem, 1.2vh, 0.75rem); letter-spacing: 0.3em; text-transform: uppercase;
  color: rgba(255,255,255,0.65); margin-top: -0.25em;
}
.council-delta {
  margin-top: clamp(2px, 0.8vh, 10px);
  display: inline-flex; align-items: center; gap: 6px;
  padding: clamp(1px,0.4vh,5px) clamp(6px,0.7vw,12px); border-radius: 999px;
  background: rgba(0,0,0,0.34); border: 1px solid rgba(255,255,255,0.18);
  font-size: clamp(0.56rem, 1.45vh, 0.95rem); font-weight: 700; color: #e5e7eb;
  white-space: nowrap;
}
.council-delta[data-dir="up"] { color: #86efac; }
.council-delta[data-dir="down"] { color: #fca5a5; }

/* plinth: rank medal at the base of the banner */
.council-base {
  position: absolute; left: 0; right: 0; bottom: 0;
  height: clamp(2.9rem, 7.2vh, 4.9rem);
  display: flex; flex-direction: row; align-items: center; justify-content: center;
  gap: clamp(6px, 0.8vw, 14px);
  background: linear-gradient(180deg, rgba(0,0,0,0.08), rgba(0,0,0,0.55));
  border-top: 1px solid rgba(255,255,255,0.22);
  box-shadow: inset 0 1px 0 rgba(255,255,255,0.14);
}
.council-medal { font-size: clamp(1.5rem, 4.4vh, 3rem); line-height: 1; filter: drop-shadow(0 2px 7px rgba(0,0,0,0.7)); }
.council-rank {
  font-family: Cinzel, Georgia, serif;
  font-size: clamp(0.62rem, 1.7vh, 1.15rem); letter-spacing: 0.22em; text-transform: uppercase;
  font-weight: 800; color: rgba(255,255,255,0.92); text-shadow: 0 2px 8px rgba(0,0,0,0.6);
}

/* rank-change reactions */
.council-col.is-drop .council-banner { animation: council-drop 760ms cubic-bezier(.36,.07,.19,.97) both; }
.council-col.is-rise .council-banner { animation: council-rise 760ms ease both; }

/* ---------------- ribbon ---------------- */
.council-ribbon {
  position: relative; z-index: 3; flex: 0 0 auto;
  display: flex; align-items: center; gap: clamp(8px,1.2vw,20px);
  height: clamp(2.6rem, 7.2vh, 4.4rem);
  padding: 0 clamp(12px,2vw,34px);
  background: linear-gradient(180deg, rgba(11,15,25,0.2), rgba(11,15,25,0.92));
  border-top: 1px solid rgba(245,158,11,0.22);
}
.council-ribbon-label {
  flex: 0 0 auto; font-family: Cinzel, Georgia, serif; font-weight: 800;
  font-size: clamp(0.55rem, 1.35vh, 0.85rem); letter-spacing: 0.28em; text-transform: uppercase;
  color: #f59e0b; text-shadow: 0 0 14px rgba(245,158,11,0.5);
}
.council-ribbon-track {
  flex: 1 1 auto; display: flex; align-items: center; gap: clamp(10px,1.6vw,30px);
  overflow: hidden; transition: opacity 220ms ease;
}
.council-ribbon-track.fading { opacity: 0; }
.council-ribbon-item {
  display: flex; align-items: baseline; gap: 8px; min-width: 0;
  font-size: clamp(0.6rem, 1.6vh, 1rem); color: #9ca3af; white-space: nowrap;
}
.council-ribbon-house { font-weight: 800; letter-spacing: 0.04em; }
.council-ribbon-delta { font-weight: 800; font-variant-numeric: tabular-nums; }
.council-ribbon-reason { overflow: hidden; text-overflow: ellipsis; }
.council-ribbon-dots { flex: 0 0 auto; display: flex; gap: 5px; }
.council-ribbon-dot { width: 6px; height: 6px; border-radius: 999px; background: #374151; transition: background 250ms ease; }
.council-ribbon-dot[data-on="true"] { background: #f59e0b; box-shadow: 0 0 8px rgba(245,158,11,0.7); }

@keyframes council-shimmer {
  0%   { transform: translateX(-60%) skewX(-16deg); }
  55%  { transform: translateX(300%) skewX(-16deg); }
  100% { transform: translateX(300%) skewX(-16deg); }
}
@keyframes council-crown-float {
  0%, 100% { transform: translateY(0) rotate(-4deg); }
  50%      { transform: translateY(-7px) rotate(4deg); }
}
@keyframes council-drop {
  0%   { transform: translateY(0); filter: none; }
  30%  { transform: translateY(10px); filter: saturate(.5) brightness(.72); }
  60%  { transform: translateY(3px); filter: saturate(.7) brightness(.85); }
  100% { transform: translateY(0); filter: none; }
}
@keyframes council-rise {
  0%   { transform: translateY(0); filter: none; }
  35%  { transform: translateY(-12px); filter: brightness(1.35); }
  100% { transform: translateY(0); filter: none; }
}
@keyframes council-enter { from { opacity: 0; transform: translateY(14px); } to { opacity: 1; transform: translateY(0); } }
.council-head, .council-ribbon { animation: council-enter 420ms ease both; }

@media (prefers-reduced-motion: reduce) {
  .council-col[data-lead="true"] .council-banner::after { opacity: 0; animation: none; }
  .council-col[data-lead="true"] .council-crown { animation: none; }
  .council-col, .council-banner, .council-crown { transition: none; }
}
`;

function ensureStyle() {
  if (document.getElementById(STYLE_ID)) return;
  const s = document.createElement('style');
  s.id = STYLE_ID;
  s.textContent = STYLE;
  document.head.appendChild(s);
}

function rgb(hex, fallback = [245, 158, 11]) {
  const m = /^#?([a-f\d]{2})([a-f\d]{2})([a-f\d]{2})$/i.exec(hex || '');
  if (!m) return fallback;
  return [1, 2, 3].map((i) => parseInt(m[i], 16));
}

function reducedMotion() {
  try { return window.matchMedia('(prefers-reduced-motion: reduce)').matches; } catch (e) { return false; }
}

const MEDALS = ['🥇', '🥈', '🥉', '🎖️'];
const ORDINALS = ['1st', '2nd', '3rd', '4th'];

// Score -> banner height. Handles the all-equal case (including a fresh term
// where every house is on zero) and negative totals without ever dividing by
// zero or letting a banner collapse out of sight.
function heightPct(total, hi, lo, allSame) {
  if (allSame || hi <= lo) return BASE_PCT;
  const t = (total - lo) / (hi - lo);
  return MIN_PCT + Math.max(0, Math.min(1, t)) * (MAX_PCT - MIN_PCT);
}

export default {
  id: 'council',
  title: 'Council of Four',
  icon: '⚖️',
  order: 12,
  showTile: false, // reached by selecting "All Cores" in the top bar

  // ---- instance state (module singletons, cleared in unmount) ----
  _el: null, _ctx: null, _unsub: null,
  _scope: 'term',
  _cols: null,           // houseId -> { refs… }
  _prevRank: null,       // houseId -> rank, for the drop/rise reaction
  _raf: 0,
  _timers: [],
  _ribbonTimer: 0,
  _ribbonPage: 0,
  _ribbonPaused: false,
  _clickHandler: null,
  _lastPointerType: 'mouse',   // what last touched the ribbon — see the pause wiring in mount()
  _pointerEnter: null, _pauseOn: null, _pauseOff: null, _pointerDown: null,

  mount(el, ctx) {
    ensureStyle();
    this._el = el;
    this._ctx = ctx;
    this._cols = new Map();
    this._prevRank = new Map();
    this._ribbonPage = 0;
    this._ribbonPaused = false;

    const houses = Object.values(ctx.store.HOUSES);

    el.innerHTML = `
      <div class="council-root">
        <div class="council-rays"></div>
        <div class="council-vignette"></div>

        <header class="council-head">
          <div class="council-titlewrap">
            <h1 class="council-title">&#9878;&#65039; COUNCIL OF FOUR</h1>
            <div class="council-rule"></div>
            <div class="council-sub" data-sub></div>
          </div>
          <div class="council-scope" role="group" aria-label="Standings scope">
            <button type="button" data-scope="term" aria-pressed="true">Term</button>
            <button type="button" data-scope="week" aria-pressed="false">This Week</button>
          </div>
        </header>

        <div class="council-arena" data-arena>
          <div class="council-table"></div>
          <div class="council-glow"></div>
          ${houses.map((h) => `
            <div class="council-col" data-house="${h.id}">
              <div class="council-crown">&#128081;</div>
              <div class="council-crestwrap">
                <img class="council-crest" data-crest alt="" />
                <span class="council-crest-fallback" data-crest-fallback>&#128737;&#65039;</span>
              </div>
              <div class="council-rod"></div>
              <div class="council-banner" data-banner>
                <div class="council-name" data-name></div>
                <div class="council-motto" data-motto></div>
                <div class="council-points" data-points>0</div>
                <div class="council-delta" data-delta></div>
                <div class="council-base">
                  <span class="council-medal" data-medal></span>
                  <span class="council-rank" data-rank></span>
                </div>
              </div>
            </div>
          `).join('')}
          <div class="council-floorline"></div>
        </div>

        <div class="council-ribbon" data-ribbon hidden>
          <span class="council-ribbon-label">Recent Decrees</span>
          <div class="council-ribbon-track" data-ribbon-track></div>
          <div class="council-ribbon-dots" data-ribbon-dots></div>
        </div>
      </div>
    `;

    el.querySelectorAll('.council-col').forEach((col) => {
      this._cols.set(Number(col.dataset.house), {
        col,
        crown: col.querySelector('.council-crown'),
        crest: col.querySelector('[data-crest]'),
        crestFallback: col.querySelector('[data-crest-fallback]'),
        banner: col.querySelector('[data-banner]'),
        name: col.querySelector('[data-name]'),
        motto: col.querySelector('[data-motto]'),
        points: col.querySelector('[data-points]'),
        delta: col.querySelector('[data-delta]'),
        medal: col.querySelector('[data-medal]'),
        rank: col.querySelector('[data-rank]'),
      });
    });

    this._clickHandler = (e) => {
      const btn = e.target.closest('[data-scope]');
      if (!btn) return;
      const scope = btn.dataset.scope === 'week' ? 'week' : 'term';
      if (scope === this._scope) return;
      this._scope = scope;
      this.update(true);
    };
    el.addEventListener('click', this._clickHandler);

    // Pause the ribbon while the teacher is reading it. Hover is a MOUSE
    // idea: on the touch smartboard a tap fires pointerdown (toggling the
    // pause), then the browser follows up with a SYNTHETIC mouseenter — which
    // used to instantly re-pause, so tapping to resume looked like a stuck
    // ribbon. Remember which kind of pointer touched the ribbon last
    // (pointerenter fires for both, before any synthetic mouse event) and let
    // the hover handlers act only when that was a real mouse.
    const ribbon = el.querySelector('[data-ribbon]');
    this._lastPointerType = 'mouse';
    this._pointerEnter = (ev) => { this._lastPointerType = ev.pointerType || 'mouse'; };
    this._pauseOn = () => { if (this._lastPointerType === 'mouse') this._ribbonPaused = true; };
    this._pauseOff = () => { if (this._lastPointerType === 'mouse') this._ribbonPaused = false; };
    this._pointerDown = (ev) => {
      if (ev.pointerType === 'mouse') return;   // mouse already handled by hover
      this._ribbonPaused = !this._ribbonPaused;
    };
    ribbon.addEventListener('pointerenter', this._pointerEnter);
    ribbon.addEventListener('mouseenter', this._pauseOn);
    ribbon.addEventListener('mouseleave', this._pauseOff);
    ribbon.addEventListener('pointerdown', this._pointerDown);

    this.update(true);

    this._ribbonTimer = setInterval(() => {
      if (this._ribbonPaused) return;
      this._ribbonPage += 1;
      this.renderRibbon(true);
    }, 5000);

    this._unsub = ctx.store.subscribe(() => this.update(false));
  },

  // first === true on mount / scope switch: paint without the rank-change
  // reaction (nothing was "overtaken", the teacher just arrived).
  update(first) {
    const el = this._el;
    const ctx = this._ctx;
    if (!el || !ctx) return;
    const { store } = ctx;

    const scope = this._scope;
    const totals = store.getTotals(scope);              // sorted desc
    const weekById = new Map(store.getTotals('week').map((t) => [t.house.id, t.total]));
    const termById = new Map(store.getTotals('term').map((t) => [t.house.id, t.total]));

    const values = totals.map((t) => t.total);
    const hi = Math.max(...values);
    const loRaw = Math.min(...values);
    const lo = Math.min(0, loRaw);
    const allSame = hi === loRaw;

    // term label + what we are looking at
    const sub = el.querySelector('[data-sub]');
    let termLabel = '';
    try { termLabel = store.getTermInfo().label || ''; } catch (e) { termLabel = ''; }
    sub.textContent = `${termLabel}${termLabel ? '  ·  ' : ''}${scope === 'week' ? 'This Week' : 'Term'} Standings`;

    el.querySelectorAll('[data-scope]').forEach((b) => {
      b.setAttribute('aria-pressed', String(b.dataset.scope === scope));
    });

    const reduce = reducedMotion();

    totals.forEach((entry, index) => {
      const h = entry.house;
      const refs = this._cols.get(h.id);
      if (!refs) return;

      const rank = 1 + totals.filter((o) => o.total > entry.total).length;
      const [r, g, b] = rgb(h.accent);

      refs.col.style.left = `${index * 25}%`;
      refs.col.style.setProperty('--acc-hi', `rgba(${r},${g},${b},0.98)`);
      refs.col.style.setProperty('--acc-mid', `rgba(${Math.round(r * 0.72)},${Math.round(g * 0.72)},${Math.round(b * 0.72)},0.95)`);
      refs.col.style.setProperty('--acc-lo', `rgba(${Math.round(r * 0.34)},${Math.round(g * 0.34)},${Math.round(b * 0.34)},0.96)`);
      refs.col.style.setProperty('--acc-glow', `rgba(${r},${g},${b},0.55)`);
      refs.col.style.setProperty('--acc-line', `rgba(${Math.min(255, r + 60)},${Math.min(255, g + 60)},${Math.min(255, b + 60)},0.75)`);
      refs.col.style.setProperty('--acc-soft', h.accentSoft || `rgba(${r},${g},${b},0.35)`);
      // A four-way tie (a brand-new term, typically) has no leader to crown —
      // the council is simply level, and four crowns would say nothing.
      refs.col.dataset.lead = String(rank === 1 && !allSame);

      refs.banner.style.height = `${heightPct(entry.total, hi, lo, allSame).toFixed(2)}%`;

      // crest — re-point only when it actually changed (teacher edit in Admin)
      const src = h.image || '';
      if (refs.crest.getAttribute('data-src') !== src) {
        refs.crest.setAttribute('data-src', src);
        refs.crest.style.display = '';
        refs.crestFallback.style.display = 'none';
        refs.crest.onerror = () => { refs.crest.style.display = 'none'; refs.crestFallback.style.display = 'block'; };
        refs.crest.src = src;
        refs.crest.alt = `${h.name} crest`;
      }

      if (refs.name.textContent !== h.name.toUpperCase()) refs.name.textContent = h.name.toUpperCase();
      const motto = h.motto ? `“${h.motto}”` : '';
      if (refs.motto.textContent !== motto) refs.motto.textContent = motto;

      refs.medal.textContent = allSame ? '⚖️' : (MEDALS[rank - 1] || MEDALS[3]);
      refs.rank.textContent = allSame ? 'Level' : (ORDINALS[rank - 1] || `${rank}th`);

      // "since last week": this week's net movement (in week scope the headline
      // number IS that, so show the term total for context instead).
      if (scope === 'week') {
        refs.delta.dataset.dir = 'flat';
        refs.delta.textContent = `Term ${termById.get(h.id) ?? 0}`;
      } else {
        const wk = weekById.get(h.id) ?? 0;
        refs.delta.dataset.dir = wk > 0 ? 'up' : (wk < 0 ? 'down' : 'flat');
        refs.delta.textContent = wk === 0 ? '— this week'
          : `${wk > 0 ? '▲' : '▼'} ${Math.abs(wk)} this week`;
      }

      // number count-up
      this.tweenNumber(refs.points, entry.total, reduce || first);

      // rank-change reaction: overtaken houses visibly drop, climbers surge.
      const prev = this._prevRank.get(h.id);
      if (!first && !reduce && prev != null && prev !== rank) {
        const cls = rank > prev ? 'is-drop' : 'is-rise';
        refs.col.classList.remove('is-drop', 'is-rise');
        // force a reflow so re-applying the same class restarts the animation
        void refs.col.offsetWidth;
        refs.col.classList.add(cls);
        const t = setTimeout(() => refs.col.classList.remove(cls), 820);
        this._timers.push(t);
      }
      this._prevRank.set(h.id, rank);
    });

    this.renderRibbon(false);
  },

  // Count the numerals up/down to their new value. `data-val` doubles as the
  // "latest requested target" so a second change mid-flight cancels the first.
  tweenNumber(node, target, instant) {
    const start = Number(node.dataset.val ?? NaN);
    if (instant || !Number.isFinite(start) || start === target) {
      node.dataset.val = String(target);
      node.textContent = String(target);
      return;
    }
    node.dataset.val = String(target);
    const t0 = performance.now();
    const step = (now) => {
      if (!this._el) return;                      // unmounted mid-count
      const p = Math.min(1, (now - t0) / MOVE_MS);
      const eased = 1 - Math.pow(1 - p, 3);
      const v = Math.round(start + (target - start) * eased);
      node.textContent = String(p >= 1 ? target : v);
      if (p < 1 && node.dataset.val === String(target)) requestAnimationFrame(step);
    };
    requestAnimationFrame(step);
  },

  renderRibbon(advance) {
    const el = this._el;
    if (!el) return;
    const { store } = this._ctx;
    const ribbon = el.querySelector('[data-ribbon]');
    const track = el.querySelector('[data-ribbon-track]');
    const dots = el.querySelector('[data-ribbon-dots]');

    let txs = [];
    try { txs = store.getTransactions({ limit: 12 }) || []; } catch (e) { txs = []; }
    if (!txs.length) { ribbon.hidden = true; return; }   // nothing has happened yet
    ribbon.hidden = false;

    const PER_PAGE = 3;
    const pages = Math.max(1, Math.ceil(txs.length / PER_PAGE));
    const page = ((this._ribbonPage % pages) + pages) % pages;
    this._ribbonPage = page;

    const html = txs.slice(page * PER_PAGE, page * PER_PAGE + PER_PAGE).map((t) => {
      const h = store.HOUSES[t.houseId];
      const accent = h ? h.accent : '#f59e0b';
      const sign = t.delta > 0 ? '+' : '';
      return `<div class="council-ribbon-item">
        <span class="council-ribbon-house" style="color:${accent}">${escapeHtml(h ? h.name : 'House')}</span>
        <span class="council-ribbon-delta" style="color:${t.delta > 0 ? '#86efac' : '#fca5a5'}">${sign}${t.delta}</span>
        <span class="council-ribbon-reason">${escapeHtml(t.reason || 'Points adjusted')}</span>
      </div>`;
    }).join('');

    dots.innerHTML = Array.from({ length: pages }, (_, i) => `<span class="council-ribbon-dot" data-on="${i === page}"></span>`).join('');

    if (advance && !reducedMotion()) {
      track.classList.add('fading');
      const t = setTimeout(() => {
        if (!this._el) return;
        track.innerHTML = html;
        track.classList.remove('fading');
      }, 220);
      this._timers.push(t);
    } else {
      track.innerHTML = html;
      track.classList.remove('fading');
    }
  },

  unmount() {
    if (this._unsub) { this._unsub(); this._unsub = null; }
    if (this._ribbonTimer) { clearInterval(this._ribbonTimer); this._ribbonTimer = 0; }
    this._timers.forEach((t) => clearTimeout(t));
    this._timers = [];
    if (this._raf) { cancelAnimationFrame(this._raf); this._raf = 0; }
    if (this._el && this._clickHandler) this._el.removeEventListener('click', this._clickHandler);
    const ribbon = this._el && this._el.querySelector('[data-ribbon]');
    if (ribbon) {
      if (this._pointerEnter) ribbon.removeEventListener('pointerenter', this._pointerEnter);
      if (this._pauseOn) ribbon.removeEventListener('mouseenter', this._pauseOn);
      if (this._pauseOff) ribbon.removeEventListener('mouseleave', this._pauseOff);
      if (this._pointerDown) ribbon.removeEventListener('pointerdown', this._pointerDown);
    }
    this._pointerEnter = null;
    this._pauseOn = null;
    this._pauseOff = null;
    this._pointerDown = null;
    this._cols = null;
    this._prevRank = null;
    this._el = null;
    this._ctx = null;
  },
};
