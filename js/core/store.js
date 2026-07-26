// State store — single source of truth, localStorage-persisted.
// All point changes flow through addPoints() so every change is a logged transaction.
import { CONFIG } from '../config.js';

// image = shield crest (used everywhere a house image appears);
// heroImage = wide banner art for hero headers.
const HOUSES = {
  1: { id: 1, core: 1, name: 'Camelot',   motto: 'Honor Above All',      color: 'red',   accent: '#ef4444', accentSoft: 'rgba(239,68,68,0.35)',  image: 'images/camelot-shield.png',   heroImage: 'images/header-camelot.jpg' },
  2: { id: 2, core: 2, name: 'Atlantis',  motto: 'Depths of Wisdom',     color: 'blue',  accent: '#3b82f6', accentSoft: 'rgba(59,130,246,0.35)', image: 'images/atlantis-shield.png',  heroImage: 'images/header-atlantis.jpg' },
  3: { id: 3, core: 3, name: 'Valhalla',  motto: 'Glory Everlasting',    color: 'gold',  accent: '#f59e0b', accentSoft: 'rgba(245,158,11,0.35)', image: 'images/valhalla-shield.png',  heroImage: 'images/header-valhalla.jpg' },
  4: { id: 4, core: 4, name: 'Rivendell', motto: 'Wisdom of the Ages',   color: 'green', accent: '#22c55e', accentSoft: 'rgba(34,197,94,0.35)',  image: 'images/rivendell-shield.png', heroImage: 'images/header-rivendell.jpg' },
};

// Pristine copies of the shipped house definitions, so a teacher edit can
// always be reverted even after HOUSES has been mutated in place.
const HOUSE_DEFAULTS = JSON.parse(JSON.stringify(HOUSES));
function defaultHouses() { return JSON.parse(JSON.stringify(HOUSE_DEFAULTS)); }

// The teacher's most-used awards, one tap each. Editable in Admin.
function defaultAwardPresets() {
  return [
    { id: 'ap-bell',     label: 'Bell Ringer done',  points: 5,  tag: 'manual' },
    { id: 'ap-homework', label: 'Homework Hero',     points: 10, tag: 'manual' },
    { id: 'ap-teamwork', label: 'Great teamwork',    points: 5,  tag: 'manual' },
    { id: 'ap-quiz',     label: 'Map Quiz Champion', points: 50, tag: 'manual' },
    { id: 'ap-penalty',  label: 'Penalty',           points: -5, tag: 'manual' },
  ];
}

// Quest kinds. The icon rides on the card so a class can tell at a glance what
// sort of task it is — which is what the repeated crossed-swords could never do.
// 'service' is the fallback for anything untyped (a quest the teacher wrote
// before this existed, or one restored from an older backup).
const QUEST_TYPES = {
  service:   { id: 'service',   icon: '🤝', label: 'Service',   blurb: 'Helping the school run' },
  academic:  { id: 'academic',  icon: '📚', label: 'Academic',  blurb: 'Learning and schoolwork' },
  community: { id: 'community', icon: '❤️', label: 'Community', blurb: 'Giving and kindness' },
  habit:     { id: 'habit',     icon: '⭐', label: 'Habit',     blurb: 'Daily and weekly conduct' },
};
const DEFAULT_QUEST_TYPE = 'service';

function defaultQuestCatalog() {
  // Starter catalog — points scale with effort and benefit to class/school.
  return [
    { id: 'q-school-event',   points: 20, title: 'School Event Squad',       desc: 'Attend a school event together. Proof: photos showing at least half the class there.', type: 'service', repeatable: true },
    { id: 'q-library',        points: 15, title: 'Library Legends',          desc: 'Every student checks out a library book and logs one thing they learned.', type: 'service', repeatable: true },
    { id: 'q-cleanup',        points: 30, title: 'Campus Cleanup Crew',      desc: 'Clean a shared school space during recess or lunch. Proof: before & after photos.', type: 'service', repeatable: true },
    { id: 'q-kindness',       points: 25, title: 'Kindness Campaign',        desc: 'Deliver 25 hand-written kind notes to students or staff around the building.', type: 'community', repeatable: true },
    { id: 'q-tutors',         points: 35, title: 'Tutor Titans',             desc: 'Five classmates tutor younger students for one week (teacher sign-off from their room).', type: 'academic', repeatable: true },
    { id: 'q-attendance',     points: 30, title: 'Perfect Attendance Week',  desc: 'Every student present, every day, for one full week.', type: 'habit', repeatable: true },
    { id: 'q-homework',       points: 25, title: 'Homework Hundred',         desc: '100% homework turn-in from the whole class for a full week.', type: 'academic', repeatable: true },
    { id: 'q-food-drive',     points: 40, title: 'Food Drive Forces',        desc: 'Bring in 50+ items for the school food drive.', type: 'community' },
    { id: 'q-recycling',      points: 20, title: 'Recycling Rangers',        desc: 'Collect and sort recycling from all 7th-grade rooms for one week.', type: 'service', repeatable: true },
    { id: 'q-thank-you',      points: 15, title: 'Teacher Appreciation Op',  desc: 'Write and deliver thank-you cards to five teachers or staff members.', type: 'community', repeatable: true },
    { id: 'q-greeters',       points: 20, title: 'Morning Ambassadors',      desc: 'Greet students at the front doors for three mornings with school-approved signs.', type: 'community', repeatable: true },
    { id: 'q-spirit',         points: 25, title: 'Spirit Week Sweep',        desc: 'At least 75% of the class participates in every day of Spirit Week.', type: 'habit' },
    { id: 'q-welcome',        points: 15, title: 'New Student Welcome',      desc: 'Build a welcome guide and buddy system for students who join mid-year.', type: 'community' },
    { id: 'q-garden',         points: 30, title: 'School Garden Guardians',  desc: 'Plant or maintain the school garden for two weeks. Proof: photo log.', type: 'service' },
    { id: 'q-history-fair',   points: 50, title: 'History Fair Heroes',      desc: 'Every student completes and presents a history fair entry.', type: 'academic' },
    { id: 'q-current-events', points: 20, title: 'Current Events Council',   desc: 'Deliver five student-led current-events briefings to the class.', type: 'academic', repeatable: true },
    { id: 'q-book-drive',     points: 35, title: 'Book Drive Battalion',     desc: 'Collect 40 gently used books to donate to the school library.', type: 'community' },
    { id: 'q-transitions',    points: 10, title: 'Silent Transition Masters',desc: 'One full week of fast, silent transitions between activities.', type: 'habit', repeatable: true },
    { id: 'q-fundraiser',     points: 45, title: 'Fundraiser Front Line',    desc: 'Hit the class goal in a school fundraiser (or raise the most of any class).', type: 'community' },
    { id: 'q-museum',         points: 40, title: 'Museum of Us',             desc: 'Build a classroom museum exhibit and host another class for a guided tour.', type: 'academic' },
  ];
}

