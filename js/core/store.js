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

// Die of Destiny (d20) outcome table. `id` is the stable key a teacher edit is
// keyed to (see saveDiceOutcome) — it never changes even if wording does.
// `min`/`max`/`hasButton`/`mythic` are NOT teacher-editable: every one of the
// 20 faces on the die must map to exactly one outcome with no gaps or overlaps,
// or a roll could come up with nothing to show the class. Opening those up
// risked breaking that guarantee for very little benefit, so only the points,
// title, description and emoji can be changed — see saveDiceOutcome below.
function defaultDiceProphecy() {
  return [
    { id: 'catastrophe', min: 1,  max: 1,  emoji: '💀', title: 'CATASTROPHE',    desc: 'House loses 10 points',                        points: -10, hasButton: true },
    { id: 'misfortune',  min: 2,  max: 5,  emoji: '🌧️', title: 'Misfortune',     desc: 'Teacher picks the next challenger',            points: 0,   hasButton: false },
    { id: 'neutral',     min: 6,  max: 9,  emoji: '😐', title: 'Fate is Neutral', desc: 'Nothing happens',                              points: 0,   hasButton: false },
    // "Move your token" was left over from a physical board version — there is
    // no token in this app, and this string is what the outcome plaque shows a
    // whole class during a live roll. "class points" was the odd one out too:
    // every other row, and the rest of the app, says house points.
    { id: 'smallfavor',  min: 10, max: 14, emoji: '✨', title: 'Small Favor',     desc: '+2 house points',                              points: 2,   hasButton: true },
    { id: 'fortune',     min: 15, max: 19, emoji: '🔥', title: 'Fortune Smiles',  desc: '+5 house points',                              points: 5,   hasButton: true },
    { id: 'mythic',      min: 20, max: 20, emoji: '👑', title: 'MYTHIC TRIUMPH',  desc: '+20 points AND a Mythic Relic to defend your house!', points: 20, hasButton: true, mythic: true },
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
const HP_POINTS_PER_STEP = 50000;

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
function defaultDuelCatalog() {
  return [
    // ---- attacks ----
    { id: 'sword',      name: 'The Sword of Destiny',     emoji: '🗡️', image: '', cost: 450,  slot: 'attack',   // his doc: 600
      effect: { kind: 'damage', dice: '2d6', mult: 100 }, counteredBy: ['shield'],
      desc: 'Strike another House for 2d6 × 100 points. The Shield of Protection stops it dead.' },
    { id: 'net',        name: 'Net of Entrapment',        emoji: '🕸️', image: '', cost: 600,  slot: 'attack',
      effect: { kind: 'steal', dice: '2d6', mult: 100 }, counteredBy: ['gauntlet'],
      desc: 'Steal 2d6 × 100 points and add them to your own total. The Gauntlet of Defense stops it.' },
    { id: 'iceaxe',     name: 'The Legendary Ice Axe',    emoji: '🪓', image: '', cost: 500,  slot: 'attack',
      effect: { kind: 'freeze', dice: '1d6' }, counteredBy: ['shield'],
      desc: 'Freeze a House so it cannot earn points for 1d6 days. The Shield of Protection stops it.' },
    { id: 'cloak',      name: 'Cloak of Invisibility',    emoji: '🫥', image: '', cost: 400,  slot: 'attack',
      effect: { kind: 'steal', dice: '1d6', mult: 100, anonymous: true }, counteredBy: ['bow'],
      desc: 'Steal 1d6 × 100 points without anyone learning who did it. The Bow of Seeking finds you.' },
    { id: 'catapult',   name: 'The Catapult',             emoji: '🪨', image: '', cost: 1000, slot: 'attack',
      effect: { kind: 'damage', dice: '3d6', mult: 100, targets: 2 }, counteredBy: [],
      desc: 'Hit TWO Houses for 3d6 × 100 points each. Nothing defends against it.' },
    { id: 'staffra',    name: 'The Staff of Ra',          emoji: '☀️', image: '', cost: 700, slot: 'attack',   // his doc: 1000
      effect: { kind: 'damage', dice: '3d6', mult: 100 }, counteredBy: ['eye'],
      desc: 'A blast of concentrated sunlight for 3d6 × 100 points. The Eye of Horus stops it.' },
    { id: 'warhorse',   name: 'Warhorse',                 emoji: '🐎', image: '', cost: 700, slot: 'attack',   // his doc: 1000
      effect: { kind: 'damage', dice: '3d6', mult: 100 }, counteredBy: ['bow'],
      desc: 'A charging warhorse for 3d6 × 100 points. The Bow of Seeking brings it down.' },

    // ---- defenses ----
    { id: 'shield',     name: 'The Shield of Protection', emoji: '🛡️', image: '', cost: 500,  slot: 'defense',
      effect: { kind: 'block' }, blocks: ['sword', 'iceaxe'],
      desc: 'Stops the Sword of Destiny or the Legendary Ice Axe for one Battle Day.' },
    { id: 'gauntlet',   name: 'Gauntlet of Defense',      emoji: '🧤', image: '', cost: 400,  slot: 'defense',
      effect: { kind: 'block' }, blocks: ['net'],
      desc: 'Stops every attack from the Net of Entrapment.' },
    { id: 'bow',        name: 'Bow of Seeking',           emoji: '🏹', image: '', cost: 400,  slot: 'defense',
      effect: { kind: 'block' }, blocks: ['cloak', 'warhorse'],
      desc: 'Seeks out the Cloak of Invisibility or the Warhorse and stops the attack.' },
    { id: 'eye',        name: 'The Eye of Horus',         emoji: '👁️', image: '', cost: 500,  slot: 'defense',
      effect: { kind: 'block' }, blocks: ['staffra'],
      desc: 'Defends against the Staff of Ra.' },

    // ---- utility ----
    { id: 'stone',      name: 'The Stone of Seeing',      emoji: '🔮', image: '', cost: 1000, slot: 'utility',
      effect: { kind: 'reveal' },
      desc: 'Reveals what another House has chosen to do this week.' },
    { id: 'shroud',     name: 'The Shroud of Secrecy',    emoji: '🌫️', image: '', cost: 500,  slot: 'utility',
      effect: { kind: 'hide' },
      desc: 'Hides your actions from every other House for one week.' },
    { id: 'timeturner', name: 'The Time Turner',          emoji: '⏳', image: '', cost: 1000, slot: 'utility',
      effect: { kind: 'timeturn' },
      desc: 'Go back and change your items after you have been attacked.' },
    { id: 'bagofholding', name: 'The Bag of Holding',     emoji: '🎒', image: '', cost: 500,  slot: 'utility',
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

// Bump when a shipped shop description needs to reach browsers that have
// already saved their own copy of the catalog. See the migration in load().
const SHOP_DESC_REV = 3;

// Same idea for the dice prophecy table, which is saved state for the same
// reason and went stale for the same reason.
const DICE_DESC_REV = 1;
const OLD_DICE_DESCS = {
  smallfavor: ['Move your token / +2 class points'],
};

// Every description these items have EVER shipped with, recovered from git
// history (two of them shipped under more than one wording). A saved
// description matching any of these was written by the app, not the teacher,
// so it is safe to replace. Anything else is the teacher's own words and is
// left alone. All of these describe the retired points-damage model.
const OLD_SHOP_DESCS = {
  catapult: [
    'Deduct 20 pts from a target house.',
    'Roman siege engines hurl stones over the walls. Deduct 20 pts from a house you choose.',
  ],
  greekfire: ['The Byzantine secret weapon that burned on water. Deduct 25 pts from a house you choose.'],
  elephants: ['Over the Alps and into Roman territory. Deduct 30 pts from a house you choose.'],
  heatray:   ['Mirrors focus the sun on enemy ships at Syracuse. Deduct 35 pts from a house you choose.'],
  trojan: [
    'Steal 25 pts from the leading house.',
    'A gift hiding an army. Steal 25 pts from whichever house is leading.',
  ],
  cloak:   ['Strike unseen — ignores shields AND damage reduction. Deduct 20 pts.'],
  fogbank: ['Advance under cover — ignores shields AND damage reduction. Deduct 25 pts.'],
};

// Rev 2 was a same-day internal iteration: the wording was right but ran to
// four lines, and the shop card clamps at three, so students saw it cut off
// mid-sentence. Listed here only so a browser that saved it still gets the
// shorter rev-3 text instead of keeping a truncated description for ever.
Object.assign(OLD_SHOP_DESCS, {
  catapult:  OLD_SHOP_DESCS.catapult.concat('Roman siege engines hurl stones over the walls. Waits in your armoury until Battle Day, then takes 20 HP off a house you choose. A shield stops it; damage reduction halves it.'),
  greekfire: OLD_SHOP_DESCS.greekfire.concat('The Byzantine secret weapon that burned on water. Waits in your armoury until Battle Day, then takes 25 HP off a house you choose. A shield stops it; damage reduction halves it.'),
  elephants: OLD_SHOP_DESCS.elephants.concat('Over the Alps and into Roman territory. Waits in your armoury until Battle Day, then takes 30 HP off a house you choose. A shield stops it; damage reduction halves it.'),
  heatray:   OLD_SHOP_DESCS.heatray.concat('Mirrors focus the sun on enemy ships at Syracuse. Waits in your armoury until Battle Day, then takes 35 HP off a house you choose. A shield stops it; damage reduction halves it.'),
  trojan:    OLD_SHOP_DESCS.trojan.concat('A gift hiding an army. Waits in your armoury until Battle Day, then takes 25 HP off the leading house — and you gain points equal to the damage you actually land.'),
  cloak:     OLD_SHOP_DESCS.cloak.concat('Strike unseen. Waits in your armoury until Battle Day, then takes 20 HP off a house you choose — ignoring shields AND damage reduction. Always lands in full.'),
  fogbank:   OLD_SHOP_DESCS.fogbank.concat('Advance under cover. Waits in your armoury until Battle Day, then takes 25 HP off a house you choose — ignoring shields AND damage reduction. Always lands in full.'),
});

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
    punchingDown: false,// may a house attack one with FEWER points?
    hpBase: 100,        // everyone starts here
    hpPer500: 10,       // extra HP per 500 points held
    // The ± buttons on Battle Day's teacher-scoring row. This was hardcoded to
    // 10 in battle.js, which made it the one point value on the whole screen
    // he could not change without editing source.
    teacherScore: 10,
  };
}



const LAYOUT_SCREENS = {
  quests: { label: 'Quests board' },
  shop:   { label: 'Magic Shop' },
};
const DEFAULT_LAYOUT = 'grid';


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
    { id: 'catapult',  name: 'Catapult Volley',        emoji: '🪨', image: '', cost: 3500, desc: 'Roman siege engines hurl stones. Waits in your armoury for Battle Day, then takes 20 HP off a house you choose.', effect: { kind: 'attack', amount: 2000 } },
    { id: 'greekfire', name: 'Greek Fire',             emoji: '🔥', image: '', cost: 4500, desc: 'The Byzantine secret that burned on water. Waits in your armoury for Battle Day, then takes 25 HP off a house you pick.', effect: { kind: 'attack', amount: 2500 } },
    { id: 'elephants', name: "Hannibal's War Elephants", emoji: '🐘', image: '', cost: 5500, desc: 'Over the Alps into Roman territory. Waits in your armoury for Battle Day, then takes 30 HP off a house you choose.', effect: { kind: 'attack', amount: 3000 } },
    { id: 'heatray',   name: "Archimedes' Heat Ray",   emoji: '☀️', image: '', cost: 6500, desc: 'Mirrors burn ships at Syracuse. Waits in your armoury for Battle Day, then takes 35 HP off a house you choose.', effect: { kind: 'attack', amount: 3500 } },
    { id: 'trojan',    name: 'Trojan Horse',           emoji: '🐴', image: '', cost: 5000, desc: 'A gift hiding an army. Waits for Battle Day, then takes 25 HP off the leader — you gain points equal to the damage.', effect: { kind: 'steal', amount: 2500 } },
    // ---- Offensive: pierce (ignores defenses) ----
    { id: 'cloak',     name: 'Invisibility Cloak',     emoji: '🫥', image: '', cost: 6000, desc: 'Strike unseen. Waits in your armoury for Battle Day, then takes 20 HP off any house — ignoring shields and halving.', effect: { kind: 'pierce', amount: 2000 } },
    { id: 'fogbank',   name: 'Fog Bank',               emoji: '🌫️', image: '', cost: 7000, desc: 'Advance under cover. Waits for Battle Day, then takes 25 HP off any house — ignoring shields and halving.', effect: { kind: 'pierce', amount: 2500 } },
    // ---- Defensive ----
    { id: 'phalanx',   name: 'Phalanx Formation',      emoji: '🛡️', image: '', cost: 2500, desc: 'Locked shields, bristling spears. Blocks incoming attacks for 12 hours.', effect: { kind: 'shield', amount: 12 } },
    { id: 'aegis',     name: 'Aegis Shield',           emoji: '⚡', image: '', cost: 3000, desc: "Athena's shield, feared by gods and men. Blocks incoming attacks for 24 hours.", effect: { kind: 'shield', amount: 24 } },
    { id: 'shieldwall',name: 'Shield Wall',            emoji: '🪵', image: '', cost: 3500, desc: 'The Viking skjaldborg — no gap for a blade. Blocks incoming attacks for 24 hours.', effect: { kind: 'shield', amount: 24 } },
    { id: 'moat',      name: 'Moat & Drawbridge',      emoji: '🏰', image: '', cost: 4500, desc: 'Raise the bridge and hold the keep. Blocks incoming attacks for 36 hours.', effect: { kind: 'shield', amount: 36 } },
    { id: 'greatwall', name: 'The Great Wall',         emoji: '🧱', image: '', cost: 6000, desc: 'Thousands of miles of stone and watchtowers. Blocks incoming attacks for 48 hours.', effect: { kind: 'shield', amount: 48 } },
    // ---- Wildcards ----
    { id: 'pandora',   name: "Pandora's Box",          emoji: '📦', image: '', cost: 4000, desc: 'Every evil escapes — but hope remains. Random swing of up to 30 pts, for you or against you.', effect: { kind: 'wild', amount: 3000 } },
    { id: 'fortuna',   name: "Fortuna's Wheel",        emoji: '🎡', image: '', cost: 3000, desc: 'The Roman goddess of luck spins the wheel. Random swing of up to 20 pts, either way.', effect: { kind: 'wild', amount: 2000 } },
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
      // Quiet per-screen background loops (see js/core/ambient.js).
      ambient: { enabled: false, volume: 0.25, tracks: null },  // opt-in: teacher turns it on in Admin
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
    // houseId -> DAMAGE TAKEN, not current HP. Refilled (cleared) at the start
    // of each Battle Day. Storing "current" looked right until a house won a
    // battle: the prize pushed it over a 500-point boundary, its maximum rose,
    // and its untouched current HP read 120/130 — it appeared wounded for
    // getting richer. Damage taken is invariant to the maximum moving.
    hp: {},
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
      catalog: defaultDuelCatalog(),
      // Which shipped items this browser has already been shown, per mode, so
      // an item the teacher DELETED stays deleted instead of reappearing on
      // every reload — and so a newly shipped one still arrives.
      seeded: {
        duel: defaultDuelCatalog().map((i) => i.id),
        hp: defaultHpCatalog().map((i) => i.id),
      },
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
        // The intros used to be YouTube embeds. They now ship as real files in
        // /videos, because the classroom computer may have no internet — and a
        // YouTube embed also flashes its own pause glyph on launch, which was a
        // long-standing complaint. Move a profile still pointing at a preset
        // over to the equivalent local file. Only these two ids are remapped,
        // so a video the teacher chose themselves is left alone.
        if (p.introVideoId === 'rock') p.introVideoId = 'intro-01';
        else if (p.introVideoId === 'classic') p.introVideoId = 'intro-02';
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
      // Dice outcome points/wording (Die of Destiny) — teacher-editable in
      // Admin. Rebuilt every load, keyed by id, same reasoning as moduleThemes
      // above: min/max/hasButton/mythic always come from the shipped defaults
      // (so a roll can never land on a gap), while points/title/desc/emoji are
      // taken from the saved copy when present and valid.
      {
        const def = defaultDiceProphecy();
        const saved = Array.isArray(merged.settings.diceProphecy) ? merged.settings.diceProphecy : [];
        // Same trap the shop descriptions hit: this table is SAVED state, so a
        // wording fix here reaches nobody who has already run the app — their
        // copy wins for ever. "Move your token" was left over from a physical
        // board game and is what the outcome plaque shows a whole class during
        // a live roll. Retire text the APP shipped, keyed off a revision marker
        // so it happens once; anything the teacher wrote himself is untouched.
        const retired = merged.settings.diceDescRev !== DICE_DESC_REV;
        merged.settings.diceProphecy = def.map((d) => {
          const s = saved.find((x) => x.id === d.id) || {};
          const stale = retired && (OLD_DICE_DESCS[d.id] || []).includes(String(s.desc || '').trim());
          return {
            ...d,
            points: Number.isFinite(Number(s.points)) ? Math.max(-MAX_DELTA, Math.min(MAX_DELTA, Math.round(Number(s.points)))) : d.points,
            title: typeof s.title === 'string' && s.title.trim() ? s.title.trim().slice(0, 40) : d.title,
            desc: (!stale && typeof s.desc === 'string' && s.desc.trim()) ? s.desc.trim().slice(0, 140) : d.desc,
            emoji: typeof s.emoji === 'string' && s.emoji.trim() ? s.emoji.trim().slice(0, 4) : d.emoji,
          };
        });
        merged.settings.diceDescRev = DICE_DESC_REV;
      }
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
          // Per-quest icons shipped later still. Borrow the shipped one by id;
          // a teacher's own quest keeps '' and falls back to its category icon.
          icon: typeof q.icon === 'string' && q.icon ? q.icon : (d && d.icon ? d.icon : ''),
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
      // Combat modes arrived after some browsers had saved. Anything saved
      // before then IS the hit-points catalog — that is all there was — so it
      // becomes the 'hp' side, edits and deletions intact, and Mr. D's rules
      // come in as the new active mode. `seeded` was a flat array then and is
      // per-mode now.
      const savedMode = COMBAT_MODES[merged.settings.combatMode] ? merged.settings.combatMode : null;
      const flatSeeded = Array.isArray(saved.shop?.seeded) ? saved.shop.seeded : null;
      if (!savedMode || flatSeeded) {
        const oldCatalog = Array.isArray(saved.shop?.catalog) && saved.shop.catalog.length
          ? saved.shop.catalog : defaultHpCatalog();
        merged.shop.parked = { hp: oldCatalog, duel: null };
        merged.shop.catalog = defaultDuelCatalog();
        merged.shop.seeded = {
          hp: flatSeeded || oldCatalog.map((i) => i.id),
          duel: defaultDuelCatalog().map((i) => i.id),
        };
        merged.settings.combatMode = DEFAULT_COMBAT_MODE;
        // Held items and damage belong to the mode they happened in.
        merged.inventory = {};
        merged.hp = {};
      }
      if (!merged.shop.seeded || Array.isArray(merged.shop.seeded)) merged.shop.seeded = { duel: [], hp: [] };
      if (!merged.shop.parked || typeof merged.shop.parked !== 'object') merged.shop.parked = { hp: null, duel: null };

      // Introduce newly shipped items for the ACTIVE mode only; the parked one
      // is topped up when it next becomes active.
      {
        const mode = COMBAT_MODES[merged.settings.combatMode] ? merged.settings.combatMode : DEFAULT_COMBAT_MODE;
        const shipped = mode === 'duel' ? defaultDuelCatalog() : defaultHpCatalog();
        const seen = Array.isArray(merged.shop.seeded[mode]) ? merged.shop.seeded[mode] : [];
        for (const item of shipped) {
          if (!seen.includes(item.id)) {
            merged.shop.catalog.push({ ...item });
            seen.push(item.id);
          }
        }
        merged.shop.seeded[mode] = seen;
      }
      // The shop catalog is SAVED STATE, not source. Editing a description in
      // this file therefore does NOT reach a browser that has already saved —
      // it keeps its own copy for ever. When Battle Day moved from points to
      // hit points, every shipped weapon still promised "Deduct 20 pts from a
      // house you choose", which is now simply untrue: it removes HP, and the
      // loser of a battle loses no points at all.
      //
      // So: refresh the descriptions of SHIPPED items once, keyed off a
      // revision marker. Only items whose text still matches a previous
      // shipped default are touched, so a description the teacher has written
      // or edited themselves is never overwritten. The marker makes it a
      // one-time correction rather than a permanent override — after this runs,
      // their edits are safe again.
      // Scoped to the HIT-POINTS catalog on purpose. OLD_SHOP_DESCS holds that
      // model's wording, and two ids — 'catapult' and 'cloak' — exist in BOTH
      // catalogs as completely different items. Matching by id alone would let
      // this rewrite Mr. D's Catapult with the Catapult Volley's description.
      // The two catalogs never meet anywhere else; this is the one place that
      // could have crossed them.
      if (Number(merged.shop.descRev) !== SHOP_DESC_REV) {
        const hpById = Object.fromEntries(defaultHpCatalog().map((i) => [i.id, i]));
        const refresh = (list) => (Array.isArray(list) ? list.map((item) => {
          const d = hpById[item.id];
          if (!d || typeof item.desc !== 'string') return item;
          const stale = OLD_SHOP_DESCS[item.id];
          return (stale && stale.includes(item.desc.trim())) ? { ...item, desc: d.desc } : item;
        }) : list);
        if (merged.settings.combatMode === 'hp') merged.shop.catalog = refresh(merged.shop.catalog);
        merged.shop.parked.hp = refresh(merged.shop.parked.hp);
        merged.shop.descRev = SHOP_DESC_REV;
      }
      merged.planner = { ...def.planner, ...(merged.planner || {}) };
      if (!Array.isArray(merged.planner.events)) merged.planner.events = [];
      if (!Array.isArray(merged.transactions)) merged.transactions = [];
      if (!merged.shields || typeof merged.shields !== 'object') merged.shields = {};
      // Drop expired shields so they can't be revived by an old backup.
      for (const [id, exp] of Object.entries(merged.shields)) {
        if (!(Number(exp) > Date.now())) delete merged.shields[id];
      }
      merged.frozen = merged.frozen && typeof merged.frozen === 'object' ? merged.frozen : {};
      for (const [id, until] of Object.entries(merged.frozen)) {
        if (!(Number(until) > Date.now())) delete merged.frozen[id];
      }
      merged.potwBounties = merged.potwBounties && typeof merged.potwBounties === 'object' ? merged.potwBounties : {};
      // This list is what the Admin dropdown actually offers, and it is SAVED
      // state. The old rule only refilled it when it was EMPTY, so a browser
      // that had saved once kept its original list for ever — which is how the
      // intro videos ended up unusable: /videos files were shipped and made the
      // default, but the saved list still held only the two YouTube presets, so
      // the dropdown could not offer the new files and 'intro-01' resolved to
      // nothing at all. Mesopotamia appeared to work only because an unrelated
      // fallback further down happened to point at the same file.
      //
      // Now: keep whatever the teacher has added, backfill anything newly
      // shipped by id, and retire the two YouTube presets by id — the profiles
      // that used them were remapped to the local files above, and they are the
      // reason the classroom needed internet at all. Only those two exact ids
      // are dropped; a YouTube link the teacher pasted himself is untouched.
      {
        const RETIRED = new Set(['rock', 'classic']);
        const saved = Array.isArray(merged.settings.introVideos) ? merged.settings.introVideos : [];
        const kept = saved.filter((v) => v && v.id && !RETIRED.has(v.id));
        for (const v of (CONFIG.POTW_INTRO_VIDEOS || [])) {
          if (!kept.some((k) => k.id === v.id)) kept.push({ ...v });
        }
        merged.settings.introVideos = kept.length ? kept : (CONFIG.POTW_INTRO_VIDEOS || []).map((v) => ({ ...v }));
      }
      // A profile still pointing at a retired preset (or at an id that no longer
      // exists at all) would resolve to an empty URL and silently fall through
      // to whatever the fallback chain offers. Point those at the default.
      {
        const ids = new Set((merged.settings.introVideos || []).map((v) => v.id));
        for (const p of Object.values(merged.potw.profiles || {})) {
          if (p && !p.videoUrl && p.introVideoId && !ids.has(p.introVideoId)) {
            p.introVideoId = CONFIG.POTW_DEFAULT_VIDEO_ID;
          }
        }
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

// A failed save used to be a console.warn and nothing else. That is the worst
// possible outcome in a classroom: the award already happened in memory and
// every screen already repainted showing the new total, so the teacher has no
// reason to doubt it — and it is gone at the next reload. He has no devtools
// open and will never see a console warning.
//
// Now it says so on screen, once, and stays out of the way after that. Losing
// a point award silently is worse than an ugly banner.
let persistFailed = false;
function persist() {
  try {
    localStorage.setItem(CONFIG.STORAGE_KEY, JSON.stringify(state));
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

function emit() { persist(); listeners.forEach((fn) => { try { fn(state); } catch (e) { console.error(e); } }); }

function startOfWeek(d = new Date()) {
  const x = new Date(d); const day = (x.getDay() + 6) % 7; // Monday=0
  x.setHours(0, 0, 0, 0); x.setDate(x.getDate() - day); return x;
}

// 'YYYY-MM-DD' in LOCAL time. Deliberately not toISOString(), which converts to
// UTC first and so reports the wrong day either side of midnight for anyone
// west of Greenwich — this app deals in school days, not instants.
function ymd(d) {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

function todayStr() {
  return ymd(new Date());
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
  MODULE_THEMES,
  LAYOUT_SCREENS,
  STOCKPILE_KINDS,
  PRIZE_RULES,

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
    if (!c.punchingDown && store.getTotal(defenderId, 'term') < store.getTotal(attackerId, 'term')) {
      return { ok: false, reason: 'They have fewer points than you — punching down is switched off in Admin.' };
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
    const tx = { id: `tx-${Date.now()}-${state.transactions.length}`, ts: Date.now(), houseId: Number(houseId), delta, reason, tag };
    state.transactions.push(tx);
    bumpLedger();
    emit();
    return tx;
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
    emit();
    return next;
  },

  // ----- Mr. D's duel rules ---------------------------------------------------
  // Holdings ARE the inventory: a house buys an item and holds it until it is
  // used. The weekly limit is therefore a cap on what may be HELD, not a
  // separate booking system — which is also how he describes it, and means the
  // Magic Shop needs no new concept to enforce it.
  duelSlotLimits(houseId) {
    const hasBag = store.countOwned(houseId, 'bagofholding') > 0;
    return hasBag ? { attack: 2, defense: 2 } : { attack: 1, defense: 1 };
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
    const limit = store.duelSlotLimits(houseId)[slot];
    const held = store.duelHeld(houseId, slot);
    if (held >= limit) {
      return { ok: false, reason: limit === 1
        ? `Only one ${slot} item a week — use or drop the one they already hold. The Bag of Holding raises this to two.`
        : `That is both ${slot} slots used for the week.` };
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
  applyDuelAttack({ attackerId, targetId, itemId, rolled }) {
    const pv = store.previewDuelAttack(attackerId, targetId, itemId);
    if (!pv.ok) return pv;
    const item = pv.item;
    const attacker = HOUSES[attackerId], target = HOUSES[targetId];
    const out = { ok: true, blocked: pv.blocked, item, damage: 0, stolen: 0, frozenDays: 0 };

    // The attack is spent either way — that is what makes a correct guess hurt.
    store.consumeFromInventory(attackerId, itemId);
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
      emit();
      return out;
    }

    const total = Math.max(0, Math.round(Number(rolled) || 0)) * (item.effect?.mult || 1);
    out.damage = total;
    store.addPoints(targetId, -total, {
      reason: `${item.name}${item.effect?.anonymous ? '' : ` from ${attacker?.name || 'a house'}`}`,
      tag: 'attack',
    });
    if (pv.steals) {
      out.stolen = total;
      store.addPoints(attackerId, total, { reason: `${item.name} on ${target?.name || 'a house'}`, tag: 'attack' });
    }
    emit();
    return out;
  },

  // ----- freeze (Legendary Ice Axe) -------------------------------------------
  // Stored as an expiry DATE rather than a countdown, so it survives reloads and
  // does not need anything ticking. Whole school days, per his rules.
  freezeHouse(houseId, days) {
    if (!state.frozen || typeof state.frozen !== 'object') state.frozen = {};
    const until = new Date();
    until.setHours(0, 0, 0, 0);
    until.setDate(until.getDate() + Math.max(1, Math.round(days)));
    state.frozen[houseId] = until.getTime();
    emit();
  },
  isFrozen(houseId) { return (((state.frozen || {})[houseId]) || 0) > Date.now(); },
  frozenUntil(houseId) { return ((state.frozen || {})[houseId]) || 0; },
  thawHouse(houseId) {
    if (state.frozen && state.frozen[houseId]) { delete state.frozen[houseId]; emit(); return true; }
    return false;
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
    bumpLedger();
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
    state = defaultState();
    bumpLedger();
    emit();
  },
};
