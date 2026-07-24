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
  POTW_VIDEO: 'potw-intro.mp4',
  POTW_SONG: 'potw-songs/place-of-the-week-rock-01.mp3',
  POTW_SONG_DURATION_S: 37,

  HOME_CAMERA: { lat: 40.8653, lng: -81.8604, altitude: 500 }, // Smithville, OH

  STORAGE_KEY: 'mrd-classroom-os-v1',
};
