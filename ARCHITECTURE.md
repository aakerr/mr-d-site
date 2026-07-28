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
js/core/backup.js      — File System Access auto-backup to a chosen folder, plus a
                          once-a-day Downloads safety-net that works in every browser
js/core/media.js       — IndexedDB-backed media store (videos, PDFs, images)
js/core/carousel.js    — shared horizontal card-strip engine (strip/arrows/counter/
                          focus-card), used by both Quests and Magic Shop when the
                          teacher picks "carousel" over "grid" (Admin → Settings →
                          Screen layout); each screen owns only its own card markup
js/core/sampledata.js  — builds one realistic sample term (ledger, quests, planner)
                          for Admin's "Load sample data" — reads the live catalog/
                          settings so it respects whatever combat mode is active
js/core/escape.js      — the one shared HTML escaper (escapeHtml/escapeAttr), used
                          by every module that interpolates teacher-typed text
js/core/util.js        — shared small helpers used across modules (see the file
                          itself for its current export list — this module is newer
                          than the rest of this contract and grows as duplicated
                          logic gets pulled out of individual modules)
js/modules/dashboard.js   js/modules/houses.js    js/modules/potw.js
js/modules/dice.js        js/modules/battle.js    js/modules/shop.js
js/modules/quests.js      js/modules/council.js   js/modules/admin.js
js/integrations/classroom.js   — Google Classroom scaffold, UNWIRED (see below)
tools/hero-tuner.js     — dev-only overlay: live sliders over the dashboard hero's
                          CSS variables (name/motto/"WELCOME" size, gaps). Nothing it
                          changes is saved — a reload discards it. Two ways in: the
                          hidden hotspot in the hero's bottom-left corner, or
                          `import('/tools/hero-tuner.js').then(m => m.openHeroTuner())`
                          from the console. Not part of the shipped module contract.
data/schema.json       — JSON Schema for persisted state, kept in sync by hand
                          against store.js's defaultState()/load() — see store.js
                          itself if a field here ever looks wrong or missing.
