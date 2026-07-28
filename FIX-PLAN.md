# Audit Fix Plan — Mr. D's Classroom OS

Produced by a full six-track audit (core/store/backup, admin.js, battle+dice, shop/houses/potw,
quests/council/dashboard/theme, repo-wide zombie sweep) on 2026-07-27. Every finding below was
verified against the working tree at commit `5418da5` — line numbers refer to that state.

**How to use this file:** work the phases in order. Phase 0 and 1 are correctness and
data-safety; do not reorder them below cosmetic work. Each item is one commit unless noted.
When a fix changes behaviour described in README.md/ARCHITECTURE.md, update the doc in the
same commit.

---

## Phase 0 — Data safety (do these before the app touches the school machine)

The app's storage design is local-first by intent: localStorage primary, File System Access
folder autosave, daily safety-net download. The design is sound; these are the holes in it.

- [x] **0.1 Quarantine a corrupt save instead of destroying it.** `js/core/store.js:579-846`:
  `load()`'s catch returns `defaultState()`, and the next `persist()` overwrites the
  corrupt-but-recoverable raw string. Before returning defaults, copy the raw payload to
  `mrd-classroom-os-v1-corrupt` (with a timestamp) and show a banner in the style of
  `showPersistFailure` (store.js:887) telling the teacher a damaged save was set aside and to
  restore from backup. Never silently boot to defaults over a non-empty save.

- [x] **0.2 Fix the Firefox/Safari backup lie.** `js/core/backup.js:207-208`: `boot()` returns
  on `!supported()` *before* `ensureSubscribed()`, so on any browser without
  `showDirectoryPicker` the daily-download safety net never runs — while `backup.health()`
  (backup.js:295-298) and the shell's ☁️ tooltip still report "a backup file is saved to your
  Downloads once a day". Move `ensureSubscribed()` above the `supported()` check. The daily
  download path uses no FS Access API and works everywhere.

- [x] **0.3 Snapshot before every restore.** `js/modules/admin.js:3290-3308` (`importBackup`),
  `admin.js:3589-3596` (`restoreFromFolder`), `admin.js:3325-3338` (`loadSampleData`): all
  overwrite live state with no undo, and validation is two keys deep (`version`,
  `transactions`). Before `localStorage.setItem`, copy the current value to
  `mrd-classroom-os-v1-prev` so every restore is reversible, and surface a "Undo last restore"
  action in Admin → Backup. Deepen validation: check `potw`/`quests`/`shop`/`settings` are
  objects, `transactions` an array of objects with `id`/`delta`.

- [x] **0.4 Request persistent storage.** At boot (js/main.js or store init), call
  `navigator.storage.persist()` (fire-and-forget, guard for absence). Protects against
  Chrome evicting the origin's storage under pressure.

