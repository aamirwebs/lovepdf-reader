// LovePDF Reader and Editor — UI shell: menubar + toolbar, tabs, open/save/print, home screen, settings, account,
// page context menus (sidebar / viewer), ads & promo slots (configured from adminweb).
import { $, $$, el, esc, toast, status, modal, closeModal, prompt, confirm, bridge, baseName, stripExt, debounce, fmtBytes } from "./util.js";
import { t, setLang, langs } from "./i18n.js";
import { Doc } from "./viewer.js";
import { Editor } from "./editor.js";
import { Tools } from "./tools.js";
import { Ads } from "./ads.js";
import { icon } from "./icons.js";
import { popup, menubar, closePopups } from "./menu.js";

const API = "https://app.lovepdf.me"; // all calls go through the main process (net:fetch); the browser dev build hits it directly
const SITE = "https://www.lovepdf.me";
class App {
  constructor() {
    this.docs = []; this.cur = null; this.settings = { theme: "system", lang: "en", zoom: "width", reopen: true }; this.account = null; this.token = null; this.version = "1.3.0";
    this.viewport = $("#viewport"); this.pagesWrap = $("#pagesWrap"); this.$ = $;
  }
  async init() {
    const b = bridge();
    if (b) { try { Object.assign(this.settings, await b.getSettings()); } catch {} try { const info = await b.info(); this.version = info.version; this.info = info; } catch {} }
    else { try { Object.assign(this.settings, JSON.parse(localStorage.getItem("lp_settings") || "{}")); } catch {} }
    this.token = this.settings.token || null; this.account = this.settings.account || null;
    this.applyTheme(); setLang(this.settings.lang || "en"); this.applyStrings();
    $$("[data-ic]").forEach((e) => { if (!e.querySelector("svg")) e.insertAdjacentHTML("afterbegin", icon(e.dataset.ic)); });
    this.editor = new Editor(this); this.tools = new Tools(this); this.ads = new Ads(this);
    this.wire(); this.updateAccountUi(); await this.renderHome();
    if (b && b.isFirstRun) { try { if (await b.isFirstRun()) setTimeout(() => this.firstRunPrompt(), 900); } catch {} }
    if (b) { b.on("open-files", (paths) => paths.forEach((p) => this.openPath(p))); b.on("menu", ({ cmd, arg }) => this.menuCmd(cmd, arg)); b.on("update", (u) => this.onUpdate(u)); b.on("app-closing", () => this.onClosing()); }
    let openedAtStart = false;
    if (b && b.pending) { try { const pend = await b.pending(); if (pend && pend.files && pend.files.length) { openedAtStart = true; for (const p of pend.files) await this.openPath(p); if (pend.print) this.menuCmd("print", pend.files[0]); } } catch {} }
    if (!openedAtStart && b && this.settings.reopen && this.settings.lastOpen && this.settings.lastOpen.length) { for (const p of this.settings.lastOpen.slice(0, 5)) { if (await b.exists(p)) this.openPath(p); } }
    status(t("appName"), "v" + this.version);
    this.ads.init().catch(() => {});
  }
  applyTheme() { const th = this.settings.theme || "system"; const dark = th === "dark" || (th === "system" && window.matchMedia("(prefers-color-scheme: dark)").matches); document.documentElement.dataset.theme = dark ? "dark" : "light"; }
  applyStrings() { $$("[data-t]").forEach((e) => { e.textContent = t(e.dataset.t); }); $("#findInput").placeholder = t("findPlaceholder"); $("#zoomSel").options[0].text = t("fitWidth"); $("#zoomSel").options[1].text = t("fitPage"); this.updateAccountUi(); }
  saveSettings(obj) { Object.assign(this.settings, obj); const b = bridge(); if (b) b.setSettings(obj).catch(() => {}); else { try { localStorage.setItem("lp_settings", JSON.stringify(this.settings)); } catch {} } }
  current() { return this.cur; }
  updateAccountUi() { const n = $("#accountName"); if (!n) return; n.textContent = this.account ? this.account.name || this.account.email || t("online.loggedIn", { name: "" }) : t("online.login"); $("#btnAccount").title = this.account ? t("online.loggedIn", { name: this.account.name }) : t("online.loginHint"); }

  // ---------- home ----------
  async renderHome() {
    const b = bridge(); const list = $("#recentList"); const rec = b ? await b.recent() : []; this.recentCache = rec;
    list.innerHTML = rec.length ? rec.map((r) => `<div class="ri" data-p="${esc(r.path)}"><span class="ic">📄</span><div style="min-width:0"><div class="nm">${esc(r.name)}</div><div class="pt">${esc(r.path)}</div></div></div>`).join("") : `<p class="muted">${esc(t("noRecent"))}</p>`;
    $$(".ri", list).forEach((x) => { x.onclick = () => this.openPath(x.dataset.p); x.oncontextmenu = (e) => { e.preventDefault(); popup([{ label: t("open"), icon: "folder", action: () => this.openPath(x.dataset.p) }, { label: t("recentUi.showInFolder"), icon: "external", action: () => b && b.showInFolder(x.dataset.p) }, { sep: true }, { label: t("recentUi.remove"), icon: "x", action: async () => { if (b) { const r = (await b.recent()).filter((q) => q.path !== x.dataset.p); await b.clearRecent(); for (const q of r.reverse()) { /* keep order */ } await b.setSettings({ recent: r }); } this.renderHome(); } }], { x: e.clientX, y: e.clientY }); }; });
    const tools = [["open", "folder", t("openPdf"), ""], ["merge", "merge", t("merge"), ""], ["organize", "grid", t("organize"), ""], ["split", "split", t("split"), ""], ["edit", "edit", t("editMode"), ""], ["sign", "sign", t("sign"), ""], ["compress", "zap", t("compress"), "☁"], ["pdf-to-word", "word", "PDF → Word", "☁"], ["ocr-edit", "edittext", t("ocrUi.menu"), "☁"]];
    $("#homeTools").innerHTML = tools.map(([id, ic, l, tag]) => `<button class="qt" data-qt="${id}">${icon(ic, 24)}<b>${esc(l)}</b>${tag ? `<small>${tag} LovePDF.me</small>` : ""}</button>`).join("");
    $$("[data-qt]", $("#homeTools")).forEach((x) => (x.onclick = async () => { const id = x.dataset.qt; if (id === "open") return this.openDialog(); if (id === "merge") return this.tools.merge(null); const files = await this.pickFiles(false); if (!files.length) return; const d = await this.openBytes(files[0].bytes, files[0].name, files[0].path); if (!d) return; if (id === "edit") return this.setMode("edit"); this.tools.run(id); }));
    if (this.ads) { this.ads.render(); this.renderAppLinks(); }
  }
  showHome() { $("#home").hidden = false; $("#docArea").hidden = true; $$(".doc-only").forEach((e) => (e.hidden = true)); $("#btnSave").disabled = true; $("#btnPrint").disabled = true; $("#editbar").hidden = true; $("#ocrbar").hidden = true; $("#findbar").hidden = true; this.cur = null; this.renderTabs(); this.renderHome(); const b = bridge(); if (b) b.setTitle(""); this.ads.render(); }

