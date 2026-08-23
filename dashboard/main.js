/* global process */
import { app, BrowserWindow, Tray, Menu, nativeImage, Notification } from 'electron';
import path from 'path';
import { fileURLToPath } from 'url';
import http from 'http';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

app.commandLine.appendSwitch('no-sandbox');

let mainWindow = null;
let tray = null;

function createWindow() {
  mainWindow = new BrowserWindow({
    width: 1400,
    height: 900,
    minWidth: 1024,
    minHeight: 768,
    frame: false, // Frame is stripped away! We use React custom drag regions!
    transparent: true,
    visualEffectState: "active",
    vibrancy: "under-window", // MacOS darkmode acrylic fallback if ported
    webPreferences: {
      nodeIntegration: false,
      contextIsolation: true
    },
    titleBarStyle: 'hidden',
    backgroundColor: '#00000000'
  });

  const isDev = process.env.NODE_ENV === 'development';
  if (isDev) {
    mainWindow.loadURL('http://localhost:5173');
    // mainWindow.webContents.openDevTools();
  } else {
    mainWindow.loadFile(path.join(__dirname, 'dist', 'index.html'));
  }

  mainWindow.on('close', (e) => {
    // Minimize to tray instead of quitting
    if (tray) {
      e.preventDefault();
      mainWindow.hide();
    }
  });
}

// ══════════════════════════════════════════
// ██  OPTION C: System Tray Mini-Widget
// ══════════════════════════════════════════

function createTray() {
  // Create a simple 16x16 tray icon using nativeImage
  const icon = nativeImage.createFromBuffer(
    Buffer.from(
      'iVBORw0KGgoAAAANSUhEUgAAABAAAAAQCAYAAAAf8/9hAAAAOklEQVQ4y2P4z8BQz0BFQM/AwMDMQEXAxMBAbcBEbcBCbcBKbcBGbeDfv3//qQlYGKgNWKgN2P8DAKVsCv33NmlqAAAAAElFTkSuQmCC',
      'base64'
    )
  );

  tray = new Tray(icon);
  tray.setToolTip('ThermNexus — AI Thermal Control');

  // Poll API for tooltip updates
  setInterval(() => {
    fetchMetrics((data) => {
      if (data) {
        tray.setToolTip(
          `ThermNexus\n` +
          `CPU: ${data.cpu_temp || '—'}°C | GPU: ${data.gpu_temp || '—'}°C\n` +
          `Fan: ${data.pwm ? Math.round((data.pwm / 255) * 100) : '—'}% | AI Steps: ${data.steps || 0}`
        );
      }
    });
  }, 5000);

  updateTrayMenu();
}

function updateTrayMenu() {
  const contextMenu = Menu.buildFromTemplate([
    { label: '🌡️ Open Dashboard', click: () => { mainWindow.show(); mainWindow.focus(); } },
    { type: 'separator' },
    {
      label: '❄️ Cryo-Boost (30s)',
      click: () => {
        postApi('/action/cryoboost', { duration: 30 }, () => {
          showNotification('Cryo-Boost Engaged', 'Fans at 100% for 30 seconds. Building thermal buffer.');
        });
      }
    },
    {
      label: '🔇 Toggle Acoustic Mode',
      click: () => {
        // Read current state and toggle
        getApi('/config/acoustic', () => {}); // Best effort toggle
        postApi('/config/acoustic', { enabled: true }, () => {
          showNotification('Acoustic Mode', 'Fan smoothing toggled.');
        });
      }
    },
    { type: 'separator' },
    {
      label: app.getLoginItemSettings().openAtLogin ? '✓ Launch on Startup' : 'Launch on Startup',
      click: () => {
        const settings = app.getLoginItemSettings();
        app.setLoginItemSettings({
          openAtLogin: !settings.openAtLogin,
          path: app.getPath('exe')
        });
        updateTrayMenu();
        showNotification('Startup Settings', `ThermNexus will ${!settings.openAtLogin ? 'now' : 'no longer'} start on boot.`);
      }
    },
    { type: 'separator' },
    { label: '🔴 Quit ThermNexus', click: () => { tray.destroy(); app.exit(); } }
  ]);

  tray.setContextMenu(contextMenu);
}

function showNotification(title, body) {
  if (Notification.isSupported()) {
    new Notification({ title, body, icon: null }).show();
  }
}

function fetchMetrics(callback) {
  getApi('/ai/metrics', (data) => {
    callback(data?.data || null);
  });
}

function getApi(endpoint, callback) {
  http.get(`http://localhost:8889${endpoint}`, (res) => {
    let body = '';
    res.on('data', (chunk) => body += chunk);
    res.on('end', () => {
      try { callback(JSON.parse(body)); } catch { callback(null); }
    });
  }).on('error', () => callback(null));
}

function postApi(endpoint, data, callback) {
  const postData = JSON.stringify(data);
  const req = http.request({
    hostname: 'localhost', port: 8889, path: endpoint,
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(postData) }
  }, (res) => {
    let body = '';
    res.on('data', (chunk) => body += chunk);
    res.on('end', () => { try { callback(JSON.parse(body)); } catch { callback(null); } });
  });
  req.on('error', () => callback(null));
  req.write(postData);
  req.end();
}

// ══════════════════════════════════════════
// ██  APP LIFECYCLE
// ══════════════════════════════════════════

app.whenReady().then(() => {
  createWindow();
  createTray();

  app.on('activate', function () {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
});

app.on('window-all-closed', function () {
  if (process.platform !== 'darwin') {
    // Don't quit if tray is active
    if (!tray) app.quit();
  }
});
