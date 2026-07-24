# Mr. D's Classroom OS

A dark-mode, gamified classroom management web app for 7th-grade social studies. Run a fully interactive classroom OS on a 16:9 smartboard, manage house points in real-time, and guide students through cinematic lessons with the Place of the Week 3D explorer.

**Built for Mr. D's 7th Grade Social Studies**

---

## Quick Start

### Prerequisites
- Python 3 (for a simple HTTP server)
- Modern web browser (Chrome, Edge, Safari, Firefox)
- Internet connection (Tailwind CSS CDN + Google Maps 3D)

### Run Locally

```bash
cd /path/to/mr-d-site
python3 -m http.server 8000
```

Open **http://localhost:8000** in your browser. The app loads immediately.

> **Note:** The app requires internet access for Tailwind CSS styling and Google Maps 3D. Serve over HTTPS (or localhost) for full functionality.

---

## Feature Tour

### OS Shell
The persistent top bar and navigation system.

- **Core Switcher**: Tap a period number (1–4) or "All" to switch between house views
- **Term Tracker**: Always see which week you're in (e.g., "Week 4 of 9-Week Term")
- **Quick-Point FAB**: Floating Action Button in the lower right — tap to add/deduct points with one tap
- **House Accent**: Topbar color changes with the active house

### Morning Dashboard
The default home screen.

- **House Leaderboard**: See all four houses, sorted by term points, color-coded by house
- **This Week's Snapshot**: Points earned this week only
- **Today's Itinerary**: The bell-ringer, lesson blocks, and challenges for the active period
- **Homework**: What's due today and this week
- **Navigation Tiles**: Quick-launch to Houses, Place of the Week, Battle Day, Magic Shop, Die of Destiny

### House Points Engine
The core of classroom management.

- **Add/Deduct Points**: Use the FAB or the Houses view to award or remove points
- **Reason & Tag**: Every transaction is logged with a reason ("Correct answer") and a tag (e.g., "challenge", "shop", "manual")
- **Transaction History**: See the last 50 changes for any house (newest first)
- **Weekly & Term Scopes**: View totals for this week only, or the full term
- **Aegis Shield**: Spend 500 points to protect a house from point deductions for 24 hours

### Place of the Week (POTW)
A three-stage cinematic geography experience.

1. **Intro Video/Song**: A 37-second rock anthem plays (falls back to audio if no video)
2. **Google Maps 3D Explorer**: Rotate, pan, and zoom a real satellite view of the location
3. **Educational Dashboard**: Quick facts, primary sources, and an interactive quiz

Currently featuring **Ancient Mesopotamia** — customize in `js/config.js`.

> **Optional Video**: Drop a `potw-intro.mp4` file in the root directory to replace the audio fallback.

### Battle Day
A 2D pixel-art battle arena where houses fight rivals.

- **House vs. House Combat**: Tap to cast spells, dodge, heal
- **House-Specific Abilities**: Each house has unique powers (Camelot: Slash, Atlantis: Freeze, Valhalla: Smash, Rivendell: Growth)
- **Real-Time Scoring**: Points awarded for victories and combos
- **Music & SFX**: Dynamic audio feedback (sword clashes, fanfare on win)

### Magic Shop
The in-game marketplace.

- **Item Catalog**: Browse magical items with costs and effects
- **One-Tap Purchase**: Spend house points on shields, potions, enchantments, and artifacts
- **Balance Check**: Can't afford an item? It's greyed out
- **Transaction Log**: Every purchase is logged with tag 'shop'

### Die of Destiny (d20)
Roll the die. Fate decides your house's fortune.

- **d20 Roll**: Tap the die for a random 1–20 outcome
- **Outcome Table**: Each number triggers a specific effect:
  - **1–4**: Cursed (-50 points, locked for 1 minute)
  - **5–7**: Setback (-25 points)
  - **8–12**: Nothing (re-roll or accept)
  - **13–16**: Bonus (+25 points)
  - **17–20**: Critical Win (+100 points, fanfare)
- **SFX & Animation**: Satisfying roll physics and reactions

---

## Customization

### Swap House Artwork
Replace the PNG images in the `images/` directory to rebrand the four houses.

```
images/camelot.jpg    (red)
images/atlantis.jpg   (blue)
images/valhalla.jpg   (gold)
images/rivendell.jpg  (green)
```

Use the same filenames; the app loads them automatically.

### Edit Term Dates & POTW Profile
Open `js/config.js`:

```js
TERM: {
  name: '9-Week Term',
  startDate: '2026-06-29',  // Change this to your term start (YYYY-MM-DD)
  totalWeeks: 9,
},

POTW_ACTIVE: 'mesopotamia',  // Key into state.potw.profiles
```

To add a new POTW location, edit `js/core/store.js` and add a profile to `state.potw.profiles`:

```js
profiles: {
  mesopotamia: { /* existing profile */ },
  egypt: {  // Your new profile
    title: 'Ancient Egypt',
    subtitle: 'Modern Day Egypt',
    camera: { center: { lat, lng, altitude }, range, tilt, heading },
    quickFacts: ['...', '...'],
    primarySources: [{ name, emoji, desc }, ...],
    quiz: [{ q, a }, ...],
  },
}
```

### Add a New Module
The app uses a simple plugin architecture. To add a new screen/feature:

