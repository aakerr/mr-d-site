// help.js — the in-app Help Wiki.
//
// A searchable, categorised handbook written FOR THE TEACHER. Left-hand topic
// list, article on the right, search box that filters across every topic title,
// keyword and body. Opens from the "?" in the top bar, from the Admin panel
// (via the exported openHelp/openHelpAt), and from the first-run wizard.
//
// Every factual claim in here was read off the actual code (store.js, dice.js,
// shop catalog, potw.js, backup.js, admin.js) — if behaviour changes, the
// matching article has to change with it.
//
// The overlay owns exactly one element (#help-root), created on open and
// REMOVED on close, together with its document-level key listener.
import { store } from './store.js';
import { backup } from './backup.js';
import { health } from './health.js';
import { lock } from './lock.js';
import { startSetup } from './firstrun.js';

const ROOT_ID = 'help-root';
const NARROW_PX = 900;

function esc(s) {
  return String(s == null ? '' : s).replace(/[&<>"']/g, (c) =>
    ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}

function stripTags(html) {
  return String(html).replace(/<[^>]*>/g, ' ').replace(/&[a-z]+;/gi, ' ').replace(/\s+/g, ' ').trim();
}

// ---------------------------------------------------------------------------
// Live facts pulled from the running app, so articles never go stale.
// ---------------------------------------------------------------------------
function houseNames() {
  try { return [1, 2, 3, 4].map((c) => store.HOUSES[c]).filter(Boolean); } catch (e) { return []; }
}
function termLine() {
  try {
    const s = store.getSettings();
    return `Right now: term starts <b>${esc(s.termStart)}</b> and runs <b>${esc(String(s.termWeeks))} weeks</b>.`;
  } catch (e) { return ''; }
}
function shopItemsByKind(kind) {
  try { return (store.getShopItems() || []).filter((i) => i.effect && i.effect.kind === kind); } catch (e) { return []; }
}
// Battle Day runs under one of TWO complete rule sets — 'duel' (Mr. D's own
// game, the default) or 'hp' (the earlier hit-points model). Only one is ever
// active, and its shop items are the only ones store.getShopItems() returns —
// see store.js's COMBAT_MODES / setCombatMode(). Every article that describes
// specific items or specific combat mechanics has to know which one it is
// talking about, so it can say so plainly instead of going stale or silent.
function combatModeNow() {
  try { return store.getCombatMode(); } catch (e) { return 'duel'; }
}
function isDuelNow() { return combatModeNow() === 'duel'; }
// Items in the CURRENT shop that belong to a given slot ('attack' | 'defense'
// | 'utility') — only meaningful while Mr. D's rules are active, since the
// hit-points shop has no slots at all. Returns null rather than an empty list
// when the other rule set is running, so callers can tell "nothing here"
// apart from "wrong mode to ask this in".
function duelItemsBySlot(slot) {
  try {
    if (store.getCombatMode() !== 'duel') return null;
    return (store.getShopItems() || []).filter((i) => i.slot === slot);
  } catch (e) { return null; }
}

// ---------------------------------------------------------------------------
// The d20 prophecy table.
// SOURCE OF TRUTH: store.getDiceProphecy() (js/core/store.js) — teacher-edited
// via 🗝️ Admin → ⚙️ Settings → 🎲 Die of Destiny, defaulting to
// defaultDiceProphecy() in store.js. The article below reads it live (same
// pattern as battle-hp does for combat numbers) so it can never go stale.
// ---------------------------------------------------------------------------

// ---------------------------------------------------------------------------
// Categories
// ---------------------------------------------------------------------------
const CATEGORIES = [
  { id: 'quick',  label: 'Quick answers',        icon: '⚡' },
  { id: 'start',  label: 'Getting started',      icon: '🚩' },
  { id: 'points', label: 'Points',               icon: '🏆' },
  { id: 'potw',   label: 'Place of the Week',    icon: '🌍' },
  { id: 'quests', label: 'Quests',               icon: '🧭' },
  { id: 'shop',   label: 'Magic Shop & Battle',  icon: '🔮' },
  { id: 'dice',   label: 'Die of Destiny',       icon: '🎲' },
  { id: 'admin',  label: 'The Admin panel',      icon: '🗝️' },
  { id: 'data',   label: 'Your data & backups',  icon: '💾' },
  { id: 'setup',  label: 'Housekeeping',         icon: '⚙️' },
  { id: 'fix',    label: 'Something looks wrong?', icon: '🩹' },
  { id: 'check',  label: 'System check',         icon: '🩺' },
];

// ---------------------------------------------------------------------------
// Topics. body: HTML string, or a function returning one.
// ---------------------------------------------------------------------------
const TOPICS = [

  // ======================= QUICK ANSWERS =======================
  {
    id: 'cheat-sheet', cat: 'quick', title: 'The five things you will do most',
    keywords: 'cheat sheet summary quick common everyday basics',
    body: `
      <p class="help-lede">If you only ever read one page, read this one.</p>
      <ol class="help-steps">
        <li><b>Give a house points.</b> Tap the round <b>±</b> button next to the house name at the top of the screen, tap the house, tap <b>+5</b> / <b>+10</b> (or type any amount and tap <b>+ Add</b>).</li>
        <li><b>Take points away.</b> Same panel — <b>−5</b> / <b>−10</b>, or type an amount and tap <b>− Deduct</b>.</li>
        <li><b>Undo a mistake.</b> Award the exact opposite amount with the reason "correction" — the totals come out right and the log shows both. <a href="#" data-help-go="undo-points">Full instructions →</a></li>
        <li><b>Switch class period.</b> Tap the big house name in the middle of the top bar and pick <b>Core 1–4</b> (or <b>All Cores</b> for the whole-school standings screen).</li>
        <li><b>Set up next week's destination.</b> <b>🗝️ Admin → Place of the Week</b>, edit a destination, set <b>Week of</b> to next Monday, <b>Save</b>. <a href="#" data-help-go="potw-schedule">Full instructions →</a></li>
      </ol>
      <p class="help-callout">Two habits worth having: check <a href="#" data-help-go="system-check">System check</a> on Monday morning, and never click "Clear browsing data" in the browser menu.</p>
    `,
  },

  // ======================= GETTING STARTED =======================
  {
    id: 'whats-on-screen', cat: 'start', title: 'What am I looking at?',
    keywords: 'screen layout topbar dashboard tiles home first time orientation',
    body: `
      <p>The app is one screen with a permanent bar across the top. Everything else opens inside it.</p>
      <h4>The top bar, left to right</h4>
      <ul class="help-list">
        <li><b>The crest and "MR. D'S CLASSROOM"</b> — this is your Home button. Tap it from anywhere to come back to the Morning Dashboard.</li>
        <li><b>The big house name in the middle</b> — the class period you are currently teaching. Tap it to switch.</li>
        <li><b>The round ± button</b> — quick points. This is the control you will use most.</li>
        <li><b>The date and "Week N of M"</b> — today's date and where you are in the term.</li>
        <li><b>🔊 speaker</b> — turns the app's sound effects and voice on or off.</li>
        <li><b>🗝️ key</b> — the Teacher's Admin panel. It is deliberately faint so students do not treat it as a button.</li>
      </ul>
      <p>There is no separate <b>❓</b> button in the top bar any more — this handbook now lives one tap inside Admin: <b>🗝️ Admin → ❓ Help</b>.</p>
      <h4>The Morning Dashboard (the home screen)</h4>
      <p>Standings for all four houses, today's itinerary and homework for the class period you have selected, and a row of tiles that launch the rest of the app: Records, Quests, Place of the Week, Battle Day, the Magic Shop and the Die of Destiny.</p>
    `,
  },
  {
    id: 'switch-core', cat: 'start', title: 'Switching between class periods',
    keywords: 'core period class switch house camelot atlantis valhalla rivendell all cores council',
    body: () => `
      <p>Each class period is a "core", and each core is a house:</p>
      <ul class="help-list">
        ${houseNames().map((h) => `<li><span class="help-dot" style="background:${esc(h.accent)}"></span> <b>Core ${h.core} — House ${esc(h.name)}</b> <span class="help-muted">${esc(h.motto)}</span></li>`).join('')}
      </ul>
      <ol class="help-steps">
        <li>Tap the big house name in the centre of the top bar.</li>
        <li>Pick the core you are teaching now.</li>
      </ol>
      <p>Switching changes the colour of the whole app, the itinerary and homework on the dashboard, which house the ± panel starts on, and which house the Quests board is about.</p>
      <p><b>All Cores</b> opens the Council of Four — a neutral standings screen, safe to leave on the board between classes because nothing on it awards or removes a single point. The one control it does have is a small <b>Term / This Week</b> switch at the top right, which only changes which total is being displayed. <a href="#" data-help-go="week-vs-term">Why the totals differ →</a></p>
    `,
  },
  {
    id: 'morning-routine', cat: 'start', title: 'What should I do each morning?',
    keywords: 'morning routine daily start of day checklist monday',
    body: `
      <ol class="help-steps">
        <li><b>Open the app and check the top bar</b> says the right date and the right week of term.</li>
        <li><b>Switch to your first class period</b> (tap the house name in the middle).</li>
        <li>Leave the <b>Morning Dashboard</b> up as students come in — it shows the standings and today's itinerary.</li>
      </ol>
      <p>On a Monday, two extra minutes are worth it:</p>
      <ol class="help-steps">
        <li>Open <b>🗝️ Admin → ❓ Help → System check</b> and glance at the list. Green means nothing to do.</li>
        <li>Make sure a <b>Place of the Week</b> is scheduled for this week — the System check tells you outright if one is not.</li>
      </ol>
    `,
  },
  {
    id: 'students-vs-you', cat: 'start', title: 'What students see vs what you control',
    keywords: 'students teacher control privacy admin who can do what',
    body: `
      <p>Everything is on one shared screen, so treat the whole app as student-facing except the Admin panel.</p>
      <p><b>Students can do (with the board in front of them):</b> browse and accept a quest for their house, buy items in the Magic Shop, answer Place of the Week quiz questions, roll the Die of Destiny, and take strikes on Battle Day.</p>
      <p><b>Only you should do:</b> award or remove points, confirm a quest as complete, edit destinations, plan the calendar, and anything behind the <b>🗝️</b> key.</p>
      <p>There are no student logins and no student names stored — the app tracks four houses, not individuals. Nothing leaves the computer.</p>
    `,
  },
  {
    id: 'first-week', cat: 'start', title: 'Day one setup (do this once)',
    keywords: 'setup wizard first run install day one getting set up new computer',
    body: `
      <ol class="help-steps">
        <li><b>Check your backups.</b> This is the single most important thing on this page. A daily backup file already saves itself to Downloads with no setup — but connecting a backup folder too gives you second-by-second protection instead of once-a-day. <a href="#" data-help-go="data-backup">How backups work →</a></li>
        <li><b>Set your term dates.</b> <b>🗝️ Admin → ⚙️ Settings → Term Timeline</b>: the Monday your term starts and how many weeks it runs.</li>
        <li><b>Plan a week or two.</b> <b>🗝️ Admin → 📅 Planner</b> — tap any date to add an itinerary, homework, a quiz or a vacation.</li>
        <li><b>Schedule your first Place of the Week.</b> <a href="#" data-help-go="potw-schedule">Step by step →</a></li>
      </ol>
      <p class="help-actions"><button type="button" class="help-btn help-btn-primary" data-help-action="setup">Run the setup wizard again</button></p>
    `,
  },

  // ======================= POINTS =======================
  {
    id: 'award-points', cat: 'points', title: 'The three ways to award points',
    keywords: 'award give points plus add score quick points house points automatic',
    body: `
      <h4>1. The ± button in the top bar (fastest)</h4>
      <ol class="help-steps">
        <li>Tap the round <b>±</b> button just to the right of the house name.</li>
        <li>Tap the house you are awarding — it starts on the class period you have selected.</li>
        <li>Tap <b>+5</b> or <b>+10</b>, or type any number up to 9999 in the small box and tap <b>+ Add</b>.</li>
        <li>Optional: type a <b>Reason</b> before you award. It is saved with the entry and shows up in the log later.</li>
      </ol>
      <p class="help-callout">The reason box clears itself after every award, so the next one does not silently inherit the last label.</p>
      <h4>2. The Records screen</h4>
      <p>The <b>Records</b> tile opens a bigger version of the same thing — pick a house, pick a reason tag, award. Better when you want the class to see the number move.</p>
      <h4>3. Automatically, from the games</h4>
      <ul class="help-list">
        <li><b>Quests</b> — points land when <i>you</i> confirm a quest as complete.</li>
        <li><b>Place of the Week</b> — quiz bounties pay the house that answers first.</li>
        <li><b>Die of Destiny</b> — you tap the outcome button to apply the roll.</li>
        <li><b>Magic Shop and Battle Day</b> — buying an item spends its cost in points right away, but that is all buying does at the counter; what happens after depends on which Battle Day rule set is running. Under <b>Mr. D's rules</b> (the default), a landed, uncountered attack rolls its dice on screen and the total comes straight off the target's points. Under <b>Hit points</b>, a house instead uses a stockpiled weapon as a strike that removes hit points, not points, and only the battle's winner is paid a points prize at the end. <a href="#" data-help-go="battle-day">How that works →</a></li>
      </ul>
      <p>All of them go through the same log, so nothing happens that you cannot see afterwards.</p>
    `,
  },
  {
    id: 'deduct-points', cat: 'points', title: 'Taking points away',
    keywords: 'deduct remove minus negative subtract penalty take away',
    body: `
      <ol class="help-steps">
        <li>Tap the round <b>±</b> button in the top bar.</li>
        <li>Tap the house.</li>
        <li>Tap <b>−5</b> or <b>−10</b>, or type an amount and tap <b>− Deduct</b>.</li>
      </ol>
      <p>Deducting is a normal entry in the log, exactly like awarding.</p>
      <h4>Zero is the floor — a house can never go into debt</h4>
      <p>No house can ever drop below <b>0</b>. If you take 300 points off a house that only has 120, the app takes the 120, stops there, and writes <b>120</b> in the log — not 300. This is deliberate: "you lost everything" is a story a class can take, and "you are 180 in the hole" is not. It also means the running totals and the history can never disagree with each other, because the log always records the amount that actually moved.</p>
      <p>The same floor applies to Battle Day damage. A big roll against a nearly-empty house takes what is there and no more. <a href="#" data-help-go="duel-flow">How a Battle Day throw plays out →</a></p>
      <h4>If a change cannot be recorded, the app tells you</h4>
      <p>You are never left wondering whether something went through. If the app refuses a change — because the house is already sitting on zero and has nothing left to take, or because it is <a href="#" data-help-go="duel-freeze">frozen</a> and cannot earn — you get a short <b>amber message on screen</b> saying so in plain words, it stays put for a few seconds so you can actually read it, and nothing at all is written to the log. No coin sound, no floating number, no silent shrug.</p>
      <p class="help-callout">Deducting is <b>not</b> the same as undoing. If you simply awarded the wrong number, see <a href="#" data-help-go="undo-points">I made a mistake</a> — you can delete the entry outright.</p>
    `,
  },
  {
    id: 'undo-points', cat: 'points', title: 'I made a mistake — how do I undo it?',
    keywords: 'undo mistake wrong error delete remove transaction fix correction oops accidentally',
    body: `
      <p class="help-lede">Nothing is ever lost or hidden. Every single point change is its own entry in a log you can read, so a mistake is always findable and always fixable.</p>
      <h4>1. Find what actually happened</h4>
      <ol class="help-steps">
        <li>Open the <b>Records</b> tile.</li>
        <li>Look at the <b>Transaction Log</b> on the left. It lists the most recent changes, newest first, with the time, the house colour, the amount and the reason.</li>
        <li>The screen only ever <i>draws</i> up to 400 entries at once — that is a display limit, not a memory limit. Nothing older than that is deleted or lost; narrow the search/filter to find something further back, or use <b>⬇ Export CSV</b>, which always covers every single entry ever logged, not just the 400 shown on screen.</li>
      </ol>
      <h4>2. Reverse it</h4>
      <ol class="help-steps">
        <li>Tap the <b>±</b> button in the top bar and choose the same house.</li>
        <li>Type the <b>same number</b> you got wrong.</li>
        <li>Type a reason such as <b>"correction — awarded 10 by mistake"</b>.</li>
        <li>Tap <b>− Deduct</b> (or <b>+ Add</b> if you took points off by mistake).</li>
      </ol>
      <p>Both entries stay in the log, which is exactly what you want if a student asks — the record shows the mistake and the fix. The totals come out right.</p>
      <p class="help-callout">If your copy of the app shows a <b>remove</b> control (✕ or Undo) beside a log entry, you can use that instead and the entry disappears entirely. The reversal above works either way and is never wrong.</p>
      <h4>Undoing something bigger</h4>
      <p>If a whole class period went sideways — a shop spree, a Battle Day that got out of hand — work through it one entry at a time. There is no bulk undo, on purpose: a single mis-tap should never be able to erase a term.</p>
      <p>Shields and damage-halving (Hit points mode) are separate from points — clear those in <b>🗝️ Admin → 🛡️ Active Defenses</b>.</p>
      <p>Under <b>Mr. D's rules</b> the equivalent board is <b>🗝️ Admin → ⚔️ Battle Day → ⚔️ House status &amp; holdings</b>, and it undoes the three things that are not point entries: <b>Un-freeze</b> a house the Legendary Ice Axe landed on, <b>Lower it</b> on a raised Shroud of Secrecy, and <b>Take back</b> any item a house is holding if they bought the wrong thing. Taking an item back does <b>not</b> refund what they paid for it — if you meant to undo the purchase completely, give the points back with the <b>±</b> button as well.</p>
    `,
  },
  {
    id: 'week-vs-term', cat: 'points', title: 'Why do the totals differ between screens?',
    keywords: 'week term total different numbers standings scope leaderboard confusing',
    body: `
      <p>There are two totals for every house and they are both correct.</p>
      <ul class="help-list">
        <li><b>Term total</b> — everything since the start of the term. This is the leaderboard number, and it is what the Magic Shop spends.</li>
        <li><b>This week</b> — only what has been earned since <b>Monday</b>. It resets itself every Monday morning; you never have to zero anything.</li>
      </ul>
      <p>The Morning Dashboard shows only the <b>term</b> total, under the heading <b>Current Term Standings</b>. To see "this week" on its own, open the <b>Council of Four</b> (tap the house name in the middle of the top bar and choose <b>All Cores</b>) — it has a small <b>Term</b> / <b>This Week</b> switch at the top right that flips the whole board between the two. <a href="#" data-help-go="switch-core">More about the Council of Four →</a></p>
      <p class="help-callout">Nothing is ever deleted at the end of a week. "This week" is just a filtered view of the same log.</p>
    `,
  },
  {
    id: 'points-history', cat: 'points', title: 'Where is the history?',
    keywords: 'history log transactions record audit who what when list',
    body: () => {
      let n = 0;
      try { n = (store.getState().transactions || []).length; } catch (e) { n = 0; }
      return `
        <p>Open the <b>Records</b> tile. The <b>Transaction Log</b> down the left-hand side shows point changes, newest first: the time, which house, how many points, and the reason.</p>
        <p>Every change is stored with all four of those, whether it came from you, the shop, a quest, the dice or Battle Day. Nothing is ever silently overwritten.</p>
        <p>This browser currently holds <b>${n}</b> logged point change${n === 1 ? '' : 's'}.</p>
        <p class="help-callout">The screen itself only ever draws the most recent <b>400</b> entries — that is purely a display limit, so the page does not have to draw an unbounded list. It does not mean anything past 400 is lost: use <b>⬇ Export CSV</b> on the Records screen for a file with the <i>complete</i> history, every entry ever logged, or dig through your backup file <code>mrd-live-backup.json</code>, which also keeps everything.</p>
      `;
    },
  },

  // ======================= PLACE OF THE WEEK =======================
  {
    id: 'potw-what', cat: 'potw', title: 'What happens when you launch it',
    keywords: 'place of the week potw voyage globe fly cinematic what happens intro',
    body: `
      <p>Place of the Week is a five-stage voyage. You tap one button and it runs itself.</p>
      <ol class="help-steps">
        <li><b>Launch screen</b> — a spinning globe and a launch button.</li>
        <li><b>Intro</b> — the intro video plays full screen. If it cannot load, a bundled song plays instead and the voyage carries on.</li>
        <li><b>Flight</b> — Google Maps 3D flies to the coordinates and then orbits the place slowly. You can pan, rotate and zoom by hand.</li>
        <li><b>The lesson card</b> — quick facts, primary sources and the quiz, in tabs over the map.</li>
        <li><b>Your presentation</b> — if you attached a PDF, it opens full screen automatically.</li>
      </ol>
      <p>Press <b>Esc</b> at any point to come out of it.</p>
    `,
  },
  {
    id: 'potw-schedule', cat: 'potw', title: 'Setting up next week\'s destination',
    keywords: 'schedule week of monday next week destination switch automatic add place',
    body: () => {
      const d = new Date();
      const day = (d.getDay() + 6) % 7;
      d.setDate(d.getDate() - day + 7);
      const nextMon = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
      return `
        <ol class="help-steps">
          <li>Open <b>🗝️ Admin → Place of the Week</b>.</li>
          <li>Tap <b>Edit</b> on an existing destination, or add a new one.</li>
          <li>Fill in the name and where it is (step 1).</li>
          <li>Paste a Google Maps link for the location (step 3). <a href="#" data-help-go="potw-coords">Getting the link →</a></li>
          <li>Pick an intro video (step 4) and attach your presentation (step 5) if you have one.</li>
          <li>Set <b>Week of</b> to the <b>Monday</b> that week begins — for next week that is <b>${nextMon}</b>.</li>
          <li><b>Save.</b></li>
        </ol>
        <p class="help-callout">You do not have to remember to switch it over. On Monday the app looks at today's date, finds the destination whose week contains it, and uses that one. If no destination is scheduled for this week, it falls back to the one marked active in Admin.</p>
        <p>Set up as many weeks ahead as you like — each destination just waits for its week.</p>
      `;
    },
  },
  {
    id: 'potw-coords', cat: 'potw', title: 'Where do the coordinates come from?',
    keywords: 'coordinates latitude longitude google maps link paste location lat lng short link',
    body: `
      <ol class="help-steps">
        <li>Open <b>Google Maps</b> in another tab and find the place.</li>
        <li>Copy the whole link out of the browser's <b>address bar</b>.</li>
        <li>Paste it into the location box in step 3 of the destination editor.</li>
      </ol>
      <p>The app pulls the latitude and longitude out of the link and confirms with a green tick.</p>
      <h4>If it says the link is a short link</h4>
      <p>Short <code>maps.app.goo.gl</code> links (the ones the Share button gives you) do not contain the coordinates. Instead: <b>right-click the exact spot on the map → click the numbers at the top of the menu to copy them → paste those numbers in</b>.</p>
      <p>There is also a manual escape hatch — type the latitude and longitude straight into the two number boxes.</p>
    `,
  },
  {
    id: 'potw-gslides', cat: 'potw', title: 'Linking a Google Slides presentation',
    keywords: 'google slides presentation link embed publish to web editor toolbar auto advance auto-advance start slideshow player loads',
    body: `
      <ol class="help-steps">
        <li><b>🗝️ Admin → Place of the Week → Edit</b> the destination.</li>
        <li>Scroll to <b>Lesson Presentation</b> and choose <b>🔗 Google Slides</b>.</li>
        <li>Over in Google Slides itself: <b>File → Share → Publish to web</b>, then click <b>Publish</b>.</li>
        <li>On the <b>Link</b> or <b>Embed</b> tab (either is fine), <b>untick “Start slideshow as soon as the player loads.”</b> Leave <b>“Restart the slideshow after the last slide”</b> unticked too.</li>
        <li>Copy the link the dialog gives you and paste it into <b>Your Google Slides link</b> — there's a <b>❓ How do I get this link?</b> button right beside that field with these same steps.</li>
        <li><b>Save.</b></li>
      </ol>
      <h4>Why it has to be that link, and not the one from the address bar</h4>
      <p>While you're editing, the browser's address bar shows a link ending in <code>/edit</code> — that's the <b>editor</b>. It loads without complaint, which is exactly what makes it sneaky: instead of the presentation, the class sees your toolbar, the slide filmstrip and the speaker-notes box. It does not look broken, so nothing tips you off. <b>Save</b> now catches this and refuses the link with a message rather than letting it through silently.</p>
      <p>The <b>Publish to web</b> dialog has its own trap: it defaults to starting the slideshow the instant it loads, and its auto-advance timer has no "never" option — the slowest setting is still a timer. Left alone, the deck moves on its own while you're still talking to the class. Unticking <b>"Start slideshow as soon as the player loads"</b> fixes that at the source.</p>
      <p class="help-callout">Belt and braces: this app also forces safe playback (no auto-start, no auto-advance) whenever it shows the deck, so the class is protected even if a box gets left ticked by accident. Still worth unticking them yourself in Slides — good habit, and the same published link might get reused somewhere else later.</p>
      <p>Transitions, animations and embedded video all play, and your presenter remote works.</p>
      <p>Want a file you control completely, or need it to work with no internet at all? See <a href="#" data-help-go="potw-pdf">Adding a PDF presentation</a> instead — the offline-safe fallback, though it flattens animations and video.</p>
    `,
  },
  {
    id: 'potw-pdf', cat: 'potw', title: 'Adding a PDF presentation',
    keywords: 'pdf presentation slides deck upload attach google slides powerpoint keynote',
    body: `
      <ol class="help-steps">
        <li><b>🗝️ Admin → Place of the Week → Edit</b> the destination.</li>
        <li>Scroll to <b>Your lesson presentation</b>.</li>
        <li>Drop a <b>PDF</b> in, or choose a file. (Google Slides: <b>File → Download → PDF</b>, or for the full experience — transitions, animations, embedded video — see <a href="#" data-help-go="potw-gslides">Linking a Google Slides presentation</a> instead.)</li>
        <li><b>Save.</b></li>
      </ol>
      <p>The deck opens full screen automatically once the flight lands. While it is open: <b>arrow buttons</b> or arrow keys to move, <b>G</b> for a grid of all the slides, <b>Esc</b> to close.</p>
      <p class="help-warn"><b>Important:</b> PDFs, videos and images are stored inside this browser and are <b>not</b> included in your backup file. If you move to a different computer you must upload them again. <a href="#" data-help-go="data-move">Moving computers →</a></p>
    `,
  },
  {
    id: 'potw-testflight', cat: 'potw', title: 'Testing it before class (Test flight)',
    keywords: 'test flight preview try rehearse check before class practice',
    body: `
      <p>You never have to gamble on a destination working in front of thirty students.</p>
      <ol class="help-steps">
        <li>Open <b>🗝️ Admin → Place of the Week</b>.</li>
        <li>Tap <b>🧭 Test flight</b> on the destination card — or, while editing, <b>🧭 Test flight from here</b> to try the coordinates you just pasted before saving them.</li>
      </ol>
      <p>It flies you there exactly as the real voyage would. It changes nothing, awards nothing and saves nothing. <b>Esc</b> to come back.</p>
    `,
  },
  {
    id: 'potw-video', cat: 'potw', title: 'Intro videos — choosing, adding, and when one will not play',
    keywords: 'video intro youtube song music play fails blocked rock classic',
    body: () => {
      let opts = [];
      try { opts = store.getPotwVideoOptions() || []; } catch (e) { opts = []; }
      return `
        <p>Step 4 of the destination editor has an <b>intro video</b> dropdown. The videos available on this computer right now:</p>
        <ul class="help-list">${opts.map((v) => `<li><b>${esc(v.label)}</b></li>`).join('') || '<li class="help-muted">None found.</li>'}</ul>
        <p>If your Admin panel offers a way to add your own, paste an ordinary YouTube link — the app converts it into the embeddable form for you. Once added, the video appears in this dropdown for every destination.</p>
        <h4>If the video does not play</h4>
        <p>YouTube needs internet. If the school network is down or blocking YouTube, the app plays a bundled song instead and the voyage continues to the map as normal — the class will not be left staring at a blank screen. Nothing is broken and you do not need to do anything.</p>
      `;
    },
  },
  {
    id: 'potw-quiz', cat: 'potw', title: 'Quiz bounties',
    keywords: 'quiz questions bounty answer points reward first correct',
    body: `
      <p>Each destination can carry a few short questions. During the voyage they sit in the <b>Quiz</b> tab of the lesson card.</p>
      <p>When a house answers one, you award the bounty to that house. Each question pays <b>once per week per destination</b> — relaunching the same voyage later cannot pay the same bounty twice, so you can replay a place safely.</p>
      <p>Edit the questions in <b>🗝️ Admin → Place of the Week → Edit → Extras → Quiz</b>. Right in that same Extras section is <b>Bounty points per question</b> — set whatever number you like per destination, so a quick knowledge check can pay less than a big cultural landmark if you want it to. Leave the box blank and it defaults to <b>50 points</b> per question.</p>
    `,
  },

  // ======================= QUESTS =======================
  {
    id: 'quests-how', cat: 'quests', title: 'How a quest works, start to finish',
    keywords: 'quest accept board how it works class quest take on active',
    body: `
      <ol class="help-steps">
        <li>A house opens the <b>Quests</b> tile and reads the board.</li>
        <li>They tap <b>Accept</b> on a quest. It becomes their active quest.</li>
        <li>They do the thing in the real world and bring you the proof you asked for.</li>
        <li><b>You</b> confirm it — either right on the Quests screen (the green <b>✓ Complete</b> and red <b>✗ Give Up</b> buttons under the active quest, each showing exactly how many points are at stake, e.g. "✓ Complete +40") or in <b>🗝️ Admin → Quests</b>. Either way, a confirmation card names the house, the quest and the exact points one more time before anything actually happens.</li>
      </ol>
      <p><b>One quest per house at a time.</b> While Camelot holds a quest, nobody else can take that same quest, and Camelot cannot take a second one.</p>
      <p>Points are never awarded by a student tapping something — a quest only ever pays out when you confirm it.</p>
    `,
  },
  {
    id: 'quests-confirm', cat: 'quests', title: 'Confirming a completed quest',
    keywords: 'confirm complete quest verify approve award sign off',
    body: `
      <p>There are two places to do this — they do exactly the same thing, so use whichever you're already looking at.</p>
      <p><b>Fastest, on the Quests screen:</b></p>
      <ol class="help-steps">
        <li>The house's active quest sits at the top of the screen.</li>
        <li>Tap the green <b>✓ Complete</b> button under it — it shows the reward right on the button, e.g. <b>"✓ Complete +40"</b>.</li>
        <li>A confirmation card names the house and the quest one more time. Tap <b>Confirm</b> and the points land.</li>
      </ol>
      <p><b>Or from Admin:</b></p>
      <ol class="help-steps">
        <li>Open <b>🗝️ Admin → Quests</b>.</li>
        <li>Find the house under <b>Active Quests</b>.</li>
        <li>Tap <b>Confirm Completion</b>.</li>
      </ol>
      <p>The house is awarded the quest's points, the completion is archived with the date, and the quest leaves that house's slot.</p>
      <p>If the quest is <b>repeatable</b> it goes back on the board for anyone (including the same house) to take again. If it is one-time, it is gone for the rest of the term.</p>
    `,
  },
  {
    id: 'quests-fail', cat: 'quests', title: 'What if a house gives up?',
    keywords: 'give up fail abandon quit penalty steal drop quest',
    body: `
      <p>Two different things, and the difference matters:</p>
      <ul class="help-list">
        <li><b>Gave up / failed</b> — the house is charged a penalty and the quest goes back on the board, where <b>another house can pick it up</b>. Unless you set a different number, the penalty is <b>half the quest's reward</b>, rounded. Failing should sting without erasing a week's work.</li>
        <li><b>Accepted by mistake</b> — return it quietly with no penalty at all. Use this when it was your slip, not theirs.</li>
      </ul>
      <p>On the Quests screen the red <b>✗ Give Up</b> button under the active quest shows the exact penalty right on it, e.g. <b>"✗ Give Up −20"</b> — no guessing what it will cost. Tapping it does not deduct anything by itself: a confirmation card names the house, the quest and the exact points lost, and only tapping <b>Confirm</b> there actually applies it.</p>
      <p>Both this and "accepted by mistake" also live in <b>🗝️ Admin → Quests</b>, next to the active quest.</p>
    `,
  },
  {
    id: 'quests-catalog', cat: 'quests', title: 'Editing the quest list',
    keywords: 'catalog edit add quest points repeatable one time penalty create custom type kind icon emoji',
    body: () => {
      let n = 0;
      try { n = (store.getQuestCatalog() || []).length; } catch (e) { n = 0; }
      return `
        <p>The app ships with a starter catalogue (currently <b>${n}</b> quests) — food drives, library challenges, campus cleanups, perfect attendance and so on. Edit them freely in <b>🗝️ Admin → Quests → Quest Catalog</b>.</p>
        <p>Each quest has:</p>
        <ul class="help-list">
          <li><b>Title and description</b> — say exactly what proof you want, e.g. "before and after photos".</li>
          <li><b>Type</b> — Service 🤝, Academic 📚, Community ❤️ or Habit ⭐. It also supplies the card's icon whenever the quest has no icon of its own.</li>
          <li><b>Icon</b> — an optional emoji just for this quest, like 🧹 for a cleanup or 🏛️ for a museum quest. Leave it empty to fall back to the Type's icon instead. <a href="#" data-help-go="quests-icons">Picking an icon →</a></li>
          <li><b>Points</b> — scale these to effort. The shipped ones run from 10 to 50.</li>
          <li><b>Penalty</b> — deducted if the house gives up. Defaults to half the points.</li>
          <li><b>Repeatable</b> — on means any house can take it again after someone finishes it (good for "attend a school event"). Off means it leaves the board for good.</li>
        </ul>
        <p>Deleting a quest also clears it from any house currently holding it.</p>
      `;
    },
  },
  {
    id: 'quests-icons', cat: 'quests', title: 'Quest kinds and quest icons — the picture on the card',
    keywords: 'quest type kind icon emoji category service academic community habit picker symbol picture card fallback empty blank',
    body: () => {
      let kinds = [];
      try { kinds = Object.values(store.QUEST_TYPES || {}); } catch (e) { kinds = []; }
      return `
        <p>Every quest carries two separate things that end up as one picture on its card: a <b>kind</b>, and — optionally — its <b>own icon</b>.</p>
        <h4>Kind: the fallback</h4>
        <p>Every quest is one of four kinds, chosen with the row of buttons labelled <b>Type</b> in the quest editor (<b>🗝️ Admin → Quests → + New Quest</b>, or ✏️ on an existing one):</p>
        <ul class="help-list">
          ${kinds.map((k) => `<li>${k.icon} <b>${esc(k.label)}</b> — <span class="help-muted">${esc(k.blurb)}</span></li>`).join('') || '<li class="help-muted">Not available right now.</li>'}
        </ul>
        <p>Whichever kind you pick becomes that quest's icon on the board — <i>unless</i> the quest has its own icon set, which wins instead.</p>
        <h4>Icon: the quest's own picture</h4>
        <p>Under <b>Icon (optional)</b>, right next to Type, you can type any single emoji — 🧹 for Campus Cleanup Crew, 🏛️ for Museum of Us, and so on. A live preview beside the box ("Shows on the board as") shows exactly what will appear.</p>
        <p class="help-callout"><b>Leaving the box empty is meaningful, not an oversight.</b> An empty icon box does not mean "no icon" — the card falls back to the kind's icon instead (🤝 📚 ❤️ ⭐ above), so nothing on the board is ever blank.</p>
        <h4>Typing an emoji into the box</h4>
        <p>You do not need to go hunting for one online — your computer already has a picker built in. Click into the Icon box, then:</p>
        <ul class="help-list">
          <li><b>Mac:</b> press <b>Ctrl + Cmd + Space</b></li>
          <li><b>Windows:</b> press the <b>Windows key + .</b> (period)</li>
        </ul>
        <p>Pick an emoji from the picker that pops up and it drops straight into the box.</p>
      `;
    },
  },

  // ======================= SHOP & BATTLE =======================
  {
    id: 'shop-basics', cat: 'shop', title: 'How buying works',
    keywords: 'shop buy purchase spend cost afford magic shop balance target duel loadout',
    body: () => {
      const duel = isDuelNow();
      return `
      <ol class="help-steps">
        <li>Open the <b>Magic Shop</b> tile.</li>
        <li>Pick the house that is buying.</li>
        <li>Tap an item. Items the house cannot afford — or is not allowed to hold any more of right now — are greyed out.</li>
        <li>Confirm. The cost comes off immediately.</li>
      </ol>
      <p>What happens next depends on <b>which Battle Day rule set is running</b> — there are two, they use different items, and only one is active at a time. This computer is currently set to <b>${duel ? "Mr. D's rules" : 'Hit points'}</b>; switch either way in <b>🗝️ Admin → ⚔️ Battle Day</b>. <a href="#" data-help-go="battle-day">Both rule sets, side by side →</a></p>
      ${duel ? `
      <p>Under <b>Mr. D's rules</b> (the default), buying an attack or a defense doesn't do anything to anyone yet — it just gets held by the buying house, ready for later. A house may hold only <b>one attack and one defense at a time</b> (the Bag of Holding adds a single extra slot, not two) — see <a href="#" data-help-go="duel-loadout">One attack, one defense — and the Bag of Holding</a>. Utility items — the Stone of Seeing, the Shroud of Secrecy, the Time Turner, the Bag of Holding itself — don't count against that limit. <a href="#" data-help-go="duel-flow">How a Battle Day throw actually plays out →</a></p>
      ` : `
      <p>Under <b>Hit points</b>, a <b>shield</b> or a damage-halving relic starts protecting the house the instant you confirm, and a <b>wildcard</b> rolls its dice right there in the shop and applies the result on the spot. But an <b>attack item</b> — an attack, a steal or a pierce weapon — does none of that yet. Nobody picks a target at the shop counter, and nothing happens to anyone's points or hit points there. Buying one of these simply adds it to that house's <b>armoury</b> — a stockpile of weapons waiting to be used — ready to be spent as a strike on <a href="#" data-help-go="battle-day">Battle Day</a>. <a href="#" data-help-go="battle-hp">How strikes and hit points work →</a></p>
      `}
      <p>Items are paid for with <b>term</b> points, not this week's points. Every purchase is logged with the reason "Bought: <i>item name</i>".</p>
    `;
    },
  },
  {
    id: 'shop-effects', cat: 'shop', title: 'What each type of item does (Hit points mode)',
    keywords: 'attack steal shield pierce reduce wild effect types items list hit points',
    body: () => {
      const duel = isDuelNow();
      const rows = [
        ['Attack', 'attack', 'Buying one doesn’t hit anyone. It goes straight into the buyer’s armoury as a weapon saved for Battle Day. Only when that house later spends it there as a strike does it remove hit points (HP) from whoever it lands on — and even then a shield can block it outright, or a halving relic cut it down.'],
        ['Steal', 'steal', 'Also stockpiled at purchase, just like an attack — nothing happens until it’s spent as a strike on Battle Day. When it lands, it takes HP off whichever house is leading, and the buyer’s own house is credited points equal to whatever HP the strike actually took — nothing if it was blocked, half if it was halved.'],
        ['Shield', 'shield', 'Starts protecting the buyer the instant you buy it, blocking every incoming strike for a number of hours.'],
        ['Pierce', 'pierce', 'Stockpiled at purchase like any other attack item. When it’s spent as a strike, it ignores shields AND halving — it always removes its full HP amount.'],
        ['Halve (Mythic)', 'reduce', 'Halves all incoming strike damage for a number of hours, starting the moment it’s granted. Cannot be bought — only granted by a natural 20.'],
        ['Wildcard', 'wild', 'A random swing, for the buyer or against them, up to the listed amount — this one still happens immediately at the shop counter with its own dice roll. It is never stockpiled.'],
      ];
      return `
        <p class="help-lede">Attack, Steal and Pierce work differently from everything else in the shop: buying one of these weapons does not do anything to anyone yet. It only fills the buyer's armoury. Nothing about points or hit points changes until that weapon is actually used as a strike on <a href="#" data-help-go="battle-hp">Battle Day</a>.</p>
        ${duel ? `<p class="help-warn">This article describes the <b>Hit points</b> rule set, which is <b>not</b> the one running on this computer right now — Battle Day is currently set to <b>Mr. D's rules</b> instead, and its items work differently (see <a href="#" data-help-go="duel-items">The weapon list</a>). Switch rule sets any time in <b>🗝️ Admin → ⚔️ Battle Day</b>; whichever set is off keeps its own items and your edits to them exactly as you left them.</p>` : ''}
        <table class="help-table">
          <thead><tr><th>Type</th><th>What it does</th><th>In the shop, when this mode is on</th></tr></thead>
          <tbody>
            ${rows.map(([label, kind, desc]) => {
              const items = duel ? [] : shopItemsByKind(kind);
              return `<tr><td><b>${label}</b></td><td>${desc}</td><td class="help-muted">${
                items.length ? items.map((i) => `${esc(i.emoji || '')} ${esc(i.name)}${i.mythicOnly ? '' : ` <span class="help-nowrap">(${i.cost} pts)</span>`}`).join('<br>')
                  : (duel ? 'Hit points mode is off — nothing to show here right now.' : '—')
              }</td></tr>`;
            }).join('')}
          </tbody>
        </table>
        <p class="help-callout">You can change any of these, or invent your own, whenever Hit points is the active rule set — see <a href="#" data-help-go="shop-create">Creating your own item</a>. For the full rules on hit points and how a strike plays out, see <a href="#" data-help-go="battle-hp">Hit points, strikes and prizes</a>.</p>
      `;
    },
  },
  {
    id: 'shop-matchups', cat: 'shop', title: 'How attacks and defences interact (Hit points mode)',
    keywords: 'matchup blocked shield halved pierce combat rules damage interaction which wins hit points',
    body: () => `
      ${isDuelNow() ? `<p class="help-warn">This article describes the <b>Hit points</b> rule set, which is <b>not</b> the one running on this computer right now — Battle Day is currently set to <b>Mr. D's rules</b>, where nearly every attack has exactly one specific counter (and the Catapult has none at all) instead of a shared shield/halving/pierce order. See <a href="#" data-help-go="duel-items">The weapon list: every attack and its counter</a>, and <a href="#" data-help-go="duel-flow">how a Battle Day throw plays out</a>. Switch rule sets any time in <b>🗝️ Admin → ⚔️ Battle Day</b>.</p>` : ''}
      <p class="help-lede">This is about the moment a weapon is actually <b>used</b> — a strike on Battle Day — not about buying it. Buying an attack, steal or pierce item only stockpiles it in the buyer's armoury; nothing below happens until that weapon is spent as a strike. There is one rule for what happens then, applied in this order: <b>a shield blocks the whole strike; otherwise a halving defence cuts it in half; a pierce ignores both.</b></p>
      <p>Take a plain <b>20-HP strike</b> (from the Catapult Volley, spent out of the armoury) landing on a house that is:</p>
      <table class="help-table">
        <thead><tr><th>Target's defence</th><th>Plain 20-HP strike</th><th>20-HP <b>pierce</b> strike</th></tr></thead>
        <tbody>
          <tr><td>No defence</td><td><b>20</b> HP lost</td><td><b>20</b> HP lost</td></tr>
          <tr><td>Shielded</td><td><b>Blocked</b> — 0 lost</td><td><b>20</b> HP lost</td></tr>
          <tr><td>Damage halved (Mythic relic)</td><td><b>10</b> HP lost</td><td><b>20</b> HP lost</td></tr>
          <tr><td>Shielded <i>and</i> halved</td><td><b>Blocked</b> — 0 lost</td><td><b>20</b> HP lost</td></tr>
        </tbody>
      </table>
      <p>Halving always rounds to the nearest whole HP, and a strike that gets through at all still takes at least <b>1 HP</b> off — a halved hit can never round all the way down to nothing.</p>
      <p>A pierce always lands in full, which is why pierce weapons cost more than plain attacks of the same size.</p>
      <p><b>Steals</b> follow exactly the same rule when the strike lands. The only difference is what happens to the buyer's own house: it is credited points equal to whatever HP the strike actually took — a blocked steal gains the thief nothing.</p>
      <p>Positive points never route through any of this. You can always award points to a house no matter what defences it has up.</p>
      <p>Remember, none of this happens at the Magic Shop counter — it all plays out later, when a stockpiled weapon is spent on <a href="#" data-help-go="battle-day">Battle Day</a>. <a href="#" data-help-go="battle-hp">The full walkthrough of hit points, strikes and prizes →</a></p>
    `,
  },
  {
    id: 'shop-blocked', cat: 'shop', title: 'Why was that attack blocked? (Hit points mode)',
    keywords: 'blocked shield why nothing happened attack failed no damage defence hit points',
    body: () => `
      ${isDuelNow() ? `<p class="help-warn">This article describes <b>Hit points</b> mode, which is <b>not</b> the one running on this computer right now — Battle Day is currently set to <b>Mr. D's rules</b>. Under those, "blocked" means the defender was secretly holding the one item that counters that exact attack — see <a href="#" data-help-go="duel-flow">how a Battle Day throw plays out</a> for the reveal-and-counter step. Switch rule sets any time in <b>🗝️ Admin → ⚔️ Battle Day</b>.</p>` : ''}
      <p>Because the target had a shield running when the strike landed. Nothing gets checked against a shield when a weapon is <i>bought</i> — buying an attack, steal or pierce item just puts it in the buyer's armoury. The shield check happens later, on <b>Battle Day</b>, at the exact moment a house spends that stockpiled weapon as a strike. A shield blocks <b>every</b> ordinary strike aimed at its house until it expires — it is not a chance, it is a certainty.</p>
      <p>To see what is currently protecting whom, open <b>🗝️ Admin</b> and look at <b>🛡️ Active Defenses</b>. It lists every shield and halving effect with the time left, and lets you clear one if a class talked itself into a corner.</p>
      <p>Ways through a shield:</p>
      <ul class="help-list">
        <li>Buy a <b>pierce</b> weapon ahead of time and spend it as the strike — it ignores shields entirely.</li>
        <li>Wait for the shield to run out (shields last between 12 and 48 hours depending on the item).</li>
      </ul>
      <p>Curious exactly how much HP gets through when a strike is only halved, or how a pierce compares? See <a href="#" data-help-go="shop-matchups">How attacks and defences interact</a>.</p>
    `,
  },
  {
    id: 'shop-mythic', cat: 'shop', title: 'Mythic relics (Hit points mode)',
    keywords: 'mythic relic natural 20 nat20 reward free item oracle spy network lookout hit points',
    body: () => {
      const duel = isDuelNow();
      let items = [];
      try { items = store.getMythicRewards() || []; } catch (e) { items = []; }
      return `
        ${duel ? `<p class="help-warn">Mythic relics belong to the <b>Hit points</b> rule set, which is <b>not</b> the one running on this computer right now — Battle Day is currently set to <b>Mr. D's rules</b>, and none of its items are marked mythic-only out of the box. That's why the list below is empty: it isn't broken, there's just nothing configured to hand out under the active rule set. Rolling a natural 20 still awards points as normal — see <a href="#" data-help-go="dice-prophecy">The d20 prophecy table</a>. If you want a natural-20 relic under Mr. D's rules, add your own mythic-only item in <a href="#" data-help-go="shop-create">Creating your own item</a>, or switch to Hit points in <b>🗝️ Admin → ⚔️ Battle Day</b> to bring these three back.</p>` : ''}
        <p>Mythic relics are the only items that cannot be bought at any price. They are granted by <b>rolling a natural 20 on the Die of Destiny</b> — one relic per 20.</p>
        <p>The relics on this computer:</p>
        <ul class="help-list">
          ${items.map((i) => `<li>${esc(i.emoji || '✨')} <b>${esc(i.name)}</b> — ${esc(i.desc)}</li>`).join('') || '<li class="help-muted">None configured.</li>'}
        </ul>
        <p>When a house rolls 20 the app offers the relic list on screen; tap one and it is applied to that house immediately.</p>
      `;
    },
  },
  {
    id: 'shop-create', cat: 'shop', title: 'Creating your own shop item',
    keywords: 'create item custom new shop editor add own effect cost emoji image duel slot counter dice',
    body: () => {
      const duel = isDuelNow();
      return `
      <ol class="help-steps">
        <li>Open <b>🗝️ Admin → 🔮 Shop</b>.</li>
        <li>Add a new item, or edit one that exists.</li>
        <li>Give it a <b>name</b>, an <b>emoji</b> (or upload a small picture), and a <b>cost</b> in points.</li>
        ${duel ? `
        <li>Choose which <b>slot</b> it belongs to: <b>attack</b>, <b>defense</b>, or <b>utility</b>. Attack and defense are the two slots a house may only hold one of at a time (the Bag of Holding adds one extra slot, which they may fill either way) — see <a href="#" data-help-go="duel-loadout">One attack, one defense — and the Bag of Holding</a>. Utility items don't count against that limit.</li>
        <li>Choose the <b>effect</b>. An attack item does <b>damage</b> (removes points), <b>steal</b> (removes points from the target and gives the attacker whatever was actually taken), or <b>freeze</b> (stops a house earning, and stops it attacking, for a number of <i>school</i> days). A defense item <b>blocks</b> whichever attacks you tick. For damage and steal, set the <b>dice</b> (e.g. <code>2d6</code>) and the <b>multiplier</b> (e.g. 100, so 2d6 becomes 2d6 × 100 when the app rolls it live on screen). For freeze, the dice decide how many days.</li>
        <li>Damage items also have a <b>Houses hit at once</b> box. Leave it at <b>1</b> for a normal attack, or set it to <b>2</b> to build something like the Catapult, which makes you pick a second house and strikes both off one roll. <span class="help-fineprint">The box will accept 3 or 4, but Battle Day only ever asks for one extra house, so anything above 2 behaves exactly like 2. Stick to 1 or 2.</span></li>
        ` : `
        <li>Choose the <b>effect</b>: attack, steal, shield, pierce, halve or wildcard — and the amount. What that amount means depends on the effect: for <b>attack, steal and pierce</b> it is <b>hit points (HP)</b> removed by a strike on Battle Day, not points — buying the item does not take anything from anyone yet, it just adds the weapon to the buyer's armoury for later. For <b>shield</b> and <b>halve</b> the amount is hours of protection. For <b>wildcard</b> the amount is still points, because a wildcard resolves immediately, right at the shop counter, with its own dice roll.</li>
        `}
        <li>Write a <b>description</b>. This is the bit students read, so it is worth a sentence of history.</li>
        <li><b>Save.</b> It appears in the shop instantly.</li>
      </ol>
      ${duel ? `
      <p class="help-callout">Sizing a new attack? Compare it against <a href="#" data-help-go="duel-items">The weapon list</a> so you know whether 2d6 × 100 is a light jab or as heavy as the Catapult's 3d6 × 100.</p>
      ` : `
      <p class="help-callout">Sizing an attack, steal or pierce weapon? Compare the HP amount you're setting against the hit-point totals in <a href="#" data-help-go="battle-hp">Hit points, strikes and prizes</a> so you know whether 20 HP is a light tap or close to a knockout.</p>
      `}
      <p>Two rules the editor enforces so nothing can be saved that the app will not honour: an item must have a real effect type, and anything that is not a Mythic relic must cost more than zero.</p>
      <p>Deleting an item you dislike is permanent — it will not come back on the next reload.</p>
      <p class="help-fineprint">The Magic Shop keeps a separate set of items for each Battle Day rule set. Editing here only touches whichever one is active right now (<b>${duel ? "Mr. D's rules" : 'Hit points'}</b>) — switch in <b>🗝️ Admin → ⚔️ Battle Day</b> and the shop swaps over to the other set, with its own items and your past edits to them intact.</p>
    `;
    },
  },
  {
    id: 'battle-day', cat: 'shop', title: 'Battle Day',
    keywords: 'battle day combat strike victory defeat arena swords ignite hit points hp duel mr d rules mode which switch',
    body: () => {
      const duel = isDuelNow();
      let tScore = 10;
      try { tScore = store.getCombat().teacherScore || 10; } catch (e) { tScore = 10; }
      return `
      <p>Battle Day is a full-screen contest mode. Tap the tile, then tap the big <b>⚔️ BATTLE DAY!</b> button, and the arena opens. It asks <b>who is attacking</b>, then <b>who they are attacking</b>, and lays the two out facing each other with a <b>VS</b> between them — the attacker on the left, the defender on the right. Along the top are a <b>🛒 Magic Shop</b> button (so a house can buy something without leaving the fight) and <b>🏳️ End Battle</b>.</p>
      <p>Across the bottom, in both rule sets, is a <b>👩‍🏫 Teacher scoring</b> row: one chip per house with a <b>+${tScore}</b> and a <b>−${tScore}</b> button. That is you awarding or deducting by hand — it is not a house attack, it spends no items and rolls no dice. It is there so you can settle something on the spot without leaving the arena.${duel ? ' <span class="help-fineprint">That number is set in the Hit-points battle-rules card, which is hidden while Mr. D\'s rules are running — so under Mr. D\'s rules these buttons stay at whatever it was last set to. The <b>±</b> button in the top bar can award any amount at any time.</span>' : ''}</p>
      <p>Battle Day can be run under <b>two completely different rule sets</b>, and only one is ever active at a time:</p>
      <ul class="help-list">
        <li><b>Mr. D's rules</b> (the default, and the one this handbook shows first) — a house holds one attack and one defense at a time, chosen in secret. When an attack is thrown, the defender's held item is revealed; the right defense cancels it outright, otherwise the app rolls the damage dice on screen in front of the class and the total comes straight off the target's points. <a href="#" data-help-go="duel-flow">The full step-by-step →</a></li>
        <li><b>Hit points</b> — the earlier model, kept fully working as an alternative. Houses have hit points that refill every Battle Day; strikes remove HP instead of points, and when a house hits zero HP the winner takes a points prize while the loser keeps everything it earned. <a href="#" data-help-go="battle-hp">The full rules →</a></li>
      </ul>
      <p>Right now, on this computer, Battle Day is set to <b>${duel ? "Mr. D's rules" : 'Hit points'}</b>. Change it any time in <b>🗝️ Admin → ⚔️ Battle Day</b> — switching swaps the Magic Shop's items over too, since each rule set has its own list, and switching back finds your edits to that shop exactly as you left them.</p>
      <p class="help-warn"><b>Switching is not a cosmetic change.</b> As well as swapping the shop over, it <b>empties every house's holdings</b> — anything they had bought and not yet used is gone, in both directions, and it does not come back when you switch back. That is on purpose: an item bought under one rule set means nothing under the other. Your <b>points, the whole log, quests, the planner and every other setting are untouched.</b> If a class has spent real points on items this week, finish the week before switching.</p>
      <p>To come out, tap <b>🏳️ End Battle</b> at the top right — that takes you back to the "The houses stand ready…" screen, ready to ignite again. (<b>Esc</b> does <i>not</i> close the arena; it only backs out of a pop-up sitting on top of it, such as the Catapult's second-house question. Tapping the crest at the top left leaves for the dashboard as usual.)</p>
      <p>Under Mr. D's rules, ending the battle also makes every house's holdings <b>secret again</b> — anything revealed by a Stone of Seeing or by a strike landing goes back to face-down for next week. What each house owns is not lost, only hidden.</p>
      <p>Everything that happened is in the points log like any other award.</p>
    `;
    },
  },
  {
    id: 'battle-hp', cat: 'shop', title: 'Hit points, strikes and prizes — Battle Day’s other rule set',
    keywords: 'battle day hit points hp combat prize attack punching down strike defeat victory arena refill gap percent flat hpbase hpper500 alternative other mode',
    body: () => {
      const c = store.getCombat();
      const rule = store.PRIZE_RULES[c.prizeRule] ? c.prizeRule : 'gap';
      const houses = houseNames();
      const duel = isDuelNow();
      const hpRows = houses.map((h) => {
        let pts = 0, hp = 0;
        try { pts = Math.max(0, store.getTotal(h.id, 'term')); hp = store.getMaxHp(h.id); } catch (e) { /* leave at 0 */ }
        return `<tr><td><span class="help-dot" style="background:${esc(h.accent)}"></span> <b>${esc(h.name)}</b></td><td>${pts.toLocaleString()} pts</td><td><b>${hp}</b> HP</td></tr>`;
      }).join('');
      const ruleRows = Object.entries(store.PRIZE_RULES).map(([id, def]) => {
        const now = id === 'gap' ? `${c.gapShare}% of the gap`
          : id === 'percent' ? `${c.prizePercent}% of their total`
          : `${c.prizeFlat} pts flat`;
        const marker = id === rule ? '👉 ' : '';
        return `<tr><td>${marker}<b>${esc(def.label)}</b></td><td>${esc(def.blurb)}</td><td class="help-nowrap">${esc(now)}</td></tr>`;
      }).join('');
      return `
        <p class="help-lede">Battle Day can run under two rule sets, and this article covers <b>Hit points</b> — the earlier of the two, and still fully working, but ${duel ? "<b>not</b> the one running on this computer right now" : 'the one currently running on this computer'}. Hit points are completely separate from house points. Points are the score and the currency you already know; HP only exists during a fight, and is simply what a strike takes away.</p>
        <p class="help-callout">${duel
          ? `Battle Day is currently set to <b>Mr. D's rules</b> instead — see <a href="#" data-help-go="duel-flow">how a Battle Day plays out under those</a>. Switch back to Hit points any time in <b>🗝️ Admin → ⚔️ Battle Day</b>; this computer remembers which shop items and edits belong to each rule set.`
          : `This is the active rule set on this computer right now. <b>Mr. D's rules</b> are also available — see <a href="#" data-help-go="duel-flow">how a Battle Day plays out under those instead</a> — switch any time in <b>🗝️ Admin → ⚔️ Battle Day</b>.`}</p>

        <h4>Before the battle: buying weapons</h4>
        <p>Houses spend <b>points</b> in the <b>🔮 Magic Shop</b> to buy weapons ahead of time. Offensive items — attacks, steals, pierces — are <b>stockpiled</b>: buying one puts it in that house's armoury rather than firing it immediately, so a house can buy on Tuesday and save the weapon for Friday's battle. Shields and damage-halving items work differently and start protecting the moment they're bought.</p>

        <h4>When Battle Day starts: HP refills</h4>
        <p>Every house's HP jumps back up to its <b>maximum</b> — nobody ever arrives already half-beaten from last week's fight. Right now, on this computer:</p>
        <table class="help-table">
          <thead><tr><th>House</th><th>Points (term)</th><th>Max HP this battle</th></tr></thead>
          <tbody>${hpRows}</tbody>
        </table>
        <p>Max HP is <code>${c.hpBase} + ${c.hpPer500} for every 500 points a house holds</code>. A house sitting on more points is a little tougher to knock out — a mild brake on everyone piling onto whoever is currently leading. Change either number in <b>🗝️ Admin → ⚙️ Settings → ⚔️ Battle rules</b>.</p>

        <h4>During the battle: strikes remove HP</h4>
        <p>Houses use the weapons already sitting in their armoury. Each strike removes <b>HP</b> — not points — and the usual defence rules still apply: a shield can block it outright, and a halving relic still cuts it in half. <a href="#" data-help-go="shop-matchups">How attacks and defences interact →</a> When a house's HP reaches <b>zero</b>, that fight is over.</p>

        <h4>The prize</h4>
        <p>The winner takes a <b>prize in points</b>, decided by whichever rule is set in Admin. <b>The loser never loses a single point</b> — a class is never punished for being ahead, or for losing a fight. Three rules are available:</p>
        <table class="help-table">
          <thead><tr><th>Rule</th><th>What it does</th><th>Set to, right now</th></tr></thead>
          <tbody>${ruleRows}</tbody>
        </table>
        <p class="help-callout"><b>Half the gap</b> (the default) is self-limiting — the prize shrinks as the trailing house catches up. Simulated over a 9-week term with houses earning unevenly, the best-behaved class still won the term overall, and the point spread between houses <b>narrowed</b>.</p>
        <p class="help-warn"><b>Share of their total compounds hard.</b> In that same simulation, prizes under this rule grew from <b>281 points to 1,671 points</b> as the weeks went on — battles alone created as many points as a whole term of good behavior — and the <b>worst-behaved class won the term</b>. This is simulated fact, not opinion. It's available because a teacher may want it, not because it's the advised choice.</p>
        <p><b>Fixed amount</b> never compounds, but if it is set below what weapons cost in the Magic Shop, nobody will ever bother attacking — there's nothing left to gain.</p>

        <h4>Punching down</h4>
        <p>${c.punchingDown
          ? 'Currently <b>allowed</b> on this computer — any house may attack any other house, regardless of who has more points.'
          : 'Currently <b>off</b> on this computer (the default) — a house may only attack one with <b>more</b> points than itself. That stops the leading class from farming the last-placed class every single week.'}</p>

        <p class="help-callout">Every number and rule above is teacher-editable in <a href="#" data-help-go="admin-settings">🗝️ Admin → ⚙️ Settings → ⚔️ Battle rules</a> — including a live preview of what any two houses would win right now.</p>
      `;
    },
  },
  {
    id: 'duel-flow', cat: 'shop', title: "Mr. D's rules: how a Battle Day plays out",
    keywords: 'duel attack defense reveal counter dice roll sequence throw steps how battle day works mr d rules',
    body: () => {
      const duel = isDuelNow();
      return `
        ${!duel ? `<p class="help-warn">Mr. D's rules are <b>not</b> the ones running on this computer right now — Battle Day is currently set to <b>Hit points</b> instead. See <a href="#" data-help-go="battle-hp">Hit points, strikes and prizes</a> for what's actually happening on your screen, or switch back in <b>🗝️ Admin → ⚔️ Battle Day</b>.</p>` : ''}
        <p class="help-lede">This is Mr. D's own game, transcribed from his own document, and it's the rule set Battle Day uses by default.</p>
        <ol class="help-steps">
          <li><b>Ahead of time, houses shop.</b> A house buys a defense from the Magic Shop and holds it quietly — nobody else knows which one, not even you, unless another house has spent a <b>Stone of Seeing</b> on them. An attack can be bought at any time too, including moments before it is thrown: there is a <b>🛒 Magic Shop</b> button right inside Battle Day, so nobody has to leave the arena to buy something.</li>
          <li><b>A house picks a target and throws an attack.</b> Open Battle Day, choose the attacking house, choose who they are aiming at, and tap the attack item they are spending. Nothing is spent and nobody is struck until you tap that item — picking a target costs nothing, so you can look around the board freely.</li>
          <li><b>If the weapon hits two houses, you choose the second one now.</b> Only <b>The Catapult</b> does this. A panel appears asking who <i>else</i> it hits, showing the two remaining houses. This happens <b>before anything at all is spent</b>, so <b>Cancel — do not use it yet</b> (or <b>Esc</b>) puts you straight back with the Catapult still sitting in its slot and no points moved. <a href="#" data-help-go="duel-items">More about the Catapult →</a></li>
          <li><b>The defender's held defense is revealed.</b> Whatever that house was quietly holding turns up on screen the moment the attack lands — for most of the term this is the only moment anyone finds out what they had. From then on that pairing stays face-up for the rest of the Battle Day.</li>
          <li><b>It either counters the attack, or it doesn't.</b> Nearly every attack has exactly one specific defense that stops it — see <a href="#" data-help-go="duel-items">The weapon list</a>. If the defender is holding that exact item, the attack is cancelled completely and nothing else below happens. <b>The Catapult is the one exception: nothing in the shop stops it.</b></li>
          <li><b>If it wasn't countered, the app rolls the damage dice for you, on screen.</b> You do not roll anything by hand and there is no box to type a total into. A tray drops down, the real 3D dice tumble and settle, and then the app builds the sum in front of the class one piece at a time: the faces that landed, then <b>=</b>, then what they add up to, then <b>×</b>, then the multiplier off the item card, then <b>=</b>, then the final number in big type. Underneath it sits a one-word caption saying what that number <i>is</i> — <b>DAMAGE</b>, <b>POINTS STOLEN</b> or <b>DAYS FROZEN</b>. Whatever the dice landed on is exactly what gets applied; nothing is decided behind the scenes and animated afterwards.</li>
          <li><b>The total comes off the defending house.</b> Most attacks simply remove that many points. Two of them — the Net of Entrapment and the Cloak of Invisibility — steal instead, so what is taken also lands on the attacker as a gain. <a href="#" data-help-go="duel-steal">Taking points vs. stealing them →</a></li>
          <li><b>Nobody can be taken below zero.</b> If the roll is bigger than the defending house owns, only what they actually have is taken, and the tray says so at the time — a small line reading "1500 rolled — but that is all they have left" sits under the big number. The log records the amount that really moved, not the amount rolled. <a href="#" data-help-go="deduct-points">More about the zero floor →</a></li>
          <li><b>If it was the Catapult, the second house is struck next.</b> The same single roll covers both — the dice are not thrown again. The two houses are hit <b>one at a time</b>: the defender card on the right simply becomes the second house, then the weapon flies across again. The second house gets its <b>own</b> defense check, so it can perfectly well block or fail to block independently of the first — though since nothing counters the Catapult, in practice both take it. The Catapult is spent <b>once</b>, not twice.</li>
          <li><b>What gets used up.</b> The <b>attack is always spent</b>, blocked or not — a correct guess by the defender still costs the attacker their weapon, and that is exactly what makes guessing right worth something. The <b>defense is only spent when it actually blocks</b>. A house holding the Gauntlet of Defense that gets hit by a Sword keeps its Gauntlet: it was the wrong shield for that attack, so it was never used.</li>
        </ol>
        <p class="help-callout">Worked example: Camelot is quietly holding the Shield of Protection (bought Tuesday, told to nobody). Atlantis spends 450 points on the Sword of Destiny and throws it at Camelot on Friday. The Shield is revealed — it blocks the Sword — no dice get rolled, and no points move either way. Atlantis is out the 450 points it spent on the sword; Camelot is out its Shield, because it did its job; nobody lost a single point in the fight itself.</p>
        <p>One attack doesn't follow the roll-then-subtract pattern above at all: the Legendary Ice Axe doesn't remove points, it freezes. See <a href="#" data-help-go="duel-freeze">Frozen: what the Legendary Ice Axe does</a>.</p>
        <p class="help-fineprint">One oddity to expect on the Catapult's "who else does it hit?" panel: a house may appear greyed out with the note "They have fewer points than you — punching down is switched off in Admin." That switch belongs to the <b>Hit points</b> rule set and its control is hidden while Mr. D's rules are running, so you cannot currently turn it off from here. If it blocks a second house you wanted, pick the other one, or switch to Hit points in <b>🗝️ Admin → ⚔️ Battle Day</b> just long enough to turn punching down on — but read the warning about switching in <a href="#" data-help-go="battle-day">Battle Day</a> first, because switching empties everyone's holdings.</p>
      `;
    },
  },
  {
    id: 'duel-items', cat: 'shop', title: 'The weapon list: every attack and its counter',
    keywords: 'duel weapon list attacks defenses counters sword shield net gauntlet cloak bow catapult staff ra warhorse eye horus stone shroud time turner bag of holding prices cost',
    body: () => {
      const duel = isDuelNow();
      const FALLBACK_ATTACKS = [
        { id: 'sword', emoji: '🗡️', name: 'The Sword of Destiny', cost: 450, effect: { kind: 'damage', dice: '2d6', mult: 100 }, counteredBy: ['shield'] },
        { id: 'net', emoji: '🕸️', name: 'Net of Entrapment', cost: 600, effect: { kind: 'steal', dice: '2d6', mult: 100 }, counteredBy: ['gauntlet'] },
        { id: 'iceaxe', emoji: '🪓', name: 'The Legendary Ice Axe', cost: 500, effect: { kind: 'freeze', dice: '1d6' }, counteredBy: ['shield'] },
        { id: 'cloak', emoji: '🫥', name: 'Cloak of Invisibility', cost: 400, effect: { kind: 'steal', dice: '1d6', mult: 100, anonymous: true }, counteredBy: ['bow'] },
        { id: 'catapult', emoji: '🪨', name: 'The Catapult', cost: 1000, effect: { kind: 'damage', dice: '3d6', mult: 100, targets: 2 }, counteredBy: [] },
        { id: 'staffra', emoji: '☀️', name: 'The Staff of Ra', cost: 700, effect: { kind: 'damage', dice: '3d6', mult: 100 }, counteredBy: ['eye'] },
        { id: 'warhorse', emoji: '🐎', name: 'Warhorse', cost: 700, effect: { kind: 'damage', dice: '3d6', mult: 100 }, counteredBy: ['bow'] },
      ];
      const FALLBACK_DEFENSES = [
        { id: 'shield', emoji: '🛡️', name: 'The Shield of Protection', cost: 500, blocks: ['sword', 'iceaxe'] },
        { id: 'gauntlet', emoji: '🧤', name: 'Gauntlet of Defense', cost: 400, blocks: ['net'] },
        { id: 'bow', emoji: '🏹', name: 'Bow of Seeking', cost: 400, blocks: ['cloak', 'warhorse'] },
        { id: 'eye', emoji: '👁️', name: 'The Eye of Horus', cost: 500, blocks: ['staffra'] },
      ];
      const FALLBACK_UTILITY = [
        { id: 'stone', emoji: '🔮', name: 'The Stone of Seeing', cost: 1000, desc: 'Reveals what another House has chosen to do this week.' },
        { id: 'shroud', emoji: '🌫️', name: 'The Shroud of Secrecy', cost: 500, desc: 'Hides your actions from every other House for one week.' },
        { id: 'timeturner', emoji: '⏳', name: 'The Time Turner', cost: 1000, desc: 'Go back and change your items after you have been attacked.' },
        { id: 'bagofholding', emoji: '🎒', name: 'The Bag of Holding', cost: 500, desc: 'An extra weapon slot — carry two attack or two defense items at once.' },
      ];
      const attacks = duelItemsBySlot('attack') || FALLBACK_ATTACKS;
      const defenses = duelItemsBySlot('defense') || FALLBACK_DEFENSES;
      const utility = duelItemsBySlot('utility') || FALLBACK_UTILITY;
      const defenseNameOf = (id) => (defenses.find((d) => d.id === id) || {}).name || id;
      const attackNameOf = (id) => (attacks.find((a) => a.id === id) || {}).name || id;
      const effectLabel = (it) => {
        const e = it.effect || {};
        if (e.kind === 'freeze') return `Freeze ${esc(e.dice || '1d6')} days`;
        const dice = `${esc(e.dice || '')} × ${e.mult || 1}`;
        if (e.kind === 'steal') return `Steal ${dice}${e.anonymous ? ' (anonymous)' : ''}`;
        if (e.targets && e.targets > 1) return `Damage ${dice} to ${e.targets} houses`;
        return `Damage ${dice}`;
      };
      const attackRows = attacks.map((it) => {
        const counters = (it.counteredBy || []).map(defenseNameOf);
        return `<tr><td>${esc(it.emoji || '')} <b>${esc(it.name)}</b></td><td class="help-nowrap">${it.cost} pts</td><td>${effectLabel(it)}</td><td>${counters.length ? esc(counters.join(', ')) : '<span class="help-muted">nothing</span>'}</td></tr>`;
      }).join('');
      const defenseRows = defenses.map((it) => {
        const stops = (it.blocks || []).map(attackNameOf);
        return `<tr><td>${esc(it.emoji || '')} <b>${esc(it.name)}</b></td><td class="help-nowrap">${it.cost} pts</td><td>${esc(stops.join(', '))}</td></tr>`;
      }).join('');
      const utilRows = utility.map((it) => `<li>${esc(it.emoji || '')} <b>${esc(it.name)}</b> — <span class="help-nowrap">${it.cost} pts</span> — ${esc(it.desc || '')}</li>`).join('');
      return `
        ${!duel ? `<p class="help-warn">This lists Mr. D's rules' items, which are <b>not</b> the ones running on this computer right now — Battle Day is currently set to <b>Hit points</b>. The table below shows what ships by default; if you edited this shop while Mr. D's rules were active, your own version is what you will see once you switch back. Switch any time in <b>🗝️ Admin → ⚔️ Battle Day</b>.</p>` : ''}
        <p class="help-lede">Nearly every attack has exactly one defense that stops it completely — nothing else does. Buy the right one and hold it, and the attack that lands on you does nothing at all.</p>
        <p class="help-warn"><b>The one exception is The Catapult.</b> Nothing in the shop counters it — the "Countered by" column below says <i>nothing</i> for that row, and it means it literally. It is also the only attack that hits <b>two houses</b> with a single roll, which together is what the 1,000-point price tag is buying. <a href="#" data-help-go="duel-flow">How a two-house strike plays out →</a></p>
        <table class="help-table">
          <thead><tr><th>Attack</th><th>Cost</th><th>Effect</th><th>Countered by</th></tr></thead>
          <tbody>${attackRows}</tbody>
        </table>
        <table class="help-table">
          <thead><tr><th>Defense</th><th>Cost</th><th>Stops</th></tr></thead>
          <tbody>${defenseRows}</tbody>
        </table>
        <p>Utility items don't attack or defend — they change what a house can see or do:</p>
        <ul class="help-list">${utilRows}</ul>
        <p>Those one-line descriptions are the ones printed in the shop, for students. Here is what each one actually does when you tap it, which is narrower and more specific than the shop copy suggests. All four are bought like anything else, and none of them count against the one-attack-one-defense limit.</p>
        <h4>🔮 The Stone of Seeing — look at what one house is holding</h4>
        <p>It lives on the <b>Utility</b> row of a house's card inside Battle Day, and it is fussier than it sounds:</p>
        <ul class="help-list">
          <li>It <b>only works inside Battle Day</b>. There is nowhere else to use it.</li>
          <li>It belongs to whichever house is currently set as the <b>⚔️ Attacker</b> — that is the only house whose Stone slot can be tapped.</li>
          <li>It looks at whichever house is currently set as the <b>🛡️ Defender</b>. So you have to choose both houses first; until you have picked an opponent the Stone slot is greyed out and says so.</li>
          <li>What it shows is <b>what that house is holding</b> — their hidden defense slots turn face-up on their card, and they <b>stay</b> face-up for the rest of that Battle Day rather than flashing up once and vanishing.</li>
          <li>It is <b>spent even when it shows you nothing</b>. If the house you looked at has a Shroud of Secrecy up, you get a message saying so and the Stone is gone anyway. That is the risk the Shroud exists to create.</li>
        </ul>
        <p>Everything anybody has seen is forgotten when you close Battle Day, so next week's holdings start secret again.</p>
        <h4>🌫️ The Shroud of Secrecy — become unreadable for a week</h4>
        <p>Once a house owns one, a <b>Tap to raise</b> button appears in the Shroud slot on <b>that house's own card</b> in Battle Day — either side of the board, whichever side they happen to be sitting on. Tapping it:</p>
        <ul class="help-list">
          <li>Spends the Shroud (it is consumed on use, like an attack).</li>
          <li>Puts that house out of sight for <b>one week</b>. Any Stone of Seeing spent against them for the next seven days shows <b>nothing at all</b> — and the Stone is still used up, which is the whole point.</li>
          <li>Changes the slot to read <b>🌫️ Up until</b> and then the date it lifts, so the class can see that their 500 points bought something. Nothing else visible happens to them, which is exactly why that label matters.</li>
        </ul>
        <p>A Shroud does <b>not</b> stop attacks, block damage or hide a house from being targeted. It only blinds the Stone. You can lower one early in <b>🗝️ Admin → ⚔️ Battle Day → House status &amp; holdings</b>.</p>
        <h4>⏳ The Time Turner — take back the last attack that landed</h4>
        <p>Also a button on that house's own card in Battle Day. It undoes the <b>most recent strike that hit them</b>, and only that one:</p>
        <ul class="help-list">
          <li>If nothing has hit them yet, the button is <b>greyed out and tells you why</b> ("Nothing has hit that house yet — there is nothing to take back"), so it can never be wasted on nothing.</li>
          <li>Using it <b>deletes that strike's entries from the points log</b> rather than paying compensation. The history then reads as though the attack simply never happened — no confusing "+700 Time Turner" line for a class to argue about — and the points roll back up on their card so everyone watches it happen.</li>
          <li>If the strike being undone was a <b>freeze</b>, the freeze lifts too.</li>
          <li>It is consumed on use.</li>
        </ul>
        <p>Each house has its own "last thing that hit me", so when the Catapult strikes two houses, either of them can turn back its own half of it.</p>
        <h4>🎒 The Bag of Holding — one extra slot, forever</h4>
        <p>The odd one out: it is never spent and never expires. Once a house owns it, it simply carries one more item from then on. See <a href="#" data-help-go="duel-loadout">One attack, one defense — and the Bag of Holding</a> for exactly what "one more" means.</p>
        <p class="help-callout">Three prices above differ from Mr. D's own written rules, on purpose: a season simulated with his original numbers showed the <b>Sword of Destiny</b>, the <b>Staff of Ra</b> and the <b>Warhorse</b> each cost more to buy than they typically won back, so all three were priced down before term started — Sword of Destiny is <b>450</b> pts here (his document says 600), Staff of Ra is <b>700</b> pts (his document says 1000), and Warhorse is <b>700</b> pts (his document says 1000). Every price above is still only a starting point — open <b>🗝️ Admin → 🔮 Shop</b> and change any of them back to his originals, or to anything else, in a few taps. See <a href="#" data-help-go="shop-create">Creating your own shop item</a>.</p>
        <p>For the full sequence of a throw — reveal, counter, roll, apply — see <a href="#" data-help-go="duel-flow">Mr. D's rules: how a Battle Day plays out</a>.</p>
      `;
    },
  },
  {
    id: 'duel-loadout', cat: 'shop', title: 'One attack, one defense — and the Bag of Holding',
    keywords: 'duel loadout slot limit one attack one defense bag of holding two utility hold armoury',
    body: () => {
      const duel = isDuelNow();
      return `
        ${!duel ? `<p class="help-warn">This describes Mr. D's rules, which are <b>not</b> the ones running on this computer right now — Battle Day is currently set to <b>Hit points</b>, which has no holding limit like this at all. Switch back in <b>🗝️ Admin → ⚔️ Battle Day</b>.</p>` : ''}
        <p class="help-lede">Under Mr. D's rules, a house may hold exactly <b>one attack item and one defense item</b> at the same time — no more, no matter how many points it has banked.</p>
        <p>Try to buy a second sword while the first is still sitting unused, and the Magic Shop will not allow it — the house has to use or lose what it already holds first. This is not about affording it; it is a hard limit on how much a house may be carrying at once, so nobody quietly stockpiles five swords over a month and unloads them all in one afternoon.</p>
        <p>The <b>Bag of Holding</b> (500 pts, a utility item) buys <b>one extra slot — not one of each.</b> This is the part worth reading twice, because it is easy to assume otherwise: a house with the Bag can hold <b>three</b> items in total, and it chooses how to split them.</p>
        <ul class="help-list">
          <li><b>2 attacks + 1 defense</b> — go hunting.</li>
          <li><b>1 attack + 2 defenses</b> — dig in.</li>
          <li><b>Never 2 attacks and 2 defenses.</b> The shop will refuse the fourth item with "That is every slot full."</li>
        </ul>
        <p>Choosing between those two shapes is the whole point of the item — two of everything at the same 500 points would simply be strictly better with no decision in it. The cap on any one type is still two, so a house can never hold three swords.</p>
        <p>It does not expire and it is not spent the way an attack or a defense is; once a house owns it, the higher limit simply applies from then on. On the Battle Day cards, a house without the Bag shows its second slot as locked, with a padlock and the words "Bag of Holding unlocks this slot" — so the class can see exactly what they would be buying.</p>
        <p>Defenses are usually bought well ahead of a fight and held quietly — a house might buy the Shield of Protection on a Monday and not need it until Thursday. Attacks can be bought at any point too, including moments before they are thrown, since nothing happens until an attack is actually spent against a target. <a href="#" data-help-go="duel-flow">The full sequence of a Battle Day throw →</a></p>
        <p class="help-callout">Utility items — the Stone of Seeing, the Shroud of Secrecy, the Time Turner, and the Bag of Holding itself — do not count against the one-attack-one-defense limit at all. A house can hold as many of those as it can afford.</p>
      `;
    },
  },
  {
    id: 'duel-freeze', cat: 'shop', title: 'Frozen: what the Legendary Ice Axe does',
    keywords: 'freeze frozen ice axe legendary days cannot earn points duel',
    body: () => {
      const duel = isDuelNow();
      return `
        ${!duel ? `<p class="help-warn">This describes Mr. D's rules, which are <b>not</b> the ones running on this computer right now — Battle Day is currently set to <b>Hit points</b>, which has no freeze effect at all. Switch back in <b>🗝️ Admin → ⚔️ Battle Day</b>.</p>` : ''}
        <p class="help-lede">The Legendary Ice Axe is the one attack in Mr. D's rules that does not remove points at all. Instead, it freezes the target house so it cannot earn any points for a length of time decided by the roll.</p>
        <p>If the Ice Axe gets through — meaning the target was not holding the Shield of Protection — the app rolls <b>1d6</b> on screen, under the caption <b>DAYS FROZEN</b>. That is how many days the house is frozen for, starting from that day.</p>
        <h4>They are SCHOOL days, and that makes a 6 much longer than a week</h4>
        <p class="help-warn">The freeze counts <b>days you actually teach</b>. <b>Saturdays and Sundays do not count</b> and are skipped over, so a roll of <b>6</b> covers six school days and therefore spans <b>eight or more days on the calendar</b> — more than a full week of real time. This is deliberate (otherwise a Thursday roll would be half eaten by the weekend and the class that spent 500 points would feel cheated), but it does mean a high roll is a genuinely heavy punishment. If it turns out to be too heavy, you can end it early — see below.</p>
        <h4>Exactly what a frozen house can and cannot do</h4>
        <ul class="help-list">
          <li><b>Cannot earn.</b> Not a single point can land on them from anywhere until the freeze lifts — not from the <b>±</b> button, not from a quest, not from the Die of Destiny, not from a Place of the Week bounty. Every one of those is refused, and you are told why rather than left guessing.</li>
          <li><b>Cannot attack.</b> Their attack slots are greyed out and marked <b>❄️ Frozen</b> in Battle Day. They cannot throw anything at anybody.</li>
          <li><b>Can still be attacked.</b> Other houses may keep aiming at them.</li>
          <li><b>Can still lose points.</b> Deductions and enemy damage go through as normal.</li>
        </ul>
        <p>In short: being frozen is a punishment, not a hiding place. They keep every point they already have — the freeze stops the total growing, it does not take anything away.</p>
        <p class="help-callout"><b>Careful with quests while a house is frozen.</b> Confirming a quest as complete still files the completion and closes the quest, but the points cannot land, so the house does the work and gets nothing. If a frozen house finishes a quest, it is kinder to leave it confirmed until the thaw — or confirm it and hand the points over with the <b>±</b> button afterwards.</p>
        <h4>Ending a freeze early</h4>
        <p>It thaws on its own, but you are never stuck with it. Open <b>🗝️ Admin → ⚔️ Battle Day</b> and look at <b>⚔️ House status &amp; holdings</b> — every frozen house is listed there with the date it thaws and an <b>Un-freeze</b> button. Tap it and they can score again immediately.</p>
        <p>The Shield of Protection stops the Ice Axe exactly like it stops the Sword of Destiny: if the target is holding one, the freeze never happens, and the Ice Axe is simply spent for nothing.</p>
        <p>A freeze only affects the one house that got hit. The other three carry on completely as normal.</p>
      `;
    },
  },
  {
    id: 'duel-steal', cat: 'shop', title: 'Taking points vs. stealing them',
    keywords: 'steal net entrapment cloak invisibility damage remove vs stealing duel points gap anonymous',
    body: () => {
      const duel = isDuelNow();
      return `
        ${!duel ? `<p class="help-warn">This describes Mr. D's rules, which are <b>not</b> the ones running on this computer right now — Battle Day is currently set to <b>Hit points</b>, which has its own version of steal instead. See <a href="#" data-help-go="shop-effects">What each type of item does</a>. Switch back in <b>🗝️ Admin → ⚔️ Battle Day</b>.</p>` : ''}
        <p class="help-lede">Most attacks in Mr. D's rules simply remove points from whoever they hit — the total rolled comes off their side and that is the end of it. Two attacks work differently: they steal.</p>
        <p>The <b>Net of Entrapment</b> and the <b>Cloak of Invisibility</b> take points off the target <b>and</b> hand them to the attacker. Every other attack — the Sword of Destiny, the Catapult, the Staff of Ra, the Warhorse, and the Legendary Ice Axe (which freezes instead of removing points at all) — only removes; nobody gains from a plain hit.</p>
        <p>Why it matters when you are running the board: a plain hit changes one house's total. A steal changes two — it moves the gap between the two houses by <b>double</b>, since one side drops and the other rises by the same number. A Net of Entrapment that takes 700 points does not just cost the target 700 — it also hands the attacker 700, so the standings shift by 1,400 points in a single throw.</p>
        <h4>You cannot steal more than they actually had</h4>
        <p class="help-callout">This is the one thing about stealing that surprises people. The attacker gains <b>what was really taken</b>, not what the dice said. Roll 700 against a house that only holds 200, and that house drops to <b>zero</b> and the attacker gains <b>200</b> — not 700. The missing 500 does not come from anywhere, because there was nowhere to take it from, and inventing it would mint points out of thin air every time a poor house got robbed.</p>
        <p>You will see this happen live rather than having to work it out afterwards: the dice tray prints a line under the total saying something like "700 rolled — but that is all they have left", and the number that lands on the attacker's crest is the smaller, honest one. <a href="#" data-help-go="deduct-points">More about the zero floor →</a></p>
        <h4>How "anonymous" actually works on the Cloak</h4>
        <p>The Cloak of Invisibility is marked anonymous, and it is worth knowing exactly how thin that is, so you do not promise a class more secrecy than the app delivers.</p>
        <p>The <b>only</b> thing anonymity changes is the wording of the entry written on the <b>victim's</b> side of the points log. A normal attack writes "Net of Entrapment <b>from Camelot</b>"; the Cloak writes just "Cloak of Invisibility", with no name attached. That is the whole of it.</p>
        <p class="help-warn">Everything else still names the thief. The Battle Day screen says outright who struck whom and how much they looted, since you had to choose the attacking house to throw it in the first place — and the attacker's own log entry reads "Cloak of Invisibility on Camelot". So treat the Cloak as flavour and a slightly quieter ledger line, <b>not</b> as a genuinely secret theft. If you want the mystery in class, look away from the board and read out the totals instead.</p>
        <p>The <b>Bow of Seeking</b> counters the Cloak outright, so a house that suspects it is being robbed can buy the answer. The Net of Entrapment was never anonymous at all; its ledger line names the thief like any other attack.</p>
        <p>Blocked is blocked either way: if the target is holding the correct defense, a steal cancels completely, exactly like a plain attack — no points move for anyone.</p>
      `;
    },
  },

  // ======================= DICE =======================
  {
    id: 'dice-how', cat: 'dice', title: 'Rolling the Die of Destiny',
    keywords: 'dice roll d20 d6 d12 2d6 modes how to roll physics',
    body: `
      <ol class="help-steps">
        <li>Open the <b>Die of Destiny</b> tile.</li>
        <li>Pick <b>1d6</b>, <b>2d6</b>, <b>1d12</b> or <b>d20</b>.</li>
        <li>Tap the tray to roll. Real 3D dice tumble and physically settle on a face — the app reads the face they landed on, it does not pick a number and then animate it.</li>
      </ol>
      <p>1d6, 2d6 and 1d12 are just dice — no points attached, use them for whatever your lesson needs.</p>
      <p><b>d20 is the classroom one.</b> It shows an outcome plaque with a prophecy. <a href="#" data-help-go="dice-prophecy">The table →</a></p>
      <p>If the computer cannot do 3D graphics, the dice fall back to a simple spinning number. The result is just as valid.</p>
    `,
  },
  {
    id: 'dice-prophecy', cat: 'dice', title: 'The d20 prophecy table',
    keywords: 'prophecy table d20 outcomes catastrophe misfortune neutral small favor fortune mythic triumph 20 points edit editable customise custom',
    body: () => {
      let rows = [];
      try { rows = store.getDiceProphecy() || []; } catch (e) { rows = []; }
      const rangeLabel = (r) => (r.min === r.max ? String(r.min) : `${r.min}–${r.max}`);
      const ptsLabel = (r) => (r.points > 0 ? `+${r.points}${r.mythic ? ' + relic' : ''}` : r.points < 0 ? String(r.points) : 'no points');
      return `
        <p class="help-lede">This is exactly what is set up on this computer right now — it updates the moment you change anything in Admin.</p>
        <table class="help-table">
          <thead><tr><th>Roll</th><th>Outcome</th><th>What it means</th><th>Points</th></tr></thead>
          <tbody>
            ${rows.map((r) =>
              `<tr><td><b>${esc(rangeLabel(r))}</b></td><td>${esc(r.emoji || '')} <b>${esc(r.title)}</b></td><td>${esc(r.desc)}</td><td class="help-nowrap"><b>${esc(ptsLabel(r))}</b></td></tr>`).join('') || '<tr><td colspan="4" class="help-muted">Not available right now.</td></tr>'}
          </tbody>
        </table>
        <p>The <b>points, title, description and emoji</b> for every row above are teacher-editable in <b>🗝️ Admin → ⚙️ Settings → 🎲 Die of Destiny</b> — change any row to match how you want to run your own classroom. The roll <b>ranges</b> themselves (which numbers on the die trigger which outcome) are deliberately fixed, so every one of the 20 faces always maps to exactly one outcome with no gaps and no overlaps — a roll can never come up with nothing to show the class.</p>
        <h4>How the points actually get applied</h4>
        <p>Nothing happens automatically. The plaque shows a button for each house — tap the house you want it to land on and the points are awarded, logged with the reason "Die of Destiny: <i>outcome</i>".</p>
        <p><b>One award per roll.</b> Once you have tapped, the buttons stop responding until the next roll, so a double-tap cannot pay twice.</p>
        <p>Rows with <b>"no points"</b> are story beats, not scoring — on a Misfortune-type roll you simply pick who goes next.</p>
        <p>On a <b>mythic</b> roll (the top of the die) the house gets its points and you also get to grant one <b>Mythic relic</b>, once per roll — provided at least one is currently configured in the shop. ${isDuelNow() ? "Under <b>Mr. D's rules</b> (the active rule set right now), none are, by default — " : ''}<a href="#" data-help-go="shop-mythic">About relics →</a></p>
      `;
    },
  },

  // ======================= ADMIN =======================
  {
    id: 'admin-tour', cat: 'admin', title: 'The Admin panel at a glance',
    keywords: 'admin panel tabs key glyph teacher tour overview where is',
    body: `
      <p>Tap the faint <b>🗝️</b> at the top right. It is deliberately understated so students do not treat it as part of the game. The quick-points button hides itself while you are in here.</p>
      <ul class="help-list">
        <li><b>📅 Planner</b> — the calendar. Itineraries, homework, tests, quizzes, vacations and notes. <a href="#" data-help-go="admin-planner">More →</a></li>
        <li><b>Quests</b> — confirm completions, edit the quest catalogue.</li>
        <li><b>Shop</b> — edit the Magic Shop items.</li>
        <li><b>Place of the Week</b> — destinations, weekly scheduling, presentations, test flights.</li>
        <li><b>⚔️ Battle Day</b> — pick which rule set runs the fight, <b>Mr. D's rules</b> or <b>Hit points</b>, plus the settings that belong to whichever one is active: the prize rule, its number and the hit-point toughness settings for Hit points; nothing extra to set for Mr. D's rules beyond its own shop items. Underneath sits a live board, and <b>which board you get depends on the rule set</b>. Under Hit points it is <b>🛡️ Active Defenses</b>: every house's shield and damage-halving status, with a <b>Clear</b> button. Under Mr. D's rules it is <b>⚔️ House status &amp; holdings</b>: who is <b>frozen</b> (with <b>Un-freeze</b>), who is <b>shrouded</b> (with <b>Lower it</b>), and every single item each house is holding, each with a <b>Take back</b> button for a mis-tapped purchase. <a href="#" data-help-go="battle-day">More →</a></li>
        <li><b>❓ Help</b> — opens this handbook, straight to the section you need.</li>
        <li><b>⚙️ Settings</b> — term dates, theme, backups, your own Maps key, and the reset button. <a href="#" data-help-go="admin-settings">More →</a></li>
      </ul>
      <p>Several screens also carry a small <b>❓ How this works</b> link that jumps you straight to the right article in here.</p>
      <p>Tap the crest at the top left to leave Admin and go back to the dashboard.</p>
    `,
  },
  {
    id: 'admin-lock', cat: 'admin', title: 'The Teacher PIN: keeping students out of the controls',
    keywords: 'pin password lock locked unlock security student admin protect padlock forgot code',
    body: () => {
      const on = (() => { try { return lock.isEnabled(); } catch (e) { return false; } })();
      const status = on
        ? '<p class="help-ok"><b>The PIN is on.</b> Admin and anything that moves points will ask for it.</p>'
        : '<p class="help-warn"><b>No PIN is set.</b> Anyone who walks up to the board can award points or open Admin.</p>';
      return `
        ${status}
        <p>Set it up in <b>🗝️ Admin → ⚙️ Settings → 🔒 Teacher PIN</b>. Four to twelve digits, something you will still remember on a Monday morning. The boxes come pre-filled with <b>0314</b> to save you thinking of one — type over it if you would rather have your own.</p>
        <p><b>The PIN ships switched off.</b> Nothing in the app asks for it until you turn it on, so you can try everything out first and add the lock when you are ready.</p>

        <h4>What it asks for a PIN</h4>
        <ul class="help-list">
          <li>Opening the <b>Admin panel</b></li>
          <li>The <b>± button</b> in the top bar</li>
          <li>Awards and the <b>undo</b> button on the Records screen</li>
          <li>Marking a quest <b>complete</b> or <b>failed</b></li>
          <li>Paying out the <b>Die of Destiny</b> and its mythic relics</li>
          <li><b>Battle Day</b> scoring, and buying anything in the <b>Magic Shop</b></li>
          <li><b>Quiz bounties</b> during Place of the Week</li>
        </ul>

        <h4>What stays open on purpose</h4>
        <p>The parts students are supposed to do at the board: rolling the dice, taking on a quest, reading the standings and the ledger, and watching any of the presentations. None of those move points on their own.</p>

        <h4>You only type it once</h4>
        <p>After you enter it, it stays unlocked for <b>15 minutes</b> of teaching (you can change that to 5, 30 or 60 in the same place). So a Friday shop session costs you one PIN entry, not one per purchase.</p>
        <p>Walking away mid-lesson? <b>Shift-click</b> the 🗝️ key in the top bar — or press and hold it — to lock it again straight away. The key turns into a 🔒 when it is locked.</p>

        <h4>Be clear about what this is</h4>
        <p class="help-warn">This is a classroom door, not a safe. It stops a student walking up and tapping the board, which is the thing that actually happens. It is <b>not</b> real security: it does not lock or scramble your saved data, and a student who knows their way around a web browser can get past it. Do not treat it as protection for anything sensitive.</p>

        <h4>If you forget it — the recovery code</h4>
        <p>There is no "email me a reset": the app has no account and no server. Instead, when you turn the PIN on, the app writes an eight-character <b>recovery code</b>. It is printed on the Teacher PIN card in Settings — worth copying onto something in your desk — and it is saved inside every backup file.</p>
        <ol class="help-steps">
          <li>On the PIN pad, tap <b>Forgot your PIN?</b></li>
          <li>Open your most recent backup <code>.json</code> in any text editor (Notepad or TextEdit will do) and search for <b>recovery</b>.</li>
          <li>Type that code in. The PIN switches off and <b>nothing else changes</b> — every point, quest and setting stays exactly as it was.</li>
        </ol>
        <p class="help-warn">Without a backup file or the written-down code, the only way to clear the PIN is to clear this browser's site data — which erases the whole term along with it. That is one more reason to keep at least the daily backup file running (it is on by default): it is also your way back in. <a href="#" data-help-go="data-backup">More about backups →</a></p>
        <p class="help-fineprint">The recovery code is stored as plain readable text, which is what lets you find it in a backup. Anyone holding your backup file can therefore read it — so keep backups somewhere only you can reach, and treat the code as a key to the classroom, not to anything sensitive.</p>
      `;
    },
  },
  {
    id: 'admin-planner', cat: 'admin', title: 'Planner: a week or a whole semester',
    keywords: 'planner calendar plan itinerary homework test quiz vacation note events schedule',
    body: `
      <ol class="help-steps">
        <li>Open <b>🗝️ Admin → 📅 Planner</b>.</li>
        <li><b>Tap any date</b> to add something to it.</li>
        <li>Choose the type and which class period it applies to (or all of them).</li>
      </ol>
      <p>What you can put on a date:</p>
      <ul class="help-list">
        <li><b>Itinerary</b> — the running order for that day: bell ringer, lesson, challenge. Each core can have its own.</li>
        <li><b>Homework, Test, Quiz</b> — appears in the "due" list on the dashboard.</li>
        <li><b>Vacation</b> — a multi-day block for a break.</li>
        <li><b>Note</b> — anything else you want on screen that day.</li>
        <li><b>Term start / end markers</b> — for your own reference on the calendar.</li>
      </ul>
      <h4>Building a whole semester in one go</h4>
      <p>You do not have to type Monday's itinerary thirteen times.</p>
      <ol class="help-steps">
        <li>Build the itinerary for one day exactly how you want it. (<b>Copy from default</b> fills in the built-in sample if you want a starting point.)</li>
        <li>Tap <b>⧉ Duplicate to… (build a whole semester)</b>.</li>
        <li>Choose which weekdays it should land on, and over what date range.</li>
      </ol>
      <p>It copies those rows onto every chosen weekday for that class period. Anything already on those days is overwritten, and days you have marked as a vacation are skipped automatically.</p>
      <p>The Morning Dashboard reads the planner first and only falls back to its built-in sample schedule if you have not planned that day. So planning a whole semester up front is genuinely worth doing once — a quiet afternoon buys you a term of mornings.</p>
    `,
  },
  {
    id: 'admin-settings', cat: 'admin', title: 'Settings',
    keywords: 'settings term dates theme backup maps key reset danger zone pin lock screen colours colors award presets layout carousel grid battle rules hit points hp combat prize punching down',
    body: () => `
      <ul class="help-list">
        <li><b>Term Timeline</b> — the Monday your term starts and how many weeks it runs. This drives "Week N of M" in the top bar and the term totals. ${termLine()}</li>
        <li><b>⚔️ Battle rules</b> — settings for <b>Hit points</b> mode: the prize rule (half the gap, share of their total, or a fixed amount) and its number, whether houses may "punch down" on a house with fewer points, and the hit-point settings that decide how tough each house is to beat. Includes a live preview of what any two houses would win right now. Only matters while Battle Day is set to Hit points — <a href="#" data-help-go="battle-day">both rule sets, and how to switch →</a></li>
        <li><b>Display &amp; Theme</b> — dark or light, and optional seasonal decoration. <a href="#" data-help-go="theme">More →</a></li>
        <li><b>🔒 Teacher PIN</b> — put a short PIN in front of the Admin panel and anything that awards or takes away points. Off until you turn it on. <a href="#" data-help-go="admin-lock">More →</a></li>
        <li><b>⚡ Quick award buttons</b> — the one-tap awards that appear on the Records screen. Edit the labels and point values to match what you actually say in class.</li>
        <li><b>🎨 Screen colours</b> — lock the Home screen, Quests or Records to one fixed colour instead of following whichever house is active. <a href="#" data-help-go="screen-colours">More →</a></li>
        <li><b>🗂️ Screen layout</b> — show Quests and the Magic Shop as a scrolling grid or a one-card-at-a-time carousel. Purely visual. <a href="#" data-help-go="screen-layout">More →</a></li>
        <li><b>Maps API key</b> — leave blank unless you have your own. <a href="#" data-help-go="maps-key">More →</a></li>
        <li><b>🔊 Sound effects</b> — replace any built-in beep, or the spoken Battle Day line, with your own recording. <a href="#" data-help-go="admin-sfx">More →</a></li>
        <li><b>Backup &amp; Restore</b> — a daily backup file to Downloads (on by default, no setup), an optional backup folder for second-by-second saving, and restoring either one. <a href="#" data-help-go="data-backup">More →</a></li>
        <li><b>⚠️ Danger Zone</b> — wipes everything and starts over. You have to type <b>RESET</b> to confirm, and there is no undo.</li>
      </ul>
      <p class="help-warn">Before you ever touch the Danger Zone, make sure you have a backup folder connected and a dated snapshot in it.</p>
    `,
  },
  {
    id: 'admin-sfx', cat: 'admin', title: 'Recording your own sound effects (and the Battle Day war cry)',
    keywords: 'sound effects sfx audio record recording voice mp3 m4a custom sounds war cry battle cry replace beep microphone',
    body: () => {
      const rows = Object.entries(store.SFX_SLOTS).map(([name, meta]) => {
        const cur = store.getSfx(name);
        const status = cur
          ? `<span class="help-ok" style="display:inline-block;padding:2px 8px;margin:0;border-radius:8px;">🎙️ your recording — <code>${esc(cur)}</code></span>`
          : (name === 'battlecry'
              ? `<span class="help-warn" style="display:inline-block;padding:2px 8px;margin:0;border-radius:8px;">🤖 not recorded — read aloud by the computer's speech voice</span>`
              : `<span class="help-muted">🔊 built-in sound</span>`);
        return `<tr><td><b>${esc(meta.label)}</b><br><span class="help-muted">${esc(meta.hint)}</span></td><td>${status}</td></tr>`;
      }).join('');
      return `
        <p class="help-lede">Swap any of the app's six sound cues — five short beeps and one spoken line — for your own recording. Anything you leave alone keeps working exactly the way it does today, so there is zero risk in trying this.</p>
        <h4>Right now, in this app</h4>
        <table class="help-table">
          <thead><tr><th>Sound</th><th>Status</th></tr></thead>
          <tbody>${rows}</tbody>
        </table>
        <h4>Recording on your phone and getting it onto the computer</h4>
        <ol class="help-steps">
          <li>Open your phone's built-in recorder — <b>Voice Memos</b> on iPhone, <b>Recorder</b> or <b>Voice Recorder</b> on Android — and record the line or sound. For the war cry, something said with energy works best, e.g. "It's Battle Day. Attack!" Keep it to about 1–3 seconds; for the shorter cues (sword clash, blocked hit, points chime, dice rattle) aim for under a second.</li>
          <li>Get the file onto the computer any way that is easy for you: <b>AirDrop</b> it straight across if it's a nearby Mac, email or message it to yourself and download the attachment, or drop it into a cloud-drive folder (Google Drive, iCloud Drive, Dropbox, OneDrive) that is synced on both devices.</li>
          <li>On the computer, move the file into this app's <code>sfx</code> folder — it sits right next to the <code>images</code> and <code>music</code> folders in the app's files. Any filename works; something simple like <code>battle-cry.mp3</code> or <code>sword-clash.mp3</code> is easiest to find again later. There's also a short README inside the <code>sfx</code> folder itself with the same instructions, if you ever need a reminder without opening this handbook.</li>
          <li>In the app, go to <b>🗝️ Admin → ⚙️ Settings → 🔊 Sound effects</b> and find the row for that sound.</li>
          <li>Type the path into the box — for example <code>sfx/battle-cry.mp3</code> — and it saves automatically as soon as you click away or press Tab.</li>
          <li>Tap <b>▶ Test</b> right there on that row to hear exactly what the class will hear. It plays through the app's real sound path, not a separate preview, so what you hear in Test is what plays during the lesson.</li>
        </ol>
        <h4>Formats and length</h4>
        <p>Use <b>.mp3</b> or <b>.m4a</b> — a plain phone voice memo is fine as-is, with no editing software needed. Keep clips <b>short</b>: these fire in the middle of play, so a long clip for a quick cue like the sword clash or the points chime will still be finishing when the next thing happens on screen. The war cry and the fanfare can run a little longer, up to about three seconds, since nothing else needs to interrupt them right away.</p>
        <h4>The Battle Day war cry is the special one</h4>
        <p>Every other sound above has a built-in synthesized beep as a safety net, so an empty box is completely harmless there. The war cry is different: it has <b>no beep to fall back on</b>, because a beep standing in for spoken words would be worse than nothing. Until you record it, the app reads that line aloud itself, in the computer's own robotic speech voice. Recording it here replaces that robot voice with yours — it is genuinely the single sound in this list most worth doing first.</p>
        <h4>If a file won't play</h4>
        <p class="help-callout">A missing, misspelled or broken file never breaks the app. For every sound except the war cry, the built-in beep quietly takes over instead — the same way it does if you never assign a file at all. So it's always safe to experiment with a path here; the worst case is simply that nothing changes and you keep hearing the beep. If <b>▶ Test</b> stays completely silent for every sound (not just one), check the master sound switch — the speaker icon in the top bar, or press <b>M</b> — is turned on. <a href="#" data-help-go="sound">Turning sound on and off →</a></p>
        <h4>Keep copies elsewhere</h4>
        <p class="help-warn"><b>These recordings are not included in your backup .json.</b> Like your videos and images, they live as plain files in the <code>sfx</code> folder rather than inside the app's saved data, so exporting or restoring a backup never copies them. Keep your original recordings somewhere safe too — the same cloud folder or drive you used to get them onto the computer works well — in case you ever reinstall the app or move it to a new machine.</p>
      `;
    },
  },

  // ======================= DATA =======================
  {
    id: 'data-where', cat: 'data', title: 'Where does my data actually live?',
    keywords: 'data storage where saved cloud account browser localstorage privacy offline',
    body: `
      <p class="help-lede">Inside this browser, on this computer. There is no account, no server and no cloud. Nothing you type ever leaves the machine.</p>
      <p>That is excellent for privacy and it is the one thing that can bite you, so it is worth knowing exactly what that means:</p>
      <ul class="help-list">
        <li>Open the app in a <b>different browser</b> and it will look brand new — the data does not follow you.</li>
        <li>Open it on a <b>different computer</b> and the same is true.</li>
        <li>If someone clears this browser's site data, everything goes with it.</li>
      </ul>
      <p>Which is why backups matter more than anything else in this handbook — a daily one saves itself with no setup, and a backup folder does even better. <a href="#" data-help-go="data-backup">How backups work →</a></p>
    `,
  },
  {
    id: 'data-backup', cat: 'data', title: 'How backups work (and what they leave out)',
    keywords: 'backup folder connect autosave restore json snapshot save file system access daily download downloads safety net',
    body: () => {
      const h = backup.health();
      const bannerClass = h.level === 'folder' ? 'help-ok' : h.level === 'daily' ? 'help-callout' : 'help-warn';
      const banner = `<p class="${bannerClass}"><b>Right now:</b> ${esc(h.message)}</p>`;
      return `
        ${banner}
        <h4>Two safety nets, not one</h4>
        <p>This app keeps everything — every point, the calendar, quests, the shop, your destinations and settings — in this one browser, on this one computer. Nothing is on a server anywhere, which is great for privacy but means <i>you</i> are the one who has to make sure a copy exists elsewhere. There are two ways the app does that for you automatically, and they cover different gaps:</p>
        <ul class="help-list">
          <li><b>⬇️ The daily backup file</b> — on by default, needs nothing from you, and works in <i>any</i> browser. It only saves once a school day though, so the worst you could lose is that one day's points.</li>
          <li><b>🔄 The folder backup</b> — saves within a couple of seconds of every single change, which is real-time protection. But it needs a one-time setup, only works in Chrome or Edge, and can occasionally need reconnecting after the browser updates.</li>
        </ul>
        <p>Having <b>both</b> switched on is the safest setup, and costs you nothing extra to do — the daily file is already running unless you have turned it off.</p>

        <h4>⬇️ The daily backup file</h4>
        <p>The first time you change anything on a given school day — award a point, mark a quest done, anything — the app quietly saves a file named like <code>mrd-backup-${esc(new Date().toISOString().slice(0, 10))}.json</code> straight into this computer's ordinary <b>Downloads</b> folder. The same place any file you download normally lands. No folder to pick, no permission box to say yes to.</p>
        <p>It is on by default. If you ever want to check it, or turn it off because the folder backup below is doing the job, that switch lives in <b>🗝️ Admin → ⚙️ Settings → Backup &amp; Restore</b>, along with a <b>Save a backup now</b> button for taking one on demand — worth tapping before a holiday, or to hand a copy to someone.</p>

        <h4>🔄 The folder backup — better, but needs setting up</h4>
        <ol class="help-steps">
          <li>Open <b>🗝️ Admin → ⚙️ Settings → Backup &amp; Restore</b> (or use the button at the bottom of this page).</li>
          <li>Tap <b>🔄 Connect backup folder…</b> and pick somewhere safe — a Google Drive or OneDrive folder is ideal, because then the backups sync off the computer too.</li>
          <li>Say yes when the browser asks for permission to save files there.</li>
        </ol>
        <p>Once connected you also get <b>Save now</b>, <b>Restore from folder…</b> and <b>Disconnect</b> in the same place, plus a line telling you when the last save happened. A couple of seconds after <i>any</i> change, the app writes <code>mrd-live-backup.json</code> to that folder. Once a day it also writes a dated snapshot, <code>mrd-backup-2026-01-31.json</code>, so you can go back to a particular day if you need to.</p>
        <p class="help-callout">Browsers sometimes drop folder permission after an update. If that happens the app tells you, and you just pick the same folder again. The <a href="#" data-help-go="system-check">System check</a> watches for it.</p>

        <h4>What a backup contains</h4>
        <p><b>Included:</b> every point ever awarded, the calendar, quests, the shop catalogue, your destinations and their schedule, house edits and all settings — from either kind of backup.</p>
        <p class="help-warn"><b>Not included: media.</b> Videos, PDFs and images you have uploaded are far too big for a backup file and stay in the browser's own storage. Restoring a backup on a new computer brings back everything except those, and you will need to upload them again.</p>

        <h4>Bringing a backup back in (restoring)</h4>
        <p>This always happens in the same place: <b>🗝️ Admin → ⚙️ Settings → Backup &amp; Restore</b>. Tap <b>⬆ Import backup</b> and choose the file — whichever is newest, whether that's the one in Downloads or the one in your connected folder — or tap <b>Restore from folder…</b> if a folder is connected. Either way it asks you to confirm first, because it replaces <i>everything</i> currently on screen and cannot be undone.</p>

        <h4 style="margin-top:16px">The one thing neither backup protects you from</h4>
        <p class="help-warn"><b>Both</b> of these backups write their file to <i>this computer</i>. If this computer is ever replaced, or the school wipes its browser profile, both are gone at the same time as everything else — unless you have already copied a backup file somewhere else: a Google Drive folder, a memory stick, or just emailed to yourself. That copy, sitting outside this computer, is the only thing that survives the computer itself disappearing. It costs two minutes and is well worth doing once a term.</p>

        <p class="help-actions"><button type="button" class="help-btn help-btn-primary" data-help-action="connect-backup">Connect a backup folder now</button></p>
      `;
    },
  },
  {
    id: 'data-move', cat: 'data', title: 'Moving to another computer',
    keywords: 'move computer transfer new laptop copy migrate another machine home school',
    body: `
      <ol class="help-steps">
        <li>On the <b>old</b> computer, get a fresh backup file: if you have a folder connected, Settings → <b>Save now</b>; either way, Settings → <b>Save a backup now</b> takes a fresh daily file too, or use <b>⬇ Export backup</b>. Any of these is fine — you just want the newest one.</li>
        <li>Copy that file (and your backup folder, if you use one) to the new computer any way that's easy — a USB stick, a synced Drive folder, or emailing it to yourself all work.</li>
        <li>On the <b>new</b> computer, start the app the same way you start it now.</li>
        <li>Go to <b>🗝️ Admin → ⚙️ Settings → Backup &amp; Restore</b> and tap <b>⬆ Import backup</b>, choosing the file you copied over. (Or, if you copied a whole backup folder and are in Chrome or Edge, <b>🔄 Connect backup folder…</b> then <b>Restore from folder…</b>.)</li>
        <li>Re-upload your PDFs and any videos — <a href="#" data-help-go="potw-pdf">those do not travel in the backup</a>. Run <a href="#" data-help-go="system-check">System check</a>; it will name any destination whose presentation is missing.</li>
      </ol>
    `,
  },
  {
    id: 'data-cleared', cat: 'data', title: 'What if site data gets cleared?',
    keywords: 'cleared lost data gone wiped clear browsing data cache disaster recover',
    body: `
      <p class="help-warn">"Clear browsing data" in the browser menu wipes this app completely — points, calendar, uploaded PDFs, and even the memory of which folder your backups live in. Never use it on this computer.</p>
      <p>The good news: neither kind of backup file lives in that browser storage, so clearing it does not touch backup files already sitting in your Downloads folder or your connected backup folder — those are ordinary files on the computer's disk, completely separate from the app's own memory.</p>
      <h4>If it has already happened</h4>
      <ol class="help-steps">
        <li>Do not panic and do not start re-entering points.</li>
        <li>Open the app, go to <b>🗝️ Admin → ⚙️ Settings → Backup &amp; Restore</b>.</li>
        <li>If you had a backup folder connected: tap <b>🔄 Connect backup folder…</b>, pick it again, then <b>Restore from folder…</b> and confirm. You are back to within a few seconds of where you were.</li>
        <li>If you did not: tap <b>⬆ Import backup</b> and choose the newest <code>mrd-backup-YYYY-MM-DD.json</code> file in this computer's Downloads folder — that is the daily backup file, and it saves itself even if you never set anything up. Confirm the restore. You are back to within a day of where you were.</li>
        <li>Re-upload your PDFs and videos.</li>
      </ol>
      <h4>If there is truly no backup file anywhere</h4>
      <p>That only happens if the daily backup file was switched off <i>and</i> no folder was ever connected. In that case the data is gone and cannot be recovered by anyone. Check <b>🗝️ Admin → ⚙️ Settings → Backup &amp; Restore</b> today and make sure at least the daily file is on — it takes no setup at all. <a href="#" data-help-go="data-backup">Here is how it works →</a></p>
      <p>If you genuinely want a clean slate, use <b>Settings → Danger Zone</b> instead. It only clears this app, not the browser.</p>
    `,
  },
  {
    id: 'data-newterm', cat: 'data', title: 'Starting a new term or a new school year',
    keywords: 'new term reset year end semester start over fresh archive rollover',
    body: `
      <h4>A new term, keeping the history</h4>
      <ol class="help-steps">
        <li>Make sure today's dated snapshot exists — in your backup folder if you have one connected, or in Downloads if you are relying on the daily backup file. Tap <b>Save a backup now</b> in Settings if you want to be certain.</li>
        <li><b>🗝️ Admin → ⚙️ Settings → Term Timeline</b>: set <b>Term Start</b> to the new Monday and the number of weeks.</li>
      </ol>
      <p>The week counter restarts and the dashboard follows. Points are <b>not</b> zeroed — term totals still count everything in the log.</p>
      <h4>A new school year, starting from zero</h4>
      <ol class="help-steps">
        <li>Copy the latest dated snapshot — out of your backup folder, or out of Downloads — and keep it somewhere off this computer too (a Drive folder, a memory stick, or emailed to yourself). That is your archive of last year.</li>
        <li><b>🗝️ Admin → ⚙️ Settings → Danger Zone</b>, type <b>RESET</b>.</li>
        <li>Set the new term dates. Reconnect your backup folder if you use one; the daily backup file needs nothing done to it.</li>
        <li>Re-upload the presentations you still want.</li>
      </ol>
      <p class="help-warn">The reset takes the shop catalogue, quest edits, planner and destinations with it. If you spent time on those, keep the snapshot file — it holds all of them.</p>
    `,
  },

  // ======================= HOUSEKEEPING =======================
  {
    id: 'houses-edit', cat: 'setup', title: 'Renaming or recolouring the houses',
    keywords: 'rename house colour color artwork crest banner change name motto customise',
    body: () => `
      <p>The four houses on this computer right now:</p>
      <ul class="help-list">
        ${houseNames().map((h) => `<li><span class="help-dot" style="background:${esc(h.accent)}"></span> <b>${esc(h.name)}</b> — <i>${esc(h.motto)}</i> (Core ${esc(String(h.core))})</li>`).join('')}
      </ul>
      <h4>Changing the artwork</h4>
      <p>This you can do yourself, with no buttons involved — the app simply loads picture files from its own folder. Replace a file, keep the same filename, and the app picks it up on the next reload.</p>
      <ul class="help-list">
        <li><code>images/camelot-shield.png</code> — the crest, used on cards, the leaderboard and the top bar. Square-ish, transparent background.</li>
        <li><code>images/header-camelot.jpg</code> — the wide banner across the top of that house's screen.</li>
      </ul>
      <p>The same two names exist for <code>atlantis</code>, <code>valhalla</code> and <code>rivendell</code>. Keep a copy of the originals first so you can always put them back.</p>
      <h4>Changing names, mottos and colours</h4>
      <p>The app is built so all four can be renamed and recoloured without losing a single point — the change flows straight through to the top bar, the standings and the battle cards. There is a full editor for this already built into the app — you never need to ask anyone else to do it.</p>
      <ol class="help-steps">
        <li>Open <b>🗝️ Admin → ⚙️ Settings → 🏰 Houses</b>.</li>
        <li>Tap <b>Edit</b> on the house you want to change.</li>
        <li>Change any of: <b>Name</b>, <b>Motto</b>, <b>Accent colour</b> (pick with the swatch or type a hex code), the <b>Crest image</b> filename and the <b>Banner image</b> filename.</li>
        <li>Watch the <b>live preview</b> at the top of the box update as you type, so you see exactly how the name, motto and colour will look before you commit to them.</li>
        <li><b>Save.</b></li>
      </ol>
      <p>Changed your mind? Tap <b>Reset</b> next to that house back on the Houses list to put its name, motto, colour and artwork back to how it shipped — one house at a time, without touching the other three.</p>
      <p class="help-callout">The crest and banner fields only hold a <i>filename</i>, e.g. <code>images/camelot-shield.png</code>. To use different artwork, put the new picture file in the app's <code>images/</code> folder first — either under the existing filename to swap it in place, or under a new filename you then type into the field.</p>
    `,
  },
  {
    id: 'screen-colours', cat: 'setup', title: 'Screen colours: follow the house, or lock one in',
    keywords: 'colour color screen theme accent match house lock quests bronze records home dashboard customise appearance camelot atlantis valhalla rivendell',
    body: () => {
      let rows = '';
      try {
        rows = Object.keys(store.MODULE_THEMES || {}).map((id) => {
          const t = store.getModuleTheme(id);
          return `<li><b>${esc(t.label)}</b> — <span class="help-muted">${t.matchHouse ? 'following the active house right now' : 'locked to its own colour right now'}</span></li>`;
        }).join('');
      } catch (e) { rows = ''; }
      return `
        <p><b>🗝️ Admin → ⚙️ Settings → 🎨 Screen colours.</b></p>
        <p>Three screens read this setting:</p>
        <ul class="help-list">${rows || '<li class="help-muted">Not available right now.</li>'}</ul>
        <p>Each one has a <b>Match house colour</b> toggle next to a colour swatch:</p>
        <ul class="help-list">
          <li><b>On (the usual setting)</b> — the screen glows whichever house is currently up: red for Camelot, blue for Atlantis, gold for Valhalla, green for Rivendell.</li>
          <li><b>Off</b> — pick one colour with the swatch next to the toggle, and the screen stays that colour all the time, no matter which core you switch to.</li>
        </ul>
        <p class="help-callout">Why bother switching it off? A screen that recolours itself every single period can start to feel like four different apps rather than one. That is exactly why the <b>Quests</b> board ships already locked to its own bronze, instead of cycling through the house colours the way the Home screen and Records do.</p>
        <p class="help-warn"><b>This only covers the three screens above.</b> The Magic Shop, Battle Day, the Die of Destiny, the Council of Four and Place of the Week each have their own colours built into the app — nothing in Screen colours changes any of those.</p>
        <p><b>Reset</b> next to a screen puts it back the way it shipped.</p>
      `;
    },
  },
  {
    id: 'screen-layout', cat: 'setup', title: 'Grid or carousel: how Quests and the Magic Shop are shown',
    keywords: 'layout carousel grid scroll swipe view quests shop cards smartboard arrows one at a time board',
    body: () => {
      let rows = '';
      try {
        rows = Object.entries(store.LAYOUT_SCREENS || {}).map(([id, def]) => {
          const layout = store.getLayout(id);
          return `<li><b>${esc(def.label)}</b> — <span class="help-muted">set to ${layout === 'carousel' ? 'Carousel' : 'Grid'} right now</span></li>`;
        }).join('');
      } catch (e) { rows = ''; }
      return `
        <p><b>🗝️ Admin → ⚙️ Settings → 🗂️ Screen layout.</b></p>
        <p>Two screens read this setting:</p>
        <ul class="help-list">${rows || '<li class="help-muted">Not available right now.</li>'}</ul>
        <p>Each one has a two-button switch:</p>
        <ul class="help-list">
          <li><b>▦ Grid (the default)</b> — several cards on screen at once. Best for scanning a longer list of quests or shop items.</li>
          <li><b>◗ Carousel</b> — one big card at a time with arrows on either side to move through the rest. Nothing to scroll up and down, which is the whole point at a smartboard — you're standing at the front of the room, not holding a mouse.</li>
        </ul>
        <p class="help-callout">This is a pure look-and-feel switch. Point values, quest catalogues, shop costs and everything they do stay exactly the same either way — you're only choosing how the cards are arranged on screen.</p>
        <p>Switching takes effect the moment you tap it; there's nothing else to save.</p>
      `;
    },
  },
  {
    id: 'theme', cat: 'setup', title: 'Light mode, dark mode and seasonal decoration',
    keywords: 'theme light dark mode seasonal snow leaves colours appearance bright projector',
    body: `
      <p><b>🗝️ Admin → ⚙️ Settings → Display &amp; Theme.</b></p>
      <ul class="help-list">
        <li><b>🌙 Dark</b> — the default. Best on a projector or a smartboard in a dim room.</li>
        <li><b>☀️ Light</b> — better in a bright room or on a very washed-out projector.</li>
        <li><b>Seasonal theming</b> — a quiet garland along the top of the bar and a few slow drifting leaves or snowflakes, chosen from the month. Deliberately subtle; it never gets in the way of anything.</li>
      </ul>
      <p>Place of the Week, Battle Day and the dice tray stay dark in both modes on purpose — they are meant to feel like the lights going down.</p>
    `,
  },
  {
    id: 'sound', cat: 'setup', title: 'Turning sound on and off',
    keywords: 'sound audio mute volume speaker silent quiet sfx voice off',
    body: () => {
      let on = true;
      try { on = store.getSettings().soundEnabled !== false; } catch (e) { on = true; }
      return `
        <p>The app makes small sounds: a coin for points, a thud for a deduction, swords on Battle Day, a fanfare for a natural 20, and one spoken line when Battle Day starts.</p>
        <p>Tap the <b>speaker</b> in the top bar to turn all of it off and on. Sound is currently <b>${on ? 'ON 🔊' : 'OFF 🔇'}</b>.</p>
        <p class="help-actions"><button type="button" class="help-btn" data-help-action="toggle-sound">Turn sound ${on ? 'off' : 'on'}</button></p>
        <p>The setting is remembered, so it stays how you leave it. Turning sound off does not change anything else — points, videos and animations all behave exactly the same.</p>
        <p class="help-callout">The intro video on Place of the Week has its own volume, controlled by the computer's volume keys.</p>
        <p>Want the coin, thud, sword, fanfare, dice rattle or the Battle Day war cry to be <b>your own recording</b> instead of these built-in beeps? <a href="#" data-help-go="admin-sfx">Recording your own sound effects →</a></p>
      `;
    },
  },
  {
    id: 'maps-key', cat: 'setup', title: 'Using your own Google Maps key',
    keywords: 'maps api key google billing quota own key 3d limit',
    body: `
      <p>The app ships with a Google Maps key already in it, and for one classroom that is normally fine. You only need your own if the 3D map starts refusing to load because the shared key has hit its limit.</p>
      <ol class="help-steps">
        <li>Create a key in the Google Cloud console with the <b>Maps JavaScript API</b> enabled.</li>
        <li>Restrict it to <b>Websites (HTTP referrers)</b> so nobody else can use it.</li>
        <li>Paste it into <b>🗝️ Admin → ⚙️ Settings → Maps API key</b>.</li>
        <li><b>Reload the page</b> — the key is only read when the app starts up.</li>
      </ol>
      <p>Leave the box empty to go back to the bundled key.</p>
    `,
  },

  // ======================= TROUBLESHOOTING =======================
  {
    id: 'fix-first', cat: 'fix', title: 'Try this first: reload the page',
    keywords: 'reload refresh broken unstyled weird stuck frozen hard refresh cmd shift r first',
    body: `
      <p class="help-lede">Nine times out of ten, this fixes it — and it cannot lose your data.</p>
      <ol class="help-steps">
        <li>Hold <b>Cmd + Shift + R</b> (Mac) or <b>Ctrl + Shift + R</b> (Windows).</li>
        <li>Wait for the app to come back.</li>
      </ol>
      <p>That is a "hard refresh": it throws away the browser's cached copy of the app and fetches a clean one. Use it whenever the page looks unstyled, half-drawn, or is behaving oddly after an update.</p>
      <p class="help-callout"><b>This is completely safe.</b> Reloading never touches your points — those are stored separately from the page itself. The only thing you must never click is <b>Clear browsing data</b>.</p>
      <p>Still wrong after a reload? Run the <a href="#" data-help-go="system-check">System check</a> — it will usually name the problem.</p>
    `,
  },
  {
    id: 'fix-map', cat: 'fix', title: 'The globe or the 3D map is missing',
    keywords: 'map globe missing not loading 3d google maps blank flat internet blocked',
    body: `
      <ol class="help-steps">
        <li>Check the computer is actually online (open any other website).</li>
        <li>Hard refresh: <b>Cmd/Ctrl + Shift + R</b>.</li>
        <li>Run <a href="#" data-help-go="system-check">System check</a> — it tells you plainly whether Google Maps 3D loaded.</li>
      </ol>
      <p>The 3D map is the one part of the app that genuinely needs internet. If the school network blocks Google Maps, Place of the Week shows a simple globe instead and the rest of the voyage — the intro, the facts, the sources, the quiz and your presentation — still runs.</p>
      <p>If the map worked yesterday and not today on a good connection, the shared Maps key may have hit its daily limit. <a href="#" data-help-go="maps-key">Using your own key →</a></p>
    `,
  },
  {
    id: 'fix-video', cat: 'fix', title: 'The intro video will not play',
    keywords: 'video not playing youtube blocked black screen intro fails no video',
    body: `
      <p>Intro videos come from YouTube, so they need internet and they need YouTube not to be blocked on the school network.</p>
      <p><b>The app already handles this for you.</b> If the video does not load, a bundled song plays instead and the voyage carries straight on to the map. You do not need to do anything mid-lesson.</p>
      <p>If you would rather not depend on it at all, run a <a href="#" data-help-go="potw-testflight">Test flight</a> before class.</p>
    `,
  },
  {
    id: 'fix-pdf', cat: 'fix', title: 'My presentation has vanished',
    keywords: 'pdf missing presentation gone slides not showing after restore new computer',
    body: `
      <p>This nearly always means one thing: the app was restored from a backup on a different computer or a different browser. Backups carry your points and settings but not the files themselves.</p>
      <ol class="help-steps">
        <li>Run <a href="#" data-help-go="system-check">System check</a> — it names every destination that claims a presentation it cannot find.</li>
        <li>Open <b>🗝️ Admin → Place of the Week</b>, edit that destination, and upload the PDF again.</li>
      </ol>
      <p>If it vanished on the <i>same</i> computer, someone has cleared the browser's site data. <a href="#" data-help-go="data-cleared">What to do →</a></p>
    `,
  },
  {
    id: 'fix-sound', cat: 'fix', title: 'There is no sound',
    keywords: 'no sound silent audio not working mute volume speaker broken',
    body: `
      <ol class="help-steps">
        <li>Check the <b>speaker button</b> in the top bar is not showing 🔇. <a href="#" data-help-go="sound">Sound settings →</a></li>
        <li>Check the computer's own volume, and that the right output (board speakers, not headphones) is selected.</li>
        <li>Tap anywhere in the app once, then try again. Browsers refuse to make any sound until the page has been clicked at least once — after a reload, the very first sound can be swallowed.</li>
      </ol>
    `,
  },
  {
    id: 'fix-slow', cat: 'fix', title: 'The app feels slow',
    keywords: 'slow lag laggy performance stutter freezing sluggish speed',
    body: `
      <ol class="help-steps">
        <li>Close other browser tabs, especially anything playing video.</li>
        <li>Hard refresh: <b>Cmd/Ctrl + Shift + R</b>.</li>
        <li>Run <a href="#" data-help-go="system-check">System check</a> and look at <b>Storage space</b> and <b>Uploaded files</b>.</li>
      </ol>
      <p>The 3D map and the physics dice ask a fair bit of an older computer. If they stutter, everything else in the app will still be fast — and both have simple fallbacks that look fine on the board.</p>
      <p>A very long points log (a whole year without a reset) can also slow things down. If the storage check is warning you, start a fresh term after archiving a snapshot. <a href="#" data-help-go="data-newterm">How →</a></p>
    `,
  },
  {
    id: 'fix-offline', cat: 'fix', title: 'What needs internet, and what does not',
    keywords: 'internet offline network wifi down works without connection requirements',
    body: `
      <p class="help-lede">The app itself does not need internet. If the wifi dies mid-lesson, keep teaching.</p>
      <h4>Works with no internet at all</h4>
      <ul class="help-list">
        <li>All points, quests, the Magic Shop, Battle Day and the dice.</li>
        <li>The Admin panel, the planner and your backups.</li>
        <li>The whole look of the app — the styling and the fonts are stored on the computer, not fetched from the web.</li>
        <li><b>Your PDF presentations</b> — the PDF reader is bundled with the app.</li>
        <li>The sound effects, which are generated by the browser rather than played from files.</li>
      </ul>
      <h4>Needs internet</h4>
      <ul class="help-list">
        <li><b>Google Maps 3D</b> — the flight in Place of the Week. Falls back to a simple globe.</li>
        <li><b>YouTube intro videos</b> — falls back to a bundled song.</li>
      </ul>
      <p>Both fall back on their own without you touching anything.</p>
    `,
  },

  // ======================= SYSTEM CHECK =======================
  // Rendered live rather than written; see systemCheckHtml() below. It lives in
  // TOPICS (rather than being bolted onto the sidebar) so that searching for
  // "check", "diagnostics", "is my backup working" finds it like anything else.
  {
    id: 'system-check', cat: 'check', title: 'Run a system check',
    keywords: 'system check diagnostics health test status is everything ok problems warnings backup working storage full term ended map loaded missing presentation what is wrong',
    dynamic: true,
    body: () => systemCheckHtml(),
  },
];

