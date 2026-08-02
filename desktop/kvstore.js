// kvstore.js — the file behind window.classos.kv, in the Electron MAIN process.
//
// This is the whole point of the desktop build: the term stops living inside a
// browser's localStorage (where "clear browsing data" can erase it) and lives
// in a plain, visible JSON file the teacher can see, copy and hand to OneDrive.
//
// Kept as pure Node with no Electron imports on purpose, so it can be unit-
// tested without spinning up a window — which is exactly how it was verified
// on the Windows box over SSH, where there is no display to render into.
//
// DURABILITY: writes are atomic — the new content goes to a temp file which is
// then renamed over the real one. A power cut mid-write leaves the old file
// intact rather than a half-written one, which for a term of points is the
// difference that matters. Writes are debounced so a Battle Day's dozen awards
// become one disk write, and flush() forces it out on shutdown.
const fs = require('fs');
const path = require('path');

const WRITE_DEBOUNCE_MS = 400;

function createKvStore(dir, fileName = 'classroom-data.json') {
  fs.mkdirSync(dir, { recursive: true });
  const file = path.join(dir, fileName);
  const tmp = path.join(dir, `.${fileName}.tmp`);

  // Hydrate once. A missing file is a fresh install, not an error. A corrupt
  // file is set aside rather than overwritten — the teacher may want it back.
  let cache = {};
  try {
    if (fs.existsSync(file)) cache = JSON.parse(fs.readFileSync(file, 'utf8')) || {};
  } catch (e) {
    try {
      const stamp = new Date().toISOString().replace(/[:.]/g, '-');
      fs.renameSync(file, path.join(dir, `corrupt-${stamp}.json`));
    } catch (e2) { /* nothing we can safely do */ }
    cache = {};
  }

  let timer = null;
  let writing = false;

  function writeNow() {
    if (timer) { clearTimeout(timer); timer = null; }
    if (writing) return;                 // a later change re-arms via schedule()
    writing = true;
    try {
      fs.writeFileSync(tmp, JSON.stringify(cache, null, 2));
      fs.renameSync(tmp, file);          // atomic swap
    } catch (e) {
      // A failed write must not crash the app; the in-memory cache is still
      // correct and the next change will try again.
      console.error('kvstore: write failed', e);
    } finally {
      writing = false;
    }
  }

  function schedule() {
    if (timer) clearTimeout(timer);
    timer = setTimeout(writeNow, WRITE_DEBOUNCE_MS);
  }

  return {
    file,
    all() { return cache; },
    get(key) { return Object.prototype.hasOwnProperty.call(cache, key) ? cache[key] : null; },
    set(key, val) { cache[key] = String(val); schedule(); },
    remove(key) { delete cache[key]; schedule(); },
    keys() { return Object.keys(cache); },
    // Force the debounced write out — called on window close so nothing set in
    // the last fraction of a second is lost.
    flush() { writeNow(); },
  };
}

module.exports = { createKvStore };
