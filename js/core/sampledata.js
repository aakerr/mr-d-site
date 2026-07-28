// sampledata.js — builds one realistic, fully populated sample term.
//
// Mr. D's own machine starts completely empty, and an empty app is a poor way
// to show anyone (including him) what a busy term actually looks like. This
// module builds a stand-in term — four weeks of varied ledger activity, a
// few finished quests and one live per class, and an events calendar with
// both past and upcoming dates — so every screen has something real to look
// at. Nothing here is his actual class data; it exists purely to explore and
// then clear out.
//
// Only exported function: buildSampleState(). It reads the CURRENT live state
// (so whatever shop catalog, combat mode, house names and settings are
// already in place are respected) and returns a NEW state object with the
// ledger, quests and planner replaced by invented sample content. The caller
// (Admin's Settings tab) is the one that actually writes it to localStorage
// and reloads — this file only builds the data.
import { store } from './store.js';

// ---- small helpers ----------------------------------------------------------
function rand(min, max) { return Math.round(min + Math.random() * (max - min)); }
function pick(list) { return list[Math.floor(Math.random() * list.length)]; }

// A timestamp `daysAgo` full days back from right now, landing at a plausible
// school-day time (8:00–3:59) rather than the exact second the button was
// pressed — so an entry reads like a real classroom moment, not a script.
// Clamped so it can never land in the future.
function tsForDaysAgo(daysAgo) {
  const d = new Date();
  d.setDate(d.getDate() - daysAgo);
  d.setHours(rand(8, 15), rand(0, 59), 0, 0);
  return Math.min(d.getTime(), Date.now());
}

// A day somewhere in the last four school weeks (0–27 days ago).
function anyDayInTerm() { return rand(0, 27); }

// Which house an entry credits or debits. Mostly hands it to whichever house
// currently has the FEWEST points, so all four totals climb together and the
// result reads as a close race rather than one house running away with it —
// which is the whole point of showing this off as a demo.
function pickHouse(houseIds, totals) {
  if (Math.random() < 0.6) {
    return houseIds.slice().sort((a, b) => totals[a] - totals[b])[0];
  }
  return pick(houseIds);
}

// ---- flavor text --------------------------------------------------------
const BELL_RINGERS = [
  'Bell Ringer done', 'Bell Ringer: Map Warm-Up', 'Bell Ringer: Vocabulary Review',
  'Bell Ringer: Primary Source Snapshot', 'Bell Ringer: Timeline Check',
];
const HOMEWORK = [
  'Homework Hero', 'Homework Hero: Reading Notes', 'Homework Hero: Study Guide',
  'Homework Hero: Map Skills Packet',
];
const TEAMWORK = [
  'Great teamwork', 'Great teamwork during group work', 'Great teamwork on the House Challenge',
];
const MAP_QUIZZES = [
  'Map Quiz Champion: Mesopotamia', 'Map Quiz Champion: The Fertile Crescent',
  'Map Quiz Champion: Ancient Egypt', 'Map Quiz Champion: The Nile Valley',
];
const DICE_OUTCOMES = [
  { title: 'CATASTROPHE', range: [-420, -280] },
  { title: 'Small Favor', range: [100, 180] },
  { title: 'Fortune Smiles', range: [220, 340] },
  { title: 'MYTHIC TRIUMPH', range: [450, 600] },
];
const TEACHER_AWARDS = [
  { label: 'Above & Beyond', range: [150, 320] },
  { label: 'Kindness spotted', range: [80, 180] },
  { label: 'Penalty: talking during instructions', range: [-140, -60] },
  { label: 'Penalty: late to class', range: [-100, -40] },
];

