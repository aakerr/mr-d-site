// Boot — wires core singletons, loads Maps 3D, registers all modules.
import { CONFIG } from './config.js';
import { store } from './core/store.js';
import { registry } from './core/registry.js';
import { audio } from './core/audio.js';
import { initShell } from './core/shell.js';
import './core/backup.js'; // self-initializing auto-backup (File System Access)
import { initAmbient } from './core/ambient.js';

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

[dashboard, houses, potw, dice, battle, shop, admin, quests, council, wheel].forEach((m) => registry.register(m));

initShell(ctx);
initAmbient();
registry.home();