// ---------------------------------------------------------------------------
// search index (built once, lazily)
// ---------------------------------------------------------------------------
let searchIndex = null;
function buildIndex() {
  if (searchIndex) return searchIndex;
  searchIndex = new Map();
  for (const t of TOPICS) {
    let bodyText = '';
    // Live-rendered topics are indexed on their keywords alone — their body is
    // a snapshot of whatever the checks last said, which is not searchable text.
    if (!t.dynamic) {
      try { bodyText = stripTags(typeof t.body === 'function' ? t.body() : t.body); } catch (e) { bodyText = ''; }
    }
    searchIndex.set(t.id, `${t.title} ${t.keywords || ''} ${bodyText}`.toLowerCase());
  }
  return searchIndex;
}

// ---------------------------------------------------------------------------
// overlay state
// ---------------------------------------------------------------------------
let rootEl = null;
let currentTopic = 'cheat-sheet';
let query = '';
let listVisibleOnNarrow = true;
let keyHandler = null;
let checkResults = null;       // cached System check results
let checkRunning = false;

function isOpen() { return !!(rootEl && rootEl.isConnected); }
function narrow() { return window.innerWidth < NARROW_PX; }

function matchingTopics() {
  const q = query.trim().toLowerCase();
  if (!q) return null;                                    // null === "not searching"
  const idx = buildIndex();
  const terms = q.split(/\s+/).filter(Boolean);
  return TOPICS.filter((t) => {
    const hay = idx.get(t.id) || '';
    return terms.every((term) => hay.includes(term));
  });
}

