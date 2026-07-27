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
  // The LOCAL files are listed first and one of them is the default, on
  // purpose. A school computer may have no internet, and a YouTube embed also
  // flashes its own pause glyph on launch — a plain <video> does neither.
  // The YouTube entries stay as a fallback for a machine without the files.
  POTW_INTRO_VIDEOS: [
    { id: 'intro-01', label: 'Intro 1 (on this computer)', url: 'videos/potw-intro-01.mp4' },
    { id: 'intro-02', label: 'Intro 2 (on this computer)', url: 'videos/potw-intro-02.mp4' },
    { id: 'rock',     label: 'Rock (YouTube)',             url: 'https://www.youtube.com/embed/hdM9z3pdJBQ' },
    { id: 'classic',  label: 'Classic (YouTube)',          url: 'https://www.youtube.com/embed/3LU6vgJJNZE' },
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
    // dashboard: 'music/morning.mp3',
    // council:   'music/council.mp3',
    // quests:    'music/quests.mp3',
    // shop:      'music/shop.mp3',
    // houses:    'music/records.mp3',
    // dice:      'music/dice.mp3',
  },

  HOME_CAMERA: { lat: 40.8653, lng: -81.8604, altitude: 500 }, // Smithville, OH

  STORAGE_KEY: 'mrd-classroom-os-v1',
};