1. **Read the Module Contract** (see ARCHITECTURE.md for the exact shape)
2. **Create `js/modules/yourmodule.js`**:
   ```js
   export default {
     id: 'yourmodule',
     title: 'Your Feature',
     icon: '🎯',
     order: 50,
     showTile: true,
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
   [dashboard, houses, potw, dice, battle, shop, yourmodule].forEach((m) => registry.register(m));
   ```

That's it — your module will appear on the dashboard and in navigation.

---

## Data & Persistence

### Storage
All state is stored in the browser's **localStorage** under the key `mrd-classroom-os-v1`. This includes:

- House points and transaction history
- Shields (active protections)
- Itineraries and homework
- POTW active profile

Data persists across page refreshes and browser sessions (until cleared).

### Reset All Data
To wipe the app and start fresh, open the browser console and run:

```js
store.resetAll()
```

Or clear the site data manually:
- Chrome/Edge: Settings > Privacy > Clear browsing data > Cookies and other site data
- Safari: Develop > Clear Caches
- Firefox: Settings > Privacy > Clear Recent History

### Schema Reference
See `data/schema.json` for the complete JSON Schema documenting the persisted state, including all field types and constraints.

---

## Google Classroom Integration

The app includes a scaffold for syncing student rosters from Google Classroom.

### Why?
Automatically populate houses with real students and course data, so Mr. D never has to manually type names.

### Activate the Integration

1. Go to [https://console.cloud.google.com](https://console.cloud.google.com)
2. Create a new project (or use an existing one)
3. Enable the **Google Classroom API**:
   - Search for "Classroom API" in the APIs & Services dashboard
   - Click "Enable"
4. Set up the **OAuth Consent Screen**:
   - Go to APIs & Services > OAuth Consent Screen
   - Select "External" user type
   - Fill in the required fields
   - Add your email as a test user
5. Create a **Web Client ID**:
   - Go to Credentials > Create Credentials > OAuth 2.0 Client ID
   - Application type: "Web application"
   - Authorized JavaScript origins: `http://localhost:8000`, `https://yourdomain.com`
   - Authorized redirect URIs: `http://localhost:8000`, `https://yourdomain.com`
   - Copy the **Client ID**
6. Open `js/integrations/classroom.js` and paste the Client ID:
   ```js
   export const CLASSROOM_CONFIG = {
     CLIENT_ID: 'your-copied-client-id-here',
     // ... rest is pre-configured
   };
   ```
7. Reload the app. The integration will initialize when it loads.

### How It Works
- `initClassroomAuth()` sets up the Google OAuth token flow
- `fetchRosters(token)` fetches all courses and their student rosters
- `bindRostersToHouses(rosters)` maps courses to houses by period number in the course name:
  - "Social Studies — Period 3" → Valhalla (house 3)
  - "English — Period 1" → Camelot (house 1)
  - etc.

If a course doesn't match a period number, it goes into the `unassigned` collection.

> **Important**: The scaffold is intentionally inert until you add a Client ID. No errors will be thrown; the integration will simply report "disabled" on startup.

---

## Developer Notes

### Architecture
- **No build step**: Plain ES6 modules, served directly by the HTTP server
- **State management**: Centralized store in `js/core/store.js` with pub/sub listeners
- **Module registry**: Dynamic, plugin-based feature system in `js/core/registry.js`
- **Styling**: Tailwind CSS (CDN) + custom tokens in `css/theme.css`
- **Audio**: Built-in SFX synthesizer + WebAudio for playback

### Key Files
- `ARCHITECTURE.md` — Complete module contract and core API reference
- `js/config.js` — API keys, term config, POTW settings
- `js/core/store.js` — State machine and localStorage sync
- `js/main.js` — Boot and module registration
- `data/schema.json` — JSON Schema for the persisted state
- `js/integrations/classroom.js` — Google Classroom API scaffold

### Running the Dev Server
```bash
python3 -m http.server 8000
# Or with Node.js:
npx http-server -p 8000
# Or with a Mac Python shortcut:
cd mr-d-site && python3 -m http.server
```

Access at `http://localhost:8000`.

### Testing the App
1. Use the Morning Dashboard to see all houses
2. Tap the FAB (lower right) to add points to the active house
3. Switch cores using the topbar to test the house switcher
4. Open the browser console to inspect state:
   ```js
   store.getState()  // View all state
   store.getTotals('term')  // Get leaderboard
   store.getTransactions()  // View transaction log
   ```

---

## Troubleshooting

### App won't load
- Ensure you're serving over HTTP (not opening as `file://`)
- Check that Python/Node is running: `http://localhost:8000` should load the HTML
- Open the browser console (F12) for JavaScript errors

### Google Maps not showing in POTW
- Check your Maps API key in `js/config.js`
- Ensure the key is enabled for Maps 3D API
- POTW waits for `customElements.whenDefined('gmp-map-3d')`; if Maps fails to load, the module displays an error

### Audio not playing
- Check browser audio permissions
- Ensure `potw-songs/place-of-the-week-rock-01.mp3` exists and is valid
- SFX (Web Audio synthesis) works even if file playback fails

### Points not saving
- Check that localStorage is enabled (not private browsing)
- Verify `CONFIG.STORAGE_KEY` in `js/config.js` matches the actual key used

---

## License & Credits

**Built for Mr. D's 7th Grade Social Studies**

A collaborative classroom experience designed to make learning engaging, fun, and gamified. Built with:
- Tailwind CSS for styling
- Google Maps 3D for location exploration
- Web Audio API for dynamic sound
- ES6 modules for clean architecture

Enjoy! 🏰⚔️