- [x] **0.5 Detect two-tab clobbering.** `js/core/store.js:576, 871`: state loads once per tab
  and every `emit()` rewrites the whole key; a second tab (easy with the installed-PWA window
  plus a normal tab) silently overwrites the first's work. Minimum viable fix: listen for the
  `storage` event on `CONFIG.STORAGE_KEY`; on foreign change, show a blocking banner ("This
  app is open in another window — close one; this one has stopped saving") and stop persisting
  from the stale tab.

- [x] **0.6 Daily download should trigger on any meaningful change, not just ledger entries.**
  `js/core/backup.js:170-173`: `hasData` requires `transactions.length > 0`, so an afternoon
  spent building quests/planner/POTW with no point activity gets no backup that day. Trigger
  when the persisted state differs from `defaultState()` in any module the teacher edits
  (cheap proxy: transactions OR quests.catalog changed OR planner.events non-empty OR any
  potw profile saved).

- [x] **0.7 Folder restore should see the dated snapshots.** `js/core/backup.js:316-334`:
  `restoreLatest()` reads only `mrd-live-backup.json`; if it's missing/corrupt the app says
  "no valid backup" while dated `mrd-backup-YYYY-MM-DD.json` files sit in the same folder.
  Fall back to the newest dated snapshot, and say which file was used.

- [x] **0.8 New POTW destination must not silently overwrite an existing one.**
  `js/modules/admin.js:4759-4761` + `js/core/store.js:2281`: `slugify(title)` collides with an
  existing key ("Egypt" → `egypt`), and `commitPresentation`/`commitFlyover` delete the old
  destination's IndexedDB media before `savePotwProfile` overwrites the profile. On create,
  if the slug exists, uniquify (`egypt-2`) or refuse with a message. This is a
  data-destruction path, hence Phase 0.

---

## Phase 1 — Class-visible correctness bugs

Everything here produces wrong numbers, silent no-ops, or self-contradiction in front of a
class. Ordered by embarrassment potential.

### Shop is broken on a fresh install
- [ ] **1.1 DECIDED (owner, 2026-07-27): full purchase parity — two shops, one per combat
  system.** `js/modules/shop.js:16, 597-606`: `KNOWN_KINDS` only knows the hit-points item
  kinds; the shipped default mode is `duel` (`store.js:140`) whose kinds are
  `damage/freeze/block/reveal/hide/timeturn/extraslot`, and duel steal items carry
  `dice`/`mult` with no `effect.amount`. Result: on first run, **every** Magic Shop card
  reads "⚠️ Misconfigured — ask your teacher to fix this item in Admin".
  Owner's spec: the Magic Shop screen shows the catalog for whichever battle system is
  active (the store already keeps the two catalogs separate — active + `shop.parked`), and
  **items can be purchased at any time**, not only on Battle Day. Implementation:
  - Make shop.js mode-aware: import the valid kind sets from store.js (delete the
    hand-copied `KNOWN_KINDS`), and validate duel steal items by their real shape
    (`dice`/`mult`, no `effect.amount`).
  - Duel-mode purchases from the Shop screen must land in the house armoury
    (`state.inventory`) exactly as Battle Day's mini-shop does — same store call, one code
    path shared by both screens, so the two can never disagree.
  - Keep Battle Day's mini-shop as-is (it's a convenience view of the same shop).

### Silent refusals with celebratory feedback (the store refuses, the UI cheers)
The store's `addPoints` returns `null` (frozen house) or a trimmed transaction (zero floor),
and provides `explainRefusal()` (store.js:1283-1302). Four call sites ignore this:
- [ ] **1.2** `js/modules/battle.js:2862-2866` — teacher "+10" on a frozen house plays the coin
  sfx and floats "+10"; nothing is written. Route through `explainRefusal` like dice.js:431.
- [ ] **1.3** `js/modules/battle.js:2879-2881` — teacher "−10" shows the untrimmed number; on a
  house at 4 pts the ledger says −4. Use the returned tx's delta (as `applyDuelAttack` already
  does, store.js:1588-1598).
- [ ] **1.4** `js/modules/houses.js:1170-1189` — "Award ALL FOUR HOUSES" ignores
  `store.awardAll()`'s return; a frozen house gets nothing while the toast says otherwise.
  Report per-house results ("+10 to three houses — Valhalla is frozen").
- [ ] **1.5** `js/modules/potw.js:1056-1058` — a bounty paid to a frozen house returns `false`
  from `payBounty`, and `lockBounty(qi, null)` greys out ALL four buttons permanently with no
  message. Distinguish "already paid" from "refused" (change `payBounty` to return a reason),
  toast the refusal, leave the buttons live.
- [ ] **1.6** `js/modules/admin.js:1009-1012` — quest give-up toast announces the configured
  penalty, not the trimmed deduction; make `failQuest` (store.js:2140) return the real delta
  and display that.

### Ledger/undo invariant violations
- [x] **1.7** `js/modules/houses.js:1018, 1261-1293` + `store.js:1958`: removing a past +N entry
  can push a house's total negative — the zero floor is only enforced on writes. In
  `removeTransaction` (or its confirm path), refuse or explicitly warn when the removal takes
  a total below 0.
- [x] **1.8** `js/core/store.js:1732-1747`: Time Turner deletes the attacker's loot credit even
  if it's been spent — total goes negative. Clamp the undo (insert a compensating entry rather
  than deleting, or floor at zero and say so).
- [x] **1.9** `js/core/store.js:1594-1609, 1722-1731`: Time Turner is offered (and consumed) for
  a strike that took nothing (`txIds: []`), and `lastStrike` persists across sessions so next
  week's class can undo last week. `canTimeTurn` should require `txIds.length || froze`;
  `endBattle` should clear `lastStrike`.

