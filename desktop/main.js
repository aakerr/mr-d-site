// main.js — the Electron main process for ClassOS.
//
// It does four things: choose a VISIBLE data folder, serve the existing web app
// through a custom protocol (so its ES modules load — they cannot over file://,
// the same wall the browser launcher hit), own the key/value file, and open a
// clean full-screen window with no browser chrome.
//
// The renderer is the app EXACTLY as it runs in a browser — no fork, no build
// step, no changed screens. Only the storage seam swaps its backend, because
// window.classos.kv is now present.
const { app, BrowserWindow, protocol, ipcMain, shell, net } = require('electron');
const path = require('path');
const fs = require('fs');
const { pathToFileURL } = require('url');
const { createKvStore } = require('./kvstore');

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

const APP_ROOT = path.join(__dirname, '..');   // the web app's files (index.html etc.)
let kv = null;
let dataDir = '';

// A privileged scheme so imports, fetch and workers behave like http rather
// than the locked-down file://. Must be registered before app is ready.
protocol.registerSchemesAsPrivileged([
  { scheme: 'classos', privileges: { standard: true, secure: true, supportFetchAPI: true, stream: true } },
]);

function serveAppFiles() {
  protocol.handle('classos', (request) => {
    // classos://app/<path> -> APP_ROOT/<path>. Default to index.html.
    let rel = decodeURIComponent(new URL(request.url).pathname).replace(/^\/+/, '');
    if (!rel || rel.endsWith('/')) rel = `${rel}index.html`;
    // Never let a crafted path escape the app folder.
    const full = path.normalize(path.join(APP_ROOT, rel));
    if (!full.startsWith(APP_ROOT)) return new Response('Forbidden', { status: 403 });
    return net.fetch(pathToFileURL(full).toString());
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
  win.loadURL('classos://app/index.html');
  return win;
}

app.whenReady().then(() => {
  dataDir = chooseDataDir();
  kv = createKvStore(dataDir);
  serveAppFiles();

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

// Flush the last write before the process ends, so a point awarded a moment
// before closing is never lost.
app.on('before-quit', () => { try { kv && kv.flush(); } catch (e) {} });
app.on('window-all-closed', () => {
  try { kv && kv.flush(); } catch (e) {}
  if (process.platform !== 'darwin') app.quit();
});