images/{camelot,atlantis,valhalla,rivendell}-shield.png   — house crests
images/header-{camelot,atlantis,valhalla,rivendell}.jpg   — house hero banners
images/class-shield.png                                    — class crest (topbar brand)
images/icon-{quest,market,potw,battle,dice,points}.png     — per-screen topbar/tab icons
images/shop/*.png                                          — hand-drawn art for every
                          shipped Mr.-D's-rules (duel) shop item — static repo files,
                          like the house shields, so a fresh install needs no uploads
music/*.mp3, potw-songs/*.mp3, videos/*.mp4, sfx/*.mp3      — bundled audio/video assets
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
  `awardAll`, `purchase`, `applyAttack`, and `awardBattleWin`, which all funnel
  through the same transaction log). `awardBattleWin` is now the primary
  point-mover for Battle Day — see the combat API below.
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
  resolver; applies shield/reduction/pierce rules and logs the result **against
  points**. Still correct and still used, but now ONLY by the teacher's manual
  scoring row on Battle Day — shop purchases and duel strikes route through the
  HP-based combat API below instead.

#### Battle Day combat API (hit points, armoury, prizes)
Separate from the points system above. **Hit points (HP)** are a Battle-Day-only
meter that a strike removes; **points** only move once a house's HP reaches
zero, and only the winner's total moves — the loser's points are never
touched. See "Non-obvious traps" below for why `state.hp` stores *damage
taken* rather than current HP.
- `store.getHp(houseId)` → current HP, computed as `getMaxHp(houseId) -
  damage taken`, floored at 0. Never read `state.hp` directly — it holds
  damage, not HP.
- `store.getMaxHp(houseId)` → `hpBase + hpPer500 * floor(termPoints / 500)`
  (from `getCombat()`), so a house sitting on more points is harder to knock
  out.
- `store.damageHp(houseId, amount)` → applies damage (never below 0 HP),
  returns `{ before, after, defeated }`. Called from `battle.js`'s
  `resolveHpAttack`, which reproduces `applyAttack`'s shield → reduction →
  pierce order but resolves against HP instead of points.
- `store.resetAllHp()` → clears `state.hp` for every house — a full heal.
  Called once, when the Battle Day cinematic ignites, before the duel screen
  ever renders, so nobody starts a session already wounded from an earlier
  fight.
- `store.getInventory(houseId)` → `[{ item, count }]`, the house's armoury —
  offensive items (`attack`/`steal`/`pierce`) bought in the Magic Shop but not
  yet thrown — sorted by cost, live catalog item attached, any item since
  deleted from the shop silently dropped rather than rendered broken.
- `store.countOwned(houseId, itemId)` / `store.addToInventory(houseId,
  itemId, n=1)` / `store.consumeFromInventory(houseId, itemId)` — armoury
  read/write. `consumeFromInventory` returns `false` and mutates nothing if
  the house doesn't actually hold one, so a double-tapped strike button can't
  spend a weapon that isn't there.
- `store.isStockpiled(item)` → whether `item.effect.kind` is in
  `STOCKPILE_KINDS` (`Set(['attack', 'steal', 'pierce'])`) — i.e. whether
  buying it banks it in the armoury instead of firing immediately. Shields
  and damage-reduction items are deliberately NOT stockpiled (their timed
  protection starts the moment they're bought); wildcards resolve at purchase
  too, because the gamble IS the purchase.
- `store.canAttack(attackerId, defenderId)` → `{ ok, reason }` — enforces the
  "punching down" setting: off by default, a house may only attack one
  currently holding *more* points than itself.
- `store.previewPrize(attackerId, defenderId)` → what the attacker would win
  in points if the defender's HP hit zero right now, under whichever
  `PRIZE_RULES` rule is active. Never negative; never touches the defender.
- `store.awardBattleWin(winnerId, loserId)` → credits the winner
  `previewPrize`'s result via `addPoints` (tag `'battle'`) and returns what
  was **actually** credited post-`MAX_DELTA`-clamp — not the raw calculated
  prize. Callers must not just re-display `previewPrize`'s number after
  calling this; a prize could theoretically be clamped down. The loser's
  points are never touched.
- `store.getCombat()` / `store.updateCombat(patch)` — the Battle rules
  settings (Admin → Settings → ⚔️ Battle rules): `{ prizeRule, gapShare,
  prizePercent, prizeFlat, punchingDown, hpBase, hpPer500 }`. All clamping
  (0–100 for the two percentages, 0–`MAX_DELTA` for `prizeFlat`, 1–10000 for
  `hpBase`, 0–10000 for `hpPer500`) happens inside `updateCombat`, not in the
  Admin form — every caller (Admin, backup restore, a future preset) shares
  the same guarantee and must not re-clamp independently.
- `store.PRIZE_RULES` → `{ gap, percent, flat }`, each `{ label, blurb }`, for
  building the Admin rule picker (`gap` = half the point gap and the default;
  `percent` = share of the loser's total, compounds hard, not the advised
  choice; `flat` = fixed amount every win).
- `store.STOCKPILE_KINDS` → the `Set(['attack', 'steal', 'pierce'])` used by
  `isStockpiled`.

Everything above this line is the **hit-points** rule set's API. That is one
of TWO complete rule sets — see below.

#### Combat modes (`settings.combatMode`) and Mr. D's rules (`'duel'`) API
- `store.COMBAT_MODES` → `{ duel: {label, blurb}, hp: {label, blurb} }`.
  `store.getCombatMode()` reads `settings.combatMode` (`'duel' | 'hp'`,
  default `'duel'`); `store.setCombatMode(mode)` is the only way it's
  written. Switching mode swaps `shop.catalog` for the other mode's parked
  catalog (`shop.parked`) and clears the top-level `inventory` and `hp`
  keys — an item bought under one rule set means nothing under the other.
  Points, the transaction log, quests, the planner and every other setting
  are untouched by a mode switch.
- `store.duelSlotLimits(houseId)` / `store.duelHeld(houseId, slot)` /
  `store.duelCanBuy(houseId, itemId)` — enforce the one-attack/one-defense
  holding limit (two of each with the Bag of Holding); reuses the same
  top-level `inventory` key as the hit-points armoury, just interpreted by
  slot (`'attack' | 'defense' | 'utility'`) instead of by
  `STOCKPILE_KINDS`.
- `store.parseDice(spec)` → rolls dice notation like `'2d6'`.
  `store.previewDuelAttack(attackerId, targetId, itemId)` → whether the
  defender's held item counters this attack, without spending anything.
  `store.applyDuelAttack({ attackerId, targetId, itemId, rolled, consume })`
  — the central duel resolver: reveals the defender's held item, cancels
  the attack outright if it's a counter, otherwise applies the rolled
  total × the item's `mult` straight to the DEFENDER'S POINTS (never HP),
  floored at 0, crediting the attacker too for `'steal'`-kind items. Always
  consumes the attack item; only consumes the defense item if it actually
  blocked.
- `store.freezeHouse(houseId, days)` / `store.thawHouse(houseId)` — the
  Legendary Ice Axe's effect: the target can't earn any points from
  anywhere until the freeze lifts (top-level `state.frozen`, an expiry
  timestamp, pruned by `load()` on every load like `shields`/`defenses`).
- `store.peekHouse(viewerId, targetId)` / `store.hasRevealed(viewerId,
  targetId)` — the Stone of Seeing: reveals `targetId`'s held items to
  `viewerId` for the rest of the Battle Day session (top-level
  `state.revealed`), consumed even if the target is shrouded.
  `store.raiseShroud(houseId)` / `store.lowerShroud(houseId)` — the Shroud
  of Secrecy: blinds a Stone of Seeing used against `houseId` for one week
  (top-level `state.shrouded`).
- `store.canTimeTurn(houseId)` / `store.useTimeTurner(houseId)` — deletes
  the ledger entries for the most recent strike that hit `houseId` (via
  `store.recordStrike`'s per-house strike history), as though it never
  happened, and lifts a freeze if that was the strike undone.
- `store.getShopItems()` / `store.shopKindsForMode(mode)` /
  `store.saveShopItem(item)` / `store.deleteShopItem(id)` — catalog CRUD
  that operates on whichever mode is currently active; use
  `shopKindsForMode` rather than hardcoding an effect-kind list, since the
  two modes' kinds don't overlap (`'attack'/'steal'/'pierce'/'shield'/
  'reduce'/'wild'` for hit points vs. `'damage'/'steal'/'freeze'/'block'/
  'reveal'/'hide'/'timeturn'/'extraslot'` for duel).

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

#### Per-screen grid/carousel layout (`LAYOUT_SCREENS`)
- `store.LAYOUT_SCREENS` → `{ quests: {label}, shop: {label} }` — the only
  two screens that offer this choice.
- `store.getLayout(screenId)` → `'grid' | 'carousel'` (default `'grid'`);
  unknown ids always resolve to the default rather than throwing.
- `store.setLayout(screenId, layout)` — the only way `settings.layouts` is
  written; rejects an id not in `LAYOUT_SCREENS`. See `js/core/carousel.js`
  below for the shared rendering engine both screens use when set to
  `'carousel'`.

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
- `audio.sfx(name)` — plays the teacher's assigned recording FIRST
  (`store.getSettings().sfx[name]`, a path under `/sfx` set in Admin →
  Settings → Sound), and only falls back to a built-in WebAudio-synthesized
  tone if that slot is blank or the file fails to load/play. The synth
  covers six slots: `'sword'`, `'fanfare'`, `'thud'`, `'coin'`, `'roll'`,
  and `'diceland'` (the Die of Destiny settling — deliberately its own
  short, quiet slot rather than sharing `'thud'`, which reads too heavy and
  lands out of time with the tumble). A seventh slot, `'battlecry'` (the
  Battle Day war-cry line), has **no synth fallback at all** — it is a
  spoken voice line, ships silent by default, and simply stays quiet until
  the teacher records one, since a synthesized beep would be worse than
  nothing. Deliberately NOT cached as one element per sound: two strikes
  landing close together need to overlap, not cut each other off.
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
- That same `ambient.tracks` map also holds one PSEUDO-SCREEN key,
  `'flyover'` (`FLYOVER_TRACK_KEY` in store.js) — the music that plays under
  Place of the Week's Google Maps 3D flight, shown on the same Admin card as
  every other screen's track so the teacher only has one place to look. It
  is deliberately NOT a real module id: `ambient.js` only looks up a track by
  the id of the module actually mounted, and no module is called `'flyover'`,
  so nothing plays it as an ordinary background loop by accident.
  `js/modules/potw.js` reads `store.getSettings().ambient.tracks.flyover`
  directly instead, falling back to `CONFIG.POTW_FLYOVER_DEFAULT`. Flight
  music used to be set per POTW destination; it is now one global choice.
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
   entirely.** Discovered building the shared carousel engine (`js/core/carousel.js`,
   below): `scrollBy`, `scrollIntoView({behavior:'smooth'})`, and
   `scrollTo({behavior:'smooth'})` are all silently absorbed by the snap
   engine on a mandatory-snap container — measured, not assumed (smooth left
   `scrollLeft` at 0; the identical *plain* assignment reached the correct
   position). The working fix is a **plain** `el.scrollLeft = targetOffset`
   assignment — no `behavior: 'smooth'` anywhere near it. If you add
   snap-scrolling anywhere else, budget for instant (not animated)
   programmatic jumps, or don't use `mandatory`.

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

7. **`state.hp` stores damage taken, not current HP — this is deliberate, not
   a bug waiting to be "fixed."** It looks backwards until you hit the exact
   scenario it exists to prevent: a house's HP *ceiling* (`getMaxHp`) moves
   with its points (`hpBase + hpPer500 * floor(termPoints / 500)`), and a
   Battle Day win pays out in points. If `state.hp` stored "current HP"
   directly, the moment a win pushed a house over a 500-point boundary, its
   maximum would rise **and** its untouched "current" value would suddenly
   read as, say, `120/130` — the house appears freshly wounded for having
   just won a fight without taking a single hit. Storing *damage taken*
   instead means a change in points moves the maximum and the current value
   together, with no correction pass needed: `store.getHp(houseId)` always
   derives current HP as `getMaxHp(houseId) - (state.hp[houseId] || 0)`,
   floored at 0. If you touch `damageHp` / `getHp` / `resetAllHp`, keep them
   working in terms of damage taken — never introduce a field that stores an
   absolute "current HP" number, or this bug comes back.

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

## Grid/carousel layout — shared, persisted, Admin-configured (Quests + Shop)
`js/core/carousel.js` is the ONE horizontal card-strip implementation,
shared by every screen that offers a carousel instead of a scrolling grid.
It grew out of a quest-board prototype that forked from the grid, and every
round of polish on the grid then had to be hand-copied into the fork — three
separate divergences (a missing gap, a crushed description, a mismatched
button height) came out of that before it was pulled into its own module.
The caller owns the CARD markup; `carousel.js` owns the strip, the arrows,
the counter, and which card is centred (`injectCarouselStyles()` /
`carouselHtml(cardsHtml, {label})` / `wireCarousel(root, {restoreLeft})` /
`carouselScrollLeft(root)`). Card sizing is by CSS variable
(`--carousel-card-w`, `--carousel-card-maxh`) so each screen sets its own
width without forking the file.

Both `js/modules/quests.js` and `js/modules/shop.js` import this module and
choose grid vs. carousel per-render via `store.getLayout('quests')` /
`store.getLayout('shop')` — **not** a per-mount UI toggle. This is a
persisted, teacher-set preference (Admin → ⚙️ Settings → 🗂️ Screen layout,
`renderScreenLayoutCard()` in admin.js), saved via `store.setLayout(id,
layout)` into `settings.layouts` (see `LAYOUT_SCREENS` / `DEFAULT_LAYOUT` in
store.js — grid is the default) and shared by every device that loads the
same saved state. Neither screen has any UI-only "try it" toggle any more —
whatever the teacher picked in Admin is exactly what renders.