function topicById(id) { return TOPICS.find((t) => t.id === id) || null; }

// ---------------------------------------------------------------------------
// rendering
// ---------------------------------------------------------------------------
function sidebarHtml() {
  const results = matchingTopics();

  if (results) {
    if (!results.length) {
      return `<div class="help-noresults">
          <p>Nothing matched <b>${esc(query)}</b>.</p>
          <p class="help-muted">Try a plainer word — "points", "backup", "video", "undo", "quest".</p>
        </div>`;
    }
    return `
      <div class="help-navgroup">
        <div class="help-navhead">${results.length} result${results.length === 1 ? '' : 's'}</div>
        ${results.map((t) => {
          const cat = CATEGORIES.find((c) => c.id === t.cat);
          return `<button type="button" class="help-navitem" data-help-topic="${t.id}" aria-current="${t.id === currentTopic}">
            <span class="help-navitem-title">${esc(t.title)}</span>
            <span class="help-navitem-cat">${cat ? `${cat.icon} ${esc(cat.label)}` : ''}</span>
          </button>`;
        }).join('')}
      </div>`;
  }

  return CATEGORIES.map((c) => {
    const topics = TOPICS.filter((t) => t.cat === c.id);
    if (!topics.length) return '';
    return `
      <div class="help-navgroup">
        <div class="help-navhead">${c.icon} ${esc(c.label)}</div>
        ${topics.map((t) => `<button type="button" class="help-navitem" data-help-topic="${t.id}" aria-current="${t.id === currentTopic}">
            <span class="help-navitem-title">${esc(t.title)}</span>
          </button>`).join('')}
      </div>`;
  }).join('');
}

