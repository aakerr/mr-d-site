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
  POTW_VIDEO: 'videos/potw-intro-01.mp4',
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
    { id: 'intro-01', label: 'Intro 1', url: 'videos/potw-intro-01.mp4' },
    { id: 'intro-02', label: 'Intro 2', url: 'videos/potw-intro-02.mp4' },
  ],
  POTW_DEFAULT_VIDEO_ID: 'intro-01',

  // Music under the Google Earth flight. Any destination without its own
  // track falls back to this, so a newly added place has music immediately.
  // Timing: starts on the "Fly to" tap, fades over 3s once the presentation
  // opens (~27.3s in), silent by ~30.4s. This file runs 32s.
  POTW_FLYOVER_DEFAULT: 'music/travel-zoom.mp3',

  // Quiet looping music per screen. Drop files in /music and map them here (or
  // per-screen in Admin → Settings). Screens that make their own noise — Place
  // of the Week, Battle Day — are intentionally left out.
  AMBIENT_TRACKS: {
    // dashboard: 'music/honor-roll.mp3',
    // council:   'music/the-grand-pavilion.mp3',
    // quests:    'music/bridging-the-path.mp3',
    // shop:      'music/vanguard-charge.mp3',
    // houses:    'music/breath-of-fate.mp3',
    // dice:      'music/looming-roll.mp3',
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
  // STILL AT THE OLD SCALE, and each is a decision rather than a refactor —
  // they change what the app pays out, so they are listed here to be chosen
  // deliberately, not fixed in passing:
  //   • the one-tap award presets (Bell Ringer +5, Map Quiz +50) — store.js
  //     defaultAwardPresets()
  //   • quest rewards (10-50) — defaultQuestCatalog()
  //   • the Die of Destiny's outcomes (-10 to +20) — defaultDiceProphecy()
  //   • Battle Day's ± step (10) and the flat prize (150) — defaultCombat()
  // Against a 450-point sword, a 5-point Bell Ringer is ninety good deeds a
  // sale. Mr. D's own duel prices (4.5-10 × SCALE) sit below the 3,000-6,000
  // canon too, on purpose — they are his numbers, from his document.
  //
  // Changing SCALE also means rewording every shipped description that quotes
  // the multiplier out loud ("2d6 × 100 points"), which is why those live next
  // to the values they describe.
  ECONOMY: { SCALE: 100 },

  STORAGE_KEY: 'mrd-classroom-os-v1',
};
