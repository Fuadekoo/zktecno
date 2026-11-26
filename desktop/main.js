/**
 * ZK Attendance desktop app.
 *
 * Starts the backend (Express API + device sync + ADMS push receiver) as a child process using
 * Electron's built-in Node, waits until it is ready, then opens the dashboard, which the backend
 * serves on the same port. Closing the app stops the server.
 *
 * Connection settings (MySQL, port) live in <userData>/config.json; the database password is
 * encrypted with the OS key store (safeStorage). Everything else is set on the dashboard's Settings page.
 */
const { app, BrowserWindow, Menu, Tray, dialog, ipcMain, nativeImage, safeStorage, shell } = require('electron');
const { fork } = require('node:child_process');
const crypto = require('node:crypto');
const fs = require('node:fs');
const http = require('node:http');
const path = require('node:path');

// ---------------------------------------------------------------- paths

const ROOT = app.isPackaged ? process.resourcesPath : path.join(__dirname, '..');
const BACKEND_DIR = path.join(ROOT, 'backend');
const SERVER_ENTRY = path.join(BACKEND_DIR, 'dist', 'server.js');
const MIGRATIONS_DIR = path.join(BACKEND_DIR, 'prisma', 'migrations');
const STATIC_DIR = app.isPackaged ? path.join(ROOT, 'frontend') : path.join(ROOT, 'frontend', 'out');

const USER_DIR = app.getPath('userData');
const CONFIG_FILE = path.join(USER_DIR, 'config.json');
const LOG_DIR = path.join(USER_DIR, 'logs');
const LOG_FILE = path.join(LOG_DIR, 'server.log');
const TRAY_ICON = path.join(__dirname, 'assets', 'tray.png');

/** Started by Windows at sign-in: run in the tray without opening a window. */
const START_HIDDEN = process.argv.includes('--hidden');

// ---------------------------------------------------------------- config

const DEFAULTS = { db: { host: '127.0.0.1', port: 3306, user: 'root', password: '', database: 'zkteco_attendance' }, port: 4000 };

function encrypt(text) {
  if (!text) return { plain: '' };
  return safeStorage.isEncryptionAvailable() ? { enc: safeStorage.encryptString(text).toString('base64') } : { plain: text };
}
function decrypt(v) {
  if (!v) return '';
  if (v.enc) {
    try {
      return safeStorage.decryptString(Buffer.from(v.enc, 'base64'));
    } catch {
      return '';
    }
  }
  return v.plain || '';
}

/** Saved config, or null before the first setup. Secrets are decrypted. */
function loadConfig() {
  try {
    const raw = JSON.parse(fs.readFileSync(CONFIG_FILE, 'utf8'));
    return {
      db: { ...DEFAULTS.db, ...raw.db, password: decrypt(raw.db?.password) },
      port: Number(raw.port) || DEFAULTS.port,
      jwtSecret: decrypt(raw.jwtSecret),
      adminPassword: decrypt(raw.adminPassword),
    };
  } catch {
    return null;
  }
}

function readRaw() {
  try {
    return JSON.parse(fs.readFileSync(CONFIG_FILE, 'utf8'));
  } catch {
    return {};
  }
}

/** Small preferences (start with Windows, tray hint shown), kept next to the connection settings. */
function getUi() {
  return { autoStart: null, trayHintShown: false, ...(readRaw().ui || {}) };
}
function setUi(patch) {
  const raw = readRaw();
  raw.ui = { ...getUi(), ...patch };
  fs.mkdirSync(USER_DIR, { recursive: true });
  fs.writeFileSync(CONFIG_FILE, JSON.stringify(raw, null, 2));
}

function saveConfig(cfg) {
  fs.mkdirSync(USER_DIR, { recursive: true });
  const out = {
    ui: readRaw().ui,
    db: { ...cfg.db, password: encrypt(cfg.db.password) },
    port: cfg.port,
    jwtSecret: encrypt(cfg.jwtSecret || crypto.randomBytes(48).toString('hex')),
    ...(cfg.adminPassword && { adminPassword: encrypt(cfg.adminPassword) }),
  };
  fs.writeFileSync(CONFIG_FILE, JSON.stringify(out, null, 2));
}

// ---------------------------------------------------------------- logging

