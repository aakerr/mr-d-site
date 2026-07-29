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

// A screen's entry is either 'music/x.mp3' or { src, volume } — the second form
// lets a shop sit quieter than a council hall. Per-screen volume is a MULTIPLIER
// of the master volume, so the master slider still governs everything.
function entryFor(moduleId) {
  const { tracks } = settings();
  const raw = tracks[moduleId];
  if (!raw) return null;
  if (typeof raw === 'string') return { src: raw, gain: 1 };
  if (raw.muted) return null;   // per-screen mute: assigned but silenced
  const gain = Number.isFinite(Number(raw.volume)) ? Math.min(1, Math.max(0, Number(raw.volume))) : 1;
  return raw.src ? { src: raw.src, gain } : null;
}

function targetVolume(moduleId = current?.moduleId) {
  const { enabled, volume, soundOn } = settings();
  if (!enabled || !soundOn) return 0;
  const e = moduleId ? entryFor(moduleId) : null;
  // Master × per-screen, then SQUARED: Audio.volume is linear amplitude but
  // loudness is logarithmic, so the honest product (25% × 50% = 0.125) still
  // sounded close to half volume and the sliders felt broken (owner-reported).
  // Squaring maps slider percentages to perceived loudness.
  const linear = volume * (e ? e.gain : 1);
  return linear * linear;
}

// Each element owns its fade timer. A single shared timer meant that starting
// the incoming track's ramp cleared the OUTGOING track's fade-out, so its
// kill() never ran and it kept playing at full volume — every screen change
// stacked another track on top of the last.
function ramp(el, to, done) {
  if (el.__ambRamp) clearInterval(el.__ambRamp);
  const from = el.volume;
  const steps = Math.max(1, Math.round(FADE_MS / STEP_MS));
  let i = 0;
  el.__ambRamp = setInterval(() => {
    i += 1;
    const v = from + (to - from) * (i / steps);
    try { el.volume = Math.min(1, Math.max(0, v)); } catch (e) { /* detached */ }
    if (i >= steps) {
      clearInterval(el.__ambRamp);
      el.__ambRamp = null;
      done && done();
    }
  }, STEP_MS);
}

// Everything that has been asked to stop but may still be fading. Tracked so a
// hard stop (mute, presentation opening, teardown) can silence them too.
const retiring = new Set();

function killAudio(el) {
  if (!el) return;
  if (el.__ambRamp) { clearInterval(el.__ambRamp); el.__ambRamp = null; }
  if (el.__ambKill) { clearTimeout(el.__ambKill); el.__ambKill = null; }
  try { el.pause(); el.src = ''; el.load(); } catch (e) { /* already gone */ }
  retiring.delete(el);
}

function stopCurrent(fade = true) {
  if (!current) return;
  const { el } = current;
  current = null;
  if (!fade) { killAudio(el); return; }
  retiring.add(el);
  ramp(el, 0, () => killAudio(el));
  // Belt and braces: if that fade is ever interrupted, this still silences it.
  // A track that outlives its screen is the worst failure mode here.
  el.__ambKill = setTimeout(() => killAudio(el), FADE_MS + 400);
}

// Play the track assigned to `moduleId`, or fade out if that screen has none.
export function ambientFor(moduleId) {
  try {
    // A Place of the Week voyage makes its own noise (intro video, flight
    // music, presentation). While its overlay is up, no background loop may
    // start — whatever asked for one is a stray (owner-reported: music
    // starting unbidden at the map reveal on a first load).
    if (document.querySelector('#overlay-root .potw-map-layer, #overlay-root .potw-intro-layer')) return;
    const entry = entryFor(moduleId);
    if (!entry) { stopCurrent(true); return; }
    if (current && current.moduleId === moduleId && current.src === entry.src) {
      ramp(current.el, targetVolume(moduleId)); return;
    }

    stopCurrent(true);
    const el = new Audio(entry.src);
    el.loop = true;
    el.volume = 0;
    el.addEventListener('error', () => { if (current && current.el === el) current = null; });
    const p = el.play();
    if (p && typeof p.catch === 'function') {
      // Autoplay can be blocked until the teacher first interacts — harmless,
      // the next navigation retries.
      p.catch(() => { if (current && current.el === el) current = null; });
    }
    current = { el, moduleId, src: entry.src };
    ramp(el, targetVolume(moduleId));
  } catch (e) { /* ambience is never worth an error */ }
}

// Re-apply volume when the teacher changes the sound or ambient settings.
export function refreshAmbient() {
  if (!current) return;
  // A track swap on the live screen must actually swap, not just re-ramp.
  const e = entryFor(current.moduleId);
  if (!e) { stopCurrent(true); return; }
  if (e.src !== current.src) { ambientFor(current.moduleId); return; }
  ramp(current.el, targetVolume(current.moduleId));
}

// Hard stop: used when a presentation opens or everything is muted. Kills the
// current track AND anything still mid-fade, so nothing can bleed into a
// lesson video.
export function stopAmbient() {
  stopCurrent(false);
  [...retiring].forEach(killAudio);
}

// Self-wire: follow screen changes and setting changes.
export function initAmbient() {
  window.addEventListener('module:navigate', (e) => ambientFor(e.detail?.id));
  store.subscribe(refreshAmbient);
}
