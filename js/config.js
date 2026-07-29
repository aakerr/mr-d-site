// Central configuration — Mr. D's Classroom OS
export const CONFIG = {
  MAPS_API_KEY: 'AIzaSyD1zpgi8QfRMFUkhDmvMz3iBoFCuM_OxUo',

  // 9-week term timeline (Monday start). Adjust each term.
  TERM: {
    name: '9-Week Term',
    startDate: '2026-06-29',
    totalWeeks: 9,
  },

  // Place of the Week — active profile key into state.potw.profiles
  POTW_ACTIVE: 'mesopotamia',
  // Last-resort fallback only (used when a profile names no video at all).
  POTW_VIDEO: 'videos/classic.mp4',
  POTW_SONG: 'potw-songs/place-of-the-week-rock-01.mp3',
  POTW_SONG_DURATION_S: 37,

  // Intro videos the teacher picks from (dropdown in Admin → Place of the Week).
  // Add more here and they appear in the dropdown automatically.
  //
  // LOCAL FILES ONLY. The YouTube presets that used to live here are gone on
  // purpose: they need internet the classroom may not have, and an embed flashes
  // its own pause glyph on launch, which was a long-standing complaint. Every
  // entry here should be a file that ships in /videos.
  // A teacher can still paste a YouTube link against an individual destination
  // in Admin — that is a per-destination choice, not the shipped default.
  POTW_INTRO_VIDEOS: [
    // Named what they ARE (owner call): Mr. D picks "Classic" or "Rock", not
    // "Intro 1". The ids stay intro-01/intro-02 — saved profiles point at ids,
    // so renaming the files and labels costs nothing.
    { id: 'intro-01', label: 'Classic', url: 'videos/classic.mp4' },
    { id: 'intro-02', label: 'Rock', url: 'videos/rock.mp4' },
  ],
  POTW_DEFAULT_VIDEO_ID: 'intro-01',

  // Music under the Google Earth flight. Any destination without its own
  // track falls back to this, so a newly added place has music immediately.
  // Timing: starts on the "Fly to" tap, fades over 3s once the presentation
  // opens (~27.3s in), silent by ~30.4s. This file runs 32s.
  POTW_FLYOVER_DEFAULT: 'music/travel-zoom.mp3',

  // Quiet looping music per screen — WHAT A FRESH INSTALL SOUNDS LIKE. This
  // map is live (store ships ambient tracks:null, which means "use this"), so
  // Mr. D hears the same assignment Anthony approved without touching Admin.
  // Editing any track in Admin → Look & Sound copies the whole map into the
  // save and takes over from here. Each volume is a multiplier of the master
  // ambient volume (0.6 shipped). The voyage overlay inside Place of the Week
  // makes its own noise — potw here is its LANDING screen only.
  AMBIENT_TRACKS: {
    dashboard: { src: 'music/the-grand-pavilion.mp3', volume: 0.5 },
    council:   { src: 'music/the-grand-pavilion.mp3', volume: 0.5 },
    houses:    { src: 'music/honor-roll.mp3',         volume: 0.5 },
    quests:    { src: 'music/the-long-road-ahead.mp3', volume: 0.5 },
    shop:      { src: 'music/bridging-the-path.mp3',  volume: 0.5 },
    battle:    { src: 'music/storming-the-gates.mp3', volume: 0.5 },
    dice:      { src: 'music/looming-roll.mp3',       volume: 0.5 },
    wheel:     { src: 'music/breath-of-fate.mp3',     volume: 0.5 },
    potw:      { src: 'music/bridging-the-path.mp3',  volume: 0.5 },
    trivia:    { src: 'music/ancient-sands.mp3',      volume: 0.5 },
  },

  // ---- the economy's one scale ---------------------------------------------
  // THE CANON: 1 old point = 100 shipped points. A routine good deed is worth
  // roughly 500-1,000; a Magic Shop item costs roughly 3,000-6,000. Everything
  // a house earns or spends is quoted at that scale.
  //
  // It exists because the rescale to meet Mr. D's prices was done by hand, item
  // by item, and it did not reach everything: the hit-points weapons had their
  // damage multiplied but not the HP pool they were removing it from, so every
  // shipped weapon one-shot every house (FIX-PLAN 1.15). One number here, and
  // the shipped values in store.js written as `base × SCALE`, means the next
  // rebalance is this line rather than forty scattered ones — and a new item
  // cannot quietly land on the wrong scale, because there is only one to land on.
  //
  // 2026-07-28: the stragglers were rescaled ×10 on the owner's call ("add a
  // 0 to all the default scoring — Mr. D likes big point totals"): the one-tap
  // award presets (Bell Ringer +50, Map Quiz +500 — defaultAwardPresets()),
  // the Die of Destiny outcomes (-100 to +200 — defaultDiceProphecy()), the
  // Wheel of Fate awards (50/100 — wheel.js), the top-bar quick chips
  // (±50/±100 — shell.js) and Battle Day's ± step (100 — defaultCombat()).
  // A save from before the rescale is lifted by the scoreScale10x migration
  // in load() — values equal to the old defaults only; teacher edits stay.
  // Mr. D's own duel prices (4.5-10 × SCALE) sit below the 3,000-6,000 canon
  // on purpose — they are his numbers, from his document.
  //
  // Changing SCALE also means rewording every shipped description that quotes
  // the multiplier out loud ("2d6 × 100 points"), which is why those live next
  // to the values they describe.
  ECONOMY: { SCALE: 100 },

  STORAGE_KEY: 'mrd-classroom-os-v1',
};