function openLog() {
  fs.mkdirSync(LOG_DIR, { recursive: true });
  try {
    // Keep one previous log; start fresh past 5 MB
    if (fs.statSync(LOG_FILE).size > 5 * 1024 * 1024) fs.renameSync(LOG_FILE, LOG_FILE + '.1');
  } catch {}
  return fs.createWriteStream(LOG_FILE, { flags: 'a' });
}
const log = openLog();
const recent = [];
function writeLog(line) {
  const text = line.replace(/\r?\n$/, '');
  log.write(`${new Date().toISOString()} ${text}\n`);
  recent.push(text);
  if (recent.length > 60) recent.shift();
  if (!app.isPackaged) process.stdout.write(text + '\n');
}

// ---------------------------------------------------------------- database helpers (setup screen)

function mariadb() {
  return require(path.join(BACKEND_DIR, 'node_modules', 'mariadb'));
}

/** A connection to the MySQL server (no database selected). */
function connectServer(db) {
  return mariadb().createConnection({
    host: db.host,
    port: Number(db.port),
    user: db.user,
    password: db.password,
    allowPublicKeyRetrieval: true,
    connectTimeout: 8000,
  });
}

/** Connect to the server; report whether the database exists and whether it already has users. */
async function testDatabase(db) {
  let c;
  try {
    c = await connectServer(db);
  } catch (err) {
    return { ok: false, message: friendlyDbError(err, db) };
  }
  try {
    const exists = (await c.query('SELECT 1 FROM information_schema.schemata WHERE schema_name = ?', [db.database])).length > 0;
    if (!exists) return { ok: true, exists: false, hasUsers: false, message: `Connected. Database “${db.database}” doesn’t exist yet. It will be created.` };
    const table = (await c.query('SELECT 1 FROM information_schema.tables WHERE table_schema = ? AND table_name = ?', [db.database, 'users'])).length > 0;
    const users = table ? Number((await c.query(`SELECT COUNT(*) AS n FROM \`${db.database}\`.users`))[0].n) : 0;
    return { ok: true, exists: true, hasUsers: users > 0, message: users > 0 ? `Connected to “${db.database}” (${users} dashboard user${users === 1 ? '' : 's'}).` : `Connected to “${db.database}” (no users yet).` };
  } catch (err) {
    return { ok: false, message: friendlyDbError(err, db) };
  } finally {
    await c.end().catch(() => {});
  }
}

async function createDatabaseIfMissing(db) {
  if (!/^[A-Za-z0-9_]+$/.test(db.database)) throw new Error('Database name may only contain letters, numbers and underscores');
  const c = await connectServer(db);
  try {
    await c.query(`CREATE DATABASE IF NOT EXISTS \`${db.database}\` DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci`);
  } finally {
    await c.end().catch(() => {});
  }
}

function friendlyDbError(err, db) {
  const m = `${err.code || ''} ${err.message || ''}`;
  if (/ECONNREFUSED/.test(m)) return `MySQL isn’t running at ${db.host}:${db.port}. Install or start MySQL (Windows: Services → MySQL80, or the XAMPP control panel), then try again.`;
  if (/ER_ACCESS_DENIED_ERROR|Access denied/i.test(m)) return `MySQL rejected user “${db.user}” with that password.`;
  if (/ER_NOT_SUPPORTED_AUTH_MODE|authentication plugin/i.test(m)) return `MySQL user “${db.user}” uses a login method this app can’t use. Set it to mysql_native_password or caching_sha2_password.`;
  if (/ER_DBACCESS_DENIED_ERROR|ER_TABLEACCESS_DENIED/i.test(m)) return `MySQL user “${db.user}” isn’t allowed to use database “${db.database}”.`;
  if (/ENOTFOUND|EAI_AGAIN/.test(m)) return `Can’t find the database server “${db.host}”.`;
  if (/timeout|ETIMEDOUT/i.test(m)) return `No answer from ${db.host}:${db.port} (timed out).`;
  return err.message || String(err);
}

// ---------------------------------------------------------------- backend process

let server = null;
let serverPort = null;
let quitting = false;

