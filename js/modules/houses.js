// houses.js — House System & Point Tracking Engine
// Owned module. Follows ARCHITECTURE.md contract.

const STYLE_ID = 'hse-styles';
const STYLE = `
@keyframes hse-fade-in { from { opacity: 0; transform: translateY(6px); } to { opacity: 1; transform: translateY(0); } }
@keyframes hse-bar-grow { from { width: 0%; } }
@keyframes hse-float-up {
  0% { opacity: 0; transform: translate(-50%, 0) scale(0.8); }
  15% { opacity: 1; transform: translate(-50%, -8px) scale(1.15); }
  75% { opacity: 1; transform: translate(-50%, -46px) scale(1); }
  100% { opacity: 0; transform: translate(-50%, -70px) scale(1); }
}
@keyframes hse-banner-glow {
  0%, 100% { box-shadow: 0 0 20px 2px var(--hse-glow, rgba(245,158,11,0.35)); }
  50% { box-shadow: 0 0 36px 8px var(--hse-glow, rgba(245,158,11,0.5)); }
}
.hse-in { animation: hse-fade-in 280ms ease both; }
.hse-bar-fill { animation: hse-bar-grow 800ms cubic-bezier(.16,.84,.44,1) both; }
.hse-banner { animation: hse-banner-glow 3.4s ease-in-out infinite; }
.hse-float { position: absolute; left: 50%; top: 0; font-weight: 800; font-size: 1.5rem; pointer-events: none;
  animation: hse-float-up 1100ms ease-out forwards; z-index: 30; text-shadow: 0 2px 8px rgba(0,0,0,0.6); }
.hse-btn { transition: transform 150ms ease, filter 150ms ease, box-shadow 150ms ease; }
.hse-btn:active { transform: scale(0.94); }
.hse-btn:hover { filter: brightness(1.1); }
.hse-chip { transition: background 150ms ease, border-color 150ms ease, color 150ms ease, transform 150ms ease; }
.hse-chip.hse-chip-active { transform: translateY(-1px); }
.hse-card { transition: transform 180ms ease, box-shadow 180ms ease, border-color 180ms ease; }
.hse-card:hover { transform: translateY(-2px); }
.hse-card:active { transform: scale(0.98); }
.hse-scroll::-webkit-scrollbar { width: 8px; }
.hse-scroll::-webkit-scrollbar-thumb { background: #374151; border-radius: 8px; }
.hse-seg-btn { transition: background 200ms ease, color 200ms ease; }
`;

const REASON_TAGS = ['Map Quiz Champion', 'Class Champion', 'Teamwork', 'Friday Attack', 'Homework Hero', 'Penalty'];
const QUICK_VALUES = [5, 10, 50, 100];

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

// Portrait, transparent-bg house shield — always contain-fit, never cropped.
function houseImg(house, cls) {
  return `<img src="${house.image}" alt="${house.name} crest" class="${cls}"
    onerror="this.onerror=null;this.style.display='none';this.parentElement.classList.add('hse-img-fallback');" />`;
}

// <img> with a graceful emoji-fallback sibling, shown if the PNG 404s.
function pngWithEmojiFallback(src, emoji, cls, wrapCls) {
  return `<div class="${wrapCls} relative inline-flex items-center justify-center shrink-0 align-middle">
    <img src="${src}" alt="" class="${cls}" onerror="this.style.display='none'; this.nextElementSibling.style.display='inline-flex';" />
    <span class="hidden absolute inset-0 items-center justify-center">${emoji}</span>
  </div>`;
}

// Time alone is ambiguous once the log spans days — show the day too, except
// for today's entries where the time is what the teacher is scanning for.
function fmtTime(ts) {
  const d = new Date(ts);
  const time = d.toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit' });
  const today = new Date();
  const sameDay = d.toDateString() === today.toDateString();
  if (sameDay) return time;
  return `${d.toLocaleDateString(undefined, { month: 'short', day: 'numeric' })} ${time}`;
}

