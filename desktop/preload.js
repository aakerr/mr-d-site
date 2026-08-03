// preload.js — the bridge between the app and the file on disk.
//
// The app's storage seam (js/core/storage.js) is SYNCHRONOUS: storage.get(key)
// returns immediately. To honour that over a process boundary, the whole
// key/value blob is pulled ONCE at preload time with a synchronous IPC call and
// held in a local cache. Reads are then instant from the cache; writes update
// the cache and fire an async message to the main process, which owns the file
// and debounces the actual disk write. A caller never waits.
//
// contextIsolation stays ON (the Electron security default): the page cannot
// reach Node, only this narrow, audited surface via contextBridge.
const { contextBridge, ipcRenderer } = require('electron');

// One synchronous round-trip at startup to hydrate the cache.
let cache = {};
try { cache = ipcRenderer.sendSync('kv:all') || {}; } catch (e) { cache = {}; }

contextBridge.exposeInMainWorld('classos', {
  // Matches the shape js/core/storage.js probes for (window.classos.kv).
  kv: {
    get(key) {
      return Object.prototype.hasOwnProperty.call(cache, key) ? cache[key] : null;
    },
    set(key, val) {
      const v = String(val);
      cache[key] = v;
      ipcRenderer.send('kv:set', key, v);   // fire-and-forget; main persists
    },
    remove(key) {
      delete cache[key];
      ipcRenderer.send('kv:remove', key);
    },
    keys() {
      return Object.keys(cache);
    },
  },
  // So the app can show the teacher exactly where their data lives, and open
  // the folder from Admin. Wired in a later step; harmless if unused.
  dataDir() { try { return ipcRenderer.sendSync('kv:dir'); } catch (e) { return ''; } },
  revealDataDir() { ipcRenderer.send('kv:reveal'); },
  // The header's ⛶ button. The web fullscreen API can't touch OS-window
  // fullscreen, so in the desktop build the button drives the REAL window
  // through main (see "fullscreen, done so the teacher can always get back
  // out" in desktop/main.js). onChange keeps the glyph honest when fullscreen
  // is toggled some other way (the menu accelerator, macOS's green button).
  fullscreen: {
    get() { try { return !!ipcRenderer.sendSync('fs:get'); } catch (e) { return false; } },
    toggle() { ipcRenderer.send('fs:toggle'); },
    onChange(cb) { ipcRenderer.on('fs:state', (_e, flag) => { try { cb(!!flag); } catch (err) {} }); },
  },
  isDesktop: true,
});