function startServer(cfg) {
  return new Promise((resolve, reject) => {
    if (!fs.existsSync(SERVER_ENTRY)) return reject(new Error(`Server files are missing (${SERVER_ENTRY}). Run “npm run build:app” in the desktop folder.`));
    recent.length = 0;
    writeLog(`[desktop] Starting server on port ${cfg.port}`);
    const child = fork(SERVER_ENTRY, [], {
      cwd: USER_DIR, // no stray .env is picked up
      stdio: ['ignore', 'pipe', 'pipe', 'ipc'],
      env: {
        ...process.env,
        ELECTRON_RUN_AS_NODE: '1',
        NODE_ENV: 'production',
        HOST: '0.0.0.0', // devices push to this PC over the network (ADMS)
        PORT: String(cfg.port),
        STATIC_DIR,
        RUN_MIGRATIONS: 'true',
        MIGRATIONS_DIR,
        COOKIE_SECURE: 'false', // plain http on localhost / local network
        CORS_ORIGIN: `http://localhost:${cfg.port}`,
        DB_HOST: cfg.db.host,
        DB_PORT: String(cfg.db.port),
        DB_USER: cfg.db.user,
        DB_PASSWORD: cfg.db.password,
        DB_NAME: cfg.db.database,
        APP_JWT_SECRET: cfg.jwtSecret,
        ...(cfg.adminPassword && { ADMIN_USERNAME: 'admin', ADMIN_PASSWORD: cfg.adminPassword }),
      },
    });
    server = child;
    let ready = false;
    const timer = setTimeout(() => {
      if (!ready) {
        child.kill();
        reject(new Error('The server did not start within 90 seconds.'));
      }
    }, 90_000);

    const pipe = (stream) => {
      let buf = '';
      stream.setEncoding('utf8');
      stream.on('data', (chunk) => {
        buf += chunk;
        const lines = buf.split(/\r?\n/);
        buf = lines.pop();
        for (const l of lines) if (l.trim()) writeLog(l);
      });
    };
    pipe(child.stdout);
    pipe(child.stderr);

    child.on('message', (msg) => {
      if (msg && msg.type === 'ready' && !ready) {
        ready = true;
        clearTimeout(timer);
        serverPort = msg.port;
        resolve(msg.port);
      }
    });
    child.on('exit', (code, signal) => {
      clearTimeout(timer);
      writeLog(`[desktop] Server stopped (${signal || `exit code ${code}`})`);
      if (server === child) server = null;
      if (!ready) reject(new Error(explainStartupFailure(cfg)));
      else if (!quitting) onServerCrash();
    });
  });
}

/** Turn the last log lines into one sentence for the setup screen. */
function explainStartupFailure(cfg) {
  const text = recent.join('\n');
  if (/EADDRINUSE|already in use/i.test(text) && new RegExp(`\\b${cfg.port}\\b`).test(text)) {
    return `Port ${cfg.port} is already used by another program (maybe the dashboard is already running, or “npm run dev”). Close it or pick another port below.`;
  }
  const db = recent.filter((l) => l.startsWith('[db]')).pop();
  if (db) return db.replace(/^\[db\]\s*/, '');
  const last = recent.filter((l) => /error|fail/i.test(l)).pop() || recent[recent.length - 1];
  return last || 'The server stopped during startup. See the log file for details.';
}

function stopServer() {
  return new Promise((resolve) => {
    const child = server;
    if (!child) return resolve();
    const t = setTimeout(() => {
      child.kill('SIGKILL');
      resolve();
    }, 8000);
    child.once('exit', () => {
      clearTimeout(t);
      resolve();
    });
    // Ask for a clean shutdown (closes ports and the database pool)
    if (child.connected) child.send({ type: 'shutdown' });
    else child.kill();
  });
}

function waitForHealth(port, timeoutMs = 15_000) {
  const until = Date.now() + timeoutMs;
  return new Promise((resolve) => {
    const tryOnce = () => {
      const req = http.get({ host: '127.0.0.1', port, path: '/api/health', timeout: 2000 }, (res) => {
        res.resume();
        if (res.statusCode === 200) resolve(true);
        else retry();
      });
      req.on('error', retry);
      req.on('timeout', () => req.destroy());
    };
    const retry = () => (Date.now() > until ? resolve(false) : setTimeout(tryOnce, 300));
    tryOnce();
  });
}

// ---------------------------------------------------------------- windows

