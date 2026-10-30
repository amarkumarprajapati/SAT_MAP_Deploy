const { app, BrowserWindow, Menu } = require('electron');
const { spawn } = require('child_process');
const path = require('path');
const fs = require('fs');
const net = require('net');
const http = require('http');

// Paths relative to the installed base folder
const BASE_DIR = app.isPackaged
  ? process.resourcesPath
  : path.resolve(__dirname, '..', 'SAT_Build', 'internal', 'dist');

const DATA_DIR = path.join(BASE_DIR, 'data');
const BACKEND_EXE = path.join(BASE_DIR, 'backend', 'backend.exe');
const OSINT_ENTRY = path.join(BASE_DIR, 'osint', 'dist', 'main.js');
const FRONTEND_DIR = path.join(BASE_DIR, 'frontend');
const NODE_EXE = path.join(BASE_DIR, 'node', 'node.exe');

const FRONTEND_PORT = 7890;
const BACKEND_PORT = 8569;
const OSINT_PORT = 15673;

const managedProcesses = [];
let mainWindow = null;
let isShuttingDown = false;
const startupStatus = { osint: 'Waiting', backend: 'Waiting', frontend: 'Waiting' };

function renderStartupPage(errorMessage = '') {
  if (!mainWindow || mainWindow.isDestroyed()) return;
  const rows = Object.entries(startupStatus).map(([name, status]) => {
    const ready = status === 'Ready' || status === 'Optional';
    const statusClass = status === 'Failed' ? 'failed' : (ready ? 'ready' : 'pending');
    return `<div class="row"><span>${name}</span><b class="${statusClass}">${status}</b></div>`;
  }).join('');
  const html = `<!doctype html><html><head><meta charset="utf-8"><style>
    *{box-sizing:border-box}body{margin:0;background:#090d16;color:#e5e7eb;font:15px Segoe UI,Arial,sans-serif;display:grid;place-items:center;min-height:100vh}
    main{width:min(560px,90vw);padding:36px;border:1px solid #263244;border-radius:16px;background:#111827;box-shadow:0 24px 80px #0008}
    h1{font-size:26px;margin:0 0 8px}p{color:#9ca3af;margin:0 0 24px}.row{display:flex;justify-content:space-between;padding:13px 0;border-bottom:1px solid #263244;text-transform:capitalize}.ready{color:#34d399}.pending{color:#fbbf24}.failed{color:#f87171}
    .error{margin-top:20px;padding:14px;border-radius:8px;background:#3b151b;color:#fecaca;white-space:pre-wrap;overflow-wrap:anywhere}
    </style></head><body><main><h1>SAT Map</h1><p>Starting and checking local services. This window will open the map when they are ready.</p>${rows}${errorMessage ? `<div class="error">${String(errorMessage).replace(/[&<>"']/g, (c) => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]))}</div>` : ''}</main></body></html>`;
  mainWindow.loadURL(`data:text/html;charset=utf-8,${encodeURIComponent(html)}`);
}

function setStartupStatus(service, status) {
  startupStatus[service] = status;
  renderStartupPage();
}

function checkPortOpen(port, host = '127.0.0.1') {
  return new Promise((resolve) => {
    const socket = new net.Socket();
    socket.setTimeout(800);
    socket.once('connect', () => {
      socket.destroy();
      resolve(true);
    });
    socket.once('error', () => {
      socket.destroy();
      resolve(false);
    });
    socket.once('timeout', () => {
      socket.destroy();
      resolve(false);
    });
    socket.connect(port, host);
  });
}

function checkHttpReady(port, route = '/') {
  return new Promise((resolve) => {
    const request = http.get({ hostname: '127.0.0.1', port, path: route, timeout: 2500 }, (response) => {
      response.resume();
      resolve(response.statusCode >= 200 && response.statusCode < 400);
    });
    request.once('timeout', () => { request.destroy(); resolve(false); });
    request.once('error', () => resolve(false));
  });
}

async function waitForHttp(port, route, timeoutMs = 45000) {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    if (await checkHttpReady(port, route)) return;
    await new Promise((resolve) => setTimeout(resolve, 600));
  }
  throw new Error(`Service did not become ready at http://127.0.0.1:${port}${route}`);
}

async function startOsint() {
  setStartupStatus('osint', 'Starting...');
  const alreadyRunning = await checkPortOpen(OSINT_PORT);
  if (alreadyRunning) {
    console.log(`[SAT] OSINT service already running on port ${OSINT_PORT}`);
    await waitForHttp(OSINT_PORT, '/osint/status');
    setStartupStatus('osint', 'Ready');
    return;
  }

  if (fs.existsSync(OSINT_ENTRY) && fs.existsSync(NODE_EXE)) {
    console.log(`[SAT] Launching OSINT service on port ${OSINT_PORT}...`);
    const proc = spawn(NODE_EXE, [OSINT_ENTRY], {
      cwd: path.join(BASE_DIR, 'osint'),
      env: { ...process.env, PORT: String(OSINT_PORT), OSINT_POLL_ENABLED: 'true' },
      stdio: 'ignore',
      windowsHide: true,
    });
    managedProcesses.push({ type: 'child', process: proc, name: 'OSINT' });
    await waitForHttp(OSINT_PORT, '/osint/status');
    setStartupStatus('osint', 'Ready');
  } else if (await checkPortOpen(OSINT_PORT)) {
    setStartupStatus('osint', 'Ready');
  } else {
    throw new Error(`OSINT service files or bundled Node runtime are missing: ${OSINT_ENTRY}`);
  }
}

async function startBackend() {
  setStartupStatus('backend', 'Starting...');
  const alreadyRunning = await checkPortOpen(BACKEND_PORT);
  if (alreadyRunning) {
    console.log(`[SAT] Backend already running on port ${BACKEND_PORT}`);
    await waitForHttp(BACKEND_PORT, '/api/health');
    setStartupStatus('backend', 'Ready');
    return;
  }

  if (fs.existsSync(BACKEND_EXE)) {
    console.log(`[SAT] Launching Backend on port ${BACKEND_PORT}...`);
    const env = {
      ...process.env,
      APP_ENV: 'development',
      HOST: '127.0.0.1',
      PORT: String(BACKEND_PORT),
      DATABASE_HOST: '',
      DATABASE_NAME: '',
      DATABASE_USER: '',
      DATABASE_PASSWORD: '',
      LEGACY_DATABASE_PATH: path.join(DATA_DIR, 'sat_map.sqlite3'),
      DATABASE_REQUIRED: 'false',
      CORS_ORIGINS: `http://127.0.0.1:${FRONTEND_PORT},http://localhost:${FRONTEND_PORT}`,
      OSINT_SERVICE_URL: `http://127.0.0.1:${OSINT_PORT}`,
    };

    const proc = spawn(BACKEND_EXE, [], {
      cwd: path.dirname(BACKEND_EXE),
      env,
      stdio: 'ignore',
      windowsHide: true,
    });
    managedProcesses.push({ type: 'child', process: proc, name: 'Backend' });
    await waitForHttp(BACKEND_PORT, '/api/health');
    setStartupStatus('backend', 'Ready');
  } else if (await checkPortOpen(BACKEND_PORT)) {
    setStartupStatus('backend', 'Ready');
  } else {
    throw new Error(`Backend executable is missing: ${BACKEND_EXE}`);
  }
}

async function startFrontend() {
  setStartupStatus('frontend', 'Starting...');
  const alreadyRunning = await checkPortOpen(FRONTEND_PORT);
  if (alreadyRunning) {
    console.log(`[SAT] Frontend already running on port ${FRONTEND_PORT}`);
    await waitForHttp(FRONTEND_PORT, '/');
    setStartupStatus('frontend', 'Ready');
    return;
  }

  const serverJs = path.join(FRONTEND_DIR, 'server.js');
  if (fs.existsSync(serverJs)) {
    console.log(`[SAT] Launching Next.js frontend on port ${FRONTEND_PORT}...`);
    const nodeBinary = fs.existsSync(NODE_EXE) ? NODE_EXE : 'node';
    const proc = spawn(nodeBinary, ['server.js'], {
      cwd: FRONTEND_DIR,
      env: {
        ...process.env,
        NODE_ENV: 'production',
        PORT: String(FRONTEND_PORT),
        HOSTNAME: '127.0.0.1',
        FASTAPI_URL: `http://127.0.0.1:${BACKEND_PORT}`,
      },
      stdio: 'ignore',
      windowsHide: true,
    });
    managedProcesses.push({ type: 'child', process: proc, name: 'Frontend' });
    await waitForHttp(FRONTEND_PORT, '/');
    setStartupStatus('frontend', 'Ready');
  } else if (await checkPortOpen(FRONTEND_PORT)) {
    setStartupStatus('frontend', 'Ready');
  } else {
    throw new Error(`Frontend server is missing: ${serverJs}`);
  }
}

function shutdownAll() {
  if (isShuttingDown) return;
  isShuttingDown = true;
  console.log('[SAT] Gracefully stopping all services...');

  for (const item of managedProcesses) {
    try {
      if (item.type === 'child' && item.process && !item.process.killed) {
        item.process.kill('SIGTERM');
      }
    } catch (err) {
      console.warn(`[SAT] Shutdown cleanup error:`, err.message);
    }
  }
}

app.whenReady().then(async () => {
  mainWindow = new BrowserWindow({
    width: 1440,
    height: 900,
    title: 'SAT Map',
    backgroundColor: '#0a0a0a',
    webPreferences: {
      nodeIntegration: false,
      contextIsolation: true,
    },
    show: false,
  });

  Menu.setApplicationMenu(null);

  // Splash screen while services start
  mainWindow.show();
  renderStartupPage();

  try {
    await startOsint();
    await startBackend();
    await startFrontend();

    mainWindow.loadURL(`http://127.0.0.1:${FRONTEND_PORT}`);
  } catch (error) {
    console.error('[SAT] Startup failed:', error);
    for (const [service, status] of Object.entries(startupStatus)) {
      if (status === 'Starting...') setStartupStatus(service, 'Failed');
    }
    renderStartupPage(error.message || 'Unknown startup error.');
    shutdownAll();
  }
});

app.on('window-all-closed', () => {
  shutdownAll();
  app.quit();
});

app.on('before-quit', shutdownAll);
process.on('SIGINT', () => { shutdownAll(); process.exit(); });
process.on('SIGTERM', () => { shutdownAll(); process.exit(); });
