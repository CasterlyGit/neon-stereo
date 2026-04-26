import { app, BrowserWindow, shell } from 'electron';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import { registerIpcHandlers } from './ipc.js';
import { startPoller, stopPoller, setPollerVisibility, setPollerFocus } from './spotify/poller.js';

// CommonJS-compatible __dirname (electron-vite emits CJS for main).
const __filename = typeof __dirname !== 'undefined' ? __dirname : path.dirname(fileURLToPath(import.meta.url));
const PRELOAD_PATH = path.join(__filename, '../preload/preload.cjs');

let mainWindow: BrowserWindow | null = null;

function createWindow(): BrowserWindow {
  const win = new BrowserWindow({
    width: 480,
    height: 720,
    minWidth: 380,
    minHeight: 560,
    frame: false,
    titleBarStyle: 'hiddenInset',
    backgroundColor: '#0a0a12',
    show: false,
    webPreferences: {
      preload: PRELOAD_PATH,
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: false,
    },
  });

  win.once('ready-to-show', () => win.show());

  // Open external links in the system browser.
  win.webContents.setWindowOpenHandler(({ url }) => {
    void shell.openExternal(url);
    return { action: 'deny' };
  });

  // Hook focus / blur / visibility to the poller cadence selector.
  win.on('focus', () => setPollerFocus(true));
  win.on('blur', () => setPollerFocus(false));
  win.on('hide', () => setPollerVisibility(false));
  win.on('show', () => setPollerVisibility(true));
  win.on('minimize', () => setPollerVisibility(false));
  win.on('restore', () => setPollerVisibility(true));

  const devUrl = process.env['ELECTRON_RENDERER_URL'];
  if (devUrl) {
    void win.loadURL(devUrl);
  } else {
    void win.loadFile(path.join(__filename, '../renderer/index.html'));
  }

  return win;
}

app.whenReady().then(() => {
  mainWindow = createWindow();
  registerIpcHandlers(() => mainWindow);
  startPoller(() => mainWindow);

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) mainWindow = createWindow();
  });
});

app.on('window-all-closed', () => {
  stopPoller();
  if (process.platform !== 'darwin') app.quit();
});

app.on('before-quit', () => {
  stopPoller();
});
