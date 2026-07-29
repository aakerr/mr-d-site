// State store — single source of truth, localStorage-persisted.
// All point changes flow through addPoints() so every change is a logged transaction.
import { CONFIG } from '../config.js';
import { ymd, todayStr } from './util.js';

// Every shipped points value in this file is written as `base × SCALE`, so a
// rebalance is one line in js/config.js instead of forty here — and so a new
// item cannot land on a different scale from the ones beside it, which is how
// the hit-points weapons ended up able to one-shot every house. The canon (1
// old point = 100 shipped, a good deed ≈ 500-1,000, an item ≈ 3,000-6,000) and
// the list of values still sitting at the OLD scale are both on CONFIG.ECONOMY.
const SCALE = CONFIG.ECONOMY.SCALE;

// image = shield crest (used everywhere a house image appears);
// heroImage = wide banner art for hero headers.
const HOUSES = {
  1: { id: 1, core: 1, name: 'Camelot',   motto: 'Honor Above All',      color: 'red',   accent: '#ef4444', accentSoft: 'rgba(239,68,68,0.35)',  image: 'images/camelot-shield.png',   heroImage: 'images/header-camelot-v2.jpg' },
  2: { id: 2, core: 2, name: 'Atlantis',  motto: 'Depths of Wisdom',     color: 'blue',  accent: '#3b82f6', accentSoft: 'rgba(59,130,246,0.35)', image: 'images/atlantis-shield.png',  heroImage: 'images/header-atlantis-v2.jpg' },
  3: { id: 3, core: 3, name: 'Valhalla',  motto: 'Glory Everlasting',    color: 'gold',  accent: '#f59e0b', accentSoft: 'rgba(245,158,11,0.35)', image: 'images/valhalla-shield.png',  heroImage: 'images/header-valhalla-v2.jpg' },
  4: { id: 4, core: 4, name: 'Rivendell', motto: 'Wisdom of the Ages',   color: 'green', accent: '#22c55e', accentSoft: 'rgba(34,197,94,0.35)',  image: 'images/rivendell-shield.png', heroImage: 'images/header-rivendell-v2.jpg' },
};

// Pristine copies of the shipped house definitions, so a teacher edit can
// always be reverted even after HOUSES has been mutated in place.
const HOUSE_DEFAULTS = JSON.parse(JSON.stringify(HOUSES));
function defaultHouses() { return JSON.parse(JSON.stringify(HOUSE_DEFAULTS)); }

// The teacher's most-used awards, one tap each. Editable in Admin.
function defaultAwardPresets() {
  return [
    { id: 'ap-bell',     label: 'Bell Ringer done',  points: 50,   tag: 'manual' },
    { id: 'ap-homework', label: 'Homework Hero',     points: 100,  tag: 'manual' },
    { id: 'ap-teamwork', label: 'Great teamwork',    points: 50,   tag: 'manual' },
    { id: 'ap-quiz',     label: 'Map Quiz Champion', points: 500,  tag: 'manual' },
    { id: 'ap-penalty',  label: 'Penalty',           points: -50,  tag: 'manual' },
  ];
}

// Die of Destiny (d20) outcome table. `id` is the stable key a teacher edit is
// keyed to (see saveDiceOutcome) — it never changes even if wording does.
// `min`/`max`/`hasButton`/`mythic` are NOT teacher-editable: every one of the
// 20 faces on the die must map to exactly one outcome with no gaps or overlaps,
// or a roll could come up with nothing to show the class. Opening those up
// risked breaking that guarantee for very little benefit, so only the points,
// title, description and emoji can be changed — see saveDiceOutcome below.
function defaultDiceProphecy() {
  return [
    { id: 'catastrophe', min: 1,  max: 1,  emoji: '💀', title: 'CATASTROPHE',    desc: 'House loses 100 points',                       points: -100, hasButton: true },
    { id: 'misfortune',  min: 2,  max: 5,  emoji: '🌧️', title: 'Misfortune',     desc: 'Teacher picks the next challenger',            points: 0,   hasButton: false },
    { id: 'neutral',     min: 6,  max: 9,  emoji: '😐', title: 'Fate is Neutral', desc: 'Nothing happens',                              points: 0,   hasButton: false },
    // "Move your token" was left over from a physical board version — there is
    // no token in this app, and this string is what the outcome plaque shows a
    // whole class during a live roll. "class points" was the odd one out too:
    // every other row, and the rest of the app, says house points.
    { id: 'smallfavor',  min: 10, max: 14, emoji: '✨', title: 'Small Favor',     desc: '+20 house points',                             points: 20,  hasButton: true },
    { id: 'fortune',     min: 15, max: 19, emoji: '🔥', title: 'Fortune Smiles',  desc: '+50 house points',                             points: 50,  hasButton: true },
    // NO RELIC IN THE PROMISE. Relics only exist in the hit-points catalog —
    // defaultDuelCatalog() has none — and Mr. D's rules ship as the default. So
    // on every shipped install a natural 20 promised a Mythic Relic, the relic
    // chooser found an empty list, skipped itself, and the class watched a
    // 1-in-20 roll deliver nothing but the points with no explanation. The
    // relic is offered by the chooser when relics actually exist; the text no
    // longer commits the app to something it may not be able to do.
    { id: 'mythic',      min: 20, max: 20, emoji: '👑', title: 'MYTHIC TRIUMPH',  desc: 'The highest roll there is — +200 points to your house!', points: 200, hasButton: true, mythic: true },
  ];
}

// Quest kinds. The icon rides on the card so a class can tell at a glance what
// sort of task it is — which is what the repeated crossed-swords could never do.
// 'service' is the fallback for anything untyped (a quest the teacher wrote
// before this existed, or one restored from an older backup).
// `art` is the owner-painted PNG for the kind — shown on a quest's card
// UNLESS that quest carries its own custom `icon` (see questIcon() below,
// which still decides on emoji terms; the art is just what renders it).
const QUEST_TYPES = {
  service:   { id: 'service',   icon: '🤝', art: 'images/quest-service.png',   label: 'Service',   blurb: 'Helping the school run' },
  academic:  { id: 'academic',  icon: '📚', art: 'images/quest-academic.png',  label: 'Academic',  blurb: 'Learning and schoolwork' },
  community: { id: 'community', icon: '❤️', art: 'images/quest-community.png', label: 'Community', blurb: 'Giving and kindness' },
  habit:     { id: 'habit',     icon: '⭐', art: 'images/quest-habit.png',     label: 'Habit',     blurb: 'Daily and weekly conduct' },
};
const DEFAULT_QUEST_TYPE = 'service';

// Screens whose accent colour the teacher can set. Only these three read
// var(--accent); the Magic Shop, Battle Day, Dice, Council and POTW have their
// palettes baked in, so listing them here would show a control that does
// nothing. `matchHouse` follows the active house instead of using `color`.
//
// Quests ships with its own colour precisely BECAUSE the house accents cover
// red/blue/amber/green — a quest board that borrows them looks like a different
// app every period. Bronze reads as parchment and collides with none of them.
const MODULE_THEMES = {
  dashboard: { label: 'Home screen', color: '#f59e0b', matchHouse: true },
  quests:    { label: 'Quests',      color: '#b45309', matchHouse: false },
  houses:    { label: 'Records',     color: '#f59e0b', matchHouse: true },
};

// Screens that can be shown either as a scrolling grid or as a horizontal
// carousel. The carousel exists because a smartboard is a poor place to scroll
// vertically — the teacher is standing at the board, not holding a mouse.
// Grid stays the default: choosing from ~20 quests is a scanning task, and a
// grid shows eight at once where a carousel shows one clearly.
// Sound effects the teacher can replace with their own recording. Drop files in
// /sfx and assign them in Admin; an unassigned sound keeps the built-in synth
// tone, so the app is never silent because a file is missing.
//
// 'battlecry' has no synth fallback on purpose — it is a voice line, and a
// beep would be worse than nothing. It simply stays quiet until recorded.
// `file` is what ships in /sfx. A teacher can point any slot at their own
// recording, or clear it back to the built-in synth tone. Only `roll` ships
// without a file — the synthesised rattle covers it.
const SFX_SLOTS = {
  battlecry: { label: 'Battle Day war cry',  file: 'sfx/battle_day.mp3',        hint: 'Plays as the Battle Day cinematic slams in — e.g. “It’s Battle Day. Attack!”' },
  sword:     { label: 'Sword clash',         file: 'sfx/swords_clashing.mp3',   hint: 'A strike landing on another house.' },
  thud:      { label: 'Blocked / heavy hit', file: 'sfx/defensive_block-1.mp3', hint: 'A shield holding, or points coming off.' },
  coin:      { label: 'Points awarded',      file: 'sfx/points_awarded.mp3',    hint: 'The reward chime when a house scores. This one fires often.' },
  fanfare:   { label: 'Fanfare',             file: 'sfx/mythical_relic.mp3',    hint: 'Mythic relic claimed on a natural 20.' },
  roll:      { label: 'Dice rattle',         file: '',                          hint: 'The Die of Destiny tumbling. Uses the built-in rattle.' },
  // Its own slot on purpose. The dice landing used to share "thud" with combat,
  // so the moment a teacher recorded a shield-block for Battle Day, the Die of
  // Destiny started landing with a sword hitting a shield — far too heavy, and
  // out of time with the tumble. One recording, two unrelated moments.
  diceland:  { label: 'Dice landing',        file: '',                          hint: 'The Die of Destiny settling after its roll. Uses the built-in tap — keep it short, it lands right after the rattle.' },
  reveal:    { label: 'Result revealed',     file: '',                          hint: 'The chime as the dice total appears beneath the crystal ball. Uses the built-in bell.' },
  // Trivia Tuesday's five beats, in stage order. All ship with the owner's
  // recordings; the teacher can swap any of them like every other slot.
  triviacard:     { label: 'Trivia — card arrives',   file: 'sfx/trivia-card-reveal.mp3',     hint: 'The Trivia Tuesday card sweeping onto the temple stage.' },
  triviaquestion: { label: 'Trivia — question shows', file: 'sfx/trivia-question-reveal.mp3', hint: 'The question appearing on the parchment.' },
  triviaanswer:   { label: 'Trivia — answer reveal',  file: 'sfx/trivia-answer-reveal.mp3',   hint: 'The hieroglyphs giving up the answer.' },
  triviawin:      { label: 'Trivia — correct',        file: 'sfx/trivia-correct-answer.mp3',  hint: 'The class got it — the points chime follows.' },
  trivialose:     { label: 'Trivia — incorrect',      file: 'sfx/trivia-wrong-answer.mp3',    hint: 'Not this week. No points move.' },
  timerend:       { label: 'Timer ends',              file: 'sfx/timer-end.mp3',              hint: "The bell-ringer countdown hitting TIME! It used to borrow the points chime, which made every timer sound like an award." },
};

// Offensive items are STOCKPILED: buying one puts it in the house's armoury
// rather than firing it on the spot, so a house can buy on Friday and strike
// next week. Shields and reductions are deliberately NOT stockpiled — they are
// timed protection that starts the moment it is bought — and wildcards resolve
// on purchase because the gamble IS the purchase.
// ---- combat modes -----------------------------------------------------------
// TWO complete rule sets, switchable in Admin and never merged.
//
//   'duel' — Mr. D's own game, and the default. One attack and one defense item
//            per house per week, chosen in secret and revealed together. Every
//            attack has a specific counter; if the defender picked it, the
//            attack does nothing at all. Damage is rolled on real dice
//            (2d6 x100 and so on) and comes straight off the target's points.
//
//   'hp'   — the hit-points model built earlier: strikes remove HP rather than
//            points, at zero HP the winner takes a prize and the loser keeps
//            everything. Kept whole rather than deleted, because it solves a
//            real problem his rules do not: it cannot widen the gap between
//            houses, and a class can never be knocked down for being ahead.
//
// Each mode owns its own shop catalog (see shop.byMode), so switching swaps the
// items as well as the rules, and switching back finds the teacher's edits to
// THAT mode intact.
const COMBAT_MODES = {
  duel: { label: "Mr. D's rules", blurb: 'One attack and one defense a week, revealed together. The right defense cancels the attack outright. Damage is rolled on dice and comes off the target’s points.' },
  hp:   { label: 'Hit points',    blurb: 'Houses have hit points that refill each Battle Day. Strikes remove HP, never points; the winner takes a prize and the loser keeps every point they earned.' },
};
const DEFAULT_COMBAT_MODE = 'duel';

// Points per step of bonus HP (see getMaxHp). 50,000 because the whole economy
// was rescaled x100 to meet Mr. D's costs — the old 500 was the same fraction
// of the old scale.
const HP_POINTS_PER_STEP = 500 * SCALE;

// Mr. D's items, transcribed from his own document. `counters` is the whole
// game: an attack landing on a house holding the listed defense does NOTHING.
// Damage is expressed as dice because he rolls it live on the board.
//
// THREE PRICES DIFFER FROM HIS DOCUMENT, and the reason is in the simulation:
// what matters in a league table is the GAP an attack opens, not whether the
// attacker ends up richer. Spending 600 to remove 700 from a rival moves the gap
// 100 your way even though you are poorer. On that measure the Catapult (+1100),
// the Net (+450) and the Cloak (+125) already earn their keep, but three items
// cost more than they move:
//   Sword of Destiny  600 -> 450   (was -75 a week)
//   Staff of Ra      1000 -> 700   (was -212)
//   Warhorse         1000 -> 700   (was -212)
// His originals are in the comments beside each, and every price is editable in
// Admin, so putting them back is a two-second job if he prefers his own.
// Every item ships with hand-drawn art under images/shop/ — static repo files,
// like the house shields, so a fresh install has them with no uploads and no
// IndexedDB involved. A teacher can still replace any of them from Admin's
// shop editor (an upload writes a 'media:…' key over the path, and wins).
function defaultDuelCatalog() {
  return [
    // ---- attacks ----
    { id: 'sword',      name: 'The Sword of Destiny',     emoji: '🗡️', image: 'images/shop/sword-of-destiny.png', cost: 4.5 * SCALE,  slot: 'attack',   // his doc: 6 × SCALE
      effect: { kind: 'damage', dice: '2d6', mult: SCALE }, counteredBy: ['shield'],
      desc: 'Strike another House for 2d6 × 100 points. The Shield of Protection stops it dead.' },
    { id: 'net',        name: 'Net of Entrapment',        emoji: '🕸️', image: 'images/shop/net-of-entrapment.png', cost: 6 * SCALE,  slot: 'attack',
      effect: { kind: 'steal', dice: '2d6', mult: SCALE }, counteredBy: ['gauntlet'],
      desc: 'Steal 2d6 × 100 points and add them to your own total. The Gauntlet of Defense stops it.' },
    { id: 'iceaxe',     name: 'The Legendary Ice Axe',    emoji: '🪓', image: 'images/shop/legendary-ice-axe.png', cost: 5 * SCALE,  slot: 'attack',
      effect: { kind: 'freeze', dice: '1d6' }, counteredBy: ['shield'],
      desc: 'Freeze a House so it cannot earn points for 1d6 days. The Shield of Protection stops it.' },
    { id: 'cloak',      name: 'Cloak of Invisibility',    emoji: '🫥', image: 'images/shop/cloak-of-invisibility.png', cost: 4 * SCALE,  slot: 'attack',
      effect: { kind: 'steal', dice: '1d6', mult: SCALE, anonymous: true }, counteredBy: ['bow'],
      desc: 'Steal 1d6 × 100 points without anyone learning who did it. The Bow of Seeking finds you.' },
    { id: 'catapult',   name: 'The Catapult',             emoji: '🪨', image: 'images/shop/catapult.png', cost: 10 * SCALE, slot: 'attack',
      effect: { kind: 'damage', dice: '3d6', mult: SCALE, targets: 2 }, counteredBy: [],
      desc: 'Hit TWO Houses for 3d6 × 100 points each. Nothing defends against it.' },
    { id: 'staffra',    name: 'The Staff of Ra',          emoji: '☀️', image: 'images/shop/staff-of-ra.png', cost: 7 * SCALE, slot: 'attack',   // his doc: 10 × SCALE
      effect: { kind: 'damage', dice: '3d6', mult: SCALE }, counteredBy: ['eye'],
      desc: 'A blast of concentrated sunlight for 3d6 × 100 points. The Eye of Horus stops it.' },
    { id: 'warhorse',   name: 'Warhorse',                 emoji: '🐎', image: 'images/shop/warhorse.png', cost: 7 * SCALE, slot: 'attack',   // his doc: 10 × SCALE
      effect: { kind: 'damage', dice: '3d6', mult: SCALE }, counteredBy: ['bow'],
      desc: 'A charging warhorse for 3d6 × 100 points. The Bow of Seeking brings it down.' },

    // ---- defenses ----
    { id: 'shield',     name: 'The Shield of Protection', emoji: '🛡️', image: 'images/shop/shield-of-protection.png', cost: 5 * SCALE,  slot: 'defense',
      effect: { kind: 'block' }, blocks: ['sword', 'iceaxe'],
      desc: 'Stops the Sword of Destiny or the Legendary Ice Axe for one Battle Day.' },
    { id: 'gauntlet',   name: 'Gauntlet of Defense',      emoji: '🧤', image: 'images/shop/gauntlet-of-defense.png', cost: 4 * SCALE,  slot: 'defense',
      effect: { kind: 'block' }, blocks: ['net'],
      desc: 'Stops every attack from the Net of Entrapment.' },
    { id: 'bow',        name: 'Bow of Seeking',           emoji: '🏹', image: 'images/shop/bow-of-seeking.png', cost: 4 * SCALE,  slot: 'defense',
      effect: { kind: 'block' }, blocks: ['cloak', 'warhorse'],
      desc: 'Seeks out the Cloak of Invisibility or the Warhorse and stops the attack.' },
    { id: 'eye',        name: 'The Eye of Horus',         emoji: '👁️', image: 'images/shop/eye-of-horus.png', cost: 5 * SCALE,  slot: 'defense',
      effect: { kind: 'block' }, blocks: ['staffra'],
      desc: 'Defends against the Staff of Ra.' },

    // ---- utility ----
    { id: 'stone',      name: 'The Stone of Seeing',      emoji: '🔮', image: 'images/shop/stone-of-seeing.png', cost: 10 * SCALE, slot: 'utility',
      effect: { kind: 'reveal' },
      desc: 'Reveals what another House has chosen to do this week.' },
    { id: 'shroud',     name: 'The Shroud of Secrecy',    emoji: '🌫️', image: 'images/shop/shroud-of-secrecy.png', cost: 5 * SCALE,  slot: 'utility',
      effect: { kind: 'hide' },
      desc: 'Hides your actions from every other House for one week.' },
    { id: 'timeturner', name: 'The Time Turner',          emoji: '⏳', image: 'images/shop/time-turner.png', cost: 10 * SCALE, slot: 'utility',
      effect: { kind: 'timeturn' },
      desc: 'Go back and change your items after you have been attacked.' },
    { id: 'bagofholding', name: 'The Bag of Holding',     emoji: '🎒', image: 'images/shop/bag-of-holding.png', cost: 5 * SCALE,  slot: 'utility',
      effect: { kind: 'extraslot' },
      desc: 'An extra weapon slot — carry two attack or two defense items at once.' },
  ];
}