function defaultState() {
  return {
    version: 1,
    activeCore: 1,
    settings: {                 // teacher-configurable (admin panel)
      termStart: CONFIG.TERM.startDate,   // 'YYYY-MM-DD' (Monday)
      termWeeks: CONFIG.TERM.totalWeeks,
      theme: { mode: 'dark', seasonal: false },  // mode: 'dark' | 'light'
      mapsApiKeyOverride: '',   // teacher's own Maps key (blank = bundled default)
      soundEnabled: true,       // master switch for sound effects/voice
      // Quiet per-screen background loops (see js/core/ambient.js).
      ambient: { enabled: false, volume: 0.25, tracks: null },  // opt-in: teacher turns it on in Admin
      // Teacher PIN (js/core/lock.js). Empty pinHash = off, which is the default:
      // the app must never lock a teacher out of a fresh install. `len` is the
      // digit count so the PIN pad knows when an entry is complete.
      lock: { pinHash: '', len: 4, minutes: 15 },
      awardPresets: defaultAwardPresets(),  // one-tap awards on the Records screen
      // Teacher edits to the four houses (name/motto/accent/artwork). Applied
      // over the built-in defaults at load so nothing is hardcoded for them.
      houses: {},
      // Intro videos offered in the POTW dropdown. Seeded from CONFIG so the
      // teacher can add their own without anyone editing source.
      introVideos: null,
    },
    quests: {
      // One quest active per core at a time; completion is teacher-confirmed.
      catalog: defaultQuestCatalog(),
      active: {},     // core -> { questId, startedTs }
      completed: [],  // { id, questId, title, core, ts, points }
    },
    shop: {
      // Magic Shop items, teacher-editable in Admin.
      // effect.kind:
      //   'attack'  — deduct amount from a chosen house
      //   'steal'   — take amount from the leading house
      //   'shield'  — block incoming attacks for `amount` hours
      //   'reduce'  — halve incoming damage for `amount` hours (Mythic rewards)
      //   'pierce'  — attack for `amount` that ignores shields AND reductions
      //   'wild'    — random swing of ±amount, resolved at purchase
      // mythicOnly items can't be bought; a Nat 20 grants them.
      catalog: [
        // ---- Offensive ----
        { id: 'catapult',  name: 'Catapult Volley',        emoji: '🪨', image: '', cost: 35, desc: 'Roman siege engines hurl stones over the walls. Deduct 20 pts from a house you choose.', effect: { kind: 'attack', amount: 20 } },
        { id: 'greekfire', name: 'Greek Fire',             emoji: '🔥', image: '', cost: 45, desc: 'The Byzantine secret weapon that burned on water. Deduct 25 pts from a house you choose.', effect: { kind: 'attack', amount: 25 } },
        { id: 'elephants', name: "Hannibal's War Elephants", emoji: '🐘', image: '', cost: 55, desc: 'Over the Alps and into Roman territory. Deduct 30 pts from a house you choose.', effect: { kind: 'attack', amount: 30 } },
        { id: 'heatray',   name: "Archimedes' Heat Ray",   emoji: '☀️', image: '', cost: 65, desc: 'Mirrors focus the sun on enemy ships at Syracuse. Deduct 35 pts from a house you choose.', effect: { kind: 'attack', amount: 35 } },
        { id: 'trojan',    name: 'Trojan Horse',           emoji: '🐴', image: '', cost: 50, desc: 'A gift hiding an army. Steal 25 pts from whichever house is leading.', effect: { kind: 'steal', amount: 25 } },
        // ---- Offensive: pierce (ignores defenses) ----
        { id: 'cloak',     name: 'Invisibility Cloak',     emoji: '🫥', image: '', cost: 60, desc: 'Strike unseen — ignores shields AND damage reduction. Deduct 20 pts.', effect: { kind: 'pierce', amount: 20 } },
        { id: 'fogbank',   name: 'Fog Bank',               emoji: '🌫️', image: '', cost: 70, desc: 'Advance under cover — ignores shields AND damage reduction. Deduct 25 pts.', effect: { kind: 'pierce', amount: 25 } },
        // ---- Defensive ----
        { id: 'phalanx',   name: 'Phalanx Formation',      emoji: '🛡️', image: '', cost: 25, desc: 'Locked shields, bristling spears. Blocks incoming attacks for 12 hours.', effect: { kind: 'shield', amount: 12 } },
        { id: 'aegis',     name: 'Aegis Shield',           emoji: '⚡', image: '', cost: 30, desc: "Athena's shield, feared by gods and men. Blocks incoming attacks for 24 hours.", effect: { kind: 'shield', amount: 24 } },
        { id: 'shieldwall',name: 'Shield Wall',            emoji: '🪵', image: '', cost: 35, desc: 'The Viking skjaldborg — no gap for a blade. Blocks incoming attacks for 24 hours.', effect: { kind: 'shield', amount: 24 } },
        { id: 'moat',      name: 'Moat & Drawbridge',      emoji: '🏰', image: '', cost: 45, desc: 'Raise the bridge and hold the keep. Blocks incoming attacks for 36 hours.', effect: { kind: 'shield', amount: 36 } },
        { id: 'greatwall', name: 'The Great Wall',         emoji: '🧱', image: '', cost: 60, desc: 'Thousands of miles of stone and watchtowers. Blocks incoming attacks for 48 hours.', effect: { kind: 'shield', amount: 48 } },
        // ---- Wildcards ----
        { id: 'pandora',   name: "Pandora's Box",          emoji: '📦', image: '', cost: 40, desc: 'Every evil escapes — but hope remains. Random swing of up to 30 pts, for you or against you.', effect: { kind: 'wild', amount: 30 } },
        { id: 'fortuna',   name: "Fortuna's Wheel",        emoji: '🎡', image: '', cost: 30, desc: 'The Roman goddess of luck spins the wheel. Random swing of up to 20 pts, either way.', effect: { kind: 'wild', amount: 20 } },
        // ---- Mythic rewards (granted by a natural 20, never purchasable) ----
        { id: 'spynetwork',name: 'Spy Network',            emoji: '🕵️', image: '', cost: 0, mythicOnly: true, desc: 'Your agents hear the plan before it happens. Incoming damage is HALVED for 48 hours.', effect: { kind: 'reduce', amount: 48 } },
        { id: 'lookout',   name: 'Lookout Tower',          emoji: '🗼', image: '', cost: 0, mythicOnly: true, desc: 'See the dust of an army on the horizon. Incoming damage is HALVED for 48 hours.', effect: { kind: 'reduce', amount: 48 } },
        { id: 'oracle',    name: 'Oracle of Delphi',       emoji: '🔮', image: '', cost: 0, mythicOnly: true, desc: 'The Pythia foretells the coming blow. Incoming damage is HALVED for 72 hours.', effect: { kind: 'reduce', amount: 72 } },
      ],
      seeded: ['catapult','greekfire','elephants','heatray','trojan','cloak','fogbank','phalanx','aegis','shieldwall','moat','greatwall','pandora','fortuna','spynetwork','lookout','oracle'],
    },
    // Planner events (admin panel). One record per calendar item:
    // { id, date:'YYYY-MM-DD', endDate?, type:'term-start'|'term-end'|'vacation'|'test'|'quiz'|'homework'|'itinerary'|'note',
    //   core: 1|2|3|4|'all', title, items?: [{time,text}] }
    planner: { events: [] },
    // Paid POTW quiz bounties, keyed '<profileKey>|<weekOf>|<questionIndex>'
    // so relaunching the same voyage can't pay the same bounty twice.
    potwBounties: {},
    transactions: [],           // { id, ts, houseId, delta, reason, tag }
    shields: {},                // houseId -> expiry epoch ms (full block; legacy key)
    // houseId -> { reduce: expiryMs } — halved incoming damage (Mythic rewards)
    defenses: {},
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
          weekOf: '',            // 'YYYY-MM-DD' Monday — launches during that week
          introVideoId: 'rock',  // preset from CONFIG.POTW_INTRO_VIDEOS
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
        egypt: {
          title: 'Ancient Egypt',
          subtitle: 'Modern Day Egypt • The Gift of the Nile',
          weekOf: '2026-07-27',      // plays the week of Mon Jul 27
          introVideoId: 'classic',
          camera: { center: { lat: 29.9792, lng: 31.1342, altitude: 150 }, range: 2200, tilt: 60, heading: 45 },
          quickFacts: [
            'The Nile flooded every year, leaving rich black soil the Egyptians called "kemet".',
            'The Great Pyramid of Giza was built for Pharaoh Khufu around 2560 BCE.',
            'Hieroglyphics combined pictures and sounds — over 700 symbols.',
            'Pharaohs were both kings and gods on earth.',
            'Mummification preserved the body for the afterlife; it took about 70 days.',
          ],
          primarySources: [
            { name: 'Rosetta Stone', emoji: '🪨', desc: 'One decree in three scripts — the key that let scholars finally read hieroglyphics.' },
            { name: 'Book of the Dead', emoji: '📜', desc: 'Spells and maps written on papyrus to guide the dead safely through the afterlife.' },
            { name: 'Tutankhamun\'s Mask', emoji: '⚱️', desc: 'Solid gold burial mask of a boy king, found nearly untouched in 1922.' },
          ],
          quiz: [
            { q: 'Which river made Egyptian farming possible?', a: 'The Nile' },
            { q: 'What was the Egyptian writing system called?', a: 'Hieroglyphics' },
            { q: 'What artifact allowed scholars to decode hieroglyphics?', a: 'The Rosetta Stone' },
          ],
        },
      },
    },
  };
}

