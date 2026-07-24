// admin.js — Teacher's Admin Panel for Mr. D's Classroom OS
// Three tabs: 📅 Planner (month calendar + day editor + itinerary builder),
// ⚙️ Term Settings, 🌍 Place of the Week manager.
// Owns ONLY this file. Renders into #module-root. All state flows through the
// store APIs (never mutated directly). Media blobs go through js/core/media.js.
// Injects <style id="admin-styles"> once.
// Follows ARCHITECTURE.md contract; touch targets >= 44px; dark theme; amber accent.
import { media } from '../core/media.js';

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
const timers = new Set();
const presUrls = new Set();   // object URLs we own for presentation image thumbnails

let activeTab = 'planner';            // 'planner' | 'settings' | 'potw'
const cal = { year: 0, month: 0 };    // currently-viewed calendar month
let panelView = null;                 // null | 'day' | 'form'  (right side panel)
let panelDate = null;                 // 'YYYY-MM-DD' the day editor is showing
let form = null;                      // in-progress event form / itinerary builder
let potwForm = null;                  // in-progress POTW profile editor
let dangerOpen = false;               // danger-zone accordion state

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
  'note':       { label: 'Note',       color: '#9ca3af', outline: false },
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
          <button class="admin-seg-btn" data-action="tab" data-tab="planner">📅 Planner</button>
          <button class="admin-seg-btn" data-action="tab" data-tab="settings">⚙️ Term Settings</button>
          <button class="admin-seg-btn" data-action="tab" data-tab="potw">🌍 Place of the Week</button>
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