// Twenty planner events, positioned as day-offsets from whenever this is run
// (negative = past, positive = upcoming) so the calendar always looks lived-in
// no matter which real date the sample data is loaded on.
const PLANNER_TEMPLATE = [
  { offset: -21, type: 'test',     core: 'all', title: 'Unit Test: Early River Civilizations' },
  { offset: -19, type: 'homework', core: 1,     title: 'Reading Notes Due: Ch. 4' },
  { offset: -18, type: 'quiz',     core: 'all', title: 'Vocabulary Quiz: Fertile Crescent Terms' },
  { offset: -16, type: 'homework', core: 2,     title: 'Map Skills Packet Due' },
  { offset: -14, type: 'note',     core: 'all', title: 'Guest Speaker: Local Historian' },
  { offset: -12, type: 'quiz',     core: 3,     title: 'Map Quiz: Mesopotamia' },
  { offset: -10, type: 'homework', core: 'all', title: 'Study Guide Due' },
  { offset: -8,  type: 'test',     core: 4,     title: 'Chapter 5 Test' },
  { offset: -6,  type: 'homework', core: 1,     title: 'Primary Source Response Due' },
  { offset: -4,  type: 'note',     core: 'all', title: 'House Points Halfway Check-In' },
  { offset: -2,  type: 'quiz',     core: 2,     title: "Pop Quiz: Hammurabi's Code" },
  { offset: 1,   type: 'homework', core: 'all', title: 'Reading Notes Due: Ch. 5' },
  { offset: 3,   type: 'quiz',     core: 'all', title: 'Map Quiz: Ancient Egypt' },
  { offset: 5,   type: 'note',     core: 'all', title: 'Progress Reports Go Home' },
  { offset: 7,   type: 'test',     core: 'all', title: 'Unit Test: The Gift of the Nile' },
  { offset: 9,   type: 'homework', core: 3,     title: 'Diorama Planning Sheet Due' },
  { offset: 12,  type: 'quiz',     core: 4,     title: 'Vocabulary Quiz: Egypt Terms' },
  { offset: 14,  type: 'vacation', core: 'all', title: 'School Break', endDays: 4 },
  { offset: 19,  type: 'homework', core: 'all', title: 'Diorama Due' },
  { offset: 21,  type: 'note',     core: 'all', title: 'House Cup Standings Update' },
];