### Combat rules not actually enforced
- [ ] **1.10** `js/modules/battle.js:1674-1683` + `store.js:1529-1554`: the Admin "punching
  down" toggle (`duelPunchDown`) is consumed only by `store.canAttack`, which duel mode never
  calls. Pass `attackerId` into `housePickHtml` from `targetPickerHtmlDuel` and gate
  `previewDuelAttack` on `canAttack`.
- [ ] **1.11** `js/modules/battle.js:2885-2898`: "End Battle" mid-strike doesn't cancel the
  in-flight `resolveDuelSequence`; the strike still lands and the duel screen reappears.
  Guard `endBattle` on `resolving` (disable the button) or set a cancellation flag the
  sequence checks at each beat.
- [ ] **1.12** `js/modules/dice3d/sim.js:615, 764-786`: `dispose()` drops the pending `roll()`
  promise — navigating away mid-roll strands `resolveDuelSequence` forever (strike lost after
  the class watched the dice land). Make `dispose()` resolve pending rolls with `null`, and
  make callers treat `null` as "cancelled".
- [ ] **1.13** `js/modules/dice.js:544-638`: async `mount()` races unmount — a quick
  Dice→Home navigation leaks a WebGL context and a permanent store subscription, and throws on
  dead DOM. After each `await`, bail if the module has been unmounted (token/flag pattern).
- [x] **1.14** `js/core/store.js:1875-1881`: `applyAttack` returns intended damage, not the
  trimmed deduction — HP-mode steals mint points from nothing (battle.js:2685-2691 credits
  `result.applied`; a 100-pt steal on a 40-pt house credits 100). Return the real written
  delta (duel mode already caps loot this way, store.js:1601-1604).

### The ×100 economy mismatch (HP mode) — DEFERRED (owner, 2026-07-27: skip)
The owner does not currently use hit-points mode, so this family is deprioritized. Do NOT
spend time on it in the main fix pass; the items are recorded so the knowledge isn't lost.
If HP mode is ever brought back into use, do these first:
- [ ] **1.15 (deferred)** `js/core/store.js:349-356` vs `store.js:297-298`: the ×100 price
  rescale hit `effect.amount` (2000-3500) but not the HP pool (`hpBase: 100`) or the item
  descriptions ("takes 20 HP off") — every shipped weapon one-shots any house, and Admin's
  labels contradict each other (`admin.js:1219`, guide text at 1030-1074 quotes pre-rescale
  prices). Likely fix: divide `effect.amount` by 100 back to 20-35, keep prices, fix
  descriptions and the Admin guide together, add a `load()` migration for saved HP catalogs.
- [ ] **1.16 (deferred)** `js/modules/admin.js:2536`: "Bonus HP per 500 points held" — the
  step is 50,000 (`store.js:138`). Fix the label (store.js:1012 comment claims the label is
  right; it isn't).

### Input/editing traps in Admin
- [x] **1.17** `js/modules/admin.js:6091-6098`: battle-rule number fields persist on every
  `input` tick, so a cleared field saves the clamp floor (hpBase=1, gapShare=0). Commit on
  `change`/blur, or skip persisting while the field is empty.
- [x] **1.18** `js/modules/admin.js:1826-1848`: switching a duel item's kind files the old
  kind's counter checkboxes into the new kind's field; when the catalog has no attack items
  the corrupt list is saved. Read the *previous* kind for the sync, or resync from staged
  state instead of the DOM.
- [x] **1.19** `js/modules/admin.js:4020-4035`: the PDF-intent dialog's ✕ and backdrop both map
  to "store as resource" — cancelling still stores the files. Give ✕/backdrop a true cancel
  action that discards the staged files.

### Escaping (stored XSS class — teacher-only input, but fix properly)
- [ ] **1.20** Create `js/core/escape.js` with one shared `escapeHtml` + `escapeAttr` and
  replace the five private copies (`quests.js:56`, `council.js:306`, `dashboard.js:113`,
  `carousel.js:171`, `potw.js:72`, `shop.js:93`, `houses.js:367`, battle.js, admin.js `esc`).
- [ ] **1.21** `js/modules/dashboard.js:109, 158, 219, 251`: house `name`/`image` interpolated
  raw (the one module that missed it). Escape all four sites.
- [ ] **1.22** `js/modules/admin.js:656` + `js/modules/quests.js:613, 675, 739`: quest icon
  rendered unescaped (8-char cap limits but doesn't eliminate injection). Escape.
- [ ] **1.23** Validate `accent` (`/^#[0-9a-f]{6}$/i`) and escape `image` at save-time in
  `applyHouseOverrides` (`store.js:566-574`) so the ~30 render sites that interpolate them
  into `style="…"`/`src="…"` don't each need auditing (`houses.js:683` is currently the only
  site that validates). Also fix `shop.js:633-634`'s inline `onerror` string (an apostrophe
  in the emoji field terminates the JS string — replace the inline handler with an
  `addEventListener` after render), and reject `javascript:` schemes in POTW quick links
  (`potw.js:599-603, 918-921`).

