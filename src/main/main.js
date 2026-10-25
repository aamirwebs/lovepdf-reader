// LovePDF Reader and Editor — Electron main process.
// Responsibilities: window + custom app:// protocol, file open/save dialogs, recent files, settings, printing,
// "open with" (file association / second instance), auto-update (GitHub Releases), default-app helper.
const { app, BrowserWindow, dialog, ipcMain, shell, protocol, net, Menu, nativeTheme } = require("electron");
const path = require("node:path");
const fs = require("node:fs");
const fsp = require("node:fs/promises");
const { pathToFileURL } = require("node:url");

const RENDERER = path.join(__dirname, "..", "renderer");
const ROOT = path.join(__dirname, "..", "..");
const isWin = process.platform === "win32";
let win = null; let forceQuit = false; let closingAck = false;
let pendingFiles = [];
let updater = null;

// ---------- settings + recent files (userData/settings.json) ----------
const settingsFile = () => path.join(app.getPath("userData"), "settings.json");
let settingsCache = null;
function loadSettings() { if (settingsCache) return settingsCache; try { settingsCache = JSON.parse(fs.readFileSync(settingsFile(), "utf8")); } catch { settingsCache = {}; } return settingsCache; }
function saveSettings(obj) { settingsCache = { ...loadSettings(), ...obj }; try { fs.mkdirSync(app.getPath("userData"), { recursive: true }); fs.writeFileSync(settingsFile(), JSON.stringify(settingsCache, null, 2)); } catch {} return settingsCache; }
function addRecent(p) {
  if (!p) return; const s = loadSettings(); const list = (s.recent || []).filter((r) => r.path !== p);
  list.unshift({ path: p, name: path.basename(p), at: Date.now() }); saveSettings({ recent: list.slice(0, 20) });
  try { app.addRecentDocument(p); } catch {}
}

// ---------- custom scheme (ES modules + workers + fetch work reliably, unlike file://) ----------
app.commandLine.appendSwitch("disable-quic"); app.commandLine.appendSwitch("disable-http2");
protocol.registerSchemesAsPrivileged([{ scheme: "app", privileges: { standard: true, secure: true, supportFetchAPI: true, stream: true, corsEnabled: true } }]);
function registerProtocol() {
  protocol.handle("app", (req) => {
    const u = new URL(req.url); let p = decodeURIComponent(u.pathname); if (p === "/" || p === "") p = "/index.html";
    const base = p.startsWith("/vendor/") ? ROOT : RENDERER; const file = path.normalize(path.join(base, p));
    if (!file.startsWith(base)) return new Response("Forbidden", { status: 403 });
    return net.fetch(pathToFileURL(file).toString());
  });
}

// ---------- window ----------
function createWindow() {
  const s = loadSettings(); const b = s.bounds || {};
  win = new BrowserWindow({
    width: b.width || 1280, height: b.height || 860, x: b.x, y: b.y, minWidth: 900, minHeight: 600, show: false,
    backgroundColor: nativeTheme.shouldUseDarkColors ? "#111418" : "#f6f8fa", autoHideMenuBar: true, title: "LovePDF Reader and Editor",
    icon: path.join(ROOT, "build", "icon.png"),
    webPreferences: { preload: path.join(__dirname, "preload.js"), contextIsolation: true, nodeIntegration: false, sandbox: false, spellcheck: false },
  });
  if (b.maximized) win.maximize();
  win.loadURL("app://lovepdf/index.html");
  win.once("ready-to-show", () => win.show());
  const saveBounds = () => { if (!win) return; const m = win.isMaximized(); const r = win.getNormalBounds(); saveSettings({ bounds: { ...r, maximized: m } }); };
  win.on("resize", saveBounds); win.on("move", saveBounds);
  // Closing: let the renderer finish first (unsaved-changes prompt, optional promo video), then it calls app:quit(true).
  win.on("close", (e) => { saveBounds(); if (forceQuit || !win || win.webContents.isLoading()) return; e.preventDefault(); send("app-closing", {}); setTimeout(() => { if (!forceQuit && win && !win.isDestroyed() && !closingAck) { forceQuit = true; win.close(); } }, 1500); });
  win.on("closed", () => { win = null; });
  win.webContents.setWindowOpenHandler(({ url }) => { if (/^https?:/.test(url)) shell.openExternal(url); return { action: "deny" }; });
  win.webContents.on("did-finish-load", () => { if (pendingFiles.length) { win.webContents.send("open-files", pendingFiles.splice(0)); } });
  buildMenu();
}
function send(ch, data) { if (win && !win.isDestroyed()) win.webContents.send(ch, data); }
function openPaths(paths, print = false) { const pdfs = paths.filter((p) => /\.pdf$/i.test(p) && fs.existsSync(p)); if (!pdfs.length) return; if (print) pdfs.print = true; if (win && win.webContents && !win.webContents.isLoading()) { send("open-files", pdfs); if (print) send("menu", { cmd: "print", arg: pdfs[0] }); if (win.isMinimized()) win.restore(); win.focus(); } else pendingFiles.push(...pdfs); }
const argvFiles = (argv) => argv.slice(1).filter((a) => /\.pdf$/i.test(a) && !a.startsWith("--"));
const wantsPrint = (argv) => argv.includes("--print");