let mainWin = null;
let tray = null;
/** Window shown at least once (false while running hidden after a Windows sign-in start). */
let shownOnce = false;
let setupWin = null;
let setupState = { error: null };

const ICON = fs.existsSync(TRAY_ICON) ? nativeImage.createFromPath(TRAY_ICON) : undefined;

function showLoading() {
  if (!mainWin) createMainWindow();
  if (START_HIDDEN && !shownOnce) return;
  showWindow();
  mainWin.loadURL(
    'data:text/html;charset=utf-8,' +
      encodeURIComponent(`<!doctype html><html><body style="margin:0;height:100vh;display:flex;align-items:center;justify-content:center;font-family:Segoe UI,system-ui,sans-serif;background:#f8fafc;color:#334155">
      <div style="text-align:center"><div style="width:36px;height:36px;margin:0 auto 16px;border:4px solid #cbd5e1;border-top-color:#16a34a;border-radius:50%;animation:s 1s linear infinite"></div>
      <div style="font-size:15px">Starting ZK Attendance…</div><div style="font-size:12px;color:#94a3b8;margin-top:6px">Connecting to the database and devices</div></div>
      <style>@keyframes s{to{transform:rotate(360deg)}}</style></body></html>`),
  );
}

function createMainWindow() {
  mainWin = new BrowserWindow({
    width: 1360,
    height: 860,
    minWidth: 960,
    minHeight: 600,
    show: false,
    title: 'ZK Attendance',
    icon: ICON,
    backgroundColor: '#f8fafc',
    webPreferences: { contextIsolation: true, nodeIntegration: false, sandbox: true },
  });
  // Closing the window keeps the server running in the tray (devices keep sending punches)
  mainWin.on('close', (e) => {
    if (quitting) return;
    e.preventDefault();
    mainWin.hide();
    if (!getUi().trayHintShown && tray) {
      tray.displayBalloon({ title: 'ZK Attendance is still running', content: 'It keeps receiving punches in the background. Right-click the tray icon to open or quit.', iconType: 'info' });
      setUi({ trayHintShown: true });
    }
  });
  // Links to other sites open in the normal browser
  mainWin.webContents.setWindowOpenHandler(({ url }) => {
    if (!url.startsWith(`http://127.0.0.1:${serverPort}`) && !url.startsWith(`http://localhost:${serverPort}`)) shell.openExternal(url);
    return { action: 'deny' };
  });
  mainWin.webContents.on('will-navigate', (e, url) => {
    if (url.startsWith('data:') || url.startsWith(`http://127.0.0.1:${serverPort}`) || url.startsWith(`http://localhost:${serverPort}`)) return;
    e.preventDefault();
    shell.openExternal(url);
  });
  // CSV exports: save to Downloads with a normal "Save as" prompt
  mainWin.webContents.session.on('will-download', (_e, item) => {
    item.setSaveDialogOptions({ defaultPath: path.join(app.getPath('downloads'), item.getFilename()) });
  });
  mainWin.on('closed', () => (mainWin = null));
}

function openSetup(error) {
  setupState = { error: error || null };
  if (setupWin) {
    setupWin.webContents.send('setup:state', setupState);
    setupWin.focus();
    return;
  }
  setupWin = new BrowserWindow({
    width: 620,
    height: 760,
    resizable: false,
    title: 'ZK Attendance: connection settings',
    icon: ICON,
    parent: mainWin && mainWin.isVisible() ? mainWin : undefined,
    modal: Boolean(mainWin && mainWin.isVisible()),
    autoHideMenuBar: true,
    backgroundColor: '#f8fafc',
    webPreferences: { preload: path.join(__dirname, 'preload.js'), contextIsolation: true, nodeIntegration: false, sandbox: true },
  });
  setupWin.loadFile(path.join(__dirname, 'setup.html'));
  setupWin.on('closed', () => {
    setupWin = null;
    // Closed the first-run setup without saving: nothing to show, so quit
    if (!server && !quitting) app.quit();
  });
}

// ---------------------------------------------------------------- start / restart