  // ---------- files ----------
  async pickFiles(multi = true) {
    const b = bridge(); const out = [];
    if (b && b.openDialog) { const paths = await b.openDialog(multi); for (const p of paths) out.push({ name: baseName(p), path: p, bytes: new Uint8Array(await b.readFile(p)) }); return out; }
    return new Promise((resolve) => { const inp = document.createElement("input"); inp.type = "file"; inp.accept = ".pdf,application/pdf"; inp.multiple = multi; inp.onchange = async () => { for (const f of inp.files) out.push({ name: f.name, path: null, bytes: new Uint8Array(await f.arrayBuffer()) }); resolve(out); }; inp.click(); });
  }
  async openDialog() { const files = await this.pickFiles(true); for (const f of files) await this.openBytes(f.bytes, f.name, f.path); }
  async openPath(p) { const b = bridge(); if (!b) return; const existing = this.docs.find((d) => d.path === p); if (existing) return this.activate(existing); try { status(t("loading")); const bytes = new Uint8Array(await b.readFile(p)); return await this.openBytes(bytes, baseName(p), p); } catch (e) { toast(t("openError", { name: baseName(p) }) + " — " + (e.message || ""), 4000); } }
  async openBytes(bytes, name, path = null, dirty = false) {
    const d = new Doc(this, { name, path, bytes }); let password = null;
    for (let tries = 0; tries < 4; tries++) {
      try { await d.load(password); break; }
      catch (e) { if (e && (e.name === "PasswordException" || /password/i.test(String(e.message)))) { const v = await prompt(t("passwordTitle"), { label: tries ? t("wrongPassword") : t("passwordAsk", { name }), type: "password" }); if (v == null) return null; password = v; continue; } toast(t("openError", { name }) + " — " + (e.message || e), 5000); return null; }
    }
    if (!d.pdf) return null; d.dirty = dirty; this.docs.push(d); this.activate(d); this.rememberOpen(); this.ads.event("open", { slot: "doc" }); return d;
  }
  rememberOpen() { this.saveSettings({ lastOpen: this.docs.filter((d) => d.path).map((d) => d.path) }); }
  activate(d) {
    if (this.cur && this.cur !== d) { this.cur.scrollTop = this.viewport.scrollTop; this.editor.commitText(); this.cur.unmount(); }
    this.cur = d; $("#home").hidden = true; $("#docArea").hidden = false; $$(".doc-only").forEach((e) => (e.hidden = false)); $("#btnSave").disabled = false; $("#btnPrint").disabled = false;
    d.mount(); this.viewport.scrollTop = d.scrollTop || 0; this.renderTabs(); this.updatePageUi(); this.updateZoomUi(); this.refreshSidebar(); const b = bridge(); if (b) b.setTitle(d.name);
    const editing = d.edits && d.edits.active; $("#modeEdit").classList.toggle("on", !!editing); $("#modeView").classList.toggle("on", !editing); $("#editbar").hidden = !editing; this.viewport.classList.toggle("editing", !!editing); if (!editing) $("#ocrbar").hidden = true;
    if (d.find.q) { $("#findbar").hidden = false; $("#findInput").value = d.find.q; } else $("#findbar").hidden = true;
    this.viewport.focus(); this.ads.render();
  }
  renderTabs() { const tabs = $("#tabs"); tabs.hidden = this.docs.length === 0; tabs.innerHTML = this.docs.map((d) => `<div class="tab ${d === this.cur ? "on" : ""}" data-id="${d.id}" title="${esc(d.path || d.name)}"><span class="tn">${d.dirty ? '<span class="dirty">●</span> ' : ""}${esc(d.name)}</span><button class="tx" data-x="${d.id}" title="${esc(t("close"))}">✕</button></div>`).join(""); $$(".tab", tabs).forEach((x) => { x.onclick = (e) => { if (e.target.closest(".tx")) return this.closeDoc(this.docs.find((d) => d.id === e.target.closest(".tx").dataset.x)); this.activate(this.docs.find((d) => d.id === x.dataset.id)); }; x.oncontextmenu = (e) => { e.preventDefault(); const d = this.docs.find((q) => q.id === x.dataset.id); popup([{ label: t("close"), icon: "x", shortcut: "Ctrl+W", action: () => this.closeDoc(d) }, { label: t("tabs.closeOthers"), action: () => this.docs.filter((q) => q !== d).forEach((q) => this.closeDoc(q)) }, { sep: true }, { label: t("recentUi.showInFolder"), icon: "external", disabled: !d.path, action: () => bridge() && bridge().showInFolder(d.path) }, { label: t("tabs.copyPath"), icon: "copy", disabled: !d.path, action: () => navigator.clipboard.writeText(d.path).then(() => toast(t("toast.copied"))) }], { x: e.clientX, y: e.clientY }); }; }); const b = bridge(); if (b) b.setEdited(!!(this.cur && this.cur.dirty)); }
  async closeDoc(d) {
    if (!d) return; if (d.dirty || this.editor.hasEdits(d)) { const r = await confirm(t("unsaved"), t("unsavedAsk", { name: d.name }), [t("save"), t("dontSave"), t("cancel")]); if (r === 2) return; if (r === 0) { const ok = await this.save(d); if (!ok) return; } }
    const i = this.docs.indexOf(d); this.docs.splice(i, 1); if (this.cur === d) { this.editor.leave(d); this.cur = null; await d.destroy(); const next = this.docs[Math.min(i, this.docs.length - 1)]; if (next) this.activate(next); else this.showHome(); } else await d.destroy();
    this.renderTabs(); this.rememberOpen();
  }
  async save(d = this.cur, forceAs = false) {
    if (!d) return false; const b = bridge();
    if ((d.dirty || this.editor.hasEdits(d)) && !(await this.ads.gate("save"))) return false;
    status(t("saving"));
    try {
      const bytes = this.editor.hasEdits(d) ? await this.editor.flatten(d) : d.bytes; let path = d.path;
      if (!path || forceAs || !b) { if (b) { path = await b.saveAsDialog(d.name.replace(/\.pdf$/i, "") + ".pdf"); if (!path) { status(""); return false; } } else { download(bytes, d.name); d.dirty = false; this.renderTabs(); status(t("saved")); return true; } }
      await b.writeFile(path, bytes); const changed = bytes !== d.bytes; d.path = path; d.name = baseName(path); if (changed) await d.replace(bytes, { keepDirty: false }); d.dirty = false; this.renderTabs(); this.rememberOpen(); b.setTitle(d.name); status(t("savedTo", { path })); toast(t("saved")); this.ads.action("save", { slot: "save" }); if (changed) this.ads.afterSave(); return true;
    } catch (e) { console.error(e); toast(t("error") + ": " + (e.message || e), 5000); status(""); return false; }
  }
  async saveBytesAs(bytes, name, ext = "pdf") { const b = bridge(); if (!b) { download(bytes, name); return name; } const path = await b.saveAsDialog(name, [{ name: ext.toUpperCase(), extensions: [ext] }]); if (!path) return null; await b.writeFile(path, bytes); toast(t("savedTo", { path }), 3500); return path; }
  async ask(title, placeholder, label) { return prompt(title, { label, value: placeholder }); }

