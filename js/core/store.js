// State store — single source of truth, localStorage-persisted.
// All point changes flow through addPoints() so every change is a logged transaction.
import { CONFIG } from '../config.js';

const HOUSES = {
  1: { id: 1, core: 1, name: 'Camelot',   motto: 'Honor Above All',      color: 'red',   accent: '#ef4444', accentSoft: 'rgba(239,68,68,0.35)',  image: 'images/camelot.jpg' },
  2: { id: 2, core: 2, name: 'Atlantis',  motto: 'Depths of Wisdom',     color: 'blue',  accent: '#3b82f6', accentSoft: 'rgba(59,130,246,0.35)', image: 'images/atlantis.jpg' },
  3: { id: 3, core: 3, name: 'Valhalla',  motto: 'Glory Everlasting',    color: 'gold',  accent: '#f59e0b', accentSoft: 'rgba(245,158,11,0.35)', image: 'images/valhalla.jpg' },
  4: { id: 4, core: 4, name: 'Rivendell', motto: 'Wisdom of the Ages',   color: 'green', accent: '#22c55e', accentSoft: 'rgba(34,197,94,0.35)',  image: 'images/rivendell.jpg' },
};

function defaultState() {
  return {
    version: 1,
    activeCore: 1,
    settings: {                 // teacher-configurable (admin panel)
      termStart: CONFIG.TERM.startDate,   // 'YYYY-MM-DD' (Monday)
      termWeeks: CONFIG.TERM.totalWeeks,
    },
    // Planner events (admin panel). One record per calendar item:
    // { id, date:'YYYY-MM-DD', endDate?, type:'term-start'|'term-end'|'vacation'|'test'|'quiz'|'homework'|'itinerary'|'note',
    //   core: 1|2|3|4|'all', title, items?: [{time,text}] }
    planner: { events: [] },
    transactions: [],           // { id, ts, houseId, delta, reason, tag }
    shields: {},                // houseId -> expiry epoch ms
    itineraries: {
      1: [{ time: '8:05',  text: 'Bell Ringer: Map of the Fertile Crescent' },
          { time: '8:20',  text: 'Lesson: Rivers & Early Civilizations' },
          { time: '8:50',  text: 'House Challenge: Cuneiform Decoder' }],
      2: [{ time: '9:35',  text: 'Bell Ringer: Geography Warm-Up' },
          { time: '9:50',  text: 'Lesson: Rivers & Early Civilizations' },
          { time: '10:20', text: 'House Challenge: Cuneiform Decoder' }],
      3: [{ time: '12:10', text: 'Bell Ringer: Vocabulary Review' },
          { time: '12:25', text: 'Lesson: Rivers & Early Civilizations' },
          { time: '12:55', text: 'House Challenge: Cuneiform Decoder' }],
      4: [{ time: '1:45',  text: 'Bell Ringer: Primary Source Snapshot' },
          { time: '2:00',  text: 'Lesson: Rivers & Early Civilizations' },
          { time: '2:30',  text: 'House Challenge: Cuneiform Decoder' }],
    },
    homework: {
      1: [{ due: 'Fri', text: 'Map Quiz: Mesopotamia & the Fertile Crescent' }],
      2: [{ due: 'Fri', text: 'Map Quiz: Mesopotamia & the Fertile Crescent' }],
      3: [{ due: 'Fri', text: 'Map Quiz: Mesopotamia & the Fertile Crescent' }],
      4: [{ due: 'Fri', text: 'Map Quiz: Mesopotamia & the Fertile Crescent' }],
    },
    potw: {
      active: CONFIG.POTW_ACTIVE,
      profiles: {
        mesopotamia: {
          title: 'Ancient Mesopotamia',
          subtitle: 'Modern Day Iraq • The Fertile Crescent',
          camera: { center: { lat: 32.5363, lng: 44.4223, altitude: 150 }, range: 2000, tilt: 60, heading: 45 },
          quickFacts: [
            'The "Land Between Two Rivers" — the Tigris and the Euphrates.',
            'Part of the Fertile Crescent, where farming first flourished.',
            'Home to the Sumerians and Babylonians.',
            'Birthplace of the wheel, the plow, and written law (Hammurabi\'s Code).',
            'Cuneiform, pressed into clay tablets, is the earliest known writing system.',
          ],
          primarySources: [
            { name: 'Cuneiform Tablet', emoji: '𒀭', desc: 'Clay tablets recorded trades, taxes, and stories — including the Epic of Gilgamesh.' },
            { name: 'Code of Hammurabi', emoji: '⚖️', desc: 'A stone stele listing 282 laws — "an eye for an eye" — one of the oldest legal codes.' },
            { name: 'Ziggurat of Ur', emoji: '🏛️', desc: 'Massive stepped temple towers built to honor city gods.' },
          ],
          quiz: [
            { q: 'Which two rivers define Mesopotamia?', a: 'The Tigris and the Euphrates' },
            { q: 'What is the name of the earliest known writing system?', a: 'Cuneiform' },
            { q: 'What curved region of rich farmland includes Mesopotamia?', a: 'The Fertile Crescent' },
          ],
        },
      },
    },
  };
}

