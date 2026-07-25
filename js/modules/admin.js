// admin.js — Teacher's Admin Panel for Mr. D's Classroom OS
// Tabs: 📅 Planner, 🗺️ Quests, 🔮 Shop, 🌍 Place of the Week, ⚙️ Settings (always last).
// Owns ONLY this file. Renders into #module-root. All state flows through the
// store APIs (never mutated directly). Media blobs go through js/core/media.js.
// Injects <style id="admin-styles"> once; styles are theme-token aware (light/dark).
// Follows ARCHITECTURE.md contract; touch targets >= 44px; amber accent.
import { media } from '../core/media.js';
import { CONFIG } from '../config.js';
import { backup } from '../core/backup.js';
import { testFlight } from './potw.js';   // 🧭 Test flight preview (read-only)

// Tab order — future tabs insert into MAIN_TABS; Settings is pinned last.
const MAIN_TABS = [
  { id: 'planner', label: '📅 Planner' },
  { id: 'quests', label: "<img src='images/icon-quest.png' alt='' style='display:inline-block;height:1.25em;width:auto;vertical-align:-0.25em;margin-right:.3em'/>Quests" },
  { id: 'shop', label: "<img src='images/icon-market.png' alt='' style='display:inline-block;height:1.25em;width:auto;vertical-align:-0.25em;margin-right:.3em'/>Shop" },
  { id: 'potw', label: "<img src='images/icon-potw.png' alt='' style='display:inline-block;height:1.25em;width:auto;vertical-align:-0.25em;margin-right:.3em'/>Place of the Week" },
];
const SETTINGS_TAB = { id: 'settings', label: '⚙️ Settings' };
const TABS = [...MAIN_TABS, SETTINGS_TAB];

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
let pendingPdf = null;                // { key, file, rest } awaiting the presentation-vs-resource choice

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
  else if (activeTab === 'settings') body.innerHTML = renderSettings();
  else { body.innerHTML = renderPotw(); refreshPotwMedia(); }
}