async function boot() {
  const cfg = loadConfig();
  if (!cfg) return openSetup(null);
  showLoading();
  try {
    const port = await startServer(cfg);
    await waitForHealth(port);
    // The first admin was created from the setup screen: don't keep that password around
    if (cfg.adminPassword) saveConfig({ ...cfg, adminPassword: '' });
    if (setupWin) setupWin.destroy();
    if (!mainWin) createMainWindow();
    await mainWin.loadURL(`http://localhost:${port}/`);
    if (!START_HIDDEN || shownOnce) showWindow();
    buildMenu();
    buildTray();
    enableAutoStartOnce();
  } catch (err) {
    writeLog(`[desktop] Startup failed: ${err.message}`);
    if (mainWin) mainWin.hide();
    openSetup(err.message);
  }
}

async function restart() {
  await stopServer();
  await boot();
}

/** Recent crash times: up to 3 in 10 minutes are restarted silently, more than that asks the user. */
const crashes = [];
async function onServerCrash() {
  const now = Date.now();
  while (crashes.length && now - crashes[0] > 10 * 60_000) crashes.shift();
  crashes.push(now);
  if (crashes.length <= 3) {
    writeLog(`[desktop] Restarting the server automatically (${crashes.length}/3)`);
    setTimeout(() => boot(), 3000);
    return;
  }
  showWindow();
  const r = await dialog.showMessageBox(mainWin, {
    type: 'error',
    title: 'Server stopped',
    message: 'The attendance server stopped unexpectedly.',
    detail: recent.slice(-6).join('\n') || 'See the log file for details.',
    buttons: ['Restart server', 'Open log folder', 'Quit'],
    defaultId: 0,
  });
  if (r.response === 0) await boot();
  else if (r.response === 1) {
    shell.openPath(LOG_DIR);
    await boot();
  } else app.quit();
}

function showWindow() {
  if (!mainWin) createMainWindow();
  if (mainWin.isMinimized()) mainWin.restore();
  mainWin.show();
  mainWin.focus();
  shownOnce = true;
}

// ---------------------------------------------------------------- tray + start with Windows

/** Start with Windows only for the installed app (in development it would register electron.exe). */
const canAutoStart = app.isPackaged && process.platform === 'win32';

function isAutoStart() {
  return canAutoStart && app.getLoginItemSettings({ args: ['--hidden'] }).openAtLogin;
}
function setAutoStart(on) {
  if (!canAutoStart) return;
  app.setLoginItemSettings({ openAtLogin: on, args: ['--hidden'] });
  setUi({ autoStart: on });
}
/** First successful start after install: turn "Start with Windows" on (it can be turned off in the tray menu). */
function enableAutoStartOnce() {
  if (canAutoStart && getUi().autoStart === null) setAutoStart(true);
}

function autoStartItem() {
  return {
    label: 'Start with Windows',
    type: 'checkbox',
    checked: isAutoStart(),
    enabled: canAutoStart,
    click: (item) => {
      setAutoStart(item.checked);
      buildTray();
      buildMenu();
    },
  };
}

function buildTray() {
  if (!tray) {
    tray = new Tray(ICON ? ICON.resize({ width: 16, height: 16 }) : nativeImage.createEmpty());
    tray.on('click', showWindow);
    tray.on('double-click', showWindow);
  }
  tray.setToolTip(serverPort ? `ZK Attendance: running on port ${serverPort}` : 'ZK Attendance');
  tray.setContextMenu(
    Menu.buildFromTemplate([
      { label: 'Open ZK Attendance', click: showWindow },
      { label: 'Open in browser', enabled: Boolean(serverPort), click: () => shell.openExternal(`http://localhost:${serverPort}/`) },
      { type: 'separator' },
      autoStartItem(),
      { label: 'Restart server', click: () => restart() },
      { label: 'Connection settings…', click: () => openSetup(null) },
      { label: 'Open log folder', click: () => shell.openPath(LOG_DIR) },
      { type: 'separator' },
      { label: 'Quit (stops receiving punches)', click: () => app.quit() },
    ]),
  );
}

// ---------------------------------------------------------------- IPC (setup screen)

ipcMain.handle('setup:get', () => {
  const cfg = loadConfig() || { ...DEFAULTS, db: { ...DEFAULTS.db } };
  // The password is never sent to the page; it can only be replaced
  return { db: { ...cfg.db, password: '' }, passwordSet: Boolean(cfg.db.password), port: cfg.port, error: setupState.error, logFile: LOG_FILE };
});

