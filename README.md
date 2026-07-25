# Mr. D's Classroom OS

A dark-mode, gamified classroom management web app for 7th-grade social studies. Run a fully interactive classroom OS on a 16:9 smartboard, manage house points in real-time, plan the term, and guide students through cinematic Place-of-the-Week voyages.

**Built for Mr. D's 7th Grade Social Studies**

---

## DAY ONE SETUP

When you first open the app, do this in order:

1. **Connect Auto-Backup** (if you have a modern browser on Windows/Mac/Linux — Chrome, Edge, Safari 16+)
   - Tap the 🗝️ Admin glyph (far right of the top bar)
   - Go to ⚙️ Settings
   - Under "Automatic Backup," tap "Connect Folder"
   - Pick a folder on your computer (e.g., a shared Google Drive or OneDrive folder)
   - The app will now save automatically every 2 seconds to `mrd-live-backup.json` + daily snapshots
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
- **YouTube embeds** (intro videos)
- **PDF.js** (presentation decks) — bundled locally in `vendor/`, works offline
- **Dice/Globe** have offline fallbacks (simple animations instead of 3D)

---

## Teacher's Admin Panel (🗝️ glyph, top-right)

The admin panel has five tabs. Click the key icon to open it anytime.

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
- **Active Quest** per core: one quest active at a time, one per house
- **Quest Catalog**: Teacher-maintained list of available class quests (e.g., "Campus Cleanup Crew" = 30 pts)
- **How it works**:
  1. Students accept a quest from the Quests board module
  2. Teacher verifies completion in this tab (photo proof, student work, etc.)
  3. Teacher taps "Confirm Completion" → house gets the points + completion logged
- Pre-seeded with 20 quests; add/edit your own for your class

### 🔮 Shop (Magic Shop Editor)
- **Item Catalog**: All items students can buy with accumulated TERM points
- **Create items**:
  - **Name** & **Emoji** (visual identity)
  - **Cost** (in house points)
  - **Effect Type**:
    - **Attack**: Deduct points from a chosen target house
    - **Steal**: Take points from the current leading house
    - **Shield**: Block incoming attacks for N hours (default 24h)
  - **Optional**: Upload a custom image (displays as a thumbnail)
- **Pre-seeded items**: Trojan Horse (steal 25, cost 50), Catapult (attack 20, cost 35), Aegis Shield (block 24h, cost 30)
- Changes take effect immediately on the shop module

### 🌍 Place of the Week
- **Add/Edit Destinations**:
  - **Paste a Google Maps link** (or manually enter lat/lng)
  - **Title & Subtitle** (e.g., "Ancient Mesopotamia • Modern Day Iraq")
  - **Intro Video**: Pick "Rock" or "Classic" (preset YouTube videos), or paste your own YouTube link
  - **Quick Facts**: 3–5 bullet points about the place
  - **Primary Sources**: Key artifacts/documents (emoji + name + description)
  - **Quiz**: 2–3 short questions (teacher can review student answers on the dashboard)
  - **Upload PDF**: Your educational presentation deck (auto-launches full-screen with navigation arrows)
- **Weekly Schedule**: Set the "Week Of" date (e.g., "Week 3") — the app automatically switches to that destination at the start of that week
- **Video Playback**: 
  - YouTube intros play for ~3 min
  - After the intro, the map flies to the destination and orbits slowly
  - The reveal card pops with quick facts + primary sources
  - The presentation PDF (if uploaded) launches full-screen with G to toggle grid, arrows to navigate, Esc to close

### ⚙️ Settings
- **Term**: Start date (Monday) & total weeks
- **Theme**: Dark mode (light mode not implemented yet)
- **Maps API Key**: Leave blank to use the bundled key; paste your own if you prefer
- **Automatic Backup**: Connect/disconnect your backup folder (Chrome/Edge/Safari 16+)
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
- **Navigation Tiles**: Quick-launch to Houses, Quests, Place of the Week, Battle Day, Magic Shop, Die of Destiny

### House Points Engine
The core of classroom management.
- **Top Bar ± Button**: Tap to open the quick-points panel
  - Select a house (or "All Houses" to distribute points evenly)
  - **Add Points**: Type a number (1–9999)
  - **Reason** (optional): Why they earned/lost points
  - **Tag** (optional): Category (challenge, manual, etc.)
