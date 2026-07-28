# Mr. D's Classroom OS

A dark-mode, gamified classroom management web app for 7th-grade social studies. Run a fully interactive classroom OS on a 16:9 smartboard, manage house points in real-time, plan the term, and guide students through cinematic Place-of-the-Week voyages.

**Built for Mr. D's 7th Grade Social Studies**

---

## DAY ONE SETUP

The first time the app is opened in a browser, a **setup wizard** walks you through
most of this automatically (backup folder, term dates, a look at your four houses,
and an optional PIN) — every step has a visible "Skip for now," so it never
blocks a class that's already sitting down. You can run it again any time from
🗝️ Admin → ❓ Help → "Run the setup wizard again." The steps below are the same
things, done by hand if you'd rather (or need to redo one later):

1. **Connect Auto-Backup (optional, but worth doing)** — even if you skip this, a
   safety net already runs on its own: the first time you actually change
   anything each school day, the app downloads a dated backup file to your
   normal Downloads folder. That works in **every** browser and needs no
   setup, but it only fires once a day. Connecting a folder saves within
   seconds of every change instead — turn both on for the best protection:
   - Tap the 🗝️ Admin glyph (far right of the top bar)
   - Go to ⚙️ Settings → Backup & Restore
   - Under "🔄 Continuous folder backup," tap "Connect Folder" (**Chrome or
     Edge only** — Safari and Firefox don't support the folder-picker API
     this uses; the daily download above still covers them)
   - Pick a folder on your computer (e.g., a shared Google Drive or OneDrive folder)
   - The app will now save automatically every ~2 seconds to `mrd-live-backup.json`, plus one `mrd-backup-YYYY-MM-DD.json` snapshot per calendar day
   - **Important:** Backups save state (points, calendar, quests, settings) as JSON, but NOT media (videos, PDFs, images). Media lives in the browser's IndexedDB only. If you restore on a new machine, you'll need to re-upload media files.

2. **Set Your Term Dates**
   - ⚙️ Settings → scroll to "Term"
   - Change "Term Start" to the Monday your term begins (YYYY-MM-DD format)
   - Change "Total Weeks" if you're not running 9 weeks
   - The app calculates "Week 1 of 9" based on these dates

3. **Plan the Term**
   - 📅 Planner tab opens a calendar view
   - Click any date to add events: itineraries (daily schedules per core), homework, tests, quizzes, vacations, notes, term markers
   - Each core (1–4) can have different itineraries; students see today's schedule on the Morning Dashboard

4. **Turn on the Teacher PIN (optional)**
   - ⚙️ Settings → "🔒 Teacher PIN" — off by default
   - Puts a short PIN in front of the Admin panel and anything that awards or removes points, so a student can't wander up to an unattended board and start tapping
   - Everything students do themselves — accepting a quest, buying from the shop, rolling the dice — is never gated
   - See **Teacher PIN (Lock)** under Core Features below before you turn this on — it's a classroom deterrent, not real security, and it's worth understanding the recovery path first

---

## Quick Start

### Run Locally

```bash
cd /path/to/mr-d-site
python3 -m http.server 8000
```

Open **http://localhost:8000**. The app loads immediately and works fully offline except for:
- **Tailwind CSS** (styling) — bundled locally in `vendor/`, so the board still looks right with no internet
- **Google Maps 3D** (Place of the Week 3D explorer)
- **Place of the Week intro videos** ship as local files in `/videos` and play with no internet at all — the only way this needs a connection is if a teacher pastes their own **YouTube** link into an individual destination instead of using a bundled file
- **PDF.js** (presentation decks) — bundled locally in `vendor/`, works offline
- **Dice/Globe** have offline fallbacks (simple animations instead of 3D)

---

## Teacher's Admin Panel (🗝️ glyph, top-right)

The admin panel has seven tabs. Click the key icon to open it anytime. If you've
turned on the Teacher PIN, opening Admin is the one thing that always asks for
it, no matter which tab you're headed to.

### 📅 Planner
- **Calendar view** of the entire term
- **Click any date** to add events (one-day or multi-day):
  - **Itinerary**: Bell ringer, lesson blocks, house challenges (one per core)
  - **Homework**: Assignments due (one per core)
  - **Tests/Quizzes**: Marked on the calendar
  - **Vacations**: Multi-day blocks for breaks
  - **Notes**: Any ad-hoc note (shows on the dashboard)
  - **Term Start/End**: Mark the term boundaries
- Events are color-coded and appear on the Morning Dashboard

### 🗺️ Quests
- **Active Quests**: one card per core/house, with the same **✅ Confirm
  Complete** / **✖ Mark Given Up** buttons that also appear right on the
  Quests board itself — use whichever screen is in front of you
- **"Clear without penalty"**: undoes an accepted-by-mistake quest with no
  point cost, when Give Up's penalty isn't appropriate
- **Quest Catalog**: teacher-maintained list of available class quests
  (e.g., "Campus Cleanup Crew" = 30 pts), grouped into Repeatable vs. One-time
- Each quest has a **kind** (🤝 Service / 📚 Academic / ❤️ Community / ⭐ Habit,
  shown as an icon on the board) and a **give-up penalty** (defaults to half
  its points, editable per quest)
- **Recent Completions**: a log of the last 20 confirmed quests
- Pre-seeded with 20 quests; add/edit your own for your class

### 🔮 Shop (Magic Shop Editor)
Battle Day runs under one of **two rule sets** (Admin → ⚔️ Battle Day; see
that section below), and each keeps its **own, completely separate**
catalog — editing here only touches whichever one is active right now,
and switching rule sets swaps the whole shop over (your edits to the
inactive one are kept exactly as you left them, waiting for its turn).
- **Item Catalog**: All items students can buy with accumulated TERM points.
- **Create items**:
  - **Name** & **Emoji** (visual identity)
  - **Cost** (in house points)
  - **Optional**: Upload a custom image (displays as a thumbnail) — every
    shipped item already ships with its own hand-drawn art, so this is only
    for replacing one

**Under Mr. D's rules** (the default) items are grouped **Attack / Defense /
Utility**. A house may hold at most one attack and one defense item at a
time (**The Bag of Holding** adds a single extra slot, not two — see
**Battle Day** below). Nearly every attack names one specific defense
**Countered by** that cancels it outright; the app rolls its damage dice
(e.g. `2d6 × 100`) on screen when an uncountered attack lands, and the
total comes straight off the target's **points** — never Hit Points.
Pre-seeded items (prices are Mr. D's own document with three deliberately
re-priced — see the in-app Help for why):