function renderBody() {
  const body = el('admin-body');
  if (!body) return;
  // Don't clobber a field the teacher is mid-typing in the body.
  const ae = document.activeElement;
  if (ae && body.contains(ae) && /^(INPUT|TEXTAREA|SELECT)$/.test(ae.tagName)) return;
  if (activeTab === 'planner') body.innerHTML = renderPlanner();
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
// TAB 2 — TERM SETTINGS
// ===========================================================================
function renderSettings() {
  const store = ctxRef.store;
  const s = store.getSettings();
  const info = store.getTermInfo();
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
  renderBody();
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

// ===========================================================================
// TAB 3 — PLACE OF THE WEEK MANAGER
// ===========================================================================
function renderPotw() {
  const store = ctxRef.store;
  const profiles = store.getPotwProfiles();
  const active = store.getActivePotwKey();
  const keys = Object.keys(profiles);

  return `
    <div class="admin-potw">
      <div class="admin-potw-head">
        <div class="admin-card-title" style="margin:0">Destinations</div>
        <button class="admin-btn admin-btn-primary admin-btn-lg" data-action="potw-new">+ New Destination</button>
      </div>
      <div class="admin-potw-list">
        ${keys.map((k) => {
          const pr = profiles[k];
          const isActive = k === active;
          const dateBadge = pr.date ? `<span class="admin-date-badge">🌍 ${esc(pr.date)}</span>` : '<span class="admin-date-badge muted">no date set</span>';
          const pres = pr.presentation;
          let presBadge = '';
          if (pres?.type === 'pdf') presBadge = `<span class="admin-pres-tag">📊 PDF <span class="admin-pres-size" data-mkey="potw:${esc(k)}:slides.pdf"></span></span>`;
          else if (pres?.type === 'images') presBadge = `<span class="admin-pres-tag">📊 ${pres.count || 0} slide${pres.count === 1 ? '' : 's'}</span>`;
          else if (pres?.type === 'gslides') presBadge = '<span class="admin-pres-tag">📊 Google Slides</span>';
          return `
          <div class="admin-potw-card${isActive ? ' active' : ''}">
            <div class="admin-potw-top">
              <div class="admin-potw-info">
                <div class="admin-potw-title">${esc(pr.title)} ${isActive ? '<span class="admin-badge">ACTIVE</span>' : ''}</div>
                <div class="admin-potw-sub">${esc(pr.subtitle || '')}</div>
                <div class="admin-potw-meta">${dateBadge} ${presBadge} · ${(pr.quickFacts || []).length} facts · ${(pr.primarySources || []).length} sources · ${(pr.quiz || []).length} quiz · key <code>${esc(k)}</code></div>
              </div>
              <div class="admin-potw-actions">
                <button class="admin-btn" data-action="potw-active" data-key="${esc(k)}"${isActive ? ' disabled' : ''}>${isActive ? 'Active' : 'Set Active'}</button>
                <button class="admin-btn" data-action="potw-edit" data-key="${esc(k)}">Edit</button>
                <button class="admin-btn admin-btn-danger" data-action="potw-delete" data-key="${esc(k)}"${isActive ? ' disabled' : ''} title="${isActive ? 'Cannot delete the active destination' : 'Delete'}">Delete</button>
              </div>
            </div>
            <div class="admin-drops">
              ${dropZoneHTML('video', k)}
              ${dropZoneHTML('song', k)}
            </div>
          </div>`;
        }).join('')}
      </div>

      <div class="admin-card admin-files">
        <div class="admin-card-title">About media storage</div>
        <p class="admin-mini">💾 Files dropped above are stored <b>in this browser on this smartboard machine</b> (not uploaded anywhere). The Place-of-the-Week playback prefers them when present.</p>
        <p class="admin-mini">Fallback method — or drop files into the site folder:</p>
        <pre class="admin-code">site-root/potw-intro.mp4        ← intro video
site-root/potw-songs/*.mp3      ← theme / fallback song</pre>
      </div>
    </div>`;
}

// ---- media drop zones (drag-drop + click-to-browse via js/core/media.js) ----
function dropZoneHTML(kind, key) {
  const mkey = `potw:${key}:${kind === 'video' ? 'video' : 'song'}`;
  const label = kind === 'video' ? 'Intro Video' : 'Theme Song';
  const accept = kind === 'video' ? 'video/*' : 'audio/*';
  const icon = kind === 'video' ? '🎬' : '🎵';
  return `
    <div class="admin-drop" data-kind="${kind}" data-mkey="${esc(mkey)}" data-action="media-browse" title="Drop a file or click to browse">
      <input type="file" class="admin-file" accept="${accept}" data-mkey="${esc(mkey)}" hidden />
      <div class="admin-drop-label">${icon} ${label}</div>
      <div class="admin-drop-body" data-mkey="${esc(mkey)}"><span class="admin-faint">Checking…</span></div>
    </div>`;
}

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
}

async function handleMediaFile(mkey, file) {
  if (!mkey || !file) return;
  const kind = mkey.endsWith(':video') ? 'video' : 'song';
  const okType = kind === 'video' ? /^video\//.test(file.type || '') : /^audio\//.test(file.type || '');
  if (file.type && !okType) { toast(`That doesn't look like ${kind === 'video' ? 'a video' : 'an audio'} file.`); return; }
  const res = await media.put(mkey, file);
  toast(res ? `${kind === 'video' ? 'Video' : 'Song'} stored (${humanSize(res.size)}).` : 'Could not store the file.');
  refreshPotwMedia();
}

function openPotwEditor(key) {
  const store = ctxRef.store;
  const profiles = store.getPotwProfiles();
  if (key && profiles[key]) {
    const p = profiles[key];
    potwForm = {
      key, isNew: false,
      title: p.title || '', subtitle: p.subtitle || '', date: p.date || '',
      camera: {
        lat: p.camera?.center?.lat ?? '', lng: p.camera?.center?.lng ?? '', altitude: p.camera?.center?.altitude ?? '',
        range: p.camera?.range ?? '', tilt: p.camera?.tilt ?? '', heading: p.camera?.heading ?? '',
      },
      facts: (p.quickFacts || []).join('\n'),
      sources: (p.primarySources || []).map((s) => ({ emoji: s.emoji || '', name: s.name || '', desc: s.desc || '' })),
      quiz: (p.quiz || []).map((q) => ({ q: q.q || '', a: q.a || '' })),
      pres: { type: p.presentation?.type || null, pdf: null, images: [], url: p.presentation?.type === 'gslides' ? (p.presentation.url || '') : '' },
    };
  } else {
    potwForm = {
      key: '', isNew: true, title: '', subtitle: '', date: '',
      camera: { lat: '', lng: '', altitude: '', range: '', tilt: '', heading: '' },
      facts: '',
      sources: [{ emoji: '', name: '', desc: '' }],
      quiz: [{ q: '', a: '' }],
      pres: { type: null, pdf: null, images: [], url: '' },
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
  const cam = f.camera;
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

  m.innerHTML = `
    <div class="admin-modal-bg" data-action="potw-close"></div>
    <div class="admin-modal admin-modal-lg">
      <div class="admin-modal-head">
        <div class="admin-modal-title">${f.isNew ? '🌍 New Destination' : '🌍 Edit: ' + esc(f.title || f.key)}</div>
        <button class="admin-btn admin-btn-icon" data-action="potw-close" aria-label="Close">✕</button>
      </div>
      <div class="admin-modal-body admin-modal-scroll">
        <div class="admin-two">
          <div><label class="admin-flabel" for="admin-p-title">Title</label>
            <input id="admin-p-title" class="admin-input" type="text" value="${esc(f.title)}" placeholder="Ancient Mesopotamia" /></div>
          <div><label class="admin-flabel" for="admin-p-key">Key (slug)</label>
            <input id="admin-p-key" class="admin-input" type="text" value="${esc(f.key)}" placeholder="auto from title"${f.isNew ? '' : ' readonly'} /></div>
        </div>
        <div class="admin-two">
          <div><label class="admin-flabel" for="admin-p-sub">Subtitle</label>
            <input id="admin-p-sub" class="admin-input" type="text" value="${esc(f.subtitle)}" placeholder="Modern Day Iraq • The Fertile Crescent" /></div>
          <div><label class="admin-flabel" for="admin-p-date">Week-of date</label>
            <input id="admin-p-date" class="admin-input" type="date" value="${esc(f.date)}" />
            <div class="admin-faint" style="margin-top:4px">Places a 🌍 marker on the calendar.</div></div>
        </div>

        <div class="admin-card-title admin-mini-title">3D Camera</div>
        <div class="admin-cam-grid">
          <div><label class="admin-flabel" for="admin-c-lat">Latitude</label>
            <input id="admin-c-lat" class="admin-input" type="number" step="any" value="${esc(cam.lat)}" placeholder="${DEFAULT_CAM.lat}" /></div>
          <div><label class="admin-flabel" for="admin-c-lng">Longitude</label>
            <input id="admin-c-lng" class="admin-input" type="number" step="any" value="${esc(cam.lng)}" placeholder="${DEFAULT_CAM.lng}" /></div>
          <div><label class="admin-flabel" for="admin-c-alt">Altitude</label>
            <input id="admin-c-alt" class="admin-input" type="number" step="any" value="${esc(cam.altitude)}" placeholder="${DEFAULT_CAM.altitude}" /></div>
          <div><label class="admin-flabel" for="admin-c-range">Range</label>
            <input id="admin-c-range" class="admin-input" type="number" step="any" value="${esc(cam.range)}" placeholder="${DEFAULT_CAM.range}" /></div>
          <div><label class="admin-flabel" for="admin-c-tilt">Tilt</label>
            <input id="admin-c-tilt" class="admin-input" type="number" step="any" value="${esc(cam.tilt)}" placeholder="${DEFAULT_CAM.tilt}" /></div>
          <div><label class="admin-flabel" for="admin-c-heading">Heading</label>
            <input id="admin-c-heading" class="admin-input" type="number" step="any" value="${esc(cam.heading)}" placeholder="${DEFAULT_CAM.heading}" /></div>
        </div>

        <label class="admin-flabel" for="admin-p-facts">Quick facts (one per line)</label>
        <textarea id="admin-p-facts" class="admin-input admin-textarea" rows="5" placeholder="One fact per line…">${esc(f.facts)}</textarea>

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

        ${presSectionHTML()}
      </div>
      <div class="admin-modal-foot">
        <button class="admin-btn admin-btn-lg" data-action="potw-close">Cancel</button>
        <button class="admin-btn admin-btn-primary admin-btn-lg" data-action="potw-save">Save destination</button>
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
    <div class="admin-rows-head"><span class="admin-card-title admin-mini-title" style="margin:0">Presentation <span class="admin-faint">— launches at the location</span></span></div>
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

function syncPotwFromDom() {
  if (!potwForm) return;
  const g = (id) => (el(id) ? el(id).value : '');
  potwForm.title = g('admin-p-title');
  if (potwForm.isNew) potwForm.key = g('admin-p-key');
  potwForm.subtitle = g('admin-p-sub');
  potwForm.date = g('admin-p-date');
  potwForm.camera = {
    lat: g('admin-c-lat'), lng: g('admin-c-lng'), altitude: g('admin-c-alt'),
    range: g('admin-c-range'), tilt: g('admin-c-tilt'), heading: g('admin-c-heading'),
  };
  potwForm.facts = g('admin-p-facts');
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
}

async function savePotw() {
  syncPotwFromDom();
  const f = potwForm;
  const title = f.title.trim();
  if (!title) { toast('A title is required.'); return; }
  // Validate a Google Slides URL up front so we fail with a friendly message.
  if (f.pres?.type === 'gslides') {
    const u = (f.pres.url || '').trim();
    if (!u) { toast('Enter a Google Slides embed URL.'); return; }
    if (!normalizeGslides(u)) { toast('That must be a docs.google.com presentation URL.'); return; }
  }
  const key = (f.isNew ? (f.key.trim() || slugify(title)) : f.key);
  const num = (v, d) => { const n = Number(v); return Number.isFinite(n) && v !== '' ? n : d; };
  const date = (f.date || '').trim();
  const finalKey = slugify(key);
  const presentation = await commitPresentation(finalKey);
  if (!potwForm) return; // editor was closed mid-await
  const profile = {
    title,
    subtitle: f.subtitle.trim(),
    date,
    camera: {
      center: { lat: num(f.camera.lat, DEFAULT_CAM.lat), lng: num(f.camera.lng, DEFAULT_CAM.lng), altitude: num(f.camera.altitude, DEFAULT_CAM.altitude) },
      range: num(f.camera.range, DEFAULT_CAM.range),
      tilt: num(f.camera.tilt, DEFAULT_CAM.tilt),
      heading: num(f.camera.heading, DEFAULT_CAM.heading),
    },
    quickFacts: f.facts.split('\n').map((s) => s.trim()).filter(Boolean),
    primarySources: f.sources.filter((s) => s.name || s.desc || s.emoji),
    quiz: f.quiz.filter((q) => q.q || q.a),
  };
  if (presentation) profile.presentation = presentation;
  const ok = ctxRef.store.savePotwProfile(finalKey, profile);
  if (!ok) { toast('Save failed — check the title.'); return; }
  upsertPotwEvent(finalKey, title, date);
  revokePresUrls();
  potwForm = null;
  closeModal();
  renderBody();
  toast('Destination saved.');
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

    // settings
    case 'settings-save': saveSettings(); break;
    case 'danger-toggle': dangerOpen = !dangerOpen; renderBody(); break;
    case 'reset-open': openResetModal(); break;
    case 'reset-confirm': if (!btn.disabled) doReset(); break;

    // potw
    case 'potw-new': openPotwEditor(null); break;
    case 'potw-edit': openPotwEditor(btn.dataset.key); break;
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
    case 'potw-src-add': syncPotwFromDom(); potwForm.sources.push({ emoji: '', name: '', desc: '' }); renderPotwModal(); break;
    case 'potw-src-del': syncPotwFromDom(); potwForm.sources.splice(Number(btn.dataset.i), 1); renderPotwModal(); break;
    case 'potw-quiz-add': syncPotwFromDom(); potwForm.quiz.push({ q: '', a: '' }); renderPotwModal(); break;
    case 'potw-quiz-del': syncPotwFromDom(); potwForm.quiz.splice(Number(btn.dataset.i), 1); renderPotwModal(); break;
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
  .admin-wrap{height:100%;display:flex;flex-direction:column;background:#0b0f19;color:#f9fafb;overflow:hidden;}
  .admin-head{flex-shrink:0;padding:16px 20px 12px;border-bottom:1px solid #1f2937;
    background:linear-gradient(180deg,rgba(245,158,11,.06),transparent);}
  .admin-titlebar{display:flex;align-items:center;gap:14px;margin-bottom:12px;}
  .admin-key{font-size:2rem;filter:drop-shadow(0 0 12px rgba(245,158,11,.5));}
  .admin-title{font-family:Cinzel,serif;font-weight:800;font-size:1.5rem;color:#f59e0b;letter-spacing:.03em;}
  .admin-sub{color:#9ca3af;font-size:.85rem;}
  .admin-seg{display:inline-flex;gap:4px;padding:4px;background:#111827;border:1px solid #374151;border-radius:1rem;flex-wrap:wrap;}
  .admin-seg-btn{min-height:44px;padding:10px 20px;border:none;border-radius:.75rem;background:transparent;
    color:#9ca3af;font-weight:700;font-size:.95rem;cursor:pointer;transition:background .18s ease,color .18s ease;}
  .admin-seg-btn:hover{color:#e5e7eb;}
  .admin-seg-btn.active{background:#f59e0b;color:#0b0f19;box-shadow:0 4px 16px rgba(245,158,11,.35);}
  .admin-body{flex:1;overflow-y:auto;padding:20px;}
  .admin-body::-webkit-scrollbar{width:9px;}
  .admin-body::-webkit-scrollbar-thumb{background:#374151;border-radius:8px;}

  /* buttons */
  .admin-btn{min-height:44px;padding:9px 16px;border-radius:.7rem;border:1px solid #374151;background:#1f2937;
    color:#e5e7eb;font-weight:600;font-size:.9rem;cursor:pointer;transition:background .16s ease,border-color .16s ease,transform .1s ease;
    display:inline-flex;align-items:center;justify-content:center;gap:6px;}
  .admin-btn:hover:not(:disabled){background:#374151;}
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
  .admin-btn-danger{color:#f87171;}
  .admin-btn-danger:hover:not(:disabled){background:rgba(239,68,68,.18);border-color:#ef4444;}
  .admin-btn-nuke{background:#ef4444;border-color:#ef4444;color:#fff;font-weight:800;}
  .admin-btn-nuke:hover:not(:disabled){background:#dc2626;}

  /* inputs */
  .admin-input{width:100%;min-height:44px;padding:10px 12px;border-radius:.7rem;border:1px solid #374151;
    background:#111827;color:#f9fafb;font-size:.95rem;font-family:inherit;}
  .admin-input:focus{outline:none;border-color:#f59e0b;box-shadow:0 0 0 3px rgba(245,158,11,.18);}
  .admin-input[readonly]{opacity:.65;}
  .admin-textarea{min-height:110px;resize:vertical;line-height:1.5;}
  .admin-flabel{display:block;font-size:.78rem;font-weight:700;text-transform:uppercase;letter-spacing:.05em;
    color:#9ca3af;margin:14px 0 6px;}
  .admin-two{display:grid;grid-template-columns:1fr 1fr;gap:14px;}
  .admin-cam-grid{display:grid;grid-template-columns:repeat(3,1fr);gap:12px;}
  @media (max-width:640px){.admin-two,.admin-cam-grid{grid-template-columns:1fr;}}

  /* planner toolbar */
  .admin-planner{max-width:1400px;margin:0 auto;}
  .admin-toolbar{display:flex;align-items:center;gap:16px;flex-wrap:wrap;margin-bottom:14px;}
  .admin-nav{display:flex;gap:6px;}
  .admin-month{font-family:Cinzel,serif;font-weight:800;font-size:1.4rem;color:#f9fafb;min-width:220px;}
  .admin-legend{margin-left:auto;display:flex;gap:12px;flex-wrap:wrap;}
  .admin-leg{display:inline-flex;align-items:center;gap:6px;font-size:.72rem;color:#9ca3af;}
  .admin-leg-sw{width:12px;height:12px;border-radius:3px;display:inline-block;}

  /* calendar grid */
  .admin-dow{display:grid;grid-template-columns:repeat(7,1fr);gap:6px;margin-bottom:6px;}
  .admin-dow>div{text-align:center;font-size:.75rem;font-weight:700;text-transform:uppercase;letter-spacing:.05em;color:#9ca3af;padding:4px 0;}
  .admin-dow>div.weekend{color:#4b5563;}
  .admin-grid{display:flex;flex-direction:column;gap:6px;}
  .admin-week{display:grid;grid-template-columns:repeat(7,1fr);gap:6px;}
  .admin-cell{min-height:96px;text-align:left;display:flex;flex-direction:column;gap:4px;padding:6px;
    background:#111827;border:1px solid #1f2937;border-radius:.75rem;cursor:pointer;overflow:hidden;
    transition:border-color .16s ease,background .16s ease,transform .1s ease;font-family:inherit;}
  .admin-cell:hover{border-color:#f59e0b;background:#131b2e;}
  .admin-cell:active{transform:scale(.985);}
  .admin-cell.out{opacity:.42;}
  .admin-cell.weekend{background:#0d1220;}
  .admin-cell.today{border-color:#f59e0b;box-shadow:inset 0 0 0 1px #f59e0b,0 0 16px rgba(245,158,11,.2);}
  .admin-cell-num{font-weight:700;font-size:.9rem;color:#e5e7eb;flex-shrink:0;}
  .admin-cell.today .admin-cell-num{color:#f59e0b;}
  .admin-cell-chips{display:flex;flex-direction:column;gap:3px;overflow:hidden;}
  .admin-chip{font-size:.68rem;font-weight:600;padding:2px 6px;border-radius:.4rem;white-space:nowrap;
    overflow:hidden;text-overflow:ellipsis;max-width:100%;}
  .admin-chip-more{font-size:.66rem;font-weight:700;color:#9ca3af;padding:1px 4px;}
  .admin-hint{margin-top:16px;padding:12px 14px;background:rgba(245,158,11,.07);border:1px solid rgba(245,158,11,.25);
    border-radius:.75rem;color:#d1d5db;font-size:.85rem;line-height:1.5;}

  /* side panel */
  #admin-panel-root:empty{display:none;}
  .admin-panel{position:fixed;top:0;right:0;height:100vh;width:min(440px,100vw);z-index:70;
    background:#111827;border-left:1px solid #374151;box-shadow:-16px 0 50px rgba(0,0,0,.5);
    display:flex;flex-direction:column;animation:admin-slide-in .25s ease both;}
  @keyframes admin-slide-in{from{transform:translateX(100%);}to{transform:translateX(0);}}
  .admin-panel-head{flex-shrink:0;display:flex;align-items:flex-start;justify-content:space-between;gap:12px;
    padding:18px 20px;border-bottom:1px solid #1f2937;background:linear-gradient(180deg,rgba(245,158,11,.06),transparent);}
  .admin-panel-eyebrow{font-size:.72rem;font-weight:700;text-transform:uppercase;letter-spacing:.08em;color:#f59e0b;}
  .admin-panel-title{font-weight:800;font-size:1.15rem;color:#f9fafb;margin-top:2px;}
  .admin-panel-body{flex:1;overflow-y:auto;padding:16px 20px;}
  .admin-panel-body::-webkit-scrollbar{width:8px;}
  .admin-panel-body::-webkit-scrollbar-thumb{background:#374151;border-radius:8px;}
  .admin-panel-foot{flex-shrink:0;padding:14px 20px;border-top:1px solid #1f2937;}
  .admin-foot-split{display:flex;gap:10px;}
  .admin-foot-split .admin-btn{flex:1;}

  /* event rows */
  .admin-evt{display:flex;align-items:center;gap:10px;padding:10px 12px;background:#1f2937;border:1px solid #374151;
    border-radius:.75rem;margin-bottom:8px;}
  .admin-evt-static{background:#161e2e;}
  .admin-evt-dot{width:14px;height:14px;border-radius:50%;flex-shrink:0;}
  .admin-evt-main{flex:1;min-width:0;}
  .admin-evt-title{font-weight:600;color:#f3f4f6;font-size:.92rem;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;}
  .admin-evt-meta{font-size:.75rem;color:#9ca3af;margin-top:1px;}
  .admin-evt-list{margin-top:8px;}
  .admin-empty{text-align:center;color:#6b7280;font-style:italic;padding:24px 12px;font-size:.9rem;}
  .admin-empty-sm{padding:12px;font-size:.85rem;}

  /* type chips */
  .admin-type-grid{display:grid;grid-template-columns:repeat(2,1fr);gap:8px;}
  .admin-type-chip{min-height:44px;padding:8px 10px;border-radius:.65rem;border:1px solid #374151;background:#1f2937;
    color:#d1d5db;font-weight:600;font-size:.85rem;cursor:pointer;transition:all .15s ease;
    border-left:3px solid var(--c);}
  .admin-type-chip:hover{background:#374151;}
  .admin-type-chip.on{background:color-mix(in srgb,var(--c) 22%,#1f2937);border-color:var(--c);color:#fff;
    box-shadow:0 0 0 1px var(--c);}

  /* itinerary builder */
  .admin-builder{margin-top:16px;padding-top:14px;border-top:1px dashed #374151;}
  .admin-builder-head{display:flex;align-items:center;justify-content:space-between;margin-bottom:8px;}
  .admin-brows{display:flex;flex-direction:column;gap:8px;margin-bottom:10px;}
  .admin-brow{display:flex;gap:8px;align-items:center;}
  .admin-btime{max-width:170px;min-height:38px;font-size:.85rem;}
  .admin-btext{width:100%;min-width:0;}
  .admin-brow-ctrls{display:flex;gap:2px;flex-shrink:0;}
  .admin-brow-ctrls .admin-btn-icon{min-width:38px;padding:7px;font-size:.8rem;}
  .admin-dup{margin-top:12px;}
  .admin-dup-note{font-size:.76rem;color:#9ca3af;margin-top:6px;line-height:1.45;}

  /* settings */
  .admin-settings{max-width:820px;margin:0 auto;display:flex;flex-direction:column;gap:18px;}
  .admin-card{background:#111827;border:1px solid #374151;border-radius:1rem;padding:20px;}
  .admin-card-title{font-weight:800;font-size:1.05rem;color:#f9fafb;margin-bottom:12px;}
  .admin-mini-title{font-size:.95rem;margin:18px 0 4px;}
  .admin-mini{font-size:.82rem;color:#9ca3af;margin-bottom:10px;line-height:1.5;}
  .admin-preview{display:flex;align-items:center;gap:12px;margin:16px 0;padding:14px 16px;
    background:rgba(245,158,11,.08);border:1px solid rgba(245,158,11,.3);border-radius:.75rem;}
  .admin-preview-eyebrow{font-size:.7rem;font-weight:700;text-transform:uppercase;letter-spacing:.08em;color:#9ca3af;}
  .admin-preview-label{font-family:Cinzel,serif;font-weight:800;font-size:1.15rem;color:#f59e0b;}

  /* danger zone */
  .admin-danger{border-color:rgba(239,68,68,.4);}
  .admin-danger.open{border-color:#ef4444;}
  .admin-danger-toggle{width:100%;display:flex;align-items:center;justify-content:space-between;
    background:none;border:none;color:#f87171;font-weight:800;font-size:1.05rem;cursor:pointer;padding:0;min-height:44px;}
  .admin-danger-caret{font-size:.9rem;}
  .admin-danger-body{margin-top:14px;}
  .admin-danger-text{color:#d1d5db;font-size:.88rem;line-height:1.55;margin-bottom:14px;}
  .admin-nuke-word{color:#f87171;letter-spacing:.1em;}

  /* potw */
  .admin-potw{max-width:920px;margin:0 auto;display:flex;flex-direction:column;gap:16px;}
  .admin-potw-head{display:flex;align-items:center;justify-content:space-between;gap:12px;flex-wrap:wrap;}
  .admin-potw-list{display:flex;flex-direction:column;gap:12px;}
  .admin-potw-card{display:flex;flex-direction:column;gap:14px;padding:16px;background:#111827;border:1px solid #374151;
    border-radius:1rem;}
  .admin-potw-card.active{border-color:#f59e0b;box-shadow:0 0 22px rgba(245,158,11,.15);}
  .admin-potw-top{display:flex;align-items:flex-start;gap:16px;flex-wrap:wrap;}
  .admin-potw-info{flex:1;min-width:200px;}
  .admin-potw-title{font-weight:800;font-size:1.1rem;color:#f9fafb;display:flex;align-items:center;gap:10px;}
  .admin-potw-sub{color:#9ca3af;font-size:.88rem;margin-top:2px;}
  .admin-potw-meta{color:#6b7280;font-size:.76rem;margin-top:6px;}
  .admin-potw-meta code,.admin-mini code,.admin-files code{background:#1f2937;padding:1px 6px;border-radius:.35rem;color:#fbbf24;font-size:.9em;}
  .admin-potw-actions{display:flex;gap:8px;flex-wrap:wrap;}
  .admin-badge{font-size:.65rem;font-weight:800;letter-spacing:.08em;background:#f59e0b;color:#0b0f19;
    padding:2px 8px;border-radius:.4rem;}
  .admin-date-badge{color:#22d3ee;font-weight:700;}
  .admin-date-badge.muted{color:#6b7280;font-weight:600;font-style:italic;}
  .admin-files pre{margin-top:10px;}
  .admin-code{background:#0b0f19;border:1px solid #374151;border-radius:.6rem;padding:14px 16px;
    font-family:ui-monospace,SFMono-Regular,Menlo,monospace;font-size:.82rem;color:#d1d5db;line-height:1.6;
    overflow-x:auto;white-space:pre;}

  /* media drop zones */
  .admin-drops{display:grid;grid-template-columns:1fr 1fr;gap:12px;}
  @media (max-width:640px){.admin-drops{grid-template-columns:1fr;}}
  .admin-drop{border:2px dashed #374151;border-radius:.85rem;background:#0d1220;padding:14px;cursor:pointer;
    min-height:88px;display:flex;flex-direction:column;gap:8px;transition:border-color .15s ease,background .15s ease;}
  .admin-drop:hover{border-color:#06b6d4;background:#0e1626;}
  .admin-drop.over{border-color:#06b6d4;border-style:solid;background:rgba(6,182,212,.12);box-shadow:0 0 0 1px #06b6d4;}
  .admin-drop-label{font-weight:700;font-size:.9rem;color:#e5e7eb;}
  .admin-drop-body{display:flex;align-items:center;justify-content:space-between;gap:10px;flex-wrap:wrap;min-height:36px;}
  .admin-drop-prompt{color:#6b7280;font-size:.82rem;}
  .admin-drop-file{display:flex;flex-direction:column;min-width:0;flex:1;}
  .admin-drop-name{font-size:.85rem;color:#22d3ee;font-weight:600;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;max-width:100%;}
  .admin-drop-size{font-size:.72rem;color:#9ca3af;}
  .admin-faint{color:#6b7280;font-weight:400;font-size:.78rem;}

  /* itinerary step numbers */
  .admin-bstep{flex-shrink:0;width:30px;height:30px;border-radius:50%;background:rgba(34,197,94,.15);
    border:1px solid #22c55e;color:#22c55e;font-weight:800;font-size:.95rem;display:flex;align-items:center;justify-content:center;}
  .admin-bfields{flex:1;min-width:0;display:flex;flex-direction:column;gap:6px;}
  .admin-chip-link{cursor:pointer;}
  .admin-chip-link:hover{filter:brightness(1.25);text-decoration:underline;}

  /* presentation editor */
  .admin-pres-seg{display:flex;gap:6px;flex-wrap:wrap;margin-bottom:12px;background:#0d1220;}
  .admin-pres-opt{min-height:44px;padding:10px 14px;border:1px solid #374151;border-radius:.7rem;background:#1f2937;
    color:#d1d5db;font-weight:700;font-size:.9rem;cursor:pointer;display:inline-flex;align-items:center;gap:8px;
    transition:background .15s ease,border-color .15s ease,color .15s ease;}
  .admin-pres-opt:hover{background:#374151;}
  .admin-pres-opt.on{background:#06b6d4;border-color:#06b6d4;color:#04222b;}
  .admin-pres-opt.feat{border-color:#06b6d4;}
  .admin-pres-opt.feat.on{box-shadow:0 0 0 1px #06b6d4,0 0 16px rgba(6,182,212,.35);}
  .admin-feat-chip{font-size:.62rem;font-weight:800;letter-spacing:.03em;text-transform:uppercase;
    background:rgba(6,182,212,.18);color:#22d3ee;border:1px solid rgba(6,182,212,.5);padding:2px 6px;border-radius:.4rem;}
  .admin-pres-opt.on .admin-feat-chip{background:rgba(4,34,43,.25);color:#04222b;border-color:rgba(4,34,43,.4);}
  .admin-pres-body{margin-bottom:4px;}
  .admin-pres-hint{margin-top:8px;padding:10px 12px;background:rgba(6,182,212,.08);border:1px solid rgba(6,182,212,.25);border-radius:.6rem;}
  .admin-pres-file{padding:12px;border:1px solid #374151;border-radius:.7rem;background:#0d1220;}
  .admin-pres-list{display:flex;flex-direction:column;gap:8px;margin:10px 0;}
  .admin-pres-thumb{display:flex;align-items:center;gap:10px;padding:8px;background:#1f2937;border:1px solid #374151;border-radius:.7rem;}
  .admin-pres-num{background:rgba(6,182,212,.15);border-color:#06b6d4;color:#22d3ee;}
  .admin-pres-img{width:64px;height:40px;object-fit:cover;border-radius:.35rem;border:1px solid #374151;flex-shrink:0;background:#0b0f19;}
  .admin-pres-name{flex:1;min-width:0;font-size:.85rem;color:#e5e7eb;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;}
  .admin-pres-tag{color:#22d3ee;font-weight:700;}

  /* modals */
  #admin-modal-root:empty{display:none;}
  .admin-modal-bg{position:fixed;inset:0;z-index:80;background:rgba(0,0,0,.65);backdrop-filter:blur(3px);
    animation:admin-fade .2s ease both;}
  @keyframes admin-fade{from{opacity:0;}to{opacity:1;}}
  .admin-modal{position:fixed;top:50%;left:50%;transform:translate(-50%,-50%);z-index:81;
    width:min(560px,94vw);max-height:90vh;background:#111827;border:1px solid #374151;border-radius:1.25rem;
    display:flex;flex-direction:column;box-shadow:0 30px 80px rgba(0,0,0,.6);animation:admin-pop .22s ease both;}
  .admin-modal-lg{width:min(760px,96vw);}
  .admin-modal-danger{border-color:#ef4444;box-shadow:0 30px 80px rgba(0,0,0,.6),0 0 40px rgba(239,68,68,.2);}
  @keyframes admin-pop{from{opacity:0;transform:translate(-50%,-46%) scale(.96);}to{opacity:1;transform:translate(-50%,-50%) scale(1);}}
  .admin-modal-head{display:flex;align-items:center;justify-content:space-between;padding:18px 22px;border-bottom:1px solid #1f2937;}
  .admin-modal-title{font-family:Cinzel,serif;font-weight:800;font-size:1.2rem;color:#f59e0b;}
  .admin-modal-body{padding:18px 22px;overflow-y:auto;}
  .admin-modal-scroll{max-height:64vh;}
  .admin-modal-lead{color:#d1d5db;font-size:.9rem;line-height:1.55;margin-bottom:8px;}
  .admin-modal-foot{display:flex;gap:10px;justify-content:flex-end;padding:16px 22px;border-top:1px solid #1f2937;}
  .admin-dow-picker{display:flex;gap:8px;flex-wrap:wrap;}
  .admin-check{display:inline-flex;align-items:center;gap:6px;padding:8px 12px;min-height:44px;background:#1f2937;
    border:1px solid #374151;border-radius:.6rem;cursor:pointer;font-size:.85rem;color:#e5e7eb;}
  .admin-check input{width:18px;height:18px;accent-color:#f59e0b;}
  .admin-rows-head{display:flex;align-items:center;justify-content:space-between;gap:10px;margin:18px 0 8px;}
  .admin-srows,.admin-qrows{display:flex;flex-direction:column;gap:8px;}
  .admin-srow{display:grid;grid-template-columns:64px 1fr 1.6fr 44px;gap:6px;align-items:center;}
  .admin-qrow{display:grid;grid-template-columns:1fr 1fr 44px;gap:6px;align-items:center;}
  @media (max-width:600px){.admin-srow,.admin-qrow{grid-template-columns:1fr;}}

  /* toast */
  .admin-toast{position:fixed;bottom:24px;left:50%;transform:translateX(-50%);z-index:90;
    background:#1f2937;border:1px solid #f59e0b;color:#fef3c7;padding:12px 22px;border-radius:.75rem;
    font-weight:600;font-size:.9rem;box-shadow:0 12px 40px rgba(0,0,0,.5);animation:admin-toast-in .25s ease both;}
  @keyframes admin-toast-in{from{opacity:0;transform:translate(-50%,12px);}to{opacity:1;transform:translate(-50%,0);}}

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

    // file-input change (click-to-browse) for media drop zones
    changeHandler = (e) => {
      const inp = e.target.closest('input.admin-file');
      if (!inp) return;
      const files = inp.files;
      if (files && files.length) {
        if (inp.dataset.pres) handlePresFiles(inp.dataset.pres, files);
        else handleMediaFile(inp.dataset.mkey, files[0]);
      }
      inp.value = ''; // allow re-picking the same file
    };
    rootEl.addEventListener('change', changeHandler);

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
      if (z.dataset.pres) handlePresFiles(z.dataset.pres, files);
      else handleMediaFile(z.dataset.mkey, files[0]);
    };
    rootEl.addEventListener('dragover', dragOverHandler);
    rootEl.addEventListener('dragleave', dragLeaveHandler);
    rootEl.addEventListener('drop', dropHandler);

    unsub = ctx.store.subscribe(() => { renderBody(); });
  },

  unmount() {
    clearTimers();
    if (unsub) { try { unsub(); } catch (e) {} unsub = null; }
    if (rootEl) {
      if (clickHandler) rootEl.removeEventListener('click', clickHandler);
      if (changeHandler) rootEl.removeEventListener('change', changeHandler);
      if (dragOverHandler) rootEl.removeEventListener('dragover', dragOverHandler);
      if (dragLeaveHandler) rootEl.removeEventListener('dragleave', dragLeaveHandler);
      if (dropHandler) rootEl.removeEventListener('drop', dropHandler);
    }
    revokePresUrls();
    const st = el('admin-styles');
    if (st) st.remove();
    // stray fixed-position panels/modals/toasts live inside rootEl; registry clears
    // #module-root on navigate, but null our refs so nothing dangles.
    rootEl = null; ctxRef = null;
    clickHandler = changeHandler = dragOverHandler = dragLeaveHandler = dropHandler = null;
    panelView = null; form = null; potwForm = null;
  },
};
