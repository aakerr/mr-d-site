// quests.js — Class Quests board (student-facing picking + status board).
// Owned module. Follows ARCHITECTURE.md contract.
// One quest active per core at a time. Completion is teacher-confirmed in Admin.

const STYLE_ID = 'quests-styles';
const STYLE = `
@keyframes quest-fade-in { from { opacity: 0; transform: translateY(6px); } to { opacity: 1; transform: translateY(0); } }
@keyframes quest-pop {
  0%   { transform: scale(1); }
  30%  { transform: scale(1.035); }
  55%  { transform: scale(0.99); }
  100% { transform: scale(1); }
}
@keyframes quest-glow-pulse {
  0%, 100% { box-shadow: 0 0 18px 2px var(--quest-glow, rgba(245,158,11,0.35)); }
  50% { box-shadow: 0 0 34px 8px var(--quest-glow, rgba(245,158,11,0.5)); }
}
@keyframes quest-epic-shimmer {
  0% { background-position: 0% 50%; }
  100% { background-position: 200% 50%; }
}
@keyframes quest-modal-in { from { opacity: 0; transform: scale(0.9) translateY(10px); } to { opacity: 1; transform: scale(1) translateY(0); } }
@keyframes quest-backdrop-in { from { opacity: 0; } to { opacity: 1; } }

.quest-in { animation: quest-fade-in 280ms ease both; }
.quest-celebrate { animation: quest-pop 480ms cubic-bezier(.36,1.6,.4,1) both; }
.quest-banner-glow { animation: quest-glow-pulse 3.2s ease-in-out infinite; }
.quest-card { transition: transform 180ms ease, box-shadow 180ms ease, border-color 180ms ease, opacity 180ms ease, filter 180ms ease; }
.quest-card:not(.quest-locked):hover { transform: translateY(-3px); }
.quest-card.quest-locked { opacity: 0.45; filter: grayscale(0.4); }
.quest-btn { transition: transform 150ms ease, filter 150ms ease, box-shadow 150ms ease; min-height: 48px; }
.quest-btn:active { transform: scale(0.95); }
.quest-btn:hover { filter: brightness(1.1); }
.quest-badge-epic {
  background: linear-gradient(90deg, #7c3aed, #a855f7, #7c3aed);
  background-size: 200% auto;
  animation: quest-epic-shimmer 3s linear infinite;
  box-shadow: 0 0 16px 2px rgba(168,85,247,0.55);
}
.quest-scroll::-webkit-scrollbar { width: 8px; }
.quest-scroll::-webkit-scrollbar-thumb { background: #374151; border-radius: 8px; }
.quest-sort-btn { transition: background 150ms ease, border-color 150ms ease, color 150ms ease; min-height: 48px; }
.quest-modal-backdrop { animation: quest-backdrop-in 150ms ease both; background: rgba(0,0,0,0.65); backdrop-filter: blur(2px); }
.quest-modal-card { animation: quest-modal-in 220ms cubic-bezier(.34,1.56,.64,1) both; }
.quest-deed { transition: transform 150ms ease, background 150ms ease; }
.quest-deed:hover { transform: translateY(-1px); }
`;

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

function relTime(ts) {
  if (!ts) return '';
  const diff = Date.now() - ts;
  const min = Math.floor(diff / 60000);
  if (min < 1) return 'just now';
  if (min < 60) return `${min}m ago`;
  const hr = Math.floor(min / 60);
  if (hr < 24) return `${hr}h ago`;
  const day = Math.floor(hr / 24);
  if (day === 1) return 'yesterday';
  if (day < 7) return `${day}d ago`;
  return new Date(ts).toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
}

function pointBandClass(points) {
  if (points >= 35) return 'quest-badge-epic text-white';
  if (points >= 20) return 'bg-amber-500/25 border border-amber-400/60 text-amber-300';
  return 'bg-slate-500/25 border border-slate-400/50 text-slate-300';
}

function pointBadge(points, size = 'md') {
  const sizeCls = size === 'lg' ? 'text-2xl xl:text-3xl px-5 py-2' : 'text-sm px-3 py-1';
  return `<span class="quest-in inline-flex items-center gap-1 rounded-full font-extrabold ${sizeCls} ${pointBandClass(points)}">
    ${points >= 35 ? '✨' : ''}${points}<span class="text-[0.7em] font-bold opacity-80">pts</span>
  </span>`;
}