function levelIcon(level) {
  return level === 'ok' ? '✅' : level === 'warn' ? '⚠️' : 'ℹ️';
}

function systemCheckHtml() {
  const status = checkRunning
    ? '<p class="help-muted">Running checks…</p>'
    : !checkResults
      ? '<p class="help-muted">Tap the button to run the checks.</p>'
      : (() => {
        const counts = health.summarize(checkResults);
        const head = counts.warn
          ? `<p class="help-warn"><b>${counts.warn} thing${counts.warn === 1 ? '' : 's'} need${counts.warn === 1 ? 's' : ''} your attention.</b> Each one below says exactly what to do.</p>`
          : '<p class="help-ok"><b>Everything looks healthy.</b> Nothing for you to do.</p>';
        return head + checkResults.map((r, i) => `
          <div class="help-check help-check-${r.level}">
            <div class="help-check-head"><span aria-hidden="true">${levelIcon(r.level)}</span> ${esc(r.title)}</div>
            <div class="help-check-detail">${esc(r.detail)}</div>
            ${r.fix ? `<div class="help-check-fix"><b>What to do:</b> ${esc(r.fix)}</div>` : ''}
            ${r.action ? `<div class="help-actions"><button type="button" class="help-btn help-btn-primary" data-help-check-action="${i}">${esc(r.action.label)}</button></div>` : ''}
          </div>`).join('');
      })();

  return `
    <p class="help-lede">A quick look at everything that could quietly go wrong — backups, the map, your presentations, term dates and storage.</p>
    <p class="help-actions"><button type="button" class="help-btn help-btn-primary" data-help-action="run-check"${checkRunning ? ' disabled' : ''}>${checkResults ? 'Run the checks again' : 'Run system check'}</button></p>
    ${status}
  `;
}

