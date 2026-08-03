// main.js — the Electron main process for ClassOS.
//
// It does four things: choose a VISIBLE data folder, serve the existing web app
// over http://localhost:8000, own the key/value file, and open a clean window
// with no browser chrome.
//
// WHY A LOCAL HTTP SERVER AND NOT file:// OR A CUSTOM SCHEME:
// The app's ES modules can't load over file://. A custom classos:// scheme fixed
// that, but Google Maps rejected it — the POTW globe showed "This page didn't
// load Google Maps correctly" (RefererNotAllowedMapError), because Maps checks
// the page's real origin against the key's allow-list and a custom scheme is not
// on it. Header-spoofing was a dead end too — Maps reads window.location, not the
// HTTP Referer, so no header rewrite can move the origin. So the desktop build
// serves itself over http://localhost, a real origin Maps accepts. The key's
// referrer allow-list includes http://localhost:* (any port), so the server
// takes a RANDOM free port — nothing on the teacher's PC can collide with it.
// Proven with a screenshot: the Giza tiles render on a random port.
//
// The renderer is the app EXACTLY as it runs in a browser — no fork, no build
// step, no changed screens. Only the storage seam swaps its backend, because
// window.classos.kv is now present.
const { app, BrowserWindow, ipcMain, shell } = require('electron');
const http = require('http');
const path = require('path');
const fs = require('fs');
const { createKvStore } = require('./kvstore');

const APP_ROOT = path.join(__dirname, '..');   // the web app's files (index.html etc.)
let kv = null;
let dataDir = '';
let appOrigin = '';   // http://localhost:<port>, set once the server is listening
let server = null;    // the local file server, closed on quit

// ---- where the data lives (VISIBLE, on the owner's call) --------------------
// A folder called "ClassOS Data" sitting next to the app, so the teacher can
// see it, copy it, and drop it into OneDrive by hand. Next to the app only
// works if that spot is writable — a Program Files install is not — so it
// falls back to Documents\ClassOS Data, which always is and is where a teacher
// looks anyway. In development (run from source) it lives beside the project.
function chooseDataDir() {
  const candidates = [];
  if (app.isPackaged) {
    candidates.push(path.join(path.dirname(app.getPath('exe')), 'ClassOS Data'));
  } else {
    candidates.push(path.join(__dirname, '..', 'ClassOS Data (dev)'));
  }
  candidates.push(path.join(app.getPath('documents'), 'ClassOS Data'));
  for (const dir of candidates) {
    try {
      fs.mkdirSync(dir, { recursive: true });
      fs.accessSync(dir, fs.constants.W_OK);   // prove it is writable
      return dir;
    } catch (e) { /* try the next */ }
  }
  // Last resort: the app's own userData. Never visible, but never fails.
  return app.getPath('userData');
}

const MIME = {
  '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8', '.svg': 'image/svg+xml',
  '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg',
  '.webp': 'image/webp', '.gif': 'image/gif', '.ico': 'image/x-icon',
  '.webm': 'video/webm', '.mp4': 'video/mp4', '.ogg': 'video/ogg',
  '.mp3': 'audio/mpeg', '.wav': 'audio/wav',
  '.woff2': 'font/woff2', '.woff': 'font/woff', '.ttf': 'font/ttf',
  '.wasm': 'application/wasm', '.txt': 'text/plain; charset=utf-8',
};

