// Boot — wires core singletons, loads Maps 3D, registers all modules.
import { CONFIG } from './config.js';
import { store } from './core/store.js';
import { registry } from './core/registry.js';
import { audio } from './core/audio.js';
import { initShell } from './core/shell.js';
import './core/backup.js'; // self-initializing auto-backup (File System Access)
import { initAmbient } from './core/ambient.js';
import { ensureAssetsWarm } from './core/preload.js';

import dashboard from './modules/dashboard.js';
import houses from './modules/houses.js';
import potw from './modules/potw.js';
import dice from './modules/dice.js';
import battle from './modules/battle.js';
import shop from './modules/shop.js';
import admin from './modules/admin.js';
import quests from './modules/quests.js';
import council from './modules/council.js';
import wheel from './modules/wheel.js';
import trivia from './modules/trivia.js';

// Load Google Maps 3D library (async; POTW awaits customElements.whenDefined).
// The teacher can supply their own key in Admin -> Settings; it overrides the bundled one.
const mapsKey = store.getSettings?.().mapsApiKeyOverride || CONFIG.MAPS_API_KEY;
const maps = document.createElement('script');
maps.async = true;
maps.src = `https://maps.googleapis.com/maps/api/js?key=${encodeURIComponent(mapsKey)}&v=beta&libraries=maps3d`;
document.head.appendChild(maps);

// A term of points lives in localStorage, which Chrome is entitled to evict
// under storage pressure without asking anyone. Marking the origin persistent
// makes it the last thing to go rather than the first. Fire-and-forget: it is
// unsupported in some browsers, and a refusal changes nothing we can act on.
if (navigator.storage && typeof navigator.storage.persist === 'function') {
  navigator.storage.persist()
    .then((granted) => { if (!granted) console.info('storage: persistence not granted (data may be evicted under pressure)'); })
    .catch(() => {});
}

const ctx = { store, registry, audio };
registry.init(ctx);

[dashboard, houses, potw, dice, battle, shop, admin, quests, council, wheel, trivia].forEach((m) => registry.register(m));

initShell(ctx);
initAmbient();
registry.home();

// First visit on this machine: a loading gate with a progress bar pulls every
// asset — art, sfx, music, the intro films — into the cache before the class
// sees a single late-loading background (js/core/preload.js). Runs once.
const firstLoadGate = ensureAssetsWarm();

// Warm the big painted backgrounds while the dashboard idles. On GitHub Pages
// a screen's art otherwise starts downloading the moment the screen opens —
// a visible beat of blank scrim before the painting pops in. Loading them one
// at a time (never in parallel) keeps the warm-up from competing with
// whatever the current screen is still fetching; requestIdleCallback delays
// the start until the dashboard has settled. Every file is already cached on
// the second visit, making this free except the first time.
const ART_PRELOAD = [
  'images/four-armies.jpg',       // Battle Day landing/cinematic/arena
  'images/quest-hall.jpg',        // Quests
  'images/magic-shop.jpg',        // Magic Shop
  'images/potw-background.jpg',   // Place of the Week landing
  'images/die-of-destiny.jpg',    // Die of Destiny
  'images/wheel-background.jpg',  // Wheel of Fate (three pieces)
  'images/wheel-outside.png',
  'images/wheel-center.png',
  'images/wheel-center-fate.png',
  'images/council-chamber.jpg',   // Council of Four
  'images/trivia-background.jpg', // Trivia Tuesday temple
  'images/trivia-card.png',       // Trivia Tuesday card
  ...Object.values(store.HOUSES).map((h) => h.heroImage),  // dashboard heroes
];
// Sound warms AFTER the art: every assigned sound effect and background
// track, read from the live settings so teacher-swapped files warm too. A
// cold sfx used to arrive a beat late the first time it fired (the trivia
// card's conjuring sound especially); a warmed one plays on its cue.
function audioPreloadList() {
  const out = [];
  try { Object.values(store.getSettings().sfx || {}).forEach((f) => { if (f) out.push(f); }); } catch (e) { /* none */ }
  try {
    const amb = store.getAmbient();
    Object.values(amb.tracks || {}).forEach((t) => { const src = typeof t === 'string' ? t : t && t.src; if (src) out.push(src); });
  } catch (e) { /* none */ }
  if (CONFIG.POTW_FLYOVER_DEFAULT) out.push(CONFIG.POTW_FLYOVER_DEFAULT);
  return [...new Set(out)];
}
function preloadArt(queue) {
  if (!queue.length) { preloadAudio(audioPreloadList()); return; }
  const img = new Image();
  const next = () => preloadArt(queue);
  img.onload = next;
  img.onerror = next;   // a missing file must not stall the rest of the queue
  img.src = queue.shift();
}
function preloadAudio(queue) {
  if (!queue.length) return;
  const next = () => preloadAudio(queue);
  // fetch() warms the HTTP cache without spinning up an audio element per file.
  fetch(queue.shift()).then((r) => r.blob()).then(next, next);
}
// The idle warm-up waits for the gate (racing it would fetch the same files
// twice in parallel), then sweeps as the safety net for later visits, where
// the gate skips and this quietly re-warms anything the cache evicted.
const idle = window.requestIdleCallback || ((fn) => setTimeout(fn, 1500));
idle(() => firstLoadGate.then(() => preloadArt([...ART_PRELOAD])));