function articleHtml() {
  const t = topicById(currentTopic);
  if (!t) return '<p class="help-muted">Pick a topic from the list.</p>';
  let body = '';
  try { body = typeof t.body === 'function' ? t.body() : t.body; }
  catch (e) {
    console.warn('help: article failed to render', t.id, e);
    body = '<p class="help-muted">This page could not be shown. Reload the app and try again.</p>';
  }
  const cat = CATEGORIES.find((c) => c.id === t.cat);
  return `
    ${cat ? `<div class="help-eyebrow">${cat.icon} ${esc(cat.label)}</div>` : ''}
    <h3>${esc(t.title)}</h3>
    ${body}
  `;
}

function render() {
  if (!rootEl) return;
  const showList = !narrow() || listVisibleOnNarrow;
  const showArticle = !narrow() || !listVisibleOnNarrow;

  rootEl.innerHTML = `
    <div class="help-backdrop" data-help-close></div>
    <div class="help-panel" role="dialog" aria-modal="true" aria-label="Help">
      <div class="help-head">
        <div class="help-title"><span aria-hidden="true">❓</span> Help &amp; How-To</div>
        <div class="help-searchwrap">
          <input type="search" class="help-search" placeholder="Search — try &quot;undo&quot;, &quot;backup&quot;, &quot;video&quot;" value="${esc(query)}" data-help-search aria-label="Search help" />
        </div>
        <button type="button" class="help-close" data-help-close aria-label="Close help">✕</button>
      </div>
      <div class="help-body" data-narrow="${narrow()}">
        <nav class="help-nav" ${showList ? '' : 'hidden'} aria-label="Help topics">${sidebarHtml()}</nav>
        <article class="help-article" ${showArticle ? '' : 'hidden'} tabindex="-1">
          ${narrow() ? '<button type="button" class="help-back" data-help-back>← All topics</button>' : ''}
          ${articleHtml()}
        </article>
      </div>
    </div>`;
}