// ---- module instance state (survives store re-renders, not module reloads) ----
function initInternalState(store) {
  const activeHouse = store.getActiveHouse();
  return {
    viewMode: 'term', // 'week' | 'term'
    selectedHouseId: activeHouse ? activeHouse.id : Object.values(store.HOUSES)[0].id,
    selectedTag: null,
  };
}

function renderSegToggle(s) {
  return `
    <div class="hse-in inline-flex bg-card2 border border-line rounded-2xl p-1 gap-1">
      <button data-seg="week" class="hse-seg-btn h-12 px-4 rounded-xl font-bold text-sm xl:text-base
        ${s.viewMode === 'week' ? 'bg-valhalla text-gray-900' : 'text-gray-300'}">
        Current Class Standings
      </button>
      <button data-seg="term" class="hse-seg-btn h-12 px-4 rounded-xl font-bold text-sm xl:text-base
        ${s.viewMode === 'term' ? 'bg-valhalla text-gray-900' : 'text-gray-300'}">
        School-Wide 9-Week House Cup
      </button>
    </div>`;
}

function renderArtworkHeaders(state, store) {
  const activeHouse = store.getActiveHouse();
  if (state.activeCore !== 'all' && activeHouse) {
    const h = activeHouse;
    return `
      <div class="hse-in hse-banner relative w-full rounded-2xl overflow-hidden border-2 min-h-[180px] xl:min-h-[240px] flex items-center"
           style="border-color:${h.accent}; --hse-glow:${h.accentSoft};">
        <div class="absolute inset-0 bg-gradient-to-br from-card2 to-card"></div>
        <img src="${h.heroImage}" alt="" class="absolute inset-0 w-full h-full object-cover" onerror="this.onerror=null;this.style.display='none';" />
        <div class="absolute inset-0 bg-gradient-to-r from-black/85 via-black/45 to-black/10"></div>
        <div class="relative z-10 flex items-center gap-5 p-5 xl:p-7 w-full">
          ${houseImg(h, 'h-32 xl:h-44 w-auto object-contain shrink-0 drop-shadow-[0_8px_20px_rgba(0,0,0,0.6)]')}
          <div>
            <div class="font-display font-extrabold text-3xl xl:text-5xl tracking-wide text-white drop-shadow-[0_2px_10px_rgba(0,0,0,0.7)]">${h.name}</div>
            <div class="text-white/90 italic text-lg xl:text-2xl mt-1 drop-shadow-[0_2px_8px_rgba(0,0,0,0.7)]">&ldquo;${escapeHtml(h.motto)}&rdquo;</div>
          </div>
        </div>
      </div>`;
  }
  const houses = Object.values(store.HOUSES);
  return `
    <div class="hse-in grid grid-cols-2 xl:grid-cols-4 gap-3">
      ${houses.map((h) => `
        <button data-select-core="${h.core}" class="hse-card relative rounded-2xl overflow-hidden border-2 h-32 xl:h-40 bg-card flex flex-col items-center justify-center gap-2 p-3"
                style="border-color:${h.accent};">
          <div class="absolute inset-0" style="background: radial-gradient(circle at 50% 22%, ${h.accentSoft}, transparent 70%);"></div>
          ${houseImg(h, 'relative z-10 h-16 xl:h-20 w-auto object-contain drop-shadow-lg')}
          <span class="relative z-10 font-display font-extrabold text-sm xl:text-lg" style="color:${h.accent};">${h.name}</span>
        </button>
      `).join('')}
    </div>`;
}