### Paid-for outcomes lost to navigation
- [ ] **1.24** `js/modules/shop.js:1262, 1178-1226`: wildcard items charge immediately but apply
  the swing ~5s later via timeouts cleared on unmount — navigating away eats the outcome.
  Apply the swing to the store at confirm time (or persist a pending-swing record replayed on
  mount); let the animation be pure presentation.

---

## Phase 2 — Fit and finish (visible, lower stakes)

- [ ] **2.1** `js/modules/dashboard.js:379`: full innerHTML rebuild on every store change resets
  panel scroll. Adopt quests.js's targeted-update pattern (quests.js:832-841).
- [ ] **2.2** `js/modules/shop.js:1506, 912`: shop lacks the pressed-pointer render deferral
  houses.js built (houses.js:1329-1388) — taps get eaten by re-renders. Port it (or extract
  the deferral into core and use it in both).
- [ ] **2.3** `js/modules/shop.js:934-953`: toasts/banners are children of `rootEl` and die on
  re-render; houses.js mounts its toast host on `<body>` (houses.js:1102-1104). Port.
- [ ] **2.4** `js/modules/quests.js:872-896`: `--board-w` never updates on window resize; add a
  (debounced) resize listener calling `syncBoardWidth`.
- [ ] **2.5** `js/modules/council.js:443-448`: touch tap to unpause the ribbon is immediately
  re-paused by the synthetic `mouseenter`. Handle pointer events exclusively (ignore
  mouse events when `pointerType !== 'mouse'` was seen).
- [ ] **2.6 (superseded by 2.21 — do 2.21 instead).** `js/modules/admin.js:4180-4183, 4493`:
  Admin revokes the media.js-cached flyover object URL — opening and cancelling the editor
  silences the destination's flyover until reload. This bug lives in the per-destination
  flyover block that 2.21 removes entirely; fix it only if 2.21 is postponed (by marking the
  URL `ownUrl: false` like `hydratePresentation`, admin.js:4166).
- [ ] **2.21 (owner request, 2026-07-27): move flyover music out of the POTW editor into
  Admin → Background music.** Today the flyover track is chosen per destination inside the
  POTW editor (upload block + URL field, `flyoverBlockHTML` admin.js:4349-4371, staged via
  `stageFlyoverFile` 4497, stored as `potw:<key>:flyover` blobs / `profile.flyoverUrl`),
  with `CONFIG.POTW_FLYOVER_DEFAULT` (`music/travel-zoom.mp3`) as fallback
  (potw.js:707-730). The owner wants ALL background music in one place:
  - Add a "Flyover" slot to the 🎵 Background music card (admin.js:2994) alongside the
    per-screen ambient tracks, choosing from the bundled `/music` tracks like the others.
  - Remove the flyover upload/URL block from the POTW editor (and its staging/commit/delete
    paths: `flyoverBlockHTML`, `stageFlyoverFile`, `hydrateFlyover`, `commitFlyover`,
    `flyover-del`).
  - potw.js reads the new global setting; keep `POTW_FLYOVER_DEFAULT` as the default.
  - Migration: existing per-destination `flyoverUrl` values and `potw:<key>:flyover` blobs
    are retired — ignore them in code (leave blobs harmlessly in IndexedDB or sweep them).
  - This removes the surface that bug 2.6 lives in.
- [ ] **2.7** `js/modules/shop.js:40-42` + `js/core/media.js:37`: `mediaUrlCache` serves revoked
  URLs after art replacement. Invalidate on `media.put` (emit an event or expose a version).
- [ ] **2.8** `js/modules/battle.js:2318-2363`: Catapult's second victim's defense resolves
  publicly but stays "Hidden" — add the `combatRevealed` pairKey like the first target
  (battle.js:2204).
