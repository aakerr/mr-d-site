# Mr. D's Classroom OS — Architecture Contract

Every module MUST follow this contract. Do not edit `index.html`, `js/main.js`,
`js/core/store.js`, or `js/core/registry.js` — they are owned by the lead.
You own ONLY the files assigned to you.

## Stack
- Plain HTML5 + Tailwind (CDN, dark mode) + ES6 modules. No build step.
- Target display: 16:9 high-res smartboard, touch-first (min 48px touch targets),
  dark UI, high contrast, smooth CSS animations.

## File layout (site root = this directory)
```
index.html            — shell skeleton (LEAD-OWNED, do not edit)
css/theme.css         — design tokens + shell styles (shell agent owns)
js/main.js            — boot + module registration (LEAD-OWNED)
js/config.js          — API keys, asset paths, term config (LEAD-OWNED)
js/core/store.js      — state store (LEAD-OWNED)
js/core/registry.js   — module registry/navigation (LEAD-OWNED)
js/core/shell.js      — topbar + FAB + grid renderer (shell agent owns)
js/core/audio.js      — audio helpers (LEAD-OWNED)
js/modules/dashboard.js  js/modules/houses.js   js/modules/potw.js
js/modules/dice.js       js/modules/battle.js   js/modules/shop.js
js/integrations/classroom.js
data/schema.json
images/{camelot,atlantis,valhalla,rivendell}.png   — real house artwork (exists)
potw-songs/*.mp3                                    — real audio (exists)
```

## Module contract (`js/modules/*.js`)
Each module default-exports:
```js
export default {
  id: 'dice',              // unique slug, used for navigation
  title: 'Die of Destiny',
  icon: '🎲',
  order: 40,               // dashboard tile sort
  showTile: true,          // false = launched some other way only
  tileClass: '',           // optional extra Tailwind classes for its launcher tile
  mount(el, ctx) {},       // render full-screen view into `el` (a <div> inside <main>)
  unmount() {},            // optional cleanup (timers, audio, map)
}
```
`ctx` = `{ store, registry, audio }` (the three core singletons).

## Core APIs

### `store` (js/core/store.js)
- `store.getState()` → full state (read-only by convention; never mutate directly)
- `store.subscribe(fn)` → fn(state) on every change; returns unsubscribe fn
- `store.setActiveCore(core)` — 1|2|3|4|'all'
- `store.getActiveHouse()` → house object for active core, or null when 'all'
- `store.addPoints(houseId, delta, { reason, tag })` — delta clamped to ±9999,
  logs a timestamped transaction. THE ONLY WAY to change points.
- `store.getTotals(scope)` — scope 'term' (default) or 'week' →
  `[{ house, total }]` sorted desc
- `store.getTransactions({ houseId, limit })` → newest first
- `store.purchase(houseId, cost, itemName)` → true/false (validates balance,
  logs `-cost` with tag 'shop')
- `store.activateShield(houseId)` / `store.isShielded(houseId)` — 24h Aegis
- `store.getTermInfo()` → `{ week, totalWeeks, label }` e.g. "Week 4 of 9-Week Term"
- `store.getItinerary(core)` → array of `{ time, text }` for today
- `store.getHomework(core)` → array of `{ due, text }`
- House object: `{ id, core, name, motto, color, accent, accentSoft, image }`
  (accent = hex, image = e.g. 'images/camelot.png')

### `registry` (js/core/registry.js)
- `registry.register(module)`
- `registry.navigate(id)` — unmounts current, mounts target into `#module-root`
- `registry.home()` — navigate('dashboard')
- `registry.modules()` → registered modules sorted by `order`

### `audio` (js/core/audio.js)
- `audio.play(src)` → HTMLAudioElement (returns even on failure; never throws)
- `audio.sfx(name)` — WebAudio-synthesized effects: 'sword', 'fanfare', 'thud',
  'coin', 'roll' (no asset files needed)
- `audio.say(text)` — speechSynthesis voice line, safe no-op if unsupported
- `audio.stopAll()`

## Shell DOM (fixed in index.html)
```html
<header id="topbar"></header>       <!-- shell.js renders into this -->
<main id="module-root"></main>      <!-- registry mounts active module here -->
<div id="overlay-root"></div>       <!-- full-screen overlays (POTW, battle) -->
<div id="fab-root"></div>           <!-- floating quick-point adder -->
```
Full-screen cinematic modules (POTW, Battle) render overlays into
`#overlay-root` (z-index 50+) and MUST remove them on unmount.

## Houses (canonical — do not restyle)
| Core | House | accent | image |
|---|---|---|---|
| 1 | Camelot | #ef4444 red | images/camelot.png |
| 2 | Atlantis | #3b82f6 blue | images/atlantis.png |
| 3 | Valhalla | #f59e0b gold | images/valhalla.png |
| 4 | Rivendell | #22c55e green | images/rivendell.png |

## Design tokens (use these Tailwind-ish conventions)
- Background: `#0b0f19` page, `#111827`/`#1f2937` cards, borders `#374151`
- Text: `#f9fafb` primary, `#9ca3af` secondary
- Rounded-2xl cards, soft glows using house accent at 30-50% alpha
- Animations: 150-300ms ease transitions; use `@keyframes` for flourishes
- All interactive elements ≥ 48px hit area (touch smartboard)

## Google Maps 3D
Loaded in index.html: `libraries=maps3d&v=beta`, key in `js/config.js`
(`CONFIG.MAPS_API_KEY`). POTW module creates its own `<gmp-map-3d mode="hybrid">`
inside its overlay and destroys it on unmount.
