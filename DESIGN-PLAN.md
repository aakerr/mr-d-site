# Design Plan — Mr. D's Classroom OS

Actionable plan derived from DESIGN-REVIEW.md (the live walkthrough of 2026-07-27).
Continues FIX-PLAN.md's numbering: phases 6-8. Line numbers refer to commit `5418da5`;
if FIX-PLAN work has landed since, re-locate by the quoted symbols, not the numbers.

**Sequencing:** do NOT start this plan until FIX-PLAN phases 0-2 are merged — both plans
edit potw.js, dashboard.js, shop.js and council.js, and FIX-PLAN's correctness work goes
first. Within this plan, work the phases in order; items inside a phase are independent
unless a dependency is called out. One item = one commit.

---

## Phase 6 — Classroom-flow fixes (small, high-visibility)

- [x] **6.1 Stamp the fallback itinerary/homework as a sample.**
  `store.getItinerary()` (js/core/store.js:2097) prefers a planner event of type
  `itinerary` for today and silently falls back to the hardcoded sample in
  `state.itineraries` (store.js:490-504); `getHomework` (store.js:2104) does the same.
  On a fresh install the class-facing board presents fiction ("Bell Ringer: Map of the
  Fertile Crescent") as today's real plan. Change the two getters to return
  `{ items, sample: true|false }` (sample = fallback used), and in
  `renderItinerary`/`renderHomework` (js/modules/dashboard.js:265, 290) render a small
  muted caption under the section header when `sample` is true: "Sample plan — build
  yours in Admin → Planner." Update the other callers of the two getters (grep; keep the
  return-shape change contained or add new `getItineraryInfo` wrappers if callers are
  many).

