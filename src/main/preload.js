// Bridge between the sandboxed UI and the main process (contextIsolation on; only these functions are exposed).
const { contextBridge, ipcRenderer, webUtils } = require("electron");
const inv = (ch, ...a) => ipcRenderer.invoke(ch, ...a);
const listeners = { "open-files": [], menu: [], update: [], "app-closing": [] };
for (const ch of Object.keys(listeners)) ipcRenderer.on(ch, (e, data) => listeners[ch].forEach((fn) => { try { fn(data); } catch (err) { console.error(err); } }));
contextBridge.exposeInMainWorld("lovepdf", {
  isDesktop: true,
  openDialog: (multi = true) => inv("dialog:open", { multi }),
  openImageDialog: (multi = false) => inv("dialog:openImages", { multi }),
  saveAsDialog: (defaultName, filters) => inv("dialog:saveAs", { defaultName, filters }),
  folderDialog: () => inv("dialog:folder"),
  confirm: (message, detail, buttons) => inv("dialog:confirm", { message, detail, buttons }),
  readFile: async (p) => { const b = await inv("file:read", p); return b.buffer.slice(b.byteOffset, b.byteOffset + b.byteLength); },
  writeFile: (p, data) => inv("file:write", { path: p, data: data instanceof Uint8Array ? data : new Uint8Array(data) }),
  exists: (p) => inv("file:exists", p), stat: (p) => inv("file:stat", p), showInFolder: (p) => inv("file:showInFolder", p), openPath: (p) => inv("file:openPath", p),
  recent: () => inv("recent:get"), clearRecent: () => inv("recent:clear"),
  getSettings: () => inv("settings:get"), setSettings: (o) => inv("settings:set", o),
  info: () => inv("app:info"), openExternal: (u) => inv("app:openExternal", u), setDefault: () => inv("app:setDefault"), isFirstRun: () => inv("app:isFirstRun"),
  print: (o) => inv("app:print", o), printToPdf: (o) => inv("app:printToPdf", o),
  checkUpdates: () => inv("update:check"), downloadUpdate: () => inv("update:download"), installUpdate: () => inv("update:install"),
  setTitle: (t) => inv("window:title", t), setEdited: (v) => inv("window:setDocumentEdited", v),
  quit: (force = false) => inv("app:quit", force), closingAck: () => inv("app:closingAck"), cancelClose: () => inv("app:cancelClose"), fullscreen: (v) => inv("window:fullscreen", v), devtools: () => inv("window:devtools"), zoomFactor: (f) => inv("window:zoomFactor", f),
  pathOf: (file) => { try { return webUtils.getPathForFile(file); } catch { return ""; } },
  fetch: async (url, o = {}) => { const r = await inv("net:fetch", { url, method: o.method || "GET", headers: o.headers || {}, body: o.body ? (o.body instanceof Uint8Array ? o.body : new Uint8Array(o.body)) : null }); return { ok: r.ok, status: r.status, headers: r.headers, body: r.body.buffer.slice(r.body.byteOffset, r.body.byteOffset + r.body.byteLength) }; },
  on: (ch, fn) => { if (listeners[ch]) listeners[ch].push(fn); },
});