- **Transaction Log**: Every point change is logged with timestamp, reason, and tag
  - View the log in the Houses module (newest first)
  - Mis-awarded points can be undone: tap the ✕ on that row of the Transaction Log (House Points screen) and confirm
- **Scoring Scopes**:
  - **Term Total**: All points from the start of the term (used for Magic Shop purchases, rankings)
  - **Week Total**: Points this week only (useful for weekly competitions or resets)
- **Shields** (Aegis): A house that buys a shield is protected from attacks for 24 hours (blocked by the shield effect in the Magic Shop)

### Houses Module
- **View all four houses** side-by-side
- **House Cards** show: shield status (if active), term total, week total
- **Transaction History**: Tap a house to see its recent transactions
- **Colors & Crests**: Each house has a unique accent color and shield crest image

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
- If you uploaded a PDF in the Place of the Week editor, it auto-launches full-screen after the intro
- **Navigation**:
  - **Arrow Buttons**: Next/prev page
  - **G Key**: Toggle grid view (all pages at once)
  - **Esc Key**: Close the presentation
- PDF viewer has auto-hide nav chrome after 3 seconds of idle

### Quests (🧭)
- **Quest Board**: Student-facing module to browse and accept class quests
- **Active Quests**: One per house, shown as a hero banner with description and point value
- **How Students Use It**:
  1. Read the active quest for their house
  2. Tap "Accept Quest" to start
  3. Tap "Abandon Quest" if they give up and want to try a different one
  4. Complete the quest (photo proof, signatures, whatever you ask)
  5. Teacher confirms in Admin → Quests and taps "Confirm Completion"
- **Quest Board also shows**:
  - All completed quests (for this term)
  - Completion timestamp and house that earned it
  - Total points earned from quests

### Battle Day (⚔️)
A cinematic, quick-strike combat arena.

**Landing Page** (inside the app window):
- Red, pulsing "IGNITE BATTLE" button

**Full-Screen Cinematic Overlay**:
- **Swords-clash animation**: Dual swords slam together with screen shake
- **"BATTLE DAY!" stamp** pulses across the middle
- Fades to combat mode