// ---------------------------------------------------------------------------
// behaviour
// ---------------------------------------------------------------------------
async function runCheck() {
  checkRunning = true;
  render();
  try { checkResults = await health.run(); }
  catch (e) { console.warn('help: system check failed', e); checkResults = []; }
  checkRunning = false;
  if (isOpen()) render();
}

function goTopic(id) {
  if (!topicById(id)) return;
  currentTopic = id;
  listVisibleOnNarrow = false;
  render();
  const art = rootEl && rootEl.querySelector('.help-article');
  if (art) { art.scrollTop = 0; try { art.focus({ preventScroll: true }); } catch (e) {} }
  if (id === 'system-check' && !checkResults && !checkRunning) runCheck();
}

function onClick(e) {
  if (e.target.closest('[data-help-close]')) { close(); return; }
  if (e.target.closest('[data-help-back]')) { listVisibleOnNarrow = true; render(); return; }

  const nav = e.target.closest('[data-help-topic]');
  if (nav) { goTopic(nav.dataset.helpTopic); return; }

  const inline = e.target.closest('[data-help-go]');
  if (inline) { e.preventDefault(); goTopic(inline.dataset.helpGo); return; }

  const checkAction = e.target.closest('[data-help-check-action]');
  if (checkAction) {
    const idx = Number(checkAction.dataset.helpCheckAction);
    const r = checkResults && checkResults[idx];
    if (r && r.action && typeof r.action.run === 'function') {
      checkAction.disabled = true;
      checkAction.textContent = 'Working…';
      Promise.resolve()
        .then(() => r.action.run())
        .catch((err) => console.warn('help: check action failed', err))
        .then(() => { if (isOpen()) runCheck(); });
    }
    return;
  }

  const action = e.target.closest('[data-help-action]');
  if (!action) return;
  const what = action.dataset.helpAction;

  if (what === 'run-check') { runCheck(); return; }

  if (what === 'connect-backup') {
    action.disabled = true;
    Promise.resolve()
      .then(() => backup.connectFolder())
      .catch((err) => console.warn('help: connect failed', err))
      .then(() => { checkResults = null; if (isOpen()) render(); });
    return;
  }

  if (what === 'toggle-sound') {
    try {
      const on = store.getSettings().soundEnabled !== false;
      store.updateSettings({ soundEnabled: !on });
    } catch (err) { console.warn('help: sound toggle failed', err); }
    render();
    return;
  }

  if (what === 'setup') { close(); startSetup(); return; }
}

