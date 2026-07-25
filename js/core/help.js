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

// ---------------------------------------------------------------------------
// The d20 prophecy table.
// SOURCE OF TRUTH: the PROPHECY constant in js/modules/dice.js (module-local,
// not exported, so it is mirrored here verbatim). Values checked against that
// file — do not "tidy" these numbers.
// ---------------------------------------------------------------------------
const PROPHECY_ROWS = [
  ['1',     '💀', 'CATASTROPHE',     'House loses 10 points',                                    '−10'],
  ['2–5',   '🌧️', 'Misfortune',      'Teacher picks the next challenger',                        'no points'],
  ['6–9',   '😐', 'Fate is Neutral', 'Nothing happens',                                          'no points'],
  ['10–14', '✨', 'Small Favor',     'Move your token / +2 class points',                        '+2'],
  ['15–19', '🔥', 'Fortune Smiles',  '+5 house points',                                          '+5'],
  ['20',    '👑', 'MYTHIC TRIUMPH',  '+20 points AND a Mythic Relic to defend your house!',      '+20 + relic'],
];

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
        <li><b>❓</b> — this handbook.</li>
        <li><b>🗝️ key</b> — the Teacher's Admin panel. It is deliberately faint so students do not treat it as a button.</li>
      </ul>
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
      <p><b>All Cores</b> opens the Council of Four — a neutral standings screen with no controls on it, safe to leave on the board between classes.</p>
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
        <li>Open <b>❓ Help → System check</b> and glance at the list. Green means nothing to do.</li>
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
        <li><b>Connect a backup folder.</b> This is the single most important thing on this page — without it, all your points live only inside this browser. <a href="#" data-help-go="data-backup">How backups work →</a></li>
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
        <li><b>Magic Shop and Battle Day</b> — purchases, attacks and steals all move points.</li>
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
      <p>Deducting is a normal entry in the log, exactly like awarding. Houses can go negative; nothing breaks.</p>
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
        <li>Look at the <b>Transaction Log</b> on the left. It lists the last 30 changes, newest first, with the time, the house colour, the amount and the reason.</li>
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
      <p>Shields and defences are separate from points. Clear those in <b>🗝️ Admin → 🛡️ Active Defenses</b>.</p>
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
      <p>The Morning Dashboard shows both. The <b>Records</b> screen has a toggle at the top right to flip between <b>Current Class Standings</b> (this week) and the <b>School-Wide 9-Week House Cup</b> (the term).</p>
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
        <p>Open the <b>Records</b> tile. The <b>Transaction Log</b> down the left-hand side shows the last 30 point changes, newest first: the time, which house, how many points, and the reason.</p>
        <p>Every change is stored with all four of those, whether it came from you, the shop, a quest, the dice or Battle Day. Nothing is ever silently overwritten.</p>
        <p>This browser currently holds <b>${n}</b> logged point change${n === 1 ? '' : 's'}.</p>
        <p>The <i>complete</i> history — not just the last 30 — is inside your backup file, <code>mrd-live-backup.json</code>, if you ever need to go digging for something from weeks ago.</p>
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
    id: 'potw-pdf', cat: 'potw', title: 'Adding a PDF presentation',
    keywords: 'pdf presentation slides deck upload attach google slides powerpoint keynote',
    body: `
      <ol class="help-steps">
        <li><b>🗝️ Admin → Place of the Week → Edit</b> the destination.</li>
        <li>Scroll to <b>Your lesson presentation</b>.</li>
        <li>Drop a <b>PDF</b> in, or choose a file. (Google Slides: <b>File → Download → PDF</b>, or use the publish-to-web embed option if it is offered.)</li>
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
      <p>Edit the questions in <b>🗝️ Admin → Place of the Week → Edit → Quiz</b>.</p>
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
        <li><b>You</b> confirm it in <b>🗝️ Admin → Quests</b>. Only then do the points land.</li>
      </ol>
      <p><b>One quest per house at a time.</b> While Camelot holds a quest, nobody else can take that same quest, and Camelot cannot take a second one.</p>
      <p>Points are never awarded by a student tapping something — a quest only ever pays out when you confirm it.</p>
    `,
  },
  {
    id: 'quests-confirm', cat: 'quests', title: 'Confirming a completed quest',
    keywords: 'confirm complete quest verify approve award sign off',
    body: `
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
      <p>Both live in <b>🗝️ Admin → Quests</b>, next to the active quest.</p>
    `,
  },
  {
    id: 'quests-catalog', cat: 'quests', title: 'Editing the quest list',
    keywords: 'catalog edit add quest points repeatable one time penalty create custom',
    body: () => {
      let n = 0;
      try { n = (store.getQuestCatalog() || []).length; } catch (e) { n = 0; }
      return `
        <p>The app ships with a starter catalogue (currently <b>${n}</b> quests) — food drives, library challenges, campus cleanups, perfect attendance and so on. Edit them freely in <b>🗝️ Admin → Quests → Quest Catalog</b>.</p>
        <p>Each quest has:</p>
        <ul class="help-list">
          <li><b>Title and description</b> — say exactly what proof you want, e.g. "before and after photos".</li>
          <li><b>Points</b> — scale these to effort. The shipped ones run from 10 to 50.</li>
          <li><b>Penalty</b> — deducted if the house gives up. Defaults to half the points.</li>
          <li><b>Repeatable</b> — on means any house can take it again after someone finishes it (good for "attend a school event"). Off means it leaves the board for good.</li>
        </ul>
        <p>Deleting a quest also clears it from any house currently holding it.</p>
      `;
    },
  },

  // ======================= SHOP & BATTLE =======================
  {
    id: 'shop-basics', cat: 'shop', title: 'How buying works',
    keywords: 'shop buy purchase spend cost afford magic shop balance target',
    body: `
      <ol class="help-steps">
        <li>Open the <b>Magic Shop</b> tile.</li>
        <li>Pick the house that is buying.</li>
        <li>Tap an item. Items the house cannot afford are greyed out.</li>
        <li>If it is an attack, pick the target house.</li>
        <li>Confirm. The cost comes off immediately and the effect happens straight away.</li>
      </ol>
      <p>Items are paid for with <b>term</b> points, not this week's points. Every purchase is logged with the reason "Bought: <i>item name</i>".</p>
    `,
  },
  {
    id: 'shop-effects', cat: 'shop', title: 'What each type of item does',
    keywords: 'attack steal shield pierce reduce wild effect types items list',
    body: () => {
      const rows = [
        ['Attack', 'attack', 'Takes points off a house you choose. Can be blocked or halved by defences.'],
        ['Steal', 'steal', 'Takes points off whichever house is leading and gives the buyer exactly what was actually taken — nothing if it was blocked, half if it was halved.'],
        ['Shield', 'shield', 'Blocks all incoming attacks on the buyer for a number of hours.'],
        ['Pierce', 'pierce', 'An attack that ignores shields AND halving. Always lands in full.'],
        ['Halve (Mythic)', 'reduce', 'Halves all incoming damage for a number of hours. Cannot be bought — only granted by a natural 20.'],
        ['Wildcard', 'wild', 'A random swing, for the buyer or against them, up to the listed amount.'],
      ];
      return `
        <table class="help-table">
          <thead><tr><th>Type</th><th>What it does</th><th>In the shop right now</th></tr></thead>
          <tbody>
            ${rows.map(([label, kind, desc]) => {
              const items = shopItemsByKind(kind);
              return `<tr><td><b>${label}</b></td><td>${desc}</td><td class="help-muted">${
                items.length ? items.map((i) => `${esc(i.emoji || '')} ${esc(i.name)}${i.mythicOnly ? '' : ` <span class="help-nowrap">(${i.cost} pts)</span>`}`).join('<br>') : '—'
              }</td></tr>`;
            }).join('')}
          </tbody>
        </table>
        <p class="help-callout">You can change any of these, or invent your own — see <a href="#" data-help-go="shop-create">Creating your own item</a>.</p>
      `;
    },
  },
  {
    id: 'shop-matchups', cat: 'shop', title: 'How attacks and defences interact',
    keywords: 'matchup blocked shield halved pierce combat rules damage interaction which wins',
    body: `
      <p class="help-lede">There is one rule, applied in this order: <b>a shield blocks the whole attack; otherwise a halving defence cuts it in half; a pierce ignores both.</b></p>
      <p>Take a plain <b>20-point attack</b> (the Catapult Volley) against a house that is:</p>
      <table class="help-table">
        <thead><tr><th>Target's defence</th><th>Plain 20-point attack</th><th>20-point <b>pierce</b></th></tr></thead>
        <tbody>
          <tr><td>No defence</td><td><b>20</b> points lost</td><td><b>20</b> points lost</td></tr>
          <tr><td>Shielded</td><td><b>Blocked</b> — 0 lost</td><td><b>20</b> points lost</td></tr>
          <tr><td>Damage halved (Mythic relic)</td><td><b>10</b> points lost</td><td><b>20</b> points lost</td></tr>
          <tr><td>Shielded <i>and</i> halved</td><td><b>Blocked</b> — 0 lost</td><td><b>20</b> points lost</td></tr>
        </tbody>
      </table>
      <p>A pierce always lands in full, which is why pierce items cost more than plain attacks of the same size.</p>
      <p><b>Steals</b> follow exactly the same rule, and the thief only ever gains what the target actually lost — a blocked steal gains nothing.</p>
      <p>Positive points never route through any of this. You can always award points to a house no matter what defences it has up.</p>
    `,
  },
  {
    id: 'shop-blocked', cat: 'shop', title: 'Why was that attack blocked?',
    keywords: 'blocked shield why nothing happened attack failed no damage defence',
    body: `
      <p>Because the target had a shield running. A shield blocks <b>every</b> ordinary attack until it expires — it is not a chance, it is a certainty.</p>
      <p>To see what is currently protecting whom, open <b>🗝️ Admin</b> and look at <b>🛡️ Active Defenses</b>. It lists every shield and halving effect with the time left, and lets you clear one if a class talked itself into a corner.</p>
      <p>Ways through a shield:</p>
      <ul class="help-list">
        <li>Buy a <b>pierce</b> item — it ignores shields entirely.</li>
        <li>Wait for the shield to run out (shields last between 12 and 48 hours depending on the item).</li>
      </ul>
    `,
  },
  {
    id: 'shop-mythic', cat: 'shop', title: 'Mythic relics',
    keywords: 'mythic relic natural 20 nat20 reward free item oracle spy network lookout',
    body: () => {
      let items = [];
      try { items = store.getMythicRewards() || []; } catch (e) { items = []; }
      return `
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
    keywords: 'create item custom new shop editor add own effect cost emoji image',
    body: `
      <ol class="help-steps">
        <li>Open <b>🗝️ Admin → Shop</b>.</li>
        <li>Add a new item, or edit one that exists.</li>
        <li>Give it a <b>name</b>, an <b>emoji</b> (or upload a small picture), and a <b>cost</b> in points.</li>
        <li>Choose the <b>effect</b>: attack, steal, shield, pierce, halve or wildcard — and the amount (points, or hours for shields and halving).</li>
        <li>Write a <b>description</b>. This is the bit students read, so it is worth a sentence of history.</li>
        <li><b>Save.</b> It appears in the shop instantly.</li>
      </ol>
      <p>Two rules the editor enforces so nothing can be saved that the app will not honour: an item must have a real effect type, and anything that is not a Mythic relic must cost more than zero.</p>
      <p>Deleting an item you dislike is permanent — it will not come back on the next reload.</p>
    `,
  },
  {
    id: 'battle-day', cat: 'shop', title: 'Battle Day',
    keywords: 'battle day combat strike victory defeat arena swords ignite',
    body: `
      <p>Battle Day is a full-screen contest mode. Tap the tile, tap <b>IGNITE BATTLE</b>, and it opens the arena with a card per house.</p>
      <p>Each card has two strikes:</p>
      <ul class="help-list">
        <li><b>+10 Victory</b> — awards that house 10 points outright.</li>
        <li><b>−10 Defeat</b> — a 10-point attack, which obeys the normal defence rules: a shield blocks it, a halving relic makes it 5. <a href="#" data-help-go="shop-matchups">The rules →</a></li>
      </ul>
      <p>There is a link straight into the Magic Shop so houses can buy shields or attacks mid-battle.</p>
      <p><b>Esc</b> closes the arena. Everything that happened is in the points log like any other award.</p>
    `,
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
    keywords: 'prophecy table d20 outcomes catastrophe misfortune neutral small favor fortune mythic triumph 20 points',
    body: `
      <table class="help-table">
        <thead><tr><th>Roll</th><th>Outcome</th><th>What it means</th><th>Points</th></tr></thead>
        <tbody>
          ${PROPHECY_ROWS.map(([roll, emoji, title, desc, pts]) =>
            `<tr><td><b>${roll}</b></td><td>${emoji} <b>${esc(title)}</b></td><td>${esc(desc)}</td><td class="help-nowrap"><b>${pts}</b></td></tr>`).join('')}
        </tbody>
      </table>
      <h4>How the points actually get applied</h4>
      <p>Nothing happens automatically. The plaque shows a button for each house — tap the house you want it to land on and the points are awarded, logged with the reason "Die of Destiny: <i>outcome</i>".</p>
      <p><b>One award per roll.</b> Once you have tapped, the buttons stop responding until the next roll, so a double-tap cannot pay twice.</p>
      <p><b>2–5 and 6–9 award nothing</b> — they are story beats, not scoring. On a Misfortune you simply pick who goes next.</p>
      <p>On a <b>natural 20</b> the house gets +20 and you also get to grant one <b>Mythic relic</b>, once per roll. <a href="#" data-help-go="shop-mythic">About relics →</a></p>
    `,
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
        <li><b>❓ Help</b> — opens this handbook, straight to the section you need.</li>
        <li><b>⚙️ Settings</b> — term dates, theme, backups, your own Maps key, and the reset button. <a href="#" data-help-go="admin-settings">More →</a></li>
      </ul>
      <p>Several screens also carry a small <b>❓ How this works</b> link that jumps you straight to the right article in here.</p>
      <p>Tap the crest at the top left to leave Admin and go back to the dashboard.</p>
    `,
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
    keywords: 'settings term dates theme backup maps key reset danger zone',
    body: () => `
      <ul class="help-list">
        <li><b>Term Timeline</b> — the Monday your term starts and how many weeks it runs. This drives "Week N of M" in the top bar and the term totals. ${termLine()}</li>
        <li><b>Display &amp; Theme</b> — dark or light, and optional seasonal decoration. <a href="#" data-help-go="theme">More →</a></li>
        <li><b>Maps API key</b> — leave blank unless you have your own. <a href="#" data-help-go="maps-key">More →</a></li>
        <li><b>Backup &amp; Restore</b> — connect a folder, save now, restore the latest backup. <a href="#" data-help-go="data-backup">More →</a></li>
        <li><b>⚠️ Danger Zone</b> — wipes everything and starts over. You have to type <b>RESET</b> to confirm, and there is no undo.</li>
      </ul>
      <p class="help-warn">Before you ever touch the Danger Zone, make sure you have a backup folder connected and a dated snapshot in it.</p>
    `,
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
      <p>Which is why the backup folder matters more than anything else in this handbook. <a href="#" data-help-go="data-backup">How backups work →</a></p>
    `,
  },
  {
    id: 'data-backup', cat: 'data', title: 'How backups work (and what they leave out)',
    keywords: 'backup folder connect autosave restore json snapshot save file system access',
    body: () => {
      const s = backup.status();
      const line = !s.supported
        ? '<p class="help-warn"><b>This browser cannot do it.</b> Automatic folder backup needs Google Chrome or Microsoft Edge. Everything else in the app works fine here, but nothing will be backed up.</p>'
        : s.connected
          ? `<p class="help-ok"><b>You are connected</b> to the folder "${esc(s.folderName)}". Nothing to do.</p>`
          : '<p class="help-warn"><b>No folder is connected right now.</b> Use the button below.</p>';
      return `
        ${line}
        <h4>Connecting one</h4>
        <ol class="help-steps">
          <li>Open <b>🗝️ Admin → ⚙️ Settings → Backup &amp; Restore</b> (or use the button at the bottom of this page).</li>
          <li>Tap <b>🔄 Connect backup folder…</b> and pick somewhere safe — a Google Drive or OneDrive folder is ideal, because then the backups sync off the computer too.</li>
          <li>Say yes when the browser asks for permission to save files there.</li>
        </ol>
        <p>Once connected you also get <b>Save now</b>, <b>Restore from folder…</b> and <b>Disconnect</b> in the same place, plus a line telling you when the last save happened.</p>
        <h4>What happens after that</h4>
        <p>A couple of seconds after <i>any</i> change, the app writes <code>mrd-live-backup.json</code> to that folder. Once a day it also writes a dated snapshot, <code>mrd-backup-2026-01-31.json</code>, so you can go back to a particular day if you need to.</p>
        <h4>What a backup contains</h4>
        <p><b>Included:</b> every point ever awarded, the calendar, quests, the shop catalogue, your destinations and their schedule, house edits and all settings.</p>
        <p class="help-warn"><b>Not included: media.</b> Videos, PDFs and images you have uploaded are far too big for the backup file and stay in the browser's own storage. Restoring a backup on a new computer brings back everything except those, and you will need to upload them again.</p>
        <h4>Restoring</h4>
        <p><b>🗝️ Admin → ⚙️ Settings → Restore from folder…</b> reads <code>mrd-live-backup.json</code> back in. It asks you to confirm first, because it replaces <i>everything</i> currently in the browser and cannot be undone.</p>
        <h4>If your browser can't do folder backups</h4>
        <p>The same Settings card has <b>⬇ Export backup</b> and <b>⬆ Import backup</b>, which work in every browser. Export saves one file to your Downloads; do it at the end of each week and keep the files somewhere safe. It is more work than the automatic folder, but it is far better than nothing.</p>
        <p class="help-callout">Browsers sometimes drop folder permission after an update. If that happens the app tells you, and you just pick the same folder again. The <a href="#" data-help-go="system-check">System check</a> watches for it.</p>
        <p class="help-actions"><button type="button" class="help-btn help-btn-primary" data-help-action="connect-backup">Connect a backup folder now</button></p>
      `;
    },
  },
  {
    id: 'data-move', cat: 'data', title: 'Moving to another computer',
    keywords: 'move computer transfer new laptop copy migrate another machine home school',
    body: `
      <ol class="help-steps">
        <li>On the <b>old</b> computer, make sure a backup folder is connected and the file is up to date (Settings → <b>Save now</b>). If there is no folder, use <b>⬇ Export backup</b> instead.</li>
        <li>Copy the whole app folder <b>and</b> your backup folder to the new computer (a USB stick or Drive both work).</li>
        <li>On the <b>new</b> computer, start the app the same way you start it now, and open it in Chrome or Edge.</li>
        <li>Go to <b>🗝️ Admin → ⚙️ Settings</b>, tap <b>🔄 Connect backup folder…</b>, pick the copied folder, then <b>Restore from folder…</b>. (Or <b>⬆ Import backup</b> and choose the exported file.)</li>
        <li>Re-upload your PDFs and any videos — <a href="#" data-help-go="potw-pdf">those do not travel in the backup</a>. Run <a href="#" data-help-go="system-check">System check</a>; it will name any destination whose presentation is missing.</li>
      </ol>
    `,
  },
  {
    id: 'data-cleared', cat: 'data', title: 'What if site data gets cleared?',
    keywords: 'cleared lost data gone wiped clear browsing data cache disaster recover',
    body: `
      <p class="help-warn">"Clear browsing data" in the browser menu wipes this app completely — points, calendar, uploaded PDFs, and even the memory of which folder your backups live in. Never use it on this computer.</p>
      <h4>If it has already happened</h4>
      <ol class="help-steps">
        <li>Do not panic and do not start re-entering points.</li>
        <li>Open the app, go to <b>🗝️ Admin → ⚙️ Settings</b>, tap <b>🔄 Connect backup folder…</b> and pick your backup folder again.</li>
        <li>Tap <b>Restore from folder…</b> and confirm. You are back to within a few seconds of where you were.</li>
        <li>Re-upload your PDFs and videos.</li>
      </ol>
      <h4>If there was no backup folder</h4>
      <p>Then the data is gone and cannot be recovered by anyone. Connect a folder today — it takes about fifteen seconds. <a href="#" data-help-go="data-backup">Here is how →</a></p>
      <p>If you genuinely want a clean slate, use <b>Settings → Danger Zone</b> instead. It only clears this app, not the browser.</p>
    `,
  },
  {
    id: 'data-newterm', cat: 'data', title: 'Starting a new term or a new school year',
    keywords: 'new term reset year end semester start over fresh archive rollover',
    body: `
      <h4>A new term, keeping the history</h4>
      <ol class="help-steps">
        <li>Make sure today's dated snapshot is in your backup folder.</li>
        <li><b>🗝️ Admin → ⚙️ Settings → Term Timeline</b>: set <b>Term Start</b> to the new Monday and the number of weeks.</li>
      </ol>
      <p>The week counter restarts and the dashboard follows. Points are <b>not</b> zeroed — term totals still count everything in the log.</p>
      <h4>A new school year, starting from zero</h4>
      <ol class="help-steps">
        <li>Copy the latest dated snapshot out of your backup folder and keep it somewhere safe — that is your archive of last year.</li>
        <li><b>🗝️ Admin → ⚙️ Settings → Danger Zone</b>, type <b>RESET</b>.</li>
        <li>Set the new term dates, then reconnect your backup folder.</li>
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
      <p>The app is built so all four can be renamed and recoloured without losing a single point — the change flows straight through to the top bar, the standings and the battle cards.</p>
      <p class="help-callout">Whether there is a button for it in <b>🗝️ Admin</b> depends on the version you have. Have a look there first; if you cannot find it, it is a five-minute job for whoever set the app up, and nothing about your points or your calendar is at risk in doing it.</p>
    `,
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

/** Open straight to the live diagnostics. */
export function openSystemCheck() { open('system-check'); }

export function closeHelp() { close(); }
export function isHelpOpen() { return isOpen(); }

/** Topic/category metadata, for anything that wants to build its own links. */
export function helpTopics() {
  return TOPICS.map((t) => ({ id: t.id, cat: t.cat, title: t.title }));
}
export function helpCategories() { return CATEGORIES.map((c) => ({ ...c })); }

export const help = {
  open: openHelp,
  openAt: openHelpAt,
  openSystemCheck,
  close: closeHelp,
  isOpen: isHelpOpen,
  topics: helpTopics,
  categories: helpCategories,
};