function setTab(tab) {
  activeTab = tab;
  closePanel();
  closeModal();
  syncSegActive();
  renderBody();
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

function renderQuests() {
  const store = ctxRef.store;
  const catalog = store.getQuestCatalog().slice().sort((a, b) => b.points - a.points);
  const completed = store.getCompletedQuests({ limit: 20 });

  const activeCards = [1, 2, 3, 4].map((core) => {
    const house = store.HOUSES[core];
    const q = store.getActiveQuest(core);
    const body = q
      ? `<div class="admin-q-active-body">
           <div class="admin-q-active-title">${esc(q.title)}</div>
           <div class="admin-q-active-meta">💎 ${q.points} pts · started ${esc(questDateStr(q.startedTs))}</div>
           <div class="admin-q-active-actions">
             <button class="admin-btn admin-btn-primary" data-action="quest-complete" data-core="${core}">✅ Confirm Complete</button>
             <button class="admin-btn admin-btn-danger" data-action="quest-clear" data-core="${core}">✖ Clear</button>
           </div>
         </div>`
      : '<div class="admin-q-active-empty">—</div>';
    return `
      <div class="admin-q-active" style="--house:${house.accent}">
        <div class="admin-q-active-head" style="color:${house.accent}">${esc(house.name)} <span class="admin-faint">· Core ${core}</span></div>
        ${body}
      </div>`;
  }).join('');

  const catalogRows = catalog.map((q) => `
    <div class="admin-q-row">
      <div class="admin-q-pts">${q.points}<small>pts</small></div>
      <div class="admin-q-main">
        <div class="admin-q-title">${esc(q.title)}</div>
        <div class="admin-q-desc">${esc(q.desc || '')}</div>
      </div>
      <div class="admin-q-row-actions">
        <button class="admin-btn admin-btn-icon" data-action="quest-edit" data-id="${esc(q.id)}" aria-label="Edit">✏️</button>
        <button class="admin-btn admin-btn-icon admin-btn-danger" data-action="quest-del" data-id="${esc(q.id)}" aria-label="Delete">🗑️</button>
      </div>
    </div>`).join('');

  return `
    <div class="admin-quests">
      <div class="admin-card">
        <div class="admin-card-title">Active Quests</div>
        <div class="admin-mini">One quest can be active per house core. Students pick quests on the Quest Board; you confirm completion here to award the points.</div>
        <div class="admin-q-active-grid">${activeCards}</div>
      </div>

      <div class="admin-card">
        <div class="admin-rows-head">
          <span class="admin-card-title" style="margin:0">Quest Catalog <span class="admin-faint">(${catalog.length})</span></span>
          <button class="admin-btn admin-btn-primary" data-action="quest-new">+ New Quest</button>
        </div>
        <div class="admin-q-list">
          ${catalogRows || '<div class="admin-empty admin-empty-sm">No quests yet. Add one to get started.</div>'}
        </div>
      </div>

      <div class="admin-card">
        <div class="admin-card-title">Recent Completions</div>
        <div class="admin-q-list">
          ${completed.length ? completed.map((c) => {
            const house = store.HOUSES[c.core];
            return `<div class="admin-q-done">
              <span class="admin-evt-dot" style="background:${house.accent};border:2px solid ${house.accent}"></span>
              <div class="admin-q-main">
                <div class="admin-q-title">${esc(c.title)}</div>
                <div class="admin-q-desc">${esc(house.name)} · +${c.points} pts · ${esc(questDateStr(c.ts))}</div>
              </div>
            </div>`;
          }).join('') : '<div class="admin-empty admin-empty-sm">No quests completed yet.</div>'}
        </div>
      </div>
    </div>`;
}

function openQuestForm(id) {
  const store = ctxRef.store;
  const q = id ? store.getQuestCatalog().find((x) => x.id === id) : null;
  const m = el('admin-modal-root');
  m.innerHTML = `
    <div class="admin-modal-bg" data-action="modal-close"></div>
    <div class="admin-modal">
      <div class="admin-modal-head">
        <div class="admin-modal-title">${q ? '✏️ Edit Quest' : '🗺️ New Quest'}</div>
        <button class="admin-btn admin-btn-icon" data-action="modal-close" aria-label="Close">✕</button>
      </div>
      <div class="admin-modal-body">
        <label class="admin-flabel" for="admin-quest-title">Title</label>
        <input id="admin-quest-title" class="admin-input" type="text" value="${esc(q?.title || '')}" placeholder="School Event Squad" />
        <label class="admin-flabel" for="admin-quest-desc">What needs to be done</label>
        <textarea id="admin-quest-desc" class="admin-input admin-textarea" rows="3" placeholder="Attend a school event together. Proof: photos showing at least half the class there.">${esc(q?.desc || '')}</textarea>
        <label class="admin-flabel" for="admin-quest-points">Point value</label>
        <input id="admin-quest-points" class="admin-input" type="number" min="1" max="9999" value="${esc(q?.points ?? 20)}" style="max-width:160px" />
      </div>
      <div class="admin-modal-foot">
        <button class="admin-btn admin-btn-lg" data-action="modal-close">Cancel</button>
        <button class="admin-btn admin-btn-primary admin-btn-lg" data-action="quest-save" ${q ? `data-id="${esc(q.id)}"` : ''}>Save quest</button>
      </div>
    </div>`;
  const t = el('admin-quest-title'); if (t) t.focus();
}

function saveQuestFromForm(id) {
  const store = ctxRef.store;
  const title = el('admin-quest-title').value.trim();
  const desc = el('admin-quest-desc').value.trim();
  const points = Number(el('admin-quest-points').value);
  if (!title) { toast('A quest title is required.'); return; }
  if (!(points >= 1)) { toast('Point value must be at least 1.'); return; }
  const saved = store.saveQuest({ id: id || undefined, title, desc, points });
  if (!saved) { toast('Could not save quest.'); return; }
  closeModal();
  renderBody();
  toast(id ? 'Quest updated.' : 'Quest added.');
}

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
        <p class="admin-modal-lead">Mark <b>${esc(q.title)}</b> complete for <b style="color:${house.accent}">${esc(house.name)}</b> and award <b>+${q.points} points</b>?</p>
        <div class="admin-mini">This logs a points transaction and archives the completion.</div>
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
  if (quest) { toast(`🎉 +${quest.points} to ${house.name} — “${quest.title}” complete!`); ctxRef.audio?.sfx?.('fanfare'); }
}