function onInput(e) {
  const box = e.target.closest('[data-help-search]');
  if (!box) return;
  query = box.value || '';
  listVisibleOnNarrow = true;
  // Re-render only the nav so the search box keeps focus and the caret position.
  const nav = rootEl.querySelector('.help-nav');
  if (nav) {
    nav.hidden = false;
    nav.innerHTML = sidebarHtml();
    const art = rootEl.querySelector('.help-article');
    if (art && narrow()) art.hidden = true;
  } else { render(); }
}

function onKeydown(e) {
  if (e.key === 'Escape' && isOpen()) { e.stopPropagation(); close(); }
}

function ensureRoot() {
  if (rootEl && rootEl.isConnected) return rootEl;
  rootEl = document.createElement('div');
  rootEl.id = ROOT_ID;
  rootEl.addEventListener('click', onClick);
  rootEl.addEventListener('input', onInput);
  document.body.appendChild(rootEl);
  keyHandler = onKeydown;
  document.addEventListener('keydown', keyHandler, true);
  return rootEl;
}

function open(topicId) {
  ensureRoot();
  if (topicId) currentTopic = topicId;
  listVisibleOnNarrow = !narrow() || !topicId;
  render();
  const box = rootEl.querySelector('[data-help-search]');
  // Only auto-focus the search box on a real keyboard; on the smartboard this
  // would pop the on-screen keyboard over the panel the moment it opens.
  if (box && !narrow() && !('ontouchstart' in window)) {
    try { box.focus({ preventScroll: true }); } catch (e) {}
  }
  if (currentTopic === 'system-check' && !checkResults && !checkRunning) runCheck();
}

function close() {
  if (keyHandler) { document.removeEventListener('keydown', keyHandler, true); keyHandler = null; }
  if (rootEl) {
    rootEl.removeEventListener('click', onClick);
    rootEl.removeEventListener('input', onInput);
    rootEl.remove();
  }
  rootEl = null;
  query = '';
  listVisibleOnNarrow = true;
}

// ---------------------------------------------------------------------------
// public API — callable from the top bar, the Admin panel, or anywhere else.
// ---------------------------------------------------------------------------

/** Open the wiki, optionally straight to a topic id (e.g. 'undo-points'). */
export function openHelp(topicId) { open(topicId); }

/** Open the wiki at the first topic of a category id (e.g. 'potw', 'data'). */
export function openHelpAt(categoryId) {
  const first = TOPICS.find((t) => t.cat === categoryId);
  open(categoryId === 'check' ? 'system-check' : (first ? first.id : undefined));
}
