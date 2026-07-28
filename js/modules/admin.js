// admin.js — Teacher's Admin Panel for Mr. D's Classroom OS
// Tabs: 📅 Planner, 🗺️ Quests, 🔮 Shop, 🌍 Place of the Week, ⚔️ Battle Day, ❓ Help, ⚙️ Settings (always last).
// Owns ONLY this file. Renders into #module-root. All state flows through the
// store APIs (never mutated directly). Media blobs go through js/core/media.js.
// Injects <style id="admin-styles"> once; styles are theme-token aware (light/dark).
// Follows ARCHITECTURE.md contract; touch targets >= 44px; amber accent.
import { media } from '../core/media.js';
import { CONFIG } from '../config.js';
import { backup } from '../core/backup.js';
import { lock, DEFAULT_PIN } from '../core/lock.js';
import { testFlight } from './potw.js';   // 🧭 Test flight preview (read-only)
import { buildSampleState } from '../core/sampledata.js';  // ⚙️ Settings → "Load sample data"

// Tab order — future tabs insert into MAIN_TABS; Settings is pinned last.
const MAIN_TABS = [
  { id: 'planner', label: '📅 Planner' },
  { id: 'quests', label: "<img src='images/icon-quest.png' alt='' style='display:inline-block;height:1.25em;width:auto;vertical-align:-0.25em;margin-right:.3em'/>Quests" },
  { id: 'shop', label: "<img src='images/icon-market.png' alt='' style='display:inline-block;height:1.25em;width:auto;vertical-align:-0.25em;margin-right:.3em'/>Shop" },
  { id: 'potw', label: "<img src='images/icon-potw.png' alt='' style='display:inline-block;height:1.25em;width:auto;vertical-align:-0.25em;margin-right:.3em'/>Place of the Week" },
];
// ⚔️ Battle Day sits right after the main tabs — every Battle-Day-only control
// (prize rules, hit points, punching down, live shields/defenses) lives here.
// ❓ Help sits immediately before Settings; Settings is always last.
const BATTLE_TAB = { id: 'battle', label: "<img src='images/icon-battle.png' alt='' style='display:inline-block;height:1.25em;width:auto;vertical-align:-0.25em;margin-right:.3em'/>Battle Day" };
const HELP_TAB = { id: 'help', label: '❓ Help' };
const SETTINGS_TAB = { id: 'settings', label: '⚙️ Settings' };
const TABS = [...MAIN_TABS, BATTLE_TAB, HELP_TAB, SETTINGS_TAB];

// Article ids in js/core/help.js. Kept in one place so a rename over there is a
// one-line fix here. (These are TOPIC ids, not category ids — openHelp() takes
// a topic; openHelpAt() takes a category.)
const HELP_TOPICS = {
  planner: 'admin-planner',
  quests: 'quests-how',
  shop: 'shop-effects',
  potw: 'potw-schedule',
  backups: 'data-backup',
  lock: 'admin-lock',
  sfx: 'admin-sfx',
  battle: 'battle-hp',
};

// ---------------------------------------------------------------------------
// Module-scoped lifecycle state (mount/unmount owns all of this)
// ---------------------------------------------------------------------------
let ctxRef = null;
let rootEl = null;
let unsub = null;
let clickHandler = null;
let changeHandler = null;
let dragOverHandler = null;
let dragLeaveHandler = null;
let dropHandler = null;
let inputHandler = null;
const timers = new Set();
const presUrls = new Set();   // object URLs we own for presentation image thumbnails

let activeTab = 'planner';            // 'planner' | 'settings' | 'potw'
const cal = { year: 0, month: 0 };    // currently-viewed calendar month
let panelView = null;                 // null | 'day' | 'form'  (right side panel)
let panelDate = null;                 // 'YYYY-MM-DD' the day editor is showing
let form = null;                      // in-progress event form / itinerary builder
let potwForm = null;                  // in-progress POTW profile editor
let shopForm = null;                  // in-progress shop item editor
let dangerOpen = false;               // danger-zone accordion state
const shopUrls = new Set();           // object URLs we own for shop image previews
let backupStatusTimer = null;         // interval that keeps the auto-backup "last saved" line live
let shopGuideOpen = false;            // "How magic items work" accordion state
let questGuideOpen = false;           // "How quests work" accordion state
let questForm = null;                 // in-progress quest editor
let houseForm = null;                 // in-progress house editor (Settings tab)
let videoForm = null;                 // in-progress intro-video preset editor (POTW tab)
let awardForm = null;                 // in-progress quick-award preset editor (Settings tab)
// Teacher PIN card (Settings tab). mode is only meaningful once a PIN exists:
// null = the default on/off summary view, 'change' / 'off' = the inline form
// asking for the current PIN before either action goes through.
let lockUi = { mode: null, currentPin: '', newPin: DEFAULT_PIN, confirmPin: DEFAULT_PIN, error: '' };
let helpState = null;                 // null | 'loading' | 'ok' | 'unavailable' (Help tab)
let pendingPdf = null;                // { key, file, rest } awaiting the presentation-vs-resource choice
let musicPreview = null;              // { el, screen } — the one background-music preview clip playing, if any
let combatPreviewSel = { attacker: 1, defender: 2 };  // Battle rules card: which two houses the live prize preview compares

const AMBER = '#f59e0b';
const DEFAULT_CAM = { lat: 32.5363, lng: 44.4223, altitude: 150, range: 2000, tilt: 60, heading: 45 };

// Event type registry — label + colour + rendering hints.
const TYPES = {
  'term-start': { label: 'Term Start', color: '#f59e0b', outline: false },
  'term-end':   { label: 'Term End',   color: '#f59e0b', outline: true  },
  'vacation':   { label: 'Vacation',   color: '#8b5cf6', outline: false, range: true },
  'test':       { label: 'Test',       color: '#ef4444', outline: false },
  'quiz':       { label: 'Quiz',       color: '#f97316', outline: false },
  'homework':   { label: 'Homework',   color: '#3b82f6', outline: false },
  'itinerary':  { label: 'Itinerary',  color: '#22c55e', outline: false },
  'potw':       { label: 'Place of Week', color: '#06b6d4', outline: false },
  'note':       { label: 'Note',       color: 'rgb(156, 163, 175)', outline: false },
};
// Order used for legend + chip sorting.
const TYPE_ORDER = ['itinerary', 'homework', 'test', 'quiz', 'vacation', 'potw', 'note', 'term-start', 'term-end'];
// Types the teacher may pick in the day-editor form ('potw' is managed from the
// Place-of-the-Week tab; auto term markers are still hand-selectable).
const FORM_TYPES = ['itinerary', 'homework', 'test', 'quiz', 'vacation', 'note', 'term-start', 'term-end'];

// ---------------------------------------------------------------------------
// Tiny helpers
// ---------------------------------------------------------------------------
function esc(s) {
  return String(s == null ? '' : s).replace(/[&<>"']/g, (c) =>
    ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}
function pad(n) { return String(n).padStart(2, '0'); }
function ymd(d) { return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`; }
function todayStr() { return ymd(new Date()); }
function parseYMD(s) { const [y, m, d] = String(s).split('-').map(Number); return new Date(y, (m || 1) - 1, d || 1); }
function addDays(d, n) { const x = new Date(d); x.setDate(x.getDate() + n); return x; }
// Calendar display is Sunday-first (does not touch the store's week math).
function sundayOf(d) { const x = new Date(d); x.setDate(x.getDate() - x.getDay()); x.setHours(0, 0, 0, 0); return x; }
function humanSize(bytes) {
  const b = Number(bytes) || 0;
  if (b < 1024) return `${b} B`;
  if (b < 1024 * 1024) return `${(b / 1024).toFixed(1)} KB`;
  if (b < 1024 * 1024 * 1024) return `${(b / (1024 * 1024)).toFixed(1)} MB`;
  return `${(b / (1024 * 1024 * 1024)).toFixed(2)} GB`;
}
function slugify(s) {
  return String(s || '').toLowerCase().trim().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 40) || 'destination';
}
function coreLabel(core) { return core === 'all' ? 'All Cores' : `Core ${core}`; }
function hexNorm(s) { const v = String(s || '').trim(); return v && !v.startsWith('#') ? `#${v}` : v; }
function isHex(s) { return /^#[0-9a-f]{6}$/i.test(String(s || '')); }

function el(id) { return document.getElementById(id); }
function later(fn, ms) { const id = setTimeout(() => { timers.delete(id); try { fn(); } catch (e) { console.warn('admin:', e); } }, ms); timers.add(id); return id; }
function clearTimers() { timers.forEach(clearTimeout); timers.clear(); }

function toast(msg) {
  if (!rootEl) return;
  const t = document.createElement('div');
  t.className = 'admin-toast';
  t.textContent = msg;
  rootEl.appendChild(t);
  later(() => t.remove(), 2600);
}

// ---------------------------------------------------------------------------
// Shell + tab routing
// ---------------------------------------------------------------------------
function renderShell() {
  rootEl.innerHTML = `
    <div class="admin-wrap">
      <div class="admin-head">
        <div class="admin-titlebar">
          <span class="admin-key">🗝️</span>
          <div>
            <div class="admin-title">Teacher's Admin</div>
            <div class="admin-sub">Plan the term, tune settings, curate the world.</div>
          </div>
        </div>
        <div class="admin-seg" role="tablist">
          ${TABS.map((t) => `<button class="admin-seg-btn" data-action="tab" data-tab="${t.id}">${t.label}</button>`).join('')}
        </div>
      </div>
      <div id="admin-body" class="admin-body"></div>
    </div>
    <div id="admin-panel-root"></div>
    <div id="admin-modal-root"></div>`;
  syncSegActive();
  renderBody();
}

function syncSegActive() {
  rootEl.querySelectorAll('.admin-seg-btn').forEach((b) =>
    b.classList.toggle('active', b.dataset.tab === activeTab));
}

// force=true bypasses the mid-typing guard — used by explicit saves, which must
// always repaint even when the teacher is still focused in the field they edited.
function renderBody({ force = false } = {}) {
  const body = el('admin-body');
  if (!body) return;
  // Don't clobber a field the teacher is mid-typing in the body.
  const ae = document.activeElement;
  if (!force && ae && body.contains(ae) && /^(INPUT|TEXTAREA|SELECT)$/.test(ae.tagName)) return;
  if (force && ae && body.contains(ae) && typeof ae.blur === 'function') ae.blur();
  if (activeTab === 'planner') body.innerHTML = renderPlanner();
  else if (activeTab === 'quests') body.innerHTML = renderQuests();
  else if (activeTab === 'shop') { body.innerHTML = renderShop(); refreshShopThumbs(); }
  else if (activeTab === 'battle') body.innerHTML = renderBattleDay();
  else if (activeTab === 'help') body.innerHTML = renderHelp();
  else if (activeTab === 'settings') body.innerHTML = renderSettings();
  else { body.innerHTML = renderPotw(); refreshPotwMedia(); }
}

function setTab(tab) {
  activeTab = tab;
  stopMusicPreview();
  closePanel();
  closeModal();
  syncSegActive();
  renderBody();
  // Selecting ❓ Help brings the handbook up immediately — the tab body behind
  // it is just a table of contents for jumping to another article.
  if (tab === 'help') openHelpTopic(null);   // null = open the handbook at its contents page
}

// ===========================================================================
// TAB 1 — PLANNER (month calendar)
// ===========================================================================
function renderPlanner() {
  const store = ctxRef.store;
  const first = new Date(cal.year, cal.month, 1);
  const monthLabel = first.toLocaleDateString(undefined, { month: 'long', year: 'numeric' });
  const start = sundayOf(first);
  const today = todayStr();
  const dowNames = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];

  let grid = '';
  for (let w = 0; w < 6; w++) {
    let row = '';
    for (let i = 0; i < 7; i++) {
      const day = addDays(start, w * 7 + i);
      const ds = ymd(day);
      const inMonth = day.getMonth() === cal.month;
      const isToday = ds === today;
      const weekend = i === 0 || i === 6;
      const events = store.getEventsOn(ds).slice().sort((a, b) => TYPE_ORDER.indexOf(a.type) - TYPE_ORDER.indexOf(b.type));
      const shown = events.slice(0, 3);
      const overflow = events.length - shown.length;
      row += `
        <button class="admin-cell${inMonth ? '' : ' out'}${weekend ? ' weekend' : ''}${isToday ? ' today' : ''}"
                data-action="open-day" data-date="${ds}">
          <span class="admin-cell-num">${day.getDate()}</span>
          <span class="admin-cell-chips">
            ${shown.map(calChip).join('')}
            ${overflow > 0 ? `<span class="admin-chip-more">+${overflow}</span>` : ''}
          </span>
        </button>`;
    }
    grid += `<div class="admin-week">${row}</div>`;
  }

  return `
    <div class="admin-planner">
      <div class="admin-toolbar">
        <div class="admin-nav">
          <button class="admin-btn admin-btn-icon" data-action="cal-prev" aria-label="Previous month">‹</button>
          <button class="admin-btn" data-action="cal-today">Today</button>
          <button class="admin-btn admin-btn-icon" data-action="cal-next" aria-label="Next month">›</button>
        </div>
        <div class="admin-month">${esc(monthLabel)}</div>
        <div class="admin-legend">${legendHTML()}</div>
      </div>
      <div class="admin-dow">${dowNames.map((n, i) => `<div class="${(i === 0 || i === 6) ? 'weekend' : ''}">${n}</div>`).join('')}</div>
      <div class="admin-grid">${grid}</div>
      <div class="admin-hint">💡 Entries here feed the Morning Dashboard — today's itinerary &amp; homework read planned events first, falling back to defaults. Tap any day to plan it.</div>
    </div>`;
}

function calChip(evt) {
  const t = TYPES[evt.type] || TYPES.note;
  const label = evt.title || t.label;
  const style = t.outline
    ? `background:transparent;border:1px solid ${t.color};color:${t.color};`
    : `background:${t.color}26;border:1px solid ${t.color}80;color:${t.color};`;
  // POTW chips jump straight to the destination editor (click caught before the cell).
  if (evt.type === 'potw' && evt.payload?.profileKey) {
    return `<span class="admin-chip admin-chip-link" style="${style}" title="${esc(label)} — open editor"
      data-action="potw-jump" data-key="${esc(evt.payload.profileKey)}">${esc(label)}</span>`;
  }
  return `<span class="admin-chip" style="${style}" title="${esc(label)}">${esc(label)}</span>`;
}

function legendHTML() {
  return TYPE_ORDER.map((k) => {
    const t = TYPES[k];
    const sw = t.outline
      ? `background:transparent;border:1px solid ${t.color};`
      : `background:${t.color};border:1px solid ${t.color};`;
    return `<span class="admin-leg"><span class="admin-leg-sw" style="${sw}"></span>${t.label}</span>`;
  }).join('');
}

// ---- Day editor side panel ------------------------------------------------
function openDay(date) {
  panelDate = date;
  panelView = 'day';
  renderPanel();
}
function closePanel() {
  panelView = null; form = null;
  const p = el('admin-panel-root');
  if (p) p.innerHTML = '';   // removes .admin-panel so the next open re-animates
}

// Update the panel CONTENT in place. The .admin-panel wrapper (which carries the
// slide-in animation) is created ONCE when opening from closed and reused for all
// internal interactions (add/edit/save) — so no flicker.
function renderPanel() {
  const host = el('admin-panel-root');
  if (!host) return;
  if (!panelView) { host.innerHTML = ''; return; }
  const inner = panelView === 'day' ? dayEditorHTML() : eventFormHTML();
  let panel = host.querySelector('.admin-panel');
  if (!panel) {
    panel = document.createElement('div');
    panel.className = 'admin-panel';
    host.appendChild(panel);   // animation runs only on this fresh element
  }
  panel.innerHTML = inner;
}

function dayEditorHTML() {
  const store = ctxRef.store;
  const d = parseYMD(panelDate);
  const long = d.toLocaleDateString(undefined, { weekday: 'long', month: 'long', day: 'numeric', year: 'numeric' });
  const events = store.getEventsOn(panelDate).slice().sort((a, b) => TYPE_ORDER.indexOf(a.type) - TYPE_ORDER.indexOf(b.type));
  return `
    <div class="admin-panel-head">
      <div>
        <div class="admin-panel-eyebrow">Day Planner</div>
        <div class="admin-panel-title">${esc(long)}</div>
      </div>
      <button class="admin-btn admin-btn-icon" data-action="panel-close" aria-label="Close">✕</button>
    </div>
    <div class="admin-panel-body">
      ${events.length ? events.map(eventRowHTML).join('') : '<div class="admin-empty">No events yet. Add the day\'s plan below.</div>'}
    </div>
    <div class="admin-panel-foot">
      <button class="admin-btn admin-btn-primary admin-btn-lg" data-action="evt-add">+ Add Event</button>
    </div>`;
}

function eventRowHTML(evt) {
  const t = TYPES[evt.type] || TYPES.note;
  const range = evt.endDate && evt.endDate !== evt.date ? ` → ${esc(evt.endDate)}` : '';
  const stepCount = evt.type === 'itinerary' ? `${(evt.items || []).length} steps` : '';
  const meta = [coreLabel(evt.core), t.label, stepCount].filter(Boolean).join(' · ');
  // POTW markers are owned by the Place-of-the-Week tab; offer a jump, not edit/delete.
  const actions = evt.type === 'potw'
    ? `<button class="admin-btn admin-btn-sm" data-action="potw-jump" data-key="${esc(evt.payload?.profileKey || '')}">Open in POTW →</button>`
    : `<button class="admin-btn admin-btn-icon" data-action="evt-edit" data-id="${evt.id}" aria-label="Edit">✏️</button>
       <button class="admin-btn admin-btn-icon admin-btn-danger" data-action="evt-del" data-id="${evt.id}" aria-label="Delete">🗑️</button>`;
  return `
    <div class="admin-evt">
      <span class="admin-evt-dot" style="background:${t.outline ? 'transparent' : t.color};border:2px solid ${t.color};"></span>
      <div class="admin-evt-main">
        <div class="admin-evt-title">${esc(evt.title || t.label)}${range}</div>
        <div class="admin-evt-meta">${esc(meta)}</div>
      </div>
      ${actions}
    </div>`;
}

// ---- Add / edit event form (+ itinerary builder) --------------------------
function startAdd() {
  form = { mode: 'add', id: null, date: panelDate, type: 'note', core: 'all', title: '', endDate: '', items: [] };
  panelView = 'form';
  renderPanel();
}
function startEdit(id) {
  const evt = ctxRef.store.getState().planner.events.find((e) => e.id === id);
  if (!evt) return;
  form = {
    mode: 'edit', id: evt.id, date: evt.date, type: evt.type,
    core: evt.core, title: evt.title || '', endDate: evt.endDate || '',
    items: Array.isArray(evt.items) ? evt.items.map((it) => ({ ...it })) : [],
  };
  panelDate = evt.date;
  panelView = 'form';
  renderPanel();
}

function eventFormHTML() {
  const isItin = form.type === 'itinerary';
  const isVac = TYPES[form.type] && TYPES[form.type].range;
  const d = parseYMD(form.date);
  const long = d.toLocaleDateString(undefined, { weekday: 'short', month: 'short', day: 'numeric' });

  const typeChips = FORM_TYPES.map((k) => {
    const t = TYPES[k];
    const on = form.type === k;
    return `<button class="admin-type-chip${on ? ' on' : ''}" data-action="set-type" data-type="${k}"
              style="--c:${t.color}">${t.label}</button>`;
  }).join('');

  const coreOpts = ['all', 1, 2, 3, 4].map((c) =>
    `<option value="${c}"${String(form.core) === String(c) ? ' selected' : ''}>${coreLabel(c)}</option>`).join('');

  return `
    <div class="admin-panel-head">
      <div>
        <div class="admin-panel-eyebrow">${form.mode === 'add' ? 'New Event' : 'Edit Event'} · ${esc(long)}</div>
        <div class="admin-panel-title">${isItin ? '🧭 Itinerary Builder' : 'Event Details'}</div>
      </div>
      <button class="admin-btn admin-btn-icon" data-action="form-back" aria-label="Back">✕</button>
    </div>
    <div class="admin-panel-body">
      <label class="admin-flabel">Type</label>
      <div class="admin-type-grid">${typeChips}</div>

      ${isItin ? '' : `
        <label class="admin-flabel" for="admin-f-title">Title</label>
        <input id="admin-f-title" class="admin-input" type="text" value="${esc(form.title)}"
               placeholder="e.g. ${esc(TYPES[form.type].label)}: Chapter 4 Quiz" />
      `}

      <label class="admin-flabel" for="admin-f-core">Applies to</label>
      <select id="admin-f-core" class="admin-input">${coreOpts}</select>

      ${isVac ? `
        <label class="admin-flabel" for="admin-f-end">End date (optional — multi-day range)</label>
        <input id="admin-f-end" class="admin-input" type="date" value="${esc(form.endDate)}" min="${esc(form.date)}" />
      ` : ''}

      ${isItin ? itineraryBuilderHTML() : ''}
    </div>
    <div class="admin-panel-foot admin-foot-split">
      <button class="admin-btn admin-btn-lg" data-action="form-back">Cancel</button>
      <button class="admin-btn admin-btn-primary admin-btn-lg" data-action="evt-save">Save</button>
    </div>`;
}

function itineraryBuilderHTML() {
  const rows = form.items.map((it, i) => `
    <div class="admin-brow">
      <span class="admin-bstep" aria-hidden="true">${i + 1}</span>
      <div class="admin-bfields">
        <input class="admin-input admin-btext" type="text" value="${esc(it.text)}" placeholder="Step ${i + 1} — what happens" aria-label="Step ${i + 1}" />
        <input class="admin-input admin-btime" type="text" value="${esc(it.time)}" placeholder="time (optional)" aria-label="Time (optional)" />
      </div>
      <div class="admin-brow-ctrls">
        <button class="admin-btn admin-btn-icon" data-action="builder-up" data-i="${i}" aria-label="Move up"${i === 0 ? ' disabled' : ''}>▲</button>
        <button class="admin-btn admin-btn-icon" data-action="builder-down" data-i="${i}" aria-label="Move down"${i === form.items.length - 1 ? ' disabled' : ''}>▼</button>
        <button class="admin-btn admin-btn-icon admin-btn-danger" data-action="builder-del" data-i="${i}" aria-label="Remove">✕</button>
      </div>
    </div>`).join('');

  return `
    <div class="admin-builder">
      <div class="admin-builder-head">
        <span class="admin-flabel" style="margin:0">Numbered steps <span class="admin-faint">(time optional)</span></span>
        <button class="admin-btn admin-btn-sm" data-action="builder-copy">Copy from default</button>
      </div>
      <div class="admin-brows">
        ${rows || '<div class="admin-empty admin-empty-sm">No steps yet — add one or copy the default itinerary.</div>'}
      </div>
      <button class="admin-btn admin-btn-sm admin-btn-block" data-action="builder-add">+ Add step</button>
      <div class="admin-dup">
        <button class="admin-btn admin-btn-sm admin-btn-block admin-btn-accent" data-action="dup-open">⧉ Duplicate to… (build a whole semester)</button>
        <div class="admin-dup-note">Copies these rows onto every chosen weekday across a date range — one itinerary per day. Days with a vacation are skipped.</div>
      </div>
    </div>`;
}

// Read the current DOM form state back into `form` before any re-render.
function syncFormFromDom() {
  if (!form) return;
  const titleEl = el('admin-f-title'); if (titleEl) form.title = titleEl.value;
  const coreEl = el('admin-f-core'); if (coreEl) form.core = coreEl.value === 'all' ? 'all' : Number(coreEl.value);
  const endEl = el('admin-f-end'); if (endEl) form.endDate = endEl.value || '';
  if (form.type === 'itinerary') {
    const rows = [...rootEl.querySelectorAll('.admin-brow')];
    form.items = rows.map((r) => ({
      time: r.querySelector('.admin-btime').value.trim(),
      text: r.querySelector('.admin-btext').value.trim(),
    }));
  }
}

// One itinerary event per (date, core): update if present, else create.
function upsertItinerary(date, core, items, title) {
  const store = ctxRef.store;
  const existing = store.getState().planner.events.find(
    (e) => e.type === 'itinerary' && e.date === date && e.core === core);
  if (existing) store.updateEvent(existing.id, { items, title: title || 'Itinerary', core });
  else store.addEvent({ date, type: 'itinerary', core, title: title || 'Itinerary', items });
}

function saveEvent() {
  syncFormFromDom();
  const store = ctxRef.store;

  if (form.type === 'itinerary') {
    const items = form.items.filter((it) => it.time || it.text);
    if (!items.length) { toast('Add at least one itinerary row.'); return; }
    const title = form.title || 'Itinerary';
    if (form.mode === 'edit' && form.id) {
      store.updateEvent(form.id, { items, title, core: form.core });
    } else {
      upsertItinerary(form.date, form.core, items, title);
    }
    toast('Itinerary saved.');
  } else {
    const patch = { date: form.date, type: form.type, core: form.core, title: form.title.trim() };
    if (TYPES[form.type].range && form.endDate && form.endDate >= form.date) patch.endDate = form.endDate;
    if (form.mode === 'edit' && form.id) {
      // Clear a stale endDate if this type no longer supports a range or field was emptied.
      if (!patch.endDate) patch.endDate = undefined;
      store.updateEvent(form.id, patch);
    } else {
      store.addEvent(patch);
    }
    toast('Event saved.');
  }
  panelView = 'day';
  renderPanel();
  renderBody();
}

// ---- Duplicate-to (semester builder) modal --------------------------------
function openDupModal() {
  syncFormFromDom();
  const items = form.items.filter((it) => it.time || it.text);
  if (!items.length) { toast('Add itinerary rows first.'); return; }
  const from = form.date;
  const to = ymd(addDays(parseYMD(form.date), 28));
  const days = [
    ['1', 'Mon', true], ['2', 'Tue', true], ['3', 'Wed', true], ['4', 'Thu', true],
    ['5', 'Fri', true], ['6', 'Sat', false], ['0', 'Sun', false],
  ];
  const m = el('admin-modal-root');
  m.innerHTML = `
    <div class="admin-modal-bg" data-action="modal-close"></div>
    <div class="admin-modal">
      <div class="admin-modal-head">
        <div class="admin-modal-title">⧉ Duplicate Itinerary</div>
        <button class="admin-btn admin-btn-icon" data-action="modal-close" aria-label="Close">✕</button>
      </div>
      <div class="admin-modal-body">
        <p class="admin-modal-lead">Copy these ${items.length} rows onto every chosen weekday for <b>${coreLabel(form.core)}</b>. Existing itineraries on those days are overwritten; days with a vacation are skipped.</p>
        <div class="admin-two">
          <div><label class="admin-flabel" for="admin-dup-from">From</label>
            <input id="admin-dup-from" class="admin-input" type="date" value="${esc(from)}" /></div>
          <div><label class="admin-flabel" for="admin-dup-to">To</label>
            <input id="admin-dup-to" class="admin-input" type="date" value="${esc(to)}" /></div>
        </div>
        <label class="admin-flabel">Weekdays</label>
        <div class="admin-dow-picker">
          ${days.map(([v, lbl, on]) => `
            <label class="admin-check">
              <input type="checkbox" class="admin-dup-day" value="${v}"${on ? ' checked' : ''} />
              <span>${lbl}</span>
            </label>`).join('')}
        </div>
      </div>
      <div class="admin-modal-foot">
        <button class="admin-btn admin-btn-lg" data-action="modal-close">Cancel</button>
        <button class="admin-btn admin-btn-primary admin-btn-lg" data-action="dup-apply">Apply to range</button>
      </div>
    </div>`;
}

function applyDup() {
  const store = ctxRef.store;
  const items = form.items.filter((it) => it.time || it.text);
  const from = el('admin-dup-from').value;
  const to = el('admin-dup-to').value;
  if (!from || !to || to < from) { toast('Pick a valid date range.'); return; }
  const picked = new Set([...rootEl.querySelectorAll('.admin-dup-day:checked')].map((c) => Number(c.value)));
  if (!picked.size) { toast('Pick at least one weekday.'); return; }

  let made = 0, skipped = 0;
  let d = parseYMD(from);
  const end = parseYMD(to);
  while (d <= end) {
    if (picked.has(d.getDay())) {
      const ds = ymd(d);
      const vacation = store.getEventsOn(ds, form.core === 'all' ? null : form.core).some((e) => e.type === 'vacation');
      if (vacation) { skipped++; }
      else { upsertItinerary(ds, form.core, items.map((it) => ({ ...it })), form.title || 'Itinerary'); made++; }
    }
    d = addDays(d, 1);
  }
  closeModal();
  panelView = 'day';
  renderPanel();
  renderBody();
  toast(`Applied to ${made} day${made === 1 ? '' : 's'}${skipped ? `, skipped ${skipped} (vacation)` : ''}.`);
}

// ===========================================================================
// TAB — QUESTS (active per-core quests, catalog manager, completions)
// ===========================================================================
function questDateStr(ts) {
  return new Date(ts).toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' });
}

// The store defaults a quest's give-up penalty to half its reward. Saved quests
// from before that field existed get the same treatment on load, but mirror the
// rule here so nothing in the UI ever shows "−undefined".
function questPenalty(q) {
  const p = Number(q?.penalty);
  return Number.isFinite(p) ? Math.max(0, Math.round(p)) : Math.round(Number(q?.points || 0) / 2);
}

// One plain-English sentence describing a quest, shared by the catalog list and
// the editor's live preview — so the teacher reads the same words in both.
function questSentence(q) {
  const pts = Math.max(0, Math.round(Number(q?.points) || 0));
  const pen = questPenalty(q);
  const repeat = q?.repeatable
    ? 'After it is completed it goes back on the board, so another house can earn it too.'
    : 'Once any house completes it, it leaves the board for good.';
  const give = pen > 0
    ? `If a house gives up, they lose ${pen} points and the quest returns to the board.`
    : 'If a house gives up, there is no penalty and the quest returns to the board.';
  return `Worth ${pts} points. ${repeat} ${give}`;
}

function renderQuests() {
  const store = ctxRef.store;
  const catalog = store.getQuestCatalog();
  const completed = store.getCompletedQuests({ limit: 20 });
  const doneIds = store.getCompletedQuests({ limit: 100000 }).map((c) => c.questId);

  // ---- active quests, one card per core ----
  const activeCards = [1, 2, 3, 4].map((core) => {
    const house = store.HOUSES[core];
    const q = store.getActiveQuest(core);
    const body = q
      ? `<div class="admin-q-active-body">
           <div class="admin-q-active-title">${esc(q.title)}</div>
           <div class="admin-q-active-desc">${esc(q.desc || '')}</div>
           <div class="admin-q-active-meta">💎 ${q.points} pts · accepted ${esc(questDateStr(q.startedTs))} · ${q.repeatable ? '♻️ repeatable' : '★ one time only'}</div>
           <div class="admin-q-active-actions">
             <button class="admin-btn admin-btn-primary" data-action="quest-complete" data-core="${core}">✅ Confirm Complete <span class="admin-q-btn-note">+${q.points}</span></button>
             <button class="admin-btn admin-btn-danger" data-action="quest-fail" data-core="${core}">✖ Mark Given Up <span class="admin-q-btn-note">−${questPenalty(q)}</span></button>
           </div>
           <button class="admin-linkbtn admin-q-quiet" data-action="quest-clear" data-core="${core}">Clear without penalty (accepted by mistake)</button>
         </div>`
      : '<div class="admin-q-active-empty">No quest accepted<span>Houses pick one on the Quests screen.</span></div>';
    return `
      <div class="admin-q-active" style="--house:${house.accent}">
        <div class="admin-q-active-head" style="color:${house.accent}">${esc(house.name)} <span class="admin-faint">· Core ${core}</span></div>
        ${body}
      </div>`;
  }).join('');

  // ---- catalog, grouped by repeatable vs one-time ----
  const questRow = (q) => {
    const holder = store.questHolder(q.id);
    const retired = !q.repeatable && doneIds.includes(q.id);
    let status = '';
    if (holder) {
      const h = store.HOUSES[holder];
      status = `<span class="admin-q-status held" style="--house:${h.accent}">In progress — ${esc(h.name)}</span>`;
    } else if (retired) {
      status = '<span class="admin-q-status retired">Retired — already completed</span>';
    } else {
      status = '<span class="admin-q-status open">On the board</span>';
    }
    return `
      <div class="admin-q-row">
        <div class="admin-q-pts">${q.points}<small>pts</small></div>
        <div class="admin-q-main">
          <div class="admin-q-title"><span title="${esc(store.questType(q).label)} — ${esc(store.questType(q).blurb)}">${store.questIcon(q)}</span> ${esc(q.title)}</div>
          <div class="admin-q-desc">${esc(q.desc || '')}</div>
          <div class="admin-shop-plain">${esc(questSentence(q))}</div>
          <div class="admin-q-statusrow">${status}</div>
        </div>
        <div class="admin-q-row-actions">
          <button class="admin-btn admin-btn-icon" data-action="quest-edit" data-id="${esc(q.id)}" aria-label="Edit">✏️</button>
          <button class="admin-btn admin-btn-icon admin-btn-danger" data-action="quest-del" data-id="${esc(q.id)}" aria-label="Delete">🗑️</button>
        </div>
      </div>`;
  };

  const groups = [
    { key: 'repeat', title: '♻️ Repeatable quests', note: 'Come back to the board after a house finishes them.',
      list: catalog.filter((q) => q.repeatable) },
    { key: 'once', title: '★ One-time quests', note: 'Leave the board forever once completed.',
      list: catalog.filter((q) => !q.repeatable) },
  ];
  const sections = groups.map((g) => {
    const list = g.list.slice().sort((a, b) => (b.points - a.points) || String(a.title).localeCompare(String(b.title)));
    if (!list.length) return '';
    return `
      <div class="admin-shop-group">
        <div class="admin-shop-group-head">
          <span class="admin-shop-group-title">${g.title} <span class="admin-faint">(${list.length})</span></span>
          <span class="admin-faint">${esc(g.note)}</span>
        </div>
        <div class="admin-q-list">${list.map(questRow).join('')}</div>
      </div>`;
  }).join('');

  return `
    <div class="admin-quests">
      ${questGuideHTML()}

      <div class="admin-card">
        <div class="admin-card-title">Active Quests</div>
        <div class="admin-mini">One quest per house at a time. A house accepts a quest on the Quests screen; you confirm the result here — or on the big buttons on the Quests screen itself.</div>
        <div class="admin-q-active-grid">${activeCards}</div>
      </div>

      <div class="admin-card">
        <div class="admin-rows-head">
          <span class="admin-card-title" style="margin:0">Quest Catalog <span class="admin-faint">(${catalog.length})</span></span>
          <button class="admin-btn admin-btn-primary" data-action="quest-new">+ New Quest</button>
        </div>
        <div class="admin-mini">These are the tasks houses can choose from. Anything you write here shows up on the Quest Board.</div>
        ${sections || '<div class="admin-empty admin-empty-sm">No quests yet. Add one to get started.</div>'}
      </div>

      <div class="admin-card">
        <div class="admin-card-title">Recent Completions</div>
        <div class="admin-q-list">
          ${completed.length ? completed.map((c) => {
            const house = store.HOUSES[c.core];
            return `<div class="admin-q-done">
              <span class="admin-evt-dot" style="background:${house ? house.accent : '#6b7280'};border:2px solid ${house ? house.accent : '#6b7280'}"></span>
              <div class="admin-q-main">
                <div class="admin-q-title">${esc(c.title)}</div>
                <div class="admin-q-desc">${esc(house ? house.name : '')} · +${c.points} pts · ${esc(questDateStr(c.ts))}</div>
              </div>
            </div>`;
          }).join('') : '<div class="admin-empty admin-empty-sm">No quests completed yet.</div>'}
        </div>
      </div>
    </div>`;
}

// Plain-language primer, in the same spirit as the Magic Shop guide.
function questGuideHTML() {
  return `
    <div class="admin-card">
      <details class="admin-details admin-guide" ${questGuideOpen ? 'open' : ''}>
        <summary data-action="quest-guide-toggle">📖 How quests work</summary>
        <div class="admin-guide-body">
          <p class="admin-guide-p"><b>A house agrees to a task.</b> On the Quests screen they tap “Accept Quest”. The quest jumps to the top of the screen as their <b>active quest</b> and disappears from the board below, so nobody else can take it.</p>
          <p class="admin-guide-p"><b>One quest at a time.</b> A house can't accept a second quest until the first one is finished or given up.</p>
          <p class="admin-guide-p"><b>You decide when it's done.</b> When the class has actually met the conditions, press the green <b>✓ Mark Complete</b> — on the Quests screen or right here — and the points go to that house.</p>
          <p class="admin-guide-p"><b>Giving up costs points.</b> If a house can't finish, press the red <b>✗ Give Up</b>. The penalty is deducted and the quest goes back on the board, where another house can steal it.</p>
          <p class="admin-guide-p"><b>Repeatable vs. one-time.</b> A <b>♻️ repeatable</b> quest returns to the board after it's completed, so every house can earn it. A <b>★ one-time</b> quest retires forever the moment any house finishes it.</p>

          <div class="admin-guide-callout">
            🗝️ Tapped a button by mistake? <b>“Clear without penalty”</b> under each active quest quietly puts it back on the board — nobody gains or loses anything. To undo points that were already awarded, use the transaction list on the Records screen.
          </div>

          <div class="admin-guide-tablewrap">
            <div class="admin-guide-tabletitle">What each button does</div>
            <table class="admin-matchup">
              <thead><tr><th>Button</th><th>Points</th><th>The quest</th></tr></thead>
              <tbody>
                <tr><td class="admin-mu-row">✅ Confirm Complete</td><td class="admin-mu-block">+ full reward</td><td>Repeatable → back on the board. One-time → retired.</td></tr>
                <tr><td class="admin-mu-row">✖ Mark Given Up</td><td><b>− penalty</b></td><td>Back on the board for another house.</td></tr>
                <tr><td class="admin-mu-row">Clear without penalty</td><td>no change</td><td>Back on the board for another house.</td></tr>
              </tbody>
            </table>
          </div>
        </div>
      </details>
      <div class="admin-help-row">${helpLink(HELP_TOPICS.quests, 'More about quests in the handbook')}</div>
    </div>`;
}

// ---- catalog editor --------------------------------------------------------
function openQuestForm(id) {
  const store = ctxRef.store;
  const q = id ? store.getQuestCatalog().find((x) => x.id === id) : null;
  questForm = {
    id: q ? q.id : `q-${Date.now()}`,
    isNew: !q,
    title: q?.title || '',
    desc: q?.desc || '',
    points: q?.points ?? 20,
    // New quest starts on the store's own fallback kind; editing an existing
    // one reads through store.questType() so a legacy/unset type resolves
    // the same way here as it does everywhere else it's displayed.
    type: q ? store.questType(q).id : 'service',
    // RAW icon, never the resolved fallback — an empty icon has to stay empty
    // here or it gets "promoted" into a real one the next time this quest is
    // saved, even if the teacher only touched an unrelated field.
    icon: q ? (q.icon || '') : '',
    repeatable: !!q?.repeatable,
    penalty: q ? questPenalty(q) : 10,
    // While false, the penalty tracks half the reward automatically. The moment
    // the teacher types their own number we stop moving it under them.
    penaltyTouched: !!q,
    saveError: null,
  };
  renderQuestModal();
}

function renderQuestModal() {
  const f = questForm;
  if (!f) return;
  const store = ctxRef.store;
  const m = el('admin-modal-root');
  // Driven entirely off store.QUEST_TYPES — a fifth kind added there shows up
  // here with no changes needed.
  const typeOpts = Object.values(store.QUEST_TYPES).map((t) => `
    <button class="admin-theme-opt${f.type === t.id ? ' on' : ''}" data-action="quest-type" data-type="${esc(t.id)}" title="${esc(t.blurb)}">${t.icon} ${esc(t.label)}</button>
  `).join('');
  const opts = [
    { key: true, label: '♻️ Repeatable', explain: 'Any house can earn this again. It returns to the board after it is completed.' },
    { key: false, label: '★ One time only', explain: 'It leaves the board once completed — the first house to finish it is the only one who ever gets it.' },
  ].map((o) => {
    const on = f.repeatable === o.key;
    return `<label class="admin-eff-opt${on ? ' on' : ''}">
      <input type="radio" name="admin-quest-repeat" value="${o.key ? '1' : '0'}" ${on ? 'checked' : ''} />
      <span class="admin-eff-label">${o.label}</span>
      <span class="admin-eff-explain">${esc(o.explain)}</span>
    </label>`;
  }).join('');

  const half = Math.round((Number(f.points) || 0) / 2);
  const saveErr = f.saveError ? `<div class="admin-warn-line admin-save-err">⚠️ ${esc(f.saveError)}</div>` : '';

  m.innerHTML = `
    <div class="admin-modal-bg" data-action="quest-close"></div>
    <div class="admin-modal admin-modal-lg">
      <div class="admin-modal-head">
        <div class="admin-modal-title">${f.isNew ? '🗺️ New Quest' : '✏️ Edit Quest'}</div>
        <button class="admin-btn admin-btn-icon" data-action="quest-close" aria-label="Close">✕</button>
      </div>
      <div class="admin-modal-body admin-modal-scroll">
        <label class="admin-flabel" for="admin-quest-title">Title <span class="admin-faint">(shown big on the board)</span></label>
        <input id="admin-quest-title" class="admin-input" type="text" value="${esc(f.title)}" placeholder="School Event Squad" />

        <label class="admin-flabel">Type <span class="admin-faint">(fallback icon, used when this quest has none of its own)</span></label>
        <div class="admin-seg admin-theme-seg">${typeOpts}</div>

        <div class="admin-two">
          <div>
            <label class="admin-flabel" for="admin-quest-icon">Icon <span class="admin-faint">(optional)</span></label>
            <input id="admin-quest-icon" class="admin-input" type="text" value="${esc(f.icon)}" placeholder="🧹" maxlength="8" style="max-width:110px;text-align:center;font-size:1.3rem" />
            <div class="admin-step-hint">Leave blank to just use the Type icon above. Open your emoji picker with <b>Ctrl+Cmd+Space</b> (Mac) or <b>Win+.</b> (Windows), then paste it in.</div>
          </div>
          <div>
            <label class="admin-flabel">Shows on the board as</label>
            <div class="admin-preview" style="margin:0">
              <span class="admin-preview-label" id="admin-quest-icon-preview" style="font-size:1.8rem">${esc(store.questIcon(f))}</span>
            </div>
          </div>
        </div>

        <label class="admin-flabel" for="admin-quest-desc">What the house must actually do</label>
        <textarea id="admin-quest-desc" class="admin-input admin-textarea" rows="3"
          placeholder="Attend a school event together. Proof: photos showing at least half the class there.">${esc(f.desc)}</textarea>
        <div class="admin-step-hint">Write it so the class knows exactly when it counts as done — including what proof you want.</div>

        <label class="admin-flabel" for="admin-quest-points">Reward <span class="admin-faint">(points awarded on completion)</span></label>
        <input id="admin-quest-points" class="admin-input" type="number" min="1" max="9999" value="${esc(f.points)}" style="max-width:160px" />
        <div class="admin-step-hint">Most quests are worth 10–50 points. Bigger effort, bigger reward.</div>

        <label class="admin-flabel">Can other houses earn this too?</label>
        <div class="admin-eff-group">${opts}</div>

        <label class="admin-flabel" for="admin-quest-penalty">Give-up penalty <span class="admin-faint">(points lost if the house quits)</span></label>
        <input id="admin-quest-penalty" class="admin-input" type="number" min="0" max="9999" value="${esc(f.penalty)}" style="max-width:160px" />
        <div class="admin-step-hint">Default is half the reward (${half} for a ${Number(f.points) || 0}-point quest). Set 0 for no penalty at all.
          Failing should sting a little without erasing a week of work.</div>

        <div class="admin-preview admin-shop-preview">
          <span class="admin-preview-eyebrow">In plain English</span>
          <span class="admin-shop-preview-text" id="admin-quest-preview">${esc(questSentence(f))}</span>
        </div>
        ${saveErr}
      </div>
      <div class="admin-modal-foot">
        <button class="admin-btn admin-btn-lg" data-action="quest-close">Cancel</button>
        <button class="admin-btn admin-btn-primary admin-btn-lg" data-action="quest-save">Save quest</button>
      </div>
    </div>`;
  const t = el('admin-quest-title'); if (t && f.isNew) t.focus();
}

function syncQuestFromDom() {
  if (!questForm) return;
  const g = (id) => (el(id) ? el(id).value : '');
  questForm.title = g('admin-quest-title');
  questForm.desc = g('admin-quest-desc');
  questForm.points = g('admin-quest-points');
  questForm.penalty = g('admin-quest-penalty');
  // Raw value only — trimming/length-clamping happens in store.saveQuest().
  questForm.icon = el('admin-quest-icon') ? el('admin-quest-icon').value : questForm.icon;
  const checked = rootEl.querySelector('input[name="admin-quest-repeat"]:checked');
  if (checked) questForm.repeatable = checked.value === '1';
  questForm.saveError = null;
}

// Live preview as the teacher types, without re-rendering (which would steal
// focus). Also keeps the penalty pinned to half the reward until it's edited.
function updateQuestPreview({ pointsChanged = false } = {}) {
  if (!questForm || !el('admin-quest-preview')) return;
  const points = el('admin-quest-points') ? el('admin-quest-points').value : questForm.points;
  if (pointsChanged && !questForm.penaltyTouched && el('admin-quest-penalty')) {
    el('admin-quest-penalty').value = Math.round((Number(points) || 0) / 2);
  }
  el('admin-quest-preview').textContent = questSentence({
    points,
    penalty: el('admin-quest-penalty') ? el('admin-quest-penalty').value : questForm.penalty,
    repeatable: questForm.repeatable,
  });
}

// Live preview of what store.questIcon() will actually show on the card —
// the typed icon, or the Type icon when the box is empty. Recomputed on every
// keystroke and whenever the Type picker changes, since both feed the fallback.
function updateQuestIconPreview() {
  if (!questForm || !el('admin-quest-icon-preview')) return;
  const icon = el('admin-quest-icon') ? el('admin-quest-icon').value : questForm.icon;
  el('admin-quest-icon-preview').textContent = ctxRef.store.questIcon({ type: questForm.type, icon });
}

function saveQuestFromForm() {
  syncQuestFromDom();
  const f = questForm;
  const store = ctxRef.store;
  const title = String(f.title || '').trim();
  const points = Number(f.points);
  if (!title) { f.saveError = 'This quest needs a title.'; renderQuestModal(); return; }
  if (!(points >= 1)) { f.saveError = 'Give this quest a reward of at least 1 point.'; renderQuestModal(); return; }

  const saved = store.saveQuest({
    id: f.id,
    title,
    desc: String(f.desc || '').trim(),
    points,
    type: f.type,
    icon: f.icon,
    repeatable: f.repeatable,
    penalty: Number(f.penalty),
  });
  if (!saved) { f.saveError = "Something in this quest wasn't accepted. Check the title and reward."; renderQuestModal(); return; }
  const wasNew = f.isNew;
  questForm = null;
  closeModal();
  renderBody({ force: true });
  toast(wasNew ? 'Quest added.' : 'Quest updated.');
}

// ---- confirming a result ---------------------------------------------------
function openQuestCompleteModal(core) {
  const store = ctxRef.store;
  const q = store.getActiveQuest(core);
  if (!q) { toast('No active quest for that core.'); return; }
  const house = store.HOUSES[core];
  const m = el('admin-modal-root');
  m.innerHTML = `
    <div class="admin-modal-bg" data-action="modal-close"></div>
    <div class="admin-modal">
      <div class="admin-modal-head">
        <div class="admin-modal-title">✅ Confirm Completion</div>
        <button class="admin-btn admin-btn-icon" data-action="modal-close" aria-label="Close">✕</button>
      </div>
      <div class="admin-modal-body">
        <p class="admin-modal-lead">Mark <b>${esc(q.title)}</b> complete for <b class="admin-house-name-accent" style="color:${house.accent}">${esc(house.name)}</b> and award <b>+${q.points} points</b>?</p>
        <div class="admin-mini">${q.repeatable
          ? 'This quest is <b>repeatable</b> — it goes back on the board so another house can earn it too.'
          : 'This quest is <b>one time only</b> — it leaves the board for good.'}</div>
      </div>
      <div class="admin-modal-foot">
        <button class="admin-btn admin-btn-lg" data-action="modal-close">Cancel</button>
        <button class="admin-btn admin-btn-primary admin-btn-lg" data-action="quest-complete-confirm" data-core="${core}">Confirm &amp; award +${q.points}</button>
      </div>
    </div>`;
}

function confirmQuestComplete(core) {
  const store = ctxRef.store;
  const house = store.HOUSES[core];
  const quest = store.completeQuest(core);
  closeModal();
  renderBody();
  if (quest && !quest.paid) {
    // Archived as complete, but nothing was paid — a frozen house cannot earn.
    toast(quest.unpaidReason || `“${quest.title}” is complete, but no points could be added.`);
  } else if (quest) {
    toast(`🎉 +${quest.paidPoints} to ${house.name} — “${quest.title}” complete!`);
    ctxRef.audio?.sfx?.('fanfare');
  }
}

function openQuestFailModal(core) {
  const store = ctxRef.store;
  const q = store.getActiveQuest(core);
  if (!q) { toast('No active quest for that core.'); return; }
  const house = store.HOUSES[core];
  const penalty = questPenalty(q);
  const m = el('admin-modal-root');
  m.innerHTML = `
    <div class="admin-modal-bg" data-action="modal-close"></div>
    <div class="admin-modal admin-modal-danger">
      <div class="admin-modal-head">
        <div class="admin-modal-title">✖ Mark Given Up</div>
        <button class="admin-btn admin-btn-icon" data-action="modal-close" aria-label="Close">✕</button>
      </div>
      <div class="admin-modal-body">
        <p class="admin-modal-lead"><b class="admin-house-name-accent" style="color:${house.accent}">${esc(house.name)}</b> is giving up on <b>${esc(q.title)}</b>.</p>
        <div class="admin-warn-line">⚠️ ${esc(house.name)} loses <b>${penalty} point${penalty === 1 ? '' : 's'}</b>${penalty === 0 ? ' (no penalty set for this quest)' : ''}, and the quest goes back on the board for another house to steal.</div>
        <div class="admin-mini" style="margin-top:10px">Accepted by mistake instead? Close this and use <b>“Clear without penalty”</b>.</div>
      </div>
      <div class="admin-modal-foot">
        <button class="admin-btn admin-btn-lg" data-action="modal-close">Cancel</button>
        <button class="admin-btn admin-btn-nuke admin-btn-lg" data-action="quest-fail-confirm" data-core="${core}">${penalty > 0 ? `Give up &amp; deduct ${penalty}` : 'Give up'}</button>
      </div>
    </div>`;
}

function confirmQuestFail(core) {
  const store = ctxRef.store;
  const house = store.HOUSES[core];
  const res = store.failQuest(core);
  closeModal();
  renderBody();
  if (res) {
    toast(res.penalty > 0
      ? `−${res.penalty} from ${house.name} — “${res.quest.title}” is back on the board.`
      : `“${res.quest.title}” is back on the board.`);
    ctxRef.audio?.sfx?.('thud');
  }
}

// ===========================================================================
// TAB — SHOP (Magic Shop item manager)
// ===========================================================================
// Everything the editor needs to TEACH each kind, not just collect a number.
// `sentence(n)` is the single plain-English phrasing reused by the catalog list
// and the live preview, so the teacher reads the same words in both places.
const EFFECTS = {
  attack: {
    label: '⚔️ Attack', group: 'Offensive', amountLabel: 'HP removed by a strike on Battle Day',
    explain: 'Buys a weapon. It does nothing right away — it goes into the buying house\'s armoury and waits for Battle Day.',
    does: 'The cost buys the item and stores it in the buying house\'s armoury. No target is picked at purchase, and no house loses anything yet. On Battle Day, the house can spend it as a strike against whichever house it is fighting, and the strike removes hit points (HP) — never points — from that house.',
    defense: 'On Battle Day, a Shield on the house being struck blocks the strike completely, so no HP is lost. A half-damage relic cuts the HP lost in half instead.',
    example: 'Greek Fire: 45 pts to buy the weapon and bank it in the armoury. On Battle Day, a strike with it takes 25 HP off whichever house it fights — unless a Shield Wall stops it cold.',
    range: 'Most attack weapons take 10 to 40 HP off the house they strike.',
    sentence: (n) => `Stores this weapon in the buying house's armoury until Battle Day — no target is picked and no house loses anything at purchase. On Battle Day, the house can spend it as a strike that removes ${n} HP (never points) from whichever house it is fighting. A Shield on that house blocks the strike completely. A half-damage relic cuts the HP lost in half instead.`,
  },
  steal: {
    label: '🐴 Steal', group: 'Offensive', amountLabel: 'HP removed by a strike, looted as points on Battle Day',
    explain: 'Buys a weapon, just like an Attack. Its Battle Day strike also loots points for the attacking house.',
    does: 'The cost buys the item and stores it in the buying house\'s armoury, same as an Attack — nothing happens at purchase. On Battle Day, when the house spends it as a strike, it removes hit points (HP) from the house it fights AND credits the attacking house points equal to whatever HP damage actually got through: the full amount if undefended, half if a relic reduced it, none if a Shield blocked it.',
    defense: 'Still a strike — a Shield on the house being struck blocks it completely and the attacker loots nothing; a half-damage relic halves both the HP lost and the points looted.',
    example: 'Trojan Horse: 50 pts to buy the weapon and bank it in the armoury. On Battle Day, a strike with it takes 25 HP off whichever house it fights and hands the attacking house 25 points of loot — less if a relic softened the blow, none if a Shield stopped it.',
    range: 'Most steal weapons take 10 to 30 HP off the house they strike.',
    sentence: (n) => `Stores this weapon in the buying house's armoury until Battle Day — no target is picked and no house loses anything at purchase. On Battle Day, a strike with it removes ${n} HP from whichever house it is fighting, and the attacking house gains points equal to the HP actually dealt (0 if blocked, half if a relic reduced it). A Shield on the defending house blocks the strike (and the loot) completely. A half-damage relic halves both.`,
  },
  pierce: {
    label: '🫥 Pierce', group: 'Offensive', amountLabel: 'HP removed by a strike (unblockable)',
    explain: 'Buys a weapon, just like an Attack, but its Battle Day strike ignores shields AND damage reduction.',
    does: 'Same as an Attack — the cost buys the item and stores it in the armoury, and nothing happens at purchase. On Battle Day, a strike with it removes hit points (HP) from the house it fights, and it always lands in full: no defense can stop or soften it.',
    defense: 'Ignores BOTH shields and half-damage relics — on Battle Day the strike always removes the full HP amount no matter what the house it fights has equipped.',
    example: 'Invisibility Cloak: 60 pts to buy the weapon. On Battle Day, a strike with it takes 20 HP off whichever house it fights — it gets through even a Great Wall shield.',
    range: 'Price these higher than a plain attack weapon, since nothing can stop the strike.',
    sentence: (n) => `Stores this weapon in the buying house's armoury until Battle Day — no target is picked and no house loses anything at purchase. On Battle Day, a strike with it removes ${n} HP (never points) from whichever house it is fighting, and always lands in full. Cannot be blocked by a Shield or softened by a half-damage relic.`,
  },
  shield: {
    label: '🛡️ Defend', group: 'Defensive', amountLabel: 'Protection duration (hours)',
    explain: 'Blocks ALL incoming attacks for a while.',
    does: 'For a set number of hours, attacks against the buyer do nothing at all.',
    defense: 'Stops attacks and steals outright — but a Pierce item goes straight through.',
    example: 'Aegis Shield: 30 pts to block every attack for 24 hours.',
    range: 'Typical protection runs 12 to 48 hours.',
    sentence: (n) => `Blocks all incoming attacks on the buyer for ${n} hours. A Pierce item still gets through.`,
  },
  reduce: {
    label: '🕵️ Halve damage', group: 'Defensive', amountLabel: 'Duration (hours)',
    explain: 'Incoming damage is cut in half for a while. Usually a Mythic reward.',
    does: 'For a set number of hours, every attack against the buyer lands at half strength.',
    defense: 'Softens attacks and steals; a Pierce item ignores it entirely.',
    example: 'Spy Network: earned with a natural 20 — halves incoming damage for 48 hours.',
    range: 'Mythic relics usually run 48 to 72 hours.',
    sentence: (n) => `Cuts incoming damage to the buyer in half for ${n} hours. A Pierce item still lands in full.`,
  },
  wild: {
    label: '🎲 Wildcard', group: 'Wildcard', amountLabel: 'Maximum swing (either direction)',
    explain: 'Random swing, for or against the buyer.',
    does: 'A gamble — the buyer might gain points or lose them, up to the amount you set.',
    defense: 'Not an attack, so shields and relics do not apply.',
    example: "Pandora's Box: 40 pts for a coin-flip swing of up to 30 points, either way.",
    range: 'Keep the swing between 10 and 30 so a bad roll is not devastating.',
    sentence: (n) => `Random swing of up to ${n} points, which may help OR hurt the buyer.`,
  },
};
const EFFECT_ORDER = ['attack', 'steal', 'pierce', 'shield', 'reduce', 'wild'];

// ---------------------------------------------------------------------------
// Duel-mode item kinds (Mr. D's own rules — see store.DUEL_KINDS). Shaped very
// differently from the hit-points kinds above: damage is rolled on real dice
// instead of a flat amount, attack items name the defenses that cancel them
// and vice versa, and items belong to a slot (attack / defense / utility)
// rather than a group. Kept as an entirely separate table rather than
// shoehorned into EFFECTS above, because almost nothing else is shared.
// ---------------------------------------------------------------------------
const DUEL_EFFECT_ORDER = ['damage', 'steal', 'freeze', 'block', 'reveal', 'hide', 'timeturn', 'extraslot'];
// Which slot a kind belongs to. Mr. D's rules never mix these — every damage,
// steal or freeze item is something you attack WITH; every block item is
// something you defend WITH — so the slot is derived from the kind rather
// than asked as a separate question the teacher could get out of sync.
const DUEL_SLOT_OF_KIND = {
  damage: 'attack', steal: 'attack', freeze: 'attack',
  block: 'defense',
  reveal: 'utility', hide: 'utility', timeturn: 'utility', extraslot: 'utility',
};
const DUEL_EFFECTS = {
  damage: {
    label: '🗡️ Damage attack',
    explain: 'A weapon. Chosen in secret for the week, then revealed and resolved together with every House’s defense on Battle Day.',
    does: 'Rolled on real dice, live on the board. The roll × the multiplier below comes straight off the target House’s points.',
    defense: 'Cancelled completely if the target is holding one of the defenses you pick below — the attack does nothing at all, though both items are still spent for the week.',
    example: 'The Sword of Destiny: 450 pts to buy, strikes for 2d6 × 100 points. The Shield of Protection cancels it outright.',
    range: 'Most damage weapons roll 2d6 or 3d6, worth 100 points a pip.',
  },
  steal: {
    label: '\u{1F578}️ Steal attack',
    explain: 'Like a damage attack, but the points move to the attacker instead of vanishing.',
    does: 'Rolled on real dice, live on the board. The roll × the multiplier comes off the target and is added to the attacker’s own total.',
    defense: 'Cancelled completely if the target is holding one of the defenses you pick below — nothing is taken and nothing is gained.',
    example: 'Net of Entrapment: 600 pts to buy, steals 2d6 × 100 points. The Gauntlet of Defense cancels it.',
    range: 'Usually priced a little above an equivalent damage weapon, since it pays for itself.',
  },
  freeze: {
    label: '🪓 Freeze attack',
    explain: 'Stops the target earning points for a few days, instead of taking any.',
    does: 'Rolled on dice for how many days the target is frozen. A frozen House cannot be awarded points until the freeze ends.',
    defense: 'Cancelled completely if the target is holding one of the defenses you pick below.',
    example: 'The Legendary Ice Axe: 500 pts to buy, freezes for 1d6 days. The Shield of Protection cancels it.',
    range: 'Usually 1d6 days.',
  },
  block: {
    label: '🛡️ Defense',
    explain: 'Held in secret for the week as this House’s defense, and revealed only if it is attacked.',
    does: 'If the House holding it is struck by one of the attacks you pick below, that attack does nothing at all — no points move, nobody is frozen. Both items are still spent for the week either way.',
    defense: 'This item IS the defense — nothing else in Mr. D’s rules stops an attack.',
    example: 'The Shield of Protection stops the Sword of Destiny or the Legendary Ice Axe outright.',
    range: 'Price a general-purpose defense close to what the attacks it stops cost.',
  },
  reveal: {
    label: '🔮 Reveal (utility)',
    explain: 'Shows you what another House has chosen to hold this week.',
    does: 'Used any time. Reveals another House’s hidden attack or defense choice before anything is resolved.',
    defense: 'Not an attack — nothing stops it.',
    example: 'The Stone of Seeing: 1000 pts.',
    range: 'Priced high — knowing the board ahead of time is powerful.',
  },
  hide: {
    label: '🌫️ Hide (utility)',
    explain: 'Keeps this House’s own choices secret from everyone else for a week.',
    does: 'Stops other Houses’ Reveal items from working against this House for a week.',
    defense: 'Not an attack — nothing stops it.',
    example: 'The Shroud of Secrecy: 500 pts.',
    range: 'Usually priced under Reveal, since it only protects — it doesn’t inform.',
  },
  timeturn: {
    label: '⏳ Time Turner (utility)',
    explain: 'Lets a House change its choices again after already being attacked that week.',
    does: 'A one-time do-over: swap items after an attack has already landed.',
    defense: 'Not an attack — nothing stops it.',
    example: 'The Time Turner: 1000 pts.',
    range: 'Priced high — it can undo an entire bad week.',
  },
  extraslot: {
    label: '🎒 Extra Slot (utility)',
    explain: 'Raises how much this House can hold at once.',
    does: 'Normally a House may hold one attack item and one defense item at a time. This raises that to two of each.',
    defense: 'Not an attack — nothing stops it.',
    example: 'The Bag of Holding: 500 pts.',
    range: 'One per House is usually plenty.',
  },
};

// The single plain-English sentence for a duel item, built from whatever is
// currently in the form (or already saved) — shared by the catalog row and
// the live preview, exactly like effectSentence() above does for hit points.
// `catalog` is used to turn counter ids into the item's actual NAME — a
// teacher should never have to read a raw id like "shield".
function duelEffectSentence(item, catalog) {
  const kind = item?.effect?.kind;
  if (!DUEL_EFFECTS[kind]) return '';
  const dice = item.effect.dice || '?';
  const mult = Number(item.effect.mult) || 1;
  const targets = Number(item.effect.targets) || 1;
  const anon = !!item.effect.anonymous;
  const price = `Costs ${Number(item.cost) || 0} points.`;
  const nameOf = (id) => ((catalog || []).find((x) => x.id === id) || {}).name || id;
  const stopSentence = (ids) => (ids && ids.length
    ? ` ${ids.map(nameOf).join(' or ')} cancels it completely.`
    : ' Nothing defends against it.');

  switch (kind) {
    case 'damage': {
      const who = targets > 1 ? `${targets} Houses at once` : 'a House';
      return `${price} An attack item, held in secret until Battle Day. Strikes ${who} for ${dice} × ${mult} points, taken straight off their total.${stopSentence(item.counteredBy)}`;
    }
    case 'steal': {
      const secret = anon ? ' Nobody is told who did it.' : '';
      return `${price} An attack item, held in secret until Battle Day. Steals ${dice} × ${mult} points and adds them to the attacker's own total.${secret}${stopSentence(item.counteredBy)}`;
    }
    case 'freeze':
      return `${price} An attack item, held in secret until Battle Day. Freezes a House so it cannot earn points for ${dice} days.${stopSentence(item.counteredBy)}`;
    case 'block': {
      const stops = (item.blocks || []).map(nameOf);
      const list = stops.length ? stops.join(', ') : 'nothing yet — pick at least one attack below';
      return `${price} A defense item, held in secret for the week. If the House holding it is struck by ${list}, that attack does nothing at all.`;
    }
    case 'reveal': return `${price} A utility item. Reveals what another House has chosen to hold this week.`;
    case 'hide': return `${price} A utility item. Hides your choices from every other House for one week.`;
    case 'timeturn': return `${price} A utility item. Lets you change your items again after already being attacked.`;
    case 'extraslot': return `${price} A utility item. Raises the weekly limit so this House can hold two attack or two defense items at once.`;
    default: return price;
  }
}

// One-line label+amount for compact spots (kept short for the row header).
function effectSummary(effect) {
  const e = EFFECTS[effect?.kind];
  if (!e) return '';
  const n = effect.amount;
  switch (effect.kind) {
    case 'shield': return `${e.label} · blocks all attacks for ${n}h`;
    case 'reduce': return `${e.label} · incoming damage halved for ${n}h`;
    case 'steal':  return `${e.label} · ${n} HP strike on Battle Day, plus loot`;
    case 'pierce': return `${e.label} · ${n} HP strike, ignores shields & reduction`;
    case 'wild':   return `${e.label} · random ±${n}`;
    default:       return `${e.label} · ${n} HP strike on Battle Day`;
  }
}

// The full plain-English sentence, shared by the catalog list and live preview.
function effectSentence(item) {
  const e = EFFECTS[item?.effect?.kind];
  if (!e) return '';
  const price = item.mythicOnly
    ? 'Cannot be bought. Granted when a house rolls a natural 20.'
    : `Costs ${Number(item.cost) || 0} points.`;
  return `${price} ${e.sentence(Number(item.effect.amount) || 0)}`;
}

function shopThumbHTML(item) {
  if (item.image && item.image.startsWith('media:')) {
    const key = item.image.slice('media:'.length);
    return `<span class="admin-shop-thumb" data-imgkey="${esc(key)}"><span class="admin-shop-emoji">${esc(item.emoji || '✨')}</span></span>`;
  }
  return `<span class="admin-shop-thumb"><span class="admin-shop-emoji">${esc(item.emoji || '✨')}</span></span>`;
}

function shopRowHTML(it) {
  return `
    <div class="admin-shop-row${it.mythicOnly ? ' mythic' : ''}">
      ${shopThumbHTML(it)}
      <div class="admin-q-main">
        <div class="admin-q-title">${esc(it.name)} ${it.mythicOnly ? '<span class="admin-mythic-badge">🏆 MYTHIC</span>' : ''}</div>
        <div class="admin-q-desc">${esc(it.desc || '')}</div>
        <div class="admin-shop-effect">${esc(effectSummary(it.effect))}</div>
        <div class="admin-shop-plain">${esc(effectSentence(it))}</div>
      </div>
      <div class="admin-shop-cost">${it.mythicOnly ? '<span class="admin-shop-free">—</span><small>reward</small>' : `${it.cost}<small>pts</small>`}</div>
      <div class="admin-q-row-actions">
        <button class="admin-btn admin-btn-icon" data-action="shop-edit" data-id="${esc(it.id)}" aria-label="Edit">✏️</button>
        <button class="admin-btn admin-btn-icon admin-btn-danger" data-action="shop-del" data-id="${esc(it.id)}" aria-label="Delete">🗑️</button>
      </div>
    </div>`;
}

// The Magic Shop's editor is entirely different shape depending on which
// Battle Day rule set is active (see store.getCombatMode()) — hit-points items
// use effect.amount, Mr. D's duel items use dice + counters. Dispatch here
// once, rather than sprinkling mode checks through every shop function below.
function renderShop() {
  return ctxRef.store.getCombatMode() === 'duel' ? renderDuelShop() : renderHpShop();
}

// 17+ items — grouped so the teacher can still scan it.
function renderHpShop() {
  const store = ctxRef.store;
  const items = store.getShopItems();
  const groups = [
    { key: 'Offensive', title: '⚔️ Offensive', note: 'Spend points to take points.' },
    { key: 'Defensive', title: '🛡️ Defensive', note: 'Protect the buyer for a stretch of time.' },
    { key: 'Wildcard',  title: '🎲 Wildcard',  note: 'Risky — can help or hurt the buyer.' },
    { key: 'Mythic',    title: '🏆 Mythic rewards', note: "Not purchasable — granted by a natural 20." },
  ];
  const bucket = (it) => (it.mythicOnly ? 'Mythic' : (EFFECTS[it.effect?.kind]?.group || 'Wildcard'));
  const sections = groups.map((g) => {
    const list = items
      .filter((it) => bucket(it) === g.key)
      .sort((a, b) => (a.cost - b.cost) || a.name.localeCompare(b.name));
    if (!list.length) return '';
    return `
      <div class="admin-shop-group">
        <div class="admin-shop-group-head">
          <span class="admin-shop-group-title">${g.title} <span class="admin-faint">(${list.length})</span></span>
          <span class="admin-faint">${esc(g.note)}</span>
        </div>
        <div class="admin-q-list">${list.map(shopRowHTML).join('')}</div>
      </div>`;
  }).join('');

  return `
    <div class="admin-quests">
      ${shopGuideHTML()}
      <div class="admin-card">
        <div class="admin-rows-head">
          <span class="admin-card-title" style="margin:0">Magic Shop <span class="admin-faint">(${items.length} items)</span></span>
          <button class="admin-btn admin-btn-primary" data-action="shop-new">+ New Item</button>
        </div>
        <div class="admin-mini">Items students buy with house points. The effect decides what happens when an item is used.</div>
        ${sections || '<div class="admin-empty admin-empty-sm">No items yet. Add one to stock the shop.</div>'}
      </div>
    </div>`;
}

function duelShopRowHTML(it, catalog) {
  const eff = DUEL_EFFECTS[it.effect?.kind] || {};
  return `
    <div class="admin-shop-row">
      ${shopThumbHTML(it)}
      <div class="admin-q-main">
        <div class="admin-q-title">${esc(it.name)} <span class="admin-faint">${esc(eff.label || '')}</span></div>
        <div class="admin-q-desc">${esc(it.desc || '')}</div>
        <div class="admin-shop-plain">${esc(duelEffectSentence(it, catalog))}</div>
      </div>
      <div class="admin-shop-cost">${it.cost}<small>pts</small></div>
      <div class="admin-q-row-actions">
        <button class="admin-btn admin-btn-icon" data-action="shop-edit" data-id="${esc(it.id)}" aria-label="Edit">✏️</button>
        <button class="admin-btn admin-btn-icon admin-btn-danger" data-action="shop-del" data-id="${esc(it.id)}" aria-label="Delete">🗑️</button>
      </div>
    </div>`;
}

// Grouped by SLOT rather than by kind-group — attack / defense / utility is
// how Mr. D actually thinks about his own game (one of each held per week),
// where the hit-points shop groups by offensive/defensive/wildcard instead.
function renderDuelShop() {
  const store = ctxRef.store;
  const items = store.getShopItems();
  const groups = [
    { key: 'attack',  title: '⚔️ Attacks',  note: 'One held per House per week — hidden until Battle Day.' },
    { key: 'defense', title: '🛡️ Defenses', note: 'One held per House per week — hidden until attacked.' },
    { key: 'utility', title: '🔮 Utility',   note: 'No weekly limit — each does its own thing.' },
  ];
  const sections = groups.map((g) => {
    const list = items
      .filter((it) => (it.slot || 'utility') === g.key)
      .sort((a, b) => (a.cost - b.cost) || a.name.localeCompare(b.name));
    if (!list.length) return '';
    return `
      <div class="admin-shop-group">
        <div class="admin-shop-group-head">
          <span class="admin-shop-group-title">${g.title} <span class="admin-faint">(${list.length})</span></span>
          <span class="admin-faint">${esc(g.note)}</span>
        </div>
        <div class="admin-q-list">${list.map((it) => duelShopRowHTML(it, items)).join('')}</div>
      </div>`;
  }).join('');

  return `
    <div class="admin-quests">
      ${duelShopGuideHTML()}
      <div class="admin-card">
        <div class="admin-rows-head">
          <span class="admin-card-title" style="margin:0">Magic Shop <span class="admin-faint">(${items.length} items · Mr. D's rules)</span></span>
          <button class="admin-btn admin-btn-primary" data-action="shop-new">+ New Item</button>
        </div>
        <div class="admin-mini">Battle Day is currently running <b>Mr. D's rules</b>, so this is what's on offer. One attack and one defense item held per House per week — the counters below decide which defense cancels which attack.</div>
        ${sections || '<div class="admin-empty admin-empty-sm">No items yet. Add one to stock the shop.</div>'}
      </div>
    </div>`;
}

// Plain-language primer for Mr. D's duel rules — the counter system explained
// once, in full, rather than scattered across every item's editor.
function duelShopGuideHTML() {
  return `
    <div class="admin-card">
      <details class="admin-details admin-guide" ${shopGuideOpen ? 'open' : ''}>
        <summary data-action="shop-guide-toggle">📖 How Mr. D's rules work</summary>
        <div class="admin-guide-body">
          <p class="admin-guide-p"><b>Each House picks one attack and one defense a week, in secret.</b> Nobody — not even the other Houses — sees what a House is holding until it is actually attacked.</p>
          <p class="admin-guide-p"><b>Buying an item does nothing right away.</b> It sits held by the House, ready to be used (or revealed) on Battle Day.</p>
          <p class="admin-guide-p"><b>Every attack has a counter.</b> If the House being attacked is holding the exact defense that cancels it, the attack does nothing at all — no points move, nobody is frozen. This is the whole game: guessing right, and guessing what the other House guessed.</p>
          <p class="admin-guide-p"><b>Damage and Steal are rolled on real dice</b>, live on the board — "2d6 × 100" means roll two six-sided dice, add them, then multiply by 100 points.</p>
          <p class="admin-guide-p"><b>Freeze stops a House earning points</b> for a number of days instead of taking any.</p>
          <p class="admin-guide-p"><b>Utility items don't attack or defend.</b> They reveal information, hide it, undo a bad week, or raise how much a House can hold at once.</p>
          <div class="admin-guide-callout">
            ⚠️ When you tick which defense stops which attack, the app updates BOTH items to match — editing the Sword's counters also updates the Shield's "stops" list, even though you never opened the Shield's own editor.
          </div>
        </div>
      </details>
      <div class="admin-help-row">${helpLink(HELP_TOPICS.shop, 'More about the Magic Shop in the handbook')}</div>
    </div>`;
}

// Plain-language primer so Mr. D can invent balanced items of his own.
function shopGuideHTML() {
  return `
    <div class="admin-card">
      <details class="admin-details admin-guide" ${shopGuideOpen ? 'open' : ''}>
        <summary data-action="shop-guide-toggle">📖 How magic items work</summary>

        <div class="admin-guide-body">
          <p class="admin-guide-p"><b>Attacks, Steals and Pierce items are weapons, not instant hits.</b> Buying one costs points right away, but nothing happens to any house yet — the item goes into the buying house's armoury and just sits there, kept in reserve until Battle Day.</p>
          <p class="admin-guide-p"><b>On Battle Day, a house spends a weapon from its armoury as a strike</b> against whichever house it is fighting in that match. A strike removes HIT POINTS (HP), never points. Every house has its own HP total (a base amount plus a bonus for term points earned so far), and HP refills to full at the start of each Battle Day.</p>
          <p class="admin-guide-p"><b>Shields stop a strike completely.</b> While a house has a Shield, a strike against it removes no HP at all.</p>
          <p class="admin-guide-p"><b>Half-damage relics cut a strike in half.</b> A strike worth 20 HP becomes 10.</p>
          <p class="admin-guide-p"><b>Pierce items go through BOTH.</b> Nothing stops a Pierce strike — that's why they cost more.</p>
          <p class="admin-guide-p"><b>A Steal is an Attack that also loots.</b> Whatever HP a Steal strike actually gets through with — the full amount if undefended, half if reduced, none if blocked — is credited to the attacking house as points. The house being struck never loses points from this, only HP.</p>
          <p class="admin-guide-p"><b>When a house's HP hits zero, the battle is over.</b> The winning house takes a prize in points; the losing house does not lose any points at all. The size of that prize is set below, under "⚔️ Battle rules".</p>
          <p class="admin-guide-p"><b>Wildcards can help or hurt</b> the house that buys them. It's a gamble, and defenses don't apply.</p>
          <p class="admin-guide-p"><b>Mythic relics can't be bought.</b> The only way to earn one is a natural 20 on the Die of Destiny.</p>

          <div class="admin-guide-callout">
            ⚠️ <b>Shields and half-damage relics only apply to Battle Day strikes.</b> Points you give or take yourself, from the Records screen or the ± button, are <b>never</b> blocked or halved — and neither are Wildcard swings.
          </div>

          <div class="admin-guide-tablewrap">
            <div class="admin-guide-tabletitle">What a Battle Day strike actually lands (in HP, not points)</div>
            <p class="admin-guide-p" style="margin-top:0">This shows what happens when a house spends a stockpiled weapon as a strike on Battle Day — not what happens when the weapon is bought. Buying it only banks it in the armoury.</p>
            <table class="admin-matchup">
              <thead>
                <tr><th>Incoming strike</th><th>No defense</th><th>Shield</th><th>Half-damage</th></tr>
              </thead>
              <tbody>
                <tr>
                  <td class="admin-mu-row">Plain attack strike of 20 HP</td>
                  <td><b>−20 HP</b></td><td class="admin-mu-block">blocked</td><td><b>−10 HP</b></td>
                </tr>
                <tr>
                  <td class="admin-mu-row">Pierce strike of 20 HP</td>
                  <td><b>−20 HP</b></td><td><b>−20 HP</b></td><td><b>−20 HP</b></td>
                </tr>
              </tbody>
            </table>
          </div>
        </div>
      </details>
      <div class="admin-help-row">${helpLink(HELP_TOPICS.shop, 'More about the Magic Shop in the handbook')}</div>
    </div>`;
}

function openShopForm(id) {
  if (ctxRef.store.getCombatMode() === 'duel') openDuelShopForm(id);
  else openHpShopForm(id);
}

function openHpShopForm(id) {
  const store = ctxRef.store;
  const it = id ? store.getShopItems().find((x) => x.id === id) : null;
  const hasImg = !!(it && it.image && it.image.startsWith('media:'));
  shopForm = {
    mode: 'hp',
    id: it ? it.id : `si-${Date.now()}`,
    isNew: !it,
    name: it?.name || '',
    desc: it?.desc || '',
    emoji: it?.emoji || '✨',
    cost: it?.cost ?? 25,
    mythicOnly: !!it?.mythicOnly,
    effectKind: it?.effect?.kind || 'attack',
    effectAmount: it?.effect?.amount ?? 20,
    imageFile: null,      // staged new File
    imageStored: hasImg,  // an existing stored image is present
    imageUrl: '',         // preview object URL
  };
  renderShopModal();
  if (hasImg) hydrateShopImage(shopForm.id);
}

// Mr. D's duel items: an id, a slot derived from the kind, dice/mult/targets
// for anything rolled, and the counter lists (counteredBy on attacks, blocks
// on defenses) — kept as plain arrays of OTHER items' ids, resolved to names
// only at render time.
function openDuelShopForm(id) {
  const store = ctxRef.store;
  const it = id ? store.getShopItems().find((x) => x.id === id) : null;
  const hasImg = !!(it && it.image && it.image.startsWith('media:'));
  const kind = it?.effect?.kind || 'damage';
  shopForm = {
    mode: 'duel',
    id: it ? it.id : `si-${Date.now()}`,
    isNew: !it,
    name: it?.name || '',
    desc: it?.desc || '',
    emoji: it?.emoji || '✨',
    cost: it?.cost ?? 500,
    effectKind: kind,
    dice: it?.effect?.dice || (kind === 'freeze' ? '1d6' : '2d6'),
    mult: it?.effect?.mult ?? 100,
    targets: it?.effect?.targets ?? 1,
    anonymous: !!it?.effect?.anonymous,
    counteredBy: Array.isArray(it?.counteredBy) ? it.counteredBy.slice() : [],
    blocks: Array.isArray(it?.blocks) ? it.blocks.slice() : [],
    imageFile: null,
    imageStored: hasImg,
    imageUrl: '',
  };
  renderShopModal();
  if (hasImg) hydrateShopImage(shopForm.id);
}

async function hydrateShopImage(id) {
  const u = await media.url(`shop:${id}:image`);
  if (u && shopForm && shopForm.id === id) { shopForm.imageUrl = u; renderShopModal(); }
}

function renderShopModal() {
  if (shopForm && shopForm.mode === 'duel') { renderDuelShopModal(); return; }
  renderHpShopModal();
}

function renderHpShopModal() {
  const f = shopForm;
  const m = el('admin-modal-root');
  const effChips = EFFECT_ORDER.map((k) => {
    const e = EFFECTS[k];
    const on = f.effectKind === k;
    return `<label class="admin-eff-opt${on ? ' on' : ''}">
      <input type="radio" name="admin-eff" value="${k}" data-action="shop-eff" ${on ? 'checked' : ''} />
      <span class="admin-eff-label">${e.label}</span>
      <span class="admin-eff-explain">${e.explain}</span>
    </label>`;
  }).join('');
  const kind = EFFECTS[f.effectKind];
  const amountLabel = kind.amountLabel;

  // (b) guidance that changes with the selected kind
  const kindGuide = `
    <div class="admin-kind-guide">
      <div class="admin-kind-guide-row"><span class="admin-kind-tag">What it does</span><span>${esc(kind.does)}</span></div>
      <div class="admin-kind-guide-row"><span class="admin-kind-tag">Vs. defenses</span><span>${esc(kind.defense)}</span></div>
      <div class="admin-kind-guide-row"><span class="admin-kind-tag">Example</span><span class="admin-kind-example">${esc(kind.example)}</span></div>
    </div>`;

  // (c) live plain-English preview composed from the current form values
  const previewItem = {
    cost: f.cost, mythicOnly: f.mythicOnly,
    effect: { kind: f.effectKind, amount: f.effectAmount },
  };

  // (d) friendly guardrails
  const reduceWarn = (f.effectKind === 'reduce' && !f.mythicOnly)
    ? '<div class="admin-warn-line">Half-damage relics are usually Mythic rewards. If it\'s purchasable, attacks become very weak — are you sure?</div>' : '';
  const saveErr = f.saveError ? `<div class="admin-warn-line admin-save-err">⚠️ ${esc(f.saveError)}</div>` : '';

  const previewUrl = f.imageFile || f.imageStored ? f.imageUrl : '';
  const imageArea = (f.imageFile || f.imageStored)
    ? `<div class="admin-shop-imgprev">
         ${previewUrl ? `<img src="${previewUrl}" alt="" class="admin-shop-imgprev-img" />` : '<span class="admin-faint">loading…</span>'}
         <span class="admin-faint">${f.imageFile ? 'pending save' : 'stored'}</span>
         <button type="button" class="admin-btn admin-btn-sm admin-btn-danger" data-action="shop-img-del">Remove image</button>
       </div>`
    : `<div class="admin-drop" data-shopimg="1" data-action="media-browse" title="Drop or click to browse">
         <input type="file" class="admin-file" data-shopimg="1" accept="image/*" hidden />
         <span class="admin-drop-prompt">⬇ Optional image — drop or click (falls back to the emoji)</span>
       </div>`;

  m.innerHTML = `
    <div class="admin-modal-bg" data-action="shop-close"></div>
    <div class="admin-modal admin-modal-lg">
      <div class="admin-modal-head">
        <div class="admin-modal-title">${f.isNew ? '🔮 New Item' : '🔮 Edit Item'}</div>
        <button class="admin-btn admin-btn-icon" data-action="shop-close" aria-label="Close">✕</button>
      </div>
      <div class="admin-modal-body admin-modal-scroll">
        <label class="admin-flabel" for="admin-shop-name">Name</label>
        <input id="admin-shop-name" class="admin-input" type="text" value="${esc(f.name)}" placeholder="Trojan Horse" />

        <label class="admin-flabel" for="admin-shop-desc">Description <span class="admin-faint">(shown to students)</span></label>
        <textarea id="admin-shop-desc" class="admin-input admin-textarea" rows="2" placeholder="Flavor + what it does, e.g. “A weapon for Battle Day — strikes for 25 HP and loots whatever gets through.”">${esc(f.desc)}</textarea>

        <div class="admin-two">
          <div>
            <label class="admin-flabel" for="admin-shop-emoji">Emoji</label>
            <input id="admin-shop-emoji" class="admin-input" type="text" value="${esc(f.emoji)}" placeholder="✨" style="max-width:110px" />
          </div>
          <div>
            ${f.mythicOnly ? `
              <label class="admin-flabel">Cost</label>
              <div class="admin-mythic-note">🏆 Mythic rewards are free — they're granted by a natural 20, never bought.</div>`
            : `
              <label class="admin-flabel" for="admin-shop-cost">Cost <span class="admin-faint">(points to buy)</span></label>
              <input id="admin-shop-cost" class="admin-input" type="number" min="1" max="9999" value="${esc(f.cost)}" style="max-width:150px" />`}
          </div>
        </div>

        <label class="admin-check admin-mythic-check">
          <input type="checkbox" id="admin-shop-mythic" ${f.mythicOnly ? 'checked' : ''} />
          <span>🏆 Mythic reward only <span class="admin-faint">(not purchasable — granted by a natural 20)</span></span>
        </label>

        <label class="admin-flabel">Image <span class="admin-faint">(optional — overrides the emoji)</span></label>
        ${imageArea}

        <label class="admin-flabel" style="margin-top:16px">What happens when it's used?</label>
        <div class="admin-eff-group">${effChips}</div>
        ${kindGuide}
        ${reduceWarn}

        <label class="admin-flabel" for="admin-shop-amount">${amountLabel}</label>
        <input id="admin-shop-amount" class="admin-input" type="number" min="1" max="9999" value="${esc(f.effectAmount)}" style="max-width:220px" />
        <div class="admin-step-hint" style="margin-top:6px">${esc(kind.range)}</div>

        <div class="admin-preview admin-shop-preview">
          <span class="admin-preview-eyebrow">In plain English</span>
          <span class="admin-shop-preview-text" id="admin-shop-preview">${esc(effectSentence(previewItem))}</span>
        </div>
        ${saveErr}
      </div>
      <div class="admin-modal-foot">
        <button class="admin-btn admin-btn-lg" data-action="shop-close">Cancel</button>
        <button class="admin-btn admin-btn-primary admin-btn-lg" data-action="shop-save">Save item</button>
      </div>
    </div>`;
  const n = el('admin-shop-name'); if (n && f.isNew) n.focus();
}

// Mr. D's duel items: kind picker drives everything else on the page — dice
// fields for anything rolled, and the counter picker for attack/defense
// items, which is the actual game (see duelShopGuideHTML above).
function renderDuelShopModal() {
  const f = shopForm;
  const m = el('admin-modal-root');
  const store = ctxRef.store;
  const catalog = store.getShopItems().filter((x) => x.id !== f.id);

  const effChips = DUEL_EFFECT_ORDER.map((k) => {
    const e = DUEL_EFFECTS[k];
    const on = f.effectKind === k;
    return `<label class="admin-eff-opt${on ? ' on' : ''}">
      <input type="radio" name="admin-eff" value="${k}" data-action="shop-eff" ${on ? 'checked' : ''} />
      <span class="admin-eff-label">${e.label}</span>
      <span class="admin-eff-explain">${esc(e.explain)}</span>
    </label>`;
  }).join('');

  const eff = DUEL_EFFECTS[f.effectKind] || DUEL_EFFECTS.damage;
  const slot = DUEL_SLOT_OF_KIND[f.effectKind] || 'utility';
  const isDamageLike = f.effectKind === 'damage' || f.effectKind === 'steal';
  const isFreeze = f.effectKind === 'freeze';

  const kindGuide = `
    <div class="admin-kind-guide">
      <div class="admin-kind-guide-row"><span class="admin-kind-tag">What it does</span><span>${esc(eff.does)}</span></div>
      <div class="admin-kind-guide-row"><span class="admin-kind-tag">Vs. defenses</span><span>${esc(eff.defense)}</span></div>
      <div class="admin-kind-guide-row"><span class="admin-kind-tag">Example</span><span class="admin-kind-example">${esc(eff.example)}</span></div>
    </div>`;

  const diceFields = (isDamageLike || isFreeze) ? `
    <div class="admin-two">
      <div>
        <label class="admin-flabel" for="admin-shop-dice">${isFreeze ? 'Dice rolled for days frozen' : 'Dice rolled for damage'}</label>
        <input id="admin-shop-dice" class="admin-input" type="text" value="${esc(f.dice)}" placeholder="2d6" style="max-width:150px" />
      </div>
      ${isDamageLike ? `
      <div>
        <label class="admin-flabel" for="admin-shop-mult">Points per die pip <span class="admin-faint">(× the roll)</span></label>
        <input id="admin-shop-mult" class="admin-input" type="number" min="1" value="${esc(f.mult)}" style="max-width:150px" />
      </div>` : ''}
    </div>
    <div class="admin-step-hint" style="margin-top:2px">${isFreeze ? 'e.g. 1d6 rolls 1 to 6 days frozen.' : `e.g. 2d6 rolled live on the board, × ${esc(f.mult)} = the points this takes off the target.`}</div>
  ` : '';

  const targetsField = f.effectKind === 'damage' ? `
    <label class="admin-flabel" style="margin-top:12px" for="admin-shop-targets">Houses hit at once</label>
    <input id="admin-shop-targets" class="admin-input" type="number" min="1" max="4" value="${esc(f.targets)}" style="max-width:150px" />
    <div class="admin-step-hint">1 = a single target. The Catapult hits 2 Houses at once.</div>
  ` : '';

  const anonField = isDamageLike ? `
    <label class="admin-check" style="margin-top:12px">
      <input type="checkbox" id="admin-shop-anon" ${f.anonymous ? 'checked' : ''} />
      <span>Keep the attacker's identity secret <span class="admin-faint">(like the Cloak of Invisibility)</span></span>
    </label>` : '';

  // ---- the counter picker: the heart of the game -------------------------
  let counterSection = '';
  if (slot === 'attack') {
    const defenses = catalog.filter((x) => (x.slot || 'utility') === 'defense');
    const boxes = defenses.map((x) => `
      <label class="admin-check">
        <input type="checkbox" class="admin-counter-check" data-counter-id="${esc(x.id)}" ${f.counteredBy.includes(x.id) ? 'checked' : ''} />
        <span>${esc(x.emoji || '🛡️')} ${esc(x.name)}</span>
      </label>`).join('');
    counterSection = `
      <label class="admin-flabel" style="margin-top:16px">Which defense cancels this attack? <span class="admin-faint">(check any that apply)</span></label>
      <div class="admin-mini">If the House this attack lands on is holding one of the defenses you check here, the attack does nothing at all — no points move, nobody is frozen — though both items are still spent for the week. Leave everything unchecked for an attack nothing can stop, like the Catapult.</div>
      <div style="display:flex;flex-wrap:wrap;gap:8px;margin-top:8px">${boxes || '<div class="admin-mini">No defense items exist yet — add one first, then come back here to link them.</div>'}</div>`;
  } else if (slot === 'defense') {
    const attacks = catalog.filter((x) => (x.slot || 'utility') === 'attack');
    const boxes = attacks.map((x) => `
      <label class="admin-check">
        <input type="checkbox" class="admin-counter-check" data-counter-id="${esc(x.id)}" ${f.blocks.includes(x.id) ? 'checked' : ''} />
        <span>${esc(x.emoji || '⚔️')} ${esc(x.name)}</span>
      </label>`).join('');
    counterSection = `
      <label class="admin-flabel" style="margin-top:16px">Which attacks does this stop? <span class="admin-faint">(check any that apply)</span></label>
      <div class="admin-mini">This House holds this item in secret for the week. If it is attacked with one of the items you check here, that attack does nothing at all — though both items are still spent. This is the counter system — the whole game is built on matchups like this one.</div>
      <div style="display:flex;flex-wrap:wrap;gap:8px;margin-top:8px">${boxes || '<div class="admin-mini">No attack items exist yet — add one first, then come back here to link them.</div>'}</div>`;
  }

  const previewItem = {
    cost: f.cost,
    effect: { kind: f.effectKind, dice: f.dice, mult: f.mult, targets: f.targets, anonymous: f.anonymous },
    counteredBy: f.counteredBy, blocks: f.blocks,
  };
  const saveErr = f.saveError ? `<div class="admin-warn-line admin-save-err">⚠️ ${esc(f.saveError)}</div>` : '';

  const previewUrl = f.imageFile || f.imageStored ? f.imageUrl : '';
  const imageArea = (f.imageFile || f.imageStored)
    ? `<div class="admin-shop-imgprev">
         ${previewUrl ? `<img src="${previewUrl}" alt="" class="admin-shop-imgprev-img" />` : '<span class="admin-faint">loading…</span>'}
         <span class="admin-faint">${f.imageFile ? 'pending save' : 'stored'}</span>
         <button type="button" class="admin-btn admin-btn-sm admin-btn-danger" data-action="shop-img-del">Remove image</button>
       </div>`
    : `<div class="admin-drop" data-shopimg="1" data-action="media-browse" title="Drop or click to browse">
         <input type="file" class="admin-file" data-shopimg="1" accept="image/*" hidden />
         <span class="admin-drop-prompt">⬇ Optional image — drop or click (falls back to the emoji)</span>
       </div>`;

  m.innerHTML = `
    <div class="admin-modal-bg" data-action="shop-close"></div>
    <div class="admin-modal admin-modal-lg">
      <div class="admin-modal-head">
        <div class="admin-modal-title">${f.isNew ? '🔮 New Item' : '🔮 Edit Item'} <span class="admin-faint">— Mr. D's rules</span></div>
        <button class="admin-btn admin-btn-icon" data-action="shop-close" aria-label="Close">✕</button>
      </div>
      <div class="admin-modal-body admin-modal-scroll">
        <label class="admin-flabel" for="admin-shop-name">Name</label>
        <input id="admin-shop-name" class="admin-input" type="text" value="${esc(f.name)}" placeholder="The Sword of Destiny" />

        <label class="admin-flabel" for="admin-shop-desc">Description <span class="admin-faint">(shown to students)</span></label>
        <textarea id="admin-shop-desc" class="admin-input admin-textarea" rows="2" placeholder="Strike another House for 2d6 × 100 points. The Shield of Protection stops it dead.">${esc(f.desc)}</textarea>

        <div class="admin-two">
          <div>
            <label class="admin-flabel" for="admin-shop-emoji">Emoji</label>
            <input id="admin-shop-emoji" class="admin-input" type="text" value="${esc(f.emoji)}" placeholder="🗡️" style="max-width:110px" />
          </div>
          <div>
            <label class="admin-flabel" for="admin-shop-cost">Cost <span class="admin-faint">(points to buy)</span></label>
            <input id="admin-shop-cost" class="admin-input" type="number" min="1" max="9999" value="${esc(f.cost)}" style="max-width:150px" />
          </div>
        </div>

        <label class="admin-flabel">Image <span class="admin-faint">(optional — overrides the emoji)</span></label>
        ${imageArea}

        <label class="admin-flabel" style="margin-top:16px">What kind of item is it?</label>
        <div class="admin-eff-group">${effChips}</div>
        ${kindGuide}

        ${diceFields}
        ${targetsField}
        ${anonField}
        ${counterSection}

        <div class="admin-preview admin-shop-preview">
          <span class="admin-preview-eyebrow">In plain English</span>
          <span class="admin-shop-preview-text" id="admin-shop-preview">${esc(duelEffectSentence(previewItem, catalog))}</span>
        </div>
        ${saveErr}
      </div>
      <div class="admin-modal-foot">
        <button class="admin-btn admin-btn-lg" data-action="shop-close">Cancel</button>
        <button class="admin-btn admin-btn-primary admin-btn-lg" data-action="shop-save">Save item</button>
      </div>
    </div>`;
  const n = el('admin-shop-name'); if (n && f.isNew) n.focus();
}

// Live preview: recompute the sentence as the teacher types cost/amount,
// without re-rendering (which would steal focus mid-keystroke).
function updateShopPreview() {
  if (!shopForm) return;
  if (shopForm.mode === 'duel') { updateDuelShopPreview(); return; }
  updateHpShopPreview();
}

function updateHpShopPreview() {
  if (!shopForm || !el('admin-shop-preview')) return;
  const g = (id) => (el(id) ? el(id).value : '');
  el('admin-shop-preview').textContent = effectSentence({
    cost: el('admin-shop-cost') ? g('admin-shop-cost') : shopForm.cost,
    mythicOnly: shopForm.mythicOnly,
    effect: { kind: shopForm.effectKind, amount: g('admin-shop-amount') },
  });
}

function updateDuelShopPreview() {
  if (!shopForm || !el('admin-shop-preview')) return;
  const f = shopForm;
  const store = ctxRef.store;
  const catalog = store.getShopItems().filter((x) => x.id !== f.id);
  const g = (id) => (el(id) ? el(id).value : '');
  const item = {
    cost: el('admin-shop-cost') ? g('admin-shop-cost') : f.cost,
    effect: {
      kind: f.effectKind,
      dice: el('admin-shop-dice') ? g('admin-shop-dice') : f.dice,
      mult: el('admin-shop-mult') ? g('admin-shop-mult') : f.mult,
      targets: el('admin-shop-targets') ? g('admin-shop-targets') : f.targets,
      anonymous: el('admin-shop-anon') ? el('admin-shop-anon').checked : f.anonymous,
    },
    counteredBy: f.counteredBy, blocks: f.blocks,
  };
  el('admin-shop-preview').textContent = duelEffectSentence(item, catalog);
}

function syncShopFromDom() {
  if (!shopForm) return;
  if (shopForm.mode === 'duel') { syncDuelShopFromDom(); return; }
  syncHpShopFromDom();
}

function syncHpShopFromDom() {
  if (!shopForm) return;
  const g = (id) => (el(id) ? el(id).value : '');
  shopForm.name = g('admin-shop-name');
  shopForm.desc = g('admin-shop-desc');
  shopForm.emoji = g('admin-shop-emoji') || '✨';
  if (el('admin-shop-cost')) shopForm.cost = g('admin-shop-cost');   // hidden while mythic
  shopForm.effectAmount = g('admin-shop-amount');
  if (el('admin-shop-mythic')) shopForm.mythicOnly = el('admin-shop-mythic').checked;
  const checked = rootEl.querySelector('input[name="admin-eff"]:checked');
  if (checked) shopForm.effectKind = checked.value;
  shopForm.saveError = null;   // any edit clears the previous failure notice
}

// Reads the counter checkboxes BEFORE the kind is switched (see the
// admin-eff change handler), so a kind change captures the counters that
// were on screen for the kind that was active a moment ago.
function syncDuelShopFromDom() {
  if (!shopForm) return;
  const f = shopForm;
  const g = (id) => (el(id) ? el(id).value : '');
  f.name = g('admin-shop-name');
  f.desc = g('admin-shop-desc');
  f.emoji = g('admin-shop-emoji') || '✨';
  if (el('admin-shop-cost')) f.cost = g('admin-shop-cost');
  if (el('admin-shop-dice')) f.dice = g('admin-shop-dice');
  if (el('admin-shop-mult')) f.mult = g('admin-shop-mult');
  if (el('admin-shop-targets')) f.targets = g('admin-shop-targets');
  if (el('admin-shop-anon')) f.anonymous = el('admin-shop-anon').checked;
  const checked = rootEl.querySelector('input[name="admin-eff"]:checked');
  if (checked) f.effectKind = checked.value;
  const counterBoxes = rootEl.querySelectorAll('.admin-counter-check');
  if (counterBoxes.length) {
    const ids = Array.from(counterBoxes).filter((c) => c.checked).map((c) => c.dataset.counterId);
    const slot = DUEL_SLOT_OF_KIND[f.effectKind] || 'utility';
    if (slot === 'attack') f.counteredBy = ids;
    else if (slot === 'defense') f.blocks = ids;
  }
  f.saveError = null;
}

function stageShopImage(file) {
  if (!shopForm || !file) return;
  if (file.type && !/^image\//.test(file.type)) { toast('Please choose an image file.'); return; }
  syncShopFromDom();
  if (shopForm.imageUrl && shopUrls.has(shopForm.imageUrl)) { try { URL.revokeObjectURL(shopForm.imageUrl); } catch (e) {} shopUrls.delete(shopForm.imageUrl); }
  shopForm.imageFile = file;
  shopForm.imageStored = false;
  shopForm.imageUrl = URL.createObjectURL(file);
  shopUrls.add(shopForm.imageUrl);
  renderShopModal();
}

// Explain a null from store.saveShopItem() in the teacher's own terms rather
// than failing silently. Mirrors the store's validation order.
function explainSaveFailure(f, store) {
  if (f.mode === 'duel') {
    if (!f.name.trim()) return 'This item needs a name.';
    if (!store.DUEL_KINDS.includes(f.effectKind)) return `“${f.effectKind}” isn't a type this game understands. Pick one of the eight options above.`;
    if (!(Number(f.cost) > 0)) return 'Give this item a price of at least 1 point.';
    return "Something in this item wasn't accepted. Check the name, price, and type.";
  }
  if (!f.name.trim()) return 'This item needs a name.';
  if (!store.SHOP_KINDS.includes(f.effectKind)) return `“${f.effectKind}” isn't a magic type this game understands. Pick one of the six options above.`;
  if (!f.mythicOnly && !(Number(f.cost) > 0)) return 'Give this item a price of at least 1 point — or tick “Mythic reward only” if it should be earned instead of bought.';
  return "Something in this item wasn't accepted. Check the name, price, and type.";
}

async function saveShopItem() {
  syncShopFromDom();
  if (shopForm && shopForm.mode === 'duel') { await saveDuelShopItem(); return; }
  await saveHpShopItem();
}

async function saveHpShopItem() {
  const f = shopForm;
  const store = ctxRef.store;
  const imgKey = `shop:${f.id}:image`;
  let image = '';
  if (f.imageFile) { await media.put(imgKey, f.imageFile); image = `media:${imgKey}`; }
  else if (f.imageStored) { image = `media:${imgKey}`; }
  else { await media.delete(imgKey); image = ''; } // emoji-only or image removed

  // The store owns validation: it checks the kind, forces cost 0 for mythic
  // relics, and rejects a priceless non-mythic item.
  const saved = store.saveShopItem({
    id: f.id, name: f.name.trim(), desc: f.desc.trim(), emoji: f.emoji || '✨', image,
    cost: f.cost, mythicOnly: f.mythicOnly,
    effect: { kind: f.effectKind, amount: f.effectAmount },
  });
  if (!saved) {
    shopForm.saveError = explainSaveFailure(f, store);
    renderShopModal();
    return;
  }
  revokeShopUrls();
  const wasNew = f.isNew;
  shopForm = null;
  closeModal();
  renderBody({ force: true });
  toast(wasNew ? 'Item added.' : 'Item updated.');
}

async function saveDuelShopItem() {
  const f = shopForm;
  const store = ctxRef.store;
  const imgKey = `shop:${f.id}:image`;
  let image = '';
  if (f.imageFile) { await media.put(imgKey, f.imageFile); image = `media:${imgKey}`; }
  else if (f.imageStored) { image = `media:${imgKey}`; }
  else { await media.delete(imgKey); image = ''; }

  const slot = DUEL_SLOT_OF_KIND[f.effectKind] || 'utility';
  const payload = {
    id: f.id, name: f.name.trim(), desc: f.desc.trim(), emoji: f.emoji || '✨', image,
    cost: f.cost, mythicOnly: false,
    slot,
    effect: { kind: f.effectKind },
  };
  if (slot === 'attack') {
    payload.effect.dice = f.dice;
    if (f.effectKind !== 'freeze') payload.effect.mult = f.mult;
    if (f.effectKind === 'damage') payload.effect.targets = f.targets;
    if ((f.effectKind === 'damage' || f.effectKind === 'steal') && f.anonymous) payload.effect.anonymous = true;
    payload.counteredBy = f.counteredBy.slice();
  } else if (slot === 'defense') {
    payload.blocks = f.blocks.slice();
  }

  const saved = store.saveShopItem(payload);
  if (!saved) {
    shopForm.saveError = explainSaveFailure(f, store);
    renderShopModal();
    return;
  }

  // Keep both sides of every counter relationship in sync, whichever side was
  // just edited from. A defense's "stops" list and an attack's "cancelled by"
  // list are two views of the same fact — a teacher should never have to
  // remember to go update the other item by hand.
  syncCounterReciprocals(store, saved);

  revokeShopUrls();
  const wasNew = f.isNew;
  shopForm = null;
  closeModal();
  renderBody({ force: true });
  toast(wasNew ? 'Item added.' : 'Item updated.');
}

// After saving `saved` (an attack or a defense item), walks the rest of the
// catalog and makes the reciprocal field agree with what was just picked —
// e.g. checking "Shield of Protection" while editing the Sword of Destiny
// must also add the Sword to the Shield's OWN "stops" list, even though the
// teacher never opened the Shield's editor to do it.
function syncCounterReciprocals(store, saved) {
  if (saved.slot !== 'attack' && saved.slot !== 'defense') return;
  const catalog = store.getShopItems();
  if (saved.slot === 'attack') {
    const wanted = new Set(saved.counteredBy || []);
    catalog.filter((x) => x.id !== saved.id && x.slot === 'defense').forEach((def) => {
      const has = (def.blocks || []).includes(saved.id);
      const should = wanted.has(def.id);
      if (has === should) return;
      const nextBlocks = should
        ? [...(def.blocks || []), saved.id]
        : (def.blocks || []).filter((id) => id !== saved.id);
      store.saveShopItem({ ...def, blocks: nextBlocks });
    });
  } else {
    const wanted = new Set(saved.blocks || []);
    catalog.filter((x) => x.id !== saved.id && x.slot === 'attack').forEach((atk) => {
      const has = (atk.counteredBy || []).includes(saved.id);
      const should = wanted.has(atk.id);
      if (has === should) return;
      const nextCountered = should
        ? [...(atk.counteredBy || []), saved.id]
        : (atk.counteredBy || []).filter((id) => id !== saved.id);
      store.saveShopItem({ ...atk, counteredBy: nextCountered });
    });
  }
}

function revokeShopUrls() { shopUrls.forEach((u) => { try { URL.revokeObjectURL(u); } catch (e) {} }); shopUrls.clear(); }

// Fill shop row thumbnails (stored images) after a render.
async function refreshShopThumbs() {
  if (activeTab !== 'shop' || !rootEl) return;
  const thumbs = [...rootEl.querySelectorAll('.admin-shop-thumb[data-imgkey]')];
  for (const t of thumbs) {
    const u = await media.url(t.dataset.imgkey);
    if (u && t.isConnected) t.innerHTML = `<img src="${u}" alt="" class="admin-shop-thumb-img" />`;
  }
}

// ===========================================================================
// TAB — SETTINGS: Houses (rename/recolour/reskin the four houses)
// ===========================================================================
// Reads store.HOUSES directly (the live objects) so the list always matches
// whatever is on screen everywhere else — including edits made moments ago.
function renderHousesCard() {
  const store = ctxRef.store;
  const rows = [1, 2, 3, 4].map((id) => {
    const h = store.HOUSES[id];
    if (!h) return '';
    return `
      <div class="admin-shop-row admin-house-row">
        <span class="admin-house-crest">
          <img src="${esc(h.image)}" alt="" class="admin-house-crest-img"
            onerror="this.onerror=null;this.style.display='none';" />
        </span>
        <div class="admin-q-main">
          <div class="admin-q-title" style="color:${esc(h.accent)}">${esc(h.name)} <span class="admin-faint">· Core ${h.core}</span></div>
          <div class="admin-q-desc">${esc(h.motto)}</div>
        </div>
        <span class="admin-house-swatch" style="background:${esc(h.accent)}" title="${esc(h.accent)}"></span>
        <div class="admin-q-row-actions">
          <button class="admin-btn admin-btn-sm" data-action="house-edit" data-id="${h.id}">Edit</button>
          <button class="admin-btn admin-btn-sm admin-btn-danger" data-action="house-reset" data-id="${h.id}">Reset</button>
        </div>
      </div>`;
  }).join('');

  return `
    <div class="admin-card">
      <div class="admin-card-title">🏰 Houses</div>
      <div class="admin-mini">Rename or recolour a house any time — everything in the app follows automatically.</div>
      <div class="admin-q-list" style="margin-top:10px">${rows}</div>
    </div>`;
}

function openHouseForm(id) {
  const store = ctxRef.store;
  const h = store.HOUSES[id];
  if (!h) return;
  houseForm = { id: h.id, name: h.name, motto: h.motto, accent: h.accent, image: h.image, heroImage: h.heroImage, saveError: null };
  renderHouseModal();
}

function renderHouseModal() {
  const f = houseForm;
  const m = el('admin-modal-root');
  const accent = isHex(hexNorm(f.accent)) ? hexNorm(f.accent) : '#ef4444';
  m.innerHTML = `
    <div class="admin-modal-bg" data-action="house-close"></div>
    <div class="admin-modal admin-modal-lg">
      <div class="admin-modal-head">
        <div class="admin-modal-title">🏰 Edit House</div>
        <button class="admin-btn admin-btn-icon" data-action="house-close" aria-label="Close">✕</button>
      </div>
      <div class="admin-modal-body admin-modal-scroll">

        <div class="admin-house-preview">
          <span class="admin-house-crest admin-house-crest-lg">
            <img id="admin-house-preview-crest" src="${esc(f.image)}" alt=""
              onerror="this.onerror=null;this.style.display='none';" />
          </span>
          <div class="admin-q-main">
            <div class="admin-house-preview-name" id="admin-house-preview-name" style="color:${accent}">${esc(f.name) || 'House name'}</div>
            <div class="admin-house-preview-motto" id="admin-house-preview-motto">${esc(f.motto) || 'Motto'}</div>
          </div>
          <span class="admin-house-swatch admin-house-swatch-lg" id="admin-house-preview-swatch" style="background:${accent}"></span>
        </div>

        <label class="admin-flabel" for="admin-house-name">Name</label>
        <input id="admin-house-name" class="admin-input" type="text" value="${esc(f.name)}" placeholder="Camelot" />

        <label class="admin-flabel" for="admin-house-motto">Motto</label>
        <input id="admin-house-motto" class="admin-input" type="text" value="${esc(f.motto)}" placeholder="Honor Above All" />

        <label class="admin-flabel">Accent colour</label>
        <div class="admin-key-row">
          <input id="admin-house-accent-color" type="color" value="${accent}" class="admin-color-swatch-input" />
          <input id="admin-house-accent-hex" class="admin-input" type="text" value="${accent}" placeholder="#ef4444" style="max-width:140px" spellcheck="false" autocomplete="off" />
        </div>

        <label class="admin-flabel" for="admin-house-image" style="margin-top:14px">Crest image <span class="admin-faint">(the house shield, shown everywhere)</span></label>
        <input id="admin-house-image" class="admin-input" type="text" value="${esc(f.image)}" placeholder="images/camelot-shield.png" spellcheck="false" autocomplete="off" />

        <label class="admin-flabel" for="admin-house-hero">Banner image <span class="admin-faint">(wide header art)</span></label>
        <input id="admin-house-hero" class="admin-input" type="text" value="${esc(f.heroImage)}" placeholder="images/header-camelot.jpg" spellcheck="false" autocomplete="off" />

        <div class="admin-mini" style="margin-top:8px">Put new artwork in the <code>images/</code> folder. Keep the same filename to replace the picture in place, or type a new filename here to point at a different file.</div>
        ${f.saveError ? `<div class="admin-warn-line admin-save-err">⚠️ ${esc(f.saveError)}</div>` : ''}
      </div>
      <div class="admin-modal-foot">
        <button class="admin-btn admin-btn-lg" data-action="house-close">Cancel</button>
        <button class="admin-btn admin-btn-primary admin-btn-lg" data-action="house-save">Save house</button>
      </div>
    </div>`;
  const n = el('admin-house-name'); if (n) n.focus();
}

// Live preview as the teacher types — no full re-render, so focus is never lost.
function updateHousePreview() {
  if (!houseForm) return;
  const nameEl = el('admin-house-preview-name');
  const nm = el('admin-house-name');
  if (nameEl && nm) nameEl.textContent = nm.value || 'House name';
  const mottoEl = el('admin-house-preview-motto');
  const mo = el('admin-house-motto');
  if (mottoEl && mo) mottoEl.textContent = mo.value || 'Motto';
  const img = el('admin-house-image');
  const crest = el('admin-house-preview-crest');
  if (img && crest && img.value) { crest.style.display = ''; crest.src = img.value; }
}

function updateHouseAccentPreview(hex) {
  const swatch = el('admin-house-preview-swatch');
  if (swatch) swatch.style.background = hex;
  const nameEl = el('admin-house-preview-name');
  if (nameEl) nameEl.style.color = hex;
}

function syncHouseFromDom() {
  if (!houseForm) return;
  const g = (id) => (el(id) ? el(id).value : '');
  houseForm.name = g('admin-house-name');
  houseForm.motto = g('admin-house-motto');
  houseForm.accent = g('admin-house-accent-hex') || g('admin-house-accent-color') || houseForm.accent;
  houseForm.image = g('admin-house-image');
  houseForm.heroImage = g('admin-house-hero');
  houseForm.saveError = null;
}

function saveHouseForm() {
  syncHouseFromDom();
  const f = houseForm;
  const store = ctxRef.store;
  const name = f.name.trim();
  const motto = f.motto.trim();
  const accent = hexNorm(f.accent);
  const image = f.image.trim();
  const heroImage = f.heroImage.trim();
  if (!name) { f.saveError = 'Give this house a name.'; renderHouseModal(); return; }
  if (!motto) { f.saveError = 'Give this house a motto.'; renderHouseModal(); return; }
  if (!isHex(accent)) { f.saveError = 'Accent colour must be a hex code, like #ef4444.'; renderHouseModal(); return; }
  if (!image) { f.saveError = 'The crest image needs a filename, e.g. images/camelot-shield.png.'; renderHouseModal(); return; }
  if (!heroImage) { f.saveError = 'The banner image needs a filename, e.g. images/header-camelot.jpg.'; renderHouseModal(); return; }
  const updated = store.updateHouse(f.id, { name, motto, accent, image, heroImage });
  if (!updated) { f.saveError = "Something here wasn't accepted — double check the fields above."; renderHouseModal(); return; }
  houseForm = null;
  closeModal();
  renderBody({ force: true });
  toast('House updated — it’s live everywhere right now.');
}

function openHouseResetConfirm(id) {
  const store = ctxRef.store;
  const h = store.HOUSES[id];
  if (!h) return;
  openConfirm(`Reset ${h.name} to its shipped defaults?`,
    'Name, motto, accent colour and artwork all revert to how the app shipped. This cannot be undone (but you can edit it again afterward).',
    () => {
      const ok = store.resetHouse(id);
      renderBody({ force: true });
      toast(ok ? `${h.name} reset to its original look.` : `${h.name} was already at its shipped defaults.`);
    }, { yesLabel: 'Reset house' });
}

// ---- Screen colours (a screen's own colour vs. following the active house) ----
// Iterates store.MODULE_THEMES rather than naming dashboard/quests/houses by
// hand, so a fourth screen the store adds later shows up here with no changes.
function renderScreenColoursCard() {
  const store = ctxRef.store;
  const activeHouse = store.getActiveHouse();
  const rows = Object.keys(store.MODULE_THEMES).map((id) => {
    const t = store.getModuleTheme(id);   // { configurable, label, color, matchHouse }
    // What the screen actually shows right now, for the preview swatch.
    const usedNow = t.matchHouse ? (activeHouse ? activeHouse.accent : t.color) : t.color;
    const followingNote = t.matchHouse
      ? (activeHouse ? `following ${esc(activeHouse.name)} right now` : 'no house is up right now — showing its own colour')
      : 'using its own colour';
    return `
      <div class="admin-shop-row">
        <div class="admin-q-main">
          <div class="admin-q-title">${esc(t.label)}</div>
          <div class="admin-toggle-row" style="margin-top:6px">
            <button class="admin-toggle${t.matchHouse ? ' on' : ''}" data-action="mct-match" data-module="${esc(id)}"
              role="switch" aria-checked="${t.matchHouse}"><span class="admin-toggle-knob"></span></button>
            <span class="admin-mini" style="margin:0">Match house colour <span class="admin-faint">— ${followingNote}</span></span>
          </div>
        </div>
        <input type="color" class="admin-color-swatch-input admin-mct-color" data-module="${esc(id)}"
          value="${esc(t.color)}" ${t.matchHouse ? 'disabled' : ''}
          title="${t.matchHouse ? 'Turn off Match house colour to pick your own' : "Pick this screen's colour"}"
          style="${t.matchHouse ? 'opacity:.4;cursor:not-allowed' : ''}" />
        <span class="admin-house-swatch" id="admin-mct-swatch-${esc(id)}" style="background:${esc(usedNow)}" title="What this screen uses right now"></span>
        <div class="admin-q-row-actions">
          <button class="admin-btn admin-btn-sm admin-btn-danger" data-action="mct-reset" data-module="${esc(id)}">Reset</button>
        </div>
      </div>`;
  }).join('');

  return `
    <div class="admin-card">
      <div class="admin-card-title">🎨 Screen colours</div>
      <div class="admin-mini">Each screen below normally follows whichever house is up — the board glows red for Camelot, blue for Atlantis, gold for Valhalla, green for Rivendell. Turn <b>Match house colour</b> off to lock a screen to one colour all the time instead. That's handy because a screen cycling through four different colours every period can end up feeling like a different app each time — which is exactly why Quests already ships with its own bronze rather than borrowing whichever house happens to be up.</div>
      <div class="admin-mct-list" style="display:flex;flex-direction:column;gap:10px;margin-top:10px">${rows}</div>
      <div class="admin-mini" style="margin-top:12px">🔒 <b>This only covers the screens listed above.</b> The Magic Shop, Battle Day, the Die of Destiny, the Council of Four and Place of the Week each have their own built-in colours baked into the app, and nothing here changes them.</div>
    </div>`;
}

// ---- Screen layout (grid vs. carousel) ------------------------------------
// Iterates store.LAYOUT_SCREENS rather than naming Quests/Shop by hand, so a
// third screen the store adds later shows up here with no changes.
function renderScreenLayoutCard() {
  const store = ctxRef.store;
  const rows = Object.entries(store.LAYOUT_SCREENS).map(([id, def]) => {
    const layout = store.getLayout(id);
    return `
      <div class="admin-shop-row">
        <div class="admin-q-main">
          <div class="admin-q-title">${esc(def.label)}</div>
        </div>
        <div class="admin-seg admin-theme-seg" style="margin:0">
          <button class="admin-theme-opt${layout === 'grid' ? ' on' : ''}" data-action="screen-layout" data-screen="${esc(id)}" data-layout="grid">▦ Grid</button>
          <button class="admin-theme-opt${layout === 'carousel' ? ' on' : ''}" data-action="screen-layout" data-screen="${esc(id)}" data-layout="carousel">◗ Carousel</button>
        </div>
      </div>`;
  }).join('');

  return `
    <div class="admin-card">
      <div class="admin-card-title">🗂️ Screen layout</div>
      <div class="admin-mini">A grid shows several cards at once, which is best for scanning a long list. A carousel shows one big card at a time with arrows to move through the rest — handy at a smartboard, where scrolling up and down isn't really an option. <b>Grid is the default.</b> This only changes how the screen looks — nothing about points, costs or quests changes.</div>
      <div class="admin-mct-list" style="display:flex;flex-direction:column;gap:10px;margin-top:10px">${rows}</div>
    </div>`;
}

// ---- Quick award presets (one-tap buttons on the Records screen) ----------
// Order here IS the button order on Records — the teacher builds muscle memory
// around it, so reordering is a first-class action, not an afterthought.
function awardPtsLabel(points) {
  const n = Math.round(Number(points) || 0);
  return n >= 0 ? `+${n}` : `−${Math.abs(n)}`;
}

// Shared by the live preview in the editor and (if ever needed) elsewhere —
// one sentence, in the teacher's own words, of what tapping the button does.
function awardSentence(f) {
  const n = Math.round(Number(f?.points));
  if (!Number.isFinite(n) || n === 0) return 'Enter a points value to see a preview.';
  return n > 0
    ? `Tapping this gives Camelot +${n} points.`
    : `Tapping this takes ${Math.abs(n)} points from Camelot.`;
}

function awardRowHTML(p, i, total) {
  return `
    <div class="admin-shop-row admin-award-row">
      <div class="admin-shop-cost admin-award-pts ${Number(p.points) >= 0 ? 'pos' : 'neg'}">${awardPtsLabel(p.points)}<small>pts</small></div>
      <div class="admin-q-main">
        <div class="admin-q-title">${esc(p.label)}</div>
      </div>
      <div class="admin-q-row-actions">
        <button class="admin-btn admin-btn-icon" data-action="award-up" data-id="${esc(p.id)}" aria-label="Move up"${i === 0 ? ' disabled' : ''}>▲</button>
        <button class="admin-btn admin-btn-icon" data-action="award-down" data-id="${esc(p.id)}" aria-label="Move down"${i === total - 1 ? ' disabled' : ''}>▼</button>
        <button class="admin-btn admin-btn-icon" data-action="award-edit" data-id="${esc(p.id)}" aria-label="Edit">✏️</button>
        <button class="admin-btn admin-btn-icon admin-btn-danger" data-action="award-del" data-id="${esc(p.id)}" aria-label="Delete">🗑️</button>
      </div>
    </div>`;
}

function renderAwardPresetsCard() {
  const store = ctxRef.store;
  const presets = store.getAwardPresets();
  const rows = presets.map((p, i) => awardRowHTML(p, i, presets.length)).join('');
  const crowdWarn = presets.length > 8
    ? `<div class="admin-warn-line">⚠️ ${presets.length} quick award buttons is a lot for one row on the Records screen — consider trimming toward 8 or fewer so it doesn't get crowded on the board.</div>`
    : '';
  return `
    <div class="admin-card">
      <div class="admin-rows-head">
        <span class="admin-card-title" style="margin:0">⚡ Quick award buttons</span>
        <button class="admin-btn admin-btn-primary" data-action="award-new">+ Add a quick award</button>
      </div>
      <div class="admin-mini">These appear as one-tap buttons on the Records screen — your most common awards, ready to go.</div>
      <div class="admin-q-list" style="margin-top:10px">${rows || '<div class="admin-empty admin-empty-sm">No quick awards yet. Add one to get started.</div>'}</div>
      ${crowdWarn}
    </div>`;
}

// ---- Die of Destiny prophecy table (dice roll outcomes) --------------------
function renderDiceProphecyCard() {
  const store = ctxRef.store;
  const rows = store.getDiceProphecy().map((o) => diceRowHTML(o)).join('');
  return `
    <div class="admin-card">
      <div class="admin-card-title">🎲 Die of Destiny — Prophecy Table</div>
      <div class="admin-mini">These are the six outcomes a student can land on when they roll the d20. Change the points, the title, the description or the emoji on any row below — it saves the moment you type, no separate Save button needed. The <b>ranges</b> (which numbers on the die trigger which outcome) are fixed on purpose: all 20 faces have to map to exactly one outcome, with no gaps and no numbers shared between two outcomes, or a roll could come up with nothing to show the class. Letting those ranges be edited risked breaking that guarantee for very little benefit, so only the wording and points below can change.</div>
      <div class="admin-dice-rows" style="margin-top:12px">${rows}</div>
    </div>`;
}

function diceRowHTML(o) {
  const rangeLabel = o.min === o.max ? `Roll ${o.min}` : `Roll ${o.min}–${o.max}`;
  return `
    <div class="admin-dice-row" data-dice-id="${esc(o.id)}">
      <div class="admin-dice-range" title="These numbers on the d20 trigger this outcome">${esc(rangeLabel)}</div>
      <input class="admin-input admin-dice-emoji" type="text" maxlength="4" value="${esc(o.emoji)}"
        data-dice-id="${esc(o.id)}" data-dice-field="emoji" aria-label="Emoji" />
      <div class="admin-dice-main">
        <input class="admin-input" type="text" value="${esc(o.title)}"
          data-dice-id="${esc(o.id)}" data-dice-field="title" aria-label="Outcome title" placeholder="Outcome name" />
        <input class="admin-input admin-input-sm" type="text" value="${esc(o.desc)}"
          data-dice-id="${esc(o.id)}" data-dice-field="desc" aria-label="What happens" placeholder="What happens when this comes up" />
      </div>
      <div class="admin-dice-points">
        <label class="admin-flabel" style="margin:0">Points</label>
        <input class="admin-input" type="number" value="${esc(o.points)}"
          data-dice-id="${esc(o.id)}" data-dice-field="points" aria-label="Points awarded" />
      </div>
      <button class="admin-btn admin-btn-sm admin-btn-danger" data-action="dice-reset" data-dice-id="${esc(o.id)}"
        title="Put this row back to its shipped wording and points">Reset</button>
    </div>`;
}

function openAwardForm(id) {
  const store = ctxRef.store;
  const p = id ? store.getAwardPresets().find((x) => x.id === id) : null;
  awardForm = {
    id: p ? p.id : null,
    isNew: !p,
    label: p?.label || '',
    points: p ? p.points : 5,
    saveError: null,
  };
  renderAwardModal();
}

function renderAwardModal() {
  const f = awardForm;
  const m = el('admin-modal-root');
  const saveErr = f.saveError ? `<div class="admin-warn-line admin-save-err">⚠️ ${esc(f.saveError)}</div>` : '';
  m.innerHTML = `
    <div class="admin-modal-bg" data-action="award-close"></div>
    <div class="admin-modal">
      <div class="admin-modal-head">
        <div class="admin-modal-title">${f.isNew ? '⚡ Add a Quick Award' : '⚡ Edit Quick Award'}</div>
        <button class="admin-btn admin-btn-icon" data-action="award-close" aria-label="Close">✕</button>
      </div>
      <div class="admin-modal-body">
        <label class="admin-flabel" for="admin-award-label">Label <span class="admin-faint">(what you'd call it out loud, e.g. "Bell Ringer done")</span></label>
        <input id="admin-award-label" class="admin-input" type="text" value="${esc(f.label)}" placeholder="Bell Ringer done" />

        <label class="admin-flabel" for="admin-award-points" style="margin-top:12px">Points</label>
        <input id="admin-award-points" class="admin-input" type="number" step="1" value="${esc(f.points)}" style="max-width:160px" />
        <div class="admin-step-hint">Use a negative number for a penalty, e.g. −5.</div>

        <div class="admin-preview admin-shop-preview">
          <span class="admin-preview-eyebrow">In plain English</span>
          <span class="admin-shop-preview-text" id="admin-award-preview">${esc(awardSentence(f))}</span>
        </div>
        ${saveErr}
      </div>
      <div class="admin-modal-foot">
        <button class="admin-btn admin-btn-lg" data-action="award-close">Cancel</button>
        <button class="admin-btn admin-btn-primary admin-btn-lg" data-action="award-save">Save award</button>
      </div>
    </div>`;
  const l = el('admin-award-label'); if (l) l.focus();
}

// Live preview as the teacher types points, without a full re-render (which
// would steal focus mid-keystroke) — mirrors updateShopPreview/updateQuestPreview.
function updateAwardPreview() {
  if (!awardForm || !el('admin-award-preview')) return;
  el('admin-award-preview').textContent = awardSentence({
    points: el('admin-award-points') ? el('admin-award-points').value : awardForm.points,
  });
}

function syncAwardFromDom() {
  if (!awardForm) return;
  const g = (id) => (el(id) ? el(id).value : '');
  awardForm.label = g('admin-award-label');
  awardForm.points = g('admin-award-points');
  awardForm.saveError = null;
}

function saveAwardForm() {
  syncAwardFromDom();
  const f = awardForm;
  const store = ctxRef.store;
  const label = String(f.label || '').trim();
  const rawPoints = f.points;
  const points = Number(rawPoints);
  if (!label) { f.saveError = 'This award needs a label — it\'s what shows on the button.'; renderAwardModal(); return; }
  if (rawPoints === '' || rawPoints == null || !Number.isFinite(points)) {
    f.saveError = 'Points must be a number.'; renderAwardModal(); return;
  }
  if (Math.round(points) === 0) {
    f.saveError = "Points can't be zero — tapping the button has to actually change something. Use a negative number for a penalty."; renderAwardModal(); return;
  }
  const saved = store.saveAwardPreset({ id: f.id, label, points: Math.round(points), tag: 'manual' });
  if (!saved) { f.saveError = "Something here wasn't accepted — check the label and points."; renderAwardModal(); return; }
  const wasNew = f.isNew;
  awardForm = null;
  closeModal();
  renderBody({ force: true });
  toast(wasNew ? 'Quick award added.' : 'Quick award updated.');
}

function moveAwardPreset(id, dir) {
  const store = ctxRef.store;
  const list = store.getAwardPresets().slice();
  const i = list.findIndex((p) => p.id === id);
  if (i < 0) return;
  const j = i + dir;
  if (j < 0 || j >= list.length) return;
  [list[i], list[j]] = [list[j], list[i]];
  store.updateSettings({ awardPresets: list });
  renderBody();
}

// ===========================================================================
// TAB — SETTINGS
// ===========================================================================

// ---- Battle rules (hit points, prize rule, punching down) -----------------
// HP is separate from points: points are the currency and the scoreboard; HP
// is what a strike removes. A house is beaten at zero HP and the winner takes
// a PRIZE in points, chosen by the rule below — the loser never loses points.
function combatHpRowsHTML() {
  const store = ctxRef.store;
  return Object.values(store.HOUSES).map((h) => {
    const pts = Math.max(0, store.getTotal(h.id, 'term'));
    const hp = store.getMaxHp(h.id);
    return `<div class="admin-mini" style="margin:2px 0">${esc(h.name)} has <b>${pts.toLocaleString()}</b> points, so <b>${hp}</b> HP.</div>`;
  }).join('');
}

function combatPreviewData() {
  const store = ctxRef.store;
  const attackerId = combatPreviewSel.attacker;
  const defenderId = combatPreviewSel.defender;
  const attacker = store.HOUSES[attackerId];
  const defender = store.HOUSES[defenderId];
  if (!attacker || !defender || attackerId === defenderId) {
    return { text: '—', note: 'Pick two different houses to preview a battle between them.' };
  }
  const prize = store.previewPrize(attackerId, defenderId);
  const can = store.canAttack(attackerId, defenderId);
  const text = `${attacker.name} defeats ${defender.name} → wins ${prize.toLocaleString()} pts. ${defender.name} keeps every point they have.`;
  const note = can.ok
    ? 'This matchup is allowed under the current Punching down setting.'
    : `⚠️ Under the current Punching down setting, this exact matchup would actually be blocked: ${can.reason}`;
  return { text, note };
}

// Re-paints just the two live bits of the card (the prize sentence and the HP
// worked examples) rather than the whole card — a full renderBody() would be
// skipped anyway by the mid-typing guard while a number field still has focus.
function updateCombatPreview() {
  const p = combatPreviewData();
  const amt = el('admin-combat-preview-amount');
  if (amt) amt.textContent = p.text;
  const note = el('admin-combat-preview-note');
  if (note) note.textContent = p.note;
}

function updateCombatHpList() {
  const list = el('admin-combat-hp-list');
  if (list) list.innerHTML = combatHpRowsHTML();
}

function renderBattleRulesCard() {
  const store = ctxRef.store;
  const c = store.getCombat();
  const rule = store.PRIZE_RULES[c.prizeRule] ? c.prizeRule : 'gap';
  const houses = Object.values(store.HOUSES);

  const ruleButtons = Object.entries(store.PRIZE_RULES).map(([id, def]) =>
    `<button class="admin-theme-opt${rule === id ? ' on' : ''}" data-action="combat-rule" data-rule="${esc(id)}">${esc(def.label)}</button>`
  ).join('');

  const ruleBlurb = store.PRIZE_RULES[rule] ? store.PRIZE_RULES[rule].blurb : '';

  const ruleCaution = rule === 'gap'
    ? `This is the <b>default</b>, and it is self-limiting by design: the prize shrinks as the trailing house catches up. Simulated over a 9-week term with houses earning unevenly, the best-behaved class still won the term overall, and the point spread between houses <b>narrowed</b> rather than widened.`
    : rule === 'percent'
    ? `⚠️ <b>Be careful with this one — it compounds.</b> In that same simulated 9-week term, prizes under this rule grew from <b>281 to 1,671 points</b> as the weeks went on — battles alone created as many points as a whole term of good behavior — and the <b>worst-behaved class ended up winning the term</b>. This is simulated fact, not opinion. It is offered because a teacher may want it, not because it is the advised choice.`
    : `Never compounds — every win pays exactly the same, term after term. The one thing to watch: if this is set <b>below</b> what weapons cost in the Magic Shop, nobody will ever bother attacking, because there is nothing left to gain.`;

  const numberField = rule === 'gap'
    ? `<label class="admin-flabel" for="admin-combat-gapshare">Prize: % of the point gap between the two houses</label>
       <input id="admin-combat-gapshare" class="admin-input" type="number" min="0" max="100" value="${esc(c.gapShare)}" />`
    : rule === 'percent'
    ? `<label class="admin-flabel" for="admin-combat-percent">Prize: % of the defeated house's total points</label>
       <input id="admin-combat-percent" class="admin-input" type="number" min="0" max="100" value="${esc(c.prizePercent)}" />`
    : `<label class="admin-flabel" for="admin-combat-flat">Prize: fixed points, every win</label>
       <input id="admin-combat-flat" class="admin-input" type="number" min="0" value="${esc(c.prizeFlat)}" />`;

  const houseOpts = (selectedId) => houses.map((h) =>
    `<option value="${h.id}"${Number(selectedId) === h.id ? ' selected' : ''}>${esc(h.name)}</option>`).join('');

  const preview = combatPreviewData();

  return `
    <div class="admin-card">
      <div class="admin-card-title">⚔️ Battle rules</div>
      <div class="admin-help-row">${helpLink(HELP_TOPICS.battle, 'How hit points, strikes and prizes work, start to finish')}</div>
      <div class="admin-mini">
        On Battle Day, every house's <b>hit points (HP)</b> refill all the way to full — HP has nothing to do with points, it is just what a strike removes during the fight. Before the battle, houses spend <b>points</b> in the 🔮 Magic Shop to buy weapons ahead of time; those purchases sit stored in each house's armoury until they're actually used in battle. During the fight, each strike removes <b>HP</b>, not points. When a house's HP reaches zero, that fight is over: the <b>winner takes a prize in points</b>, decided by the rule you choose below. <b>The loser never loses a single point</b> — a class is never punished for being ahead, or for losing a fight.
      </div>

      <label class="admin-flabel" style="margin-top:14px">Prize rule</label>
      <div class="admin-seg admin-theme-seg">${ruleButtons}</div>
      <div class="admin-mini">${esc(ruleBlurb)}</div>
      <div class="admin-warn-line">${ruleCaution}</div>
      <div style="margin-top:10px">${numberField}</div>

      <label class="admin-flabel" style="margin-top:20px">Punching down</label>
      <div class="admin-toggle-row">
        <button class="admin-toggle${c.punchingDown ? ' on' : ''}" data-action="combat-punchdown" role="switch" aria-checked="${c.punchingDown}"><span class="admin-toggle-knob"></span></button>
        <span class="admin-mini" style="margin:0">Allow attacking a house with FEWER points <span class="admin-faint">— off by default</span></span>
      </div>
      <div class="admin-mini">With this <b>off</b> (the default), a house may only attack a house that currently has <b>more</b> points than them. That default exists on purpose: without it, the leading class can farm the last-placed class every single week, which is exactly the outcome a classroom should avoid.</div>

      <label class="admin-flabel" style="margin-top:20px">Hit points</label>
      <div class="admin-two">
        <div>
          <label class="admin-flabel" for="admin-combat-hpbase">Starting HP (everyone begins here)</label>
          <input id="admin-combat-hpbase" class="admin-input" type="number" min="1" value="${esc(c.hpBase)}" />
        </div>
        <div>
          <label class="admin-flabel" for="admin-combat-hpper500">Bonus HP per 500 points held</label>
          <input id="admin-combat-hpper500" class="admin-input" type="number" min="0" value="${esc(c.hpPer500)}" />
        </div>
      </div>
      <div class="admin-mini">A house sitting on more points is a little tougher to knock out — a mild brake on everyone piling onto whoever is currently in the lead. HP refills to this maximum at the start of every Battle Day. Right now, on this computer:</div>
      <div id="admin-combat-hp-list" style="margin:8px 0 4px">${combatHpRowsHTML()}</div>

      <label class="admin-flabel" style="margin-top:20px" for="admin-combat-teacher">Your own scoring buttons on Battle Day</label>
      <input id="admin-combat-teacher" class="admin-input" type="number" min="1" value="${esc(c.teacherScore)}" />
      <div class="admin-mini">Along the bottom of the Battle Day screen there is a row with a <b>+</b> and a <b>−</b> button for each house, so you can award or deduct points yourself for how a class behaved during the fight — separate from anything the houses do to each other. This sets how many points those buttons are worth. It changes both buttons and both labels at once, so what you see is always what it gives. These are ordinary points: a deduction here still respects a house's shield or half-damage relic, exactly like the ± button in the top bar.</div>

      <label class="admin-flabel" style="margin-top:20px">Live prize preview</label>
      <div class="admin-two">
        <div>
          <label class="admin-flabel" for="admin-combat-attacker">Winner</label>
          <select id="admin-combat-attacker" class="admin-input">${houseOpts(combatPreviewSel.attacker)}</select>
        </div>
        <div>
          <label class="admin-flabel" for="admin-combat-defender">Defeated</label>
          <select id="admin-combat-defender" class="admin-input">${houseOpts(combatPreviewSel.defender)}</select>
        </div>
      </div>
      <div class="admin-preview">
        <span class="admin-preview-eyebrow">Live preview</span>
        <span class="admin-preview-label" id="admin-combat-preview-amount">${esc(preview.text)}</span>
      </div>
      <div class="admin-mini" id="admin-combat-preview-note">${esc(preview.note)}</div>
    </div>`;
}

// ===========================================================================
// TAB — BATTLE DAY (everything that only matters when houses are fighting:
// which rule set is active, prize rules, hit points, punching down, and the
// live shield/reduction board)
// ===========================================================================

// Which of the two complete rule sets is running right now. NOT cosmetic —
// switching swaps the whole Magic Shop for a different catalog at different
// prices and clears whatever every house is currently holding, so a tap here
// always goes through the same confirmation-modal pattern as every other
// destructive action in this file rather than switching instantly.
function renderCombatModeCard() {
  const store = ctxRef.store;
  const mode = store.getCombatMode();
  const rows = Object.entries(store.COMBAT_MODES).map(([id, def]) => `
    <div class="admin-shop-row">
      <div class="admin-q-main">
        <div class="admin-q-title">${mode === id ? '✅ ' : ''}${esc(def.label)}${mode === id ? ' <span class="admin-faint">— active now</span>' : ''}</div>
        <div class="admin-mini" style="margin:2px 0 0">${esc(def.blurb)}</div>
      </div>
      ${mode === id ? '' : `<button class="admin-btn admin-btn-primary" data-action="combat-mode-request" data-mode="${esc(id)}">Switch to ${esc(def.label)}</button>`}
    </div>`).join('');

  return `
    <div class="admin-card">
      <div class="admin-card-title">⚔️ Battle Day rules</div>
      <div class="admin-warn-line">Switching is a bigger deal than it looks — it is <b>not cosmetic</b>. It swaps the 🔮 Magic Shop for a completely different set of items at different prices, and it clears out anything every House is currently holding or has stockpiled. <b>Points, the ledger, quests, the planner and every other setting are left exactly as they are.</b></div>
      <div class="admin-q-list" style="margin-top:10px">${rows}</div>
    </div>`;
}

// The old hit-points prize/HP/punching-down card only means anything in 'hp'
// mode — Mr. D's rules don't use a prize roll or hit points at all. Rather
// than leave a form of controls that silently do nothing, this swaps it for a
// short explanation while 'duel' is active.
function renderBattleRulesGate() {
  const store = ctxRef.store;
  const mode = store.getCombatMode();
  if (mode === 'hp') return renderBattleRulesCard();
  const hp = store.COMBAT_MODES.hp;
  return `
    <div class="admin-card">
      <div class="admin-card-title">⚔️ Battle rules <span class="admin-faint">(Hit Points mode only)</span></div>
      <div class="admin-mini">Prize rules, starting HP and punching-down all live here, but <b>none of them do anything right now</b> — Mr. D's rules (the active rule set above) don't use hit points or a prize roll at all. Switch to <b>${esc(hp.label)}</b> above to see and edit these again.</div>
    </div>`;
}

function renderBattleDay() {
  return `
    <div class="admin-settings">
      ${renderCombatModeCard()}

      ${renderBattleRulesGate()}

      ${ctxRef.store.getCombatMode() === 'duel' ? duelStatePanelHTML() : shieldPanelHTML()}
    </div>`;
}

// The one place a version number lives. It is shown in Settings so a teacher on
// the phone can read it out — a git tag is invisible from the classroom.
const APP_VERSION = '1.01';

function renderSettings() {
  const store = ctxRef.store;
  const s = store.getSettings();
  const info = store.getTermInfo();
  const theme = s.theme || { mode: 'dark', seasonal: false };
  const mode = theme.mode === 'light' ? 'light' : 'dark';
  const seasonal = !!theme.seasonal;
  const apiKey = s.mapsApiKeyOverride || '';
  const termEvents = store.getEvents({ type: 'term-start' })
    .concat(store.getEvents({ type: 'term-end' }))
    .sort((a, b) => a.date.localeCompare(b.date));

  return `
    <div class="admin-settings">
      <div class="admin-card">
        <div class="admin-card-title">Term Timeline</div>
        <div class="admin-two">
          <div>
            <label class="admin-flabel" for="admin-term-start">Term start (Monday)</label>
            <input id="admin-term-start" class="admin-input" type="date" value="${esc(s.termStart)}" />
          </div>
          <div>
            <label class="admin-flabel" for="admin-term-weeks">Term length (weeks)</label>
            <input id="admin-term-weeks" class="admin-input" type="number" min="1" max="52" value="${esc(s.termWeeks)}" />
          </div>
        </div>
        <div class="admin-preview">
          <span class="admin-preview-eyebrow">Live preview</span>
          <span class="admin-preview-label" id="admin-term-preview">${esc(info.label)}</span>
        </div>
        <button class="admin-btn admin-btn-primary admin-btn-lg" data-action="settings-save">Save term settings</button>
        <div class="admin-hint" style="margin-top:.75rem">The top-bar term label and the Morning Dashboard update the moment you save.</div>
      </div>

      ${renderHousesCard()}

      ${renderScreenColoursCard()}

      ${renderScreenLayoutCard()}

      ${renderAwardPresetsCard()}

      ${renderDiceProphecyCard()}

      <div class="admin-card">
        <div class="admin-card-title">Term Start / End Markers</div>
        <div class="admin-mini">Read-only here — add or edit these on the 📅 Planner calendar.</div>
        <div class="admin-evt-list">
          ${termEvents.length ? termEvents.map((e) => {
            const t = TYPES[e.type];
            return `<div class="admin-evt admin-evt-static">
              <span class="admin-evt-dot" style="background:${t.outline ? 'transparent' : t.color};border:2px solid ${t.color};"></span>
              <div class="admin-evt-main">
                <div class="admin-evt-title">${esc(e.title || t.label)}</div>
                <div class="admin-evt-meta">${esc(e.date)} · ${t.label} · ${coreLabel(e.core)}</div>
              </div>
            </div>`;
          }).join('') : '<div class="admin-empty admin-empty-sm">No term markers planned yet.</div>'}
        </div>
      </div>

      <div class="admin-card">
        <div class="admin-card-title">Display &amp; Theme</div>

        <label class="admin-flabel">Appearance</label>
        <div class="admin-seg admin-theme-seg">
          <button class="admin-theme-opt${mode === 'dark' ? ' on' : ''}" data-action="theme-mode" data-mode="dark">🌙 Dark</button>
          <button class="admin-theme-opt${mode === 'light' ? ' on' : ''}" data-action="theme-mode" data-mode="light">☀️ Light</button>
        </div>

        <label class="admin-flabel">Seasonal theming</label>
        <div class="admin-toggle-row">
          <button class="admin-toggle${seasonal ? ' on' : ''}" data-action="theme-seasonal" role="switch" aria-checked="${seasonal}"><span class="admin-toggle-knob"></span></button>
          <span class="admin-mini" style="margin:0">Adds automatic seasonal accents to the board — leaves in fall, snow in winter…</span>
        </div>

        <label class="admin-flabel" for="admin-maps-key">Google Maps API key (optional)</label>
        <div class="admin-key-row">
          <input id="admin-maps-key" class="admin-input" type="text" value="${esc(apiKey)}" placeholder="AIza… (blank = use bundled key)" autocomplete="off" spellcheck="false" />
          <button class="admin-btn admin-btn-primary" data-action="maps-key-save">Save key</button>
        </div>
        <div class="admin-mini">Paste Mr. D's own key here so the app stops using the bundled one. Takes effect after refresh.</div>
        <details class="admin-details">
          <summary>How to get a key</summary>
          <ol class="admin-steps">
            <li>Go to <code>console.cloud.google.com</code> and create a new project.</li>
            <li>Enable both <b>Maps JavaScript API</b> and <b>Map Tiles API</b>.</li>
            <li>Open <b>Credentials → Create credentials → API key</b>.</li>
            <li>Restrict the key to <b>Websites</b> (HTTP referrers), then paste it above.</li>
          </ol>
        </details>
      </div>

      ${renderMusicCard()}

      ${renderSfxCard()}

      <div class="admin-card">
        <div class="admin-card-title">Backup &amp; Restore</div>
        <div class="admin-help-row">${helpLink(HELP_TOPICS.backups, 'What backups do, and how to restore one')}</div>

        <p class="admin-mini">There are two different ways this saves a file for you, and they cover different gaps — leaving <b>both</b> switched on is the safest setup:</p>
        <p class="admin-mini"><b>⬇️ The daily backup file</b> needs nothing from you and works in any browser — but it only saves once a school day, so at worst you'd lose that one day's points if something went wrong.</p>
        <p class="admin-mini" style="margin-bottom:16px"><b>🔄 The folder backup</b> saves within seconds of every single change, which is better protection — but it has to be set up once, only works in Chrome or Edge, and can occasionally need reconnecting after the browser updates.</p>

        <div class="admin-auto-head">⬇️ Daily backup file <span class="admin-faint">(on by default, no setup)</span></div>
        ${downloadBackupHTML()}

        <hr class="admin-hr" />

        <div class="admin-auto-head">🔄 Continuous folder backup <span class="admin-faint">(one-time setup, Chrome/Edge only)</span></div>
        ${autoBackupHTML()}

        <hr class="admin-hr" />

        <div class="admin-auto-head">Manual export / import</div>
        <div class="admin-mini">Save or restore the full classroom state — points, planner, quests, shop, settings, and destinations.</div>
        <div class="admin-backup-row">
          <button class="admin-btn admin-btn-lg" data-action="backup-export">⬇ Export backup</button>
          <button class="admin-btn admin-btn-lg" data-action="backup-import">⬆ Import backup</button>
          <input id="admin-import-file" type="file" accept="application/json,.json" hidden />
        </div>
        <div class="admin-mini" style="margin:10px 0 0">Media files (videos/images) live in the browser separately and are not included in any of these backups.</div>

        <hr class="admin-hr" />

        <div class="admin-auto-head">Using a backup file</div>
        <p class="admin-mini">Bringing one back in always happens right here, never anywhere else: tap <b>⬆ Import backup</b> above and choose the file (or <b>Restore from folder…</b> if a folder is connected). It replaces everything currently on screen, so it always asks you to confirm first — nothing is lost by accident.</p>
        <p class="admin-mini" style="margin-bottom:0">Moving to a different computer some day? The file to bring with you is the newest one named <code>mrd-backup-YYYY-MM-DD.json</code> — either the one already sitting in this computer's <b>Downloads</b> folder, or the newest dated file in your connected backup folder. Copy it across any way that's easy (a memory stick, emailing it to yourself, a Google Drive folder), then use <b>Import backup</b> on the new computer.</p>
      </div>

      ${renderSampleDataCard()}

      ${renderLockCard()}

      <div class="admin-card admin-danger${dangerOpen ? ' open' : ''}">
        <button class="admin-danger-toggle" data-action="danger-toggle">
          <span>⚠️ Danger Zone</span>
          <span class="admin-danger-caret">${dangerOpen ? '▾' : '▸'}</span>
        </button>
        ${dangerOpen ? `
          <div class="admin-danger-body">
            <p class="admin-danger-text">Reset <b>all points, transactions, planner events, settings and Place-of-the-Week profiles</b> to factory defaults. This cannot be undone.</p>
            <button class="admin-btn admin-btn-lg admin-btn-nuke" data-action="reset-open">Reset all points &amp; data…</button>
          </div>` : ''}
      </div>

      <div class="admin-version">
        Mr. D's Classroom OS <b>v${esc(APP_VERSION)}</b>
        <span class="admin-version-hint">If you ever need to ask for help with something odd, read this number out — it says exactly which version you are running.</span>
      </div>
    </div>`;
}

// ----- background music (quiet per-screen ambient loops) -------------------

// Screens a teacher would plausibly want music on. Place of the Week plays
// its own flight music and presentation audio, so it's deliberately left out.
// Battle Day IS assignable — it just plays under the battle, and the opening
// voice line still comes through on top of it. Reads the live module registry
// when available so a future module shows up here automatically; falls back
// to the known screen list if the registry isn't wired for some reason.
const AMBIENT_EXCLUDE = new Set(['admin', 'potw']);
const AMBIENT_SCREENS_FALLBACK = [
  { id: 'dashboard', label: 'Morning Dashboard' },
  { id: 'council',   label: 'Council of Four' },
  { id: 'houses',    label: 'Records' },
  { id: 'quests',    label: 'Quests' },
  { id: 'shop',      label: 'Magic Shop' },
  { id: 'dice',      label: 'Die of Destiny' },
  { id: 'battle',    label: 'Battle Day' },
];

// The teacher's actual files in /music, as of this build. A static site can't
// list a directory, so this is a hard-coded convenience list for the
// dropdown — the free-text field next to it still takes anything else he
// adds to the folder later.
const SUGGESTED_MUSIC_FILES = [
  'music/breath-of-fate.mp3',
  'music/bridging-the-path.mp3',
  'music/honor-roll.mp3',
  'music/looming-roll.mp3',
  'music/storming-the-gates.mp3',
  'music/the-grand-pavilion.mp3',
  'music/the-long-road-ahead.mp3',
  'music/travel-zoom.mp3',
  'music/vanguard-charge.mp3',
];

// One-tap starter mapping so the teacher can hear the whole thing immediately,
// then tweak from there. 60% for the "working" screens he wants barely-there;
// 100% for the screens he wants more present.
const SUGGESTED_MUSIC_SETUP = [
  { screen: 'dashboard', src: 'music/bridging-the-path.mp3',   volume: 0.6 },
  { screen: 'council',   src: 'music/the-grand-pavilion.mp3',  volume: 1 },
  { screen: 'houses',    src: 'music/honor-roll.mp3',          volume: 0.6 },
  { screen: 'quests',    src: 'music/the-long-road-ahead.mp3', volume: 1 },
  { screen: 'shop',      src: 'music/breath-of-fate.mp3',      volume: 0.6 },
  { screen: 'dice',      src: 'music/looming-roll.mp3',        volume: 1 },
  { screen: 'battle',    src: 'music/storming-the-gates.mp3',  volume: 1 },
];

// A screen's tracks entry is either a plain path (legacy) or { src, volume }
// (see js/core/ambient.js `entryFor`) — the per-screen volume is a multiplier
// (0–1) of the master volume. Read defensively so either shape renders fine.
function screenTrackEntry(tracks, id) {
  const raw = (tracks || {})[id];
  if (!raw) return { src: '', volume: 1 };
  if (typeof raw === 'string') return { src: raw, volume: 1 };
  const volume = Number.isFinite(Number(raw.volume)) ? Math.min(1, Math.max(0, Number(raw.volume))) : 1;
  return { src: raw.src || '', volume };
}

// Assign (or clear) a screen's track. A newly-assigned track defaults to
// 100% — an existing per-screen level is preserved when just the file changes.
function setScreenTrack(screen, src) {
  const store = ctxRef.store;
  const ambient = store.getAmbient();
  const tracks = { ...ambient.tracks };
  if (!src) { delete tracks[screen]; store.updateAmbient({ tracks }); return; }
  const prev = screenTrackEntry(tracks, screen);
  tracks[screen] = { src, volume: prev.src ? prev.volume : 1 };
  store.updateAmbient({ tracks });
}

// Per-screen volume only — applies live, ambient.js re-reads settings on
// every store change so whatever is currently playing re-tunes immediately.
function setScreenVolume(screen, pct) {
  const store = ctxRef.store;
  const ambient = store.getAmbient();
  const entry = screenTrackEntry(ambient.tracks, screen);
  if (!entry.src) return;
  const tracks = { ...ambient.tracks, [screen]: { src: entry.src, volume: Math.min(1, Math.max(0, Number(pct) / 100)) } };
  store.updateAmbient({ tracks });
}

function applySuggestedMusicSetup() {
  const store = ctxRef.store;
  const ambient = store.getAmbient();
  const tracks = { ...ambient.tracks };
  SUGGESTED_MUSIC_SETUP.forEach(({ screen, src, volume }) => { tracks[screen] = { src, volume }; });
  store.updateAmbient({ tracks, enabled: true });
  renderBody({ force: true });
  toast('Suggested setup applied — tweak any track or level below.');
}

function ambientScreens() {
  try {
    const mods = ctxRef?.registry?.modules?.();
    if (Array.isArray(mods) && mods.length) {
      const list = mods
        .filter((m) => m?.id && !AMBIENT_EXCLUDE.has(m.id))
        .map((m) => ({ id: m.id, label: m.title || m.id }));
      if (list.length) return list;
    }
  } catch (e) { /* fall through to the static list */ }
  return AMBIENT_SCREENS_FALLBACK;
}

// The dropdown's suggested list: the hard-coded files actually in /music,
// plus anything already assigned to a screen (in case a custom file was typed
// in) and the flyover default. A static site can't list a directory, so the
// hard-coded list is the convenience — the free-text field still takes
// anything else the teacher adds to the folder later.
function knownMusicFiles() {
  const store = ctxRef.store;
  const { tracks } = store.getAmbient();
  const set = new Set(SUGGESTED_MUSIC_FILES);
  Object.values(tracks || {}).forEach((v) => {
    const src = v && typeof v === 'object' ? v.src : v;
    if (src) set.add(src);
  });
  if (CONFIG.POTW_FLYOVER_DEFAULT) set.add(CONFIG.POTW_FLYOVER_DEFAULT);
  return [...set].sort();
}

function musicErrEl(screen) { return el(`admin-music-err-${screen}`); }
function showMusicError(screen, msg) {
  const node = musicErrEl(screen);
  if (!node) return;
  node.textContent = msg;
  node.style.display = msg ? 'block' : 'none';
}

// Preview playback is a plain local Audio element we own and stop ourselves —
// never touches js/core/ambient.js, which keeps driving the real background
// loop untouched while a preview auditions.
//
// NOTE: we deliberately do NOT reset `el.src = ''` when stopping — per the
// HTML media spec, clearing src on a media element fires its OWN 'error'
// event, which would otherwise get picked up by that element's `fail`
// listener below and show a false "couldn't play that file" message after a
// perfectly successful preview. Detaching the listener before pausing, and
// leaving src alone, avoids that false positive; the element is simply
// dropped and garbage-collected.
function stopMusicPreview() {
  if (!musicPreview) return;
  const { el: a, fail } = musicPreview;
  musicPreview = null;
  try { if (fail) a.removeEventListener('error', fail); } catch (e) { /* detached */ }
  try { a.pause(); } catch (e) { /* detached */ }
}

function previewMusicTrack(screen) {
  stopMusicPreview();
  showMusicError(screen, '');
  const input = rootEl.querySelector(`.admin-music-path[data-screen="${screen}"]`);
  const src = input ? input.value.trim() : '';
  if (!src) { showMusicError(screen, 'Pick or type a file first.'); return; }
  const store = ctxRef.store;
  const ambient = store.getAmbient();
  // Preview at the screen's own level (relative to master) when previewing
  // the track that's actually assigned there, so the audition matches reality.
  const entry = screenTrackEntry(ambient.tracks, screen);
  const gain = entry.src === src ? entry.volume : 1;
  const audio = new Audio(src);
  audio.volume = Math.min(1, Math.max(0, (Number(ambient.volume) || 0) * gain));
  const fail = () => {
    if (musicPreview && musicPreview.el === audio) musicPreview = null;
    showMusicError(screen, "Couldn't play that file — check the name and that it's in /music.");
  };
  audio.addEventListener('error', fail);
  musicPreview = { el: audio, screen, fail };
  const p = audio.play();
  if (p && typeof p.catch === 'function') p.catch(fail);
  // A brief audition, not a full loop — stop itself after a few seconds.
  later(() => { if (musicPreview && musicPreview.el === audio) stopMusicPreview(); }, 6000);
}

function renderMusicCard() {
  const store = ctxRef.store;
  const ambient = store.getAmbient();
  const files = knownMusicFiles();
  const screens = ambientScreens();
  const volPct = Math.round((Number(ambient.volume) || 0) * 100);

  const rows = screens.map((sc) => {
    const entry = screenTrackEntry(ambient.tracks, sc.id);
    const cur = entry.src;
    const screenVolPct = Math.round(entry.volume * 100);
    const options = ['<option value="">Pick a known file…</option>']
      .concat(files.map((f) => `<option value="${esc(f)}"${f === cur ? ' selected' : ''}>${esc(f)}</option>`))
      .join('');
    const caveat = sc.id === 'battle'
      ? '<div class="admin-mini admin-music-caveat">⚔️ Plays under the battle — the opening voice line still comes through.</div>'
      : '';
    return `
      <div class="admin-music-row">
        <div class="admin-music-name">${esc(sc.label)}</div>
        <div class="admin-music-controls">
          <select class="admin-input admin-music-pick" data-screen="${sc.id}" aria-label="Pick a known file for ${esc(sc.label)}">${options}</select>
          <input class="admin-input admin-music-path" data-screen="${sc.id}" type="text" value="${esc(cur)}" placeholder="music/filename.mp3" aria-label="Track path for ${esc(sc.label)}" spellcheck="false" autocomplete="off" />
          <button class="admin-btn admin-btn-sm" data-action="music-preview" data-screen="${sc.id}">▶ Preview</button>
          <button class="admin-btn admin-btn-sm admin-btn-danger" data-action="music-clear" data-screen="${sc.id}">Clear</button>
        </div>
        <div class="admin-music-vol-row">
          <label class="admin-flabel admin-music-vol-label" for="admin-music-vol-${sc.id}">Level on this screen — <span id="admin-music-vol-num-${sc.id}">${screenVolPct}%</span> <span class="admin-faint">(relative to the master volume above)</span></label>
          <input id="admin-music-vol-${sc.id}" class="admin-input admin-music-screen-volume" data-screen="${sc.id}" type="range" min="0" max="100" step="1" value="${screenVolPct}" aria-label="Level on this screen for ${esc(sc.label)}"${cur ? '' : ' disabled'} />
        </div>
        ${caveat}
        <div class="admin-music-error" id="admin-music-err-${sc.id}" style="display:none"></div>
      </div>`;
  }).join('');

  return `
    <div class="admin-card">
      <div class="admin-card-title">🎵 Background music</div>
      <div class="admin-mini">Quiet music that loops while a screen is open, fading gently when you move between screens. Keep it subtle — it plays under everything else.</div>

      <label class="admin-flabel" style="margin-top:14px">Ambience</label>
      <div class="admin-toggle-row">
        <button class="admin-toggle${ambient.enabled ? ' on' : ''}" data-action="ambient-toggle" role="switch" aria-checked="${ambient.enabled}"><span class="admin-toggle-knob"></span></button>
        <span class="admin-mini" style="margin:0">Off by default — turn it on when you want quiet music behind a screen. It also follows the app's main sound switch, and pressing <b>M</b> anywhere mutes everything instantly.</span>
      </div>

      <label class="admin-flabel" for="admin-ambient-volume" style="margin-top:12px">Volume — <span id="admin-ambient-vol-label">${volPct}%</span></label>
      <input id="admin-ambient-volume" class="admin-input admin-music-volume" type="range" min="0" max="100" step="1" value="${volPct}" />

      <div class="admin-music-suggested">
        <button class="admin-btn admin-btn-accent admin-btn-block" data-action="music-suggested-open">✨ Suggested setup</button>
        <div class="admin-mini" style="margin-top:6px">One tap assigns a track and a starting level to every screen below, so you can hear it all right away — then tweak anything you like.</div>
      </div>

      <div class="admin-mini" style="margin-top:16px">Put your .mp3 files in the <code>music</code> folder next to <code>index.html</code>. Each row's dropdown suggests the files already in that folder — type a name instead for anything else. Files you add to the music folder later can be typed in by name.</div>

      <div class="admin-music-list">${rows}</div>

      <div class="admin-mini" style="margin-top:12px">🌍 Place of the Week plays its own flight music and presentation audio, so it doesn't take background music.</div>
    </div>`;
}

// ----- Sound effects (teacher recordings replacing the built-in synth cues) -
// One row per entry in store.SFX_SLOTS — always iterate the map, never
// hardcode the six, so a future slot the lead adds shows up here for free.
function renderSfxCard() {
  const store = ctxRef.store;
  const s = store.getSettings();
  const soundOn = s.soundEnabled !== false;

  const rows = Object.entries(store.SFX_SLOTS).map(([name, meta]) => {
    const cur = store.getSfx(name);
    const statusText = cur
      ? '🎙️ Using your recording'
      : (name === 'battlecry'
          ? '🤖 Not recorded yet — read aloud by the computer’s speech voice'
          : '🔊 Using the built-in sound');
    const caveat = name === 'battlecry'
      ? `<div class="admin-mini admin-music-caveat">🗣️ This one has no built-in beep to fall back on — it's a spoken line, and a synthesized beep would be worse than nothing. Until you record it, the app reads it aloud in the computer's own speech voice; recording one here replaces that robot voice with yours.</div>`
      : '';
    return `
      <div class="admin-music-row">
        <div class="admin-music-name">${esc(meta.label)} <span class="admin-faint">— ${statusText}</span></div>
        <div class="admin-mini" style="margin:0 0 8px">${esc(meta.hint)}</div>
        <div class="admin-key-row">
          <input class="admin-input admin-sfx-path" data-sfx="${esc(name)}" type="text" value="${esc(cur)}" placeholder="sfx/${esc(name)}.mp3" aria-label="File for ${esc(meta.label)}" spellcheck="false" autocomplete="off" />
          <button class="admin-btn admin-btn-sm" data-action="sfx-test" data-sfx="${esc(name)}">▶ Test</button>
          <button class="admin-btn admin-btn-sm admin-btn-danger" data-action="sfx-reset" data-sfx="${esc(name)}"${cur ? '' : ' disabled'}>Reset</button>
        </div>
        ${caveat}
      </div>`;
  }).join('');

  return `
    <div class="admin-card">
      <div class="admin-card-title">🔊 Sound effects</div>
      <div class="admin-help-row">${helpLink(HELP_TOPICS.sfx, 'Recording your own sounds, step by step')}</div>
      ${!soundOn ? `<div class="admin-warn-line">🔇 <b>The master sound switch is currently OFF</b> (the speaker icon in the top bar, or press <b>M</b>). <b>▶ Test</b> below will stay silent until you turn it back on — that's the app correctly honouring the switch, not a bug. Typing and saving a file path still works fine either way, and it will play normally once sound is back on.</div>` : ''}
      <div class="admin-mini">Swap any of the app's built-in beeps — or the spoken Battle Day line — for your own recording. A phone voice memo is all you need; no editing software or special equipment required. Drop <b>.mp3</b> or <b>.m4a</b> files straight into the <code>sfx</code> folder that ships right next to <code>index.html</code>, then type the path into a row below (e.g. <code>sfx/battle-cry.mp3</code>) and tap <b>▶ Test</b> to hear it exactly as the class will hear it — this plays through the app's own sound, not a preview. Keep every clip <b>short</b>, since these fire in the middle of play: a second or two is plenty for the quick cues (sword clash, blocked hit, points chime, dice rattle), and up to about three seconds for the war cry or the fanfare. Anything you leave blank simply keeps working exactly as it does today — no sound goes missing just because a file hasn't been recorded yet.</div>
      <div class="admin-music-list">${rows}</div>
      <div class="admin-mini" style="margin-top:12px">📁 <b>These recordings are not included in your backup .json.</b> Just like your videos and images, they're plain files that live in the <code>sfx</code> folder rather than inside the app's saved data, so exporting or restoring a backup never touches them. Keep your own copies somewhere safe — the same place you keep copies of your videos — in case you ever reinstall the app or move it to a new computer.</div>
    </div>`;
}

// ----- Aegis shields (teacher oversight of a time-based effect) -------------
function fmtRemaining(ms) {
  const mins = Math.max(0, Math.round(ms / 60000));
  const h = Math.floor(mins / 60);
  const m = mins % 60;
  if (h && m) return `${h}h ${m}m left`;
  if (h) return `${h}h left`;
  return `${m}m left`;
}

// Tick the "3h 12m left" texts in place; re-render only when one actually expires.
function updateShieldTimes() {
  if (!rootEl || !ctxRef) return;
  const store = ctxRef.store;
  const spans = [...rootEl.querySelectorAll('.admin-def-time[data-house][data-kind]')];
  if (!spans.length) return;
  let expired = false;
  for (const s of spans) {
    const id = Number(s.dataset.house);
    const ms = s.dataset.kind === 'shield' ? store.shieldRemainingMs(id) : store.reductionRemainingMs(id);
    if (ms <= 0) { expired = true; continue; }
    s.textContent = fmtRemaining(ms);
  }
  if (expired) renderBody({ force: true });
}

// Both time-based defenses in one place: full shields and damage reductions.
// Always lists all four houses (not just the ones currently protected) so the
// card never renders as inert text-only — a house with nothing active still
// gets its own row, saying so plainly, rather than being silently omitted.
function shieldPanelHTML() {
  const store = ctxRef.store;
  const rows = Object.values(store.HOUSES).map((house) => ({
    house,
    shield: store.shieldRemainingMs(house.id),
    reduce: store.reductionRemainingMs(house.id),
  }));

  const defRow = (house, kind, ms) => `
    <div class="admin-def-line">
      <span class="admin-shield-emoji">${kind === 'shield' ? '🛡️' : '🕵️'}</span>
      <div class="admin-q-main">
        <div class="admin-def-name">${kind === 'shield' ? 'Shield — blocks every strike while it lasts' : 'Damage halved — every strike does half while it lasts'}</div>
        <div class="admin-q-desc"><span class="admin-def-time" data-house="${house.id}" data-kind="${kind}">${esc(fmtRemaining(ms))}</span></div>
      </div>
      <button class="admin-btn admin-btn-sm admin-btn-danger" data-action="${kind === 'shield' ? 'shield-clear' : 'reduction-clear'}" data-house="${house.id}">Clear</button>
    </div>`;

  return `
    <div class="admin-card">
      <div class="admin-card-title">🛡️ Active Defenses</div>
      <div class="admin-mini">
        A house can be protected two ways going into a fight: a <b>Shield</b> (bought in the Magic Shop, or won) blocks <b>every</b> strike against that house completely — the house loses no HP at all, as if the attacks never landed — and it keeps doing that until its time runs out. It is not used up by blocking; the countdown beside it is the only thing that ends it. <b>Damage halved</b> (usually a Mythic reward from a natural 20) cuts the HP lost in half on every strike for as long as it is active, instead of blocking outright. Neither one does anything to points directly, and neither stops a <b>Pierce</b> weapon, which always gets through in full no matter what a house has active. This board shows, house by house, exactly what is protecting them right now — live, updating on its own. If a class activated one by mistake, or a fight already happened and you want to reset before the next one, tap <b>Clear</b> to end it early. Nothing spent on it is refunded; it just stops working from that moment on.
      </div>
      <div class="admin-shield-list">${rows.map(({ house, shield, reduce }) => {
        const lines = [];
        if (shield > 0) lines.push(defRow(house, 'shield', shield));
        if (reduce > 0) lines.push(defRow(house, 'reduce', reduce));
        const body = lines.length
          ? `<div class="admin-def-lines">${lines.join('')}</div>`
          : `<div class="admin-mini" style="margin:0">No shield or damage reduction active — a strike against ${esc(house.name)} right now would land at full strength.</div>`;
        return `
        <div class="admin-shield-row" style="--house:${house.accent}">
          <div class="admin-def-house" style="color:${house.accent}">${esc(house.name)}</div>
          ${body}
        </div>`;
      }).join('')}</div>
    </div>`;
}

// The duel-mode equivalent of the Active Defenses board. Mr. D's rules have no
// hit points, shields or Pierce weapons, so that panel described nothing he can
// see; what he actually needs to undo here is a freeze, a raised Shroud, and a
// mis-tapped purchase. Every one of those was previously impossible to fix
// without a full reset.
function duelStatePanelHTML() {
  const store = ctxRef.store;
  const cat = store.getShopItems();
  const nameOf = (id) => (cat.find((c) => c.id === id) || {}).name || id;
  const emojiOf = (id) => (cat.find((c) => c.id === id) || {}).emoji || '\u2728';

  const rowsHtml = Object.values(store.HOUSES).map((house) => {
    const lines = [];
    if (store.isFrozen(house.id)) {
      const ts = store.frozenUntil(house.id);
      const until = ts ? new Date(ts).toLocaleDateString(undefined, { weekday: 'long', month: 'short', day: 'numeric' }) : '';
      lines.push(`
        <div class="admin-def-line">
          <span class="admin-shield-emoji">\u2744\ufe0f</span>
          <div class="admin-q-main">
            <div class="admin-def-name">Frozen \u2014 cannot earn points, and cannot attack</div>
            <div class="admin-q-desc">Thaws on its own ${esc(until ? `on ${until}` : 'shortly')}. They can still be attacked and can still lose points in the meantime.</div>
          </div>
          <button class="admin-btn admin-btn-sm admin-btn-danger" data-action="duel-thaw" data-house="${house.id}">Un-freeze</button>
        </div>`);
    }
    if (store.isShrouded(house.id)) {
      const ts = store.shroudedUntil(house.id);
      const until = ts ? new Date(ts).toLocaleDateString(undefined, { weekday: 'long', month: 'short', day: 'numeric' }) : '';
      lines.push(`
        <div class="admin-def-line">
          <span class="admin-shield-emoji">\ud83c\udf2b\ufe0f</span>
          <div class="admin-q-main">
            <div class="admin-def-name">Shrouded \u2014 no Stone of Seeing can look at them</div>
            <div class="admin-q-desc">Lifts on its own ${esc(until ? `on ${until}` : 'shortly')}.</div>
          </div>
          <button class="admin-btn admin-btn-sm admin-btn-danger" data-action="duel-unshroud" data-house="${house.id}">Lower it</button>
        </div>`);
    }
    const inv = store.getInventory(house.id);
    if (inv.length) {
      lines.push(`<div class="admin-inv-grid">${inv.map(({ item, count }) => `
        <div class="admin-inv-chip">
          <span class="admin-inv-emoji">${esc(emojiOf(item.id))}</span>
          <span class="admin-inv-name">${esc(nameOf(item.id))}${count > 1 ? ` \u00d7${count}` : ''}</span>
          <button class="admin-btn admin-btn-sm admin-btn-danger" data-action="duel-take-item"
            data-house="${house.id}" data-item="${esc(item.id)}" title="Take one back">Take back</button>
        </div>`).join('')}</div>`);
    }
    const body = lines.length ? `<div class="admin-def-lines">${lines.join('')}</div>`
      : `<div class="admin-mini" style="margin:0">Nothing held and nothing active \u2014 ${esc(house.name)} is holding no items, is not frozen and is not shrouded.</div>`;
    return `
      <div class="admin-shield-row" style="--house:${house.accent}">
        <div class="admin-def-house" style="color:${house.accent}">${esc(house.name)}</div>
        ${body}
      </div>`;
  }).join('');

  return `
    <div class="admin-card">
      <div class="admin-card-title">\u2694\ufe0f House status &amp; holdings</div>
      <div class="admin-mini">
        Everything a house is currently carrying or currently suffering, and a way to undo any of it. <b>Frozen</b> means the Legendary Ice Axe landed on them: they cannot earn points and cannot attack until it lifts \u2014 but they can still be attacked and can still lose points, so being frozen is a punishment and not a hiding place. The freeze counts <b>school days</b> and skips weekends, so a roll of 6 can run more than a week of real time; if that turns out to be too harsh, tap <b>Un-freeze</b> and they can score again immediately. <b>Shrouded</b> means they spent a Shroud of Secrecy: any Stone of Seeing used against them shows nothing at all (and is still used up). Below that is every item each house is holding. If a class bought the wrong thing, or you handed one out by mistake, tap <b>Take back</b> to remove one \u2014 the points they paid are <b>not</b> refunded automatically, so if you meant to undo the purchase entirely, give the points back with the \u00b1 button as well.
      </div>
      <div class="admin-shield-list">${rowsHtml}</div>

      <label class="admin-flabel" style="margin-top:20px">Who may attack whom</label>
      <div class="admin-toggle-row">
        <button class="admin-toggle${store.getCombat().duelPunchDown !== false ? ' on' : ''}"
          data-action="duel-punchdown" role="switch"
          aria-checked="${store.getCombat().duelPunchDown !== false}"><span class="admin-toggle-knob"></span></button>
        <span class="admin-mini" style="margin:0">Allow attacking a house with FEWER points <span class="admin-faint">— on by default</span></span>
      </div>
      <div class="admin-mini">Leave this <b>on</b> and any house may attack any other, whatever the standings say — which is how Mr. D plays it. Turn it <b>off</b> and a house may only attack one that currently has <b>more</b> points than them, which stops the leading class farming the last-placed class week after week. Be warned that switching it off also means the house in first place cannot attack at all until somebody overtakes them.</div>
    </div>`;
}

// Upsert an auto-managed event keyed by its `auto` flag (so we move/replace the
// existing marker instead of stacking duplicates). patch === null removes it.
function upsertAuto(flag, patch) {
  const store = ctxRef.store;
  const ex = store.getState().planner.events.find((e) => e.auto === flag);
  if (patch === null) { if (ex) store.removeEvent(ex.id); return; }
  if (ex) store.updateEvent(ex.id, patch);
  else store.addEvent({ auto: flag, core: 'all', ...patch });
}

function syncTermMarkers(termStart, termWeeks) {
  const startD = parseYMD(termStart);
  const endD = addDays(startD, termWeeks * 7 - 3); // Friday of the last week
  upsertAuto('term-start', { type: 'term-start', date: termStart, title: 'Term begins' });
  upsertAuto('term-end', { type: 'term-end', date: ymd(endD), title: 'Term ends' });
}

function saveSettings() {
  const store = ctxRef.store;
  const termStart = el('admin-term-start').value || store.getSettings().termStart;
  let termWeeks = Number(el('admin-term-weeks').value);
  if (!Number.isFinite(termWeeks) || termWeeks < 1) termWeeks = 9;
  termWeeks = Math.min(52, Math.round(termWeeks));
  store.updateSettings({ termStart, termWeeks });
  syncTermMarkers(termStart, termWeeks);
  toast('Term settings saved — markers placed on the calendar.');
  renderBody({ force: true });   // explicit save must repaint even if still focused
}

function openResetModal() {
  const m = el('admin-modal-root');
  m.innerHTML = `
    <div class="admin-modal-bg" data-action="modal-close"></div>
    <div class="admin-modal admin-modal-danger">
      <div class="admin-modal-head">
        <div class="admin-modal-title">⚠️ Reset everything</div>
        <button class="admin-btn admin-btn-icon" data-action="modal-close" aria-label="Close">✕</button>
      </div>
      <div class="admin-modal-body">
        <p class="admin-modal-lead">This wipes all points, transactions, planner events, settings and POTW profiles. There is no undo.</p>
        <label class="admin-flabel" for="admin-reset-confirm">Type <b class="admin-nuke-word">RESET</b> to confirm</label>
        <input id="admin-reset-confirm" class="admin-input" type="text" autocomplete="off" placeholder="RESET" />
      </div>
      <div class="admin-modal-foot">
        <button class="admin-btn admin-btn-lg" data-action="modal-close">Cancel</button>
        <button class="admin-btn admin-btn-lg admin-btn-nuke" data-action="reset-confirm" disabled>Reset all data</button>
      </div>
    </div>`;
  const input = el('admin-reset-confirm');
  const btn = m.querySelector('[data-action="reset-confirm"]');
  input.addEventListener('input', () => { btn.disabled = input.value.trim() !== 'RESET'; });
  input.focus();
}

function doReset() {
  ctxRef.store.resetAll();
  closeModal();
  activeTab = 'settings';
  dangerOpen = false;
  cal.year = new Date().getFullYear();
  cal.month = new Date().getMonth();
  renderBody();
  toast('All data reset to defaults.');
}

// ----- backup & restore (full localStorage state as JSON) -----
function exportBackup() {
  const raw = localStorage.getItem(CONFIG.STORAGE_KEY) || JSON.stringify(ctxRef.store.getState());
  let pretty = raw;
  try { pretty = JSON.stringify(JSON.parse(raw), null, 2); } catch (e) {}
  const blob = new Blob([pretty], { type: 'application/json' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = `mrd-backup-${todayStr()}.json`;
  document.body.appendChild(a);
  a.click();
  a.remove();
  later(() => URL.revokeObjectURL(url), 2000);
  toast('Backup exported.');
}

function importBackup(file) {
  const reader = new FileReader();
  reader.onload = () => {
    let data;
    try { data = JSON.parse(reader.result); } catch (e) { toast('That file is not valid JSON.'); return; }
    if (!data || typeof data !== 'object' || !('version' in data) || !('transactions' in data)) {
      toast('This does not look like a Classroom OS backup.');
      return;
    }
    openConfirm('Restore backup?', 'This replaces ALL current data (points, planner, quests, shop, settings, destinations) with the backup. This cannot be undone.', () => {
      try {
        localStorage.setItem(CONFIG.STORAGE_KEY, JSON.stringify(data));
        location.reload();
      } catch (e) { toast('Restore failed: ' + e.message); }
    }, { yesLabel: 'Replace & reload' });
  };
  reader.onerror = () => toast('Could not read that file.');
  reader.readAsText(file);
}

// ----- sample data (Settings tab — demoing on a machine that starts empty) --
// A brand-new machine has nothing on it, which makes it hard to show anyone
// — including Mr. D himself — what a busy term actually looks like. This
// builds four invented weeks of activity and writes it the same way a backup
// restore does: straight to localStorage, then a reload. See js/core/sampledata.js.
function renderSampleDataCard() {
  return `
    <div class="admin-card">
      <div class="admin-card-title">🧪 Sample Data</div>
      <div class="admin-mini">A brand-new computer starts completely empty, which makes it hard to show anyone — including yourself — what a full, busy term actually looks like. This button fills in about four weeks of realistic-looking activity: quiz scores, quest completions, Magic Shop purchases, dice rolls, and an events calendar with dates both before and after today — so every screen in the app has something real to look at.</div>
      <div class="admin-mini"><b>This is invented sample data, not your real class.</b> It exists only so you can explore a fully populated app and then clear it out. Loading it replaces everything currently on screen, exactly like restoring a backup, so it asks you to confirm first. When you're ready to start your real term, use Reset in the Danger Zone below.</div>
      <button class="admin-btn admin-btn-lg admin-btn-primary" data-action="load-sample-data">🧪 Load sample data</button>
    </div>`;
}

function loadSampleData() {
  openConfirm(
    'Load sample data?',
    'This fills the app with about four weeks of invented activity — points, quests, Magic Shop purchases, dice rolls and a full events calendar — so every screen has something populated to look at. It is sample data only, not your real class. Loading it replaces everything currently on screen, exactly like restoring a backup file — nothing you have entered for real is kept. This cannot be undone, though you can Reset afterward to start clean.',
    () => {
      try {
        const sample = buildSampleState();
        localStorage.setItem(CONFIG.STORAGE_KEY, JSON.stringify(sample));
        location.reload();
      } catch (e) { toast('Could not load sample data: ' + e.message); }
    },
    { danger: false, yesLabel: 'Load sample data' },
  );
}

// ----- automatic file-based backup (js/core/backup.js) -----
function relTime(ts) {
  if (!ts) return 'not yet';
  const s = Math.floor((Date.now() - ts) / 1000);
  if (s < 5) return 'just now';
  if (s < 60) return `${s}s ago`;
  const m = Math.floor(s / 60); if (m < 60) return `${m}m ago`;
  const h = Math.floor(m / 60); if (h < 24) return `${h}h ago`;
  return `${Math.floor(h / 24)}d ago`;
}

function backupStatusLine(bs) {
  if (bs.lastError && !bs.connected) return `<span class="admin-auto-dot warn"></span> ${esc(bs.lastError)}`;
  const err = bs.lastError ? ` <span class="admin-faint">(last issue: ${esc(bs.lastError)})</span>` : '';
  return `<span class="admin-auto-dot ok"></span> Auto-saving to folder — last saved ${esc(relTime(bs.lastSaveTs))}${err}`;
}

function autoBackupHTML() {
  const bs = backup.status();
  if (!bs.supported) {
    return '<div class="admin-auto-note admin-auto-warn">⚠️ Automatic backup needs Chrome or Edge — the manual export below still works everywhere.</div>';
  }
  if (bs.connected) {
    return `
      <div class="admin-auto-status" id="admin-backup-status">${backupStatusLine(bs)}</div>
      <div class="admin-backup-row">
        <button class="admin-btn" data-action="backup-save-now">Save now</button>
        <button class="admin-btn" data-action="backup-restore-folder">Restore from folder…</button>
        <button class="admin-btn admin-btn-danger" data-action="backup-disconnect">Disconnect</button>
      </div>
      <div class="admin-mini" style="margin:8px 0 0">Folder: <code>${esc(bs.folderName || 'chosen folder')}</code>. Media files (videos/images) are too large for JSON and aren't included.</div>`;
  }
  if (bs.needsPermission) {
    return `
      <div class="admin-mini">A backup folder was chosen before but the browser needs permission again after the reload.</div>
      <div class="admin-backup-row"><button class="admin-btn admin-btn-primary" data-action="backup-connect">Reconnect backup folder…</button></div>`;
  }
  return `
    <div class="admin-mini">Pick a folder on this computer — every change is saved there automatically. Use a folder inside Documents, or a synced Google Drive / OneDrive folder for off-machine safety.</div>
    <div class="admin-backup-row"><button class="admin-btn admin-btn-primary" data-action="backup-connect">🔄 Connect backup folder…</button></div>`;
}

function updateBackupStatusLine() {
  const box = el('admin-backup-status');
  if (box && ctxRef) box.innerHTML = backupStatusLine(backup.status());
}

// ----- daily safety-net download (js/core/backup.js `downloadNow`) ----------
// The folder backup above is the better option, but it needs Chrome/Edge and
// a one-time setup. This is the floor under it: on by default, no setup, and
// it works in every browser — it just only saves once a day.
function downloadBackupHTML() {
  const bs = backup.status();
  const savedToday = !!bs.lastDownloadDate && bs.lastDownloadDate === todayStr();

  let statusLine;
  if (!bs.downloadEnabled) {
    statusLine = `<div class="admin-warn-line">This is turned off — nothing is being saved to Downloads right now. Leave it on unless the folder backup below is connected and working.</div>`;
  } else if (savedToday) {
    const when = bs.lastDownloadTs ? relTime(bs.lastDownloadTs) : 'earlier today';
    statusLine = `<div class="admin-ok-line">✓ Today's backup file has already been saved to Downloads (${esc(when)}).</div>`;
  } else {
    statusLine = `<div class="admin-mini" style="margin:0 0 10px">Not saved yet today. It saves itself the moment you next change anything — or tap the button below to do it right now.</div>`;
  }

  return `
    <div class="admin-toggle-row">
      <button class="admin-toggle${bs.downloadEnabled ? ' on' : ''}" data-action="backup-download-toggle" role="switch" aria-checked="${bs.downloadEnabled}"><span class="admin-toggle-knob"></span></button>
      <span class="admin-mini" style="margin:0">Once each school day, the first time something changes, save a backup file to Downloads automatically.</span>
    </div>
    ${statusLine}
    <div class="admin-backup-row">
      <button class="admin-btn" data-action="backup-download-now">💾 Save a backup now</button>
    </div>
    <div class="admin-mini" style="margin-top:10px">This lands in this computer's ordinary <b>Downloads</b> folder, named something like <code>mrd-backup-${esc(todayStr())}.json</code> — the same place any file you download normally ends up. There is no folder to choose and no permission to grant, and it works in any browser, not just Chrome or Edge.</div>`;
}

async function saveDownloadNow() {
  const before = backup.status();
  if (!before.downloadEnabled) {
    toast('Turn on the daily backup file above first, then tap this again.');
    return;
  }
  backup.downloadNow();
  renderBody();
  toast('Backup file saved to your Downloads folder.');
}

function toggleDownloadBackup() {
  const store = ctxRef.store;
  const cur = store.getSettings().backupDownload !== false;
  store.updateSettings({ backupDownload: !cur });
  renderBody();
  toast(`Daily backup file ${!cur ? 'on' : 'off'}.`);
}

// ----- Teacher PIN (js/core/lock.js) ----------------------------------------
// A classroom deterrent, not real security — see the honest note baked into
// the card itself. This module only ever calls the lock.* API; it never reads
// or writes settings.lock directly.
function resetLockUi() { lockUi = { mode: null, currentPin: '', newPin: '', confirmPin: '', error: '' }; }

function renderLockCard() {
  const enabled = lock.isEnabled();
  const s = ctxRef.store.getSettings();
  const minutes = Number.isFinite(Number(s.lock?.minutes)) ? Number(s.lock.minutes) : 15;
  const errLine = lockUi.error ? `<div class="admin-warn-line">⚠️ ${esc(lockUi.error)}</div>` : '';

  let body;
  if (!enabled) {
    body = `
      <p class="admin-mini">Puts a PIN in front of the Admin panel and point-award actions, so a student can't wander up to the board while you're away and start tapping. Nothing students do themselves — quests, the shop, the dice — is affected.</p>
      <p class="admin-mini">The boxes start filled in with <b>${esc(DEFAULT_PIN)}</b> as a suggestion — type over it with something of your own if you would rather. <b>The lock is off until you tap the button below.</b></p>
      ${errLine}
      <div class="admin-two">
        <div>
          <label class="admin-flabel" for="admin-lock-new">New PIN (4+ digits)</label>
          <input id="admin-lock-new" class="admin-input" type="password" inputmode="numeric" autocomplete="off" maxlength="12" value="${esc(lockUi.newPin)}" />
        </div>
        <div>
          <label class="admin-flabel" for="admin-lock-confirm">Confirm PIN</label>
          <input id="admin-lock-confirm" class="admin-input" type="password" inputmode="numeric" autocomplete="off" maxlength="12" value="${esc(lockUi.confirmPin)}" />
        </div>
      </div>
      <button class="admin-btn admin-btn-primary admin-btn-lg" data-action="lock-set">Turn on the lock</button>
    `;
  } else if (lockUi.mode === 'change') {
    body = `
      <div class="admin-mini">Enter your current PIN, then the new one twice.</div>
      ${errLine}
      <label class="admin-flabel" for="admin-lock-current">Current PIN</label>
      <input id="admin-lock-current" class="admin-input" type="password" inputmode="numeric" autocomplete="off" maxlength="12" value="${esc(lockUi.currentPin)}" />
      <div class="admin-two" style="margin-top:10px">
        <div>
          <label class="admin-flabel" for="admin-lock-new">New PIN (4+ digits)</label>
          <input id="admin-lock-new" class="admin-input" type="password" inputmode="numeric" autocomplete="off" maxlength="12" value="${esc(lockUi.newPin)}" />
        </div>
        <div>
          <label class="admin-flabel" for="admin-lock-confirm">Confirm new PIN</label>
          <input id="admin-lock-confirm" class="admin-input" type="password" inputmode="numeric" autocomplete="off" maxlength="12" value="${esc(lockUi.confirmPin)}" />
        </div>
      </div>
      <div class="admin-backup-row" style="margin-top:12px">
        <button class="admin-btn admin-btn-primary admin-btn-lg" data-action="lock-change-save">Save new PIN</button>
        <button class="admin-btn admin-btn-lg" data-action="lock-cancel">Cancel</button>
      </div>
    `;
  } else if (lockUi.mode === 'off') {
    body = `
      <div class="admin-mini">Enter the current PIN to turn the lock off.</div>
      ${errLine}
      <label class="admin-flabel" for="admin-lock-current">Current PIN</label>
      <input id="admin-lock-current" class="admin-input" type="password" inputmode="numeric" autocomplete="off" maxlength="12" value="${esc(lockUi.currentPin)}" />
      <div class="admin-backup-row" style="margin-top:12px">
        <button class="admin-btn admin-btn-lg admin-btn-danger" data-action="lock-off-save">Turn off the lock</button>
        <button class="admin-btn admin-btn-lg" data-action="lock-cancel">Cancel</button>
      </div>
    `;
  } else {
    body = `
      <p class="admin-mini">🔒 The lock is <b>on</b>. The Admin panel and point-award actions ask for the PIN after ${minutes} minute${minutes === 1 ? '' : 's'} without teacher activity.</p>
      <div class="admin-backup-row">
        <button class="admin-btn admin-btn-lg" data-action="lock-now">Lock now</button>
        <button class="admin-btn admin-btn-lg" data-action="lock-mode-change">Change PIN</button>
        <button class="admin-btn admin-btn-lg admin-btn-danger" data-action="lock-mode-off">Turn off the lock</button>
      </div>

      <label class="admin-flabel" style="margin-top:16px">Auto-relock after</label>
      <div class="admin-seg admin-theme-seg">
        ${[5, 15, 30, 60].map((m) => `<button class="admin-theme-opt${minutes === m ? ' on' : ''}" data-action="lock-minutes" data-minutes="${m}">${m} min</button>`).join('')}
      </div>
      <div class="admin-mini">After this long with no teacher activity, the board asks for the PIN again.</div>
    `;
  }

  const recoveryBox = enabled ? `
      <div class="admin-code admin-recovery-code" style="margin:14px 0;text-align:center">
        <div class="admin-flabel" style="margin-bottom:8px">🔑 Recovery code — write this down now and keep it in your desk</div>
        <div style="font-size:1.4rem;font-weight:800;letter-spacing:.25em;color:var(--color-text);user-select:all">${esc(lock.getRecoveryCode())}</div>
      </div>` : '';

  return `
    <div class="admin-card">
      <div class="admin-card-title">🔒 Teacher PIN</div>
      <div class="admin-help-row">${helpLink(HELP_TOPICS.lock, 'What the Teacher PIN does and doesn’t protect')}</div>
      ${body}
      ${recoveryBox}
      <hr class="admin-hr" />
      <p class="admin-mini"><b>Honest note:</b> this stops a student from walking up to the board and tapping around while you're not looking — that is genuinely all it is for. It is <b>not real security</b>: anyone who knows their way around a browser's developer tools can get past it in seconds, and it does not encrypt or protect any of the saved data. The recovery code above is stored as plain, readable text (not scrambled like the PIN) — that's exactly what makes it possible to find in a backup file, and it also means anyone holding that backup file can read it.</p>
      <details class="admin-details">
        <summary>Forgot the PIN?</summary>
        <ol class="admin-steps">
          <li>Write the recovery code down now, while you can still see it above, and keep it somewhere in your desk.</li>
          <li>Locked out at the board? On the PIN pad, tap <b>Forgot your PIN?</b>, then open your most recent backup <b>.json</b> file in any text editor and search it for the word <b>recovery</b>. Type that code in. The PIN turns off — nothing else changes and no points are lost.</li>
          <li>Last resort only, if there is truly no backup file to read the code from: clearing this browser's saved site data also clears the PIN — but it erases <b>everything else too</b>: every point, the planner, quests, the shop, and the whole term along with it.</li>
        </ol>
      </details>
    </div>`;
}

async function saveLockSet() {
  lockUi.newPin = el('admin-lock-new') ? el('admin-lock-new').value.trim() : '';
  lockUi.confirmPin = el('admin-lock-confirm') ? el('admin-lock-confirm').value.trim() : '';
  if (lockUi.newPin.length < 4) { lockUi.error = 'The PIN needs to be at least 4 digits.'; renderBody({ force: true }); return; }
  if (lockUi.newPin !== lockUi.confirmPin) { lockUi.error = 'Those two PINs don’t match.'; renderBody({ force: true }); return; }
  const ok = await lock.setPin(lockUi.newPin);
  if (!ok) { lockUi.error = 'The PIN needs to be at least 4 digits.'; renderBody({ force: true }); return; }
  resetLockUi();
  renderBody({ force: true });
  toast('Teacher PIN turned on.');
}

async function saveLockChange() {
  lockUi.currentPin = el('admin-lock-current') ? el('admin-lock-current').value.trim() : '';
  lockUi.newPin = el('admin-lock-new') ? el('admin-lock-new').value.trim() : '';
  lockUi.confirmPin = el('admin-lock-confirm') ? el('admin-lock-confirm').value.trim() : '';
  if (lockUi.newPin.length < 4) { lockUi.error = 'The new PIN needs to be at least 4 digits.'; renderBody({ force: true }); return; }
  if (lockUi.newPin !== lockUi.confirmPin) { lockUi.error = 'Those two new PINs don’t match.'; renderBody({ force: true }); return; }
  if (!(await lock.verify(lockUi.currentPin))) { lockUi.error = 'That current PIN is wrong.'; renderBody({ force: true }); return; }
  await lock.setPin(lockUi.newPin);
  resetLockUi();
  renderBody({ force: true });
  toast('Teacher PIN changed.');
}

async function saveLockOff() {
  lockUi.currentPin = el('admin-lock-current') ? el('admin-lock-current').value.trim() : '';
  const ok = await lock.clearPin(lockUi.currentPin);
  if (!ok) { lockUi.error = 'That PIN is wrong.'; renderBody({ force: true }); return; }
  resetLockUi();
  renderBody({ force: true });
  toast('Teacher PIN turned off.');
}

async function connectBackupFolder() {
  const ok = await backup.connectFolder();
  renderBody();
  const s = backup.status();
  if (ok) toast('Backup folder connected — auto-saving is on.');
  else if (s.lastError && s.lastError !== 'unsupported') toast('Could not connect: ' + s.lastError);
}

async function saveBackupNow() {
  await backup.writeNow();
  updateBackupStatusLine();
  const s = backup.status();
  toast(s.lastError ? 'Save failed: ' + s.lastError : 'Saved to the backup folder.');
}

async function restoreFromFolder() {
  const data = await backup.restoreLatest();
  if (!data) { toast(backup.status().lastError || 'Could not read a backup from the folder.'); return; }
  openConfirm('Restore from backup folder?', 'This replaces ALL current data with the folder\'s latest backup, then reloads. This cannot be undone.', () => {
    try { localStorage.setItem(CONFIG.STORAGE_KEY, JSON.stringify(data)); location.reload(); }
    catch (e) { toast('Restore failed: ' + e.message); }
  }, { yesLabel: 'Replace & reload' });
}

async function disconnectBackupFolder() {
  await backup.disconnect();
  renderBody();
  toast('Backup folder disconnected — auto-saving is off.');
}

// ===========================================================================
// TAB 3 — PLACE OF THE WEEK: intro video presets
// ===========================================================================
// The presets offered in every destination's "Which intro video?" dropdown
// (step 4 below). Managed here, once, instead of per-destination.
function renderVideoPresetsCard() {
  const store = ctxRef.store;
  const videos = store.getPotwVideoOptions();
  const rows = videos.map((v) => `
    <div class="admin-shop-row admin-video-row">
      <span class="admin-shop-thumb admin-video-thumb">🎬</span>
      <div class="admin-q-main">
        <div class="admin-q-title">${esc(v.label)}</div>
        <div class="admin-q-desc admin-video-url" title="${esc(v.url)}">${esc(v.url)}</div>
      </div>
      <div class="admin-q-row-actions">
        <button class="admin-btn admin-btn-icon" data-action="video-edit" data-id="${esc(v.id)}" aria-label="Edit">✏️</button>
        <button class="admin-btn admin-btn-icon admin-btn-danger" data-action="video-del" data-id="${esc(v.id)}" aria-label="Delete"
          ${videos.length <= 1 ? 'disabled title="Every destination needs at least one intro video to choose from — add another before deleting this one."' : ''}>🗑️</button>
      </div>
    </div>`).join('');

  return `
    <div class="admin-card">
      <div class="admin-card-title">🎬 Intro Video Presets</div>
      <div class="admin-mini">These are the choices offered in every destination's <b>“Which intro video?”</b> step below. Add as many as you like — each destination then picks its own.</div>
      <div class="admin-q-list" style="margin-top:10px">${rows || '<div class="admin-empty admin-empty-sm">No videos yet.</div>'}</div>
      <button class="admin-btn admin-btn-primary" style="margin-top:12px" data-action="video-new">+ Add a video</button>
    </div>`;
}

function openVideoForm(id) {
  const store = ctxRef.store;
  const v = id ? store.getPotwVideoOptions().find((x) => x.id === id) : null;
  videoForm = { id: v ? v.id : null, isNew: !v, label: v?.label || '', url: v?.url || '', saveError: null };
  renderVideoModal();
}

function renderVideoModal() {
  const f = videoForm;
  const m = el('admin-modal-root');
  m.innerHTML = `
    <div class="admin-modal-bg" data-action="video-close"></div>
    <div class="admin-modal">
      <div class="admin-modal-head">
        <div class="admin-modal-title">${f.isNew ? '🎬 Add a Video' : '🎬 Edit Video'}</div>
        <button class="admin-btn admin-btn-icon" data-action="video-close" aria-label="Close">✕</button>
      </div>
      <div class="admin-modal-body">
        <label class="admin-flabel" for="admin-video-label">Label <span class="admin-faint">(shown in the dropdown)</span></label>
        <input id="admin-video-label" class="admin-input" type="text" value="${esc(f.label)}" placeholder="Rock" />

        <label class="admin-flabel" for="admin-video-url" style="margin-top:12px">Video</label>
        <input id="admin-video-url" class="admin-input" type="text" value="${esc(f.url)}" placeholder="https://www.youtube.com/watch?v=… or videos/intro.mp4" spellcheck="false" autocomplete="off" />
        <div class="admin-mini" style="margin-top:6px">Paste a normal YouTube link (watch, share, or Shorts) and it's converted automatically — or type a site-relative path like <code>videos/intro.mp4</code>.</div>
        ${f.saveError ? `<div class="admin-warn-line admin-save-err">⚠️ ${esc(f.saveError)}</div>` : ''}
      </div>
      <div class="admin-modal-foot">
        <button class="admin-btn admin-btn-lg" data-action="video-close">Cancel</button>
        <button class="admin-btn admin-btn-primary admin-btn-lg" data-action="video-save">Save video</button>
      </div>
    </div>`;
  const l = el('admin-video-label'); if (l) l.focus();
}

function syncVideoFromDom() {
  if (!videoForm) return;
  const g = (id) => (el(id) ? el(id).value : '');
  videoForm.label = g('admin-video-label');
  videoForm.url = g('admin-video-url');
  videoForm.saveError = null;
}

function saveVideoForm() {
  syncVideoFromDom();
  const f = videoForm;
  const store = ctxRef.store;
  const label = f.label.trim();
  const rawUrl = f.url.trim();
  if (!label) { f.saveError = 'Give this video a label — it shows in the dropdown.'; renderVideoModal(); return; }
  if (!rawUrl) { f.saveError = 'Paste a YouTube link, or type a video file path.'; renderVideoModal(); return; }
  const looksYoutube = /youtube\.com|youtu\.be/i.test(rawUrl);
  const url = normalizeVideoUrl(rawUrl);
  if (looksYoutube && !/^https:\/\/www\.youtube\.com\/embed\//.test(url)) {
    f.saveError = "Couldn't find a video ID in that YouTube link. Copy the full link from the browser's address bar (or the Share button) and try again.";
    renderVideoModal();
    return;
  }
  const saved = store.saveIntroVideo({ id: f.id, label, url });
  if (!saved) { f.saveError = "Something here wasn't accepted — check the label and the video link."; renderVideoModal(); return; }
  const wasNew = f.isNew;
  videoForm = null;
  closeModal();
  renderBody({ force: true });
  toast(wasNew ? 'Video added.' : 'Video updated.');
}

function deleteVideoPreset(id) {
  const store = ctxRef.store;
  const list = store.getPotwVideoOptions();
  if (list.length <= 1) { toast("Can't delete the last video — every destination needs at least one intro option to choose from."); return; }
  const v = list.find((x) => x.id === id);
  const usedBy = Object.values(store.getPotwProfiles())
    .filter((p) => !p.videoUrl && (p.introVideoId || CONFIG.POTW_DEFAULT_VIDEO_ID) === id);
  const warn = usedBy.length
    ? ` ${usedBy.length} destination${usedBy.length === 1 ? '' : 's'} (${usedBy.map((p) => p.title).join(', ')}) currently use this one and will need a new video picked in their editor.`
    : '';
  openConfirm(`Delete video “${v ? v.label : ''}”?`, `This removes it from the dropdown.${warn}`, () => {
    store.deleteIntroVideo(id);
    renderBody();
    toast('Video deleted.');
  });
}

function renderPotw() {
  const store = ctxRef.store;
  const profiles = store.getPotwProfiles();
  const active = store.getActivePotwKey();
  const keys = Object.keys(profiles);

  const manual = store.getManualPotwKey();
  const videoOpts = store.getPotwVideoOptions();

  return `
    <div class="admin-potw">
      <div class="admin-potw-head">
        <div>
          <div class="admin-card-title" style="margin:0">Places of the Week</div>
          <div class="admin-mini" style="margin:4px 0 0">Set up a place for each week — the app switches to the new one automatically every Monday.</div>
          <div class="admin-help-row">${helpLink(HELP_TOPICS.potw, 'How to set up a destination')}</div>
        </div>
        <button class="admin-btn admin-btn-primary admin-btn-lg" data-action="potw-new">+ Add a Place of the Week</button>
      </div>

      ${renderVideoPresetsCard()}

      <div class="admin-potw-list">
        ${keys.length ? keys
          .slice()
          .sort((a, b) => (profiles[b].weekOf || '').localeCompare(profiles[a].weekOf || ''))
          .map((k) => {
          const pr = profiles[k];
          const isPlaying = k === active;
          const weekLine = pr.weekOf
            ? `<span class="admin-week-line">📅 Week of ${esc(weekRangeLabel(pr.weekOf))}</span>`
            : '<span class="admin-week-line none">📅 No week set — won\'t play automatically</span>';
          const vid = videoOpts.find((v) => v.id === (pr.introVideoId || 'rock'));
          // Wrapped so verifyPotwMedia() can flip it if this destination depends
          // on a stored video blob that no longer exists (no URL fallback).
          const reliesOnBlob = store.getPotwVideoUrl(pr) ? '0' : '1';
          const vidLine = `<span class="admin-video-check" data-key="${esc(k)}" data-relies="${reliesOnBlob}">${
            pr.videoUrl
              ? '<span class="admin-pres-tag">🎬 Custom video link</span>'
              : `<span class="admin-pres-tag">🎬 ${esc(vid ? vid.label : 'Rock')} intro</span>`
          }</span>`;
          return `
          <div class="admin-potw-card${isPlaying ? ' active' : ''}">
            <div class="admin-potw-top">
              <div class="admin-potw-info">
                <div class="admin-potw-title">${esc(pr.title)} ${isPlaying ? '<span class="admin-playing-badge">▶ Playing this week</span>' : ''}</div>
                <div class="admin-potw-sub">${esc(pr.subtitle || '')}</div>
                <div class="admin-potw-week">${weekLine}</div>
                <div class="admin-potw-meta">${vidLine} ${arrivalBadgeHTML(k, pr)}</div>
              </div>
              <div class="admin-potw-actions">
                <button class="admin-btn" data-action="potw-edit" data-key="${esc(k)}">Edit</button>
                <button class="admin-btn admin-btn-secondary" data-action="potw-testflight" data-key="${esc(k)}"
                  title="Preview the 3D flight to this spot — changes nothing">🧭 Test flight</button>
                <button class="admin-btn" data-action="potw-active" data-key="${esc(k)}"${manual === k ? ' disabled' : ''}
                  title="Override: play this one when no week matches today">${manual === k ? 'Fallback pick' : 'Play this one now'}</button>
                <button class="admin-btn admin-btn-danger" data-action="potw-delete" data-key="${esc(k)}"${manual === k ? ' disabled' : ''}
                  title="${manual === k ? 'This is the fallback pick — choose another first' : 'Delete'}">Delete</button>
              </div>
            </div>

            <div class="admin-pres-block">
              <div class="admin-va-title">📽️ Lesson Presentation <span class="admin-faint">— plays full-screen the moment you land</span></div>
              <div class="admin-arrival" data-arrival="${esc(k)}">${arrivalBadgeHTML(k, pr)}</div>
              <div class="admin-drop admin-pres-drop" data-presdrop="${esc(k)}" data-action="media-browse" title="Drop a PDF or click to browse">
                <input type="file" class="admin-file" data-presdrop="${esc(k)}" accept="application/pdf" hidden />
                <span class="admin-drop-prompt">⬇ Drop the lesson PDF here, or click to browse</span>
              </div>
              <div class="admin-mini" style="margin:8px 0 0">Quick PDF upload — offline-safe, but flattens animations &amp; video. For transitions, animations and embedded video, use <b>Edit → Lesson Presentation → Google Slides</b> instead.</div>
            </div>

            <div class="admin-assets-label admin-secondary">📎 Extra resources <span class="admin-faint">(handouts, images)</span></div>
            <div class="admin-mini" style="margin:0 0 6px">These appear on the Resources tab — they open as files, <b>not slides</b>.</div>
            <div class="admin-drop admin-assets-drop" data-assets="${esc(k)}" data-action="media-browse" title="Drop files or click to browse">
              <input type="file" class="admin-file" data-assets="${esc(k)}" accept="*/*" multiple hidden />
              <span class="admin-drop-prompt">⬇ Drop handouts &amp; images here, or click to browse (multiple)</span>
            </div>
            <div class="admin-assets" data-assets-list="${esc(k)}"><span class="admin-faint">Checking…</span></div>
          </div>`;
        }).join('') : '<div class="admin-empty">No places yet. Add your first one to get started.</div>'}
      </div>

      <div class="admin-card admin-files">
        <div class="admin-card-title">How the weekly switch works</div>
        <p class="admin-mini">Each place plays for the whole week you picked, Monday through Sunday, and the app moves to the next one on its own. If today isn't inside any place's week, the app plays whichever one you marked with <b>Play this one now</b>.</p>
        <p class="admin-mini">💾 Files you drop are stored <b>in this browser on this smartboard machine</b> — they aren't uploaded anywhere.</p>
      </div>
    </div>`;
}

// ---- week helpers (POTW scheduling) ----------------------------------------
// Any day the teacher picks is normalized to that week's MONDAY.
function mondayOfDate(dateStr) {
  const d = parseYMD(dateStr);
  const dow = (d.getDay() + 6) % 7;         // Mon=0 … Sun=6
  d.setDate(d.getDate() - dow);
  return ymd(d);
}
function fmtDayShort(dateStr) {
  return parseYMD(dateStr).toLocaleDateString(undefined, { weekday: 'short', month: 'short', day: 'numeric' });
}
// School week (Mon–Fri) for the card; the store's window itself runs Mon–Sun.
function weekRangeLabel(weekOf) {
  if (!weekOf) return '';
  return `${fmtDayShort(weekOf)} – ${fmtDayShort(ymd(addDays(parseYMD(weekOf), 4)))}`;
}
function fullWeekRangeLabel(weekOf) {
  if (!weekOf) return '';
  return `${fmtDayShort(weekOf)} – ${fmtDayShort(ymd(addDays(parseYMD(weekOf), 6)))}`;
}

// ---- Google Maps link → { lat, lng } ---------------------------------------
// Handles: @lat,lng,15z · ?q=lat,lng · !3d<lat>!4d<lng> · /place/…/@lat,lng ·
// a bare "lat, lng" paste. Short maps.app.goo.gl links carry no coordinates.
function parseMapsLink(raw) {
  const s = String(raw || '').trim();
  if (!s) return { ok: false, reason: 'empty' };
  if (/(maps\.app\.goo\.gl|goo\.gl\/maps)/i.test(s)) return { ok: false, reason: 'short' };

  const valid = (la, ln) => Number.isFinite(la) && Number.isFinite(ln) && Math.abs(la) <= 90 && Math.abs(ln) <= 180;
  const num = '(-?\\d+(?:\\.\\d+)?)';
  const tries = [
    new RegExp(`!3d${num}!4d${num}`),            // place data blob (most precise)
    new RegExp(`@${num},${num}`),                 // /@lat,lng,15z
    new RegExp(`[?&](?:q|query|ll|center|daddr)=${num},\\s*${num}`, 'i'),
    new RegExp(`^${num},\\s*${num}$`),            // bare "lat, lng"
  ];
  for (const re of tries) {
    const m = s.match(re);
    if (m) {
      const la = parseFloat(m[1]); const ln = parseFloat(m[2]);
      if (valid(la, ln)) return { ok: true, lat: la, lng: ln };
    }
  }
  return { ok: false, reason: 'parse' };
}

// Unmistakable "what happens on arrival" badge for a destination card.
// Rendered optimistically, then VERIFIED against IndexedDB by verifyPotwMedia()
// — backups carry the JSON flags but not the blobs, so a restored machine can
// have `presentation:{type:'pdf'}` with no PDF behind it.
function arrivalBadgeHTML(key, profile) {
  const pres = profile.presentation;
  if (pres?.type === 'pdf') {
    return `<span class="admin-arrival-badge ok" data-verify="pdf" data-key="${esc(key)}">▶ Presentation: PDF <span class="admin-pres-size" data-mkey="potw:${esc(key)}:slides.pdf"></span> — auto-plays on arrival</span>`;
  }
  if (pres?.type === 'images') {
    return `<span class="admin-arrival-badge ok" data-verify="images" data-key="${esc(key)}" data-count="${Number(pres.count) || 0}">▶ Presentation: ${pres.count || 0} slide${pres.count === 1 ? '' : 's'} — auto-plays on arrival</span>`;
  }
  if (pres?.type === 'gslides') {
    // A Google Slides deck is a URL — nothing to verify locally.
    return `<span class="admin-arrival-badge ok">▶ Presentation: Google Slides — auto-plays on arrival</span>`;
  }
  return '<span class="admin-arrival-badge none">No presentation attached</span>';
}

// Non-destructive integrity check: flip badges to a loud warning when the blob a
// profile claims is missing. NEVER clears profile fields — the teacher may be
// about to re-upload, and silently dropping their config would be worse.
async function verifyPotwMedia() {
  if (activeTab !== 'potw' || !rootEl) return;
  const badges = [...rootEl.querySelectorAll('.admin-arrival-badge[data-verify]')];
  for (const b of badges) {
    const key = b.dataset.key;
    let missing = false;
    let label = '';
    if (b.dataset.verify === 'pdf') {
      missing = !(await media.info(`potw:${key}:slides.pdf`));
      label = '⚠ Slides missing — re-upload the PDF';
    } else if (b.dataset.verify === 'images') {
      const have = (await media.list(`potw:${key}:slide:`)).length;
      missing = have === 0;
      if (!missing && have < Number(b.dataset.count || 0)) {
        // partial restore — some slides survived, some didn't
        if (b.isConnected) {
          b.classList.remove('ok'); b.classList.add('warn');
          b.textContent = `⚠ Only ${have} of ${b.dataset.count} slides found — re-upload the deck`;
        }
        continue;
      }
      label = '⚠ Slides missing — re-upload the images';
    }
    if (missing && b.isConnected) {
      b.classList.remove('ok');
      b.classList.add('warn');
      b.textContent = label;
    }
  }

  // Intro-video blobs: only warn for destinations that actually rely on one
  // (no preset/legacy URL to fall back on).
  const store = ctxRef.store;
  const vids = [...rootEl.querySelectorAll('.admin-video-check[data-key]')];
  for (const v of vids) {
    const key = v.dataset.key;
    const profile = store.getPotwProfiles()[key];
    if (!profile) continue;
    const info = await media.info(`potw:${key}:video`);
    const hasUrlFallback = !!store.getPotwVideoUrl(profile);
    if (!info && v.dataset.relies === '1' && !hasUrlFallback && v.isConnected) {
      v.innerHTML = '<span class="admin-arrival-badge warn">⚠ Intro video file missing — re-upload it</span>';
    }
  }
}

// (The theme-song upload concept is retired — intro videos are presets now.)

function mediaBodyHTML(mkey, info) {
  if (info) {
    return `
      <div class="admin-drop-file">
        <span class="admin-drop-name" title="${esc(info.name)}">${esc(info.name)}</span>
        <span class="admin-drop-size">${humanSize(info.size)}</span>
      </div>
      <button class="admin-btn admin-btn-sm admin-btn-danger" data-action="media-remove" data-mkey="${esc(mkey)}">Remove</button>`;
  }
  return `<span class="admin-drop-prompt">⬇ Drop file here, or click to browse</span>`;
}

// Populate every drop zone's current state from IndexedDB (async, safe if the
// tab changed underneath — missing nodes are simply skipped).
async function refreshPotwMedia() {
  if (activeTab !== 'potw' || !rootEl) return;
  const bodies = [...rootEl.querySelectorAll('.admin-drop-body[data-mkey]')];
  for (const b of bodies) {
    const mkey = b.dataset.mkey;
    const info = await media.info(mkey);
    if (b.isConnected) b.innerHTML = mediaBodyHTML(mkey, info);
  }
  // presentation PDF size badges on the destination cards
  const sizes = [...rootEl.querySelectorAll('.admin-pres-size[data-mkey]')];
  for (const sp of sizes) {
    const info = await media.info(sp.dataset.mkey);
    if (sp.isConnected) sp.textContent = info ? `(${humanSize(info.size)})` : '';
  }
  // resource asset lists per destination
  const lists = [...rootEl.querySelectorAll('.admin-assets[data-assets-list]')];
  for (const box of lists) {
    const key = box.dataset.assetsList;
    const hasPres = !!ctxRef.store.getPotwProfiles()[key]?.presentation;
    const assets = (await media.list(`potw:${key}:asset:`)).sort((a, b) => a.key.localeCompare(b.key, undefined, { numeric: true }));
    if (!box.isConnected) continue;
    box.innerHTML = assets.length ? assets.map((a) => {
      const isPdf = a.type === 'application/pdf' || /\.pdf$/i.test(a.name || '');
      // A PDF sitting in resources with no presentation set is almost certainly
      // the lesson deck — offer a one-tap promotion.
      const promote = (isPdf && !hasPres)
        ? `<button class="admin-btn admin-btn-sm admin-btn-accent" data-action="asset-promote" data-key="${esc(key)}" data-mkey="${esc(a.key)}" title="Use this PDF as the lesson presentation">▶ Promote to presentation</button>`
        : '';
      return `
      <div class="admin-asset-row">
        <span class="admin-asset-icon">${fileIcon(a.type, a.name)}</span>
        <span class="admin-asset-name" title="${esc(a.name)}">${esc(a.name)}</span>
        <span class="admin-asset-size">${humanSize(a.size)}</span>
        ${promote}
        <button class="admin-btn admin-btn-icon admin-btn-danger" data-action="asset-remove" data-mkey="${esc(a.key)}" aria-label="Remove">✕</button>
      </div>`;
    }).join('') : '<span class="admin-faint">No resource files yet.</span>';
  }
  // finally, flag any presentation/video the profile claims but IndexedDB lacks
  await verifyPotwMedia();
}

// Store a PDF as the destination's lesson presentation and flag the profile.
async function setPdfAsPresentation(key, file) {
  const store = ctxRef.store;
  const profile = store.getPotwProfiles()[key];
  if (!profile) return false;
  await media.put(`potw:${key}:slides.pdf`, file);
  store.savePotwProfile(key, { ...profile, presentation: { type: 'pdf' } });
  renderBody();
  toast('Set as the lesson presentation — it will auto-play on arrival.');
  return true;
}

// Move an already-stored asset blob into the presentation slot.
async function promoteAssetToPresentation(key, assetKey) {
  const url = await media.url(assetKey);
  if (!url) { toast('Could not read that file.'); return; }
  try {
    const blob = await (await fetch(url)).blob();
    const info = await media.info(assetKey);
    const file = new File([blob], info?.name || 'slides.pdf', { type: blob.type || 'application/pdf' });
    await setPdfAsPresentation(key, file);
    await media.delete(assetKey);   // it lives in the presentation slot now
    refreshPotwMedia();
  } catch (e) { console.warn('admin: promote failed', e); toast('Could not promote that file.'); }
}

// Direct drop onto the card's Lesson Presentation zone — PDFs only.
async function handlePresDrop(key, file) {
  if (!key || !file) return;
  const isPdf = file.type === 'application/pdf' || /\.pdf$/i.test(file.name || '');
  if (!isPdf) { toast('Please drop a PDF here — use Edit for slide images or Google Slides.'); return; }
  await setPdfAsPresentation(key, file);
}

// Smart catch: a PDF dropped into the general resources zone when no
// presentation is configured is far more likely to be the lesson deck.
function askPdfIntent(key, file, rest) {
  pendingPdf = { key, file, rest };
  const m = el('admin-modal-root');
  m.innerHTML = `
    <div class="admin-modal-bg" data-action="pdf-intent-resource"></div>
    <div class="admin-modal">
      <div class="admin-modal-head">
        <div class="admin-modal-title">📽️ Use this PDF as the lesson presentation?</div>
        <button class="admin-btn admin-btn-icon" data-action="pdf-intent-resource" aria-label="Close">✕</button>
      </div>
      <div class="admin-modal-body">
        <p class="admin-modal-lead"><b>${esc(file.name)}</b> (${humanSize(file.size)})</p>
        <p class="admin-modal-lead">It'll play full-screen after landing at this destination. Otherwise it's kept as a resource file that opens in a new tab.</p>
      </div>
      <div class="admin-modal-foot">
        <button class="admin-btn admin-btn-lg" data-action="pdf-intent-resource">Keep as a resource file</button>
        <button class="admin-btn admin-btn-primary admin-btn-lg" data-action="pdf-intent-presentation">Use as presentation</button>
      </div>
    </div>`;
}

function fileIcon(type, name) {
  const t = (type || '').toLowerCase();
  const n = (name || '').toLowerCase();
  if (t.startsWith('image/')) return '🖼️';
  if (t === 'application/pdf' || n.endsWith('.pdf')) return '📄';
  if (t.startsWith('video/')) return '🎬';
  if (t.startsWith('audio/')) return '🎵';
  if (/\.(docx?|pages)$/.test(n)) return '📝';
  if (/\.(pptx?|key)$/.test(n)) return '📊';
  if (/\.(xlsx?|csv|numbers)$/.test(n)) return '📈';
  return '📎';
}

async function handleMediaFile(mkey, file) {
  if (!mkey || !file) return;
  if (file.type && !/^video\//.test(file.type)) { toast("That doesn't look like a video file."); return; }
  const res = await media.put(mkey, file);
  toast(res ? `Video stored (${humanSize(res.size)}).` : 'Could not store the file.');
  refreshPotwMedia();
}

// Store one or more resource files sequentially under potw:<key>:asset:<n>.
// Smart catch: a single PDF dropped here with NO presentation configured is
// probably the lesson deck — ask before filing it away as a document.
async function handleAssetFiles(key, fileList) {
  if (!key) return;
  const files = [...fileList];
  const hasPres = !!ctxRef.store.getPotwProfiles()[key]?.presentation;
  if (!hasPres) {
    const pdfIdx = files.findIndex((f) => f.type === 'application/pdf' || /\.pdf$/i.test(f.name || ''));
    if (pdfIdx >= 0) {
      const pdf = files[pdfIdx];
      const rest = files.filter((_, i) => i !== pdfIdx);
      askPdfIntent(key, pdf, rest);
      return;
    }
  }
  await storeAssets(key, files);
}

async function storeAssets(key, fileList) {
  if (!key || !fileList.length) { refreshPotwMedia(); return; }
  const existing = await media.list(`potw:${key}:asset:`);
  let next = existing.reduce((mx, a) => {
    const m = a.key.match(/:asset:(\d+)$/);
    return m ? Math.max(mx, Number(m[1])) : mx;
  }, 0) + 1;
  let n = 0;
  for (const f of [...fileList]) {
    const res = await media.put(`potw:${key}:asset:${next}`, f);
    if (res) { next++; n++; }
  }
  toast(n ? `Added ${n} resource file${n === 1 ? '' : 's'}.` : 'Could not store files.');
  refreshPotwMedia();
}

function openPotwEditor(key) {
  const store = ctxRef.store;
  const profiles = store.getPotwProfiles();
  if (key && profiles[key]) {
    const p = profiles[key];
    potwForm = {
      key, isNew: false,
      title: p.title || '', subtitle: p.subtitle || '',
      weekOf: p.weekOf || '',
      introVideoId: p.introVideoId || CONFIG.POTW_DEFAULT_VIDEO_ID,
      legacyPresetAtOpen: p.introVideoId || CONFIG.POTW_DEFAULT_VIDEO_ID,
      legacyVideoUrl: p.videoUrl || '',   // preserved unless a preset is picked
      mapsLink: '',
      mapsState: (Number.isFinite(p.camera?.center?.lat) && Number.isFinite(p.camera?.center?.lng))
        ? { ok: true, lat: p.camera.center.lat, lng: p.camera.center.lng } : null,
      manualCoords: false,
      camera: {
        lat: p.camera?.center?.lat ?? '', lng: p.camera?.center?.lng ?? '',
        altitude: p.camera?.center?.altitude ?? DEFAULT_CAM.altitude,
        range: p.camera?.range ?? DEFAULT_CAM.range,
        tilt: p.camera?.tilt ?? DEFAULT_CAM.tilt,
        heading: p.camera?.heading ?? DEFAULT_CAM.heading,
      },
      advancedOpen: false, extrasOpen: false,
      facts: (p.quickFacts || []).join('\n'),
      sources: (p.primarySources || []).map((s) => ({ emoji: s.emoji || '', name: s.name || '', desc: s.desc || '' })),
      quiz: (p.quiz || []).map((q) => ({ q: q.q || '', a: q.a || '' })),
      // Blank means "use the built-in default" (see bountyPoints() in potw.js).
      bountyPoints: p.bountyPoints != null ? String(p.bountyPoints) : '',
      // Prefer showing back what the teacher actually pasted (openUrl) so
      // re-saving keeps deriving the same canonical embed url; older profiles
      // saved before openUrl existed fall back to the stored embed url.
      pres: { type: p.presentation?.type || null, pdf: null, images: [], url: p.presentation?.type === 'gslides' ? (p.presentation.openUrl || p.presentation.url || '') : '' },
      links: (p.links || []).map((l) => ({ title: l.title || '', url: l.url || '' })),
      flyover: { file: null, existing: false, name: '', size: 0, url: '' },
      flyoverUrl: p.flyoverUrl || '',
    };
  } else {
    potwForm = {
      key: '', isNew: true, title: '', subtitle: '',
      weekOf: '', introVideoId: CONFIG.POTW_DEFAULT_VIDEO_ID, legacyVideoUrl: '',
      mapsLink: '', mapsState: null, manualCoords: false,
      camera: { lat: '', lng: '', altitude: DEFAULT_CAM.altitude, range: DEFAULT_CAM.range, tilt: DEFAULT_CAM.tilt, heading: DEFAULT_CAM.heading },
      advancedOpen: false, extrasOpen: false,
      facts: '',
      sources: [{ emoji: '', name: '', desc: '' }],
      quiz: [{ q: '', a: '' }],
      bountyPoints: '',
      pres: { type: null, pdf: null, images: [], url: '' },
      links: [],
      flyover: { file: null, existing: false, name: '', size: 0, url: '' },
      flyoverUrl: '',
    };
  }
  renderPotwModal();
  if (!potwForm.isNew && potwForm.pres.type && potwForm.pres.type !== 'gslides') hydratePresentation(key);
  if (!potwForm.isNew) hydrateFlyover(key);
}

// Load existing presentation media (PDF info / image thumbnails) for an editor
// that was just opened, then re-render once populated.
async function hydratePresentation(key) {
  const pres = potwForm && potwForm.pres;
  if (!pres) return;
  if (pres.type === 'pdf') {
    const info = await media.info(`potw:${key}:slides.pdf`);
    if (info) pres.pdf = { existing: true, name: info.name, size: info.size };
  } else if (pres.type === 'images') {
    const list = (await media.list(`potw:${key}:slide:`)).sort((a, b) => a.key.localeCompare(b.key));
    const items = [];
    for (const info of list) {
      const url = await media.url(info.key);
      items.push({ srcKey: info.key, name: info.name, size: info.size, url, ownUrl: false });
    }
    pres.images = items;
  }
  if (potwForm && el('admin-p-title')) renderPotwModal();
}

// Load an already-stored flyover audio blob (if any) for an editor that was
// just opened, so "Remove" / the audio preview reflect what's really saved.
async function hydrateFlyover(key) {
  if (!potwForm) return;
  const info = await media.info(`potw:${key}:flyover`);
  if (!info || !potwForm) return;
  let url = '';
  try { url = await media.url(`potw:${key}:flyover`); } catch (e) {}
  if (url) presUrls.add(url);
  if (!potwForm) return; // editor closed mid-await
  potwForm.flyover = { file: null, existing: true, name: info.name, size: info.size, url };
  if (el('admin-p-title')) renderPotwModal();
}

function renderPotwModal() {
  const m = el('admin-modal-root');
  const f = potwForm;
  const srcRows = f.sources.map((s, i) => `
    <div class="admin-srow">
      <input class="admin-input admin-s-emoji" type="text" value="${esc(s.emoji)}" placeholder="⚖️" aria-label="Emoji" />
      <input class="admin-input admin-s-name" type="text" value="${esc(s.name)}" placeholder="Source name" aria-label="Name" />
      <input class="admin-input admin-s-desc" type="text" value="${esc(s.desc)}" placeholder="Short description" aria-label="Description" />
      <button class="admin-btn admin-btn-icon admin-btn-danger" data-action="potw-src-del" data-i="${i}" aria-label="Remove">✕</button>
    </div>`).join('');
  const quizRows = f.quiz.map((q, i) => `
    <div class="admin-qrow">
      <input class="admin-input admin-q-q" type="text" value="${esc(q.q)}" placeholder="Question" aria-label="Question" />
      <input class="admin-input admin-q-a" type="text" value="${esc(q.a)}" placeholder="Answer" aria-label="Answer" />
      <button class="admin-btn admin-btn-icon admin-btn-danger" data-action="potw-quiz-del" data-i="${i}" aria-label="Remove">✕</button>
    </div>`).join('');

  const store = ctxRef.store;

  // ---- step 2: week ----
  const weekMonday = f.weekOf ? mondayOfDate(f.weekOf) : '';
  const weekEcho = weekMonday
    ? `<div class="admin-ok-line">✓ Plays ${esc(fullWeekRangeLabel(weekMonday))}</div>` : '';
  let weekClash = '';
  if (weekMonday) {
    const clash = Object.entries(store.getPotwProfiles())
      .find(([k, p]) => k !== f.key && p.weekOf && mondayOfDate(p.weekOf) === weekMonday);
    if (clash) weekClash = `<div class="admin-warn-line">⚠️ <b>${esc(clash[1].title)}</b> is already set for this week — the most recently added one will win.</div>`;
  }

  // ---- step 3: location ----
  let mapsFeedback = '';
  if (f.mapsState?.ok) {
    mapsFeedback = `<div class="admin-ok-line">✓ Got it — ${f.mapsState.lat}, ${f.mapsState.lng}</div>`;
  } else if (f.mapsState?.reason === 'short') {
    mapsFeedback = `<div class="admin-warn-line">Short links don't include the coordinates. In Google Maps, right-click the spot → click the numbers at the top to copy them, then paste here.</div>`;
  } else if (f.mapsState?.reason === 'parse') {
    mapsFeedback = `<div class="admin-warn-line">Couldn't find coordinates in that. Paste the link from the Google Maps address bar, or <button type="button" class="admin-linkbtn" data-action="potw-manual-coords">enter numbers manually</button>.</div>`;
  }
  const manualCoords = (f.manualCoords || (!f.mapsState?.ok && (f.camera.lat !== '' || f.camera.lng !== ''))) ? `
    <div class="admin-two" style="margin-top:10px">
      <div><label class="admin-flabel" for="admin-c-lat">Latitude</label>
        <input id="admin-c-lat" class="admin-input" type="number" step="any" value="${esc(f.camera.lat)}" placeholder="${DEFAULT_CAM.lat}" /></div>
      <div><label class="admin-flabel" for="admin-c-lng">Longitude</label>
        <input id="admin-c-lng" class="admin-input" type="number" step="any" value="${esc(f.camera.lng)}" placeholder="${DEFAULT_CAM.lng}" /></div>
    </div>` : '';

  // ---- step 4: intro video ----
  const vidOptions = store.getPotwVideoOptions().map((v) =>
    `<option value="${esc(v.id)}"${f.introVideoId === v.id ? ' selected' : ''}>${esc(v.label)}</option>`).join('');
  const legacyNote = f.legacyVideoUrl
    ? '<div class="admin-warn-line">This place currently uses a custom video link. Choosing a preset above and saving will switch it over.</div>' : '';

  m.innerHTML = `
    <div class="admin-modal-bg" data-action="potw-close"></div>
    <div class="admin-modal admin-modal-lg">
      <div class="admin-modal-head">
        <div class="admin-modal-title">${f.isNew ? '🌍 Add a Place of the Week' : '🌍 Edit: ' + esc(f.title || f.key)}</div>
        <button class="admin-btn admin-btn-icon" data-action="potw-close" aria-label="Close">✕</button>
      </div>
      <div class="admin-modal-body admin-modal-scroll">

        <div class="admin-step">
          <div class="admin-step-title"><span class="admin-step-num">1</span> What place are you visiting?</div>
          <label class="admin-flabel" for="admin-p-title">Place name</label>
          <input id="admin-p-title" class="admin-input" type="text" value="${esc(f.title)}" placeholder="Ancient Mesopotamia" />
          <label class="admin-flabel" for="admin-p-sub">Where is it?</label>
          <input id="admin-p-sub" class="admin-input admin-input-sm" type="text" value="${esc(f.subtitle)}" placeholder="Modern Day Iraq • The Fertile Crescent" />
          <div class="admin-step-hint">Shown on the big reveal screen before you fly there.</div>
        </div>

        <div class="admin-step">
          <div class="admin-step-title"><span class="admin-step-num">2</span> Which week does this play?</div>
          <div class="admin-step-hint">Pick any day in that week — the app plays this place all week and switches automatically when the next one starts.</div>
          <input id="admin-p-week" class="admin-input" type="date" value="${esc(f.weekOf)}" style="max-width:240px" />
          ${weekEcho}${weekClash}
        </div>

        <div class="admin-step">
          <div class="admin-step-title"><span class="admin-step-num">3</span> Where on Earth should we fly?</div>
          <div class="admin-step-hint">Open Google Maps, find the place, copy the address bar link, and paste it here.</div>
          <div class="admin-key-row">
            <input id="admin-p-maps" class="admin-input" type="text" value="${esc(f.mapsLink)}" placeholder="https://www.google.com/maps/place/…/@32.5363,44.4223,15z" autocomplete="off" spellcheck="false" />
            <button class="admin-btn admin-btn-primary" data-action="potw-parse-maps">Use this spot</button>
          </div>
          ${mapsFeedback}
          ${manualCoords}
          <div class="admin-testflight-row">
            <button class="admin-btn admin-btn-secondary" data-action="potw-testflight-form"
              title="Fly there now using the coordinates above — nothing is saved">🧭 Test flight from here</button>
            <span class="admin-mini">Check the landing spot before you save. Nothing is saved or scheduled.</span>
          </div>
          <details class="admin-details" ${f.advancedOpen ? 'open' : ''}>
            <summary>Advanced camera settings</summary>
            <div class="admin-mini" style="margin:0 0 8px">Most teachers never need these — the defaults look good everywhere.</div>
            <div class="admin-cam-grid">
              <div><label class="admin-flabel" for="admin-c-alt">Altitude</label>
                <input id="admin-c-alt" class="admin-input" type="number" step="any" value="${esc(f.camera.altitude)}" placeholder="${DEFAULT_CAM.altitude}" /></div>
              <div><label class="admin-flabel" for="admin-c-range">Range</label>
                <input id="admin-c-range" class="admin-input" type="number" step="any" value="${esc(f.camera.range)}" placeholder="${DEFAULT_CAM.range}" /></div>
              <div><label class="admin-flabel" for="admin-c-tilt">Tilt</label>
                <input id="admin-c-tilt" class="admin-input" type="number" step="any" value="${esc(f.camera.tilt)}" placeholder="${DEFAULT_CAM.tilt}" /></div>
              <div><label class="admin-flabel" for="admin-c-heading">Heading</label>
                <input id="admin-c-heading" class="admin-input" type="number" step="any" value="${esc(f.camera.heading)}" placeholder="${DEFAULT_CAM.heading}" /></div>
            </div>
          </details>
        </div>

        <div class="admin-step">
          <div class="admin-step-title"><span class="admin-step-num">4</span> Which intro video?</div>
          <div class="admin-step-hint">Plays before the flight.</div>
          <select id="admin-p-video" class="admin-input" style="max-width:240px">${vidOptions}</select>
          ${legacyNote}
          <div class="admin-mini" style="margin-top:6px">Want a different option here? Add, edit, or remove presets in the <b>🎬 Intro Video Presets</b> list at the top of the Place of the Week screen.</div>

          ${flyoverBlockHTML()}
        </div>

        <div class="admin-step">
          <div class="admin-step-title"><span class="admin-step-num">5</span> Your lesson presentation</div>
          <div class="admin-step-hint">Plays full-screen the moment you land. Google Slides is recommended — transitions, animations and embedded video all play; PDF is the offline-safe fallback.</div>
          <div class="admin-pres-block">${presSectionHTML()}</div>
        </div>

        <div class="admin-step">
          <details class="admin-details admin-extras" ${f.extrasOpen ? 'open' : ''}>
            <summary><span class="admin-step-num">6</span> Extras (optional)</summary>
            <div class="admin-mini" style="margin:0 0 8px">These appear on the optional 📋 Lesson card — they don't show automatically.</div>

            <label class="admin-flabel" for="admin-p-facts">Quick facts (one per line)</label>
            <textarea id="admin-p-facts" class="admin-input admin-textarea" rows="4" placeholder="One fact per line…">${esc(f.facts)}</textarea>

            <div class="admin-rows-head">
              <span class="admin-card-title admin-mini-title" style="margin:0">Primary sources</span>
              <button class="admin-btn admin-btn-sm" data-action="potw-src-add">+ Add source</button>
            </div>
            <div class="admin-srows">${srcRows || '<div class="admin-empty admin-empty-sm">No sources yet.</div>'}</div>

            <div class="admin-rows-head">
              <span class="admin-card-title admin-mini-title" style="margin:0">Quiz</span>
              <button class="admin-btn admin-btn-sm" data-action="potw-quiz-add">+ Add question</button>
            </div>
            <label class="admin-flabel" for="admin-p-bounty">Bounty points per question</label>
            <input id="admin-p-bounty" class="admin-input admin-input-sm" type="number" min="1" max="9999"
              value="${esc(f.bountyPoints)}" placeholder="50" style="max-width:150px" />
            <div class="admin-step-hint" style="margin:4px 0 10px">Whichever house answers a quiz question first, live, earns this many points on the spot. Leave this blank to use the app's built-in default of 50 points per question.</div>
            <div class="admin-qrows">${quizRows || '<div class="admin-empty admin-empty-sm">No questions yet.</div>'}</div>

            ${linksSectionHTML()}
          </details>
        </div>

      </div>
      <div class="admin-modal-foot">
        <button class="admin-btn admin-btn-lg" data-action="potw-close">Cancel</button>
        <button class="admin-btn admin-btn-primary admin-btn-lg" data-action="potw-save">Save this week's destination</button>
      </div>
    </div>`;
}

// Optional ambient audio for the 3D flyover, per destination. A stored file
// always wins over a URL; with neither, the flight is silent.
function flyoverBlockHTML() {
  const f = potwForm;
  const fl = f.flyover || {};
  const area = (fl.file || fl.existing)
    ? `<div class="admin-drop-body admin-pres-file">
         <div class="admin-drop-file">
           <span class="admin-drop-name" title="${esc(fl.name)}">${esc(fl.name)}</span>
           <span class="admin-drop-size">${humanSize(fl.size)} · ${fl.file ? 'pending save' : 'stored'}</span>
         </div>
         ${fl.url ? `<audio controls src="${esc(fl.url)}" style="width:100%;margin-top:8px;height:32px"></audio>` : ''}
         <button type="button" class="admin-btn admin-btn-sm admin-btn-danger" data-action="flyover-del" style="margin-top:8px">Remove</button>
       </div>`
    : `<div class="admin-drop" data-flyover="1" data-action="media-browse" title="Drop or click to browse">
         <input type="file" class="admin-file" data-flyover="1" accept="audio/*" hidden />
         <span class="admin-drop-prompt">⬇ Drop an audio file here, or click to browse</span>
       </div>`;

  return `
    <div class="admin-flyover-block">
      <label class="admin-flabel" style="margin:0">🎵 Flyover music <span class="admin-faint">(optional)</span></label>
      ${area}
      <label class="admin-flabel" for="admin-p-flyover-url" style="margin-top:10px">Or a music URL</label>
      <input id="admin-p-flyover-url" class="admin-input" type="text" value="${esc(f.flyoverUrl)}" placeholder="audio/flight.mp3 or https://…" spellcheck="false" autocomplete="off" />
      <div class="admin-mini" style="margin-top:8px">Plays during the 27-second flight and fades out 3 seconds after the presentation opens. Aim for a ~30 second track. An uploaded file always wins over the URL; with neither set, the flight plays silently. Follows the app's sound on/off switch — mute it and this stays silent too.</div>
    </div>`;
}

// Presentation editor — Google Slides featured first (Mr. D lives in Google
// Workspace), then PDF, then Slide Images.
function presSectionHTML() {
  const pres = potwForm.pres || (potwForm.pres = { type: null, pdf: null, images: [], url: '' });
  const opt = (t, lbl, feat) => `<button type="button" class="admin-pres-opt${pres.type === t ? ' on' : ''}${feat ? ' feat' : ''}" data-action="pres-type" data-type="${t}">${lbl}</button>`;

  let body = '';
  if (pres.type === 'gslides') {
    body = `
      <label class="admin-flabel" for="admin-pres-url">Your Google Slides link</label>
      <input id="admin-pres-url" class="admin-input" type="text" value="${esc(pres.url)}" placeholder="https://docs.google.com/presentation/d/e/2PACX-…/pub" />
      <div class="admin-mini admin-pres-hint">✅ <b>Recommended.</b> Use <b>File → Share → Publish to web</b>, click <b>Publish</b>, then paste that link — with the <b>“Start slideshow as soon as the player loads”</b> box unticked. Your transitions, animations and embedded videos all play, and your presenter remote works.</div>
      <details class="admin-details">
        <summary>❓ How do I get this link?</summary>
        <ol class="admin-steps">
          <li>Open the presentation in Google Slides.</li>
          <li><b>File → Share → Publish to web.</b></li>
          <li>On the <b>Link</b> or <b>Embed</b> tab (either is fine), <b>untick “Start slideshow as soon as the player loads.”</b></li>
          <li>Leave <b>“Restart the slideshow after the last slide”</b> unticked too.</li>
          <li>Click <b>Publish</b>, confirm, then copy the link it gives you.</li>
          <li>Paste that link above — <b>not</b> the address-bar link ending in <code>/edit</code>. That one loads fine but shows the class the Slides toolbar, filmstrip and speaker notes.</li>
        </ol>
        <p class="admin-mini" style="margin-top:8px">This app also forces safe playback (no auto-start, no auto-advance) whenever it shows the deck, so the class stays safe even if a box gets left ticked by accident. Still worth unticking it yourself in Slides — a good habit for anywhere else you might share the link.</p>
      </details>
      <div class="admin-mini admin-pres-hint" style="opacity:.75">🔈 Note: audio files inserted directly into Slides may not play in a published embed — embedded YouTube video does.</div>`;
  } else if (pres.type === 'pdf') {
    const p = pres.pdf;
    body = `
      ${p ? `<div class="admin-drop-body admin-pres-file">
          <div class="admin-drop-file"><span class="admin-drop-name" title="${esc(p.name)}">${esc(p.name)}</span><span class="admin-drop-size">${humanSize(p.size)} · ${p.existing ? 'stored' : 'pending save'}</span></div>
          <button type="button" class="admin-btn admin-btn-sm admin-btn-danger" data-action="pres-pdf-del">Remove</button>
        </div>`
        : presDropHTML('pdf', '⬇ Drop a PDF here, or click to browse')}
      <div class="admin-mini admin-pres-hint">📄 Offline-safe and fully controlled by this app (arrows, slide grid) — but it flattens animations and video. Export from PowerPoint or Google Slides: <b>File → Download / Export as PDF</b>.</div>`;
  } else if (pres.type === 'images') {
    const rows = pres.images.map((it, i) => `
      <div class="admin-pres-thumb">
        <span class="admin-bstep admin-pres-num">${i + 1}</span>
        <img src="${it.url}" alt="" class="admin-pres-img" />
        <span class="admin-pres-name" title="${esc(it.name)}">${esc(it.name)}</span>
        <div class="admin-brow-ctrls">
          <button type="button" class="admin-btn admin-btn-icon" data-action="pres-img-up" data-i="${i}" aria-label="Up"${i === 0 ? ' disabled' : ''}>▲</button>
          <button type="button" class="admin-btn admin-btn-icon" data-action="pres-img-down" data-i="${i}" aria-label="Down"${i === pres.images.length - 1 ? ' disabled' : ''}>▼</button>
          <button type="button" class="admin-btn admin-btn-icon admin-btn-danger" data-action="pres-img-del" data-i="${i}" aria-label="Remove">✕</button>
        </div>
      </div>`).join('');
    body = `
      ${presDropHTML('images', '⬇ Drop slide images here, or click to browse (multiple)')}
      <div class="admin-pres-list">${rows || '<div class="admin-empty admin-empty-sm">No slides yet.</div>'}</div>
      ${pres.images.length ? '<button type="button" class="admin-btn admin-btn-sm admin-btn-danger admin-btn-block" data-action="pres-img-clear">Remove all slides</button>' : ''}
      <div class="admin-mini admin-pres-hint">Export slides as PNG (Google Slides: <b>File → Download → PNG</b>, one per slide) and drop them <b>in order</b>.</div>`;
  } else {
    body = '<div class="admin-mini">Optional — attach slides that launch at this destination. Pick a source above.</div>';
  }

  const clear = pres.type ? '<button type="button" class="admin-btn admin-btn-sm" data-action="pres-clear" style="margin-top:10px">Clear presentation</button>' : '';
  return `
    <div class="admin-rows-head"><span class="admin-card-title admin-mini-title" style="margin:0">📽️ Lesson Presentation <span class="admin-faint">— shown full-screen after you land</span></span></div>
    <div class="admin-mini" style="margin:0 0 10px">Google Slides is recommended — transitions, animations and embedded video all play, and a presenter remote works. PDF is the offline-safe fallback.</div>
    <div class="admin-seg admin-pres-seg">
      ${opt('gslides', '🔗 Google Slides <span class="admin-feat-chip">Recommended</span>', true)}
      ${opt('pdf', '📄 PDF')}
      ${opt('images', '🖼️ Slide Images')}
    </div>
    <div class="admin-pres-body">${body}</div>
    ${clear}`;
}

function presDropHTML(kind, prompt) {
  const accept = kind === 'pdf' ? 'application/pdf' : 'image/*';
  const multiple = kind === 'images' ? 'multiple' : '';
  return `
    <div class="admin-drop" data-pres="${kind}" data-action="media-browse" title="Drop or click to browse">
      <input type="file" class="admin-file" data-pres="${kind}" accept="${accept}" ${multiple} hidden />
      <span class="admin-drop-prompt">${prompt}</span>
    </div>`;
}

// Stage dropped/selected presentation files in memory (committed to IndexedDB on Save).
function handlePresFiles(kind, fileList) {
  if (!potwForm) return;
  syncPotwFromDom();
  const pres = potwForm.pres;
  const files = [...fileList];
  if (kind === 'pdf') {
    const f = files[0];
    if (!f) return;
    if (f.type ? f.type !== 'application/pdf' : !/\.pdf$/i.test(f.name)) { toast('Please choose a PDF file.'); return; }
    switchPresType('pdf');
    pres.pdf = { file: f, name: f.name, size: f.size };
  } else if (kind === 'images') {
    const imgs = files.filter((f) => (f.type ? /^image\//.test(f.type) : /\.(png|jpe?g|gif|webp|bmp)$/i.test(f.name)));
    if (!imgs.length) { toast('Please choose image files.'); return; }
    switchPresType('images');
    for (const f of imgs) {
      const url = URL.createObjectURL(f); presUrls.add(url);
      pres.images.push({ file: f, name: f.name, size: f.size, url, ownUrl: true });
    }
  }
  renderPotwModal();
}

// Change the presentation source; replacing a different source discards its
// staged data (stored media is reconciled on Save).
function switchPresType(next) {
  const pres = potwForm.pres;
  if (pres.type === next) return;
  revokeImageUrls(pres.images);
  pres.images = [];
  pres.pdf = null;
  if (next !== 'gslides') pres.url = '';
  pres.type = next;
}

function revokeImageUrls(images) {
  (images || []).forEach((it) => { if (it.ownUrl && it.url) { try { URL.revokeObjectURL(it.url); } catch (e) {} presUrls.delete(it.url); } });
}
function revokePresUrls() { presUrls.forEach((u) => { try { URL.revokeObjectURL(u); } catch (e) {} }); presUrls.clear(); }

// Stage a dropped/selected flyover audio file in memory (committed to IndexedDB
// on Save, same pattern as the PDF/image presentation staging above).
function stageFlyoverFile(file) {
  if (!potwForm || !file) return;
  const isAudio = file.type ? /^audio\//.test(file.type) : /\.(mp3|wav|ogg|m4a|aac|flac)$/i.test(file.name || '');
  if (!isAudio) { toast('Please choose an audio file (mp3, wav, ogg, m4a…).'); return; }
  syncPotwFromDom();
  const prev = potwForm.flyover;
  if (prev?.url && presUrls.has(prev.url)) { try { URL.revokeObjectURL(prev.url); } catch (e) {} presUrls.delete(prev.url); }
  const url = URL.createObjectURL(file);
  presUrls.add(url);
  potwForm.flyover = { file, existing: false, name: file.name, size: file.size, url };
  renderPotwModal();
}

function removeFlyoverFile() {
  if (!potwForm) return;
  syncPotwFromDom();
  const prev = potwForm.flyover;
  if (prev?.url && presUrls.has(prev.url)) { try { URL.revokeObjectURL(prev.url); } catch (e) {} presUrls.delete(prev.url); }
  potwForm.flyover = { file: null, existing: false, name: '', size: 0, url: '' };
  renderPotwModal();
}

// Reconcile IndexedDB with the chosen flyover audio. Mirrors commitPresentation:
// a staged file is stored, an untouched existing blob is left alone, and an
// explicit removal (or a brand-new destination with nothing staged) deletes it.
async function commitFlyover(key) {
  const fl = potwForm.flyover || {};
  const mkey = `potw:${key}:flyover`;
  if (fl.file) { await media.put(mkey, fl.file); return; }
  if (fl.existing) return;
  await media.delete(mkey);
}

// A resource link (or the flyover URL fallback) must be a real web link or a
// site-relative path — never a bare scheme like javascript: or a protocol-
// relative //host link, and never contain whitespace.
function isValidResourceUrl(raw) {
  const s = String(raw || '').trim();
  if (!s) return true; // caller decides whether empty is acceptable
  if (/\s/.test(s)) return false;
  if (/^https?:\/\//i.test(s)) return true;
  if (/^[a-z][a-z0-9+.-]*:/i.test(s)) return false; // some other scheme (javascript:, mailto:, ftp:…)
  if (/^\/\//.test(s)) return false;                // protocol-relative
  return true; // treat as a site-relative path
}

function normalizeGslides(raw) {
  const u = (raw || '').trim();
  if (!u) return null;
  let host;
  try { host = new URL(u).hostname; } catch (e) { return null; }
  if (host !== 'docs.google.com') return null;
  return u.includes('/pub') ? u.replace('/pub', '/embed') : u;
}

// YouTube watch/share/shorts → embed form; direct .mp4 / relative paths pass through.
function normalizeVideoUrl(raw) {
  const u = (raw || '').trim();
  if (!u) return '';
  const m =
    u.match(/youtube\.com\/embed\/([A-Za-z0-9_-]{6,})/) ||
    u.match(/[?&]v=([A-Za-z0-9_-]{6,})/) ||
    u.match(/youtu\.be\/([A-Za-z0-9_-]{6,})/) ||
    u.match(/youtube\.com\/shorts\/([A-Za-z0-9_-]{6,})/);
  if (m) return `https://www.youtube.com/embed/${m[1]}`;
  return u; // direct video URL or site-relative path — leave as-is
}

// Docs & Links rows — edited in memory, committed on Save.
function linksSectionHTML() {
  const f = potwForm;
  const linkRows = (f.links || []).map((l, i) => {
    const urlErr = l.url && !isValidResourceUrl(l.url);
    return `
    <div class="admin-link-row">
      <input class="admin-input admin-link-title" type="text" value="${esc(l.title)}" placeholder="Link title (e.g. Kahoot)" aria-label="Link title" />
      <div>
        <input class="admin-input admin-link-url${urlErr ? ' admin-input-err' : ''}" type="text" value="${esc(l.url)}" placeholder="https://kahoot.it/… or videos/intro.mp4" aria-label="Link URL" />
        ${urlErr ? '<div class="admin-warn-line admin-save-err" style="margin-top:4px">⚠️ Must start with http:// or https://, or be a site-relative path — no spaces.</div>' : ''}
      </div>
      <div class="admin-brow-ctrls">
        <button type="button" class="admin-btn admin-btn-icon" data-action="potw-link-up" data-i="${i}" aria-label="Move up"${i === 0 ? ' disabled' : ''}>▲</button>
        <button type="button" class="admin-btn admin-btn-icon" data-action="potw-link-down" data-i="${i}" aria-label="Move down"${i === f.links.length - 1 ? ' disabled' : ''}>▼</button>
        <button type="button" class="admin-btn admin-btn-icon admin-btn-danger" data-action="potw-link-del" data-i="${i}" aria-label="Remove">✕</button>
      </div>
    </div>`;
  }).join('');
  return `
    <div class="admin-rows-head" style="margin-top:14px">
      <span class="admin-card-title admin-mini-title" style="margin:0">🔗 Quick links for this lesson <span class="admin-faint">(Kahoot, quizzes, articles)</span></span>
      <button class="admin-btn admin-btn-sm" data-action="potw-link-add">+ Add link</button>
    </div>
    <div class="admin-mini" style="margin:0 0 8px">These appear as buttons while you're at the destination — tap to open in a new tab. The order here is the button order on screen.</div>
    <div class="admin-link-rows">${linkRows || '<div class="admin-empty admin-empty-sm">No links yet — add a Kahoot, quiz, or article.</div>'}</div>`;
}

// Reconcile IndexedDB with the chosen presentation, returning the profile.presentation
// value. Only ever touches this profile's :slides.pdf / :slide:NNN keys — never :video/:song.
async function commitPresentation(key) {
  const pres = potwForm.pres || {};
  const presKeys = (await media.list(`potw:${key}:`))
    .map((x) => x.key)
    .filter((k) => k === `potw:${key}:slides.pdf` || k.startsWith(`potw:${key}:slide:`));
  const delAll = async () => { for (const k of presKeys) await media.delete(k); };

  if (pres.type === 'gslides') {
    const raw = (pres.url || '').trim();
    const url = normalizeGslides(raw);
    if (!url) return null;
    await delAll();
    // Keep what the teacher actually pasted (share link, /pub link, or an
    // already-/embed link) alongside the normalised embed url. The POTW
    // viewer's "Open full screen in Google Slides" button prefers this over
    // deriving one from the embed form — strictly more reliable.
    return { type: 'gslides', url, openUrl: raw };
  }
  if (pres.type === 'pdf') {
    if (pres.pdf?.file) await media.put(`potw:${key}:slides.pdf`, pres.pdf.file);
    const info = await media.info(`potw:${key}:slides.pdf`);
    if (!info) { await delAll(); return null; }
    for (const k of presKeys) { if (k !== `potw:${key}:slides.pdf`) await media.delete(k); }
    return { type: 'pdf' };
  }
  if (pres.type === 'images') {
    // Resolve every slide (new File or existing stored blob) to a Blob in final order.
    const blobs = [];
    for (const it of pres.images) {
      if (it.file) { blobs.push(it.file); continue; }
      if (it.srcKey) {
        const u = await media.url(it.srcKey);
        if (u) { try { const b = await (await fetch(u)).blob(); blobs.push(new File([b], it.name || 'slide', { type: b.type })); } catch (e) {} }
      }
    }
    await delAll();
    let n = 0;
    for (let i = 0; i < blobs.length; i++) {
      await media.put(`potw:${key}:slide:${String(i + 1).padStart(3, '0')}`, blobs[i]); n++;
    }
    return n ? { type: 'images', count: n } : null;
  }
  await delAll();
  return null;
}

// ---- 🧭 Test flight -------------------------------------------------------
// Opens the POTW 3D preview over the admin panel. Read-only: nothing is saved
// and the scheduled/active destination is never touched. The admin modal sits
// above the overlay (z-index 81 vs 60), so it is hidden for the duration and
// restored untouched on close — the teacher lands back exactly where he was.
function runTestFlight(profile) {
  if (!profile) { toast('That destination is missing.'); return; }
  const modalRoot = el('admin-modal-root');
  const prevDisplay = modalRoot ? modalRoot.style.display : null;
  if (modalRoot) modalRoot.style.display = 'none';

  const ok = testFlight({
    profile,
    onClose() { if (modalRoot) modalRoot.style.display = prevDisplay || ''; },
  });
  if (!ok) {
    if (modalRoot) modalRoot.style.display = prevDisplay || '';
    toast('Close the current Place of the Week view first.');
  }
}

// Test flight using the editor's CURRENT unsaved values (same coordinate
// precedence as savePotw), but with NO lat/lng default — missing coordinates
// must surface the friendly "no location set" message, not fly to Mesopotamia.
function runTestFlightFromForm() {
  syncPotwFromDom();
  const f = potwForm;
  if (!f) return;
  const num = (v, d) => (v !== '' && v !== null && Number.isFinite(Number(v)) ? Number(v) : d);
  const lat = f.mapsState?.ok ? f.mapsState.lat : num(f.camera.lat, null);
  const lng = f.mapsState?.ok ? f.mapsState.lng : num(f.camera.lng, null);

  runTestFlight({
    title: (f.title || '').trim() || 'Untitled destination',
    subtitle: (f.subtitle || '').trim(),
    camera: {
      center: { lat, lng, altitude: num(f.camera.altitude, DEFAULT_CAM.altitude) },
      range: num(f.camera.range, DEFAULT_CAM.range),
      tilt: num(f.camera.tilt, DEFAULT_CAM.tilt),
      heading: num(f.camera.heading, DEFAULT_CAM.heading),
    },
  });
}

function syncPotwFromDom() {
  if (!potwForm) return;
  const g = (id) => (el(id) ? el(id).value : '');
  const has = (id) => !!el(id);
  potwForm.title = g('admin-p-title');
  potwForm.subtitle = g('admin-p-sub');
  potwForm.weekOf = g('admin-p-week');
  if (has('admin-p-maps')) potwForm.mapsLink = g('admin-p-maps');
  if (has('admin-p-video')) potwForm.introVideoId = g('admin-p-video');
  if (has('admin-p-flyover-url')) potwForm.flyoverUrl = g('admin-p-flyover-url');
  potwForm.camera = {
    // lat/lng come from the parsed maps link unless the manual escape hatch is open
    lat: has('admin-c-lat') ? g('admin-c-lat') : potwForm.camera.lat,
    lng: has('admin-c-lng') ? g('admin-c-lng') : potwForm.camera.lng,
    altitude: has('admin-c-alt') ? g('admin-c-alt') : potwForm.camera.altitude,
    range: has('admin-c-range') ? g('admin-c-range') : potwForm.camera.range,
    tilt: has('admin-c-tilt') ? g('admin-c-tilt') : potwForm.camera.tilt,
    heading: has('admin-c-heading') ? g('admin-c-heading') : potwForm.camera.heading,
  };
  // keep collapsible state across re-renders
  const adv = rootEl.querySelector('.admin-step details.admin-details:not(.admin-extras)');
  if (adv) potwForm.advancedOpen = adv.open;
  const ext = rootEl.querySelector('details.admin-extras');
  if (ext) potwForm.extrasOpen = ext.open;
  if (has('admin-p-facts')) potwForm.facts = g('admin-p-facts');
  if (has('admin-p-bounty')) potwForm.bountyPoints = g('admin-p-bounty');
  potwForm.sources = [...rootEl.querySelectorAll('.admin-srow')].map((r) => ({
    emoji: r.querySelector('.admin-s-emoji').value.trim(),
    name: r.querySelector('.admin-s-name').value.trim(),
    desc: r.querySelector('.admin-s-desc').value.trim(),
  }));
  potwForm.quiz = [...rootEl.querySelectorAll('.admin-qrow')].map((r) => ({
    q: r.querySelector('.admin-q-q').value.trim(),
    a: r.querySelector('.admin-q-a').value.trim(),
  }));
  if (potwForm.pres && el('admin-pres-url')) potwForm.pres.url = el('admin-pres-url').value;
  potwForm.links = [...rootEl.querySelectorAll('.admin-link-row')].map((r) => ({
    title: r.querySelector('.admin-link-title').value.trim(),
    url: r.querySelector('.admin-link-url').value.trim(),
  }));
}

async function savePotw() {
  syncPotwFromDom();
  const f = potwForm;
  const title = f.title.trim();
  if (!title) { toast('Give this place a name first.'); return; }
  // Validate a Google Slides URL up front so we fail with a friendly message.
  if (f.pres?.type === 'gslides') {
    const u = (f.pres.url || '').trim();
    if (!u) { toast('Enter a Google Slides embed URL.'); return; }
    if (!normalizeGslides(u)) { toast('That must be a docs.google.com presentation URL.'); return; }
    // An /edit link is the EDITOR. It loads, so nothing looks broken — the class
    // just gets the toolbar, the slide filmstrip and the speaker-notes box
    // instead of the presentation. Caught here because the symptom gives no clue
    // about the cause.
    if (/\/edit\b/.test(u) || /\/d\/[^/]+\/?$/.test(u)) {
      toast('That is the editing link — the class would see the Slides toolbar. In Slides use File → Share → Publish to web, then paste that link.');
      return;
    }
  }
  // Quick-link buttons: every row with a title or URL needs a real link.
  const linksRaw = (f.links || []).map((l) => ({ title: l.title.trim(), url: l.url.trim() })).filter((l) => l.title || l.url);
  const badLink = linksRaw.find((l) => !isValidResourceUrl(l.url));
  if (badLink) {
    toast(`“${badLink.title || badLink.url}” needs a link starting with http:// or https://, or a site-relative path like videos/intro.mp4.`);
    return;
  }
  const flyoverUrl = (f.flyoverUrl || '').trim();
  if (flyoverUrl && !isValidResourceUrl(flyoverUrl)) {
    toast('The flyover music URL must start with http:// or https://, or be a site-relative path like audio/flight.mp3.');
    return;
  }
  const num = (v, d) => { const n = Number(v); return Number.isFinite(Number(v)) && v !== '' && v !== null ? Number(v) : d; };
  const finalKey = slugify(f.isNew ? (f.key.trim() || title) : f.key);
  const weekOf = f.weekOf ? mondayOfDate(f.weekOf) : '';
  const presentation = await commitPresentation(finalKey);
  if (!potwForm) return; // editor was closed mid-await
  await commitFlyover(finalKey);
  if (!potwForm) return; // editor was closed mid-await

  // Coordinates: a freshly parsed maps link wins, else the manual/existing values.
  const lat = f.mapsState?.ok ? f.mapsState.lat : num(f.camera.lat, DEFAULT_CAM.lat);
  const lng = f.mapsState?.ok ? f.mapsState.lng : num(f.camera.lng, DEFAULT_CAM.lng);

  const profile = {
    title,
    subtitle: f.subtitle.trim(),
    weekOf,
    introVideoId: f.introVideoId || CONFIG.POTW_DEFAULT_VIDEO_ID,
    camera: {
      center: { lat, lng, altitude: num(f.camera.altitude, DEFAULT_CAM.altitude) },
      range: num(f.camera.range, DEFAULT_CAM.range),
      tilt: num(f.camera.tilt, DEFAULT_CAM.tilt),
      heading: num(f.camera.heading, DEFAULT_CAM.heading),
    },
    quickFacts: f.facts.split('\n').map((s) => s.trim()).filter(Boolean),
    primarySources: f.sources.filter((s) => s.name || s.desc || s.emoji),
    quiz: f.quiz.filter((q) => q.q || q.a),
    // Raw pass-through — store.savePotwProfile clamps/validates this (a blank
    // or garbage value there falls back to the built-in default of 50).
    bountyPoints: f.bountyPoints,
  };
  if (presentation) profile.presentation = presentation;
  // A legacy free-text videoUrl is preserved only while the teacher hasn't picked
  // a preset; picking one clears it so the preset actually takes effect.
  const presetChanged = f.introVideoId && f.introVideoId !== f.legacyPresetAtOpen;
  if (f.legacyVideoUrl && !presetChanged) profile.videoUrl = f.legacyVideoUrl;
  if (linksRaw.length) profile.links = linksRaw;
  if (flyoverUrl) profile.flyoverUrl = flyoverUrl;

  const ok = ctxRef.store.savePotwProfile(finalKey, profile);
  if (!ok) { toast('Save failed — check the place name.'); return; }
  upsertPotwEvent(finalKey, title, weekOf);
  revokePresUrls();
  potwForm = null;
  closeModal();
  renderBody();
  toast(weekOf ? 'Saved — plays the week of ' + fmtDayShort(weekOf) + '.' : "Saved. This place won't play automatically until you set a week.");
}

// Keep the calendar 'potw' marker in sync with a profile's week-of date.
// Empty date removes any existing marker; a date moves/creates it.
function upsertPotwEvent(key, title, date) {
  const store = ctxRef.store;
  const ex = store.getState().planner.events.find((e) => e.type === 'potw' && e.payload?.profileKey === key);
  if (!date) { if (ex) store.removeEvent(ex.id); return; }
  if (ex) store.updateEvent(ex.id, { date, title });
  else store.addEvent({ type: 'potw', core: 'all', date, title, payload: { profileKey: key } });
}

// ===========================================================================
// Modal helpers
// ===========================================================================
function closeModal() {
  const m = el('admin-modal-root');
  if (m) m.innerHTML = '';
  pendingConfirm = null;
}

let pendingConfirm = null;
function openConfirm(title, body, onYes, { danger = true, yesLabel = 'Delete' } = {}) {
  pendingConfirm = onYes;
  const m = el('admin-modal-root');
  m.innerHTML = `
    <div class="admin-modal-bg" data-action="modal-close"></div>
    <div class="admin-modal${danger ? ' admin-modal-danger' : ''}">
      <div class="admin-modal-head">
        <div class="admin-modal-title">${esc(title)}</div>
        <button class="admin-btn admin-btn-icon" data-action="modal-close" aria-label="Close">✕</button>
      </div>
      <div class="admin-modal-body"><p class="admin-modal-lead">${esc(body)}</p></div>
      <div class="admin-modal-foot">
        <button class="admin-btn admin-btn-lg" data-action="modal-close">Cancel</button>
        <button class="admin-btn admin-btn-lg ${danger ? 'admin-btn-nuke' : 'admin-btn-primary'}" data-action="confirm-yes">${esc(yesLabel)}</button>
      </div>
    </div>`;
}

// ===========================================================================
// TAB — HELP (teacher's handbook, lives in js/core/help.js)
// ===========================================================================
// The wiki is imported LAZILY and defensively: it is a separate module owned by
// another part of the app, so Admin must keep working — and must say something
// friendly rather than throwing — if it isn't there yet.
let helpApi = null;

async function loadHelpApi() {
  if (helpApi) return helpApi;
  try {
    const mod = await import('../core/help.js');
    if (mod && typeof mod.openHelp === 'function') { helpApi = mod; return mod; }
  } catch (e) { /* not shipped yet — handled by the caller */ }
  return null;
}

// Small "❓ …" affordance placed wherever a teacher is most likely to get stuck.
function helpLink(topic, label = 'How this works') {
  return `<button type="button" class="admin-help-link" data-action="help-topic" data-topic="${esc(topic)}">❓ ${esc(label)}</button>`;
}

function openHelpTopic(topic, { category = false } = {}) {
  helpState = 'loading';
  if (activeTab === 'help') renderBody({ force: true });
  loadHelpApi().then((mod) => {
    if (!mod) {
      helpState = 'unavailable';
      if (activeTab === 'help') renderBody({ force: true });
      else toast('The teacher’s handbook isn’t available yet.');
      return;
    }
    try {
      if (category && typeof mod.openHelpAt === 'function') mod.openHelpAt(topic);
      else mod.openHelp(topic);
      helpState = 'ok';
    } catch (e) {
      console.warn('admin: help failed to open', e);
      helpState = 'unavailable';
      if (activeTab !== 'help') toast('The teacher’s handbook could not open.');
    }
    if (activeTab === 'help') renderBody({ force: true });
  });
}

function renderHelp() {
  const rows = [
    { topic: HELP_TOPICS.planner, icon: '📅', title: 'Planner & calendar', note: 'Lessons, homework, tests, vacations — and copying a day across a whole semester.' },
    { topic: HELP_TOPICS.quests,  icon: '🗺️', title: 'Quests', note: 'How a house takes on a task, how you award the points, and what giving up costs.' },
    { topic: HELP_TOPICS.shop,    icon: '🔮', title: 'The Magic Shop', note: 'What each item does, what shields stop, and how to invent balanced items.' },
    { topic: HELP_TOPICS.potw,    icon: '🌍', title: 'Place of the Week', note: 'Setting up a destination, the intro video, and scheduling it for a week.' },
    { topic: HELP_TOPICS.backups, icon: '💾', title: 'Backups & restoring', note: 'Where your data lives, and how to get it back if something goes wrong.' },
  ];

  let status = '';
  if (helpState === 'loading') status = '<div class="admin-mini">Opening the handbook…</div>';
  else if (helpState === 'unavailable') {
    status = `<div class="admin-warn-line">The teacher’s handbook isn’t installed in this copy of the app yet.
      Everything else keeps working — each screen also has its own “How this works” panel built in.</div>`;
  } else if (helpState === 'ok') {
    status = '<div class="admin-ok-line">The handbook is open over this screen. Close it to come back here.</div>';
  }

  return `
    <div class="admin-quests">
      <div class="admin-card">
        <div class="admin-card-title">❓ Teacher's Handbook</div>
        <div class="admin-mini">Plain-language answers for every part of the app. It opens on top of whatever you're doing, so you never lose your place.</div>
        ${status}
        <div class="admin-help-grid">
          ${rows.map((r) => `
            <button type="button" class="admin-help-card" data-action="help-topic" data-topic="${esc(r.topic)}">
              <span class="admin-help-icon">${r.icon}</span>
              <span class="admin-help-body">
                <span class="admin-help-title">${esc(r.title)}</span>
                <span class="admin-help-note">${esc(r.note)}</span>
              </span>
            </button>`).join('')}
        </div>
      </div>
    </div>`;
}

// ===========================================================================
// Delegated click handling
// ===========================================================================
function onClick(e) {
  const btn = e.target.closest('[data-action]');
  if (!btn || !rootEl.contains(btn)) return;
  const a = btn.dataset.action;
  const store = ctxRef.store;

  switch (a) {
    // tabs
    case 'tab': setTab(btn.dataset.tab); break;

    // calendar nav
    case 'cal-prev': { const d = new Date(cal.year, cal.month - 1, 1); cal.year = d.getFullYear(); cal.month = d.getMonth(); renderBody(); break; }
    case 'cal-next': { const d = new Date(cal.year, cal.month + 1, 1); cal.year = d.getFullYear(); cal.month = d.getMonth(); renderBody(); break; }
    case 'cal-today': { const d = new Date(); cal.year = d.getFullYear(); cal.month = d.getMonth(); renderBody(); break; }
    case 'open-day': openDay(btn.dataset.date); break;

    // day editor
    case 'panel-close': closePanel(); break;
    case 'evt-add': startAdd(); break;
    case 'evt-edit': startEdit(btn.dataset.id); break;
    case 'evt-del': store.removeEvent(btn.dataset.id); renderPanel(); renderBody(); break;

    // event form
    case 'form-back': panelView = 'day'; form = null; renderPanel(); break;
    case 'set-type': syncFormFromDom(); form.type = btn.dataset.type; renderPanel(); break;
    case 'evt-save': saveEvent(); break;

    // itinerary builder
    case 'builder-add': syncFormFromDom(); form.items.push({ time: '', text: '' }); renderPanel(); break;
    case 'builder-del': { syncFormFromDom(); form.items.splice(Number(btn.dataset.i), 1); renderPanel(); break; }
    case 'builder-up': { syncFormFromDom(); const i = Number(btn.dataset.i); if (i > 0) { const t = form.items[i - 1]; form.items[i - 1] = form.items[i]; form.items[i] = t; } renderPanel(); break; }
    case 'builder-down': { syncFormFromDom(); const i = Number(btn.dataset.i); if (i < form.items.length - 1) { const t = form.items[i + 1]; form.items[i + 1] = form.items[i]; form.items[i] = t; } renderPanel(); break; }
    case 'builder-copy': {
      syncFormFromDom();
      const core = form.core === 'all' ? 1 : form.core;
      const def = (store.getState().itineraries[core] || []).map((it) => ({ ...it }));
      form.items = def.length ? def : form.items;
      renderPanel();
      toast(`Copied default itinerary for Core ${core}.`);
      break;
    }
    case 'dup-open': openDupModal(); break;
    case 'dup-apply': applyDup(); break;

    // quests
    case 'quest-guide-toggle': later(() => { const d = rootEl.querySelector('.admin-quests .admin-guide'); if (d) questGuideOpen = d.open; }, 0); break;
    case 'quest-new': openQuestForm(null); break;
    case 'quest-edit': openQuestForm(btn.dataset.id); break;
    case 'quest-type': if (questForm) { syncQuestFromDom(); questForm.type = btn.dataset.type; renderQuestModal(); } break;
    case 'quest-save': saveQuestFromForm(); break;
    case 'quest-close': questForm = null; closeModal(); break;
    case 'quest-del': {
      const id = btn.dataset.id;
      const q = store.getQuestCatalog().find((x) => x.id === id);
      openConfirm(`Delete quest “${q ? q.title : ''}”?`, 'This removes it from the catalog and clears it from any core it is active on. Points already awarded for it are not touched.', () => {
        store.deleteQuest(id); renderBody(); toast('Quest deleted.');
      });
      break;
    }
    case 'quest-clear': {
      const core = Number(btn.dataset.core);
      const q = store.getActiveQuest(core);
      const house = store.HOUSES[core];
      if (!q) { toast('No active quest for that core.'); break; }
      openConfirm('Clear without penalty?', `“${q.title}” goes back on the board and ${house.name} loses nothing. Use this when a quest was accepted by mistake.`, () => {
        store.abandonQuest(core); renderBody(); toast('Quest cleared — no points changed.');
      }, { danger: false, yesLabel: 'Clear it' });
      break;
    }
    case 'quest-complete': openQuestCompleteModal(Number(btn.dataset.core)); break;
    case 'quest-complete-confirm': confirmQuestComplete(Number(btn.dataset.core)); break;
    case 'quest-fail': openQuestFailModal(Number(btn.dataset.core)); break;
    case 'quest-fail-confirm': confirmQuestFail(Number(btn.dataset.core)); break;

    // shop
    case 'shop-guide-toggle': later(() => { const d = rootEl.querySelector('.admin-guide'); if (d) shopGuideOpen = d.open; }, 0); break;
    case 'shop-new': openShopForm(null); break;
    case 'shop-edit': openShopForm(btn.dataset.id); break;
    case 'shop-save': saveShopItem(); break;
    case 'shop-close': revokeShopUrls(); shopForm = null; closeModal(); break;
    case 'shop-img-del': {
      syncShopFromDom();
      if (shopForm.imageUrl && shopUrls.has(shopForm.imageUrl)) { try { URL.revokeObjectURL(shopForm.imageUrl); } catch (e) {} shopUrls.delete(shopForm.imageUrl); }
      shopForm.imageFile = null; shopForm.imageStored = false; shopForm.imageUrl = '';
      renderShopModal();
      break;
    }
    case 'shop-del': {
      const id = btn.dataset.id;
      const it = store.getShopItems().find((x) => x.id === id);
      const duel = store.getCombatMode() === 'duel';
      const body = duel
        ? 'This removes it from the shop catalog. Any other item naming it as a counter stops naming it — you may want to pick a new counter for those.'
        : 'This removes it from the shop catalog.';
      openConfirm(`Delete item “${it ? it.name : ''}”?`, body, () => {
        if (it?.image?.startsWith('media:')) media.delete(it.image.slice('media:'.length));
        store.deleteShopItem(id);
        // Strip any dangling reference to the deleted item from every other
        // item's counter lists, so an old id never lingers as a broken link.
        if (duel) {
          store.getShopItems().forEach((x) => {
            if (Array.isArray(x.counteredBy) && x.counteredBy.includes(id)) {
              store.saveShopItem({ ...x, counteredBy: x.counteredBy.filter((c) => c !== id) });
            }
            if (Array.isArray(x.blocks) && x.blocks.includes(id)) {
              store.saveShopItem({ ...x, blocks: x.blocks.filter((c) => c !== id) });
            }
          });
        }
        renderBody(); toast('Item deleted.');
      });
      break;
    }

    // backup & restore
    case 'backup-export': exportBackup(); break;
    case 'backup-import': { const inp = el('admin-import-file'); if (inp) inp.click(); break; }
    case 'load-sample-data': loadSampleData(); break;
    case 'backup-connect': connectBackupFolder(); break;
    case 'backup-save-now': saveBackupNow(); break;
    case 'backup-restore-folder': restoreFromFolder(); break;
    case 'backup-disconnect': disconnectBackupFolder(); break;
    case 'backup-download-toggle': toggleDownloadBackup(); break;
    case 'backup-download-now': saveDownloadNow(); break;

    // settings
    case 'settings-save': saveSettings(); break;
    case 'theme-mode': {
      const cur = store.getSettings().theme || { mode: 'dark', seasonal: false };
      store.updateSettings({ theme: { ...cur, mode: btn.dataset.mode === 'light' ? 'light' : 'dark' } });
      renderBody(); toast(`${btn.dataset.mode === 'light' ? 'Light' : 'Dark'} mode set.`);
      break;
    }
    case 'theme-seasonal': {
      const cur = store.getSettings().theme || { mode: 'dark', seasonal: false };
      store.updateSettings({ theme: { ...cur, seasonal: !cur.seasonal } });
      renderBody(); toast(`Seasonal theming ${!cur.seasonal ? 'on' : 'off'}.`);
      break;
    }
    case 'maps-key-save': {
      const v = el('admin-maps-key') ? el('admin-maps-key').value.trim() : '';
      store.updateSettings({ mapsApiKeyOverride: v });
      toast(v ? 'Maps key saved — refresh to apply.' : 'Maps key cleared — using bundled key.');
      renderBody({ force: true });
      break;
    }
    // teacher PIN (lock.js)
    case 'lock-set': saveLockSet(); break;
    case 'lock-mode-change': lockUi = { mode: 'change', currentPin: '', newPin: '', confirmPin: '', error: '' }; renderBody(); break;
    case 'lock-change-save': saveLockChange(); break;
    case 'lock-mode-off': lockUi = { mode: 'off', currentPin: '', newPin: '', confirmPin: '', error: '' }; renderBody(); break;
    case 'lock-off-save': saveLockOff(); break;
    case 'lock-cancel': resetLockUi(); renderBody(); break;
    case 'lock-now': lock.lockNow(); renderBody({ force: true }); toast('Locked.'); break;
    case 'lock-minutes': lock.setMinutes(Number(btn.dataset.minutes)); renderBody({ force: true }); toast(`Auto-relock set to ${btn.dataset.minutes} minutes.`); break;

    case 'duel-punchdown': {
      const cur = store.getCombat().duelPunchDown !== false;
      store.updateCombat({ duelPunchDown: !cur });
      renderBody({ force: true });
      toast(!cur ? 'Any house may now attack any other.' : 'A house may now only attack one with MORE points.');
      break;
    }
    case 'duel-thaw': {
      const hid = Number(btn.dataset.house);
      const house = store.HOUSES[hid];
      openConfirm(`Un-freeze ${house ? house.name : 'this house'}?`,
        'The freeze ends immediately and they can earn points and attack again from now on. Points they missed while frozen are not paid back — award those with the ± button if you want them made whole.',
        () => {
          const ok = store.thawHouse(hid);
          renderBody({ force: true });
          toast(ok ? `${house.name} is no longer frozen.` : 'That house was not frozen.');
        }, { yesLabel: 'Un-freeze' });
      break;
    }
    case 'duel-unshroud': {
      const hid = Number(btn.dataset.house);
      const house = store.HOUSES[hid];
      openConfirm(`Lower ${house ? house.name : 'this house'}'s Shroud?`,
        'Stones of Seeing can look at them again from now on. The 500 points they spent on it are not refunded.',
        () => {
          const ok = store.lowerShroud(hid);
          renderBody({ force: true });
          toast(ok ? `${house.name}'s Shroud is down.` : 'That house was not shrouded.');
        }, { yesLabel: 'Lower it' });
      break;
    }
    case 'duel-take-item': {
      const hid = Number(btn.dataset.house);
      const itemId = btn.dataset.item;
      const house = store.HOUSES[hid];
      const item = store.getShopItems().find((i) => i.id === itemId);
      openConfirm(`Take back ${item ? item.name : 'this item'} from ${house ? house.name : 'this house'}?`,
        'One of them is removed from that house\u2019s holdings. The points they paid are NOT refunded — if you meant to undo the purchase completely, give the points back with the ± button too.',
        () => {
          store.consumeFromInventory(hid, itemId);
          renderBody({ force: true });
          toast(`${item ? item.name : 'Item'} taken back from ${house.name}.`);
        }, { yesLabel: 'Take it back' });
      break;
    }
    case 'shield-clear': {
      const hid = Number(btn.dataset.house);
      const house = store.HOUSES[hid];
      openConfirm(`Clear ${house ? house.name : ''}'s shield?`,
        'Their shield ends immediately and attacks can land again. The points they spent are not refunded.',
        () => {
          const ok = store.clearShield(hid);
          renderBody({ force: true });
          toast(ok ? `${house.name}'s shield cleared.` : 'That shield had already expired.');
        }, { yesLabel: 'Clear shield' });
      break;
    }
    case 'reduction-clear': {
      const hid = Number(btn.dataset.house);
      const house = store.HOUSES[hid];
      openConfirm(`Clear ${house ? house.name : ''}'s damage reduction?`,
        'Incoming attacks hit them at full strength again. This was most likely a Mythic reward.',
        () => {
          const ok = store.clearReduction(hid);
          renderBody({ force: true });
          toast(ok ? `${house.name}'s damage reduction cleared.` : 'That reduction had already expired.');
        }, { yesLabel: 'Clear reduction' });
      break;
    }
    // background music (Settings tab)
    case 'ambient-toggle': {
      const cur = store.getAmbient();
      store.updateAmbient({ enabled: !cur.enabled });
      renderBody();
      toast(`Background music ${!cur.enabled ? 'on' : 'off'}.`);
      break;
    }
    case 'music-preview': previewMusicTrack(btn.dataset.screen); break;
    case 'music-clear': {
      const screen = btn.dataset.screen;
      store.setAmbientTrack(screen, null);
      showMusicError(screen, '');
      renderBody({ force: true });
      toast('Track cleared.');
      break;
    }
    // sound effects (teacher recordings vs. built-in synth cues)
    case 'sfx-test': {
      const name = btn.dataset.sfx;
      ctxRef.audio?.sfx?.(name);
      if (name === 'battlecry' && !store.getSfx(name)) {
        toast('Nothing to hear yet — the war cry has no built-in beep. Record one above, or it stays as the computer’s spoken voice on Battle Day.');
      }
      break;
    }
    case 'sfx-reset': {
      const name = btn.dataset.sfx;
      const meta = store.SFX_SLOTS[name];
      store.setSfx(name, '');
      renderBody({ force: true });
      toast(`${meta ? meta.label : 'Sound'} reset to the built-in sound.`);
      break;
    }
    case 'music-suggested-open': {
      openConfirm(
        'Apply the suggested background music setup?',
        'This assigns a track and starting level to every screen (Dashboard, Council, Records, Quests, Shop, Dice, Battle Day), turns background music on, and replaces whatever is already assigned to those screens. You can change any track or level afterwards.',
        () => applySuggestedMusicSetup(),
        { danger: false, yesLabel: 'Apply suggested setup' });
      break;
    }

    case 'danger-toggle': dangerOpen = !dangerOpen; renderBody(); break;
    case 'reset-open': openResetModal(); break;
    case 'reset-confirm': if (!btn.disabled) doReset(); break;

    // houses
    case 'house-edit': openHouseForm(Number(btn.dataset.id)); break;
    case 'house-reset': openHouseResetConfirm(Number(btn.dataset.id)); break;
    case 'house-save': saveHouseForm(); break;
    case 'house-close': houseForm = null; closeModal(); break;

    // screen colours (own colour vs. following the active house)
    case 'mct-match': {
      const id = btn.dataset.module;
      const cur = store.getModuleTheme(id);
      store.setModuleTheme(id, { matchHouse: !cur.matchHouse });
      renderBody({ force: true });
      toast(`${cur.label} ${!cur.matchHouse ? 'now follows the active house.' : 'now keeps its own colour.'}`);
      break;
    }
    case 'mct-reset': {
      const id = btn.dataset.module;
      const label = store.getModuleTheme(id).label;
      store.resetModuleTheme(id);
      renderBody({ force: true });
      toast(`${label} colour reset to its shipped default.`);
      break;
    }

    // dice prophecy table (Die of Destiny outcomes)
    case 'dice-reset': {
      const id = btn.dataset.diceId;
      store.resetDiceOutcome(id);
      renderBody({ force: true });
      toast('Outcome reset to its shipped wording and points.');
      break;
    }

    // screen layout (grid vs. carousel)
    case 'screen-layout': {
      const id = btn.dataset.screen;
      const layout = btn.dataset.layout;
      const label = store.LAYOUT_SCREENS[id] ? store.LAYOUT_SCREENS[id].label : id;
      store.setLayout(id, layout);
      renderBody({ force: true });
      toast(`${label} set to ${layout === 'carousel' ? 'Carousel' : 'Grid'}.`);
      break;
    }

    // battle rules (prize rule + punching down)
    case 'combat-rule': {
      const ruleId = btn.dataset.rule;
      store.updateCombat({ prizeRule: ruleId });
      renderBody({ force: true });
      toast(`Prize rule set to “${store.PRIZE_RULES[ruleId] ? store.PRIZE_RULES[ruleId].label : ruleId}”.`);
      break;
    }
    case 'combat-punchdown': {
      const cur = store.getCombat();
      store.updateCombat({ punchingDown: !cur.punchingDown });
      renderBody({ force: true });
      toast(`Punching down ${!cur.punchingDown ? 'allowed' : 'blocked'}.`);
      break;
    }

    // which Battle Day rule set is active — never switches on a tap, since it
    // swaps the whole Magic Shop and clears every House's holdings
    case 'combat-mode-request': {
      const target = btn.dataset.mode;
      const def = store.COMBAT_MODES[target];
      if (!def) break;
      openConfirm(
        `Switch to "${def.label}"?`,
        `This is not cosmetic. The Magic Shop's items change completely — different items, different prices — and anything Houses are currently holding or have stockpiled is cleared out. Points, the ledger, quests, the planner and every other setting are left exactly as they are. ${def.blurb}`,
        () => {
          const applied = store.setCombatMode(target);
          activeTab = 'battle';
          renderBody({ force: true });
          toast(`Battle Day now uses "${store.COMBAT_MODES[applied].label}".`);
        },
        { danger: false, yesLabel: `Switch to ${def.label}` },
      );
      break;
    }

    // quick award presets (Records one-tap buttons)
    case 'award-new': openAwardForm(null); break;
    case 'award-edit': openAwardForm(btn.dataset.id); break;
    case 'award-save': saveAwardForm(); break;
    case 'award-close': awardForm = null; closeModal(); break;
    case 'award-up': moveAwardPreset(btn.dataset.id, -1); break;
    case 'award-down': moveAwardPreset(btn.dataset.id, 1); break;
    case 'award-del': {
      const id = btn.dataset.id;
      const p = store.getAwardPresets().find((x) => x.id === id);
      openConfirm(`Delete quick award “${p ? p.label : ''}”?`, 'This removes it from the one-tap buttons on the Records screen.', () => {
        store.deleteAwardPreset(id); renderBody(); toast('Quick award deleted.');
      });
      break;
    }

    // intro video presets
    case 'video-new': openVideoForm(null); break;
    case 'video-edit': openVideoForm(btn.dataset.id); break;
    case 'video-save': saveVideoForm(); break;
    case 'video-close': videoForm = null; closeModal(); break;
    case 'video-del': if (!btn.disabled) deleteVideoPreset(btn.dataset.id); break;

    // potw
    case 'potw-new': openPotwEditor(null); break;
    case 'potw-edit': openPotwEditor(btn.dataset.key); break;
    case 'potw-testflight': runTestFlight(store.getPotwProfiles()[btn.dataset.key]); break;
    case 'potw-testflight-form': runTestFlightFromForm(); break;
    case 'potw-active': if (store.setActivePotw(btn.dataset.key)) { renderBody(); toast('Active destination set.'); } break;
    case 'potw-delete': {
      const k = btn.dataset.key;
      if (store.deletePotwProfile(k)) {
        // remove the linked calendar marker + ALL stored media for this (now-gone) profile
        const ev = store.getState().planner.events.find((e) => e.type === 'potw' && e.payload?.profileKey === k);
        if (ev) store.removeEvent(ev.id);
        media.list(`potw:${k}:`).then((list) => list.forEach((x) => media.delete(x.key)));
        renderBody();
        toast('Destination deleted.');
      } else toast('Cannot delete the active destination.');
      break;
    }
    case 'potw-jump': {
      const k = btn.dataset.key;
      closePanel();
      activeTab = 'potw';
      syncSegActive();
      renderBody();
      if (k && store.getPotwProfiles()[k]) openPotwEditor(k);
      break;
    }
    case 'media-browse': { const z = btn.closest('.admin-drop'); const inp = z?.querySelector('input.admin-file'); if (inp) inp.click(); break; }
    case 'media-remove': {
      const mkey = btn.dataset.mkey;
      media.delete(mkey).then(() => { toast('File removed.'); refreshPotwMedia(); });
      break;
    }
    case 'asset-remove': {
      const mkey = btn.dataset.mkey;
      media.delete(mkey).then(() => { toast('Resource removed.'); refreshPotwMedia(); });
      break;
    }
    case 'asset-promote': promoteAssetToPresentation(btn.dataset.key, btn.dataset.mkey); break;
    case 'pdf-intent-presentation': {
      const p = pendingPdf; pendingPdf = null; closeModal();
      if (p) setPdfAsPresentation(p.key, p.file).then(() => storeAssets(p.key, p.rest));
      break;
    }
    case 'pdf-intent-resource': {
      const p = pendingPdf; pendingPdf = null; closeModal();
      if (p) storeAssets(p.key, [p.file, ...p.rest]);
      break;
    }
    case 'potw-src-add': syncPotwFromDom(); potwForm.sources.push({ emoji: '', name: '', desc: '' }); renderPotwModal(); break;
    case 'potw-src-del': syncPotwFromDom(); potwForm.sources.splice(Number(btn.dataset.i), 1); renderPotwModal(); break;
    case 'potw-quiz-add': syncPotwFromDom(); potwForm.quiz.push({ q: '', a: '' }); renderPotwModal(); break;
    case 'potw-quiz-del': syncPotwFromDom(); potwForm.quiz.splice(Number(btn.dataset.i), 1); renderPotwModal(); break;
    case 'potw-link-add': syncPotwFromDom(); potwForm.links.push({ title: '', url: '' }); renderPotwModal(); break;
    case 'potw-link-del': syncPotwFromDom(); potwForm.links.splice(Number(btn.dataset.i), 1); renderPotwModal(); break;
    case 'potw-link-up': { syncPotwFromDom(); const i = Number(btn.dataset.i); const a = potwForm.links; if (i > 0) { [a[i - 1], a[i]] = [a[i], a[i - 1]]; } renderPotwModal(); break; }
    case 'potw-link-down': { syncPotwFromDom(); const i = Number(btn.dataset.i); const a = potwForm.links; if (i < a.length - 1) { [a[i + 1], a[i]] = [a[i], a[i + 1]]; } renderPotwModal(); break; }

    // flyover music
    case 'flyover-del': removeFlyoverFile(); break;
    case 'potw-parse-maps': {
      syncPotwFromDom();
      const res = parseMapsLink(potwForm.mapsLink);
      if (res.ok) {
        potwForm.mapsState = res;
        potwForm.camera.lat = res.lat; potwForm.camera.lng = res.lng;
        potwForm.manualCoords = false;
      } else {
        potwForm.mapsState = res;
      }
      renderPotwModal();
      break;
    }
    case 'potw-manual-coords': syncPotwFromDom(); potwForm.manualCoords = true; renderPotwModal(); break;
    case 'potw-save': savePotw(); break;
    case 'potw-close': revokePresUrls(); potwForm = null; closeModal(); break;

    // presentation section
    case 'pres-type': syncPotwFromDom(); switchPresType(btn.dataset.type); renderPotwModal(); break;
    case 'pres-clear': syncPotwFromDom(); revokeImageUrls(potwForm.pres.images); potwForm.pres = { type: null, pdf: null, images: [], url: '' }; renderPotwModal(); break;
    case 'pres-pdf-del': syncPotwFromDom(); potwForm.pres.pdf = null; potwForm.pres.type = null; renderPotwModal(); break;
    case 'pres-img-up': { syncPotwFromDom(); const i = Number(btn.dataset.i); const a = potwForm.pres.images; if (i > 0) { [a[i - 1], a[i]] = [a[i], a[i - 1]]; } renderPotwModal(); break; }
    case 'pres-img-down': { syncPotwFromDom(); const i = Number(btn.dataset.i); const a = potwForm.pres.images; if (i < a.length - 1) { [a[i + 1], a[i]] = [a[i], a[i + 1]]; } renderPotwModal(); break; }
    case 'pres-img-del': { syncPotwFromDom(); const i = Number(btn.dataset.i); const it = potwForm.pres.images[i]; if (it) revokeImageUrls([it]); potwForm.pres.images.splice(i, 1); renderPotwModal(); break; }
    case 'pres-img-clear': syncPotwFromDom(); revokeImageUrls(potwForm.pres.images); potwForm.pres.images = []; potwForm.pres.type = null; renderPotwModal(); break;

    // help
    case 'help-topic': openHelpTopic(btn.dataset.topic || null); break;

    // generic modal
    case 'confirm-yes': { const cb = pendingConfirm; pendingConfirm = null; closeModal(); if (cb) cb(); break; }
    case 'modal-close': closeModal(); break;

    default: break;
  }
}

// ===========================================================================
// Styles (injected once, removed on unmount)
// ===========================================================================
function injectStyles() {
  if (el('admin-styles')) return;
  const s = document.createElement('style');
  s.id = 'admin-styles';
  s.textContent = `
  .admin-wrap{height:100%;display:flex;flex-direction:column;background:var(--color-page);color:var(--color-text);overflow:hidden;}
  .admin-head{flex-shrink:0;padding:16px 20px 12px;border-bottom:1px solid var(--color-card2);
    background:linear-gradient(180deg,rgba(245,158,11,.06),transparent);}
  /* The title and the tab bar sit over the work area, not off in the corner
     away from it. Every tab's content is a centred column — 820px on Settings,
     wider elsewhere — so centring the header on the page lines it up with all
     of them rather than with any one tab's width. */
  .admin-titlebar{display:flex;align-items:center;gap:14px;margin-bottom:12px;
    justify-content:center;}
  .admin-key{font-size:2rem;filter:drop-shadow(0 0 12px rgba(245,158,11,.5));}
  .admin-title{font-family:Cinzel,serif;font-weight:800;font-size:1.5rem;color:#f59e0b;letter-spacing:.03em;}
  .admin-sub{color:var(--color-text-soft);font-size:.85rem;}
  .admin-seg{display:flex;width:max-content;max-width:100%;margin-inline:auto;
    gap:4px;padding:4px;background:var(--color-card);border:1px solid var(--color-line);
    border-radius:1rem;flex-wrap:wrap;justify-content:center;}
  .admin-seg-btn{min-height:44px;padding:10px 20px;border:none;border-radius:.75rem;background:transparent;
    color:var(--color-text-soft);font-weight:700;font-size:.95rem;cursor:pointer;transition:background .18s ease,color .18s ease;}
  .admin-seg-btn:hover{color:var(--color-text);}
  .admin-seg-btn.active{background:#f59e0b;color:#0b0f19;box-shadow:0 4px 16px rgba(245,158,11,.35);}
  .admin-body{flex:1;overflow-y:auto;padding:20px;}
  .admin-body::-webkit-scrollbar{width:9px;}
  .admin-body::-webkit-scrollbar-thumb{background:var(--color-line);border-radius:8px;}

  /* buttons */
  .admin-btn{min-height:44px;padding:9px 16px;border-radius:.7rem;border:1px solid var(--color-line);background:var(--color-card2);
    color:var(--color-text);font-weight:600;font-size:.9rem;cursor:pointer;transition:background .16s ease,border-color .16s ease,transform .1s ease;
    display:inline-flex;align-items:center;justify-content:center;gap:6px;}
  .admin-btn:hover:not(:disabled){background:var(--color-line);}
  .admin-btn:active:not(:disabled){transform:scale(.97);}
  .admin-btn:disabled{opacity:.4;cursor:default;}
  .admin-btn-icon{min-width:44px;padding:9px;font-size:1rem;}
  .admin-btn-sm{min-height:38px;padding:7px 12px;font-size:.82rem;}
  .admin-btn-lg{min-height:48px;padding:12px 22px;font-size:1rem;}
  .admin-btn-block{width:100%;}
  .admin-btn-primary{background:#f59e0b;border-color:#f59e0b;color:#0b0f19;font-weight:800;}
  .admin-btn-primary:hover:not(:disabled){background:#fbbf24;border-color:#fbbf24;}
  .admin-btn-accent{background:rgba(245,158,11,.12);border-color:rgba(245,158,11,.5);color:#f59e0b;}
  .admin-btn-accent:hover:not(:disabled){background:rgba(245,158,11,.22);}
  .admin-btn-secondary{background:rgba(59,130,246,.12);border-color:rgba(59,130,246,.5);color:#60a5fa;}
  .admin-btn-secondary:hover:not(:disabled){background:rgba(59,130,246,.22);border-color:#3b82f6;}
  .admin-testflight-row{display:flex;align-items:center;gap:12px;flex-wrap:wrap;margin-top:12px;}
  .admin-testflight-row .admin-mini{margin:0;}
  .admin-btn-danger{color:#f87171;}
  .admin-btn-danger:hover:not(:disabled){background:rgba(239,68,68,.18);border-color:#ef4444;}
  .admin-btn-nuke{background:#b91c1c;border-color:#b91c1c;color:#fff;font-weight:800;}
  .admin-btn-nuke:hover:not(:disabled){background:#991b1b;}

  /* inputs */
  .admin-input{width:100%;min-height:44px;padding:10px 12px;border-radius:.7rem;border:1px solid var(--color-line);
    background:var(--color-card);color:var(--color-text);font-size:.95rem;font-family:inherit;}
  .admin-input:focus{outline:none;border-color:#f59e0b;box-shadow:0 0 0 3px rgba(245,158,11,.18);}
  .admin-input[readonly]{opacity:.65;}
  .admin-textarea{min-height:110px;resize:vertical;line-height:1.5;}
  .admin-flabel{display:block;font-size:.78rem;font-weight:700;text-transform:uppercase;letter-spacing:.05em;
    color:var(--color-text-soft);margin:14px 0 6px;}
  .admin-two{display:grid;grid-template-columns:1fr 1fr;gap:14px;}
  .admin-cam-grid{display:grid;grid-template-columns:repeat(3,1fr);gap:12px;}
  @media (max-width:640px){.admin-two,.admin-cam-grid{grid-template-columns:1fr;}}

  /* planner toolbar */
  .admin-planner{max-width:1400px;margin:0 auto;}
  .admin-toolbar{display:flex;align-items:center;gap:16px;flex-wrap:wrap;margin-bottom:14px;}
  .admin-nav{display:flex;gap:6px;}
  .admin-month{font-family:Cinzel,serif;font-weight:800;font-size:1.4rem;color:var(--color-text);min-width:220px;}
  .admin-legend{margin-left:auto;display:flex;gap:12px;flex-wrap:wrap;}
  .admin-leg{display:inline-flex;align-items:center;gap:6px;font-size:.72rem;color:var(--color-text-soft);}
  .admin-leg-sw{width:12px;height:12px;border-radius:3px;display:inline-block;}

  /* calendar grid */
  .admin-dow{display:grid;grid-template-columns:repeat(7,1fr);gap:6px;margin-bottom:6px;}
  .admin-dow>div{text-align:center;font-size:.75rem;font-weight:700;text-transform:uppercase;letter-spacing:.05em;color:var(--color-text-soft);padding:4px 0;}
  .admin-dow>div.weekend{color:var(--color-text-soft);}
  .admin-grid{display:flex;flex-direction:column;gap:6px;}
  .admin-week{display:grid;grid-template-columns:repeat(7,1fr);gap:6px;}
  .admin-cell{min-height:96px;text-align:left;display:flex;flex-direction:column;gap:4px;padding:6px;
    background:var(--color-card);border:1px solid var(--color-card2);border-radius:.75rem;cursor:pointer;overflow:hidden;
    transition:border-color .16s ease,background .16s ease,transform .1s ease;font-family:inherit;}
  .admin-cell:hover{border-color:#f59e0b;background:var(--color-card2);}
  .admin-cell:active{transform:scale(.985);}
  .admin-cell.out{opacity:.42;}
  .admin-cell.weekend{background:var(--color-page);}
  .admin-cell.today{border-color:#f59e0b;box-shadow:inset 0 0 0 1px #f59e0b,0 0 16px rgba(245,158,11,.2);}
  .admin-cell-num{font-weight:700;font-size:.9rem;color:var(--color-text);flex-shrink:0;}
  .admin-cell.today .admin-cell-num{color:#f59e0b;}
  .admin-cell-chips{display:flex;flex-direction:column;gap:3px;overflow:hidden;}
  .admin-chip{font-size:.68rem;font-weight:600;padding:2px 6px;border-radius:.4rem;white-space:nowrap;
    overflow:hidden;text-overflow:ellipsis;max-width:100%;}
  .admin-chip-more{font-size:.66rem;font-weight:700;color:var(--color-text-soft);padding:1px 4px;}
  .admin-hint{margin-top:16px;padding:12px 14px;background:rgba(245,158,11,.07);border:1px solid rgba(245,158,11,.25);
    border-radius:.75rem;color:var(--color-text-soft);font-size:.85rem;line-height:1.5;}

  /* side panel */
  #admin-panel-root:empty{display:none;}
  .admin-panel{position:fixed;top:0;right:0;height:100vh;width:min(440px,100vw);z-index:70;
    background:var(--color-card);border-left:1px solid var(--color-line);box-shadow:-16px 0 50px rgba(0,0,0,.5);
    display:flex;flex-direction:column;animation:admin-slide-in .25s ease both;}
  @keyframes admin-slide-in{from{transform:translateX(100%);}to{transform:translateX(0);}}
  .admin-panel-head{flex-shrink:0;display:flex;align-items:flex-start;justify-content:space-between;gap:12px;
    padding:18px 20px;border-bottom:1px solid var(--color-card2);background:linear-gradient(180deg,rgba(245,158,11,.06),transparent);}
  .admin-panel-eyebrow{font-size:.72rem;font-weight:700;text-transform:uppercase;letter-spacing:.08em;color:#f59e0b;}
  .admin-panel-title{font-weight:800;font-size:1.15rem;color:var(--color-text);margin-top:2px;}
  .admin-panel-body{flex:1;overflow-y:auto;padding:16px 20px;}
  .admin-panel-body::-webkit-scrollbar{width:8px;}
  .admin-panel-body::-webkit-scrollbar-thumb{background:var(--color-line);border-radius:8px;}
  .admin-panel-foot{flex-shrink:0;padding:14px 20px;border-top:1px solid var(--color-card2);}
  .admin-version{margin-top:14px;text-align:center;font-size:12px;color:#94a3b8;line-height:1.5;}
  .admin-version b{color:#cbd5e1;}
  .admin-version-hint{display:block;max-width:44ch;margin:2px auto 0;font-size:11px;color:#64748b;}
  .admin-foot-split{display:flex;gap:10px;}
  .admin-foot-split .admin-btn{flex:1;}

  /* event rows */
  .admin-evt{display:flex;align-items:center;gap:10px;padding:10px 12px;background:var(--color-card2);border:1px solid var(--color-line);
    border-radius:.75rem;margin-bottom:8px;}
  .admin-evt-static{background:var(--color-card2);}
  .admin-evt-dot{width:14px;height:14px;border-radius:50%;flex-shrink:0;}
  .admin-evt-main{flex:1;min-width:0;}
  .admin-evt-title{font-weight:600;color:var(--color-text);font-size:.92rem;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;}
  .admin-evt-meta{font-size:.75rem;color:var(--color-text-soft);margin-top:1px;}
  .admin-evt-list{margin-top:8px;}
  .admin-empty{text-align:center;color:var(--color-text-soft);font-style:italic;padding:24px 12px;font-size:.9rem;}
  .admin-empty-sm{padding:12px;font-size:.85rem;}

  /* type chips */
  .admin-type-grid{display:grid;grid-template-columns:repeat(2,1fr);gap:8px;}
  .admin-type-chip{min-height:44px;padding:8px 10px;border-radius:.65rem;border:1px solid var(--color-line);background:var(--color-card2);
    color:var(--color-text-soft);font-weight:600;font-size:.85rem;cursor:pointer;transition:all .15s ease;
    border-left:3px solid var(--c);}
  .admin-type-chip:hover{background:var(--color-line);}
  .admin-type-chip.on{background:color-mix(in srgb,var(--c) 22%,var(--color-card2));border-color:var(--c);color:#fff;
    box-shadow:0 0 0 1px var(--c);}

  /* itinerary builder */
  .admin-builder{margin-top:16px;padding-top:14px;border-top:1px dashed var(--color-line);}
  .admin-builder-head{display:flex;align-items:center;justify-content:space-between;margin-bottom:8px;}
  .admin-brows{display:flex;flex-direction:column;gap:8px;margin-bottom:10px;}
  .admin-brow{display:flex;gap:8px;align-items:center;}
  .admin-btime{max-width:170px;min-height:38px;font-size:.85rem;}
  .admin-btext{width:100%;min-width:0;}
  .admin-brow-ctrls{display:flex;gap:2px;flex-shrink:0;}
  .admin-brow-ctrls .admin-btn-icon{min-width:38px;padding:7px;font-size:.8rem;}
  .admin-dup{margin-top:12px;}
  .admin-dup-note{font-size:.76rem;color:var(--color-text-soft);margin-top:6px;line-height:1.45;}

  /* settings */
  .admin-settings{max-width:820px;margin:0 auto;display:flex;flex-direction:column;gap:18px;}
  .admin-card{background:var(--color-card);border:1px solid var(--color-line);border-radius:1rem;padding:20px;}
  .admin-card-title{font-weight:800;font-size:1.05rem;color:var(--color-text);margin-bottom:12px;}
  .admin-mini-title{font-size:.95rem;margin:18px 0 4px;}
  .admin-mini{font-size:.82rem;color:var(--color-text-soft);margin-bottom:10px;line-height:1.5;}
  .admin-preview{display:flex;align-items:center;gap:12px;margin:16px 0;padding:14px 16px;
    background:rgba(245,158,11,.08);border:1px solid rgba(245,158,11,.3);border-radius:.75rem;}
  .admin-preview-eyebrow{font-size:.7rem;font-weight:700;text-transform:uppercase;letter-spacing:.08em;color:var(--color-text-soft);}
  .admin-preview-label{font-family:Cinzel,serif;font-weight:800;font-size:1.15rem;color:#f59e0b;}

  /* danger zone */
  .admin-danger{border-color:rgba(239,68,68,.4);}
  .admin-danger.open{border-color:#ef4444;}
  .admin-danger-toggle{width:100%;display:flex;align-items:center;justify-content:space-between;
    background:none;border:none;color:#f87171;font-weight:800;font-size:1.05rem;cursor:pointer;padding:0;min-height:44px;}
  .admin-danger-caret{font-size:.9rem;}
  .admin-danger-body{margin-top:14px;}
  .admin-danger-text{color:var(--color-text-soft);font-size:.88rem;line-height:1.55;margin-bottom:14px;}
  .admin-nuke-word{color:#f87171;letter-spacing:.1em;}

  /* potw */
  .admin-potw{max-width:920px;margin:0 auto;display:flex;flex-direction:column;gap:16px;}
  .admin-potw-head{display:flex;align-items:center;justify-content:space-between;gap:12px;flex-wrap:wrap;}
  .admin-potw-list{display:flex;flex-direction:column;gap:12px;}
  .admin-potw-card{display:flex;flex-direction:column;gap:14px;padding:16px;background:var(--color-card);border:1px solid var(--color-line);
    border-radius:1rem;}
  .admin-potw-card.active{border-color:#f59e0b;box-shadow:0 0 22px rgba(245,158,11,.15);}
  .admin-potw-top{display:flex;align-items:flex-start;gap:16px;flex-wrap:wrap;}
  .admin-potw-info{flex:1;min-width:200px;}
  .admin-potw-title{font-weight:800;font-size:1.1rem;color:var(--color-text);display:flex;align-items:center;gap:10px;}
  .admin-potw-sub{color:var(--color-text-soft);font-size:.88rem;margin-top:2px;}
  .admin-potw-meta{color:var(--color-text-soft);font-size:.76rem;margin-top:6px;}
  .admin-potw-meta code,.admin-mini code,.admin-files code{background:var(--color-card2);padding:1px 6px;border-radius:.35rem;color:#fbbf24;font-size:.9em;}
  .admin-potw-actions{display:flex;gap:8px;flex-wrap:wrap;}
  .admin-badge{font-size:.65rem;font-weight:800;letter-spacing:.08em;background:#f59e0b;color:#0b0f19;
    padding:2px 8px;border-radius:.4rem;}
  .admin-date-badge{color:#22d3ee;font-weight:700;}
  .admin-date-badge.muted{color:var(--color-text-soft);font-weight:600;font-style:italic;}
  .admin-files pre{margin-top:10px;}
  .admin-code{background:var(--color-page);border:1px solid var(--color-line);border-radius:.6rem;padding:14px 16px;
    font-family:ui-monospace,SFMono-Regular,Menlo,monospace;font-size:.82rem;color:var(--color-text-soft);line-height:1.6;
    overflow-x:auto;white-space:pre;}

  /* media drop zones */
  .admin-drops{display:grid;grid-template-columns:1fr 1fr;gap:12px;}
  @media (max-width:640px){.admin-drops{grid-template-columns:1fr;}}
  .admin-drop{border:2px dashed var(--color-line);border-radius:.85rem;background:var(--color-page);padding:14px;cursor:pointer;
    min-height:88px;display:flex;flex-direction:column;gap:8px;transition:border-color .15s ease,background .15s ease;}
  .admin-drop:hover{border-color:#06b6d4;background:var(--color-card2);}
  .admin-drop.over{border-color:#06b6d4;border-style:solid;background:rgba(6,182,212,.12);box-shadow:0 0 0 1px #06b6d4;}
  .admin-drop-label{font-weight:700;font-size:.9rem;color:var(--color-text);}
  .admin-drop-body{display:flex;align-items:center;justify-content:space-between;gap:10px;flex-wrap:wrap;min-height:36px;}
  .admin-drop-prompt{color:var(--color-text-soft);font-size:.82rem;}
  .admin-drop-file{display:flex;flex-direction:column;min-width:0;flex:1;}
  .admin-drop-name{font-size:.85rem;color:#22d3ee;font-weight:600;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;max-width:100%;}
  .admin-drop-size{font-size:.72rem;color:var(--color-text-soft);}
  .admin-faint{color:var(--color-text-soft);font-weight:400;font-size:.78rem;}

  /* itinerary step numbers */
  .admin-bstep{flex-shrink:0;width:30px;height:30px;border-radius:50%;background:rgba(34,197,94,.15);
    border:1px solid #22c55e;color:#22c55e;font-weight:800;font-size:.95rem;display:flex;align-items:center;justify-content:center;}
  .admin-bfields{flex:1;min-width:0;display:flex;flex-direction:column;gap:6px;}
  .admin-chip-link{cursor:pointer;}
  .admin-chip-link:hover{filter:brightness(1.25);text-decoration:underline;}

  /* presentation editor */
  .admin-pres-seg{display:flex;gap:6px;flex-wrap:wrap;margin-bottom:12px;background:var(--color-page);}
  .admin-pres-opt{min-height:44px;padding:10px 14px;border:1px solid var(--color-line);border-radius:.7rem;background:var(--color-card2);
    color:var(--color-text-soft);font-weight:700;font-size:.9rem;cursor:pointer;display:inline-flex;align-items:center;gap:8px;
    transition:background .15s ease,border-color .15s ease,color .15s ease;}
  .admin-pres-opt:hover{background:var(--color-line);}
  .admin-pres-opt.on{background:#06b6d4;border-color:#06b6d4;color:#04222b;}
  .admin-pres-opt.feat{border-color:#06b6d4;}
  .admin-pres-opt.feat.on{box-shadow:0 0 0 1px #06b6d4,0 0 16px rgba(6,182,212,.35);}
  .admin-feat-chip{font-size:.62rem;font-weight:800;letter-spacing:.03em;text-transform:uppercase;
    background:rgba(6,182,212,.18);color:#22d3ee;border:1px solid rgba(6,182,212,.5);padding:2px 6px;border-radius:.4rem;}
  .admin-pres-opt.on .admin-feat-chip{background:rgba(4,34,43,.25);color:#04222b;border-color:rgba(4,34,43,.4);}
  .admin-pres-body{margin-bottom:4px;}
  .admin-pres-hint{margin-top:8px;padding:10px 12px;background:rgba(6,182,212,.08);border:1px solid rgba(6,182,212,.25);border-radius:.6rem;}
  .admin-pres-file{padding:12px;border:1px solid var(--color-line);border-radius:.7rem;background:var(--color-page);}
  .admin-pres-list{display:flex;flex-direction:column;gap:8px;margin:10px 0;}
  .admin-pres-thumb{display:flex;align-items:center;gap:10px;padding:8px;background:var(--color-card2);border:1px solid var(--color-line);border-radius:.7rem;}
  .admin-pres-num{background:rgba(6,182,212,.15);border-color:#06b6d4;color:#22d3ee;}
  .admin-pres-img{width:64px;height:40px;object-fit:cover;border-radius:.35rem;border:1px solid var(--color-line);flex-shrink:0;background:var(--color-page);}
  .admin-pres-name{flex:1;min-width:0;font-size:.85rem;color:var(--color-text);overflow:hidden;text-overflow:ellipsis;white-space:nowrap;}
  .admin-pres-tag{color:#22d3ee;font-weight:700;white-space:nowrap;}

  /* link rows (potw editor) */
  .admin-link-rows{display:flex;flex-direction:column;gap:8px;}
  .admin-link-row{display:grid;grid-template-columns:1fr 1.4fr auto;gap:6px;align-items:start;}
  .admin-link-row .admin-brow-ctrls{margin-top:2px;}
  @media (max-width:600px){.admin-link-row{grid-template-columns:1fr;}}
  .admin-input-err{border-color:#ef4444 !important;}

  /* flyover music (POTW editor) */
  .admin-flyover-block{margin-top:16px;padding-top:14px;border-top:1px solid var(--color-line);}

  /* quests tab */
  .admin-quests{max-width:920px;margin:0 auto;display:flex;flex-direction:column;gap:18px;}
  .admin-q-active-grid{display:grid;grid-template-columns:repeat(2,1fr);gap:12px;margin-top:8px;}
  @media (max-width:640px){.admin-q-active-grid{grid-template-columns:1fr;}}
  .admin-q-active{background:var(--color-page);border:1px solid var(--color-line);border-left:4px solid var(--house,var(--color-line));border-radius:.85rem;padding:14px;}
  .admin-q-active-head{font-weight:800;font-size:.95rem;margin-bottom:8px;}
  .admin-q-active-title{font-weight:700;color:var(--color-text);font-size:1rem;}
  .admin-q-active-desc{color:var(--color-text-soft);font-size:.8rem;line-height:1.45;margin-top:3px;}
  .admin-q-active-meta{color:var(--color-text-soft);font-size:.78rem;margin:6px 0 12px;}
  .admin-q-active-actions{display:flex;gap:8px;flex-wrap:wrap;}
  .admin-q-btn-note{font-weight:800;opacity:.75;font-size:.8em;}
  .admin-q-quiet{display:block;margin-top:10px;font-size:.78rem;text-align:left;}
  .admin-q-active-empty{color:var(--color-text-soft);font-size:.95rem;font-weight:700;text-align:center;padding:18px 0;}
  .admin-q-active-empty span{display:block;font-weight:500;font-size:.78rem;font-style:italic;margin-top:4px;}
  .admin-q-statusrow{margin-top:6px;}
  .admin-q-status{display:inline-block;font-size:.7rem;font-weight:800;letter-spacing:.05em;text-transform:uppercase;
    padding:3px 9px;border-radius:.4rem;}
  .admin-q-status.open{background:rgba(34,197,94,.14);border:1px solid rgba(34,197,94,.45);color:#22c55e;}
  .admin-q-status.held{background:color-mix(in srgb,var(--house) 20%,transparent);border:1px solid var(--house);color:var(--house);}
  .admin-q-status.retired{background:var(--color-card2);border:1px solid var(--color-line);color:var(--color-text-soft);}
  html[data-mode="light"] .admin-q-status.open{color:#166534;}
  .admin-q-list{display:flex;flex-direction:column;gap:8px;margin-top:8px;}
  .admin-q-row{display:flex;align-items:center;gap:14px;padding:12px 14px;background:var(--color-page);border:1px solid var(--color-line);border-radius:.85rem;}
  .admin-q-pts{flex-shrink:0;width:56px;text-align:center;font-weight:800;font-size:1.35rem;color:#f59e0b;line-height:1;}
  .admin-q-pts small{display:block;font-size:.6rem;font-weight:700;color:var(--color-text-soft);letter-spacing:.06em;text-transform:uppercase;margin-top:2px;}
  .admin-q-main{flex:1;min-width:0;}
  .admin-q-title{font-weight:700;color:var(--color-text);font-size:.95rem;}
  .admin-q-desc{color:var(--color-text-soft);font-size:.8rem;margin-top:3px;line-height:1.4;}
  .admin-q-row-actions{display:flex;gap:6px;flex-shrink:0;}
  .admin-q-done{display:flex;align-items:center;gap:12px;padding:10px 12px;background:var(--color-page);border:1px solid var(--color-line);border-radius:.75rem;}

  /* theme toggle */
  .admin-theme-seg{display:inline-flex;gap:6px;margin-bottom:6px;background:var(--color-page);}
  .admin-theme-opt{min-height:44px;padding:10px 20px;border:1px solid var(--color-line);border-radius:.7rem;background:var(--color-card2);
    color:var(--color-text-soft);font-weight:700;font-size:.9rem;cursor:pointer;transition:background .15s ease,color .15s ease,border-color .15s ease;}
  .admin-theme-opt:hover{background:var(--color-line);}
  .admin-theme-opt.on{background:#f59e0b;border-color:#f59e0b;color:#0b0f19;}
  .admin-toggle-row{display:flex;align-items:center;gap:12px;margin-bottom:6px;}
  .admin-toggle{width:52px;height:30px;min-height:30px;border-radius:999px;border:1px solid var(--color-line);background:var(--color-card2);
    position:relative;cursor:pointer;flex-shrink:0;padding:0;transition:background .18s ease,border-color .18s ease;}
  .admin-toggle-knob{position:absolute;top:3px;left:3px;width:22px;height:22px;border-radius:50%;background:var(--color-text-soft);transition:left .18s ease,background .18s ease;}
  .admin-toggle.on{background:#f59e0b;border-color:#f59e0b;}
  .admin-toggle.on .admin-toggle-knob{left:25px;background:#0b0f19;}
  .admin-key-row{display:flex;gap:8px;align-items:center;}
  .admin-key-row .admin-input{flex:1;min-width:0;}
  .admin-details{margin-top:10px;border:1px solid var(--color-line);border-radius:.6rem;background:var(--color-page);padding:0 12px;}
  .admin-details summary{cursor:pointer;padding:12px 0;font-weight:600;font-size:.85rem;color:#22d3ee;min-height:44px;display:flex;align-items:center;}
  .admin-steps{margin:0 0 12px 18px;padding:0;color:var(--color-text-soft);font-size:.82rem;line-height:1.6;display:flex;flex-direction:column;gap:4px;}
  .admin-steps code{background:var(--color-card2);padding:1px 6px;border-radius:.35rem;color:#fbbf24;}

  /* background music (Settings tab) */
  .admin-music-volume{width:100%;max-width:360px;accent-color:#f59e0b;height:30px;}
  .admin-music-list{display:flex;flex-direction:column;gap:8px;margin-top:12px;}
  .admin-music-row{padding:10px 12px;background:var(--color-page);border:1px solid var(--color-line);border-radius:.75rem;}
  .admin-music-name{font-weight:700;color:var(--color-text);font-size:.88rem;margin-bottom:8px;}
  .admin-music-controls{display:grid;grid-template-columns:1fr 1.4fr auto auto;gap:8px;align-items:center;}
  .admin-music-controls .admin-music-pick{min-width:0;}
  .admin-music-controls .admin-music-path{min-width:0;font-family:monospace;font-size:.82rem;}
  @media (max-width:760px){.admin-music-controls{grid-template-columns:1fr 1fr;}}
  .admin-music-error{margin-top:6px;font-size:.78rem;color:#ef4444;font-weight:600;}
  .admin-music-suggested{margin-top:14px;padding:12px;background:var(--color-page);border:1px dashed var(--color-line);border-radius:.75rem;}
  .admin-music-vol-row{margin-top:10px;}
  .admin-music-vol-label{margin:0 0 4px;}
  .admin-music-screen-volume{width:100%;max-width:360px;accent-color:#f59e0b;height:26px;}
  .admin-music-screen-volume:disabled{opacity:.4;cursor:not-allowed;}
  .admin-music-caveat{margin-top:6px;}

  /* modals */
  #admin-modal-root:empty{display:none;}
  .admin-modal-bg{position:fixed;inset:0;z-index:80;background:rgba(0,0,0,.65);backdrop-filter:blur(3px);
    animation:admin-fade .2s ease both;}
  @keyframes admin-fade{from{opacity:0;}to{opacity:1;}}
  .admin-modal{position:fixed;top:50%;left:50%;transform:translate(-50%,-50%);z-index:81;
    width:min(560px,94vw);max-height:90vh;background:var(--color-card);border:1px solid var(--color-line);border-radius:1.25rem;
    display:flex;flex-direction:column;box-shadow:0 30px 80px rgba(0,0,0,.6);animation:admin-pop .22s ease both;}
  .admin-modal-lg{width:min(760px,96vw);}
  .admin-modal-danger{border-color:#ef4444;box-shadow:0 30px 80px rgba(0,0,0,.6),0 0 40px rgba(239,68,68,.2);}
  @keyframes admin-pop{from{opacity:0;transform:translate(-50%,-46%) scale(.96);}to{opacity:1;transform:translate(-50%,-50%) scale(1);}}
  .admin-modal-head{display:flex;align-items:center;justify-content:space-between;padding:18px 22px;border-bottom:1px solid var(--color-card2);}
  .admin-modal-title{font-family:Cinzel,serif;font-weight:800;font-size:1.2rem;color:#f59e0b;}
  .admin-modal-body{padding:18px 22px;overflow-y:auto;}
  .admin-modal-scroll{max-height:64vh;}
  .admin-modal-lead{color:var(--color-text-soft);font-size:.9rem;line-height:1.55;margin-bottom:8px;}
  .admin-modal-foot{display:flex;gap:10px;justify-content:flex-end;padding:16px 22px;border-top:1px solid var(--color-card2);}
  .admin-dow-picker{display:flex;gap:8px;flex-wrap:wrap;}
  .admin-check{display:inline-flex;align-items:center;gap:6px;padding:8px 12px;min-height:44px;background:var(--color-card2);
    border:1px solid var(--color-line);border-radius:.6rem;cursor:pointer;font-size:.85rem;color:var(--color-text);}
  .admin-check input{width:18px;height:18px;accent-color:#f59e0b;}
  .admin-rows-head{display:flex;align-items:center;justify-content:space-between;gap:10px;margin:18px 0 8px;}
  .admin-srows,.admin-qrows{display:flex;flex-direction:column;gap:8px;}
  .admin-srow{display:grid;grid-template-columns:64px 1fr 1.6fr 44px;gap:6px;align-items:center;}
  .admin-qrow{display:grid;grid-template-columns:1fr 1fr 44px;gap:6px;align-items:center;}
  @media (max-width:600px){.admin-srow,.admin-qrow{grid-template-columns:1fr;}}

  /* dice tab (Die of Destiny prophecy table) */
  .admin-dice-rows{display:flex;flex-direction:column;gap:10px;}
  .admin-dice-row{display:grid;grid-template-columns:96px 56px 1fr 96px auto;gap:10px;align-items:center;
    padding:10px 12px;background:var(--color-page);border:1px solid var(--color-line);border-radius:.7rem;}
  .admin-dice-range{font-size:.78rem;font-weight:700;color:var(--color-text-soft);text-align:center;
    background:var(--color-card2);border-radius:.4rem;padding:8px 4px;}
  .admin-dice-emoji{text-align:center;font-size:1.1rem;padding-left:4px;padding-right:4px;}
  .admin-dice-main{display:flex;flex-direction:column;gap:6px;min-width:0;}
  .admin-dice-points{display:flex;flex-direction:column;gap:2px;}
  @media (max-width:760px){.admin-dice-row{grid-template-columns:1fr;}}

  /* shop tab */
  .admin-key-row .admin-btn{flex-shrink:0;}
  .admin-shop-row{display:flex;align-items:center;gap:14px;padding:12px 14px;background:var(--color-page);border:1px solid var(--color-line);border-radius:.85rem;}
  .admin-shop-thumb{flex-shrink:0;width:48px;height:48px;border-radius:.6rem;background:var(--color-card2);border:1px solid var(--color-line);display:flex;align-items:center;justify-content:center;overflow:hidden;}
  .admin-shop-emoji{font-size:1.6rem;line-height:1;}
  .admin-shop-thumb-img{width:100%;height:100%;object-fit:cover;}
  .admin-shop-effect{font-size:.76rem;color:var(--color-text-soft);margin-top:4px;font-weight:600;}
  .admin-shop-cost{flex-shrink:0;width:56px;text-align:center;font-weight:800;font-size:1.35rem;color:#f59e0b;line-height:1;}
  .admin-shop-cost small{display:block;font-size:.6rem;font-weight:700;color:var(--color-text-soft);letter-spacing:.06em;text-transform:uppercase;margin-top:2px;}
  .admin-award-pts.pos{color:#22c55e;}
  .admin-award-pts.neg{color:#ef4444;}
  .admin-eff-group{display:flex;flex-direction:column;gap:8px;margin-bottom:4px;}
  .admin-eff-opt{display:grid;grid-template-columns:auto 1fr;gap:4px 12px;align-items:center;padding:12px 14px;border:1px solid var(--color-line);border-radius:.7rem;background:var(--color-card2);cursor:pointer;transition:border-color .15s ease,box-shadow .15s ease;}
  .admin-eff-opt.on{border-color:#f59e0b;box-shadow:0 0 0 1px #f59e0b;}
  .admin-eff-opt input{grid-row:1/3;width:20px;height:20px;accent-color:#f59e0b;align-self:center;}
  .admin-eff-label{font-weight:700;color:var(--color-text);}
  .admin-eff-explain{grid-column:2;font-size:.8rem;color:var(--color-text-soft);line-height:1.35;}
  .admin-shop-imgprev{display:flex;align-items:center;gap:12px;padding:12px;border:1px solid var(--color-line);border-radius:.7rem;background:var(--color-page);}
  .admin-shop-imgprev-img{width:56px;height:56px;object-fit:cover;border-radius:.5rem;border:1px solid var(--color-line);}

  /* video & assets (potw card) */
  .admin-drops-one{grid-template-columns:1fr;max-width:420px;}
  .admin-va-title{font-weight:700;font-size:.95rem;color:var(--color-text);margin-bottom:8px;}
  .admin-assets-label{font-weight:600;font-size:.85rem;color:var(--color-text);margin:6px 0;}
  .admin-assets-drop{min-height:64px;}
  .admin-pres-block{border:1px solid rgba(6,182,212,.4);background:rgba(6,182,212,.06);border-radius:.85rem;padding:14px;margin-bottom:6px;}
  .admin-pres-drop{border-color:#06b6d4;background:var(--color-page);}
  .admin-arrival{margin-bottom:10px;}
  .admin-arrival-badge{display:inline-block;font-size:.82rem;font-weight:700;padding:6px 12px;border-radius:.5rem;}
  .admin-arrival-badge.ok{background:rgba(34,197,94,.15);border:1px solid #22c55e;color:#22c55e;}
  .admin-arrival-badge.none{background:var(--color-card2);border:1px solid var(--color-line);color:var(--color-text-soft);}
  .admin-arrival-badge.warn{background:rgba(239,68,68,.16);border:1px solid #ef4444;color:#fca5a5;
    animation:admin-warn-pulse 2.4s ease-in-out infinite;}
  @keyframes admin-warn-pulse{0%,100%{box-shadow:0 0 0 0 rgba(239,68,68,.35);}50%{box-shadow:0 0 0 5px rgba(239,68,68,0);}}
  html[data-mode="light"] .admin-arrival-badge.warn{color:#b91c1c;background:rgba(239,68,68,.1);}
  .admin-secondary{opacity:.92;}

  /* guided form steps (POTW) */
  .admin-step{padding:16px 0;border-bottom:1px solid var(--color-line);}
  .admin-step:last-child{border-bottom:none;}
  .admin-step-title{display:flex;align-items:center;gap:10px;font-weight:800;font-size:1rem;color:var(--color-text);margin-bottom:4px;}
  .admin-step-num{flex-shrink:0;width:26px;height:26px;border-radius:50%;background:#f59e0b;color:#0b0f19;
    font-size:.85rem;font-weight:800;display:inline-flex;align-items:center;justify-content:center;}
  .admin-step-hint{font-size:.83rem;color:var(--color-text-soft);line-height:1.5;margin-bottom:10px;}
  .admin-input-sm{font-size:.88rem;}
  .admin-ok-line{margin-top:8px;padding:8px 12px;border-radius:.5rem;background:rgba(34,197,94,.12);
    border:1px solid rgba(34,197,94,.45);color:#22c55e;font-size:.85rem;font-weight:600;}
  .admin-warn-line{margin-top:8px;padding:8px 12px;border-radius:.5rem;background:rgba(245,158,11,.1);
    border:1px solid rgba(245,158,11,.4);color:var(--color-text);font-size:.83rem;line-height:1.5;}
  .admin-linkbtn{background:none;border:none;padding:0;color:#22d3ee;font:inherit;text-decoration:underline;cursor:pointer;}
  .admin-extras > summary{font-weight:800;font-size:1rem;color:var(--color-text);gap:10px;}
  .admin-potw-week{margin-top:6px;}
  .admin-week-line{font-size:.85rem;font-weight:700;color:var(--color-text);}
  .admin-week-line.none{color:var(--color-text-soft);font-weight:600;font-style:italic;}
  .admin-playing-badge{font-size:.68rem;font-weight:800;letter-spacing:.04em;background:#22c55e;color:#04220f;
    padding:3px 9px;border-radius:.4rem;white-space:nowrap;}
  html[data-mode="light"] .admin-ok-line{color:#15803d;}
  html[data-mode="light"] .admin-linkbtn{color:#0e7490;}
  .admin-assets{display:flex;flex-direction:column;gap:6px;margin-top:8px;}
  .admin-asset-row{display:flex;align-items:center;gap:10px;padding:8px 10px;background:var(--color-card2);border:1px solid var(--color-line);border-radius:.6rem;}
  .admin-asset-icon{font-size:1.2rem;flex-shrink:0;}
  .admin-asset-name{flex:1;min-width:0;font-size:.85rem;color:var(--color-text);overflow:hidden;text-overflow:ellipsis;white-space:nowrap;}
  .admin-asset-size{font-size:.72rem;color:var(--color-text-soft);flex-shrink:0;}

  /* defenses (shields + damage reduction) */
  .admin-shield-list{display:flex;flex-direction:column;gap:8px;margin-top:10px;}
  .admin-shield-row{display:flex;flex-direction:column;gap:8px;padding:12px 14px;background:var(--color-page);
    border:1px solid var(--color-line);border-left:4px solid var(--house,var(--color-line));border-radius:.85rem;}
  .admin-shield-emoji{font-size:1.4rem;flex-shrink:0;}
  .admin-def-house{font-weight:800;font-size:1rem;}
  .admin-def-lines{display:flex;flex-direction:column;gap:6px;}
  .admin-inv-grid{display:flex;flex-wrap:wrap;gap:6px;}
  .admin-inv-chip{display:flex;align-items:center;gap:8px;padding:6px 8px;border-radius:.6rem;
    border:1px solid rgba(148,163,184,.28);background:rgba(30,41,59,.5);}
  .admin-inv-emoji{font-size:18px;line-height:1;}
  .admin-inv-name{font-weight:700;font-size:13px;}
  .admin-def-line{display:flex;align-items:center;gap:12px;}
  .admin-def-name{font-weight:700;font-size:.9rem;color:var(--color-text);}

  /* shop groups + mythic */
  .admin-shop-group{margin-top:16px;}
  .admin-shop-group-head{display:flex;align-items:baseline;justify-content:space-between;gap:12px;flex-wrap:wrap;
    padding-bottom:6px;border-bottom:1px solid var(--color-line);}
  .admin-shop-group-title{font-weight:800;font-size:.95rem;color:var(--color-text);}
  .admin-shop-row.mythic{border-color:rgba(245,158,11,.5);background:rgba(245,158,11,.05);}
  .admin-mythic-badge{font-size:.62rem;font-weight:800;letter-spacing:.06em;background:#f59e0b;color:#0b0f19;
    padding:2px 7px;border-radius:.4rem;white-space:nowrap;}
  .admin-shop-free{font-size:1.1rem;color:var(--color-text-soft);}
  .admin-mythic-note{font-size:.78rem;color:var(--color-text-soft);line-height:1.45;padding:8px 10px;
    background:rgba(245,158,11,.08);border:1px solid rgba(245,158,11,.3);border-radius:.5rem;}
  .admin-mythic-check{margin-top:14px;width:100%;justify-content:flex-start;}
  .admin-shop-plain{font-size:.8rem;color:var(--color-text-soft);margin-top:4px;line-height:1.45;}

  /* "How magic items work" guide */
  .admin-guide > summary{font-weight:800;font-size:1rem;color:var(--color-text);}
  .admin-guide-body{padding-bottom:12px;}
  .admin-guide-p{font-size:.86rem;color:var(--color-text-soft);line-height:1.55;margin:0 0 8px;}
  .admin-guide-p b{color:var(--color-text);}
  .admin-guide-callout{margin:12px 0;padding:12px 14px;border-radius:.6rem;font-size:.84rem;line-height:1.55;
    background:rgba(245,158,11,.1);border:1px solid rgba(245,158,11,.4);color:var(--color-text);}
  .admin-guide-tablewrap{margin-top:14px;overflow-x:auto;}
  .admin-guide-tabletitle{font-weight:700;font-size:.85rem;color:var(--color-text);margin-bottom:6px;}
  .admin-matchup{border-collapse:collapse;width:100%;min-width:420px;font-size:.84rem;}
  .admin-matchup th,.admin-matchup td{border:1px solid var(--color-line);padding:8px 12px;text-align:center;}
  .admin-matchup th{background:var(--color-card2);color:var(--color-text);font-weight:700;}
  .admin-matchup td{color:var(--color-text);}
  .admin-mu-row{text-align:left !important;font-weight:600;color:var(--color-text-soft) !important;}
  .admin-mu-block{color:#22c55e !important;font-weight:700;}
  html[data-mode="light"] .admin-mu-block{color:#166534 !important;}

  /* per-kind guidance + live preview in the editor */
  .admin-kind-guide{margin-top:10px;padding:12px 14px;border-radius:.7rem;background:var(--color-page);
    border:1px solid var(--color-line);display:flex;flex-direction:column;gap:7px;}
  .admin-kind-guide-row{display:grid;grid-template-columns:104px 1fr;gap:10px;align-items:baseline;font-size:.84rem;
    color:var(--color-text);line-height:1.5;}
  @media (max-width:600px){.admin-kind-guide-row{grid-template-columns:1fr;gap:2px;}}
  .admin-kind-tag{font-size:.66rem;font-weight:800;letter-spacing:.06em;text-transform:uppercase;color:var(--color-text-soft);}
  .admin-kind-example{font-style:italic;color:var(--color-text-soft);}
  .admin-shop-preview{flex-direction:column;align-items:flex-start;gap:6px;}
  .admin-shop-preview-text{font-size:.9rem;font-weight:600;color:var(--color-text);line-height:1.55;}
  .admin-save-err{border-color:#ef4444;background:rgba(239,68,68,.12);}

  /* backup */
  .admin-backup-row{display:flex;gap:10px;flex-wrap:wrap;}
  .admin-auto-head{font-weight:700;font-size:.9rem;color:var(--color-text);margin:4px 0 8px;}
  .admin-hr{border:none;border-top:1px solid var(--color-line);margin:18px 0;}
  .admin-auto-note{padding:12px 14px;border-radius:.7rem;font-size:.85rem;line-height:1.5;}
  .admin-auto-warn{background:rgba(245,158,11,.08);border:1px solid rgba(245,158,11,.3);color:var(--color-text);}
  .admin-auto-status{display:flex;align-items:center;gap:8px;flex-wrap:wrap;font-size:.88rem;font-weight:600;color:var(--color-text);margin-bottom:10px;}
  .admin-auto-dot{width:10px;height:10px;border-radius:50%;flex-shrink:0;}
  .admin-auto-dot.ok{background:#22c55e;box-shadow:0 0 8px rgba(34,197,94,.6);}
  .admin-auto-dot.warn{background:#f59e0b;box-shadow:0 0 8px rgba(245,158,11,.6);}

  /* help tab + contextual "❓ How this works" links */
  .admin-help-row{margin-top:10px;}
  .admin-help-link{display:inline-flex;align-items:center;gap:6px;min-height:38px;padding:7px 14px;
    border-radius:999px;border:1px solid rgba(34,211,238,.45);background:rgba(34,211,238,.08);
    color:#22d3ee;font-family:inherit;font-weight:700;font-size:.82rem;cursor:pointer;
    transition:background .15s ease,border-color .15s ease;}
  .admin-help-link:hover{background:rgba(34,211,238,.18);border-color:#22d3ee;}
  html[data-mode="light"] .admin-help-link{color:#0e7490;border-color:rgba(14,116,144,.45);}
  .admin-help-grid{display:grid;grid-template-columns:repeat(auto-fit,minmax(280px,1fr));gap:12px;margin-top:14px;}
  .admin-help-card{display:flex;align-items:flex-start;gap:12px;text-align:left;padding:14px 16px;
    border:1px solid var(--color-line);border-radius:.85rem;background:var(--color-page);cursor:pointer;
    font-family:inherit;transition:border-color .15s ease,background .15s ease,transform .1s ease;}
  .admin-help-card:hover{border-color:#22d3ee;background:var(--color-card2);}
  .admin-help-card:active{transform:scale(.985);}
  .admin-help-icon{font-size:1.5rem;line-height:1;flex-shrink:0;}
  .admin-help-body{display:flex;flex-direction:column;gap:3px;min-width:0;}
  .admin-help-title{font-weight:800;font-size:.95rem;color:var(--color-text);}
  .admin-help-note{font-size:.8rem;color:var(--color-text-soft);line-height:1.45;}

  /* toast */
  .admin-toast{position:fixed;bottom:24px;left:50%;transform:translateX(-50%);z-index:90;
    background:var(--color-card2);border:1px solid #f59e0b;color:var(--color-text);padding:12px 22px;border-radius:.75rem;
    font-weight:600;font-size:.9rem;box-shadow:0 12px 40px rgba(0,0,0,.5);animation:admin-toast-in .25s ease both;}
  @keyframes admin-toast-in{from{opacity:0;transform:translate(-50%,12px);}to{opacity:1;transform:translate(-50%,0);}}

  /* light-mode contrast fixes: darken amber/cyan/green accents that read too
     light on white. Values are one shade darker than the raw palette hues
     (which stay unchanged for identity work — borders, dots, tinted chips) so
     plain body text clears 4.5:1 (or 3:1 for the large/bold headings) on the
     white/near-white surfaces light mode uses. */
  html[data-mode="light"] .admin-title,
  html[data-mode="light"] .admin-q-pts,
  html[data-mode="light"] .admin-shop-cost,
  html[data-mode="light"] .admin-preview-label,
  html[data-mode="light"] .admin-modal-title,
  html[data-mode="light"] .admin-panel-eyebrow,
  html[data-mode="light"] .admin-potw-meta code,
  html[data-mode="light"] .admin-mini code,
  html[data-mode="light"] .admin-files code,
  html[data-mode="light"] .admin-steps code{color:#92400e;}
  html[data-mode="light"] .admin-date-badge,
  html[data-mode="light"] .admin-drop-name,
  html[data-mode="light"] .admin-pres-tag,
  html[data-mode="light"] .admin-feat-chip,
  html[data-mode="light"] .admin-pres-num,
  html[data-mode="light"] .admin-details summary{color:#155e75;}
  html[data-mode="light"] .admin-arrival-badge.ok{color:#166534;border-color:#166534;}

  /* light-mode: a house's accent colour is identity (border/dot/chip), never
     body text — swap the text to the theme's normal text colour instead of
     the raw palette hue, which reads at ~2:1 on white. Background/border tints
     driven by the same --house/--c variables are untouched. */
  html[data-mode="light"] .admin-q-active-head,
  html[data-mode="light"] .admin-q-title,
  html[data-mode="light"] .admin-def-house,
  html[data-mode="light"] .admin-house-preview-name,
  html[data-mode="light"] .admin-house-name-accent,
  html[data-mode="light"] .admin-q-status.held{color:var(--color-text) !important;}
  /* calendar/day-planner chips: same principle — the event-type colour tints
     the chip's background and border (identity), the label itself reads in
     the normal text colour. */
  html[data-mode="light"] .admin-chip,
  html[data-mode="light"] .admin-type-chip.on{color:var(--color-text) !important;}
  html[data-mode="light"] .admin-cell.today .admin-cell-num{color:#92400e;}

  /* light-mode: hardcoded semantic reds/blues/greens that were tuned for the
     dark palette and read too pale on white. */
  html[data-mode="light"] .admin-btn-danger,
  html[data-mode="light"] .admin-danger-toggle,
  html[data-mode="light"] .admin-nuke-word,
  html[data-mode="light"] .admin-award-pts.neg{color:#b91c1c;}
  html[data-mode="light"] .admin-btn-nuke{background:#b91c1c;border-color:#b91c1c;}
  html[data-mode="light"] .admin-btn-nuke:hover:not(:disabled){background:#991b1b;}
  html[data-mode="light"] .admin-btn-secondary{color:#1d4ed8;}
  html[data-mode="light"] .admin-btn-accent{color:#92400e;}
  html[data-mode="light"] .admin-award-pts.pos{color:#166534;}

  /* houses editor (Settings tab) */
  .admin-house-crest{flex-shrink:0;width:48px;height:48px;border-radius:.6rem;background:var(--color-card2);
    border:1px solid var(--color-line);display:flex;align-items:center;justify-content:center;overflow:hidden;}
  .admin-house-crest-img{width:100%;height:100%;object-fit:contain;}
  .admin-house-crest-lg{width:72px;height:72px;border-radius:.75rem;}
  .admin-house-swatch{flex-shrink:0;width:32px;height:32px;border-radius:50%;border:2px solid var(--color-line);box-shadow:0 0 0 2px var(--color-page) inset;}
  .admin-house-swatch-lg{width:44px;height:44px;}
  .admin-house-preview{display:flex;align-items:center;gap:14px;margin-bottom:16px;padding:14px 16px;
    background:var(--color-page);border:1px solid var(--color-line);border-radius:.85rem;}
  .admin-house-preview-name{font-family:Cinzel,serif;font-weight:800;font-size:1.1rem;}
  .admin-house-preview-motto{font-size:.82rem;color:var(--color-text-soft);font-style:italic;}
  .admin-color-swatch-input{width:56px;height:44px;padding:2px;flex-shrink:0;border-radius:.5rem;
    border:1px solid var(--color-line);background:none;cursor:pointer;}

  /* intro video presets (Place of the Week tab) */
  .admin-video-thumb{font-size:1.4rem;}
  .admin-video-url{font-family:monospace;font-size:.76rem;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;max-width:100%;}

  @media (prefers-reduced-motion:reduce){
    .admin-panel,.admin-modal,.admin-modal-bg,.admin-toast{animation:none;}
  }`;
  document.head.appendChild(s);
}

// ===========================================================================
// Module contract
// ===========================================================================
export default {
  id: 'admin',
  title: "Teacher's Admin",
  icon: '🗝️',
  order: 90,
  showTile: false,

  mount(elRoot, ctx) {
    ctxRef = ctx;
    rootEl = elRoot;
    injectStyles();

    const now = new Date();
    cal.year = now.getFullYear();
    cal.month = now.getMonth();
    activeTab = 'planner';
    panelView = null; form = null; potwForm = null; questForm = null; houseForm = null; videoForm = null; awardForm = null; dangerOpen = false;
    helpState = null;

    renderShell();

    clickHandler = onClick;
    rootEl.addEventListener('click', clickHandler);

    // input change: effect radios, import-file picker, media/shop/asset file inputs
    changeHandler = (e) => {
      if (e.target.id === 'admin-combat-attacker') {
        combatPreviewSel.attacker = Number(e.target.value);
        updateCombatPreview();
        return;
      }
      if (e.target.id === 'admin-combat-defender') {
        combatPreviewSel.defender = Number(e.target.value);
        updateCombatPreview();
        return;
      }
      if (e.target.classList && e.target.classList.contains('admin-music-pick')) {
        const screen = e.target.dataset.screen;
        const val = e.target.value;
        if (!val) return; // "Pick a known file…" placeholder — no-op
        setScreenTrack(screen, val);
        showMusicError(screen, '');
        renderBody({ force: true });
        toast('Track assigned.');
        return;
      }
      if (e.target.classList && e.target.classList.contains('admin-music-path')) {
        const screen = e.target.dataset.screen;
        const val = e.target.value.trim();
        setScreenTrack(screen, val || null);
        showMusicError(screen, '');
        renderBody({ force: true });
        return;
      }
      if (e.target.classList && e.target.classList.contains('admin-sfx-path')) {
        const name = e.target.dataset.sfx;
        const val = e.target.value.trim();
        ctxRef.store.setSfx(name, val);
        renderBody({ force: true });
        toast(val ? 'Sound file assigned.' : 'Reset to the built-in sound.');
        return;
      }
      if (e.target.name === 'admin-eff') { syncShopFromDom(); shopForm.effectKind = e.target.value; renderShopModal(); return; }
      if (e.target.name === 'admin-quest-repeat') { syncQuestFromDom(); questForm.repeatable = e.target.value === '1'; renderQuestModal(); return; }
      if (e.target.id === 'admin-shop-mythic') { syncShopFromDom(); shopForm.mythicOnly = e.target.checked; renderShopModal(); return; }
      if (e.target.id === 'admin-shop-anon') { syncShopFromDom(); renderShopModal(); return; }
      if (e.target.classList && e.target.classList.contains('admin-counter-check')) { syncShopFromDom(); renderShopModal(); return; }
      if (e.target.id === 'admin-import-file') { const f = e.target.files && e.target.files[0]; if (f) importBackup(f); e.target.value = ''; return; }
      const inp = e.target.closest('input.admin-file');
      if (!inp) return;
      const files = inp.files;
      if (files && files.length) {
        if (inp.dataset.shopimg) stageShopImage(files[0]);
        else if (inp.dataset.presdrop) handlePresDrop(inp.dataset.presdrop, files[0]);
        else if (inp.dataset.assets) handleAssetFiles(inp.dataset.assets, files);
        else if (inp.dataset.pres) handlePresFiles(inp.dataset.pres, files);
        else if (inp.dataset.flyover) stageFlyoverFile(files[0]);
        else handleMediaFile(inp.dataset.mkey, files[0]);
      }
      inp.value = ''; // allow re-picking the same file
    };
    rootEl.addEventListener('change', changeHandler);

    // live plain-English preview in the shop editor as cost/amount are typed
    inputHandler = (e) => {
      if (e.target.id === 'admin-combat-gapshare') {
        ctxRef.store.updateCombat({ gapShare: Math.max(0, Math.min(100, Number(e.target.value) || 0)) });
        updateCombatPreview();
      }
      else if (e.target.id === 'admin-combat-percent') {
        ctxRef.store.updateCombat({ prizePercent: Math.max(0, Math.min(100, Number(e.target.value) || 0)) });
        updateCombatPreview();
      }
      else if (e.target.id === 'admin-combat-flat') {
        ctxRef.store.updateCombat({ prizeFlat: Math.max(0, Number(e.target.value) || 0) });
        updateCombatPreview();
      }
      else if (e.target.id === 'admin-combat-hpbase') {
        ctxRef.store.updateCombat({ hpBase: Math.max(1, Number(e.target.value) || 1) });
        updateCombatHpList();
      }
      else if (e.target.id === 'admin-combat-hpper500') {
        ctxRef.store.updateCombat({ hpPer500: Math.max(0, Number(e.target.value) || 0) });
        updateCombatHpList();
      }
      // No clamping here on purpose — updateCombat() owns the range. Clamping in
      // the form as well is how prizeFlat ended up with a floor and no ceiling.
      else if (e.target.id === 'admin-combat-teacher') {
        ctxRef.store.updateCombat({ teacherScore: e.target.value });
      }
      else if (e.target.id === 'admin-ambient-volume') {
        const pct = Number(e.target.value);
        const label = el('admin-ambient-vol-label');
        if (label) label.textContent = `${pct}%`;
        // Applies immediately — ambient.js re-reads settings on every store
        // change, so this alone re-tunes whatever is currently playing.
        ctxRef.store.updateAmbient({ volume: Math.min(1, Math.max(0, pct / 100)) });
      }
      else if (e.target.classList && e.target.classList.contains('admin-music-screen-volume')) {
        const screen = e.target.dataset.screen;
        const pct = Number(e.target.value);
        const label = el(`admin-music-vol-num-${screen}`);
        if (label) label.textContent = `${pct}%`;
        // Applies immediately, same as the master slider above.
        setScreenVolume(screen, pct);
      }
      else if (e.target.id === 'admin-shop-cost' || e.target.id === 'admin-shop-amount'
        || e.target.id === 'admin-shop-dice' || e.target.id === 'admin-shop-mult' || e.target.id === 'admin-shop-targets') updateShopPreview();
      else if (e.target.id === 'admin-quest-points') updateQuestPreview({ pointsChanged: true });
      else if (e.target.id === 'admin-quest-penalty') { if (questForm) questForm.penaltyTouched = true; updateQuestPreview(); }
      else if (e.target.id === 'admin-quest-icon') updateQuestIconPreview();
      else if (e.target.id === 'admin-award-points') updateAwardPreview();
      else if (e.target.id === 'admin-house-name' || e.target.id === 'admin-house-motto' || e.target.id === 'admin-house-image') updateHousePreview();
      else if (e.target.id === 'admin-house-accent-color') {
        const hex = e.target.value;
        if (el('admin-house-accent-hex')) el('admin-house-accent-hex').value = hex;
        updateHouseAccentPreview(hex);
      } else if (e.target.id === 'admin-house-accent-hex') {
        const norm = hexNorm(e.target.value);
        if (isHex(norm)) {
          if (el('admin-house-accent-color')) el('admin-house-accent-color').value = norm;
          updateHouseAccentPreview(norm);
        }
      }
      else if (e.target.classList && e.target.classList.contains('admin-mct-color')) {
        // Writes straight to the store — shell.js re-reads the accent on the
        // next store change, so no local CSS-variable trick is needed here.
        const id = e.target.dataset.module;
        const hex = e.target.value;
        ctxRef.store.setModuleTheme(id, { color: hex });
        // Update the "used right now" swatch directly rather than waiting on a
        // full renderBody(), which the mid-typing guard would skip anyway
        // while this color input still has focus.
        const sw = el(`admin-mct-swatch-${id}`);
        if (sw) sw.style.background = hex;
      }
      else if (e.target.dataset && e.target.dataset.diceId) {
        // Prophecy table rows save straight to the store as the teacher types,
        // same live-write pattern as the battle-rules and colour fields above.
        // The store clamps/validates (saveDiceOutcome), so a stray keystroke
        // here can never save something the dice screen would choke on.
        ctxRef.store.saveDiceOutcome(e.target.dataset.diceId, { [e.target.dataset.diceField]: e.target.value });
      }
    };
    rootEl.addEventListener('input', inputHandler);

    // drag-and-drop for media drop zones
    dragOverHandler = (e) => { const z = e.target.closest('.admin-drop'); if (z) { e.preventDefault(); z.classList.add('over'); } };
    dragLeaveHandler = (e) => { const z = e.target.closest('.admin-drop'); if (z && !z.contains(e.relatedTarget)) z.classList.remove('over'); };
    dropHandler = (e) => {
      const z = e.target.closest('.admin-drop');
      if (!z) return;
      e.preventDefault();
      z.classList.remove('over');
      const files = e.dataTransfer && e.dataTransfer.files;
      if (!files || !files.length) return;
      if (z.dataset.shopimg) stageShopImage(files[0]);
      else if (z.dataset.presdrop) handlePresDrop(z.dataset.presdrop, files[0]);
      else if (z.dataset.assets) handleAssetFiles(z.dataset.assets, files);
      else if (z.dataset.pres) handlePresFiles(z.dataset.pres, files);
      else if (z.dataset.flyover) stageFlyoverFile(files[0]);
      else handleMediaFile(z.dataset.mkey, files[0]);
    };
    rootEl.addEventListener('dragover', dragOverHandler);
    rootEl.addEventListener('dragleave', dragLeaveHandler);
    rootEl.addEventListener('drop', dropHandler);

    // keep the auto-backup "last saved …" line and the Active Defenses
    // countdowns live (writes don't emit store changes). Backup status only
    // exists on Settings; shield/reduction timers now live on Battle Day.
    backupStatusTimer = setInterval(() => {
      if (activeTab === 'settings') updateBackupStatusLine();
      if (activeTab === 'battle') updateShieldTimes();
    }, 5000);

    unsub = ctx.store.subscribe(() => { renderBody(); });
  },

  unmount() {
    clearTimers();
    stopMusicPreview();
    if (unsub) { try { unsub(); } catch (e) {} unsub = null; }
    if (rootEl) {
      if (clickHandler) rootEl.removeEventListener('click', clickHandler);
      if (changeHandler) rootEl.removeEventListener('change', changeHandler);
      if (inputHandler) rootEl.removeEventListener('input', inputHandler);
      if (dragOverHandler) rootEl.removeEventListener('dragover', dragOverHandler);
      if (dragLeaveHandler) rootEl.removeEventListener('dragleave', dragLeaveHandler);
      if (dropHandler) rootEl.removeEventListener('drop', dropHandler);
    }
    if (backupStatusTimer) { clearInterval(backupStatusTimer); backupStatusTimer = null; }
    revokePresUrls();
    revokeShopUrls();
    const st = el('admin-styles');
    if (st) st.remove();
    // stray fixed-position panels/modals/toasts live inside rootEl; registry clears
    // #module-root on navigate, but null our refs so nothing dangles.
    rootEl = null; ctxRef = null;
    clickHandler = changeHandler = dragOverHandler = dragLeaveHandler = dropHandler = inputHandler = null;
    panelView = null; form = null; potwForm = null; shopForm = null; questForm = null; houseForm = null; videoForm = null; awardForm = null;
  },
};