// ---- module instance state ----
function initInternalState() {
  return {
    sortAsc: true,
    modal: null, // { kind: 'accept'|'abandon', questId?, core? }
    celebrateCore: null,
  };
}

function renderHeader(store) {
  const house = store.getActiveHouse();
  const color = house ? house.accent : 'var(--accent)';
  return `
    <div class="quest-in flex items-end justify-between flex-wrap gap-2">
      <div>
        <h1 class="font-display font-extrabold text-2xl xl:text-3xl tracking-wide" style="color:${color};">
          <img src="images/icon-quest.png" alt="" class="inline-block h-9 xl:h-11 w-auto object-contain align-[-0.35em] mr-1" onerror="this.style.display='none'"/> CLASS QUESTS
        </h1>
        <p class="text-gray-400 text-sm xl:text-base mt-0.5">One quest at a time. Glory for all.</p>
      </div>
    </div>`;
}

function renderActiveHero(core, store, s) {
  const house = store.HOUSES[core];
  const quest = store.getActiveQuest(core);
  const celebrate = s.celebrateCore === core ? 'quest-celebrate' : '';

  if (!quest) {
    return `
      <div class="quest-in bg-card rounded-2xl border-2 border-dashed border-line p-6 xl:p-8 flex flex-col items-center justify-center text-center gap-2 min-h-[180px]">
        <div class="text-4xl">🧭</div>
        <div class="text-gray-300 font-semibold">No quest active for ${escapeHtml(house.name)}</div>
        <div class="text-gray-500 text-sm">Accept one from the Quest Board below.</div>
      </div>`;
  }

  return `
    <div class="quest-in quest-banner-glow ${celebrate} relative shrink-0 rounded-2xl bg-gradient-to-br from-card to-card2 border-2 p-6 xl:p-8 flex flex-col gap-4"
         style="border-color:${house.accent}; --quest-glow:${house.accentSoft};" data-core="${core}">
      <div class="flex items-start justify-between gap-4 flex-wrap">
        <div class="flex-1 min-w-[220px]">
          <div class="text-xs font-bold uppercase tracking-widest mb-1" style="color:${house.accent}">${escapeHtml(house.name)} · Active Quest</div>
          <h2 class="font-display font-extrabold text-2xl xl:text-4xl text-gray-50">${escapeHtml(quest.title)}</h2>
          <p class="text-gray-300 mt-2 text-sm xl:text-base max-w-2xl">${escapeHtml(quest.desc)}</p>
        </div>
        ${pointBadge(quest.points, 'lg')}
      </div>
      <div class="flex items-center justify-between flex-wrap gap-3 pt-2 border-t border-line/60">
        <div class="text-gray-400 text-sm">Started ${relTime(quest.startedTs)}</div>
        <div class="flex items-center gap-3 flex-wrap">
          <span class="text-gray-400 text-xs xl:text-sm italic">Mr. D confirms completion in the admin panel 🗝️</span>
          <button data-abandon="${core}" class="quest-btn h-11 px-4 rounded-xl text-xs xl:text-sm font-bold bg-card2 border border-line text-gray-400 hover:text-red-300 hover:border-red-400/50">
            Abandon Quest
          </button>
        </div>
      </div>
    </div>`;
}

function renderActiveOverview(store) {
  const houses = Object.values(store.HOUSES);
  return `
    <div class="quest-in grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-4 gap-3 xl:gap-4">
      ${houses.map((h) => {
        const q = store.getActiveQuest(h.core);
        return `
        <div class="rounded-2xl border-2 bg-card p-4 flex flex-col gap-2 min-h-[130px]" style="border-color:${h.accent};">
          <div class="font-bold text-sm" style="color:${h.accent}">${escapeHtml(h.name)}</div>
          ${q ? `
            <div class="font-semibold text-gray-100 text-sm leading-snug">${escapeHtml(q.title)}</div>
            <div class="flex items-center justify-between mt-auto">
              ${pointBadge(q.points)}
              <span class="text-gray-500 text-xs">${relTime(q.startedTs)}</span>
            </div>` : `
            <div class="text-gray-500 italic text-sm mt-auto">No quest active</div>`}
        </div>`;
      }).join('')}
    </div>`;
}