let state = load();
const listeners = new Set();

function load() {
  try {
    const raw = localStorage.getItem(CONFIG.STORAGE_KEY);
    if (raw) return { ...defaultState(), ...JSON.parse(raw) };
  } catch (e) { console.warn('store: failed to load, using defaults', e); }
  return defaultState();
}

function persist() {
  try { localStorage.setItem(CONFIG.STORAGE_KEY, JSON.stringify(state)); }
  catch (e) { console.warn('store: persist failed', e); }
}

function emit() { persist(); listeners.forEach((fn) => { try { fn(state); } catch (e) { console.error(e); } }); }

function startOfWeek(d = new Date()) {
  const x = new Date(d); const day = (x.getDay() + 6) % 7; // Monday=0
  x.setHours(0, 0, 0, 0); x.setDate(x.getDate() - day); return x;
}

function todayStr() {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

function fmtDue(dateStr) {
  const d = new Date(dateStr + 'T00:00:00');
  const days = Math.round((d - new Date(todayStr() + 'T00:00:00')) / 86400000);
  if (days === 0) return 'Today';
  if (days === 1) return 'Tomorrow';
  if (days < 7) return d.toLocaleDateString(undefined, { weekday: 'short' });
  return d.toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
}

export const store = {
  HOUSES,
  getState: () => state,
  subscribe(fn) { listeners.add(fn); return () => listeners.delete(fn); },

  setActiveCore(core) {
    state.activeCore = core === 'all' ? 'all' : Number(core);
    emit();
  },

  getActiveHouse() {
    return state.activeCore === 'all' ? null : HOUSES[state.activeCore] || null;
  },

  addPoints(houseId, delta, { reason = '', tag = '' } = {}) {
    delta = Math.max(-9999, Math.min(9999, Math.round(Number(delta) || 0)));
    if (!delta || !HOUSES[houseId]) return null;
    const tx = { id: `tx-${Date.now()}-${state.transactions.length}`, ts: Date.now(), houseId: Number(houseId), delta, reason, tag };
    state.transactions.push(tx);
    emit();
    return tx;
  },

  getTotal(houseId, scope = 'term') {
    const since = scope === 'week' ? startOfWeek().getTime() : 0;
    return state.transactions.reduce((sum, t) => (t.houseId === Number(houseId) && t.ts >= since ? sum + t.delta : sum), 0);
  },

  getTotals(scope = 'term') {
    return Object.values(HOUSES)
      .map((house) => ({ house, total: store.getTotal(house.id, scope) }))
      .sort((a, b) => b.total - a.total);
  },

  getTransactions({ houseId = null, limit = 50 } = {}) {
    let txs = state.transactions;
    if (houseId != null) txs = txs.filter((t) => t.houseId === Number(houseId));
    return txs.slice(-limit).reverse();
  },

  purchase(houseId, cost, itemName) {
    if (store.getTotal(houseId, 'term') < cost) return false;
    store.addPoints(houseId, -cost, { reason: `Bought: ${itemName}`, tag: 'shop' });
    return true;
  },

  activateShield(houseId) {
    state.shields[houseId] = Date.now() + 24 * 60 * 60 * 1000;
    emit();
  },

  isShielded(houseId) {
    return (state.shields[houseId] || 0) > Date.now();
  },

  // ----- settings (teacher admin) -----

  getSettings() {
    return { termStart: CONFIG.TERM.startDate, termWeeks: CONFIG.TERM.totalWeeks, ...(state.settings || {}) };
  },

  updateSettings(patch) {
    state.settings = { ...store.getSettings(), ...patch };
    emit();
  },

  getTermInfo() {
    const s = store.getSettings();
    const start = new Date(s.termStart + 'T00:00:00');
    const week = Math.min(s.termWeeks, Math.max(1, Math.floor((Date.now() - start.getTime()) / (7 * 86400000)) + 1));
    return { week, totalWeeks: s.termWeeks, label: `Week ${week} of ${s.termWeeks}-Week Term` };
  },

  // ----- planner events (teacher admin calendar) -----

  addEvent(evt) {
    if (!evt?.date || !evt?.type) return null;
    const e = { id: `ev-${Date.now()}-${(state.planner.events.length)}`, core: 'all', title: '', ...evt };
    state.planner.events.push(e);
    emit();
    return e;
  },

  updateEvent(id, patch) {
    const e = state.planner.events.find((x) => x.id === id);
    if (!e) return null;
    Object.assign(e, patch);
    emit();
    return e;
  },

  removeEvent(id) {
    const before = state.planner.events.length;
    state.planner.events = state.planner.events.filter((x) => x.id !== id);
    if (state.planner.events.length !== before) emit();
  },

  getEvents({ from = null, to = null, type = null, core = null } = {}) {
    return state.planner.events
      .filter((e) =>
        (!from || (e.endDate || e.date) >= from) &&
        (!to || e.date <= to) &&
        (!type || e.type === type) &&
        (core == null || e.core === 'all' || e.core === core))
      .sort((a, b) => a.date.localeCompare(b.date));
  },

  getEventsOn(date, core = null) {
    return store.getEvents({ core }).filter((e) => e.date <= date && (e.endDate || e.date) >= date);
  },

  // ----- itinerary & homework (planner-aware with static fallback) -----

  getItinerary(core = state.activeCore, date = todayStr()) {
    if (core === 'all') return [];
    const planned = store.getEventsOn(date, core).find((e) => e.type === 'itinerary' && Array.isArray(e.items));
    if (planned) return planned.items;
    return state.itineraries[core] || [];
  },

  getHomework(core = state.activeCore, date = todayStr()) {
    if (core === 'all') return [];
    const upcoming = store.getEvents({ from: date, core })
      .filter((e) => ['homework', 'test', 'quiz'].includes(e.type))
      .slice(0, 6)
      .map((e) => ({ due: fmtDue(e.date), text: e.title || e.type }));
    if (upcoming.length) return upcoming;
    return state.homework[core] || [];
  },

  // ----- Place of the Week profiles (teacher admin) -----

  getPotwProfile() {
    return state.potw.profiles[state.potw.active];
  },

  getPotwProfiles() {
    return state.potw.profiles;
  },

  getActivePotwKey() {
    return state.potw.active;
  },

  setActivePotw(key) {
    if (!state.potw.profiles[key]) return false;
    state.potw.active = key;
    emit();
    return true;
  },

  savePotwProfile(key, profile) {
    if (!key || !profile?.title) return false;
    state.potw.profiles[key] = profile;
    emit();
    return true;
  },

  deletePotwProfile(key) {
    if (key === state.potw.active || !state.potw.profiles[key]) return false;
    delete state.potw.profiles[key];
    emit();
    return true;
  },

  resetAll() {
    state = defaultState();
    emit();
  },
};