  // ---------- print ----------
  async print() {
    const d = this.cur; if (!d) return; const area = $("#printArea"); area.innerHTML = ""; status(t("print") + "…");
    const bytes = this.editor.hasEdits(d) ? await this.editor.flatten(d) : null; if (bytes) await d.replace(bytes);
    for (const p of d.pages) { const vp = p.base.page.getViewport({ scale: 2, rotation: (p.base.page.rotate + d.rotation) % 360 }); const c = document.createElement("canvas"); c.width = vp.width; c.height = vp.height; await p.base.page.render({ canvasContext: c.getContext("2d", { alpha: false }), viewport: vp }).promise; const img = new Image(); img.src = c.toDataURL("image/jpeg", 0.92); area.appendChild(img); status(t("rendering", { n: p.n })); }
    await new Promise((r) => setTimeout(r, 150)); const b = bridge(); if (b && b.print) await b.print({}); else window.print(); area.innerHTML = ""; status("");
  }

  // ---------- modes ----------
  async setMode(m) { const d = this.cur; if (!d) { toast(t("toast.needPdf")); return; } if (m === "edit") { await this.editor.enter(d); } else { this.editor.leave(d); } $("#modeEdit").classList.toggle("on", m === "edit"); $("#modeView").classList.toggle("on", m !== "edit"); }
  updatePageUi() { const d = this.cur; if (!d) return; $("#pgNum").value = d.current; $("#pgTotal").textContent = d.numPages; d.markThumb(); status(null, `${t("page")} ${d.current} ${t("of")} ${d.numPages} · ${fmtBytes(d.bytes.length)}`); if (d.edits && d.edits.active) { const p = d.pages[d.current - 1]; if (p) this.editor.loadTextItems(d, p); this.editor.checkOcr(d); } }
  updateZoomUi() { const d = this.cur; if (!d) return; const sel = $("#zoomSel"); const z = typeof d.zoom === "number" ? String(d.zoom) : d.zoom; if ([...sel.options].some((o) => o.value === z)) sel.value = z; else { let o = sel.querySelector("option[data-custom]"); if (!o) { o = document.createElement("option"); o.dataset.custom = "1"; sel.appendChild(o); } o.value = z; o.text = Math.round(d.effectiveZoom() * 100) + "%"; sel.value = z; } }
  refreshSidebar() { const d = this.cur; if (!d || $("#sidebar").hidden) return; d.thumbnails($("#sbThumbs")); d.outline($("#sbOutline")); }
  toggleSidebar(force) { const sb = $("#sidebar"); sb.hidden = force != null ? !force : !sb.hidden; this.saveSettings({ sidebar: !sb.hidden }); if (!sb.hidden) this.refreshSidebar(); if (this.cur) this.cur.relayout(); $("#btnSidebar").classList.toggle("on", !sb.hidden); this.ads.render(); }