function renderLeaderboard(state, store, s) {
  const totals = store.getTotals(s.viewMode);
  const max = Math.max(1, ...totals.map((t) => Math.max(0, t.total)));
  const medals = ['🥇', '🥈', '🥉', '🎖️'];
  return `
    <div class="hse-in bg-card rounded-2xl border border-line p-4 xl:p-5 flex flex-col min-h-0">
      <div class="text-gray-400 text-sm font-semibold uppercase tracking-wide mb-3">
        ${s.viewMode === 'week' ? 'This Week — Leaderboard' : '9-Week House Cup — Leaderboard'}
      </div>
      <div class="flex flex-col gap-2.5 overflow-y-auto hse-scroll pr-1">
        ${totals.map((t, i) => {
          const isActive = state.activeCore !== 'all' && t.house.core === state.activeCore;
          const pct = Math.max(4, Math.round((Math.max(0, t.total) / max) * 100));
          const shielded = store.isShielded(t.house.id);
          return `
          <div class="flex items-center gap-3 rounded-xl p-2.5 ${isActive ? 'bg-card2 ring-1' : ''}" ${isActive ? `style="--tw-ring-color:${t.house.accent}"` : ''}>
            <div class="w-8 text-center text-xl xl:text-2xl shrink-0">${medals[i] || '🏅'}</div>
            ${houseImg(t.house, 'h-10 xl:h-12 w-auto object-contain shrink-0 drop-shadow')}
            <div class="flex-1 min-w-0">
              <div class="flex justify-between items-baseline gap-2">
                <span class="font-bold truncate" style="color:${t.house.accent}">${t.house.name}</span>
                <span class="flex items-center gap-2 shrink-0">
                  ${shielded ? '<span class="text-xs font-bold px-2 py-0.5 rounded-full bg-blue-500/20 border border-blue-400/50 text-blue-300">🛡️ Protected</span>' : ''}
                  <span class="font-extrabold text-gray-100 text-lg">${t.total}</span>
                </span>
              </div>
              <div class="h-2.5 rounded-full mt-1 overflow-hidden" style="background: var(--color-line, #374151);">
                <div class="hse-bar-fill h-full rounded-full" style="width:${pct}%; background:${t.house.accent};"></div>
              </div>
            </div>
          </div>`;
        }).join('')}
      </div>
    </div>`;
}

function renderHouseChips(store, s) {
  const houses = Object.values(store.HOUSES);
  return `
    <div class="flex flex-wrap gap-2">
      ${houses.map((h) => `
        <button data-pick-house="${h.id}" class="hse-chip h-12 px-4 rounded-xl font-bold text-sm border-2
          ${s.selectedHouseId === h.id ? 'hse-chip-active' : 'opacity-70'}"
          style="border-color:${h.accent}; ${s.selectedHouseId === h.id ? `background:${h.accentSoft}; color:${h.accent};` : `color:${h.accent};`}">
          ${h.name}
        </button>
      `).join('')}
    </div>`;
}

function renderScoringPanel(state, store, s) {
  const target = store.HOUSES[s.selectedHouseId];
  const showChips = state.activeCore === 'all';
  return `
    <div class="hse-in bg-card rounded-2xl border border-line p-4 xl:p-5 flex flex-col gap-4 relative" id="hse-score-anchor">
      <div class="flex items-center justify-between flex-wrap gap-2">
        <div class="text-gray-400 text-sm font-semibold uppercase tracking-wide">Award / Deduct Points</div>
        <div class="flex items-center gap-2 font-bold" style="color:${target.accent}">
          ${houseImg(target, 'h-7 w-auto object-contain')}
          ${target.name}
        </div>
      </div>
      ${showChips ? renderHouseChips(store, s) : ''}

      <div>
        <div class="text-xs text-gray-400 font-semibold mb-1.5">Quick Award</div>
        <div class="grid grid-cols-4 gap-2">
          ${QUICK_VALUES.map((v) => `
            <button data-quick="${v}" class="hse-btn h-14 rounded-xl font-extrabold text-lg text-gray-900" style="background:${target.accent};">+${v}</button>
          `).join('')}
        </div>
      </div>
      <div>
        <div class="text-xs text-gray-400 font-semibold mb-1.5">Quick Deduct</div>
        <div class="grid grid-cols-4 gap-2">
          ${QUICK_VALUES.map((v) => `
            <button data-quick="-${v}" class="hse-btn h-14 rounded-xl font-extrabold text-lg text-red-200 bg-red-900/50 border border-red-500/50">−${v}</button>
          `).join('')}
        </div>
      </div>

      <div>
        <div class="text-xs text-gray-400 font-semibold mb-1.5">Manual Entry</div>
        <div class="flex items-center gap-2 flex-wrap">
          <input id="hse-manual-input" type="text" inputmode="numeric" maxlength="4" placeholder="0-9999"
            class="h-14 w-32 rounded-xl bg-card2 border border-line px-3 text-lg font-bold text-gray-50 text-center focus:outline-none focus:ring-2 focus:ring-valhalla" />
          <button data-manual="add" class="hse-btn h-14 px-5 rounded-xl font-bold bg-emerald-600 text-white">Add</button>
          <button data-manual="deduct" class="hse-btn h-14 px-5 rounded-xl font-bold bg-red-700 text-white">Deduct</button>
        </div>
      </div>

      <div>
        <div class="text-xs text-gray-400 font-semibold mb-1.5">Reason</div>
        <div class="flex flex-wrap gap-2 mb-2">
          ${REASON_TAGS.map((tag) => `
            <button data-tag="${escapeHtml(tag)}" class="hse-chip h-10 px-3 rounded-full text-xs font-semibold border
              ${s.selectedTag === tag ? 'bg-valhalla/25 border-valhalla text-valhalla hse-chip-active' : 'border-line text-gray-300'}">
              ${escapeHtml(tag)}
            </button>
          `).join('')}
        </div>
        <input id="hse-reason-input" type="text" maxlength="80" placeholder="Custom reason (optional)"
          class="h-12 w-full rounded-xl bg-card2 border border-line px-3 text-sm text-gray-50 focus:outline-none focus:ring-2 focus:ring-valhalla" />
      </div>
    </div>`;
}