| Item | Slot | Cost | Effect |
|---|---|---|---|
| 🗡️ The Sword of Destiny | Attack | 450 | 2d6 × 100 dmg — countered by Shield of Protection |
| 🕸️ Net of Entrapment | Attack | 600 | Steal 2d6 × 100 — countered by Gauntlet of Defense |
| 🪓 The Legendary Ice Axe | Attack | 500 | Freeze target 1d6 school days — countered by Shield of Protection |
| 🫥 Cloak of Invisibility | Attack | 400 | Steal 1d6 × 100, anonymous — countered by Bow of Seeking |
| 🪨 The Catapult | Attack | 1000 | 3d6 × 100 dmg to **two** houses — nothing counters it |
| ☀️ The Staff of Ra | Attack | 700 | 3d6 × 100 dmg — countered by Eye of Horus |
| 🐎 Warhorse | Attack | 700 | 3d6 × 100 dmg — countered by Bow of Seeking |
| 🛡️ The Shield of Protection | Defense | 500 | Stops the Sword or the Ice Axe |
| 🧤 Gauntlet of Defense | Defense | 400 | Stops the Net of Entrapment |
| 🏹 Bow of Seeking | Defense | 400 | Stops the Cloak or the Warhorse |
| 👁️ The Eye of Horus | Defense | 500 | Stops the Staff of Ra |
| 🔮 The Stone of Seeing | Utility | 1000 | Reveals what another house is holding |
| 🌫️ The Shroud of Secrecy | Utility | 500 | Hides your holdings from the Stone for a week |
| ⏳ The Time Turner | Utility | 1000 | Undoes the last strike that hit you |
| 🎒 The Bag of Holding | Utility | 500 | One extra attack-or-defense slot, forever |

**Under Hit points** (the earlier model, still fully working as an
alternative) items are grouped **Offensive / Defensive / Wildcard**, with
six effect kinds (each has a live plain-English preview as you edit):
  - **⚔️ Attack**: removes Hit Points from a chosen target house on Battle Day
  - **🐴 Steal**: removes Hit Points from the current leading house and
    credits the attacker points equal to whatever damage actually landed
  - **🫥 Pierce**: an attack that ignores shields AND damage-reduction relics
  - **🛡️ Defend (Shield)**: block ALL incoming attacks for N hours (default 24h)
  - **🕵️ Halve damage**: incoming damage cut in half for N hours (usually a Mythic reward)
  - **🎲 Wildcard**: random points swing, for or against the buyer, resolved at purchase
  - Any item can also be flagged **"Mythic reward only"** so it can't be
    bought at all, only granted from a natural 20 on the Die of Destiny
  - Pre-seeded items include Trojan Horse (steal, 2500 HP, cost 5000),
    Catapult Volley (attack, 2000 HP, cost 3500), and Aegis Shield (block
    24h, cost 3000) — see `js/core/store.js`'s `defaultHpCatalog()` for the full list
- Changes take effect immediately on the shop module and on Battle Day (both read the same catalog)

### 🌍 Place of the Week
- **Add/Edit Destinations**:
  - **Paste a Google Maps link** (or manually enter lat/lng)
  - **Title & Subtitle** (e.g., "Ancient Mesopotamia • Modern Day Iraq")
  - **Intro Video**: Pick "Intro 1" or "Intro 2" — local video files bundled
    in `/videos` that play with no internet — or paste your own YouTube link
    for this destination instead
  - **Quick Facts**: 3–5 bullet points about the place
  - **Primary Sources**: Key artifacts/documents (emoji + name + description)
  - **Quiz**: 2–3 short questions (teacher can review student answers on the dashboard)
  - **Presentation**: upload a **PDF**, or paste a published **Google Slides**
    embed link instead — see the caveat about Slides audio under Known
    Limitations below
  - **Quick links**: optional links for the lesson (Kahoot, a quiz, an article)
- **Weekly Schedule**: Set the "Week Of" date (e.g., "Week 3") — the app automatically switches to that destination at the start of that week
- **🧭 Test flight preview**: a read-only preview of the camera fly-to, right
  from the editor, so you can check a destination's camera framing without
  running the full cinematic in front of the class
- **Video Playback**: 
  - The intro video plays (a bundled local file by default, or a pasted YouTube link if you chose one for this destination)
  - After the intro, the map flies to the destination and orbits slowly
  - The reveal card pops with quick facts + primary sources
  - The presentation (PDF or Slides) launches full-screen after landing

### ⚔️ Battle Day
- **Combat mode switch**: choose which rule set is running — **Mr. D's
  rules** (the default) or **Hit points** — see **Battle Day** under Core
  Features above for what each one means. Switching swaps the Magic Shop's
  catalog over and empties every house's current holdings in both
  directions; points, the ledger, quests, the planner and every other
  setting are untouched
- **Battle rules gate**: the prize/HP settings (Hit points mode) or the
  combat-tuning fields relevant to whichever mode is active
- **House status & holdings**: whichever mode is active gets its own panel
  here for undoing what only Battle Day itself can do —
  under **Mr. D's rules**: un-freeze a house the Legendary Ice Axe landed
  on, lower a raised Shroud of Secrecy early, or take back an item a house
  bought by mistake (this does not refund the points spent on it); under
  **Hit points**: clear an active shield or damage-reduction relic by hand

### ❓ Help
The in-app teacher's handbook — searchable, with topics grouped under Quick
answers, Getting started, Points, Place of the Week, Quests, Magic Shop &
Battle, Die of Destiny, The Admin panel, Your data & backups, Housekeeping,
Something looks wrong?, and **🩺 System check** (see below). Also where you
re-run the first-run setup wizard.

### ⚙️ Settings
- **Term**: Start date (Monday) & total weeks
- **Houses**: rename, recolour, or swap the crest/banner image for any of the
  four houses — none of it costs a house any points, and it can be reset back
  to the shipped defaults per house
- **Screen colours**: pin the Home screen, Records, or Quests to a fixed
  accent colour instead of following whichever house is active (see
  **Per-screen colours** under Known Limitations — only these three screens
  are affected)