  // ---------- menus (menubar, Rotate dropdown, page / object context menus) ----------
  menuItems(id) {
    const d = this.cur, b = bridge(), ed = d && d.edits && d.edits.active; const no = !d; const T = this.tools; const ns = () => (d ? d.selectedPages() : []);
    const recent = (this.recentCache || []).slice(0, 8);
    if (id === "file") return [
      { label: t("open") + "…", icon: "folder", shortcut: "Ctrl+O", action: () => this.openDialog() },
      { label: t("recent"), icon: "file", sub: recent.length ? recent.map((r) => ({ label: r.name, hint: "", action: () => this.openPath(r.path) })).concat([{ sep: true }, { label: t("clearRecent"), action: async () => { if (b) await b.clearRecent(); this.renderHome(); } }]) : [{ label: t("noRecent"), disabled: true }] },
      { sep: true },
      { label: t("save"), icon: "save", shortcut: "Ctrl+S", disabled: no, action: () => this.save(d) }, { label: t("saveAs"), shortcut: "Ctrl+Shift+S", disabled: no, action: () => this.save(d, true) },
      { label: t("file.saveCopyImages"), icon: "image", disabled: no, action: () => T.run("pdf-to-jpg") },
      { sep: true },
      { label: t("print") + "…", icon: "printer", shortcut: "Ctrl+P", disabled: no, action: () => this.print() },
      { label: t("file.showInFolder"), icon: "external", disabled: !(d && d.path), action: () => b && b.showInFolder(d.path) },
      { label: t("pg.props"), icon: "info", disabled: no, action: () => T.pageSizeDialog(d, d.current) },
      { sep: true },
      { label: t("file.closeTab"), shortcut: "Ctrl+W", disabled: no, action: () => this.closeDoc(d) }, { label: t("file.closeAll"), disabled: !this.docs.length, action: async () => { for (const x of [...this.docs]) await this.closeDoc(x); } },
      ...(b ? [{ sep: true }, { label: t("file.exit"), shortcut: "Alt+F4", action: () => b.quit() }] : []),
    ];
    if (id === "edit") return [
      { label: t("edit.undo"), icon: "undo", shortcut: "Ctrl+Z", disabled: !ed, action: () => this.editor.undo() }, { label: t("edit.redo"), icon: "redo", shortcut: "Ctrl+Y", disabled: !ed, action: () => this.editor.redo() },
      { sep: true },
      { label: t("editMode") + " — " + t("edit.edittext"), icon: "edittext", disabled: no, action: async () => { await this.setMode("edit"); this.editor.setMode("edittext"); } },
      { label: t("edit.text"), icon: "type", disabled: no, action: async () => { await this.setMode("edit"); this.editor.setMode("text"); } },
      { label: t("edit.image"), icon: "image", disabled: no, action: async () => { await this.setMode("edit"); this.editor.setMode("image"); } },
      { label: t("edit.signature"), icon: "sign", disabled: no, action: async () => { await this.setMode("edit"); this.editor.setMode("signature"); } },
      { label: t("edit.highlight"), icon: "highlight", disabled: no, action: async () => { await this.setMode("edit"); this.editor.setMode("highlight"); } },
      { label: t("edit.whiteout"), icon: "eraser", disabled: no, action: async () => { await this.setMode("edit"); this.editor.setMode("whiteout"); } },
      { label: t("edit.cutout"), icon: "scissors", disabled: no, hint: t("edit.cutoutHint"), action: async () => { await this.setMode("edit"); this.editor.setMode("cutout"); } },
      { sep: true },
      { label: t("ocrUi.menu"), icon: "zap", disabled: no, hint: "☁", action: () => T.ocrEditable(d, "all") },
      { sep: true },
      { label: t("edit.delete"), icon: "trash", shortcut: "Del", disabled: !(ed && d.edits.sel), action: () => this.editor.deleteSel() },
      { label: t("find") + "…", icon: "search", shortcut: "Ctrl+F", disabled: no, action: () => this.showFind() },
    ];
    if (id === "view") return [
      { label: t("zoomIn"), icon: "plus", shortcut: "Ctrl +", disabled: no, action: () => d.zoomStep(1) }, { label: t("zoomOut"), icon: "minus", shortcut: "Ctrl −", disabled: no, action: () => d.zoomStep(-1) },
      { label: t("fitWidth"), shortcut: "Ctrl+0", disabled: no, checked: d && d.zoom === "width", action: () => d.setZoom("width") }, { label: t("fitPage"), shortcut: "Ctrl+1", disabled: no, checked: d && d.zoom === "page", action: () => d.setZoom("page") }, { label: "100%", disabled: no, checked: d && d.zoom === 1, action: () => d.setZoom(1) },
      { sep: true },
      { label: t("rot.view"), icon: "rotcw", shortcut: "Ctrl+R", disabled: no, action: () => d.rotate(90) },
      { label: t("sidebar"), icon: "sidebar", shortcut: "F4", checked: !$("#sidebar").hidden, action: () => this.toggleSidebar() },
      { sep: true },
      { label: t("set.theme"), icon: document.documentElement.dataset.theme === "dark" ? "moon" : "sun", sub: [["system", t("set.system")], ["light", t("set.light")], ["dark", t("set.dark")]].map(([v, l]) => ({ label: l, checked: (this.settings.theme || "system") === v, action: () => { this.saveSettings({ theme: v }); this.applyTheme(); } })) },
      { label: t("set.lang"), icon: "globe", sub: langs.map(([c, n]) => ({ label: n, checked: (this.settings.lang || "en") === c, action: () => this.setLanguage(c) })) },
      ...(b ? [{ sep: true }, { label: t("view.fullscreen"), icon: "fullscreen", shortcut: "F11", action: () => b.fullscreen() }] : []),
    ];
    if (id === "page") return this.pageItems(ns(), { fromMenu: true });
    if (id === "tools") return [
      { label: t("organize"), icon: "grid", disabled: no, action: () => T.run("organize") }, { label: t("merge"), icon: "merge", action: () => T.run("merge") }, { label: t("split"), icon: "split", disabled: no, action: () => T.run("split") }, { label: t("extract"), icon: "extract", disabled: no, action: () => T.run("extract") },
      { sep: true },
      { label: t("watermark"), icon: "drop", disabled: no, action: () => T.run("watermark") }, { label: t("pageNumbers"), icon: "hash", disabled: no, action: () => T.run("pageNumbers") }, { label: t("crop"), icon: "crop", disabled: no, action: () => T.run("crop") }, { label: t("sign"), icon: "sign", disabled: no, action: () => T.run("sign") },
      { sep: true, },
      { title: "☁ LovePDF.me" },
      { label: t("compress"), icon: "zap", disabled: no, action: () => T.run("compress") }, { label: t("convert"), icon: "refresh", disabled: no, sub: [["pdf-to-word", "PDF → Word"], ["pdf-to-excel", "PDF → Excel"], ["pdf-to-powerpoint", "PDF → PowerPoint"], ["pdf-to-jpg", "PDF → JPG"]].map(([s, l]) => ({ label: l, action: () => T.run(s) })) },
      { label: t("ocr"), icon: "search", disabled: no, action: () => T.run("ocr-pdf") }, { label: t("protect"), icon: "lock", disabled: no, action: () => T.run("protect-pdf") }, { label: t("translate"), icon: "globe", disabled: no, action: () => T.run("translate-pdf") },
      { sep: true }, { label: t("tools") + " — " + t("menu.all"), icon: "tools", action: () => T.menu() },
    ];
    if (id === "help") return [
      { label: t("help.shortcuts"), icon: "keyboard", action: () => this.shortcutsDialog() },
      { label: t("help.guide"), icon: "info", action: () => this.openExt(this.link("help", SITE + "/windows/help") + "?utm_source=windows-app") },
      { label: t("help.website"), icon: "external", action: () => this.openExt(SITE + "/?utm_source=windows-app&utm_medium=help") },
      { label: t("help.scanner"), icon: "phone", action: () => this.openExt(this.link("scanner", SITE + "/tools/scan-to-pdf") + "?utm_source=windows-app") },
      ...(this.link("android") ? [{ label: t("help.android"), icon: "android", action: () => this.openExt(this.link("android")) }] : []),
      ...(this.link("ios") ? [{ label: t("help.ios"), icon: "apple", action: () => this.openExt(this.link("ios")) }] : []),
      { label: t("help.contact"), icon: "user", action: () => this.openExt(this.link("contact", SITE + "/contact-us") + "?utm_source=windows-app") },
      { sep: true },
      ...(b ? [{ label: t("set.defaultApp"), icon: "star", action: () => b.setDefault() }, { label: t("set.updates"), icon: "refresh", action: () => { b.checkUpdates(); toast(t("set.checking")); } }] : []),
      { label: t("settings"), icon: "settings", action: () => this.settingsDialog() },
      { sep: true },
      { label: t("about") + " LovePDF Reader", icon: "info", action: () => this.aboutDialog() },
    ];
    return [];
  }
  /** Acrobat-style page menu; ns = 1-based pages the action applies to. */
  pageItems(ns, { viewer = false, fromMenu = false } = {}) {
    const d = this.cur; if (!d) return [{ label: t("toast.needPdf"), disabled: true }]; const T = this.tools; ns = ns && ns.length ? ns : [d.current]; const one = ns.length === 1; const n = ns[0]; const last = ns[ns.length - 1];
    const lbl = (k) => one ? t(k) : t(k) + ` (${ns.length})`;
    return [
      ...(fromMenu ? [] : [{ title: one ? `${t("page")} ${n}` : t("pg.selected", { n: ns.length }) }]),
      { label: t("pg.insert"), icon: "insert", sub: [
        { label: t("pg.blankBefore"), icon: "plusfile", action: () => T.insertBlankAt(d, n - 1) }, { label: t("pg.blankAfter"), icon: "plusfile", action: () => T.insertBlankAt(d, last) },
        { sep: true }, { label: t("pg.fromPdfBefore"), icon: "file", action: () => T.insertPdfAt(d, n - 1) }, { label: t("pg.fromPdfAfter"), icon: "file", action: () => T.insertPdfAt(d, last) },
        { sep: true }, { label: t("pg.fromImages"), icon: "image", action: () => T.insertImagesAt(d, last) } ] },
      { label: lbl("pg.extract"), icon: "extract", sub: [{ label: t("pg.extractTab"), action: () => T.extractSel(d, ns, "tab") }, { label: t("pg.extractFile"), action: () => T.extractSel(d, ns, "file") }] },
      { label: t("pg.replace") + "…", icon: "replace", disabled: !one, action: () => T.replacePage(d, n) },
      { label: lbl("pg.duplicate"), icon: "copy", action: () => T.duplicatePages(d, ns) },
      { sep: true },
      { label: lbl("pg.rotateCw"), icon: "rotcw", action: () => T.rotateSel(d, ns, 90) }, { label: lbl("pg.rotateCcw"), icon: "rotccw", action: () => T.rotateSel(d, ns, -90) }, { label: t("rot.all"), icon: "layers", action: () => T.rotatePages(d, "all", 90) },
      { label: lbl("pg.crop"), icon: "crop", action: async () => { d.goTo(n); await this.setMode("edit"); this.editor.startCrop(d, ns); } },
      { sep: true },
      { label: t("pg.moveTo") + "…", icon: "move", action: async () => { const v = await prompt(t("pg.moveTo"), { label: t("pg.moveToLabel", { n: d.numPages }), value: String(n) }); if (v == null) return; T.movePages(d, ns, Math.max(1, parseInt(v, 10) || 1)); } },
      { label: t("pg.moveUp"), icon: "up", disabled: n <= 1, action: () => T.movePages(d, ns, n - 1) }, { label: t("pg.moveDown"), icon: "down", disabled: last >= d.numPages, action: () => T.movePages(d, ns, n + 1) },
      { sep: true },
      { label: t("pg.copyImage"), icon: "copy", disabled: !one, action: () => T.copyPageImage(d, n) }, { label: t("pg.saveImage"), icon: "image", disabled: !one, action: () => T.savePageImage(d, n) },
      { label: t("pg.props"), icon: "info", disabled: !one, action: () => T.pageSizeDialog(d, n) },
      { label: t("organize") + "…", icon: "grid", action: () => T.run("organize") },
      ...(viewer ? [{ sep: true }, { label: t("rot.view"), icon: "eye", action: () => d.rotate(90) }, { label: t("fitWidth"), action: () => d.setZoom("width") }, { label: t("fitPage"), action: () => d.setZoom("page") }] : []),
      { sep: true },
      { label: lbl("pg.delete"), icon: "trash2", danger: true, shortcut: "Del", disabled: ns.length >= d.numPages, action: () => T.deletePages(d, ns) },
    ];
  }
  pageMenu(ns, pos, opts = {}) { popup(this.pageItems(ns, opts), { x: pos.x, y: pos.y, minWidth: 240 }); }
  objectMenu(d, p, o, pos) {
    const E = this.editor; popup([
      { title: t("edit." + (o.type === "path" ? "draw" : o.type === "image" ? "image" : o.type)) },
      ...(o.type === "text" ? [{ label: t("obj.editText"), icon: "type", action: () => E.openText(d, p, o) }] : []),
      ...(o.type === "note" ? [{ label: t("obj.editNote"), icon: "note", action: () => E.notePrompt(o.text).then((v) => { if (v != null) { E.snapPage(d, p.n); o.text = v; } }) }] : []),
      { label: t("obj.duplicate"), icon: "copy", shortcut: "Ctrl+D", action: () => E.duplicateSel() },
      { label: t("obj.front"), icon: "up", action: () => E.bringToFront() }, { label: t("obj.back"), icon: "down", action: () => E.sendToBack() },
      { sep: true }, { label: t("edit.delete"), icon: "trash2", danger: true, shortcut: "Del", action: () => E.deleteSel() },
    ], { x: pos.x, y: pos.y });
  }
  rotateMenu(anchor) { const d = this.cur; if (!d) return; popup([
    { label: t("rot.view"), icon: "eye", shortcut: "Ctrl+R", action: () => d.rotate(90) }, { sep: true },
    { label: t("rot.cw"), icon: "rotcw", action: () => this.tools.rotateSel(d, [d.current], 90) }, { label: t("rot.ccw"), icon: "rotccw", action: () => this.tools.rotateSel(d, [d.current], -90) },
    { label: t("rot.all"), icon: "layers", action: () => this.tools.rotatePages(d, "all", 90) }, { label: t("rot.allCcw"), icon: "layers", action: () => this.tools.rotatePages(d, "all", -90) },
    { sep: true }, { label: t("rot.selected"), icon: "grid", hint: t("rot.selectedHint"), action: () => { this.toggleSidebar(true); this.tools.rotateSel(d, d.selectedPages(), 90); } },
  ], { anchor, minWidth: 260 }); }
  openExt(url) { const b = bridge(); if (b) b.openExternal(url); else window.open(url); }
  link(k, dflt = "") { const l = this.ads && this.ads.cfg && this.ads.cfg.links; return (l && l[k]) || dflt; }
  renderAppLinks() { const el0 = $("#homeApps"); if (!el0) return; const a = this.link("android"), i = this.link("ios"); el0.innerHTML = (a ? ` · <a href="#" data-ext="${esc(a)}">${icon("android", 14)} ${esc(t("help.android"))}</a>` : "") + (i ? ` · <a href="#" data-ext="${esc(i)}">${icon("apple", 14)} ${esc(t("help.ios"))}</a>` : ""); }
  setLanguage(c) { this.saveSettings({ lang: c }); setLang(c); this.applyStrings(); this.editor.rebuildBar(); this.renderHome(); if (this.cur) this.updatePageUi(); }