function renderTransactionLog(store) {
  const txs = store.getTransactions({ limit: 30 });
  return `
    <div class="hse-in bg-card rounded-2xl border border-line p-4 xl:p-5 flex flex-col min-h-0">
      <div class="text-gray-400 text-sm font-semibold uppercase tracking-wide mb-3">Transaction Log</div>
      <div class="flex flex-col gap-1.5 overflow-y-auto hse-scroll pr-1">
        ${txs.length ? txs.map((t) => {
          const h = store.HOUSES[t.houseId];
          const positive = t.delta > 0;
          return `
          <div class="flex items-center gap-2.5 py-1.5 border-b border-line/50 last:border-0">
            <span class="text-xs text-gray-500 w-16 shrink-0">${fmtTime(t.ts)}</span>
            <span class="w-2.5 h-2.5 rounded-full shrink-0" style="background:${h ? h.accent : '#666'}"></span>
            <span class="font-bold w-14 shrink-0 ${positive ? 'text-emerald-400' : 'text-red-400'}">${positive ? '+' : ''}${t.delta}</span>
            <span class="text-gray-300 text-sm truncate">${escapeHtml(t.reason || (t.tag ? `(${t.tag})` : ''))}</span>
          </div>`;
        }).join('') : '<div class="text-gray-500 italic">No point activity yet.</div>'}
      </div>
    </div>`;
}

function render(root, ctx, s) {
  const store = ctx.store;
  const state = store.getState();
  root.innerHTML = `
    <div class="h-full w-full p-4 xl:p-6 flex flex-col gap-4 xl:gap-5 overflow-y-auto hse-scroll">
      <div class="flex items-center justify-between flex-wrap gap-3">
        <h1 class="font-display font-extrabold text-2xl xl:text-3xl text-gray-50 flex items-center gap-2">
          ${pngWithEmojiFallback('images/icon-points.png', '🏆', 'h-8 w-8 xl:h-9 xl:w-9 object-contain', 'h-8 w-8 xl:h-9 xl:w-9 text-3xl')}
          House Points
        </h1>
        ${renderSegToggle(s)}
      </div>
      ${renderArtworkHeaders(state, store)}
      <div class="grid grid-cols-1 xl:grid-cols-2 gap-4 xl:gap-5 flex-1 min-h-0">
        <div class="flex flex-col gap-4 xl:gap-5 min-h-0">
          ${renderLeaderboard(state, store, s)}
          ${renderTransactionLog(store)}
        </div>
        <div class="flex flex-col gap-4 xl:gap-5 min-h-0">
          ${renderScoringPanel(state, store, s)}
        </div>
      </div>
    </div>
  `;
}

