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
const { app, BrowserWindow, ipcMain, shell, Menu } = require('electron');
const http = require('http');
const path = require('path');
const fs = require('fs');
const { createKvStore } = require('./kvstore');

const APP_ROOT = path.join(__dirname, '..');   // the web app's files (index.html etc.)
let kv = null;
let dataDir = '';
let appOrigin = '';   // http://localhost:<port>, set once the server is listening
let server = null;    // the local file server, closed on quit

// The name the OS shows everywhere the app appears — macOS menu bar, the app
// switcher, notifications, the Windows taskbar tooltip. Without this a dev run
// (electron .) reads "Electron"; the packaged build already carries productName,
// but setting it here means both look right. Must be set before app is ready.
app.setName('ClassOS');

// A generous disk cache, set before the app is ready or it is ignored. The
// POTW globe streams Google's 3D tiles, and they honour HTTP caching — with a
// 1 GB cache a flight flown once (a morning rehearsal at the desk, last week's
// class) replays mostly from disk instead of school wifi. The browser default
// is far smaller and evicts tiles almost immediately.
app.commandLine.appendSwitch('disk-cache-size', String(1024 * 1024 * 1024));

// ---- where the data lives (VISIBLE, and OUTSIDE the install folder) --------
// Documents\ClassOS Data. It used to sit next to the app, which was a
// data-losing bug: the NSIS uninstaller deletes the install directory, and
// EVERY update runs the uninstaller first. Proven on Windows — a marker file
// written into the folder was gone after re-running the installer, directory
// and all. A teacher who had entered a term of points would have lost the year
// on the first update.
//
// Next-to-the-app also failed its own purpose. The per-user install lands in
// %LOCALAPPDATA%\Programs\ClassOS, so "next to the app" meant a path no
// teacher will ever browse to. Documents is where they actually look, it is
// always writable, the installer never touches it, and on a school account it
// is usually OneDrive-synced — which is the offsite backup this folder was
// always meant to make easy.
//
// In development (run from source) it still lives beside the project.
function chooseDataDir() {
  const candidates = [];
  if (!app.isPackaged) candidates.push(path.join(__dirname, '..', 'ClassOS Data (dev)'));
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

// ---- fullscreen, done so the teacher can always get back out ----------------
// macOS native fullscreen moves the window to its own Space with hidden
// controls — click the wrong thing and the app seems to vanish (it happened).
// SIMPLE fullscreen (pre-Lion style) fills the screen in place: instant, same
// Space, and toggling out just restores the normal window. Windows/Linux use
// ordinary fullscreen, which behaves sanely there. The header's ⛶ button in
// the app can't reach OS-window state through the web fullscreen API, so main
// owns these two helpers and the page drives them over IPC (see preload.js).
function getFullscreen(win) {
  return process.platform === 'darwin' ? win.isSimpleFullScreen() : win.isFullScreen();
}
function setFullscreen(win, flag) {
  if (process.platform === 'darwin') win.setSimpleFullScreen(flag);
  else win.setFullScreen(flag);
}

function createWindow() {
  const win = new BrowserWindow({
    fullscreen: process.platform !== 'darwin',  // fill the board on launch (macOS goes simple-fullscreen below)
    width: 1600,                      // the size it falls back to when fullscreen is left
    height: 1000,
    backgroundColor: '#0b0f19',
    show: false,                      // reveal only once painted, no white flash
    autoHideMenuBar: true,            // no File/Edit menu clutter
    title: 'ClassOS',
    // Taskbar/window icon for a dev run on Windows; the packaged build embeds
    // its own icon, and macOS ignores this in favour of the bundle/dock icon.
    icon: process.platform === 'win32' ? path.join(APP_ROOT, 'ClassOS.ico') : undefined,
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,         // security default — the page can't reach Node
      nodeIntegration: false,
    },
  });
  // The page sets its own <title> for the browser build; here the window and
  // taskbar should keep reading the app's name, so refuse the page's override.
  win.on('page-title-updated', (e) => e.preventDefault());
  win.once('ready-to-show', () => {
    if (process.platform === 'darwin') win.setSimpleFullScreen(true);
    win.show();
  });
  // Keep the header glyph honest if fullscreen changes behind the page's back
  // (F11, the menu accelerator, or macOS's own green button).
  const pushState = () => {
    try { win.webContents.send('fs:state', getFullscreen(win)); } catch (e) { /* window closing */ }
  };
  win.on('enter-full-screen', pushState);
  win.on('leave-full-screen', pushState);
  win.loadURL(`${appOrigin}/index.html`);
  return win;
}

// The default Electron menu's "Toggle Full Screen" drives NATIVE fullscreen,
// which would fight the simple-fullscreen mode above and strand the window in
// a state the header button can't undo. Replace it with our own toggle, and
// keep the Edit roles — without them Cmd+C/Cmd+V die in Admin's text fields.
function installMenu() {
  if (process.platform !== 'darwin') { Menu.setApplicationMenu(null); return; }
  const toggleItem = {
    label: 'Toggle Full Screen',
    accelerator: 'Ctrl+Command+F',
    click: (_item, win) => { if (win) setFullscreen(win, !getFullscreen(win)); },
  };
  Menu.setApplicationMenu(Menu.buildFromTemplate([
    { label: 'ClassOS', submenu: [{ role: 'about' }, { type: 'separator' }, { role: 'quit' }] },
    { role: 'editMenu' },
    { label: 'View', submenu: [toggleItem] },
    { role: 'windowMenu' },
  ]));
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

    // In a dev run the macOS dock shows Electron's default icon; point it at
    // ClassOS's own so testing looks right. The packaged .app already carries
    // this in its bundle. Harmless if the image can't be loaded.
    if (process.platform === 'darwin' && app.dock) {
      try { app.dock.setIcon(path.join(APP_ROOT, 'ClassOS.app/Contents/Resources/ClassOS.icns')); } catch (e) {}
    }

    // ---- the key/value bridge (see desktop/preload.js) ----
    ipcMain.on('kv:all', (e) => { e.returnValue = kv.all(); });
    ipcMain.on('kv:set', (e, key, val) => kv.set(key, val));
    ipcMain.on('kv:remove', (e, key) => kv.remove(key));
    ipcMain.on('kv:dir', (e) => { e.returnValue = dataDir; });
    ipcMain.on('kv:reveal', () => { shell.openPath(dataDir); });

    // ---- the fullscreen bridge (the header's ⛶ button drives this) ----
    ipcMain.on('fs:get', (e) => {
      const win = BrowserWindow.fromWebContents(e.sender);
      e.returnValue = win ? getFullscreen(win) : false;
    });
    ipcMain.on('fs:toggle', (e) => {
      const win = BrowserWindow.fromWebContents(e.sender);
      if (!win) return;
      setFullscreen(win, !getFullscreen(win));
      e.sender.send('fs:state', getFullscreen(win));
    });

    installMenu();
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