- [ ] **2.9** `js/core/store.js:1622-1634`: a second freeze shortens an existing longer freeze;
  take `max(current, new)`.
- [ ] **2.10** `js/core/store.js:1455-1473`: `setCombatMode` strands `frozen`/`shrouded`/
  `revealed`/`lastStrike` with no UI in HP mode; clear them (announcing it in the confirm) or
  surface them in HP mode.
- [ ] **2.11** `js/modules/battle.js:2694-2697, 2830-2832`: suppress the "+0 pts" victory
  fanfare (skip the prize line when prize is 0). Also decide whether HP-mode steal loot
  should count before `awardBattleWin` shrinks the gap prize (battle.js:2689-2697) — make it
  match the advertised prize.
- [ ] **2.12** `js/modules/dice.js:428-443`: a refused (frozen-house) award still burns the
  roll's single award in All-Cores mode — let the teacher redirect. (Code comment at 414-421
  already claims this is how it works; make the code match.)
- [ ] **2.13** `js/modules/battle.js:1989-1990` and `js/modules/admin.js:5125-5127`: silent
  failure paths (mini-shop purchase failure; "take item" that took nothing) — toast the
  failure.
- [ ] **2.14** `js/modules/admin.js:3909-3919`: the "⚠ Intro video file missing — re-upload it"
  badge instructs a retired flow; reword to "pick a new intro video in this destination's
  editor".
- [ ] **2.15** `js/modules/admin.js:4950`: planner event delete is the only unconfirmed delete
  in Admin; add the standard confirm.
- [ ] **2.16** Small Admin copy fixes: week-clash winner is first-added, not last
  (admin.js:4214 vs store.js:2190); `awardSentence` hardcodes "Camelot" (admin.js:2253);
  lock card promises prefilled PIN boxes that are empty after the first cycle
  (admin.js:3452 + 3440); blanked quest penalty saves 0 instead of the promised default
  (admin.js:925); cleared term-start silently keeps the old value with a success toast
  (admin.js:3227); stale `'rock'` fallback label on POTW cards (admin.js:3750, 3757 — use
  `CONFIG.POTW_DEFAULT_VIDEO_ID`).
- [ ] **2.17** `js/core/store.js:1987-1992`: guard `getTermInfo` against invalid `termStart`
  ("Week NaN of 9" in the top bar); fall back to "Set term dates in Admin".
- [ ] **2.18** `js/core/registry.js:35`: wrap `next.mount` in try/catch with a visible fallback
  ("This screen failed to load") so one bad module doesn't brick navigation.
- [ ] **2.19** `js/modules/potw.js:844-859`: guard `quickFacts`/`primarySources`/`quiz` maps
  (default `[]`) so a hand-edited/restored profile can't brick the Launch button; and reset
  `overlayEl` on template failure.
- [ ] **2.20** First-run PIN: `js/core/firstrun.js:220` pre-fills `DEFAULT_PIN='0314'` — anyone
  who has seen the repo knows it. Ship the field empty and require a choice.

---

## Phase 3 — Zombie code removal

Grep-verified dead. Delete unless marked "decide".

**Files/dirs**
- [ ] 3.1 `backups/dice-ui-v1/` — tracked snapshot, superseded; git history preserves it.
- [ ] 3.2 `gemini-site/` — local-only prototypes (gitignored); delete locally.
- [ ] 3.3 `images/atlantis.jpg`, `camelot.jpg`, `rivendell.jpg`, `valhalla.jpg` — 6.3 MB of
  retired tracked art (the .gitignore retirement only covered the .png twins). Delete;
  also delete the local retired `.png`s.
- [ ] 3.4 **DECIDED (owner, 2026-07-27): keep.** `js/integrations/classroom.js` stays as
  planned Google Classroom work. Fix its header comment (it falsely claims
  `initClassroomAuth()` runs at startup) but do not delete it.
- [ ] 3.5 **DECIDED (owner, 2026-07-27): trim.** Delete the 6 unused `potw-songs/*.mp3`
  (~8.9 MB). KEEP `potw-songs/place-of-the-week-rock-01.mp3` — it is `CONFIG.POTW_SONG`
  (config.js:16), the 37-second POTW theme, still played and separate from the two intro
  videos. Also delete the unwired `sfx/magic_chime.mp3` and `sfx/defensive_block-2.mp3`
  (nothing references them; git history preserves them).

