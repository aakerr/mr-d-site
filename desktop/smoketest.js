// smoketest.js — a throwaway Electron main that proves the desktop chain works
// WITHOUT a visible window, so it can run over SSH where there is no display.
//
// It loads the real app into an offscreen window and checks, from inside the
// running renderer, that: the preload bridge is present, the app booted, and a
// value written through the storage seam actually reached the file on disk.
// Prints SMOKE_PASS / SMOKE_FAIL and exits. Not shipped.
const { app, BrowserWindow, protocol, ipcMain, net } = require('electron');
const path = require('path');
const fs = require('fs');
const { pathToFileURL } = require('url');
const { createKvStore } = require('./kvstore');

app.disableHardwareAcceleration();   // no GPU in a headless session

const APP_ROOT = path.join(__dirname, '..');
const dataDir = path.join(require('os').tmpdir(), 'classos-smoke-' + Date.now());
const kv = createKvStore(dataDir);

protocol.registerSchemesAsPrivileged([
  { scheme: 'classos', privileges: { standard: true, secure: true, supportFetchAPI: true, stream: true } },
]);

function done(passed, detail) {
  console.log(passed ? 'SMOKE_PASS' : 'SMOKE_FAIL', detail || '');
  try { fs.rmSync(dataDir, { recursive: true, force: true }); } catch (e) {}
  app.exit(passed ? 0 : 1);
}

app.whenReady().then(async () => {
  protocol.handle('classos', (request) => {
    let rel = decodeURIComponent(new URL(request.url).pathname).replace(/^\/+/, '');
    if (!rel || rel.endsWith('/')) rel += 'index.html';
    const full = path.normalize(path.join(APP_ROOT, rel));
    if (!full.startsWith(APP_ROOT)) return new Response('no', { status: 403 });
    return net.fetch(pathToFileURL(full).toString());
  });
  ipcMain.on('kv:all', (e) => { e.returnValue = kv.all(); });
  ipcMain.on('kv:set', (e, k, v) => kv.set(k, v));
  ipcMain.on('kv:remove', (e, k) => kv.remove(k));
  ipcMain.on('kv:dir', (e) => { e.returnValue = dataDir; });
  ipcMain.on('kv:reveal', () => {});

  const win = new BrowserWindow({
    show: false,
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      offscreen: true,
      contextIsolation: true,
      nodeIntegration: false,
    },
  });

  const timeout = setTimeout(() => done(false, 'timed out waiting for the app to boot'), 25000);

  win.webContents.on('did-finish-load', async () => {
    try {
      // 1. preload bridge present?
      const hasBridge = await win.webContents.executeJavaScript('!!(window.classos && window.classos.kv)');
      if (!hasBridge) return (clearTimeout(timeout), done(false, 'window.classos.kv missing — preload did not run'));

      // 2. did the app actually boot? (its module root gets a child on mount)
      const booted = await win.webContents.executeJavaScript(
        'new Promise(r => setTimeout(() => r(!!document.querySelector("#module-root")), 3000))');
      if (!booted) return (clearTimeout(timeout), done(false, 'app did not mount — ES modules may not be loading'));

      // 3. write through the SEAM and confirm it lands in the file on disk
      await win.webContents.executeJavaScript(
        'import("classos://app/js/core/storage.js").then(m => m.storage.set("smoke-key","smoke-value"))');
      await new Promise((r) => setTimeout(r, 800));   // let the debounced write flush
      kv.flush();
      const onDisk = JSON.parse(fs.readFileSync(path.join(dataDir, 'classroom-data.json'), 'utf8'));
      if (onDisk['smoke-key'] !== 'smoke-value') return (clearTimeout(timeout), done(false, 'seam write did not reach the file'));

      clearTimeout(timeout);
      done(true, '(preload + ES modules + seam->file all verified)');
    } catch (e) {
      clearTimeout(timeout);
      done(false, 'error: ' + (e && e.message));
    }
  });

  win.webContents.on('did-fail-load', (e, code, desc) => {
    clearTimeout(timeout);
    done(false, `did-fail-load ${code}: ${desc}`);
  });

  win.loadURL('classos://app/index.html');
});
