// Boot — wires core singletons, loads Maps 3D, registers all modules.
import { CONFIG } from './config.js';
import { store } from './core/store.js';
import { registry } from './core/registry.js';
import { audio } from './core/audio.js';
import { initShell } from './core/shell.js';
import './core/backup.js'; // self-initializing auto-backup (File System Access)

import dashboard from './modules/dashboard.js';
import houses from './modules/houses.js';
import potw from './modules/potw.js';
import dice from './modules/dice.js';
import battle from './modules/battle.js';
import shop from './modules/shop.js';
import admin from './modules/admin.js';
import quests from './modules/quests.js';

// Load Google Maps 3D library (async; POTW awaits customElements.whenDefined).
// The teacher can supply their own key in Admin -> Settings; it overrides the bundled one.
const mapsKey = store.getSettings?.().mapsApiKeyOverride || CONFIG.MAPS_API_KEY;
const maps = document.createElement('script');
maps.async = true;
maps.src = `https://maps.googleapis.com/maps/api/js?key=${mapsKey}&v=beta&libraries=maps3d`;
document.head.appendChild(maps);

const ctx = { store, registry, audio };
registry.init(ctx);

[dashboard, houses, potw, dice, battle, shop, admin, quests].forEach((m) => registry.register(m));

initShell(ctx);
registry.home();
