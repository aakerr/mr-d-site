// Audio helpers — file playback, synthesized SFX (no assets needed), speech.
// Honours the teacher's sound switch (Admin/Help → sound toggle).
import { store } from './store.js';

const soundOn = () => { try { return store.getSettings().soundEnabled !== false; } catch (e) { return true; } };
let actx = null;
const playing = new Set();

function ac() {
  if (!actx) actx = new (window.AudioContext || window.webkitAudioContext)();
  if (actx.state === 'suspended') actx.resume();
  return actx;
}

function tone({ freq = 440, type = 'sine', dur = 0.3, delay = 0, gain = 0.25, sweep = null }) {
  try {
    const c = ac();
    const osc = c.createOscillator();
    const g = c.createGain();
    osc.type = type;
    const t0 = c.currentTime + delay;
    osc.frequency.setValueAtTime(freq, t0);
    if (sweep) osc.frequency.exponentialRampToValueAtTime(sweep, t0 + dur);
    g.gain.setValueAtTime(gain, t0);
    g.gain.exponentialRampToValueAtTime(0.001, t0 + dur);
    osc.connect(g).connect(c.destination);
    osc.start(t0); osc.stop(t0 + dur + 0.05);
  } catch (e) { /* audio unavailable — stay silent */ }
}

function noise({ dur = 0.3, delay = 0, gain = 0.2, highpass = 2000 }) {
  try {
    const c = ac();
    const buf = c.createBuffer(1, c.sampleRate * dur, c.sampleRate);
    const data = buf.getChannelData(0);
    for (let i = 0; i < data.length; i++) data[i] = Math.random() * 2 - 1;
    const src = c.createBufferSource(); src.buffer = buf;
    const f = c.createBiquadFilter(); f.type = 'highpass'; f.frequency.value = highpass;
    const g = c.createGain();
    const t0 = c.currentTime + delay;
    g.gain.setValueAtTime(gain, t0);
    g.gain.exponentialRampToValueAtTime(0.001, t0 + dur);
    src.connect(f).connect(g).connect(c.destination);
    src.start(t0);
  } catch (e) { /* silent */ }
}

const SFX = {
  // metallic sword-drawn shing
  sword() {
    noise({ dur: 0.5, gain: 0.3, highpass: 3500 });
    tone({ freq: 2400, sweep: 5200, type: 'sawtooth', dur: 0.45, gain: 0.12 });
    tone({ freq: 1200, sweep: 3600, type: 'triangle', dur: 0.5, gain: 0.1, delay: 0.05 });
  },
  fanfare() {
    [523, 659, 784, 1047].forEach((f, i) => tone({ freq: f, type: 'square', dur: 0.35, delay: i * 0.14, gain: 0.15 }));
  },
  thud() {
    tone({ freq: 120, sweep: 40, type: 'sine', dur: 0.35, gain: 0.5 });
    noise({ dur: 0.15, gain: 0.15, highpass: 200 });
  },
  coin() {
    tone({ freq: 988, type: 'square', dur: 0.09, gain: 0.15 });
    tone({ freq: 1319, type: 'square', dur: 0.25, delay: 0.09, gain: 0.15 });
  },
  roll() {
    for (let i = 0; i < 6; i++) noise({ dur: 0.06, delay: i * 0.09, gain: 0.12, highpass: 800 });
  },
};

export const audio = {
  play(src, { loop = false, volume = 1 } = {}) {
    const el = new Audio(src);
    el.loop = loop; el.volume = volume;
    playing.add(el);
    el.addEventListener('ended', () => playing.delete(el));
    el.play().catch((e) => console.warn('audio.play blocked/failed:', src, e?.message));
    return el;
  },

  sfx(name) { (SFX[name] || (() => {}))(); },

  say(text, { rate = 1, pitch = 1 } = {}) {
    try {
      const u = new SpeechSynthesisUtterance(text);
      u.rate = rate; u.pitch = pitch;
      speechSynthesis.speak(u);
    } catch (e) { /* unsupported — silent */ }
  },

  stopAll() {
    playing.forEach((el) => { el.pause(); el.src = ''; });
    playing.clear();
    try { speechSynthesis.cancel(); } catch (e) {}
  },
};

// Gate everything on the teacher's sound setting. NOTE: play() is volume-zeroed
// rather than suppressed — callers (e.g. the POTW intro) rely on the returned
// element's 'ended' event to advance, so returning undefined would strand them.
['sfx', 'say'].forEach((k) => { const f = audio[k]; audio[k] = (...a) => (soundOn() ? f(...a) : undefined); });
{ const f = audio.play; audio.play = (src, o = {}) => f(src, soundOn() ? o : { ...o, volume: 0 }); }