function ymd(date) {
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`;
}
function dateFor(offsetDays) {
  const d = new Date();
  d.setDate(d.getDate() + offsetDays);
  return d;
}

// ---- the builder --------------------------------------------------------
export function buildSampleState() {
  const state = JSON.parse(JSON.stringify(store.getState()));
  const houseIds = Object.keys(store.HOUSES).map(Number);

  const totals = Object.fromEntries(houseIds.map((id) => [id, 0]));
  const txs = [];
  let n = 0;
  const push = (houseId, delta, reason, tag, ts) => {
    n += 1;
    const tx = { id: `tx-sample-${n}`, ts, houseId, delta: Math.round(delta), reason, tag };
    txs.push(tx);
    totals[houseId] += tx.delta;
    return tx;
  };

  // ---- 1) Ledger: ~85 entries from varied sources, spread across four
  // school weeks. Every point value is deliberately in the hundreds, to match
  // a Magic Shop where items cost 400–1500 — a handful of 5- and 10-point
  // taps would never add up to anything worth buying.
  for (let i = 0; i < 16; i++) {
    push(pickHouse(houseIds, totals), rand(40, 95), pick(BELL_RINGERS), 'manual', tsForDaysAgo(anyDayInTerm()));
  }
  for (let i = 0; i < 12; i++) {
    push(pickHouse(houseIds, totals), rand(80, 180), pick(HOMEWORK), 'manual', tsForDaysAgo(anyDayInTerm()));
  }
  for (let i = 0; i < 8; i++) {
    push(pickHouse(houseIds, totals), rand(60, 140), pick(TEAMWORK), 'manual', tsForDaysAgo(anyDayInTerm()));
  }
  for (let i = 0; i < 9; i++) {
    push(pickHouse(houseIds, totals), rand(220, 420), pick(MAP_QUIZZES), 'manual', tsForDaysAgo(anyDayInTerm()));
  }
  for (let i = 0; i < 9; i++) {
    const d = pick(DICE_OUTCOMES);
    push(pickHouse(houseIds, totals), rand(d.range[0], d.range[1]), `Die of Destiny: ${d.title}`, 'dice', tsForDaysAgo(anyDayInTerm()));
  }
  for (let i = 0; i < 8; i++) {
    const a = pick(TEACHER_AWARDS);
    push(pickHouse(houseIds, totals), rand(a.range[0], a.range[1]), a.label, 'manual', tsForDaysAgo(anyDayInTerm()));
  }

  // POTW bounties reference whichever destinations are actually configured
  // right now, so the wording always names a real Place of the Week profile.
  const potwProfiles = Object.values(state.potw?.profiles || {});
  for (let i = 0; i < 8; i++) {
    const p = potwProfiles.length ? pick(potwProfiles) : null;
    const fact = p?.quickFacts?.length ? pick(p.quickFacts) : 'Correct answer';
    const label = p ? `${p.title} — ${fact}` : 'Weekly voyage bounty';
    push(pickHouse(houseIds, totals), rand(120, 300), `POTW Bounty: ${label}`.slice(0, 80), 'potw', tsForDaysAgo(anyDayInTerm()));
  }

  // Shop purchases spend down whatever is actually for sale right now, in
  // whichever combat mode is currently active — so "Bought: X" always names
  // a real item at its real price. Spread uniformly across houses (not
  // fewest-first) so a purchase never pushes the house that made it broke.
  const shopItems = (state.shop?.catalog || []).filter((it) => Number(it.cost) > 0);
  for (let i = 0; i < 9; i++) {
    if (!shopItems.length) break;
    const it = pick(shopItems);
    push(pick(houseIds), -it.cost, `Bought: ${it.name}`, 'shop', tsForDaysAgo(anyDayInTerm()));
  }

  // ---- 2) Quests: scale the catalog into the same hundreds-scale economy
  // (its shipped points, 10–50, predate the Magic Shop's rescale to
  // 400–1500), then finish a handful and leave one live per class.
  const catalog = Array.isArray(state.quests?.catalog) ? state.quests.catalog : [];
  // Guard against loading sample data twice: this reads the CURRENT live
  // catalog, so a naive unconditional ×10 would re-scale an already-scaled
  // catalog into the thousands on a second load. Only quests still sitting
  // at the shipped 10–50 scale get the multiplier; anything already at or
  // above the rescaled floor (100) is left as-is.
  catalog.forEach((q) => {
    const p = Math.round(Number(q.points) || 20);
    if (p < 100) q.points = Math.max(100, p * 10);
  });

  const shuffled = catalog.slice().sort(() => Math.random() - 0.5);
  const completedPicks = shuffled.slice(0, Math.min(6, shuffled.length));
  state.quests.completed = completedPicks.map((q, i) => {
    const core = houseIds[i % houseIds.length];
    const ts = tsForDaysAgo(rand(3, 26));
    push(core, q.points, `Quest complete: ${q.title}`, 'quest', ts);
    return { id: `qc-sample-${i + 1}`, questId: q.id, title: q.title, core, ts, points: q.points };
  });

  const remaining = shuffled.slice(completedPicks.length);
  const activePool = remaining.length >= houseIds.length ? remaining : shuffled;
  state.quests.active = {};
  houseIds.forEach((core, i) => {
    const q = activePool[i % activePool.length];
    if (!q) return;
    state.quests.active[core] = { questId: q.id, startedTs: tsForDaysAgo(rand(0, 5)) };
  });

  // A genuine race: nobody sits near zero, and nobody has run away with it.
  // This tops up any house lagging more than ~35% behind the leader — folded
  // in as one more ordinary "Great teamwork" entry, not a visible correction.
  // Each house's target is independently randomized (not a single fixed
  // number) so two lagging houses never land on the exact same total, which
  // would look like a bug rather than a coincidence.
  const leader = Math.max(...houseIds.map((id) => totals[id]));
  houseIds.forEach((id) => {
    if (totals[id] < 400 || totals[id] < leader * 0.65) {
      const target = leader * (0.68 + Math.random() * 0.18);
      const bonus = Math.max(200, Math.round(target - totals[id]));
      push(id, bonus, pick(TEAMWORK), 'manual', tsForDaysAgo(rand(0, 2)));
    }
  });

  state.transactions = txs;

  // ---- 3) Planner: ~20 events spanning three weeks back to three weeks
  // ahead, so the calendar looks lived-in the moment this loads. Term-start /
  // term-end markers and any Place-of-the-Week launch markers are real
  // structural data tied to other settings, so those are kept as-is; only the
  // day-to-day content (homework/tests/quizzes/notes/vacations) is replaced.
  const keptEvents = (state.planner?.events || []).filter((e) => ['term-start', 'term-end', 'potw'].includes(e.type));
  const sampleEvents = PLANNER_TEMPLATE.map((t, i) => {
    const evt = { id: `ev-sample-${i + 1}`, core: t.core, title: t.title, type: t.type, date: ymd(dateFor(t.offset)) };
    if (t.endDays) evt.endDate = ymd(dateFor(t.offset + t.endDays));
    return evt;
  });
  state.planner = { events: keptEvents.concat(sampleEvents) };

  // ---- 4) A clean slate for anything Battle-Day-live, so the sample term
  // doesn't open mid-fight with stale shields, freezes or armouries left over
  // from whatever was happening before it loaded.
  state.inventory = {};
  state.hp = {};
  state.shields = {};
  state.frozen = {};
  state.defenses = {};
  state.potwBounties = {};

  return state;
}