// Mutating in place (rather than replacing HOUSES) keeps every existing
// reference across the modules valid when the teacher renames a house.
function applyHouseOverrides(overrides = {}) {
  for (const [id, patch] of Object.entries(overrides || {})) {
    const house = HOUSES[id];
    if (!house || !patch) continue;
    for (const key of ['name', 'motto', 'accent', 'accentSoft', 'image', 'heroImage']) {
      if (patch[key]) house[key] = patch[key];
    }
  }
}

let state = load();
const listeners = new Set();

function load() {
  try {
    const raw = localStorage.getItem(CONFIG.STORAGE_KEY);
    if (raw) {
      const def = defaultState();
      const saved = JSON.parse(raw);
      const merged = { ...def, ...saved };
      // Migration: fill gaps in saved POTW profiles from newer defaults without
      // clobbering the teacher's edits, and add default destinations that were
      // seeded after this browser last saved (e.g. a newly shipped place).
      merged.potw = merged.potw || def.potw;
      merged.potw.profiles = merged.potw.profiles || {};
      for (const [key, defProfile] of Object.entries(def.potw.profiles)) {
        merged.potw.profiles[key] = merged.potw.profiles[key]
          ? { ...defProfile, ...merged.potw.profiles[key] }
          : { ...defProfile };
      }
      // A saved videoUrl that is really one of our presets should show up as
      // that preset in the dropdown, not as an opaque "custom link".
      const presets = CONFIG.POTW_INTRO_VIDEOS || [];
      for (const p of Object.values(merged.potw.profiles)) {
        const match = p.videoUrl && presets.find((v) => v.url === p.videoUrl);
        if (match) { p.introVideoId = match.id; delete p.videoUrl; }
      }
      // Same for settings (new keys like theme/mapsApiKeyOverride).
      merged.settings = { ...def.settings, ...(merged.settings || {}) };
      merged.settings.theme = { ...def.settings.theme, ...(merged.settings.theme || {}) };
      merged.settings.ambient = { ...def.settings.ambient, ...(merged.settings.ambient || {}) };
      merged.settings.lock = { ...def.settings.lock, ...(merged.settings.lock || {}) };
      // Deep-merge the other sub-trees too: a state saved before a feature
      // existed (or restored from an old backup) would otherwise be missing
      // keys the modules dereference unguarded — e.g. quests.completed.push().
      merged.quests = { ...def.quests, ...(merged.quests || {}) };
      if (!Array.isArray(merged.quests.catalog) || !merged.quests.catalog.length) merged.quests.catalog = def.quests.catalog;
      // Backfill quest fields added after this browser last saved: pick up the
      // shipped `repeatable` flag by id, and give every quest a fail penalty.
      const defQuestById = Object.fromEntries(def.quests.catalog.map((q) => [q.id, q]));
      merged.quests.catalog = merged.quests.catalog.map((q) => {
        const d = defQuestById[q.id];
        return {
          ...q,
          repeatable: q.repeatable ?? (d ? !!d.repeatable : false),
          penalty: Number.isFinite(Number(q.penalty)) ? Number(q.penalty)
            : (d && Number.isFinite(Number(d.penalty)) ? Number(d.penalty) : Math.round(Number(q.points || 0) / 2)),
          // Quest kinds arrived after some browsers had already saved. Take the
          // shipped type by id; a quest the teacher wrote themselves has no
          // default to borrow, so it lands on the fallback until they pick one.
          type: QUEST_TYPES[q.type] ? q.type
            : (d && QUEST_TYPES[d.type] ? d.type : DEFAULT_QUEST_TYPE),
        };
      });
      if (!merged.quests.active || typeof merged.quests.active !== 'object') merged.quests.active = {};
      if (!Array.isArray(merged.quests.completed)) merged.quests.completed = [];
      merged.shop = { ...def.shop, ...(merged.shop || {}) };
      if (!Array.isArray(merged.shop.catalog)) merged.shop.catalog = def.shop.catalog;
      // Introduce newly-shipped shop items exactly once. `seeded` records every
      // default id this browser has already seen, so an item the teacher chose
      // to delete stays deleted instead of reappearing on every reload.
      // NOTE: read this off the SAVED object — `merged` would have inherited the
      // default's full seeded list via the spread and suppressed every new item.
      merged.shop.seeded = Array.isArray(saved.shop?.seeded)
        ? saved.shop.seeded
        : (Array.isArray(saved.shop?.catalog) ? saved.shop.catalog.map((i) => i.id) : []);
      for (const item of def.shop.catalog) {
        if (!merged.shop.seeded.includes(item.id)) {
          merged.shop.catalog.push({ ...item });
          merged.shop.seeded.push(item.id);
        }
      }
      merged.planner = { ...def.planner, ...(merged.planner || {}) };
      if (!Array.isArray(merged.planner.events)) merged.planner.events = [];
      if (!Array.isArray(merged.transactions)) merged.transactions = [];
      if (!merged.shields || typeof merged.shields !== 'object') merged.shields = {};
      // Drop expired shields so they can't be revived by an old backup.
      for (const [id, exp] of Object.entries(merged.shields)) {
        if (!(Number(exp) > Date.now())) delete merged.shields[id];
      }
      merged.potwBounties = merged.potwBounties && typeof merged.potwBounties === 'object' ? merged.potwBounties : {};
      if (!Array.isArray(merged.settings.introVideos) || !merged.settings.introVideos.length) {
        merged.settings.introVideos = (CONFIG.POTW_INTRO_VIDEOS || []).map((v) => ({ ...v }));
      }
      // Teacher's house edits are applied IN PLACE onto the shared HOUSES
      // objects, so every module holding a reference sees the new values.
      applyHouseOverrides(merged.settings.houses);
      merged.defenses = merged.defenses && typeof merged.defenses === 'object' ? merged.defenses : {};
      for (const [id, d] of Object.entries(merged.defenses)) {
        if (!d || !(Number(d.reduce) > Date.now())) delete merged.defenses[id];
      }
      return merged;
    }
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

function addDays(dateStr, n) {
  const d = new Date(dateStr + 'T00:00:00');
  d.setDate(d.getDate() + n);
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
  QUEST_TYPES,
  // Icon for a quest's kind, falling back rather than rendering a blank.
  questType(q) { return QUEST_TYPES[q && q.type] || QUEST_TYPES[DEFAULT_QUEST_TYPE]; },
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

  getTransactions({ houseId = null, tag = null, from = null, to = null, search = '', limit = 50 } = {}) {
    let txs = state.transactions;
    if (houseId != null) txs = txs.filter((t) => t.houseId === Number(houseId));
    if (tag) txs = txs.filter((t) => (t.tag || 'manual') === tag);
    if (from) { const f = new Date(from + 'T00:00:00').getTime(); txs = txs.filter((t) => t.ts >= f); }
    if (to) { const e = new Date(to + 'T23:59:59').getTime(); txs = txs.filter((t) => t.ts <= e); }
    if (search) { const q = search.toLowerCase(); txs = txs.filter((t) => (t.reason || '').toLowerCase().includes(q)); }
    const out = txs.slice().reverse();
    return limit == null ? out : out.slice(0, limit);
  },

  // ----- ledger analytics -----

  // Points per house for each week of the term — the shape of the House Cup
  // race. `cumulative` gives the running total instead of the week's net.
  getWeeklySeries({ cumulative = false } = {}) {
    const s = store.getSettings();
    const start = new Date(s.termStart + 'T00:00:00').getTime();
    const weeks = Math.max(1, Number(s.termWeeks) || 9);
    const running = {};
    const out = [];
    for (let w = 0; w < weeks; w++) {
      const from = start + w * 7 * 86400000;
      const to = from + 7 * 86400000;
      const totals = {};
      for (const id of Object.keys(HOUSES)) {
        const net = state.transactions.reduce((sum, t) =>
          (t.houseId === Number(id) && t.ts >= from && t.ts < to ? sum + t.delta : sum), 0);
        running[id] = (running[id] || 0) + net;
        totals[id] = cumulative ? running[id] : net;
      }
      out.push({ week: w + 1, from: new Date(from), totals });
    }
    return out;
  },

  // Where a house's points actually came from, by tag.
  getBreakdown(houseId, scope = 'term') {
    const since = scope === 'week' ? startOfWeek().getTime() : 0;
    const by = {};
    for (const t of state.transactions) {
      if (t.houseId !== Number(houseId) || t.ts < since) continue;
      const key = t.tag || 'manual';
      by[key] = by[key] || { earned: 0, lost: 0, net: 0, count: 0 };
      if (t.delta >= 0) by[key].earned += t.delta; else by[key].lost += -t.delta;
      by[key].net += t.delta;
      by[key].count += 1;
    }
    return by;
  },

  // ----- award presets + bulk awards (teacher-defined routines) -----

  getAwardPresets() {
    const p = state.settings.awardPresets;
    return Array.isArray(p) ? p : defaultAwardPresets();
  },

  saveAwardPreset(preset) {
    if (!preset?.label || !Number.isFinite(Number(preset.points))) return null;
    const list = store.getAwardPresets().slice();
    const p = { id: preset.id || `ap-${Date.now()}`, label: preset.label, points: Math.round(Number(preset.points)), tag: preset.tag || 'manual' };
    const i = list.findIndex((x) => x.id === p.id);
    if (i >= 0) list[i] = p; else list.push(p);
    state.settings.awardPresets = list;
    emit();
    return p;
  },

  deleteAwardPreset(id) {
    state.settings.awardPresets = store.getAwardPresets().filter((p) => p.id !== id);
    emit();
  },

  // Same award to every house at once — what actually happens when the whole
  // class earns something.
  awardAll(delta, { reason = 'All houses', tag = 'manual' } = {}) {
    const made = [];
    for (const id of Object.keys(HOUSES)) {
      const tx = store.addPoints(Number(id), delta, { reason, tag });
      if (tx) made.push(tx);
    }
    return made;
  },

  purchase(houseId, cost, itemName) {
    if (store.getTotal(houseId, 'term') < cost) return false;
    store.addPoints(houseId, -cost, { reason: `Bought: ${itemName}`, tag: 'shop' });
    return true;
  },

  activateShield(houseId, hours = 24) {
    state.shields[houseId] = Date.now() + Math.max(1, Number(hours) || 24) * 60 * 60 * 1000;
    emit();
  },

  // ----- Magic Shop catalog (teacher-editable in Admin) -----

  getShopItems() {
    return state.shop.catalog;
  },

  // Kinds the combat engine actually implements. Anything else is rejected so
  // the Admin form can never save an item the app won't honour.
  SHOP_KINDS: ['attack', 'steal', 'shield', 'pierce', 'reduce', 'wild'],

  saveShopItem(item) {
    const kind = item?.effect?.kind;
    if (!item?.name || !store.SHOP_KINDS.includes(kind)) return null;
    const mythicOnly = !!item.mythicOnly;
    // Mythic relics are granted by a natural 20, never bought — force cost 0.
    // Everything else needs a real price.
    const cost = mythicOnly ? 0 : Math.round(Number(item.cost) || 0);
    if (!mythicOnly && !(cost > 0)) return null;
    const it = {
      id: item.id || `si-${Date.now()}`,
      name: item.name, desc: item.desc || '', emoji: item.emoji || '✨', image: item.image || '',
      cost, mythicOnly,
      effect: { kind, amount: Math.max(1, Math.round(Number(item.effect.amount) || 1)) },
    };
    const i = state.shop.catalog.findIndex((x) => x.id === it.id);
    if (i >= 0) state.shop.catalog[i] = it; else state.shop.catalog.push(it);
    emit();
    return it;
  },

  deleteShopItem(id) {
    state.shop.catalog = state.shop.catalog.filter((x) => x.id !== id);
    emit();
  },

  isShielded(houseId) {
    return (state.shields[houseId] || 0) > Date.now();
  },

  // Remaining shield time in ms (0 when not shielded) — for consistent
  // "3h 12m left" display wherever the badge appears.
  shieldRemainingMs(houseId) {
    return Math.max(0, (state.shields[houseId] || 0) - Date.now());
  },

  clearShield(houseId) {
    if (!state.shields[houseId]) return false;
    delete state.shields[houseId];
    emit();
    return true;
  },

  // ----- damage reduction (Mythic rewards: Spy Network, Lookout Tower…) -----

  activateReduction(houseId, hours = 48) {
    state.defenses[houseId] = { ...(state.defenses[houseId] || {}), reduce: Date.now() + Math.max(1, Number(hours) || 48) * 3600000 };
    emit();
  },

  hasReduction(houseId) {
    return (state.defenses[houseId]?.reduce || 0) > Date.now();
  },

  reductionRemainingMs(houseId) {
    return Math.max(0, (state.defenses[houseId]?.reduce || 0) - Date.now());
  },

  clearReduction(houseId) {
    if (!state.defenses[houseId]?.reduce) return false;
    delete state.defenses[houseId];
    emit();
    return true;
  },

  // ----- THE combat rule: every attack in the app resolves here -----
  // Order: a full shield blocks outright; otherwise a reduction halves the hit;
  // a `pierce` attack ignores both. Returns what happened so the UI can play
  // the right effect. Positive scoring never routes through here.
  applyAttack({ fromId = null, toId, amount, pierce = false, label = 'Attack' }) {
    const dmg = Math.max(0, Math.round(Number(amount) || 0));
    if (!HOUSES[toId] || !dmg) return { outcome: 'none', applied: 0 };
    const shielded = store.isShielded(toId);
    const reduced = store.hasReduction(toId);

    if (shielded && !pierce) {
      return { outcome: 'blocked', applied: 0, shielded, reduced };
    }
    const applied = (reduced && !pierce) ? Math.max(1, Math.round(dmg / 2)) : dmg;
    const fromName = fromId && HOUSES[fromId] ? ` from ${HOUSES[fromId].name}` : '';
    store.addPoints(toId, -applied, { reason: `${label}${fromName}`, tag: 'attack' });
    return {
      outcome: pierce && (shielded || reduced) ? 'pierced' : (reduced ? 'reduced' : 'full'),
      applied, shielded, reduced, blocked: dmg - applied,
    };
  },

  // Mythic Triumph (natural 20) grants a defensive relic rather than points alone.
  getMythicRewards() {
    return state.shop.catalog.filter((i) => i.mythicOnly);
  },

  grantMythicItem(houseId, itemId) {
    const item = state.shop.catalog.find((i) => i.id === itemId && i.mythicOnly);
    if (!item || !HOUSES[houseId]) return null;
    if (item.effect.kind === 'reduce') store.activateReduction(houseId, item.effect.amount);
    else if (item.effect.kind === 'shield') store.activateShield(houseId, item.effect.amount);
    return item;
  },

  // ----- ambient music (quiet per-screen loops) -----

  getAmbient() {
    const a = state.settings.ambient || {};
    return {
      enabled: a.enabled !== false,
      volume: Number.isFinite(Number(a.volume)) ? Number(a.volume) : 0.25,
      tracks: (a.tracks && typeof a.tracks === 'object') ? a.tracks : { ...(CONFIG.AMBIENT_TRACKS || {}) },
    };
  },

  updateAmbient(patch = {}) {
    const cur = store.getAmbient();
    state.settings.ambient = {
      enabled: patch.enabled != null ? !!patch.enabled : cur.enabled,
      volume: patch.volume != null ? Math.min(1, Math.max(0, Number(patch.volume))) : cur.volume,
      tracks: patch.tracks != null ? patch.tracks : cur.tracks,
    };
    emit();
    return store.getAmbient();
  },

  setAmbientTrack(moduleId, src) {
    const cur = store.getAmbient();
    const tracks = { ...cur.tracks };
    if (src) tracks[moduleId] = src; else delete tracks[moduleId];
    return store.updateAmbient({ tracks });
  },

  // ----- houses (teacher-editable: names, mottos, colours, artwork) -----

  updateHouse(id, patch = {}) {
    if (!HOUSES[id] || !patch) return null;
    const clean = {};
    for (const key of ['name', 'motto', 'accent', 'image', 'heroImage']) {
      if (typeof patch[key] === 'string' && patch[key].trim()) clean[key] = patch[key].trim();
    }
    if (clean.accent) {
      // keep the soft glow colour in step with the accent
      const m = /^#?([a-f\d]{2})([a-f\d]{2})([a-f\d]{2})$/i.exec(clean.accent);
      if (m) clean.accentSoft = `rgba(${parseInt(m[1],16)},${parseInt(m[2],16)},${parseInt(m[3],16)},0.35)`;
    }
    state.settings.houses = { ...(state.settings.houses || {}), [id]: { ...(state.settings.houses?.[id] || {}), ...clean } };
    applyHouseOverrides(state.settings.houses);
    emit();
    return HOUSES[id];
  },

  resetHouse(id) {
    if (!state.settings.houses?.[id]) return false;
    delete state.settings.houses[id];
    // rebuild from the pristine defaults, then re-apply any remaining overrides
    const def = defaultHouses()[id];
    if (def) Object.assign(HOUSES[id], def);
    applyHouseOverrides(state.settings.houses);
    emit();
    return true;
  },

  // ----- transaction correction (the only way to undo a mis-award) -----

  removeTransaction(id) {
    const i = state.transactions.findIndex((t) => t.id === id);
    if (i < 0) return false;
    state.transactions.splice(i, 1);
    emit();
    return true;
  },

  // ----- intro video presets (teacher-editable) -----

  saveIntroVideo({ id, label, url }) {
    if (!label || !url) return null;
    const list = state.settings.introVideos || [];
    const entry = { id: id || label.toLowerCase().replace(/[^a-z0-9]+/g, '-'), label, url };
    const i = list.findIndex((v) => v.id === entry.id);
    if (i >= 0) list[i] = entry; else list.push(entry);
    state.settings.introVideos = list;
    emit();
    return entry;
  },

  deleteIntroVideo(id) {
    state.settings.introVideos = (state.settings.introVideos || []).filter((v) => v.id !== id);
    emit();
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

  // ----- quests (one active per core; teacher confirms completion) -----

  getQuestCatalog() {
    return state.quests.catalog;
  },

  saveQuest(quest) {
    if (!quest?.title || !(Number(quest.points) > 0)) return null;
    const points = Math.round(Number(quest.points));
    const q = {
      id: quest.id || `q-${Date.now()}`,
      title: quest.title,
      desc: quest.desc || '',
      points,
      // repeatable: any house may take it again after someone finishes it
      // (e.g. "attend a school event"). One-shots leave the board for good.
      repeatable: !!quest.repeatable,
      // Kind of task, which picks the icon on the card. This object is REBUILT
      // field by field, so anything not named here is dropped on save — the
      // type has to be listed or the teacher's choice silently reverts.
      type: QUEST_TYPES[quest.type] ? quest.type : DEFAULT_QUEST_TYPE,
      // Deducted when a house gives up on a quest it accepted. Defaults to
      // half the reward — failing should sting without erasing a week's work.
      penalty: Number.isFinite(Number(quest.penalty)) ? Math.max(0, Math.round(Number(quest.penalty))) : Math.round(points / 2),
    };
    const i = state.quests.catalog.findIndex((x) => x.id === q.id);
    if (i >= 0) state.quests.catalog[i] = q; else state.quests.catalog.push(q);
    emit();
    return q;
  },

  // Quests a house can accept right now: not already taken by someone, and —
  // unless the quest repeats — not already finished by any house.
  getAvailableQuests() {
    const takenIds = Object.values(state.quests.active).map((a) => a.questId);
    const doneIds = state.quests.completed.map((c) => c.questId);
    return state.quests.catalog.filter((q) =>
      !takenIds.includes(q.id) && (q.repeatable || !doneIds.includes(q.id)));
  },

  isQuestTaken(questId) {
    return Object.values(state.quests.active).some((a) => a.questId === questId);
  },

  // Which house holds this quest right now (null if nobody).
  questHolder(questId) {
    const entry = Object.entries(state.quests.active).find(([, a]) => a.questId === questId);
    return entry ? Number(entry[0]) : null;
  },

  deleteQuest(id) {
    state.quests.catalog = state.quests.catalog.filter((q) => q.id !== id);
    // A deleted quest cannot stay active anywhere.
    for (const core of Object.keys(state.quests.active)) {
      if (state.quests.active[core]?.questId === id) delete state.quests.active[core];
    }
    emit();
  },

  getActiveQuest(core = state.activeCore) {
    const a = state.quests.active[core];
    if (!a) return null;
    const quest = state.quests.catalog.find((q) => q.id === a.questId);
    return quest ? { ...quest, startedTs: a.startedTs } : null;
  },

  startQuest(core, questId) {
    if (core === 'all' || state.quests.active[core]) return false;
    // Only quests that are actually on the board can be accepted.
    if (!store.getAvailableQuests().some((q) => q.id === questId)) return false;
    state.quests.active[core] = { questId, startedTs: Date.now() };
    emit();
    return true;
  },

  // Teacher marks a house as having given up: the penalty is deducted and the
  // quest returns to the board for another house to steal.
  failQuest(core) {
    const quest = store.getActiveQuest(core);
    if (!quest) return null;
    delete state.quests.active[core];
    const penalty = Number.isFinite(quest.penalty) ? quest.penalty : Math.round(quest.points / 2);
    if (penalty > 0) store.addPoints(core, -penalty, { reason: `Quest abandoned: ${quest.title}`, tag: 'quest' });
    else emit();
    return { quest, penalty };
  },

  // Quietly return a quest to the board with no penalty (teacher correction,
  // e.g. it was accepted by mistake).
  abandonQuest(core) {
    if (!state.quests.active[core]) return false;
    delete state.quests.active[core];
    emit();
    return true;
  },

  // Teacher check-off: awards the points and archives the completion.
  completeQuest(core) {
    const quest = store.getActiveQuest(core);
    if (!quest) return null;
    delete state.quests.active[core];
    state.quests.completed.push({ id: `qc-${Date.now()}`, questId: quest.id, title: quest.title, core: Number(core), ts: Date.now(), points: quest.points });
    store.addPoints(core, quest.points, { reason: `Quest complete: ${quest.title}`, tag: 'quest' });
    return quest;
  },

  getCompletedQuests({ core = null, limit = 20 } = {}) {
    let list = state.quests.completed;
    if (core != null) list = list.filter((c) => c.core === Number(core));
    return list.slice(-limit).reverse();
  },

  // ----- Place of the Week profiles (teacher admin) -----

  // Intro-video presets the teacher chooses from (Admin dropdown).
  getPotwVideoOptions() {
    const list = state.settings?.introVideos;
    return Array.isArray(list) && list.length ? list : (CONFIG.POTW_INTRO_VIDEOS || []);
  },

  // Which destination launches today? A profile scheduled for the week that
  // contains `date` wins; otherwise the manually-set active one.
  resolvePotwKey(date = todayStr()) {
    const scheduled = Object.entries(state.potw.profiles)
      .filter(([, p]) => p.weekOf)
      .map(([key, p]) => ({ key, start: p.weekOf, end: addDays(p.weekOf, 6) }))
      .filter((x) => x.start <= date && date <= x.end)
      .sort((a, b) => b.start.localeCompare(a.start));
    return scheduled.length ? scheduled[0].key : state.potw.active;
  },

  // Profile for launch — video URL resolved from the chosen preset so the
  // POTW module never has to know about presets.
  getPotwProfile() {
    const key = store.resolvePotwKey();
    const p = state.potw.profiles[key];
    if (!p) return p;
    return { ...p, videoUrl: store.getPotwVideoUrl(p) };
  },

  getPotwVideoUrl(profile) {
    if (profile?.videoUrl) return profile.videoUrl;           // custom/legacy URL wins
    const opts = store.getPotwVideoOptions();
    const pick = opts.find((v) => v.id === (profile?.introVideoId || CONFIG.POTW_DEFAULT_VIDEO_ID));
    return pick ? pick.url : '';
  },

  // ----- POTW quiz bounty ledger (prevents double-paying on relaunch) -----

  bountyKey(profileKey, index) {
    const p = state.potw.profiles[profileKey];
    return `${profileKey}|${p?.weekOf || 'nodate'}|${index}`;
  },

  isBountyPaid(profileKey, index) {
    return !!state.potwBounties[store.bountyKey(profileKey, index)];
  },

  getPaidBounty(profileKey, index) {
    return state.potwBounties[store.bountyKey(profileKey, index)] || null;
  },

  payBounty(profileKey, index, houseId, points, label = '') {
    if (store.isBountyPaid(profileKey, index)) return false;
    const tx = store.addPoints(houseId, points, { reason: `POTW Bounty: ${label}`.slice(0, 80), tag: 'potw' });
    if (!tx) return false;
    state.potwBounties[store.bountyKey(profileKey, index)] = { houseId: Number(houseId), ts: Date.now(), points };
    emit();
    return true;
  },

  getPotwProfiles() {
    return state.potw.profiles;
  },

  getActivePotwKey() {
    return store.resolvePotwKey();
  },

  // The manual selection, ignoring scheduling (for Admin UI state).
  getManualPotwKey() {
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
    if (key === state.potw.active || !state.potw.profiles[key]) return false; // can't delete the manual fallback
    delete state.potw.profiles[key];
    emit();
    return true;
  },

  resetAll() {
    state = defaultState();
    emit();
  },
};
