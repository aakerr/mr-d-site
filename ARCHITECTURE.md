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
css/theme.css          — design tokens + shell styles (shell agent owns)
js/main.js             — boot + module registration (LEAD-OWNED)
js/config.js           — API keys, asset paths, term config, POTW/ambient presets (LEAD-OWNED)
js/core/store.js       — state store (LEAD-OWNED)
js/core/registry.js    — module registry/navigation (LEAD-OWNED)
js/core/shell.js       — topbar + quick-points panel + accent/theme wiring (shell agent owns)
js/core/audio.js       — audio helpers (LEAD-OWNED)
js/core/lock.js        — optional teacher PIN gate (see "The teacher PIN" below)
js/core/ambient.js     — per-screen looping background music + crossfade
js/core/masthead.js    — pure layout helper: centers/fits the Quests & Shop mastheads
js/core/firstrun.js    — first-run setup wizard (#firstrun-root), re-runnable from Help
js/core/health.js      — "System check" diagnostics, data-only (help.js renders it)
js/core/help.js        — in-app Help Wiki (NOT owned by any module agent — do not edit)
js/core/backup.js      — File System Access auto-backup to a chosen folder
js/core/media.js       — IndexedDB-backed media store (videos, PDFs, images)
js/modules/dashboard.js   js/modules/houses.js    js/modules/potw.js
js/modules/dice.js        js/modules/battle.js    js/modules/shop.js
js/modules/quests.js      js/modules/council.js   js/modules/admin.js
js/integrations/classroom.js   — Google Classroom scaffold, UNWIRED (see below)
data/schema.json       — JSON Schema for persisted state. STALE as of this doc: it
                          predates settings.lock, settings.moduleThemes,
                          settings.ambient, the quest catalog's type/icon/penalty
                          fields, and shop.seeded. Treat store.js as the source of
                          truth, not this file.
images/{camelot,atlantis,valhalla,rivendell}-shield.png   — house crests
images/header-{camelot,atlantis,valhalla,rivendell}.jpg   — house hero banners
images/class-shield.png                                    — class crest (topbar brand)
images/icon-{quest,market,potw,battle,dice,points}.png     — per-screen topbar/tab icons
music/*.mp3, potw-songs/*.mp3, videos/*.mp4                — bundled audio/video assets
```

Modules actually registered, in boot order (`js/main.js`):
`dashboard → houses → potw → dice → battle → shop → admin → quests → council`.

## Module contract (`js/modules/*.js`)
Each module default-exports:
```js
export default {
  id: 'dice',              // unique slug, used for navigation
  title: 'Die of Destiny',
  icon: '🎲',
  order: 40,               // dashboard tile sort (nullish → 99)
  showTile: true,          // false = launched some other way only (e.g. admin, council)
  tileClass: '',           // optional extra Tailwind classes for its launcher tile
  mount(el, ctx) {},       // render full-screen view into `el` (a <div> inside <main>)
  unmount() {},            // optional cleanup (timers, audio, map)
}
```
`ctx` = `{ store, registry, audio }` (the three core singletons).

**What `registry.register()` actually enforces**: only that `id` is truthy and
`mount` is a function. `unmount` and `order` are conventions, not requirements —
a module missing `unmount` just never gets cleaned up (`registry.navigate()`
calls it as `current?.unmount?.()`, so it's silently skipped, not an error).
`order` defaults to `99` if absent.

**What `registry.navigate()` does NOT do**: it does not `await` `mount()`, and
it does not wrap `mount()` in a `try/catch`. A synchronous throw inside your
`mount` propagates out of `navigate()` uncaught; an async `mount` that rejects
becomes an unhandled promise rejection that `navigate()` never sees (it has
already returned). `unmount()` IS wrapped in a `try/catch`, but only catches a
*synchronous* throw — an async `unmount` that rejects is not caught either.
Write `mount`/`unmount` defensively; don't rely on the registry for error
containment.

`showTile: false` is how `admin` (launched only via the topbar key) and
`council` (launched only by selecting "All Cores") stay off the dashboard grid
while remaining fully addressable via `registry.navigate(id)`.

## Core APIs

### `store` (js/core/store.js)
- `store.getState()` → full state (read-only by convention; never mutate directly)
- `store.subscribe(fn)` → fn(state) on every change; returns unsubscribe fn
- `store.setActiveCore(core)` — 1|2|3|4|'all'
- `store.getActiveHouse()` → house object for active core, or null when 'all'
- `store.addPoints(houseId, delta, { reason, tag })` — delta clamped to ±9999,
  logs a timestamped transaction. THE ONLY WAY to change points (except
  `awardAll`, `purchase`, and `applyAttack`, which all funnel through the same
  transaction log).
- `store.awardAll(delta, { reason, tag })` — applies `delta` to every house at once.
- `store.getTotal(houseId, scope)` / `store.getTotals(scope)` — scope `'term'`
  (default, all-time) or `'week'` (current Monday-anchored week).
- `store.getTransactions({ houseId, tag, from, to, search, limit })` → filtered,
  newest-first.
- `store.getWeeklySeries({ cumulative })` — per-week point totals per house
  across the term; feeds the Records screen's Term Arc chart.
- `store.getBreakdown(houseId, scope)` — per-tag earned/lost/net/count, for the
  Records screen's "where the points came from" panel.
- `store.removeTransaction(id)` — deletes a transaction (the ledger's "undo").
  **Only ever removes the points row** — it does not revert quest completion
  state, un-purchase a shop item, or undo a shield. See "Undo only undoes
  points" below.
- `store.getAwardPresets()` / `saveAwardPreset(preset)` / `deleteAwardPreset(id)`
  — the teacher's one-tap award routines (Admin → Settings → Quick award buttons).
- `store.purchase(houseId, cost, itemName)` → true/false (validates balance,
  logs `-cost` with tag 'shop')
- `store.activateShield(houseId, hours)` / `isShielded(houseId)` /
  `shieldRemainingMs(houseId)` / `clearShield(houseId)` — full-block Aegis shield.
- `store.activateReduction(houseId, hours)` / `hasReduction` /
  `reductionRemainingMs` / `clearReduction` — partial "damage reduction" effect
  (distinct from a full shield).
- `store.applyAttack({ fromId, toId, amount, pierce, label })` — central combat
  resolver; applies shield/reduction/pierce rules and logs the result.
- `store.getMythicRewards()` / `grantMythicItem(houseId, itemId)` — Nat-20 free
  item grants on the Die of Destiny.
- `store.getTermInfo()` → `{ week, totalWeeks, label }` e.g. "Week 4 of 9-Week Term"
- `store.getItinerary(core, date)` / `getHomework(core, date)` — planner-derived
  if an event exists for that date, else the static per-core default.
- `store.addEvent(evt)` / `updateEvent(id, patch)` / `removeEvent(id)` /
  `getEvents({from,to,type,core})` / `getEventsOn(date, core)` — the Planner.
- House object: `{ id, core, name, motto, color, accent, accentSoft, image, heroImage }`
  (accent = hex, image = shield crest, heroImage = wide banner). Mutated in
  place by `updateHouse(id, patch)` / `resetHouse(id)` — the module-level
  `HOUSES` map is never replaced wholesale.
- `store.getSettings()` / `updateSettings(patch)` — settings is a flat
  shallow-merge target; nested objects (`theme`, `lock`, `ambient`,
  `moduleThemes`) should be spread-patched by the caller, not overwritten whole.

#### Quests API
- `store.QUEST_TYPES` — `{ service, academic, community, habit }`, each
  `{ id, icon, label, blurb }`. `DEFAULT_QUEST_TYPE = 'service'` is the
  fallback for anything untyped (a hand-written quest, or one restored from a
  backup that predates types).
- `store.questType(q)` → the `QUEST_TYPES` entry for `q.type`, or the
  `service` entry if `q` or `q.type` doesn't match.
- `store.questIcon(q)` → `q.icon` if the quest has its own, else
  `questType(q).icon` (the category icon).
- `store.getQuestCatalog()` / `saveQuest(quest)` / `deleteQuest(id)` —
  catalog CRUD. **See the `saveQuest` trap below before adding a field.**
- `store.getAvailableQuests()` / `isQuestTaken(id)` / `questHolder(id)` /
  `getActiveQuest(core)` / `startQuest(core, id)` / `completeQuest(core)` /
  `failQuest(core)` (penalty) / `abandonQuest(core)` (no penalty, teacher
  correction) / `getCompletedQuests({core, limit})`.

#### Per-screen accent colour (`MODULE_THEMES`)
```js
const MODULE_THEMES = {
  dashboard: { label: 'Home screen', color: '#f59e0b', matchHouse: true },
  quests:    { label: 'Quests',      color: '#b45309', matchHouse: false },
  houses:    { label: 'Records',     color: '#f59e0b', matchHouse: true },
};
```
Only these **three** screens are configurable — `store.getModuleTheme(id)`
returns `{ matchHouse: true, color: null, configurable: false }` for every
other module id, meaning `shell.js`'s accent override never fires for them.
Every other screen (Magic Shop, Battle Day, Die of Destiny, Council, POTW)
computes its own per-element colors straight from `house.accent` and never
reads the shell's global `--accent` — see "The accent system" below.
- `store.getModuleTheme(moduleId)` → resolved `{ configurable, label, color,
  matchHouse }`, merging any teacher override (Admin → Settings → Screen
  colours) over the shipped default.
- `store.setModuleTheme(moduleId, patch)` — rejects an id not in
  `MODULE_THEMES` (returns `false`).
- `store.resetModuleTheme(moduleId)` — restores the shipped default.

#### POTW API (subset)
- `store.getPotwProfiles()` / `savePotwProfile(key, profile)` /
  `deletePotwProfile(key)`
- `store.resolvePotwKey(date)` / `getActivePotwKey()` / `getManualPotwKey()` /
  `setActivePotw(key)` — scheduled-vs-manual resolution.
- `store.getPotwProfile()` → the resolved current profile with `videoUrl` filled in.
- `store.getPotwVideoOptions()` / `getPotwVideoUrl(profile)` /
  `saveIntroVideo({id,label,url})` / `deleteIntroVideo(id)`.
- `store.bountyKey/isBountyPaid/getPaidBounty/payBounty` — POTW quiz bounties,
  paid exactly once per profile/week/question.

#### Ambient audio settings
- `store.getAmbient()` / `updateAmbient(patch)` / `setAmbientTrack(moduleId, src)`
  — see `js/core/ambient.js` below for how these are consumed.

Storage: `localStorage[CONFIG.STORAGE_KEY]` (`'mrd-classroom-os-v1'`).
`defaultState()` sets `version: 1`, but **nothing in `store.js` currently reads
or branches on `state.version`** — the `load()` migration logic runs
unconditionally on every load rather than being version-gated. Don't assume a
version bump alone will trigger any migration path; it won't.

### `registry` (js/core/registry.js)
- `registry.init(context)` — stores the shared `ctx` passed to every `mount(el, ctx)`.
- `registry.register(module)`
- `registry.get(id)` / `registry.currentId()`
- `registry.modules()` → registered modules sorted by `order` ascending (99 default)
- `registry.navigate(id)` — unmounts current (try/catch, sync-only), clears and
  rebuilds `#module-root`, mounts target (not awaited, not try/catch'd), then
  dispatches `window` event `module:navigate` with `{ detail: { id } }`. This
  event is what `shell.js` (topbar/accent refresh) and `ambient.js` (per-screen
  music) both key off — a module doesn't need to announce its own navigation.
- `registry.home()` — `navigate('dashboard')`.

### `audio` (js/core/audio.js)
- `audio.play(src)` → HTMLAudioElement (returns even on failure; never throws)
- `audio.sfx(name)` — WebAudio-synthesized effects: 'sword', 'fanfare', 'thud',
  'coin', 'roll' (no asset files needed)
- `audio.say(text)` — speechSynthesis voice line, safe no-op if unsupported
- `audio.stopAll()`

`shell.js` wraps this singleton once at boot (`applySoundGate`) so the master
mute setting actually silences `sfx`/`say`/`play` — `audio.js` itself is
lead-owned and doesn't check the setting on its own. `play()` is muted
(volume 0) rather than suppressed entirely when sound is off, specifically
because `potw.js` waits on the returned element's `'ended'` event to advance
the cinematic — returning nothing would strand it.

### `lock` (js/core/lock.js) — the optional teacher PIN
A classroom deterrent, not real security (everything runs in the browser; devtools
defeat it trivially) — and the file says so in its own header comment. Ships
**off** (`settings.lock.pinHash` empty); nothing is gated until the teacher
turns it on. `DEFAULT_PIN = '0314'` only pre-fills the setup field as a
suggestion — it is never applied automatically.
- `lock.isEnabled()` / `lock.isUnlocked()`
- `lock.requireUnlock(reason)` → `Promise<boolean>`. No PIN set, or already
  unlocked → resolves immediately `true`. Otherwise shows a PIN pad (mounted
  into `#overlay-root`) and resolves when the teacher enters the PIN or
  cancels. **One pad at a time** — concurrent callers share the same promise.
  This is the gate every point-mutating action calls before touching the
  store: Admin panel entry (`shell.js`), the quick-points FAB, quest
  complete/fail, dice awards, battle strikes, shop purchases, POTW bounty
  payouts, and ledger undo in Records.
- `lock.touch()` — slides the unlock window forward (called automatically by
  `requireUnlock` on success).
- `lock.lockNow()` — re-locks immediately (shift-click or 550ms long-press on
  the topbar admin glyph).
- `lock.setPin(pin)` / `lock.clearPin(currentPin)` / `lock.setMinutes(min)` /
  `lock.verify(pin)`.
- `lock.getRecoveryCode()` / `lock.recoverWithCode(code)` — the way back in.
  **The recovery code is stored in `settings.lock.recovery` as plain text on
  purpose**: a forgotten PIN would otherwise lock the teacher out of Admin,
  and therefore out of Backup & Restore — the only in-app way to undo it.
  Because it's plain text, it also appears in every backup `.json` file. That
  is the intended recovery path ("open your backup in a text editor, search
  for `recovery`"), and it is also the mechanism's honest weak point: anyone
  holding a backup file can read it.
- Session unlock lives in `sessionStorage` (default 15 minutes,
  teacher-configurable 5/15/30/60), so a reload mid-lesson doesn't re-prompt
  but a new day does.
- Fires `window` event `lock:changed` on every lock/unlock, which
  `quests.js` and `shell.js` both listen for to keep a 🔒/🗝️ badge honest
  without waiting for the next store change.

### `ambient` (js/core/ambient.js) — per-screen background music
- `initAmbient()` — self-wires: listens for `module:navigate` (switches track)
  and `store.subscribe` (re-applies volume/enabled/mute changes). Called once
  from `main.js`.
- `ambientFor(moduleId)` / `refreshAmbient()` / `stopAmbient()` / `ambientStatus()`.
- Tracks are assigned per screen in Admin → Settings → Background music
  (`store.getSettings().ambient.tracks`, falling back to `CONFIG.AMBIENT_TRACKS`).
  A screen with no assigned track is silent by design — POTW and Battle Day
  make their own noise and are excluded from the assignable list.
- One `<audio>` element at a time; screen changes crossfade over 900ms.
  Obeys both its own `ambient.enabled`/`volume` settings AND the master
  `settings.soundEnabled` switch.
- **Global mute is NOT implemented in ambient.js** — it only reads
  `soundEnabled`. The `M` key (ignored while typing in a field) and the
  topbar speaker button both live in `shell.js` and write
  `store.updateSettings({ soundEnabled })`; `ambient.js` picks the change up
  via its `store.subscribe`.

### `masthead` (js/core/masthead.js) — pure layout helper
Not a module, not a singleton with state — a stateless layout function used by
the Quests and Magic Shop headers to center their title/subtitle/icon/pill
precisely (subtitle font-size is iteratively scaled to match the title's ink
width). `fitMastheadWhenReady(parts)` runs it once immediately, once on the
next animation frame, and once more after `document.fonts.ready` (Cinzel's
metrics shift once the webfont actually loads).

### `firstrun` (js/core/firstrun.js) — first-run setup wizard
A 6-step wizard (Welcome → Backup → Term dates → Houses preview → PIN →
Done), shown once per browser (`settings.setupDone`) and re-runnable from
Help. Owns exactly one element, `#firstrun-root`, removed completely on
close. Every step has a visible "Skip for now" — it must never block a class
that's already sitting down. `maybeRunFirstRun()` is called once from
`shell.js` at boot, 350ms after initial paint so the dashboard is visible
behind it.

### `health` (js/core/health.js) — "System check"
Owns no DOM; returns plain `{ id, level, title, detail, fix, action? }` rows
that `help.js` renders under "🩺 System check". Every individual check runs
in its own `try/catch` so a failing check degrades to a neutral row instead of
ever throwing into the app. Checks: backup connection + last-backup age (its
own `mrd-last-backup-ts` localStorage mirror, since `backup.js`'s in-memory
timestamp resets on reload), backup error state, Google Maps 3D load status,
POTW media integrity (do the profiles that claim a presentation actually have
the blob in IndexedDB), POTW weekly schedule sanity, term-date sanity,
localStorage usage vs. a ~5MB budget, and IndexedDB media usage.

### `backup` (js/core/backup.js) / `media` (js/core/media.js)
`backup.js` self-initializes on import (File System Access API, Chrome/Edge
only); debounces ~2s after any store change, writes `mrd-live-backup.json`
plus a write-once-per-calendar-day `mrd-backup-YYYY-MM-DD.json`. The folder
handle persists in its own IndexedDB (`mrd-backup`) so it survives reloads
without re-prompting (permission is re-checked, never re-requested, without a
user gesture). `media.js` is a separate IndexedDB (`mrd-media`) for uploaded
blobs (videos/PDFs/images), keyed by string convention
(`potw:<profileKey>:...`) — backups never include these blobs.

## Shell DOM (fixed in index.html)
```html
<header id="topbar"></header>       <!-- shell.js renders into this -->
<main id="module-root"></main>      <!-- registry mounts active module here -->
<div id="overlay-root"></div>       <!-- full-screen overlays (POTW, battle, PIN pad) -->
<div id="fab-root"></div>           <!-- quick-points panel + point toasts -->
```
These four ids are unchanged since the app's first version. Nothing else is
static in `index.html` — the PIN pad (`lock.js`), the first-run wizard
(`firstrun.js`, its own `#firstrun-root` on `<body>`), and the Help overlay all
mount their own root elements dynamically at runtime rather than living in the
HTML skeleton.

The quick-points UI is no longer a permanently-visible floating circle: a
small "±" trigger sits in the topbar itself (hidden entirely on the Admin
screen), and tapping it opens a dropdown panel anchored top-right, rendered
into `#fab-root`. Point toasts are separate sibling elements appended
directly to `#fab-root` (not inside the panel), so closing the panel mid-toast
can't yank an animating toast out of the DOM.

Full-screen cinematic modules (POTW, Battle) render overlays into
`#overlay-root` (z-index 50+) and MUST remove them on unmount.

## The accent system — `var(--accent)` / `var(--accent-soft)` / `var(--accent-rgb)`
`shell.js`'s `applyAccentVars()` runs on every `module:navigate` and every
store change. Default accent = the active house's `accent`/`accentSoft`, or
neutral amber (`#f59e0b`) when "All Cores" is active. It then checks
`store.getModuleTheme(currentModuleId)`: **only** if that module is
`configurable` AND `matchHouse` is `false` AND it has a `color` set does the
module's own colour win over the house colour. Out of the box that means:
- `dashboard`, `houses` default to `matchHouse: true` → they follow the active
  house unless the teacher explicitly pins a colour in Admin.
- `quests` defaults to `matchHouse: false`, its own amber-brown — it keeps its
  own identity by default, switchable to "match house" in Admin.
- Every other screen — Magic Shop, Battle Day, Die of Destiny, Council of
  Four, Place of the Week — is simply not in `MODULE_THEMES`, so the override
  never fires. These screens compute their **own** locally-scoped CSS custom
  properties (e.g. `--h`, `--side-accent`, `--pick-accent`, `--acc`) directly
  from `house.accent` per element, and never read the shell's global
  `--accent` at all. This isn't an oversight to "fix" — Battle Day shows two
  houses on screen at once, so a single global accent wouldn't make sense
  there anyway. But it does mean the Admin → Settings → Screen colours picker
  only has visible effect on three screens; document that plainly to the
  teacher rather than implying it's app-wide.

## Non-obvious traps (learned the hard way — they will bite again)

1. **`saveQuest(quest)` rebuilds the quest object field by field.** It does
   NOT spread the incoming object; it constructs a fresh literal naming every
   field it keeps (`id, title, desc, points, repeatable, type, icon,
   penalty`). Any new quest field must be added to that literal or Admin's
   save silently drops it — the field simply never reaches the catalog, with
   no error anywhere. The code has an inline comment saying exactly this;
   don't remove it when you next touch `saveQuest`.

2. **Spread-merging saved state over defaults masks newly-shipped list
   items.** `load()`'s general pattern is `{ ...def.X, ...(saved.X || {}) }`
   — a shallow merge. For an array-valued key like `quests.catalog`, that
   means: if the teacher's saved catalog is non-empty, it wins *in its
   entirety* — a new quest added to `defaultQuestCatalog()` in a future
   release never appears for a teacher who already has a saved catalog,
   because the whole array is kept as-is (only a *missing or empty* saved
   catalog falls back to defaults). There's a per-field *backfill* pass
   afterward (matches by `id`, fills in missing `type`/`icon`/`repeatable`/
   `penalty` on quests already present) but nothing that appends a
   wholly-new default quest. **Contrast:** `shop.catalog` handles this
   correctly via a `seeded` id-list (`merged.shop.seeded`) that tracks which
   default items this browser has already seen, so a genuinely new shop item
   gets appended exactly once while a teacher's deliberate deletion stays
   deleted. If you ship new default quests, either add the same `seeded`
   mechanism to quests or accept that existing teachers won't see them
   without a manual re-add.

3. **The Quests board re-renders on a 60-second tick** (`setInterval(...,
   60000)` in `quests.js`, to keep "accepted 12 min ago" honest) in addition
   to every store change. Anything holding a DOM node across an `await` in
   that file will find the node stale/detached the moment the tick (or any
   other re-render) fires mid-wait — `render()` does a full
   `rootEl.innerHTML = ...` rebuild. The one async function in the file
   (`confirmModal()`, gating `complete`/`fail` behind `lock.requireUnlock`)
   gets this right by construction: it queries the DOM (`querySelector`)
   *after* the `await` resolves, never before, and separately guards against
   the module having been unmounted entirely (`if (!ui) return;`). Follow
   that pattern — query fresh after any `await`, don't cache before it.

4. **`scroll-snap-type: x mandatory` swallows programmatic smooth scrolls
   entirely.** Discovered in the quest carousel prototype (below): `scrollBy`,
   `scrollIntoView({behavior:'smooth'})`, and `scrollTo({behavior:'smooth'})`
   are all silently absorbed by the snap engine on a mandatory-snap container
   — measured, not assumed (smooth left `scrollLeft` at 0; the identical
   *plain* assignment reached the correct position). The working fix is a
   **plain** `el.scrollLeft = targetOffset` assignment — no `behavior:
   'smooth'` anywhere near it. If you add snap-scrolling anywhere else, budget
   for instant (not animated) programmatic jumps, or don't use `mandatory`.

5. **`registry.navigate()` doesn't await `mount()` and doesn't catch
   `unmount()`'s async failures** — see the module contract section above.
   Keep `mount`/`unmount` synchronous where you can, and if either must be
   async, make sure the module itself never lets that promise reject
   somewhere the caller can't see.

6. **Undo only undoes points.** `store.removeTransaction(id)` deletes the
   ledger row and nothing else — it never touches quest/shop/combat state. A
   quest marked complete stays complete after its points are undone; a
   purchased shield stays active after its cost is refunded. `houses.js`
   surfaces this explicitly per-category in its undo confirm dialog
   (`tagWarning()`) — if you add a new transaction `tag`, consider whether it
   needs its own warning there too.

## Houses (canonical — do not restyle)
| Core | House | accent | image |
|---|---|---|---|
| 1 | Camelot | #ef4444 red | images/camelot-shield.png |
| 2 | Atlantis | #3b82f6 blue | images/atlantis-shield.png |
| 3 | Valhalla | #f59e0b gold | images/valhalla-shield.png |
| 4 | Rivendell | #22c55e green | images/rivendell-shield.png |

## Design tokens (use these Tailwind-ish conventions)
- Background: `#0b0f19` page, `#111827`/`#1f2937` cards, borders `#374151`
- Text: `#f9fafb` primary, `#9ca3af` secondary
- Rounded-2xl cards, soft glows using house accent at 30-50% alpha
- Animations: 150-300ms ease transitions; use `@keyframes` for flourishes
- All interactive elements ≥ 48px hit area (touch smartboard)

## Google Maps 3D
Loaded in `main.js` (not `index.html`): `libraries=maps3d&v=beta`, key resolved
as `store.getSettings().mapsApiKeyOverride || CONFIG.MAPS_API_KEY` so a
teacher-supplied key overrides the bundled default. POTW module creates its
own `<gmp-map-3d mode="hybrid">` inside its overlay (after awaiting
`customElements.whenDefined('gmp-map-3d')`) and destroys it on unmount.

## Google Slides embed (Place of the Week presentation)
`potw.js` can present a Google Slides deck via a published-embed iframe
instead of a PDF. Google publishes no `postMessage` API for its player, so
this app genuinely cannot drive the deck's slide navigation — it can only
manage iframe focus so a presenter remote's PageUp/PageDown reaches Google's
own player, and it force-sets `start=false&loop=false` on the embed URL so
the deck doesn't auto-run. **Audio behavior inside the embed is not
controlled or verified by this app at all** — no `mute`/`autoplay` parameter
is set by `gslidesEmbedUrl()`, and whatever the deck does (embedded YouTube
video autoplaying, audio files inserted directly into Slides) is entirely up
to Google's player and the teacher's own deck. The Admin editor's own UI copy
already flags this honestly: "audio files inserted directly into Slides may
not play in a published embed — embedded YouTube video does." Treat this as
an open question, not a bug to chase — there's nothing in this codebase left
to fix it with.

## Google Classroom integration — unwired scaffold
`js/integrations/classroom.js` is **not imported anywhere** — not in
`main.js`, not in any module. `CLASSROOM_CONFIG.CLIENT_ID` ships empty, so
even if something did call `initClassroomAuth()`, it would return
`{ enabled: false }` immediately. The file documents its own activation steps
in a header comment (Google Cloud project → enable Classroom API → OAuth
consent screen → Web client ID → paste `CLIENT_ID` → serve over HTTPS) and
exports `fetchRosters()` / `bindRostersToHouses()` for mapping "Period N" in a
course name to a house core. None of it does anything until CLIENT_ID is set
and something actually calls `initClassroomAuth()` from the boot path — that
wiring does not currently exist.

## Quests board — carousel prototype (undecided, not shipped)
`js/modules/quests.js` renders its available-quests list as a `.quest-grid`
by default, but has a second, fully-built `.quest-carousel` layout
(scroll-snap based, centre card scaled up, count/prev/next controls) behind a
"◗ Try carousel" toggle in the board header. This is explicitly marked in the
source as an A/B prototype meant to be judged against the real board at
1280×720, **not a shipped feature** — "whichever loses gets deleted." The
toggle is transient, per-mount UI state only (`ui.layout`, reset to `'grid'`
on every `mount()`); it is never written to the store or `localStorage`. If
you pick a winner, delete the losing layout's markup/CSS/click-handlers
(`case 'layout'`, `case 'carousel-prev'/'carousel-next'`, `wireCarousel()`,
and the `.quest-carousel*` CSS block) rather than leaving both in place.