  // ---------- wiring ----------
  wire() {
    $("#btnHome").onclick = () => { if (this.cur) { this.cur.scrollTop = this.viewport.scrollTop; this.editor.commitText(); this.cur.unmount(); } this.showHome(); };
    $("#btnOpen").onclick = () => this.openDialog(); $("#homeOpen").onclick = () => this.openDialog(); $("#btnSave").onclick = () => this.save(); $("#btnPrint").onclick = () => this.print();
    $("#recentClear").onclick = async () => { const b = bridge(); if (b) await b.clearRecent(); this.renderHome(); };
    $("#btnSidebar").onclick = () => this.toggleSidebar(); if (this.settings.sidebar) { $("#sidebar").hidden = false; $("#btnSidebar").classList.add("on"); }
    $$(".sb-tabs button[data-sb]").forEach((b) => (b.onclick = () => { $$(".sb-tabs button[data-sb]").forEach((x) => x.classList.toggle("on", x === b)); $("#sbThumbs").hidden = b.dataset.sb !== "thumbs"; $("#sbOutline").hidden = b.dataset.sb !== "outline"; }));
    $("#sbMenu").onclick = (e) => { if (!this.cur) return; popup(this.pageItems(this.cur.selectedPages()), { anchor: e.currentTarget, align: "end", minWidth: 240 }); };
    $("#pgPrev").onclick = () => this.cur && this.cur.goTo(this.cur.current - 1); $("#pgNext").onclick = () => this.cur && this.cur.goTo(this.cur.current + 1);
    $("#pgNum").onchange = (e) => this.cur && this.cur.goTo(+e.target.value); $("#pgNum").onkeydown = (e) => { if (e.key === "Enter") { this.cur && this.cur.goTo(+e.target.value); this.viewport.focus(); } };
    $("#zoomIn").onclick = () => this.cur && this.cur.zoomStep(1); $("#zoomOut").onclick = () => this.cur && this.cur.zoomStep(-1); $("#zoomSel").onchange = (e) => { const v = e.target.value; this.cur && this.cur.setZoom(v === "width" || v === "page" ? v : +v); this.saveSettings({ zoom: v === "width" || v === "page" ? v : +v }); };
    $("#btnRotateMenu").onclick = (e) => { e.stopPropagation(); this.rotateMenu(e.currentTarget); };
    $("#btnCrop").onclick = async () => { if (!this.cur) return; await this.setMode("edit"); this.editor.startCrop(this.cur); };
    $("#cropCancel").onclick = () => this.editor.cancelCrop(); $("#cropApply").onclick = () => this.editor.applyCrop(false); $("#cropApplyAll").onclick = () => this.editor.applyCrop(true); $("#cropAuto").onclick = () => this.editor.autoCrop();
    $("#btnFind").onclick = () => this.showFind(); $("#findClose").onclick = () => { $("#findbar").hidden = true; if (this.cur) this.cur.search(""); $("#findCount").textContent = ""; this.viewport.focus(); };
    const doFind = debounce(async () => { const d = this.cur; if (!d) return; const r = await d.search($("#findInput").value); $("#findCount").textContent = r.hits.length ? t("matches", { n: r.hits.length }) : (r.q ? t("noMatches") : ""); if (r.hits.length) d.findStep(1); }, 250);
    $("#findInput").oninput = doFind; $("#findInput").onkeydown = (e) => { if (e.key === "Enter") { e.preventDefault(); this.cur && this.cur.findStep(e.shiftKey ? -1 : 1); } if (e.key === "Escape") $("#findClose").click(); };
    $("#findPrev").onclick = () => this.cur && this.cur.findStep(-1); $("#findNext").onclick = () => this.cur && this.cur.findStep(1);
    $("#modeView").onclick = () => this.setMode("view"); $("#modeEdit").onclick = () => this.setMode("edit");
    $("#btnPages").onclick = () => this.tools.run("organize"); $("#btnTools").onclick = () => this.tools.menu(); $("#btnSettings").onclick = () => this.settingsDialog();
    $("#btnAccount").onclick = (e) => { e.stopPropagation(); if (!this.account) return this.loginDialog(); popup([{ title: this.account.name || "" }, { label: t("online.loggedIn", { name: this.account.plan ? String(this.account.plan).toUpperCase() : "FREE" }), disabled: true }, { label: t("account.manage"), icon: "external", action: () => this.openExt(SITE + "/account?utm_source=windows-app") }, { sep: true }, { label: t("online.logout"), icon: "logout", action: () => { this.logout(); toast(t("online.logout")); } }], { anchor: e.currentTarget, align: "end" }); };
    menubar($("#mainMenu"), (id) => this.menuItems(id));
    // right-click on a page in View mode (Edit mode: the overlay handles it)
    this.viewport.addEventListener("contextmenu", (e) => { const d = this.cur; if (!d || (d.edits && d.edits.active)) return; const pg = e.target.closest(".page"); if (!pg) return; if (window.getSelection && String(window.getSelection()).trim()) { e.preventDefault(); popup([{ label: t("obj.copyText"), icon: "copy", shortcut: "Ctrl+C", action: () => document.execCommand("copy") }, { label: t("obj.highlightSel"), icon: "highlight", action: async () => { await this.setMode("edit"); this.editor.setMode("highlight"); } }], { x: e.clientX, y: e.clientY }); return; } e.preventDefault(); this.pageMenu([+pg.dataset.n], { x: e.clientX, y: e.clientY }, { viewer: true }); });
    // scroll → current page
    this.viewport.addEventListener("scroll", debounce(() => { const d = this.cur; if (!d) return; const n = d.pageFromScroll(); if (n !== d.current) { d.current = n; this.updatePageUi(); } }, 60));
    this.viewport.addEventListener("wheel", (e) => { if (!e.ctrlKey || !this.cur) return; e.preventDefault(); this.cur.zoomStep(e.deltaY < 0 ? 1 : -1); }, { passive: false });
    window.addEventListener("resize", debounce(() => { if (this.cur) this.cur.relayout(); this.ads.render(); }, 120));
    window.matchMedia("(prefers-color-scheme: dark)").addEventListener("change", () => this.applyTheme());
    // keyboard
    document.addEventListener("keydown", (e) => {
      const tag = (e.target.tagName || "").toLowerCase(); const typing = tag === "input" || tag === "textarea" || tag === "select";
      if (e.key === "F11") { e.preventDefault(); const b = bridge(); if (b) b.fullscreen(); return; } if (e.key === "F12") { const b = bridge(); if (b && b.devtools) b.devtools(); return; }
      if (e.altKey && !e.ctrlKey && !typing) { const k = e.key.toLowerCase(); const map = { f: "file", e: "edit", v: "view", p: "page", t: "tools", h: "help" }; if (map[k]) { e.preventDefault(); const btn = $(`[data-menu="${map[k]}"]`); btn.click(); return; } }
      if (e.ctrlKey || e.metaKey) { const k = e.key.toLowerCase(); if (k === "o") { e.preventDefault(); this.openDialog(); } else if (k === "s") { e.preventDefault(); this.save(this.cur, e.shiftKey); } else if (k === "p") { e.preventDefault(); this.print(); } else if (k === "f") { e.preventDefault(); this.showFind(); } else if (k === "w") { e.preventDefault(); this.closeDoc(this.cur); } else if (k === "=" || k === "+") { e.preventDefault(); this.cur && this.cur.zoomStep(1); } else if (k === "-") { e.preventDefault(); this.cur && this.cur.zoomStep(-1); } else if (k === "0") { e.preventDefault(); this.cur && this.cur.setZoom("width"); } else if (k === "1") { e.preventDefault(); this.cur && this.cur.setZoom("page"); } else if (k === "r") { e.preventDefault(); this.cur && this.cur.rotate(90); } else if (k === "tab") { e.preventDefault(); this.nextTab(e.shiftKey ? -1 : 1); } else if (k === "z" && !typing) { e.preventDefault(); this.editor.undo(); } else if (k === "y" && !typing) { e.preventDefault(); this.editor.redo(); } else if (k === "d" && !typing && this.cur && this.cur.edits && this.cur.edits.active && this.cur.edits.sel) { e.preventDefault(); this.editor.duplicateSel(); } else if (k === "e" && !typing) { e.preventDefault(); this.setMode(this.cur && this.cur.edits && this.cur.edits.active ? "view" : "edit"); } return; }
      if (typing || !this.cur) return;
      if (e.key === "PageDown") { e.preventDefault(); this.cur.goTo(this.cur.current + 1); } else if (e.key === "PageUp") { e.preventDefault(); this.cur.goTo(this.cur.current - 1); } else if (e.key === "Home" && !e.shiftKey) { this.cur.goTo(1); } else if (e.key === "End" && !e.shiftKey) { this.cur.goTo(this.cur.numPages); } else if (e.key === "F4") { this.toggleSidebar(); } else if (e.key === "Escape") { if (!$("#modal").hidden) closeModal(); else if (!$("#findbar").hidden) $("#findClose").click(); }
    });
    // drag & drop
    let dragDepth = 0; const ov = $("#dropOverlay");
    document.addEventListener("dragenter", (e) => { if (!e.dataTransfer || ![...e.dataTransfer.types].includes("Files")) return; dragDepth++; ov.hidden = false; }); document.addEventListener("dragleave", () => { dragDepth = Math.max(0, dragDepth - 1); if (!dragDepth) ov.hidden = true; }); document.addEventListener("dragover", (e) => { if (e.dataTransfer && [...e.dataTransfer.types].includes("Files")) e.preventDefault(); });
    document.addEventListener("drop", async (e) => { e.preventDefault(); dragDepth = 0; ov.hidden = true; const files = [...(e.dataTransfer?.files || [])].filter((f) => /\.pdf$/i.test(f.name)); const b = bridge(); for (const f of files) { const p = b && b.pathOf ? b.pathOf(f) : null; if (p) await this.openPath(p); else await this.openBytes(new Uint8Array(await f.arrayBuffer()), f.name); } });
    document.addEventListener("click", (e) => { const a = e.target.closest("[data-ext]"); if (a) { e.preventDefault(); this.openExt(a.dataset.ext); } });
  }
  /** Window ✕ / Alt+F4: ask about unsaved files, play the "on close" promo video if configured, then really quit. */
  async onClosing() {
    const b = bridge(); if (!b) return; if (this.closing) return; this.closing = true; try { await b.closingAck(); } catch {}
    try {
      for (const d of [...this.docs]) { if (d.dirty || this.editor.hasEdits(d)) { this.activate(d); const r = await confirm(t("unsaved"), t("unsavedAsk", { name: d.name }), [t("save"), t("dontSave"), t("cancel")]); if (r === 2) { this.closing = false; await b.cancelClose(); return; } if (r === 0) { const ok = await this.save(d); if (!ok) { this.closing = false; await b.cancelClose(); return; } } d.dirty = false; if (d.edits) d.edits.objs = {}; } }
      await this.ads.flush(); await this.ads.video("close");
    } catch (e) { console.error(e); }
    b.quit(true);
  }
  showFind() { if (!this.cur) return; $("#findbar").hidden = false; const i = $("#findInput"); i.focus(); i.select(); }
  nextTab(dir) { if (this.docs.length < 2) return; const i = this.docs.indexOf(this.cur); this.activate(this.docs[(i + dir + this.docs.length) % this.docs.length]); }
  menuCmd(cmd, arg) { const d = this.cur; const map = { open: () => this.openDialog(), save: () => this.save(d), saveAs: () => this.save(d, true), print: async () => { if (arg) { const x = await this.openPath(arg); if (x) await new Promise((r) => setTimeout(r, 400)); } this.print(); }, closeTab: () => this.closeDoc(d), undo: () => this.editor.undo(), redo: () => this.editor.redo(), find: () => this.showFind(), zoomIn: () => d && d.zoomStep(1), zoomOut: () => d && d.zoomStep(-1), fitWidth: () => d && d.setZoom("width"), fitPage: () => d && d.setZoom("page"), rotate: () => d && d.rotate(90), sidebar: () => this.toggleSidebar(), nextTab: () => this.nextTab(1), about: () => this.aboutDialog() }; if (map[cmd]) map[cmd](); }

