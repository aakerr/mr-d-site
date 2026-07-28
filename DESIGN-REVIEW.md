# Design & Flow Review — Mr. D's Classroom OS

A product-design pass done by walking the running app screen-by-screen (fresh-install
wizard → dashboard → Records → Place of the Week voyage → Quests → Battle Day → Magic
Shop → Die of Destiny → Council of Four → Admin), 2026-07-27. Separate from FIX-PLAN.md,
which holds the bug work; nothing here is a bug fix, it's design opinion. Items marked
**(QW)** are quick wins.

---

## What is genuinely strong — protect these

- **The theatrical arc of every feature.** Classified destination → intro video → flyover
  → lesson; the Battle Day title card; the Council podium with medals and the decree
  ticker. The app consistently turns admin actions into classroom moments. This is its
  differentiator; any redesign that flattens the theatre is a regression.
- **The first-run wizard's honesty** ("Step 2 of 6 — the important one", "Next (I
  understand the risk)", the Google Drive folder tip, "It stops a student walking up and
  tapping. It is not…"). Rare, excellent copywriting. Same for Records' empty states
  ("The race starts when you award your first points").
- **One mental model: everything is a ledger entry.** Awards, purchases, battles, bounties
  all land in one place with undo. Keep this invariant absolute.
- **The top bar as the only chrome** — house switcher center, quick points, backup cloud,
  date/week. Students always know whose screen it is.

## Flow-level findings from the walkthrough

### 1. The dashboard's Daily Itinerary is fiction on a fresh install
`defaultState()` ships a hardcoded per-core itinerary and homework line ("Bell Ringer: Map
of the Fertile Crescent", "Map Quiz Mesopotamia — due Fri"). The class-facing board shows
this as if it were today's real plan, the planner calendar is empty, and nothing tells the
teacher where the text is coming from or how to change it. Suggest: keep the sample look
but stamp it as a sample ("Sample plan — build yours in Admin → Planner") until the planner
has at least one real event for that core. **(QW)**

### 2. The voyage's auto-hiding chrome strands the teacher (touch board!)
During Place of the Week, "🏠 Main Screen" / "✕ End Voyage" auto-hide like video-player
chrome. Verified live: they vanish within ~2s, and a click aimed where a button just was
lands on the map instead. On the actual smartboard there is no hover to bring them back —
whatever "reveal" gesture exists must be a tap, and a stray tap on the map can zoom/rotate
the globe. Suggest: keep auto-hide for immersion, but (a) any tap reveals chrome for 5s
WITHOUT passing the tap through to the map, and (b) Escape always exits the stage. **(QW)**

### 3. Map-failure state is a black hole
When the 3D map has no tiles yet (slow start, no internet, quota), the stage is a full
black screen with invisible controls layered on it. The classroom has spotty internet —
this WILL happen live. Suggest: a themed fallback backdrop (parchment map or the
destination's header art) behind the map canvas from t=0, so a tile failure degrades to
"pretty backdrop + lesson panel" instead of "projector looks broken". Verify the README's
claimed flat-image fallback actually fires on tile failure, not just on script failure.

### 4. Council of Four is the app's best ceremony and it's hidden
It is reachable ONLY by picking "All Cores" in the house switcher — there is no tile for it
in either dashboard mode, and nothing on the dashboard hints the podium exists. New-user
me missed it entirely on first pass. Suggest: give it a tile in All-Cores mode (or in both
modes), and consider making it the Monday-morning landing screen (see §8). **(QW)**

### 5. The wizard's return policy may fight the teacher
Design intent (firstrun.js): finishing marks setup done, but *skipping* re-offers the
wizard on later days (max 3), and only a connected backup folder counts as truly done.
Reasonable — but combined with finding §2 of FIX-PLAN (state can be clobbered/reset), the
teacher can meet the full 6-step wizard again unexpectedly. Suggest: when returning after
a skip, jump straight to the single unfinished step (the backup step) rather than the
6-step tour. Less to dismiss, same nag value.

### 6. Naming: "The Friday Magic Shop" vs the new any-time purchase decision
The shop hero says Friday; the owner has decided items are purchasable any time (FIX-PLAN
1.1). When that lands, sweep the copy: shop hero, dashboard tile subtitle ("Spend your
hoard"), Help. Decide whether Friday remains the *battle* ritual only, and let the copy
say exactly that.

### 7. All-Cores dashboard wastes its two best panels
In All-Cores mode the Itinerary and Homework panels are just "Pick a house core to see
today's schedule." That's the mode a teacher might leave on the board between classes.
Suggest: show the NEXT core's schedule ("Up next: Core 2 at 9:35") — the data is already
per-core and time-stamped. **(QW)**

## Structural / system-design suggestions

### 8. Give the week a shape: Monday ceremony, Friday battle
The app has a strong Friday (Battle Day, shop) and a strong any-day (POTW voyage, quests),
but Monday is empty ritual-space. The pieces already exist: Council podium + weekly series
in the store. A "Monday Convocation" mode — Council podium with a "last week" recap strip
(biggest single award, most-improved house, quests completed) — turns the ledger into a
weekly narrative arc: Monday looks back, Friday fights. (Extends FIX-PLAN 5.3.)

### 9. The "shipped content as saved state" pattern is the app's chronic disease
Three separate audit findings (shop descriptions, dice prophecy text, intro-video lists)
came from the same root: default content is copied into localStorage on first run, so
shipped fixes never reach existing installs without a bespoke revision-marker migration.
Each new content tweak risks the same trap. Long-term suggestion (big, but structural):
store only teacher *overrides* (diffs by id), and always merge over shipped defaults at
load. Every future wording fix then reaches every install for free, and the migration
machinery in load() shrinks dramatically. Worth doing before the content grows further.

### 10. One economy constant
The ×100 rescale left mismatched magnitudes in three places (HP amounts, guide copy,
README prices). Suggest a single `ECONOMY.SCALE` (or canonical "points per deed" doc
comment) in config, and derive shipped prices/amounts from base numbers × scale, so a
future rebalance is one line.

### 11. Consider retiring hit-points mode in v2
The owner has decided not to fix its broken economy (FIX-PLAN: deferred) and runs Mr. D's
rules. Every screen, catalog, migration and Help page currently carries both modes; the
duel/hp split is the single largest source of complexity and drift in the codebase. If a
term passes and HP mode is still unused, delete it deliberately rather than letting it rot
— half the shop/battle surface area disappears with it.

### 12. Small trust details for a class-facing board
- The bounty quiz needs a "nobody earned it" close for a question (currently the only exits
  are award someone or leave it open). **(QW)**
- A visible-but-subtle "saved ✓" pulse near the cloud icon after each ledger write would
  let the teacher glance-confirm persistence (backed by the real persist result, tying
  into FIX-PLAN 0.x work).
- A classroom countdown timer (bell-ringer minutes) on the dashboard would replace the
  other physical tool teachers reach for daily; it fits the itinerary panel. **(QW)**
- Quest completion could take an optional one-line "proof" note that lands in the ledger
  reason — cheap dispute insurance. **(QW)**

## Corrections to earlier assumptions
- **Ledger CSV export already exists** (Records → Search, sort & export → Export CSV).
  FIX-PLAN 5.2 downgraded to verification.
- The dice tray, quest board, Records chart and Council podium all render and behave well
  in a live walkthrough — no design concerns beyond what FIX-PLAN already covers.