// ===========================================================================
// TAB — SHOP (Magic Shop item manager)
// ===========================================================================
// Everything the editor needs to TEACH each kind, not just collect a number.
// `sentence(n)` is the single plain-English phrasing reused by the catalog list
// and the live preview, so the teacher reads the same words in both places.
const EFFECTS = {
  attack: {
    label: '⚔️ Attack', group: 'Offensive', amountLabel: 'Points deducted from target',
    explain: 'Deducts points from a house you choose.',
    does: 'The buyer picks a rival house and knocks points off their score.',
    defense: 'A Shield stops it completely; a half-damage relic cuts it in half.',
    example: 'Greek Fire: 45 pts to take 25 from a rival — but a Shield Wall stops it cold.',
    range: 'Most attacks land between 10 and 40 points.',
    sentence: (n) => `Takes ${n} points from a house you choose. Blocked by shields. Halved by a half-damage relic.`,
  },
  steal: {
    label: '🐴 Steal', group: 'Offensive', amountLabel: 'Points stolen from leader',
    explain: 'Takes points from the leading house and gives them to the buyer.',
    does: 'Points come off whichever house is in first place and go to the buyer.',
    defense: 'Still an attack — a Shield on the leader stops it; a half-damage relic halves it.',
    example: 'Trojan Horse: 50 pts to move 25 points from the leader onto your own score.',
    range: 'Most steals land between 10 and 30 points.',
    sentence: (n) => `Takes ${n} points from whichever house is leading and gives them to the buyer. Blocked by shields. Halved by a half-damage relic.`,
  },
  pierce: {
    label: '🫥 Pierce', group: 'Offensive', amountLabel: 'Points deducted (unblockable)',
    explain: 'An attack that ignores shields AND damage reduction.',
    does: 'Same as an attack, but no defense can stop or soften it.',
    defense: 'Ignores BOTH shields and half-damage relics — it always lands in full.',
    example: 'Invisibility Cloak: 60 pts to take 20 — it gets through even a Great Wall.',
    range: 'Price these higher than a plain attack, since nothing can stop them.',
    sentence: (n) => `Takes ${n} points from a house you choose. Cannot be blocked or reduced.`,
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

// One-line label+amount for compact spots (kept short for the row header).
function effectSummary(effect) {
  const e = EFFECTS[effect?.kind];
  if (!e) return '';
  const n = effect.amount;
  switch (effect.kind) {
    case 'shield': return `${e.label} · blocks all attacks for ${n}h`;
    case 'reduce': return `${e.label} · incoming damage halved for ${n}h`;
    case 'steal':  return `${e.label} · takes ${n} from the leader`;
    case 'pierce': return `${e.label} · −${n}, ignores shields & reduction`;
    case 'wild':   return `${e.label} · random ±${n}`;
    default:       return `${e.label} · −${n} to a house you choose`;
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

// 17+ items — grouped so the teacher can still scan it.
function renderShop() {
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

// Plain-language primer so Mr. D can invent balanced items of his own.
function shopGuideHTML() {
  return `
    <div class="admin-card">
      <details class="admin-details admin-guide" ${shopGuideOpen ? 'open' : ''}>
        <summary data-action="shop-guide-toggle">📖 How magic items work</summary>

        <div class="admin-guide-body">
          <p class="admin-guide-p"><b>Attacks and Steals take points away.</b> An Attack hits a house the buyer picks; a Steal takes from whichever house is currently in the lead.</p>
          <p class="admin-guide-p"><b>Shields stop them completely.</b> While a house has a Shield, attacks against it do nothing at all.</p>
          <p class="admin-guide-p"><b>Half-damage relics cut them in half.</b> A 20-point hit becomes 10.</p>
          <p class="admin-guide-p"><b>Pierce items go through BOTH.</b> Nothing stops a Pierce attack — that's why they cost more.</p>
          <p class="admin-guide-p"><b>Wildcards can help or hurt</b> the house that buys them. It's a gamble, and defenses don't apply.</p>
          <p class="admin-guide-p"><b>Mythic relics can't be bought.</b> The only way to earn one is a natural 20 on the Die of Destiny.</p>

          <div class="admin-guide-callout">
            ⚠️ <b>Defenses only apply to attacks</b> — shop items and Battle Day strikes. Points you give or take yourself, from the House Points screen or the ± button, are <b>never</b> blocked or halved.
          </div>

          <div class="admin-guide-tablewrap">
            <div class="admin-guide-tabletitle">What actually lands</div>
            <table class="admin-matchup">
              <thead>
                <tr><th>Incoming</th><th>No defense</th><th>Shield</th><th>Half-damage</th></tr>
              </thead>
              <tbody>
                <tr>
                  <td class="admin-mu-row">Plain attack of 20</td>
                  <td><b>20</b></td><td class="admin-mu-block">blocked</td><td><b>10</b></td>
                </tr>
                <tr>
                  <td class="admin-mu-row">Pierce attack of 20</td>
                  <td><b>20</b></td><td><b>20</b></td><td><b>20</b></td>
                </tr>
              </tbody>
            </table>
          </div>
        </div>
      </details>
    </div>`;
}

function openShopForm(id) {
  const store = ctxRef.store;
  const it = id ? store.getShopItems().find((x) => x.id === id) : null;
  const hasImg = !!(it && it.image && it.image.startsWith('media:'));
  shopForm = {
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

async function hydrateShopImage(id) {
  const u = await media.url(`shop:${id}:image`);
  if (u && shopForm && shopForm.id === id) { shopForm.imageUrl = u; renderShopModal(); }
}

function renderShopModal() {
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
        <textarea id="admin-shop-desc" class="admin-input admin-textarea" rows="2" placeholder="Flavor + what it does, e.g. “Steal 25 points from the leading house.”">${esc(f.desc)}</textarea>

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

// Live preview: recompute the sentence as the teacher types cost/amount,
// without re-rendering (which would steal focus mid-keystroke).
function updateShopPreview() {
  if (!shopForm || !el('admin-shop-preview')) return;
  const g = (id) => (el(id) ? el(id).value : '');
  el('admin-shop-preview').textContent = effectSentence({
    cost: el('admin-shop-cost') ? g('admin-shop-cost') : shopForm.cost,
    mythicOnly: shopForm.mythicOnly,
    effect: { kind: shopForm.effectKind, amount: g('admin-shop-amount') },
  });
}

function syncShopFromDom() {
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
  if (!f.name.trim()) return 'This item needs a name.';
  if (!store.SHOP_KINDS.includes(f.effectKind)) return `“${f.effectKind}” isn't a magic type this game understands. Pick one of the six options above.`;
  if (!f.mythicOnly && !(Number(f.cost) > 0)) return 'Give this item a price of at least 1 point — or tick “Mythic reward only” if it should be earned instead of bought.';
  return "Something in this item wasn't accepted. Check the name, price, and type.";
}

async function saveShopItem() {
  syncShopFromDom();
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
// TAB — SETTINGS
// ===========================================================================
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

      ${shieldPanelHTML()}

      <div class="admin-card">
        <div class="admin-card-title">Backup &amp; Restore</div>

        <div class="admin-auto-head">🔄 Automatic backup</div>
        ${autoBackupHTML()}

        <hr class="admin-hr" />

        <div class="admin-auto-head">Manual export / import</div>
        <div class="admin-mini">Save or restore the full classroom state — points, planner, quests, shop, settings, and destinations.</div>
        <div class="admin-backup-row">
          <button class="admin-btn admin-btn-lg" data-action="backup-export">⬇ Export backup</button>
          <button class="admin-btn admin-btn-lg" data-action="backup-import">⬆ Import backup</button>
          <input id="admin-import-file" type="file" accept="application/json,.json" hidden />
        </div>
        <div class="admin-mini" style="margin:10px 0 0">Media files (videos/images) live in the browser separately and are not included in either backup.</div>
      </div>

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
function shieldPanelHTML() {
  const store = ctxRef.store;
  const live = Object.values(store.HOUSES)
    .map((h) => ({
      house: h,
      shield: store.shieldRemainingMs(h.id),
      reduce: store.reductionRemainingMs(h.id),
    }))
    .filter((x) => x.shield > 0 || x.reduce > 0)
    .sort((a, b) => Math.max(b.shield, b.reduce) - Math.max(a.shield, a.reduce));

  const defRow = (house, kind, ms) => `
    <div class="admin-def-line">
      <span class="admin-shield-emoji">${kind === 'shield' ? '🛡️' : '🕵️'}</span>
      <div class="admin-q-main">
        <div class="admin-def-name">${kind === 'shield' ? 'Shield' : 'Damage halved'}</div>
        <div class="admin-q-desc"><span class="admin-def-time" data-house="${house.id}" data-kind="${kind}">${esc(fmtRemaining(ms))}</span></div>
      </div>
      <button class="admin-btn admin-btn-sm admin-btn-danger" data-action="${kind === 'shield' ? 'shield-clear' : 'reduction-clear'}" data-house="${house.id}">Clear</button>
    </div>`;

  return `
    <div class="admin-card">
      <div class="admin-card-title">🛡️ Active Defenses</div>
      <div class="admin-mini">Shields block attacks outright; damage reduction halves them. Clear one early if a house used it by mistake.</div>
      ${live.length ? `<div class="admin-shield-list">${live.map(({ house, shield, reduce }) => `
        <div class="admin-shield-row" style="--house:${house.accent}">
          <div class="admin-def-house" style="color:${house.accent}">${esc(house.name)}</div>
          <div class="admin-def-lines">
            ${shield > 0 ? defRow(house, 'shield', shield) : ''}
            ${reduce > 0 ? defRow(house, 'reduce', reduce) : ''}
          </div>
        </div>`).join('')}</div>`
        : '<div class="admin-empty admin-empty-sm">No house currently has a shield or damage reduction.</div>'}
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
// TAB 3 — PLACE OF THE WEEK MANAGER
// ===========================================================================
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
        </div>
        <button class="admin-btn admin-btn-primary admin-btn-lg" data-action="potw-new">+ Add a Place of the Week</button>
      </div>
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
              <div class="admin-mini" style="margin:8px 0 0">Export from PowerPoint or Google Slides as a PDF.</div>
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
      pres: { type: p.presentation?.type || null, pdf: null, images: [], url: p.presentation?.type === 'gslides' ? (p.presentation.url || '') : '' },
      links: (p.links || []).map((l) => ({ title: l.title || '', url: l.url || '' })),
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
      pres: { type: null, pdf: null, images: [], url: '' },
      links: [],
    };
  }
  renderPotwModal();
  if (!potwForm.isNew && potwForm.pres.type && potwForm.pres.type !== 'gslides') hydratePresentation(key);
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
        </div>

        <div class="admin-step">
          <div class="admin-step-title"><span class="admin-step-num">5</span> Your lesson presentation</div>
          <div class="admin-step-hint">Plays full-screen the moment you land. Export from PowerPoint or Google Slides as a PDF.</div>
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

// Presentation editor — Google Slides featured first (Mr. D lives in Google
// Workspace), then PDF, then Slide Images.
function presSectionHTML() {
  const pres = potwForm.pres || (potwForm.pres = { type: null, pdf: null, images: [], url: '' });
  const opt = (t, lbl, feat) => `<button type="button" class="admin-pres-opt${pres.type === t ? ' on' : ''}${feat ? ' feat' : ''}" data-action="pres-type" data-type="${t}">${lbl}</button>`;

  let body = '';
  if (pres.type === 'gslides') {
    body = `
      <label class="admin-flabel" for="admin-pres-url">Embed URL</label>
      <input id="admin-pres-url" class="admin-input" type="text" value="${esc(pres.url)}" placeholder="https://docs.google.com/presentation/d/…/embed?start=false" />
      <div class="admin-mini admin-pres-hint">✅ <b>Easiest with Google Classroom.</b> In Google Slides: <b>File → Share → Publish to web → Embed → copy the URL and paste it here.</b></div>`;
  } else if (pres.type === 'pdf') {
    const p = pres.pdf;
    body = `
      ${p ? `<div class="admin-drop-body admin-pres-file">
          <div class="admin-drop-file"><span class="admin-drop-name" title="${esc(p.name)}">${esc(p.name)}</span><span class="admin-drop-size">${humanSize(p.size)} · ${p.existing ? 'stored' : 'pending save'}</span></div>
          <button type="button" class="admin-btn admin-btn-sm admin-btn-danger" data-action="pres-pdf-del">Remove</button>
        </div>`
        : presDropHTML('pdf', '⬇ Drop a PDF here, or click to browse')}
      <div class="admin-mini admin-pres-hint">In PowerPoint or Google Slides: <b>File → Download / Export as PDF</b>.</div>`;
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
    <div class="admin-mini" style="margin:0 0 10px">PDF is easiest: export from PowerPoint or Google Slides.</div>
    <div class="admin-seg admin-pres-seg">
      ${opt('gslides', '🔗 Google Slides <span class="admin-feat-chip">Easiest with Google Classroom</span>', true)}
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
  const linkRows = (f.links || []).map((l, i) => `
    <div class="admin-link-row">
      <input class="admin-input admin-link-title" type="text" value="${esc(l.title)}" placeholder="Link title" aria-label="Link title" />
      <input class="admin-input admin-link-url" type="text" value="${esc(l.url)}" placeholder="https://…" aria-label="Link URL" />
      <button class="admin-btn admin-btn-icon admin-btn-danger" data-action="potw-link-del" data-i="${i}" aria-label="Remove">✕</button>
    </div>`).join('');
  return `
    <div class="admin-rows-head" style="margin-top:14px">
      <span class="admin-card-title admin-mini-title" style="margin:0">Docs &amp; Links</span>
      <button class="admin-btn admin-btn-sm" data-action="potw-link-add">+ Add link</button>
    </div>
    <div class="admin-link-rows">${linkRows || '<div class="admin-empty admin-empty-sm">No links yet — add reference docs, articles, or activities.</div>'}</div>`;
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
    const url = normalizeGslides(pres.url);
    if (!url) return null;
    await delAll();
    return { type: 'gslides', url };
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
  }
  const num = (v, d) => { const n = Number(v); return Number.isFinite(Number(v)) && v !== '' && v !== null ? Number(v) : d; };
  const finalKey = slugify(f.isNew ? (f.key.trim() || title) : f.key);
  const weekOf = f.weekOf ? mondayOfDate(f.weekOf) : '';
  const presentation = await commitPresentation(finalKey);
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
  };
  if (presentation) profile.presentation = presentation;
  // A legacy free-text videoUrl is preserved only while the teacher hasn't picked
  // a preset; picking one clears it so the preset actually takes effect.
  const presetChanged = f.introVideoId && f.introVideoId !== f.legacyPresetAtOpen;
  if (f.legacyVideoUrl && !presetChanged) profile.videoUrl = f.legacyVideoUrl;
  const links = (f.links || []).filter((l) => l.title || l.url).map((l) => ({ title: l.title, url: l.url }));
  if (links.length) profile.links = links;

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
    case 'quest-new': openQuestForm(null); break;
    case 'quest-edit': openQuestForm(btn.dataset.id); break;
    case 'quest-save': saveQuestFromForm(btn.dataset.id || null); break;
    case 'quest-del': {
      const id = btn.dataset.id;
      const q = store.getQuestCatalog().find((x) => x.id === id);
      openConfirm(`Delete quest “${q ? q.title : ''}”?`, 'This removes it from the catalog and clears it from any core it is active on.', () => {
        store.deleteQuest(id); renderBody(); toast('Quest deleted.');
      });
      break;
    }
    case 'quest-clear': store.abandonQuest(Number(btn.dataset.core)); renderBody(); toast('Active quest cleared.'); break;
    case 'quest-complete': openQuestCompleteModal(Number(btn.dataset.core)); break;
    case 'quest-complete-confirm': confirmQuestComplete(Number(btn.dataset.core)); break;

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
      openConfirm(`Delete item “${it ? it.name : ''}”?`, 'This removes it from the shop catalog.', () => {
        if (it?.image?.startsWith('media:')) media.delete(it.image.slice('media:'.length));
        store.deleteShopItem(id); renderBody(); toast('Item deleted.');
      });
      break;
    }

    // backup & restore
    case 'backup-export': exportBackup(); break;
    case 'backup-import': { const inp = el('admin-import-file'); if (inp) inp.click(); break; }
    case 'backup-connect': connectBackupFolder(); break;
    case 'backup-save-now': saveBackupNow(); break;
    case 'backup-restore-folder': restoreFromFolder(); break;
    case 'backup-disconnect': disconnectBackupFolder(); break;

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
    case 'danger-toggle': dangerOpen = !dangerOpen; renderBody(); break;
    case 'reset-open': openResetModal(); break;
    case 'reset-confirm': if (!btn.disabled) doReset(); break;

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
  .admin-titlebar{display:flex;align-items:center;gap:14px;margin-bottom:12px;}
  .admin-key{font-size:2rem;filter:drop-shadow(0 0 12px rgba(245,158,11,.5));}
  .admin-title{font-family:Cinzel,serif;font-weight:800;font-size:1.5rem;color:#f59e0b;letter-spacing:.03em;}
  .admin-sub{color:var(--color-text-soft);font-size:.85rem;}
  .admin-seg{display:inline-flex;gap:4px;padding:4px;background:var(--color-card);border:1px solid var(--color-line);border-radius:1rem;flex-wrap:wrap;}
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
  .admin-btn-nuke{background:#ef4444;border-color:#ef4444;color:#fff;font-weight:800;}
  .admin-btn-nuke:hover:not(:disabled){background:#dc2626;}

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
  .admin-link-row{display:grid;grid-template-columns:1fr 1.4fr 44px;gap:6px;align-items:center;}
  @media (max-width:600px){.admin-link-row{grid-template-columns:1fr;}}

  /* quests tab */
  .admin-quests{max-width:920px;margin:0 auto;display:flex;flex-direction:column;gap:18px;}
  .admin-q-active-grid{display:grid;grid-template-columns:repeat(2,1fr);gap:12px;margin-top:8px;}
  @media (max-width:640px){.admin-q-active-grid{grid-template-columns:1fr;}}
  .admin-q-active{background:var(--color-page);border:1px solid var(--color-line);border-left:4px solid var(--house,var(--color-line));border-radius:.85rem;padding:14px;}
  .admin-q-active-head{font-weight:800;font-size:.95rem;margin-bottom:8px;}
  .admin-q-active-title{font-weight:700;color:var(--color-text);font-size:1rem;}
  .admin-q-active-meta{color:var(--color-text-soft);font-size:.78rem;margin:4px 0 12px;}
  .admin-q-active-actions{display:flex;gap:8px;flex-wrap:wrap;}
  .admin-q-active-empty{color:var(--color-text-soft);font-size:1.6rem;font-weight:800;text-align:center;padding:14px 0;}
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

  /* shop tab */
  .admin-key-row .admin-btn{flex-shrink:0;}
  .admin-shop-row{display:flex;align-items:center;gap:14px;padding:12px 14px;background:var(--color-page);border:1px solid var(--color-line);border-radius:.85rem;}
  .admin-shop-thumb{flex-shrink:0;width:48px;height:48px;border-radius:.6rem;background:var(--color-card2);border:1px solid var(--color-line);display:flex;align-items:center;justify-content:center;overflow:hidden;}
  .admin-shop-emoji{font-size:1.6rem;line-height:1;}
  .admin-shop-thumb-img{width:100%;height:100%;object-fit:cover;}
  .admin-shop-effect{font-size:.76rem;color:var(--color-text-soft);margin-top:4px;font-weight:600;}
  .admin-shop-cost{flex-shrink:0;width:56px;text-align:center;font-weight:800;font-size:1.35rem;color:#f59e0b;line-height:1;}
  .admin-shop-cost small{display:block;font-size:.6rem;font-weight:700;color:var(--color-text-soft);letter-spacing:.06em;text-transform:uppercase;margin-top:2px;}
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
  html[data-mode="light"] .admin-mu-block{color:#15803d !important;}

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

  /* toast */
  .admin-toast{position:fixed;bottom:24px;left:50%;transform:translateX(-50%);z-index:90;
    background:var(--color-card2);border:1px solid #f59e0b;color:var(--color-text);padding:12px 22px;border-radius:.75rem;
    font-weight:600;font-size:.9rem;box-shadow:0 12px 40px rgba(0,0,0,.5);animation:admin-toast-in .25s ease both;}
  @keyframes admin-toast-in{from{opacity:0;transform:translate(-50%,12px);}to{opacity:1;transform:translate(-50%,0);}}

  /* light-mode contrast fixes: darken amber/cyan accents that read too light on white */
  html[data-mode="light"] .admin-title,
  html[data-mode="light"] .admin-q-pts,
  html[data-mode="light"] .admin-shop-cost,
  html[data-mode="light"] .admin-preview-label,
  html[data-mode="light"] .admin-modal-title,
  html[data-mode="light"] .admin-panel-eyebrow,
  html[data-mode="light"] .admin-potw-meta code,
  html[data-mode="light"] .admin-mini code,
  html[data-mode="light"] .admin-files code,
  html[data-mode="light"] .admin-steps code{color:#b45309;}
  html[data-mode="light"] .admin-date-badge,
  html[data-mode="light"] .admin-drop-name,
  html[data-mode="light"] .admin-pres-tag,
  html[data-mode="light"] .admin-feat-chip,
  html[data-mode="light"] .admin-details summary{color:#0e7490;}
  html[data-mode="light"] .admin-arrival-badge.ok{color:#15803d;border-color:#15803d;}

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
    panelView = null; form = null; potwForm = null; dangerOpen = false;

    renderShell();

    clickHandler = onClick;
    rootEl.addEventListener('click', clickHandler);

    // input change: effect radios, import-file picker, media/shop/asset file inputs
    changeHandler = (e) => {
      if (e.target.name === 'admin-eff') { syncShopFromDom(); shopForm.effectKind = e.target.value; renderShopModal(); return; }
      if (e.target.id === 'admin-shop-mythic') { syncShopFromDom(); shopForm.mythicOnly = e.target.checked; renderShopModal(); return; }
      if (e.target.id === 'admin-import-file') { const f = e.target.files && e.target.files[0]; if (f) importBackup(f); e.target.value = ''; return; }
      const inp = e.target.closest('input.admin-file');
      if (!inp) return;
      const files = inp.files;
      if (files && files.length) {
        if (inp.dataset.shopimg) stageShopImage(files[0]);
        else if (inp.dataset.presdrop) handlePresDrop(inp.dataset.presdrop, files[0]);
        else if (inp.dataset.assets) handleAssetFiles(inp.dataset.assets, files);
        else if (inp.dataset.pres) handlePresFiles(inp.dataset.pres, files);
        else handleMediaFile(inp.dataset.mkey, files[0]);
      }
      inp.value = ''; // allow re-picking the same file
    };
    rootEl.addEventListener('change', changeHandler);

    // live plain-English preview in the shop editor as cost/amount are typed
    inputHandler = (e) => {
      if (e.target.id === 'admin-shop-cost' || e.target.id === 'admin-shop-amount') updateShopPreview();
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
      else handleMediaFile(z.dataset.mkey, files[0]);
    };
    rootEl.addEventListener('dragover', dragOverHandler);
    rootEl.addEventListener('dragleave', dragLeaveHandler);
    rootEl.addEventListener('drop', dropHandler);

    // keep the auto-backup "last saved …" line live (writes don't emit store changes)
    backupStatusTimer = setInterval(() => {
      if (activeTab !== 'settings') return;
      updateBackupStatusLine();
      updateShieldTimes();
    }, 5000);

    unsub = ctx.store.subscribe(() => { renderBody(); });
  },

  unmount() {
    clearTimers();
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
    panelView = null; form = null; potwForm = null; shopForm = null;
  },
};