// A tiny read-only static server bound to loopback only. Range support matters:
// the intro films are played through <video>, which issues byte-range requests
// to seek, and streaming (not readFile) keeps a 40 MB film off the heap.
function handleRequest(req, res) {
  let rel;
  try { rel = decodeURIComponent((req.url || '/').split('?')[0]).replace(/^\/+/, ''); }
  catch (e) { res.writeHead(400); return res.end('Bad request'); }
  if (!rel || rel.endsWith('/')) rel += 'index.html';
  const full = path.normalize(path.join(APP_ROOT, rel));
  if (full !== APP_ROOT && !full.startsWith(APP_ROOT + path.sep)) {
    res.writeHead(403); return res.end('Forbidden');      // no escaping the app folder
  }
  fs.stat(full, (err, st) => {
    if (err || !st.isFile()) { res.writeHead(404); return res.end('Not found'); }
    const type = MIME[path.extname(full).toLowerCase()] || 'application/octet-stream';
    const range = req.headers.range;
    if (range) {
      const m = /bytes=(\d*)-(\d*)/.exec(range);
      let start = m && m[1] ? parseInt(m[1], 10) : 0;
      let end = m && m[2] ? parseInt(m[2], 10) : st.size - 1;
      if (!Number.isFinite(start)) start = 0;
      if (!Number.isFinite(end) || end >= st.size) end = st.size - 1;
      if (start > end || start >= st.size) {
        res.writeHead(416, { 'Content-Range': `bytes */${st.size}` }); return res.end();
      }
      res.writeHead(206, {
        'Content-Type': type, 'Accept-Ranges': 'bytes',
        'Content-Range': `bytes ${start}-${end}/${st.size}`, 'Content-Length': end - start + 1,
      });
      fs.createReadStream(full, { start, end }).pipe(res);
    } else {
      res.writeHead(200, { 'Content-Type': type, 'Content-Length': st.size, 'Accept-Ranges': 'bytes' });
      fs.createReadStream(full).pipe(res);
    }
  });
}

// Serve over loopback on a free port the OS picks (port 0). No fixed port means
// nothing on the machine can ever be in the way, and the Maps key trusts any
// localhost origin, so the globe loads wherever we land.
function startLocalServer() {
  return new Promise((resolve) => {
    server = http.createServer(handleRequest);
    server.on('error', (err) => { console.error('main: local server failed', err); resolve(); });
    server.listen(0, '127.0.0.1', () => {
      appOrigin = `http://localhost:${server.address().port}`;
      resolve();
    });
  });
}

function createWindow() {
  const win = new BrowserWindow({
    width: 1600,
    height: 1000,
    backgroundColor: '#0b0f19',
    show: false,                      // reveal only once painted, no white flash
    autoHideMenuBar: true,            // no File/Edit menu clutter
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,         // security default — the page can't reach Node
      nodeIntegration: false,
    },
  });
  win.once('ready-to-show', () => win.show());
  win.loadURL(`${appOrigin}/index.html`);
  return win;
}

// One running copy only. Without this a second launch (a teacher double-clicking
// the icon) would open a second window writing the SAME data file, and the two
// could clobber each other's saves. Focus the existing window instead.
const gotLock = app.requestSingleInstanceLock();
if (!gotLock) {
  app.quit();
} else {
  app.on('second-instance', () => {
    const [win] = BrowserWindow.getAllWindows();
    if (win) { if (win.isMinimized()) win.restore(); win.focus(); }
  });

  app.whenReady().then(async () => {
    dataDir = chooseDataDir();
    kv = createKvStore(dataDir);
    await startLocalServer();

    // ---- the key/value bridge (see desktop/preload.js) ----
    ipcMain.on('kv:all', (e) => { e.returnValue = kv.all(); });
    ipcMain.on('kv:set', (e, key, val) => kv.set(key, val));
    ipcMain.on('kv:remove', (e, key) => kv.remove(key));
    ipcMain.on('kv:dir', (e) => { e.returnValue = dataDir; });
    ipcMain.on('kv:reveal', () => { shell.openPath(dataDir); });

    createWindow();

    app.on('activate', () => {
      if (BrowserWindow.getAllWindows().length === 0) createWindow();
    });
  });
}

// Flush the last write and let go of the port before the process ends, so a
// point awarded a moment before closing is never lost and nothing is left bound.
app.on('before-quit', () => {
  try { kv && kv.flush(); } catch (e) {}
  try { server && server.close(); } catch (e) {}
});

// Closing the window QUITS the app — on EVERY OS, macOS included. This is a
// single-window classroom kiosk, not a document app: there is no reason to keep
// a windowless process alive. Leaving one alive on macOS is exactly how the
// dashboard's ambient music kept looping with no window to silence it. Quitting
// tears down every Electron helper process and stops all audio with the
// renderer, so "close the window" always means "fully stopped".
app.on('window-all-closed', () => {
  try { kv && kv.flush(); } catch (e) {}
  app.quit();
});