const STOCKPILE_KINDS = new Set(['attack', 'steal', 'pierce']);

// Hard ceiling on any single points transaction. A guard against a mistyped
// award (a stray zero on a 50 becomes 500,000), not a game rule — no legitimate
// classroom award comes near it. Prize settings are clamped to it too, so the
// app can never promise a prize larger than it is able to pay.
const MAX_DELTA = 9999;

// ---- Battle Day combat ------------------------------------------------------
// Hit points are SEPARATE from house points. Points are the currency (and the
// scoreboard); HP is what a strike removes. A house is beaten when its HP hits
// zero, and the winner takes a prize in points. The LOSER NEVER LOSES POINTS —
// a class should not be punished for being ahead.
//
// Three prize rules, teacher-chosen in Admin, because they play very
// differently. Simulated over a 9-week term with houses earning unequally:
//   gap     — half the points you are behind by. Self-limiting: the prize
//             shrinks to nothing as you catch up. Best-behaved house still won
//             the term and the spread narrowed. This is the default.
//   percent — a share of the defender's total. Compounds hard: prizes grew
//             281 -> 1671 across the term and the WORST-behaved house won.
//             Available because it is what a teacher may expect; not advised.
//   flat    — a fixed amount. Predictable, never compounds, but if it is set
//             below the cost of the weapons nobody will ever attack.
const PRIZE_RULES = {
  gap:     { label: 'Half the gap', blurb: 'Win half the points you are behind by. Shrinks as you catch up.' },
  percent: { label: 'Share of their total', blurb: 'Win a percentage of the defeated house\u2019s points.' },
  flat:    { label: 'Fixed amount', blurb: 'Every win pays the same number of points.' },
};

function defaultCombat() {
  return {
    prizeRule: 'gap',
    gapShare: 50,       // % of the gap, for 'gap'
    prizePercent: 25,   // % of their total, for 'percent'
    prizeFlat: 150,     // points, for 'flat'
    punchingDown: false,// HP mode: may a house attack one with FEWER points?
    // Mr. D's rules keep their own answer, and his is YES. His game has four
    // houses played by every period; blocking the leader would take the class
    // in front most often out of Battle Day altogether.
    duelPunchDown: true,
    hpBase: 100,        // everyone starts here
    hpPer500: 10,       // extra HP per 500 points held
    // The ± buttons on Battle Day's teacher-scoring row. This was hardcoded to
    // 10 in battle.js, which made it the one point value on the whole screen
    // he could not change without editing source.
    teacherScore: 100,
  };
}



const LAYOUT_SCREENS = {
  quests: { label: 'Quests board' },
  shop:   { label: 'Magic Shop' },
};
const DEFAULT_LAYOUT = 'grid';

// Place of the Week's flight music rides in the ambient `tracks` map under this
// pseudo-screen key, so the teacher picks it in Admin → Background music next
// to every other piece of music in the app. It is deliberately NOT a screen:
// js/core/ambient.js only ever looks a track up by module id, and no module is
// called 'flyover', so nothing plays it as a background loop by accident.
const FLYOVER_TRACK_KEY = 'flyover';


function defaultQuestCatalog() {
  // Starter catalog — points scale with effort and benefit to class/school.
  return [
    { id: 'q-school-event', icon: '🎪',   points: 20, title: 'School Event Squad',       desc: 'Attend a school event together. Proof: photos showing at least half the class there.', type: 'service', repeatable: true },
    { id: 'q-library', icon: '📖',        points: 15, title: 'Library Legends',          desc: 'Every student checks out a library book and logs one thing they learned.', type: 'service', repeatable: true },
    { id: 'q-cleanup', icon: '🧹',        points: 30, title: 'Campus Cleanup Crew',      desc: 'Clean a shared school space during recess or lunch. Proof: before & after photos.', type: 'service', repeatable: true },
    { id: 'q-kindness', icon: '💌',       points: 25, title: 'Kindness Campaign',        desc: 'Deliver 25 hand-written kind notes to students or staff around the building.', type: 'community', repeatable: true },
    { id: 'q-tutors', icon: '👥',         points: 35, title: 'Tutor Titans',             desc: 'Five classmates tutor younger students for one week, with a teacher’s permission.', type: 'academic', repeatable: true },
    { id: 'q-attendance', icon: '📅',     points: 30, title: 'Perfect Attendance Week',  desc: 'Every student present, every day, for one full week.', type: 'habit', repeatable: true },
    { id: 'q-homework', icon: '✏️',       points: 25, title: 'Homework Hundred',         desc: '100% homework turn-in from the whole class for a full week.', type: 'academic', repeatable: true },
    { id: 'q-food-drive', icon: '🥫',     points: 40, title: 'Food Drive Forces',        desc: 'Bring in 50+ items for the school food drive.', type: 'community' },
    { id: 'q-recycling', icon: '♻️',      points: 20, title: 'Recycling Rangers',        desc: 'Collect and sort recycling from all 7th-grade rooms for one week.', type: 'service', repeatable: true },
    { id: 'q-thank-you', icon: '🍎',      points: 15, title: 'Teacher Appreciation Op',  desc: 'Write and deliver thank-you cards to five teachers or staff members.', type: 'community', repeatable: true },
    { id: 'q-greeters', icon: '👋',       points: 20, title: 'Morning Ambassadors',      desc: 'Greet students at the front doors for three mornings with school-approved signs.', type: 'community', repeatable: true },
    { id: 'q-spirit', icon: '📣',         points: 25, title: 'Spirit Week Sweep',        desc: 'At least 75% of the class participates in every day of Spirit Week.', type: 'habit' },
    { id: 'q-welcome', icon: '🤗',        points: 15, title: 'New Student Welcome',      desc: 'Build a welcome guide and buddy system for students who join mid-year.', type: 'community' },
    { id: 'q-garden', icon: '🌱',         points: 30, title: 'School Garden Guardians',  desc: 'Plant or maintain the school garden for two weeks. Proof: photo log.', type: 'service' },
    { id: 'q-history-fair', icon: '🏺',   points: 50, title: 'History Fair Heroes',      desc: 'Every student completes and presents a history fair entry.', type: 'academic' },
    { id: 'q-current-events', icon: '🌐', points: 20, title: 'Current Events Council',   desc: 'Deliver five student-led current-events briefings to the class.', type: 'academic', repeatable: true },
    { id: 'q-book-drive', icon: '📚',     points: 35, title: 'Book Drive Battalion',     desc: 'Collect 40 gently used books to donate to the school library.', type: 'community' },
    { id: 'q-transitions', icon: '🤫',    points: 10, title: 'Silent Transition Masters',desc: 'One full week of fast, silent transitions between activities.', type: 'habit', repeatable: true },
    { id: 'q-fundraiser', icon: '💰',     points: 45, title: 'Fundraiser Front Line',    desc: 'Hit the class goal in a school fundraiser (or raise the most of any class).', type: 'community' },
    { id: 'q-museum', icon: '🏛️',         points: 40, title: 'Museum of Us',             desc: 'Build a classroom museum exhibit and host another class for a guided tour.', type: 'academic' },
  ];
}