function renderBoard(state, store, s) {
  const catalog = [...store.getQuestCatalog()].sort((a, b) => s.sortAsc ? a.points - b.points : b.points - a.points);
  const core = state.activeCore;
  const isAll = core === 'all';
  const activeQuest = isAll ? null : store.getActiveQuest(core);
  const locked = !isAll && !!activeQuest;

  return `
    <div class="quest-in flex flex-col gap-3">
      <div class="flex items-center justify-between flex-wrap gap-2">
        <div class="text-gray-400 text-sm font-semibold uppercase tracking-wide">Quest Board</div>
        <button data-sort-toggle="1" class="quest-sort-btn h-11 px-4 rounded-xl text-sm font-bold bg-card2 border border-line text-gray-200">
          Points ${s.sortAsc ? '▲' : '▼'}
        </button>
      </div>
      ${isAll ? `<div class="text-gray-500 italic text-sm">Pick a core to accept a quest.</div>` : ''}
      ${locked ? `<div class="text-amber-300/90 text-sm font-semibold flex items-center gap-1.5">🔒 Complete your current quest first</div>` : ''}
      <div class="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-3 gap-3 xl:gap-4">
        ${catalog.map((q) => `
          <div class="quest-card ${locked ? 'quest-locked' : ''} bg-card rounded-2xl border border-line p-4 flex flex-col gap-2.5">
            <div class="flex items-start justify-between gap-2">
              <div class="font-bold text-gray-100 leading-snug">${escapeHtml(q.title)}</div>
              ${pointBadge(q.points)}
            </div>
            <div class="text-gray-400 text-xs xl:text-sm flex-1">${escapeHtml(q.desc)}</div>
            ${isAll
              ? `<div class="text-gray-500 text-xs italic mt-1">Pick a core to accept a quest.</div>`
              : locked
                ? `<div class="text-amber-400/80 text-xs font-semibold mt-1">🔒 Locked</div>`
                : `<button data-accept="${q.id}" class="quest-btn mt-1 h-12 rounded-xl font-bold text-sm text-gray-900" style="background:${store.HOUSES[core].accent};">⚔️ Accept Quest</button>`}
          </div>
        `).join('')}
      </div>
    </div>`;
}

function renderCompletedStrip(store) {
  const items = store.getCompletedQuests({ limit: 8 });
  return `
    <div class="quest-in bg-card rounded-2xl border border-line p-4 xl:p-5">
      <div class="text-gray-400 text-sm font-semibold uppercase tracking-wide mb-3">📜 Hall of Deeds</div>
      ${items.length ? `
        <div class="flex gap-3 overflow-x-auto quest-scroll pb-1">
          ${items.map((c) => {
            const h = store.HOUSES[c.core];
            return `
            <div class="quest-deed shrink-0 flex items-center gap-2.5 bg-card2 border border-line rounded-xl px-3 py-2 min-w-[220px]">
              <span class="w-2.5 h-2.5 rounded-full shrink-0" style="background:${h ? h.accent : '#666'}"></span>
              <div class="min-w-0 flex-1">
                <div class="text-gray-100 text-xs font-semibold truncate">${escapeHtml(c.title)}</div>
                <div class="text-gray-500 text-[0.7rem]">${h ? escapeHtml(h.name) : ''} · ${relTime(c.ts)}</div>
              </div>
              <span class="text-emerald-400 font-extrabold text-sm shrink-0">+${c.points}</span>
            </div>`;
          }).join('')}
        </div>` : `<div class="text-gray-500 italic text-sm">No quests completed yet this term.</div>`}
    </div>`;
}