- [x] **6.2 Voyage chrome: first tap reveals, never passes through; Escape always exits.**
  The POTW stage chrome (header + presentation bar, class `potw-chrome`) idle-fades
  (js/modules/potw.js:1265 "chrome idle fade", `PRES_IDLE_MS` potw.js:60) and on the
  touch smartboard there is no hover to bring it back — verified live: a tap aimed at
  "✕ End Voyage" after fade lands on the map and zooms it. Fix:
  - While chrome is faded, the first pointerdown anywhere on the stage reveals chrome
    and is CONSUMED (preventDefault/stopPropagation — it must not reach the map or
    Google's player); subsequent taps behave normally until the next fade.
  - A document-level Escape handler during any voyage stage returns to the POTW landing
    (same path as "🏠 Main Screen"), regardless of chrome visibility.
  - Keep the idle fade itself — the immersion is right; only the recovery is wrong.

- [x] **6.3 Map-failure backdrop for the voyage stage.**
  When 3D tiles are absent (slow start, offline, quota), the stage is a black screen
  with invisible controls — verified live. Render a themed fallback UNDER the map canvas
  from t=0: the destination's header image if the profile has one, else the starfield
  the POTW landing already uses (potw.js:1643-1650), so tile failure degrades to
  "backdrop + lesson panel", never black. Also verify the README's claimed flat-image
  fallback (README.md:620) actually fires when the maps3d element loads but tiles never
  arrive — if it only guards script-load failure, extend it (listen for the element's
  error/timeout, or a 10s no-render watchdog that swaps in the backdrop permanently and
  stops waiting).

- [x] **6.4 REVISED (owner spec, 2026-07-27): the Records tile becomes the drill-down
  door to the standings.** No new tile. The flow:
  1. The Records dashboard tile keeps the gold trophy art (images/icon-points.png —
     already wired) — but tapping it navigates to the **Council of Four podium** (the
     "all cores" standings page the house switcher reaches), NOT the Records module.
     Implementation: dashboard tile click for module id 'houses' routes to
     registry.navigate('council') — special-cased in dashboard.js's tile handler, with
     a comment naming this owner decision.
  2. On the Council podium, tapping a house's NAME, SHIELD, or COLUMN/BAR navigates to
     the Records module with that house's tab pre-selected. Records' house filter is
     internal state in houses.js — add a small nav-intent handoff (e.g.
     store-less module hook `houses.focusHouse(id)` consumed on next mount, or a
     sessionStorage `mrd-records-focus` key houses.js reads-and-clears on mount; pick
     whichever fits the module contract cleanly).
  3. Records remains fully reachable: podium → house tap lands in it, and its internal
     tabs (All Houses + per-house) still work as today.
  Council needs pointer affordances (cursor, hover/active states on the columns) so the
  class can see the columns are tappable. Keep the podium's ceremony intact — the tap
  targets are additive.

- [x] **6.5 All-Cores dashboard: show the next core's schedule instead of a shrug.**
  `renderItinerary` (dashboard.js:266-273) and `renderHomework` (dashboard.js:296) print
  "Pick a house core to see today's schedule/assignments" in All-Cores mode — the mode a
  teacher leaves on the board between classes. Instead: find the next core by clock —
  each itinerary item has a `time` field (store.js:491); pick the core whose first item
  is soonest at/after now (wrap to core 1 after the last) — and render its itinerary
  under a header "Up next: Core 2 · 9:35" plus that core's homework. Fall back to the
  current shrug only if no itinerary has any timed items. Times are stored as bare
  strings ("9:35") — parse as school-day local times (AM until 11:59, then PM — or
  better: compare sequence order only, no real clock math beyond "which block is next").
  Keep it read-only; tapping the panel switches to that core (calls the same path as the
  switcher).

- [x] **6.6 Wizard return visits: one step, not six.**
  firstrun.js re-offers a skipped wizard on a later day, resuming at
  `setupResumeStep` (js/core/firstrun.js:459-461). Since the only thing that blocks
  "done" is the backup folder (needsSetup, firstrun.js:417-421), a returning visit
  should jump STRAIGHT to the backup step with a one-line "Just this one thing left"
  framing, and its Next button becomes "Done". Keep the full 6-step tour only for the
  true first run and for Help → "Run the setup wizard again" (`startSetup`,
  firstrun.js:412).

- [x] **6.7 Bounty questions need a "nobody earned it" close.**
  In the POTW House Bounty Quiz (potw.js:858-880, handler at 1029-1068), the only exits
  from a question are awarding a house or leaving all four buttons live forever. Add a
  small "No winner" control beside the reveal button that marks the question closed
  (same disabled visual as awarded, note "— no winner", no ledger write). Persist it in
  `state.potwBounties[key]` alongside paid entries (extend the record shape; a closed
  entry has `houseId: null`) so it survives reload, and teach `lockBounty`
  (potw.js:1077) to render it. Coordinate with FIX-PLAN 1.5, which is already changing
  `payBounty`'s return contract and the lock flow — do 1.5 first.

- [x] **6.8 Copy sweep after the shop becomes any-time (depends on FIX-PLAN 1.1).**
  Once purchases work outside Friday, fix the copy that says otherwise: the shop hero
  "THE FRIDAY MAGIC SHOP" (js/modules/shop.js — hero template), the dashboard tile
  subtitle "Spend your hoard" is fine but Battle Day's "Team competitions" area and Help
  entries that describe the Friday-only shop are not; grep README.md + js/core/help.js
  for "Friday" and reword. Decision embedded: Friday remains the BATTLE ritual; the shop
  is open all week — copy should say exactly that ("Stock up all week. Settle it on
  Friday.").

## Phase 7 — Weekly rhythm & classroom trust

- [x] **7.1 Monday Convocation: a "last week" recap strip on the Council podium.**
  Extends FIX-PLAN 5.3 (build them together, in council.js). Above/below the podium
  (council.js render), when the current day is Monday — or whenever a `?recap` affordance
  is tapped — show one strip with: biggest single award last week (scan
  `state.transactions` in last week's Mon-Sun window; ledger memoisation pattern at
  store.js:929 applies), most-improved house (largest week-over-week delta from
  `getWeeklySeries`), and quests completed count (`state.quests.completed` timestamps).
  Add a store helper `getLastWeekRecap()` next to the existing weekly-series code so
  council.js stays presentation-only. The strip uses the existing decree-ticker styling
  so it feels native. No new screen, no new nav — the podium IS the Monday ritual.

- [x] **7.2 "Saved ✓" pulse on the backup cloud after each ledger write.**
  The topbar backup button (shell.js:361, health logic at backup.health) shows nothing
  when healthy. Add a subtle one-shot pulse (a small ✓ that fades over ~1.5s) on the
  cloud button whenever a transaction lands AND the persist + (if connected) folder
  write actually succeeded — tie into the real persist result from FIX-PLAN 0.x, not
  just the store event. Throttle: max one pulse per 5s so a burst of awards doesn't
  strobe. Skip entirely when backup health is 'attention'/'none' (the existing urgent
  state must stay the dominant signal).

- [ ] **7.3 Bell-ringer countdown timer on the dashboard.**
  A small timer chip in the Daily Itinerary panel header (dashboard.js:269): tap opens a
  preset picker (2/5/10 min + custom), counts down large enough to read from desks,
  plays the existing `points_awarded` sfx (or a new gentle chime slot) at zero, and
  auto-clears. Ephemeral — no store writes except nothing; module-local state only, and
  it must survive the dashboard's re-render-on-store-change (keep the deadline in module
  scope like quests.js keeps its timers, re-paint remaining time on render; one 1s
  interval while running, cleared on unmount). This replaces the most common physical
  teacher tool not yet in the app.

- [x] **7.4 Optional one-line "proof" note when completing a quest.**
  In the quest-completion confirm (quests.js completion flow / admin.js quest
  controls — wherever `store.completeQuest` is invoked), add an optional text input
  ("How was it proven? — optional"), appended to the ledger reason:
  "Quest: Tutor Titans — proof: sign-off sheet from Ms. R". Zero new state shape; the
  ledger reason is already free text and Records search (verified live) makes it
  findable later. Cap ~80 chars, escape on render (FIX-PLAN 1.20's shared escaper).

## Phase 8 — Structural (bigger, do deliberately)

- [ ] **8.1 Shipped content becomes code; saved state holds only teacher overrides.**
  The chronic disease behind three audit bugs (shop descriptions, dice prophecy text,
  intro-video list — each needed a bespoke revision-marker migration in store.js load()):
  default content is COPIED into localStorage on first run, so shipped fixes never reach
  existing installs. Refactor, one content family at a time (each its own commit, each
  independently shippable):
  1. `settings.diceProphecy` — store per-id teacher diffs only ({points, title, desc,
     emoji} where changed); merge over `defaultDiceProphecy()` in the getter. Delete the
     `DICE_DESC_REV`/`OLD_DICE_DESCS` machinery (store.js:654-691).
  2. `settings.introVideos` — store only teacher-added entries + hidden-id list; merge
     over `CONFIG.POTW_INTRO_VIDEOS` in the getter. Delete the retire/backfill block
     (store.js:826-838).
  3. Shop catalogs — the largest: shipped items by id live in code
     (defaultDuelCatalog/defaultHpCatalog); state stores per-id diffs, teacher-created
     items whole, and a deleted-ids list per mode. `seeded` arrays and `SHOP_DESC_REV`/
     `OLD_SHOP_DESCS` (store.js:763-793) all disappear.
  4. Quest catalog — same pattern; removes the per-field backfill at store.js:700-717.
  Each step: write the migration from the current saved shape ONCE (old full-copy →
  diff), keep `load()`'s output shape identical to what modules consume today (getters
  do the merge), and verify with a backup file from before the change. After this,
  a wording fix in code reaches every install with no migration ever again.

- [ ] **8.2 One economy scale constant.**
  Add `ECONOMY = { SCALE: 100 }` (js/config.js) with a comment defining the canon:
  "1 old point = 100 shipped points; a routine good deed ≈ 500-1,000; shop items ≈
  3,000-6,000." Derive shipped catalog prices and award presets (store.js:22, catalogs)
  as `base × ECONOMY.SCALE` so a future rebalance is one line, and the HP-mode mismatch
  class (FIX-PLAN 1.15, deferred) can't recur in new content. Pure refactor — shipped
  values must come out numerically identical (assert in a quick script before/after).

- [ ] **8.3 Decision gate: retire hit-points mode at end of term.**
  Not code yet — a calendar decision. FIX-PLAN already defers all HP-economy fixes as
  unused. If the term ends (settings say week 9 of 9 ≈ 2026-08-24) with combat mode
  still 'duel', remove HP mode wholesale in a dedicated pass: `COMBAT_MODES.hp`, the
  parked-catalog machinery (store.js:721-762), `resolveHpAttack`/`wireHpDuel`
  (battle.js), the HP shop modal (admin.js:1539+), Help's alternate-rules section, and
  the `state.hp` tree (with a load() migration that drops it). Roughly half the
  shop/battle surface area and its drift risk disappears. If HP mode IS in use by then,
  un-defer FIX-PLAN 1.15/1.16 instead. Either way the fork closes.

---

## Phase 9 — Admin area redesign (from the live Admin walkthrough, 2026-07-27)

The Admin panel's tab structure, embedded per-tab guides, and explanatory copy are genuinely
good — keep all of it. The problems are concentration and placement, not style.

- [ ] **9.1 Split the Settings junk drawer.** Settings is one scroll of 13 cards spanning
  three unrelated domains (verified live: Term Timeline, Houses, Screen colours, Screen
  layout, Quick award buttons, Prophecy Table, Term markers, Display & Theme, Background
  music, Sound effects, Backup & Restore, Sample Data, Teacher PIN + danger zone).
  Restructure into three tabs:
  - **⚙️ Term & World** — Term Timeline, Term markers, Houses, Quick award buttons.
  - **🎨 Look & Sound** — Screen colours, Screen layout, Display & Theme, Background music
    (including the Flyover slot from item 2.21), Sound effects.
  - **🛡️ Data & Safety** — Backup & Restore, Sample Data, Teacher PIN, Danger Zone.
  The Prophecy Table card is Die of Destiny content in Settings clothing — move it to a
  small "🎲 Dice" section wherever it fits best (Term & World is acceptable; its own tab is
  not worth it). Tab bar grows to 9 entries — verify it fits at board resolution; if tight,
  Help can become a corner icon next to the tab bar instead of a tab.
- [ ] **9.2 Backup health strip at the top of Admin.** The backup card is buried 11th of 13
  while being the single most important thing in Admin. Render a one-line strip under the
  Admin header on EVERY tab, fed by `backup.health()`: green "☁️ Saving to '<folder>' after
  every change", amber/rose for attention/none, tappable → jumps to Data & Safety. (The
  shell's cloud icon does this for the board; Admin deserves the persistent version.)
- [ ] **9.3 Day Planner drawer: backdrop must not eat clicks silently.** Verified live: with
  the drawer open, clicks on visible controls (the tab bar) are swallowed by an invisible
  backdrop. Dim the backdrop visibly and make clicking it CLOSE the drawer — the standard
  slide-over contract. Escape should close it too.
- [ ] **9.4 POTW tab: destinations first.** The global "Intro Video Presets" card sits above
  the destination list, burying the primary object below secondary config. Swap the order
  (destinations first, presets collapsed at the bottom). Pairs naturally with 2.21 (flyover
  slot leaves the destination editor).
- [ ] **9.5 Compact the Admin header on scroll.** Title + subtitle + tab bar consume ~40% of
  a 720p board before content starts. Make the header collapse to a slim sticky bar (tabs
  only) once `.admin-body` scrolls. Pure CSS/small-JS polish; low priority.

## Decisions embedded in this plan (flag if you disagree)

- **6.4** Council tile appears in both modes if layout fits, else All-Cores only.
- **6.8** Friday stays the battle ritual; shop copy says "open all week".
- **7.1** The recap lives on the Council podium (no new screen), shown on Mondays and
  on demand.
- **8.3** HP mode's fate is decided at end of term, not now.