**Dead code (all verified single-reference)**
- [ ] 3.6 admin.js: `AMBER` (83); retired intro-video-upload flow — `mediaBodyHTML`
  (3925-3935), `data-mkey` loop (3941-3946), `handleMediaFile` (4051-4057), `'media-remove'`
  case (5333-5337) and the change/drop tails (6071, 6175); `openHelpTopic` category branch
  (4866-4877); `data-action="shop-eff"` attributes (1512, 1624); stale `activeTab` comment
  (58).
- [ ] 3.7 battle.js: `[data-open-chooser]` wiring (1409-1410, 1737-1738); `UTILITY_ITEM_IDS`
  (1466); `.duel-items-more`/`.duel-empty-broke` CSS (458, 465); comma-operator statement
  (2129); stale "≤900ms" comment (2542).
- [ ] 3.8 dice/dice3d: unused roll history collection (dice.js:21-22, 328-329, 344-345, 654);
  unused `registry` (dice.js:9, 546); `DIE_SIDES` export (geometry.js:302). Keep
  `getFateStats`/`auditRolls` if wanted as console dev tools — mark them as such.
- [ ] 3.9 shop.js: `fmtRemainShort` (111-117), `stealFx` (1057-1061), `travelDot` (1041-1055)
  + `.shop-fx-travel-dot` CSS (550-559), `sizeTreasuryToHeadings` (587-595).
  **DECIDED (owner, 2026-07-27): delete** the ~180-line unreachable attack/steal/pierce
  live-resolution path (694-712, 780-791, 1336-1402, 1462-1472) — git history preserves it.
  Note: bug 1.14's fix in `store.applyAttack` still applies regardless (battle.js consumes
  the same return value). Coordinate with 1.1: the shop's duel-mode purchases stockpile into
  the armoury, so nothing in the new shop flow needs this path.
- [ ] 3.10 core/misc: `shell.js:446-449` `[data-help-btn]` branch; `CONFIG.HOME_CAMERA`
  (config.js:52); `backup.init()` (backup.js:226 — after 0.2 it's truly redundant);
  `firstrun.needsSetup` + aggregate export (firstrun.js:416-421, 472); help.js unused
  exports (`openSystemCheck`, `closeHelp`, `isHelpOpen`, `helpTopics`, `helpCategories`,
  `help` aggregate, 1773-1792); `registry.get` (registry.js:22); `ambientStatus`
  (ambient.js:138-150 — or wire it into System Check as its comment claims);
  `fmtDateLong` (dashboard.js:103-105); council.js `_raf` field (344) and the no-op
  `cancelAnimationFrame` (635); carousel.js `onFocus` option (95, 128);
  `potw.js:295-297` typeof-fallback.
- [ ] 3.11 theme.css dead rules: `.shell-icon-btn` block (175-191), `.shell-help-glyph`
  (193-199), `@keyframes float-up` (56-61), `@keyframes accent-sweep` (85-88).
- [ ] 3.12 config.js:44-49: commented `AMBIENT_TRACKS` examples reference files that don't
  exist — fix the comment to name a real file.

**Consolidation (with the escaper from 1.20)**
- [ ] 3.13 `js/core/util.js`: shared `esc`/`pad`/`ymd`/`todayStr`/`addDays`/`parseYMD`,
  reduced-motion helper, `later()`/timer-set lifecycle. Note the trap: store's `addDays`
  takes date-strings, admin's takes Dates — same name, different contract; unify carefully.
- [ ] 3.14 Deduplicate `houseImg()` (shop.js:98 / houses.js:373), the shop-image editor block
  (admin.js:1539-1549 vs 1702-1712), `wireHpDuel`/`wireMrDDuel` (~80% identical), and have
  shop.js import kind sets from store instead of `KNOWN_KINDS` (done as part of 1.1).
- [ ] 3.15 Batch the N-emits-per-save paths: `syncCounterReciprocals` (admin.js:1964-1990) and
  the shop-del sweep (5029-5038) — one emit per save. Debounce volume-slider persistence
  (admin.js:6080-6118) to `change`.
- [ ] 3.16 `media.js:71-80` `list()` N+1 → single readonly cursor; share the result across
  potw.js's three calls per voyage open.

---

## Phase 4 — Documentation truth pass

README.md and ARCHITECTURE.md are excellent but have drifted:
- [ ] 4.1 Delete the schema-staleness caveats (README.md:604-613, 690, 753;
  ARCHITECTURE.md:34-44) — `data/schema.json` was updated and now covers everything listed
  as missing. Fix schema.json's own stale claim that settings ship as null (they're seeded
  in `defaultState`, store.js:389-398).