**Combat Mode**:
- **House Battle Cards** (2 or 4 cards per screen, grid layout):
  - House name, shield badge (if protected), term & week totals
  - **Strike Buttons**:
    - **⚔️ Attack**: Instant ±10 points (winner's choice: +10 or −10 from target)
    - **🛡️ Defend**: Activates a shield if house has one
  - Quick animations and sound effects on each strike
- **Link to Magic Shop**: Tap to buy attack items (steal, attack) or shields
- **Combat Effects**:
  - Shield blocking visualized on-screen
  - Point text floats up with color-coding (green gain, red loss)
  - Celebratory particles on large swings

### Magic Shop (🔮)
- **Item Catalog**: Browse teacherreditable items (updated live from Admin)
- **Purchase Flow**:
  - Tap an item to see cost & effect
  - **Balance Check**: Greyed out if you don't have enough TERM points
  - **Choose Target** (if it's an attack): Tap the target house
  - **Confirm**: Tap "Buy" → points deducted immediately, item effect applied
- **Item Effects**:
  - **Attack**: Deduct N points from a chosen target
  - **Steal**: Take N points from the currently-leading house
  - **Shield**: Block incoming attacks for 24 hours (subsequent attacks fail silently)
- **Transaction Log**: Every purchase is logged with tag "shop"

### Die of Destiny (🎲)
Classroom d20 roller with a 3D physics simulation and outcome table.

**Rolling**:
- **Choose Dice**: 1d6, 2d6, 1d12, or d20
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
| 20 | 👑 **MYTHIC TRIUMPH** | +20 points **+ free Magic Shop item** (teacher grants manually) | Tap for +20 |

**Awarding Points**:
- Tap the outcome button to apply the roll result to the active house
- One award per roll (new roll re-enables awarding)
- For Mythic Triumph (20), teacher must manually select a free item from the shop after awarding the 20 points

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
Each module has an optional icon in the top bar:
```
images/icon-quest.png
images/icon-market.png  (shop)
images/icon-potw.png
```

### Edit Term Dates & POTW Profiles
- **Term Dates**: Admin → ⚙️ Settings
- **POTW Destinations**: Admin → 🌍 Place of the Week (full editor UI with Google Maps link picker)
- **Intro Videos**: Pick "Rock" or "Classic" (preset YouTube videos), or paste your own YouTube link

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
   [dashboard, houses, potw, dice, battle, shop, quests, admin, yourmodule].forEach((m) => registry.register(m));
   ```

---

## Data & Persistence

### Storage Structure
All state lives in localStorage under the key `mrd-classroom-os-v1`. This includes:
- Transaction log (all point changes)
- House shields (active protections)
- Quests (catalog, active, completed)
- Magic Shop catalog (teacher edits)
- Planner events
- POTW profiles & scheduling
- Settings (term dates, theme, backup folder handle)
- Student quiz responses

### Media (Videos, PDFs, Images)
- Stored in IndexedDB (browser's persistent storage), NOT in localStorage
- Survives page reloads but NOT browser cache clears
- **Backup:** Backups do NOT include media. You must re-upload media files after restoring on a new machine

### Automatic Backup
- **Enabled in Settings** → "Connect Folder" (File System Access API — Chrome/Edge/Safari 16+)
- **Saves**:
  - `mrd-live-backup.json` (updated every ~2 seconds)
  - `mrd-backup-YYYY-MM-DD.json` (one per calendar day, write-once)
- **Does NOT save**: Media (videos, PDFs)
- **Restore**: Settings → "Restore Latest" (reads `mrd-live-backup.json` from your backup folder and applies it)

### Reset All Data
⚙️ Settings → "Danger Zone" → Type `RESET` to confirm
- Wipes everything: transactions, quests, shop, planner, POTW edits, settings
- **WARNING**: Never use browser "Clear Site Data"—it also wipes IndexedDB and the backup folder handle. Data is unrecoverable.

### How to Fix a Mistake
- There is no "undo" or "delete transaction" feature
- **Procedure**: Tap the ✕ beside the entry in the Transaction Log on the House Points screen and confirm. (Undo removes the points only — a completed quest stays completed, a purchased shield stays active.) An equal-and-opposite manual entry also works
  - Example: If you accidentally awarded 10 points, add a −10 entry with reason "Correction: removed erroneous award"
  - Both entries remain in the log, but the net effect is correct

### Schema Reference
See `data/schema.json` for the complete JSON Schema documenting the persisted state.

---

## Internet Requirements

- **Tailwind CSS** (styling): bundled locally in `vendor/tailwind.js` — no internet needed
- **Google Maps 3D**: Used in Place of the Week; falls back to a flat image if unavailable
- **YouTube Embeds**: Intro videos; falls back to a bundled audio file if unavailable
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
  - Shown on Battle Day and Houses module for a quick "this-week" view
  - Useful for weekly competitions or mid-week resets

**Example Workflow**:
- House A has **200 term points** and **18 week points**
- They can't buy the 500-point item (needs term points)
- But they're leading this week (18 > all others) and might win a weekly prize if you have that rule

---

## Google Classroom Integration (Optional)

The app includes a scaffold for syncing student rosters from Google Classroom (if you want it). See `js/integrations/classroom.js` for activation steps.

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

### YouTube intro fails to play
- Check your internet connection
- YouTube embeds require no authentication but may be region-blocked
- The app falls back to the bundled audio file if the video fails

### 3D Dice/Globe not rendering
- Check browser console for errors (F12)
- If WebGL is unavailable (old device, disabled GPU), the app falls back to simple animations
- Verify your browser supports WebGL (most modern browsers do)

### Backup folder lost permission
- Admin → ⚙️ Settings → "Reconnect Folder"
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
- `js/config.js` — API keys, term config, POTW intro video presets
- `js/core/store.js` — State machine and localStorage sync; all point changes flow through `store.addPoints()`
- `js/core/shell.js` — Persistent top bar, core switcher, quick-points panel, term tracker
- `js/core/backup.js` — File System Access API auto-backup to a chosen folder
- `js/core/media.js` — IndexedDB-backed media store (videos, PDFs, images)
- `js/main.js` — Boot and module registration
- `data/schema.json` — JSON Schema documenting the persisted state
- `js/integrations/classroom.js` — Google Classroom API scaffold (optional)

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
