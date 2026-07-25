// Public, reusable 3D dice API — "drop a real physics roll into any container".
//
// This is the module OTHER features consume (e.g. Magic Shop wildcard items that
// trigger an instant, visibly-honest second roll). The Die of Destiny module
// drives `createDiceSim` directly because it keeps one long-lived sim across many
// rolls; this wrapper is the one-shot form: mount → roll → resolve → dispose.
//
// ---------------------------------------------------------------------------
// rollInHost(hostEl, options) -> Promise<{ value, values, dispose }>
//
//   hostEl   HTMLElement. Must be in the document and have a non-zero size
//            (the canvas fills it 100%×100% and the camera is framed from its
//            aspect ratio). A 16:9-ish box reads best.
//
//   options:
//     mode    '1d6' | '2d6' | 'd20'   (default 'd20')
//     house   house object (needs .accent) OR house id 1-4 OR null.
//             Tints the dice to that house's accent; null = default colors
//             (blue d6 / gold d20).
//     fate    boolean, DEFAULT false. false = genuinely uniform randomness.
//             true enables the classroom "upper-half" weighting — do NOT turn
//             this on for anything students spend points on.
//     flyMs   number, optional. Minimum time the dice must visibly fly before
//             the face is read (drama floor). Defaults to the sim's own value
//             (~2300ms). The physics runs to a real rest either way.
//     audio   optional audio singleton; defaults to the app's core audio
//             (roll/bounce-thud/settle SFX). Pass a no-op object to silence.
//
//   Resolves once the dice physically come to rest, with:
//     value   number — the total (sum of all dice; for d20/1d6 just the die)
//     values  number[] — each die's face value, in spawn order
//     dispose function — tear down this roll's renderer/world/DOM
//
//   Rejects if hostEl is invalid, WebGL is unavailable, or the host is removed
//   from the document mid-roll (message: "host element was removed…").
//
//   TEARDOWN — the caller owns it. Either:
//     const roll = rollInHost(box, { mode: 'd20' });
//     roll.dispose();                     // available immediately, even mid-roll
//   or:
//     const { value, dispose } = await rollInHost(box, { mode: 'd20' });
//     dispose();
//   The roll also self-disposes if hostEl leaves the document.
//
//   CONCURRENCY — every call builds its own renderer, scene, physics world and
//   RAF loop, so independent hosts can roll simultaneously without interfering.
//   Each roll must be disposed; browsers cap live WebGL contexts (~8-16), so
//   don't leave many undisposed.
// ---------------------------------------------------------------------------
import { createDiceSim } from './sim.js';
import { audio as coreAudio } from '../../core/audio.js';
import { store } from '../../core/store.js';

/** How often to check that the host is still in the document. */
const HOST_WATCH_MS = 500;

function resolveHouse(house) {
  if (house == null) return null;
  if (typeof house === 'number' || typeof house === 'string') {
    return store.HOUSES[Number(house)] || null;
  }
  return house.accent ? house : null;
}

export function rollInHost(hostEl, options = {}) {
  const {
    mode = 'd20',
    house = null,
    fate = false,          // uniform by default — see the note above
    flyMs,
    audio = coreAudio,
  } = options;

  if (!hostEl || typeof hostEl !== 'object' || !hostEl.appendChild) {
    return Promise.reject(new TypeError('rollInHost: hostEl must be an HTMLElement'));
  }

  let sim = null;
  let watch = null;
  let disposed = false;

  function dispose() {
    if (disposed) return;
    disposed = true;
    if (watch) { clearInterval(watch); watch = null; }
    try { sim?.dispose(); } catch (e) { console.error('rollInHost: dispose failed', e); }
    sim = null;
  }

  try {
    sim = createDiceSim({ container: hostEl, audio, fate, minRollMs: flyMs });
    sim.setHouse(resolveHouse(house));
  } catch (e) {
    dispose();
    const err = new Error(`rollInHost: could not start the 3D dice — ${e?.message || e}`);
    err.cause = e;
    return Promise.reject(err);
  }

  const promise = new Promise((resolve, reject) => {
    // Self-clean if the caller tears down its overlay without disposing.
    watch = setInterval(() => {
      if (!hostEl.isConnected) {
        dispose();
        reject(new Error('rollInHost: host element was removed before the roll finished'));
      }
    }, HOST_WATCH_MS);

    sim.roll(mode).then((results) => {
      if (disposed) return;                  // torn down mid-roll; already rejected
      if (watch) { clearInterval(watch); watch = null; }
      if (!results || !results.length) {
        dispose();
        reject(new Error('rollInHost: the roll produced no result'));
        return;
      }
      const values = results.map((r) => r.value);
      resolve({ value: values.reduce((a, b) => a + b, 0), values, dispose });
    }).catch((e) => { dispose(); reject(e); });
  });

  // Expose teardown immediately, so a caller can abort before the dice settle.
  promise.dispose = dispose;
  return promise;
}

/**
 * Headless uniformity/fairness harness for the shared dice (no rendering).
 * Runs `n` complete throws and tallies settled values.
 *   auditRolls('d20', 300, { fate: false }) -> { counts, targeted, hits }
 * Needs a temporary sized host; callers usually run this from the console.
 */
export function auditRolls(mode, n, { fate = false, host = null } = {}) {
  const el = host || document.createElement('div');
  if (!host) {
    el.style.cssText = 'position:absolute;left:-9999px;top:0;width:960px;height:540px;';
    document.body.appendChild(el);
  }
  const sim = createDiceSim({ container: el, audio: { sfx() {} }, fate });
  try {
    return sim.audit(mode, n, { fate });
  } finally {
    sim.dispose();
    if (!host && el.parentNode) el.remove();
  }
}