function floatFeedback(anchorEl, delta) {
  if (!anchorEl) return;
  const badge = document.createElement('div');
  badge.className = 'hse-float';
  badge.style.color = delta > 0 ? '#34d399' : '#f87171';
  badge.textContent = `${delta > 0 ? '+' : ''}${delta}`;
  anchorEl.style.position = anchorEl.style.position || 'relative';
  anchorEl.appendChild(badge);
  badge.addEventListener('animationend', () => badge.remove());
  setTimeout(() => { if (badge.parentNode) badge.remove(); }, 1400);
}

export default {
  id: 'houses',
  title: 'House Points',
  icon: '🏆',
  order: 15,
  showTile: true,

  mount(el, ctx) {
    ensureStyle();
    const store = ctx.store;
    const s = initInternalState(store);

    const doRender = () => render(el, ctx, s);
    doRender();

    const applyPoints = (delta) => {
      delta = Math.max(-9999, Math.min(9999, Math.round(delta)));
      if (!delta) return;
      const reasonInput = el.querySelector('#hse-reason-input');
      const customReason = reasonInput ? reasonInput.value.trim() : '';
      const reason = customReason || s.selectedTag || (delta > 0 ? 'Quick Award' : 'Quick Deduction');
      ctx.store.addPoints(s.selectedHouseId, delta, { reason, tag: 'manual' });
      ctx.audio.sfx(delta > 0 ? 'coin' : 'thud');
      const anchor = el.querySelector('#hse-score-anchor');
      floatFeedback(anchor, delta);
    };

    const clickHandler = (e) => {
      const seg = e.target.closest('[data-seg]');
      if (seg) { s.viewMode = seg.getAttribute('data-seg'); doRender(); return; }

      const coreBtn = e.target.closest('[data-select-core]');
      if (coreBtn) { ctx.store.setActiveCore(Number(coreBtn.getAttribute('data-select-core'))); return; }

      const pickHouse = e.target.closest('[data-pick-house]');
      if (pickHouse) { s.selectedHouseId = Number(pickHouse.getAttribute('data-pick-house')); doRender(); return; }

      const tagBtn = e.target.closest('[data-tag]');
      if (tagBtn) {
        const tag = tagBtn.getAttribute('data-tag');
        s.selectedTag = s.selectedTag === tag ? null : tag;
        doRender();
        return;
      }

      const quickBtn = e.target.closest('[data-quick]');
      if (quickBtn) { applyPoints(Number(quickBtn.getAttribute('data-quick'))); return; }

      const manualBtn = e.target.closest('[data-manual]');
      if (manualBtn) {
        const input = el.querySelector('#hse-manual-input');
        const raw = input ? input.value.trim() : '';
        const n = parseInt(raw, 10);
        if (!raw || Number.isNaN(n) || n < 1 || n > 9999) {
          if (input) { input.classList.add('ring-2', 'ring-red-500'); setTimeout(() => input.classList.remove('ring-2', 'ring-red-500'), 500); }
          return;
        }
        const sign = manualBtn.getAttribute('data-manual') === 'add' ? 1 : -1;
        applyPoints(sign * n);
        return;
      }
    };
    el.addEventListener('click', clickHandler);

    // Keep the award/deduct target in step with the top-bar core switcher.
    // Without this the panel keeps targeting the house that was active at mount
    // (and offers no chips to change it), so points land on the wrong house.
    const unsub = ctx.store.subscribe(() => {
      const active = ctx.store.getActiveHouse();
      if (active && s.selectedHouseId !== active.id) s.selectedHouseId = active.id;
      doRender();
    });

    this._el = el;
    this._clickHandler = clickHandler;
    this._unsub = unsub;
  },

  unmount() {
    if (this._unsub) { this._unsub(); this._unsub = null; }
    if (this._el && this._clickHandler) this._el.removeEventListener('click', this._clickHandler);
    this._el = null;
    this._clickHandler = null;
  },
};