// ---------- menu (keyboard shortcuts; the bar itself stays hidden) ----------
function buildMenu() {
  const r = (cmd, arg) => () => send("menu", { cmd, arg });
  const tpl = [
    { label: "File", submenu: [
      { label: "Open…", accelerator: "CmdOrCtrl+O", click: r("open") }, { label: "Save", accelerator: "CmdOrCtrl+S", click: r("save") }, { label: "Save As…", accelerator: "CmdOrCtrl+Shift+S", click: r("saveAs") },
      { type: "separator" }, { label: "Print…", accelerator: "CmdOrCtrl+P", click: r("print") }, { type: "separator" }, { label: "Close tab", accelerator: "CmdOrCtrl+W", click: r("closeTab") }, { label: "Exit", role: "quit" } ] },
    { label: "Edit", submenu: [ { label: "Undo", accelerator: "CmdOrCtrl+Z", click: r("undo") }, { label: "Redo", accelerator: "CmdOrCtrl+Y", click: r("redo") }, { type: "separator" }, { role: "copy" }, { role: "selectAll" }, { type: "separator" }, { label: "Find…", accelerator: "CmdOrCtrl+F", click: r("find") } ] },
    { label: "View", submenu: [ { label: "Zoom in", accelerator: "CmdOrCtrl+=", click: r("zoomIn") }, { label: "Zoom out", accelerator: "CmdOrCtrl+-", click: r("zoomOut") }, { label: "Fit width", accelerator: "CmdOrCtrl+0", click: r("fitWidth") }, { label: "Fit page", accelerator: "CmdOrCtrl+1", click: r("fitPage") }, { type: "separator" }, { label: "Rotate", accelerator: "CmdOrCtrl+R", click: r("rotate") }, { label: "Toggle sidebar", accelerator: "F4", click: r("sidebar") }, { label: "Next tab", accelerator: "CmdOrCtrl+Tab", click: r("nextTab") }, { type: "separator" }, { role: "togglefullscreen" }, { label: "Developer tools", accelerator: "F12", click: () => win && win.webContents.toggleDevTools() } ] },
    { label: "Help", submenu: [ { label: "LovePDF.me website", click: () => shell.openExternal("https://www.lovepdf.me/?utm_source=windows-app") }, { label: "Check for updates", click: () => checkUpdates(true) }, { label: "About", click: r("about") } ] },
  ];
  Menu.setApplicationMenu(Menu.buildFromTemplate(tpl));
}

// ---------- auto update (GitHub Releases) ----------
function checkUpdates(manual = false) {
  try {
    if (!app.isPackaged) { if (manual) send("update", { state: "none", manual }); return; }
    if (!updater) {
      const { autoUpdater } = require("electron-updater"); updater = autoUpdater; updater.autoDownload = false; updater.autoInstallOnAppQuit = true;
      updater.on("update-available", (i) => send("update", { state: "available", version: i.version, notes: typeof i.releaseNotes === "string" ? i.releaseNotes : "" }));
      updater.on("update-not-available", () => send("update", { state: "none", manual: updater._manual }));
      updater.on("download-progress", (p) => send("update", { state: "downloading", percent: Math.round(p.percent) }));
      updater.on("update-downloaded", (i) => send("update", { state: "ready", version: i.version }));
      updater.on("error", (e) => send("update", { state: "error", error: String(e && e.message || e), manual: updater._manual }));
    }
    updater._manual = manual; updater.checkForUpdates().catch(() => {});
  } catch (e) { if (manual) send("update", { state: "error", error: e.message, manual }); }
}

