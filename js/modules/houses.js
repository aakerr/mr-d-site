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

/* ---- transaction log: undo control, row-out animation, filter chips ---- */
@keyframes hse-row-out {
  to { opacity: 0; transform: translateX(18px) scale(0.98); }
}
.hse-tx-row { transition: background 150ms ease; }
.hse-tx-row.hse-row-out { animation: hse-row-out 320ms ease forwards; pointer-events: none; }
.hse-undo-btn {
  width: 48px; height: 48px; min-width: 48px; min-height: 48px;
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
  display: inline-flex; align-items: center; font-size: 0.72rem; font-weight: 800;
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
.hse-modal-meta { color: var(--color-text-soft, #9ca3af); font-size: 0.85rem; margin-bottom: 10px; }
.hse-modal-warn {
  margin-top: 6px; padding: 10px 12px; border-radius: 0.6rem; font-size: 0.88rem; line-height: 1.5;
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

/* ---- toast (own fixed host, appended to <body> so log re-renders don't kill it) ---- */
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
`;

const REASON_TAGS = ['Map Quiz Champion', 'Class Champion', 'Teamwork', 'Friday Attack', 'Homework Hero', 'Penalty'];
const QUICK_VALUES = [5, 10, 50, 100];

// Every transaction carries a `tag` set by whichever module logged it.
// These are display labels + colors for the log's tag badge, so a teacher
// scanning the log can tell an attack from a manual award at a glance.
const TAG_META = {
  manual: { label: 'Manual', color: '#9ca3af' },
  quick:  { label: 'Manual', color: '#9ca3af' },
  quest:  { label: 'Quest',  color: '#a78bfa' },
  shop:   { label: 'Shop',   color: '#f59e0b' },
  attack: { label: 'Attack', color: '#f87171' },
  potw:   { label: 'POTW',   color: '#38bdf8' },
  dice:   { label: 'Dice',   color: '#34d399' },
  battle: { label: 'Battle', color: '#fb7185' },
  wild:   { label: 'Wild',   color: '#c084fc' },
};
function tagMeta(tag) {
  return TAG_META[tag] || { label: tag ? tag.charAt(0).toUpperCase() + tag.slice(1) : 'Manual', color: '#9ca3af' };
}

// Undoing a transaction only ever deletes the points row (store.removeTransaction
// never touches quest/shop/combat state) — so for tags where OTHER state was
// also changed at the time, the confirm modal must say plainly that only the
// points are reverting. Reason text (set at award time) tells complete vs
// abandoned quests apart, since both share the 'quest' tag.
function tagWarning(t) {
  switch (t.tag) {
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
    logFilter: 'all',      // 'all' | 'mine' (mine = current active house only)
    confirmTxId: null,     // transaction id pending the undo confirm modal
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

function renderLogFilter(activeHouse, s) {
  if (!activeHouse) return '';
  const opt = (key, label) => {
    const on = s.logFilter === key;
    return `
      <button type="button" data-log-filter="${key}" class="hse-chip h-11 px-3 rounded-lg text-sm font-semibold border"
        style="${on ? `background:${activeHouse.accentSoft}; border-color:${activeHouse.accent}; color:${activeHouse.accent};` : 'border-color: var(--color-line); color: var(--color-text-soft);'}">
        ${label}
      </button>`;
  };
  return `
    <div class="flex items-center gap-1.5" role="group" aria-label="Filter transaction log">
      ${opt('all', 'All Houses')}
      ${opt('mine', `${escapeHtml(activeHouse.name)} Only`)}
    </div>`;
}

function renderTransactionLog(store, state, s) {
  const activeHouse = store.getActiveHouse();
  const filterHouseId = s.logFilter === 'mine' && activeHouse ? activeHouse.id : null;
  const txs = store.getTransactions({ houseId: filterHouseId, limit: 30 });
  const showHouseCol = filterHouseId == null; // redundant when already filtered to one house
  return `
    <div class="hse-in bg-card rounded-2xl border border-line p-4 xl:p-5 flex flex-col min-h-0">
      <div class="flex items-center justify-between flex-wrap gap-2 mb-3">
        <div class="text-gray-400 text-sm font-semibold uppercase tracking-wide">Transaction Log</div>
        ${renderLogFilter(activeHouse, s)}
      </div>
      <div class="flex flex-col gap-1 overflow-y-auto hse-scroll pr-1">
        ${txs.length ? txs.map((t) => {
          const h = store.HOUSES[t.houseId];
          const positive = t.delta > 0;
          const meta = tagMeta(t.tag);
          return `
          <div class="hse-tx-row flex items-center gap-2.5 py-1.5 border-b border-line/50 last:border-0" data-tx-row="${t.id}">
            <span class="text-sm text-gray-500 w-20 shrink-0">${fmtTime(t.ts)}</span>
            ${showHouseCol ? `
            <span class="flex items-center gap-1.5 w-24 shrink-0 min-w-0" title="${h ? escapeHtml(h.name) : 'Unknown house'}">
              <span class="w-2.5 h-2.5 rounded-full shrink-0" style="background:${h ? h.accent : '#666'}"></span>
              <span class="text-sm font-semibold truncate" style="color:${h ? h.accent : '#9ca3af'}">${h ? escapeHtml(h.name) : '—'}</span>
            </span>` : ''}
            <span class="font-bold w-14 text-sm shrink-0 ${positive ? 'text-emerald-400' : 'text-red-400'}">${positive ? '+' : ''}${t.delta}</span>
            <span class="flex-1 min-w-0 flex items-center gap-2">
              <span class="text-gray-300 text-sm truncate">${escapeHtml(t.reason || 'Points adjustment')}</span>
              <span class="hse-tag-badge shrink-0" style="border-color:${meta.color}66; color:${meta.color}; background:${meta.color}1a;">${escapeHtml(meta.label)}</span>
            </span>
            <button type="button" class="hse-undo-btn shrink-0" data-undo="${t.id}" aria-label="Remove this entry" title="Remove this entry">✕</button>
          </div>`;
        }).join('') : '<div class="text-gray-500 italic text-sm">No point activity yet.</div>'}
      </div>
    </div>`;
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
  const meta = tagMeta(t.tag);
  const warn = tagWarning(t);
  const deltaLabel = `${t.delta > 0 ? '+' : ''}${t.delta}`;
  const reasonLabel = t.reason || meta.label;
  const d = new Date(t.ts);
  const dateLabel = d.toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' });
  const timeLabel = d.toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit' });
  return `
    <div class="hse-modal-bg" data-action="hse-modal-cancel"></div>
    <div class="hse-modal" role="dialog" aria-modal="true" aria-labelledby="hse-modal-title">
      <div class="hse-modal-head">
        <div id="hse-modal-title" class="hse-modal-title">Remove this entry?</div>
        <button type="button" class="hse-modal-x" data-action="hse-modal-cancel" aria-label="Cancel, keep this entry">✕</button>
      </div>
      <div class="hse-modal-body">
        <p class="hse-modal-lead">Remove &ldquo;<b>${deltaLabel} ${escapeHtml(reasonLabel)}</b>&rdquo; from
          <b style="color:${h.accent}">${escapeHtml(h.name)}</b>?
          ${escapeHtml(h.name)}&rsquo;s total will go from <b>${before}</b> to <b>${after}</b>.</p>
        <div class="hse-modal-meta">Logged ${dateLabel} at ${timeLabel}</div>
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
          ${renderTransactionLog(store, state, s)}
        </div>
        <div class="flex flex-col gap-4 xl:gap-5 min-h-0">
          ${renderScoringPanel(state, store, s)}
        </div>
      </div>
    </div>
    <div id="hse-modal-root">${renderConfirmModal(store, s)}</div>
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

    // Toast host lives on <body>, not inside `el` — every store change causes
    // a full doRender() that replaces el's innerHTML, which would otherwise
    // wipe out a toast mid-animation.
    const toastHost = document.createElement('div');
    toastHost.className = 'hse-toast-host';
    document.body.appendChild(toastHost);

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

      const logFilterBtn = e.target.closest('[data-log-filter]');
      if (logFilterBtn) { s.logFilter = logFilterBtn.getAttribute('data-log-filter'); doRender(); return; }

      // ---- undo a transaction: open the confirm modal, never delete on first tap ----
      const undoBtn = e.target.closest('[data-undo]');
      if (undoBtn) { s.confirmTxId = undoBtn.getAttribute('data-undo'); doRender(); return; }

      const modalCancel = e.target.closest('[data-action="hse-modal-cancel"]');
      if (modalCancel) { s.confirmTxId = null; doRender(); return; }

      const modalConfirm = e.target.closest('[data-action="hse-modal-confirm"]');
      if (modalConfirm) {
        const txId = modalConfirm.getAttribute('data-tx');
        const tx = ctx.store.getState().transactions.find((t) => t.id === txId);
        s.confirmTxId = null;
        doRender(); // close the modal immediately — Cancel/Confirm both dismiss it right away
        if (!tx) return;
        const house = ctx.store.HOUSES[tx.houseId];
        const deltaLabel = `${tx.delta > 0 ? '+' : ''}${tx.delta}`;
        const row = el.querySelector(`[data-tx-row="${CSS.escape(txId)}"]`);
        let done = false;
        const finish = () => {
          if (done) return;
          done = true;
          ctx.store.removeTransaction(txId); // triggers store subscribe -> doRender() with updated totals
          ctx.audio.sfx('thud'); // quiet, not celebratory — this is a correction, not a reward
          showToast(toastHost, `Removed ${deltaLabel}${house ? ` from ${house.name}` : ''}`);
        };
        if (row) {
          row.classList.add('hse-row-out');
          row.addEventListener('animationend', finish, { once: true });
          setTimeout(finish, 420); // safety net if the animation doesn't fire (e.g. reduced motion)
        } else {
          finish();
        }
        return;
      }
    };
    el.addEventListener('click', clickHandler);

    // Escape closes the confirm modal — Cancel must always be the easy path.
    const keyHandler = (e) => {
      if (e.key === 'Escape' && s.confirmTxId) { s.confirmTxId = null; doRender(); }
    };
    document.addEventListener('keydown', keyHandler);

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
    this._keyHandler = keyHandler;
    this._unsub = unsub;
    this._toastHost = toastHost;
  },

  unmount() {
    if (this._unsub) { this._unsub(); this._unsub = null; }
    if (this._el && this._clickHandler) this._el.removeEventListener('click', this._clickHandler);
    if (this._keyHandler) { document.removeEventListener('keydown', this._keyHandler); this._keyHandler = null; }
    if (this._toastHost) { this._toastHost.remove(); this._toastHost = null; }
    this._el = null;
    this._clickHandler = null;
  },
};