// The hit-points model's shop, kept intact for the 'hp' combat mode.
function defaultHpCatalog() {
  return [
    // ---- Offensive ----
    // Descriptions are clamped to THREE lines on the shop card (~120 chars
    // at the card's width). Longer text is silently cut off mid-sentence,
    // which is worse than saying less — the shield/halving rules live in
    // Help and in Admin's matchup table, where they are not truncated.
    { id: 'catapult',  name: 'Catapult Volley',        emoji: '🪨', image: '', cost: 35 * SCALE, desc: 'Roman siege engines hurl stones. Waits in your armoury for Battle Day, then takes 20 HP off a house you choose.', effect: { kind: 'attack', amount: 20 * SCALE } },
    { id: 'greekfire', name: 'Greek Fire',             emoji: '🔥', image: '', cost: 45 * SCALE, desc: 'The Byzantine secret that burned on water. Waits in your armoury for Battle Day, then takes 25 HP off a house you pick.', effect: { kind: 'attack', amount: 25 * SCALE } },
    { id: 'elephants', name: "Hannibal's War Elephants", emoji: '🐘', image: '', cost: 55 * SCALE, desc: 'Over the Alps into Roman territory. Waits in your armoury for Battle Day, then takes 30 HP off a house you choose.', effect: { kind: 'attack', amount: 30 * SCALE } },
    { id: 'heatray',   name: "Archimedes' Heat Ray",   emoji: '☀️', image: '', cost: 65 * SCALE, desc: 'Mirrors burn ships at Syracuse. Waits in your armoury for Battle Day, then takes 35 HP off a house you choose.', effect: { kind: 'attack', amount: 35 * SCALE } },
    { id: 'trojan',    name: 'Trojan Horse',           emoji: '🐴', image: '', cost: 50 * SCALE, desc: 'A gift hiding an army. Waits for Battle Day, then takes 25 HP off the leader — you gain points equal to the damage.', effect: { kind: 'steal', amount: 25 * SCALE } },
    // ---- Offensive: pierce (ignores defenses) ----
    { id: 'cloak',     name: 'Invisibility Cloak',     emoji: '🫥', image: '', cost: 60 * SCALE, desc: 'Strike unseen. Waits in your armoury for Battle Day, then takes 20 HP off any house — ignoring shields and halving.', effect: { kind: 'pierce', amount: 20 * SCALE } },
    { id: 'fogbank',   name: 'Fog Bank',               emoji: '🌫️', image: '', cost: 70 * SCALE, desc: 'Advance under cover. Waits for Battle Day, then takes 25 HP off any house — ignoring shields and halving.', effect: { kind: 'pierce', amount: 25 * SCALE } },
    // ---- Defensive ----
    { id: 'phalanx',   name: 'Phalanx Formation',      emoji: '🛡️', image: '', cost: 25 * SCALE, desc: 'Locked shields, bristling spears. Blocks incoming attacks for 12 hours.', effect: { kind: 'shield', amount: 12 } },
    { id: 'aegis',     name: 'Aegis Shield',           emoji: '⚡', image: '', cost: 30 * SCALE, desc: "Athena's shield, feared by gods and men. Blocks incoming attacks for 24 hours.", effect: { kind: 'shield', amount: 24 } },
    { id: 'shieldwall',name: 'Shield Wall',            emoji: '🪵', image: '', cost: 35 * SCALE, desc: 'The Viking skjaldborg — no gap for a blade. Blocks incoming attacks for 24 hours.', effect: { kind: 'shield', amount: 24 } },
    { id: 'moat',      name: 'Moat & Drawbridge',      emoji: '🏰', image: '', cost: 45 * SCALE, desc: 'Raise the bridge and hold the keep. Blocks incoming attacks for 36 hours.', effect: { kind: 'shield', amount: 36 } },
    { id: 'greatwall', name: 'The Great Wall',         emoji: '🧱', image: '', cost: 60 * SCALE, desc: 'Thousands of miles of stone and watchtowers. Blocks incoming attacks for 48 hours.', effect: { kind: 'shield', amount: 48 } },
    // ---- Wildcards ----
    { id: 'pandora',   name: "Pandora's Box",          emoji: '📦', image: '', cost: 40 * SCALE, desc: 'Every evil escapes — but hope remains. Random swing of up to 30 pts, for you or against you.', effect: { kind: 'wild', amount: 30 * SCALE } },
    { id: 'fortuna',   name: "Fortuna's Wheel",        emoji: '🎡', image: '', cost: 30 * SCALE, desc: 'The Roman goddess of luck spins the wheel. Random swing of up to 20 pts, either way.', effect: { kind: 'wild', amount: 20 * SCALE } },
    // ---- Mythic rewards (granted by a natural 20, never purchasable) ----
    { id: 'spynetwork',name: 'Spy Network',            emoji: '🕵️', image: '', cost: 0, mythicOnly: true, desc: 'Your agents hear the plan before it happens. Incoming damage is HALVED for 48 hours.', effect: { kind: 'reduce', amount: 48 } },
    { id: 'lookout',   name: 'Lookout Tower',          emoji: '🗼', image: '', cost: 0, mythicOnly: true, desc: 'See the dust of an army on the horizon. Incoming damage is HALVED for 48 hours.', effect: { kind: 'reduce', amount: 48 } },
    { id: 'oracle',    name: 'Oracle of Delphi',       emoji: '🔮', image: '', cost: 0, mythicOnly: true, desc: 'The Pythia foretells the coming blow. Incoming damage is HALVED for 72 hours.', effect: { kind: 'reduce', amount: 72 } },
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
      // Overall sound-effects level (recordings and built-in beeps alike),
      // 0-1. Applied with a perceptual curve in js/core/audio.js.
      sfxVolume: 0.65,
      // Quiet per-screen background loops (see js/core/ambient.js). Ships ON:
      // tracks:null means "use CONFIG.AMBIENT_TRACKS" — the bundled per-screen
      // map — until the teacher edits a track in Admin, which materialises a
      // real map here. Config stays the single source for what a fresh
      // install sounds like.
      ambient: { enabled: true, volume: 0.5, tracks: null },
      // Teacher PIN (js/core/lock.js). Empty pinHash = off, which is the default:
      // the app must never lock a teacher out of a fresh install. `len` is the
      // digit count so the PIN pad knows when an entry is complete.
      lock: { pinHash: '', len: 4, minutes: 15 },
      // THESE ARE FILLED IN, NOT NULL, AND THAT MATTERS. They used to be null
      // and were seeded by the migration in load() — but that migration only
      // runs when there IS saved state, so a browser opening the app for the
      // FIRST time got the nulls and nothing else. It cost the teacher his
      // sound during a live demo: settings.sfx was null, so every recording in
      // /sfx was unassigned, and the Battle Day war cry has no synth fallback
      // and simply played silence. Anything seeded from a constant belongs
      // here, where a first run and a hundredth run get the same thing.
      moduleThemes: Object.fromEntries(Object.entries(MODULE_THEMES)
        .map(([id, d]) => [id, { color: d.color, matchHouse: d.matchHouse }])),
      layouts: Object.fromEntries(Object.keys(LAYOUT_SCREENS).map((id) => [id, DEFAULT_LAYOUT])),
      combat: defaultCombat(),
      // 'duel' (Mr. D's rules) or 'hp' — see COMBAT_MODES. Changing it swaps the
      // shop catalog too, via store.setCombatMode().
      combatMode: DEFAULT_COMBAT_MODE,
      diceProphecy: defaultDiceProphecy(),
      // Teacher recordings per sound (see SFX_SLOTS). '' = use the built-in.
      sfx: Object.fromEntries(Object.entries(SFX_SLOTS).map(([id, s]) => [id, s.file || ''])),
      awardPresets: defaultAwardPresets(),  // one-tap awards on the Records screen
      // Teacher edits to the four houses (name/motto/accent/artwork). Applied
      // over the built-in defaults at load so nothing is hardcoded for them.
      houses: {},
      introVideos: (CONFIG.POTW_INTRO_VIDEOS || []).map((v) => ({ ...v })),
    },
    // houseId -> { itemId: count }. What each house has bought and not yet used.
    inventory: {},
    // houseId -> epoch ms until which the house cannot earn points (Legendary
    // Ice Axe). An expiry beats a countdown: nothing has to tick, and it is
    // still correct after the laptop has been shut for the weekend.
    frozen: {},
    // houseId -> epoch ms while a Shroud of Secrecy hides their held items from
    // the Stone of Seeing.
    shrouded: {},
    // viewerHouseId -> { targetHouseId: ts } — who has used a Stone of Seeing on
    // whom. Cleared when Battle Day ends.
    revealed: {},
    // houseId -> DAMAGE TAKEN, not current HP. Refilled (cleared) at the start
    // of each Battle Day. Storing "current" looked right until a house won a
    // battle: the prize pushed it over a 500-point boundary, its maximum rose,
    // and its untouched current HP read 120/130 — it appeared wounded for
    // getting richer. Damage taken is invariant to the maximum moving.
    hp: {},
    // Trivia Tuesday — the teacher's own question pool, asked one per week.
    // Wholly teacher-owned content (nothing ships in it), so it persists
    // as-is with no override diffing. Each question carries its own
    // asked-record per core, so all four class periods get one crack at the
    // same question and each core walks the pool at its own pace.
    trivia: {
      // Two starters ship undated ("ask any time"), so the very first tap of
      // the tile fires a real question with no setup — Mr. D can play one
      // immediately, then load his own and delete these in Admin → ❓ Trivia.
      questions: [
        { id: 'tq-sample-nile', q: 'What river was the lifeblood of ancient Egyptian civilization?',
          a: 'The Nile River', points: 100, askOn: '', asked: {} },
        { id: 'tq-sample-cuneiform', q: 'Cuneiform, one of the world\'s first writing systems, was pressed into wet clay by which civilization?',
          a: 'The Sumerians of Mesopotamia', points: 100, askOn: '', asked: {} },
      ],  // { id, q, a, points, askOn, asked: { <coreId>: { won, ts } } }
    },
    quests: {
      // One quest active per core at a time; completion is teacher-confirmed.
      catalog: defaultQuestCatalog(),
      active: {},     // core -> { questId, startedTs }
      completed: [],  // { id, questId, title, core, ts, points }
    },
    shop: {
      // Magic Shop items, teacher-editable in Admin.
      //
      // The three offensive kinds are STOCKPILED (see STOCKPILE_KINDS): buying
      // one pays the cost and banks the weapon in the house's armoury. It is
      // not fired at anyone until the house spends it on Battle Day, where it
      // removes HIT POINTS — never points. Descriptions below must say so;
      // "deduct N pts" was the old model and is a lie to a student reading it.
      //
      // effect.kind:
      //   'attack'  — Battle Day strike: removes `amount` HP from a chosen house
      //   'steal'   — as 'attack', and credits the attacker points equal to the
      //               HP actually dealt (0 if blocked, halved if reduced)
      //   'pierce'  — as 'attack', but ignores shields AND reductions
      //   'shield'  — block incoming attacks for `amount` hours
      //   'reduce'  — halve incoming damage for `amount` hours (Mythic rewards)
      //   'wild'    — random swing of ±amount in POINTS, resolved at purchase
      //               (never stockpiled — the gamble IS the purchase)
      // mythicOnly items can't be bought; a Nat 20 grants them.
      // Both of these are the MERGED, in-memory catalogs — shipped items with
      // the teacher's edits applied. Only the edits are ever written to disk
      // (see toSaved), so a shipped price or description fixed in this file
      // reaches an install that has already saved.
      catalog: defaultDuelCatalog(),
      // The OTHER mode's catalog, parked. Each mode keeps its own items and its
      // own edits, so switching swaps the shop wholesale and switching back
      // finds everything as the teacher left it. `catalog` above is always
      // whichever mode is currently active; this is the one waiting its turn.
      parked: { hp: defaultHpCatalog(), duel: null },
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
          // NEVER hardcode a preset id here. 'rock' and 'classic' were baked in
          // once, then retired from CONFIG.POTW_INTRO_VIDEOS — and because the
          // remap that fixes them lives in load()'s `if (raw)` branch, every
          // FRESH install shipped a profile pointing at a video that no longer
          // existed. Place of the Week silently fell back to its title card and
          // never played anything. Read the id from config instead.
          introVideoId: CONFIG.POTW_DEFAULT_VIDEO_ID,
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
          introVideoId: (CONFIG.POTW_INTRO_VIDEOS[1] || CONFIG.POTW_INTRO_VIDEOS[0] || {}).id
            || CONFIG.POTW_DEFAULT_VIDEO_ID,
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

// House overrides are interpolated into markup at ~30 render sites — accents
// into style="…" and images into src="…" — and auditing every one of those
// sites forever is a losing game. So the values are validated HERE, at the
// choke point every override passes through (updateHouse saves, load(),
// resetHouse, and any backup restore all funnel into applyHouseOverrides).
// A value that fails is dropped, leaving the shipped default in place —
// never a broken or dangerous string on a projector.
const HOUSE_ACCENT_RE = /^#[0-9a-f]{6}$/i;
// accentSoft is GENERATED by updateHouse as an rgba() glow, so the hex-only
// rule would drop every legitimate value ever saved; both forms are legal.
const HOUSE_ACCENT_SOFT_RE = /^(#[0-9a-f]{6}|rgba\(\s*\d{1,3}\s*,\s*\d{1,3}\s*,\s*\d{1,3}\s*,\s*(0|1|0?\.\d+)\s*\))$/i;

// A house image path that is safe to drop into src="…" unescaped: no quotes
// or angle brackets to break out of the attribute, and no javascript: scheme
// (checked with whitespace/control characters stripped, because
// `java\nscript:` is still javascript: to a browser).
function safeHouseImage(src) {
  const s = String(src || '').trim();
  if (!s || /["<>]/.test(s)) return null;
  if (/^javascript:/i.test(s.replace(/[\s\u0000-\u001f]+/g, ""))) return null;
  return s;
}

// Mutating in place (rather than replacing HOUSES) keeps every existing
// reference across the modules valid when the teacher renames a house.
function applyHouseOverrides(overrides = {}) {
  for (const [id, patch] of Object.entries(overrides || {})) {
    const house = HOUSES[id];
    if (!house || !patch) continue;
    for (const key of ['name', 'motto', 'accent', 'accentSoft', 'image', 'heroImage']) {
      if (!patch[key]) continue;
      if (key === 'accent' && !HOUSE_ACCENT_RE.test(patch[key])) continue;
      if (key === 'accentSoft' && !HOUSE_ACCENT_SOFT_RE.test(patch[key])) continue;
      if ((key === 'image' || key === 'heroImage') && !safeHouseImage(patch[key])) continue;
      house[key] = patch[key];
    }
  }
}

// ---- shipped content vs teacher overrides ----------------------------------
// THE RULE, and the reason this section exists: CONTENT THAT SHIPS WITH THE APP
// LIVES IN THIS FILE, AND SAVED STATE HOLDS ONLY WHAT THE TEACHER CHANGED.
//
// It used to work the other way. defaultState() copied the whole dice table,
// the whole shop catalog, the whole quest board and the whole intro-video list
// into localStorage on first run, and from that moment the saved copy WAS the
// content — so fixing a wording, a price or a piece of artwork in this file
// reached fresh installs only, and never the classroom laptop that had already
// run the app once. Every such fix therefore needed its own bespoke migration
// with a revision marker to run it exactly once (DICE_DESC_REV, SHOP_DESC_REV,
// SHOP_ART_REV, the intro-video retire/backfill, the quest field backfills).
// Three separate audit bugs came out of that one design, and each fix added
// machinery rather than removing the cause.
//
// So: the merged content still lives on `state` exactly as every reader in this
// file and in the modules expects it — nothing downstream changes, and that is
// deliberate. What changes is the two ends:
//
//   load()     materialises each family as shipped-content + the teacher's diff
//   persist()  writes back only the diff (see toSaved below)
//
// A diff is per id and per field: the fields whose value differs from the
// shipped item, and nothing else. An unedited install saves an empty object.
// Which means a wording change in this file reaches EVERY install at the next
// reload, with no marker and no migration, for ever — and a teacher's edit to
// that same field still wins, because it is the one thing that was saved.
//
// The one-time conversion from the old full-copy shape is keyed off the SHAPE
// itself (an array where a diff object now lives), not off a version number:
// Admin's backup restore and "load sample data" both write a whole state object
// straight to localStorage, so an old-shaped payload can arrive at any time,
// long after any version stamp would have said the migration was done.

// Fields of a dice outcome a teacher may change. min/max/hasButton/mythic are
// deliberately absent — see defaultDiceProphecy() for why the die's 20 faces
// are not editable.
const DICE_EDITABLE = ['points', 'title', 'desc', 'emoji'];

// Wordings the APP shipped in earlier versions, read ONLY by the one-time
// conversion below. A saved description matching one of these was written by
// this file, not by the teacher, so it must not be preserved as an override —
// it would freeze the old text on that install for ever, which is the exact bug
// this refactor removes. "Move your token" was left over from a physical board
// game; the Mythic Relic was promised under rules that have none to give. Once
// converted, a save can never contain either again, and this table goes with
// the last install that still has to convert.
const RETIRED_DICE_DESCS = {
  smallfavor: ['Move your token / +2 class points'],
  mythic: ['+20 points AND a Mythic Relic to defend your house!'],
};

// Shipped table + the teacher's diffs = what the app runs on. Accepts either
// the saved diff object or an old full-copy array; every value is validated
// here rather than trusted, because this also receives whatever a restored
// backup file happens to contain.
function materializeDiceProphecy(saved) {
  const legacy = Array.isArray(saved);
  const byId = legacy
    ? Object.fromEntries(saved.filter((o) => o && o.id).map((o) => [o.id, o]))
    : (saved && typeof saved === 'object' ? saved : {});
  return defaultDiceProphecy().map((d) => {
    const s = byId[d.id] || {};
    const retired = legacy && (RETIRED_DICE_DESCS[d.id] || []).includes(String(s.desc || '').trim());
    return {
      ...d,
      points: Number.isFinite(Number(s.points)) ? Math.max(-MAX_DELTA, Math.min(MAX_DELTA, Math.round(Number(s.points)))) : d.points,
      title: typeof s.title === 'string' && s.title.trim() ? s.title.trim().slice(0, 40) : d.title,
      desc: (!retired && typeof s.desc === 'string' && s.desc.trim()) ? s.desc.trim().slice(0, 140) : d.desc,
      emoji: typeof s.emoji === 'string' && s.emoji.trim() ? s.emoji.trim().slice(0, 4) : d.emoji,
    };
  });
}

// The other direction: what is worth saving out of the live table. An outcome
// the teacher has put back to its shipped wording drops out of the file
// entirely, which is how "reset to default" stays reset even after the shipped
// wording changes again later.
function diceProphecyOverrides(list) {
  const out = {};
  const live = Array.isArray(list) ? list : [];
  for (const d of defaultDiceProphecy()) {
    const cur = live.find((o) => o && o.id === d.id);
    if (!cur) continue;
    const diff = {};
    for (const key of DICE_EDITABLE) {
      if (cur[key] !== d[key]) diff[key] = cur[key];
    }
    if (Object.keys(diff).length) out[d.id] = diff;
  }
  return out;
}

// ---- intro-video presets ----------------------------------------------------
// The two ids the app itself withdrew: the intros used to be YouTube embeds and
// now ship as real files in /videos, because the classroom computer may have no
// internet and an embed flashes its own pause glyph on launch. Read ONLY by the
// one-time conversion — a saved list that still names them was written before
// they were withdrawn, and letting them convert into teacher-added entries
// would put them back in the dropdown for ever. A YouTube link the teacher
// pasted himself has neither of these ids and is carried across untouched.
const RETIRED_VIDEO_IDS = new Set(['rock', 'classic']);

// Shipped presets + what the teacher has added, minus what they have hidden.
// Hiding is how a DELETION is stored: the old list was a full copy, so the only
// way to record "I don't want the second intro" was to remove it — and the
// backfill that introduced newly shipped presets then put it straight back on
// the next load. An id in `hidden` says the teacher meant it.
function materializeIntroVideos(saved) {
  const shipped = (CONFIG.POTW_INTRO_VIDEOS || []).map((v) => ({ ...v }));
  let added = [];
  let hidden = [];
  if (Array.isArray(saved)) {
    // Legacy full copy: convert once. Entries matching a shipped preset drop
    // out and the rest are the teacher's own — but NOTHING is hidden, however
    // many shipped presets are missing from it. A preset absent from an old
    // list almost never means "deleted": the whole reason this family needed
    // fixing is that the shipped list CHANGED (YouTube embeds out, /videos
    // files in) and old saves therefore predate every preset now in CONFIG.
    // Reading absence as deletion there would hide both intros from exactly
    // the installs the fix was written for. So the conversion keeps the old
    // backfill's answer, and hiding only ever records a deletion made after
    // it — the cost being that a preset deleted just before this upgrade
    // comes back once, and stays gone the second time.
    ({ added } = introVideoOverrides(saved.filter((v) => v && v.id && !RETIRED_VIDEO_IDS.has(v.id))));
  } else if (saved && typeof saved === 'object') {
    added = (Array.isArray(saved.added) ? saved.added : []).filter((v) => v && v.id && v.label && v.url);
    hidden = (Array.isArray(saved.hidden) ? saved.hidden : []).filter((id) => typeof id === 'string');
  }
  const hide = new Set(hidden);
  const override = new Map(added.map((v) => [v.id, v]));
  const out = [];
  for (const s of shipped) {
    if (hide.has(s.id)) continue;
    const o = override.get(s.id);
    out.push(o ? { id: s.id, label: o.label, url: o.url } : s);
  }
  for (const v of added) {
    if (!shipped.some((s) => s.id === v.id)) out.push({ id: v.id, label: v.label, url: v.url });
  }
  // The dropdown must never be empty — a teacher who has hidden everything and
  // added nothing gets the shipped presets back rather than a Place of the Week
  // with no video to choose. Same rule the old list-refill enforced.
  return out.length ? out : shipped;
}

function introVideoOverrides(list) {
  const shipped = CONFIG.POTW_INTRO_VIDEOS || [];
  const live = (Array.isArray(list) ? list : []).filter((v) => v && v.id);
  return {
    added: live
      .filter((v) => {
        const s = shipped.find((x) => x.id === v.id);
        return !s || s.label !== v.label || s.url !== v.url;
      })
      .map((v) => ({ id: v.id, label: v.label, url: v.url })),
    hidden: shipped.filter((s) => !live.some((v) => v.id === s.id)).map((s) => s.id),
  };
}

// ---- item-level diffs -------------------------------------------------------
// Shared by the shop and the quest board: both are lists of objects with stable
// ids, and both need the same three answers out of a save — which shipped items
// were edited and how, which items the teacher wrote themselves, and which
// shipped items they deleted.

// Order-insensitive deep compare, so a diff is never recorded for two effect
// objects that merely spell their keys in a different order.
function stableJson(v) {
  if (Array.isArray(v)) return `[${v.map(stableJson).join(',')}]`;
  if (v && typeof v === 'object') {
    return `{${Object.keys(v).sort().map((k) => `${JSON.stringify(k)}:${stableJson(v[k])}`).join(',')}}`;
  }
  return JSON.stringify(v) ?? 'null';
}
function sameValue(a, b) { return a === b || stableJson(a) === stableJson(b); }

// The fields where this item differs from the one that ships. `__unset` names
// shipped fields the teacher's version does not have AT ALL, which is a real
// edit and not an omission: saveShopItem rebuilds an item field by field, so
// clearing every counter off the Sword of Destiny leaves it with no
// `counteredBy` key, and merging the shipped item back over it would quietly
// restore the counter the teacher just removed.
function diffItem(shipped, item) {
  const diff = {};
  for (const key of Object.keys(item)) {
    if (key === 'id') continue;
    if (!sameValue(item[key], shipped[key])) diff[key] = item[key];
  }
  const unset = Object.keys(shipped).filter((key) => key !== 'id' && !(key in item));
  if (unset.length) diff.__unset = unset;
  return diff;
}

function applyItemDiff(shipped, diff) {
  const out = { ...shipped, ...diff };
  for (const key of (diff.__unset || [])) delete out[key];
  delete out.__unset;
  return out;
}

// Shipped list + overrides = the live list. Returns the shipped objects
// untouched where nothing was edited, so an unedited install is not merely
// equivalent to a fresh one, it is identical to it.
function mergeOverrides(shipped, ov) {
  const deleted = new Set(Array.isArray(ov.deleted) ? ov.deleted : []);
  const edits = (ov.edits && typeof ov.edits === 'object') ? ov.edits : {};
  const added = Array.isArray(ov.added) ? ov.added : [];
  const out = [];
  for (const s of shipped) {
    if (deleted.has(s.id)) continue;
    const diff = edits[s.id];
    out.push(diff && Object.keys(diff).length ? applyItemDiff(s, diff) : s);
  }
  // Teacher-written entries keep the order they were created in, after
  // everything that ships. An id that has since BECOME a shipped id is dropped
  // rather than listed twice — the shipped one above is now the real item.
  for (const item of added) {
    if (item && item.id && !shipped.some((s) => s.id === item.id)) out.push({ ...item });
  }
  return out;
}

// The reverse: what is worth saving out of a live list. `seen` is the set of
// shipped ids this save is entitled to call deleted — an id that is simply
// newer than the save has never been offered and must not be suppressed.
function splitOverrides(shipped, list, seen = null) {
  const live = (Array.isArray(list) ? list : []).filter((i) => i && i.id);
  const shippedById = new Map(shipped.map((s) => [s.id, s]));
  const edits = {};
  const added = [];
  for (const item of live) {
    const s = shippedById.get(item.id);
    if (!s) { added.push({ ...item }); continue; }
    const diff = diffItem(s, item);
    if (Object.keys(diff).length) edits[item.id] = diff;
  }
  const liveIds = new Set(live.map((i) => i.id));
  const deleted = shipped
    .filter((s) => !liveIds.has(s.id) && (!seen || seen.has(s.id)))
    .map((s) => s.id);
  return { edits, added, deleted };
}

// ---- Magic Shop catalogs ----------------------------------------------------
// TWO catalogs, one per combat mode, and they must never meet: 'catapult' and
// 'cloak' name a completely different item in each. Every function here takes
// the mode and looks the shipped list up itself, which is what makes crossing
// them impossible rather than merely unlikely — the old by-id migrations each
// had to be scoped by hand, with a paragraph explaining why.
function shippedCatalog(mode) {
  return mode === 'hp' ? defaultHpCatalog() : defaultDuelCatalog();
}
function otherCombatMode(mode) { return mode === 'duel' ? 'hp' : 'duel'; }

function emptyOverrides() { return { edits: {}, added: [], deleted: [] }; }

function materializeShopCatalog(mode, ov) {
  return mergeOverrides(shippedCatalog(mode), ov || emptyOverrides());
}

// One-time conversion of a saved full-copy catalog. `seededIds` is the old
// `shop.seeded` list for this mode: the shipped ids this browser has already
// been shown, and therefore the only ones its catalog is allowed to call
// deleted. Anything shipped since is simply new and appears as normal.
function overridesFromLegacyCatalog(mode, list, seededIds) {
  const shipped = shippedCatalog(mode);
  const seen = new Set(Array.isArray(seededIds) ? seededIds : []);
  // Shipped artwork (images/shop/) arrived after some catalogs were saved, and
  // a copy made before it has no image at all. An empty image is not a choice
  // the teacher could have expressed in Admin — clearing one there writes a
  // blank over a path they can see — so it takes the shipped art rather than
  // converting into an override that would hide it for ever. Runs once, here,
  // in place of the SHOP_ART_REV pass that used to run on every load.
  const art = new Map(shipped.filter((s) => s.image).map((s) => [s.id, s.image]));
  const filled = (Array.isArray(list) ? list : []).map((item) => (
    item && item.id && !item.image && art.has(item.id) ? { ...item, image: art.get(item.id) } : item
  ));
  return splitOverrides(shipped, filled, seen);
}

// Read a save's shop, whichever of the three shapes it is in, as per-mode
// overrides. `modeReset` says the save predates combat modes altogether.
function shopOverridesFromSaved(savedShop, savedMode) {
  const out = { duel: emptyOverrides(), hp: emptyOverrides(), modeReset: false };
  const shop = savedShop && typeof savedShop === 'object' ? savedShop : {};
  const take = (mode, o) => {
    if (!o || typeof o !== 'object') return;
    out[mode] = {
      edits: (o.edits && typeof o.edits === 'object') ? o.edits : {},
      added: Array.isArray(o.added) ? o.added.filter((i) => i && i.id) : [],
      deleted: Array.isArray(o.deleted) ? o.deleted.filter((id) => typeof id === 'string') : [],
    };
  };
  if (shop.edits || shop.added || shop.deleted) {
    // Current shape: overrides per mode, no catalog anywhere in the file.
    take('duel', { edits: shop.edits?.duel, added: shop.added?.duel, deleted: shop.deleted?.duel });
    take('hp', { edits: shop.edits?.hp, added: shop.added?.hp, deleted: shop.deleted?.hp });
    return out;
  }
  // Legacy full copies. `seeded` was a flat array before combat modes existed,
  // and a save with no valid combatMode predates them too: either way what it
  // holds IS the hit-points catalog, because that was the only one there was.
  const flatSeeded = Array.isArray(shop.seeded) ? shop.seeded : null;
  const validMode = COMBAT_MODES[savedMode] ? savedMode : null;
  if (!validMode || flatSeeded) {
    const oldCatalog = Array.isArray(shop.catalog) && shop.catalog.length ? shop.catalog : null;
    if (oldCatalog) {
      out.hp = overridesFromLegacyCatalog('hp', oldCatalog, flatSeeded || oldCatalog.map((i) => i.id));
    }
    out.modeReset = true;
    return out;
  }
  const other = otherCombatMode(validMode);
  const seeded = (shop.seeded && typeof shop.seeded === 'object') ? shop.seeded : {};
  if (Array.isArray(shop.catalog)) {
    out[validMode] = overridesFromLegacyCatalog(validMode, shop.catalog, seeded[validMode]);
  }
  // A mode that has never been active parks null and keeps no overrides at all.
  const parked = shop.parked && typeof shop.parked === 'object' ? shop.parked[other] : null;
  if (Array.isArray(parked) && parked.length) {
    out[other] = overridesFromLegacyCatalog(other, parked, seeded[other]);
  }
  return out;
}

// The live catalogs, back into overrides. The active mode's list is `catalog`;
// the other one is waiting in `parked` — see setCombatMode.
function shopOverrides(st) {
  const mode = COMBAT_MODES[st.settings && st.settings.combatMode] ? st.settings.combatMode : DEFAULT_COMBAT_MODE;
  const other = otherCombatMode(mode);
  const parked = st.shop && st.shop.parked ? st.shop.parked[other] : null;
  const per = {
    [mode]: splitOverrides(shippedCatalog(mode), st.shop && st.shop.catalog),
    // Not an array only if a mode has never been activated on this browser, in
    // which case it has nothing to override.
    [other]: Array.isArray(parked) ? splitOverrides(shippedCatalog(other), parked) : emptyOverrides(),
  };
  return {
    edits: { duel: per.duel.edits, hp: per.hp.edits },
    added: { duel: per.duel.added, hp: per.hp.added },
    deleted: { duel: per.duel.deleted, hp: per.hp.deleted },
  };
}

// ---- quest board ------------------------------------------------------------
// Same three answers as the shop, one catalog instead of two. What is different
// here is that a quest carries fields the app DERIVES rather than ships: the
// give-up penalty is half the reward unless the teacher says otherwise, and an
// untyped quest falls back to its category's icon. load() used to write those
// derived values into every saved quest ("backfill"), which turned a default
// into a stored fact — so raising a quest's points later left its penalty
// frozen at half of the old ones. Anything the app can work out for itself is
// not saved; quests.js, admin.js and failQuest() all already compute the same
// fallbacks at the point of use, and now they are the only rule.
function trimDerivedQuestFields(quest, shipped) {
  const out = { ...quest };
  if (!('repeatable' in shipped) && out.repeatable === false) delete out.repeatable;
  if (!('penalty' in shipped) && Number(out.penalty) === Math.round(Number(out.points || 0) / 2)) delete out.penalty;
  return out;
}

function questOverrides(list) {
  const shipped = defaultQuestCatalog();
  const shippedById = new Map(shipped.map((s) => [s.id, s]));
  const trimmed = (Array.isArray(list) ? list : []).filter((q) => q && q.id).map((q) => {
    const s = shippedById.get(q.id);
    return s ? trimDerivedQuestFields(q, s) : q;
  });
  return splitOverrides(shipped, trimmed, null);
}

function materializeQuestCatalog(savedQuests) {
  const shipped = defaultQuestCatalog();
  const q = savedQuests && typeof savedQuests === 'object' ? savedQuests : {};
  if (q.edits || q.added || q.deleted) {
    return mergeOverrides(shipped, {
      edits: (q.edits && typeof q.edits === 'object') ? q.edits : {},
      added: Array.isArray(q.added) ? q.added.filter((x) => x && x.id) : [],
      deleted: Array.isArray(q.deleted) ? q.deleted.filter((id) => typeof id === 'string') : [],
    });
  }
  // Legacy full copy. A shipped quest missing from it counts as deleted: the
  // board was copied whole and there was never a "already introduced" list to
  // check against, so absence is the only record a deletion ever left. (Which
  // also means a quest shipped after that copy was made has never reached this
  // install — it could not, until now.) An empty array is not a wiped board,
  // it is a save from before the catalog had anything in it.
  if (Array.isArray(q.catalog) && q.catalog.length) return mergeOverrides(shipped, questOverrides(q.catalog));
  return shipped;
}

// The single place the in-memory state is turned into the text on disk. Every
// content family that ships defaults hands back its overrides here; everything
// else is saved as it stands.
function toSaved(st) {
  return {
    ...st,
    settings: {
      ...st.settings,
      diceProphecy: diceProphecyOverrides(st.settings && st.settings.diceProphecy),
      introVideos: introVideoOverrides(st.settings && st.settings.introVideos),
    },
    // `catalog: undefined` is dropped by JSON.stringify — the merged board is
    // in memory only, and `active`/`completed` (real records, not content)
    // carry on being saved exactly as they are.
    quests: { ...st.quests, catalog: undefined, ...questOverrides(st.quests && st.quests.catalog) },
    shop: shopOverrides(st),
  };
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
        // The intros used to be YouTube embeds. They now ship as real files in
        // /videos, because the classroom computer may have no internet — and a
        // YouTube embed also flashes its own pause glyph on launch, which was a
        // long-standing complaint. Move a profile still pointing at a preset
        // over to the equivalent local file. Only these two ids are remapped,
        // so a video the teacher chose themselves is left alone.
        if (p.introVideoId === 'rock') p.introVideoId = 'intro-01';
        else if (p.introVideoId === 'classic') p.introVideoId = 'intro-02';
        // Flight music is chosen once, in Admin → Background music, not per
        // destination. Nothing reads a saved flyoverUrl any more; drop it here
        // so it stops riding along in every backup the teacher exports.
        delete p.flyoverUrl;
      }
      // Same for settings (new keys like theme/mapsApiKeyOverride).
      merged.settings = { ...def.settings, ...(merged.settings || {}) };
      merged.settings.theme = { ...def.settings.theme, ...(merged.settings.theme || {}) };
      merged.settings.ambient = { ...def.settings.ambient, ...(merged.settings.ambient || {}) };
      merged.settings.lock = { ...def.settings.lock, ...(merged.settings.lock || {}) };
      if (!merged.inventory || typeof merged.inventory !== 'object') merged.inventory = {};
      merged.settings.combat = { ...defaultCombat(), ...(merged.settings.combat || {}) };
      if (!PRIZE_RULES[merged.settings.combat.prizeRule]) merged.settings.combat.prizeRule = 'gap';
      if (!merged.hp || typeof merged.hp !== 'object') merged.hp = {};
      {
        const saved = merged.settings.layouts && typeof merged.settings.layouts === 'object'
          ? merged.settings.layouts : {};
        const out = {};
        Object.keys(LAYOUT_SCREENS).forEach((id) => {
          out[id] = saved[id] === 'carousel' ? 'carousel' : DEFAULT_LAYOUT;
        });
        merged.settings.layouts = out;
      }
      {
        const saved = merged.settings.sfx && typeof merged.settings.sfx === 'object' ? merged.settings.sfx : {};
        const out = {};
        Object.keys(SFX_SLOTS).forEach((id) => {
          // A slot the teacher has cleared stays cleared (''); one never seen
          // picks up the file that ships in /sfx.
          out[id] = typeof saved[id] === 'string' ? saved[id].trim() : (SFX_SLOTS[id].file || '');
        });
        merged.settings.sfx = out;
      }
      // Per-screen colours arrived late; seed any screen the saved state has
      // never seen, without disturbing ones the teacher has already set.
      {
        const saved = merged.settings.moduleThemes && typeof merged.settings.moduleThemes === 'object'
          ? merged.settings.moduleThemes : {};
        const out = {};
        Object.entries(MODULE_THEMES).forEach(([id, d]) => {
          const t = saved[id] || {};
          out[id] = {
            color: typeof t.color === 'string' && /^#[0-9a-f]{6}$/i.test(t.color) ? t.color : d.color,
            matchHouse: typeof t.matchHouse === 'boolean' ? t.matchHouse : d.matchHouse,
          };
        });
        merged.settings.moduleThemes = out;
      }
      // Die of Destiny outcomes: the shipped table with the teacher's edits
      // merged over it, keyed by id. min/max/hasButton/mythic always come from
      // this file (so a roll can never land on a gap), and so does any of the
      // four editable fields the teacher has not touched — which is what lets a
      // wording fix here reach a laptop that has already saved.
      merged.settings.diceProphecy = materializeDiceProphecy(merged.settings.diceProphecy);
      // 2026-07-28 rescale: the one-tap presets and Battle Day's ± step now
      // ship ×10 (Mr. D plays with big totals). A browser that saved before
      // then still holds the old numbers — but ONLY values equal to the old
      // shipped defaults are lifted; anything the teacher typed is theirs.
      if (!merged.settings.scoreScale10x) {
        merged.settings.scoreScale10x = true;
        const oldPresetPoints = { 'ap-bell': 5, 'ap-homework': 10, 'ap-teamwork': 5, 'ap-quiz': 50, 'ap-penalty': -5 };
        (merged.settings.awardPresets || []).forEach((ap) => {
          if (ap && oldPresetPoints[ap.id] === ap.points) ap.points *= 10;
        });
        if (merged.settings.combat.teacherScore === 10) merged.settings.combat.teacherScore = 100;
      }
      // One-time seed: a save whose ambient track map materialised before a
      // screen shipped with bundled music (potw, council, wheel) never hears
      // it — the saved map wins over CONFIG wholesale. Fill only the keys the
      // save has never seen, once; a track the teacher later clears stays
      // cleared because this never runs again.
      // Versioned: bump the number whenever CONFIG.AMBIENT_TRACKS gains a
      // screen, and every existing map picks the newcomer up once (v2: the
      // Trivia Tuesday screen). A track the teacher cleared between versions
      // does come back that once — acceptable while the app is pre-delivery.
      if ((Number(merged.settings.ambientSeeded) || 0) < 3 && merged.settings.ambient
          && merged.settings.ambient.tracks && typeof merged.settings.ambient.tracks === 'object') {
        const seedVer = Number(merged.settings.ambientSeeded) || 0;
        merged.settings.ambientSeeded = 3;
        for (const [id, entry] of Object.entries(CONFIG.AMBIENT_TRACKS || {})) {
          if (!(id in merged.settings.ambient.tracks)) {
            merged.settings.ambient.tracks[id] = typeof entry === 'string' ? entry : { ...entry };
          }
        }
        // v3 (owner's levels): screens at 100%, master at 50%, sfx at 65% —
        // lifted ONLY where the save still holds the old shipped numbers, so
        // anything the teacher tuned by hand stays theirs.
        if (seedVer > 0 && seedVer < 3) {
          for (const [id, entry] of Object.entries(merged.settings.ambient.tracks)) {
            const def = (CONFIG.AMBIENT_TRACKS || {})[id];
            if (def && entry && typeof entry === 'object' && entry.src === def.src && entry.volume === 0.5 && !entry.muted) {
              entry.volume = 1;
            }
          }
          if (merged.settings.ambient.volume === 0.6) merged.settings.ambient.volume = 0.5;
          if (merged.settings.sfxVolume === 1 || merged.settings.sfxVolume == null) merged.settings.sfxVolume = 0.65;
        }
      }
      // The revision marker that used to drive that fix by hand. Nothing reads
      // it any more; drop it so it stops riding along in every backup.
      delete merged.settings.diceDescRev;
      // Deep-merge the other sub-trees too: a state saved before a feature
      // existed (or restored from an old backup) would otherwise be missing
      // keys the modules dereference unguarded — e.g. quests.completed.push().
      merged.quests = { ...def.quests, ...(merged.quests || {}) };
      merged.trivia = { ...def.trivia, ...(merged.trivia || {}) };
      if (!Array.isArray(merged.trivia.questions)) merged.trivia.questions = [];
      if (!merged.settings.triviaSeeded) {
        merged.settings.triviaSeeded = true;
        if (!merged.trivia.questions.length) merged.trivia.questions = def.trivia.questions;
      }
      // The quest board ships in this file; the save holds the teacher's edits,
      // their own quests and the ids they deleted. Four per-field backfills used
      // to run here — repeatable, penalty, type and icon, each added to the
      // catalog after some browsers had already saved a copy of it — and all
      // four are gone: a field the app can derive is derived where it is used
      // (see trimDerivedQuestFields), and a field that ships is read from the
      // shipped quest by id every load.
      merged.quests.catalog = materializeQuestCatalog(saved.quests);
      if (!merged.quests.active || typeof merged.quests.active !== 'object') merged.quests.active = {};
      if (!Array.isArray(merged.quests.completed)) merged.quests.completed = [];
      // Both shop catalogs ship in this file and the save holds only what the
      // teacher changed, per mode (see the Magic Shop section above). Three
      // separate one-time patches used to live here and are gone with the copy
      // they existed to correct: `seeded` (introduce a newly shipped item once,
      // without resurrecting a deleted one), SHOP_DESC_REV (weapons still
      // promising "Deduct 20 pts" after Battle Day moved to hit points) and
      // SHOP_ART_REV (hand-drawn art that reached fresh installs only). A
      // shipped price, description or picture now arrives on its own.
      {
        const ov = shopOverridesFromSaved(saved.shop, merged.settings.combatMode);
        if (ov.modeReset) {
          // A save from before combat modes existed. Whatever it holds IS the
          // hit-points catalog — that is all there was — so it becomes the
          // parked 'hp' side with its edits and deletions intact, and Mr. D's
          // rules come in as the active mode. Held items and damage belong to
          // the mode they happened in and do not come with it.
          merged.settings.combatMode = DEFAULT_COMBAT_MODE;
          merged.inventory = {};
          merged.hp = {};
        }
        const mode = COMBAT_MODES[merged.settings.combatMode] ? merged.settings.combatMode : DEFAULT_COMBAT_MODE;
        const other = otherCombatMode(mode);
        merged.settings.combatMode = mode;
        merged.shop = {
          catalog: materializeShopCatalog(mode, ov[mode]),
          // The mode waiting its turn is materialised too, so switching to it
          // finds the teacher's edits AND anything shipped since — the parked
          // side used to be topped up only when it next became active.
          parked: { [mode]: null, [other]: materializeShopCatalog(other, ov[other]) },
        };
      }
      merged.planner = { ...def.planner, ...(merged.planner || {}) };
      if (!Array.isArray(merged.planner.events)) merged.planner.events = [];
      if (!Array.isArray(merged.transactions)) merged.transactions = [];
      if (!merged.shields || typeof merged.shields !== 'object') merged.shields = {};
      // Drop expired shields so they can't be revived by an old backup.
      for (const [id, exp] of Object.entries(merged.shields)) {
        if (!(Number(exp) > Date.now())) delete merged.shields[id];
      }
      merged.revealed = merged.revealed && typeof merged.revealed === 'object' ? merged.revealed : {};
      merged.shrouded = merged.shrouded && typeof merged.shrouded === 'object' ? merged.shrouded : {};
      for (const [id, until] of Object.entries(merged.shrouded)) {
        if (!(Number(until) > Date.now())) delete merged.shrouded[id];
      }
      merged.frozen = merged.frozen && typeof merged.frozen === 'object' ? merged.frozen : {};
      for (const [id, until] of Object.entries(merged.frozen)) {
        if (!(Number(until) > Date.now())) delete merged.frozen[id];
      }
      merged.potwBounties = merged.potwBounties && typeof merged.potwBounties === 'object' ? merged.potwBounties : {};
      // The presets the Admin dropdown offers: the ones that ship in CONFIG,
      // plus whatever the teacher has added, minus what they have hidden. This
      // list is where the "saved copy wins for ever" bug did its worst damage —
      // /videos files were shipped and made the default while the saved list
      // still held only the two YouTube presets, so the dropdown could not
      // offer the new files and 'intro-01' resolved to nothing at all. Reading
      // the shipped list from CONFIG on every load is what makes that
      // impossible now; a newly shipped preset simply appears.
      merged.settings.introVideos = materializeIntroVideos(merged.settings.introVideos);
      repairPotwVideos(merged);
      // Teacher's house edits are applied IN PLACE onto the shared HOUSES
      // objects, so every module holding a reference sees the new values.
      applyHouseOverrides(merged.settings.houses);
      merged.defenses = merged.defenses && typeof merged.defenses === 'object' ? merged.defenses : {};
      for (const [id, d] of Object.entries(merged.defenses)) {
        if (!d || !(Number(d.reduce) > Date.now())) delete merged.defenses[id];
      }
      return merged;
    }
  } catch (e) {
    console.warn('store: failed to load, using defaults', e);
    // A SAVE THAT WOULD NOT PARSE IS NOT A SAVE THAT SHOULD BE THROWN AWAY.
    // Booting to defaults here is correct — the app has to start. But the very
    // next emit() used to overwrite the damaged text with those defaults, and
    // whatever was recoverable in it (a term of points, usually) was gone for
    // good. A truncated write or a bad character is often repairable by hand;
    // nothing is repairable once it has been overwritten.
    quarantineCorruptSave();
  }
  // Fresh install, or a save too broken to read. It goes through the same repair
  // as a loaded state — defaults are not automatically self-consistent, and
  // pretending otherwise is what broke this in the first place.
  return repairPotwVideos(defaultState());
}

// Move the unreadable payload somewhere the next save cannot reach, and tell the
// teacher — in words that say what to do, not what went wrong.
function quarantineCorruptSave() {
  try {
    const raw = localStorage.getItem(CONFIG.STORAGE_KEY);
    if (!raw) return;                       // nothing to lose; a genuinely fresh start
    const stamp = new Date().toISOString().replace(/[:.]/g, '-');
    const key = `${CONFIG.STORAGE_KEY}-corrupt-${stamp}`;
    localStorage.setItem(key, raw);
    console.warn(`store: damaged save set aside as ${key} (${raw.length} bytes)`);
    if (typeof document !== 'undefined') {
      // The banner has to survive module load order, so it waits for a body.
      const show = () => showCorruptSaveNotice(key, raw.length);
      if (document.body) show();
      else document.addEventListener('DOMContentLoaded', show, { once: true });
    }
  } catch (e2) {
    // Storage is refusing writes entirely — persist() will raise its own banner.
    console.warn('store: could not quarantine the damaged save', e2);
  }
}

function showCorruptSaveNotice(key, bytes) {
  if (typeof document === 'undefined' || document.getElementById('store-corrupt-save')) return;
  const bar = document.createElement('div');
  bar.id = 'store-corrupt-save';
  bar.setAttribute('role', 'alert');
  bar.style.cssText = 'position:fixed;left:0;right:0;bottom:0;z-index:99999;padding:14px 18px;'
    + 'background:#78350f;color:#fff;font:600 15px/1.45 system-ui,sans-serif;'
    + 'box-shadow:0 -6px 24px rgba(0,0,0,.5);display:flex;gap:14px;align-items:center;';
  bar.innerHTML = `<span style="font-size:22px">&#128737;&#65039;</span>
    <span style="flex:1">
      <b>This app started with a blank term.</b><br>
      The saved data on this computer could not be read, so it has been set aside
      rather than written over (${bytes.toLocaleString()} characters, kept as
      <code style="background:rgba(0,0,0,.3);padding:1px 5px;border-radius:4px">${key}</code>).
      <b>Restore your most recent backup</b> in the Teacher Admin panel, and tell
      whoever set this up before carrying on — the old data may still be recoverable.
    </span>
    <button type="button" style="flex:0 0 auto;padding:8px 14px;border-radius:8px;border:1px solid rgba(255,255,255,.5);
      background:transparent;color:#fff;font:inherit;cursor:pointer">Dismiss</button>`;
  bar.querySelector('button').addEventListener('click', () => bar.remove());
  (document.body || document.documentElement).appendChild(bar);
}

// A failed save used to be a console.warn and nothing else. That is the worst
// possible outcome in a classroom: the award already happened in memory and
// every screen already repainted showing the new total, so the teacher has no
// reason to doubt it — and it is gone at the next reload. He has no devtools
// open and will never see a console warning.
//
// Now it says so on screen, once, and stays out of the way after that. Losing
// a point award silently is worse than an ugly banner.
// A profile pointing at a preset that no longer exists resolves to an empty URL
// and Place of the Week silently shows its title card instead of playing
// anything. This has to run on EVERY path into a state object — saved or fresh.
// Repairs that live only inside load()'s `if (raw)` branch have now broken
// first-ever visits twice in this project (sound effects, then this), which is
// exactly the case nobody tests because the developer's browser always has a
// save in it.
function repairPotwVideos(st) {
  if (!st || !st.potw || !st.settings) return st;
  const ids = new Set((st.settings.introVideos || []).map((v) => v.id));
  if (!ids.size) return st;
  for (const p of Object.values(st.potw.profiles || {})) {
    if (p && !p.videoUrl && p.introVideoId && !ids.has(p.introVideoId)) {
      p.introVideoId = CONFIG.POTW_DEFAULT_VIDEO_ID;
    }
  }
  return st;
}

// TWO TABS, ONE KEY. State loads once per tab and every emit() rewrites the
// WHOLE key, so two windows on the same machine — easy once the app is installed
// as a PWA and also open in a normal tab — silently overwrite each other. The
// last one to touch anything wins, and a morning's points can vanish because a
// forgotten window was left open on a stale copy.
//
// There is no safe merge here: the ledger is a full array rewrite, not a diff.
// The honest thing is to notice and stop, loudly. The tab that finds a foreign
// write is the STALE one by definition, so it stops persisting rather than
// racing to win.
let staleTab = false;
if (typeof window !== 'undefined') {
  window.addEventListener('storage', (ev) => {
    if (ev.key !== CONFIG.STORAGE_KEY || ev.newValue === null) return;
    if (staleTab) return;
    staleTab = true;
    console.warn('store: another window wrote this app\'s data — this tab has stopped saving.');
    try { showTwoTabNotice(); } catch (e) { /* never let the warning break the app */ }
  });
}

function showTwoTabNotice() {
  if (typeof document === 'undefined' || document.getElementById('store-two-tab')) return;
  const bar = document.createElement('div');
  bar.id = 'store-two-tab';
  bar.setAttribute('role', 'alert');
  bar.style.cssText = 'position:fixed;left:0;right:0;bottom:0;z-index:99999;padding:14px 18px;'
    + 'background:#7f1d1d;color:#fff;font:600 15px/1.45 system-ui,sans-serif;'
    + 'box-shadow:0 -6px 24px rgba(0,0,0,.5);display:flex;gap:14px;align-items:center;';
  bar.innerHTML = `<span style="font-size:22px">&#9888;&#65039;</span>
    <span style="flex:1">
      <b>This app is open in another window.</b><br>
      Two copies cannot both keep score — they overwrite each other. This window
      has <b>stopped saving</b> so the other one keeps its work. Close this window
      and carry on in the other, or reload this one to pick up where that one is.
    </span>
    <button type="button" style="flex:0 0 auto;padding:8px 14px;border-radius:8px;border:1px solid rgba(255,255,255,.5);
      background:transparent;color:#fff;font:inherit;cursor:pointer">Reload this window</button>`;
  bar.querySelector('button').addEventListener('click', () => location.reload());
  (document.body || document.documentElement).appendChild(bar);
}

let persistFailed = false;
function persist() {
  // A stale tab must not write. Its in-memory state is a fork of a version the
  // other window has already moved past.
  if (staleTab) return;
  try {
    // toSaved(), not `state`: shipped content stays in this file and only the
    // teacher's overrides are written — see "shipped content vs teacher
    // overrides" above.
    localStorage.setItem(CONFIG.STORAGE_KEY, JSON.stringify(toSaved(state)));
    persistFailed = false;
  } catch (e) {
    console.warn('store: persist failed', e);
    if (!persistFailed) {
      persistFailed = true;
      try { showPersistFailure(e); } catch (err) { /* never let the warning break the app */ }
    }
  }
}

// Deliberately built with raw DOM and inline styles rather than the app's own
// components: whatever just failed may have left the page in an odd state, and
// this message has to survive that.
function showPersistFailure(err) {
  if (typeof document === 'undefined' || document.getElementById('store-persist-error')) return;
  const quota = err && (err.name === 'QuotaExceededError' || err.code === 22 || err.code === 1014);
  const bar = document.createElement('div');
  bar.id = 'store-persist-error';
  bar.setAttribute('role', 'alert');
  bar.style.cssText = 'position:fixed;left:0;right:0;bottom:0;z-index:99999;padding:14px 18px;'
    + 'background:#7f1d1d;color:#fff;font:600 15px/1.45 system-ui,sans-serif;'
    + 'box-shadow:0 -6px 24px rgba(0,0,0,.5);display:flex;gap:14px;align-items:center;';
  bar.innerHTML = `<span style="font-size:22px">⚠️</span>
    <span style="flex:1">
      <b>This device could not save your last change.</b><br>
      ${quota
        ? 'The browser’s storage for this app is full. Open the Teacher Admin panel and export a backup, then use Reset to start a fresh term — your backup keeps the old one.'
        : 'Saving to this browser failed. Anything you change now may be lost when the page reloads.'}
      Please tell whoever set this up before carrying on.
    </span>
    <button type="button" style="flex:0 0 auto;padding:8px 14px;border-radius:8px;border:1px solid rgba(255,255,255,.5);
      background:transparent;color:#fff;font:inherit;cursor:pointer">Dismiss</button>`;
  bar.querySelector('button').addEventListener('click', () => bar.remove());
  (document.body || document.documentElement).appendChild(bar);
}

// ---- ledger memoisation -----------------------------------------------------
// Every screen re-renders on ANY store change, and the Records screen alone
// makes ~50 passes over state.transactions per render (8 getTotal calls, 36
// inside getWeeklySeries, plus the breakdown). Most changes that trigger a
// render never touch the ledger at all — a theme toggle, a sound setting, a
// layout switch — so nearly all of that work was recomputing an identical
// answer.
//
// This cache is safe because the invalidation surface is provably small: the
// ONLY three places that can change state.transactions are addPoints(),
// removeTransaction() and resetAll(), and each bumps the version. If you add a
// fourth, bump it there too — that is the whole contract.
//
// Time and settings are handled by the KEY rather than the version, because
// they change without any ledger mutation: a 'week' scope answer depends on
// which week it is now, and the weekly series depends on the term dates the
// teacher set in Admin. Both are folded into the key, so a week rolling over or
// a term being re-dated produces a different key and a fresh answer instead of
// a stale hit.
let ledgerCache = new Map();
function bumpLedger() { ledgerCache = new Map(); }
function cached(key, compute) {
  if (ledgerCache.has(key)) return ledgerCache.get(key);
  const value = compute();
  ledgerCache.set(key, value);
  return value;
}

// Batching support for callers that make several store writes as one logical
// change (e.g. admin.js re-syncing a handful of shop items' counter lists).
// Without this, each write's own emit() persists to localStorage, pokes the
// folder backup and re-renders every mounted screen — once PER item instead
// of once for the whole edit. batchDepth nests safely: an emit() that fires
// while any batch is open just marks the state dirty instead of emitting;
// the outermost batch.() call is the one that actually emits, once, after
// its function returns.
let batchDepth = 0;
let batchDirty = false;

function emit() {
  if (batchDepth > 0) { batchDirty = true; return; }
  persist();
  listeners.forEach((fn) => { try { fn(state); } catch (e) { console.error(e); } });
}

function startOfWeek(d = new Date()) {
  const x = new Date(d); const day = (x.getDay() + 6) % 7; // Monday=0
  x.setHours(0, 0, 0, 0); x.setDate(x.getDate() - day); return x;
}

// NOTE: this addDays takes/returns a 'YYYY-MM-DD' string — admin.js also has
// an addDays that takes/returns a Date. Same name, different contract; see
// the warning in js/core/util.js. Do not unify these.
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

// Shared school-day walker for the freeze (Legendary Ice Axe). Two callers
// need the exact same weekend-skipping rule and must never drift apart:
// freezeHouse walks FORWARD a fixed number of school days to find an expiry
// ({ steps }); getFreezeInfo walks forward from today and COUNTS the school
// days crossed to reach an expiry already on the books ({ untilMs }). Both
// are the same loop — start at midnight, step a calendar day at a time,
// skip Saturday/Sunday — so it is written once and called both ways instead
// of risking two copies that quietly disagree about a long weekend.
function walkSchoolDays(fromMs, { steps, untilMs } = {}) {
  const d = new Date(fromMs);
  d.setHours(0, 0, 0, 0);
  let count = 0;
  const stepMode = steps != null;
  while (stepMode ? count < steps : d.getTime() < untilMs) {
    d.setDate(d.getDate() + 1);
    const day = d.getDay();
    if (day !== 0 && day !== 6) count++;   // Sunday / Saturday do not count
  }
  return stepMode ? d.getTime() : count;
}

export const store = {
  HOUSES,
  QUEST_TYPES,
  MODULE_THEMES,
  LAYOUT_SCREENS,
  STOCKPILE_KINDS,
  PRIZE_RULES,

  // ONE honest answer to "did that last change actually make it to disk?" —
  // for anything that wants to celebrate a save rather than merely hope one
  // happened. persist() already tracks whether localStorage accepted the
  // write; a stale second tab (see the two-tab guard above) never even
  // attempts one, and silence there is just as much a non-save as a thrown
  // QuotaExceededError. Both have to be clean for this to say yes.
  lastPersistOk() { return !persistFailed && !staleTab; },

  getCombat() { return { ...defaultCombat(), ...(store.getSettings().combat || {}) }; },
  // Clamps live HERE, not in the Admin form. The form is one caller among
  // several (backup restore, migrations, a future preset), and it clamped
  // inconsistently — prizeFlat had a floor but no ceiling, so a stray keystroke
  // could set a 15,000-point prize that addPoints would silently cut to 9,999
  // while the victory card announced the full number.
  updateCombat(patch) {
    const next = { ...store.getCombat(), ...(patch || {}) };
    if (!PRIZE_RULES[next.prizeRule]) next.prizeRule = 'gap';
    const clamp = (v, lo, hi, dflt) => {
      const n = Math.round(Number(v));
      return Number.isFinite(n) ? Math.max(lo, Math.min(hi, n)) : dflt;
    };
    const d = defaultCombat();
    next.gapShare     = clamp(next.gapShare, 0, 100, d.gapShare);
    next.prizePercent = clamp(next.prizePercent, 0, 100, d.prizePercent);
    // MAX_DELTA is the real ceiling — a prize above it cannot be paid in full.
    next.prizeFlat    = clamp(next.prizeFlat, 0, MAX_DELTA, d.prizeFlat);
    next.hpBase       = clamp(next.hpBase, 1, 10000, d.hpBase);
    next.hpPer500     = clamp(next.hpPer500, 0, 10000, d.hpPer500);
    // At 0 the buttons would be dead controls, so the floor is 1.
    next.teacherScore = clamp(next.teacherScore, 1, MAX_DELTA, d.teacherScore);
    next.punchingDown = !!next.punchingDown;
    next.duelPunchDown = next.duelPunchDown !== false;
    store.updateSettings({ combat: next });
  },

  // Bigger totals mean a tougher house — a mild brake on everyone piling on
  // the leader every week.
  //
  // The step is HP_POINTS_PER_STEP, not the literal 500 it used to be. When the
  // shop was rescaled x100 to meet Mr. D's costs, every point value in the app
  // moved with it; a 500-point step would now trigger on pocket change and hand
  // a mid-table house hundreds of hit points. The setting is still called
  // hpPer500 because that is what the teacher reads in Admin — "per 500 points"
  // at the old scale is "per 50,000" at this one, and the label there says so.
  getMaxHp(houseId) {
    const c = store.getCombat();
    const pts = Math.max(0, store.getTotal(houseId, 'term'));
    return Math.max(1, Math.round(c.hpBase + c.hpPer500 * Math.floor(pts / HP_POINTS_PER_STEP)));
  },

  // state.hp holds DAMAGE TAKEN, not current hit points. Storing "current"
  // looked right until a house won a battle: the prize pushed it over a 500
  // boundary, its maximum rose, and its untouched current HP was suddenly
  // 120/130 — it appeared wounded for getting richer. Tracking damage means a
  // change in points moves the maximum and the current value together.
  getHp(houseId) {
    const taken = Math.max(0, Math.round(Number((state.hp || {})[houseId]) || 0));
    return Math.max(0, store.getMaxHp(houseId) - taken);
  },

  // Everyone back to full. Called when a Battle Day session begins, so nobody
  // arrives already half-beaten from last week.
  resetAllHp() {
    state.hp = {};
    emit();
  },

  damageHp(houseId, amount) {
    const dmg = Math.max(0, Math.round(Number(amount) || 0));
    if (!state.hp) state.hp = {};
    const before = store.getHp(houseId);
    const after = Math.max(0, before - dmg);
    state.hp[houseId] = Math.max(0, store.getMaxHp(houseId) - after);
    emit();
    return { before, after, defeated: after === 0 && before > 0 };
  },

  // Punching down is off by default: without it, the leading house farms the
  // last-placed house every Friday, which is the failure mode a classroom
  // would regret most.
  canAttack(attackerId, defenderId) {
    if (attackerId === defenderId) return { ok: false, reason: 'A house cannot attack itself.' };
    const c = store.getCombat();
    // Punching-down arrived as a HIT POINTS rule and leaked into Mr. D's, where
    // it did real damage: with the shared default (punching down not allowed)
    // the house in FIRST place could not attack anybody at all, and the toggle
    // that would have fixed it was hidden while his rules were running. The
    // leader was locked out of Battle Day with no way for a teacher to let them
    // back in. Mr. D wants it ON, so his rules carry their own setting — see
    // duelPunchDown — and the switch for it sits in his own Battle Day panel.
    const allowed = store.getCombatMode() === 'duel' ? store.getCombat().duelPunchDown !== false : c.punchingDown;
    if (!allowed && store.getTotal(defenderId, 'term') < store.getTotal(attackerId, 'term')) {
      return { ok: false, reason: 'They have fewer points than you — the rule against punching down is on.' };
    }
    return { ok: true, reason: '' };
  },

  // What the winner would take. Never negative, and never touches the loser.
  previewPrize(attackerId, defenderId) {
    const c = store.getCombat();
    const them = Math.max(0, store.getTotal(defenderId, 'term'));
    const us = Math.max(0, store.getTotal(attackerId, 'term'));
    if (c.prizeRule === 'flat') return Math.max(0, Math.round(c.prizeFlat));
    if (c.prizeRule === 'percent') return Math.max(0, Math.round(them * (c.prizePercent / 100)));
    return Math.max(0, Math.round((them - us) * (c.gapShare / 100)));   // 'gap'
  },

  // The loser keeps every point they earned; only the winner's total moves.
  // Returns what was ACTUALLY credited, not what was calculated. addPoints
  // clamps to MAX_DELTA, so returning the raw prize let the victory card
  // announce a number the ledger never received.
  awardBattleWin(winnerId, loserId) {
    const prize = store.previewPrize(winnerId, loserId);
    if (prize <= 0) return 0;
    const tx = store.addPoints(winnerId, prize, {
      reason: `Battle won vs ${HOUSES[loserId] ? HOUSES[loserId].name : 'rival'}`,
      tag: 'battle',
    });
    return tx ? tx.delta : 0;
  },

  // Does buying this item stock it, or fire it immediately?
  isStockpiled(item) {
    return !!(item && item.effect && STOCKPILE_KINDS.has(item.effect.kind));
  },

  // What a house owns, newest catalogue order, with the live item definition
  // attached. An item the teacher has since deleted from the shop is dropped
  // rather than rendered as a blank row.
  getInventory(houseId) {
    const owned = (state.inventory || {})[houseId] || {};
    return Object.entries(owned)
      .filter(([, n]) => Number(n) > 0)
      .map(([itemId, n]) => {
        const item = state.shop.catalog.find((i) => i.id === itemId);
        return item ? { item, count: Math.max(0, Math.round(Number(n) || 0)) } : null;
      })
      .filter(Boolean)
      .sort((a, b) => a.item.cost - b.item.cost);
  },

  countOwned(houseId, itemId) {
    return Math.max(0, Math.round(Number(((state.inventory || {})[houseId] || {})[itemId]) || 0));
  },

  addToInventory(houseId, itemId, n = 1) {
    if (!state.inventory) state.inventory = {};
    if (!state.inventory[houseId]) state.inventory[houseId] = {};
    const cur = store.countOwned(houseId, itemId);
    state.inventory[houseId][itemId] = cur + Math.max(1, Math.round(Number(n) || 1));
    emit();
    return state.inventory[houseId][itemId];
  },

  // Returns false when the house does not actually hold one, so a double-tap
  // cannot spend an item that is not there.
  consumeFromInventory(houseId, itemId) {
    const cur = store.countOwned(houseId, itemId);
    if (cur <= 0) return false;
    state.inventory[houseId][itemId] = cur - 1;
    if (state.inventory[houseId][itemId] <= 0) delete state.inventory[houseId][itemId];
    emit();
    return true;
  },
  SFX_SLOTS,

  // '' means "use the built-in sound".
  getSfx(name) {
    if (!SFX_SLOTS[name]) return '';
    const v = (store.getSettings().sfx || {})[name];
    return typeof v === 'string' ? v.trim() : (SFX_SLOTS[name].file || '');
  },

  setSfx(name, src) {
    if (!SFX_SLOTS[name]) return false;
    const all = { ...(store.getSettings().sfx || {}) };
    all[name] = typeof src === 'string' ? src.trim() : '';
    store.updateSettings({ sfx: all });
    return true;
  },

  // 'grid' | 'carousel'. Unknown screens are always 'grid' — a screen that has
  // no carousel must never be told it is in one.
  getLayout(screenId) {
    if (!LAYOUT_SCREENS[screenId]) return DEFAULT_LAYOUT;
    const v = (store.getSettings().layouts || {})[screenId];
    return v === 'carousel' ? 'carousel' : DEFAULT_LAYOUT;
  },

  setLayout(screenId, layout) {
    if (!LAYOUT_SCREENS[screenId]) return false;
    const all = { ...(store.getSettings().layouts || {}) };
    all[screenId] = layout === 'carousel' ? 'carousel' : DEFAULT_LAYOUT;
    store.updateSettings({ layouts: all });
    return true;
  },

  // Accent for a screen: the active house's colour when that screen is set to
  // follow the house, otherwise its own. Screens not listed in MODULE_THEMES
  // (their palettes are baked in) always get the house colour, which is what
  // the app did before this setting existed.
  getModuleTheme(moduleId) {
    const def = MODULE_THEMES[moduleId];
    if (!def) return { matchHouse: true, color: null, configurable: false };
    const saved = (store.getSettings().moduleThemes || {})[moduleId] || {};
    return {
      configurable: true,
      label: def.label,
      color: /^#[0-9a-f]{6}$/i.test(saved.color || '') ? saved.color : def.color,
      matchHouse: typeof saved.matchHouse === 'boolean' ? saved.matchHouse : def.matchHouse,
    };
  },

  setModuleTheme(moduleId, patch) {
    if (!MODULE_THEMES[moduleId]) return false;
    const all = { ...(store.getSettings().moduleThemes || {}) };
    const cur = store.getModuleTheme(moduleId);
    all[moduleId] = {
      color: /^#[0-9a-f]{6}$/i.test(patch.color || '') ? patch.color : cur.color,
      matchHouse: typeof patch.matchHouse === 'boolean' ? patch.matchHouse : cur.matchHouse,
    };
    store.updateSettings({ moduleThemes: all });
    return true;
  },

  resetModuleTheme(moduleId) {
    const def = MODULE_THEMES[moduleId];
    if (!def) return false;
    return store.setModuleTheme(moduleId, { color: def.color, matchHouse: def.matchHouse });
  },

  // ----- Die of Destiny prophecy table (teacher-editable in Admin) -----
  // Ranges (min/max), hasButton and mythic stay fixed — see the note on
  // defaultDiceProphecy() for why a roll can never land on a gap. Only points,
  // title, desc and emoji can change.

  getDiceProphecy() {
    return state.settings.diceProphecy || defaultDiceProphecy();
  },

  saveDiceOutcome(id, patch = {}) {
    const list = store.getDiceProphecy();
    const i = list.findIndex((o) => o.id === id);
    if (i < 0) return null;
    const o = list[i];
    // Clamped/validated HERE, not just in the Admin form — same MAX_DELTA
    // ceiling every points transaction respects, so a stray keystroke can
    // never save an outcome addPoints would silently cut down anyway.
    const next = {
      ...o,
      points: Number.isFinite(Number(patch.points)) ? Math.max(-MAX_DELTA, Math.min(MAX_DELTA, Math.round(Number(patch.points)))) : o.points,
      title: typeof patch.title === 'string' && patch.title.trim() ? patch.title.trim().slice(0, 40) : o.title,
      desc: typeof patch.desc === 'string' && patch.desc.trim() ? patch.desc.trim().slice(0, 140) : o.desc,
      emoji: typeof patch.emoji === 'string' && patch.emoji.trim() ? patch.emoji.trim().slice(0, 4) : o.emoji,
    };
    const updated = list.slice();
    updated[i] = next;
    state.settings.diceProphecy = updated;
    emit();
    return next;
  },

  resetDiceOutcome(id) {
    const def = defaultDiceProphecy().find((d) => d.id === id);
    if (!def) return false;
    return !!store.saveDiceOutcome(id, def);
  },

  // Icon for a quest's kind, falling back rather than rendering a blank.
  questType(q) { return QUEST_TYPES[q && q.type] || QUEST_TYPES[DEFAULT_QUEST_TYPE]; },
  // The mark shown on a quest card. Each quest carries its own so a board of
  // eight doesn't repeat three symbols; a quest without one (the teacher's own,
  // or an older backup) borrows its category's icon rather than showing a gap.
  questIcon(q) { return (q && q.icon) || store.questType(q).icon; },
  getState: () => state,
  subscribe(fn) { listeners.add(fn); return () => listeners.delete(fn); },

  // Runs `fn` with emit() suppressed, then emits (persist + notify) at most
  // once when the outermost batch finishes — see the comment on emit() above.
  // Use this around any loop of several store-mutating calls that together
  // form one teacher-visible action (e.g. syncing counter reciprocals across
  // a handful of shop items after one save).
  batch(fn) {
    batchDepth++;
    try {
      fn();
    } finally {
      batchDepth--;
      if (batchDepth === 0 && batchDirty) {
        batchDirty = false;
        emit();
      }
    }
  },

  setActiveCore(core) {
    state.activeCore = core === 'all' ? 'all' : Number(core);
    emit();
  },

  getActiveHouse() {
    return state.activeCore === 'all' ? null : HOUSES[state.activeCore] || null;
  },

  addPoints(houseId, delta, { reason = '', tag = '' } = {}) {
    delta = Math.max(-MAX_DELTA, Math.min(MAX_DELTA, Math.round(Number(delta) || 0)));
    if (!delta || !HOUSES[houseId]) return null;
    // A frozen house cannot EARN — that is the whole of the Legendary Ice Axe,
    // and it has to bite everywhere points are given or the item does nothing
    // between Battle Days. Losing points still works: being frozen is not
    // protection, and the teacher can always thaw a house in Admin.
    if (delta > 0 && store.isFrozen(houseId)) return null;
    // ZERO IS THE FLOOR. A 3d6 x100 hit rolls up to 1800, which can be more than
    // a house owns — the first live test put Atlantis on -245. "You lost
    // everything" is a story a class can take; "you are in debt" is a week of
    // being told you are worth less than nothing. A deduction is trimmed to
    // whatever is actually there, and the ledger records the TRIMMED amount so
    // the totals and the history can never disagree.
    if (delta < 0) {
      const held = store.getTotal(houseId, 'term');
      if (held + delta < 0) delta = -held;
      if (delta === 0) return null;
    }
    const tx = { id: `tx-${Date.now()}-${state.transactions.length}`, ts: Date.now(), houseId: Number(houseId), delta, reason, tag };
    state.transactions.push(tx);
    bumpLedger();
    emit();
    return tx;
  },

  // Why addPoints would refuse, in words a teacher can act on. addPoints returns
  // null for a write it declined, and every caller used to ignore that and play
  // the coin sound anyway — so a frozen house got a cheerful "+10" toast in
  // front of the class while nothing was written. This keeps the explanation in
  // one place, next to the rules it describes, so the two cannot drift.
  // Returns null when the write WILL go through.
  explainRefusal(houseId, delta) {
    delta = Math.round(Number(delta) || 0);
    const name = HOUSES[houseId]?.name || 'That house';
    if (!delta || !HOUSES[houseId]) return 'Nothing to award.';
    if (delta > 0 && store.isFrozen(houseId)) {
      const ts = store.frozenUntil(houseId);
      const until = ts ? new Date(ts).toLocaleDateString(undefined, { weekday: 'long', month: 'short', day: 'numeric' }) : '';
      return `❄️ ${name} is frozen${until ? ` until ${until}` : ''} and cannot earn points yet. Nothing was recorded.`;
    }
    if (delta < 0 && store.getTotal(houseId, 'term') <= 0) {
      return `${name} is already on zero — there is nothing left to take.`;
    }
    return null;
  },

  // Returns a NUMBER, so there is no aliasing risk in handing back a cached
  // value — this is the hot one, called for every house on nearly every render.
  getTotal(houseId, scope = 'term') {
    const since = scope === 'week' ? startOfWeek().getTime() : 0;
    return cached(`total|${Number(houseId)}|${since}`, () =>
      state.transactions.reduce((sum, t) => (t.houseId === Number(houseId) && t.ts >= since ? sum + t.delta : sum), 0));
  },

  // Deliberately NOT cached: it builds a fresh array of fresh objects that
  // callers sort and decorate, and handing out a shared array would let one
  // screen's edit surface in another. The expensive part is getTotal, which is
  // cached, so rebuilding this wrapper costs four lookups and a sort.
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
  // The single most expensive read in the app: weeks x houses full-array
  // reduces, 36 of them on a 9-week term, every time Records re-renders.
  // The term dates are in the KEY because the teacher can change them in Admin
  // without ever touching the ledger.
  //
  // Callers get a fresh array of fresh objects built from the cached numbers.
  // Copying 9 small objects is nothing against 36 passes over the ledger, and
  // it means a screen that decorates or sorts the result cannot corrupt what
  // the next screen reads.
  getWeeklySeries({ cumulative = false } = {}) {
    const s = store.getSettings();
    const start = new Date(s.termStart + 'T00:00:00').getTime();
    const weeks = Math.max(1, Number(s.termWeeks) || 9);
    const raw = cached(`series|${cumulative}|${start}|${weeks}`, () => {
      const running = {};
      const rows = [];
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
        rows.push({ week: w + 1, from, totals });
      }
      return rows;
    });
    return raw.map((r) => ({ week: r.week, from: new Date(r.from), totals: { ...r.totals } }));
  },

  // The Monday-morning recap (DESIGN-PLAN 7.1): biggest single award, the
  // most-improved house, and how many quests got finished — all scoped to
  // last week's calendar Mon-Sun window, not the current in-progress one.
  // "Most improved" is a genuine week-over-week comparison (this house's net
  // last week against its net the week before), the same idea getWeeklySeries
  // computes for the whole term — not just "who scored the most," which
  // would only repeat the standings the podium already shows every day.
  // Keyed on last week's Monday, same trick as getTotal's `since`: the
  // answer is wrong the instant the calendar rolls over a week, right up
  // until then it is exactly as cheap as everything else in this cache.
  getLastWeekRecap() {
    const weekStart = startOfWeek().getTime();      // this week's Monday, 00:00
    const lastStart = weekStart - 7 * 86400000;      // last week's Monday
    const prevStart = lastStart - 7 * 86400000;      // the week before that (improvement baseline)
    const raw = cached(`recap|${lastStart}`, () => {
      const netLast = {};
      const netPrev = {};
      let biggest = null;
      for (const t of state.transactions) {
        if (t.ts >= lastStart && t.ts < weekStart) {
          netLast[t.houseId] = (netLast[t.houseId] || 0) + t.delta;
          if (t.delta > 0 && (!biggest || t.delta > biggest.delta)) {
            biggest = { houseId: t.houseId, delta: t.delta, reason: t.reason || '' };
          }
        } else if (t.ts >= prevStart && t.ts < lastStart) {
          netPrev[t.houseId] = (netPrev[t.houseId] || 0) + t.delta;
        }
      }
      let mostImproved = null;
      for (const id of Object.keys(HOUSES)) {
        const delta = (netLast[id] || 0) - (netPrev[id] || 0);
        if (delta > 0 && (!mostImproved || delta > mostImproved.delta)) {
          mostImproved = { houseId: Number(id), delta };
        }
      }
      const questsCompleted = state.quests.completed
        .filter((c) => c.ts >= lastStart && c.ts < weekStart).length;
      return { biggestAward: biggest, mostImproved, questsCompleted };
    });
    // Copied out for the same reason getWeeklySeries copies its rows: the
    // cache hands back the identical object on every hit, and one caller's
    // edit must never leak into the next caller's read.
    return {
      biggestAward: raw.biggestAward ? { ...raw.biggestAward } : null,
      mostImproved: raw.mostImproved ? { ...raw.mostImproved } : null,
      questsCompleted: raw.questsCompleted,
    };
  },

  // Where a house's points actually came from, by tag.
  // Copied out on the way back for the same reason as getWeeklySeries: the
  // caller gets its own object to do as it likes with.
  getBreakdown(houseId, scope = 'term') {
    const since = scope === 'week' ? startOfWeek().getTime() : 0;
    const by = cached(`breakdown|${Number(houseId)}|${since}`, () => {
      const acc = {};
      for (const t of state.transactions) {
        if (t.houseId !== Number(houseId) || t.ts < since) continue;
        const key = t.tag || 'manual';
        acc[key] = acc[key] || { earned: 0, lost: 0, net: 0, count: 0 };
        if (t.delta >= 0) acc[key].earned += t.delta; else acc[key].lost += -t.delta;
        acc[key].net += t.delta;
        acc[key].count += 1;
      }
      return acc;
    });
    const out = {};
    for (const [k, v] of Object.entries(by)) out[k] = { ...v };
    return out;
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

  COMBAT_MODES,

  getCombatMode() {
    const m = state.settings.combatMode;
    return COMBAT_MODES[m] ? m : DEFAULT_COMBAT_MODE;
  },

  // Swaps the whole shop, not just a flag. The active catalog is parked under
  // the mode it belongs to and the incoming one is unparked, so a teacher's
  // edits to either survive any number of switches. Nothing is deleted and
  // nothing is merged — the two rule sets never see each other's items.
  //
  // Points, ledger, quests and everything else are deliberately untouched: the
  // ledger is the term's record and switching how combat works is not a reason
  // to rewrite it. Both catalogs are priced at the same scale so a house's
  // points mean the same thing either way.
  setCombatMode(mode) {
    const next = COMBAT_MODES[mode] ? mode : DEFAULT_COMBAT_MODE;
    const cur = store.getCombatMode();
    if (next === cur) return next;
    if (!state.shop.parked || typeof state.shop.parked !== 'object') state.shop.parked = {};
    state.shop.parked[cur] = state.shop.catalog;
    const incoming = state.shop.parked[next];
    state.shop.catalog = Array.isArray(incoming) && incoming.length
      ? incoming
      : (next === 'duel' ? defaultDuelCatalog() : defaultHpCatalog());
    state.shop.parked[next] = null;
    state.settings.combatMode = next;
    // A house's chosen items belong to the mode they were chosen in; carrying
    // them across would leave ids that the new catalog has never heard of.
    state.inventory = {};
    state.hp = {};
    // The in-flight battle state goes with them. Freezes, Shrouds, reveals and
    // the stored last strike are duel machinery; hit-points mode has no screen
    // that shows any of it, let alone lifts it — a house frozen at the moment
    // of the switch would stay refused by an invisible rule until the timer
    // ran out on its own. A mode switch is a clean slate, both directions.
    // (Copy follow-up: Admin's mode-switch confirm in admin.js should announce
    // this clearing alongside the inventory/HP reset it already mentions.)
    state.frozen = {};
    state.shrouded = {};
    state.revealed = {};
    state.lastStrike = {};
    emit();
    return next;
  },

  // ----- Mr. D's duel rules ---------------------------------------------------
  // Holdings ARE the inventory: a house buys an item and holds it until it is
  // used. The weekly limit is therefore a cap on what may be HELD, not a
  // separate booking system — which is also how he describes it, and means the
  // Magic Shop needs no new concept to enforce it.
  // ONE extra slot with the Bag of Holding, not one of each. His document says
  // "2 attack OR 2 defense items at the same time" — the choice is the point of
  // the item, and two of both would be a far stronger card at the same 500.
  // So: a second slot they may fill either way, capped at 2 of a type.
  // If he confirms he meant two of each, this is one line.
  duelSlotLimits(houseId) {
    const bag = store.countOwned(houseId, 'bagofholding') > 0;
    if (!bag) return { attack: 1, defense: 1, total: 2 };
    return { attack: 2, defense: 2, total: 3 };
  },

  duelHeld(houseId, slot) {
    const cat = state.shop.catalog;
    return store.getInventory(houseId)
      .filter(({ item }) => (cat.find((c) => c.id === item.id) || item).slot === slot)
      .reduce((n, { count }) => n + count, 0);
  },

  // Why a purchase is refused, in words the teacher can read out.
  duelCanBuy(houseId, itemId) {
    const item = state.shop.catalog.find((i) => i.id === itemId);
    if (!item) return { ok: false, reason: 'That item is not in the shop.' };
    const slot = item.slot || 'utility';
    if (slot === 'utility') return { ok: true, reason: '' };
    const limits = store.duelSlotLimits(houseId);
    const held = store.duelHeld(houseId, slot);
    const heldTotal = store.duelHeld(houseId, 'attack') + store.duelHeld(houseId, 'defense');
    if (held >= limits[slot]) {
      return { ok: false, reason: limits[slot] === 1
        ? `Only one ${slot} item at a time — use or drop the one they already hold. The Bag of Holding adds a slot.`
        : `That is both ${slot} slots full.` };
    }
    // The Bag gives ONE extra slot, not one of each — so a house already holding
    // two attacks cannot also hold two defenses.
    if (heldTotal >= limits.total) {
      return { ok: false, reason: 'That is every slot full. Use something, or drop an item, before buying another.' };
    }
    return { ok: true, reason: '' };
  },

  // "2d6" -> { n: 2, sides: 6 }. Anything unparseable falls back to one d6 so a
  // mistyped item can never throw in front of a class.
  parseDice(spec) {
    const m = /^\s*(\d+)\s*d\s*(\d+)\s*$/i.exec(String(spec || ''));
    return m ? { n: Math.max(1, +m[1]), sides: Math.max(2, +m[2]) } : { n: 1, sides: 6 };
  },

  // What WOULD happen, without touching anything. The screen shows this before
  // any dice are rolled, so the class can see the counter land (or not) first.
  previewDuelAttack(attackerId, targetId, itemId) {
    const cat = state.shop.catalog;
    const item = cat.find((i) => i.id === itemId);
    if (!item) return { ok: false, reason: 'Unknown item.' };
    if (Number(attackerId) === Number(targetId)) return { ok: false, reason: 'A house cannot attack itself.' };
    if (store.isFrozen(attackerId)) {
      return { ok: false, reason: `${HOUSES[attackerId]?.name || 'That house'} is frozen and cannot attack.` };
    }
    // The punching-down rule. canAttack is where duelPunchDown lives, and duel
    // mode never used to consult it — the Admin toggle was a switch wired to
    // nothing. Gating the PREVIEW gates everything: applyDuelAttack re-runs
    // this preview and passes any refusal straight through, so a forbidden
    // strike can neither be shown nor landed.
    const rule = store.canAttack(Number(attackerId), Number(targetId));
    if (!rule.ok) return { ok: false, reason: rule.reason, ruleRefusal: true };
    // The defender's held defense — hidden until this moment, by design.
    const defense = store.getInventory(targetId)
      .map(({ item: it }) => cat.find((c) => c.id === it.id) || it)
      .find((it) => (it.slot === 'defense') && Array.isArray(it.blocks) && it.blocks.includes(item.id));
    const anyDefense = store.getInventory(targetId)
      .map(({ item: it }) => cat.find((c) => c.id === it.id) || it)
      .find((it) => it.slot === 'defense');
    return {
      ok: true, item,
      defenseHeld: anyDefense || null,
      blocked: !!defense,
      blockedBy: defense || null,
      dice: item.effect?.dice || null,
      mult: item.effect?.mult || 1,
      targets: item.effect?.targets || 1,
      steals: item.effect?.kind === 'steal',
      freezes: item.effect?.kind === 'freeze',
    };
  },

  // Applies a result the teacher has already SEEN on the dice. The roll is not
  // done here on purpose: the tray on screen is the real roll, and the number
  // the class watched land is the number that must be applied.
  // `consume` exists for multi-target items (the Catapult): the weapon is spent
  // once, but resolution runs once PER HOUSE so each defender gets its own block
  // check and its own moment on screen. The second call passes consume:false.
  applyDuelAttack({ attackerId, targetId, itemId, rolled, consume = true }) {
    const pv = store.previewDuelAttack(attackerId, targetId, itemId);
    if (!pv.ok) return pv;
    const item = pv.item;
    const attacker = HOUSES[attackerId], target = HOUSES[targetId];
    const out = { ok: true, blocked: pv.blocked, item, damage: 0, stolen: 0, frozenDays: 0 };

    // The attack is spent either way — that is what makes a correct guess hurt.
    if (consume) store.consumeFromInventory(attackerId, itemId);
    if (pv.blocked) {
      store.consumeFromInventory(targetId, pv.blockedBy.id);
      out.blockedBy = pv.blockedBy;
      emit();
      return out;
    }

    if (pv.freezes) {
      const days = Math.max(1, Math.round(Number(rolled) || 1));
      store.freezeHouse(targetId, days);
      out.frozenDays = days;
      store.recordStrike(targetId, { attackerId, itemId, itemName: item.name, txIds: [], froze: true });
      emit();
      return out;
    }

    const total = Math.max(0, Math.round(Number(rolled) || 0)) * (item.effect?.mult || 1);
    // Report what LANDED, not what was rolled. addPoints trims a deduction at
    // the zero floor and hands back the trimmed transaction, so a 1200-point
    // hit on a house holding 600 takes 600 — and the number on screen has to
    // say 600 too, or the crest tally and the falling total disagree in front
    // of the class.
    const hit = store.addPoints(targetId, -total, {
      reason: `${item.name}${item.effect?.anonymous ? '' : ` from ${attacker?.name || 'a house'}`}`,
      tag: 'attack',
    });
    out.damage = hit ? Math.abs(hit.delta) : 0;
    out.rolledFor = total;   // what it would have taken, for the ledger-curious
    const txIds = hit ? [hit.id] : [];
    if (pv.steals) {
      // You cannot loot more than they had. Stealing the rolled amount rather
      // than the amount actually taken would mint points out of nothing every
      // time a poor house got hit.
      const got = store.addPoints(attackerId, out.damage, { reason: `${item.name} on ${target?.name || 'a house'}`, tag: 'attack' });
      out.stolen = got ? got.delta : 0;
      if (got) txIds.push(got.id);
    }
    store.recordStrike(targetId, { attackerId, itemId, itemName: item.name, txIds, froze: false });
    emit();
    return out;
  },

  // ----- freeze (Legendary Ice Axe) -------------------------------------------
  // Stored as an expiry DATE rather than a countdown, so it survives reloads and
  // does not need anything ticking.
  //
  // Counted in SCHOOL days, skipping weekends. "Frozen for 3 days" rolled on a
  // Thursday has to mean three days he actually teaches, or a weekend eats most
  // of the punishment and the item feels broken to the class that spent 500 on
  // it. If he says he meant plain calendar days, delete the weekend skip.
  freezeHouse(houseId, days) {
    if (!state.frozen || typeof state.frozen !== 'object') state.frozen = {};
    const until = walkSchoolDays(Date.now(), { steps: Math.max(1, Math.round(days)) });
    // A second Axe landing on an already-frozen house can only EXTEND the
    // sentence. Recomputing from today would let a fresh 1-day roll quietly
    // thaw a house still serving five — the class that paid for the long
    // freeze would watch it evaporate.
    const current = Number(state.frozen[houseId]) || 0;
    state.frozen[houseId] = Math.max(current, until);
    emit();
  },
  // ----- the three information items -------------------------------------------
  // None of these had a mechanism, because the doc describes what they DO
  // without saying when. In his sequence the only hidden thing is the defense a
  // house is holding, so that is what they act on — it is the one reading where
  // paying 1000 for the Stone makes sense.

  // Stone of Seeing: look at what a house is holding. Spent on use.
  peekHouse(viewerId, targetId) {
    if (store.countOwned(viewerId, 'stone') < 1) {
      return { ok: false, reason: 'That house does not have a Stone of Seeing.' };
    }
    // THE SHROUD FIRES BY ITSELF. The same four houses are played by every
    // class period, so first, second and third period can all send a Stone at
    // fourth period's house before fourth period has even walked in the room.
    // A Shroud that had to be raised by hand could never protect them — they
    // would be looked at while they were in another lesson. So a held Shroud
    // goes up the moment the first Stone is aimed at that house, on its own,
    // and then covers every Stone that follows for as long as it lasts. Only
    // one Shroud is ever spent, however many houses come looking.
    let auto = false;
    if (!store.isShrouded(targetId) && store.countOwned(targetId, 'shroud') > 0) {
      store.raiseShroud(targetId);
      auto = true;
    }
    if (store.isShrouded(targetId)) {
      store.consumeFromInventory(viewerId, 'stone');
      emit();
      const who = HOUSES[targetId]?.name || 'That house';
      return { ok: true, shrouded: true, autoRaised: auto, items: [],
        reason: auto
          ? `🌫️ ${who}'s Shroud of Secrecy went up by itself! The Stone shows nothing — and it is still used up.`
          : `${who} is under a Shroud of Secrecy — the Stone shows nothing. It is still used up.` };
    }
    store.consumeFromInventory(viewerId, 'stone');
    // Remembered, not just returned. Every screen re-renders on any store
    // change, so a reveal held only in the caller's variable would vanish the
    // moment anything else happened — mid-lesson, in front of the class, after
    // they spent 1000 points on it. It stays revealed until Battle Day ends.
    if (!state.revealed || typeof state.revealed !== 'object') state.revealed = {};
    if (!state.revealed[viewerId]) state.revealed[viewerId] = {};
    state.revealed[viewerId][targetId] = Date.now();
    const items = store.getInventory(targetId).map(({ item, count }) => ({ name: item.name, slot: item.slot, count }));
    emit();
    return { ok: true, shrouded: false, items, reason: '' };
  },

  // Has this house already looked at that one? Drives whether the defender's
  // held item is shown face-up on the board.
  hasRevealed(viewerId, targetId) {
    return !!((state.revealed || {})[viewerId] || {})[targetId];
  },
  // Cleared when Battle Day ends, so next week's holdings are secret again.
  // This is the store side of the Battle-Day teardown (battle.js endBattle
  // calls it), so it also retires lastStrike: the Time Turner undoes the
  // strike that JUST happened, and once the session is over there is no
  // "just" left to undo. canTimeTurn's same-day check backstops the case
  // where the app is closed without ever ending the battle.
  clearReveals() { state.revealed = {}; state.lastStrike = {}; emit(); },

  // The narrower teardown, for callers that want to retire the undo window
  // without touching the reveals (e.g. an Admin correction tool).
  clearLastStrike() { state.lastStrike = {}; emit(); },

  // Shroud of Secrecy: one week of immunity from the Stone. Spent on use.
  raiseShroud(houseId) {
    if (store.countOwned(houseId, 'shroud') < 1) return { ok: false, reason: 'That house does not have a Shroud of Secrecy.' };
    if (!state.shrouded || typeof state.shrouded !== 'object') state.shrouded = {};
    state.shrouded[houseId] = Date.now() + 7 * 86400000;
    store.consumeFromInventory(houseId, 'shroud');
    emit();
    return { ok: true, until: state.shrouded[houseId] };
  },
  isShrouded(houseId) { return (((state.shrouded || {})[houseId]) || 0) > Date.now(); },
  shroudedUntil(houseId) { return (((state.shrouded || {})[houseId]) || 0); },
  lowerShroud(houseId) {
    if (state.shrouded && state.shrouded[houseId]) { delete state.shrouded[houseId]; emit(); return true; }
    return false;
  },

  // Time Turner: "go back and change your items after you have been attacked."
  // With only one defense held there is nothing to swap TO, so in practice it
  // is a second chance — it takes back the attack that just got through.
  //
  // The undo works by DELETING the ledger entries the strike wrote, rather than
  // awarding compensating points. That matters twice over: the history reads as
  // though the strike never happened (no confusing "+700 Time Turner" line for
  // a class to argue about), and it still works on a house that has since been
  // frozen, which a positive award would not. The one exception: loot the
  // attacker has already SPENT cannot be deleted without driving their total
  // negative, so that case falls back to an honest compensating deduction —
  // see useTimeTurner.
  //
  // Kept per house, because the Catapult hits two and either may want to undo.
  recordStrike(houseId, info) {
    if (!state.lastStrike || typeof state.lastStrike !== 'object') state.lastStrike = {};
    state.lastStrike[houseId] = { ...info, ts: Date.now() };
  },
  lastStrikeOn(houseId) { return (state.lastStrike || {})[houseId] || null; },

  canTimeTurn(houseId) {
    if (store.countOwned(houseId, 'timeturner') < 1) {
      return { ok: false, reason: 'That house does not have a Time Turner.' };
    }
    const last = store.lastStrikeOn(houseId);
    if (!last) {
      return { ok: false, reason: 'Nothing has hit that house yet — there is nothing to take back.' };
    }
    // A strike that took NOTHING (fully trimmed at the zero floor, or a steal
    // on an empty house) leaves nothing to take back — but the Turner was
    // still offered, and consumed, for undoing it. A 1500-point item spent on
    // undoing zero is the kind of deal a class remembers. Require the strike
    // to have actually written something, or frozen someone.
    if (!((last.txIds || []).length || last.froze)) {
      return { ok: false, reason: 'That strike took nothing — there is nothing to take back.' };
    }
    // And it has to be TODAY's strike. lastStrike is persisted with the rest
    // of the state, so without this check next week's class could turn back
    // last week's battle — long after the teacher has moved on and the totals
    // have been read out. The Turner rewinds the moment, not the term.
    // (recordStrike stamps ts; a strike without one predates the stamp and is
    // by definition stale.)
    if (!last.ts || ymd(new Date(last.ts)) !== todayStr()) {
      return { ok: false, reason: 'That strike is from a past Battle Day — the moment to turn back time has gone.' };
    }
    return { ok: true, strike: last };
  },
  useTimeTurner(houseId) {
    const gate = store.canTimeTurn(houseId);
    if (!gate.ok) return gate;
    const last = gate.strike;
    let restored = 0;
    for (const id of last.txIds || []) {
      const tx = state.transactions.find((t) => t.id === id);
      if (!tx) continue;   // already gone (teacher corrected it by hand) — nothing to undo
      const removed = store.removeTransaction(id);
      if (removed) {
        if (tx.houseId === Number(houseId)) restored += Math.abs(tx.delta);
        continue;
      }
      // The removal was refused: this is the attacker's loot credit, and they
      // have already SPENT it. Deleting it anyway is what used to happen, and
      // it drove their total negative — the one number this ledger promises
      // can never exist. So instead of rewriting history, the ledger records
      // what actually happens: a deduction, trimmed at zero by addPoints like
      // every other deduction. The Time Turner still takes the loot back; it
      // just takes it from what the attacker has LEFT, honestly, on the record.
      if (tx.delta > 0) {
        store.addPoints(tx.houseId, -tx.delta, {
          reason: `Time Turner: ${last.itemName || 'attack'} undone`,
          tag: 'attack',
        });
      }
    }
    if (last.froze) store.thawHouse(houseId);
    store.consumeFromInventory(houseId, 'timeturner');
    if (state.lastStrike) delete state.lastStrike[houseId];
    emit();
    return { ok: true, restored, unfroze: !!last.froze, itemName: last.itemName || 'that attack' };
  },

  isFrozen(houseId) { return (((state.frozen || {})[houseId]) || 0) > Date.now(); },
  frozenUntil(houseId) { return ((state.frozen || {})[houseId]) || 0; },
  thawHouse(houseId) {
    if (state.frozen && state.frozen[houseId]) { delete state.frozen[houseId]; emit(); return true; }
    return false;
  },

  // Owner-requested (7.5): everything Battle Day already enforces is invisible
  // everywhere else. This is the one place a UI asks "is this house frozen,
  // and how do I say so in a classroom-friendly way" — a badge/tint renderer
  // that throws or finds this missing should fail soft to today's plain look
  // (see dashboard/council/houses/battle), never crash the screen.
  //
  // schoolDaysLeft reuses walkSchoolDays in COUNT mode so the countdown can
  // never disagree with the school-day math freezeHouse used to set `until`
  // in the first place — one implementation, read both directions.
  getFreezeInfo(houseId) {
    const until = store.frozenUntil(houseId);
    const now = Date.now();
    if (!until || until <= now) {
      return { frozen: false, until: null, schoolDaysLeft: 0, label: '' };
    }
    const today = new Date(now); today.setHours(0, 0, 0, 0);
    const untilDay = new Date(until); untilDay.setHours(0, 0, 0, 0);
    // Expiry lands later TODAY (e.g. a same-day admin thaw time) — no day to count.
    if (untilDay.getTime() === today.getTime()) {
      return { frozen: true, until, schoolDaysLeft: 0, label: 'thaws today' };
    }
    const schoolDaysLeft = walkSchoolDays(today.getTime(), { untilMs: untilDay.getTime() });
    const tomorrow = new Date(today); tomorrow.setDate(tomorrow.getDate() + 1);
    let label;
    if (untilDay.getTime() === tomorrow.getTime()) {
      label = 'thaws tomorrow';
    } else if (schoolDaysLeft === 1) {
      // Only one school day stands between now and thaw, but a weekend sits
      // in the way — name the day instead of saying "1 school day".
      const WEEKDAY_NAMES = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
      label = `thaws ${WEEKDAY_NAMES[untilDay.getDay()]}`;
    } else {
      label = `thaws in ${schoolDaysLeft} school days`;
    }
    return { frozen: true, until, schoolDaysLeft, label };
  },

  getShopItems() {
    return state.shop.catalog;
  },

  // Kinds the combat engine actually implements. Anything else is rejected so
  // the Admin form can never save an item the app won't honour.
  SHOP_KINDS: ['attack', 'steal', 'shield', 'pierce', 'reduce', 'wild'],
  // Mr. D's rules use their own verbs. 'damage' and 'steal' roll dice, 'freeze'
  // stops a house scoring, 'block' is a defense, and the rest are utilities.
  DUEL_KINDS: ['damage', 'steal', 'freeze', 'block', 'reveal', 'hide', 'timeturn', 'extraslot'],

  shopKindsForMode(mode) {
    return (mode || store.getCombatMode()) === 'duel' ? store.DUEL_KINDS : store.SHOP_KINDS;
  },

  // NOTE: this rebuilds the item field by field, so ANY field not named here is
  // silently dropped on save — the same trap saveQuest() has. That is why the
  // duel fields are listed explicitly: an edit to the Sword of Destiny would
  // otherwise come back with no dice, no slot and no counter, and the whole
  // rock-paper-scissors layer would quietly stop working.
  saveShopItem(item) {
    const kind = item?.effect?.kind;
    const mode = store.getCombatMode();
    if (!item?.name || !store.shopKindsForMode(mode).includes(kind)) return null;
    const mythicOnly = !!item.mythicOnly;
    // Mythic relics are granted by a natural 20, never bought — force cost 0.
    // Everything else needs a real price.
    const cost = mythicOnly ? 0 : Math.round(Number(item.cost) || 0);
    if (!mythicOnly && !(cost > 0)) return null;
    const it = {
      id: item.id || `si-${Date.now()}`,
      name: item.name, desc: item.desc || '', emoji: item.emoji || '✨', image: item.image || '',
      cost, mythicOnly,
      effect: { kind },
    };
    if (mode === 'duel') {
      const e = item.effect || {};
      if (e.dice) it.effect.dice = String(e.dice).trim();
      if (Number.isFinite(Number(e.mult))) it.effect.mult = Math.max(1, Math.round(Number(e.mult)));
      if (Number.isFinite(Number(e.targets))) it.effect.targets = Math.max(1, Math.round(Number(e.targets)));
      if (e.anonymous) it.effect.anonymous = true;
      it.slot = ['attack', 'defense', 'utility'].includes(item.slot) ? item.slot : 'utility';
      if (Array.isArray(item.counteredBy)) it.counteredBy = item.counteredBy.slice();
      if (Array.isArray(item.blocks)) it.blocks = item.blocks.slice();
    } else {
      it.effect.amount = Math.max(1, Math.round(Number(item.effect.amount) || 1));
    }
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
    const intended = (reduced && !pierce) ? Math.max(1, Math.round(dmg / 2)) : dmg;
    const fromName = fromId && HOUSES[fromId] ? ` from ${HOUSES[fromId].name}` : '';
    // `applied` is what the LEDGER took, not what the attack asked for.
    // addPoints trims a deduction at the zero floor (and returns null when
    // there was nothing to take at all), and returning the untrimmed number
    // here let a steal credit the attacker with points the defender never
    // had — minted from nothing. Same rule applyDuelAttack already follows:
    // the number reported is the number written.
    const tx = store.addPoints(toId, -intended, { reason: `${label}${fromName}`, tag: 'attack' });
    return {
      outcome: pierce && (shielded || reduced) ? 'pierced' : (reduced ? 'reduced' : 'full'),
      applied: tx ? Math.abs(tx.delta) : 0,
      intended,                              // pre-trim, for the ledger-curious
      shielded, reduced, blocked: dmg - intended,
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

  // ----- Trivia Tuesday -----

  getTriviaQuestions() { return state.trivia.questions.slice(); },

  // Create or update. Editing keeps the asked-record — rewording a question
  // must not let a core that already answered it answer again. `askOn` is the
  // optional scheduled date (a Tuesday, usually): the question stays sealed on
  // the stage until that day arrives, so the whole term can be loaded up
  // front and forgotten about.
  saveTriviaQuestion(input) {
    const q = String(input?.q || '').trim();
    const a = String(input?.a || '').trim();
    if (!q || !a) return null;
    const points = Number(input?.points) > 0 ? Math.round(Number(input.points)) : 100;
    const askOn = /^\d{4}-\d{2}-\d{2}$/.test(String(input?.askOn || '')) ? String(input.askOn) : '';
    const list = state.trivia.questions;
    const i = input.id ? list.findIndex((x) => x.id === input.id) : -1;
    const row = { id: input.id || `tq-${Date.now()}`, q, a, points, askOn, asked: i >= 0 ? (list[i].asked || {}) : {} };
    if (i >= 0) list[i] = row; else list.push(row);
    emit();
    return row;
  },

  deleteTriviaQuestion(id) {
    const before = state.trivia.questions.length;
    state.trivia.questions = state.trivia.questions.filter((x) => x.id !== id);
    if (state.trivia.questions.length !== before) emit();
  },

  moveTriviaQuestion(id, dir) {
    const list = state.trivia.questions;
    const i = list.findIndex((x) => x.id === id);
    const j = i + (dir < 0 ? -1 : 1);
    if (i < 0 || j < 0 || j >= list.length) return;
    [list[i], list[j]] = [list[j], list[i]];
    emit();
  },

  // Clears every core's answer so the question can be asked again.
  resetTriviaQuestion(id) {
    const row = state.trivia.questions.find((x) => x.id === id);
    if (!row || !Object.keys(row.asked || {}).length) return;
    row.asked = {};
    emit();
  },

  // "This week's question" for a core: the earliest SCHEDULED question whose
  // day has arrived and this core hasn't answered (so a missed week is asked
  // late, not lost) — then, if none, the first UNDATED question in list
  // order. A question dated in the future stays sealed for everyone.
  nextTriviaFor(coreId) {
    const today = todayStr();
    const due = state.trivia.questions
      .filter((x) => x.askOn && x.askOn <= today && !(x.asked || {})[coreId])
      .sort((a, b) => (a.askOn < b.askOn ? -1 : a.askOn > b.askOn ? 1 : 0));
    if (due.length) return due[0];
    return state.trivia.questions.find((x) => !x.askOn && !(x.asked || {})[coreId]) || null;
  },

  // The next sealed-for-now question (earliest future date this core hasn't
  // answered), so the stage can say WHEN it opens instead of "pool empty".
  triviaUpcoming(coreId) {
    const today = todayStr();
    return state.trivia.questions
      .filter((x) => x.askOn && x.askOn > today && !(x.asked || {})[coreId])
      .sort((a, b) => (a.askOn < b.askOn ? -1 : a.askOn > b.askOn ? 1 : 0))[0] || null;
  },

  triviaProgress(coreId) {
    const total = state.trivia.questions.length;
    const answered = state.trivia.questions.filter((x) => (x.asked || {})[coreId]).length;
    return { answered, total };
  },

  // One verdict per core per question: right pays the question's points
  // (respecting freezes/shields exactly like every teacher award — this IS
  // one), wrong pays nothing, and either way the record makes the pool
  // advance. Returns { ok, tx } or a refusal reason.
  recordTrivia(coreId, questionId, won) {
    const house = HOUSES[coreId];
    const row = state.trivia.questions.find((x) => x.id === questionId);
    if (!house || !row) return { ok: false, reason: 'Unknown house or question.' };
    if ((row.asked || {})[coreId]) return { ok: false, reason: 'This core already answered that question.' };
    row.asked = row.asked || {};
    row.asked[coreId] = { won: !!won, ts: Date.now() };
    let tx = null;
    if (won) {
      const snippet = row.q.length > 60 ? `${row.q.slice(0, 57)}…` : row.q;
      tx = store.addPoints(coreId, row.points, { reason: `Trivia Tuesday — ${snippet}`, tag: 'manual' });
    }
    emit();
    return { ok: true, tx };
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

  FLYOVER_TRACK_KEY,

  // The music under Place of the Week's 3D flight. One track for every
  // destination — it used to be chosen per place inside the POTW editor, which
  // meant the answer to "where do I change the music?" depended on which music
  // you meant. Blank (the normal case) means the track that ships with the app.
  // The entry takes either shape the ambient map allows: 'music/x.mp3' or
  // { src, volume } — the per-screen volume is meaningless here, because the
  // flight plays its music at full volume, so only the src is read.
  getFlyoverTrack() {
    const raw = (store.getAmbient().tracks || {})[FLYOVER_TRACK_KEY];
    // Muted is a choice, not an absence — it must NOT fall through to the
    // bundled default track, or muting the flyover would do nothing.
    if (raw && typeof raw === 'object' && raw.muted) return '';
    const src = raw && typeof raw === 'object' ? raw.src : raw;
    return typeof src === 'string' && src.trim()
      ? src.trim()
      : (CONFIG.POTW_FLYOVER_DEFAULT || '');
  },

  // ----- houses (teacher-editable: names, mottos, colours, artwork) -----

  updateHouse(id, patch = {}) {
    if (!HOUSES[id] || !patch) return null;
    const clean = {};
    for (const key of ['name', 'motto', 'accent', 'image', 'heroImage']) {
      if (typeof patch[key] === 'string' && patch[key].trim()) clean[key] = patch[key].trim();
    }
    // The same rules applyHouseOverrides enforces at render time, enforced at
    // SAVE time too — a value that would only be dropped later has no business
    // being persisted at all, and dropping it here means the teacher sees the
    // edit not take rather than wondering why it vanished on the next reload.
    if (clean.accent) {
      // colour inputs hand back "#aabbcc", but a hand-typed "aabbcc" is an
      // obvious intent — normalise it rather than refuse it
      if (/^[0-9a-f]{6}$/i.test(clean.accent)) clean.accent = `#${clean.accent}`;
      if (!HOUSE_ACCENT_RE.test(clean.accent)) delete clean.accent;
    }
    for (const key of ['image', 'heroImage']) {
      if (clean[key] && !safeHouseImage(clean[key])) delete clean[key];
    }
    if (clean.accent) {
      // keep the soft glow colour in step with the accent
      const m = /^#([a-f\d]{2})([a-f\d]{2})([a-f\d]{2})$/i.exec(clean.accent);
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

  // ZERO IS THE FLOOR — on deletes too. addPoints trims every write so a
  // total can never go below zero, but deleting a past "+300" from a house
  // that has since spent those points used to sneak the total negative
  // through the back door. The guard mirrors the write-side rule: refuse
  // any removal that would leave the house's term total below zero.
  //
  // Returns the removed transaction (truthy) on success, false on refusal
  // or unknown id — same truthiness as the old true/false contract, so
  // existing callers keep working. explainRemoveRefusal() below says WHY
  // in words, for the UI that wants to toast the refusal.
  removeTransaction(id) {
    const i = state.transactions.findIndex((t) => t.id === id);
    if (i < 0) return false;
    const tx = state.transactions[i];
    if (tx.delta > 0 && store.getTotal(tx.houseId, 'term') - tx.delta < 0) return false;
    state.transactions.splice(i, 1);
    bumpLedger();
    emit();
    return tx;
  },

  // Why removeTransaction would refuse, in words a teacher can act on —
  // same pattern as explainRefusal for writes. Returns null when the
  // removal WILL go through.
  explainRemoveRefusal(id) {
    const tx = state.transactions.find((t) => t.id === id);
    if (!tx) return 'That ledger entry no longer exists.';
    if (tx.delta > 0 && store.getTotal(tx.houseId, 'term') - tx.delta < 0) {
      const name = HOUSES[tx.houseId]?.name || 'That house';
      return `${name} has already spent those points — removing this +${tx.delta} would put them below zero. Nothing was removed.`;
    }
    return null;
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

  // Projector-safe quiet mode (FIX-PLAN 5.5): one switch for a test day or
  // quiet work, instead of hunting through Settings for the sound toggle and
  // hoping seasonal particles were off too. Kept to these two calls on
  // purpose — Admin's Settings row for it is a later wave's job, and it only
  // ever needs to read and flip this one flag.
  getQuietMode() { return !!store.getSettings().quietMode; },

  // audio.js only ever reads `settings.soundEnabled` (shell.js's
  // applySoundGate wraps the shared audio singleton around exactly that flag
  // — see the comment there), so muting quiet mode's SFX means writing the
  // same switch the M key and the speaker button already flip, not inventing
  // a second one they'd have to agree with. Turning quiet mode back OFF does
  // NOT auto-restore sound: silencing the room was a deliberate act, and so
  // is un-silencing it — one tap of M, not something this toggle should
  // assume on the teacher's behalf.
  setQuietMode(on) {
    const quiet = !!on;
    const patch = { quietMode: quiet };
    if (quiet) patch.soundEnabled = false;
    store.updateSettings(patch);
  },

  getTermInfo() {
    const s = store.getSettings();
    // A hand-edited or half-cleared termStart must not put "Week NaN of 9" in
    // the top bar. Same shape either way — week and totalWeeks stay honest
    // numbers so the shell's "Week X of Y" renders sanely, the label carries
    // the fix for the screens that print it, and `invalid` is there for any
    // caller that wants to say more.
    const totalWeeks = Number(s.termWeeks) > 0
      ? Math.round(Number(s.termWeeks))
      : CONFIG.TERM.totalWeeks;
    const start = new Date(s.termStart + 'T00:00:00');
    if (Number.isNaN(start.getTime())) {
      return { week: 1, totalWeeks, label: 'Set term dates in Admin', invalid: true };
    }
    const week = Math.min(totalWeeks, Math.max(1, Math.floor((Date.now() - start.getTime()) / (7 * 86400000)) + 1));
    return { week, totalWeeks, label: `Week ${week} of ${totalWeeks}-Week Term`, invalid: false };
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

  // `sample: true` means nobody has built a real plan yet and this is the
  // hardcoded example data the app ships with — "Bell Ringer: Map of the
  // Fertile Crescent" was reading as today's ACTUAL plan on a fresh install,
  // fiction presented to the class as fact. The plain getters below still
  // return just the items, for the one caller (this file's own delegation)
  // that only ever wanted the list; dashboard.js uses the Info form so it can
  // caption the sample.
  getItineraryInfo(core = state.activeCore, date = todayStr()) {
    if (core === 'all') return { items: [], sample: false };
    const planned = store.getEventsOn(date, core).find((e) => e.type === 'itinerary' && Array.isArray(e.items));
    if (planned) return { items: planned.items, sample: false };
    return { items: state.itineraries[core] || [], sample: true };
  },

  getItinerary(core = state.activeCore, date = todayStr()) {
    return store.getItineraryInfo(core, date).items;
  },

  getHomeworkInfo(core = state.activeCore, date = todayStr()) {
    if (core === 'all') return { items: [], sample: false };
    const upcoming = store.getEvents({ from: date, core })
      .filter((e) => ['homework', 'test', 'quiz'].includes(e.type))
      .slice(0, 6)
      .map((e) => ({ due: fmtDue(e.date), text: e.title || e.type }));
    if (upcoming.length) return { items: upcoming, sample: false };
    return { items: state.homework[core] || [], sample: true };
  },

  getHomework(core = state.activeCore, date = todayStr()) {
    return store.getHomeworkInfo(core, date).items;
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
      // Kind of task, which drives filtering and the fallback icon. This object
      // is REBUILT field by field, so anything not named here is dropped on
      // save — type and icon have to be listed or the teacher's choices
      // silently revert.
      type: QUEST_TYPES[quest.type] ? quest.type : DEFAULT_QUEST_TYPE,
      // Blank is meaningful: it means "just use the category icon".
      icon: typeof quest.icon === 'string' ? quest.icon.trim().slice(0, 8) : '',
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
    // The configured penalty and the deduction that lands are two different
    // numbers: addPoints trims at the zero floor, and on a house already at
    // zero it declines entirely (returning null WITHOUT emitting — which is
    // also why the emit below must run whenever there is no tx, or the
    // quest's return to the board would never persist). Callers announce the
    // deduction to the class, so they get appliedPenalty — what was actually
    // written — alongside the configured number they already read.
    const tx = penalty > 0
      ? store.addPoints(core, -penalty, { reason: `Quest abandoned: ${quest.title}`, tag: 'quest' })
      : null;
    if (!tx) emit();
    return { quest, penalty, appliedPenalty: tx ? Math.abs(tx.delta) : 0 };
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
  // `opts.note` is an optional one-line "how was it proven?" (DESIGN-PLAN
  // 7.4) — folded straight into the ledger reason rather than given its own
  // field, because the reason is already free text and Records search
  // already searches it. Callers own escaping it at render time, same as
  // every other free-text reason in this ledger.
  completeQuest(core, opts = {}) {
    const quest = store.getActiveQuest(core);
    if (!quest) return null;
    delete state.quests.active[core];
    state.quests.completed.push({ id: `qc-${Date.now()}`, questId: quest.id, title: quest.title, core: Number(core), ts: Date.now(), points: quest.points });
    // The quest is archived either way — it WAS completed. But whether the
    // points landed is a separate question: a frozen house cannot earn, and
    // addPoints declines silently. Callers need to know so they can say so
    // instead of cheering a payout that never happened.
    const why = store.explainRefusal(core, quest.points);
    const note = typeof opts.note === 'string' ? opts.note.trim().slice(0, 80) : '';
    const reason = `Quest complete: ${quest.title}${note ? ` — proof: ${note}` : ''}`;
    const tx = why ? null : store.addPoints(core, quest.points, { reason, tag: 'quest' });
    return { ...quest, paid: !!tx, paidPoints: tx ? tx.delta : 0, unpaidReason: tx ? '' : (why || '') };
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

  // A paid bounty is remembered per profile PER WEEK, so relaunching the same
  // voyage in the same lesson can't pay twice, but next week's class gets a
  // fresh set of bounties.
  //
  // A blank weekOf used to collapse to the literal string 'nodate', which meant
  // every week shared one bucket: pay a bounty once and that question was dead
  // for the rest of the term, with nothing in the UI to explain why. The
  // shipped Mesopotamia profile has weekOf:'' — so this hit the default
  // profile. Falling back to the CURRENT week's Monday keeps the intended
  // weekly reset for profiles the teacher hasn't scheduled to a date.
  bountyKey(profileKey, index) {
    const p = state.potw.profiles[profileKey];
    const week = p?.weekOf || ymd(startOfWeek());
    return `${profileKey}|${week}|${index}`;
  },

  isBountyPaid(profileKey, index) {
    return !!state.potwBounties[store.bountyKey(profileKey, index)];
  },

  getPaidBounty(profileKey, index) {
    return state.potwBounties[store.bountyKey(profileKey, index)] || null;
  },

  // Two shapes for one action, on purpose. payBounty keeps the legacy
  // truthiness contract — the paying tx (truthy) on success, false otherwise —
  // because potw.js truthiness-checks the return and an always-truthy result
  // object would have silently made every refusal look like a payment.
  // payBountyChecked is the honest version: it distinguishes "this bounty was
  // already claimed" (lock the buttons, the question is done) from "addPoints
  // refused" (the house is frozen — toast it, leave the buttons live, let the
  // teacher pick another winner). potw.js adopts it next wave; until then both
  // routes share one implementation so they can never disagree.
  payBounty(profileKey, index, houseId, points, label = '') {
    const res = store.payBountyChecked(profileKey, index, houseId, points, label);
    return res.ok ? res.tx : false;
  },

  // Returns { ok:true, tx }
  //       | { ok:false, reason:'already-paid'|'refused', message }
  payBountyChecked(profileKey, index, houseId, points, label = '') {
    if (store.isBountyPaid(profileKey, index)) {
      const rec = store.getPaidBounty(profileKey, index);
      const who = rec && HOUSES[rec.houseId] ? HOUSES[rec.houseId].name : 'a house';
      return { ok: false, reason: 'already-paid', message: `That bounty has already been claimed by ${who}.` };
    }
    const tx = store.addPoints(houseId, points, { reason: `POTW Bounty: ${label}`.slice(0, 80), tag: 'potw' });
    if (!tx) {
      return { ok: false, reason: 'refused', message: store.explainRefusal(houseId, points) || 'Nothing was recorded.' };
    }
    state.potwBounties[store.bountyKey(profileKey, index)] = { houseId: Number(houseId), ts: Date.now(), points };
    emit();
    return { ok: true, tx };
  },

  // "Nobody earned it" (DESIGN-PLAN 6.7): closes a bounty question with no
  // winner and no ledger write. Recorded in the SAME potwBounties bucket as a
  // paid entry, deliberately — every screen that already asks "is this
  // bounty decided?" (isBountyPaid/getPaidBounty) is a lookup by key, not a
  // house lookup, so a closed record surfaces there for free. houseId:null is
  // what tells a paid win apart from a closed no-win; `closed` is there so a
  // caller checking specifically for "nobody won" never has to infer it from
  // an absent houseId alone.
  closeBounty(profileKey, index) {
    if (store.isBountyPaid(profileKey, index)) return false;   // already decided, one way or the other
    state.potwBounties[store.bountyKey(profileKey, index)] = { houseId: null, ts: Date.now(), closed: true };
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
    const clean = { ...profile };
    // bountyPoints is per-profile, teacher-set in Admin. Clamped/validated
    // HERE, not just in the form — this also receives whole profile objects
    // off a backup restore, and a blank/garbage value must fall back to the
    // built-in default (see bountyPoints() in potw.js) rather than saving NaN
    // or an unbounded award.
    const bp = Math.round(Number(profile.bountyPoints));
    if (Number.isFinite(bp) && bp > 0) clean.bountyPoints = Math.min(MAX_DELTA, bp);
    else delete clean.bountyPoints;
    state.potw.profiles[key] = clean;
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
    // Three things have to happen here, and only the first one used to.
    //
    // applyHouseOverrides mutates the shared HOUSES objects IN PLACE, so every
    // module holding a reference sees a rename immediately. That is what makes
    // renaming a house work — and it means a reset which only replaces `state`
    // leaves the previous teacher's names, colours and artwork on screen for
    // the rest of the session, because Admin re-renders without reloading. The
    // class would watch the houses keep their old identity after a wipe, then
    // silently change back at the next reload. So HOUSES is restored to its
    // shipped values too.
    //
    // And the repair pass runs here for the same reason it runs on load: a
    // fresh default is not automatically self-consistent.
    state = repairPotwVideos(defaultState());
    const pristine = defaultHouses();
    for (const id of Object.keys(HOUSES)) Object.assign(HOUSES[id], pristine[id]);
    bumpLedger();
    emit();
  },
};