function renderModal(state, store, s) {
  if (!s.modal) return '';
  const { kind } = s.modal;
  let title = '';
  let body = '';
  let confirmLabel = 'Confirm';
  let confirmClass = 'bg-emerald-600 text-white';

  if (kind === 'accept') {
    const quest = store.getQuestCatalog().find((q) => q.id === s.modal.questId);
    const house = store.HOUSES[state.activeCore];
    if (!quest || !house) return '';
    title = 'Accept this quest?';
    body = `House <span class="font-bold" style="color:${house.accent}">${escapeHtml(house.name)}</span> accepts:
      <span class="font-bold text-gray-50">${escapeHtml(quest.title)}</span> — worth
      <span class="font-extrabold text-amber-300">${quest.points} points</span>?`;
    confirmLabel = '⚔️ Accept';
  } else if (kind === 'abandon') {
    const house = store.HOUSES[s.modal.core];
    const quest = store.getActiveQuest(s.modal.core);
    title = 'Abandon quest?';
    body = `House <span class="font-bold" style="color:${house ? house.accent : ''}">${escapeHtml(house ? house.name : '')}</span> will give up
      <span class="font-bold text-gray-50">${escapeHtml(quest ? quest.title : 'this quest')}</span>.
      Progress is forfeited — no penalty, but no points either.`;
    confirmLabel = 'Abandon';
    confirmClass = 'bg-red-700 text-white';
  }

  return `
    <div id="quest-modal-backdrop" class="fixed inset-0 z-50 flex items-center justify-center p-4 quest-modal-backdrop">
      <div class="quest-modal-card w-full max-w-md bg-card border border-line rounded-2xl p-6 flex flex-col gap-4" data-modal-card="1">
        <div class="font-display font-bold text-xl text-gray-50">${title}</div>
        <div class="text-gray-300 text-sm xl:text-base leading-relaxed">${body}</div>
        <div class="flex items-center justify-end gap-3 pt-2">
          <button data-modal-cancel="1" class="quest-btn h-12 px-5 rounded-xl font-bold bg-card2 border border-line text-gray-300">Cancel</button>
          <button data-modal-confirm="1" class="quest-btn h-12 px-5 rounded-xl font-bold ${confirmClass}">${confirmLabel}</button>
        </div>
      </div>
    </div>`;
}

function render(root, ctx, s) {
  const store = ctx.store;
  const state = store.getState();
  const core = state.activeCore;
  root.innerHTML = `
    <div class="h-full w-full p-4 xl:p-6 flex flex-col gap-4 xl:gap-5 overflow-y-auto quest-scroll">
      ${renderHeader(store)}
      ${core === 'all' ? renderActiveOverview(store) : renderActiveHero(core, store, s)}
      ${renderBoard(state, store, s)}
      ${renderCompletedStrip(store)}
    </div>
    ${renderModal(state, store, s)}
  `;
}

export default {
  id: 'quests',
  title: 'Quests',
  icon: '🗺️',
  order: 25,
  showTile: true,

  mount(el, ctx) {
    ensureStyle();
    const store = ctx.store;
    const s = initInternalState();

    const doRender = () => render(el, ctx, s);
    doRender();

    const clickHandler = (e) => {
      // Modal interactions take priority.
      if (s.modal) {
        if (e.target.closest('[data-modal-confirm]')) {
          if (s.modal.kind === 'accept') {
            const state = store.getState();
            const core = state.activeCore;
            const questId = s.modal.questId;
            const ok = store.startQuest(core, questId);
            if (ok) {
              ctx.audio.sfx('fanfare');
              s.celebrateCore = core;
              setTimeout(() => { s.celebrateCore = null; }, 500);
            }
          } else if (s.modal.kind === 'abandon') {
            store.abandonQuest(s.modal.core);
          }
          s.modal = null;
          doRender();
          return;
        }
        if (e.target.closest('[data-modal-cancel]')) {
          s.modal = null;
          doRender();
          return;
        }
        if (e.target.id === 'quest-modal-backdrop') {
          s.modal = null;
          doRender();
          return;
        }
        // Clicked inside the card but not on an actionable element — ignore.
        if (e.target.closest('[data-modal-card]')) return;
      }

      const sortBtn = e.target.closest('[data-sort-toggle]');
      if (sortBtn) { s.sortAsc = !s.sortAsc; doRender(); return; }

      const acceptBtn = e.target.closest('[data-accept]');
      if (acceptBtn) {
        s.modal = { kind: 'accept', questId: acceptBtn.getAttribute('data-accept') };
        doRender();
        return;
      }

      const abandonBtn = e.target.closest('[data-abandon]');
      if (abandonBtn) {
        s.modal = { kind: 'abandon', core: Number(abandonBtn.getAttribute('data-abandon')) };
        doRender();
        return;
      }
    };
    el.addEventListener('click', clickHandler);

    const unsub = store.subscribe(doRender);

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