ipcMain.handle('setup:test', async (_e, form) => testDatabase(withSavedPassword(form).db));

ipcMain.handle('setup:save', async (_e, form) => {
  const db = withSavedPassword(form).db;
  const port = Number(form.port);
  if (!Number.isInteger(port) || port < 1 || port > 65535) return { ok: false, message: 'Pick a port between 1 and 65535.' };
  const check = await testDatabase({ ...db });
  if (!check.ok) return check;
  if (!check.hasUsers && (!form.adminPassword || form.adminPassword.length < 8)) {
    return { ok: false, needsAdmin: true, message: 'This is a new database: choose a password (at least 8 characters) for the first “admin” account.' };
  }
  try {
    await createDatabaseIfMissing(db);
  } catch (err) {
    return { ok: false, message: friendlyDbError(err, db) };
  }
  const old = loadConfig();
  saveConfig({ db, port, jwtSecret: old?.jwtSecret, adminPassword: check.hasUsers ? '' : form.adminPassword });
  setImmediate(restart);
  return { ok: true };
});

ipcMain.handle('setup:openLogs', () => shell.openPath(LOG_DIR));

/** An empty password field means "keep the saved one". */
function withSavedPassword(form) {
  const saved = loadConfig();
  const db = { host: String(form.db.host || '').trim(), port: Number(form.db.port) || 3306, user: String(form.db.user || '').trim(), password: form.db.password, database: String(form.db.database || '').trim() };
  if (!db.password && saved) db.password = saved.db.password;
  return { db };
}

// ---------------------------------------------------------------- menu

function buildMenu() {
  const url = () => `http://localhost:${serverPort}/`;
  Menu.setApplicationMenu(
    Menu.buildFromTemplate([
      {
        label: 'App',
        submenu: [
          { label: 'Open dashboard in browser', click: () => serverPort && shell.openExternal(url()) },
          { label: 'Connection settings…', click: () => openSetup(null) },
          { label: 'Restart server', click: () => restart() },
          { label: 'Open log folder', click: () => shell.openPath(LOG_DIR) },
          autoStartItem(),
          { type: 'separator' },
          { label: 'Hide to tray (keeps running)', accelerator: 'CmdOrCtrl+W', click: () => mainWin && mainWin.hide() },
          { label: 'Quit (stops receiving punches)', accelerator: 'CmdOrCtrl+Q', click: () => app.quit() },
        ],
      },
      { label: 'Edit', submenu: [{ role: 'undo' }, { role: 'redo' }, { type: 'separator' }, { role: 'cut' }, { role: 'copy' }, { role: 'paste' }, { role: 'selectAll' }] },
      {
        label: 'View',
        submenu: [{ role: 'reload' }, { role: 'forceReload' }, { type: 'separator' }, { role: 'resetZoom' }, { role: 'zoomIn' }, { role: 'zoomOut' }, { type: 'separator' }, { role: 'togglefullscreen' }, { role: 'toggleDevTools' }],
      },
      {
        label: 'Help',
        submenu: [
          {
            label: 'About',
            click: () =>
              dialog.showMessageBox(mainWin, {
                type: 'info',
                title: 'ZK Attendance',
                message: `ZK Attendance ${app.getVersion()}`,
                detail: `Dashboard: ${url()}\nOther PCs and phones on your network can open http://<this PC's IP>:${serverPort}/\n\nData folder: ${USER_DIR}`,
              }),
          },
        ],
      },
    ]),
  );
}

// ---------------------------------------------------------------- app lifecycle

if (!app.requestSingleInstanceLock()) {
  // Already running: the other instance shows its window
  app.quit();
} else {
  // Opening the app again (shortcut, Start menu) while it runs in the tray: show the window
  app.on('second-instance', () => {
    if (setupWin) return setupWin.focus();
    if (serverPort) showWindow();
  });

  app.whenReady().then(() => {
    Menu.setApplicationMenu(null);
    boot();
  });

  // The main window only hides; the app and the server keep running in the tray until "Quit"
  app.on('window-all-closed', () => {
    if (!server && !setupWin) app.quit();
  });

  app.on('before-quit', (e) => {
    if (quitting) return;
    quitting = true;
    if (!server) return;
    e.preventDefault();
    stopServer().finally(() => app.quit());
  });
}
