// ambient.js — quiet looping music per screen.
//
// One audio element at a time, crossfaded when the teacher moves between
// screens, so the room never hears a hard cut. Deliberately conservative:
//   • obeys the master sound switch AND its own on/off + volume settings
//   • screens that make their own noise (Place of the Week's video/flyover,
//     Battle Day's voice line) opt out by having no track assigned
//   • a missing or unplayable file is silent, never an error
//
// Tracks live in /music and are assigned per screen in Admin → Settings.
import { store } from './store.js';
import { CONFIG } from '../config.js';

const FADE_MS = 900;      // crossfade between screens
const STEP_MS = 60;       // fade tick

let current = null;       // { el, moduleId }
let fadeTimer = null;

function settings() {
  const s = store.getSettings?.() || {};
  const a = s.ambient || {};
  return {
    enabled: a.enabled !== false,
    volume: Number.isFinite(Number(a.volume)) ? Math.min(1, Math.max(0, Number(a.volume))) : 0.25,
    tracks: a.tracks && typeof a.tracks === 'object' ? a.tracks : (CONFIG.AMBIENT_TRACKS || {}),
    soundOn: s.soundEnabled !== false,
  };
}

function targetVolume() {
  const { enabled, volume, soundOn } = settings();
  return (enabled && soundOn) ? volume : 0;
}

function ramp(el, to, done) {
  clearInterval(fadeTimer);
  const from = el.volume;
  const steps = Math.max(1, Math.round(FADE_MS / STEP_MS));
  let i = 0;
  fadeTimer = setInterval(() => {
    i += 1;
    const v = from + (to - from) * (i / steps);
    try { el.volume = Math.min(1, Math.max(0, v)); } catch (e) { /* detached */ }
    if (i >= steps) { clearInterval(fadeTimer); fadeTimer = null; done && done(); }
  }, STEP_MS);
}

function stopCurrent(fade = true) {
  if (!current) return;
  const { el } = current;
  current = null;
  const kill = () => { try { el.pause(); el.src = ''; } catch (e) {} };
  if (!fade) { kill(); return; }
  ramp(el, 0, kill);
}

// Play the track assigned to `moduleId`, or fade out if that screen has none.
export function ambientFor(moduleId) {
  try {
    const { tracks } = settings();
    const src = tracks[moduleId];
    if (!src) { stopCurrent(true); return; }
    if (current && current.moduleId === moduleId) { ramp(current.el, targetVolume()); return; }

    stopCurrent(true);
    const el = new Audio(src);
    el.loop = true;
    el.volume = 0;
    el.addEventListener('error', () => { if (current && current.el === el) current = null; });
    const p = el.play();
    if (p && typeof p.catch === 'function') {
      // Autoplay can be blocked until the teacher first interacts — harmless,
      // the next navigation retries.
      p.catch(() => { if (current && current.el === el) current = null; });
    }
    current = { el, moduleId };
    ramp(el, targetVolume());
  } catch (e) { /* ambience is never worth an error */ }
}

// Re-apply volume when the teacher changes the sound or ambient settings.
export function refreshAmbient() {
  if (current) ramp(current.el, targetVolume());
}

export function stopAmbient() { stopCurrent(false); }

// What's playing right now — for diagnostics (Help → System check) and tests.
export function ambientStatus() {
  const { enabled, volume, soundOn, tracks } = settings();
  return {
    enabled, soundOn, configuredVolume: volume,
    assignedScreens: Object.keys(tracks),
    playing: current ? {
      screen: current.moduleId,
      src: current.el.currentSrc || current.el.src,
      volume: +current.el.volume.toFixed(3),
      paused: current.el.paused,
    } : null,
  };
}

// Self-wire: follow screen changes and setting changes.
export function initAmbient() {
  window.addEventListener('module:navigate', (e) => ambientFor(e.detail?.id));
  store.subscribe(refreshAmbient);
}