  firstRunPrompt() { const b = bridge(); const body = modal(t("firstRun.title"), `<p>${esc(t("firstRun.body"))}</p><p class="hint">${esc(t("firstRun.how"))}</p><div class="row end"><button class="btn" id="frNo">${esc(t("firstRun.no"))}</button><button class="btn btn-primary" id="frYes">${icon("star")} ${esc(t("firstRun.yes"))}</button></div>`, { size: "sm" }); $("#frNo", body).onclick = closeModal; $("#frYes", body).onclick = () => { closeModal(); b.setDefault(); }; }
  shortcutsDialog() {
    const rows = [["Ctrl+O", t("open")], ["Ctrl+S", t("save")], ["Ctrl+Shift+S", t("saveAs")], ["Ctrl+P", t("print")], ["Ctrl+W", t("file.closeTab")], ["Ctrl+F", t("find")], ["Ctrl+E", t("editMode") + " / " + t("viewMode")], ["Ctrl+Z / Ctrl+Y", t("edit.undo") + " / " + t("edit.redo")], ["Ctrl+D", t("obj.duplicate")], ["Del", t("edit.delete")], ["Ctrl + / Ctrl −", t("zoomIn") + " / " + t("zoomOut")], ["Ctrl+0 / Ctrl+1", t("fitWidth") + " / " + t("fitPage")], ["Ctrl+R", t("rot.view")], ["F4", t("sidebar")], ["F11", t("view.fullscreen")], ["Ctrl+Tab", t("tabs.next")], ["PgUp / PgDn", t("prev") + " / " + t("next")], ["Alt+F, Alt+E…", t("help.menus")], [t("help.rightClick"), t("help.rightClickHint")]];
    modal(t("help.shortcuts"), `<div class="sc-grid">${rows.map(([k, v]) => `<div><span>${esc(v)}</span><span class="kbd">${esc(k)}</span></div>`).join("")}</div>`, {});
  }
  aboutDialog() { const i = this.info || {}; modal(t("about"), `<div class="about"><img src="icon.png" alt=""><div><h3 style="margin:0 0 4px">LovePDF Reader and Editor</h3><p class="muted" style="margin:0 0 8px">${esc(t("set.version", { v: this.version }))}${i.electron ? ` · Electron ${esc(i.electron)} · Chrome ${esc(i.chrome)}` : ""}</p><p>${esc(t("set.about1"))}</p><p>📱 ${esc(t("set.scanner"))}</p><p><a href="#" data-ext="${SITE}/?utm_source=windows-app">${esc(t("set.website"))}</a> · <a href="#" data-ext="${SITE}/privacy">Privacy</a> · <a href="#" data-ext="${SITE}/terms">Terms</a> · <a href="#" data-ext="https://github.com/aamirwebs/lovepdf-reader/releases">Releases</a></p><p>${esc(t("about.dev"))} <a href="#" data-ext="https://www.soft.com.pk/?utm_source=lovepdf-windows">Soft Technologies — www.soft.com.pk</a> (${esc(t("about.devSub"))})</p><p class="hint">© 2026 LovePDF.me · pdf.js (Apache-2.0) · pdf-lib (MIT) · Electron (MIT)</p></div></div>`, { size: "sm" }); }
  // ---------- settings / about / updates ----------
  settingsDialog() {
    const s = this.settings; const b = bridge();
    const body = modal(t("set.title"), `<div class="set-row"><span>${esc(t("set.theme"))}</span><select id="stTheme"><option value="system">${esc(t("set.system"))}</option><option value="light">${esc(t("set.light"))}</option><option value="dark">${esc(t("set.dark"))}</option></select></div>
      <div class="set-row"><span>${esc(t("set.lang"))}</span><select id="stLang">${langs.map(([c, n]) => `<option value="${c}">${n}</option>`).join("")}</select></div>
      <div class="set-row"><span>${esc(t("set.zoom"))}</span><select id="stZoom"><option value="width">${esc(t("set.auto"))}</option><option value="page">${esc(t("fitPage"))}</option><option value="1">100%</option><option value="1.25">125%</option><option value="1.5">150%</option></select></div>
      <div class="set-row"><span>${esc(t("set.reopen"))}</span><input type="checkbox" id="stReopen" ${s.reopen !== false ? "checked" : ""}></div>
      ${b ? `<div class="set-row"><div><div>${esc(t("set.defaultApp"))}</div><small class="muted">${esc(t("set.defaultHint"))}</small></div><button class="btn btn-sm" id="stDefault">⭐ ${esc(t("set.defaultApp"))}</button></div>
      <div class="set-row"><div><div>${esc(t("set.updates"))}</div><small class="muted" id="stUpdMsg">${esc(t("set.version", { v: this.version }))}</small></div><button class="btn btn-sm" id="stUpd">🔄 ${esc(t("set.updates"))}</button></div>` : ""}
      <div class="set-row"><div><div>${esc(this.account ? t("online.loggedIn", { name: this.account.name }) : "LovePDF.me " + t("online.login"))}</div><small class="muted">${esc(t("online.loginHint"))}</small></div><button class="btn btn-sm" id="stLogin">${esc(this.account ? t("online.logout") : t("online.login"))}</button></div>
      <p class="hint" style="margin-top:12px">${esc(t("set.about1"))}<br>📱 ${esc(t("set.scanner"))}<br><a href="#" data-ext="${SITE}/?utm_source=windows-app">${esc(t("set.website"))}</a> · ${esc(t("set.version", { v: this.version }))} · <a href="#" id="stAbout">${esc(t("about"))}</a></p>`, { size: "sm" });
    $("#stTheme", body).value = s.theme || "system"; $("#stLang", body).value = s.lang || "en"; $("#stZoom", body).value = String(s.zoom || "width");
    $("#stTheme", body).onchange = (e) => { this.saveSettings({ theme: e.target.value }); this.applyTheme(); };
    $("#stLang", body).onchange = (e) => { this.setLanguage(e.target.value); closeModal(); this.settingsDialog(); };
    $("#stZoom", body).onchange = (e) => { const v = e.target.value; this.saveSettings({ zoom: v === "width" || v === "page" ? v : +v }); };
    $("#stReopen", body).onchange = (e) => this.saveSettings({ reopen: e.target.checked });
    const sd = $("#stDefault", body); if (sd) sd.onclick = () => b.setDefault();
    const su = $("#stUpd", body); if (su) su.onclick = () => { $("#stUpdMsg", body).textContent = t("set.checking"); b.checkUpdates(); };
    $("#stLogin", body).onclick = () => { closeModal(); if (this.account) { this.logout(); toast(t("online.logout")); } else this.loginDialog(); };
    $("#stAbout", body).onclick = (e) => { e.preventDefault(); closeModal(); this.aboutDialog(); };
  }
  onUpdate(u) {
    const msg = $("#stUpdMsg"); const set = (s) => { if (msg) msg.textContent = s; };
    if (u.state === "none") { if (u.manual) { set(t("set.upToDate")); toast(t("set.upToDate")); } }
    else if (u.state === "available") { set(t("set.available", { v: u.version })); const body = modal(t("set.updates"), `<p>${esc(t("set.available", { v: u.version }))}</p><div class="prog" id="updProg" hidden><i style="width:0"></i></div><div class="row end"><button class="btn" id="updLater">${esc(t("cancel"))}</button><button class="btn btn-primary" id="updDl">⬇ ${esc(t("set.download"))}</button></div>`, { size: "sm" }); $("#updLater", body).onclick = closeModal; $("#updDl", body).onclick = () => { $("#updProg", body).hidden = false; $("#updDl", body).disabled = true; bridge().downloadUpdate(); }; }
    else if (u.state === "downloading") { const p = $("#updProg"); if (p) { p.hidden = false; p.querySelector("i").style.width = u.percent + "%"; } set(t("set.downloading", { p: u.percent })); }
    else if (u.state === "ready") { set(t("set.ready")); const body = modal(t("set.updates"), `<p>${esc(t("set.ready"))}</p><div class="row end"><button class="btn" id="updLater2">${esc(t("cancel"))}</button><button class="btn btn-primary" id="updGo">${esc(t("set.restart"))}</button></div>`, { size: "sm" }); $("#updLater2", body).onclick = closeModal; $("#updGo", body).onclick = () => bridge().installUpdate(); }
    else if (u.state === "error") { if (u.manual) { set(t("set.updateErr")); toast(t("set.updateErr") + ": " + (u.error || ""), 4000); } }
  }