- **Quick award buttons**: edit the one-tap presets shown on Records → Award Routines
- **⚔️ Battle rules** *(Hit points mode only — Mr. D's rules keep their own
  settings in Admin → ⚔️ Battle Day instead, alongside the combat-mode
  switch itself)*: how Battle Day decides who wins what. Hit points (HP)
  are separate from points — points are the currency, HP is just what a
  strike removes during a fight. When a house's HP hits zero, the fight is
  over and the winner takes a prize *in points*, decided by the rule below.
  **The loser never loses a point**, no matter which rule you pick.
  - **Prize rule** — three ways to size the winner's prize:
    - **Half the gap** (the default): the winner takes half the point gap
      between the two houses. This shrinks on its own as the trailing house
      catches up — simulated over a 9-week term, the best-behaved house still
      won overall and the point spread between houses actually narrowed.
      Pick this if you want battles to matter without letting them run away
      with the standings.
    - **Share of their total**: the winner takes a percentage of the
      defeated house's own points. Use this one carefully — it compounds. In
      that same simulated term, prizes under this rule grew from 281 to
      1,671 points as the weeks went on, and the *worst*-behaved house ended
      up winning. It's offered because a teacher may expect it, not because
      it's the recommended choice.
    - **Fixed amount**: every win pays exactly the same number of points,
      term after term — simple and predictable. The one thing to watch: set
      it below what weapons cost in the Magic Shop and nobody will ever
      bother attacking, since there's nothing left to gain.
  - **Punching down** (off by default): whether a house may attack one with
    *fewer* points than itself. Leave this off unless you have a reason to
    turn it on — without the guard, the leading house can farm the
    last-place house every single Friday, which is exactly the outcome this
    default exists to prevent.
  - **Starting HP** and **Bonus HP per 500 points held**: sets every house's
    maximum hit points for the fight (default 100, plus 10 more per full 500
    points a house holds). A house sitting on more points gets a little
    tougher to knock out — a mild brake on everyone piling onto whoever is
    currently winning. HP always refills to this maximum at the start of
    every Battle Day session; it has nothing to do with day-to-day points.
  - The card shows a live worked example for each house (e.g. "Camelot has
    640 points, so 112 HP") and a prize preview between any two houses you
    pick, both of which update as you type — so you can see exactly what a
    change does before you save it.
- **Theme**: Dark mode (light mode not implemented yet); optional seasonal
  ambient particles (falling leaves/snow/etc., based on the calendar date)
- **Maps API Key**: Leave blank to use the bundled key; paste your own if you prefer
- **Background music**: one card assigns a quiet looping track (drop files in
  `/music`) to any screen except Place of the Week and Battle Day, which make
  their own noise, **plus a Flyover slot** — the music that plays under Place
  of the Week's Google Maps 3D flight. Flyover music is a single, global
  choice here, not set per destination the way it used to be. A master
  volume slider and the global mute (`M` key, or the speaker icon in the
  top bar) sit alongside all of it
- **Backup & Restore**: connect/disconnect a continuous auto-backup folder
  (Chrome/Edge only — see **Automatic Backup** below), toggle the once-a-day
  Downloads safety net, export/import a backup file by hand, and (when one
  exists) **↩ Undo last restore** — puts back exactly what was on this
  computer before the most recent restore or sample-data load
- **🔒 Teacher PIN**: off by default — see **Teacher PIN (Lock)** under Core Features
- **Danger Zone**: Hard reset the app
  - Type `RESET` to confirm
  - Wipes ALL data: transactions, quests, shop catalog, planner, POTW edits, backups, settings
  - **WARNING**: Never click "Clear Site Data" in browser settings—it destroys not only localStorage but also IndexedDB (where media is stored) and the backup folder handle. Data is unrecoverable. Use the Danger Zone reset instead.

---

## Core Features

### Morning Dashboard
The default home screen.
- **House Leaderboard**: All four houses sorted by term points (color-coded)
- **This Week's Standings**: Points earned this week only (separate from term total, useful for weekly resets)
- **Today's Itinerary** (per core): Bell ringer, lesson blocks, challenges
- **Homework Due**: What's due today and this week
- **Navigation Tiles**: Quick-launch to Records, Quests, Place of the Week, Battle Day, Magic Shop, Die of Destiny

### Council of Four (⚖️)
Select **"All Cores"** in the top-bar house switcher instead of a single house
and you land here rather than on a per-house screen. Deliberately neutral —
no module tiles, no scoring controls, no single house singled out. Four
heraldic banners stand side by side, and each banner's **height** is driven by
that house's score, so the standings read as shapes from the back of the room
before anyone reads a number. A Term/This-Week toggle switches which scope the
banners reflect, and a "Recent Decrees" ribbon along the bottom auto-scrolls
through the latest point changes across all four houses.

### House Points Engine
The core of classroom management.
- **Top Bar ± Button**: a small "±" sits in the top bar itself (not a
  separate floating button anymore); tap it to open the quick-points dropdown
  - Select a house
  - **Quick buttons**: +5 / −5 / +10 / −10, or type any amount (1–9999) and
    tap Add/Deduct
  - **Reason** (optional): Why they earned/lost points
- **Transaction Log**: Every point change is logged with timestamp, reason,
  and a category tag — view it in **Records** (below), newest first, with
  filters by category, date range, and search text
- **Undo**: tap the ✕ on any Ledger row in Records and confirm. This removes
  **only the points** — a quest you'd already marked complete stays complete,
  a shield already bought stays active. Records tells you this plainly at the
  moment you undo, per category
- **Scoring Scopes**:
  - **Term Total**: All points from the start of the term (used for Magic Shop purchases, rankings)
  - **Week Total**: Points this week only (useful for weekly competitions or resets)
- **Shields & relics**: a house that buys a Shield is fully protected from
  Attack/Steal for N hours; a "damage-reduction" relic (usually a Mythic Nat-20
  reward) halves incoming damage instead of blocking it outright; a Pierce
  item ignores both

### Records (📜) — formerly "Houses"
The ledger — the one screen that answers "why does the score look like this?"
Four parts, top to bottom:
- **The Term Arc**: a week-by-week line chart of all four houses' points,
  toggled between "Running total" (the House Cup race) and "Points per week"
- **Where the points came from**: a per-house (or whole-class) breakdown by
  source — Quests, Place of the Week, Battle Day, Die of Destiny, Magic Shop,
  Attacks, Wildcards, and your own manual awards — plus a plain-English
  takeaway sentence (e.g. "Most of Camelot's points came from your own
  awards — 62% of everything earned")
- **The Full Ledger**: every transaction, filterable by category/date
  range/search text, with an ✕ to undo any row (with confirmation) and an
  **⬇ Export CSV** button that always exports every matching row regardless
  of how many are shown on screen (the on-screen list itself caps at 400 rows
  for speed — narrow your filters or export the CSV for the full history)
- **Award Routines**: your one-tap quick-award presets (edited in Admin →
  Settings → Quick award buttons), for a single house or all four at once

### Place of the Week (🌍)
A cinematic, multi-stage geography voyage.

**Stage 1: Launch Screen** (inside the app window)
- Spinning 3D globe (WebGL; falls back to emoji on older devices)
- "Launch Place of the Week" button

**Stage 2: Full-Screen Cinematic Overlay**
- **Intro Video/Song**: YouTube embed plays (Rock or Classic preset, or custom)
- If the video fails to load, a fallback song plays (the song is bundled, does not need internet)
- After intro, the reveal card pops and the map loads

**Stage 3: Google Maps 3D Explorer**
- Camera fly-to the destination (~27 seconds of smooth flight)
- Once landed, camera orbits slowly around the location
- Pan, rotate, zoom with touch/mouse (full 3D interaction)

**Stage 4: Tabbed Lesson Overlay** (over the map)
- **Quick Facts**: Bullet points about the place
- **Primary Sources**: Key artifacts/documents with emojis
- **Quiz**: Multiple-choice or short-answer questions (students tap to answer; results logged)

**Stage 5: Presentation (optional)**
- If you uploaded a PDF (or set a Google Slides link) in the Place of the Week editor, it auto-launches full-screen after the intro
- **PDF navigation**: Arrow buttons for next/prev page, **G** to toggle grid view (all pages at once), **Esc** to close; auto-hides its nav chrome after 3 seconds of idle
- **Google Slides**: Google's own control bar stays visible for touch, and a presenter remote's Page Up/Down reaches Google's player — but this app cannot drive slide navigation itself, and doesn't control the deck's audio (see Known Limitations)

### Quests (🧭)
- **Quest Board**: Student-facing module to browse and accept class quests
- **Active Quest**: One per house at a time, shown as a hero banner at the top
  with its description, point value, and a "give up" penalty
- **Quest kinds**: every quest carries a small icon marking what kind of task
  it is — 🤝 Service, 📚 Academic, ❤️ Community, or ⭐ Habit (set per quest in
  Admin; older/hand-written quests default to 🤝 Service if none is set)
- **How Students Use It**:
  1. Read the active quest for their house, or pick a new one from the board
     below (a house can't take a second quest until it finishes or gives up
     its current one)
  2. Tap "Accept Quest" to start — it moves to the hero banner and off the
     board for other houses
  3. Complete the quest (photo proof, signatures, whatever you ask)
  4. **You** confirm the result — either on the big buttons right on the Quest
     Board hero (✓ Complete / ✗ Give Up) or in Admin → Quests, whichever is
     closer. Both are gated by the Teacher PIN if it's turned on
  5. **Give Up** deducts a penalty (half the quest's points by default, set
     per quest in Admin) and returns the quest to the board for another house
     to take. Accepted by mistake instead? "Clear without penalty" in Admin →
     Quests undoes it with no cost
- **Hall of Deeds**: a scrolling strip at the bottom of the board shows
  recently completed quests and each house's running term total
- A **repeatable** quest returns to the board after someone finishes it; a
  **one-time** quest leaves the board for good once completed

> **Grid or carousel**: the Quest Board can show its cards as the normal
> scrolling **grid** (the default) or as a one-card-at-a-time **carousel**
> with prev/next arrows — better at a smartboard, where scrolling up and
> down with a mouse isn't really an option. This is a teacher setting, not a
> per-visit toggle: pick it once in **Admin → ⚙️ Settings → 🗂️ Screen
> layout**, and it's saved and shared with every device viewing the board.
> The Magic Shop offers the same choice, independently, in the same place.

### Battle Day (⚔️)
A cinematic house-vs-house duel arena. Battle Day runs under **one of two
complete rule sets**, chosen in **Admin → ⚔️ Battle Day** — only one is ever
active, and switching swaps the Magic Shop's catalog over too (each mode
keeps its own items and edits, untouched, while the other is active):

- **Mr. D's rules (the default)**: a house holds at most one attack item and
  one defense item at a time, chosen in secret from the Magic Shop. When an
  attack is thrown, the defender's held item is revealed on the spot — the
  right defense cancels the attack outright; otherwise the app rolls the
  damage dice **on screen**, in front of the class, and the total comes
  straight off the target's **points**. Utility items add a wrinkle each:
  the Stone of Seeing reveals another house's holdings, the Shroud of
  Secrecy blinds the Stone against you for a week, the Time Turner undoes
  the last strike that hit you, and the Bag of Holding grants one extra
  attack-or-defense slot. This is Mr. D's own game, transcribed from his own
  document — see **🗝️ Admin → ❓ Help → Battle Day** for the full weapon
  list, every counter, and a step-by-step walkthrough of a throw.
- **Hit points (the earlier model, kept fully working as an alternative)**:
  described in detail below. Points and hit points are two separate things
  here: **points** are the currency and scoreboard used everywhere else in
  the app; **hit points (HP)** are a Battle-Day-only meter that a strike
  removes. A house is beaten when its HP hits zero — and only then does
  anything happen to anyone's points. **The loser of a fight never loses a
  single point**, whatever else happens.

Switching rule sets **empties every house's holdings** in both directions
(an item bought under one rule set means nothing under the other) but never
touches points, the ledger, quests, the planner, or any other setting.

#### Hit points mode
**Landing Page** (inside the app window):
- Red, pulsing "IGNITE BATTLE" button
- Tapping it refills **every house's HP to full** for the session, so nobody
  starts a Friday battle already wounded from an earlier fight

**Full-Screen Cinematic Overlay**:
- **Swords-clash animation**: Dual swords slam together with screen shake
- **"BATTLE DAY!" stamp** pulses across the middle
- Fades to the duel screen

**The Duel**:
- **Choose the challenger** (defaults to whichever house is active in the top
  bar), then **choose their opponent** — tapping a house shows its points and
  whether it's currently shielded or damage-reduced. If "Punching down" is
  switched off in Admin → Settings → ⚔️ Battle rules (the default), a house
  with fewer points than the challenger still shows up here but is visibly
  locked, with the reason spelled out
- **Pick a strike**: the challenger's screen lists every *offensive* item
  (Attack, Steal, Pierce) already sitting in that house's **armoury** —
  weapons it bought ahead of time in the Magic Shop. **Nothing is purchased
  or priced live during the duel** — if the armoury is empty, the screen says
  so and points you at the shop instead
- Each strike removes **hit points**, never house points, from the target.
  Before you tap, the app tells you plainly whether the strike will be
  **blocked** entirely by the target's shield, **halved** by their
  damage-reduction relic, or **ignores both** if it's a Pierce item
- Both houses' **Points** and **Hit Points** are shown side by side on their
  cards throughout the fight — the points numbers don't move at all until
  somebody's HP reaches zero
- Once an opponent is chosen, the screen also shows the **prize on the
  table** — what the attacker stands to win in points if this fight ends the
  defender's HP, based on whichever prize rule you've set (see **⚔️ Battle
  rules** under Settings, below)
- **At zero HP**, the fight ends on the spot: the winner is credited the
  prize in points and the loser's point total does not change at all
- **"🔮 Open Magic Shop"** button jumps straight to the shop to stock up on a
  weapon for next time, or buy a defense before this duel
- **Teacher scoring row**: a separate, always-visible ±10 per house for you to
  award or deduct points directly — labeled "not a house attack." This is the
  one path on this screen that still moves points immediately rather than
  through HP and a battle prize; a deduction here still respects that house's
  shield/relic, same as any other attack
- Point/HP text floats up with color-coding (green gain, red loss), plus
  sound effects and screen shake on each strike

### Magic Shop (🔮)
The shop is **open every day of the week, in both Battle Day rule sets** —
there is no Friday-only restriction. It works on the same screen either way;
what changes is which catalog it's showing and what buying an item actually
does (see **Battle Day** above for which rule set is currently active).

**Under Mr. D's rules (the default)**: every item — attacks, defenses, and
the four utility items (Stone of Seeing, Shroud of Secrecy, Time Turner, Bag
of Holding) — is bought now and used later, never fired at purchase. A house
may hold at most one attack and one defense item at a time (two of each with
the Bag of Holding); trying to buy a second of a slot that's already full is
refused until the first is used or spent. All 15 duel items ship with their
own hand-drawn artwork under `images/shop/`, so a fresh install needs no
uploads. See **Battle Day** above, or **🗝️ Admin → ❓ Help → Battle Day**,
for exactly what each item does and how a throw plays out.

**Under Hit points**, the purchase flow works as described below:
- **Item Catalog**: Browse teacher-editable items (updated live from Admin),
  grouped as Offensive / Defensive / Wildcard
- **Purchase Flow**:
  - Tap an item to see its cost and plain-English effect
  - **Balance Check**: Greyed out if you don't have enough TERM points
  - **Offensive items (Attack, Steal, Pierce) are NOT used at purchase.** No
    target is chosen here at all — buying one just deducts the cost and banks
    the weapon in your house's **armoury**, where it waits, unused, until you
    actually throw it on Battle Day. The confirm dialog says so plainly
    ("saved to use on Battle Day, not fired now"), and the card shows how many
    of that weapon your house is already holding
  - **Defensive items (Shield, Halve Damage) and Wildcards act immediately**:
    a Shield or damage-reduction relic starts protecting your house the
    instant you buy it; a Wildcard's dice roll and points swing resolve on
    the spot
  - **Confirm**: Tap "Buy" → points deducted immediately. For a Shield/Halve
    Damage/Wildcard the effect also happens immediately; for an offensive
    item, the weapon is added to your armoury instead of firing anywhere
- **Item Effects** (six kinds, set per item in Admin → Shop):
  - **⚔️ Attack**: Bought now, thrown later. On Battle Day it removes N **hit
    points** from whichever house you strike — blocked by a shield, halved by
    a damage-reduction relic
  - **🐴 Steal**: Bought now, thrown later. On Battle Day it removes N hit
    points from your target AND credits you N points — whatever damage
    actually got through (less if their relic halved it, zero if their shield
    blocked it)
  - **🫥 Pierce**: Same as Attack, but on Battle Day it ignores BOTH shields
    and damage reduction — it always lands in full. Price these higher;
    nothing stops them
  - **🛡️ Defend (Shield)**: Applies the instant you buy it — blocks every
    incoming strike for N hours (default 24h). A Pierce item still gets
    through
  - **🕵️ Halve damage**: Applies the instant you buy it — cuts incoming
    damage in half for N hours. Usually a Mythic (Nat 20) reward rather than
    something bought outright
  - **🎲 Wildcard**: Resolves immediately with a d20 roll — a random points
    swing of up to N, which may help OR hurt the buyer on the spot. Not an
    attack, so shields/relics never apply to it
- **Mythic-only items**: an item can be flagged "Mythic reward only" in Admin
  (cost forced to 0) — it can't be bought, only granted to a house that rolls
  a natural 20 on the Die of Destiny (see below)
- **Transaction Log**: Every purchase is logged with tag "shop." A weapon
  actually thrown on Battle Day is logged separately with tag "attack" (and,
  if it wins the fight, a second entry with tag "battle" for the prize)

### Die of Destiny (🎲)
Classroom d20 roller with a 3D physics simulation and outcome table.

**Rolling**:
- **Choose Dice**: 1d6, 2d6, or d20 (there is no 1d12 mode)
- **Roll**: Tap the "Roll" button (or tap the die to re-roll)
- **Result**: The d20 shows the physical roll result (3D fall + tumble)
- **Fallback**: If WebGL is unavailable, a simple number appears with a spin animation

**d20 Prophecy Table**:
| Roll | Outcome | Effect | Button Award |
|------|---------|--------|---------------|
| 1 | 💀 **CATASTROPHE** | −10 points | Tap to award |
| 2–5 | 🌧️ **Misfortune** | Nothing; teacher picks next challenger | No auto-award |
| 6–9 | 😐 **Fate is Neutral** | Nothing happens | No auto-award |
| 10–14 | ✨ **Small Favor** | +2 points | Tap to award |
| 15–19 | 🔥 **Fortune Smiles** | +5 points | Tap to award |
| 20 | 👑 **MYTHIC TRIUMPH** | +20 points **+ choice of a Mythic Relic** | Tap for +20 |

**Awarding Points**:
- Tap the outcome button to apply the roll result to the active house
- One award per roll (new roll re-enables awarding)
- For Mythic Triumph (20): after you award the +20, the screen itself offers a
  row of **Mythic Relic** cards to tap — any shop item flagged "Mythic reward
  only" in Admin (there's no separate trip to the Magic Shop needed). If no
  item is flagged that way, the house just keeps the 20 points
- Rolls are genuinely uniform 1–20 — nothing behind the scenes weights the
  outcome

### Teacher PIN (Lock) 🔒
Off by default. Turn it on in Admin → Settings and it puts a short PIN in
front of two things only: **opening the Admin panel**, and **any action that
awards or removes points** anywhere in the app (the quick-points panel, Battle
Day strikes and teacher scoring, Magic Shop purchases, quest complete/give-up,
Die of Destiny awards, and undoing a ledger entry). Everything a student does
themselves — accepting a quest, rolling the dice, browsing the shop — is
never gated.
- Type it once and the board stays unlocked for a set number of minutes
  (5/15/30/60, default 15) of teacher activity, so a lesson doesn't turn into
  re-typing a PIN constantly
- Shift-click (or a ~half-second press-and-hold) on the 🗝️/🔒 topbar glyph
  re-locks instantly, for when you're stepping away
- **Turning it on shows you a recovery code once** — write it down. If you
  forget the PIN, the pad's "Forgot your PIN?" link tells you to open your
  most recent backup `.json` in a text editor and search for `recovery`; that
  code turns the PIN off with no data lost
- **Be honest with yourself about what this is**: it's a classroom deterrent,
  not real security. It stops a student from walking up to an unattended board
  and tapping around — that's genuinely all it's for. It does not encrypt or
  protect your saved data, and the recovery code above is stored as **plain,
  readable text** (that's what makes it findable in a backup file — and it
  also means anyone holding that backup file can read it)

### Ambient Music & Master Mute
Every screen except Place of the Week and Battle Day (which make their own
noise) can have a quiet looping background track, assigned in Admin →
Settings → Background music. Tracks crossfade smoothly when you switch
screens, and there's one master volume plus a hard on/off:
- Press **`M`** anywhere in the app to mute or unmute everything instantly
  (ignored while you're typing in a text field)
- Or tap the 🔊/🔇 speaker icon in the top bar

---

## Customization

### House Artwork
Each house has two image files:
- **`images/<house>-shield.png`** (crest/shield, used in cards, leaderboard, avatars)
- **`images/header-<house>.jpg`** (wide hero banner, used in full-screen overlays)
- **`images/class-shield.png`** (your class logo/crest, appears on the brand header)

House filenames:
- `camelot`, `atlantis`, `valhalla`, `rivendell`

**Example paths**:
```
images/camelot-shield.png
images/header-camelot.jpg
images/atlantis-shield.png
images/header-atlantis.jpg
images/class-shield.png
```

### Module Icons
Each screen has an optional icon (topbar/masthead and Admin tab):
```
images/icon-quest.png
images/icon-market.png  (shop)
images/icon-potw.png
images/icon-battle.png
images/icon-dice.png
images/icon-points.png (Records)
```

### Edit Term Dates & POTW Profiles
- **Term Dates**: Admin → ⚙️ Settings
- **POTW Destinations**: Admin → 🌍 Place of the Week (full editor UI with Google Maps link picker)
- **Intro Videos**: Pick "Intro 1" or "Intro 2" (local files bundled in `/videos`), or paste your own YouTube link for that destination

### Add a New Module
The app uses a simple plugin architecture.

1. **Read ARCHITECTURE.md** for the module contract
2. **Create `js/modules/yourmodule.js`**:
   ```js
   export default {
     id: 'yourmodule',
     title: 'Your Feature',
     icon: '🎯',
     order: 50,           // sort order on the dashboard
     showTile: true,      // false = launched some other way only
     mount(el, ctx) {
       // ctx.store, ctx.registry, ctx.audio available
       el.innerHTML = '<p>Hello!</p>';
     },
     unmount() {
       // Cleanup (timers, audio, DOM)
     },
   };
   ```
3. **Register in `js/main.js`**:
   ```js
   import yourmodule from './modules/yourmodule.js';
   // ...
   [dashboard, houses, potw, dice, battle, shop, admin, quests, council, yourmodule].forEach((m) => registry.register(m));
   ```

---

## Data & Persistence

### Storage Structure
All state lives in localStorage under the key `mrd-classroom-os-v1`. This includes:
- Transaction log (all point changes)
- Which **Battle Day rule set** is active (Mr. D's rules or Hit points — see
  **Battle Day** above), plus **two separate Magic Shop catalogs**, one per
  rule set, so switching keeps both intact
- House shields and damage-reduction relics *(Hit points mode)* — active protections
- **Hit points** *(Hit points mode)* — each house's current Battle Day damage
  taken. Refills (clears) to full at the start of every Battle Day session;
  unrelated to points day-to-day
- **Armoury** — under Hit points mode, each house's stockpile of Magic Shop
  weapons (Attack, Steal, Pierce) bought but not yet thrown; under Mr. D's
  rules, everything a house currently holds — attack/defense items plus the
  Stone of Seeing, Shroud of Secrecy, Time Turner and Bag of Holding
- **Frozen / shrouded / revealed** *(Mr. D's rules)* — which houses can't
  currently earn points (Legendary Ice Axe), which have a Shroud of Secrecy
  up, and what each house has already seen of another's holdings this
  Battle Day session
- Quests (catalog, active, completed, per-quest type/icon/give-up penalty)
- Planner events
- POTW profiles & scheduling
- Settings — term dates, theme (incl. seasonal effects), backup folder handle,
  Teacher PIN (hashed, plus the plain-text recovery code), per-screen accent
  colours, per-screen grid/carousel layout, quick award presets, per-screen
  ambient music assignments (including the global Place of the Week flyover
  track), the Die of Destiny's editable prophecy table, and the
  **⚔️ Battle rules** (Hit points mode's prize rule and its number, punching
  down, starting HP and bonus HP per 500 points — Mr. D's rules keep their
  own punching-down flag and teacher-scoring amount alongside the rule-set
  switch itself)
- Student quiz responses

### Media (Videos, PDFs, Images)
- Stored in IndexedDB (browser's persistent storage), NOT in localStorage
- Survives page reloads but NOT browser cache clears
- **Backup:** Backups do NOT include media. You must re-upload media files after restoring on a new machine

### Daily Safety-Net Download
Runs automatically **in every browser**, no setup and no permission prompt
required — this is the floor under everything else. The first time you
actually change something on a given school day (a point award, a planner
edit, a completed quest — not points specifically), the app downloads
`mrd-backup-YYYY-MM-DD.json` to your browser's normal Downloads folder. It
won't hand you an empty file on a day nothing happened, and it only ever
tries once per day. Turn it off in ⚙️ Settings → Backup & Restore if you'd
rather not have a file land in Downloads every day.

### Automatic Backup (Continuous Folder Backup)
- **Enabled in Settings → Backup & Restore** → "Connect Folder" (File System
  Access API — **Chrome or Edge only**; Safari and Firefox don't support
  this API, so they rely on the daily download above instead)
- **Saves**:
  - `mrd-live-backup.json` (updated every ~2 seconds)
  - `mrd-backup-YYYY-MM-DD.json` (one per calendar day, write-once)
- **Does NOT save**: Media (videos, PDFs)
- **Restore**: Settings → "Restore Latest" — reads `mrd-live-backup.json`
  first, then falls back through your folder's dated `mrd-backup-*.json`
  snapshots, newest first, if the live file is missing or unreadable

### Data Safety Net (what happens when something goes wrong)
- **A save that won't parse is never overwritten.** If the app can't read
  what's in localStorage on boot (a truncated write, a bad character), it
  sets the damaged text aside under a timestamped key
  (`mrd-classroom-os-v1-corrupt-<timestamp>`) instead of erasing it, boots
  to a clean state so class can continue, and shows an on-screen banner
  telling you to restore your most recent backup — the old data may still
  be recoverable by hand from that quarantined key.
- **Every restore or sample-data load snapshots first.** Importing a
  backup, restoring from a connected folder, or loading sample data all
  save exactly what was on the computer beforehand under a `-prev` key
  before replacing anything. Admin → ⚙️ Settings → Backup & Restore shows
  an **↩ Undo last restore** button whenever that snapshot exists — it puts
  everything back exactly as it was and reloads. Available until the next
  restore or sample-data load overwrites it.
- **Two windows open on the same computer can't both keep score.** If this
  app is open in two tabs or windows at once, the second one to write finds
  out, shows a banner, and **stops saving** — better to lose nothing silently
  than to have two windows quietly overwrite each other's points. Close the
  stale window, or reload it to pick up where the other one left off.
- **The browser is asked to keep this data around.** At boot, the app calls
  `navigator.storage.persist()` so the browser treats a term of points as
  the last thing to evict under storage pressure, not the first — silently
  ignored on browsers that don't support it, and a refusal changes nothing
  you can act on either way.

### Reset All Data
⚙️ Settings → "Danger Zone" → Type `RESET` to confirm
- Wipes everything: transactions, quests, shop, planner, POTW edits, settings
- **WARNING**: Never use browser "Clear Site Data"—it also wipes IndexedDB and the backup folder handle. Data is unrecoverable.

### How to Fix a Mistake
- **Procedure**: Tap the ✕ beside the entry in the Ledger on the **Records**
  screen and confirm (gated by the Teacher PIN if it's on). This removes
  **only the points** — a completed quest stays completed, a purchased shield
  stays active, an attack that already landed isn't un-attacked. Records
  tells you this plainly, worded for whichever kind of entry you're removing
- An equal-and-opposite manual entry also works if you'd rather keep both in
  the log for the record
  - Example: If you accidentally awarded 10 points, add a −10 entry with reason "Correction: removed erroneous award"
  - Both entries remain in the log, but the net effect is correct

### Schema Reference
See `data/schema.json` for the JSON Schema documenting the persisted state,
including both Battle Day rule sets' shop catalogs, the
Mr.-D's-rules-only `frozen`/`shrouded`/`revealed` keys, the Teacher PIN,
per-screen colours, per-screen grid/carousel layout, ambient music (including
the global flyover track), the quests' type/icon/give-up-penalty fields,
**hit points** (`state.hp`), each house's **armoury** (`state.inventory`),
and the **⚔️ Battle rules** combat settings (`settings.combat`). If a field
you're reading in a saved backup isn't there, `js/core/store.js` remains the
final authority — the schema is kept in sync by hand and code moves first.

---

## Internet Requirements

- **Tailwind CSS** (styling): bundled locally in `vendor/tailwind.js` — no internet needed
- **Google Maps 3D**: Used in Place of the Week; falls back to a flat image if unavailable
- **Intro videos**: bundled local files in `/videos` by default — no internet
  needed; only needs internet if a teacher pastes a custom **YouTube** link
  for an individual destination instead, and even then falls back to a
  bundled audio file if that video fails to load
- **Google Slides Embeds**: Only used if you choose a Slides link (instead of a PDF) for a Place of the Week presentation; needs internet, same as Maps
- **PDF.js**: Presentation decks — bundled in `vendor/pdf.min.mjs`, so decks render with no internet
- **Dice 3D**: WebGL simulation; falls back to simple number + spin animation
- **Globe (3D)**: Stage 0 POTW globe; falls back to emoji 🌍
- **Web Audio**: SFX synthesizer (sword clashes, fanfare); works offline

---

## Term vs Week Scoring

- **Term Totals**: Used for leaderboards, Magic Shop purchases, final rankings
  - Calculated from the term start date (set in Settings)
  - Used to determine if a house can afford a shop item
- **Week Totals**: Points earned this week only
  - Calculated from the current Monday (store calculates week boundaries automatically)
  - Shown on Battle Day and the Records screen for a quick "this-week" view
  - Useful for weekly competitions or mid-week resets

**Example Workflow**:
- House A has **200 term points** and **18 week points**
- They can't buy the 500-point item (needs term points)
- But they're leading this week (18 > all others) and might win a weekly prize if you have that rule

---

## Google Classroom Integration (Optional, not active)

The app includes a **scaffold** for syncing student rosters from Google
Classroom — the code to authenticate and fetch rosters exists, but it is not
wired into the app at all right now: nothing calls it at startup, and it
needs a Google Cloud OAuth Client ID pasted in before it does anything.
`js/integrations/classroom.js` documents every activation step (create a
Google Cloud project, enable the Classroom API, set up the OAuth consent
screen, create a Web Client ID, paste it into the file, serve over HTTPS).
Until that's done, this feature simply isn't there — nothing in the app
currently reads from or writes to Google Classroom.

---

## Known Limitations & Current State

Being straight about what's finished, what's a deliberate trade-off, and
what's genuinely unresolved:

- **Teacher PIN is a deterrent, not security.** It stops a student from
  tapping around an unattended board — that's genuinely all it claims to do.
  It does not encrypt anything, and its recovery code is stored as plain text
  (by design — see **Teacher PIN (Lock)** above).
- **Per-screen accent colours only affect three screens.** Admin → Settings →
  Screen colours can pin the Home screen, Records, or Quests to a fixed
  colour instead of following the active house. Magic Shop, Battle Day, Die
  of Destiny, Council of Four, and Place of the Week each have their own
  built-in palette and are not affected by that setting.
- **Google Slides presentations**: this app cannot drive slide navigation
  inside a Google Slides embed (Google doesn't expose that control to outside
  pages) — it can only hand keyboard focus to Google's own player. **Audio
  behavior inside a Slides deck is not something this app controls or has
  verified** — whatever a teacher's deck does (an embedded YouTube video vs.
  an audio file dropped directly into a slide) is up to Google's player, not
  this code. A PDF upload remains the fully offline, fully app-controlled option.
- **Google Classroom integration is an unwired scaffold** — see above.
- **Light mode is not implemented** — the toggle exists in Settings but only dark mode is built out.
- **Media (videos, PDFs, images) never travels with a backup file.** Backups
  restore points, quests, the shop, the planner and settings perfectly; any
  uploaded media has to be re-added by hand on a new computer.
- **The continuous folder backup only works in Chrome or Edge** (File System
  Access API). Safari and Firefox rely on the once-a-day Downloads safety
  net instead — see **Data Safety Net** above.

---

## Troubleshooting

### App won't load
- Ensure you're serving over HTTP (not opening `file://` in a browser)
- Check that `python3 -m http.server` is running
- Clear browser cache (Ctrl+Shift+Del / Cmd+Shift+Delete) if stuck on an old version

### Google Maps not showing in Place of the Week
- Check your internet connection (Maps API key is bundled; if it fails, it falls back to a flat image)
- Verify `CONFIG.MAPS_API_KEY` in `js/config.js` is not empty
- Modern browser required (Chrome, Edge, Safari 16+)

### Intro video fails to play
- The shipped intros are local files in `/videos` and need no internet —
  check that the files weren't moved or deleted
- If a destination uses a **custom YouTube link** instead, check your
  internet connection (YouTube embeds require no authentication but may be
  region-blocked)
- Either way, the app falls back to a bundled audio file if the video fails

### 3D Dice/Globe not rendering
- Check browser console for errors (F12)
- If WebGL is unavailable (old device, disabled GPU), the app falls back to simple animations
- Verify your browser supports WebGL (most modern browsers do)

### Backup folder lost permission
- Admin → ⚙️ Settings → "Reconnect backup folder…"
- Pick the folder again (browser will prompt for permission)
- Auto-save resumes

### Data lost after clearing browser data
- **Never clear site data** if you have backups in IndexedDB
- Use Admin → Danger Zone reset instead for a clean slate
- If you have a backup folder, you can restore from it (Settings → Restore Latest)

---

## Developer Notes

### Architecture
- **No build step**: Plain ES6 modules, served directly by the HTTP server
- **State management**: Centralized store in `js/core/store.js` with pub/sub listeners
- **Module registry**: Dynamic, plugin-based feature system in `js/core/registry.js`
- **Styling**: Tailwind CSS (vendored at `vendor/tailwind.js`) + design tokens in `css/theme.css`
- **Audio**: Built-in SFX synthesizer + WebAudio for playback
- **Media**: IndexedDB-backed store in `js/core/media.js` (blobs persist)
- **Backup**: File System Access API in `js/core/backup.js` (Chrome/Edge/Safari)

### Key Files
- `ARCHITECTURE.md` — Complete module contract and core API reference
- `js/config.js` — API keys, term config, POTW intro video presets, ambient track map
- `js/core/store.js` — State machine and localStorage sync; all point changes flow through `store.addPoints()`
- `js/core/shell.js` — Persistent top bar, core switcher, quick-points panel, term tracker, accent/theme wiring
- `js/core/lock.js` — Optional Teacher PIN gate
- `js/core/ambient.js` — Per-screen background music + crossfade
- `js/core/firstrun.js` — First-run setup wizard
- `js/core/health.js` — "System check" diagnostics (rendered inside Help)
- `js/core/backup.js` — File System Access API auto-backup to a chosen folder (Chrome/Edge), plus the once-a-day Downloads safety net that works in every browser
- `js/core/media.js` — IndexedDB-backed media store (videos, PDFs, images)
- `js/modules/admin.js` — The Teacher's Admin panel (all seven tabs)
- `js/modules/quests.js` / `js/modules/council.js` — Quest Board / Council of Four screens
- `js/main.js` — Boot and module registration
- `data/schema.json` — JSON Schema documenting the persisted state (lags current fields — see Schema Reference)
- `js/integrations/classroom.js` — Google Classroom API scaffold (not currently wired in)

### Running the Dev Server
```bash
# Python (built-in)
python3 -m http.server 8000

# Node.js
npx http-server -p 8000

# Or use any HTTP server; just serve the repo root
```

Access at `http://localhost:8000`.

### Testing the App
1. Use the Morning Dashboard to see all houses
2. Tap the ± button in the top bar to add points to a house
3. Switch cores using the house selector to test the reactive topbar
4. Open the browser console (F12) to inspect state:
   ```js
   // These globals are NOT exposed; import the store module to debug
   // Instead, use the Admin panel UI for all operations
   ```
5. Admin → ⚙️ Settings → Danger Zone for a hard reset

### API Reference
See `ARCHITECTURE.md` for the complete store API, registry API, and module contract.

---

## Credits

**Built for Mr. D's 7th Grade Social Studies**

A collaborative classroom experience designed to make learning engaging, fun, and gamified. Built with:
- Tailwind CSS for styling (vendored locally)
- Google Maps 3D for location exploration
- Web Audio API for dynamic sound
- Three.js for 3D dice and globes
- WebGL for interactive graphics
- PDF.js for presentation decks (vendored locally)
- ES6 modules for clean architecture

Enjoy! 🏰⚔️