// ---------- IPC ----------
ipcMain.handle("dialog:open", async (e, { multi = true } = {}) => { const r = await dialog.showOpenDialog(win, { title: "Open PDF", filters: [{ name: "PDF files", extensions: ["pdf"] }], properties: multi ? ["openFile", "multiSelections"] : ["openFile"] }); return r.canceled ? [] : r.filePaths; });
ipcMain.handle("dialog:openImages", async (e, { multi = false } = {}) => { const r = await dialog.showOpenDialog(win, { title: multi ? "Choose images" : "Choose image", filters: [{ name: "Images", extensions: ["png", "jpg", "jpeg", "webp", "gif", "bmp"] }], properties: multi ? ["openFile", "multiSelections"] : ["openFile"] }); return r.canceled ? [] : r.filePaths; });
ipcMain.handle("dialog:saveAs", async (e, { defaultName = "document.pdf", filters } = {}) => { const r = await dialog.showSaveDialog(win, { title: "Save PDF", defaultPath: path.join(loadSettings().lastDir || app.getPath("documents"), defaultName), filters: filters || [{ name: "PDF", extensions: ["pdf"] }] }); if (r.canceled || !r.filePath) return null; saveSettings({ lastDir: path.dirname(r.filePath) }); return r.filePath; });
ipcMain.handle("dialog:folder", async () => { const r = await dialog.showOpenDialog(win, { title: "Choose folder", properties: ["openDirectory", "createDirectory"] }); return r.canceled ? null : r.filePaths[0]; });
ipcMain.handle("dialog:confirm", async (e, { message, detail = "", buttons = ["OK", "Cancel"] }) => { const r = await dialog.showMessageBox(win, { type: "question", message, detail, buttons, defaultId: 0, cancelId: buttons.length - 1 }); return r.response; });
ipcMain.handle("file:read", async (e, p) => { const buf = await fsp.readFile(p); addRecent(p); return buf; });
ipcMain.handle("file:write", async (e, { path: p, data }) => { await fsp.writeFile(p, Buffer.from(data)); addRecent(p); return true; });
ipcMain.handle("file:exists", async (e, p) => { try { await fsp.access(p); return true; } catch { return false; } });
ipcMain.handle("file:stat", async (e, p) => { try { const s = await fsp.stat(p); return { size: s.size, mtime: s.mtimeMs }; } catch { return null; } });
ipcMain.handle("file:showInFolder", (e, p) => { shell.showItemInFolder(p); return true; });
ipcMain.handle("file:openPath", (e, p) => shell.openPath(p));
ipcMain.handle("recent:get", () => (loadSettings().recent || []).filter((r) => { try { return fs.existsSync(r.path); } catch { return false; } }));
ipcMain.handle("recent:clear", () => { saveSettings({ recent: [] }); app.clearRecentDocuments(); return true; });
ipcMain.handle("settings:get", () => { const { recent, bounds, lastDir, ...rest } = loadSettings(); return rest; });
ipcMain.handle("settings:set", (e, obj) => { saveSettings(obj); if (obj.theme) nativeTheme.themeSource = obj.theme === "system" ? "system" : obj.theme; return true; });
ipcMain.handle("app:info", () => ({ version: app.getVersion(), platform: process.platform, packaged: app.isPackaged, electron: process.versions.electron, chrome: process.versions.chrome, userData: app.getPath("userData"), os: `${require("node:os").type()} ${require("node:os").release()}`, locale: app.getLocale(), arch: process.arch }));
ipcMain.handle("app:quit", (e, force = false) => { forceQuit = true; if (win && !win.isDestroyed()) win.close(); else app.quit(); return true; });
ipcMain.handle("app:closingAck", () => { closingAck = true; return true; });
ipcMain.handle("app:cancelClose", () => { closingAck = false; forceQuit = false; return true; });
ipcMain.handle("window:fullscreen", (e, v) => { if (!win) return false; win.setFullScreen(v == null ? !win.isFullScreen() : !!v); return win.isFullScreen(); });
ipcMain.handle("window:devtools", () => { if (win) win.webContents.toggleDevTools(); return true; });
ipcMain.handle("window:zoomFactor", (e, f) => { if (win && f) win.webContents.setZoomFactor(Math.max(0.6, Math.min(2, +f))); return win ? win.webContents.getZoomFactor() : 1; });
ipcMain.handle("app:openExternal", (e, url) => { if (/^(https?|mailto):/.test(url)) shell.openExternal(url); return true; });
ipcMain.handle("app:isFirstRun", () => { const s = loadSettings(); if (s.firstRunDone) return false; saveSettings({ firstRunDone: true }); return true; });
ipcMain.handle("app:setDefault", async () => {
  // Windows 10/11 only let the user pick the default app in Settings; the installer already registered .pdf for us.
  // The installer registers "LovePDF Reader" under HKCU/HKLM\Software\RegisteredApplications (build/installer.nsh),
  // so this deep link opens Settings ▸ Default apps ▸ LovePDF Reader directly. Per-machine installs use the other key.
  if (isWin) {
    const perMachine = /^[A-Za-z]:\\Program Files/i.test(process.execPath);
    const url = `ms-settings:defaultapps?${perMachine ? "registeredAppMachine" : "registeredAppUser"}=LovePDF Reader`;
    try { await shell.openExternal(url); } catch { try { await shell.openExternal("ms-settings:defaultapps"); } catch {} }
    return "settings";
  }
  return "unsupported";
});
ipcMain.handle("app:print", async (e, opts = {}) => new Promise((resolve) => { if (!win) return resolve(false); win.webContents.print({ silent: false, printBackground: true, ...opts }, (ok, reason) => resolve(ok ? true : reason || false)); }));
ipcMain.handle("app:printToPdf", async (e, opts = {}) => { if (!win) return null; const data = await win.webContents.printToPDF({ printBackground: true, ...opts }); return data; });
ipcMain.handle("net:fetch", async (e, { url, method = "GET", headers = {}, body = null }) => {
  if (!/^https:\/\//i.test(String(url))) throw new Error("Only https URLs are allowed");
  // Node's fetch (undici) — avoids Chromium network-stack issues such as ERR_QUIC_PROTOCOL_ERROR behind Cloudflare.
  const doFetch = async (impl) => { const r = await impl(url, { method, headers, body: body ? Buffer.from(body) : undefined, redirect: "follow" }); const buf = Buffer.from(await r.arrayBuffer()); return { ok: r.ok, status: r.status, headers: Object.fromEntries(r.headers.entries()), body: buf }; };
  try { return await doFetch(globalThis.fetch); } catch (e1) { try { return await doFetch(net.fetch); } catch (e2) { throw new Error((e1 && e1.cause && e1.cause.message) || e1.message || String(e2)); } }
});
ipcMain.handle("update:check", () => { checkUpdates(true); return true; });
ipcMain.handle("update:download", () => { if (updater) updater.downloadUpdate().catch((err) => send("update", { state: "error", error: err.message })); return true; });
ipcMain.handle("update:install", () => { if (updater) updater.quitAndInstall(false, true); return true; });
ipcMain.handle("window:title", (e, t) => { if (win) win.setTitle(t ? `${t} — LovePDF Reader` : "LovePDF Reader and Editor"); return true; });
ipcMain.handle("window:setDocumentEdited", (e, v) => { if (win) win.setDocumentEdited(!!v); return true; });

// ---------- lifecycle ----------
const gotLock = app.requestSingleInstanceLock();
if (!gotLock) { app.quit(); } else {
  app.on("second-instance", (e, argv) => { openPaths(argvFiles(argv), wantsPrint(argv)); if (win) { if (win.isMinimized()) win.restore(); win.focus(); } });
  app.on("open-file", (e, p) => { e.preventDefault(); openPaths([p]); });
  app.whenReady().then(() => {
    const s = loadSettings(); if (s.theme && s.theme !== "system") nativeTheme.themeSource = s.theme;
    registerProtocol(); createWindow(); openPaths(argvFiles(process.argv), wantsPrint(process.argv));
    setTimeout(() => checkUpdates(false), 8000);
    app.on("activate", () => { if (BrowserWindow.getAllWindows().length === 0) createWindow(); });
  });
  app.on("window-all-closed", () => { if (process.platform !== "darwin") app.quit(); });
}