- [ ] 4.2 Rewrite the quest-carousel sections (README.md:318-322, 675-677;
  ARCHITECTURE.md:557-568) — the carousel is now a shared, persisted, Admin-configured
  engine used by Quests and Shop.
- [ ] 4.3 README.md:65, 750 — Admin has seven tabs. README.md:427 — no 1d12 mode.
  README.md:116, 273, 521 — YouTube presets are retired, intros are local files.
  README.md:109 — shop seed prices are ×100 stale. README.md:18, 195, 581 — drop the
  "Safari 16+" backup claim (no `showDirectoryPicker`).
- [ ] 4.4 ARCHITECTURE.md:278-279 — audio.sfx plays assigned mp3s first, synth fallback;
  document the `battlecry`/`diceland` slots. Add `js/core/carousel.js`,
  `js/core/sampledata.js`, `tools/hero-tuner.js` to the file-layout block.
- [ ] 4.5 After Phase 0: document the corrupt-save quarantine, `-prev` restore undo, and the
  two-tab rule in README's Data & Persistence section.
- [ ] 4.6 `js/core/sampledata.js:178` — quest-points ×10 scaling is not idempotent (second
  sample load → ×100). Guard it (only scale quests still < 100), and note in Admin that
  loading sample data twice is safe.
- [ ] 4.7 Fix `main.js:25`: `encodeURIComponent` the teacher's `mapsApiKeyOverride`. Verify
  the committed Maps API key is referrer-restricted in Cloud Console (config.js:3) — if it
  isn't, restrict it; rotating it is the teacher's/owner's call, not code.

---

## Phase 5 — Educational polish (small, high-leverage)

- [ ] **5.1 Never blame the teacher in front of the class.** Audit every student-visible error
  string for "ask your teacher to fix" phrasing (shop.js's Misconfigured card is the worst
  offender — fixed structurally in 1.1). Class-facing copy should be in-world ("The armoury
  is closed — see Battle Day"), with the diagnostic detail reserved for Admin.
- [ ] **5.2 Ledger CSV export — ALREADY EXISTS** (verified live 2026-07-27: Records →
  ledger → "Search, sort & export" → "⬇ Export CSV"). Just verify it exports all columns
  (date, house, delta, reason, tag) and respects/clears filters sensibly. No build needed.
- [ ] **5.3 Weekly recap moment.** A "Last Week" card on the dashboard each Monday (biggest
  single award, most-improved house, quests completed) built from data `getWeeklySeries`
  already computes. Turns the ledger into a Monday-morning ritual instead of a background
  number.
- [ ] **5.4 Random-picker utility.** A themed "Wheel of Fate" that picks one of the four
  houses (for who answers first, who presents, tie-breaks). Fits the existing dice/fate
  aesthetic, ~a screen's worth of code, and replaces the most common physical teacher tool
  not yet in the app. (House-level only — the app deliberately has no student roster.)
- [ ] **5.5 Projector-safe quiet mode.** One toggle that mutes SFX + freezes ambient particles
  (reduced-motion already exists as an OS media query — surface it as an in-app switch for
  test days / quiet work).
- [ ] **5.6 Make the daily backup part of the classroom fiction.** The Friday download is a
  mechanical event; rename it in-world ("The scribe has archived this week's ledger") with a
  2-second toast. Costs nothing, makes the safety net visible so its absence is noticed.

---

## Owner decisions — ALL RESOLVED 2026-07-27

1. **classroom.js** — KEEP as planned Google Classroom work (3.4).
2. **Shop screen** — two shops, one per combat system; the active battle system determines
   which is shown; items purchasable at any time (1.1).
3. **HP-mode economy** — SKIP for now; owner doesn't use hit-points mode (1.15/1.16
   deferred).
4. **Dormant shop combat path** — DELETE (3.9).
5. **Spare audio** — trim: delete the 6 unused potw-songs and 2 spare sfx; keep the POTW
   theme song (3.5). NEW related request: relocate flyover music selection to
   Admin → Background music (2.21).