  // ---------- network / account (all requests go through the main process: no CORS, no cookies) ----------
  async net(url, o = {}) { const b = bridge(); if (b && b.fetch) return b.fetch(url, o); const r = await fetch(url, { method: o.method || "GET", headers: o.headers || {}, body: o.body }); return { ok: r.ok, status: r.status, headers: Object.fromEntries(r.headers.entries()), body: await r.arrayBuffer() }; }
  async api(path, body, method = "POST") { const h = { "Content-Type": "application/json", Accept: "application/json", "X-LovePDF-Client": "windows/" + this.version }; if (this.token) h.Authorization = "Bearer " + this.token; const r = await this.net(API + path, { method, headers: h, body: body ? new TextEncoder().encode(JSON.stringify(body)) : undefined }); let j = {}; try { j = JSON.parse(new TextDecoder().decode(r.body)); } catch {} if (!r.ok) { const err = new Error(j.error || "Error " + r.status); err.extra = j; throw err; } return j; }
  loginDialog(after) {
    const body = modal("LovePDF.me — " + t("online.login"), `<div class="form"><label>${esc(t("online.email"))}<input type="text" id="lgId" autocomplete="username"></label><label>${esc(t("online.password"))}<input type="password" id="lgPw" autocomplete="current-password"></label><p class="hint" id="lgMsg"></p><div class="row end"><a href="#" data-ext="${SITE}/signup?utm_source=windows-app" class="link">Sign up free</a><span class="sp"></span><button class="btn btn-primary" id="lgGo">${esc(t("online.loginBtn"))}</button></div></div>`, { size: "sm" });
    const go = async () => { const id = $("#lgId", body).value.trim(), pw = $("#lgPw", body).value; if (!id || !pw) return; $("#lgGo", body).disabled = true; try { const r = await this.api("/auth/login", { identifier: id, password: pw, platform: "windows", device_name: "Windows PC", device_id: this.settings.deviceId || "" }); this.token = r.token; this.account = { id: r.user.id, name: r.user.name, plan: r.user.plan, email: r.user.email }; this.saveSettings({ token: this.token, account: this.account }); closeModal(); this.updateAccountUi(); toast(t("online.loggedIn", { name: r.user.name })); this.ads.refresh().catch(() => {}); if (after) after(); } catch (e) { $("#lgMsg", body).textContent = t("online.loginFail") + ": " + (e.message || ""); $("#lgGo", body).disabled = false; } };
    $("#lgGo", body).onclick = go; $("#lgPw", body).onkeydown = (e) => { if (e.key === "Enter") go(); };
    setTimeout(() => $("#lgId", body).focus(), 30);
  }
  logout() { const tok = this.token; this.token = null; this.account = null; this.saveSettings({ token: null, account: null }); this.updateAccountUi(); if (tok) this.net(API + "/auth/logout", { method: "POST", headers: { Authorization: "Bearer " + tok, "X-LovePDF-Client": "windows" } }).catch(() => {}); this.ads.refresh().catch(() => {}); }
}
function download(bytes, name) { const a = document.createElement("a"); a.href = URL.createObjectURL(new Blob([bytes], { type: "application/pdf" })); a.download = name; document.body.appendChild(a); a.click(); setTimeout(() => { URL.revokeObjectURL(a.href); a.remove(); }, 3000); }

window.app = new App(); window.app.init().catch((e) => { console.error(e); status("Init error: " + e.message); });
